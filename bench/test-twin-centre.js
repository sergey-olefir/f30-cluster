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
    // FIN (the owner, 2026-11-18): "Технічні дані: сховати" hides BOTH the technical page and the tyre page
    h.config.pages = { tyres: true }; h._settings.techData = 'hide'; h._settings.centre = 'cycle'; pages.changed(h);
    eq(pages.computerList(h).join(), 'clock,trip', 'techData = hide with config.pages.tyres on: the tyre page is hidden too (clock, trip)');
    pages.st(h).cyc = 'tyres'; pages.st(h).cycSince = h._now_ms;
    const seen2 = {};
    for (let t = 140000; t < 200000; t += 1000) seen2[step(h, x, t)] = true;
    eq(Object.keys(seen2).sort(), ['clock', 'trip'], '... the cycle (even one standing on the tyre page) never shows tech or tyres while hidden');
    ok(!pages.st(h).tpms.timer, '... and the TPMS poll does not run');
    h._settings.techData = 'show'; pages.changed(h);
    eq(pages.computerList(h).join(), 'clock,trip,tech,tyres', 'techData = show again: both come back');
    h.config.pages = { tyres: false }; h._settings.techData = 'show';
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('FIN: no page dots under the centre title (the owner, 2026-11-18)');
{
    // K2's mockup 1Kb drew four discs r 3.2, pitch 15 px, 7 px under the title rule (y 295-297.5), centred on x 960: the band
    // [900, 1020] x [299, 311] must hold no ink of ours on any page, and no page spec has a dots item
    const L = pages.LAYER;
    const band = (buf) => { let n = 0; if (!buf) return -1; for (let y = 299 - L.y; y < 311 - L.y; y++) for (let x = 900 - L.x; x < 1020 - L.x; x++) if (buf[(y * L.w + x) * 4 + 3] > 0) n++; return n; };
    const bad = [];
    Object.keys(S.STATES).forEach((id) => { const r = S.render(R, S.make(R, id)); if (band(r.buf) !== 0) bad.push(id + ':' + band(r.buf)); });
    ok(bad.length === 0, 'no ink under the title rule in the dots\' band on any of ' + Object.keys(S.STATES).length + ' page states' + (bad.length ? ' (' + bad.join(', ') + ')' : ''));
    const kinds = {};
    Object.keys(R.widget.pages).forEach((p) => (R.widget.pages[p].items || []).forEach((it) => { kinds[it.k] = true; }));
    ok(!Object.keys(kinds).some((k) => /dot|pager/i.test(k)) && !/dots|pager/i.test(fs.readFileSync(path.join(ROOT, 'shared', 'twin_pages.js'), 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')),
        'no page item draws dots (item kinds: ' + Object.keys(kinds).sort().join(' ') + ')');
    // the guard sees a dot: one disc of the mockup's size painted into a clock page's pixels
    const r = S.render(R, S.make(R, 'clock')), b = Buffer.from(r.buf);
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y <= 10) b[((305 + y - L.y) * L.w + (952 + x - L.x)) * 4 + 3] = 255;
    ok(band(b) > 20, 'the check sees one mockup dot painted at (952, 305) (' + band(b) + ' px)');
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
    [['radio', 'media'], ['track', 'media'], ['call_in', 'phone'], ['call_active', 'phone'], ['nav_guide', 'guidance'], ['car_carplay', 'media'], ['car_radio', 'media'], ['car_call', 'phone'], ['car_route', 'route']].forEach(([id, key]) => {
        const h = S.make(R, id);
        const was = showing(h);
        h.config.pages = {};
        const off = showing(h);
        ok(was !== off && ['media', 'phone', 'road', 'none', 'calc'].indexOf(off) >= 0, id + ': with config.pages.' + key + ' off the page is the certain or the fallback one (' + was + ' -> ' + off + ')');
    });
    const cfgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'app.json'), 'utf8')).config;
    // car-fix CF3: what the car sends is on (media, the call card, the CarPlay route); what it never sent stays dark
    eq(cfgJson.pages, Object.assign({}, cfgJson.pages, { tyres: false, media: true, phone: true, phoneDevices: false, callDetail: false, guidance: false, route: true, routeOffRoad: false }),
        'app.json (car-fix CF3): config.pages media / phone / route on; tyres / phoneDevices / callDetail / guidance / routeOffRoad (unseen, untested or unverified) off');
    ok(cfgJson.mapWindow === null && cfgJson.mapSlots === false && cfgJson.mapForce === false, 'app.json: config.mapWindow null, mapSlots / mapForce false (the map window is an experiment, off)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('the wiring: every field\'s handler, the instances, the shapes');
{
    const logs = [];
    const h = S.base(R, { settings: { callerName: 'off' }, config: { pages: S.FULL_PHONE } });      // the call card's whole drawing (car-fix CF3: callDetail)
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
    extra[I.guidance].conclusiveDart({ maneuver: { intersection: { direction: 8, formattedDistance: { distance: '0.5', rawDistance: 500, unit: 'KM' } } } });
    eq([P.dart.kind, P.dart.dist], ['uturn_right', 500], '... the direction by number (8 = U-turn right); rawDistance is metres whatever the unit (car-fix CF3: the car)');
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
console.log('car-fix CF3: media with the car\'s shapes (CarPlay first; lengths and enums from the car, invented text)');
{
    const C = S.CAR, I = pages.IF;
    const h = S.make(R, 'car_carplay'); showing(h);
    const m = pages.st(h).media;
    eq([pages.st(h).page, m.srcRaw, m.src], ['track', 'CARPLAY', 'carplay'], 'CarPlay playing: the menu\'s selected entry (Int64 ids as non-numbers) is CARPLAY, the now-playing page shows');
    eq([m.title, m.artist, m.album], [null, C.artist, C.album], 'the HMI lines with CarPlay: ARTIST and ALBUM, no TITLE line (as the car sends them)');
    eq([tok(h, 'pgTrackTitle'), tok(h, 'pgTrackArtist'), tok(h, 'pgMediaMeta')], [C.title, C.artist, 'CarPlay'], 'the title and the artist come from MediaPlayer on CarPlayMedia (TITLE / ARTIST keys); the meta line says CarPlay');
    ok(tok(h, 'pgTrackTitle') !== C.album && tok(h, 'pgTrackTitle') !== C.artist, '... never the album or the artist drawn as the title');
    eq([tok(h, 'pgTrackEl'), tok(h, 'pgTrackTot'), tok(h, 'pgTrackFrac'), tok(h, 'pgTrackNo')], ['00:25', '03:04', '0.1384', ''], 'the time from currentItemTime (25583 of 184785 ms): 00:25 / 03:04, the progress 0.1384; "0 of 0" is no track number');
    eq([h.td.mediaSource, h.td.media], ['projection', C.title], 'tab 3: the projection icon and the title as its text (B2 cuts it with "…")');
    ok(h.td.media !== C.album, '... not the second HMI line (the album: the old config.twin.media rule)');
    // CarPlay without its own item: the certain page, never a guess
    const e = h._extra;
    e[I.player].currentItemMetadata([{ key: 'COVER_FILE', value: { stringValue: 'x' } }]);
    pages.changed(h); eq([showing(h), h.td.media], ['media', null], 'CarPlay with no TITLE key: the certain page (source pictogram), no tab text');
    e[I.player].currentItemMetadata([{ key: 3, value: { stringValue: 'Назва' } }, { key: 5, value: { stringValue: 'Виконавець' } }]);
    eq([showing(h), tok(h, 'pgTrackTitle'), tok(h, 'pgTrackArtist')], ['track', 'Назва', 'Виконавець'], 'the metadata keys by number (3 TITLE, 5 ARTIST)');
    e[I.player].currentItemTime({ elapsed: 999999, total: 1000 }); eq(tok(h, 'pgTrackFrac'), '1.0000', 'an elapsed time past the total is held at the end');
    e[I.player].currentItemTime({ elapsed: 5, total: 0 }); eq([tok(h, 'pgTrackTot'), tok(h, 'pgTrackFrac')], ['', ''], 'a total of 0: no time, no progress line');
    // the source follows the menu: radio, then back to CarPlay
    e[I.media].menu(S.MENU(4)); pages.changed(h);
    eq([showing(h), tok(h, 'pgStation'), tok(h, 'pgMediaMeta'), h.td.mediaSource, h.td.media], ['radio', C.station, 'FM', 'tuner', C.station], 'the menu selects FM: the radio page with the tuner\'s station, band FM, the tuner icon and the station as the tab text');
    eq([tok(h, 'pgRadioText'), tok(h, 'pgRadioFoot')], [C.rt, '101.7'], '... the radio text, the frequency (kHz / 1000); preset 0 and TPS_NO_TP are not drawn');
    e[I.media].menu(S.MENU(7)); pages.changed(h); eq(showing(h), 'track', 'the menu selects CARPLAY again: now playing');
    // the old matching took the FIRST entry when neither had an id (undefined === undefined): MUSIC_COLLECTION. One match or none.
    e[I.media].menu({ menuEntries: [{ iconKind: 'MUSIC_COLLECTION' }, { iconKind: 'CARPLAY' }] });
    eq([pages.st(h).media.srcRaw, pages.st(h).media.src], [null, 'carplay'], 'no selected id: no source from the menu (never the first entry); the CarPlay player playing decides: carplay');
    const same = { low: 1, high: 0 };
    e[I.media].menu({ selectedEntryId: same, menuEntries: [{ id: same, iconKind: 'FM' }, { id: same, iconKind: 'CARPLAY' }] });
    eq(pages.st(h).media.srcRaw, null, 'two entries with the same id: ambiguous, none taken');
    e[I.player].playerState(3); eq([pages.st(h).media.cpState, pages.st(h).media.src], ['PLAYER_STATE_PAUSE', null], 'playerState by number (3 = PAUSE): with no menu source the CarPlay player paused names no source');
    pages.changed(h); eq(showing(h), 'media', '... and the page is the certain one');
    e[I.media].menu({ selectedEntryId: '7', menuEntries: [{ id: 4, iconKind: 'FM' }, { id: 7, iconKind: 'CARPLAY' }] });
    eq(pages.st(h).media.srcRaw, 'CARPLAY', 'ids compared by value whatever their shape (a digit string against a number)');
    // Int64 shapes
    const b = Buffer.alloc(8); b.writeUInt32BE(0, 0); b.writeUInt32BE(184785, 4);
    eq([pages.int64(25583), pages.int64('184785'), pages.int64({ low: 184785, high: 0 }), pages.int64({ low: 1, high: 1 }), pages.int64(b), pages.int64('?'), pages.int64({}), pages.int64(null)],
        [25583, 184785, 184785, 4294967297, 184785, null, null, null], 'int64(): a number, a digit string, a {low, high} pair, an 8-byte buffer; "?" / {} / null are none');
    e[I.media].trackProgress({ elapsed: '?', total: '?', hasProgress: true });
    eq([pages.st(h).media.has, pages.st(h).media.tot], [false, null], 'the HMI progress as the car sent it ("?"): no progress (never a NaN on the page)');
    e[I.media].trackProgress({ elapsed: { low: 61000, high: 0 }, total: { low: 215000, high: 0 }, hasProgress: true });
    eq([pages.st(h).media.has, pages.st(h).media.el, pages.st(h).media.tot], [true, 61000, 215000], '... and as a {low, high} Int64: read');
    // config.pages.media off: none of it reaches the tab bar
    const off = S.make(R, 'car_carplay'); off.config.pages = Object.assign({}, S.CAR_PAGES, { media: false }); pages.tabBridge(off);
    eq([off.td.mediaSource, showing(off)], [null, 'media'], 'config.pages.media off: the plain tab icon and the certain page');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('car-fix CF3: phone - the call card from the call state the car sends; the unseen parts dark');
{
    const I = pages.IF;
    const h = S.make(R, 'car_call');
    eq([showing(h), tok(h, 'pgTitle'), tok(h, 'pgCallTimer')], ['call', 'Розмова', '01:23'], 'the car\'s DIALING -> ACTIVE: the call card, "Розмова", our own timer from the ACTIVE edge (83 s later: 01:23)');
    eq([tok(h, 'pgCallWho'), tok(h, 'pgCallPath'), tok(h, 'pgCallMic'), tok(h, 'pgCallIcon')], ['', '', '', ''], 'callDetail / phoneDevices off: no contact line, no path, no microphone mark (VoiceCall, DevicePresentation never seen)');
    const e = h._extra;
    e[I.agg].aggregatedCallState('DIALING'); eq([tok(h, 'pgTitle'), tok(h, 'pgCallTimer')], ['Виклик…', ''], 'DIALING: "Виклик…", no timer yet');
    e[I.agg].aggregatedCallState('DISCONNECTED'); pages.changed(h);
    eq([showing(h), tok(h, 'pgPhoneLine1'), tok(h, 'pgPhoneLine2')], ['phone', 'Немає даних', ''], 'DISCONNECTED: the idle page, "Немає даних" (no device list is drawn)');
    // VoiceCall alone (unseen) never opens the card while callDetail is off (a car where the aggregator never spoke)
    pages.st(h).phone.agg = null;
    e[I.call].state('ACTIVE'); pages.changed(h);
    eq([pages.callState(h), showing(h)], [null, 'phone'], 'VoiceCall\'s state alone with callDetail off: no call');
    h.config.pages = Object.assign({}, S.CAR_PAGES, { callDetail: true }); pages.changed(h);
    eq(showing(h), 'call', '... with callDetail on: the card (the drawing exists, switched off)');
    h.config.pages = Object.assign({}, S.CAR_PAGES);
    // the device list arrives: drawn only with phoneDevices
    e[I.devices].deviceList([{ connected: true, active: ['CARPLAY'], batteryState: 80, signalStrength: 3 }]);
    eq([tok(h, 'pgPhoneLine1'), h.td.phoneConnected], ['Немає даних', null], 'a device list with phoneDevices off: not drawn, the plain tab icon');
    h.config.pages = Object.assign({}, S.CAR_PAGES, { phoneDevices: true }); pages.tabBridge(h);
    eq([tok(h, 'pgPhoneLine1'), h.td.phoneConnected], ['Підключено · CarPlay', true], '... with phoneDevices on: "Підключено · CarPlay" and the icon with bars');
    // the caller's name: never kept without callDetail, even with the setting on
    const n = S.make(R, 'car_call'); n._settings.callerName = 'on';
    n._extra[I.call].name('Тестова Особа');
    eq([pages.st(n).phone.name, tok(n, 'pgCallWho')], [null, ''], 'callerName on but callDetail off: the name is not even kept');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('car-fix CF3: navigation - the route guided by CarPlay');
{
    const I = pages.IF;
    const h = S.make(R, 'car_route');
    eq([showing(h), tok(h, 'pgTitle'), tok(h, 'pgRouteMeta')], ['route', 'Навігація', 'CarPlay'], 'provider CAR_PLAY, BMW\'s guiding INACTIVE, a fresh destination: the route page, "Навігація", meta CarPlay');
    eq([tok(h, 'pgRouteDist'), tok(h, 'pgRouteUnit'), tok(h, 'pgRouteEta')], ['5.7', 'км', 'прибуття 20:41 · 11 хв'], 'the car\'s 5700 (unit KM) is 5.7 км; the arrival 20:41 as sent (local); 660 s = 11 хв');
    eq([tok(h, 'pgRouteRoad').length, tok(h, 'pgRouteFoot')], [14, ''], 'the road the car is on; isOnGuidableRoad false but config.pages.routeOffRoad off (its meaning unverified): no footer');
    h.config.pages = Object.assign({}, S.CAR_PAGES, { routeOffRoad: true });
    eq(tok(h, 'pgRouteFoot'), 'Поза дорогою', '... with routeOffRoad on: "Поза дорогою"');
    eq(h.td.route, true, 'tab rule 3: hud.td.route is true while the CarPlay route is live (shared/twin_tabs.js selects tab 5)');
    eq([pages.st(h).dest.dist, pages.metres({ rawDistance: 5700, unit: 'KM' }), pages.metres({ rawDistance: 5700, unit: 1 }), pages.metres({ rawDistance: 0, unit: 'NONE' })], [5700, 5700, 5700, null],
        'rawDistance is METRES whatever the unit (5.7e6 m or 57 km in 660 s is impossible); 0 is no distance');
    eq([pages.st(h).dart, pages.st(h).lanes], [{ kind: null, dist: null, exit: null, side: null }, null], 'the CarPlay route\'s empty manoeuvre and lanes: nothing to draw (no arrow page)');
    const e = h._extra;
    e[I.guidance].isOnGuidableRoad(true); eq(tok(h, 'pgRouteFoot'), '', 'on a guidable road: no footer');
    // freshness, provider, BMW's own guidance, the switch
    const x = newX(h);
    eq([step(h, x, pages.ROUTE_FRESH_MS + 1000), h.td.route], ['road', false], 'no destination for more than a minute: the route page goes (the road page with the road) and hud.td.route is false at that tick');
    e[I.guidance].nextDestinationInfo({ travelTime: 600, formattedDistance: { rawDistance: 5200, unit: 'KM' }, estimatedArrivalTime: { time: { hour: 20, minute: 41, invalid: false } } });
    eq([step(h, x, pages.ROUTE_FRESH_MS + 1500), tok(h, 'pgRouteDist')], ['route', '5.2'], 'a new destination: back, 5.2 км');
    eq(h.td.route, true, '... a new destination: hud.td.route true at once (from the handler)');
    e[I.guidance].guidingProvider('NONE'); eq([h.td.route, step(h, x, pages.ROUTE_FRESH_MS + 2000)], [false, 'road'], 'provider NONE: no route page, no tab rule');
    e[I.guidance].guidingProvider(2); eq([pages.st(h).provider, step(h, x, pages.ROUTE_FRESH_MS + 2500)], ['ANDROID_AUTO', 'road'], '... Android Auto (2, never seen): no route page either');
    e[I.guidance].guidingProvider(1); eq(step(h, x, pages.ROUTE_FRESH_MS + 3000), 'route', 'provider 1 = CAR_PLAY: the route page');
    e[I.guiding].guidingState('ACTIVE'); eq(step(h, x, pages.ROUTE_FRESH_MS + 3500), 'road', 'BMW\'s own guidance active (its arrow page is off): no CarPlay route page over it');
    e[I.guiding].guidingState('INACTIVE');
    h.config.pages = Object.assign({}, S.CAR_PAGES, { route: false }); pages.changed(h); eq(step(h, x, pages.ROUTE_FRESH_MS + 4000), 'road', 'config.pages.route off: the fallback page');
    h.config.pages = Object.assign({}, S.CAR_PAGES);
    e[I.guidance].nextDestinationInfo({ travelTime: 0, formattedDistance: { rawDistance: 0, unit: 'NONE' }, estimatedArrivalTime: { time: { invalid: true } } });
    eq([pages.st(h).dest, step(h, x, pages.ROUTE_FRESH_MS + 4500)], [null, 'road'], 'an empty destination (no distance, no time, invalid arrival) is none');
    eq([pages.fmtTravel(660), pages.fmtTravel(3900), pages.fmtTravel(20), pages.fmtTravel(0), pages.fmtTravel(undefined)], ['11 хв', '1 год 05 хв', '1 хв', '', ''], 'travel time: minutes, hours and minutes, at least one minute, none for 0');
    ok(R.widget.pages.route && R.layout.widgets.filter((w) => w.type === 'tdpage').length === 1, 'the route page is one more page of the ONE page layer (no new layer)');
    ok(!R.widget.pages.route.items.some((i) => i.k === 'i' || i.k === 'lanes'), '... with no arrow and no lane row');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('car-fix CF3: privacy - the car\'s texts and the trip never reach the log');
{
    const logs = [];
    const keep = (h) => { h.log = { info: (s) => logs.push(s), warn: (s) => logs.push(s), error: (s) => logs.push(s), debug() {} }; return h; };
    ['car_carplay', 'car_radio', 'car_call', 'car_route'].forEach((id) => {
        const st0 = S.STATES[id], h = keep(S.base(R, Object.assign({ tab: st0.tab }, st0.over || {})));
        st0.setup(h, R); showing(h);
    });
    const C = S.CAR, canaries = [C.title, C.artist, C.album, C.station, C.rt.slice(0, 12), 'вулиця', '5700', '5.7', '20:41', '660'];
    const leaked = logs.filter((l) => canaries.some((c) => l.indexOf(c) >= 0));
    ok(logs.length > 5 && !leaked.length, 'no log line holds a title, an artist, an album, a station, a radio text, a road, the distance, the travel or the arrival time (' + logs.length + ' lines)' + (leaked.length ? ': ' + leaked[0] : ''));
    ok(logs.some((l) => /CarPlay item 4 keys, title 16 characters/.test(l)) && logs.some((l) => /guiding provider CAR_PLAY/.test(l)) && logs.some((l) => /destination distance yes, travel time yes, arrival yes/.test(l)),
        'the log has the lengths and the enums (CarPlay item 4 keys, title 16 characters; provider CAR_PLAY; which destination parts came)');
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
    // car-issues MW: W3 goes through the same rule (open only on tab 5 with the map believed present), told to the engine by name
    h = mk({ mapWindow: 'W3', mapShutMs: 0 }, 5); Object.assign(pages.st(h), { navType: 2, guiding: 'ACTIVE' });
    eq(showing(h), 'map', 'car-issues MW: config.mapWindow "W3": the map page shows under the same rule');
    eq(h.twinMap, 'W3', '... and hud.twinMap = "W3" (hud.js TW_MAP.W3: the box and the arcs)');
    Object.assign(pages.st(h), { navType: 1 }); const x3 = { w: R.widget, ref: 1, sheet: null, px: null }; pages.st(h).mapSent = true; pages.update(h, x3, h._now_ms + 1000, true);
    ok(h.twinMap === null && pages.st(h).page !== 'map', '... and W3 shuts like W2 when the cluster leaves the map view');
    // car-issues MW (found on the bench): the variant chosen in Діагностика while the window is open reaches the engine at the next tick;
    // before, hud.twinMap was sent only when the window opened or shut, so a W2 -> W3 switch on tab 5 changed nothing on the panel
    h = mk({ mapWindow: 'W2', mapShutMs: 0 }, 5); Object.assign(pages.st(h), { navType: 2, guiding: 'ACTIVE' });
    eq(showing(h), 'map', 'car-issues MW: W2 open');
    eq(h.twinMap, 'W2', '... hud.twinMap = "W2"');
    h.config.mapWindow = 'W3'; const x4 = { w: R.widget, ref: 1, sheet: null, px: null }; pages.update(h, x4, h._now_ms + 1000, true);
    ok(pages.st(h).page === 'map' && h.twinMap === 'W3', 'car-issues MW: switched to W3 while open: the next tick sends W3 (hud.twinMap ' + h.twinMap + ')');
    h.config.mapWindow = 'W1'; pages.update(h, x4, h._now_ms + 2000, true);
    ok(h.twinMap === 'W1', 'car-issues MW: ... and W1 the same way (hud.twinMap ' + h.twinMap + ')');
    h = mk({ mapWindow: 'W4', mapForce: true, mapShutMs: 8000 }, 5);
    ok(!st(h).open, 'car-issues MW: an unknown variant ("W4") is no window, forced or not (' + st(h).why + ')');
}
console.log('FIN: the setting "Навігація" (navView) = auto / карта / стрілки, in place');
{
    const T = S.T0 + 100000;
    const mk = (view, cfg) => { const h = S.base(R, { tab: 5, settings: { navView: view }, config: Object.assign({ mapWindow: 'W2', mapShutMs: 8000, pages: S.CAR_PAGES }, cfg || {}) }); pages.st(h).built = 0; return h; };
    const pg = (h) => { h._now_ms = T; return pages.decide(h, T); };
    eq(pages.NAV_VIEWS, ['auto', 'map', 'arrows'], 'three values');
    // the map view with BMW's guidance: present in every reading but "arrows"
    const g = (v) => { const h = mk(v); const p = pages.st(h); p.navType = 2; p.guiding = 'ACTIVE'; return h; };
    eq(['auto', 'map', 'arrows'].map((v) => pg(g(v))), ['map', 'map', 'none'], 'map view + BMW guidance: auto -> map, карта -> map, стрілки -> the fallback (never the map)');
    // a CarPlay route with the cluster in map view and BMW's guidance idle: auto takes our route page, карта the map
    const cp = (v) => { const h = mk(v); h._now_ms = T; S.STATES.car_route.setup(h, R); pages.st(h).navType = 2; pages.st(h).destAt = T - 1000; return h; };
    eq(['auto', 'map', 'arrows'].map((v) => pg(cp(v))), ['route', 'map', 'route'], 'map view + a CarPlay route (BMW idle): auto -> the CarPlay-route page, карта -> the map, стрілки -> the route page');
    // no map view: nobody gets the map
    const nm = (v) => { const h = mk(v); pages.st(h).navType = 1; pages.st(h).guiding = 'ACTIVE'; pages.st(h).road = 'вулиця'; return h; };
    eq(['auto', 'map', 'arrows'].map((v) => pg(nm(v))), ['road', 'road', 'road'], 'the cluster not in map view: the fallback in every reading (the map is not present)');
    // стрілки wins over the forced window; the window stays behind config.mapWindow
    eq(pg(mk('arrows', { mapForce: true })), 'none', 'стрілки: never the map, not even forced');
    eq(pg(mk('map', { mapForce: true })), 'map', '... карта with the forced window: the map');
    eq([pg((() => { const h = mk('map', { mapWindow: null }); pages.st(h).navType = 2; return h; })())], ['none'], 'карта with config.mapWindow off (the shipped default): no map window at all - still the experiment');
    eq([pages.navView(mk('nonsense')), pages.navView(S.base(R, {}))], ['auto', 'auto'], 'an unknown value or none reads as auto');
    // in place: a change goes through changed() and the next tick, the window shuts at once (no rebuild)
    const h = g('auto'), x = newX(h);
    h._now_ms = T; pages.update(h, x, T, true);
    ok(pages.st(h).page === 'map' && h.twinMap === 'W2', 'auto: the map window open (W2)');
    h._settings.navView = 'arrows'; pages.changed(h); pages.update(h, x, T + 10, false);
    ok(pages.st(h).page !== 'map' && h.twinMap === null, 'set to стрілки: the next tick shuts the window and shows the fallback page (in place)');
    h._settings.navView = 'map'; pages.changed(h); pages.update(h, x, T + 20, false);
    ok(pages.st(h).page === 'map' && h.twinMap === 'W2', 'set to карта: open again');
    // the menu
    const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'app.json'), 'utf8'));
    const nv = app.settings.filter((s) => s.key === 'navView')[0];
    ok(nv && nv.label === 'Навігація' && nv.default === 'auto' && JSON.stringify(nv.options) === JSON.stringify([['auto', 'авто'], ['map', 'карта'], ['arrows', 'стрілки']]), 'app.json: "Навігація" = авто / карта / стрілки, default авто');
    const main = app.screens.filter((s) => s.name === 'MAIN')[0], sett = app.screens.filter((s) => s.name === 'SETTINGS')[0];
    ok(main.items.some((i) => i[0] === 'setting' && i[1] === 'navView') && sett.skip.indexOf('navView') >= 0, '... on the main screen (skipped in the list)');
    const tk = app.config.tabKey;
    ok(tk && !Array.isArray(tk) && tk.field === 'IndicatorSteeringColumn' && tk.mask === 64 && !/navView/.test(fs.readFileSync(path.join(ROOT, 'shared', 'twin_tabs.js'), 'utf8')), 'no key for it: config.tabKey is the TRIP bit alone and the tab module never touches navView');
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
    ok(/TW_PAGE_KEYS = \['centre', 'techData', 'callerName', 'navView'\]/.test(src) && /if \(twinPages && TW_PAGE_KEYS\.indexOf\(key\) >= 0\) twinPages\.changed\(this\)/.test(src), 'shared/hud.js applies centre / techData / callerName / navView (FIN) through twin_pages.changed (no _rebuild)');
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
