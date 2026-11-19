'use strict';
/**
 * format.js - the value formatters of the signal probe. Every one returns a SHORT token that can never carry free text:
 * numbers, enum names (capitals, digits, "_"), lengths, counts, booleans. Nothing here reads a text member as anything but its
 * length, a picture or a byte buffer as anything but its format and byte count, a frequency as anything but its band, a
 * contact / device identity as anything but known / unknown, a heading as anything but present.
 *
 * Unified from the five round-3 branches' shared/twin_probe.js (main's P1..P12, SM's media, SP's telephony, SN's guidance,
 * SV's assistance and technical fields, SB's buttons); the privacy decisions of CP-REPORT section 4 are applied here.
 * Node 8.16 is what the car runs: no ?. or ??, no object spread, no optional catch binding.
 */

const MAX_ENTRIES = 24;             // list entries per line, then "+N more"

const isNum = (x) => typeof x === 'number' && isFinite(x);
const none = (x) => x === undefined || x === null;

/** A number (a bigint too), or "-" for none. A string never gets through: "?". */
function fNum(x) {
    if (isNum(x)) return Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000);
    if (typeof x === 'bigint') return String(x).length <= 24 ? String(x) : '?';
    return none(x) ? '-' : '?';
}
/** An enum: its wire number or its NAME (an upper-case identifier, a leading "_" too: FASuS "_80"), else "?". */
function fEnum(x) {
    if (isNum(x)) return String(x);
    if (typeof x === 'string' && /^[A-Z_][A-Z0-9_]{0,95}$/.test(x)) return x;
    return none(x) ? '-' : '?';
}
function fBool(x) {
    if (typeof x === 'boolean') return String(x);
    if (x === 0 || x === 1) return String(x === 1);
    return none(x) ? '-' : '?';
}
/** A bitfield: decimal and hex. */
function fHex(x) {
    if (isNum(x) && Number.isInteger(x) && x >= 0) return x ? x + '(0x' + x.toString(16) + ')' : '0';
    return fNum(x);
}
/** The LENGTH of a text (or of a byte buffer / array), never its content. */
function fLen(x) {
    if (typeof x === 'string') return String(x.length);
    if (x && typeof x === 'object' && isNum(x.length)) return String(x.length);
    return none(x) ? '-' : '?';
}
/** A number rounded to the nearest 100 raw units: enough to read a height's scale, not a place. */
function fCoarse(x) {
    if (isNum(x)) return String(Math.round(x / 100) * 100) + '~';
    return none(x) ? '-' : '?';
}
/** Known or unknown: an identity number (a contact, a device) is never printed, only whether it is set (non-zero). */
function fKnown(x) {
    if (isNum(x)) return x !== 0 ? 'known' : 'unknown';
    return none(x) ? '-' : '?';
}
/** Present or not: a bearing is never printed, only that the car sent one. */
function fPresent(x) {
    if (isNum(x)) return 'set';
    return none(x) ? '-' : '?';
}
const KIND = { n: fNum, e: fEnum, b: fBool, x: fHex, t: fLen, k: fCoarse, z: fKnown, p: fPresent };

/** v[path[0]][path[1]]... or undefined (a path is an array, or one key; [] is the value itself). */
function dig(v, path) {
    let cur = v;
    const p = Array.isArray(path) ? path : [path];
    for (let i = 0; i < p.length; i++) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = cur[p[i]];
    }
    return cur;
}
/** "label=value label=value ..." from cols [[label, path, kind], ...]; a path [] is the value itself. */
function cols(v, cs) {
    return cs.map((c) => c[0] + '=' + KIND[c[2]](Array.isArray(c[1]) && !c[1].length ? v : dig(v, c[1]))).join(' ');
}
const notA = (what, v) => 'not ' + what + ' (' + (v === null ? 'null' : typeof v) + ')';

/** "entries=N [..] [..]" for a list field. spec: { member (the union member holding each entry, or null), cols }. */
function listLine(v, spec, label) {
    if (!Array.isArray(v)) return notA('a list', v);
    const one = (el) => {
        const e = spec.member && el && typeof el === 'object' && el[spec.member] && typeof el[spec.member] === 'object' ? el[spec.member] : el;
        return e && typeof e === 'object' ? '[' + cols(e, spec.cols) + ']' : '[?]';
    };
    return (label || 'entries') + '=' + v.length + (v.length ? ' ' + v.slice(0, MAX_ENTRIES).map(one).join(' ') : '') +
        (v.length > MAX_ENTRIES ? ' +' + (v.length - MAX_ENTRIES) + ' more' : '');
}
/** A single-member union (Telephone.registerState ...): the binding hands over { member: {...} } or the struct itself. */
function unionLine(v, spec) {
    const inner = v && typeof v === 'object' && v[spec.member] && typeof v[spec.member] === 'object';
    return 'shape=' + (inner ? 'member' : 'flat') + ' ' + cols(inner ? v[spec.member] : v, spec.cols);
}

// ---- bit changes of a raw byte (the stalk's operationColumnStalks): the previous value and which bits went up / down -----
/** "stalks=64(0x40) prev=0(0x0) up=0x40 down=0x0" for the number at `path`; st.prev holds the previous number. */
function fmtBits(v, spec, st) {
    const x = dig(v, spec.path);
    let out = spec.label + '=' + fHex(x);
    if (isNum(x) && Number.isInteger(x) && x >= 0) {
        const p = st.prevNum;
        if (isNum(p)) {
            const up = x & ~p, down = p & ~x;      // bit operators work on 32 bits: the byte is 8
            out += ' prev=' + fHex(p) + ' up=0x' + (up >>> 0).toString(16) + ' down=0x' + (down >>> 0).toString(16);
        } else out += ' prev=-';
        st.prevNum = x;
    } else out += ' prev=' + (isNum(st.prevNum) ? fHex(st.prevNum) : '-');
    return out;
}

// ---- P1 / P2 / P17: the check-control and service lists -----------------------------------------------------------------
/** KombiInterface_2.cbsDataServiceList: a union of two structs per entry; names, ways and dates only as lengths. */
function fmtCbs(v) {
    if (!Array.isArray(v)) return notA('a list', v);
    const one = (el) => {
        if (!el || typeof el !== 'object') return '[?]';
        const sym = el.cBSDataServiceWithSymbolID && typeof el.cBSDataServiceWithSymbolID === 'object' ? el.cBSDataServiceWithSymbolID : null;
        const s = sym ? sym.cBSDataService : el.cBSDataServiceStruct;
        if (!s || typeof s !== 'object') return '[?]';
        return '[' + (sym ? 'sym ' : 'plain ') + cols(s, [['id', 'cBSIdentifier', 'n'], ['colour', 'cBSColor', 'e'], ['name-len', 'cBSServcieName', 't'],
            ['way-len', 'cBSServiceWay', 't'], ['date-len', 'cBSServiceDate', 't'], ['year', 'yearCBSDisplay', 'n'], ['month', 'monthCBSDisplay', 'n']]) +
            (sym ? ' ' + cols(sym, [['symbol', 'cBSListSymbolID', 'n'], ['avail', 'cBSAvail', 'n'], ['count', 'cBSServCount', 'n'], ['day', 'dayCBSDisplay', 'n']]) : '') + ']';
    };
    return 'entries=' + v.length + (v.length ? ' ' + v.slice(0, MAX_ENTRIES).map(one).join(' ') : '') +
        (v.length > MAX_ENTRIES ? ' +' + (v.length - MAX_ENTRIES) + ' more' : '');
}

// ---- P6, P12: temperatures, the next manoeuvre ---------------------------------------------------------------------------
function fmtTemps(v) {
    const one = (label, raw) => {
        const s = fNum(raw);
        const c = isNum(raw) && raw >= 0 && raw < 255 ? ' (' + (raw - 48) + ' C)' : '';
        return label + '=' + s + c;
    };
    return one('coolant-raw', dig(v, 'temperatureEngineDrive')) + ' ' + one('oil-raw', dig(v, 'temperatureEngineOilDrive'));
}
/** The elements of a road description / manoeuvre text: which kind, a text's LENGTH only. */
function elementsLine(els) {
    return els.slice(0, MAX_ENTRIES).map((el) => {
        if (!el || typeof el !== 'object') return '[?]';
        if (!none(el.text)) return '[text len=' + fLen(el.text) + ']';
        if (!none(el.spacer)) return '[spacer=' + fEnum(el.spacer) + ']';
        if (el.icon && typeof el.icon === 'object') return '[icon text-len=' + fLen(el.icon.text) + ']';
        return '[?]';
    }).join(' ');
}
/** Guidance.nextIntersection: how many elements of which kind, a text's LENGTH only. Measures its own parse time. */
function fmtIntersection(v, st) {
    const t0 = process.hrtime();
    let out;
    if (!v || typeof v !== 'object') out = notA('a struct', v);
    else {
        const els = dig(v, ['intersection', 'elements']);
        const icons = dig(v, 'serviceIcons');
        out = 'elements=' + (Array.isArray(els) ? els.length : '-') + ' ' + (Array.isArray(els) ? elementsLine(els) : '[not a list]') +
            ' serviceIcons=' + (Array.isArray(icons) ? icons.length : '-') +
            ' distance-len=' + fLen(dig(v, ['distance', 'distance'])) + ' unit=' + fEnum(dig(v, ['distance', 'unit'])) +
            ' raw=' + fNum(dig(v, ['distance', 'rawDistance']));
    }
    const d = process.hrtime(t0), us = d[0] * 1e6 + Math.round(d[1] / 1000);
    st.parseUs = Math.max(st.parseUs || 0, us);
    return out + ' parse<=' + (Math.ceil(st.parseUs / 10) / 100) + 'ms';
}
/** A road description (Guidance.currentRoad): the kinds of its elements, a text's LENGTH only. */
function fmtDescription(v) {
    if (!v || typeof v !== 'object') return notA('a struct', v);
    const els = dig(v, 'elements');
    if (!Array.isArray(els)) return 'elements=-';
    return 'elements=' + els.length + (els.length ? ' ' : '') + elementsLine(els);
}
/**
 * The turn arrow (Guidance.conclusiveDart): which manoeuvre, its direction / geometry / exit, its distance as a number and a
 * text length, its guiding step. NEVER its road links (coordinates), its description text or its time stamp's date.
 */
const DART_KINDS = ['intersection', 'branch', 'roundabout', 'destinationManeuver', 'tunnel', 'laneChange', 'passiveManeuver',
    'tollgate', 'border', 'vehicleTransportation', 'pointOfInterest', 'laneGuiding', 'trafficEvent', 'trafficFlowItem', 'routeSegmentItem',
    'placeholderElement', 'speedLimitAssist', 'speedCamera', 'speedSectionCamera', 'dangerousCurve', 'schoolZone', 'alongMainRoad'];
function fmtDart(v) {
    if (!v || typeof v !== 'object') return notA('a struct', v);
    const m = v.maneuver && typeof v.maneuver === 'object' ? v.maneuver : null;
    const x = eventParts(m);
    return 'kind=' + (x.kind || (m ? '?' : '-')) + ' bar=' + fNum(v.bargraphProgress) + x.details;
}
/**
 * One guidance event (a GuidanceEventUnion: the manoeuvre of conclusiveDart, an entry of an event list, the event a rendered
 * guidance box shows): { kind, details }, details = " direction=... dist-len=... raw=... step=..." (enums and numbers only).
 * NEVER its road links (coordinates), its description text (only how many elements) or a time stamp.
 */
function eventParts(m) {
    const kind = m && typeof m === 'object' ? DART_KINDS.filter((k) => m[k] !== undefined && m[k] !== null)[0] : undefined;
    const e = kind && typeof m[kind] === 'object' ? m[kind] : null;
    let out = '';
    if (e) {
        if (kind === 'intersection') out += ' direction=' + fEnum(e.direction) + ' geometry=' + fEnum(e.detailedGeometry);
        if (kind === 'branch') out += ' branch=' + fEnum(e.branchType) + ' geometry=' + fEnum(e.detailedGeometry);
        if (kind === 'roundabout') out += ' exit=' + fNum(e.exitNumber) + ' angle=' + fNum(e.exitAngle) + ' side=' + fEnum(e.driveDirection);
        if (kind === 'destinationManeuver') out += ' position=' + fEnum(e.position) + ' flag=' + fBool(e.isCheckeredFlag) + ' stopover=' + fNum(e.stopOverNumber);
        if (kind === 'laneChange') out += ' side=' + fEnum(e.changeSide);
        const de = dig(e, ['description', 'elements']);
        out += ' dist-len=' + fLen(dig(e, ['formattedDistance', 'distance'])) + ' unit=' + fEnum(dig(e, ['formattedDistance', 'unit'])) +
            ' raw=' + fNum(dig(e, ['formattedDistance', 'rawDistance'])) + ' step=' + fEnum(e.guidingStep) + ' combined=' + fEnum(e.combinedManeuverType) +
            ' toDest=' + fNum(e.distanceToDestination) + ' unreliable=' + fBool(e.unreliable) + ' desc-elements=' + (Array.isArray(de) ? de.length : '-');
    }
    return { kind: kind, details: out };
}
const eventBrace = (m) => { const x = eventParts(m && typeof m === 'object' ? m : null); return '{' + (x.kind || (m ? '?' : '-')) + x.details + '}'; };

// ---- P25 (S16, car issues NV 2026-11-19): where the cluster's next turn comes from while CarPlay guides -----------------------
/**
 * A map as the binding may hand it over: a Map, an array of [key, value] / { key, value } / { first, second }, or a plain object
 * keyed by the map's keys. -> { shape, list: [[key, value], ...] }, or null. The keys of S16's maps are view names: only their LENGTH
 * is ever printed.
 */
function mapEntries(m) {
    if (m && typeof m === 'object' && !Array.isArray(m) && typeof m.forEach === 'function' && typeof m.get === 'function') {
        const l = [];
        m.forEach((v, k) => { l.push([k, v]); });
        return { shape: 'map', list: l };
    }
    if (Array.isArray(m)) {
        return { shape: 'pairs', list: m.map((e) => {
            if (Array.isArray(e) && e.length === 2) return [e[0], e[1]];
            if (e && typeof e === 'object' && ('key' in e || 'value' in e)) return [e.key, e.value];
            if (e && typeof e === 'object' && 'first' in e) return [e.first, e.second];
            return [undefined, e];
        }) };
    }
    if (m && typeof m === 'object' && !isBuf(m)) return { shape: 'object', list: Object.keys(m).map((k) => [k, m[k]]) };
    return null;
}
const VIEWS_MAX = 4, VIEW_EVENTS_MAX = 3;
/**
 * GuidanceEventList.viewsChanged ({ content: ViewsUpdate }): per registered view (the map's key = the view's name, as a LENGTH)
 * its sequence number, its indexed position, how many events it holds and the first three of them (kind, direction / exit /
 * branch, distance, guiding step); then the car's distances (to the final and the next destination, travelled). At most 4 views.
 */
function fmtViews(v) {
    const c = v && typeof v === 'object' && v.content && typeof v.content === 'object' ? v.content : v;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return notA('a struct', v);
    const views = mapEntries(c.viewsContent);
    const d = c.currentDistances && typeof c.currentDistances === 'object' ? c.currentDistances : {};
    let out = 'views=' + (views ? views.list.length + ' shape=' + views.shape : '-');
    if (views) {
        views.list.slice(0, VIEWS_MAX).forEach((kv) => {
            const vc = kv[1] && typeof kv[1] === 'object' ? kv[1] : {};
            const ip = vc.indexedPosition && typeof vc.indexedPosition === 'object' ? vc.indexedPosition : {};
            const evs = Array.isArray(vc.eventsInView) ? vc.eventsInView : null;
            out += ' [id-len=' + fLen(kv[0]) + ' seq=' + fNum(vc.configSequenceId) + ' valid=' + fBool(ip.valid) + ' offset=' + fNum(ip.ccpOffset) +
                ' total=' + fNum(ip.totalElementCount) + ' events=' + (evs ? evs.length : '-') +
                (evs ? evs.slice(0, VIEW_EVENTS_MAX).map((e) => ' ' + eventBrace(e)).join('') : '') +
                (evs && evs.length > VIEW_EVENTS_MAX ? ' +' + (evs.length - VIEW_EVENTS_MAX) + ' more' : '') + ']';
        });
        if (views.list.length > VIEWS_MAX) out += ' +' + (views.list.length - VIEWS_MAX) + ' more';
    }
    return out + ' toFinal=' + fNum(d.carDistanceToFinalDestination) + ' toNext=' + fNum(d.carDistanceToNextDestination) +
        ' travelled=' + fNum(d.travelledDistanceSinceTripStart) + ' sinceDest=' + fNum(d.travelledDistanceSinceLastDestination);
}
/**
 * GuidanceRenderedContent.viewContentChanged ({ viewId, viewContent }): which view (its name as a LENGTH), the RAMSES scene id (also
 * in hex, to compare with cluster-render's DCSM content ids), the occurrence and sequence numbers, the content type (HIGH_GUIDING,
 * JUNCTION_VIEW, ...) and its options, the bar graph, the label side, how many scene version tags, and the event it shows.
 */
function fmtRendered(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return notA('a struct', v);
    const c = v.viewContent && typeof v.viewContent === 'object' ? v.viewContent : v;
    const t = c.type && typeof c.type === 'object' ? c.type : {};
    return 'view-len=' + fLen(v.viewId) + ' scene=' + fHex(c.ramsesSceneId) + ' occurrence=' + fNum(c.occurrenceId) + ' seq=' + fNum(c.configSequenceId) +
        ' type=' + fEnum(t.contentType) + ' options=' + enumList(t.options) + ' bar=' + fNum(c.bargraphProgress) + ' labels=' + fEnum(c.miniLabelPlacement) +
        ' tags=' + (Array.isArray(c.sceneVersionTags) ? c.sceneVersionTags.length : '-') + ' event=' + eventBrace(c.associatedEvent);
}
/**
 * ProjectedModeGuiding.streamCommandChanged ({ streamCommand: union }): the guidance engine asking the projected mode (CarPlay) for
 * a video stream: request / resize / stop, the render size, the category rectangle and the safe area, in screen pixels.
 */
function fmtStream(v) {
    const u = v && typeof v === 'object' && v.streamCommand && typeof v.streamCommand === 'object' ? v.streamCommand : v;
    if (!u || typeof u !== 'object' || Array.isArray(u)) return notA('a struct', v);
    const kind = ['requestStream', 'resizeStream', 'stopStream'].filter((k) => u[k] !== undefined && u[k] !== null)[0];
    const cfg = kind && u[kind] && typeof u[kind] === 'object' && u[kind].config && typeof u[kind].config === 'object' ? u[kind].config : null;
    const rect = (r) => (r && typeof r === 'object' ? fNum(r.left) + ',' + fNum(r.top) + '+' + fNum(r.width) + 'x' + fNum(r.height) : '-');
    let out = 'command=' + (kind || '?');
    if (cfg) {
        const rs = cfg.renderSize && typeof cfg.renderSize === 'object' ? cfg.renderSize : {};
        const sa = cfg.safeArea && typeof cfg.safeArea === 'object' ? cfg.safeArea : {};
        const pts = sa.polygon && typeof sa.polygon === 'object' && Array.isArray(sa.polygon.pointList) ? sa.polygon.pointList : null;
        out += ' size=' + fNum(rs.horizontalSize) + 'x' + fNum(rs.verticalSize) + ' rect=' + rect(cfg.categoryRect) +
            ' safe=' + (sa.rect && typeof sa.rect === 'object' ? 'rect ' + rect(sa.rect) : pts ? 'polygon points=' + pts.length : '-');
    }
    return out;
}
/**
 * S16 next-turn (car issues CT): a queryContent reply as shared/carplay_turns.js decode() reads it (`d`; `next` = nextIndex(d)).
 * "answered events=N [..] x4" with, per event, its kind and what the arrow needs (direction / branch / exit and side / position and
 * flag / main-road direction / lane side / a tunnel's length), the phone's distance (its number when the text is a number, else the
 * text's LENGTH) and unit, rawDistance, whether a uid is set, the distance to the destination, the guiding step, the description as
 * element count and character count; then which event the cluster page would draw (next=), the car's two distances. Never a text,
 * a road link (coordinates) or a source id.
 */
function fmtTurns(d, next) {
    if (!d || typeof d !== 'object') return notA('a struct', d);
    if (!d.ok) return 'answered error=' + (d.error && /^[A-Za-z0-9_ ]{1,40}$/.test(d.error) ? d.error.replace(/ /g, '-') : '?') + ' views=' + fNum(d.views);
    const one = (e) => {
        if (!e || !e.kind) return '[?]';
        let s = '[' + e.kind;
        if (e.kind === 'intersection') s += ' direction=' + fEnum(e.dir) + ' geometry=' + fEnum(e.geometry);
        else if (e.kind === 'branch') s += ' branch=' + fEnum(e.branch) + ' geometry=' + fEnum(e.geometry);
        else if (e.kind === 'roundabout') s += ' exit=' + fNum(e.exit) + ' angle=' + fNum(e.angle) + ' side=' + fEnum(e.side);
        else if (e.kind === 'destinationManeuver') s += ' position=' + fEnum(e.position) + ' flag=' + fBool(e.flag) + ' stopover=' + fNum(e.stopover);
        else if (e.kind === 'alongMainRoad') s += ' main=' + fEnum(e.mainDir);
        else if (e.kind === 'laneChange') s += ' side=' + fEnum(e.side);
        else if (e.kind === 'tunnel') s += ' length=' + fNum(e.length);
        const di = e.dist || {};
        s += (di.num !== null && di.num !== undefined && /^\d{1,7}(\.\d{1,3})?$/.test(di.num) ? ' dist=' + di.num : ' dist-len=' + fLen(di.text)) + ' unit=' + fEnum(di.unit) +
            ' raw=' + fNum(e.raw) + ' uid=' + (e.uid === 'set' || e.uid === 'zero' ? e.uid : '-') + (isNum(e.toDest) ? ' toDest=' + fNum(e.toDest) : '') +
            ' step=' + fEnum(e.step) + (e.unreliable ? ' unreliable' : '') + ' desc=' + fNum(e.descElements) + '/' + fNum(e.descChars) + ']';
        return s;
    };
    const dist = d.distances || {};
    return 'answered events=' + d.count + (isNum(d.total) ? ' total=' + d.total : '') + (d.events.length ? ' ' + d.events.map(one).join(' ') : '') +
        (d.more ? ' +' + d.more + ' more' : '') + ' next=' + (isNum(next) && next >= 0 ? next : 'none') +
        ' toFinal=' + fNum(dist.toFinal) + ' toNext=' + fNum(dist.toNext);
}

/** Lane guidance (Guidance.currentLaneGuiding): per row the lanes as direction enums, '*' for a highlighted lane. */
function fmtLanes(v) {
    if (!v || typeof v !== 'object') return notA('a struct', v);
    const rows = Array.isArray(v.rows) ? v.rows : null;
    return 'rows=' + (rows ? rows.length : '-') + ' car=' + fNum(v.carPositionLaneIndex) + (rows && rows.length ? ' ' : '') +
        (rows || []).slice(0, 4).map((r) => {
            if (!r || typeof r !== 'object') return '[?]';
            const lanes = Array.isArray(r.lanes) ? r.lanes : [];
            return '[lanes=' + lanes.length + ' rec=' + fNum(r.recommendedCarPositionLaneIndex) + ' bar=' + fNum(r.bargraphProgress) + ' ' +
                lanes.slice(0, 12).map((l) => (l && typeof l === 'object' ? (l.isHighlighted === true ? '*' : '') + fEnum(l.directionToFollow) +
                    (l.additionalLaneInfo && l.additionalLaneInfo !== 'NONE' && l.additionalLaneInfo !== 0 ? '/' + fEnum(l.additionalLaneInfo) : '') : '?')).join(',') + ']';
        }).join(' ');
}

// ---- P8: media --------------------------------------------------------------------------------------------------------------
/** HmiMediaState.menu: which entry is selected and its icon kind (FM, USB, CARPLAY, ...); names only as lengths. */
function fmtMediaMenu(v) {
    if (!v || typeof v !== 'object') return notA('a struct', v);
    const es = Array.isArray(v.menuEntries) ? v.menuEntries : null;
    const sel = v.selectedEntryId;
    let selIcon = '-';
    if (es) es.forEach((e) => { if (e && typeof e === 'object' && !none(sel) && String(e.id) === String(sel)) selIcon = fEnum(e.iconKind); });
    return 'sink=' + fEnum(v.sink) + ' selected=' + fNum(sel) + ' selected-icon=' + selIcon + ' entries=' + (es ? es.length : '-') +
        (es && es.length ? ' ' + es.slice(0, MAX_ENTRIES).map((e) => (e && typeof e === 'object'
            ? '[' + fNum(e.id) + ' ' + fEnum(e.iconKind) + ' on=' + fBool(e.enabled) + ' name-len=' + fLen(e.name) +
              ' subs=' + (Array.isArray(e.subentries) ? e.subentries.length : '-') + ']' : '[?]')).join(' ') : '');
}
/** A frequency is never logged: only the band its value falls in (which also proves the unit is kHz). */
function fBand(x) {
    if (!isNum(x)) return none(x) ? '-' : '?';
    if (x === 0) return '0';
    if (x >= 87500 && x <= 108000) return 'fm-range';
    if (x >= 144 && x <= 30000) return 'am-range';
    if (x >= 174000 && x <= 240000) return 'dab-range';
    return 'other';
}
/** A picture buffer {format, data}: its format and byte count, never a byte of it. */
function fPic(p) {
    if (!p || typeof p !== 'object') return none(p) ? '-' : '?';
    return fEnum(p.format) + '/' + fLen(p.data);
}
/** TunerFmAmDab.currentStationFmDabAm: band, reception, list position, the text lengths, RT+ item kinds, picture sizes. */
function fmtStation(v) {
    if (!v || typeof v !== 'object') return notA('a struct', v);
    const s = v.stationListEntry && typeof v.stationListEntry === 'object' ? v.stationListEntry : {};
    const rtp = Array.isArray(v.radioTextPlusItemList) ? v.radioTextPlusItemList : null;
    const epg = Array.isArray(s.epgDayViewsList) ? s.epgDayViewsList : null;
    return 'band=' + fEnum(s.waveBand) + ' reception=' + fEnum(s.receptionMode) + ' freq=' + fBand(s.frequencyKhz) +
        ' pos=' + fNum(s.positionNumber) + ' current=' + fEnum(s.isCurrentSelectedStation) + ' fav=' + fEnum(s.isFavorite) +
        ' tp=' + fEnum(s.tp) + ' pty=' + fNum(s.pty) + ' short-len=' + fLen(s.stationShortName) + ' long-len=' + fLen(s.stationLongName) +
        ' artist-len=' + fLen(s.artistName) + ' title-len=' + fLen(s.titleName) + ' ens-len=' + fLen(v.dabEnsembleNameShort) +
        ' rt-len=' + fLen(v.radioTextName) + ' rtplus=' + (rtp ? rtp.length + (rtp.length ? ' ' + rtp.slice(0, 8).map((r) => (r && typeof r === 'object'
            ? '[' + fEnum(r.itemNumber) + ' len=' + fLen(r.contentTextName) + ']' : '[?]')).join('') : '') : '-') +
        ' epg-days=' + (epg ? epg.length : '-') + ' icon=' + fPic(s.stationIconPicture) + ' cover=' + fPic(s.albumCoverPicture) +
        ' slide=' + fPic(v.pictureSlideShow);
}
/** MediaPlayer.currentItemMetadata: which keys come; a number as itself, a text or an id only as its length. */
function fmtMetadata(v) {
    if (!Array.isArray(v)) return notA('a list', v);
    return 'keys=' + v.length + (v.length ? ' ' + v.slice(0, MAX_ENTRIES).map((m) => {
        if (!m || typeof m !== 'object') return '[?]';
        const val = m.value && typeof m.value === 'object' ? m.value : {};
        const body = !none(val.numeric) ? '=' + fNum(val.numeric) : !none(val.stringValue) ? ' len=' + fLen(val.stringValue)
            : !none(val.id) ? ' id-len=' + fLen(val.id) : ' -';
        return '[' + fEnum(m.key) + body + ']';
    }).join(' ') : '') + (v.length > MAX_ENTRIES ? ' +' + (v.length - MAX_ENTRIES) + ' more' : '');
}

// ---- P9: the phone --------------------------------------------------------------------------------------------------------
/** A list of enums (DevicePresentation roles / technologies): "A+B+C", at most 12, "-" for none. */
function enumList(v) {
    if (!Array.isArray(v)) return none(v) ? '-' : '?';
    if (!v.length) return 'none';
    return v.slice(0, 12).map(fEnum).join('+') + (v.length > 12 ? '+' + (v.length - 12) + 'more' : '');
}
function fmtRoles(v) {
    return Array.isArray(v) ? 'entries=' + v.length + ' roles=' + enumList(v) : notA('a list', v);
}
/** The paired / connected devices: numbers and enums; the device's own name as a LENGTH; its id as its list position only. */
function fmtDevices(v) {
    if (!Array.isArray(v)) return notA('a list', v);
    return 'entries=' + v.length + (v.length ? ' ' + v.slice(0, 8).map((d, i) => (d && typeof d === 'object'
        ? '[#' + i + ' connected=' + fBool(d.connected) + ' present=' + fBool(d.present) +
          ' battery=' + fNum(d.batteryState) + ' signal=' + fNum(d.signalStrength) + ' gsm=' + fNum(d.gsmStrength) +
          ' register=' + fEnum(d.registerState) + ' lock=' + fEnum(d.lockState) + ' personal=' + fBool(d.personalizedMode) +
          ' active=' + enumList(d.active) + ' connectedTech=' + enumList(d.connectedTechnologies) +
          ' caps=' + (Array.isArray(d.capabilities) ? d.capabilities.length : '-') + ' name-len=' + fLen(d.friendlyName) + ']'
        : '[?]')).join(' ') : '') + (v.length > 8 ? ' +' + (v.length - 8) + ' more' : '');
}
/**
 * The call list as COUNTS only: per type, how many with a contact, the largest repeat count; the type of the first and the
 * last entry (which end is the newest). Never a name, a number, a picture or a time stamp.
 */
function fmtCallList(v) {
    if (!Array.isArray(v)) return notA('a list', v);
    const n = { INCOMING: 0, OUTGOING: 0, MISSED: 0, other: 0 };
    const byNum = ['INCOMING', 'OUTGOING', 'MISSED'];
    let contact = 0, named = 0, maxCount = 0;
    const typeOf = (el) => {
        const t = el && typeof el === 'object' ? el.callType : undefined;
        const k = isNum(t) ? byNum[t] : t;
        return typeof k === 'string' && n[k] !== undefined && k !== 'other' ? k : 'other';
    };
    v.forEach((el) => {
        n[typeOf(el)]++;
        if (el && typeof el === 'object') {
            if (isNum(el.contactID) && el.contactID !== 0) contact++;
            if (typeof el.name === 'string' && el.name.length) named++;
            if (isNum(el.count) && el.count > maxCount) maxCount = el.count;
        }
    });
    return 'entries=' + v.length + ' incoming=' + n.INCOMING + ' outgoing=' + n.OUTGOING + ' missed=' + n.MISSED + ' other=' + n.other +
        ' with-contact=' + contact + ' with-name=' + named + ' max-count=' + maxCount +
        (v.length ? ' first=' + typeOf(v[0]) + ' last=' + typeOf(v[v.length - 1]) : '');
}

// ---- a whole value, generically (S14 / S15, the owner's request of 2026-11-19: every metric of the distance control, the camera's
//      objects and the car's own motion). Only for types with NO text member (bench/test-signal-probe.js checks every such field
//      against the catalogue), so an upper-case string can only be an enum name. Numbers, enum names and booleans are printed;
//      a buffer only as its length. Never printed: the end-to-end header (crc, data id, counters, alive counters, the top-level
//      length), dummies, every time stamp and sync value, and anything named like a coordinate on the globe; a field can name
//      more members to leave out (`skip`, e.g. the car's own dead-reckoned position or heading) and name prefixes to drop (`strip`). Arrays: the count, then at most
//      `entries` elements; the line stops at `max` characters ("+cut").
const TREE_SKIP = /^(crc\w*|dataID|counter\w*|alive\w*|aliv\w*|chl\w*|dummy\d*|\w*SyncCounter|\w*timestamp\w*|nanoseconds|seconds|sync_state|\w*TimeSync|\w*Nanoseconds|\w*Seconds|\w*SyncState|\w*latitude\w*|\w*longitude\w*|\w*wgs\w*)$/i;
const TREE_GENERIC = /^(x|y|z|mean|std_dev|stdDev|value|own|left|right|roll|pitch|yaw|distance|angle|availability|invalid_flags|invalidFlag|invalidFlags)$/;
const TREE_INVALID = /^(invalid_flags|invalidFlag|invalidFlags|\w+InvalidFlags)$/;
const TREE_MAX = 4000, TREE_ENTRIES = 8;
const isBuf = (x) => !!x && typeof x === 'object' && ((typeof Buffer !== 'undefined' && Buffer.isBuffer(x)) || ArrayBuffer.isView(x));
function fmtTree(v, opts) {
    const o = opts || {};
    const maxEntries = o.entries || TREE_ENTRIES, maxLen = o.max || TREE_MAX, skip = o.skip || [], strip = o.strip || [];
    const names = typeof o.enumNames === 'string' ? new RegExp(o.enumNames) : null;
    const short = (k) => { for (let i = 0; i < strip.length; i++) if (k.indexOf(strip[i]) === 0 && k.length > strip[i].length) return k.slice(strip[i].length); return k; };
    const out = [];
    let len = 0, cut = false;
    const push = (s) => {
        if (cut) return;
        if (len + s.length + 1 > maxLen) { cut = true; return; }
        out.push(s); len += s.length + 1;
    };
    const leaf = (name, x) => {
        if (typeof x === 'boolean') return name + '=' + fBool(x);
        if (typeof x === 'number' || typeof x === 'bigint') return name + '=' + fNum(x);
        // an enum name; `enumNames` (S16 ric-guidance: the remote cluster's enums are "Event_DisplaySwitchEvent", "Model_...") is a field's own
        // pattern for mixed-case enum names (the test checks it against every enum name the type can carry, and that it lets no free text in)
        if (typeof x === 'string') return /^[A-Z_][A-Z0-9_]{0,95}$/.test(x) || (names && x.length <= 96 && names.test(x)) ? name + '=' + x : name + '.len=' + x.length;
        if (isBuf(x)) return name + '.len=' + x.length;     // a buffer
        return none(x) ? name + '=-' : null;
    };
    const walk = (x, key, parent, depth) => {
        if (cut) return;
        const name = parent && TREE_GENERIC.test(key) ? short(parent) + '.' + key : short(key);
        if (Array.isArray(x)) {
            push(name + '=' + x.length);
            x.slice(0, maxEntries).forEach((el) => {
                if (cut) return;
                if (el === null || typeof el !== 'object' || isBuf(el)) { const l = leaf('', el); push('[' + (l === null ? '?' : l.slice(1)) + ']'); return; }
                const start = out.length;
                Object.keys(el).forEach((k) => { if (!TREE_SKIP.test(k) && skip.indexOf(k) < 0) walk(el[k], k, key, depth + 1); });
                if (out.length > start) { out[start] = '[' + out[start]; out[out.length - 1] += ']'; } else push('[]');
            });
            if (x.length > maxEntries) push('+' + (x.length - maxEntries) + ' more');
            return;
        }
        if (x !== null && typeof x === 'object' && !isBuf(x)) {
            if (depth > 8) { push(name + '={..}'); return; }
            Object.keys(x).forEach((k) => {
                if (TREE_SKIP.test(k) || skip.indexOf(k) >= 0 || (depth === 0 && k === 'length')) return;
                walk(x[k], k, key, depth + 1);
            });
            return;
        }
        if (TREE_INVALID.test(key) && !x) return;        // an invalid flag only when it is set
        const l = leaf(name, x);
        push(l === null ? name + '=?' : l);
    };
    if (v === null || typeof v !== 'object') { const l = leaf('value', v); return l === null ? 'value=?' : l; }
    walk(v, '', '', 0);
    return (out.length ? out.join(' ') : 'empty') + (cut ? ' +cut' : '');
}

module.exports = {
    MAX_ENTRIES, isNum, none, KIND, dig, cols, listLine, unionLine, notA,
    fNum, fEnum, fBool, fHex, fLen, fCoarse, fKnown, fPresent, fBand, fPic, enumList,
    fmtBits, fmtCbs, fmtTemps, fmtIntersection, fmtDescription, fmtDart, fmtLanes, fmtMediaMenu, fmtStation, fmtMetadata,
    fmtRoles, fmtDevices, fmtCallList, fmtTree, TREE_SKIP,
    eventParts, mapEntries, fmtViews, fmtRendered, fmtStream, fmtTurns,
};
