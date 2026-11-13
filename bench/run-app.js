'use strict';
/**
 * Bench launcher: runs the BUILT app (dist/<id>, made by kit/tools/build.py, the
 * same build the Store runs on the car) inside the kit's stubbed head unit (kit/tools/hu-stub.js,
 * live mode). No BMW SDK, no SOME/IP:
 *
 *  - The center-screen page is hu-stub's fake RHMI. A setting from the bench panel is sent the way
 *    the car's HMI sends it: an 'action' on the SET_<KEY> component (the drop-down's row, or a
 *    checkbox press), so the kit's own wireSettings() handles it and saves bench/.data/<id>/settings.json.
 *  - The status row (ctx.ui.text('STATUS', ...)) is reported to the page.
 *  - Manual signals go in as RAW SOME/IP values through hu.feed, the scaling car.js undoes on the
 *    car; the FES boost field too. Demo mode is the kit's sim.js (the "demo" setting).
 *  - HUD_CLUSTER_SOCKET points hud.js at the bench's fake cluster-render socket.
 *
 * Run by bench/server.js as a forked child: node bench/run-app.js <stage dir> <data dir>
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const stage = process.argv[2], dataDir = process.argv[3];
if (!stage || !dataDir) { console.error('usage: run-app.js <dist/<id>> <data dir>'); process.exit(2); }

const send = (m) => { if (process.connected) process.send(m); };
const fmt = (a) => a.map((x) => (x && x.stack) ? x.stack : (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
const tag = '[' + path.basename(stage) + '] ';
const log = {
    info: (...a) => console.log(tag + fmt(a)),
    warn: (...a) => console.warn(tag + 'WARN ' + fmt(a)),
    error: (...a) => console.warn(tag + 'ERROR ' + fmt(a)),
    debug: () => {},
};
// As on the car, an uncaught exception ends the app (kit/mgu.js): the bench shows the exit.
process.on('uncaughtException', (e) => { log.error('uncaught (the car would exit the app here): ' + (e && e.stack || e)); process.exit(1); });

try { fs.mkdirSync(dataDir); } catch (e) { /* there */ }
const { headUnit } = require(path.join(__dirname, '..', 'kit', 'tools', 'hu-stub.js'));
const hu = headUnit(stage, { live: true, dataDir, log, image: () => Promise.resolve() });
const { spec, settings, ui } = hu;

// the app's HudApp instance, for the values the page shows (hud.js is loaded by the app's main.js)
let hud = null;
const realLoad = Module._load;
Module._load = function (req) {
    const m = realLoad.apply(this, arguments);
    if (req === './hud' && typeof m === 'function' && !m.__bench) {
        // the status line: the engine's own (the page shows it on its Settings tab; there is no STATUS row any more)
        const Wrapped = class extends m { constructor(ctx) { super(ctx); hud = this; this.onStatus((s) => { status = s; send({ t: 'status', s }); }); } };
        Wrapped.__bench = true;
        return Wrapped;
    }
    return m;
};

// the center screen's status row
let status = '';
const text = ui.text;
ui.text = (n, t, row, cell) => {
    if (n === 'STATUS' && !row) { status = String(t); send({ t: 'status', s: status }); }
    return text(n, t, row, cell);
};

const sendSettings = () => send({ t: 'settings', schema: spec.settings, values: Object.assign({}, settings.values) });
settings.onChange(sendSettings);

/** A setting from the panel, pressed on the fake HMI as the car's HMI would. */
function press(key, value) {
    const s = settings.item(key);
    if (!s) return log.warn('bench: no setting ' + key);
    const comp = ui.comp('SET_' + key.toUpperCase());
    if (s.type === 'bool') {
        if (!!settings.get(key) !== !!value) comp.emit('action', {});      // a checkbox press toggles
        return;
    }
    const rows = s.type === 'choice' ? s.options.map((o) => o[0]) : s.steps;
    const row = rows.indexOf(value);
    if (row < 0) return log.warn('bench: ' + key + ' has no value ' + JSON.stringify(value));
    comp.emit('action', { row });
}

// ---- package E: the speed-limit and no-overtaking signs in manual mode -------------------------------------------------
// Manual values: limit (km/h; 'end' or below 0: the end-of-limit sign; 0, null or none: no limit known), nopass
// (true / 1: the no-overtaking sign). They go in as the raw value of the field app.json config.limit / config.nopass
// names (factor, unit, path, invalid / end / map / on undone). While app.json names no field (the car then shows BMW's
// own sign), the bench stands in one, bench.SpeedLimit, so these can still be set; BENCH_LIMIT=off runs as the car does.
const appCfg = spec.config || (spec.config = {});
const named = (s) => !!(s && s.iface && s.field);
if (process.env.BENCH_LIMIT !== 'off') {
    if (!named(appCfg.limit)) appCfg.limit = { iface: 'bench.SpeedLimit', field: 'limit', path: ['value'], invalid: [0], end: [255], unknown: [254] };
    if (!named(appCfg.nopass)) appCfg.nopass = { iface: 'bench.SpeedLimit', field: 'nopass', path: ['value'], on: [1] };
    if (appCfg.limit.iface === 'bench.SpeedLimit') log.info('bench: app.json config.limit names no field (the car shows BMW\'s sign); the bench stands in bench.SpeedLimit so manual signals set our sign (BENCH_LIMIT=off: as the car)');
}
/** `path` into a fresh object holding `v` at its end ([] or none: v itself). */
const nest = (path, v) => (path || []).slice().reverse().reduce((acc, k) => ({ [k]: acc }), v);
/** The raw value config.limit would turn into this manual limit. */
function rawLimit(L, v) {
    // car3 I: 'unknown' or -20 and below: BMW's empty sign "---" (no limit known)
    const unknown = v === 'unknown' || (typeof v === 'number' && v <= -20);
    const end = !unknown && (v === 'end' || (typeof v === 'number' && v < 0));
    const none = !end && !unknown && !(typeof v === 'number' && v > 0);
    if (L.map) {
        const keys = Object.keys(L.map), want = unknown ? 'unknown' : end ? 'end' : none ? null : v;
        const k = keys.find((key) => L.map[key] === want) || (none ? keys.find((key) => L.map[key] === null) : null);
        const n = k !== undefined && k !== null && /^-?\d+(\.\d+)?$/.test(k) ? Number(k) : k;
        if (k !== undefined && k !== null) return n;
    }
    if (unknown) return (L.unknown || [])[0] !== undefined ? L.unknown[0] : null;
    if (end) return (L.end || [])[0] !== undefined ? L.end[0] : null;
    if (none) return (L.invalid || [])[0] !== undefined ? L.invalid[0] : null;
    return Math.round(v / (L.unit === 'mph' ? 1.609344 : 1) / (typeof L.factor === 'number' && L.factor ? L.factor : 1));
}
function feedSigns(v) {
    const L = appCfg.limit, N = appCfg.nopass;
    if (named(L) && 'limit' in v) hu.feed(L.iface, L.field, nest(L.path, rawLimit(L, v.limit)));
    if (named(N) && 'nopass' in v) {
        const on = v.nopass === true || v.nopass === 1;
        hu.feed(N.iface, N.field, nest(N.path, on ? (N.on || [1])[0] : 0));
    }
    feedCar3(v);
}
// ---- end package E -----------------------------------------------------------------------------------------------------

// ---- car3 I: auto start/stop, the car's time zone, a check-control message, in manual mode ----------------------------
// Manual values: msa (0 none, 1 active, 2 off, 3 engine stopped by MSA, 4 unavailable; the page's slider), tzCar (the
// car's offset from UTC in minutes; API only, absent: the car sends none) and ccMsg (1 a message shows, 0 none; API
// only). Fed as the raw value of the field app.json config.msa / config.clock / config.ccm names; while none is named,
// the bench stands in bench.MSA / bench.Clock / bench.CheckControl (BENCH_LIMIT=off: as the car, nothing).
if (process.env.BENCH_LIMIT !== 'off') {
    if (!named(appCfg.msa)) appCfg.msa = { iface: 'bench.MSA', field: 'state', path: ['value'], map: { 0: null, 1: 'active', 2: 'off', 3: 'stopped', 4: 'unavailable' } };
    if (!named(appCfg.clock)) appCfg.clock = { iface: 'bench.Clock', field: 'zone', kind: 'offset', path: ['value'], factor: 1, invalid: [-9999] };
    if (!named(appCfg.ccm)) appCfg.ccm = { iface: 'bench.CheckControl', field: 'shown', kind: 'flag', path: ['value'], on: [1] };
}
const MSA_NAMES = [null, 'active', 'off', 'stopped', 'unavailable'];
function feedCar3(v) {
    const M = appCfg.msa, C = appCfg.clock, K = appCfg.ccm;
    if (named(M) && 'msa' in v) {
        const want = MSA_NAMES[Math.round(Number(v.msa)) || 0] || null;
        const k = Object.keys(M.map || {}).find((key) => (M.map[key] || null) === want);
        if (k !== undefined) hu.feed(M.iface, M.field, nest(M.path, /^-?\d+$/.test(k) ? Number(k) : k));
    }
    // a time zone only when one is asked for (offset kind in minutes); else the field's "none" value
    if (named(C) && C.kind !== 'local' && 'tzCar' in v) {
        const f = typeof C.factor === 'number' && C.factor ? C.factor : 1;
        hu.feed(C.iface, C.field, nest(C.path, typeof v.tzCar === 'number' ? Math.round(v.tzCar / f) : (C.invalid || [null])[0]));
    }
    if (named(K) && 'ccMsg' in v) hu.feed(K.iface, K.field, K.kind === 'list' ? nest(K.path, v.ccMsg ? [{ id: 1 }] : []) : nest(K.path, v.ccMsg ? (K.on || [1])[0] : 0));
}
// ---- end car3 I --------------------------------------------------------------------------------------------------------

// manual signals as raw SOME/IP values (a copy of kit/runtime/car.js SCALE; FES boost from hud.js)
const SCALE = { rpm: [0.25, 0], speed: [0.015625, 0], accel: [0.002, -65], temp: [1, -48], torque: [0.5, -1023.5], boost: [0.01, 0] };
const raw = (k, v) => Math.round((v - SCALE[k][1]) / SCALE[k][0]);
let mode = 'demo', manual = {}, drive = null;
// the drive mode buttons, sent once a second as the car does on change (wire numbers: 1 Sport, 4 Comfort, 7 Eco Pro)
setInterval(() => { if (drive !== null) hu.feed('de.bmw.infotainment.drivingexcitement.FES', 'statusFESVehicleDynamicSwitchHMI', { actualValueModeDrivingExperience: drive }); }, 1000);
setInterval(() => {
    if (mode !== 'manual') return;
    const v = manual, num = (k, d) => (typeof v[k] === 'number' && isFinite(v[k]) ? v[k] : d);
    const g = Math.round(num('gear', 0));
    hu.feed('de.bmw.infotainment.vehicle.CDS', 'statusEngineSpeed2', { actualValueRPMEngineCrankshaft: raw('rpm', num('rpm', 0)) });
    hu.feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusCarSpeed2', { speedVehicleCentreOfGravity: raw('speed', num('speed', 0)) });
    hu.feed('de.bmw.infotainment.vehicle.CDS2', 'statusLongitudinalAccelerationMassCenter', { longitudinalAccelerationCentreOfGravity: raw('accel', num('gLong', 0) * 9.80665) });
    hu.feed('de.bmw.infotainment.vehicle.CDS2', 'statusLateralAccelerationMassCenter', { lateralAccelerationCentreOfGravity: raw('accel', num('gLat', 0) * 9.80665) });
    hu.feed('de.bmw.infotainment.vehicle.CDS', 'statusEngineTemperature', { temperatureEngineDrive: raw('temp', num('coolant', 90)), temperatureEngineOilDrive: raw('temp', num('oil', 100)) });
    hu.feed('de.bmw.infrastructure.VehicleInformation', 'statusGearboxDrive', { statusActualGearDrive: g > 0 ? 'G' + g : 'N_OR_P', statusActualStageDrive: g > 0 ? 'D' : 'P' });
    hu.feed('de.bmw.infotainment.drivingexcitement.FES', 'statusActualValueTorque2', { actualValueTorqueCrankshaft: raw('torque', num('torque', 0)) });
    hu.feed('de.bmw.infotainment.drivingexcitement.FES', 'statusSwitchDriveDynamicSport2', { displayBoostPressure: raw('boost', Math.max(0, num('boost', 0))) });
    hu.feed('de.bmw.infotainment.KombiIF', 'statusRangeTankStatus', { fluidLevelFuelTank: Math.round(num('fuelL', 40)), range: Math.round(num('range', 450)) });
    hu.feed('de.bmw.infrastructure.EnvironmentalInformation', 'ExteriorTemperature', { temperatureExterior: Math.round((num('ambient', 22) + 40) / 0.5) });
    // the car's display units (bar, C), so the tyre values below read as 0.1 bar and C + 40; the shifter programme from `program` (S / M)
    hu.feed('de.bmw.infotainment.vehicle.Vehicle', 'statusNewCurrentUnitsStatusExt', { unitOfMeasurementAirPressure: 1, unitOfMeasurementTemperature: 1 });
    hu.feed('de.bmw.infotainment.misc.MDrive', 'dataDisplayGearbox', { displayProgramGearbox: manual.program === 'S' ? 'S_MINUS_PROGRAMM' : manual.program === 'M' ? 'M_MINUS_PROGRAMM' : 'D_PROGRAMM' });
    // tyres (TPMS, the fields the car answers a read with): pressure in 0.1 bar, temperature raw - 40 C; the rear pair a notch higher
    const tp = Math.round(num('tyreP', 2.3) * 10), tt = Math.round(num('tyreT', 24) + 40);
    hu.feed('de.bmw.infotainment.vehicle.TPMS', 'statusTyrePressure', { actualValuePressureTyreFLH: tp, actualValuePressureTyreFRH: tp, actualValuePressureTyreRLH: tp + 2, actualValuePressureTyreRRH: tp + 2 });
    hu.feed('de.bmw.infotainment.vehicle.TPMS', 'statusTyreTemperature', { actualValueTemperatureTyreFLH: tt, actualValueTemperatureTyreFRH: tt, actualValueTemperatureTyreRLH: tt + 3, actualValueTemperatureTyreRRH: tt + 3 });
    feedSigns(manual);      // package E
}, 50);

// what the app actually sees, so the page shows demo values too
setInterval(() => {
    if (!hud) return;
    const d = hud.car.data(), out = {};
    ['rpm', 'speed', 'oil', 'coolant', 'gear', 'gLong', 'gLat', 'torque'].forEach((n) => { out[n] = d[n] === undefined ? null : d[n]; });
    out.boost = hud._boost();
    out.fuelL = hud.fuelL; out.range = hud.rangeKm; out.ambient = hud.ambient;
    out.limit = hud._raw('limitUnknown') ? -20 : hud._raw('limitEnd') ? -10 : hud._raw('limit') || 0; out.nopass = hud._raw('nopass') ? 1 : 0;   // package E; car3 I -20 "---"
    out.msa = hud._raw('msa') || 0;      // car3 I
    send({ t: 'values', mode, values: out });
}, 250);

process.on('message', (m) => {
    if (!m) return;
    if (m.t === 'signals') {
        mode = m.mode === 'manual' ? 'manual' : 'demo';
        manual = m.values || {};
        // demo drive = the kit's sim; manual = live data (auto: the sim gives way once data arrives)
        const want = mode === 'manual' ? 'off' : 'on';
        if (settings.get('demo') !== want) press('demo', want);
    } else if (m.t === 'set') press(m.key, m.value);
    else if (m.t === 'drive') drive = m.value;
    else if (m.t === 'shiftTest' && hud) hud.testShift();
});
process.on('disconnect', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

hu.start();
sendSettings();
log.info('bench: app loaded from ' + path.relative(process.cwd(), stage) + ', data in ' + dataDir);
