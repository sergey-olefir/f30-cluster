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

const FULL_PHONE = { phone: true, phoneDevices: true, callDetail: true };       // the call card's whole drawing (car-fix CF3: the unseen parts too)
const CAR_PAGES = { media: true, phone: true, phoneDevices: false, callDetail: false, guidance: false, route: true, tyres: false };    // app.json after car-fix CF3

/** The page model wired through the real handlers (shared/twin_pages.js wire): returns the handler table. */
function wired(h, R) { const extra = {}; R.pages.wire(h, extra); h._extra = extra; return extra; }
/** Neutral text of exactly n characters (the car gave the lengths, never the text). */
const textOf = (seed, n) => { let s = ''; while (s.length < n) s += seed + ' '; return s.slice(0, n).replace(/ $/, '.'); };
/** The car's media: CarPlay playing. HMI lines ARTIST (17) + ALBUM (16) and no TITLE; Int64 ids and times as non-numbers; the
 *  menu's seven entries, CARPLAY selected; MediaPlayer (CarPlayMedia): PLAY, 0 of 0, ARTIST 17 / ALBUM 16 / TITLE 16 / COVER_FILE,
 *  25583 of 184785 ms; the tuner holds an FM station all along (short and long name 8, radio text 64). */
const CAR = { artist: textOf('Гурт Приклад', 17), album: textOf('Альбом Приклад', 16), title: textOf('Ранкова хвиля', 16), station: textOf('Радіо Приклад', 8), rt: textOf('Текст радіо приклад', 64) };
const I64 = (n) => ({ low: n, high: 0 });         // one Int64 shape (the probe printed "?": not a plain number)
const MENU = (sel) => ({ sink: 'FRONT', selectedEntryId: I64(sel), menuEntries: [['MUSIC_COLLECTION', 1], ['BLUETOOTH', 2], ['PRESETS', 3], ['FM', 4], ['AM', 5], ['MIRACAST', 6], ['CARPLAY', 7]]
    .map((e) => ({ id: I64(e[1]), name: textOf('Пункт', 16), iconKind: e[0], enabled: true, subentries: [] })) });
function carMedia(h, R, sel) {
    const e = wired(h, R), I = R.pages.IF;
    e[I.media].playerMetadata({ sink: 'FRONT', uiType: 'TWO_LINES', menuEntry: I64(7), trackId: I64(1), firstLineType: 'ARTIST', firstLineText: CAR.artist, secondLineType: 'ALBUM', secondLineText: CAR.album, threeRowText: '' });
    e[I.media].trackProgress({ sink: 'FRONT', menuEntry: I64(7), trackId: I64(1), elapsed: '?', total: '?', hasProgress: true, isSeekable: false });
    e[I.media].menu(MENU(sel));
    e[I.tuner].currentStationFmDabAm({ stationListEntry: { waveBand: 'WB_FM', receptionMode: 'ANALOG', frequencyKhz: 101700, positionNumber: 0, tp: 'TPS_NO_TP', stationShortName: CAR.station, stationLongName: CAR.station }, radioTextName: CAR.rt });
    e[I.player].playerState(sel === 7 ? 'PLAYER_STATE_PLAY' : 'PLAYER_STATE_PAUSE');
    e[I.player].currentItemPosition({ position: 0, totalNumber: 0 });
    e[I.player].currentItemMetadata([{ key: 'ARTIST', value: { stringValue: CAR.artist } }, { key: 'ALBUM', value: { stringValue: CAR.album } }, { key: 'TITLE', value: { stringValue: CAR.title } }, { key: 'COVER_FILE', value: { stringValue: textOf('/cover/item', 59) } }]);
    e[I.player].currentItemTime({ elapsed: 25583, total: 184785 });
    return e;
}
const carPlay = (h, R) => carMedia(h, R, 7);
const carRadio = (h, R) => carMedia(h, R, 4);
/** The car's CarPlay route: provider CAR_PLAY, BMW's guiding INACTIVE, an empty manoeuvre and no lanes; the destination 5700 (unit KM,
 *  a 3-character text), 660 s, arrival 20:41 local; a road of 14 characters; not on a guidable road. */
function carRoute(h, R) {
    const e = wired(h, R), I = R.pages.IF;
    e[I.guiding].guidingState('INACTIVE');
    e[I.guidance].guidingProvider('CAR_PLAY');
    e[I.guidance].conclusiveDart({ maneuver: { pointOfInterest: {} }, bargraphProgress: 0 });
    e[I.guidance].currentLaneGuiding({ rows: [], carPositionLaneIndex: 0 });
    e[I.guidance].currentRoad({ elements: [{ text: textOf('вулиця Тестова', 14) }] });
    e[I.guidance].isOnGuidableRoad(false);
    e[I.guidance].nextDestinationInfo({ travelTime: 660, delayTime: 0, delayStatus: 'UNDEFINED', formattedDistance: { distance: '5.7', unit: 'KM', rawDistance: 5700 },
        distanceFromCurrentToFinalDestination: 0, isCheckeredFlag: true, stopOverNumber: 0,
        estimatedArrivalTime: { time: { invalid: false, hour: 20, minute: 41 }, includedTimeOffset: { valid: false, timeZoneOffset: 120 } } });
    return e;
}

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
    // car-fix CF3: the device lines and the call's contact / microphone are drawn only with config.pages.phoneDevices / callDetail (unseen on the car)
    phone: { tab: 4, page: 'phone', over: { config: { pages: { phoneDevices: true } } }, setup: (h, R) => { const p = R.pages.st(h).phone; p.dev = { path: 'CarPlay', battery: 80, signal: 3 }; p.devSeen = true; } },
    phone_none: { tab: 4, page: 'phone', over: { config: { pages: { phoneDevices: true } } }, setup: (h, R) => { const p = R.pages.st(h).phone; p.dev = null; p.devSeen = true; } },
    call_in: { tab: 4, page: 'call', over: { config: { pages: FULL_PHONE } }, setup: (h, R) => { const p = R.pages.st(h).phone; p.agg = 'INCOMING'; p.contact = true; p.dev = { path: 'CarPlay', battery: 80, signal: 3 }; } },
    call_active: { tab: 4, page: 'call', over: { config: { pages: FULL_PHONE } }, setup: (h, R) => { const p = R.pages.st(h).phone; p.agg = 'ACTIVE'; p.contact = false; p.mic = true; p.activeAt = h._now_ms - 157000; p.dev = { path: 'CarPlay', battery: 80, signal: 3 }; } },
    nav_none: { tab: 5, page: 'none' },
    nav_road: { tab: 5, page: 'road', setup: (h, R) => { R.pages.st(h).road = 'вулиця Тестова'; } },
    nav_calc: { tab: 5, page: 'calc', setup: (h, R) => { R.pages.st(h).guiding = 'CALCULATING_ROUTE'; } },
    nav_guide: { tab: 5, page: 'guide', over: { config: { pages: { guidance: true } } },
        setup: (h, R) => { const p = R.pages.st(h); p.guiding = 'ACTIVE'; p.road = 'вулиця Тестова'; p.dart = { kind: 'right', dist: 350, exit: null, side: null };
            p.lanes = [{ dir: 'left', hi: false }, { dir: 'straight', hi: true }, { dir: 'straight', hi: true }, { dir: 'right', hi: false }]; p.dest = { eta: { h: 9, m: 32 }, dist: 14200 }; } },
    nav_map: { tab: 5, page: 'map', over: { config: { mapWindow: 'W1', mapShutMs: 0 } },
        setup: (h, R) => { const p = R.pages.st(h); p.guiding = 'ACTIVE'; p.navType = 2; p.road = 'вулиця Тестова'; } },
    // ---- car-fix CF3: the car's own shapes (signal_probe and Twin Dial 0.1.0 on the car, 2026-11-18), fed through the real handlers.
    // Only the lengths, enums and numbers are the car's; every text is invented and neutral.
    car_carplay: { tab: 3, page: 'track', over: { config: { pages: CAR_PAGES } }, setup: (h, R) => carPlay(h, R) },
    car_radio: { tab: 3, page: 'radio', over: { config: { pages: CAR_PAGES } }, setup: (h, R) => carRadio(h, R) },
    car_call: { tab: 4, page: 'call', over: { config: { pages: CAR_PAGES } }, setup: (h, R) => { const e = wired(h, R); e[R.pages.IF.agg].aggregatedCallState('DIALING'); h._now_ms += 10000; e[R.pages.IF.agg].aggregatedCallState('ACTIVE'); h._now_ms += 83000; } },
    car_phone: { tab: 4, page: 'phone', over: { config: { pages: CAR_PAGES } }, setup: (h, R) => { const e = wired(h, R); e[R.pages.IF.agg].aggregatedCallState('DISCONNECTED'); } },
    car_route: { tab: 5, page: 'route', over: { config: { pages: CAR_PAGES } }, setup: (h, R) => carRoute(h, R) },
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

module.exports = { rig, base, make, render, STATES, TRIP, FACT, WIRED, T0, CAR, CAR_PAGES, FULL_PHONE, wired, textOf, MENU, I64 };
