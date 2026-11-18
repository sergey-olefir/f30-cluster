'use strict';
/**
 * twin_tokens.js - Twin Dial's own text tokens ({{td:...}}), its centre pages' cycle and the extra signal wiring
 * (docs/twin-dial/SPEC.md 5, 6, 11, 12). Package C of round 2. The dial bars' values (fuel, reserve, coolant) are the
 * engine's own (package B, docs/twin-dial/ENGINE-CONTRACT.md 3: _raw('fuel' | 'reserve' | 'coolant')).
 *
 * Where it plugs into the engine (every one a small marked block `// twin_dial:` in shared/hud.js, inert for every
 * other app):
 *   _token(tok)       a token that starts with "td:" is answered here (token(hud, tok))
 *   _setupVehicleData  wire(hud, extra): the fields only twin_dial reads (odometer, reserve, trip computer, phone,
 *                      navigation, media), chained BEHIND the handlers already on a field; only when config.twin is set
 *   _updateOne        a widget with "tdLive" (the tab bar's icons) is repainted by updateIcon(hud, x, now, force)
 *   the Car groups    config.carGroups, so twin_dial does not ask for fields it does not declare
 * The text widgets of both centre pages sit in the layout all the time; a token answers "" while its page is not the
 * one showing, so a page change is a repaint of the text widgets (the engine repaints what changed, nothing is rebuilt).
 *
 * State lives in hud.td. Nothing here throws (a throw inside a token would end the tick), nothing here ever logs a
 * text, a name or a coordinate: numbers and lengths only. Plain Node 8 (the car's 8.16.2): no ?. / ?? / **.
 */
const DASH = '–';            // en dash: "no value"
const THIN = ' ';            // thousands separator
const WEEKDAYS = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'];
const TITLES = { clock: 'Дата і час', trip: 'Поїздка', msg: 'Повідомлення', nav: 'Навігація', tab3: 'Медіа', tab4: 'Телефон' };     // twin_dial: tabs (B2): the titles of tabs 2..5 (package B4 owns the pages' content)
const KOMBI = 'de.bmw.infotainment.KombiIF';
const COND_READY_TWIN = 10;       // VehicleCondition 10 = FAHREN (SPEC 5.1)
const PAGE_EVAL_MS = 250;         // the page is decided at most this often, so every widget of one tick sees one page
const isNum = (x) => typeof x === 'number' && isFinite(x);
/** CallState (ConnectivityAggregator.aggregatedCallState, VoiceCall.state) as a number 0..4, or null for anything else. */
const CALL = { DISCONNECTED: 0, INCOMING: 1, ACTIVE: 2, DIALING: 3, HELD: 4 };
const callNum = (raw) => (isNum(raw) && raw >= 0 && raw <= 4 ? raw : typeof raw === 'string' && CALL.hasOwnProperty(raw) ? CALL[raw] : null);
const pages = () => require('./twin_pages');      // round 3 (B4): required when first used (twin_pages requires this file too)
const pad2 = (n) => (n < 10 ? '0' : '') + n;

function fresh() {
    return {
        mileage: null, spareRaw: undefined, odoRaw: undefined,
        avg: null, travel: null, start: null,
        rl3: null, odo: {},                          // research3/MK: ResetLogic3's trip, the odometer per source (km or null)
        seen: {}, t0: 0, timers: [], summaries: 0,   // research3/MK: first arrival per source (ms since wire), the summary
        call: null, nav: null, units: null, mediaLen: null, media: null,
        page: 'clock', pageSince: 0, pageEval: 0, pageNow: 0,
        clock: null,                                 // tests: () => ms
        logged: {},
    };
}
const st = (hud) => hud.td || (hud.td = fresh());
const now = (hud) => { const td = st(hud); return td.clock ? td.clock() : Date.now(); };
const cfg = (hud) => (hud && hud.config && hud.config.twin) || {};
const tripCfg = (hud) => (hud && hud.config && hud.config.trip) || {};
const log = (hud, level, s) => { try { if (hud && hud.log && hud.log[level]) hud.log[level](s); } catch (e) { /* never */ } };
/** Log a line once per key (numbers and enum names only). */
function once(hud, key, line) {
    const td = st(hud);
    if (td.logged[key] === line) return;
    td.logged[key] = line;
    log(hud, 'info', line);
}

/* ---------------------------------------------------------------- signals ---------------------------------------- */

/** A member of a struct value, or undefined. */
const member = (v, k) => (v && typeof v === 'object' ? v[k] : undefined);
/**
 * b7 (CP's finding): ResetLogic3.bcDataAll.bcData3 is an ARRAY of up to 5 BCData3 structs in the catalogue (arrayMaxLength 5), one per reset
 * logic, so the struct reads of the rl3 fallback found nothing. The entry used is the first one that carries a value (an average speed, a
 * consumption or a distance that is not the unfilled marker); with none valid, the first object (the page then shows dashes by its own rules);
 * a plain struct (the shape the tests and an older reading used) is taken as it is.
 */
function rl3Entry(d) {
    if (!Array.isArray(d)) return d;
    const valid = (e) => !!e && typeof e === 'object' && ((isNum(e.speedAverage) && e.speedAverage < 65535) || (isNum(e.consumptionCombustionAverageDigit) && e.consumptionCombustionAverageDigit < 65535)
        || (isNum(e.counterDistance) && e.counterDistance < 4294967295));
    return d.find(valid) || d.find((e) => e && typeof e === 'object');
}

/** An enum that may arrive as its name or its number: true when it is `on`. */
function enumIs(raw, names, nums) {
    if (typeof raw === 'string') return names.indexOf(raw) >= 0;
    if (isNum(raw)) return nums.indexOf(raw) >= 0;
    return false;
}

/**
 * Chain handler `fn` behind whatever is on extra[iface][field] already (the engine's own handler keeps running first).
 * A throw in `fn` is caught: a bad struct must not stop the car's data.
 */
function chain(hud, extra, iface, field, fn) {
    const e = extra[iface] = extra[iface] || {};
    const prev = e[field];
    e[field] = (v) => {
        if (prev) prev(v);
        try { fn(v); } catch (err) { log(hud, 'warn', 'twin: ' + field + ': ' + (err && err.message || err)); }
    };
}

/**
 * The fields only twin_dial reads. Called from _setupVehicleData with `extra` (the engine's table of handlers), only
 * when app.json config.twin exists. Read only; every handler stores numbers. research3/MK: the first arrival of each
 * trip and odometer source is one log line (raw numbers -> what is shown, UNVERIFIED), the summaries are scheduled here.
 */
function wire(hud, extra) {
    const td = st(hud);
    const IF = {
        media: 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState',
        phone: 'de.bmw.infotainment.connectivity.telephony.ConnectivityAggregator',
        nav: 'de.bmw.infotainment.navigation.navigationstatus.NavigationStatus',
        env: 'de.bmw.infrastructure.EnvironmentalInformation',
    };
    td.t0 = now(hud);
    td.handlers = {};
    const keep = (key) => { const s = SOURCES[key], e = extra[s[0]]; if (e && e[s[1]]) td.handlers[key] = e[s[1]]; };
    // the odometer and the reserve flag ride on the struct the engine reads for the fuel and the range
    chain(hud, extra, KOMBI, 'statusRangeTankStatus', (v) => {
        const m = member(v, 'mileageKilometre');
        td.mileage = odoValue(m, odoFactor(hud, 'rangeTank'));
        heard(hud, 'rangeTank');
        if (m !== td.odoRaw) {
            td.odoRaw = m;
            const first = !td.logged.odoFirst;
            td.logged.odoFirst = true;
            log(hud, 'info', 'odometer raw (P3): ' + (isNum(m) ? m : 'none') + ' -> ' + (td.mileage === null ? 'no value' : td.mileage + ' km (factor ' + odoFactor(hud, 'rangeTank') + ' km)')
                + (first ? ' [rangeTank, first at ' + secs(hud) + ' s' + (odoVerified(hud) ? '' : ', UNVERIFIED: compare with the cluster\'s odometer') + ']' : ''));
        }
        // the reserve flag itself is read by the engine (package B: _raw('reserve')); only its raw value is logged here
        const s = member(v, 'statusFluidLevelFuelTankSpare');
        if (s !== td.spareRaw) { td.spareRaw = s; log(hud, 'info', 'fuel reserve raw: ' + String(s) + ' -> ' + (s === undefined || s === null ? 'unknown' : enumIs(s, ['AKTIV', 'ACTIVE'], [1]) ? 'reserve' : 'no reserve')); }
    });
    keep('rangeTank');
    // research3/MK: the odometer's other carriers (config.odometer.order), each a fallback behind the range struct
    odoOrder(hud).forEach((key) => {
        if (key === 'rangeTank') return;
        const s = SOURCES[key];
        chain(hud, extra, s[0], s[1], (v) => {
            const raw = ODO_MEMBER[key](v);
            td.odo[key] = raw.ok ? odoValue(raw.km, 1) : null;          // raw; the factor is applied when it is read
            arrive(hud, key, 'odometer', raw.text, () => (td.odo[key] === null ? 'no value' : td.odo[key] * odoFactor(hud, key) + ' km (factor ' + odoFactor(hud, key) + ' km)'), odoVerified(hud) ? '' : 'compare with the cluster\'s odometer');
        });
        keep(key);
    });
    chain(hud, extra, KOMBI, 'statusBordcomputerAverage', (v) => {
        td.avg = {
            speed1: member(v, 'speedAverage1BC1'), cons1: member(v, 'consumptionAverage1BC1'),
            speed2: member(v, 'speedAverage2BC2'), cons2: member(v, 'consumptionAverage2BC2'),
            speedUnit: member(v, 'statusUnitOfMeasurementSpeedBC'), consUnit: member(v, 'statusUnitOfMeasurementConsumptionBC'),
        };
        const a = td.avg;
        arrive(hud, 'average', 'trip', 'speed1=' + fN(a.speed1) + ' cons1=' + fN(a.cons1) + ' speed2=' + fN(a.speed2) + ' cons2=' + fN(a.cons2) + ' speedUnit=' + fE(a.speedUnit) + ' consUnit=' + fE(a.consUnit),
            () => { const k = kombiTrip(td, factors(hud) || DEFAULT_FACTORS); return 'speed ' + fV(k.speed, 1) + ' km/h, cons ' + fV(k.cons, 1) + ' l/100 km (BC' + ((factors(hud) || DEFAULT_FACTORS).bc) + ')'; }, tripNote(hud));
    });
    keep('average');
    chain(hud, extra, KOMBI, 'statusBordcomputerTravelData', (v) => {
        td.travel = { hours: member(v, 'rideDurationHours'), minutes: member(v, 'rideDurationMinutes'), way: member(v, 'wayPassed') };
        arrive(hud, 'travel', 'trip', 'hours=' + fN(td.travel.hours) + ' minutes=' + fN(td.travel.minutes) + ' way=' + fN(td.travel.way),
            () => { const k = kombiTrip(td, factors(hud) || DEFAULT_FACTORS); return 'distance ' + fV(k.way, 1) + ' km, time ' + fT(k.time); }, tripNote(hud));
    });
    keep('travel');
    chain(hud, extra, KOMBI, 'statusBordcomputerTravelStart', (v) => {
        td.start = { h: member(v, 'hourDepartureBC'), m: member(v, 'minuteDepartureBC') };
        arrive(hud, 'start', 'trip', 'hour=' + fN(td.start.h) + ' minute=' + fN(td.start.m),
            () => { const k = kombiTrip(td, factors(hud) || DEFAULT_FACTORS); return 'departure ' + fT(k.from, true); }, 'compare with the car\'s trip page');
    });
    keep('start');
    // research3/MK: the head unit's own trip computer (ResetLogic3), the fallback for every trip value (config.trip.order)
    if (tripOrder(hud).indexOf('rl3') >= 0) {
        chain(hud, extra, SOURCES.rl3[0], SOURCES.rl3[1], (v) => {
            const d = rl3Entry(member(v, 'bcData3')), u = member(v, 'bcUnits'), mx = member(v, 'maxValues');     // b7: bcData3 is an ARRAY (0..5) in the catalogue
            const dt = member(d, 'dateTimeTrip'), dr = member(d, 'dateTimeReset');
            td.rl3 = {
                option: member(d, 'resetOption'), speed: member(d, 'speedAverage'),
                consDigit: member(d, 'consumptionCombustionAverageDigit'), consScale: member(d, 'consumptionCombustionAverageScale'),
                way: member(d, 'counterDistance'), tripDay: member(dt, 'day'), tripH: member(dt, 'hour'), tripM: member(dt, 'minute'),
                resetH: member(dr, 'hour'), resetM: member(dr, 'minute'),
            };
            const r = td.rl3;
            arrive(hud, 'rl3', 'trip', 'option=' + fE(r.option) + ' speedAvg=' + fN(r.speed) + ' consAvgDigit=' + fN(r.consDigit) + ' consAvgScale=' + fN(r.consScale)
                + ' consAvgMax=' + fN(member(mx, 'maxValueAverageConsumptionCombustion')) + ' distance=' + fN(r.way) + ' trip=' + fN(r.tripDay) + 'd' + fN(r.tripH) + 'h' + fN(r.tripM) + 'm'
                + ' reset=' + fN(r.resetH) + ':' + fN(r.resetM) + ' speedUnit=' + fE(member(u, 'tachoDigital')) + ' consUnit=' + fE(member(u, 'averageConsumptionCombustion')),
                () => { const k = rl3Trip(td, factors(hud) || DEFAULT_FACTORS); return 'speed ' + fV(k.speed, 1) + ' km/h, cons ' + fV(k.cons, 1) + ' l/100 km, distance ' + fV(k.way, 1) + ' km, time ' + fT(k.time) + ', departure ' + fT(k.from, true); }, tripNote(hud));
        });
        keep('rl3');
    }
    // research3/MK: after summaryMs (2 and 10 minutes) one summary that names every silent source and what the page shows
    const sm = Array.isArray(tripCfg(hud).summaryMs) ? tripCfg(hud).summaryMs : SUMMARY_MS;
    td.timers.forEach((t) => clearTimeout(t));
    td.timers = sm.filter(isNum).map((ms) => {
        const t = setTimeout(() => { try { summary(hud); } catch (e) { log(hud, 'warn', 'trip summary: ' + (e && e.message || e)); } }, ms);
        if (t && t.unref) t.unref();
        return t;
    });
    // the car's own distance unit: logged only, round 2 keeps km (SPEC 12)
    chain(hud, extra, IF.env, 'UnitBN2020', (v) => {
        const u = member(v, 'unitOfMeasurementMileage');
        td.units = u;
        once(hud, 'units', 'units raw (P5): mileage ' + String(u) + ' (round 2 shows km)');
    });
    // phone: an enum only, no number or name is read (SPEC 6.1)
    chain(hud, extra, IF.phone, 'aggregatedCallState', (v) => {
        const raw = isNum(v) || typeof v === 'string' ? v : member(v, 'aggregatedCallState');
        td.call = raw === undefined ? null : !enumIs(raw, ['DISCONNECTED'], [0]);
        td.callState = raw === undefined ? null : callNum(raw);        // twin_dial: tabs (B2): 0 none, 1 incoming, 2 active, 3 dialing, 4 held (rule 2, gated off)
        once(hud, 'call', 'phone state raw (P9): ' + String(raw));
    });
    // navigation: lit while a route is guided
    chain(hud, extra, IF.nav, 'guidingState', (v) => {
        const raw = isNum(v) || typeof v === 'string' ? v : member(v, 'guidingState');
        td.nav = raw === undefined ? null : enumIs(raw, ['ACTIVE'], [2]);
    });
    // media: only the LENGTH of what the head unit shows is read and logged (P8); the text is never kept unless
    // config.twin.media is switched on after P8 has shown which line is the title
    chain(hud, extra, IF.media, 'playerMetadata', (v) => {
        const a = member(v, 'firstLineText'), b = member(v, 'secondLineText');
        const la = typeof a === 'string' ? a.length : null, lb = typeof b === 'string' ? b.length : null;
        td.mediaLen = [la, lb];
        once(hud, 'media', 'media text (P8): first line ' + (la === null ? 'none' : la + ' characters') + ', second ' + (lb === null ? 'none' : lb + ' characters'));
        if (cfg(hud).media === true) td.media = typeof b === 'string' && b ? b : typeof a === 'string' ? a : null;
    });
    // twin_dial round 3 (B4): the fields only the centre pages read (shared/twin_pages.js), chained behind the ones above
    try { pages().wire(hud, extra); } catch (e) { log(hud, 'warn', 'twin pages: not wired (' + (e && e.message || e) + ')'); }
}

/* ------------------------------------- research3/MK: the trip computer's and the odometer's sources -------------------- */
/*
 * The owner's decision of 2026-11-18: no dashes by design. The signals ARE the trip computer; a "factor" is only the unit
 * of the raw integer, which the catalogue does not state. So the most likely factors are ON by default (DEFAULT_FACTORS,
 * overridable key by key in config.trip.factors; `false` switches the page back to dashes), each value is marked
 * UNVERIFIED once in the log (first arrival) until config.trip.verified / config.odometer.verified is set, and every
 * source's first arrival is one log line (raw numbers -> what the page shows). After summaryMs (2 and 10 minutes) one
 * summary names every SILENT source and asks the silent ones' getters once (read only), so the shipped build itself
 * tells "the car does not send it" (silent, getter error / no answer) from "the unit is wrong" (arrives, wrong number).
 * A value comes from the first source in config.trip.order (KombiIF, then ResetLogic3) that has a valid one; a dash is
 * left only for a value no source delivers (silent) or whose every source carries its invalid marker.
 */
const RL3 = 'de.bmw.infotainment.resetlogic.ResetLogic3';
/** key -> [interface, field, has a getter ("r")]. */
const SOURCES = {
    rangeTank: [KOMBI, 'statusRangeTankStatus', true],
    supreme: ['de.bmw.infrastructure.MileageSupreme', 'mileageSupreme', true],
    range: ['de.bmw.infrastructure.VehicleInformation', 'Range', false],          // notifier only ("s"): no getter to ask
    secure: ['de.bmw.infrastructure.SecureMileage', 'mileage', true],
    average: [KOMBI, 'statusBordcomputerAverage', true],
    travel: [KOMBI, 'statusBordcomputerTravelData', true],
    start: [KOMBI, 'statusBordcomputerTravelStart', true],
    rl3: [RL3, 'bcDataAll', true],
};
const TRIP_KEYS = ['average', 'travel', 'start', 'rl3'];
const DEFAULT_FACTORS = { bc: 1, speed: 0.1, cons: 0.1, way: 0.1, rl3: { speed: 0.1, cons: 0.1, way: 0.1 } };
const TRIP_ORDER = ['kombi', 'rl3'];
const ODO_ORDER = ['rangeTank', 'supreme', 'range', 'secure'];
const SUMMARY_MS = [120000, 600000];
const LOG_GAP_MS = 60000;            // a source's raw value is logged again at most this often (and only when it changed)
const LOG_MAX = 30;                  // ... and at most this many times per source
const ODO_BAD = 16777215;            // 0xFFFFFF and above: the unfilled odometer; 0: not initialised
const AVG_BAD = [4095, 65535];       // KombiIF averages: 12-bit and 16-bit "unfilled"
// the plausible range of each shown value: outside it the value is still shown, and the log says the factor is suspect
const PLAUSIBLE = { speed: [0, 250], cons: [0, 99.9], way: [0, 99999], odo: [1, 2000000] };

const fN = (x) => (isNum(x) ? String(x) : x === undefined || x === null ? '-' : '?');
const fE = (x) => (isNum(x) ? String(x) : typeof x === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(x) ? x : x === undefined || x === null ? '-' : '?');
const fV = (x, dec) => (isNum(x) ? x.toFixed(dec) : DASH);
const fT = (t, clock) => (t ? (clock ? pad2(t.h) : String(t.h)) + ':' + pad2(t.m) : DASH);
const secs = (hud) => { const td = st(hud); return ((now(hud) - td.t0) / 1000).toFixed(1); };

const odoCfg = (hud) => (hud && hud.config && hud.config.odometer) || {};
const odoVerified = (hud) => odoCfg(hud).verified === true;
function odoFactor(hud, key) {
    const f = odoCfg(hud).factors;
    return f && isNum(f[key]) ? f[key] : 1;
}
const odoValue = (m, factor) => (isNum(m) && m > 0 && m < ODO_BAD ? m * factor : null);
function odoOrder(hud) {
    const o = odoCfg(hud).order;
    return Array.isArray(o) ? o.filter((k) => ODO_ORDER.indexOf(k) >= 0) : ODO_ORDER;
}
function tripOrder(hud) {
    const o = tripCfg(hud).order;
    return Array.isArray(o) ? o.filter((k) => TRIP_ORDER.indexOf(k) >= 0) : TRIP_ORDER;
}
const tripNote = (hud) => (tripCfg(hud).verified === true ? '' : 'compare with the car\'s trip page');
/** The odometer's other carriers: their raw number and whether its qualifier (if any) says it is valid. */
const ODO_MEMBER = {
    supreme: (v) => {
        const m = member(v, 'mileageSupreme'), q = member(v, 'qualifierMileageSupreme');
        const ok = q === undefined || enumIs(q, ['EVENT_DATA_AVAILABLE', 'EVENT_DATA_AVAILABLE_REDUCED'], [0, 1]);
        return { km: m, ok, text: 'mileage=' + fN(m) + ' qualifier=' + fE(q) };
    },
    range: (v) => { const m = member(v, 'mileageKilometre'); return { km: m, ok: true, text: 'mileage=' + fN(m) }; },
    secure: (v) => { const m = member(v, 'currentMileage'); return { km: m, ok: true, text: 'mileage=' + fN(m) + ' manipulation=' + fN(member(v, 'manipulationState')) }; },
};

/** A source has spoken: count it, remember when it first did. */
function heard(hud, key) {
    const td = st(hud), s = td.seen[key];
    if (s) { s.n++; return s; }
    return (td.seen[key] = { at: now(hud) - td.t0, n: 1, logAt: -Infinity, logs: 0, raw: null });
}
/**
 * A source's value arrived: the first time one line "<what> <key> (<field>) first at T s: raw ... -> shown ... [UNVERIFIED:
 * note]"; later, a changed raw value at most every LOG_GAP_MS and LOG_MAX times. Numbers and enum names only.
 */
function arrive(hud, key, what, raw, shown, note) {
    const s = heard(hud, key), t = now(hud);
    if (s.raw === raw) return;
    const first = s.logs === 0;
    if (!first && (t - s.logAt < LOG_GAP_MS || s.logs >= LOG_MAX)) return;
    s.raw = raw; s.logAt = t; s.logs++;
    let out = '';
    try { out = shown(); } catch (e) { out = '?'; }
    log(hud, 'info', what + ' ' + key + ' (' + SOURCES[key][1] + ') ' + (first ? 'first' : '#' + s.n) + ' at ' + secs(hud) + ' s: raw ' + raw + ' -> ' + out
        + (first && note ? ' [UNVERIFIED: ' + note + ']' : '') + (s.logs === LOG_MAX ? ' (last raw line for this source)' : ''));
}

/** One trip value: raw x factor, or null for no number / an invalid marker. */
const scaled = (raw, factor, invalid) => (isNum(raw) && isNum(factor) && invalid.indexOf(raw) < 0 ? raw * factor : null);
/** A duration from whole hours and minutes (minutes above 59 carry), or null. */
function duration(h, m, hBad, mBad) {
    if (!isNum(h) || !isNum(m) || h < 0 || m < 0 || h >= hBad || m >= mBad) return null;
    const total = h * 60 + m;
    return { h: Math.floor(total / 60), m: total % 60 };
}
const clockOf = (h, m) => (isNum(h) && isNum(m) && h >= 0 && h < 24 && m >= 0 && m < 60 ? { h, m } : null);
/** KombiIF's trip values: { speed, cons, way, time: {h, m}, from: {h, m} }, each null when silent or invalid. */
function kombiTrip(td, f) {
    const out = { speed: null, cons: null, way: null, time: null, from: null };
    if (td.avg) {
        out.speed = scaled(td.avg['speed' + f.bc], f.speed, AVG_BAD);
        out.cons = scaled(td.avg['cons' + f.bc], f.cons, AVG_BAD);
    }
    if (td.travel) {
        out.way = scaled(td.travel.way, f.way, [65535]);
        out.time = duration(td.travel.hours, td.travel.minutes, 4095, 255);
    }
    if (td.start) out.from = clockOf(td.start.h, td.start.m);
    return out;
}
/**
 * ResetLogic3's trip values (the head unit's own board computer). speedAverage and the consumption's "Digit" are taken
 * as the shown number in units of the factor (the "Scale" member is read as the bar position against maxValues, so it
 * is logged, not shown); counterDistance x factor; the duration is days, hours, minutes; the departure is the reset time
 * only while the reset option is "start of driving" (4): any other option's reset time is not this trip's start.
 */
function rl3Trip(td, f) {
    const out = { speed: null, cons: null, way: null, time: null, from: null }, r = td.rl3;
    if (!r) return out;
    out.speed = scaled(r.speed, f.rl3.speed, [65535]);
    out.cons = scaled(r.consDigit, f.rl3.cons, [65535]);
    out.way = scaled(r.way, f.rl3.way, [4294967295]);
    if (isNum(r.tripDay) && r.tripDay >= 0 && r.tripDay < 65535 && isNum(r.tripH) && r.tripH >= 0 && r.tripH < 24) out.time = duration(r.tripDay * 24 + r.tripH, r.tripM, Infinity, 255);
    if (enumIs(r.option, ['STARTOFDRIVING'], [4])) out.from = clockOf(r.resetH, r.resetM);
    return out;
}

/* ------------------------------------------------------------------ pages --------------------------------------- */

/** The page that shows now: 'clock' | 'trip' (tab 1), or with live tabs 'msg' | 'tab3' | 'tab4' | 'nav'. Setting `centre` = clock | trip | cycle (SPEC 6.2). */
function page(hud) {
    // twin_dial: tabs (B2): with live tabs (config.tabs) the selected tab picks the page; tab 1 is the computer (clock / trip below)
    if (hud._twinTabsOn && hud._twinTabsOn()) {
        const tp = require('./twin_tabs').pageOf(hud);
        if (tp !== 'computer') return tp;
    }
    const td = st(hud), t = now(hud), mode = hud.setting ? hud.setting('centre') : 'cycle';
    if (mode === 'clock' || mode === 'trip') { td.page = mode; td.pageSince = t; return mode; }
    if (td.pageEval && t - td.pageEval < PAGE_EVAL_MS && t >= td.pageEval) return td.page;
    td.pageEval = t;
    const hold = isNum(cfg(hud).holdAboveKmh) ? cfg(hud).holdAboveKmh : 5;
    const dwell = isNum(cfg(hud).cyclePageMs) ? cfg(hud).cyclePageMs : 10000;
    const v = hud._raw ? hud._raw('speed') : null;
    if (!td.pageSince) td.pageSince = t;
    if (isNum(v) && v > hold) { td.pageSince = t; return td.page; }       // moving: the page stays, the dwell starts at the stop
    if (t - td.pageSince >= dwell) { td.page = td.page === 'clock' ? 'trip' : 'clock'; td.pageSince = t; }
    return td.page;
}

/* ------------------------------------------------------------------ values -------------------------------------- */

/** Local time as { y, mo, d, h, mi, wd } from the car's own zone (hud._tzMinutes), or null while no zone is known. */
function local(hud) {
    const off = hud._tzMinutes ? hud._tzMinutes() : null;
    if (!isNum(off)) return null;
    const d = new Date(now(hud) + off * 60000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() };
}
const clockText = (L) => (L ? pad2(L.h) + ':' + pad2(L.mi) : DASH + DASH + ':' + DASH + DASH);
const km = (n) => String(Math.round(n));
/** 48215 -> "48 215" with a thin space. */
function grouped(n) {
    const s = String(Math.round(n));
    let out = '';
    for (let i = 0; i < s.length; i++) { if (i && (s.length - i) % 3 === 0) out += THIN; out += s[i]; }
    return out;
}
/**
 * The trip factors (research3/MK: on by default): config.trip.factors overrides DEFAULT_FACTORS key by key
 * ({ bc: 1|2, speed, cons, way, rl3: { speed, cons, way } }); `false` switches them off (the page shows dashes).
 */
function factors(hud) {
    const f = tripCfg(hud).factors;
    if (f === false) return null;
    const o = f && typeof f === 'object' ? f : {}, r = o.rl3 && typeof o.rl3 === 'object' ? o.rl3 : {}, D = DEFAULT_FACTORS;
    const pick = (x, d) => (isNum(x) ? x : d);
    return { bc: o.bc === 2 ? 2 : 1, speed: pick(o.speed, D.speed), cons: pick(o.cons, D.cons), way: pick(o.way, D.way),
        rl3: { speed: pick(r.speed, D.rl3.speed), cons: pick(r.cons, D.rl3.cons), way: pick(r.way, D.rl3.way) } };
}
/**
 * The trip values the page shows, each a number or null: { cons, speed, way, hours, minutes, from: {h, m} | null,
 * src: { cons, speed, way, time, from } (the source each came from: 'kombi' | 'rl3' | null) }. Per value, the first
 * source of config.trip.order with a valid value wins.
 */
function tripValues(hud) {
    const td = st(hud), f = factors(hud);
    const out = { cons: null, speed: null, way: null, hours: null, minutes: null, from: null, src: { cons: null, speed: null, way: null, time: null, from: null } };
    if (!f) return out;
    const got = bySource(hud, td, f);
    ['cons', 'speed', 'way', 'time', 'from'].forEach((v) => {
        const hit = got.find((g) => g[1][v] !== null && g[1][v] !== undefined);
        if (!hit) return;
        out.src[v] = hit[0];
        if (v === 'time') { out.hours = hit[1].time.h; out.minutes = hit[1].time.m; } else out[v] = hit[1][v];
    });
    return out;
}
/**
 * Each source's values in config.trip.order: [[key, values]]. A source named in config.trip.departureUtc (e.g. ["rl3"])
 * sends its departure in UTC: it is moved into the car's zone (hud._tzMinutes) or left out while no zone is known.
 */
function bySource(hud, td, f) {
    const by = { kombi: () => kombiTrip(td, f), rl3: () => rl3Trip(td, f) };
    const utc = Array.isArray(tripCfg(hud).departureUtc) ? tripCfg(hud).departureUtc : [];
    return tripOrder(hud).map((k) => {
        const v = by[k]();
        if (v.from && utc.indexOf(k) >= 0) {
            const off = hud._tzMinutes ? hud._tzMinutes() : null;
            if (!isNum(off)) v.from = null;
            else { const m = ((v.from.h * 60 + v.from.m + off) % 1440 + 1440) % 1440; v.from = { h: Math.floor(m / 60), m: m % 60 }; }
        }
        return [k, v];
    });
}
/** The odometer in km: the first source of config.odometer.order with a valid value, or null. { km, src }. */
function odometer(hud) {
    const td = st(hud);
    const order = odoOrder(hud);
    for (let i = 0; i < order.length; i++) {
        const v = order[i] === 'rangeTank' ? td.mileage : isNum(td.odo[order[i]]) ? td.odo[order[i]] * odoFactor(hud, order[i]) : null;
        if (isNum(v)) return { km: v, src: order[i] };
    }
    return { km: null, src: null };
}

/**
 * The summary (at summaryMs after wire, default 2 and 10 minutes): which source spoke (how often, first when) and which
 * stayed SILENT; what each value on the page shows and from where (or why a dash: silent / invalid); a plausibility
 * check (distance / time against the average speed); and, for each silent source with a getter, one read-only getter
 * call whose outcome is logged (answered / error / no provider), so the log tells "not sent" from "wrong unit".
 * Numbers, source keys and field names only. Returns the lines (tests) and a promise of the getter lines.
 */
function summary(hud) {
    const td = st(hud), f = factors(hud), lines = [];
    td.summaries++;
    const at = secs(hud);
    const watched = Object.keys(td.handlers || {});
    const keys = Object.keys(SOURCES).filter((k) => watched.indexOf(k) >= 0 || td.seen[k]);
    const spoke = keys.filter((k) => td.seen[k]), silent = keys.filter((k) => !td.seen[k]);
    lines.push('trip summary #' + td.summaries + ' at ' + at + ' s: heard ' + (spoke.length ? spoke.map((k) => k + ' (#' + td.seen[k].n + ', first ' + (td.seen[k].at / 1000).toFixed(1) + ' s)').join(', ') : 'nothing')
        + '; SILENT ' + (silent.length ? silent.join(', ') : 'none'));
    const t = tripValues(hud), o = odometer(hud);
    const why = (v, keysOf) => (t.src[v] ? t.src[v] : !f ? 'factors off' : keysOf.some((k) => td.seen[k]) ? 'invalid' : 'silent');
    const kOf = { cons: ['average', 'rl3'], speed: ['average', 'rl3'], way: ['travel', 'rl3'], time: ['travel', 'rl3'], from: ['start', 'rl3'] };
    const fl = f ? 'bc ' + f.bc + ' speed ' + f.speed + ' cons ' + f.cons + ' way ' + f.way + '; rl3 speed ' + f.rl3.speed + ' cons ' + f.rl3.cons + ' way ' + f.rl3.way : 'off';
    lines.push('trip shows: cons ' + fV(t.cons, 1) + ' l/100 km [' + why('cons', kOf.cons) + '], speed ' + (isNum(t.speed) ? String(Math.round(t.speed)) : DASH) + ' km/h [' + why('speed', kOf.speed)
        + '], distance ' + fV(t.way, 1) + ' km [' + why('way', kOf.way) + '], time ' + (isNum(t.hours) ? fT({ h: t.hours, m: t.minutes }) : DASH) + ' [' + why('time', kOf.time)
        + '], departure ' + fT(t.from, true) + ' [' + why('from', kOf.from) + ']; odometer ' + (isNum(o.km) ? String(Math.round(o.km)) : DASH) + ' km ['
        + (o.src || (odoOrder(hud).some((k) => td.seen[k]) ? 'invalid' : 'silent')) + ']; factors ' + fl + (tripCfg(hud).verified === true ? ' (verified)' : ' (UNVERIFIED)')
        + ', odometer factor ' + odoFactor(hud, o.src || 'rangeTank') + (odoVerified(hud) ? ' (verified)' : ' (UNVERIFIED)'));
    // plausibility: each shown value inside its range, and distance / time against the average speed
    const odd = [];
    [['speed', t.speed], ['cons', t.cons], ['way', t.way], ['odo', o.km]].forEach((p) => { if (isNum(p[1]) && (p[1] < PLAUSIBLE[p[0]][0] || p[1] > PLAUSIBLE[p[0]][1])) odd.push(p[0] + ' ' + p[1]); });
    if (odd.length) lines.push('trip check: OUT OF RANGE ' + odd.join(', ') + ' (a factor 10x too big or the wrong member)');
    // per source (a source's own distance, time and average speed belong together): distance / time against the average
    if (f) bySource(hud, td, f).forEach((g) => {
        const x = g[1], hrs = x.time ? x.time.h + x.time.m / 60 : null;
        if (!isNum(x.way) || !isNum(x.speed) || !hrs || hrs < 0.05 || x.speed <= 0) return;
        const v = x.way / hrs, ratio = x.speed / v;
        lines.push('trip check [' + g[0] + ']: distance / time = ' + v.toFixed(1) + ' km/h, average speed ' + x.speed.toFixed(1) + ' km/h, ratio ' + ratio.toFixed(2)
            + (ratio > 5 || ratio < 0.2 ? ' -> a factor is about 10x off' : ' -> consistent (above 1: standing time not counted)'));
    });
    lines.forEach((l) => log(hud, 'info', l));
    return { lines, getters: askSilent(hud, silent) };
}

/** One read-only getter call per silent source that has a getter; each outcome one log line. Never rejects. */
function askSilent(hud, silent) {
    const td = st(hud), S = hud && hud.ctx && hud.ctx.signals;
    const subs = (hud && hud.car && hud.car.subs) || [];
    const jobs = silent.filter((k) => SOURCES[k][2]).map((k) => {
        const iface = SOURCES[k][0], field = SOURCES[k][1], name = iface.split('.').pop() + '.' + field;
        const sub = subs.find((s) => s && s.iface === iface);
        const say = (what) => { log(hud, 'info', 'trip getter ' + k + ' (' + name + ', silent): ' + what); return what; };
        if (!S || typeof S.get !== 'function') return Promise.resolve(say('no signals.get'));
        if (!sub) return Promise.resolve(say('not subscribed'));
        if (sub.error) return Promise.resolve(say('watch error: ' + String(sub.error).slice(0, 120)));
        if (!sub.available) return Promise.resolve(say('provider not available (the interface itself never came up)'));
        if (!sub.proxy) return Promise.resolve(say('no proxy'));
        return Promise.resolve().then(() => S.get(sub.proxy, field, 3000)).then((v) => {
            const h = td.handlers && td.handlers[k];
            if (h) { try { h(v); } catch (e) { /* the engine's handler: logged by chain() for ours */ } }     // as a notification would
            return say('answered (' + (v === null ? 'null' : typeof v) + '): the notifier is silent, the getter is not');
        }, (e) => say('error or no answer: ' + String(e && e.message || e).slice(0, 120) + ' (the car does not send it)'));
    });
    return Promise.all(jobs).catch(() => []);
}
const fixed1 = (n) => (isNum(n) ? n.toFixed(1) : DASH);

/** The drive programme as our own Latin label (SPEC 5.1): COMFORT / SPORT / SPORT+ / ECO PRO / ADAPTIVE, "" unknown. */
function program(hud) {
    if (!hud.driveMode) return '';
    if (hud.driveVariant === 'individual') return 'ADAPTIVE';
    if (hud.driveMode === 'sport') return hud.driveVariant === 'plus' ? 'SPORT+' : 'SPORT';
    if (hud.driveMode === 'eco') return 'ECO PRO';
    return 'COMFORT';
}

/** Is the car drive-ready (VehicleCondition 10)? The engine's data (the car's, or the demo drive's, which has none). */
function ready(hud) {
    const d = hud._data ? hud._data() : null;
    return !!d && d.condition === COND_READY_TWIN;
}

/* ------------------------------------------------------------------ tokens -------------------------------------- */

/** twin_dial: tabs (B2): the bottom row shows ONE line (every tab but 1, live tabs on). */
const rowOne = (hud) => require('./twin_tabs').rowLines(hud) === 1;

/**
 * {{td:<name>}} -> text. Never throws; an unknown name comes back as the token itself (as the engine does).
 *   hub:     speed gear program ready
 *   tabs:    rangeTab media
 *   centre:  cTitle cTime cWeekday cDate (clock page), tConsAvg tSpeedAvg tDist tTime tFrom (trip page)
 *   bottom:  odo clock r1 r1Unit ambient; rowL1 rowL1u rowL2 rowR1 rowR1u rowR2 rowR2u (the row by tab: one line off tab 1)
 */
function token(hud, tok) {
    try { return resolve(hud, tok.slice(3)); } catch (e) { log(hud, 'warn', 'twin token ' + tok + ': ' + (e && e.message || e)); return ''; }
}

function resolve(hud, name) {
    const td = st(hud);
    const onPage = (p, text) => (page(hud) === p ? text : '');
    switch (name) {
        // ---- hubs
        case 'speed': { const v = hud._raw('speed'); return isNum(v) ? String(Math.round(v)) : DASH; }
        case 'gear': { const g = hud._token('gear'); return g && g.indexOf('{{') < 0 ? g : DASH; }
        case 'program': return program(hud);
        case 'ready': return ready(hud) ? 'READY' : '';
        // ---- tab bar
        case 'rangeTab': { const v = hud._raw('range'); return isNum(v) ? km(v) : DASH; }
        case 'media': {      // icon only until P8 (config.twin.media); a long title is cut with an ellipsis
            if (typeof td.media !== 'string') return '';
            const max = isNum(cfg(hud).mediaMax) ? cfg(hud).mediaMax : 14;
            return td.media.length > max ? td.media.slice(0, max - 1) + '\u2026' : td.media;
        }
        // ---- centre pages
        case 'cTitle': return TITLES[page(hud)];
        case 'cTime': return onPage('clock', clockText(local(hud)));
        case 'cWeekday': { const L = local(hud); return onPage('clock', L ? WEEKDAYS[L.wd] : ''); }
        case 'cDate': { const L = local(hud); return onPage('clock', L ? pad2(L.d) + '.' + pad2(L.mo) + '.' + L.y : ''); }
        case 'tConsAvg': { const t = tripValues(hud); return onPage('trip', 'ø ' + fixed1(t.cons)); }
        case 'tSpeedAvg': { const t = tripValues(hud); return onPage('trip', 'ø ' + (isNum(t.speed) ? String(Math.round(t.speed)) : DASH)); }
        case 'tDist': { const t = tripValues(hud); return onPage('trip', fixed1(t.way)); }
        case 'tTime': { const t = tripValues(hud); return onPage('trip', isNum(t.hours) ? t.hours + ':' + pad2(t.minutes) : DASH); }
        case 'tFrom': { const t = tripValues(hud); return onPage('trip', 'від початку поїздки, ' + (t.from ? pad2(t.from.h) + ':' + pad2(t.from.m) : DASH)); }
        case 'tConsU': return onPage('trip', 'л/100 км');
        case 'tSpeedU': return onPage('trip', 'км/год');
        case 'tDistU': return onPage('trip', 'км');
        case 'tTimeU': return onPage('trip', 'год');
        // ---- bottom row: two lines on tab 1, one line (the clock left, the temperature right, on the upper baseline) on every other tab (SPEC-R3 3.5)
        case 'rowL1': return rowOne(hud) ? clockText(local(hud)) : resolve(hud, 'odo');
        case 'rowL1u': return rowOne(hud) ? '' : 'км';
        case 'rowL2': return rowOne(hud) ? '' : resolve(hud, 'clock');
        case 'rowR1': return rowOne(hud) ? resolve(hud, 'ambient') : resolve(hud, 'r1');
        case 'rowR1u': return rowOne(hud) ? '°C' : 'км';
        case 'rowR2': return rowOne(hud) ? '' : resolve(hud, 'ambient');
        case 'rowR2u': return rowOne(hud) ? '' : '°C';
        case 'odo': { const o = odometer(hud); return isNum(o.km) ? grouped(o.km) : DASH; }     // research3/MK: the first valid carrier
        case 'clock': return clockText(local(hud));
        case 'r1': {         // the trip distance whenever a source delivers one (research3/MK: factors on by default), else the range (SPEC 6.3)
            const t = tripValues(hud);
            if (isNum(t.way)) return fixed1(t.way);
            const v = hud._raw('range');
            return isNum(v) ? km(v) : DASH;
        }
        case 'ambient': {
            const v = hud._raw('ambient');
            if (!isNum(v)) return DASH;
            const r = Math.round(v * 10) / 10;
            return (r >= 0 ? '+' : '-') + Math.abs(r).toFixed(1);
        }
        default: {      // twin_dial round 3 (B4): the centre pages' tokens (shared/twin_pages.js token())
            const r = name.indexOf('pg') === 0 ? pages().token(hud, name) : undefined;
            return r === undefined ? '{{td:' + name + '}}' : r;
        }
    }
}

/* --------------------------------------------------------------- live icons -------------------------------------- */

/**
 * The state of a tab-bar icon (widget "tdLive": "fixed" | "warn" | "media" | "phone" | "nav"): { icon, color, tag }.
 * twin_dial: tabs (B2): moved to shared/twin_tabs.js - no icon is dimmed any more (SPEC-R3 3.1), the state is the icon's variant;
 * the warning icon is white, or red / amber while a message shows and tab 2 is not selected.
 */
function iconState(hud, w) { return require('./twin_tabs').iconState(hud, w); }

/** Repaint a live icon when its name, colour or text changed (also after a night change: the engine clears x.last). Called from _updateOne. */
function updateIcon(hud, x, nowMs, force) { return require('./twin_tabs').updateIcon(hud, x, nowMs, force); }

module.exports = { rl3Entry, token, wire, page, updateIcon, iconState, program, ready, local, tripValues, odometer, factors, summary, grouped, DASH, THIN, WEEKDAYS, TITLES, fresh,
    SOURCES, DEFAULT_FACTORS };
