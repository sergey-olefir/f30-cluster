'use strict';
/**
 * test-daynight.js - fix/colour-daynight: the night colours follow the CAR's own day/night
 * (app.json config.dayNight, de.bmw.infotainment.vehicle.Vehicle.statusDayNightChangeOver) and fall back to the
 * sun (shared/sun.js) while that is missing or invalid.
 *
 *   node bench/test-daynight.js            (BENCH_PORT, default 8197)
 *
 * Without the bench: the app.json declaration passes tools/signals/check_signals.py against the car's catalogue
 * with a NON-ZERO getter (skipped, and said so, when reference/car/... is not there).
 * With the bench (its own, on BENCH_PORT, its own data folder), through bench/fake-signs.js { dayNight }:
 *   1. nothing from the car yet: the sun decides, and the log says so once;
 *   2. the car says night (2, or the name NACHT): night, the night colours on, whatever the sun says;
 *   3. the car says day (1): day, the night colours off;
 *   4. "no change" (0) keeps the car's last day/night;
 *   5. invalid (3) and a value the catalogue does not list (7): back to the sun;
 *   6. each change of the car's value is logged once, as a number, and each change of the source once.
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT) || 8197;
const BASE = 'http://127.0.0.1:' + PORT;
const CATALOGUE = path.join(ROOT, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daynight-'));
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
const setting = (key, value) => req('POST', '/setting', { key, value });
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await probe(); if (fn(p)) return p; } catch (e) { /* app (re)starting */ }
        await sleep(150);
    }
    return p;
}
const lines = (re) => logText.split('\n').filter((l) => re.test(l));
const count = (re) => lines(re).length;
const dn = (p) => (p && p.dayNight) || {};
const show = (p) => JSON.stringify(dn(p));

async function main() {
    console.log('the app.json declaration against the car\'s catalogue');
    if (fs.existsSync(CATALOGUE)) {
        const r = spawnSync('python3', [path.join(ROOT, 'tools', 'signals', 'check_signals.py'), CATALOGUE, path.join(ROOT, 'apps', 'f30_cluster', 'app.json')], { encoding: 'utf8' });
        const out = (r.stdout || '') + (r.stderr || '');
        ok(r.status === 0 && /all declarations pass/.test(out), 'tools/signals/check_signals.py: ' + (out.trim().split('\n').pop() || 'no output'));
        ok(/Vehicle\.statusDayNightChangeOver "r": getter id 19\b/.test(out) && /Vehicle\.statusDayNightChangeOver "s": notifier id 32787\b/.test(out),
            'statusDayNightChangeOver: getter 19 (non-zero), notifier 32787');
    } else console.log('  skip the catalogue check: ' + path.relative(ROOT, CATALOGUE) + ' is not here');

    console.log('bench on ' + BASE + ', data in ' + tmp);
    server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'f30_cluster'], {
        cwd: ROOT, env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, SCREEN_DIR: screenDir }),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (d) => { logText += d; if (/app exited/.test(String(d))) exited = true; };
    server.stdout.on('data', keep); server.stderr.on('data', keep);
    let p = await until((q) => q && q.ready && q.activeName, 90000);
    ok(p && p.ready, 'the app runs and reaches the fake cluster-render');
    if (!p || !p.ready) return;
    await setting('hudLayout', 'wb_comfort');
    await setting('nightDim', 'auto');
    p = await until((q) => q.activeName === 'wb_comfort' && q.settings.nightDim === 'auto' && dn(q).source, 20000);
    ok(p.activeName === 'wb_comfort' && p.settings.nightDim === 'auto', '6WB Comfort, night colours on Auto');

    console.log('1. nothing from the car: the sun decides');
    ok(dn(p).car === null && dn(p).source === 'sun' && dn(p).night === dn(p).sun && dn(p).nightOn === dn(p).sun,
        'the field missing: source sun, night = the sun\'s (' + show(p) + ')');
    ok(count(/day\/night source: the sun \(the car's day\/night is missing or invalid\)/) === 1, 'logged once: "day/night source: the sun ..."');
    const sunNight = dn(p).sun;

    console.log('2. the car says night');
    await fake({ dayNight: 'night' });
    p = await until((q) => dn(q).source === 'car' && dn(q).nightOn === true, 8000);
    ok(dn(p).car === 'night' && dn(p).night === true && dn(p).nightOn === true && dn(p).code === 2, 'night (2): night colours on (' + show(p) + ')');
    ok(count(/day\/night: the car says 2 -> night$/) === 1, 'logged: "day/night: the car says 2 -> night"');
    ok(count(/day\/night source: the car \(statusDayNightChangeOver\)/) === 1, 'logged once: "day/night source: the car (statusDayNightChangeOver)"');
    await fake({ dayNight: 'night' }); await fake({ dayNight: 2 });
    await sleep(400);
    ok(count(/day\/night: the car says /) === 1, 'the same value again: no new line');

    console.log('3. the car says day');
    await fake({ dayNight: 'day' });
    p = await until((q) => dn(q).car === 'day' && dn(q).nightOn === false, 8000);
    ok(dn(p).car === 'day' && dn(p).night === false && dn(p).nightOn === false && dn(p).source === 'car', 'day (1): night colours off (' + show(p) + ')');
    ok(count(/day\/night: the car says 1 -> day$/) === 1, 'logged: "day/night: the car says 1 -> day"');
    console.log('  (the sun says ' + (sunNight ? 'night' : 'day') + ' now, so the car overrode it in ' + (sunNight ? '3' : '2') + ')');

    console.log('4. "no change" (0) keeps the last day/night; an enum name works too');
    await fake({ dayNight: 'NACHT' });
    p = await until((q) => dn(q).car === 'night' && dn(q).nightOn === true, 8000);
    ok(dn(p).car === 'night' && dn(p).nightOn === true && dn(p).code === 2, 'NACHT (as a name): night (' + show(p) + ')');
    await fake({ dayNight: 'keep' });
    p = await until((q) => dn(q).code === 0, 8000);
    ok(dn(p).car === 'night' && dn(p).night === true && dn(p).source === 'car', 'KEINE_AENDERUNG (0): still night from the car (' + show(p) + ')');
    ok(count(/day\/night: the car says 0 -> keep$/) === 1, 'logged: "day/night: the car says 0 -> keep"');

    console.log('5. invalid: back to the sun');
    await fake({ dayNight: 'invalid' });
    p = await until((q) => dn(q).source === 'sun' && dn(q).nightOn === dn(q).sun, 8000);
    ok(dn(p).car === null && dn(p).code === 3 && dn(p).night === dn(p).sun && dn(p).nightOn === dn(p).sun, 'SIGNAL_UNGUELTIG (3): the sun (' + show(p) + ')');
    ok(count(/day\/night: the car says 3 -> invalid$/) === 1, 'logged: "day/night: the car says 3 -> invalid"');
    ok(count(/day\/night source: the sun /) === 2, 'the source change logged again (sun, car, sun)');
    await fake({ dayNight: 'keep' });
    p = await until((q) => dn(q).code === 0, 8000);
    ok(dn(p).car === null && dn(p).source === 'sun', '0 with no day/night from the car: still the sun (' + show(p) + ')');
    await fake({ dayNight: 'day' });
    p = await until((q) => dn(q).car === 'day', 8000);
    await fake({ dayNight: 7 });
    p = await until((q) => dn(q).code === 7, 8000);
    ok(dn(p).car === null && dn(p).source === 'sun' && dn(p).night === dn(p).sun, 'a value the catalogue does not list (7): the sun (' + show(p) + ')');
    ok(count(/day\/night: the car says 7 -> invalid$/) === 1, 'logged: "day/night: the car says 7 -> invalid"');

    await sleep(300);
    ok(lines(/day\/night: the car says /).every((l) => /the car says (\d+|\?) -> (day|night|keep|invalid)$/.test(l)), 'every value line is a number and a word');
    ok(!exited && !/uncaught|app exited/.test(logText), 'the app never exited (no uncaught exception)');
    ok(!/ERROR hud day\/night/.test(logText), 'no day/night error caught by the engine\'s guard');
}

main().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    if (server) server.kill('SIGTERM');
    console.log(lines(/day\/night/).map((l) => '  log: ' + l.replace(/^.*?day\/night/, 'day/night')).join('\n'));
    console.log(passed + ' passed, ' + failed + ' failed');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left in tmp */ }
    process.exit(failed ? 1 : 0);
});
