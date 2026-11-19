'use strict';
/**
 * fake-result.js (SU1) - a stand-in for core/sim.js run(config) while the engine does not exist.
 *
 * It is NOT the simulator: a small hand-written kinematic story (approach, a lead that brakes,
 * a truck that cuts in, a curve where the camera loses the target, a downhill, a frozen gap,
 * the next-lane car taken as the target, a driver who brakes on the warning and resumes) that
 * produces a result in the shape of docs/cruise-sim/CONTRACT.md, so the page and the scene can
 * be built and checked. meta.fake = true; the page says so on screen.
 *
 * Browser: self.CS.fakeResult; Node: module.exports.
 */
(function () {
    const KMH = 1 / 3.6;
    const G = 9.81;

    /** mulberry32: own tiny generator (the fake must not depend on core/rng.js). */
    function rand(seed) {
        let s = (seed >>> 0) || 1;
        const next = () => {
            s = (s + 0x6d2b79f5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const normal = (m, sd) => {
            const u = Math.max(1e-12, next()), v = next();
            return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        };
        return { next, normal };
    }

    const PLANT_A_MIN = { liftoff: -0.8, mild: -1.8, firm: -2.8 };
    const ENUMS = { 'cruise.state': ['off', 'active', 'suspended', 'override', 'dropout'] };

    function grade(x) {                       // fraction, + uphill: a 5 % downhill between 900 and 1300 m
        if (x < 850 || x > 1350) return 0;
        if (x < 900) return -0.05 * (x - 850) / 50;
        if (x > 1300) return -0.05 * (1350 - x) / 50;
        return -0.05;
    }

    /** The truck's scripted speed (m/s) once it has cut in: brakes at -3 m/s² to 50 km/h, later speeds up. */
    function leadSpeed(t) {
        if (t < 22) return 80 * KMH;
        if (t < 22 + (30 * KMH) / 3) return 80 * KMH - 3 * (t - 22);
        if (t < 46) return 50 * KMH;
        return Math.min(85 * KMH, 50 * KMH + 1.2 * (t - 46));
    }

    function makeFakeResult(config) {
        config = config || {};
        const duration = Math.min(600, Math.max(5, +config.duration || 60));
        const dt = 0.01;
        const outDt = Math.max(dt, (config.out && +config.out.dt) || 0.05);
        const seed = config.seed == null ? 1 : +config.seed;
        const R = rand(seed);
        const plantCfg = config.plant || {};
        const preset = PLANT_A_MIN[plantCfg.preset] != null ? plantCfg.preset : 'mild';
        const aMin = PLANT_A_MIN[preset], aMax = 1.2, tauC = 1.6, Td = 0.5;
        const ctl = config.controller || {};
        const d0 = ctl.d0 != null ? +ctl.d0 : 5, h = ctl.h != null ? +ctl.h : 2, tau = ctl.tau != null ? +ctl.tau : 4;
        const ttcWarn = (config.warning && config.warning.ttc != null) ? +config.warning.ttc : 3;
        const t0 = Date.now ? Date.now() : 0;

        // vehicles: x = FRONT bumper (m), lane integer, lat m (+ = toward the left lane)
        const veh = [
            { id: 1, kind: 'car', length: 4.6, width: 1.8, x: 150, v: 80 * KMH, a: 0, lane: 0, lat: 0 },
            { id: 2, kind: 'truck', length: 12, width: 2.5, x: 40, v: 90 * KMH, a: 0, lane: 1, lat: 0 },
            { id: 3, kind: 'car', length: 4.4, width: 1.8, x: 175, v: 95 * KMH, a: 0, lane: 1, lat: 0 },
            { id: 4, kind: 'car', length: 4.5, width: 1.8, x: -32, v: 100 * KMH, a: 0, lane: 0, lat: 0 },
        ];
        const ego = { x: 0, v: 100 * KMH, a: 0, jerk: 0, length: 4.7, width: 1.8 };
        const cruise = { state: 1, setHeld: 100 * KMH };
        const driver = { vMax: 120 * KMH, brake: 0, accel: 0 };
        const est = { valid: false, id: NaN, gap: NaN, vrel: 0, vlead: NaN, alead: 0, lastT: -1 };
        let setCmd = 100 * KMH, setQuant = 100, lastValidT = -99;
        const cmdQueue = [];                  // { tApply, vSet, tSent, drop }
        const heldHist = [];                  // dead time buffer of setHeld
        const sensHist = [];                  // { t, id, gap, vrel } truth for latency
        let meas = { valid: 0, id: NaN, gap: NaN, vrel: NaN };
        let frozen = null;
        let warn = 0, lastWarnCond = -9, warnSince = -1, reactAt = -1, brakeUntil = -1, resumeAt = -1;
        let lastTargetId = null, collision = false;

        const N = Math.floor(duration / outDt + 1e-9) + 1;
        const names = ['ego.x', 'ego.v', 'ego.a', 'ego.jerk', 'lead.x', 'lead.v', 'lead.a', 'lead.id', 'gap.true', 'vrel.true',
            'gap.meas', 'vrel.meas', 'meas.valid', 'meas.id', 'est.gap', 'est.vrel', 'est.vlead', 'est.alead', 'est.valid',
            'set.cmd', 'set.held', 'v.driverMax', 'd.des', 'd.needed', 'v.ref', 'timegap', 'ttc', 'warn', 'cruise.state',
            'driver.brake', 'driver.accel', 'grade', 'follower.gap', 'follower.a'];
        veh.forEach((o) => ['x', 'v', 'a', 'lane', 'lat'].forEach((k) => names.push('veh.' + o.id + '.' + k)));
        const series = {};
        names.forEach((n) => { series[n] = new Float64Array(N); });
        const tArr = new Float64Array(N);
        const events = [];
        const ev = (t, kind, detail) => { const e = Object.assign({ t: Math.round(t * 1000) / 1000, kind }, detail || {}); events.push(e); };

        const laneOf = (o) => o.lane + o.lat / 3.5;
        const inEgoLane = (o) => Math.abs(laneOf(o)) < 0.5;
        const trueLead = () => {
            let best = null;
            for (const o of veh) if (inEgoLane(o) && o.x - o.length > ego.x && (!best || o.x < best.x)) best = o;
            return best;
        };
        let vRef = NaN, dDes = NaN, dNeeded = NaN, ttc = Infinity, ctlNext = 0, sensNext = 0;
        let rec = 0, lastA = 0;
        const steps = Math.round(duration / dt);
        let faultFrozen = false, faultCurve = false, faultWrong = false;

        for (let k = 0; k <= steps; k++) {
            const t = k * dt;
            // 1. others
            for (const o of veh) {
                let vt;
                if (o.id === 1) vt = t < 46 ? 80 * KMH : 92 * KMH;
                else if (o.id === 2) {                       // keeps between ego and car 1 until it cuts in at 14 s
                    const L1 = veh[0];
                    vt = t < 14 ? ego.v + ((ego.x + L1.x - L1.length + o.length) / 2 + 2 - o.x) / 2 : leadSpeed(t);
                } else if (o.id === 3) vt = t < 20 ? 95 * KMH : Math.max(ego.v - 8, ego.v + (ego.x + 45 - o.x) / 3);
                else vt = 115 * KMH;
                // simple following of whoever is ahead in the same lane (keeps the fake free of crashes)
                let ahead = null;
                for (const p of veh) if (p !== o && Math.abs(laneOf(p) - laneOf(o)) < 0.6 && p.x > o.x && (!ahead || p.x < ahead.x)) ahead = p;
                if (o.id === 4 && ego.x > o.x && (!ahead || ego.x < ahead.x)) ahead = { x: ego.x, length: ego.length, v: ego.v };
                if (ahead) {
                    const gap = ahead.x - ahead.length - o.x;
                    vt = Math.min(vt, ahead.v + (gap - (4 + 1.4 * o.v)) / 3);
                }
                const a = Math.max(-6, Math.min(1.5, (vt - o.v) / 1.2));
                o.a = a; o.v = Math.max(0, o.v + a * dt); o.x += o.v * dt;
                // the truck cuts in at 14 s over 3 s, between ego and car 1
                if (o.id === 2 && t >= 14 && t < 17) { o.lane = 1; o.lat = -3.5 * (t - 14) / 3; }
                if (o.id === 2 && t >= 17 && o.lane === 1) { o.lane = 0; o.lat = 0; ev(t, 'laneChange', { id: 2, to: 0 }); }
            }
            // 2. faults
            const wasCurve = faultCurve, wasFrozen = faultFrozen, wasWrong = faultWrong;
            faultCurve = t >= 33 && t < 36;
            faultFrozen = t >= 40 && t < 43;
            faultWrong = t >= 49 && t < 51.5;
            if (faultCurve !== wasCurve) ev(t, faultCurve ? 'fault.on' : 'fault.off', { fault: 'curveLoss' });
            if (faultFrozen !== wasFrozen) ev(t, faultFrozen ? 'fault.on' : 'fault.off', { fault: 'gapFrozen' });
            if (faultWrong !== wasWrong) ev(t, faultWrong ? 'fault.on' : 'fault.off', { fault: 'wrongTarget' });

            // 3. sensor (10 Hz, 0.15 s latency, noise growing with distance)
            const L = trueLead();
            const truthId = L ? L.id : NaN;
            sensHist.push({ t, L: L ? { id: L.id, gap: L.x - L.length - ego.x, vrel: L.v - ego.v } : null, w: veh[2] ? { id: 3, gap: veh[2].x - veh[2].length - ego.x, vrel: veh[2].v - ego.v } : null });
            while (sensHist.length && sensHist[0].t < t - 0.5) sensHist.shift();
            let delivered = false;
            if (t >= sensNext - 1e-9) {
                sensNext += 0.1;
                delivered = true;
                let h0 = sensHist[0];
                for (const s of sensHist) if (s.t <= t - 0.15) h0 = s;
                let src = faultWrong ? h0.w : h0.L;
                if (faultCurve) src = null;
                if (src && src.gap > 160) src = null;
                if (faultFrozen && frozen) meas = Object.assign({}, frozen);
                else if (src) {
                    const sd = 0.15 + 0.00012 * src.gap * src.gap;
                    meas = { valid: 1, id: src.id, gap: Math.max(0.5, src.gap + R.normal(0, sd)), vrel: src.vrel + R.normal(0, 0.25) };
                } else meas = { valid: 0, id: NaN, gap: NaN, vrel: NaN };
                if (!faultFrozen) frozen = meas;
                const mid = meas.valid ? meas.id : null;
                if (mid !== lastTargetId) {
                    if (mid == null) ev(t, 'target.lost', { id: lastTargetId });
                    else if (lastTargetId == null) ev(t, 'target.acquired', { id: mid });
                    else ev(t, 'target.changed', { id: mid, from: lastTargetId });
                    lastTargetId = mid;
                }
            }

            // 4. controller, estimator, warning at 10 Hz
            if (t >= ctlNext - 1e-9) {
                ctlNext += 0.1;
                if (delivered && meas.valid) {
                    const reset = !est.valid || est.id !== meas.id;
                    if (reset) { est.gap = meas.gap; est.vrel = meas.vrel; est.id = meas.id; est.alead = 0; }
                    else {
                        const pred = est.gap + est.vrel * 0.1, r = meas.gap - pred;
                        est.gap = pred + 0.5 * r; const nv = est.vrel + (0.2 / 0.1) * r * 0.5;
                        est.alead = 0.8 * est.alead + 0.2 * (nv - est.vrel) / 0.1; est.vrel = nv;
                    }
                    est.valid = true; lastValidT = t;
                } else if (delivered && !meas.valid) {
                    if (t - lastValidT > 0.3) { est.valid = false; est.id = NaN; }
                }
                est.vlead = est.valid ? ego.v + est.vrel : NaN;
                dDes = d0 + h * ego.v;
                let target;
                if (est.valid) { vRef = est.vlead + (est.gap - dDes) / tau; target = Math.min(driver.vMax, Math.max(vRef, 30 * KMH)); }
                else { vRef = NaN; target = t - lastValidT < 3 ? setCmd : driver.vMax; }   // hold 3 s after a loss
                const up = 1 * KMH * 0.1, down = 3 * KMH * 0.1;
                setCmd = Math.max(setCmd - down, Math.min(setCmd + up, target));
                const q = Math.round(setCmd / KMH);
                if (Math.abs(q - setQuant) >= 1 && cruise.state === 1) {
                    setQuant = q;
                    const drop = R.next() < 0.04;
                    ev(t, 'cmd.sent', { vSet: q * KMH });
                    cmdQueue.push({ tApply: t + 0.25 + R.next() * 0.15, vSet: q * KMH, tSent: t, drop });
                }
                // warning
                const closing = est.valid ? -est.vrel : 0;
                dNeeded = est.valid ? d0 + Math.max(0, closing) * Math.max(0, closing) / (2 * Math.abs(aMin)) : NaN;
                ttc = est.valid && closing > 0.05 ? est.gap / closing : Infinity;
                const wNow = est.valid && (est.gap < dNeeded || ttc < ttcWarn) ? 1 : 0;
                if (wNow) warnSince = warn ? warnSince : t;
                if (wNow) lastWarnCond = t;
                const wOut = wNow || (warn && t - lastWarnCond < 1) ? 1 : 0;     // hold 1 s against chatter
                if (wOut !== warn) {
                    warn = wOut;
                    ev(t, warn ? 'warn.on' : 'warn.off', warn ? { reason: est.gap < dNeeded ? 'distance' : 'ttc', dNeeded, ttc } : {});
                    if (warn) reactAt = t + 1.1;
                }
            }
            // 5. command delivery
            while (cmdQueue.length && cmdQueue[0].tApply <= t) {
                const c = cmdQueue.shift();
                if (c.drop) ev(t, 'cmd.dropped', { vSet: c.vSet, tSent: c.tSent });
                else { cruise.setHeld = c.vSet; ev(t, 'cmd.applied', { vSet: c.vSet, tSent: c.tSent }); }
            }
            // 6. driver: reacts to a warning that lasts, brakes, then resumes; raises the maximum at 55 s
            if (reactAt > 0 && t >= reactAt) {
                if (warn) {
                    ev(t, 'driver.react', { delay: Math.round((t - warnSince) * 100) / 100 });
                    ev(t, 'driver.brake', { level: 5 });
                    driver.brake = 5; brakeUntil = t + 1.5;
                    if (cruise.state === 1) { cruise.state = 2; ev(t, 'cruise.state', { state: 'suspended' }); }
                }
                reactAt = -1;
            }
            const Lnow = trueLead();
            if (driver.brake > 0 && t >= brakeUntil && (!warn || !Lnow || ego.v <= Lnow.v + 1)) { driver.brake = 0; resumeAt = t + 2.5; }
            if (resumeAt > 0 && t >= resumeAt) {
                resumeAt = -1; cruise.state = 1; ev(t, 'driver.resume', {}); ev(t, 'cruise.state', { state: 'active' });
                setQuant = Math.max(30, Math.round(ego.v / KMH)); cruise.setHeld = setQuant * KMH; setCmd = cruise.setHeld;
            }
            if (Math.abs(t - 55) < dt / 2) { driver.vMax = 130 * KMH; ev(t, 'driver.vmax', { vMax: driver.vMax }); }
            driver.accel = t >= 57.5 && t < 58.5 ? 0.35 : 0;
            if (Math.abs(t - 57.5) < dt / 2) ev(t, 'driver.override', {});

            // 7. plant: first order with dead time, finite authority against grade
            heldHist.push({ t, v: cruise.setHeld });
            while (heldHist.length > 1 && heldHist[1].t <= t - Td) heldHist.shift();
            const vCmd = heldHist[0].v;
            let a;
            if (driver.brake > 0) a = -driver.brake;
            else if (driver.accel > 0) a = 1.8 * driver.accel;
            else if (cruise.state === 1) a = Math.max(aMin, Math.min(aMax, (vCmd - ego.v) / tauC));
            else a = -0.3;
            a -= G * grade(ego.x) * (a <= aMin + 1e-9 ? 1 : 0.15);       // a downhill pushes past the authority
            ego.jerk = (a - lastA) / dt; lastA = a;
            ego.a = a; ego.v = Math.max(0, ego.v + a * dt); ego.x += ego.v * dt;

            // 8. contact and recording
            const Lt = trueLead();
            const gapT = Lt ? Lt.x - Lt.length - ego.x : NaN;
            if (Lt && gapT <= 0 && !collision) { collision = true; ev(t, 'collision', { id: Lt.id, impact: Lt.v - ego.v }); }
            if (k === Math.round(rec * outDt / dt) && rec < N) {
                const fol = veh[3];
                const put = (n, v) => { series[n][rec] = v == null ? NaN : v; };
                tArr[rec] = Math.round(rec * outDt * 1e6) / 1e6;
                put('ego.x', ego.x); put('ego.v', ego.v); put('ego.a', ego.a); put('ego.jerk', ego.jerk);
                put('lead.x', Lt ? Lt.x : NaN); put('lead.v', Lt ? Lt.v : NaN); put('lead.a', Lt ? Lt.a : NaN);
                put('lead.id', Lt ? Lt.id : NaN); put('gap.true', gapT); put('vrel.true', Lt ? Lt.v - ego.v : NaN);
                put('gap.meas', meas.valid ? meas.gap : NaN); put('vrel.meas', meas.valid ? meas.vrel : NaN);
                put('meas.valid', meas.valid); put('meas.id', meas.valid ? meas.id : NaN);
                put('est.gap', est.valid ? est.gap : NaN); put('est.vrel', est.valid ? est.vrel : NaN);
                put('est.vlead', est.vlead); put('est.alead', est.valid ? est.alead : NaN); put('est.valid', est.valid ? 1 : 0);
                put('set.cmd', setQuant * KMH); put('set.held', cruise.setHeld); put('v.driverMax', driver.vMax);
                put('d.des', dDes); put('d.needed', dNeeded); put('v.ref', vRef);
                put('timegap', Lt && ego.v > 0.5 ? gapT / ego.v : NaN);
                put('ttc', Lt && ego.v - Lt.v > 0.05 ? gapT / (ego.v - Lt.v) : NaN);
                put('warn', warn); put('cruise.state', cruise.state);
                put('driver.brake', driver.brake); put('driver.accel', driver.accel); put('grade', grade(ego.x));
                put('follower.gap', ego.x - ego.length - fol.x); put('follower.a', fol.a);
                for (const o of veh) { put('veh.' + o.id + '.x', o.x); put('veh.' + o.id + '.v', o.v); put('veh.' + o.id + '.a', o.a); put('veh.' + o.id + '.lane', o.lane); put('veh.' + o.id + '.lat', o.lat); }
                rec++;
            }
            void truthId;
        }
        // metrics of the fake (the real ones are SC3's metrics.js)
        const minOf = (arr) => { let m = Infinity; for (const v of arr) if (v === v && v < m) m = v; return m === Infinity ? null : m; };
        const metrics = {
            minGap: minOf(series['gap.true']), minTimeGap: minOf(series.timegap), minTTC: minOf(series.ttc),
            warnings: events.filter((e) => e.kind === 'warn.on').length, collision,
            cmdDropped: events.filter((e) => e.kind === 'cmd.dropped').length,
        };
        const failed = [];
        if (metrics.minTimeGap != null && metrics.minTimeGap < 1) failed.push('minTimeGap');
        if (metrics.minTTC != null && metrics.minTTC < 4) failed.push('minTTC');
        if (collision) failed.push('collision');
        return {
            meta: {
                config, seed, version: 'fake-su1', fake: true, ms: (Date.now ? Date.now() : 0) - t0,
                plant: { name: preset + ' (fake)', assumed: true },
                enums: ENUMS, lanes: 2,
                vehicles: veh.map((o) => ({ id: o.id, kind: o.kind, length: o.length, width: o.width })),
                ego: { length: ego.length, width: ego.width },
                scenario: { id: 'SU1.fake.story', name: 'SU1 fake story (approach, brake, cut-in, curve loss, downhill, frozen gap, wrong target)' },
            },
            t: tArr, series, events, metrics,
            verdict: { pass: failed.length === 0, failed },
        };
    }

    const API = { makeFakeResult, grade, leadSpeed };
    if (typeof module !== 'undefined') {
        module.exports = API;
        // node tools/cruise-sim/ui/fake-result.js [duration] [outDt] > tests/fixtures/su1-fake-result.json
        if (typeof require !== 'undefined' && require.main === module) {
            const r = makeFakeResult({ seed: 1, duration: +process.argv[2] || 60, out: { dt: +process.argv[3] || 0.1 } });
            r.meta.ms = 0;
            process.stdout.write(JSON.stringify(require('./app.js').serializeResult(r, 2)) + '\n');
        }
    } else (self.CS = self.CS || {}).fakeResult = API;
})();
