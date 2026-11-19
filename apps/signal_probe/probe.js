'use strict';
/**
 * probe.js - the signal probe's engine: READ ONLY, LOG ONLY.
 *
 * What it does: for each SET (S1..S9, fields.js) that is switched on, it subscribes the set's fields through the kit's
 * signals.watch (one proxy per interface instance, built only when a set needs it, one hub at a time with a short pause so the
 * start of a set is not a burst), and logs every field's value ONCE PER CHANGE as numbers, enum names and text LENGTHS. It never
 * reads, logs or keeps the text of a message, a song, a call, a road or an address; never a coordinate or a bearing; never a byte
 * of a picture. It calls no setter and no method: the only call it ever makes on the car is signals.get (a field's getter) - for
 * a field that stayed silent at +2 min, and once when a set is switched on again.
 *
 * Log lines (one per change; "t" = seconds since the probe started, "#" = how many lines this field has made):
 *
 *   probe: start signal_probe v=0.1.0 fmt=1 sets=S1+S6 fields=31
 *   probe: sets on=S1+S6+S7 changed=+S7 fields=52
 *   probe: P3 range-tank #2 t=41.3: fuel=38 fuelL=- fuelR=- spare=NICHT_AKTIV range=412 mileage=48215
 *   probe: P13 stalk #3 t=88.1: stalks=64(0x40) prev=0(0x0) up=0x40 down=0x0 tms=88104 since=M2+2210
 *   probe: mark M2 t=85.9 tms=85894 sets=S1+S6
 *   probe: summary S6 +30s: 5 of 31 fields have spoken: P11 ic-widget(1 events, 1 lines), ...
 *   probe: summary S6 +30s: silent: P13 sw-fav, ...
 *   probe: summary S6 +30s: providers: up=7 down=1 error=0 down-list: Lifecycle[Front]
 *   probe: ask P13 sw-fav (silent at +120s): answered (struct)
 *   probe: watch Light[1] set=S6 fields=2 ok 140ms
 *
 * A field that changes faster than its gap is logged at most once per gap (the last value wins, "(+k folded)" says how many were
 * folded away) and at most `cap` times (the last line says so); a flood guard holds lines back beyond 40 per second. S6's stalk and
 * button fields have gap 0: every change is a line, and carries "tms=" (ms since the probe started) and "since=M<n>+<ms>" (the time
 * after the last "Позначка" press), so one short press shows which bit moved and how soon after the mark.
 *
 * Never throws: a failing handler logs one warning, and the car's notifications go on (an uncaught exception ends an OAP app, and
 * a second unexpected exit uninstalls it). Node 8.16: no ?. / ??, no object spread, no optional catch binding.
 */
const F = require('./format');
const FIELDS = require('./fields');

const VERSION = '0.2.0';
const LOG_FORMAT = 1;
const SUMMARY_S = [30, 120, 600];
const ASK_AT_S = 120;                 // the silent fields' getters are asked once, at this summary
const HUB_PAUSE_MS = 120;             // between two interfaces' proxies being built
const FLOOD_PER_S = 40;
const VOLUME_WARN_BYTES = 150 * 1024;

const PART_CHARS = 1000;
/** A line body in parts of at most PART_CHARS characters, each cut at a space (a token longer than that is cut where it must). */
function splitBody(body) {
    const parts = [];
    let rest = body;
    while (rest.length > PART_CHARS) {
        let at = rest.lastIndexOf(' ', PART_CHARS);
        if (at <= 0) at = PART_CHARS;
        parts.push(rest.slice(0, at));
        rest = rest.slice(at).replace(/^ /, '');
    }
    parts.push(rest);
    return parts;
}
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const short = (iface) => String(iface).split('.').pop();
const msg = (e) => String(e && e.message || e).replace(/[^\x20-\x7e]/g, '?').slice(0, 120);

class Probe {
    /**
     * opts: { log: {info, warn}, signals: the kit's ctx.signals, now (default Date.now), cfg: { summaryS, hubPauseMs, maxLines, minGapMs },
     *         table (default the field table, for tests), version }
     */
    constructor(opts) {
        const o = opts || {};
        this.log = o.log || { info: () => {}, warn: () => {} };
        this.signals = o.signals || null;
        this.now = typeof o.now === 'function' ? o.now : Date.now;
        const cfg = o.cfg && typeof o.cfg === 'object' ? o.cfg : {};
        this.summaryS = Array.isArray(cfg.summaryS) ? cfg.summaryS.filter(F.isNum).sort((a, b) => a - b) : SUMMARY_S;
        this.hubPause = F.isNum(cfg.hubPauseMs) ? cfg.hubPauseMs : HUB_PAUSE_MS;
        this.version = o.version || VERSION;
        this.table = o.table || FIELDS.TABLE;
        this.t0 = this.now();
        this.timer = null;
        this.markN = 0;
        this.lastMark = null;
        this.on = {};                     // set id -> { at, summaries }
        this.lines = 0; this.bytes = 0; this.volumeWarned = 0;
        this.flood = { sec: -1, n: 0, held: 0 };
        this.media = { active: null, ids: null };   // P8: in memory only, to say which source entry is the active one
        this.queue = Promise.resolve();
        this.hubs = {};
        this.fields = this.table.map((f) => this._field(f));
    }

    _field(f) {
        const d = FIELDS.SET_DEFAULTS[f.set] || { gapMs: 1000, cap: 60 };
        const st = { f, sets: [f.set].concat(f.also || []), holders: 0, active: false, n: 0, events: 0, last: undefined, lastAt: -Infinity, pending: null, skipped: 0, warned: false, parseUs: 0, prevNum: undefined,
            cap: f.cap || d.cap, gap: F.isNum(f.gapMs) ? f.gapMs : d.gapMs, onAt: 0, asked: false, hub: null };
        st.handler = (v) => {
            if (!st.active) return;
            try { this._value(st, v); } catch (err) {
                if (!st.warned) { st.warned = true; this._warn(f.p + ' ' + f.tag + ': ' + msg(err)); }
            }
        };
        return st;
    }

    // ---- logging ---------------------------------------------------------------------------------------------------------
    _out(level, s) {
        const line = 'probe: ' + s;
        try { this.log[level](line); } catch (e) { /* a failing log: nothing to do */ }
        this.lines++; this.bytes += line.length + 1;
        if (this.bytes - this.volumeWarned * VOLUME_WARN_BYTES >= VOLUME_WARN_BYTES) {
            this.volumeWarned = Math.floor(this.bytes / VOLUME_WARN_BYTES);
            try { this.log.info('probe: volume: ' + Math.round(this.bytes / 1024) + ' KB in ' + this.lines + ' lines since start: collect the logs (the app log keeps about 256 KB + 256 KB)'); } catch (e) { /* as above */ }
        }
    }
    _info(s) { this._out('info', s); }
    _warn(s) { this._out('warn', s); }
    _t() { return Math.round((this.now() - this.t0) / 100) / 10; }
    setsText() { return this.setsOn().join('+') || 'none'; }
    setsOn() { return FIELDS.SETS.map((s) => s.id).filter((id) => this.on[id]); }

    // ---- the sets ----------------------------------------------------------------------------------------------------------
    /** Switch the sets in `ids` on and every other one off (the app's settings are the truth). Logs the change. */
    setSets(ids, quiet) {
        const want = {};
        (ids || []).forEach((id) => { want[id] = true; });
        const before = this.setsOn();
        const added = [], removed = [];
        FIELDS.SETS.forEach((s) => {
            if (want[s.id] && !this.on[s.id]) { this._activate(s.id); added.push(s.id); }
            else if (!want[s.id] && this.on[s.id]) { this._deactivate(s.id); removed.push(s.id); }
        });
        if ((added.length || removed.length) && !quiet) {
            this._info('sets on=' + this.setsText() + ' changed=' + added.map((x) => '+' + x).concat(removed.map((x) => '-' + x)).join(',') +
                ' fields=' + this.fields.filter((st) => st.active).length + (before.length ? '' : ' (first set on)'));
        }
    }
    setSet(id, on) {
        const ids = this.setsOn().filter((x) => x !== id);
        if (on) ids.push(id);
        this.setSets(ids);
    }

    _activate(id) {
        const now = this.now();
        this.on[id] = { at: now, summaries: 0 };
        if (id === 'S4') this.media = { active: null, ids: null };
        const fresh = [];
        this.fields.forEach((st) => {
            if (st.sets.indexOf(id) < 0) return;
            st.holders++;
            if (st.holders > 1) return;                 // already on through another set (S10 shares eight fields with S6 / S7)
            const again = st.hub !== null;
            st.active = true; st.n = 0; st.events = 0; st.last = undefined; st.lastAt = -Infinity; st.pending = null; st.skipped = 0; st.asked = false;
            st.prevNum = undefined; st.onAt = now;
            fresh.push({ st, again });
        });
        const hubs = [];
        fresh.forEach((x) => {
            const h = this._hub(x.st);
            if (hubs.indexOf(h) < 0) hubs.push(h);
            h.handlers[x.st.f.field] = x.st.handler;
            if (h.callStarted && !x.again) h.later.push(x.st);
        });
        hubs.forEach((h) => { if (!h.queued) { h.queued = true; this._enqueue(h); } else if (h.sub) this._flushLater(h); });
        // a set switched on again: its proxies are there, the values are not new, so ask the getters once
        fresh.filter((x) => x.again).forEach((x) => this._ask(x.st, 'set on again'));
    }

    _deactivate(id) {
        this.fields.forEach((st) => {
            if (st.sets.indexOf(id) < 0) return;
            st.holders = Math.max(0, st.holders - 1);
            if (st.holders === 0) { st.active = false; st.pending = null; }
        });
        delete this.on[id];
    }

    // ---- hubs: one proxy per interface instance, built when a set first needs it ------------------------------------------------
    _hub(st) {
        if (st.hub) return st.hub;
        const f = st.f, inst = FIELDS.instOf(f), key = f.iface + '\u0000' + inst;
        const h = this.hubs[key] = this.hubs[key] || { iface: f.iface, instance: inst, handlers: {}, sub: null, queued: false, callStarted: false, later: [], initial: [], building: false, ms: null, error: null };
        st.hub = h;
        return h;
    }

    _enqueue(h) {
        this.queue = this.queue.then(() => this._build(h)).then(() => sleep(this.hubPause)).catch((e) => { this._warn('watch ' + short(h.iface) + ': ' + msg(e)); });
    }

    _build(h) {
        if (!this.signals || typeof this.signals.watch !== 'function') { h.error = 'no signals'; return Promise.resolve(); }
        h.callStarted = true;
        h.initial = Object.keys(h.handlers);
        const t0 = Date.now();
        const polls = this.fields.filter((st) => st.hub === h && st.active && st.f.pollMs).map((st) => st.f.pollMs);
        const set = this.fields.filter((st) => st.hub === h && st.active).map((st) => st.f.set).filter((x, i, a) => a.indexOf(x) === i).join('+');
        return Promise.resolve().then(() => this.signals.watch(h.iface, h.instance, h.handlers, this.log, polls.length ? { pollMs: Math.min.apply(null, polls) } : undefined)).then((res) => {
            h.sub = res; h.ms = Date.now() - t0;
            this._info('watch ' + short(h.iface) + '[' + h.instance + '] set=' + set + ' fields=' + h.initial.length +
                (res && res.error ? ' error: ' + msg(res.error) : ' ok ' + h.ms + 'ms'));
            this._flushLater(h);
        }, (e) => { h.error = msg(e); this._info('watch ' + short(h.iface) + '[' + h.instance + '] set=' + set + ' error: ' + h.error); });
    }

    /** Fields added to a hub after its proxy was asked for: subscribe them on the same proxy (as watch does), read their getters once. */
    _flushLater(h) {
        const list = h.later.splice(0);
        if (!list.length || !h.sub || !h.sub.proxy || !this.signals) return;
        list.forEach((st) => {
            Promise.resolve().then(() => this.signals.on(h.sub.proxy, st.f.field, st.handler, this.log)).then(() => {
                if (st.f.flags.indexOf('r') >= 0) return this._ask(st, 'added to a running interface');
                return null;
            }).catch((e) => { this._info('subscribe ' + short(h.iface) + '.' + st.f.field + ' error: ' + msg(e)); });
        });
    }

    /** One read-only getter call for a field; the outcome is one line, and the value (if any) goes through the field's handler. */
    _ask(st, why) {
        const f = st.f, h = st.hub;
        const say = (what) => { this._info('ask ' + f.p + ' ' + f.tag + ' (' + why + '): ' + what); return what; };
        if (f.flags === 'b') return Promise.resolve(say('an event (no getter)'));
        if (f.flags.indexOf('r') < 0) return Promise.resolve(say('no getter (notifier only)'));
        if (!this.signals || typeof this.signals.get !== 'function') return Promise.resolve(say('no signals.get'));
        if (!h || !h.sub) return Promise.resolve(say('not subscribed'));
        if (h.sub.error) return Promise.resolve(say('watch error: ' + msg(h.sub.error)));
        if (!h.sub.available) return Promise.resolve(say('provider not available (the interface itself never came up)'));
        if (!h.sub.proxy) return Promise.resolve(say('no proxy'));
        return Promise.resolve().then(() => this.signals.get(h.sub.proxy, f.field, 3000)).then((v) => {
            const out = say('answered (' + (v === null ? 'null' : Array.isArray(v) ? 'list' : typeof v) + ')');
            try { st.handler(v); } catch (e) { /* the handler guards itself */ }
            return out;
        }, (e) => say('error or no answer: ' + msg(e) + ' (the car does not send it)')).catch(() => null);
    }

    // ---- values -> lines -------------------------------------------------------------------------------------------------------
    _body(st, v) {
        const f = st.f;
        if (f.bits) return F.fmtBits(v, f.bits, st) + (f.cols ? ' ' + F.cols(v, f.cols) : '');
        if (f.cols) return F.cols(v, f.cols) + (f.sub ? ' ' + F.listLine(F.dig(v, f.sub.path), { member: null, cols: f.sub.cols }, f.sub.label) : '');
        if (f.list) return F.listLine(v, f.list);
        if (f.union) return F.unionLine(v, f.union);
        if (f.one) {
            // an event with one output: the binding may hand over { member: v } or v itself
            const x = v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, f.one[0]) ? v[f.one[0]] : v;
            return f.one[0] + '=' + F.KIND[f.one[1]](x);
        }
        switch (f.fmt) {
            case 'enum': return 'state=' + F.fEnum(v);
            case 'bool': return 'active=' + F.fBool(v);
            case 'hex': return 'widget=' + F.fHex(v);
            case 'temps': return F.fmtTemps(v);
            case 'intersection': return F.fmtIntersection(v, st);
            case 'description': return F.fmtDescription(v);
            case 'dart': return F.fmtDart(v);
            case 'lanes': return F.fmtLanes(v);
            case 'mediaMenu': return F.fmtMediaMenu(v);
            case 'station': return F.fmtStation(v);
            case 'metadata': return F.fmtMetadata(v);
            case 'roles': return F.fmtRoles(v);
            case 'devices': return F.fmtDevices(v);
            case 'calllist': return F.fmtCallList(v);
            case 'cbs': return F.fmtCbs(v);
            case 'tree': return F.fmtTree(v, f.tree);
            case 'activeSource': {
                this.media.active = typeof v === 'string' ? v : null;       // kept in memory for the match below, never logged
                return 'len=' + F.fLen(v) + ' matches-source-entry=' + this._mediaMatch();
            }
            case 'sources': {
                const ids = [];
                const line = !Array.isArray(v) ? F.notA('a list', v) : (() => {
                    v.forEach((el) => ids.push(el && typeof el === 'object' && typeof el.sourceId === 'string' ? el.sourceId : null));
                    this.media.ids = ids;
                    return 'entries=' + v.length + ' ' + v.slice(0, F.MAX_ENTRIES).map((el, i) => (el && typeof el === 'object'
                        ? '[#' + i + ' type=' + F.fEnum(el.playerType) + ' selectable=' + F.fBool(el.selectable) + ' order=' + F.fNum(el.insertionOrder) +
                          ' id-len=' + F.fLen(el.sourceId) + ' text-len=' + F.fLen(el.displayText) + ' instance-len=' + F.fLen(el.instanceId) + ']' : '[?]')).join(' ') +
                        (v.length > F.MAX_ENTRIES ? ' +' + (v.length - F.MAX_ENTRIES) + ' more' : '');
                })();
                return line + (Array.isArray(v) ? ' active-is-entry=' + this._mediaMatch() : '');
            }
            default: return '?';
        }
    }
    /** Which sources entry carries the active source id: its index, "none", or "unknown" (one of the two not read yet). */
    _mediaMatch() {
        const m = this.media;
        if (m.active === null || m.ids === null) return 'unknown';
        const i = m.ids.indexOf(m.active);
        return i < 0 ? 'none' : String(i);
    }

    _value(st, v) {
        st.events++;
        const body = this._body(st, v);
        // the parse time in a P12 line changes with every call: compare what the car said, not how long it took
        const key = st.f.fmt === 'intersection' ? body.replace(/ parse<=[0-9.]+ms$/, '') : body;
        if (key === st.last) { st.pending = null; return; }
        if (st.n >= st.cap) return;
        const t = this.now();
        if (t - st.lastAt < st.gap) { if (st.pending !== null) st.skipped++; st.pending = { body, key, at: t }; return; }
        if (!this._floodOk(st.gap === 0)) { st.pending = { body, key, at: t }; return; }
        this._emit(st, body, key, t, t);
    }

    _floodOk(urgent) {
        const sec = Math.floor(this.now() / 1000), fl = this.flood;
        if (fl.sec !== sec) { fl.sec = sec; fl.n = 0; }
        if (urgent || fl.n < FLOOD_PER_S) { fl.n++; return true; }
        fl.held++;
        return false;
    }

    /** `seenAt` = when the car sent the value (a held-back line says when it came, not when it went out). */
    _emit(st, body, key, t, seenAt) {
        st.n++;
        const f = st.f;
        let tail = '';
        if (f.mark) {
            const ms = Math.round(seenAt - this.t0);
            tail = ' tms=' + ms + ' since=' + (this.lastMark ? 'M' + this.lastMark.n + '+' + Math.max(0, Math.round(seenAt - this.lastMark.at)) : '-');
        }
        // a long whole value (fmt tree: S14 / S15 object lists) goes out in parts of at most PART_CHARS, cut between two tokens: the longest line
        // seen in the car's log was ~800 characters, and a logger that cuts long lines must not lose the end of a list
        const parts = f.fmt === 'tree' ? splitBody(body) : [body];      // only the S14 / S15 whole values: every older line stays one line
        this._info(f.p + ' ' + f.tag + ' #' + st.n + ' t=' + this._t() + ': ' + parts[0] + (parts.length > 1 ? ' (part 1/' + parts.length + ')' : '') + tail +
            (st.skipped ? ' (+' + st.skipped + ' folded)' : '') + (st.n >= st.cap ? ' (the last line for this field)' : ''));
        for (let i = 1; i < parts.length; i++) this._info(f.p + ' ' + f.tag + ' #' + st.n + ' part ' + (i + 1) + '/' + parts.length + ': ' + parts[i]);
        st.last = key; st.lastAt = t; st.pending = null; st.skipped = 0;
    }

    // ---- marks ---------------------------------------------------------------------------------------------------------------------
    /** The owner's "Позначка N": one line the protocol's steps can be found by; returns the mark's number. */
    mark() {
        const t = this.now();
        this.markN++;
        this.lastMark = { n: this.markN, at: t };
        this._info('mark M' + this.markN + ' t=' + this._t() + ' tms=' + Math.round(t - this.t0) + ' sets=' + this.setsText());
        return this.markN;
    }

    // ---- the clock: held-back lines, summaries ---------------------------------------------------------------------------------------
    /** Called about once a second. */
    tick() {
        const t = this.now();
        this.fields.forEach((st) => {
            if (!st.active || !st.pending || st.pending.key === st.last || st.n >= st.cap || t - st.lastAt < st.gap) return;
            if (!this._floodOk(st.gap === 0)) return;
            this._emit(st, st.pending.body, st.pending.key, t, st.pending.at);
        });
        Object.keys(this.on).forEach((id) => {
            const o = this.on[id];
            while (o.summaries < this.summaryS.length && (t - o.at) / 1000 >= this.summaryS[o.summaries]) {
                const s = this.summaryS[o.summaries];
                o.summaries++;
                this._summary(id, s);
            }
        });
    }

    _summary(id, s) {
        const mine = this.fields.filter((st) => st.sets.indexOf(id) >= 0 && st.active);
        const heard = mine.filter((st) => st.events > 0), silent = mine.filter((st) => st.events === 0);
        const nm = (st) => st.f.p + ' ' + st.f.tag;
        this._info('summary ' + id + ' +' + s + 's: ' + heard.length + ' of ' + mine.length + ' fields have spoken: ' +
            (heard.map((st) => nm(st) + '(' + st.events + ' events, ' + st.n + ' lines)').join(', ') || 'none'));
        this._info('summary ' + id + ' +' + s + 's: silent: ' + (silent.map(nm).join(', ') || 'none'));
        const hubs = [];
        mine.forEach((st) => { if (st.hub && hubs.indexOf(st.hub) < 0) hubs.push(st.hub); });
        const down = hubs.filter((h) => !h.sub || !h.sub.available), err = hubs.filter((h) => h.error || (h.sub && h.sub.error));
        this._info('summary ' + id + ' +' + s + 's: providers: up=' + (hubs.length - down.length) + ' down=' + down.length + ' error=' + err.length +
            (down.length ? ' down-list: ' + down.map((h) => short(h.iface) + '[' + h.instance + ']').join(', ') : '') +
            ' volume=' + this.lines + ' lines ' + Math.round(this.bytes / 1024) + ' KB flood-held=' + this.flood.held);
        if (s === this.summaryS.filter((x) => x >= ASK_AT_S)[0]) {
            silent.filter((st) => !st.asked).forEach((st) => { st.asked = true; this._ask(st, 'silent at +' + s + 's'); });
        }
    }

    /** A promise that settles when every interface asked for so far has been subscribed (tests, the menu). */
    idle() { return this.queue; }

    /** { built, up, down, error } over the interfaces a set has asked for (the menu's status line). */
    hubStats() {
        const hubs = Object.keys(this.hubs).map((k) => this.hubs[k]).filter((h) => h.callStarted);
        const up = hubs.filter((h) => h.sub && h.sub.available && !h.sub.error).length;
        return { built: hubs.length, up, error: hubs.filter((h) => h.error || (h.sub && h.sub.error)).length };
    }

    /** { set, p, tag, events, lines, silent, active } per field (tests; the summary lines are the same data). */
    stats() {
        return this.fields.map((st) => ({ set: st.f.set, p: st.f.p, tag: st.f.tag, iface: st.f.iface, field: st.f.field, active: st.active, events: st.events, lines: st.n, silent: st.events === 0 }));
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => { try { this.tick(); } catch (e) { this._warn('tick: ' + msg(e)); } }, 1000);
        if (this.timer && this.timer.unref) this.timer.unref();
    }
    stop() { clearInterval(this.timer); this.timer = null; }

    /** The first line of a run: version, log format, the sets (call after setSets). */
    startLine() {
        this._info('start signal_probe v=' + this.version + ' fmt=' + LOG_FORMAT + ' sets=' + this.setsText() + ' fields=' + this.fields.filter((st) => st.active).length + ' of ' + this.fields.length);
    }
}

module.exports = { Probe, VERSION, LOG_FORMAT, SUMMARY_S, ASK_AT_S, FLOOD_PER_S, PART_CHARS, splitBody };
