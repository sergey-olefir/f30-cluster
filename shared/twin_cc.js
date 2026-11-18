'use strict';
/**
 * twin_cc.js - Twin Dial's check-control message in the CENTRE (docs/twin-dial/SPEC-R3.md section 5; package B3 of the
 * 0.1.1 build, after SC's model twin-r3/sc: docs/twin-dial/r3/SC-REPORT.md). Round 2's bottom plate is gone.
 *
 * Four things, none of which touches the engine until shared/hud.js calls them (hud.js has marked "// twin_dial:" hooks;
 * f30_cluster never creates a TwinCentre, so for it all of this is inert):
 *
 *   TwinCC        the verdict: none | window | ours, the severity, the card to paint, the D7 latch, the witnesses (round 2, unchanged).
 *   TwinCentre    the safety machine of the centre: TwinCC's verdict + the tab overlay (a message pulls tab 2, only the driver
 *                 leaves it, leaving opens BMW's panel in the same turn) + the per-turn plan of operations (rows aside, window,
 *                 tab, the tab-2 sheet, the warning tab; closing ones last) + the two settles (150 ms).
 *   layoutTab2    what tab 2's ONE sheet paints (card, rows, pointer, empty) and which messages' text it carries WHOLE.
 *   paintSheet    the sheet [729, 298, 1191, 568] as straight RGBA, in ONE paint.
 *
 * THE SAFETY RULE (the owner, 2026-11-16, SPEC 8.4): a BMW warning is never hidden unless our own text for THAT message
 * is on the screen in the same frame. "ours" is a state the machine reaches only after
 *   - the car's own "message shown now" has named a number, and that number has a ccList entry with a name (the stored
 *     entries of ccList are never drawn as the card). car-fix CF1 (the owner's car 2026-11-18): the source is
 *     Vehicle2.statusDisplayedCCMessage (config.ccActive.source "displayed"); KombiIF statusActiveCCMessage sat on 65535 the
 *     whole run and is a witness only where it moves (hud.js _ccActWitness); 65535 on displayed is "unknown" (window);
 *   - the D7 latch (config.ccActive.strict) has fallen: the "shown now" number has once matched a ccList entry, and the
 *     message it matched has ended;
 *   - no latch (a glyph our font lacks, a throw while painting, our sheet refused) holds;
 *   - tab 2 is selected and the sheet carries the WHOLE text of that exact message (the card, or a row whose whole name fits)
 *     since at least settleMs, sent in an earlier turn; and no page change that takes away text the cover relied on is
 *     pending (the open settle: the window and the sheet are on different connections, nothing orders sockets).
 * In every other state in which the car says, or may say, a message shows, the state is "window": BMW's own panel is
 * see-through (tdback's fallback window). "none" is reached only when the car itself says no message shows.
 *
 * Pure logic: no engine, no clock of its own (every call takes `now`), no text ever logged (numbers and lengths).
 * Written for the car's Node 8: no spread, no optional chaining.
 */

// ---- severity (SPEC 8.2): 0 none, 1 grey, 2 green, 3 amber, 4 red ------------------------------------------------------
// colours: the black-floor-corrected codes B's tdback uses for the rule (ENGINE-CONTRACT 1.2); cell = the card's symbol cell,
// icon = a row's symbol and the warning tab's icon (SPEC-R3 5.3). Severity is never in the selected tab's fill.
const SEV_NAMES = ['none', 'grey', 'green', 'amber', 'red'];
const SEVERITY = [
    null,
    { idx: 1, name: 'grey', cell: null, rule: [231, 231, 231], symbol: [255, 255, 255], icon: [255, 255, 255], mult: 0.55, ruleMult: 0.7 },
    { idx: 2, name: 'green', cell: [59, 155, 26], rule: [59, 155, 26], symbol: [255, 255, 255], icon: [59, 155, 26], mult: 0.8, ruleMult: 0.8 },
    { idx: 3, name: 'amber', cell: [240, 170, 10], rule: [240, 170, 10], symbol: [0, 0, 0], icon: [240, 170, 10], mult: 0.85, ruleMult: 0.85 },
    { idx: 4, name: 'red', cell: [176, 7, 30], rule: [176, 7, 30], symbol: [255, 255, 255], icon: [218, 16, 48], mult: 0.85, ruleMult: 0.85 },
];
const COLOR_SEV = { red: 4, orange: 3, yellow: 3, green: 2, white: 1, default: 1 };
const GREY_RAMP = [0.002, 0.16];          // the tab ramp (SPEC 6.1): the grey cell is its gradient, top to bottom, linear light

/** Severity index of a ccList colour name (red, orange, yellow, green, white, default); anything else: grey. */
function severityOf(color) {
    return Object.prototype.hasOwnProperty.call(COLOR_SEV, color) ? COLOR_SEV[color] : 1;
}

// ---- symbols (SPEC 8.3; design/twin-dial/vt/message_symbols.json by_cc_id, a test keeps the two equal) --------------------
const SYMBOL_BY_ID = {
    14: 'cc_door', 15: 'cc_door', 16: 'cc_door', 17: 'cc_door',
    18: 'cc_bonnet', 19: 'cc_boot',
    27: 'cc_oil', 28: 'cc_oil', 212: 'cc_oil',
    29: 'cc_engine', 30: 'cc_engine', 49: 'cc_engine',
    39: 'cc_coolant', 166: 'cc_coolant',
    40: 'cc_pedal', 41: 'cc_service',
    42: 'cc_brake', 48: 'cc_brake', 52: 'cc_brake', 71: 'cc_brake', 74: 'cc_brake', 236: 'cc_brake',
    46: 'cc_belt', 91: 'cc_belt', 97: 'cc_belt',
    50: 'cc_tyre', 63: 'cc_tyre', 139: 'cc_tyre', 140: 'cc_tyre', 141: 'cc_tyre', 142: 'cc_tyre', 143: 'cc_tyre', 144: 'cc_tyre', 147: 'cc_tyre',
    164: 'cc_washer',
    213: 'cc_battery', 229: 'cc_battery',
};
const GENERIC = { red: 'cc_warn', yellow: 'cc_warn', orange: 'cc_warn', white: 'cc_info', green: 'cc_info', default: 'cc_info' };

/** The pictogram for a message: by its id (VT's table), else the generic one by colour (unknown colour: the triangle).
 *  A missing pictogram never opens the window (SPEC 8.3), so this always answers. */
function symbolFor(id, color) {
    if (typeof id === 'number' && SYMBOL_BY_ID[id]) return SYMBOL_BY_ID[id];
    return GENERIC[color] || 'cc_warn';
}

// ---- colour at night (SPEC 7.2, one multiplier per material in linear light) -----------------------------------------------
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const enc = (l) => Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));
/** rgb scaled by `mult` in linear light. */
function nightRgb(rgb, mult) { return [enc(lin(rgb[0]) * mult), enc(lin(rgb[1]) * mult), enc(lin(rgb[2]) * mult)]; }

// ---- geometry of tab 2's sheet (SPEC-R3 5.1; design/twin-dial/r3/sc/card.json, the counter's baseline is the SPEC's 326) --------
const SHEET = { x: 729, y: 298, w: 462, h: 270 };           // [729, 298, 1191, 568], opaque black while tab 2 is selected
const CELL = { x0: 922, y0: 306, x1: 998, y1: 382 };        // the symbol cell of the card
const SYMBOL = { size: 54, cx: 960, cy: 344 };
const HEAD = { cx: 960, maxW: 436, lines: 3, bases: { 1: [424], 2: [424, 471], 3: [424, 471, 518] }, pitch: 47 };
const COUNTER = { right: 1180, base: 326 };                 // "n/m" Noto 29 grey, top right, only when the car gives a frame count
const ROWS = { pitch: 44, symX: 741, symSize: 32, symDy: 6, nameX: 781, maxW: 399, nameDy: 33, top: 300, bottom: 564, below: 26,
    scroll: { x: 1188, w: 3, y0: 300, y1: 564, track: 40, thumb: 180 } };
const POINTER = { lines: ['Повідомлення', 'на панелі внизу'], bases: [424, 471] };       // our fixed words: never a message's
const EMPTY = { icon: 'cc_info', size: 66, cx: 960, cy: 392, text: 'Немає повідомлень', base: 478 };
const FONTS = { head: 'td_msg', counter: 'td_cnt', row: 'td_tab', text: 'td_val' };      // Noto 42 / 29 / 33 / 39
const SHEET_RECT = [SHEET.x, SHEET.y, SHEET.x + SHEET.w, SHEET.y + SHEET.h];

/** The characters of `s` that `font` has no glyph for (spaces aside), as a string; '' when it can draw all of them.
 *  deps.has(font, ch) answers; a font that will not load counts as "cannot draw anything". */
function missingChars(deps, font, s) {
    let out = '';
    String(s).split('').forEach((ch) => {
        if (ch === ' ' || out.indexOf(ch) >= 0) return;
        let ok = false;
        try { ok = deps.has(font, ch); } catch (e) { ok = false; }
        if (!ok) out += ch;
    });
    return out;
}

/** Greedy word wrap into lines of widths[i] px (the last width repeats), at most widths.length lines; what is left ends the
 *  last line in the ellipsis. A word wider than a line is broken between letters. measure(str) is the text's width in px.
 *  Returns { lines, cut }. */
function wrapWords(text, measure, widths, ell) {
    const e = ell || '…';
    const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) return { lines: [''], cut: false };
    const room = (i) => widths[Math.min(i, widths.length - 1)];
    const fit = (s, i) => measure(s) <= room(i);
    const lines = [];
    let cur = '', i = 0;
    while (i < words.length && lines.length < widths.length) {
        const trial = cur ? cur + ' ' + words[i] : words[i];
        if (fit(trial, lines.length)) { cur = trial; i++; continue; }
        if (cur) { lines.push(cur); cur = ''; continue; }
        let n = words[i].length;
        while (n > 1 && !fit(words[i].slice(0, n), lines.length)) n--;
        lines.push(words[i].slice(0, n));
        words[i] = words[i].slice(n);
        if (!words[i]) i++;
    }
    if (cur && lines.length < widths.length) { lines.push(cur); cur = ''; }
    let cut = false;
    if (i < words.length || cur) {
        cut = true;
        const k = lines.length - 1;
        let t = lines[k] + ' ' + (cur ? cur + ' ' : '') + words.slice(i).join(' ');
        while (t.length > 1 && !fit(t + e, k)) t = t.slice(0, -1);
        lines[k] = t.replace(/[\s,.;:\/-]+$/, '') + e;
    }
    return { lines, cut };
}

const SEV_ORDER = { 4: 0, 3: 1, 2: 2, 1: 2, 0: 2 };         // rows: red, amber, then the rest in the car's order
/** TwinCC's key for a ccList entry: its id and its words as the car sent them. */
const keyOf = (e) => String(e.id) + '\u0001' + e.name;

/**
 * What tab 2's sheet paints. s = { cand (TwinCC.candidate or null), shown (a message shows or may show), sev (0..4),
 * entries [{ id, name, color }] (ccList outside ignoreIds, the car's order), night };
 * deps = { measure(font, str), has(font, ch), fonts }.
 * Returns { kind: 'card' | 'pointer' | 'list' | 'empty', card, rows, more, total, keys (the messages whose text is drawn
 * WHOLE), sig (equal sigs = equal pixels) }. A row whose name has a glyph the font lacks is not drawn and counts for nothing;
 * a row whose name is cut by "…" is drawn but is never counted as our text for its message (SPEC-R3 5.1).
 */
function layoutTab2(s, deps) {
    const F = deps.fonts || FONTS;
    const out = { kind: 'empty', card: null, rows: [], more: 0, total: 0, keys: [] };
    let top = ROWS.top;
    if (s.cand) {
        const w = wrapWords(s.cand.name, (t) => deps.measure(F.head, t), [HEAD.maxW, HEAD.maxW, HEAD.maxW]);
        const bases = HEAD.bases[String(w.lines.length)];
        out.kind = 'card';
        out.card = { key: s.cand.key, id: s.cand.id, sev: severityOf(s.cand.color), symbol: symbolFor(s.cand.id, s.cand.color),
            lines: w.lines, cut: w.cut, bases, counter: s.cand.counter || '' };
        out.keys.push(s.cand.key);                    // the card counts as our text (round 2's plate did, cut or not: "…" is ours)
        top = bases[bases.length - 1] + ROWS.below;
    } else if (s.shown) {
        out.kind = 'pointer';
        const sev = s.sev || 1;
        out.card = { key: null, sev, symbol: sev >= 3 ? 'cc_warn' : 'cc_info', lines: POINTER.lines.slice(), cut: false, bases: POINTER.bases, counter: '' };
        top = POINTER.bases[POINTER.bases.length - 1] + ROWS.below;
    }
    const others = (s.entries || []).filter((e) => e && e.name && !(s.cand && keyOf(e) === s.cand.key) && !missingChars(deps, F.row, e.name))
        .map((e, i) => ({ e, i, sev: severityOf(e.color) }))
        .sort((a, b) => (SEV_ORDER[a.sev] - SEV_ORDER[b.sev]) || (a.i - b.i));
    let y = top;
    for (let k = 0; k < others.length && y + ROWS.pitch <= ROWS.bottom; k++) {
        const o = others[k];
        const w = wrapWords(o.e.name, (t) => deps.measure(F.row, t), [ROWS.maxW]);
        const key = keyOf(o.e);
        out.rows.push({ key, id: o.e.id, sev: o.sev, symbol: symbolFor(o.e.id, o.e.color), text: w.lines[0], cut: w.cut, top: y });
        if (!w.cut) out.keys.push(key);               // a row counts as our text for its message only when its WHOLE name is drawn
        y += ROWS.pitch;
    }
    out.more = others.length - out.rows.length;        // the scroll line shows that more exist
    out.total = others.length;
    if (out.kind === 'empty' && out.rows.length + out.more > 0) out.kind = 'list';
    out.sig = JSON.stringify([out.kind, out.card && out.card.key, out.card && out.card.lines, out.card && out.card.counter, out.card && out.card.sev,
        out.card && out.card.symbol, out.rows.map((r) => [r.key, r.sev, r.text]), out.more, !!s.night]);
    return out;
}

/** straight-alpha RGBA `src` (same size as `dst`) laid over the opaque buffer `dst` (RGBA, alpha stays 255). */
function overOpaque(dst, src) {
    for (let o = 0; o < src.length; o += 4) {
        const a = src[o + 3];
        if (!a) continue;
        const k = a / 255;
        dst[o] = Math.round(src[o] * k + dst[o] * (1 - k));
        dst[o + 1] = Math.round(src[o + 1] * k + dst[o + 1] * (1 - k));
        dst[o + 2] = Math.round(src[o + 2] * k + dst[o + 2] * (1 - k));
        dst[o + 3] = 255;
    }
}

/**
 * Tab 2's sheet as straight RGBA, SHEET.w x SHEET.h, opaque black where nothing is drawn, in ONE paint, so "our text for
 * message K is on the screen" is one event per send.
 *   deps    { textRaster, paintIcon, icons }   (hud.js hands its own in; icons is paintIcon's table, to know a name)
 *   page    layoutTab2's answer
 *   o       { night, fonts }
 * Returns { buf, symbol } (symbol: the card's pictogram name actually drawn).
 */
function paintSheet(deps, page, o) {
    const T = deps.textRaster, F = (o && o.fonts) || FONTS, night = !!(o && o.night);
    const W = SHEET.w, H = SHEET.h, buf = Buffer.alloc(W * H * 4, 0);
    for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
    const put = (x, y, rgb, k) => {
        if (x < 0 || y < 0 || x >= W || y >= H || k <= 0) return;
        const p = (y * W + x) * 4, kk = Math.min(1, k);
        buf[p] = Math.round(rgb[0] * kk + buf[p] * (1 - kk));
        buf[p + 1] = Math.round(rgb[1] * kk + buf[p + 1] * (1 - kk));
        buf[p + 2] = Math.round(rgb[2] * kk + buf[p + 2] * (1 - kk));
    };
    const rect = (x0, y0, x1, y1, rgb) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, rgb, 1); };
    const icon = (name, size, cx, cy, rgb) => {
        const have = deps.icons && deps.icons[name] ? name : null;
        if (!have) return null;
        const px = deps.paintIcon(have, size, size, [rgb[0], rgb[1], rgb[2], 255]);
        const ix = Math.round(cx - size / 2 - SHEET.x), iy = Math.round(cy - size / 2 - SHEET.y);
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(ix + x, iy + y, rgb, px[(y * size + x) * 4 + 3] / 255);
        return have;
    };
    const text = (str, font, base, rgb, opt) => {
        const m = T.loadFont(font).metrics;
        const layer = T.drawText(W, H, str, { font, offsetY: base - SHEET.y - m.baseline, x: opt.x || 0, color: [rgb[0], rgb[1], rgb[2], 255], align: opt.align || 'left' });
        overOpaque(buf, layer);
    };
    const nt = (rgb, k) => (night ? nightRgb(rgb, k) : rgb);
    let symbolDrawn = null;
    if (page.kind === 'card' || page.kind === 'pointer') {
        const c = page.card, sev = SEVERITY[c.sev] || SEVERITY[1];
        // the symbol cell: flat in the severity colour, the grey one a tab-ramp gradient (linear light, top to bottom)
        const cx0 = CELL.x0 - SHEET.x, cx1 = CELL.x1 - SHEET.x, cy0 = CELL.y0 - SHEET.y, cy1 = CELL.y1 - SHEET.y;
        for (let y = cy0; y < cy1; y++) {
            let rgb = sev.cell;
            if (!rgb) { const f = (y + 0.5 - cy0) / (cy1 - cy0), v = enc(GREY_RAMP[0] + (GREY_RAMP[1] - GREY_RAMP[0]) * f); rgb = [v, v, v]; }
            rect(cx0, y, cx1, y + 1, night ? nightRgb(rgb, sev.mult) : rgb);
        }
        const sRgb = night ? nightRgb(sev.symbol, 0.8) : sev.symbol;
        symbolDrawn = icon(c.symbol, SYMBOL.size, SYMBOL.cx, SYMBOL.cy, sRgb) || icon(sev.idx >= 3 ? 'cc_warn' : 'cc_info', SYMBOL.size, SYMBOL.cx, SYMBOL.cy, sRgb);
        const white = nt([255, 255, 255], 0.8), grey = nt([227, 227, 227], 0.75);
        c.lines.forEach((ln, i) => { if (ln) text(ln, page.kind === 'card' ? F.head : F.text, c.bases[i], page.kind === 'card' ? white : grey, { align: 'center' }); });
        if (c.counter) {
            const cw = T.measure(c.counter, F.counter, 0);
            text(c.counter, F.counter, COUNTER.base, grey, { x: COUNTER.right - SHEET.x - cw });
        }
    } else if (page.kind === 'empty') {
        icon(EMPTY.icon, EMPTY.size, EMPTY.cx, EMPTY.cy, nt([188, 188, 188], 0.8));
        text(EMPTY.text, F.text, EMPTY.base, nt([227, 227, 227], 0.75), { align: 'center' });
    }
    // rows (every other listed entry): the symbol in the severity colour, the name in white
    const white = nt([255, 255, 255], 0.8);
    (page.rows || []).forEach((r) => {
        const sev = SEVERITY[r.sev] || SEVERITY[1];
        icon(r.symbol, ROWS.symSize, ROWS.symX + ROWS.symSize / 2, r.top + ROWS.symDy + ROWS.symSize / 2, nt(sev.icon, sev.mult));
        text(r.text, F.row, r.top + ROWS.nameDy, white, { x: ROWS.nameX - SHEET.x });
    });
    if (page.more > 0) {       // the scroll line: a track and a thumb at the top (we never scroll: no key yet)
        const sc = ROWS.scroll, n = (page.rows || []).length, total = n + page.more;
        const x0 = sc.x - SHEET.x, y0 = sc.y0 - SHEET.y, len = sc.y1 - sc.y0;
        rect(x0, y0, x0 + sc.w, y0 + len, nt([sc.track, sc.track, sc.track], 0.75));
        rect(x0, y0, x0 + sc.w, y0 + Math.max(8, Math.round(len * n / total)), nt([sc.thumb, sc.thumb, sc.thumb], 0.75));
    }
    return { buf, symbol: symbolDrawn };
}

// ---- the state machine --------------------------------------------------------------------------------------------------------------
/** a monotonic clock in ms (Date.now() can jump when the car sets the time; the settle time must not) */
const mono = () => { const t = process.hrtime(); return t[0] * 1000 + t[1] / 1e6; };
const SETTLE_MS = 150;       // hud.js CC_SETTLE_MS: sent in an earlier tick and this long ago is "on the screen"
const MAX_THROWS = 3;        // a card that throws this many times in one run is never drawn again until a restart

class TwinCC {
    /** opts: { strict (default true), settleMs, log(line), confirmNow (false) } */
    constructor(opts) {
        const o = opts || {};
        this.strict = o.strict !== false;
        this.settleMs = typeof o.settleMs === 'number' ? o.settleMs : SETTLE_MS;
        this.confirmNow = o.confirmNow === true;     // true: the confirming message itself may be ours (default: from the next one)
        this.logFn = typeof o.log === 'function' ? o.log : () => {};
        this.logs = 0;
        // outputs
        this.state = 'window';           // blind until the car's messages can be read (SPEC 8.4 condition 1)
        this.reason = 'the car\'s check-control messages have not been read yet';
        this.window = true;
        this.severity = 0;
        this.candidate = null;           // the card to be on screen: { key, id, name, color, symbol, counter } or null
        this.needsTick = false;          // the settle (or an expiring entry) is pending: evaluate again at the next tick
        // memory
        this.confirmed = false;          // D7: a "shown now" number has once matched a ccList entry
        this.confirmEpisode = -1;
        this.episode = 0; this.episodeKey = null;
        this.drawn = null;               // { key, at }: (round 2's stamp; the centre machine keeps its own, per message)
        this.latch = null;               // { why, key } for the current message; cleared when the message ends
        this.sheetLatch = false;         // our sheet was refused: until the next rebuild
        this.throws = 0; this.dead = false;
        this.noEntryLogged = {};
        this.sigLogged = null;
        this.stateChangedAt = 0;
    }

    /** the number the car says it shows now: { wired, n, conflict } from the two witnesses. */
    _witness(inp) {
        const none = (n) => (inp.noneValues || [0]).indexOf(n) >= 0;
        const a = inp.actWired && typeof inp.act === 'number', d = inp.dispWired && typeof inp.disp === 'number';
        if (a && d) {
            const same = none(inp.act) ? none(inp.disp) : inp.act === inp.disp;
            return { wired: true, n: inp.prefer === 'displayed' ? inp.disp : inp.act, conflict: !same, from: 'both' };     // car-fix CF1: prefer
        }
        if (a) return { wired: true, n: inp.act, conflict: false, from: 'active' };
        if (d) return { wired: true, n: inp.disp, conflict: false, from: 'displayed' };
        return { wired: false, n: null, conflict: false, from: '-' };
    }

    /**
     * Re-decide. inp (hud.js _twinInputs):
     *   read        the car's messages can be read (hud _ccWired)
     *   actWired / act / dispWired / disp / noneValues    the two witnesses
     *   prefer      'displayed' | 'active': whose number is THE number when both agree (car-fix CF1)
     *   unknownValues  numbers that say "unknown" (car-fix CF1, displayed's 65535): window, severity from the list only
     *   find(id)    the ccList entry { id, name, color, symbol } with that id, or null
     *   shown       the heuristic's verdict while no witness has spoken (hud ccListShown: true | false | null)
     *   live        [{ id, name, color, symbol }] the entries the heuristic counts as showing
     *   frame       { n, of, ids } (statusMenuCCMessage)
     * Returns whether state, reason, severity or the card to show changed.
     */
    update(inp, now) {
        const before = this.state + '|' + this.reason + '|' + this.severity + '|' + (this.candidate ? this.candidate.key + '|' + this.candidate.counter : '');
        const w = this._witness(inp);
        let shown = null, entry = null, state = 'window', reason = '', cand = null, conf = false;
        let shownNow = '-';
        let sev = 0, unknown = false;
        this.unlisted = false;           // car-fix CF1: the car names a number no ccList entry carries (BMW's own message)
        this.needsTick = false;
        if (!inp.read) {
            reason = 'the car\'s check-control messages have not been read yet';
            shown = null;
        } else if (w.wired) {
            shownNow = w.n === null ? '-' : String(w.n);
            const none = (inp.noneValues || [0]).indexOf(w.n) >= 0;
            if (w.conflict) {
                shown = true; reason = 'the two "shown now" witnesses disagree';
            } else if ((inp.unknownValues || []).indexOf(w.n) >= 0) {
                // car-fix CF1: 65535 on displayed (after an app start, at the end of a drive on the owner's car) = unknown: BMW's
                // panel open; the severity only from what the list holds, so a resting list pulls no tab (no known message)
                shown = true; unknown = true; reason = 'the "shown now" number is unknown (' + w.n + ')';
                (inp.entries || []).forEach((e) => { sev = Math.max(sev, severityOf(e.color)); });
            } else if (none) {
                shown = false;
            } else {
                shown = true;
                entry = inp.find ? inp.find(w.n) : null;
                if (!entry) {
                    this.unlisted = true;
                    reason = 'no ccList entry for number ' + w.n;
                    if (!this.noEntryLogged[w.n]) { this.noEntryLogged[w.n] = true; }
                } else {
                    sev = severityOf(entry.color);
                    if (!this.confirmed) {
                        this.confirmed = true; this.confirmEpisode = this._episodeFor(w.n);
                        conf = true;
                    }
                    if (!entry.name) reason = 'the ccList entry has no name';
                }
            }
        } else if (inp.shown === true) {
            shown = true;
            const live = inp.live || [];
            live.forEach((e) => { sev = Math.max(sev, severityOf(e.color)); });
            shownNow = '-';
            if (this.strict) reason = 'D7: the cluster\'s "shown now" has not matched a ccList entry yet';
            else if (inp.heurEntry && inp.heurEntry.name) entry = inp.heurEntry;      // strict off: 0.7.20's heuristic may draw
            else reason = 'no "shown now" from the car and no named entry in the list';
        } else if (inp.shown === false) {
            shown = false;
        } else {
            reason = 'no message verdict yet';
        }
        // the episode: one message from its first moment to the next change of the witness's number (0 ends it)
        this._episode(w.wired ? (shown ? String(w.n) : '0') : shown ? 'h' : '0');
        if (conf) this.logFn('cc: shown-now confirmed (number ' + w.n + ' matched a ccList entry)');
        if (shown === false) {
            // the message ended: latches go (they held until now), the card with it
            this.latch = null;
            state = 'none'; reason = 'no message shown';
        } else if (shown === true && entry && entry.name && !reason) {
            const key = String(entry.id) + '\u0001' + entry.name;
            // can this message be ours at all?
            let why = '';
            if (this.dead) why = 'drawing the card threw ' + this.throws + ' times: ours is off until the app restarts';
            else if (this.sheetLatch) why = 'our tab-2 sheet was refused (pixel memory or an asset)';
            else if (this.latch && this.latch.key === key) why = this.latch.why;
            else if (this.latch && this.latch.key === '*') why = this.latch.why;
            else if (this.strict && !this.confirmed) why = 'D7: not confirmed';
            else if (this.strict && !this.confirmNow && this.episode === this.confirmEpisode) why = 'D7: this is the message that confirmed "shown now"; ours from the next one';
            if (why) { reason = why; sev = severityOf(entry.color); }
            else {
                const counter = this._counter(inp.frame, entry.id);
                cand = { key, id: entry.id, name: String(entry.name).replace(/\s+/g, ' ').trim(), color: entry.color || null,
                    symbol: symbolFor(entry.id, entry.color), counter };
                sev = severityOf(entry.color);
                if (this.drawn && this.drawn.key === key && now - this.drawn.at >= this.settleMs) { state = 'ours'; reason = 'our card is on the screen'; }
                else {
                    state = 'window';
                    reason = this.drawn && this.drawn.key === key ? 'our card was just sent (waiting ' + this.settleMs + ' ms)' : 'our card is not on the screen yet';
                    this.needsTick = true;
                }
            }
        } else if (shown === true) {
            state = 'window';
        } else {
            state = 'window';       // blind / no verdict
        }
        this.state = state; this.window = state === 'window'; this.reason = reason;
        this.candidate = cand;
        if (!cand) this.drawn = null;             // nothing to show: the stamp goes too
        this.severity = state === 'none' ? 0 : unknown ? sev : (sev || (shown === true ? 1 : 0));     // car-fix CF1: unknown is no message of its own
        // the log line: one per change of what was decided (numbers and lengths only; the text never)
        const sig = [shownNow, entry ? entry.id : '-', entry ? entry.color : '-', entry && entry.name ? entry.name.length : 0, state, reason].join('|');
        if (sig !== this.sigLogged) {
            this.sigLogged = sig;
            if (this.logs < 400) {
                this.logs++;
                this.logFn('cc: id ' + (entry ? entry.id : shownNow === '-' ? '-' : shownNow) + ' colour ' + (entry ? (entry.color || 'none') : '-') +
                    ' name len ' + (entry && entry.name ? entry.name.length : 0) + ' shown-now ' + shownNow + ' → ' +
                    (state === 'none' ? 'none' : state) + ' (' + reason + ')');
            }
        }
        const after = this.state + '|' + this.reason + '|' + this.severity + '|' + (this.candidate ? this.candidate.key + '|' + this.candidate.counter : '');
        if (before !== after) this.stateChangedAt = now;
        return before !== after;
    }

    _episodeFor(n) { return this.episodeKey === String(n) ? this.episode : this.episode + 1; }

    _episode(key) {
        if (key === this.episodeKey) return;
        this.episodeKey = key; this.episode++;
        if (key === '0') this.latch = null;
        // a new message: the old stamp is for another message (its key differs)
    }

    /** "n/m" while the car says which frame of how many it is on and that frame is this message. */
    _counter(frame, id) {
        if (!frame || typeof frame.n !== 'number' || typeof frame.of !== 'number') return '';
        if (frame.of < 2 || frame.n < 1 || frame.n > frame.of) return '';
        const ids = (frame.ids || []).filter((x) => typeof x === 'number' && x > 0);
        if (ids.length && frame.ids[frame.n - 1] !== id) return '';
        return frame.n + '/' + frame.of;
    }

    // ---- events from the engine ---------------------------------------------------------------------------------------------------
    /** (round 2's plate stamp: unused by the centre machine, which keeps one per message) */
    painted(key, now) {
        if (!key) { this.drawn = null; return; }
        if (!this.drawn || this.drawn.key !== key) this.drawn = { key, at: now };
    }

    /** painting this message failed: kind 'glyph' (the font lacks a character), 'throw'. Latched until the message ends. */
    fail(kind, key, why) {
        if (kind === 'throw') {
            this.throws++;
            if (this.throws >= MAX_THROWS) this.dead = true;
            this.latch = { key: '*', why: 'drawing the card threw' + (why ? ' (' + why + ')' : '') };
        } else this.latch = { key, why: kind === 'glyph' ? 'a character of the name is missing from our font' + (why ? ' (' + why + ')' : '') : why };
        this.drawn = null;
        this.logFn('cc: card latched until the message ends: ' + this.latch.why);
    }

    /** our tab-2 sheet could not be made (the service refused it): until the next rebuild. */
    sheetRefused(why) {
        if (this.sheetLatch) return;
        this.sheetLatch = true; this.drawn = null;
        this.logFn('cc: tab-2 sheet refused' + (why ? ' (' + why + ')' : '') + ': BMW\'s panel stays open for every message');
    }

    /** layers were dropped and made again: nothing of ours is on the screen; a refusal may not repeat. */
    rebuilt() { this.drawn = null; this.sheetLatch = false; }

    describe() {
        return { state: this.state, reason: this.reason, severity: this.severity, confirmed: this.confirmed, episode: this.episode,
            card: this.candidate ? this.candidate.key : null, drawn: this.drawn ? this.drawn.key : null,
            latch: this.latch ? this.latch.why : null, sheetLatch: this.sheetLatch, dead: this.dead, throws: this.throws };
    }
}


// ---- the centre machine ---------------------------------------------------------------------------------------------------------------
/**
 * The safety machine of the centre (SC's CentreCC, docs/twin-dial/r3/SC-REPORT.md section 4): TwinCC's verdict, the tab overlay,
 * and the ordered operations of one turn. One decision per signal event or tick; the ENGINE sends what `update` returns.
 *
 * opts: { strict (true), confirmNow (false), settleMs (150), openSettleMs (150), base (1: the tab that shows without a
 *         message), deps (layoutTab2's: { measure, has, fonts }), paint (page -> RGBA Buffer; may throw), sheetOn (true: the
 *         layout has a tab-2 sheet), log,
 *         mutant: null | 'noSettle' | 'ignoreTab' | 'rowsFirst' | 'windowLast' | 'wrongCard' | 'keepStamps' | 'cutRows'
 *                 (a seam for the model's deliberately broken machines, tools/twin-dial/r3/sc/test.js; never set by the engine) }
 *
 * States, read by the engine: state (none | window | ours), window (BMW's panel is see-through), severity (0..4), tab (1..5),
 * candidate (the message the card is for), reason, needsTick, applied ({ window, rows, tab, sig, warn }: what the last plan
 * wants the screen to be, which is also what the "cc:row" toggle reads).
 *
 * Operations (update's `ops`, in the order to send): { op: 'rows', on } the bottom row's ink away / back; { op: 'window', open }
 * BMW's panel see-through / covered; { op: 'tab', tab }; { op: 'page', sig, keys, kind } the tab-2 sheet's pixels (the engine
 * takes the buffer from `buf`); { op: 'warn', look }. Opening ones first, the centre next, closing ones last.
 */
class TwinCentre {
    constructor(opts) {
        const o = opts || {};
        this.t = new TwinCC({ strict: o.strict !== false, confirmNow: o.confirmNow === true, settleMs: o.settleMs, log: o.log });
        this.settleMs = typeof o.settleMs === 'number' ? o.settleMs : SETTLE_MS;
        // the open settle: a centre change that takes away the text BMW's panel relies on waits until the window has been
        // open this long (the window and the tab-2 sheet are on different connections: no order between sockets)
        this.openSettleMs = typeof o.openSettleMs === 'number' ? o.openSettleMs : SETTLE_MS;
        this.deps = o.deps || null;
        this.paint = typeof o.paint === 'function' ? o.paint : null;
        this.sheetOn = o.sheetOn !== false;
        this.mutant = o.mutant || null;
        // car-fix CF1 (config.ccActive.unlistedPullsTab, default false): a number with no ccList entry (285, 926 ... on the owner's
        // car, ~6 s each) keeps BMW's panel open but pulls no tab - the driver reads BMW's own panel
        this.unlistedPullsTab = o.unlistedPullsTab === true;
        this.base = o.base || 1;                 // the tab without a message (the driver's last choice, or auto's)
        this.pulled = false;                     // a message has taken tab 2 for this period
        this.left = false;                       // the driver left tab 2 during this period
        this.periodKeys = {};                    // the messages seen in this period (a new one pulls again)
        this.onScreen = {};                      // key -> the time its whole text was first sent in the sheet still shown
        this.openedAt = -Infinity;               // when the window-open op was sent (born open, blind); null while shut
        this.applied = { window: true, rows: false, tab: null, sig: null, warn: null };   // what the service has (born blind)
        this.state = 'window'; this.reason = 'the car\'s check-control messages have not been read yet';
        this.window = true; this.severity = 0; this.tab = this.base; this.page = null; this.candidate = null;
        this.needsTick = false; this.night = false; this.deferred = false; this.mutKey = null; this.paintFailed = false;
        this.sigLogged = null; this.logs = 0;
    }

    // ---- what the engine reads of the verdict (so hud.js asks the same questions as before) ----
    get confirmed() { return this.t.confirmed; }
    get sheetLatch() { return this.t.sheetLatch; }
    get dead() { return this.t.dead; }
    get latch() { return this.t.latch; }

    /** the driver chose tab n (the key or the app setting). During a message: leaving 2 is allowed and opens BMW's panel
     *  in the same turn (the caller then runs update); going to 2 takes the card back. */
    driver(n) {
        if (n === 2) { if (this._period()) { this.pulled = true; this.left = false; } else this.base = 2; return; }
        this.base = n;
        if (this._period()) { this.pulled = false; this.left = true; }
    }
    /** an automatic choice (guidance -> 5, ...): it changes the base, never leaves tab 2 during a message period */
    auto(n) { this.base = n; }
    _period() { return this.t.state !== 'none'; }

    /** layers dropped and made again: nothing of ours is on the screen. The new layers are born in the state this returns
     *  (round 2's order: decided BEFORE the layers are made, so the backdrop is born with BMW's panel open while a message shows). */
    rebuild() {
        this.t.rebuilt(); this.onScreen = {};
        const shown = this.t.state !== 'none';
        this.applied = { window: shown, rows: !shown, tab: null, sig: null, warn: null };
        this.page = null; this.openedAt = shown ? -Infinity : null;     // born open: open since the layer exists
        this.paintFailed = false;
        return { window: shown, rows: !shown };
    }

    /** our tab-2 sheet was refused by the service: BMW's panel stays open for every message until the next rebuild */
    sheetRefused(why) { this.t.sheetRefused(why); this.onScreen = {}; }

    /**
     * One decision and its plan. inp: the engine's inputs (TwinCC's, plus `entries`). Returns
     * { ops, state, tab, page, deferred, buf } - buf the sheet's pixels when ops carries a page that needs painting.
     */
    update(inp, now) {
        const t = this.t, deps = this.deps;
        let page = null, cand = null, buf = null, bufSig = null;
        this.paintFailed = false;
        for (let pass = 0; pass < 4; pass++) {
            t.update(inp, now);
            cand = t.candidate;
            const shown = t.state !== 'none';
            if (!shown) { this.pulled = false; this.left = false; this.periodKeys = {}; this.mutKey = null; }
            // a message pulls tab 2: a new drawable one (its card), or - once per period - one that shows but ours cannot be drawn (the pointer
            // page, SPEC-R3 5.1). NOT the blind keep-open (severity 0: nothing is known to show; package B2's convention: a window with
            // no severity is not a message)
            const pullKey = cand ? cand.key : (shown && t.severity > 0 && !this.left && (!t.unlisted || this.unlistedPullsTab) ? '#nodraw' : null);     // car-fix CF1: unlisted
            if (shown && pullKey && !this.periodKeys[pullKey]) { this.periodKeys[pullKey] = true; this.pulled = true; this.left = false; }
            this.tab = this.pulled ? 2 : this.base;
            buf = null; bufSig = null;
            if (this.tab !== 2) { page = { kind: 'other', tab: this.tab, keys: [], sig: 'tab' + this.tab }; break; }
            if (!this.sheetOn || !deps || this.paintFailed) { page = { kind: 'blank', keys: [], sig: 'blank' }; break; }
            let c = cand;
            if (c && this.mutant === 'wrongCard') { this.mutKey = this.mutKey || c.key; c = Object.assign({}, c, { key: this.mutKey }); }
            // (mutant wrongCard: the card keeps the period's first message and the real one is believed drawn, so no row)
            const ents = this.mutant === 'wrongCard' && cand ? (inp.entries || []).filter((e) => keyOf(e) !== cand.key) : inp.entries;
            page = layoutTab2({ cand: c, shown, sev: t.severity, entries: ents, night: this.night }, deps);
            // painting can fail before anything is sent: a glyph our font lacks (the headline, the counter), a throw
            if (cand && page.card) {
                const F = deps.fonts || FONTS;
                const miss = missingChars(deps, F.head, cand.name) + missingChars(deps, F.counter, cand.counter || '');
                if (miss) { t.fail('glyph', cand.key, miss.length + ' characters'); continue; }
            }
            if (this.paint && page.sig !== this.applied.sig) {
                try { buf = this.paint(page); bufSig = page.sig; }
                catch (e) {
                    if (cand) t.fail('throw', cand.key, String(e && e.message || e).slice(0, 80));
                    else { t.fail('throw', '*', String(e && e.message || e).slice(0, 80)); this.paintFailed = true; }
                    continue;
                }
            }
            break;
        }
        // the open settle: while BMW's panel must open (or is opening), the centre may not take away text we relied on
        // before the window has been open openSettleMs - the page change waits (the tab bar's fill does not)
        const shownNow = t.state !== 'none';
        const relied = Object.keys(this.onScreen).filter((k) => page.keys.indexOf(k) < 0);
        const openFor = this.openedAt === null || this.applied.window !== true ? -1 : now - this.openedAt;
        const noDefer = this.mutant === 'windowLast' || this.mutant === 'ignoreTab' || this.openSettleMs <= 0;
        let deferred = false;
        if (!noDefer && shownNow && relied.length && this.page && this.page.sig !== page.sig && openFor < this.openSettleMs) {
            const at0 = cand ? this.onScreen[cand.key] : undefined;
            const wouldBeOurs = cand && at0 !== undefined && now - at0 >= this.settleMs && this.tab === 2 && page.keys.indexOf(cand.key) >= 0;
            if (!wouldBeOurs) { page = this.page; deferred = true; buf = null; }
        }
        // which messages' text the sheet will carry whole after this turn, and since when (continuous presence)
        const sent = page.keys.slice();     // what the pixels carry whole (the op); `keys` are what the machine stamps
        let keys = page.keys.slice();
        if (this.mutant === 'cutRows' && page.rows) keys = keys.concat(page.rows.filter((r) => r.cut).map((r) => r.key));
        const next = {};
        if (this.mutant === 'keepStamps' || (this.mutant === 'ignoreTab' && this.tab !== 2)) Object.keys(this.onScreen).forEach((k) => { next[k] = this.onScreen[k]; });
        if (this.mutant === 'wrongCard' && cand && page.card && page.card.key !== cand.key) keys = keys.map((k) => (k === page.card.key ? cand.key : k));
        keys.forEach((k) => { next[k] = this.onScreen[k] !== undefined ? this.onScreen[k] : now; });
        this.onScreen = next;
        // the verdict: ours only if the shown message's text has been in the visible sheet settleMs
        const shown = t.state !== 'none';
        const at = cand ? this.onScreen[cand.key] : undefined;
        const settled = at !== undefined && (this.mutant === 'noSettle' || now - at >= this.settleMs);
        const tabOk = (this.tab === 2 && !deferred) || this.mutant === 'ignoreTab';
        let state, reason;
        if (!shown) { state = 'none'; reason = t.reason; }
        else if (cand && settled && tabOk) { state = 'ours'; reason = 'our text for the shown message is on the screen'; }
        else if (cand && !this.sheetOn) { state = 'window'; reason = 'the layout has no tab-2 sheet'; }
        else if (cand && this.tab !== 2) { state = 'window'; reason = this.left ? 'the driver left tab 2: our text is not on the screen' : 'tab 2 is not shown'; }
        else if (cand) { state = 'window'; reason = 'our card was just sent (waiting ' + this.settleMs + ' ms)'; }
        else { state = 'window'; reason = inp.released ? 'released to the list: ' + t.reason : t.reason; }
        this.state = state; this.reason = reason; this.severity = t.severity; this.page = page; this.candidate = cand;
        this.window = state === 'window';
        const sig = state + '|' + this.tab + '|' + reason + '|' + page.kind;
        if (sig !== this.sigLogged && this.logs < 400) {       // one line per change; numbers and our own words only, never a message's
            this.sigLogged = sig; this.logs++;
            t.logFn('cc: centre ' + state + ', tab ' + this.tab + ', page ' + page.kind + ' (' + reason + ')');
        }
        this.needsTick = !!(shown && cand && this.sheetOn && this.tab === 2 && state !== 'ours') || deferred;
        this.deferred = deferred;
        const warn = this.tab === 2 ? 'W3' : shown ? 'W2' : (inp.entries || []).length ? 'W1' : 'W0';
        const ops = this._plan({ window: state === 'window', rows: state !== 'window', tab: this.tab, sig: page.sig, keys: sent, kind: page.kind, warn });
        ops.forEach((op) => { if (op.op === 'window') this.openedAt = op.open ? now : null; });
        const doPage = ops.some((op) => op.op === 'page');
        return { ops, state, tab: this.tab, page, deferred, buf: doPage && buf && bufSig === page.sig ? buf : null };
    }

    /** The ordered operations from what the service has to what is wanted. Opening (rows aside, window open) first, the
     *  centre next, closing (window shut, rows back) last: under any partial application the panel is open before our
     *  text changes, and it shuts only on text sent in an EARLIER turn (the settle). */
    _plan(want) {
        const a = this.applied, ops = [];
        const open = [], centre = [], close = [];
        if (!want.rows && a.rows !== false) open.push({ op: 'rows', on: false });
        if (want.window && a.window !== true) open.push({ op: 'window', open: true });
        if (want.tab !== a.tab) centre.push({ op: 'tab', tab: want.tab });
        if (want.sig !== a.sig) centre.push({ op: 'page', sig: want.sig, keys: want.keys, kind: want.kind });
        if (want.warn !== a.warn) centre.push({ op: 'warn', look: want.warn });
        if (!want.window && a.window !== false) close.push({ op: 'window', open: false });
        if (want.rows && a.rows !== true) close.push({ op: 'rows', on: true });
        if (this.mutant === 'rowsFirst') { ops.push.apply(ops, close.reverse()); ops.push.apply(ops, open.reverse()); ops.push.apply(ops, centre); }
        else if (this.mutant === 'windowLast') { ops.push.apply(ops, centre); ops.push.apply(ops, open); ops.push.apply(ops, close); }
        else { ops.push.apply(ops, open); ops.push.apply(ops, centre); ops.push.apply(ops, close); }
        this.applied = { window: want.window, rows: want.rows, tab: want.tab, sig: want.sig, warn: want.warn };
        return ops;
    }

    describe() {
        const d = this.t.describe();
        return Object.assign(d, { state: this.state, reason: this.reason, severity: this.severity, tab: this.tab, page: this.page ? this.page.kind : null,
            applied: this.applied, deferred: this.deferred });
    }
}

module.exports = { TwinCC, TwinCentre, layoutTab2, paintSheet, wrapWords, missingChars, keyOf, severityOf, symbolFor, nightRgb, mono, SEV_NAMES, SEVERITY,
    SYMBOL_BY_ID, GENERIC, SHEET, SHEET_RECT, CELL, SYMBOL, HEAD, COUNTER, ROWS, POINTER, EMPTY, FONTS, SETTLE_MS, GREY_RAMP };
