'use strict';
/**
 * test-native-ui.js - a scripted test of the native centre screen (shared/menu.js, shared/gallery.js) on the bench.
 *
 *   node bench/test-native-ui.js            (BENCH_PORT, default 8097)
 *
 * Starts bench/server.js for f30_cluster (it builds the app with the kit and runs it in the stubbed head unit against
 * the fake cluster-render), with its own data folder and its own shared-screen folder (SCREEN_DIR), so the bench's
 * usual bench/.data is left alone. Then it presses the native components as the car's HMI sends them (POST /click:
 * a checkbox toggle, a drop-down's row, buttons), and reads back what the app wrote to them and what the engine
 * built (GET /probe): the settings change, hud.js rebuilds the right layout, every layout builds, the shared-screen
 * hand-over (HUD Widgets) works both ways, the gallery opens, steps and closes, and the app never exits.
 *
 * The bench does not draw native screens (the HMI does that on the car): this checks the app's side only.
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT) || 8097;
const BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-ui-'));
const dataDir = path.join(tmp, 'data'), screenDir = path.join(tmp, 'screen');
fs.mkdirSync(dataDir); fs.mkdirSync(screenDir);
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'app.json'), 'utf8'));
const opts = (k) => spec.settings.find((s) => s.key === k).options.map((o) => o[0]);

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
const click = (id, row) => req('POST', '/click', row === undefined ? { id } : { id, row });
/** Poll /probe until fn(p) is true (or time runs out); returns the last probe. */
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await probe(); if (fn(p)) return p; } catch (e) { /* app (re)starting */ }
        await sleep(150);
    }
    return p;
}
const cell = (p, n, k) => ((p.native[n] || {}).cells || {})[k];
const txt = (p, n) => (p.native[n] || {}).text;
const vis = (p, n) => (p.native[n] || {}).visible;
const sel = (p, n) => (p.native[n] || {}).selected;
const imgs = (p, n) => (p.images[n] || { n: 0 }).n;

/** HUD Widgets as screen.js sees it: its file in SCREEN_DIR, rewritten every second (fresh = running). */
let peer = null;
const peerTimer = setInterval(() => {
    if (!peer) return;
    fs.writeFileSync(path.join(screenDir, 'hud.json'), JSON.stringify({ on: peer.on, claim: peer.claim, at: Date.now() }));
}, 1000);
const readOurs = () => { try { return JSON.parse(fs.readFileSync(path.join(screenDir, 'cluster.json'), 'utf8')); } catch (e) { return null; } };

async function main() {
    console.log('bench on ' + BASE + ', data in ' + tmp);
    server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'f30_cluster'], {
        cwd: ROOT, env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, SCREEN_DIR: screenDir }),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (d) => { logText += d; if (/app exited/.test(String(d))) exited = true; };
    server.stdout.on('data', keep); server.stderr.on('data', keep);

    console.log('start');
    let p = await until((q) => q && q.ready && q.activeName && q.stack.length, 60000);
    ok(p && p.ready, 'the app runs and reaches the fake cluster-render');
    if (!p || !p.ready) return;
    ok(JSON.stringify(p.stack) === '["MAIN"]', 'the entry screen is the native menu MAIN (stack ' + JSON.stringify(p.stack) + ')');
    p = await until((q) => cell(q, 'NOW', 'Text1stRow') && imgs(q, 'NOW_GFX') > 0 && txt(q, 'STATUS'));
    ok(!!cell(p, 'NOW', 'Text1stRow'), 'NOW row: "' + cell(p, 'NOW', 'Text1stRow') + '" / "' + cell(p, 'NOW', 'Text2ndRow') + '"');
    ok(imgs(p, 'NOW_GFX') > 0 && p.images.NOW_GFX.w === 888, 'NOW_GFX got the theme picture (' + JSON.stringify(p.images.NOW_GFX) + ')');
    ok(!!txt(p, 'STATUS') && !!txt(p, 'STATUS2'), 'status rows: "' + txt(p, 'STATUS') + '" / "' + txt(p, 'STATUS2') + '"');
    ok(/^Engine: /.test(txt(p, 'STATUS_LOG') || ''), 'engine status row: "' + (txt(p, 'STATUS_LOG') || '').slice(0, 90) + '..."');
    ok((p.native.SET_BYMODE || {}).checked === true, 'kit wires the checkbox SET_BYMODE (on)');
    ok(sel(p, 'SET_HUDLAYOUT') === opts('hudLayout').indexOf(p.settings.hudLayout), 'kit wires the drop-down SET_HUDLAYOUT (row ' + sel(p, 'SET_HUDLAYOUT') + ')');
    ok(vis(p, 'SET_INCOMFORT') === true || vis(p, 'SET_INCOMFORT') === undefined, 'drive-mode rows shown while byMode is on');

    console.log('drive mode Comfort');
    await req('POST', '/drive', { value: 4 });
    p = await until((q) => q.driveMode === 'comfort' && q.activeName === q.settings.inComfort);
    ok(p.driveMode === 'comfort' && p.activeName === p.settings.inComfort, 'Comfort shows In Comfort (' + p.activeName + ')');

    console.log('drop-down In Comfort -> 6WB Eco Pro');
    const nGfx = imgs(p, 'NOW_GFX');
    await click('SET_INCOMFORT', opts('inComfort').indexOf('wb_eco'));
    p = await until((q) => q.activeName === 'wb_eco' && cell(q, 'NOW', 'Text1stRow') === '6WB Eco Pro' && imgs(q, 'NOW_GFX') > nGfx);
    ok(p.settings.inComfort === 'wb_eco', 'setting inComfort = wb_eco');
    ok(p.activeName === 'wb_eco', 'hud.js rebuilt wb_eco');
    ok(cell(p, 'NOW', 'Text1stRow') === '6WB Eco Pro' && imgs(p, 'NOW_GFX') > nGfx, 'NOW row and picture follow');

    console.log('checkbox off: one theme for every mode');
    await click('SET_BYMODE');
    p = await until((q) => q.settings.byMode === false && q.activeName === q.settings.hudLayout && vis(q, 'SET_INCOMFORT') === false &&
        /Same theme/.test(txt(q, 'STATUS2') || ''));
    ok(p.settings.byMode === false, 'setting byMode = false');
    ok(p.activeName === p.settings.hudLayout, 'hud.js shows Theme (' + p.activeName + ')');
    ok(vis(p, 'SET_INCOMFORT') === false && vis(p, 'SET_INSPORT') === false && vis(p, 'SET_INECO') === false, 'drive-mode rows hidden');
    ok(/Same theme in every drive mode/.test(txt(p, 'STATUS2')), 'STATUS2 says so');

    console.log('every layout builds (drop-down Theme)');
    for (const v of opts('hudLayout')) {
        await click('SET_HUDLAYOUT', opts('hudLayout').indexOf(v));
        p = await until((q) => q.activeName === v && /^Cluster (on|off)/.test(q.status) && !/drawn \(/.test(q.status), 10000);
        ok(p.activeName === v && !/refused|unusable|Cluster: /.test(p.status), v + ': ' + (p.status || '').slice(0, 110));
    }
    await click('SET_HUDLAYOUT', opts('hudLayout').indexOf('wb_sport'));
    p = await until((q) => q.activeName === 'wb_sport');
    ok(p.activeName === 'wb_sport', 'Theme = 6WB Sport shows');

    console.log('checkbox on again');
    await click('SET_BYMODE');
    p = await until((q) => q.settings.byMode === true && q.activeName === 'wb_eco' && vis(q, 'SET_INCOMFORT') === true);
    ok(p.activeName === 'wb_eco' && vis(p, 'SET_INCOMFORT') === true, 'Comfort again: In Comfort (wb_eco), rows shown');

    console.log('HUD Widgets on: a theme picked takes the screen');
    peer = { on: true, claim: 0 };
    await sleep(4500);                      // our beat reads it (every 2 s)
    await click('SET_INCOMFORT', opts('inComfort').indexOf('wb_comfort'));
    p = await until((q) => q.activeName === 'wb_comfort' && /HUD Widgets turned off/.test(txt(q, 'STATUS2') || ''));
    const ours = readOurs();
    ok(ours && ours.claim > 0, 'our screen file claims the screen (claim ' + (ours && ours.claim) + ')');
    ok(/HUD Widgets turned off/.test(txt(p, 'STATUS2') || ''), 'STATUS2: "' + txt(p, 'STATUS2') + '"');

    console.log('HUD Widgets takes it back, NOW takes it again');
    peer = { on: true, claim: Date.now() + 1000 };
    p = await until((q) => q.yielded === true && q.activeName === 'off', 9000);
    ok(p.yielded === true && p.activeName === 'off', 'we step aside (nothing drawn)');
    p = await until((q) => /has the screen/.test(cell(q, 'NOW', 'Text2ndRow') || ''));
    ok(/Press to take it back/.test(cell(p, 'NOW', 'Text2ndRow') || ''), 'NOW: "' + cell(p, 'NOW', 'Text2ndRow') + '"');
    await click('NOW');
    p = await until((q) => q.yielded === false && q.activeName === 'wb_comfort');
    ok(p.yielded === false && p.activeName === 'wb_comfort', 'a press on NOW takes the screen back');
    peer = null;

    console.log('gallery');
    await click('BTN_GALLERY');
    p = await until((q) => q.stack[q.stack.length - 1] === 'GALLERY' && imgs(q, 'GALLERY_GFX') > 0);
    ok(p.stack[p.stack.length - 1] === 'GALLERY', 'Theme gallery opens GALLERY (stack ' + JSON.stringify(p.stack) + ')');
    ok(imgs(p, 'GALLERY_GFX') > 0, 'the gallery is drawn (' + JSON.stringify(p.images.GALLERY_GFX) + ', software path)');
    const looks = opts('inComfort'), before = p.settings.inComfort;
    await click('BTN_NEXT_THEME');
    const want = looks[(looks.indexOf(before) + 1) % looks.length];
    p = await until((q) => q.settings.inComfort === want && q.activeName === want);
    ok(p.settings.inComfort === want && p.activeName === want, 'Next theme: In Comfort ' + before + ' -> ' + want + ', shown');
    await click('BTN_GALLERY_DONE');
    p = await until((q) => JSON.stringify(q.stack) === '["MAIN"]');
    ok(JSON.stringify(p.stack) === '["MAIN"]', 'Done goes back to MAIN');
    await click('NOW');
    p = await until((q) => q.stack[q.stack.length - 1] === 'GALLERY');
    ok(p.stack[p.stack.length - 1] === 'GALLERY', 'a press on NOW opens the gallery too');
    await req('POST', '/hmi', { a: 'back' });
    p = await until((q) => JSON.stringify(q.stack) === '["MAIN"]');
    ok(JSON.stringify(p.stack) === '["MAIN"]', 'the HMI back arrow closes it');

    console.log('odd input');
    await click('SET_BADGE', 999);
    await click('SET_TIMEZONE', -1);
    await click('NO_SUCH_COMPONENT');
    await click('SET_TIMEZONE', spec.settings.find((s) => s.key === 'timeZone').steps.indexOf(120));
    p = await until((q) => q.settings.timeZone === 120);
    ok(p.settings.timeZone === 120 && p.settings.badge === 'none', 'bad rows ignored, a good one taken (timeZone 120)');
    await sleep(1000);
    ok(!exited && !/uncaught|app exited/.test(logText), 'the app never exited (no uncaught exception)');
}

main().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    clearInterval(peerTimer);
    if (server) server.kill('SIGTERM');
    const errs = logText.split('\n').filter((l) => /\bERROR\b|menu |gallery /.test(l) && /error|ERROR/.test(l));
    if (errs.length) { console.log('app errors in the log:'); errs.slice(0, 20).forEach((l) => console.log('  ' + l)); }
    console.log(passed + ' passed, ' + failed + ' failed');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left in tmp */ }
    process.exit(failed ? 1 : 0);
});
