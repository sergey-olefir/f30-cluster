'use strict';
/**
 * test-diag.js - package B7 of the Twin Dial 0.1.1 build: the Діагностика settings (shared/diag_settings.js, app.json screen DIAG)
 * and the start-up hold (config.startupHold).
 *
 *   node bench/test-diag.js            (BENCH_PORT, default 8607; --unit: the first part only, no bench; --only twin | f30)
 *
 * 1. Without the bench: both apps' app.json wire the group the same way (every setting default off, on the DIAG screen and
 *    skipped from the SETTINGS list, BTN_DIAG on MAIN, diag_settings.js packed, a config.diag entry each); the overlay leaves
 *    `config` byte for byte what app.json has with every setting off, for both apps, after any sequence of on / off; every option
 *    writes exactly the paths it names; off puts back what app.json had (a key app.json carries is restored, one it does not
 *    carry is removed with the objects the overlay made); an invalid saved value is off; a baseline in app.json (a build that sets
 *    mbCover itself) is kept while the setting is off; the start-up hold waits for the time zone and the message list and for no
 *    more than its `ms`; the file is Node 8 syntax (no `?.`, `??`, object spread).
 * 2. twin_dial on the bench: the first build waits (one "start-up:" line) and happens once; every Діагностика setting is applied
 *    IN PLACE (no layer dropped, no rebuild), logs "diag: <key> on / off" and the status line counts them; the silent-fields
 *    summary runs when its setting goes on; BTN_DIAG opens the DIAG screen; startupHold false gives back 0.1.0's builds.
 * 3. f30_cluster on the bench: nothing of the group in the log with every setting off; "No layer over the gear gap" and
 *    "Cover over the gear gap" rebuild and make the cover layer (and remove it again); "Lighter scene textures" re-makes the
 *    scene textures as R8 and back; the release setting is in place.
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT) || 8607;
const BASE = 'http://127.0.0.1:' + PORT;
const GAP = [1380, 660, 1460, 720];
const DS = require(path.join(ROOT, 'shared', 'diag_settings.js'));
const APPS = { twin_dial: require(path.join(ROOT, 'apps', 'twin_dial', 'app.json')), f30_cluster: require(path.join(ROOT, 'apps', 'f30_cluster', 'app.json')) };
const quiet = { info() {}, warn() {} };
const deep = (o) => JSON.parse(JSON.stringify(o));

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The kit's Settings, as far as the overlay uses it. */
function fakeSettings(spec, values) {
    return { item: (k) => spec.settings.find((s) => s.key === k) || null, get: (k) => (k in values ? values[k] : (spec.settings.find((s) => s.key === k) || {}).default) };
}
const diagKeys = (spec) => spec.settings.filter((s) => /^diag[A-Z]/.test(s.key));
/** Every option a diagnostics setting can be at, "off" first. */
const optionsOf = (s) => (s.type === 'bool' ? [false, true] : s.options.map((o) => o[0]));

function unit() {
    console.log('1. the overlay, the app.json wiring, the hold (no bench)');
    Object.keys(APPS).forEach((id) => {
        const spec = APPS[id], keys = diagKeys(spec), screens = spec.screens;
        const main = screens.find((s) => s.name === 'MAIN'), diag = screens.find((s) => s.name === 'DIAG'), set = screens.find((s) => s.name === 'SETTINGS');
        ok(keys.length >= 5 || id === 'f30_cluster' && keys.length >= 6, id + ': ' + keys.length + ' diagnostics settings');
        ok(keys.every((s) => (s.type === 'bool' ? s.default === false : s.default === 'off')), id + ': every one is off by default');
        ok(!!diag && diag.kind === 'menu' && keys.every((s) => diag.items.some((i) => i[0] === 'setting' && i[1] === s.key)), id + ': the DIAG screen shows every one');
        ok(!!set && keys.every((s) => set.skip.indexOf(s.key) >= 0), id + ': the SETTINGS list skips them (a component name is made once)');
        ok(!!main && main.items.some((i) => i[0] === 'button' && i[1] === 'BTN_DIAG'), id + ': MAIN has the BTN_DIAG button');
        ok(spec.shared.indexOf('diag_settings.js') >= 0, id + ': diag_settings.js is packed');
        const tab = (spec.config.diag || {}).settings || {};
        ok(keys.every((s) => !!tab[s.key]), id + ': config.diag has an entry for each');
        // every option other than off writes at least one path or is an action; every path is dotted plain words
        let named = true;
        keys.forEach((s) => {
            const e = tab[s.key] || {}, opts = s.type === 'bool' ? { on: e.on } : e.options || {};
            optionsOf(s).filter((o) => o !== false && o !== 'off').forEach((o) => { if (!e.act && !(opts[o === true ? 'on' : o] && Object.keys(opts[o === true ? 'on' : o]).length)) named = false; });
            Object.keys(opts).forEach((o) => Object.keys(opts[o] || {}).forEach((p) => { if (!/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/.test(p)) named = false; }));
        });
        ok(named, id + ': every option names its config paths (or an action)');

        // all off: the config is what app.json has
        const cfg = deep(spec.config), orig = deep(spec.config), vals = {};
        const d = DS.Diag.create(cfg, fakeSettings(spec, vals), quiet);
        ok(!!d && JSON.stringify(cfg) === JSON.stringify(orig), id + ': every setting off: config is app.json\'s byte for byte');
        // every option of every setting, one at a time, and back
        let writes = true, restores = true;
        keys.forEach((s) => {
            optionsOf(s).forEach((o) => {
                vals[s.key] = o;
                const r = d.apply();
                const e = tab[s.key] || {}, want = (o === true ? e.on : o === false || o === 'off' ? {} : (e.options || {})[o]) || {};
                Object.keys(want).forEach((p) => {
                    let v = cfg;
                    p.split('.').forEach((k) => { v = v && v[k]; });
                    if (JSON.stringify(v) !== JSON.stringify(want[p])) writes = false;
                });
                if (o === false || o === 'off') { vals[s.key] = o; d.apply(); }
            });
            vals[s.key] = s.type === 'bool' ? false : 'off';
            d.apply();
            if (JSON.stringify(cfg) !== JSON.stringify(orig)) { restores = false; console.log('     not restored after ' + s.key); }
        });
        ok(writes, id + ': every option writes the values it names');
        ok(restores, id + ': after each setting, off puts config back to app.json\'s byte for byte');
        // all on at once and all off again
        keys.forEach((s) => { vals[s.key] = s.type === 'bool' ? true : s.options[s.options.length - 1][0]; });
        d.apply();
        ok(JSON.stringify(cfg) !== JSON.stringify(orig) && d.active().length === keys.length, id + ': all on: config changed, ' + d.active().length + ' of ' + keys.length + ' on');
        keys.forEach((s) => { vals[s.key] = s.type === 'bool' ? false : 'off'; });
        d.apply();
        ok(JSON.stringify(cfg) === JSON.stringify(orig), id + ': all off again: config is app.json\'s byte for byte');
        // an invalid saved value is off
        keys.forEach((s) => { vals[s.key] = 'no-such-option'; });
        d.apply();
        ok(JSON.stringify(cfg) === JSON.stringify(orig) && d.active().length === 0, id + ': a saved value that is no option is off');
        // the overlay is applied at construction: a saved ON setting is in config before anything reads it
        const cfg2 = deep(spec.config), v2 = {};
        v2[keys[0].key] = keys[0].type === 'bool' ? true : keys[0].options[1][0];
        DS.Diag.create(cfg2, fakeSettings(spec, v2), quiet);
        ok(JSON.stringify(cfg2) !== JSON.stringify(orig), id + ': a saved ON setting is applied when the engine is made');
    });

    // the exact values
    {
        // car-fix CF1: diagShownNow replaced research3/MC's diagDisplayed (the displayed witness is the "shown now" source now)
        const spec = APPS.f30_cluster, cfg = deep(spec.config), vals = { diagShownNow: 'active' };
        const d = DS.Diag.create(cfg, fakeSettings(spec, vals), quiet);
        ok(cfg.ccActive.source === 'active' && cfg.ccDisplayed && cfg.ccDisplayed.field === 'statusDisplayedCCMessage' && !cfg.ccActive.release,
            'f30: diagShownNow "active" sets only ccActive.source (0.7.20\'s path); ccDisplayed stays subscribed, nothing else changes');
        vals.diagRelease = true; d.apply();
        ok(JSON.stringify(cfg.ccActive.release) === JSON.stringify({ deferValues: [65535], leftList: true }) && cfg.ccActive.source === 'active', 'f30: with the release on too: ' + JSON.stringify(cfg.ccActive.release));
        vals.diagShownNow = 'off'; d.apply();
        ok(cfg.ccActive.source === 'displayed' && cfg.ccActive.dead === true, 'f30: off puts app.json\'s source back ("displayed", dead active)');
        vals.diagRelease = false; d.apply();
        ok(!('release' in cfg.ccActive), 'f30: release off removes the key app.json does not have');
        ok(!spec.settings.some((s) => s.key === 'diagDisplayed') && !spec.config.diag.settings.diagDisplayed, 'f30: research3/MC\'s diagDisplayed is gone (replaced by diagShownNow)');
        // a baseline in app.json is kept while off
        const c3 = deep(spec.config); c3.mbCover = 'black';
        const v3 = {}, d3 = DS.Diag.create(c3, fakeSettings(spec, v3), quiet);
        ok(c3.mbCover === 'black', 'a build that sets mbCover itself keeps it while the setting is off');
        v3.diagMbCover = 'clear'; d3.apply();
        ok(c3.mbCover === 'clear', '... the setting on overrides it');
        v3.diagMbCover = 'off'; d3.apply();
        ok(c3.mbCover === 'black', '... and off puts the build\'s own value back');
        // a change report names the keys and paths
        const c4 = deep(spec.config), v4 = {}, d4 = DS.Diag.create(c4, fakeSettings(spec, v4), quiet);
        v4.diagSceneTex = 'etc2';
        const r = d4.apply();
        ok(r.keys.join() === 'diagSceneTex' && r.paths.join() === 'sceneTex' && c4.sceneTex === 'etc2', 'apply() reports the setting and the path that changed');
        ok(d4.apply().keys.length === 0 && d4.apply().paths.length === 0, 'and nothing changed the second time');
    }
    {
        const spec = APPS.twin_dial, cfg = deep(spec.config), vals = { diagMapWindow: 'W2', diagMapForce: true, diagMapSlots: true, diagRelease: true };
        DS.Diag.create(cfg, fakeSettings(spec, vals), quiet);
        ok(cfg.mapWindow === 'W2' && cfg.mapForce === true && cfg.mapSlotLog === true && cfg.mapSlots === false && cfg.ccActive.release.leftList === true && cfg.ccActive.release.deferValues[0] === 65535, 'twin: the map window, the forced window, the slot log and the release write their keys');
        ok(cfg.ccActive.strict === true && cfg.ccActive.noneValues[0] === 0, 'twin: the rest of ccActive is untouched');
    }

    // integration (B7): the tab bar's inputs from B4's page model (shared/twin_pages.js tabBridge), gated by config.pages
    {
        const TP = require(path.join(require('./twin-harness').tree('twin_dial'), 'twin_pages.js'));     // the kit's layout (shared/*.js beside kit/)
        const h = (pages, src, dev) => ({ config: { pages }, td: {}, tdp: { media: { src }, phone: { devSeen: dev !== undefined, dev: dev || null } } });
        let x = h({ media: false, phone: false }, 'carplay', {});
        TP.tabBridge(x);
        ok(x.td.mediaSource === null && x.td.phoneConnected === null, 'tab bridge: pages dark (before probes P8 / P9): no source, no phone state (the plain icons)');
        // car-fix CF3: the device list (DevicePresentation, never seen on the car) only with config.pages.phoneDevices
        x = h({ media: true, phone: true }, 'carplay', {}); TP.tabBridge(x);
        ok(x.td.mediaSource === 'projection' && x.td.phoneConnected === null, 'tab bridge: CarPlay -> projection icon; phone on but phoneDevices off (car-fix CF3: unseen) -> the plain phone');
        x = h({ media: true, phone: true, phoneDevices: true }, 'carplay', {}); TP.tabBridge(x);
        ok(x.td.mediaSource === 'projection' && x.td.phoneConnected === true, 'tab bridge: CarPlay -> projection icon, a connected device -> phone with bars');
        x = h({ media: true, phone: true, phoneDevices: true }, 'radio', null); TP.tabBridge(x);
        ok(x.td.mediaSource === 'tuner' && x.td.phoneConnected === false, 'tab bridge: radio -> tuner icon, a list with none connected -> phone crossed out');
        x = h({ media: true, phone: true, phoneDevices: true }, 'usb'); TP.tabBridge(x);
        ok(x.td.mediaSource === 'player' && x.td.phoneConnected === null, 'tab bridge: another source -> player icon; no device list yet -> plain phone');
    }
    // the hold, with a fake engine
    {
        const log = []; const mk = (cfg, over) => Object.assign({ config: cfg, log: { info: (l) => log.push(l), warn: (l) => log.push(l) }, tzCar: null, tzLocal: null, _ccWired: () => false, _rebuild() { this.rebuilt = (this.rebuilt || 0) + 1; } }, over || {});
        const cfgBase = { clock: { iface: 'a', field: 'b', confirm: true }, ccList: { iface: 'c', field: 'd' } };
        ok(DS.hold(mk({})) === false, 'hold: no config.startupHold: never waits');
        let h = mk(Object.assign({ startupHold: { ms: 60000 } }, cfgBase));
        ok(DS.hold(h) === true && DS.waiting(h).join() === 'the time zone,the message list', 'hold: waits for the time zone and the message list');
        // while the first build waits the engine reports the blind state, never "none" (test-twin-sim: no moment of "ready and none")
        const hm = mk(Object.assign({ startupHold: { ms: 60000 } }, cfgBase), { twinMsg: {}, twinCc: { state: 'none', severity: null } });
        DS.hold(hm);
        ok(hm.twinCc.state === 'window', 'hold: while it waits, an engine with the message machine reports "window", not "none"');
        DS.release(hm);
        h.tzCar = 120;
        ok(DS.hold(h) === true && DS.waiting(h).join() === 'the message list', 'hold: still waits for the list once the zone is in');
        h._ccWired = () => true;
        ok(DS.hold(h) === false && h.startupDone === true, 'hold: builds as soon as both are in');
        ok(DS.hold(h) === false, 'hold: and never holds again');
        DS.release(h);
        // the time limit: a build asked for after `ms` goes ahead
        h = mk(Object.assign({ startupHold: { ms: 150 } }, cfgBase));
        ok(DS.hold(h) === true && !!h._hold.timer, 'hold: with a limit it sets one timer');
        ok(DS.hold(h) === true && !!h._hold.timer, 'hold: asked again it does not set another');
        DS.release(h);
        ok(h._hold.timer === null, 'hold: release() clears the timer');
        h = mk(Object.assign({ startupHold: { ms: 80 } }, cfgBase));
        DS.hold(h);
        return new Promise((resolve) => setTimeout(() => {
            ok(h.rebuilt === 1, 'hold: the timer asks for the build once its time is up (' + (h.rebuilt || 0) + ' rebuild call)');
            ok(DS.hold(h) === false && h.startupDone === true && /still waiting for the time zone and the message list/.test(log[log.length - 1]), 'hold: then it goes ahead and says what it was still waiting for');
            // a signal the app does not watch is not waited for
            const g = mk({ startupHold: true, clock: { iface: 'a', field: 'b' } });
            ok(DS.hold(g) === false, 'hold: config.clock without "confirm" is only logged, never a zone: not waited for; no message list configured: not waited for');
            const g2 = mk({ startupHold: true, ccActive: { iface: 'a', field: 'b' } }, { _ccWired() { return false; } });
            ok(DS.waiting(g2).join() === 'the message list', 'hold: ccActive alone counts as a message list');
            // source: Node 8 syntax
            const src = fs.readFileSync(path.join(ROOT, 'shared', 'diag_settings.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
            ok(!/\?\.|\?\?|\.\.\.|Object\.fromEntries|\.flat\(|catch\s*\{/.test(src), 'diag_settings.js is Node 8 syntax (no ?. ?? spread, fromEntries, flat, optional catch)');
            resolve();
        }, 160));
    }
}

// ---------------------------------------------------------------- the bench
let server = null, logText = '';
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
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await probe(); if (fn(p)) return p; } catch (e) { /* app (re)starting */ }
        await sleep(150);
    }
    return p;
}
const txt = (p, n) => (p && p.native && p.native[n] || {}).text;
const click = (id, row) => req('POST', '/click', row === undefined ? { id } : { id, row });

async function bench(app, config, settings) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
    const data = path.join(tmp, 'data');
    fs.mkdirSync(data);
    if (settings) fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify(settings));
    const trace = path.join(tmp, 'trace.jsonl');
    const env = Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: data, BENCH_TRACE: trace, BENCH_LAYER_CAP: '8', SCREEN_DIR: path.join(tmp, 'screen') });
    if (config) env.BENCH_CONFIG = config; else delete env.BENCH_CONFIG;
    logText = '';
    server = spawn(process.execPath, [path.join(__dirname, 'server.js'), app], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', (d) => { logText += d; });
    server.stderr.on('data', (d) => { logText += d; });
    const p = await until((q) => q && q.ready && q.activeName, 90000);
    await req('POST', '/signals', { mode: 'manual', values: { rpm: 1500, speed: 50, gear: 3, oil: 95, coolant: 90, ambient: 22, range: 368, fuelL: 40 } });
    return { p, trace };
}
async function stop() {
    if (!server) return;
    const s = server;
    server = null;
    await new Promise((r) => { s.once('exit', r); s.kill('SIGTERM'); setTimeout(r, 5000); });
}
/** The live layers and the layers dropped, from the trace so far. */
function live(trace) {
    const L = fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const m = new Map();
    let drops = 0;
    L.forEach((e) => {
        if (e.dir !== 'in') return;
        const k = e.conn + ':' + e.ref;
        if (e.op === 'layer') m.set(k, { conn: e.conn, rect: [e.x || 0, e.y || 0, (e.x || 0) + (e.w || 0), (e.y || 0) + (e.h || 0)], z: e.z || 0 });
        if (e.op === 'drop') { if (m.delete(k)) drops++; }
    });
    return { layers: Array.from(m.values()), drops };
}
const builds = () => (logText.match(/ layout "[^"]+", theme /g) || []).length;
const touches = (r, g) => r[0] < g[2] && g[0] < r[2] && r[1] < g[3] && g[1] < r[3];

async function twin() {
    console.log('2. twin_dial: the hold, and every Діагностика setting in place');
    let { p, trace } = await bench('twin_dial', null);
    ok(p && p.ready, 'the app runs');
    await sleep(2500);
    ok(/start-up: first build after \d+ ms/.test(logText), 'the first build says when it was made (the start-up hold: "' + ((logText.match(/start-up: [^\n]*/) || [''])[0]).slice(0, 110) + '")');
    ok(/start-up: first build/.test(logText) && (logText.match(/start-up: first build/g) || []).length === 1, 'and says it once');
    ok(!/\bdiag: /.test(logText), 'no "diag:" line with every setting off');
    ok(builds() <= 2, 'at most two builds at start (' + builds() + ')');
    p = await probe();
    ok(!/Diagnostics on/.test(txt(p, 'STATUS2') || ''), 'the status line says nothing of the diagnostics while they are off');
    ok(['SET_DIAGRELEASE', 'SET_DIAGMAPWINDOW', 'SET_DIAGMAPFORCE', 'SET_DIAGMAPSLOTS', 'SET_DIAGSILENT'].every((n) => p.native[n]), 'the kit made the five diagnostics rows');
    const d0 = live(trace).drops, b0 = builds();
    await click('BTN_DIAG');
    p = await until((q) => q.stack.indexOf('DIAG') >= 0, 4000);
    ok(p.stack[p.stack.length - 1] === 'DIAG', 'BTN_DIAG opens the DIAG screen (stack ' + JSON.stringify(p.stack) + ')');
    await click('SET_DIAGRELEASE');
    p = await until((q) => q.settings.diagRelease === true, 4000);
    ok(p.settings.diagRelease === true && /diag: diagRelease on/.test(logText), 'release: the checkbox sets the setting and the engine logs "diag: diagRelease on"');
    await click('SET_DIAGMAPWINDOW', 1);
    await click('SET_DIAGMAPFORCE');
    await click('SET_DIAGMAPSLOTS');
    await click('SET_DIAGSILENT');
    p = await until((q) => q.settings.diagSilent === true, 4000);
    await sleep(800);
    ok(p.settings.diagMapWindow === 'W1' && p.settings.diagMapForce === true && p.settings.diagMapSlots === true && p.settings.diagSilent === true, 'map window W1, forced window, slot log, silent log: all on');
    ok(/diag: diagMapWindow W1/.test(logText) && /diag: diagMapForce on/.test(logText) && /diag: diagMapSlots on/.test(logText) && /diag: diagSilent on/.test(logText), 'each one is logged: its name and on / the option, nothing else');
    ok(/trip summary #\d+ at/.test(logText), 'the silent-fields summary ran when its setting went on');
    p = await until((q) => /Diagnostics on: 5/.test(txt(q, 'STATUS2') || ''), 4000);
    ok(/Diagnostics on: 5/.test(txt(p, 'STATUS2') || ''), 'the status line counts them: "' + (txt(p, 'STATUS2') || '').slice(-40) + '"');
    ok(live(trace).drops === d0 && builds() === b0, 'none of the five dropped a layer or rebuilt the layout (' + (live(trace).drops - d0) + ' layers dropped, ' + (builds() - b0) + ' builds)');
    await click('SET_DIAGMAPWINDOW', 0);
    await click('SET_DIAGRELEASE'); await click('SET_DIAGMAPFORCE'); await click('SET_DIAGMAPSLOTS'); await click('SET_DIAGSILENT');
    p = await until((q) => q.settings.diagSilent === false && q.settings.diagRelease === false && q.settings.diagMapWindow === 'off', 4000);
    await sleep(600);
    ok(/diag: diagMapWindow off/.test(logText) && /diag: diagRelease off/.test(logText), 'switched off again: logged');
    p = await until((q) => !/Diagnostics on/.test(txt(q, 'STATUS2') || ''), 4000);
    ok(!/Diagnostics on/.test(txt(p, 'STATUS2') || ''), 'the status line is clean again');
    ok(live(trace).drops === d0 && builds() === b0, 'and still no rebuild');
    ok(p && p.ready, 'the app is still up');
    await stop();

    console.log('   startupHold false: the builds of 0.1.0');
    ({ p } = await bench('twin_dial', JSON.stringify({ startupHold: false })));
    ok(p && p.ready, 'the app runs');
    await sleep(2500);
    ok(!/start-up: /.test(logText) && builds() >= 1, 'no start-up hold: no "start-up:" line (' + builds() + ' builds)');
    await stop();

    console.log('   a saved ON setting is in force from the first build');
    ({ p } = await bench('twin_dial', null, { diagMapWindow: 'W2' }));
    ok(p && p.ready && p.settings.diagMapWindow === 'W2', 'the saved setting is read');
    ok(/diag: diagMapWindow W2/.test(logText), 'and applied before the engine runs ("diag: diagMapWindow W2")');
    await stop();
}

async function f30() {
    console.log('3. f30_cluster: the group is inert while off; the rebuilding ones rebuild');
    let { p, trace } = await bench('f30_cluster', null);
    ok(p && p.ready && p.activeName === 'wb_comfort', 'the app runs, 6WB Comfort');
    await sleep(2000);
    ok(!/\bdiag: /.test(logText) && !/start-up: /.test(logText) && !/\bmb: /.test(logText), 'no "diag:", "start-up:" or "mb:" line with every setting off');
    ok(['SET_DIAGRELEASE', 'SET_DIAGSHOWNNOW', 'SET_DIAGSCENETEX', 'SET_DIAGMBGAP', 'SET_DIAGMBCOVER', 'SET_DIAGMBREBUILD'].every((n) => p.native[n]), 'the kit made the six diagnostics rows');
    // in place
    let d0 = live(trace).drops;
    await click('SET_DIAGRELEASE');
    p = await until((q) => q.settings.diagRelease === true, 4000);
    await sleep(800);
    ok(/diag: diagRelease on/.test(logText) && live(trace).drops === d0, 'release: in place (no layer dropped)');
    await click('SET_DIAGRELEASE');
    await sleep(500);
    // car-fix CF1: the "shown now" source back to 0.7.20's active number, in place, and back to displayed
    d0 = live(trace).drops;
    await click('SET_DIAGSHOWNNOW', 1);
    p = await until((q) => q.settings.diagShownNow === 'active', 4000);
    await sleep(800);
    ok(/diag: diagShownNow active/.test(logText) && live(trace).drops === d0, '"shown now" source "active": in place (no layer dropped)');
    await click('SET_DIAGSHOWNNOW', 0);
    p = await until((q) => q.settings.diagShownNow === 'off', 4000);
    await sleep(500);
    // the cover over the gear gap: a rebuild, a layer over the gap at z 1000, and gone again
    d0 = live(trace).drops;
    await click('SET_DIAGMBCOVER', 1);          // clear
    p = await until((q) => q.settings.diagMbCover === 'clear', 4000);
    await sleep(3000);
    let s = live(trace);
    ok(/mb cover: "clear" over 1380,660,1460,720/.test(logText), 'cover "clear": the engine says it made the cover');
    ok(s.drops > d0, 'cover: the layout was built again (' + (s.drops - d0) + ' layers dropped)');
    ok(s.layers.filter((l) => touches(l.rect, GAP) && l.z === 1000).length === 1, 'cover: one layer over the gap at z 1000');
    d0 = s.drops;
    await click('SET_DIAGMBCOVER', 0);
    p = await until((q) => q.settings.diagMbCover === 'off', 4000);
    await sleep(3000);
    s = live(trace);
    ok(s.drops > d0 && s.layers.filter((l) => touches(l.rect, GAP) && l.z === 1000).length === 0, 'cover off: the layout is built again without it');
    ok(p.activeName === 'wb_comfort', 'Comfort is still drawn');
    // the gap cut
    await click('SET_DIAGMBGAP');
    p = await until((q) => q.settings.diagMbGap === true, 4000);
    await sleep(3000);
    s = live(trace);
    ok(/mb gap: widget "bg"/.test(logText) && s.layers.filter((l) => touches(l.rect, GAP)).length === 0, 'gap on: layers are cut round the gear gap (none touches it)');
    await click('SET_DIAGMBGAP');
    await sleep(3000);
    s = live(trace);
    ok(s.layers.filter((l) => touches(l.rect, GAP)).length > 0, 'gap off: the layers are whole again');
    // the lighter scene textures: dropped and made again as R8, then as the files of 0.7.20
    const textures = () => (logText.match(/scene texture "[^"]+"[^\n]*(RGBA8|R8) asset/g) || []);
    const before = textures().length;
    await click('SET_DIAGSCENETEX', 1);        // r8
    p = await until((q) => q.settings.diagSceneTex === 'r8', 4000);
    await sleep(4000);
    const made = textures().slice(before);
    // the two dial faces have an R8 file (MT: tacho@r8, speedo@r8); a texture with no variant stays as it was
    ok(made.length > 0 && made.some((l) => /scene texture "speedo"[^\n]* R8 asset/.test(l)) && made.some((l) => /scene texture "tacho"[^\n]* R8 asset/.test(l)), 'scene textures "r8": made again, the two dial faces as R8 (' + made.length + ' made)');
    ok(p.activeName === 'wb_comfort', 'Comfort is still drawn');
    const before2 = textures().length;
    await click('SET_DIAGSCENETEX', 0);
    await until((q) => q.settings.diagSceneTex === 'off', 4000);
    await sleep(4000);
    const made2 = textures().slice(before2);
    ok(made2.length > 0 && made2.some((l) => /RGBA8 asset/.test(l)), 'scene textures off: the RGBA8 files again (' + made2.length + ' made)');
    ok(!/error|exception/i.test(logText.split('\n').filter((l) => /\bdiag\b|mb:/.test(l)).join('\n')), 'no error in the diagnostics lines');
    ok(!/pixel memory is full|asset refused|layer refused/i.test(logText), 'the service never said its pixel memory was full, nor refused an asset or a layer (the old and the new scene textures never sat together)');
    p = await probe();
    ok(p && p.ready, 'the app is still up');
    await stop();
}

async function main() {
    await unit();
    if (process.argv.indexOf('--unit') < 0) {
        const only = process.argv.indexOf('--only') > 0 ? process.argv[process.argv.indexOf('--only') + 1] : '';
        try { if (only !== 'f30') await twin(); if (only !== 'twin') await f30(); } finally { await stop(); }
    }
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); stop().then(() => process.exit(1)); });
