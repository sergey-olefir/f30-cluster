'use strict';
/**
 * units.js - which units the cluster shows (r1120 PS, docs/r1120/PS-REPORT.md; the Авто rule since round 1121 PF,
 * docs/fixes-1121/PF-REPORT.md): the app setting "Одиниці / Units" (key "units": auto | km | mi, per driver profile) and the
 * car's own unit settings, all read only:
 *   car     Vehicle.statusNewCurrentUnitsStatusExt (getter 46, notifier 32814; never its setter newCurrentUnitsConfigExt):
 *           the profile's iDrive units - unitOfMeasurementSpeedometerDigital, ...Consumption, ...Temperature
 *   mileage EnvironmentalInformation.UnitBN2020.unitOfMeasurementMileage (getter 1): the odometer's unit
 *   bc      KombiIF.statusBordcomputerAverage.statusUnitOfMeasurementSpeedBC (getter 2): the cluster's trip computer's unit
 * (mileage and bc only where the app already reads them: Twin Dial; f30_cluster reads the car's struct alone.)
 *
 * PF, the owner's car (2026-11-18, apps/signal_probe on the car, one moment): the struct said speedometer MEILEN while the
 * odometer said KILOMETER, the trip computer KM_S_H__KM and the cluster's own speedometer KM_S_H. A profile's struct member
 * alone is not what BMW's cluster shows, so Авто gives miles only when TWO sources say miles and none says km.
 *
 *   resolve(pref, car, alt) -> { mi, cons: 'l100' | 'mpgUK' | 'mpgUS' | 'kml', temp: 'C' | 'F', src: 'car' | 'setting' | 'default',
 *                               why: { rule, car, by: [[source, raw]] } }
 *     km:   km and km/h; the car's consumption unit when it is a metric one (l/100 km, km/l), else l/100 km; °C.
 *     mi:   miles and mph; the car's consumption unit when it is an mpg one, else mpg (US); °F.
 *     auto: miles when two of car / mileage / bc say miles and none says km (rule "confirmed"); the struct's MEILEN without that
 *           is km (rule "unconfirmed"); KILOMETER (rule "car") or a second source's km (rule "alt") is km; nothing known: km
 *           (rule "default"). Consumption: the car's, metric unless miles. Temperature (r1120 PS2, the owner): the car's own
 *           unit (C / F) when it says one, else °F with miles and °C with km.
 *   carOf(v) -> { speed, cons, temp, speedRaw } from the struct; altOf(kind, raw) -> { unit: 'km' | 'mi' | null, raw }
 *   describe(pref, car, alt, r) -> one log line: the raw values and the verdict (enum names and numbers only)
 *   conv: km -> mi, km/h -> mph, l/100 km -> the consumption unit, °C -> °F
 *
 * Pressure, torque and the rest are not part of it (they stay as each app shows them). Pure; never throws. Node 8.
 */
const KM_PER_MI = 1.609344;
const PREF_KEY = 'units';
const PREFS = ['auto', 'km', 'mi'];

// the catalogue's enums (reference/car/2026-11-15: VehicleTypes.UnitOfMeasurementSpeedometerDigital, ...Consumption,
// InfrastructureTypes.UnitOfMeasurementMileage, InfotainmentTypes.StatusUnitOfMeasurementSpeedBC)
const SPEED = { KILOMETER: 'km', MEILEN: 'mi', 1: 'km', 2: 'mi' };
const TEMP = { C: 'C', F: 'F', 1: 'C', 2: 'F' };
const CONS = { L_S_100KM: 'l100', MPG__UK: 'mpgUK', MPG__US: 'mpgUS', KM_S_L: 'kml', 1: 'l100', 2: 'mpgUK', 3: 'mpgUS', 4: 'kml' };
const ALT = {
    mileage: { KILOMETER: 'km', MEILEN: 'mi', 1: 'km', 2: 'mi' },
    bc: { KM_S_H__KM: 'km', MPH__MLS: 'mi', 1: 'km', 2: 'mi' },
};
// numbers -> the enum's names, so the log and the status say what the car said in BMW's words
const NAMES = {
    speed: { 0: 'DEFAULT', 1: 'KILOMETER', 2: 'MEILEN', 3: 'SIGNAL_UNGUELTIG' },
    mileage: { 0: 'DEFAULT', 1: 'KILOMETER', 2: 'MEILEN', 3: 'SIGNAL_UNGUELTIG' },
    bc: { 0: 'DEFAULT', 1: 'KM_S_H__KM', 2: 'MPH__MLS', 3: 'SIGNAL_UNGUELTIG' },
    cons: { 0: 'DEFAULT', 1: 'L_S_100KM', 2: 'MPG__UK', 3: 'MPG__US', 4: 'KM_S_L', 7: 'SIGNAL_UNGUELTIG' },
    temp: { 0: 'DEFAULT', 1: 'C', 2: 'F', 3: 'SIGNAL_UNGUELTIG' },
};
const SOURCES = ['mileage', 'bc'];

const own = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);
/** A raw enum value as BMW names it ("MEILEN"); a number without a name stays a number; anything else: its type. */
function nameOf(kind, v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return own(NAMES[kind], String(v)) ? NAMES[kind][v] : String(v);
    if (typeof v === 'string') return /^[A-Z0-9_]{1,40}$/.test(v) ? v : 'text';
    return typeof v;
}

/** The car's struct -> { speed, cons, temp } (null where it says DEFAULT / SIGNAL_UNGUELTIG / nothing) and the raw names. */
function carOf(v) {
    const out = { speed: null, cons: null, temp: null, speedRaw: null, consRaw: null, tempRaw: null };
    if (!v || typeof v !== 'object') return out;
    const s = v.unitOfMeasurementSpeedometerDigital, c = v.unitOfMeasurementConsumption, t = v.unitOfMeasurementTemperature;
    if (own(SPEED, String(s))) out.speed = SPEED[String(s)];
    if (own(CONS, String(c))) out.cons = CONS[String(c)];
    if (own(TEMP, String(t))) out.temp = TEMP[String(t)];
    out.speedRaw = nameOf('speed', s); out.consRaw = nameOf('cons', c); out.tempRaw = nameOf('temp', t);
    return out;
}
/** A second source's member -> { unit: 'km' | 'mi' | null, raw }. kind: 'mileage' | 'bc'. */
function altOf(kind, v) {
    const m = ALT[kind] || {};
    return { unit: own(m, String(v)) ? m[String(v)] : null, raw: nameOf(kind, v) };
}

function resolve(pref, car, alt) {
    const c = car || {}, a = alt || {};
    const p = PREFS.indexOf(pref) >= 0 ? pref : 'auto';
    const metric = (x) => x === 'l100' || x === 'kml';
    const by = SOURCES.filter((k) => a[k] && a[k].raw !== null && a[k].raw !== undefined).map((k) => [k, a[k].raw, a[k].unit]);
    const why = (rule) => ({ rule, car: c.speedRaw || (c.speed ? (c.speed === 'mi' ? 'MEILEN' : 'KILOMETER') : null), by: by.map((x) => [x[0], x[1]]) });
    if (p === 'km') return { mi: false, cons: metric(c.cons) ? c.cons : 'l100', temp: 'C', src: 'setting', why: why('setting') };
    if (p === 'mi') return { mi: true, cons: c.cons && !metric(c.cons) ? c.cons : 'mpgUS', temp: 'F', src: 'setting', why: why('setting') };
    const votes = [c.speed].concat(by.map((x) => x[2]));
    const miN = votes.filter((x) => x === 'mi').length, kmN = votes.filter((x) => x === 'km').length;
    if (miN >= 2 && kmN === 0) return { mi: true, cons: c.cons && !metric(c.cons) ? c.cons : 'mpgUS', temp: c.temp || 'F', src: 'car', why: why('confirmed') };
    if (c.speed === 'mi') return { mi: false, cons: metric(c.cons) ? c.cons : 'l100', temp: c.temp || 'C', src: 'car', why: why('unconfirmed') };
    if (c.speed === 'km') return { mi: false, cons: c.cons || 'l100', temp: c.temp || 'C', src: 'car', why: why('car') };
    if (kmN) return { mi: false, cons: metric(c.cons) ? c.cons : 'l100', temp: c.temp || 'C', src: 'car', why: why('alt') };
    return { mi: false, cons: metric(c.cons) ? c.cons : 'l100', temp: c.temp || 'C', src: c.temp ? 'car' : 'default', why: why('default') };
}
/** The log line for a units verdict: the setting, every raw value, the verdict and its rule. */
function describe(pref, car, alt, r) {
    const c = car || {}, a = alt || {}, x = r || resolve(pref, car, alt);
    const raw = 'speedometer ' + (c.speedRaw || 'none') + ', consumption ' + (c.consRaw || 'none') + ', temperature ' + (c.tempRaw || 'none') +
        SOURCES.map((k) => (a[k] ? '; ' + (k === 'mileage' ? 'odometer ' : 'trip computer ') + a[k].raw : '')).join('');
    return 'setting ' + (PREFS.indexOf(pref) >= 0 ? pref : 'auto') + '; the car says ' + raw + ' -> ' + (x.mi ? 'miles' : 'km') + ', ' + x.cons + ', °' + x.temp +
        ' (' + (x.why ? x.why.rule : x.src) + ')';
}
/** °C -> the temperature shown. */
function temp(c, unit) { return typeof c === 'number' && isFinite(c) && unit === 'F' ? c * 9 / 5 + 32 : c; }

/** km -> the shown distance; km/h -> the shown speed. */
function dist(km, mi) { return typeof km === 'number' && isFinite(km) ? (mi ? km / KM_PER_MI : km) : km; }
/** l/100 km -> the consumption unit (0 or less: 0 in every unit; mpg of nothing is not shown as infinite). */
function cons(l100, unit) {
    if (typeof l100 !== 'number' || !isFinite(l100)) return l100;
    if (unit === 'l100' || !unit) return l100;
    if (!(l100 > 0.5)) return 0;
    if (unit === 'mpgUS') return 235.215 / l100;
    if (unit === 'mpgUK') return 282.481 / l100;
    if (unit === 'kml') return 100 / l100;
    return l100;
}
/** The decimals a consumption figure is shown with: l/100 km one, the others none (mpg) or one (km/l). */
function consDec(unit) { return unit === 'mpgUS' || unit === 'mpgUK' ? 0 : 1; }

module.exports = { PREF_KEY, PREFS, KM_PER_MI, SOURCES, carOf, altOf, resolve, describe, dist, cons, consDec, temp, nameOf };
