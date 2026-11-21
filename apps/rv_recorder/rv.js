'use strict';
/**
 * rv.js - the RV recorder's engine (round "Road View", package TS; fixes-1121 CR: the choices CAM, CRUISE, NAV): READ ONLY, numbers
 * and enum names only.
 *
 * A recording records ONE choice (rv_fields.js SETS: S19 RV, S20 CAM, S21 CRUISE, S22 NAV). Nothing is subscribed until the first
 * recording starts (a press on "Почати запис ..."); then every interface the chosen set reads is subscribed once (with every field the
 * table reads on it, so a later choice needs no second subscription), one at a time with a short pause, and stays subscribed (a value
 * that arrives while no recording of its set runs is ignored). Calls made on the car: signals.watch (the kit subscribes and reads
 * each getter once), and signals.get once per "rs" field of the set when a later recording starts (its getter: the value has not
 * changed, so no notification would bring it). No setter, no method.
 *
 * NAV's sources carry an allow-list (`pick`): only those members of a value reach the recording and the log; a text becomes its
 * length; a position, a destination, a road name or an id is never kept (project() below).
 *
 * While a recording runs (shared/signal_recorder.js, the chosen set):
 *   - a "full" source: every message to the recording, unthrottled;
 *   - a "list" source: its first message of the recording whole, the next message whole after each mark, and once a second a
 *     summary sample "<tag>~1s": msgs, the object count, distinct ids / classes (the first 6), ranges, list lengths, qualifiers;
 *   - the first message of every source, once per recording, also as ONE log line with every raw member (shared/signal_format.js
 *     fmtTree: numbers and enum names; no time stamp, no counter, no coordinate, no skipped member). That line answers "does the
 *     car send it" from the log alone;
 *   - a source with `log` (rv_fields.js): a change of its watched members is one log line ("change <tag> ..."), at most 300;
 *   - marks: the menu's "Позначка N" and, with the setting "tripMark", the stalk's TRIP button (the rising edge of bit 0x40);
 *   - at +30 s, +120 s and +600 s of a recording: which sources spoke (messages, rate) and which stayed silent, the providers.
 *
 * Log lines (English, numbers and enum names only):
 *   rv: start rv_recorder v=0.2.0 sets=RV:S19/39/22,CAM:S20/70/31,CRUISE:S21/34/20,NAV:S22/43/17 sources=123 interfaces=46 tripMark=1
 *   rv: rec: set CAM (S20): 70 sources on 31 interfaces
 *   rv: watch TrafficLightRecognitionFrontCameraLegacy[1] sources=1 ok 40ms
 *   rv: first tl t=12.4: trafficLightID=3 trafficLightPositionX=118 ... qualityRecognitionTrafficLight=90
 *   rv: mark M2 t=85.9 tms=85894 via=trip
 *   rv: summary +30s: RV heard 9 of 39: tl(41, 1.4/s) ... | silent: road-segment, ...
 *   rv: summary +30s: providers up=17 down=2 down-list: RoadOutputAssistedDrivingView, ...
 *
 * Never throws out of a callback: a failing handler logs one warning, the car's notifications go on (an uncaught exception ends an
 * OAP app; a second unexpected exit uninstalls it). Node 8.16: no ?. / ??, no object spread, no optional catch binding.
 */
const VERSION = '0.2.0';
const SUMMARY_S = [30, 120, 600];
const HUB_PAUSE_MS = 120;
const FIRST_CHARS = 900;              // a first-message line stays one line (the longest line seen in the car's log was ~800)
const KEEP = 6;                       // distinct ids / classes written per summary
const TRACK = 64;                     // distinct values tracked per second (memory bound)
const SCAN = 64;                      // list entries looked at per message (CPU bound)
const LOG_CAP = 300;                  // change lines per source and recording (a source with `log`)
const ENUM_RE = /^[A-Z_][A-Z0-9_]{0,95}$/;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const short = (iface) => String(iface).split('.').pop();
const msg = (e) => String(e && e.message || e).replace(/[^\x20-\x7e]/g, '?').slice(0, 120);
const isNum = (x) => typeof x === 'number' && isFinite(x);

/** Every value at a path: "a.b" one member, "a[].b" member b of every entry of the list a (at most SCAN entries). */
function pick(v, path) {
    let cur = [v];
    const parts = String(path).split('.');
    for (let i = 0; i < parts.length; i++) {
        const many = /\[\]$/.test(parts[i]);
        const key = many ? parts[i].slice(0, -2) : parts[i];
        const next = [];
        for (let j = 0; j < cur.length; j++) {
            const x = cur[j];
            if (x === null || typeof x !== 'object') continue;
            const y = x[key];
            if (many) { if (Array.isArray(y)) for (let k = 0; k < y.length && k < SCAN; k++) next.push(y[k]); } else if (y !== undefined) next.push(y);
        }
        cur = next;
    }
    return cur;
}
/** fixes-1121 CR: one allow-listed member of a value (rv_fields.js `pick`): a number, a bool or an enum name as it is, a text as its
 *  length, anything else (a struct, a list, a buffer) null. "a.*.b": the first member of a that has b; "a#n" a list's length;
 *  "a.[].b#mask" the bools of a list as a bit mask (first 16); "@a" the name of the member the union a holds, in capitals. */
function pickOne(v, path) {
    if (typeof path !== 'string') return null;
    if (path.charAt(0) === '@') {
        const u = pickOne.raw(v, path.slice(1));
        const k = u && typeof u === 'object' && !Array.isArray(u) ? Object.keys(u).filter((x) => u[x] !== undefined && u[x] !== null)[0] : undefined;
        return k ? k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase().slice(0, 60) : null;
    }
    const m = /^(.*)#(n|mask)$/.exec(path);
    if (m && m[2] === 'n') { const a = pickOne.raw(v, m[1]); return Array.isArray(a) ? a.length : null; }
    if (m && m[2] === 'mask') {
        const at = m[1].indexOf('.[].');
        if (at < 0) return null;
        const list = pickOne.raw(v, m[1].slice(0, at));
        if (!Array.isArray(list)) return null;
        let bits = 0;
        for (let i = 0; i < list.length && i < 16; i++) if (pickOne.raw(list[i], m[1].slice(at + 4)) === true) bits |= (1 << i);
        return bits;
    }
    const x = pickOne.raw(v, path);
    if (typeof x === 'number') return isFinite(x) ? x : null;
    if (typeof x === 'boolean') return x;
    if (typeof x === 'string') return ENUM_RE.test(x) ? x : x.length;
    return null;
}
/** The raw value at a path ("" the value itself; "*" the first member that leads somewhere). */
pickOne.raw = function raw(v, path) {
    if (path === '') return v;
    const parts = path.split('.');
    const walk = (x, i) => {
        if (i === parts.length) return x;
        if (x === null || typeof x !== 'object') return undefined;
        if (parts[i] === '*') {
            const keys = Object.keys(x);
            for (let k = 0; k < keys.length; k++) { const y = walk(x[keys[k]], i + 1); if (y !== undefined && y !== null) return y; }
            return undefined;
        }
        return walk(x[parts[i]], i + 1);
    };
    return walk(v, 0);
};
/** A value cut to its allow-list: { name: member } with only numbers, bools and enum names (null where it is missing). */
function project(v, pick) {
    const o = {};
    Object.keys(pick).forEach((k) => { o[k] = pickOne(v, pick[k]); });
    return o;
}

/** A value a summary keeps: a finite number or an enum name (anything else is left out, never a text). */
const keepable = (x) => isNum(x) || (typeof x === 'string' && /^[A-Z_][A-Z0-9_]{0,95}$/.test(x)) || typeof x === 'boolean';
const sortVals = (a) => a.sort((x, y) => (typeof x === typeof y ? (x < y ? -1 : x > y ? 1 : 0) : typeof x === 'number' ? -1 : 1));

/** A summary's empty accumulator for one source. */
function newAcc(f) {
    const s = f.sum || {};
    const a = { msgs: 0, count: null, ids: {}, nIds: 0, cls: {}, rng: {}, len: {}, q: { set: {}, n: 0 } };
    Object.keys(s.cls || {}).forEach((k) => { a.cls[k] = { set: {}, n: 0 }; });
    Object.keys(s.rng || {}).forEach((k) => { a.rng[k] = { min: null, max: null }; });
    Object.keys(s.len || {}).forEach((k) => { a.len[k] = null; });
    return a;
}
function addDistinct(box, x) {
    const k = typeof x + ':' + x;
    if (box.set[k] !== undefined || box.n >= TRACK) return;
    box.set[k] = x; box.n++;
}
/** One message into the accumulator. */
function accumulate(a, f, v) {
    const s = f.sum || {};
    a.msgs++;
    if (s.count) pick(v, s.count).forEach((x) => { if (isNum(x) && (a.count === null || x > a.count)) a.count = x; });
    if (s.ids) pick(v, s.ids).forEach((x) => { if (keepable(x)) { const k = typeof x + ':' + x; if (a.ids[k] === undefined && a.nIds < TRACK) { a.ids[k] = x; a.nIds++; } } });
    Object.keys(s.cls || {}).forEach((k) => { pick(v, s.cls[k]).forEach((x) => { if (keepable(x)) addDistinct(a.cls[k], x); }); });
    Object.keys(s.rng || {}).forEach((k) => {
        const r = a.rng[k];
        pick(v, s.rng[k]).forEach((x) => { if (isNum(x)) { if (r.min === null || x < r.min) r.min = x; if (r.max === null || x > r.max) r.max = x; } });
    });
    Object.keys(s.len || {}).forEach((k) => { pick(v, s.len[k]).forEach((x) => { const n = Array.isArray(x) ? x.length : null; if (n !== null && (a.len[k] === null || n > a.len[k])) a.len[k] = n; }); });
    if (v && typeof v === 'object' && keepable(v.eventDataQualifier)) addDistinct(a.q, v.eventDataQualifier);
}
/** Up to KEEP values, sorted, as { n, v0..v5 } (fixed members: the recording's columns stay the same second after second). */
function fixedList(vals, n) {
    const o = { n };
    const s = sortVals(vals.slice()).slice(0, KEEP);
    for (let i = 0; i < KEEP; i++) o['v' + i] = i < s.length ? s[i] : null;
    return o;
}
/** The summary sample of one second: a plain object of numbers and enum names, the same members every time. */
function summaryOf(a, f) {
    const s = f.sum || {};
    const o = { msgs: a.msgs };
    if (s.count) o.count = a.count;
    if (s.ids) { const ids = Object.keys(a.ids).map((k) => a.ids[k]); o.ids = fixedList(ids, a.nIds); }
    Object.keys(s.cls || {}).forEach((k) => { const b = a.cls[k]; o['cls_' + k] = fixedList(Object.keys(b.set).map((x) => b.set[x]), b.n); });
    Object.keys(s.rng || {}).forEach((k) => { o[k + 'Min'] = a.rng[k].min; o[k + 'Max'] = a.rng[k].max; });
    Object.keys(s.len || {}).forEach((k) => { o[k + 'Len'] = a.len[k]; });
    o.qual = fixedList(Object.keys(a.q.set).map((x) => a.q.set[x]), a.q.n);
    return o;
}

class RoadView {
    /**
     * opts: { log: {info, warn}, signals: the kit's ctx.signals, rec: a Recorder (shared/signal_recorder.js), fmt: shared/signal_format.js,
     *         now (ms, default Date.now), table (default rv_fields.TABLE), sets (default rv_fields.SETS), cfg: { hubPauseMs, summaryS, tripMark }, version }
     */
    constructor(opts) {
        const o = opts || {};
        this.log = o.log || { info: () => {}, warn: () => {} };
        this.signals = o.signals || null;
        this.rec = o.rec || null;
        this.fmt = o.fmt || null;
        this.now = typeof o.now === 'function' ? o.now : Date.now;
        const cfg = o.cfg && typeof o.cfg === 'object' ? o.cfg : {};
        this.hubPause = isNum(cfg.hubPauseMs) ? cfg.hubPauseMs : HUB_PAUSE_MS;
        this.summaryS = Array.isArray(cfg.summaryS) ? cfg.summaryS.filter(isNum).sort((a, b) => a - b) : SUMMARY_S;
        this.tripMark = cfg.tripMark !== false;
        this.version = o.version || VERSION;
        this.table = o.table || require('./rv_fields').TABLE;
        this.sets = o.sets || require('./rv_fields').SETS;
        this.set = this.sets[0].id;         // the set of the recording that runs or ran last
        this.t0 = this.now();
        this.on = false;                    // a recording runs
        this.listening = false;             // any interface subscribed
        this.hubs = {};
        this.queue = Promise.resolve();
        this.timer = null;
        this.markN = 0; this.lastMark = null;
        this.recAt = 0; this.summaries = 0;
        this.sources = this.table.map((f) => this._source(f));
    }

    _source(f) {
        const st = {
            f, sets: f.sets || [this.sets[0].id], n: 0, total: 0, wroteAt: null, thinned: 0, firstAt: null, lastAt: null, warned: false, wholeNext: false, lastLog: null, logN: 0, acc: f.kind === 'list' ? newAcc(f) : null, prevBits: null, hub: null,
            // what the recorder sees: the source as a recorder field (its skip list, its list cap) and, for a list, its summary
            recSt: { f: { tag: f.tag, iface: f.iface, field: f.field, tree: f.skip ? { skip: f.skip } : undefined, recEntries: f.recEntries, recSame: f.recSame } },
            sumSt: f.kind === 'list' ? { f: { tag: f.tag + '~1s', iface: f.iface, field: f.field + '~1s' } } : null,
        };
        st.handler = (v) => {
            if (!this.on || st.sets.indexOf(this.set) < 0) return;
            try { this._value(st, f.pick ? project(v, f.pick) : v); } catch (e) {
                if (!st.warned) { st.warned = true; this._warn(f.tag + ': ' + msg(e)); }
            }
        };
        return st;
    }

    // ---- logging -----------------------------------------------------------------------------------------------------------
    _info(s) { try { this.log.info('rv: ' + s); } catch (e) { /* a failing log */ } }
    _warn(s) { try { this.log.warn('rv: ' + s); } catch (e) { /* a failing log */ } }
    _t() { return Math.round((this.now() - (this.on ? this.recAt : this.t0)) / 100) / 10; }

    startLine() {
        const F = require('./rv_fields');
        const n = Object.keys(F.manifestSignals()).length;
        this._info('start rv_recorder v=' + this.version + ' sets=' + this.sets.map((s) => s.label + ':' + s.id + '/' + this.sources.filter((st) => st.sets.indexOf(s.id) >= 0).length + '/' + F.interfaces(s.id).length).join(',') +
            ' sources=' + this.sources.length + ' interfaces=' + n + ' tripMark=' + (this.tripMark ? 1 : 0));
    }
    /** The sources of a set (the one recording, by default). */
    inSet(id) { const x = id || this.set; return this.sources.filter((st) => st.sets.indexOf(x) >= 0); }
    label(id) { const s = this.sets.find((x) => x.id === (id || this.set)); return s ? s.label : String(id || this.set); }

    // ---- subscriptions: one proxy per interface instance, built at the first recording that needs it, kept ---------------------------
    /** Subscribe the interfaces the set `id` reads that are not subscribed yet; each with every field the table reads on it. */
    listen(id) {
        const want = id || this.set;
        this.listening = true;
        const fresh = [];
        this.sources.forEach((st) => {
            if (st.sets.indexOf(want) < 0) return;
            const key = st.f.iface + '\u0000' + (st.f.instance || '1');
            if (!this.hubs[key]) { this.hubs[key] = { iface: st.f.iface, instance: st.f.instance || '1', handlers: {}, sub: null, error: null, ms: null, sources: [], started: false }; fresh.push(this.hubs[key]); }
        });
        // every source on a new hub, whatever its set: a later choice then finds its fields subscribed
        this.sources.forEach((st) => {
            const h = this.hubs[st.f.iface + '\u0000' + (st.f.instance || '1')];
            if (!h || fresh.indexOf(h) < 0) return;
            h.handlers[st.f.field] = st.handler;
            h.sources.push(st);
            st.hub = h;
        });
        fresh.forEach((h) => {
            this.queue = this.queue.then(() => this._build(h)).then(() => sleep(this.hubPause)).catch((e) => { this._warn('watch ' + short(h.iface) + ': ' + msg(e)); });
        });
        return this.queue;
    }
    _build(h) {
        h.started = true;
        if (!this.signals || typeof this.signals.watch !== 'function') { h.error = 'no signals'; return Promise.resolve(); }
        const t0 = Date.now();
        return Promise.resolve().then(() => this.signals.watch(h.iface, h.instance, h.handlers, this.log)).then((res) => {
            h.sub = res; h.ms = Date.now() - t0;
            this._info('watch ' + short(h.iface) + '[' + h.instance + '] sources=' + h.sources.length + (res && res.error ? ' error: ' + msg(res.error) : ' ok ' + h.ms + 'ms'));
        }, (e) => { h.error = msg(e); this._info('watch ' + short(h.iface) + '[' + h.instance + '] error: ' + h.error); });
    }
    /** A later recording: each "rs" field's getter of the set once, on an interface already subscribed (its value has not changed,
     *  so no notification would bring it; a new interface's watch reads its getters itself). */
    _askAll(old) {
        this.inSet().filter((st) => st.f.flags === 'rs' && old.indexOf(st.hub) >= 0).forEach((st) => {
            const h = st.hub;
            if (!h || !h.sub || !h.sub.proxy || !h.sub.available || !this.signals || typeof this.signals.get !== 'function') return;
            Promise.resolve().then(() => this.signals.get(h.sub.proxy, st.f.field, 3000)).then((v) => { st.handler(v); }, () => null).catch(() => null);
        });
    }
    idle() { return this.queue; }

    // ---- a recording ----------------------------------------------------------------------------------------------------------
    /** Start a recording of the set `id` (default: the first, S19); returns true when it runs. */
    begin(id) {
        if (this.on) return true;
        const want = id && this.sets.some((s) => s.id === id) ? id : this.sets[0].id;
        if (!this.rec || !this.rec.start([want])) return false;
        this.set = want;
        this.on = true; this.recAt = this.now(); this.summaries = 0;       // the mark numbers go on over the app's run (the notes' M<n> stay unique)
        this.sources.forEach((st) => { st.n = 0; st.firstAt = null; st.lastAt = null; st.wholeNext = false; st.prevBits = null; st.lastLog = null; st.logN = 0; st.wroteAt = null; st.thinned = 0; if (st.acc) st.acc = newAcc(st.f); });
        const old = Object.keys(this.hubs).map((k) => this.hubs[k]);
        this.listen(want);
        if (old.length) this._askAll(old);
        this._info('rec: set ' + this.label() + ' (' + want + '): ' + this.inSet().length + ' sources on ' + this._hubsOf(want).length + ' interfaces');
        return true;
    }
    _hubsOf(id) { const out = []; this.inSet(id).forEach((st) => { if (st.hub && out.indexOf(st.hub) < 0) out.push(st.hub); }); return out; }
    end() {
        if (!this.on) return;
        this._flushSums();
        const mine = this.inSet();
        const heard = mine.filter((st) => st.n > 0).map((st) => st.f.tag);
        const thin = mine.filter((st) => st.thinned > 0).map((st) => st.f.tag + ' ' + st.thinned);
        this._info('stop after ' + this._t() + ' s: heard ' + heard.length + ' of ' + mine.length + ': ' + (heard.join(', ') || 'none') + (thin.length ? ' | thinned (everyMs): ' + thin.join(', ') : ''));
        this.on = false;
        try { this.rec.stop(); } catch (e) { /* the recorder guards itself */ }
    }

    _value(st, v) {
        const f = st.f, t = this.now();
        st.n++; st.total++; st.lastAt = t;
        if (st.n === 1) { st.firstAt = t; this._first(st, v); }
        if (f.log) this._change(st, v);
        if (f.trip) this._trip(st, v);
        if (f.kind === 'list') {
            if (st.n === 1 || st.wholeNext) { st.wholeNext = false; this._sample(st.recSt, v); }
            accumulate(st.acc, f, v);
        } else if (f.everyMs > 0) {
            // fixes-1121 CR: a heavy "full" source (the lanes, the chassis' curvature) writes at most one message every everyMs; the
            // first after a mark always; the ones between are counted (the stop line says how many)
            if (st.n === 1 || st.wholeNext || st.wroteAt === null || t - st.wroteAt >= f.everyMs) { st.wholeNext = false; st.wroteAt = t; this._sample(st.recSt, v); } else st.thinned++;
        } else this._sample(st.recSt, v);
    }
    _sample(rst, v) { if (this.rec && this.rec.on) { try { this.rec.sample(rst, v); } catch (e) { /* the recorder guards itself */ } } }

    /** "first <tag> t=..: <every raw member>" once per recording: numbers and enum names (shared/signal_format.js fmtTree). */
    _first(st, v) {
        const f = st.f;
        let body = '?';
        try { body = this.fmt ? this.fmt.fmtTree(v, { max: FIRST_CHARS, entries: 4, skip: f.skip || [] }) : 'no formatter'; } catch (e) { body = 'unreadable: ' + msg(e); }
        this._info('first ' + f.tag + ' t=' + this._t() + ': ' + body);
    }

    /** A source with `log`: its watched members (or its whole value) as one key; a new key is a "change" line (the first one is the
     *  "first" line already), at most LOG_CAP a recording. TR-REPORT D.4: the limit, no overtaking, the country coding, the display's
     *  sign, the warning symbol, the traffic-light functions' states, the settings' availability, "once at start and on change". */
    _change(st, v) {
        const f = st.f;
        let key;
        if (f.log === true) key = this.fmt ? this.fmt.fmtTree(v, { max: FIRST_CHARS, entries: 4, skip: f.skip || [] }) : '?';
        else key = f.log.map((p) => { const x = pick(v, p)[0]; return p.split('.').pop() + '=' + (x === undefined ? '-' : keepable(x) ? String(x) : '?'); }).join(' ');
        if (key === st.lastLog) return;
        const was = st.lastLog;
        st.lastLog = key;
        if (was === null || st.logN >= LOG_CAP) return;
        st.logN++;
        this._info('change ' + f.tag + ' t=' + this._t() + ': ' + key + (st.logN === LOG_CAP ? ' (the last change line for this source)' : ''));
    }

    /** The TRIP button: the rising edge of its bit is a mark (255 = the catalogue's unfilled default: no state, and the edge after it is no press). */
    _trip(st, v) {
        const tr = st.f.trip;
        const x = v && typeof v === 'object' ? v[tr.path] : undefined;
        if (!isNum(x)) return;
        if (x === tr.unfilled) { st.prevBits = null; return; }       // no state: the next edge is not a press
        const was = st.prevBits;
        st.prevBits = x;
        if (this.tripMark && was !== null && !(was & tr.mask) && (x & tr.mask)) this.mark('trip');
    }

    // ---- marks ----------------------------------------------------------------------------------------------------------------
    /** A mark: in the recording (#m), one log line, and the next message of every list source written whole. */
    mark(via) {
        const t = this.now();
        this.markN++;
        this.lastMark = { n: this.markN, at: t, via: via || 'menu' };
        this._info('mark M' + this.markN + ' t=' + this._t() + ' tms=' + Math.round(t - (this.on ? this.recAt : this.t0)) + ' via=' + (via || 'menu') + (this.on ? '' : ' (no recording)'));
        if (this.on) {
            try { this.rec.mark(this.markN); } catch (e) { /* the recorder guards itself */ }
            this.inSet().forEach((st) => { if (st.f.kind === 'list' || st.f.everyMs > 0) st.wholeNext = true; });
        }
        return this.markN;
    }

    // ---- the clock ------------------------------------------------------------------------------------------------------------
    _flushSums() {
        this.sources.forEach((st) => {
            if (!st.acc || !st.acc.msgs) return;
            try { this._sample(st.sumSt, summaryOf(st.acc, st.f)); } catch (e) { if (!st.warned) { st.warned = true; this._warn(st.f.tag + ' summary: ' + msg(e)); } }
            st.acc = newAcc(st.f);
        });
    }
    /** About once a second: the list sources' summaries, the recording's summary lines. */
    tick() {
        if (!this.on) return;
        if (this.rec && !this.rec.on) { this._info('the recorder stopped (' + (this.rec.error || 'quota or write error') + '): the recording ends'); this.on = false; return; }
        this._flushSums();
        const s = (this.now() - this.recAt) / 1000;
        while (this.summaries < this.summaryS.length && s >= this.summaryS[this.summaries]) { this._summary(this.summaryS[this.summaries]); this.summaries++; }
    }
    _summary(s) {
        const mine = this.inSet(), heard = mine.filter((st) => st.n > 0), silent = mine.filter((st) => st.n === 0);
        this._info('summary +' + s + 's: ' + this.label() + ' heard ' + heard.length + ' of ' + mine.length + ': ' +
            (heard.map((st) => st.f.tag + '(' + st.n + ', ' + (Math.round(st.n / Math.max(1, s) * 10) / 10) + '/s)').join(' ') || 'none') + ' | silent: ' + (silent.map((st) => st.f.tag).join(', ') || 'none'));
        const hubs = this._hubsOf();
        const down = hubs.filter((h) => !h.sub || !h.sub.available), err = hubs.filter((h) => h.error || (h.sub && h.sub.error));
        this._info('summary +' + s + 's: providers up=' + (hubs.length - down.length) + ' down=' + down.length + ' error=' + err.length + (down.length ? ' down-list: ' + down.map((h) => short(h.iface)).join(', ') : ''));
    }
    start() {
        if (this.timer) return;
        this.timer = setInterval(() => { try { this.tick(); } catch (e) { this._warn('tick: ' + msg(e)); } }, 1000);
        if (this.timer && this.timer.unref) this.timer.unref();
    }
    stop() { clearInterval(this.timer); this.timer = null; }

    /** { on, set, label, listening, sources, heard, hubs: { built, up, error }, marks, lastMark } of the set that records or recorded
     *  last (the menu's status line, tests). */
    status() {
        const hubs = this._hubsOf(), mine = this.inSet();
        return { on: this.on, set: this.set, label: this.label(), listening: this.listening, sources: mine.length, heard: mine.filter((st) => st.n > 0).length,
            hubs: { built: hubs.filter((h) => h.sub || h.error).length, up: hubs.filter((h) => h.sub && h.sub.available && !h.sub.error).length, error: hubs.filter((h) => h.error || (h.sub && h.sub.error)).length },
            marks: this.markN, lastMark: this.lastMark };
    }
}

module.exports = { RoadView, VERSION, SUMMARY_S, KEEP, LOG_CAP, pick, pickOne, project, newAcc, accumulate, summaryOf, fixedList };
