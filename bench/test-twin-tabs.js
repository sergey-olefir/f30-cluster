'use strict';
/**
 * test-twin-tabs.js - Twin Dial's live tabs and the tab bar (round 3 build, package B2; SPEC-R3 section 3).
 *
 *   node bench/test-twin-tabs.js
 *
 * Part 1, no bench, no car: the real engine's methods (shared/hud.js from a temp tree, bench/twin-harness.js) on a HudApp
 * whose only inputs are what shared/twin_tabs.js reads (the settings "tab" / "tabLock", hud.twinCc, the guidance and call
 * states in hud.td, the speed), and a stand-in effect-layer client that keeps every uniform the backdrop sends. It checks
 *   1. the rules: start on tab 1; a message selects tab 2 in every mode (never waiting) and the tab before it comes back;
 *      guidance selects tab 5; a call selects tab 4 only with config.tabs.callSelects; the lock speed holds an automatic
 *      change and never a message; a fixed setting wins; the driver MAY leave tab 2 while a message shows (key and
 *      setting) and then stays where he went; a rule the driver overrode stays overridden until its own state changes;
 *   2. the key (config.tabKey): a level counts on its rising edge only, a bit mask, an 8-bit counter, "any change", the rate
 *      limit, the field's own handler still runs; tab 2 is stepped onto only when a message is listed;
 *   3. the centre follows (titles and the computer pages' texts by tab) and the bottom row follows the tab: two lines on
 *      tab 1, ONE line (clock left, temperature right, upper baseline) elsewhere, both in the layout;
 *   4. the tab bar's geometry (SPEC-R3 3.1): separators, 36 px icons, the 18 px inset, nothing across a separator, the
 *      3 px rule; and its icons: NO icon dimmed, the state is the variant (fall back to the plain icon a build lacks),
 *      the warning icon white / red / amber, the media cell's icon + text centred as one group with an ellipsis;
 *   5. the backdrop: the selected cell filled in its tab's colour (the table), never a message's severity, the night
 *      multiplier, a change sends the dynamic uniforms only;
 *   6. in place: every tab setting routes to _twinTabsChanged, never a rebuild - and, on the real engine against a
 *      stand-in cluster-render, the layout is built ONCE however the settings and tabs are changed (the builds are counted);
 *   7. hygiene: app.json, f30_cluster untouched, Node 8 syntax, no text in a log line.
 * Node 18 or newer (Mac). Never shipped. Part 6's second half builds into dist/ and uses apps/twin_tabs_test/ while it runs.
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');
const H = require('./twin-harness');

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const eq = (a, b, what) => { const k = JSON.stringify(a) === JSON.stringify(b); ok(k, what + (k ? '' : ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = H.tree('twin_dial');
const HudApp = require(path.join(dir, 'hud.js'));
const twin = require(path.join(dir, 'twin_tokens.js'));
const tabs = require(path.join(dir, 'twin_tabs.js'));
const icons = require(path.join(dir, 'icons.js'));
require(path.join(dir, 'twin_icons.js'));          // the app's pictograms join icons.ICONS (main.js does the same)
const APP = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'apps', 'twin_dial', 'app.json'), 'utf8'));
const L = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'apps', 'twin_dial', 'hud', 'layouts', 'twin.json'), 'utf8'));
const W = L.widgets, byId = {};
W.forEach((w) => { byId[w.id] = w; });
const BACK_L = W.find((w) => w.type === 'tdback' && w.part === 'L');

const T0 = Date.UTC(2026, 10, 17, 12, 43, 20);
function mk(over) {
    const o = over || {};
    const lines = [];
    const logger = { info: (s) => lines.push(String(s)), warn: (s) => lines.push(String(s)), error: (s) => lines.push(String(s)), debug() {} };
    const h = H.fakeHud(HudApp, { settings: Object.assign({ tab: 'auto', tabLock: '5' }, o.settings || {}), log: logger,
        config: { twin: { cyclePageMs: 10000, holdAboveKmh: 5 }, tabs: o.tabs === undefined ? Object.assign({}, APP.config.tabs) : o.tabs,
            trip: { factors: null }, tabKey: o.tabKey === undefined ? null : o.tabKey } });
    h.td = twin.fresh(); h.td.clock = () => h._now_ms;
    h._now_ms = T0; h.tzCar = 120;
    h._d = { speed: 0, rpm: 0, stage: 'P', gear: 0 };
    h.twinLayout = true;
    h.twinCc = { state: 'none', severity: null };
    h.widgets = new Map();
    h.lines = lines;
    h._guard = (what, fn) => fn();
    return h;
}
const sel = (h) => { HudApp.prototype._twinSync.call(h); return h.tabs ? h.tabs.tab : null; };
const msg = (h, state, sev) => { h.twinCc = { state, severity: sev === undefined ? 'amber' : sev }; };

// ---------------------------------------------------------------------------------------------------------------------
console.log('1. the rules');
{
    const h = mk();
    eq(sel(h), 1, 'start: tab 1 (the on-board computer)');
    eq(tabs.available(), [1, 2, 3, 4, 5], 'five tabs exist (the setting may fix any of them)');
    msg(h, 'window', null);
    eq(sel(h), 1, 'a window with no severity (the keep-open of a car not read yet, a blind start) is no message: tab 1 stays');
    msg(h, 'window', 'red');
    eq(sel(h), 2, 'a message appears (window): tab 2 at once');
    msg(h, 'ours', 'red');
    eq(sel(h), 2, 'the message on our card (ours): still tab 2');
    msg(h, 'none');
    eq(sel(h), 1, 'the message ends: back to the tab before it (1)');
    h.td.nav = true;
    eq(sel(h), 5, 'rule 3: guidance starts (auto, standing): tab 5');
    msg(h, 'window');
    eq(sel(h), 2, 'a message during guidance: tab 2');
    msg(h, 'none');
    eq(sel(h), 5, 'the message ends: tab 5 again (guidance still on)');
    h.td.nav = false;
    eq(sel(h), 1, 'guidance ends: back to the driver\'s last choice (1)');
}
{
    // rule 2: a call, built and gated off
    const h = mk();
    sel(h);
    h.td.callState = 1;
    eq(sel(h), 1, 'a ringing call with config.tabs.callSelects off: tab 1 stays (the rule is built, switched off)');
    const g = mk({ tabs: Object.assign({}, APP.config.tabs, { callSelects: true }) });
    sel(g);
    g.td.callState = 1;
    eq(sel(g), 4, 'callSelects on: a ringing call selects tab 4');
    g.td.callState = 2;
    eq(sel(g), 4, 'the call runs: tab 4');
    g.td.nav = true;
    eq(sel(g), 4, 'guidance starting during the call: the call outranks it (rule 2 before 3)');
    msg(g, 'window');
    eq(sel(g), 2, 'a message outranks a call: tab 2');
    msg(g, 'none');
    eq(sel(g), 4, 'the message ends: the call is still on, tab 4');
    g.td.callState = 0;
    eq(sel(g), 5, 'the call ends: guidance (still on) takes over, tab 5');
    g.td.nav = false;
    eq(sel(g), 1, 'guidance ends: the driver\'s choice');
}
{
    // the lock speed
    const h = mk();
    sel(h);
    h._d.speed = 60;
    h.td.nav = true;
    eq(sel(h), 1, 'guidance starts at 60 km/h with the lock at 5: the change waits (tab 1 stays)');
    msg(h, 'window');
    eq(sel(h), 2, 'a message at 60 km/h is never held by the lock: tab 2');
    msg(h, 'none');
    eq(sel(h), 1, 'the message ends at speed: back to the tab before it (1), the held guidance rule still waits');
    h._d.speed = 4;
    eq(sel(h), 5, 'the car slows to 4 km/h: the held change happens (tab 5)');
    h._d.speed = 60;
    h.td.nav = false;
    eq(sel(h), 5, 'guidance ends at 60 km/h: the return to the driver\'s choice waits (tab 5 stays)');
    h._d.speed = 0;
    eq(sel(h), 1, 'stopped: the held return happens (tab 1)');
    h._settings.tabLock = '0';
    h.td.nav = true; h._d.speed = 120;
    eq(sel(h), 5, 'tabLock 0 (off): guidance at 120 km/h moves the tab at once');
    eq(tabs.lockKmh(h), null, 'tabLock "0" reads as no lock');
    h._settings.tabLock = '30';
    eq(tabs.lockKmh(h), 30, 'tabLock "30" reads as 30 km/h');
    const noset = mk({ settings: {} });
    delete noset._settings.tabLock;
    noset.ctx.settings.item = (k) => (k === 'tab' ? { key: k } : null);
    eq(tabs.lockKmh(noset), 5, 'no tabLock setting: config.tabs.lockAboveKmh (5)');
}
{
    // fixed setting
    const h = mk({ settings: { tab: '5' } });
    eq(sel(h), 5, 'setting tab = 5: tab 5 (no guidance needed)');
    msg(h, 'ours');
    eq(sel(h), 2, 'fixed 5 and a message: tab 2 (the message lives on tab 2 in every mode)');
    msg(h, 'none');
    eq(sel(h), 5, 'the message ends: the fixed tab again');
    h._settings.tab = '3';
    eq(sel(h), 3, 'the setting changed to 3: tab 3 (all five tabs exist)');
    h._settings.tab = 'auto';
    eq(sel(h), 3, 'back to auto: the tab the driver fixed stays his last choice (no jump)');
    h.td.nav = true;
    eq(sel(h), 5, 'auto and guidance starts: tab 5');
    h._settings.tab = '1';
    eq(sel(h), 1, 'the setting 1 during guidance: tab 1 (the driver\'s word wins)');
    h._settings.tab = 'auto';
    eq(sel(h), 5, 'back to auto with guidance still on: the rule applies again (tab 5)');
    h._settings.tab = '9';
    eq(tabs.mode(h), 'auto', 'a value that is no tab reads as auto');
}
{
    // leaving tab 2 while a message shows
    const h = mk();
    sel(h);
    msg(h, 'window');
    eq(sel(h), 2, 'a message: tab 2');
    const moved = [];
    h._twinTabMoved = (a, b, why) => moved.push(a + '>' + b);
    h._settings.tab = '3';
    eq(sel(h), 3, 'the driver fixes tab 3 while the message shows: he leaves tab 2 (allowed)');
    eq(moved, ['2>3'], 'hud._twinTabMoved(2, 3) told package B3 in the same turn');
    ok(h.twinCc.state === 'window', 'the message is still on (B3 keeps the panel open)');
    msg(h, 'none');
    eq(sel(h), 3, 'the message ends: the driver\'s tab stays (not pulled back)');
    h._settings.tab = 'auto';
    // the key
    const k = mk({ tabKey: { iface: 'i', field: 'f', press: [1], rateMs: 0 } });
    const ex = {}; tabs.wire(k, ex); sel(k);
    msg(k, 'ours'); sel(k);
    const f = (x) => { k._now_ms += 10; ex.i.f(x); };
    k.ccListAll = [{ id: 15 }];
    f(0); f(1);
    eq(k.tabs.tab, 3, 'the key during a message: leaves tab 2 for the next tab (3)');
    msg(k, 'none'); sel(k);
    eq(k.tabs.tab, 3, 'the message ends: the key\'s tab stays');
    msg(k, 'window'); sel(k);
    eq(k.tabs.tab, 2, 'a new message episode pulls the driver back to tab 2');
    // a rule the driver overrode stays overridden
    const o = mk(); sel(o);
    o.td.nav = true; eq(sel(o), 5, 'guidance: tab 5');
    tabs.press(o, 1);
    eq(sel(o), 1, 'the key leaves tab 5 (to 1, next after 5)');
    eq(sel(o), 1, 'guidance still on: the driver\'s override holds (no pull back to 5 every tick)');
    o.td.nav = false; sel(o); o.td.nav = true;
    eq(sel(o), 5, 'guidance ends and starts again: the rule applies again');
}

// ---------------------------------------------------------------------------------------------------------------------
// integration (B7): the key as the car sends it (app.json config.tabKey, verified 2026-11-18: 0 -> 0x40 -> 0 per press, ~0.15 s held, ~0.5 s apart)
console.log('2a. the car\'s TRIP button (app.json config.tabKey, injected bytes)');
{
    const K = APP.config.tabKey;
    const h = mk({ tabKey: K });
    const extra = {};
    eq(tabs.wire(h, extra), 1, 'app.json\'s key wires one handler on ' + K.iface + ' ' + K.field);
    sel(h);
    h.ccListAll = [{ id: 15 }];                       // a listed message: tab 2 exists in the cycle (1 -> 2 -> 3 ...)
    const f = (x, ms) => { h._now_ms += (ms || 150); extra[K.iface][K.field]({ operationColumnStalks: x }); };
    f(0x00, 500);
    const t0 = h.tabs.tab;
    f(0x40); eq(h.tabs.tab, 2, 'a press (0 -> 0x40, the rising edge): one tab on (' + t0 + ' -> 2)');
    f(0x40); eq(h.tabs.tab, 2, 'held (0x40 again, 150 ms later): nothing');
    f(0x00); eq(h.tabs.tab, 2, 'released (0x40 -> 0, the falling edge): nothing');
    f(0x40, 500); f(0x00);
    eq(h.tabs.tab, 3, 'the next press 0.5 s later: one more tab (2 -> 3)');
    f(0x01, 500); f(0x02); f(0x81); f(0x00);
    eq(h.tabs.tab, 3, 'other bits (0x01, 0x02, 0x80) rising and falling: ignored');
    f(0x41, 500);
    eq(h.tabs.tab, 4, 'bit 0x40 rising with another bit set (0x41): a press');
    f(0x00, 500); f(255, 500); f(0x40, 500);
    eq(h.tabs.tab, 4, '255 (the unfilled default, every bit set) is no state: neither 0 -> 255 nor 255 -> 0x40 is a press');
    f(0x00, 500); f(0x40, 500);
    eq(h.tabs.tab, 5, 'after a real 0, the next rising edge is a press again');
    let moved = 0;
    for (let i = 0; i < 17; i++) { f(0x00, 350); const was = h.tabs.tab; f(0x40, 150); if (h.tabs.tab !== was) moved++; }
    f(0x00, 150);
    eq(moved, 17, 'seventeen presses as the car sent them (0 / 0x40, 0.15 s held, 0.5 s apart): seventeen tab steps');
}

console.log('2. the key (config.tabKey)');
{
    const SW = 'de.bmw.infotainment.controlelements.SteeringWheelPushButton';
    const ownSeen = [];
    const h = mk({ tabKey: { iface: SW, field: 'statusSpecialFunctionButton2', path: ['operationPushButtonSpecialFunction2'], press: [1, 'TASTER_GEDRUECKT'], rateMs: 300 } });
    const extra = { [SW]: { statusSpecialFunctionButton2: (v) => ownSeen.push(v) } };
    let resent = 0;
    eq(tabs.wire(h, extra, () => { resent++; }), 1, 'one key source wired');
    sel(h);
    h.ccListAll = [];
    const f = (x) => { h._now_ms += 400; extra[SW].statusSpecialFunctionButton2({ operationPushButtonSpecialFunction2: x }); };
    f(0);
    eq(h.tabs.tab, 1, 'the first value (released) is not a press');
    f(1);
    eq(h.tabs.tab, 3, 'press (1), no message listed: the next tab that exists, 3 (tab 2 is skipped)');
    ok(resent === 1, 'the engine\'s resend was called once');
    f(1);
    eq(h.tabs.tab, 3, 'still held (1 again): no second step (rising edge only)');
    f(0); f('TASTER_GEDRUECKT');
    eq(h.tabs.tab, 4, 'released, pressed again (by enum name): tab 4');
    f(0); f(1);
    eq(h.tabs.tab, 5, 'tab 5');
    f(3); f(0); f(1);
    eq(h.tabs.tab, 1, 'invalid (3), released, pressed: wraps to tab 1');
    h.ccListAll = [{ id: 15 }];
    f(0); f(1);
    eq(h.tabs.tab, 2, 'a message is listed: tab 2 is stepped onto');
    ok(ownSeen.length === 12, 'the field\'s own handler still ran for every value (' + ownSeen.length + ')');
    h._now_ms += 400; extra[SW].statusSpecialFunctionButton2({ operationPushButtonSpecialFunction2: 0 });
    h._now_ms += 50; extra[SW].statusSpecialFunctionButton2({ operationPushButtonSpecialFunction2: 1 });
    const t1 = h.tabs.tab;
    h._now_ms += 50; extra[SW].statusSpecialFunctionButton2({ operationPushButtonSpecialFunction2: 0 });
    h._now_ms += 50; extra[SW].statusSpecialFunctionButton2({ operationPushButtonSpecialFunction2: 1 });
    eq(h.tabs.tab, t1, 'a second press 100 ms after the first: the rate limit (300 ms) drops it');
    eq(h.tabs.choice, t1, 'the driver\'s choice is the key\'s tab');
    h._settings.tab = '1'; sel(h);
    f(0); f(1);
    eq(h.tabs.tab, 1, 'the setting fixes tab 1: the key is ignored');
    h._settings.tab = 'auto'; sel(h);
    h._d.speed = 90; f(0); f(1);
    ok(h.tabs.tab !== 1, 'at 90 km/h the driver\'s key still works (never locked)');
}
{
    const FES = 'x.Stalk';
    const h = mk({ tabKey: { iface: FES, field: 'IndicatorSteeringColumn', path: ['operationColumnStalks'], mask: 0x40, rateMs: 0 } });
    const extra = {};
    tabs.wire(h, extra); sel(h);
    h.ccListAll = [{ id: 15 }];
    const f = (x) => { h._now_ms += 10; extra[FES].IndicatorSteeringColumn({ operationColumnStalks: x }); };
    f(0x00); f(0x01);
    eq(h.tabs.tab, 1, 'mask 0x40: the turn-signal bit (0x01) is not our key');
    f(0x41);
    eq(h.tabs.tab, 2, 'bit 0x40 rises (0x41, with the indicator on): next tab');
    f(0x40);
    eq(h.tabs.tab, 2, 'bit 0x40 still set: no step');
}
{
    const SW = 'sw';
    const h = mk({ tabKey: { iface: SW, field: 'statusRotarySteps', path: ['operationStepsKnurlSteeringWheel'], counter: true, rateMs: 0 } });
    const extra = {};
    tabs.wire(h, extra); sel(h);
    h.ccListAll = [{ id: 15 }];
    const f = (x) => { h._now_ms += 10; extra[SW].statusRotarySteps({ operationStepsKnurlSteeringWheel: x }); };
    f(254);
    eq(h.tabs.tab, 1, 'a step counter: the first value only sets the base');
    f(255);
    eq(h.tabs.tab, 2, 'counter +1: next tab');
    f(0);
    eq(h.tabs.tab, 3, 'counter 255 -> 0 (wrap, +1): next tab');
    f(255);
    eq(h.tabs.tab, 2, 'counter 0 -> 255 (wrap, -1): previous tab');
}
{
    const h = mk({ tabKey: { iface: 'hc', field: 'currentICWidget', any: true, rateMs: 0 } });
    const extra = {};
    tabs.wire(h, extra); sel(h);
    h.ccListAll = [{ id: 15 }];
    const f = (x) => { h._now_ms += 10; extra.hc.currentICWidget(x); };
    f(17);
    eq(h.tabs.tab, 1, 'any: true (an indirect key): the first value only sets the base');
    f(17);
    eq(h.tabs.tab, 1, 'the same value again: no step');
    f(23);
    eq(h.tabs.tab, 2, 'the value changed (the cluster\'s widget moved): next tab');
}
{
    const h = mk({ tabKey: null });
    eq(tabs.wire(h, {}), 0, 'config.tabKey null: nothing wired');
    const h2 = mk({ tabKey: [{ iface: 'a', field: 'f', instance: '2', press: [1] }, { iface: 'a', field: 'g', instance: '3', press: [1] }] });
    eq(tabs.wire(h2, {}), 1, 'two entries asking for two instances of one interface: the second is refused (logged)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('3. the centre and the bottom row follow the tab');
{
    const h = mk();
    sel(h);
    eq(h._token('td:cTitle'), 'Дата і час', 'tab 1: the computer\'s clock page title, as before');
    ok(h._token('td:cTime') !== '', 'tab 1: the clock page\'s time is drawn');
    msg(h, 'window'); sel(h);
    eq(h._token('td:cTitle'), 'Повідомлення', 'tab 2: the messages title');
    ok(h._token('td:cTime') === '' && h._token('td:tDist') === '', 'tab 2: the computer pages\' texts are empty (their widgets repaint blank)');
    msg(h, 'none'); h._settings.tab = '3'; sel(h);
    eq(h._token('td:cTitle'), 'Медіа', 'tab 3: the media title');
    h._settings.tab = '4'; sel(h);
    eq(h._token('td:cTitle'), 'Телефон', 'tab 4: the phone title');
    h._settings.tab = '5'; sel(h);
    eq(h._token('td:cTitle'), 'Навігація', 'tab 5: the navigation title');
    h.tabs.hold = 2;
    eq(tabs.pageOf(h), 'msg', 'hud.tabs.hold (package B3) keeps the previous page up');
    h.tabs.hold = null;
    const off = mk({ tabs: null });
    off.td.nav = true; msg(off, 'window');
    HudApp.prototype._twinSync.call(off);
    ok(!off.tabs && off._token('td:cTitle') === 'Дата і час', 'config.tabs off: no tab state, the round 2 pages');
}
{
    // the bottom row: both lines in the layout, the tokens choose
    const row = ['row_l1', 'row_l1u', 'row_l2', 'row_r1', 'row_r1u', 'row_r2', 'row_r2u'].map((id) => byId[id]);
    ok(row.every(Boolean) && row.every((w) => /\{\{td:row/.test(w.text)), 'the layout carries both lines: seven row widgets with the row tokens');
    const h = mk();
    h.rangeKm = 412; h.ambient = 7.5; h.td.mileage = 48215; h._d = { speed: 0 };
    h.car.live = {}; h._raw = (n) => (n === 'range' ? 412 : n === 'ambient' ? 7.5 : n === 'speed' ? 0 : null);
    const rowText = () => ['row_l1', 'row_l1u', 'row_l2', 'row_r1', 'row_r1u', 'row_r2', 'row_r2u'].map((id) => h._resolve(byId[id].text));
    sel(h);
    const two = rowText();
    eq(two[0], '48' + twin.THIN + '215', 'tab 1: line 1 left is the odometer');
    eq([two[1], two[2], two[4]], ['км', '14:43', 'км'], 'tab 1: units km, line 2 left is the clock');
    eq([two[5], two[6]], ['+7.5', '°C'], 'tab 1: line 2 right is the temperature');
    h._settings.tab = '3'; sel(h);
    const one = rowText();
    eq(one, ['14:43', '', '', '+7.5', '°C', '', ''], 'tab 3: ONE line - the clock left and the temperature right (°C after it), the lower line empty');
    eq(byId.row_l1.y + 40 > 0 && [byId.row_l1, byId.row_r1].map((w) => w.y + 31), [byId.row_l1.y + 31, byId.row_r1.y + 31], 'both one-line texts are the upper row\'s widgets (baseline 656)');
    h._settings.tab = '1'; sel(h);
    eq(rowText(), two, 'back on tab 1: the two lines are back');
    const offHud = mk({ tabs: null });
    offHud._raw = h._raw; offHud.td.mileage = 48215;
    eq(tabs.rowLines(offHud), 2, 'live tabs off: two lines');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('4. the tab bar: geometry and icons');
{
    const T = L.widgets.find((w) => w.type === 'tdback' && w.part === 'L').tab;
    eq(T.rect, [618, 127, 1302, 172], 'the bar [618, 127, 1302, 172]');
    eq(T.seps, [780, 848, 1168, 1237], 'separators at x 780 / 848 / 1168 / 1237 (SPEC-R3 3.1)');
    eq(T.rule, [170, 173], 'the rule under the bar is 3 px (y 170-173)');
    eq(T.highlight, [780, 848], 'the round 2 warning cell is tab 2\'s cell');
    const cells = [[618, 780], [780, 848], [848, 1168], [1168, 1237], [1237, 1302]];
    const boxesIn = (ws) => ws.every((w) => w.y >= 124 && w.y + w.h <= 170);
    const inCell = (w, i) => w.x >= cells[i][0] && w.x + w.w <= cells[i][1];
    const IC = (id) => byId[id];
    // SPEC-R3 3.1 "icons 36 px" is the INK height (SF: the references' 36 against ours 29): the drawings' ink is ~0.79 of the box, the box is 46 (K2's mockups)
    ok(['tab_range_i', 'tab_warn_i', 'tab_phone_i', 'tab_nav_i'].every((id) => IC(id).w === 46 && IC(id).h === 46 && IC(id).y + 23 === 147), 'the icon boxes are 46 x 46 on the centre line y 147 (36 px of ink, as the approved mockups)');
    const inkOf = (name) => { const it = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'apps', 'twin_dial', 'hud', 'icons', 'icons.json'), 'utf8')).items.find((i) => i.name === name && i.slot === 'tab'); return it.box.map((v, k) => v / (k % 2 ? it.h : it.w)); };
    const inkBox = (id) => { const w = IC(id), f = inkOf(w.icon); return [w.x + f[0] * 46, w.y + f[1] * 46, w.x + f[2] * 46, w.y + f[3] * 46]; };
    ok(Math.abs(inkBox('tab_range_i')[0] - 636) <= 1, 'tab 1\'s icon: its INK starts 18 px from the bar\'s left end (x 636): ' + inkBox('tab_range_i')[0].toFixed(1));
    const mid = (id) => { const b = inkBox(id); return (b[0] + b[2]) / 2; };
    ok(Math.abs(mid('tab_warn_i') - 814) <= 1 && Math.abs(mid('tab_phone_i') - 1202.5) <= 1.5 && Math.abs(mid('tab_nav_i') - 1269.5) <= 1.5, 'the ink of tabs 2, 4 and 5 is centred in its cell (814 / 1202.5 / 1269.5): ' + ['tab_warn_i', 'tab_phone_i', 'tab_nav_i'].map((id) => mid(id).toFixed(1)).join(' / '));
    ok(IC('tab_warn_i').tdLive === 'warn' && IC('tab_phone_i').tdLive === 'phone' && IC('tab_nav_i').tdLive === 'nav' && IC('tab_media').tdLive === 'media', 'tabs 2..5 carry live icons (their variant follows the state)');
    ok(inCell(IC('tab_range_i'), 0) && inCell(IC('tab_range_v'), 0) && inCell(IC('tab_range_u'), 0), 'tab 1: the icon, the range value and its unit lie inside the cell (nothing across the separator at 780)');
    ok(inCell(IC('tab_warn_i'), 1) && inCell(IC('tab_media'), 2) && inCell(IC('tab_phone_i'), 3) && inCell(IC('tab_nav_i'), 4), 'tabs 2..5: every widget lies inside its cell');
    const tw = IC('tab_range_u'); const unitInk = tw.x + (tw.w - 3);
    ok(unitInk <= 778, 'tab 1: the unit "км" ends at x ' + unitInk + ', inside the cell with room to the separator (780)');
    ok(boxesIn([IC('tab_range_i'), IC('tab_warn_i'), IC('tab_media'), IC('tab_phone_i'), IC('tab_nav_i')]), 'the icon boxes lie inside the bar\'s height band y 124..170 (the rule is y 170..173)');
    const boxes = W.filter((w) => w.id.indexOf('tab_') === 0);
    let overlaps = 0;
    boxes.forEach((a, i) => boxes.forEach((b, j) => { if (j > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++; }));
    eq(overlaps, 0, 'no two tab-bar boxes overlap (an overlap costs the engine a sheet)');
    ok(['td_tab', 'td_tabs'].indexOf(byId.tab_range_v.font) >= 0, 'the range value is Noto 33 / 34 (' + byId.tab_range_v.font + ': td_tabs once B6\'s atlas is in the tree)');
    ok(!byId.tab_media_t, 'the old media text widget is gone: the media cell is one live widget');
    ok(byId.tab_media.w === 300 && byId.tab_media.x === 858 && byId.tab_media.h === 46 && byId.tab_media.y === 124, 'the media widget fills its cell less 10 px each side, as tall as an icon box [858, 124, 1158, 170]');
}
{
    // icons: no dimming, the variant is the state
    const h = mk();
    h.theme = { fg: [255, 255, 255, 255], grey: [111, 111, 110, 255], bg: [0, 0, 0, 255] };
    const painted = [];
    h._blitDiff = (x, buf) => painted.push(Buffer.from(buf));
    const mkx = (id) => ({ w: byId[id], last: null });
    const phone = mkx('tab_phone_i'), nav = mkx('tab_nav_i'), warn = mkx('tab_warn_i'), media = mkx('tab_media'), range = mkx('tab_range_i');
    const st = (x) => twin.iconState(h, x.w);
    eq([st(phone).color, st(nav).color, st(warn).color, st(media).color], [null, null, null, null], 'with nothing known every icon is white: no icon is ever dimmed');
    eq(st(phone).icon, 'td_phone', 'phone state unknown (until probe P9): the plain handset');
    h.td.phoneConnected = true;
    eq(tabs.resolve(tabs.ICON.phoneBars), icons.ICONS.td_phone_bars ? 'td_phone_bars' : 'td_phone', 'a phone connected: the bars variant (or the plain one while the build lacks it)');
    h.td.phoneConnected = false;
    eq(tabs.resolve(tabs.ICON.phoneOff), icons.ICONS.td_phone_off ? 'td_phone_off' : 'td_phone', 'no phone: the crossed-out variant (or the plain one)');
    h.td.nav = true; h.td.call = true;
    eq(st(nav).icon, 'td_nav', 'tab 5 stays the plain arrow (the turn arrow waits for probe P12), lit or not');
    // warning icon
    h.twinCc = { state: 'ours', severity: 'red' };
    eq(st(warn).color, 'red', 'a red message and tab 2 not selected: the warning icon red');
    h.twinCc = { state: 'window', severity: 'amber' };
    eq(st(warn).color, 'amber', 'amber message: amber icon');
    h.twinCc = { state: 'ours', severity: 'green' };
    eq(st(warn).color, null, 'a green or grey message: white');
    h.twinCc = { state: 'ours', severity: 'red' };
    h.tabs = tabs.fresh(); h.tabs.tab = 2;
    eq(st(warn).color, null, 'tab 2 selected: white on the fill, whatever the severity');
    h.tabs.tab = 1; h.twinCc = { state: 'none', severity: null };
    eq(st(warn).color, null, 'no message: white');
    // painting
    h.twinCc = { state: 'ours', severity: 'red' };
    twin.updateIcon(h, warn, 0, false);
    const p = painted[0];
    let rgb = null;
    for (let i = 0; i < p.length; i += 4) if (p[i + 3] > 250) { rgb = [p[i], p[i + 1], p[i + 2]]; break; }
    eq(rgb, tabs.floorCorrect(tabs.SEV_ICON.red), 'the red warning icon is painted in the spec\'s red (218, 16, 48) with the panel\'s black-floor correction');
    twin.updateIcon(h, warn, 50, false);
    eq(painted.length, 1, 'an unchanged icon is not painted again');
    h.twinCc = { state: 'none', severity: null }; twin.updateIcon(h, warn, 100, false);
    eq(painted.length, 2, 'a changed state repaints it');
    h.theme = { fg: [204, 204, 204, 255], grey: [61, 61, 61, 255], bg: [0, 0, 0, 255] };
    twin.updateIcon(h, warn, 150, false);
    eq(painted.length, 3, 'a night change (new theme colours) repaints it');
    eq(painted[0].length, 46 * 46 * 4, 'the pixels are the 46 x 46 RGBA of the widget (36 px of ink)');
    twin.updateIcon(h, range, 0, true);
    eq(painted[painted.length - 1].length, 46 * 46 * 4, 'the range icon is live too');
    ok(W.filter((w) => w.type === 'icon').every((w) => w.tdLive), 'every icon of the layout is live (repainted by twin_tabs.js, so a night change needs no rebuild)');
    h.nightOn = true; h.twinCc = { state: 'ours', severity: 'red' };
    twin.updateIcon(h, warn, 200, true);
    const q = painted[painted.length - 1]; let rgbN = null;
    for (let i = 0; i < q.length; i += 4) if (q[i + 3] > 250) { rgbN = [q[i], q[i + 1], q[i + 2]]; break; }
    ok(rgbN && rgbN[0] < rgb[0], 'by night the severity colour takes the red multiplier');
}
{
    // the media cell: icon + text centred as ONE group, clipped with an ellipsis
    const h = mk();
    h.theme = { fg: [255, 255, 255, 255], bg: [0, 0, 0, 255] };
    const w = byId.tab_media;
    const box = (text) => {
        const buf = tabs.paintMedia(h, w, 'td_radio', [255, 255, 255, 255], text);
        let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
        for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) if (buf[(y * w.w + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        return { x0, x1, y0, y1, buf };
    };
    const cx = (w.x + w.w / 2);
    const a = box('');
    ok(Math.abs((w.x + (a.x0 + a.x1 + 1) / 2) - 1008) <= 1.5, 'icon only (until the media probe): centred in the cell (middle ' + (w.x + (a.x0 + a.x1 + 1) / 2) + ', the cell\'s is 1008)');
    const b = box('Radio One');
    ok(Math.abs((w.x + (b.x0 + b.x1 + 1) / 2) - cx) <= 3, 'icon + text: the group\'s middle is the cell\'s (' + (w.x + (b.x0 + b.x1 + 1) / 2) + ' against ' + cx + ')');
    ok(b.x1 - b.x0 > a.x1 - a.x0 + 40, 'the text is beside the icon (the group is wider than the icon)');
    const longT = 'A very long station name that cannot fit in the cell at all, really';
    const c = box(longT);
    ok(c.x0 >= 0 && c.x1 < w.w && c.x1 - c.x0 <= w.w, 'a long text is cut to the cell (' + (c.x1 - c.x0 + 1) + ' of ' + w.w + ' px)');
    let ell = false;
    { const TR = require(path.join(dir, 'hud_text.js')); ell = TR.loadFont('td_tab').metrics.glyphs['…'] !== undefined; }
    ok(ell, 'td_tab has the ellipsis glyph (the cut text ends in "…")');
    // the text sits on the baseline 156: ink bottom of "Radio One" (no descender) at the baseline row
    const base = 156 - w.y;
    ok(Math.abs(b.y1 - base) <= 2 || b.y1 >= base - 4, 'the text rests on the panel baseline 156 (ink bottom row ' + (b.y1 + w.y) + ')');
    ok(box('Радіо Свобода').x1 > a.x1, 'Cyrillic text paints (Noto)');
    // updateIcon: the text change repaints
    const painted = [];
    h._blitDiff = (x, buf) => painted.push(buf.length);
    const x = { w, last: null };
    twin.updateIcon(h, x, 0, false); twin.updateIcon(h, x, 50, false);
    eq(painted.length, 1, 'the media cell: unchanged, not painted again');
    h.td.media = 'Station'; twin.updateIcon(h, x, 100, false);
    eq(painted.length, 2, 'a new text repaints it');
    h.td.mediaSource = 'projection'; twin.updateIcon(h, x, 150, false);
    ok(painted.length === 3 || tabs.resolve(tabs.ICON.projection) === tabs.resolve(tabs.ICON.media), 'a new source icon repaints it (projection)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('5. the backdrop (the selected cell: package B1 draws it from hud.twinTab; this package writes the tab)');
function backdrop(h) {
    const sent = [];
    const c = { uniform: (ref, name, v) => sent.push([name, Array.isArray(v) ? v.slice() : v]), bind() {} };
    const x = { w: BACK_L, c, ref: 7, ci: 0 };
    h._scene = () => ({ ref: 99, w: 536, h: 112 });
    h.nightOn = false;
    h.widgets = new Map([['bg_l', x]]);
    HudApp.prototype._twinBackInit.call(h, x);
    const last = (n) => { for (let i = sent.length - 1; i >= 0; i--) if (sent[i][0] === n) return sent[i][1]; return null; };
    return { x, sent, last };
}
{
    const h = mk();
    eq(sel(h), 1, 'start');
    eq(h.twinTab, 1, 'hud.twinTab (what the backdrop reads) is 1 at the start');
    [2, 3, 4, 5, 1].forEach((t) => { h._settings.tab = String(t); sel(h); eq(h.twinTab, t, 'setting ' + t + ': hud.twinTab = ' + t); });
    h._settings.tab = 'auto';
    msg(h, 'window', 'amber'); sel(h);
    eq(h.twinTab, 2, 'a message: hud.twinTab = 2');
    msg(h, 'none'); sel(h);
    eq(h.twinTab, 1, 'the message ends: hud.twinTab = 1');
    const hudSrc = fs.readFileSync(path.join(H.ROOT, 'shared', 'hud.js'), 'utf8');
    if (!/this\.twinTab\b/.test(hudSrc)) {
        console.log('  skip the cell\'s uniforms: this branch has no package B1 (shared/hud.js does not read this.twinTab yet); bench/test-twin-tabs.js repeats them after the merge');
    } else {
        // package B1's _twinBackSend is here: the selected cell [x0, x1, on], a colour per tab, never the message's severity
        const b = backdrop(h);
        const r = BACK_L.tab.rect, sp = BACK_L.tab.seps, X = BACK_L.x;
        const cells = [[r[0], sp[0]], [sp[0], sp[1]], [sp[1], sp[2]], [sp[2], sp[3]], [sp[3], r[2]]].map((c) => [c[0] - X, c[1] - X]);
        const col = {};
        [1, 2, 3, 4, 5].forEach((t) => {
            h.twinTab = t; HudApp.prototype._twinSync.call(h);
            const hi = b.last('u_hi');
            eq(hi.slice(0, 3), [cells[t - 1][0], cells[t - 1][1], 1], 'tab ' + t + ' selected: its cell [' + cells[t - 1] + '] is the filled one');
            col[t] = JSON.stringify(b.last('u_hiC'));
        });
        ok(col[1] === col[2] && new Set([col[1], col[3], col[4], col[5]]).size === 4, 'tabs 1 and 2 share the red, 3 / 4 / 5 are amber / green / blue (the colour table)');
        h.twinTab = 2;
        ['red', 'amber', 'green', 'grey'].forEach((sv) => { msg(h, 'ours', sv); HudApp.prototype._twinSync.call(h); eq(JSON.stringify(b.last('u_hiC')), col[2], 'tab 2 with a ' + sv + ' message: the fill is the tab\'s own red (never the severity)'); });
    }
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('6. in place');
{
    const src = fs.readFileSync(path.join(H.ROOT, 'shared', 'hud.js'), 'utf8');
    ok(/const TW_TAB_KEYS = \['tab', 'tabLock', 'centre'\]/.test(src), 'the in-place keys: tab, tabLock, centre');
    // integration (B7): B2's and B4's in-place hooks are ONE handler (the tab keys call _twinTabsChanged, the page keys twinPages.changed)
    const i = src.indexOf("if (TW_TAB_KEYS.indexOf(key) >= 0 && this._twinTabsOn()) this._twinTabsChanged();");
    const j = src.indexOf("else if (key !== 'demo') this._rebuild();");
    ok(i > 0 && j > i, 'the settings handler routes them to _twinTabsChanged before its rebuild fallback');
    const h = mk();
    sel(h);
    const b = backdrop(h);
    let rebuilt = 0;
    h._rebuild = () => { rebuilt++; };
    const n0 = b.sent.length;
    h._settings.tab = '5';
    HudApp.prototype._twinTabsChanged.call(h);
    ok(h.tabs.tab === 5 && h.twinTab === 5 && rebuilt === 0, 'setting tab = 5: tab 5 selected (hud.twinTab 5), nothing rebuilt');
    ok(b.sent.slice(n0).every((e) => /^u_/.test(e[0])), 'the backdrop is told by uniforms only (no layer, no geometry)');
}

async function engineChecks() {
    console.log('   the real engine against a stand-in cluster-render: how many times is the layout built?');
    const ROOT = H.ROOT, APP_ID = 'twin_tabs_test', STAGE = path.join(ROOT, 'dist', APP_ID), APP_DIR = path.join(ROOT, 'apps', APP_ID);
    // a copy of the real app (its shared list, settings, config, layout, fonts, scene) under another id: the real dist/ is left alone
    const spec = JSON.parse(JSON.stringify(APP));
    spec.id = APP_ID; spec.title = 'Twin tabs test'; spec.description = 'test copy of twin_dial (bench/test-twin-tabs.js); never shipped';
    spec.version = '0.0.1'; spec.loggingId = 'OATT'; spec.iconGlyph = 'TT';
    fs.rmSync(APP_DIR, { recursive: true, force: true });
    fs.mkdirSync(APP_DIR, { recursive: true });
    fs.writeFileSync(path.join(APP_DIR, 'app.json'), JSON.stringify(spec, null, 1));
    fs.copyFileSync(path.join(ROOT, 'apps', 'twin_dial', 'main.js'), path.join(APP_DIR, 'main.js'));
    fs.symlinkSync(path.join(ROOT, 'apps', 'twin_dial', 'hud'), path.join(APP_DIR, 'hud'));
    const sdk = path.join(ROOT, 'oap-sdk');
    if (!fs.existsSync(path.join(sdk, 'index.js'))) {
        fs.mkdirSync(sdk, { recursive: true });
        fs.writeFileSync(path.join(sdk, 'index.js'), "'use strict';\n// BENCH_STUB: stands in for BMW's oap-sdk so kit/tools/build.py runs on the Mac. Never ship this.\nthrow new Error('BENCH_STUB oap-sdk');\n");
        fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'oap-sdk', version: '0.0.0-bench-stub', main: 'index.js' }) + '\n');
    }
    const cleanup = () => {
        try { fs.rmSync(APP_DIR, { recursive: true, force: true }); } catch (e) { /* gone */ }
        try { fs.rmSync(STAGE, { recursive: true, force: true }); } catch (e) { /* gone */ }
        try { fs.readdirSync(path.join(ROOT, 'dist')).filter((f) => f.indexOf(APP_ID + '@') === 0).forEach((f) => fs.rmSync(path.join(ROOT, 'dist', f), { force: true })); } catch (e) { /* none */ }
    };
    try {
        execFileSync('python3', [path.join(ROOT, 'kit', 'tools', 'build.py'), APP_ID], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { cleanup(); ok(false, 'the kit builds the app copy: ' + String(e && e.stderr || e).slice(0, 300)); return; }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-tabs-'));
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(path.join(dataDir, 'layouts'), { recursive: true });
    const sockPath = path.join(tmp, 'render.sock');
    // the stand-in cluster-render: accepts every layer and asset, models pixel memory only
    const st = { layers: 0, drops: 0, hellos: 0 };
    const writeEv = (sock, obj) => { const body = Buffer.from(JSON.stringify(obj), 'utf8'), m = Buffer.alloc(5 + body.length); m.writeUInt32LE(body.length + 1, 0); m[4] = 0x4a; body.copy(m, 5); sock.write(m); };
    const server = net.createServer((sock) => {
        let buf = Buffer.alloc(0);
        sock.on('data', (d) => {
            buf = buf.length ? Buffer.concat([buf, d]) : d;
            let off = 0;
            while (buf.length - off >= 5) {
                const len = buf.readUInt32LE(off);
                if (buf.length - off < 4 + len) break;
                const type = buf[off + 4], body = buf.slice(off + 5, off + 4 + len);
                off += 4 + len;
                if (type !== 0x4a) continue;
                let m; try { m = JSON.parse(body.toString('utf8')); } catch (e) { continue; }
                if (m.op === 'hello') { st.hellos++; writeEv(sock, { ev: 'hello', backend: 'twin-tabs-test', targets: 'panel' }); }
                else if (m.op === 'layer' || m.op === 'asset') { st.layers++; writeEv(sock, { ev: 'layer', ref: m.ref, state: 'shown' }); }
                else if (m.op === 'drop') st.drops++;
            }
            buf = buf.slice(off);
        });
        sock.on('error', () => {});
    });
    await new Promise((resolve) => { try { fs.unlinkSync(sockPath); } catch (e) { /* none */ } server.listen(sockPath, resolve); });
    process.env.HUD_CLUSTER_SOCKET = sockPath;
    const logs = [];
    const log = { info: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')), error: (...a) => logs.push('ERROR ' + a.join(' ')), debug: () => {} };
    const { headUnit } = require(path.join(ROOT, 'kit', 'tools', 'hu-stub.js'));
    const hu = headUnit(STAGE, { live: true, dataDir, log, image: () => Promise.resolve() });
    let hud = null, builds = 0;
    const realLoad = Module._load;
    Module._load = function (req) {
        const m = realLoad.apply(this, arguments);
        if (req === './hud' && typeof m === 'function' && !m.__tt) {
            const Wp = class extends m { constructor(ctx) { super(ctx); hud = this; } _rebuildInner() { builds++; return super._rebuildInner(); } };
            Wp.__tt = true;
            return Wp;
        }
        return m;
    };
    try {
        hu.start();
        const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); while (Date.now() < end) { if (fn()) return true; await sleep(20); } return fn(); };
        const started = await until(() => hud && hud.client && hud.client.ready && hud.widgets.size >= 20);
        ok(started, 'the real engine is up with ' + (hud ? hud.widgets.size : 0) + ' widgets of the real layout');
        if (!started) { console.log(logs.slice(-15).join('\n')); return; }
        await sleep(600);
        const press = (key, value) => {
            const s = hu.settings.item(key), comp = hu.ui.comp('SET_' + key.toUpperCase());
            const rows = s.type === 'choice' ? s.options.map((o) => o[0]) : s.steps;
            comp.emit('action', { row: rows.indexOf(value) });
        };
        ok(hud._twinTabsOn() && hud.tabs && hud.tabs.tab === 1, 'live tabs are on in the real app; tab 1 selected at start');
        const b0 = builds, a0 = st.layers;
        for (const v of ['2', '3', '4', '5', '1', 'auto']) { press('tab', v); await sleep(80); }
        eq([hud.tabs.tab, builds - b0], [1, 0], 'the setting "Таба" through all six values: ' + (builds - b0) + ' builds, the tab follows');
        press('tab', '4'); await sleep(80);
        eq(hud.tabs.tab, 4, 'setting 4: tab 4 selected in place');
        press('tab', '1'); press('tab', 'auto');
        ['0', '5', '10', '20', '30', '50'].forEach((v) => press('tabLock', v));
        press('tabLock', '5');
        ['clock', 'trip', 'cycle'].forEach((v) => press('centre', v));
        await sleep(200);
        eq(builds - b0, 0, 'tabLock (six values) and centre (three): still ' + (builds - b0) + ' layout builds');
        eq(st.layers - a0, 0, 'and not one layer or asset was made again (' + (st.layers - a0) + ')');
        // the tab follows the car, in place
        hud.td.nav = true;
        await sleep(200);
        eq([hud.tabs.tab, builds - b0], [5, 0], 'guidance on: tab 5, no build');
        // integration (B7): with B3's machine merged, hud.twinCc is rewritten by _twinPush from the car's (here: no) message; this checks B2's
        // rule alone, so the machine's push is held while the state is injected (B3's own suite drives a real message to tab 2)
        const push0 = hud._ccPush, push1 = hud._twinPush; hud._ccPush = () => {}; hud._twinPush = () => {};
        hud.twinCc = { state: 'window', severity: 'amber' };
        await sleep(200);
        ok(hud.tabs.tab === 2 && builds - b0 === 0, 'a message state: tab 2, no build');
        hud.twinCc = { state: 'none', severity: null };
        hud._ccPush = push0; hud._twinPush = push1;
        hud.td.nav = false;
        await sleep(200);
        ok(hud.tabs.tab === 1 && builds - b0 === 0, 'both end: tab 1, no build');
        const rowTexts = () => ['row_l2', 'row_r2'].map((id) => { const x = hud.widgets.get(id); return x ? hud._resolve(x.w.text) : null; });
        press('tab', '3'); await sleep(150);
        const oneLine = rowTexts();
        press('tab', '1'); await sleep(150);
        const twoLines = rowTexts();
        ok(oneLine.every((t) => t === '') && twoLines.every((t) => t !== ''), 'the bottom row: the lower line is empty off tab 1 and back on tab 1 (' + JSON.stringify(oneLine) + ' / ' + twoLines.length + ' texts)');
        eq(builds - b0, 0, 'the whole run: ' + (builds - b0) + ' layout builds after the first (the start itself built it ' + b0 + ' time(s))');
        ok(!logs.some((l) => /^ERROR/.test(l)), 'no error in the engine\'s log' + (logs.filter((l) => /^ERROR/.test(l))[0] ? ': ' + logs.filter((l) => /^ERROR/.test(l))[0] : ''));
    } finally {
        Module._load = realLoad;
        try { hud && hud.stop(); } catch (e) { /* stopping */ }
        server.close();
        cleanup();
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* gone */ }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
function hygiene() {
    console.log('7. hygiene');
    const keys = APP.settings.map((s) => s.key);
    ok(keys.indexOf('tab') === keys.indexOf('centre') + 1 && keys.indexOf('tabLock') === keys.indexOf('tab') + 1, 'app.json: the settings tab and tabLock right after centre');
    const t = APP.settings.find((s) => s.key === 'tab'), l = APP.settings.find((s) => s.key === 'tabLock');
    eq(t.options.map((o) => o[0]), ['auto', '1', '2', '3', '4', '5'], 'the setting "Таба": авто / 1 / 2 / 3 / 4 / 5');
    eq([t.label, t.default], ['Таба', 'auto'], 'its label and its default (auto)');
    eq(l.options.map((o) => o[0]), ['0', '5', '10', '20', '30', '50'], 'the setting "Не перемикати таби вище": вимк. / 5 / 10 / 20 / 30 / 50 км/год');
    eq([l.label, l.default], ['Не перемикати таби вище', '5'], 'its label and its default (5)');
    const main = APP.screens.find((s) => s.name === 'MAIN');
    ok(main.items.some((i) => i[0] === 'setting' && i[1] === 'tab') && APP.screens.find((s) => s.name === 'SETTINGS').skip.indexOf('tab') >= 0 && APP.screens.find((s) => s.name === 'SETTINGS').skip.indexOf('tabLock') < 0, 'the menu: "Таба" on the main screen, "Не перемикати таби вище" in the settings list');
    ok(APP.shared.indexOf('twin_tabs.js') >= 0, 'app.json packs shared/twin_tabs.js');
    // integration (B7): the car session found the key (2026-11-18): the stalk's TRIP button, bit 0x40 of IndicatorSteeringColumn
    ok(APP.config.tabKey && APP.config.tabKey.iface === 'de.bmw.body.Light' && APP.config.tabKey.field === 'IndicatorSteeringColumn' && APP.config.tabKey.mask === 64 &&
        JSON.stringify(APP.config.tabKey.path) === '["operationColumnStalks"]' && APP.signals['de.bmw.body.Light'].IndicatorSteeringColumn === 's',
        'config.tabKey is the car-verified TRIP button (bit 0x40 of de.bmw.body.Light IndicatorSteeringColumn, declared notifier-only "s")');
    eq([APP.config.tabs.callSelects, APP.config.tabs.messageTab, APP.config.tabs.lockAboveKmh], [false, true, 5], 'config.tabs: callSelects off, a message selects tab 2, lock 5');
    const F30 = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'apps', 'f30_cluster', 'app.json'), 'utf8'));
    ok((F30.shared || []).indexOf('twin_tabs.js') < 0 && !F30.config.tabs, 'f30_cluster does not pack the module and has no config.tabs');
    const d2 = H.tree('f30_cluster', ['twin_tabs.js', 'twin_tokens.js', 'twin_cc.js', 'twin_probe.js']);
    let loaded = false;
    try { const E = require(path.join(d2, 'hud.js')); loaded = typeof E === 'function' && typeof E.prototype._twinTabsOn === 'function' && E.prototype._twinTabsOn.call({ twinLayout: true, config: { tabs: {} } }) === false; } catch (e) { loaded = false; }
    ok(loaded, 'an engine without twin_tabs.js loads, and its live tabs are off');
    const src = fs.readFileSync(path.join(H.ROOT, 'shared', 'twin_tabs.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    ok(!/\?\.|\?\?|\.\.\.[a-zA-Z(]|\bcatch\s*\{|\*\*/.test(src), 'Node 8 syntax: no ?. ?? spread, optional catch binding or **');
    ok(!/Object\.fromEntries|\.flat\(|\.flatMap\(/.test(src), 'no Object.fromEntries / flat (Node 8)');
    ok(!/setValue|callMethod|\.set\(|\.call\(p|proxy\(/.test(src), 'the module never writes to the car or calls a method');
    const h = mk({ tabKey: { iface: 'i', field: 'f', press: [1], rateMs: 0 } });
    const ex = {}; tabs.wire(h, ex); sel(h); h.ccListAll = [{ id: 15 }];
    ex.i.f(0); ex.i.f(1); h._now_ms += 10; ex.i.f('some free text'); ex.i.f(0); ex.i.f(1);
    ok(h.lines.every((l) => l.indexOf('some free text') < 0), 'a text value is never logged ("?" instead)');
    ok(h.lines.some((l) => /^tabs: tab 1 -> 2 \(K key\)$/.test(l)), 'the log line: "tabs: tab 1 -> 2 (K key)"');
    ok(h.lines.every((l) => !/[Ѐ-ӿ]/.test(l)), 'no Cyrillic (no text of the car) in any tab log line');
    // the check_signals tool still passes (no new signal is declared by this package)
    let sig = 'not run';
    const cat = path.join(H.ROOT, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json');
    if (!fs.existsSync(cat)) console.log('  skip tools/signals/check_signals.py: the car\'s catalogue (reference/, git-ignored) is not in this checkout');
    else {
        try { execFileSync('python3', [path.join(H.ROOT, 'tools', 'signals', 'check_signals.py'), cat, path.join(H.ROOT, 'apps', 'twin_dial', 'app.json')], { cwd: H.ROOT, stdio: ['ignore', 'pipe', 'pipe'] }); sig = 'ok'; } catch (e) { sig = 'FAILED ' + String(e && e.stdout || '').slice(-200); }
        ok(sig === 'ok', 'tools/signals/check_signals.py passes on apps/twin_dial/app.json (no signal is added by this package)');
    }
}

(async () => {
    try { await engineChecks(); } catch (e) { ok(false, 'the real-engine run threw: ' + (e && e.stack || e)); }
    hygiene();
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
