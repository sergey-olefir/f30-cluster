'use strict';
/**
 * twin_cc.js - Twin Dial's check-control message (docs/twin-dial/SPEC.md section 8, package D of round 2).
 *
 * Three things, none of which touches the engine until shared/hud.js calls them (hud.js has a few marked
 * "// twin_dial:" hooks; f30_cluster never creates a TwinCC, so for it all of this is inert):
 *
 *   TwinCC        the state machine: none | window | ours, the severity, the plate to paint, the D7 latch.
 *   paintPlate    our plate sheet (536 x 128, panel [694, 592, 1230, 720]) as straight RGBA, in ONE paint:
 *                 the rule, the symbol cell, the symbol, the headline (wrapped to 441 px, two lines, "..."), the counter.
 *   helpers       severityOf, symbolFor, wrapHeadline, nightRgb.
 *
 * THE SAFETY RULE (the owner, 2026-11-16, SPEC 8.4): a BMW warning is never hidden unless our own text for THAT message
 * is on the screen in the same frame. So "ours" is a state the machine reaches only after
 *   - the car's own "message shown now" (KombiIF statusActiveCCMessage, second witness Vehicle2.statusDisplayedCCMessage)
 *     has named a number, and that number has a ccList entry with a name (the stored entries of ccList are never drawn);
 *   - the D7 latch (config.ccActive.strict, the owner's decision 7) has fallen: the "shown now" number has once matched a
 *     ccList entry, and the message it matched has ended;
 *   - no latch (a glyph our font lacks, a throw while painting, our sheet refused) holds;
 *   - our plate for that exact message (its id and its words) was handed to the connection at least settleMs ago.
 * In every other state in which the car says, or may say, a message shows, the state is "window": BMW's own panel is
 * see-through (tdback's fallback window), and our texts over it are gone. "none" is reached only when the car itself
 * says no message shows (the witness says none, or - before any witness has spoken - the heuristic does).
 *
 * Pure logic: no engine, no clock of its own (every call takes `now`), no text ever logged (numbers and lengths).
 * Written for the car's Node 8: no spread, no optional chaining.
 */

// ---- geometry of the plate (panel px; SPEC 8.1, VF message_panel.json M2) ---------------------------------------------
const PLATE = { x: 694, y: 592, w: 536, h: 128 };         // the sheet (the plate rectangle is [694.5, 592, 1230, 720])
const RULE = { y0: 611, y1: 615 };                          // 4 px, in the severity colour (tdback draws the rest of it)
const CELL = { x0: 702, y0: 623.5, x1: 768, y1: 707.5 };
const SYMBOL = { size: 54, cx: 735, cy: 665.5 };
const HEAD = { x: 783, maxW: 441, base1: 656, base2: 703, base0: 680 };
const COUNTER = { right: 1224, base: 703, line2End: 1182 };

// ---- severity (SPEC 8.2): 0 none, 1 grey, 2 green, 3 amber, 4 red ------------------------------------------------------
// colours: the black-floor-corrected codes B's tdback uses for the highlight cell and the rule (ENGINE-CONTRACT 1.2), so the
// plate's cell and rule are the same colour as the tab above them
const SEV_NAMES = ['none', 'grey', 'green', 'amber', 'red'];
const SEVERITY = [
    null,
    { idx: 1, name: 'grey', cell: null, rule: [231, 231, 231], symbol: [255, 255, 255], mult: 0.55, ruleMult: 0.7 },
    { idx: 2, name: 'green', cell: [59, 155, 26], rule: [59, 155, 26], symbol: [255, 255, 255], mult: 0.8, ruleMult: 0.8 },
    { idx: 3, name: 'amber', cell: [240, 170, 10], rule: [240, 170, 10], symbol: [0, 0, 0], mult: 0.85, ruleMult: 0.85 },
    { idx: 4, name: 'red', cell: [176, 7, 30], rule: [176, 7, 30], symbol: [255, 255, 255], mult: 0.85, ruleMult: 0.85 },
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

// ---- the headline: wrapped to two lines (SPEC 8.1) ----------------------------------------------------------------------------
/**
 * Words wrapped greedily to `maxW` px, at most two lines; what does not fit goes to line 2, which then ends in the
 * ellipsis. `measure(str)` is the text's width in px; `maxW2` is line 2's room (the counter takes some of it).
 * Returns { lines: [one or two strings], cut: bool }. A word wider than a whole line is broken between letters.
 */
function wrapHeadline(text, measure, maxW, maxW2, ellipsis) {
    const ell = ellipsis || '…';
    const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) return { lines: [''], cut: false };
    if (!(maxW2 > 0)) maxW2 = maxW;
    // greedy break of the whole text into lines of at most maxW (the first) and maxW2 (the second)
    const fit = (s, w) => measure(s) <= w;
    const lines = [];
    let cur = '', i = 0;
    const room = () => (lines.length === 0 ? maxW : maxW2);
    while (i < words.length && lines.length < 2) {
        const word = words[i], trial = cur ? cur + ' ' + word : word;
        if (fit(trial, room())) { cur = trial; i++; continue; }
        if (cur) { lines.push(cur); cur = ''; continue; }
        // one word wider than the line: as many of its letters as fit, the rest goes on
        let n = word.length;
        while (n > 1 && !fit(word.slice(0, n), room())) n--;
        cur = word.slice(0, n);
        words[i] = word.slice(n);
        if (!words[i]) i++;
        lines.push(cur); cur = '';
    }
    if (cur && lines.length < 2) lines.push(cur);
    let cut = false;
    if (i < words.length) {
        // text left over after two lines: line 2 takes what it can and ends in the ellipsis
        cut = true;
        let last = lines.length === 2 ? lines[1] : '';
        const rest = words.slice(i).join(' ');
        let t = (last ? last + ' ' : '') + rest;
        while (t.length > 1 && !fit(t + ell, maxW2)) t = t.slice(0, -1);
        t = t.replace(/[\s,.;:\/-]+$/, '');
        if (lines.length < 2) lines.push(t + ell); else lines[1] = t + ell;
    }
    return { lines, cut };
}

// ---- the plate ------------------------------------------------------------------------------------------------------------------
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
 * Our plate as straight RGBA, `w` x `h` (the sheet, default PLATE), opaque black where nothing is drawn: one paint holds
 * the rule, the symbol cell, the symbol, the headline and the counter, so "our text is on the screen" is one event.
 *   deps    { textRaster, paintIcon, icons }   (hud.js hands its own in; icons is paintIcon's table, to know a name)
 *   c       { id, name, color, counter }       the message (the candidate of TwinCC)
 *   o       { font, counterFont, night, x, y, w, h }
 * Returns { buf, lines, cut, symbol, sev }.
 */
function paintPlate(deps, c, o) {
    const T = deps.textRaster, geo = { x: o.x === undefined ? PLATE.x : o.x, y: o.y === undefined ? PLATE.y : o.y,
        w: o.w || PLATE.w, h: o.h || PLATE.h };
    const W = geo.w, H = geo.h, buf = Buffer.alloc(W * H * 4, 0);
    for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
    const sev = SEVERITY[severityOf(c.color)];
    const night = !!o.night;
    const put = (x, y, rgb, k) => {
        if (x < 0 || y < 0 || x >= W || y >= H || k <= 0) return;
        const p = (y * W + x) * 4, kk = Math.min(1, k);
        buf[p] = Math.round(rgb[0] * kk + buf[p] * (1 - kk));
        buf[p + 1] = Math.round(rgb[1] * kk + buf[p + 1] * (1 - kk));
        buf[p + 2] = Math.round(rgb[2] * kk + buf[p + 2] * (1 - kk));
    };
    // the rule in the severity colour (the 2.2 px white one of the rest state is tdback's)
    const ruleRgb = night ? nightRgb(sev.rule, sev.ruleMult) : sev.rule;
    for (let y = RULE.y0; y < RULE.y1; y++) for (let x = 0; x < W; x++) put(x, y - geo.y, ruleRgb, 1);
    // the symbol cell: flat in the severity colour, the grey one a tab-ramp gradient (linear light, top to bottom)
    const cx0 = CELL.x0 - geo.x, cx1 = CELL.x1 - geo.x, cy0 = CELL.y0 - geo.y, cy1 = CELL.y1 - geo.y;
    for (let y = Math.floor(cy0); y < Math.ceil(cy1); y++) {
        const ky = Math.min(y + 1, cy1) - Math.max(y, cy0);          // vertical coverage of this row (half rows at .5)
        let rgb = sev.cell;
        if (!rgb) {
            const f = Math.min(1, Math.max(0, (y + 0.5 - cy0) / (cy1 - cy0)));
            const L = GREY_RAMP[0] + (GREY_RAMP[1] - GREY_RAMP[0]) * f, v = enc(L);
            rgb = [v, v, v];
        }
        if (night) rgb = nightRgb(rgb, sev.mult);
        for (let x = Math.floor(cx0); x < Math.ceil(cx1); x++) put(x, y, rgb, ky * (Math.min(x + 1, cx1) - Math.max(x, cx0)));
    }
    // the symbol, 54 x 54 centred on the cell's centre line
    const symName = symbolFor(c.id, c.color), size = SYMBOL.size;
    const have = deps.icons && deps.icons[symName] ? symName : (deps.icons && deps.icons[GENERIC[c.color] || 'cc_warn'] ? (GENERIC[c.color] || 'cc_warn') : null);
    if (have) {
        const sRgb = night ? nightRgb(sev.symbol, 0.8) : sev.symbol;
        const px = deps.paintIcon(have, size, size, [sRgb[0], sRgb[1], sRgb[2], 255]);
        const ix = Math.round(SYMBOL.cx - size / 2 - geo.x), iy = Math.round(SYMBOL.cy - size / 2 - geo.y);
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(ix + x, iy + y, sRgb, px[(y * size + x) * 4 + 3] / 255);
    }
    // the headline: Noto 42, from x 783, one line at baseline 680 or two at 656 / 703; the counter right-aligned at 1224
    const font = o.font, cfont = o.counterFont || o.font;
    const fm = T.loadFont(font).metrics, cm = T.loadFont(cfont).metrics;
    const glyphs = fm.glyphs, ell = glyphs['…'] ? '…' : '...';
    const measure = (s) => T.measure(s, font, 0);
    const counter = c.counter ? String(c.counter) : '';
    const cw = counter ? T.measure(counter, cfont, 0) : 0;
    const maxW2 = counter ? Math.min(HEAD.maxW, COUNTER.line2End - HEAD.x) : HEAD.maxW;
    let wrap = wrapHeadline(c.name, measure, HEAD.maxW, maxW2, ell);
    // a one-line headline keeps the middle baseline (680) unless it would run into the counter's x range: then it goes up
    let bases;
    if (wrap.lines.length === 1) bases = [counter && measure(wrap.lines[0]) > maxW2 ? HEAD.base1 : HEAD.base0];
    else bases = [HEAD.base1, HEAD.base2];
    const white = night ? nightRgb([255, 255, 255], 0.8) : [255, 255, 255];
    wrap.lines.forEach((ln, i) => {
        if (!ln) return;
        const layer = T.drawText(W, H, ln, { font, offsetY: bases[i] - geo.y - fm.baseline, x: HEAD.x - geo.x, color: [white[0], white[1], white[2], 255], align: 'left' });
        overOpaque(buf, layer);
    });
    if (counter) {
        const grey = night ? nightRgb([227, 227, 227], 0.75) : [227, 227, 227];
        const layer = T.drawText(W, H, counter, { font: cfont, offsetY: COUNTER.base - geo.y - cm.baseline, x: COUNTER.right - geo.x - cw, color: [grey[0], grey[1], grey[2], 255], align: 'left' });
        overOpaque(buf, layer);
    }
    return { buf, lines: wrap.lines, cut: wrap.cut, symbol: have, sev: sev.idx, counterWidth: cw, bases };
}

// ---- the state machine --------------------------------------------------------------------------------------------------------------
/** a monotonic clock in ms (Date.now() can jump when the car sets the time; the settle time must not) */
const mono = () => { const t = process.hrtime(); return t[0] * 1000 + t[1] / 1e6; };
const SETTLE_MS = 150;       // hud.js CC_SETTLE_MS: sent in an earlier tick and this long ago is "on the screen"
const MAX_THROWS = 3;        // a plate that throws this many times in one run is never drawn again until a restart

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
        this.candidate = null;           // the plate to be on screen: { key, id, name, color, symbol, counter } or null
        this.needsTick = false;          // the settle (or an expiring entry) is pending: evaluate again at the next tick
        // memory
        this.confirmed = false;          // D7: a "shown now" number has once matched a ccList entry
        this.confirmEpisode = -1;
        this.episode = 0; this.episodeKey = null;
        this.drawn = null;               // { key, at }: our plate for that message was handed to the connection
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
            return { wired: true, n: inp.act, conflict: !same, from: 'both' };
        }
        if (a) return { wired: true, n: inp.act, conflict: false, from: 'active' };
        if (d) return { wired: true, n: inp.disp, conflict: false, from: 'displayed' };
        return { wired: false, n: null, conflict: false, from: '-' };
    }

    /**
     * Re-decide. inp (hud.js _twinInputs):
     *   read        the car's messages can be read (hud _ccWired)
     *   actWired / act / dispWired / disp / noneValues    the two witnesses
     *   find(id)    the ccList entry { id, name, color, symbol } with that id, or null
     *   shown       the heuristic's verdict while no witness has spoken (hud ccListShown: true | false | null)
     *   live        [{ id, name, color, symbol }] the entries the heuristic counts as showing
     *   frame       { n, of, ids } (statusMenuCCMessage)
     * Returns whether state, reason, severity or the plate to show changed.
     */
    update(inp, now) {
        const before = this.state + '|' + this.reason + '|' + this.severity + '|' + (this.candidate ? this.candidate.key + '|' + this.candidate.counter : '');
        const w = this._witness(inp);
        let shown = null, entry = null, state = 'window', reason = '', cand = null, conf = false;
        let shownNow = '-';
        let sev = 0;
        this.needsTick = false;
        if (!inp.read) {
            reason = 'the car\'s check-control messages have not been read yet';
            shown = null;
        } else if (w.wired) {
            shownNow = w.n === null ? '-' : String(w.n);
            const none = (inp.noneValues || [0]).indexOf(w.n) >= 0;
            if (w.conflict) {
                shown = true; reason = 'the two "shown now" witnesses disagree';
            } else if (none) {
                shown = false;
            } else {
                shown = true;
                entry = inp.find ? inp.find(w.n) : null;
                if (!entry) {
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
            // the message ended: latches go (they held until now), the plate with it
            this.latch = null;
            state = 'none'; reason = 'no message shown';
        } else if (shown === true && entry && entry.name && !reason) {
            const key = String(entry.id) + '\u0001' + entry.name;
            // can this message be ours at all?
            let why = '';
            if (this.dead) why = 'drawing the plate threw ' + this.throws + ' times: ours is off until the app restarts';
            else if (this.sheetLatch) why = 'our plate sheet was refused (pixel memory or an asset)';
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
                if (this.drawn && this.drawn.key === key && now - this.drawn.at >= this.settleMs) { state = 'ours'; reason = 'our plate is on the screen'; }
                else {
                    state = 'window';
                    reason = this.drawn && this.drawn.key === key ? 'our plate was just sent (waiting ' + this.settleMs + ' ms)' : 'our plate is not on the screen yet';
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
        if (!cand) this.drawn = null;             // hud.js clears the plate when there is nothing to show: its stamp goes too
        this.severity = state === 'none' ? 0 : (sev || (shown === true ? 1 : 0));
        if (state === 'none' && this.drawn && !cand) { /* the plate is cleared by hud.js; its stamp goes with it */ }
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
        // a new message: the old plate stamp is for another message (its key differs; kept until painted over)
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
    /** our plate for `key` was handed to the connection at `now` (one paint: cell, symbol, words, counter). */
    painted(key, now) {
        if (!key) { this.drawn = null; return; }
        if (!this.drawn || this.drawn.key !== key) this.drawn = { key, at: now };
    }

    /** painting this message failed: kind 'glyph' (the font lacks a character), 'throw'. Latched until the message ends. */
    fail(kind, key, why) {
        if (kind === 'throw') {
            this.throws++;
            if (this.throws >= MAX_THROWS) this.dead = true;
            this.latch = { key: '*', why: 'drawing the plate threw' + (why ? ' (' + why + ')' : '') };
        } else this.latch = { key, why: kind === 'glyph' ? 'a character of the name is missing from our font' + (why ? ' (' + why + ')' : '') : why };
        this.drawn = null;
        this.logFn('cc: plate latched until the message ends: ' + this.latch.why);
    }

    /** our plate sheet could not be made (the service refused it): until the next rebuild. */
    sheetRefused(why) {
        if (this.sheetLatch) return;
        this.sheetLatch = true; this.drawn = null;
        this.logFn('cc: plate sheet refused' + (why ? ' (' + why + ')' : '') + ': BMW\'s panel stays open for every message');
    }

    /** layers were dropped and made again: nothing of ours is on the screen; a refusal may not repeat. */
    rebuilt() { this.drawn = null; this.sheetLatch = false; }

    describe() {
        return { state: this.state, reason: this.reason, severity: this.severity, confirmed: this.confirmed, episode: this.episode,
            plate: this.candidate ? this.candidate.key : null, drawn: this.drawn ? this.drawn.key : null,
            latch: this.latch ? this.latch.why : null, sheetLatch: this.sheetLatch, dead: this.dead, throws: this.throws };
    }
}

module.exports = { TwinCC, paintPlate, wrapHeadline, severityOf, symbolFor, nightRgb, mono, SEV_NAMES, SEVERITY, SYMBOL_BY_ID, GENERIC,
    PLATE, RULE, CELL, SYMBOL, HEAD, COUNTER, SETTLE_MS, GREY_RAMP };
