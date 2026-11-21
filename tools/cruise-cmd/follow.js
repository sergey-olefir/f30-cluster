'use strict';
/**
 * follow.js - the distance-keeping law that decides the WANTED set speed for the gated command module (package CM).
 * Bench and simulator only. Node 8 syntax; pure (no clock, no I/O, no randomness, no require).
 *
 * It is SC2's law (tools/cruise-sim/core/controller.js, the parent brief's Phase 4) at SC3's best tuning (h 2-3 s,
 * tau 8 s), adapted to what the gates let through (shared/cruise_cmd.js: lower-only to the driver's set speed, at most
 * 5 km/h per request, at most one request per 3 s):
 *   d_des = d0 + h v
 *   v_ref = v_lead(+ a_lead T_look, if braking) + (d_pred - d_des) / tau,  d_pred = d + v_rel T_look (the gap when the
 *           next request can act: the module waits up to 3 s for its slot)
 *   v_ref <= v_lead + sqrt(2 a_plan (d_pred - d_des))  (the kinematic cap: a weak, slow command path sheds speed early)
 *   want  = min(ceiling, v_ref), whole km/h; a raise only when v_ref clears the current set speed by raiseHyst_kmh, the
 *           lead is not closing and the gap is at least d_des; a raise target at most raiseStep_kmh above the set speed.
 *   No vehicle ahead (none yet, lost, or a camera that cannot hold its track): hold the set speed. Never a raise without a
 *   tracked vehicle pulling away (the module enforces the same: it sends nothing without one). After the lead leaves,
 *   the set speed stays where it is until a new lead pulls away or the driver sets it (which disarms the module).
 * The module then moves the set speed toward `want` by at most 5 km/h per request, one request per 3 s; this law does not
 * rate-limit itself.
 *
 *   create(params) -> { step(inp) -> { seq, t (ms), wantKmh, why, vRefKmh, dDes }, params }
 *   inp = { t (ms), lead: { valid, gap_m, vrel_mps, alead_mps2 }, egoKmh, setKmh (the set speed the feed shows),
 *           ceilingKmh (the module's, or the set speed when not armed), curvature (1/m, optional) }
 */

const DEFAULTS = Object.freeze({
    d0: 5,                 // m, standstill gap (SC2 / the parent brief)
    h: 3.0,                // s, time gap (SC3's best: 2-3 s; 3 measured best under the gates, CM-REPORT §2)
    tau: 8,                // s, gap-closing time (SC3's best)
    look_s: 1.5,           // s, look-ahead to the next slot
    aPlan_mps2: 0.4,       // m/s², the deceleration the gated command path is planned for (kinematic cap)
    ffBrake: true,         // add a_lead T_look when the lead brakes (never when it accelerates)
    raiseHyst_kmh: 3,      // a raise only when v_ref is this far above the current set speed
    raiseStep_kmh: 3,      // and to at most this far above it (the module allows up to 5)
    lowerHyst_kmh: 1,      // a lowering when v_ref is this far below it
    aLatHold_mps2: 0.7,    // m/s², a curve this sharp is named in the reason of a hold (HOLD_CURVE)
});

const isNum = (x) => typeof x === 'number' && isFinite(x);

function create(params) {
    const p = {};
    Object.keys(DEFAULTS).forEach((k) => { p[k] = DEFAULTS[k]; });
    if (params && typeof params === 'object') Object.keys(params).forEach((k) => { if (Object.prototype.hasOwnProperty.call(DEFAULTS, k) && params[k] !== undefined) p[k] = params[k]; });
    const S = { seq: 0, hadTarget: false, lostAt: null, curveAt: -1e12 };

    function step(inp) {
        S.seq++;
        const t = isNum(inp && inp.t) ? inp.t : 0;
        const res = { seq: S.seq, t: t, wantKmh: null, why: 'NO_INPUT', vRefKmh: null, dDes: null };
        if (!inp || !isNum(inp.egoKmh) || !isNum(inp.setKmh)) return res;
        const set = inp.setKmh;
        const ceil = isNum(inp.ceilingKmh) ? inp.ceilingKmh : set;
        const v = inp.egoKmh / 3.6;
        const dDes = p.d0 + p.h * v;
        res.dDes = dDes;
        const kappa = isNum(inp.curvature) ? Math.abs(inp.curvature) : 0;
        if (v * v * kappa >= p.aLatHold_mps2) S.curveAt = t;
        const lead = inp.lead;
        if (lead && lead.valid && isNum(lead.gap_m) && isNum(lead.vrel_mps)) {
            S.hadTarget = true; S.lostAt = null;
            const vlead = v + lead.vrel_mps;
            const dPred = lead.gap_m + lead.vrel_mps * p.look_s;
            let vRef = vlead + (dPred - dDes) / p.tau;
            if (p.ffBrake && isNum(lead.alead_mps2) && lead.alead_mps2 < 0) vRef += lead.alead_mps2 * p.look_s;
            vRef = Math.min(vRef, vlead + Math.sqrt(2 * p.aPlan_mps2 * Math.max(0, dPred - dDes)));
            const refKmh = vRef * 3.6;
            res.vRefKmh = refKmh;
            if (refKmh <= set - p.lowerHyst_kmh) { res.wantKmh = Math.min(ceil, Math.floor(refKmh)); res.why = 'LOWER'; }
            else if (refKmh >= set + p.raiseHyst_kmh && lead.vrel_mps >= -0.3 && lead.gap_m >= dDes && set < ceil) {
                res.wantKmh = Math.min(ceil, set + p.raiseStep_kmh, Math.floor(refKmh)); res.why = 'RAISE';
            } else { res.wantKmh = Math.min(set, ceil); res.why = 'HOLD'; }
            return res;
        }
        // no vehicle ahead: hold
        if (S.hadTarget && S.lostAt === null) S.lostAt = t;
        res.wantKmh = Math.min(set, ceil);
        res.why = S.hadTarget ? (t - S.curveAt < 1000 ? 'HOLD_CURVE' : 'HOLD_LOSS') : 'HOLD_FREE';
        return res;
    }

    return { step: step, params: p };
}

module.exports = { create: create, DEFAULTS: DEFAULTS };
