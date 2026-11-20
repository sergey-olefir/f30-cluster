#!/usr/bin/env node
'use strict';
/**
 * hb_synth.js - beam HS: synthetic Signal Probe recordings of the HB set (S18, apps/signal_probe/fields.js), written by the app's own
 * recorder (apps/signal_probe/recorder.js), so that tools/car/hb_analyse.py can be tested against events it must find. NOTHING here is
 * a car fact: every rate, encoding, class number, bit and delay below is invented for the test and written to truth.json.
 *
 *   node tools/car/hb_synth.js <out folder> [--seed N] [--minutes M]
 *
 *   <out>/rec/rec-<session>-<n>.csv.gz   three recordings:
 *       A  the parked check of docs/highbeam/DRIVE-PROTOCOL.md (a mark, then push, pull, pull-and-hold, left full, right full,
 *          left tip, right tip: 5 s each, 5 s apart), then a night drive: an empty road with the high beam on, an oncoming car
 *          (the driver dips), a car followed (dips), street lights passed with the high beam kept on, a town (dips; the limit,
 *          the built-up flag, the brightness), an oncoming truck, a flash, back to high. The camera sends its 15 light objects
 *          (empty slots as the catalogue's defaults) and its own verdict, which leads the driver
 *       B  the camera's light detection SILENT (no RecogFrontCameraLightDetection event at all) and LampExterior2 silent too (the
 *          high beam then comes from the head unit's own lamp status): the driver still switches and flashes; the general object
 *          list (the fallback) shows an oncoming car
 *       C  the camera's events arrive with every output at its catalogue default (a gateway's "timed out" frame): "defaults only";
 *          the head unit's lamp status silent (the high beam then comes from LampExterior2)
 *   <out>/truth.json                     the invented encodings, the stalk bits, the driver's actions, the camera's lead, the
 *                                        stretches the analysis must find
 *   --minutes M: add M minutes of empty road at the end of A (the size test)
 *
 * Mac only, never shipped. Deterministic for a seed.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FIELDS = require(path.join(ROOT, 'apps', 'signal_probe', 'fields.js'));
const { Recorder } = require(path.join(ROOT, 'apps', 'signal_probe', 'recorder.js'));

// ---- the invented truth -------------------------------------------------------------------------------------------------------
const BITS = { push: 0x10, pull: 0x20, leftFull: 0x08, rightFull: 0x02, leftTip: 0x04, rightTip: 0x01 };
const CLS = { head: 1, tail: 2, street: 3 };
const STATUS_VALID = 1;
const DIAG_CONTACT = { 0x10: 0x04, 0x20: 0x08, 0x08: 0x01, 0x02: 0x02, 0x04: 0x10, 0x01: 0x20 };     // stalk bit -> an invented E3B8 byte
const ALLOW = 1, DENY = 0;
const LAMP_DELAY = 0.15;                          // s from the stalk to the lamp's command
const CAM_LEAD_DIP = 1.2, CAM_LEAD_HIGH = 1.5;    // s the camera's verdict changes before the driver
const OBJ_DEFAULT = { XPosition: 255, YPosition: 255, Width: 255, AngularSpeedRight: 255, AngularSpeedLeft: 255, Height: 63, Class: 15, Id: 15, Distance: 127, Status: 7 };
const OBJ_ORDER = ['XPosition', 'YPosition', 'Width', 'AngularSpeedRight', 'AngularSpeedLeft', 'Height', 'Class', 'Id', 'Distance', 'Status'];
const HZ = { obj: 15, control: 10, meid: 15, lamps: 10, lamp1: 10, low: 2, brightness: 1, rain: 1, wiper: 1, speed: 10, yaw: 25, steering: 10, gear: 5, temp: 1,
    tsr: 2, front: 25, cam: 15, gap: 10, dimmer: 1, indicate: 2, indicators: 2 };

// what a gateway publishes for a timed-out frame (HR-REPORT 3.1: one of the three outcomes): every output at the catalogue's default
const DEFAULTS = {
    'hb-control': { controlHighBeam: 3, statusCameraCalibration: 3, numberVehicles: 15, numberRoadSigns: 15, numberPedestrians: 15, reasonSwitchOffHighBeam: 65535,
        cameraCalibrationOffsetHorizontal: 255, cameraCalibrationOffsetVertical: 255, qualifierDataControlHighBeamAssistant: 15, qualifierExtendedControlHighBeamAsstistant: 15, syncSignal: 255 },
    'hb-meid1': { MEIDObject1: 255, MEIDObject2: 255, MEIDObject3: 255, MEIDObject4: 255, MEIDObject5: 255, MEIDObject6: 255, MEIDObject7: 255, MEIDObject8: 255 },
    'hb-meid2': { MEIDObject9: 255, MEIDObject10: 255, MEIDObject11: 255, MEIDObject12: 255, MEIDObject13: 255, MEIDObject14: 255, MEIDObject15: 255 },
};
function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lerp = (a, b, u) => a + (b - a) * Math.max(0, Math.min(1, u));
const inW = (t, a, b) => t >= a && t < b;

// ---- a session's world: what is true at time t (s since the recording started) --------------------------------------------------
/**
 * spec: { name, parked: t0 | null, drive: t0, end, camera: bool, actions: [{t, kind, bits, hold}], camera verdict changes,
 *         objects: [{slot, id, cls, t0, t1, dist: [a, b], x: [a, b], y, w: [a, b]}], town: [t0, t1] | null, following: [t0, t1] | null }
 */
function makeWorld(spec) {
    // the stalk: a list of holds; the lamp follows the push / pull with LAMP_DELAY; a pull while the beam is off is a flash
    const holds = spec.actions.map((a) => ({ t0: a.t, t1: a.t + a.hold, bits: a.bits, kind: a.kind }));
    const beam = [];     // [t, on] changes of the high beam's command
    let on = false;
    holds.slice().sort((a, b) => a.t0 - b.t0).forEach((h) => {
        if (h.bits === BITS.push && !on) { on = true; beam.push([h.t0 + LAMP_DELAY, true]); }
        else if (h.bits === BITS.pull && on) { on = false; beam.push([h.t0 + LAMP_DELAY, false]); }
        else if (h.bits === BITS.pull && !on) { beam.push([h.t0 + LAMP_DELAY, true]); beam.push([h.t1 + LAMP_DELAY, false]); }      // a flash
    });
    beam.sort((a, b) => a[0] - b[0]);
    const highAt = (t) => { let v = false; for (let i = 0; i < beam.length && beam[i][0] <= t; i++) v = beam[i][1]; return v; };
    const stalkAt = (t) => { let b = 0; holds.forEach((h) => { if (inW(t, h.t0, h.t1)) b |= h.bits; }); return b; };
    const verdict = spec.verdict || [];
    const allowAt = (t) => { let v = DENY; for (let i = 0; i < verdict.length && verdict[i][0] <= t; i++) v = verdict[i][1]; return v; };
    const speedAt = (t) => {
        if (t < spec.drive) return 0;
        if (t < spec.drive + 15) return lerp(0, 90, (t - spec.drive) / 15);
        if (spec.town && inW(t, spec.town[0] - 5, spec.town[1] + 2)) return 50;
        return 90;
    };
    const townAt = (t) => !!(spec.town && inW(t, spec.town[0], spec.town[1]));
    const objectsAt = (t) => {
        const out = {};
        spec.objects.forEach((o) => {
            if (!inW(t, o.t0, o.t1) || out[o.slot]) return;
            const u = (t - o.t0) / (o.t1 - o.t0);
            out[o.slot] = { Id: o.id, Class: o.cls, Status: STATUS_VALID, Distance: Math.round(lerp(o.dist[0], o.dist[1], u)), XPosition: Math.round(lerp(o.x[0], o.x[1], u)),
                YPosition: o.y, Width: Math.round(lerp(o.w[0], o.w[1], u)), Height: 2, AngularSpeedLeft: Math.round(128 + (o.x[1] - o.x[0]) / 4), AngularSpeedRight: Math.round(128 + (o.x[1] - o.x[0]) / 4) };
        });
        return out;
    };
    return { spec, highAt, stalkAt, allowAt, speedAt, townAt, objectsAt, beam, holds };
}

// ---- the two sessions -------------------------------------------------------------------------------------------------------------
function sessionA(extraMin) {
    const P0 = 5, D = 80;
    const actions = [];
    // the parked check: 7 holds of 5 s, 5 s apart, in the protocol's order
    [['push', BITS.push], ['pull', BITS.pull], ['flash', BITS.pull], ['leftFull', BITS.leftFull], ['rightFull', BITS.rightFull], ['leftTip', BITS.leftTip], ['rightTip', BITS.rightTip]]
        .forEach((x, k) => actions.push({ t: P0 + k * 10, kind: 'parked.' + x[0], bits: x[1], hold: 5 }));
    // the drive
    const drv = [[D + 10, 'high_on'], [D + 45, 'high_off'], [D + 54.5, 'high_on'], [D + 82, 'high_off'], [D + 123, 'high_on'], [D + 200, 'high_off'],
        [D + 263, 'high_on'], [D + 290, 'high_off'], [D + 305, 'flash'], [D + 310, 'high_on']];
    drv.forEach((x) => actions.push({ t: x[0], kind: x[1], bits: x[1] === 'high_on' ? BITS.push : BITS.pull, hold: x[1] === 'flash' ? 0.6 : x[1] === 'high_on' ? 0.4 : 0.3 }));
    const verdict = [[0, DENY], [D + 10 - CAM_LEAD_HIGH, ALLOW], [D + 45 - CAM_LEAD_DIP, DENY], [D + 54.5 - CAM_LEAD_HIGH, ALLOW], [D + 82 - CAM_LEAD_DIP, DENY],
        [D + 123 - CAM_LEAD_HIGH, ALLOW], [D + 151, DENY], [D + 169, ALLOW], [D + 200 - CAM_LEAD_DIP, DENY], [D + 263 - CAM_LEAD_HIGH, ALLOW],
        [D + 290 - CAM_LEAD_DIP, DENY], [D + 310 - CAM_LEAD_HIGH, ALLOW]];
    const objects = [
        { slot: 1, id: 3, cls: CLS.head, t0: D + 40, t1: D + 52, dist: [120, 8], x: [120, 40], y: 100, w: [2, 20], what: 'oncoming car' },
        { slot: 2, id: 5, cls: CLS.tail, t0: D + 80, t1: D + 120, dist: [20, 21], x: [128, 130], y: 98, w: [6, 6], what: 'followed car' },
        { slot: 7, id: 9, cls: CLS.head, t0: D + 285, t1: D + 296, dist: [110, 10], x: [118, 30], y: 102, w: [3, 26], what: 'oncoming truck' },
    ];
    // street lights passed with the high beam kept on (4 s each, a new id each time), and the town's lights
    let id = 10;
    for (let t = D + 150; t < D + 170; t += 4) for (let s = 3; s <= 4; s++) objects.push({ slot: s, id: (id++) % 15, cls: CLS.street, t0: t + (s - 3) * 2, t1: t + (s - 3) * 2 + 4, dist: [90, 25], x: [140, 200], y: 160, w: [1, 4], what: 'street light' });
    for (let t = D + 199; t < D + 260; t += 4) for (let s = 3; s <= 6; s++) objects.push({ slot: s, id: (id++) % 15, cls: CLS.street, t0: t + (s - 3), t1: t + (s - 3) + 4, dist: [80, 20], x: [150, 210], y: 165, w: [1, 4], what: 'town light' });
    const end = D + 330 + 60 * (extraMin || 0);
    return { name: 'A', mark: P0 - 2, parked: P0, drive: D, end, camera: true, noMap: true, diag: true, actions, verdict, objects, town: [D + 199, D + 260], following: [D + 80, D + 120],
        townLimitClass: 10, roadLimitClass: 18, brightness: { dark: 5, town: 150 }, oncomingFallback: null,
        keepHighWithObjects: [[D + 150, D + 172]] };
}
function sessionC() {
    // the camera's events arrive, every output at its default (the gateway's "timed out"); a short drive, one switch each way
    const actions = [[10, 'high_on'], [40, 'high_off']].map((x) => ({ t: x[0], kind: x[1], bits: x[1] === 'high_on' ? BITS.push : BITS.pull, hold: 0.35 }));
    return { name: 'C', mark: null, parked: null, drive: 0, end: 60, camera: 'defaults', noLights: true, actions, verdict: [], objects: [], town: null, following: null,
        townLimitClass: 10, roadLimitClass: 18, brightness: { dark: 5, town: 150 }, oncomingFallback: null, keepHighWithObjects: [] };
}
function sessionB() {
    const D = 0;
    const actions = [[10, 'high_on'], [45, 'high_off'], [55, 'high_on'], [100, 'high_off'], [115, 'flash'], [130, 'high_on']].map((x) => ({ t: x[0], kind: x[1], bits: x[1] === 'high_on' ? BITS.push : BITS.pull, hold: x[1] === 'flash' ? 0.6 : 0.35 }));
    return { name: 'B', mark: null, parked: null, drive: D, end: 150, camera: false, noLamps2: true, actions, verdict: [], objects: [], town: null, following: null,
        townLimitClass: 10, roadLimitClass: 18, brightness: { dark: 5, town: 150 }, oncomingFallback: [40, 52], keepHighWithObjects: [] };
}

// ---- values in the catalogue's shapes -------------------------------------------------------------------------------------------
function objEvent(slot, o) {
    const v = {};
    OBJ_ORDER.forEach((k) => { v[k + 'Object' + slot] = o ? o[k] : OBJ_DEFAULT[k]; });
    return v;
}
function values(W, t, k, r) {
    const s = W.spec, high = W.highAt(t), town = W.townAt(t), speed = W.speedAt(t), objs = W.objectsAt(t);
    const night = speed > 0 || t >= 0;
    const fb = s.oncomingFallback && inW(t, s.oncomingFallback[0], s.oncomingFallback[1]);
    const fol = s.following && inW(t, s.following[0], s.following[1]);
    const camList = [];
    if (fb) camList.push({ id: 21, cls: 'CAR_WITH_OR_WITHOUT_TRAILER', mov: 'MOVING_OBJECT_MOVEMENT_DIRECTION_ONCOMMING', lane: 'OBJECT_IN_NEXT_LANE_LEFT', x: lerp(100, 5, (t - s.oncomingFallback[0]) / 12), y: 3.5, vx: -22, head: 'ON', rear: 'UNKNOWN' });
    if (fol) camList.push({ id: 22, cls: 'CAR_WITH_OR_WITHOUT_TRAILER', mov: 'MOVING_OBJECT_MOVEMENT_DIRECTION_SAME_AS_EGOVEHICLE', lane: 'OBJECT_IN_EGO_LANE', x: 40 + r() * 0.5, y: 0.1, vx: 24, head: 'UNKNOWN', rear: 'ON' });
    return {
        objects: objs,
        'hb-control': { controlHighBeam: W.allowAt(t), statusCameraCalibration: 1, numberVehicles: Object.keys(objs).filter((q) => objs[q].Class !== CLS.street).length, numberRoadSigns: 0, numberPedestrians: 0,
            reasonSwitchOffHighBeam: W.allowAt(t) === ALLOW ? 0 : town ? 4 : 1, cameraCalibrationOffsetHorizontal: 128, cameraCalibrationOffsetVertical: 127, qualifierDataControlHighBeamAssistant: 0,
            qualifierExtendedControlHighBeamAsstistant: 0, syncSignal: k % 256 },
        'hb-meid1': (() => { const v = {}; for (let i = 1; i <= 8; i++) v['MEIDObject' + i] = objs[i] ? 100 + objs[i].Id : 255; return v; })(),
        'hb-meid2': (() => { const v = {}; for (let i = 9; i <= 15; i++) v['MEIDObject' + i] = objs[i] ? 100 + objs[i].Id : 255; return v; })(),
        'hb-lamps': { cRCControlLampExterior2: k % 256, aliveControlLampExterior2: k % 15, controlFunctionLaserLeftHand: 'OFF', controlFunctionLaserRightHand: 'OFF',
            controlFunctionDippedBeamLeftHand: 'ON_DIPB_L', controlLightDistributionLowBeamLeftHand: high ? 'VOLLES_FERNLICHT_LICHTHUPE' : 'H_10_LANDSTRASSE_C',
            controlFunctionDippedBeamRightHand: 'ON_DIPB_R', controlLightDistributionLowBeamRightHand: high ? 'VOLLES_FERNLICHT_LICHTHUPE' : 'H_10_LANDSTRASSE_C',
            controlFunctionCorneringLightLeftHand: 'OFF_CORNL_L', controlFunctionCorneringLightRightHand: 'OFF_CORNL_R', controlPhaseFunctionSpecialFlashing: 'OFF_SPFLS',
            controlModeFunctionSpecialFlashing: 'OFF_SPFLS', controlFunctionMainBeam: high ? 'ON_MAB_MODE_1' : 'OFF_MAB', controlFunctionOVT: 'INIT', controlFunctionFrontFogLight: 'NSW__OFF', controlFunctionManeuverLight: 'RGL__OFF' },
        'brake-light': { cRCControlLampExterior: 0, aliveControlLampExterior: k % 15, controlBrightnessLevelLampExterior: 3, controlFunctionWelcomeLight: 'OFF_WELL', controlFunctionRearFogLamp: 'OFF_RFLI_OFF_TRM',
            controlFunctionPositionLight: 'POLI_MODUS1', controlFunctionParkingLight: 'OFF_PLI', controlFunctionReversingLamp: 'OFF', controlFunctionBrakeForceDisplay: 'OFF_BFD',
            controlFunctionDaytimeRunningLight: 'OFF_DRL', controlFunctionBrakeLight: 'OFF_BL', controlFunctionFollowMeHome: 'OFF_FMH', controlFunctionRemoteLight: 'OFF_REMOTE_MINUS_LIGHT', controlFunctionGoodbyeLight: 'OFF_GBL', dummy2: 0 },
        lights: { statusMainBeam_headlightFlasher: high ? 'EIN' : 'AUS', statusFrontFogLight: 'AUS', statusRearFogLight: 'AUS', statusPositionLight: 'EIN', statusLightStatusError: 'LAMPENZUSTANDS_MINUS_SIGNALE_SIND_IN_ORDNUNG', statusDippedBeam: 'EIN' },
        'hb-low-beam': { statusLowBeam: night ? 'FAHRLICHT_EINSCHALTEN' : 'FAHRLICHT_AUSSCHALTEN', statusSensorLowBeam: 'IN_ORDNUNG', ambientBrightnessLowBeam: town ? 9 : 1, statusLowBeamReason: 2, statusValueLowBeam: 1, stateValueDrivingLightMB3: town ? 60 : 3, stateMB3: 'SIGNAL_GENAUIGKEIT_0_1CD' },
        'hb-switch': { statusLampSwitch: 'STELLUNG_AUTOMATIK', recognitionEventLampSwitch: 'KEIN_EVENT_AKTIV' },
        'hb-indicators': { controlIndicateDirection: 'BLINKEN_AUS', activeFunctionIndicateDirection: 'BLINKEN_AUS' },
        'hb-brightness': { valueBrightnessEnvironment: town ? s.brightness.town : s.brightness.dark },
        'hb-prefield': { valueBrightnessPrefield: town ? 120 : 4 },
        'hb-wiper': { positionWiperBlade: 'WISCHER_INNERHALB_PARKPOSITION' },
        'hb-rain': { intensityRain: 0, speedWiper: 0, statusRainSensor: 0 },
        'hb-lightswitch': 'AUTO',
        'hb-fog-front': false, 'hb-fog-rear': false,
        stalk: { operationColumnStalks: W.stalkAt(t) },
        'stalk-complete': { operationColumnStalks: W.stalkAt(t), statusPushButtonMainBeamAssistant: 'KEINE_BETAETIGUNG' },
        'car-speed2': { speedVehicleCentreOfGravity: Math.round(speed * 64) },
        'yaw-rate': { counter: k % 65536, yawRate: { yawRate: 0.01 * Math.sin(t / 7), invalidFlag: false }, yawRateErrAmp: { yawRateErrAmp: 0.001, invalidFlag: false }, qualifierYawRate: 'SIGNALWERT_GUELTIG', eventDataQualifier: 'EVENT_DATA_AVAILABLE' },
        steering: { actualValueSteeringAngleDriver: 32768 + Math.round(200 * Math.sin(t / 9)), qualifierActualValueSteeringAngleDriver: 'SIGNALWERT_GUELTIG' },
        'gearbox-status': { alivStatusGearboxDrive: k % 15, statusActualStageDrive: speed > 0 || t >= s.drive ? 'D' : 'P', statusActualGearDrive: speed > 60 ? 'G7' : 'G3', statusTargetStageDrive: 'D', qualifierStatusActualStageDrive: 0 },
        'external-display': { displayTemperatureExterior: 92, displayRange: 400, statusUnitOfMeasurementTemperatureInstrumentPack: 'C' },
        tsr: { presentWithdrawalLimitSpeed: 0, recognitionNoPassing: 0, nextWithdrawalLimitSpeed: 0, presentClassLimitSpeed: town ? s.townLimitClass : s.roadLimitClass, nextClassLimitSpeed: 0, countryCodingTrafficSign: 0,
            displayTextMessage: 0, unitOfMeasurementSpeedLimit: 0, displayTextMessageNpi: 0, statusDataMatchingCameraADAS: 0, statusStreetTyp: town ? 1 : 2, evaluationStreetTyp: 0, displaySupplementalSign: 0,
            triggerPresentClassLimitSpeed: 0, displaySpeedNPIDistance: 0, controlSLIWarning: 0 },
        'ccp-builtup': { isBuiltupArea: town },
        'cam-signs': (() => {
            // the camera's sign stream: the town sign for 3 s as the car passes it (in at the town's start, out at its end), else a limit sign
            const at = (x) => s.town && t >= x && t < x + 3;
            const type = s.town && at(s.town[0]) ? 'CITY_LIMIT_START_OF' : s.town && at(s.town[1]) ? 'CITY_LIMIT_END_OF' : 'SPEED_LIMIT';
            const sign = { timestamp: 0, value: type === 'SPEED_LIMIT' ? (town ? 50 : 90) : 0, type, trafficSignForm: 'UNKNOWN', position: { left: false, right: true, overhead: false },
                firstSupplementalType: 'NONE', secondSupplementalType: 'NONE', additionalInfo: 'NONE', variable: false, location: { locationInvalidFlags: 0, x: 30, y: -4, z: 2 }, timestampSec: 0 };
            return { timestamp: { seconds: 0, nanoseconds: 0 }, eventDataQualifier: 'EVENT_DATA_AVAILABLE', extendedQualifier: 'NORMAL_OPERATION_MODE',
                trafficSignRecognition: { version: 1, visibilityCondition: 'GOOD', numberSigns: 1, speedLimitUnit: 'KMH' }, trafficSign: [sign], trafficSignRecognitionQuality: [] };
        })(),
        'hb-objlist': { eventDataQualifier: 'KEVENTDATAQUALIFIER_EVENTDATAAVAILABLE', extendedQualifier: 'KOBJECTLISTEXTENDEDQUALIFIER_NORMALOPERATION',
            timestamp: { seconds: Math.floor(t), nanoseconds: Math.round((t % 1) * 1e9), sync_state: 'KSTDTIMESTAMPSYNCSTATE_INSYNC' }, numberOfObjects: camList.length,
            objectListSmall: camList.map((c) => ({ summary: { id: 1000 + c.id, age: 5, status_measurement: 'KMEASUREMENTSTATUS_MEASURED', status_movement: 'KMOVEMENTSTATUS_MOVED' },
                existence: { invalid_flags: 0, existence_probability: 0.9, existence_ppv: 0.9 }, status_sensors: 1,
                position: { invalid_flags: 0, reference_point: 'MIDDLE_REAR', x: { value: c.x }, x_std_dev: { value: 0.3 }, y: { value: c.y }, y_std_dev: { value: 0.2 }, z: { value: 0.5 }, z_std_dev: { value: 0.1 }, covariance_xy: 0, orientation: { value: 0 }, orientation_std_dev: { value: 0.1 } },
                dynamics: { velocity_absolute: { invalid_flags: 0, x: { value: c.vx }, x_std_dev: { value: 0.2 }, y: { value: 0 }, y_std_dev: { value: 0.1 }, covariance_xy: 0 },
                    acceleration_absolute: { invalid_flags: 0, x: { value: 0 }, x_std_dev: { value: 0.1 }, y: { value: 0 }, y_std_dev: { value: 0.1 }, covariance_xy: 0 } },
                shape: { length: { status: 'KEDGEVISIBILITYSTATUS_COMPLETELYVISIBLE', edge: { invalid_flags: 0, mean: 4.5, std_dev: 0.2 } } },
                classification: { class_car: 90, class_truck: 5, class_motorcycle: 0, class_bicycle: 0, class_pedestrian: 0, class_animal: 0, class_hazard: 0, class_unknown: 5, class_overdrivable: 0, class_underdrivable: 0 },
                lights: { status_flash_light: 'KFLASHLIGHTSTATUS_NONE', status_head_light: 'KHEADLIGHTSTATUS_' + c.head, status_rear_light: 'KREARLIGHTSTATUS_' + c.rear, status_reverse_light: 'KREVERSELIGHTSTATUS_OFF',
                    status_emergency_light: 'KEMERGENCYLIGHTSTATUS_OFF', status_brake_light: 'KBRAKELIGHTSTATUS_OFF' } })),
            frameNumber: k },
        'gap-ahead': { qualifierFunctionVehicleDrivingAhead: 'FUNKTION_VERFUEGBAR', statusMeasurementVehicleDrivingAhead: fol ? 'ELEMENT__GEMESSEN' : 'KEIN_ELEMENT_GEMESSEN', gapVehicleDrivingAhead: fol ? 16 : 255,
            vehicleTypeVehicleDrivingAhead: fol ? 'ZWEISPURIGES_FAHRZEUG' : 'TYP_UNBEKANNT', lampStatusVehicleDrivingAhead: fol ? 'LICHT_AN' : 'SIGNAL_UNGUELTIG' },
        'front-vehicle': { frontVehicleObjectID: fol ? 22 : 0, frontVehicleSpeedX: fol ? 2000 : 0, frontVehicleSpeedY: 0, frontVehicleGapX: fol ? 4000 : 0, frontVehicleGapY: 0,
            qualifierEventDataFunctionFrontVehicle: fol ? 'EVENT_DATA_AVAILABLE' : 'EVENT_DATA_NOT_AVAILABLE', qualifierExtendedFunctionFrontVehicle: 'NORMAL_OPERATION_MODE' },
        'cam-objects': { length: 0, counter: k % 65536, dataID: 1, cRC: 2, timestamp: 0, eventDataQualifier: 'EVENT_DATA_AVAILABLE', extendedQualifier: 'NORMAL_OPERATION_MODE',
            numberOfCars: camList.length, numberOfPedestrians: 0, numberOfCyclists: 0, numberOfBikes: 0, numberOfTrucks: 0, numberOfOtherVehicles: 0, numberOfRoadBoundaries: 0, timestampQualifier: 'SYNC',
            numberOfUnknownObjects: 0, numberOfObjects: camList.length,
            objectRecognitionInfo: camList.map((c) => ({ statusMeasurement: 'ELEMENT_MEASURED', statusMovement: c.mov, classificationType: c.cls, modeLateral: 'OBJECT_FOLLOWS_DRIVING_LANE_NO_CUTTING_IN_OR_OUT', drivingTubeMapping: c.lane, objectID: c.id })) },
        'cam-position': { length: 0, counter: k % 65536, dataID: 1, cRC: 2, timestamp: 0, eventDataQualifier: 'EVENT_DATA_AVAILABLE', extendedQualifier: 'NORMAL_OPERATION_MODE', numberOfObjects: camList.length,
            objectPositionInfo: camList.map((c) => ({ objectPositionInfoInvalidFlags: 0, referencePoint: 'REAR_CENTER', positionX: Math.round(c.x * 100) / 100, positionY: c.y, positionZ: 0.5 })) },
        dimmer: { controlIlluminationSwitch: 3 },
        indicate: { statusIndicateDirection: 0 },
    };
}

// ---- writing one session with the app's recorder -----------------------------------------------------------------------------------
function writeSession(W, outDir, wall, seed) {
    const r = rng(seed);
    const s = W.spec;
    let now = 0;
    const R = new Recorder({ dir: outDir, mono: () => now, wall: () => wall, version: 'synth', cfg: { quotaMB: 500, fileRawKB: 4096, maxQueueKB: 1048576 } });     // no timer runs here: the queue holds it all until the stop
    R.start(['S18']);
    const T = (tag) => { const f = FIELDS.TABLE.find((x) => x.tag === tag); if (!f) throw new Error('no field ' + tag); return f; };
    // periodic sources: [tag, hz, the camera's?]
    const periodic = [['hb-control', HZ.control, true], ['hb-meid1', HZ.meid, true], ['hb-meid2', HZ.meid, true], ['hb-lamps', HZ.lamps], ['brake-light', HZ.lamp1], ['hb-low-beam', HZ.low],
        ['hb-brightness', HZ.brightness], ['hb-prefield', HZ.brightness], ['hb-wiper', HZ.wiper], ['hb-rain', HZ.rain], ['hb-indicators', HZ.indicators], ['car-speed2', HZ.speed], ['yaw-rate', HZ.yaw],
        ['steering', HZ.steering], ['gearbox-status', HZ.gear], ['external-display', HZ.temp], ['tsr', HZ.tsr], ['cam-signs', HZ.tsr], ['front-vehicle', HZ.front], ['cam-objects', HZ.cam], ['cam-position', HZ.cam], ['hb-objlist', HZ.cam], ['gap-ahead', HZ.gap],
        ['dimmer', HZ.dimmer], ['indicate', HZ.indicate]];
    for (let n = 1; n <= 15; n++) periodic.push(['hb-obj' + n, HZ.obj, true, n]);
    const plan = periodic.filter((p) => (s.camera || !p[2]) && !(s.noLamps2 && p[0] === 'hb-lamps')).map((p, i) => ({ f: T(p[0]), tag: p[0], hz: p[1], slot: p[3] || 0, next: 0.003 * (i % 30), k: 0 }));
    // on-change sources: the stalk (both fields), the head unit's lamp status, the switches, the built-up flag
    const onChange = ['stalk', 'stalk-complete', 'lights', 'hb-switch', 'hb-lightswitch', 'hb-fog-front', 'hb-fog-rear', 'ccp-builtup'].filter((tag) => !(s.noLights && tag === 'lights') && !(s.noMap && tag === 'ccp-builtup')).map((tag) => ({ f: T(tag), tag, last: null }));
    const marks = s.mark !== null ? [s.mark] : [];
    // the read-only diagnostic reads while standing (beam_diag.js writes them so): BDC E3B8 (stalk contacts) and D542 (lamp
    // functions) alternating, one a second; INVENTED payloads: E3B8 byte 0 = the contact bits of DIAG_CONTACT, D542 byte 0 = 1 high on
    const dE3 = { tag: 'diag-bdc-e3b8', iface: 'uds.BDC', field: 'E3B8', p: 'P27' }, dD5 = { tag: 'diag-bdc-d542', iface: 'uds.BDC', field: 'D542', p: 'P27' };
    let nextDiag = s.diag ? 0.5 : Infinity, diagK = 0;
    const DT = 0.005;
    let n = 0;
    for (let t = 0; t <= s.end; t = Math.round((t + DT) * 1000) / 1000) {
        now = Math.round(t * 1000);
        if (marks.length && t >= marks[0]) { R.mark(1); marks.shift(); }
        let vals = null;
        const get = () => (vals = vals || values(W, t, n++, r));
        plan.forEach((p) => {
            if (t < p.next) return;
            p.next += 1 / p.hz * (1 + (r() - 0.5) * 0.1);
            const v = get();
            p.k++;
            if (p.slot) R.sample({ f: p.f }, objEvent(p.slot, s.camera === 'defaults' ? null : v.objects[p.slot]));
            else if (s.camera === 'defaults' && DEFAULTS[p.tag]) R.sample({ f: p.f }, DEFAULTS[p.tag]);
            else R.sample({ f: p.f }, v[p.tag]);
        });
        if (t >= nextDiag && W.speedAt(t) < 0.5) {
            nextDiag += 1;
            if (diagK++ % 2 === 0) R.sample({ f: dE3 }, { ok: 1, nrc: -1, n: 2, b00: DIAG_CONTACT[W.stalkAt(t)] || 0, b01: 0 });
            else R.sample({ f: dD5 }, { ok: 1, nrc: -1, n: 2, b00: W.highAt(t) ? 1 : 0, b01: 0 });
        }
        onChange.forEach((c) => {
            const v = get()[c.tag], key = JSON.stringify(v);
            if (key === c.last) return;
            c.last = key;
            R.sample({ f: c.f }, v);
        });
    }
    R.stop(true);
    return R.status();
}

function main(argv) {
    const out = argv[0];
    if (!out || out[0] === '-') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 22).join('\n')); return 2; }
    const opt = (name, def) => { const i = argv.indexOf(name); return i > 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : def; };
    const seed = opt('--seed', 1), extra = opt('--minutes', 0);
    const recDir = path.join(out, 'rec');
    fs.mkdirSync(recDir, { recursive: true });
    const truth = { _about: 'hb_synth.js: INVENTED numbers for testing tools/car/hb_analyse.py; not car facts', seed,
        encodings: { classes: CLS, statusValid: STATUS_VALID, controlHighBeam: { allow: ALLOW, deny: DENY }, lampDelay_s: LAMP_DELAY },
        stalk: BITS, diagContact: DIAG_CONTACT, highMembers: ['hb-lamps.controlFunctionMainBeam', 'lights.statusMainBeam_headlightFlasher'],
        cameraLead_s: { high_off: CAM_LEAD_DIP, high_on: CAM_LEAD_HIGH },
        // the analysis times a switch by the lamp's command (LAMP_DELAY after the stalk), so the lead it measures is this
        expectedLead_s: { high_off: CAM_LEAD_DIP + LAMP_DELAY, high_on: CAM_LEAD_HIGH + LAMP_DELAY }, sessions: {} };
    // two sessions, a minute apart on the wall clock (the session id is the start time)
    const wall0 = Date.UTC(2026, 10, 20, 18, 0, 0) + seed * 1000;
    [sessionA(extra), sessionB(), sessionC()].forEach((spec, i) => {
        const W = makeWorld(spec);
        const wall = wall0 + i * 3600 * 1000;
        const st = writeSession(W, recDir, wall, seed * 10 + i);
        const d = new Date(wall);
        const two = (x) => (x < 10 ? '0' : '') + x;
        const sid = d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
        const drive = spec.actions.filter((a) => !/^parked\./.test(a.kind)).map((a) => ({ t: a.t, kind: a.kind }));
        truth.sessions[spec.name] = {
            session: sid, camera: spec.camera === 'defaults' ? 'defaults' : spec.camera, end_s: spec.end, drive_s: spec.drive, mark: spec.mark,
            highMember: spec.noLights ? 'hb-lamps.controlFunctionMainBeam' : 'lights.statusMainBeam_headlightFlasher',     // the head unit's lamp status first
            parked: spec.parked === null ? null : spec.actions.filter((a) => /^parked\./.test(a.kind)).map((a) => ({ t: a.t, kind: a.kind.slice(7), bits: a.bits, hold_s: a.hold })),
            driver: drive, lampChanges: W.beam.map((b) => ({ t: Math.round(b[0] * 1000) / 1000, on: b[1] })),
            dips: drive.filter((a) => a.kind === 'high_off').map((a) => a.t), highs: drive.filter((a) => a.kind === 'high_on').map((a) => a.t), flashes: drive.filter((a) => a.kind === 'flash').map((a) => a.t),
            objects: spec.objects.filter((o) => o.what !== 'street light' && o.what !== 'town light').map((o) => ({ slot: o.slot, id: o.id, cls: o.cls, t0: o.t0, t1: o.t1, what: o.what })),
            following: spec.following, town: spec.town, keepHighWithObjects: spec.keepHighWithObjects, oncomingFallback: spec.oncomingFallback,
            recorder: { samples: st.samples, folded: st.folded, dropped: st.dropped, errors: st.errors },
        };
    });
    fs.writeFileSync(path.join(out, 'truth.json'), JSON.stringify(truth, null, 1) + '\n');
    console.log('hb_synth: ' + Object.keys(truth.sessions).map((k) => k + ' ' + truth.sessions[k].session + ' (' + truth.sessions[k].recorder.samples + ' samples, ' + truth.sessions[k].recorder.folded + ' folded)').join(', ') + ' -> ' + out);
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { BITS, CLS, makeWorld, sessionA, sessionB, objEvent };
