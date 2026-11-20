'use strict';
/**
 * recorder.js - cruise RC: Signal Probe's recording mode (docs/cruise-set-speed-brief.md, Phase 0). READ ONLY like the rest of the
 * app: it writes nothing to the car, only files in the app's own data folder.
 *
 * While it is on, EVERY value of every field of the chosen sets (S14 first) is appended, unthrottled, to files in data/rec/, one
 * compact CSV line per sample. Numbers only: a number as it came (a float to 7 significant digits), a bool as 1 / 0, an enum by a
 * small code that the file's own dictionary line names (#n). Never a text (a string that is not an enum name is written empty),
 * never a byte buffer, never anything named like a latitude / longitude / WGS coordinate, never a member a field's tree spec skips
 * (S15's own dead-reckoned position and heading).
 *
 * A file (gzip members, one per flush, so a cut file is readable up to its last flush):
 *
 *   #rec,1,<app version>,<session>,<file no>,<wall clock ISO at open>,<t at open>,<sets>
 *   #cols,t_ms,field,seq,ctr,pts,values...
 *   #f,<id>,<tag>,<Interface.member>,<col>,<col>,...          a field's columns, before its first line in a file (again if its shape changes)
 *   #n,<code>,<ENUM_NAME>                                        an enum name's code, before its first use in a file
 *   #m,<t>,<n>                                                   the owner's "Позначка n"
 *   #s,<t>,<id>,<n>                                              beam HS: n samples of field <id> were folded since its line before
 *                                                                (a field with recSame: the same values again, less than recSame ms
 *                                                                after its last written line; they take no seq); ids hold for the
 *                                                                whole recording; at the stop, one per field with folds left
 *   #end,<t>,samples=..,dropped=..,errors=..,texts=..,folded=..  the last line of a recording (missing: the app or the head unit stopped)
 *   <t>,<id>,<seq>,<ctr>,<pts>,<v1>,<v2>,...                     a sample; "=" for the values: the same values as this field's line before
 *
 *   t    monotonic receive time, ms since the recording started (process.hrtime, not the wall clock)
 *   seq  the field's own sample number in this recording, from 1 (a gap = samples the recorder dropped: the queue was full)
 *   ctr  the payload's own counter where it has one (alive*, counter, *SyncCounter), else empty
 *   pts  the payload's own time stamp where it has one: <seconds>.<nanoseconds, 9 digits> exactly as sent, else empty
 *
 * Files are cut at `fileRawKB` of text; the oldest files are removed when the folder passes `quotaMB` (the app's own disk limit,
 * package.json maxDiskUsage, is 20 MiB with the log and the settings in it). A failing write (a full disk, a quota) STOPS THE
 * RECORDING, never the app: every file call is guarded and every callback catches. Node 8.16: no ?. / ??, no spread, no optional
 * catch binding.
 */
const REC_FORMAT = 1;
const DEFAULTS = { fileRawKB: 4096, quotaMB: 15, flushMs: 1000, maxQueueKB: 2048, gzip: true, maxEntries: 16 };
const FILE_RE = /^rec-\d{8}-\d{6}-\d{3}\.csv(\.gz)?$/;
const ENUM_RE = /^[A-Z_][A-Z0-9_]{0,95}$/;
const SKIP_RE = /^(crc\w*|dataID|chl\w*)$/i;                         // the end-to-end protection: not data
const PRIVATE_RE = /latitude|longitude|wgs/i;                         // a coordinate is never recorded
const CTR_RE = /^(alive\w*|aliv[A-Z]\w*|counter|\w*SyncCounter)$/;
const NSEC_RE = /nanoseconds$/i;
const SEC_RE = /seconds$/i;

const two = (n) => (n < 10 ? '0' : '') + n;
const three = (n) => (n < 10 ? '00' : n < 100 ? '0' : '') + n;
const nine = (n) => { const s = String(n); return '000000000'.slice(s.length) + s; };
const msg = (e) => String(e && (e.code || e.message) || e).replace(/[^\x20-\x7e]/g, '?').slice(0, 80);
const isBuf = (x) => !!x && typeof x === 'object' && ((typeof Buffer !== 'undefined' && Buffer.isBuffer(x)) || ArrayBuffer.isView(x));

/** A number for the file: an integer as it is, a float to 7 significant digits (a float32's precision), no "-0". */
function fmtNum(x) {
    if (Number.isInteger(x)) return String(x);
    if (!isFinite(x)) return '';
    const r = parseFloat(x.toPrecision(7));
    return r === 0 ? '0' : String(r);
}

/**
 * The numbers of a value, in its own member order: { keys: [path, ...], vals: [x, ...], ctr, ptsS, ptsNs }. The counter and the
 * time stamp members go to ctr / pts instead of the columns; the end-to-end header, texts' content, buffers and coordinates are
 * left out; a list gives at most `maxEntries` entries (path.<i>.member).
 */
function flatten(v, skip, maxEntries) {
    const out = { keys: [], vals: [], ctr: null, ptsS: null, ptsNs: null };
    const walk = (x, key, path, depth) => {
        if (depth > 0) {
            if (SKIP_RE.test(key) || PRIVATE_RE.test(key) || (skip && skip.indexOf(key) >= 0) || (depth === 1 && key === 'length')) return;
        }
        if (Array.isArray(x)) {
            const n = Math.min(x.length, maxEntries);
            out.keys.push(path + (path ? '.' : '') + 'n'); out.vals.push(x.length);
            for (let i = 0; i < n; i++) walk(x[i], String(i), path + (path ? '.' : '') + i, depth + 1);
            return;
        }
        if (x !== null && typeof x === 'object') {
            if (isBuf(x) || depth > 8) return;
            const ks = Object.keys(x);
            for (let i = 0; i < ks.length; i++) walk(x[ks[i]], ks[i], path + (path ? '.' : '') + ks[i], depth + 1);
            return;
        }
        if (typeof x === 'number') {
            if (out.ctr === null && CTR_RE.test(key)) { out.ctr = x; return; }
            if (NSEC_RE.test(key)) { out.ptsNs = x; return; }
            if (SEC_RE.test(key)) { out.ptsS = x; return; }
        }
        out.keys.push(path || 'value'); out.vals.push(x);
    };
    walk(v, '', '', 0);
    return out;
}

class Recorder {
    /**
     * opts: { dir (the folder for the files), fs, zlib, log: {info, warn}, mono (ms, monotonic), wall (Date.now), version,
     *         cfg: { fileRawKB, quotaMB, flushMs, maxQueueKB, gzip, maxEntries } }
     */
    constructor(opts) {
        const o = opts || {};
        this.fs = o.fs || require('fs');
        this.zlib = o.zlib || require('zlib');
        this.path = require('path');
        this.dir = o.dir || '.';
        this.log = o.log || { info: () => {}, warn: () => {} };
        this.mono = typeof o.mono === 'function' ? o.mono : () => { const t = process.hrtime(); return t[0] * 1e3 + t[1] / 1e6; };
        this.wall = typeof o.wall === 'function' ? o.wall : Date.now;
        this.version = o.version || '?';
        const c = o.cfg && typeof o.cfg === 'object' ? o.cfg : {};
        const num = (k) => (typeof c[k] === 'number' && isFinite(c[k]) && c[k] > 0 ? c[k] : DEFAULTS[k]);
        this.quota = num('quotaMB') * 1024 * 1024;
        // a file never outgrows half the quota (text bytes >= file bytes), so the oldest files can always make room for the open one
        this.fileRaw = Math.min(num('fileRawKB') * 1024, Math.floor(this.quota / 2));
        this.flushMs = num('flushMs');
        this.maxQueue = num('maxQueueKB') * 1024;
        this.maxEntries = num('maxEntries');
        this.gzip = c.gzip === undefined ? DEFAULTS.gzip : !!c.gzip;
        this.on = false;
        this.timer = null;
        this.session = null; this.sets = [];
        this.segs = [];               // the open file and any queued after it: { no, name, fd, chunks, raw, closed, hdr, prev, codes, nCodes }
        this.writing = false;
        this.queued = 0;              // text bytes waiting
        this.files = [];              // closed files on disk: { name, bytes } oldest first
        this.cur = null;              // the file being written: { name, bytes }
        this.fields = {};             // tag -> { id, seq }
        this.nIds = 0; this.fileNo = 0; this.t0 = 0;
        this.samples = 0; this.dropped = 0; this.errors = 0; this.texts = 0; this.written = 0; this.folded = 0;
        this.error = null; this.warned = false;
    }

    // ---- start / stop -------------------------------------------------------------------------------------------------------------
    /** Start a new recording of the fields the probe routes here (sets: for the header). Returns true when it started. */
    start(sets) {
        if (this.on) return true;
        try {
            try { this.fs.mkdirSync(this.dir); } catch (e) { if (!e || e.code !== 'EEXIST') throw e; }
            this._scan();
            const d = new Date(this.wall());
            this.session = d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
            this.sets = (sets || []).slice();
            this.t0 = this.mono();
            this.fields = {}; this.nIds = 0; this.fileNo = 0;
            this.samples = 0; this.dropped = 0; this.errors = 0; this.texts = 0; this.written = 0; this.queued = 0; this.folded = 0;
            this.error = null; this.warned = false;
            this.segs = [];
            this.on = true;
            this._newSeg();
            this._enforce();
            this.timer = setInterval(() => { try { this._flush(); } catch (e) { this._fail(e); } }, this.flushMs);
            if (this.timer && this.timer.unref) this.timer.unref();
            this._say('rec: start session=' + this.session + ' sets=' + (this.sets.join('+') || 'none') + ' dir=data/' + this.path.basename(this.dir) +
                ' file=' + Math.round(this.fileRaw / 1024) + 'KB quota=' + Math.round(this.quota / 1048576) + 'MB gzip=' + (this.gzip ? 1 : 0));
            return true;
        } catch (e) {
            this.on = false; this.error = msg(e);
            this._say('rec: could not start: ' + this.error);
            return false;
        }
    }

    /** Stop: the last line, then the queue goes out (asynchronously; `sync` writes it at once: the app's exit). */
    stop(sync) {
        if (!this.on) return;
        try {
            // beam HS: the folds since each field's last line, then the last line
            const t = this._t(), seg = this._seg();
            Object.keys(this.fields).forEach((k) => { const fr = this.fields[k]; if (fr.folded) { this._line(seg, '#s,' + t + ',' + fr.id + ',' + fr.folded); fr.folded = 0; } });
            this._line(seg, '#end,' + t + ',samples=' + this.samples + ',dropped=' + this.dropped + ',errors=' + this.errors + ',texts=' + this.texts + ',folded=' + this.folded);
        } catch (e) { /* the queue is full or broken: stop anyway */ }
        this.on = false;
        clearInterval(this.timer); this.timer = null;
        const last = this.segs[this.segs.length - 1];
        if (last) last.closed = true;
        this._say('rec: stop session=' + this.session + ' samples=' + this.samples + ' dropped=' + this.dropped + ' errors=' + this.errors);
        if (sync) this._flushSync(); else this._flush();
    }

    /** The owner's "Позначка n" inside the recording. */
    mark(n) {
        if (!this.on) return;
        try { this._line(this._seg(), '#m,' + this._t() + ',' + n); } catch (e) { this.errors++; }
    }

    // ---- samples ------------------------------------------------------------------------------------------------------------------
    /** One value of one field (st.f: the table entry). Never throws. */
    sample(st, v) {
        if (!this.on) return;
        try {
            const f = st.f;
            let fr = this.fields[f.tag];
            if (!fr) fr = this.fields[f.tag] = { id: ++this.nIds, seq: 0, name: f.iface.split('.').pop() + '.' + f.field, same: null, sameAt: 0, folded: 0 };
            const t = this._t();
            let fl = null, key = null;
            // beam HS: recSame - the same values again soon after the field's last written line are folded (counted, no seq)
            if (f.recSame > 0) {
                fl = flatten(v, f.tree && f.tree.skip, this._entries(f));
                key = fl.keys.join(',') + '|' + fl.vals.join(',');
                if (key === fr.same && t - fr.sameAt < f.recSame) { fr.folded++; this.folded++; return; }
            }
            fr.seq++;
            if (this.queued > this.maxQueue) { this.dropped++; return; }
            if (!fl) fl = flatten(v, f.tree && f.tree.skip, this._entries(f));
            const seg = this._seg();
            const sig = fl.keys.join(',');
            if (seg.hdr[fr.id] !== sig) {
                this._line(seg, '#f,' + fr.id + ',' + f.tag + ',' + fr.name + (sig ? ',' + sig : ''));
                seg.hdr[fr.id] = sig; seg.prev[fr.id] = null;
            }
            const vals = new Array(fl.vals.length);
            for (let i = 0; i < fl.vals.length; i++) vals[i] = this._val(seg, fl.vals[i]);
            const body = vals.join(',');
            const pts = fl.ptsS === null ? '' : String(fl.ptsS) + '.' + (fl.ptsNs === null ? '000000000' : nine(fl.ptsNs));
            if (fr.folded) { this._line(seg, '#s,' + t + ',' + fr.id + ',' + fr.folded); fr.folded = 0; }
            this._line(seg, t + ',' + fr.id + ',' + fr.seq + ',' + (fl.ctr === null ? '' : fl.ctr) + ',' + pts + ',' + (seg.prev[fr.id] === body ? '=' : body));
            seg.prev[fr.id] = body;
            if (key !== null) { fr.same = key; fr.sameAt = t; }
            this.samples++;
        } catch (e) {
            this.errors++;
            if (!this.warned) { this.warned = true; this._say('rec: a sample failed (' + (st && st.f && st.f.tag) + '): ' + msg(e)); }
        }
    }

    _val(seg, x) {
        if (typeof x === 'number') return fmtNum(x);
        if (typeof x === 'boolean') return x ? '1' : '0';
        if (typeof x === 'string') {
            if (!ENUM_RE.test(x)) { this.texts++; return ''; }       // never a text
            let c = seg.codes[x];
            if (c === undefined) { c = seg.codes[x] = ++seg.nCodes; this._line(seg, '#n,' + c + ',' + x); }
            return '@' + c;
        }
        return '';
    }

    _t() { return Math.round(this.mono() - this.t0); }

    /** A list's entries in a file: the field's cap for one of the recorded sets (beam HS: recEntriesBy), its own cap (r1120 AC), the recorder's. */
    _entries(f) {
        const by = f.recEntriesBy;
        if (by && typeof by === 'object') {
            for (let i = 0; i < this.sets.length; i++) { const n = by[this.sets[i]]; if (n > 0 && n < this.maxEntries) return n; }
        }
        return f.recEntries > 0 && f.recEntries < this.maxEntries ? f.recEntries : this.maxEntries;
    }

    // ---- segments: one per file, queued text ------------------------------------------------------------------------------------
    _newSeg() {
        this.fileNo++;
        const seg = { no: this.fileNo, name: 'rec-' + this.session + '-' + three(this.fileNo) + '.csv' + (this.gzip ? '.gz' : ''), fd: null, chunks: [], raw: 0, closed: false,
            hdr: {}, prev: {}, codes: {}, nCodes: 0 };
        this.segs.push(seg);
        this._line(seg, '#rec,' + REC_FORMAT + ',' + this.version + ',' + this.session + ',' + seg.no + ',' + new Date(this.wall()).toISOString() + ',' + this._t() + ',' + (this.sets.join('+') || 'none'));
        this._line(seg, '#cols,t_ms,field,seq,ctr,pts,values');
        return seg;
    }
    /** The segment new lines go to: a new one when the current one has its share of text. */
    _seg() {
        let seg = this.segs[this.segs.length - 1];
        if (!seg || seg.closed) seg = this._newSeg();
        else if (seg.raw >= this.fileRaw) { seg.closed = true; seg = this._newSeg(); }
        return seg;
    }
    _line(seg, s) {
        seg.chunks.push(s);
        seg.raw += s.length + 1;
        this.queued += s.length + 1;
    }

    // ---- writing ------------------------------------------------------------------------------------------------------------------
    _open(seg) {
        if (seg.fd !== null) return;
        seg.fd = this.fs.openSync(this.path.join(this.dir, seg.name), 'a');
        this.cur = { name: seg.name, bytes: 0 };
    }
    _closeSeg(seg) {
        try { if (seg.fd !== null) this.fs.closeSync(seg.fd); } catch (e) { /* closing a broken file: nothing to do */ }
        seg.fd = null;
        if (this.cur && this.cur.name === seg.name) { this.files.push(this.cur); this.cur = null; }
        this.segs.shift();
    }
    /** One write in flight at a time: the first segment's queued text, compressed, appended to its file. */
    _flush() {
        if (this.writing) return;
        const seg = this.segs[0];
        if (!seg) return;
        if (!seg.chunks.length) {
            // a finished file: closed, counted for the quota, and on to the next one
            if (seg.closed) {
                this._closeSeg(seg);
                this._enforce();
                if (this.segs.length) setImmediate(() => { try { this._flush(); } catch (e) { this._fail(e); } });
            }
            return;
        }
        const text = seg.chunks.join('\n') + '\n';
        seg.chunks = [];
        this.queued = Math.max(0, this.queued - text.length);
        try { this._open(seg); } catch (e) { this._fail(e); return; }
        this.writing = true;
        const write = (buf) => {
            this.fs.write(seg.fd, buf, 0, buf.length, null, (err) => {
                try {
                    this.writing = false;
                    if (err) { this._fail(err); return; }
                    this.written += buf.length;
                    if (this.cur) this.cur.bytes += buf.length;
                    this._enforce();
                    if (this.segs.length && (this.segs[0].chunks.length || this.segs[0].closed)) setImmediate(() => { try { this._flush(); } catch (e) { this._fail(e); } });
                } catch (e) { this._fail(e); }
            });
        };
        if (!this.gzip) { write(Buffer.from(text)); return; }
        this.zlib.gzip(Buffer.from(text), (err, buf) => {
            try {
                if (err) { this.writing = false; this._fail(err); return; }
                write(buf);
            } catch (e) { this.writing = false; this._fail(e); }
        });
    }
    /** At the app's exit: whatever is queued, written at once. */
    _flushSync() {
        while (this.segs.length) {
            const seg = this.segs[0];
            if (seg.chunks.length) {
                try {
                    const text = seg.chunks.join('\n') + '\n';
                    seg.chunks = [];
                    this._open(seg);
                    const buf = this.gzip ? this.zlib.gzipSync(Buffer.from(text)) : Buffer.from(text);
                    this.fs.writeSync(seg.fd, buf, 0, buf.length);
                    this.written += buf.length;
                    if (this.cur) this.cur.bytes += buf.length;
                } catch (e) { this.error = this.error || msg(e); }
            }
            this._closeSeg(seg);
        }
        this.queued = 0;
    }

    /** A write failed: the recording stops (a full disk, the quota, a broken file); the app goes on. */
    _fail(e) {
        this.error = msg(e);
        this.errors++;
        const was = this.on;
        this.on = false; this.writing = false;
        clearInterval(this.timer); this.timer = null;
        while (this.segs.length) { const s = this.segs[0]; s.chunks = []; this._closeSeg(s); }
        this.queued = 0;
        if (was) this._say('rec: STOPPED by a write error: ' + this.error + ' (the app goes on; samples=' + this.samples + ')');
    }

    // ---- the quota ---------------------------------------------------------------------------------------------------------------
    _scan() {
        this.files = [];
        let names = [];
        try { names = this.fs.readdirSync(this.dir).filter((n) => FILE_RE.test(n)).sort(); } catch (e) { names = []; }
        names.forEach((n) => {
            try { this.files.push({ name: n, bytes: this.fs.statSync(this.path.join(this.dir, n)).size }); } catch (e) { /* gone */ }
        });
    }
    used() { return this.files.reduce((s, f) => s + f.bytes, 0) + (this.cur ? this.cur.bytes : 0); }
    /** The oldest closed files go while the folder is over the quota (the open file stays). */
    _enforce() {
        while (this.used() > this.quota && this.files.length) {
            const f = this.files.shift();
            try { this.fs.unlinkSync(this.path.join(this.dir, f.name)); this._say('rec: quota: removed ' + f.name + ' (' + Math.round(f.bytes / 1024) + ' KB)'); } catch (e) { /* already gone */ }
        }
        if (this.on && this.used() > this.quota) this._fail(new Error('the open file alone is over the quota'));
    }

    // ---- status ------------------------------------------------------------------------------------------------------------------
    /** { on, sets, session, samples, bytes (written), queued, used, room (quota left), quota, files, dropped, errors, texts, error, seconds } */
    status() {
        const used = this.used();
        return { on: this.on, sets: this.sets.slice(), session: this.session, samples: this.samples, bytes: this.written, queued: this.queued, used,
            room: Math.max(0, this.quota - used), quota: this.quota, files: this.files.length + (this.cur ? 1 : 0), dropped: this.dropped, errors: this.errors, texts: this.texts,
            folded: this.folded, error: this.error, seconds: this.on ? Math.round(this._t() / 1000) : 0 };
    }
    _say(s) { try { this.log.info('probe: ' + s); } catch (e) { /* a failing log */ } }
}

module.exports = { Recorder, flatten, fmtNum, REC_FORMAT, DEFAULTS, FILE_RE };
