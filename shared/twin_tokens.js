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
const TITLES = { clock: 'Дата і час', trip: 'Поїздка' };
const KOMBI = 'de.bmw.infotainment.KombiIF';
const COND_READY_TWIN = 10;       // VehicleCondition 10 = FAHREN (SPEC 5.1)
const PAGE_EVAL_MS = 250;         // the page is decided at most this often, so every widget of one tick sees one page
const isNum = (x) => typeof x === 'number' && isFinite(x);
const pad2 = (n) => (n < 10 ? '0' : '') + n;

function fresh() {
    return {
        mileage: null, spareRaw: undefined, odoRaw: undefined,
        avg: null, travel: null, start: null, tripRaw: {},
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
 * when app.json config.twin exists. Read only; every handler stores numbers, and the first raw value of the odometer
 * and of each trip field is logged once as numbers (probes P3 and P4).
 */
function wire(hud, extra) {
    const td = st(hud);
    const IF = {
        media: 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState',
        phone: 'de.bmw.infotainment.connectivity.telephony.ConnectivityAggregator',
        nav: 'de.bmw.infotainment.navigation.navigationstatus.NavigationStatus',
        env: 'de.bmw.infrastructure.EnvironmentalInformation',
    };
    // the odometer and the reserve flag ride on the struct the engine reads for the fuel and the range
    chain(hud, extra, KOMBI, 'statusRangeTankStatus', (v) => {
        const m = member(v, 'mileageKilometre');
        td.mileage = isNum(m) && m >= 0 && m < 16777215 ? m : null;
        if (m !== td.odoRaw) { td.odoRaw = m; log(hud, 'info', 'odometer raw (P3): ' + (isNum(m) ? m : 'none') + ' -> ' + (td.mileage === null ? 'no value' : td.mileage + ' km (factor 1 km)')); }
        // the reserve flag itself is read by the engine (package B: _raw('reserve')); only its raw value is logged here
        const s = member(v, 'statusFluidLevelFuelTankSpare');
        if (s !== td.spareRaw) { td.spareRaw = s; log(hud, 'info', 'fuel reserve raw: ' + String(s) + ' -> ' + (s === undefined || s === null ? 'unknown' : enumIs(s, ['AKTIV', 'ACTIVE'], [1]) ? 'reserve' : 'no reserve')); }
    });
    chain(hud, extra, KOMBI, 'statusBordcomputerAverage', (v) => {
        td.avg = {
            speed1: member(v, 'speedAverage1BC1'), cons1: member(v, 'consumptionAverage1BC1'),
            speed2: member(v, 'speedAverage2BC2'), cons2: member(v, 'consumptionAverage2BC2'),
        };
        tripLine(hud, 'average', [td.avg.speed1, td.avg.cons1, td.avg.speed2, td.avg.cons2]);
    });
    chain(hud, extra, KOMBI, 'statusBordcomputerTravelData', (v) => {
        td.travel = { hours: member(v, 'rideDurationHours'), minutes: member(v, 'rideDurationMinutes'), way: member(v, 'wayPassed') };
        tripLine(hud, 'travel', [td.travel.hours, td.travel.minutes, td.travel.way]);
    });
    chain(hud, extra, KOMBI, 'statusBordcomputerTravelStart', (v) => {
        td.start = { h: member(v, 'hourDepartureBC'), m: member(v, 'minuteDepartureBC') };
        tripLine(hud, 'departure', [td.start.h, td.start.m]);
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
}

/** A trip field's first raw numbers, once per change (P4): numbers only. */
function tripLine(hud, what, nums) {
    const td = st(hud), key = nums.map((n) => (isNum(n) ? n : 'x')).join(',');
    if (td.tripRaw[what] === key) return;
    td.tripRaw[what] = key;
    log(hud, 'info', 'trip ' + what + ' raw (P4): ' + key);
}

/* ------------------------------------------------------------------ pages --------------------------------------- */

/** The page that shows now: 'clock' | 'trip'. Setting `centre` = clock | trip | cycle (SPEC 6.2). */
function page(hud) {
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
/** The trip factors config.trip.factors, or null (P4 not done): { bc: 1|2, speed, cons, way, wayDecimals }. */
function factors(hud) {
    const f = tripCfg(hud).factors;
    return f && typeof f === 'object' ? f : null;
}
/** The three trip values the page shows, each a number or null: { cons, speed, way, hours, minutes, from: {h, m} | null }. */
function tripValues(hud) {
    const td = st(hud), f = factors(hud), out = { cons: null, speed: null, way: null, hours: null, minutes: null, from: null };
    if (!f) return out;
    const bc = f.bc === 2 ? 2 : 1;
    const num = (raw, factor, invalid) => (isNum(raw) && isNum(factor) && invalid.indexOf(raw) < 0 ? raw * factor : null);
    if (td.avg) {
        out.speed = num(td.avg['speed' + bc], f.speed, [4095, 65535]);
        out.cons = num(td.avg['cons' + bc], f.cons, [4095, 65535]);
    }
    if (td.travel) {
        out.way = num(td.travel.way, f.way, [65535]);
        if (isNum(td.travel.hours) && td.travel.hours < 4095 && isNum(td.travel.minutes) && td.travel.minutes < 255) { out.hours = td.travel.hours; out.minutes = td.travel.minutes; }
    }
    if (td.start && isNum(td.start.h) && td.start.h < 24 && isNum(td.start.m) && td.start.m < 60) out.from = { h: td.start.h, m: td.start.m };
    return out;
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

/** Is the car drive-ready (VehicleCondition 10)? */
function ready(hud) {
    const live = hud.car && hud.car.live ? hud.car.live : null;
    const d = hud._data ? hud._data() : null;
    const c = d && d.condition !== undefined ? d.condition : live ? live.condition : undefined;
    return c === COND_READY_TWIN;
}

/* ------------------------------------------------------------------ tokens -------------------------------------- */

/**
 * {{td:<name>}} -> text. Never throws; an unknown name comes back as the token itself (as the engine does).
 *   hub:     speed gear program ready
 *   tabs:    rangeTab media
 *   centre:  cTitle cTime cWeekday cDate (clock page), tConsAvg tSpeedAvg tDist tTime tFrom (trip page)
 *   bottom:  odo clock r1 r1Unit ambient
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
        case 'media': return typeof td.media === 'string' ? td.media : '';
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
        // ---- bottom row
        case 'odo': return isNum(td.mileage) ? grouped(td.mileage) : DASH;
        case 'clock': return clockText(local(hud));
        case 'r1': {         // trip distance once P4 has proven the field, until then the range (SPEC 6.3)
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
        default: return '{{td:' + name + '}}';
    }
}

/* --------------------------------------------------------------- live icons -------------------------------------- */

/**
 * The state of a tab-bar icon (widget "tdLive": "warn" | "media" | "phone" | "nav" | "fixed"): { icon, role }.
 *   warn   always shown; white, black (role bg) on an amber highlight (SPEC 6.1; hud.twinCc.severity, package D)
 *   media  the radio's icon (the media cell is icon only until P8)
 *   phone  dim (theme role grey, the tab ramp's bottom: SPEC's "dim (0.5)") until a call state says otherwise
 *   nav    the same while no route is guided
 */
function iconState(hud, w) {
    const td = st(hud);
    switch (w.tdLive) {
        case 'warn': {
            const sev = hud.twinCc && hud.twinCc.severity;       // package D: 'red' | 'amber' | 'green' | 'grey' | null
            return { icon: w.icon, role: sev === 'amber' ? 'bg' : 'fg' };
        }
        case 'phone': return { icon: w.icon, role: td.call === true ? 'fg' : 'grey' };
        case 'nav': return { icon: w.icon, role: td.nav === true ? 'fg' : 'grey' };
        default: return { icon: w.icon, role: w.color || 'fg' };
    }
}

/**
 * Repaint a live icon when its name or its colour changed (also after a night change: the engine clears x.last).
 * Called from _updateOne for a widget with "tdLive".
 */
function updateIcon(hud, x, nowMs, force) {
    const s = iconState(hud, x.w), col = hud.theme[s.role] || hud.theme.fg;
    const key = s.icon + '|' + col.join(',');
    if (!force && key === x.last) return;
    x.last = key;
    const paint = require('./icons').paintIcon;
    hud._blitDiff(x, paint(s.icon, x.w.w, x.w.h, col));
}

module.exports = { token, wire, page, updateIcon, iconState, program, ready, local, tripValues, grouped, DASH, THIN, WEEKDAYS, TITLES, fresh };
