'use strict';
/**
 * twin-centre-states.js - the centre pages' states (round 3, package B4): what bench/test-twin-centre.js renders and
 * tools/twin-dial/r3b/b4_gallery.js draws. Every text is invented and neutral (no real place, name, title or number).
 * Never shipped.
 *
 *   const S = require('./twin-centre-states');
 *   const rig = S.rig();                      // { H, HudApp, twin, pages, THEMES, layout, widget }
 *   const hud = S.make(rig, 'trip');          // a fake engine in that state; S.render(rig, hud) paints through pages.update
 */
const fs = require('fs');
const path = require('path');
const H = require('./twin-harness');

function rig() {
    const dir = H.tree('twin_dial');
    const HudApp = require(path.join(dir, 'hud.js'));
    const twin = require(path.join(dir, 'twin_tokens.js'));
    const pages = require(path.join(dir, 'twin_pages.js'));
    const { THEMES } = require(path.join(dir, 'hud_themes.js'));
    require(path.join(dir, 'twin_icons.js'));
    const layout = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'apps', 'twin_dial', 'hud', 'layouts', 'twin.json'), 'utf8'));
    const widget = layout.widgets.filter((w) => w.type === 'tdpage')[0];
    return { H, HudApp, twin, pages, THEMES, layout, widget, dir };
}

const T0 = Date.UTC(2026, 10, 17, 12, 43, 20);        // a Tuesday, 12:43 UTC; the car's zone UTC+2

/** A fake engine ready for the pages: clock, zone, data, the twin theme, one captured layer. */
function base(R, over) {
    const o = over || {};
    const h = R.H.fakeHud(R.HudApp, { settings: Object.assign({ centre: 'cycle', techData: 'show', callerName: 'off' }, o.settings || {}), config: o.config || {} });
    h.td = R.twin.fresh(); h.td.clock = () => h._now_ms;
    h._now_ms = T0; h.tzCar = 120;
    h._d = Object.assign({ speed: 0, rpm: 0, condition: 10, stage: 'P', gear: 0, oil: 104, coolant: 92 }, o.data || {});
    h.theme = R.THEMES.twin;
    h.ambient = 7.5; h.rangeKm = 412; h.boostFes = 0.42; h.boostFesAt = Date.now();
    h.tabs = { tab: o.tab || 1 };
    h.nightOn = false;
    h.captured = null;
    h._blitDiff = (x, buf) => { x.px = buf; h.captured = buf; };
    h.widgets = new Map();
    return h;
}

const TRIP = { avg: { speed1: 410, cons1: 68, speed2: 1, cons2: 1 }, travel: { hours: 0, minutes: 43, way: 124 }, start: { h: 14, m: 0 } };
const FACT = { trip: { factors: { bc: 1, speed: 0.1, cons: 0.1, way: 0.1 } } };

const WIRED = {       // handler input the fields really carry (shapes from the catalogue), neutral text
    media: { firstLineText: 'Ранкова хвиля', firstLineType: 'TITLE', secondLineText: 'Гурт Приклад', secondLineType: 'ARTIST', uiType: 'TWO_LINES' },
};

/**
 * The states: id -> { tab, page (what must show), setup(h, R) }. `setup` fills the engine the way the signal handlers do
 * (through wire() where the field has a handler), so the tests exercise the real path.
 */
const STATES = {
    clock: { tab: 1, page: 'clock', over: { settings: { centre: 'clock' } } },
    trip: { tab: 1, page: 'trip', over: { settings: { centre: 'trip' }, config: FACT }, setup: (h) => { Object.assign(h.td, TRIP); } },
    trip_empty: { tab: 1, page: 'trip', over: { settings: { centre: 'trip' }, config: FACT } },
    tech: { tab: 1, page: 'tech', over: { settings: { centre: 'tech' } } },
    tech_warn: { tab: 1, page: 'tech', over: { settings: { centre: 'tech' }, data: { oil: 136, coolant: 124 } }, setup: (h) => { h.boostFes = 1.35; } },
    tech_empty: { tab: 1, page: 'tech', over: { settings: { centre: 'tech' }, data: { oil: undefined, coolant: undefined } }, setup: (h) => { h.boostFes = null; h.ambient = null; } },
    tyres: { tab: 1, page: 'tyres', over: { settings: { centre: 'cycle' }, config: { pages: { tyres: true } } },
        setup: (h, R) => { h.td.clock = () => h._now_ms; const p = R.pages.st(h); p.cyc = 'tyres'; p.cycSince = h._now_ms; p.tpms.p = [24, 24, 24, 24]; p.tpms.t = [46, 46, 47, 46]; p.tpms.target = [24, 24, 26, 24]; p.tpms.at = h._now_ms; } },
    tyres_empty: { tab: 1, page: 'tyres', over: { settings: { centre: 'cycle' }, config: { pages: { tyres: true } } }, setup: (h, R) => { const p = R.pages.st(h); p.cyc = 'tyres'; p.cycSince = h._now_ms; } },
    msg: { tab: 2, page: 'msg' },
    media: { tab: 3, page: 'media' },
    radio: { tab: 3, page: 'radio', over: { config: { pages: { media: true } } },
        setup: (h, R) => { const m = R.pages.st(h).media; m.src = 'radio'; m.band = 'FM'; m.station = 'Радіо Приклад'; m.stationText = "Новини о дев'ятій"; m.freq = 101.7; m.preset = 3; m.tp = true; } },
    track: { tab: 3, page: 'track', over: { config: { pages: { media: true } } },
        setup: (h, R) => { const m = R.pages.st(h).media; m.src = 'usb'; m.title = 'Ранкова хвиля'; m.artist = 'Гурт Приклад'; m.has = true; m.el = 61000; m.tot = 215000; m.cpPos = 4; m.cpTotal = 12; } },
    phone_nodata: { tab: 4, page: 'phone' },
    phone: { tab: 4, page: 'phone', setup: (h, R) => { const p = R.pages.st(h).phone; p.dev = { path: 'CarPlay', battery: 80, signal: 3 }; p.devSeen = true; } },
    phone_none: { tab: 4, page: 'phone', setup: (h, R) => { const p = R.pages.st(h).phone; p.dev = null; p.devSeen = true; } },
    call_in: { tab: 4, page: 'call', over: { config: { pages: { phone: true } } }, setup: (h, R) => { const p = R.pages.st(h).phone; p.agg = 'INCOMING'; p.contact = true; p.dev = { path: 'CarPlay', battery: 80, signal: 3 }; } },
    call_active: { tab: 4, page: 'call', over: { config: { pages: { phone: true } } }, setup: (h, R) => { const p = R.pages.st(h).phone; p.agg = 'ACTIVE'; p.contact = false; p.mic = true; p.activeAt = h._now_ms - 157000; p.dev = { path: 'CarPlay', battery: 80, signal: 3 }; } },
    nav_none: { tab: 5, page: 'none' },
    nav_road: { tab: 5, page: 'road', setup: (h, R) => { R.pages.st(h).road = 'вулиця Тестова'; } },
    nav_calc: { tab: 5, page: 'calc', setup: (h, R) => { R.pages.st(h).guiding = 'CALCULATING_ROUTE'; } },
    nav_guide: { tab: 5, page: 'guide', over: { config: { pages: { guidance: true } } },
        setup: (h, R) => { const p = R.pages.st(h); p.guiding = 'ACTIVE'; p.road = 'вулиця Тестова'; p.dart = { kind: 'right', dist: 350, exit: null, side: null };
            p.lanes = [{ dir: 'left', hi: false }, { dir: 'straight', hi: true }, { dir: 'straight', hi: true }, { dir: 'right', hi: false }]; p.dest = { eta: { h: 9, m: 32 }, dist: 14200 }; } },
    nav_map: { tab: 5, page: 'map', over: { config: { mapWindow: 'W1', mapShutMs: 0 } },
        setup: (h, R) => { const p = R.pages.st(h); p.guiding = 'ACTIVE'; p.navType = 2; p.road = 'вулиця Тестова'; } },
};

/** A fake engine in state `id`. */
function make(R, id) {
    const s = STATES[id];
    if (!s) throw new Error('no state ' + id);
    const h = base(R, Object.assign({ tab: s.tab }, s.over || {}));
    if (s.setup) s.setup(h, R);
    return h;
}

/** Paint a state through the engine's own entry (init -> update); returns { buf, ink, page }. */
function render(R, h) {
    const x = { w: R.widget, ref: 1, c: null, sheet: null, px: null };
    R.pages.init(h, x);
    return { buf: h.captured, ink: x.pgInk || [], page: R.pages.st(h).page, x };
}

module.exports = { rig, base, make, render, STATES, TRIP, FACT, WIRED, T0 };
