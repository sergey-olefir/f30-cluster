'use strict';
/**
 * inputs.js - the input adapter: raw SOME/IP values -> a snapshot of decoded inputs with their arrival times (round "Auto
 * Beam", package HD). contract.js turns the snapshot into the algorithm's frame (docs/highbeam/CONTRACT.md section 2). READ
 * ONLY: this file only receives values the app subscribed to (main.js); it never asks the car for anything.
 *
 * Raw units stay raw (the algorithm's config holds the scales). Every reading this car has not confirmed is a config value
 * with an "assumed" flag (config.inputs), so a night drive corrects a line of app.json, not the code:
 *   lights   RecogFrontCameraLightDetection.mainBeamAssistantDataObject1..15 (MainBeam... for 11, 12, 15): 10 UInt8 each, put in
 *            the list raw (contract 2.1) with their own age; a slot still holding the catalogue's defaults (X 255, distance
 *            127, class 15, status 7) is no object. HR: on a car without the licence this stream is probably SILENT (~20 %).
 *   verdict  controlHighBeamAssistant, raw (contract 2.2).
 *   objects  THE FALLBACK (contract 2.3) while the light stream is silent: RecogFrontCameraObjectlist.objectlistTCP (metres,
 *            m/s, per object head-lamp and rear-lamp ON / OFF) first, else ObjectRecognitionFrontCamera ObjectRecognition +
 *            ObjectPosition (statusMovement ONCOMING / SAME_AS_EGO), joined slot by slot. Each object { id, cls (1 car 2 truck
 *            3 moto 4 bike 5 ped 0 other: the contract's objClasses codes), x, y (m, + left), vx (m/s relative; null when the
 *            list has no velocity), lane: null, head, rear (true / false / null), oncoming (true / false / null), src }.
 *            qual: the list's eventDataQualifier as a number (0 available, 1 reduced, 2 not available, 255 invalid).
 *   lamps    low: LowBeam.statusLowBeam, else Vehicle2.statusLightStatus.statusDippedBeam. HIGH (is the high beam lit), in the
 *            order of config.inputs.lamps.highSources: Vehicle2.statusLightStatus.statusMainBeam_headlightFlasher (HR's best
 *            candidate; trusted only while statusLightStatusError says the lamp signals are in order), then
 *            Light.LampExterior2.controlFunctionMainBeam (the BDC's command; second). fog: LampExterior2's front fog lamp or
 *            statusLightStatus's front / rear fog.
 *   stalk    IndicatorSteeringColumn.operationColumnStalks: the pull bit's rising edge (ASSUMED 0x10, ROUND.md 1a) is a
 *            'flash'; the high beam's own change is 'high_on' / 'high_off' (contract 2.4: labels in advise mode).
 *   env      Environment.StatusBrightnessEnvironment (raw); the car's day / night else the sun; the wiper level (raw
 *            rainSensorWiperSpeed.speedWiper clamped to 0..3, ASSUMED); the limit (TrafficSignRecognition, seen); urban: the
 *            camera's town-entry / town-exit signs (SignRecognitionFrontCamera, TrafficSignType CITY_LIMIT_START_OF 55 /
 *            CITY_LIMIT_END_OF 56 / CITY_LIMIT_START_END_OF 57; navigation is CarPlay, so no map flag), latched until the
 *            exit sign or config.inputs.town.maxMs.
 *   car      Vehicle2.statusCarSpeed2 x 0.015625 km/h (seen); YawRateProvision.yawRate (scale ASSUMED, deg/s, + left).
 *   msg      Vehicle2.statusDisplayedCCMessage: the car's message shown now (0 none, 65535 unknown; seen 2026-11-18).
 * Plain Node 8.16. Nothing here throws on any value.
 */

const DEFAULTS = {
    lights: { none: { x: 255, dist: 127, cls: 15, status: 7, id: 15 }, staleMs: 600, assumed: true },
    lamps: {
        highSources: ['lightStatus', 'lampExterior2'],
        lightStatusOk: ['LAMPENZUSTANDS_MINUS_SIGNALE_SIND_IN_ORDNUNG', 0],
        on: ['EIN', 1], off: ['AUS', 0],
        lowOn: ['FAHRLICHT_EINSCHALTEN', 1], lowOff: ['FAHRLICHT_AUSSCHALTEN', 0],
        highOn: ['ON_MAB_MODE_1', 'ON_MAB_MODE_2', 'ON_MAB_MODE_3', 'ON_MAB_MODE_4', 2, 5, 6, 7], highOff: ['OFF_MAB', 1],
        fogOn: ['NSW_ON', 2], fogOff: ['NSW__OFF', 1, 'INIT', 0],
        assumed: true,
    },
    stalk: { pull: 0x10, push: 0x20, assumed: true },
    objects: { staleMs: 600, minProb: 0, ySign: 1, classes: { car: 1, truck: 2, moto: 3, bike: 4, ped: 5, other: 0 }, assumed: true },
    env: { wiperPath: 'speedWiper', wiperMax: 3, assumed: true },
    town: { start: ['CITY_LIMIT_START_OF', 55, 'CITY_LIMIT_START_END_OF', 57], end: ['CITY_LIMIT_END_OF', 56], maxMs: 900000, assumed: true },
    car: { speedScale: 0.015625, speedNone: 65535, yawScale: 1, yawPath: ['yawRate'], staleMs: 1000, assumedYaw: true },
    limit: { staleMs: 0 },
    dayNight: { day: ['TAG', 1], night: ['NACHT', 2] },
};

function merge(a, b) {
    const o = {};
    Object.keys(a).forEach((k) => { o[k] = a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], (b && b[k]) || {}) : (b && b[k] !== undefined ? b[k] : a[k]); });
    Object.keys(b || {}).forEach((k) => { if (!(k in a)) o[k] = b[k]; });
    return o;
}

const fin = (x) => typeof x === 'number' && isFinite(x);
const has = (list, v) => Array.isArray(list) && v !== undefined && v !== null && (list.indexOf(v) >= 0 || list.indexOf(String(v)) >= 0 || (typeof v === 'string' && list.indexOf(Number(v)) >= 0 && v !== ''));
const num = (v) => (fin(v) ? v : v && typeof v === 'object' && fin(v.value) ? v.value : null);
const pick = (o, path) => { let x = o; (path || []).forEach((k) => { x = x && typeof x === 'object' ? x[k] : undefined; }); return x; };
const arr = (a) => (Array.isArray(a) ? a : []);
function member(v, base, n) {
    if (!v || typeof v !== 'object') return null;
    const a = num(v[base + 'Object' + n]);
    return a !== null ? a : num(v[base]);
}
/** A qualifier as it may arrive (a number or one of the enums' names) -> 0 available, 1 reduced, 2 not available, 255 invalid. */
function qualOf(q) {
    if (fin(q)) return q;
    const s = String(q === undefined || q === null ? '' : q).toUpperCase();
    if (!s) return null;
    if (/NOT_?AVAILABLE/.test(s)) return 2;
    if (/REDUCED/.test(s)) return 1;
    if (/INVALID|TIMEOUT/.test(s)) return 255;
    if (/AVAILABLE/.test(s)) return 0;
    return null;
}
/** A lamp state name / number (…STATUS_ON 2, …_OFF 1, unknown 0, invalid 255) -> 'on' / 'off' / null (CONTRACT 2.3). */
function lampOf(v) {
    if (v === 2) return 'on';
    if (v === 1) return 'off';
    const s = typeof v === 'string' ? v.toUpperCase() : '';
    if (/_ON$/.test(s)) return 'on';
    if (/_OFF$/.test(s)) return 'off';
    return null;
}
/** ObjectRecognition's statusMovement -> the contract's move word (2.3). */
function moveOf(v) {
    const s = String(v === undefined || v === null ? '' : v);
    if (/STOPPED_OBJECT_MOVEMENT_DIRECTION_WAS_ONCOMING/.test(s) || s === '1') return 'stopped_oncoming';
    if (/ONCOM/.test(s) || s === '4') return 'oncoming';
    if (/SAME_AS_EGO/.test(s) || s === '5' || s === '2') return 'same';
    if (/CROSSING/.test(s) || s === '7' || s === '8') return 'crossing';
    if (/STATIONARY/.test(s) || s === '0') return 'stationary';
    return null;
}

const FIELDS = ['XPosition', 'YPosition', 'Width', 'Height', 'AngularSpeedLeft', 'AngularSpeedRight', 'Class', 'Id', 'Distance', 'Status'];

/** The light event of slot n (1..15) -> a raw object { slot, id, cls, status, x, y, w, h, dist, wl, wr } or null (the defaults). */
function decodeLight(cfg, n, v) {
    const m = {};
    FIELDS.forEach((f) => { m[f] = member(v, f, n); });
    const N = cfg.lights.none;
    if (m.XPosition === null && m.Distance === null) return null;
    if (m.XPosition === N.x && (m.Class === N.cls || m.Id === N.id)) return null;
    if (m.Status === N.status) return null;
    return { slot: n, id: m.Id === null ? n : m.Id, cls: m.Class, status: m.Status, x: m.XPosition, y: m.YPosition, w: m.Width, h: m.Height, dist: m.Distance, wl: m.AngularSpeedLeft, wr: m.AngularSpeedRight };
}

/** controlHighBeamAssistant -> the contract's raw verdict (2.2). */
function decodeVerdict(v) {
    if (!v || typeof v !== 'object') return null;
    const r = (k) => (num(v[k]) !== null ? num(v[k]) : v[k] === undefined ? null : v[k]);
    return { allow: r('controlHighBeam'), reason: r('reasonSwitchOffHighBeam'), vehicles: r('numberVehicles'), signs: r('numberRoadSigns'), pedestrians: r('numberPedestrians'),
        calibration: r('statusCameraCalibration'), qualifier: r('qualifierDataControlHighBeamAssistant'), qualifierExt: r('qualifierExtendedControlHighBeamAsstistant') };
}

const TCP_CLS = [['class_car', 'car'], ['class_truck', 'truck'], ['class_motorcycle', 'moto'], ['class_bicycle', 'bike'], ['class_pedestrian', 'ped'], ['class_unknown', 'other'], ['class_animal', 'other'], ['class_hazard', 'other']];
/** objectlistTCP -> objects (egoMs: our speed in m/s, for the relative velocity). */
function decodeTcp(cfg, v, egoMs) {
    const C = cfg.objects, out = [];
    const list = arr(v && v.objectListSmall);
    const n = Math.min(20, num(v && v.numberOfObjects) !== null ? v.numberOfObjects : list.length, list.length);
    for (let i = 0; i < n; i++) {
        const o = list[i] || {}, pos = o.position || {}, cl = o.classification || {}, lt = o.lights || {}, dy = (o.dynamics && o.dynamics.velocity_absolute) || {};
        const ex = o.existence || {};
        if (num(ex.existence_probability) !== null && ex.existence_probability < C.minProb) continue;
        const x = num(pos.x), y = num(pos.y);
        if (x === null || y === null) continue;
        let best = 'other', bp = -1;
        TCP_CLS.forEach((c) => { const p = num(cl[c[0]]); if (p !== null && p > bp) { bp = p; best = c[1]; } });
        const va = num(dy.x);
        const st = o.summary && String(o.summary.status_movement || '');
        out.push({ id: o.summary && num(o.summary.id) !== null ? o.summary.id : i, cls: C.classes[best] === undefined ? 0 : C.classes[best], x, y: y * C.ySign,
            vx: va !== null && fin(egoMs) ? va - egoMs : null, lane: null, move: /STATIONARY/.test(st) ? 'stationary' : null,
            head: lampOf(lt.status_head_light), rear: lampOf(lt.status_rear_light), vabs: va, src: 'tcp' });
    }
    return out;
}
const CAM_CLS = { PEDESTRIAN: 'ped', 0: 'ped', CYCLIST: 'bike', 1: 'bike', BIKE_MOTORBIKE_MOPED: 'moto', 2: 'moto', CAR_WITH_OR_WITHOUT_TRAILER: 'car', 3: 'car', TRUCK_BUS_VAN: 'truck', 4: 'truck' };
const CAM_SKIP = { ROAD_BOUNDARY: 1, 6: 1, BRIDGE: 1, 7: 1, SIGNAL_UNFILLED: 1, 255: 1 };
/** ObjectRecognition + ObjectPosition (joined slot by slot) -> objects with statusMovement's oncoming. */
function decodeCam(cfg, rec, pos) {
    const C = cfg.objects, out = [];
    const ri = arr(rec && rec.objectRecognitionInfo), pi = arr(pos && pos.objectPositionInfo);
    const n = Math.min(40, num(pos && pos.numberOfObjects) !== null ? pos.numberOfObjects : pi.length, pi.length);
    for (let i = 0; i < n; i++) {
        const p = pi[i] || {}, r = ri[i] || {};
        const ct = r.classificationType;
        if (CAM_SKIP[String(ct)]) continue;
        const x = num(p.positionX), y = num(p.positionY);
        if (x === null || y === null) continue;
        const cls = CAM_CLS[String(ct)] || 'other';
        out.push({ id: num(r.objectID) !== null ? r.objectID : i, cls: C.classes[cls] === undefined ? 0 : C.classes[cls], x, y: y * C.ySign, vx: null, lane: null,
            move: moveOf(r.statusMovement), head: null, rear: null, vabs: null, src: 'cam' });
    }
    return out;
}

function Inputs(cfg) {
    this.cfg = merge(DEFAULTS, cfg || {});
    this.slots = {};
    this.lightsAt = null;
    this.vals = {};
    this.events = [];
    this.bits = 0;
    this.highNow = null;
    this.sunNight = null;
    this.raw = { tcp: null, tcpAt: null, rec: null, pos: null, posAt: null };
    this.signEvents = []; this.signNow = null; this.signsAt = null;
}
Inputs.DEFAULTS = DEFAULTS;
Inputs.decodeLight = decodeLight;
Inputs.decodeVerdict = decodeVerdict;
Inputs.decodeTcp = decodeTcp;
Inputs.decodeCam = decodeCam;
Inputs.qualOf = qualOf;
Inputs.moveOf = moveOf;
Inputs.FIELDS = FIELDS;

Inputs.prototype._set = function (k, v, now) { this.vals[k] = { v, at: now }; };
Inputs.prototype.light = function (n, v, now) {
    this.slots[n] = { o: decodeLight(this.cfg, n, v), at: now };
    this.lightsAt = now;
    return this.slots[n].o;
};
Inputs.prototype.verdict = function (v, now) { const d = decodeVerdict(v); this._set('verdict', d, now); return d; };
Inputs.prototype.lowBeam = function (v, now) {
    const L = this.cfg.lamps, s = v && typeof v === 'object' ? v.statusLowBeam : v;
    this._set('lowLB', has(L.lowOn, s) ? true : has(L.lowOff, s) ? false : null, now);
    this._resolve(now);
};
Inputs.prototype.lamp2 = function (v, now) {
    if (!v || typeof v !== 'object') return;
    const L = this.cfg.lamps, mb = v.controlFunctionMainBeam, fog = v.controlFunctionFrontFogLight;
    this._set('highLE2', has(L.highOn, mb) ? true : has(L.highOff, mb) ? false : null, now);
    this._set('fogLE2', has(L.fogOn, fog) ? true : has(L.fogOff, fog) ? false : null, now);
    this._resolve(now);
};
Inputs.prototype.lightStatus = function (v, now) {
    if (!v || typeof v !== 'object') return;
    const L = this.cfg.lamps, okE = has(L.lightStatusOk, v.statusLightStatusError);
    const b = (x) => (!okE ? null : has(L.on, x) ? true : has(L.off, x) ? false : null);
    this._set('highLS', b(v.statusMainBeam_headlightFlasher), now);
    this._set('lowLS', b(v.statusDippedBeam), now);
    const ff = b(v.statusFrontFogLight), rf = b(v.statusRearFogLight);
    this._set('fogLS', ff === true || rf === true ? true : ff === false && rf !== true ? false : null, now);
    this._set('lsError', v.statusLightStatusError === undefined ? null : v.statusLightStatusError, now);
    this._resolve(now);
};
/** The lamps from their candidates: the first source with a value wins (config order). Emits high_on / high_off. */
Inputs.prototype._resolve = function (now) {
    const g = (k) => (this.vals[k] && this.vals[k].v !== null && this.vals[k].v !== undefined ? this.vals[k] : null);
    const first = (keys) => { for (let i = 0; i < keys.length; i++) { const x = g(keys[i]); if (x) return { v: x.v, at: x.at, src: keys[i] }; } return null; };
    const hk = this.cfg.lamps.highSources.map((s) => (s === 'lightStatus' ? 'highLS' : s === 'lampExterior2' ? 'highLE2' : s));
    const hi = first(hk), lo = first(['lowLB', 'lowLS']), fo = first(['fogLE2', 'fogLS']);
    this.vals.high = hi ? { v: hi.v, at: hi.at } : { v: null, at: this.vals.high ? this.vals.high.at : null };
    this.highSrc = hi ? hi.src : null;
    if (lo) this.vals.low = { v: lo.v, at: lo.at };
    if (fo) this.vals.fog = { v: fo.v, at: fo.at };
    const h = hi ? hi.v : null;
    if (h !== null && this.highNow !== null && h !== this.highNow) this._event(now, h ? 'high_on' : 'high_off');
    if (h !== null) this.highNow = h;
    this._set('flash', !!(h && (this.bits & this.cfg.stalk.pull)), now);
};
Inputs.prototype._event = function (t, kind) { this.events.push({ t, kind }); if (this.events.length > 32) this.events.splice(0, this.events.length - 32); };
Inputs.prototype.stalks = function (v, now) {
    const b = num(v && typeof v === 'object' ? v.operationColumnStalks : v);
    if (b === null) return;
    const up = b & ~this.bits;
    if (up & this.cfg.stalk.pull) this._event(now, 'flash');
    this.bits = b;
    this._set('flash', !!(this.highNow && (this.bits & this.cfg.stalk.pull)), now);
};
Inputs.prototype.bright = function (v, now) { this._set('bright', num(v && typeof v === 'object' ? v.valueBrightnessEnvironment : v), now); };
Inputs.prototype.dayNight = function (v, now) {
    const s = v && typeof v === 'object' ? v.dayNightChangeOver : v, D = this.cfg.dayNight;
    if (has(D.day, s)) this._set('dayNight', 'day', now);
    else if (has(D.night, s)) this._set('dayNight', 'night', now);
};
Inputs.prototype.sun = function (night, now) { this.sunNight = night === null || night === undefined ? null : !!night; this.sunAt = now; };
Inputs.prototype.rain = function (v, now) {
    const raw = num(pick(v, [this.cfg.env.wiperPath]));
    this._set('wiper', raw === null ? null : Math.max(0, Math.min(this.cfg.env.wiperMax, raw)), now);
};
Inputs.prototype.limit = function (kmh, now) { this._set('limit', fin(kmh) && kmh > 0 ? kmh : null, now); };
/**
 * The camera's signs (SignRecognitionFrontCamera): a town-entry sign is a 'town_in' event, a town-exit sign a 'town_out'
 * (CONTRACT 2.5), reported once while the sign stays in the list (an edge, not every message). The algorithm keeps the town.
 */
Inputs.prototype.signs = function (v, now) {
    const T = this.cfg.town, list = arr(v && v.trafficSign);
    let start = false, end = false;
    list.forEach((s) => { const ty = s && typeof s === 'object' ? s.type : undefined; if (has(T.start, ty)) start = true; else if (has(T.end, ty)) end = true; });
    const kind = start ? 'town_in' : end ? 'town_out' : null;
    if (kind && kind !== this.signNow) { this.signEvents.push({ t: now, kind }); if (this.signEvents.length > 8) this.signEvents.shift(); }
    this.signNow = kind;
    this.signsAt = now;
    return kind;
};
Inputs.prototype.speed = function (v, now) {
    const raw = num(v && typeof v === 'object' ? v.speedVehicleCentreOfGravity : v), C = this.cfg.car;
    this._set('speed', raw === null || raw === C.speedNone ? null : raw * C.speedScale, now);
};
Inputs.prototype.yaw = function (v, now) {
    const raw = num(pick(v, this.cfg.car.yawPath)) !== null ? num(pick(v, this.cfg.car.yawPath)) : num(v);
    this._set('yaw', raw === null ? null : raw * this.cfg.car.yawScale, now);
};
Inputs.prototype.msg = function (v, now) { this._set('msg', num(v && typeof v === 'object' ? v.statusNumberCheckControlMessageDisplay : v), now); };
Inputs.prototype.tcp = function (v, now) { this.raw.tcp = v; this.raw.tcpAt = now; };
Inputs.prototype.camRec = function (v) { this.raw.rec = v; };
Inputs.prototype.camPos = function (v, now) { this.raw.pos = v; this.raw.posAt = now; };

/** The present light objects, nearest first, each with its own age. */
Inputs.prototype.lights = function (now) {
    const out = [];
    Object.keys(this.slots).forEach((k) => { const s = this.slots[k]; if (s.o) out.push(Object.assign({}, s.o, { age: Math.max(0, now - s.at) })); });
    return out.sort((a, b) => a.dist - b.dist);
};
/** The fallback objects: objectlistTCP while it is fresh, else the older camera list. */
Inputs.prototype.objects = function (now) {
    const ms = this.cfg.objects.staleMs, sp = this.vals.speed && fin(this.vals.speed.v) ? this.vals.speed.v / 3.6 : null;
    if (this.raw.tcpAt !== null && now - this.raw.tcpAt <= ms) return { v: decodeTcp(this.cfg, this.raw.tcp, sp), at: this.raw.tcpAt, qual: qualOf(this.raw.tcp && this.raw.tcp.eventDataQualifier), src: 'tcp' };
    if (this.raw.posAt !== null) return { v: decodeCam(this.cfg, this.raw.rec, this.raw.pos), at: this.raw.posAt, qual: qualOf(this.raw.pos && this.raw.pos.eventDataQualifier), src: 'cam' };
    if (this.raw.tcpAt !== null) return { v: decodeTcp(this.cfg, this.raw.tcp, sp), at: this.raw.tcpAt, qual: qualOf(this.raw.tcp && this.raw.tcp.eventDataQualifier), src: 'tcp' };
    return { v: null, at: null, qual: null, src: null };
};

/** The snapshot for contract.frameOf (stalk events are handed over once). */
Inputs.prototype.snap = function (now) {
    const g = (k) => this.vals[k] || { v: null, at: null };
    const sun = this.sunNight === null ? { v: null, at: null } : { v: this.sunNight ? 'night' : 'day', at: this.sunAt || now };
    const ev = this.events;
    this.events = [];
    const se = this.signEvents;
    this.signEvents = [];
    return {
        t: now,
        lights: { v: this.lightsAt === null ? null : this.lights(now), at: this.lightsAt },
        verdict: g('verdict'), objects: this.objects(now), low: g('low'), high: g('high'), flash: g('flash'), fog: g('fog'),
        speed: g('speed'), yaw: g('yaw'), bright: g('bright'), sun, dayNight: g('dayNight'), wiper: g('wiper'), limit: g('limit'), urban: { v: null, at: null }, msg: g('msg'),
        stalk: ev, signs: { v: se, at: this.signsAt }, highSrc: this.highSrc || null,
    };
};

/** The driver's lamps now: 'flash' | 'high' | 'low' | 'off' | null (not known). */
Inputs.prototype.lampsNow = function () {
    const lo = this.vals.low ? this.vals.low.v : null, hi = this.vals.high ? this.vals.high.v : null, fl = this.vals.flash ? this.vals.flash.v : null;
    if (hi === true) return fl ? 'flash' : 'high';
    if (lo === true) return 'low';
    if (lo === false && hi !== true) return 'off';
    return null;
};

module.exports = Inputs;
