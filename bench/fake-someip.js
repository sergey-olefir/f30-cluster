'use strict';
/**
 * fake-someip.js - a stand-in for the head unit's native `someip` binding (the module kit/runtime/signals.js requires), so the
 * REAL kit signals.js / car.js and an app's own code run against something that behaves like the car's vsomeip, not against
 * the bench's hu-stub (which skips signals.js entirely and calls the handlers directly).
 *
 *   const car = require('./fake-someip').createCar('driving', { app: 'cam_check' });
 *   car.binding            // what require('someip') returns: buildProxy(cfg, instance) -> proxy
 *   car.configs()          // { iface: interface config } for <app>/someipInterfaces/ (the ids are the car's catalogue's)
 *   car.start()            // runs the scenario's timeline (offers, events, field changes)
 *
 * The proxy has the binding's calls signals.js uses: init, subscribeToAvailability, isAvailable, subscribe({ name, onReceive }),
 * getValue(name, timeoutMs), shutdown. As vsomeip does:
 *   - a provider is available or not (offered by the car's gateway); availability handlers are called on every change, async;
 *   - a subscription is kept whatever the availability: events reach it whenever the provider is up and sends (subscribing
 *     before the provider is up is fine, as vsomeip re-subscribes);
 *   - an EVENT arrives only when the car sends it (something happened), a FIELD's notifier only when its value changes; no
 *     initial value is sent on subscribe (the kit reads the getter for that);
 *   - a getter is a request: answered while the provider is up and answers, else it times out with the car's own message
 *     ("method call get:<name>() with session N timed out after <t>ms", as in signal_probe's log of 2026-11-18).
 *
 * Car states (fix-1121 CS, the ways a car can make Camera Check's screen read «сервіс є, мовчить» on every row):
 *   parked   providers up, ignition on, standing: no event, no field change; the getters answer (FASuS's time out, as on the
 *            owner's car); speed 0
 *   asleep   providers up (the gateway still offers), the bus asleep: nothing is sent and no getter answers
 *   deaf     the car drives and sends everything, but THIS app's access is refused (its uid's access list not in force):
 *            the provider is seen as up, the subscriptions are taken and never served, the getters time out. Other apps
 *            (opts.app not in the scenario's deaf list, e.g. a theme) receive as usual.
 *   driving  everything the owner's car sent on 2026-11-18: the speed-limit event about twice a second, the camera's sign
 *            list, lanes, objects, the object list; speed and rpm notified; the camera's light-detection stream and the legacy
 *            traffic light stay silent (never seen on the car)
 *   late     as driving, but every provider comes up only 6 s after the start (the car woke after the app)
 *   flap     as driving, but the speed-limit provider goes away at 5 s and comes back at 7 s
 *
 * Read only by construction: there is no setValue and no callMethod (a call to either rejects).
 */

// The car's catalogue (reference/car/2026-11-15/someip/someip-interfaces.json) for the interfaces the camera check and the themes
// read: service id, version, events { name: [eventId, eventgroup, reliable] }, fields { name: [getterId (0 none), notifierId, eventgroup] }
const IFACES = {
    'de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy': { svc: 54582, ver: [1, 0], ev: { RecognitionTrafficLightCamera: [32769, 1, 0] }, f: {} },
    'de.bmw.sensors.objects.RecogFrontCameraLightDetection': { svc: 53385, ver: [1, 0], ev: { controlHighBeamAssistant: [32790, 1, 0], mainBeamAssistantDataObject1: [32769, 1, 0], mainBeamAssistantDataObject2: [32770, 1, 0] }, f: {} },
    'de.bmw.sensors.objects.RecogFrontCameraObjectlist': { svc: 53338, ver: [1, 0], ev: { objectlistTCP: [32770, 2, 1] }, f: {} },
    'de.bmw.environmentalmodel.ObjectRecognitionFrontCamera': { svc: 53255, ver: [1, 0], ev: { ObjectRecognition: [32769, 1, 0] }, f: {} },
    'de.bmw.environmentalmodel.SignRecognitionFrontCamera': { svc: 53258, ver: [1, 0], ev: { TrafficSignRecognitionFrontCamera: [32769, 1, 0] }, f: {} },
    'de.bmw.environmentalmodel.SignRecognitionFrontCameraLegacy': { svc: 54580, ver: [1, 0], ev: { RecognitionTrafficSignCamera: [32769, 1, 0], recognitionTrafficSignCamera2: [32770, 2, 0] }, f: {} },
    'de.bmw.dass.TrafficSignRecognition': { svc: 13632, ver: [1, 0], ev: { TrafficSignRecognition: [32769, 1, 0] }, f: {} },
    'de.bmw.environmentalmodel.LaneBoundaries': { svc: 53284, ver: [1, 0], ev: { LaneBoundaries: [32771, 3, 0] }, f: {} },
    'de.bmw.infotainment.vehicle.Vehicle2': { svc: 46361, ver: [1, 3], ev: {}, f: { statusLightStatus: [43, 32811, 1], statusCarSpeed2: [8, 32776, 1] } },
    'de.bmw.infotainment.vehicle.CDS': { svc: 46355, ver: [1, 0], ev: {}, f: { statusEngineSpeed2: [25, 32793, 1] } },
    'de.bmw.infrastructure.VehicleCondition': { svc: 5425, ver: [1, 0], ev: {}, f: { VehicleCondition: [0, 32769, 1] } },
    'de.bmw.body.Light': { svc: 21810, ver: [1, 0], ev: {}, f: { LampExterior2: [0, 32772, 4] } },
    'de.bmw.infotainment.fasus.FASuS': { svc: 46350, ver: [1, 3], ev: {}, f: { statusIDriveFASExtended: [51, 32819, 1] } }
};
const TSR = 'de.bmw.dass.TrafficSignRecognition';
const VEH2 = 'de.bmw.infotainment.vehicle.Vehicle2';
const CDS = 'de.bmw.infotainment.vehicle.CDS';
const FAS = 'de.bmw.infotainment.fasus.FASuS';

const SCENARIOS = {
    parked: { up: 0, getters: 'answer', silentGetters: [FAS], drive: false },
    asleep: { up: 0, getters: 'none', drive: false, quiet: true },
    deaf: { up: 0, getters: 'answer', silentGetters: [FAS], drive: true, deaf: ['cam_check'] },
    driving: { up: 0, getters: 'answer', silentGetters: [FAS], drive: true },
    late: { up: 6000, getters: 'answer', silentGetters: [FAS], drive: true },
    flap: { up: 0, getters: 'answer', silentGetters: [FAS], drive: true, flap: { iface: TSR, down: 5000, back: 7000 } }
};

/** An interface config as the installer would generate it for the declared names (the shape signals.js reads: fields[f].getter). */
function configOf(iface) {
    const d = IFACES[iface];
    if (!d) return null;
    const fields = {}, events = {};
    Object.keys(d.f).forEach((k) => {
        const x = d.f[k];
        fields[k] = { notifier: { id: x[1], eventgroups: [x[2]], reliable: false } };
        if (x[0]) fields[k].getter = { id: x[0], reliable: false };
    });
    Object.keys(d.ev).forEach((k) => { const x = d.ev[k]; events[k] = { eventId: x[0], eventgroups: [x[1]], reliable: !!x[2] }; });
    return { name: iface.split('.').pop(), interface: iface, serviceId: d.svc, version: { major: d.ver[0], minor: d.ver[1] }, fields, events, methods: {} };
}

/** The values the car sends while driving (shapes from signal_probe's fields and the catalogue; numbers only). */
function driveValues(t) {
    const kmh = Math.min(80, t / 200);
    return {
        speed: { speedVehicleCentreOfGravity: Math.round(kmh / 0.015625), qualifierSpeedVehicleCentreOfGravity: 0 },
        rpm: { actualValueRPMEngineCrankshaft: Math.round((1500 + (t % 3000) / 3) / 0.25) },
        tsr: { presentClassLimitSpeed: t < 8000 ? 10 : 8, nextClassLimitSpeed: 254, presentWithdrawalLimitSpeed: 1, controlSLIWarning: 0, unitOfMeasurementSpeedLimit: 0 },
        signs: { eventDataQualifier: 'EVENT_DATA_AVAILABLE', trafficSign: [{ value: t < 8000 ? 50 : 40, type: 'SPEED_LIMIT', form: 'ROUND' }] },
        signsL1: { numberSigns: 1, sign: [{ id: 3, value: t < 8000 ? 50 : 40 }] },
        lanes: { lane: [{ id: 1, offset: 175 + (t % 400) / 100 }, { id: 2, offset: -180 }] },
        objrec: { objects: [{ id: 7, cls: 2, lane: 0, x: 3000 - (t % 1000) }] },
        objlist: { objects: [{ id: 7, headLight: 'OFF', rearLight: 'ON', vx: 1500 }] }
    };
}

function createCar(name, opts) {
    const sc = SCENARIOS[name];
    if (!sc) throw new Error('fake-someip: no scenario ' + name);
    const app = (opts && opts.app) || 'app';
    const deaf = (sc.deaf || []).indexOf(app) >= 0;
    const t0 = Date.now();
    const up = {};                   // iface -> bool (offered)
    const avHandlers = {};           // iface -> [fn]
    const subs = {};                 // iface -> name -> [fn]
    const values = {};               // iface.field -> current value (the getters' answer)
    const stats = { built: 0, subscribed: 0, delivered: 0, getters: 0, answered: 0, timedOut: 0, refused: 0 };
    let session = 300;
    Object.keys(IFACES).forEach((i) => { up[i] = false; avHandlers[i] = []; subs[i] = {}; });
    values[VEH2 + '.statusCarSpeed2'] = { speedVehicleCentreOfGravity: 0, qualifierSpeedVehicleCentreOfGravity: 0 };
    values[VEH2 + '.statusLightStatus'] = { statusMainBeam_headlightFlasher: 'AUS', statusDippedBeam: 'EIN', statusPositionLight: 'EIN', statusFrontFogLight: 'AUS', statusRearFogLight: 'AUS', statusLightStatusError: 0 };
    values[CDS + '.statusEngineSpeed2'] = { actualValueRPMEngineCrankshaft: sc.drive ? 6000 : 0 };
    values[FAS + '.statusIDriveFASExtended'] = { statusFunctionTrafficLight: 0 };

    function setUp(iface, on) {
        if (up[iface] === on) return;
        up[iface] = on;
        avHandlers[iface].forEach((fn) => setImmediate(() => { try { fn(on); } catch (e) { /* the app's handler */ } }));
    }
    /** The car sends: an event, or a field's notifier (only when the value changed). */
    function send(iface, nm, v, isField) {
        if (!up[iface]) return;
        if (isField) {
            const k = iface + '.' + nm, s = JSON.stringify(v);
            if (JSON.stringify(values[k]) === s) return;
            values[k] = v;
        }
        if (deaf) return;            // the access list refuses this app: nothing reaches it
        (subs[iface][nm] || []).forEach((fn) => { stats.delivered++; setImmediate(() => { try { fn(v); } catch (e) { /* the app's handler */ } }); });
    }

    const binding = {
        buildProxy(cfg, instance) {
            const iface = cfg && cfg.interface;
            if (!iface || !IFACES[iface]) return Promise.reject(new Error('fake-someip: no such interface ' + (cfg && cfg.name)));
            if (String(instance) !== '1') return Promise.reject(new Error('fake-someip: ' + iface + ' has no instance ' + instance));
            stats.built++;
            let shut = false;
            const px = {
                init: () => Promise.resolve(),
                subscribeToAvailability(fn) { avHandlers[iface].push(fn); if (up[iface]) setImmediate(() => { try { fn(true); } catch (e) { /* */ } }); },
                isAvailable: () => up[iface] && !shut,
                subscribe(o) {
                    const nm = o && o.name, isEv = !!cfg.events[nm], isF = !!(cfg.fields[nm] && cfg.fields[nm].notifier);
                    if (!isEv && !isF) return Promise.reject(new Error('fake-someip: ' + iface + ' has no event or notifier ' + nm));
                    (subs[iface][nm] = subs[iface][nm] || []).push(o.onReceive);
                    stats.subscribed++;
                    return Promise.resolve();
                },
                getValue(nm, ms) {
                    stats.getters++;
                    const f = cfg.fields[nm], s = ++session;
                    if (!f || !f.getter) return Promise.reject(new Error('fake-someip: ' + nm + ' has no getter'));
                    const answers = up[iface] && !deaf && sc.getters === 'answer' && (sc.silentGetters || []).indexOf(iface) < 0;
                    return new Promise((resolve, reject) => {
                        if (answers) { stats.answered++; setTimeout(() => resolve(values[iface + '.' + nm]), 20); return; }
                        stats.timedOut++;
                        setTimeout(() => reject(new Error('method call get:' + nm + '() with session ' + s + '(0x' + s.toString(16) + ') timed out after ' + (ms || 3000) + 'ms')), ms || 3000);
                    });
                },
                setValue: () => { stats.refused++; return Promise.reject(new Error('fake-someip: read only')); },
                callMethod: () => { stats.refused++; return Promise.reject(new Error('fake-someip: read only')); },
                shutdown: () => { shut = true; return Promise.resolve(); }
            };
            return Promise.resolve(px);
        }
    };

    const timers = [];
    function start() {
        const offer = () => Object.keys(IFACES).forEach((i) => setUp(i, true));
        if (sc.up) timers.push(setTimeout(offer, sc.up)); else offer();
        if (sc.flap) {
            timers.push(setTimeout(() => setUp(sc.flap.iface, false), sc.flap.down));
            timers.push(setTimeout(() => setUp(sc.flap.iface, true), sc.flap.back));
        }
        if (sc.drive) {
            let tick = 0;
            timers.push(setInterval(() => {
                const t = Date.now() - t0, v = driveValues(t);
                tick++;
                send(VEH2, 'statusCarSpeed2', v.speed, true);
                send(CDS, 'statusEngineSpeed2', v.rpm, true);
                if (tick === 5) send('de.bmw.infrastructure.VehicleCondition', 'VehicleCondition', { statusConditionVehicle: 'FAHREN' }, true);
                if (tick % 5 === 0) send(TSR, 'TrafficSignRecognition', v.tsr);                       // about twice a second
                if (tick % 10 === 0) send('de.bmw.environmentalmodel.SignRecognitionFrontCamera', 'TrafficSignRecognitionFrontCamera', v.signs);
                if (tick % 10 === 0) send('de.bmw.environmentalmodel.SignRecognitionFrontCameraLegacy', 'RecognitionTrafficSignCamera', v.signsL1);
                send('de.bmw.environmentalmodel.LaneBoundaries', 'LaneBoundaries', v.lanes);
                send('de.bmw.environmentalmodel.ObjectRecognitionFrontCamera', 'ObjectRecognition', v.objrec);
                if (tick % 2 === 0) send('de.bmw.sensors.objects.RecogFrontCameraObjectlist', 'objectlistTCP', v.objlist);
            }, 100));
        }
        timers.forEach((t) => { if (t.unref) t.unref(); });
    }

    return {
        binding, start, stats, scenario: sc, deaf,
        configs: () => { const o = {}; Object.keys(IFACES).forEach((i) => { o[i] = configOf(i); }); return o; },
        stop: () => timers.forEach((t) => { clearTimeout(t); clearInterval(t); })
    };
}

module.exports = { createCar, configOf, SCENARIOS, IFACES };
