'use strict';
/**
 * test-twin-carplay.js - CarPlay's next turn as data (car issues CT, the owner's approval of 2026-11-19): the shared decoder and poll
 * (shared/carplay_turns.js) and Twin Dial's test mode on tab 5 (Діагностика "Повороти CarPlay (тест)" -> config.carplayTurns).
 *
 *   node bench/test-twin-carplay.js            (BENCH_PORT for the bench part, default 8953)
 *
 *   1. the decoder: the binding's union shape and a raw decoder's, enums by name or number, the phone's distance from its TEXT
 *      (never rawDistance), uid states, the next turn (a turn kind with a distance; tunnels, POIs, the event after it skipped),
 *      error replies and hostile values (nothing throws);
 *   2. the declarations: Twin Dial's setting (off by default, on the DIAG screen, skipped from SETTINGS), config.carplayTurns false,
 *      the overlay, carplay_turns.js packed, GuidanceEventList declared with _methods ["queryContent"] and nothing else;
 *      check_signals.py passes; the only call site is shared/carplay_turns.js; Node 8 syntax;
 *   3. off (the default): no proxy, no call, the CarPlay route page as before;
 *   4. on, the phone guiding: one call every 2 s, one in flight; the arrow page with the arrow, the phone's distance and unit, the
 *      road the turn names, the destination footer; a route of three turns and a roundabout; the fallbacks (a failed call, no turn,
 *      a turn older than 6 s, the provider back to BMW); BMW's own guidance first; navView auto / map / arrows;
 *   5. privacy (no road name, no distance in the log), the glyphs every drawn character needs, the page painted inside its layer, no
 *      new layer;
 *   6. on the bench: the real Twin Dial build with the test mode on asks the GuidanceEventList stand-in through the kit.
 * Node 18 (the bench), the shipped files Node 8. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const S = require('./twin-centre-states');
const FX = require('./carplay-turns-fixture');

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const eq = (a, b, what) => { const k = JSON.stringify(a) === JSON.stringify(b); ok(k, what + (k ? '' : ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => new Promise((r) => setImmediate(r));

const R = S.rig();
const { pages } = R;
const ROOT = R.H.ROOT;
const T = require(path.join(R.dir, 'carplay_turns.js'));
const APP = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'app.json'), 'utf8'));
const CATALOGUE = path.join(ROOT, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json');
const tok = (h, n) => h._token('td:' + n);
const ROADS = /вулиця|проспект|площа|Приклад/;

/** A Twin Dial engine on tab 5 with the car's CarPlay route (provider CAR_PLAY, BMW INACTIVE, the destination) and a signals
 *  object whose GuidanceEventList proxy answers `script(params, n)` (hu-stub's path: proxy() then call() -> callMethod). */
function cpHud(script, over) {
    const o = over || {};
    const logs = [];
    const h = S.base(R, { tab: 5, config: Object.assign({ pages: Object.assign({}, S.CAR_PAGES), carplayTurns: o.on !== false }, o.config || {}), settings: o.settings || {} });
    h.log = { info: (s) => logs.push(s), warn: (s) => logs.push('WARN ' + s), error: (s) => logs.push('ERR ' + s), debug() {} };
    S.STATES.car_route.setup(h, R);
    const provider = FX.fakeProvider(script || ((p, n) => FX.ROUTE[Math.min(n - 1, FX.ROUTE.length - 1)].reply));
    const sig = { asked: 0, calls: [] };
    sig.proxy = (iface, inst) => { sig.asked++; sig.iface = iface; sig.inst = inst; return Promise.resolve(provider()); };
    sig.call = (p, m, params, ms) => { sig.calls.push({ m, ms, params }); return p.callMethod(m, params, ms); };
    h.ctx.signals = sig;
    const x = { w: R.widget, ref: 1, sheet: null, px: null };
    pages.init(h, x);
    return { h, x, sig, logs, provider };
}
/** Advance the engine's clock in steps of `ms` (the page's own evaluation runs every 150 ms), letting promises settle. */
async function run(c, ms, steps) {
    for (let i = 0; i < steps; i++) {
        c.h._now_ms += ms;
        pages.update(c.h, c.x, c.h._now_ms, false);
        // the dest is kept fresh as the car sends it every few seconds (a CarPlay route older than 60 s is no route)
        if (i % 20 === 0) pages.st(c.h).destAt = c.h._now_ms;
        await tick(); await tick(); await tick();
    }
    return pages.st(c.h).page;
}

async function main() {
    // -----------------------------------------------------------------------------------------------------------------
    console.log('1. the decoder (shared/carplay_turns.js)');
    {
        const body = { formattedDistance: { distance: '250', unit: 'METER', rawDistance: 1 }, direction: 'LEFT', description: { elements: [{ text: 'вулиця Тестова' }] }, uid: '3' };
        eq([T.unionOf({ intersection: body }).kind, T.unionOf({ type: 'intersection', value: body }).kind], ['intersection', 'intersection'], 'a union keyed by its member (the binding) or { type, value } (a raw decoder)');
        eq([T.unionOf({ intersection: body, roundabout: body }), T.unionOf({ nonesuch: body }), T.unionOf(null), T.unionOf('x')], [null, null, null, null], 'two members, an unknown member, no object: no union');
        const e = T.eventOf({ intersection: body });
        eq([e.kind, e.dir, e.dist.num, e.dist.unit, e.dist.metres, e.raw, e.uid, e.road], ['intersection', 'LEFT', '250', 'METER', 250, 1, 'set', 'вулиця Тестова'], 'an intersection: direction, the phone\'s distance from the TEXT (rawDistance 1 is not the distance), uid set, the road kept for the page');
        eq(T.eventOf({ intersection: { direction: 5, formattedDistance: { distance: '1,2', unit: 1 } } }).dir, 'RIGHT', 'an enum as its number (TurnDirection 5 = RIGHT; DistanceUnit 1 = KM)');
        const dists = [['250', 'METER'], ['1,2', 'KM'], ['1.5', 'KM'], ['1,234', 'KM'], ['0.3 mi', 'MILE_US'], [' ', 'NONE'], ['½', 'MILE_UK'], ['250', 'NONE'], ['abc', 'METER'], [7, 'METER']];
        eq(dists.map((d) => { const x = T.distOf({ distance: d[0], unit: d[1] }); return [x.num, x.metres === null ? null : Math.round(x.metres)]; }),
            [['250', 250], ['1.2', 1200], ['1.5', 1500], ['1234', 1234000], ['0.3', 483], [null, null], [null, null], ['250', null], [null, null], ['7', 7]],
            'distances: "1,2" km = 1.2 (a decimal comma), "1,234" = 1234 (a thousands mark), "0.3 mi" in metres; " " / NONE / "½" / text: no distance');
        eq(['0', '00', '7', 7, 0, { low: 0, high: 0 }, { low: 3, high: 0 }, null, 'x'].map(T.uidState), ['zero', 'zero', 'set', 'set', 'zero', 'zero', 'set', null, null], 'uid: set / zero (Apple Maps sends 0) / none, never the id');
        const d = T.decode(FX.reply([FX.tunnel('300', 'METER'), { pointOfInterest: { formattedDistance: { distance: '100', unit: 'METER' } } }, FX.turn('LEFT', ' ', 'NONE', 'x'), FX.turn('RIGHT', '600', 'METER', 'вулиця Зразкова'), FX.dest()]));
        eq([d.ok, d.count, d.events.length, d.more, T.nextIndex(d), T.nextTurn(d).dir], [true, 5, 4, 1, 3, 'RIGHT'], 'the next turn: the first turn kind WITH a distance (a tunnel, a POI and a turn without a distance are skipped); 4 events kept, "+1 more"');
        eq([T.decode(FX.reply([], { error: 'INVALID_VIEW_PARAMS' })).ok, T.decode(FX.reply([], { error: 2 })).error, T.decode(FX.reply([FX.dest()], { noView: true })).error, T.decode(undefined).error, T.decode({ GuidanceEventListError: 'NO_ERROR' }).error],
            [false, 'INVALID_VIEW_PARAMS', 'no view', 'no reply', 'no view'], 'an error reply (by name or number), no view, no reply: not ok (the turn is not known)');
        eq(T.nextTurn(T.decode(FX.reply([]))), null, 'no events: no turn');
        let threw = false;
        [null, undefined, 1, 'x', [], {}, { viewContent: 'x' }, { viewContent: [null] }, { viewContent: [{ eventsInView: [null, 1, 'x', { intersection: null }, { intersection: { formattedDistance: 'x', description: 7 } }] }] }]
            .forEach((v) => { try { T.nextTurn(T.decode(v)); } catch (e) { threw = true; } });
        ok(!threw, 'hostile replies: nothing throws');
        eq(['CAR_PLAY', 'ANDROID_AUTO', 1, 2, 'NONE', 0, 'CAR_LIFE', null, { guidingProvider: 'CAR_PLAY' }].map(T.isPhone), [true, true, true, true, false, false, false, false, true], 'the phone guides: CAR_PLAY or ANDROID_AUTO, by name or number');
        const q = T.request();
        ok(q.viewConfigs.length === 1 && q.viewConfigs[0].viewport.startPoint.anchorPoint.standardReferencePoint === 'CCP' && q.viewConfigs[0].viewport.maxElementCount === 4 && q.viewConfigs[0].minimumUpdateIntervalMs === 0 && T.request() !== q,
            'the request: one stateless view from CCP, 4 events, a new object each time');
        if (fs.existsSync(CATALOGUE)) {
            // the request against the catalogue's types: every member it names exists, and every member of a struct is given
            const cat = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8')), DT = cat.datatypes, P = 'de.bmw.infotainment.navigation.GuidingTypes.';
            const m = cat.interfaces[T.IFACE].methods.queryContent;
            const bad = [];
            const check = (v, ref, where) => {
                const t = DT[ref];
                if (!t) return;
                if (t.type === 'struct') { const names = (t.members || []).map((x) => x.name); names.forEach((n) => { if (!(n in v)) bad.push(where + '.' + n + ' missing'); }); Object.keys(v).forEach((k) => { const mm = t.members.find((x) => x.name === k); if (!mm) bad.push(where + '.' + k + ' unknown'); else if (mm.dimension) (v[k] || []).forEach((el, i) => check(el, mm.dataRef, where + '.' + k + '[' + i + ']')); else check(v[k], mm.dataRef, where + '.' + k); }); }
                if (t.type === 'union') { const ks = Object.keys(v); if (ks.length !== 1 || !t.members.some((x) => x.name === ks[0])) bad.push(where + ': not one member'); }
                if (t.type === 'enum' && !(v in t.items)) bad.push(where + ': ' + v + ' not an item');
            };
            q.viewConfigs.forEach((vc, i) => check(vc, m.inputs[0].dataRef, 'viewConfigs[' + i + ']'));
            ok(m.methodId === 4 && m.inputs.length === 1 && m.inputs[0].name === 'viewConfigs' && m.inputs[0].dimension === 1 && bad.length === 0 && DT[P + 'GuidanceEventListViewport'].members.length === 4,
                'the request against the catalogue (queryContent, methodId 4, input viewConfigs[]): every struct member given, the anchor union one member, every enum an item' + (bad.length ? ': ' + bad.join('; ') : ''));
            const outs = m.outputs.map((x) => x.name).join();
            ok(outs === 'GuidanceEventListError,viewContent,currentDistances', 'the reply\'s members as the decoder reads them: ' + outs);
        } else console.log('  skip: the catalogue is not here');
    }

    // -----------------------------------------------------------------------------------------------------------------
    console.log('2. the declarations');
    {
        const s = APP.settings.find((x) => x.key === 'diagCarplayTurns');
        ok(s && s.type === 'bool' && s.default === false && s.label === 'Повороти CarPlay (тест)', 'the setting diagCarplayTurns "Повороти CarPlay (тест)": a bool, off by default');
        const diag = APP.screens.find((x) => x.name === 'DIAG'), set = APP.screens.find((x) => x.name === 'SETTINGS');
        ok(diag.items.some((i) => i[0] === 'setting' && i[1] === 'diagCarplayTurns') && set.skip.indexOf('diagCarplayTurns') >= 0, 'on the Діагностика screen, skipped from Settings');
        ok(APP.config.carplayTurns === false && JSON.stringify(APP.config.diag.settings.diagCarplayTurns.on) === '{"carplayTurns":true}', 'config.carplayTurns false; the setting writes carplayTurns: true while on');
        const DS = require(path.join(R.dir, 'diag_settings.js'));
        const cfg = JSON.parse(JSON.stringify(APP.config)), vals = {};
        const d = DS.Diag.create(cfg, { item: (k) => APP.settings.find((x) => x.key === k) || null, get: (k) => (k in vals ? vals[k] : (APP.settings.find((x) => x.key === k) || {}).default) }, { info() {}, warn() {} });
        const off = cfg.carplayTurns; vals.diagCarplayTurns = true; d.apply(); const on = cfg.carplayTurns; vals.diagCarplayTurns = false; d.apply();
        eq([off, on, cfg.carplayTurns], [false, true, false], 'the overlay: off = app.json\'s false, on = true, off again = false');
        ok(APP.shared.indexOf('carplay_turns.js') >= 0 && APP.shared.indexOf('twin_pages.js') >= 0, 'carplay_turns.js is packed with twin_pages.js');
        const g = APP.signals[T.IFACE];
        ok(g && g._instances === 'Main_Instance' && JSON.stringify(g._methods) === '["queryContent"]' && Object.keys(g).filter((k) => k !== '_about').sort().join() === '_instances,_methods',
            'GuidanceEventList: Main_Instance, _methods ["queryContent"], nothing else (no field, no broadcast, no setter)');
        const others = Object.keys(APP.signals).filter((i) => i !== T.IFACE && APP.signals[i]._methods);
        ok(others.length === 0, 'no other interface of Twin Dial declares a method');
        if (fs.existsSync(CATALOGUE)) {
            const o = spawnSync('python3', [path.join(ROOT, 'tools', 'signals', 'check_signals.py'), CATALOGUE, path.join(ROOT, 'apps', 'twin_dial', 'app.json')], { encoding: 'utf8' });
            ok(o.status === 0 && /GuidanceEventList method queryContent: methodId 4/.test(o.stdout), 'check_signals.py on apps/twin_dial/app.json: ' + o.stdout.trim().split('\n').pop());
        } else console.log('  skip: check_signals.py needs the catalogue');
        const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
        const files = fs.readdirSync(path.join(ROOT, 'shared')).filter((f) => /\.js$/.test(f));
        const callers = files.filter((f) => /queryContent|GuidanceEventList/.test(strip(fs.readFileSync(path.join(ROOT, 'shared', f), 'utf8'))));
        ok(JSON.stringify(callers) === '["carplay_turns.js"]', 'of shared/*.js only carplay_turns.js names GuidanceEventList / queryContent (' + callers.join(', ') + ')');
        const tp = strip(fs.readFileSync(path.join(ROOT, 'shared', 'twin_pages.js'), 'utf8'));
        ok(!/callMethod|signals\.call|\.call\(p|S\.call\(|setValue/.test(tp), 'twin_pages.js makes no call of its own (the Poller does)');
        const node8 = /\?\.|\?\?|catch\s*\{|\.\.\.\w|\bBigInt\(|\d+n\b|\.flat\(|\.flatMap\(|Object\.fromEntries|Object\.entries|Object\.values|\.padEnd|\.padStart|\bfor await\b/;
        ok(!node8.test(strip(fs.readFileSync(path.join(ROOT, 'shared', 'carplay_turns.js'), 'utf8'))) && !node8.test(tp), 'carplay_turns.js and twin_pages.js: only what Node 8.16 has');
    }

    // -----------------------------------------------------------------------------------------------------------------
    console.log('3. off (the default): nothing changes, no call');
    {
        const c = cpHud(null, { on: false });
        const pg = await run(c, 150, 140);
        ok(pg === 'route' && c.sig.asked === 0 && c.sig.calls.length === 0 && !c.logs.some((l) => /carplay turns/.test(l)), 'test mode off, CarPlay guiding, 21 s: the route page, no proxy asked, no call, no line');
        eq([tok(c.h, 'pgRouteDist'), tok(c.h, 'pgRouteUnit')], ['5.7', 'км'], '... the route page as before (5.7 км)');
    }

    // -----------------------------------------------------------------------------------------------------------------
    console.log('4. on, the phone guiding: the arrow page from the event list');
    {
        const c = cpHud();
        let pg = await run(c, 150, 2);
        ok(c.sig.asked === 1 && c.sig.iface === T.IFACE && c.sig.inst === 'Main_Instance', 'the first evaluation asks the kit for ONE GuidanceEventList proxy (Main_Instance)');
        pg = await run(c, 150, 2);
        eq([c.sig.calls.length, c.sig.calls[0] && c.sig.calls[0].m, c.sig.calls[0] && c.sig.calls[0].ms], [1, 'queryContent', 3000], 'then one call: queryContent, the binding\'s timeout 3000 ms');
        eq([pg, tok(c.h, 'pgTitle'), tok(c.h, 'pgGuideIcon'), tok(c.h, 'pgGuideDist'), tok(c.h, 'pgGuideUnit'), tok(c.h, 'pgGuideExit'), tok(c.h, 'pgGuideRoad'), tok(c.h, 'pgGuideFoot')],
            ['guide', 'Навігація', 'td_turn_left', '400', 'м', '', 'вулиця Тестова', 'прибуття 20:41 · 5.7 км'],
            'the reply: the arrow page - "Навігація", the left arrow, the phone\'s 400 м, the road the turn names, the destination footer');
        const at1 = c.sig.calls.length;
        await run(c, 150, 11);          // the first call went out at +300 ms; now +2250 ms (1.95 s after it)
        ok(c.sig.calls.length === at1, 'no second call within 2 s');
        await run(c, 150, 1);
        ok(c.sig.calls.length === at1 + 1, 'the second call after 2 s');
        const seen = [];
        for (let i = 0; i < 9; i++) { await run(c, 150, 14); seen.push([pages.st(c.h).page, tok(c.h, 'pgGuideIcon'), tok(c.h, 'pgGuideDist') + ' ' + tok(c.h, 'pgGuideUnit'), tok(c.h, 'pgGuideExit')]); }
        ok(seen.some((s) => s[1] === 'td_turn_right' && s[2] === '1.2 км') && seen.some((s) => s[1] === 'td_turn_slight_left' && s[2] === '300 м') &&
            seen.some((s) => s[1] === 'td_rb2_r' && s[3] === '2' && s[2] === '200 м') && seen.some((s) => s[1] === 'td_flag_right' && s[2] === '150 м'),
            'the route: right 1.2 км ("1,2" KM), slight left 300 м, the roundabout\'s exit 2 (right-hand traffic), the destination flag 150 м: ' + seen.map((s) => s.join(' ')).join(' | '));
        ok(seen[seen.length - 1][0] === 'route', 'the last reply has no event: the route page again (no turn)');
        ok(c.sig.calls.length >= 10 && c.sig.calls.length <= 11, 'one call every 2 s (' + c.sig.calls.length + ' calls in about 21 s)');
        ok(c.logs.some((l) => /^carplay turns: on \(every 2 s, timeout 3 s\)$/.test(l)) && c.logs.some((l) => /^carplay turns: first call: answered, 2 events \(calls 1, answered 1, errors 0, timeouts 0\)$/.test(l)) &&
            c.logs.some((l) => /^carplay turns: turn intersection left, a road of 14 characters$/.test(l)) && c.logs.some((l) => /^carplay turns: no turn in the reply \(0 events\)$/.test(l)),
            'the log: on, the first call\'s outcome, the turn\'s kind once per change with the road as a length, "no turn"');
        ok(!c.logs.some((l) => ROADS.test(l) || /\b(400|350|900|1\.2|1,2|300|200|150)\b/.test(l.replace(/\(calls .*\)$/, ''))), 'no road name and no distance in any log line (' + c.logs.length + ' lines)');
        // the provider goes back
        c.h._extra[pages.IF.guidance].guidingProvider('NONE');
        const n0 = c.sig.calls.length;
        pg = await run(c, 150, 30);
        ok(c.sig.calls.length === n0 && pg !== 'guide' && c.logs.some((l) => /^carplay turns: off \(off\)/.test(l)), 'provider NONE: the poll is off (logged), no call, no arrow page');
        c.h._extra[pages.IF.guidance].guidingProvider('CAR_PLAY');
        await run(c, 150, 4);
        ok(c.sig.calls.length === n0 + 1 && c.sig.asked === 1, 'CarPlay again: polled again on the same proxy');
        // the test mode switched off in place
        c.h.config.carplayTurns = false;
        const n1 = c.sig.calls.length;
        pg = await run(c, 150, 30);
        ok(c.sig.calls.length === n1 && pg === 'route', 'the test mode off (in place): no call, the route page');
    }
    {
        // a failed call: the route page at once; the next poll tries again
        let fail = false;
        const c = cpHud((p, n) => { if (fail) throw new Error('Access denied'); return FX.ROUTE[0].reply; });
        await run(c, 150, 4);
        eq(pages.st(c.h).page, 'guide', 'a reply: the arrow page');
        fail = true;
        await run(c, 150, 14);
        ok(pages.st(c.h).page === 'route' && c.logs.some((l) => /^carplay turns: now: error: Access denied/.test(l)), 'the next call fails: the route page at once, the error logged');
        fail = false;
        await run(c, 150, 14);
        eq(pages.st(c.h).page, 'guide', 'the call after it answers: the arrow page again');
    }
    {
        // a call that never answers: the turn ages out after 6 s; still one call in flight
        let hang = false;
        const c = cpHud((p, n) => (hang ? new Promise(() => {}) : FX.ROUTE[1].reply));
        await run(c, 150, 4);
        eq(pages.st(c.h).page, 'guide', 'a reply: the arrow page');
        hang = true;
        await run(c, 150, 14);
        const nHang = c.sig.calls.length;
        eq(pages.st(c.h).page, 'guide', '2 s later a call hangs: the turn read 2 s ago still shows');
        await run(c, 150, 30);
        ok(pages.st(c.h).page === 'route' && c.sig.calls.length === nHang, 'its turn older than 6 s: the route page; no second call while one is in flight');
    }
    {
        // an error reply (INVALID_VIEW_PARAMS): the route page
        const c = cpHud(() => FX.reply([], { error: 'INVALID_VIEW_PARAMS' }));
        await run(c, 150, 6);
        ok(pages.st(c.h).page === 'route' && c.logs.some((l) => /first call: answered \(INVALID_VIEW_PARAMS\)/.test(l)), 'an error reply: the route page, its enum logged');
    }
    {
        // BMW's own guidance comes first
        const c = cpHud();
        await run(c, 150, 4);
        const e = c.h._extra, I = pages.IF;
        e[I.guiding].guidingState('ACTIVE');
        e[I.guidance].conclusiveDart({ maneuver: { intersection: { direction: 'RIGHT', formattedDistance: { distance: '0.8', unit: 'KM', rawDistance: 800 } } } });
        await run(c, 150, 2);
        eq(pages.st(c.h).page, 'road', 'BMW\'s guidance ACTIVE with its own arrow page off: no CarPlay arrow over it (the fallback)');
        c.h.config.pages = Object.assign({}, S.CAR_PAGES, { guidance: true });
        await run(c, 150, 2);
        eq([pages.st(c.h).page, tok(c.h, 'pgGuideIcon'), tok(c.h, 'pgGuideDist'), tok(c.h, 'pgGuideUnit'), tok(c.h, 'pgGuideRoad').length], ['guide', 'td_turn_right', '800', 'м', 14], '... with it on: BMW\'s manoeuvre (800 м from rawDistance) and BMW\'s current road');
    }
    {
        // navView with the map window (W2): "карта" keeps the map; "стрілки" never the map; "авто": the map's strict rule (shut on a CarPlay route)
        const views = {};
        for (const v of ['map', 'arrows', 'auto']) {
            const c = cpHud(null, { config: { mapWindow: 'W2', mapShutMs: 0 }, settings: { navView: v } });
            pages.st(c.h).navType = 'ANZEIGE_RADIOBUTTON_KARTENANSICHT_AKTIV'; pages.st(c.h).built = 0;
            await run(c, 150, 4);
            views[v] = [pages.st(c.h).page, c.sig.calls.length > 0];
        }
        eq(views, { map: ['map', true], arrows: ['guide', true], auto: ['guide', true] }, 'navView with the map window and the cluster in map view: карта = the map; стрілки = the CarPlay arrow page; авто = the arrow page (BMW\'s guidance INACTIVE keeps the window shut)');
        const c = cpHud(null, { config: { mapWindow: 'W2', mapShutMs: 0, mapForce: true }, settings: { navView: 'auto' } });
        pages.st(c.h).built = 0;
        await run(c, 150, 4);
        eq(pages.st(c.h).page, 'map', 'авто with the forced map window: the map wins');
        const z = cpHud(null, { settings: { navView: 'auto' } });
        await run(c, 150, 1);
        ok(pages.navView(z.h) === 'auto', 'the default navView is авто');
    }
    {
        // alongMainRoad and the other kinds through the page model
        const m = (ev) => pages.cpModel(T.eventOf(ev));
        eq([m(FX.along('LEFT', '300', 'METER', 'x')).kind, m(FX.along('RIGHT', '300', 'METER', 'x')).kind, m(FX.branch('HIGHWAY_OUT_RIGHT', '1', 'KM', 'x')).kind, m(FX.branch('FORK_LEFT', '1', 'KM', 'x')).kind,
            m(FX.dest({ position: 'CENTER', dist: '50', unit: 'METER' })).kind, m(FX.turn('UTURN_LEFT', '50', 'METER', 'x')).kind, m(FX.turn('NONE', '50', 'METER', 'x')).kind],
            ['slight_left', 'slight_right', 'exit_right', 'fork_left', 'flag', 'uturn_left', null], 'the pictogram keys (as BMW\'s manoeuvre): along the main road = a slight bend, a motorway exit, a fork, the centre flag, a U-turn, none (the dot)');
        eq([pages.maneuverIcon(m(FX.turn('NONE', '50', 'METER', 'x'))), pages.maneuverIcon(m(FX.roundabout(3, '50', 'METER', 'x', { side: 'LEFT' })))], ['td_dot', 'td_rb3_l'], 'an unknown direction draws the dot (never a guessed arrow); a left-hand-traffic roundabout');
        eq([pages.cpDist({ num: '0.3', unit: 'MILE_US', dist: 483 }), pages.cpDist({ num: '120', unit: 'FEET', dist: 36.6 }), pages.cpDist({ num: null, unit: 'METER', dist: 1234 }), pages.cpDist({ num: '1,5', unit: 'KM', dist: 1500 })],
            [{ n: '0.3', u: 'mi' }, { n: '120', u: 'ft' }, { n: '1.2', u: 'км' }, { n: '1.5', u: 'км' }], 'the distance: the phone\'s number and unit (mi, ft); otherwise our metres format');
    }

    // -----------------------------------------------------------------------------------------------------------------
    console.log('5. the glyphs, the painting, the layer');
    {
        const textRaster = require(path.join(R.dir, 'hud_text.js'));
        const glyphs = (role) => { const n = pages.fontName(role); return n ? textRaster.loadFont(n).metrics.glyphs : null; };
        const items = R.widget.pages.guide.items, distItem = items.find((i) => i.id === 'dist'), exitItem = items.find((i) => i.id === 'exit');
        const gDist = glyphs(distItem.parts[0].f), gUnit = glyphs(distItem.parts[1].f), gExit = glyphs(exitItem.f);
        const numbers = '0123456789.', units = Object.keys(pages.CP_UNITS).map((k) => pages.CP_UNITS[k]).join('') + 'м' + 'км';
        const miss = (g, s) => Array.from(s).filter((ch) => !g || !g[ch]);
        eq([miss(gDist, numbers), miss(gUnit, units), miss(gExit, '0123456789')], [[], [], []], 'every character the CarPlay page draws has a glyph: the distance (' + pages.fontName(distItem.parts[0].f) + ': digits and "."), the units м км mi ft yd (' + pages.fontName(distItem.parts[1].f) + '), the exit number');
        const bad = [];
        ['250', '1,2', '1.5', '0,25', '12345', '1,234'].forEach((t) => ['METER', 'KM', 'MILE_US', 'MILE_UK', 'FEET', 'YARD'].forEach((u) => {
            const turn = pages.cpModel(T.eventOf(FX.turn('LEFT', t, u, 'x'))), d = pages.cpDist(turn);
            if (d && (miss(gDist, d.n).length || miss(gUnit, d.u).length)) bad.push(t + ' ' + u + ' -> ' + d.n + ' ' + d.u);
        }));
        ok(bad.length === 0, 'every distance text and unit the phone can send reaches the page in drawable characters' + (bad.length ? ': ' + bad.join(', ') : ''));
        const c = cpHud();
        await run(c, 150, 4);
        const out = S.render(R, c.h);
        const L = { x0: R.pages.LAYER.x, y0: R.pages.LAYER.y, x1: R.pages.LAYER.x + R.pages.LAYER.w, y1: R.pages.LAYER.y + R.pages.LAYER.h };
        const ids = out.ink.map((i) => i.id);
        ok(out.page === 'guide' && ['title', 'arrow', 'dist.0', 'dist.1', 'road', 'foot'].every((i) => ids.indexOf(i) >= 0), 'painted: the title, the arrow, the distance and its unit, the road, the footer (' + ids.join(', ') + ')');
        ok(out.ink.every((i) => i.box[0] >= L.x0 && i.box[1] >= L.y0 && i.box[2] <= L.x1 && i.box[3] <= L.y1), 'every ink box inside the page layer');
        const long = cpHud(() => FX.reply([FX.turn('LEFT', '250', 'METER', 'дуже довга назва вулиці Прикладної імені Тестової')]));
        await run(long, 150, 4);
        const out2 = S.render(R, long.h), road = out2.ink.find((i) => i.id === 'road');
        ok(road && road.box[2] <= items.find((i) => i.id === 'road').x + items.find((i) => i.id === 'road').mw + 2, 'a long road name is cut to its width ("…")');
        ok(R.layout.widgets.filter((w) => w.type === 'tdpage').length === 1 && !!R.widget.pages.guide && !R.widget.pages.cpguide, 'no new layer and no new page: the existing "guide" page of the one tdpage layer');
    }

    // -----------------------------------------------------------------------------------------------------------------
    const PORT = Number(process.env.BENCH_PORT) || 8953;
    console.log('6. on the bench: the real Twin Dial build asks the stand-in (port ' + PORT + ')');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-carplay-'));
    let out = '', server = null;
    const base = 'http://127.0.0.1:' + PORT;
    const req = async (method, url, body) => {
        const rr = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        if (rr.status === 200) return rr.json();
        if (rr.status !== 204) throw new Error(method + ' ' + url + ': ' + rr.status);
        return null;
    };
    const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); while (Date.now() < end) { if (await fn()) return true; await sleep(200); } return fn(); };
    const appLines = () => out.split('\n').filter((l) => /\[twin_dial\]/.test(l)).map((l) => l.replace(/^.*\[twin_dial\] /, ''));
    try {
        server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'twin_dial'], {
            cwd: ROOT, env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: tmp, BENCH_CONFIG: JSON.stringify({ carplayTurns: true }) }), stdio: ['ignore', 'pipe', 'pipe'],
        });
        server.stdout.on('data', (d) => { out += d; }); server.stderr.on('data', (d) => { out += d; });
        ok(await until(() => /GuidanceEventList stand-in/.test(out) && appLines().some((l) => /Twin Dial .* started/.test(l)), 120000), 'the build packs the stand-in\'s interface (the manifest declares queryContent) and the app starts');
        await sleep(1500);
        let p = await req('GET', '/probe');
        ok(p && p.carplayTurns && p.carplayTurns.calls === 0, 'the test mode on but no phone route yet: no call (' + JSON.stringify(p && p.carplayTurns) + ')');
        await req('POST', '/fake', { feed: { iface: 'de.bmw.infotainment.navigation.guiding.Guidance', field: 'guidingProvider', value: 'CAR_PLAY' } });
        ok(await until(async () => { p = await req('GET', '/probe'); return p && p.carplayTurns && p.carplayTurns.calls >= 2; }, 20000), 'provider CAR_PLAY: the built app calls queryContent through the kit\'s signals.call (' + JSON.stringify(p && p.carplayTurns) + ')');
        ok(p && JSON.stringify(p.carplayTurns.methods) === '["queryContent"]', 'only queryContent was called');
        ok(appLines().some((l) => /carplay turns: first call: answered, 2 events/.test(l)), 'the app\'s log: the first call answered');
        ok(!appLines().some((l) => ROADS.test(l)), 'no road name in the app\'s log');
        await req('POST', '/fake', { feed: { iface: 'de.bmw.infotainment.navigation.guiding.Guidance', field: 'guidingProvider', value: 'NONE' } });
        ok(await until(() => appLines().some((l) => /carplay turns: off/.test(l)), 8000), 'provider NONE: the poll is off');
        ok(!/app exited/.test(out), 'the app never exited');
    } catch (e) {
        ok(false, 'bench run: ' + (e && e.stack || e));
    } finally {
        if (server) { server.kill('SIGTERM'); await sleep(300); }
    }

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
