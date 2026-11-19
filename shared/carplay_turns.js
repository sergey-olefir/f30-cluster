'use strict';
/**
 * carplay_turns.js - CarPlay's (and Android Auto's) next turn as DATA (car issues CT, the owner's approval of 2026-11-19).
 *
 * With a phone route BMW's own guidance stays INACTIVE and Guidance.conclusiveDart is empty (car, 2026-11-18), but the phone's
 * manoeuvres are listed by the guidance engine's event list: de.bmw.infotainment.navigation.guiding.GuidanceEventList (service
 * 0xFB1B, major 5, instance Main_Instance = 128 in the car's catalogue of 2026-11-15). There is no notifier for them without a view
 * of one's own (viewsChanged stays silent), so the list is ASKED: the method queryContent (methodId 4), stateless - one view
 * configuration in the call, the HMI's own views untouched.
 *
 * THE ONE METHOD CALL. The owner approved queryContent only, a read. Never setViewConfig, setViewportConfig, the registeredViews
 * setter, any other method, or a method of any other interface. This file is the only place our apps call it (bench tests check
 * that); the apps declare it as  "GuidanceEventList": { "_instances": "Main_Instance", "_methods": ["queryContent"] }  and nothing
 * else on that interface for it (tools/signals/check_signals.py checks the method id). Whether the car's ACL lets an OAP app call it
 * is UNKNOWN: the first call's outcome (answered / the error text / a timeout) is logged, nothing ever throws, and a failure is
 * never retried faster than the poll.
 *
 *   const T = require('./carplay_turns');
 *   T.request()              the call's argument: { viewConfigs: [ GuidanceEventListConfig ] } built from the catalogue's types
 *   T.decode(reply)          { ok, error, views, total, events: [event...], more, distances } (events: the first MAX_EVENTS)
 *   T.nextTurn(decoded)      the first way-ahead event with a distance, or null
 *   T.isPhone(provider)      Guidance.guidingProvider is CAR_PLAY or ANDROID_AUTO (a name or the catalogue's number)
 *   new T.Poller({ signals, now, log, wanted, proxy, onReply, onFail })   .tick(now) / .stop() / .stats()
 *
 * The poll (the owner's rules): only while wanted() (the app's feature is on AND the phone guides), one call in flight, every
 * POLL_MS (2 s), the binding's timeout TIMEOUT_MS (3 s); after SLOW_AFTER failures in a row every SLOW_MS (10 s); it stops when
 * wanted() goes false. The reply's shape is the binding's: a union arrives keyed by its member ({ intersection: {...} }), enums by
 * name (a number is read too), Int64 / UInt64 as a digit string (precedent: the public MGU app "Redline", cauliflowermossgrape/
 * idrive7-apps, logged this shape from queryContent on a G21 with CarPlay on 2026-11-09; its code is not used here).
 *
 * The phone's rawDistance is NOT the distance (Apple Maps sends 1, Turn View's notes and the G21 log): the distance is the text
 * formattedDistance.distance ("250", "1,2") in formattedDistance.unit; the event after the next one comes with unit NONE.
 *
 * Privacy: an event keeps its road / instruction text (`road`) for the cluster page to DRAW; nothing here logs, and the probe prints
 * texts as lengths only. Road links (coordinates) and source ids are never read. Plain Node 8 (the car's 8.16): no ?. / ?? /
 * object spread / optional catch binding.
 */

const IFACE = 'de.bmw.infotainment.navigation.guiding.GuidanceEventList';
const INSTANCE = 'Main_Instance';
const METHOD = 'queryContent';
const GUIDANCE = 'de.bmw.infotainment.navigation.guiding.Guidance';

const POLL_MS = 2000;           // one call every 2 s while wanted (the owner)
const TIMEOUT_MS = 3000;        // the binding's timeout of one call (the owner)
const GUARD_MS = 500;           // our own guard on top: "timeout" is noted this long after the binding's should have fired
const STUCK_MS = 15000;         // a call that has not settled after this is logged once (the next waits for it: one in flight)
const SLOW_AFTER = 5;           // failures in a row ...
const SLOW_MS = 10000;          // ... then one call every 10 s (never faster than the poll)
const FRESH_MS = 6000;          // a turn older than this is no turn (the cluster page falls back to the CarPlay route page)
const MAX_EVENTS = 4;           // the view's size: maxElementCount, and the events the probe prints

const isNum = (x) => typeof x === 'number' && isFinite(x);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/* ---------------------------------------------------------------- the catalogue's names -------------------------- */

// enum members by number (the catalogue of 2026-11-15, navigation.GuidingTypes / CommonTypes): an enum may arrive as its number
const ENUMS = {
    TurnDirection: ['NONE', 'STRAIGHT_ON', 'LEFT', 'SLIGHT_LEFT', 'HARD_LEFT', 'RIGHT', 'SLIGHT_RIGHT', 'HARD_RIGHT', 'UTURN_RIGHT', 'UTURN_LEFT'],
    BranchType: [null, 'BRANCH_LEFT', 'BRANCH_RIGHT', 'HIGHWAY_IN_LEFT', 'HIGHWAY_IN_RIGHT', 'HIGHWAY_IN_STRAIGHT', 'HIGHWAY_OUT_LEFT', 'HIGHWAY_OUT_RIGHT',
        'HIGHWAY_OUT_STRAIGHT', 'FORK_LEFT', 'FORK_RIGHT', 'TRIPLE_FORK_LEFT', 'TRIPLE_FORK_RIGHT', 'TRIPLE_FORK_STRAIGHT', 'OVERPASS', 'UNDERPASS'],
    Side: [null, 'LEFT', 'RIGHT'],
    DestinationPosition: [null, 'LEFT', 'CENTER', 'RIGHT', 'NOT_DIGITIZED'],
    MainRoadDirection: ['LEFT', 'RIGHT'],
    DistanceUnit: ['NONE', 'KM', 'MILE_UK', 'MILE_US', 'METER', 'YARD', 'FEET'],
    GuidanceEventListError: ['NO_ERROR', 'UNKNOWN_VIEW_ID', 'INVALID_VIEW_PARAMS'],
    GuidingStep: ['GS0', 'GS1', 'GS2', 'GS31', 'GS32'],
    Provider: ['NONE', 'CAR_PLAY', 'ANDROID_AUTO', 'CAR_LIFE', 'OTHER'],         // GuidingTypes.ProjectedModeGuidingProvider
};
/** An enum as its NAME: a name passes when it is an upper-case identifier, a number is looked up; anything else null. */
function enumName(raw, kind) {
    if (typeof raw === 'string') return /^[A-Z][A-Z0-9_]{0,63}$/.test(raw) ? raw : null;
    const names = ENUMS[kind] || [];
    if (isNum(raw) && raw >= 0 && raw < names.length && Math.floor(raw) === raw) return names[raw] || null;
    return null;
}

// the 22 members of GuidanceEventUnion, in the catalogue's order
const KINDS = ['pointOfInterest', 'intersection', 'tunnel', 'branch', 'roundabout', 'destinationManeuver', 'placeholderElement', 'laneGuiding', 'trafficEvent',
    'trafficFlowItem', 'routeSegmentItem', 'laneChange', 'tollgate', 'border', 'vehicleTransportation', 'passiveManeuver', 'speedLimitAssist', 'speedCamera',
    'speedSectionCamera', 'dangerousCurve', 'schoolZone', 'alongMainRoad'];
// the way ahead: an event of one of these kinds with a distance is a turn the cluster can draw (a tunnel, a camera, a POI, the
// loading placeholder ... is not: it never stands in for the turn after it)
const TURN_KINDS = ['intersection', 'branch', 'roundabout', 'destinationManeuver', 'alongMainRoad', 'laneChange'];

/** Guidance.guidingProvider as a name (NONE, CAR_PLAY, ...), or null. */
function providerName(v) {
    const raw = isNum(v) || typeof v === 'string' ? v : isObj(v) ? v.guidingProvider : undefined;
    return enumName(raw, 'Provider');
}
/** The phone guides: CAR_PLAY or ANDROID_AUTO. */
function isPhone(v) { const n = providerName(v); return n === 'CAR_PLAY' || n === 'ANDROID_AUTO'; }

/* ---------------------------------------------------------------- the request ------------------------------------ */

/**
 * queryContent's argument (its one input, viewConfigs: GuidanceEventListConfig[]): one view from the car's position (the anchor
 * union's member standardReferencePoint = CCP), no offsets, at most MAX_EVENTS events, no end points, the active manoeuvres, the
 * destinations, the tunnels and "along the main road"; no options, no minimum update interval, no segment raster. A new object
 * each time (the binding may keep or change what it is given).
 */
function request() {
    return {
        viewConfigs: [{
            viewport: {
                startPoint: { anchorPoint: { standardReferencePoint: 'CCP' }, offsets: [] },
                maxElementCount: MAX_EVENTS,
                endPoints: [],
                includedTypes: ['INCLUDE_ACTIVE_MANEUVERS', 'INCLUDE_DESTINATIONS', 'INCLUDE_TUNNELS', 'INCLUDE_ALONG_MAIN_ROAD'],
            },
            options: [],
            minimumUpdateIntervalMs: 0,
            segmentItemRasterLength: 0,
        }],
    };
}

/* ---------------------------------------------------------------- the reply -------------------------------------- */

/** A GuidanceEventUnion -> { kind, body }: { member: {...} } (the binding's shape: one known member holding an object) or
 *  { type, value } (a decoder of the raw wire); null for anything else. */
function unionOf(e) {
    if (!isObj(e)) return null;
    if (typeof e.type === 'string' && KINDS.indexOf(e.type) >= 0 && isObj(e.value)) return { kind: e.type, body: e.value };
    const keys = Object.keys(e).filter((k) => KINDS.indexOf(k) >= 0 && isObj(e[k]));
    return keys.length === 1 ? { kind: keys[0], body: e[keys[0]] } : null;
}

const TO_M = { METER: 1, KM: 1000, FEET: 0.3048, YARD: 0.9144, MILE_UK: 1609.344, MILE_US: 1609.344 };
/**
 * A FormattedDistance -> { text, num, unit, metres }: text = the phone's text (or null; kept for its LENGTH in a log), num = its
 * number with a "." as the decimal mark ("1,2" -> "1.2"; "1,234" with three digits after the comma is a thousands mark -> "1234"),
 * or null when the text does not start with a number; unit = the unit's name; metres = num in metres, or null (no number, unit NONE
 * or unknown). The text may carry the unit too ("250 m"): only its leading number is read.
 */
function distOf(fd) {
    const out = { text: null, num: null, unit: null, metres: null };
    if (!isObj(fd)) return out;
    out.text = typeof fd.distance === 'string' ? fd.distance : isNum(fd.distance) ? String(fd.distance) : null;
    out.unit = enumName(fd.unit, 'DistanceUnit');
    const m = out.text === null ? null : /^\s*(\d{1,6})(?:([.,])(\d{1,3}))?(?!\d)/.exec(out.text);
    if (m) {
        if (m[3] === undefined) out.num = String(Number(m[1]));
        else if (m[3].length === 3 && m[2] === ',') out.num = String(Number(m[1] + m[3]));
        else out.num = String(Number(m[1])) + '.' + m[3];
    }
    if (out.num !== null && TO_M[out.unit]) out.metres = Number(out.num) * TO_M[out.unit];
    return out;
}

/** A Description's text pieces joined (drawn on the cluster, never logged), and how many text elements / characters it has. */
function textOf(desc) {
    const els = isObj(desc) && Array.isArray(desc.elements) ? desc.elements : [];
    const parts = [];
    els.forEach((x) => {
        if (!isObj(x)) return;
        if (typeof x.text === 'string') parts.push(x.text);
        else if (x.type === 'text' && typeof x.value === 'string') parts.push(x.value);     // a raw decoder's union
    });
    const road = parts.join(' ').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    return { road: road || null, elements: els.length, chars: parts.reduce((n, s) => n + s.length, 0) };
}

/** An id of any shape the binding may hand a UInt64 over in: 'set' (non-zero), 'zero', or null (none / unreadable). Never the id. */
function uidState(v) {
    if (v === undefined || v === null) return null;
    if (isNum(v)) return v !== 0 ? 'set' : 'zero';
    if (typeof v === 'string') return /^\s*0*\s*$/.test(v) ? 'zero' : /^\s*\d+\s*$/.test(v) ? 'set' : null;
    if (isObj(v) && isNum(v.low) && isNum(v.high)) return v.low || v.high ? 'set' : 'zero';
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) { for (let i = 0; i < v.length; i++) if (v[i]) return 'set'; return 'zero'; }
    return null;
}

/**
 * One event of the list: its kind and what the arrow needs, the distance, and the numbers the probe prints. `body` and `road` are
 * kept for the cluster page (the arrow's pictogram is chosen from the body; the road is drawn) and NEVER printed.
 */
function eventOf(e) {
    const u = unionOf(e);
    if (!u) return { kind: null };
    const b = u.body, d = distOf(b.formattedDistance), t = textOf(b.description);
    const ev = {
        kind: u.kind, dist: d, raw: isNum(b.formattedDistance && b.formattedDistance.rawDistance) ? b.formattedDistance.rawDistance : null,
        uid: uidState(b.uid), toDest: isNum(b.distanceToDestination) ? b.distanceToDestination : null, step: enumName(b.guidingStep, 'GuidingStep'),
        unreliable: b.unreliable === true, road: t.road, descElements: t.elements, descChars: t.chars, body: b,
        dir: null, geometry: null, branch: null, exit: null, angle: null, side: null, position: null, flag: null, stopover: null, mainDir: null, length: null,
    };
    if (u.kind === 'intersection') { ev.dir = enumName(b.direction, 'TurnDirection'); ev.geometry = typeof b.detailedGeometry === 'string' ? enumName(b.detailedGeometry) : isNum(b.detailedGeometry) ? b.detailedGeometry : null; }
    else if (u.kind === 'branch') { ev.branch = enumName(b.branchType, 'BranchType'); ev.geometry = typeof b.detailedGeometry === 'string' ? enumName(b.detailedGeometry) : isNum(b.detailedGeometry) ? b.detailedGeometry : null; }
    else if (u.kind === 'roundabout') {
        // UInt8 / UInt16: an exit of 0 or above 99, an angle outside one turn, is no value
        ev.exit = isNum(b.exitNumber) && b.exitNumber >= 1 && b.exitNumber <= 99 ? Math.round(b.exitNumber) : null;
        ev.angle = isNum(b.exitAngle) && b.exitAngle >= 0 && b.exitAngle <= 360 ? b.exitAngle : null;
        ev.side = enumName(b.driveDirection, 'Side');
    } else if (u.kind === 'destinationManeuver') {
        ev.position = enumName(b.position, 'DestinationPosition'); ev.flag = typeof b.isCheckeredFlag === 'boolean' ? b.isCheckeredFlag : null;
        ev.stopover = isNum(b.stopOverNumber) ? b.stopOverNumber : null;
    } else if (u.kind === 'alongMainRoad') ev.mainDir = enumName(b.mainRoadDirection, 'MainRoadDirection');
    else if (u.kind === 'laneChange') ev.side = enumName(b.changeSide, 'Side');
    else if (u.kind === 'tunnel') ev.length = isNum(b.length) ? b.length : null;
    return ev;
}

/**
 * A queryContent reply ({ GuidanceEventListError, viewContent: ViewContent[], currentDistances }) -> { ok, error, views, total,
 * count, events (the first MAX_EVENTS of view 0), more, distances }. ok false: an error reply, no reply or no view (the turn is then
 * not known; not the same as "no turn ahead").
 */
function decode(reply) {
    const out = { ok: false, error: null, views: 0, total: null, count: 0, events: [], more: 0, distances: null };
    if (!isObj(reply)) { out.error = reply === undefined || reply === null ? 'no reply' : 'not a struct'; return out; }
    const errRaw = reply.GuidanceEventListError !== undefined ? reply.GuidanceEventListError : reply.GenericListError;
    out.error = errRaw === undefined ? null : enumName(errRaw, 'GuidanceEventListError') || (isNum(errRaw) ? String(errRaw) : '?');
    const d = isObj(reply.currentDistances) ? reply.currentDistances : null;
    if (d) out.distances = { toFinal: isNum(d.carDistanceToFinalDestination) ? d.carDistanceToFinalDestination : null, toNext: isNum(d.carDistanceToNextDestination) ? d.carDistanceToNextDestination : null };
    const vc = Array.isArray(reply.viewContent) ? reply.viewContent : null;
    out.views = vc ? vc.length : 0;
    if (out.error !== null && out.error !== 'NO_ERROR') return out;
    const v = vc && isObj(vc[0]) ? vc[0] : null;
    const evs = v && Array.isArray(v.eventsInView) ? v.eventsInView : null;
    if (!evs) { out.error = 'no view'; return out; }
    out.ok = true;
    if (isObj(v.indexedPosition) && isNum(v.indexedPosition.totalElementCount)) out.total = v.indexedPosition.totalElementCount;
    out.count = evs.length;
    out.events = evs.slice(0, MAX_EVENTS).map(eventOf);
    out.more = Math.max(0, evs.length - MAX_EVENTS);
    return out;
}

/** The index (in decoded.events) of the next turn: the first event of a turn kind whose distance reads in metres; -1 for none. */
function nextIndex(decoded) {
    if (!decoded || !decoded.ok) return -1;
    for (let i = 0; i < decoded.events.length; i++) {
        const e = decoded.events[i];
        if (TURN_KINDS.indexOf(e.kind) >= 0 && e.dist && e.dist.metres !== null) return i;
    }
    return -1;
}
/** The next turn (an event of decode()), or null. */
function nextTurn(decoded) { const i = nextIndex(decoded); return i < 0 ? null : decoded.events[i]; }

/* ---------------------------------------------------------------- the poll --------------------------------------- */

const msgOf = (e) => String(e && e.message || e).replace(/[^\x20-\x7e]/g, '?').slice(0, 120);
const isTimeout = (s) => /time[ -]?out|timed out|no answer/i.test(s);

/**
 * The poll of queryContent. o:
 *   signals   the kit's ctx.signals (proxy, call)
 *   now       () => ms (default Date.now)
 *   log       (line) => void: the outcome of the first call, every change of outcome, on / off (no text of the car's ever)
 *   wanted    () => bool: the feature is on and the phone guides
 *   proxy     optional () => proxy | null | undefined: a proxy already there (the probe's watch of the same interface);
 *             undefined = not ready yet (skip this tick), null = none (ask signals.proxy for one)
 *   onReply   (reply, decoded, t) => void;  onFail (kind 'error' | 'timeout' | 'proxy', text, t) => void
 * tick(now) is called often (the app's own clock); it starts a call when one is due. Nothing here throws.
 */
class Poller {
    constructor(o) {
        o = o || {};
        this.signals = o.signals || null;
        this.now = typeof o.now === 'function' ? o.now : Date.now;
        this.logFn = typeof o.log === 'function' ? o.log : () => {};
        this.wanted = typeof o.wanted === 'function' ? o.wanted : () => false;
        this.proxyOf = typeof o.proxy === 'function' ? o.proxy : null;
        this.onReply = typeof o.onReply === 'function' ? o.onReply : () => {};
        this.onFail = typeof o.onFail === 'function' ? o.onFail : () => {};
        this.on = false;
        this.inFlight = false; this.callAt = -Infinity; this.lastAt = -Infinity; this.gen = 0;
        this.proxy = null; this.proxyAsking = false;
        this.fails = 0;
        this.n = { calls: 0, answered: 0, errors: 0, timeouts: 0 };
        this.outcome = null;            // the last outcome's key ("answered", "error: <text>", "timeout", "proxy: <text>")
        this.stuckSaid = false;
    }
    _log(s) { try { this.logFn(s); } catch (e) { /* a failing log: nothing to do */ } }
    _guard(fn) { try { return fn(); } catch (e) { return undefined; } }
    /** The interval to the next call: POLL_MS, or SLOW_MS after SLOW_AFTER failures in a row. */
    interval() { return this.fails >= SLOW_AFTER ? SLOW_MS : POLL_MS; }

    /** One step of the app's clock. Returns true when a call was started. */
    tick(now) {
        const t = isNum(now) ? now : this.now();
        let want = false;
        try { want = !!this.wanted(); } catch (e) { want = false; }
        if (!want) { if (this.on) this.stop('off'); return false; }
        if (!this.on) { this.on = true; this.fails = 0; this._log('carplay turns: on (every ' + POLL_MS / 1000 + ' s, timeout ' + TIMEOUT_MS / 1000 + ' s)'); }
        if (this.inFlight) {
            if (!this.stuckSaid && t - this.callAt >= STUCK_MS) { this.stuckSaid = true; this._log('carplay turns: a call has had no answer for ' + Math.round((t - this.callAt) / 1000) + ' s (the next waits for it)'); }
            return false;
        }
        if (t - this.lastAt < this.interval() && t >= this.lastAt) return false;
        return this._call(t);
    }

    _call(t) {
        const S = this.signals;
        if (!S || typeof S.call !== 'function') { this.lastAt = t; this._outcome('proxy', 'no signals.call', t); return false; }
        let p = this.proxy;
        if (!p && this.proxyOf) {
            p = this._guard(() => this.proxyOf());
            if (p === undefined) return false;          // the app's own proxy is still being made: next tick
        }
        if (!p) {
            if (this.proxyAsking) return false;
            if (typeof S.proxy !== 'function') { this.lastAt = t; this._outcome('proxy', 'no signals.proxy', t); return false; }
            this.proxyAsking = true; this.lastAt = t;
            const gen = this.gen;
            Promise.resolve().then(() => S.proxy(IFACE, INSTANCE)).then((px) => {
                this.proxyAsking = false;
                if (gen !== this.gen) return;
                if (!px) { this._outcome('proxy', 'no proxy', this.now()); return; }
                this.proxy = px; this.lastAt = -Infinity;        // the first call at the next tick
            }, (e) => { this.proxyAsking = false; if (gen === this.gen) this._outcome('proxy', msgOf(e), this.now()); }).catch(() => {});
            return false;
        }
        this.inFlight = true; this.callAt = t; this.lastAt = t; this.stuckSaid = false; this.n.calls++;
        const gen = this.gen;
        let settled = false, timedOut = false;
        const guard = setTimeout(() => {
            if (settled) return;
            timedOut = true;
            if (gen === this.gen) this._outcome('timeout', '', this.now());
        }, TIMEOUT_MS + GUARD_MS);
        if (guard && guard.unref) guard.unref();
        Promise.resolve().then(() => S.call(p, METHOD, request(), TIMEOUT_MS)).then((reply) => {
            settled = true; clearTimeout(guard); this.inFlight = false;
            if (gen !== this.gen || timedOut) return;
            this._answered(reply, this.now());
        }, (e) => {
            settled = true; clearTimeout(guard); this.inFlight = false;
            if (gen !== this.gen || timedOut) return;
            const m = msgOf(e);
            this._outcome(isTimeout(m) ? 'timeout' : 'error', m, this.now());
        }).catch(() => { this.inFlight = false; });
        return true;
    }

    _answered(reply, t) {
        const d = decode(reply);
        this.n.answered++;
        this.fails = d.ok ? 0 : this.fails + 1;
        const key = 'answered' + (d.ok ? '' : ' (' + d.error + ')');
        if (key !== this.outcome) {
            this._log('carplay turns: ' + (this.outcome === null ? 'first call: ' : 'now: ') + key + (d.ok ? ', ' + d.count + ' events' : '') + this._counts());
            this.outcome = key;
        } else this._slowNote();
        try { this.onReply(reply, d, t); } catch (e) { this._log('carplay turns: reply handler: ' + msgOf(e)); }
    }

    _outcome(kind, text, t) {
        this.fails++;
        if (kind === 'timeout') this.n.timeouts++; else this.n.errors++;
        const key = kind + (text ? ': ' + text : '');
        if (key !== this.outcome) {
            this._log('carplay turns: ' + (this.outcome === null ? 'first call: ' : 'now: ') + key + this._counts() + (this.fails >= SLOW_AFTER ? ' (every ' + SLOW_MS / 1000 + ' s now)' : ''));
            this.outcome = key;
        } else this._slowNote();
        try { this.onFail(kind, text, t); } catch (e) { this._log('carplay turns: fail handler: ' + msgOf(e)); }
    }
    /** The failure that makes the poll slow (the same outcome as before makes no line of its own): said once. */
    _slowNote() { if (this.fails === SLOW_AFTER) this._log('carplay turns: ' + SLOW_AFTER + ' failures in a row: one call every ' + SLOW_MS / 1000 + ' s now' + this._counts()); }
    _counts() { return ' (calls ' + this.n.calls + ', answered ' + this.n.answered + ', errors ' + this.n.errors + ', timeouts ' + this.n.timeouts + ')'; }

    /** Stop polling (the feature went off or the provider went back); a call still in flight is let run and its answer dropped. */
    stop(why) {
        if (!this.on) return;
        this.on = false; this.gen++; this.lastAt = -Infinity; this.fails = 0;
        this._log('carplay turns: off' + (why ? ' (' + why + ')' : '') + this._counts());
    }
    stats() { return { on: this.on, inFlight: this.inFlight, outcome: this.outcome, calls: this.n.calls, answered: this.n.answered, errors: this.n.errors, timeouts: this.n.timeouts }; }
}

module.exports = {
    IFACE, INSTANCE, METHOD, GUIDANCE, POLL_MS, TIMEOUT_MS, GUARD_MS, STUCK_MS, SLOW_AFTER, SLOW_MS, FRESH_MS, MAX_EVENTS, KINDS, TURN_KINDS, ENUMS,
    enumName, providerName, isPhone, request, unionOf, distOf, textOf, uidState, eventOf, decode, nextIndex, nextTurn, Poller,
};
