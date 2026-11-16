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
// package X: the geometry the safety checks compare against, read from the layout itself (panel px, half-open boxes)
const LAY = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts', 'wb_dials.json'), 'utf8'));
const lw = (id) => LAY.widgets.find((w) => w.id === id);
// strip integration: package M's strip mask replaced u_cc ("cc"), the marker window ("ccMark") and the road bar
// ("nav_bg"): BMW's panel opens through the mask's "msg" hole lane, whose box is the lane table's "hole". Its lanes are
// read off the baked texture here so the coverage checks below run on the very bytes the car gets.
const MASKF = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'scene', lw('bg').mask.tex + '.json'), 'utf8'));
const MT = MASKF.mask, MASK_BYTES = Buffer.from(MASKF.r8, 'base64');
/** A lane's coverage (0..1) at panel pixel (x, y) (whole px), or null outside its box. */
const laneAt = (k, x, y) => {
    const box = k === 'msg' || k === 'mark' || k === 'msgMark' ? MT.hole : MT.cover, o = MT.lanes[k];
    if (!o || x < box[0] || y < box[1] || x >= box[2] || y >= box[3]) return null;
    return MASK_BYTES[(y - box[1] + o[1]) * MASKF.w + (x - box[0] + o[0])] / 255;
};
const CCL = lw('cc_line');
const cat = {};
JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'overlay', 'g20_comfort.json'), 'utf8')).elements.forEach((e) => { cat[e.id] = e; });
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
// --- package F (strip, 2026-11-16): what our image layers hold inside a panel box, read off the bench ---
/** The bench's layers now: the first "scene" event of GET /events, then the stream is closed. */
async function sceneNow() {
    const ac = new AbortController();
    const r = await fetch(BASE + '/events', { signal: ac.signal });
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const chunk = buf.slice(0, i);
                buf = buf.slice(i + 2);
                if (chunk.indexOf('data: ') !== 0) continue;
                const m = JSON.parse(chunk.slice(6));
                if (m.t === 'scene') { ac.abort(); return m.layers; }
            }
        }
    } catch (e) { if (e.name !== 'AbortError') throw e; }
    return [];
}
/** Pixels with alpha in panel box [x0, y0, x1, y1) over every image layer of ours, per panel row: { total, at(y0, y1) }. */
async function inkRows(box) {
    const per = {};
    let total = 0;
    for (const l of await sceneNow()) {
        if (l.kind !== 'image' || l.target !== 'panel' || l.iw !== l.w || l.ih !== l.h) continue;
        const x0 = Math.max(box[0], l.x), y0 = Math.max(box[1], l.y), x1 = Math.min(box[2], l.x + l.w), y1 = Math.min(box[3], l.y + l.h);
        if (x1 <= x0 || y1 <= y0) continue;
        const r = await fetch(BASE + '/px?key=' + encodeURIComponent(l.key) + '&x=' + (x0 - l.x) + '&y=' + (y0 - l.y) + '&w=' + (x1 - x0) + '&h=' + (y1 - y0));
        if (r.status !== 200) continue;
        const px = Buffer.from(await r.arrayBuffer());
        for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < x1 - x0; x++) if (px[(y * (x1 - x0) + x) * 4 + 3]) { per[y0 + y] = (per[y0 + y] || 0) + 1; total++; }
    }
    return { total, at: (a, b) => { let n = 0; for (let y = a; y < b; y++) n += per[y] || 0; return n; } };
}
// --- end package F ---

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
    // package X (2026-11-16, "fallback is all-or-nothing"): the row is ONE thing. It waits - BMW's, no latch - for a
    // time zone (the clock is always ours in all6WB) and for the car's message to be read once, then comes in WHOLE,
    // by itself, with no restart.
    console.log('all6WB waits for the car, whole: no time zone, then no message read, means the whole row is BMW\'s');
    const allOwn = (q, v) => ['range', 'clock', 'temp', 'nav', 'sign', 'info'].every((i) => (S(q).own || {})[i] === v);
    await set('bottomRow', 'all6WB');
    p = await until((q) => /time zone/.test((S(q).row || {}).why || ''), 20000);
    ok(/waiting for a time zone/.test(S(p).row.why), 'no time zone known yet: the row is BMW\'s (' + S(p).row.why + ')');
    ok(allOwn(p, false), 'every item of it, not only the clock (' + JSON.stringify(S(p).own) + ')');
    ok(JSON.stringify(S(p).widgets) === '[]', 'nothing of ours is built for the row (' + JSON.stringify(S(p).widgets) + ')');
    ok(JSON.stringify(S(p).fail) === '{}', 'and nothing latched: it is a wait, not a fallback');
    await scene('clock-plus2');
    p = await until((q) => /check-control/.test((S(q).row || {}).why || ''), 20000);
    ok(S(p).cc && S(p).cc.shown === null, 'nothing has been read out of config.ccm yet (shown ' + JSON.stringify(S(p).cc.shown) + ')');
    ok(/waiting for the car's check-control message/.test(S(p).row.why) && allOwn(p, false),
        'with a zone, the row still waits, whole, for the car\'s message to be read once (' + S(p).row.why + ')');
    for (let i = 0; i < 40 && !/clock: ours shows \d\d:\d\d, UTC\+02:00 from the car/.test(logText); i++) await sleep(100);
    const clockLine = (logText.match(/clock: ours shows (\d\d):(\d\d), UTC\+02:00 from the car[^\n]*/) || [])[0] || '';
    const utc2 = new Date(Date.now() + 120 * 60000), mins = (h, m) => Number(h) * 60 + Number(m);
    const shownAt = clockLine ? mins(clockLine.slice(18, 20), clockLine.slice(21, 23)) : -99;
    ok(clockLine && Math.abs(shownAt - (utc2.getUTCHours() * 60 + utc2.getUTCMinutes())) <= 5,
        'one log line says what our clock shows, the offset and its source, and the time is UTC+2 (' + clockLine.slice(0, 60) + ')');
    await scene('cc-red');
    // the first readable message must bring the row in BY ITSELF (hud.js _rowSync rebuilds)
    p = await until((q) => (S(q).widgets || []).indexOf('cc_line') >= 0, 20000);
    ok(allOwn(p, true) && S(p).row.why === null, 'the first message the car sends makes the WHOLE row ours, with no restart');
    ok(['cc_line', 'nav', 'signs', 'own_clock'].every((i) => (S(p).widgets || []).indexOf(i) >= 0),
        'and our message line, road label, sign and clock are built then (' + JSON.stringify(S(p).widgets) + ')');
    ok((S(p).widgets || []).indexOf('cc_name') < 0 && (S(p).widgets || []).indexOf('cc_desc') < 0, 'the two-line text is gone: one line');
    // strip integration: covered = the "ours" lane and NO hole lane; and BMW's marker stays covered too (decision 7)
    const maskIs = (q, cover, hole) => { const m = (S(q).safety || {}).mask; return !!m && m.cover === cover && m.hole === hole; };
    p = await until((q) => (S(q).safety || {}).onScreen === true && maskIs(q, 'ours', null), 5000);
    ok(S(p).safety.onScreen === true && maskIs(p, 'ours', null),
        'once ours is on the screen BMW\'s panel is covered, and its marker too: the "ours" lane, no hole lane (' + JSON.stringify(S(p).safety.mask) + ')');
    await scene('cc-clear');
    p = await until((q) => S(q).cc && S(q).cc.shown === false, 5000);
    ok(allOwn(p, true), 'and it stays ours once that message is cleared again');
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
    // strip integration: no bar any more ("nav_bg"): the strip mask's "ours" lane is the black under the label
    ok((S(p).widgets || []).indexOf('nav') >= 0 && (S(p).widgets || []).indexOf('nav_bg') < 0, 'all6WB builds the label, on the mask\'s black, with no bar layer (' + JSON.stringify(S(p).widgets) + ')');
    p = await until((q) => (S(q).widgets || []).indexOf('signs') >= 0, 20000);
    ok((S(p).widgets || []).indexOf('signs') >= 0 && (S(p).widgets || []).indexOf('limit') >= 0, 'all6WB builds the sign and its figure');
    await scene('cc-red');
    p = await until((q) => (S(q).widgets || []).indexOf('cc_line') >= 0 && S(q).cc.name, 20000);
    ok((S(p).widgets || []).indexOf('cc_line') >= 0, 'all6WB builds our message line');
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

    // --- package F (strip, 2026-11-16): the car's words in Ukrainian draw, with no latch. Until the fonts carried
    // Cyrillic, any of them handed the element back to BMW at once (the old "way back" check below used a Ukrainian
    // street for that). Checked on the pixels too: the road label's sheet has ink in the label's box, including the
    // rows above the capitals (Ґ's upturn) and below the baseline (р, у), so neither end of the taller cell is clipped.
    console.log('Ukrainian: the road label and the message are drawn by us, nothing falls back');
    await set('bottomRow', 'all6WB');
    await scene('road-cyrillic');
    p = await until((q) => (S(q).widgets || []).indexOf('nav') >= 0 && S(q).road === 'Ґрунтова вулиця', 20000);
    ok(S(p).road === 'Ґрунтова вулиця' && (S(p).widgets || []).indexOf('nav') >= 0, 'a Ukrainian road label is ours and built (' + (S(p).road || '').length + ' characters)');
    await sleep(1500);
    p = await probe();
    ok(JSON.stringify(S(p).fail) === '{}' && S(p).own.nav === true, 'and nothing latched back to BMW (' + JSON.stringify(S(p).fail) + ')');
    const lay = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts', p.activeName + '.json'), 'utf8'));
    const navW = lay.widgets.find((w) => w.id === 'nav'), capF = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'fonts', navW.font + '.json'), 'utf8'));
    const base = navW.y + capF.baseline;
    const rows = await inkRows([navW.x, navW.y, navW.x + navW.w, navW.y + navW.h]);
    ok(rows.total > 0, 'the label has ink on the bench (' + rows.total + ' px with alpha in its box)');
    ok(rows.at(base - 19, base - 15) > 0, 'including the rows above the capitals, where Ґ turns up (' + rows.at(base - 19, base - 15) + ' px)');
    ok(rows.at(base, base + 5) > 0, 'and below the baseline, where р and у reach (' + rows.at(base, base + 5) + ' px)');
    await scene('cc-cyrillic');
    // (strip integration: package X made the message one line, "cc_line"; F's check was written on "cc_name")
    p = await until((q) => (S(q).widgets || []).indexOf('cc_line') >= 0 && S(q).cc && S(q).cc.name, 20000);
    ok((S(p).widgets || []).indexOf('cc_line') >= 0 && S(p).cc.name === 'Низький тиск у шинах', 'a Ukrainian message is ours and built (apostrophes, guillemets, dash and number sign in it)');
    await sleep(1500);
    p = await probe();
    ok(JSON.stringify(S(p).fail) === '{}' && S(p).own.info === true, 'and nothing latched back to BMW (' + JSON.stringify(S(p).fail) + ')');
    const ccW = lay.widgets.find((w) => w.id === 'cc_line');
    const ccRows = await inkRows([ccW.x, ccW.y, ccW.x + ccW.w, ccW.y + ccW.h]);
    ok(ccRows.total > 0, 'the message has ink on the bench (' + ccRows.total + ' px)');
    ok(!/has no glyph for/.test(logText), 'and no font reported a missing glyph');
    await scene('cc-clear');
    await scene('road-street');
    await set('bottomRow', 'allG20');
    // --- end package F ---

    console.log('the way back');
    ok(JSON.stringify(S(p).fail) === '{}', 'nothing fell back while every signal was there and could be drawn (' + JSON.stringify(S(p).fail) + ')');
    // a word our baked font has no glyph for: the element gives itself back to the car rather than draw holes
    // (package F: Greek, since Ukrainian is baked now - a character outside the set still falls back, never a box)
    await set('bottomRow', 'all6WB');
    await until((q) => (S(q).widgets || []).indexOf('nav') >= 0, 20000);
    await fake({ road: { text: 'Οδός Ελιάς' } });
    p = await until((q) => S(q).fail && S(q).fail.nav, 20000);
    ok(S(p).fail && S(p).fail.nav === true, 'a street name the font cannot draw gives the label back to BMW');
    p = await until((q) => (S(q).widgets || []).indexOf('nav') < 0, 20000);
    ok((S(p).widgets || []).indexOf('nav') < 0, 'and our label is dropped, so the car draws its own again');
    ok(/bottom row: the whole row is BMW's again until the app restarts - nav: the font/.test(logText),
        'the log says once, for the whole row, which font and how many characters, not the name');
    // package X: all-or-nothing - the per-element hand-back stacked three texts on each other (2026-11-16)
    ok(allOwn(p, false) && JSON.stringify(S(p).widgets) === '[]',
        'and the latch takes the WHOLE row: nothing of ours is left in it (' + JSON.stringify(S(p).own) + ', ' + JSON.stringify(S(p).widgets) + ')');
    ok((logText.match(/the whole row is BMW's again/g) || []).length === 1, 'logged once');
    await set('bottomRow', 'allG20');

    // ---- package X (docs/strip/X-REPORT.md): the safety rule, one case per way it can go wrong, each on a FRESH app
    // (hud.js _rowFail is a latch until the app restarts, so a case measured after another would measure its latch).
    // The rule: the car says a message shows and our own text for it is not on the screen -> BMW's panel is visible:
    // WBBACK's u_cc is BMW's whole panel AND the road bar's hole is open. bench/run-app.js audits that between every
    // two ticks of the engine (safety.audit); each case also asserts it at the probe, and the gap case at the renderer.
    // Strip integration: after package M there is no u_cc and no road bar in this layout. "BMW's panel open" is the
    // strip mask's "msg" hole lane sent with the lane table's hole box (u_mh) and the msg tile's origin (u_mo.zw), and
    // no layer of ours left over the panel (no bar: navHole null). Every assertion below is the same, on the mask.
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const restart = async () => {
        await req('POST', '/restart');
        await sleep(1000);
        const q = await until((r) => r && r.ready && r.activeName === 'wb_dials' && S(r).row, 90000);
        await req('POST', '/signals', { mode: 'manual', values: { rpm: 1500, speed: 50, gear: 3, oil: 95, coolant: 90 } });
        return q;
    };
    // all6WB with a time zone and the message struct read once (no message on): the whole row ours
    const rowReady = async () => {
        await set('bottomRow', 'all6WB');
        await scene('clock-plus2'); await scene('cc-clear'); await scene('road-street');
        return until((q) => S(q).row && S(q).row.why === null && (S(q).widgets || []).indexOf('cc_line') >= 0, 20000);
    };
    const bmwOpen = (q) => { const m = (S(q).safety || {}).mask; return !!m && m.hole === 'msg' && same(m.box, MT.hole); };
    // (half a second more of audit first, so a case that latched at once has frames of the message showing too)
    const clean = async (q0, what) => {
        await sleep(500);
        const q = await probe();
        ok(S(q).safety && S(q).safety.audit.shown > 0 && S(q).safety.audit.violations === 0,
            what + ': never once covered while ours was not on the screen (' + JSON.stringify(S(q).safety && S(q).safety.audit) + ')');
    };
    /** The renderer's own scene (GET /events, its first "scene" message): every layer with its uniforms. */
    async function renderer() {
        const ac = new AbortController();
        try {
            const r = await fetch(BASE + '/events', { signal: ac.signal });
            const rd = r.body.getReader();
            let buf = '';
            const end = Date.now() + 8000;
            while (Date.now() < end) {
                const { value, done } = await rd.read();
                if (done) break;
                buf += Buffer.from(value).toString();
                let i;
                while ((i = buf.indexOf('\n\n')) >= 0) {
                    const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
                    if (chunk.indexOf('data: ') !== 0) continue;
                    const m = JSON.parse(chunk.slice(6));
                    if (m.t === 'scene') return m.layers;
                }
            }
        } catch (e) { /* aborted below */ } finally { ac.abort(); }
        return null;
    }

    console.log('package X, safety 1: the gap between the message arriving and our first draw');
    await restart();
    p = await rowReady();
    ok(p && S(p).row.why === null, 'a fresh app with the whole row ours');
    await fake({ hook: 'ccHold' });                      // our first draw is late: held back until released
    await scene('cc-red');
    let gapN = 0, gapOk = 0;
    for (const t0 = Date.now(); Date.now() - t0 < 1500;) {
        const q = await probe();
        if (S(q).cc && S(q).cc.shown === true) {
            gapN++;
            if (!S(q).safety.onScreen && S(q).safety.open && bmwOpen(q) && S(q).safety.navHole === null) gapOk++;
        }
        await sleep(50);
    }
    ok(gapN >= 10 && gapOk === gapN, 'with our first draw held back for 1.5 s, BMW\'s panel stayed open through the mask\'s "msg" lane, with no bar of ours over it (' + gapOk + ' of ' + gapN + ' probes)');
    const layers = await renderer();
    const back = (layers || []).find((l) => l.uniforms && l.uniforms.u_mh && l.uniforms.u_mo);
    const uv = (k) => back && back.uniforms[k] && (back.uniforms[k].v || back.uniforms[k]);
    ok(back && same(uv('u_mh'), MT.hole) && same(uv('u_mo').slice(2), MT.lanes.msg),
        'the renderer itself holds u_mh = BMW\'s panel hole box and u_mo = the "msg" tile (' + JSON.stringify(uv('u_mh')) + ', ' + JSON.stringify(uv('u_mo')) + ')');
    await fake({ hook: 'ccRelease' });
    p = await until((q) => S(q).safety.onScreen === true && maskIs(q, 'ours', null), 5000);
    ok(S(p).safety.onScreen === true && maskIs(p, 'ours', null) && S(p).safety.navHole === null,
        'released: ours is drawn, then BMW\'s panel is covered (the "ours" lane, no hole lane) and its marker stays covered');
    await clean(p, 'the gap');
    // BMW's panel is FULLY covered while ours is drawn: wherever the "msg" lane would open it (its coverage < 1), the
    // "ours" lane is solid black (>= 254/255), read off the baked texture itself
    let open = 0, rowsBad = 0, worst = 1;
    for (let y = MT.hole[1]; y < MT.hole[3]; y++) {
        let bad = false;
        for (let x = MT.hole[0]; x < MT.hole[2]; x++) {
            if (laneAt('msg', x, y) >= 1) continue;
            open++;
            const o = laneAt('ours', x, y);
            const v = o === null ? 0 : o;
            worst = Math.min(worst, v);
            if (v < 254 / 255) bad = true;
        }
        if (bad) rowsBad++;
    }
    ok(open > 0 && rowsBad === 0, 'while ours is drawn BMW\'s whole panel (' + open + ' px the "msg" lane opens) is under solid black in "ours" (' + rowsBad + ' rows open, least ' + worst.toFixed(3) + ')');
    // the safety footprint: no cover lane puts any black within 3 px of a belt or airbag telltale (package ZL's
    // measured boxes, which are wider than the catalogue's), and the panel's hole keeps off them too
    const ZLB = { 'bottom.belt_rear': [500.5, 677.75, 580.25, 715.25], 'bottom.belt_driver': [590.0, 664.5, 628.75, 715.25], 'bottom.airbag': [632.75, 664.25, 684.25, 715.5] };
    Object.keys(ZLB).forEach((id) => {
        const b = ZLB[id], f = [Math.floor(b[0] - 3), Math.floor(b[1] - 3), Math.ceil(b[2] + 3), Math.min(720, Math.ceil(b[3] + 3))];
        let most = 0;
        for (let y = f[1]; y < f[3]; y++) for (let x = f[0]; x < f[2]; x++) {
            ['ours', 'bmw', 'standby'].forEach((k) => { const v = laneAt(k, x, y); if (v !== null) most = Math.max(most, v); });
        }
        ok(most === 0, 'no lane puts black within 3 px of ' + id + ' ' + JSON.stringify(b) + ' (most ' + most.toFixed(3) + ')');
    });

    console.log('package X, safety 2: a character the font lacks');
    await restart();
    p = await rowReady();
    // (strip integration: Ukrainian is baked since package F, so the character the font lacks is Greek now)
    await scene('cc-greek');
    p = await until((q) => S(q).fail && S(q).fail.info && bmwOpen(q), 15000);
    ok(S(p).fail.info === true && /glyph/.test(S(p).row.failWhy.info), 'a Greek message (no such glyphs) latches: ' + S(p).row.failWhy.info);
    ok(/^latched/.test(S(p).row.why) && allOwn(p, false), 'the WHOLE row goes back to BMW\'s (' + S(p).row.why + ')');
    ok(bmwOpen(p) && S(p).safety.open, 'and BMW\'s panel is open: its own message is the one the driver reads');
    p = await until((q) => JSON.stringify(S(q).widgets) === '[]', 10000);
    ok(JSON.stringify(S(p).widgets) === '[]', 'nothing of ours is left in the row (' + JSON.stringify(S(p).widgets) + ')');
    await clean(p, 'a missing glyph');

    console.log('package X, safety 3: drawing our message throws');
    await restart();
    p = await rowReady();
    await fake({ hook: 'ccThrow' });
    await scene('cc-yellow');
    p = await until((q) => S(q).fail && S(q).fail.info && bmwOpen(q), 15000);
    ok(S(p).fail.info === true && /drawing threw/.test(S(p).row.failWhy.info), 'the throw latches: ' + S(p).row.failWhy.info);
    ok(allOwn(p, false) && bmwOpen(p), 'the whole row is BMW\'s and its panel is open');
    ok(!exited && !/uncaught/.test(logText), 'and the app did not go down with it');
    await clean(p, 'a throw while drawing');

    console.log('package X, safety 4: a message the struct does not let us read');
    await restart();
    p = await rowReady();
    await scene('cc-unread');
    p = await until((q) => S(q).fail && S(q).fail.info && bmwOpen(q), 15000);
    ok(S(p).cc.shown === true && S(p).safety.unread === true, 'a symbol with no name or description counts as a message showing');
    ok(/cannot read/.test(S(p).row.failWhy.info) && allOwn(p, false) && bmwOpen(p), 'it latches the whole row and BMW\'s panel is open (' + S(p).row.failWhy.info + ')');
    await clean(p, 'an unreadable message (a symbol, no text)');
    await restart();
    p = await rowReady();
    await scene('cc-unread-root');
    p = await until((q) => S(q).fail && S(q).fail.info && bmwOpen(q), 15000);
    ok(/no root of the union fits/.test(S(p).row.failWhy.info) && S(p).cc.shown === true && bmwOpen(p),
        'a union member we do not know counts as showing, latches, and opens BMW\'s panel (' + S(p).row.failWhy.info + ')');
    await clean(p, 'an unreadable message (an unknown union member)');

    console.log('package X: standby is BMW\'s row, in both modes; our message\'s two looks; a long headline');
    await restart();
    p = await rowReady();
    // package P's correction (photos 63, 64): P with the engine off is NOT standby - BMW draws its normal row then.
    // Standby is BMW's vehicle condition WOHNEN (5; hud.js COND_STANDBY, a hypothesis to confirm on the car).
    await req('POST', '/signals', { mode: 'manual', values: { rpm: 0, speed: 0, gear: 0, oil: 60, coolant: 60, condition: 7 } });
    await sleep(2500);                                   // past STANDBY_MS: had it counted as standby, it would show now
    p = await probe();
    ok(S(p).row.why === null && allOwn(p, true), 'P, engine off, condition 7 (photo 63\'s state): the row stays ours, not standby');
    await set('bottomRow', 'allG20');
    p = await until((q) => JSON.stringify(S(q).widgets) === '[]' && S(q).row.signWin !== null, 20000);
    await sleep(300);
    p = await probe();
    ok(S(p).row.signWin === 1, 'and in allG20 the window over BMW\'s sign stays OPEN there: BMW still draws its sign (u_cut mode ' + S(p).row.signWin + ')');
    await req('POST', '/signals', { mode: 'manual', values: { rpm: 0, speed: 0, gear: 0, oil: 60, coolant: 60, condition: 5 } });
    p = await until((q) => S(q).row && S(q).row.signWin === 3, 5000);
    ok(S(p).row.signWin === 3, 'condition 5 (standby): the window over BMW\'s sign shuts in allG20 (u_cut mode ' + S(p).row.signWin + ')');
    ok(/vehicle condition 5 = standby/.test(logText), 'each new condition value is logged once, to confirm 5 = standby on the car');
    await set('bottomRow', 'all6WB');
    p = await until((q) => /standby/.test((S(q).row || {}).why || '') && JSON.stringify(S(q).widgets) === '[]', 15000);
    ok(/standby/.test(S(p).row.why) && allOwn(p, false) && JSON.stringify(S(p).widgets) === '[]',
        'standby in all6WB: the whole row is BMW\'s, nothing of ours built (' + S(p).row.why + ')');
    ok(JSON.stringify(S(p).fail) === '{}', 'standby is not a latch');
    await req('POST', '/signals', { mode: 'manual', values: { rpm: 1500, speed: 50, gear: 3, oil: 95, coolant: 90 } });
    p = await until((q) => S(q).row && S(q).row.why === null && (S(q).widgets || []).indexOf('cc_line') >= 0, 15000);
    ok(S(p).row.why === null && allOwn(p, true), 'out of standby the row is ours again, by itself');
    await scene('cc-green');
    p = await until((q) => S(q).safety.onScreen === true, 5000);
    ok(S(p).safety.style === 'A' && S(p).safety.onScreen, 'look A (marker + headline) is the default, drawn');
    ok(S(p).road === '', 'the road label steps aside while our message shows');
    await set('ccStyle', 'B');
    p = await until((q) => S(q).safety.style === 'B', 8000);
    ok(S(p).safety.style === 'B' && S(p).safety.onScreen && (S(p).widgets || []).indexOf('cc_line') >= 0,
        'look B in place, with no rebuild and BMW\'s panel still covered');
    await set('ccStyle', 'A');
    await scene('cc-long-name');
    p = await until((q) => S(q).safety.onScreen === true && S(q).safety.fit && S(q).safety.fit.cut, 8000);
    ok(S(p).safety.fit && S(p).safety.fit.cut === true && S(p).safety.fit.width <= CCL.w - 16,
        'a headline wider than the slot is cut with "..." to ' + (S(p).safety.fit || {}).width + ' px (' + (S(p).safety.fit || {}).chars + ' characters)');
    await clean(p, 'standby, the looks and a long headline');
    await scene('cc-clear');
    await fake({ clock: { minutes: 900, dst: false } });     // +15 h: no such zone
    p = await until((q) => /time zone/.test((S(q).row || {}).why || ''), 10000);
    ok(/time zone/.test(S(p).row.why) && S(p).tz === null && JSON.stringify(S(p).fail) === '{}',
        'an offset past +14 h is not a time zone: the row waits, BMW\'s, no latch (' + S(p).row.why + ')');
    await scene('clock-plus2');
    p = await until((q) => S(q).row && S(q).row.why === null, 15000);
    ok(S(p).row.why === null && S(p).tz && S(p).tz.min === 120, 'and with a zone again it is ours again (' + JSON.stringify(S(p).tz) + ')');
    await set('bottomRow', 'allG20');
    await until((q) => JSON.stringify(S(q).widgets) === '[]', 20000);
    // ---- end package X ----

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
