'use strict';
/**
 * paint.js - direction E's pictures (round 1120 AA2; docs/r1120/AA-SPEC.md 3.1, docs/AGENT-BRIEF-acc-app.md). Pure: a state in,
 * RGBA pixels out. Every word comes from words.js by key, in the atlases baked from Twin Dial's Noto (Saira for figures).
 *
 *   textSheet(s, night, lang)        the map target's text sheet (GEO.map.text: 380 x 96): the ring with the set speed and our
 *                                    word, the -/+ marks (information only), the limit plate, the loop's suggestion
 *   pillSheet(s, night, lang)        the map target's pill sheet (340 x 44): the status pill, or nothing (transparent)
 *   centre(s, o)                     the centre page's picture (1600 x 482): E on the left (the lane by the canvas, the car as
 *                                    the acc_car shader's own baked sprite), the data table on the right.
 *                                    o: { night, lang, z (the glide's depth), info: { age (s) | null, warn (raw words) | null },
 *                                    demo: '07' | null }
 *   lane(cv, g, s, z, P, dim)        acc_lane's maths in JavaScript, for the centre page (the cluster runs the shader itself)
 *
 * The warning state (the car's own collision warning, drawn only when config.warn names it): our picture steps back to 35 %,
 * only the pill's words stay at full. Nothing here imitates the car's warning, and nothing is red.
 */
const M = require('./model');
const R = require('./raster');
const Wd = require('./words');

const TEXT_W = M.GEO.map.text[2], TEXT_H = M.GEO.map.text[3];
const PILL_W = M.GEO.map.pill[2], PILL_H = M.GEO.map.pill[3];
const PAGE_W = M.GEO.centre.w, PAGE_H = M.GEO.centre.h;

function truncate(str, font, size, maxW) {
    let s = String(str);
    if (R.textWidth(s, font, size) <= maxW) return s;
    while (s.length > 1 && R.textWidth(s + '…', font, size) > maxW) s = s.slice(0, -1);
    return s + '…';
}

/* ------------------------------------------------------------------------------------------------ the shared parts */

/** The ring, its word, the -/+ marks (never a button: they only say the wheel's buttons move the set speed). */
function ring(cv, P, s, cx, cy, r, figFont, figSize, wordFont, wordSize, lang, lw) {
    const rg = M.ringOf(s);
    const col = P[rg.col];
    cv.rrect(cx - r, cy - r, cx + r, cy + r, r, col, lw);
    const fs = R.fit(rg.fig, figFont, figSize, r * 1.45);
    cv.text(rg.fig, cx, cy + fs * 0.34, figFont, fs, col, 'center');
    const word = Wd.word(lang, rg.key);
    const ws = R.fit(word, wordFont, wordSize, r * 2.6);
    const tw = R.textWidth(word, wordFont, ws);
    cv.rrect(cx - tw / 2 - 6, cy + r - ws * 0.55, cx + tw / 2 + 6, cy + r + ws * 0.6, 4, P.bg, 0);
    cv.text(word, cx, cy + r + ws * 0.42, wordFont, ws, P[rg.wcol], 'center');
    const mcol = M.mix(P.ink, 0.45, P.bg), k = r / 40;
    [-1, 1].forEach((sx) => {
        const mx = cx + sx * (r + 30);
        cv.seg(mx - 9 * k, cy, mx + 9 * k, cy, 2.6 * k, mcol);
        if (sx > 0) cv.seg(mx, cy - 9 * k, mx, cy + 9 * k, 2.6 * k, mcol);
    });
}

/** The limit read from the road: a neutral plate with our word (no red ring: no red anywhere). */
function plate(cv, P, s, x, y, w, h, wordFont, figFont, lang) {
    cv.rrect(x, y, x + w, y + h, 8, M.mix(P.ink, 0.75, P.bg), 2);
    cv.text(Wd.word(lang, 'limit'), x + w / 2, y + h * 0.30, wordFont, R.fit(Wd.word(lang, 'limit'), wordFont, h * 0.21, w - 8), P.dim, 'center');
    const fig = s.lim ? String(s.lim) : '–';
    cv.text(fig, x + w / 2, y + h * 0.84, figFont, R.fit(fig, figFont, h * 0.50, w * 0.8), s.lim ? P.ink : P.faint, 'center');
}

/** The loop's suggestion: a cyan outline with the word "порада" (never drawn as the set speed). */
function advice(cv, P, s, ax, ay, fs, figFont, wordFont, wordSize, lang) {
    if (!s.adv) return;
    const fig = String(s.adv), tw = R.textWidth(fig, figFont, fs);
    cv.rrect(ax - tw / 2 - 12, ay - fs * 0.62, ax + tw / 2 + 12, ay + fs * 0.50, fs * 0.56, P.cyan, 2);
    cv.text(fig, ax, ay + fs * 0.33, figFont, fs, P.cyan, 'center');
    const w = Wd.word(lang, 'advice');
    cv.text(w, ax, ay + fs * 0.50 + wordSize * 1.05, wordFont, R.fit(w, wordFont, wordSize, tw + 60), P.cyan, 'center');
}

/** The status pill (events only). */
function pill(cv, P, s, x, y, w, h, font, boldFont, size, lang) {
    const pl = M.pillOf(s);
    if (!pl) return null;
    const str = Wd.word(lang, pl.key);
    const edge = pl.kind === 'fast' ? P.amber : pl.kind === 'warn' ? P.ink : M.mix(P.ink, 0.30, P.bg);
    const tcol = pl.kind === 'fast' ? P.amber : P.ink;
    cv.rrect(x, y, x + w, y + h, h / 2, P.panel, 0);
    cv.rrect(x, y, x + w, y + h, h / 2, edge, 2);
    const f = pl.kind === 'warn' ? boldFont : font;
    const fs = R.fit(str, f, size, w - h);
    cv.text(str, x + w / 2, y + h * 0.66, f, fs, tcol, 'center');
    return { str, font: f, size: fs, x: x + w / 2 - R.textWidth(str, f, fs) / 2, w: R.textWidth(str, f, fs), maxW: w - h };
}

/* ------------------------------------------------------------------------------------------------ the map target's sheets */

function textSheet(s, night, lang) {
    const P = M.colours('map', night), g = M.GEO.map, ox = g.text[0], oy = g.text[1];
    const cv = new R.Canvas(TEXT_W, TEXT_H, null);
    ring(cv, P, s, g.ring[0] - ox, g.ring[1] - oy, g.ring[2], 'av_f40', g.fig, 'av_b18', g.word, lang, 3);
    plate(cv, P, s, g.plate[0] - ox, g.plate[1] - oy, g.plate[2], g.plate[3], 'av_t16', 'av_f40', lang);
    advice(cv, P, s, g.adv[0] - ox, g.adv[1] - oy, g.fig * 0.62, 'av_f26', 'av_t16', g.word * 0.9, lang);
    if (s.warn) cv.dim(0, 0, TEXT_W, TEXT_H, 0.35, P.bg);
    return cv.px;
}

function pillSheet(s, night, lang) {
    const P = M.colours('map', night);
    const cv = new R.Canvas(PILL_W, PILL_H, null);
    pill(cv, P, s, 1, 1, PILL_W - 2, PILL_H - 2, 'av_t21', 'av_b18', (PILL_H - 2) * 0.48, lang);
    return cv.px;
}

/* ------------------------------------------------------------------------------------------------ the lane (acc_lane in JS) */

const sstep = (a, b, x) => { const t = R.clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);

/**
 * acc_lane.glsl's maths, pixel for pixel, into the canvas (the lane box g.lane); z the car ahead's depth (0 = none).
 * gapOnly: only the pixels the lit gap and the chevrons can touch (below the car, |X| < 0.92), each reset to bg and
 * computed whole again: over the same lanes drawn without a car this gives exactly the full computation, at a fraction of
 * its cost.
 */
function lane(cv, g, s, z, P, dim, gapOnly) {
    const U = M.laneUniforms(g, s, z, false);
    const lx = g.lane[0], ly = g.lane[1], W = g.lane[2], H = g.lane[3];
    const hy = U.u_view[0] * H, pxm = U.u_view[1], kf = U.u_view[2], range = U.u_view[3];
    const ego = U.u_ego, zc = U.u_gap[0], clo = U.u_gap[1], gs = U.u_gap[2];
    const fast = s.clo === 2, gapc = fast ? P.amberF : P.gap, line = P.line, ground = P.ground;
    const edgeCol = line.map((c) => c * 0.5 + 0.14);
    const lines = [];
    for (let i = 0; i < 4; i++) if (U.u_ln[i * 4 + 3] > 0.5) lines.push({ y0: U.u_ln[i * 4], a: U.u_ln[i * 4 + 1], c: U.u_ln[i * 4 + 2], ty: U.u_ln[i * 4 + 3], len: U.u_lp[i * 4], str: U.u_lp[i * 4 + 1], mw: U.u_lp[i * 4 + 2] });
    const dm = 1 - 0.65 * (dim || 0);
    const col = [0, 0, 0];
    const chev = [0, 1].map((i) => { const tc = 1 / (1 + zc * (0.45 + 0.22 * i) * kf); return { tc, yc: hy + (H - hy) * tc }; });
    for (let y = Math.max(0, Math.floor(ly + hy)); y < Math.min(cv.h, ly + H); y++) {
        const py = y + 0.5 - ly, t = (py - hy) / (H - hy);
        if (t <= 0) continue;
        const zz = (1 / t - 1) / kf, xm = zz * range, k = pxm * t, fade = 1 - sstep(0.55, 1, zz);
        if (gapOnly && !(zc > 0 && zz < zc)) continue;
        const ce = ego[0] + xm * (ego[1] + 0.5 * ego[2] * xm);
        const ly2 = lines.map((l) => (xm < l.len ? l.y0 + xm * (l.a + 0.5 * l.c * xm) : null));
        for (let x = Math.max(0, lx); x < Math.min(cv.w, lx + W); x++) {
            const px = x + 0.5 - lx, ym = (0.5 * W - px) / k, aX = Math.abs(ym - ce) / ego[3];
            if (gapOnly) {
                if (aX >= 0.92) continue;
                const j = (y * cv.w + x) * 4;
                cv.px[j] = P.bg[0]; cv.px[j + 1] = P.bg[1]; cv.px[j + 2] = P.bg[2]; cv.px[j + 3] = 255;
            }
            const edge = sstep(0, 48, Math.min(px, W - px)) * sstep(0, 16, H - py);
            let r = ground[0], gg = ground[1], b = ground[2];
            let a = (0.30 + 0.70 * R.clamp01(1 - zz)) * (1 - sstep(2.6, 5.5, aX)) * edge * fade;
            if (zc > 0 && zz < zc) {
                const kg = gs * (1 - sstep(0.72, 0.92, aX)) * sstep(0, 0.04, zc - zz);
                r += (gapc[0] - r) * kg; gg += (gapc[1] - gg) * kg; b += (gapc[2] - b) * kg;
                a = Math.max(a, kg * fade);
                for (let i = 0; i < 2; i++) {
                    const c = chev[i];
                    const d = (py - c.yc - aX * ego[3] * pxm * c.tc * 0.28) / (0.1 * pxm * c.tc * 0.9 + 0.8);
                    const on = (1 - sstep(0.6, 1, Math.abs(d))) * (1 - sstep(0.42, 0.52, aX)) * (i + 0.5 < clo ? 1 : 0);
                    r += (gapc[0] - r) * on; gg += (gapc[1] - gg) * on; b += (gapc[2] - b) * on; a = Math.max(a, on * fade);
                }
            }
            for (let i = 0; i < lines.length; i++) {
                if (ly2[i] === null) continue;
                const l = lines[i];
                let d = Math.abs(ym - ly2[i]) * k;
                const lw = Math.max(1.2, l.mw * k);
                if (d > lw * 4 + 4) continue;
                if (l.ty > 2.5 && l.ty < 3.5) d = Math.abs(d - 1.4 * lw);
                const on = 1 - sstep(lw * 0.5 - 0.7, lw * 0.5 + 0.7, d);
                const glow = (1 - sstep(0, lw * 2.5 + 2, d)) * 0.25;
                const dash = l.ty > 1.5 && l.ty < 2.5 ? (fract(xm / 12) < 0.5 ? 1 : 0) : 1;
                const kk = Math.max(on, glow) * dash * fade * l.str * (1 - sstep(l.len - 8, l.len, xm));
                const lc = l.ty > 3.5 ? edgeCol : line;
                r += (lc[0] - r) * kk; gg += (lc[1] - gg) * kk; b += (lc[2] - b) * kk;
                a = Math.max(a, kk);
            }
            if (a <= 0.002) continue;
            col[0] = R.clamp01(r * dm) * 255; col[1] = R.clamp01(gg * dm) * 255; col[2] = R.clamp01(b * dm) * 255;
            cv.put((y * cv.w + x) * 4, col, a);
        }
    }
}

/* ------------------------------------------------------------------------------------------------ the road users (acc_obj in JS) */

function box(qx, qy, cx, cy, bx, by, r) {
    const ex = Math.abs(qx - cx) - bx + r, ey = Math.abs(qy - cy) - by + r;
    const ox = Math.max(ex, 0), oy = Math.max(ey, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(ex, ey), 0) - r;
}
const circ = (qx, qy, cx, cy, r) => Math.sqrt((qx - cx) * (qx - cx) + (qy - cy) * (qy - cy)) - r;

/** acc_obj.glsl's shape(): the signed distance (in box heights) to our generic shape of class k (1..6), aspect a = w / h. */
function shape(qx, qy, k, a) {
    if (k < 1.5) return Math.min(box(qx, qy, 0, 0.64, 0.48 * a, 0.27, 0.10), box(qx, qy, 0, 0.30, 0.33 * a, 0.17, 0.07));
    if (k < 2.5) return Math.min(box(qx, qy, 0, 0.52, 0.48 * a, 0.47, 0.04), box(qx, qy, 0, 0.96, 0.40 * a, 0.04, 0.02));
    if (k < 3.5) return Math.min(Math.min(box(qx, qy, 0, 0.46, 0.12, 0.27, 0.09), circ(qx, qy, 0, 0.11, 0.09)), box(qx, qy, 0, 0.85, 0.05, 0.15, 0.04));
    const body = Math.min(circ(qx, qy, 0, 0.08, 0.075), box(qx, qy, 0, 0.34, 0.13, 0.19, 0.07));
    if (k < 4.5) return Math.min(body, box(Math.abs(qx), qy, 0.06, 0.76, 0.045, 0.23, 0.04));
    if (k < 5.5) return Math.min(body, Math.abs(circ(qx, qy, 0, 0.79, 0.18)) - 0.03);
    return Math.abs((Math.abs(qx) + Math.abs(qy - 0.5)) * 0.7071 - 0.3) - 0.035;
}

/** The road users of state s (far first), each in its own box: acc_obj's look. */
function users(cv, g, s, fill, dim) {
    const lx = g.lane[0], ly = g.lane[1];
    const dm = 1 - 0.65 * (dim || 0), col = [0, 0, 0], black = [0, 0, 0];
    M.objectBoxes(g, s).forEach((b) => {
        if (b.h <= 1) return;
        const a = b.w / b.h, aa = 1 / b.h;
        const x0 = Math.max(lx, Math.floor(lx + b.cx - 0.6 * b.w - 3)), x1 = Math.min(lx + g.lane[2], Math.ceil(lx + b.cx + 0.6 * b.w + 3));
        const y0 = Math.max(ly, Math.floor(ly + b.fy - b.h - 2)), y1 = Math.min(ly + g.lane[3], Math.ceil(ly + b.fy + 0.12 * b.h + 2));
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                const qx = (x + 0.5 - lx - b.cx) / b.h, qy = (y + 0.5 - ly - (b.fy - b.h)) / b.h;
                const sx = qx / (0.5 * a + 0.08), sy = (qy - 1) / 0.06;
                const sh = (1 - sstep(0.3, 1, sx * sx + sy * sy)) * 0.45;
                const d = shape(qx, qy, b.cls, a);
                const k = 1 - sstep(-aa, aa, d);
                const i = (y * cv.w + x) * 4;
                if (sh * (1 - k) > 0.002) cv.put(i, black, sh * (1 - k) * b.alpha);
                if (k > 0.002) {
                    const lit = (0.78 + 0.22 * (1 - qy)) * (0.72 + 0.28 * sstep(-0.06, -0.015, d)) * dm;
                    col[0] = R.clamp01(fill[0] * lit) * 255; col[1] = R.clamp01(fill[1] * lit) * 255; col[2] = R.clamp01(fill[2] * lit) * 255;
                    cv.put(i, col, k * b.alpha);
                }
            }
        }
    });
}

/* ------------------------------------------------------------------------------------------------ the centre page */

/** The rows of the data table: [labelKey, text, colourRole, bold]. */
function rows(s, o, lang) {
    const W = (k) => Wd.word(lang, k);
    const info = o.info || {};
    const out = [];
    if (s.data === 'ok') out.push(['rowTarget', W(s.tgt <= 2 ? 'near' : s.tgt === 3 ? 'middle' : 'far') + ' · ' + W('level') + ' ' + s.tgt, s.clo === 2 ? 'amber' : 'ink']);
    else out.push(['rowTarget', W(s.data === 'absent' ? 'noData' : s.data === 'stale' ? 'stale' : 'noTarget'), 'dim']);
    if (s.data !== 'ok') out.push(['rowClosing', '—', 'dim']);
    else out.push(['rowClosing', W(s.clo === 2 ? 'closingFast' : s.clo ? 'closingYes' : 'closingNo'), s.clo === 2 ? 'amber' : 'ink']);
    if (!s.cru) out.push(['rowCruise', W('off'), 'dim']);
    else out.push(['rowCruise', W(s.cru[0] === 'limiter' ? 'limiter' : s.cru[1] === 'active' ? 'cruiseActive' : 'cruisePaused') + ' · ' + s.cru[2] + ' ' + W('kmh'), s.cru[1] === 'active' ? 'green' : 'dim']);
    out.push(['rowLimit', s.lim ? s.lim + ' ' + W('kmh') : W('noLimit'), s.lim ? 'ink' : 'dim']);
    const age = info.age;
    if (typeof age !== 'number') out.push(['rowAge', W(s.data === 'absent' ? 'ageNone' : 'ageWait'), 'dim']);
    else out.push(['rowAge', (age < 1 ? '< 1' : String(Math.floor(age))) + ' ' + W('sec'), age < 2 ? 'ink' : 'dim']);
    if (s.warn) out.push(['rowWarn', W('warnActive'), 'ink', true]);
    else out.push(['rowWarn', info.warn ? String(info.warn) : W('warnNone'), info.warn ? 'ink' : 'dim']);
    out.push(['rowAdvice', s.adv ? s.adv + ' ' + W('kmh') : '—', s.adv ? 'cyan' : 'dim']);
    // what the sensors see (the owner's FOCUS): the road users by class, the lanes measured or our symbol
    const objs = (s.world && s.world.objects) || [], cnt = {};
    objs.forEach((u) => { if ((u.alpha === undefined ? 1 : u.alpha) > 0.5) cnt[u.cls] = (cnt[u.cls] || 0) + 1; });
    const parts = ['car', 'truck', 'two', 'ped', 'cyc', 'unk'].filter((c) => cnt[c]).map((c) => W('cls_' + c) + ' ' + cnt[c]);
    out.push(['rowUsers', parts.length ? parts.join(' · ') : '—', parts.length ? 'ink' : 'dim']);
    const ln = s.world && s.world.lanes;
    out.push(['rowLanes', ln ? W('lanesMeasured') + ' · ' + ln.lines.length : W('lanesFixed'), ln ? 'ink' : 'dim']);
    return out;
}

const ROW0 = 106, ROW_STEP = 40;
const BASE = { px: null, key: null };      // the page's background with the lanes and no car (one kept: ~3 MB)

/** -> { px, words: [{ key, str, x, w, maxW }] } (words: what was drawn where, for the tests' "inside its box"). */
function centre(s, o) {
    const opt = o || {};
    const lang = Wd.langOf(opt.lang), night = !!opt.night;
    const P = M.colours('centre', night), g = M.GEO.centre;
    const words = [];
    const lead = M.leadOf(s);
    const z = typeof opt.z === 'number' ? opt.z : lead ? lead.x / M.RANGE : 0;
    // E: the lanes (the background with the lanes and no car is cached per day / night and lane picture; the gap is computed
    // over it), the road users, the car ahead highlighted (the acc_car shader's own sprite), the ring, the limit, the suggestion
    const bk = night + '|' + M.worldKey({ world: s.world ? { lanes: s.world.lanes, objects: [] } : null });
    if (!BASE.px || BASE.key !== bk) {
        const b = new R.Canvas(PAGE_W, PAGE_H, P.bg);
        lane(b, g, { tgt: null, clo: 0, world: s.world ? { lanes: s.world.lanes } : null }, 0, P, 0);
        BASE.px = b.px; BASE.key = bk;
    }
    const cv = new R.Canvas(PAGE_W, PAGE_H, null);
    BASE.px.copy(cv.px);
    if (lead) lane(cv, g, s, z, P, 0, true);
    users(cv, g, s, P.fill, 0);
    if (lead) {
        const r = M.carRect(g, z, lead.y);
        cv.sprite(R.sprite(s.clo === 2 ? 'carFast' : 'car'), r[0], r[1], r[2], r[3], night ? (s.clo === 2 ? 0.78 : 0.75) : 1, 1);
    }
    ring(cv, P, s, g.ring[0], g.ring[1], g.ring[2], 'av_f56', g.fig, 'av_b26', g.word, lang, 3.5);
    plate(cv, P, s, g.plate[0], g.plate[1], g.plate[2], g.plate[3], 'av_t21', 'av_f56', lang);
    advice(cv, P, s, g.adv[0], g.adv[1], g.fig * 0.62, 'av_f40', 'av_t21', g.word * 0.9, lang);
    if (s.warn) cv.dim(0, 0, g.divider, PAGE_H, 0.35, P.bg);
    const pw = pill(cv, P, s, g.pill[0], g.pill[1], g.pill[2], g.pill[3], 'av_t27', 'av_b26', g.pill[3] * 0.48, lang);
    if (pw) words.push({ key: 'pill', str: pw.str, x: pw.x, w: pw.w, x0: g.pill[0] + g.pill[3] / 2, x1: g.pill[0] + g.pill[2] - g.pill[3] / 2 });
    // the divider and the data table
    const line = M.mix(P.ink, 0.12, P.bg);
    cv.seg(g.divider, 24, g.divider, PAGE_H - 24, 1, line);
    const x0 = g.table[0], x1 = g.table[1];
    const title = Wd.word(lang, 'title'), only = Wd.word(lang, 'viewOnly');
    const tw = cv.text(title, x0, 46, 'av_b26', 26, P.ink, 'left');
    const ow = cv.text(only, x1, 46, 'av_t21', 21, P.dim, 'right');
    words.push({ key: 'title', str: title, x: x0, w: tw, x0, x1: x1 - ow - 16 });
    if (opt.demo) cv.text(Wd.word(lang, 'demo') + ' ' + opt.demo, x1, 76, 'av_t21', 21, P.dim, 'right');
    rows(s, opt, lang).forEach((rw, i) => {
        const y = ROW0 + i * ROW_STEP;
        const label = Wd.word(lang, rw[0]);
        const lw = cv.text(label, x0, y, 'av_t21', 21, P.dim, 'left');
        const room = x1 - x0 - lw - 24;
        const font = rw[3] ? 'av_b26' : 'av_t27';
        const val = truncate(rw[1], font, 26, room);
        const vw = cv.text(val, x1, y, font, 26, P[rw[2]], 'right');
        words.push({ key: rw[0], str: label, x: x0, w: lw, x0, x1: x1 - vw - 24 });
        words.push({ key: rw[0] + ':value', str: val, x: x1 - vw, w: vw, x0: x0 + lw + 24, x1 });
        cv.seg(x0, y + 14, x1, y + 14, 1, line);
    });
    const foot = Wd.word(lang, 'footer');
    const fw = cv.text(foot, x0, PAGE_H - 18, 'av_t16', 16, P.dim, 'left');
    words.push({ key: 'footer', str: foot, x: x0, w: fw, x0, x1 });
    return { px: cv.px, words };
}

module.exports = { textSheet, pillSheet, centre, lane, users, shape, rows, TEXT_W, TEXT_H, PILL_W, PILL_H, PAGE_W, PAGE_H, truncate };
