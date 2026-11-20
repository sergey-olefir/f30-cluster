'use strict';
/**
 * beam_logic.js - Auto Beam's switching algorithm (round "Auto Beam", package HA): from one input frame per tick to the
 * advice "high" or "low", with the state, the reason and the object that caused it. The contract is
 * docs/highbeam/CONTRACT.md (a copy: tools/beam-sim/CONTRACT.md); the reasoning and the sources of every default are in
 * docs/highbeam/HA-REPORT.md.
 *
 * PURE: no I/O, no timers, no clock, no randomness, no globals; the same file runs in the app, the simulator and the
 * tests. Plain Node 8.16 syntax (the car's): no ?. / ?? / object spread / Array.prototype.flat. It never switches a lamp:
 * it returns an advice, and nothing in this round turns the advice into a lamp.
 *
 *   const B = require('./beam_logic');
 *   const inst = B.create(config);      // config: partial, merged over B.DEFAULTS; bad values -> defaults (inst.configErrors)
 *   const out = B.guard(inst, frame);   // = inst.step(frame) inside a try/catch; any error -> B.failOutput(t, 'error')
 *   inst.reset();
 *
 * Fails towards low beam: stale or missing data, an unknown enum value, a NaN, a camera that says blind or not
 * calibrated, an exception: all give want 'low'.
 *
 * States: UNAVAILABLE (inputs missing or bad) / STANDBY (conditions for high beam not met) / HIGH / DIPPED (conditions
 * met but something is ahead, or the return is still counting) / OVERRIDE (auto mode: the driver decided).
 */

const VERSION = 1;
const STATES = ['UNAVAILABLE', 'STANDBY', 'HIGH', 'DIPPED', 'OVERRIDE'];

/** The reason codes in precedence order (the first that holds wins) with the state each belongs to. */
const REASON_TABLE = [
    ['error', 'UNAVAILABLE'], ['nodata', 'UNAVAILABLE'], ['camera', 'UNAVAILABLE'],
    ['lights_off', 'STANDBY'], ['slow', 'STANDBY'], ['daylight', 'STANDBY'], ['weather', 'STANDBY'], ['town', 'STANDBY'],
    ['driver', 'OVERRIDE'],
    ['flicker', 'DIPPED'], ['camera_verdict', 'DIPPED'], ['oncoming', 'DIPPED'], ['cyclist', 'DIPPED'],
    ['preceding', 'DIPPED'], ['light', 'DIPPED'], ['streetlights', 'DIPPED'], ['curve', 'DIPPED'], ['settle', 'DIPPED'],
    ['clear', 'HIGH'],
];
const REASON_ORDER = REASON_TABLE.map((r) => r[0]);
const REASONS = {};
REASON_TABLE.forEach((r) => { REASONS[r[0]] = { state: r[1], states: [r[1]], key: 'beam.reason.' + r[0], rank: REASON_ORDER.indexOf(r[0]) }; });
const STATE_KEYS = {};
STATES.forEach((s) => { STATE_KEYS[s] = 'beam.state.' + s.toLowerCase(); });

const LIGHT_KINDS = ['head', 'tail', 'street', 'reflector', 'bike', 'other'];
const OBJ_KINDS = ['car', 'truck', 'moto', 'bike', 'ped', 'other'];
/** Which reason a light of each kind gives, and which clear-time key ends it. */
const KIND_REASON = { head: 'oncoming', tail: 'preceding', bike: 'cyclist', other: 'light', reflector: 'light' };
const CLEAR_KEY = {
    oncoming: 'clearHead_ms', preceding: 'clearTail_ms', cyclist: 'clearBike_ms', light: 'clearOther_ms',
    streetlights: 'clearStreet_ms', camera_verdict: 'clearVerdict_ms',
};

// ---------------------------------------------------------------------------------------------------------------------
// The config: one SCHEMA row per key. src: 'catalogue' (the SOME/IP catalogue's types and defaults), 'research'
// (a public source, named in help), 'assumption' (nobody has measured it), 'tuning' (chosen on the simulator's library).
// `assumed` = the car has not confirmed it. DEFAULTS is built from this table.
// ---------------------------------------------------------------------------------------------------------------------
const A = true;    // assumed
const SCHEMA = [
    // key, type, default, unit, min, max, step, assumed, src, help
    ['mode', 'enum', 'advise', '', null, null, null, false, 'brief', 'advise: the driver owns the lamps, stalk = label; auto: want is the beam, the stalk overrides', ['advise', 'auto']],

    ['stale.lights_ms', 'num', 600, 'ms', 100, 5000, 50, A, 'assumption', 'the light stream is stale after this (camera rate unknown; 0 = never stale)'],
    ['stale.object_ms', 'num', 400, 'ms', 50, 5000, 50, A, 'assumption', 'one light object older than this is dropped'],
    ['stale.verdict_ms', 'num', 1500, 'ms', 0, 10000, 100, A, 'assumption', 'the camera verdict is stale after this'],
    ['stale.objects_ms', 'num', 600, 'ms', 0, 5000, 50, A, 'assumption', 'the fallback object list is stale after this'],
    ['stale.car_ms', 'num', 1000, 'ms', 100, 10000, 100, A, 'assumption', 'speed / yaw are stale after this'],
    ['stale.lamps_ms', 'num', 0, 'ms', 0, 600000, 1000, A, 'assumption', 'lamp states: 0 = never stale (LowBeam is notified on change)'],
    ['stale.env_ms', 'num', 0, 'ms', 0, 600000, 1000, A, 'assumption', 'brightness / wipers / limit: 0 = never stale (notified on change)'],

    ['scale.x.center', 'num', 127, 'raw', 0, 255, 1, A, 'assumption', 'XPosition at the image centre'],
    ['scale.x.gain', 'num', 0.2, 'deg/raw', -2, 2, 0.01, A, 'assumption', 'azimuth per raw step, + = right (0..254 -> -25..+25 deg, a 50 deg camera)'],
    ['scale.y.center', 'num', 127, 'raw', 0, 255, 1, A, 'assumption', 'YPosition at the horizon'],
    ['scale.y.gain', 'num', -0.1, 'deg/raw', -2, 2, 0.01, A, 'assumption', 'elevation per raw step, + = up (image rows grow downward)'],
    ['scale.w.gain', 'num', 0.02, 'deg/raw', 0, 1, 0.005, A, 'assumption', 'angular width per raw step'],
    ['scale.h.gain', 'num', 0.02, 'deg/raw', 0, 1, 0.005, A, 'assumption', 'angular height per raw step'],
    ['scale.dist.gain', 'num', 4, 'm/raw', 0.1, 50, 0.1, A, 'assumption', 'Distance is 7 bits (0..126): 4 m/step reaches 504 m'],
    ['scale.dist.offset', 'num', 0, 'm', -100, 100, 1, A, 'assumption', 'distance offset'],
    ['scale.dist.max', 'num', 500, 'm', 50, 2000, 10, A, 'assumption', 'a distance at or beyond this is "far" (clipped here, outside every zone)'],
    ['scale.ang.center', 'num', 127, 'raw', 0, 255, 1, A, 'assumption', 'AngularSpeed at zero'],
    ['scale.ang.gain', 'num', 0.25, 'deg/s/raw', -5, 5, 0.05, A, 'assumption', 'angular speed per raw step, + = moving right'],
    ['scale.none.x', 'num', 255, 'raw', 0, 65535, 1, false, 'catalogue', 'XPosition default = no object'],
    ['scale.none.dist', 'num', 127, 'raw', 0, 65535, 1, false, 'catalogue', 'Distance default = no value'],
    ['scale.none.cls', 'num', 15, 'raw', 0, 255, 1, false, 'catalogue', 'Class default'],
    ['scale.none.id', 'num', 15, 'raw', 0, 255, 1, false, 'catalogue', 'Id default'],
    ['scale.none.status', 'num', 7, 'raw', 0, 255, 1, false, 'catalogue', 'Status default'],

    ['classes', 'map', { '1': 'head', '2': 'tail', '3': 'street', '4': 'reflector', '5': 'bike', '0': 'other' }, '', null, null, null, A, 'assumption', 'raw Class -> kind; unknown raw -> other', LIGHT_KINDS],
    ['status.strong', 'list', [2, 3], '', null, null, null, A, 'assumption', 'raw Status values of a confirmed track'],
    ['status.weak', 'list', [1], '', null, null, null, A, 'assumption', 'raw Status values of a new / uncertain track; unknown raw -> weak'],
    ['status.none', 'list', [0, 7], '', null, null, null, A, 'assumption', 'raw Status values meaning "no object" (7 = catalogue default)'],

    ['objects.use', 'enum', 'off', '', null, null, null, false, 'brief', 'fallback object list: off / fallback (only when lights are silent) / both', ['off', 'fallback', 'both']],
    ['objects.qualOk', 'list', [0], '', null, null, null, A, 'assumption', 'object-list qualifier values meaning available (family of GapVehicleAhead: 0 AVAILABLE)'],
    ['objects.qualReduced', 'list', [1], '', null, null, null, A, 'assumption', 'qualifier values meaning reduced (1 AVAILABLE_REDUCED)'],
    ['objects.reducedMeans', 'enum', 'camera', '', null, null, null, false, 'brief', 'a reduced camera: camera = low (fail-safe) / ok = keep going', ['camera', 'ok']],
    ['objects.oncomingMargin_kmh', 'num', 10, 'km/h', 0, 60, 1, A, 'assumption', 'oncoming when closing faster than own speed + this'],
    ['objScale.x.gain', 'num', 1, 'm/raw', -100, 100, 0.01, A, 'assumption', 'object x (longitudinal) scale; 1 = the adapter hands metres'],
    ['objScale.x.offset', 'num', 0, 'm', -1000, 1000, 1, A, 'assumption', ''],
    ['objScale.y.gain', 'num', 1, 'm/raw', -100, 100, 0.01, A, 'assumption', 'object y (lateral, + left)'],
    ['objScale.y.offset', 'num', 0, 'm', -1000, 1000, 1, A, 'assumption', ''],
    ['objScale.vx.gain', 'num', 1, 'm/s/raw', -100, 100, 0.01, A, 'assumption', 'object relative speed'],
    ['objScale.vx.offset', 'num', 0, 'm/s', -1000, 1000, 1, A, 'assumption', ''],
    ['objClasses', 'map', { '1': 'car', '2': 'truck', '3': 'moto', '4': 'bike', '5': 'ped' }, '', null, null, null, A, 'assumption', 'raw object class -> kind', OBJ_KINDS],

    ['zone.head_m', 'num', 400, 'm', 50, 1000, 10, A, 'research', 'oncoming headlamps dip within this straight ahead (UN R48 Annex 12 asks detection at 400 m; HR to confirm)'],
    ['zone.headSide_m', 'num', 80, 'm', 0, 1000, 10, A, 'tuning', 'oncoming zone length at the zone edge'],
    ['zone.tail_m', 'num', 200, 'm', 30, 600, 10, A, 'research', 'tail lamps ahead dip within this (R48 Annex 12: 100 m minimum; doubled for mirror glare)'],
    ['zone.tailSide_m', 'num', 80, 'm', 0, 600, 10, A, 'tuning', 'tail zone length at the zone edge'],
    ['zone.bike_m', 'num', 100, 'm', 20, 400, 5, A, 'research', 'a bicycle lamp dips within this (R48 Annex 12: 75 m)'],
    ['zone.other_m', 'num', 200, 'm', 0, 600, 10, A, 'tuning', 'an unclassified light dips within this'],
    ['zone.core_deg', 'num', 4, 'deg', 0, 30, 0.5, A, 'tuning', 'within this azimuth the zone has its full length'],
    ['zone.edge_deg', 'num', 18, 'deg', 1, 45, 0.5, A, 'tuning', 'beyond this azimuth nothing dips (the high beam\'s useful spread)'],
    ['zone.returnMargin', 'num', 1.3, 'x', 1, 3, 0.05, A, 'tuning', 'while low, a light holds the dip out to this times the zone (distance hysteresis: no flicker between two oncoming cars)'],
    ['zone.noDist', 'enum', 'in', '', null, null, null, false, 'brief', 'a light without a distance: in the zone (fail-safe) or out', ['in', 'out']],
    ['zone.reflector', 'enum', 'ignore', '', null, null, null, A, 'tuning', 'reflectors (signs, posts): ignore, or treat as an unclassified light', ['ignore', 'other']],

    ['confirm.weakFrames', 'num', 1, 'frames', 0, 10, 1, A, 'tuning', 'extra consecutive ticks a weak object needs before it dips'],
    ['confirm.strongFrames', 'num', 0, 'frames', 0, 10, 1, A, 'tuning', 'extra consecutive ticks a strong object needs (0 = dip at once)'],

    ['street.window_ms', 'num', 4000, 'ms', 500, 30000, 250, A, 'tuning', 'street lights counted over this window'],
    ['street.count', 'num', 3, '', 1, 15, 1, A, 'tuning', 'this many distinct street lights in the window = a lit road'],
    ['street.minEl_deg', 'num', 2, 'deg', -10, 30, 0.5, A, 'assumption', 'a street light is at least this far above the horizon'],

    ['dark.on_lux', 'num', 20, 'lux', 0, 5000, 1, A, 'assumption', 'below this it is dark (unit of the car\'s brightness unknown)'],
    ['dark.off_lux', 'num', 60, 'lux', 0, 10000, 1, A, 'assumption', 'above this it is light'],
    ['dark.onHold_ms', 'num', 8000, 'ms', 0, 120000, 500, A, 'assumption', 'dark must hold this long'],
    ['dark.offHold_ms', 'num', 2000, 'ms', 0, 120000, 500, A, 'assumption', 'light must hold this long (short: fail low)'],
    ['dark.useSun', 'enum', 'agree', '', null, null, null, false, 'brief', 'agree: sun "day" vetoes dark; fallback: sun only without brightness; off', ['agree', 'fallback', 'off']],
    ['brightness.gain', 'num', 1, 'lux/raw', 0, 1000, 0.1, A, 'assumption', 'raw brightness -> lux'],
    ['brightness.offset', 'num', 0, 'lux', -1000, 1000, 1, A, 'assumption', ''],

    ['speed.on_kmh', 'num', 40, 'km/h', 0, 150, 1, A, 'assumption', 'high beam allowed from this speed (brief default; HR to confirm)'],
    ['speed.off_kmh', 'num', 30, 'km/h', 0, 150, 1, A, 'assumption', 'below this: dip (hysteresis 10 km/h)'],

    ['town.limit_kmh', 'num', 60, 'km/h', 0, 150, 5, A, 'assumption', 'a limit at or below this = built-up area (UA towns 50 km/h)'],
    ['town.clear_ms', 'num', 3000, 'ms', 0, 60000, 500, A, 'tuning', 'a town ends this long after the last sign of it'],

    ['weather.wiperLow', 'num', 3, 'level', 1, 9, 1, A, 'tuning', 'wipers at or above this level = heavy rain / spray: low'],
    ['weather.wiperClear_ms', 'num', 20000, 'ms', 0, 300000, 1000, A, 'tuning', 'wipers below the level this long before high is allowed again'],
    ['weather.fog', 'bool', true, '', null, null, null, false, 'brief', 'fog lamps on = low'],

    ['curve.yaw_dps', 'num', 6, 'deg/s', 0, 90, 0.5, A, 'tuning', 'a curve: yaw rate at or above this (80 km/h -> radius about 210 m)'],
    ['curve.steer_deg', 'num', 60, 'deg', 0, 720, 5, A, 'assumption', 'a curve: steering-wheel angle at or above this'],
    ['curve.mode', 'enum', 'delay', '', null, null, null, false, 'tuning', 'delay: a curve only delays the return; dip: it dips; off', ['delay', 'dip', 'off']],
    ['curve.hold_ms', 'num', 1500, 'ms', 0, 20000, 250, A, 'tuning', 'the return to high waits this long after the curve'],

    ['verdict.use', 'enum', 'log', '', null, null, null, false, 'brief', 'the camera\'s own verdict: log (compare only), follow (its "no" dips), ignore', ['log', 'follow', 'ignore']],
    ['verdict.allow', 'list', [1], '', null, null, null, A, 'assumption', 'controlHighBeam raw values meaning "high allowed"'],
    ['verdict.deny', 'list', [0], '', null, null, null, A, 'assumption', 'raw values meaning "dip"; any other (3 = default) = unknown'],
    ['verdict.calibBad', 'list', [1, 2], '', null, null, null, A, 'assumption', 'statusCameraCalibration values meaning "not calibrated" (3 = default: unknown, ignored)'],
    ['verdict.qualBad', 'list', [2], '', null, null, null, A, 'assumption', 'verdict qualifier values meaning "no data / blind"'],

    ['timing.clearHead_ms', 'num', 1500, 'ms', 0, 20000, 100, A, 'tuning', 'return after an oncoming light left the zone'],
    ['timing.clearTail_ms', 'num', 2500, 'ms', 0, 20000, 100, A, 'tuning', 'return after a vehicle ahead left the zone'],
    ['timing.clearBike_ms', 'num', 2000, 'ms', 0, 20000, 100, A, 'tuning', 'return after a cyclist'],
    ['timing.clearOther_ms', 'num', 1500, 'ms', 0, 20000, 100, A, 'tuning', 'return after an unclassified light'],
    ['timing.clearStreet_ms', 'num', 1000, 'ms', 0, 20000, 100, A, 'tuning', 'return after a lit stretch (shorter than after a vehicle)'],
    ['timing.clearVerdict_ms', 'num', 1000, 'ms', 0, 20000, 100, A, 'tuning', 'return after the camera\'s "no"'],
    ['timing.enter_ms', 'num', 1000, 'ms', 0, 20000, 100, A, 'tuning', 'from standby: the road must be clear this long'],
    ['timing.minLow_ms', 'num', 2000, 'ms', 0, 60000, 100, A, 'tuning', 'minimum dwell in low after a dip'],
    ['timing.flickerWindow_ms', 'num', 20000, 'ms', 0, 300000, 1000, A, 'tuning', 'dips counted over this window'],
    ['timing.flickerDips', 'num', 2, '', 1, 20, 1, A, 'tuning', 'this many dips in the window lengthen the clear time'],
    ['timing.flickerExtra_ms', 'num', 2000, 'ms', 0, 60000, 250, A, 'tuning', 'added to the clear time after repeated dips'],
    ['timing.maxPerMin', 'num', 10, '/min', 1, 60, 1, A, 'tuning', 'beam changes per minute before a pause'],
    ['timing.rateHold_ms', 'num', 30000, 'ms', 0, 600000, 1000, A, 'tuning', 'the pause in low after too many changes'],
    ['timing.unavailableHold_ms', 'num', 2000, 'ms', 0, 60000, 100, A, 'tuning', 'after bad data: good data this long before high'],

    ['override.resume', 'enum', 'dip', '', null, null, null, false, 'research', 'dip: the driver\'s own dip after a manual high resumes auto; rearm: only app.rearm', ['dip', 'rearm']],
    ['override.lowHold_ms', 'num', 0, 'ms', 0, 3600000, 1000, false, 'brief', 'a manual low ends after this (0 = only on rearm / next push / a context change)'],
    ['override.highMax_ms', 'num', 0, 'ms', 0, 3600000, 1000, false, 'brief', 'a manual high ends after this (0 = when the driver dips)'],
    ['override.flashMax_ms', 'num', 700, 'ms', 0, 5000, 50, A, 'assumption', 'high_on then high_off within this = a flash, not an override'],
];

function setPath(o, path, v) {
    const ks = path.split('.');
    let cur = o;
    for (let i = 0; i < ks.length - 1; i++) { if (!cur[ks[i]] || typeof cur[ks[i]] !== 'object') cur[ks[i]] = {}; cur = cur[ks[i]]; }
    cur[ks[ks.length - 1]] = v;
}
function getPath(o, path) {
    const ks = path.split('.');
    let cur = o;
    for (let i = 0; i < ks.length; i++) { if (cur === null || cur === undefined || typeof cur !== 'object') return undefined; cur = cur[ks[i]]; }
    return cur;
}
function copyVal(v) {
    if (Array.isArray(v)) return v.slice();
    if (v && typeof v === 'object') return Object.assign({}, v);
    return v;
}

const SCHEMA_ROWS = SCHEMA.map((r) => ({
    key: r[0], type: r[1], def: r[2], unit: r[3], min: r[4], max: r[5], step: r[6], assumed: r[7], source: r[8], help: r[9],
    options: r[10] || null,
}));
const DEFAULTS = {};
SCHEMA_ROWS.forEach((r) => setPath(DEFAULTS, r.key, copyVal(r.def)));

/** The app's sensitivity setting: partial configs merged over the user's. */
const PRESETS = {
    early: { zone: { head_m: 500, tail_m: 250, bike_m: 120, other_m: 250, edge_deg: 22 }, confirm: { weakFrames: 0 },
        timing: { clearHead_ms: 2500, clearTail_ms: 3500, clearOther_ms: 2000, minLow_ms: 3000 } },
    normal: {},
    late: { zone: { head_m: 300, tail_m: 150, bike_m: 80, other_m: 150, edge_deg: 15 }, confirm: { weakFrames: 2 },
        timing: { clearHead_ms: 1000, clearTail_ms: 2000, clearOther_ms: 1000, minLow_ms: 1500 } },
};

const isNum = (x) => typeof x === 'number' && isFinite(x);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const inList = (a, x) => Array.isArray(a) && a.indexOf(x) >= 0;

/** Merge a partial config over the defaults, row by row; bad values -> default, noted in errs. */
function mergeConfig(partial, errs) {
    const out = {};
    const p = isObj(partial) ? partial : {};
    SCHEMA_ROWS.forEach((r) => {
        const v = getPath(p, r.key);
        let use = copyVal(r.def);
        if (v !== undefined) {
            let ok = false;
            if (r.type === 'num') ok = isNum(v) && (r.min === null || v >= r.min) && (r.max === null || v <= r.max);
            else if (r.type === 'enum') ok = inList(r.options, v);
            else if (r.type === 'bool') ok = typeof v === 'boolean';
            else if (r.type === 'list') ok = Array.isArray(v) && v.every(isNum);
            else if (r.type === 'map') ok = isObj(v) && Object.keys(v).every((k) => inList(r.options, v[k]));
            if (ok) use = copyVal(v);
            else errs.push(r.key + ': ' + JSON.stringify(v) + ' -> ' + JSON.stringify(r.def));
        }
        setPath(out, r.key, use);
    });
    // keys this module does not know are kept, ignored (CONTRACT: readers ignore what they do not know)
    Object.keys(p).forEach((k) => { if (out[k] === undefined) out[k] = p[k]; });
    return out;
}

/** The fail-safe output: want low, state UNAVAILABLE. */
function failOutput(t, reason) {
    const r = REASONS[reason] ? reason : 'error';
    return {
        t: isNum(t) ? t : null, want: 'low', state: 'UNAVAILABLE', reason: r, cause: null, since: isNum(t) ? t : null,
        holdUntil: null, confidence: 1, switched: false, details: { stale: [], lights: [], fail: true },
    };
}

/** step() inside a try/catch: the call the app makes every tick. */
function guard(inst, frame) {
    try {
        const out = inst.step(frame);
        if (!out || (out.want !== 'high' && out.want !== 'low')) return failOutput(frame && frame.t, 'error');
        return out;
    } catch (e) {
        return failOutput(frame && isObj(frame) ? frame.t : null, 'error');
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// the instance
// ---------------------------------------------------------------------------------------------------------------------
function create(partial) {
    const configErrors = [];
    const cfg = mergeConfig(partial, configErrors);
    let S = null;

    function fresh() {
        return {
            n: 0, lastT: null,
            state: null, reason: null, since: null, want: 'low',
            cause: null, holdUntil: null,
            // hysteresis memories
            speedOk: false, dark: false, darkCand: null, darkCandT: null,
            town: false, townLastT: null,
            heavy: false, heavyLastT: null,
            // dips and switches
            lastTrig: null,        // { t, reason, cause }
            dipT: null,            // when the current low period began
            dips: [],              // times of automatic dips
            changes: [],           // times of want changes
            rateHoldUntil: null,
            settleUntil: null,
            // tracking
            tracks: {},            // id -> { kind, n, lastN }
            streets: [],           // [ { id, t } ]
            // override (auto mode)
            override: null, overrideT: null, overrideFrom: null, lastStalkT: null,
            curveUntil: null,
        };
    }
    S = fresh();

    function staleOf(g, limit) {
        if (!isObj(g)) return 'missing';
        if (g.ok === false) return 'bad';
        if (limit > 0 && (!isNum(g.age) || g.age < 0 || g.age > limit)) return 'stale';
        return null;
    }

    /** One light object -> interpreted, or null when it is "no object". */
    function readLight(o) {
        if (!isObj(o)) return null;
        const sc = cfg.scale;
        if (isNum(o.age) && cfg.stale.object_ms > 0 && o.age > cfg.stale.object_ms) return null;
        if (isNum(o.status) && inList(cfg.status.none, o.status)) return null;
        if (o.x === sc.none.x && (o.cls === sc.none.cls || o.id === sc.none.id)) return null;
        let kind = isNum(o.cls) ? cfg.classes[String(o.cls)] : undefined;
        if (!inList(LIGHT_KINDS, kind)) kind = 'other';                     // unknown class: an unclassified light
        const strong = isNum(o.status) && inList(cfg.status.strong, o.status);
        const az = isNum(o.x) && o.x !== sc.none.x ? (o.x - sc.x.center) * sc.x.gain : null;
        const el = isNum(o.y) && o.y !== 255 ? (o.y - sc.y.center) * sc.y.gain : null;
        let dist = null, far = false;
        if (isNum(o.dist) && o.dist !== sc.none.dist) {
            dist = o.dist * sc.dist.gain + sc.dist.offset;
            if (dist < 0) dist = null;                                       // nonsense: unknown (zone.noDist decides)
            else if (dist >= sc.dist.max) { dist = sc.dist.max; far = true; }   // the top of the scale: far, not unknown
        }
        return { id: isNum(o.id) ? o.id : -1, kind: kind, strong: strong, az_deg: az, el_deg: el, dist_m: dist, far: far, src: 'light' };
    }

    /** One fallback object -> interpreted as a light-like source. */
    function readObject(o, speed) {
        if (!isObj(o) || !isNum(o.x)) return null;
        const s = cfg.objScale;
        const x = o.x * s.x.gain + s.x.offset;
        const y = isNum(o.y) ? o.y * s.y.gain + s.y.offset : 0;
        const vx = isNum(o.vx) ? o.vx * s.vx.gain + s.vx.offset : null;
        if (!(x > 0)) return null;
        let ok = isNum(o.cls) ? cfg.objClasses[String(o.cls)] : undefined;
        if (!inList(OBJ_KINDS, ok)) ok = 'other';
        if (ok === 'ped') return null;                                       // no lamp to glare
        let kind;
        if (ok === 'bike') kind = 'bike';
        else if (vx === null) kind = 'other';
        else kind = (-vx * 3.6 > speed + cfg.objects.oncomingMargin_kmh) ? 'head' : 'tail';
        return { id: isNum(o.id) ? o.id : -1, kind: kind, strong: true, az_deg: -Math.atan2(y, x) * 180 / Math.PI, el_deg: null, dist_m: x, src: 'object' };
    }

    /** The zone's length at an azimuth, for a kind. */
    function zoneLen(kind, az) {
        const z = cfg.zone;
        let full, side;
        if (kind === 'head') { full = z.head_m; side = z.headSide_m; }
        else if (kind === 'tail') { full = z.tail_m; side = z.tailSide_m; }
        else if (kind === 'bike') { full = z.bike_m; side = z.bike_m * 0.5; }
        else { full = z.other_m; side = z.other_m * 0.5; }
        if (az === null) return full;
        const a = Math.abs(az);
        if (a <= z.core_deg) return full;
        if (a > z.edge_deg) return 0;
        const f = z.edge_deg > z.core_deg ? (a - z.core_deg) / (z.edge_deg - z.core_deg) : 1;
        return full + (side - full) * f;
    }
    function inZone(L, margin) {
        const len = zoneLen(L.kind, L.az_deg) * margin;
        if (len <= 0 || L.far) return false;                                 // beyond the scale's top: outside every zone
        if (L.dist_m === null) return cfg.zone.noDist === 'in';
        return L.dist_m <= len;
    }

    function output(t, want, state, reason, extra) {
        const changed = state !== S.state || reason !== S.reason;
        if (changed || S.since === null) S.since = t;
        const switched = want !== S.want;
        if (switched) S.changes.push(t);
        S.state = state; S.reason = reason; S.want = want;
        return {
            t: t, want: want, state: state, reason: reason, cause: extra.cause || null, since: S.since,
            holdUntil: isNum(extra.holdUntil) ? extra.holdUntil : null, confidence: extra.confidence,
            switched: switched, details: extra.details,
        };
    }

    function step(frame) {
        if (!isObj(frame) || !isNum(frame.t)) return failOutput(isObj(frame) ? frame.t : null, 'nodata');
        const t = frame.t;
        if (S.lastT !== null && t < S.lastT - 1000) S = fresh();             // the clock went back: a new drive
        S.lastT = t;
        S.n++;
        // prune memories
        const winDips = cfg.timing.flickerWindow_ms;
        S.dips = S.dips.filter((x) => t - x <= winDips);
        S.changes = S.changes.filter((x) => t - x <= 60000);
        S.streets = S.streets.filter((x) => t - x.t <= cfg.street.window_ms);

        const stale = [];
        const lightsSt = staleOf(frame.lights, cfg.stale.lights_ms);
        const objectsSt = staleOf(frame.objects, cfg.stale.objects_ms);
        const carSt = staleOf(frame.car, cfg.stale.car_ms);
        const lampsSt = staleOf(frame.lamps, cfg.stale.lamps_ms);
        const envSt = staleOf(frame.env, cfg.stale.env_ms);
        const verdictSt = staleOf(frame.verdict, cfg.stale.verdict_ms);
        if (lightsSt) stale.push('lights');
        if (carSt) stale.push('car');
        if (lampsSt) stale.push('lamps');
        if (envSt && envSt !== 'missing') stale.push('env');
        if (verdictSt && verdictSt !== 'missing') stale.push('verdict');
        if (objectsSt && objectsSt !== 'missing') stale.push('objects');

        const car = carSt ? {} : (isObj(frame.car.v) ? frame.car.v : {});
        const lamps = lampsSt ? {} : (isObj(frame.lamps.v) ? frame.lamps.v : {});
        const env = envSt ? {} : (isObj(frame.env.v) ? frame.env.v : {});
        const speed = car.speed_kmh;
        const driverLamp = lamps.high === true ? 'high' : lamps.high === false ? 'low' : null;

        const useObjects = cfg.objects.use !== 'off' && !objectsSt && Array.isArray(frame.objects.v) &&
            (cfg.objects.use === 'both' || lightsSt);
        const lightsOk = !lightsSt && Array.isArray(frame.lights.v);

        // ---- the driver's stalk (auto mode only; in advise mode a label) ----
        const auto = cfg.mode === 'auto';
        const stalkEvents = [];
        if (isObj(frame.stalk) && Array.isArray(frame.stalk.v)) {
            frame.stalk.v.forEach((e) => {
                if (!isObj(e) || (e.kind !== 'high_on' && e.kind !== 'high_off' && e.kind !== 'flash')) return;
                const et = isNum(e.t) ? e.t : t;
                if (S.lastStalkT !== null && et <= S.lastStalkT && isNum(e.t)) return;   // already seen
                if (isNum(e.t)) S.lastStalkT = et;
                stalkEvents.push({ t: et, kind: e.kind });
            });
        }
        const rearm = isObj(frame.app) && isObj(frame.app.v) && frame.app.v.rearm === true;

        // ---- inputs: UNAVAILABLE ----
        let failReason = null;
        if (carSt || !isNum(speed) || lampsSt) failReason = 'nodata';
        else if (!lightsOk && !useObjects) failReason = 'nodata';
        // camera health
        let reduced = false;
        if (!failReason && !verdictSt && isObj(frame.verdict.v)) {
            const vv = frame.verdict.v;
            if (isNum(vv.qualifier) && inList(cfg.verdict.qualBad, vv.qualifier)) failReason = 'camera';
            if (isNum(vv.calibration) && inList(cfg.verdict.calibBad, vv.calibration)) failReason = 'camera';
        }
        if (!failReason && !objectsSt && isNum(frame.objects.qual)) {
            const q = frame.objects.qual;
            if (inList(cfg.objects.qualReduced, q)) { reduced = true; if (cfg.objects.reducedMeans === 'camera') failReason = 'camera'; }
            else if (!inList(cfg.objects.qualOk, q)) failReason = 'camera';
        }

        // ---- preconditions with hysteresis (updated every tick, whatever the state) ----
        if (isNum(speed)) {
            if (speed >= cfg.speed.on_kmh) S.speedOk = true;
            else if (speed < cfg.speed.off_kmh) S.speedOk = false;
        } else S.speedOk = false;
        const gearBad = car.gear === 'P' || car.gear === 'R';
        // darkness
        let cand = null;                                   // 'dark' | 'light' | null (between the thresholds)
        const lux = isNum(env.brightness) ? env.brightness * cfg.brightness.gain + cfg.brightness.offset : null;
        const sun = env.sun === 'day' || env.sun === 'night' ? env.sun : null;
        if (lux !== null) {
            if (lux < cfg.dark.on_lux) cand = 'dark';
            else if (lux > cfg.dark.off_lux) cand = 'light';
            else cand = S.dark ? 'dark' : 'light';
            if (cfg.dark.useSun === 'agree' && sun === 'day') cand = 'light';
        } else if (cfg.dark.useSun !== 'off' && sun !== null) cand = sun === 'night' ? 'dark' : 'light';
        else cand = 'light';                               // nothing known: not dark (fail low)
        if (cand !== S.darkCand) { S.darkCand = cand; S.darkCandT = t; }
        if (cand === 'dark' && !S.dark && t - S.darkCandT >= cfg.dark.onHold_ms) S.dark = true;
        if (cand === 'light' && S.dark && t - S.darkCandT >= cfg.dark.offHold_ms) S.dark = false;
        // town
        const townNow = env.urban === true || (isNum(env.limit_kmh) && env.limit_kmh > 0 && env.limit_kmh <= cfg.town.limit_kmh);
        if (townNow) { S.town = true; S.townLastT = t; }
        else if (S.town && t - S.townLastT >= cfg.town.clear_ms) S.town = false;
        // weather
        const fogOn = cfg.weather.fog && lamps.fog === true;
        const heavyNow = isNum(env.wiper) && env.wiper >= cfg.weather.wiperLow;
        if (heavyNow) { S.heavy = true; S.heavyLastT = t; }
        else if (S.heavy && t - S.heavyLastT >= cfg.weather.wiperClear_ms) S.heavy = false;
        const lowBeam = lamps.low === true && lamps.switch !== 'off' && lamps.switch !== 'park';
        const yaw = isNum(car.yaw_dps) ? Math.abs(car.yaw_dps) : 0;
        const steer = isNum(car.steer_deg) ? Math.abs(car.steer_deg) : 0;
        const curveNow = cfg.curve.mode !== 'off' && ((cfg.curve.yaw_dps > 0 && yaw >= cfg.curve.yaw_dps) || (cfg.curve.steer_deg > 0 && steer >= cfg.curve.steer_deg));
        if (curveNow) S.curveUntil = t + cfg.curve.hold_ms;

        let standbyReason = null;
        if (!lowBeam) standbyReason = 'lights_off';
        else if (!S.speedOk || gearBad) standbyReason = 'slow';
        else if (!S.dark) standbyReason = 'daylight';
        else if (fogOn || S.heavy) standbyReason = 'weather';
        else if (S.town) standbyReason = 'town';

        // ---- what is ahead ----
        const seen = [];
        const counts = { head: 0, tail: 0, street: 0, reflector: 0, bike: 0, other: 0 };
        if (lightsOk) frame.lights.v.forEach((o) => { const L = readLight(o); if (L) seen.push(L); });
        if (useObjects) frame.objects.v.forEach((o) => { const L = readObject(o, isNum(speed) ? speed : 0); if (L) seen.push(L); });
        // confirmation tracks (consecutive ticks per id and kind)
        const tracks = {};
        seen.forEach((L) => {
            const key = L.src + ':' + L.id;
            const prev = S.tracks[key];
            const n = prev && prev.lastN === S.n - 1 && prev.kind === L.kind ? prev.n + 1 : 1;
            tracks[key] = { kind: L.kind, n: n, lastN: S.n };
            L.frames = n;
        });
        S.tracks = tracks;
        let best = null;
        const lightsOut = [];
        const margin = S.state === 'HIGH' ? 1 : cfg.zone.returnMargin;      // the zone is longer while low (hysteresis)
        seen.forEach((L) => {
            counts[L.kind]++;
            if (L.kind === 'street') {
                if (L.el_deg === null || L.el_deg >= cfg.street.minEl_deg) S.streets.push({ id: L.id, t: t, L: L });
                L.inZone = false;
            } else if (L.kind === 'reflector' && cfg.zone.reflector === 'ignore') {
                L.inZone = false;
            } else {
                L.inZone = inZone(L, margin);
                const need = 1 + (L.strong ? cfg.confirm.strongFrames : cfg.confirm.weakFrames);
                if (L.inZone && L.frames >= need) {
                    const reason = KIND_REASON[L.kind] || 'light';
                    const cand2 = { reason: reason, L: L };
                    if (!best || REASONS[reason].rank < REASONS[best.reason].rank ||
                        (reason === best.reason && (L.dist_m === null ? 0 : L.dist_m) < (best.L.dist_m === null ? 0 : best.L.dist_m))) best = cand2;
                }
            }
            lightsOut.push({ id: L.id, kind: L.kind, src: L.src, az_deg: L.az_deg, el_deg: L.el_deg, dist_m: L.dist_m, strong: L.strong, inZone: !!L.inZone });
        });
        lightsOut.sort((a, b) => (a.dist_m === null ? 1e9 : a.dist_m) - (b.dist_m === null ? 1e9 : b.dist_m));
        // street lights: distinct ids within the window
        const ids = {};
        let nearestStreet = null;
        S.streets.forEach((s) => { ids[s.id] = true; if (!nearestStreet || (s.L.dist_m || 1e9) < (nearestStreet.dist_m || 1e9)) nearestStreet = s.L; });
        const streetCount = Object.keys(ids).length;
        if (streetCount >= cfg.street.count && (!best || REASONS.streetlights.rank < REASONS[best.reason].rank)) best = { reason: 'streetlights', L: nearestStreet };
        // the camera's own verdict
        let verdictOut = null;
        if (isObj(frame.verdict) && !verdictSt && isObj(frame.verdict.v)) {
            const a = frame.verdict.v.allow;
            const allow = inList(cfg.verdict.allow, a) ? true : inList(cfg.verdict.deny, a) ? false : null;
            verdictOut = { allow: allow, use: cfg.verdict.use, agrees: null };
            if (cfg.verdict.use === 'follow' && allow !== true) {
                if (!best || REASONS.camera_verdict.rank < REASONS[best.reason].rank) best = { reason: 'camera_verdict', L: null };
            }
        }
        if (curveNow && cfg.curve.mode === 'dip' && !best) best = { reason: 'curve', L: null };

        const details = {
            mode: cfg.mode, dark: S.dark, speedOk: S.speedOk && !gearBad, town: S.town, weather: !!(fogOn || S.heavy),
            lowBeam: lowBeam, curve: curveNow, stale: stale, lights: lightsOut.slice(0, 15), counts: counts, street: streetCount,
            switchesPerMin: S.changes.length, dips: S.dips.length, override: S.override, verdict: verdictOut, driver: driverLamp,
            reduced: reduced,
        };
        const causeOf = (b) => (b && b.L ? { src: b.L.src, id: b.L.id, kind: b.L.kind, dist_m: b.L.dist_m, az_deg: b.L.az_deg }
            : b && b.reason === 'camera_verdict' ? { src: 'verdict', id: null, kind: null, dist_m: null, az_deg: null } : null);
        const finish = (want, state, reason, extra) => {
            const o = output(t, want, state, reason, extra);
            if (verdictOut) verdictOut.agrees = verdictOut.allow === null ? null : (verdictOut.allow === (o.want === 'high'));
            details.override = S.override;
            details.switchesPerMin = S.changes.length;
            return o;
        };

        // ---- the driver's override (auto mode) ----
        const prevState = S.state;
        if (auto) {
            if (rearm) { S.override = null; S.settleUntil = t + cfg.timing.enter_ms; }
            stalkEvents.forEach((e) => {
                if (e.kind === 'flash') return;
                if (e.kind === 'high_on') {
                    if (S.override !== 'high') { S.overrideFrom = { override: S.override, state: S.state }; S.override = 'high'; S.overrideT = e.t; }
                } else if (e.kind === 'high_off') {
                    if (S.override === 'high') {
                        const quick = e.t - S.overrideT < cfg.override.flashMax_ms;
                        if (quick) S.override = S.overrideFrom ? S.overrideFrom.override : null;   // push + pull at once: a flash
                        else S.override = cfg.override.resume === 'dip' ? null : 'low';
                        S.overrideT = e.t;
                        if (!S.override) { S.dipT = e.t; S.lastTrig = null; S.settleUntil = e.t + cfg.timing.minLow_ms; }
                    } else if (S.override === null && S.state === 'HIGH') {
                        S.override = 'low'; S.overrideT = e.t;
                    }
                }
            });
            if (S.override === 'low' && cfg.override.lowHold_ms > 0 && t - S.overrideT >= cfg.override.lowHold_ms) { S.override = null; S.settleUntil = t + cfg.timing.enter_ms; }
            if (S.override === 'high' && cfg.override.highMax_ms > 0 && t - S.overrideT >= cfg.override.highMax_ms) { S.override = null; S.dipT = t; S.settleUntil = t + cfg.timing.minLow_ms; }
            if (S.override === 'low' && (failReason || standbyReason)) S.override = null;     // a context change ends a manual low
            if (S.override) {
                return finish(S.override, 'OVERRIDE', 'driver', { confidence: 1, details: details });
            }
        } else S.override = null;

        // ---- UNAVAILABLE / STANDBY ----
        if (failReason) {
            S.settleUntil = null; S.holdUntil = null; S.lastTrig = null;
            return finish('low', 'UNAVAILABLE', failReason, { confidence: 1, details: details });
        }
        if (standbyReason) {
            S.settleUntil = null; S.holdUntil = null; S.lastTrig = null;
            return finish('low', 'STANDBY', standbyReason, { confidence: 1, details: details });
        }
        // entering from standby / unavailable / the first tick: settle
        if (prevState === null || prevState === 'STANDBY' || prevState === 'UNAVAILABLE') {
            const hold = prevState === 'UNAVAILABLE' ? Math.max(cfg.timing.enter_ms, cfg.timing.unavailableHold_ms) : cfg.timing.enter_ms;
            S.settleUntil = t + hold;
            S.dipT = t;
            S.lastTrig = null;
        }

        // ---- a trigger: dip now ----
        if (best) {
            if (S.state === 'HIGH' || S.want === 'high') { S.dips.push(t); S.dipT = t; }
            if (S.dipT === null) S.dipT = t;
            S.lastTrig = { t: t, reason: best.reason, cause: causeOf(best) };
            // too many changes: a pause in low
            if (S.changes.length + (S.want === 'high' ? 1 : 0) >= cfg.timing.maxPerMin) S.rateHoldUntil = Math.max(S.rateHoldUntil || 0, t + cfg.timing.rateHold_ms);
            details.dips = S.dips.length;
            const conf = best.reason === 'streetlights' ? 0.5 : best.reason === 'camera_verdict' ? 0.8 : best.L && !best.L.strong ? 0.6 : 1;
            return finish('low', 'DIPPED', best.reason, { cause: causeOf(best), holdUntil: null, confidence: conf, details: details });
        }

        // ---- nothing ahead ----
        if (S.state === 'HIGH') {
            const conf0 = lightsOk ? 1 - 0.5 * Math.min(1, (isNum(frame.lights.age) ? frame.lights.age : 0) / Math.max(1, cfg.stale.lights_ms)) : 0.6;
            const conf = conf0 * (reduced ? 0.7 : 1) * (cfg.verdict.use === 'follow' && !verdictOut ? 0.8 : 1);
            return finish('high', 'HIGH', 'clear', { confidence: Math.round(conf * 100) / 100, details: details });
        }
        // DIPPED (or entering): count down
        let holdUntil = S.settleUntil || 0;
        let reason = 'settle';
        let cause = null;
        if (S.lastTrig) {
            const extra = S.dips.length >= cfg.timing.flickerDips ? cfg.timing.flickerExtra_ms : 0;
            const key = CLEAR_KEY[S.lastTrig.reason];
            const clr = key ? cfg.timing[key] : (S.lastTrig.reason === 'curve' ? cfg.curve.hold_ms : cfg.timing.enter_ms);
            const until = S.lastTrig.t + clr + extra;
            if (until >= holdUntil) { holdUntil = until; reason = S.lastTrig.reason; cause = S.lastTrig.cause; }
        }
        if (S.dipT !== null && S.dips.length && S.dipT + cfg.timing.minLow_ms > holdUntil) holdUntil = S.dipT + cfg.timing.minLow_ms;
        if (cfg.curve.mode === 'delay' && S.curveUntil !== null && S.curveUntil > holdUntil) { holdUntil = S.curveUntil; reason = 'curve'; cause = null; }
        if (S.rateHoldUntil !== null && S.rateHoldUntil > holdUntil) { holdUntil = S.rateHoldUntil; reason = 'flicker'; cause = null; }
        if (t >= holdUntil) {
            S.settleUntil = null; S.lastTrig = null; S.rateHoldUntil = null;
            const conf = lightsOk ? 1 : 0.6;
            return finish('high', 'HIGH', 'clear', { confidence: conf, details: details });
        }
        return finish('low', 'DIPPED', reason, { cause: cause, holdUntil: holdUntil, confidence: 0.5, details: details });
    }

    function safeStep(frame) {
        try { return step(frame); } catch (e) {
            S.want = 'low'; S.state = 'UNAVAILABLE'; S.reason = 'error';
            return failOutput(isObj(frame) ? frame.t : null, 'error');
        }
    }

    return {
        config: cfg, configErrors: configErrors,
        step: safeStep,
        reset: () => { S = fresh(); },
        _state: () => S,          // tests and the simulator's inspector only
    };
}

/** A shallow-per-group merge of partial configs (for presets over a user's config). */
function mergePartial(a, b) {
    const out = {};
    [a, b].forEach((p) => {
        if (!isObj(p)) return;
        Object.keys(p).forEach((k) => {
            if (isObj(p[k]) && isObj(out[k])) out[k] = mergePartial(out[k], p[k]);
            else if (isObj(p[k])) out[k] = mergePartial({}, p[k]);
            else out[k] = copyVal(p[k]);
        });
    });
    return out;
}

const API = {
    VERSION: VERSION, STATES: STATES, STATE_KEYS: STATE_KEYS, REASONS: REASONS, REASON_ORDER: REASON_ORDER,
    LIGHT_KINDS: LIGHT_KINDS, DEFAULTS: DEFAULTS, SCHEMA: SCHEMA_ROWS, PRESETS: PRESETS,
    create: create, guard: guard, failOutput: failOutput, mergePartial: mergePartial, getPath: getPath,
};
// CommonJS in the app, the simulator and the tests; the simulator's page (no module system) gets one name.
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else if (typeof self !== 'undefined') self.BeamLogic = API;
