'use strict';
/**
 * dry_run.js - replay the owner's session (design/car/session_plan.json) against the signal_probe app on the bench (package CQ).
 *
 *   node tools/car/dry_run.js [--out <dir>] [--until B6] [--summary 3,8,20]
 *
 * What it does, in plan order: for every block, switches the block's sets (the app's own checkboxes: the settings keys set1..set9,
 * as the HMI presses them), then for every step: presses the app's "Позначка" row when the plan marks the step, and feeds every
 * (item, field tag) the plan expects between that mark and the next, with values GENERATED FROM THE CATALOGUE'S OWN TYPES (a
 * struct of its members, an enum by an item's name, a text member by a canary word, a list of two), as the car's binding hands them.
 * One pair is deliberately never fed (the car "does not send" it) to prove the summary names it as silent. Then it:
 *   - writes the app's log in the car's file format (<ISO> <LEVEL> <message>) to <out>/signal_probe.log,
 *   - runs tools/car/verify_steps.py on it (every required pair found between its mark and the next; the silent pair SILENT),
 *   - proves no canary word reached the log, and every mark line is there in order, and
 *   - hands the log to the parser (tools/car/parse_logs.py, package CL) in a fake collection folder when the parser is there.
 * Bench only: the marks and sets are what the owner presses, the values are invented. Nothing is sent to a car; the app is built
 * with the kit and run by bench/run-app.js (no cluster-render, no network). Node 18+ on the Mac, never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, fork } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(opt('--out', path.join(ROOT, 'bake', 'work', 'car', 'CQ', 'dry-run')));
const UNTIL = opt('--until', 'B9');
const SUMMARY = opt('--summary', '3,8,20').split(',').map(Number);
const CATALOGUE = path.join(ROOT, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json');
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'car', 'session_plan.json'), 'utf8'));
const MARKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'car', 'session_marks.json'), 'utf8'));
const TABLE_PATHS = [path.join(ROOT, 'design', 'car', 'probe_fields.json'), path.join(ROOT, 'bake', 'work', 'car', 'pub', 'CP', 'probe_fields.json')];
const TABLE = JSON.parse(fs.readFileSync(TABLE_PATHS.find((p) => fs.existsSync(p)), 'utf8'));
const CAT = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
const DT = CAT.datatypes;
const NEVER_SENT = { 'P13:sw-fav': true };           // the car "does not send" this one: the summary must call it silent

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };

// ---- values from the catalogue's types -------------------------------------------------------------------------------------------
const base = (ref) => { let r = ref, n = 0; while (DT[r] && DT[r].type === 'typedef' && n++ < 8) r = DT[r].dataRef; return r; };
function gen(ref, v, name, depth) {
    depth = depth || 0;
    const r = base(ref), t = DT[r];
    if (!t) {
        if (/^Utf|^ByteBuffer/.test(r)) return 'CANARY_' + String(name || 'TEXT').toUpperCase() + 'x'.repeat(v % 7);   // a new length per value: lengths are all the probe logs of a text
        if (r === 'Bool') return v % 2 === 0;
        if (/^Float|^Double/.test(r)) return 10 + v;
        const m = /^(U?)Int(\d+)$/.exec(r);
        if (m) { const max = Math.pow(2, Number(m[2]) - (m[1] ? 0 : 1)) - 1; return Math.min(max, 3 + v); }
        return 1 + v;
    }
    if (t.type === 'enum') { const names = Object.keys(t.items); return names[(v + 1) % names.length]; }
    if (t.type === 'struct' || t.type === 'union') {
        if (depth > 6) return {};
        const o = {};
        const mem = t.type === 'union' ? [t.members[v % t.members.length]] : t.members;
        mem.forEach((x) => { o[x.name] = gen(x.dataRef, v, x.name, depth + 1); });
        return o;
    }
    if (t.type === 'array') return depth > 6 ? [] : [gen(t.dataRef, v, name, depth + 1), gen(t.dataRef, v + 1, name, depth + 1)];
    if (t.type === 'map') return {};
    return null;
}
const fieldsFor = (item, tag) => TABLE.fields.filter((f) => f.item === item && f.tag === tag);
function valuesFor(f, n) {
    const ref = CAT.interfaces[f.interface].fields[f.field].dataRef;
    if (f.formatter === 'bits') {            // a stalk byte: a bit goes up, then down (one press), so two lines per press
        const m = DT[base(ref)].members[0].name, bit = 1 << (n % 6 + 2);
        const o = (x) => { const y = {}; y[m] = x; return y; };
        return [o(bit), o(0)];
    }
    return [gen(ref, n, f.field)];
}

// ---- the app --------------------------------------------------------------------------------------------------------------------
function build() {
    const sdk = path.join(ROOT, 'oap-sdk');
    if (!fs.existsSync(path.join(sdk, 'index.js'))) {
        fs.mkdirSync(sdk, { recursive: true });
        fs.writeFileSync(path.join(sdk, 'index.js'), "'use strict';\n// BENCH_STUB: stands in for BMW's oap-sdk so kit/tools/build.py runs on the Mac. Never ship this.\nthrow new Error('BENCH_STUB oap-sdk');\n");
        fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'oap-sdk', version: '0.0.0-bench-stub', main: 'index.js' }) + '\n');
    }
    const b = spawnSync('python3', [path.join(ROOT, 'kit', 'tools', 'build.py'), 'signal_probe'], { cwd: ROOT, encoding: 'utf8' });
    if (b.status !== 0) { console.log(b.stdout + b.stderr); throw new Error('kit build of signal_probe failed'); }
    return path.join(ROOT, 'dist', 'signal_probe');
}

async function main() {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    console.log('dry run: ' + path.relative(ROOT, OUT) + '  (blocks up to ' + UNTIL + ', summaries at +' + SUMMARY.join(', +') + ' s)');
    const stage = path.join(OUT, 'stage', 'signal_probe');
    fs.mkdirSync(path.dirname(stage), { recursive: true });
    fs.cpSync(build(), stage, { recursive: true });
    const sp = path.join(stage, 'source', 'javascript', 'kit', 'app-spec.json');
    const spec = JSON.parse(fs.readFileSync(sp, 'utf8'));
    spec.config = Object.assign({}, spec.config, { probe: Object.assign({}, (spec.config && spec.config.probe) || {}, { summaryS: SUMMARY }) });
    fs.writeFileSync(sp, JSON.stringify(spec));
    const dataDir = path.join(OUT, 'data');
    let out = '';
    const child = fork(path.join(ROOT, 'bench', 'run-app.js'), [stage, dataDir], {
        cwd: OUT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: Object.assign({}, process.env, { HUD_CLUSTER_SOCKET: path.join(OUT, 'no-cluster-render.sock') }),
    });
    let exited = false;
    child.stdout.on('data', (x) => { out += x; }); child.stderr.on('data', (x) => { out += x; });
    child.on('exit', () => { exited = true; });
    const send = (m) => child.send(m);
    const count = (re) => (out.match(re) || []).length;
    const waitFor = async (re, ms, n) => { const t0 = Date.now(); while (count(new RegExp(re.source, 'g')) < (n || 1) && !exited && Date.now() - t0 < (ms || 15000)) await sleep(40); return count(new RegExp(re.source, 'g')) >= (n || 1); };
    try {
        console.log('1. the app starts');
        ok(await waitFor(/probe: start signal_probe/, 60000), 'the start line is in the log');
        await sleep(300);
        ok(!exited, 'the app is up (no exit)');

        console.log('2. the session, block by block');
        const setKey = (id) => 'set' + id.slice(1);
        let on = [];
        let nMark = 0, lastSetsLine = 0;
        const blocks = PLAN.blocks.filter((b) => Number(b.id.slice(1)) <= Number(UNTIL.slice(1)));
        const feedCount = {};
        for (const b of blocks) {
            const want = b.sets.slice();
            const off = on.filter((s) => want.indexOf(s) < 0), add = want.filter((s) => on.indexOf(s) < 0);
            off.forEach((s) => send({ t: 'set', key: setKey(s), value: false }));
            add.forEach((s) => send({ t: 'set', key: setKey(s), value: true }));
            if (off.length || add.length) {
                const ok1 = await waitFor(/probe: sets on=/, 15000, lastSetsLine + 1);
                lastSetsLine = count(/probe: sets on=/g);
                ok(ok1, b.id + ': the "sets on=" line for ' + (want.join('+') || 'none'));
                // the probe builds one interface's proxy at a time (a pause between them): wait until no new "watch" line comes,
                // as the lead waits for every "watch ... ok" line before the owner's first press (RUNBOOK 2.4)
                let w = -1, t0 = Date.now();
                while (count(/probe: watch /g) !== w && Date.now() - t0 < 20000) { w = count(/probe: watch /g); await sleep(700); }
                ok(count(/probe: watch [^\n]* error/g) === 0, b.id + ': every interface of the sets subscribed ("watch ... ok", no error), ' + w + ' watch lines so far');
            }
            on = want;
            let marksHere = 0, linesHere = 0;
            for (const s of b.steps) {
                if (!s.mark) continue;
                nMark++; marksHere++;
                send({ t: 'click', id: 'MARK' });
                const got = await waitFor(new RegExp('probe: mark M' + nMark + ' '), 5000);
                if (!got) { ok(false, s.id + ': mark ' + nMark + ' reached the log'); continue; }
                for (const pair of (s.expect || [])) {
                    const key = pair[0] + ':' + pair[1];
                    if (NEVER_SENT[key]) continue;
                    const fs_ = fieldsFor(pair[0], pair[1]);
                    for (const f of fs_) {
                        feedCount[key] = (feedCount[key] || 0) + 1;
                        const vals = valuesFor(f, feedCount[key]);
                        for (const v of vals) {
                            send({ t: 'fake', v: { feed: { iface: f.interface, field: f.field, value: v } } });
                            linesHere++;
                            await sleep(Math.max(40, (f.gapMs || 0) + 60));
                        }
                    }
                }
            }
            // let the block's first summary come (the +N s line), then on to the next
            await sleep(SUMMARY[0] * 1000 + 600);
            console.log('  ' + b.id + ' ' + b.title_uk + ': ' + marksHere + ' marks, ' + linesHere + ' values fed, sets ' + (want.join('+') || 'none'));
        }
        await sleep(400);

        console.log('3. the log');
        const lines = out.split('\n').filter((l) => /^\[signal_probe\] /.test(l)).map((l) => l.replace(/^\[signal_probe\] /, ''));
        const stamp = new Date().toISOString();
        const carLog = lines.map((l) => stamp + (/^WARN /.test(l) ? ' WARN ' + l.slice(5) : /^ERROR /.test(l) ? ' ERROR ' + l.slice(6) : ' INFO ' + l)).join('\n') + '\n';
        const logPath = path.join(OUT, 'signal_probe.log');
        fs.writeFileSync(logPath, carLog);
        const probeLines = lines.filter((l) => /probe: /.test(l));
        ok(probeLines.length > 0, probeLines.length + ' probe lines, ' + lines.length + ' app lines');
        ok(!/CANARY/i.test(out), 'no canary word anywhere in the app\'s output (every text member was a canary)');
        ok(!/ERROR|uncaught/.test(out), 'no ERROR and no uncaught exception in the output');
        ok(!exited, 'the app did not exit');
        const marksSeen = (carLog.match(/probe: mark M(\d+) /g) || []).map((m) => Number(/M(\d+)/.exec(m)[1]));
        ok(marksSeen.length === nMark && marksSeen.every((m, i) => m === i + 1), nMark + ' marks pressed, M1..M' + nMark + ' in the log in order');
        const sil = (carLog.match(/summary [^\n]*silent:[^\n]*/g) || []).join('\n');
        ok(/P13 sw-fav/.test(sil), 'the summary names the never-fed pair (P13 sw-fav) as silent');
        ok(/probe: summary S6 \+\d+s: \d+ of \d+ fields have spoken/.test(carLog), 'S6 summary ("have spoken") is there');

        console.log('4. verify_steps.py on the log');
        const vOut = path.join(OUT, 'verify.json');
        const verify = (extra) => spawnSync('python3', ['-I', path.join(ROOT, 'tools', 'car', 'verify_steps.py'), logPath, '--json', vOut, '--until', UNTIL].concat(extra), { encoding: 'utf8' });
        const r1 = verify([]);
        fs.writeFileSync(path.join(OUT, 'verify-strict.txt'), r1.stdout);
        const miss = r1.stdout.split('\n').filter((l) => /MISSING|NO MARK/.test(l));
        const expectMissing = UNTIL >= 'B1' ? 1 : 0;
        ok(miss.length === expectMissing && (!expectMissing || /sw-fav/.test(miss[0])), 'strict: only the never-fed pair is missing (' + miss.length + ' step(s): ' + miss.map((x) => x.trim().split(/\s+/)[1]).join(', ') + ')');
        const r2 = verify(['--silent', 'P13:sw-fav']);
        fs.writeFileSync(path.join(OUT, 'verify.txt'), r2.stdout);
        const sc = Number(UNTIL.slice(1));
        ok(r2.status === 0 || sc < 1, 'with the silent pair accepted: every required pair of every marked step found (exit ' + r2.status + ')');
        ok(!/PROBLEM/.test(r2.stdout), 'no problem line (marks contiguous, one run, the sets on at each mark are the block\'s)');
        console.log(r2.stdout.split('\n').slice(-3).join('\n'));

        console.log('5. the parser (package CL)');
        const parser = path.join(ROOT, 'tools', 'car', 'parse_logs.py'), collect = path.join(OUT, 'collection');
        if (fs.existsSync(parser) && fs.existsSync(path.join(__dirname, 'dry_run_layout.js'))) {
            // a collection folder as collect.sh makes it (CL's README names the layout)
            const layout = require('./dry_run_layout.js');
            layout.make(collect, logPath, ROOT);
            const p = spawnSync('python3', ['-I', parser, collect], { encoding: 'utf8', cwd: ROOT });
            fs.writeFileSync(path.join(OUT, 'parser.txt'), p.stdout + p.stderr);
            ok(p.status === 0, 'parse_logs.py ran on the dry-run collection (exit ' + p.status + ')');
        } else console.log('  skip: the parser (tools/car/parse_logs.py, package CL) or its collection layout is not here');
    } finally { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } }
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
