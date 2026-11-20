'use strict';
/**
 * test-signal-rv.js - round "Road View", package TS: the RV recorder (set S19 "RV", tools/road-view/app/rv_recorder) and its budget.
 *
 *   BENCH_PORT=8905 node bench/test-signal-rv.js     (RV_SIM_MIN: simulated minutes per budget case, default 5; RV_BUDGET_OUT: a file
 *                                                     to write the budget to, JSON; RV_SKIP_BENCH=1: parts 1-3 only)
 *
 *   1. the declarations: every source read only (b / s / rs, a NON-ZERO getter for every r, an event for every b; never w, never a
 *      method, never settingTrafficlightBraking / settingTrafficlightDriveOff, no navigation interface), app.json "signals" exactly
 *      what the table needs and check_signals.py passing, every summary path and skip name in the catalogue's types, the interface
 *      count (this app's, Signal Probe's unchanged 99, and the 105 Signal Probe would declare with the set inside it), outside the
 *      Store's glob, the shared recorder and formatter, Node 8 syntax, no setter or method call in the source
 *   2. the engine on a fake clock with the real recorder: nothing subscribed before the first recording, every interface then once;
 *      the first message of every source one log line with its raw members and never a skipped one; "full" sources every message,
 *      "list" sources the first whole, one summary a second, the next whole after a mark; marks from the menu and from the TRIP edge
 *      (255 and a held button are not presses; off with the setting); change lines; a second recording asks each rs getter once;
 *      nothing recorded between recordings; a hostile value is one warning, never a throw
 *   3. the budget: simulated town drives at plausible rates with values from the catalogue's types (every float moving; in the worst
 *      case every integer too): bytes a second on disk, minutes in the 15 MB quota, CPU a second
 *   4. on the bench (its own tree in a temporary folder, the app outside apps/): the app built by the kit starts idle, a press
 *      records S19, injected events land in the file, a TRIP press is a mark, the log has the first and change lines, the converter
 *      reads the file, the app never exits
 * Mac only, Node 18 or newer. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APPDIR = path.join(ROOT, 'tools', 'road-view', 'app', 'rv_recorder');
const CATALOGUE = path.join(ROOT, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json');
const CHECK = path.join(ROOT, 'tools', 'signals', 'check_signals.py');
const CONVERT = path.join(ROOT, 'tools', 'car', 'rec_convert.py');
const RVF = require(path.join(APPDIR, 'rv_fields.js'));
const RV = require(path.join(APPDIR, 'rv.js'));
const { counts } = require(path.join(ROOT, 'tools', 'road-view', 'rv_manifest.js'));
const PROBE_FIELDS = require(path.join(ROOT, 'apps', 'signal_probe', 'fields.js'));
const { Recorder } = require(path.join(ROOT, 'shared', 'signal_recorder.js'));
const FMT = require(path.join(ROOT, 'shared', 'signal_format.js'));
const PORT = Number(process.env.BENCH_PORT) || 8905;
const SIM_MIN = Number(process.env.RV_SIM_MIN) || 5;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-rv-'));

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const src = (tag) => RVF.TABLE.find((f) => f.tag === tag);

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

// ---- the catalogue: types, and values made from them (as bench/test-signal-acc.js) ------------------------------------------------
const cat = fs.existsSync(CATALOGUE) ? readJson(CATALOGUE) : null;
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
    if (t.type === 'array') { const a = []; if (depth <= 7) for (let i = 0; i < n; i++) a.push(synth(t.dataRef || t.elementDataRef, c, depth + 1, n)); return a; }
    if (t.type === 'map') return {};
    const o = {};
    if (depth > 7) return o;
    allMembers(t).forEach((m) => {
        if (!m.dimension) { o[m.name] = synth(m.dataRef, c, depth + 1, n); return; }
        const a = []; for (let i = 0; i < Math.min(n, m.arrayMaxLength || n); i++) a.push(synth(m.dataRef, c, depth + 1, n)); o[m.name] = a;
    });
    return o;
}
function valueOf(f, seed, n) {
    const c = { i: seed || 1 };
    if (f.flags === 'b') {
        const v = {};
        cat.interfaces[f.iface].events[f.field].outputs.forEach((o) => {
            if (!o.dimension) { v[o.name] = synth(o.dataRef, c, 1, n); return; }
            const a = []; for (let i = 0; i < Math.min(n, o.arrayMaxLength || n); i++) a.push(synth(o.dataRef, c, 1, n)); v[o.name] = a;
        });
        return v;
    }
    return synth(cat.interfaces[f.iface].fields[f.field].dataRef, c, 0, n);
}
function move(v, k, all) {
    if (!v || typeof v !== 'object') return;
    Object.keys(v).forEach((key) => {
        const x = v[key];
        if (typeof x === 'number') v[key] = /alive|aliv|counter/i.test(key) ? (x + 1) % 15 : Number.isInteger(x) ? (all ? (x + 1) % 250 : x + (k % 7 === 0 ? 1 : 0)) : x + (((k * 7919 + key.length * 31) % 200) - 100) / 1000;
        else if (x && typeof x === 'object') move(x, k + 1, all);
    });
}
/** Does a summary path ("a.b[].c") exist in the source's catalogue type? */
function pathOk(f, p) {
    let refs = null;
    if (f.flags === 'b') refs = cat.interfaces[f.iface].events[f.field].outputs.map((o) => ({ name: o.name, ref: o.dataRef, arr: !!o.dimension }));
    else { const t = DT[base(cat.interfaces[f.iface].fields[f.field].dataRef)]; refs = allMembers(t).map((m) => ({ name: m.name, ref: m.dataRef, arr: !!m.dimension })); }
    const parts = p.split('.');
    for (let i = 0; i < parts.length; i++) {
        const many = /\[\]$/.test(parts[i]), key = many ? parts[i].slice(0, -2) : parts[i];
        const m = refs.find((x) => x.name === key);
        if (!m) return false;
        const t = DT[base(m.ref)];
        if (many && !m.arr && !(t && t.type === 'array')) return false;
        if (i === parts.length - 1) return true;
        const inner = t && t.type === 'array' ? DT[base(t.dataRef || t.elementDataRef)] : t;
        if (!inner || !inner.members) return false;
        refs = allMembers(inner).map((x) => ({ name: x.name, ref: x.dataRef, arr: !!x.dimension }));
    }
    return true;
}
/** Every member name anywhere in a source's type. */
function namesOf(f) {
    const out = new Set();
    const walk = (ref, d) => { const t = DT[base(ref)]; if (!t || d > 9) return; if (t.type === 'array') return walk(t.dataRef || t.elementDataRef, d + 1); allMembers(t).forEach((m) => { out.add(m.name); walk(m.dataRef, d + 1); }); };
    if (f.flags === 'b') cat.interfaces[f.iface].events[f.field].outputs.forEach((o) => { out.add(o.name); walk(o.dataRef, 1); });
    else walk(cat.interfaces[f.iface].fields[f.field].dataRef, 0);
    return out;
}
function textMembers(f) {
    const out = [];
    const walk = (ref, d, p) => { const x = base(ref), t = DT[x]; if (/^Utf|^ByteBuffer/.test(x)) { out.push(p); return; } if (!t || d > 9) return; if (t.type === 'array') return walk(t.dataRef || t.elementDataRef, d + 1, p); allMembers(t).forEach((m) => walk(m.dataRef, d + 1, p + '.' + m.name)); };
    if (f.flags === 'b') cat.interfaces[f.iface].events[f.field].outputs.forEach((o) => walk(o.dataRef, 1, o.name));
    else walk(cat.interfaces[f.iface].fields[f.field].dataRef, 0, '');
    return out;
}

// ---- an engine on a fake clock, with fake signals ----------------------------------------------------------------------------------
function harness(dir, cfg) {
    let now = 0;
    const lines = [];
    const log = { info: (s) => lines.push(s), warn: (s) => lines.push('WARN ' + s) };
    const watched = [], gets = [];
    const signals = { watch: (iface, inst, handlers) => { watched.push({ iface, inst, fields: Object.keys(handlers) }); return Promise.resolve({ available: true, proxy: { iface }, error: null }); },
        get: (proxy, field) => { gets.push(proxy.iface + '.' + field); return Promise.resolve(null); } };
    const rec = new Recorder({ dir, mono: () => now, wall: () => new Date(2026, 10, 21, 9, 0, 0).getTime(), version: 'test', cfg: Object.assign({ quotaMB: 200 }, cfg && cfg.rec) });
    const rv = new RV.RoadView({ log, signals, rec, fmt: FMT, now: () => now, cfg: Object.assign({ hubPauseMs: 0 }, cfg) });
    const st = {}; rv.sources.forEach((s) => { st[s.f.tag] = s; });
    return { rv, rec, lines, watched, gets, feed: (tag, v) => st[tag].handler(v), clock: (t) => { now = t; }, now: () => now };
}

// ---- plausible rates in town (Hz; the first drive replaces them): "quiet" and "busy" ------------------------------------------------
const RATES = {
    quiet: { tl: 6, 'cam-signs': 2, 'cam-legacy2': 2, 'cam-legacy': 2, tsr: 2, 'hud-data': 5, 'hud-data2': 5, 'warn-brake': 1, 'fas-ext': 0.1, foresight2: 1, foresight: 1,
        'sli-text': 0.1, 'next-limit': 0.1, 'no-passing': 0.1, 'lca-input': 10, blockage: 1, 'car-speed2': 10, 'gearbox-status': 10, 'brake-light': 10, indicate: 1, stalk: 10,
        'set-stop-sign': 0.05, 'set-give-way': 0.05, 'give-way-status': 0.05, 'set-wrong-way': 0.05, list: 10, 'cam-objects': 15, 'cam2-objects': 15, 'road-segment': 10, 'suaar-objects': 10 },
};
RATES.busy = Object.assign({}, RATES.quiet, { tl: 45, 'cam-signs': 15, 'cam-legacy2': 15, 'cam-legacy': 15, 'lca-input': 25, blockage: 10, list: 25, 'cam-objects': 30, 'cam2-objects': 30, 'road-segment': 25, 'suaar-objects': 25 });
const rateOf = (f, r) => (r[f.tag] !== undefined ? r[f.tag] : f.kind === 'list' ? r.list : 1);

async function main() {
    // ---------------------------------------------------------------------------------------------------------------
    console.log('1. the declarations');
    const app = readJson(path.join(APPDIR, 'app.json'));
    ok(RVF.TABLE.every((f) => /^(b|s|rs)$/.test(f.flags)), 'every one of the ' + RVF.TABLE.length + ' sources is read only (b / s / rs)');
    ok(JSON.stringify(app.signals) === JSON.stringify(RVF.manifestSignals()), 'app.json "signals" is exactly what rv_fields.js needs');
    const flags = [];
    Object.keys(app.signals).forEach((i) => Object.keys(app.signals[i]).forEach((k) => { if (k[0] !== '_') flags.push(app.signals[i][k]); }));
    ok(flags.every((x) => x === 's' || x === 'rs') && !Object.keys(app.signals).some((i) => app.signals[i]._methods), 'no "w", no "r" without "s", no method in the manifest');
    ok(!/settingTrafficlightBraking|settingTrafficlightDriveOff|iDriveFASExtended"|navigation\.|DataProfile|trafficLightNavGraph/.test(JSON.stringify(app.signals).replace(/statusIDriveFASExtended/g, '')),
        'never the traffic-light settings (rws), never FASuS iDriveFASExtended (the setter), never a navigation interface');
    if (!cat) console.log('  skip: the catalogue is not here (the getter ids, the types)');
    else {
        const bad = RVF.TABLE.filter((f) => {
            const ci = cat.interfaces[f.iface];
            if (!ci) return true;
            if (f.flags === 'b') return !(ci.events || {})[f.field];
            const c = ci.fields[f.field];
            if (!c || !c.notifier) return true;
            return f.flags === 'rs' && !(c.getter && c.getter.id > 0);
        });
        ok(!bad.length, 'every event is in the catalogue; every field has a notifier, every "rs" a NON-ZERO getter id' + (bad.length ? ': ' + bad.map((f) => f.tag).join(', ') : ''));
        const sOnly = RVF.TABLE.filter((f) => f.flags === 's' && cat.interfaces[f.iface].fields[f.field].getter && cat.interfaces[f.iface].fields[f.field].getter.id > 0);
        ok(!sOnly.length, 'an "s" source has no usable getter (else it would be "rs"): ' + (sOnly.map((f) => f.tag).join(', ') || 'none'));
        const sets = RVF.TABLE.filter((f) => /SettingsDriverAssistance/.test(f.iface));
        ok(sets.length === 4 && sets.every((f) => f.flags === 's'), 'the four assistance settings TR named are read by their notifier only (s)');
        const paths = [];
        RVF.TABLE.forEach((f) => { const s = f.sum || {}; ['count', 'ids'].forEach((k) => { if (s[k]) paths.push([f, s[k]]); }); ['cls', 'rng', 'len'].forEach((k) => Object.keys(s[k] || {}).forEach((n) => paths.push([f, s[k][n]]))); });
        (function logs() { RVF.TABLE.forEach((f) => { if (Array.isArray(f.log)) f.log.forEach((p) => paths.push([f, p])); }); })();
        const missing = paths.filter((x) => !pathOk(x[0], x[1]));
        ok(paths.length > 40 && !missing.length, 'every summary and change-line path (' + paths.length + ') is a member of its type' + (missing.length ? ': ' + missing.map((x) => x[0].tag + ' ' + x[1]).join(', ') : ''));
        const skips = RVF.TABLE.filter((f) => f.skip).filter((f) => f.skip.some((k) => !namesOf(f).has(k)));
        ok(!skips.length && src('ego-position').skip.join() === 'posX,posY,heading' && src('cam-signs').skip.join() === 'location', 'the skipped members exist (the car\'s own position and heading, the sign location floats)');
        const texts = RVF.TABLE.filter((f) => textMembers(f).length);
        ok(!texts.length, 'no source type has a text member (the recorder would write it empty anyway): ' + (texts.map((f) => f.tag).join(', ') || 'none'));
        const py = spawnSync('python3', [CHECK, CATALOGUE, path.join(APPDIR, 'app.json')], { encoding: 'utf8' });
        ok(py.status === 0 && /all declarations pass/.test(py.stdout), 'tools/signals/check_signals.py: all declarations pass');
        const tlv = cat.interfaces[src('tl').iface].events.RecognitionTrafficLightCamera.outputs.map((o) => o.name);
        ok(tlv.length === 9 && src('tl').kind === 'full' && !src('tl').skip, 'the traffic light: all nine members, every message, raw');
        const tsr = cat.interfaces[src('tsr').iface].events.TrafficSignRecognition.outputs.map((o) => o.name);
        ok(tsr.length === 16 && src('tsr').log.indexOf('recognitionNoPassing') >= 0 && src('tsr').log.indexOf('countryCodingTrafficSign') >= 0, 'the sign function: all 16 members recorded, no overtaking and the country coding logged on change');
    }
    const c = counts();
    ok(c.rvRecorder === RVF.interfaces().length && c.rvRecorder === 22 && Object.keys(app.signals).length === 22, 'the RV recorder declares 22 interfaces');
    ok(c.signalProbe === 99 && PROBE_FIELDS.interfaces().length === 99, 'Signal Probe is unchanged: 99 interfaces');
    ok(c.newToSignalProbe === 6 && c.signalProbeIfInside === 105 && c.signalProbeIfInside > 99, 'inside Signal Probe the set would need 6 more: 105 > 99, so it is a separate recorder (the brief)');
    const repo = readJson(path.join(ROOT, 'mgu-repo.json'));
    ok(repo.apps.path === 'apps/*' && path.relative(path.join(ROOT, 'apps'), APPDIR).indexOf('..') === 0 && !fs.existsSync(path.join(ROOT, 'apps', 'rv_recorder')), 'outside the Store\'s glob (apps/*): not in the Store until the owner says');
    const others = fs.readdirSync(path.join(ROOT, 'apps')).map((a) => { try { return readJson(path.join(ROOT, 'apps', a, 'app.json')); } catch (e) { return null; } }).filter(Boolean);
    ok(app.id === 'rv_recorder' && /^OA[A-Z0-9]{2}$/.test(app.loggingId) && others.every((a) => a.loggingId !== app.loggingId && a.id !== app.id), 'its own id and logging id (' + app.loggingId + ')');
    ok(JSON.stringify(app.shared) === '["lang.js","signal_recorder.js","signal_format.js"]', 'it packs Signal Probe\'s recorder and formatter from shared/ (no copy)');
    ok(app.config.recorder.quotaMB === 15 && !app.maxDiskUsage && app.settings.find((s) => s.key === 'tripMark').default === true, 'quota 15 MB (the default disk limit 20 MiB), TRIP = mark on by default');
    fs.readdirSync(APPDIR).filter((f) => /\.js$/.test(f)).concat(['../../rv_manifest.js']).forEach((f) => {
        const raw = fs.readFileSync(path.join(APPDIR, f), 'utf8'), code = strip(raw);
        ok(!/setValue|callMethod|signals\.set\b|signals\.call\b|signals\.proxy\b|\.proxy\(|\.send\(|child_process/.test(code), f + ': no setter, no method call, no child process');
        ok(!/cluster_render|cluster-render|ctx\.display|ctx\.canvas|\.layer\(/.test(code), f + ': draws nothing');
        ok(!/\?\.|\?\?|catch\s*\{|\.\.\.\w|\bBigInt\(|\d+n\b|\.flat\(|\.flatMap\(|Object\.fromEntries|Object\.entries|Object\.values|\.padEnd|\.padStart|\bfor await\b/.test(code), f + ': only what Node 8.16 has');
        ok(!/\/Users\/|\/home\//.test(raw), f + ': no home-directory path');
    });

    // ---------------------------------------------------------------------------------------------------------------
    console.log('2. the engine (a fake clock, the real recorder)');
    {
        const dir = path.join(tmp, 'e1');
        const H = harness(dir);
        ok(H.watched.length === 0 && !H.rv.listening, 'nothing subscribed before the first recording');
        H.feed('tl', { trafficLightID: 1 });
        ok(H.lines.length === 0, 'a value before any recording is ignored');
        ok(H.rv.begin() && H.rec.on, 'a recording starts (S19)');
        await H.rv.idle();
        ok(H.watched.length === 22 && H.watched.every((w) => w.inst === '1') && new Set(H.watched.map((w) => w.iface)).size === 22, 'then every interface once (22), instance 1');
        ok(H.watched.reduce((a, w) => a + w.fields.length, 0) === RVF.TABLE.length, 'with every source\'s handler (' + RVF.TABLE.length + ')');
        const tl = { trafficLightID: 7, trafficLightPositionX: 180, trafficLightPositionY: 128, trafficLightPositionZ: 40, trafficLightStatus: 1, trafficLightArrow: 0, trafficLightIndicateDirection: 0, trafficLightColor: 1, qualityRecognitionTrafficLight: 9 };
        for (let i = 0; i < 25; i++) { H.clock(100 + i * 40); H.feed('tl', Object.assign({}, tl, { trafficLightPositionX: 180 - i })); }
        const firsts = H.lines.filter((l) => /^rv: first tl /.test(l));
        ok(firsts.length === 1 && /trafficLightID=7 trafficLightPositionX=180 .*trafficLightColor=1 qualityRecognitionTrafficLight=9$/.test(firsts[0]), 'the first message one log line, every raw member: ' + firsts[0]);
        H.clock(1200);
        H.feed('ego-position', { eventDataQualifier: 'EVENT_DATA_AVAILABLE', stdTimestamp: { seconds: 5, nanoseconds: 6, sync_state: 'SYNC' }, newPosition: { posX: 1234, posY: 567, heading: 1.25, egoLaneId: 3 } });
        const eg = H.lines.find((l) => /^rv: first ego-position /.test(l)) || '';
        ok(/egoLaneId=3/.test(eg) && !/posX|posY|heading|1234|567/.test(eg), 'the car\'s own position and heading never logged: ' + eg);
        const sign = { eventDataQualifier: 'EVENT_DATA_AVAILABLE', trafficSignRecognition: { numberSigns: 1 }, trafficSign: [{ value: 40, type: 'SPEED_LIMIT', location: { x: 12.5, y: -3.25, z: 2 } }] };
        H.feed('cam-signs', sign);
        ok(!/location|12\.5|-3\.25/.test(H.lines.find((l) => /^rv: first cam-signs /.test(l)) || 'x'), 'the sign location floats never logged');
        // a list source: whole, then one summary a second, whole again after a mark
        const seg = (k) => ({ eventDataQualifier: 'EVENT_DATA_AVAILABLE', data: { egoVehicleLaneSegmentIndex: k % 3, laneSegments: [{ laneType: 'NORMAL', roadType: 'URBAN', laneId: 1 }, { laneType: 'ONCOMING', roadType: 'URBAN', laneId: 2 }], laneBoundaries: [] } });
        for (let i = 0; i < 20; i++) { H.clock(1300 + i * 40); H.feed('road-segment', seg(i)); }
        H.clock(2000); H.rv.tick();
        H.clock(2100); H.rv.mark('menu');
        H.clock(2150); H.feed('road-segment', seg(1)); H.feed('road-segment', seg(2));
        // TRIP: 0 -> 0x40 is a press; held, 255 and a repeat are not
        [0, 0x40, 0x40, 0, 255, 0x40, 0].forEach((b, i) => { H.clock(2300 + i * 50); H.feed('stalk', { operationColumnStalks: b }); });
        ok(H.rv.markN === 2 && H.lines.filter((l) => /^rv: mark M\d+ .* via=trip$/.test(l)).length === 1, 'one TRIP press is one mark (held, 255 and the edge after 255 are not)');
        // change lines
        const tsr = (np, cl) => ({ presentClassLimitSpeed: cl, recognitionNoPassing: np, countryCodingTrafficSign: 2, displaySupplementalSign: 0, statusStreetTyp: 1 });
        H.clock(2700); H.feed('tsr', tsr(0, 8)); H.feed('tsr', tsr(0, 8)); H.clock(2800); H.feed('tsr', tsr(1, 8)); H.clock(2900); H.feed('tsr', tsr(1, 10));
        const ch = H.lines.filter((l) => /^rv: change tsr /.test(l));
        ok(ch.length === 2 && /recognitionNoPassing=1/.test(ch[0]) && /presentClassLimitSpeed=10/.test(ch[1]) && /countryCodingTrafficSign=2/.test(ch[0]), 'a change of no overtaking or of the limit is one log line each (the same value again: none): ' + ch.join(' | '));
        H.clock(3000); H.rv.tick();
        // a hostile value: a throwing getter
        const evil = {}; Object.defineProperty(evil, 'trafficLightID', { enumerable: true, get() { throw new Error('boom'); } });
        let threw = false;
        try { H.feed('tl', evil); } catch (e) { threw = true; }
        ok(!threw, 'a hostile value never throws out of the handler');
        H.rv.end();
        await drain(H.rec);
        H.clock(4000); H.feed('tl', tl);
        const r = readRec(dir);
        ok(/^#rec,1,test,\d{8}-\d{6},1,[^,]+,\d+,S19$/.test(r.lines[0]), 'the file\'s header names S19: ' + r.lines[0]);
        const idOf = (tag) => (r.lines.find((l) => new RegExp('^#f,\\d+,' + tag.replace(/[~]/g, '\\$&') + ',').test(l)) || '').split(',')[1];
        const rowsOf = (tag) => { const id = idOf(tag); return r.lines.filter((l) => /^\d/.test(l) && l.split(',')[1] === id); };
        ok(rowsOf('tl').length === 25 && /errors=1/.test(r.lines[r.lines.length - 1]), 'the traffic light: every message (25; the hostile one a counted error, the late one after the stop not recorded)');
        ok(rowsOf('road-segment').length === 2 && rowsOf('road-segment~1s').length === 2, 'a list source: the first message whole, the one after the mark whole, the rest in a summary a second (20, then 1)');
        const hs = (r.lines.find((l) => /^#f,\d+,road-segment~1s,/.test(l)) || '').split(',');
        const row = rowsOf('road-segment~1s')[0].split(',');
        const val = (col) => row[5 + hs.indexOf(col) - 4];
        ok(val('msgs') === '20' && val('segmentsLen') === '2' && val('egoIdxMin') === '0' && val('egoIdxMax') === '2', 'the summary: 20 messages, 2 segments, the ego index 0..2');
        ok(val('cls_lane.n') === '2' && r.lines.some((l) => l === '#n,' + val('cls_lane.v0').slice(1) + ',NORMAL'), 'the lane types seen, by name');
        const eh = r.lines.find((l) => /^#f,\d+,ego-position,/.test(l)) || '';
        ok(eh && !/posX|posY|heading/.test(eh) && /egoLaneId/.test(eh), 'the recording leaves the car\'s own position and heading out too');
        ok(!/location/.test(r.lines.find((l) => /^#f,\d+,cam-signs,/.test(l)) || 'location'), 'and the sign location floats');
        ok(r.lines.filter((l) => /^#m,/.test(l)).length === 2 && /^#end,/.test(r.lines[r.lines.length - 1]), 'two marks in the file, and its last line');
        const py = spawnSync('python3', [CONVERT, dir, '-o', path.join(tmp, 'conv1')], { encoding: 'utf8' });
        ok(py.status === 0, 'tools/car/rec_convert.py reads it');
        // a second recording: each rs getter once
        H.gets.length = 0;
        H.clock(5000); ok(H.rv.begin(), 'a second recording');
        await sleep(20);
        const rsN = RVF.TABLE.filter((f) => f.flags === 'rs').length;
        ok(H.gets.length === rsN && H.watched.length === 22, 'it asks each "rs" getter once (' + rsN + '), no new subscription');
        H.rv.end(); await drain(H.rec);
        const off = harness(path.join(tmp, 'e2'), { tripMark: false });
        off.rv.begin(); await off.rv.idle();
        [0, 0x40, 0].forEach((b) => off.feed('stalk', { operationColumnStalks: b }));
        ok(off.rv.markN === 0, 'with "TRIP = позначка" off, TRIP is no mark');
        off.rv.end(); await drain(off.rec);
        ok(RV.pick({ a: [{ b: 1 }, { b: 2 }], c: { d: 5 } }, 'a[].b').join() === '1,2' && RV.pick({ c: { d: 5 } }, 'c.d')[0] === 5 && RV.pick(null, 'a.b').length === 0, 'pick(): lists and members, nothing from nothing');
    }

    // ---------------------------------------------------------------------------------------------------------------
    console.log('3. the budget: ' + SIM_MIN + ' simulated minutes per case');
    const budget = { minutes: SIM_MIN, cases: [] };
    if (!cat) console.log('  skip: no catalogue');
    else {
        const sim = async (label, rates, signs, objects, all) => {
            const dir = path.join(tmp, 'b-' + label);
            const H = harness(dir);
            H.rv.begin(); await H.rv.idle();
            const plan = RVF.TABLE.map((f, k) => {
                const n = /sign/.test(f.tag) ? signs : f.kind === 'list' ? objects : 4;
                const v = valueOf(f, k + 1, n);
                if (f.tag === 'stalk') v.operationColumnStalks = 0;
                if (/cam-signs|cam-legacy2/.test(f.tag)) v.trafficSign = v.trafficSign.concat(new Array(20 - v.trafficSign.length).fill(null).map(() => valueOf(f, 1, 0).trafficSign[0] || {}));
                return { f, hz: rateOf(f, rates), k, v, n: 0 };
            });
            const cpu0 = process.cpuUsage();
            let sent = 0;
            for (let s = 0; s < SIM_MIN * 60; s++) {
                const ev = [];
                plan.forEach((p) => { const k = Math.floor(p.hz * (s + 1)) - Math.floor(p.hz * s); for (let i = 0; i < k; i++) ev.push([s * 1000 + Math.floor((i + p.k / plan.length) * 1000 / Math.max(1, k)), p]); });
                ev.sort((a, b) => a[0] - b[0]);
                for (let e = 0; e < ev.length; e++) { const p = ev[e][1]; H.clock(ev[e][0]); p.n++; if (p.f.tag !== 'stalk') move(p.v, p.n, all); H.feed(p.f.tag, p.v); sent++; }
                H.clock(s * 1000 + 999); H.rv.tick();
                if (s % 60 === 30) H.rv.mark('menu');
                if (s % 2 === 1) await catchUp(H.rec);
            }
            const cpu = process.cpuUsage(cpu0);
            H.rv.end(); await drain(H.rec, 60000);
            const rr = readRec(dir);
            const disk = rr.files.reduce((a, n) => a + fs.statSync(path.join(dir, n)).size, 0);
            const secs = SIM_MIN * 60, st = H.rec.status();
            const cs = { label, messagesPerS: Math.round(sent / secs), samplesPerS: Math.round(st.samples / secs), rawBytesPerS: Math.round(rr.text.length / secs), gzipBytesPerS: Math.round(disk / secs),
                kbPerMinute: Math.round(disk / secs * 60 / 1024), minutesIn15MB: +(15 * 1048576 / (disk / secs) / 60).toFixed(1), cpuMsPerS: +(((cpu.user + cpu.system) / 1000) / secs).toFixed(2), dropped: st.dropped, errors: st.errors };
            budget.cases.push(cs);
            console.log('  ' + JSON.stringify(cs));
            return cs;
        };
        const q = await sim('town-quiet', RATES.quiet, 2, 4);
        const b = await sim('town-busy', RATES.busy, 4, 8);
        const w = await sim('town-worst', RATES.busy, 8, 16, true);
        ok([q, b, w].every((x) => x.dropped === 0 && x.errors === 0), 'no sample dropped, no error');
        ok(q.minutesIn15MB >= 30, 'a quiet town drive: ' + q.gzipBytesPerS + ' B/s on disk (' + q.kbPerMinute + ' KB a minute), ' + q.minutesIn15MB + ' minutes in the 15 MB quota');
        ok(b.minutesIn15MB >= 12, 'a busy one (every camera stream at 15-45 Hz, every value moving): ' + b.gzipBytesPerS + ' B/s, ' + b.minutesIn15MB + ' minutes in 15 MB');
        ok(w.minutesIn15MB >= 5, 'the worst case (busy, 8 signs in each sign list, every integer changing every message): ' + w.gzipBytesPerS + ' B/s, ' + w.minutesIn15MB + ' minutes in 15 MB');
        ok(b.cpuMsPerS < 60, 'CPU on the Mac, busy: ' + b.cpuMsPerS + ' ms a second (the head unit about 5-6 x that)');
        if (process.env.RV_BUDGET_OUT) fs.writeFileSync(process.env.RV_BUDGET_OUT, JSON.stringify(budget, null, 1));
    }

    // ---------------------------------------------------------------------------------------------------------------
    if (process.env.RV_SKIP_BENCH) { console.log('4. skipped (RV_SKIP_BENCH)'); return finish(); }
    console.log('4. on the bench: the app built by the kit, its own tree, port ' + PORT);
    const work = path.join(tmp, 'tree'), root = path.join(work, 'root'), dataDir = path.join(work, 'data');
    fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(dataDir);
    const copy = (s, d) => { fs.mkdirSync(d); fs.readdirSync(s).forEach((n) => { if (n === '.data') return; const a = path.join(s, n), b = path.join(d, n); if (fs.statSync(a).isDirectory()) copy(a, b); else fs.copyFileSync(a, b); }); };
    copy(path.join(ROOT, 'bench'), path.join(root, 'bench'));
    ['shared', 'kit'].forEach((d) => fs.symlinkSync(path.join(ROOT, d), path.join(root, d)));
    fs.mkdirSync(path.join(root, 'apps'));
    fs.symlinkSync(APPDIR, path.join(root, 'apps', 'rv_recorder'));
    const sdk = path.join(root, 'oap-sdk');
    fs.mkdirSync(sdk);
    fs.writeFileSync(path.join(sdk, 'index.js'), "'use strict';\n// BENCH_STUB: stands in for BMW's oap-sdk so kit/tools/build.py runs on the Mac. Never ship this.\nthrow new Error('BENCH_STUB oap-sdk');\n");
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'oap-sdk', version: '0.0.0-bench-stub', main: 'index.js' }) + '\n');
    const baseUrl = 'http://127.0.0.1:' + PORT;
    const req = async (method, url, body) => {
        const rr = await fetch(baseUrl + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        if (rr.status === 200) return rr.json();
        if (rr.status !== 204) throw new Error(method + ' ' + url + ': ' + rr.status);
        return null;
    };
    let out = '', exited = false, server = null;
    const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); while (Date.now() < end) { if (fn()) return true; await sleep(100); } return fn(); };
    const rvLines = () => out.split('\n').filter((l) => /\[rv_recorder\] rv: /.test(l)).map((l) => l.replace(/^.*\[rv_recorder\] /, ''));
    const recDir = () => [path.join(dataDir, 'rv_recorder', 'rec'), path.join(dataDir, 'rec')].find((d) => fs.existsSync(d)) || path.join(dataDir, 'rec');
    const feed = (iface, field, value) => req('POST', '/fake', { feed: { iface, field, value } });
    try {
        server = spawn(process.execPath, [path.join(root, 'bench', 'server.js'), 'rv_recorder'], { cwd: root, env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir }), stdio: ['ignore', 'pipe', 'pipe'] });
        const keep = (dd) => { out += dd; if (/app exited/.test(String(dd))) exited = true; };
        server.stdout.on('data', keep); server.stderr.on('data', keep);
        ok(await until(() => rvLines().some((l) => /^rv: start rv_recorder v=0\.1\.0 set=S19 sources=39 interfaces=22 tripMark=1$/.test(l)), 90000), 'the app builds with the kit and starts: ' + (rvLines()[0] || out.split('\n').slice(-5).join(' / ')));
        await sleep(800);
        let p = await req('GET', '/probe');
        ok(p && /^RV: нічого не підписано/.test((p.native.STATUS || {}).text || '') && !rvLines().some((l) => /^rv: watch /.test(l)), 'idle: nothing subscribed, the status line says so');
        ok(p && /^Почати запис RV$/.test(((p.native.REC || {}).cells || {}).Text1stRow || '') && /^Позначка 1$/.test(((p.native.MARK || {}).cells || {}).Text1stRow || ''), 'the rows: "Почати запис RV", "Позначка 1"');
        await req('POST', '/click', { id: 'REC' });
        ok(await until(() => rvLines().some((l) => /^rv: rec: start session=\d{8}-\d{6} sets=S19 /.test(l) || /rec: start session=\d{8}-\d{6} sets=S19/.test(out))), 'a press: the recording of S19 starts');
        ok(await until(() => rvLines().filter((l) => /^rv: watch .* ok /.test(l)).length === 22, 30000), 'its 22 interfaces are subscribed: ' + rvLines().filter((l) => /^rv: watch /.test(l)).length);
        const TL = src('tl'), EGO = src('ego-position'), TSR = src('tsr'), STALK = src('stalk'), SEG = src('road-segment');
        for (let i = 0; i < 30; i++) await feed(TL.iface, TL.field, { trafficLightID: 5, trafficLightPositionX: 200 - i, trafficLightPositionY: 128, trafficLightPositionZ: 40, trafficLightStatus: 1, trafficLightArrow: 0, trafficLightIndicateDirection: 0, trafficLightColor: i < 20 ? 1 : 3, qualityRecognitionTrafficLight: 10 });
        await feed(EGO.iface, EGO.field, { eventDataQualifier: 'EVENT_DATA_AVAILABLE', newPosition: { posX: 4321, posY: 765, heading: 0.5, egoLaneId: 9 } });
        for (let i = 0; i < 12; i++) await feed(SEG.iface, SEG.field, { eventDataQualifier: 'EVENT_DATA_AVAILABLE', data: { egoVehicleLaneSegmentIndex: 1, laneSegments: [{ laneType: 'NORMAL' }, { laneType: 'NORMAL' }, { laneType: 'ONCOMING' }], laneBoundaries: [] } });
        await feed(TSR.iface, TSR.field, { presentClassLimitSpeed: 10, recognitionNoPassing: 0, countryCodingTrafficSign: 2 });
        await feed(TSR.iface, TSR.field, { presentClassLimitSpeed: 10, recognitionNoPassing: 1, countryCodingTrafficSign: 2 });
        for (const b of [0, 0x40, 0]) await feed(STALK.iface, STALK.field, { operationColumnStalks: b });
        await req('POST', '/click', { id: 'MARK' });
        await sleep(1500);
        p = await req('GET', '/probe');
        ok(/^Запис RV іде, \d+:\d\d\. Натисніть: стоп$/.test(((p.native.REC || {}).cells || {}).Text1stRow || '') && /^Позначка 3$/.test(((p.native.MARK || {}).cells || {}).Text1stRow || ''), 'while it records: ' + ((p.native.REC || {}).cells || {}).Text1stRow + '; the next mark is 3 (TRIP and the row)');
        ok(/^RV: озвалося джерел [5-9] з 39\. Інтерфейсів: \d+ з 22$/.test((p.native.STATUS || {}).text || ''), 'the status line (the bench has a provider for only some interfaces, so "up" is fewer than 22): ' + (p.native.STATUS || {}).text);
        await req('POST', '/click', { id: 'REC' });
        ok(await until(() => rvLines().some((l) => /^rv: stop after /.test(l))), 'a second press: stopped');
        await sleep(1500);
        const L = rvLines();
        ok(L.some((l) => /^rv: first tl t=[\d.]+: trafficLightID=5 trafficLightPositionX=200 /.test(l)), 'the log: the traffic light\'s first message whole');
        ok(L.some((l) => /^rv: change tsr .*recognitionNoPassing=1/.test(l)), 'the log: no overtaking changed');
        ok(L.some((l) => /^rv: mark M1 .* via=trip$/.test(l)) && L.some((l) => /^rv: mark M2 .* via=menu$/.test(l)), 'the log: the TRIP press is mark 1, the row mark 2');
        ok(!/4321|765|posX|heading=0\.5/.test(L.join('\n')), 'the log never has the car\'s own position or heading');
        const rb = readRec(recDir());
        const id = (tag) => (rb.lines.find((l) => new RegExp('^#f,\\d+,' + tag + ',').test(l)) || '').split(',')[1];
        ok(rb.lines.filter((l) => /^\d/.test(l) && l.split(',')[1] === id('tl')).length === 30 && /^#rec,1,0\.1\.0,\d{8}-\d{6},1,[^,]+,\d+,S19$/.test(rb.lines[0]), 'the 30 traffic-light messages are in the file; the header names S19');
        ok(!!id('road-segment~1s') && rb.lines.filter((l) => /^#m,/.test(l)).length === 2 && !/posX|4321/.test(rb.text), 'the road segment summarised, two marks, never the car\'s own position');
        const py = spawnSync('python3', [CONVERT, recDir(), '-o', path.join(tmp, 'conv-bench')], { encoding: 'utf8', timeout: 120000 });
        ok(py.status === 0, 'tools/car/rec_convert.py reads it');
        ok(!/uncaught|FATAL/i.test(out) && !exited, 'the app never exited, nothing uncaught');
        ok(!fs.existsSync(path.join(ROOT, 'dist', 'rv_recorder')), 'the BENCH_STUB build stayed in the temporary tree');
    } catch (e) {
        ok(false, 'bench run: ' + (e && e.stack || e));
    } finally {
        if (server) { server.kill('SIGTERM'); await sleep(300); }
        if (failed) console.log('--- bench log (tail) ---\n' + out.split('\n').slice(-40).join('\n'));
    }
    return finish();
}
function finish() {
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
