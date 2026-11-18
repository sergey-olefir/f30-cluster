'use strict';
/**
 * limit_src.js - the speed limit and the cruise / limiter from the sources the owner's car really sends (car-fix CF2,
 * docs/AGENT-BRIEF-car-fix.md section 0 and 2). Packed by twin_dial and f30_cluster; shared/hud.js requires it the way it
 * requires twin_limit.js (absent: the engine reads config.sign's field alone, as before).
 *
 * What the car showed on 2026-11-18 (signal_probe 0.1.1, set S13 / S8):
 *   - TrafficSignDisplayControl.displaySpeedLimitAndNoPassingRestriction (the field both apps were built on): its provider
 *     never comes up. It stays the FALLBACK source (other cars may send it).
 *   - The limit arrives as the EVENT de.bmw.dass.TrafficSignRecognition.TrafficSignRecognition (service 13632, instance 1,
 *     about 2 a second): presentClassLimitSpeed x 5 = km/h (class 8 with a 40 sign, 6 with a 30, 10 = 50 in town; 12, 2, 1
 *     also seen), controlSLIWarning 0 / 1 (the over-limit flag: a hypothesis), presentWithdrawalLimitSpeed 1 always.
 *   - The front camera's own event (SignRecognitionFrontCamera.TrafficSignRecognitionFrontCamera) gives the sign it read in
 *     km/h: a second witness. Logged only; nothing is drawn from it.
 *   - Cruise / limiter: DisplayDataServer.functionalLibraryData (the HUD's feed, filled with the HUD off): cruiseCtrlSpeedHUD
 *     = the set speed in km/h (65535 none), ldmSym LDM_SYM_DCC (cruise) / LDM_SYM_SLD (limiter) / LDM_SYM_NONE, ldmSymColor
 *     LDM_ACTIVE / LDM_OFF.
 *
 * The numbers' meaning beyond those values comes from the catalogue (reference/car/2026-11-15/someip/someip-interfaces.json):
 * the event's members are plain UInt8; FASuS's enums of the same names spell them out (NextClassLimitSpeed: 0
 * AUFHEBUNG_ALLES, 1.._28 = 5..140, 29 GONG_ANFORDERUNG_SPEED_LIMIT_WECHSEL (a chime request, not a speed), 30 = 150, 254
 * NICHT_VERFUEGBAR, 255 SIGNAL_UNBEFUELLT; UnitOfMeasurementSpeedLimit: 0 KM_S_H, 1 MPH, 2 n/a, 3 invalid;
 * PresentWithdrawalLimitSpeed: 0 n/a, 1 BESCHRAENKUNG, 2 AUFHEBUNG, 3 invalid). Each is a key of config.sign.tsr, so the next
 * car session corrects a line, not the code.
 *
 *   tsrOf(cfg, v)         the event -> the engine's sign shape (hud.js SIGN_NONE: state, kmh, shown, unit, warn, ...) + src
 *   camOf(v)              the camera event -> { kmh, value, unit, n } of its first speed-limit sign, or null
 *   hudCruiseOf(cfg, v)   functionalLibraryData -> twin_limit's cruise reading { kind, status, shown, unit, kmh }
 *   create(signCfg, o)    the merger: field(reading) / tsr(raw) / cam(raw) each return the reading to show; wire(extra, apply)
 *                         subscribes the events on the engine's `extra` (read only: events and a notifier, never a method)
 *   events(signCfg)       [[iface, event], ...] the events that move the sign (twin_limit chains behind them)
 *
 * Plain Node 8 (the car's 8.16). Pure functions never throw; the merger's log lines carry numbers and enum names only.
 */

const isNum = (x) => typeof x === 'number' && isFinite(x);
const pick = (v, path) => { let r = v; (Array.isArray(path) ? path : []).forEach((k) => { r = r === null || r === undefined ? r : r[k]; }); return r; };
const inList = (a, x) => Array.isArray(a) && a.indexOf(x) >= 0;
const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
/** A number as the car may hand it over: a number, or a numeric string. Anything else: null. */
const numOf = (x) => (isNum(x) ? x : typeof x === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(x) ? Number(x) : null);
/** An enum's capital name, or a number, as it may go into a log line; anything else (text) only as its length. */
const rawWord = (x) => {
    if (x === undefined || x === null) return '-';
    if (typeof x === 'number' || typeof x === 'boolean') return String(x);
    if (typeof x === 'string') return /^[A-Z][A-Z0-9_]{0,63}$/.test(x) ? x : /^\s*-?\d+\s*$/.test(x) ? x.trim() : 'text' + x.length;
    return 'struct';
};

const TSR_IF = 'de.bmw.dass.TrafficSignRecognition';
const TSR_EV = 'TrafficSignRecognition';
const CAM_IF = 'de.bmw.environmentalmodel.SignRecognitionFrontCamera';
const CAM_EV = 'TrafficSignRecognitionFrontCamera';
const DDS_IF = 'de.bmw.infotainment.displaydataserver.DisplayDataServer';
const DDS_F = 'functionalLibraryData';

/** The engine's sign with nothing known (a copy of hud.js SIGN_NONE, plus the source it came from). */
const SIGN_NONE = { state: 'none', kmh: null, shown: null, unit: null, warn: 0, supp: null, style: null, sure: null, np: 'none', npM: null };

/** config.sign.tsr's defaults: the car's values of 2026-11-18 and the catalogue's enums (header). */
const TSR_DEFAULT = {
    iface: TSR_IF, event: TSR_EV, instance: '1',
    classPath: ['presentClassLimitSpeed'], factor: 5,
    none: [0, 29, 253, 254, 255],               // no limit drawn: 0 (end of all), 29 (the chime request), 253..255 (n/a, unfilled)
    end: [],                                    // the derestriction sign: unseen on the car, so nothing maps to it yet
    warnPath: ['controlSLIWarning'], warnMap: { 1: 1, 2: 2 },      // 0 / 1 seen; 1 = over the limit is a hypothesis
    unitPath: ['unitOfMeasurementSpeedLimit'], mph: [1, 'MPH'],    // anything else is km/h
    withdrawalPath: ['presentWithdrawalLimitSpeed'], endOn: [],    // AUFHEBUNG = 2 would be the end sign: unseen, off
    staleMs: 3000,                              // the event comes about twice a second; older than this, a fallback may speak
};
const CAM_DEFAULT = { iface: CAM_IF, event: CAM_EV, instance: '1' };
/** The order the sources are asked in: the first one live wins (create()). */
const ORDER_DEFAULT = ['tsr', 'field'];

/** config.sign.tsr over the defaults (a shallow overlay); null unless config.sign.tsr is an object (an app opts in, and
 *  declares the event in its "signals": an undeclared interface would only fail its watch). */
function tsrCfg(signCfg) {
    const c = signCfg && own(signCfg, 'tsr') ? signCfg.tsr : undefined;
    if (!c || typeof c !== 'object') return null;
    const out = Object.assign({}, TSR_DEFAULT);
    Object.keys(c).forEach((k) => { if (c[k] !== undefined && k.charAt(0) !== '_') out[k] = c[k]; });
    out.min = signCfg && isNum(signCfg.min) ? signCfg.min : 5;
    out.max = signCfg && isNum(signCfg.max) ? signCfg.max : 250;
    return out;
}
/** config.sign.camera over the defaults; null unless it is an object (the same opt-in). */
function camCfg(signCfg) {
    const c = signCfg && own(signCfg, 'camera') ? signCfg.camera : undefined;
    if (!c || typeof c !== 'object') return null;
    return Object.assign({}, CAM_DEFAULT, c);
}

/**
 * The TrafficSignRecognition event -> the engine's sign shape (SIGN_NONE's keys, src 'tsr', cls: the raw class).
 * The class times `factor` is the number on the sign, in the event's own unit (mph only when its unit says so); a class in
 * `none`, out of [min, max] km/h, or not a number: state 'none' (no sign). Pure, never throws.
 */
function tsrOf(cfg, v) {
    const out = Object.assign({}, SIGN_NONE, { src: 'tsr', cls: null });
    if (!cfg || v === undefined || v === null || typeof v !== 'object') return out;
    const cls = numOf(pick(v, cfg.classPath));
    out.cls = cls;
    const w = numOf(pick(v, cfg.warnPath));
    const wm = cfg.warnMap && w !== null && own(cfg.warnMap, String(w)) ? Number(cfg.warnMap[String(w)]) : 0;
    out.warn = wm === 1 || wm === 2 ? wm : 0;
    const unitRaw = pick(v, cfg.unitPath);
    const mph = inList(cfg.mph, unitRaw) || inList(cfg.mph, numOf(unitRaw));
    out.unit = mph ? 'mph' : 'kmh';
    const wd = numOf(pick(v, cfg.withdrawalPath));
    if (cls === null) return out;
    if (inList(cfg.end, cls) || (wd !== null && inList(cfg.endOn, wd))) { out.state = 'end'; out.warn = 0; return out; }
    if (inList(cfg.none, cls) || cls < 0) return out;
    const shown = cls * (isNum(cfg.factor) ? cfg.factor : 5);
    const kmh = mph ? shown * 1.609344 : shown;
    if (!(kmh >= cfg.min && kmh <= cfg.max)) return out;
    out.state = 'limit'; out.shown = shown; out.kmh = kmh;
    return out;
}

/**
 * The front camera's event -> its first speed-limit sign: { value, unit ('kmh' | 'mph' | raw word), kmh, n (signs in the
 * event) }, or null when it carries none. The member names are the probe's (apps/signal_probe/fields.js cam-signs). Pure.
 */
function camOf(v) {
    if (!v || typeof v !== 'object') return null;
    const list = Array.isArray(v.trafficSign) ? v.trafficSign : [];
    const uRaw = pick(v, ['trafficSignRecognition', 'speedLimitUnit']);
    const mph = /MPH|MILE/i.test(String(uRaw)) || uRaw === 1;
    for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!s || typeof s !== 'object') continue;
        const val = numOf(s.value), type = s.type;
        const isLimit = typeof type === 'string' ? /SPEED_LIMIT/.test(type) && !/END|CANCEL|AUFHEB/.test(type) : false;
        if (!isLimit || val === null || val <= 0 || val >= 255) continue;
        return { value: val, unit: mph ? 'mph' : 'kmh', kmh: mph ? val * 1.609344 : val, n: list.length };
    }
    return null;
}

/* ---------------------------------------------------------------- cruise (DisplayDataServer) ---------------------- */

/** config.cruise's keys for the HUD feed: what each value of ldmSym / ldmSymColor means (catalogue names, numbers too). */
const HUD_CRUISE_DEFAULT = {
    hudIface: DDS_IF, hudField: DDS_F, hudInstance: '1',
    symPath: ['ldmSym'], colourPath: ['ldmSymColor'], hudSpeedPath: ['cruiseCtrlSpeedHUD'], limiterPath: ['statusLimiter'],
    // LDMSymbol: DCC (1, 2) the plain cruise; ACC / STA / the assistants the adaptive one; SLD (7..12) the limiter;
    // NONE (0), HDC (6, hill descent) and EDP (13) draw nothing
    symMap: {
        LDM_SYM_NONE: null, 0: null,
        LDM_SYM_DCC: 'cruise', 1: 'cruise', LDM_SYM_DCC_ASSIST: 'cruise', 2: 'cruise',
        LDM_SYM_ACC: 'acc', 3: 'acc', LDM_SYM_ACC_ASSIST: 'acc', 4: 'acc', LDM_SYM_ACC_AUTO: 'acc', 5: 'acc',
        LDM_SYM_HDC: null, 6: null,
        LDM_SYM_SLD: 'limiter', 7: 'limiter', LDM_SYM_SLD_ASSIST: 'limiter', 8: 'limiter', LDM_SYM_SLD_AUTO: 'limiter', 9: 'limiter',
        LDM_SYM_SLD_FLASH_OFF: 'limiter', 10: 'limiter', LDM_SYM_SLD_ASSIST_FLASH_OFF: 'limiter', 11: 'limiter', LDM_SYM_SLD_AUTO_FLASH_OFF: 'limiter', 12: 'limiter',
        LDM_SYM_EDP: null, 13: null, LDM_SYM_STA: 'acc', 16: 'acc',
        LDM_SYM_ASSIST: 'acc', 35: 'acc', LDM_SYM_ASSIST_ASSIST: 'acc', 36: 'acc', LDM_SYM_ASSIST_AUTO: 'acc', 37: 'acc',
        LDM_ASSIST_PLUS: 'acc', 67: 'acc', LDM_ASSIST_PLUS_ASSIST: 'acc', 68: 'acc', LDM_ASSIST_PLUS_AUTO: 'acc', 69: 'acc',
    },
    activeOn: ['LDM_ACTIVE', 1],                // green; every other colour (OFF, STANDBY, overridden, critical, brake only) grey
    hudInvalid: [0, 65535], hudMin: 5, hudMax: 300, hudMph: false,         // the set speed is km/h on the owner's car
};

/** The HUD feed's keys of config.cruise over the defaults (a map named replaces the default map). */
function hudCruiseCfg(cruiseCfg) {
    const c = cruiseCfg && typeof cruiseCfg === 'object' ? cruiseCfg : {};
    const out = Object.assign({}, HUD_CRUISE_DEFAULT);
    Object.keys(HUD_CRUISE_DEFAULT).forEach((k) => { if (c[k] !== undefined) out[k] = c[k]; });
    return out;
}

/**
 * functionalLibraryData -> { kind: 'cruise' | 'acc' | 'limiter' | null, status: 'off' | 'standby' | 'active', shown, unit,
 * kmh } (twin_limit's cruise reading). A symbol that draws nothing, or a set speed that is 65535 / 0 / out of range: off
 * (nothing at all). Green (active) only for LDM_ACTIVE; any other colour is grey (standby). Pure, never throws.
 */
function hudCruiseOf(cfg, v) {
    const off = { kind: null, status: 'off', shown: null, unit: null, kmh: null };
    if (!cfg || !v || typeof v !== 'object') return off;
    const symRaw = pick(v, cfg.symPath);
    const kind = symRaw !== undefined && symRaw !== null && cfg.symMap && own(cfg.symMap, String(symRaw)) ? cfg.symMap[String(symRaw)] : null;
    if (!kind) return off;
    const sp = numOf(pick(v, cfg.hudSpeedPath));
    if (sp === null || inList(cfg.hudInvalid, sp)) return off;
    const mph = cfg.hudMph === true;
    const kmh = mph ? sp * 1.609344 : sp;
    if (!(kmh >= cfg.hudMin && kmh <= cfg.hudMax)) return off;
    const col = pick(v, cfg.colourPath);
    const status = inList(cfg.activeOn, col) ? 'active' : 'standby';
    return { kind, status, shown: Math.round(sp), unit: mph ? 'mph' : 'kmh', kmh };
}

/** The raw members of the HUD feed that a cruise log line names (numbers and enum names only). */
function hudCruiseRaw(cfg, v) {
    return 'ldm ' + rawWord(pick(v, cfg.symPath)) + ' colour ' + rawWord(pick(v, cfg.colourPath)) + ' speed ' + rawWord(pick(v, cfg.hudSpeedPath)) +
        ' limiter ' + rawWord(pick(v, cfg.limiterPath));
}

/* ---------------------------------------------------------------- the merger -------------------------------------- */

const MAX_LINES = 200;

/**
 * The sources of config.sign merged into the one sign the engine shows.
 *   field(reading)  the engine's signOf of config.sign's field (TrafficSignDisplayControl): a notifier, so it has no age
 *   tsr(raw)        the TrafficSignRecognition event: live while younger than staleMs
 *   cam(raw)        the camera's event: logged as a witness, never shown
 * Each of field / tsr returns the reading to show now: the first source in config.sign.order (default tsr, field) that is
 * live (it has said something other than "none", and an event source said it within staleMs); else the newest reading of
 * any source; else SIGN_NONE. On the owner's car the field never comes, so the event is the sign.
 * o: { log, clock } (clock: ms; tests).
 */
function create(signCfg, o) {
    const opt = o || {};
    const tc = tsrCfg(signCfg), cc = camCfg(signCfg);
    const order = signCfg && Array.isArray(signCfg.order) && signCfg.order.length ? signCfg.order : ORDER_DEFAULT;
    const now = () => (opt.clock ? opt.clock() : Date.now());
    const st = { field: null, fieldAt: 0, tsr: null, tsrAt: 0, cam: null, camAt: 0, src: null, logged: {}, lines: 0, tsrN: 0, camN: 0 };
    const say = (key, line) => {
        if (st.logged[key] === line || st.lines >= MAX_LINES) return;
        st.logged[key] = line; st.lines++;
        try { if (opt.log && opt.log.info) opt.log.info(line); } catch (e) { /* never */ }
    };
    const live = (name) => {
        const r = st[name];
        if (!r || r.state === 'none') return false;
        if (name === 'tsr') return now() - st.tsrAt < (isNum(tc && tc.staleMs) ? tc.staleMs : 3000);
        return true;
    };
    function current() {
        for (let i = 0; i < order.length; i++) {
            const n = order[i];
            if ((n === 'tsr' || n === 'field') && live(n)) return { name: n, r: st[n] };
        }
        const any = [['tsr', st.tsrAt], ['field', st.fieldAt]].filter((p) => st[p[0]]).sort((a, b) => b[1] - a[1]);
        return any.length ? { name: any[0][0], r: st[any[0][0]] } : { name: null, r: Object.assign({}, SIGN_NONE) };
    }
    function pickNow() {
        const c = current();
        if (c.name !== st.src) {
            say('src', 'limit: source ' + (c.name || 'none') + (c.name === 'field' ? ' (TrafficSignDisplayControl)' : c.name === 'tsr' ? ' (TrafficSignRecognition event)' : ''));
            st.src = c.name;
        }
        return c.r;
    }
    const api = {
        cfg: { tsr: tc, cam: cc, order },
        field(reading) {
            st.field = Object.assign({}, reading || SIGN_NONE, { src: 'field' }); st.fieldAt = now();
            return pickNow();
        },
        tsr(v) {
            const r = tsrOf(tc, v);
            st.tsr = r; st.tsrAt = now(); st.tsrN++;
            const wd = tc ? numOf(pick(v, tc.withdrawalPath)) : null;
            const next = v && typeof v === 'object' ? numOf(v.nextClassLimitSpeed) : null;
            const unitRaw = tc ? pick(v, tc.unitPath) : undefined;
            say('tsr', 'limit: tsr class ' + (r.cls === null ? '-' : r.cls) + ' -> ' + r.state + (r.state === 'limit' ? ' ' + Math.round(r.shown) + ' ' + r.unit : '') +
                ' warn ' + r.warn + ' (warn raw ' + rawWord(tc ? pick(v, tc.warnPath) : undefined) + ', withdrawal ' + (wd === null ? '-' : wd) +
                ', unit raw ' + rawWord(unitRaw) + ', next class ' + (next === null ? '-' : next) + ')');
            if (st.cam) api._agree();
            return pickNow();
        },
        cam(v) {
            const c = camOf(v);
            st.camN++;
            if (!c) return null;            // an event without a speed-limit sign changes nothing (and is not logged: it may come often)
            st.cam = c; st.camAt = now();
            say('cam', 'limit: camera ' + c.value + ' ' + c.unit);
            api._agree();
            return c;
        },
        /** The witness's verdict, one line per change: does the camera's number match the event's? */
        _agree() {
            const r = st.tsr, c = st.cam;
            if (!r || !c) return;
            const same = r.state === 'limit' && isNum(r.kmh) && Math.abs(r.kmh - c.kmh) < 0.5;
            say('agree', 'limit: camera ' + Math.round(c.kmh) + ' km/h, tsr ' + (r.state === 'limit' ? Math.round(r.kmh) + ' km/h' : r.state) + (same ? ' agree' : ' differ'));
        },
        current: () => current().r,
        source: () => st.src,
        state: () => ({ tsrN: st.tsrN, camN: st.camN, tsrAt: st.tsrAt, fieldAt: st.fieldAt, src: st.src, cam: st.cam }),
        /**
         * Subscribe the events on the engine's `extra` (kit car.js: one watch per interface; an event is subscribed by name
         * like a field, it has no getter). apply(reading) is the engine's own sign handler. A handler already on the event is
         * kept and runs first.
         */
        wire(extra, apply) {
            const put = (c, fn) => {
                if (!c || !c.iface || !c.event) return;
                const e = extra[c.iface] = extra[c.iface] || {};
                if (c.instance && String(c.instance) !== '1') e.$instance = String(c.instance);
                const prev = e[c.event];
                e[c.event] = (v) => { if (prev) prev(v); fn(v); };
            };
            put(tc, (v) => apply(api.tsr(v)));
            put(cc, (v) => { api.cam(v); });
        },
    };
    return api;
}

/** The events whose arrival moves the sign (twin_limit chains its repaint behind them): [[iface, event]]. */
function events(signCfg) {
    const tc = tsrCfg(signCfg);
    return tc && tc.iface && tc.event ? [[tc.iface, tc.event]] : [];
}

module.exports = {
    tsrOf, camOf, tsrCfg, camCfg, hudCruiseOf, hudCruiseCfg, hudCruiseRaw, create, events, rawWord,
    TSR_IF, TSR_EV, CAM_IF, CAM_EV, DDS_IF, DDS_F, TSR_DEFAULT, CAM_DEFAULT, HUD_CRUISE_DEFAULT, ORDER_DEFAULT, SIGN_NONE, MAX_LINES,
};
