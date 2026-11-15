'use strict';
/**
 * fake-signs.js - the bench's stand-in for the three car signals the "bottom row" package reads
 * (docs/BOTTOM-ROW-PACKAGE.md): the speed-limit struct, the check-control message and the road label, plus the
 * guidance and position fields. The car has no stand-in for any of them, so this is the only way to see them.
 *
 *   const fake = require('./fake-signs').install(hu, spec.config, log);
 *   fake.control({ sign: {...} } | { cc: {...} } | { road: {...} } | { nav: {...} } | { scene: '<name>' });
 *   fake.state()            -> what was last fed, and the list of scenes (GET /probe "signs")
 *
 * It feeds RAW SOME/IP values through hu.feed, built from the shapes app.json config.sign / config.ccm /
 * config.road / config.onRoad / config.nav name, so the app's own parsers (shared/hud.js signOf / ccMsgOf / roadOf)
 * run exactly as they do on the car. Friendly values are turned back into the car's enum names or wire numbers by
 * looking them up in the config's own maps, so a map corrected for the car is still what the bench feeds.
 *
 * Driven by POST /fake (bench/server.js) and by bench/test-bottom-row.js. Never shipped; the car never sees it.
 */

/** { a: { b: v } } from ["a", "b"] and v ([] or none: v itself). */
function nest(path, v) {
    return (Array.isArray(path) ? path : []).slice().reverse().reduce((acc, k) => { const o = {}; o[k] = acc; return o; }, v);
}
/** Deep-merge b into a (plain objects only). */
function merge(a, b) {
    Object.keys(b || {}).forEach((k) => {
        if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) merge(a[k], b[k]);
        else a[k] = b[k];
    });
    return a;
}
/** The raw value a config map turns into `want` (its first key; a numeric key as a number), or `dflt`. */
function rawFor(map, want, dflt) {
    const keys = Object.keys(map || {});
    for (let i = 0; i < keys.length; i++) {
        if ((map[keys[i]] === null ? null : map[keys[i]]) === want) return /^-?\d+$/.test(keys[i]) ? Number(keys[i]) : keys[i];
    }
    return dflt;
}

// What the bench page and the test can ask for in one word. Each is just the same fields as the parts below.
const SCENES = {
    'limit-50': { sign: { state: 'limit', value: 50, unit: 'kmh' } },
    'limit-80-rain': { sign: { state: 'limit', value: 80, unit: 'kmh', supp: 'rain' } },
    'limit-130-warn1': { sign: { state: 'limit', value: 130, unit: 'kmh', warn: 1 } },
    'limit-30-warn2-school': { sign: { state: 'limit', value: 30, unit: 'kmh', warn: 2, supp: 'school' } },
    'limit-55-mph': { sign: { state: 'limit', value: 55, unit: 'mph', style: 'us' } },
    'limit-end': { sign: { state: 'end' } },
    'limit-unknown': { sign: { state: 'unknown' } },
    'limit-none': { sign: { state: 'none' } },
    'limit-invalid': { sign: { state: 'invalid' } },
    'nopass-car': { sign: { state: 'limit', value: 80, unit: 'kmh', np: 'car', npM: 1200 } },
    'nopass-truck': { sign: { state: 'limit', value: 60, unit: 'kmh', np: 'truck' } },
    'cc-red': { cc: { name: 'Engine malfunction', desc: 'Drive on with care. Have the vehicle checked.', color: 'red', symbol: 12 } },
    'cc-yellow': { cc: { name: 'Tyre pressure', desc: 'Check the tyre pressure.', color: 'yellow', symbol: 44 } },
    'cc-green': { cc: { name: 'Auto Start/Stop', desc: 'Engine stopped.', color: 'green', symbol: 7 } },
    'cc-orange': { cc: { name: 'Service due', desc: 'Service is due in 1 200 km.', color: 'orange', symbol: 9 } },
    'cc-white': { cc: { name: 'Driving mode', desc: 'Comfort.', color: 'white', symbol: 3 } },
    'cc-long': {
        cc: {
            name: 'Front passenger restraint system malfunction', color: 'red', symbol: 21, variant: 'symbol',
            desc: 'The front passenger airbag and belt tensioner may not work in an accident. Have the system checked by the nearest BMW Service. Drive on with care.',
        },
    },
    'cc-clear': { cc: { clear: true }, ccList: [], ccFrame: { frame: 0, of: 0, ids: [0, 0, 0] } },
    // the car cycles numbered frames (docs/G20-DESIGN-SPEC.md): no frame here, so ours runs its own clock
    'cc-three': {
        cc: { name: 'Tyre pressure', desc: 'Check the tyre pressure.', color: 'yellow', symbol: 44, id: 101 },
        ccList: [
            { name: 'Tyre pressure', color: 'yellow', id: 101 },
            { name: 'Washer fluid low', color: 'orange', id: 102 },
            { name: 'Engine malfunction', color: 'red', id: 103 },
        ],
        ccFrame: { frame: 0, of: 0, ids: [0, 0, 0] },
    },
    // the same three with the car saying which frame it is on: ours must follow it, not its own clock
    'cc-frame-2': {
        cc: { name: 'Tyre pressure', desc: 'Check the tyre pressure.', color: 'yellow', symbol: 44, id: 101 },
        ccList: [
            { name: 'Tyre pressure', color: 'yellow', id: 101 },
            { name: 'Washer fluid low', color: 'orange', id: 102 },
            { name: 'Engine malfunction', color: 'red', id: 103 },
        ],
        ccFrame: { frame: 2, of: 3, ids: [101, 102, 103] },
    },
    'clock-plus2': { clock: { minutes: 120, dst: false } },
    'clock-none': { clock: { minutes: null } },
    'road-street': { road: { text: 'Hauptstrasse' }, nav: { state: 'off' } },
    'road-shield': { road: { parts: [['icon', 'A 9'], ['spacer', 'SMALL'], ['text', 'Nuernberg']] }, nav: { state: 'off' } },
    'road-guiding': {
        road: { parts: [['text', 'B 2'], ['spacer', 'SLASH'], ['text', 'Ingolstaedter Strasse']], onRoad: true },
        nav: { state: 'on', dist: '12', unit: 'km', etaH: 14, etaM: 35, mins: 18, street: 'Ingolstaedter Strasse', city: 'Muenchen' },
    },
    'road-none': { road: { text: '', onRoad: false }, nav: { state: 'off' } },
    clear: { sign: { state: 'none' }, cc: { clear: true }, road: { text: '' }, nav: { state: 'off' } },
};

function install(hu, config, log) {
    const cfg = config || {};
    const last = { sign: null, cc: null, road: null, nav: null, sla: null, scene: null };
    const named = (s) => !!(s && s.iface && s.field);
    const say = (m) => { if (log && log.info) log.info('bench: fake ' + m); };

    /** The speed-limit struct, built through config.sign's own paths. */
    function feedSign(v) {
        const c = cfg.sign;
        if (!named(c)) return;
        const s = Object.assign({ state: 'limit', value: 50, unit: 'kmh', warn: 0, supp: null, style: 'ece', np: 'none', npM: 0 }, v || {});
        let out = {};
        const put = (path, val) => { if (path) merge(out, nest(path, val)); };
        put(c.invalidPath, s.state === 'invalid' ? (c.invalidOn || [1])[0] : 0);
        const unitRaw = s.state === 'unknown' && s.unit === 'none' ? (c.noUnit || [2])[0]
            : s.unit === 'mph' ? (c.mph || [1])[0] : 0;
        put(c.unitPath, unitRaw);
        const val = s.state === 'limit' ? Math.round(Number(s.value) / (typeof c.factor === 'number' && c.factor ? c.factor : 1))
            : s.state === 'end' ? (c.end || [0])[0]
                : s.state === 'unknown' ? (c.unknown || [254])[0] : (c.none || [])[0];
        put(c.valuePath, val);
        put(c.warnPath, rawFor(c.warnMap, Number(s.warn) || 0, 0));
        put(c.suppPath, rawFor(c.suppMap, s.supp === undefined ? null : s.supp, 0));
        put(c.stylePath, rawFor(c.styleMap, s.style || 'ece', 0));
        put(c.npPath, rawFor(c.npMap, s.np || 'none', 0));
        put(c.npDistPath, Math.max(0, Math.round(Number(s.npM) || 0)));
        last.sign = s;
        hu.feed(c.iface, c.field, out);
    }

    /** The check-control message union; "variant": which union member carries it. */
    function feedCc(v) {
        const c = cfg.ccm;
        if (!named(c) || c.kind !== 'message') return;
        const m = Object.assign({ name: '', desc: '', color: 'default', symbol: 0, id: 0, type: 'TYP_A', variant: 'plain' }, v || {});
        if (m.clear) { m.name = ''; m.desc = ''; m.symbol = 0; m.id = 0; }
        let inner = {};
        const put = (path, val) => { if (path) merge(inner, nest(path, val)); };
        put(c.namePath, String(m.name || ''));
        put(c.descPath, String(m.desc || ''));
        put(c.colorPath, rawFor(c.colorMap, m.color || 'default', 0));
        put(c.symbolPath, Math.round(Number(m.symbol) || 0));
        put(c.idPath, Math.round(Number(m.id) || 0));
        put(c.typePath, m.type);
        const roots = Array.isArray(c.roots) && c.roots.length ? c.roots : [[]];
        const root = m.variant === 'symbol' && roots[1] ? roots[1] : roots[0];
        const out = nest(root, inner);
        // the union's other member is absent, as the binding hands a union over
        last.cc = m;
        hu.feed(c.iface, c.field, out);
    }

    /** The road label: "text" (one element) or "parts" ([["text" | "spacer" | "icon", value], ...]). */
    function feedRoad(v) {
        const c = cfg.road, r = v || {};
        if (named(c)) {
            let parts = Array.isArray(r.parts) ? r.parts : null;
            if (!parts) parts = r.text ? [['text', String(r.text)]] : [];
            const els = parts.map((p) => {
                const kind = p[0], val = p[1];
                if (kind === 'spacer') { const o = {}; o[c.spacerKey || 'spacer'] = val; return o; }
                if (kind === 'icon') {
                    const ic = {};
                    ic[c.iconTextKey || 'text'] = String(val);
                    ic.iconHandle = { valid: true, id: 'shield-' + String(val).replace(/\s+/g, ''), url: '', cache: false };
                    const o = {};
                    o[c.iconKey || 'icon'] = ic;
                    return o;
                }
                const o = {};
                o[c.textKey || 'text'] = String(val);
                return o;
            });
            last.road = r;
            hu.feed(c.iface, c.field, nest(c.path, els));
        }
        if (named(cfg.onRoad) && 'onRoad' in r) hu.feed(cfg.onRoad.iface, cfg.onRoad.field, nest(cfg.onRoad.path, !!r.onRoad));
    }

    /** The check-control LIST (several messages at once; the car cycles them). */
    function feedCcList(list) {
        const c = cfg.ccList;
        if (!named(c)) return;
        const arr = Array.isArray(list) ? list : [];
        const els = arr.map((m, i) => {
            let inner = {};
            const put = (path, val) => { if (path) merge(inner, nest(path, val)); };
            put(c.namePath, String(m.name || ''));
            put(c.idPath, isFinite(Number(m.id)) && m.id !== undefined ? Number(m.id) : 100 + i);
            put(c.colorPath, rawFor(c.colorMap, m.color || 'default', 0));
            return nest(c.root, inner);
        });
        last.ccList = arr.length;
        hu.feed(c.iface, c.field, nest(c.path, els));
    }

    /** The driver's own speed-limit settings (read only on the car; here just fed). { warn, warn2, show,
     *  offset, offsetSlow, offsetSlowOn }, each "on" / "off" / null, the offsets a number. */
    function feedSla(v) {
        const c = cfg.sla;
        if (!c || !c.iface || !Array.isArray(c.parts)) return;
        const n = v || {};
        c.parts.forEach((p) => {
            if (!p || !p.field || !(p.key in n)) return;
            let out = {};
            const put = (path, val) => { if (path) merge(out, nest(path, val)); };
            put(p.valuePath, p.number ? Math.max(0, Math.round(Number(n[p.key]) || 0)) : rawFor(c.onMap, n[p.key], 0));
            put(p.availPath, rawFor(c.availMap, n[p.key] === null ? null : 'ok', 2));
            hu.feed(c.iface, p.field, out);
        });
        last.sla = Object.assign({}, last.sla || {}, n);
    }

    /** Which frame of how many the car says it is showing (KombiIF statusMenuCCMessage). */
    function feedCcFrame(v) {
        const c = cfg.ccFrames;
        if (!named(c)) return;
        const n = v || {};
        let out = {};
        const put = (path, val) => { if (path) merge(out, nest(path, val)); };
        put(c.numPath, Math.max(0, Math.round(Number(n.frame) || 0)));
        put(c.countPath, Math.max(0, Math.round(Number(n.of) || 0)));
        (Array.isArray(c.idPaths) ? c.idPaths : []).forEach((p, i) => put(p, (n.ids || [])[i] === undefined ? 0 : Number(n.ids[i])));
        last.ccFrame = n;
        hu.feed(c.iface, c.field, out);
    }

    /** The car's own clock: the time-zone offset config.clock reads (kind "offset"). */
    function feedClock(v) {
        const c = cfg.clock;
        if (!named(c) || c.kind === 'local') return;
        const n = v || {};
        let out = {};
        const put = (path, val) => { if (path) merge(out, nest(path, val)); };
        const f = typeof c.factor === 'number' && c.factor ? c.factor : 1;
        const by = typeof c.offsetBy === 'number' ? c.offsetBy : 0;
        put(c.path, n.minutes === null || n.minutes === undefined ? (c.invalid || [255])[0] : Math.round(Number(n.minutes) / f) + by);
        put(c.dstPath, n.dst ? 1 : 0);
        put(['hourUTC'], new Date().getUTCHours());
        put(['minuteUTC'], new Date().getUTCMinutes());
        hu.feed(c.iface, c.field, out);
    }

    /** Guidance state, the next destination and the position (NavigationStatus). */
    function feedNav(v) {
        const c = cfg.nav;
        if (!c || !c.iface) return;
        const n = v || {};
        if (c.state && c.state.field && 'state' in n) {
            hu.feed(c.iface, c.state.field, nest(c.state.path, rawFor(c.state.map, n.state, 0)));
        }
        if (c.next && c.next.field) {
            let out = {};
            const put = (path, val) => { if (path) merge(out, nest(path, val)); };
            put(c.next.distPath, String(n.dist === undefined ? '' : n.dist));
            put(c.next.unitPath, rawFor(c.next.unitMap, n.unit || null, 0));
            put(c.next.etaPath, { invalid: !(n.etaH >= 0), year: 2026, month: 11, day: 15, hour: Number(n.etaH) || 0, minute: Number(n.etaM) || 0, secound: 0 });
            put(c.next.timePath, Math.max(0, Math.round((Number(n.mins) || 0) * 60)));
            hu.feed(c.iface, c.next.field, out);
        }
        if (c.here && c.here.field) {
            let out = {};
            const put = (path, val) => { if (path) merge(out, nest(path, val)); };
            put(c.here.validPath, n.street !== undefined || n.city !== undefined);
            put(c.here.streetPath, String(n.street || ''));
            put(c.here.cityPath, String(n.city || ''));
            hu.feed(c.iface, c.here.field, out);
        }
        last.nav = n;
    }

    function control(v) {
        const o = v || {};
        if (o.scene) {
            const s = SCENES[o.scene];
            if (!s) { say('scene ' + o.scene + ': no such scene'); return; }
            last.scene = o.scene;
            say('scene ' + o.scene);
            control(Object.assign({}, s, { scene: null }));
            return;
        }
        if (o.sign) feedSign(o.sign);
        if (o.cc) feedCc(o.cc);
        if (o.ccList) feedCcList(o.ccList);
        if (o.ccFrame) feedCcFrame(o.ccFrame);
        if (o.sla) feedSla(o.sla);
        if (o.road) feedRoad(o.road);
        if (o.nav) feedNav(o.nav);
        if (o.clock) feedClock(o.clock);
    }

    return {
        control,
        scenes: Object.keys(SCENES),
        state: () => ({
            scenes: Object.keys(SCENES),
            wired: { sign: named(cfg.sign), ccm: named(cfg.ccm) && cfg.ccm.kind === 'message', road: named(cfg.road), nav: !!(cfg.nav && cfg.nav.iface) },
            last: { sign: last.sign, cc: last.cc ? { name: (last.cc.name || '').length, desc: (last.cc.desc || '').length, color: last.cc.color } : null, scene: last.scene },
        }),
    };
}

module.exports = { install, SCENES };
