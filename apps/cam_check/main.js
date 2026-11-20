'use strict';
/**
 * Camera Check - does this car's front camera send its traffic light, its light sources for the high beam, its object
 * lists, its sign lists and its lanes? One row per source on the centre screen: silent, one value only (most likely the
 * default) or changing, with the number of messages and of different values. The first message of each source and its
 * first different values go to the log whole (numbers and enum names), so one drive answers the question.
 *
 * Read only: events and fields with notifiers and non-zero getters (app.json). No setter, no method, no diagnostic
 * request. Plain Node 8. Never lets an exception escape: an OAP app that exits twice is uninstalled.
 */
const mgu = require('./kit/mgu');

const SOURCES = [
    { row: 'S_LIGHT', tag: 'light', iface: 'de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy', key: 'RecognitionTrafficLightCamera' },
    { row: 'S_BEAMOBJ', tag: 'beam-obj1', iface: 'de.bmw.sensors.objects.RecogFrontCameraLightDetection', key: 'mainBeamAssistantDataObject1' },
    { row: 'S_BEAMOBJ', tag: 'beam-obj2', iface: 'de.bmw.sensors.objects.RecogFrontCameraLightDetection', key: 'mainBeamAssistantDataObject2' },
    { row: 'S_BEAMCTL', tag: 'beam-ctl', iface: 'de.bmw.sensors.objects.RecogFrontCameraLightDetection', key: 'controlHighBeamAssistant' },
    { row: 'S_OBJLIST', tag: 'objlist', iface: 'de.bmw.sensors.objects.RecogFrontCameraObjectlist', key: 'objectlistTCP' },
    { row: 'S_OBJREC', tag: 'objrec', iface: 'de.bmw.environmentalmodel.ObjectRecognitionFrontCamera', key: 'ObjectRecognition' },
    { row: 'S_SIGNS', tag: 'signs', iface: 'de.bmw.environmentalmodel.SignRecognitionFrontCamera', key: 'TrafficSignRecognitionFrontCamera' },
    { row: 'S_SIGNS', tag: 'signs-l1', iface: 'de.bmw.environmentalmodel.SignRecognitionFrontCameraLegacy', key: 'RecognitionTrafficSignCamera' },
    { row: 'S_SIGNS', tag: 'signs-l2', iface: 'de.bmw.environmentalmodel.SignRecognitionFrontCameraLegacy', key: 'recognitionTrafficSignCamera2' },
    { row: 'S_LIMIT', tag: 'limit', iface: 'de.bmw.dass.TrafficSignRecognition', key: 'TrafficSignRecognition' },
    { row: 'S_LANES', tag: 'lanes', iface: 'de.bmw.environmentalmodel.LaneBoundaries', key: 'LaneBoundaries' },
    { row: 'S_LAMPS', tag: 'lightstatus', iface: 'de.bmw.infotainment.vehicle.Vehicle2', key: 'statusLightStatus' },
    { row: 'S_LAMPS', tag: 'lamp2', iface: 'de.bmw.body.Light', key: 'LampExterior2' },
    { row: 'S_FAS', tag: 'fas-ext', iface: 'de.bmw.infotainment.fasus.FASuS', key: 'statusIDriveFASExtended' }
];
const SPEED_IF = 'de.bmw.infotainment.vehicle.Vehicle2';

/** FNV-1a over a string: tells different values apart without keeping them. */
function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h;
}

/** A value as one log line: numbers and enum names only (the members are numbers, enums and structs of them). */
function line(v, max) {
    let s;
    try { s = JSON.stringify(v, (k, x) => (typeof x === 'string' && x.length > 40 ? '<text ' + x.length + '>' : x)); } catch (e) { s = '<unprintable>'; }
    if (s === undefined) s = String(v);
    return s.length > max ? s.slice(0, max) + '... (' + s.length + ' chars)' : s;
}

function ago(ms) {
    const s = Math.round(ms / 1000);
    return s < 60 ? s + ' с тому' : s < 3600 ? Math.round(s / 60) + ' хв тому' : Math.round(s / 3600) + ' год тому';
}

mgu.run({
    start(ctx) {
        const log = ctx.log, ui = ctx.ui;
        const cfg = (ctx.spec && ctx.spec.config) || {};
        const names = cfg.rows || {};
        const maxValues = typeof cfg.logValues === 'number' ? cfg.logValues : 25;
        const maxChars = typeof cfg.logChars === 'number' ? cfg.logChars : 1800;
        const summaryMs = typeof cfg.summaryMs === 'number' && cfg.summaryMs >= 10000 ? cfg.summaryMs : 60000;
        const startAt = Date.now();
        const st = {};                                   // tag -> { n, seen: Set of hashes, first, last, moving }
        SOURCES.forEach((s) => { st[s.tag] = { n: 0, seen: new Set(), distinct: 0, logged: 0, first: 0, last: 0, moving: 0, watch: '' }; });
        let kmh = null, maxKmh = 0;
        const sent = Object.create(null);
        const guard = (what, fn) => function () {
            try { return fn.apply(null, arguments); } catch (e) { log.error('ck: ' + what + ': ' + (e && e.stack || e)); return undefined; }
        };
        const text = (name, s) => {
            if (sent[name] === s) return;
            sent[name] = s;
            Promise.resolve().then(() => ui.text(name, s)).catch(() => {});
        };

        function seen(src, v) {
            const t = st[src.tag], now = Date.now();
            t.n++; t.last = now;
            if (!t.first) t.first = now;
            if (kmh !== null && kmh > 3) t.moving++;
            const s = line(v, 1e6), h = hash(s);
            if (t.seen.has(h)) return;
            if (t.seen.size < 5000) t.seen.add(h);
            t.distinct++;
            if (t.logged < maxValues) {
                t.logged++;
                log.info('ck: ' + (t.distinct === 1 ? 'first' : 'value #' + t.distinct) + ' ' + src.tag + ' at +' + Math.round((now - startAt) / 1000) + ' s, ' +
                    (kmh === null ? 'speed ?' : Math.round(kmh) + ' km/h') + ': ' + line(v, maxChars));
            } else if (t.logged === maxValues) {
                t.logged++;
                log.info('ck: ' + src.tag + ': more than ' + maxValues + ' different values; only counted from here');
            }
        }

        function rowText(row) {
            const srcs = SOURCES.filter((s) => s.row === row), now = Date.now();
            const n = srcs.reduce((a, s) => a + st[s.tag].n, 0);
            const d = srcs.reduce((a, s) => a + st[s.tag].distinct, 0);
            const last = srcs.reduce((a, s) => Math.max(a, st[s.tag].last), 0);
            const err = srcs.filter((s) => st[s.tag].watch === 'error').length;
            const name = names[row] || row;
            let what;
            if (!n) what = err === srcs.length ? 'не підписався' : 'мовчить';
            else if (d === srcs.filter((s) => st[s.tag].n).length) what = 'одне й те саме значення (' + n + '×)';
            else what = 'ЗМІНЮЄТЬСЯ: ' + d + ' різних з ' + n;
            return name + ': ' + what + (last ? ', ' + ago(now - last) : '');
        }

        function refresh() {
            const mins = Math.round((Date.now() - startAt) / 60000);
            text('HEAD', 'Лише читання. Працює ' + mins + ' хв; найбільша швидкість ' + Math.round(maxKmh) + ' км/год.');
            Object.keys(names).forEach((row) => text(row, rowText(row)));
            text('FOOT', 'Перше повідомлення кожного джерела записано в лог застосунку.');
        }

        function summary() {
            const parts = SOURCES.map((s) => { const t = st[s.tag]; return s.tag + '=' + t.n + '/' + t.distinct + (t.moving ? '/m' + t.moving : ''); });
            log.info('ck: summary +' + Math.round((Date.now() - startAt) / 1000) + ' s, max ' + Math.round(maxKmh) + ' km/h: ' + parts.join(' '));
        }

        // ---- signals: read only, watched once at start ----
        SOURCES.forEach((src) => {
            const h = {}; h[src.key] = guard(src.tag, (v) => seen(src, v));
            Promise.resolve().then(() => ctx.signals.watch(src.iface, '1', h, log))
                .then((r) => { st[src.tag].watch = r && r.error ? 'error' : 'ok'; log.info('ck: watch ' + src.tag + ' ' + st[src.tag].watch); },
                    (e) => { st[src.tag].watch = 'error'; log.warn('ck: watch ' + src.tag + ' failed: ' + (e && e.message || e)); });
        });
        Promise.resolve().then(() => ctx.signals.watch(SPEED_IF, '1', { statusCarSpeed2: guard('speed', (v) => {
            const raw = v && typeof v === 'object' ? v.speedVehicleCentreOfGravity : null;
            kmh = typeof raw === 'number' && raw !== 65535 ? raw * 0.015625 : null;
            if (kmh !== null && kmh > maxKmh) maxKmh = kmh;
        }) }, log)).catch((e) => log.warn('ck: watch speed failed: ' + (e && e.message || e)));

        try {
            if (typeof ui.onVisible === 'function') ui.onVisible(guard('visible', (name, on) => { if (name === 'MAIN' && on) { Object.keys(sent).forEach((k) => { delete sent[k]; }); refresh(); } }));
        } catch (e) { log.warn('ck: onVisible: ' + (e && e.message || e)); }
        const t1 = setInterval(guard('refresh', refresh), 2000);
        const t2 = setInterval(guard('summary', summary), summaryMs);
        if (t1.unref) t1.unref();
        if (t2.unref) t2.unref();
        log.info('ck: start cam_check, ' + SOURCES.length + ' sources, read only');
        refresh();
    }
});
