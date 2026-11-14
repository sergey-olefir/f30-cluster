'use strict';
/**
 * test-driver-profiles.js - a scripted test of apps/driver_profiles on the bench, in the style of test-native-ui.js.
 *
 *   node bench/test-driver-profiles.js          (BENCH_PORT, default 8131)
 *
 * Starts bench/server.js for driver_profiles with its own data folder. The bench gives the app a fake persod
 * (bench/fake-personalization.js: Guest active, a Valet, two local profiles). The test presses the native components
 * as the car's HMI sends them (POST /click, POST /hmi back), steers the fake (POST /fake: active profile, protection,
 * engine, limits, failures) and reads back what the app wrote and what the fake was asked (GET /probe):
 * the list, a profile's details, Add / Rename / Copy / Delete through their confirm screens, the two-press Delete,
 * every refusal (Guest not active, protected, engine running, the active profile, Guest / Valet, BMW ID,
 * MAX_NUM_EXCEEDED), that nothing but the four allowed writes is ever sent, and that the app never exits.
 *
 * The bench does not draw native screens (the HMI does that on the car): this checks the app's side only.
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.BENCH_PORT) || 8131;
const BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'driver-profiles-'));
const ALLOWED = ['createUserAccount', 'set UserAccount.name', 'copyGuestData', 'removeUserAccount'];

let server = null, exited = false, logText = '';
let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, url, body) {
    const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 200) return r.json();
    if (r.status !== 204) throw new Error(method + ' ' + url + ': ' + r.status);
    return null;
}
const probe = () => req('GET', '/probe');
const click = (id) => req('POST', '/click', { id });
const fake = (v) => req('POST', '/fake', v);
const back = () => req('POST', '/hmi', { a: 'back' });
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await probe(); if (p && fn(p)) return p; } catch (e) { /* (re)starting */ }
        await sleep(120);
    }
    return p;
}
const n = (p, c) => p.native[c] || {};
const txt = (p, c) => n(p, c).text || '';
const r1 = (p, c) => (n(p, c).cells || {}).Text1stRow || '';
const r2 = (p, c) => (n(p, c).cells || {}).Text2ndRow || '';
const vis = (p, c) => n(p, c).visible;
const top = (p) => p.stack[p.stack.length - 1];
const calls = (p, name) => p.perso.calls.filter((c) => c.call === name).length;
const acc = (p, s) => p.perso.accounts[s];

async function toMain() {
    for (let i = 0; i < 5; i++) {
        const p = await probe();
        if (top(p) === 'MAIN') return p;
        await back();
        await sleep(150);
    }
    return probe();
}

async function main() {
    console.log('bench on ' + BASE + ', data in ' + tmp);
    server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'driver_profiles'], {
        cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: tmp }),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (d) => { logText += d; if (/app exited/.test(String(d))) exited = true; };
    server.stdout.on('data', keep); server.stderr.on('data', keep);

    console.log('the list');
    let p = await until((q) => q.perso && /^Active: Guest/.test(txt(q, 'STATUS')) && r1(q, 'P_I02'), 60000);
    ok(p && p.perso, 'the app runs with the fake persod');
    if (!p || !p.perso) return;
    ok(JSON.stringify(p.stack) === '["MAIN"]', 'entry screen MAIN');
    ok(/^Active: Guest\. 2 personal of 7, 5 free/.test(txt(p, 'STATUS')), 'STATUS: "' + txt(p, 'STATUS') + '"');
    ok(r1(p, 'P_GUEST') === 'Guest  (active)' && vis(p, 'P_GUEST') === true, 'Guest row marked active');
    ok(r1(p, 'P_I01') === 'Driver A' && /Personal, local, protection: none/.test(r2(p, 'P_I01')), 'i01 row: "' + r1(p, 'P_I01') + '" / "' + r2(p, 'P_I01') + '"');
    ok(['P_I03', 'P_I04', 'P_I05', 'P_I06', 'P_I07'].every((c) => vis(p, c) === false), 'free slots hidden');
    ok(['P_GUEST', 'P_VALET', 'P_I01', 'P_I02'].every((c) => vis(p, c) === true), 'existing slots shown');

    console.log('a profile');
    await click('P_I01');
    p = await until((q) => top(q) === 'PROFILE' && r2(q, 'D_NAME') === 'Driver A');
    ok(top(p) === 'PROFILE', 'a press on i01 opens PROFILE');
    ok(r2(p, 'D_ACCOUNT') === 'Local (offline), no BMW ID' && r2(p, 'D_PROTECTION') === 'none' && /Personal/.test(r2(p, 'D_TYPE')), 'details: ' + r2(p, 'D_TYPE') + ' / ' + r2(p, 'D_ACCOUNT') + ' / ' + r2(p, 'D_PROTECTION'));
    ok(r2(p, 'D_COPIED') === 'never' && /^Slot 1 \(i01\), id i/.test(r2(p, 'D_ID')), 'copied: ' + r2(p, 'D_COPIED') + ', ' + r2(p, 'D_ID'));
    ok(/not known yet/.test(r2(p, 'D_PIA')), 'PIA number of an inactive, never-seen profile: "' + r2(p, 'D_PIA') + '"');
    ok(vis(p, 'A_DELETE') === true && vis(p, 'A_RENAME') === true && txt(p, 'A_COPY') === "Copy Guest's settings here", 'Rename, Copy and Delete offered');
    await back();
    await click('P_GUEST');
    p = await until((q) => top(q) === 'PROFILE' && r2(q, 'D_NAME') === 'Guest');
    ok(vis(p, 'A_DELETE') === false && /never deleted/.test(txt(p, 'A_DELETE')), 'Guest: Delete not offered ("' + txt(p, 'A_DELETE') + '")');
    ok(vis(p, 'A_RENAME') === false && vis(p, 'A_COPY') === false, 'Guest: no Rename, no Copy');
    ok(/^10 \(Guest\)$/.test(r2(p, 'D_PIA')), 'Guest PIA 10');
    await click('A_DELETE');
    await sleep(300);
    p = await probe();
    ok(top(p) === 'PROFILE' && calls(p, 'removeUserAccount') === 0, 'pressing Delete on Guest opens nothing, sends nothing');
    p = await toMain();

    console.log('Add a local profile');
    await click('BTN_ADD');
    p = await until((q) => top(q) === 'NAMES' && txt(q, 'N_0') === 'Driver 1');
    ok(top(p) === 'NAMES' && txt(p, 'N_AUTO') === 'Profile 1' && vis(p, 'N_4') === false, 'NAMES: presets from config, "Profile 1", extra rows hidden');
    await click('N_0');
    p = await until((q) => top(q) === 'CONFIRM' && /Driver 1/.test(txt(q, 'C_WHAT')));
    ok(/Add a local profile named "Driver 1"/.test(txt(p, 'C_WHAT')) && /all fine/.test(txt(p, 'C_CHECK')), 'CONFIRM: "' + txt(p, 'C_WHAT') + '" / "' + txt(p, 'C_CHECK') + '"');
    ok(calls(p, 'createUserAccount') === 0, 'nothing sent before Yes');
    await click('C_YES');
    p = await until((q) => /Result/.test(txt(q, 'C_RESULT')));
    ok(txt(p, 'C_RESULT') === 'Result: SUCCESS (code 0)', 'result: "' + txt(p, 'C_RESULT') + '" / "' + txt(p, 'C_RESULT2') + '"');
    ok(acc(p, 'i03') && acc(p, 'i03').name === 'Driver 1' && acc(p, 'i03').type === 'USER', 'the fake persod has i03 "Driver 1"');
    ok(txt(p, 'C_NO') === 'Back' && vis(p, 'C_YES') === false, 'after the result: Back, no Yes');
    await click('C_NO');
    p = await until((q) => top(q) === 'MAIN' && r1(q, 'P_I03') === 'Driver 1' && vis(q, 'P_I03') === true);
    ok(top(p) === 'MAIN' && vis(p, 'P_I03') === true, 'back on MAIN, i03 listed (stack ' + JSON.stringify(p.stack) + ')');
    ok(/^Add: Result: SUCCESS/.test(txt(p, 'MSG')), 'MSG: "' + txt(p, 'MSG') + '"');

    console.log('a name in use is refused');
    await click('BTN_ADD');
    p = await until((q) => top(q) === 'NAMES' && /in use/.test(txt(q, 'N_0')));
    ok(txt(p, 'N_0') === 'Driver 1  (in use)', 'NAMES marks "Driver 1 (in use)"');
    await click('N_0');
    await sleep(300);
    p = await probe();
    ok(top(p) === 'NAMES' && /already/.test(txt(p, 'N_HINT')), 'pressing it stays on NAMES: "' + txt(p, 'N_HINT') + '"');
    await click('N_CANCEL');
    p = await toMain();

    console.log('Rename');
    await click('P_I03');
    await until((q) => top(q) === 'PROFILE' && r2(q, 'D_NAME') === 'Driver 1');
    await click('A_RENAME');
    p = await until((q) => top(q) === 'NAMES' && /New name for "Driver 1"/.test(txt(q, 'N_HINT')));
    ok(top(p) === 'NAMES', 'Rename opens NAMES: "' + txt(p, 'N_HINT') + '"');
    await click('N_AUTO');
    p = await until((q) => top(q) === 'CONFIRM' && /Rename/.test(txt(q, 'C_WHAT')));
    ok(/Rename "Driver 1" \(i03\) to "Profile 1"/.test(txt(p, 'C_WHAT')), 'CONFIRM: "' + txt(p, 'C_WHAT') + '"');
    await click('C_YES');
    p = await until((q) => /Result/.test(txt(q, 'C_RESULT')));
    ok(/name set/.test(txt(p, 'C_RESULT')) && acc(p, 'i03').name === 'Profile 1', 'renamed: "' + txt(p, 'C_RESULT') + '"');
    await click('C_NO');
    p = await until((q) => top(q) === 'PROFILE' && r2(q, 'D_NAME') === 'Profile 1');
    ok(top(p) === 'PROFILE' && r2(p, 'D_NAME') === 'Profile 1', 'back on PROFILE with the new name');

    console.log("Copy Guest's settings");
    await click('A_COPY');
    p = await until((q) => top(q) === 'CONFIRM' && /Copy Guest/.test(txt(q, 'C_WHAT')));
    ok(/Copy Guest's settings into "Profile 1" \(i03\)/.test(txt(p, 'C_WHAT')), 'CONFIRM: "' + txt(p, 'C_WHAT') + '"');
    await click('C_YES');
    p = await until((q) => /Result/.test(txt(q, 'C_RESULT')));
    ok(txt(p, 'C_RESULT') === 'Result: SUCCESS (code 1)' && acc(p, 'i03').copyTs > 0, 'copied: "' + txt(p, 'C_RESULT') + '" / "' + txt(p, 'C_RESULT2') + '"');
    await click('C_NO');
    p = await until((q) => top(q) === 'PROFILE' && / UTC$/.test(r2(q, 'D_COPIED')));
    ok(/ UTC$/.test(r2(p, 'D_COPIED')), "Guest's settings copied: " + r2(p, 'D_COPIED'));

    console.log('Copy refused: protected, Guest not active');
    p = await toMain();
    await fake({ protect: { i02: ['KEYFOB'] } });
    await click('P_I02');
    p = await until((q) => top(q) === 'PROFILE' && r2(q, 'D_NAME') === 'Driver B' && /protected/.test(txt(q, 'A_COPY')));
    ok(/not now \(it is protected \(key\)/.test(txt(p, 'A_COPY')) && r2(p, 'D_PROTECTION') === 'key', 'protected i02: "' + txt(p, 'A_COPY') + '"');
    const copies = calls(p, 'copyGuestData');
    await click('A_COPY');
    await sleep(300);
    p = await probe();
    ok(top(p) === 'PROFILE' && calls(p, 'copyGuestData') === copies && /Copy not possible now/.test(txt(p, 'P_NOTE')), 'pressing it: no CONFIRM, nothing sent ("' + txt(p, 'P_NOTE') + '")');
    p = await toMain();
    await fake({ current: 'i01' });
    p = await until((q) => /^Active: Driver A/.test(txt(q, 'STATUS')) && r1(q, 'P_I01') === 'Driver A  (active)');
    ok(r1(p, 'P_I01') === 'Driver A  (active)' && r1(p, 'P_GUEST') === 'Guest', 'active profile follows currentUserOnChange');
    await click('P_I03');
    p = await until((q) => top(q) === 'PROFILE' && /Guest is not the active profile/.test(txt(q, 'A_COPY')));
    ok(/Guest is not the active profile/.test(txt(p, 'A_COPY')), 'Guest not active: "' + txt(p, 'A_COPY') + '"');
    await back();
    await click('P_I01');
    p = await until((q) => top(q) === 'PROFILE' && r2(q, 'D_NAME') === 'Driver A');
    ok(vis(p, 'A_DELETE') === false && /active profile/.test(txt(p, 'A_DELETE')), 'the active profile: Delete not offered');
    ok(/^0 \(active now\)$/.test(r2(p, 'D_PIA')), 'the active profile\'s PIA number: ' + r2(p, 'D_PIA'));
    p = await toMain();
    await fake({ current: 'guest' });
    await until((q) => /^Active: Guest/.test(txt(q, 'STATUS')));
    await click('P_I01');
    p = await until((q) => top(q) === 'PROFILE' && r2(q, 'D_NAME') === 'Driver A' && /seen while/.test(r2(q, 'D_PIA')));
    ok(/^0 \(seen while it was active\)$/.test(r2(p, 'D_PIA')), 'PIA number remembered once seen: ' + r2(p, 'D_PIA'));
    p = await toMain();

    console.log('Delete: two presses');
    await click('P_I03');
    await until((q) => top(q) === 'PROFILE' && r2(q, 'D_NAME') === 'Profile 1');
    await click('A_DELETE');
    p = await until((q) => top(q) === 'CONFIRM' && /Delete "Profile 1"/.test(txt(q, 'C_WHAT')));
    ok(txt(p, 'C_YES') === 'Delete', 'CONFIRM: "' + txt(p, 'C_WHAT') + '"');
    await click('C_YES');
    p = await until((q) => /Press again/.test(txt(q, 'C_YES')));
    ok(/Press again to delete "Profile 1"/.test(txt(p, 'C_YES')) && calls(p, 'removeUserAccount') === 0, 'first press only arms it: "' + txt(p, 'C_YES') + '"');
    await back();                                  // leaving disarms
    await click('A_DELETE');
    p = await until((q) => top(q) === 'CONFIRM' && txt(q, 'C_YES') === 'Delete');
    ok(txt(p, 'C_YES') === 'Delete', 'back and in again: not armed any more');
    await click('C_YES');
    await until((q) => /Press again/.test(txt(q, 'C_YES')));
    await click('C_YES');
    p = await until((q) => /Result/.test(txt(q, 'C_RESULT')));
    ok(txt(p, 'C_RESULT') === 'Result: SUCCESS (code 0)' && !acc(p, 'i03') && calls(p, 'removeUserAccount') === 1, 'deleted: "' + txt(p, 'C_RESULT') + '" / "' + txt(p, 'C_RESULT2') + '"');
    await click('C_NO');
    p = await until((q) => top(q) === 'MAIN' && vis(q, 'P_I03') === false);
    ok(top(p) === 'MAIN' && vis(p, 'P_I03') === false, 'back on MAIN, i03 gone (stack ' + JSON.stringify(p.stack) + ')');

    console.log('the engine running blocks every write');
    await fake({ engine: true });
    await sleep(1200);
    await click('BTN_ADD');
    await until((q) => top(q) === 'NAMES');
    await click('N_1');
    p = await until((q) => top(q) === 'CONFIRM' && /engine is running/.test(txt(q, 'C_CHECK')));
    ok(/engine is running/.test(txt(p, 'C_CHECK')), 'CONFIRM shows it: "' + txt(p, 'C_CHECK') + '"');
    const creates = calls(p, 'createUserAccount');
    await click('C_YES');
    p = await until((q) => /Not sent/.test(txt(q, 'C_RESULT')));
    ok(/Not sent: the engine is running/.test(txt(p, 'C_RESULT')) && calls(p, 'createUserAccount') === creates, 'Yes: "' + txt(p, 'C_RESULT') + '", nothing sent');
    await fake({ engine: false, gear: 'D' });
    await sleep(1200);
    await click('C_YES');
    p = await until((q) => /not in P/.test(txt(q, 'C_RESULT')));
    ok(/not in P/.test(txt(p, 'C_RESULT')) && calls(p, 'createUserAccount') === creates, 'not in P: "' + txt(p, 'C_RESULT') + '"');
    await fake({ gear: 'P' });
    p = await toMain();

    console.log('MAX_NUM_EXCEEDED');
    await fake({ maxUsers: 2 });
    await click('BTN_ADD');
    await until((q) => top(q) === 'NAMES');
    await click('N_1');
    await until((q) => top(q) === 'CONFIRM' && /all fine/.test(txt(q, 'C_CHECK')), 4000);
    await click('C_YES');
    p = await until((q) => /Result/.test(txt(q, 'C_RESULT')));
    ok(txt(p, 'C_RESULT') === 'Result: MAX_NUM_EXCEEDED (code 1)' && /provisioned limit/.test(txt(p, 'C_RESULT2')), 'result: "' + txt(p, 'C_RESULT') + '" / "' + txt(p, 'C_RESULT2') + '"');
    await fake({ maxUsers: 7 });
    p = await toMain();

    console.log('a BMW ID profile');
    await fake({ bmwId: 'i02', protect: { i02: [] } });
    await sleep(600);
    await click('P_I02');
    p = await until((q) => top(q) === 'PROFILE' && /^BMW ID/.test(r2(q, 'D_ACCOUNT')));
    ok(r2(p, 'D_ACCOUNT') === 'BMW ID: d***@example.com', 'account masked: "' + r2(p, 'D_ACCOUNT') + '"');
    ok(vis(p, 'A_RENAME') === false && vis(p, 'A_DELETE') === false, 'BMW ID: no Rename, no Delete here');
    p = await toMain();

    console.log('a failing call');
    await fake({ fail: 'copyGuestData' });
    await click('P_I01');
    await until((q) => top(q) === 'PROFILE' && r2(q, 'D_NAME') === 'Driver A');
    await click('A_COPY');
    await until((q) => top(q) === 'CONFIRM');
    await click('C_YES');
    p = await until((q) => /Error/.test(txt(q, 'C_RESULT')));
    ok(/^Error: fake: copyGuestData made to fail/.test(txt(p, 'C_RESULT')), 'shown: "' + txt(p, 'C_RESULT') + '"');
    await fake({ fail: null });
    p = await toMain();

    console.log('odd input');
    await click('NO_SUCH_COMPONENT');
    await click('C_YES');                  // CONFIRM not open
    await click('N_9');                    // an empty preset row
    await click('P_I05');                  // a free slot
    p = await until((q) => /Slot 5 is free/.test(txt(q, 'MSG')));
    ok(/Slot 5 is free/.test(txt(p, 'MSG')), 'a free slot row: "' + txt(p, 'MSG') + '"');

    console.log('only the four writes, ever');
    p = await probe();
    const names = p.perso.calls.map((c) => c.call);
    ok(names.every((c) => ALLOWED.indexOf(c) >= 0), 'calls made: ' + JSON.stringify(names));
    ok(calls(p, 'createUserAccount') === 2 && calls(p, 'set UserAccount.name') === 1 && calls(p, 'copyGuestData') === 2 && calls(p, 'removeUserAccount') === 1,
        'one per confirmed Yes (2 creates incl. MAX_NUM_EXCEEDED, 1 rename, 2 copies incl. the failing one, 1 delete)');
    await sleep(800);
    ok(!exited && !/uncaught|app exited/.test(logText), 'the app never exited (no uncaught exception)');
    ok(!/Driver A|Driver B|Profile 1|example\.com/.test(logText.split('\n').filter((l) => /\[driver_profiles\]/.test(l) && !/bench:/.test(l)).join('\n')), 'no profile names or e-mail in the app log');
}

main().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    if (server) server.kill('SIGTERM');
    const errs = logText.split('\n').filter((l) => /ERROR/.test(l));
    if (errs.length) { console.log('app errors in the log:'); errs.slice(0, 20).forEach((l) => console.log('  ' + l)); }
    console.log(passed + ' passed, ' + failed + ' failed');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left in tmp */ }
    process.exit(failed ? 1 : 0);
});
