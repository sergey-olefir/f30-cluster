'use strict';
/**
 * test-signal-recorder.js - cruise RC: Signal Probe's recording mode (shared/signal_recorder.js, docs/cruise-set-speed-brief.md
 * Phase 0) and the Mac converter (tools/car/rec_convert.py).
 *
 *   node bench/test-signal-recorder.js            (BENCH_PORT, default 8902; REC_SIM_MIN: minutes of the simulated drive, default 20)
 *
 *   1. the source: Node 8 syntax, no write to the car, only fs / zlib / path.
 *   2. every field of the recordable sets (S13, S14, S15) with a value made from the catalogue's own types (a canary in every text
 *      member, a latitude and a longitude added): no text, no coordinate, no end-to-end header reaches a file; every field has its
 *      columns and a line.
 *   3. the payload's own counters and time stamps of the S14 fields go to ctr / pts.
 *   4. a simulated drive at plausible native rates (REC_SIM_MIN minutes), real files: nothing dropped, every seq in order, the files
 *      cut by size, the folder under the quota, bytes per second and CPU per second measured; the converter reads it back and finds
 *      the rates that were sent. Then twice the rates for two minutes.
 *   5. the quota: the oldest files go, the recording goes on.
 *   6. failures: a full disk, a file that cannot be opened, a folder that cannot be made, a broken gzip, a write that never
 *      returns (the queue fills: samples dropped and counted), hostile values: never a throw, the recording stops, the app goes on.
 *   7. inside the probe: the sets' fields (and what S8 / S10 share with S14) go to the recorder, their log lines are quiet, the
 *      mark is in the file.
 *   8. on the bench (the real app built by the kit, in the stubbed head unit): the two menu rows, start, a burst of injected values,
 *      a mark, stop; every injected value is in the files; the app never exits.
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
const { Probe } = require(path.join(APP_DIR, 'probe.js'));
const { Recorder, flatten, fmtNum } = require(path.join(ROOT, 'shared', 'signal_recorder.js'));     // road TS: moved to shared/
const PORT = Number(process.env.BENCH_PORT) || 8902;
const SIM_MIN = Number(process.env.REC_SIM_MIN) || 20;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-rec-'));

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CANARY = /CANARY|Canary/;
const RECORDABLE = ['S13', 'S14', 'S15', 'S17', 'S18'];     // r1120 AC: + S17 (ACC); beam HS: + S18 (HB)
const inSets = (f, ids) => [f.set].concat(f.also || []).some((s) => ids.indexOf(s) >= 0);

/** Every file of a folder, decoded: { files: [names], text (all of them, in order), lines }. */
function readRec(dir) {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^rec-.*\.csv(\.gz)?$/.test(n)).sort() : [];
    const text = files.map((n) => { const b = fs.readFileSync(path.join(dir, n)); return /\.gz$/.test(n) ? zlib.gunzipSync(b).toString() : b.toString(); }).join('');
    return { files, text, lines: text.split('\n').filter((l) => l) };
}
/** The samples of a decoded recording: per tag { seqs, ctrs, pts, t, n } (the field ids are per recording). */
function samplesOf(lines) {
    const tagOf = {}, out = {};
    lines.forEach((l) => {
        const p = l.split(',');
        if (p[0] === '#f') { tagOf[p[1]] = p[2]; return; }
        if (l[0] === '#') return;
        const tag = tagOf[p[1]];
        const o = out[tag] = out[tag] || { seqs: [], ctrs: [], pts: [], t: [], n: 0, vals: [] };
        o.n++; o.t.push(Number(p[0])); o.seqs.push(Number(p[2])); o.ctrs.push(p[3]); o.pts.push(p[4]); o.vals.push(p.slice(5).join(','));
    });
    return out;
}
/** Let the queued writes go out (no sample arrives meanwhile): what two real seconds give the recorder. */
async function catchUp(rec) {
    for (let i = 0; i < 5000 && (rec.writing || rec.segs.some((sg) => sg.chunks.length)); i++) { rec._flush(); await sleep(0); }
}
/** Wait until the recorder has written everything it holds. */
async function drain(rec, ms) {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) {
        if (!rec.writing && rec.queued === 0 && (rec.segs.length === 0 || (rec.segs.length === 1 && !rec.segs[0].chunks.length && !rec.segs[0].closed))) return true;
        rec._flush();
        await sleep(2);
    }
    return false;
}

// ---- values from the catalogue's own types ---------------------------------------------------------------------------------------
let cat = null;
if (fs.existsSync(CATALOGUE)) cat = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
const DT = cat ? cat.datatypes : {};
const base = (r) => { let x = r, n = 0; while (DT[x] && DT[x].type === 'typedef' && n++ < 8) x = DT[x].dataRef; return x; };
const allMembers = (t) => (t.extends && DT[t.extends] ? allMembers(DT[t.extends]) : []).concat(t.members || []);
function synth(ref, c, depth) {
    const x = base(ref), t = DT[x];
    if (!t) {
        c.i++;
        if (/^Utf/.test(x)) return 'Canary text ' + c.i;
        if (x === 'ByteBuffer') return Buffer.from('Canary bytes');
        if (x === 'Bool') return c.i % 2 === 0;
        if (/Float|Double/.test(x)) return c.i * 1.25 + c.rnd();
        return c.i % 200;
    }
    if (t.type === 'enum') { const k = Object.keys(t.items); return k[(c.i++) % k.length]; }
    if (t.type === 'array') return depth > 7 ? [] : [synth(t.dataRef || t.elementDataRef, c, depth + 1), synth(t.dataRef || t.elementDataRef, c, depth + 1)];
    if (t.type === 'map') { const o = {}; o['Canary key'] = synth(t.valueDataRef, c, depth + 1); return o; }
    const o = {};
    if (depth > 7) return o;
    allMembers(t).forEach((m) => { o[m.name] = m.dimension ? [synth(m.dataRef, c, depth + 1), synth(m.dataRef, c, depth + 1)] : synth(m.dataRef, c, depth + 1); });
    return o;
}
function valueOf(f, seed) {
    let s = seed || 1;
    const c = { i: s, rnd: () => { s = (s * 16807) % 2147483647; return (s % 1000) / 997; } };
    if (f.flags === 'b') {
        const v = {};
        cat.interfaces[f.iface].events[f.field].outputs.forEach((o) => { v[o.name] = o.dimension ? [synth(o.dataRef, c, 1)] : synth(o.dataRef, c, 1); });
        return v;
    }
    return synth(cat.interfaces[f.iface].fields[f.field].dataRef, c, 0);
}
const stOf = (f) => ({ f });

// ---- the plausible native rates (Hz) of the S14 fields: the budget's assumption, to be replaced by the first drive's report ----------
function rateOf(f) {
    const i = f.iface.split('.').pop(), m = f.field;
    if (/^(SpeedAcceleration)$/.test(i) && /vehicleSpeed|Acceleration|YawSpeed|VehicleDynamicData/.test(m)) return 50;
    if (/^(AccelerationLongitudinalLateralProvision|YawRateProvision|RollPitchRateAccelerationVerticalProvision|VelocityAndVehicleConditionProvision)$/.test(i)) return 50;
    if (/^(AcceleratorPedal|VehicleStabilizationManagement)$/.test(i)) return 50;
    if (i === 'Powertrain' && /ActualValueRPMWheel|WheelMomentDrive4/.test(m)) return 50;
    if (i === 'SurfaceInformationProvision' || i === 'VehicleModel') return 10;
    if (i === 'GapVehicleAhead') return m === 'GapVehicleDrivingAhead' ? 10 : 25;
    if (i === 'KeepDistanceObjectsLegacy') return 15;
    if (/^(CDS2|CDS|Vehicle2|A4A|XView|AssistedDrivingViewFunctionInput|VehicleInformation)$/.test(i)) return 10;
    if (i === 'Powertrain' || i === 'Light') return 10;
    if (/^(DisplayDataServer|DisplayDataServer2|FASuS|TrafficSignDisplayControl|MultimodalControlDriverAssistance)$/.test(i)) return 5;
    return 1;
}

async function main() {
    // ---------------------------------------------------------------------------------------------------------------
    console.log('1. the source');
    const code = fs.readFileSync(path.join(ROOT, 'shared', 'signal_recorder.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    ok(!/\?\.|\?\?|catch\s*\{|\.\.\.\w|\bBigInt\(|\.flat\(|\.flatMap\(|Object\.fromEntries|Object\.entries|Object\.values|\.padEnd|\.padStart|\bfor await\b|\basync\b|\bawait\b/.test(code), 'recorder.js: only what Node 8.16 has (no ?. ??, spread, optional catch binding, entries / values, padStart, async)');
    ok(!/setValue|callMethod|signals\.|\.send\(|child_process|require\('(?!fs'|zlib'|path')/.test(code), 'recorder.js: no signal call, no child process, only fs / zlib / path');
    ok((code.match(/=> \{\s*try \{/g) || []).length >= 4 && /_fail\(err\)/.test(code), 'recorder.js: the timer and the write callbacks catch (a throw there would end the app)');
    const app = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'app.json'), 'utf8'));
    const items = app.screens[0].items.map((x) => x[1]);
    ok(items.indexOf('REC') === items.indexOf('MARK') + 1 && items.indexOf('RECSET') === items.indexOf('REC') + 1, 'the menu: REC and RECSET right after the mark row');
    ok(app.config.recorder && app.config.recorder.quotaMB <= 15 && app.config.recorder.gzip === true && app.config.recorder.quietLog === true, 'config.recorder: quota ' + app.config.recorder.quotaMB + ' MB (the app\'s disk limit is 20 MiB with its log), gzip, quiet log');
    ok(app.config.recorder.choices.every((c) => c.every((id) => RECORDABLE.indexOf(id) >= 0)), 'the recordable sets are S13 / S14 / S15 / S17 / S18 only (numbers and enum names, no text member)');
    ok(fmtNum(0.1 + 0.2) === '0.3' && fmtNum(9.806650161743164) === '9.80665' && fmtNum(-0) === '0' && fmtNum(65535) === '65535' && fmtNum(1e-7) === '1e-7' && fmtNum(NaN) === '', 'numbers: integers as they are, floats to 7 significant digits');

    if (!cat) { console.log('  skip 2..4: the catalogue is not here'); } else {
        // ---------------------------------------------------------------------------------------------------------------
        console.log('2. every field of S13 / S14 / S15 / S17 / S18 from the catalogue\'s own types: no text, no coordinate');
        const dir2 = path.join(tmp, 'rec2');
        let t = 0;
        const R2 = new Recorder({ dir: dir2, mono: () => t, version: 'test', cfg: { fileRawKB: 64 } });
        ok(R2.start(['S13', 'S14', 'S15', 'S17', 'S18']) === true, 'start');
        const recF = FIELDS.TABLE.filter((f) => inSets(f, RECORDABLE));
        recF.forEach((f, k) => {
            for (let j = 0; j < 3; j++) {
                t += 7;
                const v = valueOf(f, k * 3 + j + 1);
                // a coordinate and a free text the catalogue's types do not have: what a future type or a wrong binding could hand over
                if (v && typeof v === 'object' && !Array.isArray(v)) { v.latitudeWGS84 = 50.45 + j; v.positionLongitude = 30.52; v.wgsHeight = 170; v.nameOfSomething = 'Canary free text'; }
                R2.sample(stOf(f), v);
            }
        });
        R2.stop();
        await drain(R2);
        const r2 = readRec(dir2);
        const fl = r2.lines.filter((l) => /^#f,/.test(l));
        const tags = fl.map((l) => l.split(',')[2]);
        ok(recF.every((f) => tags.indexOf(f.tag) >= 0), 'every one of the ' + recF.length + ' fields has its columns (#f) in the files');
        ok(!CANARY.test(r2.text), 'no text: not one canary of a text member reached a file');
        ok(!fl.some((l) => /latitude|longitude|wgs/i.test(l)) && !/50\.45|30\.52/.test(r2.text), 'no coordinate: no latitude / longitude / WGS column, no such value');
        ok(!fl.some((l) => l.split(',').slice(4).some((c) => /(^|\.)(crc\w*|cRC\w*|dataID|cHL\w*)$/i.test(c))), 'no end-to-end header column (crc, dataID, cHL)');
        const s15skip = FIELDS.TABLE.filter((f) => f.set === 'S15' && f.tree && f.tree.skip);
        ok(s15skip.every((f) => !fl.filter((l) => l.split(',')[2] === f.tag).some((l) => f.tree.skip.some((k) => l.split(',').slice(4).some((c) => c.split('.').indexOf(k) >= 0)))), 'what a tree spec skips (S15\'s own position and heading, the frame name) is never a column');
        ok(R2.status().texts > 0 && r2.lines.filter((l) => l[0] !== '#').every((l) => l.split(',').slice(5).every((x) => x === '' || x === '=' || /^@\d+$/.test(x) || /^-?[0-9.e+-]+$/.test(x))), 'every value is a number, an enum code or empty (' + R2.status().texts + ' texts written empty)');
        ok(r2.lines.filter((l) => /^#n,/.test(l)).every((l) => /^#n,\d+,[A-Z_][A-Z0-9_]*$/.test(l)), 'every dictionary line names an enum (capitals, digits, _)');

        // ---------------------------------------------------------------------------------------------------------------
        console.log('3. the payload\'s own counters and time stamps (S14)');
        const s2 = samplesOf(r2.lines);
        const want = {   // tag: [has a counter, has a time stamp]
            'speed': [1, 0], 'accel-long': [1, 0], 'accel-long-cog': [1, 0], 'accel-long-est': [1, 0], 'yaw-rate': [1, 0], 'gradient': [1, 0],
            'keep-dist-1': [1, 0], 'keep-dist-params': [1, 1], 'view-input': [0, 1], 'display-speed': [1, 0], 'longitudinal': [1, 0], 'ldm-guidance': [1, 0],
            'warn-brake': [1, 0], 'accel-pedal': [1, 0], 'brake-driver': [1, 0], 'wheel-rpm': [1, 0], 'drive-torque': [1, 0], 'velocity': [1, 0], 'velocity-long': [1, 0],
            'lane-slope': [1, 0], 'gearbox-status': [1, 0], 'front-vehicle': [0, 0], 'gap-ahead': [0, 0], 'cds-accel-long': [0, 0], 'car-speed2': [0, 0], 'hud-data2': [0, 0],
        };
        const wrong = Object.keys(want).filter((tag) => {
            const o = s2[tag];
            if (!o) return true;
            return (want[tag][0] ? o.ctrs.some((x) => x === '') : o.ctrs.some((x) => x !== '')) || (want[tag][1] ? o.pts.some((x) => !/^\d+\.\d{9}$/.test(x)) : o.pts.some((x) => x !== ''));
        });
        ok(wrong.length === 0, 'ctr / pts where the payload has them, empty where it has none (' + Object.keys(want).length + ' fields checked)' + (wrong.length ? ': ' + wrong.join(', ') : ''));
        const fv = flatten({ length: 9, counter: 3, dataID: 1, cRC: 2, v: { x: 1.5, invalidFlag: false }, timestamp: { seconds: 12, nanoseconds: 5000, sync_state: 'KSTDTIMESTAMPSYNCSTATE_INSYNC' } }, null, 16);
        ok(fv.ctr === 3 && fv.ptsS === 12 && fv.ptsNs === 5000 && JSON.stringify(fv.keys) === '["v.x","v.invalidFlag","timestamp.sync_state"]', 'flatten: the end-to-end header out, the counter and the time stamp aside, the sync state kept as a column');

        // ---------------------------------------------------------------------------------------------------------------
        console.log('4. a simulated drive of ' + SIM_MIN + ' min at plausible native rates (S14 and what it shares), real files');
        const s14 = FIELDS.TABLE.filter((f) => inSets(f, ['S14']));
        const plan = s14.map((f, k) => ({ f, hz: rateOf(f), k, v: valueOf(f, k + 1), n: 0 }));
        const perS = plan.reduce((s, p) => s + p.hz, 0);
        const sim = async (dir, minutes, factor, quotaMB, fileRawKB) => {
            let now = 0;
            const R = new Recorder({ dir, mono: () => now, version: 'test', cfg: { quotaMB: quotaMB || 15, fileRawKB: fileRawKB || 4096 } });
            R.start(['S14']);
            const cpu0 = process.cpuUsage(), w0 = Date.now();
            let sent = 0;
            for (let s = 0; s < minutes * 60; s++) {
                // one simulated second: every field at its rate, its numbers moving (a noisy measurement, a slow speed, an alive counter)
                const ev = [];
                plan.forEach((p) => { const n = Math.round(p.hz * factor); for (let i = 0; i < n; i++) ev.push([s * 1000 + Math.floor((i + p.k / plan.length) * 1000 / n), p]); });
                ev.sort((a, b) => a[0] - b[0]);
                for (let e = 0; e < ev.length; e++) {
                    const p = ev[e][1];
                    now = ev[e][0];
                    p.n++;
                    const v = p.v;
                    if (v && typeof v === 'object') {
                        Object.keys(v).forEach((key) => {
                            const x = v[key];
                            if (typeof x === 'number') v[key] = /alive|aliv|counter/i.test(key) ? (x + 1) % 15 : Number.isInteger(x) ? x + (p.n % 7 === 0 ? 1 : 0) : x + (((p.n * 7919) % 200) - 100) / 1000;
                            else if (x && typeof x === 'object' && !Array.isArray(x)) Object.keys(x).forEach((k2) => { if (typeof x[k2] === 'number' && !Number.isInteger(x[k2])) x[k2] += (((p.n * 104729) % 200) - 100) / 1000; });
                        });
                    }
                    R.sample(stOf(p.f), v);
                    sent++;
                }
                // every two simulated seconds the writes catch up, as they would in real time (the loop runs far faster than the car)
                if (s % 2 === 1) await catchUp(R);
                if (s === 60) R.mark(1);
            }
            const cpu = process.cpuUsage(cpu0), wall = Date.now() - w0;
            R.stop();
            await drain(R, 60000);
            return { R, sent, cpuMs: (cpu.user + cpu.system) / 1000, wall };
        };
        const dir4 = path.join(tmp, 'rec4');
        const d = await sim(dir4, SIM_MIN, 1);
        const st4 = d.R.status();
        const r4 = readRec(dir4);
        const raw4 = r4.text.length;
        const disk4 = r4.files.reduce((s, n) => s + fs.statSync(path.join(dir4, n)).size, 0);
        const secs = SIM_MIN * 60;
        ok(st4.samples === d.sent && st4.dropped === 0 && st4.errors === 0, d.sent + ' samples (' + perS + ' a second, ' + plan.length + ' fields), none dropped, no error');
        const s4 = samplesOf(r4.lines);
        ok(plan.every((p) => s4[p.f.tag] && s4[p.f.tag].n === p.n && s4[p.f.tag].seqs.every((q, i) => q === i + 1)), 'every field: every value in the files, its seq 1..n without a gap');
        ok(r4.files.length === Math.ceil(raw4 / (4096 * 1024)) && r4.files.every((n, i) => n === r4.files[0].replace(/-001\./, '-' + ('00' + (i + 1)).slice(-3) + '.')), 'the files are cut by size (4 MB of text each): ' + r4.files.length + ' files of one session');
        ok(disk4 <= 15 * 1048576 && st4.used <= 15 * 1048576, 'the folder stays under the 15 MB quota: ' + (disk4 / 1048576).toFixed(2) + ' MB on disk');
        ok(/^#end,/.test(r4.lines[r4.lines.length - 1]) && r4.lines.some((l) => /^#m,60\d{3},1$/.test(l)), 'the last line is #end; the mark is at its time');
        const budget = { fields: plan.length, samplesPerS: perS, rawBytesPerS: Math.round(raw4 / secs), gzipBytesPerS: Math.round(disk4 / secs), ratio: +(raw4 / disk4).toFixed(1),
            minutesIn15MB: Math.round(15 * 1048576 / (disk4 / secs) / 60), cpuMsPerS: +(d.cpuMs / secs).toFixed(2), bytesPerSample: +(raw4 / d.sent).toFixed(1) };
        console.log('  budget (Mac): ' + JSON.stringify(budget));
        ok(budget.gzipBytesPerS * 20 * 60 <= 15 * 1048576, 'a 20-minute drive fits the quota: ' + budget.gzipBytesPerS + ' B/s on disk (' + budget.rawBytesPerS + ' B/s of text, x' + budget.ratio + '), about ' + budget.minutesIn15MB + ' min in 15 MB');
        ok(budget.cpuMsPerS < 60, 'CPU on the Mac: ' + budget.cpuMsPerS + ' ms a second (the head unit\'s Atom is slower: the report scales it)');
        fs.writeFileSync(path.join(tmp, 'budget.json'), JSON.stringify(budget, null, 1));
        if (process.env.REC_BUDGET_OUT) fs.writeFileSync(process.env.REC_BUDGET_OUT, JSON.stringify(Object.assign({ minutes: SIM_MIN, rates: plan.map((p) => [p.f.tag, p.hz]) }, budget), null, 1));
        // the converter reads it back
        const py = spawnSync('python3', [CONVERT, dir4, '-o', path.join(tmp, 'out4'), '--resample', '100'], { encoding: 'utf8', timeout: 600000 });
        ok(py.status === 0, 'tools/car/rec_convert.py converts it: ' + (py.stdout || py.stderr).trim().split('\n').pop().replace(/ -> .*$/, ''));
        if (py.status === 0) {
            const sess = fs.readdirSync(path.join(tmp, 'out4'))[0];
            const rep = JSON.parse(fs.readFileSync(path.join(tmp, 'out4', sess, 'report.json'), 'utf8'));
            const bad = plan.filter((p) => { const f = rep.fields.find((x) => x.tag === p.f.tag); return !f || f.samples !== p.n || Math.abs(f.mean_rate_hz - p.hz) > 0.02 * p.hz + 0.05 || f.recorder_drops !== 0; });
            ok(rep.complete && bad.length === 0, 'the report finds the rate each field was sent at, and no drop' + (bad.length ? ': ' + bad.map((p) => p.f.tag).join(', ') : ''));
            ok(fs.existsSync(path.join(tmp, 'out4', sess, 'drive.csv')) && fs.readFileSync(path.join(tmp, 'out4', sess, 'drive.csv'), 'utf8').split('\n').length >= secs * 10, 'drive.csv on a 100 ms clock');
        }
        // twice the rates, two minutes
        const dir4b = path.join(tmp, 'rec4b');
        const d2 = await sim(dir4b, 2, 2);
        const st4b = d2.R.status();
        const disk4b = readRec(dir4b).files.reduce((s, n) => s + fs.statSync(path.join(dir4b, n)).size, 0);
        if (!(st4b.dropped === 0 && st4b.errors === 0 && st4b.samples === d2.sent)) console.log('  status: ' + JSON.stringify(st4b) + ' sent ' + d2.sent);
        ok(st4b.dropped === 0 && st4b.errors === 0 && st4b.samples === d2.sent, 'twice the rates (' + Math.round(d2.sent / 120) + ' samples a second): none dropped; ' + Math.round(disk4b / 120) + ' B/s on disk, ' + (d2.cpuMs / 120).toFixed(2) + ' ms CPU a second');
        fs.writeFileSync(path.join(tmp, 'budget2x.json'), JSON.stringify({ samplesPerS: Math.round(d2.sent / 120), gzipBytesPerS: Math.round(disk4b / 120), cpuMsPerS: +(d2.cpuMs / 120).toFixed(2) }));
        if (process.env.REC_BUDGET_OUT) fs.writeFileSync(process.env.REC_BUDGET_OUT.replace(/\.json$/, '-2x.json'), fs.readFileSync(path.join(tmp, 'budget2x.json')));

        // ---------------------------------------------------------------------------------------------------------------
        console.log('5. the quota');
        const dir5 = path.join(tmp, 'rec5');
        fs.mkdirSync(dir5);
        fs.writeFileSync(path.join(dir5, 'rec-20200101-000000-001.csv.gz'), Buffer.alloc(300 * 1024));        // an old recording
        fs.writeFileSync(path.join(dir5, 'signal_probe.log'), Buffer.alloc(10));                                 // not ours: never touched
        const d5 = await sim(dir5, 3, 1, 0.25, 64);
        const r5 = readRec(dir5);
        const used5 = r5.files.reduce((s, n) => s + fs.statSync(path.join(dir5, n)).size, 0);
        if (!(used5 <= 0.25 * 1048576 && d5.R.status().errors === 0 && d5.R.status().samples === d5.sent)) console.log('  status: ' + JSON.stringify(d5.R.status()) + ' sent ' + d5.sent);
        ok(!fs.existsSync(path.join(dir5, 'rec-20200101-000000-001.csv.gz')) && fs.existsSync(path.join(dir5, 'signal_probe.log')), 'the oldest recording went first; a file not of the recorder stays');
        ok(used5 <= 0.25 * 1048576 && d5.R.status().errors === 0 && d5.R.status().samples === d5.sent, 'a 0.25 MB quota: the folder stays under it (' + Math.round(used5 / 1024) + ' KB, ' + r5.files.length + ' files) and the recording went on to its end');
    }

    // ---------------------------------------------------------------------------------------------------------------
    console.log('6. failures: the recording stops, never the app');
    const F = { tag: 'speed', iface: 'de.bmw.chassis.SpeedAcceleration', field: 'vehicleSpeed' };
    const V = () => ({ aliveSpeedVehicle: 1, speedVehicleCentreOfGravity: 5000, qualifierSpeedVehicleCentreOfGravity: 'SIGNALWERT_IST_GUELTIG' });
    const fakeFs = (over) => Object.assign({}, fs, over);
    const fail = (code) => { const e = new Error(code); e.code = code; return e; };
    const L6 = [];
    const log6 = { info: (s) => L6.push(s), warn: (s) => L6.push(s) };
    let threw = false;
    // a full disk on a write
    const R6 = new Recorder({ dir: path.join(tmp, 'rec6'), log: log6, fs: fakeFs({ write: (fd, b, o, l, p, cb) => setImmediate(() => cb(fail('ENOSPC'))) }) });
    try {
        R6.start(['S14']);
        for (let i = 0; i < 200; i++) R6.sample(stOf(F), V());
        R6._flush(); await sleep(20);
        for (let i = 0; i < 200; i++) R6.sample(stOf(F), V());
        R6.mark(3); R6.stop(); R6._flush();
    } catch (e) { threw = true; }
    ok(!threw && !R6.on && R6.status().error === 'ENOSPC' && L6.some((l) => /rec: STOPPED by a write error: ENOSPC/.test(l)), 'a full disk (ENOSPC): no throw, the recording stopped, the log and the status say so');
    ok(R6.status().queued === 0 && R6.segs.length === 0, '... and nothing is held in memory after it');
    // a file that cannot be opened
    threw = false;
    const R7 = new Recorder({ dir: path.join(tmp, 'rec7'), log: log6, fs: fakeFs({ openSync: () => { throw fail('EACCES'); } }) });
    try { R7.start(['S14']); R7.sample(stOf(F), V()); R7._flush(); R7.sample(stOf(F), V()); } catch (e) { threw = true; }
    ok(!threw && !R7.on && R7.status().error === 'EACCES', 'a file that cannot be opened (EACCES): stopped, no throw');
    // a folder that cannot be made
    threw = false;
    const R8 = new Recorder({ dir: path.join(tmp, 'no', 'such', 'rec'), log: log6 });
    let started = null;
    try { started = R8.start(['S14']); R8.sample(stOf(F), V()); R8.mark(1); R8.stop(); } catch (e) { threw = true; }
    ok(!threw && started === false && !R8.on && /ENOENT/.test(R8.status().error), 'a folder that cannot be made: start() says false, nothing throws');
    // a broken gzip
    threw = false;
    const R9 = new Recorder({ dir: path.join(tmp, 'rec9'), log: log6, zlib: { gzip: (b, cb) => setImmediate(() => cb(new Error('zlib broke'))), gzipSync: () => { throw new Error('zlib broke'); } } });
    try { R9.start(['S14']); R9.sample(stOf(F), V()); R9._flush(); await sleep(20); R9.sample(stOf(F), V()); R9.stop(true); } catch (e) { threw = true; }
    ok(!threw && !R9.on && /zlib broke/.test(R9.status().error), 'a broken gzip: stopped, no throw');
    // a write that never returns: the queue fills, samples are dropped and counted, memory stays bounded
    const R10 = new Recorder({ dir: path.join(tmp, 'rec10'), log: log6, cfg: { maxQueueKB: 64 }, fs: fakeFs({ write: () => { /* never calls back */ } }) });
    R10.start(['S14']);
    R10._flush();
    for (let i = 0; i < 20000; i++) R10.sample(stOf(F), { aliveSpeedVehicle: i % 15, speedVehicleCentreOfGravity: i });
    ok(R10.status().dropped > 15000 && R10.status().queued < 70 * 1024 && R10.on, 'a write that never returns: ' + R10.status().dropped + ' samples dropped and counted, ' + Math.round(R10.status().queued / 1024) + ' KB held (the cap is 64)');
    R10.on = false; clearInterval(R10.timer);
    // hostile values
    threw = false;
    const R11 = new Recorder({ dir: path.join(tmp, 'rec11'), log: log6 });
    R11.start(['S14']);
    const cyc = { a: 1 }; cyc.self = cyc;
    const bad = {}; Object.defineProperty(bad, 'boom', { enumerable: true, get: () => { throw new Error('getter'); } });
    try {
        [null, undefined, 7, 'Canary text', 'ENUM_ONLY', [1, 2, 3], cyc, bad, { big: new Array(100000).fill(1) }, { s: Symbol('x') }, { f: () => 1 }, { nan: NaN, inf: Infinity }].forEach((v) => R11.sample(stOf(F), v));
        R11.sample({}, 1); R11.sample(null, 1);
    } catch (e) { threw = true; }
    R11.stop(); await drain(R11);
    const r11 = readRec(path.join(tmp, 'rec11'));
    ok(!threw && R11.status().errors >= 2 && !CANARY.test(r11.text) && r11.lines.filter((l) => /^\d/.test(l)).every((l) => l.length < 400), 'hostile values (null, a text, a cycle, a throwing getter, a 100 000 list, NaN): no throw, errors counted, no text, lists cut to 16 entries');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('7. inside the probe');
    const lines7 = [];
    const subs = {};
    const sig = {
        watch: (iface, inst, handlers) => { subs[iface] = handlers; return Promise.resolve({ iface, available: true, proxy: { iface }, error: null }); },
        on: (p, field, fn) => { subs[p.iface][field] = fn; return Promise.resolve(); },
        get: () => Promise.reject(new Error('no')),
    };
    let t7 = 0;
    const P = new Probe({ log: { info: (s) => lines7.push(s), warn: (s) => lines7.push(s) }, signals: sig, now: () => 1e6 + t7, cfg: { hubPauseMs: 0 } });
    const dir7 = path.join(tmp, 'rec7b');
    const R = new Recorder({ dir: dir7, log: { info: (s) => lines7.push(s), warn: (s) => lines7.push(s) }, mono: () => t7 });
    P.setRecorder(R, true);
    P.setSets(['S14', 'S6'], true);
    await P.idle(); await sleep(5); await P.idle();
    const n7 = P.recordSets(['S14']);
    const want7 = FIELDS.TABLE.filter((f) => inSets(f, ['S14'])).length;
    ok(n7 === want7 && n7 === FIELDS.TABLE.filter((f) => f.set === 'S14').length + 8, 'recordSets([S14]): its ' + n7 + ' fields (with the seven of S8 and the gear of S10)');
    R.start(['S14']);
    const sp = P.fields.find((st) => st.f.tag === 'speed'), fv7 = P.fields.find((st) => st.f.tag === 'front-vehicle'), stalk = P.fields.find((st) => st.f.tag === 'stalk');
    for (let i = 0; i < 100; i++) { t7 += 20; sp.handler({ aliveSpeedVehicle: i % 15, speedVehicleCentreOfGravity: 5000 + i, qualifierSpeedVehicleCentreOfGravity: 'GUELTIG' }); fv7.handler({ frontVehicleGapX: 100 + i }); }
    P.mark();
    t7 += 5;
    stalk.handler({ operationColumnStalks: 64 });
    R.stop(); await drain(R);
    const r7 = readRec(dir7), s7 = samplesOf(r7.lines);
    ok(s7.speed && s7.speed.n === 100 && s7['front-vehicle'] && s7['front-vehicle'].n === 100, 'every value of S14\'s speed and S8\'s front vehicle went to the file (100 each, unthrottled)');
    ok(!lines7.some((l) => /^probe: P23 speed |^probe: P15 front-vehicle /.test(l)) && sp.events === 100, 'their throttled log lines are quiet while recording (the events are still counted)');
    ok(lines7.some((l) => /^probe: P13 stalk #1 /.test(l)) && !s7.stalk, 'a field not recorded (S6\'s stalk) logs as before and is not in the file');
    ok(lines7.some((l) => /^probe: mark M1 /.test(l)) && r7.lines.some((l) => /^#m,2000,1$/.test(l)), 'the mark: in the log and in the file at its time');
    P.recordSets([]);
    t7 += 20; sp.handler({ aliveSpeedVehicle: 1, speedVehicleCentreOfGravity: 7000, qualifierSpeedVehicleCentreOfGravity: 'GUELTIG' });
    ok(lines7.some((l) => /^probe: P23 speed #1 .*speed=7000/.test(l)), 'after the stop the field logs again');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('8. on the bench: the real app, built by the kit, in the stubbed head unit (port ' + PORT + ')');
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
        // r1120 AC: ACC (S17) is the first choice; beam HS: HB (S18) one press further, S14 two
        ok(p && p.native.REC && /^Почати запис ACC$/.test(p.native.REC.cells.Text1stRow) && /вільно 15,0 МБ з 15,0 МБ/.test(p.native.REC.cells.Text2ndRow), 'the REC row: "Почати запис ACC", the room in the quota: ' + JSON.stringify(p && p.native.REC && p.native.REC.cells));
        ok(p && /^Набір для запису: ACC$/.test(p.native.RECSET.cells.Text1stRow), 'the RECSET row: ACC');
        await req('POST', '/click', { id: 'RECSET' });
        await sleep(300);
        p = await req('GET', '/probe');
        ok(/: HB$/.test(p.native.RECSET.cells.Text1stRow) && /^Почати запис HB$/.test(p.native.REC.cells.Text1stRow), 'a press on RECSET: the next choice, HB');     // beam HS
        await req('POST', '/click', { id: 'RECSET' });
        await sleep(300);
        p = await req('GET', '/probe');
        ok(/: S14$/.test(p.native.RECSET.cells.Text1stRow) && /^Почати запис S14$/.test(p.native.REC.cells.Text1stRow), 'a press on RECSET: the next choice, S14');
        await req('POST', '/click', { id: 'RECSET' });
        await sleep(300);
        p = await req('GET', '/probe');
        ok(/S14\+S15$/.test(p.native.RECSET.cells.Text1stRow) && /S14\+S15$/.test(p.native.REC.cells.Text1stRow), 'a press on RECSET: the next choice, S14+S15');
        await req('POST', '/click', { id: 'RECSET' }); await req('POST', '/click', { id: 'RECSET' }); await req('POST', '/click', { id: 'RECSET' }); await req('POST', '/click', { id: 'RECSET' });
        await sleep(300);
        p = await req('GET', '/probe');
        ok(/: S14$/.test(p.native.RECSET.cells.Text1stRow), 'four more presses (S13, ACC, HB): back to S14');     // beam HS: + HB
        // start
        await req('POST', '/click', { id: 'REC' });
        ok(await until(() => probeLines().some((l) => /^probe: rec: start session=\d{8}-\d{6} sets=S14 dir=data\/rec file=4096KB quota=15MB gzip=1$/.test(l))), 'a press on REC: the recording starts: ' + (probeLines().filter((l) => /rec: start/.test(l))[0] || ''));
        ok(await until(() => probeLines().some((l) => /^probe: sets on=S14 changed=\+S14 /.test(l))) && probeLines().some((l) => /^probe: rec: \d+ fields routed to the recorder$/.test(l)), 'S14 was switched on with it (its checkbox too), its fields routed to the recorder');
        const n14 = FIELDS.interfaces().filter((e) => FIELDS.TABLE.some((f) => f.iface === e.iface && inSets(f, ['S14']))).length;
        ok(await until(() => probeLines().filter((l) => /^probe: watch /.test(l)).length >= n14, 30000), 'S14\'s ' + n14 + ' interfaces are subscribed (one at a time): ' + probeLines().filter((l) => /^probe: watch /.test(l)).length);
        // a burst: three fields, 600 values each, as fast as the bench takes them
        const N = 600;
        const feeds = [];
        for (let i = 0; i < N; i++) {
            feeds.push({ iface: 'de.bmw.chassis.SpeedAcceleration', field: 'vehicleSpeed', value: { aliveSpeedVehicle: i % 15, speedVehicleCentreOfGravity: 5000 + i, qualifierSpeedVehicleCentreOfGravity: 'SIGNALWERT_IST_GUELTIG_UND_ABGESICHERT_UND_PLAUSIBILISIERT' } });
            feeds.push({ iface: 'de.bmw.powertrain.AcceleratorPedal', field: 'AngleAcceleratorPedal', value: { aliveAngleAcceleratorPedal: i % 15, actualValueAngleAcceleratorPedal: i % 300, qualifierActualValueAngleAcceleratorPedal: 'INITIALISIERUNG' } });
            feeds.push({ iface: 'de.bmw.chassis.AccelerationLongitudinalLateralProvision', field: 'accelerationLongitudinalCog', value: { counter: i, accelerationLongitudinalCog: { accelerationLongitudinalCentreOfGravity: Math.sin(i / 10), invalidFlag: false }, eventDataQualifier: 'EVENT_DATA_AVAILABLE' } });
        }
        const t0 = Date.now();
        for (let i = 0; i < feeds.length; i += 30) await Promise.all(feeds.slice(i, i + 30).map((fd) => req('POST', '/fake', { feed: fd })));
        const burstS = (Date.now() - t0) / 1000;
        await req('POST', '/click', { id: 'MARK' });
        await sleep(1500);
        p = await req('GET', '/probe');
        ok(p && /^Запис S14 іде, \d+:\d\d\. Натисніть: стоп$/.test(p.native.REC.cells.Text1stRow) && /зразків, .* МБ, вільно/.test(p.native.REC.cells.Text2ndRow), 'while it records the row says so, with the samples, the bytes and the room: ' + JSON.stringify(p.native.REC.cells));
        await req('POST', '/click', { id: 'REC' });
        ok(await until(() => probeLines().some((l) => /^probe: rec: stop session=/.test(l))), 'a second press: stopped');
        await sleep(1500);
        const rb = readRec(recDir()), sb = samplesOf(rb.lines);
        ok(sb.speed && sb.speed.n === N && sb['accel-pedal'] && sb['accel-pedal'].n === N && sb['accel-long-cog'] && sb['accel-long-cog'].n === N,
            'every injected value is in the file: ' + N + ' x 3 values in ' + burstS.toFixed(1) + ' s (' + Math.round(3 * N / burstS) + ' a second through the bench): ' + ['speed', 'accel-pedal', 'accel-long-cog'].map((k) => k + '=' + (sb[k] ? sb[k].n : 0)).join(' '));
        ok(sb.speed && sb.speed.seqs.every((q, i) => q === i + 1) && sb.speed.vals[N - 1] === (5000 + N - 1) + ',@1', 'in order, the last value as sent');
        ok(rb.lines.some((l) => /^#m,\d+,1$/.test(l)) && /^#end,/.test(rb.lines[rb.lines.length - 1]), 'the mark and the end line are in the file');
        ok(!probeLines().some((l) => /^probe: P23 speed #/.test(l)), 'the recorded fields stayed quiet in the log');
        const before = probeLines().length;
        await req('POST', '/restart');
        ok(await until(() => probeLines().slice(before).some((l) => /^probe: start signal_probe .* sets=S14 /.test(l)), 15000), 'after a restart S14 is on (its checkbox), and ...');
        await sleep(500);
        p = await req('GET', '/probe');
        ok(p && /^Почати запис S14$/.test(p.native.REC.cells.Text1stRow), '... the recording is off until the next press: ' + (p && p.native.REC.cells.Text1stRow));
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
