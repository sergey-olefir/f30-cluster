'use strict';
// Package CM (rung 1): shared/cruise_cmd.js, the gated command module, on its own. Bench only; nothing reaches a car.
// Request shape (G1, G3), lower-only (H1, random inputs), steps / rate / floor (G7), arming (G2), conditions (G4, H6, H7),
// watchdog (G5), the driver wins (G6), the value check (H3), the envelope, the view and the log line (G8), exceptions.
const { test, assert } = require('./harness');
const CM = require('../../../shared/cruise_cmd.js');

// ---- helpers ----------------------------------------------------------------------------------------------------------
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function inputs(now, o) {
    o = o || {};
    return {
        feed: o.feed !== undefined ? o.feed : { kind: 'cruise', status: 'active', kmh: o.set !== undefined ? o.set : 100, t: now },
        egoKmh: o.ego !== undefined ? o.ego : 100, egoT: o.egoT !== undefined ? o.egoT : now, egoAcc: o.egoAcc,
        lead: o.lead !== undefined ? o.lead : { valid: true, gap_m: o.gap !== undefined ? o.gap : 80, vrel_mps: o.vrel !== undefined ? o.vrel : 0, alead_mps2: o.alead !== undefined ? o.alead : 0, t: now },
        decision: o.decision !== undefined ? o.decision : { seq: o.seq, t: now, wantKmh: o.want !== undefined ? o.want : 100, why: 'TEST' },
        offer: o.offer !== undefined ? o.offer : false, pedals: o.pedals, keys: o.keys,
    };
}
/** A driver who arms at t0 and confirms 600 ms later; returns { m, t, seq } with the clock after arming. */
function armed(cfg, o) {
    const m = CM.create(cfg || {});
    let seq = 0;
    m.armStep(0);
    const v = m.armConfirm(600, inputs(600, Object.assign({ seq: ++seq }, o || {})));
    assert.strictEqual(v.armed, true, 'armed: ' + v.reason);
    return { m: m, t: 600, seq: seq };
}
/** Steps the module tick by tick (100 ms) for `ms`, with inputs from fn(now) (the decision seq advances each tick). */
function run(A, ms, fn) {
    const out = [];
    const end = A.t + ms;
    while (A.t < end) {
        A.t += 100;
        const o = Object.assign({}, fn ? fn(A.t) : {});
        if (o.seq === undefined) o.seq = ++A.seq;
        const r = A.m.step(A.t, inputs(A.t, o));
        out.push(Object.assign({ t: A.t }, r));
    }
    return out;
}
function requests(rs) { return rs.filter((r) => r.request).map((r) => r.request); }

// ---- G1 / G3: the request shape ------------------------------------------------------------------------------------
test('G1: the builder makes exactly the frozen shape: "adapt to this value", every other member at its no-change value', () => {
    const r = CM.buildRequest(95, { ceilingKmh: 100, currentKmh: 100, floorKmh: 40 }, {}, 7);
    assert.strictEqual(r.service, 13203); assert.strictEqual(r.setterId, 1); assert.strictEqual(r.instance, 1);
    assert.strictEqual(r.iface, 'de.bmw.dass.driverassistanceapplications.MultimodalControlDriverAssistance');
    assert.strictEqual(r.field, 'multimodalControlDriverAssistance');
    assert.deepStrictEqual(Object.assign({}, r.value), {
        mMControlADOnOff: 0, mMControlADMode: 0, mMControlADSetSpeedValue: 95, mMControlADExtendedValue: 255,
        mMControlADSetSpeedType: 15, mMControlNHARequest: 0, mMControlSender: 2, mMControlADConfigurationChange: 0,
        mMControlADRequestAdaptionSpeed: 1, mMControlADRequestExtended: 0 });
    assert.deepStrictEqual(r.bytes.slice(), [0, 0, 95, 255, 15, 0, 2, 0, 1, 0]);
    assert.strictEqual(r.names.mMControlADRequestAdaptionSpeed, 'REQUEST_ADAPT_SPEED_SPEEDVALUE');
    assert.strictEqual(r.names.mMControlADOnOff, 'NO_CHANGE');
    assert.strictEqual(r.names.mMControlSender, 'PROACTIVE_OFFER');
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.value) && Object.isFrozen(r.bytes), 'frozen');
    assert.strictEqual(r.seq, 7);
    assert.deepStrictEqual(CM.decode(r.bytes), Object.assign({}, r.value));
    // SPEECH only by configuration
    const s = CM.buildRequest(95, { ceilingKmh: 100, currentKmh: 100, floorKmh: 40 }, { sender: 'SPEECH' });
    assert.strictEqual(s.value.mMControlSender, 1);
});

test('G3: every forbidden value of every frozen member throws in the shape check (ON, OFF, RESUME, CANCEL, modes, current speed, SLA, undo, extended, NHA, configuration)', () => {
    const good = Object.assign({}, CM.buildRequest(90, { ceilingKmh: 100, currentKmh: 95, floorKmh: 40 }, {}).value);
    assert.strictEqual(CM.assertFrozenShape(good, {}), true);
    let n = 0;
    Object.keys(CM.FROZEN).forEach((k) => {
        for (let v = 0; v <= 255; v++) {
            if (v === CM.FROZEN[k]) continue;
            const bad = Object.assign({}, good); bad[k] = v;
            assert.throws(() => CM.assertFrozenShape(bad, {}), /CM_FORBIDDEN/, k + '=' + v);
            n++;
        }
    });
    // the named ones, explicitly
    const named = [['mMControlADOnOff', ['ON', 'OFF', 'COMPLETE_OFF', 'RESUME', 'CANCEL']], ['mMControlADMode', ['LAST_MODE', 'MODE_1', 'MODE_8']],
        ['mMControlADRequestAdaptionSpeed', ['REQUEST_ADAPT_SPEED_CURRENTSPEED', 'REQUEST_ADAPT_CURRENT_SLA_SUGGESTION', 'REQUEST_UNDO_CURRENT_SLA_CHANGE', 'NO_CHANGE']],
        ['mMControlADRequestExtended', ['REQUEST_AUTOMATED_FOLLOW_RESUME', 'REQUEST_DRIVE_OFF', 'REQUEST_OVERTAKE_ON_SLOW_LANE', 'REQUEST_REACTION_ON_TRAFFICLIGHT', 'REQUEST_CANCEL_REACTION_ON_TRAFFICLIGHT']],
        ['mMControlNHARequest', ['ACTIVATE_PRE_NHA', 'ACTIVATE_NHA', 'CANCEL_PRE_NHA']], ['mMControlADConfigurationChange', ['CHANGE']]];
    named.forEach((p) => p[1].forEach((name) => {
        const bad = Object.assign({}, good); bad[p[0]] = CM.ENUMS[p[0]][name];
        assert.throws(() => CM.assertFrozenShape(bad, {}), /CM_FORBIDDEN/, p[0] + ' ' + name);
    }));
    // the sender: only the configured one of the two
    [0, 1, 13, 14, 15, 3, 255].forEach((v) => { const bad = Object.assign({}, good); bad.mMControlSender = v; assert.throws(() => CM.assertFrozenShape(bad, {}), /CM_FORBIDDEN/, 'sender ' + v); });
    const sp = Object.assign({}, good, { mMControlSender: 1 });
    assert.strictEqual(CM.assertFrozenShape(sp, { sender: 'SPEECH' }), true);
    assert.throws(() => CM.assertFrozenShape(good, { sender: 'UNKOWN' }), /CM_FORBIDDEN/);
    // the value: 255 is "not filled"; a fraction; a member missing or added
    assert.throws(() => CM.assertFrozenShape(Object.assign({}, good, { mMControlADSetSpeedValue: 255 }), {}), /CM_FORBIDDEN/);
    assert.throws(() => CM.assertFrozenShape(Object.assign({}, good, { mMControlADSetSpeedValue: 90.5 }), {}), /CM_FORBIDDEN/);
    const miss = Object.assign({}, good); delete miss.mMControlADRequestExtended;
    assert.throws(() => CM.assertFrozenShape(miss, {}), /CM_FORBIDDEN/);
    assert.throws(() => CM.assertFrozenShape(Object.assign({}, good, { extra: 0 }), {}), /CM_FORBIDDEN/);
    assert.throws(() => CM.encode(Object.assign({}, good, { mMControlADOnOff: 256 })), /CM_FORBIDDEN/);
    assert.throws(() => CM.decode([0, 0, 90]), /CM_FORBIDDEN/);
    assert.ok(n > 2000, n + ' forbidden values tried');
});

test('G1 / G7 / H1: the builder refuses above the ceiling, below the floor or 40, steps over 5 or of 0, fractions, a ceiling over 250, a loosened configuration', () => {
    const L = (c, cur, f) => ({ ceilingKmh: c, currentKmh: cur, floorKmh: f === undefined ? 40 : f });
    assert.throws(() => CM.buildRequest(101, L(100, 100), {}), /above the ceiling/);
    assert.throws(() => CM.buildRequest(105, L(100, 100), {}), /above the ceiling/);
    assert.throws(() => CM.buildRequest(39, L(100, 41), {}), /below the floor/);
    assert.throws(() => CM.buildRequest(45, L(100, 47, 50), {}), /below the floor/);
    assert.throws(() => CM.buildRequest(44, L(100, 46, 30), {}), /floor/);
    assert.throws(() => CM.buildRequest(94, L(100, 100), {}), /step 6/);
    assert.throws(() => CM.buildRequest(100, L(100, 100), {}), /no change/);
    assert.throws(() => CM.buildRequest(95.5, L(100, 100), {}), /not whole/);
    assert.throws(() => CM.buildRequest(250, L(251, 251), {}), /ceiling/);
    assert.throws(() => CM.buildRequest(97, L(100, 100), { maxStep_kmh: 6 }), /config/);
    assert.throws(() => CM.buildRequest(97, L(100, 100), { minInterval_ms: 2999 }), /config/);
    assert.throws(() => CM.buildRequest(97, L(100, 100), { floor_kmh: 30 }), /config/);
    assert.throws(() => CM.buildRequest(97, L(100, 100), { sender: 'UNKOWN' }), /config/);
    assert.throws(() => CM.buildRequest(97, L(100, 100), { onOff: 'ON' }), /config/);
    assert.throws(() => CM.buildRequest(97, L(100, 100), { valueFactor: 2 }), /whole raw step/);
    // a raise back toward the ceiling is fine; so is a step of exactly 5
    assert.strictEqual(CM.buildRequest(100, L(100, 95), {}).kmh, 100);
    assert.strictEqual(CM.buildRequest(90, L(100, 95), {}).kmh, 90);
    // an assumed scale: 0.5 km/h per unit
    assert.strictEqual(CM.buildRequest(90, L(100, 95), { valueFactor: 0.5 }).value.mMControlADSetSpeedValue, 180);
});

test('the module source builds requests in one place only, and names no driver-assistance settings setter', () => {
    const src = require('fs').readFileSync(require.resolve('../../../shared/cruise_cmd.js'), 'utf8');
    assert.strictEqual((src.match(/mMControlADRequestAdaptionSpeed: FROZEN\./g) || []).length, 1, 'one struct literal');
    ['resetSettingsSafetyFunctions', 'SettingsDriverAssistanceFunctions', 'iDriveFAS', 'settingSpeedLimitAssist', 'require(', 'Date', 'setTimeout', 'setInterval', 'console', 'process', 'Math.random']
        .forEach((w) => assert.ok(src.indexOf(w) < 0, 'mentions ' + w));
});

// ---- G2: arming -----------------------------------------------------------------------------------------------------
test('G2: disarmed at every start; armed only by two deliberate steps 0.5-5 s apart; the ceiling is the set speed at arming', () => {
    const m = CM.create({});
    assert.deepStrictEqual([m.view().armed, m.view().mode, m.view().reason], [false, 'DISARMED', 'START']);
    assert.strictEqual(m.armConfirm(100, inputs(100)).reason, 'ARM_NO_STEP1');
    assert.strictEqual(m.step(200, inputs(200, { seq: 1 })).request, null);
    m.armStep(1000);
    assert.strictEqual(m.view().mode, 'ARMING');
    assert.strictEqual(m.armConfirm(1300, inputs(1300)).reason, 'ARM_TOO_FAST');
    m.armStep(2000);
    assert.strictEqual(m.armConfirm(7100, inputs(7100)).reason, 'ARM_TIMEOUT');
    m.armStep(8000);
    m.step(13500, inputs(13500, { seq: 2 }));
    assert.strictEqual(m.view().reason, 'ARM_TIMEOUT', 'an unconfirmed first step lapses');
    m.armStep(20000);
    const v = m.armConfirm(20600, inputs(20600, { set: 112, ego: 110 }));
    assert.strictEqual(v.armed, true);
    assert.strictEqual(v.ceilingKmh, 112);
    assert.strictEqual(v.setKmh, 112);
    // a second module (a new drive) starts disarmed again: nothing is remembered
    assert.strictEqual(CM.create({}).view().armed, false);
});

test('G4 / H6 / H7: arming is refused (not locked) unless DCC is active, the speed above 40, the inputs fresh, no BMW offer shown or unknown', () => {
    const cases = [
        [{ feed: { kind: 'limiter', status: 'active', kmh: 100 } }, 'LIMITER_ACTIVE'],
        [{ feed: { kind: 'acc', status: 'active', kmh: 100 } }, 'NOT_DCC'],
        [{ feed: { kind: 'cruise', status: 'standby', kmh: 100 } }, 'CRUISE_NOT_ACTIVE'],
        [{ feed: { kind: 'cruise', status: 'active', kmh: null } }, 'SET_UNKNOWN'],
        [{ feed: null }, 'NO_FEED'],
        [{ ego: 40, set: 45 }, 'SPEED_LOW'],
        [{ offer: true }, 'OFFER_SHOWN'],
        [{ offer: null }, 'OFFER_UNKNOWN'],
        [{ egoT: -1000 }, 'STALE_INPUT'],
        [{ lead: null }, 'STALE_INPUT'],
        [{ set: 40, ego: 44 }, 'OVERRIDE_INFERRED'],
        [{ set: 40, ego: 42 }, 'CEILING_AT_FLOOR'],
        [{ gap: 20 }, 'ENVELOPE_GAP'],
    ];
    cases.forEach((c) => {
        const m = CM.create({});
        m.armStep(0);
        const v = m.armConfirm(600, inputs(600, c[0]));
        assert.strictEqual(v.armed, false, c[1]);
        assert.strictEqual(v.reason, c[1], JSON.stringify(c[0]));
        assert.strictEqual(v.locked, false, c[1] + ' must not lock');
    });
});

// ---- G7 / H1: steps, rate, floor, lower-only ------------------------------------------------------------------------------
test('G7: at most 5 km/h per request, at most one request per 3 s, never below the floor (40 or the driver\'s minimum)', () => {
    const A = armed({ driverMin_kmh: 60 }, { set: 100 });
    let set = 100;
    const cur = () => A.m.view().pendingKmh || A.m.view().setKmh;     // the cruise takes every request at once
    const rs = run(A, 60000, () => ({ set: cur(), want: 20, ego: cur(), gap: 400, vrel: 0 }));
    const reqs = [];
    rs.forEach((r) => { if (r.request) { reqs.push([r.t, r.request.kmh, set]); set = r.request.kmh; } });
    assert.ok(reqs.length >= 8, 'it went down: ' + reqs.length);
    reqs.forEach((q, i) => {
        assert.ok(q[2] - q[1] <= 5 && q[2] - q[1] >= 1, 'step ' + (q[2] - q[1]));
        if (i) assert.ok(q[0] - reqs[i - 1][0] >= 3000, 'interval ' + (q[0] - reqs[i - 1][0]));
        assert.ok(q[1] >= 60, 'floor ' + q[1]);
    });
    assert.strictEqual(set, 60);
    assert.strictEqual(rs[rs.length - 1].view.reason, 'HOLD_FLOOR');
});

test('H1: with random inputs over many drives, no request ever exceeds the driver\'s set speed at arming, and none leaves while disarmed', () => {
    const rnd = lcg(12345);
    let total = 0, drives = 0, lowered = 0, raised = 0;
    for (let d = 0; d < 300; d++) {
        const ceil = 50 + Math.floor(rnd() * 150);
        const m = CM.create({});
        m.armStep(0);
        const v0 = m.armConfirm(700, inputs(700, { set: ceil, ego: ceil, gap: 150 }));
        if (!v0.armed) continue;
        drives++;
        let set = ceil, seq = 1, now = 700;
        for (let k = 0; k < 400; k++) {
            now += 100;
            const o = { seq: ++seq, set: set, ego: Math.max(41, set + (rnd() - 0.6) * 6), gap: 20 + rnd() * 200, vrel: (rnd() - 0.5) * 4,
                alead: (rnd() - 0.5) * 0.8, want: rnd() < 0.1 ? null : rnd() * 400 - 50 };
            if (rnd() < 0.05) o.lead = { valid: false, t: now };
            const before = m.view();
            const r = m.step(now, inputs(now, o));
            if (r.request) {
                total++;
                assert.ok(before.armed, 'a request while disarmed');
                assert.ok(r.request.kmh <= ceil, 'request ' + r.request.kmh + ' above the ceiling ' + ceil);
                assert.ok(r.request.kmh >= 40);
                assert.ok(Math.abs(r.request.kmh - set) <= 5);
                if (r.request.kmh < set) lowered++; else raised++;
                if (rnd() < 0.97) set = r.request.kmh;           // mostly the cruise takes it; sometimes not
            }
            if (!r.view.armed && rnd() < 0.5) break;
        }
    }
    assert.ok(drives > 200 && total > 100 && lowered > 30 && raised > 5, drives + ' drives, ' + total + ' requests, ' + lowered + ' down, ' + raised + ' up');
});

test('no vehicle ahead: the module sends nothing (it never raises on a lost or missing target)', () => {
    const A = armed({}, { set: 100 });
    const rs = run(A, 20000, () => ({ set: 95, ego: 95, want: 100, lead: { valid: false, t: A.t } }));
    // the set speed 95 differs from the module's 100 without a request: a driver change, first
    assert.strictEqual(rs[0].view.reason, 'DRIVER_SET_CHANGE');
    const B = armed({}, { set: 100 });
    let set = 100;
    const r1 = run(B, 600, (now) => ({ set: set, want: 95, gap: 200 }));
    set = 95;
    const r2 = run(B, 20000, (now) => ({ set: set, ego: 95, want: 100, lead: { valid: false, t: now } }));
    assert.strictEqual(requests(r1).length, 1);
    assert.strictEqual(requests(r2).length, 0);
    assert.strictEqual(r2[r2.length - 1].view.reason, 'HOLD_NO_LEAD');
    assert.strictEqual(r2[r2.length - 1].view.armed, true);
});

// ---- G6: the driver wins --------------------------------------------------------------------------------------------
test('G6: brake, accelerator (pedal, feed, inferred), a cruise key, the cruise leaving ACTIVE, the limiter, a set-speed change not ours: disarmed and locked for the drive', () => {
    const paths = [
        [{ pedals: { brake: true } }, 'BRAKE'],
        [{ pedals: { accel: true } }, 'ACCEL_OVERRIDE'],
        [{ keys: { pressed: true } }, 'CRUISE_KEY'],
        [{ feed: { kind: 'cruise', status: 'override', kmh: 100 } }, 'ACCEL_OVERRIDE'],
        [{ feed: { kind: 'cruise', status: 'standby', kmh: 100 } }, 'CRUISE_NOT_ACTIVE'],
        [{ feed: { kind: null, status: 'off', kmh: null } }, 'NOT_DCC'],
        [{ feed: { kind: 'limiter', status: 'active', kmh: 100 } }, 'LIMITER_ACTIVE'],
        [{ ego: 104 }, 'OVERRIDE_INFERRED'],
        [{ ego: 100, egoAcc: 1.0, set: 100 }, null],                 // accelerating at the set speed: not an override
        [{ set: 97 }, 'DRIVER_SET_CHANGE'],
        [{ set: 101 }, 'DRIVER_SET_CHANGE'],
    ];
    paths.forEach((p) => {
        const A = armed({}, { set: 100 });
        const r = run(A, 100, () => Object.assign({ want: 100 }, p[0]));
        if (p[1] === null) { assert.strictEqual(r[0].view.armed, true, 'stays armed'); return; }
        assert.strictEqual(r[0].view.armed, false, p[1]);
        assert.strictEqual(r[0].view.reason, p[1]);
        assert.strictEqual(r[0].view.locked, true, p[1] + ' locks');
        // nothing more for the rest of the drive, and no re-arming
        const later = run(A, 10000, () => ({ want: 60 }));
        assert.strictEqual(requests(later).length, 0);
        A.m.armStep(A.t);
        assert.strictEqual(A.m.armConfirm(A.t + 600, inputs(A.t + 600)).reason, 'LOCKED_FOR_DRIVE');
    });
});

test('G6 / H3: the module tells its own change from the driver\'s: its pending value arriving is VERIFIED; another value during the window is a mismatch', () => {
    const A = armed({}, { set: 100 });
    const r1 = run(A, 100, () => ({ set: 100, want: 90, gap: 150 }));
    assert.strictEqual(requests(r1)[0].kmh, 95);
    const r2 = run(A, 300, () => ({ set: 100, want: 90, gap: 150 }));
    assert.strictEqual(r2[2].view.mode, 'ADJUSTING');
    const r3 = run(A, 100, () => ({ set: 95, want: 90, gap: 150 }));
    assert.strictEqual(r3[0].view.verified, 1, 'its own value arrived: verified');
    assert.strictEqual(r3[0].view.armed, true);
    assert.strictEqual(r3[0].view.setKmh, 95);
    assert.strictEqual(r3[0].view.reason, 'HOLD_RATE', 'and it waits for its next slot');
    // the next request: the feed shows 93 instead of 90
    const r4 = run(A, 3000, () => ({ set: 95, want: 90, gap: 150 }));
    assert.strictEqual(requests(r4)[0].kmh, 90);
    const r5 = run(A, 100, () => ({ set: 93, want: 90, gap: 150 }));
    assert.strictEqual(r5[0].view.reason, 'VALUE_MISMATCH');
    assert.strictEqual(r5[0].view.locked, true);
});

// ---- H3: the value check and the setter's answer --------------------------------------------------------------------
test('H3: no change within the window disarms (NO_EFFECT); a refusal disarms (REFUSED); a late OK answer changes nothing', () => {
    const A = armed({}, { set: 100 });
    const r = run(A, 100, () => ({ set: 100, want: 90, gap: 150 }));
    const seq = requests(r)[0].seq;
    assert.strictEqual(A.m.onResult(A.t + 3000, seq, true, 'OK').armed, true, 'a late OK');
    const w = run(A, 2400, () => ({ set: 100, want: 90, gap: 150 }));
    assert.strictEqual(w[w.length - 1].view.armed, true, 'still within the window');
    const x = run(A, 200, () => ({ set: 100, want: 90, gap: 150 }));
    assert.strictEqual(x[x.length - 1].view.reason, 'NO_EFFECT');
    assert.strictEqual(x[x.length - 1].view.locked, true);
    const B = armed({}, { set: 100 });
    const rb = run(B, 100, () => ({ set: 100, want: 90, gap: 150 }));
    assert.strictEqual(B.m.onResult(B.t, 999, false, 'X').armed, true, 'an answer to a request it never sent is ignored');
    const v = B.m.onResult(B.t, requests(rb)[0].seq, false, 'REFUSED');
    assert.deepStrictEqual([v.armed, v.reason, v.locked], [false, 'REFUSED', true]);
});

// ---- G5: the watchdog -----------------------------------------------------------------------------------------------------
test('G5: a decision that does not advance for 2 ticks, is older than 2 ticks, or is missing, stops everything', () => {
    const A = armed({}, { set: 100 });
    const r = run(A, 300, () => ({ seq: 41, want: 90, gap: 150 }));
    assert.strictEqual(r[0].view.armed, true);
    assert.strictEqual(r[1].view.armed, true);
    assert.strictEqual(r[2].view.reason, 'WATCHDOG');
    assert.strictEqual(r[2].view.locked, true);
    const B = armed({}, { set: 100 });
    const rb = run(B, 100, (now) => ({ decision: { seq: 99, t: now - 250, wantKmh: 90 } }));
    assert.strictEqual(rb[0].view.reason, 'WATCHDOG');
    const C = armed({}, { set: 100 });
    assert.strictEqual(run(C, 100, () => ({ decision: null }))[0].view.reason, 'WATCHDOG');
    // a decision that is fresh again does not re-arm
    assert.strictEqual(requests(run(C, 5000, () => ({ want: 80, gap: 150 }))).length, 0);
});

// ---- G4: freshness and the envelope -------------------------------------------------------------------------------------------
test('G4: stale speed, a stale or silent camera, a camera fault: no request, disarmed (stale locks, a fault does not)', () => {
    let A = armed({}, { set: 100 });
    assert.strictEqual(run(A, 100, (now) => ({ egoT: now - 600 }))[0].view.reason, 'STALE_INPUT');
    A = armed({}, { set: 100 });
    assert.strictEqual(run(A, 100, (now) => ({ lead: { valid: true, gap_m: 80, vrel_mps: 0, t: now - 1100 } }))[0].view.reason, 'STALE_INPUT');
    A = armed({}, { set: 100 });
    const f = run(A, 100, (now) => ({ lead: { valid: false, fault: true, t: now } }))[0].view;
    assert.deepStrictEqual([f.reason, f.locked], ['SENSOR_FAULT', false]);
    A = armed({}, { set: 100 });
    assert.strictEqual(run(A, 100, () => ({ ego: 39, set: 100 }))[0].view.reason, 'SPEED_LOW');
    A = armed({}, { set: 100 });
    assert.strictEqual(run(A, 100, () => ({ offer: true }))[0].view.reason, 'OFFER_SHOWN');
});

test('envelope: a close vehicle, a lead below the floor, a persistently braking lead, a closing the gated descent cannot absorb: disarmed (not locked); a gentle closing is fine', () => {
    const v = 100 / 3.6;
    let A = armed({}, { set: 100 });
    assert.strictEqual(run(A, 100, () => ({ gap: 0.9 * v }))[0].view.reason, 'ENVELOPE_GAP');
    A = armed({}, { set: 100 });
    assert.strictEqual(run(A, 100, () => ({ ego: 50, set: 100, gap: 100, vrel: -2 }))[0].view.reason, 'ENVELOPE_FLOOR');
    A = armed({}, { set: 100 });
    const early = run(A, 1800, () => ({ gap: 150, alead: -3 }));
    assert.ok(early.every((r) => r.view.armed), 'the first 2 s after the lead is acquired are its settling transient');
    run(A, 1000, () => ({ gap: 150, alead: 0 }));
    const one = run(A, 100, () => ({ gap: 150, alead: -3 }));
    assert.strictEqual(one[0].view.armed, true, 'one noisy sample is not a braking lead');
    const b = run(A, 1500, () => ({ gap: 150, alead: -2 }));
    assert.ok(b.some((r) => r.view.reason === 'ENVELOPE_LEAD_BRAKING'), 'a lead braking at 2 m/s² for 1.5 s');
    A = armed({}, { set: 100 });
    const c = run(A, 100, () => ({ gap: 60, vrel: -30 / 3.6 }));
    assert.deepStrictEqual([c[0].view.reason, c[0].view.locked], ['ENVELOPE_CLOSING', false]);
    A = armed({}, { set: 100 });
    const g = run(A, 100, () => ({ gap: 120, vrel: -5 / 3.6, want: 95 }));
    assert.strictEqual(g[0].view.armed, true, 'Δv 5 km/h at 120 m is inside: ' + g[0].view.reason);
    assert.strictEqual(g[0].request.kmh, 95);
    // after an envelope disarm the driver may arm again (two steps) once it is clear
    A.m.disarm(A.t);
    assert.strictEqual(A.m.view().reason, 'DRIVER_OFF');
    A.m.armStep(A.t + 100);
    assert.strictEqual(A.m.armConfirm(A.t + 800, inputs(A.t + 800, { set: 100 })).armed, true);
});

// ---- G8, the log, exceptions, configuration -------------------------------------------------------------------------------
test('G8: the view says armed / adjusting / holding and why; every reason is an enum; the log line is numbers and enum names only', () => {
    const A = armed({}, { set: 100 });
    const rs = run(A, 20000, (now) => ({ set: A.m.view().pendingKmh || A.m.view().setKmh, want: 85, gap: 200 }))
        .concat(run(A, 300, () => ({ pedals: { brake: true } })));
    const modes = {};
    rs.forEach((r) => {
        modes[r.view.mode] = true;
        assert.ok(CM.REASONS.indexOf(r.view.reason) >= 0, 'reason ' + r.view.reason);
        assert.ok(CM.MODES.indexOf(r.view.mode) >= 0);
        if (r.log) assert.ok(/^cm( [a-z]+=(-|-?\d+(\.\d+)?|[A-Z][A-Z0-9_]*))+$/.test(r.log), r.log);
    });
    assert.ok(modes.HOLDING && modes.ADJUSTING && modes.DISARMED, JSON.stringify(modes));
    assert.ok(rs.filter((r) => r.log).length < rs.length / 3, 'a log line on changes, not every tick');
});

test('no exception escapes: garbage inputs, a throwing getter, a bad clock all disarm (INTERNAL_ERROR / WATCHDOG) and return a view', () => {
    const A = armed({}, { set: 100 });
    const evil = {};
    Object.defineProperty(evil, 'lead', { get: () => { throw new Error('boom'); } });
    const r = A.m.step(A.t + 100, evil);
    assert.strictEqual(r.request, null);
    assert.deepStrictEqual([r.view.armed, r.view.reason, r.view.locked], [false, 'INTERNAL_ERROR', true]);
    const B = armed({}, { set: 100 });
    assert.strictEqual(B.m.step(NaN, inputs(700)).view.reason, 'INTERNAL_ERROR');
    const C = CM.create({});
    [undefined, null, 5, 'x', [], {}].forEach((x) => { C.step(1000, x); C.armStep(x); C.armConfirm(1000, x); C.onResult(1, x, x, x); C.disarm(x); });
    assert.strictEqual(C.view().armed, false);
});

test('configuration: unknown keys or anything outside the hard limits leaves the module locked (CONFIG_INVALID), never armed', () => {
    [{ maxStep_kmh: 6 }, { minInterval_ms: 1000 }, { floor_kmh: 35 }, { minEgo_kmh: 30 }, { watchdogTicks: 3 }, { sender: 'UNKOWN' },
        { verifyWindow_ms: 3000 }, { whatever: 1 }, { valueUnit: 'mph' }, 'x'].forEach((c) => {
        const m = CM.create(c);
        assert.deepStrictEqual([m.view().reason, m.view().locked], ['CONFIG_INVALID', true], JSON.stringify(c));
        m.armStep(0);
        assert.strictEqual(m.armConfirm(600, inputs(600)).armed, false);
        assert.strictEqual(m.view().reason, 'CONFIG_INVALID');
    });
    const v = CM.validateConfig({});
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.cfg.sender, 'PROACTIVE_OFFER');
    assert.strictEqual(v.cfg.valueAssumed, true);
});
