'use strict';
/**
 * test-twin-sim.js - the bench side of twin_dial (bench/twin-sim.js, the hooks in bench/run-app.js): package E, round 2.
 *
 *   node bench/test-twin-sim.js        (BENCH_PORT, default 8205; the app: the checkout's apps/twin_dial, else the stand-in)
 *
 * Part 1, no bench: twin-sim.js against a fake head unit (the ledger, the "rs" replay to a late subscriber, the raw
 * shapes of every field it owns, enum names and numbers, text never in state(), the sweep).
 * Part 2, a bench from tools/shots/twin/root.py: signal injection through POST /signals and POST /fake, the coverage
 * report (which field of SPEC section 11 the app never watches) shown to FAIL on an app that lacks a watch, the clock
 * pinned by BENCH_NOW, the demo setting pressed whether it is a bool or a choice, a real sweep through the app.
 * Mac only, Node 18 or newer. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT) || 8205;
const BASE = 'http://127.0.0.1:' + PORT;
const sim = require('./twin-sim');
let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- part 1
async function part1() {
    console.log('twin-sim.js against a fake head unit');
    const mk = () => {
        const hu = { subs: {}, got: [] };
        hu.feed = (i, f, v) => (hu.subs[i] || []).forEach((s) => { if (s.h[f]) s.h[f](v); });
        hu.watch = (i, f, fn) => { (hu.subs[i] = hu.subs[i] || []).push({ h: { [f]: fn } }); };
        return hu;
    };
    const IF = sim.IF;
    let hu = mk();
    let s = sim.install(hu, { config: {} }, null);
    // a field fed before anyone watches it reaches the one who subscribes later (the car's getter), once
    const seen = [];
    hu.feed(IF.KI, 'statusBordcomputerAverage', { speedAverage1BC1: 410 });
    await sleep(250);
    ok(seen.length === 0, 'nothing delivered while nobody watches');
    hu.watch(IF.KI, 'statusBordcomputerAverage', (v) => seen.push(v));
    await sleep(300);
    ok(seen.length === 1 && seen[0].speedAverage1BC1 === 410, 'a late subscriber gets the last value at once, once (' + seen.length + ')');
    await sleep(300);
    ok(seen.length === 1, 'and not again');
    const direct = [];
    hu.watch(IF.EI, 'UnitBN2020', (v) => direct.push(v));
    s.control({ units: 'km' });
    ok(direct.length === 1 && direct[0].unitOfMeasurementMileage === 'KILOMETER', 'units km: KILOMETER by name');
    s.control({ units: 'mi' });
    ok(direct[1].unitOfMeasurementMileage === 'MEILEN', 'units mi: MEILEN');
    s.control({ units: null });
    ok(direct[2].unitOfMeasurementMileage === 'SIGNAL_UNGUELTIG', 'units null: SIGNAL_UNGUELTIG (the "none" value)');
    // trip: tenths, the car's "none" values when null
    const trip = [], dur = [], dep = [];
    hu.watch(IF.KI, 'statusBordcomputerAverage', (v) => trip.push(v));
    hu.watch(IF.KI, 'statusBordcomputerTravelData', (v) => dur.push(v));
    hu.watch(IF.KI, 'statusBordcomputerTravelStart', (v) => dep.push(v));
    s.control({ trip: { speed1: 41, cons1: 6.8, speed2: 50, cons2: 7.1, hours: 0, minutes: 43, km: 12.4, depart: { hour: 14, minute: 0, day: 17, month: 11, year: 2026 } } });
    ok(trip[0].speedAverage1BC1 === 410 && trip[0].consumptionAverage1BC1 === 68 && trip[0].speedAverage2BC2 === 500, 'trip averages in tenths (hypothesis, probe P4)');
    ok(dur[0].rideDurationHours === 0 && dur[0].rideDurationMinutes === 43 && dur[0].wayPassed === 124, 'trip duration and distance');
    ok(dep[0].hourDepartureBC === 14 && dep[0].yearDepartureBC === 2026 && dep[0].monthDepartureBC === 11, 'trip departure');
    s.control({ trip: null });
    ok(trip[1].speedAverage1BC1 === 4095 && dur[1].wayPassed === 65535 && dep[1].hourDepartureBC === 255, 'trip null: every member at its catalogue default');
    // media: text goes in, never out
    const med = [];
    hu.watch(IF.HMS, 'playerMetadata', (v) => med.push(v));
    s.control({ media: { first: 'Радіо FM 101.7', second: 'Невидимий виконавець', source: 'FM' } });
    ok(med[0].firstLineText === 'Радіо FM 101.7' && med[0].firstLineType === 'TITLE' && med[0].uiType === 'TWO_LINES', 'media: both lines and their types fed');
    const st = JSON.stringify(s.state(null));
    ok(st.indexOf('Радіо') < 0 && st.indexOf('Невидимий') < 0, 'the probe never carries the media text');
    ok(/"first":14/.test(st.replace(/\s/g, '')) || st.indexOf('14') >= 0, 'only its length');
    s.control({ phone: 'ACTIVE', guiding: 'ACTIVE', displayed: 15 });
    const ph = [], gu = [], dp = [];
    hu.watch(IF.CA, 'aggregatedCallState', (v) => ph.push(v));
    hu.watch(IF.NS, 'guidingState', (v) => gu.push(v));
    hu.watch(IF.V2, 'statusDisplayedCCMessage', (v) => dp.push(v));
    await sleep(300);
    ok(ph[0] === 'ACTIVE' && gu[0] === 'ACTIVE' && dp[0].statusNumberCheckControlMessageDisplay === 15, 'phone, guidance and the second witness replayed to late subscribers');
    // range struct: reserve and odometer
    const rs = s.rangeStruct({ fluidLevelFuelTank: 38, range: 412 }, { reserve: 1, odometer: 48215 });
    ok(rs.statusFluidLevelFuelTankSpare === 'AKTIV' && rs.mileageKilometre === 48215 && rs.range === 412, 'range struct: reserve AKTIV, odometer 48215');
    const rn = s.rangeStruct({ fluidLevelFuelTank: 38, range: 412 }, { reserve: null, odometer: null });
    ok(rn.statusFluidLevelFuelTankSpare === 'SIGNAL_UNGUELTIG' && rn.mileageKilometre === 16777215, 'range struct: none values');
    ok(s.rangeStruct({}, {}).mileageKilometre === 16777215, 'no odometer asked: not valid');
    // numbers instead of names
    const hu2 = mk();
    const s2 = sim.install(hu2, { config: {} }, null, { enum: 'number' });
    ok(s2.rangeStruct({}, { reserve: 1 }).statusFluidLevelFuelTankSpare === 1, 'BENCH_ENUM=number: the wire number');
    // the sweep
    const v0 = s.sweepValues(0), vm = s.sweepValues(sim.SWEEP_MS / 2), ve = s.sweepValues(sim.SWEEP_MS), vx = s.sweepValues(sim.SWEEP_MS + 1);
    ok(v0.rpm === 0 && v0.speed === 0 && vm.rpm === 8000 && vm.speed === 300 && ve.rpm === 0 && vx === null, 'sweep: 0 -> end of both scales -> 0 over ' + sim.SWEEP_MS + ' ms, then null');
    let mono = true, last = -1;
    for (let t = 0; t <= sim.SWEEP_MS / 2; t += 50) { const r = s.sweepValues(t).rpm; if (r < last) mono = false; last = r; }
    ok(mono, 'sweep rises monotonically to the middle');
    s.stop(); s2.stop();
}

// ---------------------------------------------------------------- part 2
let server = null;
async function req(method, url, body) {
    for (let i = 0; i < 8; i++) {
        try {
            const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', connection: 'close' }, body: body ? JSON.stringify(body) : undefined });
            if (r.status === 200) return r.json();
            if (r.status === 204) return null;
            throw new Error(method + ' ' + url + ': ' + r.status);
        } catch (e) { if (i === 7) throw e; await sleep(400); }
    }
    return null;
}
const probe = () => req('GET', '/probe');
async function until(fn, ms) {
    const end = Date.now() + (ms || 10000);
    let p = null;
    while (Date.now() < end) { try { p = await probe(); if (fn(p)) return p; } catch (e) { /* starting */ } await sleep(150); }
    return p;
}
function startBench(tag, extraEnv, standinDir) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-sim-' + tag + '-'));
    const env = Object.assign({}, process.env, standinDir ? { TWIN_STANDIN_DIR: standinDir } : {});
    const root = execFileSync('python3', [path.join(ROOT, 'tools', 'shots', 'twin', 'root.py'), dir], { env, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const data = path.join(dir, 'data');
    fs.mkdirSync(data);
    let log = '';
    const p = spawn('node', [path.join(root, 'bench', 'server.js'), 'twin_dial'], { cwd: root,
        env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: data, BENCH_NOW: '2026-11-17T12:43:00Z' }, extraEnv || {}), stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
    return { p, dir, log: () => log };
}
async function stopBench(b) {
    b.p.kill('SIGTERM');
    await new Promise((r) => { b.p.on('exit', r); setTimeout(r, 3000); });
    await sleep(500);
}

async function part2() {
    console.log('a bench');
    server = startBench('a');
    let p = await until((q) => q && q.ready && q.twin, 90000);
    ok(p && p.ready, 'the app is up (' + (p && p.status) + ')');
    const T = p.twin;
    ok(Array.isArray(T.missing) && T.missing.length === 0, 'every needed field of SPEC section 11 is watched by the app (missing: ' + JSON.stringify(T.missing) + ')');
    ok(T.wired.ccList && T.wired.ccActive && T.wired.clock && T.wired.dayNight, 'app.json config names ccList, ccActive, clock and dayNight (' + JSON.stringify(T.wired) + ')');
    ok(/^2026-11-17T12:4[3-4]/.test(T.now), 'BENCH_NOW: the app clock starts at 12:43 UTC (' + T.now + ')');
    // manual signals reach the fields, with the new members
    await req('POST', '/signals', { mode: 'manual', values: { rpm: 2400, speed: 87, gear: 3, fuelL: 38, range: 412, reserve: 1, odometer: 48215, coolant: 92, ambient: 7.5, condition: 10, engine: 2 } });
    p = await until((q) => q.twin && q.twin.last['KombiIF.statusRangeTankStatus'] && q.twin.last['KombiIF.statusRangeTankStatus'].mileageKilometre === 48215, 8000);
    const R = p.twin.last['KombiIF.statusRangeTankStatus'] || {};
    ok(R.mileageKilometre === 48215 && R.statusFluidLevelFuelTankSpare === 'AKTIV' && R.fluidLevelFuelTank === 38 && R.range === 412, 'POST /signals: fuel 38 L, range 412, reserve AKTIV, odometer 48215 in one struct');
    ok(p.settings.demo === 'off', 'manual signals switch the demo setting off (a bool or a choice)');
    await req('POST', '/fake', { twin: { units: 'km', media: { first: 'Радіо FM 101.7', source: 'FM' }, phone: 'INCOMING', guiding: 'ACTIVE', displayed: 15 } });
    p = await until((q) => q.twin && q.twin.last['HmiMediaState.playerMetadata'], 5000);
    const L = p.twin.last;
    ok(L['EnvironmentalInformation.UnitBN2020'].unitOfMeasurementMileage === 'KILOMETER' && L['ConnectivityAggregator.aggregatedCallState'] === 'INCOMING' && L['NavigationStatus.guidingState'] === 'ACTIVE', 'POST /fake {twin}: units, phone, guidance reach the fields');
    ok(L['Vehicle2.statusDisplayedCCMessage'].statusNumberCheckControlMessageDisplay === 15, 'the second witness carries 15');
    ok(JSON.stringify(p).indexOf('Радіо') < 0, 'GET /probe never carries the media text');
    // the message fields through bench/fake-signs.js (the engine's own config)
    await req('POST', '/fake', { ccList: [{ id: 15, name: 'Test door', color: 'white', symbol: 2 }], ccActive: { number: 15 } });
    p = await until((q) => q.twin && q.twin.last['KombiInterface_2.ccList'] && q.twin.last['KombiIF.statusActiveCCMessage'], 5000);
    ok(p.twin.last['KombiIF.statusActiveCCMessage'] && p.twin.last['KombiIF.statusActiveCCMessage'].numberDisplayControlCheckControlMessage === 15, 'ccActive reaches KombiIF.statusActiveCCMessage');
    ok(JSON.stringify(p.twin.last['KombiInterface_2.ccList']).indexOf('Test door') < 0, 'a ccList name is a length in the probe');
    if (p.twin.cc) ok(['none', 'window', 'ours'].indexOf(p.twin.cc.state) >= 0, 'the engine says its message state: ' + JSON.stringify(p.twin.cc));
    else console.log('  note the engine does not expose hud.cc yet (the tools skip the message-state check)');
    // a real sweep through the app: rpm raw (x4) peaks near 8000 rpm and comes back to 2400
    await req('POST', '/fake', { twin: { sweep: true } });
    let peak = 0, vpeak = 0;
    const end = Date.now() + 5200;
    while (Date.now() < end) {
        const q = await probe();
        const rr = q.twin.last['CDS.statusEngineSpeed2'], sv = q.twin.last['Vehicle2.statusCarSpeed2'];
        if (rr) peak = Math.max(peak, rr.actualValueRPMEngineCrankshaft);
        if (sv) vpeak = Math.max(vpeak, sv.speedVehicleCentreOfGravity);
        await sleep(100);
    }
    ok(peak >= 7000 * 4, 'the sweep drove rpm up to ' + peak / 4 + ' rpm');
    ok(vpeak * 0.015625 >= 270, 'and speed up to ' + Math.round(vpeak * 0.015625) + ' km/h');
    p = await probe();
    ok(p.twin.last['CDS.statusEngineSpeed2'].actualValueRPMEngineCrankshaft === 2400 * 4, 'afterwards the manual values are back (2400 rpm)');
    ok(!/uncaught|app exited/.test(server.log()), 'no uncaught error in the bench log');
    await stopBench(server);

    // a negative: an app that never watches speed must be reported
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-standin-'));
    const src = path.join(ROOT, 'tools', 'shots', 'twin', 'standin', 'twin_dial');
    fs.readdirSync(src).forEach((f) => fs.copyFileSync(path.join(src, f), path.join(tmp, f)));
    fs.writeFileSync(path.join(tmp, 'hud.js'), fs.readFileSync(path.join(tmp, 'hud.js'), 'utf8').replace('statusCarSpeed2: speedRaw, ', ''));
    const realApp = fs.existsSync(path.join(ROOT, 'apps', 'twin_dial', 'app.json'));
    if (realApp) console.log('  note the checkout has apps/twin_dial: the negative runs on a patched copy of the stand-in, as the real app is not ours to edit');
    server = startBench('b', {}, tmp);
    p = await until((q) => q && q.ready && q.twin, 90000);
    ok(p && p.twin.missing.indexOf('Vehicle2.statusCarSpeed2') >= 0, 'an app that does not watch the speed is reported: missing ' + JSON.stringify(p && p.twin.missing));
    await stopBench(server);
}

(async () => {
    try { await part1(); await part2(); } catch (e) { failed++; console.log('  FAIL threw: ' + (e && e.stack || e)); }
    if (server) { try { server.p.kill('SIGTERM'); } catch (e) { /* gone */ } }
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
