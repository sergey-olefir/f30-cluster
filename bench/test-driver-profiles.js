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
 * MAX_NUM_EXCEEDED), that nothing but the allowed writes is ever sent, and that the app never exits.
 *
 * 0.2.0 also covers the avatar: the type on the profile screen, the Avatar screen with no folder and with files,
 * each preset, that the app ships no pictures of its own, the owner's own picture written as avatar + avatarType =
 * INDIVIDUAL, the app's own size refusal, a car-side rejection, the engine-off gate on an avatar write, and that no
 * picture and no file name reach the log.
 *
 * The bench does not draw native screens (the HMI does that on the car): this checks the app's side only.
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.BENCH_PORT) || 8170;
const BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'driver-profiles-'));
const ALLOWED = ['createUserAccount', 'set UserAccount.name', 'set UserAccount.avatar', 'set UserAccount.avatarType',
    'copyGuestData', 'removeUserAccount'];
// the app's own avatars folder, where the owner drops a jpg (app.json config.avatarMaxKB = 48)
const AVDIR = path.join(tmp, 'avatars');
const MAXKB = 48;
/** A buffer that passes the app's JPEG-header check, of exactly that many bytes. */
function jpeg(bytes) {
    const b = Buffer.alloc(bytes, 0x5a);
    b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0;
    b[bytes - 2] = 0xff; b[bytes - 1] = 0xd9;
    return b;
}
/** The same checksum the app and the fake use, so the test can prove which bytes arrived without printing any. */
const sum = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2147483647; return h; };
// 0.2.2: the app ships no pictures of its own; a custom avatar only ever comes from the owner's data folder
const BUNDLE_DIR = path.join(__dirname, '..', 'apps', 'driver_profiles', 'avatars');

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

    console.log('the avatar: the profile row, and the Avatar screen with no folder');
    await click('P_I01');
    p = await until((q) => top(q) === 'PROFILE' && r2(q, 'D_NAME') === 'Driver A');
    ok(r2(p, 'D_AVATAR') === 'Default (DEFAULT)', 'the avatar row: "' + r2(p, 'D_AVATAR') + '"');
    ok(txt(p, 'A_AVATAR') === 'Avatar: Default - change it' && vis(p, 'A_AVATAR') === true, 'the Avatar button: "' + txt(p, 'A_AVATAR') + '"');
    ok(!fs.existsSync(AVDIR), 'no avatars folder yet (the normal state before the owner puts a picture there)');
    await click('A_AVATAR');
    p = await until((q) => top(q) === 'AVATAR' && txt(q, 'AV_PATH'));
    ok(top(p) === 'AVATAR', 'the Avatar screen opens (stack ' + JSON.stringify(p.stack) + ')');
    ok(/^Avatar of "Driver A" - now: Default \(DEFAULT\)$/.test(txt(p, 'AV_NOW')), 'it says what is set now: "' + txt(p, 'AV_NOW') + '"');
    ok(txt(p, 'AV_T0') === 'Default  (set now)' && txt(p, 'AV_T7') === 'Avatar 7' && txt(p, 'AV_T15') === 'Avatar 15',
        'Default and the 15 built-in avatars by number: "' + txt(p, 'AV_T0') + '", "' + txt(p, 'AV_T7') + '", "' + txt(p, 'AV_T15') + '"');
    ok(['AV_T0', 'AV_T1', 'AV_T8', 'AV_T15'].every((c) => vis(p, c) === true), 'the preset rows are shown');
    ok(['AV_F0', 'AV_F1', 'AV_F2', 'AV_F3', 'AV_F4', 'AV_F5'].every((c) => vis(p, c) === false), 'no file rows with no folder');
    ok(vis(p, 'AV_EMPTY') === true && /Make this folder, put a \.jpg in it/.test(txt(p, 'AV_EMPTY')), 'it says what to do: "' + txt(p, 'AV_EMPTY') + '"');
    ok(txt(p, 'AV_PATH') === AVDIR, 'and the full path of the folder: "' + txt(p, 'AV_PATH') + '"');
    ok(new RegExp('The ' + MAXKB + ' KB limit is our guess').test(txt(p, 'AV_NOTE')), 'the note names the limit and its standing: "' + txt(p, 'AV_NOTE') + '"');
    ok(!fs.existsSync(BUNDLE_DIR) && n(p, 'AV_BUNDLED').text === undefined && n(p, 'AV_B0').visible === undefined,
        'the app ships no pictures: no apps/driver_profiles/avatars/ folder and no rows for one on the Avatar screen');

    console.log('a preset avatar');
    ok(calls(p, 'set UserAccount.avatarType') === 0 && calls(p, 'set UserAccount.avatar') === 0, 'nothing written yet');
    await click('AV_T7');
    p = await until((q) => top(q) === 'CONFIRM' && /Avatar 7/.test(txt(q, 'C_WHAT')));
    ok(/^Set the avatar of "Driver A" \(i01\) to Avatar 7\?$/.test(txt(p, 'C_WHAT')), 'CONFIRM: "' + txt(p, 'C_WHAT') + '"');
    ok(/avatarType = AVATAR7 \(code 7\)/.test(txt(p, 'C_DETAIL')) && /No name, no type, no protection/.test(txt(p, 'C_DETAIL')),
        'it names the one field: "' + txt(p, 'C_DETAIL') + '"');
    ok(calls(p, 'set UserAccount.avatarType') === 0, 'nothing sent before Yes');
    await click('C_YES');
    p = await until((q) => /Result/.test(txt(q, 'C_RESULT')));
    ok(txt(p, 'C_RESULT') === 'Result: avatarType is now AVATAR7 (Avatar 7)', 'result: "' + txt(p, 'C_RESULT') + '"');
    ok(acc(p, 'i01').avatarType === 'AVATAR7' && acc(p, 'i01').avatarChars === 0, 'the fake persod has AVATAR7 and no picture');
    ok(calls(p, 'set UserAccount.avatarType') === 1 && calls(p, 'set UserAccount.avatar') === 0, 'one field written, not the picture');
    await click('C_NO');
    p = await until((q) => top(q) === 'PROFILE' && r2(q, 'D_AVATAR') === 'Avatar 7 (AVATAR7)');
    ok(top(p) === 'PROFILE' && r2(p, 'D_AVATAR') === 'Avatar 7 (AVATAR7)', 'back on PROFILE, the row reads "' + r2(p, 'D_AVATAR') + '"');

    console.log('the folder with files in it');
    fs.mkdirSync(AVDIR);
    fs.writeFileSync(path.join(AVDIR, 'my-face.jpg'), jpeg(3072));
    fs.writeFileSync(path.join(AVDIR, 'big-photo.jpg'), jpeg(80 * 1024));
    fs.writeFileSync(path.join(AVDIR, 'empty.jpg'), Buffer.alloc(0));
    fs.writeFileSync(path.join(AVDIR, 'notes.txt'), 'not a picture');
    fs.writeFileSync(path.join(AVDIR, '.hidden.jpg'), jpeg(2048));
    fs.mkdirSync(path.join(AVDIR, 'nested.jpg'));
    fs.writeFileSync(path.join(tmp, 'outside.jpg'), jpeg(2048));
    fs.symlinkSync(path.join(tmp, 'outside.jpg'), path.join(AVDIR, 'link.jpg'));
    const want = fs.readFileSync(path.join(AVDIR, 'my-face.jpg'));
    const wantSum = sum(want.toString('base64'));
    await click('A_AVATAR');
    p = await until((q) => top(q) === 'AVATAR' && r1(q, 'AV_F0'));
    ok(r1(p, 'AV_F0') === 'big-photo.jpg' && r1(p, 'AV_F1') === 'empty.jpg' && r1(p, 'AV_F2') === 'my-face.jpg',
        'the jpg files listed by name: ' + JSON.stringify([r1(p, 'AV_F0'), r1(p, 'AV_F1'), r1(p, 'AV_F2')]));
    ok(/^3 KB - press to use it$/.test(r2(p, 'AV_F2')), 'each with its size: "' + r2(p, 'AV_F2') + '"');
    ok(new RegExp('^80 KB: over the ' + MAXKB + ' KB limit').test(r2(p, 'AV_F0')) && r2(p, 'AV_F1') === 'the file is empty',
        'the oversize and empty ones say so: "' + r2(p, 'AV_F0') + '" / "' + r2(p, 'AV_F1') + '"');
    ok(['AV_F3', 'AV_F4', 'AV_F5'].every((c) => vis(p, c) === false) && vis(p, 'AV_EMPTY') === false, 'the spare rows and the hint are hidden');
    const rows = ['AV_F0', 'AV_F1', 'AV_F2', 'AV_F3', 'AV_F4', 'AV_F5'].map((c) => r1(p, c)).join('|');
    ok(!/notes\.txt|hidden|link\.jpg|nested/.test(rows), 'no .txt, dot-file, folder or symlink out of the folder is listed: ' + rows);

    console.log('the app refuses an oversize or empty file before sending');
    let avSets = calls(p, 'set UserAccount.avatar');
    await click('AV_F0');
    await sleep(300);
    p = await probe();
    ok(top(p) === 'AVATAR' && calls(p, 'set UserAccount.avatar') === avSets, 'the oversize one: no CONFIRM, nothing sent');
    ok(new RegExp('^That one is 80 KB, over the ' + MAXKB + ' KB limit').test(txt(p, 'AV_NOTE')), 'it says why: "' + txt(p, 'AV_NOTE') + '"');
    await click('AV_F1');
    await sleep(300);
    p = await probe();
    ok(top(p) === 'AVATAR' && /^That file is empty/.test(txt(p, 'AV_NOTE')) && calls(p, 'set UserAccount.avatar') === avSets,
        'the empty one: "' + txt(p, 'AV_NOTE') + '", nothing sent');

    console.log("the owner's own picture");
    await click('AV_F2');
    p = await until((q) => top(q) === 'CONFIRM' && /my-face/.test(txt(q, 'C_WHAT')));
    ok(txt(p, 'C_WHAT') === 'Use "my-face.jpg" (3 KB, from your avatars folder) as the avatar of "Driver A" (i01)?', 'CONFIRM: "' + txt(p, 'C_WHAT') + '"');
    ok(/avatar = that jpg, Base64-encoded/.test(txt(p, 'C_DETAIL')) && /avatarType = INDIVIDUAL \(code 16\)/.test(txt(p, 'C_DETAIL')),
        'it names both fields, in order: "' + txt(p, 'C_DETAIL') + '"');
    await click('C_YES');
    p = await until((q) => /Result/.test(txt(q, 'C_RESULT')));
    ok(txt(p, 'C_RESULT') === 'Result: picture sent (3 KB of jpg) and avatarType set to INDIVIDUAL', 'result: "' + txt(p, 'C_RESULT') + '"');
    ok(/^The same picture reads back/.test(txt(p, 'C_RESULT2')) && /Only those two fields were written/.test(txt(p, 'C_RESULT2')),
        'and what the car holds now: "' + txt(p, 'C_RESULT2') + '"');
    ok(acc(p, 'i01').avatarType === 'INDIVIDUAL' && acc(p, 'i01').avatarBytes === want.length && acc(p, 'i01').avatarSum === wantSum,
        'the fake persod holds INDIVIDUAL and exactly those ' + want.length + ' bytes, Base64-encoded');
    ok(calls(p, 'set UserAccount.avatar') === 1 && calls(p, 'set UserAccount.avatarType') === 2,
        'it added one avatar write and one avatarType write');
    ok(acc(p, 'i01').name === 'Driver A' && acc(p, 'i01').type === 'USER' && acc(p, 'i01').protection.length === 0 && acc(p, 'i01').pia === 0,
        'nothing else about the profile changed (name, type, protection, PIA)');
    await click('C_NO');
    p = await until((q) => top(q) === 'PROFILE' && /INDIVIDUAL/.test(r2(q, 'D_AVATAR')));
    ok(r2(p, 'D_AVATAR') === 'Custom picture (INDIVIDUAL) is set, 3 KB of jpg', 'the profile row: "' + r2(p, 'D_AVATAR') + '"');

    // what the car should be holding from here on: the last picture a confirmed Yes sent
    const held = { bytes: want.length, sum: wantSum };
    console.log('the car refuses the picture');
    await fake({ rejectAvatar: 'persod: avatar rejected, this unit takes less' });
    await click('A_AVATAR');
    await until((q) => top(q) === 'AVATAR' && r1(q, 'AV_F2') === 'my-face.jpg');
    await click('AV_F2');
    p = await until((q) => top(q) === 'CONFIRM' && /my-face/.test(txt(q, 'C_WHAT')));
    const typeSets = calls(p, 'set UserAccount.avatarType');
    await click('C_YES');
    p = await until((q) => /Result/.test(txt(q, 'C_RESULT')));
    ok(txt(p, 'C_RESULT') === 'Result: the car refused the picture: persod: avatar rejected, this unit takes less',
        'the car\'s own words are shown: "' + txt(p, 'C_RESULT') + '"');
    ok(/avatarType was left alone/.test(txt(p, 'C_RESULT2')) && calls(p, 'set UserAccount.avatarType') === typeSets,
        'avatarType was not written after the refusal: "' + txt(p, 'C_RESULT2') + '"');
    ok(acc(p, 'i01').avatarType === 'INDIVIDUAL' && acc(p, 'i01').avatarSum === held.sum && acc(p, 'i01').avatarBytes === held.bytes,
        'the profile still holds what it held');
    await fake({ rejectAvatar: null });
    await click('C_NO');
    p = await until((q) => top(q) === 'AVATAR', 4000);
    ok(top(p) === 'AVATAR', 'a refusal leaves the Avatar screen open to try again (stack ' + JSON.stringify(p.stack) + ')');

    console.log('the enum by number, when the service will not take its name');
    await fake({ avatarEnumByName: false });
    await click('AV_T0');
    await until((q) => top(q) === 'CONFIRM' && /Default/.test(txt(q, 'C_WHAT')));
    await click('C_YES');
    p = await until((q) => /Result/.test(txt(q, 'C_RESULT')));
    ok(txt(p, 'C_RESULT') === 'Result: avatarType is now DEFAULT (Default)' && acc(p, 'i01').avatarType === 'DEFAULT',
        'it falls back to the number on the same field: "' + txt(p, 'C_RESULT') + '"');
    ok(/stays stored, unused/.test(txt(p, 'C_RESULT2')) && acc(p, 'i01').avatarSum === held.sum,
        'and the stored picture is left alone: "' + txt(p, 'C_RESULT2') + '"');
    await fake({ avatarEnumByName: true });
    await click('C_NO');
    p = await until((q) => top(q) === 'PROFILE' && r2(q, 'D_AVATAR') === 'Default (DEFAULT)');

    console.log('an avatar write needs the car parked too');
    await fake({ engine: true });
    await sleep(1200);
    await click('A_AVATAR');
    await until((q) => top(q) === 'AVATAR' && r1(q, 'AV_F2') === 'my-face.jpg');
    await click('AV_F2');
    p = await until((q) => top(q) === 'CONFIRM' && /engine is running/.test(txt(q, 'C_CHECK')));
    ok(/engine is running/.test(txt(p, 'C_CHECK')), 'CONFIRM shows it: "' + txt(p, 'C_CHECK') + '"');
    avSets = calls(p, 'set UserAccount.avatar');
    await click('C_YES');
    p = await until((q) => /Not sent/.test(txt(q, 'C_RESULT')));
    ok(/^Not sent: the engine is running$/.test(txt(p, 'C_RESULT')) && calls(p, 'set UserAccount.avatar') === avSets,
        'Yes: "' + txt(p, 'C_RESULT') + '", no picture sent');
    await fake({ engine: false });
    await sleep(1200);
    p = await toMain();

    console.log('odd input');
    await click('NO_SUCH_COMPONENT');
    await click('C_YES');                  // CONFIRM not open
    await click('N_9');                    // an empty preset row
    await click('P_I05');                  // a free slot
    p = await until((q) => /Slot 5 is free/.test(txt(q, 'MSG')));
    ok(/Slot 5 is free/.test(txt(p, 'MSG')), 'a free slot row: "' + txt(p, 'MSG') + '"');

    console.log('only the allowed writes, ever');
    p = await probe();
    const names = p.perso.calls.map((c) => c.call);
    ok(names.every((c) => ALLOWED.indexOf(c) >= 0), 'calls made: ' + JSON.stringify(names));
    ok(calls(p, 'createUserAccount') === 2 && calls(p, 'set UserAccount.name') === 1 && calls(p, 'copyGuestData') === 2 && calls(p, 'removeUserAccount') === 1,
        'one per confirmed Yes (2 creates incl. MAX_NUM_EXCEEDED, 1 rename, 2 copies incl. the failing one, 1 delete)');
    // the owner's picture and the one the car refused; 4 avatarType sets (AVATAR7, INDIVIDUAL, then DEFAULT by name
    // and by number)
    ok(calls(p, 'set UserAccount.avatar') === 2 && calls(p, 'set UserAccount.avatarType') === 4,
        'the avatar writes: ' + calls(p, 'set UserAccount.avatar') + ' pictures (one of them refused by the car) and '
        + calls(p, 'set UserAccount.avatarType') + ' avatarType sets, one per confirmed Yes plus the enum retry');
    const bigSend = p.perso.calls.filter((c) => typeof c.chars === 'number' && c.chars > MAXKB * 1024 * 4 / 3);
    ok(bigSend.length === 0, 'no Base64 string over the ' + MAXKB + ' KB limit was ever handed to the setter');
    await sleep(800);
    ok(!exited && !/uncaught|app exited/.test(logText), 'the app never exited (no uncaught exception)');
    const appLog = logText.split('\n').filter((l) => /\[driver_profiles\]/.test(l) && !/bench:/.test(l)).join('\n');
    ok(!/Driver A|Driver B|Profile 1|example\.com/.test(appLog), 'no profile names or e-mail in the app log');
    ok(!/my-face|big-photo|empty\.jpg|outside|hidden/.test(appLog), 'no avatar file name in the app log');
    ok(!/[A-Za-z0-9+/]{120,}/.test(appLog) && !/WlpaWlpa/.test(appLog), 'no image data in the app log (no run of Base64)');
}

main().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    if (server) server.kill('SIGTERM');
    const errs = logText.split('\n').filter((l) => /ERROR/.test(l));
    if (errs.length) { console.log('app errors in the log:'); errs.slice(0, 20).forEach((l) => console.log('  ' + l)); }
    console.log(passed + ' passed, ' + failed + ' failed');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left in tmp */ }
    process.exit(failed ? 1 : 0);
});
