'use strict';
/**
 * bench/road_scene/acc.js - ACC View's suite (bench/test-acc-view.js, round 1120 AA2 and fixes-1121 AL) carried over to Road Scene
 * (round fixes-1121 RS). Every check is kept or replaced by its merged equivalent: the manifest is the union of both apps'
 * (17 fields, 26 events), the map's text sheet spans the core (420 x 96: the beam advice joined it), the demo has 52 entries
 * (ACC View's 28, Auto Beam's 19 states and 5 scenes), amber is also the beam advice's disagreement at night, the shaders grew
 * with the beams and the light sources, the log lines of the app itself say "scene:".
 *
 * Part 1 (pure): the manifest, Node 8 syntax, no Cyrillic literal, the words (both languages, the atlases cover them), the
 * shaders, the model, what the sensors see (the decoders, the tracker, the lead, the log lines, the scenes), the scene on the map
 * through a recording stand-in, the map sheets and the centre page in every demo entry day and night, every word inside its
 * box, our own car, the GPU frames, diffRect / cut.
 * Part 2 (the bench): the app built by the kit and run against the fake cluster-render: the centre page, the layers, the raw
 * values fed and the pixels read back, the camera's objects and lanes, the limit, the night, closing fast, stale, our yaw rate.
 * Part 3 (WebGL): the three shaders compiled and drawn by headless Chrome's WebGL 1 (GLSL ES 1.00), with the beams and lights.
 * Part 4 (the emulator): the kit's emulator: frames while moving, none while still, no memory growth.
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const Cm = require('./common');

const ROOT = Cm.ROOT, APPDIR = Cm.APPDIR, PORT = Cm.PORT, CHROME = Cm.CHROME, args = Cm.args;
const ok = Cm.ok, CYR = Cm.CYR, stripComments = Cm.stripComments, near = Cm.near, FakeCR = Cm.FakeCR;
const request = (m, u, b) => Cm.request(m, u, b, PORT);
const stream = () => Cm.stream(PORT);
const readPng = Cm.readPng, sleep = Cm.sleep;

const M = require(path.join(APPDIR, 'model.js'));
const P = require(path.join(APPDIR, 'paint.js'));
const R = require(path.join(APPDIR, 'raster.js'));
const Wd = require(path.join(APPDIR, 'words.js'));
const MapView = require(path.join(APPDIR, 'mapview.js'));
const Wo = require(path.join(APPDIR, 'world.js'));
const GP = require(path.join(APPDIR, 'gpu.js'));
const Ln = require(path.join(APPDIR, 'lanes.js'));
const FV = require(path.join(ROOT, 'shared', 'front_vehicle.js'));
const SRC = require(path.join(ROOT, 'shared', 'limit_src.js'));
const T = { uk: require(path.join(ROOT, 'shared', 'i18n', 'uk.json')), en: require(path.join(ROOT, 'shared', 'i18n', 'en.json')) };

/** ACC View's census (amber, cyan, green, red; every opaque or partly drawn pixel). */
const census = (px, Q, x0, x1, w) => Cm.census(px, Q, x0, x1, w, 1);
/** fixes-1121 RS: amber is also the beam advice's disagreement (the high beam lit while it advises to dip), drawn at night only. */
const beamAmber = (s, night) => !!(night && s.beam && s.beam.disagree && M.adviceShown(s, night));

/* ------------------------------------------------------------------------------------------------ part 1 */
function part1() {
    const app = JSON.parse(fs.readFileSync(path.join(APPDIR, 'app.json'), 'utf8'));
    ok(app.id === 'road_scene' && app.loggingId === 'OARS' && /^OA[A-Z0-9]{2}$/.test(app.loggingId), 'id road_scene and a 4-char logging id (OARS)');
    ok(app.version === '0.1.0', 'version 0.1.0 (a new app)');
    const others = fs.readdirSync(path.join(ROOT, 'apps')).filter((a) => a !== 'road_scene').map((a) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', a, 'app.json'), 'utf8')); } catch (e) { return null; } }).filter(Boolean);
    ok(others.length >= 3 && others.every((a) => a.loggingId !== app.loggingId && a.id !== app.id), 'logging id and id unique among the apps');
    const flags = [];
    let methods = 0, broadcasts = 0;
    Object.keys(app.signals).forEach((i) => Object.keys(app.signals[i]).forEach((f) => {
        if (f[0] !== '_') flags.push(app.signals[i][f]);
        else if (f === '_methods') methods++;
        else if (f === '_broadcasts') broadcasts += app.signals[i][f].length;
    }));
    ok(flags.length === 17 && flags.every((x) => x === 's' || x === 'rs'), 'seventeen fields (ACC View\'s ten + Auto Beam\'s seven: the low beam, the lamps, the stalk, the brightness, the rain, the car\'s message, the lamps\' status), read-only flags only (s / rs), no setter');
    ok(methods === 0 && broadcasts === 26, 'no method; 26 events (ACC View\'s nine + the 15 light objects, the camera\'s verdict and its town signs)');
    ok(app.config.target === 'map' && app.config.layer.target === 'map' && app.config.layer.contend === false && app.config.layer.guideHold === 0, 'the map target, no contend, no guide hold');
    ok(app.settings.length === 6 && app.settings.filter((s) => s.type === 'bool' && s.key !== 'profileSets').every((s) => s.default === false)
        && app.settings.some((s) => s.key === 'lang' && s.default === 'auto'), 'six settings (both apps\' union): show and demo off by default, the language Авто');
    ok(app.settings[0].key === 'show' && app.settings[0].label === 'Показувати на щитку', 'the setting "Показувати на щитку"');
    ok(app.settings[1].label === 'Демо: стани по колу', 'the demo setting stays');
    ok(app.config.frontVehicle && app.config.frontVehicle.scale === null, 'the gap scale is unknown (no metres on screen)');
    ok(app.config.warn && app.config.warn.path === null && app.config.warn.active === null, 'the car\'s warning is never drawn until config.warn names it');
    ok(app.config.dayNight && app.config.dayNight.field === 'statusDayNightChangeOver', 'night from the car\'s day / night (Twin Dial\'s source)');
    const repo = JSON.parse(fs.readFileSync(path.join(ROOT, 'mgu-repo.json'), 'utf8'));
    ok(repo.apps && repo.apps.path === 'apps/*' && path.relative(path.join(ROOT, 'apps'), APPDIR) === 'road_scene', 'in the Store\'s "apps/*" (installable)');
    ok(!fs.existsSync(path.join(ROOT, 'tools', 'acc-view', 'app')), 'the skeleton\'s old place is gone');
    ok(fs.readdirSync(path.join(ROOT, 'tools', 'acc-view')).filter((f) => /\.(js|py)$/.test(f)).sort().join() === 'lane_gl.py,mockups.py', 'tools/acc-view keeps only the mockups');
    (app.shared || []).forEach((f) => ok(fs.existsSync(path.join(ROOT, 'shared', f)), 'shared ' + f + ' exists'));
    const scr = app.screens || [];
    ok(scr.length === 2 && scr[0].name === 'MAIN' && scr[0].kind === 'canvas' && scr[1].name === 'SETTINGS' && scr[1].kind === 'menu', 'the main screen is the app\'s own canvas page (and Auto Beam\'s settings menu with its status row)');
    ok(JSON.stringify((scr[0].buttons || []).map((b) => b[0])) === '["BTN_SETTINGS"]', 'its only button: the kit\'s Settings (no -/+)');
    // the signal check (non-zero getters for every "r"; notifiers for "s"), against every catalogue we have
    const cats = fs.existsSync(path.join(ROOT, 'reference', 'car')) ? fs.readdirSync(path.join(ROOT, 'reference', 'car')).map((d) => path.join(ROOT, 'reference', 'car', d, 'someip', 'someip-interfaces.json')).filter((f) => fs.existsSync(f)) : [];
    ok(cats.length >= 1, 'a catalogue to check against (' + cats.length + ')');
    cats.forEach((c) => {
        const r = spawnSync('python3', [path.join(ROOT, 'tools', 'signals', 'check_signals.py'), c, path.join(APPDIR, 'app.json')], { encoding: 'utf8' });
        ok(r.status === 0 && /all declarations pass/.test(r.stdout), 'check_signals.py passes against ' + path.basename(path.dirname(path.dirname(c))));
    });

    // the code: Node 8 syntax; read only; no Cyrillic literal in the drawing code; no pressable control
    const js = fs.readdirSync(APPDIR).filter((f) => /\.js$/.test(f));
    ok(js.sort().join() === 'actuator.js,beam_view.js,chaos.js,contract.js,gpu.js,inputs.js,lanes.js,main.js,mapview.js,model.js,paint.js,raster.js,scenes.js,score.js,srclog.js,words.js,world.js', 'the app\'s modules (ACC View\'s ten, Auto Beam\'s seven)');
    js.forEach((f) => {
        const s = stripComments(fs.readFileSync(path.join(APPDIR, f), 'utf8'));
        ok(!/\?\.|\?\?|\{\s*\.\.\.|,\s*\.\.\.\w+\s*\}|\.flat\(|\.flatMap\(|Object\.fromEntries|\.padEnd\(|\.trimStart\(/.test(s), f + ': Node 8 syntax (no ?. ?? object spread .flat)');
        ok(!/signals\.(set|call|proxy)|callMethod|setValue|standardCCMessage|extendedCCMessage|A19B/.test(s), f + ': read only (no setter, no method, no CC message, no A19B)');
        ok(!CYR.test(s), f + ': no Cyrillic string in the code (every word comes from shared/i18n through words.js)');
    });
    const mainSrc = stripComments(fs.readFileSync(path.join(APPDIR, 'main.js'), 'utf8'));
    ok(!/onClick|onTap|onTab|\.target\(|\.button\(|\bG\.frame\(|GA\.frame\(|controller\.grab/.test(mainSrc), 'main.js: no tap target, no click handler, no tab strip, no controller grab');
    const Rec = require(path.join(ROOT, 'kit', 'runtime', 'record.js'));
    const rc = new Rec.Recorder(1600, 520);
    Rec.setImage(0x52530001, P.PAGE_W, P.PAGE_H, Buffer.alloc(P.PAGE_W * P.PAGE_H * 4));
    rc.clear([0, 0, 0]); rc.image(0x52530001, 0, 38, P.PAGE_W, P.PAGE_H);
    ok(rc.targets.length === 0, 'the page as main.js records it has no pressable target');

    // the words: both languages, every key, the atlases hold every character
    // fixes-1121 RS: ACC View's table moved into shared/i18n as "rs.*" (Auto Beam's words stay "beam.*")
    const keys = Wd.KEYS;
    ok(keys.length >= 100 && keys.every((k) => T.uk[k] && T.en[k]), 'every word in uk and en (' + keys.length + ' keys, shared/i18n)');
    ok(keys.every((k) => !CYR.test(T.en[k])), 'no Cyrillic in the English table');
    ok(['title', 'ringCruise', 'limit', 'advice', 'pillWarn'].every((k) => CYR.test(Wd.word('uk', k))) && Wd.word('uk', 'near') === T.uk['rs.near'], 'the Ukrainian table is Cyrillic; a bare key is the family rs.*');
    ok(Wd.langOf('auto') === 'uk' && Wd.langOf(undefined) === 'uk' && Wd.langOf('en') === 'en' && Wd.langOf('de') === 'uk', 'Авто and anything unknown fall back to Ukrainian');
    const notoFonts = ['av_t16', 'av_t21', 'av_t27', 'av_b18', 'av_b26'];
    notoFonts.forEach((f) => ok(R.font(f) && R.missing(Wd.chars(), f) === '' && R.missing('0123456789 _-.·…—', f) === '', f + ': every character of both columns (Twin Dial\'s Noto)'));
    ['av_f26', 'av_f40', 'av_f56'].forEach((f) => ok(R.font(f) && R.missing('0123456789–', f) === '' && !Object.keys(R.font(f).glyphs).some((c) => CYR.test(c)), f + ': the figures (Saira; no Cyrillic in a Saira atlas)'));
    notoFonts.concat(['av_f26', 'av_f40', 'av_f56']).forEach((f) => { const j = JSON.parse(fs.readFileSync(path.join(APPDIR, 'hud', 'fonts', f + '.json'), 'utf8')); ok(j.width % 4 === 0 && /NotoSans|Saira/.test(j.source), f + ': width % 4 == 0, our OFL face'); });
    ok(R.sprite('car') && R.sprite('carFast') && R.sprite('car').w === 304, 'the car sprite (the acc_car shader\'s own output, baked) is there');

    // the shaders (carried over from the skeleton; now also: the shipped text is exactly hud/shaders.json)
    const SH = path.join(APPDIR, 'shaders');
    const shipped = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n') + '\n';
    const files = fs.readdirSync(SH).filter((f) => /\.glsl$/.test(f));
    const sj = JSON.parse(fs.readFileSync(path.join(APPDIR, 'hud', 'shaders.json'), 'utf8'));
    ok(files.length === 3 && Object.keys(sj).sort().join() === 'acc_car,acc_lane,acc_obj', 'three effect shaders (lane, road users, car ahead), all shipped');
    let total = 0;
    files.forEach((f) => {
        const src = fs.readFileSync(path.join(SH, f), 'utf8'), shp = shipped(src);
        total += Buffer.byteLength(shp);
        ok(sj[f.replace('.glsl', '')] === shp, f + ': hud/shaders.json is its shipped text (run node tools/road-scene/bake_shaders.js after a change)');
        ok(Buffer.byteLength(shp) < 8000, f + ': ' + Buffer.byteLength(shp) + ' B shipped, far under the KOMBI reset seen at 26.7 k (our car-proven shaders: 2.7-13 k)');
        ok(/#ifdef GL_FRAGMENT_PRECISION_HIGH\s*\nprecision highp float;/.test(shp), f + ': asks for highp (px distances over 256 overflow fp16)');
        ok(!/sampler2D|texture2D/.test(shp), f + ': no sampler (nothing to leave unbound)');
        ok(!/^#if(?!def GL_FRAGMENT_PRECISION_HIGH)|#else(?!\nprecision mediump)/m.test(shp.replace('#else\nprecision mediump float;', '')), f + ': no #if looks (one look per layer source)');
        ok(/varying vec2 v_uv;/.test(shp) && /gl_FragColor/.test(shp) && !/^\s*(in|out)\s/m.test(shp) && !/\btexture\(/.test(shp), f + ': GLSL ES 1.00 (varying, gl_FragColor)');
        ok(!/\b(all|any|not)\s*=/.test(shp), f + ': no built-in names reused as variables');
    });
    ok(total < 9500, 'the three shaders ship ' + total + ' B together (the KOMBI reset near 26.7 k; ACC View 0.2.1: 6 686 B, Auto Beam\'s two 4 307 B)');
    console.log('shaders shipped: ' + Object.keys(sj).map((k) => k + ' ' + Buffer.byteLength(sj[k]) + ' B').join(', ') + ', total ' + total + ' B');

    // the model (carried over)
    const fvc = FV.cfgOf(Object.assign({}, app.config.frontVehicle, { on: true }));
    let t = 0;
    const tr = FV.create(fvc, { clock: () => t });
    tr.start();
    let s = M.stateOf(tr.view(90), null, false);
    ok(s.data === 'none' && s.tgt === null, 'nothing yet: no target');
    t = 11000;
    s = M.stateOf(tr.view(90), null, false);
    ok(s.data === 'absent', 'nothing for 10 s: absent');
    for (let i = 0; i < 15; i++) { t += 100; tr.feed({ frontVehicleGapX: 420, frontVehicleSpeedX: 1500, frontVehicleObjectID: 7, qualifierEventDataFunctionFrontVehicle: 0, qualifierExtendedFunctionFrontVehicle: 0 }, 90); }
    s = M.stateOf(tr.view(90), null, false);
    ok(s.data === 'ok' && s.tgt === 3 && s.clo === 0, 'raw 420 at 90 km/h: level 3 (the assumed scale), not closing');
    t += 2500;
    s = M.stateOf(tr.view(90), null, false);
    ok(s.data === 'stale' && s.tgt === null, 'silence for 2.5 s: stale, the car goes (never a frozen car)');
    const hc = SRC.hudCruiseCfg({});
    const dds = (o) => Object.assign({ ldmSym: 'LDM_SYM_NONE', ldmSymColor: 'LDM_OFF', statusLimiter: 'STATUS_INACTIVE', cruiseCtrlSpeedHUD: 65535 }, o);
    ok(JSON.stringify(M.stateOf(null, SRC.hudCruiseOf(hc, dds({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 90 })), false).cru) === '["cruise","active",90]', 'cruise active 90');
    ok(JSON.stringify(M.stateOf(null, SRC.hudCruiseOf(hc, dds({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_OFF', cruiseCtrlSpeedHUD: 90 })), false).cru) === '["cruise","standby",90]', 'cruise standby 90');
    ok(JSON.stringify(M.stateOf(null, SRC.hudCruiseOf(hc, dds({ ldmSym: 'LDM_SYM_SLD', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 110 })), false).cru) === '["limiter","active",110]', 'limiter 110');
    ok(M.stateOf(null, SRC.hudCruiseOf(hc, dds({})), false).cru === null, '65535 / NONE: cruise off');
    const tc = SRC.tsrCfg({ tsr: {} });
    ok(M.stateOf(null, null, false, SRC.tsrOf(tc, { presentClassLimitSpeed: 8 }).kmh).lim === 40 && M.stateOf(null, null, false, null).lim === null, 'the limit: class 8 -> 40 km/h; none -> no figure');
    ok(M.DEMO.length === 52 && M.DEMO.map((d) => d[0]).join() === M.STATES.join() && M.ACC_N === 28, 'the 14 demo states, the 7 scenes and AL\'s 7 lane scenes (then Auto Beam\'s 19 states and 5 scenes: 52)');
    ok(M.DEMO.slice(14, 21).map((d) => d[2].scene).join() === Wo.SCENES.join() && Wo.SCENES.join() === 'busy,crossing,cyclist,cutin,lanechange,curve,nolanes', 'the scenes: busy, crossing, cyclist, cut-in, lane change, curve, no lanes');
    ok(M.DEMO.slice(21, 28).map((d) => d[2].scene).join() === 'lost,lostcurve,oneedge,flicker,junction,town,standing', 'AL\'s lane scenes: lost, lost in a curve, one edge, flicker, junction, town, standing');

    // E on the map target: 4 layers, sizes, places, pixel memory; no pixels while the car glides
    const fake = new FakeCR();
    const mv = new MapView(function () { return fake; }, { layer: app.config.layer, socket: 'x', shaders: sj });
    mv.cr = null;
    mv.CR = { ClusterRender: function () { return fake; } };
    mv.open();
    ok(fake.layers.length === 6 && fake.layers.map((l) => l.kind).join() === 'effect,effect,effect,effect,image,image', 'E on the map: 6 layers (lane, road users, car ahead, our car: effects; text and pill sheets)');
    ok(fake.layers.every((l) => l.o.target === 'map' && l.o.contend === false && l.o.guide_hold === 0), 'every layer on map, no contend, guide_hold 0');
    ok(fake.layers.map((l) => l.o.z).join() === '0,1,2,3,4,5', 'z order: lane, road users, car ahead, our car, text, pill');
    const L0 = fake.layers.map((l) => l.o), L = [L0[0], L0[2], L0[4], L0[5]];
    ok(L0[3].fs === sj.acc_car && L0[3].visible !== false && L0[3].x === M.egoBox(M.GEO.map, {})[0], 'our car: the same acc_car source (no new shader), shown from the start');
    ok(L0[1].x === 334 && L0[1].y === 198 && L0[1].w === 420 && L0[1].h === 218 && L0[1].fs === sj.acc_obj, 'road users effect: the lane\'s box, the shipped acc_obj');
    ok(L[0].x === 334 && L[0].y === 198 && L[0].w === 420 && L[0].h === 218 && L[0].fs === sj.acc_lane, 'lane effect 420 x 218 at (334, 198), the shipped acc_lane');
    ok(L[1].fs === sj.acc_car && L[1].visible === false, 'car effect: the shipped acc_car, hidden until there is a car');
    ok(L[2].x === 334 && L[2].y === 54 && L[2].w === 420 && L[2].h === 96 && L[2].iw === 420, 'text sheet 420 x 96 at (334, 54) (the beam advice on its left)');
    ok(L[3].x === 374 && L[3].y === 150 && L[3].w === 340 && L[3].h === 44, 'pill sheet 340 x 44 at (374, 150): above the lane, never over our car');
    ok([L[0], L[2], L[3]].every((o) => o.x >= 334 && o.x + o.w <= 754 && o.y >= 44 && o.y + o.h <= 416), 'every fixed layer inside the core x 334..754, y 44..416');
    for (let lv = 1; lv <= 5; lv++) {
        const b = M.carBox(M.GEO.map, M.depthOf(lv));
        ok(b[0] >= 334 && b[0] + b[2] <= 754 && b[1] >= 44 && b[1] + b[3] <= 416, 'the car at level ' + lv + ' inside the core (' + b.join(' ') + ')');
    }
    const b1 = M.carBox(M.GEO.map, M.depthOf(1)), b5 = M.carBox(M.GEO.map, M.depthOf(5));
    const eb = M.egoBox(M.GEO.map, {});
    ok(eb[2] > b1[2] && b1[2] > b5[2] && eb[1] + eb[3] <= 416 && eb[0] >= 334 && eb[0] + eb[2] <= 754, 'our car (' + eb.join(' ') + ') larger than the car ahead at level 1 (' + b1.join(' ') + ') and 5 (' + b5.join(' ') + '), inside the core');
    ok(b1[1] + b1[3] < eb[1] + eb[3] - 10, 'the car ahead at level 1 stands above our car (the gap visible between them)');
    ok(MapView.PIXEL_MEMORY === 442240 && L[2].w % 4 === 0 && L[3].w % 4 === 0, 'pixel memory (420 x 96 + 340 x 44) x 8 = 442 240 B; widths % 4 == 0');
    ok(fake.layers.filter((l) => l.kind === 'image').length * 1 <= 8 && fake.layers.length <= 8, 'under the 8-layer cap of a connection');
    const st3 = M.DEMO[3][2];
    mv.update(st3, M.depthOf(3), false, 'uk');
    const first = fake.msgs.filter((m) => m.op === 'pixels').reduce((a, m) => a + m.bytes, 0);
    ok(first > 0 && first <= 420 * 96 * 4 + 340 * 44 * 4, 'the first picture: the sheets\' changed rectangles (' + first + ' B)');
    const n0 = fake.msgs.length;
    let z = M.depthOf(3), setN = 0;
    [5, 4, 3, 2, 1].forEach((lv) => {
        const s2 = Object.assign({}, st3, { tgt: lv });
        const zt = M.depthOf(lv);
        for (let k = 0; k < 6; k++) { z += (zt - z) * 0.5; mv.update(s2, z, false, 'uk'); }
        mv.update(s2, zt, false, 'uk');
    });
    const glide = fake.msgs.slice(n0);
    setN = glide.filter((m) => m.op === 'set').length;
    ok(glide.filter((m) => m.op === 'pixels').length === 0, 'the car gliding across all five levels: 0 pixel uploads');
    ok(setN >= 20 && glide.every((m) => m.op === 'set' || m.op === 'uniform'), 'the glide is the car layer\'s move / resize and uniforms only (' + setN + ' sets)');
    const per = glide.reduce((a, m) => a + m.bytes, 0) / Math.max(1, glide.filter((m) => m.op === 'set').length);
    ok(per < 600, 'a glide step costs a few hundred bytes of messages (' + Math.round(per) + ' B)');
    ok(glide.filter((m) => m.op === 'uniform' && m.name === 'u_line').length === 0, 'the lane lines never change while the car moves');
    // the road users moving: a busy scene over 3 s at the 150 ms tick: uniforms only, no pixels; the budget
    const k0 = fake.msgs.length;
    for (let ms = 0; ms <= 3000; ms += 150) mv.update(M.withScene(M.DEMO[14][2], ms), M.depthOf(3), false, 'uk');
    const moving = fake.msgs.slice(k0);
    ok(moving.filter((m) => m.op === 'pixels').length === 0, 'busy traffic moving for 3 s: 0 pixel uploads');
    const ob = moving.filter((m) => m.name === 'u_ob');
    ok(ob.length >= 10 && ob.every((m) => m.type === 'vec4' && m.v.length === 64), 'the road users: u_ob as 16 vec4 a tick (' + ob.length + ' updates)');
    const perTick = moving.reduce((a, m) => a + m.bytes, 0) / 21;
    console.log('map: busy traffic ' + Math.round(perTick) + ' B of messages a 150 ms tick (' + Math.round(perTick / 0.15) + ' B/s), no pixels');
    ok(perTick < 3000, 'busy traffic: under 3 KB of messages a tick (' + Math.round(perTick) + ' B)');
    const u16 = M.objUniforms(M.GEO.map, { world: { objects: Array.apply(null, Array(20)).map((x, i) => ({ id: i, cls: Wo.CLS[i % 6], x: 8 + i * 4, y: (i % 3 - 1) * 3.5 })) } }, false);
    ok(u16.u_ob.length === 64 && u16.u_ob.filter((v, i) => i % 4 === 3 && v > 0).length === 16, '20 road users reported: the 16 nearest drawn (the shader\'s budget)');
    // costs per event (for the report)
    const costs = {};
    const cost = (name, a, b, nb) => { mv.update(a, a.tgt ? M.depthOf(a.tgt) : 0, false, 'uk'); const k1 = fake.msgs.length; mv.update(b, b.tgt ? M.depthOf(b.tgt) : 0, !!nb, 'uk'); costs[name] = fake.msgs.slice(k1).filter((m) => m.op === 'pixels').reduce((x, m) => x + m.bytes, 0); };
    cost('set speed 90 -> 110', M.DEMO[3][2], Object.assign({}, M.DEMO[3][2], { cru: ['cruise', 'active', 110] }));
    cost('active -> standby', M.DEMO[3][2], M.DEMO[8][2]);
    cost('limit 90 -> 110', M.DEMO[3][2], Object.assign({}, M.DEMO[3][2], { lim: 110 }));
    cost('closing fast starts', M.DEMO[3][2], M.DEMO[6][2]);
    cost('suggestion appears', M.DEMO[9][2], Object.assign({}, M.DEMO[9][2], { adv: 96 }));
    cost('target lost', M.DEMO[3][2], M.DEMO[1][2]);
    cost('warning (all dims)', M.DEMO[4][2], M.DEMO[12][2]);
    cost('no change', M.DEMO[3][2], M.DEMO[3][2]);
    cost('day -> night', M.DEMO[3][2], M.DEMO[3][2], true);
    console.log('map upload per change (B): ' + Object.keys(costs).map((k) => k + ' ' + costs[k]).join(', '));
    ok(costs['set speed 90 -> 110'] > 0 && costs['set speed 90 -> 110'] <= 420 * 96 * 4, 'a set-speed change uploads only within the text sheet');
    ok(costs['no change'] === 0, 'nothing changed: nothing sent');
    ok(costs['day -> night'] > 0 && costs['day -> night'] <= 420 * 96 * 4, 'day -> night: the text sheet again (the effects take uniforms)');
    mv.close();
    ok(fake.closed === true && mv.cr === null, 'off: the connection closed');

    // the map's uniforms: the lane lines a fixed symbol; amber only while closing fast
    [false, true].forEach((night) => {
        const lines = {}, gapc = {};
        M.DEMO.forEach((d) => { const u = M.laneUniforms(M.GEO.map, M.withScene(d[2], 3000), M.depthOf(d[2].tgt), night); lines[u.u_line.join()] = 1; gapc[d[0]] = u.u_gapc; });
        ok(Object.keys(lines).length === 1, 'map ' + (night ? 'night' : 'day') + ': the lane lines one colour in all ' + M.DEMO.length + ' states and scenes');
        const amb = M.colours('map', night).amberF.map((c) => Math.round(c * 1e4) / 1e4).join();
        ok(M.DEMO.every((d) => (gapc[d[0]].join() === amb) === (d[2].clo === 2)), 'map ' + (night ? 'night' : 'day') + ': the gap and chevrons amber only while closing fast');
        ok(M.DEMO.every((d) => { const u = M.carUniforms(d[2], night, 100, 60); return (u.u_body[2] < 0.5 * u.u_body[0]) === (d[2].clo === 2); }), 'map ' + (night ? 'night' : 'day') + ': the car amber-tinted only while closing fast');
    });

    // the sheets and the centre page in every state, day and night, both languages
    M.DEMO.forEach((d0) => {
        const d = [d0[0], d0[1], M.withScene(d0[2], 3000)];
        [false, true].forEach((night) => {
            const tag = d[0] + ' ' + d[1] + (night ? ' night' : ' day');
            const Qm = M.colours('map', night), Qc = M.colours('centre', night);
            const tx = P.textSheet(d[2], night, 'uk'), pl = P.pillSheet(d[2], night, 'uk');
            ok(tx.length === 420 * 96 * 4 && pl.length === 340 * 44 * 4, tag + ': map sheets\' sizes');
            const cm = census(Buffer.concat([tx, pl]), Qm);
            ok(cm.red === 0, tag + ': map sheets: no red pixel');
            const pg = P.centre(d[2], { night, lang: 'uk', info: { age: 0.5 } });
            ok(pg.px.length === 1600 * 482 * 4, tag + ': centre page size');
            const cc = census(pg.px, Qc);
            ok(cc.red === 0, tag + ': centre page: no red pixel');
            if (!d[2].warn) {
                ok((cm.amber > 0) === (d[2].clo === 2 || beamAmber(d[2], night)), tag + ': map: amber only while closing fast (or the beam advice\'s disagreement at night) (' + cm.amber + ')');
                ok((cm.cyan > 0) === !!d[2].adv, tag + ': map: cyan only with a suggestion (' + cm.cyan + ')');
                ok((cm.green > 0) === !!(d[2].cru && d[2].cru[1] === 'active'), tag + ': map: green only with an active cruise / limiter (' + cm.green + ')');
                ok((cc.amber > 0) === (d[2].clo === 2 || beamAmber(d[2], night)), tag + ': centre: amber only while closing fast (or the beam advice\'s disagreement at night) (' + cc.amber + ')');
                ok((cc.cyan > 0) === !!d[2].adv, tag + ': centre: cyan only with a suggestion (' + cc.cyan + ')');
                ok((cc.green > 0) === !!(d[2].cru && d[2].cru[1] === 'active'), tag + ': centre: green only with an active cruise / limiter (' + cc.green + ')');
            } else {
                const e = census(pg.px, Qc, 0, 800, 1600);
                ok(e.green === 0 && e.cyan === 0, tag + ': the warning: our picture steps back (no full-colour green or cyan left in E)');
            }
            ['uk', 'en'].forEach((lang) => {
                const r = lang === 'uk' ? pg : P.centre(d[2], { night, lang, info: { age: 0.5 } });
                const out = r.words.filter((w) => w.x < w.x0 - 0.5 || w.x + w.w > w.x1 + 0.5);
                ok(out.length === 0, tag + ' ' + lang + ': every word inside its box' + (out.length ? ' (' + out.map((w) => w.key).join(', ') + ')' : ''));
                ok(r.words.every((w) => R.missing(w.str, 'av_t27') === ''), tag + ' ' + lang + ': no character missing from the atlas');
            });
        });
    });
    // the lane line is the same pixel in every state (a fixed symbol), and the ring's word on the map fits in both languages
    const gC = M.GEO.centre, rowY = gC.lane[1] + gC.lane[3] - 12;
    const pr = (() => { const H = gC.lane[3], hy = M.HZ * H, t = (rowY + 0.5 - gC.lane[1] - hy) / (H - hy); return Math.round(gC.lane[0] + gC.lane[2] / 2 + 1.75 * gC.pxm * t - 0.5); })();
    const linePx = (s) => { const p = P.centre(s, { night: false, lang: 'uk' }).px; const i = (rowY * 1600 + pr) * 4; return p.slice(i, i + 3).join(); };
    const ref = linePx(M.DEMO[2][2]);
    ok(['03', '05', '07', '08', '12', '14'].every((n) => linePx(M.DEMO[Number(n) - 1][2]) === ref) && ref.split(',')[2] > 150, 'the centre page\'s lane line (no lane data: the symbol): the same colour in every state (' + ref + ')');
    ['ringCruise', 'ringPause', 'ringLimiter', 'ringOff', 'limit', 'advice'].forEach((k) => ['uk', 'en'].forEach((l) => {
        const w = Wd.word(l, k), f = k.indexOf('ring') === 0 ? 'av_b18' : 'av_t16';
        ok(R.textWidth(w, f, R.fit(w, f, k.indexOf('ring') === 0 ? 18 : 16, k === 'limit' ? 58 : 104)) <= (k === 'limit' ? 58 : 104), 'map: "' + w + '" fits its place');
    }));
    ['pillNoData', 'pillNoTarget', 'pillStale', 'pillFast', 'pillPaused', 'pillWarn'].forEach((k) => ['uk', 'en'].forEach((l) => {
        const w = Wd.word(l, k), f = k === 'pillWarn' ? 'av_b18' : 'av_t21', s = R.fit(w, f, 20.2, 296);
        ok(R.textWidth(w, f, s) <= 296 && s >= 15, 'map pill: "' + w + '" fits (size ' + s + ')');
    }));
    // the Cyrillic drawn: Ukrainian words put ink on the page, from glyphs that have ink
    const ink = (str) => { const cv = new R.Canvas(400, 60, [0, 0, 0]); cv.text(str, 4, 44, 'av_t27', 27, [255, 255, 255], 'left'); let n = 0; for (let i = 0; i < cv.px.length; i += 4) if (cv.px[i] > 128) n++; return n; };
    ok(ink('Авто попереду') > 300 && ink('ЇЄҐїєґ') > 100, 'Cyrillic words drawn (ink from the Noto atlas)');
    const f27 = R.font('av_t27');
    ok('АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя'.split('').every((c) => f27.glyphs[c] && f27.glyphs[c].w > 0), 'the whole Ukrainian alphabet has glyphs with ink');
    const uk = P.centre(M.DEMO[3][2], { lang: 'uk' }), en = P.centre(M.DEMO[3][2], { lang: 'en' });
    ok(uk.words.some((w) => CYR.test(w.str)) && !en.words.some((w) => CYR.test(w.str)) && R.diffRect(uk.px, en.px, 1600, 482) !== null, 'the page in uk draws Cyrillic, in en none');
    // the cached empty lane + the gap computed over it = the whole lane computed at once, in every state
    let lm = 0;
    M.DEMO.forEach((d0) => [false, true].forEach((night) => {
        const s = M.withScene(d0[2], 3000), ld = M.leadOf(s), z = ld ? ld.x / M.RANGE : 0;
        const Pc = M.colours('centre', night), g = M.GEO.centre;
        const a = new R.Canvas(1600, 482, Pc.bg); P.lane(a, g, s, z, Pc, 0);
        const b = new R.Canvas(1600, 482, Pc.bg); P.lane(b, g, { tgt: null, clo: 0, world: s.world ? { lanes: s.world.lanes } : null, beam: s.beam, e: s.e }, 0, Pc, 0);
        if (ld) P.lane(b, g, s, z, Pc, 0, true);
        if (R.diffRect(a.px, b.px, 1600, 482)) lm++;
    }));
    ok(lm === 0, 'the centre lane: cached lanes (with our beams) + gap = the whole computation, all ' + M.DEMO.length * 2 + ' pictures (' + lm + ' differ)');
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) P.centre(M.DEMO[i + 2][2], { lang: 'uk' });
    console.log('centre page paint: ' + Math.round((Date.now() - t0) / 5) + ' ms on this Mac (Node ' + process.version + ')');

    // our own car (the owner, 2026-11-20: "а чому не малюється наше авто?"): in every state and scene, day and night, on the
    // centre page and the map, inside its lane
    const egoIn = (s) => { const l = (s.world && s.world.lanes) || Wo.FIXED, e = Wo.egoOf(l), C = M.camOf(s), x = -M.EGO_X + M.EGO_REAR; return Math.abs(-C - (e.y0 + x * (e.a + 0.5 * e.c * x))) < e.half - 0.9; };
    const fakeE = new FakeCR();
    const mvE = new MapView(null, { layer: app.config.layer, socket: 'x', shaders: sj });
    mvE.CR = { ClusterRender: function () { return fakeE; } };
    mvE.open();
    let egoBad = [];
    M.DEMO.forEach((d0) => [false, true].forEach((night) => {
        const s = M.withScene(d0[2], 3000), tag = d0[0] + (night ? ' night' : ' day');
        const pg = P.centre(s, { night, lang: 'uk' }).px, r = M.egoRect(M.GEO.centre, s);
        let light = 0, n = 0;
        for (let y = Math.ceil(r[1]); y < Math.floor(r[1] + r[3]); y++) for (let x = Math.ceil(r[0]); x < Math.floor(r[0] + r[2]); x++) {
            const i = (y * 1600 + x) * 4; n++;
            if (pg[i] > (night ? 120 : 165) && pg[i + 1] > (night ? 120 : 165) && pg[i + 2] > (night ? 120 : 165)) light++;
        }
        // fixes-1121 RS: while the car shows a message of its own (Auto Beam's yield) the scene steps back and the map's layers hide
        const yld = !!(s.beam && s.beam.yield);
        if (!(light > n * 0.15) && !s.warn && !yld) egoBad.push(tag + ' centre ' + light + '/' + n);
        mvE.update(s, 0.2, night, 'uk');
        const lo = fakeE.layers[3].o, eb = M.egoBox(M.GEO.map, s);
        if (yld ? lo.visible !== false : !(lo.x === eb[0] && lo.w === eb[2] && lo.visible !== false && eb[0] >= 334 && eb[0] + eb[2] <= 754)) egoBad.push(tag + ' map');
        if (!egoIn(s)) egoBad.push(tag + ' lane');
    }));
    ok(egoBad.length === 0, 'our car: drawn light at the foot on the centre page and as a layer on the map, inside its lane, in all ' + M.DEMO.length + ' entries day and night' + (egoBad.length ? ' (' + egoBad.slice(0, 6).join(', ') + ')' : ''));
    const k0e = fakeE.msgs.length, x0e = fakeE.layers[3].o.x;
    let xs = {};
    for (let ms = 0; ms <= 10000; ms += 150) { mvE.update(M.withScene(M.DEMO[18][2], ms), 0.3, false, 'uk'); xs[fakeE.layers[3].o.x] = 1; }
    const lcm = fakeE.msgs.slice(k0e);
    ok(Object.keys(xs).length > 5 && lcm.filter((m) => m.op === 'set' && m.ref === 4).length > 5, 'a lane change: our car moves across on the cluster (' + Object.keys(xs).length + ' places)');
    ok(lcm.filter((m) => m.op === 'pixels').length <= 2, 'a lane change: our car and the lanes move with sets and uniforms; pixels only when the lead\'s level changes the pill (' + lcm.filter((m) => m.op === 'pixels').length + ')');
    ok(M.egoBox(M.GEO.map, { world: { lanes: { lines: [{ y0: 2.75, a: 0, c: 0, len: 80, type: 'solid', prob: 1 }, { y0: -0.75, a: 0, c: 0, len: 80, type: 'solid', prob: 1 }] } } })[0] > M.egoBox(M.GEO.map, {})[0], 'drifted right in our lane (its centre 1 m to our left): our car is drawn right of the lane centre, the view follows the lane');
    void x0e;

    // the centre page on the GPU renderer (gpu.js): every state and scene records cleanly, in ops the kit's mgu-render/1
    // rewrite knows (no QUAD, op 15: renderd.js nativeOps stops there and breaks the image ops after it), the same frame for
    // the same state (no frame while still), a new frame while something moves
    const KNOWN = { 1: 1, 16: 1, 2: 5, 4: 6, 9: 6, 5: 7, 7: 8, 8: 11, 12: 3, 17: 3, 13: 4, 14: 0, 18: 6 };
    const walk = (u) => {
        let i = 0, imgs = 0;
        const ops = {};
        while (i < u.length) {
            const op = u[i++];
            ops[op] = (ops[op] || 0) + 1;
            if (op === 18) imgs++;
            if (op === 3) i += 5 + 2 * u[i + 4]; else if (op === 6) i += 6 + 2 * u[i + 5]; else if (op === 10) i += 1 + 9 * u[i]; else if (op === 11) i += 3 + 8 * u[i + 2];
            else if (KNOWN[op] !== undefined) i += KNOWN[op]; else return { ok: false, op, ops, imgs };
        }
        return { ok: i === u.length, ops, imgs };
    };
    Rec.setImage(0x52530002, 800, 204, Buffer.alloc(800 * 204 * 4)); Rec.setImage(0x52530003, 800, 482, Buffer.alloc(800 * 482 * 4));
    ['car', 'carFast', 'ego'].forEach((n, i) => { Rec.setImage(0x52530010 + i * 2, 4, 4, Buffer.alloc(64)); Rec.setImage(0x52530011 + i * 2, 4, 4, Buffer.alloc(64)); });
    const IDS = { band: 0x52530002, table: 0x52530003, sprites: { car: [0x52530010, 0x52530011], carFast: [0x52530012, 0x52530013], ego: [0x52530014, 0x52530015] } };
    const frameOf = (s, night) => { const rc = new Rec.Recorder(1600, 520); GP.draw(rc, s, { night, lang: 'uk' }, IDS); return { w: new Uint32Array(rc.words()), targets: rc.targets.length }; };
    let gpuBad = [], words = 0;
    M.DEMO.forEach((d0) => [false, true].forEach((night) => {
        const s = M.withScene(d0[2], 3000), f = frameOf(s, night), wk = walk(f.w);
        words = Math.max(words, f.w.length);
        const lead = !!M.leadOf(s);
        if (!wk.ok || wk.ops[15] || wk.imgs !== (lead ? 4 : 3) || f.targets) gpuBad.push(d0[0] + (night ? 'n' : 'd') + ':' + JSON.stringify(wk.ops) + ' imgs ' + wk.imgs);
    }));
    ok(gpuBad.length === 0, 'GPU frames: all ' + M.DEMO.length * 2 + ' record cleanly, no QUAD, the band, the table and our car as images (+ the car ahead), no tap target' + (gpuBad.length ? ' (' + gpuBad.slice(0, 3).join('; ') + ')' : ''));
    console.log('gpu: the largest frame ' + words + ' words (' + Math.round(words * 4 / 1024) + ' KB)');
    ok(words < 12000, 'a GPU frame stays small (' + words + ' words)');
    const st1 = M.withScene(M.DEMO[3][2], 0), fa = frameOf(st1, false).w, fb = frameOf(st1, false).w;
    ok(fa.length === fb.length && fa.every((v, i) => v === fb[i]), 'the same state: the same frame word for word (main.js sends nothing then)');
    const fm1 = frameOf(M.withScene(M.DEMO[14][2], 3000), false).w, fm2 = frameOf(M.withScene(M.DEMO[14][2], 3033), false).w;
    ok(fm1.length !== fm2.length || fm1.some((v, i) => v !== fm2[i]), 'busy traffic 33 ms later: a new frame (it moves)');
    const t0g = Date.now();
    for (let i = 0; i < 100; i++) frameOf(M.withScene(M.DEMO[14][2], i * 33), false);
    console.log('gpu: recording a busy frame ' + ((Date.now() - t0g) / 100).toFixed(2) + ' ms on this Mac');

    // what the sensors see: the decoders (the catalogue's shapes), the tracker, the lead, the log
    const wc = Wo.cfgOf({});
    const slot = (n, f) => Array.apply(null, Array(40)).map((x, i) => (i < n ? f(i) : {}));
    const rec = { numberOfObjects: 3, objectRecognitionInfo: slot(3, (i) => ({ classificationType: ['CAR_WITH_OR_WITHOUT_TRAILER', 'PEDESTRIAN', 'ROAD_BOUNDARY'][i], objectID: 10 + i, drivingTubeMapping: 'OBJECT_IN_EGO_LANE' })) };
    const pos = { numberOfObjects: 3, objectPositionInfo: slot(3, (i) => ({ positionX: [25.5, 12, 30][i], positionY: [0.2, -3, 4][i] })), objectDimensionInfo: slot(3, () => ({ width: 1.9 })) };
    const co = Wo.camObjects(wc, rec, pos);
    ok(co.length === 2 && co[0].cls === 'car' && co[0].x === 25.5 && co[0].wid === 1.9 && co[1].cls === 'ped' && co[1].id === 'c11', 'camera objects: class, place, width, id; a road boundary is not a road user');
    ok(Wo.camObjects(Wo.cfgOf({ objects: { ySign: -1 } }), rec, pos)[1].y === 3, 'config.world.objects.ySign flips the side (a hypothesis until a drive)');
    ok(Wo.camObjects(wc, rec, { numberOfObjects: 1, objectPositionInfo: [{ positionX: 300, positionY: 0 }] }).length === 0 && Wo.camObjects(wc, null, null).length === 0, 'out of range or nothing: no object, no exception');
    const tcp = Wo.tcpObjects(wc, { numberOfObjects: 1, objectListSmall: [{ summary: { id: 4 }, position: { x: { value: 18 }, y: { value: -3.4 } }, classification: { class_car: 10, class_bicycle: 80 } }] });
    ok(tcp.length === 1 && tcp[0].cls === 'cyc' && tcp[0].x === 18 && tcp[0].id === 't4', 'the object list (EmMeter, class percentages): the likeliest class');
    const lb = { laneRecognitionFront: { widthEgoLane: 3.6 }, laneBoundaryFront: [
        { modelQualifier: 'LANE_BOUNDARY_MODEL_AVAILABLE', existenceProbability: 0.9, pointSegment1: { y: -1.8 }, baseSegment1: { angle: 0.01, curvature: 0.002 }, parametersSegment1: { validLength: 60, curvatureChange: 0 }, parametersSegment2: { validLength: 20 } },
        { modelQualifier: 'LANE_BOUNDARY_MODEL_AVAILABLE', existenceProbability: 0.9, pointSegment1: { y: 1.7 }, baseSegment1: { angle: 0.01, curvature: 0.002 }, parametersSegment1: { validLength: 60 } },
        { modelQualifier: 'LANE_BOUNDARY_MODEL_NOT_AVAILABLE', pointSegment1: { y: 5 } },
        { modelQualifier: 'LANE_BOUNDARY_MODEL_AVAILABLE', existenceProbability: 0.1, pointSegment1: { y: -5 } }],
        laneBoundaryPropertiesFront: [{ typeInfo: { type: 'DASHED' } }, { typeInfo: { type: 'SOLID' } }, {}, {}] };
    const lm2 = Wo.laneModel(wc, lb);
    ok(lm2 && lm2.lines.length === 2 && lm2.lines[0].y0 === 1.7 && lm2.lines[0].type === 'solid' && lm2.lines[1].type === 'dashed' && lm2.lines[1].len === 80 && lm2.lines[1].c === 0.002, 'lane boundaries: usable ones only, left to right, type, curvature, valid length');
    ok(Wo.laneModel(wc, {}) === null && Wo.egoOf(null).half === 1.75 && Math.abs(Wo.egoOf(lm2).y0 + 0.05) < 1e-9, 'no lane model: the fixed symbol; the ego lane between the nearest lines');
    const tk = new Wo.Tracker(wc, ['cam']);
    tk.update('cam', [{ id: 'a', cls: 'car', x: 30, y: 0 }], 0);
    tk.update('cam', [{ id: 'a', cls: 'car', x: 20, y: 0 }], 100);
    const f1 = tk.frame(200);
    ok(f1.length === 1 && f1[0].x < 30 && f1[0].x > 20 && f1[0].alpha === 1, 'the tracker: an object glides toward its new place');
    const f2 = tk.frame(100 + wc.objects.lostMs + wc.objects.fadeMs / 2);
    ok(f2.length === 1 && f2[0].alpha > 0.3 && f2[0].alpha < 0.7, 'lost: it fades (alpha ' + (f2[0] && f2[0].alpha.toFixed(2)) + ')');
    ok(tk.frame(100 + wc.objects.lostMs + wc.objects.fadeMs + 50).length === 0, 'then it is gone: never a frozen object');
    ok(Wo.leadOf([{ cls: 'car', x: 40, y: 3.5 }, { cls: 'car', x: 30, y: 0.3 }, { cls: 'ped', x: 10, y: 0 }], null).x === 30, 'the lead: the nearest vehicle in our lane (a pedestrian is never the lead)');
    const lg = new Wo.SourceLog('cam', 10000);
    lg.add(co, 'EVENT_DATA_AVAILABLE');
    const line = lg.line(0) || '';
    ok(/^acc: src cam first n 1 rate -\/s objs 2\.\.2 cls car 1 ped 1 x 12\.0\.\.25\.5 m y -3\.0\.\.0\.2 m q EVENT_DATA_AVAILABLE 1$/.test(line), 'the log: counts, classes, relative metres, qualifiers (numbers and enum names only)');
    lg.add(co, null); lg.add(co, null);
    ok(lg.line(5000) === null && /n 2 rate 0\.2\/s/.test(lg.line(10000) || ''), 'then one summary per 10 s with the rate');
    // the scenes: each one moves, has road users or lanes, the budget holds
    Wo.SCENES.forEach((n) => {
        const a1 = Wo.scene(n, 1000), a2 = Wo.scene(n, 6000);
        ok(a1.objects.length >= 1 && a1.objects.length <= 16 && JSON.stringify(a1) !== JSON.stringify(a2), 'scene ' + n + ': ' + a1.objects.length + ' road users, moving');
    });
    ok(Wo.scene('busy', 0).objects.length >= 8 && Wo.scene('busy', 0).lanes.lines.length === 4, 'busy: 8+ road users on both sides, 4 lane boundaries');
    ok(Wo.scene('crossing', 2000).objects.filter((o) => o.cls === 'ped').length === 2 && Wo.scene('cyclist', 0).objects.some((o) => o.cls === 'cyc'), 'crossing: pedestrians; cyclist: a cyclist alongside');
    ok(Wo.scene('cutin', 1000).lead.x === 60 && Math.abs(Wo.scene('cutin', 7000).lead.y) < 1.4, 'cut-in: the car from the right lane becomes the car ahead');
    ok(Wo.scene('curve', 2500).lanes.lines[0].c !== 0 && Wo.scene('nolanes', 0).lanes === null, 'curve: curved boundaries; no lanes: the fixed symbol');
    const lc = [Wo.scene('lanechange', 0).lanes.lines[1].y0, Wo.scene('lanechange', 9000).lanes.lines[1].y0];
    ok(lc[0] === 1.75 && Math.abs(lc[1] + 1.75) < 1e-6, 'lane change: the lines move across by one lane');

    // diffRect / cut (carried over)
    const a = P.textSheet(M.DEMO[3][2], false, 'uk'), b = P.textSheet(M.DEMO[8][2], false, 'uk');
    const r = R.diffRect(a, b, 420, 96);
    ok(r && r.w > 0 && r.w < 420 && r.h <= 96, 'active -> standby: one rectangle smaller than the sheet (' + (r && r.w + 'x' + r.h) + ')');
    ok(R.diffRect(a, a, 420, 96) === null, 'no change: nothing to send');
    const ct = R.cut(b, 420, r);
    ok(ct.length === r.w * r.h * 4 && ct.readUInt32LE(0) === b.readUInt32LE((r.y * 420 + r.x) * 4), 'cut: the rectangle\'s rows packed');
    ok(M.colours('map', false).bg.join() === '0,0,0', 'black background (the map slot under a theme window)');
}

/* ------------------------------------------------------------------------------------------------ part 2: the bench */
const DDS = 'de.bmw.infotainment.displaydataserver.DisplayDataServer';

async function part2() {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'road-scene-acc-'));
    const dataDir = path.join(work, 'data'), imgDir = path.join(work, 'img');
    fs.mkdirSync(dataDir); fs.mkdirSync(imgDir);
    let out = '';
    const env = Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, BENCH_IMAGE_DIR: imgDir, BENCH_LAYER_CAP: '8', BENCH_CONFIG: JSON.stringify({ demoMs: 600000 }) });
    const srv = spawn(process.execPath, [path.join(ROOT, 'bench', 'server.js'), 'road_scene'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', (c) => { out += c; });
    srv.stderr.on('data', (c) => { out += c; });
    const waitFor = async (re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(out)) return true; await sleep(100); } return false; };
    const ev = stream.bind(null);
    let es = null;
    try {
        ok(await waitFor(/scene: show off, demo off, lang uk/, 90000), 'the app built by the kit (0.1.0) and started (show off)');
        ok(/road_scene 0\.1\.0: dist\/road_scene@0\.1\.0/.test(out), 'the kit built road_scene 0.1.0');
        await sleep(1200);
        es = ev();
        await sleep(800);
        const mine = (ls) => (ls || []).filter((l) => l.app === 'road_scene');
        ok(es.scene && mine(es.scene).length === 0, 'show off: no layer on the cluster');
        const probe = JSON.parse((await request('GET', '/probe')).body.toString() || '{}');
        const im = probe.images && probe.images.MAIN_GFX;
        ok(im && im.n >= 1 && im.w === 1600 && im.h === 520, 'the centre page pushed to the HMI (1600 x 520)');
        ok(/scene: watch GapVehicleAhead ok/.test(out) && /scene: watch Vehicle ok/.test(out) && /scene: watch TrafficSignRecognition ok/.test(out), 'the read-only fields subscribed (at start, each interface once)');

        // the car's values: day, cruise 90, our speed 90, a target at raw 420 (level 3)
        await request('POST', '/signals', { mode: 'manual', values: { speed: 90 } });
        await request('POST', '/fake', { feed: { iface: 'de.bmw.infotainment.vehicle.Vehicle', field: 'statusDayNightChangeOver', value: { dayNightChangeOver: 1 } } });
        await request('POST', '/fake', { feed: { iface: DDS, field: 'functionalLibraryData', value: { ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', statusLimiter: 'STATUS_INACTIVE', cruiseCtrlSpeedHUD: 90 } } });
        ok(await waitFor(/acc: day\/night 1 -> day/, 4000), 'the car\'s day / night read (1 -> day)');
        await request('POST', '/setting', { key: 'show', value: true });
        ok(await waitFor(/scene: map layers 6 .* on map \(waits for the slot\), pixel memory 442240/, 8000), 'show on: 6 layers asked for, waiting for the slot (no contend)');
        const feedGap = async (g0, g1, ms) => {
            const n = Math.round(ms / 100);
            for (let i = 0; i <= n; i++) { await request('POST', '/fake', { front: { gap: Math.round(g0 + (g1 - g0) * i / n), speed: 1500, obj: 7, qual: 0, qualExt: 0 } }); await sleep(100); }
        };
        await feedGap(420, 420, 1800);
        await sleep(1500);
        let ls = mine(es.scene);
        ok(ls.length === 6 && ls.map((l) => l.kind).join() === 'effect,effect,effect,effect,image,image' && ls.every((l) => l.target === 'map'), 'the scene: 6 layers on map (4 effects, 2 images)');
        const egoL = ls.filter((l) => l.z === 3)[0] || {}, eb0 = M.egoBox(M.GEO.map, {});
        ok(egoL.kind === 'effect' && egoL.visible === 1 && egoL.x === eb0[0] && egoL.y === eb0[1] && egoL.w === eb0[2] && egoL.h === eb0[3] && egoL.uniforms && egoL.uniforms.u_body, 'our own car on the cluster: the acc_car layer at the foot, centred without lane data (' + [egoL.x, egoL.y, egoL.w, egoL.h].join(' ') + ')');
        const byZ = (k) => ls.filter((l) => l.z === k)[0] || {};
        const want3 = M.carBox(M.GEO.map, M.depthOf(3));
        ok(byZ(2).visible === 1 && byZ(2).x === want3[0] && byZ(2).y === want3[1] && byZ(2).w === want3[2] && byZ(2).h === want3[3], 'raw 420 at 90 km/h: the car layer at level 3\'s box (' + [byZ(2).x, byZ(2).y, byZ(2).w, byZ(2).h].join(' ') + ')');
        ok(byZ(0).x === 334 && byZ(0).y === 198 && byZ(1).x === 334 && byZ(1).w === 420 && byZ(4).x === 334 && byZ(4).w === 420 && byZ(5).y === 150, 'the lane, road users, text and pill layers in place');
        const grab = async (l) => (await request('GET', '/px?key=' + encodeURIComponent(l.key) + '&x=0&y=0&w=' + l.w + '&h=' + l.h)).body;
        const same = (px, want, what) => { let diff = 0; for (let i = 0; i < want.length; i++) if (Math.abs(want[i] - px[i]) > 1) diff++; ok(px.length === want.length && diff === 0, what + ' (' + diff + ' bytes differ)'); };
        const s3 = { tgt: 3, clo: 0, data: 'ok', cru: ['cruise', 'active', 90], warn: false, adv: null, lim: null };
        same(await grab(byZ(4)), P.textSheet(s3, false, 'uk'), 'the text sheet read back = the painter\'s (cruise 90, no limit)');
        same(await grab(byZ(5)), P.pillSheet(s3, false, 'uk'), 'the pill sheet read back = the painter\'s (no event: empty)');
        // the level changes (the gap grows: not closing): the car moves, no pixels
        const pxBefore = es.px.filter((m) => m.key === byZ(4).key || m.key === byZ(5).key).length;
        await feedGap(420, 900, 3000);
        await feedGap(900, 900, 1500);
        await sleep(1200);
        ls = mine(es.scene);
        const car = ls.filter((l) => l.z === 2)[0] || {};
        const want5 = M.carBox(M.GEO.map, M.depthOf(5));
        ok(car.w === want5[2] && car.h === want5[3], 'the gap grown to raw 900: the car layer resized to level 5 (' + car.w + 'x' + car.h + ')');
        ok(es.px.filter((m) => m.key === byZ(4).key || m.key === byZ(5).key).length === pxBefore, 'level 3 -> 5: no pixel update (the car moved, nothing re-uploaded)');
        // what the sensors see: the camera's objects and the lane boundaries, as the catalogue shapes them (events)
        const CAM = 'de.bmw.environmentalmodel.ObjectRecognitionFrontCamera';
        const slots = (k, f) => Array.apply(null, Array(40)).map((x, i) => (i < k ? f(i) : {}));
        const rec = { eventDataQualifier: 'EVENT_DATA_AVAILABLE', numberOfObjects: 3, objectRecognitionInfo: slots(3, (i) => ({ classificationType: ['CAR_WITH_OR_WITHOUT_TRAILER', 'PEDESTRIAN', 'TRUCK_BUS_VAN'][i], objectID: 20 + i })) };
        const pos = { eventDataQualifier: 'EVENT_DATA_AVAILABLE', numberOfObjects: 3, objectPositionInfo: slots(3, (i) => ({ positionX: [24, 14, 40][i], positionY: [3.5, -3.2, -3.5][i] })), objectDimensionInfo: slots(3, () => ({})) };
        const lanes = { eventDataQualifier: 'EVENT_DATA_AVAILABLE', laneBoundaryFront: [-1.75, 1.75, 5.25].map((y) => ({ modelQualifier: 'LANE_BOUNDARY_MODEL_AVAILABLE', existenceProbability: 0.9, pointSegment1: { y }, baseSegment1: { angle: 0, curvature: 0.003 }, parametersSegment1: { validLength: 70 } })),
            laneBoundaryPropertiesFront: [{ typeInfo: { type: 'SOLID' } }, { typeInfo: { type: 'DASHED' } }, { typeInfo: { type: 'ROAD_EDGE' } }] };
        for (let i = 0; i < 6; i++) {
            await request('POST', '/fake', { feed: { iface: CAM, field: 'ObjectRecognition', value: rec } });
            await request('POST', '/fake', { feed: { iface: CAM, field: 'ObjectPosition', value: pos } });
            await request('POST', '/fake', { feed: { iface: 'de.bmw.environmentalmodel.LaneBoundaries', field: 'LaneBoundaries', value: lanes } });
            await request('POST', '/fake', { front: { gap: 900, speed: 1500, obj: 7, qual: 0, qualExt: 0 } });
            await sleep(150);
        }
        await sleep(400);
        ls = mine(es.scene);
        const uo = ((ls.filter((l) => l.z === 1)[0] || {}).uniforms || {}).u_ob, ul = ((ls.filter((l) => l.z === 0)[0] || {}).uniforms || {}).u_ln;
        const drawn = uo ? uo.v.filter((v, i) => i % 4 === 3 && v > 0).length : 0;
        ok(drawn === 3, 'the camera\'s 3 objects: 3 road users on the cluster (' + drawn + ')');
        const oc = ((ls.filter((l) => l.z === 1)[0] || {}).uniforms || {}).u_oc;
        ok(oc && oc.v.slice(0, 12).filter((v, i) => i % 4 === 0).sort().join() === '1,2,4', 'their classes: car, truck, pedestrian');
        ok(ul && ul.v[3] === 4 && ul.v[7] === 2 && ul.v[11] === 1 && ul.v[2] === 0.003, 'the measured boundaries on the cluster: edge, dashed, solid, curving (' + (ul && ul.v.slice(0, 12).join(' ')) + ')');
        ok(/acc: src cam first n \d+ rate -\/s objs 3\.\.3 cls car 1 ped 1 truck 1 x 14\.0\.\.40\.0 m y -3\.5\.\.3\.5 m q EVENT_DATA_AVAILABLE/.test(out), 'the log says what arrived: counts, classes, relative metres, qualifier');
        ok(/acc: src lanes first n \d+ .*cls dashed 1 edge 1 solid 1/.test(out), 'the log: the lane boundaries\' types');
        await sleep(1500);
        ls = mine(es.scene);
        const uo2 = ((ls.filter((l) => l.z === 1)[0] || {}).uniforms || {}).u_ob;
        ok(uo2 && uo2.v.filter((v, i) => i % 4 === 3 && v > 0).length === 0, 'the camera silent 1.5 s: the road users faded out (never frozen)');
        // the limit (the event) and the night (the car's day / night)
        await request('POST', '/fake', { feed: { iface: 'de.bmw.dass.TrafficSignRecognition', field: 'TrafficSignRecognition', value: { presentClassLimitSpeed: 22, controlSLIWarning: 0, presentWithdrawalLimitSpeed: 1 } } });
        await sleep(600);
        same(await grab(byZ(4)), P.textSheet(Object.assign({}, s3, { tgt: 5, lim: 110 }), false, 'uk'), 'the limit event (class 22): the plate says 110');
        await request('POST', '/fake', { feed: { iface: 'de.bmw.dass.TrafficSignRecognition', field: 'TrafficSignRecognition', value: { presentClassLimitSpeed: 22, controlSLIWarning: 0, presentWithdrawalLimitSpeed: 1 } } });
        await request('POST', '/fake', { feed: { iface: 'de.bmw.infotainment.vehicle.Vehicle', field: 'statusDayNightChangeOver', value: { dayNightChangeOver: 2 } } });
        await feedGap(900, 900, 600);
        same(await grab(byZ(4)), P.textSheet(Object.assign({}, s3, { tgt: 5, lim: 110 }), true, 'uk'), 'the car says night (2): the night colours');
        await request('POST', '/fake', { feed: { iface: 'de.bmw.infotainment.vehicle.Vehicle', field: 'statusDayNightChangeOver', value: { dayNightChangeOver: 1 } } });
        // closing fast: amber
        await feedGap(900, 250, 2400);
        const pill = await grab(byZ(5));
        const Q = M.colours('map', false);
        let amber = 0;
        for (let i = 0; i < pill.length; i += 4) if (pill[i + 3] > 200 && near(pill[i], pill[i + 1], pill[i + 2], Q.amber, 6)) amber++;
        ok(amber > 100, 'the gap falling 90 -> 25 m (assumed scale) in 2.4 s: closing fast, the amber pill (' + amber + ' px)');
        // stale: the car goes
        await sleep(2800);
        ls = mine(es.scene);
        ok((ls.filter((l) => l.z === 2)[0] || {}).visible === 0, 'silence for 2.8 s: stale, the car layer hidden (never a frozen car)');
        same(await grab(byZ(5)), P.pillSheet({ tgt: null, clo: 0, data: 'stale', cru: s3.cru, warn: false, adv: null, lim: null }, false, 'uk'), 'stale: the pill says so');
        // the centre page as the HMI got it: E's half equals the painter's (the table's age row moves on its own)
        await sleep(1500);
        const png = path.join(imgDir, 'main_gfx.png');
        if (fs.existsSync(png)) {
            const pg = readPng(png);
            ok(pg.w === 1600 && pg.h === 520, 'the page image 1600 x 520');
            // fixes-1121 AL: the lanes went quiet long ago and no motion source spoke: the lane model draws its straight guess
            // (lanes.js corridor, our car centred), never AA's solid symbol
            const LC = Wo.cfgOf(JSON.parse(fs.readFileSync(path.join(APPDIR, 'app.json'), 'utf8')).config.world).lanes;
            const straight = { verdict: 'straight', why: 'STALE', path: { src: null, why: 'NO_MOTION', k: 0 }, lines: Ln.corridor(LC, 0, 3.5, LC.straightLen).map((l) => Object.assign(l, { fade: 1 })), ego: { y0: 0, a: 0, c: 0, half: 1.75 }, width: 3.5, n: 0 };
            const want = P.centre({ tgt: null, clo: 0, data: 'stale', cru: ['cruise', 'active', 90], warn: false, adv: null, lim: null, world: { lanes: straight, objects: [], lead: null, src: 'lanes' }, camY: 0 }, { night: false, lang: 'uk', z: 0, info: {} }).px;
            let diff = 0;
            for (let y = 0; y < 482; y++) for (let x = 0; x < 790; x++) { const i = (y * 1600 + x) * 4, j = ((y + 38) * 1600 + x) * 4; for (let c = 0; c < 3; c++) if (Math.abs(want[i + c] - pg.px[j + c]) > 1) diff++; }
            ok(diff === 0, 'the page\'s E half = the painter\'s picture (' + diff + ' bytes differ)');
        } else ok(false, 'the page image saved by the bench');
        // fixes-1121 AL: the lane model's and our path's log lines; then our yaw rate (the event, 3 deg/s at 90 km/h): the stale
        // lanes become our guessed corridor bending with it on the cluster (u_lp.w 1, curvature yaw / speed)
        ok(/acc: path sources yaw steer \(units and signs assumed/.test(out), 'the path\'s sources subscribed (yaw, steer), read only');
        ok(/acc: lanes first msgs \d+ ms measured \d+ partial \d+ predicted \d+ straight \d+ flips \d+ now \w+ [A-Z_]+ w [\d.]+ rej /.test(out) && /acc: path ms /.test(out), 'the lane model\'s log lines (verdict times, reasons) and the path\'s');
        for (let i = 0; i < 14; i++) {
            await request('POST', '/fake', { feed: { iface: 'de.bmw.chassis.YawRateProvision', field: 'yawRate', value: { yawRate: { yawRate: 3, invalidFlag: false }, qualifierYawRate: 'SIGNALWERT_PLAUSIBEL' } } });
            await request('POST', '/fake', { front: { gap: 900, speed: 1500, obj: 7, qual: 0, qualExt: 0 } });
            await sleep(150);
        }
        const ulg = ((mine(es.scene).filter((l) => l.z === 0)[0] || {}).uniforms || {});
        const kWant = 3 * Math.PI / 180 / 25;
        ok(ulg.u_lp && ulg.u_lp.v[3] === 1 && ulg.u_lp.v[7] === 1 && ulg.u_ln && Math.abs(ulg.u_ln.v[2] - kWant) < 2e-4, 'our yaw rate fed, no lanes: the guessed corridor on the cluster, bending ' + (ulg.u_ln ? ulg.u_ln.v[2] : '-') + ' 1/m (yaw / speed ' + kWant.toFixed(4) + ')');
        ok(!/scene: (tick|apply|page|front|cruise|speed|warn|limit|daynight|layer|target|setting|layout|start):\s/.test(out.replace(/scene: layer \d+ shown/g, '').replace(/scene: target map \w+/g, '')), 'no error from the app\'s guards');
        ok(!/Error|uncaught|unhandled/i.test(out.split('\n').filter((l) => /\[road_scene\]/.test(l)).join('\n')), 'no exception in the app\'s log');
        await request('POST', '/setting', { key: 'show', value: false });
        ok(await waitFor(/scene: map layers dropped/, 5000), 'off again: the layers dropped');
        await sleep(800);
        ok(mine(es.scene).length === 0, 'off again: no layer in the scene');
        const nodeLine = (out.match(/app started on [^\n]+/) || [])[0];
        console.log('bench: ' + (nodeLine || 'the app\'s Node version not logged'));
    } finally {
        if (es) es.close();
        srv.kill('SIGTERM');
        await sleep(300);
        if (Cm.T.fail) console.log('--- bench log (tail) ---\n' + out.split('\n').filter((l) => !/fake persod/.test(l)).slice(-60).join('\n'));
        try { require('child_process').execFileSync('rm', ['-rf', work]); } catch (e) { /* left behind */ }
    }
}

/* ------------------------------------------------------------------------------------------------ part 3: WebGL */
/** The three shaders' uniforms as the app sends them (the busy scene; the car's box), for the WebGL check (canvas 177 x 104). */
function glUniforms() {
    const s = M.withScene(M.DEMO[14][2], 3000), g = Object.assign({}, M.GEO.map, { lane: [0, 0, 177, 104], pxm: 50 / 1.75 });
    const out = { acc_lane: M.laneUniforms(g, s, 0.26, false), acc_obj: M.objUniforms(g, s, false), acc_car: M.carUniforms(s, false, 177, 104) };
    // fixes-1121 AL: acc_lane again with our guessed corridor (u_lp.w 1) and one edge morphing (the lost-curve and one-edge scenes)
    out.acc_lane_guess = M.laneUniforms(g, M.withScene(M.DEMO[22][2], 6000), 0, false);
    out.acc_lane_partial = M.laneUniforms(g, M.withScene(M.DEMO[23][2], 2300), 0, false);
    // fixes-1121 RS: our beams at night (the high beam out) and the light sources: points, a road user's lamps, the rings
    const fb = Object.assign({}, M.DEMO[46][2], { e: 1 });
    out.acc_lane_beams = M.laneUniforms(g, Object.assign({}, fb, { beam: Object.assign({}, fb.beam, { lamps: 'high' }) }), 0.6, true);
    out.acc_obj_lights = M.objUniforms(g, M.DEMO[46][2], true);
    out.acc_car_lamps = M.carUniforms(M.DEMO[46][2], true, 177, 104);
    return out;
}

function part3() {
    if (!fs.existsSync(CHROME)) { console.log('part 3: skipped (no Chrome at ' + CHROME + ')'); return; }
    const sj = JSON.parse(fs.readFileSync(path.join(APPDIR, 'hud', 'shaders.json'), 'utf8'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'road-scene-acc-gl-'));
    const html = '<!doctype html><meta charset="utf-8"><body><pre id="o">running</pre><script>\n' +
        'const SH = ' + JSON.stringify(sj) + ';\n' +
        'const VS = "attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5); gl_Position = vec4(a_pos, 0.0, 1.0); }";\n' +
        'const out = []; const c = document.createElement("canvas"); c.width = 177; c.height = 104; const gl = c.getContext("webgl");\n' +
        'out.push("webgl " + (gl ? gl.getParameter(gl.SHADING_LANGUAGE_VERSION) : "none"));\n' +
        'const U = ' + JSON.stringify(glUniforms()) + ';\n' +
        'for (const n of Object.keys(U)) { const mk = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };\n' +
        ' const v = mk(gl.VERTEX_SHADER, VS), f = mk(gl.FRAGMENT_SHADER, SH[n.split("_").slice(0, 2).join("_")]); const okc = gl.getShaderParameter(f, gl.COMPILE_STATUS);\n' +
        ' const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p); const okl = gl.getProgramParameter(p, gl.LINK_STATUS);\n' +
        ' let lit = 0; if (okc && okl) { gl.useProgram(p); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);\n' +
        '  const l = gl.getAttribLocation(p, "a_pos"); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);\n' +
        '  for (const k of Object.keys(U[n])) { const a = U[n][k]; const u = gl.getUniformLocation(p, k) || gl.getUniformLocation(p, k + "[0]"); if (u) gl["uniform" + (a.length > 4 ? 4 : a.length) + "fv"](u, new Float32Array(a)); }\n' +
        '  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); const px = new Uint8Array(177 * 104 * 4); gl.readPixels(0, 0, 177, 104, gl.RGBA, gl.UNSIGNED_BYTE, px); for (let i = 3; i < px.length; i += 4) if (px[i] > 128) lit++; }\n' +
        ' out.push(n + " compile " + okc + " link " + okl + " lit " + lit + " log " + JSON.stringify(gl.getShaderInfoLog(f) || "")); }\n' +
        'document.getElementById("o").textContent = out.join("\\n");\n</script>';
    const file = path.join(work, 'gl.html');
    fs.writeFileSync(file, html);
    const r = spawnSync(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--virtual-time-budget=5000', '--dump-dom', 'file://' + file], { encoding: 'utf8', timeout: 60000 });
    const dom = (r.stdout || '').replace(/&quot;/g, '"');
    console.log('webgl: ' + ((dom.match(/<pre id="o">([\s\S]*?)<\/pre>/) || [])[1] || 'no output').replace(/\n/g, ' | '));
    ok(/webgl WebGL GLSL ES 1\.0/.test(dom), 'headless Chrome has WebGL 1 (GLSL ES 1.00)');
    ['acc_lane', 'acc_obj', 'acc_car', 'acc_lane_guess', 'acc_lane_partial', 'acc_lane_beams', 'acc_obj_lights', 'acc_car_lamps'].forEach((n) => {
        const m = new RegExp(n + ' compile (\\w+) link (\\w+) lit (\\d+)').exec(dom);
        ok(m && m[1] === 'true' && m[2] === 'true', n + ': compiles and links as GLSL ES 1.00 in WebGL');
        // the light sources' run is a night scene at 177 x 104: two road users with lit lamps and a ring, small by nature
        ok(m && Number(m[3]) > (n === 'acc_obj_lights' ? 60 : 200), n + ': draws (' + (m ? m[3] : 0) + ' opaque px)');
    });
    try { require('child_process').execFileSync('rm', ['-rf', work]); } catch (e) { /* left behind */ }
}

/* ------------------------------------------------------------------------------------------------ part 4: the emulator */
async function part4() {
    const ER = require(path.join(ROOT, 'tools', 'road-scene', 'emu_run.js'));
    const port = PORT + 7;
    // the app's own rate: no page draws, so the emulator takes each frame as drawn at its cap (the renderer out of the measure)
    const moving = await ER.run({ port, seconds: 45, demoMs: 500, noChrome: true });
    const rates = (moving.match(/scene: gpu page (\d+) frames\/s/g) || []).map((l) => Number(/(\d+) frames/.exec(l)[1]));
    const rss = (moving.match(/rss (\d+) MB/g) || []).map((l) => Number(/(\d+)/.exec(l)[1]));
    console.log('emulator, demo scenes: ' + rates.join(', ') + ' frames/s; rss ' + rss.join(', ') + ' MB');
    ok(/renderd: connected, screen 1920x720, mgu-render\/1/.test(moving), 'the emulator: the app on the GPU renderer (mgu-render/1)');
    ok(rates.length >= 3 && Math.max.apply(null, rates.slice(1)) >= 20 && Math.max.apply(null, rates) <= 31, 'moving scenes: 20-30 frames a second (' + rates.join(', ') + ')');
    ok(rss.length >= 3 && Math.max.apply(null, rss.slice(1)) - Math.min.apply(null, rss.slice(1)) < 40, 'no growth in memory over the run (' + rss.join(', ') + ' MB)');
    const still = await ER.run({ port, seconds: 25, demoMs: 500, noChrome: true, still: true });
    const sr = (still.match(/display: (\d+) fps sent/g) || []).map((l) => Number(/(\d+)/.exec(l)[1]));
    console.log('emulator, nothing moving: ' + sr.join(', ') + ' fps sent');
    ok(sr.length >= 1 && sr.every((v) => v <= 1), 'nothing moving: no frames (the kit keeps the last one alive by itself)');
    // Auto Beam's emulator check, carried over: with nothing moving the page itself records no frames either
    const gr = (still.match(/scene: gpu page (\d+) frames\/s/g) || []).map((l) => Number(/(\d+) frames/.exec(l)[1]));
    console.log('emulator, nothing moving: the page ' + gr.join(', ') + ' frames/s');
    ok(gr.slice(1).every((x) => x <= 1), 'nothing moving: the page\'s own frames none (' + gr.join(', ') + ')');
    ok(!/scene: (tick|apply|page|layout|start):\s/.test(moving + still), 'no error from the app\'s guards in the emulator');
}

module.exports = async function run() {
    const p0 = Cm.T.pass, f0 = Cm.T.fail, at = (q, g) => (Cm.T.pass - q) + ' passed, ' + (Cm.T.fail - g) + ' failed';
    part1();
    console.log('acc, part 1 (pure): ' + at(p0, f0));
    if (args.indexOf('--no-gl') < 0) { const q = Cm.T.pass, g = Cm.T.fail; part3(); console.log('acc, part 3 (WebGL): ' + at(q, g)); }
    if (args.indexOf('--no-emu') < 0 && args.indexOf('--no-bench') < 0) { const q = Cm.T.pass, g = Cm.T.fail; await part4(); console.log('acc, part 4 (emulator, port ' + (PORT + 7) + '): ' + at(q, g)); }
    if (args.indexOf('--no-bench') < 0) { const q = Cm.T.pass, g = Cm.T.fail; await part2(); console.log('acc, part 2 (bench, port ' + PORT + '): ' + at(q, g)); }
    console.log('acc (ACC View\'s suite): ' + at(p0, f0));
};
