#!/usr/bin/env node
'use strict';
/**
 * rv_synth.js - round "Road View", package TS: synthetic RV recordings (set S19) with planted traffic lights and signs, written by
 * the RV recorder's own engine (apps/rv_recorder/rv.js) and Signal Probe's recorder (shared/signal_recorder.js), so
 * that tools/car/rv_analyse.py can be tested without a car. NOTHING here is a car fact: every encoding, rate, lag and id below is
 * invented for the test and written to truth.json.
 *
 *   node tools/car/rv_synth.js <out folder> [--seed N] [--short]
 *
 *   <out>/rec/rec-<session>-<n>.csv.gz   two recordings (two short drives):
 *       A  lights: three "red, first car" stops, three green passes, a light changing on the approach, a green arrow, a flashing
 *          amber (with a pedestrian light beside the road the whole time); signs: stop, give way, priority road, no entry, town
 *          entry / exit, zebra, children, road works, no overtaking and its end, a variable limit, a limit with a plate, a
 *          roundabout; the display feed (DisplayDataServer2 vsliSign) follows the light ahead with a lag; the limit function and
 *          both display feeds follow the limits
 *       B  lights only, the display feed silent about lights: two red stops, a green pass, a light changing (the value table must
 *          then come from the marks alone)
 *       In both: the camera's object list and the environment model's object list (the same ids, mostly), the road-scene input, the
 *       lane information, the camera's state, speed / gear / brake light / indicator / stalk; SILENT: the road output, the lateral
 *       inputs and the lane-change warning, the second camera object list, the merged and fused lists, the foresight displays, the
 *       settings (the analysis must say "silent", not fail; truth.json lists them). Some marks are
 *       TRIP presses on the stalk.
 *   <out>/notes.json     the passenger's notes as rv_analyse.py reads them: [{ session, mark, what }]
 *   <out>/truth.json     the encodings, the tracks, the signs, the lags, the silent sources
 *   --short: session A only, lights only (a quick run)
 *
 * Mac only, never shipped. Deterministic for a seed.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const APPDIR = path.join(ROOT, 'apps', 'rv_recorder');
const { RoadView } = require(path.join(APPDIR, 'rv.js'));
const RVF = require(path.join(APPDIR, 'rv_fields.js'));
const { Recorder } = require(path.join(ROOT, 'shared', 'signal_recorder.js'));
const FMT = require(path.join(ROOT, 'shared', 'signal_format.js'));

const args = process.argv.slice(2);
const OUT = args[0];
if (!OUT || /^--/.test(OUT)) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 27).join('\n')); process.exit(2); }
const SEED = args.indexOf('--seed') >= 0 ? Number(args[args.indexOf('--seed') + 1]) : 1;
const SHORT = args.indexOf('--short') >= 0;

// ---- the invented encodings (truth) -------------------------------------------------------------------------------------------
const COLOR = { off: 0, red: 1, amber: 2, green: 3, 'red-amber': 4 };
const ARROW = { none: 0, left: 1 };
const STATUS = { tracked: 1, new: 2 };
const VSLI = { red: 'TRAFFIC_LIGHT_RED', amber: 'TRAFFIC_LIGHT_YELLOW', green: 'TRAFFIC_LIGHT_GREEN', 'red-amber': 'TRAFFIC_LIGHT_RED_YELLOW', arrow: 'TRAFFIC_LIGHT_GREEN_ARROW' };
const LAG = { legacy2: 200, legacy: 400, display: 300, tsr: 250, vsliSpeed: 500, vsliValue: 700 };
const SIGN_CODE = { STOP_SIGN: 20, GIVE_WAY: 21, PRIORITY_ROAD_START_OF: 22, NO_ENTRY: 12, CITY_LIMIT_START_OF: 55, CITY_LIMIT_END_OF: 56, DS_PEDESTRIAN_CROSSING: 49,
    DS_CHILDREN: 44, DS_ROAD_WORKS: 39, NO_PASSING_SIGN: 1, WITHDRAWAL_NO_PASSING_SIGN: 2, SPEED_LIMIT: 5, ROUNDABOUT_SIGN: 11 };

function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function catchUp(rec) { for (let i = 0; i < 5000 && (rec.writing || rec.segs.some((sg) => sg.chunks.length)); i++) { rec._flush(); await sleep(0); } }
async function drain(rec) {
    for (let i = 0; i < 20000; i++) {
        if (!rec.writing && rec.queued === 0 && (rec.segs.length === 0 || (rec.segs.length === 1 && !rec.segs[0].chunks.length && !rec.segs[0].closed))) return;
        rec._flush(); await sleep(1);
    }
}

// ---- a session's plan ---------------------------------------------------------------------------------------------------------
/** A light: id, from..to (s), phases [[colour, from, to]], arrow, the mark (label, at, via). */
function light(id, from, to, phases, o) { return Object.assign({ id, from, to, phases, arrow: 'none', side: false }, o || {}); }
function planA() {
    const L = [];
    // three red stops as the first car (we stand still from stopAt to goAt)
    [[7, 10], [9, 175], [14, 245]].forEach((x, i) => {
        const t = x[1];
        L.push(light(x[0], t, t + 40, [['green', t, t + 12], ['amber', t + 12, t + 15], ['red', t + 15, t + 34], ['red-amber', t + 34, t + 36], ['green', t + 36, t + 40]],
            { stop: [t + 20, t + 37], mark: ['red-first', t + 23, i === 1 ? 'trip' : 'menu'] }));
    });
    [[12, 55], [17, 220], [22, 288]].forEach((x) => { const t = x[1]; L.push(light(x[0], t, t + 13, [['green', t, t + 13]], { mark: ['green-pass', t + 8, 'menu'] })); });
    L.push(light(3, 80, 101, [['green', 80, 92], ['amber', 92, 95], ['red', 95, 101]], { mark: ['light-change', 93, 'trip'], stop: [97, 101.5] }));
    L.push(light(21, 115, 135, [['green', 115, 135]], { arrow: 'left', mark: ['green-arrow', 125, 'menu'] }));
    const fl = [];
    for (let t = 145; t < 160; t += 0.5) fl.push([(t * 2) % 2 === 0 ? 'amber' : 'off', t, t + 0.5]);
    L.push(light(30, 145, 160, fl, { mark: ['flashing-amber', 152, 'menu'] }));
    // a pedestrian light beside the road while the flashing amber shows (red, small, aside: never the light ahead)
    L.push(light(31, 146, 158, [['red', 146, 158]], { side: true }));
    const S = [
        ['STOP_SIGN', 300, 'stop-sign'], ['GIVE_WAY', 320, 'give-way'], ['PRIORITY_ROAD_START_OF', 340, 'priority-road'], ['NO_ENTRY', 360, 'no-entry'],
        ['CITY_LIMIT_START_OF', 380, 'town-entry'], ['DS_PEDESTRIAN_CROSSING', 400, 'zebra'], ['DS_CHILDREN', 410, 'children'], ['DS_ROAD_WORKS', 420, 'road-works'],
        ['NO_PASSING_SIGN', 430, 'no-overtaking'], ['WITHDRAWAL_NO_PASSING_SIGN', 440, 'no-overtaking-end'], ['SPEED_LIMIT', 450, 'variable-limit', 50, true],
        ['SPEED_LIMIT', 460, 'limit-plate', 30, false, 'SS_TIME'], ['ROUNDABOUT_SIGN', 470, 'roundabout'], ['CITY_LIMIT_END_OF', 480, 'town-exit'],
    ].map((x) => ({ type: x[0], at: x[1], what: x[2], value: x[3] || 0, variable: !!x[4], supp: x[5] || 'SIGNAL_UNFILLED' }));
    return { name: 'A', seconds: 500, wall: new Date(2026, 10, 21, 10, 0, 0).getTime(), lights: L, signs: S, display: true, multiLane: [490, 498] };
}
function planB() {
    const L = [];
    [[40, 10], [41, 70]].forEach((x) => {
        const t = x[1];
        L.push(light(x[0], t, t + 40, [['green', t, t + 12], ['amber', t + 12, t + 15], ['red', t + 15, t + 34], ['red-amber', t + 34, t + 36], ['green', t + 36, t + 40]],
            { stop: [t + 20, t + 37], mark: ['red-first', t + 24, 'menu'] }));
    });
    L.push(light(42, 130, 143, [['green', 130, 143]], { mark: ['green-pass', 138, 'trip'] }));
    L.push(light(43, 160, 181, [['green', 160, 172], ['amber', 172, 175], ['red', 175, 181]], { mark: ['light-change', 173, 'menu'], stop: [177, 181.5] }));
    return { name: 'B', seconds: 200, wall: new Date(2026, 10, 21, 11, 30, 0).getTime(), lights: L, signs: [], display: false };
}

const colourAt = (l, t) => { for (let i = 0; i < l.phases.length; i++) { const p = l.phases[i]; if (t >= p[1] && t < p[2]) return p[0]; } return null; };

// ---- writing one session through the engine -------------------------------------------------------------------------------------
async function session(plan, dir, rand, notes, truth) {
    let now = 0;
    const lines = [];
    const log = { info: (s) => lines.push(s), warn: (s) => lines.push('WARN ' + s) };
    const R = new Recorder({ dir, mono: () => now, wall: () => plan.wall, version: 'synth', cfg: { quotaMB: 200 } });
    const signals = { watch: () => Promise.resolve({ available: true, proxy: {}, error: null }), get: () => Promise.resolve(null) };
    const rv = new RoadView({ log, signals, rec: R, fmt: FMT, now: () => now, cfg: { hubPauseMs: 0 } });
    const src = {};
    rv.sources.forEach((st) => { src[st.f.tag] = st; });
    const fed = {};
    const feed = (tag, v) => { fed[tag] = true; src[tag].handler(v); };
    rv.begin();
    await rv.idle();
    const sid = R.session;
    const tr = { session: sid, plan: plan.name, marks: [], lights: {}, signs: [], silent: [] };
    truth.sessions.push(tr);

    // the timeline: events at times (ms), then one pass in order
    const ev = [];
    const at = (t, fn) => ev.push([Math.round(t * 1000), ev.length, fn]);
    const stopped = (t) => plan.lights.some((l) => l.stop && t >= l.stop[0] && t < l.stop[1]);
    // the light ahead at t (for the display feed): the visible, not-aside light
    const ahead = (t) => plan.lights.filter((l) => !l.side && t >= l.from && t < l.to)[0] || null;

    // lights at 10 Hz while visible
    plan.lights.forEach((l) => {
        tr.lights[l.id] = { from: l.from, to: l.to, side: l.side, arrow: l.arrow, phases: l.phases.map((p) => [p[0], p[1], p[2]]) };
        for (let t = l.from; t < l.to - 1e-9; t += 0.1) {
            const tt = t + rand() * 0.02;
            const c = colourAt(l, tt) || 'off';
            const k = (tt - l.from) / (l.to - l.from);
            const x = l.side ? 30 : Math.max(8, Math.round(200 - 190 * Math.min(1, k * 1.15)));
            const v = { trafficLightID: l.id, trafficLightPositionX: x, trafficLightPositionY: l.side ? 200 : 128 + Math.round((rand() - 0.5) * 6), trafficLightPositionZ: l.side ? 20 : 40,
                trafficLightStatus: tt - l.from < 1 ? STATUS.new : STATUS.tracked, trafficLightArrow: ARROW[l.arrow], trafficLightIndicateDirection: l.arrow === 'left' ? 1 : 0,
                trafficLightColor: COLOR[c], qualityRecognitionTrafficLight: Math.min(99, Math.round(40 + 60 * k)) };
            at(tt, () => feed('tl', v));
        }
        if (l.mark) {
            at(l.mark[1], () => {
                const n = l.mark[2] === 'trip' ? (feed('stalk', { operationColumnStalks: 0 }), feed('stalk', { operationColumnStalks: 0x40 }), rv.markN) : rv.mark('menu');
                notes.push({ session: sid, mark: n, what: l.mark[0] });
                tr.marks.push({ mark: n, what: l.mark[0], t: l.mark[1], light: l.id, via: l.mark[2] });
            });
            if (l.mark[2] === 'trip') at(l.mark[1] + 0.15, () => feed('stalk', { operationColumnStalks: 0 }));
        }
    });
    // the display feed: DisplayDataServer2 at 5 Hz, its vsliSign following the light ahead with a lag (session A only); the limits
    const limitAt = (t) => { let v = 0; plan.signs.forEach((s) => { if (s.type === 'SPEED_LIMIT' && t >= s.at) v = s.value; }); return v; };
    for (let t = 0.05; t < plan.seconds; t += 0.2) {
        const tl = ahead(t - LAG.display / 1000);
        const c = tl ? colourAt(tl, t - LAG.display / 1000) : null;
        let sign = 'NO_VSLI';
        if (plan.display && tl && c && c !== 'off') sign = tl.arrow === 'left' && c === 'green' ? VSLI.arrow : VSLI[c];
        const lim2 = limitAt(t - LAG.vsliValue / 1000), lim1 = limitAt(t - LAG.vsliSpeed / 1000);
        at(t, () => feed('hud-data2', { speed: { kmh_Digital: 0, mph_Digital: 0, unitFirstSpeed: 'KMH' }, xSpeedLimitAssist: { vsliSign: sign, sliLabel: 'NO_DISPLAY', vsliLabel: 'NO_DISPLAY',
            vsliDistance: tl ? 'VSLI_DIST_50_M' : 'VSLI_DIST_NO_DISPLAY', vsliShape: 'ROUND', sliValue: lim2 ? 'LIMIT_' + lim2 : 'NO_DISPLAY', vsliValue: lim2 ? 'LIMIT_' + lim2 : 'NO_DISPLAY',
            sliShape: 'CIRCLE', sliState: lim2 ? 'ACTIVE_SPEED_LIMIT' : 'NO_DISPLAY', sliUnit: 'SU_KMH', sliSure: 'SURE', sliSupState: 'NO_DISPLAY', sliSupLabel: 'NO_DISPLAY' } }));
        if (Math.round(t * 5) % 5 === 0) {
            at(t + 0.01, () => feed('hud-data', { speed: { kmH: 0, mlsH: 0 }, xSpeedLimitAssist: { vSLISymbol: lim1 ? 'LDM_VZA_VSLI_SPEED_LIMIT' : 'LDM_VZA_VSLI_NO_SYMBOL', statusVZA: 'STATUS_ACTIVE',
                vSLISpeedValue: lim1, vSLIAdditionalSign: 'LDM_VSLI_NO_SYMBOL', vSLIDistanceValues: 0 }, system: { modeHUD: 'PSM_ALL', statusHUD: 'HUDSTATUS_OFF' } }));
        }
    }
    // the limit function at 2 a second (as seen on the car, 2026-11-18), its class LAG.tsr after the sign
    for (let t = 0.02; t < plan.seconds; t += 0.5) {
        {
            const lt = limitAt(t - LAG.tsr / 1000);
            at(t, () => feed('tsr', { presentWithdrawalLimitSpeed: 0, recognitionNoPassing: 0, nextWithdrawalLimitSpeed: 0, presentClassLimitSpeed: lt / 5, nextClassLimitSpeed: 0,
                countryCodingTrafficSign: 0, displayTextMessage: 0, unitOfMeasurementSpeedLimit: 1, displayTextMessageNpi: 0, statusDataMatchingCameraADAS: 0, statusStreetTyp: 0,
                evaluationStreetTyp: 0, displaySupplementalSign: 0, triggerPresentClassLimitSpeed: 0, displaySpeedNPIDistance: 0, controlSLIWarning: 0 }));
        }
    }
    // the signs: the new stream at 5 Hz while a sign is in view (3 s before its mark to 1 s after), the second stream LAG.legacy2
    // later, the old single-sign stream LAG.legacy later with the type as its catalogue number
    const empty = () => ({ timestamp: 0, value: 0, type: 'UNKNOWN', trafficSignForm: 'SIGNAL_UNFILLED', position: { left: false, right: false, overhead: false },
        firstSupplementalType: 'SIGNAL_UNFILLED', secondSupplementalType: 'SIGNAL_UNFILLED', additionalInfo: 'SIGNAL_UNFILLED', variable: false, location: { locationInvalidFlags: 0, x: 0, y: 0, z: 0 }, timestampSec: 0 });
    const signMsg = (s, rel, two) => {
        const list = [];
        for (let i = 0; i < 20; i++) list.push(empty());
        if (s) {
            list[0] = { timestamp: 1000, value: s.value, type: s.type, trafficSignForm: 'ROUND', position: { left: false, right: true, overhead: false }, firstSupplementalType: s.supp,
                secondSupplementalType: 'SIGNAL_UNFILLED', additionalInfo: 'NO_ADDITIONAL_RESTRICTION', variable: s.variable, location: { locationInvalidFlags: 0, x: 40 - rel * 10, y: -3.5, z: 2 }, timestampSec: 7 };
            if (two) list[0].relevance = 'KTRAFFICSIGNCHARACTERISTICS_RELEVANTSIGN';
        }
        const q = []; for (let i = 0; i < 20; i++) q.push({ qualityType: s && i === 0 ? 90 : 0, qualityValue: s && i === 0 ? 80 : 0, qualityFirstSupplementalType: 0, qualitySecondSupplementalType2: 0 });
        return { timestamp: 5, eventDataQualifier: 'EVENT_DATA_AVAILABLE', extendedQualifier: 'SIGNAL_UNFILLED', trafficSignRecognition: { version: 3, visibilityCondition: 'REGULAR_ENVIRONMENT_CONDITIONS', numberSigns: s ? 1 : 0, speedLimitUnit: 'KM_H' },
            trafficSign: list, trafficSignRecognitionQuality: q };
    };
    plan.signs.forEach((s) => {
        tr.signs.push({ type: s.type, at: s.at, what: s.what, value: s.value, firstNew: s.at - 3, firstLegacy2: s.at - 3 + LAG.legacy2 / 1000, firstLegacy: s.at - 3 + LAG.legacy / 1000 });
        for (let t = s.at - 3; t < s.at + 1 - 1e-9; t += 0.2) {
            const rel = t - (s.at - 3);
            at(t, () => feed('cam-signs', signMsg(s, rel, false)));
            at(t + LAG.legacy2 / 1000, () => feed('cam-legacy2', signMsg(s, rel, true)));
            at(t + LAG.legacy / 1000, () => feed('cam-legacy', { trafficSignID: 1, trafficSignType: SIGN_CODE[s.type], trafficSignAddOnType1: 0, trafficSignAddOnType2: 0, qualityRecognitionTrafficSign: 80,
                trafficSignValue: s.value, speedLimitUnitOfMeasurement: 1, trafficSignPositionX: Math.round(200 - rel * 40), trafficSignPositionY: 140, trafficSignPositionZ: 60, trafficSignStatus: 1 }));
        }
        at(s.at, () => { const n = rv.mark('menu'); notes.push({ session: sid, mark: n, what: s.what }); tr.marks.push({ mark: n, what: s.what, t: s.at, sign: s.type, via: 'menu' }); });
    });
    // the camera's objects (15 Hz) and the environment model's (10 Hz): the same ids most of the time
    const idsAt = (t) => { const base = Math.floor(t / 20) * 3; return [base % 60 + 1, (base + 1) % 60 + 1, (base + 2) % 60 + 1]; };
    for (let t = 0.03; t < plan.seconds; t += 1 / 15) {
        const ids = idsAt(t);
        const info = []; for (let i = 0; i < 40; i++) info.push({ statusMeasurement: 'SIGNAL_UNFILLED', statusMovement: 'SIGNAL_UNFILLED', classificationType: 'SIGNAL_UNFILLED', modeLateral: 'SIGNAL_UNFILLED', drivingTubeMapping: 'SIGNAL_UNFILLED', objectID: 0 });
        ids.forEach((id, i) => { info[i] = { statusMeasurement: 'MEASURED', statusMovement: 'MOVING', classificationType: i === 2 ? 'PEDESTRIAN' : 'CAR', modeLateral: 'SIGNAL_UNFILLED', drivingTubeMapping: 'SIGNAL_UNFILLED', objectID: id }; });
        at(t, () => feed('cam-objects', { timestamp: 1, eventDataQualifier: 'EVENT_DATA_AVAILABLE', extendedQualifier: 'SIGNAL_UNFILLED', numberOfCars: 2, numberOfPedestrians: 1, numberOfCyclists: 0, numberOfBikes: 0,
            numberOfTrucks: 0, numberOfOtherVehicles: 0, numberOfRoadBoundaries: 0, timestampQualifier: 'SIGNAL_UNFILLED', numberOfUnknownObjects: 0, numberOfObjects: ids.length, objectRecognitionInfo: info }));
    }
    for (let t = 0.05; t < plan.seconds; t += 0.1) {
        const ids = idsAt(t).slice(0, rand() < 0.1 ? 2 : 3);
        const rec = [], pos = [];
        for (let i = 0; i < 20; i++) { rec.push({ statusMeasurement: 'SIGNAL_UNFILLED', statusMovement: 'SIGNAL_UNFILLED', statusMovementMovingDirection: 'SIGNAL_UNFILLED', classificationType: 'SIGNAL_UNFILLED', modeLateral: 'SIGNAL_UNFILLED', drivingTubeMapping: 'SIGNAL_UNFILLED', objectID: 0, existenceProbability: 0, referencePoint: 'SIGNAL_UNFILLED' }); pos.push({ objectPositionInfoInvalidFlags: 0, positionX: 0, positionY: 0 }); }
        ids.forEach((id, i) => { rec[i].objectID = id; rec[i].classificationType = i === 2 ? 'PEDESTRIAN' : 'CAR'; pos[i] = { objectPositionInfoInvalidFlags: 0, positionX: 10 + i * 12 + rand(), positionY: (i - 1) * 3.4 }; });
        at(t, () => feed('object-info1', { eventDataQualifier: 'EVENT_DATA_AVAILABLE', extendedQualifier: 'SIGNAL_UNFILLED', objectRecognition: { eventDataQualifier: 'EVENT_DATA_AVAILABLE', extendedQualifier: 'SIGNAL_UNFILLED', numberOfObjects: ids.length, objectRecognitionInfo: rec },
            objectPosition: { eventDataQualifier: 'EVENT_DATA_AVAILABLE', extendedQualifier: 'SIGNAL_UNFILLED', numberOfObjects: ids.length, objectPositionInfo: pos, objectDimensionInfo: [] }, objectMovementRelative: { numberOfObjects: ids.length, objectMovementRelativeInfo: [] } }));
        at(t + 0.01, () => feed('view-input', { assistedDrivingViewStateXcc: 0, assistedDrivingViewSubStateXcc: 0, assistedDrivingViewACCTargetObjectId: ids[0], assistedDrivingViewMultiControlObjectType: 0,
            assistedDrivingViewOvertakingPreventionState: 0, assistedDrivingViewMultiControlObjectId: 0, assistedDrivingViewOvertakingPreventionObjectId: 0, assistedDrivingViewACCPrioObjectId: 0,
            assistedDrivingViewACCTargetDistance: 120, assistedDrivingViewDispXcc: 0, assistedDrivingViewDispGapChoice: 0, assistedDrivingViewDispGapChoiceMode: 0,
            assistedDrivingViewStdTimestampNanoseconds: 1, assistedDrivingViewStdTimestampSeconds: 2, assistedDrivingViewStdTimestampSyncState: 0, assistedDrivingViewDispSLD: 0 }));
    }
    for (let t = 0.07; t < plan.seconds; t += 0.2) {
        const multi = plan.multiLane && t >= plan.multiLane[0] && t < plan.multiLane[1];
        at(t, () => feed('lane-info', { eventDataQualifier: 'EVENT_DATA_AVAILABLE', extendedQualifier: 'SIGNAL_UNFILLED', leftLaneLaneTypeInfo: { type: multi ? 2 : 0, typeExistenceProbability: 80 },
            egoLaneLaneTypeInfo: { type: 1, typeExistenceProbability: 90 }, rightLaneLaneTypeInfo: { type: multi ? 2 : 0, typeExistenceProbability: 80 } }));
    }
    if (plan.multiLane) tr.marks.push({ what: 'multi-lane', t: plan.multiLane[0] + 2 });
    if (plan.multiLane) at(plan.multiLane[0] + 2, () => { const n = rv.mark('menu'); notes.push({ session: sid, mark: n, what: 'multi-lane' }); tr.marks[tr.marks.length - 1].mark = n; });
    // the camera's state, the context
    for (let t = 0.5; t < plan.seconds; t += 1) {
        at(t, () => feed('blockage', { counter: Math.round(t) % 65536, updateFrontcameraMain: 'EVENT_DATA_AVAILABLE', updateBlockage: { fullBlockage: { invalid_flags: false, severity: 'SEVERITY_0' } },
            updateWeather: { rain: { invalid_flags: false, severity: 'SEVERITY_0' } }, updateBlockageState: { invalidFlag: false, state: 0 }, updateDayTime: { dayTimeIndicator: 'DAY', dayTimeIndQuality: { dayTimeIndQuality: 90, invalidFlag: false } } }));
        at(t + 0.1, () => feed('gearbox-status', { statusActualStageDrive: 'D', statusActualGearDrive: stopped(t) ? 'G1' : 'G3' }));
    }
    for (let t = 0.02; t < plan.seconds; t += 0.1) {
        const s = stopped(t) ? 0 : 35 + 10 * Math.sin(t / 15);
        at(t, () => feed('car-speed2', { speedVehicleCentreOfGravity: Math.round(s * 64) }));
        at(t + 0.03, () => feed('brake-light', { controlFunctionBrakeLight: stopped(t) ? 'ON_BL' : 'OFF_BL', controlFunctionBrakeForceDisplay: 'SIGNAL_UNFILLED' }));
    }
    at(0.2, () => feed('stalk', { operationColumnStalks: 0 }));
    at(1, () => feed('indicate', { statusIndicateDirection: 0 }));
    at(1.1, () => feed('fas-ext', { statusTrafficLightAssistance: 'NICHT_AKTIVIERBAR', statusUCCTrafficLight: 'NICHT_AKTIVIERBAR', statusUCCRestartTrafficLight: 'NICHT_AKTIVIERBAR' }));
    at(1.2, () => feed('warn-brake', { requestDisplaySymbol: 'KEIN_WARNSYMBOL_ANZEIGEN', aliveRequestWarnBrakeCoordinatorDisplay: 1 }));

    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let nextSec = 1000;
    for (let i = 0; i < ev.length; i++) {
        while (ev[i][0] >= nextSec) { now = nextSec; rv.tick(); nextSec += 1000; if (nextSec % 4000 === 0) await catchUp(R); }
        now = ev[i][0];
        ev[i][2]();
    }
    now = plan.seconds * 1000;
    rv.tick();
    rv.end();
    await drain(R);
    tr.silent = RVF.sourcesOf('S19').map((f) => f.tag).filter((t) => !fed[t]);     // fixes-1121 CR: S19's sources only
    tr.recorder = { samples: R.samples, dropped: R.dropped, errors: R.errors, texts: R.texts };
    tr.log = lines.filter((l) => /^rv: (first|summary|mark|stop)/.test(l));
    return tr;
}

async function main() {
    const rand = rng(SEED);
    const dir = path.join(OUT, 'rec');
    fs.mkdirSync(dir, { recursive: true });
    const notes = [];
    const truth = { _about: 'INVENTED for the test of tools/car/rv_analyse.py (tools/car/rv_synth.js): not a car fact.', seed: SEED,
        encodings: { color: invert(COLOR), arrow: invert(ARROW), status: invert(STATUS) }, display: VSLI, lags: LAG, signCodes: SIGN_CODE, sessions: [] };
    const plans = SHORT ? [planA()] : [planA(), planB()];
    if (SHORT) plans[0].signs = [];
    for (let i = 0; i < plans.length; i++) await session(plans[i], dir, rand, notes, truth);
    fs.writeFileSync(path.join(OUT, 'notes.json'), JSON.stringify(notes, null, 1) + '\n');
    fs.writeFileSync(path.join(OUT, 'truth.json'), JSON.stringify(truth, null, 1) + '\n');
    console.log('rv_synth: ' + truth.sessions.map((s) => s.plan + ' ' + s.session + ' (' + s.recorder.samples + ' samples, ' + s.marks.length + ' marks)').join(', ') + ' -> ' + OUT);
}
function invert(o) { const r = {}; Object.keys(o).forEach((k) => { r[o[k]] = k; }); return r; }

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
