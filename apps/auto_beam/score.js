'use strict';
/**
 * score.js - how well the advice agrees with what the driver actually did (round "Auto Beam", package HD): the proof the
 * algorithm needs before anyone talks about switching. Pure; numbers only (the log line carries no place and no time of day).
 *
 *   const S = new Score({ windowMs: 10000 });
 *   S.feed(t, want, lamps, state)    every decision tick: want 'high' | 'low'; lamps 'high' | 'low' | 'flash' | 'off' | null;
 *                                    state the algorithm's. A flash is never a switch. Time counts only while the lamps are
 *                                    known (high or low) and the advice is available.
 *   S.summary() -> { agreePct, agreeS, totalS, driver, app, early, late, missed, extra, leadS, lagS, ring }
 *                  early: the driver switched to what we had advised up to windowMs before (leadS: the mean lead);
 *                  late: we advised it up to windowMs after the driver (lagS: the mean lag); missed: a driver switch we
 *                  never matched; extra: an advice change the driver never followed. ring: the last 8 events [t, who, to].
 *   S.line()   the log line;   S.reset()   per drive (main.js: at start and after the low beam was off for 5 minutes)
 */
function Score(o) {
    this.win = (o && o.windowMs) || 10000;
    this.reset();
}
Score.prototype.reset = function () {
    this.t = null; this.want = null; this.lamps = null;
    this.agreeMs = 0; this.totalMs = 0;
    this.n = { driver: 0, app: 0, early: 0, late: 0, missed: 0, extra: 0 };
    this.leadMs = 0; this.lagMs = 0;
    this.appCh = [];          // unmatched advice changes [t, to]
    this.drvCh = [];          // unmatched driver switches [t, to]
    this.ring = [];
};
Score.prototype._ring = function (t, who, to) { this.ring.push([t, who, to]); if (this.ring.length > 8) this.ring.shift(); };
Score.prototype._expire = function (t) {
    this.appCh = this.appCh.filter((c) => { if (t - c[0] > this.win) { this.n.extra++; return false; } return true; });
    this.drvCh = this.drvCh.filter((c) => { if (t - c[0] > this.win) { this.n.missed++; return false; } return true; });
};
Score.prototype.feed = function (t, want, lamps, state) {
    const avail = state !== 'UNAVAILABLE' && (want === 'high' || want === 'low');
    const L = lamps === 'high' || lamps === 'low' ? lamps : lamps === 'flash' ? this.lamps : null;
    if (this.t !== null && t > this.t && avail && L && this.want) {
        const dt = Math.min(t - this.t, 2000);
        this.totalMs += dt;
        if (L === this.want) this.agreeMs += dt;
    }
    this._expire(t);
    // the advice changed
    if (avail && this.want && want !== this.want) {
        this.n.app++; this._ring(t, 'app', want);
        const i = this.drvCh.findIndex((c) => c[1] === want);
        if (i >= 0) { this.n.late++; this.lagMs += t - this.drvCh[i][0]; this.drvCh.splice(i, 1); } else this.appCh.push([t, want]);
    }
    // the driver switched (a flash is not a switch)
    if (L && this.lamps && L !== this.lamps && lamps !== 'flash') {
        this.n.driver++; this._ring(t, 'driver', L);
        const i = this.appCh.findIndex((c) => c[1] === L);
        if (i >= 0) { this.n.early++; this.leadMs += t - this.appCh[i][0]; this.appCh.splice(i, 1); } else this.drvCh.push([t, L]);
    }
    if (avail) this.want = want;
    if (L) this.lamps = L;
    this.t = t;
};
Score.prototype.summary = function () {
    const n = this.n;
    return {
        agreePct: this.totalMs ? Math.round(this.agreeMs * 100 / this.totalMs) : null, agreeS: Math.round(this.agreeMs / 1000), totalS: Math.round(this.totalMs / 1000),
        driver: n.driver, app: n.app, early: n.early, late: n.late, missed: n.missed, extra: n.extra,
        leadS: n.early ? Math.round(this.leadMs / n.early / 100) / 10 : null, lagS: n.late ? Math.round(this.lagMs / n.late / 100) / 10 : null,
        ring: this.ring.slice(),
    };
};
Score.prototype.line = function () {
    const s = this.summary();
    return 'beam: score agree ' + (s.agreePct === null ? '-' : s.agreePct + '%') + ' of ' + s.totalS + ' s, driver ' + s.driver + ' app ' + s.app +
        ', early ' + s.early + (s.leadS === null ? '' : ' (lead ' + s.leadS + ' s)') + ', late ' + s.late + (s.lagS === null ? '' : ' (lag ' + s.lagS + ' s)') +
        ', missed ' + s.missed + ', extra ' + s.extra;
};
module.exports = Score;
