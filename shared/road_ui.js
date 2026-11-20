'use strict';
/**
 * road_ui.js - Road View in both cluster themes (round "Road View", package TD; docs/traffic/TD-REPORT.md): the sign strip and
 * the traffic light beside the speed-limit sign, and the road scene. TEST MODES ONLY: everything here is inert unless one of the
 * Діагностика settings has written config.roadView.light / .signs / .scene ('car' | 'demo' | 'replay'):
 *
 *   "Тест: світлофор"     (diagRoadLight)   the light beside the limit (f30: the 6WB sign row's second place; Twin Dial: right
 *                                           of its limit sign)
 *   "Тест: знаки"         (diagRoadSigns)   no overtaking from the limit's own event first, then the camera's sign list
 *   "Тест: сцена дороги"  (diagRoadScene)   Twin Dial: tab 1's page; f30: 6WB Comfort's centre window (while BMW's map is not
 *                                           shown through it)
 *
 * With every setting off: no widget is added (the layout files are not touched: the widgets are added at build time, only while
 * a setting is on), no handler runs that does anything, nothing new is subscribed. The two events both themes already receive
 * (TrafficSignRecognition, SignRecognitionFrontCamera) get a tap that returns at once while the signs test is off.
 *
 * The hooks in shared/hud.js are small blocks marked "road TD:"; shared/twin_pages.js gets two (tab 1's page), shared/
 * diag_settings.js one (config.roadView: this file's diag(), then a rebuild). The data: shared/road_view.js (read only).
 * The pictures: shared/road_shaders.js (effect layers: no pixels uploaded after the atlas) and the sign atlas
 * hud/scene/rv_signs.json (tools/road/bake_signs.js).
 *
 * Plain Node 8 (the car's 8.16.2): no ?. / ?? / object spread. Nothing here throws into the engine.
 */
const path = require('path');
const fs = require('fs');
const RV = require('./road_view');
const RS = require('./road_shaders');
const SG = require('./road_signs');
const I = require('./lang');
let textRaster = null;
try { textRaster = require('./hud_text'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }

const isNum = (x) => typeof x === 'number' && isFinite(x);
const log = (hud, level, s) => { try { if (hud && hud.log && hud.log[level]) hud.log[level](s); } catch (e) { /* never */ } };
const VIEW_MS = 100;            // the decoder's view is asked at most this often
const SCENE_MS = 100;           // the scene's uniforms at most 10 a second

/* ------------------------------------------------------------------ the looks (panel px) ------------------------------- */

/**
 * Each theme's places. Slots are in the layer's own px. f30_cluster: one layer over the 6WB sign row's second and third places
 * (the limit at x 307..395, BMW-style no overtaking at 429..517, the "260" label from x 567): B = the second place (88 px), C a
 * narrow third (40 px). Twin Dial: the light right of its limit sign (centre 1300, 672; the gear gap from x 1380 stays free of
 * any layer), the signs right of the gear gap on the bottom line. The scenes: below Twin Dial's page title and meta line; between
 * f30's dials above the 6WB horizon.
 */
const LOOKS = {
    '6wb': {
        conn: 3,                // f30's 4th connection: every 6WB layout uses at most 7 / 7 / 7 on the first three
        strip: [{ id: 'rv_strip', x: 420, y: 456, w: 152, h: 100, z: 4, slots: [{ role: 'B', cx: 53, cy: 49.5, size: 88, light: 84 }, { role: 'C', cx: 122, cy: 49.5, size: 40, light: 46 }] }],
        scene: { id: 'rv_scene', x: 760, y: 168, w: 400, h: 280, z: 2, view: [0.10, 30, 4, 100] },
        atlas: { cell: 88, cols: 8 },
        shader: { strip: 'rv_strip_6wb', scene: 'rv_scene_6wb' },
    },
    td: {
        conn: null,
        strip: [{ id: 'rv_light', x: 1348, y: 640, w: 32, h: 66, z: 11, conn: 2, slots: [{ role: 'B', cx: 16, cy: 33, size: 58, light: 58, lightOnly: true }] },
            { id: 'rv_signs', x: 1468, y: 662, w: 124, h: 56, z: 11, conn: 2, slots: [{ role: 'D', cx: 28, cy: 28, size: 48, signOnly: true }, { role: 'E', cx: 92, cy: 28, size: 48, signOnly: true }] }],
        scene: { id: 'rv_scene', x: 739, y: 336, w: 442, h: 256, z: 7, conn: 1, view: [0.06, 34, 4, 100] },
        atlas: { cell: 52, cols: 8 },
        shader: { strip: 'rv_strip_td', scene: 'rv_scene_td' },
    },
};
const TYPES = { rvstrip: true, rvscene: true };

/* ------------------------------------------------------------------ state ---------------------------------------------- */

function st(hud) {
    if (!hud.rv) hud.rv = { tracker: null, subs: {}, taps: {}, view: null, viewAt: -1e9, modes: null, replay: null, pageKey: null };
    return hud.rv;
}
const cfgRaw = (hud) => (hud && hud.config && hud.config.roadView && typeof hud.config.roadView === 'object' ? hud.config.roadView : null);
/** The look this app draws in ('6wb' | 'td'), or null (an app without Road View). */
function lookOf(hud) { const c = cfgRaw(hud); return c && LOOKS[c.look] ? c.look : null; }
/** { light, signs, scene }: each 'car' | 'demo' | 'replay' or null (off). */
function modes(hud) {
    const c = cfgRaw(hud);
    if (!c || !lookOf(hud)) return { light: null, signs: null, scene: null };
    const cfg = RV.cfgOf(c);
    return { light: RV.modeOf(cfg, 'light'), signs: RV.modeOf(cfg, 'signs'), scene: RV.modeOf(cfg, 'scene') };
}
function anyOn(hud) { const m = modes(hud); return !!(m.light || m.signs || m.scene); }
const strip = (m) => !!(m.light || m.signs);

function tracker(hud) {
    const s = st(hud);
    if (!s.tracker) s.tracker = RV.create(cfgRaw(hud) || {}, { log: hud.log, clock: () => Date.now() });
    return s.tracker;
}

/* ------------------------------------------------------------------ the sources ---------------------------------------- */

/** The car's sources each test reads in 'car' mode: [iface, member, which tests, tracker method]. Read only. */
const SOURCES = [
    [RV.IF.lightCam, 'RecognitionTrafficLightCamera', ['light'], 'lightCam'],
    [RV.IF.dds2, 'functionalLibraryData', ['light', 'signs'], 'dds2'],
    [RV.IF.signLeg, 'RecognitionTrafficSignCamera', ['signs'], 'signLeg'],
    [RV.IF.signLeg, 'recognitionTrafficSignCamera2', ['signs'], 'signCam2'],
    [RV.IF.lanes, 'LaneBoundaries', ['scene'], 'lanes'],
    [RV.IF.objects, 'ObjectRecognition', ['scene'], 'objRec'],
    [RV.IF.objects, 'ObjectPosition', ['scene'], 'objPos'],
    [RV.IF.lca, 'assistedDrivingViewLcaInput', ['scene'], 'lca'],
];
/** The two events both themes already receive: a tap, chained behind the engine's own handler (no new subscription). */
const TAPS = [[RV.IF.tsr, 'TrafficSignRecognition', 'tsr'], [RV.IF.signCam, 'TrafficSignRecognitionFrontCamera', 'signCam']];

/** The handler of one source: forwards to the tracker only while a test that reads it is in 'car' mode. */
function handler(hud, tests, method) {
    return (v) => {
        try {
            const m = modes(hud);
            const want = tests.filter((k) => m[k] === 'car');
            if (!want.length) return;
            const t = tracker(hud);
            if (method === 'dds2') t.dds2(v, { light: m.light === 'car', signs: m.signs === 'car' });
            else t[method](v);
        } catch (e) { log(hud, 'warn', 'road: ' + (e && e.message || e)); }
    };
}

/**
 * _setupVehicleData: the taps on the two events already received (inert while off), and - for each test already on at the
 * start in 'car' mode - its sources join the engine's own watches. Off: nothing at all is added for the new sources.
 */
function wire(hud, extra) {
    const s = st(hud);
    if (!lookOf(hud)) return;
    TAPS.forEach((tp) => {
        const e = extra[tp[0]];
        if (!e || typeof e[tp[1]] !== 'function') return;          // not received by this app: never subscribed for a tap
        const prev = e[tp[1]], mine = handler(hud, ['signs'], tp[2]);
        e[tp[1]] = (v) => { prev(v); mine(v); };
        s.taps[tp[0] + '.' + tp[1]] = true;
    });
    const m = modes(hud);
    s.modes = m;
    SOURCES.forEach((src) => {
        if (!src[2].some((k) => m[k] === 'car')) return;
        const e = extra[src[0]] = extra[src[0]] || {};
        const prev = e[src[1]], mine = handler(hud, src[2], src[3]);
        e[src[1]] = prev ? (v) => { prev(v); mine(v); } : mine;
        s.subs[src[0] + '.' + src[1]] = 'start';
    });
    if (anyOn(hud)) begin(hud, m);
}

/** A test went on (or its mode changed): the tracker anew, its demo and its replay. */
function begin(hud, m) {
    const s = st(hud);
    if (s.tracker) { try { s.tracker.stop('changed'); } catch (e) { /* never */ } }
    s.tracker = null;
    const t = tracker(hud);
    t.start();
    t.demo({ light: m.light === 'demo', signs: m.signs === 'demo', scene: m.scene === 'demo' });
    replayStop(hud);
    if (m.light === 'replay' || m.signs === 'replay' || m.scene === 'replay') replayStart(hud);
    s.view = null; s.viewAt = -1e9; s.pageKey = null;
}

/**
 * The Діагностика setting changed (shared/diag_settings.js, before its rebuild): the tracker anew; every source a test now reads in
 * 'car' mode that is not watched yet is watched now, once (Signal Probe's late watch); a test going off leaves its watch until
 * the app restarts (its values are ignored: a proxy shutdown has never been tried on the car).
 */
function diag(hud) {
    const s = st(hud);
    if (!lookOf(hud)) return;
    const m = modes(hud), was = s.modes || { light: null, signs: null, scene: null };
    s.modes = m;
    if (m.light === was.light && m.signs === was.signs && m.scene === was.scene) return;
    if (!anyOn(hud)) {
        replayStop(hud);
        if (s.tracker) s.tracker.stop(Object.keys(s.subs).length ? 'the subscriptions stay until the app restarts' : '');
        s.tracker = null; s.view = null;
        return;
    }
    begin(hud, m);
    const S = hud && hud.ctx && hud.ctx.signals;
    const late = {};
    SOURCES.forEach((src) => {
        const k = src[0] + '.' + src[1];
        if (s.subs[k] || !src[2].some((q) => m[q] === 'car')) return;
        (late[src[0]] = late[src[0]] || {})[src[1]] = handler(hud, src[2], src[3]);
        s.subs[k] = 'late';
    });
    Object.keys(late).forEach((iface) => {
        if (!S || typeof S.watch !== 'function') { log(hud, 'warn', 'road: no signals to watch'); return; }
        Promise.resolve().then(() => S.watch(iface, '1', late[iface], hud.log)).then((res) => {
            log(hud, 'info', 'road: watch ' + iface.split('.').pop() + '.' + Object.keys(late[iface]).join('/') + (res && res.error ? ' error: ' + String(res.error).slice(0, 120) : ' ok'));
        }, (e) => log(hud, 'info', 'road: watch error: ' + String(e && e.message || e).slice(0, 120)));
    });
}

/* ------------------------------------------------------------------ the replay ----------------------------------------- */

/**
 * config.roadView.replay: a file in the app's data folder: one of the capture package's scenarios as rv_analyse.py writes it
 * (TS-REPORT 3: a light track or a sign sighting, raw values), or JSON lines { "t": ms from the start, "iface", "event" (or
 * "field"), "value" } - the car's raw messages. Played in
 * time, looping; every line goes through the same decoder as the car's own message. Missing or broken: one log line, nothing shown.
 */
function replayStart(hud) {
    const s = st(hud), c = cfgRaw(hud) || {};
    const name = typeof c.replay === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(c.replay) ? c.replay : null;
    if (!name) { log(hud, 'info', 'road: replay: no file named (config.roadView.replay)'); return; }
    let lines = [];
    try {
        const dir = hud.ctx && hud.ctx.dataDir ? hud.ctx.dataDir : '.';
        const text = fs.readFileSync(path.join(dir, name), 'utf8');
        // the capture package's scenario (one JSON object, TS-REPORT 3), else JSON lines
        let one = null;
        try { one = JSON.parse(text); } catch (e) { one = null; }
        const raw = one && !Array.isArray(one) && one.frames ? RV.fromScenario(one)
            : text.split('\n').map((l) => { try { return l.trim() ? JSON.parse(l) : null; } catch (e) { return null; } });
        lines = raw.filter((m) => m && isNum(m.t) && typeof m.iface === 'string').sort((a, b) => a.t - b.t);
    } catch (e) { log(hud, 'info', 'road: replay: ' + name + ' not read (' + (e && e.code || 'error') + ')'); return; }
    if (!lines.length) { log(hud, 'info', 'road: replay: ' + name + ' has no usable line'); return; }
    const span = lines[lines.length - 1].t + 1000;
    const r = { lines, i: 0, t0: Date.now(), span, timer: null };
    r.timer = setInterval(() => {
        try {
            const t = tracker(hud);
            let el = Date.now() - r.t0;
            if (el > r.span) { r.t0 = Date.now(); r.i = 0; el = 0; }
            while (r.i < r.lines.length && r.lines[r.i].t <= el) { t.replay(r.lines[r.i]); r.i++; }
        } catch (e) { log(hud, 'warn', 'road: replay: ' + (e && e.message || e)); }
    }, 50);
    if (r.timer.unref) r.timer.unref();
    s.replay = r;
    log(hud, 'info', 'road: replay ' + name + ': ' + lines.length + ' lines, ' + Math.round(span / 1000) + ' s a loop');
}
function replayStop(hud) { const s = st(hud); if (s.replay) { clearInterval(s.replay.timer); s.replay = null; } }

/* ------------------------------------------------------------------ the layout ----------------------------------------- */

/**
 * _rebuildInner: the layout with the Road View widgets added while a test is on; the SAME object (untouched) while every test
 * is off. f30_cluster: the strip in every 6WB layout (a "wb" speedometer), the scene only where the backdrop has the centre window
 * (6WB Comfort, 6WB Dials + G20). Twin Dial: the light and the signs, and the scene layer over the page.
 */
function extend(hud, layout) {
    const look = lookOf(hud), m = modes(hud);
    if (!look || !layout || !Array.isArray(layout.widgets) || !anyOn(hud)) return layout;
    const L = LOOKS[look], add = [];
    const ws = layout.widgets;
    const ok6 = ws.some((w) => w.type === 'dial' && w.look === 'wb' && w.measure === 'speed');
    const okTd = ws.some((w) => w.type === 'tdback');
    if (!(look === '6wb' ? ok6 : okTd)) return layout;
    if (strip(m)) {
        L.strip.forEach((g) => add.push({ id: g.id, type: 'rvstrip', class: 'content', z: g.z, x: g.x, y: g.y, w: g.w, h: g.h, conn: isNum(g.conn) ? g.conn : L.conn,
            rv: { look, part: 'strip', slots: g.slots } }));
    }
    const sceneOk = look === 'td' ? okTd : ws.some((w) => w.type === 'wbback' && w.tex && w.tex.window);
    if (m.scene && sceneOk) {
        const g = L.scene;
        add.push({ id: g.id, type: 'rvscene', class: 'content', z: g.z, x: g.x, y: g.y, w: g.w, h: g.h, conn: isNum(g.conn) ? g.conn : L.conn, rv: { look, part: 'scene', view: g.view } });
    }
    if (!add.length) return layout;
    return Object.assign({}, layout, { widgets: ws.concat(add) });
}

/** _sceneNeeds: the atlas a strip layer samples. */
function needs(hud, w, out, ci) { if (w && w.type === 'rvstrip') out.add(ci + ':scene:rv_signs'); }
function owns(w) { return !!(w && TYPES[w.type] && w.rv); }
/** The shader text a Road View layer is made with (shipped: no comments). */
function shader(w) { const L = LOOKS[w.rv.look]; return RS.shipped(w.type === 'rvstrip' ? L.shader.strip : L.shader.scene); }

/* ------------------------------------------------------------------ the uniforms --------------------------------------- */

const r2 = (v) => Math.round(v * 100) / 100;
const flat = (a) => { const o = []; a.forEach((e) => e.forEach((q) => o.push(r2(q)))); return o; };
const rgb01 = (hud, role) => { const t = hud && hud.theme ? hud.theme : {}; const v = t[role] || t.fg || [255, 255, 255]; return [v[0] / 255, v[1] / 255, v[2] / 255]; };
const night = (hud) => (hud && hud.nightOn === true ? 0.82 : 1);

function viewNow(hud, now) {
    const s = st(hud);
    if (!anyOn(hud)) return null;
    if (!s.view || now - s.viewAt >= VIEW_MS || now < s.viewAt) { s.view = tracker(hud).view(now); s.viewAt = now; }
    return s.view;
}
/** Is a speed-limit sign on show (the 6WB sign row's first place, Twin Dial's sign)? */
function limitOn(hud) { try { return typeof hud._signShow === 'function' && hud._signShow()[0] > 0; } catch (e) { return false; } }
/** f30's own no-overtaking sign (config.nopass, the BMW-style second place) is on. */
function theirNoPass(hud) { try { return lookOf(hud) === '6wb' && !!hud._raw('nopass'); } catch (e) { return false; } }

/** The strip's items now (what the tests read too): road_view.strip with each test's part only. */
function itemsNow(hud, now, limit) {
    const v = viewNow(hud, now), m = modes(hud);
    if (!v) return [];
    const vv = { light: m.light ? v.light : null, signs: m.signs ? v.signs : [] };
    return RV.strip(vv, { limit: typeof limit === 'boolean' ? limit : limitOn(hud), noPass: theirNoPass(hud) });
}

/** The 6WB's second place holds an item of ours (not its own no-overtaking): its no-overtaking must step aside (hud _signShow). */
function holdsB(hud, limit) {
    if (lookOf(hud) !== '6wb' || !strip(modes(hud))) return false;
    const it = itemsNow(hud, Date.now(), !!limit)[0];
    return !!(it && !it.theirs);
}

/** The uniforms of a strip layer for the items now. -> { it, ce, lt } */
function stripUniforms(hud, w, items) {
    const g = w.rv, L = LOOKS[g.look], slots = g.slots;
    const it = [], ce = [];
    const light = items.filter((x) => x.kind === 'light')[0] || null;
    const signs = items.filter((x) => x.kind === 'sign');
    let place = [];
    if (g.look === '6wb') place = items.map((x, i) => (x.theirs && i === 0 ? null : x));    // B, C in order; the theme's own sign in B: it draws it
    else if (slots[0] && slots[0].lightOnly) place = [light];
    else place = signs;
    slots.forEach((sl, i) => {
        const x = place[i] || null;
        if (!x) { it.push([0, 0, 0, 0]); ce.push([0, 0, 0, 0]); return; }
        if (x.kind === 'light') { it.push([sl.cx, sl.cy, sl.light || sl.size, 2]); ce.push([0, 0, 0, 0]); return; }
        const c = SG.cellOf(x.id, L.atlas.cell, L.atlas.cols);
        if (!c) { it.push([0, 0, 0, 0]); ce.push([0, 0, 0, 0]); return; }
        it.push([sl.cx, sl.cy, sl.size, 1]); ce.push(c);
    });
    const v = st(hud).view;
    const lt = light && v && v.light ? [RS.LIGHT_CODE[v.light.state] || 0, RS.ARROW_CODE[v.light.arrow] || 0, 0, 0] : [0, 0, 0, 0];
    return { it, ce, lt, place };
}

/** The scene layer's show flag: Twin Dial only on its page, with no message card; f30 only while BMW's map is not in the window. */
function sceneShown(hud) {
    if (lookOf(hud) === 'td') {
        let page = null;
        try { page = require('./twin_pages').current(hud); } catch (e) { page = null; }
        const msg = hud.twinMsg && hud.twinMsg.state && hud.twinMsg.state !== 'none';
        return page === 'rvscene' && !msg;
    }
    try { return hud.setting('stockMap') !== true; } catch (e) { return true; }
}

function sceneUniforms(hud, w, now) {
    const v = viewNow(hud, now), g = w.rv;
    const sc = v ? v.scene : null;
    const lines = sc && sc.lanes ? sc.lanes.lines.slice(0, 4) : [];
    const ln = [], lp = [];
    for (let i = 0; i < 4; i++) {
        const l = lines[i];
        if (!l) { ln.push([0, 0, 0, 0]); lp.push([0, 0, 0, 0]); continue; }
        ln.push([l.y0, l.a, l.c, RV.TYPE_CODE[l.type] || 1]); lp.push([l.len, Math.max(0.3, Math.min(1, l.prob)), 0, 0]);
    }
    const e = sc ? sc.ego : RV.egoOf(null);
    const ob = [];
    (sc ? sc.objects : []).slice(0, 8).forEach((o) => ob.push([o.x, o.y, (RV.CLS_CODE[o.cls] || 6) + (o.lead || (sc.lead && sc.lead.x === o.x && sc.lead.y === o.y) ? 10 : 0), o.alpha]));
    while (ob.length < 8) ob.push([0, 0, 0, 0]);
    const m = modes(hud);
    const li = sc && sc.light && m.scene ? sc.light : null;
    const lt = li ? [RS.LIGHT_CODE[li.state] || 0, RS.ARROW_CODE[li.arrow] || 0, isNum(li.x) ? li.x : 0, 0] : [0, 0, 0, 0];
    const show = sceneShown(hud) && sc && sc.data !== 'absent' ? 1 : 0;
    return { view: g.view, ln, lp, ego: [e.y0, e.a, e.c, e.half], ob, lt, fl: [lines.length ? 0 : 1, show, 0, 0], data: sc ? sc.data : 'none' };
}

/* ------------------------------------------------------------------ create / update ------------------------------------ */

/** _create: the atlas bound (every sampler bound: RAMSES draws nothing with an unbound one), the static uniforms, then a draw. */
function create(hud, x) {
    const w = x.w, c = x.c, ref = x.ref;
    c.uniform(ref, 'u_size', [w.w, w.h]);
    if (w.type === 'rvstrip') {
        const a = hud._scene('rv_signs', x.ci);
        c.bind(ref, 'u_atlas', a.ref);
        c.uniform(ref, 'u_asz', [a.w, a.h]);
    } else c.uniform(ref, 'u_view', w.rv.view);
    x.rvKey = null;
    update(hud, x, Date.now(), true);
}

function send(x, name, v, type) { if (type) x.c.uniform(x.ref, name, v, { type }); else x.c.uniform(x.ref, name, v); }

/** _updateOne: the uniforms, sent only when they changed. */
function update(hud, x, now, force) {
    const w = x.w;
    if (w.type === 'rvstrip') {
        const items = itemsNow(hud, now);
        const u = stripUniforms(hud, w, items);
        const look = w.rv.look;
        const extra = look === 'td' ? rgb01(hud, 'fg').map(r2) : [];
        const key = JSON.stringify([u.it, u.ce, u.lt, extra, night(hud)]);
        if (!force && key === x.rvKey) return;
        x.rvKey = key; x.rvPlace = u.place.map((q) => (q ? q.id : null));
        send(x, 'u_it', flat(u.it), 'vec4');
        send(x, 'u_ce', flat(u.ce), 'vec4');
        send(x, 'u_lt', u.lt);
        send(x, 'u_k', [night(hud), 0, 0, 0]);
        if (look === 'td') send(x, 'u_fg', extra);
        return;
    }
    if (w.type === 'rvscene') {
        if (!force && now - (x.rvAt || 0) < SCENE_MS && now >= (x.rvAt || 0)) return;
        x.rvAt = now;
        const u = sceneUniforms(hud, w, now);
        const look = w.rv.look;
        const col = look === 'td' ? [rgb01(hud, 'fg').map(r2), rgb01(hud, 'dim').map(r2)] : [night(hud)];
        const key = JSON.stringify([flat(u.ln), flat(u.lp), u.ego.map(r2), flat(u.ob), u.lt.map(r2), u.fl, col]);
        if (!force && key === x.rvKey) return;
        x.rvKey = key; x.rvData = u.data; x.rvShown = u.fl[1];
        send(x, 'u_ln', flat(u.ln), 'vec4');
        send(x, 'u_lp', flat(u.lp), 'vec4');
        send(x, 'u_ego', u.ego.map(r2));
        send(x, 'u_ob', flat(u.ob), 'vec4');
        send(x, 'u_lt', u.lt.map(r2));
        send(x, 'u_fl', u.fl);
        if (look === 'td') { send(x, 'u_fg', col[0]); send(x, 'u_dim', col[1]); } else send(x, 'u_k', [col[0], 0, 0, 0]);
    }
}

/* ------------------------------------------------------------------ Twin Dial's page ------------------------------------ */

/** Tab 1 shows the scene's page while the scene test is on (and the vehicle-ahead test, which had tab 1 first, is off). */
function takesTab1(hud) {
    if (lookOf(hud) !== 'td' || !modes(hud).scene) return false;
    try { if (require('./twin_front').takesTab1(hud)) return false; } catch (e) { /* not packed */ }
    return true;
}

/** Every word the page can show (the font test checks each against Twin Dial's atlases). */
const WORD_KEYS = ['rv.title', 'rv.noLanes', 'rv.demo', 'rv.replay', 'twin.noData'];
const FONTS = { title: 'td_title', meta: 'td_body', note: 'td_val' };
const PAGE = { x: 729, y: 248, w: 462, h: 347, title: [960, 281], metaL: [739, 326], metaR: [1181, 326], note: [960, 470] };

function paintText(c, font, s, x, b, al, rgb) {
    if (!textRaster || !s) return null;
    let f;
    try { f = textRaster.loadFont(font).metrics; } catch (e) { return null; }
    let t = '';
    Array.from(String(s)).forEach((ch) => { if (f.glyphs[ch] || ch === ' ') t += ch; });
    if (!t) return null;
    const wpx = textRaster.measure(t, font, 0), left = al === 'r' ? x - wpx : al === 'c' ? x - wpx / 2 : x;
    const bw = Math.ceil(wpx) + 4, bh = f.cellHeight, m = textRaster.mask(bw, bh, t, { font, x: 2 });
    const dx = Math.round(left) - 2, dy = Math.round(b) - f.baseline;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;           // the ink's own box (the cell is taller than its letters)
    for (let y = 0; y < bh; y++) for (let xx = 0; xx < bw; xx++) {
        const a = m[y * bw + xx];
        const px = dx + xx - c.x, py = dy + y - c.y;
        if (a > 40) { x0 = Math.min(x0, dx + xx); x1 = Math.max(x1, dx + xx + 1); y0 = Math.min(y0, dy + y); y1 = Math.max(y1, dy + y + 1); }
        if (!a || px < 0 || py < 0 || px >= c.w || py >= c.h) continue;
        const o = (py * c.w + px) * 4, k = a / 255, da = c.buf[o + 3] / 255, oa = k + da * (1 - k);
        for (let q = 0; q < 3; q++) c.buf[o + q] = Math.round((rgb[q] * k + c.buf[o + q] * da * (1 - k)) / Math.max(oa, 1e-6));
        c.buf[o + 3] = Math.round(oa * 255);
    }
    return x1 > x0 ? [x0, y0, x1, y1] : null;
}

/** The page's picture (title, the state in words, the mode): { buf, ink }. Pure but for the theme and the fonts. */
function paintPage(theme, data, mode) {
    const c = { x: PAGE.x, y: PAGE.y, w: PAGE.w, h: PAGE.h, buf: Buffer.alloc(PAGE.w * PAGE.h * 4, 0) };
    const fg = (theme && theme.fg) || [255, 255, 255], dim = (theme && theme.dim) || [180, 180, 180];
    const ink = [];
    const add = (id, b) => { if (b) ink.push({ id, box: b }); };
    add('title', paintText(c, FONTS.title, I.t('rv.title'), PAGE.title[0], PAGE.title[1], 'c', fg));
    if (mode === 'demo' || mode === 'replay') add('mode', paintText(c, FONTS.meta, I.t(mode === 'demo' ? 'rv.demo' : 'rv.replay'), PAGE.metaR[0], PAGE.metaR[1], 'r', dim));
    if (data === 'absent') add('note', paintText(c, FONTS.note, I.t('twin.noData'), PAGE.note[0], PAGE.note[1], 'c', dim));
    else if (data === 'nolanes') add('lanes', paintText(c, FONTS.meta, I.t('rv.noLanes'), PAGE.metaL[0], PAGE.metaL[1], 'l', dim));
    return { buf: c.buf, ink };
}

/** twin_pages.update hands the page "rvscene" here: repaint only when its words changed (the scene itself is the effect layer). */
function updatePage(hud, x, now, force) {
    const s = st(hud), v = viewNow(hud, now);
    const sc = v ? v.scene : null;
    const data = !sc ? 'absent' : sc.data === 'absent' ? 'absent' : sc.data === 'ok' && !sc.lanes ? 'nolanes' : sc.data;
    const mode = modes(hud).scene;
    const th = ['fg', 'dim'].map((r) => String(hud.theme && hud.theme[r])).join('|');
    const key = [data, mode, th, I.lang()].join('#');
    if (!force && key === s.pageKey && x.px) return;
    s.pageKey = key;
    const out = paintPage(hud.theme, data, mode);
    x.pgInk = out.ink;
    hud._blitDiff(x, out.buf);
}

/* ------------------------------------------------------------------ the bench's probe ----------------------------------- */

function probe(hud) {
    const s = st(hud);
    const out = { look: lookOf(hud), modes: modes(hud), subs: Object.assign({}, s.subs), taps: Object.keys(s.taps), tracker: s.tracker ? s.tracker.state() : null };
    if (s.view) out.view = { light: s.view.light, signs: s.view.signs.map((q) => q.id), scene: s.view.scene ? { data: s.view.scene.data, lines: s.view.scene.lanes ? s.view.scene.lanes.lines.length : 0, objects: s.view.scene.objects.length } : null, demo: s.view.demo };
    out.widgets = [];
    if (hud.widgets && hud.widgets.forEach) hud.widgets.forEach((x) => { if (owns(x.w)) out.widgets.push({ id: x.w.id, type: x.w.type, conn: x.ci, box: [x.w.x, x.w.y, x.w.w, x.w.h], place: x.rvPlace || null, shown: x.rvShown, data: x.rvData }); });
    out.items = anyOn(hud) ? itemsNow(hud, Date.now()) : [];
    return out;
}

/** The app is stopping. */
function release(hud) { try { replayStop(hud); } catch (e) { /* never */ } }

module.exports = { LOOKS, TYPES, SOURCES, TAPS, WORD_KEYS, FONTS, PAGE, wire, diag, extend, needs, owns, shader, create, update, holdsB, itemsNow,
    stripUniforms, sceneUniforms, takesTab1, updatePage, paintPage, probe, release, modes, lookOf, anyOn, st };
