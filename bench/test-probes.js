'use strict';
/**
 * test-probes.js - the 0.7.18 diagnostics (shared/hud.js "probes"): read only, log only.
 *
 *   node bench/test-probes.js            (BENCH_PORT, default 8193)
 *
 * Without the bench: every app.json "signals" declaration passes tools/signals/check_signals.py against the car's
 * catalogue (skipped, and said so, when reference/car/... is not there).
 * With the bench (its own, on BENCH_PORT, its own data folder), through bench/fake-signs.js:
 *   1. every new vehicle condition is logged once ("probe: vehicle condition N"), in any layout;
 *   2. ccList / ccListRiskClass / basicList are logged once per change, numbers and enum names only, and the
 *      handler already on ccList (config.ccList) still runs;
 *   3. requestDefaultSymbols is called ONCE by itself after start, with CC_LIST_SYMBOL, and only the count, ids,
 *      formats and byte lengths are logged; a failing, throwing, hanging, absent or nonsense provider only logs a
 *      warning, and the app never exits.
 * And no text of a message and no byte of a symbol ever reaches the log.
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT) || 8193;
const BASE = 'http://127.0.0.1:' + PORT;
const CATALOGUE = path.join(ROOT, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'probes-'));
const dataDir = path.join(tmp, 'data'), screenDir = path.join(tmp, 'screen');
fs.mkdirSync(dataDir); fs.mkdirSync(screenDir);

let server = null, exited = false, logText = '';
let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, url, body) {
    for (let i = 0; i < 8; i++) {
        try {
            const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', connection: 'close' }, body: body ? JSON.stringify(body) : undefined });
            if (r.status === 200) return r.json();
            if (r.status === 204) return null;
            throw new Error(method + ' ' + url + ': ' + r.status);
        } catch (e) { if (i === 7) throw e; await sleep(400); }
    }
    return null;
}
const probe = () => req('GET', '/probe');
const fake = (v) => req('POST', '/fake', v);
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await probe(); if (fn(p)) return p; } catch (e) { /* app (re)starting */ }
        await sleep(150);
    }
    return p;
}
/** Wait until the log matches re (up to ms); the matching lines. */
async function logged(re, ms) {
    const end = Date.now() + (ms || 8000);
    while (Date.now() < end && !re.test(logText)) await sleep(100);
    return lines(re);
}
const lines = (re) => logText.split('\n').filter((l) => re.test(l));
const count = (re) => lines(re).length;
const sym = (p) => ((p && p.signs) || {}).symbols || {};

// invented message texts: none of them may ever reach the log
const SECRET = ['Bench secret text one', 'Bench secret text two', 'Bench secret three'];
const RISK_A = [
    { id: 201, name: SECRET[0], color: 'YELLOW', risk: 'RK30', symbol: 44 },
    { id: 202, name: SECRET[1], color: 'RED', risk: 'RK90', symbol: 12 },
];
const RISK_B = [{ id: 203, name: SECRET[2], color: 'WHITE', risk: 'RK10', symbol: 3 }];

async function main() {
    console.log('the app.json declarations against the car\'s catalogue');
    if (fs.existsSync(CATALOGUE)) {
        const r = spawnSync('python3', [path.join(ROOT, 'tools', 'signals', 'check_signals.py'), CATALOGUE, path.join(ROOT, 'apps', 'f30_cluster', 'app.json')], { encoding: 'utf8' });
        const out = (r.stdout || '') + (r.stderr || '');
        ok(r.status === 0, 'tools/signals/check_signals.py: ' + (out.trim().split('\n').pop() || 'no output'));
        if (r.status !== 0) out.split('\n').filter((l) => /FAIL/.test(l)).forEach((l) => console.log('    ' + l));
        ok(/KombiInterface_2 method requestDefaultSymbols: methodId 15/.test(out), 'requestDefaultSymbols is declared, methodId 15');
        ok(/KombiInterface_2\.ccListRiskClass "r": getter id 16/.test(out) && /CheckControlMaster\.basicList "r": getter id 1\b/.test(out),
            'ccListRiskClass (getter 16) and basicList (getter 1) read with non-zero getters');
    } else console.log('  skip the catalogue check: ' + path.relative(ROOT, CATALOGUE) + ' is not here');

    console.log('bench on ' + BASE + ', data in ' + tmp);
    server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'f30_cluster'], {
        cwd: ROOT, env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, SCREEN_DIR: screenDir }),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (d) => { logText += d; if (/app exited/.test(String(d))) exited = true; };
    server.stdout.on('data', keep); server.stderr.on('data', keep);
    const t0 = Date.now();
    let p = await until((q) => q && q.ready && q.activeName, 90000);
    ok(p && p.ready, 'the app runs and reaches the fake cluster-render');
    if (!p || !p.ready) return;

    console.log('2. the stored check-control lists: once per change, numbers only');
    await fake({ ccRisk: RISK_A });
    let l = await logged(/probe: ccListRiskClass: 2 entries/);
    ok(l.length === 1 && /probe: ccListRiskClass: 2 entries: \[id 201 colour YELLOW risk RK30 symbol 44\] \[id 202 colour RED risk RK90 symbol 12\]$/.test(l[0]),
        'ccListRiskClass: ' + (l[0] || '').replace(/^.*probe: /, 'probe: '));
    await fake({ ccRisk: RISK_A }); await fake({ ccRisk: RISK_A });
    await sleep(300);
    ok(count(/probe: ccListRiskClass: /) === 1, 'the same list twice more: still one line');
    await fake({ ccRisk: RISK_B });
    await logged(/probe: ccListRiskClass: 1 entry: \[id 203 colour WHITE risk RK10 symbol 3\]/);
    ok(count(/probe: ccListRiskClass: /) === 2, 'a changed list: one more line');
    await fake({ ccRisk: [] });
    l = await logged(/probe: ccListRiskClass: 0 entries/);
    ok(l.length === 1, 'an empty list: "0 entries"');
    await fake({ ccRisk: { cCListRiskClassElement: 'not a list' } });
    l = await logged(/probe: ccListRiskClass: not a list \(object\)/);
    ok(l.length === 1, 'something that is not a list: says so, and nothing of it');

    await fake({ scene: 'cc-three' });
    l = await logged(/probe: ccList: 3 entries/);
    // (the fake turns colours back through config.ccList.colorMap, whose wire numbers come first: 2 yellow, 4 orange, 1 red)
    ok(l.length === 1 && /\[id 101 colour 2 symbol -\] \[id 102 colour 4 symbol -\] \[id 103 colour 1 symbol -\]$/.test(l[0]),
        'ccList: ' + (l[0] || '').replace(/^.*probe: /, 'probe: '));
    p = await until((q) => q.signs && q.signs.cc && q.signs.cc.list === 3, 5000);
    ok(p.signs.cc.list === 3 && /check-control list: 3 messages/.test(logText), 'config.ccList\'s own handler still runs behind it (3 messages)');

    await fake({ ccBasic: [{ id: 301, reason: 'CCM_SHOWN_BY_IC', state: 'AKTIV' }, { id: 302, reason: 2, state: 1 }] });
    l = await logged(/probe: basicList: 2 entries/);
    ok(l.length === 1 && /probe: basicList: 2 entries: \[id 301 reason CCM_SHOWN_BY_IC state AKTIV\] \[id 302 reason 2 state 1\]$/.test(l[0]),
        'basicList: ' + (l[0] || '').replace(/^.*probe: /, 'probe: '));

    console.log('3. requestDefaultSymbols: once, by itself, counted and dropped');
    l = await logged(/probe: cc symbols: /, Math.max(5000, 45000 - (Date.now() - t0)));
    ok(l.length === 1 && /probe: cc symbols: 3 symbols: \[id 1 PNG 1024 bytes\] \[id 2 RLE32 4096 bytes\] \[id 33 JPEG 0 bytes\]$/.test(l[0]),
        'the line: ' + (l[0] || '(none)').replace(/^.*probe: /, 'probe: '));
    p = await probe();
    ok(sym(p).calls === 1 && sym(p).params[0] && sym(p).params[0].method === 'requestDefaultSymbols' && sym(p).params[0].symbolType === 'CC_LIST_SYMBOL',
        'called once, with CC_LIST_SYMBOL (' + JSON.stringify(sym(p).params) + ')');
    console.log('  (6 s more: it must not be called again)');
    await sleep(6000);
    p = await probe();
    ok(sym(p).calls === 1, 'still one call after ' + Math.round((Date.now() - t0) / 1000) + ' s');

    const tries = [
        ['fail', /probe: cc symbols: requestDefaultSymbols failed: bench: REQUEST_FAILED/, 5000],
        ['throw', /probe: cc symbols: requestDefaultSymbols failed: bench: callMethod threw/, 5000],
        ['garbage', /probe: cc symbols: the reply is not a list \(string\)/, 5000],
        ['absent', /probe: cc symbols: requestDefaultSymbols failed: emulator: no SOME\/IP/, 5000],
        ['hang', /probe: cc symbols: requestDefaultSymbols failed: no answer in 8000 ms/, 12000],
    ];
    for (const [mode, re, ms] of tries) {
        await fake({ symbols: mode });
        await fake({ hook: 'symbolsAgain' });
        l = await logged(re, ms);
        ok(l.length === 1 && /WARN/.test(l[0]), mode + ': one warning, nothing thrown (' + (l[0] || '(none)').replace(/^.*probe: /, 'probe: ') + ')');
    }
    await fake({ symbols: 'ok' });

    console.log('1. the vehicle condition: every new value once, in any layout');
    await req('POST', '/signals', { mode: 'manual', values: { rpm: 0, speed: 0, gear: 0, oil: 60, coolant: 60, condition: 7 } });
    l = await logged(/probe: vehicle condition 7$/);
    ok(l.length === 1, 'condition 7: "' + (l[0] || '(none)').replace(/^.*probe: /, 'probe: ') + '"');
    await req('POST', '/signals', { mode: 'manual', values: { rpm: 0, speed: 0, gear: 0, oil: 60, coolant: 60, condition: 5 } });
    l = await logged(/probe: vehicle condition 5 /);
    ok(l.length === 1 && /= COND_STANDBY/.test(l[0]), 'condition 5: "' + (l[0] || '(none)').replace(/^.*probe: /, 'probe: ') + '"');
    await sleep(1500);          // the manual feed goes on 20 times a second: still one line each
    ok(count(/probe: vehicle condition 7$/) === 1 && count(/probe: vehicle condition 5 /) === 1, 'each value logged once, though fed 20 times a second');

    await sleep(500);
    ok(!exited && !/uncaught|app exited/.test(logText), 'the app never exited (no uncaught exception)');
    ok(!/ERROR hud probes/.test(logText), 'no probe error caught by the engine\'s guard');
}

main().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    if (server) server.kill('SIGTERM');
    // privacy and BMW's artwork: no message text, and no symbol byte (as text, or as the JSON of a Buffer)
    // (bench/server.js echoes each POST /fake body as "bench: fake persod {...}": that is this test's own input, not
    // the app's log, so those lines are left out)
    const leak = logText.split('\n').filter((l) => !/bench: fake persod /.test(l))
        .filter((l) => SECRET.some((s) => l.indexOf(s) >= 0) || /BENCHSYM|66,69,78,67,72/.test(l));
    console.log(leak.length ? 'LEAK: ' + leak.length + ' log line(s) carry message text or symbol bytes:\n  ' + leak.slice(0, 5).join('\n  ')
        : 'privacy: no message text and no symbol byte in the log');
    if (leak.length) failed++;
    console.log(passed + ' passed, ' + failed + ' failed');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left in tmp */ }
    process.exit(failed ? 1 : 0);
});
