'use strict';
/**
 * srclog.js - one log line per source on its FIRST message (its raw members: numbers and enum names), then a summary every
 * periodMs while it keeps coming (round "Auto Beam", package HD; ACC View's SourceLog idea). The first drive must show from
 * the app's log alone whether the camera sends its light stream: "beam: src lights first ..." answers it, and its absence
 * after a drive (with "beam: src ... silent" in the 10 s line) is the answer too.
 *
 *   const L = new SrcLog(log, 10000);
 *   L.first(name, raw)                 the raw value's members, once per source
 *   L.add(name, t, extra)              count a message (extra: { n, cls: { k: count }, min, max } for the lights)
 *   L.tick(t)                          the 10 s summary lines: "beam: src lights n 143 rate 14.3/s objs 0..4 cls 1:3 2:1 dist 12..88"
 *                                      and, once, "beam: src <name> silent" for each source expected but not seen after 10 s
 * Never logs a coordinate, a place or a text: numbers and enum names only.
 */
const MAX_FIRST = 600;

/** The members of a raw value as "k=v" (numbers and names; nested one level; long values cut). */
function rawWords(v) {
    if (v === null || v === undefined) return String(v);
    if (typeof v !== 'object') return typeof v === 'string' ? v.replace(/[^A-Za-z0-9_.-]/g, '?').slice(0, 40) : String(v);
    return Object.keys(v).map((k) => {
        const x = v[k];
        if (x && typeof x === 'object' && !Array.isArray(x)) return k + '={' + Object.keys(x).slice(0, 12).map((j) => j + '=' + rawWords(x[j])).join(' ') + '}';
        if (Array.isArray(x)) return k + '=[' + x.length + ']';
        return k + '=' + rawWords(x);
    }).join(' ');
}

function SrcLog(log, periodMs, expected) {
    this.log = log; this.period = periodMs || 10000; this.s = {}; this.t0 = null; this.expected = expected || []; this.silentSaid = {};
}
SrcLog.rawWords = rawWords;
SrcLog.prototype._get = function (name) {
    return this.s[name] || (this.s[name] = { n: 0, first: false, win: 0, winAt: null, objMin: null, objMax: null, cls: {}, dMin: null, dMax: null });
};
SrcLog.prototype.first = function (name, raw) {
    const s = this._get(name);
    if (s.first) return false;
    s.first = true;
    let w = rawWords(raw);
    if (w.length > MAX_FIRST) w = w.slice(0, MAX_FIRST) + '...';
    try { this.log.info('beam: src ' + name + ' first ' + w); } catch (e) { /* logging only */ }
    return true;
};
SrcLog.prototype.add = function (name, t, extra) {
    const s = this._get(name);
    s.n++; s.win++;
    if (s.winAt === null) s.winAt = t;
    const x = extra || {};
    if (typeof x.n === 'number') { s.objMin = s.objMin === null ? x.n : Math.min(s.objMin, x.n); s.objMax = s.objMax === null ? x.n : Math.max(s.objMax, x.n); }
    if (x.cls) Object.keys(x.cls).forEach((k) => { s.cls[k] = (s.cls[k] || 0) + x.cls[k]; });
    if (typeof x.min === 'number') s.dMin = s.dMin === null ? x.min : Math.min(s.dMin, x.min);
    if (typeof x.max === 'number') s.dMax = s.dMax === null ? x.max : Math.max(s.dMax, x.max);
};
SrcLog.prototype.tick = function (t) {
    if (this.t0 === null) this.t0 = t;
    const lines = [];
    Object.keys(this.s).forEach((name) => {
        const s = this.s[name];
        if (s.winAt === null || t - s.winAt < this.period) return;
        let ln = 'beam: src ' + name + ' n ' + s.n + ' rate ' + (s.win * 1000 / Math.max(1, t - s.winAt)).toFixed(1) + '/s';
        if (s.objMin !== null) ln += ' objs ' + s.objMin + '..' + s.objMax;
        const ck = Object.keys(s.cls).sort();
        if (ck.length) ln += ' cls ' + ck.map((k) => k + ':' + s.cls[k]).join(' ');
        if (s.dMin !== null) ln += ' dist ' + s.dMin + '..' + s.dMax;
        lines.push(ln);
        s.win = 0; s.winAt = t; s.objMin = null; s.objMax = null; s.cls = {}; s.dMin = null; s.dMax = null;
    });
    if (t - this.t0 >= this.period) this.expected.forEach((name) => {
        if (!this.silentSaid[name] && !(this.s[name] && this.s[name].n)) { this.silentSaid[name] = true; lines.push('beam: src ' + name + ' silent (nothing in ' + Math.round((t - this.t0) / 1000) + ' s)'); }
    });
    lines.forEach((l) => { try { this.log.info(l); } catch (e) { /* logging only */ } });
    return lines;
};
module.exports = SrcLog;
