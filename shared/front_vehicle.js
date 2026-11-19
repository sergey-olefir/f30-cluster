'use strict';
/**
 * front_vehicle.js - the vehicle ahead as the front camera reports it, turned into a few honest words a picture can show
 * (front-vehicle FV, docs/AGENT-BRIEF-front-vehicle.md; the design is docs/twin-dial/FV-SPEC.md). Pure and app-agnostic:
 * Twin Dial's drawing is shared/twin_front.js.
 *
 * The source (the owner's G20: front camera, no radar, no adaptive cruise; Signal Probe set S14, docs/car/CP-REPORT.md 13):
 *   de.bmw.dass.GapVehicleAhead.DataFrontVehicle - a FIELD with a notifier only (id 32770, eventgroup 2, no getter, no setter;
 *   the catalogue reference/car/2026-11-15/someip/someip-interfaces.json), so it is declared "s" exactly as Signal Probe does.
 *   Members: frontVehicleObjectID (UInt8, 255 default), frontVehicleSpeedX / SpeedY / GapX / GapY (UInt16, 4095 default),
 *   qualifierEventDataFunctionFrontVehicle (0 AVAILABLE, 1 AVAILABLE_REDUCED, 2 NOT_AVAILABLE; 15 default),
 *   qualifierExtendedFunctionFrontVehicle (0 NORMAL_OPERATION_MODE ... 15 EVENT_DATA_INVALID_OR_TIMEOUT).
 *   Seen on the car: gapX 57..1736 while driving, 4093 parked ("no target": a guess, the catalogue's default is 4095); speedX
 *   about 1500 when both cars hold the same speed (probably an offset encoding of the relative speed: NOT used here).
 *
 * What is NOT known, and so is a config key, never a constant (config.frontVehicle, defaults in DEFAULT below):
 *   - the gap's unit and scale. `scale` (metres per raw unit) stays null until a calibrated drive; while it is null no number is
 *     ever shown, and the levels use `assumeScale` (0.1 m, a hypothesis: 57..1736 -> 5.7..173.6 m, a camera's range) only to
 *     place the gap among five steps. `nearer: "smaller"` is the assumed direction (smaller raw = nearer).
 *   - which raw values mean "no target" (`none`), and which qualifier values mean "no data" (`qualNone`).
 *   - how often the car sends it (the field is notified on change; a gap that never changes would look stale: `staleMs`).
 *
 *   cfgOf(c)                      config.frontVehicle over DEFAULT, or null when it is not an object
 *   readOf(cfg, v)                one value -> { ok, gap, speed, obj, qual, qualExt, why } (pure)
 *   rawLevel(cfg, m, kmh)         metres + own speed -> { level 1..5, mode 'time' | 'dist', x } with no memory (pure)
 *   holdLevel(cfg, prev, r)       the hysteresis: the level to show, given the last one (pure)
 *   create(cfg, { log, clock })   the tracker: feed(v, kmh), view(kmh) -> the state a picture shows; start() / stop(); lines
 *
 * The view: { state, present, level, closing, stale, absent, word, gap, speed, obj, metres, timeGap, rate }
 *   state   'off' | 'absent' (nothing ever came) | 'none' (no target, or stale) | 'seen' | 'near' | 'closing' | 'fast'
 *   level   1 (nearest) .. 5 (farthest), 0 without a target
 *   closing 0, 1 (the gap shrinks), 2 (shrinks fast): from the change of the gap over the last `closing.windowMs`, never from speedX
 *   metres / timeGap: numbers ONLY when `scale` is set (calibrated), else null
 *
 * Log lines (the lead calibrates from them): numbers and our own state words only, never anything personal; one per state
 * change at most every `logMs`, one "hold" sample every `sampleMs` while a target is followed, at most `maxLines` a run.
 * Plain Node 8 (the car's 8.16.2): no ?. / ?? / object spread. Nothing here throws.
 */

const isNum = (x) => typeof x === 'number' && isFinite(x);
const pick = (v, path) => { let r = v; (Array.isArray(path) ? path : []).forEach((k) => { r = r === null || r === undefined || typeof r !== 'object' ? undefined : r[k]; }); return r; };
const inList = (a, x) => Array.isArray(a) && a.indexOf(x) >= 0;
/** A number as the car may hand it over (a number, a numeric string), else null. */
const numOf = (x) => (isNum(x) ? x : typeof x === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(x) ? Number(x) : null);

const IFACE = 'de.bmw.dass.GapVehicleAhead';
const FIELD = 'DataFrontVehicle';
const QUAL = ['EVENT_DATA_AVAILABLE', 'EVENT_DATA_AVAILABLE_REDUCED', 'EVENT_DATA_NOT_AVAILABLE'];

/** config.frontVehicle's defaults. Every number that the car has not proven is here, so a drive corrects a line, not the code. */
const DEFAULT = {
    on: false,                                  // the test mode (Діагностика "Авто попереду (тест)" writes it); off = no subscription
    iface: IFACE, field: FIELD, instance: '1',
    gapPath: ['frontVehicleGapX'], speedPath: ['frontVehicleSpeedX'], objPath: ['frontVehicleObjectID'],
    qualPath: ['qualifierEventDataFunctionFrontVehicle'], qualExtPath: ['qualifierExtendedFunctionFrontVehicle'],
    none: [4093, 4094, 4095],                   // 4093 seen parked; 4095 the catalogue's default; 4094 the usual "error" of the family
    rawMin: 1, rawMax: 4092,                    // a gap outside is no reading
    qualNone: [2, 'EVENT_DATA_NOT_AVAILABLE'],  // the camera says there is no data: no target, whatever the gap says
    objNone: [255],                             // the id's default: no object
    nearer: 'smaller',                          // ASSUMPTION (to confirm in the log): a smaller raw gap is nearer
    scale: null,                                // metres per raw unit, once calibrated: then the time gap is shown as a number
    assumeScale: 0.1,                           // HYPOTHESIS, for the five steps only (never printed)
    levels: { timeGap: [0.9, 1.4, 2.0, 3.0], metres: [8, 15, 30, 60], minKmh: 20 },     // boundaries 1|2|3|4|5, in s and in m
    hyst: 0.12,                                 // a boundary must be passed by 12 % before the level moves
    median: 3,                                  // the gap is the median of the last 3 values of one object (one spike moves nothing)
    closing: { windowMs: 1500, minMs: 600, rate: 1.0, fastRate: 4.0, fastTtc: 4.0, release: 0.6 },   // m/s (on the scale above)
    staleMs: 2000,                              // no value for this long: no target (never a frozen car)
    absentMs: 10000,                            // no value at all this long after the start: "Немає даних"
    logMs: 1000, sampleMs: 5000, maxLines: 1800,
};

/** config.frontVehicle over DEFAULT (levels and closing merged one level deep); null unless it is an object. */
function cfgOf(c) {
    if (!c || typeof c !== 'object') return null;
    const out = Object.assign({}, DEFAULT);
    Object.keys(c).forEach((k) => { if (c[k] !== undefined && k.charAt(0) !== '_') out[k] = c[k]; });
    out.levels = Object.assign({}, DEFAULT.levels, c.levels && typeof c.levels === 'object' ? c.levels : {});
    out.closing = Object.assign({}, DEFAULT.closing, c.closing && typeof c.closing === 'object' ? c.closing : {});
    return out;
}

/** An enum as it may arrive (its number or its name) -> a number when known, the raw word otherwise. */
function qualOf(x) {
    if (isNum(x)) return x;
    if (typeof x === 'string') { const i = QUAL.indexOf(x); return i >= 0 ? i : /^\s*\d+\s*$/.test(x) ? Number(x) : x; }
    return null;
}

/**
 * One value of DataFrontVehicle -> { ok (a target is reported), gap, speed, obj, qual, qualExt, why }. gap / speed are the raw
 * numbers (null when absent or not a number); why says why ok is false: 'shape' | 'none value' | 'out of range' | 'qualifier'.
 */
function readOf(cfg, v) {
    const c = cfg || DEFAULT;
    const out = { ok: false, gap: null, speed: null, obj: null, qual: null, qualExt: null, why: 'shape' };
    if (!v || typeof v !== 'object') return out;
    out.gap = numOf(pick(v, c.gapPath));
    out.speed = numOf(pick(v, c.speedPath));
    out.obj = numOf(pick(v, c.objPath));
    out.qual = qualOf(pick(v, c.qualPath));
    out.qualExt = qualOf(pick(v, c.qualExtPath));
    if (out.gap === null) return out;
    if (inList(c.none, out.gap)) { out.why = 'none value'; return out; }
    if (out.gap < c.rawMin || out.gap > c.rawMax) { out.why = 'out of range'; return out; }
    if (inList(c.qualNone, out.qual) || inList(c.qualNone, QUAL[out.qual])) { out.why = 'qualifier'; return out; }
    out.ok = true; out.why = '';
    return out;
}

/** Raw gap -> metres on the calibrated scale, else on the assumed one (for the steps only). `nearer: "larger"` flips the sense. */
function metresOf(cfg, raw, calibratedOnly) {
    const c = cfg || DEFAULT;
    if (!isNum(raw)) return null;
    const s = isNum(c.scale) && c.scale > 0 ? c.scale : calibratedOnly ? null : isNum(c.assumeScale) && c.assumeScale > 0 ? c.assumeScale : null;
    if (s === null) return null;
    const r = c.nearer === 'larger' ? Math.max(0, (isNum(c.rawMax) ? c.rawMax : 4092) - raw) : raw;
    return r * s + (isNum(c.offset) ? c.offset : 0);
}

/** The level with no memory: time gap when our speed is at least levels.minKmh, else distance. { level, mode, x, bounds }. */
function rawLevel(cfg, m, kmh) {
    const L = (cfg || DEFAULT).levels;
    if (!isNum(m)) return { level: 0, mode: null, x: null, bounds: null };
    const timed = isNum(kmh) && kmh >= L.minKmh;
    const x = timed ? m / (kmh / 3.6) : m;
    const b = timed ? L.timeGap : L.metres;
    let lv = 1;
    for (let i = 0; i < b.length && i < 4; i++) if (x >= b[i]) lv = i + 2;
    return { level: Math.min(5, lv), mode: timed ? 'time' : 'dist', x, bounds: b };
}

/**
 * The hysteresis: `prev` is { level, mode } shown last (or null), `r` the rawLevel now. The level moves up only when x is past the
 * next boundary by `hyst` (x >= b * (1 + h)), down only when under the lower one by it (x < b * (1 - h)); several steps at once
 * when x is far past. A change of mode (time <-> distance) or no previous level takes the raw level.
 */
function holdLevel(cfg, prev, r) {
    const h = isNum((cfg || DEFAULT).hyst) ? (cfg || DEFAULT).hyst : DEFAULT.hyst;
    if (!r || !r.level) return 0;
    if (!prev || !prev.level || prev.mode !== r.mode) return r.level;
    let lv = prev.level;
    const b = r.bounds;
    while (lv < 5 && r.x >= b[lv - 1] * (1 + h)) lv++;
    while (lv > 1 && r.x < b[lv - 2] * (1 - h)) lv--;
    return lv;
}

/** The least-squares slope of [[t ms, m]] in m/s, or null with fewer than 3 points or a span under minMs. */
function slopeOf(pts, minMs) {
    if (!pts || pts.length < 3) return null;
    const span = pts[pts.length - 1][0] - pts[0][0];
    if (span < (isNum(minMs) ? minMs : 0) || span <= 0) return null;
    let st = 0, sm = 0;
    pts.forEach((p) => { st += p[0]; sm += p[1]; });
    const mt = st / pts.length, mm = sm / pts.length;
    let num = 0, den = 0;
    pts.forEach((p) => { num += (p[0] - mt) * (p[1] - mm); den += (p[0] - mt) * (p[0] - mt); });
    return den > 0 ? num / den * 1000 : null;
}

/** The word for a level, our own (Noto has every letter): 1-2 near, 3 middle, 4-5 far. */
const WORDS = { 1: 'близько', 2: 'близько', 3: 'середньо', 4: 'далеко', 5: 'далеко' };

/**
 * The tracker. feed(v, kmh) takes every value of the field; view(kmh) is the state now (call it as often as the picture wants:
 * the stale and absent clocks run in it). start() begins a run (the absent clock), stop() ends it (view: 'off').
 * o: { log: { info }, clock: () => ms }.
 */
function create(cfgIn, o) {
    const opt = o || {};
    const cfg = cfgOf(cfgIn) || cfgOf({});
    const now = () => (opt.clock ? opt.clock() : Date.now());
    const st = {
        running: false, startedAt: 0, lastAt: 0, got: 0, ever: false,
        last: null,                     // the last readOf
        obj: null, gaps: [], hist: [],  // the followed object's last raw gaps (median) and [t, m] (closing)
        lv: null,                       // { level, mode } shown
        closing: 0, rate: null,
        lines: 0, logAt: -1e9, pending: null, said: '', sampleAt: 0, n: 0, nAt: 0,
    };
    const say = (line) => {
        if (st.lines >= cfg.maxLines) return;
        st.lines++;
        try { if (opt.log && opt.log.info) opt.log.info(line); } catch (e) { /* never */ }
    };
    function reset() { st.gaps = []; st.hist = []; st.lv = null; st.closing = 0; st.rate = null; }

    /** Feed one value (the field's handler). kmh: our own speed now (null when not known). */
    function feed(v, kmh) {
        if (!st.running) return;
        const t = now(), r = readOf(cfg, v);
        st.last = r; st.lastAt = t; st.got++; st.ever = true; st.n++;
        if (!r.ok) { if (st.gaps.length) reset(); st.obj = null; return; }
        const objOk = isNum(r.obj) && !inList(cfg.objNone, r.obj);
        if (objOk && st.obj !== null && r.obj !== st.obj) reset();          // another object (a cut-in or a cut-out): start again
        st.obj = objOk ? r.obj : st.obj;
        st.gaps.push(r.gap);
        const n = Math.max(1, Math.round(cfg.median || 1));
        while (st.gaps.length > n) st.gaps.shift();
        const g = median(st.gaps);
        const m = metresOf(cfg, g, false);
        if (isNum(m)) {
            st.hist.push([t, m]);
            const w = cfg.closing.windowMs;
            while (st.hist.length && t - st.hist[0][0] > w) st.hist.shift();
            const lv = holdLevel(cfg, st.lv, rawLevel(cfg, m, kmh));
            st.lv = { level: lv, mode: rawLevel(cfg, m, kmh).mode };
            // closing: the slope of the gap, with its own hysteresis (release below `release` x the threshold)
            const s = slopeOf(st.hist, cfg.closing.minMs);
            st.rate = s === null ? null : -s;
            const C = cfg.closing, rate = st.rate;
            if (rate === null) st.closing = 0;
            else {
                const ttc = rate > 0 ? m / rate : Infinity;
                const fast = rate >= C.fastRate || (rate >= C.rate && ttc < C.fastTtc);
                const fastHold = rate >= C.fastRate * C.release || (rate >= C.rate * C.release && ttc < C.fastTtc / C.release);
                if (fast) st.closing = 2;
                else if (st.closing === 2 && fastHold) st.closing = 2;
                else if (rate >= C.rate) st.closing = 1;
                else if (st.closing >= 1 && rate >= C.rate * C.release) st.closing = 1;
                else st.closing = 0;
            }
        }
    }

    /** The state a picture shows now. */
    function view(kmh) {
        const t = now();
        const off = { state: 'off', present: false, level: 0, closing: 0, stale: false, absent: false, word: '', gap: null, speed: null, obj: null, metres: null, timeGap: null, rate: null };
        if (!st.running) return off;
        const out = Object.assign({}, off);
        const r = st.last;
        if (r) { out.gap = r.gap; out.speed = r.speed; out.obj = r.obj; }
        if (!st.ever) {
            out.absent = t - st.startedAt >= cfg.absentMs;
            out.state = out.absent ? 'absent' : 'none';
        } else if (t - st.lastAt > cfg.staleMs) {
            out.stale = true; out.state = 'none';
            if (st.gaps.length) reset();
        } else if (r && r.ok && st.lv && st.lv.level) {
            out.present = true; out.level = st.lv.level; out.closing = st.closing; out.rate = st.rate;
            out.word = WORDS[out.level] || '';
            const mc = metresOf(cfg, median(st.gaps), true);
            if (isNum(mc)) { out.metres = mc; out.timeGap = isNum(kmh) && kmh >= cfg.levels.minKmh ? mc / (kmh / 3.6) : null; }
            out.state = st.closing === 2 ? 'fast' : st.closing === 1 ? 'closing' : out.level === 1 ? 'near' : 'seen';
        } else out.state = 'none';
        note(out, kmh, t);
        return out;
    }

    /** The log: one line per change of (state, level, closing), at most every logMs (the newest waits for its slot), a sample every sampleMs. */
    function note(v, kmh, t) {
        const key = v.state + '|' + v.level + '|' + v.closing;
        const line = () => 'fv: ' + v.state + ' level ' + v.level + ' gap ' + num(v.gap) + ' speed ' + num(v.speed) + ' obj ' + num(v.obj) +
            ' q ' + num(st.last && st.last.qual) + '/' + num(st.last && st.last.qualExt) + ' v ' + num(isNum(kmh) ? Math.round(kmh) : null) +
            ' rate ' + (isNum(v.rate) ? (Math.round(v.rate * 10) / 10).toFixed(1) : '-') + ' n ' + st.n;
        if (key !== st.said) {
            if (t - st.logAt >= cfg.logMs) { st.said = key; st.logAt = t; st.sampleAt = t; say(line()); st.n = 0; }
            return;                                         // the change waits for its slot (the next view after logMs says it)
        }
        if (v.present && t - st.sampleAt >= cfg.sampleMs) { st.sampleAt = t; st.logAt = t; say(line().replace(/^fv: \w+/, 'fv: hold ' + v.state)); st.n = 0; }
    }

    return {
        cfg,
        feed,
        view,
        start() {
            st.running = true; st.startedAt = now(); st.ever = false; st.last = null; st.obj = null; st.said = ''; st.n = 0; reset();
            say('fv: on (' + cfg.iface.split('.').pop() + '.' + cfg.field + '; none ' + (cfg.none || []).join('/') + ', scale ' + (isNum(cfg.scale) ? cfg.scale : 'none') +
                ', assumed ' + cfg.assumeScale + ', stale ' + cfg.staleMs + ' ms)');
        },
        stop(why) {
            if (!st.running) return;
            st.running = false; reset();
            say('fv: off' + (why ? ' (' + why + ')' : ''));
        },
        running: () => st.running,
        state: () => ({ running: st.running, got: st.got, ever: st.ever, lines: st.lines, level: st.lv ? st.lv.level : 0, closing: st.closing, rate: st.rate, obj: st.obj }),
    };
}

function median(a) {
    if (!a || !a.length) return null;
    const s = a.slice().sort((x, y) => x - y), k = s.length >> 1;
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}
const num = (x) => (isNum(x) ? String(Math.round(x * 100) / 100) : '-');

module.exports = { cfgOf, readOf, metresOf, rawLevel, holdLevel, slopeOf, median, create, DEFAULT, WORDS, IFACE, FIELD, QUAL };
