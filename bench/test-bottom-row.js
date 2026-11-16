'use strict';
/**
 * test-bottom-row.js - a scripted test of the "bottom row" package (docs/BOTTOM-ROW-PACKAGE.md) on the bench.
 *
 *   node bench/test-bottom-row.js            (BENCH_PORT, default 8140)
 *
 * Starts bench/server.js for f30_cluster with its own data folder, feeds the car's own speed-limit struct,
 * check-control message, road label, guidance and clock through bench/fake-signs.js (POST /fake), presses the new
 * settings the way the car's HMI does (POST /click on the drop-downs) and reads back what the engine made of it
 * (GET /probe "signs"): the parsers, the switching, the fallback and the settings group.
 *
 * It checks the DATA and the SWITCHING, which is what this package builds. What the drawing looks like is the next
 * package's job (docs/G20-DESIGN-SPEC.md); the bench page shows it.
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT) || 8140;
const BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bottom-row-'));
const dataDir = path.join(tmp, 'data'), screenDir = path.join(tmp, 'screen');
fs.mkdirSync(dataDir); fs.mkdirSync(screenDir);
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'app.json'), 'utf8'));
const item = (k) => spec.settings.find((s) => s.key === k);
const opts = (k) => item(k).options.map((o) => o[0]);

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
const click = (id, row) => req('POST', '/click', row === undefined ? { id } : { id, row });
const fake = (v) => req('POST', '/fake', v);
const scene = (s) => fake({ scene: s });
const set = (key, value) => click('SET_' + key.toUpperCase(), opts(key).indexOf(value));
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await probe(); if (fn(p)) return p; } catch (e) { /* app (re)starting */ }
        await sleep(150);
    }
    return p;
}
const S = (p) => (p && p.signs) || {};

async function main() {
    console.log('bench on ' + BASE + ', data in ' + tmp);
    server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'f30_cluster'], {
        cwd: ROOT, env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, SCREEN_DIR: screenDir }),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (d) => { logText += d; if (/app exited/.test(String(d))) exited = true; };
    server.stdout.on('data', keep); server.stderr.on('data', keep);

    console.log('start');
    let p = await until((q) => q && q.ready && q.activeName, 90000);
    ok(p && p.ready, 'the app runs and reaches the fake cluster-render');
    if (!p || !p.ready) return;
    const w = S(p).wired || {};
    ok(w.sign && w.ccm && w.road && w.nav, 'app.json names every field: sign ' + w.sign + ', message ' + w.ccm + ', road ' + w.road + ', navigation ' + w.nav);

    // one theme for every mode, and the see-through look that has all three elements: since 2026-11-15 that is
    // 6WB Comfort with the "g20" toggle on (a checkbox press), not a theme of its own (docs/ONE-SWITCH-DONE.md)
    await click('SET_BYMODE');
    await set('hudLayout', 'wb_comfort');
    await click('SET_G20');
    p = await until((q) => q.activeName === 'wb_dials', 20000);
    ok(p.activeName === 'wb_dials' && p.settings.g20 === true, 'the G20 toggle builds the see-through Comfort (wb_dials)');

    console.log('defaults: the whole row is BMW\'s and nothing of ours is built');
    ok(p.settings.bottomRow === 'allG20', 'bottomRow defaults to "allG20" (BMW draws the row)');
    ok(S(p).own && !S(p).own.nav && !S(p).own.sign && !S(p).own.info && !S(p).own.range && !S(p).own.temp,
        'the engine reports every item of the row as BMW\'s');
    ok(JSON.stringify(S(p).widgets) === '[]', 'no widget of ours is built for them (' + JSON.stringify(S(p).widgets) + ')');

    // 2026-11-16, the owner's car: with "all6WB" BMW's own message came out sliced across the middle. The info field
    // counted as ours the moment the switch said so, although NOTHING had ever been read out of config.ccm: our own
    // text was empty, our black covered BMW's message from y 666 down and the patch covered it to y 652, and the "cc"
    // window never opened because the window follows "a message shows", which that car never says. Until the car's
    // message has actually been read the field is BMW's and its panel is left see-through. No latch: the field comes
    // back by itself at the first message, so a slow provider costs nothing.
    console.log('the message field waits for the car: unread means BMW\'s, and no latch');
    await set('bottomRow', 'all6WB');
    p = await until((q) => S(q).own && S(q).own.nav === true, 20000);
    ok(S(p).cc && S(p).cc.shown === null, 'nothing has been read out of config.ccm yet (shown ' + JSON.stringify(S(p).cc.shown) + ')');
    ok(S(p).own.info === false, 'the info field reads as BMW\'s although the switch says all6WB');
    ok((S(p).widgets || []).indexOf('cc_name') < 0 && (S(p).widgets || []).indexOf('cc_desc') < 0,
        'and no message text of ours is built, so nothing of ours covers BMW\'s (' + JSON.stringify(S(p).widgets) + ')');
    ok(S(p).own.nav === true && S(p).own.sign === true, 'the rest of the row is ours: the message alone waits');
    ok(JSON.stringify(S(p).fail) === '{}', 'and nothing latched: it is a wait, not a fallback (' + JSON.stringify(S(p).fail) + ')');
    await scene('cc-red');
    // the first readable message must bring the field in BY ITSELF: it rebuilds the layout, the way the car's first
    // time zone brings our clock in. Without that our text would wait for the next setting change.
    p = await until((q) => (S(q).widgets || []).indexOf('cc_name') >= 0, 20000);
    ok(S(p).own.info === true, 'the first message the car sends makes the field ours, with no restart');
    ok((S(p).widgets || []).indexOf('cc_name') >= 0 && (S(p).widgets || []).indexOf('cc_desc') >= 0,
        'and our own message text is built then, with no other change (' + JSON.stringify(S(p).widgets) + ')');
    await scene('cc-clear');
    p = await until((q) => S(q).cc && S(q).cc.shown === false, 5000);
    ok(S(p).own.info === true, 'and it stays ours once that message is cleared again');
    await set('bottomRow', 'allG20');
    p = await until((q) => JSON.stringify(S(q).widgets) === '[]', 20000);
    ok(JSON.stringify(S(p).widgets) === '[]', 'back to the default: nothing of ours is built again');

    console.log('the speed-limit struct is read in every state');
    const cases = [
        ['limit-50', (s) => s.state === 'limit' && Math.round(s.kmh) === 50 && s.unit === 'kmh'],
        ['limit-80-rain', (s) => s.state === 'limit' && Math.round(s.kmh) === 80 && s.supp === 'rain'],
        ['limit-130-warn1', (s) => s.warn === 1 && Math.round(s.kmh) === 130],
        ['limit-30-warn2-school', (s) => s.warn === 2 && s.supp === 'school'],
        ['limit-55-mph', (s) => s.state === 'limit' && s.unit === 'mph' && s.shown === 55 && Math.round(s.kmh) === 89 && s.style === 'us'],
        ['limit-end', (s) => s.state === 'end'],
        ['limit-unknown', (s) => s.state === 'unknown'],
        ['limit-none', (s) => s.state === 'none'],
        ['limit-invalid', (s) => s.state === 'none'],
        ['nopass-car', (s) => s.np === 'car' && s.npM === 1200],
        ['nopass-truck', (s) => s.np === 'truck'],
    ];
    for (const c of cases) {
        await scene(c[0]);
        p = await until((q) => c[1](S(q).sign || {}), 4000);
        ok(c[1](S(p).sign || {}), c[0] + ' -> ' + JSON.stringify(S(p).sign));
    }

    console.log('every supplemental and every no-passing value maps');
    const supps = Object.keys(spec.config.sign.suppMap).filter((k) => !/^\d+$/.test(k));
    let suppOk = 0;
    for (const name of supps) {
        const want = spec.config.sign.suppMap[name];
        await fake({ sign: { state: 'limit', value: 60, unit: 'kmh', supp: want } });
        p = await until((q) => (S(q).sign || {}).supp === (want || null), 3000);
        if ((S(p).sign || {}).supp === (want || null)) suppOk++;
    }
    ok(suppOk === supps.length, 'all ' + supps.length + ' supplemental values map (' + suppOk + ' ok)');
    const nps = Object.keys(spec.config.sign.npMap).filter((k) => !/^\d+$/.test(k));
    let npOk = 0;
    for (const name of nps) {
        const want = spec.config.sign.npMap[name];
        await fake({ sign: { state: 'limit', value: 60, unit: 'kmh', np: want } });
        p = await until((q) => (S(q).sign || {}).np === want, 3000);
        if ((S(p).sign || {}).np === want) npOk++;
    }
    ok(npOk === nps.length, 'all ' + nps.length + ' no-passing values map (' + npOk + ' ok)');

    console.log('the check-control message is read in every colour, and a long one');
    for (const c of ['cc-red', 'cc-yellow', 'cc-green', 'cc-orange', 'cc-white']) {
        await scene(c);
        const want = c.slice(3);
        p = await until((q) => ((S(q).cc || {}).parsed || {}).color === want, 4000);
        ok(((S(p).cc || {}).parsed || {}).color === want, c + ' -> colour ' + ((S(p).cc || {}).parsed || {}).color + ', name ' + ((S(p).cc || {}).parsed || {}).name + ' chars');
    }
    await scene('cc-long');
    p = await until((q) => ((S(q).cc || {}).parsed || {}).desc > 120, 4000);
    ok(((S(p).cc || {}).parsed || {}).desc > 120, 'a long message is kept whole (' + ((S(p).cc || {}).parsed || {}).desc + ' chars, the union\'s symbol member)');
    ok(S(p).cc.shown === true, 'the engine says a message shows');
    await scene('cc-clear');
    p = await until((q) => S(q).cc && S(q).cc.shown === false, 4000);
    ok(S(p).cc.shown === false, 'an empty message clears it');

    console.log('the road label: a street, a shield and a number, and guidance');
    await scene('road-street');
    await set('bottomRow', 'all6WB');            // the one switch: every item of the row is ours from here on
    p = await until((q) => S(q).road === 'Hauptstrasse', 20000);
    ok(S(p).road === 'Hauptstrasse', 'a plain street reads back (' + S(p).road + ')');
    await scene('road-shield');
    p = await until((q) => /A 9/.test(S(q).road || ''), 4000);
    ok(/A 9/.test(S(p).road || '') && /Nuernberg/.test(S(p).road || ''), 'a shield and a number read back (' + S(p).road + ')');
    await scene('road-guiding');
    p = await until((q) => S(q).navState === 'on', 4000);
    ok(S(p).navState === 'on', 'guiding state ACTIVE reads back');
    ok(S(p).navDist === '12' && S(p).navEta && S(p).navEta.h === 14, 'distance and arrival time read back (' + S(p).navDist + ', ' + JSON.stringify(S(p).navEta) + ')');
    ok(/B 2/.test(S(p).road || '') && / \/ /.test(S(p).road || ''), 'a spacer becomes its characters (' + S(p).road + ')');

    console.log('the switching: ours is built and drawn, BMW\'s is not');
    p = await until((q) => (S(q).widgets || []).indexOf('nav') >= 0, 20000);
    ok((S(p).widgets || []).indexOf('nav') >= 0 && (S(p).widgets || []).indexOf('nav_bg') >= 0, 'all6WB builds the label and its bar (' + JSON.stringify(S(p).widgets) + ')');
    p = await until((q) => (S(q).widgets || []).indexOf('signs') >= 0, 20000);
    ok((S(p).widgets || []).indexOf('signs') >= 0 && (S(p).widgets || []).indexOf('limit') >= 0, 'all6WB builds the sign and its figure');
    await scene('cc-red');
    p = await until((q) => (S(q).widgets || []).indexOf('cc_name') >= 0 && S(q).cc.name, 20000);
    ok((S(p).widgets || []).indexOf('cc_name') >= 0 && (S(p).widgets || []).indexOf('cc_desc') >= 0, 'all6WB builds the message text');
    ok(S(p).cc.name === 'Engine malfunction' && /Drive on/.test(S(p).cc.desc), 'and the text is the car\'s own (' + S(p).cc.name + ')');
    ok(S(p).road === '', 'the road label steps aside while a message shows, as BMW does');

    // package M (docs/strip/M-REPORT.md): the four black patches (u_pat0..3, at most four, a fifth dropped in
    // silence) are gone; the strip mask's lanes hide BMW's row now, with no cap. bench/test-strip-mask.js checks
    // their geometry against the catalogue: "ours" covers BMW's range, clock and temperature whole, no lane puts any
    // black on a belt or airbag telltale, and the engine picks the right lane in every state.
    console.log('the black patches are gone: the strip mask hides BMW\'s row (bench/test-strip-mask.js)');
    ok(S(p).patches === null, 'the engine sends no patch rects any more (' + JSON.stringify(S(p).patches) + ')');
    ok(!/black patches do not fit/.test(logText), 'and never warns about a dropped one');

    console.log('several messages at once: the car numbers its frames, and we follow that counter');
    await scene('cc-three');
    p = await until((q) => S(q).cc && S(q).cc.list === 3, 4000);
    ok(S(p).cc.list === 3, 'the list of three is read');
    const seen = {};
    for (let i = 0; i < 20; i++) { const q = await probe(); if (S(q).cc && S(q).cc.name) seen[S(q).cc.name] = 1; await sleep(500); }
    ok(Object.keys(seen).length === 1 && seen['Tyre pressure'],
        'with no frame counter from the car nothing cycles: the newest message stays (' + Object.keys(seen).join(', ') + ')');
    await scene('cc-frame-2');
    p = await until((q) => S(q).cc && S(q).cc.frame && S(q).cc.frame.of === 3, 4000);
    ok(S(p).cc.frame.n === 2 && S(p).cc.frame.of === 3, 'the frame number and count are read (' + JSON.stringify(S(p).cc.frame) + ')');
    const held = {};
    for (let i = 0; i < 20; i++) { const q = await probe(); if (S(q).cc && S(q).cc.name) held[S(q).cc.name] = 1; await sleep(500); }
    ok(Object.keys(held).length === 1 && held['Washer fluid low'],
        'frame 2 of 3 shows the car\'s own second message, and holds it (' + Object.keys(held).join(', ') + ')');
    await fake({ ccFrame: { frame: 3, of: 3, ids: [101, 102, 103] } });
    p = await until((q) => S(q).cc && S(q).cc.name === 'Engine malfunction', 5000);
    ok(S(p).cc.name === 'Engine malfunction', 'frame 3 of 3 steps to the third (' + S(p).cc.name + ')');

    await scene('cc-clear');

    console.log('back to BMW\'s: the one switch, in one press');
    await set('bottomRow', 'allG20');
    p = await until((q) => (S(q).widgets || []).indexOf('signs') < 0, 20000);
    ok((S(p).widgets || []).indexOf('signs') < 0, 'allG20 drops our sign again');
    ok(p.settings.bottomRow === 'allG20', 'and the switch holds the choice ("' + p.settings.bottomRow + '")');
    p = await until((q) => JSON.stringify(S(q).widgets) === '[]', 20000);
    ok(JSON.stringify(S(p).widgets) === '[]', 'nothing of ours is built for the whole row again');
    ok(!S(p).own.range && !S(p).own.clock && !S(p).own.temp && !S(p).own.nav && !S(p).own.sign && !S(p).own.info,
        'and the engine reports every item of the row as BMW\'s');

    console.log('the red arc follows the car\'s own warning, and the driver\'s own setting');
    // live data at 120 km/h, so the "always" case has a speed to compare against the sign
    await req('POST', '/signals', { mode: 'manual', values: { rpm: 2000, speed: 120, gear: 5, oil: 95, coolant: 90 } });
    await fake({ sla: { warn: 'on', warn2: 'on', show: 'on', offset: 3 } });
    await fake({ sign: { state: 'limit', value: 80, unit: 'kmh', warn: 0 } });
    p = await until((q) => S(q).arc === false, 5000);
    ok(S(p).arc === false, 'the car says the driver is not over: no arc');
    await fake({ sign: { state: 'limit', value: 80, unit: 'kmh', warn: 1 } });
    p = await until((q) => S(q).arc === true, 5000);
    ok(S(p).arc === true, 'the car warns at level 1: the arc is on');
    await fake({ sla: { warn: 'off' } });
    p = await until((q) => S(q).arc === false, 5000);
    ok(S(p).arc === false, 'the driver switched the warning off in the car\'s menu: the arc stays off');
    await set('limitArc', 'on');
    p = await until((q) => S(q).arc === true, 8000);
    ok(S(p).arc === true, '"Always when over the limit" overrides the car\'s menu');
    await set('limitArc', 'off');
    p = await until((q) => S(q).arc === false, 8000);
    ok(S(p).arc === false, '"Off" is off');
    await set('limitArc', 'auto');
    await fake({ sla: { warn: 'on' } });

    // 2026-11-15, the owner: the manual "timeZone" setting was retired with five others, so the car's own offset is
    // the only source our clock has left and config.clock.confirm went true. This check used to assert the opposite
    // (parsed, logged, NOT used). The encoding - "factor" 15, quarter hours - is still a guess that only the car can
    // settle; the bench feeds a raw value through that same factor, so it proves the wiring, never the factor.
    console.log('the car\'s clock is now our only source of a time zone');
    await fake({ clock: { minutes: 120, dst: false } });
    p = await until((q) => S(q).tzCar === 120, 5000);
    ok(S(p).tzCar === 120, 'the car\'s offset is taken and used (' + S(p).tzCar + ' minutes)');
    ok(!item('timeZone'), 'and there is no manual time-zone setting left that could override it');

    console.log('the way back');
    ok(JSON.stringify(S(p).fail) === '{}', 'nothing fell back while every signal was there and could be drawn (' + JSON.stringify(S(p).fail) + ')');
    // a word our baked font has no glyph for: the element gives itself back to the car rather than draw holes
    await set('bottomRow', 'all6WB');
    await until((q) => (S(q).widgets || []).indexOf('nav') >= 0, 20000);
    await fake({ road: { text: 'Паркова' } });
    p = await until((q) => S(q).fail && S(q).fail.nav, 20000);
    ok(S(p).fail && S(p).fail.nav === true, 'a street name the font cannot draw gives the label back to BMW');
    p = await until((q) => (S(q).widgets || []).indexOf('nav') < 0, 20000);
    ok((S(p).widgets || []).indexOf('nav') < 0, 'and our label is dropped, so the car draws its own again');
    ok(/bottom row: nav is BMW's again \(the font/.test(logText), 'the log says which font and how many characters, not the name');
    ok(S(p).own.range === true && S(p).own.temp === true,
        'and the latch is that element\'s alone: the rest of the row stays ours whatever the switch said');
    await set('bottomRow', 'allG20');

    console.log('the G20 toggle: on and off again with no restart');
    await click('SET_G20');                       // off: back to the opaque Comfort
    p = await until((q) => q.activeName === 'wb_comfort', 20000);
    ok(p.activeName === 'wb_comfort' && p.settings.g20 === false, 'the toggle off builds the opaque 6WB Comfort');
    for (let i = 1; i <= 4; i++) {
        await click('SET_G20');
        const want = i % 2 ? 'wb_dials' : 'wb_comfort';
        p = await until((q) => q.activeName === want && /^Cluster on/.test(q.status) && !/drawn \(/.test(q.status), 20000);
        ok(p.activeName === want && !/refused|unusable|Cluster: /.test(p.status), 'toggle ' + i + ': ' + (p.status || '').slice(0, 110));
    }
    await click('SET_G20');
    p = await until((q) => q.activeName === 'wb_dials' && /\+ G20/.test(q.status), 20000);
    ok(/6WB Comfort \+ G20/.test(p.status || ''), 'the status line names it "6WB Comfort + G20"');
    ok(!/kombi guard/.test(logText), 'no KOMBI guard strike while toggling');
    await click('SET_G20');
    await until((q) => q.activeName === 'wb_comfort', 20000);

    console.log('every layout still builds');
    for (const v of opts('hudLayout')) {
        await set('hudLayout', v);
        p = await until((q) => q.activeName === v && /^Cluster (on|off)/.test(q.status) && !/drawn \(/.test(q.status), 20000);
        ok(p.activeName === v && !/refused|unusable|Cluster: /.test(p.status), v + ': ' + (p.status || '').slice(0, 110));
    }
    await sleep(800);
    ok(!exited && !/uncaught|app exited/.test(logText), 'the app never exited (no uncaught exception)');
    ok(!/the service's pixel memory is full|too many layers/.test(logText), 'no layer or pixel-memory refusal');
}

main().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    if (server) server.kill('SIGTERM');
    const errs = logText.split('\n').filter((l) => /ERROR/.test(l));
    if (errs.length) { console.log('app errors in the log:'); errs.slice(0, 20).forEach((l) => console.log('  ' + l)); }
    const priv = logText.split('\n').filter((l) => /Hauptstrasse|Nuernberg|Ingolstaedter|Engine malfunction|Drive on with care|latitude|longitude/.test(l));
    console.log(priv.length ? 'PRIVACY: ' + priv.length + ' log line(s) carry content:\n  ' + priv.slice(0, 5).join('\n  ')
        : 'privacy: no road name, message text or coordinate in the log');
    if (priv.length) failed++;
    console.log(passed + ' passed, ' + failed + ' failed');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left in tmp */ }
    process.exit(failed ? 1 : 0);
});
