'use strict';
/**
 * road_view.js - the traffic light, the signs in force and the road scene as the car's camera may report them, turned into a
 * small state a picture can show (round "Road View", package TD; docs/traffic/TD-REPORT.md). Pure and app-agnostic: no I/O, no
 * timers, no words; the clock is injected. The drawing is shared/road_ui.js (both themes).
 *
 * NOTHING HERE IS PROVEN ON THE CAR. No traffic-light, sign-list or road-scene event has been recorded on the owner's car yet.
 * So every encoding this file assumes is a key of config.roadView (DEFAULT below), each with an "assumed" note, as
 * front_vehicle.js does with its scale: a drive's log corrects a line, not the code. Unknown value, bad quality, old data:
 * nothing is shown.
 *
 * The sources (the catalogue reference/car/2026-11-15/someip/someip-interfaces.json; every one read only):
 *   light  cam   de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy, EVENT RecognitionTrafficLightCamera
 *                (32769): trafficLightID (63 default), PositionX/Y/Z (255), Status / Arrow / IndicateDirection / Color /
 *                qualityRecognitionTrafficLight (15 default). All UInt8 with NO enum table: every meaning is ASSUMED.
 *          vsli  de.bmw.infotainment.displaydata.DisplayDataServer2, FIELD functionalLibraryData (getter 1, notifier 32769):
 *                xSpeedLimitAssist.vsliSign, enum VSLISign (named: TRAFFIC_LIGHT_RED, _RED_YELLOW, _YELLOW, _GREEN,
 *                _GREEN_ARROW, _GO_REQUEST, _UNSURE, _WITHOUT_PREDICTION, STOP, RIGHT_OF_WAY, CROSSWALK, LEVEL_CROSSING ...).
 *                The names are the catalogue's; what the car fills in, and when, is unknown.
 *   signs  tsr   de.bmw.dass.TrafficSignRecognition, EVENT TrafficSignRecognition (seen on the car, ~2 a second; both themes
 *                already receive it for the limit): recognitionNoPassing (default 15; read 0 on 2026-11-18). TR-REPORT A.3.3: 0 none,
 *                other small values no overtaking for cars / trucks / its end (ASSUMED: config.roadView.signsCfg.tsrNoPass).
 *                The FIRST sign this round builds: the most likely to work (TR-REPORT 0.4).
 *          cam   de.bmw.environmentalmodel.SignRecognitionFrontCamera, EVENT TrafficSignRecognitionFrontCamera: the event both
 *                themes already receive (config.sign.camera, the limit's witness); eventDataQualifier and trafficSign[] with
 *                type = the 79-value enum TrafficSignType (named).
 *          leg   de.bmw.environmentalmodel.SignRecognitionFrontCameraLegacy, EVENT RecognitionTrafficSignCamera: UInt8
 *                trafficSignType (ASSUMED: the TrafficSignType numbers), qualityRecognitionTrafficSign (3 default); and EVENT
 *                recognitionTrafficSignCamera2 (group 2): the camera list's shape plus `relevance` (bit 1 RELEVANTSIGN: "this sign
 *                applies to me"; a sign without the bit is not shown when the bit set is filled).
 *          vsli  the same VSLISign as above for the point signs (STOP, RIGHT_OF_WAY, CROSSWALK, LEVEL_CROSSING).
 *   scene  lanes de.bmw.environmentalmodel.LaneBoundaries.LaneBoundaries; objects ObjectRecognitionFrontCamera ObjectRecognition +
 *                ObjectPosition (40 slots, joined index by index); beside / behind us: AssistedDrivingViewLateralCollisionAvoidance
 *                .assistedDrivingViewLcaInput's lane-change warning (the rear radars this car has; 3 object ids a side): a side
 *                with a warning or a filled id shows a neutral vehicle in that lane at our foot (never a warning of ours). The decoders follow ACC View's (apps/acc_view/world.js,
 *                round 1120 AA2) exactly; bench/test-road-view.js checks the two give the same answer on the same input.
 *
 * The state (view(now)):
 *   light  { state: 'none' | 'red' | 'redAmber' | 'amber' | 'green' | 'flashAmber' | 'uncertain', arrow: null | 'left' |
 *            'straight' | 'right', sure, age (ms since the last message), src }
 *          'uncertain' = a light is ahead, but the camera is not sure of it or that it is ours: drawn hollow, never as a colour.
 *   signs  [{ id, tier 1..3, age, src }] in force now (a stretch rule until its end sign or stretchMs; a point rule pointMs;
 *          a warning warnMs; an end sign endMs)
 *   scene  { data: 'ok' | 'none' | 'stale' | 'absent', lanes: { src, lines } | null, objects: [...], lead }
 *
 *   strip(view, opts) -> the sign strip: at most 3 items with the limit, in the order limit, light, rule, warning (pure).
 *
 * Plain Node 8 (the car's 8.16.2): no ?. / ?? / object spread. Nothing here throws (every entry point is guarded).
 */

const isNum = (x) => typeof x === 'number' && isFinite(x);
const numOf = (x) => (isNum(x) ? x : typeof x === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(x) ? Number(x) : null);
const pick = (v, path) => { let r = v; (Array.isArray(path) ? path : []).forEach((k) => { r = r === null || r === undefined || typeof r !== 'object' ? undefined : r[k]; }); return r; };
const inList = (a, x) => Array.isArray(a) && (a.indexOf(x) >= 0 || (x !== null && x !== undefined && a.indexOf(String(x)) >= 0));
const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, String(k));
const arr = (a) => (Array.isArray(a) ? a : []);
/** An enum as it may go into a log line: its capital name or its number; text only as its length. */
const word = (x) => {
    if (x === undefined || x === null) return '-';
    if (typeof x === 'number' || typeof x === 'boolean') return String(x);
    if (typeof x === 'string') return /^[A-Z][A-Z0-9_]{0,63}$/.test(x) ? x : /^\s*-?\d+\s*$/.test(x) ? x.trim() : 'text' + x.length;
    return 'struct';
};

const IF = {
    lightCam: 'de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy',
    dds2: 'de.bmw.infotainment.displaydata.DisplayDataServer2',
    signCam: 'de.bmw.environmentalmodel.SignRecognitionFrontCamera',
    signLeg: 'de.bmw.environmentalmodel.SignRecognitionFrontCameraLegacy',
    lanes: 'de.bmw.environmentalmodel.LaneBoundaries',
    objects: 'de.bmw.environmentalmodel.ObjectRecognitionFrontCamera',
    tsr: 'de.bmw.dass.TrafficSignRecognition',
    lca: 'de.bmw.dass.driverassistanceapplications.AssistedDrivingViewLateralCollisionAvoidance',
};

/* ------------------------------------------------------------------ the sign set --------------------------------------- */

/**
 * Our sign set (the brief's three tiers; docs/traffic/TD-REPORT.md 3). id -> { tier, kind, ends }:
 *   tier 1 a rule that holds for a stretch ('start' holds until its end sign; 'end' shows a moment and clears its start);
 *   tier 2 a rule at a point; tier 3 a warning. `ends`: the start sign an end sign clears.
 * The drawings are shared/road_signs.js (one small vector definition each, after the Vienna convention's generic shapes).
 */
const SIGNS = {
    noOvertaking: { tier: 1, kind: 'start' }, noOvertakingEnd: { tier: 1, kind: 'end', ends: 'noOvertaking' },
    town: { tier: 1, kind: 'announce' }, townEnd: { tier: 1, kind: 'end', ends: 'town' },
    motorway: { tier: 1, kind: 'announce' }, motorwayEnd: { tier: 1, kind: 'end', ends: 'motorway' },
    expressway: { tier: 1, kind: 'announce' }, expresswayEnd: { tier: 1, kind: 'end', ends: 'expressway' },
    envZone: { tier: 1, kind: 'announce' }, envZoneEnd: { tier: 1, kind: 'end', ends: 'envZone' },
    stop: { tier: 2, kind: 'point' }, giveWay: { tier: 2, kind: 'point' }, priority: { tier: 2, kind: 'point' },
    priorityEnd: { tier: 2, kind: 'point' }, noEntry: { tier: 2, kind: 'point' },
    crossing: { tier: 3, kind: 'warn' }, children: { tier: 3, kind: 'warn' }, roadWorks: { tier: 3, kind: 'warn' },
    lightAhead: { tier: 3, kind: 'warn' }, levelCrossing: { tier: 3, kind: 'warn' }, slippery: { tier: 3, kind: 'warn' },
    animals: { tier: 3, kind: 'warn' },
};
const SIGN_IDS = Object.keys(SIGNS);

/** TrafficSignType (the catalogue's 79 names and their numbers) -> our sign; anything not here is not ours to draw. */
const SIGN_TYPE = {
    NO_PASSING_SIGN: 'noOvertaking', 1: 'noOvertaking', WITHDRAWAL_NO_PASSING_SIGN: 'noOvertakingEnd', 2: 'noOvertakingEnd',
    NO_ENTRY: 'noEntry', 12: 'noEntry',
    MOTORWAY_START_OF: 'motorway', 14: 'motorway', MOTORWAY_END_OF: 'motorwayEnd', 15: 'motorwayEnd',
    EXPRESSWAY_START_OF: 'expressway', 16: 'expressway', EXPRESSWAY_END_OF: 'expresswayEnd', 17: 'expresswayEnd',
    STOP_SIGN: 'stop', 20: 'stop', GIVE_WAY: 'giveWay', 21: 'giveWay',
    PRIORITY_ROAD_START_OF: 'priority', 22: 'priority', PRIORITY_ROAD_END_OF: 'priorityEnd', 23: 'priorityEnd',
    DS_ROAD_WORKS: 'roadWorks', 39: 'roadWorks', DS_TRAFFIC_LIGHT: 'lightAhead', 42: 'lightAhead',
    DS_ANIMAL_CROSSING: 'animals', 43: 'animals', DS_DOMESTIC_ANIMAL_CROSSING: 'animals', 69: 'animals',
    DS_CHILDREN: 'children', 44: 'children', DS_SPLIPPERY_ROAD: 'slippery', 46: 'slippery',
    DS_PEDESTRIAN_CROSSING: 'crossing', 49: 'crossing',
    DS_TRAIN_CROSS_WITHOUT_BARRIER: 'levelCrossing', 51: 'levelCrossing', DS_TRAIN_CROSS_WITH_BARRIER: 'levelCrossing', 52: 'levelCrossing',
    DS_TRAIN_CROSS: 'levelCrossing', 74: 'levelCrossing',
    CITY_LIMIT_START_OF: 'town', 55: 'town', CITY_LIMIT_END_OF: 'townEnd', 56: 'townEnd',
    ENVIRONMENTAL_ZONE_START_OF: 'envZone', 58: 'envZone', ENVIRONMENTAL_ZONE_END_OF: 'envZoneEnd', 59: 'envZoneEnd',
};

/** VSLISign (DisplayDataServer2, named in the catalogue) -> the light state, or our point sign. GO_REQUEST is the colour only
 *  (green): we never draw a "go"; GREEN_SIGN (likely the green-arrow PLATE, not a lamp) and every other value: nothing. */
const VSLI_LIGHT = {
    TRAFFIC_LIGHT_RED: 'red', 11: 'red', TRAFFIC_LIGHT_RED_YELLOW: 'redAmber', 12: 'redAmber', TRAFFIC_LIGHT_YELLOW: 'amber', 13: 'amber',
    TRAFFIC_LIGHT_GREEN: 'green', 14: 'green', TRAFFIC_LIGHT_GO_REQUEST: 'green', 15: 'green', TRAFFIC_LIGHT_GREEN_ARROW: 'green', 17: 'green',
    TRAFFIC_LIGHT_UNSURE: 'uncertain', 10: 'uncertain', TRAFFIC_LIGHT_WITHOUT_PREDICTION: 'uncertain', 9: 'uncertain',
};
const VSLI_SIGN = { STOP: 'stop', 8: 'stop', RIGHT_OF_WAY: 'priority', 20: 'priority', CROSSWALK: 'crossing', 24: 'crossing', LEVEL_CROSSING: 'levelCrossing', 25: 'levelCrossing' };

const LIGHT_STATES = ['none', 'red', 'redAmber', 'amber', 'green', 'flashAmber', 'uncertain'];
const ARROWS = ['left', 'straight', 'right'];

/* ------------------------------------------------------------------ config --------------------------------------------- */

/** config.roadView's defaults. Each number the car has not proven is here (with its "assumed" note in app.json). */
const DEFAULT = {
    light: 'off', signs: 'off', scene: 'off',           // the test modes (Діагностика writes 'car' | 'demo' | 'replay')
    replay: null,                                       // a replay file (JSON lines) in the app's data folder, for 'replay'
    lightCfg: {
        staleMs: 1000,              // no message for this long: nothing drawn (never a frozen lamp; TR-REPORT D.1: ~1 s)
        confirm: 2,                 // a new colour must come this many messages in a row (one stray message changes nothing)
        flashMs: 2600,              // amber that comes and goes twice within this window is flashing amber
        cam: {
            // ASSUMED (no enum table in the catalogue; TR-REPORT A.3.1's proposal): the camera's codes. Correct from the
            // "road: light ..." log lines of the first city drive (TR-REPORT D.4 items 1-5).
            idNone: [63, 255], colourNone: [0, 15, 255],                // id 63: no light; colour 0 unknown, 15 unfilled
            colour: { 1: 'red', 2: 'amber', 3: 'green', 4: 'redAmber' },
            statusFlash: [2], statusOff: [0, 3],          // Status: 0 not detected, 1 steady, 2 flashing, 3 off / dark
            arrow: { 1: 'left', 2: 'straight', 3: 'right' },            // 0 / 15: no arrow
            qualityMin: 4, qualitySure: 8, qualityNone: [15, 255],      // below Min: nothing; Min..Sure: uncertain; unfilled 15: no veto
            relevantOn: [1], relevantNone: [0, 15, 255],                // IndicateDirection: 1 = our lane / direction (assumed); another
        },                                                              // filled value: a light, but not sure it is ours -> uncertain
        vsliPath: ['xSpeedLimitAssist', 'vsliSign'],
        prefer: ['cam', 'vsli'],     // the first source that spoke within staleMs decides
    },
    signsCfg: {
        stretchMs: 600000,          // a stretch rule (no overtaking) with no end sign seen: gone after 10 min (never frozen)
        announceMs: 10000,          // town / motorway / expressway / zone: shown at the change (the limit carries the rule)
        pointMs: 8000, warnMs: 10000, endMs: 5000,
        camQualifierOk: ['EVENT_DATA_AVAILABLE', 'EVENT_DATA_AVAILABLE_REDUCED', 0, 1],
        legQualityNone: [3, 255], legTypeNone: [0, 63, 255],            // ASSUMED: the legacy event's 3 = no sign, 63 = unfilled
        relevantBit: 1, relevanceNone: [65535],                         // recognitionTrafficSignCamera2: RELEVANTSIGN; 65535 unfilled
        // TrafficSignRecognition.recognitionNoPassing (ASSUMED, TR-REPORT A.3.3): 0 none; 1 no overtaking (cars); 2 for trucks
        // only (does not apply to a car: not shown); 15 unfilled. `end`: values that mean its end (none known yet)
        tsrNoPass: { path: ['recognitionNoPassing'], on: [1], truck: [2], end: [], none: [0, 15, 255] },
        vsliPath: ['xSpeedLimitAssist', 'vsliSign'],
    },
    sceneCfg: {
        range: 100,
        // the rear radars' lane-change warning (ASSUMED meaning of the ids: 0 / 0xFFFFFFFF = none): a side is taken while its
        // status is not NO_WARNING_* (0) or one of its 3 ids is filled; drawn as a neutral vehicle `sideX` m ahead in that lane
        lca: { idNone: [0, 4294967295], sideX: 5, sideY: 3.5, holdMs: 1200, alpha: 0.6 },
        objects: { scale: 1, ySign: 1, xMin: 1, xMax: 95, yMax: 12, lostMs: 500, fadeMs: 600, max: 8 },
        lanes: { scale: 1, ySign: 1, minProb: 0.3, staleMs: 1500, maxLen: 120 },
        absentMs: 10000,
    },
    logMs: 1000, maxLines: 1500,
};

function merge1(base, over) {
    const out = Object.assign({}, base);
    Object.keys(over && typeof over === 'object' ? over : {}).forEach((k) => {
        if (k.charAt(0) === '_' || over[k] === undefined) return;
        out[k] = over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
            ? merge1(base[k], over[k]) : over[k];
    });
    return out;
}
/** config.roadView over DEFAULT (deep for the *Cfg objects); a non-object: the defaults (every test off). */
function cfgOf(c) { return merge1(DEFAULT, c && typeof c === 'object' ? c : {}); }
const MODES = ['car', 'demo', 'replay'];
/** A test's mode: 'car' | 'demo' | 'replay', or null (off). */
function modeOf(cfg, what) { const m = cfg && cfg[what]; return MODES.indexOf(m) >= 0 ? m : null; }

/* ------------------------------------------------------------------ the light: one message ------------------------------ */

/** RecognitionTrafficLightCamera -> { state, arrow, sure, why } (pure). why: '' or what vetoed it. */
function lightOfCam(lc, v) {
    const C = (lc || DEFAULT.lightCfg).cam || DEFAULT.lightCfg.cam;
    const out = { state: 'none', arrow: null, sure: false, why: 'shape', raw: null };
    if (!v || typeof v !== 'object') return out;
    const id = numOf(v.trafficLightID), col = numOf(v.trafficLightColor), stat = numOf(v.trafficLightStatus), arw = numOf(v.trafficLightArrow);
    const dir = numOf(v.trafficLightIndicateDirection), q = numOf(v.qualityRecognitionTrafficLight);
    out.raw = { id, col, st: stat, arr: arw, dir, q, x: numOf(v.trafficLightPositionX), y: numOf(v.trafficLightPositionY), z: numOf(v.trafficLightPositionZ) };
    if (id === null || inList(C.idNone, id)) { out.why = 'no light'; return out; }
    if (col === null || inList(C.colourNone, col) || inList(C.statusOff, stat)) { out.why = 'no colour'; return out; }
    if (q !== null && !inList(C.qualityNone, q) && q < C.qualityMin) { out.why = 'quality'; return out; }
    let st = has(C.colour, col) ? C.colour[String(col)] : null;
    if (!st || LIGHT_STATES.indexOf(st) < 0) { out.why = 'unknown colour'; return out; }
    if (st === 'amber' && inList(C.statusFlash, stat)) st = 'flashAmber';
    out.arrow = has(C.arrow, arw) && ARROWS.indexOf(C.arrow[String(arw)]) >= 0 ? C.arrow[String(arw)] : null;
    const lowQ = q !== null && !inList(C.qualityNone, q) && q < C.qualitySure;
    const notOurs = dir !== null && !inList(C.relevantNone, dir) && !inList(C.relevantOn, dir);
    if (lowQ || notOurs) { out.state = 'uncertain'; out.arrow = null; out.why = lowQ ? 'low quality' : 'not ours'; return out; }
    out.state = st; out.sure = true; out.why = '';
    return out;
}

/** functionalLibraryData (DisplayDataServer2) -> { state, arrow, sure, why } from its vsliSign (pure). */
function lightOfVsli(lc, v) {
    const L = lc || DEFAULT.lightCfg;
    const out = { state: 'none', arrow: null, sure: false, why: 'shape', raw: null };
    const s = pick(v, L.vsliPath);
    out.raw = { vsli: word(s) };
    if (s === undefined || s === null) return out;
    const st = has(VSLI_LIGHT, s) ? VSLI_LIGHT[String(s)] : null;
    if (!st) { out.why = 'no light'; return out; }
    out.state = st; out.sure = st !== 'uncertain'; out.why = '';
    return out;
}

/* ------------------------------------------------------------------ the signs: one message ------------------------------ */

/** TrafficSignRecognitionFrontCamera -> [sign id] (pure). An event whose qualifier is not "available" says nothing. */
function signsOfCam(sc, v) {
    const S = sc || DEFAULT.signsCfg;
    if (!v || typeof v !== 'object') return [];
    const q = v.eventDataQualifier;
    if (q !== undefined && q !== null && !inList(S.camQualifierOk, q)) return [];
    const list = Array.isArray(v.trafficSign) ? v.trafficSign : v.trafficSign && typeof v.trafficSign === 'object' ? [v.trafficSign] : [];
    const out = [];
    list.forEach((s) => { const t = s && s.type; const id = has(SIGN_TYPE, t) ? SIGN_TYPE[String(t)] : null; if (id && out.indexOf(id) < 0) out.push(id); });
    return out;
}

/**
 * TrafficSignRecognition (the event the limit comes from) -> its no-overtaking state (pure): 'on' | 'end' | 'none' (a filled
 * "nothing") | null (unfilled, unknown, or for trucks only: says nothing). ASSUMED codes: config signsCfg.tsrNoPass.
 */
function noPassOfTsr(sc, v) {
    const N = (sc || DEFAULT.signsCfg).tsrNoPass || DEFAULT.signsCfg.tsrNoPass;
    const raw = pick(v, N.path);
    if (raw === undefined || raw === null) return null;
    const n = numOf(raw);
    const x = n !== null ? n : raw;
    if (inList(N.on, x)) return 'on';
    if (inList(N.end, x)) return 'end';
    if (inList(N.truck, x)) return null;
    if (x === 0 || x === '0') return 'none';
    return null;
}

/** recognitionTrafficSignCamera2 (legacy, group 2) -> [sign id]: the camera list's shape, each sign kept only when its relevance
 *  bit set is unfilled or has RELEVANTSIGN (pure). */
function signsOfCam2(sc, v) {
    const S = sc || DEFAULT.signsCfg;
    if (!v || typeof v !== 'object') return [];
    const list = Array.isArray(v.trafficSign) ? v.trafficSign : v.trafficSign && typeof v.trafficSign === 'object' ? [v.trafficSign] : [];
    const kept = list.filter((t) => {
        const r = numOf(t && t.relevance);
        return r === null || inList(S.relevanceNone, r) || (r & (S.relevantBit || 1)) !== 0;
    });
    return signsOfCam(S, Object.assign({}, v, { trafficSign: kept }));
}

/** assistedDrivingViewLcaInput -> { left, right } (a vehicle beside / behind us on that side), or null when it says nothing (pure). */
function sidesOfLca(oc, v) {
    const L = ((oc || DEFAULT.sceneCfg).lca) || DEFAULT.sceneCfg.lca;
    const w = v && v.statusLaneChangeWarning;
    if (!w || typeof w !== 'object') return null;
    const filled = (k) => { const n = numOf(w[k]); return n !== null && !inList(L.idNone, n); };
    const on = (k) => { const x = w[k]; const n = numOf(x); return n !== null ? n > 0 : typeof x === 'string' && /^(ACUTE_)?WARNING|FUNCTION_ACTIVE_ACUTE/.test(x); };
    return {
        left: on('statusLaneChangeWarningLeft') || filled('objectId1LaneChangeWarningLeft') || filled('objectId2LaneChangeWarningLeft') || filled('objectId3LaneChangeWarningLeft'),
        right: on('statusLaneChangeWarningRight') || filled('objectId1LaneChangeWarningRight') || filled('objectId2LaneChangeWarningRight') || filled('objectId3LaneChangeWarningRight'),
    };
}

/** RecognitionTrafficSignCamera (legacy, UInt8) -> [sign id] (pure). ASSUMED: its type is the TrafficSignType number. */
function signsOfLeg(sc, v) {
    const S = sc || DEFAULT.signsCfg;
    if (!v || typeof v !== 'object') return [];
    const t = numOf(v.trafficSignType), q = numOf(v.qualityRecognitionTrafficSign);
    if (t === null || inList(S.legTypeNone, t) || (q !== null && inList(S.legQualityNone, q))) return [];
    const id = has(SIGN_TYPE, t) ? SIGN_TYPE[String(t)] : null;
    return id ? [id] : [];
}

/** functionalLibraryData's vsliSign -> [sign id] for the point signs it names (pure). */
function signsOfVsli(sc, v) {
    const s = pick(v, (sc || DEFAULT.signsCfg).vsliPath);
    const id = has(VSLI_SIGN, s) ? VSLI_SIGN[String(s)] : null;
    return id ? [id] : [];
}

/* ------------------------------------------------------------------ the scene: after ACC View's world.js ---------------- */

const OBJECT_TYPE = {
    PEDESTRIAN: 'ped', 0: 'ped', CYCLIST: 'cyc', 1: 'cyc', BIKE_MOTORBIKE_MOPED: 'two', 2: 'two',
    CAR_WITH_OR_WITHOUT_TRAILER: 'car', 3: 'car', TRUCK_BUS_VAN: 'truck', 4: 'truck',
    OTHER_VEHICLE_CUSTOMARY_ROAD_USER_ACCORDING_TO_SCENE_CATALOGUE: 'unk', 5: 'unk', UNKNOWN: 'unk', 8: 'unk',
    ROAD_BOUNDARY: null, 6: null, BRIDGE: null, 7: null, SIGNAL_UNFILLED: null, 255: null,
};
const LINE_TYPE = {
    SOLID: 'solid', 2: 'solid', DASHED: 'dashed', 1: 'dashed', DOTTED: 'dashed', 3: 'dashed',
    DOUBLE_LINE_CROSSABLE: 'double', 5: 'double', DOUBLE_LINE_UNCROSSABLE: 'double', 6: 'double',
    MULTIPLE_LINES_CROSSABLE: 'double', 7: 'double', MULTIPLE_LINES_UNCROSSABLE: 'double', 8: 'double',
    ROAD_EDGE: 'edge', 4: 'edge', CURB: 'edge', 9: 'edge', SNOW_EDGE: 'edge', 10: 'edge',
};
const TYPE_CODE = { none: 0, solid: 1, dashed: 2, double: 3, edge: 4 };
const CLS_CODE = { car: 1, truck: 2, two: 3, ped: 4, cyc: 5, unk: 6 };

/** ObjectRecognition + ObjectPosition (slot by slot) -> [{ id, cls, x, y }] in the drawn range (pure; as world.camObjects). */
function objectsOf(oc, rec, pos) {
    const C = (oc || DEFAULT.sceneCfg).objects || DEFAULT.sceneCfg.objects, out = [];
    const ri = arr(rec && rec.objectRecognitionInfo), pi = arr(pos && pos.objectPositionInfo);
    const nn = numOf(pos && pos.numberOfObjects);
    const n = Math.min(40, nn !== null ? nn : pi.length, pi.length);
    for (let i = 0; i < n; i++) {
        const p = pi[i] || {}, r = ri[i] || {};
        const cls = has(OBJECT_TYPE, r.classificationType) ? OBJECT_TYPE[String(r.classificationType)] : 'unk';
        if (cls === null) continue;
        const x = numOf(p.positionX), y = numOf(p.positionY);
        if (x === null || y === null) continue;
        const o = { id: 'c' + (numOf(r.objectID) !== null ? r.objectID : i), cls, x: x * C.scale, y: y * C.scale * C.ySign };
        if (o.x >= C.xMin && o.x <= C.xMax && Math.abs(o.y) <= C.yMax) out.push(o);
    }
    return out;
}

/** LaneBoundaries -> { src: 'measured', lines: [{ y0, a, c, dc, len, type, prob }] (left to right) } or null (as world.laneModel). */
function lanesOf(lcIn, v) {
    const L = (lcIn || DEFAULT.sceneCfg).lanes || DEFAULT.sceneCfg.lanes, lines = [];
    const b = arr(v && v.laneBoundaryFront), pr = arr(v && v.laneBoundaryPropertiesFront);
    for (let i = 0; i < Math.min(4, b.length); i++) {
        const s = b[i] || {}, p = pr[i] || {};
        const q = s.modelQualifier;
        if (q === 'LANE_BOUNDARY_MODEL_NOT_AVAILABLE' || q === 2 || q === 'SIGNAL_UNFILLED' || q === 255) continue;
        const prob = numOf(s.existenceProbability);
        if (prob !== null && prob < L.minProb) continue;
        const y0 = numOf(s.pointSegment1 && s.pointSegment1.y), a = numOf(s.baseSegment1 && s.baseSegment1.angle), c = numOf(s.baseSegment1 && s.baseSegment1.curvature);
        if (y0 === null) continue;
        const ti = p.typeInfo || {};
        const type = has(LINE_TYPE, ti.type) ? LINE_TYPE[String(ti.type)] : 'solid';
        const len = numOf(s.parametersSegment1 && s.parametersSegment1.validLength), len2 = numOf(s.parametersSegment2 && s.parametersSegment2.validLength);
        lines.push({
            y0: y0 * L.scale * L.ySign, a: (a || 0) * L.ySign, c: (c || 0) * L.ySign / L.scale, dc: (numOf(s.parametersSegment1 && s.parametersSegment1.curvatureChange) || 0) * L.ySign,
            len: Math.min(L.maxLen, Math.max(10, ((len || 0) + (len2 || 0)) * L.scale || L.maxLen)), type, prob: prob === null ? 1 : prob,
        });
    }
    if (!lines.length) return null;
    lines.sort((p, q) => q.y0 - p.y0);
    return { src: 'measured', lines };
}

/** The ego lane: the nearest line left (y >= 0) and right of us; its centre, heading, curvature and half width (as world.egoOf). */
function egoOf(lanes) {
    const ls = lanes && lanes.lines ? lanes.lines : [];
    let left = null, right = null;
    ls.forEach((l) => { if (l.y0 >= 0 && (!left || l.y0 < left.y0)) left = l; if (l.y0 < 0 && (!right || l.y0 > right.y0)) right = l; });
    const half = left && right ? Math.max(1.2, Math.min(2.6, (left.y0 - right.y0) / 2)) : 1.75;
    if (left && right) return { y0: (left.y0 + right.y0) / 2, a: (left.a + right.a) / 2, c: (left.c + right.c) / 2, half };
    const one = left || right;
    if (one) return { y0: one.y0 + (one === left ? -half : half), a: one.a, c: one.c, half };
    return { y0: 0, a: 0, c: 0, half };
}

/* ------------------------------------------------------------------ the demo -------------------------------------------- */

/** The light's demo cycle: [state, arrow, ms]. Every state of the brief's 1.1, then nothing. */
const DEMO_LIGHT = [['red', null, 4000], ['redAmber', null, 1500], ['green', null, 4000], ['green', 'left', 3000], ['amber', null, 2000],
    ['flashAmber', null, 4000], ['uncertain', null, 3000], ['none', null, 2500]];
/** The signs' demo cycle: [[ids], ms]: the strip's combinations. */
const DEMO_SIGNS = [[['noOvertaking'], 4000], [['noOvertaking', 'children'], 4000], [['stop'], 3000], [['giveWay', 'roadWorks'], 4000],
    [['town'], 3000], [['priority', 'crossing'], 4000], [['lightAhead'], 3000], [['noEntry'], 3000], [['motorway'], 3000],
    [['slippery', 'animals'], 4000], [['levelCrossing'], 3000], [['envZone'], 3000], [[], 2500]];
/** The scene's six situations (the brief's 2): name, ms. */
const DEMO_SCENE = [['empty', 5000], ['ahead', 5000], ['traffic', 5000], ['lightRed', 5000], ['lightGreen', 5000], ['nolanes', 5000]];

function cycleAt(list, ms, durOf) {
    let total = 0;
    list.forEach((e) => { total += durOf(e); });
    let t = ((ms % total) + total) % total;
    for (let i = 0; i < list.length; i++) { const d = durOf(list[i]); if (t < d) return { e: list[i], i, t }; t -= d; }
    return { e: list[0], i: 0, t: 0 };
}

function lanesDemo(n, c, edgeL, edgeR) {
    const lines = [];
    for (let k = -n - 1; k <= n; k++) {
        const y = (k + 0.5) * 3.5;
        const outer = k === -n - 1 || k === n;
        lines.push({ y0: y, a: 0, c: c || 0, dc: 0, len: 110, type: outer ? 'edge' : 'dashed', prob: 1 });
    }
    lines.sort((p, q) => q.y0 - p.y0);
    if (edgeL === false) lines.shift();
    if (edgeR === false) lines.pop();
    return { src: 'demo', lines };
}

/** A demo situation at time t (ms within it): { lanes, objects, light } (pure). */
function demoScene(name, t) {
    const s = t / 1000, O = (id, cls, x, y) => ({ id, cls, x, y });
    if (name === 'empty') return { lanes: lanesDemo(1, 0), objects: [], light: null };
    if (name === 'ahead') return { lanes: lanesDemo(1, 0), objects: [O('a1', 'car', 28 - 4 * Math.sin(s), 0)], light: null };
    if (name === 'traffic') {
        return { lanes: lanesDemo(1, 1 / 600), objects: [O('t1', 'car', 34, 0.1), O('t2', 'truck', 22 + 3 * s, 3.5), O('t3', 'car', 48 - 2 * s, -3.5), O('t4', 'car', 12 + s, -3.6), O('t5', 'two', 60, 3.4)], light: null };
    }
    if (name === 'lightRed') return { lanes: lanesDemo(1, 0), objects: [O('r1', 'car', 14, 0), O('r2', 'car', 16, 3.5), O('r3', 'ped', 30, -6)], light: { state: 'red', arrow: null, x: 40 } };
    if (name === 'lightGreen') return { lanes: lanesDemo(1, 0), objects: [O('g1', 'car', 24 + 3 * s, 0), O('g2', 'car', 30 + 2 * s, -3.5)], light: { state: 'green', arrow: null, x: 45 } };
    return { lanes: null, objects: [O('n1', 'car', 26, 0.2)], light: null };
}

/* ------------------------------------------------------------------ the tracker ----------------------------------------- */

/**
 * create(cfgIn, { log, clock }) -> { feed*, view, start, stop, state, cfg }. Feed every value; ask view(now) as often as the
 * picture wants (the stale clocks run in it). Every entry point is guarded: nothing here throws into the engine.
 */
function create(cfgIn, o) {
    const opt = o || {};
    const cfg = cfgOf(cfgIn);
    const now = () => { try { return opt.clock ? opt.clock() : Date.now(); } catch (e) { return Date.now(); } };
    const st = {
        started: 0, lines: 0, first: {}, logAt: {},
        light: { src: {}, shown: null, cand: null, candN: 0, amberSeen: [], flashUntil: 0, lastKey: '' },
        signs: {},                  // id -> { at (last seen), first, src }
        scene: { lanes: null, lanesAt: 0, objs: {}, objAt: 0, recAt: 0, rec: null, ever: false },
        n: {},
    };
    const say = (line) => {
        if (st.lines >= cfg.maxLines) return;
        st.lines++;
        try { if (opt.log && opt.log.info) opt.log.info(line); } catch (e) { /* never */ }
    };
    /** One line on the first message of each source: the drive with a test on answers "does the car send it" too. */
    function firstOf(src, text) {
        st.n[src] = (st.n[src] || 0) + 1;
        if (st.first[src]) return;
        st.first[src] = true;
        say('road: first ' + src + ' ' + text);
    }
    const guard = (what, fn) => { try { return fn(); } catch (e) { try { if (opt.log && opt.log.warn) opt.log.warn('road: ' + what + ': ' + (e && e.message || e)); } catch (e2) { /* never */ } return null; } };

    /* ---- the light ---- */
    function lightFeed(src, r) {
        const t = now(), L = st.light;
        L.src[src] = { r, at: t };
        // flashing amber from the colour's own rhythm: amber that comes back within flashMs of going
        const S = L.src[src];
        if (r.state === 'amber') { if (!S.amber) { L.amberSeen.push(t); S.amber = true; } } else S.amber = false;
        while (L.amberSeen.length && t - L.amberSeen[0] > cfg.lightCfg.flashMs) L.amberSeen.shift();
        if (L.amberSeen.length >= 2) L.flashUntil = t + cfg.lightCfg.flashMs;
    }
    function lightNow(t) {
        const L = st.light, LC = cfg.lightCfg;
        let use = null, src = null;
        (LC.prefer || ['cam', 'vsli']).concat(['demo', 'replay']).forEach((k) => { const s = L.src[k]; if (!use && s && t - s.at <= LC.staleMs) { use = s.r; src = k; } });
        const none = { state: 'none', arrow: null, sure: false, age: null, src: null };
        if (!use) { L.shown = null; return none; }
        const car = src === 'cam' || src === 'vsli';
        let state = use.state;
        const arrow = use.arrow;
        // flashing amber from its rhythm (the lamp's dark phase included); the demo and a replay say it themselves
        if ((state === 'amber' || state === 'none') && t < L.flashUntil && car) state = 'flashAmber';
        if (state === 'none') { L.shown = null; return none; }
        // a new state must come `confirm` messages in a row from the car (demo and replay: at once); until then the state
        // shown before stays while it is fresh, else nothing
        const key = state + '|' + (arrow || '');
        if (car && state !== 'flashAmber' && (!L.shown || L.shown.key !== key)) {
            const run = runOf[src];
            const n = run && run.key === use.state + '|' + (use.arrow || '') ? run.n : 0;
            if (n < Math.max(1, LC.confirm)) return L.shown && t - L.shown.at <= LC.staleMs ? L.shown.v : none;
        }
        const v = { state, arrow: state === 'uncertain' ? null : arrow, sure: state !== 'uncertain' && !!use.sure, age: t - L.src[src].at, src };
        L.shown = { key, v, at: t };
        return v;
    }
    // how many messages in a row of a source said the same state (the confirmation above)
    const runOf = {};
    function noteRun(src, r) {
        const key = r.state + '|' + (r.arrow || '');
        const id = r.raw && r.raw.id !== undefined ? r.raw.id : null;
        const x = runOf[src] || (runOf[src] = { key: null, n: 0, id: null });
        // another light (a new id): gone at once, the new one is confirmed from the start (TR-REPORT D.1)
        if (src === 'cam' && x.id !== null && id !== null && id !== x.id) { st.light.shown = null; x.key = null; }
        x.id = id;
        if (x.key === key) x.n++; else { x.key = key; x.n = 1; }
    }
    function lightLog(src, r) {
        const k = src + ':' + r.state + ':' + (r.arrow || '') + ':' + r.why;
        if (k === st.light.lastKey) return;
        const t = now();
        if (t - (st.logAt.light || -1e9) < cfg.logMs) return;
        st.light.lastKey = k; st.logAt.light = t;
        const raw = r.raw || {};
        say('road: light ' + src + ' ' + r.state + (r.arrow ? ' arrow ' + r.arrow : '') + (r.why ? ' (' + r.why + ')' : '') + ' raw ' +
            Object.keys(raw).map((q) => q + ' ' + (raw[q] === null ? '-' : raw[q])).join(' '));
    }

    /* ---- the signs ---- */
    function signFeed(ids, src) {
        const t = now();
        ids.forEach((id) => {
            const d = SIGNS[id];
            if (!d) return;
            const was = st.signs[id];
            if (!was) say('road: sign ' + id + ' (' + src + ')');
            st.signs[id] = { at: t, first: was ? was.first : t, src };
            if (d.kind === 'end' && d.ends && st.signs[d.ends]) delete st.signs[d.ends];
            // a start sign seen again after its end sign: the end sign goes
            Object.keys(SIGNS).forEach((k) => { if (SIGNS[k].ends === id && st.signs[k] && st.signs[k].at < t) delete st.signs[k]; });
        });
    }
    function lifeOf(id) {
        const k = SIGNS[id].kind, S = cfg.signsCfg;
        return k === 'start' ? S.stretchMs : k === 'announce' ? S.announceMs : k === 'end' ? S.endMs : k === 'point' ? S.pointMs : S.warnMs;
    }
    function signsNow(t) {
        const out = [];
        Object.keys(st.signs).forEach((id) => {
            const s = st.signs[id];
            if (t - s.at > lifeOf(id) || t < s.at - 60000) { delete st.signs[id]; return; }
            out.push({ id, tier: SIGNS[id].tier, kind: SIGNS[id].kind, age: t - s.at, since: t - s.first, src: s.src });
        });
        // the newest first within a tier
        out.sort((a, b) => a.tier - b.tier || a.age - b.age);
        return out;
    }

    /* ---- the scene ---- */
    function sceneNow(t) {
        const S = st.scene, C = cfg.sceneCfg;
        const lanes = S.lanes && t - S.lanesAt <= C.lanes.staleMs ? S.lanes : null;
        const life = C.objects.lostMs + C.objects.fadeMs, objects = [];
        Object.keys(S.objs).forEach((id) => {
            const ob = S.objs[id], lost = t - ob.seen;
            if (lost > life || lost < -60000) { delete S.objs[id]; return; }
            const alpha = lost <= C.objects.lostMs ? 1 : Math.max(0, 1 - (lost - C.objects.lostMs) / C.objects.fadeMs);
            if (alpha > 0.02) objects.push({ id, cls: ob.cls, x: ob.x, y: ob.y, alpha });
        });
        // the rear radars: a neutral vehicle beside / behind us in the lane of the side they report
        if (S.side && t - S.side.at <= C.lca.holdMs) {
            [['left', 1], ['right', -1]].forEach((q) => { if (S.side[q[0]]) objects.push({ id: 'lca' + q[0], cls: 'car', x: C.lca.sideX, y: q[1] * C.lca.sideY, alpha: isNum(C.lca.alpha) ? C.lca.alpha : 0.6, side: true }); });
        }
        objects.sort((a, b) => a.x - b.x);
        const objs = objects.slice(0, C.objects.max);
        const e = egoOf(lanes);
        let lead = null;
        objs.forEach((ob) => {
            if (ob.side || ['car', 'truck', 'two', 'unk'].indexOf(ob.cls) < 0) return;
            const c = e.y0 + ob.x * (e.a + 0.5 * e.c * ob.x);
            if (Math.abs(ob.y - c) < e.half * 0.8 && (!lead || ob.x < lead.x)) lead = ob;
        });
        if (lead) lead.lead = true;
        const fresh = !!lanes || objs.some((ob) => !ob.side);
        const data = fresh ? 'ok' : !S.ever ? (t - st.started >= C.absentMs ? 'absent' : 'none') : 'stale';
        return { data, lanes, objects: objs, lead: lead ? { x: lead.x, y: lead.y, cls: lead.cls } : null, ego: e, light: S.light && t - S.lightAt < 1500 ? S.light : null };
    }
    function objectsFeed(list, src) {
        const t = now(), S = st.scene;
        S.ever = true;
        const seen = {};
        list.forEach((ob) => { seen[ob.id] = true; S.objs[ob.id] = { cls: ob.cls, x: ob.x, y: ob.y, seen: t, src }; });
        S.objAt = t;
    }

    let demo = null;           // { light, signs, scene, t0 } while a demo runs
    const api = {
        cfg,
        /** RecognitionTrafficLightCamera (an event). */
        lightCam(v) {
            guard('light cam', () => {
                const r = lightOfCam(cfg.lightCfg, v);
                const R = r.raw || {};
                firstOf('lightCam', '(TrafficLightRecognitionFrontCameraLegacy.RecognitionTrafficLightCamera) id ' + R.id + ' colour ' + R.col + ' status ' + R.st + ' quality ' + R.q);
                noteRun('cam', r); lightFeed('cam', r); lightLog('cam', r);
            });
        },
        /** functionalLibraryData of DisplayDataServer2 (a field): the light and the point signs it names. */
        dds2(v, want) {
            guard('dds2', () => {
                const w = want || {};
                firstOf('dds2', '(DisplayDataServer2.functionalLibraryData) vsliSign ' + word(pick(v, cfg.lightCfg.vsliPath)));
                if (w.light !== false) { const r = lightOfVsli(cfg.lightCfg, v); noteRun('vsli', r); lightFeed('vsli', r); lightLog('vsli', r); }
                if (w.signs !== false) { const ids = signsOfVsli(cfg.signsCfg, v); if (ids.length) signFeed(ids, 'vsli'); }
            });
        },
        /** TrafficSignRecognitionFrontCamera (the event both themes already receive). */
        signCam(v) {
            guard('sign cam', () => {
                const ids = signsOfCam(cfg.signsCfg, v);
                const list = v && Array.isArray(v.trafficSign) ? v.trafficSign : [];
                firstOf('signCam', '(SignRecognitionFrontCamera.TrafficSignRecognitionFrontCamera) qualifier ' + word(v && v.eventDataQualifier) + ' signs ' + list.length +
                    ' types ' + list.slice(0, 4).map((s) => word(s && s.type)).join(','));
                if (ids.length) signFeed(ids, 'cam');
            });
        },
        /** TrafficSignRecognition (the limit's event, already received): its no-overtaking member. While it says "on" the sign
         *  is in force; a filled "none" (0) or its end clears it at once (it is a state, not a sighting). */
        tsr(v) {
            guard('tsr', () => {
                const np = noPassOfTsr(cfg.signsCfg, v);
                const raw = pick(v, cfg.signsCfg.tsrNoPass.path);
                firstOf('tsr', '(TrafficSignRecognition.TrafficSignRecognition) recognitionNoPassing ' + word(raw) + ' countryCoding ' + word(v && v.countryCodingTrafficSign));
                if (word(raw) !== st.npRaw) { st.npRaw = word(raw); say('road: no overtaking raw ' + st.npRaw + ' -> ' + (np || 'nothing')); }
                if (np === 'on') signFeed(['noOvertaking'], 'tsr');
                else if (np === 'end') signFeed(['noOvertakingEnd'], 'tsr');
                else if (np === 'none' && st.signs.noOvertaking && st.signs.noOvertaking.src === 'tsr') delete st.signs.noOvertaking;
            });
        },
        /** recognitionTrafficSignCamera2 (legacy, group 2: with the relevance bits). */
        signCam2(v) {
            guard('sign cam2', () => {
                const list = v && Array.isArray(v.trafficSign) ? v.trafficSign : [];
                firstOf('signCam2', '(SignRecognitionFrontCameraLegacy.recognitionTrafficSignCamera2) qualifier ' + word(v && v.eventDataQualifier) + ' signs ' + list.length);
                const ids = signsOfCam2(cfg.signsCfg, v);
                if (ids.length) signFeed(ids, 'cam2');
            });
        },
        /** assistedDrivingViewLcaInput: the rear radars' lane-change warning, as "a vehicle beside / behind us". */
        lca(v) {
            guard('lca', () => {
                const sd = sidesOfLca(cfg.sceneCfg, v);
                firstOf('lca', '(AssistedDrivingViewLateralCollisionAvoidance.assistedDrivingViewLcaInput) left ' + (sd ? sd.left : '-') + ' right ' + (sd ? sd.right : '-'));
                if (sd) st.scene.side = { left: sd.left, right: sd.right, at: now() };
            });
        },
        /** RecognitionTrafficSignCamera (legacy UInt8). */
        signLeg(v) {
            guard('sign legacy', () => {
                firstOf('signLeg', '(SignRecognitionFrontCameraLegacy.RecognitionTrafficSignCamera) type ' + word(v && v.trafficSignType) + ' quality ' + word(v && v.qualityRecognitionTrafficSign));
                const ids = signsOfLeg(cfg.signsCfg, v);
                if (ids.length) signFeed(ids, 'leg');
            });
        },
        /** LaneBoundaries (an event). */
        lanes(v) {
            guard('lanes', () => {
                const m = lanesOf(cfg.sceneCfg, v);
                firstOf('lanes', '(LaneBoundaries.LaneBoundaries) lines ' + (m ? m.lines.length : 0));
                st.scene.ever = true;
                if (m) { st.scene.lanes = m; st.scene.lanesAt = now(); }
            });
        },
        /** ObjectRecognition (classes, ids) and ObjectPosition (x, y): joined slot by slot when the positions come. */
        objRec(v) { guard('objects', () => { firstOf('objRec', '(ObjectRecognitionFrontCamera.ObjectRecognition)'); st.scene.rec = v; st.scene.recAt = now(); }); },
        objPos(v) {
            guard('objects', () => {
                const list = objectsOf(cfg.sceneCfg, now() - st.scene.recAt < 500 ? st.scene.rec : null, v);
                firstOf('objPos', '(ObjectRecognitionFrontCamera.ObjectPosition) objects ' + list.length);
                objectsFeed(list, 'cam');
            });
        },
        /** A demo for the tests that are in 'demo' mode: { light, signs, scene } booleans. */
        demo(which) { demo = which ? { light: !!which.light, signs: !!which.signs, scene: !!which.scene, t0: now() } : null; },
        /** The demo's own feed: called by view() while a demo runs. */
        demoTick(t) {
            if (!demo) return;
            const ms = t - demo.t0;
            if (demo.light) {
                const c = cycleAt(DEMO_LIGHT, ms, (e) => e[2]).e;
                st.light.src.demo = { r: { state: c[0], arrow: c[1], sure: c[0] !== 'uncertain' }, at: c[0] === 'none' ? -1e12 : t };
            }
            if (demo.signs) {
                const c = cycleAt(DEMO_SIGNS, ms, (e) => e[1]);
                if (c.i !== demo.signI) { demo.signI = c.i; Object.keys(st.signs).forEach((k) => { if (st.signs[k].src === 'demo') delete st.signs[k]; }); }
                c.e[0].forEach((id) => { st.signs[id] = { at: t, first: st.signs[id] ? st.signs[id].first : t, src: 'demo' }; });
            }
            if (demo.scene) {
                const c = cycleAt(DEMO_SCENE, ms, (e) => e[1]);
                const sc = demoScene(c.e[0], c.t);
                st.scene.ever = true;
                if (sc.lanes) { st.scene.lanes = sc.lanes; st.scene.lanesAt = t; } else st.scene.lanes = null;
                Object.keys(st.scene.objs).forEach((k) => { if (st.scene.objs[k].src === 'demo') delete st.scene.objs[k]; });
                objectsFeed(sc.objects, 'demo');
                st.scene.light = sc.light; st.scene.lightAt = t; st.scene.demoName = c.e[0];
                if (sc.light && !demo.light) st.light.src.demo = { r: { state: sc.light.state, arrow: null, sure: true }, at: t };
            }
        },
        /** The state now. */
        view(t0) {
            const r = guard('view', () => {
                const t = isNum(t0) ? t0 : now();
                if (demo) api.demoTick(t);
                const light = lightNow(t);
                const scene = sceneNow(t);
                if (!scene.light && light.state !== 'none') scene.light = { state: light.state, arrow: light.arrow, x: null };
                return { light, signs: signsNow(t), scene, demo: demo ? (st.scene.demoName || null) : null };
            });
            return r || { light: { state: 'none', arrow: null, sure: false, age: null, src: null }, signs: [], scene: { data: 'none', lanes: null, objects: [], lead: null, ego: egoOf(null), light: null } };
        },
        start() { st.started = now(); say('road: on (light ' + (cfg.light || 'off') + ', signs ' + (cfg.signs || 'off') + ', scene ' + (cfg.scene || 'off') + '; light stale ' + cfg.lightCfg.staleMs + ' ms, confirm ' + cfg.lightCfg.confirm + ')'); },
        stop(why) { say('road: off' + (why ? ' (' + why + ')' : '')); demo = null; st.light.src = {}; st.signs = {}; st.scene.objs = {}; st.scene.lanes = null; },
        state: () => ({ lines: st.lines, first: Object.keys(st.first), n: Object.assign({}, st.n), signs: Object.keys(st.signs), demo: !!demo }),
        /** A replay line { iface, event, value } (the file reader is road_ui's): routed as the car's own message would be. */
        replay(m) {
            guard('replay', () => {
                if (!m || typeof m !== 'object') return;
                const k = String(m.iface || '') + '.' + String(m.event || m.field || '');
                if (k === IF.lightCam + '.RecognitionTrafficLightCamera') api.lightCam(m.value);
                else if (k === IF.dds2 + '.functionalLibraryData') api.dds2(m.value);
                else if (k === IF.signCam + '.TrafficSignRecognitionFrontCamera') api.signCam(m.value);
                else if (k === IF.signLeg + '.RecognitionTrafficSignCamera') api.signLeg(m.value);
                else if (k === IF.signLeg + '.recognitionTrafficSignCamera2') api.signCam2(m.value);
                else if (k === IF.tsr + '.TrafficSignRecognition') api.tsr(m.value);
                else if (k === IF.lca + '.assistedDrivingViewLcaInput') api.lca(m.value);
                else if (k === IF.lanes + '.LaneBoundaries') api.lanes(m.value);
                else if (k === IF.objects + '.ObjectRecognition') api.objRec(m.value);
                else if (k === IF.objects + '.ObjectPosition') api.objPos(m.value);
            });
        },
    };
    return api;
}

/* ------------------------------------------------------------------ the capture package's scenarios ---------------------- */

/**
 * A scenario file of the capture package (TS-REPORT 3: tools/car/rv_analyse.py writes one per light track and per sign sighting:
 * { kind: 'light' | 'sign', columns: ['t_ms', ...], frames: [[t_ms, ...]], stream, type, value }) -> replay lines
 * [{ t, iface, event, value }] in the car's own message shapes, so they go through the same decoder (pure). Anything else: [].
 */
function fromScenario(o) {
    if (!o || typeof o !== 'object' || !Array.isArray(o.frames)) return [];
    const cols = Array.isArray(o.columns) ? o.columns : [];
    const out = [];
    if (o.kind === 'light') {
        o.frames.forEach((f) => {
            if (!Array.isArray(f) || !isNum(f[0])) return;
            const v = {};
            cols.forEach((c, i) => { if (i > 0) v[c] = f[i]; });
            out.push({ t: f[0], iface: IF.lightCam, event: 'RecognitionTrafficLightCamera', value: v });
        });
    } else if (o.kind === 'sign') {
        const ev = o.stream === 'cam-legacy2' ? [IF.signLeg, 'recognitionTrafficSignCamera2'] : [IF.signCam, 'TrafficSignRecognitionFrontCamera'];
        o.frames.forEach((f) => {
            if (!Array.isArray(f) || !isNum(f[0])) return;
            out.push({ t: f[0], iface: ev[0], event: ev[1], value: { eventDataQualifier: 'EVENT_DATA_AVAILABLE', trafficSign: [{ type: o.type, value: f[1], variable: f[2] }] } });
        });
    }
    return out;
}

/* ------------------------------------------------------------------ the strip ------------------------------------------- */

/**
 * The sign strip (pure): the items beside the limit, in the order light, rule, warning; at most `max` items with the limit
 * (3). opts: { limit: true when a limit sign shows, noPass: true when the theme's own no-overtaking sign is on (it counts as
 * the rule), max }. -> [{ kind: 'light' | 'sign', id, tier }] (the limit itself is not in the list: the theme draws it).
 *   - the light (any state but none) comes first: it is the most momentary;
 *   - then one rule (a point rule before a stretch rule; the newest first), then one warning;
 *   - with a light, the rule or (without a rule) the warning fills the last place.
 */
function strip(view, opts) {
    const o = opts || {}, max = isNum(o.max) ? o.max : 3;
    const room = Math.max(0, max - (o.limit ? 1 : 0));
    const items = [];
    const v = view || {};
    if (v.light && v.light.state && v.light.state !== 'none') items.push({ kind: 'light', id: 'light', tier: 0 });
    const signs = arr(v.signs);
    const rules = signs.filter((s) => s.tier <= 2).sort((a, b) => (b.tier - a.tier) || (a.age - b.age));     // tier 2 (a point) first
    // a light on show makes "traffic lights ahead" say nothing new
    const warns = signs.filter((s) => s.tier === 3 && !(items.length && s.id === 'lightAhead'));
    let rule = rules.length ? { kind: 'sign', id: rules[0].id, tier: rules[0].tier } : null;
    if (o.noPass && (!rule || rule.tier === 1)) rule = { kind: 'sign', id: 'noOvertaking', tier: 1, theirs: true };
    if (rule) items.push(rule);
    if (warns.length) items.push({ kind: 'sign', id: warns[0].id, tier: 3 });
    return items.slice(0, room);
}

module.exports = {
    IF, SIGNS, SIGN_IDS, SIGN_TYPE, VSLI_LIGHT, VSLI_SIGN, LIGHT_STATES, ARROWS, DEFAULT, TYPE_CODE, CLS_CODE, LINE_TYPE, OBJECT_TYPE,
    cfgOf, modeOf, lightOfCam, lightOfVsli, signsOfCam, signsOfCam2, signsOfLeg, signsOfVsli, noPassOfTsr, sidesOfLca, objectsOf, lanesOf, egoOf, demoScene,
    DEMO_LIGHT, DEMO_SIGNS, DEMO_SCENE, cycleAt, create, strip, word, fromScenario,
};
