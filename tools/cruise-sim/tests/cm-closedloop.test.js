'use strict';
// Package CM (rung 1): the gated command module in the cruise simulator's closed loop, on scenarios of SC3's library.
// ARMED: the scenarios the module is declared to handle: it stays armed, no collision, the true time gap never below the
//        simulator's floor (minTimeGap_s >= 1.0 s).
// DISARMED: the scenarios the gates cannot handle: the module disarms itself (ENVELOPE_*), before it could be armed
//        with a seen vehicle under the floor for more than 1 s, and never with a seen collision while armed.
// DRIVER: the driver's actions disarm it for the drive (G6). FAILURES: family J.
// Every run: zero violations of the frozen shape, no request above the ceiling, steps <= 5 km/h, >= 3 s apart.
// Mild assumed plant; the driver sets the cruise 5 km/h above the speed at the start (CM-REPORT §2) unless stated.
const { test, assert } = require('./harness');
const G = require('../../cruise-cmd/sim_gated.js');
const sc = require('../core/scenario');

function run(id, opts, cfgX) {
    const c = sc.load(id);
    const cfg = sc.toConfig(c, Object.assign({ seed: 1, plant: { preset: 'mild' } }, cfgX || {}));
    return G.run(cfg, Object.assign({ driverSetAbove_kmh: 5 }, opts || {}));
}
function invariants(r, id) {
    const s = r.cm;
    assert.strictEqual(s.violations, 0, id + ': violations');
    assert.ok(s.overCeiling === null || s.overCeiling <= 0, id + ': a request above the ceiling');
    assert.ok(s.maxStep <= 5, id + ': step ' + s.maxStep);
    assert.ok(!(s.minInterval < 3 - 1e-6), id + ': interval ' + s.minInterval);
    assert.ok(s.armedLowSeen_s <= 1.0, id + ': armed with a seen vehicle under the floor for ' + s.armedLowSeen_s.toFixed(2) + ' s');
    assert.strictEqual(s.collisionSeenArmed, false, id + ': a collision while armed with the vehicle seen');
    // no request while disarmed: every request is preceded by an armed view
    const ch = r.cmCtx.changes;
    r.cmCtx.requests.forEach((q) => {
        let a = null;
        for (let i = 0; i < ch.length && ch[i].t <= q.t + 1e-9; i++) if (ch[i].gen === q.gen) a = ch[i];
        assert.ok(a && (a.mode === 'HOLDING' || a.mode === 'ADJUSTING'), id + ': a request at ' + q.t + ' while ' + (a && a.mode));
    });
}

const ARMED = [
    ['B.approach#v=60,dv=10', 'approach, 10 km/h slower', true],
    ['B.approach.truck#v=120,dv=20', 'approach a truck, 20 km/h slower (seen early)', true],
    ['C.drift#v=90,s=-1', 'the lead drifts slowly down', true],
    ['C.square#v=90,dv=5,P=20', 'the lead steps ±5 km/h', true],
    ['C.accel.away#v=90,a=1', 'the lead pulls away: back up toward the ceiling', true],
    ['C.steady.grade#v=90,g=-0.06', 'following downhill 6 %', true],
    ['C.steady.curve#v=80,R=250', 'following on a winding road', true],
    ['D.tap#v=90,d=0.5', 'a brake tap ahead', true],
    ['F.reveal.slower#v=120,dv=20,gh=20', 'a cut-out reveals a car 20 km/h slower', true],
    ['F.reveal.faster#v=90,dv=-10', 'a cut-out reveals a faster car', true],
    ['F.reveal.none#v=90', 'a cut-out reveals an open road (the set speed stays)', true],
    ['E.cutin.equal#v=90,g=60/none', 'a car at our speed cuts in 60 m ahead', true],
    ['G.outliers#v=90,r=0.1', 'outliers in the gap', true],
    ['H.highspeed#v=150', 'following at 150 km/h', true],
    ['A.free.steady#v=120,sensing=clear', 'no vehicle ahead: nothing sent', false],
];

test('ARMED: ' + ARMED.length + ' library scenarios: armed throughout, no collision, true time gap >= 1.0 s, requests within the gates', () => {
    ARMED.forEach((a) => {
        const r = run(a[0]);
        invariants(r, a[0]);
        assert.strictEqual(r.cm.armedOk, true, a[0] + ' arms');
        assert.strictEqual(r.cm.firstDisarm, null, a[0] + ' disarmed: ' + JSON.stringify(r.cm.firstDisarm));
        assert.strictEqual(r.metrics.collision, false, a[0] + ' collision');
        assert.ok(r.metrics.minTimeGap_s === null || r.metrics.minTimeGap_s >= 1.0, a[0] + ' min time gap ' + r.metrics.minTimeGap_s);
        if (a[2]) assert.ok(r.cm.requests >= 1, a[0] + ' sent nothing');
        else assert.strictEqual(r.cm.requests, 0, a[0]);
    });
});

test('ARMED: the pull-away raises only back toward the ceiling, and never over it', () => {
    const r = run('C.accel.away#v=90,a=1');
    const q = r.cmCtx.requests;
    const ups = q.filter((x) => x.kmh > x.from);
    assert.ok(ups.length >= 1, 'it raised');
    ups.forEach((x) => assert.ok(x.kmh <= x.ceil, 'raise to ' + x.kmh + ' over the ceiling ' + x.ceil));
    const setMax = Math.max.apply(null, Array.prototype.slice.call(r.series['set.held'])) * 3.6;
    assert.ok(setMax <= q[0].ceil + 0.5, 'the cruise never held more than the driver\'s set speed: ' + setMax.toFixed(1));
});

const DISARMED = [
    ['E.cutin.slower#v=90,g=15,dv=10/none', null, ['ENVELOPE_GAP'], 'a slower car cuts in 15 m ahead'],
    ['E.cutin.equal#v=90,g=10/none', null, ['ENVELOPE_GAP'], 'a car at our speed cuts in 10 m ahead'],
    ['D.brake#v=120,dv=40,a=-1', null, ['ENVELOPE_LEAD_BRAKING', 'ENVELOPE_CLOSING'], 'the lead brakes at 1 m/s² by 40 km/h'],
    ['D.brake.hard#v=90,dv=40,a=-3/none', null, ['ENVELOPE_LEAD_BRAKING', 'ENVELOPE_CLOSING'], 'the lead brakes hard'],
    ['B.approach#v=120,dv=40', null, ['ENVELOPE_CLOSING'], 'approach, 40 km/h slower'],
    ['B.approach.large#v=120,dv=70/none', null, ['ENVELOPE_CLOSING'], 'approach, 70 km/h slower'],
    ['B.queue#v=90,sensing=clear/none', null, ['ENVELOPE_FLOOR', 'ENVELOPE_GAP'], 'the tail of a standing queue'],
    ['F.reveal.standing#v=90,gh=30/none', null, ['ENVELOPE_FLOOR'], 'a cut-out reveals a standing car'],
    ['C.steady#v=90,h0=2', { driverSetAbove_kmh: null }, ['ENVELOPE_CLOSING'], 'set 20 km/h above a lead 2 s ahead (SC3\'s driver)'],
];

test('DISARMED: ' + DISARMED.length + ' library scenarios the gates cannot handle: the module disarms itself with an ENVELOPE reason, in time', () => {
    DISARMED.forEach((d) => {
        const r = run(d[0], d[1]);
        invariants(r, d[0]);
        const why = r.cm.firstDisarm ? r.cm.firstDisarm.reason : r.cm.armReason;
        assert.ok(d[2].indexOf(why) >= 0, d[0] + ': ' + why + ' (expected ' + d[2].join(' or ') + ')');
        // the first sample its estimate showed the vehicle under the floor: it was disarmed within 1 s of it
        const T = r.t, tg = r.series.timegap, ev = r.series['est.valid'];
        let tSeen = null;
        for (let i = 0; i < T.length; i++) if (ev[i] === 1 && tg[i] < 1.0) { tSeen = T[i]; break; }
        if (tSeen !== null && r.cm.firstDisarm) assert.ok(r.cm.firstDisarm.t <= tSeen + 1.0, d[0] + ': disarmed at ' + r.cm.firstDisarm.t + ', seen under the floor at ' + tSeen);
    });
});

test('DISARMED: after an envelope disarm nothing more is sent, and the cruise holds a set speed at or below the driver\'s', () => {
    const r = run('D.brake#v=120,dv=40,a=-1');
    const td = r.cm.firstDisarm.t;
    assert.strictEqual(r.cmCtx.requests.filter((q) => q.t > td).length, 0);
    const ceil = r.cmCtx.requests[0].ceil;
    for (let i = 0; i < r.t.length; i++) assert.ok(r.series['set.held'][i] * 3.6 <= ceil + 0.5);
});

test('DRIVER (G6): raising the set speed, braking, the accelerator, cancelling: disarmed and locked for the drive, nothing sent after', () => {
    [['A.setstep.up#v=90,step=10', 'DRIVER_SET_CHANGE'], ['I.brake.resume#v=90,r=5', 'CRUISE_NOT_ACTIVE'],
        ['I.override#v=90,p=0.6,d=4', 'OVERRIDE_INFERRED'], ['I.cancel#v=90', 'CRUISE_NOT_ACTIVE']].forEach((p) => {
        const r = run(p[0]);
        invariants(r, p[0]);
        assert.strictEqual(r.cm.firstDisarm.reason, p[1], p[0]);
        const last = r.cmCtx.changes[r.cmCtx.changes.length - 1];
        assert.strictEqual(last.locked, true, p[0] + ' locked');
        assert.strictEqual(r.cmCtx.requests.filter((q) => q.t > r.cm.firstDisarm.t).length, 0, p[0]);
    });
});

test('FAILURES (family J): the app stops / the head unit restarts: nothing more is sent, the new app stays disarmed; a stuck set speed, a frozen gap, a blind camera, a cruise dropout: disarmed', () => {
    const stop = run('J.appStop.D1#tf=14,v=90/none');
    invariants(stop, 'appStop');
    assert.strictEqual(stop.cmCtx.requests.filter((q) => q.t >= 14).length, 0, 'appStop: nothing after');
    const ceil = stop.cmCtx.requests[0].ceil;
    for (let i = 0; i < stop.t.length; i++) assert.ok(stop.series['set.held'][i] * 3.6 <= ceil + 0.5, 'appStop: the cruise holds at most the ceiling');
    const hu = run('J.huRestart.D1#tf=14,v=90/none');
    invariants(hu, 'huRestart');
    assert.strictEqual(hu.cmCtx.requests.filter((q) => q.gen > 0).length, 0, 'huRestart: the new app never armed');
    // a short restart on a quiet road: the app comes back, disarmed (disarmed at every start), and sends nothing
    const back = run('C.drift#v=90,s=-1', null, { failures: [JSON.parse('{"kind":"huRestart","at":10,"duration":5}')] });
    invariants(back, 'huRestart 5 s');
    assert.strictEqual(back.cmCtx.gen, 2, 'the app came back once');
    assert.ok(back.cmCtx.requests.some((q) => q.gen === 0) && !back.cmCtx.requests.some((q) => q.gen === 1), 'only the first app sent');
    const lastView = back.cmCtx.changes.filter((c) => c.gen === 1);
    assert.ok(lastView.length && lastView.every((c) => !c.armed && c.reason === 'START'), JSON.stringify(lastView));
    [['J.setStuck.D1#tf=14,v=90/none', ['NO_EFFECT']], ['J.gapFreeze.D1#tf=14,v=90/none', ['STALE_INPUT']],
        ['J.sensorBlind.D1#tf=14,v=90/none', ['SENSOR_FAULT']], ['J.cruiseDropout.D1#tf=14,v=90/none', ['CRUISE_NOT_ACTIVE']],
        ['J.commandLost.D1#tf=14,v=90/none', ['NO_EFFECT', 'ENVELOPE_LEAD_BRAKING', 'ENVELOPE_CLOSING']]].forEach((p) => {
        const r = run(p[0]);
        invariants(r, p[0]);
        assert.ok(r.cm.firstDisarm && p[1].indexOf(r.cm.firstDisarm.reason) >= 0, p[0] + ': ' + JSON.stringify(r.cm.firstDisarm));
        assert.ok(r.cm.firstDisarm.t >= 14 - 1e-6 && r.cm.firstDisarm.t <= 14 + 12, p[0] + ' at ' + r.cm.firstDisarm.t);
    });
});

test('the three assumed plants (lift-off, mild, firm): the armed list stays armed and safe, every run keeps the invariants', () => {
    ['liftoff', 'firm'].forEach((preset) => {
        ARMED.forEach((a) => {
            const r = run(a[0], null, { plant: { preset: preset } });
            invariants(r, preset + ' ' + a[0]);
            assert.strictEqual(r.metrics.collision, false, preset + ' ' + a[0]);
            assert.ok(r.metrics.minTimeGap_s === null || r.metrics.minTimeGap_s >= 1.0, preset + ' ' + a[0] + ' ' + r.metrics.minTimeGap_s);
        });
    });
});

test('plain cruise is the comparison: with the module never armed nothing is sent; the module is never worse than it on the armed list', () => {
    ARMED.forEach((a) => {
        const c = sc.load(a[0]);
        const cfg = sc.toConfig(c, { seed: 1, plant: { preset: 'mild' } });
        const p = G.run(cfg, { driverSetAbove_kmh: 5, plain: true });
        assert.strictEqual(p.cm.requests, 0);
        const g = run(a[0]);
        if (p.metrics.collision) assert.strictEqual(g.metrics.collision, false, a[0]);
        if (p.metrics.minTimeGap_s !== null && g.metrics.minTimeGap_s !== null) assert.ok(g.metrics.minTimeGap_s >= Math.min(1.0, p.metrics.minTimeGap_s) - 1e-9, a[0]);
    });
});
