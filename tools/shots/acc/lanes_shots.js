'use strict';
/**
 * tools/shots/acc/lanes_shots.js - ACC View's lane model in pictures (round fixes-1121 AL), into bake/work/fixes-1121/acc-lanes/
 * (git-ignored):
 *
 *   node tools/shots/acc/lanes_shots.js [--lang en] [--out <dir>]
 *
 *   scenes/<nn>_<scene>_<t>s.png      the centre page (the software path: paint.js, acc_lane's maths in JS) of the 7 new demo
 *                                     scenes at chosen moments, day
 *   map/<nn>_<scene>_<t>s.png         the cluster's map core (x 334..754, y 44..416) composed from the same maths: the lane, the
 *                                     road users, the car ahead and ours, the text and pill sheets
 *   looks/A_*.png, looks/B_*.png      the two proposed looks of our guess: A (built) thinner, dashed, dimmer edges fading with
 *                                     distance; B (mockup only) no edges, the ground band alone with a dotted centre line
 *   transitions/<scene>.png           strips: the E half every 0.15 s across a change (measured -> partial -> predicted -> back)
 *   contact.png                       one sheet of all of it
 * Nothing here is shipped; it renders what the app draws.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const APP = path.join(ROOT, 'apps', 'acc_view');
const M = require(path.join(APP, 'model.js'));
const P = require(path.join(APP, 'paint.js'));
const R = require(path.join(APP, 'raster.js'));
const Wo = require(path.join(APP, 'world.js'));
const { Canvas } = require(path.join(ROOT, 'kit', 'runtime', 'canvas.js'));

const args = process.argv.slice(2);
const lang = args.indexOf('--lang') >= 0 ? args[args.indexOf('--lang') + 1] : 'uk';
const OUT = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : path.join(ROOT, 'bake', 'work', 'fixes-1121', 'acc-lanes' + (lang === 'uk' ? '' : '-' + lang));
['scenes', 'map', 'looks', 'transitions'].forEach((d) => fs.mkdirSync(path.join(OUT, d), { recursive: true }));

const png = (w, h, px, file) => { const c = new Canvas(w, h); c.d.set(px); fs.writeFileSync(file, c.png(6)); };
const entry = (name) => M.DEMO.filter((d) => d[2].scene === name)[0];
const stateAt = (name, ms) => M.withScene(entry(name)[2], ms);

/** A w x h crop of an RGBA buffer of width W. */
function crop(px, W, x0, y0, w, h) {
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) px.copy(out, y * w * 4, ((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4);
    return out;
}
/** Half size (2 x 2 box filter). */
function half(px, w, h) {
    const W = w >> 1, H = h >> 1, out = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
        const i = ((2 * y) * w + 2 * x) * 4 + c;
        out[(y * W + x) * 4 + c] = (px[i] + px[i + 4] + px[i + w * 4] + px[i + w * 4 + 4] + 2) >> 2;
    }
    return { px: out, w: W, h: H };
}
/** Straight-alpha src-over of a w x h image at (x, y). */
function blit(cv, px, w, h, x, y) {
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const i = (r * w + c) * 4, a = px[i + 3] / 255;
        if (a > 0) cv.put(((y + r) * cv.w + x + c) * 4, [px[i], px[i + 1], px[i + 2]], a);
    }
}

/** The map target's picture (1088 x 480) from acc_lane / acc_obj maths in JS, our sprites and the two sheets. */
function mapPicture(s, night) {
    const g = M.GEO.map, Pm = M.colours('map', night);
    const cv = new R.Canvas(1088, 480, [0, 0, 0]);
    const lead = M.leadPlace(s), z = lead ? lead.z : 0;
    P.lane(cv, g, s, z, Pm, s.warn ? 1 : 0);
    P.users(cv, g, s, Pm.fill, 0);
    if (lead) { const r = M.carRect(g, z, lead.y); cv.sprite(R.sprite(s.clo === 2 ? 'carFast' : 'car'), r[0], r[1], r[2], r[3], night ? 0.75 : 1, 1); }
    const er = M.egoRect(g, s);
    cv.sprite(R.sprite('ego'), er[0], er[1], er[2], er[3], night ? 0.75 : 1, 1);
    blit(cv, P.textSheet(s, night, lang), P.TEXT_W, P.TEXT_H, g.text[0], g.text[1]);
    blit(cv, P.pillSheet(s, night, lang), P.PILL_W, P.PILL_H, g.pill[0], g.pill[1]);
    return crop(cv.px, 1088, 334, 44, 420, 372);
}

/** Look B (a mockup, not built): the guessed edges left out; the ground band follows our path; a dotted centre line. */
function lookB(s, night) {
    const lanes = s.world.lanes;
    const sB = Object.assign({}, s, { world: Object.assign({}, s.world, { lanes: Object.assign({}, lanes, { lines: lanes.lines.filter((l) => l.g < 0.5) }) }) });
    const pg = P.centre(sB, { night, lang, info: { age: 0.5 }, demo: null });
    const cv = new R.Canvas(1600, 482, null);
    pg.px.copy(cv.px);
    const g = M.GEO.centre, e = lanes.ego, C = M.camOf(s), col = M.colours('centre', night).line.map((v) => Math.round(v * 255));
    const guess = lanes.lines.some((l) => l.g >= 0.5);
    if (guess) for (let x = 2; x < 60; x += 3) {
        const p = Wo.project(g, M.RANGE, x + M.EGO_X, e.y0 + x * (e.a + 0.5 * e.c * x) - C), r = Math.max(1.2, Math.min(3.5, 0.05 * p.k));
        const fade = 1 - Math.max(0, Math.min(1, (x - 20) / 40));
        for (let yy = Math.floor(p.py - r - 1); yy <= p.py + r + 1; yy++) for (let xx = Math.floor(p.px - r - 1); xx <= p.px + r + 1; xx++) {
            const d = Math.hypot(xx + 0.5 - p.px, yy + 0.5 - p.py), k = Math.max(0, Math.min(1, r + 0.5 - d)) * 0.7 * fade;
            if (k > 0 && xx >= g.lane[0] && xx < g.lane[0] + g.lane[2] && yy >= g.lane[1] && yy < g.lane[1] + g.lane[3]) cv.put((yy * 1600 + xx) * 4, col, k);
        }
    }
    return cv.px;
}

const SHOTS = [
    ['lost', [2.0, 4.0, 6.0, 9.5]], ['lostcurve', [2.0, 3.5, 6.0, 9.5]], ['oneedge', [1.5, 3.5, 7.0]], ['flicker', [3.0, 6.0]],
    ['junction', [2.0, 4.0, 6.5]], ['town', [2.0, 4.5, 7.0]], ['standing', [3.0]],
];
const made = { scenes: [], map: [], looks: [], transitions: [] };
SHOTS.forEach((sh) => {
    const e = entry(sh[0]);
    sh[1].forEach((t) => {
        const s = stateAt(sh[0], t * 1000), tag = e[0] + '_' + sh[0] + '_' + t.toFixed(1) + 's';
        const pg = P.centre(s, { night: false, lang, info: { age: 0.5 }, demo: e[0] });
        const f1 = path.join(OUT, 'scenes', tag + '.png');
        png(1600, 482, pg.px, f1); made.scenes.push({ f: f1, w: 1600, h: 482, px: pg.px, tag });
        const mp = mapPicture(s, false), f2 = path.join(OUT, 'map', tag + '.png');
        png(420, 372, mp, f2); made.map.push({ f: f2, w: 420, h: 372, px: mp, tag });
    });
});
// the two looks at the same moments (day and night)
[['lostcurve', 6.0], ['oneedge', 5.0], ['town', 4.5], ['standing', 3.0]].forEach((sh) => [false, true].forEach((night) => {
    const s = stateAt(sh[0], sh[1] * 1000), tag = sh[0] + '_' + sh[1].toFixed(1) + 's_' + (night ? 'night' : 'day');
    const a = crop(P.centre(s, { night, lang, info: { age: 0.5 } }).px, 1600, 0, 0, 800, 482), b = crop(lookB(s, night), 1600, 0, 0, 800, 482);
    png(800, 482, a, path.join(OUT, 'looks', 'A_' + tag + '.png')); png(800, 482, b, path.join(OUT, 'looks', 'B_' + tag + '.png'));
    made.looks.push({ w: 800, h: 482, px: a, tag: 'A ' + tag }, { w: 800, h: 482, px: b, tag: 'B ' + tag });
}));
// transitions: the E half every 0.15 s, half size, side by side
[['lostcurve', 2.3, 3.8], ['lostcurve', 7.9, 9.4], ['oneedge', 1.9, 3.1], ['lost', 2.9, 4.4], ['flicker', 0, 10]].forEach((tr, ti) => {
    const step = tr[0] === 'flicker' ? 1.0 : 0.15, n = Math.round((tr[2] - tr[1]) / step) + 1;
    const W = 400, H = 241, sheet = new R.Canvas(W * Math.min(n, 11), H + 30, [10, 10, 12]);
    for (let i = 0; i < Math.min(n, 11); i++) {
        const t = tr[1] + i * step, s = stateAt(tr[0], t * 1000);
        const hp = half(crop(P.centre(s, { night: false, lang, info: { age: 0.5 } }).px, 1600, 0, 0, 800, 482), 800, 482);
        for (let y = 0; y < H; y++) hp.px.copy(sheet.px, ((y + 30) * sheet.w + i * W) * 4, y * W * 4, (y + 1) * W * 4);
        sheet.text(t.toFixed(2) + ' s  ' + s.world.lanes.verdict, i * W + 8, 22, 'av_t16', 16, [220, 224, 230], 'left');
    }
    const f = path.join(OUT, 'transitions', tr[0] + '_' + tr[1].toFixed(1) + '-' + tr[2].toFixed(1) + '.png');
    png(sheet.w, sheet.h, sheet.px, f); made.transitions.push({ f, w: sheet.w, h: sheet.h });
    if (ti === 0) made.strip = { w: sheet.w, h: sheet.h, px: sheet.px };
});
// the contact sheet: the map cores of every shot, labelled
const cols = 6, cw = 420, ch = 372 + 26, rows = Math.ceil(made.map.length / cols);
const cs = new R.Canvas(cols * cw, rows * ch, [10, 10, 12]);
made.map.forEach((m, i) => {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    for (let r = 0; r < 372; r++) m.px.copy(cs.px, ((y + 26 + r) * cs.w + x) * 4, r * 420 * 4, (r + 1) * 420 * 4);
    cs.text(m.tag, x + 6, y + 19, 'av_t16', 16, [220, 224, 230], 'left');
});
png(cs.w, cs.h, cs.px, path.join(OUT, 'contact.png'));
console.log('acc lanes: ' + made.scenes.length + ' centre pages, ' + made.map.length + ' map cores, ' + made.looks.length + ' looks, ' + made.transitions.length + ' transition strips in ' + path.relative(ROOT, OUT));
