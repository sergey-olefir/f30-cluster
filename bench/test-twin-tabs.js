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
// fixes-1121 TT (the owner, 2026-11-21): app.json now ships config.tabs.messageTab false - a message selects no tab, it shows inside
// every tab (section 1b). The blocks that check the LEGACY rule (a message pulls tab 2: 0.1.9, still one config key away) say so: mkL
const LEGACY = Object.assign({}, APP.config.tabs, { messageTab: true });
const mkL = (over) => mk(Object.assign({ tabs: LEGACY }, over || {}));

// ---------------------------------------------------------------------------------------------------------------------
console.log('1. the rules (the legacy rule 1: config.tabs.messageTab true)');
{
    const h = mkL();
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
    // rule 2: a call, gated by config.tabs.callSelects (car-fix CF3: on in app.json since the car showed the call state)
    const h = mk({ tabs: Object.assign({}, LEGACY, { callSelects: false }) });
    sel(h);
    h.td.callState = 1;
    eq(sel(h), 1, 'a ringing call with config.tabs.callSelects off: tab 1 stays (the rule is switched off)');
    const g = mkL();
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
    // car-fix CF3: rule 3 for a CarPlay route (hud.td.route from shared/twin_pages.js: provider CAR_PLAY, a destination within 60 s),
    // the same lock speed and message priority as BMW's guidance
    const h = mkL();
    sel(h);
    h.td.route = true;
    eq(sel(h), 5, 'CF3: a CarPlay route starts (auto, standing): tab 5');
    msg(h, 'window');
    eq(sel(h), 2, 'CF3: a message during the CarPlay route: tab 2');
    msg(h, 'none');
    eq(sel(h), 5, 'CF3: the message ends: tab 5 again (the route still on)');
    h.td.route = false;
    eq(sel(h), 1, 'CF3: the route ends (no destination for 60 s): back to the driver\'s choice');
    const g = mkL();
    sel(g);
    g._d.speed = 60; g.td.route = true;
    eq(sel(g), 1, 'CF3: a CarPlay route at 60 km/h with the lock at 5: the change waits');
    msg(g, 'window');
    eq(sel(g), 2, 'CF3: a message at speed is never held: tab 2');
    msg(g, 'none');
    eq(sel(g), 1, 'CF3: the message ends at speed: back to tab 1, the held route rule still waits');
    g._d.speed = 3;
    eq(sel(g), 5, 'CF3: slowed to 3 km/h: the held change happens (tab 5)');
    g.td.callState = 2;
    eq(sel(g), 4, 'CF3: a call during the CarPlay route outranks it (rule 2 before 3)');
    g.td.callState = 0;
    eq(sel(g), 5, 'CF3: the call ends: the route takes tab 5 back');
}
{
    // the lock speed
    const h = mkL();
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
    const h = mkL({ settings: { tab: '5' } });
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
    const h = mkL();
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
    const k = mkL({ tabKey: { iface: 'i', field: 'f', press: [1], rateMs: 0 } });
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
    const o = mkL(); sel(o);
    o.td.nav = true; eq(sel(o), 5, 'guidance: tab 5');
    tabs.press(o, 1);
    eq(sel(o), 1, 'the key leaves tab 5 (to 1, next after 5)');
    eq(sel(o), 1, 'guidance still on: the driver\'s override holds (no pull back to 5 every tick)');
    o.td.nav = false; sel(o); o.td.nav = true;
    eq(sel(o), 5, 'guidance ends and starts again: the rule applies again');
}

// ---------------------------------------------------------------------------------------------------------------------
// fixes-1121 TT (the owner, 2026-11-21: "the message is shown within the tab, and the tabs switch as usual"): app.json's own rules
console.log('1b. fixes-1121 TT: a message selects no tab, TRIP always steps (app.json config.tabs.messageTab false)');
{
    eq(APP.config.tabs.messageTab, false, 'app.json ships config.tabs.messageTab false');
    const h = mk();
    eq(sel(h), 1, 'start: tab 1');
    msg(h, 'window', 'red'); eq(sel(h), 1, 'a message appears (window): tab 1 stays (the band shows it inside tab 1)');
    msg(h, 'ours', 'red'); eq(sel(h), 1, 'ours: still tab 1');
    msg(h, 'none'); eq(sel(h), 1, 'the message ends: tab 1 (nothing moved)');
    eq(h.tabs.changes, 0, 'not one tab change in all of that');
    // the key with a message, through every tab (tab 2 is in the cycle while an entry is listed)
    const k = mk({ tabKey: { iface: 'i', field: 'f', press: [1], rateMs: 0 } });
    const ex = {}; tabs.wire(k, ex); sel(k);
    const f = (x) => { k._now_ms += 10; ex.i.f(x); };
    k.ccListAll = [{ id: 15 }];
    msg(k, 'ours', 'amber'); sel(k);
    f(0);
    const seen = [];
    for (let i = 0; i < 6; i++) { f(1); f(0); sel(k); seen.push(k.tabs.tab); }
    eq(seen, [2, 3, 4, 5, 1, 2], 'TRIP with a message on: 1 -> 2 -> 3 -> 4 -> 5 -> 1 -> 2, every press one tab, nothing pulls back');
    f(1); f(0); sel(k);
    eq(k.tabs.tab, 3, 'one more press: tab 3');
    msg(k, 'none'); sel(k);
    eq(k.tabs.tab, 3, 'the message ends: the tab the driver chose (3) stays');
    msg(k, 'window', 'red'); sel(k);
    eq(k.tabs.tab, 3, 'a new message (a new episode): tab 3 stays - no pull to tab 2');
    msg(k, 'none'); sel(k); msg(k, 'window', 'red'); sel(k); msg(k, 'none'); sel(k); msg(k, 'ours', 'red'); sel(k);
    eq(k.tabs.tab, 3, 'a message that flickers (window / none / window / none / ours, as BMW re-shows it): tab 3 throughout');
    // the rules 2-4 and the lock keep their meaning; the key is never locked
    const g = mk(); sel(g);
    g._d.speed = 60; g.td.nav = true;
    eq(sel(g), 1, 'guidance at 60 km/h with the lock at 5: the change waits (tabLock keeps its meaning)');
    msg(g, 'window', 'red');
    eq(sel(g), 1, 'a message at 60 km/h: no tab (the message is inside tab 1)');
    tabs.press(g, 1);
    eq(sel(g), 3, 'the key at 60 km/h with a message: never locked (1 -> 3: no entry listed here, tab 2 skipped)');
    msg(g, 'none'); g._d.speed = 3;
    eq(sel(g), 3, 'slowed down, the message gone: the driver\'s override of guidance holds (tab 3)');
    g.td.nav = false; sel(g); g.td.nav = true;
    eq(sel(g), 5, 'guidance starts again, slow: rule 3 still selects tab 5');
    msg(g, 'window', 'red'); g.td.callState = 2;
    eq(sel(g), 4, 'a call during a message: rule 2 selects tab 4 (a message no longer outranks it: it shows inside tab 4)');
    // the setting
    const s = mk({ settings: { tab: '5' } });
    eq(sel(s), 5, 'setting tab = 5: tab 5');
    msg(s, 'ours', 'amber'); eq(sel(s), 5, 'fixed 5 and a message: tab 5 stays (the band inside tab 5)');
    tabs.press(s, 1); eq(sel(s), 5, 'fixed 5: the key is ignored, as before (the setting fixes the tab)');
    s._settings.tab = '2'; eq(sel(s), 2, 'the setting changed to 2: tab 2 (the card)');
    msg(s, 'none'); eq(sel(s), 2, 'the message ends: tab 2 stays (the setting)');
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
    const h = mkL();      // fixes-1121 TT: the legacy rule pulls tab 2 for a message (this block checks the titles)
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
    // FIN: the media widget's box spans the GROWN media cell (780-1168, tab 2 hidden) right of the warning icon's box; its ink stays in the cell it has now (section 8)
    ok(inCell(IC('tab_warn_i'), 1) && IC('tab_media').x >= 780 && IC('tab_media').x + IC('tab_media').w <= 1168 && inCell(IC('tab_phone_i'), 3) && inCell(IC('tab_nav_i'), 4), 'tabs 2..5: every widget lies inside its cell (the media box inside the grown cell 780-1168)');
    const tw = IC('tab_range_u'); const unitInk = tw.x + (tw.w - 3);
    ok(unitInk <= 778, 'tab 1: the unit "км" ends at x ' + unitInk + ', inside the cell with room to the separator (780)');
    ok(boxesIn([IC('tab_range_i'), IC('tab_warn_i'), IC('tab_media'), IC('tab_phone_i'), IC('tab_nav_i')]), 'the icon boxes lie inside the bar\'s height band y 124..170 (the rule is y 170..173)');
    const boxes = W.filter((w) => w.id.indexOf('tab_') === 0);
    let overlaps = 0;
    boxes.forEach((a, i) => boxes.forEach((b, j) => { if (j > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++; }));
    eq(overlaps, 0, 'no two tab-bar boxes overlap (an overlap costs the engine a sheet)');
    ok(['td_tab', 'td_tabs'].indexOf(byId.tab_range_v.font) >= 0, 'the range value is Noto 33 / 34 (' + byId.tab_range_v.font + ': td_tabs once B6\'s atlas is in the tree)');
    ok(!byId.tab_media_t, 'the old media text widget is gone: the media cell is one live widget');
    ok(byId.tab_media.w === 321 && byId.tab_media.x === 837 && byId.tab_media.h === 46 && byId.tab_media.y === 124 && byId.tab_media.x === byId.tab_warn_i.x + byId.tab_warn_i.w && JSON.stringify(byId.tab_media.seps) === '[780,848,1168,1237]' && byId.tab_media.leftMost === byId.tab_warn_i.x,
        'FIN: the media widget runs from the warning icon\'s box to the cell\'s end less 10 px, as tall as an icon box [837, 124, 1158, 170], and carries the separators');
}
{
    // icons: no dimming, the variant is the state (a stored message is listed: tab 2 is in the bar - FIN; section 8 covers the bar without it)
    const h = mk(); h.ccListAll = [{ id: 987, ignored: false }];
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
    // the media cell: icon + text centred as ONE group, clipped with an ellipsis (tab 2 in the bar: a stored message listed - FIN)
    const h = mk(); h.ccListAll = [{ id: 987, ignored: false }];
    h.theme = { fg: [255, 255, 255, 255], bg: [0, 0, 0, 255] };
    const w = byId.tab_media;
    const box = (text) => {
        const buf = tabs.paintMedia(h, w, 'td_radio', [255, 255, 255, 255], text);
        let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
        for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) if (buf[(y * w.w + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        return { x0, x1, y0, y1, buf };
    };
    const cx = 1008;                 // FIN: the cell 848-1168's middle (the widget's box is wider now: it reaches into the grown cell)
    const a = box('');
    ok(Math.abs((w.x + (a.x0 + a.x1 + 1) / 2) - 1008) <= 1.5, 'icon only (until the media probe): centred in the cell (middle ' + (w.x + (a.x0 + a.x1 + 1) / 2) + ', the cell\'s is 1008)');
    const b = box('Radio One');
    ok(Math.abs((w.x + (b.x0 + b.x1 + 1) / 2) - cx) <= 3, 'icon + text: the group\'s middle is the cell\'s (' + (w.x + (b.x0 + b.x1 + 1) / 2) + ' against ' + cx + ')');
    ok(b.x1 - b.x0 > a.x1 - a.x0 + 40, 'the text is beside the icon (the group is wider than the icon)');
    const longT = 'A very long station name that cannot fit in the cell at all, really';
    const c = box(longT);
    ok(c.x0 + w.x >= 858 && c.x1 + w.x < 1158 && c.x1 - c.x0 <= 300, 'a long text is cut to the cell less 10 px each side, 858-1158 (' + (c.x1 - c.x0 + 1) + ' of 300 px)');
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
    const h = mkL();      // fixes-1121 TT: the legacy rule (a message pulls tab 2)
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
        h.ccListAll = [{ id: 987, ignored: false }];      // FIN: a stored message listed - tab 2 in the bar (section 8: without it)
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

// ---------------------------------------------------------------------------------------------------------------------
console.log('8. FIN: tab 2 is hidden while there is no message (the owner, 2026-11-18)');
{
    const live = (h) => { h._twinTabsOn = () => true; return h; };
    // what counts as "a message"
    let h = live(mk());
    ok(!tabs.messagePresent(h) && !tabs.tab2Shown(h), 'nothing heard (no list, displayed not spoken): no message, tab 2 hidden');
    h.ccListAll = [{ id: 0, ignored: true }]; h.ccDisp = 0; h.ccDispAny = true; h.config.ccActive = { noneValues: [0] };
    ok(!tabs.messagePresent(h) && !tabs.tab2Shown(h), 'the car at rest (ccList only the resting id 0, displayed 0): hidden');
    h.ccListAll = [{ id: 0, ignored: true }, { id: 987, ignored: false }];
    ok(tabs.messagePresent(h) && tabs.tab2Shown(h), 'a stored entry listed (displayed 0): shown');
    h.ccListAll = [{ id: 0, ignored: true }]; h.ccDisp = 285;
    ok(!tabs.messagePresent(h) && !tabs.tab2Shown(h), 'displayed 285 with no list entry (BMW\'s unlisted message, its own panel shows it): hidden - no flicker of the bar');
    h.ccDisp = 65535;
    ok(!tabs.tab2Shown(h), 'displayed 65535 (unknown, the end of a drive): hidden');
    h.ccListAll = [{ id: 0, ignored: true }, { id: 15, ignored: false }];
    ok(tabs.tab2Shown(h), '... 65535 with an entry listed: shown (the list decides)');
    h.ccListAll = [{ id: 0, ignored: true }]; h.ccDisp = 0; h.twinCc = { state: 'window', severity: null };
    ok(!tabs.tab2Shown(h), 'a window with no severity (the keep-open of a car not read yet) is no message: hidden');
    h.twinCc = { state: 'none', severity: null }; h.tabs = tabs.fresh(); h.tabs.tab = 2;
    ok(tabs.tab2Shown(h), 'tab 2 selected (the setting fixed to 2): shown - a selected tab never vanishes under its fill');
    h.tabs.tab = 1; h.tabs.hold = 2;
    ok(tabs.tab2Shown(h), 'tab 2 held (the open settle after leaving it): shown');
    const off = mk(); off._twinTabsOn = () => false;
    ok(tabs.tab2Shown(off), 'live tabs off (the round 2 look, a stand-in app): always shown');

    // the bar's x positions
    const g5 = tabs.barGeometry([780, 848, 1168, 1237], [618, 127, 1302, 172], true), g4 = tabs.barGeometry([780, 848, 1168, 1237], [618, 127, 1302, 172], false);
    eq([g5.seps, g5.cells], [[780, 848, 1168, 1237], [[618, 780], [780, 848], [848, 1168], [1168, 1237], [1237, 1302]]], 'with tab 2: separators 780 / 848 / 1168 / 1237, cells 618-780 / 780-848 / 848-1168 / 1168-1237 / 1237-1302');
    eq([g4.seps, g4.cells], [[780, 1168, 1237], [[618, 780], null, [780, 1168], [1168, 1237], [1237, 1302]]], 'without: separators 780 / 1168 / 1237; tab 1 keeps 618-780, the media cell grows to 780-1168, tabs 4 and 5 unchanged');

    // the backdrop: the separators are uniforms (no shader change), the media cell's fill follows
    h = live(mkL()); sel(h);      // fixes-1121 TT: the legacy rule (a message pulls tab 2, lines below)
    const b = backdrop(h);
    eq(b.last('u_sep'), [780, 1168, 1237, -10], 'no message: u_sep [780, 1168, 1237, off] - the separator at 848 is gone');
    h._settings.tab = '3'; sel(h);
    eq(b.last('u_hi').slice(0, 3), [780, 1168, 1], 'tab 3 selected without tab 2: its fill spans the grown cell 780-1168');
    h.ccListAll = [{ id: 15, ignored: false }]; HudApp.prototype._twinSync.call(h);
    eq([b.last('u_sep'), b.last('u_hi').slice(0, 3)], [[780, 848, 1168, 1237], [848, 1168, 1]], 'a message listed: the four separators again in the same sync, tab 3\'s fill 848-1168');
    h.ccListAll = []; HudApp.prototype._twinSync.call(h);
    eq(b.last('u_sep'), [780, 1168, 1237, -10], 'gone again: three separators');
    h._settings.tab = 'auto'; sel(h);
    msg(h, 'window', 'red'); sel(h);
    eq([h.tabs.tab, b.last('u_sep'), b.last('u_hi').slice(0, 2)], [2, [780, 848, 1168, 1237], [780, 848]], 'a message shows: tab 2 appears in its place and is selected (rule 1), its cell 780-848');
    msg(h, 'none'); sel(h);
    eq([h.tabs.tab, b.last('u_sep'), b.last('u_hi').slice(0, 2)], [3, [780, 1168, 1237, -10], [780, 1168]], 'the message ends: back to the tab before it (3, the driver\'s choice), tab 2 hidden again, tab 3\'s fill 780-1168');
    const sh = require(path.join(dir, 'shaders.js'));
    ok(Buffer.byteLength(sh.tdbackFor('L'), 'utf8') <= 6144 && /uniform vec4 u_sep;/.test(sh.tdbackFor('L')), 'tdback part L is unchanged in kind: u_sep a uniform, ' + Buffer.byteLength(sh.tdbackFor('L'), 'utf8') + ' bytes after compact() (<= 6 KB)');

    // the key skips the hidden tab
    h = live(mk({ tabKey: null }));
    sel(h);
    const steps = []; for (let i = 0; i < 5; i++) { tabs.press(h, 1); steps.push(h.tabs.tab); }
    eq(steps, [3, 4, 5, 1, 3], 'no message: the key steps 1 -> 3 -> 4 -> 5 -> 1 (tab 2 skipped)');
    h.ccListAll = [{ id: 987, ignored: false }];
    const steps2 = []; for (let i = 0; i < 5; i++) { h._now_ms += 1000; tabs.press(h, 1); steps2.push(h.tabs.tab); }
    eq(steps2, [4, 5, 1, 2, 3], 'a stored message listed: tab 2 is in the cycle again');

    // the icons: the warning widget paints no warning icon while hidden; the media group centres on the grown cell's middle (974)
    h = live(mk()); sel(h);
    h.theme = { fg: [255, 255, 255, 255], bg: [0, 0, 0, 255] };
    const mw = byId.tab_media, ww = byId.tab_warn_i;
    h.widgets = new Map([['tab_media', { w: mw, ref: 1 }], ['tab_warn_i', { w: ww, ref: 2 }]]);
    const got = {};
    h._blitDiff = (x, buf) => { got[x.w.id] = Buffer.from(buf); };
    const inkX = (id, w) => { const p = got[id], o = []; if (!p) return o; for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) if (p[(y * w.w + x) * 4 + 3] > 40) o.push(x + w.x); return o; };
    const paintBoth = () => { twin.updateIcon(h, { w: ww, last: null }, 0, true); twin.updateIcon(h, { w: mw, last: null }, 0, true); };
    const span = () => { const xs = inkX('tab_warn_i', ww).concat(inkX('tab_media', mw)); return xs.length ? [Math.min.apply(null, xs), Math.max.apply(null, xs) + 1] : null; };
    paintBoth();
    let sp = span();
    ok(inkX('tab_warn_i', ww).length === 0 && sp && Math.abs((sp[0] + sp[1]) / 2 - 974) <= 1.5, 'tab 2 hidden, icon only: no warning icon; the media icon centred on the grown cell 780-1168 (middle ' + (sp && (sp[0] + sp[1]) / 2) + ')');
    h.td.media = 'A long station name that runs well past three hundred pixels wide, surely';
    paintBoth(); sp = span();
    ok(sp && sp[0] >= 791 && sp[1] <= 1158 && sp[1] - sp[0] > 330 && inkX('tab_warn_i', ww).length > 0, 'a long text uses the grown cell (' + (sp && sp[0]) + '-' + (sp && sp[1]) + ', ' + (sp && sp[1] - sp[0]) + ' px > the 300 with tab 2): the warning widget paints its left slice');
    h.ccListAll = [{ id: 15, ignored: false }]; h.td.media = '';
    paintBoth(); sp = span();
    const wi = inkX('tab_warn_i', ww), mi = inkX('tab_media', mw);
    ok(wi.length > 0 && Math.abs((Math.min.apply(null, wi) + Math.max.apply(null, wi) + 1) / 2 - 814) <= 1.5 && mi.length && Math.abs((Math.min.apply(null, mi) + Math.max.apply(null, mi) + 1) / 2 - 1008) <= 1.5,
        'a message listed: the warning icon back at 814, the media icon back on 1008 (the cell 848-1168)');
    const ks = { w: ww, last: null }; h.ccListAll = []; twin.updateIcon(h, ks, 0, false); const k1 = ks.last;
    h.ccListAll = [{ id: 15, ignored: false }]; twin.updateIcon(h, ks, 0, false);
    ok(/^hidden\|/.test(k1) && !/^hidden\|/.test(ks.last), 'the warning widget\'s repaint key changes when tab 2 comes and goes');
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
        ok(hud.tabs.tab === 5 && builds - b0 === 0, 'a message state: tab 5 stays (fixes-1121 TT: a message selects no tab), no build');
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
        // FIN: tab 2 hidden with no message, on the real engine with the real machine (the car's ccList and displayed number). After the
        // build count above: the first list ends the engine's blind case, which is one build of its own (hud.js, not this package)
        const cl = APP.config.ccList, cd = APP.config.ccDisplayed;
        const feedList = (es) => hu.feed(cl.iface, cl.field, es.map((e) => ({ cCListElement: { cCIdentifer: e.id, cCShortName: e.name, cCColor: e.color, cCListSymbolID: e.symbol } })));
        const feedDisp = (n) => hu.feed(cd.iface, cd.field, { statusNumberCheckControlMessageDisplay: n });
        const REST = { id: 0, name: '', color: 'GREEN', symbol: 6 }, DOOR = { id: 15, name: 'Driver door open', color: 'WHITE', symbol: 2 }, STORED = { id: 987, name: 'Ready to drive', color: 'GREEN', symbol: 6 };
        const sepNow = () => { const x = hud.widgets.get('bg_l'), l = x && x.c.layers.get(x.ref), k = l && Object.keys(l.uniforms || {}).find((n) => /:u_sep$/.test(n)); return k ? String(l.uniforms[k].v).trim().split(/[\s,]+/).map(Number) : null; };
        const warnKey = () => String((hud.widgets.get('tab_warn_i') || {}).last);
        feedList([REST]); feedDisp(0); await sleep(250);
        eq([hud.tabs.tab, sepNow()], [1, [780, 1168, 1237, -10]], 'the car at rest (ccList id 0, displayed 0): tab 2 not in the bar (u_sep 780 / 1168 / 1237)');
        ok(/^hidden\|/.test(warnKey()), 'the warning widget paints no warning icon (' + warnKey().slice(0, 12) + ')');
        feedList([REST, DOOR]); feedDisp(15); await sleep(400);
        eq([hud.tabs.tab, sepNow(), hud.twinMsg.page && hud.twinMsg.page.kind], [1, [780, 848, 1168, 1237], 'band'],
            'the door message: tab 2 appears in its place (u_sep 780 / 848 / 1168 / 1237); tab 1 stays selected, the message is the band inside it (fixes-1121 TT)');
        ok(!/^hidden\|/.test(warnKey()), 'the warning icon is back');
        feedList([REST]); await sleep(100); feedDisp(0); await sleep(500);
        eq([hud.tabs.tab, sepNow()], [1, [780, 1168, 1237, -10]], 'the message ends (list at rest, then displayed 0): tab 1, tab 2 hidden again');
        feedList([REST, STORED]); await sleep(250);
        eq([hud.tabs.tab, sepNow()], [1, [780, 848, 1168, 1237]], 'a stored entry listed with displayed 0: tab 2 in the bar, not selected');
        feedList([REST]); await sleep(250);
        eq(sepNow(), [780, 1168, 1237, -10], '... and gone with it');
        // FIN (the lead / the owner): an unlisted number (285 type, BMW's own panel shows it, ~6 s on the car) selects no tab and does not
        // bring tab 2 into the bar; BMW's fallback window stays open the whole time (tdback u_win.x 1)
        const winNow = () => { const x = hud.widgets.get('bg_l'), l = x && x.c.layers.get(x.ref), k = l && Object.keys(l.uniforms || {}).find((n) => /:u_win$/.test(n)); return k ? Number(String(l.uniforms[k].v).trim().split(/[\s,]+/)[0]) : null; };
        const t285 = Date.now(), seen285 = { tabs: {}, seps: {}, win: {} }, log285 = logs.length;
        feedDisp(285);
        while (Date.now() - t285 < 6000) { await sleep(100); seen285.tabs[hud.tabs.tab] = 1; seen285.seps[JSON.stringify(sepNow())] = 1; seen285.win[winNow()] = 1; }
        eq([Object.keys(seen285.tabs), Object.keys(seen285.seps), Object.keys(seen285.win)], [['1'], ['[780,1168,1237,-10]'], ['1']],
            'displayed 285 with no ccList entry for 6 s: tab 1 the whole time (no selection), tab 2 never in the bar, BMW\'s window open throughout (u_win.x 1)');
        ok(hud.twinCc.state === 'window' && hud.twinMsg.t.unlisted === true && !logs.slice(log285).some((l) => /tabs: tab \d -> /.test(l)),
            '... the machine says window (unlisted); no tab move in the log');
        feedDisp(0); await sleep(300);
        eq([hud.tabs.tab, winNow()], [1, 0], '285 ends (displayed 0): tab 1, the window shut');
        feedDisp(65535); await sleep(400);
        eq([hud.tabs.tab, sepNow(), tabs.messagePresent(hud)], [1, [780, 1168, 1237, -10], false], 'displayed 65535 (unknown) with the list at rest: no pull, tab 1, tab 2 out of the bar');
        feedDisp(0); await sleep(300);
        eq([hud.tabs.tab, sepNow()], [1, [780, 1168, 1237, -10]], '... displayed 0: still out');
        // twin_dial 0.1.2: the setting "Таба = 2" taken while a message holds tab 2. The tab does not MOVE, so the machine was never told
        // (it kept its old base, tab 1): once the message ended, the bar said tab 2 and the machine painted nothing - an empty page with
        // stored messages in the list (seen in the 0.1.1 state gallery). The machine's tab must follow the tab rules outside a message period.
        const agree = () => [hud.tabs.tab, hud.twinMsg.tab];
        eq(hud.twinMsg.tab, hud.tabs.tab, '0.1.2: after everything above (messages come and gone, tabs fixed and freed) the machine stands on the bar\'s tab (bar ' + hud.tabs.tab + ', machine ' + hud.twinMsg.tab + ')');
        const toTab1 = async () => { press('tab', '3'); await sleep(120); press('tab', '1'); await sleep(120); press('tab', 'auto'); await sleep(200); };      // two real moves: both sides on tab 1, auto
        await toTab1();
        eq(agree(), [1, 1], '... both on tab 1, the setting auto');
        feedList([REST, DOOR]); feedDisp(15); await sleep(400);
        press('tab', '2'); await sleep(200);
        feedList([REST, STORED]); await sleep(100); feedDisp(0); await sleep(600);
        eq([hud.tabs.tab, hud.twinMsg.state, hud.twinMsg.tab, hud.twinMsg.page && hud.twinMsg.page.kind], [2, 'none', 2, 'list'],
            '0.1.2: tab fixed to 2 during a message, the message ends with a stored entry left: the machine is on tab 2 too and paints the list page');
        feedList([REST]); await sleep(300);
        eq([hud.tabs.tab, hud.twinMsg.tab, hud.twinMsg.page && hud.twinMsg.page.kind], [2, 2, 'empty'], '... the list at rest: still tab 2 (the setting holds it), the empty page');
        await toTab1();
        // the gallery's own case (and every start of the app with "Таба = 2" saved): the setting is taken while the machine keeps BMW's panel
        // open without a message (the "shown now" number unknown, 65535: a period with no severity). Then the car says 0 with a stored entry.
        feedDisp(65535); await sleep(400);
        const blind = hud.twinMsg.state, before = agree();
        press('tab', '2'); await sleep(200);
        feedList([REST, STORED]); await sleep(100); feedDisp(0); await sleep(600);
        eq([blind, before, hud.tabs.tab, hud.twinMsg.state, hud.twinMsg.tab, hud.twinMsg.page && hud.twinMsg.page.kind], ['window', [1, 1], 2, 'none', 2, 'list'],
            '0.1.2: tab fixed to 2 while the panel is kept open with nothing known (65535), then displayed 0 with a stored entry: tab 2 paints the list page');
        feedList([REST]); await sleep(300);
        await toTab1();
        // fixes-1121 TT (the owner, 2026-11-21: on Twin, with a message active, TRIP did not switch the tabs): the car's TRIP bytes (bit 0x40
        // of IndicatorSteeringColumn, 0.15 s held, 0.5 s apart) through every tab while the door message shows; the bar, the machine, the sheet
        // and the centre page agree after every press, the message is inside each tab (the band; the card on tab 2), ours once settled
        const K = APP.config.tabKey;
        const trip = async () => { hu.feed(K.iface, K.field, { operationColumnStalks: 0x40 }); await sleep(150); hu.feed(K.iface, K.field, { operationColumnStalks: 0 }); await sleep(350); };
        hu.feed(K.iface, K.field, { operationColumnStalks: 0 }); await sleep(100);
        feedList([REST, DOOR]); feedDisp(15); await sleep(400);
        const tt = [{ bar: hud.tabs.tab, machine: hud.twinMsg.tab, kind: hud.twinMsg.page && hud.twinMsg.page.kind, state: hud.twinMsg.state, pg: hud.tdp && hud.tdp.page, ink: ((hud.widgets.get('c_page') || {}).pgInk || []).map((q) => q.id + ':' + q.box[3]) }];
        for (let i = 0; i < 6; i++) { await trip(); tt.push({ bar: hud.tabs.tab, machine: hud.twinMsg.tab, kind: hud.twinMsg.page && hud.twinMsg.page.kind, state: hud.twinMsg.state, pg: hud.tdp && hud.tdp.page, ink: ((hud.widgets.get('c_page') || {}).pgInk || []).map((q) => q.id + ':' + q.box[3]) }); }
        eq(tt.map((x) => x.bar), [1, 2, 3, 4, 5, 1, 2], 'TT: the door message on, six TRIP presses as the car sends them: 1 -> 2 -> 3 -> 4 -> 5 -> 1 -> 2');
        ok(tt.every((x) => x.machine === x.bar), 'TT: after every press the message machine stands on the bar\'s tab (' + tt.map((x) => x.bar + '/' + x.machine).join(' ') + ')');
        eq(tt.map((x) => x.kind), ['band', 'card', 'band', 'band', 'band', 'band', 'card'], 'TT: the message inside every tab: the band on 1, 3, 4, 5, the card on 2');
        ok(tt.every((x) => x.state === 'ours'), 'TT: ours (our text for the door on the screen, BMW\'s panel covered) after the settle on every tab: ' + tt.map((x) => x.state).join(' '));
        eq(tt.map((x) => x.pg), ['clock', 'msg', 'media', 'phone', 'none', 'clock', 'msg'], 'TT: the centre page follows the tab (clock / messages / media / phone / navigation / clock / messages)');
        ok(hud._twinBandTop() === null, 'TT: no band on tab 2');
        const low = (x) => Math.max.apply(null, x.ink.map((q) => Number(q.split(':')[1])).concat([0]));
        ok(tt.filter((x) => x.kind === 'band').every((x) => low(x) <= 514 + 12), 'TT: on every band tab the page draws nothing the band (top 514) would slice: lowest ink ' + tt.map((x) => low(x)).join(' '));
        await trip();
        const top = hud._twinBandTop(), pgx = hud.widgets.get('c_page');
        ok(hud.tabs.tab === 3 && top === 514 && !!pgx, 'TT: on tab 3 the band\'s top is 514 (one line: "Driver door open")');
        feedList([REST, STORED]); await sleep(100); feedDisp(0); await sleep(600);
        eq([hud.tabs.tab, hud.twinMsg.tab, hud.twinMsg.state, hud.twinMsg.page && hud.twinMsg.page.kind, hud._twinBandTop()], [3, 3, 'none', 'other', null],
            'TT: the message ends on tab 3 (a stored entry left): tab 3 stays (the driver\'s), the band is gone');
        await trip();
        eq([hud.tabs.tab, hud.twinMsg.tab, hud.twinMsg.page && hud.twinMsg.page.kind], [4, 4, 'other'], 'TT: and TRIP goes on as usual');
        feedList([REST]); feedDisp(0); press('tabLock', '5'); await sleep(300);
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
    // car-fix CF3: the car showed the call state (aggregatedCallState DISCONNECTED / DIALING / ACTIVE, 2026-11-18): rule 2 is on
    eq([APP.config.tabs.callSelects, APP.config.tabs.messageTab, APP.config.tabs.lockAboveKmh], [true, false, 5], 'config.tabs: callSelects on (car-fix CF3: the call state arrives), a message selects no tab (fixes-1121 TT), lock 5');
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
