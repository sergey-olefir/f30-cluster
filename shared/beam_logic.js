'use strict';
/**
 * beam_logic.js - *** STAND-IN *** for the Auto Beam switching algorithm (round "Auto Beam", package HD).
 *
 * The real module is package HA's (branch beam/ha), written to docs/highbeam/CONTRACT.md. This file exists only so that the
 * app (apps/auto_beam) runs and is tested in its own branch. It has the CONTRACT's interface (section 1) and its shapes
 * (sections 2, 3, 6), so the lead swaps it at the merge by taking HA's file whole; nothing in the app changes. The app's
 * suite (bench/test-auto-beam.js) has also been run against HA's module (docs/highbeam/HD-REPORT.md says with which result).
 *
 *   const B = require('./beam_logic');  const inst = B.create(config);  const out = B.guard(inst, frame);  inst.reset();
 *   B.DEFAULTS  B.SCHEMA  B.STATES  B.STATE_KEYS  B.PRESETS  B.mergePartial  B.REASONS  B.failOutput  B.guard  B.VERSION
 *
 * A deliberately small rule set in advise mode (the only mode it implements; 'auto' is treated as advise): fail-safes
 * (nodata, camera), the standby conditions (lights_off, slow, daylight, weather, town), the triggers from the light stream or,
 * when it is silent, the fallback object list (oncoming, preceding, cyclist, light, streetlights, camera_verdict), the return
 * (holdUntil, curve, settle, flicker) and clear. HA's module is the tuned one. Pure: no I/O, no timers, no Date. Node 8.16.
 */
(function () {
    const STATES = ['UNAVAILABLE', 'STANDBY', 'HIGH', 'DIPPED', 'OVERRIDE'];
    const STATE_KEYS = {};
    STATES.forEach((s) => { STATE_KEYS[s] = 'beam.state.' + s.toLowerCase(); });
    const R_STATE = {
        clear: 'HIGH', settle: 'DIPPED', oncoming: 'DIPPED', preceding: 'DIPPED', cyclist: 'DIPPED', light: 'DIPPED', streetlights: 'DIPPED',
        curve: 'DIPPED', camera_verdict: 'DIPPED', flicker: 'DIPPED', town: 'STANDBY', slow: 'STANDBY', daylight: 'STANDBY', weather: 'STANDBY',
        lights_off: 'STANDBY', camera: 'UNAVAILABLE', nodata: 'UNAVAILABLE', error: 'UNAVAILABLE', driver: 'OVERRIDE',
    };
    const REASONS = {};
    Object.keys(R_STATE).forEach((k) => { REASONS[k] = { states: [R_STATE[k]], key: 'beam.reason.' + k }; });

    const DEFAULTS = {
        mode: 'advise',
        stale: { lights_ms: 600, object_ms: 400, verdict_ms: 1500, objects_ms: 600, car_ms: 1000, lamps_ms: 0, env_ms: 0 },
        scale: { x: { center: 127, gain: 0.2 }, y: { center: 127, gain: -0.1 }, w: { gain: 0.02 }, h: { gain: 0.02 }, dist: { gain: 4, offset: 0, max: 500 },
            ang: { center: 127, gain: 0.25 }, none: { x: 255, dist: 127, cls: 15, id: 15, status: 7 } },
        classes: { 0: 'other', 1: 'head', 2: 'tail', 3: 'street', 4: 'reflector', 5: 'bike' },
        status: { strong: [2, 3], weak: [1], none: [0, 7] },
        objects: { use: 'off', qualOk: [0], qualReduced: [1], reducedMeans: 'camera', oncomingMargin_kmh: 10 },
        objScale: { x: { gain: 1, offset: 0 }, y: { gain: 1, offset: 0 }, vx: { gain: 1, offset: 0 } },
        objClasses: { 1: 'car', 2: 'truck', 3: 'moto', 4: 'bike', 5: 'ped' },
        zone: { head_m: 400, headSide_m: 80, tail_m: 200, tailSide_m: 80, bike_m: 100, other_m: 200, core_deg: 4, edge_deg: 18, returnMargin: 1.3, noDist: 'in', reflector: 'ignore' },
        confirm: { weakFrames: 1, strongFrames: 0, jump_deg: 3, jumpFrac: 0.35 },
        street: { window_ms: 4000, count: 3, minEl_deg: 2 },
        dark: { on_lux: 20, off_lux: 60, onHold_ms: 8000, offHold_ms: 2000, useSun: 'agree' },
        brightness: { gain: 1, offset: 0 },
        speed: { on_kmh: 50, off_kmh: 38 },
        town: { signs: true, limit_kmh: 60, limitHold_ms: 3000, clear_ms: 3000, maxNoEvidence_ms: 300000 },
        weather: { wiperLow: 3, wiperClear_ms: 20000, fog: true },
        curve: { yaw_dps: 6, steer_deg: 60, mode: 'delay', hold_ms: 1500 },
        verdict: { use: 'log', allow: [1], deny: [0], calibBad: [1, 2], qualBad: [2] },
        timing: { clearHead_ms: 1500, clearTail_ms: 2500, clearBike_ms: 2000, clearOther_ms: 1500, clearStreet_ms: 1500, clearVerdict_ms: 2000, enter_ms: 0,
            minLow_ms: 2000, flickerWindow_ms: 30000, flickerDips: 3, flickerExtra_ms: 3000, maxPerMin: 8, rateHold_ms: 20000, unavailableHold_ms: 1000 },
        override: { resume: 'dip', lowHold_ms: 0, highMax_ms: 0, flashMax_ms: 600 },
    };
    const PRESETS = {
        early: { zone: { head_m: 500, tail_m: 250, bike_m: 120, other_m: 250, edge_deg: 22 }, timing: { clearHead_ms: 2500, clearTail_ms: 3500, minLow_ms: 3000 } },
        normal: {},
        late: { zone: { head_m: 300, tail_m: 150, bike_m: 80, other_m: 150, edge_deg: 15 }, timing: { clearHead_ms: 1000, clearTail_ms: 2000, minLow_ms: 1500 } },
    };

    const isNum = (x) => typeof x === 'number' && isFinite(x);
    const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    const inList = (a, x) => Array.isArray(a) && a.indexOf(x) >= 0;
    const copy = (x) => JSON.parse(JSON.stringify(x));

    /** b over a, group by group (one level deep, as the contract's merge). */
    function mergePartial(a, b) {
        const out = copy(isObj(a) ? a : {});
        Object.keys(isObj(b) ? b : {}).forEach((k) => {
            if (isObj(b[k]) && isObj(out[k])) Object.keys(b[k]).forEach((j) => { out[k][j] = isObj(b[k][j]) && isObj(out[k][j]) ? Object.assign({}, out[k][j], b[k][j]) : copy(b[k][j]); });
            else out[k] = copy(b[k]);
        });
        return out;
    }
    /** The defaults' leaves as schema rows (the stand-in marks them all assumed; HA's SCHEMA carries the real sources). */
    const SCHEMA = [];
    (function rows(o, p) { Object.keys(o).forEach((k) => { const v = o[k], key = p ? p + '.' + k : k; if (isObj(v) && !/^(classes|objClasses)$/.test(key)) rows(v, key); else SCHEMA.push({ key, def: v, assumed: true, source: 'stand-in' }); }); })(DEFAULTS, '');

    /** Merge a partial config: a value whose type differs from the default's is replaced (listed in errs). */
    function mergeConfig(p, errs) {
        const out = mergePartial(DEFAULTS, p);
        SCHEMA.forEach((r) => {
            const path = r.key.split('.');
            let o = out;
            for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
            const v = o[path[path.length - 1]];
            const okType = typeof r.def === 'number' ? isNum(v) : Array.isArray(r.def) ? Array.isArray(v) : typeof v === typeof r.def;
            if (!okType) { errs.push(r.key + ': ' + JSON.stringify(v) + ' -> ' + JSON.stringify(r.def)); o[path[path.length - 1]] = copy(r.def); }
        });
        return out;
    }

    function failOutput(t, reason) {
        const r = REASONS[reason] ? reason : 'error';
        return { t: isNum(t) ? t : null, want: 'low', state: 'UNAVAILABLE', reason: r, cause: null, since: isNum(t) ? t : null, holdUntil: null, confidence: 1, switched: false, details: { stale: [], lights: [], fail: true } };
    }
    function guard(inst, frame) {
        try {
            const out = inst.step(frame);
            if (!out || (out.want !== 'high' && out.want !== 'low')) return failOutput(frame && frame.t, 'error');
            return out;
        } catch (e) { return failOutput(isObj(frame) ? frame.t : null, 'error'); }
    }

    const ORDER = ['error', 'nodata', 'camera', 'lights_off', 'slow', 'daylight', 'weather', 'town', 'driver', 'flicker', 'camera_verdict', 'oncoming', 'cyclist', 'preceding', 'light', 'streetlights', 'curve', 'settle', 'clear'];
    const KIND_REASON = { head: 'oncoming', tail: 'preceding', bike: 'cyclist', other: 'light' };
    const KIND_CLEAR = { head: 'clearHead_ms', tail: 'clearTail_ms', bike: 'clearBike_ms', other: 'clearOther_ms' };

    function create(config) {
        const configErrors = [];
        const cfg = mergeConfig(config, configErrors);
        let S;
        function reset() {
            S = { state: 'UNAVAILABLE', reason: 'nodata', want: 'low', since: null, dark: false, darkAt: null, lightAt: null, speedOk: false, wiperAt: null,
                urban: { on: false, src: null, since: null, lastEv: null }, signT: null, limVal: null, limSince: null,
                lowSince: null, lastKind: null, lastTrigAt: null, dips: [], changes: [], rateUntil: null, streets: [], curveAt: null };
        }
        reset();
        const fresh = (g, ms) => !!(g && isObj(g) && g.ok && isNum(g.age) && (ms === 0 || g.age <= ms));

        function readLight(o) {
            if (!isObj(o)) return null;
            const sc = cfg.scale;
            if (isNum(o.age) && cfg.stale.object_ms > 0 && o.age > cfg.stale.object_ms) return null;
            if (isNum(o.status) && inList(cfg.status.none, o.status)) return null;
            if (o.x === sc.none.x && (o.cls === sc.none.cls || o.id === sc.none.id)) return null;
            let kind = isNum(o.cls) ? cfg.classes[String(o.cls)] : undefined;
            if (['head', 'tail', 'street', 'reflector', 'bike', 'other'].indexOf(kind) < 0) kind = 'other';
            const az = isNum(o.x) && o.x !== sc.none.x ? (o.x - sc.x.center) * sc.x.gain : null;
            const el = isNum(o.y) && o.y !== 255 ? (o.y - sc.y.center) * sc.y.gain : null;
            let dist = null, far = false;
            if (isNum(o.dist) && o.dist !== sc.none.dist) {
                dist = o.dist * sc.dist.gain + sc.dist.offset;
                if (dist < 0) dist = null; else if (dist >= sc.dist.max) { dist = sc.dist.max; far = true; }      // the top of the scale: far
            }
            return { id: isNum(o.id) ? o.id : -1, kind, strong: isNum(o.status) && inList(cfg.status.strong, o.status), az_deg: az, el_deg: el, dist_m: dist, far, src: 'light' };
        }
        function readObject(o, speed) {
            if (!isObj(o) || !isNum(o.x)) return null;
            if (o.move === 'stationary' && o.head !== 'on' && o.rear !== 'on') return null;           // a parked car
            const s = cfg.objScale, x = o.x * s.x.gain + s.x.offset, y = isNum(o.y) ? o.y * s.y.gain + s.y.offset : 0;
            const vx = isNum(o.vx) ? o.vx * s.vx.gain + s.vx.offset : null;
            if (!(x > 0)) return null;
            let ok = isNum(o.cls) ? cfg.objClasses[String(o.cls)] : undefined;
            if (['car', 'truck', 'moto', 'bike', 'ped'].indexOf(ok) < 0) ok = 'other';
            if (ok === 'ped') return null;
            let kind;
            if (ok === 'bike') kind = 'bike';
            else if (o.move === 'oncoming' || o.move === 'stopped_oncoming') kind = 'head';
            else if (o.move === 'same') kind = 'tail';
            else if (vx !== null) kind = -vx * 3.6 > speed + cfg.objects.oncomingMargin_kmh ? 'head' : 'tail';
            else if (o.head === 'on') kind = 'head';
            else kind = 'other';
            return { id: isNum(o.id) ? o.id : -1, kind, strong: true, az_deg: -Math.atan2(y, x) * 180 / Math.PI, el_deg: null, dist_m: x, src: 'object' };
        }
        function zoneLen(kind, az) {
            const z = cfg.zone;
            const full = kind === 'head' ? z.head_m : kind === 'tail' ? z.tail_m : kind === 'bike' ? z.bike_m : z.other_m;
            const side = kind === 'head' ? z.headSide_m : kind === 'tail' ? z.tailSide_m : full * 0.5;
            const a = Math.abs(az || 0);
            if (a > z.edge_deg) return 0;
            if (a <= z.core_deg) return full;
            return full + (side - full) * (a - z.core_deg) / Math.max(0.001, z.edge_deg - z.core_deg);
        }

        function out(t, state, reason, extra) {
            const e = extra || {};
            const want = state === 'HIGH' ? 'high' : 'low';
            const switched = want !== S.want;
            if (switched) { S.changes.push(t); if (want === 'low') { S.dips.push(t); S.lowSince = t; } }
            if (state !== S.state || reason !== S.reason || S.since === null) S.since = t;
            S.state = state; S.reason = reason; S.want = want;
            return { t, want, state, reason, cause: e.cause || null, since: S.since, holdUntil: isNum(e.holdUntil) ? e.holdUntil : null,
                confidence: state === 'HIGH' ? 0.9 : state === 'DIPPED' ? (e.cause ? 1 : 0.5) : 1, switched,
                details: Object.assign({ mode: 'advise', stale: [], lights: [], counts: {}, street: 0, switchesPerMin: S.changes.length, dips: S.dips.length, override: null, verdict: null, driver: null }, e.details || {}) };
        }

        function step(frame) {
            if (!isObj(frame) || !isNum(frame.t)) return failOutput(isObj(frame) ? frame.t : null, 'nodata');
            const t = frame.t, st = cfg.stale;
            S.changes = S.changes.filter((x) => t - x <= 60000);
            S.dips = S.dips.filter((x) => t - x <= cfg.timing.flickerWindow_ms);
            const stale = [];
            const lamps = isObj(frame.lamps) && isObj(frame.lamps.v) ? frame.lamps.v : {};
            const car = fresh(frame.car, st.car_ms) && isObj(frame.car.v) ? frame.car.v : null;
            const env = isObj(frame.env) && isObj(frame.env.v) ? frame.env.v : {};
            const driver = lamps.high === true ? 'high' : lamps.high === false ? 'low' : null;
            const base = { stale, driver, lowBeam: lamps.low === true };
            const lightsLive = fresh(frame.lights, st.lights_ms) && Array.isArray(frame.lights.v);
            const objLive = cfg.objects.use !== 'off' && fresh(frame.objects, st.objects_ms) && Array.isArray(frame.objects.v);
            if (!lightsLive) stale.push('lights');
            if (!car) stale.push('car');
            const speed = car && isNum(car.speed_kmh) ? car.speed_kmh : null;
            // the sources: the light stream; the object list only while it is silent (fallback) or always (both)
            let src = null, list = [];
            if (lightsLive) { src = 'light'; list = frame.lights.v.map(readLight).filter(Boolean); }
            if (objLive && (cfg.objects.use === 'both' || !lightsLive)) { src = src || 'object'; list = list.concat(frame.objects.v.map((o) => readObject(o, speed || 0)).filter(Boolean)); }
            const V = frame.verdict && fresh(frame.verdict, st.verdict_ms) && isObj(frame.verdict.v) ? frame.verdict.v : null;
            const vAllow = V ? (inList(cfg.verdict.allow, V.allow) ? true : inList(cfg.verdict.deny, V.allow) ? false : null) : null;
            const verdict = V ? { allow: vAllow, use: cfg.verdict.use, agrees: null } : null;
            const det = (x) => Object.assign({}, base, { verdict }, x || {});
            if (!src || speed === null) return out(t, 'UNAVAILABLE', 'nodata', { details: det() });
            if (V && cfg.verdict.use !== 'ignore' && inList(cfg.verdict.calibBad, V.calibration)) return out(t, 'UNAVAILABLE', 'camera', { details: det() });
            if (src === 'object' && isNum(frame.objects.qual) && !inList(cfg.objects.qualOk, frame.objects.qual) && !(inList(cfg.objects.qualReduced, frame.objects.qual) && cfg.objects.reducedMeans === 'ok')) return out(t, 'UNAVAILABLE', 'camera', { details: det() });
            // the interpreted lights (nearest first) with their zones
            const low = S.want === 'low';
            list.forEach((l) => { const len = zoneLen(l.kind, l.az_deg) * (low ? cfg.zone.returnMargin : 1); l.inZone = l.kind !== 'street' && l.kind !== 'reflector' && !l.far && (l.dist_m === null ? cfg.zone.noDist === 'in' : l.dist_m <= len); });
            list.sort((a, b) => (a.dist_m === null ? 1e9 : a.dist_m) - (b.dist_m === null ? 1e9 : b.dist_m));
            const counts = { head: 0, tail: 0, street: 0, reflector: 0, bike: 0, other: 0 };
            list.forEach((l) => { counts[l.kind]++; });
            list.filter((l) => l.kind === 'street' && (l.el_deg === null || l.el_deg >= cfg.street.minEl_deg)).forEach((l) => S.streets.push([t, l.id]));
            S.streets = S.streets.filter((s) => t - s[0] <= cfg.street.window_ms);
            const streetN = S.streets.map((s) => s[1]).filter((x, i, a) => a.indexOf(x) === i).length;
            const D = (x) => det(Object.assign({ lights: list, counts, street: streetN, src }, x || {}));
            // the built-up area, kept on every tick (a sign seen while slow still counts) (CONTRACT 7a, simplified): a town-entry sign, a low limit standing, a flag
            const U = S.urban;
            if (cfg.town.signs && frame.signs && Array.isArray(frame.signs.v)) frame.signs.v.forEach((e) => {
                if (!isObj(e) || (isNum(e.t) && S.signT !== null && e.t <= S.signT)) return;
                if (isNum(e.t)) S.signT = e.t;
                if (e.kind === 'town_in') { U.on = true; U.src = 'sign'; U.since = t; U.lastEv = t; } else if (e.kind === 'town_out') { U.on = false; U.src = null; }
            });
            const lim = isNum(env.limit_kmh) ? env.limit_kmh : null;
            if (lim !== S.limVal) { S.limVal = lim; S.limSince = t; }
            const limLow = lim !== null && lim <= cfg.town.limit_kmh && t - S.limSince >= cfg.town.limitHold_ms;
            if (env.urban === true || limLow) { if (!U.on) { U.on = true; U.src = env.urban === true ? 'flag' : 'limit'; U.since = t; } U.lastEv = t; }
            if (U.on && U.src !== 'sign' && t - U.lastEv >= cfg.town.clear_ms) { U.on = false; U.src = null; }
            if (U.on && U.src === 'sign' && ((lim !== null && lim > cfg.town.limit_kmh && S.limSince > U.since) || t - U.lastEv >= cfg.town.maxNoEvidence_ms)) { U.on = false; U.src = null; }
            base.urban = { on: U.on, src: U.src, since: U.since, evidence_ms: U.lastEv === null ? null : t - U.lastEv };
            // standby
            if (lamps.low !== true) return out(t, 'STANDBY', 'lights_off', { details: D() });
            S.speedOk = S.speedOk ? speed >= cfg.speed.off_kmh : speed >= cfg.speed.on_kmh;
            if (!S.speedOk || car.gear === 'P' || car.gear === 'R') return out(t, 'STANDBY', 'slow', { details: D({ speedOk: false }) });
            const lux = isNum(env.brightness) ? env.brightness * cfg.brightness.gain + cfg.brightness.offset : null;
            if (lux !== null) {
                if (lux < cfg.dark.on_lux) { if (S.darkAt === null) S.darkAt = t; S.lightAt = null; } else if (lux > cfg.dark.off_lux) { if (S.lightAt === null) S.lightAt = t; S.darkAt = null; }
                if (S.darkAt !== null && t - S.darkAt >= cfg.dark.onHold_ms) S.dark = true;
                if (S.lightAt !== null && t - S.lightAt >= cfg.dark.offHold_ms) S.dark = false;
                if (cfg.dark.useSun === 'agree' && env.sun === 'day') S.dark = false;
            } else S.dark = cfg.dark.useSun !== 'off' && (env.sun || env.dayNight) === 'night';
            if (!S.dark) return out(t, 'STANDBY', 'daylight', { details: D({ dark: false }) });
            if (isNum(env.wiper) && env.wiper >= cfg.weather.wiperLow) S.wiperAt = t;
            if ((cfg.weather.fog && lamps.fog === true) || (S.wiperAt !== null && t - S.wiperAt < cfg.weather.wiperClear_ms)) return out(t, 'STANDBY', 'weather', { details: D({ weather: true }) });
            if (U.on) return out(t, 'STANDBY', 'town', { details: D({ town: true }) });
            // the triggers, by precedence
            let trig = null, cause = null;
            if (V && cfg.verdict.use === 'follow' && vAllow === false) { trig = 'camera_verdict'; cause = { src: 'verdict', id: null, kind: null, dist_m: null, az_deg: null }; }
            ['head', 'bike', 'tail', 'other'].forEach((k) => {
                if (trig) return;
                const l = list.filter((x) => x.kind === k && x.inZone)[0];
                if (l) { trig = KIND_REASON[k]; cause = { src: l.src, id: l.id, kind: l.kind, dist_m: l.dist_m, az_deg: l.az_deg }; }
            });
            if (!trig && streetN >= cfg.street.count) trig = 'streetlights';
            const yaw = isNum(car.yaw_dps) ? Math.abs(car.yaw_dps) : 0;
            const curve = cfg.curve.mode !== 'off' && (yaw >= cfg.curve.yaw_dps || (isNum(car.steer_deg) && Math.abs(car.steer_deg) >= cfg.curve.steer_deg));
            if (curve) S.curveAt = t;
            if (trig) {
                S.lastKind = cause && cause.kind ? cause.kind : trig === 'streetlights' ? 'street' : 'verdict'; S.lastTrigAt = t; S.lastReason = trig;
                return out(t, 'DIPPED', trig, { cause, details: D({ curve }) });
            }
            if (cfg.curve.mode === 'dip' && curve) return out(t, 'DIPPED', 'curve', { details: D({ curve }) });
            // the return to high
            if (S.changes.length >= cfg.timing.maxPerMin && (S.rateUntil === null || S.rateUntil < t)) S.rateUntil = t + cfg.timing.rateHold_ms;
            if (low && S.state !== 'UNAVAILABLE' && S.state !== 'STANDBY') {
                const cl = S.lastKind === 'street' ? cfg.timing.clearStreet_ms : S.lastKind === 'verdict' ? cfg.timing.clearVerdict_ms : cfg.timing[KIND_CLEAR[S.lastKind] || 'clearOther_ms'];
                let until = S.lastTrigAt !== null ? S.lastTrigAt + cl : t;
                const flicker = S.dips.length >= cfg.timing.flickerDips;
                if (flicker) until += cfg.timing.flickerExtra_ms;
                until = Math.max(until, (S.lowSince || t) + cfg.timing.minLow_ms);
                if (S.rateUntil !== null && S.rateUntil > t) until = Math.max(until, S.rateUntil);
                if (S.curveAt !== null && cfg.curve.mode === 'delay') until = Math.max(until, S.curveAt + cfg.curve.hold_ms);
                if (t < until) return out(t, 'DIPPED', curve ? 'curve' : flicker ? 'flicker' : S.lastReason || 'settle', { holdUntil: until, details: D({ curve }) });
            } else if (low) {
                // from standby / unavailable: a short settle before high (timing.enter_ms)
                if (S.enterAt === undefined || S.enterAt === null) S.enterAt = t;
                if (t - S.enterAt < cfg.timing.enter_ms) return out(t, 'DIPPED', 'settle', { holdUntil: S.enterAt + cfg.timing.enter_ms, details: D() });
            }
            S.enterAt = null;
            if (verdict) verdict.agrees = vAllow === null ? null : vAllow === true;
            return out(t, 'HIGH', 'clear', { details: D({ dark: true, speedOk: true }) });
        }

        return { step, reset, config: cfg, configErrors, standIn: true };
    }

    const API = { create, DEFAULTS, SCHEMA, STATES, STATE_KEYS, PRESETS, mergePartial, REASONS, failOutput, guard, VERSION: 1, STAND_IN: true };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
