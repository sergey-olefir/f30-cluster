'use strict';
/**
 * tools/auto-beam/mockups.js - the park of mockups for Auto Beam (round "Auto Beam", package HD; tools/acc-view/mockups.py's
 * idea, written in JavaScript so every picture uses the app's own painter, words (shared/i18n) and atlases).
 *
 *   tools/auto-beam/mockups.sh                         the whole park (the GPU layers first, then the pictures)
 *   node tools/auto-beam/mockups.js gl-jobs            writes bake/work/beam/gl/jobs.json (direction A's map layers, the motion)
 *   node tools/auto-beam/mockups.js [--only A:map]     the pictures, the sheets, the context, index.html
 *
 * Five directions x three placements x 19 states (the brief's 18 and the fallback) x day / night x uk / en, plus context pictures (our map picture through Twin
 * Dial's W2 and f30's window; the head-up display's visible window), "inside a theme" pictures (a small sign in Twin Dial's and
 * f30's bottom row: mockups only), one contact sheet per direction and placement (day and night), and a motion sheet (the dip
 * and the return, nine steps each). Out: bake/work/beam/ (git-ignored).
 *
 *   A  from behind our car: the road, both cones on it, the lights ahead as points (the app's own page and map layers; the
 *      map's layers are the app's two effect shaders run on the Mac's GPU by beam_gl.py when bake/work/beam/gl has them)
 *   B  from above: a plan, the cones as shapes (distance on a log scale), the algorithm's zones faint, the lights as dots
 *   C  the front of the car: the two headlamps large, the light they throw on a wall ahead (the cut-off, the high spot)
 *   D  a compact pictogram: the sign, the advice, the reason, one line for the lamps
 *   E  (ours) from the side: our car, the low beam's wedge down to the road, the high beam's wedge on, the others' eye
 *      height: why a dip happens, in one picture (heights x10, distance on a log scale)
 *
 * Every picture keeps the app's rules: no red, blue only for the sign while high is advised, amber only for the
 * disagreement, nothing of another maker's. The night look's mean brightness is measured per picture (manifest.json).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'apps', 'auto_beam');
const V = require(path.join(APP, 'view'));
const P = require(path.join(APP, 'paint'));
const R = require(path.join(APP, 'raster'));
const Wd = require(path.join(APP, 'words'));
const C = require(path.join(APP, 'contract'));
const MapView = require(path.join(APP, 'mapview'));
const PNG = require(path.join(ROOT, 'tools', 'shots', 'beam', 'png'));

const OUT = path.join(ROOT, 'bake', 'work', 'beam');
const GLDIR = path.join(OUT, 'gl');
// bench renders of our own themes (the context backgrounds) live in the main checkout's bake/work (an agent worktree has none)
const MAIN = (() => { try { return path.resolve(ROOT, String(require('child_process').execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' })).trim(), '..'); } catch (e) { return ROOT; } })();
const SRC_WORK = fs.existsSync(path.join(ROOT, 'bake', 'work', 'car-issues')) ? path.join(ROOT, 'bake', 'work') : path.join(MAIN, 'bake', 'work');

const DIRS = [
    ['A', 'behind', 'From behind our car: the road, both cones on it, the lights ahead as points'],
    ['B', 'plan', 'From above: the cones as shapes, the algorithm\'s zones, the lights as dots (distance on a log scale)'],
    ['C', 'front', 'The front of the car: the two headlamps, the light they throw on a wall ahead'],
    ['D', 'pictogram', 'A compact pictogram: the sign, the advice, the reason, the lamps'],
    ['E', 'side', 'From the side (ours): the two wedges of light and the others\' eye height'],
];
const PLACES = [['centre', 1600, 520], ['map', 1088, 480], ['hud', 800, 480]];
const LANGS = ['uk', 'en'];
const LIGHTS = ['day', 'night'];

/* ------------------------------------------------------------------------------------------------ canvas helpers */
function blit(dst, src, sw, sh, x, y, alpha) {
    const al = alpha === undefined ? 1 : alpha, c = [0, 0, 0];
    for (let yy = 0; yy < sh; yy++) {
        const dy = y + yy;
        if (dy < 0 || dy >= dst.h) continue;
        for (let xx = 0; xx < sw; xx++) {
            const dx = x + xx;
            if (dx < 0 || dx >= dst.w) continue;
            const i = (yy * sw + xx) * 4, a = src[i + 3] / 255 * al;
            if (a <= 0) continue;
            c[0] = src[i]; c[1] = src[i + 1]; c[2] = src[i + 2];
            dst.put((dy * dst.w + dx) * 4, c, a);
        }
    }
}
/** Area-averaged resize of an opaque RGBA picture to width w2. */
function resize(px, w, h, w2) {
    const h2 = Math.round(h * w2 / w), out = Buffer.alloc(w2 * h2 * 4), k = w / w2;
    for (let y = 0; y < h2; y++) {
        const y0 = y * k, y1 = Math.min(h, (y + 1) * k);
        for (let x = 0; x < w2; x++) {
            const x0 = x * k, x1 = Math.min(w, (x + 1) * k);
            let r = 0, g = 0, b = 0, n = 0;
            for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
                const i = (yy * w + xx) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
            }
            const o = (y * w2 + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
        }
    }
    return { px: out, w: w2, h: h2 };
}
const W = (lang, k, x) => Wd.word(lang, k, x);
const dashed = (cv, x0, y0, x1, y1, w, col, on, off) => {
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.floor(L / (on + off)));
    for (let i = 0; i <= n; i++) { const a = i * (on + off) / L, b = Math.min(1, (i * (on + off) + on) / L); if (a >= 1) break; cv.seg(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b, w, col); }
};

/* ------------------------------------------------------------------------------------------------ the header (sign, advice, reason, lamps) */
/** size 'big' (the centre page's band) or 'small' (the map / the HUD): x, y the sign's centre. hud: brighter, thicker. */
function header(cv, x, y, size, v, P0, lang, o) {
    const opt = o || {};
    const big = size === 'big', s = big ? 64 : 44;
    const role = V.signRole(v);
    let sc = P0[role];
    if (opt.hud && role !== 'blue') sc = P0.ink;
    P.sign(cv, x, y, s, sc, v.adv === 'high' && v.go, role === 'blue' ? P0.blue : opt.hud ? P0.ink : P0.dim, v.yield ? 0.35 : 1);
    const tx = x + (big ? 92 : 60), maxW = opt.maxW || (big ? 560 : 300);
    const adv = W(lang, P.adviceKey(v)), af = big ? 'ab_b34' : 'ab_b22', as = R.fit(adv, af, big ? 34 : 22 * (opt.hud ? 1.15 : 1), maxW);
    cv.text(adv, tx, y - (big ? 26 : 20), af, as, role === 'blue' ? P0.blue : role === 'faint' && !opt.hud ? P0.dim : P0.ink, 'left', v.yield ? 0.35 : 1);
    const rs = v.yield ? W(lang, 'beam.yield') : P.reasonText(v, lang), rf = big ? 'ab_t26' : 'ab_t21';
    const rsz = R.fit(rs, rf, big ? 26 : 21, maxW);
    cv.text(P.truncate(rs, rf, rsz, maxW), tx, y + (big ? 16 : 10), rf, rsz, opt.hud || v.yield ? P0.ink : P0.dim, 'left');
    const lc = v.disagree ? P0.amber : opt.hud ? P0.ink : P0.dim;
    P.sign(cv, tx + 12, y + (big ? 50 : 34), big ? 13 : 10, lc, v.lamps === 'high' || v.lamps === 'flash', null);
    cv.text(P.lampsText(v, lang), tx + (big ? 40 : 30), y + (big ? 58 : 40), big ? 'ab_t21' : 'ab_t16', big ? 21 : 16, lc, 'left');
}

/* ------------------------------------------------------------------------------------------------ direction A */
/** The HUD's lines-and-light scene: the road's edges as lines, the cones as their light only (no road fill), our car's outline. */
function sceneHud(cv, box, v, e, P0) {
    const g = { scene: [0, 0, box[2], box[3]], pxm: box[2] / 14 };
    const curve = v.curve || 0, Wd0 = box[2], H = box[3], hy = V.HZ * H, col = [0, 0, 0];
    for (let y = 0; y < H; y++) {
        const t = (y + 0.5 - hy) / (H - hy);
        if (t <= 0) continue;
        const z = (1 / t - 1) / V.KF, xm = z * V.RANGE - V.EGO_X, k = g.pxm * t, fade = 1 - V.sstep(0.55, 1, z);
        const B = V.beamAt(xm, e);
        for (let x = 0; x < Wd0; x++) {
            const yb = (0.5 * Wd0 - x - 0.5) / k, yr = yb + 0.5 * curve * Math.max(0, xm) * Math.max(0, xm);
            const lw = Math.max(0.16, 2.2 / k), aa = 1 / k;
            const ln = (y0) => 1 - V.sstep(lw * 0.5 - aa, lw * 0.5 + aa, Math.abs(yr - y0));
            const dash = (xm + 3) / 12 - Math.floor((xm + 3) / 12) < 0.5 ? 1 : 0;
            const mk = Math.max(ln(-2.3), ln(5.8), ln(1.75) * dash) * fade * 0.8;
            const lk = Math.min(1, B.low * (1 - V.sstep(0.6 * B.lowW, B.lowW, Math.abs(yb))) + B.high * (1 - V.sstep(0.45 * B.highW, B.highW, Math.abs(yb)))) * fade * 0.8;
            if (mk > 0.01) { col[0] = P0.ink[0]; col[1] = P0.ink[1]; col[2] = P0.ink[2]; cv.put(((box[1] + y) * cv.w + box[0] + x) * 4, col, mk); }
            if (lk > 0.01) cv.put(((box[1] + y) * cv.w + box[0] + x) * 4, P0.beam, lk);
        }
    }
    (v.lights || []).forEach((l) => {
        const q = P.lightPlace(g, l, curve), c = P0[P.KIND_ROLE[l.kind] || 'other'];
        (q.hs > 0.8 ? [-q.hs, q.hs] : [0]).forEach((dx) => cv.rrect(box[0] + q.px + dx - q.r * 1.3, box[1] + q.py - q.r * 1.3, box[0] + q.px + dx + q.r * 1.3, box[1] + q.py + q.r * 1.3, q.r * 1.3, c, 0, 1));
        if (l.ringed) { const rr = Math.max(q.hs + q.r * 3, q.r * 5, 10); cv.rrect(box[0] + q.px - rr, box[1] + q.py - rr, box[0] + q.px + rr, box[1] + q.py + rr, rr, P0.ink, 2.4, 1); }
    });
    const cb = P.carBoxes(g);
    cv.rrect(box[0] + cb.body[0], box[1] + cb.body[1], box[0] + cb.body[0] + cb.body[2], box[1] + cb.body[1] + cb.body[3], 0.16 * cb.k, P0.ink, 2.2, 0.8);
    cv.rrect(box[0] + cb.cabin[0], box[1] + cb.cabin[1], box[0] + cb.cabin[0] + cb.cabin[2], box[1] + cb.cabin[1] + cb.cabin[3], 0.22 * cb.k, P0.ink, 2.2, 0.8);
}

const glCache = {};
function glLayer(name) {
    if (glCache[name] !== undefined) return glCache[name];
    const f = path.join(GLDIR, name + '.png');
    glCache[name] = fs.existsSync(f) ? PNG.read(f) : null;
    return glCache[name];
}

function dirA(cv, place, v, night, lang, e, tag) {
    const P0 = V.colours(place === 'centre' ? 'centre' : 'map', night);
    if (place === 'centre') {
        const r = P.centre(v, { night, lang, e });
        blit(cv, r.px, P.PAGE_W, P.PAGE_H, 0, 38);
        return 'app';
    }
    if (place === 'map') {
        const g = V.GEO.map;
        const road = glLayer(tag + '_road'), lights = glLayer(tag + '_lights');
        if (road && lights) { blit(cv, road.px, road.w, road.h, g.scene[0], g.scene[1]); blit(cv, lights.px, lights.w, lights.h, g.scene[0], g.scene[1]); }
        else P.scene(cv, g, g.scene[0], g.scene[1], v, e, night);
        if (v.yield) return road ? 'gpu' : 'software';         // the map hides every layer while the car's message shows
        blit(cv, P.textSheet(v, night, lang), P.TEXT_W, P.TEXT_H, g.text[0], g.text[1]);
        return road && lights ? 'gpu' : 'software';
    }
    const hw = V.GEO.hud.window, Ph = V.colours('map', night);
    header(cv, hw[0] + 50, hw[1] + 50, 'small', v, Ph, lang, { hud: true, maxW: 360 });
    sceneHud(cv, [hw[0] + 40, hw[1] + 112, hw[2] - 80, hw[3] - 118], v, e, Ph);
    void P0;
    return 'software';
}

/* ------------------------------------------------------------------------------------------------ direction B: the plan */
function plan(cv, box, v, e, P0, lang, o) {
    const opt = o || {};
    const [bx, by, bw, bh] = box, cx = bx + bw * 0.42, foot = by + bh - 44, top = by + 14;
    const sx = opt.sx || Math.min(16, bw / 22);
    const D = (x) => Math.log(1 + Math.max(0, x) / 25) / Math.log(1 + 450 / 25);
    const Y = (x) => foot - D(x) * (foot - top);
    const X = (ym) => cx - ym * sx;
    const line = opt.hud ? P0.ink : P0.edge;
    // the road (lines only on the HUD)
    if (!opt.hud) cv.rrect(X(5.8) - 4, top, X(-2.3) + 4, foot + 40, 0, P0.road, 0, 0.9);
    cv.seg(X(5.8), top, X(5.8), foot + 40, 1.6, line); cv.seg(X(-2.3), top, X(-2.3), foot + 40, 1.6, line);
    for (let x = 0; x < 450; x += 12) { const y0 = Y(x), y1 = Y(x + 6); if (y0 - y1 > 1) cv.seg(X(1.75), y0, X(1.75), y1, 1.4, line); }
    // the cones, row by row
    const col = [0, 0, 0];
    for (let y = Math.floor(top); y < foot; y++) {
        const d = (foot - y) / (foot - top), xm = 25 * (Math.pow(1 + 450 / 25, d) - 1);
        const B = V.beamAt(xm, e);
        for (let x = Math.floor(X(7)); x < X(-7); x++) {
            const yb = (cx - x - 0.5) / sx;
            const lk = Math.min(1, B.low * (1 - V.sstep(0.6 * B.lowW, B.lowW, Math.abs(yb))) + B.high * (1 - V.sstep(0.45 * B.highW, B.highW, Math.abs(yb))));
            if (lk > 0.01) { col[0] = P0.beam[0]; col[1] = P0.beam[1]; col[2] = P0.beam[2]; cv.put((y * cv.w + x) * 4, col, lk * (opt.hud ? 0.8 : 1)); }
        }
    }
    // the algorithm's zones, faint: the oncoming lane to 400 m, our lane to 160 m (the stand-in's assumed defaults)
    const zc = V.mix(P0.ink, 0.35, P0.bg);
    dashed(cv, X(5.6), Y(400), X(1.95), Y(400), 1.4, zc, 5, 4); dashed(cv, X(5.6), Y(400), X(5.6), foot, 1.2, zc, 5, 4); dashed(cv, X(1.95), Y(400), X(1.95), foot, 1.2, zc, 5, 4);
    dashed(cv, X(1.6), Y(160), X(-2.1), Y(160), 1.4, zc, 5, 4); dashed(cv, X(1.6), Y(160), X(1.6), foot, 1.2, zc, 5, 4); dashed(cv, X(-2.1), Y(160), X(-2.1), foot, 1.2, zc, 5, 4);
    // the distance scale (assumed metres)
    [50, 100, 200, 400].forEach((m) => {
        cv.seg(X(-2.9), Y(m), X(-3.6), Y(m), 1.2, zc);
        cv.text(W(lang, 'beam.metres', { n: m }), X(-3.9), Y(m) + 5, 'ab_t16', 15, opt.hud ? P0.ink : P0.dim, 'left');
    });
    // the lights
    (v.lights || []).forEach((l) => {
        if (l.x > 450) return;
        const c = P0[P.KIND_ROLE[l.kind] || 'other'], hs = (V.PAIR[l.kind] || 0) / 2;
        (hs ? [-hs, hs] : [0]).forEach((d) => { cv.rrect(X(l.y + d) - 4, Y(l.x) - 4, X(l.y + d) + 4, Y(l.x) + 4, 4, c, 0, 1); cv.rrect(X(l.y + d) - 10, Y(l.x) - 10, X(l.y + d) + 10, Y(l.x) + 10, 10, c, 0, 0.15); });
        if (l.ringed) cv.rrect(X(l.y) - 18, Y(l.x) - 18, X(l.y) + 18, Y(l.x) + 18, 18, P0.ink, 2, 0.9);
    });
    // our car, in plan
    const cw = 1.8 * sx, cl = 4.6 * sx * 0.8;
    cv.rrect(cx - cw / 2, foot + 2, cx + cw / 2, foot + 2 + cl, 6, opt.hud ? P0.ink : P0.car, opt.hud ? 2 : 0, 1);
    if (!opt.hud) cv.rrect(cx - cw / 2 + 4, foot + 8, cx + cw / 2 - 4, foot + 18, 3, P0.carHi, 0, 0.8);
}
function dirB(cv, place, v, night, lang, e) {
    if (place === 'centre') {
        const P0 = V.colours('centre', night);
        const bd = P.band(v, { night, lang });
        blit(cv, bd.px, bd.w, bd.h, 0, 38);
        plan(cv, [60, 38 + 176, 680, 482 - 176], v, e, P0, lang, { sx: 16 });
        tableWithValues(cv, v, night, lang);
        return 'software';
    }
    if (place === 'map') {
        const P0 = V.colours('map', night), g = V.GEO.map;
        if (v.yield) return 'software';
        blit(cv, P.textSheet(v, night, lang), P.TEXT_W, P.TEXT_H, g.text[0], g.text[1]);
        plan(cv, [334, 156, 420, 260], v, e, P0, lang, { sx: 11 });
        return 'software';
    }
    const hw = V.GEO.hud.window, Ph = V.colours('map', night);
    header(cv, hw[0] + 50, hw[1] + 50, 'small', v, Ph, lang, { hud: true, maxW: 360 });
    plan(cv, [hw[0] + 60, hw[1] + 100, hw[2] - 120, hw[3] - 100], v, e, Ph, lang, { sx: 9, hud: true });
    return 'software';
}

/* ------------------------------------------------------------------------------------------------ direction C: the front */
/** The light on a wall ahead (the low beam's flat cut-off with its step, the high beam's spot above it) and the two lamps. */
function front(cv, box, v, e, P0, o) {
    const opt = o || {};
    const [bx, by, bw, bh] = box, cx = bx + bw / 2;
    const wallH = bh * 0.56, horizon = by + wallH * 0.48;
    const col = [0, 0, 0];
    // the wall's light: low = below the cut-off (a step up on our side), high = a spot centred above it
    for (let y = Math.floor(by); y < by + wallH; y++) {
        for (let x = Math.floor(bx); x < bx + bw; x++) {
            const u = (x + 0.5 - cx) / (bw / 2), w = (y + 0.5 - horizon) / (wallH / 2);
            const cut = u > 0 ? 0.06 - Math.min(0.12, u * 0.6) * 0 - (u > 0.05 ? 0.10 : 0) : 0.06;
            const low = (1 - V.sstep(cut - 0.03, cut + 0.03, -w)) * Math.exp(-u * u / 0.5) * Math.exp(-Math.max(0, w) * 1.2) * 0.75;
            const hd = (u * u) / 0.08 + (w + 0.05) * (w + 0.05) / 0.10;
            const high = Math.sqrt(e) * Math.exp(-hd * 1.4) * 0.85;
            const k = Math.min(1, low + high) * (opt.hud ? 0.85 : 1);
            if (k > 0.01) cv.put((y * cv.w + x) * 4, P0.beam, k);
        }
    }
    const lineC = opt.hud ? P0.ink : P0.edge;
    dashed(cv, bx + 10, horizon, bx + bw - 10, horizon, 1.2, V.mix(lineC, 0.6, P0.bg), 6, 6);
    // the car's front: a generic wide shape and two lamps (low module below, high module above)
    const fy = by + wallH + 18, fw = Math.min(bw * 0.86, 640), fh = bh - wallH - 24;
    if (!opt.hud) cv.rrect(cx - fw / 2, fy + fh * 0.08, cx + fw / 2, fy + fh, fh * 0.32, P0.car, 0, 1);
    else cv.rrect(cx - fw / 2, fy + fh * 0.08, cx + fw / 2, fy + fh, fh * 0.32, P0.ink, 2, 0.7);
    [-1, 1].forEach((sd) => {
        const lx = cx + sd * fw * 0.31, lw = fw * 0.24, lh = fh * 0.46, ly = fy + fh * 0.30;
        cv.rrect(lx - lw / 2, ly - lh / 2, lx + lw / 2, ly + lh / 2, lh * 0.4, opt.hud ? P0.ink : P0.carHi, 2, 1);
        const lowLit = v.state !== 'UNAVAILABLE' || true;
        const mod = (yy, on, ww) => {
            cv.rrect(lx - ww / 2, yy - lh * 0.11, lx + ww / 2, yy + lh * 0.11, lh * 0.11, on ? P0.beam : V.mix(P0.carHi, 0.4, P0.car), 0, on ? 1 : 0.8);
            if (on) cv.rrect(lx - ww / 2 - 8, yy - lh * 0.11 - 8, lx + ww / 2 + 8, yy + lh * 0.11 + 8, lh * 0.2, P0.beam, 0, 0.18);
        };
        mod(ly - lh * 0.17, e > 0.5, lw * 0.62);
        mod(ly + lh * 0.18, lowLit, lw * 0.72);
    });
}
function dirC(cv, place, v, night, lang, e) {
    if (place === 'centre') {
        const P0 = V.colours('centre', night);
        const bd = P.band(v, { night, lang });
        blit(cv, bd.px, bd.w, bd.h, 0, 38);
        front(cv, [70, 38 + 186, 660, 482 - 196], v, e, P0);
        tableWithValues(cv, v, night, lang);
        return 'software';
    }
    if (place === 'map') {
        const P0 = V.colours('map', night), g = V.GEO.map;
        if (v.yield) return 'software';
        blit(cv, P.textSheet(v, night, lang), P.TEXT_W, P.TEXT_H, g.text[0], g.text[1]);
        front(cv, [354, 164, 380, 240], v, e, P0);
        return 'software';
    }
    const hw = V.GEO.hud.window, Ph = V.colours('map', night);
    header(cv, hw[0] + 50, hw[1] + 50, 'small', v, Ph, lang, { hud: true, maxW: 360 });
    front(cv, [hw[0] + 70, hw[1] + 104, hw[2] - 140, hw[3] - 106], v, e, Ph, { hud: true });
    return 'software';
}

/* ------------------------------------------------------------------------------------------------ direction D: the pictogram */
function picto(cv, cx, cy, s, v, P0, lang, o) {
    const opt = o || {};
    const role = V.signRole(v);
    const sc = opt.hud && role !== 'blue' ? P0.ink : P0[role];
    const al = v.yield ? 0.35 : 1;
    P.sign(cv, cx, cy, s, sc, v.adv === 'high' && v.go, role === 'blue' ? P0.blue : opt.hud ? P0.ink : P0.dim, al);
    const k = s / 64;
    const adv = W(lang, P.adviceKey(v)), af = 'ab_b34', as = R.fit(adv, af, 34 * k * 1.0, s * 6);
    cv.text(adv, cx + 6, cy + s * 0.95 + as * 0.6, af, as, role === 'blue' ? P0.blue : P0.ink, 'center', al);
    const rs = v.yield ? W(lang, 'beam.yield') : P.reasonText(v, lang), rsz = R.fit(rs, 'ab_t26', 26 * k, s * 6.5);
    cv.text(rs, cx + 6, cy + s * 0.95 + as * 0.6 + rsz * 1.35, 'ab_t26', rsz, opt.hud || v.yield ? P0.ink : P0.dim, 'center');
    const lt = P.lampsText(v, lang), lc = v.disagree ? P0.amber : opt.hud ? P0.ink : P0.dim, ls = 21 * k;
    const ly = cy + s * 0.95 + as * 0.6 + rsz * 1.35 + ls * 1.6, lw = R.textWidth(lt, 'ab_t21', ls);
    P.sign(cv, cx + 6 - lw / 2 - 18 * k, ly - ls * 0.35, 11 * k, lc, v.lamps === 'high' || v.lamps === 'flash', null);
    cv.text(lt, cx + 6 + 8 * k, ly, 'ab_t21', ls, lc, 'center');
}
function dirD(cv, place, v, night, lang) {
    if (place === 'centre') {
        const P0 = V.colours('centre', night);
        picto(cv, 400, 38 + 150, 92, v, P0, lang);
        tableWithValues(cv, v, night, lang);
        return 'software';
    }
    if (place === 'map') {
        if (v.yield) return 'software';
        picto(cv, 544, 140, 70, v, V.colours('map', night), lang);
        return 'software';
    }
    const hw = V.GEO.hud.window;
    picto(cv, hw[0] + hw[2] / 2, hw[1] + 88, 64, v, V.colours('map', night), lang, { hud: true });
    return 'software';
}

/* ------------------------------------------------------------------------------------------------ direction E: the side */
function side(cv, box, v, e, P0, lang, o) {
    const opt = o || {};
    const [bx, by, bw, bh] = box;
    const x0 = bx + Math.min(150, bw * 0.24), x1 = bx + bw - 16, ground = by + bh - 40, hk = (bh - 60) / 4.4;   // px per metre of height (heights exaggerated against distance)
    const D = (x) => Math.log(1 + Math.max(0, x) / 20) / Math.log(1 + 450 / 20);
    const X = (x) => x0 + D(x) * (x1 - x0);
    const Yh = (h) => ground - h * hk;
    const lamp = 0.65;
    // the wedges: low from the lamp down to the road at 60 m (its top a flat cut-off); high from the lamp, rising slightly, to 60 + 160 e m
    const col = [0, 0, 0];
    for (let x = Math.floor(x0); x < x1; x++) {
        const d = (x - x0) / (x1 - x0), xm = 20 * (Math.pow(1 + 450 / 20, d) - 1);
        const B = V.beamAt(xm, e);
        const lowTop = lamp * (1 - Math.min(1, xm / 60)), reach = 60 + 160 * e;
        const highTop = lamp + 0.0045 * xm, highBot = 0;
        for (let y = Math.floor(Yh(3.1)); y < ground; y++) {
            const h = (ground - y) / hk;
            let k = 0;
            if (xm < 60 && h <= lowTop) k = Math.max(k, B.low * 1.1);
            if (e > 0.01 && xm < reach && h <= highTop && h >= highBot * 0.0) k = Math.max(k, B.high * 1.1 * (1 - V.sstep(highTop - 0.15, highTop, h)));
            if (k > 0.01) { col[0] = P0.beam[0]; col[1] = P0.beam[1]; col[2] = P0.beam[2]; cv.put((y * cv.w + x) * 4, col, Math.min(1, k) * (opt.hud ? 0.8 : 1)); }
        }
    }
    // the ground, the others' eye height (1.1 m)
    cv.seg(bx + 10, ground, x1, ground, 1.6, opt.hud ? P0.ink : P0.edge);
    dashed(cv, x0, Yh(1.1), x1, Yh(1.1), 1.2, V.mix(opt.hud ? P0.ink : P0.edge, 0.7, P0.bg), 6, 5);
    [50, 100, 200, 400].forEach((m) => { cv.seg(X(m), ground, X(m), ground + 6, 1.2, P0.dim); cv.text(W(lang, 'beam.metres', { n: m }), X(m), ground + 24, 'ab_t16', 15, opt.hud ? P0.ink : P0.dim, 'center'); });
    // our car from the side (generic): body, glasshouse, two wheels; the lamp at its nose
    const cxr = bx + 14, cw = x0 - cxr + 4, ch = 1.4 * hk;
    const carC = opt.hud ? P0.ink : P0.car;
    cv.rrect(cxr, ground - ch * 0.62, cxr + cw, ground - ch * 0.12, ch * 0.18, carC, opt.hud ? 2 : 0, 1);
    cv.rrect(cxr + cw * 0.18, ground - ch, cxr + cw * 0.72, ground - ch * 0.55, ch * 0.18, carC, opt.hud ? 2 : 0, 1);
    [0.22, 0.8].forEach((f) => cv.rrect(cxr + cw * f - ch * 0.17, ground - ch * 0.34, cxr + cw * f + ch * 0.17, ground, ch * 0.17, opt.hud ? P0.ink : V.mix(P0.bg, 0.5, P0.car), opt.hud ? 2 : 0, 1));
    cv.rrect(x0 - 8, Yh(lamp) - 4, x0 + 2, Yh(lamp) + 4, 3, P0.beam, 0, 1);
    // the others: oncoming / ahead as small side shapes with their eye (oncoming) or lamps (ahead); street lights as poles
    (v.lights || []).forEach((l) => {
        if (l.x > 450) return;
        const x = X(l.x), c = P0[P.KIND_ROLE[l.kind] || 'other'];
        if (l.kind === 'street') {
            cv.seg(x, ground, x, Yh(2.9), 1.4, V.mix(P0.dim, 0.6, P0.bg));       // a street light (its pole cut short)
            cv.rrect(x - 4, Yh(2.9) - 4, x + 4, Yh(2.9) + 4, 4, c, 0, 1);
            return;
        }
        const hh = 1.4 * hk, w2 = Math.max(20, hh * 0.85);
        cv.rrect(x - w2 / 2, ground - hh * 0.62, x + w2 / 2, ground - hh * 0.1, 4, opt.hud ? P0.ink : V.mix(P0.car, 0.8, P0.bg), opt.hud ? 1.6 : 0, 1);
        cv.rrect(x - w2 * 0.32, ground - hh, x + w2 * 0.32, ground - hh * 0.55, 4, opt.hud ? P0.ink : V.mix(P0.car, 0.8, P0.bg), opt.hud ? 1.6 : 0, 1);
        const ly = l.kind === 'head' ? Yh(0.7) : Yh(0.8), lx = l.kind === 'head' ? x - w2 / 2 : x + w2 / 2;
        cv.rrect(lx - 4, ly - 3, lx + 4, ly + 3, 3, c, 0, 1);
        cv.rrect(x - 3, Yh(1.1) - 3, x + 3, Yh(1.1) + 3, 3, opt.hud ? P0.ink : P0.dim, 0, 1);       // the driver's eye
        if (l.ringed) { const rr = Math.max(26, hh * 0.8); cv.rrect(x - rr, Yh(0.75) - rr, x + rr, Yh(0.75) + rr, rr, P0.ink, 2, 0.9); }
    });
}
function dirE(cv, place, v, night, lang, e) {
    if (place === 'centre') {
        const P0 = V.colours('centre', night);
        const bd = P.band(v, { night, lang });
        blit(cv, bd.px, bd.w, bd.h, 0, 38);
        side(cv, [30, 38 + 186, 740, 482 - 186], v, e, P0, lang);
        tableWithValues(cv, v, night, lang);
        return 'software';
    }
    if (place === 'map') {
        if (v.yield) return 'software';
        blit(cv, P.textSheet(v, night, lang), P.TEXT_W, P.TEXT_H, V.GEO.map.text[0], V.GEO.map.text[1]);
        side(cv, [334, 180, 420, 236], v, e, V.colours('map', night), lang);
        return 'software';
    }
    const hw = V.GEO.hud.window, Ph = V.colours('map', night);
    header(cv, hw[0] + 50, hw[1] + 50, 'small', v, Ph, lang, { hud: true, maxW: 360 });
    side(cv, [hw[0] + 10, hw[1] + 110, hw[2] - 20, hw[3] - 112], v, e, Ph, lang, { hud: true });
    return 'software';
}

/** The app's table (the right half of the centre page) with its fast values, as the app draws them. */
function tableWithValues(cv, v, night, lang) {
    const tb = P.table(v, { night, lang });
    blit(cv, tb.px, tb.w, tb.h, 800, 38);
    const Pc = V.colours('centre', night);
    P.dyn(v, { lang }).forEach((d) => cv.text(d.str, d.x, 38 + d.y, 'ab_t26', d.size, Pc[d.role], 'right'));
}

const DRAW = { A: dirA, B: dirB, C: dirC, D: dirD, E: dirE };

/** One picture: { px, w, h, how }. */
function picture(d, place, sid, v, night, lang, e) {
    const pl = PLACES.filter((p) => p[0] === place)[0];
    const bg = place === 'centre' ? V.colours('centre', night).bg : [0, 0, 0];
    const cv = new R.Canvas(pl[1], pl[2], bg);
    const how = DRAW[d](cv, place, v, night, lang, e === undefined ? V.extentOf(v) : e, 'A_' + sid + '_' + (night ? 'night' : 'day'));
    return { px: cv.px, w: pl[1], h: pl[2], how };
}

/* ------------------------------------------------------------------------------------------------ the GPU jobs */
function glJobs() {
    fs.mkdirSync(GLDIR, { recursive: true });
    const g = V.GEO.map, jobs = [];
    const add = (tag, v, e, night) => {
        jobs.push({ out: path.join(GLDIR, tag + '_road.png'), shader: 'ab_road', w: g.scene[2], h: g.scene[3], u: MapView.roadUniforms(v, e, night) });
        jobs.push({ out: path.join(GLDIR, tag + '_lights.png'), shader: 'ab_lights', w: g.scene[2], h: g.scene[3], u: MapView.lightUniforms(v, night) });
    };
    V.DEMO.forEach((d) => LIGHTS.forEach((l) => add('A_' + d[0] + '_' + l, d[2], V.extentOf(d[2]), l === 'night')));
    motionFrames().forEach((m) => add(m.tag, m.v, m.e, true));
    fs.writeFileSync(path.join(GLDIR, 'jobs.json'), JSON.stringify(jobs));
    console.log(jobs.length + ' GPU layers asked for: ' + path.join(GLDIR, 'jobs.json'));
}

/** The motion: the dip (an oncoming car enters the zone: the high beam folds back) and the return (it is gone: the high
 *  beam grows out), nine steps each over FOLD 330 ms. */
function motionFrames() {
    const out = [], base = V.DEMO[4][2];
    for (let i = 0; i < 9; i++) {
        const k = i / 8;
        const dip = Object.assign({}, V.DEMO[6][2], { lights: [{ id: 1, kind: 'head', x: 260 - 90 * k, y: 3.5, ringed: i > 0 }] });
        if (i === 0) Object.assign(dip, { state: 'HIGH', reason: 'clear', trigger: false, adv: 'high', go: true, lamps: 'high', disagree: false });
        out.push({ tag: 'M_dip_' + i, v: dip, e: 1 - k, ms: Math.round(k * 330) });
        const ret = Object.assign({}, base, { lights: [] });
        if (i === 0) Object.assign(ret, { state: 'DIPPED', reason: 'oncoming', trigger: false, adv: 'low', go: true, countdown: 1, lamps: 'low' });
        out.push({ tag: 'M_ret_' + i, v: ret, e: k, ms: Math.round(k * 330) });
    }
    return out;
}

/* ------------------------------------------------------------------------------------------------ sheets, context, index */
function sheet(cells, cols, title, cellW, lang) {
    if (!cells.length) return null;
    const th = cells.map((c) => resize(c.px, c.w, c.h, cellW));
    const ch = th[0].h, pad = 10, cap = 24, head = 44, rows = Math.ceil(cells.length / cols);
    const cv = new R.Canvas(cols * (cellW + pad) + pad, head + rows * (ch + cap + pad) + pad, [26, 27, 31]);
    cv.text(title, pad, 30, 'ab_b22', 22, [230, 230, 230], 'left');
    th.forEach((t, i) => {
        const r = Math.floor(i / cols), k = i % cols, x = pad + k * (cellW + pad), y = head + r * (ch + cap + pad);
        blit(cv, t.px, t.w, t.h, x, y);
        cv.text(cells[i].cap, x + 2, y + ch + 18, 'ab_t16', 15, [200, 200, 200], 'left');
    });
    void lang;
    return cv;
}

/** Our map-target picture on the panel at the slot's assumed place (416, 140), seen through a theme's window. */
function inContext(pic, theme, night) {
    let frame, mask;
    if (theme === 'twin') {
        const f = path.join(SRC_WORK, 'car-issues', 'pub', 'MW', 'mw_' + (night ? 'night' : 'day') + '_noroad_slot.png');
        if (!fs.existsSync(f)) return null;
        const src = PNG.read(f);
        frame = new R.Canvas(1920, 720, null);
        for (let y = 0; y < 720; y++) src.px.copy(frame.px, y * 1920 * 4, ((y + 40) * src.w) * 4, ((y + 40) * src.w + 1920) * 4);
        mask = (x, y) => (x >= 700 && x < 1220 && y >= 173 && y < 600 ? 1 : 0);
    } else {
        const f = path.join(SRC_WORK, 'shots', '20261118-2239', 'C-scenarios', 'comfort', '02-motorway-130-nopass.png');
        if (!fs.existsSync(f)) return null;
        const src = PNG.read(f);
        frame = new R.Canvas(1920, 720, null);
        src.px.copy(frame.px);
        if (night) for (let i = 0; i < frame.px.length; i += 4) { frame.px[i] *= 0.72; frame.px[i + 1] *= 0.72; frame.px[i + 2] *= 0.72; }
        mask = (x, y) => Math.max(0, Math.min(1, (y - 180) / 120, (x - 750) / 80, (1170 - x) / 80, (564 - y) / 80));
    }
    for (let y = 140; y < 620; y++) for (let x = 416; x < 1504; x++) {
        const m = mask(x, y);
        if (m <= 0) continue;
        const i = ((y - 140) * 1088 + (x - 416)) * 4, j = (y * 1920 + x) * 4;
        for (let c = 0; c < 3; c++) frame.px[j + c] = Math.round(frame.px[j + c] * (1 - m) + pic.px[i + c] * m);
    }
    return frame;
}

/** Inside a theme (mockups only: a change to those apps): a small sign and the reason in the theme's bottom row. */
function inTheme(v, theme, night, lang) {
    const ctx = inContext({ px: Buffer.alloc(1088 * 480 * 4) }, theme, night);
    if (!ctx) return null;
    // the map window back to the theme's own picture (no map picture of ours here)
    const P0 = V.colours('map', night);
    const x = theme === 'twin' ? 905 : 960, y = theme === 'twin' ? 665 : 560;
    const role = V.signRole(v);
    if (theme === 'f30') ctx.rrect(x - 140, y - 30, x + 140, y + 30, 30, [0, 0, 0], 0, 0.85);
    P.sign(ctx, x - 100, y, 22, P0[role], v.adv === 'high' && v.go, role === 'blue' ? P0.blue : P0.dim);
    ctx.text(W(lang, C.REASON_KEY(v.reason)), x - 66, y + 7, 'ab_t21', 21, v.disagree ? P0.amber : P0.dim, 'left');
    return ctx;
}

function index(man) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let h = '<!doctype html><meta charset="utf-8"><title>Auto Beam: the park</title><style>body{background:#16171a;color:#ddd;font:14px system-ui;margin:16px}' +
        'img{max-width:100%;background:#000}figure{margin:0 0 14px}figcaption{color:#aaa}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}' +
        'select{margin-right:8px}</style><h1>Auto Beam: the park of mockups</h1><p>' + man.images.length + ' pictures. Directions: ' +
        DIRS.map((d) => '<b>' + d[0] + '</b> ' + esc(d[2])).join('; ') + '.</p>';
    h += '<h2>Sheets</h2><div class="grid">' + man.sheets.map((s) => '<figure><a href="' + s.file + '"><img loading="lazy" src="' + s.file + '"></a><figcaption>' + esc(s.title) + '</figcaption></figure>').join('') + '</div>';
    h += '<h2>The park</h2><p>' + ['d', 'p', 's', 'l', 'g'].map((k) => '<select id="' + k + '"></select>').join('') + '</p><div id="park" class="grid"></div>';
    h += '<script>const M=' + JSON.stringify(man.images.map((m) => [m.file, m.d, m.place, m.state, m.light, m.lang, m.name])) + ';' +
        'const F={d:["*","A","B","C","D","E"],p:["*","centre","map","hud"],s:["*"].concat(' + JSON.stringify(V.DEMO.map((d) => d[0] + ' ' + d[1])) + '),l:["*","day","night"],g:["*","uk","en"]};' +
        'for(const k in F){const s=document.getElementById(k);F[k].forEach(v=>{const o=document.createElement("option");o.textContent=v;s.appendChild(o)});s.onchange=draw;}' +
        'document.getElementById("d").value="A";document.getElementById("l").value="night";document.getElementById("g").value="uk";' +
        'function draw(){const f=k=>document.getElementById(k).value;const out=M.filter(m=>(f("d")=="*"||m[1]==f("d"))&&(f("p")=="*"||m[2]==f("p"))&&(f("s")=="*"||f("s").startsWith(m[3]))&&(f("l")=="*"||m[4]==f("l"))&&(f("g")=="*"||m[5]==f("g"))).slice(0,240);' +
        'document.getElementById("park").innerHTML=out.map(m=>"<figure><a href=\\""+m[0]+"\\"><img loading=lazy src=\\""+m[0]+"\\"></a><figcaption>"+m.slice(1).join(" · ")+"</figcaption></figure>").join("");}draw();</script>';
    fs.writeFileSync(path.join(OUT, 'index.html'), h);
}

/* ------------------------------------------------------------------------------------------------ main */
function main() {
    const args = process.argv.slice(2);
    if (args[0] === 'gl-jobs') return glJobs();
    const only = args.indexOf('--only') >= 0 ? args[args.indexOf('--only') + 1].split(':') : null;
    ['park', 'sheets', 'context', 'theme', 'motion'].forEach((d) => fs.mkdirSync(path.join(OUT, d), { recursive: true }));
    const man = { images: [], sheets: [], context: [], luma: {} };
    const keep = {};
    const t0 = Date.now();
    DIRS.forEach((dd) => {
        const d = dd[0];
        if (only && only[0] !== d) return;
        PLACES.forEach((pl) => {
            const place = pl[0];
            if (only && only[1] && only[1] !== place) return;
            LIGHTS.forEach((light) => LANGS.forEach((lang) => V.DEMO.forEach((st) => {
                const night = light === 'night';
                const p = picture(d, place, st[0], st[2], night, lang);
                const file = 'park/' + d + '_' + place + '_' + st[0] + '_' + st[1] + '_' + light + '_' + lang + '.png';
                PNG.write(path.join(OUT, file), p.w, p.h, p.px);
                const luma = Math.round(R.meanLuma(p.px) * 10) / 10;
                man.images.push({ file, d, place, state: st[0], name: st[1], light, lang, how: p.how, luma });
                if (lang === 'uk') keep[d + place + st[0] + light] = Object.assign({ cap: st[0] + ' ' + st[1] }, p);
            })));
        });
        console.log(d + ' done (' + Math.round((Date.now() - t0) / 1000) + ' s)');
    });
    // the night look's mean brightness per direction and placement (0..255, uk)
    man.images.filter((m) => m.lang === 'uk').forEach((m) => { const k = m.d + ':' + m.place + ':' + m.light; (man.luma[k] = man.luma[k] || []).push(m.luma); });
    Object.keys(man.luma).forEach((k) => { const a = man.luma[k]; man.luma[k] = { mean: Math.round(a.reduce((s, x) => s + x, 0) / a.length * 10) / 10, max: Math.max.apply(null, a) }; });
    // the sheets: one per direction and placement, day and night (uk)
    DIRS.forEach((dd) => PLACES.forEach((pl) => LIGHTS.forEach((light) => {
        const cells = V.DEMO.map((st) => keep[dd[0] + pl[0] + st[0] + light]).filter(Boolean);
        const cv = sheet(cells, 6, dd[0] + ' ' + dd[1] + ' · ' + pl[0] + ' · ' + light + ' (uk): ' + dd[2], pl[0] === 'centre' ? 520 : 360);
        if (!cv) return;
        const file = 'sheets/' + dd[0] + '_' + pl[0] + '_' + light + '.png';
        PNG.write(path.join(OUT, file), cv.w, cv.h, cv.px);
        man.sheets.push({ file, title: dd[0] + ' ' + pl[0] + ' ' + light });
    })));
    // the context: two states per direction through Twin Dial's W2 and f30's window, day and night
    const ctxCells = [];
    DIRS.forEach((dd) => ['05', '07'].forEach((sid) => ['twin', 'f30'].forEach((theme) => LIGHTS.forEach((light) => {
        const k = keep[dd[0] + 'map' + sid + light];
        if (!k) return;
        const cv = inContext(k, theme, light === 'night');
        if (!cv) return;
        const file = 'context/' + dd[0] + '_' + sid + '_' + theme + '_' + light + '.png';
        PNG.write(path.join(OUT, file), 1920, 720, cv.px);
        man.context.push({ file, title: dd[0] + ' ' + sid + ' through ' + theme + ' ' + light });
        if (light === 'night') ctxCells.push({ px: cv.px, w: 1920, h: 720, cap: dd[0] + ' ' + sid + ' ' + theme });
    }))));
    const cs = sheet(ctxCells, 4, 'The map target in context: our picture through Twin Dial\'s W2 and f30\'s window (night)', 460);
    if (cs) { PNG.write(path.join(OUT, 'sheets', 'context.png'), cs.w, cs.h, cs.px); man.sheets.push({ file: 'sheets/context.png', title: 'context (map target through the themes\' windows)' }); }
    // the HUD's visible window outlined (one picture per direction, state 07, night)
    const hudCells = [];
    DIRS.forEach((dd) => {
        const k = keep[dd[0] + 'hud07night'];
        if (!k) return;
        const cv = new R.Canvas(800, 480, [0, 0, 0]);
        k.px.copy(cv.px);
        const w = V.GEO.hud.window;
        dashed(cv, w[0], w[1], w[0] + w[2], w[1], 1, [90, 90, 90], 6, 6); dashed(cv, w[0], w[1] + w[3], w[0] + w[2], w[1] + w[3], 1, [90, 90, 90], 6, 6);
        dashed(cv, w[0], w[1], w[0], w[1] + w[3], 1, [90, 90, 90], 6, 6); dashed(cv, w[0] + w[2], w[1], w[0] + w[2], w[1] + w[3], 1, [90, 90, 90], 6, 6);
        const file = 'context/' + dd[0] + '_hud_window.png';
        PNG.write(path.join(OUT, file), 800, 480, cv.px);
        man.context.push({ file, title: dd[0] + ' on the HUD, its visible window dashed (X3 measure; the G20 is not measured)' });
        hudCells.push({ px: cv.px, w: 800, h: 480, cap: dd[0] + ' HUD (window dashed)' });
    });
    const hs = sheet(hudCells, 5, 'The head-up display: black is see-through; only the dashed window reaches the eye (X3 measure)', 380);
    if (hs) { PNG.write(path.join(OUT, 'sheets', 'hud_window.png'), hs.w, hs.h, hs.px); man.sheets.push({ file: 'sheets/hud_window.png', title: 'HUD window' }); }
    // inside a theme (mockups only)
    const thCells = [];
    ['twin', 'f30'].forEach((theme) => ['05', '07', '12'].forEach((sid) => LIGHTS.forEach((light) => {
        const st = V.DEMO.filter((d) => d[0] === sid)[0];
        const cv = inTheme(st[2], theme, light === 'night', 'uk');
        if (!cv) return;
        const file = 'theme/' + theme + '_' + sid + '_' + light + '.png';
        PNG.write(path.join(OUT, file), 1920, 720, cv.px);
        if (light === 'night') thCells.push({ px: cv.px, w: 1920, h: 720, cap: theme + ' ' + sid });
    })));
    const ts = sheet(thCells, 3, 'Inside a theme (a change to Twin Dial / f30, not this package): a small sign and the reason in the bottom row', 600);
    if (ts) { PNG.write(path.join(OUT, 'sheets', 'in_theme.png'), ts.w, ts.h, ts.px); man.sheets.push({ file: 'sheets/in_theme.png', title: 'inside a theme' }); }
    // the motion: the dip and the return, nine steps each (direction A on the map: the GPU layers when rendered; and the centre)
    const mCells = [];
    motionFrames().forEach((m) => {
        const cv = new R.Canvas(1088, 480, [0, 0, 0]);
        const road = glLayer(m.tag + '_road'), lights = glLayer(m.tag + '_lights'), g = V.GEO.map;
        if (road && lights) { blit(cv, road.px, road.w, road.h, g.scene[0], g.scene[1]); blit(cv, lights.px, lights.w, lights.h, g.scene[0], g.scene[1]); } else P.scene(cv, g, g.scene[0], g.scene[1], m.v, m.e, true);
        blit(cv, P.textSheet(m.v, true, 'uk'), P.TEXT_W, P.TEXT_H, g.text[0], g.text[1]);
        const crop = new R.Canvas(420, 372, [0, 0, 0]);
        for (let y = 0; y < 372; y++) cv.px.copy(crop.px, y * 420 * 4, ((y + 44) * 1088 + 334) * 4, ((y + 44) * 1088 + 754) * 4);
        mCells.push({ px: crop.px, w: 420, h: 372, cap: (m.tag.indexOf('dip') > 0 ? 'dip' : 'return') + ' ' + m.ms + ' ms, extent ' + m.e.toFixed(2) });
    });
    const order = mCells.filter((c, i) => i % 2 === 0).concat(mCells.filter((c, i) => i % 2 === 1));
    const ms = sheet(order, 9, 'Motion: the dip (top) and the return (bottom), nine steps over 330 ms; the map target\'s core, night (GPU shaders)', 260);
    if (ms) { PNG.write(path.join(OUT, 'sheets', 'motion.png'), ms.w, ms.h, ms.px); man.sheets.push({ file: 'sheets/motion.png', title: 'motion: dip and return' }); }
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(man, null, 1));
    index(man);
    console.log(man.images.length + ' pictures, ' + man.sheets.length + ' sheets, ' + man.context.length + ' context -> ' + OUT + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)');
    console.log('night mean brightness (0..255): ' + Object.keys(man.luma).filter((k) => /night/.test(k)).map((k) => k + ' ' + man.luma[k].mean).join(', '));
}

module.exports = { picture, DIRS, PLACES, motionFrames, blit, resize };
if (require.main === module) main();
