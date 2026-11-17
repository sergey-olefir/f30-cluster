'use strict';
/**
 * test-twin-pages.js - Twin Dial's centre pages and tokens (package C, round 2; docs/twin-dial/SPEC.md 5, 6, 11, 12).
 *
 *   node bench/test-twin-pages.js
 *
 * No bench, no car: the real engine (shared/hud.js, required from a temp tree: bench/twin-harness.js) with a HudApp whose
 * only inputs are the fields the tokens read, and the chained signal handlers of shared/twin_tokens.js wire(). It checks
 *   1. the page: clock | trip | cycle (10 s per page while the car stands, held above 5 km/h, the dwell starts at the stop);
 *      only the showing page's texts are non-empty, so a page change is a repaint of text boxes;
 *   2. the "-" fallbacks: no clock, no trip factors (P4), no odometer (P3), no range, no outside temperature, no speed;
 *   3. the values: local time and date from the car's zone, the weekday in Ukrainian, the odometer with a thin space, the
 *      trip page from the car's raw fields and config.trip.factors, the temperature's sign and one decimal;
 *   4. the hub: READY only at VehicleCondition 10, the drive programme's Latin labels, the gear, the speed;
 *   5. the wiring: the handlers run AFTER the engine's own and read the odometer, the trip fields, the units, the call and
 *      guidance states and the media text's LENGTH; nothing logged holds a text;
 *   6. the engine's hooks: {{td:...}} reaches shared/twin_tokens.js through HudApp._token, and nothing else changes;
 *   7. the live icons (the tab bar): colour by state, repainted only when it changed (and after a night change).
 * Node 8 or newer. Never shipped.
 */
const path = require('path');
const H = require('./twin-harness');

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const eq = (a, b, what) => { const k = JSON.stringify(a) === JSON.stringify(b); ok(k, what + (k ? '' : ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')')); };

const dir = H.tree('twin_dial');
const HudApp = require(path.join(dir, 'hud.js'));
const twin = require(path.join(dir, 'twin_tokens.js'));
const fs = require('fs');
const L = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'apps', 'twin_dial', 'hud', 'layouts', 'twin.json'), 'utf8'));
const DASH = '–', THIN = ' ';

// 2026-11-17 12:43 UTC, a Tuesday; the car's zone UTC+2 (the 15-minute steps: 120)
const T0 = Date.UTC(2026, 10, 17, 12, 43, 20);
const tok = (h, name) => h._token('td:' + name);
function mk(over) {
    const h = H.fakeHud(HudApp, over);
    h.td = twin.fresh(); h.td.clock = () => h._now_ms;
    h._now_ms = T0; h.tzCar = 120;
    h._d = { speed: 0, rpm: 0, condition: undefined, stage: 'P', gear: 0 };
    return h;
}
const FACTORS = { bc: 1, speed: 0.1, cons: 0.1, way: 0.1 };

// ---------------------------------------------------------------------------------------------------------------------
console.log('the hooks into the engine');
{
    const h = mk();
    h._d = {};
    ok(HudApp.prototype._token.call(h, 'td:cTitle') === twin.TITLES.clock && tok(h, 'cTitle') === 'Дата і час', '{{td:...}} reaches shared/twin_tokens.js through HudApp._token');
    eq(h._resolve('{{td:cTitle}} {{td:speed}}'), 'Дата і час ' + DASH, 'a text widget\'s template resolves it');
    ok(tok(h, 'nonesuch') === '{{td:nonesuch}}', 'an unknown {{td:...}} comes back as itself, as every unknown token does');
    h.tzCar = null;
    ok(HudApp.prototype._token.call(h, 'speed') === '--' && HudApp.prototype._token.call(h, 'gear') === '', 'the engine\'s own tokens are unchanged (speed with no value "--", gear "")');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('the centre page: clock | trip | cycle');
{
    const h = mk({ settings: { centre: 'clock' } });
    h._now_ms = T0;
    eq(twin.page(h), 'clock', 'centre = clock shows the clock page');
    h._settings.centre = 'trip';
    eq(twin.page(h), 'trip', 'centre = trip shows the trip page');
    ok(tok(h, 'cTitle') === 'Поїздка' && tok(h, 'cTime') === '' && tok(h, 'cWeekday') === '' && tok(h, 'cDate') === '', 'on the trip page the clock page\'s texts are empty (a repaint, no rebuild)');
    h._settings.centre = 'clock';
    ok(tok(h, 'tConsAvg') === '' && tok(h, 'tSpeedAvg') === '' && tok(h, 'tDist') === '' && tok(h, 'tTime') === '' && tok(h, 'tFrom') === '' && tok(h, 'tConsU') === '' && tok(h, 'tDistU') === '', 'on the clock page the trip page\'s texts and units are empty');
}
{
    // cycle: 10 s per page while the car stands
    const h = mk({ settings: { centre: 'cycle' } });
    h.config.twin = {};                      // the SPEC's own numbers are the defaults: 10 s, 5 km/h
    h._d.speed = 0;
    const at = (ms) => { h._now_ms = T0 + ms; return twin.page(h); };
    eq([at(0), at(4000), at(9800)], ['clock', 'clock', 'clock'], 'cycle: the clock page for its first 10 s');
    eq([at(10050), at(15000), at(19800)], ['trip', 'trip', 'trip'], 'cycle: then the trip page for 10 s');
    eq([at(20100), at(30200)], ['clock', 'trip'], 'cycle: and on, 10 s each');
    // moving: no change above 5 km/h, and the dwell starts at the stop
    const g = mk({ settings: { centre: 'cycle' } });
    g.config.twin = {};
    const at2 = (ms, v) => { g._now_ms = T0 + ms; g._d.speed = v; return twin.page(g); };
    at2(0, 0);
    eq(at2(10050, 0), 'trip', 'standing: the page changed after 10 s');
    eq([at2(11000, 40), at2(30000, 40), at2(60000, 90), at2(120000, 5.5), at2(124900, 5.5)], ['trip', 'trip', 'trip', 'trip', 'trip'], 'above 5 km/h the page is held (for two minutes of driving)');
    eq(at2(125000, 0), 'trip', 'stopped: the dwell starts at the stop, not at the last page change');
    eq(at2(134000, 0), 'trip', '... still the same page 9 s after the stop');
    eq(at2(135400, 0), 'clock', '... and 10 s after the stop it changes');
    eq(at2(135500, 4.9), 'clock', '4.9 km/h counts as standing');
    // a signal that is missing counts as standing
    const m = mk({ settings: { centre: 'cycle' } });
    m._d = {};
    m._now_ms = T0; twin.page(m); m._now_ms = T0 + 10100;
    eq(twin.page(m), 'trip', 'no speed value counts as standing');
    // every widget of one tick sees one page: the page is decided at most every 250 ms
    const k = mk({ settings: { centre: 'cycle' } });
    k._now_ms = T0; twin.page(k);
    k._now_ms = T0 + 10020; const p1 = twin.page(k);
    k._now_ms = T0 + 10030; const p2 = twin.page(k);
    ok(p1 === p2, 'two widgets of one tick (30 ms apart) see the same page');
    // the layout: both pages' texts exist all the time, in page order (the clock page first)
    const ids = L.widgets.map((w) => w.id);
    ok(ids.indexOf('c_time') < ids.indexOf('t1_a'), 'the layout carries both pages\' texts; the clock page\'s come first (the planner\'s sheet order)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('the clock page');
{
    const h = mk({ settings: { centre: 'clock' } });
    eq([tok(h, 'cTime'), tok(h, 'cWeekday'), tok(h, 'cDate')], ['14:43', 'вівторок', '17.11.2026'], 'UTC 12:43 on 17 Nov 2026 in the car\'s zone UTC+2: 14:43, "вівторок", 17.11.2026');
    h.tzCar = 600;                                  // 22:43 the same day
    eq([tok(h, 'cTime'), tok(h, 'cWeekday')], ['22:43', 'вівторок'], 'UTC+10: 22:43, still Tuesday');
    h.tzCar = 660;                                  // 23:43
    h._now_ms = Date.UTC(2026, 10, 17, 13, 30);
    eq([tok(h, 'cTime'), tok(h, 'cDate'), tok(h, 'cWeekday')], ['00:30', '18.11.2026', 'середа'], 'the zone moves the DATE too: 00:30 on 18.11.2026 is a Wednesday');
    h.tzCar = -300; h._now_ms = Date.UTC(2026, 0, 1, 3, 5);
    eq([tok(h, 'cTime'), tok(h, 'cDate'), tok(h, 'cWeekday')], ['22:05', '31.12.2025', 'середа'], 'UTC-5 across New Year: 22:05 on 31.12.2025');
    h.tzCar = null;
    eq([tok(h, 'cTime'), tok(h, 'cWeekday'), tok(h, 'cDate')], [DASH + DASH + ':' + DASH + DASH, '', ''], 'no time zone known: "––:––", no weekday, no date (the head unit runs on UTC, so no guess)');
    h.tzCar = null; h.tzLocal = 60; h._now_ms = T0;
    eq(tok(h, 'cTime'), '13:43', 'the cluster\'s shown time as the zone\'s fallback (config.clockLocal): UTC+1');
    const days = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'];
    h.tzCar = 0; const got = [];
    for (let d = 15; d <= 21; d++) { h._now_ms = Date.UTC(2026, 10, d, 12, 0); got.push(tok(h, 'cWeekday')); }
    eq(got, days, 'a week of weekdays, Sunday 15 Nov to Saturday 21 Nov, in Ukrainian lower case (the apostrophe is U+02BC)');
    ok(tok(h, 'clock') === '12:00', 'the bottom row\'s clock is the same local time');
    eq(twin.local(h).wd, 6, 'the weekday is computed from the local date');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('the trip page: dashes until P4, then the car\'s raw fields through config.trip.factors');
{
    const h = mk({ settings: { centre: 'trip' } });
    eq([tok(h, 'tConsAvg'), tok(h, 'tSpeedAvg'), tok(h, 'tDist'), tok(h, 'tTime')], ['ø ' + DASH, 'ø ' + DASH, DASH, DASH], 'no factors (P4 not done): every value is a dash');
    eq(tok(h, 'tFrom'), 'від початку поїздки, ' + DASH, '... and the departure too');
    eq([tok(h, 'tConsU'), tok(h, 'tSpeedU'), tok(h, 'tDistU'), tok(h, 'tTimeU')], ['л/100 км', 'км/год', 'км', 'год'], 'the units are shown all the same (the owner sees what is missing)');
    // the car's raw fields arrive; still no factors
    const extra = {};
    twin.wire(h, extra);
    const KI = 'de.bmw.infotainment.KombiIF';
    extra[KI].statusBordcomputerAverage({ speedAverage1BC1: 410, consumptionAverage1BC1: 68, speedAverage2BC2: 520, consumptionAverage2BC2: 55, statusUnitOfMeasurementSpeedBC: 1 });
    extra[KI].statusBordcomputerTravelData({ rideDurationHours: 0, rideDurationMinutes: 43, wayPassed: 124 });
    extra[KI].statusBordcomputerTravelStart({ hourDepartureBC: 14, minuteDepartureBC: 0 });
    eq(tok(h, 'tDist'), DASH, 'the fields arrive but with no factors the page still shows dashes (no guessing)');
    h.config.trip = { factors: FACTORS };
    eq([tok(h, 'tConsAvg'), tok(h, 'tSpeedAvg'), tok(h, 'tDist'), tok(h, 'tTime'), tok(h, 'tFrom')],
        ['ø 6.8', 'ø 41', '12.4', '0:43', 'від початку поїздки, 14:00'], 'factors 0.1 / 0.1 / 0.1: "ø 6.8", "ø 41", "12.4", "0:43", "від початку поїздки, 14:00"');
    h.config.trip = { factors: Object.assign({}, FACTORS, { bc: 2 }) };
    eq([tok(h, 'tConsAvg'), tok(h, 'tSpeedAvg')], ['ø 5.5', 'ø 52'], 'config.trip.factors.bc = 2 picks the second trip computer');
    h.config.trip = { factors: FACTORS };
    extra[KI].statusBordcomputerAverage({ speedAverage1BC1: 4095, consumptionAverage1BC1: 4095, speedAverage2BC2: 4095, consumptionAverage2BC2: 4095 });
    extra[KI].statusBordcomputerTravelData({ rideDurationHours: 4095, rideDurationMinutes: 255, wayPassed: 65535 });
    extra[KI].statusBordcomputerTravelStart({ hourDepartureBC: 255, minuteDepartureBC: 255 });
    eq([tok(h, 'tConsAvg'), tok(h, 'tSpeedAvg'), tok(h, 'tDist'), tok(h, 'tTime'), tok(h, 'tFrom')], ['ø ' + DASH, 'ø ' + DASH, DASH, DASH, 'від початку поїздки, ' + DASH], 'the car\'s "unfilled" values (4095, 65535, 255) are dashes');
    extra[KI].statusBordcomputerTravelData({ rideDurationHours: 12, rideDurationMinutes: 5, wayPassed: 1234 });
    eq([tok(h, 'tTime'), tok(h, 'tDist')], ['12:05', '123.4'], 'duration "12:05" (the hour is not padded, the minutes are), a distance with one decimal');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('the bottom row, the tab bar and the hubs');
{
    const h = mk();
    eq([tok(h, 'odo'), tok(h, 'r1'), tok(h, 'ambient'), tok(h, 'rangeTab')], [DASH, DASH, DASH, DASH], 'no data: every value is a dash');
    h.rangeKm = 412; h.ambient = 7.5;
    eq([tok(h, 'r1'), tok(h, 'rangeTab'), tok(h, 'ambient')], ['412', '412', '+7.5'], 'the range (arrives) stands in R1 until the trip distance is proven; the temperature "+7.5"');
    h.ambient = -3.54; eq(tok(h, 'ambient'), '-3.5', 'a negative temperature: "-3.5"');
    h.ambient = 0; eq(tok(h, 'ambient'), '+0.0', 'zero: the sign is always shown, "+0.0"');
    h.ambient = 24.25; eq(tok(h, 'ambient'), '+24.3', 'one decimal ("+24.3")');
    h.td.mileage = 48215;
    eq(tok(h, 'odo'), '48' + THIN + '215', 'the odometer with a thin space as the thousands separator');
    h.td.mileage = 999; eq(tok(h, 'odo'), '999', 'under a thousand: no separator');
    h.td.mileage = 1234567; eq(tok(h, 'odo'), '1' + THIN + '234' + THIN + '567', 'a million: two separators');
    h.td.mileage = null; eq(tok(h, 'odo'), DASH, 'an invalid odometer is a dash');
    // trip distance in R1 once the field is proven
    h.config.trip = { factors: FACTORS }; h.td.travel = { hours: 0, minutes: 43, way: 4126 };
    eq(tok(h, 'r1'), '412.6', 'R1 is the trip distance "412.6" once P4 has proven the field');
}
{
    const h = mk();
    h._d = {};
    eq([tok(h, 'ready'), tok(h, 'program'), tok(h, 'gear'), tok(h, 'speed')], ['', '', DASH, DASH], 'no data: READY absent, no programme, the gear and the speed are dashes');
    h._d.condition = 10; eq(tok(h, 'ready'), 'READY', 'VehicleCondition 10 (drive-ready): READY');
    [5, 8, 7, 12, 1].forEach((c) => { h._d.condition = c; ok(tok(h, 'ready') === '', 'VehicleCondition ' + c + ': no READY'); });
    h._d.condition = undefined; h.car.live = { condition: 10 };
    eq(tok(h, 'ready'), '', 'the engine\'s data decides (the demo drive has no condition: no READY)');
    const prog = [[null, null, ''], ['comfort', null, 'COMFORT'], ['sport', null, 'SPORT'], ['sport', 'plus', 'SPORT+'], ['eco', null, 'ECO PRO'], ['comfort', 'individual', 'ADAPTIVE']];
    prog.forEach((p) => { h.driveMode = p[0]; h.driveVariant = p[1]; ok(tok(h, 'program') === p[2], 'drive programme ' + JSON.stringify(p.slice(0, 2)) + ' -> "' + p[2] + '" (our own Latin label)'); });
    [['P', 0, 'P'], ['R', -1, 'R'], ['N', 0, 'N'], ['D', 3, 'D3'], ['D', 0, 'D'], [undefined, undefined, DASH]].forEach((g) => {
        h._d.stage = g[0]; h._d.gear = g[1];
        ok(tok(h, 'gear') === g[2], 'gear stage ' + g[0] + ' gear ' + g[1] + ' -> "' + g[2] + '"');
    });
    h._d.speed = 87.4; eq(tok(h, 'speed'), '87', 'speed 87.4 km/h -> "87"');
    h._d.speed = 0.2; eq(tok(h, 'speed'), '0', 'speed 0.2 -> "0"');
}
{
    // the media text: icon only until P8 (config.twin.media), and long text is cut with an ellipsis
    const h = mk();
    const extra = {}; twin.wire(h, extra);
    const MEDIA = 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState';
    extra[MEDIA].playerMetadata({ firstLineText: 'Artist Name', secondLineText: 'A Very Long Song Title Indeed' });
    eq(tok(h, 'media'), '', 'the media cell is icon only (no text) until config.twin.media is switched on after P8');
    h.config.twin.media = true;
    extra[MEDIA].playerMetadata({ firstLineText: 'Artist Name', secondLineText: 'Short' });
    eq(tok(h, 'media'), 'Short', 'with P8 done, the second line (the title) shows');
    extra[MEDIA].playerMetadata({ firstLineText: 'Artist Name', secondLineText: 'A Very Long Song Title Indeed' });
    ok(tok(h, 'media').length <= 15 && /…$/.test(tok(h, 'media')), 'a long title is cut with an ellipsis (' + tok(h, 'media').length + ' characters)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('the extra signals: chained behind the engine\'s own handlers, numbers and lengths only in the log');
{
    const lines = [];
    const log = { info: (s) => lines.push(s), warn: (s) => lines.push('WARN ' + s), error: (s) => lines.push('ERR ' + s) };
    const h = mk({ log });
    const KI = 'de.bmw.infotainment.KombiIF', order = [];
    const extra = { [KI]: { statusRangeTankStatus: () => order.push('engine') } };
    twin.wire(h, extra);
    extra[KI].statusRangeTankStatus({ fluidLevelFuelTank: 40, range: 412, mileageKilometre: 48215, statusFluidLevelFuelTankSpare: 'NICHT_AKTIV' });
    eq(order, ['engine'], 'the engine\'s own handler on the field still runs (and first)');
    eq(h.td.mileage, 48215, 'the odometer (P3) is read from the same struct');
    extra[KI].statusRangeTankStatus({ mileageKilometre: 16777215 });
    eq(h.td.mileage, null, 'the unfilled odometer (16777215) is no value');
    extra[KI].statusRangeTankStatus({});
    eq(h.td.mileage, null, 'a struct without the member is no value, and no throw');
    ok(lines.some((l) => /^odometer raw \(P3\): 48215 -> 48215 km/.test(l)), 'the first raw odometer is logged once, as a number');
    const n = lines.length;
    extra[KI].statusRangeTankStatus({ mileageKilometre: 48215 });
    extra[KI].statusRangeTankStatus({ mileageKilometre: 48215 });
    ok(lines.slice(n).filter((l) => /odometer raw/.test(l)).length === 1, 'an unchanged raw value is not logged again');
    extra['de.bmw.infrastructure.EnvironmentalInformation'].UnitBN2020({ unitOfMeasurementMileage: 'KILOMETER' });
    ok(lines.some((l) => /units raw \(P5\)/.test(l)), 'the units (P5) are logged once, km kept');
    const PH = 'de.bmw.infotainment.connectivity.telephony.ConnectivityAggregator', NV = 'de.bmw.infotainment.navigation.navigationstatus.NavigationStatus';
    extra[PH].aggregatedCallState('DISCONNECTED'); eq(h.td.call, false, 'phone DISCONNECTED: not in a call');
    extra[PH].aggregatedCallState('ACTIVE'); eq(h.td.call, true, 'phone ACTIVE: in a call');
    extra[PH].aggregatedCallState(0); eq(h.td.call, false, 'phone 0: not in a call (a number works too)');
    extra[NV].guidingState('ACTIVE'); eq(h.td.nav, true, 'guidance ACTIVE: lit');
    extra[NV].guidingState(0); eq(h.td.nav, false, 'guidance INACTIVE (0): dim');
    extra[NV].guidingState(2); eq(h.td.nav, true, 'guidance 2: lit');
    const SECRET = 'Secret Artist Name', SECRET2 = 'Secret Song Title';
    extra['de.bmw.infotainment.hmi.hmimediastate.HmiMediaState'].playerMetadata({ firstLineText: SECRET, secondLineText: SECRET2 });
    extra[KI].statusBordcomputerTravelStart({ hourDepartureBC: 14, minuteDepartureBC: 0 });
    ok(lines.some((l) => /media text \(P8\): first line 18 characters, second 17 characters/.test(l)), 'the media text is logged as two LENGTHS');
    ok(!lines.some((l) => l.indexOf(SECRET) >= 0 || l.indexOf(SECRET2) >= 0), 'no media text in any log line');
    extra[KI].statusRangeTankStatus(null);
    extra[PH].aggregatedCallState(undefined);
    ok(!lines.some((l) => /^WARN|^ERR/.test(l)), 'a null or undefined value throws nothing and warns nothing (' + lines.filter((l) => /^WARN|^ERR/.test(l)).length + ' warnings)');
    extra[KI].statusRangeTankStatus({ get mileageKilometre() { throw new Error('boom'); } });
    ok(lines.some((l) => /^WARN twin: statusRangeTankStatus: boom/.test(l)), 'a handler that throws is caught and logged as a warning (it must not stop the car\'s data)');
    ok(/^(odometer|fuel reserve|units|trip|phone|media|WARN)/.test(lines[0]) && lines.every((l) => !/[Ѐ-ӿ]/.test(l)), 'every line is a number or an enum (no text of the car)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('the tab bar\'s live icons');
{
    const h = mk();
    h.theme = { fg: [255, 255, 255, 255], grey: [111, 111, 110, 255], bg: [0, 0, 0, 255] };
    const painted = [];
    h._blitDiff = (x, buf) => painted.push(buf.length);
    const W = (id) => L.widgets.find((w) => w.id === id);
    const mkx = (id) => ({ w: W(id), last: null });
    const phone = mkx('tab_phone_i'), nav = mkx('tab_nav_i'), warn = mkx('tab_warn_i');
    eq([twin.iconState(h, phone.w).role, twin.iconState(h, nav.w).role, twin.iconState(h, warn.w).role], ['grey', 'grey', 'fg'], 'phone and navigation are dim without a call or a route, the warning icon is white');
    h.td.call = true; h.td.nav = true; h.twinCc = { state: 'ours', severity: 'amber' };
    eq([twin.iconState(h, phone.w).role, twin.iconState(h, nav.w).role, twin.iconState(h, warn.w).role], ['fg', 'fg', 'bg'], 'a call and a route light them; the warning icon is black on the amber cell');
    h.twinCc = { state: 'ours', severity: 'red' };
    eq(twin.iconState(h, warn.w).role, 'fg', 'white on red');
    // repaint only when something changed
    twin.updateIcon(h, nav, 0, false); twin.updateIcon(h, nav, 50, false);
    eq(painted.length, 1, 'an unchanged icon is not painted again');
    h.td.nav = false; twin.updateIcon(h, nav, 100, false);
    eq(painted.length, 2, 'a changed state repaints it');
    h.theme = { fg: [231, 231, 231, 255], grey: [61, 61, 61, 255], bg: [0, 0, 0, 255] };     // night
    twin.updateIcon(h, nav, 150, false);
    eq(painted.length, 3, 'a night change (new theme colours) repaints it');
    eq(painted[0], 38 * 38 * 4, 'the pixels are the 38 x 38 RGBA of the widget');
    // the engine's own icon path is not taken for a widget with no tdLive, and _nightLive counts a live icon as live
    ok(L.widgets.filter((w) => w.type === 'icon').every((w) => w.tdLive), 'every icon of the layout is live (repainted by twin_tokens.js, so a night change needs no rebuild)');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
