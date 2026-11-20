'use strict';
/**
 * units.js - which units the cluster shows (r1120 PS, docs/r1120/PS-REPORT.md): the app setting "Одиниці / Units" (key
 * "units": auto | km | mi, per driver profile) and the car's own unit setting for the active profile,
 * Vehicle.statusNewCurrentUnitsStatusExt (getter 46, notifier 32814; read only, never its setter newCurrentUnitsConfigExt).
 *
 *   resolve(pref, car) -> { mi: bool, cons: 'l100' | 'mpgUK' | 'mpgUS' | 'kml', src: 'car' | 'setting' | 'default' }
 *     auto: the car's speedometer unit (KILOMETER / MEILEN, by name or number) and its consumption unit; nothing known: km.
 *     km:   km and km/h; the car's consumption unit when it is a metric one (l/100 km, km/l), else l/100 km.
 *     mi:   miles and mph; the car's consumption unit when it is an mpg one, else mpg (US).
 *   carOf(v) -> { speed: 'km' | 'mi' | null, cons: 'l100' | 'mpgUK' | 'mpgUS' | 'kml' | null } from the struct
 *   conv: km -> mi, km/h -> mph, l/100 km -> the consumption unit
 *
 * Temperature, pressure and the rest are not part of it (they stay as each app shows them). Pure; never throws. Node 8.
 */
const KM_PER_MI = 1.609344;
const PREF_KEY = 'units';
const PREFS = ['auto', 'km', 'mi'];

// the catalogue's enums (reference/car/2026-11-15: VehicleTypes.UnitOfMeasurementSpeedometerDigital, ...Consumption)
const SPEED = { KILOMETER: 'km', MEILEN: 'mi', 1: 'km', 2: 'mi' };
const CONS = { L_S_100KM: 'l100', MPG__UK: 'mpgUK', MPG__US: 'mpgUS', KM_S_L: 'kml', 1: 'l100', 2: 'mpgUK', 3: 'mpgUS', 4: 'kml' };

const own = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);

/** The car's struct -> { speed, cons } (null where it says DEFAULT / SIGNAL_UNGUELTIG / nothing). */
function carOf(v) {
    const out = { speed: null, cons: null };
    if (!v || typeof v !== 'object') return out;
    const s = v.unitOfMeasurementSpeedometerDigital, c = v.unitOfMeasurementConsumption;
    if (own(SPEED, String(s))) out.speed = SPEED[String(s)];
    if (own(CONS, String(c))) out.cons = CONS[String(c)];
    return out;
}

function resolve(pref, car) {
    const c = car || {};
    const p = PREFS.indexOf(pref) >= 0 ? pref : 'auto';
    const metric = (x) => x === 'l100' || x === 'kml';
    if (p === 'km') return { mi: false, cons: metric(c.cons) ? c.cons : 'l100', src: 'setting' };
    if (p === 'mi') return { mi: true, cons: c.cons && !metric(c.cons) ? c.cons : 'mpgUS', src: 'setting' };
    if (c.speed === 'mi') return { mi: true, cons: c.cons && !metric(c.cons) ? c.cons : 'mpgUS', src: 'car' };
    if (c.speed === 'km') return { mi: false, cons: c.cons || 'l100', src: 'car' };
    return { mi: false, cons: metric(c.cons) ? c.cons : 'l100', src: 'default' };
}

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

module.exports = { PREF_KEY, PREFS, KM_PER_MI, carOf, resolve, dist, cons, consDec };
