'use strict';
/**
 * carplay-turns-fixture.js - GuidanceEventList.queryContent replies for the bench and the tests (car issues CT). Never shipped.
 *
 * The SHAPES are the car's catalogue of 2026-11-15 (navigation.GuidingTypes: ViewContent, GuidanceEventUnion and its members with
 * the inherited GuidanceEvent / GuidancePanel members) as the OAP binding hands them over: a union keyed by its member, enums by name,
 * a UInt64 (uid, ids) as a digit string, the "no value" unions as { nil: 'NO_VALUE' }. What CarPlay puts in them follows the public
 * log of a G21 with CarPlay / Apple Maps (2026-11-09; cauliflowermossgrape/idrive7-apps, kit/tools/fixtures): rawDistance 1 whatever
 * the distance, the distance as the text formattedDistance.distance with its unit, the event after the next one with the text " " and
 * unit NONE (rawDistance 500), detailedGeometry UNDEFINED, configSequenceId 4294967295. Every road name is invented and neutral; no
 * coordinate is real.
 *
 *   const FX = require('./carplay-turns-fixture');
 *   FX.reply([FX.turn('LEFT', '250', 'METER', 'вулиця Тестова'), FX.dest()])     one reply
 *   FX.ROUTE                                                                      a route: [{ at: ms, reply }], three turns and a roundabout
 *   FX.fakeProvider(script)                                                       a stand-in for hu-stub's hu.fakes (callMethod)
 */

const IFACE = 'de.bmw.infotainment.navigation.guiding.GuidanceEventList';

let uidSeq = 0;
/** The members every event carries (GuidanceEvent + GuidancePanel), CarPlay's way. */
function panel(o) {
    o = o || {};
    return {
        uid: o.uid !== undefined ? o.uid : String(++uidSeq), distanceToDestination: o.toDest !== undefined ? o.toDest : 2400, unreliable: false,
        sourceId: { simpleId: { id: '0' } },
        formattedDistance: { distance: o.dist !== undefined ? o.dist : ' ', unit: o.unit || 'NONE', rawDistance: o.raw !== undefined ? o.raw : 1 },
        description: { elements: o.road ? [{ text: o.road }] : [] },
        travelTime: 0, travelTimeDelay: 0, trafficSegmentsInfo: { overview: [], segments: [] }, guidingStep: o.step || 'GS2',
        speedLimitAssistInfo: { nil: 'NO_VALUE' }, combinedManeuverType: 'SINGLE', maneuverRestriction: 'NONE',
    };
}
const assign = (a, b) => { Object.keys(b).forEach((k) => { a[k] = b[k]; }); return a; };
const links = (o) => (o && o.coords ? { value: { entryLink: {}, exitLink: {}, turningPoint: { coordinatesValid: true, heightValid: false, longitude: 30.1234, latitude: 50.4321, height: { unit: 'METER', displayLength: 0, rawLengthMeter: 0 } } } } : { nil: 'NO_VALUE' });

/** An intersection: direction (TurnDirection), the phone's distance text and unit, a road name. */
function turn(direction, dist, unit, road, o) {
    return { intersection: assign(panel(assign({ dist, unit, road }, o || {})), { direction, roadlinks: links(o), detailedGeometry: 'UNDEFINED' }) };
}
function branch(branchType, dist, unit, road, o) {
    return { branch: assign(panel(assign({ dist, unit, road }, o || {})), { branchType, roadlinks: links(o), detailedGeometry: 'UNDEFINED' }) };
}
function roundabout(exitNumber, dist, unit, road, o) {
    return { roundabout: assign(panel(assign({ dist, unit, road }, o || {})), { exitAngle: 90 * exitNumber, exitNumber, driveDirection: (o && o.side) || 'RIGHT', roadlinks: links(o) }) };
}
function along(mainRoadDirection, dist, unit, road, o) {
    return { alongMainRoad: assign(panel(assign({ dist, unit, road }, o || {})), { mainRoadDirection }) };
}
function tunnel(dist, unit, o) {
    return { tunnel: assign(panel(assign({ dist, unit }, o || {})), { length: 420, formattedLength: { distance: '420', unit: 'METER', rawDistance: 420 }, isInsideEvent: false }) };
}
/** The destination, CarPlay's way: the text " ", unit NONE, rawDistance 500 (the event after the next one). */
function dest(o) {
    return { destinationManeuver: assign(panel(assign({ dist: ' ', unit: 'NONE', raw: 500, step: 'GS1', road: 'Приклад, 1' }, o || {})), {
        position: (o && o.position) || 'RIGHT', isCheckeredFlag: true, stopOverNumber: 0, roadlinks: { nil: 'NO_VALUE' }, chargingInfo: { nil: 'NO_VALUE' }, poi: { nil: 'NO_VALUE' } }) };
}
/** A whole reply. */
function reply(events, o) {
    o = o || {};
    return {
        GuidanceEventListError: o.error || 'NO_ERROR',
        viewContent: o.noView ? [] : [{ configSequenceId: 4294967295, indexedPosition: { valid: false, ccpOffset: 0, totalElementCount: events.length }, eventsInView: events }],
        currentDistances: { carDistanceToFinalDestination: 0, carDistanceToNextDestination: -1, travelledDistanceSinceTripStart: -1, travelledDistanceSinceLastDestination: -1 },
    };
}

/** A short CarPlay route (the car protocol's: three turns and a roundabout), one reply per 2 s poll: [{ at (ms from the start), reply }]. */
const ROUTE = (() => {
    const R1 = 'вулиця Тестова', R2 = 'проспект Прикладний', R3 = 'вулиця Зразкова', R4 = 'площа Умовна';
    const out = [];
    const add = (at, events) => out.push({ at, reply: reply(events) });
    add(0, [turn('LEFT', '400', 'METER', R1, { uid: '1' }), dest({ uid: '5' })]);
    add(2000, [turn('LEFT', '350', 'METER', R1, { uid: '1' }), dest({ uid: '5' })]);
    add(4000, [turn('LEFT', '50', 'METER', R1, { uid: '1' }), dest({ uid: '5' })]);
    add(6000, [turn('RIGHT', '1,2', 'KM', R2, { uid: '2' }), turn('SLIGHT_LEFT', ' ', 'NONE', R3, { uid: '3', raw: 500 })]);
    add(8000, [turn('RIGHT', '900', 'METER', R2, { uid: '2' }), turn('SLIGHT_LEFT', ' ', 'NONE', R3, { uid: '3', raw: 500 })]);
    add(10000, [turn('SLIGHT_LEFT', '300', 'METER', R3, { uid: '3' }), roundabout(2, ' ', 'NONE', R4, { uid: '4', raw: 500 })]);
    add(12000, [roundabout(2, '200', 'METER', R4, { uid: '4' }), dest({ uid: '5' })]);
    add(14000, [roundabout(2, '20', 'METER', R4, { uid: '4' }), dest({ uid: '5' })]);
    add(16000, [dest({ uid: '5', dist: '150', unit: 'METER', raw: 1, step: 'GS2' })]);
    add(18000, []);
    return out;
})();

/**
 * A stand-in provider for kit/tools/hu-stub.js (hu.fakes[IFACE] = FX.fakeProvider(...)): a proxy with the binding's calls whose
 * callMethod answers queryContent from `script(params, n)` (a reply, or a thrown error = the call fails) and refuses every other
 * method. calls: every call made, { method, params }.
 */
function fakeProvider(script) {
    const calls = [];
    const make = () => ({
        __fake: true, calls,
        callMethod: (method, params) => {
            calls.push({ method, params });
            if (method !== 'queryContent') return Promise.reject(new Error('fake GuidanceEventList: only queryContent'));
            return Promise.resolve().then(() => script(params, calls.length));
        },
        getValue: () => Promise.reject(new Error('fake GuidanceEventList: no getter')),
        setValue: () => Promise.reject(new Error('fake GuidanceEventList: no setter')),
        subscribe: () => Promise.resolve(), subscribeToAvailability: (fn) => { fn(true); }, isAvailable: () => true, shutdown: () => Promise.resolve(),
    });
    const f = () => make();
    f.calls = calls;
    return f;
}

module.exports = { IFACE, panel, turn, branch, roundabout, along, tunnel, dest, reply, ROUTE, fakeProvider };
