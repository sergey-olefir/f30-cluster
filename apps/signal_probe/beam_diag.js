'use strict';
/**
 * beam_diag.js - beam HS: the HB set's READ-ONLY diagnostic reads (the owner's decision of 2026-11-20, docs/highbeam/ROUND.md
 * section 3 "Owner's decisions"). OFF by default: setting "hbdiag", and only while set S18 is on.
 *
 * The only route is kit/runtime/readonly-diag.js (ReadOnlyDiag), which refuses everything but 0x22 ReadDataByIdentifier before it
 * reaches the transport. On top of it this file keeps its own ALLOW-LIST of exactly these identifiers (HR-REPORT section 5.2), and
 * read() throws for any other unit or identifier:
 *
 *   BDC 0x40      0xF186 active diagnostic session, 0xD542 lamp functions (read), 0xD57E LWR_MODUS, 0xE3B8 stalk contacts
 *   FLM_L 0x43    0xF186 session, 0xD7A7 light distribution results
 *   FLM_R 0x44    the same
 *
 * (addresses: the DTC scanner resolved BDC_G05 at 0x40 and FLM02_L / R at 0x43 / 0x44 on this car, HR-REPORT 5.2.) No session change
 * (10), no tester present (3E), no write, no I/O control, no routine, no fault clearing: this file never names another service, and
 * it never touches the transport itself (kit/runtime/diag.js stays private to readonly-diag.js).
 *
 * Only while the car STANDS (docs/highbeam/HC-REPORT.md: the transport refuses in bursts while driving, reads take about 1 s then,
 * and the platform grants the whole diagnostic method, so only this code keeps it read-only): a read leaves only when the speed the
 * set records (Vehicle2 car-speed2, km/h x 1/64) is known, fresh and under 0.5 km/h. config.hbdiag.whileMoving (default false) would
 * open that later; it stays off until the parked session shows the reads are harmless.
 *
 * The parked session (HC's ladder step 2): each unit first reads each of its identifiers once (BDC F186, D542, D57E, E3B8; each
 * FLM F186, D7A7), then keeps cycling with the stalk contacts and the lamp functions most often while the owner pushes and pulls.
 *
 * Pacing: one request in flight per unit and at most one a second per unit. After a refusal (7F 22 <NRC>), a busy answer, no
 * answer or a transport error the unit backs off: 2, 4, 8 ... 60 s, back to 1 s after a positive reply. An identifier refused 3
 * times in a row with a "not supported / out of range / wrong session / security" NRC is no longer asked this run (logged once).
 *
 * Log (numbers only): the reply's raw bytes in hex on every change, with how many unchanged replies came in between, and every
 * refusal with its NRC:
 *   probe: diag BDC 0x40 E3B8 #2 t=31.2 ms=84: 62 E3 B8 00 10 00 (+3 same)
 *   probe: diag BDC 0x40 D542: refused NRC 0x31 (out of range), 1 in a row; the unit waits 2 s
 * While Signal Probe records, every reply also goes into the recording as a field "diag-<unit>-<did>" ({ ok, nrc, n, b00..}).
 *
 * Never throws out of a timer or a callback. Node 8.16: no ?. / ??, no object spread, no optional catch binding.
 */
const UNITS = Object.freeze([
    Object.freeze({ unit: 'BDC', addr: 0x40, first: Object.freeze([0xF186, 0xD542, 0xD57E, 0xE3B8]), order: Object.freeze([0xE3B8, 0xD542, 0xE3B8, 0xD542, 0xE3B8, 0xD542, 0xD57E, 0xF186]) }),
    Object.freeze({ unit: 'FLM_L', addr: 0x43, first: Object.freeze([0xF186, 0xD7A7]), order: Object.freeze([0xD7A7, 0xD7A7, 0xD7A7, 0xF186]) }),
    Object.freeze({ unit: 'FLM_R', addr: 0x44, first: Object.freeze([0xF186, 0xD7A7]), order: Object.freeze([0xD7A7, 0xD7A7, 0xD7A7, 0xF186]) }),
]);
const STAND_KMH = 0.5;               // "standing": the recorded speed under this
const SPEED_FRESH_MS = 3000;         // a speed older than this is unknown: no read
/** The allow-list: unit address -> the identifiers it may be asked for. Nothing else ever leaves through this file. */
const ALLOW = Object.freeze({
    0x40: Object.freeze([0xF186, 0xD542, 0xD57E, 0xE3B8]),
    0x43: Object.freeze([0xF186, 0xD7A7]),
    0x44: Object.freeze([0xF186, 0xD7A7]),
});
const DID_NAME = Object.freeze({ 0xF186: 'session', 0xD542: 'lamp functions', 0xD57E: 'LWR_MODUS', 0xE3B8: 'stalk contacts', 0xD7A7: 'light distribution results' });
const NRC_NAME = { 0x10: 'general reject', 0x11: 'service not supported', 0x12: 'sub-function not supported', 0x13: 'bad length', 0x14: 'response too long',
    0x21: 'busy', 0x22: 'conditions not correct', 0x31: 'out of range', 0x33: 'security access denied', 0x7E: 'not supported in session', 0x7F: 'not supported in session' };
const DROP_NRC = [0x11, 0x12, 0x31, 0x33, 0x7E, 0x7F];      // "this identifier is not for us": stop asking after DROP_AFTER in a row
const DROP_AFTER = 3;
const MIN_GAP_MS = 1000, BACKOFF_MS = 2000, BACKOFF_MAX_MS = 60000, TICK_MS = 250, TIMEOUT_MS = 1500, LOG_CAP = 300;

const hex2 = (b) => (b < 16 ? '0' : '') + b.toString(16).toUpperCase();
const hex4 = (n) => hex2((n >> 8) & 0xFF) + hex2(n & 0xFF);
const isByte = (b) => Number.isInteger(b) && b >= 0 && b <= 0xFF;

/** Throws unless (address, identifier) is on the allow-list. Exported for the tests. */
function allowed(addr, did) {
    const list = Object.prototype.hasOwnProperty.call(ALLOW, addr) ? ALLOW[addr] : null;
    if (!list || !Number.isInteger(did) || list.indexOf(did) < 0) throw new Error('beam diag: ' + (Number.isInteger(addr) ? '0x' + hex2(addr & 0xFF) : '?') + ' ' + (Number.isInteger(did) ? '0x' + hex4(did) : '?') + ' is not on the allow-list');
    return true;
}

class BeamDiag {
    /**
     * opts: { link: a ReadOnlyDiag (or its stand-in with read(addr, did, timeoutMs) and cancel()), log: {info, warn}, now (ms),
     *         recorder (Signal Probe's, optional), timers: { setInterval, clearInterval } (tests),
     *         speed: () => { kmh, at } | null (the latest recorded speed and when it came), whileMoving: false (config.hbdiag.whileMoving) }
     */
    constructor(opts) {
        const o = opts || {};
        this.link = o.link || null;
        this.log = o.log || { info: () => {}, warn: () => {} };
        this.now = typeof o.now === 'function' ? o.now : Date.now;
        this.recorder = o.recorder || null;
        this.timers = o.timers || { setInterval, clearInterval };
        this.speed = typeof o.speed === 'function' ? o.speed : () => null;
        this.whileMoving = o.whileMoving === true;
        this.gate = null;             // the last gate verdict logged: 'standing' / 'moving' / 'speed unknown' / 'open'
        this.t0 = this.now();
        this.timer = null;
        this.on = false;
        this.state = {};
        UNITS.forEach((u) => {
            this.state[u.addr] = { u, i: 0, busy: false, nextAt: 0, fails: 0, sent: 0, replies: 0, refused: 0, missed: 0, dropped: [], refusals: {}, last: {}, same: {}, lines: {} };
        });
        this.stats = { sent: 0, replies: 0, refused: 0, missed: 0, errors: 0 };
    }

    start() {
        if (this.on) return;
        this.on = true;
        this.t0 = this.now();
        this._say('diag: start, read only (22) through readonly-diag, units ' + UNITS.map((u) => u.unit + ' 0x' + hex2(u.addr)).join(', ') + '; at most one read a second per unit');
        this.timer = this.timers.setInterval(() => { try { this.tick(); } catch (e) { this.stats.errors++; } }, TICK_MS);
        if (this.timer && this.timer.unref) this.timer.unref();
        try { this.tick(); } catch (e) { this.stats.errors++; }
    }

    stop() {
        if (!this.on) return;
        this.on = false;
        this.timers.clearInterval(this.timer); this.timer = null;
        try { if (this.link && typeof this.link.cancel === 'function') this.link.cancel(); } catch (e) { /* nothing to undo */ }
        const s = this.stats;
        this._say('diag: stop, sent ' + s.sent + ', replies ' + s.replies + ', refused ' + s.refused + ', no answer ' + s.missed);
    }

    /** One step of the clock: each unit that is free and due gets its next identifier. */
    tick() {
        if (!this.on || !this.link) return;
        const t = this.now();
        const g = this.gateNow(t);
        if (g !== this.gate) { this.gate = g; this._say('diag: ' + (g === 'standing' || g === 'open' ? 'reads go out (' + g + ')' : 'no read: ' + g)); }
        if (g !== 'standing' && g !== 'open') return;
        UNITS.forEach((u) => {
            const st = this.state[u.addr];
            if (st.busy || t < st.nextAt) return;
            const did = this._next(st);
            if (did === null) return;
            this.read(u.addr, did);
        });
    }

    /** 'standing' (reads may go), 'moving' or 'speed unknown' (they may not); 'open' when config opened them while moving. */
    gateNow(t) {
        if (this.whileMoving) return 'open';
        let s = null;
        try { s = this.speed(); } catch (e) { s = null; }
        if (!s || typeof s.kmh !== 'number' || !isFinite(s.kmh) || typeof s.at !== 'number' || t - s.at > SPEED_FRESH_MS) return 'speed unknown';
        return s.kmh < STAND_KMH ? 'standing' : 'moving';
    }

    _next(st) {
        if (st.firstLeft === undefined) st.firstLeft = st.u.first.slice();
        while (st.firstLeft.length) {
            const d = st.firstLeft.shift();
            if (st.dropped.indexOf(d) < 0) return d;
        }
        const order = st.u.order.filter((d) => st.dropped.indexOf(d) < 0);
        if (!order.length) return null;
        const did = order[st.i % order.length];
        st.i++;
        return did;
    }

    /** One read of one allow-listed identifier; throws for anything else (before anything is queued). Resolves, never rejects. */
    read(addr, did) {
        allowed(addr, did);
        const st = this.state[addr];
        const sentAt = this.now();
        st.busy = true;
        st.nextAt = sentAt + MIN_GAP_MS;
        st.sent++; this.stats.sent++;
        let p;
        try { p = Promise.resolve(this.link.read(addr, did, TIMEOUT_MS)); } catch (e) { p = Promise.reject(e); }
        return p.then((uds) => this._reply(st, did, sentAt, uds), (e) => this._fail(st, did, 'transport: ' + String(e && e.message || e).replace(/[^\x20-\x7e]/g, '?').slice(0, 80)))
            .catch(() => { this.stats.errors++; })
            .then(() => { st.busy = false; });
    }

    _reply(st, did, sentAt, uds) {
        if (uds === undefined) return;                        // cancelled before it was sent
        if (!uds || !uds.length) { this._fail(st, did, 'no answer'); return; }
        const bytes = Array.prototype.slice.call(uds).filter(isByte);
        const ms = this.now() - sentAt;
        if (bytes[0] === 0x7F) {
            const nrc = bytes[2];
            st.refused++; this.stats.refused++;
            st.refusals[did] = (st.refusals[did] || 0) + 1;
            const drop = DROP_NRC.indexOf(nrc) >= 0 && st.refusals[did] >= DROP_AFTER;
            if (drop) st.dropped.push(did);
            const wait = this._backoff(st);
            this._rec(st, did, { ok: 0, nrc: nrc, n: 0 });
            this._line(st, did, 'refused NRC 0x' + hex2(nrc || 0) + ' (' + (NRC_NAME[nrc] || 'other') + '), ' + st.refusals[did] + ' in a row; the unit waits ' + Math.round(wait / 1000) + ' s' +
                (drop ? '; ' + hex4(did) + ' is not asked again this run' : ''), true);
            return;
        }
        st.fails = 0;
        st.refusals[did] = 0;
        st.replies++; this.stats.replies++;
        st.nextAt = Math.max(st.nextAt, sentAt + MIN_GAP_MS);
        const data = bytes[0] === 0x62 && ((bytes[1] << 8) | bytes[2]) === did ? bytes.slice(3) : bytes;
        const v = { ok: 1, nrc: -1, n: data.length };
        data.slice(0, 64).forEach((b, i) => { v['b' + (i < 10 ? '0' : '') + i] = b; });
        this._rec(st, did, v);
        const text = bytes.map(hex2).join(' ');
        if (st.last[did] === text) { st.same[did] = (st.same[did] || 0) + 1; return; }
        const same = st.same[did] || 0;
        st.last[did] = text; st.same[did] = 0;
        this._line(st, did, text + (same ? ' (+' + same + ' same)' : ''), false, ms);
    }

    _fail(st, did, why) {
        st.missed++; this.stats.missed++;
        const wait = this._backoff(st);
        this._line(st, did, why + '; the unit waits ' + Math.round(wait / 1000) + ' s', true);
    }

    /** The unit's back-off after a refusal / no answer / transport error: 2, 4, 8 ... 60 s. */
    _backoff(st) {
        st.fails++;
        const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_MS * Math.pow(2, st.fails - 1));
        st.nextAt = Math.max(st.nextAt, this.now() + wait);
        return wait;
    }

    _line(st, did, body, refusal, ms) {
        const k = did + (refusal ? 'r' : '');
        const n = st.lines[k] = (st.lines[k] || 0) + 1;
        if (n > LOG_CAP) return;
        const head = 'diag ' + st.u.unit + ' 0x' + hex2(st.u.addr) + ' ' + hex4(did);
        this._say(refusal ? head + ': ' + body : head + ' #' + n + ' t=' + (Math.round((this.now() - this.t0) / 100) / 10) + ' ms=' + ms + ': ' + body + (n === LOG_CAP ? ' (the last line for this read)' : ''));
    }

    _rec(st, did, v) {
        const r = this.recorder;
        if (!r || !r.on) return;
        try { r.sample({ f: { tag: 'diag-' + st.u.unit.toLowerCase().replace('_', '') + '-' + hex4(did).toLowerCase(), iface: 'uds.' + st.u.unit, field: hex4(did), p: 'P27' } }, v); } catch (e) { /* the recorder guards itself */ }
    }

    _say(s) { try { this.log.info('probe: ' + s); } catch (e) { /* a failing log */ } }

    /** { unit: { sent, replies, refused, missed, dropped: ['E3B8'], waitMs } } for the menu and the tests. */
    status() {
        const out = {}, t = this.now();
        UNITS.forEach((u) => {
            const st = this.state[u.addr];
            out[u.unit] = { sent: st.sent, replies: st.replies, refused: st.refused, missed: st.missed, dropped: st.dropped.map(hex4), waitMs: Math.max(0, st.nextAt - t) };
        });
        return out;
    }
}

module.exports = { BeamDiag, allowed, ALLOW, UNITS, DID_NAME, MIN_GAP_MS, BACKOFF_MS, BACKOFF_MAX_MS, DROP_AFTER, STAND_KMH, SPEED_FRESH_MS };
