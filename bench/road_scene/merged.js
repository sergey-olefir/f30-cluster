'use strict';
/**
 * bench/road_scene/merged.js - the merge's own checks (round fixes-1121 RS, docs/fixes-1121/BRIEF-RS-merge-road-scene.md "Tests"):
 *
 *   - the names and the Store: road_scene in apps/, acc_view and auto_beam retired to tools/retired/ (out of the Store's apps/*)
 *   - the merged scene in every ACC View and beam state (Auto Beam's 5 scenes played through the real algorithm), day and night
 *   - a light source that is also a road user is drawn once
 *   - the beams only at night
 *   - the advice's colours: no red; blue only for "high"; amber only in the disagreement (or ACC View's closing fast)
 *   - one loop and one map connection
 *   - the layer count, the pixel memory and the shader bytes
 *   - the rear-axle path: a full lock at a stop bends the corridor and our car stays inside it
 *   - the measured lanes unchanged
 *   - the settings (both apps' union) and the profile table; the interfaces against the other apps
 */
const fs = require('fs');
const path = require('path');
const Cm = require('./common');

const ROOT = Cm.ROOT, APPDIR = Cm.APPDIR, ok = Cm.ok, FakeCR = Cm.FakeCR;
const M = require(path.join(APPDIR, 'model.js'));
const P = require(path.join(APPDIR, 'paint.js'));
const R = require(path.join(APPDIR, 'raster.js'));
const Wo = require(path.join(APPDIR, 'world.js'));
const Ln = require(path.join(APPDIR, 'lanes.js'));
const Ch = require(path.join(APPDIR, 'chaos.js'));
const GP = require(path.join(APPDIR, 'gpu.js'));
const C = require(path.join(APPDIR, 'contract.js'));
const BV = require(path.join(APPDIR, 'beam_view.js'));
const SC = require(path.join(APPDIR, 'scenes.js'));
const Score = require(path.join(APPDIR, 'score.js'));
const MapView = require(path.join(APPDIR, 'mapview.js'));
const PS = require(path.join(ROOT, 'shared', 'profile_settings.js'));
const Rec = require(path.join(ROOT, 'kit', 'runtime', 'record.js'));

const app = JSON.parse(fs.readFileSync(path.join(APPDIR, 'app.json'), 'utf8'));
const sj = JSON.parse(fs.readFileSync(path.join(APPDIR, 'hud', 'shaders.json'), 'utf8'));
const CFG = Wo.cfgOf(app.config.world);

/** Every demo entry at a moment, the beam scenes played through the real algorithm (main.js's way). */
function entries() {
    const out = [];
    const pl = new SC.Player(new C.Decider(app.config.algo, Cm.nullLog(), 'normal'));
    M.DEMO.forEach((d) => {
        const e = d[2];
        if (e.beamScene) {
            // the scene on its own clock, forward only (main.js's way): one run, three moments taken from it
            const at = {};
            for (let t = 0; t <= 8000; t += 100) { const r0 = pl.step(e.beamScene, t); if (t === 2000 || t === 5000 || t === 8000) at[t] = r0; }
            [2000, 5000, 8000].forEach((ms) => {
                const r = at[ms];
                const v = BV.viewOf({ out: r.out, lamps: r.lamps, data: 'ok', speed: r.world.speed, limit: r.world.limit, curve: r.world.curve, town: r.out.town, now: 15100 + ms, score: new Score({}).summary() });
                out.push([d[0] + '@' + ms, d[1], M.withBeamScene(e, v, r.world)]);
            });
        } else {
            const s = M.withScene(e, 3000);
            out.push([d[0], d[1], s.beam ? s : Object.assign({}, s, { beam: BV.NONE })]);
        }
    });
    return out;
}

function partNames() {
    ok(app.id === 'road_scene' && app.title === 'Road Scene' && app.loggingId === 'OARS' && app.version === '0.1.0' && app.i18n === true, 'the new app: road_scene, "Road Scene", OARS, 0.1.0, i18n');
    const T = { uk: require(path.join(ROOT, 'shared', 'i18n', 'uk.json')), en: require(path.join(ROOT, 'shared', 'i18n', 'en.json')) };
    ok(T.uk['road_scene.title'] === 'Дорога' && T.en['road_scene.title'] === 'Road Scene', 'its name in both languages: «Дорога» / "Road Scene"');
    ok(!fs.existsSync(path.join(ROOT, 'apps', 'acc_view')) && !fs.existsSync(path.join(ROOT, 'apps', 'auto_beam')), 'ACC View and Auto Beam are out of apps/: they leave the Store');
    ok(['acc_view', 'auto_beam'].every((a) => fs.existsSync(path.join(ROOT, 'tools', 'retired', a, 'app.json'))), 'their folders kept in tools/retired/ (their history easy to find)');
    const rd = fs.existsSync(path.join(ROOT, 'tools', 'retired', 'README.md')) ? fs.readFileSync(path.join(ROOT, 'tools', 'retired', 'README.md'), 'utf8').trim() : '';
    ok(rd.split('\n').filter(Boolean).length === 1 && /road_scene/.test(rd), 'tools/retired/README.md: one line, pointing at road_scene');
    const repo = JSON.parse(fs.readFileSync(path.join(ROOT, 'mgu-repo.json'), 'utf8'));
    ok(repo.apps.path === 'apps/*' && !/retired/.test(JSON.stringify(repo)), 'the Store takes apps/* only: tools/retired/ is not in it');
    ok(!fs.existsSync(path.join(ROOT, 'bench', 'test-acc-view.js')) && !fs.existsSync(path.join(ROOT, 'bench', 'test-acc-lanes.js')) && !fs.existsSync(path.join(ROOT, 'bench', 'test-auto-beam.js')) &&
        fs.existsSync(path.join(ROOT, 'tools', 'retired', 'acc_view', 'test-acc-view.js')) && fs.existsSync(path.join(ROOT, 'tools', 'retired', 'auto_beam', 'test-auto-beam.js')), 'the old suites went with their apps; this one suite carries their checks');
    const rat = fs.readFileSync(path.join(ROOT, 'tools', 'twin-dial', 'run_all_tests.sh'), 'utf8');
    ok(/apps\/road_scene\/app\.json/.test(rat) && !/apps\/acc_view|apps\/auto_beam/.test(rat), 'run_all_tests.sh\'s signal check names road_scene (not the retired apps)');
}

function partSettings() {
    const keys = app.settings.map((s) => s.key);
    ok(keys.join() === 'show,demoCycle,sens,follow,lang,profileSets', 'the settings: both apps\' union, each key once (' + keys.join(', ') + ')');
    const set = (k) => app.settings.filter((s) => s.key === k)[0] || {};
    ok(set('show').label === 'Показувати на щитку' && set('show').default === false, '"Показувати на щитку" off by default');
    ok(set('demoCycle').type === 'bool' && set('demoCycle').default === false && set('demoCycle').label === 'Демо: стани по колу', 'the demo setting stays (off)');
    ok(set('lang').default === 'auto' && (app.shared || []).indexOf('lang.js') >= 0, 'the language is the shared one (shared/lang.js, Авто)');
    ok(set('sens').options.map((o) => o[0]).join() === 'early,normal,late' && set('follow').options.map((o) => o[0]).join() === 'follow,ignore', 'the sensitivity and the camera-verdict setting from Auto Beam');
    ok(set('profileSets').default === true, 'the per-profile switch (on by default, as Auto Beam had it)');
    const t = PS.TABLE.road_scene;
    ok(t && t.perProfile.join() === 'sens,lang' && t.global.join() === 'profileSets,show,demoCycle,follow', 'shared/profile_settings.js: sensitivity and language per profile; the switch, the cluster test, the demo and the camera choice global');
    ok(t && keys.every((k) => (t.perProfile.indexOf(k) >= 0) !== (t.global.indexOf(k) >= 0)), 'the profile table covers every setting exactly once');
    ok(app.config.world.path.standRadius === undefined && app.config.world.path.rearAxle === 3.65 && app.config.world.path.carWidth === 1.83, 'config: no standRadius (0.2.1\'s 20 m cap); the rear axle 3.65 m behind our front, our width 1.83 m');
    // the interfaces: each declared once; against the other apps
    const ifs = Object.keys(app.signals);
    const acc = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'retired', 'acc_view', 'app.json'), 'utf8')), ab = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'retired', 'auto_beam', 'app.json'), 'utf8'));
    const union = {};
    Object.keys(acc.signals).concat(Object.keys(ab.signals)).forEach((i) => { union[i] = 1; });
    ok(ifs.length === Object.keys(union).length && ifs.every((i) => union[i]), 'the signals: the union of both manifests, each interface once (' + ifs.length + ' = ' + Object.keys(acc.signals).length + ' + ' + Object.keys(ab.signals).length + ' - the shared)');
    const members = (a) => { const o = {}; Object.keys(a.signals).forEach((i) => Object.keys(a.signals[i]).forEach((f) => { if (f[0] !== '_') o[i + '.' + f] = a.signals[i][f]; else if (f === '_broadcasts') a.signals[i][f].forEach((b) => { o[i + '.' + b] = 'event'; }); })); return o; };
    const mm = members(app), ma = members(acc), mb = members(ab);
    ok(Object.keys(ma).concat(Object.keys(mb)).every((k) => mm[k] === (ma[k] || mb[k])) && Object.keys(mm).every((k) => ma[k] || mb[k]), 'every member of both apps, with its own flag, and nothing else (' + Object.keys(mm).length + ' members)');
    const build = fs.readFileSync(path.join(ROOT, 'kit', 'tools', 'build.py'), 'utf8');
    const plat = (build.slice(build.indexOf('PLATFORM_PROXIES = {'), build.indexOf('\n}\n', build.indexOf('PLATFORM_PROXIES = {'))).match(/^\s+"de\.bmw[^"]+"|^\s+"org\.[^"]+"/gm) || []).map((x) => x.trim().replace(/"/g, ''));
    const all = {}; plat.concat(ifs).forEach((i) => { all[i] = 1; });
    const n = Object.keys(all).length;
    console.log('interfaces: road_scene ' + ifs.length + ' of its own, ' + n + ' with the kit\'s platform ' + plat.length + ' (ACC View had ' + Object.keys(acc.signals).length + ', Auto Beam ' + Object.keys(ab.signals).length + '; the most seen running: 88)');
    ok(plat.length >= 20 && n <= 88, 'the manifest\'s interfaces with the platform\'s: ' + n + ', under the 88 seen running');
}

function partScene() {
    const list = entries();
    ok(list.length === M.ACC_N + M.BEAM_N + 15, 'the merged demo: ' + M.ACC_N + ' ACC View entries, ' + M.BEAM_N + ' beam states and the 5 beam scenes at 3 moments (' + list.length + ')');
    let bad = [];
    const fake = new FakeCR(), mv = new MapView(null, { layer: app.config.layer, socket: 'x', shaders: sj });
    mv.CR = { ClusterRender: function () { return fake; } };
    mv.open();
    const ids = { band: 0x52530002, table: 0x52530003, sprites: { car: [0x52530010, 0x52530011], carFast: [0x52530012, 0x52530013], ego: [0x52530014, 0x52530015] } };
    Rec.setImage(ids.band, 800, P.BAND_H, Buffer.alloc(800 * P.BAND_H * 4)); Rec.setImage(ids.table, 800, P.PAGE_H, Buffer.alloc(800 * P.PAGE_H * 4));
    let shownN = 0, lightsN = 0, beamsN = 0;
    list.forEach((d) => [false, true].forEach((night) => {
        const s = d[2], tag = d[0] + ' ' + d[1] + (night ? ' night' : ' day');
        const Qc = M.colours('centre', night), Qm = M.colours('map', night);
        const pg = P.centre(s, { night, lang: 'uk', info: { age: 0.5 } });
        const sheet = Buffer.concat([P.textSheet(s, night, 'uk'), P.pillSheet(s, night, 'uk')]);
        const cc = Cm.census(pg.px, Qc, null, null, 0, 128), cm = Cm.census(sheet, Qm, null, null, 0, 128);
        const shown = M.adviceShown(s, night), v = s.beam;
        if (shown) shownN++;
        // no red; blue only while the advice says high (night, available); amber only in the disagreement or closing fast
        if (cc.red || cm.red) bad.push(tag + ' red');
        const blue = shown && v.adv === 'high' && v.go;
        if ((cc.blue > 0) !== blue || (cm.blue > 0) !== blue) bad.push(tag + ' blue ' + cc.blue + '/' + cm.blue);
        const amb = s.clo === 2 || (shown && v.disagree);
        if (!s.warn && ((cc.amber > 0) !== amb || (cm.amber > 0) !== amb)) bad.push(tag + ' amber ' + cc.amber + '/' + cm.amber);
        // the beams and the light sources only at night; the sign only at night while the advisor is available
        const u = M.laneUniforms(M.GEO.map, s, 0.3, night), o = M.objUniforms(M.GEO.map, s, night);
        const lit = o.u_oc.filter((x, i) => (i % 4 === 0 && x >= 7 && x <= 11) || (i % 4 === 2 && x > 0)).length;
        if (!night && (u.u_beam[1] !== 0 || lit)) bad.push(tag + ' beams or lights by day');
        if (night && u.u_beam[1] !== (v && v.lamps === 'off' ? 0 : 1)) bad.push(tag + ' beams at night ' + u.u_beam[1]);
        if (night && u.u_beam[1]) beamsN++;
        if (night && lit) lightsN++;
        if (shown !== !!(night && v && v.data === 'ok' && v.state !== 'UNAVAILABLE')) bad.push(tag + ' the sign');
        // the map and the GPU page take every entry
        mv.update(s, 0.3, night, 'uk');
        const rc = new Rec.Recorder(1600, 520);
        GP.draw(rc, s, { night, lang: 'uk' }, ids);
        if (!rc.words().length) bad.push(tag + ' gpu');
    }));
    ok(bad.length === 0, 'the one scene in all ' + list.length + ' entries day and night: no red, blue only for "high", amber only in the disagreement (or closing fast), the beams and lights only at night, the sign only at night while available' + (bad.length ? ' (' + bad.length + ': ' + bad.slice(0, 5).join('; ') + ')' : ''));
    ok(shownN >= 15 && lightsN >= 10 && beamsN >= list.length - 3, 'at night: the advice in ' + shownN + ' entries, light sources in ' + lightsN + ', our beams in ' + beamsN);
    ok(fake.layers.length === 6 && fake.msgs.filter((m) => m.op === 'layer').length === 6, 'all of it on the same 6 map layers (no second set)');
    mv.close();
    // the beams only at night, in pixels: the same high-beam state by day and with the lamps off gives the same lanes; at night not
    const s = Object.assign({}, M.DEMO[M.ACC_N + 4][2], { e: 1 }), off = Object.assign({}, s, { beam: Object.assign({}, s.beam, { lamps: 'off' }) });
    const laneOf = (st, night) => { const cv = new R.Canvas(1600, 482, [0, 0, 0]); P.lane(cv, M.GEO.centre, st, 0, M.colours('centre', night), 0); return cv.px; };
    ok(R.diffRect(laneOf(s, false), laneOf(off, false), 1600, 482) === null, 'by day: no beams (the high beam out or the lamps off: the same lanes, pixel for pixel)');
    ok(R.diffRect(laneOf(s, true), laneOf(off, true), 1600, 482) !== null, 'at night: our beams on the road');
    const lowOnly = laneOf(Object.assign({}, s, { e: 0 }), true), high = laneOf(s, true);
    const far = (px) => { let n = 0; for (let y = 270; y < 300; y++) for (let x = 330; x < 470; x++) n += px[(y * 1600 + x) * 4]; return n; };
    ok(far(high) > far(lowOnly) * 1.2, 'at night the high beam\'s cone reaches far down the road, the low beam\'s pool does not');
}

function partOnce() {
    // a light source that is also a road user is drawn once: as that road user with its lamps lit (and its ring), never a point
    const night = true;
    const s08 = M.DEMO[M.ACC_N + 7][2], s19 = M.DEMO[M.ACC_N + 18][2];
    const J8 = M.lightsOf(s08, night), J19 = M.lightsOf(s19, night);
    ok(J8.points.length === 0 && J8.lead && J8.lead.lamp === 2 && J8.lead.ring === 1, 'the camera\'s light stream: the tail lamps 95 m ahead are the car ahead: its lamps lit, ringed; no second mark');
    const it8 = M.sceneItems(M.GEO.map, s08, night);
    ok(it8.filter((b) => b.light).length === 0 && it8.filter((b) => b.cls === 11).length === 1 && M.carUniforms(s08, night, 50, 30).u_lamp[3] === 1, 'on the map: no light point, the ring round the car ahead, its lamps lit in acc_car');
    ok(J19.points.length === 0 && J19.objects.filter((o) => o.id === 't41')[0].lamp === 1 && J19.objects.filter((o) => o.id === 't41')[0].ring === 1 && J19.lead.lamp === 2, 'the object list (the fallback): each light is its road user by id (t41 headlamps, ringed; t42 the car ahead\'s tail lamps)');
    const it19 = M.sceneItems(M.GEO.map, s19, night);
    ok(it19.filter((b) => b.light).length === 0 && it19.filter((b) => b.cls <= 6 && b.lamp === 1 && b.ring === 1).length === 1, 'on the map: the oncoming car drawn once, its headlamps lit and ringed');
    // by place: a light of the stream within 1.6 m / 12 % of a road user is that road user
    const near = Object.assign({}, s08, { world: Object.assign({}, s08.world, { lead: null, objects: [{ id: 'c5', cls: 'truck', x: 62, y: 3.4, alpha: 1 }] }), beam: Object.assign({}, s08.beam, { lights: [{ id: 3, kind: 'head', x: 64, y: 3.6, ringed: false, src: 'light' }, { id: 4, kind: 'street', x: 62, y: 3.4, ringed: false, src: 'light' }] }) });
    const Jn = M.lightsOf(near, night);
    ok(Jn.objects[0].lamp === 1 && Jn.points.length === 1 && Jn.points[0].kind === 'street', 'by place: headlamps 2 m from a truck are its lamps; a street light never belongs to a road user');
    const far = Object.assign({}, near, { beam: Object.assign({}, near.beam, { lights: [{ id: 3, kind: 'head', x: 90, y: 3.6, ringed: false, src: 'light' }] }) });
    ok(M.lightsOf(far, night).points.length === 1 && M.lightsOf(far, night).objects[0].lamp === 0, 'a light 28 m from any road user is a point of its own');
    ok(M.lightsOf(s08, false).points.length === 0 && M.lightsOf(s08, false).lead.lamp === 0, 'by day: no light sources at all');
    // the pixels: the oncoming car's headlamps on the centre page are inside its own box (one thing), not a second blob
    const pgA = P.centre(s19, { night: true, lang: 'uk' }).px, pgB = P.centre(Object.assign({}, s19, { beam: Object.assign({}, s19.beam, { lights: [] }) }), { night: true, lang: 'uk' }).px;
    const box = M.sceneItems(M.GEO.centre, s19, true).filter((b) => b.cls <= 6 && b.ring)[0], g = M.GEO.centre;
    let inside = 0, outside = 0;
    for (let y = 206; y < 482; y++) for (let x = 50; x < 750; x++) {
        const i = (y * 1600 + x) * 4;
        if (Math.abs(pgA[i] - pgB[i]) + Math.abs(pgA[i + 1] - pgB[i + 1]) + Math.abs(pgA[i + 2] - pgB[i + 2]) < 24) continue;
        const qx = (x + 0.5 - g.lane[0] - box.cx) / box.h, qy = (y + 0.5 - g.lane[1] - (box.fy - box.h)) / box.h;
        if (Math.hypot(qx, qy - 0.5) <= 0.5 * Math.max(box.w / box.h, 1) + 0.25 + 0.2) inside++;     // the road user and its ring
        else if (!(Math.abs(x - (M.carRect(g, M.zOf(70), 0)[0] + M.carRect(g, M.zOf(70), 0)[2] / 2)) < 40)) outside++;
    }
    ok(inside > 5 && outside === 0, 'the centre page: the lights change pixels only on their road users (' + inside + ' inside, ' + outside + ' elsewhere)');
}

function partLoop() {
    const src = Cm.stripComments(fs.readFileSync(path.join(APPDIR, 'main.js'), 'utf8'));
    ok((src.match(/setInterval\(/g) || []).length === 1 && /setInterval\(tick, TICK_MS\)/.test(src), 'one loop: one timer (setInterval(tick, TICK_MS))');
    ok((src.match(/new MapView\(/g) || []).length === 1 && (fs.readFileSync(path.join(APPDIR, 'mapview.js'), 'utf8').match(/new this\.CR\.ClusterRender\(/g) || []).length === 1, 'one map connection: one MapView, one ClusterRender');
    ok((src.match(/ctx\.loop\(/g) || []).length === 1 && (src.match(/GP\.draw\(/g) || []).length === 1, 'one GPU page: one page loop, one gpu.draw');
    ok(/function step\(now\)/.test(src) && /const s = step\(Date\.now\(\)\);\s*\n\s*if \(st\.show && st\.mv\) st\.mapBytes \+= st\.mv\.update\(s/.test(src), 'the tick builds the state once (world, beam frame, decision) and the map draws that state');
    ok(/s\.beam = advise\(now\)/.test(src) && /const wd = world\(now\)/.test(src) && /st\.decider\.step\(C\.frameOf\(/.test(src), 'one tick: the world (world.js, lanes.js), then the beam frame (contract.js) and beam_logic\'s step');
    ok(!fs.readdirSync(APPDIR).some((f) => /^(view|ab_|mapview2)/.test(f)) && fs.readdirSync(path.join(APPDIR, 'shaders')).sort().join() === 'acc_car.glsl,acc_lane.glsl,acc_obj.glsl', 'no second set of layers: no Auto Beam view, map or shader of its own (ab_road / ab_lights gone)');
    ok(/new ACT\.NullActuator\(log\)/.test(src) && (src.match(/Actuator/g) || []).length === 1, 'the beam part\'s actuator stays the null one');
    // the hub: each interface watched once
    const watched = (src.match(/ctx\.signals\.watch\(/g) || []).length;
    ok(watched === 1 && /Object\.keys\(hub\)\.forEach/.test(src), 'each interface watched once (one watch call per interface through the hub)');
}

function partCosts() {
    const fake = new FakeCR(), mv = new MapView(null, { layer: app.config.layer, socket: 'x', shaders: sj });
    mv.CR = { ClusterRender: function () { return fake; } };
    mv.open();
    ok(fake.layers.length === 6 && fake.layers.length <= 8, 'layers on the map connection: 6 (8 allowed): ACC View\'s six, Auto Beam\'s three folded in');
    const imgs = fake.layers.filter((l) => l.kind === 'image').map((l) => l.o.iw * l.o.ih * 8);
    const pm = imgs.reduce((a, b) => a + b, 0);
    ok(pm === MapView.PIXEL_MEMORY && pm === 442240 && pm < 16 * 1048576, 'pixel memory ' + pm + ' B (two images counted twice): 2.6 % of the 16 MiB (ACC View 411 520 + Auto Beam 376 320 before)');
    ok(fake.layers.every((l) => !l.o.asset && !/sampler2D/.test(l.o.fs || '')), 'no sampler, no asset: nothing can be left unbound');
    const sizes = {}; Object.keys(sj).forEach((k) => { sizes[k] = Buffer.byteLength(sj[k]); });
    const tot = Object.keys(sizes).reduce((a, k) => a + sizes[k], 0);
    console.log('shader bytes shipped: ' + Object.keys(sizes).map((k) => k + ' ' + sizes[k]).join(', ') + ', together ' + tot + ' (before: acc_lane 2368, acc_obj 2061, acc_car 2257 = 6686; ab_road 3004, ab_lights 1303 = 4307)');
    ok(sizes.acc_lane < 3200 && sizes.acc_obj < 3600 && sizes.acc_car < 2600 && tot < 9500, 'each shader small (under 3.6 KB; the KOMBI reset near 26.7 KB), one look each, ' + tot + ' B together');
    ok(Object.keys(sj).every((k) => /#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;/.test(sj[k]) && !/sampler2D/.test(sj[k])), 'highp, no sampler in each');
    const uv = (k) => (sj[k].match(/uniform (vec[234]|float) \w+(\[(\d+)\])?;/g) || []).reduce((n, u) => n + (/\[(\d+)\]/.test(u) ? Number(/\[(\d+)\]/.exec(u)[1]) : 1), 0);
    console.log('uniform vectors: acc_lane ' + uv('acc_lane') + ', acc_obj ' + uv('acc_obj') + ', acc_car ' + uv('acc_car'));
    ok(uv('acc_obj') <= 36 && uv('acc_lane') <= 20, 'the light sources share acc_obj\'s 16 items (no second array): ' + uv('acc_obj') + ' uniform vectors, as many as ACC View\'s acc_obj had');
    mv.close();
}

function partAxle() {
    const P0 = CFG.path, Rr = P0.rearAxle, half = P0.carWidth / 2, len = 4.709;
    const lock = (deg, ms) => {
        const f = new Ln.Lanes(CFG);
        let o = null;
        for (let t = 0; t <= ms; t += 33) {
            f.motion({ v: { val: 0, at: t }, steer: { val: deg * Math.PI / 180, at: t, raw: 0 } });
            o = f.output(t);
        }
        return o;
    };
    [540, -540, 200].forEach((deg) => {
        const o = lock(deg, 9000), L = o.lines.filter((l) => l.key === 'gL')[0], Rt = o.lines.filter((l) => l.key === 'gR')[0];
        const tag = (deg > 0 ? 'left' : 'right') + ' ' + Math.abs(deg) + ' deg at a stop';
        const k = o.path.k;
        ok(o.verdict === 'predicted' && o.path.why === 'STANDING' && (deg > 0 ? k > 0 : k < 0) && (Math.abs(deg) < 400 || Math.abs(Math.abs(k) - 1 / P0.turnRadius) < 1e-9), tag + ': the corridor follows the wheels (R ' + (1 / Math.abs(k)).toFixed(1) + ' m)');
        ok(L && Rt && Math.min(Math.abs(L.c), Math.abs(Rt.c)) > (Math.abs(deg) > 400 ? 0.1 : 0.03), tag + ': it bends (edges ' + (L ? L.c.toFixed(3) : '-') + ' / ' + (Rt ? Rt.c.toFixed(3) : '-') + ' 1/m; 0.2.1 held it to 0.05)');
        ok([L, Rt].every((l) => Math.abs(l.a - l.c * Rr) < 1e-6), tag + ': both edges tangent to our car at the rear axle (heading 0 there)');
        let worst = 1e9;
        for (let x = -len; x <= 0.001; x += 0.1) [-half, half].forEach((y) => { worst = Math.min(worst, Wo.lineY(L, x) - y, y - Wo.lineY(Rt, x)); });
        ok(worst > 0.05, tag + ': our car (' + P0.carWidth + ' m wide, 4.71 m long, rear axle ' + Rr + ' m behind its front) inside the corridor from bumper to bumper (margin ' + worst.toFixed(2) + ' m)');
        // in the picture: the view follows our lane at our car (the rear axle), and the drawn car stands inside its lane
        const s = { world: { lanes: o } }, Cv = M.camOf(s), e = Wo.egoOf(o), xr = -M.EGO_X + M.EGO_REAR;
        ok(Math.abs(Cv - Wo.lineY(e, -Rr)) < 1e-9 && Math.abs(Wo.lineY(L, xr) + Cv) > 0, tag + ': the view follows our lane at the rear axle (' + Cv.toFixed(2) + ' m), not at x = 0 (' + e.y0.toFixed(2) + ' m)');
        const cy = -Cv, l = Wo.lineY(L, xr) - Cv, r = Wo.lineY(Rt, xr) - Cv;
        ok(cy - 0.9 > r && cy + 0.9 < l, tag + ': on the picture our drawn car stands inside the corridor (' + r.toFixed(2) + ' .. ' + l.toFixed(2) + ' around ' + cy.toFixed(2) + ')');
        const box = M.egoBox(M.GEO.map, { world: { lanes: o } });
        ok(box[0] >= 334 && box[0] + box[2] <= 754, tag + ': our car\'s layer stays in the core (' + box.join(' ') + ')');
    });
    // while the wheel turns, the corridor stays tangent at the axle (its curvature glides with y0 and the heading)
    const f = new Ln.Lanes(CFG);
    let worst = 0;
    for (let t = 0; t <= 8000; t += 33) {
        const sw = t < 1000 ? 0 : Math.min(1, (t - 1000) / 1500) * 540;
        f.motion({ v: { val: 0, at: t }, steer: { val: sw * Math.PI / 180, at: t, raw: 0 } });
        f.output(t).lines.forEach((l) => { if (l.g > 0.99) worst = Math.max(worst, Math.abs(l.a - l.c * Rr), Math.abs(Wo.lineY(l, -Rr)) > 3 ? 1 : 0); });
    }
    ok(worst < 0.01, 'turning the wheel to full lock in 1.5 s at a stop: the corridor tangent at the rear axle all the way (worst heading there ' + worst.toFixed(4) + ' rad)');
    // at speed the anchor changes nearly nothing: a 1/400 curve's corridor at our front stays within 2 cm and 0.01 rad of 0.2.1's
    const c400 = Ln.corridor(CFG.lanes, 1 / 400, 3.5, 50, P0), old = Ln.corridor(CFG.lanes, 1 / 400, 3.5, 50);
    ok(c400.every((l, i) => Math.abs(l.y0 - old[i].y0) < 0.02 && Math.abs(l.a - old[i].a) < 0.01 && Math.abs(l.c - old[i].c) < 2e-5), 'at speed (R 400 m) the anchored corridor is 0.2.1\'s within 2 cm (' + c400.map((l, i) => (l.y0 - old[i].y0).toFixed(3)).join(', ') + ' m)');
    ok(Ln.corridor(CFG.lanes, 0, 3.5, 50, P0).every((l, i) => l.y0 === [1.75, -1.75][i] && l.a === 0 && l.c === 0), 'straight: the corridor exactly as before (+-1.75 m)');
}

function partMeasured() {
    // the measured lanes' picture is unchanged: the view follows them at x = 0, as 0.1.0 and 0.2.1 did, byte for byte
    const shapes = [Ch.good(0, 0), Ch.good(1 / 500, 0.3), Ch.msg([5.2, 1.7, -1.8, -5.3].map((y) => Ch.bnd(y, { a: 0.02, c: 0.001, dc: 1e-5, len: 70 })), ['SOLID', 'DASHED', 'DASHED', 'CURB'])];
    let bad = 0;
    shapes.forEach((sh) => {
        const f = new Ln.Lanes(CFG);
        let o = null;
        for (let t = 0, i = 0; t <= 4000; t += 33) { while (i * Ch.RATE_MS <= t) { f.motion({ v: { val: 25, at: t } }); f.frame(sh, Math.round(i * Ch.RATE_MS), 25); i++; } o = f.output(t); }
        const oldCam = Object.assign({}, o.ego).y0;      // 0.2.1's camOf: our lane's offset at x = 0
        if (o.verdict !== 'measured' || o.ego.ax !== 0 || M.camOf({ world: { lanes: o } }) !== oldCam) bad++;
        [false, true].forEach((night) => {
            const a = JSON.stringify(M.laneUniforms(M.GEO.map, { world: { lanes: o } }, 0.2, night)), b = JSON.stringify(M.laneUniforms(M.GEO.map, { world: { lanes: o }, camY: oldCam }, 0.2, night));
            if (a !== b) bad++;
        });
    });
    ok(bad === 0, 'measured lanes (straight, a curve drifted 0.3 m, four clothoids with a heading): the view follows them at x = 0 exactly as 0.2.1 did; the map\'s uniforms byte for byte');
    // the demo's measured scenes (busy, lane change, curve) draw as ACC View 0.2.1 drew them: no anchor in a measured world
    ok(['busy', 'lanechange', 'curve'].every((n) => { const s = M.withScene(M.DEMO.filter((d) => d[2].scene === n)[0][2], 4000); return M.camOf(s) === Wo.egoOf(s.world.lanes).y0; }), 'the measured demo scenes: the view at x = 0, as before');
}

module.exports = async function run() {
    const p0 = Cm.T.pass, f0 = Cm.T.fail;
    partNames();
    partSettings();
    partLoop();
    partCosts();
    partAxle();
    partMeasured();
    partOnce();
    partScene();
    console.log('merged (the merge\'s own checks): ' + (Cm.T.pass - p0) + ' passed, ' + (Cm.T.fail - f0) + ' failed');
};
