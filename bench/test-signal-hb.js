'use strict';
/**
 * test-signal-hb.js - beam HS: Signal Probe's HB recording set (S18, apps/signal_probe/fields.js) for the Auto Beam night drives.
 *
 *   node bench/test-signal-hb.js     (BENCH_PORT, default 8915; HB_SIM_MIN: simulated minutes per budget case, default 3;
 *                                     HB_BUDGET_OUT: a file to write the budget to, JSON)
 *
 *   1. the declarations: what HB holds (the brief's list and HR-REPORT Part E's), read only (r / rs / s / an event; no "w" anywhere
 *      in app.json, every r a NON-ZERO getter), never acknowledgeObjectData* (not declared at all), LightswitchOperation only as
 *      three rs fields (no method, no setter), the 15 light-object events with their three capital-M names, the interfaces it adds,
 *      no text member in any type it records, check_signals.py.
 *   2. the formatters: one compact line per light object (raw numbers, "defaults"), the stalk and the wiper switch as bits.
 *   3. the recorder: an object that repeats itself is folded (#s lines, no seq gap, one line a second at least), a change is written
 *      at once; the camera lists keep 4 objects under HB and 8 under ACC (recEntriesBy).
 *   4. inside the probe: recording HB routes its fields; each recorded field logs its FIRST value once with its raw members; the lamps,
 *      the stalk and the switches keep their lines (recLog), the stalk as bits with its changes; the rest stays quiet.
 *   5. the budget: a simulated HB recording on a quiet road and a busy one (and a busy one at twice the camera rate): bytes per
 *      second on disk, minutes in the 15 MB quota and in the proposed 64 MB, CPU.
 *   6. the read-only diagnostic reads (beam_diag.js): the allow-list and nothing else, 0x22 only (readonly-diag underneath), what
 *      leaves through the real ReadOnlyDiag, one read a second per unit, the parked session's first pass, the back-off, no read
 *      while moving (or with no / an old speed) under the default config, the replies in the log and the recording.
 *   7. on the bench: the real app; RECSET once = HB; a press records S18 (its checkbox on); injected light objects, the verdict, the
 *      stalk and the lamps land in the file; the first-value lines are in the log; tools/car/hb_analyse.py reads the file.
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
const CHECK = path.join(ROOT, 'tools', 'signals', 'check_signals.py');
const ANALYSE = path.join(ROOT, 'tools', 'car', 'hb_analyse.py');
const FIELDS = require(path.join(APP_DIR, 'fields.js'));
const F = require(path.join(ROOT, 'shared', 'signal_format.js'));
const { Probe } = require(path.join(APP_DIR, 'probe.js'));
const { Recorder } = require(path.join(ROOT, 'shared', 'signal_recorder.js'));
const PORT = Number(process.env.BENCH_PORT) || 8915;
const SIM_MIN = Number(process.env.HB_SIM_MIN) || 3;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-hb-'));

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inSets = (f, ids) => [f.set].concat(f.also || []).some((s) => ids.indexOf(s) >= 0);
const HB = FIELDS.TABLE.filter((f) => inSets(f, ['S18']));
const OWN = FIELDS.TABLE.filter((f) => f.set === 'S18');
const tagsOf = (xs) => xs.map((f) => f.tag);
const T = (tag) => FIELDS.TABLE.find((f) => f.tag === tag);
const NEW_IFACES = ['RecogLight', 'Environment', 'Wiper', 'LightswitchOperation', 'ObjectlistTCP', 'Weather'].map((k) => FIELDS.I[k]);

function readRec(dir) {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^rec-.*\.csv(\.gz)?$/.test(n)).sort() : [];
    const text = files.map((n) => { const b = fs.readFileSync(path.join(dir, n)); return /\.gz$/.test(n) ? zlib.gunzipSync(b).toString() : b.toString(); }).join('');
    return { files, text, lines: text.split('\n').filter((l) => l) };
}
async function drain(rec, ms) {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) {
        if (!rec.writing && rec.queued === 0 && (rec.segs.length === 0 || (rec.segs.length === 1 && !rec.segs[0].chunks.length && !rec.segs[0].closed))) return true;
        rec._flush(); await sleep(2);
    }
    return false;
}
async function catchUp(rec) { for (let i = 0; i < 5000 && (rec.writing || rec.segs.some((sg) => sg.chunks.length)); i++) { rec._flush(); await sleep(0); } }
const objEvent = (slot, o) => {
    const v = {};
    [['XPosition', 'x'], ['YPosition', 'y'], ['Width', 'w'], ['AngularSpeedRight', 'wr'], ['AngularSpeedLeft', 'wl'], ['Height', 'h'], ['Class', 'cls'], ['Id', 'id'], ['Distance', 'dist'], ['Status', 'status']]
        .forEach((m) => { v[m[0] + 'Object' + slot] = o ? o[m[1]] : F.BEAM_OBJ_DEFAULT[m[0]]; });
    return v;
};

// ---- values from the catalogue's own types (as test-signal-acc.js) ----------------------------------------------------------------
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
function move(v, k) {
    if (!v || typeof v !== 'object') return;
    Object.keys(v).forEach((key) => {
        const x = v[key];
        if (typeof x === 'number') v[key] = /alive|aliv|counter|sync/i.test(key) ? (x + 1) % 15 : Number.isInteger(x) ? x + (k % 7 === 0 ? 1 : 0) : x + (((k * 7919 + key.length * 31) % 200) - 100) / 1000;
        else if (x && typeof x === 'object') move(x, k + 1);
    });
}
const hasText = (rf, depth, seen, skip) => {
    const x = base(rf), t = DT[x];
    if (!t) return /^Utf|^ByteBuffer/.test(x);
    if (depth > 12 || seen.indexOf(x) >= 0) return false;
    if (t.type === 'array') return hasText(t.dataRef || t.elementDataRef, depth + 1, seen.concat([x]), skip);
    if (t.type === 'struct' || t.type === 'union') return allMembers(t).some((m) => skip.indexOf(m.name) < 0 && hasText(m.dataRef, depth + 1, seen.concat([x]), skip));
    return false;
};
const refOf = (f) => {
    if (f.flags !== 'b') return cat.interfaces[f.iface].fields[f.field].dataRef;
    const key = '__event:' + f.iface + '.' + f.field;
    if (!DT[key]) DT[key] = { type: 'struct', members: cat.interfaces[f.iface].events[f.field].outputs.map((o) => ({ name: o.name, dataRef: o.dataRef, dimension: o.dimension })) };
    return key;
};

// ---- the assumed native rates (Hz); the first drive replaces them -----------------------------------------------------------------
function rateOf(f, camHz) {
    const i = f.iface.split('.').pop(), m = f.field;
    if (i === 'RecogFrontCameraLightDetection') return /ainBeamAssistantDataObject|mEObjectID/.test(m) ? camHz : 10;
    if (i === 'RecogFrontCameraObjectlist' || /^ObjectRecognitionFrontCamera2?$/.test(i)) return camHz;
    if (i === 'Light') return /IndicatorSteeringColumn|statusOperationLightExterior/.test(m) ? 1 : 10;
    if (i === 'YawRateProvision') return 50;
    if (i === 'GapVehicleAhead') return m === 'GapVehicleDrivingAhead' ? 10 : 25;
    if (/^(Vehicle2|CDS2|XView|VehicleInformation)$/.test(i)) return /statusLightStatus|statusIndicate|statusDimmer|statusExteriorLightDynamic|statusConfigLM2/.test(m) ? 1 : 10;
    if (i === 'TrafficSignRecognition' || i === 'SignRecognitionFrontCamera') return 2;
    if (i === 'Wiper' || i === 'Environment' || i === 'Weather') return 2;
    return 1;
}
const CAMERA_LIST = (f) => f.set === 'S15' || f.tag === 'hb-objlist';
const LIGHT_OBJ = (f) => !!f.slot;

async function main() {
    // ---------------------------------------------------------------------------------------------------------------
    console.log('1. the declarations');
    const app = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'app.json'), 'utf8'));
    const sigs = app.signals;
    const need = {
        'the 15 light objects, the verdict, the object ids (RecogFrontCameraLightDetection)': ['hb-control', 'hb-meid1', 'hb-meid2'].concat(Array.from({ length: 15 }, (x, i) => 'hb-obj' + (i + 1))),
        'the lamps (LampExterior, LampExterior2, LowBeam), the switch, the indicators': ['brake-light', 'hb-lamps', 'hb-low-beam', 'hb-switch', 'hb-indicators', 'hb-indicators2'],
        'the stalk (both fields) and the head unit\'s lamp status (the best "high beam lit" member)': ['stalk', 'stalk-complete', 'lights'],
        'the brightness, the wipers, the light switch screen (read only)': ['hb-brightness', 'hb-prefield', 'hb-wiper', 'hb-rain', 'hb-wiper-stalk', 'hb-lightswitch', 'hb-fog-front', 'hb-fog-rear'],
        'speed, yaw, steering, gear, indicator, outside temperature, dimmer': ['car-speed2', 'yaw-rate', 'hb-yaw-hu', 'steering', 'gearbox-status', 'indicate', 'external-display', 'hb-exterior-temp', 'dimmer'],
        'the town question (the limit, every sign stream of the camera, the map\'s flags)': ['tsr', 'cam-signs', 'cam-legacy', 'cam-legacy2', 'ccp-builtup', 'hb-ccp-urban', 'hb-ccp-road', 'hb-ccp-side'],
        'the fallback: object lists with lamp states and movement, the vehicle ahead and its lamps': ['hb-objlist', 'cam-objects', 'cam-position', 'cam2-objects', 'cam2-position', 'cam-specific', 'cam2-specific', 'front-vehicle', 'gap-ahead'],
        'darkness and weather (HR Part E 5, 6, 9)': ['hb-daynight', 'hb-weather', 'hb-config-lm', 'hb-light-dynamic'],
    };
    const hbTags = tagsOf(HB);
    Object.keys(need).forEach((k) => { const miss = need[k].filter((t) => hbTags.indexOf(t) < 0); ok(miss.length === 0, k + (miss.length ? ': missing ' + miss.join(', ') : '')); });
    ok(HB.every((f) => /^(r|rs|s|b)$/.test(f.flags)), 'every one of the ' + HB.length + ' HB fields is read only (r / rs / s or an event; no method)');
    const decl = [];
    Object.keys(sigs).forEach((i) => Object.keys(sigs[i]).filter((k) => k[0] !== '_').forEach((fd) => decl.push(sigs[i][fd])));
    ok(decl.every((x) => x.indexOf('w') < 0), 'no "w" flag anywhere in app.json (' + decl.length + ' fields)');
    const light = sigs[FIELDS.I.RecogLight];
    ok(light && Object.keys(light).filter((k) => k[0] !== '_').length === 0 && !/acknowledge/i.test(JSON.stringify(sigs)), 'acknowledgeObjectDataLeft / Right are not declared at all (RecogFrontCameraLightDetection: events only)');
    ok(light && light._broadcasts.length === 18 && ['MainBeamAssistantDataObject11', 'MainBeamAssistantDataObject12', 'MainBeamAssistantDataObject15', 'mainBeamAssistantDataObject1', 'controlHighBeamAssistant', 'mEObjectID1', 'mEObjectID2'].every((e) => light._broadcasts.indexOf(e) >= 0),
        'its 18 events as _broadcasts, the three capital-M names among them');
    const lso = sigs[FIELDS.I.LightswitchOperation];
    ok(lso && JSON.stringify(Object.keys(lso).sort()) === '["_instances","foglightFront","foglightRear","mainLightswitchState"]' && lso.foglightFront === 'rs' && lso.foglightRear === 'rs' && lso.mainLightswitchState === 'rs',
        'LightswitchOperation: only its three fields, "rs"; no method, no broadcast, no setter');
    ok(FIELDS.interfaces().length === 105 && NEW_IFACES.every((i) => sigs[i]) && NEW_IFACES.every((i) => !FIELDS.TABLE.some((f) => f.iface === i && !inSets(f, ['S18']))),
        'six interfaces new to the manifest, all for HB only (' + NEW_IFACES.map((i) => i.split('.').pop()).join(', ') + '): 105 in all');
    ok(OWN.filter((f) => f.slot).map((f) => f.slot).join(',') === '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15', 'the 15 object slots, one field each');
    if (cat) {
        const wrong = [];
        HB.forEach((f) => {
            if (f.flags === 'b') { if (!(cat.interfaces[f.iface].events || {})[f.field]) wrong.push(f.tag + ': no such event'); return; }
            const c = cat.interfaces[f.iface].fields[f.field];
            const want = (c.getter && c.getter.id ? 'r' : '') + (c.notifier && c.notifier.id ? 's' : '');
            if (f.flags !== want) wrong.push(f.tag + ' ' + f.flags + ' vs ' + want);
        });
        ok(wrong.length === 0, 'every HB field: r iff a non-zero getter, s iff a notifier, every event in the catalogue' + (wrong.length ? ': ' + wrong.join('; ') : ''));
        const texts = HB.filter((f) => hasText(refOf(f), 0, [], (f.tree && f.tree.skip) || []));
        ok(texts.length === 0, 'no type HB records has a text member (numbers and enum names only, in the file and in the first-value lines)' + (texts.length ? ': ' + tagsOf(texts).join(', ') : ''));
        const o = spawnSync('python3', [CHECK, CATALOGUE, path.join(APP_DIR, 'app.json')], { encoding: 'utf8' });
        ok(o.status === 0 && /all declarations pass/.test(o.stdout + o.stderr), 'check_signals.py: ' + (o.stdout + o.stderr).trim().split('\n').pop());
    } else console.log('  skip: the catalogue is not here');
    ok(app.config.recorder.choices.some((c) => c.join('+') === 'S18') && app.settings.some((s) => s.key === 'set18' && /^S18 HB/.test(s.label)), 'HB is a recording choice, with its checkbox set18');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('2. the formatters');
    const o3 = { id: 5, cls: 2, status: 1, x: 120, y: 80, w: 4, h: 2, dist: 60, wl: 128, wr: 127 };
    ok(F.fmtBeamObj(objEvent(3, o3), 3) === 'slot=3 id=5 class=2 status=1 x=120 y=80 w=4 h=2 dist=60 asl=128 asr=127', 'one light object: ' + F.fmtBeamObj(objEvent(3, o3), 3));
    ok(F.fmtBeamObj(objEvent(11, null), 11) === 'slot=11 id=15 class=15 status=7 x=255 y=255 w=255 h=63 dist=127 asl=255 asr=255 defaults', 'an empty slot (every catalogue default): "defaults"');
    ok(F.fmtBeamObj('Canary text', 2) === 'slot=2 not a struct (string)' && F.fmtBeamObj({}, 4) === 'slot=4 id=- class=- status=- x=- y=- w=- h=- dist=- asl=- asr=-', 'not a struct, or no member: said so, no text');
    const ws = { prevNum: undefined };
    ok(F.fmtBits({ operationWiperSwitch: 4 }, T('hb-wiper-stalk').bits, ws) === 'switch=4(0x4) prev=-' && F.fmtBits({ operationWiperSwitch: 0 }, T('hb-wiper-stalk').bits, ws) === 'switch=0 prev=4(0x4) up=0x0 down=0x4', 'the wiper switch as bits with its changes');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('3. the recorder: folded repeats, the per-set cap');
    const dir3 = path.join(tmp, 'rec3');
    let t3 = 0;
    const R3 = new Recorder({ dir: dir3, mono: () => t3, version: 'test' });
    R3.start(['S18']);
    const obj1 = T('hb-obj1');
    // 3 s of the same object at 15 Hz, then a change, then 1 s more of the new value
    for (let i = 0; i < 45; i++) { R3.sample({ f: obj1 }, objEvent(1, o3)); t3 += 66; }
    R3.sample({ f: obj1 }, objEvent(1, Object.assign({}, o3, { dist: 59 }))); const tChange = t3; t3 += 66;
    for (let i = 0; i < 15; i++) { R3.sample({ f: obj1 }, objEvent(1, Object.assign({}, o3, { dist: 59 }))); t3 += 66; }
    const camPos = T('cam-position');
    const big = { counter: 3, numberOfObjects: 12, objectPositionInfo: [] };
    for (let i = 0; i < 12; i++) big.objectPositionInfo.push({ positionX: 10 + i, positionY: 0.5, referencePoint: 'REAR_CENTER' });
    R3.sample({ f: camPos }, big);
    R3.stop(); await drain(R3);
    const r3 = readRec(dir3);
    const id1 = (r3.lines.find((l) => /^#f,\d+,hb-obj1,/.test(l)) || '').split(',')[1];
    const rows = r3.lines.filter((l) => /^\d/.test(l) && l.split(',')[1] === id1);
    const folds = r3.lines.filter((l) => /^#s,/.test(l) && l.split(',')[2] === id1);
    const nFold = folds.reduce((n, l) => n + Number(l.split(',')[3]), 0);
    ok(rows.length >= 4 && rows.length <= 6 && rows.length + nFold === 61, '61 samples of one slot: ' + rows.length + ' lines written, ' + nFold + ' folded (in ' + folds.length + ' #s lines)');
    ok(rows.map((l) => Number(l.split(',')[2])).every((q, i) => q === i + 1), 'a folded sample takes no seq: the seqs run 1..' + rows.length + ' without a gap (no false "drop")');
    ok(rows.some((l) => Number(l.split(',')[0]) === tChange && /,59,/.test(l)), 'the change is written at once (t=' + tChange + ')');
    ok(folds.every((l) => /^#s,\d+,\d+,\d+,\d+$/.test(l) && Number(l.split(',')[4]) <= Number(l.split(',')[1])), 'each #s line: t, id, n, the last fold\'s t (not after the line)');
    const gaps = rows.slice(1).map((l, i) => Number(l.split(',')[0]) - Number(rows[i].split(',')[0]));
    ok(gaps.every((g) => g <= 1100), 'a repeating object still makes a line at least once a second (largest step ' + Math.max.apply(null, gaps) + ' ms)');
    ok(/,folded=\d+$/.test(r3.lines[r3.lines.length - 1]) && Number(r3.lines[r3.lines.length - 1].split('folded=')[1]) === R3.status().folded && R3.status().folded >= nFold, '#end and status() count the folds: ' + R3.status().folded);
    const hc = r3.lines.find((l) => /^#f,\d+,cam-position,/.test(l)) || '';
    ok(/objectPositionInfo\.3\.positionX/.test(hc) && !/objectPositionInfo\.4\./.test(hc), 'cam-position under HB: 4 objects written (recEntriesBy S18)');
    const dir3b = path.join(tmp, 'rec3b');
    const R3b = new Recorder({ dir: dir3b, mono: () => 0, version: 'test' });
    R3b.start(['S17']); R3b.sample({ f: camPos }, big); R3b.stop(); await drain(R3b);
    const hcb = readRec(dir3b).lines.find((l) => /^#f,\d+,cam-position,/.test(l)) || '';
    ok(/objectPositionInfo\.7\.positionX/.test(hcb) && !/objectPositionInfo\.8\./.test(hcb), '... and 8 under ACC, as before');
    const py3 = spawnSync('python3', ['-I', path.join(ROOT, 'tools', 'car', 'rec_convert.py'), dir3, '-o', path.join(tmp, 'conv3')], { encoding: 'utf8' });
    ok(py3.status === 0, 'rec_convert.py reads a file with #s lines (it skips them): ' + (py3.stdout || py3.stderr).trim().split('\n').pop().replace(/ -> .*$/, ''));

    // ---------------------------------------------------------------------------------------------------------------
    console.log('4. inside the probe');
    const L4 = [], subs = {};
    const sig = {
        watch: (iface, inst, handlers) => { subs[iface] = handlers; return Promise.resolve({ iface, available: true, proxy: { iface }, error: null }); },
        on: (p, field, fn) => { subs[p.iface][field] = fn; return Promise.resolve(); },
        get: () => Promise.reject(new Error('no')),
    };
    let t4 = 0;
    const P = new Probe({ log: { info: (s) => L4.push(s), warn: (s) => L4.push(s) }, signals: sig, now: () => 1e6 + t4, cfg: { hubPauseMs: 0 } });
    const R4 = new Recorder({ dir: path.join(tmp, 'rec4'), log: { info: (s) => L4.push(s), warn: (s) => L4.push(s) }, mono: () => t4 });
    P.setRecorder(R4, true);
    P.setSets(['S18'], true);
    await P.idle(); await sleep(5); await P.idle();
    const n4 = P.recordSets(['S18']);
    ok(n4 === HB.length, 'recordSets([S18]): its ' + n4 + ' fields');
    R4.start(['S18']);
    const st = (tag) => P.fields.find((x) => x.f.tag === tag);
    for (let i = 0; i < 30; i++) { t4 += 66; st('hb-obj2').handler(objEvent(2, Object.assign({}, o3, { dist: 90 - i }))); st('hb-control').handler(valueOf(T('hb-control'), i + 1, 1)); }
    st('stalk').handler({ operationColumnStalks: 0 }); t4 += 100;
    st('stalk').handler({ operationColumnStalks: 0x10 }); t4 += 400;
    st('stalk').handler({ operationColumnStalks: 0 }); t4 += 150;
    st('hb-lamps').handler({ cRCControlLampExterior2: 1, aliveControlLampExterior2: 2, controlFunctionMainBeam: 'ON_MAB_MODE_1', controlFunctionDippedBeamLeftHand: 'ON_DIPB_L' }); t4 += 10;
    st('lights').handler({ statusMainBeam_headlightFlasher: 'EIN', statusDippedBeam: 'EIN' });
    R4.stop(); await drain(R4);
    const first = L4.filter((l) => /^probe: first P27 hb-obj2 /.test(l));
    ok(first.length === 1 && /: XPositionObject2=120 YPositionObject2=80 WidthObject2=4 AngularSpeedRightObject2=127 AngularSpeedLeftObject2=128 HeightObject2=2 ClassObject2=2 IdObject2=5 DistanceObject2=90 StatusObject2=1$/.test(first[0]),
        'the first value of a recorded field: one line with its raw members: ' + (first[0] || '(none)'));
    ok(L4.filter((l) => /^probe: first P27 hb-control /.test(l)).length === 1 && !L4.some((l) => /^probe: P27 (hb-obj2|hb-control) #/.test(l)), '... once; the 30 values after it make no line (quiet while recording)');
    ok(L4.some((l) => /^probe: P13 stalk #\d+ .*stalks=16\(0x10\) prev=0 up=0x10 down=0x0/.test(l)) && L4.some((l) => /^probe: P13 stalk #\d+ .*stalks=0 prev=16\(0x10\) up=0x0 down=0x10/.test(l)), 'the stalk keeps its lines while recording, as bits with their changes');
    ok(L4.some((l) => /^probe: P27 hb-lamps #1 .*mainBeam=ON_MAB_MODE_1/.test(l)) && L4.some((l) => /^probe: P19 lights #1 .*mainBeam=EIN/.test(l)), 'the two "high beam lit" members keep their lines while recording (recLog)');
    ok(!L4.some((l) => /^probe: first P13 stalk|^probe: first P27 hb-lamps/.test(l)), 'a recLog field needs no first-value line');
    const r4 = readRec(path.join(tmp, 'rec4'));
    ok(['hb-obj2', 'hb-control', 'stalk', 'hb-lamps', 'lights'].every((tag) => r4.lines.some((l) => new RegExp('^#f,\\d+,' + tag + ',').test(l))), 'all five are in the file');
    P.recordSets(['S18']);
    ok(P.fields.every((x) => !x.firstRec), 'a new recording says each first value again');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('5. the budget: ' + SIM_MIN + ' simulated minutes per case, ' + HB.length + ' fields');
    const budget = { fields: HB.length, interfaces: FIELDS.interfaces().filter((e) => HB.some((f) => f.iface === e.iface)).length, minutes: SIM_MIN, cases: [] };
    if (!cat) console.log('  skip: the catalogue is not here');
    else {
        const sim = async (label, objects, listObjects, camHz) => {
            const dir = path.join(tmp, 'b-' + label);
            let now = 0;
            const R = new Recorder({ dir, mono: () => now, version: 'test', cfg: { quotaMB: 200, fileRawKB: 4096 } });
            R.start(['S18']);
            const plan = HB.map((f, k) => ({ f, hz: rateOf(f, camHz), k, v: LIGHT_OBJ(f) ? null : valueOf(f, k + 1, CAMERA_LIST(f) ? listObjects : 1), n: 0 }));
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
                    if (LIGHT_OBJ(p.f)) {
                        // `objects` slots hold a light that moves every frame; the others are empty (the catalogue's defaults)
                        const live = p.f.slot <= objects;
                        R.sample({ f: p.f }, objEvent(p.f.slot, live ? { id: p.f.slot, cls: 1 + p.f.slot % 3, status: 1, x: 100 + (p.n % 100), y: 90 + (p.n % 7), w: 2 + (p.n % 20), h: 2, dist: 126 - (p.n % 120), wl: 120 + (p.n % 15), wr: 121 + (p.n % 15) } : null));
                    } else {
                        if (/hb-meid/.test(p.f.tag) && !objects) Object.keys(p.v).forEach((k) => { p.v[k] = 255; });
                        else move(p.v, p.n);
                        R.sample({ f: p.f }, p.v);
                    }
                    sent++;
                }
                if (s % 2 === 1) await catchUp(R);
            }
            const cpu = process.cpuUsage(cpu0);
            R.stop(); await drain(R, 60000);
            const rr = readRec(dir);
            const disk = rr.files.reduce((a, n) => a + fs.statSync(path.join(dir, n)).size, 0);
            const secs = SIM_MIN * 60, st5 = R.status();
            const c = { label, lightObjects: objects, listObjects, cameraHz: camHz, samplesPerS: Math.round(sent / secs), linesPerS: Math.round(st5.samples / secs), foldedPerS: Math.round(st5.folded / secs),
                rawBytesPerS: Math.round(rr.text.length / secs), gzipBytesPerS: Math.round(disk / secs), kbPerMin: Math.round(disk / secs * 60 / 1024),
                minutesIn15MB: +(15 * 1048576 / (disk / secs) / 60).toFixed(1), minutesIn64MB: +(64 * 1048576 / (disk / secs) / 60).toFixed(1),
                cpuMsPerS: +(((cpu.user + cpu.system) / 1000) / secs).toFixed(2), dropped: st5.dropped, errors: st5.errors };
            budget.cases.push(c);
            console.log('  ' + JSON.stringify(c));
            return c;
        };
        const quiet = await sim('quiet-road', 0, 0, 15);
        const busy = await sim('busy-road', 8, 4, 15);
        const busy30 = await sim('busy-road-30Hz', 8, 4, 30);
        ok([quiet, busy, busy30].every((c) => c.dropped === 0 && c.errors === 0), 'no sample dropped, no error in any case');
        ok(quiet.foldedPerS > 150 && quiet.minutesIn15MB >= 40, 'a quiet road (no light, empty lists): the 15 empty slots fold (' + quiet.foldedPerS + ' a second), ' + quiet.gzipBytesPerS + ' B/s on disk, ' + quiet.minutesIn15MB + ' min in 15 MB');
        ok(busy.gzipBytesPerS > quiet.gzipBytesPerS && busy.minutesIn15MB >= 10 && busy.minutesIn64MB >= 45, 'a busy road (8 lights moving every frame, 4 objects in every list): ' + busy.gzipBytesPerS + ' B/s, ' + busy.minutesIn15MB + ' min in 15 MB, ' + busy.minutesIn64MB + ' in 64 MB');
        ok(busy30.minutesIn15MB >= 5, 'the same at 30 Hz: ' + busy30.gzipBytesPerS + ' B/s, ' + busy30.minutesIn15MB + ' min in 15 MB, ' + busy30.minutesIn64MB + ' in 64 MB');
        ok(busy30.cpuMsPerS < 40, 'CPU on the Mac at 30 Hz: ' + busy30.cpuMsPerS + ' ms a second');
        if (process.env.HB_BUDGET_OUT) fs.writeFileSync(process.env.HB_BUDGET_OUT, JSON.stringify(budget, null, 1));
    }

    // ---------------------------------------------------------------------------------------------------------------
    console.log('6. the read-only diagnostic reads (beam_diag.js, the owner\'s decision of 2026-11-20)');
    const BD = require(path.join(APP_DIR, 'beam_diag.js'));
    const RO = require(path.join(ROOT, 'kit', 'runtime', 'readonly-diag.js'));
    const WANT = { 0x40: [0xF186, 0xD542, 0xD57E, 0xE3B8], 0x43: [0xF186, 0xD7A7], 0x44: [0xF186, 0xD7A7] };
    ok(JSON.stringify(BD.ALLOW) === JSON.stringify(WANT), 'the allow-list is exactly BDC 0x40: F186 D542 D57E E3B8; FLM 0x43 / 0x44: F186 D7A7');
    let through = 0, refusedAll = true;
    [0x40, 0x43, 0x44, 0x12, 0x41, 0x60, 0xDF].forEach((a) => { for (let d = 0; d <= 0xFFFF; d++) { let threw = false; try { BD.allowed(a, d); through++; } catch (e) { threw = true; } if (!threw && !(WANT[a] && WANT[a].indexOf(d) >= 0)) refusedAll = false; } });
    ok(through === 8 && refusedAll, 'every one of 7 x 65 536 (unit, identifier) pairs but those 8 throws');
    ok(['D5E6', 'D6DC', 'E3B5', 'A539', 'D25D'].every((x) => { try { BD.allowed(0x40, parseInt(x, 16)); return false; } catch (e) { return true; } }), 'the write / IO / routine jobs of HR-REPORT 5.2 (D5E6, D6DC, E3B5, A539, D25D) are refused');
    ok([0x10, 0x11, 0x14, 0x19, 0x27, 0x2E, 0x2F, 0x31, 0x3E, 0x85].every((sid) => { try { RO.check(0x40, sid, [0xD5, 0x42], false); return false; } catch (e) { return true; } }) && (() => { try { RO.check(0x40, 0x22, [0xD5, 0x42], false); return true; } catch (e) { return false; } })(),
        'under it, readonly-diag refuses every service but 22 (10 session, 3E tester present, 2E write, 2F IO, 31 routine, 14 clear ...)');
    const app6 = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'app.json'), 'utf8'));
    ok(app6.config.hbdiag && app6.config.hbdiag.whileMoving === false && app6.settings.some((x) => x.key === 'hbdiag' && x.default === false), 'off by default (setting hbdiag false), and only while standing (config.hbdiag.whileMoving false)');
    const srcs = fs.readdirSync(APP_DIR).filter((n) => /\.js$/.test(n)).map((n) => [n, fs.readFileSync(path.join(APP_DIR, n), 'utf8')]);
    // (fields.js names sendTasuRequest once: the manifest's declaration DIAG_MANIFEST, which grants it; no code calls it)
    ok(srcs.every((x) => !/require\(['"]\.\/kit\/diag['"]\)|sendTasuRequest|\.physical\(|\.functional\(/.test(x[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/^const DIAG_MANIFEST = .*$/m, ''))) &&
        /require\('\.\/kit\/readonly-diag'\)/.test(srcs.find((x) => x[0] === 'main.js')[1]), 'the app reaches the transport only through kit/readonly-diag (never kit/diag, never sendTasuRequest itself, no physical / functional call)');
    // the real ReadOnlyDiag over a stand-in for the transport: what leaves the head unit
    const sent = [];
    let answer = (req) => [0x62, req.udsData[0], req.udsData[1], 1, 2, 3];
    const fakeTasu = () => {
        let onResp = null;
        return { proxy: () => Promise.resolve({ tasu: true }), on: (p, ev, fn) => { onResp = fn; return Promise.resolve(); }, onAvailable: (p, fn) => { fn(true); return Promise.resolve(); },
            call: (p, method, req) => {
                sent.push({ at: Date.now(), method, target: req.targetAddress, sid: req.serviceID, did: (req.udsData[0] << 8) | req.udsData[1], n: req.udsData.length });
                const uds = answer(req);
                if (uds) setTimeout(() => onResp({ udsResponse: Buffer.from([0, 0, 0, 0, 0, 0, req.targetAddress, 0, 0].concat(uds)), errorCode: 'NO_ERROR' }), 5);
                return Promise.resolve({ TasuErrorEnum: 'NO_ERROR' });
            } };
    };
    const L6 = [];
    const log6 = { info: (x) => L6.push(x), warn: (x) => L6.push(x), error: (x) => L6.push(x) };
    let speed6 = { kmh: 0, at: Date.now() };
    const link6 = await new RO.ReadOnlyDiag(fakeTasu(), log6).init();
    const R6 = new Recorder({ dir: path.join(tmp, 'rec6'), mono: () => Date.now() % 1e9, version: 'test' });
    R6.start(['S18']);
    const D6 = new BD.BeamDiag({ link: link6, log: log6, recorder: R6, speed: () => { speed6.at = Date.now(); return speed6; } });
    D6.start();
    await sleep(3300);
    D6.stop(); R6.stop(); await drain(R6);
    const byUnit = (a) => sent.filter((x) => x.target === a);
    ok(sent.length >= 8 && sent.every((x) => x.method === 'sendTasuRequest' && x.sid === 0x22 && x.n === 2 && WANT[x.target] && WANT[x.target].indexOf(x.did) >= 0),
        sent.length + ' requests left in 3.3 s standing: every one 22 <one allow-listed identifier> to BDC / FLM_L / FLM_R');
    ok([0x40, 0x43, 0x44].every((a) => byUnit(a).length <= 4 && byUnit(a).every((x, i, arr) => i === 0 || x.at - arr[i - 1].at >= 990)), 'at most one read a second per unit (' + [0x40, 0x43, 0x44].map((a) => byUnit(a).length).join(' / ') + ' in 3.3 s)');
    ok(JSON.stringify(byUnit(0x40).map((x) => x.did)) === JSON.stringify([0xF186, 0xD542, 0xD57E, 0xE3B8].slice(0, byUnit(0x40).length)) && JSON.stringify(byUnit(0x43).slice(0, 2).map((x) => x.did)) === JSON.stringify([0xF186, 0xD7A7]),
        'the parked session\'s first pass: BDC F186, D542, D57E, E3B8; each FLM F186, D7A7');
    ok(L6.some((l) => /^probe: diag BDC 0x40 F186 #1 t=[0-9.]+ ms=\d+: 62 F1 86 01 02 03$/.test(l)) && L6.filter((l) => /^probe: diag /.test(l)).every((l) => !/[^\x20-\x7e]/.test(l)), 'the log: the raw reply bytes in hex (numbers only)');
    const r6 = readRec(path.join(tmp, 'rec6'));
    ok(r6.lines.some((l) => /^#f,\d+,diag-bdc-f186,BDC\.F186,ok,nrc,n,b00,b01,b02$/.test(l)) && r6.lines.some((l) => /^#f,\d+,diag-flml-d7a7,/.test(l)), 'every reply is also in the recording (diag-<unit>-<did>: ok, nrc, n, the data bytes)');
    // the speed gate: nothing leaves while moving, with no speed, or with an old speed
    const gate = async (sp, whileMoving) => {
        const before = sent.length;
        const D = new BD.BeamDiag({ link: link6, log: log6, speed: () => sp, whileMoving });
        D.start(); await sleep(1300); D.stop();
        return sent.length - before;
    };
    ok(await gate({ kmh: 30, at: Date.now() + 5000 }) === 0, 'moving (30 km/h) under the default config: no read leaves');
    ok(await gate({ kmh: 0.75, at: Date.now() + 5000 }) === 0 && await gate(null) === 0 && await gate({ kmh: 0, at: Date.now() - 10000 }) === 0, '... nor at 0.75 km/h, with no speed, or with a speed older than 3 s');
    ok(L6.some((l) => /^probe: diag: no read: moving$/.test(l)) && L6.some((l) => /^probe: diag: no read: speed unknown$/.test(l)), 'the gate says why, once per change');
    ok(await gate({ kmh: 30, at: Date.now() + 5000 }, true) > 0, 'whileMoving true (not the default) would let them go');
    // pacing and back-off on a fake clock
    let now7 = 0;
    const calls7 = [];
    let reply7 = () => [0x7F, 0x22, 0x21];
    const fakeLink = { read: (a, d) => { calls7.push({ t: now7, a, d }); return Promise.resolve(reply7(a, d)); }, cancel: () => {} };
    const D7 = new BD.BeamDiag({ link: fakeLink, log: log6, now: () => now7, speed: () => ({ kmh: 0, at: now7 }), timers: { setInterval: () => null, clearInterval: () => {} } });
    D7.start();
    const run = async (ms) => { for (let x = 0; x < ms; x += 250) { now7 += 250; D7.tick(); await sleep(0); await sleep(0); } };
    await run(20000);
    const bdc = calls7.filter((c) => c.a === 0x40).map((c) => c.t);
    const steps = bdc.slice(1).map((t, i) => t - bdc[i]);
    ok(steps.length >= 3 && steps[0] >= 2000 && steps[1] >= 4000 && steps[2] >= 8000, 'busy (7F 22 21): the unit waits 2, 4, 8 s (' + steps.join(', ') + ' ms)');
    reply7 = (a, d) => [0x62, d >> 8, d & 0xFF, 7];
    const n0 = calls7.length;
    await run(30000);
    const after = calls7.slice(n0).filter((c) => c.a === 0x40).map((c) => c.t);
    ok(after.length >= 10 && after.slice(1).every((t, i) => t - after[i] >= 1000 && t - after[i] <= 1250), 'a positive reply: back to one read a second (' + after.length + ' in 30 s)');
    reply7 = (a, d) => (d === 0xD57E ? [0x7F, 0x22, 0x31] : [0x62, d >> 8, d & 0xFF, 7]);
    await run(120000);
    const n1 = calls7.length;
    await run(30000);
    ok(D7.status().BDC.dropped.join() === 'D57E' && !calls7.slice(n1).some((c) => c.d === 0xD57E) && calls7.slice(n1).some((c) => c.d === 0xE3B8), 'an identifier refused 3 times "out of range" is not asked again; the others go on');
    D7.stop();
    let threw7 = false;
    try { D7.read(0x40, 0xD5E6); } catch (e) { threw7 = true; }
    ok(threw7 && !calls7.some((c) => c.d === 0xD5E6), 'read() of an identifier off the list throws before anything is queued');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('7. on the bench: the real app, built by the kit, in the stubbed head unit (port ' + PORT + ')');
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
        await req('POST', '/click', { id: 'RECSET' });
        await sleep(300);
        let p = await req('GET', '/probe');
        ok(/^Набір для запису: HB$/.test(p.native.RECSET.cells.Text1stRow) && /^Почати запис HB$/.test(p.native.REC.cells.Text1stRow), 'one press on RECSET: "Набір для запису: HB", "Почати запис HB"');
        await req('POST', '/click', { id: 'REC' });
        ok(await until(() => probeLines().some((l) => /^probe: rec: start session=\d{8}-\d{6} sets=S18 /.test(l))), 'a press on REC: the recording of S18 starts');
        ok(await until(() => probeLines().some((l) => /^probe: sets on=S18 changed=\+S18 /.test(l))) && probeLines().some((l) => new RegExp('^probe: rec: ' + HB.length + ' fields routed to the recorder$').test(l)), 'S18 switched on with it, its ' + HB.length + ' fields routed');
        const nIf = budget.interfaces;
        ok(await until(() => probeLines().filter((l) => /^probe: watch /.test(l)).length >= nIf, 30000), 'its ' + nIf + ' interfaces are subscribed: ' + probeLines().filter((l) => /^probe: watch /.test(l)).length);
        const feeds = [];
        for (let i = 0; i < 40; i++) {
            feeds.push({ iface: FIELDS.I.RecogLight, field: 'mainBeamAssistantDataObject1', value: objEvent(1, Object.assign({}, o3, { dist: 100 - i })) });
            feeds.push({ iface: FIELDS.I.RecogLight, field: 'MainBeamAssistantDataObject15', value: objEvent(15, null) });
            feeds.push({ iface: FIELDS.I.RecogLight, field: 'controlHighBeamAssistant', value: { controlHighBeam: i < 20 ? 1 : 0, statusCameraCalibration: 1, numberVehicles: 1, numberRoadSigns: 0, numberPedestrians: 0, reasonSwitchOffHighBeam: i < 20 ? 0 : 1,
                cameraCalibrationOffsetHorizontal: 128, cameraCalibrationOffsetVertical: 127, qualifierDataControlHighBeamAssistant: 0, qualifierExtendedControlHighBeamAsstistant: 0, syncSignal: i } });
        }
        for (let i = 0; i < feeds.length; i += 20) await Promise.all(feeds.slice(i, i + 20).map((fd) => req('POST', '/fake', { feed: fd })));
        await req('POST', '/fake', { feed: { iface: FIELDS.I.Light, field: 'IndicatorSteeringColumn', value: { operationColumnStalks: 0x10 } } });
        await sleep(200);
        await req('POST', '/fake', { feed: { iface: FIELDS.I.Light, field: 'IndicatorSteeringColumn', value: { operationColumnStalks: 0 } } });
        await req('POST', '/fake', { feed: { iface: FIELDS.I.Light, field: 'LampExterior2', value: { cRCControlLampExterior2: 1, aliveControlLampExterior2: 2, controlFunctionMainBeam: 'ON_MAB_MODE_1' } } });
        // the diagnostic reads: off until their checkbox; then only while the recorded speed says the car stands
        ok(!probeLines().some((l) => /^probe: diag/.test(l)), 'no diagnostic read while its checkbox is off (the default)');
        await req('POST', '/fake', { feed: { iface: 'de.bmw.infotainment.vehicle.Vehicle2', field: 'statusCarSpeed2', value: { speedVehicleCentreOfGravity: 0 } } });
        await req('POST', '/click', { id: 'SET_HBDIAG' });
        ok(await until(() => probeLines().some((l) => /^probe: diag: (start|no link)/.test(l)), 10000), 'its checkbox on: the reads start (or say the bench has no link): ' + (probeLines().filter((l) => /^probe: diag/.test(l))[0] || ''));
        await sleep(1500);
        await req('POST', '/click', { id: 'SET_HBDIAG' });
        await req('POST', '/click', { id: 'MARK' });
        await sleep(1200);
        p = await req('GET', '/probe');
        ok(/^Запис HB іде, \d+:\d\d\. Натисніть: стоп$/.test(p.native.REC.cells.Text1stRow), 'while it records: ' + p.native.REC.cells.Text1stRow);
        await req('POST', '/click', { id: 'REC' });
        ok(await until(() => probeLines().some((l) => /^probe: rec: stop session=/.test(l))), 'a second press: stopped');
        await sleep(1500);
        const rb = readRec(recDir());
        const idOf = (tag) => (rb.lines.find((l) => new RegExp('^#f,\\d+,' + tag + ',').test(l)) || '').split(',')[1];
        const linesOf = (tag) => rb.lines.filter((l) => /^\d/.test(l) && l.split(',')[1] === idOf(tag));
        const foldsOf = (tag) => rb.lines.filter((l) => /^#s,/.test(l) && l.split(',')[2] === idOf(tag)).reduce((n, l) => n + Number(l.split(',')[3]), 0);
        ok(linesOf('hb-obj1').length === 40 && linesOf('hb-control').length === 40, 'the 40 moving objects and the 40 verdicts are in the file, one line each');
        ok(linesOf('hb-obj15').length + foldsOf('hb-obj15') === 40 && foldsOf('hb-obj15') > 30, 'the empty slot 15 (capital M): ' + linesOf('hb-obj15').length + ' line(s), ' + foldsOf('hb-obj15') + ' folded');
        ok(linesOf('stalk').length >= 2 && linesOf('hb-lamps').length === 1, 'the stalk and the lamps are in the file');
        ok(probeLines().some((l) => /^probe: first P27 hb-obj1 t=[0-9.]+: XPositionObject1=120 /.test(l)) && probeLines().some((l) => /^probe: first P27 hb-control t=[0-9.]+: controlHighBeam=1 /.test(l)), 'the log has each source\'s first value with its raw members ("does the car send it")');
        ok(probeLines().some((l) => /^probe: P13 stalk #\d+ .*stalks=16\(0x10\)/.test(l)) && probeLines().some((l) => /^probe: P27 hb-lamps #1 .*mainBeam=ON_MAB_MODE_1/.test(l)), 'the stalk and the lamps logged as they changed');
        const py = spawnSync('python3', ['-I', ANALYSE, recDir(), '-o', path.join(tmp, 'hb-out')], { encoding: 'utf8', timeout: 120000 });
        ok(py.status === 0 && /1 recording\(s\); lights present, verdict present/.test(py.stdout), 'tools/car/hb_analyse.py reads it: ' + (py.stdout || py.stderr).trim().split('\n').pop().replace(/ -> .*$/, ''));
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
