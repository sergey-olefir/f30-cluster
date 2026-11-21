'use strict';
// Package CM (rung 1): the stub receiver (a fake service 13203), its failure modes in the simulator's closed loop with the
// module's real requests, and the bench over a local HTTP port (8812; 127.0.0.1 only). Nothing reaches a car.
const { test, assert } = require('./harness');
const CM = require('../../../shared/cruise_cmd.js');
const stubR = require('../../cruise-cmd/stub_receiver.js');
const G = require('../../cruise-cmd/sim_gated.js');
const bench = require('../../cruise-cmd/bench.js');
const sc = require('../core/scenario');

const REQ = CM.buildRequest(95, { ceilingKmh: 100, currentKmh: 100, floorKmh: 40 }, {}, 1);

test('stub: each mode does what it says (accept, refuse, silent, lateAnswer, lateRefuse, scale, delayApply, offAfter)', () => {
    function once(o, n) {
        const s = stubR.create(o);
        const recs = [];
        for (let i = 0; i < (n || 1); i++) recs.push(s.receive(i, REQ.bytes));
        return { s: s, recs: recs, ev: s.due(100) };
    }
    let r = once({ mode: 'accept' });
    assert.deepStrictEqual(r.ev.map((e) => [e.kind, e.kmh || e.ok]), [['apply', 95], ['answer', true]]);
    r = once({ mode: 'refuse' });
    assert.deepStrictEqual(r.ev.map((e) => [e.kind, e.ok]), [['answer', false]]);
    r = once({ mode: 'silent' });
    assert.deepStrictEqual(r.ev.map((e) => [e.kind, e.ok]), [['answer', true]]);
    r = once({ mode: 'lateAnswer', lateAnswer_s: 3 });
    assert.strictEqual(r.recs[0].answerAt, 3);
    assert.strictEqual(r.ev[0].kind, 'apply');
    r = once({ mode: 'lateRefuse', lateAnswer_s: 3 });
    assert.deepStrictEqual(r.ev.map((e) => [e.kind, e.ok, e.t]), [['answer', false, 3]]);
    r = once({ mode: 'scale', scaleFactor: 2 });
    assert.strictEqual(r.ev[0].kmh, 190);
    r = once({ mode: 'scale', scaleFactor: 1, scaleOffset: -3 });
    assert.strictEqual(r.ev[0].kmh, 92);
    r = once({ mode: 'delayApply', applyDelay_s: 4 });
    assert.strictEqual(r.recs[0].applyAt, 4);
    r = once({ mode: 'offAfter', okCount: 2 }, 4);
    assert.deepStrictEqual(r.recs.map((x) => x.applyAt !== null), [true, true, false, false]);
    assert.throws(() => stubR.create({ mode: 'magic' }));
});

test('stub: a payload outside the frozen shape is a violation, never applied (ON, RESUME, take current speed, malformed)', () => {
    const s = stubR.create({ mode: 'accept' });
    const v = Object.assign({}, REQ.value);
    [['mMControlADOnOff', 1], ['mMControlADOnOff', 4], ['mMControlADRequestAdaptionSpeed', 2], ['mMControlADRequestExtended', 1], ['mMControlSender', 0]].forEach((p) => {
        const bad = Object.assign({}, v); bad[p[0]] = p[1];
        const rec = s.receive(0, CM.encode(bad));
        assert.ok(rec.violation, p.join('='));
        assert.strictEqual(rec.applyAt, null);
    });
    assert.ok(s.receive(0, [1, 2, 3]).violation);
    assert.ok(s.receive(0, null).violation);
    assert.strictEqual(s.violations.length, 7);
    assert.ok(s.due(10).every((e) => e.kind === 'answer' && e.ok === false));
});

// ---- the stub's failure modes in the closed loop (a gentle approach: Δv 10 km/h at 60) ----------------------------------
function loop(id, stub, cfgX) {
    const c = sc.load(id);
    const cfg = sc.toConfig(c, Object.assign({ seed: 1, plant: { preset: 'mild' } }, cfgX || {}));
    const opts = { driverSetAbove_kmh: 5 };
    if (stub) opts.stub = stub;
    return G.run(cfg, opts);
}
function common(r, what) {
    assert.strictEqual(r.cm.violations, 0, what + ': violations');
    assert.ok(r.cm.overCeiling === null || r.cm.overCeiling <= 0, what + ': above the ceiling');
    assert.ok(r.cm.maxStep <= 5, what + ': step');
    assert.ok(!(r.cm.minInterval < 3 - 1e-6), what + ': interval');
    assert.strictEqual(r.cm.collisionSeenArmed, false, what + ': a seen collision while armed');
}
const ID = 'B.approach#v=60,dv=10';

test('closed loop, stub accept and lateAnswer: the module follows to the end, every request verified', () => {
    ['accept', 'lateAnswer'].forEach((mode) => {
        const r = loop(ID, { mode: mode });
        common(r, mode);
        assert.strictEqual(r.cm.firstDisarm, null, mode);
        assert.ok(r.cm.requests >= 5, mode + ' requests ' + r.cm.requests);
        assert.strictEqual(r.metrics.collision, false);
        assert.ok(r.metrics.minTimeGap_s >= 1.0);
    });
});

test('closed loop, stub refuse / silent / lateRefuse / delayApply / offAfter: disarmed for the drive at the first request that fails', () => {
    const cases = [
        [{ mode: 'refuse' }, 'REFUSED', 1],
        [{ mode: 'silent' }, 'NO_EFFECT', 1],
        [{ mode: 'lateRefuse', lateAnswer_s: 3 }, 'NO_EFFECT', 1],
        [{ mode: 'lateRefuse', lateAnswer_s: 1 }, 'REFUSED', 1],
        [{ mode: 'delayApply', applyDelay_s: 4 }, 'NO_EFFECT', 1],
        [{ mode: 'offAfter', okCount: 2 }, 'NO_EFFECT', 3],
    ];
    cases.forEach((c) => {
        const r = loop(ID, c[0]);
        const what = JSON.stringify(c[0]);
        common(r, what);
        assert.ok(r.cm.firstDisarm && r.cm.firstDisarm.reason === c[1], what + ': ' + JSON.stringify(r.cm.firstDisarm));
        assert.strictEqual(r.cm.requests, c[2], what + ' requests');
        const t0 = r.cmCtx.requests[c[2] - 1].t;
        assert.ok(r.cm.firstDisarm.t - t0 <= 2.7, what + ': disarmed ' + (r.cm.firstDisarm.t - t0).toFixed(2) + ' s after the request');
        assert.ok(r.cmCtx.changes[r.cmCtx.changes.length - 1].locked, what + ': locked');
    });
    // a value applied a little late (1.5 s) is still inside the 2.5 s window
    const late = loop(ID, { mode: 'delayApply', applyDelay_s: 1.5 });
    common(late, 'delayApply 1.5');
    assert.strictEqual(late.cm.firstDisarm, null);
});

test('closed loop, stub with another scale (x0.5, x2, -3 km/h): VALUE_MISMATCH at the first request; the x2 residual is real (H3)', () => {
    [[{ mode: 'scale', scaleFactor: 0.5 }], [{ mode: 'scale', scaleFactor: 2 }], [{ mode: 'scale', scaleOffset: -3 }]].forEach((c) => {
        const r = loop(ID, c[0]);
        common(r, JSON.stringify(c[0]));
        assert.strictEqual(r.cm.firstDisarm.reason, 'VALUE_MISMATCH');
        assert.strictEqual(r.cm.requests, 1);
        assert.ok(r.cm.firstDisarm.t - r.cmCtx.requests[0].t < 1.0);
    });
    // what the check cannot undo: x2 turned "57" into 114 km/h, which the cruise holds after the module has disarmed
    const r = loop(ID, { mode: 'scale', scaleFactor: 2 });
    const maxSet = Math.max.apply(null, Array.prototype.slice.call(r.series['set.held'])) * 3.6;
    assert.ok(maxSet > 110, 'the stub applied ' + maxSet.toFixed(0) + ' km/h: H3\'s residual "a first wrong request before the check"');
});

test('closed loop, the simulator\'s worst command path (drops, duplicates, reorder, stalls): no violation; a dropped request disarms (NO_EFFECT)', () => {
    const r = loop(ID, null, { command: { preset: 'worst' } });
    common(r, 'worst');
    assert.strictEqual(r.cm.firstDisarm.reason, 'NO_EFFECT');
    assert.ok(r.events.some((e) => e.kind === 'cmd.dropped' || e.kind === 'cmd.rejected'), 'a request was lost');
});

// ---- the bench: the stub service behind a local port -------------------------------------------------------------------------
test('bench: the module\'s requests go over HTTP to the stub service on 127.0.0.1:8812; accept follows, refuse disarms, no violation', async () => {
    assert.throws(() => bench.startServer({ port: 80 }), /8811-8819/);
    for (const mode of ['accept', 'refuse', 'silent']) {
        const clk = { t: 0 };
        const s = await bench.startServer({ port: 8812, mode: mode, startKmh: 100, clock: () => clk.t });
        try {
            const r = await bench.runApp({ port: 8812, ticks: 160, clockState: clk, sleepMs: 4 });
            assert.strictEqual(r.stub.violations, 0, mode);
            r.requests.forEach((q) => { assert.ok(q.kmh <= 100 && q.kmh >= 40); CM.assertFrozenShape(CM.decode(q.bytes), {}); });
            r.log.forEach((l) => assert.ok(/^cm( [a-z]+=(-|-?\d+(\.\d+)?|[A-Z][A-Z0-9_]*))+$/.test(l), l));
            if (mode === 'accept') {
                assert.ok(r.requests.length >= 3, 'accept: ' + r.requests.length);
                assert.strictEqual(r.view.armed, true, 'accept: ' + r.view.reason);
                assert.strictEqual(r.stub.setKmh, r.view.setKmh);
            } else {
                assert.strictEqual(r.requests.length, 1, mode);
                assert.strictEqual(r.view.reason, mode === 'refuse' ? 'REFUSED' : 'NO_EFFECT');
                assert.strictEqual(r.stub.setKmh, 100, mode + ': nothing applied');
            }
            const refused = await bench.send(8812, { kind: 'CM_SET_SPEED', bytes: [1, 0, 95, 255, 15, 0, 2, 0, 1, 0] });
            assert.deepStrictEqual(refused, { ok: false, code: 'NOT_SENT' }, 'the transport sends nothing the module did not build');
        } finally { await s.close(); }
    }
});
