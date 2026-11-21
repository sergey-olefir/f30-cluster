'use strict';
/**
 * sim_gated.js - the gated command module in the cruise simulator's closed loop (package CM, rung 1; nothing reaches a car).
 *
 * The simulator (tools/cruise-sim/core/sim.js) takes replacement modules as `deps`. This file builds three of them around
 * one shared per-run context, so the module's REAL requests travel end to end:
 *
 *   controller  the app: follow.js decides the wanted set speed; shared/cruise_cmd.js gates it and builds the request. The
 *               cluster feed it reads is the cruise's own set speed and state (sim world.cruise), delayed by feedDelay_s.
 *               The driver arms it in two steps at arm.at_s, arm.at_s + confirm_s (default 0 s and 0.6 s: from the
 *               start, as SC2's controller acts from the start; first run of the app only: after a head-unit restart it
 *               stays disarmed, as at every start).
 *   warning     SC2's warning, told the deceleration the loop can really ask for: the gated rate while armed, none when
 *               disarmed (so it does not count on a cruise braking the module can no longer ask for).
 *   command     the simulator's own command path (delay, jitter, drops, duplicates, stalls) carrying the request object.
 *   plant       the simulator's cruise behind a STUB RECEIVER (stub_receiver.js): the request's bytes are decoded, checked
 *               against the frozen shape and applied (or refused, dropped, delayed, rescaled) as the stub's mode says.
 *               The driver's own key presses (a scripted change of the driver's maximum) reach the cruise directly, as
 *               a key would; at the start the cruise holds the driver's maximum.
 *
 *   makeDeps(opts) -> { deps, ctx }
 *   run(config, opts) -> result (sim.run with the deps; result.cm = the module's summary; worst-time searches re-run once
 *                        so result.cm matches the run returned)
 *   opts: { cm: module cfg, law: follow.js params, stub: stub opts, arm: { at_s, confirm_s } | false, feedDelay_s,
 *           plain: true = the module never arms (plain cruise at the driver's set speed, the comparison),
 *           driverSetAbove_kmh: the driver engages the cruise this far above the speed at the start (capped at the
 *           scenario's maximum); omitted = at the scenario's maximum, as SC3's catalogue defines the driver }
 * Node 8 syntax.
 */

const path = require('path');
const CM = require('../../shared/cruise_cmd.js');
const follow = require('./follow.js');
const stubR = require('./stub_receiver.js');
const SIM = path.join(__dirname, '..', 'cruise-sim', 'core');
const sim = require(path.join(SIM, 'sim.js'));
const realCommand = require(path.join(SIM, 'command.js'));
const realPlant = require(path.join(SIM, 'plant.js'));
const realWarning = require(path.join(SIM, 'warning.js'));

const KMH = 1 / 3.6;

/** The module's configuration for the simulator: the defaults, and the BMW-offer signal taken as known ("none"). */
const SIM_CM = { requireOfferSignal: true };

function feedOf(cruise) {
    const st = cruise.state;
    const kind = st === 'off' ? null : 'cruise';
    const status = st === 'active' ? 'active' : st === 'override' ? 'override' : st === 'off' ? 'off' : 'standby';
    const kmh = cruise.setHeld === null || cruise.setHeld === undefined ? null : Math.round(cruise.setHeld / KMH);
    return { kind: kind, status: status, kmh: kmh };
}

function makeDeps(o) {
    const opts = o || {};
    const cmCfg = Object.assign({}, SIM_CM, opts.cm || {});
    const lawP = opts.law || {};
    const stubO = opts.stub || {};
    const arm = opts.arm === false ? null : Object.assign({ at_s: 0, confirm_s: 0.6 }, opts.arm || {});
    const feedDelay = opts.feedDelay_s === undefined ? 0.2 : opts.feedDelay_s;
    const ctx = {};

    function reset() {
        ctx.wire = [];               // requests handed to the command path, in order
        ctx.inflight = {};           // command id -> request
        ctx.stubMap = {};            // stub n -> module seq
        ctx.answers = [];            // { due, seq, ok, code } for the module
        ctx.requests = [];           // every request built: { t, seq, kmh, bytes }
        ctx.violations = [];         // anything that broke the frozen shape or the wire
        ctx.changes = [];            // { t, mode, reason, armed, locked } at every change of the module's view
        ctx.logs = [];
        ctx.armResult = null;
        ctx.gen = 0;
        ctx.stub = null;
        ctx.view = null;
    }
    reset();

    const controller = {
        NAME: 'controller', SCHEMA: [], LENIENT: true,
        create: function () {
            const gen = ctx.gen++;
            const mod = CM.create(cmCfg);
            const law = follow.create(lawP);
            const feedHist = [];
            let armedStep = false, armedConfirm = false;
            let lastKey = '';
            function note(t, v, log) {
                const key = v.mode + '/' + v.reason + '/' + v.locked;
                if (key !== lastKey) { ctx.changes.push({ t: t, gen: gen, mode: v.mode, reason: v.reason, armed: v.armed, locked: v.locked }); lastKey = key; }
                if (log && ctx.logs.length < 2000) ctx.logs.push(log);
                ctx.view = v;
            }
            return {
                step: function (inp) {
                    const t = inp.t, tms = Math.round(t * 1000);
                    const cruise = inp.cruise || { state: 'active', setHeld: null };
                    const f = feedOf(cruise);
                    feedHist.push({ t: t, f: f });
                    while (feedHist.length > 1 && feedHist[1].t <= t - feedDelay + 1e-9) feedHist.shift();
                    const fd = feedHist[0].t <= t - feedDelay + 1e-9 || feedDelay === 0 ? feedHist[0].f : null;
                    const feed = fd ? { kind: fd.kind, status: fd.status, kmh: fd.kmh, t: tms } : null;
                    const est = inp.est;
                    const age = est && typeof est.age === 'number' && isFinite(est.age) ? est.age : 0;
                    const lead = est ? {
                        valid: !!(est.valid && !est.stale), gap_m: est.gap, vrel_mps: est.vrel, alead_mps2: est.alead,
                        fault: est.sensorFault === true, t: est.stale ? tms - 60000 : Math.round((t - Math.min(age, 0.4)) * 1000),
                    } : null;
                    const v0 = mod.view();
                    const setKmh = v0.armed ? v0.setKmh : (feed ? feed.kmh : null);
                    const dec = law.step({ t: tms, lead: lead, egoKmh: inp.egoV / KMH, setKmh: setKmh, ceilingKmh: v0.armed ? v0.ceilingKmh : setKmh, curvature: inp.curvature });
                    const mi = { feed: feed, egoKmh: inp.egoV / KMH, egoT: tms, egoAcc: inp.egoA, lead: lead, decision: { seq: dec.seq, t: dec.t, wantKmh: dec.wantKmh, why: dec.why }, offer: false };
                    // the setter's answers that have arrived
                    const due = ctx.answers.filter((a) => a.due <= t + 1e-9);
                    ctx.answers = ctx.answers.filter((a) => a.due > t + 1e-9);
                    due.forEach((a) => { note(t, mod.onResult(tms, a.seq, a.ok, a.code), null); });
                    // the driver arms, in two steps (the first app only)
                    if (arm && gen === 0 && !opts.plain) {
                        if (!armedStep && t >= arm.at_s - 1e-9) { armedStep = true; note(t, mod.armStep(tms), null); }
                        if (armedStep && !armedConfirm && t >= arm.at_s + arm.confirm_s - 1e-9) {
                            armedConfirm = true;
                            const v = mod.armConfirm(tms, mi);
                            ctx.armResult = { t: t, armed: v.armed, reason: v.reason };
                            note(t, v, null);
                        }
                    }
                    const r = mod.step(tms, mi);
                    note(t, r.view, r.log);
                    if (r.request) {
                        ctx.requests.push({ t: t, gen: gen, seq: r.request.seq, kmh: r.request.kmh, from: r.view.setKmh, ceil: r.view.ceilingKmh, bytes: r.request.bytes.slice() });
                        ctx.wire.push(r.request);
                        return { vSet: r.request.kmh * KMH, send: true, vRef: dec.vRefKmh === null ? null : dec.vRefKmh * KMH, dDes: dec.dDes, reason: r.view.reason };
                    }
                    return { vSet: null, send: false, vRef: dec.vRefKmh === null ? null : dec.vRefKmh * KMH, dDes: dec.dDes, reason: r.view.reason };
                },
                state: function () { return mod.view(); },
            };
        },
    };

    const command = {
        NAME: 'command', SCHEMA: realCommand.SCHEMA, PRESETS: realCommand.PRESETS,
        create: function (p, rng, c) {
            const inner = realCommand.create(p, rng, c);
            return Object.assign({}, inner, {
                send: function (t, vSet, faults) {
                    const req = ctx.wire.shift();
                    if (!req || Math.abs(req.kmh * KMH - vSet) > 1e-9) ctx.violations.push({ t: t, what: 'the command path got a value the module did not build', vSet: vSet });
                    const s = inner.send(t, vSet, faults);
                    ctx.inflight[s.id] = req || null;
                    return s;
                },
                // the plant receives (t, vSet) only; the request object rides along: sim.js calls plant.request for the
                // 'applied' arrivals in the order deliver() returned them, so the plant wrapper takes them from ctx.wireIn
                deliver: function (t) {
                    const outL = inner.deliver(t);
                    outL.forEach((d) => { if (d.status === 'applied') ctx.wireIn.push(ctx.inflight[d.id] || null); });
                    return outL;
                },
            });
        },
    };

    const plant = {
        NAME: 'plant', SCHEMA: realPlant.SCHEMA, PRESETS: realPlant.PRESETS, STATES: realPlant.STATES, params: realPlant.params,
        create: function (p, rng, c) {
            reset();
            ctx.wireIn = [];
            const inner = realPlant.create(p, rng, c);
            const stub = stubR.create(stubO);
            ctx.stub = stub;
            let lastVmax = null, first = true;
            function carry(t) {
                stub.due(t).forEach((e) => {
                    if (e.kind === 'apply') inner.request(t, e.kmh * KMH, {});
                    else ctx.answers.push({ due: t, seq: ctx.stubMap[e.seq], ok: e.ok, code: e.code });
                });
            }
            const P = Object.assign({}, inner, {
                request: function (t, vSet, faults) {
                    const req = ctx.wireIn.shift();
                    if (!req) { ctx.violations.push({ t: t, what: 'a set speed reached the cruise without a request' }); return { status: 'rejected', reason: 'no request', held: inner.cruise.setHeld }; }
                    if (faults && faults.setStuck) return { status: 'rejected', reason: 'stuck', silent: true, held: inner.cruise.setHeld };
                    const rec = stub.receive(t, req.bytes);
                    ctx.stubMap[rec.n] = req.seq;
                    if (rec.violation) ctx.violations.push({ t: t, what: rec.violation });
                    const before = inner.cruise.setHeld;
                    carry(t);
                    if (!rec.ok) return { status: 'rejected', reason: 'refused', held: inner.cruise.setHeld };
                    if (rec.applyAt === null) return { status: 'rejected', reason: 'silent', silent: true, held: inner.cruise.setHeld };
                    return { status: 'applied', reason: inner.cruise.setHeld === before ? 'deferred' : undefined, held: inner.cruise.setHeld };
                },
                step: function (dt, inp, ego) {
                    const t = inp.t;
                    carry(t);
                    const vMax = inp.driver ? inp.driver.vMax : null;
                    if (typeof vMax === 'number') {
                        if (first && typeof opts.driverSetAbove_kmh === 'number') {
                            // the driver engaged the cruise this far above the speed of the moment (not at the maximum)
                            inner.request(t, Math.min(vMax, ego.v + opts.driverSetAbove_kmh * KMH), {});
                        } else if (lastVmax === null || Math.abs(vMax - lastVmax) > 1e-9) inner.request(t, vMax, {});   // the driver's keys
                        lastVmax = vMax;
                        first = false;
                    }
                    return inner.step(dt, inp, ego);
                },
            });
            return P;
        },
    };

    // the warning (the app's own, SC2's warning.js) credits the loop with what it can really ask for: the gated rate
    // (maxStep_kmh per minInterval_ms) while the module is armed, nothing (0.1 m/s², warning.js's floor) when it is not
    const cmV = CM.validateConfig(cmCfg).cfg;
    const aGated = (cmV.maxStep_kmh / 3.6) / (cmV.minInterval_ms / 1000);
    const warning = {
        NAME: 'warning', SCHEMA: realWarning.SCHEMA,
        create: function (p) {
            const w = realWarning.create(p);
            return { step: function (i) {
                const j = Object.assign({}, i, { aCmdMax: ctx.view && ctx.view.armed ? aGated : 0.1 });
                return w.step(j);
            } };
        },
    };

    if (opts.plain) {
        controller.create = function () {
            ctx.gen++;
            return { step: function () { return { vSet: null, send: false, vRef: null, dDes: null, reason: 'PLAIN' }; } };
        };
    }
    return { deps: { controller: controller, command: command, plant: plant, warning: warning }, ctx: ctx };
}

/**
 * The module's summary of a run, from the context and the result's TRUE series (what the module could not know is
 * counted separately from what it could: `armedLowSeen_s` counts only the time its own estimate showed a vehicle).
 */
function summarize(result, ctx, opts) {
    const o = opts || {};
    const floor = o.tgFloor_s === undefined ? 1.0 : o.tgFloor_s;
    const ch = ctx.changes;
    const T = result.t, tg = result.series.timegap, ev = result.series['est.valid'], alive = result.series['app.alive'];
    // armed at sample i = the module's last view said so AND the app runs (a dead app's module is no longer armed: the
    // cruise just holds its last set speed, at or below the driver's)
    const armed = new Uint8Array(T.length);
    let ci = -1;
    for (let i = 0; i < T.length; i++) {
        while (ci + 1 < ch.length && ch[ci + 1].t <= T[i] + 1e-9) ci++;
        armed[i] = ci >= 0 && ch[ci].armed && (!alive || alive[i] === 1) ? 1 : 0;
    }
    function armedAt(t) {
        let k = -1;
        while (k + 1 < T.length && T[k + 1] <= t + 1e-9) k++;
        return k >= 0 && armed[k] === 1;
    }
    let armedLow = 0, armedLowRun = 0, worstArmedLowRun = 0, minTgArmed = Infinity, armedTime = 0;
    let seenRun = 0, worstSeenRun = 0, lastSeen = -Infinity;
    for (let i = 0; i < T.length; i++) {
        const a = armed[i] === 1;
        const dt = i > 0 ? T[i] - T[i - 1] : 0;
        if (a) armedTime += dt;
        const low = a && tg[i] < floor;
        if (a && isFinite(tg[i]) && tg[i] < minTgArmed) minTgArmed = tg[i];
        if (low) { armedLow += dt; armedLowRun += dt; if (armedLowRun > worstArmedLowRun) worstArmedLowRun = armedLowRun; }
        else armedLowRun = 0;
        // the same, counted only while the module's own input shows a vehicle ahead (it could have known)
        if (ev && ev[i] === 1) lastSeen = T[i];
        if (low && ev && ev[i] === 1) { seenRun += dt; if (seenRun > worstSeenRun) worstSeenRun = seenRun; }
        else if (!low) seenRun = 0;
    }
    const disarms = ch.filter((c, i) => i > 0 && !c.armed && ch[i - 1].armed && c.gen === ch[i - 1].gen);
    const firstDisarm = disarms.length ? disarms[0] : null;
    const col = result.meta.core.collision;
    const colT = result.meta.core.collisionT;
    const colArmed = !!(col && armedAt(colT - 0.05));
    let maxStep = 0, minInterval = Infinity, overCeiling = -Infinity;
    ctx.requests.forEach((r, i, a) => {
        maxStep = Math.max(maxStep, Math.abs(r.kmh - r.from));
        overCeiling = Math.max(overCeiling, r.kmh - r.ceil);
        if (i && a[i - 1].gen === r.gen) minInterval = Math.min(minInterval, r.t - a[i - 1].t);
    });
    return {
        armedOk: !!(ctx.armResult && ctx.armResult.armed), armReason: ctx.armResult ? ctx.armResult.reason : null,
        armed_s: armedTime, armedAtEnd: T.length ? armed[T.length - 1] === 1 : false, endReason: ctx.view ? ctx.view.reason : null,
        firstDisarm: firstDisarm ? { t: firstDisarm.t, reason: firstDisarm.reason } : null,
        requests: ctx.requests.length, violations: ctx.violations.length,
        minTgArmed: isFinite(minTgArmed) ? minTgArmed : null, armedBelowFloor_s: armedLow, worstArmedBelowFloor_s: worstArmedLowRun,
        collisionWhileArmed: colArmed, floor_s: floor,
        armedLowSeen_s: worstSeenRun,
        collisionSeenArmed: colArmed && colT - lastSeen < 3,
        maxStep: maxStep, minInterval: minInterval, overCeiling: isFinite(overCeiling) ? overCeiling : null,
    };
}

/** sim.run with the gated deps; result.cm = summarize(). */
function run(config, opts) {
    const D = makeDeps(opts);
    let r = sim.run(config, D.deps);
    if (r.meta.worst) {
        const D2 = makeDeps(opts);
        r = sim.runOnce(r.meta.config, D2.deps);
        r.cm = summarize(r, D2.ctx, opts);
        r.cmCtx = D2.ctx;
        return r;
    }
    r.cm = summarize(r, D.ctx, opts);
    r.cmCtx = D.ctx;
    return r;
}

module.exports = { makeDeps: makeDeps, run: run, summarize: summarize, feedOf: feedOf, SIM_CM: SIM_CM };
