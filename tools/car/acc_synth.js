#!/usr/bin/env node
'use strict';
/**
 * acc_synth.js - r1120 AC: synthetic Signal Probe recordings of the ACC set (S17), made with the cruise simulator's own plant
 * (tools/cruise-sim/core/plant.js) and written by the app's own recorder (apps/signal_probe/recorder.js), so that
 * tools/car/acc_analyse.py can be tested against numbers it must find. NOTHING here is a car fact: every rate, delay, unit and
 * plant parameter below is invented for the test and written to truth.json.
 *
 *   node tools/car/acc_synth.js <out folder> [--seed N] [--no-steps] [--no-anchors]
 *
 *   <out>/rec/rec-<session>-<n>.csv.gz   three recordings, the blocks of docs/cruise/DRIVE-PROTOCOL.md:
 *                                        A  parked behind a standing car at 5 / 10 / 15 / 20 / 30 m (a mark at each)
 *                                        B  set-speed steps by the stalk at 80 and 100 km/h (+-1 one tap at a time, +-5 five taps,
 *                                           +-10 / +-20 past the detent), an override during one step, a coast-down with the cruise
 *                                           cancelled, a resume, a brake tap
 *                                        C  following a car at 4 s, 3 s, 2 s with post pairs marked, the lead slowing, a cut-out
 *   <out>/truth.json                     the plant, the steady-state map of the set speed, every field's rate, delay and unit, the
 *                                        apparent dead times the fit should find (dead time + speed delay - display delay)
 *   <out>/anchors.json                   the passenger's notes as acc_analyse.py reads them (static gaps by mark, post pairs)
 *   --no-steps: block B without any set-speed change (the analysis must say there is no step to fit)
 *
 * Mac only, never shipped. Deterministic for a seed.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const plantMod = require(path.join(ROOT, 'tools', 'cruise-sim', 'core', 'plant.js'));
const rngMod = require(path.join(ROOT, 'tools', 'cruise-sim', 'core', 'rng.js'));
const FIELDS = require(path.join(ROOT, 'apps', 'signal_probe', 'fields.js'));
const { Recorder } = require(path.join(ROOT, 'apps', 'signal_probe', 'recorder.js'));

const KMH = 1 / 3.6;
const DT = 0.01;

// ---- the invented truth --------------------------------------------------------------------------------------------------------
const PLANT = { model: 'P2', deadTime_s: 0.6, tau_s: 2.5, deadTimeDown_s: 0.4, tauDown_s: 1.6, aMax_ms2: 1.2, aMin_ms2: -1.5, brakeMax_ms2: 1.5,
    resolution_kmh: 0.1, vMinActive_kmh: 30, dropoutBelow_kmh: 0 };
// the cruise holds the DISPLAYED speed at the set speed: displayed = 1.03 x true + 1 (a speedometer that reads high)
const SPEEDO = { k: 1.03, c: 1.0 };
const WHEEL_R = 0.334;                          // m, rolling radius
// rate Hz, delay ms (from the measurement to the app), jitter ms (exponential on top), and how the value is encoded
const SIG = {
    'car-speed2': { hz: 10, lat: 120, jit: 15 },                 // the anchor: km/h x 64 (the kit's verified scale)
    'speed': { hz: 50, lat: 40, jit: 5 },                        // 0.01 m/s
    'velocity': { hz: 50, lat: 30, jit: 5 },                     // m/s float
    'velocity-long': { hz: 50, lat: 30, jit: 5 },
    'dynamics-long': { hz: 50, lat: 45, jit: 5 },                // speed 0.01 km/h, acceleration (a + 10.24) / 0.005
    'display-speed': { hz: 5, lat: 250, jit: 30 },               // the displayed speed (1.03 x + 1), whole km/h
    'wheel-rpm': { hz: 50, lat: 40, jit: 5 },                    // 0.5 rpm
    'hud-data2': { hz: 5, lat: 150, jit: 20, onChange: true },   // the set speed in km/h, 65535 = none; the cruise icon and state
    'hud-data': { hz: 5, lat: 160, jit: 20, onChange: true },    // cruiseCtrlSpeedHUD km/h
    'ldm-guidance': { hz: 5, lat: 180, jit: 20, onChange: true },// valueRequestSpeed = set x 2
    'accel-long-cog': { hz: 50, lat: 35, jit: 5 },               // m/s^2 float, noisy
    'accel-long-est': { hz: 50, lat: 60, jit: 5 },               // m/s^2 float
    'cds-accel-long': { hz: 10, lat: 100, jit: 15 },             // (a + 65) / 0.002
    'accel-long': { hz: 50, lat: 40, jit: 5 },                   // a / 0.01 + 1000
    'accel-pedal': { hz: 50, lat: 30, jit: 5 },
    'drive-torque': { hz: 50, lat: 30, jit: 5 },
    'brake-driver': { hz: 50, lat: 30, jit: 5 },
    'brake-switch': { hz: 10, lat: 40, jit: 5 },
    'brake-light': { hz: 10, lat: 40, jit: 5 },
    'front-vehicle': { hz: 25, lat: 150, jit: 20 },              // gapX = metres x 16 (4093 = none), speedX = 1500 + 25 x relative m/s
    'cam2-polar': { hz: 15, lat: 120, jit: 15 },                 // metres and m/s floats, the camera's own time stamp
    'gearbox-status': { hz: 10, lat: 50, jit: 5 },
    'fes-switch': { hz: 1, lat: 100, jit: 10 },
    'steering': { hz: 10, lat: 80, jit: 10 },
    'gradient': { hz: 10, lat: 60, jit: 5 },
};
const CAM_CLOCK_OFFSET_S = 1000.25;          // the camera's clock against the drive's start

function parseArgs(argv) {
    const a = { out: null, seed: 1, steps: true, anchors: true };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--seed') a.seed = Number(argv[++i]);
        else if (argv[i] === '--no-steps') a.steps = false;
        else if (argv[i] === '--no-anchors') a.anchors = false;
        else a.out = argv[i];
    }
    if (!a.out) { console.error('usage: acc_synth.js <out folder> [--seed N] [--no-steps] [--no-anchors]'); process.exit(2); }
    return a;
}

// ---- one block: the plant, a lead, the driver's script; the state every 10 ms ----------------------------------------------------
function runBlock(spec, rng) {
    const pp = plantMod.params(Object.assign({ preset: 'mild' }, PLANT));
    const P = plantMod.create(pp, rng.fork('plant'), {});
    const toPlant = (setDisp) => ((setDisp - SPEEDO.c) / SPEEDO.k) * KMH;          // the displayed set speed -> the true speed held
    const ego = { v: spec.v0 * KMH, x: 0 };
    P.init(ego, { state: spec.cruise ? 'active' : 'off', set: spec.cruise ? toPlant(spec.set0) : null });
    let setDisp = spec.cruise ? spec.set0 : null;
    const lead = spec.lead ? { x: spec.lead.gap0, v: spec.lead.v0 * KMH, present: true } : null;
    const ev = spec.events.slice().sort((a, b) => a.t - b.t);
    const out = { t: [], v: [], a: [], set: [], state: [], gap: [], vrel: [], present: [], accel: [], brake: [], lamp: [] };
    const marks = [];
    let ei = 0, drv = { accel: 0, brake: 0 }, accelUntil = -1, brakeUntil = -1, resumeAt = -1, cancelAt = -1;
    const n = Math.round(spec.dur / DT);
    for (let k = 0; k <= n; k++) {
        const t = k * DT;
        while (ei < ev.length && ev[ei].t <= t + 1e-9) {
            const e = ev[ei++];
            if (e.kind === 'press') {
                const r = P.request(t, toPlant(e.to));
                if (r.status === 'applied') setDisp = e.to;
            } else if (e.kind === 'accel') { drv.accel = e.level; accelUntil = t + e.dur; }
            else if (e.kind === 'brake') { drv.brake = e.level; brakeUntil = t + e.dur; }
            else if (e.kind === 'cancel') cancelAt = t;
            else if (e.kind === 'resume') resumeAt = t;
            else if (e.kind === 'mark') marks.push({ t: t + e.delay, note: e.note || '' });
            else if (e.kind === 'leadSpeed' && lead) lead.target = { v: e.v * KMH, a: e.a };
            else if (e.kind === 'leadGone' && lead) lead.present = false;
            else if (e.kind === 'leadAt' && lead) { lead.x = ego.x + e.gap; lead.present = true; }
        }
        if (t > accelUntil) drv.accel = 0;
        if (t > brakeUntil) drv.brake = 0;
        const din = { accel: drv.accel, brake: drv.brake, cancel: Math.abs(t - cancelAt) < DT / 2, resume: Math.abs(t - resumeAt) < DT / 2 };
        let a = 0, st = 'off';
        if (spec.cruise) {
            const r = P.step(DT, { t, grade: 0, driver: din }, ego);
            a = r.a; st = r.cruiseState;
            if (st === 'active' || st === 'override') setDisp = setDisp === null ? spec.set0 : setDisp;
        } else if (spec.v0 > 0) a = P.coast(ego.v, 0);
        // the brake lamp: the driver's brake, or the cruise asking for more than the engine and the drag give
        const lampCruise = (st === 'active') && (a + P.resist(ego.v) + P.engineBrake(ego.v) < -0.05);
        out.t.push(t); out.v.push(ego.v); out.a.push(a); out.set.push(st === 'off' ? null : setDisp); out.state.push(st);
        out.accel.push(drv.accel); out.brake.push(drv.brake); out.lamp.push(drv.brake > 0 || lampCruise);
        if (lead) {
            out.gap.push(lead.present ? lead.x - ego.x : null); out.vrel.push(lead.present ? lead.v - ego.v : null); out.present.push(lead.present);
            if (lead.target) { const d = lead.target.v - lead.v; const s = Math.sign(d) * Math.min(Math.abs(d), Math.abs(lead.target.a) * DT); lead.v += s; }
            lead.x += lead.v * DT;
        } else { out.gap.push(spec.staticGap ? spec.staticGap(t) : null); out.vrel.push(spec.staticGap && spec.staticGap(t) !== null ? 0 : null); out.present.push(!!(spec.staticGap && spec.staticGap(t) !== null)); }
        ego.v = Math.max(0, ego.v + a * DT);
        ego.x += ego.v * DT;
    }
    return { out, marks, P };
}

// ---- the three blocks ---------------------------------------------------------------------------------------------------------
function blocks(steps, rng) {
    const mk = (t, note) => ({ t, kind: 'mark', delay: 0.3 + rng.uniform(0, 0.1), note });
    // A: parked, a standing car at 5 / 10 / 15 / 20 / 30 m, 20 s each
    const gaps = [5, 10, 15, 20, 30];
    const A = { name: 'A', dur: 110, v0: 0, cruise: false, events: gaps.map((g, i) => mk(2 + i * 20, 'gap ' + g)),
        staticGap: (t) => (t < 2 ? null : gaps[Math.min(gaps.length - 1, Math.floor((t - 2) / 20))]) };
    // B: steps at 80 and 100 km/h. taps: one press per km/h, 0.4 s apart; past the detent: to the next ten, 0.5 s apart
    const evB = [];
    let set = 80;
    const step = (t, kind, dir, note) => {
        const from = set;
        if (kind === 'tap') { for (let i = 0; i < Math.abs(dir); i++) { set += Math.sign(dir); evB.push({ t: t + i * 0.4, kind: 'press', to: set }); } }
        else { for (let i = 0; i < Math.abs(dir); i++) { set = Math.sign(dir) > 0 ? Math.floor(set / 10) * 10 + 10 : Math.ceil(set / 10) * 10 - 10; evB.push({ t: t + i * 0.5, kind: 'press', to: set }); } }
        evB.push(mk(t, note || ((set - from > 0 ? '+' : '') + (set - from))));
    };
    if (steps) {
        step(20, 'tap', 1); step(40, 'tap', -1); step(60, 'tap', 5); step(80, 'tap', -5); step(100, 'detent', 1); step(125, 'detent', -1);
        step(150, 'detent', 2); step(180, 'detent', -2);
        step(210, 'detent', 1, 'override'); evB.push({ t: 213, kind: 'accel', level: 0.6, dur: 4 });      // excluded: the accelerator
        step(240, 'detent', -1);
        evB.push({ t: 265, kind: 'cancel' }, mk(265, 'coast')); evB.push({ t: 277, kind: 'resume' }, mk(277, 'resume'));   // coast-down, resume
        step(300, 'detent', 2); step(330, 'tap', 1); step(350, 'tap', -1); step(370, 'tap', 5); step(390, 'tap', -5); step(410, 'detent', -1);
        step(435, 'detent', 1); step(460, 'detent', -2);
        evB.push({ t: 490, kind: 'brake', level: 1.0, dur: 0.8 }, mk(490, 'brake'));                     // excluded: the brake
        evB.push({ t: 497, kind: 'resume' });
    } else {
        evB.push({ t: 265, kind: 'cancel' }, mk(265, 'coast')); evB.push({ t: 277, kind: 'resume' });
    }
    // the true speed at the start: what the cruise holds for 80 on the display
    const B = { name: 'B', dur: 520, v0: (80 - SPEEDO.c) / SPEEDO.k, set0: 80, cruise: true, events: evB };
    // C: a lead at 90 km/h (true), we follow at 4 s, then 3 s, then 2 s by small set changes; post pairs; the lead slows; a cut-out
    const vC = 90;
    const evC = [];
    const setC = Math.round(vC * SPEEDO.k + SPEEDO.c);       // the displayed set speed that holds 90 true
    const posts = [];
    const hold = (t0, t1, gapS) => { for (let t = t0 + 6; t < t1 - 8; t += 14) posts.push({ t, gapS }); };
    hold(0, 70, 4);
    evC.push({ t: 70, kind: 'press', to: setC - 5 }, { t: 88, kind: 'press', to: setC });
    hold(95, 160, 3);
    evC.push({ t: 160, kind: 'press', to: setC - 5 }, { t: 178, kind: 'press', to: setC });
    hold(185, 250, 2);
    evC.push({ t: 250, kind: 'leadSpeed', v: 70, a: 1.6 }, mk(250, 'lead slows'));
    evC.push({ t: 251.5, kind: 'press', to: setC - 10 }, { t: 253.3, kind: 'press', to: setC - 15 }, { t: 255.1, kind: 'press', to: setC - 20 });
    evC.push({ t: 290, kind: 'leadGone' }, mk(290, 'cut-out'));
    if (!steps) evC.splice(0, evC.length, { t: 290, kind: 'leadGone' }, mk(290, 'cut-out'));          // --no-steps: no set change anywhere
    const C = { name: 'C', dur: 300, v0: vC, set0: setC, cruise: true, lead: { gap0: vC * KMH * 4, v0: vC }, events: evC };
    return { A, B, C, posts };
}

// ---- the signals: each field sampled at its rate from the state, delivered after its delay ------------------------------------------
function noiseOf(rng) { return (sd) => rng.normal(0, sd); }

function emit(block, run, rng, camClock) {
    const o = run.out;
    const N = o.t.length;
    const at = (t) => { const i = Math.max(0, Math.min(N - 1, Math.round(t / DT))); return i; };
    const nz = noiseOf(rng.fork('noise'));
    const jit = rng.fork('jitter');
    const samples = [];
    const alive = {};
    const ctr = (tag, mod) => { alive[tag] = ((alive[tag] === undefined ? -1 : alive[tag]) + 1) % mod; return alive[tag]; };
    const stateName = (s) => (s === 'active' ? 'ACTIVE' : s === 'override' ? 'OVERRIDE' : s === 'suspended' || s === 'dropout' ? 'STANDBY' : 'OFF');
    const smooth = (arr, i, w) => { let s = 0, c = 0; for (let j = Math.max(0, i - w); j <= i; j++) { s += arr[j]; c++; } return s / c; };
    const valueOf = (tag, i, tm) => {
        const v = o.v[i], a = o.a[i], kmh = v / KMH;
        const set = o.set[i], st = o.state[i];
        const pedal = o.accel[i] > 0, brk = o.brake[i] > 0;
        switch (tag) {
            case 'car-speed2': return { speedVehicleCentreOfGravity: Math.round(kmh * 64) };
            case 'speed': return { aliveSpeedVehicle: ctr(tag, 15), statusSpeedVehicleNearStandstill: kmh < 1 ? 'STILLSTAND' : 'FAHRZEUG_FAEHRT', speedVehicleCentreOfGravity: Math.max(0, Math.round((v + nz(0.01)) * 100)), qualifierSpeedVehicleCentreOfGravity: 'SIGNALWERT_IST_GUELTIG' };
            case 'velocity': return { counter: ctr(tag, 65536), statusVelocityNearStandstill: 'NO_STANDSTILL', velocityVehicleCog: { velocityVehicleCog: v + nz(0.01), invalidFlag: false }, qualifierVelocityVehicleCog: 'VALID', eventDataQualifier: 'EVENT_DATA_AVAILABLE' };
            case 'velocity-long': return { counter: ctr(tag, 65536), velocityVehicleLongitudinal: { velocityVehicleLongitudinal: v + nz(0.01), invalidFlag: false }, qualifierVelocityVehicleLongitudinal: 'VALID', eventDataQualifier: 'EVENT_DATA_AVAILABLE' };
            case 'dynamics-long': return { aliveVehicleDynamicsDataLongitudinal1: ctr(tag, 15), qualifierLongitudinalAccelerationDrivingDirection2: 'VALID', longitudinalAccelerationDrivingDirection2: Math.round((a + nz(0.03) + 10.24) / 0.005), vehicleSpeedLongitudinal: Math.round(kmh * 100), qualifierVehicleSpeedLongitudinal: 'VALID', emptyMassVehicle: 1540 };
            case 'display-speed': return { counter: ctr(tag, 65536), displayedValueSpeed: Math.round(kmh * SPEEDO.k + (kmh > 0.5 ? SPEEDO.c : 0)), unitSpeed: 'KMH' };
            case 'wheel-rpm': { const rpm = v / (2 * Math.PI * WHEEL_R) * 60; const r = () => Math.round((rpm + nz(0.3)) * 2); return { aliveActualValueRPMWheel: ctr(tag, 15), actualValueRPMWheelRLH: r(), actualValueRPMWheelRRH: r(), actualValueRPMWheelFLH: r(), actualValueRPMwheelFRH: r(), qualifierActualValueRPMWheelRLH: 'VALID' }; }
            case 'hud-data2': return { speed: { kmh_Digital: Math.round(kmh * SPEEDO.k + (kmh > 0.5 ? SPEEDO.c : 0)) }, ldmSetSpeed: { ldmSetSpeedValue: set === null ? 65535 : set, ldmSetSpeedColour: st === 'active' || st === 'override' ? 'ACTIVE_GREEN' : st === 'off' ? 'OFF' : 'INACTIVE_GREY' }, ldmIconId: st === 'off' ? 'OFF' : 'DCC', ldmIconState: stateName(st) };
            case 'hud-data': return { speed: { kmH: Math.round(kmh * SPEEDO.k + (kmh > 0.5 ? SPEEDO.c : 0)) }, ldmSym: st === 'off' ? 'LDM_SYM_NONE' : 'LDM_SYM_DCC', ldmSymColor: st === 'active' ? 'LDM_ACTIVE' : 'LDM_OFF', cruiseCtrlSpeedHUD: set === null ? 65535 : set };
            case 'ldm-guidance': return { aliveDisplayDriverAssistenceSystemLongitudinalGuidance: ctr(tag, 15), displayXCC: st === 'active' ? 1 : 0, activeFunctionDriverAssistenceSystemLDM: st === 'active' ? 'XCC_AKTIV' : 'KEINE_FUNKTION_AKTIV', valueRequestSpeed: set === null ? 0 : set * 2 };
            case 'accel-long-cog': return { counter: ctr(tag, 65536), accelerationLongitudinalCog: { accelerationLongitudinalCentreOfGravity: a + nz(0.05), invalidFlag: false }, qualifierAccelerationLongitudinalCog: 'VALID', eventDataQualifier: 'EVENT_DATA_AVAILABLE' };
            case 'accel-long-est': return { counter: ctr(tag, 65536), vehicleAccelerationLongitudinalEstimated: { VehicleAccelerationLongitudinalEstimated: smooth(o.a, i, 5) + nz(0.02), invalidFlag: false }, qualifierVehicleAccelerationLongitudinalEstimated: 'VALID', eventDataQualifier: 'EVENT_DATA_AVAILABLE' };
            case 'cds-accel-long': return { longitudinalAccelerationCentreOfGravity: Math.round((a + nz(0.03) + 65) / 0.002) };
            case 'accel-long': return { aliveLongitudinalAccelerationCentreOfGravity: ctr(tag, 15), longitudinalAccelerationCentreOfGravity: Math.round((a + nz(0.04)) / 0.01 + 1000), longitudinalAccelerationCentreOfGravityErrorAmplitude: 3, qualifierLongitudinalAccelerationCentreOfGravity: 'VALID' };
            case 'accel-pedal': return { aliveAngleAcceleratorPedal: ctr(tag, 15), actualValueAngleAcceleratorPedal: pedal ? Math.round(o.accel[i] * 4000) : 0, qualifierActualValueAngleAcceleratorPedal: 'SIGNALWERT_IST_GUELTIG', dummy2: pedal ? (st === 'override' ? 'FAHRPEDAL_MINUS__FAHRER_MINUS___ANFORDERUNG_GROESSER_FAS_MINUS_ANFORDERUNG' : 'FAHRPEDAL_MINUS__FAHRER_MINUS___ANFORDERUNG__KEINE_FAS_MINUS_ANFORDERUNG') : (st === 'active' ? 'KEINE_FAHRPEDAL_MINUS__FAHRER_MINUS___ANFORDERUNG__FAS_MINUS_ANFORDERUNG' : 'KEINE_FAHRPEDAL_MINUS__FAHRER_MINUS___ANFORDERUNG__KEINE_FAS_MINUS_ANFORDERUNG') };
            case 'drive-torque': return { aliveWheelMomentDrive4: ctr(tag, 15), statusInterfaceDriverAssistenceSystemTargetLimit: pedal ? 'FAHRPEDAL_GETRETEN__FAHRERANFORDERUNG_GROESSER_FAS_MINUS_SOLLMOMENT_MINUS_LIM' : 'FAHRPEDAL_NICHT_GETRETEN__KEINE_FAS_MINUS_ANFORDERUNG' };
            case 'brake-driver': return { aliveStatusStabilisationDSC: ctr(tag, 15), statusBrakingDriver: brk ? 1 : 0, statusBrakingMSA: 0, statusUnitRunDSC: 'DSC_AKTIV' };
            case 'brake-switch': return { aliveInformationVehicleDrive: ctr(tag, 15), dummy2: brk ? 'BLS_MINUS_BETAETIGUNG' : 'KEINE_BLS_MINUS_BETAETIGUNG' };
            case 'brake-light': return { aliveControlLampExterior: ctr(tag, 15), controlFunctionBrakeLight: o.lamp[i] ? 'ON_BL' : 'OFF_BL' };
            case 'front-vehicle': {
                const g = o.gap[i];
                if (g === null) return { frontVehicleObjectID: 0, frontVehicleSpeedX: 1500, frontVehicleSpeedY: 0, frontVehicleGapX: 4093, frontVehicleGapY: 0, qualifierEventDataFunctionFrontVehicle: 'KEIN_OBJEKT', qualifierExtendedFunctionFrontVehicle: 'KEIN_OBJEKT' };
                const sd = 0.1 + 0.0002 * g * g;
                return { frontVehicleObjectID: 7, frontVehicleSpeedX: Math.round(1500 + 25 * (o.vrel[i] + nz(0.05))), frontVehicleSpeedY: 0, frontVehicleGapX: Math.round((g + nz(sd)) * 16), frontVehicleGapY: 0, qualifierEventDataFunctionFrontVehicle: 'OBJEKT_ERKANNT', qualifierExtendedFunctionFrontVehicle: 'OBJEKT_ERKANNT' };
            }
            case 'cam2-polar': {
                const g = o.gap[i];
                const ts = tm + camClock;
                const pol = g === null ? [] : [{ invalid_flags: 0, distance: g + nz(0.08 + 0.00015 * g * g), stdDevDistance: 0.08 + 0.00015 * g * g, distanceRate: o.vrel[i] + nz(0.08), stdDevDistanceRate: 0.08, angle: 0.01, stdDevAngle: 0.002, angularRate: 0, stdDevAngularRate: 0.001 }];
                return { counter: ctr(tag, 65536), timestamp: { seconds: Math.floor(ts), nanoseconds: Math.round((ts - Math.floor(ts)) * 1e9) % 1000000000, sync_state: 'KSTDTIMESTAMPSYNCSTATE_INSYNC' }, eventDataQualifier: 'EVENT_DATA_AVAILABLE', numberOfObjects: pol.length, polarCoordinates: pol };
            }
            case 'gearbox-status': return { alivStatusGearboxDrive: ctr(tag, 15), statusActualStageDrive: kmh > 0.5 || block.name !== 'A' ? 'D' : 'P', statusActualGearDrive: 'G' + Math.max(1, Math.min(8, Math.round(kmh / 18))), statusTargetStageDrive: 'D', qualifierStatusActualStageDrive: 0 };
            case 'fes-switch': return { actualValueModeDrivingExperience: 'COMFORT' };
            case 'steering': return { actualValueSteeringAngleDriver: Math.round(32768 + nz(3)), qualifierActualValueSteeringAngleDriver: 'INITIALISIERUNG' };
            case 'gradient': return { counter: ctr(tag, 65536), longitudinalGradientSurface: { longitudinalGradientSurface: nz(0.1), invalidFlag: false }, qualifierLongitudinalGradientSurface: 'VALID', longitudinalGradientSurfaceFast: { longitudinalGradientSurfaceFast: nz(0.2), invalidFlag: false }, eventDataQualifier: 'EVENT_DATA_AVAILABLE' };
            default: return null;
        }
    };
    const dur = o.t[N - 1];
    Object.keys(SIG).forEach((tag, k) => {
        const s = SIG[tag];
        const period = 1 / s.hz;
        let tm = (k % 10) * period / 10;
        let lastKey = null;
        while (tm <= dur) {
            const i = at(tm);
            samples.push({ td: tm + (s.lat + (s.jit ? -s.jit * Math.log(1 - jit.next()) : 0)) / 1000, tag, i, tm });
            tm += period * (1 + 0.01 * (jit.next() - 0.5));
        }
        if (s.onChange) {
            // a change of the set speed or the cruise state is sent at once, not only at the next tick
            for (let i = 1; i < N; i++) {
                const key = o.set[i] + '/' + o.state[i];
                if (lastKey !== null && key !== lastKey) samples.push({ td: o.t[i] + (s.lat + s.jit * 0.5) / 1000, tag, i, tm: o.t[i] });
                lastKey = key;
            }
        }
    });
    samples.sort((a, b) => a.td - b.td);
    // values are made in delivery order (the counters count as the app sees them)
    return samples.map((x) => ({ td: x.td, tag: x.tag, value: valueOf(x.tag, x.i, x.tm) }));
}

async function writeSession(dir, name, startWall, samples, marks) {
    const byTag = {};
    FIELDS.TABLE.forEach((f) => { byTag[f.tag] = f; });
    let now = 0;
    const R = new Recorder({ dir, mono: () => now, wall: () => startWall, version: 'synth', cfg: { quotaMB: 500 } });
    R.start(['S17']);
    const all = samples.map((s) => ({ td: s.td, s })).concat(marks.map((m, k) => ({ td: m.t, mark: k + 1 }))).sort((a, b) => a.td - b.td);
    let nextFlush = 1;
    for (let i = 0; i < all.length; i++) {
        now = all[i].td * 1000;
        if (all[i].mark) R.mark(all[i].mark);
        else R.sample({ f: byTag[all[i].s.tag] }, all[i].s.value);
        if (all[i].td >= nextFlush) { nextFlush += 2; await catchUp(R); }
    }
    now += 500;
    R.stop();
    await drain(R);
    if (R.status().dropped || R.status().errors) throw new Error(name + ': the recorder dropped ' + R.status().dropped + ', errors ' + R.status().errors);
    return R.status().session;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function catchUp(rec) { for (let i = 0; i < 5000 && (rec.writing || rec.segs.some((sg) => sg.chunks.length)); i++) { rec._flush(); await sleep(0); } }
async function drain(rec) {
    for (let i = 0; i < 20000; i++) {
        if (!rec.writing && rec.queued === 0 && (rec.segs.length === 0 || (rec.segs.length === 1 && !rec.segs[0].chunks.length && !rec.segs[0].closed))) return;
        rec._flush(); await sleep(1);
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const rng = rngMod.create(args.seed);
    const recDir = path.join(args.out, 'rec');
    fs.mkdirSync(recDir, { recursive: true });
    const bl = blocks(args.steps, rng.fork('script'));
    const base = Date.UTC(2026, 10, 21, 8, 0, 0);
    const sessions = {};
    const anchors = { schema: 1, static: [], pairs: [] };
    const plan = [['A', bl.A, 0], ['B', bl.B, 600], ['C', bl.C, 1500]];
    for (let p = 0; p < plan.length; p++) {
        const [name, spec, off] = plan[p];
        const run = runBlock(spec, rng.fork('block' + name));
        let marks = run.marks.slice();
        if (name === 'C') {
            // the post pairs: the lead's rear bumper passes a post, then our front bumper; both marked with the passenger's delay
            const o = run.out;
            bl.posts.forEach((pp) => {
                const i = Math.round(pp.t / DT);
                const g = o.gap[i], v = o.v[i];
                if (g === null) return;
                const t1 = pp.t + 0.3 + rng.uniform(0, 0.1), t2 = pp.t + g / v + 0.3 + rng.uniform(0, 0.1);
                marks.push({ t: t1, note: 'post lead' }, { t: t2, note: 'post us' });
            });
            marks.sort((a, b) => a.t - b.t);
        }
        const samples = emit(spec, run, rng.fork('emit' + name), CAM_CLOCK_OFFSET_S + off);
        const sid = await writeSession(recDir, name, base + off * 1000, samples, marks);
        sessions[name] = { session: sid, marks: marks.map((m, k) => ({ n: k + 1, t_ms: Math.round(m.t * 1000), note: m.note })) };
        if (args.anchors && name === 'A') marks.forEach((m, k) => { const g = /^gap (\d+)/.exec(m.note); if (g) anchors.static.push({ session: sid, mark: k + 1, gap_m: Number(g[1]), hold_s: 15 }); });
        if (args.anchors && name === 'C') marks.forEach((m, k) => { if (m.note === 'post lead' && marks[k + 1] && marks[k + 1].note === 'post us') anchors.pairs.push({ session: sid, lead: k + 1, us: k + 2 }); });
    }
    // a change of the set speed reaches the app SIG.lat + jit / 2 after the press (the on-change send)
    const td = (dead, lat) => +(dead + lat / 1000 - (SIG['hud-data2'].lat + SIG['hud-data2'].jit / 2) / 1000).toFixed(3);
    const truth = {
        schema: 1, note: 'invented for the test of acc_analyse.py; not a car fact',
        plant: PLANT, speedo: SPEEDO, wheelRadius_m: WHEEL_R, signals: SIG, camClockOffset_s: CAM_CLOCK_OFFSET_S, sessions,
        expect: {
            // what the fit on car-speed2 must find: the plant's dead time plus the speed's delay minus the set-speed display's delay
            deadTimeUp_s: td(PLANT.deadTime_s, SIG['car-speed2'].lat + SIG['car-speed2'].jit), deadTimeDown_s: td(PLANT.deadTimeDown_s, SIG['car-speed2'].lat + SIG['car-speed2'].jit),
            tauUp_s: PLANT.tau_s, tauDown_s: PLANT.tauDown_s, aMax_ms2: PLANT.aMax_ms2, aMin_ms2: PLANT.aMin_ms2,
            steady: { k: 1 / SPEEDO.k, c: -SPEEDO.c / SPEEDO.k },
            units: { 'speed.speedVehicleCentreOfGravity': 0.036, 'dynamics-long.vehicleSpeedLongitudinal': 0.01, 'velocity.velocityVehicleCog.velocityVehicleCog': 3.6,
                'wheel-rpm.actualValueRPMWheelFLH': 2 * Math.PI * WHEEL_R * 60 / 1000 / 2, 'display-speed.displayedValueSpeed': 1 / SPEEDO.k,
                'ldm-guidance.valueRequestSpeed': 0.5, 'hud-data.cruiseCtrlSpeedHUD': 1, 'front-vehicle.frontVehicleGapX': 1 / 16, 'front-vehicle.frontVehicleSpeedX': 1 / 25,
                'cds-accel-long.longitudinalAccelerationCentreOfGravity': 0.002, 'accel-long.longitudinalAccelerationCentreOfGravity': 0.01, 'dynamics-long.longitudinalAccelerationDrivingDirection2': 0.005 },
            // receive delay of a source minus the anchor's (car-speed2): the jitter's mean is part of the delay
            relLag_ms: Object.keys(SIG).reduce((m, k) => { m[k] = (SIG[k].lat + SIG[k].jit) - (SIG['car-speed2'].lat + SIG['car-speed2'].jit); return m; }, {}),
            usableStepsB: args.steps ? 17 : 0, excludedSteps: args.steps ? ['accelerator pressed'] : [],
        },
    };
    fs.writeFileSync(path.join(args.out, 'truth.json'), JSON.stringify(truth, null, 1));
    if (args.anchors) fs.writeFileSync(path.join(args.out, 'anchors.json'), JSON.stringify(anchors, null, 1));
    const files = fs.readdirSync(recDir).filter((n) => /^rec-/.test(n));
    console.log('acc_synth: ' + files.length + ' file(s), sessions ' + Object.keys(sessions).map((k) => k + '=' + sessions[k].session).join(' ') + ' -> ' + args.out);
}
main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });

module.exports = { SIG, PLANT, SPEEDO };
