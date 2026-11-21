'use strict';
/**
 * engine.js - an engine for the cruise simulator's batch runner with the gated command module in the loop (package CM).
 *
 *   node tools/cruise-sim/sweep.js tools/cruise-cmd/plans/<plan>.json --engine tools/cruise-cmd/engine.js
 *
 * A plan's config may carry `cm`: { cm: module cfg, law: follow.js params, stub: stub opts, arm, feedDelay_s, plain }
 * (sim_gated.js). Plan grid paths reach it as "cm.law.h", "cm.cm.tgMin_s", "cm.plain", ... The run's metrics gain the
 * module's summary as cm_* keys (numbers, booleans, and two enum names), so runs.jsonl carries them.
 * Node 8 syntax. Writes nothing itself (sweep.js writes under bake/work/, never into git).
 */

const G = require('./sim_gated.js');

function run(config) {
    const c = Object.assign({}, config);
    const o = c.cm || {};
    delete c.cm;
    const r = G.run(c, o);
    const s = r.cm;
    const m = r.metrics;
    m.cm_armedOk = s.armedOk;
    m.cm_armReason = s.armReason;
    m.cm_armed_s = s.armed_s;
    m.cm_armedAtEnd = s.armedAtEnd;
    m.cm_endReason = s.endReason;
    m.cm_firstDisarmT = s.firstDisarm ? s.firstDisarm.t : null;
    m.cm_firstDisarm = s.firstDisarm ? s.firstDisarm.reason : null;
    m.cm_requests = s.requests;
    m.cm_violations = s.violations;
    m.cm_minTgArmed = s.minTgArmed;
    m.cm_armedBelowFloor_s = s.armedBelowFloor_s;
    m.cm_worstArmedBelowFloor_s = s.worstArmedBelowFloor_s;
    m.cm_collisionWhileArmed = s.collisionWhileArmed;
    m.cm_armedLowSeen_s = s.armedLowSeen_s;
    m.cm_collisionSeenArmed = s.collisionSeenArmed;
    m.cm_maxStep = s.maxStep;
    m.cm_minInterval = isFinite(s.minInterval) ? s.minInterval : null;
    m.cm_overCeiling = s.overCeiling;
    delete r.cmCtx;
    return r;
}

module.exports = { run: run };
