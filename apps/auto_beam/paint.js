'use strict';
/**
 * paint.js - Auto Beam's pictures in software (round "Auto Beam", package HD). Pure: a view state in, RGBA pixels out. Every
 * word comes from shared/i18n through words.js, in the atlases hud/fonts/ab_*.json.
 *
 *   sign(cv, cx, cy, s, col, high, badgeCol)   OUR OWN drawing of the generic headlamp-with-rays idea: a lamp body (round
 *                                  side right, flat side left) and five rays left of it, level for high, slanted down for low;
 *                                  an "A" in a small ring says the advice is automatic. Lines, no fills (it reads on the HUD too).
 *   band(v, o)      the centre page's top-left band (800 x 176): the sign, the advice, the reason, the driver's lamps
 *   table(v, o)     the centre page's right half (800 x 482): the data table (slow values only; dyn() has the fast ones)
 *   dyn(v, o)       the values that change by the second (speed, brightness, the agreement %): [{ key, str, x, y, size, role }] in page px,
 *                   drawn as GPU text on the GPU page (never in a large image) and by our atlases here
 *   scene(cv, g, ox, oy, v, e, night)   direction A: the road from behind our car, both cones (e: the high beam's extent,
 *                   0 folded .. 1 out), the lights ahead by class (the cause ringed), our car at the foot. The same field as
 *                   the map's ab_road / ab_lights shaders and the GPU page's strips.
 *   textSheet(v, night, lang)   the map target's text sheet (420 x 112): the sign, the advice, the reason, the lamps
 *   centre(v, o)    the whole centre page in software (the HMI's own image when there is no GPU renderer; the tests)
 *
 * Colour rules (bench/test-auto-beam.js checks every state, day and night): blue only while high is advised (the sign and
 * its advice line), amber only for the disagreement (dip advised, the high beam lit), no red anywhere, nothing flashes.
 */
const V = require('./view');
const R = require('./raster');
const Wd = require('./words');
const C = require('./contract');


const PAGE_W = V.GEO.centre.w, PAGE_H = V.GEO.centre.h;
const BAND_W = V.GEO.centre.band[2], BAND_H = V.GEO.centre.band[3];
const TEXT_W = V.GEO.map.text[2], TEXT_H = V.GEO.map.text[3];

function truncate(str, font, size, maxW) {
    let s = String(str);
    if (R.textWidth(s, font, size) <= maxW) return s;
    while (s.length > 1 && R.textWidth(s + '…', font, size) > maxW) s = s.slice(0, -1);
    return s + '…';
}

/* ------------------------------------------------------------------------------------------------ the sign */
function sign(cv, cx, cy, s, col, high, badgeCol, alpha) {
    const u = s / 50, w = 5 * u, al = alpha === undefined ? 1 : alpha;
    const bx = cx + 8 * u, br = 26 * u, flat = cx - 6 * u;
    // the lamp body: a circle cut by a vertical flat side
    cv.sdf(flat - w, cy - br - w, bx + br + w, cy + br + w, col, al, (x, y) => {
        const d = Math.sqrt((x - bx) * (x - bx) + (y - cy) * (y - cy)) - br;
        return Math.max(d, flat - x);
    }, w);
    // the rays: level (high) or slanted down (low)
    for (let i = -2; i <= 2; i++) {
        const y0 = cy + i * 9 * u, x0 = cx - 15 * u, x1 = cx - 45 * u;
        cv.seg(x0, y0, x1, y0 + (high ? 0 : 11 * u), w, col);
    }
    // "A": automatic advice
    if (badgeCol) {
        const ax = cx + 34 * u, ay = cy + 27 * u, ar = 11 * u;
        cv.sdf(ax - ar - w, ay - ar - w, ax + ar + w, ay + ar + w, badgeCol, al, (x, y) => Math.sqrt((x - ax) * (x - ax) + (y - ay) * (y - ay)) - ar, 2.6 * u);
        const fs = 15 * u;
        cv.text('A', ax, ay + fs * 0.36, 'ab_b22', fs, badgeCol, 'center', al);
    }
}

/** The small lamp pictogram before the lamps line (the same drawing, small). */
function lampIcon(cv, x, y, h, col, lamps) {
    const s = h / 1.1;
    sign(cv, x + s * 0.9, y, s, col, lamps === 'high' || lamps === 'flash', null);
}

/** The advice line's key: high now, dip now, or low (a standby advice / no advice). */
function adviceKey(v) {
    if (v.data !== 'ok' || v.state === 'UNAVAILABLE') return 'beam.adv.low';
    if (v.adv === 'high' && v.go) return 'beam.adv.high';
    // "dip now" only for a light ahead (or the camera's no), not for a held low (a curve, the countdown) or a standby
    return v.go && !v.countdown && v.trigger ? 'beam.adv.dip' : 'beam.adv.low';
}
/** The reason line: the countdown first while the return to high counts down. */
function reasonText(v, lang) {
    const W = (k, x) => Wd.word(lang, k, x);
    const r = W(C.REASON_KEY(v.reason));
    if (v.countdown) return W('beam.return', { s: v.countdown }) + ' · ' + r;
    return r;
}
function lampsText(v, lang) {
    const W = (k) => Wd.word(lang, k);
    return W('beam.lamps') + ': ' + W(v.lamps ? 'beam.lamps.' + v.lamps : 'beam.lamps.unknown');
}

/* ------------------------------------------------------------------------------------------------ the band (centre) */
function band(v, o) {
    const opt = o || {};
    const lang = Wd.langOf(opt.lang), night = !!opt.night;
    const P = V.colours('centre', night), g = V.GEO.centre;
    const cv = new R.Canvas(BAND_W, BAND_H, P.bg), words = [];
    const role = V.signRole(v), sc = P[role];
    const al = v.yield ? 0.35 : 1;
    sign(cv, g.sign[0], g.sign[1], g.sign[2], sc, v.adv === 'high' && v.go, role === 'blue' ? P.blue : P.dim, al);
    const x0 = g.reasonX, maxW = BAND_W - x0 - 24;
    const adv = Wd.word(lang, adviceKey(v));
    const aw = cv.text(adv, x0, 64, 'ab_b34', R.fit(adv, 'ab_b34', 34, maxW), role === 'blue' ? P.blue : role === 'faint' ? P.dim : P.ink, 'left', al);
    words.push({ key: 'advice', str: adv, x: x0, w: aw, x0, x1: x0 + maxW });
    const rs = v.yield ? Wd.word(lang, 'beam.yield') : reasonText(v, lang);
    const rsz = R.fit(rs, 'ab_t26', 26, maxW);
    const rw = cv.text(truncate(rs, 'ab_t26', rsz, maxW), x0, 106, 'ab_t26', rsz, v.yield ? P.ink : P.dim, 'left');
    words.push({ key: 'reason', str: rs, x: x0, w: rw, x0, x1: x0 + maxW });
    const lc = v.disagree ? P.amber : P.dim;
    lampIcon(cv, x0, 140, 15, lc, v.lamps);
    const lt = lampsText(v, lang);
    const lw = cv.text(lt, x0 + 44, 148, 'ab_t21', 21, lc, 'left', al);
    words.push({ key: 'lamps', str: lt, x: x0 + 44, w: lw, x0: x0 + 44, x1: x0 + maxW });
    return { px: cv.px, w: cv.w, h: cv.h, words };
}

/* ------------------------------------------------------------------------------------------------ the table (centre) */
const ROW0 = 88, ROW_STEP = 31;

/** [labelKey, value, role, dynKey]: dynKey rows leave their value to dyn() (it changes by the second). */
function rows(v, o, lang) {
    const W = (k, x) => Wd.word(lang, k, x);
    const out = [];
    out.push(['beam.row.state', W(C.STATE_KEY[v.state] || 'beam.state.unavailable'), v.state === 'UNAVAILABLE' ? 'dim' : 'ink']);
    out.push(['beam.row.reason', reasonText(v, lang), 'ink']);
    const cause = (v.lights || []).filter((l) => l.ringed)[0];
    out.push(['beam.row.cause', cause ? W('beam.cls.' + (KIND_ROLE[cause.kind] ? cause.kind : 'other')) + ' #' + cause.id : W('beam.cause.none'), cause ? 'ink' : 'dim']);
    out.push(['beam.row.src', W(v.src === 'light' ? 'beam.src.light' : v.src === 'object' ? 'beam.src.object' : 'beam.src.none'), v.src ? 'ink' : 'dim']);
    const vd = v.verdict;
    let vt = vd ? (vd.allow === true ? W('beam.verdict.allow') : vd.allow === false ? W('beam.verdict.dip') : W('beam.verdict.unknown')) : W('beam.verdict.none');
    if (vd && typeof vd.vehicles === 'number') vt += ' · ' + vd.vehicles + '/' + (vd.signs || 0) + '/' + (vd.pedestrians || 0);
    if (vd && vd.use !== 'follow') vt = W('beam.verdict.log', { v: vt });
    out.push(['beam.row.verdict', vt, vd ? 'ink' : 'dim']);
    out.push(['beam.row.lamps', W(v.lamps ? 'beam.lamps.' + v.lamps : 'beam.lamps.unknown'), v.disagree ? 'amber' : v.lamps ? 'ink' : 'dim']);
    out.push(['beam.row.town', v.town === 'sign' ? W('beam.town.sign') : v.town === 'limit' ? W('beam.town.limit', { v: v.limit || '' }) : W('beam.town.none'), v.town ? 'ink' : 'dim']);
    out.push(['beam.row.speed', W('beam.kmh'), 'dim', 'speed']);
    out.push(['beam.row.bright', W('beam.raw'), 'dim', 'bright']);
    const sc = v.score;
    const has = sc && sc.agreePct !== null && sc.agreePct !== undefined;
    out.push(['beam.row.score', has ? '%' : W('beam.score.none'), 'dim', has ? 'score' : undefined]);
    out.push(['beam.row.events', sc ? W('beam.score.events', { early: sc.early, late: sc.late, missed: sc.missed }) : '—', sc ? 'ink' : 'dim']);
    out.push(['beam.row.act', v.act ? W('beam.act.would', { to: W('beam.lamps.' + v.act) }) : W('beam.act.none'), 'dim']);
    return out;
}

function table(v, o) {
    const opt = o || {};
    const lang = Wd.langOf(opt.lang), night = !!opt.night;
    const P = V.colours('centre', night), g = V.GEO.centre, ox = g.divider;
    const cv = new R.Canvas(PAGE_W - ox, PAGE_H, P.bg), words = [];
    const line = V.mix(P.ink, 0.12, P.bg);
    cv.seg(0.5, 24, 0.5, PAGE_H - 24, 1, line);
    const x0 = g.table[0] - ox, x1 = g.table[1] - ox;
    const title = Wd.word(lang, 'beam.title'), tag = opt.demo ? Wd.word(lang, 'beam.demo') + ' ' + opt.demo : Wd.word(lang, 'beam.advisor');
    const tw = cv.text(title, x0, 50, 'ab_b34', 30, P.ink, 'left');
    const gw = cv.text(tag, x1, 50, 'ab_t21', 21, P.dim, 'right');
    words.push({ key: 'title', str: title, x: x0 + ox, w: tw, x0: x0 + ox, x1: x1 - gw - 16 + ox });
    rows(v, opt, lang).forEach((rw, i) => {
        const y = ROW0 + i * ROW_STEP;
        const label = Wd.word(lang, rw[0]);
        const lw = cv.text(label, x0, y, 'ab_t21', 21, P.dim, 'left');
        const room = x1 - x0 - lw - 24 - (rw[3] ? 90 : 0);
        const val = truncate(rw[1], 'ab_t26', 24, room);
        const vw = cv.text(val, x1, y, 'ab_t26', 24, P[rw[2]], 'right');
        words.push({ key: rw[0], str: label, x: x0 + ox, w: lw, x0: x0 + ox, x1: x1 - vw - 24 + ox - (rw[3] ? 90 : 0) });
        words.push({ key: rw[0] + ':value', str: val, x: x1 - vw + ox, w: vw, x0: x0 + lw + 24 + ox, x1: x1 + ox });
        cv.seg(x0, y + 12, x1, y + 12, 1, line);
    });
    const foot = Wd.word(lang, 'beam.footer') + (v.standIn ? ' · ' + Wd.word(lang, 'beam.standin') : '');
    const fs = R.fit(foot, 'ab_t16', 16, x1 - x0);
    const fw = cv.text(truncate(foot, 'ab_t16', fs, x1 - x0), x0, PAGE_H - 16, 'ab_t16', fs, P.dim, 'left');
    words.push({ key: 'footer', str: foot, x: x0 + ox, w: fw, x0: x0 + ox, x1: x1 + ox });
    return { px: cv.px, w: cv.w, h: cv.h, words };
}

/** The fast values: page px (the right edge of their room, the baseline). */
function dyn(v, o) {
    const g = V.GEO.centre, opt = o || {};
    const lang = Wd.langOf(opt.lang);
    const out = [];
    const list = rows(v, opt, lang);
    list.forEach((rw, i) => {
        if (!rw[3]) return;
        const unitW = R.textWidth(rw[1], 'ab_t26', 24);
        const val = rw[3] === 'speed' ? (v.speed === null ? '–' : String(Math.round(v.speed))) : rw[3] === 'score' ? String(v.score.agreePct) : (v.bright === null ? '–' : String(Math.round(v.bright)));
        out.push({ key: rw[3], str: val, x: g.table[1] - unitW - 10, y: ROW0 + i * ROW_STEP, size: 24, role: 'ink' });
    });
    return out;
}

/* ------------------------------------------------------------------------------------------------ the scene (direction A) */
const sstep = V.sstep;

/** The road and both cones at one pixel of the scene box (px, py in the box): straight RGBA 0..1 [r, g, b, a]. */
function field(g, px, py, e, curve, P) {
    const W = g.scene[2], H = g.scene[3], hy = V.HZ * H;
    const t = (py - hy) / (H - hy);
    if (t <= 0) return null;
    const z = (1 / t - 1) / V.KF, xm = z * V.RANGE - V.EGO_X, k = g.pxm * t;
    const yb = (0.5 * W - px) / k;                                  // m left of our heading (the cones follow the car)
    const yr = yb + 0.5 * curve * Math.max(0, xm) * Math.max(0, xm);   // the road's own frame (it bends away in a curve)
    const fade = 1 - sstep(0.55, 1, z), aa = 1 / k;
    const edgeIn = sstep(-2.6 - aa, -2.6 + aa, yr) * (1 - sstep(6.1 - aa, 6.1 + aa, yr));
    let a = 0.92 * edgeIn * fade;
    let r = P.road[0] / 255, gg = P.road[1] / 255, b = P.road[2] / 255;
    // the markings: the edge lines at -2.3 and 5.8 m (solid), the centre at 1.75 m (dashed 6 / 6 m)
    const lw = Math.max(0.12, 1.2 / k);
    const line = (y0) => 1 - sstep(lw * 0.5 - aa * 0.7, lw * 0.5 + aa * 0.7, Math.abs(yr - y0));
    const dash = (xm + 3) / 12 - Math.floor((xm + 3) / 12) < 0.5 ? 1 : 0;
    const mk = Math.max(line(-2.3), line(5.8), line(1.75) * dash) * fade * (xm > -V.EGO_X ? 1 : 0);
    const ec = P.edge;
    r += (ec[0] / 255 - r) * mk; gg += (ec[1] / 255 - gg) * mk; b += (ec[2] / 255 - b) * mk; a = Math.max(a, mk);
    // the light: both cones in the car's own frame
    const B = V.beamAt(xm, e, false);
    const lowK = B.low * (1 - sstep(0.6 * B.lowW, B.lowW, Math.abs(yb)));
    const highK = B.high * (1 - sstep(0.45 * B.highW, B.highW, Math.abs(yb)));
    const lk = Math.min(1, lowK + highK) * fade;
    const bc = P.beam;
    r += (bc[0] / 255 - r) * lk; gg += (bc[1] / 255 - gg) * lk; b += (bc[2] / 255 - b) * lk; a = Math.max(a, lk);
    return [r, gg, b, a];
}

/** Our car seen from behind, standing at the foot: its rear x = -4.6 m (boxes in the scene box's px). */
function carBoxes(g) {
    const p = V.project(g, -4.6, 0, 0);
    const k = p.k;
    return { cx: p.px, foot: p.py, body: [p.px - 0.9 * k, p.py - 0.78 * k, 1.8 * k, 0.70 * k], cabin: [p.px - 0.66 * k, p.py - 1.32 * k, 1.32 * k, 0.58 * k], band: [p.px - 0.82 * k, p.py - 0.62 * k, 1.64 * k, 0.12 * k], k };
}

/** A light's place: the ground point lifted by its height; its pair's half spacing and its lamp radius (px). */
function lightPlace(g, l, curve) {
    const p = V.project(g, l.x, l.y, curve);
    const h = V.HEIGHT[l.kind] || 1;
    const r = Math.max(1.6, Math.min(7, 0.16 * p.k + 1.2));
    const lift = Math.min(h * p.k, Math.max(0, p.py - 4 * r));         // a tall street light stays inside the box
    return { px: p.px, py: p.py - lift, hs: (V.PAIR[l.kind] || 0) / 2 * p.k, r, k: p.k };
}
const KIND_ROLE = { head: 'onc', tail: 'tail', street: 'street', bike: 'onc', reflector: 'other', other: 'other' };

function scene(cv, g, ox, oy, v, e, night) {
    const P = V.colours(g === V.GEO.centre ? 'centre' : 'map', night);
    const W = g.scene[2], H = g.scene[3], curve = v.curve || 0;
    const col = [0, 0, 0];
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const f = field(g, x + 0.5, y + 0.5, e, curve, P);
            if (!f || f[3] <= 0.003) continue;
            col[0] = R.clamp01(f[0]) * 255; col[1] = R.clamp01(f[1]) * 255; col[2] = R.clamp01(f[2]) * 255;
            cv.put(((oy + y) * cv.w + ox + x) * 4, col, f[3]);
        }
    }
    // the lights ahead: far first; a soft glow and the lamp(s); the cause ringed
    (v.lights || []).slice().sort((a, b) => b.x - a.x).forEach((l) => {
        if (l.x < 0 || l.x > V.RANGE - V.EGO_X) return;
        const q = lightPlace(g, l, curve), c = P[KIND_ROLE[l.kind] || 'other'];
        const pts = q.hs > 0.8 ? [-q.hs, q.hs] : [0];
        pts.forEach((dx) => {
            const cx = ox + q.px + dx, cy = oy + q.py;
            cv.rrect(cx - q.r * 3, cy - q.r * 3, cx + q.r * 3, cy + q.r * 3, q.r * 3, c, 0, 0.16);
            cv.rrect(cx - q.r, cy - q.r, cx + q.r, cy + q.r, q.r, c, 0, 1);
        });
        if (l.ringed) {
            const rr = Math.max(q.hs + q.r * 3, q.r * 5, 9);
            cv.rrect(ox + q.px - rr, oy + q.py - rr, ox + q.px + rr, oy + q.py + rr, rr, P.ink, 1.6, 0.85);
        }
    });
    // our car at the foot
    const cb = carBoxes(g);
    const box = (b, c, r, a) => cv.rrect(ox + b[0], oy + b[1], ox + b[0] + b[2], oy + b[1] + b[3], r, c, 0, a === undefined ? 1 : a);
    cv.rrect(ox + cb.cx - 1.0 * cb.k, oy + cb.foot - 0.12 * cb.k, ox + cb.cx + 1.0 * cb.k, oy + cb.foot + 0.06 * cb.k, 0.08 * cb.k, [0, 0, 0], 0, 0.45);
    box(cb.cabin, P.car, 0.22 * cb.k);
    box([cb.cabin[0] + 0.1 * cb.k, cb.cabin[1] + 0.1 * cb.k, cb.cabin[2] - 0.2 * cb.k, cb.cabin[3] - 0.16 * cb.k], V.mix(P.road, 0.5, P.car), 0.14 * cb.k);
    box(cb.body, P.car, 0.16 * cb.k);
    box(cb.band, V.mix(P.carHi, 0.5, P.car), 0.05 * cb.k);
    cv.rrect(ox + cb.cabin[0] + 0.2 * cb.k, oy + cb.cabin[1] - 0.5, ox + cb.cabin[0] + cb.cabin[2] - 0.2 * cb.k, oy + cb.cabin[1] + 1.5, 1, P.carHi, 0, 0.8);
}

/* ------------------------------------------------------------------------------------------------ the map's text sheet */
function textSheet(v, night, lang) {
    const P = V.colours('map', night), g = V.GEO.map, ox = g.text[0], oy = g.text[1];
    const L = Wd.langOf(lang);
    const cv = new R.Canvas(TEXT_W, TEXT_H, null);
    const role = V.signRole(v), sc = P[role];
    sign(cv, g.sign[0] - ox, g.sign[1] - oy, g.sign[2], sc, v.adv === 'high' && v.go, role === 'blue' ? P.blue : P.dim);
    const x0 = g.reasonX - ox, maxW = TEXT_W - x0 - 8;
    const adv = Wd.word(L, adviceKey(v));
    cv.text(adv, x0, 36, 'ab_b22', R.fit(adv, 'ab_b22', 22, maxW), role === 'blue' ? P.blue : role === 'faint' ? P.dim : P.ink, 'left');
    const rs = reasonText(v, L);
    const rsz = R.fit(rs, 'ab_t21', 21, maxW);
    cv.text(truncate(rs, 'ab_t21', rsz, maxW), x0, 66, 'ab_t21', rsz, P.dim, 'left');
    const lc = v.disagree ? P.amber : P.dim;
    lampIcon(cv, x0, 90, 11, lc, v.lamps);
    cv.text(lampsText(v, L), x0 + 32, 96, 'ab_t16', 16, lc, 'left');
    return cv.px;
}

/** Where each map word went (the tests' "inside its box"): [{ key, str, w, x0, x1 }] in sheet px. */
function textSheetWords(v, lang) {
    const g = V.GEO.map, ox = g.text[0], L = Wd.langOf(lang), x0 = g.reasonX - ox, maxW = TEXT_W - x0 - 8;
    const adv = Wd.word(L, adviceKey(v)), rs = reasonText(v, L), lt = lampsText(v, L);
    const aS = R.fit(adv, 'ab_b22', 22, maxW), rS = R.fit(rs, 'ab_t21', 21, maxW);
    return [
        { key: 'advice', str: adv, w: R.textWidth(adv, 'ab_b22', aS), x0, x1: x0 + maxW },
        { key: 'reason', str: rs, w: R.textWidth(truncate(rs, 'ab_t21', rS, maxW), 'ab_t21', rS), x0, x1: x0 + maxW, cut: truncate(rs, 'ab_t21', rS, maxW) !== rs },
        { key: 'lamps', str: lt, w: R.textWidth(lt, 'ab_t16', 16), x0: x0 + 32, x1: x0 + maxW },
    ];
}

/* ------------------------------------------------------------------------------------------------ the whole centre page */
function put(cv, px, w, h, x, y) {
    for (let r = 0; r < h; r++) px.copy(cv.px, ((y + r) * cv.w + x) * 4, r * w * 4, (r + 1) * w * 4);
}

function centre(v, o) {
    const opt = o || {};
    const night = !!opt.night, lang = Wd.langOf(opt.lang);
    const P = V.colours('centre', night), g = V.GEO.centre;
    const e = typeof opt.e === 'number' ? opt.e : V.extentOf(v);
    const cv = new R.Canvas(PAGE_W, PAGE_H, P.bg);
    scene(cv, g, g.scene[0], g.scene[1], v, e, night);
    if (v.yield) cv.dim(0, BAND_H, g.divider, PAGE_H, 0.35, P.bg);
    const bd = band(v, opt), tb = table(v, opt);
    put(cv, bd.px, bd.w, bd.h, 0, 0);
    put(cv, tb.px, tb.w, tb.h, g.divider, 0);
    const words = bd.words.concat(tb.words);
    dyn(v, opt).forEach((d) => {
        const w = cv.text(d.str, d.x, d.y, 'ab_t26', d.size, P[d.role], 'right');
        words.push({ key: d.key + ':dyn', str: d.str, x: d.x - w, w, x0: g.divider + 100, x1: d.x });
    });
    return { px: cv.px, words, lang };
}

module.exports = { sign, band, table, rows, dyn, scene, field, carBoxes, lightPlace, textSheet, textSheetWords, centre, adviceKey, reasonText, lampsText, KIND_ROLE, PAGE_W, PAGE_H, BAND_W, BAND_H, TEXT_W, TEXT_H, truncate };
