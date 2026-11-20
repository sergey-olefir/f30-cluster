'use strict';
/**
 * contract.js - THE ONE ADAPTER between Auto Beam and the switching algorithm (round "Auto Beam", package HD), written to
 * docs/highbeam/CONTRACT.md (HA, 2026-11-20; version 1). This is the only file of the app that knows the input frame (section
 * 2), the output (section 3), the reason codes and the state names (section 6). shared/beam_logic.js is a STAND-IN in this
 * branch with the contract's interface; the lead swaps in HA's module at the merge and nothing here changes.
 *
 *   frameOf(snap, opt)        the inputs snapshot (inputs.js snap()) -> the contract's frame: { t, lights, verdict, objects,
 *                             car, lamps, stalk, env, signs, app }, every group { v, age, ok } (+ qual); a source never seen is a
 *                             missing group. Raw numbers stay raw; the adapter never scales (the scales are the config's).
 *   new Decider(cfg, log)     the algorithm with the app's config and the sensitivity preset; .step(frame) -> normal(); an
 *                             exception (or no algorithm) = B.failOutput / want low, logged once; the loop keeps going
 *   normal(out, frame)        -> { want, state, reason, reasonKey, cause, since, holdUntil, confidence, lights (interpreted,
 *                             nearest first), src 'light' | 'object' | null, verdict, driver, town (details.urban.src while in a
 *                             town: 'sign' | 'limit' | 'lights' | 'flag'), fault }: anything unknown -> low
 *   REASON_KEY(code)          a reason code -> its word key (an unknown code -> beam.reason.unknown, CONTRACT section 6)
 *   STATE_KEY                 state -> its word key
 *
 * Plain Node 8.16; nothing here throws.
 */
function req(name) {
    try { return require('./' + name); } catch (e) {
        try { return require('../../shared/' + name); } catch (e2) { return null; }
    }
}
const B = req('beam_logic');

const STATES = ['UNAVAILABLE', 'STANDBY', 'HIGH', 'DIPPED', 'OVERRIDE'];
const REASONS = ['clear', 'settle', 'oncoming', 'preceding', 'cyclist', 'light', 'streetlights', 'curve', 'camera_verdict', 'flicker',
    'town', 'slow', 'daylight', 'weather', 'lights_off', 'camera', 'nodata', 'error', 'driver'];
const TRIGGERS = ['oncoming', 'preceding', 'cyclist', 'light', 'streetlights', 'camera_verdict'];
const REASON_KEY = (code) => (REASONS.indexOf(code) >= 0 ? 'beam.reason.' + code : 'beam.reason.unknown');
const STATE_KEY = {};
STATES.forEach((s) => { STATE_KEY[s] = 'beam.state.' + s.toLowerCase(); });

const fin = (x) => typeof x === 'number' && isFinite(x);

/** One group: { v, age, ok } (+ qual), or undefined when the source was never seen (a missing group). */
function group(v, at, t, ok, qual) {
    if (at === null || at === undefined) return undefined;
    const g = { v: v === undefined ? null : v, age: Math.max(0, t - at), ok: ok !== false && v !== null && v !== undefined };
    if (qual !== undefined && qual !== null) g.qual = qual;
    return g;
}
const latest = function () { let a = null; for (let i = 0; i < arguments.length; i++) { const x = arguments[i]; if (fin(x) && (a === null || x > a)) a = x; } return a; };

/** The inputs snapshot (inputs.js) -> the contract's input frame. */
function frameOf(snap, opt) {
    const s = snap || {}, o = opt || {};
    const t = fin(s.t) ? s.t : 0;
    const g = (k) => s[k] || { v: null, at: null };
    const f = { t, stalk: { v: (s.stalk || []).slice(), age: 0, ok: true }, app: { v: { rearm: false } } };
    const l = g('lights');
    const lg = group(l.v || [], l.at, t);
    if (lg) f.lights = lg;
    const vd = group(g('verdict').v, g('verdict').at, t);
    if (vd) f.verdict = vd;
    const ob = g('objects');
    const og = group(ob.v || [], ob.at, t, true, ob.qual);
    if (og) f.objects = og;
    const sp = g('speed'), yw = g('yaw');
    const carAt = sp.at;
    if (carAt !== null) f.car = { v: { speed_kmh: fin(sp.v) ? sp.v : null, yaw_dps: fin(yw.v) && yw.at !== null && t - yw.at <= (o.yawStaleMs || 2000) ? yw.v : null, steer_deg: null, gear: null }, age: Math.max(0, t - carAt), ok: fin(sp.v) };
    const lo = g('low'), hi = g('high'), fo = g('fog');
    const lampsAt = latest(lo.at, hi.at, fo.at);
    if (lampsAt !== null) f.lamps = { v: { low: lo.v === true ? true : lo.v === false ? false : null, high: hi.v === true ? true : hi.v === false ? false : null, fog: fo.v === true ? true : fo.v === false ? false : null, switch: null }, age: Math.max(0, t - lampsAt), ok: true };
    const br = g('bright'), su = g('sun'), dn = g('dayNight'), wp = g('wiper'), li = g('limit'), ur = g('urban');
    const envAt = latest(br.at, su.at, dn.at, wp.at, li.at, ur.at);
    if (envAt !== null) {
        const limStale = li.at !== null && o.limitStaleMs && t - li.at > o.limitStaleMs;
        // the car's own day / night beats a computed sunset (o.carFirst, the default): with it known, sun is left null and the
        // contract's rule "dayNight is used like sun when sun is null" applies
        const carDn = dn.v === 'day' || dn.v === 'night';
        f.env = { v: { brightness: fin(br.v) ? br.v : null, sun: (su.v === 'day' || su.v === 'night') && !(carDn && o.carFirst !== false) ? su.v : null, wiper: fin(wp.v) ? wp.v : null, limit_kmh: fin(li.v) && !limStale ? li.v : null, urban: ur.v === true ? true : ur.v === false ? false : null,
            dayNight: dn.v === 'day' || dn.v === 'night' ? dn.v : null }, age: Math.max(0, t - envAt), ok: true };
    }
    const sg = s.signs;
    if (sg && sg.at !== null && sg.at !== undefined) f.signs = { v: (sg.v || []).slice(), age: Math.max(0, t - sg.at), ok: true };
    return f;
}

/** The source the decision rests on this tick, as the adapter sees it (the table says it). */
function sourceOf(frame, staleMs) {
    const fresh = (gr, ms) => !!(gr && gr.ok && fin(gr.age) && gr.age <= ms);
    if (fresh(frame && frame.lights, staleMs.lights)) return 'light';
    if (fresh(frame && frame.objects, staleMs.objects)) return 'object';
    return null;
}

/** The algorithm's output, checked: anything unknown falls to low. */
function normal(o, frame, staleMs) {
    const out = o && typeof o === 'object' ? o : {};
    const t = frame && fin(frame.t) ? frame.t : 0;
    const state = STATES.indexOf(out.state) >= 0 ? out.state : 'UNAVAILABLE';
    const reason = typeof out.reason === 'string' && out.reason ? out.reason : 'error';
    let want = out.want === 'high' ? 'high' : 'low';
    if (state === 'UNAVAILABLE' || state === 'STANDBY') want = 'low';
    const d = out.details && typeof out.details === 'object' ? out.details : {};
    const c = out.cause && typeof out.cause === 'object' ? out.cause : null;
    const lights = (Array.isArray(d.lights) ? d.lights : []).filter((l) => l && typeof l === 'object').slice(0, 40).map((l) => ({
        id: l.id, kind: typeof l.kind === 'string' ? l.kind : 'other', az_deg: fin(l.az_deg) ? l.az_deg : null, el_deg: fin(l.el_deg) ? l.el_deg : null,
        dist_m: fin(l.dist_m) ? l.dist_m : null, strong: !!l.strong, inZone: !!l.inZone, src: l.src === 'object' ? 'object' : 'light',
        cause: !!(c && c.id !== null && c.id !== undefined && c.id === l.id && (!c.src || !l.src || c.src === l.src)),
    }));
    return {
        want, state, reason, reasonKey: REASON_KEY(reason), trigger: TRIGGERS.indexOf(reason) >= 0,
        cause: c ? { src: c.src || null, id: c.id === undefined ? null : c.id, kind: c.kind || null, dist_m: fin(c.dist_m) ? c.dist_m : null } : null,
        since: fin(out.since) ? out.since : t, holdUntil: fin(out.holdUntil) ? out.holdUntil : null,
        confidence: fin(out.confidence) ? out.confidence : 0, lights,
        src: d.src === 'light' || d.src === 'object' ? d.src : sourceOf(frame, staleMs || { lights: 1000, objects: 1000 }),
        verdict: d.verdict && typeof d.verdict === 'object' ? d.verdict : null, driver: d.driver === 'high' || d.driver === 'low' ? d.driver : null,
        stale: Array.isArray(d.stale) ? d.stale.slice() : [], fault: !!d.fail,
        town: d.urban && typeof d.urban === 'object' && d.urban.on ? (typeof d.urban.src === 'string' ? d.urban.src : 'unknown') : null,
    };
}

/**
 * The decision loop's guard. cfg: the app's partial config (config.algo); preset: 'early' | 'normal' | 'late' (the
 * sensitivity, B.PRESETS merged over cfg); staleMs: the adapter's own view of the sources' freshness (the table's source row).
 */
function Decider(cfg, log, preset, staleMs) {
    this.log = log || { info() {}, warn() {}, error() {} };
    this.errors = 0;
    this.logged = {};
    this.staleMs = staleMs || { lights: 1000, objects: 1000 };
    this.standIn = !!(B && B.STAND_IN);
    let c = cfg || {};
    try { if (B && B.PRESETS && B.PRESETS[preset] && typeof B.mergePartial === 'function') c = B.mergePartial(c, B.PRESETS[preset]); } catch (e) { this._once('preset', e); }
    try { this.algo = B ? B.create(c) : null; } catch (e) { this.algo = null; this._once('create', e); }
    if (!this.algo) this._once('missing', 'no algorithm (shared/beam_logic.js): advising low');
    this.configErrors = this.algo && Array.isArray(this.algo.configErrors) ? this.algo.configErrors.slice() : [];
}
Decider.prototype._once = function (kind, e) {
    this.errors++;
    if (this.logged[kind]) return;
    this.logged[kind] = true;
    this.log.error('beam: algorithm ' + kind + ': ' + (e && e.stack || e) + ' -> advising low');
};
Decider.prototype.step = function (frame) {
    const t = frame && fin(frame.t) ? frame.t : 0;
    const fail = (why) => normal(B && typeof B.failOutput === 'function' ? B.failOutput(t, why) : { want: 'low', state: 'UNAVAILABLE', reason: why, details: { fail: true } }, frame, this.staleMs);
    if (!this.algo) return fail('error');
    let o;
    try {
        o = this.algo.step(frame);
        if (!o || (o.want !== 'high' && o.want !== 'low')) { this._once('output', 'an output without want'); return fail('error'); }
    } catch (e) {
        this._once('step', e);
        return fail('error');
    }
    if (o.details && o.details.fail && o.reason === 'error') this.errors++;
    return normal(o, frame, this.staleMs);
};
Decider.prototype.reset = function () { try { if (this.algo) this.algo.reset(); } catch (e) { this._once('reset', e); } };

module.exports = { frameOf, normal, sourceOf, Decider, group, STATES, REASONS, TRIGGERS, REASON_KEY, STATE_KEY, standIn: () => !!(B && B.STAND_IN), algorithm: () => B };
