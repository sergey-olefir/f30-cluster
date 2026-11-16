'use strict';
/**
 * Bench launcher: runs the BUILT app (dist/<id>, made by kit/tools/build.py, the
 * same build the Store runs on the car) inside the kit's stubbed head unit (kit/tools/hu-stub.js,
 * live mode). No BMW SDK, no SOME/IP:
 *
 *  - The center-screen page is hu-stub's fake RHMI. A setting from the bench panel is sent the way
 *    the car's HMI sends it: an 'action' on the SET_<KEY> component (the drop-down's row, or a
 *    checkbox press), so the kit's own wireSettings() handles it and saves bench/.data/<id>/settings.json.
 *  - The engine's status line (hud.js onStatus) is reported to the page.
 *  - The native centre screen (2026-11-14, shared/menu.js): what the app writes to its RHMI components (texts, cells,
 *    Visible, checkbox and drop-down values, pushed pictures) and the stub's screen stack are kept for GET /probe; POST
 *    /click presses any component as the HMI would ({ id, row }). bench/test-native-ui.js drives these.
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
const hu = headUnit(stage, { live: true, dataDir, log, image: (name, cv) => { if (hu.onImage) hu.onImage(name, cv); return Promise.resolve(); } });
const { spec, settings, ui } = hu;

// 2026-11-15 (apps/driver_profiles): an app whose manifest asks for persod's UserAccountManager gets the bench's fake
// persod (bench/fake-personalization.js); POST /fake steers it, GET /probe reports its accounts and every call made
let fakePerso = null;
try {
    const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'source', 'manifest.json'), 'utf8'));
    if (manifest.proxies && manifest.proxies['de.bmw.infotainment.personalization.UserAccountManager']) {
        fakePerso = require('./fake-personalization').install(hu);
    }
} catch (e) { log.warn('bench: fake persod not installed: ' + e.message); }

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

// the engine's status line (sent to the page by the HudApp wrapper above)
let status = '';

// 2026-11-14, the native centre screen (shared/menu.js): what the app writes to the RHMI components, kept for
// GET /probe (bench/test-native-ui.js). The stub's own calls do nothing on screen: the HMI isn't drawn here.
const native = {};          // component -> { text, cells, visible, checked, selected }
const images = {};          // component -> { n: pushes, w, h } (the HMI's own image: a native graphic row, or a canvas
                            //   screen without the renderer)
const rec = (n, k, v) => { (native[n] = native[n] || {})[k] = v; };
['text', 'cells', 'visible', 'checked', 'selected'].forEach((m) => {
    const orig = ui[m];
    ui[m] = function (n, a, b, c) {
        if (m === 'text') rec(n, b || (c && c !== 'Text') ? 'cell:' + (c || 'Text') + '@' + (b || 0) : 'text', String(a));
        else if (m === 'cells') rec(n, 'cells', b);
        else if (m === 'checked') rec(n, 'checked', !!a);
        else rec(n, m, a);
        return orig.apply(this, arguments);
    };
});
hu.onImage = (name, cv) => {
    const i = images[name] = images[name] || { n: 0 };
    i.n++; i.w = cv && cv.w; i.h = cv && cv.h;
    // BENCH_IMAGE_DIR: each picture also saved there as <component>.png (the last one), to look at
    if (process.env.BENCH_IMAGE_DIR && cv) {
        try { fs.writeFileSync(path.join(process.env.BENCH_IMAGE_DIR, name.toLowerCase() + '.png'), Buffer.isBuffer(cv) ? cv : cv.png()); } catch (e) { log.warn('bench: ' + e.message); }
    }
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
// Bottom row: once app.json names the car's own speed-limit struct (config.sign) the stand-in is not installed -
// the real shape is wired, and bench/fake-signs.js feeds it (otherwise the manual slider, fed 20 times a second,
// would overwrite every scene).
if (process.env.BENCH_LIMIT !== 'off' && !named(appCfg.sign)) {
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
    // (bottom row: the "message" kind is the car's own union, fed by bench/fake-signs.js, not by this flag)
    if (named(K) && 'ccMsg' in v && K.kind !== 'message') hu.feed(K.iface, K.field, K.kind === 'list' ? nest(K.path, v.ccMsg ? [{ id: 1 }] : []) : nest(K.path, v.ccMsg ? (K.on || [1])[0] : 0));
}
// ---- end car3 I --------------------------------------------------------------------------------------------------------

// ---- bottom row (docs/BOTTOM-ROW-PACKAGE.md): the speed-limit struct, the check-control message, the road label,
// the guidance, the position and the car's clock. The bench is the only place these can be seen, so a fake feeds
// them as raw SOME/IP values through the very shapes app.json config names (bench/fake-signs.js). POST /fake takes
// { scene: '<name>' } or the parts themselves; GET /probe reports what the engine made of them.
const fakeSigns = require('./fake-signs').install(hu, appCfg, log);
// ---- end bottom row ----

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
    // audit/features: is the engine turning (0 off, 1 starting, 2 running; default from rpm), and BMW's own vehicle
    // state (10 FAHREN = drive-ready, 2 PARKEN_BN_IO = parked). Together they decide READY vs OFF on the rev dial.
    hu.feed('de.bmw.infotainment.vehicle.CDS', 'statusEngineStatus', { statusEngineRunDrive: Math.round(num('engine', num('rpm', 0) >= 150 ? 2 : 0)) });
    hu.feed('de.bmw.infrastructure.VehicleCondition', 'VehicleCondition', { statusConditionVehicle: Math.round(num('condition', 10)) });
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

/** 2026-11-16: WBBACK's black patches over BMW's bottom row as the engine sends them, in PANEL px, plus the two
 *  numbers a silent leak hides behind: how many rects the layout wanted now ("want", after each rect's "when") and
 *  how many WBBACK can hold ("cap", hud.js WB_PATCHES). want > cap means the extras are dropped and BMW's own row
 *  shows through there - bench/test-bottom-row.js asserts it never happens. Null while no 6WB backdrop is up. */
function wbPatches() {
    try {
        let w = null;
        hud.widgets.forEach((x) => { if (!w && x.w && x.w.type === 'wbback' && Array.isArray(x.w.patches)) w = x.w; });
        if (!w) return null;
        const cap = hud.constructor.WB_PATCHES;
        const want = w.patches.filter((p) => Array.isArray(p.rect) && (!p.when || hud._toggleOn(p.when)));
        const sent = hud._wbPatches(w).slice(0, cap).filter((v) => v[2] > v[0])
            .map((v) => [v[0] + w.x, v[1] + w.y, v[2] + w.x, v[3] + w.y]);
        return { want: want.length, cap, sent };
    } catch (e) { return null; }
}

// ---- package X (docs/strip/X-REPORT.md): fault injection for the safety tests, POST /fake { hook } ----
// "ccHold": our message line is not painted (as a slow first draw) until "ccRelease"; "ccThrow": painting it throws.
// Bench only: it wraps the live HudApp instance, nothing of it is in shared/ and the car never sees it.
let ccHeld = false;
function benchHook(h) {
    if (!hud) return;
    if (!hud.benchWrapped) {
        hud.benchWrapped = true;
        const upd = hud._updateOne;
        hud._updateOne = function (x, now, force) { if (ccHeld && x.w && x.w.ccLine) return undefined; return upd.call(this, x, now, force); };
    }
    if (h === 'ccHold') ccHeld = true;
    else if (h === 'ccRelease') ccHeld = false;
    else if (h === 'ccThrow') hud._ccLinePaint = () => { throw new Error('bench: an injected failure while drawing the message'); };
    // probes (0.7.18): the once-per-run symbol call again, so each failure mode of the fake can be tried in one run
    else if (h === 'symbolsAgain') { hud.probeSymDone = false; hud._probeSymbols(null); }
    log.info('bench: hook ' + h);
}
/** What WBBACK's u_cc and the road bar's hole were last SENT as, in panel px ([0, 0, 0, 0]: shut), or null. */
function rowSent() {
    const out = { ucc: null, navHole: null, mask: null };
    try {
        hud.widgets.forEach((x) => {
            // strip integration: a layout with the strip mask opens BMW's panel through its hole lane, not u_cc. What
            // the engine last SENT: the cover lane, the hole lane, and the hole lane's box in panel px (u_mh)
            if (x.w && x.w.type === 'wbback' && x.w.collar && x.w.mask && x.mask && x.maskT) {
                out.mask = { cover: x.mask.k, hole: x.mask.h, box: x.mask.h ? x.maskT.hole : [0, 0, 0, 0] };
            }
            if (x.w && x.w.type === 'wbback' && typeof x.ccKey === 'string') {
                const v = x.ccKey.split(',').map(Number);
                out.ucc = v[2] > v[0] ? [v[0] + x.w.x, v[1] + x.w.y, v[2] + x.w.x, v[3] + x.w.y] : [0, 0, 0, 0];
            }
            // the fill's live hole: x.last is the key of the u_hole it last sent (layer px x, y, w, h; w 0: shut)
            if (x.w && x.w.id === 'nav_bg') {
                // (not updated since it was made: what _create sent then, the same _hole of that moment)
                const h = typeof x.last === 'string' ? x.last.split(',').map(Number) : hud._hole(x.w);
                out.navHole = h[2] > 0 ? [h[0] + x.w.x, h[1] + x.w.y, h[0] + x.w.x + h[2], h[1] + x.w.y + h[3]] : [0, 0, 0, 0];
            }
        });
    } catch (e) { /* not up */ }
    return out;
}
/** fix/colour-daynight: the engine's day/night state for GET /probe. */
function dayNightProbe() {
    try {
        const loc = hud._location();
        return { car: hud.dnCar, code: hud.dnCode === undefined ? null : hud.dnCode, night: hud._isNight(), source: hud.dnSource,
            sun: require(path.join(__dirname, '..', 'shared', 'sun.js')).isNight(Date.now(), loc.lat, loc.lon),
            nightOn: !!hud.nightOn, theme: hud.themeName || null };
    } catch (e) { return { error: String(e && e.message || e) }; }
}
/** The round window over BMW's own sign as last sent (WBDIAL u_cut mode: 1 open, 3 shut), or null. */
function signWin() {
    let m = null;
    try { hud.widgets.forEach((x) => { if (x.w && x.w.cut && x.w.cut.cover === 'limit' && isFinite(x.cutMode) && x.cutMode >= 0) m = x.cutMode; }); } catch (e) { /* not up */ }
    return m;
}
// The safety rule, audited between the engine's ticks (each sample sees what the last tick SENT, i.e. one frame of
// ours): whenever the car says a message shows and our own text for it is not on the screen, BMW's panel must be open
// in the backdrop (u_cc = the layout's "cc" box) AND in the road bar (its hole open, or no bar at all).
const ccAudit = { samples: 0, shown: 0, violations: 0, first: null };
setInterval(() => {
    try {
        if (!hud || !hud.client || !hud.client.ready || !hud._seeThrough(hud._layoutName())) return;
        ccAudit.samples++;
        if (hud._cc() !== true) return;
        ccAudit.shown++;
        if (hud._ccOnScreen()) return;
        let cc = null, mk = null;
        hud.widgets.forEach((x) => { if (x.w && x.w.type === 'wbback') { cc = x.w.cc; mk = x.w.collar && x.w.mask ? x : null; } });
        const s = rowSent(), same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.join(',') === b.join(',');
        // strip integration: with the strip mask, "open in the backdrop" is its hole lane on BMW's panel ("msg", or
        // "msgMark" with the marker), with the lane table's own hole box sent; without it, u_cc = the layout's "cc" box
        const backOpen = mk ? !!(s.mask && /^msg/.test(s.mask.hole || '') && mk.maskT && same(s.mask.box, mk.maskT.hole))
            : same(s.ucc, cc);
        const barOpen = s.navHole === null || (s.navHole[2] > s.navHole[0]);
        if (backOpen && barOpen) return;
        ccAudit.violations++;
        if (!ccAudit.first) ccAudit.first = { at: Date.now(), ucc: s.ucc, mask: s.mask, navHole: s.navHole, why: hud._rowWhy() };
    } catch (e) { /* not up */ }
}, 10);
// ---- end package X ----

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
    // 2026-11-14 (native centre screen): an HMI action on any component (POST /click), the HMI's back arrow (POST /hmi),
    // and what the app shows (GET /probe)
    else if (m.t === 'click' && m.id) ui.comp(m.id).emit('action', typeof m.row === 'number' ? { row: m.row } : {});
    else if (m.t === 'hmi' && m.a === 'back') { const top = hu.stack[hu.stack.length - 1]; if (top) ui.close(top); }
    else if (m.t === 'fake') {
        const v = m.v || {};
        // the bottom-row fakes take scene / sign / cc / ccList / road / nav / clock; the rest goes to the fake persod
        if (v.hook) benchHook(v.hook);           // package X: fault injection for the safety tests
        else if (v.scene || v.sign || v.cc || v.ccList || v.ccFrame || v.sla || v.road || v.nav || v.clock) fakeSigns.control(v);
        else if (v.ccRisk || v.ccBasic || v.symbols) fakeSigns.control(v);     // probes (0.7.18): bench/test-probes.js
        else if (v.dayNight !== undefined) fakeSigns.control(v);    // fix/colour-daynight: bench/test-daynight.js
        else if (fakePerso) fakePerso.control(v);
    }
    else if (m.t === 'probe') {
        let layoutName = null, yielded = null;
        try { layoutName = hud ? hud._layoutName() : null; yielded = hud && hud.screen ? hud.screen.yielded : null; } catch (e) { /* not up yet */ }
        send({
            t: 'probe', n: m.n, native, images, stack: hu.stack.slice(), settings: Object.assign({}, settings.values), status,
            activeName: hud ? hud.activeName : null, layoutName, yielded, driveMode: hud ? hud.driveMode : null,
            ready: !!(hud && hud.client && hud.client.ready),
            perso: fakePerso ? fakePerso.state() : null,
            // fix/colour-daynight: the car's day/night as the engine took it, the source in use, night now, and what
            // the sun alone would say (bench/test-daynight.js)
            dayNight: hud ? dayNightProbe() : null,
            // bottom row: what the fakes fed and what the engine made of it (bench/test-bottom-row.js)
            signs: Object.assign(fakeSigns.state(), hud ? {
                sign: hud.sign,
                cc: {
                    shown: hud.ccShown, name: hud._ccText('name'), desc: hud._ccText('desc'), list: (hud.ccItems || []).length,
                    // what the parser made of it, whoever draws it: lengths and the colour, never the text
                    parsed: { name: (hud.ccMsg.name || '').length, desc: (hud.ccMsg.desc || '').length, color: hud.ccMsg.color, symbol: hud.ccMsg.symbol },
                    frame: hud.ccFrame,
                },
                road: hud._roadText(), navState: hud.navState, navDist: hud.navDist, navEta: hud.navEta,
                own: { nav: hud._own('nav'), sign: hud._own('sign'), info: hud._own('info'), range: hud._own('range'), clock: hud._own('clock'), temp: hud._own('temp') },
                fail: hud.rowFail || {}, tzCar: hud.tzCar, tzCandidate: hud.tzCandidate,
                sla: hud.sla, arc: hud._arcOn(),
                widgets: ['signs', 'limit', 'nav', 'nav_bg', 'cc_name', 'cc_desc', 'cc_line', 'own_clock'].filter((id) => hud.widgets && hud.widgets.has(id)),
                // package X: who draws the row and why, the time zone in use, and the safety handshake: the headline
                // the car's message gives, whether ours for it is on the screen, whether BMW's panel must be open, and
                // what WBBACK's u_cc and the road bar's hole were last SENT as (panel px)
                row: { why: hud._rowWhy(), standby: !!hud.rowStandby, failWhy: hud.rowFailWhy || {}, signWin: signWin() },
                tz: hud._tzSource(),
                safety: Object.assign({ head: hud._ccText('head'), unread: !!hud.ccUnread, onScreen: hud._ccOnScreen(),
                    open: hud._ccOpen(), style: hud._ccStyle(), fit: hud.ccFit || null, audit: ccAudit }, rowSent()),
                // 2026-11-16: WBBACK's black patches over BMW's bottom row, in PANEL px, with how many rects the
                // layout wanted and how many the shader can hold: "want > cap" is a silent leak (bench/test-bottom-row.js)
                patches: wbPatches(),
            } : {}),
        });
    }
});
process.on('disconnect', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

hu.start();
sendSettings();
log.info('bench: app loaded from ' + path.relative(process.cwd(), stage) + ', data in ' + dataDir);
