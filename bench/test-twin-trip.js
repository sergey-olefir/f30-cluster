'use strict';
/**
 * test-twin-trip.js - research round 3, package MK: Twin Dial's trip computer and odometer with the most likely factors
 * ON by default (the owner, 2026-11-18: no dashes by design), the fallback chain, the first-arrival log lines and the
 * summary that names every silent source (docs/research3/MK-REPORT.md).
 *
 *   node bench/test-twin-trip.js
 *
 * No bench, no car: the real engine (shared/hud.js from a temp tree, bench/twin-harness.js) and shared/twin_tokens.js
 * wire(); values are injected straight into the chained handlers, the getter of a silent source is a fake signals.get.
 *   1. the default factors (no config, null, a partial config), `false` = dashes, a one-line override;
 *   2. the invalid markers of every member are dashes, and a silent source is a dash;
 *   3. the fallback chain: KombiIF first, ResetLogic3 (rl3) for each value KombiIF does not deliver; config.trip.order;
 *   4. the odometer chain: rangeTank, MileageSupreme (its qualifier), VehicleInformation.Range, SecureMileage;
 *   5. the log: one line per source on first arrival with UNVERIFIED once, changes at most once a minute, never text;
 *   6. the summary: heard / SILENT, what the page shows and from where (or silent / invalid), the plausibility checks,
 *      the getter of each silent source asked once (answered / error / no provider), the timers;
 *   7. the shipped app.json: the factors on, every source the wiring watches declared, Node 8 syntax.
 * Node 8 or newer. Never shipped.
 */
const path = require('path');
const fs = require('fs');
const H = require('./twin-harness');

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const eq = (a, b, what) => { const k = JSON.stringify(a) === JSON.stringify(b); ok(k, what + (k ? '' : ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')')); };

const dir = H.tree('twin_dial');
const HudApp = require(path.join(dir, 'hud.js'));
const twin = require(path.join(dir, 'twin_tokens.js'));
const DASH = '–', THIN = twin.THIN;
const KI = 'de.bmw.infotainment.KombiIF', RL3 = 'de.bmw.infotainment.resetlogic.ResetLogic3';
const SUP = 'de.bmw.infrastructure.MileageSupreme', VI = 'de.bmw.infrastructure.VehicleInformation', SEC = 'de.bmw.infrastructure.SecureMileage';
const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);
const APP = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'apps', 'twin_dial', 'app.json'), 'utf8'));

function mk(over) {
    const lines = [];
    const log = { info: (s) => lines.push(s), warn: (s) => lines.push('WARN ' + s), error: (s) => lines.push('ERR ' + s) };
    const o = Object.assign({ log, settings: { centre: 'trip' } }, over || {});
    const h = H.fakeHud(HudApp, o);
    if (over && over.config && 'trip' in over.config) h.config.trip = over.config.trip;
    h.config.trip = Object.assign({ summaryMs: [] }, h.config.trip || {});        // no timers unless a test asks
    h.td = twin.fresh(); h._now_ms = T0; h.td.clock = () => h._now_ms; h.tzCar = 120;
    h._d = { speed: 0 };
    const extra = {};
    twin.wire(h, extra);
    h.extra = extra; h.lines = lines;
    return h;
}
const tok = (h, n) => h._token('td:' + n);
const page = (h) => ['tConsAvg', 'tSpeedAvg', 'tDist', 'tTime', 'tFrom'].map((n) => tok(h, n));
const avg = (h, s1, c1, s2, c2) => h.extra[KI].statusBordcomputerAverage({ speedAverage1BC1: s1, consumptionAverage1BC1: c1, speedAverage2BC2: s2, consumptionAverage2BC2: c2,
    statusUnitOfMeasurementSpeedBC: 'KM_S_H__KM', statusUnitOfMeasurementConsumptionBC: 'VERBRAUCH_IN_L_S_100KM' });
const travel = (h, hrs, min, way) => h.extra[KI].statusBordcomputerTravelData({ rideDurationHours: hrs, rideDurationMinutes: min, wayPassed: way });
const start = (h, hh, mm) => h.extra[KI].statusBordcomputerTravelStart({ hourDepartureBC: hh, minuteDepartureBC: mm, dayDepartureBC: 18, monthDepartureBC: 11, yearDepartureBC: 2026 });
const rl3 = (h, o) => h.extra[RL3].bcDataAll({
    bcUnits: { tachoDigital: 'KILOMETERS', averageConsumptionCombustion: 'CONSUMPTION_KM' }, activeResetLogic: 1, availableResetLogic: 31,
    maxValues: { maxValueAverageConsumptionCombustion: 300 },
    bcData3: Object.assign({ resetOption: 'STARTOFDRIVING', dateTimeReset: { year: 26, month: 11, day: 18, hour: 9, minute: 5, second: 0 },
        dateTimeTrip: { day: 0, hour: 1, minute: 7, second: 30 }, speedAverage: 388, consumptionCombustionAverageDigit: 72, consumptionCombustionAverageScale: 24,
        counterDistance: 4330 }, o || {}),
});
const page1 = ['ø 6.8', 'ø 41', '12.4', '0:43', 'від початку поїздки, 14:00'];

// ---------------------------------------------------------------------------------------------------------------------
console.log('1. the factors: on by default');
{
    const h = mk({ config: { trip: { factors: null } } });
    avg(h, 410, 68, 520, 55); travel(h, 0, 43, 124); start(h, 14, 0);
    eq(page(h), page1, 'factors null (the shipped state before MK): the default factors show "ø 6.8", "ø 41", "12.4", "0:43", "14:00"');
    h.config.trip = {};
    eq(page(h), page1, 'no factors key at all: the same defaults');
    eq(twin.factors(h), twin.DEFAULT_FACTORS, 'the defaults are bc 1, speed 0.1, cons 0.1, way 0.1 (rl3: 0.1 / 0.1 / 0.1)');
    h.config.trip = { factors: { way: 1 } };
    eq(page(h).slice(0, 3), ['ø 6.8', 'ø 41', '124.0'], 'a partial config overrides one key; the others keep their default (the one-line fix)');
    h.config.trip = { factors: { bc: 2 } };
    eq(page(h).slice(0, 2), ['ø 5.5', 'ø 52'], 'bc 2 takes the second board computer');
    h.config.trip = { factors: false };
    eq(page(h), ['ø ' + DASH, 'ø ' + DASH, DASH, DASH, 'від початку поїздки, ' + DASH], 'factors false: every value a dash (the kill switch)');
    // integration (B7): the car (2026-11-18, against its own trip page) says KombiIF's distance is whole units: way 1; the rest as the defaults
    const shipped = JSON.parse(JSON.stringify(APP.config.trip.factors)); delete shipped._verified;
    eq(shipped, { bc: 1, speed: 0.1, cons: 0.1, way: 1, rl3: { speed: 0.1, cons: 0.1, way: 0.1 } }, 'the shipped app.json carries the factors explicitly, KombiIF distance x 1 as verified on the car');
    {
        const hc = mk({ config: { trip: { factors: APP.config.trip.factors, order: ['kombi'] } } });
        travel(hc, 1, 28, 19);
        eq(tok(hc, 'tDist'), '19.0', 'with the shipped factors a KombiIF distance of 19 reads 19.0 km (x 1), not 1.9');
        const ho = mk({ config: { odometer: APP.config.odometer } });
        ho.extra['de.bmw.infrastructure.MileageSupreme'].mileageSupreme({ mileageSupreme: 114747213, qualifierMileageSupreme: 'EVENT_DATA_AVAILABLE' });
        ok(Math.round(twin.odometer(ho).km) === 114747, 'MileageSupreme in metres (114747213, above the 24-bit marker) reads 114747 km with the shipped factor 0.001 (' + JSON.stringify(twin.odometer(ho)) + ')');
    }
    ok(APP.config.trip.verified === false && APP.config.odometer.verified === false, '... and verified false for the trip and the odometer (the first drive compares)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('2. invalid markers and silence are the only dashes');
{
    const h = mk();
    eq(page(h), ['ø ' + DASH, 'ø ' + DASH, DASH, DASH, 'від початку поїздки, ' + DASH], 'nothing arrived (silent): dashes');
    avg(h, 4095, 4095, 4095, 4095); travel(h, 4095, 255, 65535); start(h, 255, 255);
    eq(page(h), ['ø ' + DASH, 'ø ' + DASH, DASH, DASH, 'від початку поїздки, ' + DASH], 'the 12-bit markers (4095), 65535 and 255: dashes');
    avg(h, 65535, 65535, 0, 0);
    eq(page(h).slice(0, 2), ['ø ' + DASH, 'ø ' + DASH], 'the 16-bit marker 65535: a dash');
    avg(h, 0, 0, 0, 0); travel(h, 0, 0, 0); start(h, 7, 30);
    eq(page(h), ['ø 0.0', 'ø 0', '0.0', '0:00', 'від початку поїздки, 07:30'], 'zero is a value (a trip just started), not a marker');
    travel(h, 1, 75, 10);
    eq(tok(h, 'tTime'), '2:15', 'minutes above 59 carry into the hours (a member that counts total minutes still reads right)');
    start(h, 24, 0);
    eq(tok(h, 'tFrom'), 'від початку поїздки, ' + DASH, 'a departure hour of 24 is not a clock time: dash');
    avg(h, 4100, 68, 0, 0);
    eq(tok(h, 'tSpeedAvg'), 'ø 410', 'an implausible value is still shown (the summary flags it), never hidden');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('3. the fallback chain: KombiIF, then ResetLogic3');
{
    const h = mk();
    rl3(h);
    eq(page(h), ['ø 7.2', 'ø 39', '433.0', '1:07', 'від початку поїздки, 09:05'], 'KombiIF silent: every value from ResetLogic3 (Digit x 0.1, speed x 0.1, distance x 0.1, d/h/m, the reset time)');
    eq(twin.tripValues(h).src, { cons: 'rl3', speed: 'rl3', way: 'rl3', time: 'rl3', from: 'rl3' }, '... and the source of each is rl3');
    avg(h, 410, 68, 520, 55);
    eq(page(h).slice(0, 2), ['ø 6.8', 'ø 41'], 'KombiIF\'s averages arrive: they win (first in config.trip.order)');
    eq(twin.tripValues(h).src, { cons: 'kombi', speed: 'kombi', way: 'rl3', time: 'rl3', from: 'rl3' }, '... per value: averages from kombi, distance / time / departure still from rl3');
    avg(h, 4095, 4095, 4095, 4095);
    eq(page(h).slice(0, 2), ['ø 7.2', 'ø 39'], 'KombiIF turns invalid: the value falls back to rl3 at once');
    h.config.trip = { order: ['rl3', 'kombi'] };
    avg(h, 410, 68, 520, 55);
    eq(page(h).slice(0, 2), ['ø 7.2', 'ø 39'], 'config.trip.order ["rl3", "kombi"]: rl3 first');
    h.config.trip = { order: ['kombi'] };
    travel(h, 4095, 255, 65535);
    eq([tok(h, 'tDist'), tok(h, 'tTime')], [DASH, DASH], 'order ["kombi"] only: no fallback, the marker is a dash');
    h.config.trip = {};
    rl3(h, { resetOption: 'LONGTERM' });
    eq(tok(h, 'tFrom'), 'від початку поїздки, ' + DASH, 'rl3 departure only for the reset option STARTOFDRIVING (a long-term reset time is not this trip\'s start)');
    rl3(h, { resetOption: 4 });
    eq(tok(h, 'tFrom'), 'від початку поїздки, 09:05', '... the option as its wire number (4) works too');
    h.config.trip = { departureUtc: ['rl3'] };
    eq(tok(h, 'tFrom'), 'від початку поїздки, 11:05', 'config.trip.departureUtc ["rl3"]: the reset time 09:05 UTC shows in the car\'s zone (UTC+2) as 11:05');
    h.tzCar = null;
    eq(tok(h, 'tFrom'), 'від початку поїздки, ' + DASH, '... and as a dash while no zone is known (never a wrong time)');
    h.tzCar = 120; h.config.trip = {};
    rl3(h, { speedAverage: 65535, consumptionCombustionAverageDigit: 65535, counterDistance: 4294967295, dateTimeTrip: { day: 0, hour: 255, minute: 255, second: 255 } });
    h.config.trip = { order: ['rl3'] };
    eq(page(h).slice(0, 4), ['ø ' + DASH, 'ø ' + DASH, DASH, DASH], 'rl3\'s markers (65535, 0xFFFFFFFF, hour 255) are dashes');
    // the bottom row's R1: the trip distance from whichever source delivers it, else the range
    const r = mk(); r.rangeKm = 412;
    eq(tok(r, 'r1'), '412', 'R1: the range while no source delivers a distance');
    rl3(r);
    eq(tok(r, 'r1'), '433.0', 'R1: the trip distance from rl3 when KombiIF is silent');
    travel(r, 0, 43, 124);
    eq(tok(r, 'r1'), '12.4', 'R1: KombiIF\'s distance wins once it arrives');
}

// ---------------------------------------------------------------------------------------------------------------------
// b7 (CP's finding): the catalogue declares ResetLogic3.bcDataAll.bcData3 as an ARRAY (arrayMaxLength 5): the car sends a list of structs
console.log('3b. ResetLogic3 bcData3 is an array: the first entry that carries a value');
{
    const entry = (o) => Object.assign({ resetOption: 'STARTOFDRIVING', dateTimeReset: { year: 26, month: 11, day: 18, hour: 9, minute: 5, second: 0 },
        dateTimeTrip: { day: 0, hour: 1, minute: 7, second: 30 }, speedAverage: 388, consumptionCombustionAverageDigit: 72, consumptionCombustionAverageScale: 24, counterDistance: 4330 }, o || {});
    const unfilled = entry({ speedAverage: 65535, consumptionCombustionAverageDigit: 65535, counterDistance: 4294967295, dateTimeTrip: { day: 0, hour: 255, minute: 255, second: 255 } });
    const arr = (h, list) => h.extra[RL3].bcDataAll({ bcUnits: { tachoDigital: 'KILOMETERS', averageConsumptionCombustion: 'CONSUMPTION_KM' }, activeResetLogic: 1, availableResetLogic: 31,
        maxValues: { maxValueAverageConsumptionCombustion: 300 }, bcData3: list });
    let h = mk();
    arr(h, [entry()]);
    eq(page(h), ['ø 7.2', 'ø 39', '433.0', '1:07', 'від початку поїздки, 09:05'], 'a one-entry array gives the same page as the plain struct (before the fix: dashes, nothing was read)');
    h = mk();
    arr(h, [unfilled, entry({ speedAverage: 500 }), entry({ speedAverage: 900 })]);
    eq(page(h).slice(0, 2), ['ø 7.2', 'ø 50'], 'the first entry that carries a value is used (an unfilled one before it is skipped; a later one is not read)');
    h = mk({ config: { trip: { order: ['rl3'] } } });
    arr(h, [unfilled, unfilled]);
    eq(page(h).slice(0, 4), ['ø ' + DASH, 'ø ' + DASH, DASH, DASH], 'an array of unfilled entries: dashes by the page\'s own rules');
    h = mk({ config: { trip: { order: ['rl3'] } } });
    arr(h, []);
    eq(page(h).slice(0, 4), ['ø ' + DASH, 'ø ' + DASH, DASH, DASH], 'an empty array: dashes, no error');
    eq(twin.rl3Entry(entry({ speedAverage: 1 })).speedAverage, 1, 'a plain struct is still taken as it is');
}

console.log('4. the odometer chain');
{
    const h = mk({ settings: { centre: 'clock' } });
    eq(tok(h, 'odo'), DASH, 'no carrier spoke: a dash');
    h.extra[SEC].mileage({ currentMileage: 48230, aliveCounter: 3, manipulationState: 0 });
    eq(tok(h, 'odo'), '48' + THIN + '230', 'SecureMileage alone (the last in the order) fills the slot');
    h.extra[VI].Range({ mileageKilometre: 48220 });
    eq(tok(h, 'odo'), '48' + THIN + '220', 'VehicleInformation.Range comes before it');
    h.extra[SUP].mileageSupreme({ mileageSupreme: 48210, qualifierMileageSupreme: 'EVENT_DATA_INVALID_OR_TIMEOUT' });
    eq(tok(h, 'odo'), '48' + THIN + '220', 'MileageSupreme with an invalid qualifier is skipped');
    h.extra[SUP].mileageSupreme({ mileageSupreme: 48210, qualifierMileageSupreme: 0 });
    eq(tok(h, 'odo'), '48' + THIN + '210', '... and with EVENT_DATA_AVAILABLE (0) it wins over Range');
    h.extra[KI].statusRangeTankStatus({ fluidLevelFuelTank: 40, range: 412, mileageKilometre: 48215 });
    eq(twin.odometer(h), { km: 48215, src: 'rangeTank' }, 'KombiIF\'s range struct is first');
    h.extra[KI].statusRangeTankStatus({ fluidLevelFuelTank: 40, range: 412, mileageKilometre: 16777215 });
    eq(twin.odometer(h), { km: 48210, src: 'supreme' }, 'its unfilled value (16777215) falls back to the next carrier');
    h.extra[KI].statusRangeTankStatus({ fluidLevelFuelTank: 40, range: 412, mileageKilometre: 0 });
    eq(twin.odometer(h).src, 'supreme', '0 km (not initialised) falls back too');
    h.config.odometer = { factors: { supreme: 0.1 } };
    eq(tok(h, 'odo'), '4' + THIN + '821', 'config.odometer.factors corrects one carrier\'s unit (the one-line fix)');
    ok(h.extra[KI].statusRangeTankStatus && Object.keys(h.extra).indexOf(SUP) >= 0, 'every carrier of the default order is wired');
    const only = mk({ config: { odometer: { order: ['rangeTank'] } } });
    ok(!only.extra[SUP] && !only.extra[VI] && !only.extra[SEC], 'config.odometer.order ["rangeTank"]: the other carriers are not even subscribed');
    const noRl3 = mk({ config: { trip: { order: ['kombi'] } } });
    ok(!noRl3.extra[RL3], 'config.trip.order ["kombi"]: ResetLogic3 is not subscribed');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('5. the log: first arrival per source, UNVERIFIED once, numbers only');
{
    const h = mk();
    h._now_ms = T0 + 2100;
    avg(h, 410, 68, 520, 55);
    const first = h.lines.filter((l) => /^trip average/.test(l));
    eq(first.length, 1, 'the first arrival of statusBordcomputerAverage is one line');
    ok(/^trip average \(statusBordcomputerAverage\) first at 2\.1 s: raw speed1=410 cons1=68 speed2=520 cons2=55 speedUnit=KM_S_H__KM consUnit=VERBRAUCH_IN_L_S_100KM -> speed 41\.0 km\/h, cons 6\.8 l\/100 km \(BC1\) \[UNVERIFIED: compare with the car's trip page\]$/.test(first[0]),
        'it carries the raw numbers, what the page shows and UNVERIFIED (' + first[0] + ')');
    h._now_ms += 5000; avg(h, 412, 68, 520, 55);
    eq(h.lines.filter((l) => /^trip average/.test(l)).length, 1, 'a change within a minute is not logged (a driving average changes every few seconds)');
    h._now_ms += 60000; avg(h, 415, 69, 520, 55);
    const later = h.lines.filter((l) => /^trip average/.test(l));
    ok(later.length === 2 && /#3 at 67\.1 s: raw speed1=415/.test(later[1]) && !/UNVERIFIED/.test(later[1]), 'a minute later the changed value is logged again, as "#n", without UNVERIFIED (' + later[1] + ')');
    h._now_ms += 60000; avg(h, 415, 69, 520, 55);
    eq(h.lines.filter((l) => /^trip average/.test(l)).length, 2, 'an unchanged value is never logged again');
    travel(h, 0, 43, 124); start(h, 14, 0); rl3(h);
    ok(h.lines.some((l) => /^trip travel \(statusBordcomputerTravelData\) first at .* raw hours=0 minutes=43 way=124 -> distance 12\.4 km, time 0:43 \[UNVERIFIED/.test(l)), 'travel: its own first line');
    ok(h.lines.some((l) => /^trip start \(statusBordcomputerTravelStart\) first at .* raw hour=14 minute=0 -> departure 14:00 \[UNVERIFIED/.test(l)), 'start: its own first line');
    ok(h.lines.some((l) => /^trip rl3 \(bcDataAll\) first at .* raw option=STARTOFDRIVING speedAvg=388 consAvgDigit=72 consAvgScale=24 consAvgMax=300 distance=4330 trip=0d1h7m reset=9:5 speedUnit=KILOMETERS consUnit=CONSUMPTION_KM -> speed 38\.8 km\/h, cons 7\.2 l\/100 km, distance 433\.0 km, time 1:07, departure 09:05 \[UNVERIFIED/.test(l)), 'rl3: its own first line with every member that decides a factor');
    h.extra[KI].statusRangeTankStatus({ fluidLevelFuelTank: 40, range: 412, mileageKilometre: 48215 });
    ok(h.lines.some((l) => /^odometer raw \(P3\): 48215 -> 48215 km \(factor 1 km\) \[rangeTank, first at .* s, UNVERIFIED: compare with the cluster's odometer\]$/.test(l)), 'the odometer\'s first line keeps its P3 form and says UNVERIFIED');
    h.extra[SUP].mileageSupreme({ mileageSupreme: 48215, qualifierMileageSupreme: 'EVENT_DATA_AVAILABLE' });
    ok(h.lines.some((l) => /^odometer supreme \(mileageSupreme\) first at .* raw mileage=48215 qualifier=EVENT_DATA_AVAILABLE -> 48215 km \(factor 1 km\) \[UNVERIFIED/.test(l)), 'an alternative carrier: its own first line');
    const v = mk({ config: { trip: { verified: true }, odometer: { verified: true } } });
    avg(v, 410, 68, 520, 55); v.extra[KI].statusRangeTankStatus({ mileageKilometre: 48215 });
    ok(v.lines.length >= 2 && !v.lines.some((l) => /UNVERIFIED/.test(l)), 'verified true: the first lines carry no UNVERIFIED');
    const q = mk();
    for (let i = 0; i < 40; i++) { q._now_ms += 61000; avg(q, 400 + i, 68, 520, 55); }
    const ql = q.lines.filter((l) => /^trip average/.test(l));
    ok(ql.length === 30 && /last raw line for this source/.test(ql[29]), 'at most 30 raw lines per source, the last says so (' + ql.length + ')');
    ok(h.lines.concat(q.lines).every((l) => !/[Ѐ-ӿ]/.test(l)), 'no line holds the page\'s Ukrainian text: numbers, enum names, field names');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('6. the summary: silent sources named, getters asked once');
(async () => {
    {
        const h = mk();
        h._now_ms = T0 + 120000;
        const r = twin.summary(h);
        await r.getters;
        ok(/^trip summary #1 at 120\.0 s: heard nothing; SILENT rangeTank, supreme, range, secure, average, travel, start, rl3$/.test(r.lines[0]), 'nothing arrived: every source is named SILENT (' + r.lines[0] + ')');
        ok(/^trip shows: cons – l\/100 km \[silent\], speed – km\/h \[silent\], distance – km \[silent\], time – \[silent\], departure – \[silent\]; odometer – km \[silent\]; factors bc 1 speed 0\.1 cons 0\.1 way 0\.1; rl3 speed 0\.1 cons 0\.1 way 0\.1 \(UNVERIFIED\), odometer factor 1 \(UNVERIFIED\)$/.test(r.lines[1]),
            'each dash says why: silent (' + r.lines[1] + ')');
        ok(h.lines.some((l) => l === 'trip getter average (KombiIF.statusBordcomputerAverage, silent): no signals.get'), 'without a signals object the getter line says so');
        ok(!h.lines.some((l) => /trip getter range /.test(l)), 'VehicleInformation.Range has no getter: never asked');
    }
    {
        // the car's side: KombiIF up, its trip getters fail; ResetLogic3's provider never came up; MileageSupreme answers
        const h = mk();
        const asked = [];
        const sub = (iface, available, error) => ({ iface, available, error: error || null, proxy: available || error ? { iface } : null });
        h.car.subs = [sub(KI, true), sub(RL3, false), sub(SUP, true), sub(SEC, false, 'no SOME/IP config for x')];
        h.ctx.signals = { get: (p, field) => { asked.push(p.iface.split('.').pop() + '.' + field); return p.iface === SUP ? Promise.resolve({ mileageSupreme: 48215, qualifierMileageSupreme: 0 }) : Promise.reject(new Error('timeout')); } };
        h.extra[KI].statusRangeTankStatus({ fluidLevelFuelTank: 40, range: 412, mileageKilometre: 16777215 });
        h._now_ms = T0 + 120000;
        const r = twin.summary(h);
        const got = await r.getters;
        eq(asked.sort(), ['KombiIF.statusBordcomputerAverage', 'KombiIF.statusBordcomputerTravelData', 'KombiIF.statusBordcomputerTravelStart', 'MileageSupreme.mileageSupreme'],
            'each silent source with a getter on an available provider is asked once, read only (' + asked.length + ' getters)');
        ok(h.lines.some((l) => l === 'trip getter average (KombiIF.statusBordcomputerAverage, silent): error or no answer: timeout (the car does not send it)'), 'a failing getter: "the car does not send it"');
        ok(h.lines.some((l) => /^trip getter rl3 \(ResetLogic3\.bcDataAll, silent\): provider not available/.test(l)), 'a provider that never came up: said so, nothing asked');
        ok(h.lines.some((l) => /^trip getter secure \(SecureMileage\.mileage, silent\): watch error: no SOME\/IP config/.test(l)), 'a watch that failed (an undeclared interface): its error');
        ok(h.lines.some((l) => /^trip getter supreme .*answered \(object\): the notifier is silent, the getter is not$/.test(l)), 'a getter that answers: said so ...');
        eq(twin.odometer(h), { km: 48215, src: 'supreme' }, '... and its answer is used like a notification (the odometer now shows)');
        ok(r.lines[1].indexOf('odometer – km [invalid]') >= 0, 'the summary line itself, written before the answer: the odometer dash is "invalid" (rangeTank spoke with its marker)');
        ok(Array.isArray(got) && got.length === 6, 'the getter promise resolves with one outcome per silent source that has a getter (' + (got && got.length) + ')');
    }
    {
        const h = mk();
        avg(h, 410, 68, 520, 55); travel(h, 0, 43, 124); start(h, 14, 0);
        h.extra[KI].statusRangeTankStatus({ mileageKilometre: 48215 });
        h._now_ms = T0 + 120000;
        const r = twin.summary(h);
        await r.getters;
        ok(/heard rangeTank \(#1, first 0\.0 s\), average \(#1, first 0\.0 s\), travel \(#1, first 0\.0 s\), start \(#1, first 0\.0 s\); SILENT supreme, range, secure, rl3$/.test(r.lines[0]), 'the heard sources with their count and first time, the rest SILENT');
        ok(/^trip shows: cons 6\.8 l\/100 km \[kombi\], speed 41 km\/h \[kombi\], distance 12\.4 km \[kombi\], time 0:43 \[kombi\], departure 14:00 \[kombi\]; odometer 48215 km \[rangeTank\]/.test(r.lines[1]), 'every value with its source');
        ok(r.lines.some((l) => /^trip check \[kombi\]: distance \/ time = 17\.3 km\/h, average speed 41\.0 km\/h, ratio 2\.37 -> consistent/.test(l)), 'the cross-check: distance / time against the average speed');
        avg(h, 4100, 68, 520, 55);
        const r2 = twin.summary(h);
        ok(r2.lines.some((l) => /^trip check: OUT OF RANGE speed 410 /.test(l)) && r2.lines.some((l) => /ratio 23\.70 -> a factor is about 10x off/.test(l)), 'an implausible speed: OUT OF RANGE and the ratio says "10x off"');
        ok(/^trip summary #2/.test(r2.lines[0]), 'the summaries are numbered');
        rl3(h, { counterDistance: 43300 });
        ok(twin.summary(h).lines.some((l) => /^trip check \[rl3\]: distance \/ time = 3877\.6 km\/h, average speed 38\.8 km\/h, ratio 0\.01 -> a factor is about 10x off/.test(l)), 'each source is checked on its own: rl3 in metres read as 0.1 km is caught without the iDrive page');
        avg(h, 4095, 4095, 4095, 4095);
        h.config.trip = { order: ['kombi'] };
        ok(twin.summary(h).lines[1].indexOf('speed – km/h [invalid]') >= 0, 'a source that spoke only its marker: "invalid", not "silent"');
        h.config.trip = { factors: false };
        ok(twin.summary(h).lines[1].indexOf('[factors off]') >= 0, 'factors false: "factors off"');
    }
    {
        // the timers: wire() schedules the summaries at config.trip.summaryMs
        const lines = [];
        const h = H.fakeHud(HudApp, { log: { info: (s) => lines.push(s), warn: (s) => lines.push('WARN ' + s), error: (s) => lines.push('ERR ' + s) } });
        h.config.trip = { summaryMs: [30, 60] };
        h.td = twin.fresh();
        twin.wire(h, {});
        await new Promise((res) => setTimeout(res, 120));
        eq(lines.filter((l) => /^trip summary #/.test(l)).length, 2, 'config.trip.summaryMs [30, 60]: two summaries, on their own');
        eq(APP.config.trip.summaryMs, [120000, 600000], 'the shipped build: after 2 and after 10 minutes');
        ok(!lines.some((l) => /^WARN|^ERR/.test(l)), 'no warning on the way');
    }

    // -----------------------------------------------------------------------------------------------------------------
    console.log('7. the shipped app.json and the source');
    {
        const sig = APP.signals;
        const need = Object.keys(twin.SOURCES).map((k) => twin.SOURCES[k]);
        const missing = need.filter((s) => !(sig[s[0]] && sig[s[0]][s[1]]));
        eq(missing, [], 'every source the wiring watches is declared in app.json "signals" (else the watch fails with "no SOME/IP config")');
        ok(need.every((s) => /^(rs|s|r)$/.test(sig[s[0]][s[1]]) && (sig[s[0]][s[1]].indexOf('r') >= 0) === s[2]), 'their flags are read only, and "r" exactly where the source table says it has a getter');
        const src = fs.readFileSync(path.join(H.ROOT, 'shared', 'twin_tokens.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        ok(!/\?\.|\?\?|\*\*/.test(src), 'shared/twin_tokens.js: no ?. / ?? / ** (the car runs Node 8.16)');
        ok(!/\.(set|call|setValue|callMethod)\(/.test(src.replace(/\.call\(h,/g, '')), 'shared/twin_tokens.js: no setter, no method call; the only car access is signals.get');
    }

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
