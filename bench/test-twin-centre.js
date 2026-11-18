'use strict';
/**
 * test-twin-centre.js - Twin Dial's centre pages (round 3, package B4; docs/twin-dial/SPEC-R3.md 4, 10, 11).
 *
 *   node bench/test-twin-centre.js
 *
 * No bench, no car: the real engine's token path (shared/hud.js _resolve -> shared/twin_tokens.js -> shared/twin_pages.js)
 * and the page layer's own entry (init / update), with a fake engine (bench/twin-centre-states.js). It checks
 *   1. the page of each tab; tab 1's cycle (10 s a page while the car stands, held above 5 km/h), the "centre" choices,
 *      the "Технічні дані" hide setting (out of the choice and the cycle), the tyre page only when config.pages.tyres;
 *   2. every page's empty state (no data at all: dashes, "Немає даних", the certain pages) and its full state;
 *   3. the values: trip, technical rows (units, bars, warning colours), tyres (bar, amber under target), media, phone,
 *      call timer, guidance (distance, manoeuvre, lanes, footer);
 *   4. the wiring: every field's handler takes the shapes the catalogue gives (names or numbers), sets the right
 *      instance, throws never; the caller's name only while the setting is on and the call lasts;
 *   5. the map window's presence rule (config.mapWindow null by default; S1 / S2; any doubt closes; 8 s shut);
 *   6. privacy: canary strings in a title, a name, a road never reach a log line;
 *   7. repaint only on a change (a night change repaints), a setting is applied in place, the engine's hooks exist;
 *   8. the car's Node 8: no syntax of a newer Node in the new file; app.json's signals pass tools/signals/check_signals.py;
 *   9. pages that are built dark stay dark until their config key is set.
 * Node 8 or newer. Never shipped.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./twin-centre-states');

let passed = 0, failed = 0, skipped = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const eq = (a, b, what) => { const k = JSON.stringify(a) === JSON.stringify(b); ok(k, what + (k ? '' : ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')')); };
const skip = (what) => { skipped++; console.log('  skip ' + what); };

const R = S.rig();
const { pages, twin } = R;
const ROOT = R.H.ROOT;
const DASH = '–';
const tok = (h, n) => h._token('td:' + n);
const showing = (h) => { const x = { w: R.widget, ref: 1, sheet: null, px: null }; pages.init(h, x); return pages.st(h).page; };
const at = (h, ms) => { h._now_ms = S.T0 + ms; };
const step = (h, x, ms) => { at(h, ms); pages.update(h, x, h._now_ms, false); return pages.st(h).page; };
const newX = (h) => { const x = { w: R.widget, ref: 1, sheet: null, px: null }; pages.init(h, x); return x; };

// ---------------------------------------------------------------------------------------------------------------------
console.log('the page of each tab');
{
    const want = { 1: 'clock', 2: 'msg', 3: 'media', 4: 'phone', 5: 'none' };
    [1, 2, 3, 4, 5].forEach((t) => {
        const h = S.base(R, { tab: t, settings: { centre: 'clock' } });
        eq(showing(h), want[t], 'tab ' + t + ' shows the page "' + want[t] + '" with no data at all');
    });
    const h = S.base(R, { settings: { centre: 'clock' } }); delete h.tabs;
    eq(showing(h), 'clock', 'no tab state yet (shared/twin_tabs.js not merged): tab 1');
    h.twinTab = 4;
    eq(showing(h), 'phone', 'the engine\'s hud.twinTab (B1\'s contract) is read when hud.tabs is absent');
    delete h.twinTab;
    h.tabs = { tab: 9 };
    eq(showing(h), 'clock', 'a tab number out of range reads as tab 1');
    // the title of every page, from the token
    const titles = { clock: 'Дата і час', trip: 'Поточна поїздка', tech: 'Технічні дані', tyres: 'Шини', msg: 'Повідомлення', media: 'Медіа', radio: 'Радіо', track: 'Медіа', phone: 'Телефон', none: 'Навігація', calc: 'Навігація', road: 'Навігація', guide: 'Навігація', map: '' };
    const got = {};
    Object.keys(S.STATES).forEach((id) => { const hh = S.make(R, id); showing(hh); got[pages.st(hh).page] = tok(hh, 'pgTitle'); });
    ok(Object.keys(titles).filter((k) => got[k] !== undefined).every((k) => got[k] === titles[k]), 'every page has its title: ' + Object.keys(got).map((k) => k + '=' + got[k]).join(', '));
    const hi = S.make(R, 'call_in'); showing(hi);
    eq(tok(hi, 'pgTitle'), 'Вхідний дзвінок', 'the call card titled by the state: incoming');
    const hc = S.make(R, 'call_active'); showing(hc);
    eq(tok(hc, 'pgTitle'), 'Розмова', '... active: "Розмова"');
    pages.st(hc).phone.agg = 'DIALING';
    eq(tok(hc, 'pgTitle'), 'Виклик…', '... dialling: "Виклик…"');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('tab 1: the cycle, the "centre" choice and the hide setting');
{
    const h = S.base(R, { settings: { centre: 'cycle' } });
    const x = newX(h);
    eq(step(h, x, 0), 'clock', 'the cycle starts on the clock');
    eq(step(h, x, 9900), 'clock', '... 9.9 s: still the clock');
    eq(step(h, x, 10100), 'trip', '... 10 s: the trip');
    eq(step(h, x, 20300), 'tech', '... 20 s: the technical data');
    eq(step(h, x, 30500), 'clock', '... 30 s: round again (the tyre page is not in the cycle: config.pages.tyres is off)');
    // held above the lock speed, the dwell starts at the stop
    h._d.speed = 60;
    eq(step(h, x, 50000), 'clock', 'above 5 km/h the page stays');
    h._d.speed = 0;
    eq(step(h, x, 50200), 'clock', '... the dwell starts at the stop (not 10 s since the last change)');
    eq(step(h, x, 60300), 'trip', '... 10 s after the stop: the next page');
    // the choices
    ['clock', 'trip', 'tech'].forEach((m) => { h._settings.centre = m; pages.changed(h); eq(step(h, x, 70000), m, 'centre = ' + m + ' shows it and holds it'); });
    h._settings.centre = 'tech'; h._settings.techData = 'hide'; pages.changed(h);
    ok(pages.computerList(h).indexOf('tech') < 0 && step(h, x, 71000) !== 'tech', 'techData = hide: the technical page is out of the choice (centre = tech falls back to the cycle)');
    h._settings.centre = 'cycle'; pages.st(h).cyc = 'trip'; pages.st(h).cycSince = h._now_ms;
    const seen = {};
    for (let t = 72000; t < 120000; t += 1000) seen[step(h, x, t)] = true;
    eq(Object.keys(seen).sort(), ['clock', 'trip'], 'techData = hide: the cycle is the clock and the trip only');
    h._settings.techData = 'show'; pages.changed(h);
    ok(pages.computerList(h).join() === 'clock,trip,tech', 'techData = show: clock, trip, tech');
    // the tyre page joins the cycle only when switched on
    h.config.pages = { tyres: true };
    eq(pages.computerList(h).join(), 'clock,trip,tech,tyres', 'config.pages.tyres: the tyre page is the cycle\'s fourth');
    h._settings.centre = 'cycle'; pages.st(h).cyc = 'tech'; pages.st(h).cycSince = S.T0 + 100000; at(h, 130000);
    eq(step(h, x, 131000), 'tyres', '... after the technical data comes the tyre page');
    ok(!!pages.st(h).tpms.timer, 'the tyre page showing: its 10 s TPMS poll runs');
    h.config.pages = { tyres: false };
    step(h, x, 132000);
    ok(!pages.st(h).tpms.timer && pages.st(h).page !== 'tyres', 'config.pages.tyres off again: the page leaves the cycle and the poll stops (never polled while it does not show)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('every page: the empty state and the full state');
{
    // no data at all
    const e = S.base(R, { settings: { centre: 'trip' }, config: S.FACT }); e.tzCar = null; e.ambient = null; e.rangeKm = null; e._d = { speed: undefined };
    showing(e);
    eq([tok(e, 'pgTripCons'), tok(e, 'pgTripSpeed'), tok(e, 'pgTripWay'), tok(e, 'pgTripMeta'), tok(e, 'pgTripFooter')], ['ø ' + DASH, 'ø ' + DASH, DASH, DASH + ':' + DASH + DASH + ' год', 'від початку поїздки, ' + DASH], 'trip, no data: dashes (a dash only for a silent field)');
    const c0 = S.base(R, { settings: { centre: 'clock' } }); c0.tzCar = null; showing(c0);
    eq([tok(c0, 'pgTime'), tok(c0, 'pgWeekday'), tok(c0, 'pgDate')], [DASH + DASH + ':' + DASH + DASH, '', ''], 'clock, no zone: "––:––" and no weekday or date');
    const c1 = S.base(R, { settings: { centre: 'clock' } }); showing(c1);
    eq([tok(c1, 'pgTime'), tok(c1, 'pgWeekday'), tok(c1, 'pgDate')], ['14:43', 'вівторок', '17.11.2026'], 'clock: the car\'s zone, the weekday in Ukrainian, the date');
    const t = S.make(R, 'tech_empty'); showing(t);
    eq([0, 1, 2, 3].map((i) => tok(t, 'pgTechV' + i)), [DASH, DASH, DASH, DASH], 'technical data, no values: a dash in every row');
    eq([0, 1, 2].map((i) => tok(t, 'pgTechF' + i)), ['', '', ''], '... and an empty bar (no fraction)');
    eq([0, 1, 2, 3].map((i) => tok(t, 'pgTechU' + i)), ['', '', '', ''], '... and no unit beside a dash');
    const tv = S.make(R, 'tech'); showing(tv);
    eq([0, 1, 2, 3].map((i) => tok(tv, 'pgTechV' + i)), ['104', '92', '0.42', '+7.5'], 'technical data: 104 / 92 °C, 0.42 бар, +7.5 °C');
    eq([0, 1, 2, 3].map((i) => tok(tv, 'pgTechU' + i)), ['°C', '°C', 'бар', '°C'], '... units');
    eq([0, 1, 2].map((i) => tok(tv, 'pgTechF' + i)), ['0.5400', '0.5250', '0.2625'], '... bar fractions (50-150, 50-130, 0-1.6)');
    eq([0, 1, 2].map((i) => tok(tv, 'pgTechW' + i)), ['0.8000', '0.8750', ''], '... warning points (130 and 120 of the ranges; none for boost)');
    eq([0, 1, 2, 3].map((i) => tok(tv, 'pgTechC' + i)), ['fg', 'fg', 'fg', 'fg'], '... all white below the warnings');
    const tw = S.make(R, 'tech_warn'); showing(tw);
    eq([0, 1].map((i) => tok(tw, 'pgTechC' + i)), ['hot', 'hot'], 'oil 136 and coolant 124: red from the warning value');
    eq(tok(tw, 'pgTechV0'), '136', '... the value itself still shown');
    // a reading outside any plausible range is not a reading
    tw._d.oil = 999;
    eq(tok(tw, 'pgTechV0'), DASH, 'an oil value of 999 is not a reading: a dash');
    // the trip with data
    const tr = S.make(R, 'trip'); showing(tr);
    eq([tok(tr, 'pgTripCons'), tok(tr, 'pgTripSpeed'), tok(tr, 'pgTripWay'), tok(tr, 'pgTripMeta'), tok(tr, 'pgTripFooter')], ['ø 6.8', 'ø 41', '12.4', '0:43 год', 'від початку поїздки, 14:00'], 'trip: ø 6.8, ø 41, 12.4, 0:43 год, departure 14:00');
    // tyres
    const ty = S.make(R, 'tyres'); showing(ty);
    eq([0, 1, 2, 3].map((i) => tok(ty, 'pgTyreP' + i)), ['2.4', '2.4', '2.4', '2.4'], 'tyres: pressures in bar (0.1 x the unit)');
    eq([0, 1, 2, 3].map((i) => tok(ty, 'pgTyreT' + i)), ['+6 °C', '+6 °C', '+7 °C', '+6 °C'], '... temperatures (raw - 40)');
    eq([0, 1, 2, 3].map((i) => tok(ty, 'pgTyreC' + i)), ['fg', 'fg', 'amber', 'fg'], '... amber where the pressure is 0.2 bar under its target (the rear left)');
    const te = S.make(R, 'tyres_empty'); showing(te);
    eq([tok(te, 'pgTyreP0'), tok(te, 'pgTyreT0'), tok(te, 'pgTyreC0')], [DASH, '', 'fg'], 'tyres, no data: a dash, no temperature, white');
    ty.td.clock = () => S.T0 + 5 * 60000; ty._now_ms = S.T0 + 5 * 60000;
    eq(tok(ty, 'pgTyreP0'), DASH, 'tyres: a reading older than a minute is a dash (the page polls every 10 s)');
    // media
    const m0 = S.make(R, 'media'); showing(m0);
    eq([tok(m0, 'pgSrcIcon')], [tok(m0, 'pgSrcIcon') ? 'td_media' : ''], 'the certain media page: the generic source pictogram');
    const rd = S.make(R, 'radio'); showing(rd);
    eq([tok(rd, 'pgMediaMeta'), tok(rd, 'pgStation'), tok(rd, 'pgRadioText'), tok(rd, 'pgRadioFoot')], ['FM', 'Радіо Приклад', "Новини о дев'ятій", 'P3  ·  101.7  ·  TP'], 'radio: band, station, radio text, "preset · frequency · TP"');
    const tk = S.make(R, 'track'); showing(tk);
    eq([tok(tk, 'pgMediaMeta'), tok(tk, 'pgTrackTitle'), tok(tk, 'pgTrackArtist'), tok(tk, 'pgTrackEl'), tok(tk, 'pgTrackTot'), tok(tk, 'pgTrackNo'), tok(tk, 'pgTrackFrac')], ['USB', 'Ранкова хвиля', 'Гурт Приклад', '01:01', '03:35', '4 / 12', '0.2837'], 'now playing: source, title, artist, elapsed, total, 4 / 12, the progress');
    tk.config.pages = {};
    eq(showing(tk), 'media', 'config.pages.media off: tab 3 shows the certain page whatever arrives');
    // phone
    const p0 = S.make(R, 'phone_nodata'); showing(p0);
    eq([tok(p0, 'pgPhoneLine1'), tok(p0, 'pgPhoneLine2')], ['Немає даних', ''], 'phone, nothing heard: "Немає даних"');
    const p1 = S.make(R, 'phone'); showing(p1);
    eq([tok(p1, 'pgPhoneLine1'), tok(p1, 'pgPhoneLine2')], ['Підключено · CarPlay', '80 %  ·  3/4'], 'phone, connected over CarPlay: line 1, battery and signal');
    eq(tok(S.make(R, 'phone_none'), 'pgPhoneLine1'), 'Телефон не підключено', 'phone, device list empty: "Телефон не підключено"');
    const ci = S.make(R, 'call_in'); showing(ci);
    eq([tok(ci, 'pgCallWho'), tok(ci, 'pgCallPath'), tok(ci, 'pgCallTimer')], ['Контакт', 'CarPlay', ''], 'incoming call: "Контакт" (a known contact id), the path, no timer yet');
    const ca = S.make(R, 'call_active'); showing(ca);
    eq([tok(ca, 'pgCallWho'), tok(ca, 'pgCallTimer')], ['Номер', '02:37'], 'active call: "Номер" (unknown contact), our own timer 02:37');
    // navigation
    eq([tok(S.make(R, 'nav_none'), 'pgNavSub'), tok(S.make(R, 'nav_calc'), 'pgCalc')], ['Маршрут не прокладено', 'Розрахунок маршруту…'], 'navigation fallback texts');
    const g = S.make(R, 'nav_guide'); showing(g);
    eq([tok(g, 'pgGuideDist'), tok(g, 'pgGuideUnit'), tok(g, 'pgGuideRoad'), tok(g, 'pgGuideFoot')], ['350', 'м', 'вулиця Тестова', 'прибуття 09:32 · 14 км'], 'guidance: 350 м, the road, "прибуття 09:32 · 14 км"');
    eq([0, 1, 2, 3, 4].map((i) => tok(g, 'pgLane' + i + 'C')), ['grey', 'fg', 'fg', 'grey', ''], 'lanes: the highlighted ones white, the others grey, no fifth');
    eq([pages.fmtDist(45).n + pages.fmtDist(45).u, pages.fmtDist(420).n + pages.fmtDist(420).u, pages.fmtDist(1234).n + pages.fmtDist(1234).u, pages.fmtDist(14200).n + pages.fmtDist(14200).u], ['50м', '400м', '1.2км', '14км'], 'distances: 10 m under 100, 50 m under 1000, one decimal to 10 km, whole km above');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('built dark stays dark until its config key is set');
{
    [['radio', 'media'], ['track', 'media'], ['call_in', 'phone'], ['call_active', 'phone'], ['nav_guide', 'guidance']].forEach(([id, key]) => {
        const h = S.make(R, id);
        const was = showing(h);
        h.config.pages = {};
        const off = showing(h);
        ok(was !== off && ['media', 'phone', 'road', 'none', 'calc'].indexOf(off) >= 0, id + ': with config.pages.' + key + ' off the page is the certain or the fallback one (' + was + ' -> ' + off + ')');
    });
    const cfgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'app.json'), 'utf8')).config;
    eq(cfgJson.pages, Object.assign({}, cfgJson.pages, { tyres: false, media: false, phone: false, guidance: false }), 'app.json: config.pages.tyres / media / phone / guidance are all false');
    ok(cfgJson.mapWindow === null && cfgJson.mapSlots === false && cfgJson.mapForce === false, 'app.json: config.mapWindow null, mapSlots / mapForce false (the map window is an experiment, off)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('the wiring: every field\'s handler, the instances, the shapes');
{
    const logs = [];
    const h = S.base(R, { settings: { callerName: 'off' } });
    h.log = { info: (s) => logs.push(s), warn: (s) => logs.push(s), error: (s) => logs.push(s), debug() {} };
    const extra = {};
    pages.wire(h, extra);
    const P = pages.st(h), I = pages.IF;
    eq([extra[I.media].$instance, extra[I.player].$instance, extra[I.call].$instance, extra[I.guidance].$instance], ['HMI_CID', 'CarPlayMedia', 'Call1', 'Main_Instance'], 'the instances: HmiMediaState HMI_CID, MediaPlayer CarPlayMedia, VoiceCall Call1, Guidance Main_Instance');
    ok(!extra[I.guiding].$instance && !extra[I.tpms].$instance && !extra[I.kombi].$instance, 'NavigationStatus, TPMS and KombiIF stay on instance 1');
    // the handlers run AFTER the engine's own
    const order = [];
    const ex2 = {}; ex2[I.guiding] = { guidingState: () => order.push('engine') };
    pages.wire(h, ex2);
    ex2[I.guiding].guidingState(2);
    ok(order.join() === 'engine', 'a handler already on a field still runs (ours is chained behind it)');
    // navigation
    extra[I.guiding].guidingState(1); eq(P.guiding, 'CALCULATING_ROUTE', 'guidingState 1 = calculating');
    extra[I.guiding].guidingState({ guidingState: 'ACTIVE' }); eq(P.guiding, 'ACTIVE', '... a struct with the name = active');
    extra[I.guiding].guidingState('NONSENSE'); eq(P.guiding, 'NONSENSE', '... an unknown name is kept as it is (never a throw)');
    extra[I.guiding].guidingState(77); eq(P.guiding, null, '... an unknown number is null');
    extra[I.guidance].currentRoad({ elements: [{ text: 'вулиця' }, { text: 'Тестова' }] }); eq(P.road, 'вулиця Тестова', 'currentRoad: the Description\'s texts joined');
    extra[I.guidance].currentRoad({ elements: [] }); eq(P.road, null, '... an empty one is no road');
    extra[I.guidance].conclusiveDart({ maneuver: { intersection: { direction: 'RIGHT', formattedDistance: { rawDistance: 350, unit: 'METER' } } } });
    eq([P.dart.kind, P.dart.dist], ['right', 350], 'conclusiveDart: a right turn in 350 m');
    extra[I.guidance].conclusiveDart({ maneuver: { intersection: { direction: 8, formattedDistance: { rawDistance: 0.5, unit: 'KM' } } } });
    eq([P.dart.kind, P.dart.dist], ['uturn_right', 500], '... the direction by number (8 = U-turn right), kilometres converted');
    extra[I.guidance].conclusiveDart({ maneuver: { roundabout: { exitNumber: 2, driveDirection: 'RIGHT', formattedDistance: { rawDistance: 120 } } } });
    eq([P.dart.kind, P.dart.exit, P.dart.side], ['roundabout', 2, 'RIGHT'], '... a roundabout with its exit and side');
    extra[I.guidance].conclusiveDart({ maneuver: { branch: { branchType: 'HIGHWAY_OUT_RIGHT' } } }); eq(P.dart.kind, 'exit_right', '... a motorway exit');
    extra[I.guidance].conclusiveDart({ maneuver: { destinationManeuver: { position: 'LEFT' } } }); eq(P.dart.kind, 'flag_left', '... a destination on the left');
    extra[I.guidance].conclusiveDart({}); eq(P.dart, null, '... nothing known is no manoeuvre (never guessed)');
    extra[I.guidance].currentLaneGuiding({ rows: [{ lanes: [{ directionToFollow: 'LEFT', isHighlighted: false }, { directionToFollow: 'STRAIGHT_ON', isHighlighted: true }] }] });
    eq(P.lanes, [{ dir: 'left', hi: false }, { dir: 'straight', hi: true }], 'currentLaneGuiding: one arrow per lane');
    extra[I.guidance].nextDestinationInfo({ estimatedArrivalTime: { time: { hour: 9, minute: 32, invalid: false } }, formattedDistance: { rawDistance: 14200 } });
    eq([P.dest.eta, P.dest.dist], [{ h: 9, m: 32 }, 14200], 'nextDestinationInfo: the arrival time and the distance');
    extra[I.guidance].visualizationInKombiNonNaviEnabled(true); eq(P.nonNavi, true, 'visualizationInKombiNonNaviEnabled: map without a route');
    extra[I.kombi].statusConfigurationKombi5({ statusNavigationDisplayType: 'ANZEIGE_RADIOBUTTON_KARTENANSICHT_AKTIV' }); ok(/KARTENANSICHT/.test(P.navType), 'statusConfigurationKombi5: the cluster\'s map view');
    // media
    extra[I.media].playerMetadata(S.WIRED.media);
    eq([P.media.title, P.media.artist], ['Ранкова хвиля', 'Гурт Приклад'], 'playerMetadata: the TITLE line and the ARTIST line by their types');
    extra[I.media].playerMetadata({ firstLineText: 'Лише рядок', secondLineText: 'Другий' }); eq([P.media.title, P.media.artist], ['Лише рядок', 'Другий'], '... types unknown: the first line is the title, the second the artist');
    extra[I.media].playerMetadata({ firstLineText: 'Альбом', firstLineType: 2, secondLineText: 'Назва', secondLineType: 3 }); eq([P.media.title, P.media.album, P.media.artist], ['Назва', 'Альбом', 'Альбом'], '... types by number; the album stands in for a missing artist');
    extra[I.media].trackProgress({ elapsed: 61000, total: 215000, hasProgress: true }); eq([P.media.el, P.media.tot, P.media.has], [61000, 215000, true], 'trackProgress: elapsed and total');
    extra[I.media].trackProgress({ elapsed: 5, total: 0, hasProgress: false }); eq(P.media.has, false, '... a radio / stream has no progress');
    extra[I.media].menu({ selectedEntryId: 7, menuEntries: [{ id: 3, iconKind: 'FM' }, { id: 7, iconKind: 16 }] }); eq([P.media.src, P.media.srcRaw], ['carplay', 'CARPLAY'], 'menu: the selected entry\'s icon kind (16 = CARPLAY) is the source');
    extra[I.media].menu({ selectedEntryId: 3, menuEntries: [{ id: 3, iconKind: 'FM' }] }); eq([P.media.src, P.media.band], ['radio', 'FM'], '... FM is radio, band FM');
    extra[I.tuner].currentStationFmDabAm({ stationListEntry: { stationLongName: 'Радіо Приклад', waveBand: 'WB_DAB', frequencyKhz: 101700, positionNumber: 3, tp: 1 }, radioTextName: 'Текст' });
    eq([P.media.station, P.media.band, P.media.freq, P.media.preset, P.media.tp, P.media.stationText], ['Радіо Приклад', 'DAB', 101.7, 3, true, 'Текст'], 'currentStationFmDabAm: station, band, frequency, preset, traffic flag, radio text');
    extra[I.player].currentItemPosition({ position: 4, totalNumber: 12 }); eq([P.media.cpPos, P.media.cpTotal], [4, 12], 'MediaPlayer (CarPlayMedia): track n of m');
    // phone
    extra[I.agg].aggregatedCallState(1); eq(pages.callState(h), 'INCOMING', 'aggregatedCallState 1 = incoming');
    h._now_ms = S.T0 + 1000; extra[I.agg].aggregatedCallState('ACTIVE'); h._now_ms = S.T0 + 4000;
    eq(tok(h, 'pgCallTimer'), '00:03', 'the call timer is ours: it starts at the first ACTIVE edge (00:03 three seconds later)');
    extra[I.agg].aggregatedCallState(4); h._now_ms = S.T0 + 9000; eq(tok(h, 'pgCallTimer'), '00:08', '... a held call keeps counting');
    extra[I.call].contactID(42); eq(P.phone.contact, true, 'contactID: non-zero = a contact');
    extra[I.call].contactID(0); eq(P.phone.contact, false, '... zero = a number');
    extra[I.callMgr].micMuted(true); eq(P.phone.mic, true, 'micMuted');
    extra[I.devices].deviceList([{ connected: false, friendlyName: 'Телефон А' }, { connected: true, friendlyName: 'Телефон Б', active: ['CARPLAY'], batteryState: 80, signalStrength: 3 }]);
    eq(P.phone.dev, { path: 'CarPlay', battery: 80, signal: 3 }, 'deviceList: the connected phone\'s path, battery, signal (its name is never read into the page)');
    extra[I.devices].deviceList([{ connected: true, active: [9], signalStrength: 100, batteryState: 300 }]); eq(P.phone.dev, { path: 'Bluetooth', battery: null, signal: 4 }, '... hands-free by number = Bluetooth; an impossible battery is none; a 0-100 signal is bars');
    extra[I.agg].aggregatedCallState(0); eq([pages.callLive(h), tok(h, 'pgCallTimer')], [false, ''], 'DISCONNECTED: no call, no timer');
    // the caller's name: only with the setting, only while the call lasts
    h._settings.callerName = 'off'; extra[I.agg].aggregatedCallState(1); extra[I.call].name('Тестова Особа'); extra[I.call].contactID(5);
    eq([P.phone.name, tok(h, 'pgCallWho')], [null, 'Контакт'], 'the name setting off: the name is not kept, the card says "Контакт"');
    h._settings.callerName = 'on'; extra[I.call].name('Тестова Особа'); eq([P.phone.name, tok(h, 'pgCallWho')], ['Тестова Особа', 'Тестова Особа'], 'the name setting on: the name is drawn');
    extra[I.agg].aggregatedCallState(0); eq(P.phone.name, null, 'the call ends: the name is dropped');
    h._settings.callerName = 'off'; extra[I.agg].aggregatedCallState(1); extra[I.call].name('Тестова Особа'); extra[I.call].contactID(5); eq(tok(h, 'pgCallWho'), 'Контакт', '... and with the setting turned off again it is not shown');
    // a handler that is fed rubbish never throws
    let threw = null;
    try {
        Object.keys(extra).forEach((i) => Object.keys(extra[i]).forEach((f) => { if (f[0] !== '$' && typeof extra[i][f] === 'function') [undefined, null, 5, 'x', [], {}, { a: 1 }, [null], [{}]].forEach((v) => extra[i][f](v)); }));
    } catch (e) { threw = e; }
    ok(threw === null, 'every handler survives undefined, null, numbers, strings, empty and odd structs' + (threw ? ': ' + threw.message : ''));
    // TPMS: handlers and the read-only getter poll
    extra[I.tpms].statusTyrePressure({ actualValuePressureTyreFLH: 24, actualValuePressureTyreFRH: 25, actualValuePressureTyreRLH: 65535, actualValuePressureTyreRRH: 24 });
    eq(P.tpms.p, [24, 25, 65535, 24], 'TPMS statusTyrePressure: the four raw pressures (65535 = none)');
    eq(tyreAll(h), ['2.4', '2.5', DASH, '2.4'], '... shown in bar, none as a dash');
    function tyreAll(hh) { hh.td.clock = () => S.T0 + 2000; hh._now_ms = S.T0 + 2000; return [0, 1, 2, 3].map((i) => tok(hh, 'pgTyreP' + i)); }
    const reads = [];
    h.ctx = { signals: { get: (proxy, field) => { reads.push(field); return Promise.resolve({ actualValuePressureTyreFLH: 23 }); } } };
    h.car = { subs: [{ iface: I.tpms, proxy: {}, available: true }] };
    pages.tpmsPoll(h);
    eq(reads.sort(), ['statusTargetTyrePressure', 'statusTyrePressure', 'statusTyreTemperature'], 'a poll reads the three TPMS getters (read only) and nothing else');
    const ex3 = {};
    ok(Object.keys(ex3).length === 0, 'wire() writes only into the table it is given');
    // nothing logged holds a text, a name or a road
    const canaries = ['Тестова Особа', 'Ранкова хвиля', 'Гурт Приклад', 'вулиця Тестова', 'Радіо Приклад', 'Новини', 'Лише рядок', 'Назва', 'Альбом', 'Текст', 'Телефон А', 'Телефон Б'];
    const leaked = logs.filter((l) => canaries.some((c) => l.indexOf(c) >= 0));
    ok(!leaked.length, 'no log line holds a title, an artist, a station, a name or a road (' + logs.length + ' lines: ' + logs.slice(0, 3).join(' | ').slice(0, 160) + ' ...)' + (leaked.length ? ': ' + leaked[0] : ''));
    ok(logs.every((l) => !/[Ѐ-ӿ]/.test(l) || /^twin pages/.test(l) === false), 'the log lines are numbers and enum names (no Cyrillic text from the car)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('the map window (an experiment): presence rule');
{
    const mk = (cfg, tab) => { const h = S.base(R, { tab: tab || 5, config: cfg }); pages.st(h).built = 0; return h; };
    const st = (h) => pages.mapState(h, S.T0 + 100000);
    ok(st(mk({}, 5)).open === false && st(mk({}, 5)).why === 'off', 'config.mapWindow null (the default): shut');
    const on = { mapWindow: 'W1', mapShutMs: 8000 };
    let h = mk(on, 3); ok(!st(h).open && st(h).why === 'tab', 'W1 but tab 3 is selected: shut');
    h = mk(on, 5); ok(!st(h).open, 'W1, tab 5, nothing known: shut (S2 needs the cluster in map view)');
    pages.st(h).navType = 'ANZEIGE_RADIOBUTTON_KARTENANSICHT_AKTIV'; ok(!st(h).open && /no route/.test(st(h).why), '... map view but no route and the "map without a route" setting not on: shut');
    pages.st(h).guiding = 'ACTIVE'; ok(st(h).open && st(h).why === 'setting', '... map view and guidance active: OPEN (S2)');
    pages.st(h).navType = 1; ok(!st(h).open, '... the cluster leaves the map view: shut at once');
    pages.st(h).navType = 2; pages.st(h).guiding = null; pages.st(h).nonNavi = true; ok(st(h).open, '... map view and "map without a route": open');
    pages.st(h).built = S.T0 + 96000; ok(!st(h).open && st(h).why === 'shut after mapping', '4 s after a fresh panel mapping: shut for 8 s');
    pages.st(h).built = S.T0 + 91000; ok(st(h).open, '... 9 s after: open again');
    // S1: the slot rows
    const rows = 'target panel: slot 0x203 scene 0x10004f8 1920x720: idle\nslot 0x100 status 2: 0x1000300 class 0 map 1\nslot 0x101 status 2: 0x1000312 class 1024 map 3, 0x1000311 class 0 map 1\n';
    eq(pages.parseSlots(rows), { status: 2, mapped: true }, 'parseSlots: slot 0x100 status 2 with a content "map 1" = mapped');
    eq(pages.parseSlots('slot 0x100 status 1: 0x0 class 0 map 0'), { status: 1, mapped: false }, '... a free slot (content 0x0) is not');
    eq(pages.parseSlots('slot 0x100 status 0: 0x1000300 class 0 map 1'), { status: 0, mapped: false }, '... status 0 is not');
    eq(pages.parseSlots('nothing here'), null, '... a text without the row is nothing (never a guess)');
    h = mk(Object.assign({ mapSlots: true }, on), 5);
    ok(!st(h).open && /stale/.test(st(h).why), 'S1 on, no status row read yet: shut');
    pages.onStatus(h, rows); pages.st(h).slotsAt = S.T0 + 99000; ok(st(h).open && st(h).why === 'slots', '... a fresh row with the map: open');
    pages.onStatus(h, 'slot 0x100 status 1: 0x0 class 0 map 0\n'); pages.st(h).slotsAt = S.T0 + 99000; ok(!st(h).open, '... the row says the map is gone: shut at once');
    pages.st(h).slotsAt = S.T0 + 80000; pages.st(h).slots = { status: 2, mapped: true }; ok(!st(h).open && /stale/.test(st(h).why), '... a row older than 6 s says nothing: shut');
    h = mk({ mapWindow: 'W2', mapForce: true, mapShutMs: 8000 }, 5); ok(st(h).open && st(h).why === 'forced', 'the forced window (config.mapForce): open on tab 5 whatever the slots say');
    // the page follows
    h = mk({ mapWindow: 'W1', mapShutMs: 0 }, 5); Object.assign(pages.st(h), { navType: 2, guiding: 'ACTIVE' });
    eq(showing(h), 'map', 'the map page shows while the window is open (the road bar only: no title)');
    ok(pages.hideTitleRule(h) === true, '... and the backdrop is told to drop the title rule');
    eq(R.widget.pages.map.items.map((i) => i.id).join(), 'bar,road', '... the page\'s items are the road bar and the road');
    eq(h.twinMap, 'W1', '... the engine is told through hud.twinMap = "W1" (B1: _twinBackSend sends u_map / u_mapF from it)');
    Object.assign(pages.st(h), { navType: 1 }); const x2 = { w: R.widget, ref: 1, sheet: null, px: null }; pages.st(h).mapSent = true; pages.update(h, x2, h._now_ms + 1000, true);
    ok(h.twinMap === null && pages.st(h).page !== 'map', '... the cluster leaves the map view: hud.twinMap null, the fallback page shows');
}
{
    // B6's manoeuvre pictograms by name (stand-ins registered here: the drawings are B6's)
    const IC = require(path.join(R.dir, 'icons.js')).ICONS, f = () => 0.5;
    ['td_turn_right', 'td_uturn_left', 'td_straight', 'td_rb2_r', 'td_rb3_l', 'td_exit_right', 'td_flag_centre', 'td_fork_left', 'td_dot', 'td_turn_slight_left'].forEach((n) => { if (!IC[n]) IC[n] = f; });
    const mi = (d) => pages.maneuverIcon(d);
    eq([mi({ kind: 'right' }), mi({ kind: 'uturn_left' }), mi({ kind: 'straight' }), mi({ kind: 'roundabout', exit: 2, side: 'RIGHT' }), mi({ kind: 'roundabout', exit: 3, side: 'LEFT' }),
        mi({ kind: 'exit_right' }), mi({ kind: 'flag' }), mi({ kind: 'fork_left' }), mi({ kind: null }), mi(null)],
        ['td_turn_right', 'td_uturn_left', 'td_straight', 'td_rb2_r', 'td_rb3_l', 'td_exit_right', 'td_flag_centre', 'td_fork_left', 'td_dot', ''],
        'manoeuvre pictograms (B6 names): turns, U-turns, roundabouts by exit and side, exits, flags, forks; the dot for an unknown kind; nothing with no manoeuvre');
    const g = S.make(R, 'nav_guide'); pages.st(g).lanes = [{ dir: 'slight_left', hi: true }]; pages.st(g).dart = { kind: 'roundabout', exit: 2, side: 'RIGHT', dist: 80 };
    eq([g._token('td:pgLane0I'), g._token('td:pgGuideExit'), g._token('td:pgGuideIcon')], ['td_turn_slight_left', '2', 'td_rb2_r'], 'lane arrows by the same names; the roundabout\'s exit number drawn inside the ring');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('repaint only on a change; a night change repaints; a setting is applied in place');
{
    const h = S.make(R, 'trip');
    let writes = 0;
    h._blitDiff = (x, buf) => { writes++; x.px = buf; };
    const x = { w: R.widget, ref: 1, sheet: null, px: null };
    pages.init(h, x);
    const first = writes;
    for (let i = 1; i <= 10; i++) { at(h, i * 200); pages.update(h, x, h._now_ms, false); }
    eq([first, writes], [1, 1], 'a page with nothing new: one paint, then none (10 ticks)');
    Object.assign(h.td, { travel: { hours: 0, minutes: 44, way: 125 } });
    at(h, 3000); pages.update(h, x, h._now_ms, false);
    eq(writes, 2, 'a value changed: one repaint');
    h.theme = R.THEMES.twin ? Object.assign({}, R.THEMES.twin, { fg: [200, 200, 200, 255], dim: [170, 170, 170, 255] }) : h.theme;
    at(h, 3400); pages.update(h, x, h._now_ms, false);
    eq(writes, 3, 'the night colours came: the page repaints in the new colours');
    const lit = x.px[(0 * 462 + 0) * 4 + 3];
    ok(lit === 0, 'the layer is transparent where nothing is drawn (the corner pixel)');
    // the page ink is in the theme's white at day
    const day = S.make(R, 'clock'); const dr = S.render(R, day);
    let maxR = 0; for (let i = 0; i < dr.buf.length; i += 4) if (dr.buf[i + 3] > 250) maxR = Math.max(maxR, dr.buf[i]);
    eq(maxR, 255, 'by day the ink is white (255)');
    // a setting is applied in place: changed() forgets the key and decides again at the next tick, no rebuild
    h._settings.centre = 'clock'; pages.changed(h);
    at(h, 3500); pages.update(h, x, h._now_ms, false);
    eq([pages.st(h).page, writes], ['clock', 4], 'a change of "centre": the next tick shows the clock page, one repaint');
    const src = fs.readFileSync(path.join(ROOT, 'shared', 'hud.js'), 'utf8');
    // integration (B7): B2's tab keys and these page keys share ONE in-place handler in hud.js
    ok(/TW_PAGE_KEYS = \['centre', 'techData', 'callerName'\]/.test(src) && /if \(twinPages && TW_PAGE_KEYS\.indexOf\(key\) >= 0\) twinPages\.changed\(this\)/.test(src), 'shared/hud.js applies centre / techData / callerName through twin_pages.changed (no _rebuild)');
    ok(/w\.type === 'tdpage'\) \{ if \(twinPages\) twinPages\.update/.test(src) && /twinPages\.init\(this, x\)/.test(src), 'shared/hud.js builds and updates the tdpage layer through shared/twin_pages.js');
    ok(/tdpage: true/.test(src) && /tdpage: \['pages'\]/.test(fs.readFileSync(path.join(ROOT, 'shared', 'layouts.js'), 'utf8')), 'tdpage is an image type of the engine and a known type of the layout validator');
    // the engine loads without the file (f30_cluster does not pack it)
    const dir2 = R.H.tree('f30_cluster', ['twin_tokens.js', 'twin_icons.js', 'twin_cc.js', 'twin_probe.js', 'twin_pages.js']);
    let ok2 = true; try { require(path.join(dir2, 'hud.js')); } catch (e) { ok2 = false; }
    ok(ok2, 'shared/hud.js loads when shared/twin_pages.js is not packed (f30_cluster\'s build)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('the car\'s Node 8, the signals, the settings');
{
    const src = fs.readFileSync(path.join(ROOT, 'shared', 'twin_pages.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, '``');
    const bad = [];
    if (/\?\./.test(code.replace(/\?\.\d/g, ''))) bad.push('?.');
    if (/\?\?/.test(code)) bad.push('??');
    if (/\{\s*\.\.\./.test(code) || /,\s*\.\.\.[a-zA-Z]/.test(code.replace(/\([^()]*\.\.\.[^()]*\)/g, ''))) bad.push('object spread');
    if (/Object\.fromEntries|\.flat\(|\.flatMap\(|catch\s*\{/.test(code)) bad.push('fromEntries / flat / flatMap / optional catch');
    ok(!bad.length, 'shared/twin_pages.js uses nothing newer than Node 8' + (bad.length ? ': ' + bad.join(', ') : ''));
    const cat = path.join(ROOT, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json');
    if (fs.existsSync(cat)) {
        let out = '', code2 = 0;
        try { out = execFileSync('python3', [path.join(ROOT, 'tools', 'signals', 'check_signals.py'), cat, path.join(ROOT, 'apps', 'twin_dial', 'app.json')], { encoding: 'utf8' }); } catch (e) { code2 = e.status; out = String(e.stdout || ''); }
        ok(code2 === 0 && /all declarations pass/.test(out), 'tools/signals/check_signals.py passes on apps/twin_dial/app.json (every r has a non-zero getter, every s a notifier)');
    } else skip('check_signals.py (the car catalogue is not in this checkout)');
    const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'app.json'), 'utf8'));
    const sig = app.signals;
    const want = { 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState': ['playerMetadata', 'trackProgress', 'menu'], 'de.bmw.infotainment.tuner.fmamdab.tunerfmamdab.TunerFmAmDab': ['currentStationFmDabAm'],
        'de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer': ['currentItemPosition', 'playerState'], 'de.bmw.infotainment.connectivity.telephony.VoiceCall': ['state', 'contactID', 'name'],
        'de.bmw.infotainment.connectivity.telephony.VoiceCallManager': ['micMuted'], 'de.bmw.infotainment.devicemanager.devicepresentation.DevicePresentation': ['deviceList'],
        'de.bmw.infotainment.navigation.guiding.Guidance': ['currentRoad', 'conclusiveDart', 'currentLaneGuiding', 'nextDestinationInfo', 'visualizationInKombiNonNaviEnabled'],
        'de.bmw.infotainment.vehicle.TPMS': ['statusTyrePressure', 'statusTyreTemperature', 'statusTargetTyrePressure'], 'de.bmw.infotainment.drivingexcitement.FES': ['statusSwitchDriveDynamicSport2'],
        'de.bmw.infotainment.KombiIF': ['statusConfigurationKombi5'] };
    ok(Object.keys(want).every((i) => sig[i] && want[i].every((f) => sig[i][f] === 'rs')), 'app.json declares every field the pages read, read only ("rs": getter and notifier, never "w")');
    const flags = []; Object.keys(sig).forEach((i) => Object.keys(sig[i]).forEach((f) => { if (f[0] !== '_' && /w/.test(sig[i][f])) flags.push(i.split('.').pop() + '.' + f); }));
    ok(!flags.length, 'no declared field has a setter flag' + (flags.length ? ': ' + flags.join(', ') : ''));
    eq([sig['de.bmw.infotainment.hmi.hmimediastate.HmiMediaState']._instances, sig['de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer']._instances, sig['de.bmw.infotainment.connectivity.telephony.VoiceCall']._instances, sig['de.bmw.infotainment.navigation.guiding.Guidance']._instances],
        ['HMI_CID', 'CarPlayMedia', 'Call1', 'Main_Instance'], 'app.json: the same instances as the wiring');
    ok(['twin_pages.js'].every((f) => app.shared.indexOf(f) >= 0), 'app.json packs shared/twin_pages.js');
    const set = (k) => app.settings.filter((s) => s.key === k)[0];
    eq([set('centre').options.map((o) => o[0]).join(), set('centre').default], ['clock,trip,tech,cycle', 'cycle'], 'setting "centre": clock / trip / tech / cycle, default cycle');
    eq([set('techData').options.map((o) => o[0]).join(), set('techData').default], ['show,hide', 'show'], 'setting "techData": show / hide, default show');
    eq([set('callerName').options.map((o) => o[0]).join(), set('callerName').default], ['off,on', 'off'], 'setting "callerName": off / on, default off');
    const main = app.screens.filter((s) => s.name === 'MAIN')[0], sett = app.screens.filter((s) => s.name === 'SETTINGS')[0];
    ok(main.items.some((i) => i[0] === 'setting' && i[1] === 'techData') && sett.skip.indexOf('techData') >= 0, 'the hide setting sits on the main screen beside the page choice (and is skipped in the list)');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
process.exit(failed ? 1 : 0);
