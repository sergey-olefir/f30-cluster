'use strict';
/**
 * test-road-shields.js - r1120 F1: the road number at the start of the road label on its plate (shared/road_shields.js,
 * docs/ROAD-SHIELDS.md), in f30_cluster's see-through layout with our bottom row.
 *
 *   node bench/test-road-shields.js            (BENCH_PORT, default 8166)
 *   node bench/test-road-shields.js --static   (no bench)
 *
 * Without the bench: the parser on invented labels (Cyrillic and Latin category letters, the five categories, two
 * plates, unknown prefixes left as text, a number that is not at the start), the plate's geometry and colours by day
 * and night, the name cut with "..." inside the box and never the plates, and the wb_shield atlas.
 * With the bench (its own, on BENCH_PORT, its own data folder): the road label the engine draws for a label that starts
 * with a road number has the plate in its pixels at BMW's street row (y 669-709), in the category's colour, and its
 * night colour by night; a label with no number or an unknown prefix has none.
 * Every road name here is invented. Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT) || 8166;
const BASE = 'http://127.0.0.1:' + PORT;
const H = require('./twin-harness');
const dir = H.tree('f30_cluster');
const textRaster = require(path.join(dir, 'hud_text.js'));
const RS = require(path.join(dir, 'road_shields.js'));
const LAY = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts', 'wb_dials.json'), 'utf8'));
const NAV = LAY.widgets.find((w) => w.id === 'nav');
const APP = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'app.json'), 'utf8'));

let passed = 0, failed = 0, server = null, logText = '';
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (c) => '#' + c.slice(0, 3).map((v) => ('0' + v.toString(16)).slice(-2)).join('').toUpperCase();
const FG = [244, 246, 250, 255], LINE = [236, 240, 246, 255];

function staticChecks() {
    console.log('the parser, on invented labels');
    const P = (s) => { const p = RS.parse(s); return p.shields.map((x) => x.cat + ':' + x.text).join(',') + '|' + p.name; };
    const cases = [
        ['М-04 Вигадана вулиця', 'M:M-04|Вигадана вулиця'],       // Cyrillic М, hyphen
        ['M 04 Вигадана вулиця', 'M:M-04|Вигадана вулиця'],       // Latin M, space
        ['Н09 Вигадана вулиця', 'H:H-09|Вигадана вулиця'],        // Cyrillic Н, no separator (as the car wrote it on photo D)
        ['H9 Invented Street', 'H:H-09|Invented Street'],         // one figure: zero-padded
        ['Р50', 'P:P-50|'],                                       // Cyrillic Р alone
        ['P-42 / Вигадана', 'P:P-42|Вигадана'],
        ['Т-17-19 Польова', 'T:T-17-19|Польова'],
        ['T 1719', 'T:T-17-19|'],
        ['E50 Nowhere Road', 'E:E 50|Nowhere Road'],
        ['Е 105 Нікуди', 'E:E 105|Нікуди'],                       // Cyrillic Е
        ['М-04 / E 50 Вигадана вулиця', 'M:M-04,E:E 50|Вигадана вулиця'],
        ['М-04 / E 50 / Р-42 Вигадана', 'M:M-04,E:E 50|Р-42 Вигадана'],     // at most two plates
        ['A7 Nowhere Road', '|A7 Nowhere Road'],                  // an unknown prefix stays text
        ['E 1051 Nowhere', '|E 1051 Nowhere'],                    // four figures: not a European route
        ['М123 Вигадана', '|М123 Вигадана'],                      // three figures: not an М road
        ['м-04 вулиця', '|м-04 вулиця'],                          // lower case: not a road number
        ['М-04Б Вигадана', '|М-04Б Вигадана'],                    // a letter glued on: no separator after the number
        ['Вулиця М-04', '|Вулиця М-04'],                          // not at the start
        ['Вигадана вулиця', '|Вигадана вулиця'],
        ['', '|'],
    ];
    cases.forEach(([s, want]) => ok(P(s) === want, JSON.stringify(s) + ' -> ' + want + (P(s) === want ? '' : ' (got ' + P(s) + ')')));
    ok(RS.parse(null).shields.length === 0 && RS.parse(undefined).name === '', 'no text: no plate, and no throw');

    console.log('the plate, drawn');
    ok(fs.existsSync(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'fonts', 'wb_shield.json')), 'the wb_shield atlas is baked (tools/bake_fonts.py)');
    const g = textRaster.loadFont('wb_shield').metrics.glyphs;
    ok('EHMPT0123456789- '.split('').every((c) => g[c]) && !Object.keys(g).some((c) => c.charCodeAt(0) > 0x7e),
        'wb_shield holds E H M P T, the figures, "-" and space, and nothing beyond ASCII (only our normalised number is drawn in it)');
    ok(APP.shared.indexOf('road_shields.js') >= 0, 'road_shields.js is packed into f30_cluster');
    ok(NAV && NAV.shields && NAV.shields.font === 'wb_shield' && NAV.y + NAV.shields.top === 669,
        'the road label (wb_dials "nav") names the plate: wb_shield, its top at y 669 (BMW\'s street row)');
    const W = NAV.w, Hh = NAV.h, top = NAV.shields.top;
    const draw = (s, night) => RS.paint(W, Hh, s, { textRaster, font: NAV.font, shieldFont: 'wb_shield', plateTop: top, fg: FG, line: LINE, night });
    const px = (r, x, y) => { const o = (y * W + x) * 4; return [r.buf[o], r.buf[o + 1], r.buf[o + 2], r.buf[o + 3]]; };
    const want = { M: ['#E30013', '#5F0008'], H: ['#E30013', '#5F0008'], P: ['#0B63A8', '#052A47'], T: ['#0B63A8', '#052A47'], E: ['#037D4A', '#01341F'] };
    [['М-04 Вигадана', 'M'], ['Н-09 Вигадана', 'H'], ['Р-42 Вигадана', 'P'], ['Т-17-19 Вигадана', 'T'], ['E 50 Nowhere', 'E']].forEach(([s, cat]) => {
        [false, true].forEach((night) => {
            const r = draw(s, night), sh = r.shields[0];
            // the field just inside the frame, beside the number (frame 2 + 2 px in, mid-height, left of the ink)
            const f = px(r, sh.x + 4, top + 3);
            ok(hex(f) === want[cat][night ? 1 : 0] && f[3] === 255, cat + (night ? ' by night' : ' by day') + ': the plate\'s field is ' + want[cat][night ? 1 : 0] + ' (' + hex(f) + ')');
        });
    });
    const r = draw('М-04 Вигадана вулиця', false), sh = r.shields[0];
    ok(sh.w === 88 && r.shields.length === 1, '"M-04" is 88 px wide (ROAD-SHIELDS.md 2.2: 18 + the advances, even): ' + sh.w);
    const frame = px(r, sh.x + 1, top + 20), outside = px(r, sh.x - 1, top + 20), corner = px(r, sh.x, top);
    ok(hex(frame) === hex(LINE) && frame[3] === 255, 'its frame is the theme\'s "line" (' + hex(frame) + ')');
    ok(outside[3] === 0 && corner[3] < 64, 'nothing outside it, and the corner is rounded (corner alpha ' + corner[3] + ')');
    let rowsInk = [];
    for (let y = 0; y < Hh; y++) { let a = 0; for (let x = sh.x; x < sh.x + sh.w; x++) a = Math.max(a, px(r, x, y)[3]); if (a) rowsInk.push(y); }
    ok(rowsInk[0] === top && rowsInk[rowsInk.length - 1] === top + 39, 'the plate spans y ' + (NAV.y + rowsInk[0]) + '-' + (NAV.y + rowsInk[rowsInk.length - 1]) + ' (669-708: 40 px)');
    let numInk = 0, numTop = 99, numBot = -1;
    for (let y = top + 3; y < top + 37; y++) for (let x = sh.x + 3; x < sh.x + sh.w - 3; x++) { const p = px(r, x, y); if (p[0] > 200 && p[1] > 200) { numInk++; numTop = Math.min(numTop, y); numBot = Math.max(numBot, y); } }
    ok(numInk > 150, 'the number is drawn in "fg" on the plate (' + numInk + ' px)');
    ok(Math.abs((numTop - top) - (top + 39 - numBot)) <= 2, 'and centred in its height (' + (numTop - top) + ' px above, ' + (top + 39 - numBot) + ' below)');
    ok(r.nameX === sh.x + sh.w + 14, 'the name starts 14 px after the plate');
    let lo = W, hi = -1;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (px(r, x, y)[3] > 0) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    ok(Math.abs((lo + hi + 1) / 2 - W / 2) <= 3, 'the group is centred in the label\'s box (ink ' + lo + '-' + hi + ' of ' + W + ')');
    const long = draw('М-04 / E 50 Дуже довга вигадана назва вулиці, що ніяк не влазить у рядок', false);
    ok(long.shields.length === 2 && /\.\.\.$/.test(long.name), 'a long name is cut with "...", both plates stay whole');
    let right = -1;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (px(long, x, y)[3] > 0) right = Math.max(right, x);
    ok(right < W && long.shields[0].x >= 0, 'and nothing runs out of the box (ink to ' + right + ' of ' + W + ')');
    ok(draw('Вигадана вулиця', false) === null && draw('A7 Nowhere', false) === null, 'no road number at the start: null, the plain label is drawn as before');
    const src = fs.readFileSync(path.join(ROOT, 'shared', 'road_shields.js'), 'utf8');
    ok(!/\?\.|\?\?|\.flat\(|\.at\(/.test(src), 'road_shields.js keeps to Node 8.16 syntax (no ?., ??, flat, at)');
}

// ---- with the bench ----
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
        try { p = await probe(); if (fn(p)) return p; } catch (e) { /* (re)starting */ }
        await sleep(150);
    }
    return p;
}
/** The bench's layers now: the first "scene" event of GET /events. */
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
/** Every pixel of our image layers in the panel box [x0, y0, x1, y1): { n (ink px), red, blue, green (px of that hue) }. */
async function hues(box) {
    const out = { n: 0, red: 0, blue: 0, green: 0, cols: {} };
    for (const l of await sceneNow()) {
        if (l.kind !== 'image' || l.target !== 'panel' || l.iw !== l.w || l.ih !== l.h) continue;
        const x0 = Math.max(box[0], l.x), y0 = Math.max(box[1], l.y), x1 = Math.min(box[2], l.x + l.w), y1 = Math.min(box[3], l.y + l.h);
        if (x1 <= x0 || y1 <= y0) continue;
        const r = await fetch(BASE + '/px?key=' + encodeURIComponent(l.key) + '&x=' + (x0 - l.x) + '&y=' + (y0 - l.y) + '&w=' + (x1 - x0) + '&h=' + (y1 - y0));
        if (r.status !== 200) continue;
        const px = Buffer.from(await r.arrayBuffer());
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 250) continue;
            out.n++;
            const c = [px[i], px[i + 1], px[i + 2]], k = hex(c);
            out.cols[k] = (out.cols[k] || 0) + 1;
            if (c[0] > c[1] + 40 && c[0] > c[2] + 40) out.red++;
            else if (c[2] > c[0] + 40 && c[2] > c[1] + 20) out.blue++;
            else if (c[1] > c[0] + 40 && c[1] > c[2] + 20) out.green++;
        }
    }
    return out;
}
const top = (cols) => Object.keys(cols).sort((a, b) => cols[b] - cols[a])[0];

async function benchChecks() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'road-shields-'));
    const dataDir = path.join(tmp, 'data'), screenDir = path.join(tmp, 'screen');
    fs.mkdirSync(dataDir); fs.mkdirSync(screenDir);
    // the owner's setup: 6WB Comfort, its see-through file ("g20"), our whole bottom row
    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ hudLayout: 'wb_comfort', g20: true, byMode: false, bottomRow: 'all6WB' }));
    console.log('the road label the engine draws, on a bench of its own (' + BASE + ')');
    server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'f30_cluster'], {
        cwd: ROOT, env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, SCREEN_DIR: screenDir }),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (d) => { logText += d; }); server.stderr.on('data', (d) => { logText += d; });
    let p = await until((q) => q && q.ready && q.activeName === 'wb_dials', 90000);
    ok(p && p.activeName === 'wb_dials', 'the see-through 6WB Comfort is up');
    if (!p || p.activeName !== 'wb_dials') return;
    await fake({ scene: 'car-start' }); await fake({ scene: 'clock-plus2' }); await fake({ scene: 'car-rest' }); await fake({ dayNight: 'day' });
    p = await until((q) => q.signs && q.signs.own && q.signs.own.nav === true && (q.signs.widgets || []).indexOf('nav') >= 0, 20000);
    ok(p.signs.own.nav === true, 'the road label is ours (the whole row: ' + (p.signs.row || {}).why + ')');
    const PLATE = [NAV.x, 669, NAV.x + NAV.w, 709];
    const road = (parts) => fake({ road: { parts }, nav: { state: 'off' } });
    // the shape the owner's car sends (its log: "3 elements (1 text, 1 spacer, 1 icon)"): the number is the icon's own text
    await road([['icon', 'Н-09'], ['spacer', 'SMALL'], ['text', 'Вигадана вулиця']]);
    await sleep(1200);
    let h = await hues(PLATE);
    ok(h.red > 1500 && top(h.cols) === '#E30013', 'an Н road (icon element): a red plate in the label at y 669-709 (' + h.red + ' red px, most common ' + top(h.cols) + ')');
    // and as two texts with a spacer (the car's other shape), Cyrillic Р
    await road([['text', 'Р42'], ['spacer', 'SMALL'], ['text', 'Вигадана вулиця']]);
    await sleep(1200);
    h = await hues(PLATE);
    ok(h.blue > 1500 && h.red === 0, 'a Р road (text element): a blue plate, no red (' + h.blue + ' blue px)');
    await fake({ dayNight: 'night' });
    p = await until((q) => q.dayNight && q.dayNight.nightOn === true, 8000);
    await sleep(1500);
    h = await hues(PLATE);
    ok(p.dayNight.nightOn === true && (h.cols['#052A47'] || 0) > 1500 && !h.cols['#0B63A8'], 'by night the plate takes its night fill #052A47 (' + (h.cols['#052A47'] || 0) + ' px), not the day one');
    await fake({ dayNight: 'day' });
    await road([['text', 'Вигадана вулиця']]);
    await sleep(1500);
    h = await hues(PLATE);
    ok(h.n > 200 && h.red + h.blue + h.green === 0, 'a street with no number: the plain label, no plate (' + h.n + ' ink px, none coloured)');
    await road([['icon', 'A 9'], ['spacer', 'SMALL'], ['text', 'Nowhere']]);
    await sleep(1500);
    h = await hues(PLATE);
    ok(h.n > 200 && h.red + h.blue + h.green === 0, 'an unknown prefix ("A 9"): plain text, no plate');
    p = await probe();
    ok(p.signs && p.signs.own && p.signs.own.nav === true && JSON.stringify(p.signs.fail) === '{}', 'the row stayed ours throughout, nothing latched');
    ok(!/road_shields|drawing threw/.test(logText), 'no error from the plate painter in the log');
}

(async () => {
    staticChecks();
    if (process.argv.indexOf('--static') < 0) await benchChecks();
})().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    if (server) server.kill('SIGTERM');
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
});
