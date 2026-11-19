'use strict';
/**
 * test-signal-acc.js - r1120 AC: Signal Probe's ACC recording set (S17, apps/signal_probe/fields.js) and its budget.
 *
 *   node bench/test-signal-acc.js     (BENCH_PORT, default 8932; ACC_SIM_MIN: simulated minutes per budget case, default 5;
 *                                       ACC_BUDGET_OUT: a file to write the budget to, JSON)
 *
 *   1. what is in it: every metric of the parent brief's Phase 1 table, the simulator's ranked list (docs/cruise-sim/SC3-REPORT.md)
 *      and the front-vehicle display has a field in S17; every one is read only (r / rs / s / an event), no new interface, the
 *      camera object lists are cut to ACC_ENTRIES objects in a recording.
 *   2. the recorder keeps a field's own cap (recEntries): a 12-object camera list is written with 8 objects and its count 12.
 *   3. the budget: a simulated ACC recording at plausible native rates, values moving, with the camera silent and with 4 and 8
 *      objects in every list: bytes per second on disk, minutes in the 15 MB quota and in the proposed one, CPU per second.
 *   4. on the bench: the real app; the recording rows say ACC; a press records S17 (its checkbox on), an injected 12-object camera
 *      event lands in the file with 8 objects, the converter (tools/car/rec_convert.py) reads it.
 * Mac only, Node 18 or newer. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'apps', 'signal_probe');
const CATALOGUE = path.join(ROOT, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json');
const CONVERT = path.join(ROOT, 'tools', 'car', 'rec_convert.py');
const FIELDS = require(path.join(APP_DIR, 'fields.js'));
const { Recorder, flatten } = require(path.join(APP_DIR, 'recorder.js'));
const PORT = Number(process.env.BENCH_PORT) || 8932;
const SIM_MIN = Number(process.env.ACC_SIM_MIN) || 5;
const PROPOSED_QUOTA_MB = 64;           // the recorder's quota proposed with maxDiskUsage 80 MiB (docs/r1120/AC-REPORT.md)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-acc-'));

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inSets = (f, ids) => [f.set].concat(f.also || []).some((s) => ids.indexOf(s) >= 0);
const ACC = FIELDS.TABLE.filter((f) => inSets(f, ['S17']));
const tagsOf = (fs_) => fs_.map((f) => f.tag);

function readRec(dir) {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^rec-.*\.csv(\.gz)?$/.test(n)).sort() : [];
    const text = files.map((n) => { const b = fs.readFileSync(path.join(dir, n)); return /\.gz$/.test(n) ? zlib.gunzipSync(b).toString() : b.toString(); }).join('');
    return { files, text, lines: text.split('\n').filter((l) => l) };
}
async function catchUp(rec) { for (let i = 0; i < 5000 && (rec.writing || rec.segs.some((sg) => sg.chunks.length)); i++) { rec._flush(); await sleep(0); } }
async function drain(rec, ms) {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) {
        if (!rec.writing && rec.queued === 0 && (rec.segs.length === 0 || (rec.segs.length === 1 && !rec.segs[0].chunks.length && !rec.segs[0].closed))) return true;
        rec._flush(); await sleep(2);
    }
    return false;
}

// ---- values from the catalogue's own types, every list with `n` entries --------------------------------------------------------
let cat = null;
if (fs.existsSync(CATALOGUE)) cat = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
const DT = cat ? cat.datatypes : {};
const base = (r) => { let x = r, n = 0; while (DT[x] && DT[x].type === 'typedef' && n++ < 8) x = DT[x].dataRef; return x; };
const allMembers = (t) => (t.extends && DT[t.extends] ? allMembers(DT[t.extends]) : []).concat(t.members || []);
function synth(ref, c, depth, n) {
    const x = base(ref), t = DT[x];
    if (!t) {
        c.i++;
        if (/^Utf/.test(x)) return 'Canary text';
        if (x === 'ByteBuffer') return Buffer.from('Canary');
        if (x === 'Bool') return false;
        if (/Float|Double/.test(x)) return c.i * 1.37 + 0.123456;
        return c.i % 200;
    }
    if (t.type === 'enum') { const k = Object.keys(t.items); return k[(c.i++) % k.length]; }
    const list = () => { const a = []; for (let i = 0; i < n; i++) a.push(synth(t.dataRef || t.elementDataRef, c, depth + 1, n)); return a; };
    if (t.type === 'array') return depth > 7 ? [] : list();
    if (t.type === 'map') return {};
    const o = {};
    if (depth > 7) return o;
    allMembers(t).forEach((m) => {
        if (!m.dimension) { o[m.name] = synth(m.dataRef, c, depth + 1, n); return; }
        const a = []; for (let i = 0; i < n; i++) a.push(synth(m.dataRef, c, depth + 1, n)); o[m.name] = a;
    });
    return o;
}
function valueOf(f, seed, n) {
    const c = { i: seed || 1 };
    if (f.flags === 'b') {
        const v = {};
        cat.interfaces[f.iface].events[f.field].outputs.forEach((o) => {
            if (!o.dimension) { v[o.name] = synth(o.dataRef, c, 1, n); return; }
            const a = []; for (let i = 0; i < n; i++) a.push(synth(o.dataRef, c, 1, n)); v[o.name] = a;
        });
        return v;
    }
    return synth(cat.interfaces[f.iface].fields[f.field].dataRef, c, 0, n);
}
/** Every float in the value moves (a noisy measurement), integers creep, alive counters count: what makes "=" lines rare. */
function move(v, k) {
    if (!v || typeof v !== 'object') return;
    Object.keys(v).forEach((key) => {
        const x = v[key];
        if (typeof x === 'number') v[key] = /alive|aliv|counter/i.test(key) ? (x + 1) % 15 : Number.isInteger(x) ? x + (k % 7 === 0 ? 1 : 0) : x + (((k * 7919 + key.length * 31) % 200) - 100) / 1000;
        else if (x && typeof x === 'object') move(x, k + 1);
    });
}

// ---- the plausible native rates (Hz): RC's for S14 (bench/test-signal-recorder.js), the camera's object lists 15 Hz -------------
function rateOf(f) {
    const i = f.iface.split('.').pop(), m = f.field;
    if (/^ObjectRecognitionFrontCamera2?$/.test(i)) return 15;
    if (i === 'DAADataServer') return 10;
    if (i === 'EgoMotionLegacy') return 25;
    if (i === 'TrafficSignRecognition') return 2;
    if (/^(SpeedAcceleration)$/.test(i) && /vehicleSpeed|Acceleration|YawSpeed|VehicleDynamicData/.test(m)) return 50;
    if (/^(AccelerationLongitudinalLateralProvision|YawRateProvision|RollPitchRateAccelerationVerticalProvision|VelocityAndVehicleConditionProvision)$/.test(i)) return 50;
    if (/^(AcceleratorPedal|VehicleStabilizationManagement)$/.test(i)) return 50;
    if (i === 'Powertrain' && /ActualValueRPMWheel|WheelMomentDrive4/.test(m)) return 50;
    if (i === 'SurfaceInformationProvision' || i === 'VehicleModel') return 10;
    if (i === 'GapVehicleAhead') return m === 'GapVehicleDrivingAhead' ? 10 : 25;
    if (i === 'KeepDistanceObjectsLegacy') return 15;
    if (/^(CDS2|CDS|Vehicle2|A4A|XView|AssistedDrivingViewFunctionInput|VehicleInformation)$/.test(i)) return /statusIndicate|statusLightStatus/.test(m) ? 1 : 10;
    if (i === 'Powertrain' || i === 'Light') return 10;
    if (/^(DisplayDataServer|DisplayDataServer2|FASuS|TrafficSignDisplayControl|MultimodalControlDriverAssistance)$/.test(i)) return 5;
    return 1;
}
const CAMERA = (f) => f.set === 'S15';

async function main() {
    // ---------------------------------------------------------------------------------------------------------------
    console.log('1. what the ACC set (S17) holds');
    const need = {
        'front vehicle (gap, its speed, id, qualifiers; type, width; the second gap)': ['front-vehicle', 'front-vehicle-ext', 'gap-ahead'],
        'the keep-distance object lists (lead acceleration, lanes)': ['keep-dist-1', 'keep-dist-2', 'keep-dist-params'],
        'the camera\'s own object lists (both interfaces) and the lane assignment': ['cam-objects', 'cam-position', 'cam-movement', 'cam2-objects', 'cam2-position', 'cam2-movement', 'cam2-polar', 'object-lanes'],
        'cruise state and set speed (display data, FASuS, the longitudinal display, the availability)': ['hud-data', 'hud-data2', 'ldm-guidance', 'longitudinal', 'assist-avail'],
        'own speed (five sources and the displayed one)': ['speed', 'dynamics-long', 'velocity', 'velocity-long', 'car-speed2', 'display-speed'],
        'own acceleration (sensor, estimated, mass centre)': ['accel-long', 'accel-long-cog', 'accel-long-est', 'cds-accel-long'],
        'yaw and steering (curves, target loss)': ['yaw-rate', 'yaw-speed', 'steering'],
        'grade (three sources) and pitch': ['gradient', 'grade-xview', 'lane-slope', 'pitch-rate'],
        'pedals and brake (overrides out of the fit)': ['accel-pedal', 'brake-driver', 'brake-driver-hu', 'brake-switch', 'brake-light', 'drive-torque'],
        'wheel speeds and engine speed': ['wheel-rpm', 'engine-rpm'],
        'the collision-warning request and its setting': ['warn-brake', 'fcw-setting'],
        'drive mode, gear, gearbox programme': ['fes-switch', 'gearbox-status', 'gearbox-display'],
        'context: the speed limit, the indicator, the lights (night)': ['tsr', 'indicate', 'lights'],
    };
    const accTags = tagsOf(ACC);
    Object.keys(need).forEach((k) => {
        const miss = need[k].filter((t) => accTags.indexOf(t) < 0);
        ok(miss.length === 0, k + (miss.length ? ': missing ' + miss.join(', ') : ''));
    });
    ok(ACC.every((f) => /^(r|rs|s|b)$/.test(f.flags)), 'every one of the ' + ACC.length + ' fields is read only (r / rs / s or an event; no method)');
    ok(FIELDS.TABLE.filter((f) => f.set === 'S17').length === 1 && FIELDS.TABLE.filter((f) => f.set === 'S17')[0].tag === 'steering', 'S17\'s own field: the steering angle (XView, already read for the grade)');
    ok(FIELDS.interfaces().length === 99, 'no new interface in the manifest (99, as before)');
    const s14 = FIELDS.TABLE.filter((f) => inSets(f, ['S14']));
    ok(s14.every((f) => inSets(f, ['S17'])), 'all of S14 (' + s14.length + ' fields with what it shares) is in S17');
    const cams = ACC.filter(CAMERA);
    ok(cams.every((f) => f.recEntries === FIELDS.ACC_ENTRIES) && FIELDS.ACC_ENTRIES === 8, 'the ' + cams.length + ' S15 fields of S17 keep at most ' + FIELDS.ACC_ENTRIES + ' objects in a recording');
    ok(!ACC.some((f) => /fused-objects|merged-objects|object-info|suaar|probability|specific|ego-cam/.test(f.tag)), 'left out (the budget): the fused and merged lists, the object information, the probabilities, the sensor-specific lists, the camera\'s own motion');
    const menu = fs.readFileSync(path.join(APP_DIR, 'menu.js'), 'utf8');
    const app = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'app.json'), 'utf8'));
    ok(JSON.stringify(app.config.recorder.choices[0]) === '["S17"]' && /REC_CHOICES = \[\['S17'\]/.test(menu), 'ACC is the first recording choice (app.json and menu.js)');
    ok(app.settings.some((s) => s.key === 'set17' && /^S17 ACC/.test(s.label)) && app.screens[0].items.some((x) => x[0] === 'setting' && x[1] === 'set17'), 'S17 has its checkbox (set17) in the menu');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('2. a field\'s own cap in a recording');
    const camPos = FIELDS.TABLE.find((f) => f.tag === 'cam-position');
    const big = { counter: 3, numberOfObjects: 12, objectPositionInfo: [] };
    for (let i = 0; i < 12; i++) big.objectPositionInfo.push({ positionX: 10 + i, positionY: 0.5, referencePoint: 'REAR_CENTER' });
    const dir2 = path.join(tmp, 'rec2');
    let t2 = 0;
    const R2 = new Recorder({ dir: dir2, mono: () => t2, version: 'test' });
    R2.start(['S17']);
    R2.sample({ f: camPos }, big); t2 += 70;
    R2.sample({ f: FIELDS.TABLE.find((f) => f.tag === 'fused-objects') }, { objects: big.objectPositionInfo });
    R2.stop(); await drain(R2);
    const r2 = readRec(dir2);
    const h2 = r2.lines.find((l) => /^#f,\d+,cam-position,/.test(l)) || '';
    ok(/objectPositionInfo\.n/.test(h2) && /objectPositionInfo\.7\.positionX/.test(h2) && !/objectPositionInfo\.8\./.test(h2), 'cam-position: 8 objects written, the 9th and later not');
    const row = r2.lines.find((l) => /^0,1,1,3,,/.test(l)) || '';
    ok(/(^|,)12(,|$)/.test(row.split(',').slice(5).join(',')), 'its list count still says 12');
    const hf = r2.lines.find((l) => /^#f,\d+,fused-objects,/.test(l)) || '';
    ok(/objects\.11\.positionX/.test(hf), 'a field without its own cap keeps the recorder\'s 16 (fused-objects: 12 written)');
    const fl = flatten({ list: [1, 2, 3, 4, 5] }, null, 3);
    ok(JSON.stringify(fl.keys) === '["list.n","list.0","list.1","list.2"]', 'flatten(): a list of 5 with a cap of 3');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('3. the budget: ' + SIM_MIN + ' simulated minutes per case, ' + ACC.length + ' fields');
    const budget = { fields: ACC.length, minutes: SIM_MIN, cases: [] };
    if (!cat) console.log('  skip: the catalogue is not here (values are made from its types)');
    else {
        const sim = async (objects, label) => {
            const dir = path.join(tmp, 'b-' + label);
            let now = 0;
            const R = new Recorder({ dir, mono: () => now, version: 'test', cfg: { quotaMB: 200, fileRawKB: 4096 } });
            R.start(['S17']);
            const plan = ACC.filter((f) => !(CAMERA(f) && objects === 0)).map((f, k) => ({ f, hz: rateOf(f), k, v: valueOf(f, k + 1, CAMERA(f) ? objects : 1), n: 0 }));
            const per = {};
            const cpu0 = process.cpuUsage();
            let sent = 0;
            for (let s = 0; s < SIM_MIN * 60; s++) {
                const ev = [];
                plan.forEach((p) => { for (let i = 0; i < p.hz; i++) ev.push([s * 1000 + Math.floor((i + p.k / plan.length) * 1000 / p.hz), p]); });
                ev.sort((a, b) => a[0] - b[0]);
                for (let e = 0; e < ev.length; e++) {
                    const p = ev[e][1];
                    now = ev[e][0];
                    p.n++;
                    move(p.v, p.n);
                    const q0 = R.queued;
                    R.sample({ f: p.f }, p.v);
                    per[p.f.tag] = (per[p.f.tag] || 0) + (R.queued - q0);
                    sent++;
                }
                if (s % 2 === 1) await catchUp(R);
            }
            const cpu = process.cpuUsage(cpu0);
            R.stop(); await drain(R, 60000);
            const rr = readRec(dir);
            const disk = rr.files.reduce((a, n) => a + fs.statSync(path.join(dir, n)).size, 0);
            const secs = SIM_MIN * 60;
            const st = R.status();
            const top = Object.keys(per).sort((a, b) => per[b] - per[a]).slice(0, 6).map((t) => [t, Math.round(per[t] / secs)]);
            const c = { objects, label, samplesPerS: Math.round(sent / secs), rawBytesPerS: Math.round(rr.text.length / secs), gzipBytesPerS: Math.round(disk / secs),
                minutesIn15MB: +(15 * 1048576 / (disk / secs) / 60).toFixed(1), minutesInProposed: +(PROPOSED_QUOTA_MB * 1048576 / (disk / secs) / 60).toFixed(1),
                cpuMsPerS: +(((cpu.user + cpu.system) / 1000) / secs).toFixed(2), dropped: st.dropped, errors: st.errors, topTextBytesPerS: top };
            budget.cases.push(c);
            console.log('  ' + JSON.stringify(c));
            return c;
        };
        const c0 = await sim(0, 'camera-silent');
        const c4 = await sim(4, 'camera-4');
        const c8 = await sim(8, 'camera-8');
        ok([c0, c4, c8].every((c) => c.dropped === 0 && c.errors === 0), 'no sample dropped, no error in any case');
        ok(c0.minutesIn15MB >= 15, 'camera silent (as S14): ' + c0.gzipBytesPerS + ' B/s on disk, ' + c0.minutesIn15MB + ' min in today\'s 15 MB');
        ok(c4.gzipBytesPerS > c0.gzipBytesPerS && c8.gzipBytesPerS > c4.gzipBytesPerS, 'the camera lists cost: 4 objects ' + c4.gzipBytesPerS + ' B/s, 8 objects ' + c8.gzipBytesPerS + ' B/s on disk');
        ok(c4.minutesInProposed >= 45 && c8.minutesInProposed >= 30, 'the proposed ' + PROPOSED_QUOTA_MB + ' MB: ' + c4.minutesInProposed + ' min with 4 objects, ' + c8.minutesInProposed +
            ' min with 8 in every list of both camera interfaces (today\'s 15 MB: ' + c4.minutesIn15MB + ' / ' + c8.minutesIn15MB + ' min)');
        ok(c8.cpuMsPerS < 60, 'CPU on the Mac with 8 objects: ' + c8.cpuMsPerS + ' ms a second');
        if (process.env.ACC_BUDGET_OUT) fs.writeFileSync(process.env.ACC_BUDGET_OUT, JSON.stringify(budget, null, 1));
    }

    // ---------------------------------------------------------------------------------------------------------------
    console.log('4. on the bench: the real app, built by the kit, in the stubbed head unit (port ' + PORT + ')');
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir);
    const baseUrl = 'http://127.0.0.1:' + PORT;
    const req = async (method, url, body) => {
        const rr = await fetch(baseUrl + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        if (rr.status === 200) return rr.json();
        if (rr.status !== 204) throw new Error(method + ' ' + url + ': ' + rr.status);
        return null;
    };
    let out = '', exited = false, server = null;
    const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); while (Date.now() < end) { if (fn()) return true; await sleep(100); } return fn(); };
    const probeLines = () => out.split('\n').filter((l) => /\[signal_probe\] probe: /.test(l)).map((l) => l.replace(/^.*\[signal_probe\] /, ''));
    const recDir = () => [path.join(dataDir, 'signal_probe', 'rec'), path.join(dataDir, 'rec')].find((d) => fs.existsSync(d)) || path.join(dataDir, 'rec');
    try {
        server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'signal_probe'], {
            cwd: ROOT, env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir }), stdio: ['ignore', 'pipe', 'pipe'],
        });
        const keep = (dd) => { out += dd; if (/app exited/.test(String(dd))) exited = true; };
        server.stdout.on('data', keep); server.stderr.on('data', keep);
        ok(await until(() => probeLines().some((l) => /^probe: start /.test(l)), 60000), 'the app builds with the kit and starts');
        let p = await req('GET', '/probe');
        ok(p && /^Почати запис ACC$/.test(p.native.REC.cells.Text1stRow) && /^Набір для запису: ACC$/.test(p.native.RECSET.cells.Text1stRow), 'the rows: "Почати запис ACC", "Набір для запису: ACC"');
        await req('POST', '/click', { id: 'REC' });
        ok(await until(() => probeLines().some((l) => /^probe: rec: start session=\d{8}-\d{6} sets=S17 /.test(l))), 'a press: the recording of S17 starts');
        ok(await until(() => probeLines().some((l) => /^probe: sets on=S17 changed=\+S17 /.test(l))) && probeLines().some((l) => new RegExp('^probe: rec: ' + ACC.length + ' fields routed to the recorder$').test(l)), 'S17 switched on with it, its ' + ACC.length + ' fields routed to the recorder');
        const nIf = FIELDS.interfaces().filter((e) => ACC.some((f) => f.iface === e.iface)).length;
        ok(await until(() => probeLines().filter((l) => /^probe: watch /.test(l)).length >= nIf, 30000), 'its ' + nIf + ' interfaces are subscribed: ' + probeLines().filter((l) => /^probe: watch /.test(l)).length);
        const cam = { counter: 1, timestamp: 77, eventDataQualifier: 'EVENT_DATA_AVAILABLE', numberOfObjects: 12, objectPositionInfo: [], objectDimensionInfo: [] };
        for (let i = 0; i < 12; i++) { cam.objectPositionInfo.push({ objectPositionInfoInvalidFlags: 0, referencePoint: 'REAR_CENTER', positionX: 20.5 + i, positionY: -1.25, positionZ: 0.5 }); cam.objectDimensionInfo.push({ objectDimensionInfoInvalidFlags: 0, length: 4.5, width: 1.8, heigth: 1.5 }); }
        for (let i = 0; i < 50; i++) {
            cam.counter = i;
            await req('POST', '/fake', { feed: { iface: camPos.iface, field: 'ObjectPosition', value: cam } });
            await req('POST', '/fake', { feed: { iface: 'de.bmw.infotainment.drivingexcitement.XView', field: 'statusSteeringAngleDriver', value: { actualValueSteeringAngleDriver: 32768 + i, qualifierActualValueSteeringAngleDriver: 'INITIALISIERUNG' } } });
        }
        await req('POST', '/click', { id: 'MARK' });
        await sleep(1200);
        p = await req('GET', '/probe');
        ok(/^Запис ACC іде, \d+:\d\d\. Натисніть: стоп$/.test(p.native.REC.cells.Text1stRow), 'while it records: ' + p.native.REC.cells.Text1stRow);
        await req('POST', '/click', { id: 'REC' });
        ok(await until(() => probeLines().some((l) => /^probe: rec: stop session=/.test(l))), 'a second press: stopped');
        await sleep(1500);
        const rb = readRec(recDir());
        const hc = rb.lines.find((l) => /^#f,\d+,cam-position,/.test(l)) || '';
        const idc = hc.split(',')[1], ids = (rb.lines.find((l) => /^#f,\d+,steering,/.test(l)) || '').split(',')[1];
        ok(rb.lines.filter((l) => l.split(',')[1] === idc && /^\d/.test(l)).length === 50 && /objectPositionInfo\.7\.positionX/.test(hc) && !/objectPositionInfo\.8\./.test(hc), 'the 50 camera events are in the file, 8 objects each');
        ok(rb.lines.filter((l) => l.split(',')[1] === ids && /^\d/.test(l)).length === 50 && /^#rec,1,[^,]+,\d{8}-\d{6},1,[^,]+,\d+,S17$/.test(rb.lines[0]), 'the 50 steering values too; the header names S17');
        const py = spawnSync('python3', [CONVERT, recDir(), '-o', path.join(tmp, 'conv')], { encoding: 'utf8', timeout: 120000 });
        ok(py.status === 0 && /2 fields|fields/.test(py.stdout), 'tools/car/rec_convert.py reads it: ' + (py.stdout || py.stderr).trim().split('\n').pop().replace(/ -> .*$/, ''));
        ok(!/uncaught|FATAL/i.test(out) && !exited, 'the app never exited, nothing uncaught');
    } catch (e) {
        ok(false, 'bench run: ' + (e && e.stack || e));
    } finally {
        if (server) { server.kill('SIGTERM'); await sleep(300); }
    }
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
