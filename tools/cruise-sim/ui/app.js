'use strict';
/**
 * app.js (SU1) - the page shell of the cruise simulator.
 *
 * Owns the `app` object of docs/cruise-sim/CONTRACT.md ("The page"): the config (kept in the URL),
 * the run (in the page or in ui/worker.js), the result (or a result file), the playback cursor,
 * presets, import / export. SU2's views (CS.charts, CS.settings, CS.batch, CS.reportView) mount into
 * #charts, #settings, #batch, #report; the scene (ui/scene.js) draws the frame at the cursor.
 *
 * The first half of this file is pure (no DOM) and is exported for the Node tests
 * (tests/app.test.js); boot() at the end runs only in a browser.
 */
(function () {
    /* ------------------------------------------------------------------ constants */

    const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
    /** core/*.js in dependency order: each file reads its siblings from self.CS when it loads. */
    const CORE_FILES = ['rng', 'schema', 'road', 'vehicles', 'plant', 'driver', 'command', 'failures',
        'sensor', 'estimator', 'controller', 'warning', 'baselines', 'metrics', 'scenario', 'mixed', 'sim'];
    /**
     * The scripts the page (and the worker, both in ui/) load, in order: core/*.js as sim.LOAD_ORDER (SC1) and, just
     * before core/scenario.js, ui/scenarios.bundle.js (SC3's catalogue as a script: file:// cannot fetch JSON;
     * made by `node tools/cruise-sim/core/scenario.js --bundle > tools/cruise-sim/ui/scenarios.bundle.js`).
     */
    function scriptList(order) {
        const out = [];
        (order || CORE_FILES).forEach((f) => { if (f === 'scenario') out.push('scenarios.bundle.js'); out.push('../core/' + f + '.js'); });
        return out;
    }
    /** SU2's views: [mount id, file, CS key]. */
    const VIEWS = [['charts', 'charts.js', 'charts'], ['settings', 'settings.js', 'settings'],
        ['batch', 'batch.js', 'batch'], ['report', 'report-view.js', 'reportView']];
    const VIEW_LABEL = { charts: 'Time charts', settings: 'Settings', batch: 'Batch views', report: 'Report' };

    /**
     * The config when nothing is set. Deliberately sparse: the engine fills every default (core/sim.js
     * defaultConfig, each module's SCHEMA), so the page never overrides a scenario's duration or a preset.
     * Links carry the difference to this fixed base, so they keep their meaning when engine defaults change.
     */
    const BASE_CONFIG = { version: 1, seed: 1 };

    /** Series shown as a step (sample and hold), not interpolated. */
    const DISCRETE = /^(lead\.id|meas\.(id|valid)|gap\.meas|vrel\.meas|est\.valid|warn|cruise\.state|set\.(cmd|held)|v\.driverMax|driver\.(brake|accel)|veh\..+\.lane)$/;
    const DEFAULT_ENUMS = { 'cruise.state': ['off', 'active', 'suspended', 'override', 'dropout'] };

    /* ------------------------------------------------------------------ config */

    const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && !ArrayBuffer.isView(x);

    function clone(x) {
        if (Array.isArray(x)) return x.map(clone);
        if (isObj(x)) { const o = {}; for (const k of Object.keys(x)) o[k] = clone(x[k]); return o; }
        return x;
    }

    /** a merged with b: objects recursively, arrays and scalars of b replace; undefined in b is skipped. */
    function deepMerge(a, b) {
        if (!isObj(b)) return b === undefined ? clone(a) : clone(b);
        const o = isObj(a) ? clone(a) : {};
        for (const k of Object.keys(b)) {
            if (b[k] === undefined) continue;
            o[k] = isObj(b[k]) && isObj(o[k]) ? deepMerge(o[k], b[k]) : clone(b[k]);
        }
        return o;
    }

    function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

    /** The smallest partial p with deepMerge(base, p) equal to cfg for every key of cfg (undefined = no difference). */
    function diffConfig(base, cfg) {
        if (!isObj(cfg) || !isObj(base)) return same(base, cfg) ? undefined : clone(cfg);
        let out;
        for (const k of Object.keys(cfg)) {
            const d = k in base ? diffConfig(base[k], cfg[k]) : clone(cfg[k]);
            if (d !== undefined && !(isObj(d) && isObj(base[k]) && Object.keys(d).length === 0)) (out = out || {})[k] = d;
        }
        return out;
    }

    /* ------------------------------------------------------------------ URL state */

    function b64urlEncode(str) {
        const bytes = new TextEncoder().encode(str);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function b64urlDecode(s) {
        s = String(s).replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        const bin = atob(s), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    }

    /** { config, t, view } -> 'c=<base64url JSON of the diff to base>&t=12.35&v=batch' (no leading '#'). */
    function encodeState(state, base) {
        const parts = [];
        const d = diffConfig(base || BASE_CONFIG, state.config || {});
        if (d && Object.keys(d).length) parts.push('c=' + b64urlEncode(JSON.stringify(d)));
        if (state.t != null && isFinite(state.t) && state.t > 0) parts.push('t=' + (Math.round(state.t * 100) / 100));
        if (state.view && state.view !== 'run') parts.push('v=' + encodeURIComponent(state.view));
        return parts.join('&');
    }

    /** The inverse of encodeState. A broken 'c' is reported in .error and ignored, never thrown. */
    function decodeState(hash, base) {
        const out = { config: clone(base || BASE_CONFIG), t: null, view: 'run', error: null };
        const s = String(hash || '').replace(/^#/, '');
        if (!s) return out;
        for (const kv of s.split('&')) {
            const i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
            if (k === 'c') {
                try {
                    const p = JSON.parse(b64urlDecode(v));
                    if (!isObj(p)) throw new Error('not an object');
                    out.config = deepMerge(out.config, p);
                } catch (e) { out.error = 'the link\'s config could not be read (' + e.message + ')'; }
            } else if (k === 't') { const t = parseFloat(v); if (isFinite(t)) out.t = t; }
            else if (k === 'v') out.view = decodeURIComponent(v) || 'run';
        }
        return out;
    }

    /* ------------------------------------------------------------------ results */

    function toF64(a) {
        if (a instanceof Float64Array) return a;
        const n = a.length, o = new Float64Array(n);
        for (let i = 0; i < n; i++) { const v = a[i]; o[i] = v === null || v === undefined || v === '' ? NaN : +v; }
        return o;
    }

    /** A run result from run() or from a JSON file (plain arrays, NaN as null) -> typed arrays. Throws if it is not one. */
    function normalizeResult(obj) {
        if (typeof obj === 'string') obj = JSON.parse(obj);
        if (!obj || !obj.t || !obj.series || typeof obj.series !== 'object') throw new Error('not a run result: needs t and series');
        const t = toF64(obj.t), series = {};
        for (const k of Object.keys(obj.series)) {
            const a = obj.series[k];
            if (!a || typeof a.length !== 'number') continue;
            series[k] = toF64(a);
            if (series[k].length !== t.length) throw new Error('series ' + k + ' has ' + series[k].length + ' samples, t has ' + t.length);
        }
        const events = Array.isArray(obj.events) ? obj.events.slice().sort((a, b) => a.t - b.t) : [];
        const meta = Object.assign({}, obj.meta || {});
        meta.plant = Object.assign({ name: 'unknown', assumed: true }, meta.plant || {});
        meta.enums = Object.assign({}, DEFAULT_ENUMS, meta.enums || {});
        return { meta, t, series, events, metrics: obj.metrics || {}, verdict: obj.verdict || null };
    }

    const roundTo = (v, k) => (v === v && isFinite(v) ? Math.round(v * k) / k : null);

    /** A result -> a JSON-safe object (typed arrays to arrays, NaN / Infinity to null). digits = decimals kept (default 4). */
    function serializeResult(r, digits) {
        const k = Math.pow(10, digits == null ? 4 : digits);
        const arr = (a) => Array.prototype.map.call(a, (v) => roundTo(v, k));
        const series = {};
        for (const n of Object.keys(r.series)) series[n] = arr(r.series[n]);
        const meta = Object.assign({}, r.meta);
        delete meta.source;
        return { kind: 'cs-result', meta, t: arr(r.t), series, events: r.events, metrics: r.metrics, verdict: r.verdict };
    }

    /** What a dropped / opened JSON file is. */
    function classifyFile(obj) {
        if (Array.isArray(obj)) return obj.length && obj[0] && obj[0].series ? 'batch' : 'unknown';
        if (!isObj(obj)) return 'unknown';
        if (obj.kind === 'cs-batch' || Array.isArray(obj.runs)) return 'batch';
        if (obj.t && obj.series) return 'result';
        if (obj.kind === 'cs-presets' || (isObj(obj.presets) && !obj.series)) return 'presets';
        if (obj.kind === 'cs-config' && isObj(obj.config)) return 'config';
        if ('scenario' in obj || 'plant' in obj || 'controller' in obj || 'seed' in obj || 'duration' in obj) return 'config';
        return 'unknown';
    }

    /** Largest i with t[i] <= x (0 when x is before the start). */
    function indexAt(t, x) {
        let lo = 0, hi = t.length - 1;
        if (hi < 0) return -1;
        if (x <= t[0]) return 0;
        if (x >= t[hi]) return hi;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m; else hi = m; }
        return lo;
    }

    /** Every series at time x: linear between samples, sample-and-hold for DISCRETE ones; NaN neighbours hold. */
    function sampleAt(r, x) {
        const t = r.t, i = indexAt(t, x), s = {};
        if (i < 0) return { t: x, i: -1, f: 0, s };
        const j = Math.min(t.length - 1, i + 1);
        const f = j > i && t[j] > t[i] ? Math.max(0, Math.min(1, (x - t[i]) / (t[j] - t[i]))) : 0;
        for (const n of Object.keys(r.series)) {
            const a = r.series[n], v0 = a[i], v1 = a[j];
            if (f === 0 || DISCRETE.test(n) || v0 !== v0 || v1 !== v1) s[n] = f >= 1 ? v1 : v0;
            else s[n] = v0 + (v1 - v0) * f;
        }
        return { t: x, i, f, s };
    }

    /** Intervals and lookups the scene needs, computed once per result. */
    function buildTimeline(r) {
        const faults = [], warns = [], open = {}, targets = [];
        let warnOpen = null, collision = null;
        const tEnd = r.t.length ? r.t[r.t.length - 1] : 0;
        for (const e of r.events) {
            const name = e.fault || e.name || e.what || 'fault';
            if (e.kind === 'fault.on') { if (!open[name]) open[name] = { name, t0: e.t, t1: null, detail: e }; }
            else if (e.kind === 'fault.off') { if (open[name]) { open[name].t1 = e.t; faults.push(open[name]); delete open[name]; } }
            else if (e.kind === 'warn.on') { if (!warnOpen) warnOpen = { t0: e.t, t1: null, reason: e.reason || '' }; }
            else if (e.kind === 'warn.off') { if (warnOpen) { warnOpen.t1 = e.t; warns.push(warnOpen); warnOpen = null; } }
            else if (e.kind === 'target.acquired' || e.kind === 'target.changed') targets.push({ t: e.t, id: e.id == null ? null : e.id });
            else if (e.kind === 'target.lost') targets.push({ t: e.t, id: null });
            else if (e.kind === 'collision' && !collision) collision = e;
        }
        for (const k of Object.keys(open)) { open[k].t1 = tEnd; faults.push(open[k]); }
        if (warnOpen) { warnOpen.t1 = tEnd; warns.push(warnOpen); }
        faults.sort((a, b) => a.t0 - b.t0);
        return {
            faults, warns, collision, targets, tEnd,
            faultsAt: (x) => faults.filter((f) => x >= f.t0 && x < f.t1),
            warnAt: (x) => warns.find((w) => x >= w.t0 && x < w.t1) || null,
            /** the target id from the last target.* event at or before x (undefined when there is none) */
            targetAt: (x) => { let id; for (const g of targets) { if (g.t > x) break; id = g.id; } return id; },
        };
    }

    const finite = (v) => typeof v === 'number' && v === v && isFinite(v);

    /** The scene's frame at time x: sampled series, the vehicles, the sensor's target, faults, recent events. */
    function frameAt(r, tl, x) {
        const smp = sampleAt(r, x), s = smp.s;
        const meta = r.meta || {};
        const vehicles = [];
        const enums = Object.assign({}, DEFAULT_ENUMS, meta.enums || {});
        // ids in series are numbers: indices into meta.enums.id when the engine names its vehicles (SC1), else the ids
        const idName = (v) => { if (!finite(v)) return null; const n = Array.isArray(enums.id) ? enums.id[Math.round(v)] : undefined; return n === undefined ? v : n; };
        const leadId = idName(s['lead.id']);
        const LW = (meta.road && meta.road.laneWidth) || (meta.params && meta.params.road && meta.params.road.laneWidth) || 3.5;
        const metaVeh = Array.isArray(meta.vehicles) ? meta.vehicles : [];
        const ids = metaVeh.length ? metaVeh.map((v) => v.id)
            : Array.from(new Set(Object.keys(r.series).map((n) => (n.match(/^veh\.([^.]+)\.x$/) || [])[1]).filter(Boolean)));
        for (const id of ids) {
            const m = metaVeh.find((v) => String(v.id) === String(id)) || {};
            const vx = s['veh.' + id + '.x'];
            if (!finite(vx)) continue;
            const vy = s['veh.' + id + '.y'];
            vehicles.push({
                id: typeof m.id === 'number' ? m.id : (isNaN(+id) ? id : +id), kind: m.kind || 'car',
                length: m.length || (m.kind === 'truck' ? 12 : m.kind === 'moto' ? 2.2 : 4.5), width: m.width || (m.kind === 'moto' ? 0.8 : 1.8),
                x: vx, v: s['veh.' + id + '.v'], a: s['veh.' + id + '.a'],
                lane: finite(vy) ? vy / LW : finite(s['veh.' + id + '.lane']) ? s['veh.' + id + '.lane'] : 0,
                lat: finite(vy) ? 0 : finite(s['veh.' + id + '.lat']) ? s['veh.' + id + '.lat'] : 0,
            });
        }
        const egoLen = (meta.ego && meta.ego.length) || 4.7;
        if (!vehicles.length) {                    // only lead.* and follower.* in the result
            if (finite(s['gap.true'])) {
                const len = 4.5;
                vehicles.push({ id: leadId == null ? 'lead' : leadId, kind: 'car', length: len, width: 1.8,
                    x: s['ego.x'] + s['gap.true'] + len, v: s['lead.v'], a: s['lead.a'], lane: 0, lat: 0 });
            }
            if (finite(s['follower.gap'])) vehicles.push({ id: 'follower', kind: 'car', length: 4.5, width: 1.8,
                x: s['ego.x'] - egoLen - s['follower.gap'], v: NaN, a: s['follower.a'], lane: 0, lat: 0 });
        }
        for (const v of vehicles) v.role = leadId != null && String(v.id) === String(leadId) ? 'lead' : (v.id === 'lead' ? 'lead' : 'other');
        const valid = finite(s['meas.valid']) ? s['meas.valid'] > 0.5 : finite(s['gap.meas']);
        let targetId = null;
        if (valid) {
            if (finite(s['meas.id'])) targetId = idName(s['meas.id']);
            else { const ev = tl.targetAt(x); targetId = ev === undefined ? leadId : ev; }
        }
        // the engine's own flag when it records one (SC2's meas._truth.wrong as a series), else the ids disagree
        const wrong = finite(s['meas.wrong']) ? valid && s['meas.wrong'] > 0.5
            : valid && targetId != null && (leadId == null || String(targetId) !== String(leadId));
        const recent = [];
        for (const e of r.events) { if (e.t > x) break; if (e.t > x - 3) recent.push(e); }
        const warnIv = tl.warnAt(x);
        const wr = s['warn.reason'];
        const warnReason = finite(wr) && Array.isArray(enums['warn.reason']) && enums['warn.reason'][Math.round(wr)] !== undefined
            ? String(enums['warn.reason'][Math.round(wr)]) : warnIv ? warnIv.reason : '';
        const cs = s['cruise.state'];
        const cruiseState = finite(cs) ? ((enums['cruise.state'] || [])[Math.round(cs)] || String(cs)) : null;
        return {
            t: x, i: smp.i, s, vehicles, leadId,
            ego: { x: s['ego.x'], v: s['ego.v'], a: s['ego.a'], length: egoLen, width: (meta.ego && meta.ego.width) || 1.8,
                lane: finite(s['ego.y']) ? s['ego.y'] / LW : finite(s['ego.lane']) ? s['ego.lane'] : (meta.ego && meta.ego.lane) || 0,
                lat: finite(s['ego.lat']) ? s['ego.lat'] : 0 },
            sensor: { valid, targetId, wrong, none: !valid },
            warn: finite(s.warn) ? s.warn > 0.5 : !!warnIv, warnReason,
            faults: tl.faultsAt(x), recent, cruiseState, appAlive: finite(s['app.alive']) ? s['app.alive'] > 0.5 : true,
            curvature: finite(s.curvature) ? s.curvature : 0,
            collision: tl.collision && tl.collision.t <= x ? tl.collision : null,
            plant: meta.plant || { name: '?', assumed: true }, fake: !!meta.fake,
        };
    }

    /* ------------------------------------------------------------------ playback */

    class Playback {
        constructor(t0, t1) { this.t0 = t0 || 0; this.t1 = t1 || 0; this.t = this.t0; this.playing = false; this.speedIx = SPEEDS.indexOf(1); this.loop = false; }
        get speed() { return SPEEDS[this.speedIx]; }
        setRange(t0, t1) { this.t0 = t0; this.t1 = Math.max(t0, t1); this.t = Math.min(this.t1, Math.max(this.t0, this.t)); }
        seek(t) { this.t = Math.min(this.t1, Math.max(this.t0, +t || 0)); return this.t; }
        setSpeed(x) {
            let best = 0;
            for (let i = 0; i < SPEEDS.length; i++) if (Math.abs(Math.log(SPEEDS[i] / x)) < Math.abs(Math.log(SPEEDS[best] / x))) best = i;
            this.speedIx = best; return this.speed;
        }
        faster() { this.speedIx = Math.min(SPEEDS.length - 1, this.speedIx + 1); return this.speed; }
        slower() { this.speedIx = Math.max(0, this.speedIx - 1); return this.speed; }
        play() { if (this.t >= this.t1) this.t = this.t0; this.playing = this.t1 > this.t0; return this.playing; }
        pause() { this.playing = false; }
        toggle() { return this.playing ? (this.pause(), false) : this.play(); }
        /** Wall-clock seconds elapsed -> new t. A frame gap over 0.25 s (a hidden tab) counts as 0.25 s. Stops at the end unless loop. */
        advance(realDt) {
            if (!this.playing) return this.t;
            this.t += Math.min(0.25, Math.max(0, realDt)) * this.speed;
            if (this.t >= this.t1) {
                if (this.loop && this.t1 > this.t0) this.t = this.t0 + (this.t - this.t1) % (this.t1 - this.t0);
                else { this.t = this.t1; this.playing = false; }
            }
            return this.t;
        }
        /** n samples of the time grid t (Float64Array) forward (+) or back (-), from the current sample. */
        step(tArr, n) {
            this.playing = false;
            if (!tArr || !tArr.length) return this.t;
            let i = indexAt(tArr, this.t + 1e-9);
            if (n < 0 && tArr[i] < this.t - 1e-9) i += 1;          // between samples: one back = the sample before
            i = Math.min(tArr.length - 1, Math.max(0, i + n));
            this.t = tArr[i];
            return this.t;
        }
    }

    /** Wall-clock ms a run of this config would take, from the last measured rate (ms per simulated second). */
    function estimateMs(config, msPerSimSecond) {
        const d = +(config && config.duration) || 60;
        return d * (msPerSimSecond > 0 ? msPerSimSecond : 2);
    }

    /** The cluster-preview hook (CONTRACT §4.1 optional): the sensor's samples as the cluster would see them. */
    function sensorSamples(r) {
        const out = [], s = r.series, g = s['gap.meas'], vr = s['vrel.meas'], va = s['meas.valid'], id = s['meas.id'], ev = s['ego.v'];
        if (!g) return out;
        for (let i = 0; i < r.t.length; i++) {
            const valid = va ? va[i] > 0.5 : g[i] === g[i];
            out.push({ t: r.t[i], valid, gap: valid ? g[i] : null, vrel: vr && valid ? vr[i] : null, id: id && valid && id[i] === id[i] ? id[i] : null, egoV: ev ? ev[i] : null });
        }
        return out;
    }

    const PURE = { SPEEDS, CORE_FILES, scriptList, VIEWS, BASE_CONFIG, DISCRETE, clone, deepMerge, diffConfig, b64urlEncode, b64urlDecode,
        encodeState, decodeState, normalizeResult, serializeResult, classifyFile, indexAt, sampleAt, buildTimeline, frameAt,
        Playback, estimateMs, sensorSamples };

    if (typeof module !== 'undefined' && module.exports) { module.exports = PURE; return; }
    const CS = self.CS = self.CS || {};
    CS.app = PURE;
    if (typeof document === 'undefined') return;

    /* ================================================================== browser */

    const $ = (sel) => document.querySelector(sel);
    const el = (tag, attrs, kids) => {
        const e = document.createElement(tag);
        for (const k of Object.keys(attrs || {})) {
            if (k === 'text') e.textContent = attrs[k];
            else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
            else e.setAttribute(k, attrs[k]);
        }
        (kids || []).forEach((c) => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
        return e;
    };
    const fmt = (v, d) => (finite(v) ? v.toFixed(d == null ? 1 : d) : '—');

    function loadScript(src) {
        return new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = src; s.async = false;
            s.onload = () => resolve(true);
            s.onerror = () => { s.remove(); resolve(false); };
            document.head.appendChild(s);
        });
    }

    function storage() { try { return window.localStorage; } catch (e) { return null; } }
    const PRESET_KEY = 'cruise-sim.presets.v1';
    function readPresets() { try { const s = storage(); return JSON.parse((s && s.getItem(PRESET_KEY)) || '{}') || {}; } catch (e) { return {}; } }
    function writePresets(p) { try { const s = storage(); if (s) s.setItem(PRESET_KEY, JSON.stringify(p)); return !!s; } catch (e) { return false; } }

    function download(name, obj) {
        const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
        const a = el('a', { href: URL.createObjectURL(blob), download: name });
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    /* ------------------------------------------------------------------ the app object */

    const listeners = {};
    const app = {
        config: clone(BASE_CONFIG),
        result: null, resultB: null, batch: null, cursorT: 0,
        view: 'run', engine: 'none', running: false, autoRun: true, runMode: 'auto',
        playback: new Playback(0, 0), timeline: null, msPerSimSecond: 0, version: 'su1-1',
        on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return () => app.off(evt, fn); },
        off(evt, fn) { const l = listeners[evt]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
        emit(evt, arg) { (listeners[evt] || []).slice().forEach((fn) => { try { fn(arg, app); } catch (e) { console.error('[cs] listener ' + evt, e); } }); },

        /** Merge a partial config (deep; arrays replace). opts.replace: the partial is the whole config. opts.run: true | false | 'auto'. */
        setConfig(partial, opts) {
            opts = opts || {};
            app.config = opts.replace ? deepMerge(BASE_CONFIG, partial || {}) : deepMerge(app.config, partial || {});
            app.emit('config', app.config);
            scheduleHash();
            const r = opts.run === undefined ? 'auto' : opts.run;
            if (r === true) app.run();
            else if (r === 'auto' && app.autoRun && app.isShort()) scheduleRun();
            return app.config;
        },
        /** Is a run of the current config short enough to follow every change at once (< 400 ms)? */
        isShort() { return estimateMs(app.config, app.msPerSimSecond) < 400; },
        run, cancel,
        /** Open a config (a matrix cell, a preset) in the scene: replace the config and run it. */
        openRun(config) { app.setConfig(config, { replace: true, run: false }); return app.run(); },
        loadResultFile(json, name) {
            const obj = typeof json === 'string' ? JSON.parse(json) : json;
            const kind = classifyFile(obj);
            if (kind === 'batch') { app.batch = obj; app.emit('batch', obj); status('Batch file loaded' + (name ? ': ' + name : '') + ' (' + ((obj.runs || obj).length) + ' runs).'); return 'batch'; }
            if (kind !== 'result') throw new Error('not a result file');
            const r = normalizeResult(obj);
            r.meta.source = 'file' + (name ? ': ' + name : '');
            if (r.meta.config && isObj(r.meta.config)) { app.config = deepMerge(BASE_CONFIG, r.meta.config); app.emit('config', app.config); scheduleHash(); }
            setResult(r);
            return 'result';
        },
        setResult: (r) => setResult(normalizeResult(r)),
        /** A second run for A / B overlays (SU2's charts); null clears it. */
        setCompare(r) { app.resultB = r ? normalizeResult(r) : null; app.emit('compare', app.resultB); },
        /** The engine's full default config (core/sim.js defaultConfig) or null; app.config holds only what differs. */
        defaults: null,
        seek(t) { app.setCursor(t); },
        setCursor(t, opts) {
            app.cursorT = app.playback.seek(t);
            if (!(opts && opts.keepPlaying)) app.playback.pause();
            cursorChanged();
        },
        play() { app.playback.play(); lastFrame = 0; updatePlayUi(); kick(); },
        pause() { app.playback.pause(); updatePlayUi(); scheduleHash(); },
        step(n) { app.cursorT = app.playback.step(app.result && app.result.t, n); cursorChanged(); },
        setSpeed(x) { app.playback.setSpeed(x); updatePlayUi(); },
        frame() { return app.result ? frameAt(app.result, app.timeline, app.cursorT) : null; },
        sensorSamples() { return app.result ? sensorSamples(app.result) : []; },
        showView(v) { showView(v); },
        exportConfig() { download('cruise-sim-config.json', { kind: 'cs-config', config: app.config }); },
        exportResult() { if (app.result) download('cruise-sim-result.json', serializeResult(app.result)); },
        presets: { list: () => readPresets(), save: savePreset, remove: deletePreset, apply: applyPreset },
        pure: PURE,
    };
    window.app = app;
    CS.appInstance = app;

    /* ------------------------------------------------------------------ running */

    let runToken = 0, pendingRun = null, runTimer = 0, worker = null, workerOk = null, workerJobs = {};

    function scheduleRun() { clearTimeout(runTimer); runTimer = setTimeout(() => app.run(), 250); }
    function cancel() { runToken++; app.running = false; pendingRun = null; progress(null); }

    function engineName() {
        if (CS.sim && typeof CS.sim.run === 'function') return 'core';
        if (CS.fakeResult) return 'fake';
        return 'none';
    }

    function run() {
        clearTimeout(runTimer);
        const cfg = clone(app.config), key = JSON.stringify(cfg);
        if (pendingRun && pendingRun.key === key) return pendingRun.promise;
        const token = ++runToken;
        app.running = true;
        const engine = engineName();
        app.engine = engine;
        const wantWorker = engine === 'core' && workerOk !== false &&
            (app.runMode === 'worker' || (app.runMode === 'auto' && !app.isShort()));
        status((engine === 'fake' ? 'Running the FAKE stand-in (core/sim.js is not loaded)' : 'Running') + (wantWorker ? ' in the worker…' : ' in the page…'));
        progress(0);
        const t0 = performance.now();
        const p = (wantWorker ? runWorker(cfg, token).catch((e) => { status('Worker unavailable (' + e.message + '); running in the page.'); workerOk = false; return runPage(cfg, token); })
            : runPage(cfg, token)).then((raw) => {
            if (token !== runToken) return null;
            const r = normalizeResult(raw);
            const ms = performance.now() - t0;
            r.meta.source = (engine === 'fake' ? 'FAKE stand-in' : 'core') + (wantWorker && workerOk !== false ? ' · worker' : ' · page');
            r.meta.wallMs = Math.round(ms);
            const d = +cfg.duration || (r.t.length ? r.t[r.t.length - 1] : 1);
            if (d > 0) app.msPerSimSecond = ms / d;
            app.running = false; pendingRun = null; progress(null);
            setResult(r);
            status('Run done in ' + Math.round(ms) + ' ms (' + r.meta.source + ').');
            return r;
        }).catch((e) => {
            if (token !== runToken) return null;
            app.running = false; pendingRun = null; progress(null);
            status('Run failed: ' + (e && e.message ? e.message : e), true);
            console.error(e);
            return null;
        });
        pendingRun = { key, promise: p };
        return p;
    }

    /** In the page: createSim in slices of ~12 ms per animation frame (a progress bar, no frozen tab), else run(). */
    function runPage(cfg, token) {
        if (engineName() === 'fake') return new Promise((res) => setTimeout(() => res(CS.fakeResult.makeFakeResult(cfg)), 0));
        if (engineName() === 'none') return Promise.reject(new Error('no engine: core/sim.js is not loaded and ui/fake-result.js is missing'));
        if (typeof CS.sim.createSim !== 'function') return new Promise((res, rej) => setTimeout(() => { try { res(CS.sim.run(cfg)); } catch (e) { rej(e); } }, 0));
        return new Promise((resolve, reject) => {
            let sim;
            try { sim = CS.sim.createSim(cfg); } catch (e) { reject(e); return; }
            const dur = +cfg.duration || 60;
            let lastT = -1, still = 0;
            const slice = () => {
                if (token !== runToken) { resolve(null); return; }
                try {
                    const until = performance.now() + 12;
                    while (!sim.done && performance.now() < until) sim.advance(0.5);
                    const st = sim.state && sim.state();
                    progress(st && finite(st.t) ? st.t / dur : null);
                    if (st && finite(st.t)) { still = st.t > lastT ? 0 : still + 1; lastT = st.t; }
                    if (still > 50) throw new Error('the engine stopped advancing at t = ' + lastT + ' s');
                    if (sim.done) resolve(sim.result()); else setTimeout(slice, 0);
                } catch (e) { reject(e); }
            };
            setTimeout(slice, 0);
        });
    }

    function getWorker() {
        if (worker) return worker;
        worker = new Worker('worker.js');            // throws under file:// in Chrome: the caller falls back to the page
        worker.onmessage = (ev) => {
            const m = ev.data || {}, job = workerJobs[m.id];
            if (m.type === 'progress') { if (job && job.token === runToken) progress(m.frac); return; }
            if (!job) return;
            delete workerJobs[m.id];
            if (m.type === 'result') { workerOk = true; job.resolve(m.result); }
            else job.reject(new Error(m.message || 'worker error'));
        };
        worker.onerror = (ev) => {
            ev.preventDefault && ev.preventDefault();
            workerOk = false;
            const jobs = workerJobs; workerJobs = {};
            Object.keys(jobs).forEach((k) => jobs[k].reject(new Error(ev.message || 'worker failed to load')));
            try { worker.terminate(); } catch (e) { /* gone */ }
            worker = null;
        };
        worker.postMessage({ type: 'init', files: scriptList(CS.sim && CS.sim.LOAD_ORDER) });
        return worker;
    }

    function runWorker(cfg, token) {
        return new Promise((resolve, reject) => {
            const w = getWorker();
            const id = token;
            workerJobs[id] = { resolve, reject, token };
            w.postMessage({ type: 'run', id, config: cfg });
        });
    }

    /* ------------------------------------------------------------------ result, cursor, frames */

    function setResult(r) {
        app.result = r;
        app.timeline = buildTimeline(r);
        const t0 = r.t.length ? r.t[0] : 0, t1 = r.t.length ? r.t[r.t.length - 1] : 0;
        app.playback.setRange(t0, t1);
        app.cursorT = app.playback.seek(pendingCursor != null ? pendingCursor : app.cursorT);
        pendingCursor = null;
        updateHeader(); updateScrubber(); updatePlayUi();
        app.emit('result', r);
        cursorChanged();
    }

    let lastFrame = 0, rafOn = false, pendingCursor = null;
    function cursorChanged() {
        updatePlayUi();
        app.emit('cursor', app.cursorT);
        drawScene();
        if (!app.playback.playing) scheduleHash();
    }
    function drawScene() {
        if (scene && app.result) { const fr = app.frame(); scene.draw(fr); app.emit('frame', fr); }
        else if (scene) scene.draw(null);
    }
    function kick() { if (!rafOn) { rafOn = true; requestAnimationFrame(tick); } }
    function tick(now) {
        rafOn = false;
        if (!app.playback.playing) { updatePlayUi(); scheduleHash(); return; }
        const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
        lastFrame = now;
        app.cursorT = app.playback.advance(dt);
        updatePlayUi();
        app.emit('cursor', app.cursorT);
        drawScene();
        kick();
    }

    /* ------------------------------------------------------------------ URL */

    let hashTimer = 0, lastHash = null;
    function scheduleHash() { clearTimeout(hashTimer); hashTimer = setTimeout(writeHash, 300); }
    function writeHash() {
        const h = encodeState({ config: app.config, t: app.cursorT, view: app.view });
        if (h === lastHash) return;
        lastHash = h;
        const url = location.href.split('#')[0] + (h ? '#' + h : '');
        try { history.replaceState(null, '', url); } catch (e) { try { location.replace(h ? '#' + h : '#'); } catch (e2) { /* no URL then */ } }
    }
    function readHash() {
        const st = decodeState(location.hash);
        lastHash = location.hash.replace(/^#/, '');
        if (st.error) status(st.error, true);
        return st;
    }

    /* ------------------------------------------------------------------ presets */

    function savePreset(name) {
        name = String(name || '').trim();
        if (!name) { status('A preset needs a name.', true); return false; }
        const p = readPresets(); p[name] = clone(app.config);
        const ok = writePresets(p);
        status(ok ? 'Preset "' + name + '" saved in this browser.' : 'This browser does not keep presets (storage blocked); use Export presets.', !ok);
        sessionPresets[name] = clone(app.config);
        fillPresetSelect(name);
        return ok;
    }
    const sessionPresets = {};
    function allPresets() { return Object.assign({}, sessionPresets, readPresets()); }
    function deletePreset(name) {
        const p = readPresets(); delete p[name]; delete sessionPresets[name]; writePresets(p);
        fillPresetSelect(''); status('Preset "' + name + '" deleted.');
    }
    function applyPreset(name) {
        const p = allPresets()[name];
        if (!p) return false;
        app.setConfig(p, { replace: true, run: true });
        status('Preset "' + name + '" applied.');
        return true;
    }
    function importPresets(obj) {
        const add = obj.presets || {};
        const p = readPresets();
        let n = 0;
        for (const k of Object.keys(add)) if (isObj(add[k])) { p[k] = add[k]; sessionPresets[k] = add[k]; n++; }
        writePresets(p); fillPresetSelect('');
        status(n + ' preset' + (n === 1 ? '' : 's') + ' imported.');
    }

    /* ------------------------------------------------------------------ files */

    function openFileObject(obj, name) {
        const kind = classifyFile(obj);
        if (kind === 'result' || kind === 'batch') { app.loadResultFile(obj, name); if (kind === 'batch') showView('batch'); return; }
        if (kind === 'presets') { importPresets(obj); return; }
        if (kind === 'config') { app.setConfig(obj.kind === 'cs-config' ? obj.config : obj, { replace: true, run: true }); status('Config loaded from ' + name + '.'); return; }
        status(name + ': not a config, preset, result or batch file.', true);
    }
    function readFile(file) {
        const fr = new FileReader();
        fr.onload = () => {
            try { openFileObject(JSON.parse(fr.result), file.name); }
            catch (e) { status(file.name + ': ' + e.message, true); }
        };
        fr.onerror = () => status(file.name + ': could not be read.', true);
        fr.readAsText(file);
    }

    /* ------------------------------------------------------------------ DOM */

    let scene = null;
    function status(msg, isErr) {
        const s = $('#status');
        if (s) { s.textContent = msg; s.classList.toggle('err', !!isErr); }
        if (isErr) console.warn('[cs] ' + msg);
    }
    function progress(frac) {
        const p = $('#progress');
        if (!p) return;
        if (frac == null) { p.hidden = true; return; }
        p.hidden = false;
        if (finite(frac)) p.value = Math.max(0, Math.min(1, frac)); else p.removeAttribute('value');
    }

    function updateHeader() {
        const r = app.result, plant = r ? r.meta.plant : { name: app.config.plant && app.config.plant.preset, assumed: !(app.config.plant && app.config.plant.file) };
        const pb = $('#plant-badge');
        pb.textContent = (plant.assumed !== false ? 'assumed plant: ' : 'identified plant: ') + (plant.name || '?');
        pb.className = 'badge ' + (plant.assumed !== false ? 'warn' : 'ok');
        const eb = $('#engine-badge');
        const eng = r && r.meta.fake ? 'fake' : engineName();
        const stubs = r && r.meta.modules ? Object.keys(r.meta.modules).filter((k) => /stub|none/.test(String(r.meta.modules[k]))) : [];
        eb.textContent = eng === 'core' ? 'engine: core/sim.js' + (stubs.length ? ' · stubs: ' + stubs.join(', ') : '')
            : eng === 'fake' ? 'FAKE result (SU1 stand-in, not the simulator)' : 'no engine';
        eb.title = stubs.length ? 'These modules are not in this build yet; the engine uses a stand-in for each.' : '';
        eb.className = 'badge ' + (eng === 'core' ? (stubs.length ? 'warn' : 'muted') : 'bad');
        const vb = $('#verdict-badge');
        if (r && r.verdict) {
            const failed = r.verdict.failed || [];
            const assumed = r.meta.plant.assumed !== false;
            vb.hidden = false;
            vb.textContent = assumed
                ? 'with an assumed plant: ' + (failed.length ? failed.length + ' threshold' + (failed.length > 1 ? 's' : '') + ' missed (' + failed.join(', ') + ')' : 'all thresholds met')
                : (r.verdict.pass ? 'pass' : 'fail: ' + failed.join(', '));
            vb.className = 'badge ' + (failed.length ? 'bad' : 'ok');
        } else vb.hidden = true;
        const src = $('#source');
        src.textContent = r ? (r.meta.scenario && (r.meta.scenario.name || r.meta.scenario.id) ? (r.meta.scenario.name || r.meta.scenario.id) + ' · ' : '') + (r.meta.source || '') : 'no run yet';
    }

    function updateScrubber() {
        const r = app.result, sc = $('#scrub'), marks = $('#scrub-marks');
        marks.textContent = '';
        if (!r || r.t.length < 2) { sc.disabled = true; return; }
        sc.disabled = false;
        sc.min = r.t[0]; sc.max = r.t[r.t.length - 1];
        sc.step = Math.max(0.001, r.t[1] - r.t[0]);
        const t0 = r.t[0], span = (r.t[r.t.length - 1] - t0) || 1;
        const put = (a, b, cls, title) => {
            const m = el('span', { class: 'mark ' + cls, title });
            m.style.left = (100 * (a - t0) / span) + '%';
            m.style.width = Math.max(0.4, 100 * (b - a) / span) + '%';
            marks.appendChild(m);
        };
        app.timeline.faults.forEach((f) => put(f.t0, f.t1, 'fault', 'fault: ' + f.name + ' ' + f.t0.toFixed(1) + '–' + f.t1.toFixed(1) + ' s'));
        app.timeline.warns.forEach((w) => put(w.t0, w.t1, 'warn', 'warning (' + (w.reason || '?') + ') ' + w.t0.toFixed(1) + '–' + w.t1.toFixed(1) + ' s'));
        if (app.timeline.collision) put(app.timeline.collision.t, app.timeline.collision.t, 'collision', 'collision at ' + app.timeline.collision.t.toFixed(2) + ' s');
    }

    function updatePlayUi() {
        const pb = app.playback;
        const btn = $('#play');
        if (!btn) return;
        btn.textContent = pb.playing ? '❚❚' : '▶';
        btn.title = pb.playing ? 'Pause (space)' : 'Play (space)';
        $('#speed').value = String(pb.speed);
        const sc = $('#scrub');
        if (document.activeElement !== sc || pb.playing) sc.value = app.cursorT;
        $('#time').textContent = fmt(app.cursorT, 2) + ' / ' + fmt(pb.t1, 1) + ' s';
    }

    function fillPresetSelect(selected) {
        const s = $('#preset');
        s.textContent = '';
        s.appendChild(el('option', { value: '', text: 'Presets…' }));
        const p = allPresets();
        Object.keys(p).sort().forEach((k) => { const o = el('option', { value: k, text: k }); if (k === selected) o.selected = true; s.appendChild(o); });
    }

    function showView(v) {
        if (!['run', 'batch', 'report'].includes(v)) v = 'run';
        app.view = v;
        document.querySelectorAll('[data-view]').forEach((n) => { n.hidden = n.getAttribute('data-view') !== v; });
        document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === v)));
        app.emit('view', v);
        if (v === 'run') { if (scene) scene.resize(); drawScene(); }
        scheduleHash();
    }

    function placeholder(id, file) {
        const host = document.getElementById(id);
        host.textContent = '';
        host.appendChild(el('div', { class: 'placeholder' }, [
            el('strong', { text: VIEW_LABEL[id] }),
            el('span', { text: ' — not loaded: ui/' + file + ' (SU2) is not in this build yet. The shell keeps this slot for it.' }),
        ]));
    }

    async function mountViews() {
        for (const [id, file, key] of VIEWS) {
            const host = document.getElementById(id);
            placeholder(id, file);
            const ok = await loadScript(file);
            const mod = CS[key];
            if (ok && mod && typeof mod.mount === 'function') {
                host.textContent = '';
                try { mod.mount(host, app); }
                catch (e) { console.error(e); placeholder(id, file); host.querySelector('.placeholder span').textContent = ' — ui/' + file + ' failed to mount: ' + e.message; }
            }
        }
        // the optional cluster preview (CONTRACT / brief §4.1): only the hook — a module CS.clusterPreview = { mount(el, app) }
        if (CS.clusterPreview && typeof CS.clusterPreview.mount === 'function') {
            const host = $('#cluster-preview'); host.hidden = false; CS.clusterPreview.mount(host, app);
        }
    }

    function bindUi() {
        $('#run').addEventListener('click', () => app.run());
        $('#autorun').addEventListener('change', (e) => { app.autoRun = e.target.checked; });
        $('#runmode').addEventListener('change', (e) => { app.runMode = e.target.value; });
        $('#play').addEventListener('click', () => (app.playback.playing ? app.pause() : app.play()));
        $('#back').addEventListener('click', () => app.step(-1));
        $('#fwd').addEventListener('click', () => app.step(1));
        $('#start').addEventListener('click', () => app.setCursor(app.playback.t0));
        $('#end').addEventListener('click', () => app.setCursor(app.playback.t1));
        $('#speed').addEventListener('change', (e) => app.setSpeed(+e.target.value));
        $('#scrub').addEventListener('input', (e) => app.setCursor(+e.target.value));
        $('#loop').addEventListener('change', (e) => { app.playback.loop = e.target.checked; });
        $('#zoom').addEventListener('change', (e) => { if (scene) { scene.setZoom(e.target.value); drawScene(); } });
        $('#export-config').addEventListener('click', () => app.exportConfig());
        $('#keep-b').addEventListener('click', () => {
            if (!app.result) return;
            app.setCompare(app.result);
            status('This run is kept as B; the charts overlay it on the next runs.');
        });
        $('#clear-b').addEventListener('click', () => { app.setCompare(null); status('B dropped.'); });
        app.on('compare', (b) => { $('#clear-b').hidden = !b; });
        $('#save-result').addEventListener('click', () => app.exportResult());
        $('#open').addEventListener('click', () => $('#file').click());
        $('#file').addEventListener('change', (e) => { Array.from(e.target.files || []).forEach(readFile); e.target.value = ''; });
        $('#copy-link').addEventListener('click', () => {
            writeHash();
            const url = location.href;
            const done = () => status('Link copied: the config' + (app.cursorT > 0 ? ' and the cursor' : '') + ' are in it.');
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy the link:', url));
            else window.prompt('Copy the link:', url);
        });
        $('#preset').addEventListener('change', (e) => { if (e.target.value) applyPreset(e.target.value); });
        $('#preset-save').addEventListener('click', () => { savePreset($('#preset-name').value); $('#preset-name').value = ''; });
        $('#preset-del').addEventListener('click', () => { const n = $('#preset').value; if (n) deletePreset(n); });
        $('#preset-export').addEventListener('click', () => download('cruise-sim-presets.json', { kind: 'cs-presets', presets: allPresets() }));
        $('#theme').addEventListener('change', (e) => {
            const v = e.target.value;
            if (v === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v);
            try { storage().setItem('cruise-sim.theme', v); } catch (err) { /* per-viewer only */ }
            drawScene(); app.emit('view', app.view);
        });
        document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.getAttribute('data-tab'))));
        // drag and drop anywhere
        document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drop'); });
        document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drop'); });
        document.addEventListener('drop', (e) => {
            e.preventDefault(); document.body.classList.remove('drop');
            Array.from((e.dataTransfer && e.dataTransfer.files) || []).forEach(readFile);
        });
        document.addEventListener('keydown', (e) => {
            const tag = (e.target && e.target.tagName) || '';
            const k = e.key;
            // in a field the keys are the field's (the scrubber moves itself on arrows); only space on the scrubber plays
            if (/INPUT|SELECT|TEXTAREA/.test(tag) && !(e.target.id === 'scrub' && k === ' ')) return;
            if (tag === 'BUTTON' && (k === ' ' || k === 'Enter')) return;      // the button's own click
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (k === ' ') { e.preventDefault(); app.playback.playing ? app.pause() : app.play(); }
            else if (k === 'ArrowRight') { e.preventDefault(); app.step(e.shiftKey ? 10 : 1); }
            else if (k === 'ArrowLeft') { e.preventDefault(); app.step(e.shiftKey ? -10 : -1); }
            else if (k === ']') { app.playback.faster(); updatePlayUi(); }
            else if (k === '[') { app.playback.slower(); updatePlayUi(); }
            else if (k === 'Home') { app.setCursor(app.playback.t0); }
            else if (k === 'End') { app.setCursor(app.playback.t1); }
            else if (k === 'r' || k === 'R') { app.run(); }
        });
        window.addEventListener('hashchange', () => {
            const h = location.hash.replace(/^#/, '');
            if (h === lastHash) return;
            const st = readHash();
            app.setConfig(st.config, { replace: true, run: true });
            if (st.t != null) pendingCursor = st.t;
            showView(st.view);
        });
        const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
        if (mq && mq.addEventListener) mq.addEventListener('change', () => drawScene());
    }

    async function boot() {
        try { const th = storage() && storage().getItem('cruise-sim.theme'); if (th && th !== 'auto') { document.documentElement.setAttribute('data-theme', th); $('#theme').value = th; } } catch (e) { /* default */ }
        $('#speed').textContent = '';
        SPEEDS.forEach((s) => $('#speed').appendChild(el('option', { value: String(s), text: '×' + s })));
        bindUi();
        fillPresetSelect('');
        const st = readHash();
        app.config = st.config;
        pendingCursor = st.t;
        status('Loading the engine…');
        let loaded = 0;
        for (const f of scriptList()) if (await loadScript(f)) loaded++;
        // core files the engine lists beyond ours (sim.LOAD_ORDER, SC1) come after
        const extra = CS.sim && Array.isArray(CS.sim.LOAD_ORDER) ? CS.sim.LOAD_ORDER.filter((f) => CORE_FILES.indexOf(f) < 0) : [];
        for (const f of extra) if (await loadScript('../core/' + f + '.js')) loaded++;
        if (!(CS.sim && CS.sim.run)) await loadScript('fake-result.js');
        app.engine = engineName();
        try { app.defaults = CS.sim && typeof CS.sim.defaultConfig === 'function' ? CS.sim.defaultConfig() : null; } catch (e) { app.defaults = null; }
        if (CS.scene && CS.scene.createScene) {
            scene = CS.scene.createScene($('#scene'), app);
            window.addEventListener('resize', () => { scene.resize(); drawScene(); });
        }
        updateHeader();
        await mountViews();
        app.emit('config', app.config);
        showView(st.view);
        status(app.engine === 'core' ? 'Engine loaded (' + loaded + ' core files).'
            : app.engine === 'fake' ? 'core/sim.js not found: the page runs SU1\'s FAKE stand-in (ui/fake-result.js). Open a result file to see a real run.'
                : 'No engine found.', app.engine !== 'core');
        if (app.engine !== 'none') app.run();
        else drawScene();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
