'use strict';
/**
 * twin_limit.js - Twin Dial's speed limit and cruise (docs/twin-dial/SPEC-R3.md section 8 and 9; round 3 build, package B5).
 *
 * What it draws and how the engine (shared/hud.js) reaches it. Every hook in hud.js is a small block marked "twin_dial:";
 * nothing of f30_cluster's path changes (only twin_dial packs this file; hud.js requires it the way it requires
 * twin_tokens.js).
 *
 *   wire(hud, extra)      _setupVehicleData, after the bottom row's own watch of config.sign: this file chains BEHIND it
 *                         (the engine's signOf / config.sign are used as they are: hud.sign is the engine's reading) and
 *                         declares the cruise field's handler (read only). One "limit:" log line per change, numbers and
 *                         enum names only.
 *   tdsign   widget       the sign (SPEC 8 a): an image sheet 96 x 88 on connection 2, painted here (ring, disc, figure,
 *                         dashes, derestriction stripes, the conditional dot). NOT a "cc:" widget: nothing about a message
 *                         or BMW's window touches it, so it stays when the fallback window opens.
 *   tdcru    widget       the cruise / limiter readout (SPEC 9), built only while config.cruise is set (toggle "tl:cruise").
 *   dial(hud, x)          _twinDialUpdate: the markers. Sets hud.twinLim / hud.twinCru and calls B1's hud._twinMarks() (B1's
 *                         contract); alone, sends u_lim / u_cru to the speedometer when its shader has them.
 *   toggle(hud, name)     _toggleOn: "tl:cruise" (config.cruise is set), "tl:cruise:C1" (and its place is C1).
 *
 * The decisions that are the lead's, not the car's, are config keys: config.limit.strip "L1" | "L2" | "L3" | "off"
 * (the strip red from the limit: the shader's mode), config.cruise null (dark) or { place: "C1" | "C2", ... }.
 *
 * car-fix CF2 (the car session of 2026-11-18): the sign's field never arrives; the limit comes as the TrafficSignRecognition
 * event, which hud.js reads through shared/limit_src.js into the same hud.sign (so wire() also chains behind that event), and
 * the cruise / limiter come from DisplayDataServer.functionalLibraryData (ldmSym, ldmSymColor, cruiseCtrlSpeedHUD: decoded
 * by limit_src.hudCruiseOf). That reading wins once it has arrived; the TrafficSignDisplayControl struct below stays the
 * fallback (declared, logged, never seen on the owner's car).
 *
 * The cruise struct is UNSEEN on the car (SPEC 9: after probe). Its member and enum names below are the catalogue's
 * (reference/car/2026-11-15/someip/someip-interfaces.json, DisplayDriverAssistanceLongitudinalStruct); WHAT each value
 * means on the car (which enum is the plain cruise, which the adaptive one; the unit flag's sense; the speed's scale)
 * is a hypothesis, each one a key of config.cruise, so the car session corrects a line, not the code.
 *
 * Plain Node 8 (the car's 8.16): no ?. / ?? / object spread. Nothing here throws into the engine (every entry is wrapped),
 * and nothing here logs more than numbers, enum names and lengths.
 */
const textRaster = require('./hud_text');
const I = require('./lang');          // r1120 LN: the cruise readout's unit from shared/i18n/<lang>.json
const { paintIcon, ICONS } = require('./icons');
// car-fix CF2: the real sources (the TrafficSignRecognition event for the sign, DisplayDataServer for cruise / limiter)
let src = null;
try { src = require('./limit_src'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND' || String(e.message).indexOf('limit_src') < 0) throw e; }

const isNum = (x) => typeof x === 'number' && isFinite(x);
const IF = 'de.bmw.dass.driverassistanceapplications.TrafficSignDisplayControl';
const FIELD = 'displayDriverAssistanceLongitudinal';

/* ---------------------------------------------------------------- geometry ---------------------------------------- */

/** SPEC 8 (a): the sign's disc and its sheet. The sheet is centred on the disc; the dot of a conditional limit sits under it. */
const SIGN = { cx: 1300, cy: 672, r: 33, ring: 7.6, w: 96, h: 88 };
SIGN.x = SIGN.cx - SIGN.w / 2; SIGN.y = SIGN.cy - SIGN.h / 2;
/** The sign's colours (sRGB codes; the ring is the mockups' red, the same family as the marker's). */
const COL = { red: [214, 13, 18], white: [250, 250, 250], ink: [0, 0, 0], derestrict: [100, 100, 100], derestrictRing: [150, 150, 150] };
/** The sign's shape numbers. */
const SHAPE = { dash: [8.4, 4.2], dashPitch: 11.5, digitH: 26, digitMaxW: 42.4, bold: 0.55, dotR: 3, dotDy: 38.5, stripes: 5, stripePitch: 6.4, stripeW: 1.9 };

/** SPEC 9: the readout in the speedometer's lower opening. Sheets in panel px; every position in the sheet's own px below. */
const CRU = {
    C1: { x: 1456, y: 500, w: 140, h: 70, numRight: 1536, numBase: 540, unitRight: 1536, unitBase: 560, sym: [1572, 528], symSize: 36, numPx: 40 },
    // C2 (the coolant bar's place, y 590-650, x 1470-1650, clear of the gear gap): MY layout, a hypothesis - the numbers are
    // not in the spec, only the box; the picture is the mockup round's
    C2: { x: 1466, y: 588, w: 188, h: 64, numRight: 1594, numBase: 632, unitRight: 1650, unitBase: 632, sym: [1490, 620], symSize: 36, numPx: 40, row: true },
};
const GREEN = [60, 155, 34];
const GREY = [227, 227, 227];

/* ---------------------------------------------------------------- the laws ---------------------------------------- */

/** SPEC 5.2 / 8: the speedometer's angle at `kmh` (degrees clockwise from 12 o'clock): -125 + 1.25 a km/h up to 100, + 0.625 a km/h above. */
function angleOf(kmh, mi) {
    if (!isNum(kmh)) return null;
    const v = Math.max(0, kmh);
    if (mi) {           // r1120 PS: the mph face (tools/twin-dial/bake_face.py MPH): 0..60 mph to 12 o'clock, then 60..180 to +125
        const m = v * 0.621371;
        return Math.min(125, m <= 60 ? -125 + 125 * m / 60 : 125 * (m - 60) / 120);
    }
    return Math.min(125, v <= 100 ? -125 + 1.25 * v : 0.625 * (v - 100));
}

/** The strip's mode as the shader reads it (u_lim.w): 0 off, 1 = L1, 2 = L2, 3 = L3. */
const STRIP = { off: 0, L1: 1, L2: 2, L3: 3 };
/** u_lim.y: what the marker is. 2 (conditional) is drawn hollow and starts no red strip. */
const LIM_STATE = { none: 0, limit: 1, conditional: 2 };
/** u_cru.y */
const CRU_STATE = { none: 0, active: 1 };

/**
 * The sign as the display shows it (a pure reading of the engine's signOf result: hud.sign).
 *   { kind: 'none' | 'limit' | 'unknown' | 'end', shown (the number as the car gives it, mph included), unit, kmh, cond, warn }
 * none: nothing received or invalidFlag. unknown: 254 / 255 or no unit. end: 0. cond: a supplemental sign other than none.
 */
function displayOf(s) {
    const none = { kind: 'none', shown: null, unit: null, kmh: null, cond: false, warn: 0 };
    if (!s || typeof s !== 'object') return none;
    const warn = s.warn === 1 || s.warn === 2 ? s.warn : 0;
    if (s.state === 'limit' && isNum(s.kmh) && isNum(s.shown)) {
        return { kind: 'limit', shown: Math.round(s.shown), unit: s.unit === 'mph' ? 'mph' : 'kmh', kmh: s.kmh, cond: !!s.supp, warn };
    }
    if (s.state === 'unknown') return { kind: 'unknown', shown: null, unit: null, kmh: null, cond: false, warn: 0 };
    if (s.state === 'end') return { kind: 'end', shown: null, unit: null, kmh: null, cond: false, warn: 0 };
    return none;
}

/** u_lim for a display: [angle in degrees, state, warn level, strip mode]. No limit: [0, 0, 0, mode]. */
function limUniform(d, strip, mi) {
    const mode = STRIP.hasOwnProperty(strip) ? STRIP[strip] : STRIP.L1;
    if (!d || d.kind !== 'limit') return [0, LIM_STATE.none, 0, mode];
    const a = angleOf(d.kmh, mi);
    if (a === null) return [0, LIM_STATE.none, 0, mode];
    return [Math.round(a * 100) / 100, d.cond ? LIM_STATE.conditional : LIM_STATE.limit, d.warn, mode];
}

/** u_cru for a cruise reading: [angle, state, 0, 0]. Only an active function with a valid speed has a marker (SPEC 9: standby none). */
function cruUniform(c, mi) {
    if (!c || c.status !== 'active' || !isNum(c.kmh)) return [0, CRU_STATE.none, 0, 0];
    const a = angleOf(c.kmh, mi);
    return a === null ? [0, CRU_STATE.none, 0, 0] : [Math.round(a * 100) / 100, CRU_STATE.active, 0, 0];
}

/* ---------------------------------------------------------------- the cruise struct -------------------------------- */

/** The catalogue's names for DisplayDriverAssistanceLongitudinalStruct, with what each value MEANS as a hypothesis. */
const CRUISE_DEFAULT = {
    invalidPath: ['invalidFlag'], invalidOn: [1, true],
    // ActiveFuncLongitudinalEnum: 0 none, 1 XCC (the family of the cruise functions), 2 HDC (hill descent: not drawn), 3 SLD (the limiter)
    funcPath: ['activeFuncLongitudinal'],
    funcMap: { KEINE_LAENGSDYNAMIKFUNKTION_AKTIV: null, 0: null, XCC_AKTIV: 'cruise', 1: 'cruise', HDC_AKTIV: null, 2: null, SLD_AKTIV: 'limiter', 3: 'limiter' },
    // DispXCCStatusEnum: 1 DISP_ACC turns the cruise into the adaptive one
    accPath: ['dispXCC', 'dispXCCStatus'], accOn: ['DISP_ACC', 1],
    // DispRequestedSpeedEnum: 0 none, 1 standby, 2 active
    statusPath: ['dispRequestedSpeed', 'dispRequestedSpeedStatus'],
    statusMap: { NO_DISP_OF_REQUESTED_SPEED: 'off', 0: 'off', DISP_OF_REQUESTED_SPEED_STANDBY: 'standby', 1: 'standby', DISP_OF_REQUESTED_SPEED_ACTIVE: 'active', 2: 'active' },
    // DispSLDEnum: the limiter's own status, used when the requested-speed status says nothing
    sldPath: ['dispSLD', 'dispSLDStatus'],
    sldMap: { SLD_OFF: 'off', 0: 'off', SLD_STANDBY: 'standby', 1: 'standby', SLD_ACTIVE: 'active', 2: 'active' },
    speedPath: ['valueRequestedSpeed'], factor: 1, min: 5, max: 300, invalid: [0, 255, 65535],
    unitPath: ['dispRequestedSpeed', 'unitOfRequestedSpeedValue'], mphOn: [true, 1],       // hypothesis: true = mph
    place: 'C1',
    icons: { cruise: 'td_cruise', acc: 'td_cruise_acc', limiter: 'td_limiter' },       // B6's pictograms (design/twin-dial/vt/pictograms.js)
};

const pick = (v, path) => { let r = v; (Array.isArray(path) ? path : []).forEach((k) => { r = r === null || r === undefined ? r : r[k]; }); return r; };
const inList = (a, x) => Array.isArray(a) && a.indexOf(x) >= 0;
const mapped = (map, raw) => (map && raw !== undefined && raw !== null && map.hasOwnProperty(String(raw)) ? map[String(raw)] : undefined);

/** The cruise config: the defaults with the keys config.cruise names (a shallow overlay: a map named replaces the default map). */
function cruiseCfg(config) {
    const c = config && config.cruise && typeof config.cruise === 'object' ? config.cruise : {};
    const out = Object.assign({}, CRUISE_DEFAULT);
    Object.keys(c).forEach((k) => { if (c[k] !== undefined) out[k] = c[k]; });
    return out;
}

/**
 * The struct as a reading: { kind: 'cruise' | 'acc' | 'limiter' | null, status: 'off' | 'standby' | 'active', shown, unit, kmh }.
 * Pure; undefined members give 'off'. `shown` is the car's number as the car gives it, kmh the speed in km/h (null: not valid).
 */
function cruiseOf(cfg, v) {
    const off = { kind: null, status: 'off', shown: null, unit: null, kmh: null };
    if (!cfg || v === undefined || v === null || typeof v !== 'object') return off;
    if (cfg.invalidPath && inList(cfg.invalidOn, pick(v, cfg.invalidPath))) return off;
    let kind = mapped(cfg.funcMap, pick(v, cfg.funcPath));
    if (!kind) return off;
    if (kind === 'cruise' && inList(cfg.accOn, pick(v, cfg.accPath))) kind = 'acc';
    let status = mapped(cfg.statusMap, pick(v, cfg.statusPath));
    if ((status === undefined || status === 'off') && kind === 'limiter') status = mapped(cfg.sldMap, pick(v, cfg.sldPath));
    if (status !== 'standby' && status !== 'active') return off;
    const out = { kind, status, shown: null, unit: null, kmh: null };
    let raw = pick(v, cfg.speedPath);
    if (typeof raw === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(raw)) raw = Number(raw);
    const mph = cfg.unitPath ? inList(cfg.mphOn, pick(v, cfg.unitPath)) : false;
    out.unit = mph ? 'mph' : 'kmh';
    if (!isNum(raw) || inList(cfg.invalid, raw)) return out;
    const shown = raw * (isNum(cfg.factor) ? cfg.factor : 1);
    const kmh = mph ? shown * 1.609344 : shown;
    if (kmh >= (isNum(cfg.min) ? cfg.min : 5) && kmh <= (isNum(cfg.max) ? cfg.max : 300)) { out.shown = Math.round(shown); out.kmh = kmh; }
    return out;
}

/* ---------------------------------------------------------------- pixels ------------------------------------------ */

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Coverage of an edge at signed distance d (negative inside), one pixel wide. */
const cov = (d) => clamp01(0.5 - d);

/** A sRGB code at `k` of its linear light (the night multipliers are in linear light, SPEC 6). */
function dim(c, k) {
    if (k === 1) return c.slice();
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const enc = (l) => { l = Math.max(0, Math.min(1, l)); return 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055); };
    return c.map((v) => Math.round(enc(lin(v) * k)));
}

/**
 * A coverage mask (w * h bytes) scaled by (sx, sy) with an area average (exact coverage, crisp for a reduction). Returns
 * { w, h, a } with the new size ceil(w * sx) x ceil(h * sy).
 */
function scaleMask(m, w, h, sx, sy) {
    const W = Math.max(1, Math.ceil(w * sx - 1e-9)), H = Math.max(1, Math.ceil(h * sy - 1e-9));
    const tmp = new Float32Array(W * h), out = Buffer.alloc(W * H);
    for (let y = 0; y < h; y++) {                       // horizontal pass
        for (let X = 0; X < W; X++) {
            const a = X / sx, b = Math.min(w, (X + 1) / sx);
            let s = 0, n = 0;
            for (let x = Math.floor(a); x < b && x < w; x++) {
                const o = Math.min(b, x + 1) - Math.max(a, x);
                if (o > 0) { s += m[y * w + x] * o; n += o; }
            }
            tmp[y * W + X] = n > 0 ? s / n : 0;
        }
    }
    for (let Y = 0; Y < H; Y++) {                       // vertical pass
        const a = Y / sy, b = Math.min(h, (Y + 1) / sy);
        for (let X = 0; X < W; X++) {
            let s = 0, n = 0;
            for (let y = Math.floor(a); y < b && y < h; y++) {
                const o = Math.min(b, y + 1) - Math.max(a, y);
                if (o > 0) { s += tmp[y * W + X] * o; n += o; }
            }
            out[Y * W + X] = Math.round(n > 0 ? s / n : 0);
        }
    }
    return { w: W, h: H, a: out };
}

/** The bounding box of a mask's ink (a > 24): [x0, y0, x1, y1) or null. */
function inkBox(m, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/** The first of `names` whose atlas loads (hud_text throws for a missing one), with its px size; null when none does. */
function fontOf(names) {
    for (let i = 0; i < names.length; i++) {
        try { const f = textRaster.loadFont(names[i][0]); if (f) return { name: names[i][0], size: names[i][1] }; } catch (e) { /* the next one */ }
    }
    return null;
}
/** Saira digits: the exact slot first (Saira 40 for the readout, if B6 bakes it), else a bigger one scaled down (crisp). */
const SAIRA_DIGITS = [['td_tach', 57], ['td_big', 92]];     // integration (B7): td_gear retired

/**
 * The figure of the sign: `text` in Saira. B6's own atlases when they are there (td_sign: one or two digits, cap 23 px;
 * td_sign3: three digits, cap 18 px; both made to fit the white disc), at their native size; else (B6's not merged) Saira
 * digits from a bigger atlas, ink height digitH, condensed to fit for three digits, a little heavier. Returns
 * { w, h, a } (coverage, the ink box only) or null when no digit font loads.
 */
function figure(text, o) {
    const own = fontOf([[text.length >= 3 ? 'td_sign3' : 'td_sign', 0]]);
    const f = own || fontOf(SAIRA_DIGITS);
    if (!f) return null;
    const adv = textRaster.measure(text, f.name, 0);
    const bw = adv + 8, bh = Math.ceil(textRaster.loadFont(f.name).metrics.cellHeight * 1.3) + 4;
    const m = textRaster.mask(bw, bh, text, { font: f.name, x: 4 });
    const box = inkBox(m, bw, bh);
    if (!box) return null;
    const iw = box[2] - box[0], ih = box[3] - box[1];
    const crop = Buffer.alloc(iw * ih);
    for (let y = 0; y < ih; y++) m.copy(crop, y * iw, (box[1] + y) * bw + box[0], (box[1] + y) * bw + box[0] + iw);
    if (own) return { w: iw, h: ih, a: crop };
    const s0 = o.digitH / ih;
    const k = Math.min(1, o.maxW / (iw * s0));              // three digits do not fit at full height: narrower, and a little lower
    return embolden(scaleMask(crop, iw, ih, s0 * k, s0 * (0.55 + 0.45 * k)), SHAPE.bold);
}

/** A mask `k` px heavier on every edge (k < 1): each pixel takes at least k of its heaviest 4-neighbour; the box grows a pixel all round. */
function embolden(m, k) {
    const w = m.w + 2, h = m.h + 2, out = Buffer.alloc(w * h);
    const at = (x, y) => (x < 1 || y < 1 || x > m.w || y > m.h ? 0 : m.a[(y - 1) * m.w + (x - 1)]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const a = at(x, y), n = Math.max(at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1));
        out[y * w + x] = Math.max(a, Math.round(n * k));
    }
    return { w, h, a: out };
}

/**
 * The sign's 96 x 88 sheet (straight RGBA) for a display. opts: { mult: { white, red }, dot: boolean }. Everything is drawn
 * with analytic edges; the figure is a Saira mask reduced to size. A 'none' display is a blank sheet.
 */
function paintSign(d, opts) {
    const o = opts || {}, M = o.mult || {};
    const W = SIGN.w, H = SIGN.h, cx = SIGN.cx - SIGN.x, cy = SIGN.cy - SIGN.y;
    const out = Buffer.alloc(W * H * 4, 0);
    if (!d || d.kind === 'none') return out;
    const kw = isNum(M.white) ? M.white : 1, kr = isNum(M.red) ? M.red : 1;
    const R = SIGN.r, Ri = SIGN.r - SIGN.ring;
    const white = dim(COL.white, kw), red = dim(COL.red, kr), ink = COL.ink;
    const end = d.kind === 'end';
    const fig = d.kind === 'limit' ? figure(String(d.shown), { digitH: SHAPE.digitH, maxW: SHAPE.digitMaxW }) : null;
    let figX = 0, figY = 0;
    if (fig) { figX = Math.round(cx - fig.w / 2); figY = Math.round(cy - fig.h / 2); }
    const dashW = SHAPE.dash[0], dashH = SHAPE.dash[1];
    const rr = (x, y, hx, hy, r) => { const qx = Math.abs(x) - (hx - r), qy = Math.abs(y) - (hy - r); return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
    const sRing = dim(COL.derestrictRing, kw), sInk = dim(COL.derestrict, kw);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const px = x + 0.5 - cx, py = y + 0.5 - cy, r = Math.hypot(px, py);
            let a = cov(r - R);
            const aDot = o.dot ? cov(Math.hypot(px, py - SHAPE.dotDy) - SHAPE.dotR) : 0;
            let c;
            if (end) {
                // the derestriction sign: a light disc, a thin grey edge, five diagonal stripes (ours)
                c = white.slice();
                const e = cov(Math.abs(r - (R - 0.9)) - 0.9);
                c = c.map((v, i) => v + (sRing[i] - v) * e);
                let s = 0;
                for (let i = 0; i < SHAPE.stripes; i++) {
                    const off = (i - (SHAPE.stripes - 1) / 2) * SHAPE.stripePitch * Math.SQRT2;
                    const dd = Math.abs((px - py) - off) / Math.SQRT2;
                    s = Math.max(s, cov(dd - SHAPE.stripeW / 2) * cov(r - (R - 4.5)));
                }
                c = c.map((v, i) => v + (sInk[i] - v) * s);
            } else {
                const ringK = cov(r - Ri);                 // 1 inside the white disc, 0 on the ring
                c = red.map((v, i) => v + (white[i] - v) * ringK);
                let g = 0;
                if (d.kind === 'unknown') {
                    for (let i = -1; i <= 1; i++) g = Math.max(g, cov(rr(px - i * SHAPE.dashPitch, py, dashW / 2, dashH / 2, 1)));
                } else if (fig) {
                    const fx = x - figX, fy = y - figY;
                    if (fx >= 0 && fy >= 0 && fx < fig.w && fy < fig.h) g = fig.a[fy * fig.w + fx] / 255;
                }
                if (g > 0) c = c.map((v, i) => v + (ink[i] - v) * g);
            }
            // the conditional dot under the disc (white, like the figure's ground)
            let al = Math.max(a, aDot);
            if (aDot > a) c = white.slice();
            if (al <= 0) continue;
            const q = (y * W + x) * 4;
            out[q] = Math.round(c[0]); out[q + 1] = Math.round(c[1]); out[q + 2] = Math.round(c[2]); out[q + 3] = Math.round(al * 255);
        }
    }
    return out;
}

/**
 * The cruise readout's sheet (straight RGBA, w x h of CRU[place]): the set speed in Saira (green when active, grey when
 * standby), "км/год" in Noto 19 under it, the function's symbol. Off: blank. opts: { place, green, grey, font maps }.
 */
function paintCruise(c, opts) {
    const o = opts || {}, P = CRU[o.place] || CRU.C1, W = P.w, H = P.h;
    const out = Buffer.alloc(W * H * 4, 0);
    if (!c || c.status === 'off' || !c.kind) return out;
    const col = c.status === 'active' ? (o.green || GREEN) : (o.grey || GREY);
    const over = (m, mw, mh, bx, by) => {              // coverage mask `m` into the sheet at (bx, by) in `col`
        for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
            const X = bx + x, Y = by + y, a = m[y * mw + x];
            if (a === 0 || X < 0 || Y < 0 || X >= W || Y >= H) continue;
            const q = (Y * W + X) * 4;
            if (a > out[q + 3]) { out[q] = col[0]; out[q + 1] = col[1]; out[q + 2] = col[2]; out[q + 3] = a; }
        }
    };
    // the symbol
    const names = o.icons || CRUISE_DEFAULT.icons;
    const iname = names[c.kind];
    if (iname && ICONS[iname]) {
        const s = P.symSize, ic = paintIcon(iname, s, s, [col[0], col[1], col[2], 255]);
        const bx = Math.round(P.sym[0] - P.x - s / 2), by = Math.round(P.sym[1] - P.y - s / 2);
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
            const X = bx + x, Y = by + y, a = ic[(y * s + x) * 4 + 3];
            if (!a || X < 0 || Y < 0 || X >= W || Y >= H) continue;
            const q = (Y * W + X) * 4;
            if (a > out[q + 3]) { out[q] = col[0]; out[q + 1] = col[1]; out[q + 2] = col[2]; out[q + 3] = a; }
        }
    }
    if (!isNum(c.shown)) return out;                    // an active function whose speed is not valid: the symbol alone
    const text = String(c.shown);
    // the set speed: Saira at numPx, the slot's own atlas when there is one, else a bigger one reduced
    const f = fontOf([['td_cru', P.numPx]].concat(SAIRA_DIGITS));
    if (f) {
        const adv = textRaster.measure(text, f.name, 0), bw = adv + 6, bh = Math.ceil(f.size * 1.3) + 4;
        // 0.1.5: a three-figure set speed (110, 180 ...) is wider than the slot at numPx: it was cut at the sheet's left edge
        // ("110" read "10"). The number shrinks to the room left of numRight (C1: the sheet's edge; C2: the symbol's right side).
        const roomLeft = P.row ? P.sym[0] + P.symSize / 2 + 4 : P.x + 2;
        const s = Math.min(P.numPx / f.size, (P.numRight - roomLeft) / (3 + adv));
        const m = textRaster.mask(bw, bh, text, { font: f.name, x: 3 });
        const meta = textRaster.loadFont(f.name).metrics;
        const sc = s === 1 ? { w: bw, h: bh, a: m } : scaleMask(m, bw, bh, s, s);
        // right edge of the advance box at numRight, baseline at numBase (x 3 is the box's left padding)
        const bx = Math.round(P.numRight - P.x - (3 + adv) * s), by = Math.round(P.numBase - P.y - meta.baseline * s);
        over(sc.a, sc.w, sc.h, bx, by);
    }
    // the unit under it (C1), or after it on the same line (C2)
    const uname = c.unit === 'mph' ? 'mph' : I.t('twin.u.kmh');
    const uf = fontOf([['td_u19', 19]]);
    if (uf) {
        const uw = textRaster.measure(uname, uf.name, 0), meta = textRaster.loadFont(uf.name).metrics;
        const left = P.row ? P.unitRight - P.x - uw : P.unitRight - P.x - uw;
        const mu = textRaster.mask(uw + 2, meta.cellHeight, uname, { font: uf.name });
        over(mu, uw + 2, meta.cellHeight, Math.round(left), Math.round(P.unitBase - P.y - meta.baseline));
    }
    return out;
}

/* ---------------------------------------------------------------- state ------------------------------------------- */

function fresh() {
    return { disp: displayOf(null), held: null, heldAt: 0, cru: cruiseOf(null, null), clock: null, logged: {}, lines: 0, cruRaw: undefined, signAt: 0, cruAt: 0,
        cruHud: null, cruHudAt: 0 };       // car-fix CF2: the HUD feed's reading (null until it first arrives)
}
const st = (hud) => hud.tl || (hud.tl = fresh());
const nowMs = (hud) => { const t = st(hud); return t.clock ? t.clock() : Date.now(); };
const limCfg = (hud) => (hud && hud.config && hud.config.limit && typeof hud.config.limit === 'object' ? hud.config.limit : {});
const log = (hud, level, s) => { try { if (hud && hud.log && hud.log[level]) hud.log[level](s); } catch (e) { /* never */ } };
const MAX_LINES = 200;

/** Chain `fn` behind whatever handler is on extra[iface][field] (the engine's own keeps running first); a throw is caught. */
function chain(hud, extra, iface, field, fn) {
    const e = extra[iface] = extra[iface] || {};
    const prev = e[field];
    e[field] = (v) => {
        if (prev) prev(v);
        try { fn(v); } catch (err) { log(hud, 'warn', 'limit: ' + field + ': ' + (err && err.message || err)); }
    };
}

/** One log line per change, at most MAX_LINES in all; numbers and enum names only. */
function say(hud, key, line) {
    const t = st(hud);
    if (t.logged[key] === line || t.lines >= MAX_LINES) return;
    t.logged[key] = line; t.lines++;
    log(hud, 'info', line);
}

function onSign(hud) {
    const t = st(hud), s = hud.sign;                 // the engine's reading of config.sign (hud.js signOf), already set
    const d = displayOf(s);
    t.disp = d; t.signAt = nowMs(hud);
    if (d.kind !== 'none') { t.held = d; t.heldAt = t.signAt; }
    say(hud, 'sign', 'limit: ' + d.kind + (d.kind === 'limit' ? ' ' + d.shown + ' ' + d.unit + (isNum(d.kmh) ? ' (' + Math.round(d.kmh) + ' km/h)' : '') : '') +
        ' conditional ' + (d.cond ? 'yes' : 'no') + ' warn ' + d.warn);
}

function onCruise(hud, v) {
    const t = st(hud), cfg = cruiseCfg(hud.config);
    const r = cruiseOf(cfg, v);
    t.cru = r; t.cruAt = nowMs(hud);
    // the raw members, as numbers and enum names (the struct has no text): so the car session can read what it meant
    // (a member that is neither a number, a boolean nor an enum's capital name is never copied: only "text" and its length)
    const raw = (p) => {
        const x = pick(v, p);
        if (x === undefined || x === null) return '-';
        if (typeof x === 'number' || typeof x === 'boolean') return String(x);
        if (typeof x === 'string') return /^[A-Z][A-Z0-9_]{0,63}$/.test(x) ? x : 'text' + x.length;
        return 'struct';
    };
    say(hud, 'cruise', 'limit: cruise raw func ' + raw(cfg.funcPath) + ' status ' + raw(cfg.statusPath) + ' speed ' + raw(cfg.speedPath) + ' unit ' + raw(cfg.unitPath) +
        ' xcc ' + raw(cfg.accPath) + ' sld ' + raw(cfg.sldPath) + ' -> ' + (r.kind || 'none') + ' ' + r.status + (isNum(r.kmh) ? ' ' + Math.round(r.kmh) + ' km/h' : '') +
        (cruiseOn(hud) ? '' : ' (drawing is off: config.cruise null)'));
}

/**
 * car-fix CF2: the cruise / limiter from DisplayDataServer.functionalLibraryData (the HUD's feed; it arrives with the HUD
 * off). The field also carries rpm and speed, so it comes often: the reading is cheap and the log line names only the
 * members that matter (one line per change).
 */
function onHudCruise(hud, v) {
    if (!src) return;
    const t = st(hud);
    if (!t.hudCfg || t.hudCfgOf !== hud.config.cruise) { t.hudCfg = src.hudCruiseCfg(hud.config.cruise); t.hudCfgOf = hud.config.cruise; }
    const r = src.hudCruiseOf(t.hudCfg, v);
    t.cruHud = r; t.cruHudAt = nowMs(hud);
    say(hud, 'cruiseHud', 'limit: cruise hud ' + src.hudCruiseRaw(t.hudCfg, v) + ' -> ' + (r.kind || 'none') + ' ' + r.status + (isNum(r.kmh) ? ' ' + Math.round(r.kmh) + ' km/h' : '') +
        (cruiseOn(hud) ? '' : ' (drawing is off: config.cruise null)'));
}

/** The display now: the sign state, or the last real one for config.sign.holdMs after the car goes quiet. */
function displayNow(hud) {
    const t = st(hud), d = t.disp;
    if (d.kind !== 'none') return d;
    const sg = hud.config && hud.config.sign, hold = sg && isNum(sg.holdMs) ? sg.holdMs : 0;
    if (hold > 0 && t.held && nowMs(hud) - t.heldAt < hold) return t.held;
    return d;
}

/** config.cruise set (an object): the readout and its marker are drawn. null / absent: dark. */
const cruiseOn = (hud) => !!(hud && hud.config && hud.config.cruise);
function cruiseNow(hud) {
    const t = st(hud);
    // car-fix CF2: the HUD feed once it has spoken (the owner's car); TrafficSignDisplayControl's struct (never seen) else
    return cruiseOn(hud) ? (t.cruHud ? t.cruHud : t.cru) : cruiseOf(null, null);
}
const placeOf = (hud) => { const p = hud && hud.config && hud.config.cruise && hud.config.cruise.place; return CRU[p] ? p : 'C1'; };

/* ---------------------------------------------------------------- the engine's hooks ------------------------------ */

/** _setupVehicleData: after the engine's own watch of config.sign (so hud.sign is set before this runs). */
function wire(hud, extra) {
    const t = st(hud);
    const sg = hud.config && hud.config.sign;
    if (sg && sg.iface && sg.field) chain(hud, extra, sg.iface, sg.field, () => onSign(hud));
    // car-fix CF2: and behind the TrafficSignRecognition event's handler (hud.js / limit_src.js), which sets hud.sign the same way
    const evs = sg && src ? src.events(sg) : [];
    evs.forEach((e) => chain(hud, extra, e[0], e[1], () => onSign(hud)));
    if (!(sg && sg.iface && sg.field) && !evs.length) log(hud, 'warn', 'limit: no config.sign: the speed limit stays hidden');
    chain(hud, extra, IF, FIELD, (v) => onCruise(hud, v));     // read only; drawn only while config.cruise is set
    // car-fix CF2: the cruise / limiter as the owner's car sends it (DisplayDataServer, read only: getter 1, notifier 32769)
    if (src) {
        const hc = src.hudCruiseCfg(hud.config && hud.config.cruise);
        if (hc.hudIface && hc.hudField) {
            chain(hud, extra, hc.hudIface, hc.hudField, (v) => onHudCruise(hud, v));
            if (hc.hudInstance && String(hc.hudInstance) !== '1') extra[hc.hudIface].$instance = String(hc.hudInstance);
        }
    }
    t.wired = true;
}

/** The night multipliers the sign takes: white's and red's (hud._twinMults: [white, bezel, tick, strip], [.., .., .., red], ..). */
function mults(hud) {
    try { const m = hud._twinMults(); return { white: m[0][0], red: m[1][3], green: m[2][1] }; } catch (e) { return { white: 1, red: 1, green: 1 }; }
}

/** A tdsign widget: paint it when what it shows (or the night) changed. */
function updateSign(hud, x, now, force) {
    const d = displayNow(hud), m = mults(hud);
    const key = d.kind + '|' + d.shown + '|' + d.cond + '|' + m.white + '|' + m.red;
    if (!force && key === x.last) return;
    x.last = key;
    const buf = paintSign(d, { mult: m, dot: d.kind === 'limit' && d.cond });
    hud._blitDiff(x, buf);
}

/** A tdcru widget. */
function updateCru(hud, x, now, force) {
    const c = cruiseNow(hud), m = mults(hud);
    const key = c.kind + '|' + c.status + '|' + c.shown + '|' + c.unit + '|' + m.green + '|' + (hud.theme && hud.theme.dim ? hud.theme.dim[0] : 0) + '|' + I.lang();
    if (!force && key === x.last) return;
    x.last = key;
    const dimC = hud.theme && Array.isArray(hud.theme.dim) ? hud.theme.dim.slice(0, 3) : GREY;
    const buf = paintCruise(c, { place: x.w.place || placeOf(hud), green: dim(GREEN, m.green), grey: dimC, icons: cruiseCfg(hud.config).icons });
    hud._blitDiff(x, buf);
}

let shaderHas = null;
/** Whether the compiled speedometer shader has u_lim and u_cru (B1's tdial): a hook that names a uniform the shader lacks must not run. */
function shaderReady(src) {
    if (typeof src === 'string') return src.indexOf('u_lim') >= 0 && src.indexOf('u_cru') >= 0;      // a shader handed in (the tests)
    if (shaderHas === null) {
        try { const s = require('./shaders').tdial; shaderHas = typeof s === 'string' && s.indexOf('u_lim') >= 0 && s.indexOf('u_cru') >= 0; } catch (e) { shaderHas = false; }
    }
    return shaderHas;
}

/**
 * _twinDialUpdate: the markers, only when they changed. B1's contract (bake/work/twin-dial/r3b/pub/B1/NOTE.md): this file sets
 * hud.twinLim = { deg, state, warn } and hud.twinCru = { deg, state } and calls hud._twinMarks(), which resends u_lim and u_cru
 * (and reads config.limit.strip itself). Without B1's method (this package alone) it sends the two uniforms itself, to the
 * speedometer only, and only when the compiled shader has them.
 */
function dial(hud, x, shaderSrc) {
    if (!x || !x.tw || !x.ref) return;
    const t = st(hud), lim = limUniform(displayNow(hud), limCfg(hud).strip, hud.twinMi), cru = cruUniform(cruiseNow(hud), hud.twinMi);     // r1120 PS: the face's own law
    const key = lim.join(',') + '|' + cru.join(',');
    if (typeof hud._twinMarks === 'function') {
        if (key === t.marksKey) return;
        t.marksKey = key;
        hud.twinLim = { deg: lim[0], state: lim[1], warn: lim[2] };
        hud.twinCru = { deg: cru[0], state: cru[1] };
        hud._twinMarks();
        return;
    }
    if (x.tw.tach || !shaderReady(shaderSrc) || key === x.tlKey) return;
    x.tlKey = key;
    x.c.uniform(x.ref, 'u_lim', lim);
    x.c.uniform(x.ref, 'u_cru', cru);
}

/** _toggleOn: "tl:cruise" (config.cruise is set) and "tl:cruise:C1" / "tl:cruise:C2" (and its place is that one). */
function toggle(hud, name) {
    const p = String(name).split(':');
    if (p[0] === 'cruise') return cruiseOn(hud) && (p.length < 2 || placeOf(hud) === p[1]);
    return false;
}

module.exports = { wire, updateSign, updateCru, dial, toggle, angleOf, displayOf, limUniform, cruUniform, cruiseOf, cruiseCfg, paintSign, paintCruise, scaleMask,
    displayNow, cruiseNow, shaderReady, fresh, st, SIGN, CRU, COL, SHAPE, STRIP, LIM_STATE, CRU_STATE, CRUISE_DEFAULT, GREEN, GREY, IF, FIELD, MAX_LINES };
