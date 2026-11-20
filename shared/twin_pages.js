'use strict';
/**
 * twin_pages.js - Twin Dial's centre pages (round 3, package B4; docs/twin-dial/SPEC-R3.md 4, 10, 11).
 *
 * The centre of the panel is ONE image layer (layout widget "tdpage", rect [729, 248, 462, 347], own layer, connection 1) that
 * this file paints in one go: the title, the page's texts, pictograms, bars. A page is a list of items in the layout
 * (design/gen_twin.py writes them: geometry is the generator's, values are tokens); the current page is decided here from
 * the selected tab (hud.tabs.tab, shared/twin_tabs.js: tab 1 until it exists) and the car's state:
 *
 *   tab 1  the on-board computer: clock | trip | tech | tyres  (setting "centre": one page or "cycle", "techData" show / hide)
 *   tab 2  the messages: only the title here (the card, the rows, the pointer page are shared/twin_cc.js's sheet)
 *   tab 3  media: "media" (the certain-only page) | "radio" | "track"            (the last two: config.pages.media)
 *   tab 4  phone: "phone" (idle) | "call"                                         (the call card: config.pages.phone)
 *   tab 5  navigation: "map" (the map window, config.mapWindow) | "guide" (config.pages.guidance, dark; or CarPlay's next turn, the
 *          test mode config.carplayTurns) | "route" (config.pages.route) | "calc" | "road" | "none"
 *
 * Built dark = the drawing and its model exist and are tested; a config key switches them on once the car has shown the
 * signal (docs/AGENT-BRIEF-car-signals.md). Every page has an empty state (a dash, "Немає даних", the certain page).
 *
 * car-fix CF3 (the car, 2026-11-18; docs/car-fix/CF3-REPORT.md): media, the call card and the CarPlay route are ON. What the car
 * sends: HmiMediaState (HMI_CID) with CarPlay playing gives ARTIST + ALBUM lines and NO title line, its Int64 ids and times
 * arrive as non-numbers; the title and the time come from MediaPlayer on CarPlayMedia (currentItemMetadata keyed TITLE /
 * ARTIST / ALBUM, currentItemTime in ms). The call state is ConnectivityAggregator's only (DISCONNECTED, DIALING, ACTIVE seen);
 * DevicePresentation / VoiceCall / micMuted were never seen and stay dark (config.pages.phoneDevices / callDetail). With
 * CarPlay guiding, BMW's guidingState stays INACTIVE and the manoeuvre / lanes are empty; nextDestinationInfo, currentRoad,
 * isOnGuidableRoad and guidingProvider = CAR_PLAY arrive: the "route" page. FormattedDistance.rawDistance is in METRES
 * whatever its unit (5700 with unit KM, a 3-character text, 660 s travel = 5.7 km).
 *
 * Where it plugs into the engine (small marked blocks `// twin_dial:` in shared/hud.js, inert for every other app):
 *   _create / _updateOne   the "tdpage" widget: init(hud, x) and update(hud, x, now, force)
 *   _token                 {{td:pg...}} reaches token(hud, name) through shared/twin_tokens.js
 *   settings handler       changed(hud): a page setting changed, decided again at once (no rebuild)
 *   wire                   wire(hud, extra): the fields only the pages read (read only; never a setter or a method)
 *
 * car issues CT (the owner, 2026-11-19): with the Діагностика test mode "Повороти CarPlay (тест)" (diagCarplayTurns ->
 * config.carplayTurns, off by default) and the phone guiding (guidingProvider CAR_PLAY / ANDROID_AUTO), the arrow page ("guide") is
 * fed from GuidanceEventList.queryContent - the one method call, a read, made by shared/carplay_turns.js every 2 s (cpSync) - instead
 * of conclusiveDart: the arrow for the event's kind and direction, the phone's own distance (formattedDistance's text and unit), the
 * road name the event carries. The CarPlay route page stays the fallback whenever the call fails, finds no turn, or its turn is older
 * than 6 s. Off: no poll, no call, nothing changes.
 *
 * Privacy: titles, artists, station names, a caller's name and road names are DRAWN, never logged (lengths, enum numbers,
 * counts only), and a caller's name is kept only while the call lasts and only while the setting is on.
 * Plain Node 8 (the car's 8.16.2): no ?. / ?? / object spread / Object.fromEntries / flat. Nothing here throws into the engine.
 */
const textRaster = require('./hud_text');
const I = require('./lang');          // r1120 LN: every word of the pages from shared/i18n/<lang>.json
const iconsMod = require('./icons');
/** car issues CT: shared/carplay_turns.js (Twin Dial packs it); null in an app that does not. */
let turnsLib;
function turnsMod() {
    if (turnsLib === undefined) { try { turnsLib = require('./carplay_turns'); } catch (e) { turnsLib = null; } }
    return turnsLib;
}
// front-vehicle FV: the test page "front" on tab 1 (shared/twin_front.js paints it itself). Absent: never.
let twinFront = null;
try { twinFront = require('./twin_front'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND' || String(e.message).indexOf('twin_front') < 0) throw e; }

const isNum = (x) => typeof x === 'number' && isFinite(x);
const pad2 = (n) => (n < 10 ? '0' : '') + n;
const DASH = '–';
const ELLIPSIS = '…';
const EVAL_MS = 150;                // the page and its values are decided at most this often
const LAYER = { x: 729, y: 248, w: 462, h: 347 };       // the page layer (gen_twin.py PAGE)
const LOCK_KMH = 5;                 // the cycle holds the page above this speed (config.twin.holdAboveKmh)
const DWELL_MS = 10000;             // a cycle page's time while the car stands (config.twin.cyclePageMs)
const TPMS_POLL_MS = 10000;
const MAP_SHUT_MS = 8000;           // SPEC 4.5: the map slots are off 6-8 s after a fresh panel mapping
const SLOT_FRESH_MS = 6000;         // a cluster-render status older than this says nothing about the map
const ROUTE_FRESH_MS = 60000;       // car-fix CF3: a CarPlay destination older than this is no route (the car sends it every few s)

/* ------------------------------------------------------------------ names ---------------------------------------- */

const IF = {
    kombi: 'de.bmw.infotainment.KombiIF',
    guiding: 'de.bmw.infotainment.navigation.navigationstatus.NavigationStatus',
    guidance: 'de.bmw.infotainment.navigation.guiding.Guidance',
    media: 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState',
    tuner: 'de.bmw.infotainment.tuner.fmamdab.tunerfmamdab.TunerFmAmDab',
    player: 'de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer',
    agg: 'de.bmw.infotainment.connectivity.telephony.ConnectivityAggregator',
    call: 'de.bmw.infotainment.connectivity.telephony.VoiceCall',
    callMgr: 'de.bmw.infotainment.connectivity.telephony.VoiceCallManager',
    devices: 'de.bmw.infotainment.devicemanager.devicepresentation.DevicePresentation',
    tpms: 'de.bmw.infotainment.vehicle.TPMS',
};

/** The fonts the pages use: a role -> the atlases that can serve it, best first (B6 bakes the exact sizes; until an atlas
 *  exists the next one stands in, the baseline is the same either way). */
const FONTS = {
    title: ['td_title'],                    // Noto 41
    clock: ['td_clock'],                    // Saira 92, digits and ":"
    n42: ['td_msg'],                        // Noto 42
    n40: ['td_row'],                        // Noto 40
    n39: ['td_val'],                        // Noto 39
    n33: ['td_tab'],                        // Noto 33
    n31: ['td_body'],                       // Noto 31
    n29: ['td_sub', 'td_body'],             // Noto 29 (B6: td_sub)
    u21: ['td_u21'],                        // Noto 21
    u19: ['td_u19'],                        // Noto 19
    u15: ['td_u19'],                        // the stacked unit (K2 drew it at Noto 15; no such atlas: Noto 19)
    s72: ['td_dist', 'td_clock'],           // Saira 72 (B6: td_dist; the call timer, the guidance distance)
};
const SAIRA = ['clock', 's72'];             // digits and Latin only: never a Cyrillic letter (SPEC 7)
const fontCache = {};
function fontName(key) {
    if (fontCache.hasOwnProperty(key)) return fontCache[key];
    let found = null;
    (FONTS[key] || []).forEach((n) => { if (!found) { try { textRaster.loadFont(n); found = n; } catch (e) { /* the next one */ } } });
    // a miss is not cached: the atlases may be lent after the first call (tests)
    if (found) fontCache[key] = found;
    return found;
}

/** The pictograms the pages draw (our own, B6 draws them). The first of each list that exists in shared/icons.js ICONS wins. */
const ICON = {
    fuel: ['td_fuel'], road: ['td_road', 'td_nav'], radio: ['td_radio'], media: ['td_media'], proj: ['td_proj', 'td_media'],
    phone: ['td_phone'], ring: ['td_handset', 'td_phone_ring', 'td_phone'], handset: ['td_handset', 'td_phone'], micOff: ['td_mic_off'], mute: ['td_mute'],
    nav: ['td_nav'],
};
function pickIcon(list) {
    const have = iconsMod.ICONS || {};
    for (let i = 0; i < list.length; i++) if (have[list[i]]) return list[i];
    return '';
}

/* ------------------------------------------------------------------ state ---------------------------------------- */

function fresh() {
    return {
        page: 'clock', evalAt: -1e9, built: 0,
        cyc: 'clock', cycSince: 0, hold: false,
        // navigation
        guiding: null, road: null, dart: null, lanes: null, dest: null, destAt: 0, nextRoad: null, navType: null, nonNavi: null,
        provider: null, onRoad: null,      // car-fix CF3: Guidance.guidingProvider (CAR_PLAY ...), isOnGuidableRoad
        // car issues CT: CarPlay's next turn (the test mode): the poll, the last turn read and when; guideSrc: what the arrow page shows
        cp: { poller: null, turn: null, at: 0, kind: undefined }, guideSrc: 'bmw',
        slots: null, slotsAt: 0, mapSent: null, mapNote: '', mapAskAt: 0,
        // media (cp*: MediaPlayer on CarPlayMedia, car-fix CF3)
        media: { title: null, artist: null, album: null, three: null, el: null, tot: null, has: false, src: null, srcRaw: null,
            station: null, stationText: null, band: null, freq: null, preset: null, tp: false, cpPos: null, cpTotal: null, cpState: null, mute: false, at: 0,
            cpTitle: null, cpArtist: null, cpAlbum: null, cpEl: null, cpTot: null },
        // phone
        phone: { agg: null, call1: null, contact: null, name: null, mic: null, dev: null, devSeen: false, activeAt: 0, activeKey: '', path: null, at: 0 },
        // tyres
        tpms: { p: null, t: null, target: null, at: 0, timer: null, wanted: false },
        logged: {},
    };
}
const st = (hud) => hud.tdp || (hud.tdp = fresh());
const nowMs = (hud) => (hud && hud.td && typeof hud.td.clock === 'function' ? hud.td.clock() : Date.now());
const cfgOf = (hud) => (hud && hud.config) || {};
const pagesCfg = (hud) => (cfgOf(hud).pages && typeof cfgOf(hud).pages === 'object' ? cfgOf(hud).pages : {});
const twinCfg = (hud) => (cfgOf(hud).twin && typeof cfgOf(hud).twin === 'object' ? cfgOf(hud).twin : {});
const log = (hud, level, s) => { try { if (hud && hud.log && hud.log[level]) hud.log[level](s); } catch (e) { /* never */ } };
function once(hud, key, line) {
    const p = st(hud);
    if (p.logged[key] === line) return;
    p.logged[key] = line;
    log(hud, 'info', line);
}
function setting(hud, k) {
    try { return hud && typeof hud.setting === 'function' ? hud.setting(k) : undefined; } catch (e) { return undefined; }
}
const tok = () => require('./twin_tokens');

/* ------------------------------------------------------------------ signals -------------------------------------- */

/** A member of a struct value (or a path of members), or undefined. */
function pick(v) {
    let cur = v;
    for (let i = 1; i < arguments.length; i++) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
        cur = cur[arguments[i]];
    }
    return cur;
}
/** An enum that arrives as its number or its name -> its name (from `names`, indexed by number), or null. */
function enumName(raw, names) {
    if (typeof raw === 'string') return names.indexOf(raw) >= 0 ? raw : /^[A-Z][A-Z0-9_]{0,40}$/.test(raw) ? raw : null;
    if (isNum(raw) && raw >= 0 && raw < names.length) return names[raw] || null;
    return null;
}
const str = (v, max) => (typeof v === 'string' && v.length ? v.slice(0, max || 200) : null);
const arr = (v) => (Array.isArray(v) ? v : []);
/**
 * car-fix CF3: an Int64 as the car's SDK hands it (Node 8 has no bigint): HmiMediaState's ids and times reached the probe as
 * non-numbers. A number, a digit string, a bigint, a { low, high } pair or an 8-byte buffer -> a number; anything else null.
 */
function int64(v) {
    if (isNum(v)) return v;
    if (typeof v === 'string' && /^-?\d{1,18}$/.test(v)) return Number(v);
    if (typeof v === 'bigint') return Number(v);          // a newer Node's SDK; Node 8 never gets here
    if (v && typeof v === 'object') {
        if (isNum(v.low) && isNum(v.high)) return v.high * 4294967296 + (v.low >>> 0);
        if (Buffer.isBuffer(v) && v.length === 8) return v.readInt32BE(0) * 4294967296 + v.readUInt32BE(4);
    }
    return null;
}
/** An id of any shape (number, string, Int64 pair, buffer, struct) -> a comparable string key, or null. */
function idKey(v) {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'object') return String(v);
    const n = int64(v);
    if (n !== null) return String(n);
    try { return JSON.stringify(v); } catch (e) { return null; }
}

const CALL_STATES = ['DISCONNECTED', 'INCOMING', 'ACTIVE', 'DIALING', 'HELD'];
const GUIDING_STATES = ['INACTIVE', 'CALCULATING_ROUTE', 'ACTIVE'];
const ITEM_TYPES = ['UNDEFINED', 'ARTIST', 'ALBUM', 'TITLE'];
const ICON_KINDS = ['UNDEFINED', 'NO_ICON', 'MEDIA_OVERVIEW', 'PRESETS', 'SDARS', 'FM', 'AM', 'TRF', 'RADIO', 'TV', 'ONLINE_ENTERTAINMENT', 'MUSIC_COLLECTION',
    'USB', 'SMARTPHONE', 'BLUETOOTH', 'MIRACAST', 'CARPLAY', 'DISC', 'HDMI_MHL'];
const WAVE_BANDS = ['WB_UNDEF', 'WB_FM', 'WB_MW', 'WB_DAB', 'WB_FM_DAB', 'WB_TRF', 'WB_SXM_SAT', 'WB_TV', 'WB_SXM_IP'];
const SOURCE_OF_KIND = { FM: 'radio', AM: 'radio', TRF: 'radio', RADIO: 'radio', PRESETS: 'radio', SDARS: 'radio', USB: 'usb', BLUETOOTH: 'bluetooth',
    CARPLAY: 'carplay', SMARTPHONE: 'phone', ONLINE_ENTERTAINMENT: 'online', MUSIC_COLLECTION: 'usb' };
// car-fix CF3: MediaPlayer (CarPlayMedia), the catalogue's enums
const PLAYER_STATES = ['PLAYER_STATE_UNKNOWN', 'PLAYER_STATE_PLAY', 'PLAYER_STATE_STOP', 'PLAYER_STATE_PAUSE', 'PLAYER_STATE_FAST_FORWARD', 'PLAYER_STATE_FAST_BACKWARD'];
const META_KEYS = { 3: 'TITLE', 5: 'ARTIST', 7: 'ALBUM' };           // MetadataKey: the three the page draws (by name or number)
const PROVIDERS = ['NONE', 'CAR_PLAY', 'ANDROID_AUTO', 'CAR_LIFE', 'OTHER'];      // Guidance.guidingProvider (ProjectedModeGuidingProvider)
const TURN = ['NONE', 'STRAIGHT_ON', 'LEFT', 'SLIGHT_LEFT', 'HARD_LEFT', 'RIGHT', 'SLIGHT_RIGHT', 'HARD_RIGHT', 'UTURN_RIGHT', 'UTURN_LEFT'];

/** Chain `fn` behind whatever handler a field already has (the engine's own keeps running first); a throw in `fn` is caught. */
function chain(hud, extra, iface, field, fn, instance) {
    const e = extra[iface] = extra[iface] || {};
    if (instance) e.$instance = instance;
    const prev = e[field];
    e[field] = (v) => {
        if (prev) prev(v);
        try { fn(v); } catch (err) { log(hud, 'warn', 'twin pages: ' + field + ': ' + (err && err.message || err)); }
    };
}

/**
 * The fields only the pages read (SPEC 11), read only, chained behind the handlers already there. Called from
 * shared/twin_tokens.js wire(). Every handler keeps numbers and the text a page draws; the log gets lengths and enums.
 */
function wire(hud, extra) {
    const p = st(hud);
    // ---- navigation
    chain(hud, extra, IF.guiding, 'guidingState', (v) => {
        const raw = isNum(v) || typeof v === 'string' ? v : pick(v, 'guidingState');
        p.guiding = enumName(raw, GUIDING_STATES);
        routeBridge(hud);          // car-fix CF3
        once(hud, 'guiding', 'nav page: guiding state ' + (p.guiding || 'none'));
    });
    chain(hud, extra, IF.guidance, 'currentRoad', (v) => {
        p.road = descText(v);
        once(hud, 'road', 'nav page: road ' + (p.road ? p.road.length + ' characters' : 'none'));
    }, 'Main_Instance');
    chain(hud, extra, IF.guidance, 'conclusiveDart', (v) => { p.dart = dartOf(v); once(hud, 'dart', 'nav page: manoeuvre ' + (p.dart ? p.dart.kind + (p.dart.dist !== null ? ' with a distance' : '') : 'none')); }, 'Main_Instance');
    chain(hud, extra, IF.guidance, 'currentLaneGuiding', (v) => { p.lanes = lanesOf(v); once(hud, 'lanes', 'nav page: lanes ' + (p.lanes ? p.lanes.length : 0)); }, 'Main_Instance');
    chain(hud, extra, IF.guidance, 'nextDestinationInfo', (v) => {
        p.dest = destOf(v); p.destAt = nowMs(hud); routeBridge(hud);
        // car-fix CF3: which parts came, never their values (a distance or an arrival time says where the car goes); once per change of shape
        once(hud, 'dest', 'nav page: destination ' + (p.dest ? 'distance ' + (p.dest.dist !== null ? 'yes' : 'no') + ', travel time ' +
            (p.dest.travel !== null ? 'yes' : 'no') + ', arrival ' + (p.dest.eta ? 'yes' : 'no') : 'none'));
    }, 'Main_Instance');
    // car-fix CF3: who guides (CAR_PLAY on this car) and whether the car is on a road the navigation knows (both enums / booleans)
    chain(hud, extra, IF.guidance, 'guidingProvider', (v) => {
        p.provider = enumName(isNum(v) || typeof v === 'string' ? v : pick(v, 'guidingProvider'), PROVIDERS);
        once(hud, 'provider', 'nav page: guiding provider ' + String(p.provider));
        routeBridge(hud);
    }, 'Main_Instance');
    chain(hud, extra, IF.guidance, 'isOnGuidableRoad', (v) => {
        p.onRoad = v === true || v === 1 ? true : v === false || v === 0 ? false : null;
        once(hud, 'onRoad', 'nav page: on a guidable road ' + String(p.onRoad));
    }, 'Main_Instance');
    chain(hud, extra, IF.guidance, 'visualizationInKombiNonNaviEnabled', (v) => { p.nonNavi = v === true || v === 1 ? true : v === false || v === 0 ? false : null; }, 'Main_Instance');
    chain(hud, extra, IF.kombi, 'statusConfigurationKombi5', (v) => {
        const raw = pick(v, 'statusNavigationDisplayType');
        p.navType = typeof raw === 'string' ? raw : isNum(raw) ? raw : null;
        once(hud, 'navType', 'nav page: cluster map-view setting ' + String(p.navType));
    });
    // ---- media (HmiMediaState on HMI_CID, the tuner, the CarPlay player on CarPlayMedia)
    chain(hud, extra, IF.media, 'playerMetadata', (v) => {
        const m = p.media;
        const lines = [[str(pick(v, 'firstLineText')), enumName(pick(v, 'firstLineType'), ITEM_TYPES)], [str(pick(v, 'secondLineText')), enumName(pick(v, 'secondLineType'), ITEM_TYPES)]];
        let title = null, artist = null, album = null;
        lines.forEach((l) => { if (l[0] === null) return; if (l[1] === 'TITLE') title = title || l[0]; else if (l[1] === 'ARTIST') artist = artist || l[0]; else if (l[1] === 'ALBUM') album = album || l[0]; });
        if (title === null && lines[0][0] !== null && lines[0][1] !== 'ARTIST' && lines[0][1] !== 'ALBUM') title = lines[0][0];      // types unknown: the first line is the title
        if (artist === null && album === null && lines[1][0] !== null && lines[1][0] !== title) artist = lines[1][0];
        m.title = title; m.album = album; m.artist = artist || album; m.three = str(pick(v, 'threeRowText'), 300); m.at = nowMs(hud);
        once(hud, 'media', 'media page: text ' + lines.map((l) => (l[0] === null ? 'none' : l[0].length + ' characters' + (l[1] ? ' ' + l[1] : ''))).join(', '));
        tabBridge(hud);
    }, 'HMI_CID');
    chain(hud, extra, IF.media, 'trackProgress', (v) => {
        // car-fix CF3: elapsed / total are Int64 (they reached the probe as non-numbers): int64() reads every shape
        const m = p.media, el = int64(pick(v, 'elapsed')), tot = int64(pick(v, 'total')), has = pick(v, 'hasProgress');
        m.has = has !== false && isNum(tot) && tot > 0;
        m.el = isNum(el) && el >= 0 ? el : null; m.tot = isNum(tot) && tot > 0 ? tot : null;
    }, 'HMI_CID');
    chain(hud, extra, IF.media, 'menu', (v) => {
        // car-fix CF3: the ids are Int64 (the probe read them as non-numbers): compared by idKey, and only ONE entry may match
        // (two entries with the same key, or no selected id, is no source: the CarPlay player's own state decides then)
        const m = p.media, sel = idKey(pick(v, 'selectedEntryId'));
        const hits = sel === null ? [] : arr(pick(v, 'menuEntries')).filter((x) => x && typeof x === 'object' && idKey(x.id) === sel);
        const kind = hits.length === 1 ? enumName(hits[0].iconKind, ICON_KINDS) : null;
        m.srcRaw = kind; m.src = srcOf(m);
        if (kind === 'FM' || kind === 'AM') m.band = kind;
        once(hud, 'mediaSrc', 'media page: source ' + String(kind) + (hits.length > 1 ? ' (' + hits.length + ' entries match: none taken)' : ''));
        tabBridge(hud);      // b7: tab 3's icon follows the source (B2 reads hud.td.mediaSource)
    }, 'HMI_CID');
    chain(hud, extra, IF.tuner, 'currentStationFmDabAm', (v) => {
        const m = p.media, e = pick(v, 'stationListEntry');
        m.station = str(pick(e, 'stationLongName'), 80) || str(pick(e, 'stationShortName'), 80);
        m.stationText = str(pick(v, 'radioTextName'), 200);
        const wb = enumName(pick(e, 'waveBand'), WAVE_BANDS);
        m.band = wb === 'WB_FM' ? 'FM' : wb === 'WB_DAB' || wb === 'WB_FM_DAB' ? 'DAB' : wb === 'WB_MW' ? 'AM' : m.band;
        const f = pick(e, 'frequencyKhz');
        m.freq = isNum(f) && f >= 87000 && f <= 108500 ? f / 1000 : null;
        const pos = pick(e, 'positionNumber');
        m.preset = isNum(pos) && pos > 0 ? pos : null;
        const tp = pick(e, 'tp');
        m.tp = tp === 1 || tp === 'TPS_TP' || tp === 2 || tp === 'TPS_EON_TP';
        once(hud, 'tuner', 'media page: station ' + (m.station ? m.station.length + ' characters' : 'none') + ', band ' + String(m.band));
        tabBridge(hud);
    });
    chain(hud, extra, IF.player, 'currentItemPosition', (v) => {
        const m = p.media, pos = pick(v, 'position'), n = pick(v, 'totalNumber');
        m.cpPos = isNum(pos) && pos > 0 ? pos : null; m.cpTotal = isNum(n) && n > 0 ? n : null;      // the car: 0 of 0 with CarPlay = none
    }, 'CarPlayMedia');
    chain(hud, extra, IF.player, 'playerState', (v) => {
        const m = p.media;
        m.cpState = enumName(isNum(v) || typeof v === 'string' ? v : pick(v, 'playerState'), PLAYER_STATES);
        m.src = srcOf(m);
        once(hud, 'cpState', 'media page: CarPlay player ' + String(m.cpState));
        tabBridge(hud);
    }, 'CarPlayMedia');
    // car-fix CF3: the CarPlay item - the TITLE the HMI lines do not carry with CarPlay (the car: ARTIST + ALBUM only), and its time
    chain(hud, extra, IF.player, 'currentItemMetadata', (v) => {
        const m = p.media, got = {};
        arr(v).forEach((it) => {
            if (!it || typeof it !== 'object') return;
            const k = typeof it.key === 'string' ? it.key : META_KEYS[it.key];
            const s = str(pick(it, 'value', 'stringValue'), 200);
            if ((k === 'TITLE' || k === 'ARTIST' || k === 'ALBUM') && s !== null && !got[k]) got[k] = s;
        });
        m.cpTitle = got.TITLE || null; m.cpArtist = got.ARTIST || null; m.cpAlbum = got.ALBUM || null;
        once(hud, 'cpMeta', 'media page: CarPlay item ' + arr(v).length + ' keys, title ' + (m.cpTitle ? m.cpTitle.length + ' characters' : 'none'));
        tabBridge(hud);
    }, 'CarPlayMedia');
    chain(hud, extra, IF.player, 'currentItemTime', (v) => {
        const m = p.media, el = pick(v, 'elapsed'), tot = pick(v, 'total');          // UInt32 ms (the car: 25583 of 184785, +10 s every 10 s)
        m.cpTot = isNum(tot) && tot > 0 && tot < 864e5 ? tot : null;
        m.cpEl = m.cpTot !== null && isNum(el) && el >= 0 ? Math.min(el, m.cpTot) : null;
    }, 'CarPlayMedia');
    // ---- phone
    chain(hud, extra, IF.agg, 'aggregatedCallState', (v) => {
        const raw = isNum(v) || typeof v === 'string' ? v : pick(v, 'aggregatedCallState');
        callEdge(hud, 'agg', enumName(raw, CALL_STATES));
    });
    chain(hud, extra, IF.call, 'state', (v) => { callEdge(hud, 'call1', enumName(isNum(v) || typeof v === 'string' ? v : pick(v, 'state'), CALL_STATES)); }, 'Call1');
    chain(hud, extra, IF.call, 'contactID', (v) => { p.phone.contact = isNum(v) ? v !== 0 : null; }, 'Call1');
    chain(hud, extra, IF.call, 'name', (v) => {
        // private: kept only while the setting is on and the call lasts (never logged); car-fix CF3: and only with config.pages.callDetail
        // (VoiceCall has never been seen on the car: dark)
        p.phone.name = setting(hud, 'callerName') === 'on' && pagesCfg(hud).callDetail === true ? str(v, 80) : null;
    }, 'Call1');
    chain(hud, extra, IF.callMgr, 'micMuted', (v) => { p.phone.mic = v === true || v === 1 ? true : v === false || v === 0 ? false : null; });
    chain(hud, extra, IF.devices, 'deviceList', (v) => { p.phone.dev = deviceOf(v); p.phone.devSeen = true; tabBridge(hud); once(hud, 'devices', 'phone page: devices ' + arr(v).length + (p.phone.dev ? ', one connected' : ', none connected')); });
    // ---- tyres: the car never notifies TPMS; the page asks (tpmsStart / tpmsPoll), these handlers take the answers
    chain(hud, extra, IF.tpms, 'statusTyrePressure', (v) => { p.tpms.p = corners(v, 'actualValuePressureTyre'); p.tpms.at = nowMs(hud); });
    chain(hud, extra, IF.tpms, 'statusTyreTemperature', (v) => { p.tpms.t = corners(v, 'actualValueTemperatureTyre'); p.tpms.at = nowMs(hud); });
    chain(hud, extra, IF.tpms, 'statusTargetTyrePressure', (v) => { p.tpms.target = corners(v, 'targetPressureTyre'); });
    tpmsHandlers(hud, extra);
}

/** A Description ({ elements: [{ text }, ...] }) -> its text, or null. The road text is drawn and never logged. */
function descText(v) {
    if (typeof v === 'string') return str(v, 120);
    const els = arr(pick(v, 'elements'));
    let out = '';
    els.forEach((e) => {
        const t = typeof e === 'string' ? e : pick(e, 'text') !== undefined ? pick(e, 'text') : pick(e, 'elements') ? pick(e, 'elements', 'text') : undefined;
        if (typeof t === 'string') out += (out ? ' ' : '') + t;
    });
    return out ? out.slice(0, 120) : null;
}
/**
 * A FormattedDistance's raw distance in metres, or null. car-fix CF3, THE CAR (2026-11-18, CarPlay route): rawDistance 5700 came with
 * unit KM, a 3-character text (the car's own "5.7") and a travel time of 660 s - so rawDistance is METRES whatever the unit (the
 * unit names the formatted text's unit only). 5700 km or 57 km in 11 minutes is impossible; 5.7 km is 31 km/h in town. Zero is
 * no distance (the car's empty manoeuvre: raw 0, unit NONE).
 */
function metres(fd) {
    if (!fd || typeof fd !== 'object') return null;
    const raw = fd.rawDistance;
    return isNum(raw) && raw > 0 && raw < 4e7 ? raw : null;
}
/** The manoeuvre (SN guidance.json): { kind, dist, exit, side }; kind is one of our own pictogram keys. */
function dartOf(v) {
    const m = pick(v, 'maneuver');
    if (!m || typeof m !== 'object') return null;
    const key = ['intersection', 'branch', 'roundabout', 'destinationManeuver', 'laneChange'].filter((k) => m[k] && typeof m[k] === 'object')[0];
    const u = key ? m[key] : m;
    if (!u) return null;
    let kind = null, exit = null, side = null;
    if (key === 'roundabout') {
        kind = 'roundabout'; exit = isNum(u.exitNumber) ? u.exitNumber : null;
        side = enumName(u.driveDirection, ['', 'LEFT', 'RIGHT']);
    } else if (key === 'destinationManeuver') {
        const pos = enumName(u.position, ['', 'LEFT', 'CENTER', 'RIGHT', 'NOT_DIGITIZED']);
        kind = pos === 'LEFT' ? 'flag_left' : pos === 'RIGHT' ? 'flag_right' : 'flag';
    } else if (key === 'branch') {
        const b = enumName(u.branchType, ['', 'BRANCH_LEFT', 'BRANCH_RIGHT', 'HIGHWAY_IN_LEFT', 'HIGHWAY_IN_RIGHT', 'HIGHWAY_IN_STRAIGHT', 'HIGHWAY_OUT_LEFT', 'HIGHWAY_OUT_RIGHT', 'HIGHWAY_OUT_STRAIGHT',
            'FORK_LEFT', 'FORK_RIGHT', 'TRIPLE_FORK_LEFT', 'TRIPLE_FORK_RIGHT', 'TRIPLE_FORK_STRAIGHT', 'OVERPASS', 'UNDERPASS']);
        kind = b ? b.toLowerCase() : null;
        if (kind && /^highway_out_(left|right)$/.test(kind)) kind = 'exit_' + kind.slice(12);
        else if (kind && /^(highway_in|branch)_(left|right)$/.test(kind)) kind = 'merge_' + kind.split('_')[kind.split('_').length - 1];
        else if (kind && /^(highway_in|highway_out)_straight$/.test(kind)) kind = 'straight';
        else if (kind && /^triple_fork_/.test(kind)) kind = 'fork_' + kind.slice(12);
    } else if (key === 'laneChange') {
        const s = enumName(u.changeSide, ['', 'LEFT', 'RIGHT']);
        kind = s === 'LEFT' ? 'lane_change_left' : s === 'RIGHT' ? 'lane_change_right' : null;
    } else {
        const d = enumName(u.direction, TURN);
        kind = d && d !== 'NONE' ? (d === 'STRAIGHT_ON' ? 'straight' : d.toLowerCase()) : null;
    }
    return { kind: kind, dist: metres(u.formattedDistance), exit: exit, side: side };
}
/** The lane row: [{ dir, hi }], at most 8. */
function lanesOf(v) {
    const rows = arr(pick(v, 'rows'));
    const lanes = arr(rows[0] && rows[0].lanes);
    if (!lanes.length) return null;
    return lanes.slice(0, 8).map((l) => {
        const d = enumName(l && l.directionToFollow, TURN);
        return { dir: d && d !== 'NONE' ? (d === 'STRAIGHT_ON' ? 'straight' : d.toLowerCase()) : 'straight', hi: !!(l && l.isHighlighted) };
    });
}
/**
 * The destination (SN): { eta: {h, m} | null, dist: metres | null, travel: seconds | null }. car-fix CF3, THE CAR: the arrival time
 * is the car's LOCAL time (18:31 UTC + 660 s gave 20:41 with the zone UTC+2; includedTimeOffset.valid false): drawn as it comes.
 * travelTime is seconds (UInt32). A destination with none of the three is none.
 */
function destOf(v) {
    if (!v || typeof v !== 'object') return null;
    const t = pick(v, 'estimatedArrivalTime', 'time'), t2 = pick(v, 'estimatedArrivalTime');
    const tt = t && typeof t === 'object' ? t : t2;
    const h = pick(tt, 'hour'), mi = pick(tt, 'minute'), inv = pick(tt, 'invalid');
    const eta = isNum(h) && isNum(mi) && !inv && h >= 0 && h < 24 && mi >= 0 && mi < 60 ? { h: h, m: mi } : null;
    const tr = v.travelTime, travel = isNum(tr) && tr > 0 && tr < 864000 ? tr : null;
    const dist = metres(v.formattedDistance);
    return eta || dist !== null || travel !== null ? { eta: eta, dist: dist, travel: travel } : null;
}
/**
 * b7 (integration): what the tab bar (shared/twin_tabs.js, B2) reads from this page model: hud.td.mediaSource ('tuner' | 'player' |
 * 'projection') for tab 3's icon and hud.td.phoneConnected (true | false) for tab 4's. Each one only while its pages are switched on
 * (config.pages.media / config.pages.phone: the car session's switch after probes P8 / P9); until then both stay null and the tabs show
 * the plain icons (SPEC-R3 3.3). The media TEXT (hud.td.media) stays with twin_tokens.js (config.twin.media). Enums and booleans only.
 */
function tabBridge(hud) {
    const td = hud && hud.td, p = st(hud);
    if (!td || typeof td !== 'object') return;
    const src = p.media.src, on = pagesCfg(hud).media === true;
    td.mediaSource = on && src ? (src === 'radio' ? 'tuner' : src === 'carplay' ? 'projection' : 'player') : null;
    // car-fix CF3: tab 3's text (SPEC-R3 3.3) - the station on the radio page, the title on the now-playing page, nothing on the
    // certain page; B2's paintMedia cuts it with "…" to the cell. Drawn, never logged. Only while config.pages.media is on
    // (config.twin.media, the old "second line" rule of twin_tokens.js, would show the ALBUM with CarPlay: it stays off)
    if (on) {
        const pg = mediaPage(hud);
        td.media = pg === 'radio' ? p.media.station || p.media.title || null : pg === 'track' ? trackTitle(p.media) : null;
    }
    td.phoneConnected = pagesCfg(hud).phone === true && devicesOn(hud) && p.phone.devSeen ? !!p.phone.dev : null;
}

/* car-fix CF3: the sources of the media pages. CarPlay first: with CarPlay playing the HMI lines are ARTIST + ALBUM and carry no
 * title, so the title, the artist and the time come from MediaPlayer on CarPlayMedia; any other source reads the HMI lines. */

/** The source: the HMI menu's selected entry (one match), else the CarPlay player playing = CarPlay, else null. */
function srcOf(m) {
    const kind = m.srcRaw;
    if (kind) return SOURCE_OF_KIND[kind] || 'other';
    return m.cpState === 'PLAYER_STATE_PLAY' ? 'carplay' : null;
}
const isCarPlay = (m) => m.src === 'carplay';
function trackTitle(m) { return (isCarPlay(m) ? m.cpTitle || m.title : m.title) || null; }
function trackArtist(m) { return (isCarPlay(m) ? m.cpArtist || m.cpAlbum || m.artist : m.artist) || null; }
/** { el, tot } in ms: CarPlay's own item time, else the HMI progress (only when it says it has one). */
function trackTime(m) {
    if (isCarPlay(m) && isNum(m.cpTot)) return { el: m.cpEl, tot: m.cpTot };
    return m.has && isNum(m.tot) ? { el: m.el, tot: m.tot } : { el: null, tot: null };
}
/** car-fix CF3: the phone's unseen sources stay dark: DevicePresentation (config.pages.phoneDevices), VoiceCall / micMuted (callDetail). */
const devicesOn = (hud) => pagesCfg(hud).phoneDevices === true;
const detailOn = (hud) => pagesCfg(hud).callDetail === true;

/** The connected phone of a DevicePresentation list: { path, battery 0-100 | null, signal 0-4 | null }, or null. */
function deviceOf(v) {
    const list = arr(v);
    const d = list.filter((x) => x && x.connected === true)[0];
    if (!d) return null;
    const roles = arr(d.active).map((r) => (typeof r === 'string' ? r : isNum(r) ? { 2: 'CARPLAY', 3: 'ANDROID_AUTO', 5: 'BT_AUDIO', 9: 'HANDS_FREE_PHONE' }[r] : null));
    const path = roles.indexOf('CARPLAY') >= 0 ? 'CarPlay' : roles.indexOf('ANDROID_AUTO') >= 0 ? 'Android Auto' : roles.indexOf('HANDS_FREE_PHONE') >= 0 || arr(d.connectedTechnologies).length ? 'Bluetooth' : null;
    const b = d.batteryState, s = d.signalStrength;
    // units are hypotheses (SP): 0-100 % for the battery, 0-5 (or 0-100) for the signal; anything else is not shown
    const battery = isNum(b) && b >= 0 && b <= 100 ? b : null;
    const signal = isNum(s) && s >= 0 && s <= 5 ? Math.min(4, s) : isNum(s) && s > 5 && s <= 100 ? Math.round(s / 25) : null;
    return { path: path, battery: battery, signal: signal };
}
/** TPMS: { FL, FR, RL, RR } raw numbers from the members <prefix>FLH .. RRH (null when none). */
function corners(v, prefix) {
    const out = ['FLH', 'FRH', 'RLH', 'RRH'].map((c) => { const x = pick(v, prefix + c); return isNum(x) ? x : null; });
    return out.some((x) => x !== null) ? out : null;
}

/** A call state edge: the call timer is OURS, started at the first ACTIVE and dropped at DISCONNECTED (SPEC 4.4). */
function callEdge(hud, which, state) {
    const p = st(hud), ph = p.phone;
    ph[which] = state;
    const s = callState(hud), t = nowMs(hud);
    if (s === 'ACTIVE' || s === 'HELD') { if (!ph.activeAt) ph.activeAt = t; } else ph.activeAt = 0;
    if (s === null || s === 'DISCONNECTED') { ph.name = null; ph.contact = null; }
    ph.at = t;
    once(hud, 'call', 'phone page: call state ' + String(s));
}
const callState = (hud) => {
    const ph = st(hud).phone;
    // car-fix CF3: ConnectivityAggregator's state is the one the car sends; VoiceCall's only with config.pages.callDetail (unseen)
    return ph.agg !== null && ph.agg !== undefined ? ph.agg : detailOn(hud) && ph.call1 !== null && ph.call1 !== undefined ? ph.call1 : null;
};
const callLive = (hud) => ['INCOMING', 'ACTIVE', 'DIALING', 'HELD'].indexOf(callState(hud)) >= 0;

/* ---------------------------------------------------------- TPMS polling ---------------------------------------- */

/**
 * The tyre page reads the car's getters (the car never notifies TPMS) every 10 s while the page shows - and never while it
 * does not (SPEC 4.1). Read only. Called from update() each evaluation; starts and stops its own timer.
 */
function tpmsSync(hud, showing) {
    const t = st(hud).tpms;
    if (showing && pagesCfg(hud).tyres === true) {
        if (!t.timer) {
            tpmsPoll(hud);
            t.timer = setInterval(() => { try { tpmsPoll(hud); } catch (e) { /* never */ } }, TPMS_POLL_MS);
            if (t.timer && t.timer.unref) t.timer.unref();
        }
    } else if (t.timer) { clearInterval(t.timer); t.timer = null; }
}
function tpmsPoll(hud) {
    const t = st(hud).tpms, S = hud && hud.ctx && hud.ctx.signals;
    const subs = (hud && hud.car && hud.car.subs) || [];
    const sub = subs.filter((s) => s && s.iface === IF.tpms)[0];
    if (!S || typeof S.get !== 'function' || !sub || !sub.proxy || sub.error || !sub.available) return;
    t.polls = (t.polls || 0) + 1;
    ['statusTyrePressure', 'statusTyreTemperature', 'statusTargetTyrePressure'].forEach((f) => {
        const done = (v) => {
            const h = t.handlers && t.handlers[f];
            if (h) { try { h(v); } catch (e) { /* the page shows a dash */ } }
        };
        let ask;
        try { ask = S.get(sub.proxy, f, 3000); } catch (e) { return; }
        Promise.resolve(ask).then(done, () => {});
    });
}
/** The handlers a poll feeds (the same ones a notification would): kept from wire() by tpmsHandlers. */
function tpmsHandlers(hud, extra) {
    const e = extra && extra[IF.tpms];
    st(hud).tpms.handlers = e ? { statusTyrePressure: e.statusTyrePressure, statusTyreTemperature: e.statusTyreTemperature, statusTargetTyrePressure: e.statusTargetTyrePressure } : null;
}

/** A TPMS pressure raw (0.1 x the car's unit, 65532 and up = none) in bar (the engine's plausible-range reading: bar 0.5-6, psi 7-60, kPa 60-600). */
function tyreBar(raw) {
    if (!isNum(raw) || raw < 0 || raw >= 65532) return null;
    const v = raw / 10;
    if (v >= 0.5 && v <= 6) return v;
    if (v >= 7 && v < 60) return v / 14.5038;
    if (v >= 60 && v <= 600) return v / 100;
    return null;
}

/* ------------------------------------------------------------------ the page ------------------------------------- */

/** The selected tab: shared/twin_tabs.js's state (hud.tabs.tab, SB's prototype) or the engine's hud.twinTab (B1's contract), tab 1 until either exists. */
function tabOf(hud) {
    const n = hud && hud.tabs && isNum(hud.tabs.tab) ? hud.tabs.tab : hud ? hud.twinTab : null;
    return isNum(n) && n >= 1 && n <= 5 ? n : 1;
}

/** Tab 1's pages in the cycle's order: the clock, the trip, technical data, the tyres (config.pages.tyres).
 *  FIN (the owner, 2026-11-18): "Технічні дані: сховати" hides BOTH technical pages - the technical data and the tyres. */
function computerList(hud) {
    const l = ['clock', 'trip'];
    if (setting(hud, 'techData') === 'hide') return l;
    l.push('tech');
    if (pagesCfg(hud).tyres === true) l.push('tyres');
    return l;
}

/** The page of tab 1. Setting `centre`: clock | trip | tech | cycle (default); a hidden technical page is out of the choice and the cycle. */
function computerPage(hud, t) {
    const p = st(hud), list = computerList(hud), mode = setting(hud, 'centre');
    if (list.indexOf(mode) >= 0) { p.cyc = mode; p.cycSince = t; return mode; }
    if (list.indexOf(p.cyc) < 0) { p.cyc = list[0]; p.cycSince = t; }
    if (!p.cycSince) p.cycSince = t;
    const hold = isNum(twinCfg(hud).holdAboveKmh) ? twinCfg(hud).holdAboveKmh : LOCK_KMH;
    const dwell = isNum(twinCfg(hud).cyclePageMs) ? twinCfg(hud).cyclePageMs : DWELL_MS;
    const v = hud && typeof hud._raw === 'function' ? hud._raw('speed') : null;
    if (isNum(v) && v > hold) { p.cycSince = t; return p.cyc; }          // moving: the page stays, the dwell starts at the stop
    if (t - p.cycSince >= dwell) { p.cyc = list[(list.indexOf(p.cyc) + 1) % list.length]; p.cycSince = t; }
    return p.cyc;
}

function mediaPage(hud) {
    if (pagesCfg(hud).media !== true) return 'media';
    const m = st(hud).media;
    if (m.src === 'radio' && (m.station || m.title)) return 'radio';
    if (m.src !== 'radio' && trackTitle(m)) return 'track';        // car-fix CF3: a CarPlay title, or the HMI's TITLE line
    return 'media';
}
function phonePage(hud) { return pagesCfg(hud).phone === true && callLive(hud) ? 'call' : 'phone'; }

/** The map window's variant: "W1" | "W2" | "W3" | null (config.mapWindow). */
function mapVariant(hud) {
    const w = cfgOf(hud).mapWindow;
    const v = w && typeof w === 'object' ? w.variant : w;
    return v === 'W1' || v === 'W2' || v === 'W3' ? v : null;      // car-issues MW: + W3 (the free space between the dials)
}
/**
 * Is BMW's map believed to be under the window (SPEC 4.5)? { open, why } - why is a word for the log and the tests.
 * (S1) cluster-render's slot rows, once config.mapSlots says they are readable; until then (S2) the cluster's map-view
 * setting AND (guidance active OR the "map without a route" setting). Any doubt closes it; a fresh panel mapping shuts it
 * for config.mapShutMs (8 s).
 */
/**
 * FIN (the owner, 2026-11-18): the setting "Навігація" (navView) = auto | map | arrows, applied in place. The map window itself
 * stays the experiment behind config.mapWindow; this only says when tab 5 prefers it:
 *   auto    the map when it is present, else the arrow / CarPlay-route page: presence is the strict rule below (S2: the cluster's
 *           map view AND BMW's guidance or "map without a route"), so a CarPlay route with BMW's guidance idle shows our route page;
 *   map     ("карта") the map window whenever BMW's map is present: S2 is the cluster's map view alone (with or without a route, a
 *           CarPlay route included); otherwise the same fallback pages;
 *   arrows  ("стрілки") never the map (not even forced): the arrow / route / fallback pages only.
 * Anything else reads as auto. There is no key for it: the TRIP button stays the tab key only.
 */
const NAV_VIEWS = ['auto', 'map', 'arrows'];
function navView(hud) { const v = setting(hud, 'navView'); return NAV_VIEWS.indexOf(v) >= 0 ? v : 'auto'; }

function mapState(hud, t) {
    const p = st(hud), c = cfgOf(hud);
    if (!mapVariant(hud)) return { open: false, why: 'off' };
    if (tabOf(hud) !== 5) return { open: false, why: 'tab' };
    const view = navView(hud);
    if (view === 'arrows') return { open: false, why: 'setting arrows' };
    const shut = isNum(c.mapShutMs) ? c.mapShutMs : MAP_SHUT_MS;
    if (p.built && t - p.built < shut) return { open: false, why: 'shut after mapping' };
    if (c.mapForce === true) return { open: true, why: 'forced' };
    if (c.mapSlots === true) {
        if (!p.slots || t - p.slotsAt > SLOT_FRESH_MS) return { open: false, why: 'slot rows stale' };
        return p.slots.mapped ? { open: true, why: 'slots' } : { open: false, why: 'slot 0x100 has no map' };
    }
    const isMap = typeof p.navType === 'string' ? /KARTENANSICHT/.test(p.navType) : p.navType === 2;
    if (!isMap) return { open: false, why: 'cluster is not in map view' };
    if (view === 'map') return { open: true, why: 'map view (setting map)' };
    if (p.guiding === 'ACTIVE' || p.nonNavi === true) return { open: true, why: 'setting' };
    return { open: false, why: 'no route and map-without-route off' };
}
/** cluster-render's status text -> { mapped } for slot 0x100 (SN: a status other than 0 and a content with "map 1"), or null. */
function parseSlots(text) {
    if (typeof text !== 'string') return null;
    const m = /^slot 0x100 status (\d+): (.*)$/m.exec(text);
    if (!m) return null;
    const status = Number(m[1]);
    const contents = m[2].split(',').map((s) => /(0x[0-9a-f]+) class (\d+) map (\d+)/i.exec(s)).filter(Boolean);
    return { status: status, mapped: status !== 0 && contents.some((c) => Number(c[1]) !== 0 && Number(c[3]) === 1) };
}
/** hud.js hands every cluster-render status text here (twin_dial hook). */
function onStatus(hud, text) {
    try {
        const s = parseSlots(text);
        if (!s) return;
        const p = st(hud);
        p.slots = s; p.slotsAt = nowMs(hud);
        if (cfgOf(hud).mapSlotLog === true) once(hud, 'slots:' + s.status + ':' + s.mapped, 'map slot 0x100: status ' + s.status + ', map ' + (s.mapped ? 'yes' : 'no'));
    } catch (e) { /* never */ }
}

/**
 * car-fix CF3: a route guided by CarPlay (config.pages.route): the provider is CAR_PLAY, BMW's own guidance is not running (its
 * arrow page keeps BMW's route, dark until tested) and a destination came within the last minute. Android Auto and the others
 * have not been seen: no page for them.
 */
function routeLive(hud, t) {
    const p = st(hud);
    if (pagesCfg(hud).route !== true || p.provider !== 'CAR_PLAY' || !p.dest) return false;
    if (p.guiding === 'ACTIVE' || p.guiding === 'CALCULATING_ROUTE') return false;
    return t - p.destAt <= ROUTE_FRESH_MS && t >= p.destAt;
}

/** car-fix CF3: tab rule 3 for a CarPlay route - hud.td.route (shared/twin_tabs.js navOn), kept current from the nav handlers and every page tick. */
function routeBridge(hud) {
    const td = hud && hud.td;
    if (td && typeof td === 'object') td.route = routeLive(hud, nowMs(hud));
}

/* ---------------------------------------------------- car issues CT: CarPlay's next turn ------------------------- */

const cpOn = (hud) => cfgOf(hud).carplayTurns === true;
const phoneGuides = (hud) => { const T = turnsMod(); return !!(T && T.isPhone(st(hud).provider)); };
const CP_UNITS = I.words('twin.cp.', ['METER', 'KM', 'MILE_UK', 'MILE_US', 'YARD', 'FEET']);      // the phone's distance units, in the language in use

/** A decoded event (shared/carplay_turns.js) -> the arrow page's model: { kind (our pictogram key, as dartOf), exit, side, dist (m), num, unit, road }. */
function cpModel(e) {
    let d;
    if (e.kind === 'alongMainRoad') d = { kind: e.mainDir === 'LEFT' ? 'slight_left' : e.mainDir === 'RIGHT' ? 'slight_right' : 'straight', exit: null, side: null };
    else { const m = {}; m[e.kind] = e.body; d = dartOf({ maneuver: m }) || { kind: null, exit: null, side: null }; }
    return { kind: d.kind, exit: d.exit, side: d.side, dist: e.dist.metres, num: e.dist.num, unit: e.dist.unit, road: e.road || null, src: e.kind };
}

/**
 * The poll (from update(), every evaluation): shared/carplay_turns.js's Poller asks queryContent every 2 s while the test mode is on
 * and the phone guides; it stops (no call) when either goes. A reply's next turn is kept with its time; a failed call drops it.
 * The log: the poll on / off, the first call's outcome and every change of it (shared/carplay_turns.js), and the KIND of the turn
 * shown once per change - never its road, never its distance.
 */
function cpSync(hud, t) {
    const p = st(hud), c = p.cp, T = turnsMod();
    if (!T) return;
    if (!c.poller) {
        if (!cpOn(hud)) return;
        c.poller = new T.Poller({
            signals: hud && hud.ctx && hud.ctx.signals, now: () => nowMs(hud),
            log: (s) => log(hud, 'info', s),
            wanted: () => cpOn(hud) && phoneGuides(hud),
            onReply: (reply, d, at) => {
                const e = T.nextTurn(d);
                c.turn = e ? cpModel(e) : null; c.at = at;
                const kind = c.turn ? c.turn.src + ' ' + String(c.turn.kind) : null;
                if (kind !== c.kind) { c.kind = kind; log(hud, 'info', 'carplay turns: ' + (kind ? 'turn ' + kind + (c.turn.road ? ', a road of ' + c.turn.road.length + ' characters' : '') : 'no turn in the reply (' + d.count + ' events)')); }
            },
            onFail: () => { c.turn = null; c.kind = undefined; },
        });
    }
    c.poller.tick(t);
    if (!c.poller.on) { c.turn = null; c.kind = undefined; }
}
/** The arrow page from CarPlay's turn: the test mode, the phone guiding, BMW's own guidance idle, a turn read within 6 s. */
function cpLive(hud, t) {
    const p = st(hud), c = p.cp, T = turnsMod();
    if (!T || !cpOn(hud) || !c.turn || !phoneGuides(hud)) return false;
    if (p.guiding === 'ACTIVE' || p.guiding === 'CALCULATING_ROUTE') return false;
    return t - c.at <= T.FRESH_MS && t >= c.at;
}
/** The phone's own distance for the page: { n, u } (its number with a "." and its unit), else our metres format, else null. */
function cpDist(turn) {
    if (!turn) return null;
    if (typeof turn.num === 'string' && /^\d{1,6}(\.\d{1,3})?$/.test(turn.num) && CP_UNITS[turn.unit]) return { n: turn.num, u: CP_UNITS[turn.unit] };
    return fmtDist(turn.dist);
}
/** What the arrow page draws: CarPlay's turn when navPage chose it, else BMW's manoeuvre. */
const guideOf = (p) => (p.guideSrc === 'cp' && p.cp.turn ? p.cp.turn : p.dart);

/**
 * tab 5. car issues CT - navView ("Навігація") and the CarPlay turn: "карта" with the map window open: the map wins (mapState first);
 * "стрілки": never the map, so the CarPlay arrow page whenever it is live; "авто": the map only by its strict rule (with a CarPlay
 * route BMW's guidance is INACTIVE, so normally shut), else the CarPlay arrow page, else the CarPlay route page.
 */
function navPage(hud, t) {
    const p = st(hud);
    if (mapState(hud, t).open) return 'map';
    if (p.guiding === 'ACTIVE' && pagesCfg(hud).guidance === true) { p.guideSrc = 'bmw'; return 'guide'; }
    if (cpLive(hud, t)) { p.guideSrc = 'cp'; return 'guide'; }
    p.guideSrc = 'bmw';
    if (routeLive(hud, t)) return 'route';
    if (p.guiding === 'CALCULATING_ROUTE') return 'calc';
    return p.road ? 'road' : 'none';
}

/** The page that shows now (and the ids the layout carries). */
function decide(hud, t) {
    switch (tabOf(hud)) {
        case 2: return 'msg';
        case 3: return mediaPage(hud);
        case 4: return phonePage(hud);
        case 5: return navPage(hud, t);
        default: return twinFront && twinFront.takesTab1(hud) ? 'front' : computerPage(hud, t);     // front-vehicle FV: the test takes tab 1
    }
}
function current(hud) { const p = st(hud); return p.page; }

/** Setting changed: decided again at the next tick. */
function changed(hud) { const p = st(hud); p.evalAt = -1e9; if (hud && hud.widgets && hud.widgets.forEach) hud.widgets.forEach((x) => { if (x.w && x.w.type === 'tdpage') x.pgKey = null; }); }

/* ------------------------------------------------------------------ tokens --------------------------------------- */

const TITLES = I.words('twin.page.', ['clock', 'trip', 'tech', 'tyres', 'msg', 'media', 'track', 'radio', 'phone', 'guide', 'route', 'calc', 'road', 'none', 'map']);

const fixed = (n, d) => (isNum(n) ? n.toFixed(d) : DASH);
const clockText = (L) => (L ? pad2(L.h) + ':' + pad2(L.mi) : DASH + DASH + ':' + DASH + DASH);
const mmss = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return (h ? h + ':' + pad2(m) : pad2(m)) + ':' + pad2(r); };

/** The four technical rows: label is in the layout; value, range, warning, source, decimals, sign here. */
const TECH = [
    { key: 'oil', lo: 50, hi: 150, warn: 130, dec: 0, unit: '°C' },
    { key: 'coolant', lo: 50, hi: 130, warn: 120, dec: 0, unit: '°C' },
    { key: 'boost', lo: 0, hi: 1.6, warn: null, dec: 2, unitKey: 'twin.u.bar' },
    { key: 'ambient', lo: null, hi: null, warn: null, dec: 1, unit: '°C', signed: true },
];
function techValue(hud, i) {
    const r = TECH[i];
    const v = hud && typeof hud._raw === 'function' ? hud._raw(r.key) : null;
    return isNum(v) ? v : null;
}
const BAR_LIMITS = { oil: [-40, 250], coolant: [-40, 250], boost: [-1, 4], ambient: [-60, 80] };      // a value outside is not a reading

function tripFormat(hud) {
    const T = tok().tripValues(hud);
    return T;
}

/** The location line of a media source, our own words (SPEC 4.3). */
const SOURCE_NAMES = I.words('twin.src.', ['radio', 'usb', 'bluetooth', 'carplay', 'phone', 'online', 'other']);

function fmtDist(m) {
    // SN distance_format: < 100 m to 10 m, < 1000 m to 50 m, from 1 km one decimal up to 10 km, whole km above
    if (!isNum(m) || m < 0) return null;
    if (m < 100) return { n: String(Math.round(m / 10) * 10), u: I.t('twin.u.m') };
    if (m < 1000) return { n: String(Math.round(m / 50) * 50), u: I.t('twin.u.m') };
    if (m < 10000) return { n: (m / 1000).toFixed(1), u: I.t('twin.u.km') };
    return { n: String(Math.round(m / 1000)), u: I.t('twin.u.km') };
}
/** car-fix CF3: a travel time in seconds -> "11 хв" / "1 год 05 хв" (at least one minute), or ''. */
function fmtTravel(s) {
    if (!isNum(s) || s <= 0) return '';
    const mins = Math.max(1, Math.round(s / 60)), h = Math.floor(mins / 60), mi = mins % 60;
    return h ? I.t('twin.travel.hm', { h: h, m: pad2(mi) }) : I.t('twin.travel.m', { m: mi });
}

/** B6's pictogram of a turn direction (also the lane arrows): straight, (slight_ / hard_)left|right, uturn_left|right. */
function turnIcon(dir) {
    if (!dir) return '';
    if (dir === 'straight') return 'td_straight';
    if (/^uturn_/.test(dir)) return 'td_' + dir;
    return 'td_turn_' + dir;
}
/**
 * The pictogram of a manoeuvre (B6's set, SN pictograms_needed): '' with no manoeuvre (the page shows the distance and the
 * road alone), the plain dot when the kind is unknown - an arrow is never guessed. Roundabouts by exit and traffic side
 * (td_rb<1..6>_r: right-hand traffic, counter-clockwise; _l mirrored); the exit number is drawn inside by the page.
 */
function maneuverIcon(d) {
    if (!d) return '';
    const have = iconsMod.ICONS || {}, k = d.kind;
    let n = null;
    if (!k) n = 'td_dot';
    else if (k === 'roundabout') n = d.exit >= 1 && d.exit <= 6 ? 'td_rb' + d.exit + (d.side === 'LEFT' ? '_l' : '_r') : 'td_rb1' + (d.side === 'LEFT' ? '_l' : '_r');
    else if (k === 'flag') n = 'td_flag_centre';
    else if (/^(flag|fork|exit|merge|lane_change)_/.test(k)) n = 'td_' + k;
    else n = turnIcon(k);
    if (have[n]) return n;
    return have.td_dot ? 'td_dot' : pickIcon(ICON.nav);
}

/**
 * {{td:pg...}} -> text (the generator's page items name these); undefined for a name that is not ours. Never throws.
 */
function token(hud, name) {
    try { return resolveToken(hud, name); } catch (e) { log(hud, 'warn', 'twin page token ' + name + ': ' + (e && e.message || e)); return ''; }
}
function resolveToken(hud, name) {
    const p = st(hud), t = nowMs(hud), T = tok();
    let m;
    switch (name) {
        case 'pgTitle': {
            if (p.page === 'call') {
                const s = callState(hud);
                return I.t(s === 'INCOMING' ? 'twin.call.in' : s === 'ACTIVE' || s === 'HELD' ? 'twin.call.talk' : s === 'DIALING' ? 'twin.call.dial' : 'twin.page.phone');
            }
            return TITLES[p.page] || '';
        }
        // ---- pictograms by name with their fallbacks (an icon B6 has not drawn yet is not drawn)
        case 'pgIconRoad': return pickIcon(ICON.road);
        case 'pgIconRadio': return pickIcon(ICON.radio);
        case 'pgIconPhone': return pickIcon(ICON.phone);
        case 'pgIconFuel': return pickIcon(ICON.fuel);
        // ---- tab 1: the clock
        case 'pgTime': return clockText(T.local(hud));
        case 'pgWeekday': { const L = T.local(hud); return L ? T.WEEKDAYS[L.wd] : ''; }
        case 'pgDate': { const L = T.local(hud); return L ? pad2(L.d) + '.' + pad2(L.mo) + '.' + L.y : ''; }
        // ---- tab 1: the trip
        case 'pgTripMeta': { const v = T.tripValues(hud); return (isNum(v.hours) ? v.hours + ':' + pad2(v.minutes) : DASH + ':' + DASH + DASH) + ' ' + I.t('twin.u.h'); }
        case 'pgTripCons': return 'ø ' + fixed(T.tripValues(hud).cons, 1);
        case 'pgTripSpeed': { const v = T.tripValues(hud); return 'ø ' + (isNum(v.speed) ? String(Math.round(v.speed)) : DASH); }
        case 'pgTripWay': return fixed(T.tripValues(hud).way, 1);
        case 'pgTripFooter': { const v = T.tripValues(hud); return I.t('twin.trip.from', { at: v.from ? pad2(v.from.h) + ':' + pad2(v.from.m) : DASH }); }
        // ---- tab 1: technical data
        default: break;
    }
    if ((m = /^pgTech([VUFWC])([0-3])$/.exec(name))) {
        const i = Number(m[2]), r = TECH[i], v = techValue(hud, i), lim = BAR_LIMITS[r.key];
        const ok = v !== null && v >= lim[0] && v <= lim[1];
        switch (m[1]) {
            case 'V': return ok ? (r.signed ? (Math.round(v * 10) / 10 >= 0 ? '+' : '-') + Math.abs(v).toFixed(r.dec) : v.toFixed(r.dec)) : DASH;
            case 'U': return ok ? (r.unitKey ? I.t(r.unitKey) : r.unit) : '';
            case 'F': return ok && r.lo !== null ? Math.max(0, Math.min(1, (v - r.lo) / (r.hi - r.lo))).toFixed(4) : '';
            case 'W': return r.warn !== null ? ((r.warn - r.lo) / (r.hi - r.lo)).toFixed(4) : '';
            default: return ok && r.warn !== null && v >= r.warn ? 'hot' : 'fg';
        }
    }
    // ---- tab 1: tyres
    if ((m = /^pgTyre([PTC])([0-3])$/.exec(name))) {
        const i = Number(m[2]), ty = p.tpms, fresh2 = ty.p && ty.at && t - ty.at < 60000;
        const bar = fresh2 ? tyreBar(ty.p[i]) : null;
        if (m[1] === 'P') return bar !== null ? bar.toFixed(1) : DASH;
        if (m[1] === 'T') { const raw = ty.t ? ty.t[i] : null; return fresh2 && isNum(raw) && raw < 65535 ? (raw - 40 >= 0 ? '+' : '-') + Math.abs(raw - 40) + ' °C' : ''; }
        const tg = ty.target ? tyreBar(ty.target[i]) : null;
        return bar !== null && tg !== null && tg - bar >= 0.2 ? 'amber' : 'fg';
    }
    const md = p.media;
    switch (name) {
        // ---- tab 3
        case 'pgSrcIcon': return pickIcon(md.src === 'radio' ? ICON.radio : md.src === 'carplay' ? ICON.proj : ICON.media);
        case 'pgMediaMeta': return md.src === 'radio' ? md.band || '' : SOURCE_NAMES[md.src] || '';
        case 'pgStation': return md.station || md.title || '';
        case 'pgRadioText': return md.stationText || md.three || md.artist || '';
        case 'pgRadioFoot': {
            const bits = [];
            if (md.preset) bits.push('P' + md.preset);
            if (md.freq) bits.push(md.freq.toFixed(1));
            if (md.tp) bits.push('TP');
            return bits.join('  ·  ');
        }
        // car-fix CF3: CarPlay's title / artist / time when CarPlay plays, the HMI's otherwise (trackTitle / trackArtist / trackTime)
        case 'pgTrackTitle': return trackTitle(md) || '';
        case 'pgTrackArtist': return trackArtist(md) || '';
        case 'pgTrackFrac': { const tm = trackTime(md); return isNum(tm.el) && isNum(tm.tot) ? String(Math.max(0, Math.min(1, tm.el / tm.tot)).toFixed(4)) : ''; }
        case 'pgTrackEl': { const tm = trackTime(md); return isNum(tm.el) && isNum(tm.tot) ? mmss(tm.el / 1000) : ''; }
        case 'pgTrackTot': { const tm = trackTime(md); return isNum(tm.tot) ? mmss(tm.tot / 1000) : ''; }
        case 'pgTrackNo': return md.cpPos && md.cpTotal ? md.cpPos + ' / ' + md.cpTotal : '';
        case 'pgMute': return md.mute ? pickIcon(ICON.mute) : '';
        // ---- tab 4 (car-fix CF3: the device lines only with config.pages.phoneDevices - DevicePresentation has never been seen)
        case 'pgPhoneLine1': {
            const d = devicesOn(hud) ? p.phone.dev : null;
            return d ? I.t('twin.phone.on') + (d.path ? ' · ' + d.path : '') : I.t(devicesOn(hud) && p.phone.devSeen ? 'twin.phone.off' : 'twin.noData');
        }
        case 'pgPhoneLine2': {
            const d = devicesOn(hud) ? p.phone.dev : null, bits = [];
            if (d && d.battery !== null) bits.push(Math.round(d.battery) + ' %');
            if (d && d.signal !== null) bits.push(d.signal + '/4');
            return bits.join('  ·  ');
        }
        case 'pgCallIcon': return callState(hud) === 'INCOMING' ? pickIcon(ICON.ring) : '';
        case 'pgCallTimer': {
            const s = callState(hud), ph = p.phone;
            return s === 'ACTIVE' || s === 'HELD' ? mmss(ph.activeAt ? (t - ph.activeAt) / 1000 : 0) : '';
        }
        case 'pgCallWho': {
            const ph = p.phone;
            if (!detailOn(hud)) return '';          // car-fix CF3: VoiceCall (contact, name) unseen: dark
            if (ph.name && setting(hud, 'callerName') === 'on') return ph.name;
            return ph.contact === true ? I.t('twin.call.contact') : ph.contact === false ? I.t('twin.call.number') : '';
        }
        case 'pgCallPath': return devicesOn(hud) && p.phone.dev && p.phone.dev.path ? p.phone.dev.path : '';
        case 'pgCallMic': return detailOn(hud) && p.phone.mic === true ? pickIcon(ICON.micOff) : '';
        case 'pgCallHandset': { const s = callState(hud); return s === 'ACTIVE' || s === 'HELD' ? pickIcon(ICON.handset) : ''; }
        // ---- tab 5
        case 'pgRoad': return p.road || '';
        case 'pgNavSub': return I.t(p.guiding === 'ACTIVE' ? 'twin.nav.route' : 'twin.nav.noRoute');
        case 'pgCalc': return I.t('twin.nav.calc');
        // car issues CT: guideOf(p) is CarPlay's turn when the page shows it (the test mode), else BMW's manoeuvre
        case 'pgGuideIcon': return maneuverIcon(guideOf(p));
        case 'pgGuideExit': { const g = guideOf(p); return g && g.kind === 'roundabout' && isNum(g.exit) && g.exit > 0 && g.exit < 100 ? String(g.exit) : ''; }
        case 'pgGuideDist': { const g = guideOf(p), d = g ? (g === p.cp.turn ? cpDist(g) : fmtDist(g.dist)) : null; return d ? d.n : DASH; }
        case 'pgGuideUnit': { const g = guideOf(p), d = g ? (g === p.cp.turn ? cpDist(g) : fmtDist(g.dist)) : null; return d ? d.u : ''; }
        case 'pgGuideRoad': { const g = guideOf(p); return g && g === p.cp.turn ? g.road || '' : p.road || ''; }
        case 'pgGuideFoot': {
            const d = p.dest, bits = [];
            if (d && d.eta) bits.push(I.t('twin.nav.eta', { at: pad2(d.eta.h) + ':' + pad2(d.eta.m) }));
            const f = d ? fmtDist(d.dist) : null;
            if (f) bits.push(f.n + ' ' + f.u);
            return bits.join(' · ');
        }
        case 'pgRoadBar': return p.road || '';
        // ---- tab 5, the CarPlay route (car-fix CF3): the destination block, no arrow
        case 'pgRouteMeta': return p.provider === 'CAR_PLAY' ? 'CarPlay' : '';
        case 'pgRouteDist': { const f = p.dest ? fmtDist(p.dest.dist) : null; return f ? f.n : DASH; }
        case 'pgRouteUnit': { const f = p.dest ? fmtDist(p.dest.dist) : null; return f ? f.u : ''; }
        case 'pgRouteEta': {
            const d = p.dest, bits = [];
            if (d && d.eta) bits.push(I.t('twin.nav.eta', { at: pad2(d.eta.h) + ':' + pad2(d.eta.m) }));
            if (d && d.travel !== null) bits.push(fmtTravel(d.travel));
            return bits.join(' · ');
        }
        case 'pgRouteRoad': return p.road || '';
        // car-fix CF3 (the lead): isOnGuidableRoad read false at the start of a CarPlay route - its meaning is unverified, so the note
        // is drawn only with config.pages.routeOffRoad (false)
        case 'pgRouteFoot': return pagesCfg(hud).routeOffRoad === true && p.onRoad === false ? I.t('twin.nav.offRoad') : '';
        default: break;
    }
    if ((m = /^pgLane([0-7])([IC])$/.exec(name))) {
        const l = p.lanes ? p.lanes[Number(m[1])] : null;
        if (!l) return '';
        if (m[2] === 'I') { const have = iconsMod.ICONS || {}; const n = turnIcon(l.dir); return have[n] ? n : ''; }
        return l.hi ? 'fg' : 'grey';
    }
    return undefined;
}

/* ---------------------------------------------------------------- the painter ------------------------------------- */

/** Source-over of a straight-alpha colour (a 0..1) onto one pixel of a straight-alpha RGBA buffer. */
function blend(buf, o, r, g, b, a) {
    if (a <= 0) return;
    const da = buf[o + 3] / 255, oa = a + da * (1 - a);
    if (da === 0) { buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = Math.round(a * 255); return; }
    buf[o] = Math.round((r * a + buf[o] * da * (1 - a)) / oa);
    buf[o + 1] = Math.round((g * a + buf[o + 1] * da * (1 - a)) / oa);
    buf[o + 2] = Math.round((b * a + buf[o + 2] * da * (1 - a)) / oa);
    buf[o + 3] = Math.round(oa * 255);
}
const rgbOf = (theme, role) => {
    const c = (theme && theme[role]) || (theme && theme.fg) || [255, 255, 255];
    return [c[0], c[1], c[2]];
};

/** `s` with every character the font lacks removed (a name in an odd script is not drawn as a hole), cut to `maxW` with an ellipsis. */
function fit(s, name, maxW) {
    const g = textRaster.loadFont(name).metrics.glyphs;
    let out = '';
    Array.from(String(s)).forEach((c) => { if (g[c] || c === ' ') out += c; });
    if (!isNum(maxW) || textRaster.measure(out, name, 0) <= maxW) return out;
    const ell = g[ELLIPSIS] ? ELLIPSIS : '...';
    while (out.length && textRaster.measure(out + ell, name, 0) > maxW) out = out.slice(0, -1);
    return out.replace(/\s+$/, '') + ell;
}

/** Paint a text; returns its ink box (panel px) or null. */
function paintText(c, it, s, rgb, alpha) {
    if (!s) return null;
    const name = fontName(it.f);
    if (!name) return null;
    const f = textRaster.loadFont(name).metrics;
    const text = fit(s, name, it.mw);
    if (!text) return null;
    const wpx = textRaster.measure(text, name, 0);
    const left = it.al === 'r' ? it.x - wpx : it.al === 'c' ? it.x - wpx / 2 : it.x;
    const bw = Math.ceil(wpx) + 4, bh = f.cellHeight;
    const mask = textRaster.mask(bw, bh, text, { font: name, x: 2 });
    const dx = Math.round(left) - 2, dy = Math.round(it.b) - f.baseline;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let y = 0; y < bh; y++) {
        const py = dy + y - c.y;
        for (let x = 0; x < bw; x++) {
            const cov = mask[y * bw + x];
            if (!cov) continue;
            const px = dx + x - c.x;
            if (cov > 40) { x0 = Math.min(x0, dx + x); x1 = Math.max(x1, dx + x + 1); y0 = Math.min(y0, dy + y); y1 = Math.max(y1, dy + y + 1); }
            if (px < 0 || py < 0 || px >= c.w || py >= c.h) continue;
            blend(c.buf, (py * c.w + px) * 4, rgb[0], rgb[1], rgb[2], cov / 255 * alpha);
        }
    }
    return x1 > x0 ? [x0, y0, x1, y1] : null;
}
function paintIconAt(c, name, size, cx, cy, rgb, alpha) {
    if (!name || !(iconsMod.ICONS || {})[name]) return null;
    const px = iconsMod.paintIcon(name, size, size, [rgb[0], rgb[1], rgb[2], 255]);
    const dx = Math.round(cx - size / 2), dy = Math.round(cy - size / 2);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const a = px[(y * size + x) * 4 + 3];
        const X = dx + x - c.x, Y = dy + y - c.y;
        if (!a || X < 0 || Y < 0 || X >= c.w || Y >= c.h) continue;
        blend(c.buf, (Y * c.w + X) * 4, rgb[0], rgb[1], rgb[2], a / 255 * alpha);
    }
    return [dx, dy, dx + size, dy + size];
}
function paintRect(c, x0, y0, x1, y1, rgb, alpha) {
    for (let y = Math.max(Math.floor(y0), c.y); y < Math.min(Math.ceil(y1), c.y + c.h); y++) {
        const ky = Math.min(y + 1, y1) - Math.max(y, y0);                 // vertical coverage of the row (a half row at .5)
        for (let x = Math.max(Math.floor(x0), c.x); x < Math.min(Math.ceil(x1), c.x + c.w); x++) {
            const kx = Math.min(x + 1, x1) - Math.max(x, x0);
            blend(c.buf, ((y - c.y) * c.w + (x - c.x)) * 4, rgb[0], rgb[1], rgb[2], Math.max(0, ky * kx) * alpha);
        }
    }
    return [x0, y0, x1, y1];
}
/** A rounded-rectangle outline (our own top-view car), `th` px thick, anti-aliased by its distance field. */
function paintRoundOutline(c, cx, cy, hw, hh, r, th, rgb, alpha) {
    const x0 = Math.floor(cx - hw - th), x1 = Math.ceil(cx + hw + th), y0 = Math.floor(cy - hh - th), y1 = Math.ceil(cy + hh + th);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const qx = Math.abs(x + 0.5 - cx) - (hw - r), qy = Math.abs(y + 0.5 - cy) - (hh - r);
        const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
        const a = Math.max(0, Math.min(1, 0.5 - (Math.abs(sd) - th / 2)));
        const X = x - c.x, Y = y - c.y;
        if (a > 0 && X >= 0 && Y >= 0 && X < c.w && Y < c.h) blend(c.buf, (Y * c.w + X) * 4, rgb[0], rgb[1], rgb[2], a * alpha);
    }
    return [x0, y0, x1, y1];
}

/**
 * Resolve a page's items against the car: [{ it, s, n, c, ... }] with every template answered. Items whose text or icon
 * answers "" are kept (and not drawn): the key of a repaint is what they answer.
 */
function resolveItems(hud, items) {
    const res = (s) => (typeof s === 'string' && s.indexOf('{{') >= 0 ? hud._resolve(s) : s);
    return (items || []).map((it) => {
        const r = { it: it, skip: it.if !== undefined && res(it.if) === '' };
        if (r.skip) return r;
        if (it.k === 't') { r.s = res(it.s); r.c = res(it.c) || 'fg'; }
        else if (it.k === 'i') { r.n = res(it.n); r.c = res(it.c) || 'fg'; }
        else if (it.k === 'bar') { r.v = res(it.v); r.w = res(it.w); r.c = res(it.c) || 'fg'; }
        else if (it.k === 'prog') { r.v = res(it.v); }
        else if (it.k === 'g') { r.parts = it.parts.map((q) => ({ s: res(q.s), c: res(q.c) || 'fg', f: q.f, gap: q.gap || 0 })); r.c = res(it.c) || 'fg'; }
        else if (it.k === 'lanes') { r.l = []; for (let i = 0; i < 8; i++) { r.l.push([res('{{td:pgLane' + i + 'I}}'), res('{{td:pgLane' + i + 'C}}')]); } }
        else if (it.k === 'frac') { r.c = res(it.c) || 'fg'; r.top = res(it.top); r.bot = res(it.bot); }      // r1120 LN: its words are {{word:...}}
        else if (it.k === 'r' || it.k === 'car') { r.c = res(it.c) || 'fg'; }
        return r;
    });
}

/**
 * Paint the resolved items into a transparent RGBA buffer of the layer. Returns { buf, ink } - ink: [{ id, box }] in panel
 * px, for the layout test (every text inside its page).
 */
function paintItems(resolved, layer, theme) {
    const c = { x: layer.x, y: layer.y, w: layer.w, h: layer.h, buf: Buffer.alloc(layer.w * layer.h * 4, 0) };
    const ink = [];
    const add = (id, box) => { if (box) ink.push({ id: id, box: box }); };
    resolved.forEach((r) => {
        const it = r.it, a = isNum(it.a) ? it.a : 1;
        if (r.skip) return;
        if (it.k === 't') add(it.id, paintText(c, it, r.s, rgbOf(theme, r.c), a));
        else if (it.k === 'i') add(it.id, paintIconAt(c, r.n, it.sz, it.cx, it.cy, rgbOf(theme, r.c), a));
        else if (it.k === 'r') add(it.id, paintRect(c, it.x0, it.y0, it.x1, it.y1, rgbOf(theme, r.c), a));
        else if (it.k === 'bar') {
            paintRect(c, it.x0, it.y, it.x1, it.y + it.h, rgbOf(theme, 'grey'), 1);          // the track: always, an empty bar for a missing value
            const f = parseFloat(r.v), w = parseFloat(r.w);
            if (isNum(f) && f > 0) {
                const xf = it.x0 + (it.x1 - it.x0) * f;
                if (isNum(w) && f > w) {
                    paintRect(c, it.x0, it.y, it.x0 + (it.x1 - it.x0) * w, it.y + it.h, rgbOf(theme, 'fg'), 1);
                    paintRect(c, it.x0 + (it.x1 - it.x0) * w, it.y, xf, it.y + it.h, rgbOf(theme, 'hot'), 1);
                } else paintRect(c, it.x0, it.y, xf, it.y + it.h, rgbOf(theme, 'fg'), 1);
            }
            ink.push({ id: it.id, box: [it.x0, it.y, it.x1, it.y + it.h] });
        } else if (it.k === 'prog') {
            if (r.v === '' || r.v === undefined) return;
            paintRect(c, it.x0, it.y - 1, it.x1, it.y + 1, rgbOf(theme, 'grey'), 1);
            paintRect(c, it.x0, it.y - 1, it.x0 + (it.x1 - it.x0) * (parseFloat(r.v) || 0), it.y + 1, rgbOf(theme, 'fg'), 1);
            ink.push({ id: it.id, box: [it.x0, it.y - 1, it.x1, it.y + 1] });
        } else if (it.k === 'g') {      // a group centred as one: value + unit
            const names = r.parts.map((q) => fontName(q.f));
            if (names.some((n) => !n)) return;
            const texts = r.parts.map((q, i) => fit(q.s || '', names[i], undefined));
            if (!texts[0]) return;
            const widths = texts.map((tx, i) => textRaster.measure(tx, names[i], 0));
            const total = widths.reduce((s, w, i) => s + w + (i ? r.parts[i].gap : 0), 0);
            let x = it.al === 'l' ? it.x : it.cx - total / 2;
            r.parts.forEach((q, i) => {
                if (i) x += q.gap;
                if (texts[i]) add(it.id + '.' + i, paintText(c, { f: q.f, x: x, b: it.b, al: 'l' }, texts[i], rgbOf(theme, q.c), 1));
                x += widths[i];
            });
        } else if (it.k === 'frac') {   // a stacked unit: top over a rule over the bottom
            const nm = fontName('u15');
            if (!nm) return;
            const top = r.top === undefined ? it.top : r.top, bot = r.bot === undefined ? it.bot : r.bot;
            const wd = Math.max(textRaster.measure(top, nm, 0), textRaster.measure(bot, nm, 0));
            const col = rgbOf(theme, r.c);
            add(it.id + '.t', paintText(c, { f: 'u15', x: it.x + wd / 2, b: it.b + it.dt, al: 'c' }, top, col, 1));
            paintRect(c, it.x, it.b + it.dr, it.x + wd, it.b + it.dr + 1, col, 1);
            add(it.id + '.b', paintText(c, { f: 'u15', x: it.x + wd / 2, b: it.b + it.db, al: 'c' }, bot, col, 1));
        } else if (it.k === 'lanes') {
            const have = r.l.filter((q) => q[0]);
            have.forEach((q, i) => {
                const cx = it.cx + (i - (have.length - 1) / 2) * it.pitch;
                add(it.id + '.' + i, paintIconAt(c, q[0], it.sz, cx, it.cy, rgbOf(theme, q[1] || 'grey'), 1));
            });
        } else if (it.k === 'car') {    // our own top-view car, an outline (tyres)
            const col = rgbOf(theme, 'dim');
            const hw = it.w / 2, hh = it.h / 2;
            paintRoundOutline(c, it.cx, it.cy, hw, hh, hw * 0.32, 3, col, 1);
            paintRect(c, it.cx - hw * 0.72, it.cy - hh + it.h * 0.30 - 1.5, it.cx + hw * 0.72, it.cy - hh + it.h * 0.30 + 1.5, col, 1);
            paintRect(c, it.cx - hw * 0.64, it.cy - hh + it.h * 0.78 - 1.5, it.cx + hw * 0.64, it.cy - hh + it.h * 0.78 + 1.5, col, 1);
            paintRoundOutline(c, it.cx, it.cy - hh + it.h * 0.53, hw * 0.64, it.h * 0.17, 6, 2, col, 1);
            ink.push({ id: it.id, box: [it.cx - hw - 2, it.cy - hh - 2, it.cx + hw + 2, it.cy + hh + 2] });
        }
    });
    return { buf: c.buf, ink: ink };
}

/* ------------------------------------------------------------- the engine's hooks -------------------------------- */

/** The pictogram-free key of a repaint: the page, every answer, and the theme's colours (a night change repaints). */
function keyOf(page, resolved, theme) {
    const th = ['fg', 'dim', 'grey', 'hot', 'ready', 'amber'].map((r) => (theme && theme[r] ? theme[r].slice(0, 3).join(',') : '')).join('|');
    return page + '#' + th + '#' + JSON.stringify(resolved.map((r) => [r.skip, r.s, r.n, r.c, r.v, r.w, r.parts && r.parts.map((q) => q.s + '/' + q.c), r.l, r.top, r.bot]));
}

/**
 * The map window to the backdrop (B1's contract, pub/B1/NOTE.md): hud.twinMap = null | "W1" | "W2"; the engine's
 * _twinBackSend turns it into tdback part L's u_map / u_mapF. Resent at once (the title rule steps aside as well).
 */
function mapSend(hud, open) {
    if (!hud) return;
    hud.twinMap = open ? mapVariant(hud) : null;
    if (typeof hud._twinBackForce === 'function') hud._twinBackForce();
    else if (typeof hud._twinSync === 'function') hud._twinSync();
}

/** "tdpage" born (a layout build): empty until the first update paints it. */
function init(hud, x) {
    const p = st(hud);
    // integration (B7): no "previous" pixels for a layer just made - its first paint goes up WHOLE. With a zero buffer here _blitDiff
    // sent only the rectangle that differs from black-transparent, which leaves the rest of a new layer to whatever cluster-render
    // starts it with (measured: after a rebuild the page layer never got a whole frame; tools/research3/mp/measure.js)
    x.px = null;
    x.pgKey = null;
    p.built = nowMs(hud); p.mapSent = null; p.evalAt = -1e9;
    update(hud, x, nowMs(hud), true);
}

/** One tick of the page layer: decide the page, resolve its items, repaint only when an answer changed. */
function update(hud, x, now, force) {
    const p = st(hud);
    if (!force && now - p.evalAt < EVAL_MS && now >= p.evalAt) return;
    p.evalAt = now;
    try { cpSync(hud, nowMs(hud)); } catch (e) { log(hud, 'warn', 'carplay turns: ' + (e && e.message || e)); }     // car issues CT: the test mode's poll
    const page = decide(hud, nowMs(hud));
    p.page = page;
    routeBridge(hud);          // car-fix CF3: a route older than 60 s stops selecting tab 5 at the next tick
    tpmsSync(hud, page === 'tyres');
    // the map window follows the page; the backdrop's title rule steps aside while it is open
    const open = page === 'map';
    // car-issues MW: also when the variant changed while open (Діагностика W2 -> W3 on tab 5): it was sent only on open / shut
    if (open !== p.mapSent || (open && hud.twinMap !== mapVariant(hud))) {
        p.mapSent = open;
        mapSend(hud, open);
        log(hud, 'info', 'map window ' + (open ? 'open (' + hud.twinMap + ')' : 'shut') + ' (' + mapState(hud, nowMs(hud)).why + ')');
    }
    // S1 asks cluster-render for its status while tab 5 is selected (every 2 s), once config.mapSlots says it can be read
    // b7: the Діагностика slot log (config.mapSlotLog) asks too, on tab 5 with a map window chosen, so the rows can be read before S1 is trusted
    if ((cfgOf(hud).mapSlots === true || cfgOf(hud).mapSlotLog === true) && tabOf(hud) === 5 && mapVariant(hud) && nowMs(hud) - p.mapAskAt > 2000 && hud.client && typeof hud.client.status === 'function') {
        p.mapAskAt = nowMs(hud);
        try { hud.client.status(); } catch (e) { /* never */ }
    }
    // front-vehicle FV: the test page paints itself (no layout items); a page painted in between is repainted whole on return
    if (page === 'front' && twinFront) { twinFront.updatePage(hud, x, now, force || x.pgKey !== '#front'); x.pgKey = '#front'; return; }
    const spec = x.w.pages && x.w.pages[page];
    const resolved = resolveItems(hud, spec ? spec.items : []);
    const key = keyOf(page, resolved, hud.theme);
    if (!force && key === x.pgKey && x.px) return;
    x.pgKey = key;
    const out = paintItems(resolved, x.w, hud.theme);
    x.pgInk = out.ink;
    hud._blitDiff(x, out.buf);
}

/** The title rule hides while the map window is open (the backdrop asks). */
function hideTitleRule(hud) { return st(hud).page === 'map'; }

module.exports = { tabBridge, LAYER, FONTS, SAIRA, ICON, TITLES, TECH, IF, fontName, pickIcon,
    wire, token, update, init, changed, current, decide, tabOf, computerList, mapState, mapVariant, parseSlots, onStatus, hideTitleRule, navView, NAV_VIEWS,
    resolveItems, paintItems, keyOf, fmtDist, maneuverIcon, tyreBar, callState, callLive, st, fresh,
    // for the tests
    descText, dartOf, lanesOf, destOf, deviceOf, tpmsPoll,
    // car-fix CF3
    int64, idKey, srcOf, trackTitle, trackArtist, trackTime, routeLive, routeBridge, fmtTravel, metres, ROUTE_FRESH_MS,
    // car issues CT
    cpSync, cpLive, cpModel, cpDist, CP_UNITS, turnsMod };
