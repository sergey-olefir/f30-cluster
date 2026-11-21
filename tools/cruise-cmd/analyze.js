'use strict';
/**
 * analyze.js - reads one or more sweep folders (bake/work/cruise-sim/runs/<plan>-<stamp>/runs.jsonl) and prints, per grid
 * point: the safety and pass shares by family (sweep.js's own summary), the comfort costs, and for gated runs the module's
 * invariants (armed below the floor, collisions while armed, violations, steps and intervals).
 *   node tools/cruise-cmd/analyze.js <folder> [<folder> ...] [--fail] [--json]
 * Node 8 syntax. Reads only.
 */
const fs = require('fs');
const path = require('path');
const sweep = require('../cruise-sim/sweep.js');

function load(dir) {
    return fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function pct(x) { return x === null || x === undefined ? '-' : (100 * x).toFixed(0) + '%'; }
function byPoint(recs) {
    const m = {};
    recs.forEach((r) => { (m[r.gi] = m[r.gi] || []).push(r); });
    return m;
}
function invariants(recs) {
    const g = recs.filter((r) => r.metrics.cm_requests !== undefined);
    if (!g.length) return null;
    const o = { runs: g.length, armed: 0, armedThrough: 0, violations: 0, collisionWhileArmed: 0, armedBelowFloor: 0, worstArmedBelow: 0,
        maxStep: 0, minInterval: Infinity, requests: 0, reasons: {}, armedUnsafe: [], belowList: [],
        seenLow: 0, worstSeenLow: 0, collisionSeenArmed: 0, seenList: [] };
    g.forEach((r) => {
        const m = r.metrics;
        if (m.cm_armedOk) o.armed++;
        if (m.cm_armedOk && m.cm_armedAtEnd) o.armedThrough++;
        o.violations += m.cm_violations || 0;
        if (m.cm_collisionWhileArmed) o.collisionWhileArmed++;
        if (m.cm_worstArmedBelowFloor_s > 0) { o.armedBelowFloor++; o.belowList.push([r.id, +m.cm_worstArmedBelowFloor_s.toFixed(2), m.cm_firstDisarm]); }
        o.worstArmedBelow = Math.max(o.worstArmedBelow, m.cm_worstArmedBelowFloor_s || 0);
        if (m.cm_armedLowSeen_s > 1.0) { o.seenLow++; o.seenList.push([r.id, +m.cm_armedLowSeen_s.toFixed(2), m.cm_firstDisarm]); }
        o.worstSeenLow = Math.max(o.worstSeenLow, m.cm_armedLowSeen_s || 0);
        if (m.cm_collisionSeenArmed) { o.collisionSeenArmed++; o.seenList.push([r.id, 'COLLISION_SEEN', m.cm_firstDisarm]); }
        o.maxStep = Math.max(o.maxStep, m.cm_maxStep || 0);
        if (typeof m.cm_minInterval === 'number') o.minInterval = Math.min(o.minInterval, m.cm_minInterval);
        if (typeof m.cm_overCeiling === 'number') o.overCeiling = Math.max(o.overCeiling === undefined ? -Infinity : o.overCeiling, m.cm_overCeiling);
        o.requests += m.cm_requests || 0;
        const k = m.cm_armedOk ? (m.cm_firstDisarm || 'ARMED_THROUGH') : ('REFUSED:' + m.cm_armReason);
        o.reasons[k] = (o.reasons[k] || 0) + 1;
        if (m.cm_armedOk && m.cm_armedAtEnd && (m.collision || m.minTimeGap_s < 1.0)) o.armedUnsafe.push([r.id, m.minTimeGap_s, m.collision]);
    });
    o.belowList.sort((a, b) => b[1] - a[1]);
    return o;
}
function main() {
    const args = process.argv.slice(2);
    const dirs = args.filter((a) => a.indexOf('--') !== 0);
    const showFail = args.indexOf('--fail') >= 0;
    dirs.forEach((d) => {
        const recs = load(d);
        const pts = byPoint(recs);
        Object.keys(pts).forEach((gi) => {
            const rs = pts[gi];
            const s = sweep.summarizePoint(rs);
            console.log('== ' + path.basename(d) + ' point ' + gi + ' ' + JSON.stringify(rs[0].params));
            console.log('  groups ' + s.groups + ' pass ' + pct(s.passShare) + ' safe ' + pct(s.safeShare) + ' leadBrakeHandled ' + s.leadBrakeHandled_mps2 + ' cost ' + JSON.stringify(s.cost));
            console.log('  families ' + Object.keys(s.families).sort().map((f) => f + ' ' + pct(s.families[f].share) + '/' + pct(s.families[f].safeShare)).join('  '));
            const inv = invariants(rs);
            if (inv) {
                const o = Object.assign({}, inv);
                const below = o.belowList; delete o.belowList;
                const unsafe = o.armedUnsafe; delete o.armedUnsafe;
                const seen = o.seenList; delete o.seenList;
                if (seen.length) console.log('  ARMED WITH A SEEN VEHICLE BELOW THE FLOOR > 1 s, OR A SEEN COLLISION: ' + JSON.stringify(seen.slice(0, 20)));
                console.log('  module ' + JSON.stringify(o));
                if (below.length) console.log('  armed below the floor (worst first): ' + JSON.stringify(below.slice(0, 15)));
                if (unsafe.length) console.log('  ARMED THROUGH AND UNSAFE: ' + JSON.stringify(unsafe.slice(0, 15)));
            }
            if (showFail) s.failing.filter((f) => !f.safe).slice(0, 30).forEach((f) => console.log('    ' + f.groupKey + ' ' + f.failed.join(',')));
        });
    });
}
if (require.main === module) main();
module.exports = { load: load, invariants: invariants };
