'use strict';
/**
 * bench/road_scene/beam.js - Auto Beam's suite (bench/test-auto-beam.js, round "Auto Beam" package HD) carried over to Road Scene
 * (round fixes-1121 RS). The advisor is unchanged (the adapter, the algorithm, the inputs, the score, the source logs, the states
 * and the scenes keep every check). What the merge changed, each check carried over to its new place: the manifest is the union;
 * the profile table is shared/profile_settings.js's; the 19 states are drawn in ONE scene (model.js: ACC View's road, Auto
 * Beam's beams, lights and advice), the advice only at night; the beams follow the lamps' real state; the map is the merged six
 * layers (the beams are acc_lane's u_beam, the lights acc_obj's items: no ab_road / ab_lights any more); the WebGL run draws the
 * merged shaders with the beams and the lights; the emulator's checks run once, in acc.js.
 *
 * Part 1 (pure), part 2 (bench, port + 1), part 3 (WebGL).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const Cm = require('./common');

const ROOT = Cm.ROOT, APPDIR = Cm.APPDIR, CHROME = Cm.CHROME, args = Cm.args;
const PORT = Cm.PORT + 1;
const ok = Cm.ok, CYR = Cm.CYR, stripComments = Cm.stripComments, near = Cm.near, FakeCR = Cm.FakeCR, nullLog = Cm.nullLog;
const request = (m, u, b) => Cm.request(m, u, b, PORT);
const stream = () => Cm.stream(PORT);
const sleep = Cm.sleep;

const C = require(path.join(APPDIR, 'contract.js'));
const Inputs = require(path.join(APPDIR, 'inputs.js'));
const V = require(path.join(APPDIR, 'beam_view.js'));
const M = require(path.join(APPDIR, 'model.js'));
const P = require(path.join(APPDIR, 'paint.js'));
const R = require(path.join(APPDIR, 'raster.js'));
const Wd = require(path.join(APPDIR, 'words.js'));
const Score = require(path.join(APPDIR, 'score.js'));
const SrcLog = require(path.join(APPDIR, 'srclog.js'));
const MapView = require(path.join(APPDIR, 'mapview.js'));
const GP = require(path.join(APPDIR, 'gpu.js'));
const SC = require(path.join(APPDIR, 'scenes.js'));
const ACT = require(path.join(APPDIR, 'actuator.js'));
const BL = require(path.join(ROOT, 'shared', 'beam_logic.js'));
const PS = require(path.join(ROOT, 'shared', 'profile_settings.js'));
const Rec = require(path.join(ROOT, 'kit', 'runtime', 'record.js'));

/** Auto Beam's census: red, amber and blue over the opaque pixels (alpha >= 128), amber and blue within 8. */
function census(px, Q) {
    let red = 0, amber = 0, blue = 0;
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 128) continue;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (Cm.isRed(r, g, b)) red++;
        if (near(r, g, b, Q.amber, 8)) amber++;
        if (near(r, g, b, Q.blue, 8)) blue++;
    }
    return { red, amber, blue };
}
/** The merged scene's entry for Auto Beam's state id ('01'..'19'): the state on ACC View's road (model.js DEMO 29..47). */
const sceneOf = (id) => M.DEMO[M.ACC_N + Number(id) - 1][2];

/** A contract frame (CONTRACT.md section 2) for the algorithm directly: o overrides. */
function frame(t, o) {
    const x = o || {};
    const G = (v, age) => ({ v, age: age === undefined ? 0 : age, ok: true });
    const f = {
        t,
        car: G({ speed_kmh: x.speed === undefined ? 90 : x.speed, yaw_dps: x.yaw || 0, steer_deg: null, gear: x.gear || null }),
        lamps: G({ low: x.low === undefined ? true : x.low, high: x.high === undefined ? null : x.high, fog: !!x.fog, switch: null }),
        stalk: G(x.stalk || []),
        env: G({ brightness: x.bright === undefined ? null : x.bright, sun: x.sun === undefined ? 'night' : x.sun, wiper: x.wiper || 0, limit_kmh: x.limit === undefined ? 90 : x.limit, urban: x.urban === undefined ? null : x.urban }),
        app: { v: { rearm: false } },
    };
    if (x.lights !== null) f.lights = x.lights === undefined ? G([]) : x.lights;
    if (x.objects) f.objects = x.objects;
    if (x.verdict) f.verdict = x.verdict;
    if (x.signs) f.signs = x.signs;
    return f;
}
const DEF = BL.DEFAULTS;
/** A raw light object at (x m ahead, y m left) of a contract kind, under the module's own assumed scales. */
const obj = (kind, xm, ym, id) => SC.rawOf(DEF, { id: id === undefined ? 1 : id, kind, x: xm, y: ym });

/* ------------------------------------------------------------------------------------------------ part 1 */
function part1() {
    const app = JSON.parse(fs.readFileSync(path.join(APPDIR, 'app.json'), 'utf8'));
    // ---- the manifest
    ok(app.id === 'road_scene' && app.loggingId === 'OARS' && app.version === '0.1.0' && app.title === 'Road Scene', 'road_scene 0.1.0, logging id OARS, title Road Scene (Auto Beam merged into it)');
    const others = fs.readdirSync(path.join(ROOT, 'apps')).filter((a) => a !== 'road_scene').map((a) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', a, 'app.json'), 'utf8')); } catch (e) { return null; } }).filter(Boolean);
    ok(others.length >= 4 && others.every((a) => a.loggingId !== 'OARS' && a.id !== 'road_scene' && a.id !== 'auto_beam' && a.id !== 'acc_view'), 'the id and the logging id are unique among the apps (auto_beam and acc_view are gone from apps/)');
    const flags = [], members = [];
    let methods = 0, broadcasts = [];
    Object.keys(app.signals).forEach((i) => Object.keys(app.signals[i]).forEach((f) => {
        if (f[0] !== '_') { flags.push(app.signals[i][f]); members.push(i + '.' + f); } else if (f === '_methods') methods++;
        else if (f === '_broadcasts') broadcasts = broadcasts.concat(app.signals[i][f]);
    }));
    ok(flags.length === 17 && flags.every((x) => x === 's' || x === 'rs'), 'seventeen fields (Auto Beam\'s ten among them), read-only flags only (s / rs): no w anywhere (' + flags.join(',') + ')');
    ok(methods === 0, 'no method declared');
    ok(broadcasts.length === 26 && broadcasts.filter((b) => /ainBeamAssistantDataObject\d+$/.test(b)).length === 15 && broadcasts.indexOf('controlHighBeamAssistant') >= 0 && ['objectlistTCP', 'ObjectRecognition', 'ObjectPosition', 'TrafficSignRecognitionFrontCamera', 'yawRate', 'TrafficSignRecognition'].every((b) => broadcasts.indexOf(b) >= 0), 'the 15 light events, the verdict, the two fallback object lists, the camera\'s signs, the yaw rate and the limit as broadcasts (Auto Beam\'s 22 of the 26)');
    ok(['MainBeamAssistantDataObject11', 'MainBeamAssistantDataObject12', 'MainBeamAssistantDataObject15'].every((b) => broadcasts.indexOf(b) >= 0), 'the three light events whose names start with a capital M, as the catalogue spells them');
    const all = JSON.stringify(Object.keys(app.signals).map((i) => [i].concat(Object.keys(app.signals[i]).filter((k) => k[0] !== '_'), app.signals[i]._broadcasts || [], app.signals[i]._methods || [])));
    ok(!/acknowledgeObjectData/.test(all) && !/LightswitchOperation/.test(all) && !/KombiIF|standardCCMessage|extendedCCMessage|A19B|Tasu|Diag/i.test(all), 'no acknowledgeObjectData*, no LightswitchOperation member, no CC message, no diagnostic interface');
    const cats = fs.existsSync(path.join(ROOT, 'reference', 'car')) ? fs.readdirSync(path.join(ROOT, 'reference', 'car')).map((d) => path.join(ROOT, 'reference', 'car', d, 'someip', 'someip-interfaces.json')).filter((f) => fs.existsSync(f)) : [];
    ok(cats.length >= 1, 'a catalogue to check against (' + cats.length + ')');
    cats.forEach((c) => {
        const r = spawnSync('python3', [path.join(ROOT, 'tools', 'signals', 'check_signals.py'), c, path.join(APPDIR, 'app.json')], { encoding: 'utf8' });
        ok(r.status === 0 && /all declarations pass/.test(r.stdout), 'check_signals.py passes against ' + path.basename(path.dirname(path.dirname(c))) + ' (non-zero getters for every r, events as broadcasts)');
    });
    ok(app.i18n === true && app.settings.some((s) => s.key === 'lang' && s.default === 'auto'), '"i18n": true and the language setting (Авто)');
    const set = (k) => app.settings.filter((s) => s.key === k)[0] || {};
    ok(set('show').default === false && set('demoCycle').default === false, 'the cluster and the demo off by default');
    ok(set('sens').default === 'normal' && JSON.stringify(set('sens').options.map((o) => o[0])) === '["early","normal","late"]', 'the sensitivity: three steps, normal by default');
    ok(set('follow').default === 'follow' && JSON.stringify(set('follow').options.map((o) => o[0])) === '["follow","ignore"]', 'the camera\'s verdict: follow / ignore');
    ok(!app.settings.some((s) => /control|switch|actuat|керув|перемик/i.test(s.key + ' ' + s.label + ' ' + JSON.stringify(s.options || []))), 'no setting that sounds like control');
    ok(app.config.layer.target === 'map' && app.config.layer.contend === false && app.config.layer.guideHold === 0, 'the map target without contend and without guide hold');
    (app.shared || []).forEach((f) => ok(fs.existsSync(path.join(ROOT, 'shared', f)), 'shared ' + f + ' exists'));
    ok(['beam_logic.js', 'lang.js', 'profile_settings.js', 'cluster_render_client.js', 'sun.js'].every((f) => app.shared.indexOf(f) >= 0), 'shared: beam_logic, lang, profile_settings, cluster_render_client, sun');
    ok(app.screens[0].name === 'MAIN' && app.screens[0].kind === 'canvas' && JSON.stringify(app.screens[0].buttons.map((b) => b[0])) === '["BTN_SETTINGS"]', 'the page is a canvas whose only button is the kit\'s Settings');
    ok(app.screens[1].name === 'SETTINGS' && app.screens[1].items[0].join() === 'text,STATUS', 'the settings menu keeps the advice\'s status row');
    // the assumed scales are config, flagged
    ok(['lights', 'lamps', 'stalk', 'objects', 'env', 'town'].every((k) => app.config.inputs[k].assumed === true), 'the unconfirmed readings are config values flagged "assumed"');
    ok(JSON.stringify(app.config.inputs.lamps.highSources) === '["lightStatus","lampExterior2"]', 'the high beam\'s candidates in HR\'s order: statusLightStatus, then LampExterior2');
    ok(app.config.inputs.stalk.pull === 0x10 && app.config.algo.objects.use === 'fallback', 'the flash bit (ROUND.md 1a) as config; the object lists as the fallback');

    // ---- the code: a static scan; Node 8; no Cyrillic literal
    const files = fs.readdirSync(APPDIR).filter((f) => f.endsWith('.js')).map((f) => path.join(APPDIR, f)).concat([path.join(ROOT, 'shared', 'beam_logic.js')]);
    files.forEach((f) => {
        const raw = fs.readFileSync(f, 'utf8'), s = stripComments(raw), n = path.relative(ROOT, f);
        ok(!/signals\.(set|call|proxy|get)\s*\(|\.setValue\s*\(|\.callMethod\s*\(|ctx\.signals\.set|acknowledgeObjectData|LightswitchOperation|pushButton|standardCCMessage|extendedCCMessage|A19B|readonly-diag|kit\/diag|kit\/dids|require\(['"]\.\/(diag|dids|ecus|sgbd|parked)['"]\)|\buds\b|tasu/i.test(s), n + ': no setter, no method call on the car, no diagnostic request, no lamp command');
        ok(!/\?\.|\?\?|\{\s*\.\.\.|,\s*\.\.\.\w+\s*\}|\.flat\(|\.flatMap\(|Object\.fromEntries|\.padEnd\(|\.trimStart\(|\.matchAll\(|\.replaceAll\(|\basync\s+\(|\bawait\b/.test(s), n + ': Node 8.16 syntax (no ?. ?? object spread .flat async/await)');
        ok(!CYR.test(s), n + ': no Cyrillic literal (the words come from shared/i18n)');
        try { new Function(raw.replace(/^'use strict';/, '')); ok(true, n + ': parses'); } catch (e) { ok(false, n + ': parses: ' + e.message); }
    });
    const CHECK = path.join(ROOT, 'tools', 'cruise-sim', 'tests', 'stubs', 'sc2-node8-check.js');
    if (fs.existsSync(CHECK)) {
        const probe = spawnSync(process.execPath, ['--expose-internals', CHECK], { input: 'var a = {}; var b = a?.c;', encoding: 'utf8' });
        if (probe.status === 0 && !/unavailable/.test(probe.stdout)) {
            const bad = [];
            files.forEach((f) => { const r = JSON.parse(spawnSync(process.execPath, ['--expose-internals', CHECK, f], { encoding: 'utf8' }).stdout); if (!r.ok) bad.push(path.basename(f) + ': ' + r.error); });
            ok(!bad.length, files.length + ' files parse as ES2017 (acorn)' + (bad.length ? ': ' + bad.join('; ') : ''));
        }
    }
    // ---- the actuator: the null one, the only one
    const actSrc = fs.readFileSync(path.join(APPDIR, 'actuator.js'), 'utf8');
    ok(Object.keys(ACT).join() === 'NullActuator' && actSrc.split('\n').length <= 16 && !/require\(/.test(stripComments(actSrc)), 'actuator.js: one implementation (NullActuator), ~10 lines, requires nothing');
    ok(/owner's written\s*\n?\s*\/\/\s*approval|owner's written approval/.test(actSrc), 'actuator.js says a real one needs the owner\'s written approval of that specific write');
    const lg = nullLog(), a = new ACT.NullActuator(lg);
    ok(a.request('high', 'CLEAR') === false && a.request('high', 'CLEAR') === false && a.request('low', 'ONCOMING') === false && a.count === 2 && lg.lines.length === 2 && /would switch to low \(ONCOMING\); nothing sent/.test(lg.lines[1]), 'the null actuator logs each change once and returns: nothing sent');
    const mainSrc = stripComments(fs.readFileSync(path.join(APPDIR, 'main.js'), 'utf8'));
    ok(/new ACT\.NullActuator\(/.test(mainSrc) && (mainSrc.match(/Actuator/g) || []).length === 1, 'main.js uses the null actuator and no other');
    ok(fs.readdirSync(APPDIR).filter((f) => /actuat/i.test(f)).join() === 'actuator.js', 'one actuator file in the app');
    // per profile / global cover every setting (fixes-1121 RS: the table is shared/profile_settings.js's, like the themes')
    const tb = PS.TABLE.road_scene || { perProfile: [], global: [] };
    ok(app.settings.every((s) => tb.perProfile.concat(tb.global).indexOf(s.key) >= 0) && tb.perProfile.indexOf('sens') >= 0 && /PSET\.attach\(ctx\)/.test(mainSrc), 'the profile table covers every setting; the sensitivity follows the driver profile');

    // ---- the words
    const T = {};
    ['uk', 'en'].forEach((l) => { T[l] = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'i18n', l + '.json'), 'utf8')); });
    const ak = Object.keys(T.uk).filter((k) => /^(beam|road_scene)\./.test(k));
    ok(ak.length >= 50 && ak.every((k) => typeof T.en[k] === 'string' && T.en[k] && T.uk[k]) && !Object.keys(T.uk).some((k) => /^auto_beam\./.test(k)), 'every beam.* / road_scene.* word in both tables (' + ak.length + '; auto_beam.* gone with its app)');
    ok(Wd.KEYS.every((k) => T.uk[k] && T.en[k]), 'every key the app draws is in both tables');
    ok(ak.every((k) => !CYR.test(T.en[k])), 'no Cyrillic in the English words');
    const I = require(path.join(ROOT, 'shared', 'lang.js'));
    const specKeys = I.specKeys(Object.assign({}, app, { id: 'road_scene' })).map((k) => k[0]).filter((k) => !/^kit\./.test(k));
    ok(specKeys.every((k) => T.uk[k] && T.en[k]), 'every app.json text has its words in both tables (' + specKeys.length + ')');
    ['uk', 'en'].forEach((l) => ['ab_t16', 'ab_t21', 'ab_t26', 'ab_b22', 'ab_b34'].forEach((f) => {
        const miss = R.missing(ak.map((k) => T[l][k].replace(/\{[a-z]+\}/g, '0')).join('') + '0123456789#%·–—…', f);
        ok(!miss, f + ' holds every character of the ' + l + ' words' + (miss ? ': ' + miss : ''));
    }));
    ['ab_t16', 'ab_t21', 'ab_t26', 'ab_b22', 'ab_b34'].forEach((f) => { const j = JSON.parse(fs.readFileSync(path.join(APPDIR, 'hud', 'fonts', f + '.json'), 'utf8')); ok(j.width % 4 === 0, f + ': atlas width ' + j.width + ' % 4 == 0 (never uploaded anyway)'); });
    ok(C.REASONS.concat(['unknown']).every((r) => T.uk['beam.reason.' + r] && T.en['beam.reason.' + r]) && Object.keys(C.STATE_KEY).every((x) => T.uk[C.STATE_KEY[x]]), 'every reason and state of the contract has its words (and beam.reason.unknown)');
    ok(T.uk['beam.reason.oncoming'] === 'Зустрічне авто' && T.uk['beam.reason.daylight'] === 'Ще світло' && T.uk['beam.reason.driver'] === 'Рішення водія' && T.uk['beam.reason.weather'] === 'Туман / дощ' && T.uk['beam.reason.town'] === 'Населений пункт' && T.en['beam.reason.camera_verdict'] === 'Camera says dip', 'the reason words of the brief and of CONTRACT 6');

    // ---- the adapter (contract.js: the one file that knows CONTRACT.md)
    ok(typeof C.standIn() === 'boolean', 'the module in place: ' + (C.standIn() ? 'the STAND-IN (the lead swaps in HA\'s module at the merge)' : 'HA\'s shared/beam_logic.js'));
    ['create', 'guard', 'failOutput', 'mergePartial'].forEach((k) => ok(typeof BL[k] === 'function', 'the module has ' + k + '() (CONTRACT 1)'));
    ok(BL.VERSION === 1 && BL.STATES.join() === 'UNAVAILABLE,STANDBY,HIGH,DEFAULT'.replace('DEFAULT', 'DIPPED,OVERRIDE') && BL.PRESETS.early && BL.PRESETS.late && BL.REASONS.oncoming && BL.REASONS.oncoming.key === 'beam.reason.oncoming' && BL.STATE_KEYS.HIGH === 'beam.state.high' && Array.isArray(BL.SCHEMA), 'VERSION 1, STATES, STATE_KEYS, PRESETS, REASONS, SCHEMA (CONTRACT 1)');
    Object.keys(BL.REASONS).forEach((r) => ok(C.REASONS.indexOf(r) >= 0, 'the adapter knows the reason ' + r));
    ok(C.REASON_KEY('aliens') === 'beam.reason.unknown' && C.REASON_KEY('oncoming') === 'beam.reason.oncoming', 'an unknown reason code shows beam.reason.unknown (CONTRACT 6)');
    const n0 = C.normal({ want: 'maybe', state: 'WHATEVER', reason: 'aliens' }, { t: 5 });
    ok(n0.want === 'low' && n0.state === 'UNAVAILABLE' && n0.reasonKey === 'beam.reason.unknown', 'normal(): an unknown want / state -> low, UNAVAILABLE');
    ok(C.normal({ want: 'high', state: 'STANDBY', reason: 'slow' }, { t: 0 }).want === 'low', 'normal(): STANDBY is never high');
    const lgD = nullLog(), D = new C.Decider({}, lgD);
    D.algo = { step: () => { throw new Error('boom'); }, reset() {} };
    const o1 = D.step(frame(1000)), o2 = D.step(frame(1100));
    ok(o1.want === 'low' && o1.reason === 'error' && o2.want === 'low' && lgD.lines.filter((l) => /^E beam: algorithm step/.test(l)).length === 1 && D.errors === 2, 'an exception in the algorithm: B.failOutput (low, error), logged once, the loop keeps going');
    const D2 = new C.Decider({}, nullLog());
    D2.algo = { step: () => ({ want: 'high', state: 'HIGH', reason: 'clear', since: NaN }), reset() {} };
    ok(D2.step(frame(5)).since === 5, 'a NaN in the output is replaced');
    const D3 = new C.Decider({}, nullLog());
    D3.algo = { step: () => ({ state: 'HIGH' }), reset() {} };
    ok(D3.step(frame(5)).want === 'low', 'an output without want: low');
    ok(new C.Decider({ zone: { head_m: 'far' } }, nullLog()).configErrors.length >= 1, 'a bad config value is reported (inst.configErrors)');
    const Dp = new C.Decider({}, nullLog(), 'early');
    ok(Dp.algo.config.zone.head_m === BL.PRESETS.early.zone.head_m, 'the sensitivity "early" merges B.PRESETS.early');
    const fr = C.frameOf({ t: 2000, lights: { v: [], at: 1900 }, speed: { v: 80, at: 1990 }, yaw: { v: 3, at: 1990 }, low: { v: true, at: 100 }, high: { v: null, at: 100 }, sun: { v: 'night', at: 50 }, urban: { v: true, at: 1500 }, stalk: [{ t: 1950, kind: 'flash' }] });
    ok(fr.lights && fr.lights.ok && fr.lights.age === 100 && !fr.verdict && !fr.objects, 'frameOf: { v, age, ok }; a source never seen is a missing group');
    ok(fr.car.v.speed_kmh === 80 && fr.car.v.yaw_dps === 3 && fr.car.age === 10 && fr.lamps.v.low === true && fr.lamps.v.high === null && fr.env.v.sun === 'night' && fr.env.v.urban === true && fr.stalk.v[0].kind === 'flash', 'frameOf: car, lamps, env, stalk in the contract\'s members');
    const fo = C.frameOf({ t: 2000, objects: { v: [{ id: 1, cls: 1, x: 80, y: 3, vx: -40 }], at: 1980, qual: 0 } });
    ok(fo.objects && fo.objects.qual === 0 && fo.objects.v[0].x === 80 && !fo.lights, 'frameOf: the fallback objects with their qualifier');

    // ---- the algorithm: contract-level checks (they pass on the stand-in and on HA's module: docs/highbeam/HD-REPORT.md)
    const A = BL.create({ objects: { use: 'fallback' } });
    const step = (t, o) => BL.guard(A, frame(t, o));
    let T0 = 0;
    /** reset, then 15 s of dark empty road at 90 km/h (every module's settle and dark holds are over) */
    const warm = (o) => { A.reset(); let r0; for (let i = 0; i < 150; i++) r0 = step(1000 + i * 100, o); T0 = 1000 + 150 * 100; return r0; };
    const run = (n, o) => { let r0; for (let i = 0; i < n; i++) { r0 = step(T0, typeof o === 'function' ? o(i) : o); T0 += 100; } return r0; };
    let r = step(0, { lights: null });
    ok(r.state === 'UNAVAILABLE' && r.reason === 'nodata' && r.want === 'low', 'no light stream and no objects: UNAVAILABLE nodata, low');
    ok(BL.guard(A, null).want === 'low' && BL.guard(A, { t: NaN }).want === 'low', 'a null frame or a NaN t: low');
    r = warm(); r = run(3, { lights: { v: [], age: 9000, ok: true } });
    ok(r.want === 'low' && r.state === 'UNAVAILABLE', 'a stale light stream: UNAVAILABLE, low (' + r.reason + ')');
    r = warm({ sun: 'day' });
    ok(r.state === 'STANDBY' && r.reason === 'daylight', 'daylight: STANDBY daylight');
    r = warm({ low: false });
    ok(r.state === 'STANDBY' && r.reason === 'lights_off', 'the low beam off: STANDBY lights_off');
    const SP = A.config.speed;
    r = warm({ speed: SP.off_kmh - 5 });
    ok(r.reason === 'slow' && r.want === 'low', 'under ' + SP.off_kmh + ' km/h: slow');
    r = warm();
    ok(r.state === 'HIGH' && r.want === 'high' && r.reason === 'clear', 'dark, 90 km/h, nothing ahead: HIGH clear');
    r = run(5, { speed: (SP.on_kmh + SP.off_kmh) / 2 }); ok(r.state === 'HIGH', 'the hysteresis: ' + (SP.on_kmh + SP.off_kmh) / 2 + ' km/h stays high (on ' + SP.on_kmh + ', off ' + SP.off_kmh + ')');
    r = run(3, { speed: SP.off_kmh - 3 }); ok(r.reason === 'slow' && r.want === 'low', 'under the off speed: slow, low');
    warm(); r = run(60, { limit: 50, speed: 55 }); ok(r.reason === 'town', 'a limit of 50 standing (driving 55 km/h): town');
    warm(); r = run(10, (i) => ({ signs: { v: i === 2 ? [{ t: T0, kind: 'town_in' }] : [], age: 0, ok: true } }));
    ok(r.reason === 'town' && r.details.urban && r.details.urban.on && r.details.urban.src === 'sign', 'the camera\'s town-entry sign: town (details.urban src sign)');
    ok(C.normal(r, frame(T0)).town === 'sign', 'the adapter: the town\'s source "sign" for the table');
    r = run(10, (i) => ({ signs: { v: i === 2 ? [{ t: T0, kind: 'town_out' }] : [], age: 0, ok: true } }));
    ok(r.reason !== 'town', 'the town-exit sign ends it');
    warm(); r = run(10, { fog: true }); ok(r.reason === 'weather', 'the fog lamps: weather');
    warm(); r = run(10, { wiper: 3 }); ok(r.reason === 'weather', 'fast wipers: weather');
    const L = (list) => ({ v: list, age: 0, ok: true });
    warm(); r = run(3, { lights: L([obj('head', 600, 3.5, 7)]) });
    ok(r.state === 'HIGH', 'an oncoming car at 600 m: still high');
    r = run(3, { lights: L([obj('head', 250, 3.5, 7)]) });
    ok(r.state === 'DIPPED' && r.reason === 'oncoming' && r.cause && r.cause.id === 7 && r.want === 'low', 'in the zone (250 m): DIPPED oncoming, the cause id 7');
    r = run(1);
    ok(r.state === 'DIPPED' && r.holdUntil > T0 - 100, 'gone: the return counts down (holdUntil)');
    for (let k = 0; k < 200 && r.state !== 'HIGH'; k++) r = run(1);
    ok(r.state === 'HIGH', 'after the hold: HIGH again');
    warm(); r = run(3, { lights: L([obj('tail', 120, 0, 9)]) });
    ok(r.reason === 'preceding' && r.cause && r.cause.id === 9, 'tail lamps 120 m ahead: preceding');
    warm(); r = run(4, { lights: L([obj('street', 60, 7, 21), obj('street', 90, -6, 22), obj('street', 130, 7, 23)]) });
    ok(r.reason === 'streetlights', 'three street lights: streetlights');
    warm(); r = run(4, { lights: null, objects: { v: [{ id: 41, cls: 1, x: 100, y: 3.5, vx: -50, lane: null, move: null, head: 'on', rear: null, vabs: -26 }], age: 0, ok: true, qual: 0 } });
    ok(r.state === 'DIPPED' && r.reason === 'oncoming' && r.cause && r.cause.src === 'object', 'the light stream silent: the fallback object list dips for an oncoming car (cause src object)');
    const N = C.normal(r, frame(T0, { lights: null, objects: { v: [], age: 0, ok: true } }));
    ok(N.src === 'object' && N.lights.some((l) => l.src === 'object' && l.cause), 'the adapter: source "object", the cause ringed');
    warm(); r = run(4, { lights: null, objects: { v: [{ id: 43, cls: 1, x: 90, y: 3.5, vx: null, lane: null, move: 'oncoming', head: null, rear: null, vabs: null }], age: 0, ok: true, qual: 0 } });
    ok(r.reason === 'oncoming', 'the older list\'s statusMovement ONCOMING alone dips');
    // the camera's verdict: follow vs log
    const vd = { v: { allow: 0, reason: 1, vehicles: 1, signs: 0, pedestrians: 0, calibration: 0, qualifier: 0 }, age: 0, ok: true };
    const Af = BL.create({ verdict: { use: 'follow' } }), Al = BL.create({});
    let rf, rl;
    for (let i = 0; i < 160; i++) { rf = BL.guard(Af, frame(1000 + i * 100, i > 150 ? { verdict: vd } : {})); rl = BL.guard(Al, frame(1000 + i * 100, i > 150 ? { verdict: vd } : {})); }
    ok(rf.want === 'low' && rf.reason === 'camera_verdict', 'the camera says no, followed: camera_verdict');
    ok(rl.want === 'high', 'the camera says no, compared only (verdict.use log): our own decision stands (high)');
    // advise mode: the driver's lamps are labels, never inputs
    r = warm({ high: false });
    ok(r.state === 'HIGH', 'advise mode: the driver keeping low does not move the advice (no OVERRIDE)');
    warm(); r = run(3, { high: true, lights: L([obj('head', 200, 3.5)]) });
    ok(r.state === 'DIPPED' && r.want === 'low', 'the driver keeps high when the trigger comes: DIPPED (the disagreement the app shows in amber)');
    // a curve delays the return
    warm(); run(3, { lights: L([obj('head', 200, 3.5)]) });
    let sawCurve = false; for (let k = 0; k < 40; k++) { r = run(1, { yaw: 9 }); if (r.reason === 'curve' && r.want === 'low') sawCurve = true; }
    ok(sawCurve, 'a curve holds the low beam (the return waits)');
    // the invariants over random frames (CONTRACT 8)
    let bad = 0;
    const A2 = BL.create({ objects: { use: 'fallback' } });
    for (let i = 0; i < 3000; i++) {
        const t = i * 100, sp = (i * 37) % 130, stale = i % 17 === 0, fog = i % 23 === 0, low = i % 29 !== 0;
        const o = BL.guard(A2, frame(t, { speed: sp, fog, low, lights: stale ? { v: [], age: 9000, ok: true } : L(i % 5 ? [] : [obj('head', 100 + (i % 9) * 60, 3.5)]) }));
        if (o.want === 'high' && (stale || fog || sp < A2.config.speed.off_kmh || !low)) bad++;
    }
    ok(bad === 0, 'the invariants over 3000 frames: never high with stale data, under the off speed, with the fog lamps or the low beam off (' + bad + ')');

    // ---- the inputs
    const In = new Inputs({});
    const ev = (n, o) => { const v = {}; Inputs.FIELDS.forEach((k) => { v[k + 'Object' + n] = o[k]; }); return v; };
    ok(In.light(3, ev(3, { XPosition: 255, YPosition: 255, Width: 255, AngularSpeedRight: 255, AngularSpeedLeft: 255, Height: 63, Class: 15, Id: 15, Distance: 127, Status: 7 }), 1000) === null, 'the catalogue\'s defaults: no object');
    const lo = In.light(4, ev(4, { XPosition: 120, YPosition: 90, Width: 6, AngularSpeedRight: 2, AngularSpeedLeft: 3, Height: 3, Class: 1, Id: 5, Distance: 40, Status: 2 }), 1000);
    ok(lo && lo.id === 5 && lo.cls === 1 && lo.dist === 40 && lo.x === 120 && lo.wl === 3 && lo.wr === 2 && lo.slot === 4, 'a light object decoded raw (no scale applied)');
    ok(In.light(11, { XPosition: 130, Distance: 20, Class: 2, Id: 6, Status: 2 }, 1000).id === 6, 'members without the object number are read too');
    ok(In.snap(1200).lights.v.every((l) => l.age === 200), 'each light object carries its own age');
    In.verdict({ controlHighBeam: 1, statusCameraCalibration: 0, numberVehicles: 2, numberRoadSigns: 0, numberPedestrians: 0, reasonSwitchOffHighBeam: 0, qualifierDataControlHighBeamAssistant: 0 }, 1000);
    ok(In.vals.verdict.v.allow === 1 && In.vals.verdict.v.calibration === 0 && In.vals.verdict.v.vehicles === 2, 'the verdict raw (CONTRACT 2.2): the algorithm reads its codes');
    In.lowBeam({ statusLowBeam: 'FAHRLICHT_EINSCHALTEN', ambientBrightnessLowBeam: 12 }, 1000);
    In.lamp2({ controlFunctionMainBeam: 'ON_MAB_MODE_1', controlFunctionFrontFogLight: 'NSW__OFF' }, 1000);
    ok(In.vals.low.v === true && In.vals.high.v === true && In.highSrc === 'highLE2' && In.lampsNow() === 'high', 'the high beam from LampExterior2 while statusLightStatus is silent (the second candidate)');
    In.lightStatus({ statusMainBeam_headlightFlasher: 'AUS', statusDippedBeam: 'EIN', statusFrontFogLight: 'AUS', statusRearFogLight: 'AUS', statusLightStatusError: 'LAMPENZUSTANDS_MINUS_SIGNALE_SIND_IN_ORDNUNG' }, 1100);
    ok(In.vals.high.v === false && In.highSrc === 'highLS', 'statusLightStatus.statusMainBeam_headlightFlasher wins once it speaks (HR\'s best candidate)');
    In.lightStatus({ statusMainBeam_headlightFlasher: 'EIN', statusLightStatusError: 'SIGNAL_UNGUELTIG' }, 1150);
    ok(In.vals.high.v === true && In.highSrc === 'highLE2', 'statusLightStatus with its error set is not trusted: back to LampExterior2');
    In.lightStatus({ statusMainBeam_headlightFlasher: 1, statusLightStatusError: 0 }, 1160);
    ok(In.vals.high.v === true && In.highSrc === 'highLS', 'the same by numbers');
    let s0 = In.snap(1170);
    ok(s0.stalk.some((e) => e.kind === 'high_off') && s0.stalk.some((e) => e.kind === 'high_on'), 'the high beam\'s changes are the contract\'s high_on / high_off events');
    In.stalks({ operationColumnStalks: 0x10 }, 1200);
    ok(In.lampsNow() === 'flash', 'the pull bit held with the high beam lit: flash');
    In.stalks({ operationColumnStalks: 0 }, 1300); In.stalks({ operationColumnStalks: 0x40 }, 1400);
    s0 = In.snap(1500);
    ok(s0.stalk.length === 1 && s0.stalk[0].kind === 'flash' && In.snap(1600).stalk.length === 0, 'the stalk: the pull\'s rising edge is one flash event, handed over once; TRIP 0x40 ignored');
    In.speed({ speedVehicleCentreOfGravity: 5760 }, 1000); In.msg({ statusNumberCheckControlMessageDisplay: 15 }, 1000);
    ok(In.vals.speed.v === 90 && In.vals.msg.v === 15, 'the speed x 0.015625 (90 km/h); the car\'s message number');
    ok(In.signs({ trafficSign: [{ type: 'SPEED_LIMIT' }, { type: 'CITY_LIMIT_START_OF' }] }, 2000) === 'town_in' && In.signs({ trafficSign: [{ type: 'CITY_LIMIT_START_OF' }] }, 2050) === 'town_in', 'a town-entry sign: town_in');
    let sg = In.snap(2100).signs;
    ok(sg.v.length === 1 && sg.v[0].kind === 'town_in' && sg.v[0].t === 2000 && In.snap(2200).signs.v.length === 0, 'reported once while it stays in the list, handed over once (CONTRACT 2.5)');
    In.signs({ trafficSign: [] }, 2900); In.signs({ trafficSign: [{ type: 56 }] }, 3000);
    sg = In.snap(3001).signs;
    ok(sg.v.length === 1 && sg.v[0].kind === 'town_out', 'a town-exit sign (by number): town_out');
    In.sun(true, 3000);
    ok(C.frameOf(In.snap(3002)).env.v.urban === null && C.frameOf(In.snap(3003)).env.v.sun === 'night', 'env.urban stays null: no map flag on this car (CarPlay)');
    In.dayNight({ dayNightChangeOver: 'NACHT' }, 3100);
    ok(C.frameOf(In.snap(3200)).env.v.dayNight === 'night', 'the car\'s own day / night as env.dayNight');
    // the fallback object lists
    const tcp = { eventDataQualifier: 'KEVENTDATAQUALIFIER_EVENTDATAAVAILABLE', numberOfObjects: 2, objectListSmall: [
        { summary: { id: 77 }, position: { x: { value: 90 }, y: { value: 3.4 } }, dynamics: { velocity_absolute: { x: { value: -24 } } }, classification: { class_car: 90, class_truck: 5 }, lights: { status_head_light: 'KHEADLIGHTSTATUS_ON', status_rear_light: 'KREARLIGHTSTATUS_UNKNOWN' } },
        { summary: { id: 78 }, position: { x: { value: 50 }, y: { value: 0 } }, dynamics: { velocity_absolute: { x: { value: 22 } } }, classification: { class_truck: 80 }, lights: { status_head_light: 1, status_rear_light: 2 } }] };
    In.speed({ speedVehicleCentreOfGravity: Math.round(90 / 0.015625) }, 5000); In.tcp(tcp, 5000);
    const ob = In.snap(5100).objects;
    ok(ob.src === 'tcp' && ob.qual === 0 && ob.v.length === 2, 'objectlistTCP: the fallback list, its qualifier as a number');
    ok(ob.v[0].id === 77 && ob.v[0].cls === 1 && ob.v[0].head === 'on' && ob.v[0].vabs === -24 && Math.abs(ob.v[0].vx - (-24 - 25)) < 0.01, 'an oncoming car: class car, head lamps on, the absolute and the relative speed');
    ok(ob.v[1].cls === 2 && ob.v[1].head === 'off' && ob.v[1].rear === 'on', 'a truck ahead: rear lamps on, head lamps off');
    const In2 = new Inputs({});
    In2.camRec({ objectRecognitionInfo: [{ classificationType: 'CAR_WITH_OR_WITHOUT_TRAILER', statusMovement: 'MOVING_OBJECT_MOVEMENT_DIRECTION_ONCOMMING', objectID: 9 }, { classificationType: 'ROAD_BOUNDARY' }] });
    In2.camPos({ eventDataQualifier: 'EVENT_DATA_AVAILABLE_REDUCED', numberOfObjects: 2, objectPositionInfo: [{ positionX: 120, positionY: 3 }, { positionX: 10, positionY: 1 }] }, 6000);
    const ob2 = In2.snap(6100).objects;
    ok(ob2.src === 'cam' && ob2.qual === 1 && ob2.v.length === 1 && ob2.v[0].move === 'oncoming' && ob2.v[0].vx === null && ob2.v[0].id === 9, 'ObjectRecognitionFrontCamera: statusMovement ONCOMING, no velocity (never invented), the road boundary skipped, qualifier reduced = 1');

    // ---- the score
    const S = new Score({ windowMs: 10000 });
    S.feed(0, 'high', 'high', 'HIGH'); S.feed(1000, 'high', 'high', 'HIGH'); S.feed(2000, 'low', 'high', 'DIPPED'); S.feed(3200, 'low', 'low', 'DIPPED');
    S.feed(5000, 'low', 'low', 'DIPPED'); S.feed(6000, 'low', 'high', 'DIPPED'); S.feed(8000, 'high', 'high', 'HIGH'); S.feed(9000, 'high', 'flash', 'HIGH');
    let s = S.summary();
    ok(s.driver === 2 && s.app === 2 && s.early === 1 && s.late === 1 && s.leadS === 1.2 && s.lagS === 2, 'the score: early (lead 1.2 s) and late (lag 2 s), a flash is not a switch');
    ok(s.agreePct === Math.round(6800 * 100 / 9000) || s.agreePct > 60, 'agreement by time (' + s.agreePct + ' %)');
    S.feed(30000, 'low', 'high', 'DIPPED'); S.feed(45000, 'low', 'high', 'DIPPED');
    s = S.summary();
    ok(s.extra === 1, 'an advice the driver never followed: extra');
    ok(/^beam: score agree \d+% of \d+ s, driver \d+ app \d+, early 1 \(lead 1\.2 s\), late 1 \(lag 2 s\), missed 0, extra 1$/.test(S.line()), 'the log line: numbers only (' + S.line() + ')');
    S.reset(); ok(S.summary().driver === 0 && S.summary().agreePct === null, 'reset per drive');

    // ---- the source logs
    const lgS = nullLog(), SL = new SrcLog(lgS, 10000, ['lights', 'verdict']);
    SL.first('lights', { XPositionObject1: 120, DistanceObject1: 40 }); SL.first('lights', { x: 1 });
    for (let i = 0; i < 50; i++) SL.add('lights', i * 100, i % 10 === 0 ? { n: 2, cls: { 1: 2 }, min: 10, max: 50 } : undefined);
    SL.tick(0); SL.tick(10500);
    ok(lgS.lines[0] === 'beam: src lights first XPositionObject1=120 DistanceObject1=40' && lgS.lines.filter((l) => / first /.test(l)).length === 1, 'the first message of a source: one line, its raw members');
    ok(lgS.lines.some((l) => /^beam: src lights n 50 rate [\d.]+\/s objs 2\.\.2 cls 1:10 dist 10\.\.50$/.test(l)), 'the 10 s summary (count, rate, objects, classes, distances raw)');
    ok(lgS.lines.some((l) => /^beam: src verdict silent \(nothing in 11 s\)$/.test(l)), 'a source that never came: "silent", once');
    ok(SrcLog.rawWords({ a: 'NAME_X', b: 'x y?é' }) === 'a=NAME_X b=x?y??', 'raw words: enum names and numbers only (anything else masked)');

    // ---- the states and the scenes
    ok(V.DEMO.length === 19 && V.DEMO.map((d) => d[0]).join() === '01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,16,17,18,19', 'the 18 states of the brief and the fallback (19)');
    const st = (id) => V.DEMO.filter((d) => d[0] === id)[0][2];
    ok(st('12').disagree && !V.DEMO.filter((d) => d[0] !== '12').some((d) => d[2].disagree), 'only state 12 (the driver keeps high while dip is advised) is a disagreement');
    ok(st('17').yield && st('18').act === 'high' && st('11').countdown === 2 && st('10').curve > 0 && st('19').src === 'object' && st('04').town === 'sign', 'the yield, the actuator line, the countdown, the curve, the fallback source, the town sign');
    ok(V.DEMO.every((d) => C.REASONS.indexOf(d[2].reason) >= 0 && C.STATES.indexOf(d[2].state) >= 0), 'every state uses the contract\'s codes');
    const pl = new SC.Player(new C.Decider({ objects: { use: 'fallback' } }, nullLog()));
    const seen = {};
    SC.SCENES.forEach((n, k) => { for (let ms = 0; ms < SC.SCENE_MS; ms += 100) { const q = pl.step(n, ms); seen[n + ':' + q.out.state + ':' + q.out.reason] = true; if (q.out.src) seen[n + ':src:' + q.out.src] = true; } });
    ok(seen['pass:DIPPED:oncoming'] && seen['pass:HIGH:clear'], 'scene "pass" through the real algorithm: high, dipped for the oncoming car, high again');
    ok(seen['follow:DIPPED:preceding'] && seen['follow:HIGH:clear'], 'scene "follow": dipped for the car ahead, high after it turned off');
    ok(seen['town:STANDBY:town'], 'scene "town": the town-entry sign (or the 50 limit) gives town');
    ok(Object.keys(seen).some((k) => /^curve:DIPPED:curve/.test(k)), 'scene "curve": the yaw holds the low beam');
    ok(seen['fallback:DIPPED:oncoming'] && seen['fallback:src:object'] && !seen['fallback:src:light'], 'scene "fallback": the light stream silent, the object list dips for the oncoming car');

    // ---- every state, day and night, uk and en, in the ONE scene (model.js DEMO 29..47): colours, words in their boxes
    const pages = {};
    V.DEMO.forEach((d) => ['day', 'night'].forEach((light) => ['uk', 'en'].forEach((lang) => {
        const v = d[2], s = sceneOf(d[0]), night = light === 'night', tag = d[0] + ' ' + light + ' ' + lang;
        const Qc = M.colours('centre', night), Qm = M.colours('map', night);
        const pg = P.centre(s, { night, lang });
        const c1 = census(pg.px, Qc), sheet = P.textSheet(s, night, lang), c2 = census(sheet, Qm);
        // the advice is drawn at night while the advisor is available (by day the scene is ACC View's)
        const shown = M.adviceShown(s, night), blueOk = shown && v.adv === 'high' && v.go && v.data === 'ok';
        ok(c1.red === 0 && c2.red === 0, tag + ': no red');
        ok((c1.amber > 0) === (shown && v.disagree) && (c2.amber > 0) === (shown && v.disagree), tag + ': amber only in the disagreement, while the advice shows (' + c1.amber + ' / ' + c2.amber + ')');
        ok((c1.blue > 0) === blueOk && (c2.blue > 0) === blueOk, tag + ': blue only while high is advised (' + c1.blue + ' / ' + c2.blue + ')');
        ok(shown === (night && v.data === 'ok' && v.state !== 'UNAVAILABLE'), tag + ': the advice ' + (shown ? 'shown' : 'not shown'));
        const out = pg.words.filter((w) => w.x < w.x0 - 1 || w.x + w.w > w.x1 + 1);
        ok(!out.length, tag + ': every word of the page inside its box' + (out.length ? ': ' + out.map((w) => w.key + ' "' + w.str + '"').join(', ') : ''));
        const mw = P.textSheetWords(s, night, lang).filter((w) => w.w > w.x1 - w.x0 + 1 || w.cut);
        ok(!mw.length, tag + ': the map sheet\'s words fit, none cut' + (mw.length ? ': ' + mw.map((w) => w.key + ' "' + w.str + '"').join(', ') : ''));
        ok((lang === 'uk') === CYR.test(pg.words.map((w) => w.str).join(' ')), tag + ': the page\'s words in ' + lang);
        pages[tag] = pg;
    })));
    // the night look: dim, small and slow (the mean brightness of the night pictures; the cluster's sheet is mostly see-through)
    const lumC = V.DEMO.map((d) => R.meanLuma(pages[d[0] + ' night uk'].px)), lumD = V.DEMO.map((d) => R.meanLuma(pages[d[0] + ' day uk'].px));
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    console.log('night look: the centre page\'s mean brightness ' + mean(lumC).toFixed(1) + ' (max ' + Math.max.apply(null, lumC).toFixed(1) + ') of 255; day ' + mean(lumD).toFixed(1));
    ok(mean(lumC) < mean(lumD) && Math.max.apply(null, lumC) < 30, 'the night page is darker than the day page and its mean stays under 30 of 255');
    const sheetsN = V.DEMO.map((d) => { const px = P.textSheet(sceneOf(d[0]), true, 'uk'); let s2 = 0; for (let i = 0; i < px.length; i += 4) s2 += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) * px[i + 3] / 255; return s2 / (px.length / 4); });
    console.log('night look: the map\'s text sheet mean ' + mean(sheetsN).toFixed(1) + ' (max ' + Math.max.apply(null, sheetsN).toFixed(1) + ')');
    ok(Math.max.apply(null, sheetsN) < 25, 'the map\'s night text sheet: no large bright area (mean < 25)');
    // the software scene follows the shader's field (the same maths, now in acc_lane): above the horizon nothing; the high beam adds light
    const g = M.GEO.centre, Pn = M.colours('centre', true), base = Object.assign({}, sceneOf('05'));
    const lumAt = (e, y) => { const cv = new R.Canvas(1600, 482, [0, 0, 0]); P.lane(cv, g, Object.assign({}, base, { e }), 0, Pn, 0); let s2 = 0; for (let x = 300; x < 500; x++) { const i = (y * 1600 + x) * 4; s2 += cv.px[i] + cv.px[i + 1]; } return s2; };
    ok(lumAt(1, 290) > lumAt(0, 290) * 1.2 && lumAt(1, g.lane[1] + 4) === 0, 'the scene\'s field: the sky above the horizon is empty; the high beam adds light far down the road');

    // ---- the GPU page (the merged gpu.js)
    const cv = new Rec.Recorder(1600, 520);
    const ids = { band: 0x52530002, table: 0x52530003, sprites: { car: [0x52530010, 0x52530011], carFast: [0x52530012, 0x52530013], ego: [0x52530014, 0x52530015] } };
    Rec.setImage(ids.band, 800, P.BAND_H, Buffer.alloc(800 * P.BAND_H * 4)); Rec.setImage(ids.table, 800, P.PAGE_H, Buffer.alloc(800 * P.PAGE_H * 4));
    let quads = 0, maxWords = 0, imagesOk = true;
    V.DEMO.forEach((d) => ['day', 'night'].forEach((light) => {
        cv.reset();
        GP.draw(cv, sceneOf(d[0]), { night: light === 'night', lang: 'uk' }, ids);
        const w = cv.words();
        maxWords = Math.max(maxWords, w.length);
        try { Rec.play(w, { image() {}, quad() { quads++; }, tris() {}, line() {}, arc() {}, clear() {}, clip() {}, noclip() {}, roundRect() {}, fillRect() {}, glyphs() {}, text() {}, circle() {}, polyline() {} }); } catch (e) { /* the play's own stand-in */ }
        if (!(cv.images.has(ids.band) && cv.images.has(ids.table))) imagesOk = false;
    }));
    ok(quads === 0, 'the GPU page: no QUAD op in any of the 38 frames');
    ok(imagesOk, 'the band and the table go as images');
    ok(maxWords > 0 && maxWords <= 16000, 'a frame is at most 16 000 words (' + maxWords + ')');
    const rec = (s, e) => { cv.reset(); GP.draw(cv, Object.assign({}, s, { e }), { night: true, lang: 'uk' }, ids); return Array.from(cv.words()); };
    const s05 = sceneOf('05');
    const wA = rec(s05, 1), wB = rec(s05, 1), wC = rec(s05, 0.5);
    ok(JSON.stringify(wA) === JSON.stringify(wB), 'the same state: the same frame word for word (main.js sends nothing: none while still)');
    ok(JSON.stringify(wA) !== JSON.stringify(wC), 'the beam folding: a new frame (frames while moving)');
    const recSrc = fs.readFileSync(path.join(APPDIR, 'gpu.js'), 'utf8');
    ok(!/\.quad\(/.test(stripComments(recSrc)) && /case 15: i \+= 9/.test(fs.readFileSync(path.join(ROOT, 'kit', 'runtime', 'renderd.js'), 'utf8')), 'gpu.js never calls quad() (and kit/runtime/renderd.js knows case 15 anyway)');
    const mainNoFrame = /if \(same\) return undefined;/.test(mainSrc);
    ok(mainNoFrame, 'main.js sends no frame when nothing moved');

    // ---- the map target: the merged six layers carry the beam part (no layers of its own any more)
    const cr = new FakeCR(), shaders = JSON.parse(fs.readFileSync(path.join(APPDIR, 'hud', 'shaders.json'), 'utf8'));
    const mv = new MapView({ ClusterRender: function () { return cr; } }, { layer: { target: 'map', contend: false, guideHold: 0 }, shaders });
    mv.open();
    ok(cr.layers.length === 6 && cr.layers.map((l) => l.kind).join() === 'effect,effect,effect,effect,image,image', 'the map: the merged 6 layers (4 effects, 2 images), under the 8 a connection allows; the beam part adds none');
    ok(cr.layers.every((l) => l.o.target === 'map' && l.o.contend === false && l.o.guide_hold === 0), 'every layer on map, no contend, guide_hold 0');
    ok(cr.layers.filter((l, i) => i !== 2 && i !== 3).every((l) => l.o.x >= 334 && l.o.y >= 44 && l.o.x + l.o.w <= 754 && l.o.y + l.o.h <= 416), 'every fixed layer inside the core x 334..754, y 44..416');
    ok(cr.layers[0].o.fs === shaders.acc_lane && /u_beam/.test(shaders.acc_lane) && cr.layers[1].o.fs === shaders.acc_obj && /lampc/.test(shaders.acc_obj), 'the shipped shaders: the beams in acc_lane, the light sources in acc_obj');
    ok(MapView.PIXEL_MEMORY === (420 * 96 + 340 * 44) * 8 && MapView.PIXEL_MEMORY < 16 * 1048576 * 0.05, 'pixel memory ' + MapView.PIXEL_MEMORY + ' B (two images counted twice), under 3 % of the 16 MiB');
    const hi = Object.assign({}, s05, { e: 1 });
    let b0 = mv.update(hi, 0, true, 'uk');
    ok(b0 > 0, 'the first picture: the text sheet uploaded (' + b0 + ' B)');
    const n1 = cr.msgs.length;
    let px = 0;
    for (let i = 1; i <= 9; i++) px += mv.update(Object.assign({}, hi, { e: 1 - i / 9 }), 0, true, 'uk');
    const m2 = cr.msgs.slice(n1);
    ok(px === 0 && m2.every((m) => m.op === 'uniform' && m.name === 'u_beam') && m2.length === 9, 'the beam folding: 9 uniform messages (acc_lane\'s u_beam), 0 B of pixels');
    const moving = Object.assign({}, sceneOf('07'), { e: 0 });
    mv.update(moving, 0, true, 'uk');
    const n3 = cr.msgs.length;
    px = 0;
    for (let i = 1; i <= 8; i++) px += mv.update(Object.assign({}, moving, { beam: Object.assign({}, moving.beam, { lights: [{ id: 1, kind: 'head', x: 170 - i * 15, y: 3.5, ringed: true, src: 'light' }] }) }), 0, true, 'uk');
    ok(px === 0 && cr.msgs.slice(n3).every((m) => m.op === 'uniform') && cr.msgs.slice(n3).every((m) => (m.bytes || 0) < 800), 'a light moving: uniform messages only (< 800 B each), 0 B of pixels');
    const n4 = cr.msgs.length;
    mv.update(sceneOf('17'), 0, true, 'uk');
    const sets = cr.msgs.slice(n4).filter((m) => m.op === 'set');
    ok(sets.length === 5 && sets.every((m) => m.o.visible === false), 'the car\'s own message: every layer hidden (our picture yields; the car ahead\'s was hidden already)');
    mv.update(hi, 0, true, 'uk');
    ok(cr.layers.filter((l, i) => i !== 2).every((l) => l.o.visible === true), 'the message gone: the layers back');
    const n5 = cr.msgs.length;
    mv.update(sceneOf('12'), 0, true, 'uk');
    ok(cr.msgs.slice(n5).some((m) => m.op === 'pixels' && m.bytes > 0), 'an advice change: the text sheet\'s changed rectangle');
    mv.close(); ok(cr.closed, 'off: the connection closed');
    const many = Object.assign({}, sceneOf('09'), { beam: Object.assign({}, sceneOf('09').beam, { lights: Array.apply(null, Array(20)).map((x, i) => ({ id: i, kind: 'street', x: 20 + i * 10, y: 7, ringed: false, src: 'light' })) }) });
    const lu = M.objUniforms(M.GEO.map, many, true);
    ok(lu.u_ob.length === 64 && lu.u_oc.length === 64 && lu.u_oc.filter((x, i) => i % 4 === 0 && x >= 7 && x <= 10).length === M.MAX_POINTS, 'at most 16 items (64 numbers per array); of 20 street lights the ' + M.MAX_POINTS + ' nearest drawn as points');

    // ---- the shaders: the beam part lives in acc_lane (the beams) and acc_obj (the light sources) now
    const SH = path.join(APPDIR, 'shaders');
    ['acc_lane', 'acc_obj'].forEach((n) => {
        const src = fs.readFileSync(path.join(SH, n + '.glsl'), 'utf8'), shipped = shaders[n];
        const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n') + '\n';
        ok(shipped === strip(src), n + ': hud/shaders.json is the source with comments stripped');
        ok(Buffer.byteLength(shipped) < 4000, n + ': ' + Buffer.byteLength(shipped) + ' B shipped (the KOMBI reset near 26.7 k)');
        ok(/#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;/.test(shipped), n + ': highp');
        ok(!/sampler2D|texture2D/.test(shipped), n + ': no sampler (nothing can be left unbound, no R8 texture)');
        ok(!/#if(?!def GL_FRAGMENT_PRECISION_HIGH)|#elif|#define/.test(shipped), n + ': one look (no #if styles)');
        ok(/varying vec2 v_uv;/.test(shipped) && /gl_FragColor/.test(shipped) && !/\b(in|out) (vec|float)|texture\(|#version/.test(shipped), n + ': GLSL ES 1.00 forms');
        ok(!/for \(int \w+ = 0; \w+ < [A-Za-z_]\w*;/.test(shipped), n + ': loops have constant bounds');
    });
    ok(Buffer.byteLength(shaders.acc_lane) + Buffer.byteLength(shaders.acc_obj) < 8000, 'the two shaders that carry the beam part together under 8 KB (Auto Beam\'s own two were 4 307 B)');
}

/* ------------------------------------------------------------------------------------------------ part 2: the bench */
const LIGHT_IF = 'de.bmw.sensors.objects.RecogFrontCameraLightDetection';

async function part2() {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'road-scene-beam-'));
    const dataDir = path.join(work, 'data'), imgDir = path.join(work, 'img');
    fs.mkdirSync(dataDir); fs.mkdirSync(imgDir);
    let out = '';
    const env = Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, BENCH_IMAGE_DIR: imgDir, BENCH_LAYER_CAP: '8', BENCH_CONFIG: JSON.stringify({ demoMs: 600000, night: 'night' }) });
    const srv = spawn(process.execPath, [path.join(ROOT, 'bench', 'server.js'), 'road_scene'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', (c) => { out += c; });
    srv.stderr.on('data', (c) => { out += c; });
    const waitFor = async (re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(out)) return true; await sleep(100); } return false; };
    const feed = (iface, field, value) => request('POST', '/fake', { feed: { iface, field, value } });
    const objEv = (n, o) => { const v = {}; ['XPosition', 'YPosition', 'Width', 'Height', 'AngularSpeedLeft', 'AngularSpeedRight', 'Class', 'Id', 'Distance', 'Status'].forEach((k) => { v[k + 'Object' + n] = o[k]; }); return v; };
    const none = { XPosition: 255, YPosition: 255, Width: 255, Height: 63, AngularSpeedLeft: 255, AngularSpeedRight: 255, Class: 15, Id: 15, Distance: 127, Status: 7 };
    const evName = (n) => (n === 11 || n === 12 || n === 15 ? 'M' : 'm') + 'ainBeamAssistantDataObject' + n;
    let es = null;
    try {
        ok(await waitFor(/scene: Road Scene 0\.1\.0 started \(one loop of 100 ms; the beam part advises: its actuator is null, it switches nothing\)/, 90000), 'the app built by the kit and started: the advisor, the null actuator');
        ok(/road_scene 0\.1\.0: dist\/road_scene@0\.1\.0/.test(out), 'the kit built road_scene 0.1.0');
        ok(/beam: algorithm (STAND-IN )?shared\/beam_logic\.js contract 1/.test(out), 'the log names the algorithm and its contract version 1');
        ok(await waitFor(/scene: watch SignRecognitionFrontCamera ok/, 8000) && ['RecogFrontCameraLightDetection', 'RecogFrontCameraObjectlist', 'ObjectRecognitionFrontCamera', 'Light', 'Vehicle2'].every((i) => new RegExp('scene: watch ' + i + ' ok').test(out)), 'subscribed at start (read only): the lights, both object lists, the signs, the lamps');
        es = stream();
        await sleep(800);
        const mine = (ls) => (ls || []).filter((l) => l.app === 'road_scene');
        ok(es.scene && mine(es.scene).length === 0, 'the cluster off by default: no layer');
        ok(await waitFor(/beam: state UNAVAILABLE nodata/, 4000), 'no camera data: UNAVAILABLE nodata');
        ok(await waitFor(/beam: src lights silent/, 14000), 'after 10 s the log says the light stream is silent');
        const probe = JSON.parse((await request('GET', '/probe')).body.toString() || '{}');
        ok(probe.images && probe.images.MAIN_GFX && probe.images.MAIN_GFX.w === 1600, 'the centre page pushed to the HMI (1600 x 520)');
        // the car's values: night, low beam on, the high beam lit (statusLightStatus, HR's first candidate), 86 km/h
        await feed('de.bmw.infotainment.vehicle.Vehicle', 'statusDayNightChangeOver', { dayNightChangeOver: 'NACHT' });
        await feed('de.bmw.body.Light', 'LowBeam', { statusLowBeam: 'FAHRLICHT_EINSCHALTEN', ambientBrightnessLowBeam: 4 });
        await feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusLightStatus', { statusMainBeam_headlightFlasher: 'EIN', statusDippedBeam: 'EIN', statusFrontFogLight: 'AUS', statusRearFogLight: 'AUS', statusPositionLight: 'EIN', statusLightStatusError: 'LAMPENZUSTANDS_MINUS_SIGNALE_SIND_IN_ORDNUNG' });
        await request('POST', '/setting', { key: 'show', value: true });
        ok(await waitFor(/scene: map layers 6 \(lane \+ beams, users \+ lights, car, ego, text 420x96, pill 340x44\) on map \(waits for the slot\), pixel memory 442240/, 8000), 'show on: the merged 6 layers asked for (the beams and lights inside them), waiting for the slot');
        const feedLights = async (objs, ms) => {
            const t0 = Date.now();
            while (Date.now() - t0 < ms) {
                await feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusCarSpeed2', { speedVehicleCentreOfGravity: Math.round(86 / 0.015625) });
                for (let n = 1; n <= 15; n++) await feed(LIGHT_IF, evName(n), objEv(n, objs[n - 1] || none));
                await sleep(60);
            }
        };
        await feedLights([], 1500);
        ok(await waitFor(/beam: src lights first XPositionObject\d+=255/, 3000), 'the first light message logged with its raw members');
        await feedLights([], 9000);
        ok(await waitFor(/beam: state HIGH clear want high lamps high data ok/, 3000), 'the stream with no object, dark, 86 km/h: HIGH clear (the lamps high from statusLightStatus)');
        ok(/beam: source - -> light/.test(out), 'the log: the source is the light stream');
        await sleep(400);
        let ls = mine(es.scene);
        ok(ls.length === 6 && ls.map((l) => l.kind).join() === 'effect,effect,effect,effect,image,image', 'the scene: 6 layers on map (' + ls.map((l) => l.kind).join() + ')');
        const road = ls.filter((l) => l.z === 0)[0] || {};
        ok(road.uniforms && road.uniforms.u_beam && road.uniforms.u_beam.v[0] === 1 && road.uniforms.u_beam.v[1] === 1, 'the lane layer at night: the beams on, the high beam out (u_beam 1, 1: the lamps are high)');
        // an oncoming car at 240 m (raw distance 60, the module's assumed 4 m a step): dip at once; the lamps still high -> amber
        const onc = { XPosition: 126, YPosition: 127, Width: 3, Height: 2, AngularSpeedLeft: 127, AngularSpeedRight: 127, Class: 1, Id: 4, Distance: 60, Status: 2 };
        await feedLights([onc], 1200);
        ok(/beam: state DIPPED oncoming want low lamps high/.test(out), 'an oncoming car in the zone: DIPPED oncoming, want low (the lamps still high)');
        ok(/beam: actuator \(null\) would switch to low \(oncoming\); nothing sent/.test(out), 'the null actuator: "would switch to low"; nothing sent');
        const sceneUntil = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn(mine(es.scene))) return true; await sleep(100); } return false; };
        const ringedHead = (x) => { const oc = ((x.filter((l) => l.z === 1)[0] || {}).uniforms || {}).u_oc; return !!(oc && oc.v[0] === 7 && oc.v[3] === 1); };
        await sceneUntil(ringedHead, 2500);
        ls = mine(es.scene);
        const roadL = ls.filter((l) => l.z === 0)[0] || {};
        ok(ringedHead(ls), 'the cluster: the oncoming car\'s lamps drawn as a point (class 7, headlamps) and ringed');
        ok(roadL.uniforms && roadL.uniforms.u_beam && roadL.uniforms.u_beam.v[0] === 1, 'the high beam stays out while the lamps are still high: the picture is the lamps\' real state, the advice is the sign');
        const textL = ls.filter((l) => l.z === 4)[0];
        if (textL) {
            const pxs = (await request('GET', '/px?key=' + encodeURIComponent(textL.key) + '&x=0&y=0&w=' + textL.w + '&h=' + textL.h)).body;
            const Q = M.colours('map', true);
            let amber = 0;
            for (let i = 0; i < pxs.length; i += 4) if (pxs[i + 3] > 200 && near(pxs[i], pxs[i + 1], pxs[i + 2], Q.amber, 8)) amber++;
            ok(amber > 8, 'the text sheet read back: the lamps\' small sign amber (dip advised, the high beam lit; ' + amber + ' px)');
        } else ok(false, 'the text layer');
        // the driver dips: no disagreement
        await feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusLightStatus', { statusMainBeam_headlightFlasher: 'AUS', statusDippedBeam: 'EIN', statusFrontFogLight: 'AUS', statusRearFogLight: 'AUS', statusLightStatusError: 'LAMPENZUSTANDS_MINUS_SIGNALE_SIND_IN_ORDNUNG' });
        await feedLights([onc], 800);
        ok(/beam: state DIPPED oncoming want low lamps low/.test(out), 'the driver dipped: want low, lamps low');
        await sceneUntil((x) => { const u = ((x.filter((l) => l.z === 0)[0] || {}).uniforms || {}).u_beam; return !!(u && u.v[0] === 0); }, 2000);
        const ub = ((mine(es.scene).filter((l) => l.z === 0)[0] || {}).uniforms || {}).u_beam;
        ok(ub && ub.v[0] === 0 && ub.v[1] === 1, 'the driver dipped: the high beam folds in on the road (u_beam.x 0), the low beam stays');
        // the stalk
        await feed('de.bmw.body.Light', 'IndicatorSteeringColumn', { operationColumnStalks: 0x20 });
        await feed('de.bmw.body.Light', 'IndicatorSteeringColumn', { operationColumnStalks: 0 });
        ok(await waitFor(/beam: stalk bits 0x0 -> 0x20/, 2000), 'the stalk\'s bits logged as they change');
        // the car's own message: our picture yields
        await feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusDisplayedCCMessage', { statusNumberCheckControlMessageDisplay: 15 });
        await feedLights([onc], 600);
        ls = mine(es.scene);
        ok(ls.length === 6 && ls.every((l) => l.visible === 0), 'the car shows a message: every layer of ours hidden');
        await feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusDisplayedCCMessage', { statusNumberCheckControlMessageDisplay: 0 });
        await feedLights([onc], 600);
        ok(mine(es.scene).filter((l) => l.z !== 2).every((l) => l.visible === 1), 'the message gone: our layers back');
        // the light stream goes silent: the fallback object list takes over
        const TCP = 'de.bmw.sensors.objects.RecogFrontCameraObjectlist';
        const tcp = (x) => ({ eventDataQualifier: 'KEVENTDATAQUALIFIER_EVENTDATAAVAILABLE', numberOfObjects: 1, objectListSmall: [{ summary: { id: 51 }, position: { x: { value: x }, y: { value: 3.5 } }, dynamics: { velocity_absolute: { x: { value: -24 } } }, classification: { class_car: 90 }, lights: { status_head_light: 'KHEADLIGHTSTATUS_ON', status_rear_light: 'KREARLIGHTSTATUS_UNKNOWN' } }] });
        const t1 = Date.now();
        while (Date.now() - t1 < 1500) { await feed(TCP, 'objectlistTCP', tcp(120)); await feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusCarSpeed2', { speedVehicleCentreOfGravity: Math.round(86 / 0.015625) }); await sleep(80); }
        ok(/beam: source light -> object/.test(out), 'the light stream silent: the source switches to the camera\'s object list');
        const after = out.split('beam: source light -> object').pop(), before = out.split('beam: source light -> object')[0];
        ok(/beam: state DIPPED oncoming[^\n]*\n?[^]*$/.test(before.split('beam: state').pop().replace(/^/, 'beam: state')) && !/beam: state HIGH/.test(after.split('beam: town sign')[0]), 'the fallback: the oncoming car (head lamps on) keeps the dip, never high in between');
        const objL = ((mine(es.scene).filter((l) => l.z === 1)[0] || {}).uniforms || {}).u_oc;
        ok(objL && objL.v[0] === 7 && objL.v[3] === 1, 'the fallback object (head lamps on, 120 m: beyond the road users\' range) drawn as an oncoming light and ringed on the cluster');
        ok(/beam: src objectlist first numberOfObjects=1 eventDataQualifier=KEVENTDATAQUALIFIER_EVENTDATAAVAILABLE/.test(out), 'the object list\'s first message logged');
        // the town-entry sign
        await feed('de.bmw.environmentalmodel.SignRecognitionFrontCamera', 'TrafficSignRecognitionFrontCamera', { eventDataQualifier: 'EVENT_DATA_AVAILABLE', trafficSign: [{ type: 'CITY_LIMIT_START_OF', value: 0 }] });
        const t2 = Date.now();
        while (Date.now() - t2 < 800) { await feed(TCP, 'objectlistTCP', tcp(300)); await feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusCarSpeed2', { speedVehicleCentreOfGravity: Math.round(60 / 0.015625) }); await sleep(80); }
        ok(/beam: town sign town_in/.test(out) && /beam: state STANDBY town/.test(out), 'the camera\'s town-entry sign: STANDBY town');
        // silence: nodata -> low
        await sleep(2000);
        ok(await waitFor(/beam: state UNAVAILABLE nodata want low lamps low data stale/, 3000), 'every stream silent: UNAVAILABLE nodata, low (data stale)');
        ok(await waitFor(/beam: src lights n \d+ rate [\d.]+\/s/, 12000), 'the 10 s summary line of the light stream');
        ok(!/scene: (tick|apply|page|layer|target|setting|layout|start|light \d+|verdict|lowbeam|lamps|lightstatus|stalk|bright|rain|speed|message|daynight|yaw|limit|signs|tcp|cam rec|cam pos|profile settings|lang|front|cruise|warn|lanes|motion \w+):\s/.test(out.replace(/scene: layer \d+ shown/g, '').replace(/scene: target map \w+/g, '')), 'no error from the app\'s guards');
        ok(!/\b\w*Error:|uncaught|unhandled/i.test(out.split('\n').filter((l) => /\[road_scene\]/.test(l)).join('\n')), 'no exception in the app\'s log');
        ok((out.match(/would switch to/g) || []).length <= 8, 'the actuator\'s lines stay few (one per change)');
        await request('POST', '/setting', { key: 'show', value: false });
        ok(await waitFor(/scene: map layers dropped/, 5000), 'off again: the layers dropped');
    } finally {
        if (es) es.close();
        srv.kill('SIGTERM');
        await sleep(300);
        if (Cm.T.fail) console.log('--- bench log (tail) ---\n' + out.split('\n').filter((l) => !/fake persod/.test(l)).slice(-(Number(process.env.BEAM_LOG_LINES) || 50)).join('\n'));
        try { require('child_process').execFileSync('rm', ['-rf', work]); } catch (e) { /* left behind */ }
    }
}

/* ------------------------------------------------------------------------------------------------ part 3: WebGL */
function part3() {
    if (!fs.existsSync(CHROME)) { console.log('beam, part 3: skipped (no Chrome)'); return; }
    // Auto Beam's two shaders are gone: its beams and lights are drawn by the merged acc_lane and acc_obj, at the map's own size
    const sj = JSON.parse(fs.readFileSync(path.join(APPDIR, 'hud', 'shaders.json'), 'utf8'));
    const g = M.GEO.map, s07 = Object.assign({}, sceneOf('07'), { e: 1, beam: Object.assign({}, sceneOf('07').beam, { lamps: 'high' }) });
    const runs = {
        lane_beams: { shader: 'acc_lane', size: [g.lane[2], g.lane[3]], u: M.laneUniforms(g, s07, 0, true) },
        obj_lights: { shader: 'acc_obj', size: [g.lane[2], g.lane[3]], u: M.objUniforms(g, sceneOf('19'), true) },
    };
    const r = Cm.webgl(sj, runs);
    console.log('webgl: ' + r.text.replace(/\n/g, ' | '));
    ok(/webgl WebGL GLSL ES 1\.0/.test(r.dom), 'headless Chrome has WebGL 1 (GLSL ES 1.00)');
    Object.keys(runs).forEach((n) => {
        const m = r.res[n];
        ok(m && m.okc && m.okl, n + ': compiles and links as GLSL ES 1.00 in WebGL');
        ok(m && m.lit > 20, n + ': draws (' + (m ? m.lit : 0) + ' opaque px)');
    });
}

module.exports = async function run() {
    const p0 = Cm.T.pass, f0 = Cm.T.fail, at = (q, g) => (Cm.T.pass - q) + ' passed, ' + (Cm.T.fail - g) + ' failed';
    part1();
    console.log('beam, part 1 (pure): ' + at(p0, f0));
    if (args.indexOf('--no-gl') < 0) { const q = Cm.T.pass, g = Cm.T.fail; part3(); console.log('beam, part 3 (WebGL): ' + at(q, g)); }
    if (args.indexOf('--no-bench') < 0) { const q = Cm.T.pass, g = Cm.T.fail; await part2(); console.log('beam, part 2 (bench, port ' + PORT + '): ' + at(q, g)); }
    console.log('beam (Auto Beam\'s suite): ' + at(p0, f0));
};
