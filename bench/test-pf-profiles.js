'use strict';
/**
 * test-pf-profiles.js - round 1121 PF (docs/fixes-1121/PF-REPORT.md): the owner's three reports about the per-profile settings,
 * each hypothesis scripted against a fake car, in-process (the kit's real Settings class, shared/profile_settings.js and
 * shared/units.js; no bench server, no port).
 *
 *   node bench/test-pf-profiles.js                       the modules in shared/
 *   PS_MODULE_DIR=<dir> node bench/test-pf-profiles.js   another copy of the two modules (the report's "before" counts)
 *   PF_STARTS=100                                        how many random starts part R scripts (default 100)
 *
 *  U  units: the car's own record (2026-11-18: the struct MEILEN, the odometer KILOMETER, the trip computer KM_S_H__KM) is km;
 *     miles need two sources; numbers, partly filled structs, a km source vetoes
 *  H1 the stored sets: an id read differently once, not readable, timing out; a new id read twice; an unreadable file; a change
 *     while the profile is not known / the switch is pending / the car still reports the last driver; own changes saved with
 *     one previous version kept
 *  H2 the start: the first decision is not debounced and the first build can wait for it; the previous profile reported
 *     first, the right one later, with and without the event; the field failing at start; an odd event during a pending switch
 *  H4 two apps on one car: each follows the profile on its own; one app's read failing leaves its look
 *  M  the migration: settings from before per-profile settings are kept and every profile seen first starts from them
 *  R  a hundred scripted starts with random timing: no profile's stored file ever takes another driver's choice
 *
 * Mac only, Node 8 syntax not required (bench). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MOD = process.env.PS_MODULE_DIR || path.join(ROOT, 'shared');
const PS = require(path.join(MOD, 'profile_settings.js'));
const U = require(path.join(MOD, 'units.js'));
const STARTS = Number(process.env.PF_STARTS) || 100;
const UAM = 'de.bmw.infotainment.personalization.UserAccountManager';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const fails = [];
function ok(c, m) { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; fails.push(m); console.log('  FAIL ' + m); } }
const section = (s) => console.log(s);
const hash = (id) => crypto.createHash('sha1').update(id).digest('hex').slice(0, 12);

function makeSettings(dir, schema, logf) {
    const src = fs.readFileSync(path.join(ROOT, 'kit', 'runtime', 'mgu.js'), 'utf8').replace(/\r\n/g, '\n');
    const m = src.match(/class Settings[\s\S]*?\n}\n/);
    const S = new Function('fs', 'path', 'DATA_DIR', 'log', m[0] + '\nreturn Settings;')(fs, path, dir, logf);
    return new S(schema);
}
const PALETTE = { i01: ['a1', 'a2', 'a3'], i02: ['b1', 'b2', 'b3'], guest: ['g1', 'g2', 'g3'] };
const LOOKS = ['a', 'b', 'c', 'x', 'y', 'off', 'twin', 'wb'].concat(PALETTE.i01, PALETTE.i02, PALETTE.guest);
const SCHEMA = [
    { key: 'hudLayout', type: 'choice', default: 'a', options: LOOKS.map((v) => [v, v]) },
    { key: 'lang', type: 'choice', default: 'auto', options: [['auto', 'Auto'], ['uk', 'uk'], ['en', 'en']] },
    { key: 'units', type: 'choice', default: 'auto', options: [['auto', 'a'], ['km', 'k'], ['mi', 'm']] },
    { key: 'diagX', type: 'bool', default: false },
    { key: 'profileSets', type: 'bool', default: true },
];
const FAST = { app: 'test', perProfile: ['hudLayout', 'lang', 'units'], global: ['diagX', 'profileSets'], pollMs: 2000, fastMs: 60, fastWindowMs: 5000,
    quietMs: 60, gapMs: 120, kickMs: 0, reuseConfirmMs: 80, settleMs: 0, firstMs: 300, getMs: 150, proxyMs: 200 };

/**
 * A scripted car. slot: who the car says is active; lag: the car reports `lagSlot` until lagUntil (a wake-up that still
 * reports the last driver); smFailUntil / smFail: currentUserAccountReference does not answer; smDelay: answers late;
 * idMode: 'ok' | 'fail' | 'timeout' | 'random' (a different value each read) | 'new' (a consistent new value: a new profile).
 */
function fakeCar(o) {
    const car = Object.assign({ slot: 'guest', lagSlot: null, lagUntil: 0, smFail: false, smFailUntil: 0, smDelay: 0, idMode: 'ok',
        ids: { guest: 'guest', valet: 'valet', i01: 'persod-aaaa-1111', i02: 'persod-bbbb-2222', i03: 'persod-cccc-3333' }, listeners: [], calls: [], silent: false }, o || {});
    car.reported = () => (Date.now() < car.lagUntil ? car.lagSlot : car.slot);
    let rnd = 0;
    car.signals = {
        proxy: (iface, inst) => { car.calls.push('proxy ' + iface.split('.').pop()); return Promise.resolve({ iface, inst }); },
        get: (p, f) => {
            car.calls.push('get ' + p.iface.split('.').pop() + '.' + f);
            if (p.iface.endsWith('SessionManager') && f === 'currentUserAccountReference') {
                if (car.smFail || Date.now() < car.smFailUntil) return sleep(10).then(() => { throw new Error('no answer'); });
                return sleep(car.smDelay).then(() => UAM + '.' + car.reported());
            }
            if (p.iface.endsWith('UserAccount') && f === 'id') {
                const slot = String(p.inst).split('.').pop();
                if (car.idMode === 'fail') return sleep(5).then(() => { throw new Error('not granted'); });
                if (car.idMode === 'timeout') return new Promise(() => {});
                if (car.idMode === 'random') return sleep(5).then(() => 'persod-rnd-' + (++rnd) + '-' + Math.random().toString(16).slice(2, 8));
                if (car.idMode === 'new') return sleep(5).then(() => 'persod-new-' + slot);
                return sleep(5).then(() => car.ids[slot]);
            }
            return Promise.reject(new Error('not granted'));
        },
        on: (p, name, fn) => { car.calls.push('on ' + name); if (name === 'currentUserOnChange') car.listeners.push(fn); return Promise.resolve(); },
        set: () => { car.calls.push('SET'); return Promise.reject(new Error('no')); },
        call: () => { car.calls.push('CALL'); return Promise.reject(new Error('no')); },
    };
    car.event = (v) => car.listeners.forEach((fn) => fn(v === undefined ? UAM + '.' + car.slot : v));
    car.to = (slot, opt) => { const x = opt || {}; car.slot = slot; if (!x.silent) car.event(); };
    return car;
}
/** A data dir: settings.json (an object, or null for none) and profiles/<slot>.json ({ slot: { id, values } }). */
function dataDir(settings, profiles) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
    if (settings) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 1));
    if (profiles) {
        fs.mkdirSync(path.join(dir, 'profiles'));
        Object.keys(profiles).forEach((s) => fs.writeFileSync(path.join(dir, 'profiles', s + '.json'), typeof profiles[s] === 'string' ? profiles[s]
            : JSON.stringify({ v: 1, slot: s, id: profiles[s].id === undefined ? null : profiles[s].id, values: profiles[s].values }, null, 1)));
    }
    return dir;
}
const fileOf = (dir, s) => path.join(dir, 'profiles', s + '.json');
const fileVals = (dir, s) => { try { return JSON.parse(fs.readFileSync(fileOf(dir, s), 'utf8')).values; } catch (e) { return null; } };
/** Start an app on a data dir (a restart: the kit's Settings reads settings.json again). */
function start(dir, car, opts) {
    const lines = [];
    const log = { info: (s) => lines.push('I ' + s), warn: (s) => lines.push('W ' + s), error: (s) => lines.push('E ' + s) };
    const settings = makeSettings(dir, SCHEMA, log);
    const batches = [];
    settings.onBatch((keys) => batches.push({ keys: keys.slice(), at: Date.now() }));
    const ctx = { settings, signals: car.signals, log, dataDir: dir, spec: { id: 'test', config: {} } };
    const t0 = Date.now();
    let ps = null;
    try { ps = new PS.ProfileSettings(ctx, Object.assign({}, FAST, opts || {})).start(); } catch (e) { lines.push('E start: ' + e.message); }
    return { dir, car, settings, ps, batches, lines, t0, log: () => lines.join('\n'), stop: () => { try { if (ps) ps.stop(); } catch (e) { /* old */ } } };
}
async function until(fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { if (fn()) return true; } catch (e) { /* not yet */ } await sleep(10); } try { return !!fn(); } catch (e) { return false; } }
async function test(name, fn) {
    try { await fn(); } catch (e) { ok(false, name + ': threw ' + (e && e.stack || e)); }
}

/* -------------------------------------------------------------- U: the units --------------------------------------------- */
function partU() {
    section('U. the units rule (Symptom 1)');
    const alt = (m, b) => { const a = {}; if (m !== undefined && U.altOf) a.mileage = U.altOf('mileage', m); if (b !== undefined && U.altOf) a.bc = U.altOf('bc', b); return a; };
    const r = (p, car, a) => U.resolve(p, U.carOf(car), a);
    // the owner's car, apps/signal_probe 2026-11-18 18:29 (reference/car/2026-11-18-collect1): one moment, one profile
    const rec = { unitOfMeasurementTemperature: 'C', unitOfMeasurementSpeedometerDigital: 'MEILEN', unitOfMeasurementConsumption: 'L_S_100KM', unitOfMeasurementFuel: 'GALONEN__US', unitOfMeasurementAirPressure: 'BAR' };
    const x = r('auto', rec, alt('KILOMETER', 'KM_S_H__KM'));
    ok(!x.mi && x.cons === 'l100' && x.temp === 'C', 'the car\'s own record (struct MEILEN, odometer KILOMETER, trip computer KM_S_H__KM) under Авто: km, l/100 km, °C (' + JSON.stringify(x.why || x.src) + ')');
    const f30 = r('auto', rec);
    ok(!f30.mi, 'the struct\'s MEILEN alone (f30_cluster reads no second source): km, "not confirmed" (' + JSON.stringify(f30.why || f30.src) + ')');
    ok(r('auto', { unitOfMeasurementSpeedometerDigital: 'MEILEN' }, alt('MEILEN')).mi && r('auto', { unitOfMeasurementSpeedometerDigital: 2 }, alt(2)).mi &&
        r('auto', { unitOfMeasurementSpeedometerDigital: 0 }, alt(2, 2)).mi, 'miles when two sources say miles: MEILEN + odometer MEILEN, by name or number; odometer + trip computer with the struct DEFAULT');
    ok(!r('auto', { unitOfMeasurementSpeedometerDigital: 'MEILEN' }, alt('MEILEN', 'KM_S_H__KM')).mi, 'a source that says km vetoes miles (MEILEN, odometer MEILEN, trip computer KM_S_H__KM: km)');
    ok(!r('auto', { unitOfMeasurementTemperature: 'C' }).mi && !r('auto', { unitOfMeasurementSpeedometerDigital: 1 }).mi && !r('auto', { unitOfMeasurementSpeedometerDigital: 3 }, alt(3, 3)).mi && !r('auto', null).mi,
        'a struct without the speed member, KILOMETER as 1, SIGNAL_UNGUELTIG everywhere, no struct: km');
    ok(r('mi', rec, alt('KILOMETER')).mi && !r('km', { unitOfMeasurementSpeedometerDigital: 'MEILEN' }, alt('MEILEN', 'MPH__MLS')).mi, 'the driver\'s explicit choice wins either way (милі / км)');
    const d = U.describe ? U.describe('auto', U.carOf(rec), alt('KILOMETER', 'KM_S_H__KM')) : '';
    ok(/MEILEN/.test(d) && /odometer KILOMETER/.test(d) && /trip computer KM_S_H__KM/.test(d) && /-> km/.test(d) && /unconfirmed/.test(d), 'the log line names every raw value and the verdict: "' + d + '"');
}

/* -------------------------------------------------------------- H1: the stored sets -------------------------------------- */
async function partH1() {
    section('H1. the stored sets (Symptom 2, hypothesis 1: data loss)');
    const two = () => ({ i01: { id: hash('persod-aaaa-1111'), values: { hudLayout: 'a1', lang: 'uk', units: 'auto' } }, i02: { id: hash('persod-bbbb-2222'), values: { hudLayout: 'b1', lang: 'en', units: 'auto' } } });
    const onI02 = { _psSlot: 'i02', hudLayout: 'b1', lang: 'en', units: 'auto', profileSets: true };

    await test('H1a', async () => {
        const dir = dataDir(onI02, two());
        const car = fakeCar({ slot: 'i02', idMode: 'random' });
        const a = start(dir, car);
        await sleep(200);
        car.to('i01');
        await sleep(700);
        ok(a.settings.get('hudLayout') === 'a1' && fileVals(dir, 'i01').hudLayout === 'a1' && !fs.existsSync(fileOf(dir, 'i01') + '.bak'),
            'H1a an id that reads differently each time: i01 gets its OWN set and its file is untouched (settings ' + a.settings.get('hudLayout') + ', file ' + (fileVals(dir, 'i01') || {}).hudLayout + ')');
        a.stop();
    });
    await test('H1b', async () => {
        for (const mode of ['fail', 'timeout']) {
            const dir = dataDir(onI02, two());
            const car = fakeCar({ slot: 'i02', idMode: mode });
            const a = start(dir, car, { getMs: 3000 });
            await sleep(200);
            const t = Date.now();
            car.to('i01');
            await until(() => a.settings.get('hudLayout') === 'a1', 2500);
            const took = Date.now() - t;
            ok(a.settings.get('hudLayout') === 'a1' && fileVals(dir, 'i01').hudLayout === 'a1' && took < 600 && !/holds a new profile|a new profile in this slot|new profile in i01/.test(a.log()),
                'H1b the id ' + (mode === 'fail' ? 'not readable' : 'never answering (3 s timeout)') + ': i01\'s own set, put in ' + took + ' ms after the event (the switch does not wait for the id), never "a new profile"');
            a.stop();
        }
    });
    await test('H1c', async () => {
        const dir = dataDir(onI02, two());
        const car = fakeCar({ slot: 'i02', idMode: 'new' });
        const a = start(dir, car);
        await sleep(200);
        car.to('i01');
        await sleep(800);
        const bak = (() => { try { return JSON.parse(fs.readFileSync(fileOf(dir, 'i01') + '.bak', 'utf8')).values; } catch (e) { return null; } })();
        ok(a.settings.get('hudLayout') === 'b1' && fileVals(dir, 'i01').hudLayout === 'b1' && bak && bak.hudLayout === 'a1',
            'H1c a NEW id read twice in a row: i01 holds a new profile, starts over from the set in use before the switch, and the old set is kept as i01.json.bak (' + JSON.stringify(bak) + ')');
        a.stop();
    });
    await test('H1d', async () => {
        const p = two();
        const dir = dataDir(onI02, p);
        fs.writeFileSync(fileOf(dir, 'i01') + '.bak', JSON.stringify({ v: 1, slot: 'i01', id: p.i01.id, values: { hudLayout: 'a2', lang: 'uk', units: 'km' } }));
        fs.writeFileSync(fileOf(dir, 'i01'), '{"v":1,"slot":"i01","values":{"hudLay');          // a file cut in half (disk full, a kill)
        const car = fakeCar({ slot: 'i02' });
        const a = start(dir, car);
        await sleep(200);
        car.to('i01');
        await sleep(400);
        ok(a.settings.get('hudLayout') === 'a2' && a.settings.get('units') === 'km' && fs.existsSync(fileOf(dir, 'i01') + '.bad') && fileVals(dir, 'i01').hudLayout === 'a2',
            'H1d i01.json cut in half: its backup is used (a2, km), the broken file kept as i01.json.bad - not "seen for the first time" (settings ' + a.settings.get('hudLayout') + ')');
        a.stop();
        const dir2 = dataDir(onI02, two());
        const broken = '{"v":1,"slot":"i01","values":{"hudLay';
        fs.writeFileSync(fileOf(dir2, 'i01'), broken);
        const car2 = fakeCar({ slot: 'i02' });
        const b = start(dir2, car2);
        await sleep(200);
        car2.to('i01');
        await sleep(400);
        let badText = null; try { badText = fs.readFileSync(fileOf(dir2, 'i01') + '.bad', 'utf8'); } catch (e) { badText = null; }
        ok(badText === broken && /could not be read/.test(b.log()), 'H1d no backup either: the broken bytes are kept as i01.json.bad (never written over), the log says so');
        b.stop();
    });
    await test('H1e', async () => {
        const dir = dataDir({ _psSlot: 'i01', hudLayout: 'a1', lang: 'uk', units: 'auto', profileSets: true }, two());
        const car = fakeCar({ slot: 'i02', smFail: true });
        const a = start(dir, car);
        await sleep(150);
        a.settings.set('hudLayout', 'b2');           // the driver in the car (i02) fixes the look while the profile is not known
        await sleep(100);
        const mid = fileVals(dir, 'i01').hudLayout;
        car.smFail = false;
        await until(() => a.settings.get('hudLayout') === 'b1', 1500);
        ok(mid === 'a1' && fileVals(dir, 'i01').hudLayout === 'a1' && a.settings.get('hudLayout') === 'b1',
            'H1e a change while the profile is not known is not saved to i01 (the set in use); when the car says i02 its own set comes in (i01 file ' + mid + ' -> ' + fileVals(dir, 'i01').hudLayout + ')');
        a.stop();
    });
    await test('H1f', async () => {
        const dir = dataDir({ _psSlot: 'i01', hudLayout: 'a1', lang: 'uk', units: 'auto', profileSets: true }, two());
        const car = fakeCar({ slot: 'i01' });
        const a = start(dir, car, { quietMs: 300 });
        await sleep(200);
        car.to('i02');
        await sleep(40);
        a.settings.set('hudLayout', 'b3');            // during the debounce: the car already says i02
        await until(() => a.settings.get('hudLayout') === 'b1', 1500);
        ok(fileVals(dir, 'i01').hudLayout === 'a1' && a.settings.get('hudLayout') === 'b1' && fileVals(dir, 'i02').hudLayout === 'b1',
            'H1f a change while the switch to i02 is pending goes to nobody\'s set: i01 keeps a1, i02 its own b1');
        a.stop();
    });
    await test('H1g', async () => {
        const dir = dataDir({ _psSlot: 'i01', hudLayout: 'a1', lang: 'uk', units: 'auto', profileSets: true }, two());
        const car = fakeCar({ slot: 'i02', lagSlot: 'i01', lagUntil: Date.now() + 150, silent: true });
        const a = start(dir, car, { settleMs: 400 });
        await sleep(60);
        a.settings.set('hudLayout', 'b2');            // i02's driver, while the car still reports i01 (a wake-up)
        await until(() => a.settings.get('hudLayout') === 'b1', 1500);
        ok(fileVals(dir, 'i01').hudLayout === 'a1' && a.settings.get('hudLayout') === 'b1',
            'H1g the car reports the last driver for 150 ms at a wake-up, the new driver changes the look meanwhile: i01\'s set is not touched (settle window), i02\'s own set comes in');
        a.stop();
    });
    await test('H1h', async () => {
        const dir = dataDir({ _psSlot: 'i01', hudLayout: 'a1', lang: 'uk', units: 'auto', profileSets: true }, two());
        const car = fakeCar({ slot: 'i01' });
        const a = start(dir, car, { settleMs: 150 });
        await sleep(60);
        a.settings.set('hudLayout', 'a2');            // too early: waits
        const early = fileVals(dir, 'i01').hudLayout;
        await until(() => fileVals(dir, 'i01').hudLayout === 'a2', 1000);
        a.settings.set('hudLayout', 'a3');
        const bak = (() => { try { return JSON.parse(fs.readFileSync(fileOf(dir, 'i01') + '.bak', 'utf8')).values.hudLayout; } catch (e) { return null; } })();
        ok(early === 'a1' && fileVals(dir, 'i01').hudLayout === 'a3' && bak === 'a2',
            'H1h own changes: one made in the first 150 ms waits and is saved once the car has said i01 that long; the next is saved at once, the previous version kept as i01.json.bak (' + early + ' -> a2 -> a3, .bak ' + bak + ')');
        a.stop();
    });
}

/* -------------------------------------------------------------- H2: the start -------------------------------------------- */
async function partH2() {
    section('H2. the start (Symptom 2, hypotheses 2 and 3)');
    const two = () => ({ i01: { id: hash('persod-aaaa-1111'), values: { hudLayout: 'a1', lang: 'uk', units: 'auto' } }, i02: { id: hash('persod-bbbb-2222'), values: { hudLayout: 'b1', lang: 'en', units: 'auto' } } });
    const onI01 = { _psSlot: 'i01', hudLayout: 'a1', lang: 'uk', units: 'auto', profileSets: true };

    await test('H2a', async () => {
        const dir = dataDir(onI01, two());
        const car = fakeCar({ slot: 'i02', smDelay: 120 });
        const a = start(dir, car, { quietMs: 400, gapMs: 400 });
        let firstAt = null;
        if (a.ps && typeof a.ps.onFirst === 'function') a.ps.onFirst(() => { firstAt = Date.now() - a.t0; });
        await until(() => a.settings.get('hudLayout') === 'b1', 1500);
        const at = a.batches.length ? a.batches[0].at - a.t0 : null;
        ok(a.batches.length === 1 && at !== null && at < 350 && firstAt !== null && firstAt <= at + 20,
            'H2a held i01, the car says i02 (answering in 120 ms): the first decision is not debounced - i02\'s set in at ' + at + ' ms, ONE batch, the first build told at ' + firstAt + ' ms');
        a.stop();
        const dir2 = dataDir(onI01, two());
        const car2 = fakeCar({ slot: 'i01', smFail: true });
        const b = start(dir2, car2);
        let first2 = null;
        if (b.ps && typeof b.ps.onFirst === 'function') b.ps.onFirst(() => { first2 = Date.now() - b.t0; });
        await sleep(500);
        ok(first2 !== null && first2 >= 280 && first2 < 450 && b.settings.get('hudLayout') === 'a1', 'H2a the field never answering: the first build is told after firstMs (' + first2 + ' ms), with the set in use');
        b.stop();
    });
    await test('H2b', async () => {
        for (const ev of [false, true]) {
            const dir = dataDir(onI01, two());
            const car = fakeCar({ slot: 'i02', lagSlot: 'i01', lagUntil: Date.now() + 300 });
            const a = start(dir, car);
            if (ev) setTimeout(() => car.event(), 310);
            const ok1 = await until(() => a.settings.get('hudLayout') === 'b1', 3000);
            const at = a.batches.length ? a.batches[0].at - a.t0 : null;
            ok(ok1 && at !== null && at < 900 && a.batches.length === 1,
                'H2b the car reports the last driver (i01) for 300 ms, then i02 ' + (ev ? 'with' : 'WITHOUT') + ' the event: i02\'s set in at ' + at + ' ms (slow poll 2000 ms; the fast poll after the start finds it), one batch');
            a.stop();
        }
    });
    await test('H2c', async () => {
        const dir = dataDir(onI01, two());
        const car = fakeCar({ slot: 'i02', smFailUntil: Date.now() + 500 });
        const a = start(dir, car);
        const ok1 = await until(() => a.settings.get('hudLayout') === 'b1', 3000);
        const at = a.batches.length ? a.batches[0].at - a.t0 : null;
        ok(ok1 && at !== null && at < 1200, 'H2c the field failing for the first 500 ms: asked again (back-off), i02\'s set in at ' + at + ' ms, not at the slow poll');
        a.stop();
    });
    await test('H2d', async () => {
        const dir = dataDir(onI01, two());
        const car = fakeCar({ slot: 'i01' });
        const a = start(dir, car, { quietMs: 200 });
        await sleep(150);
        const t = Date.now();
        car.to('i02');
        await sleep(50);
        car.event({ unexpected: 1 });                   // an event without a profile reference during the pending switch
        await until(() => a.settings.get('hudLayout') === 'b1', 3000);
        const took = Date.now() - t;
        ok(a.settings.get('hudLayout') === 'b1' && took < 700, 'H2d an odd event (no profile reference) during the pending switch does not drop it: i02 in ' + took + ' ms');
        a.stop();
    });
    await test('H2e', async () => {
        const dir = dataDir(onI01, two());
        const car = fakeCar({ slot: 'i01' });
        const a = start(dir, car, { quietMs: 60, gapMs: 120 });
        await sleep(200);
        ['i02', 'i01', 'i02', 'i01', 'i02'].forEach((s) => car.to(s));
        await sleep(600);
        ok(a.batches.length === 1 && a.settings.get('hudLayout') === 'b1', 'H2e flapping that ends on i02: one batch (one rebuild)');
        a.stop();
    });
}

/* -------------------------------------------------------------- H4: two apps --------------------------------------------- */
async function partH4() {
    section('H4. two apps on one car (Symptom 2, hypothesis 4)');
    await test('H4', async () => {
        // the owner (i01) uses f30_cluster, the other driver (i02) Twin Dial: "off" in the other app, per profile
        const f30 = dataDir({ _psSlot: 'i01', hudLayout: 'wb', profileSets: true }, { i01: { values: { hudLayout: 'wb' } }, i02: { values: { hudLayout: 'off' } } });
        const twin = dataDir({ _psSlot: 'i01', hudLayout: 'off', profileSets: true }, { i01: { values: { hudLayout: 'off' } }, i02: { values: { hudLayout: 'twin' } } });
        const car = fakeCar({ slot: 'i01' });
        const a = start(f30, car), b = start(twin, car);
        await sleep(150);
        car.to('i02');
        await until(() => a.settings.get('hudLayout') === 'off' && b.settings.get('hudLayout') === 'twin', 1500);
        ok(a.settings.get('hudLayout') === 'off' && b.settings.get('hudLayout') === 'twin', 'H4 both apps follow i02 on their own: f30_cluster off, Twin Dial on (which app draws is per profile through each app\'s "off")');
        car.to('i01');
        await until(() => a.settings.get('hudLayout') === 'wb' && b.settings.get('hudLayout') === 'off', 1500);
        a.stop(); b.stop();
        // one app's read failing: that app keeps the last driver's look - two themes, or none, on one panel
        const car2 = fakeCar({ slot: 'i01' });
        const failing = fakeCar({ slot: 'i01', smFail: true });
        const f30b = dataDir({ _psSlot: 'i02', hudLayout: 'off', profileSets: true }, { i01: { values: { hudLayout: 'wb' } }, i02: { values: { hudLayout: 'off' } } });
        const twinb = dataDir({ _psSlot: 'i02', hudLayout: 'twin', profileSets: true }, { i01: { values: { hudLayout: 'off' } }, i02: { values: { hudLayout: 'twin' } } });
        const c = start(f30b, car2), d = start(twinb, failing);
        await sleep(500);
        ok(c.settings.get('hudLayout') === 'wb' && d.settings.get('hudLayout') === 'twin', 'H4 the owner (i01) starts after i02, Twin Dial cannot read the profile: f30 switches to 6WB, Twin Dial stays on i02\'s look (' +
            c.settings.get('hudLayout') + ' + ' + d.settings.get('hudLayout') + '): "the other user\'s look" can be the other app');
        c.stop(); d.stop();
    });
}

/* -------------------------------------------------------------- M: the migration ----------------------------------------- */
async function partM() {
    section('M. the migration to per-profile settings (Symptom 3)');
    await test('M', async () => {
        // settings.json from before per-profile settings: no _psSlot, the owner's look "x"
        const dir = dataDir({ hudLayout: 'x', lang: 'uk', units: 'auto', diagX: true }, null);
        const pre = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
        const car = fakeCar({ slot: 'i02' });            // the OTHER driver happens to be first
        const a = start(dir, car, { settleMs: 0 });
        await sleep(250);
        const preFile = path.join(dir, 'settings.pre-profiles.json');
        const kept = fs.existsSync(preFile) ? fs.readFileSync(preFile, 'utf8') : null;
        a.settings.set('hudLayout', 'y');               // the other driver changes the look
        await sleep(100);
        a.stop();
        const car2 = fakeCar({ slot: 'i01' });           // the owner, next start
        const b = start(dir, car2, { settleMs: 0 });
        await until(() => b.ps && b.ps.held === 'i01', 1500);
        await sleep(100);
        ok(kept === pre, 'M the settings from before are kept byte for byte as settings.pre-profiles.json');
        ok(fileVals(dir, 'i02').hudLayout === 'y' && b.settings.get('hudLayout') === 'x' && fileVals(dir, 'i01').hudLayout === 'x',
            'M the other driver first (and changing x -> y): the owner, seen next, still gets the look from before (' + b.settings.get('hudLayout') + '), i02 keeps its own (y)');
        b.settings.set('hudLayout', 'c');
        b.stop();
        const c = start(dir, fakeCar({ slot: 'guest' }), { settleMs: 0 });
        await until(() => c.ps && c.ps.held === 'guest', 1500);
        ok((fs.existsSync(preFile) ? fs.readFileSync(preFile, 'utf8') : null) === pre && c.settings.get('diagX') === true, 'M later starts never overwrite it; the global switches stay as they were');
        c.stop();
        const fresh = dataDir(null, null);
        const e = start(fresh, fakeCar({ slot: 'i01' }));
        await sleep(200);
        ok(!fs.existsSync(path.join(fresh, 'settings.pre-profiles.json')), 'M a fresh install has nothing to keep');
        e.stop();
    });
}

/* -------------------------------------------------------------- R: random starts ----------------------------------------- */
async function partR() {
    section('R. ' + STARTS + ' scripted starts with random timing');
    await test('R', async () => {
        const drivers = ['i01', 'i02', 'guest'];
        const dir = dataDir({ _psSlot: 'i01', hudLayout: 'a1', lang: 'uk', units: 'auto', profileSets: true },
            { i01: { id: hash('persod-aaaa-1111'), values: { hudLayout: 'a1', lang: 'uk', units: 'auto' } }, i02: { id: hash('persod-bbbb-2222'), values: { hudLayout: 'b1', lang: 'en', units: 'auto' } },
                guest: { id: hash('guest'), values: { hudLayout: 'g1', lang: 'uk', units: 'km' } } });
        let prev = 'i01';
        const bad = [];
        let switches = 0, changes = 0, own = 0;
        const rnd = (n) => Math.floor(Math.random() * n);
        const check = (n, when) => drivers.forEach((s) => {
            const v = fileVals(dir, s);
            if (v && PALETTE[s].indexOf(v.hudLayout) < 0) bad.push('start ' + n + ' ' + when + ': ' + s + '.json holds ' + v.hudLayout);
        });
        for (let n = 0; n < STARTS; n++) {
            const D = drivers[rnd(3)];
            const lag = rnd(4) ? rnd(100) : 0;
            const car = fakeCar({ slot: D, lagSlot: prev, lagUntil: Date.now() + lag, smFailUntil: rnd(3) ? 0 : Date.now() + rnd(250), smDelay: rnd(30),
                idMode: ['ok', 'fail', 'random', 'timeout'][rnd(4)] });
            const a = start(dir, car, { settleMs: 300, fastMs: 40, firstMs: 200, reuseConfirmMs: 60 });
            if (rnd(2)) setTimeout(() => car.event(), lag + 5);
            const k = rnd(3);
            for (let j = 0; j < k; j++) {
                setTimeout(() => { a.settings.set('hudLayout', PALETTE[D][rnd(3)]); changes++; }, rnd(700));
            }
            await sleep(750);
            a.stop();
            await sleep(20);
            if (a.settings.get('_psSlot') !== prev) switches++;
            own += a.lines.filter((l) => / changed by /.test(l) || /made before it was known/.test(l)).length;
            check(n, 'after');
            prev = D;
        }
        ok(!bad.length, 'R ' + STARTS + ' starts (' + switches + ' switches, ' + changes + ' driver changes, ' + own + ' own saves; random lag, failing reads, odd ids, events or none): no profile\'s file ever took another driver\'s choice' +
            (bad.length ? ': ' + bad.slice(0, 4).join('; ') + (bad.length > 4 ? ' (+' + (bad.length - 4) + ')' : '') : ''));
    });
}

/* -------------------------------------------------------------- P: privacy, reads only ---------------------------------- */
async function partP() {
    section('P. privacy and reads only');
    await test('P', async () => {
        const dir = dataDir({ _psSlot: 'i01', hudLayout: 'a1', profileSets: true }, { i01: { id: hash('persod-aaaa-1111'), values: { hudLayout: 'a1' } } });
        const car = fakeCar({ slot: 'i01', idMode: 'new' });
        const a = start(dir, car);
        await sleep(100);
        car.to('i02'); await sleep(400); car.to('i01'); await sleep(400);
        const kinds = car.calls.filter((c, i, x) => x.indexOf(c) === i).sort();
        ok(kinds.every((c) => /^(proxy (SessionManager|UserAccount)|get SessionManager\.currentUserAccountReference|get UserAccount\.id|on currentUserOnChange)$/.test(c)), 'P only the two getters and the one event: ' + kinds.join(', '));
        const ids = Object.keys(car.ids).map((k) => car.ids[k]).concat(['persod-new-i01', 'persod-new-i02']).filter((x) => x.length > 6);
        const hashes = fs.readdirSync(path.join(dir, 'profiles')).filter((f) => /\.json$/.test(f)).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'profiles', f), 'utf8')).id; } catch (e) { return null; } }).filter(Boolean);
        const leak = ids.concat(hashes).filter((x) => a.log().indexOf(x) >= 0);
        ok(!leak.length, 'P no persod id and no id hash in the log');
        a.stop();
    });
}

/* -------------------------------------------------------------- S / T: the apps on the bench ---------------------------- */
// BENCH_PORT (8851 by default; f30_cluster on it, twin_dial on BENCH_PORT + 1, one after the other). PF_SKIP_BENCH=1 leaves them out.
const { spawn } = require('child_process');
const PORT0 = Number(process.env.BENCH_PORT) || 8851;
function bench(app, port, seed, env) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bench-'));
    const dataDir = path.join(tmp, 'data'), screenDir = path.join(tmp, 'screen');
    fs.mkdirSync(dataDir); fs.mkdirSync(screenDir);
    if (seed && seed.settings) fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(seed.settings, null, 1));
    if (seed && seed.profiles) {
        fs.mkdirSync(path.join(dataDir, 'profiles'));
        Object.keys(seed.profiles).forEach((s) => fs.writeFileSync(path.join(dataDir, 'profiles', s + '.json'), JSON.stringify({ v: 1, slot: s, id: null, values: seed.profiles[s] }, null, 1)));
    }
    const e = Object.assign({}, process.env, { BENCH_PORT: String(port), BENCH_DATA_DIR: dataDir, SCREEN_DIR: screenDir, BENCH_HMI_LANG: 'uk_UA',
        BENCH_CONFIG: JSON.stringify({ profileSettings: { fastWindowMs: 600000 } }) }, env || {});
    const b = { port, dataDir, log: '', exited: false };
    b.server = spawn(process.execPath, [path.join(__dirname, 'server.js'), app], { cwd: ROOT, env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (d) => { b.log += d; if (/app exited/.test(String(d))) b.exited = true; };
    b.server.stdout.on('data', keep); b.server.stderr.on('data', keep);
    const req = async (method, url, body) => {
        const r = await fetch('http://127.0.0.1:' + port + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        if (r.status === 200) return r.json();
        if (r.status !== 204) throw new Error(method + ' ' + url + ': ' + r.status);
        return null;
    };
    b.probe = () => req('GET', '/probe');
    b.set = (key, value) => req('POST', '/setting', { key, value });
    b.fake = (v) => req('POST', '/fake', v);
    b.until = async (fn, ms) => {
        const end = Date.now() + (ms || 10000);
        let p = null;
        while (Date.now() < end) { try { p = await b.probe(); if (p && fn(p)) return p; } catch (er) { /* (re)starting */ } await sleep(150); }
        return p;
    };
    b.appLog = () => b.log.split('\n').filter((l) => /app: \[/.test(l) && !/fake persod|bench: /.test(l)).join('\n');
    b.stop = () => { try { b.server.kill('SIGTERM'); } catch (er) { /* gone */ } };
    return b;
}
const blk = (q) => ((q && q.native && q.native.STATUS_PS) || {}).text || '';
const layoutNames = (app) => { const o = {}; fs.readdirSync(path.join(ROOT, 'apps', app, 'hud', 'layouts')).filter((f) => /\.json$/.test(f)).forEach((f) => { try { o[JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', app, 'hud', 'layouts', f), 'utf8')).name] = f.slice(0, -5); } catch (e) { /* not a layout */ } }); return o; };

async function partS() {
    section('S. f30_cluster on the bench (port ' + PORT0 + '): the start on another driver, the status block, the units');
    // the last driver was i01 (6WB Sport, Ukrainian); i02 (6WB Eco Pro, English) gets in; the profile answers in 400 ms
    const b = bench('f30_cluster', PORT0, {
        settings: { _psSlot: 'i01', hudLayout: 'wb_sport', byMode: false, lang: 'uk', units: 'auto', profileSets: true, _oneSwitchV: 1, _themeV: 2 },
        profiles: { i01: { hudLayout: 'wb_sport', byMode: false, lang: 'uk', units: 'auto' }, i02: { hudLayout: 'wb_eco', byMode: false, lang: 'en', units: 'auto' } },
    }, { BENCH_PERSO_START: JSON.stringify({ current: 'i02', smDelay: 400, users: ['i03'] }) });
    try {
        let p = await b.until((q) => q.ready && q.activeName && q.ps && q.ps.held === 'i02', 120000);
        ok(p && p.ready && p.activeName === 'wb_eco', 'S the app starts on i01\'s saved set while the car says i02 (answering in 400 ms): the theme is i02\'s ' + (p && p.activeName));
        if (!p || !p.ready) return;
        if (process.env.PF_DEBUG) console.log(b.appLog().split('\n').filter((l) => /layout "|profile|start-up|ready|preview/.test(l)).slice(0, 60).join('\n'));
        const names = layoutNames('f30_cluster');
        const builds = (b.appLog().match(/layout "([^"]+)", theme/g) || []).map((x) => { const n = x.slice(8, x.indexOf('", theme')); return names[n] || n; });
        ok(builds.length >= 1 && builds[0] === 'wb_eco' && builds.indexOf('wb_sport') < 0 && /profile: the first build after \d+ ms of waiting for the driver profile: the car says i02/.test(b.appLog()),
            'S the first build is already i02\'s (builds: ' + builds.join(', ') + '); i01\'s Sport was never built');
        p = await b.until((q) => /Profile 2, read \d+ s ago/.test(blk(q)) && /settings in use: Profile 2/.test(blk(q)), 8000);
        ok(/Profile 2, read \d+ s ago/.test(blk(p)) && /settings in use: Profile 2/.test(blk(p)) && /km: /.test(blk(p)) && /language: English \(the setting\)/.test(blk(p)),
            'S the status block: "' + blk(p) + '"');
        // Symptom 1 on f30: the struct says MEILEN for i02 (a fresh profile's factory default); f30 reads no second source
        await b.fake({ unitsBy: { i02: { speed: 'MEILEN', cons: 'L_S_100KM', temp: 'C' } } });
        p = await b.until((q) => /MEILEN/.test(blk(q)), 8000);
        ok(p.units && p.units.mi === false && p.texts.speed_unit && p.texts.speed_unit.text === 'km/h' && /km: the car says MEILEN, not confirmed/.test(blk(p)) &&
            /units: setting auto; the car says speedometer MEILEN, consumption L_S_100KM, temperature C -> km, l100, °C \(unconfirmed\)/.test(b.appLog()),
            'S the car says MEILEN for i02: km/h stays ("' + (p.texts.speed_unit || {}).text + '"), the block says "' + (blk(p).match(/km: [^.]*/) || [''])[0] + '", the log names the raw value');
        await b.set('units', 'mi');
        p = await b.until((q) => q.units && q.units.mi === true && /miles: the setting/.test(blk(q)), 10000);
        ok(p.units.mi === true && p.texts.speed_unit.text === 'mph', 'S miles only by the driver\'s choice ("милі"): mph, the block says "miles: the setting"');
        await b.set('units', 'auto');
        // the previous driver reported for 2 s after a wake-up, then i01, WITHOUT the event: the fast poll finds it
        const t = Date.now();
        await b.fake({ lag: { slot: 'i02', ms: 2000 }, current: 'i01', silent: true });
        p = await b.until((q) => q.ps && q.ps.held === 'i01' && q.activeName === 'wb_sport', 15000);
        const took = Date.now() - t;
        ok(p.ps.held === 'i01' && p.activeName === 'wb_sport' && took < 9000, 'S the car reports i02 for 2 s more, then i01 without the event: i01\'s Sport in ' + (took / 1000).toFixed(1) + ' s (car timings: poll 3 s after a wake-up, 15 s later)');
        const fv = (s) => { try { return JSON.parse(fs.readFileSync(path.join(b.dataDir, 'profiles', s + '.json'), 'utf8')).values; } catch (e) { return {}; } };
        ok(fv('i01').hudLayout === 'wb_sport' && fv('i01').lang === 'uk' && fv('i02').hudLayout === 'wb_eco' && fv('i02').lang === 'en' && fv('i02').units === 'auto',
            'S after the switches each file holds its own driver\'s set (i01: wb_sport / uk, i02: wb_eco / en / auto)');
        const leak = ['Driver A', 'Driver B'].filter((x) => b.appLog().indexOf(x) >= 0);
        const gets = Object.keys((p.perso || {}).gets || {});
        ok(!leak.length && !((p.perso || {}).calls || []).length && gets.every((g) => g === 'SessionManager.currentUserAccountReference' || g === 'UserAccount.id') && !b.exited,
            'S only the two getters (' + gets.join(', ') + '), no name in the log, the app never exited');
    } finally { b.stop(); await sleep(800); }
}

async function partT() {
    const port = PORT0 + 1;
    section('T. twin_dial on the bench (port ' + port + '): the units with the odometer as the second source');
    const b = bench('twin_dial', port, null, { BENCH_PERSO_START: JSON.stringify({ current: 'i01' }), BENCH_CONFIG: JSON.stringify({ profileSettings: { fastWindowMs: 600000, settleMs: 0 } }) });
    try {
        let p = await b.until((q) => q.ready && q.activeName === 'twin' && q.ps && q.ps.held === 'i01', 120000);
        ok(p && p.ready && p.activeName === 'twin', 'T the app runs, i01 active');
        if (!p || !p.ready) return;
        await b.set('lang', 'en');
        await b.fake({ carUnits: { speed: 'MEILEN', temp: 'C' } });
        p = await b.until((q) => /MEILEN/.test(blk(q)), 10000);
        ok(p.units && !p.units.mi && /km: the car says MEILEN, not confirmed/.test(blk(p)), 'T the struct\'s MEILEN alone: km ("' + (blk(p).match(/km: [^.]*/) || [''])[0] + '")');
        await b.fake({ twin: { units: 'mi' } });
        p = await b.until((q) => q.units && q.units.mi === true && /miles: /.test(blk(q)), 10000);
        if (process.env.PF_DEBUG) console.log(JSON.stringify(p.units), '\n' + b.appLog().split('\n').filter((l) => /units|twin control|UnitBN/.test(l)).slice(-12).join('\n'));
        ok(p.units.mi === true && /miles: the car says MEILEN, odometer MEILEN/.test(blk(p)), 'T MEILEN and the odometer MEILEN: miles ("' + (blk(p).match(/miles: [^.]*/) || [''])[0] + '")');
        await b.fake({ twin: { units: 'km' } });
        p = await b.until((q) => q.units && q.units.mi === false && /but odometer KILOMETER/.test(blk(q)), 10000);
        ok(p.units.mi === false && /km: the car says MEILEN, but odometer KILOMETER/.test(blk(p)), 'T the car\'s own record (MEILEN, odometer KILOMETER): km ("' + (blk(p).match(/km: [^.]*/) || [''])[0] + '")');
        ok(/Profile 1, read \d+ s ago/.test(blk(p)) && /settings in use: Profile 1/.test(blk(p)) && !b.exited, 'T the status block: "' + blk(p) + '"');
    } finally { b.stop(); await sleep(800); }
}

(async () => {
    partU();
    await partH1();
    await partH2();
    await partH4();
    await partM();
    await partR();
    await partP();
    if (!process.env.PF_SKIP_BENCH && !process.env.PS_MODULE_DIR) { if (!process.env.PF_ONLY_T) await partS(); await partT(); }
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
