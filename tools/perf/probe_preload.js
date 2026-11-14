'use strict';
/**
 * Bench-only performance probe (package P, docs/PERF-AUDIT.md). Loaded into the APP process on the bench with
 *   NODE_OPTIONS="--require <abs path>/tools/perf/probe_preload.js" PERF_DIR=<dir> node bench/server.js f30_cluster
 * (bench/server.js forks the app with process.env, so the preload reaches it; in the bench server process itself it
 * sees no app and only idles). Never shipped: app.json "shared" does not list it and nothing in the app requires it.
 *
 * What it records, from outside the app's code (it wraps prototypes after the modules load; nothing in the repo changes):
 *  - event-loop lag: a 5 ms interval timer, how late each firing is (a blocked loop shows as lag);
 *  - JS time per function: HudApp _tick / _update (per widget type) / _rebuildInner / _createSheet, hud_text drawText,
 *    Page render, car samples, the client's JSON encode and frame build, and every other 'long task' (> 8 ms) between;
 *  - socket traffic per cluster-render connection: messages and bytes by kind (uniform by name, frame by layer,
 *    layer / asset / bind / drop ...), and per widget (refs mapped to hud.widgets ids);
 *  - the needle: every needle uniform send (dial u_dyn / u_value, g20dial u_val, sdash u_speed / u_rpm, mtach u_value)
 *    with its time and value, so update intervals, step sizes and 'stalls' can be computed;
 *  - the hud tick's real period (the 50 ms setInterval) and the car samples' arrival.
 * Control: PERF_DIR/ctl.json, polled every 200 ms: { "seq": n, "cmd": "reset" | "dump" | "profile" | "pagecost",
 *   "label": "...", "ms": 15000 }. Each cmd with a new seq runs once; results go to PERF_DIR/<label>.<cmd>.json
 *   (profile: <label>.cpuprofile, from the inspector, which Node 8 has too).
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const DIR = process.env.PERF_DIR;
const isApp = /run-app\.js$/.test(process.argv[1] || '');
if (DIR && isApp) start();

function start() {
    const now = () => { const t = process.hrtime(); return t[0] * 1e3 + t[1] / 1e6; };   // ms, monotonic
    const T0 = now();
    let pixCarry = 0;
    let S = fresh();
    function fresh() {
        return {
            t0: now(), lag: [], fn: {}, long: [], conn: {}, widgets: {}, needle: {}, tick: [], samples: [],
            cpu0: process.cpuUsage(), mem: null, pixNow: pixCarry, pixPeak: pixCarry,
        };
    }
    let hud = null, page = null;
    let depth = 0, current = null;               // the outermost wrapped function running now (long-task attribution)

    function wrap(obj, name, label) {
        const orig = obj[name];
        if (typeof orig !== 'function' || orig.__perf) return;
        const f = function () {
            const lab = typeof label === 'function' ? label.apply(this, arguments) : label;
            const t = now();
            const outer = depth === 0;
            if (outer) current = lab;
            depth++;
            try { return orig.apply(this, arguments); } finally {
                depth--;
                const dt = now() - t;
                const r = S.fn[lab] || (S.fn[lab] = { n: 0, ms: 0, max: 0, self: outer ? 0 : undefined });
                r.n++; r.ms += dt; if (dt > r.max) r.max = dt;
                if (outer) { current = null; if (dt > 8) S.long.push([+(t - S.t0).toFixed(1), +dt.toFixed(1), lab]); }
            }
        };
        f.__perf = true;
        obj[name] = f;
    }

    // ---- socket traffic, per ClusterRender instance ----
    function account(cr, m) {
        if (!Buffer.isBuffer(m) || m.length < 5) return;
        const c = S.conn[cr.app] || (S.conn[cr.app] = { msgs: 0, bytes: 0, kinds: {} });
        c.msgs++; c.bytes += m.length;
        const type = m[4];
        let kind = '?', ref = 0;
        if (type === 0x4a) {
            let o = null;
            try { o = JSON.parse(m.slice(5).toString('utf8')); } catch (e) { /* not ours */ }
            if (o) {
                kind = o.op === 'uniform' ? 'uniform ' + o.name : o.op; ref = o.ref || 0;
                if (o.op === 'uniform') needleSend(cr, o);
            }
        } else if (type === 0x46) { ref = m.readUInt32LE(5); kind = 'frame ' + (m.readUInt16LE(17) ? 'rects' : 'whole'); }
        else if (type === 0x4d) kind = 'mesh';
        const k = c.kinds[kind] || (c.kinds[kind] = { n: 0, bytes: 0 });
        k.n++; k.bytes += m.length;
        const wid = widgetOf(cr, ref, kind);
        if (wid) { const w = S.widgets[wid] || (S.widgets[wid] = { n: 0, bytes: 0 }); w.n++; w.bytes += m.length; }
    }
    function widgetOf(cr, ref, kind) {
        if (!hud || !ref) return null;
        let id = null;
        hud.widgets.forEach((x) => { if (!id && x.c === cr && x.ref === ref) id = x.sheet ? 'sheet@' + x.sheet.x + ',' + x.sheet.y : x.w.id; });
        if (!id && hud.atlases) hud.atlases.forEach((a, key) => { if (!id && a.c === cr && a.ref === ref) id = 'asset ' + key; });
        return id || (kind.indexOf('frame') === 0 ? 'frame ref ' + ref : null);
    }
    const NEEDLE = { u_dyn: 1, u_value: 1, u_val: 1, u_speed: 1, u_rpm: 1 };
    function needleSend(cr, o) {
        if (!NEEDLE[o.name] || !hud) return;
        let x = null;
        hud.widgets.forEach((e) => { if (!x && e.c === cr && e.ref === o.ref) x = e; });
        if (!x) return;
        const w = x.w;
        if (!(w.type === 'dial' || w.type === 'g20dial' || w.type === 'sdash' || w.type === 'mtach')) return;
        const key = w.id + ':' + o.name;
        const a = S.needle[key] || (S.needle[key] = { type: w.type, measure: w.measure || '', t: [], v: [] });
        a.t.push(+(now() - S.t0).toFixed(2));
        a.v.push(Number(String(o.v).split(' ')[0]));
    }

    function patchClient(m) {
        const P = m.ClusterRender && m.ClusterRender.prototype;
        if (!P || P.__perfDone) return;
        P.__perfDone = true;
        const w0 = P._write, pump = P._pump;
        P._write = function (msg) { if (this.sock && this.connected) account(this, msg); return w0.call(this, msg); };
        // frames go out from _pump with sock.write directly: count them there
        P._pump = function () {
            const s = this.sock;
            if (s && !s.__perf) {
                s.__perf = true;
                const sw = s.write;
                const cr = this;
                s.write = function (msg) { if (cr.__inPump) account(cr, msg); return sw.apply(this, arguments); };
            }
            this.__inPump = true;
            try { return pump.call(this); } finally { this.__inPump = false; }
        };
        // pixel memory as the service counts it (every image and asset twice), after each layer / asset made or dropped
        const all = new Set();
        const pix = () => { let n = 0; all.forEach((cr) => cr.layers.forEach((l) => { if (l.image) n += l.image.length * 2; })); return n; };
        const note = () => { const n = pix(); S.pixNow = n; pixCarry = n; if (!(S.pixPeak >= n)) S.pixPeak = n; };
        const add = P._add, drop = P.drop;
        P._add = function () { all.add(this); const r = add.apply(this, arguments); note(); return r; };
        P.drop = function () { const r = drop.apply(this, arguments); note(); return r; };
        wrap(P, '_send', 'client JSON encode+write');
        wrap(P, 'pixels', 'client pixels (copy into its image)');
        wrap(P, '_pump', 'client pump (frame build+write)');
        wrap(P, '_data', 'client read events');
    }
    function patchHud(H) {
        const P = H.prototype;
        if (P.__perfDone) return;
        P.__perfDone = true;
        const ctor = P._tick;
        let lastTick = 0;
        P._tick = function () {
            hud = this;
            const t = now();
            if (lastTick) S.tick.push(+(t - lastTick).toFixed(2));
            lastTick = t;
            return ctor.apply(this, arguments);
        };
        wrap(P, '_tick', 'hud _tick (all widgets)');
        wrap(P, '_update', function (x) { return 'hud _update ' + (x && x.w ? x.w.type : '?'); });
        wrap(P, '_resolve', 'hud _resolve (token strings)');
        wrap(P, '_rebuildInner', 'hud _rebuildInner (layout build)');
        wrap(P, '_createSheet', 'hud _createSheet');
        wrap(P, '_create', 'hud _create (one widget)');
        wrap(P, '_blitDiff', 'hud _blitDiff (diff + blit)');
        wrap(P, '_scene', 'hud _scene (baked texture load)');
        wrap(P, '_atlas', 'hud _atlas (glyph atlas)');
        wrap(P, '_status', 'hud _status');
        wrap(P, '_gTick', 'hud _gTick');
        wrap(P, '_smoothRpm', 'hud _smoothRpm');
        const rb = P._rebuildInner;
        P._rebuildInner = function () {
            hud = this;
            const t = now(), was = {};
            this.clients.forEach((c) => { const k = S.conn[c.app]; was[c.app] = k ? k.bytes : 0; });
            const r = rb.apply(this, arguments);
            const dt = now() - t;
            const after = {};
            this.clients.forEach((c) => { const k = S.conn[c.app]; after[c.app] = (k ? k.bytes : 0) - (was[c.app] || 0); });
            const rec = { at: +(t - S.t0).toFixed(1), layout: this.activeName, ms: +dt.toFixed(1), bytesQueued: after,
                pixelBytes: this.pixelBytes, layers: this._layerRefs().length, sheets: this.sheets.length,
                sheetPx: this.sheets.map((s) => s.w + 'x' + s.h), atlases: Array.from(this.atlases.keys()) };
            (S.rebuilds || (S.rebuilds = [])).push(rec);
            try { fs.appendFileSync(path.join(DIR, 'rebuilds.jsonl'), JSON.stringify(rec) + '\n'); } catch (e) { /* ignore */ }
            return r;
        };
    }
    function patchText(m) {
        if (m.__perfDone) return;
        m.__perfDone = true;
        wrap(m, 'drawText', function (w, h) { return 'text drawText'; });
        const d = m.drawText;
        m.drawText = function (w, h) {
            const r = d.apply(this, arguments);
            const k = S.fn['text drawText px'] || (S.fn['text drawText px'] = { n: 0, ms: 0, max: 0 });
            k.n++; k.ms += w * h; if (w * h > k.max) k.max = w * h;     // (ms column holds pixels here)
            return r;
        };
        m.drawText.__perf = true;
    }
    function patchPage(Pg) {
        const P = Pg.prototype;
        if (P.__perfDone) return;
        P.__perfDone = true;
        const st = P.start;
        P.start = function () { page = this; return st.apply(this, arguments); };
        wrap(P, 'render', 'page render (centre screen frame)');
    }
    function patchCar(C) {
        const P = C.prototype;
        if (P.__perfDone) return;
        P.__perfDone = true;
        const em = P._emit;
        P._emit = function (d, t) { S.samples.push(+(now() - S.t0).toFixed(1)); return em.apply(this, arguments); };
        wrap(P, '_emit', 'car sample listeners');
        wrap(P, 'data', 'car data() copy');
    }

    const load = Module._load;
    Module._load = function (req) {
        const m = load.apply(this, arguments);
        try {
            if (/cluster_render_client(\.js)?$/.test(req)) patchClient(m);
            else if (req === './hud' && typeof m === 'function') patchHud(m);
            else if (req === './hud_text') patchText(m);
            else if (req === './page' && typeof m === 'function') patchPage(m);
            else if (/kit\/car$/.test(req) && typeof m === 'function') patchCar(m);
        } catch (e) { console.warn('[perf] patch ' + req + ': ' + e); }
        return m;
    };

    // ---- event-loop lag ----
    let due = now() + 5;
    setInterval(() => {
        const t = now();
        S.lag.push(+(t - due).toFixed(2));
        due = t + 5;
    }, 5).unref();

    // ---- control ----
    let seq = -1;
    setInterval(() => {
        let c;
        try { c = JSON.parse(fs.readFileSync(path.join(DIR, 'ctl.json'), 'utf8')); } catch (e) { return; }
        if (!c || c.seq === seq) return;
        seq = c.seq;
        const label = c.label || 'run';
        if (c.cmd === 'reset') S = fresh();
        else if (c.cmd === 'dump') dump(label);
        else if (c.cmd === 'profile') profile(label, c.ms || 15000);
        else if (c.cmd === 'pagecost') pageCost(label, c.n || 50);
        else if (c.cmd === 'textcost') textCost(label);
        else if (c.cmd === 'pagestop' && page && page.loop) page.loop.stop();     // as when the HMI hides the page
        else if (c.cmd === 'layers') layers(label);
        else if (c.cmd === 'load') busyLoad(c.ms || 0, c.every || 100);    // a stand-in for a slow CPU's busy event loop
    }, 200).unref();

    function dump(label) {
        const dt = now() - S.t0, cpu = process.cpuUsage(S.cpu0);
        const out = {
            label, seconds: +(dt / 1000).toFixed(2), node: process.version,
            cpuPct: +(((cpu.user + cpu.system) / 1000) / dt * 100).toFixed(2), cpuUserMs: cpu.user / 1000, cpuSysMs: cpu.system / 1000,
            rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed,
            layout: hud && hud.activeName, pixelBytes: hud && hud.pixelBytes, pageLoop: !!(page && page.loop),
            pixNow: S.pixNow, pixPeak: S.pixPeak,
            lag: stats(S.lag), tick: stats(S.tick), samples: stats(diff(S.samples)),
            fn: S.fn, long: S.long, conn: S.conn, widgets: S.widgets, needle: needleStats(), rebuilds: S.rebuilds || [],
            needleRaw: S.needle,
        };
        fs.writeFileSync(path.join(DIR, label + '.dump.json'), JSON.stringify(out, null, 1));
    }
    function diff(a) { const r = []; for (let i = 1; i < a.length; i++) r.push(a[i] - a[i - 1]); return r; }
    function stats(a) {
        if (!a.length) return { n: 0 };
        const s = a.slice().sort((x, y) => x - y), q = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
        return { n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p50: q(0.5), p90: q(0.9), p99: q(0.99), max: +s[s.length - 1].toFixed(2) };
    }
    function needleStats() {
        const out = {};
        Object.keys(S.needle).forEach((k) => {
            const a = S.needle[k], iv = diff(a.t), dv = diff(a.v).map(Math.abs);
            out[k] = { type: a.type, measure: a.measure, sends: a.t.length, perSec: +(a.t.length / ((now() - S.t0) / 1000)).toFixed(2),
                interval: stats(iv), step: stats(dv), gapsOver80ms: iv.filter((x) => x > 80).length, gapsOver120ms: iv.filter((x) => x > 120).length };
        });
        return out;
    }
    function profile(label, ms) {
        let inspector;
        try { inspector = require('inspector'); } catch (e) { return; }
        const s = new inspector.Session();
        s.connect();
        s.post('Profiler.enable', () => s.post('Profiler.setSamplingInterval', { interval: 500 }, () => s.post('Profiler.start', () => {
            setTimeout(() => s.post('Profiler.stop', (err, r) => {
                if (!err && r && r.profile) fs.writeFileSync(path.join(DIR, label + '.cpuprofile'), JSON.stringify(r.profile));
                s.disconnect();
            }), ms);
        })));
    }
    /** The page's frame cost, rendered n times here (whether or not the HMI shows it): record + software raster. */
    function pageCost(label, n) {
        if (!page) return fs.writeFileSync(path.join(DIR, label + '.pagecost.json'), JSON.stringify({ error: 'no page' }));
        const out = { n, renderMs: [], playPngMs: [] };
        for (let i = 0; i < n; i++) { const t = now(); try { page.render(); } catch (e) { out.err = String(e); } out.renderMs.push(now() - t); }
        out.render = stats(out.renderMs); delete out.renderMs;
        fs.writeFileSync(path.join(DIR, label + '.pagecost.json'), JSON.stringify(out, null, 1));
    }
    /** Busy-wait `ms` every `every` ms on the event loop (0 stops): what the page's software frame costs on the car. */
    let loadT = null;
    function busyLoad(ms, every) {
        if (loadT) clearInterval(loadT);
        loadT = null;
        if (ms > 0) loadT = setInterval(() => { const t = now(); while (now() - t < ms) { /* busy */ } }, every);
    }
    /** Every layer and asset the layout made: connection, kind, rect, class / z, its shader and binds, its widgets. */
    function layers(label) {
        if (!hud) return;
        const out = [];
        hud.clients.forEach((c, ci) => c.layers.forEach((l, ref) => {
            const o = l.opts, ws = [];
            hud.widgets.forEach((x) => { if (x.c === c && x.ref === ref) ws.push(x.w.id + ':' + x.w.type); });
            out.push({ ci, ref, kind: l.kind, x: o.x, y: o.y, w: o.w, h: o.h, iw: l.iw, ih: l.ih, klass: o.klass || 'content', z: o.z || 0,
                visible: o.visible !== false, time: !!o.time, time_fps: o.time_fps || 0, fs: l.kind === 'effect' ? o.fs : undefined,
                binds: Object.keys(l.binds), widgets: ws, format: o.format });
        }));
        fs.writeFileSync(path.join(DIR, label + '.layers.json'), JSON.stringify({ layout: hud.activeName, layers: out }, null, 1));
    }
    /** What one repaint of every text widget of the layout costs (drawText + the diff), forced. */
    function textCost(label) {
        if (!hud) return;
        const out = {};
        hud.widgets.forEach((x) => {
            if (x.w.type !== 'text') return;
            const t = now();
            for (let i = 0; i < 20; i++) { x.last = null; x.lastPaint = 0; x.px = null; hud._update(x, Date.now(), false); }   // whole repaint
            out[x.w.id] = { ms: +((now() - t) / 20).toFixed(3), w: x.w.w, h: x.w.h, rate: x.w.rate || 200, text: x.w.text };
        });
        fs.writeFileSync(path.join(DIR, label + '.textcost.json'), JSON.stringify(out, null, 1));
    }
    console.log('[perf] probe loaded in the app (PERF_DIR ' + DIR + ', ' + process.version + ', t0 ' + T0.toFixed(0) + ')');
}
