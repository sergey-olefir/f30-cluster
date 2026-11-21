'use strict';
/**
 * Camera Check - does this car's front camera send its traffic light, its light sources for the high beam, its object
 * lists, its sign lists and its lanes? One row per source on the centre screen, with the number of messages and of
 * different values. The first message of each source and its first different values go to the log whole (numbers and
 * enum names), so one drive answers the question.
 *
 * 0.1.1: one watch per interface, asked one after the other; each row also says whether the service is there at all.
 * 0.1.2 (fix-1121 CS): 0.1.1 showed «сервіс є, мовчить» on every row, the speed-limit control row too, and nothing on the
 *   screen could tell "the car sent nothing" (an event is silent until something happens: parked, no sign passed) from "the
 *   app hears nothing". Now:
 *   - the watches go through kit/car.js with an `extra` map, the very call the themes make (shared/hud.js -> Car ->
 *     signals.watch, every interface at once at the start), instead of 0.1.1's own sequence 3 s after the start;
 *   - every row says «подія» (an event: silence is normal until something happens) or «поле» (a field: its getter must
 *     answer at once, parked too; no answer is a fault);
 *   - each getter is asked once the provider is up (kit signals.get, a read), and its answer or its error is shown and
 *     logged (the kit's watch reads getters too, but drops their errors);
 *   - per interface: when the provider came up and went away, and how many times (screen and log);
 *   - per event: the subscription result and the number of messages;
 *   - a control row of fields the themes receive on this car (speed and rpm with their getters, the vehicle condition),
 *     so the app proves it can hear anything at all;
 *   - the app's own clock (ticking every second: a frozen app shows a stale clock), the speed now and the vehicle
 *     condition at the top, so a photo shows whether the car was moving and whether the app was alive;
 *   - a verdict line at the bottom and in the log.
 *
 * Read only: events and fields with notifiers and non-zero getters (app.json). The only calls made on the car are the
 * subscriptions and the fields' getters. No setter, no method, no diagnostic request. Plain Node 8. Never lets an exception
 * escape: an OAP app that exits twice is uninstalled.
 */
const mgu = require('./kit/mgu');
let Car = null;
try { Car = require('./kit/car'); } catch (e) { Car = null; }

const VEH2 = 'de.bmw.infotainment.vehicle.Vehicle2';
const CDS = 'de.bmw.infotainment.vehicle.CDS';
const COND = 'de.bmw.infrastructure.VehicleCondition';
const FAS = 'de.bmw.infotainment.fasus.FASuS';

/** kind 'event': silent until something happens. kind 'field': `getter` = app.json flag "r" (asked once the provider is up). */
const SOURCES = [
    { row: 'S_LIGHT', tag: 'light', iface: 'de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy', key: 'RecognitionTrafficLightCamera', kind: 'event' },
    { row: 'S_BEAMOBJ', tag: 'beam-obj1', iface: 'de.bmw.sensors.objects.RecogFrontCameraLightDetection', key: 'mainBeamAssistantDataObject1', kind: 'event' },
    { row: 'S_BEAMOBJ', tag: 'beam-obj2', iface: 'de.bmw.sensors.objects.RecogFrontCameraLightDetection', key: 'mainBeamAssistantDataObject2', kind: 'event' },
    { row: 'S_BEAMCTL', tag: 'beam-ctl', iface: 'de.bmw.sensors.objects.RecogFrontCameraLightDetection', key: 'controlHighBeamAssistant', kind: 'event' },
    { row: 'S_OBJLIST', tag: 'objlist', iface: 'de.bmw.sensors.objects.RecogFrontCameraObjectlist', key: 'objectlistTCP', kind: 'event' },
    { row: 'S_OBJREC', tag: 'objrec', iface: 'de.bmw.environmentalmodel.ObjectRecognitionFrontCamera', key: 'ObjectRecognition', kind: 'event' },
    { row: 'S_SIGNS', tag: 'signs', iface: 'de.bmw.environmentalmodel.SignRecognitionFrontCamera', key: 'TrafficSignRecognitionFrontCamera', kind: 'event' },
    { row: 'S_SIGNS', tag: 'signs-l1', iface: 'de.bmw.environmentalmodel.SignRecognitionFrontCameraLegacy', key: 'RecognitionTrafficSignCamera', kind: 'event' },
    { row: 'S_SIGNS', tag: 'signs-l2', iface: 'de.bmw.environmentalmodel.SignRecognitionFrontCameraLegacy', key: 'recognitionTrafficSignCamera2', kind: 'event' },
    { row: 'S_LIMIT', tag: 'limit', iface: 'de.bmw.dass.TrafficSignRecognition', key: 'TrafficSignRecognition', kind: 'event' },
    { row: 'S_LANES', tag: 'lanes', iface: 'de.bmw.environmentalmodel.LaneBoundaries', key: 'LaneBoundaries', kind: 'event' },
    { row: 'S_LAMPS', tag: 'lightstatus', iface: VEH2, key: 'statusLightStatus', kind: 'field', getter: true },
    { row: 'S_LAMPS', tag: 'lamp2', iface: 'de.bmw.body.Light', key: 'LampExterior2', kind: 'field', getter: false },
    { row: 'S_FAS', tag: 'fas-ext', iface: FAS, key: 'statusIDriveFASExtended', kind: 'field', getter: true },
    // the control row: fields the themes receive on this car (kit/car.js 'speed', 'rpm', 'condition')
    { row: 'S_CTRL', tag: 'speed', iface: VEH2, key: 'statusCarSpeed2', kind: 'field', getter: true, label: 'швидкість' },
    { row: 'S_CTRL', tag: 'rpm', iface: CDS, key: 'statusEngineSpeed2', kind: 'field', getter: true, label: 'оберти' },
    { row: 'S_CTRL', tag: 'cond', iface: COND, key: 'VehicleCondition', kind: 'field', getter: false, label: 'стан авто' }
];
// a getter not answered by then counts as no answer (the kit's watch waits 3 s too). The kit runs its native calls one at a time
// (signals.js nativeTick), so a getter that times out holds the next one back: the control row's getters are asked first.
const GETTER_MS = 3000;
const GETTER_ASKS = 3;           // per field: once per provider coming up, at most this often
const MONITOR_MS = 250;          // how often the watches' results and the providers' availability are looked at
// VehicleCondition.statusConditionVehicle: names or wire numbers (kit/car.js CONDITIONS)
const CONDITIONS = { 1: 'PARKEN_BN_NIO', 2: 'PARKEN_BN_IO', 3: 'STANDFUNKTIONEN', 5: 'WOHNEN', 7: 'PRUEFEN_ANALYSE_DIAGNOSE',
    8: 'FAHRBEREITSCHAFT_HERSTELLEN', 10: 'FAHREN', 12: 'FAHRBEREITSCHAFT_BEENDEN' };

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
const two = (n) => ('0' + n).slice(-2);
const clock = (d) => two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
const msg = (e) => String(e && e.message || e);
const shortIf = (iface) => iface.split('.').pop();

/** VehicleCondition's value -> its name (or the raw word / number), or null. */
function condName(v) {
    const x = v && typeof v === 'object' ? v.statusConditionVehicle : v;
    if (typeof x === 'number') return CONDITIONS[x] || String(x);
    if (typeof x === 'string' && /^[A-Z0-9_]{1,40}$/.test(x)) return x;
    return null;
}

mgu.run({
    start(ctx) {
        const log = ctx.log, ui = ctx.ui;
        const cfg = (ctx.spec && ctx.spec.config) || {};
        const names = cfg.rows || {};
        const maxValues = typeof cfg.logValues === 'number' ? cfg.logValues : 25;
        const maxChars = typeof cfg.logChars === 'number' ? cfg.logChars : 1800;
        const summaryMs = typeof cfg.summaryMs === 'number' && cfg.summaryMs >= 10000 ? cfg.summaryMs : 60000;
        const firstSummaryMs = typeof cfg.firstSummaryMs === 'number' && cfg.firstSummaryMs >= 5000 ? cfg.firstSummaryMs : 20000;
        const startAt = Date.now();
        const since = (t) => '+' + ((t - startAt) / 1000).toFixed(1) + ' s';
        const st = {};       // tag -> { n, seen, distinct, logged, first, last, moving, sub, get }
        SOURCES.forEach((s) => { st[s.tag] = { n: 0, seen: new Set(), distinct: 0, logged: 0, first: 0, last: 0, moving: 0, sub: null, get: null }; });
        const ifs = {};      // iface -> { res, doneAt, avail, up, down, upAt, downAt, srcs }
        SOURCES.forEach((s) => { (ifs[s.iface] = ifs[s.iface] || { res: null, doneAt: 0, avail: false, up: 0, down: 0, upAt: 0, downAt: 0, srcs: [] }).srcs.push(s); });
        let kmh = null, maxKmh = 0, cond = null, verdict = '';
        const sent = Object.create(null);
        const guard = (what, fn) => function () {
            try { return fn.apply(null, arguments); } catch (e) { log.error('ck: ' + what + ': ' + (e && e.stack || e)); return undefined; }
        };
        const text = (name, s) => {
            if (sent[name] === s) return;
            sent[name] = s;
            Promise.resolve().then(() => ui.text(name, s)).catch(() => {});
        };

        function speedOf(v) {
            const raw = v && typeof v === 'object' ? v.speedVehicleCentreOfGravity : null;
            if (typeof raw !== 'number') return;
            kmh = raw !== 65535 ? raw * 0.015625 : null;
            if (kmh !== null && kmh > maxKmh) maxKmh = kmh;
        }
        function condOf(v) {
            const c = condName(v);
            if (c && c !== cond) { log.info('ck: vehicle condition ' + c + ' at ' + since(Date.now())); cond = c; }
        }

        function seen(src, v) {
            const t = st[src.tag], now = Date.now();
            t.n++; t.last = now;
            if (!t.first) t.first = now;
            if (src.tag === 'speed') speedOf(v);
            if (src.tag === 'cond') condOf(v);
            if (kmh !== null && kmh > 3) t.moving++;
            const s = line(v, 1e6), h = hash(s);
            if (t.seen.has(h)) return;
            if (t.seen.size < 5000) t.seen.add(h);
            t.distinct++;
            if (t.logged < maxValues) {
                t.logged++;
                log.info('ck: ' + (t.distinct === 1 ? 'first' : 'value #' + t.distinct) + ' ' + src.tag + ' (' + (src.kind === 'event' ? 'event' : 'field') + ') at ' + since(now) + ', ' +
                    (kmh === null ? 'speed ?' : Math.round(kmh) + ' km/h') + ': ' + line(v, maxChars));
            } else if (t.logged === maxValues) {
                t.logged++;
                log.info('ck: ' + src.tag + ': more than ' + maxValues + ' different values; only counted from here');
            }
        }

        // ---- the getters: a read, asked once the provider is up (again when it comes back, at most GETTER_ASKS times) ----
        function ask(src, why) {
            const I = ifs[src.iface], t = st[src.tag];
            const g = t.get = t.get || { n: 0, state: 'wait', ms: 0, err: '', at: 0 };
            if (g.state === 'asking' || g.n >= GETTER_ASKS) return;
            if (!I.res || !I.res.proxy || !ctx.signals || typeof ctx.signals.get !== 'function') {
                if (g.state === 'wait') { g.state = 'noproxy'; log.info('ck: getter ' + shortIf(src.iface) + '.' + src.key + ': not asked (no proxy)'); }
                return;
            }
            g.n++; g.state = 'asking';
            const t0 = Date.now(), name = shortIf(src.iface) + '.' + src.key + ' #' + g.n + ' (' + why + ')';
            Promise.resolve().then(() => ctx.signals.get(I.res.proxy, src.key, GETTER_MS)).then(guard('getter', (v) => {
                g.state = 'ok'; g.ms = Date.now() - t0; g.at = Date.now();
                if (src.tag === 'speed') speedOf(v);
                if (src.tag === 'cond') condOf(v);
                log.info('ck: getter ' + name + ' answered in ' + g.ms + ' ms: ' + line(v, maxChars));
            }), guard('getter', (e) => {
                g.state = 'error'; g.ms = Date.now() - t0; g.err = msg(e).slice(0, 160);
                log.warn('ck: getter ' + name + ' NO ANSWER after ' + g.ms + ' ms: ' + g.err);
            })).catch(() => {});
        }

        // ---- the watches: the themes' own path (kit/car.js, one watch per interface, all at the start) ----
        const extra = {};
        SOURCES.forEach((src) => { (extra[src.iface] = extra[src.iface] || {})[src.key] = guard(src.tag, (v) => seen(src, v)); });
        // the kit's watch reports a failed subscription only as a log line ("subscribe <iface>.<name>: <error>"): keep it per source
        const tap = {
            info: (m) => log.info(m),
            warn: (m) => {
                log.warn(m);
                try {
                    const x = /^subscribe (.+)\.([A-Za-z0-9_]+): ([\s\S]*)$/.exec(String(m));
                    if (x) SOURCES.forEach((s) => { if (s.iface === x[1] && s.key === x[2]) st[s.tag].sub = 'error: ' + x[3].slice(0, 120); });
                } catch (e) { /* only a log line */ }
            },
            error: (m) => log.error(m),
            debug: (m) => { if (log.debug) log.debug(m); }
        };
        let subs = [];
        try {
            if (!Car) throw new Error('kit/car.js not packed');
            const car = new Car(Object.assign({}, ctx, { log: tap }), [], extra);
            subs = car.subs;
            log.info('ck: watching ' + Object.keys(extra).length + ' interfaces through kit/car.js (the themes\' path), all at the start');
        } catch (e) {
            // fallback, the same call: one watch per interface, all at once
            log.warn('ck: kit/car.js: ' + msg(e) + '; watching directly');
            Object.keys(extra).forEach((iface) => Promise.resolve().then(() => ctx.signals.watch(iface, '1', extra[iface], tap))
                .then((r) => { subs.push(r || { iface, error: 'no result' }); }, (er) => { subs.push({ iface, error: msg(er) }); }));
        }

        function monitor() {
            const now = Date.now(), toAsk = [];
            Object.keys(ifs).forEach((iface) => {
                const I = ifs[iface];
                if (!I.res) {
                    for (let i = 0; i < subs.length; i++) if (subs[i] && subs[i].iface === iface) { I.res = subs[i]; break; }
                    if (!I.res) return;
                    I.doneAt = now;
                    I.srcs.forEach((s) => { if (!st[s.tag].sub) st[s.tag].sub = I.res.error ? 'error: ' + msg(I.res.error).slice(0, 120) : 'ok'; });
                    log.info('ck: watch ' + shortIf(iface) + ' at ' + since(now) + ': ' + (I.res.error ? 'ERROR ' + msg(I.res.error).slice(0, 160) : 'provider ' + (I.res.available ? 'up' : 'not up yet')) + '; ' +
                        I.srcs.map((s) => s.key + ' (' + s.kind + (s.getter ? ', getter' : '') + ') ' + (st[s.tag].sub === 'ok' ? 'subscribed' : st[s.tag].sub)).join(', '));
                }
                const a = !!I.res.available;
                if (a !== I.avail) {
                    I.avail = a;
                    if (a) { I.up++; I.upAt = now; } else { I.down++; I.downAt = now; }
                    log.info('ck: provider ' + shortIf(iface) + (a ? ' UP #' + I.up : ' DOWN #' + I.down) + ' at ' + since(now));
                    if (a) I.srcs.forEach((s) => { if (s.getter) toAsk.push({ s, why: I.up === 1 ? 'provider up' : 'provider back' }); });
                }
            });
            // the control row's getters first: they say soonest whether the app hears the car at all
            toAsk.sort((x, y) => (x.s.row === 'S_CTRL' ? 0 : 1) - (y.s.row === 'S_CTRL' ? 0 : 1)).forEach((x) => ask(x.s, x.why));
        }

        // ---- the screen ----
        function provider(srcs) {
            const list = srcs.map((s) => ifs[s.iface]).filter((I, i, a) => a.indexOf(I) === i);
            if (list.some((I) => !I.res)) return 'підписуюсь…';
            if (list.every((I) => I.res.error)) return 'ПОМИЛКА підписки';
            const up = list.filter((I) => I.avail).length, ups = list.reduce((x, I) => x + I.up, 0), downs = list.reduce((x, I) => x + I.down, 0);
            return (up ? 'сервіс є' : 'сервісу немає') + (downs ? ' (з\'являвся ' + ups + '×, зникав ' + downs + '×)' : '');
        }
        function count(srcs) {
            const n = srcs.reduce((a, s) => a + st[s.tag].n, 0), d = srcs.reduce((a, s) => a + st[s.tag].distinct, 0);
            const last = srcs.reduce((a, s) => Math.max(a, st[s.tag].last), 0);
            if (!n) return null;
            const what = d === srcs.filter((s) => st[s.tag].n).length ? 'одне значення (' + n + '×)' : 'ЗМІНЮЄТЬСЯ: ' + d + ' різних з ' + n;
            return what + ', ' + ago(Date.now() - last);
        }
        function getterWord(s) {
            const g = st[s.tag].get;
            if (!s.getter) return '';
            if (!g || g.state === 'wait') return 'геттер чекає сервіс';
            if (g.state === 'asking') return 'геттер питаю…';
            if (g.state === 'ok') return 'геттер відповів';
            if (g.state === 'noproxy') return 'геттер не питав';
            return 'геттер НЕ ВІДПОВІВ — ЗБІЙ';
        }
        function rowText(row) {
            const srcs = SOURCES.filter((s) => s.row === row), name = names[row] || row;
            const pv = provider(srcs);
            if (row === 'S_CTRL') {
                return name + ' · поле: ' + srcs.map((s) => s.label + ' ' + st[s.tag].n + '×' + (s.getter ? ' (' + getterWord(s).replace('геттер ', 'г. ') + ')' : '')).join(', ');
            }
            const c = count(srcs);
            if (srcs[0].kind === 'event') {
                const subErr = srcs.filter((s) => st[s.tag].sub && st[s.tag].sub !== 'ok').length;
                let what;
                if (c) what = c;
                else if (pv === 'підписуюсь…' || pv === 'ПОМИЛКА підписки') what = pv;
                else if (subErr === srcs.length) what = 'ПОМИЛКА підписки';
                else if (/^сервісу немає/.test(pv)) what = 'тиша';
                else if (!heardAny()) what = 'тиша (не судити: контроль теж мовчить)';
                else if (kmh !== null && kmh > 10) what = 'тиша, хоча авто їде';
                else what = 'тиша (норма, поки нічого не сталось)';
                const quiet = !c && what !== 'підписуюсь…' && what !== 'ПОМИЛКА підписки';
                return name + ' · подія: ' + what + (quiet || /зникав/.test(pv) ? ' · ' + pv : '');
            }
            const gs = srcs.filter((s) => s.getter).map(getterWord).join(', ');
            let what = c || (pv === 'підписуюсь…' || pv === 'ПОМИЛКА підписки' ? pv : 'сповіщень 0');
            if (!c && pv === 'сервісу немає') what += ', сервісу немає';
            return name + ' · поле: ' + what + (gs ? ' · ' + gs : '');
        }
        /** Does the app hear the car at all? Any value, or any getter answered: yes. Every getter failed and nothing came: no. */
        function heardAny() { return SOURCES.some((s) => st[s.tag].n > 0 || (st[s.tag].get && st[s.tag].get.state === 'ok')); }
        function judge() {
            if (heardAny()) {
                const ev = SOURCES.filter((s) => s.kind === 'event' && st[s.tag].n > 0).length;
                return 'Застосунок ЧУЄ авто. Подій з даними: ' + ev + '. Подія мовчить, поки нічого не сталось; поле — збій, якщо геттер не відповів.';
            }
            const done = Object.keys(ifs).every((i) => ifs[i].res);
            const tried = SOURCES.filter((s) => s.getter && st[s.tag].get && (st[s.tag].get.state === 'error' || st[s.tag].get.state === 'ok'));
            if (done && tried.length && tried.every((s) => st[s.tag].get.state === 'error')) return 'НІЧОГО не чути, навіть контроль і геттери: авто спить або застосунок глухий. Фото екрана + лог.';
            return done ? 'Чекаю відповідей полів…' : 'Підписуюсь…';
        }

        function refresh() {
            const now = new Date(), up = Math.floor((now.getTime() - startAt) / 1000);
            text('HEAD', 'Лише читання · ' + clock(now) + ' · працює ' + Math.floor(up / 60) + ':' + two(up % 60) + ' · ' +
                (kmh === null ? '? км/год' : Math.round(kmh) + ' км/год') + ' (макс ' + Math.round(maxKmh) + ')' + (cond ? ' · ' + cond : ''));
            SOURCES.map((s) => s.row).filter((r, i, a) => a.indexOf(r) === i).forEach((row) => text(row, rowText(row)));
            const v = judge();
            if (v !== verdict) { verdict = v; log.info('ck: verdict at ' + since(Date.now()) + ': ' + v); }
            text('FOOT', v);
        }

        function summary() {
            const parts = SOURCES.map((s) => {
                const t = st[s.tag], g = t.get, I = ifs[s.iface];
                return s.tag + '=' + t.n + '/' + t.distinct + (t.moving ? '/m' + t.moving : '') +
                    (s.getter ? '/g:' + (g ? g.state : 'wait') : '') + (t.sub && t.sub !== 'ok' ? '!sub' : '') +
                    (I.res ? (I.res.error ? '!err' : I.avail ? '' : '!down') : '!wait');
            });
            const pv = Object.keys(ifs).map((i) => shortIf(i) + ' ' + ifs[i].up + 'up/' + ifs[i].down + 'down');
            log.info('ck: summary ' + since(Date.now()) + ', clock ' + clock(new Date()) + ', ' + (kmh === null ? 'speed ?' : Math.round(kmh) + ' km/h') +
                ', max ' + Math.round(maxKmh) + ' km/h, condition ' + (cond || '?') + ': ' + parts.join(' ') + ' | providers: ' + pv.join(', '));
        }

        try {
            if (typeof ui.onVisible === 'function') ui.onVisible(guard('visible', (name, on) => { if (name === 'MAIN' && on) { Object.keys(sent).forEach((k) => { delete sent[k]; }); refresh(); } }));
        } catch (e) { log.warn('ck: onVisible: ' + msg(e)); }
        const timers = [setInterval(guard('monitor', monitor), MONITOR_MS), setInterval(guard('refresh', refresh), 1000), setInterval(guard('summary', summary), summaryMs),
            setTimeout(guard('summary', summary), firstSummaryMs)];
        timers.forEach((t) => { if (t && t.unref) t.unref(); });
        log.info('ck: start cam_check ' + ((ctx.spec && ctx.spec.version) || '') + ', ' + SOURCES.length + ' sources (' + SOURCES.filter((s) => s.kind === 'event').length + ' events, ' +
            SOURCES.filter((s) => s.kind === 'field').length + ' fields, ' + SOURCES.filter((s) => s.getter).length + ' getters), read only');
        refresh();
    }
});
