'use strict';
/**
 * twin_front.js - Twin Dial's picture of the vehicle ahead (front-vehicle FV; the design and its costs are
 * docs/twin-dial/FV-SPEC.md, the brief docs/AGENT-BRIEF-front-vehicle.md). A TEST MODE: everything here is inert unless the
 * Діагностика setting "Авто попереду (тест)" (diagFrontVehicle) has written config.frontVehicle.on = true.
 *
 *   A  the centre page "Авто попереду": tab 1 shows it while the test is on (shared/twin_pages.js asks takesTab1 / page).
 *      A lane in perspective, the car ahead placed by its gap level (five steps, a glide between them), rungs across the lane
 *      for the MEASURED gap, our own car at the foot, the gap in words (or as a time gap once config.frontVehicle.scale is
 *      calibrated), the cruise / limiter set speed when the car reports one. Painted into the page layer (no new layer).
 *   B  the pictogram "fv_icon" (widget type "tdfv", 64 x 68 px at [1504, 250] on connection 2): in the speedometer's hub above the
 *      digital speed, on every tab - our car below, the car ahead above, the rungs of the gap between. Built only while the
 *      test is on (toggle "fv:on": the setting rebuilds the layout once).
 *
 * What it never draws: red, a flashing anything, a brake or "assist active" symbol, a chosen ("set") distance. BMW's own
 * collision warning and its message panel are untouched: nothing here is near BMW's panel [696, 595.75, 1226, 704], the
 * gear gap or the belt group, and the message machine (shared/twin_cc.js) is not read or written.
 *
 * The data: shared/front_vehicle.js (the decoder; read only). Off at the start = no subscription at all. Switched on while the
 * app runs = one late watch of the one field, as Signal Probe does for its sets; switched off again = the values are ignored
 * and nothing is drawn (the proxy stays until the app restarts: a proxy shutdown has never been tried on the car).
 *
 * Plain Node 8 (the car's 8.16.2): no ?. / ?? / object spread. Nothing here throws into the engine.
 */
const textRaster = require('./hud_text');
const FV = require('./front_vehicle');

const isNum = (x) => typeof x === 'number' && isFinite(x);
const log = (hud, level, s) => { try { if (hud && hud.log && hud.log[level]) hud.log[level](s); } catch (e) { /* never */ } };
const nowMs = (hud) => (hud && hud.td && typeof hud.td.clock === 'function' ? hud.td.clock() : Date.now());
const VIEW_MS = 100;            // the tracker's view is asked at most this often (the page evaluates every 150 ms)

/* ------------------------------------------------------------------ geometry (panel px) -------------------------------- */

/** The page (the layer is twin_pages.LAYER [729, 248, 462, 347]: y 248..595). */
const PAGE = {
    title: { x: 960, b: 281, f: 'title' },                  // Noto 41, as every page
    metaL: { x: 739, b: 326, f: 'n31' },                    // the gap in words (left) ...
    metaR: { x: 1181, b: 326, f: 'n31' },                   // ... and the cruise set speed (right), the page grammar's meta line
    none: { x: 960, b: 452, f: 'n39' },                     // "Немає даних" (the signal absent)
    // the road: a pinhole with its horizon at y 318; the lane's foot at y 592, 2 x 150 px wide
    horizon: 318, foot: 592, footHalf: 150, laneTop: 348,
    // the car ahead's wheel line for levels 1..5 (and "slot 0", the rung just in front of our own car)
    slots: [528, 490, 446, 414, 392, 377],
    carW: 0.52,                                             // a car's width as a share of the lane's at its depth
    carH: 0.74,                                             // its height as a share of its width (a plain rear view)
    ego: { cx: 960, bottom: 601, w: 112, h: 0.52 },         // our own car, a low outline at the foot (cut by the layer's bottom)
    chevron: { cx: 960, y: 510, w: 34, h: 9, pitch: 10 },   // "we are closing": chevrons in front of our car, pointing ahead
    note: { x: 960, b: 452, f: 'n39' },                     // "Авто не видно" in the empty lane
};
/** The pictogram B: its layer, our car, the rungs, the car ahead. */
const ICONB = { x: 1504, y: 250, w: 64, h: 68, cx: 1536, car: { w: 28, h: 16 }, egoBottom: 316, rung0: 294, pitch: 6, rungW: 18, rungH: 2.5 };

/** The pinhole: the lane's half width at screen row y. */
const halfAt = (y) => PAGE.footHalf * (y - PAGE.horizon) / (PAGE.foot - PAGE.horizon);
/** A level position p (0..5, fractions between the slots) -> the wheel line's y. */
function slotY(p) {
    const s = PAGE.slots, q = Math.max(0, Math.min(5, p)), i = Math.min(4, Math.floor(q)), f = q - i;
    return s[i] + (s[i + 1] - s[i]) * f;
}

/* ------------------------------------------------------------------ state and hooks ------------------------------------ */

function st(hud) {
    if (!hud.fv) hud.fv = { tracker: null, subscribed: null, view: null, viewAt: -1e9, p: null, pAt: 0, pageKey: null, iconKey: null, wasOn: false };
    return hud.fv;
}
const cfgRaw = (hud) => (hud && hud.config && hud.config.frontVehicle && typeof hud.config.frontVehicle === 'object' ? hud.config.frontVehicle : null);
/** The test mode is on (config.frontVehicle.on, written by the Діагностика setting). */
function on(hud) { const c = cfgRaw(hud); return !!(c && c.on === true); }
const kmhOf = (hud) => { try { const v = hud && typeof hud._raw === 'function' ? hud._raw('speed') : null; return isNum(v) ? v : null; } catch (e) { return null; } };

function tracker(hud) {
    const s = st(hud);
    if (!s.tracker) s.tracker = FV.create(cfgRaw(hud) || {}, { log: hud.log, clock: () => nowMs(hud) });
    return s.tracker;
}
/** The field's handler (read only): every value goes to the tracker while the test is on, and is dropped otherwise. */
function handler(hud) {
    return (v) => {
        try { const s = st(hud); if (s.tracker && on(hud) && s.tracker.running()) s.tracker.feed(v, kmhOf(hud)); } catch (e) { log(hud, 'warn', 'fv: ' + (e && e.message || e)); }
    };
}

/**
 * _setupVehicleData: with the test on at the start, the field joins the engine's own watches (chained behind any handler
 * already there). Off: nothing at all - no handler, no subscription.
 */
function wire(hud, extra) {
    const s = st(hud);
    if (!on(hud)) { s.wasOn = false; return; }
    const c = tracker(hud).cfg;
    const e = extra[c.iface] = extra[c.iface] || {};
    if (c.instance && String(c.instance) !== '1') e.$instance = String(c.instance);
    const prev = e[c.field], mine = handler(hud);
    e[c.field] = (v) => { if (prev) prev(v); mine(v); };
    s.subscribed = 'start'; s.wasOn = true;
    tracker(hud).start();
}

/**
 * The Діагностика setting changed (shared/diag_settings.js, before its rebuild): on = start the tracker and, when the field was
 * not watched from the start, watch it now (once; Signal Probe's late watch); off = stop (nothing drawn, values ignored).
 */
function diag(hud) {
    const s = st(hud), want = on(hud);
    if (want === s.wasOn) return;
    s.wasOn = want;
    s.pageKey = null; s.iconKey = null; s.p = null; s.view = null; s.viewAt = -1e9;
    if (!want) { if (s.tracker) s.tracker.stop(s.subscribed ? 'the subscription stays until the app restarts' : ''); return; }
    s.tracker = null;                       // the config may have changed with it: a new tracker on the new keys
    const t = tracker(hud);
    t.start();
    if (s.subscribed) return;
    const S = hud && hud.ctx && hud.ctx.signals;
    if (!S || typeof S.watch !== 'function') { log(hud, 'warn', 'fv: no signals to watch'); return; }
    s.subscribed = 'late';
    const hs = {};
    hs[t.cfg.field] = handler(hud);
    Promise.resolve().then(() => S.watch(t.cfg.iface, String(t.cfg.instance || '1'), hs, hud.log)).then((res) => {
        log(hud, 'info', 'fv: watch ' + t.cfg.iface.split('.').pop() + '.' + t.cfg.field + (res && res.error ? ' error: ' + String(res.error).slice(0, 120) : ' ok'));
    }, (e) => log(hud, 'info', 'fv: watch error: ' + String(e && e.message || e).slice(0, 120)));
}

/** _toggleOn "fv:on": the pictogram's widget is built only while the test is on. */
function toggle(hud, name) { return name === 'on' ? on(hud) : false; }

/** Tab 1 shows the page "front" while the test is on (shared/twin_pages.js decide). */
function takesTab1(hud) { return on(hud); }

/** The tracker's state now, at most every VIEW_MS (the stale / absent clocks run in it). */
function viewNow(hud, now) {
    const s = st(hud);
    if (!on(hud) || !s.tracker) return null;
    if (!s.view || now - s.viewAt >= VIEW_MS || now < s.viewAt) { s.view = s.tracker.view(kmhOf(hud)); s.viewAt = now; }
    return s.view;
}

/* ------------------------------------------------------------------ texts ---------------------------------------------- */

const FONTS = { title: ['td_title'], n31: ['td_body'], n39: ['td_val'] };       // Noto 41 / 31 / 39: every letter of ours is in them
const fontCache = {};
function fontName(key) {
    if (fontCache[key]) return fontCache[key];
    let found = null;
    (FONTS[key] || []).forEach((n) => { if (!found) { try { textRaster.loadFont(n); found = n; } catch (e) { /* the next */ } } });
    if (found) fontCache[key] = found;
    return found;
}
/** Every string the page or the pictogram can show (the font test checks each against the atlases). */
const STRINGS = ['Авто попереду', 'Авто не видно', 'Немає даних', 'близько', 'середньо', 'далеко', 'круїз', 'обмежувач', 'км/год', 'миль/год', '0123456789.', ' с', ' · '];

/** The cruise / limiter the car reports (shared/twin_limit.js cruiseNow), as the meta line's text and colour role, or null. */
function cruiseText(hud) {
    let c = null;
    try { const L = require('./twin_limit'); c = L.cruiseNow(hud); } catch (e) { return null; }
    if (!c || !c.kind || c.status === 'off' || !isNum(c.shown)) return null;
    return { s: (c.kind === 'limiter' ? 'обмежувач ' : 'круїз ') + Math.round(c.shown) + (c.unit === 'mph' ? ' миль/год' : ' км/год'), c: c.status === 'active' ? 'ready' : 'dim' };
}
/** The gap in words, or the time gap once the scale is calibrated ("1.8 с"), or the no-target words. */
function gapText(v) {
    if (!v) return { s: '', c: 'dim' };
    if (v.state === 'absent') return { s: '', c: 'dim' };
    if (!v.present) return { s: '', c: 'dim' };          // the lane says "Авто не видно" (the meta line keeps clear of the cruise text)
    if (isNum(v.timeGap)) return { s: v.timeGap.toFixed(1) + ' с · ' + v.word, c: v.closing === 2 ? 'amber' : 'fg' };
    return { s: v.word, c: v.closing === 2 ? 'amber' : 'fg' };
}

/* ------------------------------------------------------------------ the rasteriser -------------------------------------- */

function blend(buf, o, r, g, b, a) {
    if (a <= 0) return;
    if (a > 1) a = 1;
    const da = buf[o + 3] / 255, oa = a + da * (1 - a);
    if (da === 0) { buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = Math.round(a * 255); return; }
    buf[o] = Math.round((r * a + buf[o] * da * (1 - a)) / oa);
    buf[o + 1] = Math.round((g * a + buf[o + 1] * da * (1 - a)) / oa);
    buf[o + 2] = Math.round((b * a + buf[o + 2] * da * (1 - a)) / oa);
    buf[o + 3] = Math.round(oa * 255);
}
/** Fill a shape given by its signed distance sd(px, py) (panel px; < 0 inside) over its box; `edge` draws only |sd| < th / 2. */
function shape(c, box, sd, rgb, alpha, edge) {
    const x0 = Math.max(c.x, Math.floor(box[0]) - 1), y0 = Math.max(c.y, Math.floor(box[1]) - 1);
    const x1 = Math.min(c.x + c.w, Math.ceil(box[2]) + 1), y1 = Math.min(c.y + c.h, Math.ceil(box[3]) + 1);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        let d = sd(x + 0.5, y + 0.5);
        if (edge) d = Math.abs(d) - edge / 2;
        const a = Math.max(0, Math.min(1, 0.5 - d));
        if (a > 0) blend(c.buf, ((y - c.y) * c.w + (x - c.x)) * 4, rgb[0], rgb[1], rgb[2], a * alpha);
    }
    return [x0, y0, x1, y1];
}
/** A rounded box: centre, half sizes, radius. */
const sdBox = (cx, cy, hw, hh, r) => (px, py) => {
    const qx = Math.abs(px - cx) - (hw - r), qy = Math.abs(py - cy) - (hh - r);
    return Math.sqrt(Math.max(qx, 0) * Math.max(qx, 0) + Math.max(qy, 0) * Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
/** A segment a -> b, `th` px thick (round ends). */
const sdSeg = (ax, ay, bx, by, th) => (px, py) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    const ex = px - ax - dx * t, ey = py - ay - dy * t;
    return Math.sqrt(ex * ex + ey * ey) - th / 2;
};
/** A box with a taper: wider at the bottom (a car's glasshouse). */
const sdTaper = (cx, top, bottom, hwTop, hwBot, r) => (px, py) => {
    const f = Math.max(0, Math.min(1, (py - top) / Math.max(1, bottom - top)));
    const hw = hwTop + (hwBot - hwTop) * f;
    return sdBox(cx, (top + bottom) / 2, hw, (bottom - top) / 2, r)(px, py);
};
const segBox = (ax, ay, bx, by, th) => [Math.min(ax, bx) - th, Math.min(ay, by) - th, Math.max(ax, bx) + th, Math.max(ay, by) + th];

/** One edge of the lane (side -1 / +1): a line from the foot to the lane's top, thinner and fainter with the distance. */
function edge(c, side, rgb, k) {
    const yT = PAGE.laneTop, yF = PAGE.foot, xT = 960 + side * halfAt(yT), xF = 960 + side * halfAt(yF);
    const dx = xF - xT, dy = yF - yT, len = Math.sqrt(dx * dx + dy * dy), nx = dy / len, ny = -dx / len;
    const x0 = Math.max(c.x, Math.floor(Math.min(xT, xF)) - 3), x1 = Math.min(c.x + c.w, Math.ceil(Math.max(xT, xF)) + 3);
    const y0 = Math.max(c.y, Math.floor(yT) - 1), y1 = Math.min(c.y + c.h, Math.ceil(yF) + 1);
    for (let y = y0; y < y1; y++) {
        const f = Math.max(0, Math.min(1, (y + 0.5 - yT) / dy));          // 0 at the top, 1 at the foot
        const th = 1.2 + 2.0 * f, a = (0.25 + 0.6 * f) * k;
        for (let x = x0; x < x1; x++) {
            const d = Math.abs((x + 0.5 - xT) * nx + (y + 0.5 - yT) * ny) - th / 2;
            const cov = Math.max(0, Math.min(1, 0.5 - d)) * Math.max(0, Math.min(1, y + 1 - yT));
            if (cov > 0) blend(c.buf, ((y - c.y) * c.w + (x - c.x)) * 4, rgb[0], rgb[1], rgb[2], cov * a);
        }
    }
}

/**
 * A plain generic car seen from behind (no maker's shape): wheels, a body, a narrower glasshouse with its rear window, two
 * lamp slots. `bottom` is the wheel line, w its width. fill: the body's colour; ink: the window's / lamps' / wheels' (dark).
 * outline: draw only the body's and the glasshouse's edges (our own car).
 */
function car(c, cx, bottom, w, fill, ink, alpha, outline, hk) {
    const h = w * (isNum(hk) ? hk : PAGE.carH), r = Math.max(1, w * 0.12);
    const bodyTop = bottom - h * 0.62, bodyBot = bottom - h * 0.12;
    const glassTop = bottom - h, glassBot = bodyTop + r * 0.6;
    const th = outline ? Math.max(1.5, w / 50) : 0;
    const boxes = [];
    if (!outline) {
        // the wheels, under the body's sides
        [-1, 1].forEach((s) => boxes.push(shape(c, [cx + s * w * 0.36 - w * 0.09, bottom - h * 0.2, cx + s * w * 0.36 + w * 0.09, bottom],
            sdBox(cx + s * w * 0.36, bottom - h * 0.09, w * 0.085, h * 0.09, Math.max(1, w * 0.03)), ink, alpha)));
    }
    boxes.push(shape(c, [cx - w / 2, glassTop, cx + w / 2, glassBot], sdTaper(cx, glassTop, glassBot, w * 0.30, w * 0.40, r), fill, alpha, outline ? th : 0));
    boxes.push(shape(c, [cx - w / 2, bodyTop, cx + w / 2, bodyBot], sdBox(cx, (bodyTop + bodyBot) / 2, w / 2, (bodyBot - bodyTop) / 2, r), fill, alpha, outline ? th : 0));
    if (!outline) {
        // the rear window (dark, inside the glasshouse) and the two lamp slots (dark: no red of ours anywhere)
        const wt = glassTop + h * 0.07, wb = glassBot - h * 0.06;
        if (wb - wt > 1.5) shape(c, [cx - w / 2, wt, cx + w / 2, wb], sdTaper(cx, wt, wb, w * 0.24, w * 0.33, Math.max(1, r * 0.6)), ink, alpha * 0.85);
        const ly = bodyTop + (bodyBot - bodyTop) * 0.3, lh = Math.max(1, (bodyBot - bodyTop) * 0.16);
        [-1, 1].forEach((s) => shape(c, [cx + s * w * 0.34 - w * 0.12, ly - lh, cx + s * w * 0.34 + w * 0.12, ly + lh],
            sdBox(cx + s * w * 0.34, ly, w * 0.1, lh, Math.max(0.5, lh * 0.8)), ink, alpha * 0.8));
    }
    return [cx - w / 2, glassTop, cx + w / 2, bottom];
}

/** Paint a text (twin_pages' grammar: x / baseline / align); returns its ink box or null. */
function text(c, key, s, x, b, al, rgb, alpha) {
    const name = fontName(key);
    if (!name || !s) return null;
    const f = textRaster.loadFont(name).metrics, g = f.glyphs;
    let t = '';
    Array.from(String(s)).forEach((ch) => { if (g[ch] || ch === ' ') t += ch; });
    if (!t) return null;
    const wpx = textRaster.measure(t, name, 0);
    const left = al === 'r' ? x - wpx : al === 'c' ? x - wpx / 2 : x;
    const bw = Math.ceil(wpx) + 4, bh = f.cellHeight;
    const m = textRaster.mask(bw, bh, t, { font: name, x: 2 });
    const dx = Math.round(left) - 2, dy = Math.round(b) - f.baseline;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let y = 0; y < bh; y++) for (let xx = 0; xx < bw; xx++) {
        const cov = m[y * bw + xx];
        if (!cov) continue;
        const px = dx + xx - c.x, py = dy + y - c.y;
        if (cov > 40) { x0 = Math.min(x0, dx + xx); x1 = Math.max(x1, dx + xx + 1); y0 = Math.min(y0, dy + y); y1 = Math.max(y1, dy + y + 1); }
        if (px < 0 || py < 0 || px >= c.w || py >= c.h) continue;
        blend(c.buf, (py * c.w + px) * 4, rgb[0], rgb[1], rgb[2], cov / 255 * alpha);
    }
    return x1 > x0 ? [x0, y0, x1, y1] : null;
}

/** A centred note in the lane: black behind it (the lane's edges stop at its box), then the text. */
function label(c, s, at, rgb, alpha) {
    const name = fontName(at.f);
    if (!name) return null;
    const w = textRaster.measure(s, name, 0), f = textRaster.loadFont(name).metrics;
    const x0 = at.x - w / 2 - 10, x1 = at.x + w / 2 + 10, y0 = at.b - f.baseline + 4, y1 = at.b + 12;
    const k = c.buf;
    for (let y = Math.max(c.y, Math.floor(y0)); y < Math.min(c.y + c.h, Math.ceil(y1)); y++) {
        for (let x = Math.max(c.x, Math.floor(x0)); x < Math.min(c.x + c.w, Math.ceil(x1)); x++) { const o = ((y - c.y) * c.w + (x - c.x)) * 4; k[o] = 0; k[o + 1] = 0; k[o + 2] = 0; k[o + 3] = 255; }
    }
    return text(c, at.f, s, at.x, at.b, 'c', rgb, alpha);
}

const rgbOf = (theme, role) => { const v = (theme && theme[role]) || (theme && theme.fg) || [255, 255, 255]; return [v[0], v[1], v[2]]; };
const INK = [0, 0, 0];

/* ------------------------------------------------------------------ A: the page ---------------------------------------- */

/**
 * The page's picture for a view and a drawn position p (0..5): { buf, ink: [{ id, box }] } in the layer's own pixels. Pure
 * (given hud's theme, cruise and fonts): the mockups and the tests call it directly.
 */
function paintPage(layer, theme, v, p, cruise) {
    const c = { x: layer.x, y: layer.y, w: layer.w, h: layer.h, buf: Buffer.alloc(layer.w * layer.h * 4, 0) };
    const ink = [];
    const add = (id, box) => { if (box) ink.push({ id, box }); };
    const fg = rgbOf(theme, 'fg'), dim = rgbOf(theme, 'dim'), grey = rgbOf(theme, 'grey'), amber = rgbOf(theme, 'amber');
    const absent = !!(v && v.state === 'absent');
    const lane = absent ? 0.35 : 1;
    // the title (the backdrop's title rule is under it, as on every page)
    add('title', text(c, 'title', 'Авто попереду', PAGE.title.x, PAGE.title.b, 'c', fg, 1));
    // the lane's two edges, fading into the distance
    [-1, 1].forEach((s) => edge(c, s, fg, lane));
    add('lane', [960 - PAGE.footHalf - 2, PAGE.laneTop, 960 + PAGE.footHalf + 2, PAGE.foot]);
    // our own car at the foot: an outline, so it never reads as the car ahead
    add('ego', car(c, PAGE.ego.cx, PAGE.ego.bottom, PAGE.ego.w, dim, INK, absent ? 0.35 : 0.7, true, PAGE.ego.h));
    if (absent) add('none', label(c, 'Немає даних', PAGE.none, dim, 1));
    else if (!v || !v.present) add('note', label(c, 'Авто не видно', PAGE.note, dim, 0.8));
    if (v && v.present && isNum(p)) {
        const fast = v.closing === 2;
        const rungCol = fast ? amber : fg, rungA = fast ? 0.95 : v.closing === 1 ? 0.8 : 0.5;
        // the rungs of the measured gap: one in front of our car, one at every step the car ahead is beyond
        const yCar = slotY(p);
        for (let k = 0; k < 5; k++) {
            const y = PAGE.slots[k];
            if (y <= yCar + 3) break;
            const hw = halfAt(y) * 0.80, th = Math.max(1.6, 5 * (y - PAGE.horizon) / (PAGE.foot - PAGE.horizon));
            add('rung' + k, shape(c, [960 - hw - 2, y - th, 960 + hw + 2, y + th], sdBox(960, y, hw, th / 2, th / 2), rungCol, rungA));
        }
        // "we are closing": chevrons in front of our car, pointing ahead (one; two when fast)
        if (v.closing >= 1 && yCar < PAGE.chevron.y - 12) {
            const ch = PAGE.chevron;
            for (let k = 0; k < (fast ? 2 : 1); k++) {
                const y = ch.y - k * ch.pitch, col = fast ? amber : fg;
                add('chev' + k, shape(c, segBox(ch.cx - ch.w / 2, y + ch.h / 2, ch.cx, y - ch.h / 2, 3), sdSeg(ch.cx - ch.w / 2, y + ch.h / 2, ch.cx, y - ch.h / 2, 3), col, 0.95));
                shape(c, segBox(ch.cx, y - ch.h / 2, ch.cx + ch.w / 2, y + ch.h / 2, 3), sdSeg(ch.cx, y - ch.h / 2, ch.cx + ch.w / 2, y + ch.h / 2, 3), col, 0.95);
            }
        }
        // the car ahead, at its depth
        const w = 2 * halfAt(yCar) * PAGE.carW;
        add('car', car(c, 960, yCar, w, fast ? amber : fg, INK, 1, false));
    }
    // the meta line: the gap (left) and the cruise set speed (right)
    const g = gapText(v);
    if (g.s) add('gap', text(c, 'n31', g.s, PAGE.metaL.x, PAGE.metaL.b, 'l', rgbOf(theme, g.c), 1));
    if (cruise && cruise.s) {
        // the two never touch: a long one ("обмежувач 110 км/год" beside "середньо") drops its unit
        const nm = fontName('n31'), wOf = (t) => (nm && t ? textRaster.measure(t, nm, 0) : 0);
        const cs = PAGE.metaR.x - wOf(cruise.s) - 16 < PAGE.metaL.x + wOf(g.s) ? cruise.s.replace(/ (км|миль)\/год$/, '') : cruise.s;
        add('cruise', text(c, 'n31', cs, PAGE.metaR.x, PAGE.metaR.b, 'r', rgbOf(theme, cruise.c), 1));
    }
    return { buf: c.buf, ink };
}

/** The glide: the drawn position moves toward the level in a few frames (about 0.45 s), never jumps; a new target appears at once. */
function glide(s, v, now) {
    if (!v || !v.present || !v.level) { s.p = null; return null; }
    if (s.p === null) { s.p = v.level; s.pAt = now; return s.p; }
    const d = v.level - s.p;
    if (Math.abs(d) < 0.1) s.p = v.level;
    else s.p += d * 0.6;
    s.pAt = now;
    return s.p;
}

/**
 * twin_pages.update hands the page "front" here: decide, and repaint only when what it shows changed (the glide repaints at
 * the page's own 150 ms evaluation while it moves; a steady car costs nothing).
 */
function updatePage(hud, x, now, force) {
    const s = st(hud), v = viewNow(hud, now) || { state: 'none', present: false };
    const p = glide(s, v, now);
    const cr = cruiseText(hud);
    const th = ['fg', 'dim', 'grey', 'amber', 'ready'].map((r) => rgbOf(hud.theme, r).join(',')).join('|');
    const key = [v.state, v.present ? Math.round(slotY(p) * 2) : -1, v.closing || 0, gapText(v).s, cr ? cr.s + cr.c : '', th].join('#');
    if (!force && key === s.pageKey && x.px) return;
    s.pageKey = key;
    const out = paintPage(x.w, hud.theme, v, p, cr);
    x.pgInk = out.ink;
    hud._blitDiff(x, out.buf);
}

/* ------------------------------------------------------------------ B: the pictogram ----------------------------------- */

/** The pictogram's pixels for a view (transparent with no target). Pure. */
function paintIcon(layer, theme, v) {
    const c = { x: layer.x, y: layer.y, w: layer.w, h: layer.h, buf: Buffer.alloc(layer.w * layer.h * 4, 0) };
    const ink = [];
    if (!v || !v.present || !v.level) return { buf: c.buf, ink };
    const I = ICONB, fg = rgbOf(theme, 'fg'), amber = rgbOf(theme, 'amber'), dim = rgbOf(theme, 'dim');
    const fast = v.closing === 2;
    // our car, an outline at the bottom
    ink.push({ id: 'ego', box: icar(c, I.cx, I.egoBottom, I.car.w, I.car.h, dim, 0.75, true) });
    // the rungs of the gap, then the car ahead right above the last one
    const col = fast ? amber : fg, a = fast ? 1 : v.closing === 1 ? 0.9 : 0.6;
    for (let k = 1; k <= v.level; k++) {
        const y = I.rung0 - I.pitch * (k - 1);
        ink.push({ id: 'rung' + k, box: shape(c, [I.cx - I.rungW / 2 - 1, y - 2, I.cx + I.rungW / 2 + 1, y + 2], sdBox(I.cx, y, I.rungW / 2, I.rungH / 2, I.rungH / 2), col, a) });
    }
    const top = I.rung0 - I.pitch * (v.level - 1) - 3;
    ink.push({ id: 'car', box: icar(c, I.cx, top, I.car.w, I.car.h, fast ? amber : fg, 1, false) });
    return { buf: c.buf, ink };
}
/** The pictogram's car: a rounded body and a narrower glasshouse; filled (ahead) or an outline (ours). */
function icar(c, cx, bottom, w, h, rgb, alpha, outline) {
    const th = outline ? 1.6 : 0;
    shape(c, [cx - w / 2, bottom - h, cx + w / 2, bottom - h * 0.45], sdTaper(cx, bottom - h, bottom - h * 0.42, w * 0.30, w * 0.42, 2), rgb, alpha, th);
    shape(c, [cx - w / 2, bottom - h * 0.6, cx + w / 2, bottom], sdBox(cx, bottom - h * 0.3, w / 2, h * 0.3, 2.5), rgb, alpha, th);
    if (!outline) shape(c, [cx - w / 2, bottom - h, cx + w / 2, bottom - h * 0.5], sdTaper(cx, bottom - h * 0.86, bottom - h * 0.6, w * 0.22, w * 0.30, 1), INK, 0.8);
    return [cx - w / 2, bottom - h, cx + w / 2, bottom];
}

/** The "tdfv" widget: repaint only when the level, the closing or the night changed. */
function updateIcon(hud, x, now, force) {
    const s = st(hud), v = viewNow(hud, now);
    const th = ['fg', 'dim', 'amber'].map((r) => rgbOf(hud.theme, r).join(',')).join('|');
    const key = v && v.present ? [v.level, v.closing, th].join('#') : 'empty';
    if (!force && key === s.iconKey && x.px) return;
    s.iconKey = key;
    hud._blitDiff(x, paintIcon(x.w, hud.theme, v).buf);
}

module.exports = { wire, diag, toggle, takesTab1, on, viewNow, updatePage, updateIcon, paintPage, paintIcon, glide, slotY, halfAt, cruiseText, gapText,
    st, PAGE, ICONB, STRINGS, FONTS, fontName };
