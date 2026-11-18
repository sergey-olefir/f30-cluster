'use strict';
/**
 * centre_cc.js - the model harness of the check-control message in the CENTRE (Twin Dial 0.1.1, package B3), ported from
 * SC's model (twin-r3/sc, docs/twin-dial/r3/SC-REPORT.md). The machine itself is now PRODUCTION code, shared/twin_cc.js
 * (TwinCentre, layoutTab2); this file keeps what only the tests need:
 *
 *   CarSim     the car's message fields as the engine reads them (ccList, statusActiveCCMessage, the second witness,
 *              the frame field) and the engine's list heuristic, turned into shared/twin_cc.js TwinCC inputs; optionally
 *              research3/MC's release (deferValues, leftList) as the input hook MC proposed for Twin Dial.
 *   deps / layoutTab2 / makeMachine   the machine and the page layout of shared/twin_cc.js, with the app's own atlases
 *              (apps/twin_dial/hud/fonts) for the text measure.
 *   Screen     a stand-in for the service and the audit: applies the plan atomically, op by op, or in every
 *              interleaving the connections allow, with a sheet latency, and checks after every frame:
 *                V1  BMW shows message K and its panel is covered, while our text for K is not wholly on the screen;
 *                V2  the bottom row's ink is in BMW's open panel (the window open while the rows are drawn).
 *
 * THE RULE (the owner, 2026-11-16): a BMW warning is never hidden unless our own text for that exact message is on the
 * screen in the same frame. Here "on the screen" = in the tab-2 sheet that is visible (tab 2 selected), sent at least
 * settleMs ago, and drawn whole (a cut row does not count; the card counts as round 2's plate did).
 *
 * Pure: no clock of its own (every call takes `now`), no text logged. Node 8 style (no spread, no optional chaining).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const TW = require(path.join(ROOT, 'shared', 'twin_cc.js'));
const CARD = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'twin-dial', 'r3', 'sc', 'card.json'), 'utf8'));
const SETTLE_MS = TW.SETTLE_MS;          // 150, round 2's CC_SETTLE_MS
const keyOf = TW.keyOf;

// ---- text measuring from the app's own atlases (advances; kerning ignored: a few px per line, noted in the report) --------
const FONT_CACHE = {};
function font(name) {
    if (!FONT_CACHE[name]) FONT_CACHE[name] = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'hud', 'fonts', name + '.json'), 'utf8'));
    return FONT_CACHE[name];
}
function measure(name, s) {
    const g = font(name).glyphs;
    let w = 0;
    for (const ch of String(s)) w += g[ch] ? g[ch].advance : 0;
    return w;
}
/** the characters of `s` the atlas lacks (spaces aside), as a string; '' when it can draw all of them */
function missing(name, s) {
    const g = font(name).glyphs;
    let out = '';
    for (const ch of String(s)) if (ch !== ' ' && !g[ch] && out.indexOf(ch) < 0) out += ch;
    return out;
}

/** Greedy word wrap into lines of widths[i] px (the last width repeats), at most widths.length lines; what is left ends
 *  the last line in the ellipsis. A word wider than a line is broken between letters. Returns { lines, cut }. */
function wrap(text, fontName, widths, ell) {
    const e = ell || '…';
    const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) return { lines: [''], cut: false };
    const room = (i) => widths[Math.min(i, widths.length - 1)];
    const fit = (s, i) => measure(fontName, s) <= room(i);
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

// ---- the car, as the engine reads it -----------------------------------------------------------------------------------------
/**
 * The engine's message inputs, simplified from shared/hud.js _ccListEval / _twinInputs (0.7.20 + research3/MC):
 * list (ccList entries, or null before the first one), act (statusActiveCCMessage number, null = never notified),
 * disp (the second witness), frame. cfg: { ignoreIds [0], noneValues [0], hideAfterMs 20000, keepColors ['red'],
 * release null | { deferValues [..], leftList bool } }.
 */
class CarSim {
    constructor(cfg) {
        const c = cfg || {};
        this.cfg = { ignoreIds: c.ignoreIds || [0], noneValues: c.noneValues || [0], hideAfterMs: c.hideAfterMs || 20000,
            keepColors: c.keepColors || ['red'], release: c.release || null };
        this.list = null; this.act = null; this.disp = null; this.frame = null; this.seen = {}; this.ever = {}; this.fits = false;
        this.actAt = null; this.leftAt = {};    // when the shown-now number took its value; when each id left the list
    }
    setList(entries, now) {
        if (!Array.isArray(entries)) return;          // a list config.ccList does not fit: the old one is kept (A9)
        this.fits = true;
        this.list = entries.map((e) => ({ id: e.id, name: e.name === undefined ? 'x'.repeat(e.len || 10) : e.name, color: e.color || 'white' }));
        const keys = {}, ids = {};
        this.list.forEach((e) => { ids[e.id] = true; });
        Object.keys(this.ever).forEach((id) => { if (!ids[id] && this.leftAt[id] === undefined) this.leftAt[id] = now; if (ids[id]) delete this.leftAt[id]; });
        this.list.forEach((e) => { const k = keyOf(e); keys[k] = true; if (this.seen[k] === undefined) this.seen[k] = now; if (this.cfg.ignoreIds.indexOf(e.id) < 0) this.ever[e.id] = true; });
        Object.keys(this.seen).forEach((k) => { if (!keys[k]) delete this.seen[k]; });
    }
    /** the shown-now number (a notification; an unchanged value keeps its time, as the engine's change detection does) */
    setAct(n, now) { if (n !== this.act) { this.act = n; this.actAt = now; } }
    entries() { return (this.list || []).filter((e) => this.cfg.ignoreIds.indexOf(e.id) < 0); }
    /** TwinCC inputs, plus `entries` for the page and `released` (why the shown-now number is no verdict now, or '') */
    inputs(now) {
        const cfg = this.cfg, live = this.entries();
        const none = (n) => cfg.noneValues.indexOf(n) >= 0;
        let released = '';
        const r = cfg.release;
        if (r && this.act !== null) {
            const n = this.act;
            if ((r.deferValues || []).indexOf(n) >= 0) released = 'number ' + n + ' is a deferValue';
            else if (r.leftList && !none(n) && this.ever[n] && this.list && !this.list.some((e) => e.id === n) &&
                // SC's refinement: only a number KEPT from before its entry left (A3, A4); a number that arrives anew after
                // its entry left is a new message the list has not caught up with (S3 after an earlier listing): not released
                (r.leftList === 'any' || (this.leftAt[n] !== undefined && this.actAt !== null && this.actAt <= this.leftAt[n]))) released = 'number ' + n + ' has left ccList';
        }
        let shown = null, items = [];
        if (this.list) {
            if (released) { items = live.filter((e) => e.name); shown = live.length > 0; }
            else {
                const l = live.filter((e) => cfg.keepColors.indexOf(e.color) >= 0 || now - this.seen[keyOf(e)] < cfg.hideAfterMs);
                items = l.filter((e) => e.name); shown = l.length > 0;
            }
        }
        const wiredAct = this.act !== null && !released;
        const all = this.list || [];
        return {
            read: this.fits || this.act !== null || this.disp !== null,
            actWired: wiredAct, act: wiredAct ? this.act : null,
            dispWired: this.disp !== null && !released, disp: released ? null : this.disp,
            noneValues: cfg.noneValues,
            find: (id) => all.find((e) => e.id === id) || null,
            shown, live: items, heurEntry: items[0] || null,
            frame: this.frame || { n: null, of: null, ids: [] },
            entries: live, released,
        };
    }
}

// ---- the machine: shared/twin_cc.js's TwinCentre with the atlases as the text measure ----------------------------------------------
const deps = { measure: (f, s) => measure(f, s), has: (f, ch) => !!font(f).glyphs[ch], fonts: TW.FONTS };
const layoutTab2 = (s) => TW.layoutTab2(s, deps);
/** opts as TwinCentre's; `m.throwNext = true` makes the next paint of a page throw (a throw while painting). */
function makeMachine(opts) {
    const m = new TW.TwinCentre(Object.assign({ deps, paint: () => { if (m.throwNext) { m.throwNext = false; throw new Error('injected'); } return null; } }, opts || {}));
    m.throwNext = false;
    return m;
}

// ---- the service and the audit ----------------------------------------------------------------------------------------------------
/**
 * conns: which connection carries what (round 2: window 0, rows 2, page 2 (option a) / 1, tab 1).
 * mode: 'atomic' (a turn's ops appear together: round 2's hypothesis), 'serial' (each op its own frame, in send order),
 *       'interleave' (each op its own frame, every interleaving of the connections' queues: no order between sockets).
 * latency(): ms until a page's pixels show after they are sent (a sheet upload); the window and the rows' visibility
 * are uniforms / small and are taken as immediate.
 */
class Screen {
    constructor(o) {
        this.mode = o.mode || 'atomic';
        this.conns = o.conns || { window: 0, rows: 2, page: 2, tab: 1, warn: 1 };
        this.latency = o.latency || (() => 0);
        this.s = { window: true, rows: false, tab: null, keys: {}, kind: null };
        this.pending = [];                    // { at, keys, kind }
        this.v = { V1: 0, V2: 0, frames: 0, first: null };
        this.hang = { window: 0, card: 0, tab2: 0 };
    }
    /** what BMW shows now: null (nothing) or a key ('?'+n when the list does not carry it: no text of ours can match) */
    _audit(s, truth, now, where) {
        this.v.frames++;
        // truth: what BMW shows, or a list of what it may show (during one batch of the car's signals BMW's change and the
        // signals that report it are simultaneous: any of the old and the new display satisfies the rule)
        const covered = !s.window, ts = Array.isArray(truth) ? truth : [truth];
        const okFor = (t) => !t || !covered || !!s.keys[t];
        if (!ts.some(okFor)) this._bad('V1', now, where, ts[ts.length - 1]);
        if (s.window && s.rows) this._bad('V2', now, where, truth);
    }
    _bad(k, now, where, truth) { this.v[k]++; if (!this.v.first) this.v.first = { k, now, where, truth: truth ? String(truth).split('\u0001')[0] : null }; }
    _apply(s, op, now) {
        if (op.op === 'window') s.window = op.open;
        else if (op.op === 'rows') s.rows = op.on;
        else if (op.op === 'tab') { s.tab = op.tab; }
        else if (op.op === 'page') {
            // the old pixels stay until the new ones arrive; a key the new page drops is not relied on from the send on
            // (the model removes it at once), so the audit keeps showing the old keys until arrival
            // worst case for the rule: what the new page drops is gone at once, what it adds shows only on arrival
            const kept = {}; op.keys.forEach((x) => { if (s.keys[x]) kept[x] = true; }); s.keys = kept;
            // one connection delivers its sheets in the order they were sent (B3: SC's model let a later sheet overtake an earlier one,
            // which no socket does; it only showed when the latency draws changed)
            const last = this.pending.length ? this.pending[this.pending.length - 1].at : 0;
            this.pending.push({ at: Math.max(last, now + this.latency()), keys: op.keys, kind: op.kind });
        }
    }
    deliver(now, truth) {
        let any = false;
        this.pending = this.pending.filter((p) => {
            if (p.at > now) return true;
            const k = {}; p.keys.forEach((x) => { k[x] = true; }); this.s.keys = k; this.s.kind = p.kind; any = true; return false;
        });
        if (any) this._audit(this.s, truth, now, 'pixels arrive');
    }
    /** a rebuild: every layer dropped and made again in the state `born` */
    reset(born, now, truth) {
        this.s = { window: born.window, rows: born.rows, tab: null, keys: {}, kind: null }; this.pending = [];
        this._audit(this.s, truth, now, 'rebuild');
    }
    turn(ops, now, truth) {
        if (!ops.length) { this._audit(this.s, truth, now, 'tick'); return; }
        if (this.mode === 'atomic') { ops.forEach((op) => this._apply(this.s, op, now)); this._audit(this.s, truth, now, 'turn'); return; }
        if (this.mode === 'serial') { ops.forEach((op, i) => { this._apply(this.s, op, now); this._audit(this.s, truth, now, 'op ' + i + ' ' + op.op); }); return; }
        // interleave: every merge of the per-connection queues; the audit sees each prefix; the screen ends in send order
        const q = {};
        ops.forEach((op) => { const c = this.conns[op.op]; (q[c] = q[c] || []).push(op); });
        const queues = Object.keys(q).map((k) => q[k]);
        const base = JSON.stringify(this.s), pend = this.pending.length;
        const walk = (s, idx) => {
            let done = true;
            for (let i = 0; i < queues.length; i++) {
                if (idx[i] >= queues[i].length) continue;
                done = false;
                const s2 = JSON.parse(JSON.stringify(s));
                this._apply(s2, queues[i][idx[i]], now);
                this._audit(s2, truth, now, 'interleave ' + queues[i][idx[i]].op);
                const idx2 = idx.slice(); idx2[i]++;
                walk(s2, idx2);
            }
            return done;
        };
        const s0 = JSON.parse(base);
        walk(s0, queues.map(() => 0));
        this.pending.length = pend;
        ops.forEach((op) => this._apply(this.s, op, now));
    }
}

module.exports = { CARD, SETTLE_MS, measure, missing, wrap, deps, layoutTab2, makeMachine, keyOf, CarSim, Screen, TW };
