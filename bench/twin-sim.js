'use strict';
/**
 * twin-sim.js - the bench side of twin_dial (docs/twin-dial/SPEC.md section 11 and 16; package E of round 2).
 *
 *   const sim = require('./twin-sim').install(hu, spec, log);   // run-app.js, only when spec.id is "twin_dial"
 *   sim.control({ trip: {...}, units: 'km', media: {...}, phone: 'ACTIVE', guiding: 'ACTIVE', displayed: 15 });
 *   sim.rangeStruct(base, manual)   // the fuel / reserve / range / odometer struct, merged into run-app's 50 ms feed
 *   sim.state()                     // what GET /probe reports as "twin" (numbers and lengths, never text)
 *
 * What it adds to the bench (everything else of SPEC section 11 the bench already feeds: speed, rpm, gear, program,
 * ready, coolant and ambient through POST /signals "manual"; the day/night, the clock, ccList, the cluster's
 * "shown now" number and the frame counter through bench/fake-signs.js, i.e. POST /fake):
 *
 *   - the fields twin_dial reads that f30_cluster does not: fuel reserve and the odometer (KombiIF
 *     statusRangeTankStatus members statusFluidLevelFuelTankSpare / mileageKilometre), the trip computer (three
 *     KombiIF structs), the mileage unit, the media player's two lines and the active source, the phone state, the
 *     guiding state, and Vehicle2.statusDisplayedCCMessage (the second witness of the message shown now);
 *   - a ledger of every raw value fed (bench-wide: hu.feed is wrapped) and of every field the app subscribed to, so
 *     /probe can say which field of SPEC section 11 the app never watches (a typo in app.json "signals") and which
 *     field was fed but nobody reads;
 *   - the car's "rs" behaviour: an app that subscribes AFTER a value was fed gets the last value at once, as the
 *     getter answers on the car (the bench otherwise drops a value nobody watches yet);
 *   - the demo sweep (a scripted needle sweep, sweepValues()).
 *
 * Numbers and member names are the car's own catalogue (reference/car/2026-11-15/someip/someip-interfaces.json, read
 * for the names only). Which RAW SCALE the trip fields use is UNSEEN (probe P4): this bench feeds tenths (value * 10),
 * a hypothesis; the app shows "-" for them until config.trip.factors is set, so the picture does not depend on it.
 * Text is never logged here: lengths only. Bench only; the car never sees it.
 */

const IF = {
    KI: 'de.bmw.infotainment.KombiIF', KI2: 'de.bmw.infotainment.KombiInterface_2', V2: 'de.bmw.infotainment.vehicle.Vehicle2',
    CDS: 'de.bmw.infotainment.vehicle.CDS', VI: 'de.bmw.infrastructure.VehicleInformation', MD: 'de.bmw.infotainment.misc.MDrive',
    FES: 'de.bmw.infotainment.drivingexcitement.FES', VC: 'de.bmw.infrastructure.VehicleCondition',
    EI: 'de.bmw.infrastructure.EnvironmentalInformation', V: 'de.bmw.infotainment.vehicle.Vehicle',
    HMS: 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState', MS: 'de.bmw.infotainment.entertainment.mediasource.MediaSource',
    CA: 'de.bmw.infotainment.connectivity.telephony.ConnectivityAggregator',
    NS: 'de.bmw.infotainment.navigation.navigationstatus.NavigationStatus',
};

/** SPEC section 11 (the normal build): [interface, field, what, needed]. "needed": the app must watch it to draw its
 *  part; the rest are declared in SPEC section 11 too but only read in some states. */
const SPEC11 = [
    [IF.V2, 'statusCarSpeed2', 'speed', true], [IF.CDS, 'statusEngineSpeed2', 'rpm', true],
    [IF.VI, 'statusGearboxDrive', 'gear', true], [IF.MD, 'dataDisplayGearbox', 'drive program (S / M)', false],
    [IF.FES, 'statusFESVehicleDynamicSwitchHMI', 'drive mode', true],
    [IF.VC, 'VehicleCondition', 'ready', true], [IF.CDS, 'statusEngineStatus', 'engine running', false],
    [IF.KI, 'statusRangeTankStatus', 'fuel, reserve, range, odometer', true],
    [IF.CDS, 'statusEngineTemperature', 'coolant', true], [IF.EI, 'ExteriorTemperature', 'outside temperature', true],
    [IF.KI, 'timeDateUTC', 'clock (UTC + zone)', true], [IF.KI, 'statusShowTimeDate', 'clock (fallback)', false],
    [IF.V, 'statusDayNightChangeOver', 'day / night', true],
    [IF.KI2, 'ccList', 'messages', true], [IF.KI, 'statusActiveCCMessage', 'message shown now', true],
    [IF.V2, 'statusDisplayedCCMessage', 'message shown now (second witness)', false], [IF.KI, 'statusMenuCCMessage', 'message frame n of m', false],
    [IF.KI, 'statusBordcomputerAverage', 'trip averages', false], [IF.KI, 'statusBordcomputerTravelData', 'trip distance, duration', false],
    [IF.KI, 'statusBordcomputerTravelStart', 'trip departure', false],
    [IF.EI, 'UnitBN2020', 'mileage unit', false],
    [IF.HMS, 'playerMetadata', 'media text', false], [IF.MS, 'activeSourceId', 'media source', false],
    [IF.CA, 'aggregatedCallState', 'phone', false], [IF.NS, 'guidingState', 'guidance', false],
];

// enum members by name, the way the binding hands them over (DRIVER-PROFILES-APP.md); BENCH_ENUM=number feeds the wire numbers
const ENUMS = {
    spare: { NICHT_AKTIV: 0, AKTIV: 1, SIGNAL_UNGUELTIG: 3 },
    mileage: { DEFAULT: 0, KILOMETER: 1, MEILEN: 2, SIGNAL_UNGUELTIG: 3 },
    call: { DISCONNECTED: 0, INCOMING: 1, ACTIVE: 2, DIALING: 3, HELD: 4 },
    guiding: { INACTIVE: 0, CALCULATING_ROUTE: 1, ACTIVE: 2 },
    itemType: { UNDEFINED: 0, ARTIST: 1, ALBUM: 2, TITLE: 3 },
    uiType: { UNDEFINED: 0, TWO_LINES: 1, THREE_ROWS_TEXT: 2 },
    sink: { FRONT: 0, FOND_LEFT: 1, FOND_RIGHT: 2 },
};
const SWEEP_MS = 4000;

function install(hu, spec, log, opts) {
    const o = opts || {};
    const cfg = (spec && spec.config) || {};
    const numeric = (o.enum || process.env.BENCH_ENUM) === 'number';
    const en = (kind, name) => {
        if (name === null || name === undefined) name = kind === 'spare' || kind === 'mileage' ? 'SIGNAL_UNGUELTIG' : Object.keys(ENUMS[kind])[0];      // the "none" member
        return numeric ? ENUMS[kind][name] : name;
    };
    const say = (m) => { if (log && log.info) log.info('bench: twin ' + m); };

    // ---- the ledger: every raw value fed (bench-wide), and the late-subscriber replay ("rs" getters) ----
    const ledger = {};                      // "iface.field" -> { n, value, avail }
    const handlerCount = (iface, field) => (hu.subs && hu.subs[iface] ? hu.subs[iface].filter((s) => s.h && s.h[field]).length : 0);
    const seen = {};                        // "iface.field" -> handlers counted at the last look
    const rawFeed = hu.feed;
    hu.feed = (iface, field, value, avail) => {
        const k = iface + '.' + field;
        if (!ledger[k]) seen[k] = handlerCount(iface, field);      // whoever watches now gets this very value
        const e = ledger[k] || (ledger[k] = { n: 0, value: undefined, avail: undefined });
        e.n++; e.value = value; e.avail = avail;
        return rawFeed(iface, field, value, avail);
    };
    const late = setInterval(() => {
        Object.keys(ledger).forEach((k) => {
            const i = k.lastIndexOf('.'), iface = k.slice(0, i), field = k.slice(i + 1), n = handlerCount(iface, field);
            if (n > (seen[k] || 0)) { seen[k] = n; rawFeed(iface, field, ledger[k].value, ledger[k].avail); }
            else if (n < (seen[k] || 0)) seen[k] = n;
        });
    }, 100);
    if (late.unref) late.unref();
    const feed = (iface, field, value) => { hu.feed(iface, field, value); };
    const none = (v, bad) => (v === null || v === undefined || !isFinite(Number(v)) ? bad : Number(v));
    const tenths = (v, bad) => (v === null || v === undefined || !isFinite(Number(v)) ? bad : Math.round(Number(v) * 10));
    const utf16 = (s) => (s === null || s === undefined ? '' : String(s));

    // ---- state of the fields this file owns ----
    const st = { trip: null, units: null, media: null, phone: null, guiding: null, displayed: null };

    /** KombiIF.statusRangeTankStatus, with the f30 members run-app.js feeds (base) and the new ones. manual: run-app's
     *  POST /signals values: litres fuelL, range, reserve (1 | 0 | null: none), odometer (km | null: none). */
    function rangeStruct(base, manual) {
        const m = manual || {};
        const out = Object.assign({}, base);
        out.fluidLevelFuelTankLeftHand = 255;
        out.fluidLevelFuelTankRightHand = 255;
        out.statusFluidLevelFuelTankSpare = en('spare', 'reserve' in m ? (m.reserve === null ? 'SIGNAL_UNGUELTIG' : m.reserve ? 'AKTIV' : 'NICHT_AKTIV') : 'NICHT_AKTIV');
        out.mileageKilometre = 'odometer' in m ? none(m.odometer, 16777215) : 16777215;
        return out;
    }

    function feedTrip() {
        const t = st.trip;
        feed(IF.KI, 'statusBordcomputerAverage', {
            speedAverage1BC1: t ? tenths(t.speed1, 4095) : 4095, consumptionAverage1BC1: t ? tenths(t.cons1, 4095) : 4095,
            speedAverage2BC2: t ? tenths(t.speed2, 4095) : 4095, consumptionAverage2BC2: t ? tenths(t.cons2, 4095) : 4095,
            statusUnitOfMeasurementSpeedBC: 0, statusUnitOfMeasurementConsumptionBC: 0,
        });
        feed(IF.KI, 'statusBordcomputerTravelData', {
            rideDurationHours: t ? none(t.hours, 4095) : 4095, rideDurationMinutes: t ? none(t.minutes, 255) : 255,
            wayPassed: t ? tenths(t.km, 65535) : 65535,
        });
        const d = (t && t.depart) || null;
        feed(IF.KI, 'statusBordcomputerTravelStart', {
            hourDepartureBC: d ? none(d.hour, 255) : 255, minuteDepartureBC: d ? none(d.minute, 255) : 255,
            dayDepartureBC: d ? none(d.day, 255) : 255, monthDepartureBC: d ? none(d.month, 15) : 15, yearDepartureBC: d ? none(d.year, 65535) : 65535,
        });
    }
    function feedUnits() {
        feed(IF.EI, 'UnitBN2020', { unitOfMeasurementMileage: en('mileage', st.units === 'km' ? 'KILOMETER' : st.units === 'mi' ? 'MEILEN' : null) });
    }
    function feedMedia() {
        const m = st.media;
        feed(IF.HMS, 'playerMetadata', {
            sink: en('sink', 'FRONT'), menuEntry: 0, trackId: 0, uiType: en('uiType', m ? 'TWO_LINES' : 'UNDEFINED'),
            firstLineText: utf16(m && m.first), firstLineType: en('itemType', m && m.first ? (m.firstType || 'TITLE') : 'UNDEFINED'),
            secondLineText: utf16(m && m.second), secondLineType: en('itemType', m && m.second ? (m.secondType || 'ARTIST') : 'UNDEFINED'),
            threeRowText: '',
        });
        feed(IF.MS, 'activeSourceId', utf16(m && m.source));
    }
    function feedPhone() { feed(IF.CA, 'aggregatedCallState', en('call', st.phone || 'DISCONNECTED')); }
    function feedGuiding() { feed(IF.NS, 'guidingState', en('guiding', st.guiding || 'INACTIVE')); }
    function feedDisplayed() { feed(IF.V2, 'statusDisplayedCCMessage', { statusNumberCheckControlMessageDisplay: st.displayed === null || st.displayed === undefined ? 65535 : Number(st.displayed) }); }

    /** { trip, units, media, phone, guiding, displayed }: each key replaces that group (null: the field's "none" value);
     *  a key left out is not touched; { reset: true } forgets all of them (a field never fed is "not readable"). */
    function control(v) {
        const c = v || {};
        if (c.reset) { Object.keys(st).forEach((k) => { st[k] = null; }); say('reset'); }
        if ('trip' in c) { st.trip = c.trip; feedTrip(); }
        if ('units' in c) { st.units = c.units; feedUnits(); }
        if ('media' in c) { st.media = c.media; feedMedia(); }
        if ('phone' in c) { st.phone = c.phone; feedPhone(); }
        if ('guiding' in c) { st.guiding = c.guiding; feedGuiding(); }
        if ('displayed' in c) { st.displayed = c.displayed; feedDisplayed(); }
        say('control ' + Object.keys(c).join(',') + (c.media ? ' (media text ' + utf16(c.media.first).length + '+' + utf16(c.media.second).length + ' chars)' : ''));
    }

    /** The demo sweep: needles from rest to the end of the scale and back over SWEEP_MS (SPEC section 12, "a 4 s needle
     *  sweep"). t in ms since the start; null after the end. rpm 0..8000, speed 0..300. */
    function sweepValues(t) {
        if (t < 0 || t > SWEEP_MS) return null;
        const f = 1 - Math.abs(2 * t / SWEEP_MS - 1);        // 0 -> 1 -> 0
        const e = f * f * (3 - 2 * f);                       // smoothstep
        return { rpm: Math.round(8000 * e), speed: Math.round(300 * e) };
    }

    // ---- /probe ----
    const redact = (v) => {
        if (typeof v === 'string') return /^[A-Z][A-Z0-9_]*$/.test(v) ? v : '<' + v.length + ' chars>';       // an enum name stays, text becomes its length
        if (Array.isArray(v)) return v.length > 8 ? '<array ' + v.length + '>' : v.map(redact);
        if (v && typeof v === 'object') { const r = {}; Object.keys(v).forEach((k) => { r[k] = redact(v[k]); }); return r; }
        return v;
    };
    function state(hud) {
        const watched = {}, fed = {};
        SPEC11.forEach((r) => { watched[r[0] + '.' + r[1]] = handlerCount(r[0], r[1]) > 0; });
        Object.keys(ledger).forEach((k) => { fed[k] = ledger[k].n; });
        const missing = SPEC11.filter((r) => r[3] && !watched[r[0] + '.' + r[1]]).map((r) => r[0].split('.').pop() + '.' + r[1]);
        const unwatchedFed = Object.keys(ledger).filter((k) => {
            const i = k.lastIndexOf('.');
            return handlerCount(k.slice(0, i), k.slice(i + 1)) === 0;
        });
        const clockOk = !!(cfg.clock && cfg.clock.iface) || !!(cfg.clockLocal && cfg.clockLocal.iface);
        const wired = { ccList: !!(cfg.ccList && cfg.ccList.iface), ccActive: !!(cfg.ccActive && cfg.ccActive.iface), ccFrames: !!(cfg.ccFrames && cfg.ccFrames.iface),
            clock: clockOk, dayNight: !!(cfg.dayNight && cfg.dayNight.iface) };
        let cc = null, extra = null;
        try {
            const c = hud && (hud.twinCc || hud.cc);       // B's engine keeps the state in twinCc (ENGINE-CONTRACT 2); the brief's name was cc
            if (c && typeof c === 'object') cc = { state: c.state === undefined ? null : c.state, severity: c.severity === undefined ? null : c.severity };
            // optional: whatever the engine offers for the bench (D, C): hud.benchProbe() -> plain numbers / enums / lengths
            if (hud && typeof hud.benchProbe === 'function') extra = redact(hud.benchProbe());
        } catch (e) { cc = { error: String(e && e.message || e) }; }
        const last = {};
        Object.keys(ledger).forEach((k) => { if (/KombiIF\.(statusRangeTankStatus|statusBordcomputer|statusActiveCC|statusMenuCC)|statusDisplayedCC|UnitBN2020|aggregatedCallState|guidingState|playerMetadata|activeSourceId|ccList$|statusEngineSpeed2|statusCarSpeed2/.test(k)) last[k.split('.').slice(-2).join('.')] = redact(ledger[k].value); });
        return { watched, fed, missing, unwatchedFed, wired, enumStyle: numeric ? 'number' : 'name', own: { trip: !!st.trip, units: st.units, media: st.media ? { first: utf16(st.media.first).length, second: utf16(st.media.second).length } : null, phone: st.phone, guiding: st.guiding, displayed: st.displayed },
            last, cc, engine: extra, now: new Date().toISOString() };
    }

    return { control, rangeStruct, sweepValues, state, ledger, SPEC11, SWEEP_MS, stop: () => clearInterval(late) };
}

module.exports = { install, SPEC11, SWEEP_MS, IF, ENUMS };
