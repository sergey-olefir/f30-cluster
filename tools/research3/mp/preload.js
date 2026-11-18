'use strict';
/**
 * Research round 3, package MP (docs/research3/MP-REPORT.md): the app-side half of tools/research3/mp/measure.js.
 * Loaded into the APP process only (measure.js forks bench/run-app.js with NODE_OPTIONS="--require <this file>" and
 * MP_PRELOAD=1); nothing in the app requires it and it is never shipped.
 *
 * It records, from outside the app's code (prototype wraps after the modules load):
 *  - JS wall time of the engine's heavy steps: _rebuildInner (a layout build), _scene (a baked texture: pack inflate,
 *    JSON parse, base64 decode, copy into the client), _atlas / _exactAtlas (glyph atlases), _createSheet, _tick and
 *    the needle timer;
 *  - event-loop lag (a 5 ms timer: how late it fires; a rebuild blocks the loop for its whole length);
 *  - process CPU time, rss and heap.
 * On the IPC message { t: 'mp', cmd: 'take', n } it answers { t: 'mp', n, stats, widgets } and starts a new window;
 * widgets maps each layer (connection index : ref) to the widget ids on it, and each glyph / scene / exact atlas key to
 * its asset ref, so measure.js can name what it recorded on the socket.
 */
const Module = require('module');

if (process.env.MP_PRELOAD === '1' && /run-app\.js$/.test(process.argv[1] || '')) start();

function start() {
    const now = () => { const t = process.hrtime(); return t[0] * 1e3 + t[1] / 1e6; };
    let hud = null;
    let S = fresh();
    function fresh() { return { t0: now(), cpu0: process.cpuUsage(), fn: {}, lagMax: 0, lagOver50: 0, lagN: 0, rebuilds: [], scenes: [] }; }

    function wrap(P, name, label, after) {
        const orig = P[name];
        if (typeof orig !== 'function' || orig.__mp) return;
        const f = function () {
            const t = now();
            try { return orig.apply(this, arguments); } finally {
                const dt = now() - t;
                const r = S.fn[label] || (S.fn[label] = { n: 0, ms: 0, max: 0 });
                r.n++; r.ms += dt; if (dt > r.max) r.max = dt;
                if (after) { try { after.call(this, dt, arguments); } catch (e) { /* never in the app's way */ } }
            }
        };
        f.__mp = true;
        P[name] = f;
    }

    function patchHud(H) {
        const P = H.prototype;
        if (P.__mpDone) return;
        P.__mpDone = true;
        // a marker on every open connection at the start of each build, so the recorder knows which build each message
        // belongs to (the sockets' messages interleave in any order); bench only: the real service would refuse the op
        const inner = P._rebuildInner;
        let builds = 0;
        P._rebuildInner = function () {
            const n = ++builds;
            try { this.clients.forEach((c) => { if (c.sock && c.connected) c._send({ op: 'mp-mark', n }); }); } catch (e) { /* never in the way */ }
            return inner.apply(this, arguments);
        };
        wrap(P, '_rebuildInner', 'rebuild', function (dt) {
            hud = this;
            S.rebuilds.push({ at: +(now() - S.t0).toFixed(1), ms: +dt.toFixed(2), layout: this.activeName, layers: this._layerRefs().length });
        });
        wrap(P, '_scene', 'scene texture load', function (dt, a) { S.scenes.push({ name: a[0], ci: a[1], ms: +dt.toFixed(2) }); });
        wrap(P, '_atlas', 'glyph atlas');
        wrap(P, '_exactAtlas', 'exact atlas');
        wrap(P, '_createSheet', 'sheet create');
        wrap(P, '_tick', 'tick', function () { hud = this; });
        wrap(P, '_needleTick', 'needle timer');
        wrap(P, '_twinPush', 'twin plate push');
    }

    const load = Module._load;
    Module._load = function (req) {
        const m = load.apply(this, arguments);
        try { if (req === './hud' && typeof m === 'function') patchHud(m); } catch (e) { console.warn('[mp] patch: ' + e); }
        return m;
    };

    let due = now() + 5;
    setInterval(() => {
        const t = now(), lag = t - due;
        due = t + 5;
        S.lagN++;
        if (lag > S.lagMax) S.lagMax = lag;
        if (lag > 50) S.lagOver50++;
    }, 5).unref();

    function widgets() {
        const out = { layers: {}, atlases: {} };
        if (!hud) return out;
        try {
            hud.widgets.forEach((x) => {
                const k = x.ci + ':' + x.ref;
                const e = out.layers[k] || (out.layers[k] = { ids: [], types: {} });
                e.ids.push(x.w.id);
                e.types[x.w.type] = (e.types[x.w.type] || 0) + 1;
                if (x.sheet) e.sheet = true;
            });
            hud.atlases.forEach((a, key) => { out.atlases[key] = { ci: a.ci, ref: a.ref, bytes: a.bytes }; });
            out.active = hud.activeName;
            out.pixelBytes = hud.pixelBytes;
        } catch (e) { out.error = String(e && e.message || e); }
        return out;
    }

    process.on('message', (m) => {
        if (!m || m.t !== 'mp') return;
        if (m.cmd === 'take') {
            const cpu = process.cpuUsage(S.cpu0), mem = process.memoryUsage();
            const stats = { ms: +(now() - S.t0).toFixed(1), cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1), fn: S.fn,
                lagMax: +S.lagMax.toFixed(1), lagOver50: S.lagOver50, rebuilds: S.rebuilds, scenes: S.scenes,
                rssMB: +(mem.rss / 1048576).toFixed(1), heapMB: +(mem.heapUsed / 1048576).toFixed(1) };
            const w = widgets();
            S = fresh();
            if (process.connected) process.send({ t: 'mp', n: m.n, stats, widgets: w });
        }
    });
}
