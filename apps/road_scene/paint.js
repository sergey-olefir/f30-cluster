'use strict';
/**
 * paint.js - Road Scene's pictures (round fixes-1121 RS: ACC View's direction E, round 1120 AA2 / fixes-1121 AL, with Auto
 * Beam's content in the same scene). Pure: a state in, RGBA pixels out. Every word comes from shared/i18n through words.js,
 * in the atlases baked from Twin Dial's Noto (Saira for figures).
 *
 *   textSheet(s, night, lang)        the map target's text sheet (GEO.map.text: 420 x 96): at night, while the beam advisor is
 *                                    available, the advice (our sign, the advice, the reason, the lamps' own small sign) on its
 *                                    left; the ring with the set speed and our word, the -/+ marks (information only), the limit
 *                                    plate, the loop's suggestion
 *   pillSheet(s, night, lang)        the map target's pill sheet (340 x 44): the status pill, or nothing (transparent)
 *   centre(s, o)                     the centre page's picture (1600 x 482): the scene on the left (the lane by the canvas, the
 *                                    car as the acc_car shader's own baked sprite, our beams on the road, the light sources),
 *                                    the data table on the right. o: { night, lang, z (the glide's depth), info: { age (s) |
 *                                    null, warn (raw words) | null }, demo: '07' | null }
 *   band(s, o) / table(s, o)         the centre page's top band (800 x 204) and its table (800 x 482): the GPU page's two images
 *   lane(cv, g, s, z, P, dim)        acc_lane's maths in JavaScript (the lanes, the lit gap, our beams), for the centre page
 *   users(cv, g, s, fill, dim, night) acc_obj's look in JavaScript (the road users, their lamps and rings, the light points)
 *   sign(cv, cx, cy, s, col, high, badgeCol, alpha)   Auto Beam's sign: OUR OWN drawing of the generic headlamp-with-rays idea
 *
 * The warning state (the car's own collision warning, drawn only when config.warn names it): our picture steps back to 35 %,
 * only the pill's words stay at full. The car's own message (Auto Beam's yield): the scene steps back the same way. Nothing here
 * imitates the car's warning, and nothing is red.
 */
const M = require('./model');
const R = require('./raster');
const Wd = require('./words');
const C = require('./contract');

const TEXT_W = M.GEO.map.text[2], TEXT_H = M.GEO.map.text[3];
const sstepJ = (a, b, x) => { const t = R.clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
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

/* ------------------------------------------------------------------------------------------------ the beam advice (Auto Beam) */

/**
 * OUR OWN drawing of the generic headlamp-with-rays idea: a lamp body (round side right, flat side left) and five rays left of
 * it, level for high, slanted down for low; an "A" in a small ring says the advice is automatic. Lines, no fills.
 */
function sign(cv, cx, cy, s, col, high, badgeCol, alpha) {
    const u = s / 50, w = 5 * u, al = alpha === undefined ? 1 : alpha;
    const bx = cx + 8 * u, br = 26 * u, flat = cx - 6 * u;
    cv.sdf(flat - w, cy - br - w, bx + br + w, cy + br + w, col, al, (x, y) => {
        const d = Math.sqrt((x - bx) * (x - bx) + (y - cy) * (y - cy)) - br;
        return Math.max(d, flat - x);
    }, w);
    for (let i = -2; i <= 2; i++) {
        const y0 = cy + i * 9 * u, x0 = cx - 15 * u, x1 = cx - 45 * u;
        cv.seg(x0, y0, x1, y0 + (high ? 0 : 11 * u), w, col);
    }
    if (badgeCol) {
        const ax = cx + 34 * u, ay = cy + 27 * u, ar = 11 * u;
        cv.sdf(ax - ar - w, ay - ar - w, ax + ar + w, ay + ar + w, badgeCol, al, (x, y) => Math.sqrt((x - ax) * (x - ax) + (y - ay) * (y - ay)) - ar, 2.6 * u);
        const fs = 15 * u;
        cv.text('A', ax, ay + fs * 0.36, 'ab_b22', fs, badgeCol, 'center', al);
    }
}
/** The lamps' own small sign (the same drawing, small): level rays while the high beam is lit. */
function lampIcon(cv, x, y, h, col, lamps, alpha) {
    const s = h / 1.1;
    sign(cv, x + s * 0.9, y, s, col, lamps === 'high' || lamps === 'flash', null, alpha);
}
/** The advice line's key: high now, dip now, or low (a standby advice / no advice). */
function adviceKey(v) {
    if (!v || v.data !== 'ok' || v.state === 'UNAVAILABLE') return 'beam.adv.low';
    if (v.adv === 'high' && v.go) return 'beam.adv.high';
    // "dip now" only for a light ahead (or the camera's no), not for a held low (a curve, the countdown) or a standby
    return v.go && !v.countdown && v.trigger ? 'beam.adv.dip' : 'beam.adv.low';
}
/** The reason line: the countdown first while the return to high counts down. */
function reasonText(v, lang) {
    const W = (k, x) => Wd.word(lang, k, x);
    const r = W(C.REASON_KEY(v ? v.reason : 'nodata'));
    if (v && v.countdown) return W('beam.return', { s: v.countdown }) + ' · ' + r;
    return r;
}
function lampsText(v, lang) {
    const W = (k) => Wd.word(lang, k);
    return W('beam.lamps') + ': ' + W(v && v.lamps ? 'beam.lamps.' + v.lamps : 'beam.lamps.unknown');
}
/** The sign's colour role: blue only while high is advised (and the advice is live), else grey; faint while unavailable. */
function signRole(v) {
    if (!v || v.data !== 'ok' || v.state === 'UNAVAILABLE') return 'faint';
    return v.adv === 'high' && v.go ? 'blue' : 'dim';
}

/**
 * The advice block (at night, while the advisor is available): the sign at a fixed place, the advice (blue only for high), the
 * reason, the lamps' real state beside it (amber only when the advice is to dip and the high beam is lit). G: the placement's
 * GEO, ox / oy: the canvas's origin in that placement's px. -> the words drawn [{ key, str, x, w, x0, x1 }] (canvas px).
 */
function adviceBlock(cv, P, s, G, ox, oy, lang, small) {
    const v = s.beam, words = [];
    const role = signRole(v), sc = P[role];
    const al = v.yield ? 0.35 : 1;
    sign(cv, G.sign[0] - ox, G.sign[1] - oy, G.sign[2], sc, v.adv === 'high' && v.go, role === 'blue' ? P.blue : P.dim, al);
    const lc = v.disagree ? P.amber : P.dim;
    const adv = Wd.word(lang, adviceKey(v)), rs = v.yield ? Wd.word(lang, 'beam.yield') : reasonText(v, lang);
    const acol = role === 'blue' ? P.blue : role === 'faint' ? P.dim : P.ink;
    if (small) {
        // the map: the advice and the reason under the sign, the lamps' small sign beside it
        const x0 = G.signText[0] - ox, x1 = G.signText[1] - ox, maxW = x1 - x0;
        const as = R.fit(adv, 'ab_b22', 18, maxW), at = truncate(adv, 'ab_b22', as, maxW);
        const aw = cv.text(at, x0, G.signText[2] - oy, 'ab_b22', as, acol, 'left', al);
        words.push({ key: 'beamAdvice', str: adv, x: x0, w: aw, x0, x1, cut: at !== adv });
        // the map's narrow block: while the return counts down and the line does not fit, the reason alone (the table has both)
        let rs2 = rs, rsz = R.fit(rs2, 'ab_t16', 16, maxW);
        if (R.textWidth(rs2, 'ab_t16', rsz) > maxW && !v.yield) { rs2 = Wd.word(lang, C.REASON_KEY(v.reason)); rsz = R.fit(rs2, 'ab_t16', 16, maxW); }
        const rt = truncate(rs2, 'ab_t16', rsz, maxW);
        const rw = cv.text(rt, x0, G.signText[3] - oy, 'ab_t16', rsz, v.yield ? P.ink : P.dim, 'left');
        words.push({ key: 'beamReason', str: rs2, x: x0, w: rw, x0, x1, cut: rt !== rs2 });
        lampIcon(cv, G.lamps[0] - ox, G.lamps[1] - oy, G.lamps[2], lc, v.lamps, al);
        return words;
    }
    const x0 = G.signText[0] - ox, x1 = G.signText[1] - ox, maxW = x1 - x0;
    const as = R.fit(adv, 'ab_b34', 26, maxW);
    const aw = cv.text(truncate(adv, 'ab_b34', as, maxW), x0, G.signText[2] - oy, 'ab_b34', as, acol, 'left', al);
    words.push({ key: 'beamAdvice', str: adv, x: x0, w: aw, x0, x1 });
    const rsz = R.fit(rs, 'ab_t21', 21, maxW);
    const rw = cv.text(truncate(rs, 'ab_t21', rsz, maxW), x0, G.signText[3] - oy, 'ab_t21', rsz, v.yield ? P.ink : P.dim, 'left');
    words.push({ key: 'beamReason', str: rs, x: x0, w: rw, x0, x1 });
    lampIcon(cv, x0, G.signText[4] - oy - 6, 13, lc, v.lamps, al);
    const lt = lampsText(v, lang), lsz = R.fit(lt, 'ab_t16', 18, maxW - 34);
    const lw = cv.text(truncate(lt, 'ab_t16', lsz, maxW - 34), x0 + 34, G.signText[4] - oy, 'ab_t16', lsz, lc, 'left', al);
    words.push({ key: 'beamLamps', str: lt, x: x0 + 34, w: lw, x0: x0 + 34, x1 });
    return words;
}

/* ------------------------------------------------------------------------------------------------ the map target's sheets */

function textSheet(s, night, lang) {
    const P = M.colours('map', night), g = M.GEO.map, ox = g.text[0], oy = g.text[1];
    const cv = new R.Canvas(TEXT_W, TEXT_H, null);
    if (M.adviceShown(s, night)) adviceBlock(cv, P, s, g, ox, oy, Wd.langOf(lang), true);
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

const sstep = sstepJ;
const fract = (x) => x - Math.floor(x);

/**
 * acc_lane.glsl's maths, pixel for pixel, into the canvas (the lane box g.lane); z the car ahead's depth (0 = none).
 * gapOnly: only the pixels the lit gap and the chevrons can touch (below the car, |X| < 0.92), each reset to bg and
 * computed whole again: over the same lanes drawn without a car this gives exactly the full computation, at a fraction of
 * its cost.
 */
function lane(cv, g, s, z, P, dim, gapOnly) {
    const U = M.laneUniforms(g, s, z, !!P.night);
    const lx = g.lane[0], ly = g.lane[1], W = g.lane[2], H = g.lane[3];
    const be = U.u_beam[0], bOn = U.u_beam[1], bZ = U.u_beam[2], bW = U.u_beam[3], bc = P.beamF;
    const hy = U.u_view[0] * H, pxm = U.u_view[1], kf = U.u_view[2], range = U.u_view[3];
    const ego = U.u_ego, zc = U.u_gap[0], clo = U.u_gap[1], gs = U.u_gap[2];
    const fast = s.clo === 2, gapc = fast ? P.amberF : P.gap, line = P.line, ground = P.ground;
    const edgeCol = line.map((c) => c * 0.5 + 0.14);
    const lines = [];
    for (let i = 0; i < 4; i++) if (U.u_ln[i * 4 + 3] > 0.5) lines.push({ y0: U.u_ln[i * 4], a: U.u_ln[i * 4 + 1], c: U.u_ln[i * 4 + 2], ty: U.u_ln[i * 4 + 3], len: U.u_lp[i * 4], str: U.u_lp[i * 4 + 1], mw: U.u_lp[i * 4 + 2], g: U.u_lp[i * 4 + 3] });
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
            if (bOn > 0) {
                // fixes-1121 RS: our beams (acc_lane's u_beam): the low beam's pool and the high beam's cone, in our car's frame
                const xf = xm - bW, yb = Math.abs(ym - bZ);
                const lowW = 1 + 5.2 * (1 - Math.exp(-xf / 8)), low = 0.62 * (1 - sstep(43.2, 60, xf)) * (0.55 + 0.45 * Math.exp(-xf / 25));
                const reach = 60 + 160 * be, highW = 0.8 + 3.4 * (1 - Math.exp(-xf / 40));
                const high = 0.5 * Math.sqrt(be) * (1 - sstep(reach * 0.55, reach, xf)) * (0.55 + 0.45 * Math.exp(-xf / 90));
                const lk = (xf >= 0.5 ? 1 : 0) * Math.min(1, low * (1 - sstep(0.6 * lowW, lowW, yb)) + high * (1 - sstep(0.45 * highW, highW, yb))) * fade * bOn;
                r += (bc[0] - r) * lk; gg += (bc[1] - gg) * lk; b += (bc[2] - b) * lk; a = Math.max(a, lk);
            }
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
                const g = l.g;                  // 0 measured .. 1 our own guess (acc_lane's u_lp.w): thinner, no glow, short dashes
                const lw = Math.max(1.2, l.mw * k) * (1 - 0.5 * g);
                if (d > Math.max(1.2, l.mw * k) * 4 + 4) continue;
                if (l.ty > 2.5 && l.ty < 3.5) d = Math.abs(d - 1.4 * lw * (1 - g));
                const on = 1 - sstep(lw * 0.5 - 0.7, lw * 0.5 + 0.7, d);
                const glow = (1 - sstep(0, lw * 2.5 + 2, d)) * 0.25 * (1 - g);
                let dash = l.ty > 1.5 && l.ty < 2.5 ? (fract(xm / 12) < 0.5 ? 1 : 0) : 1;
                if (g > 0) dash += ((fract(xm / 5) < 0.4 ? 1 : 0) - dash) * g;
                const kk = Math.max(on, glow) * dash * fade * l.str * (1 - sstep(l.len - 8 - 30 * g, l.len, xm));
                const lc0 = l.ty > 3.5 ? edgeCol : line;
                const lc = g > 0 ? [0, 1, 2].map((j) => lc0[j] + (line[j] - lc0[j]) * g) : lc0;
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

/** The road users of state s (far first), each in its own box, their lamps and rings, the light points: acc_obj's look. */
function users(cv, g, s, fill, dim, night) {
    const lx = g.lane[0], ly = g.lane[1];
    const dm = 1 - 0.65 * (dim || 0), col = [0, 0, 0], black = [0, 0, 0];
    const ink = M.RING.map((c) => c * dm);
    const lampc = (k) => (M.LAMP[k] || M.LAMP[4]).map((c) => c * dm);
    const paint = (i, rgb, k) => { col[0] = R.clamp01(rgb[0]) * 255; col[1] = R.clamp01(rgb[1]) * 255; col[2] = R.clamp01(rgb[2]) * 255; cv.put(i, col, k); };
    M.sceneItems(g, s, night).forEach((b) => {
        if (b.light) {
            // a light point: one lamp or a pair, a soft glow, the ring when it caused the advice
            const r = Math.max(b.r, 1), rr = Math.max(Math.max(b.hs / r + 3, 5), 9 / r), ext = (b.hs / r + 11) * r;
            const lc = lampc(b.cls - 6);
            for (let y = Math.max(ly, Math.floor(ly + b.cy - 11 * r)); y < Math.min(ly + g.lane[3], Math.ceil(ly + b.cy + 11 * r)); y++) {
                for (let x = Math.max(lx, Math.floor(lx + b.cx - ext)); x < Math.min(lx + g.lane[2], Math.ceil(lx + b.cx + ext)); x++) {
                    const dx = (x + 0.5 - lx - b.cx) / r, dy = (y + 0.5 - ly - b.cy) / r, hs = b.hs / r;
                    const d = b.hs > 0.8 ? Math.min(Math.hypot(dx - hs, dy), Math.hypot(dx + hs, dy)) : Math.hypot(dx, dy);
                    const a = Math.max(1 - sstep(1 - 0.7 / r, 1 + 0.7 / r, d), (1 - sstep(1, 3, d)) * 0.16);
                    const kr = b.ring * (1 - sstep(0.3, 1.3, Math.abs(Math.hypot(dx, dy) - rr) * r)) * 0.85;
                    const k = Math.max(a, kr);
                    if (k > 0.002) paint((y * cv.w + x) * 4, kr > a ? ink : lc, k);
                }
            }
            return;
        }
        if (b.h <= 1) return;
        const a = b.w / b.h, aa = 1 / b.h, rq = 0.5 * Math.max(a, 1) + 0.25, ex = b.ring ? rq * b.h + 3 : 0;
        const x0 = Math.max(lx, Math.floor(lx + b.cx - Math.max(0.6 * b.w + 3, ex))), x1 = Math.min(lx + g.lane[2], Math.ceil(lx + b.cx + Math.max(0.6 * b.w + 3, ex)));
        const y0 = Math.max(ly, Math.floor(ly + Math.min(b.fy - b.h - 2, b.fy - 0.5 * b.h - ex))), y1 = Math.min(ly + g.lane[3], Math.ceil(ly + Math.max(b.fy + 0.12 * b.h + 2, b.fy - 0.5 * b.h + ex)));
        const lmpX = b.cls === 3 || b.cls === 5 ? 0 : 0.36 * a, lmpY = b.cls === 2 ? 0.80 : 0.58, lc = b.lamp ? lampc(b.lamp) : null;
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                const qx = (x + 0.5 - lx - b.cx) / b.h, qy = (y + 0.5 - ly - (b.fy - b.h)) / b.h;
                const i = (y * cv.w + x) * 4;
                if (b.cls <= 6) {
                    const sx = qx / (0.5 * a + 0.08), sy = (qy - 1) / 0.06;
                    const sh = (1 - sstep(0.3, 1, sx * sx + sy * sy)) * 0.45;
                    const d = shape(qx, qy, b.cls, a);
                    const k = 1 - sstep(-aa, aa, d);
                    if (sh * (1 - k) > 0.002) cv.put(i, black, sh * (1 - k) * b.alpha);
                    if (k > 0.002) {
                        const lit = (0.78 + 0.22 * (1 - qy)) * (0.72 + 0.28 * sstep(-0.06, -0.015, d)) * dm;
                        paint(i, [fill[0] * lit, fill[1] * lit, fill[2] * lit], k * b.alpha);
                    }
                    if (lc) {
                        const dl = Math.hypot(Math.abs(qx) - lmpX, qy - lmpY);
                        const la = Math.max(1 - sstep(0.05, 0.05 + aa, dl), (1 - sstep(0, 0.22, dl)) * 0.35);
                        if (la > 0.002) paint(i, lc, la * b.alpha);
                    }
                }
                if (b.ring) {
                    const kr = (1 - sstep(0.6 * aa, 1.6 * aa, Math.abs(Math.hypot(qx, qy - 0.5) - rq))) * 0.85;
                    if (kr > 0.002) paint(i, ink, kr * b.alpha);
                }
            }
        }
    });
}

/** The car ahead's lamps lit (it is a light source the beam advisor sees, at night): two lamps over its sprite at the lamp band
 *  (acc_car's u_lamp: x +-0.52, y 0.53 of its box height). */
function leadLamps(cv, r, lamp, ox, oy, dimK) {
    if (!lamp || !lamp[3]) return;
    const h = r[3], cx = r[0] + r[2] / 2 + (ox || 0), cy = r[1] + 0.53 * h + (oy || 0), rad = Math.max(1.2, 0.07 * h);
    const col = [0, 1, 2].map((i) => Math.round(R.clamp01(lamp[i] * (dimK === undefined ? 1 : dimK)) * 255));
    [-1, 1].forEach((sg) => cv.rrect(cx + sg * 0.52 * h - rad, cy - rad, cx + sg * 0.52 * h + rad, cy + rad, rad, col, 0, 1));
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
    // r1120 merge: the age in steps (< 1, 1-2, 2-5, > 5 s), not to the second: the table is one 800 x 482 image on the GPU page,
    // and a value that changed every second re-uploaded 1.5 MB a second while the field was quiet (it is notified on change)
    else out.push(['rowAge', ageStep(age) + ' ' + W('sec'), age < 2 ? 'ink' : 'dim']);
    if (s.warn) out.push(['rowWarn', W('warnActive'), 'ink', true]);
    else out.push(['rowWarn', info.warn ? String(info.warn) : W('warnNone'), info.warn ? 'ink' : 'dim']);
    out.push(['rowAdvice', s.adv ? s.adv + ' ' + W('kmh') : '—', s.adv ? 'cyan' : 'dim']);
    // what the sensors see (the owner's FOCUS): the road users by class, the lanes measured or our symbol
    const objs = (s.world && s.world.objects) || [], cnt = {};
    objs.forEach((u) => { if ((u.alpha === undefined ? 1 : u.alpha) > 0.5) cnt[u.cls] = (cnt[u.cls] || 0) + 1; });
    const parts = ['car', 'truck', 'two', 'ped', 'cyc', 'unk'].filter((c) => cnt[c]).map((c) => W('cls_' + c) + ' ' + cnt[c]);
    out.push(['rowUsers', parts.length ? parts.join(' · ') : '—', parts.length ? 'ink' : 'dim']);
    out.push(lanesRow(s, W));
    // fixes-1121 RS: the beam advisor (Auto Beam's table, cut to what the brief keeps): the advice, its reason, the source the
    // decision rests on, the driver's lamps (amber only in the disagreement), the agreement with the driver
    const v = s.beam;
    if (!v || v.data !== 'ok' || v.state === 'UNAVAILABLE') out.push(['rowBeamAdvice', W(v ? C.STATE_KEY[v.state] || 'beam.state.unavailable' : 'beam.state.unavailable'), 'dim']);
    else out.push(['rowBeamAdvice', W(adviceKey(v)), 'ink']);
    out.push(['beam.row.reason', v ? (v.yield ? W('beam.yield') : reasonText(v, lang)) : W('beam.reason.nodata'), v && v.data === 'ok' ? 'ink' : 'dim']);
    out.push(['beam.row.src', W(v && v.src === 'light' ? 'beam.src.light' : v && v.src === 'object' ? 'beam.src.object' : 'beam.src.none'), v && v.src ? 'ink' : 'dim']);
    // amber only for the disagreement while the advice itself is shown (at night): by day there is no advice to disagree with
    out.push(['beam.row.lamps', W(v && v.lamps ? 'beam.lamps.' + v.lamps : 'beam.lamps.unknown'), v && v.disagree && M.adviceShown(s, !!o.night) ? 'amber' : v && v.lamps ? 'ink' : 'dim']);
    const sc = v && v.score, has = sc && sc.agreePct !== null && sc.agreePct !== undefined;
    out.push(['beam.row.score', has ? Wd.word(lang, 'scoreLine', { pct: sc.agreePct, early: sc.early, late: sc.late, missed: sc.missed }) : W('beam.score.none'), has ? 'ink' : 'dim']);
    return out;
}

/** The row "Смуги": measured (with how many), partial, our path (from the steering, or from our motion), straight; or AA's
 *  fixed symbol when there is no world at all (the 14 cruise demo states). */
function lanesRow(s, W) {
    const ln = s.world && s.world.lanes;
    if (!ln) return ['rowLanes', W('lanesFixed'), 'dim'];
    const v = ln.verdict || 'measured';
    if (v === 'measured') return ['rowLanes', W('lanesMeasured') + ' · ' + (typeof ln.n === 'number' ? ln.n : ln.lines.length), 'ink'];
    if (v === 'partial') return ['rowLanes', W('lanesPartial'), 'dim'];
    if (v === 'predicted') return ['rowLanes', W(ln.path && ln.path.src === 'steer' ? 'lanesPathSteer' : 'lanesPathMotion'), 'dim'];
    return ['rowLanes', W('lanesStraight'), 'dim'];
}

const ROW0 = 90, ROW_STEP = 26.5;          // fixes-1121 RS: 14 rows (ACC View's 9 and the beam advisor's 5)
const BASE = { px: null, key: null };      // the page's background with the lanes and no car (one kept: ~3 MB)

const BAND_H = 204;           // the centre page's top band (ring, limit, suggestion, pill): everything above the lane box

/** The top band of the centre page's E half: 800 x BAND_H on the page's background. -> { px, words } (page px). */
function band(s, o) {
    const opt = o || {};
    const lang = Wd.langOf(opt.lang), night = !!opt.night;
    const P = M.colours('centre', night), g = M.GEO.centre;
    const cv = new R.Canvas(g.divider, BAND_H, P.bg), words = [];
    if (M.adviceShown(s, night)) adviceBlock(cv, P, s, g, 0, 0, lang, false).forEach((w) => words.push(w));
    ring(cv, P, s, g.ring[0], g.ring[1], g.ring[2], 'av_f56', g.fig, 'av_b26', g.word, lang, 3.5);
    plate(cv, P, s, g.plate[0], g.plate[1], g.plate[2], g.plate[3], 'av_t21', 'av_f56', lang);
    advice(cv, P, s, g.adv[0], g.adv[1], g.fig * 0.62, 'av_f40', 'av_t21', g.word * 0.9, lang);
    if (s.warn) cv.dim(0, 0, cv.w, cv.h, 0.35, P.bg);
    const pw = pill(cv, P, s, g.pill[0], g.pill[1], g.pill[2], g.pill[3], 'av_t27', 'av_b26', g.pill[3] * 0.48, lang);
    if (pw) words.push({ key: 'pill', str: pw.str, x: pw.x, w: pw.w, x0: g.pill[0] + g.pill[3] / 2, x1: g.pill[0] + g.pill[2] - g.pill[3] / 2 });
    return { px: cv.px, w: cv.w, h: cv.h, words };
}

/** The data table: the page's right part (x 800..1600), 800 x 482 on the page's background. -> { px, words } (page px). */
/** The camera data's age as a step: '< 1', '1–2', '2–5' or '> 5' (seconds). */
function ageStep(age) { return age < 1 ? '< 1' : age < 2 ? '1–2' : age < 5 ? '2–5' : '> 5'; }

function table(s, o) {
    const opt = o || {};
    const lang = Wd.langOf(opt.lang), night = !!opt.night;
    const P = M.colours('centre', night), g = M.GEO.centre, ox = g.divider;
    const cv = new R.Canvas(PAGE_W - ox, PAGE_H, P.bg), words = [];
    const line = M.mix(P.ink, 0.12, P.bg);
    cv.seg(0.5, 24, 0.5, PAGE_H - 24, 1, line);
    const x0 = g.table[0] - ox, x1 = g.table[1] - ox;
    // fixes-1121 RS: the demo's tag takes the place of "display only" (the table's 14 rows start right under the title)
    const title = Wd.word(lang, 'title'), only = opt.demo ? Wd.word(lang, 'demo') + ' ' + opt.demo : Wd.word(lang, 'viewOnly');
    const tw = cv.text(title, x0, 46, 'av_b26', 26, P.ink, 'left');
    const ow = cv.text(only, x1, 46, 'av_t21', 21, P.dim, 'right');
    words.push({ key: 'title', str: title, x: x0 + ox, w: tw, x0: x0 + ox, x1: x1 - ow - 16 + ox });
    rows(s, opt, lang).forEach((rw, i) => {
        const y = Math.round(ROW0 + i * ROW_STEP);
        const label = Wd.word(lang, rw[0]);
        const lw = cv.text(label, x0, y, 'av_t21', 19, P.dim, 'left');
        const room = x1 - x0 - lw - 24;
        const font = rw[3] ? 'av_b26' : 'av_t21';
        const val = truncate(rw[1], font, 21, room);
        const vw = cv.text(val, x1, y, font, 21, P[rw[2]], 'right');
        words.push({ key: rw[0], str: label, x: x0 + ox, w: lw, x0: x0 + ox, x1: x1 - vw - 24 + ox });
        words.push({ key: rw[0] + ':value', str: val, x: x1 - vw + ox, w: vw, x0: x0 + lw + 24 + ox, x1: x1 + ox });
        cv.seg(x0, y + 9, x1, y + 9, 1, line);
    });
    const foot = Wd.word(lang, 'footer');
    const fs = R.fit(foot, 'av_t16', 16, x1 - x0);
    const fw = cv.text(truncate(foot, 'av_t16', fs, x1 - x0), x0, PAGE_H - 14, 'av_t16', fs, P.dim, 'left');
    words.push({ key: 'footer', str: foot, x: x0 + ox, w: fw, x0: x0 + ox, x1: x1 + ox });
    return { px: cv.px, w: cv.w, h: cv.h, words };
}

/** Copy an opaque w x h RGBA block into the page canvas at (x, y). */
function put(cv, px, w, h, x, y) {
    for (let r = 0; r < h; r++) px.copy(cv.px, ((y + r) * cv.w + x) * 4, r * w * 4, (r + 1) * w * 4);
}

/**
 * The whole centre page in software (the HMI's own image when there is no GPU renderer; the tests and the shots):
 * -> { px, words: [{ key, str, x, w, x0, x1 }] } (words: what was drawn where, for the tests' "inside its box").
 * The GPU path (gpu.js) draws the same band and table as images and the world as the renderer's own shapes.
 */
function centre(s, o) {
    const opt = o || {};
    const night = !!opt.night;
    const P = M.colours('centre', night), g = M.GEO.centre;
    const lead = M.leadPlace(s), C = M.camOf(s);
    const z = typeof opt.z === 'number' ? opt.z : lead ? lead.z : 0;
    // the world: the lanes (the background with the lanes and no car is cached per day / night and lane picture; the gap is
    // computed over it), the road users, the car ahead highlighted, our own car at the foot
    // fixes-1121 RS: our beams are part of the lanes' picture (acc_lane), so the cached background also keys on them
    const bm = M.beamOf(s, night);
    const bk = night + '|' + M.worldKey({ world: s.world ? { lanes: s.world.lanes, objects: [] } : null, camY: C }) + '|' + bm.on + ':' + Math.round(bm.e * 1000);
    if (!BASE.px || BASE.key !== bk) {
        const b = new R.Canvas(PAGE_W, PAGE_H, P.bg);
        lane(b, g, { tgt: null, clo: 0, world: s.world ? { lanes: s.world.lanes } : null, camY: C, beam: s.beam, e: bm.e }, 0, P, 0);
        BASE.px = b.px; BASE.key = bk;
    }
    const cv = new R.Canvas(PAGE_W, PAGE_H, null);
    BASE.px.copy(cv.px);
    if (lead) lane(cv, g, s, z, P, 0, true);
    users(cv, g, s, P.fill, 0, night);
    if (lead) {
        const r = M.carRect(g, z, lead.y);
        cv.sprite(R.sprite(s.clo === 2 ? 'carFast' : 'car'), r[0], r[1], r[2], r[3], night ? (s.clo === 2 ? 0.78 : 0.75) : 1, 1);
        leadLamps(cv, r, M.leadLamp(s, night));
    }
    const er = M.egoRect(g, s);
    cv.sprite(R.sprite('ego'), er[0], er[1], er[2], er[3], night ? 0.75 : 1, 1);
    if (s.warn || (s.beam && s.beam.yield)) cv.dim(0, BAND_H, g.divider, PAGE_H, 0.35, P.bg);
    const bd = band(s, opt), tb = table(s, opt);
    put(cv, bd.px, bd.w, bd.h, 0, 0);
    put(cv, tb.px, tb.w, tb.h, g.divider, 0);
    return { px: cv.px, words: bd.words.concat(tb.words) };
}

/** Where each word of the map's text sheet went (the tests' "inside its box"): [{ key, str, w, x0, x1 }] in sheet px. */
function textSheetWords(s, night, lang) {
    if (!M.adviceShown(s, night)) return [];
    const g = M.GEO.map, cv = new R.Canvas(TEXT_W, TEXT_H, null);
    return adviceBlock(cv, M.colours('map', night), s, g, g.text[0], g.text[1], Wd.langOf(lang), true);
}

module.exports = {
    textSheet, textSheetWords, pillSheet, centre, band, table, BAND_H, lane, users, leadLamps, shape, rows, TEXT_W, TEXT_H, PILL_W, PILL_H, PAGE_W, PAGE_H, truncate,
    sign, lampIcon, adviceKey, reasonText, lampsText, signRole, adviceBlock,
};
