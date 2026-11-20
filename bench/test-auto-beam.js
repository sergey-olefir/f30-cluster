'use strict';
/**
 * bench/test-auto-beam.js - Auto Beam 0.1.0, the advisor app (round "Auto Beam", package HD; docs/highbeam/BRIEF-HD-design-app.md).
 *
 *   node bench/test-auto-beam.js [--no-bench] [--no-gl] [--no-emu] [--port 8932]     (BENCH_PORT also sets the port; default 8932)
 *
 * Part 1 (pure): the manifest (read-only flags, non-zero getters by tools/signals/check_signals.py, no forbidden member, events as
 * broadcasts, off by default); a static scan (no setter call, no method call on the car, no diagnostic request, no lamp
 * command anywhere in the app or the algorithm); the actuator is the null one; Node 8 syntax; no Cyrillic literal; the
 * words (both tables complete, the atlases hold every character, widths % 4); the adapter (frame leaves, unknown values ->
 * low, an exception -> low and the app keeps going); the stand-in's rules (each state and reason, the hysteresis, the
 * override, the flash, the fail-safes); the inputs (the catalogue's defaults = no object, the stalk's edges, the scales); the
 * score; the source logs; the 18 states and the 4 scenes through the real algorithm; every state day and night in uk and
 * en on the centre page and the map sheet: no red, amber only in the disagreement, blue only while high is advised, every
 * word inside its box; the night look's brightness; the GPU page (no QUAD, frames while moving, none while still); the map
 * target (3 layers inside the core, pixel memory, no pixels while only the beam moves, the yield); the shaders (size, highp,
 * no sampler, one look, GLSL ES 1.00 forms).
 * Part 2 (bench): the app built by the kit and run against the fake cluster-render and head unit: raw events fed, the
 * decisions, the logs, the map layers, the yield, the stale fall to low, no guard error.
 * Part 3 (WebGL): both shaders compiled, linked and drawn by headless Chrome's WebGL 1 (skipped without Chrome).
 * Part 4 (emulator): the kit's emulator: the GPU page's frame rate while the scenes move, none while still, no memory growth.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APPDIR = path.join(ROOT, 'apps', 'auto_beam');
const args = process.argv.slice(2);
const PORT = Number(args.indexOf('--port') >= 0 ? args[args.indexOf('--port') + 1] : process.env.BENCH_PORT || 8932);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0, fail = 0;
function ok(c, what) { if (c) pass++; else { fail++; console.log('FAIL ' + what); } }

const C = require(path.join(APPDIR, 'contract.js'));
const Inputs = require(path.join(APPDIR, 'inputs.js'));
const V = require(path.join(APPDIR, 'view.js'));
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
const Rec = require(path.join(ROOT, 'kit', 'runtime', 'record.js'));

const CYR = /[\u0400-\u04FF]/;
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
const isRed = (r, g, b) => r > 150 && g < 90 && b < 90;
const near = (r, g, b, c, d) => Math.abs(r - c[0]) <= d && Math.abs(g - c[1]) <= d && Math.abs(b - c[2]) <= d;
function census(px, Q) {
    let red = 0, amber = 0, blue = 0;
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 128) continue;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (isRed(r, g, b)) red++;
        if (near(r, g, b, Q.amber, 8)) amber++;
        if (near(r, g, b, Q.blue, 8)) blue++;
    }
    return { red, amber, blue };
}
const nullLog = () => { const lines = []; return { lines, info: (s) => lines.push(s), warn: (s) => lines.push(s), error: (s) => lines.push('E ' + s) }; };

/** A recording stand-in for cluster_render_client's ClusterRender. */
function FakeCR() { this.layers = []; this.msgs = []; this.on = () => this; this.connect = () => {}; this.close = () => { this.closed = true; }; }
FakeCR.prototype._add = function (kind, o) { this.layers.push({ kind, o: Object.assign({}, o) }); return this.layers.length; };
FakeCR.prototype.effect = function (o) { return this._add('effect', o); };
FakeCR.prototype.image = function (o) { return this._add('image', o); };
FakeCR.prototype.set = function (ref, o) { Object.assign(this.layers[ref - 1].o, o); this.msgs.push({ op: 'set', ref, o }); };
FakeCR.prototype.uniform = function (ref, name, v) { this.msgs.push({ op: 'uniform', ref, name, v: v.slice(), bytes: v.join(' ').length + name.length + 30 }); };
FakeCR.prototype.pixels = function (ref, rects, px) { this.msgs.push({ op: 'pixels', ref, bytes: px.length }); };

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
    ok(app.id === 'auto_beam' && app.loggingId === 'OABM' && app.version === '0.1.0' && app.title === 'Auto Beam', 'auto_beam 0.1.0, logging id OABM, title Auto Beam');
    const others = fs.readdirSync(path.join(ROOT, 'apps')).filter((a) => a !== 'auto_beam').map((a) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', a, 'app.json'), 'utf8')); } catch (e) { return null; } }).filter(Boolean);
    ok(others.length >= 4 && others.every((a) => a.loggingId !== 'OABM' && a.id !== 'auto_beam'), 'the id and the logging id are unique among the apps');
    const flags = [], members = [];
    let methods = 0, broadcasts = [];
    Object.keys(app.signals).forEach((i) => Object.keys(app.signals[i]).forEach((f) => {
        if (f[0] !== '_') { flags.push(app.signals[i][f]); members.push(i + '.' + f); } else if (f === '_methods') methods++;
        else if (f === '_broadcasts') broadcasts = broadcasts.concat(app.signals[i][f]);
    }));
    ok(flags.length === 10 && flags.every((x) => x === 's' || x === 'rs'), 'ten fields, read-only flags only (s / rs): no w anywhere (' + flags.join(',') + ')');
    ok(methods === 0, 'no method declared');
    ok(broadcasts.length === 22 && broadcasts.filter((b) => /ainBeamAssistantDataObject\d+$/.test(b)).length === 15 && broadcasts.indexOf('controlHighBeamAssistant') >= 0 && ['objectlistTCP', 'ObjectRecognition', 'ObjectPosition', 'TrafficSignRecognitionFrontCamera', 'yawRate', 'TrafficSignRecognition'].every((b) => broadcasts.indexOf(b) >= 0), 'the 15 light events, the verdict, the two fallback object lists, the camera\'s signs, the yaw rate and the limit as broadcasts (22)');
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
    // per profile / global cover every setting
    const per = /perProfile: \[([^\]]*)\]/.exec(mainSrc), glo = /global: \[([^\]]*)\]/.exec(mainSrc);
    const keys = (m) => (m ? m[1].replace(/['\s]/g, '').split(',') : []);
    ok(per && glo && app.settings.every((s) => keys(per).concat(keys(glo)).indexOf(s.key) >= 0) && keys(per).indexOf('sens') >= 0, 'the profile table covers every setting; the sensitivity follows the driver profile');

    // ---- the words
    const T = {};
    ['uk', 'en'].forEach((l) => { T[l] = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'i18n', l + '.json'), 'utf8')); });
    const ak = Object.keys(T.uk).filter((k) => /^(beam|auto_beam)\./.test(k));
    ok(ak.length >= 100 && ak.every((k) => typeof T.en[k] === 'string' && T.en[k] && T.uk[k]), 'every beam.* / auto_beam.* word in both tables (' + ak.length + ')');
    ok(Wd.KEYS.every((k) => T.uk[k] && T.en[k]), 'every key the app draws is in both tables');
    ok(ak.every((k) => !CYR.test(T.en[k])), 'no Cyrillic in the English words');
    const I = require(path.join(ROOT, 'shared', 'lang.js'));
    const specKeys = I.specKeys(Object.assign({}, app, { id: 'auto_beam' })).map((k) => k[0]).filter((k) => !/^kit\./.test(k));
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

    // ---- every state, day and night, uk and en: colours, words in their boxes
    const pages = {};
    V.DEMO.forEach((d) => ['day', 'night'].forEach((light) => ['uk', 'en'].forEach((lang) => {
        const v = d[2], night = light === 'night', tag = d[0] + ' ' + light + ' ' + lang;
        const Qc = V.colours('centre', night), Qm = V.colours('map', night);
        const pg = P.centre(v, { night, lang });
        const c1 = census(pg.px, Qc), sheet = P.textSheet(v, night, lang), c2 = census(sheet, Qm);
        const blueOk = v.adv === 'high' && v.go && v.data === 'ok';
        ok(c1.red === 0 && c2.red === 0, tag + ': no red');
        ok((c1.amber > 0) === v.disagree && (c2.amber > 0) === v.disagree, tag + ': amber only in the disagreement (' + c1.amber + ' / ' + c2.amber + ')');
        ok((c1.blue > 0) === blueOk && (c2.blue > 0) === blueOk, tag + ': blue only while high is advised (' + c1.blue + ' / ' + c2.blue + ')');
        const out = pg.words.filter((w) => w.x < w.x0 - 1 || w.x + w.w > w.x1 + 1);
        ok(!out.length, tag + ': every word of the page inside its box' + (out.length ? ': ' + out.map((w) => w.key + ' "' + w.str + '"').join(', ') : ''));
        const mw = P.textSheetWords(v, lang).filter((w) => w.w > w.x1 - w.x0 + 1 || w.cut);
        ok(!mw.length, tag + ': the map sheet\'s words fit, none cut' + (mw.length ? ': ' + mw.map((w) => w.key + ' "' + w.str + '"').join(', ') : ''));
        ok((lang === 'uk') === CYR.test(pg.words.map((w) => w.str).join(' ')), tag + ': the page\'s words in ' + lang);
        pages[tag] = pg;
    })));
    // the night look: dim, small and slow (the mean brightness of the night pictures; the cluster's sheet is mostly see-through)
    const lumC = V.DEMO.map((d) => R.meanLuma(pages[d[0] + ' night uk'].px)), lumD = V.DEMO.map((d) => R.meanLuma(pages[d[0] + ' day uk'].px));
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    console.log('night look: the centre page\'s mean brightness ' + mean(lumC).toFixed(1) + ' (max ' + Math.max.apply(null, lumC).toFixed(1) + ') of 255; day ' + mean(lumD).toFixed(1));
    ok(mean(lumC) < mean(lumD) && Math.max.apply(null, lumC) < 30, 'the night page is darker than the day page and its mean stays under 30 of 255');
    const sheetsN = V.DEMO.map((d) => { const px = P.textSheet(d[2], true, 'uk'); let s2 = 0; for (let i = 0; i < px.length; i += 4) s2 += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) * px[i + 3] / 255; return s2 / (px.length / 4); });
    console.log('night look: the map\'s text sheet mean ' + mean(sheetsN).toFixed(1) + ' (max ' + Math.max.apply(null, sheetsN).toFixed(1) + ')');
    ok(Math.max.apply(null, sheetsN) < 25, 'the map\'s night text sheet: no large bright area (mean < 25)');
    // the software scene equals the shader's field (the same maths): sample points
    const g = V.GEO.centre, Pz = V.colours('centre', false);
    const f1 = P.field(g, 360, 200, 1, 0, Pz), f0 = P.field(g, 360, 200, 0, 0, Pz);
    ok(f1 && f0 && f1[3] >= f0[3] && P.field(g, 360, 2, 1, 0, Pz) === null, 'the scene\'s field: the sky above the horizon is empty; the high beam adds light');

    // ---- the GPU page
    const cv = new Rec.Recorder(1600, 520);
    const ids = { band: 0x41420002, table: 0x41420003 };
    Rec.setImage(ids.band, P.BAND_W, P.BAND_H, Buffer.alloc(P.BAND_W * P.BAND_H * 4)); Rec.setImage(ids.table, 800, P.PAGE_H, Buffer.alloc(800 * P.PAGE_H * 4));
    let quads = 0, maxWords = 0, imagesOk = true;
    V.DEMO.forEach((d) => ['day', 'night'].forEach((light) => {
        cv.reset();
        GP.draw(cv, d[2], { night: light === 'night', lang: 'uk', e: V.extentOf(d[2]) }, ids);
        const w = cv.words();
        maxWords = Math.max(maxWords, w.length);
        for (let i = 0; i < w.length; i++) if (w[i] === 15) { /* a QUAD op code at an op position is checked by the play below */ }
        const ops = [];
        try { Rec.play(w, { image() { ops.push('image'); }, quad() { quads++; }, tris() {}, line() {}, arc() {}, clear() {}, clip() {}, noclip() {}, roundRect() {}, fillRect() {}, glyphs() {}, text() {} }); } catch (e) { /* the play's own stand-in */ }
        if (!(cv.images.has(ids.band) && cv.images.has(ids.table))) imagesOk = false;
    }));
    ok(quads === 0, 'the GPU page: no QUAD op in any of the 38 frames');
    ok(imagesOk, 'the band and the table go as images');
    ok(maxWords > 0 && maxWords <= 16000, 'a frame is at most 16 000 words (' + maxWords + ')');
    const rec = (v, e) => { cv.reset(); GP.draw(cv, v, { night: true, lang: 'uk', e }, ids); return Array.from(cv.words()); };
    const wA = rec(st('05'), 1), wB = rec(st('05'), 1), wC = rec(st('05'), 0.5);
    ok(JSON.stringify(wA) === JSON.stringify(wB), 'the same state: the same frame word for word (main.js sends nothing: none while still)');
    ok(JSON.stringify(wA) !== JSON.stringify(wC), 'the beam folding: a new frame (frames while moving)');
    const recSrc = fs.readFileSync(path.join(APPDIR, 'gpu.js'), 'utf8');
    ok(!/\.quad\(/.test(stripComments(recSrc)) && /case 15: i \+= 9/.test(fs.readFileSync(path.join(ROOT, 'kit', 'runtime', 'renderd.js'), 'utf8')), 'gpu.js never calls quad() (and kit/runtime/renderd.js knows case 15 anyway)');
    const mainNoFrame = /if \(same\) return undefined;/.test(mainSrc);
    ok(mainNoFrame, 'main.js sends no frame when nothing moved');

    // ---- the map target
    const cr = new FakeCR(), shaders = JSON.parse(fs.readFileSync(path.join(APPDIR, 'hud', 'shaders.json'), 'utf8'));
    const mv = new MapView({ ClusterRender: function () { return cr; } }, { layer: { target: 'map', contend: false, guideHold: 0 }, shaders });
    mv.open();
    ok(cr.layers.length === 3 && cr.layers.map((l) => l.kind).join() === 'effect,effect,image', 'the map: 3 layers (2 effects, 1 image), well under the 8 a connection allows');
    ok(cr.layers.every((l) => l.o.target === 'map' && l.o.contend === false && l.o.guide_hold === 0), 'every layer on map, no contend, guide_hold 0');
    ok(cr.layers.every((l) => l.o.x >= 334 && l.o.y >= 44 && l.o.x + l.o.w <= 754 && l.o.y + l.o.h <= 416), 'every layer inside the core x 334..754, y 44..416');
    ok(cr.layers[0].o.fs === shaders.ab_road && cr.layers[1].o.fs === shaders.ab_lights, 'the shipped shaders');
    ok(MapView.PIXEL_MEMORY === 420 * 112 * 8 && MapView.PIXEL_MEMORY < 16 * 1048576 * 0.05, 'pixel memory ' + MapView.PIXEL_MEMORY + ' B (one image counted twice), 2 % of the 16 MiB');
    let b0 = mv.update(st('05'), 1, true, 'uk');
    ok(b0 > 0, 'the first picture: the text sheet uploaded (' + b0 + ' B)');
    const n1 = cr.msgs.length;
    let px = 0;
    for (let i = 1; i <= 9; i++) px += mv.update(st('05'), 1 - i / 9, true, 'uk');
    const m2 = cr.msgs.slice(n1);
    ok(px === 0 && m2.every((m) => m.op === 'uniform' && m.name === 'u_beam') && m2.length === 9, 'the beam folding: 9 uniform messages, 0 B of pixels');
    const n2 = cr.msgs.length;
    const moving = Object.assign({}, st('07'), { lights: [{ id: 1, kind: 'head', x: 200, y: 3.5, ringed: true }] });
    mv.update(moving, 0, true, 'uk');
    const n3 = cr.msgs.length;
    px = 0;
    for (let i = 1; i <= 8; i++) px += mv.update(Object.assign({}, moving, { lights: [{ id: 1, kind: 'head', x: 200 - i * 15, y: 3.5, ringed: true }] }), 0, true, 'uk');
    ok(px === 0 && cr.msgs.slice(n3).every((m) => m.op === 'uniform') && cr.msgs.slice(n3).every((m) => (m.bytes || 0) < 800), 'a light moving: uniform messages only (< 800 B each), 0 B of pixels');
    void n2;
    const n4 = cr.msgs.length;
    mv.update(st('17'), 1, true, 'uk');
    const sets = cr.msgs.slice(n4).filter((m) => m.op === 'set');
    ok(sets.length === 3 && sets.every((m) => m.o.visible === false), 'the car\'s own message: every layer hidden (our picture yields)');
    mv.update(st('05'), 1, true, 'uk');
    ok(cr.layers.every((l) => l.o.visible === true), 'the message gone: the layers back');
    const n5 = cr.msgs.length;
    mv.update(st('12'), 0, true, 'uk');
    ok(cr.msgs.slice(n5).some((m) => m.op === 'pixels' && m.bytes > 0), 'an advice change: the text sheet\'s changed rectangle');
    mv.close(); ok(cr.closed, 'off: the connection closed');
    const lu = MapView.lightUniforms(Object.assign({}, st('09'), { lights: Array.apply(null, Array(20)).map((x, i) => ({ id: i, kind: 'street', x: 20 + i * 10, y: 7 })) }), true);
    ok(lu.u_li.length === 60 && lu.u_lp.length === 60 && lu.u_li.filter((x, i) => i % 4 === 3 && x > 0).length === 15, 'at most 15 lights (60 numbers per array), the nearest kept');

    // ---- the shaders
    const SH = path.join(APPDIR, 'shaders');
    ['ab_road', 'ab_lights'].forEach((n) => {
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
    ok(Buffer.byteLength(shaders.ab_road) + Buffer.byteLength(shaders.ab_lights) < 8000, 'both shaders together under 8 KB');
}

/* ------------------------------------------------------------------------------------------------ part 2: the bench */
function request(method, url, body) {
    return new Promise((resolve) => {
        const data = body ? Buffer.from(JSON.stringify(body)) : null;
        const rq = http.request({ host: '127.0.0.1', port: PORT, path: url, method, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, (res) => {
            const parts = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts) }));
        });
        rq.on('error', () => resolve({ status: 0, body: Buffer.alloc(0) }));
        if (data) rq.write(data);
        rq.end();
    });
}
function stream() {
    const s = { scene: null, px: [], close: () => {} };
    let buf = '';
    const rq = http.get({ host: '127.0.0.1', port: PORT, path: '/events' }, (res) => {
        res.on('data', (c) => {
            buf += c.toString('utf8');
            const lines = buf.split('\n');
            buf = lines.pop();
            lines.forEach((ln) => {
                const t = ln.replace(/^data:\s*/, '').trim();
                if (!t || t[0] !== '{') return;
                try { const m = JSON.parse(t); if (m.t === 'scene') s.scene = m.layers || []; else if (m.t === 'px') s.px.push(m); } catch (e) { /* not this one */ }
            });
        });
    });
    rq.on('error', () => {});
    s.close = () => { try { rq.abort(); } catch (e) { /* gone */ } };
    return s;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIGHT_IF = 'de.bmw.sensors.objects.RecogFrontCameraLightDetection';

async function part2() {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-beam-'));
    const dataDir = path.join(work, 'data'), imgDir = path.join(work, 'img');
    fs.mkdirSync(dataDir); fs.mkdirSync(imgDir);
    let out = '';
    const env = Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, BENCH_IMAGE_DIR: imgDir, BENCH_LAYER_CAP: '8', BENCH_CONFIG: JSON.stringify({ demoMs: 600000, night: 'night' }) });
    const srv = spawn(process.execPath, [path.join(ROOT, 'bench', 'server.js'), 'auto_beam'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', (c) => { out += c; });
    srv.stderr.on('data', (c) => { out += c; });
    const waitFor = async (re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(out)) return true; await sleep(100); } return false; };
    const feed = (iface, field, value) => request('POST', '/fake', { feed: { iface, field, value } });
    const objEv = (n, o) => { const v = {}; ['XPosition', 'YPosition', 'Width', 'Height', 'AngularSpeedLeft', 'AngularSpeedRight', 'Class', 'Id', 'Distance', 'Status'].forEach((k) => { v[k + 'Object' + n] = o[k]; }); return v; };
    const none = { XPosition: 255, YPosition: 255, Width: 255, Height: 63, AngularSpeedLeft: 255, AngularSpeedRight: 255, Class: 15, Id: 15, Distance: 127, Status: 7 };
    const evName = (n) => (n === 11 || n === 12 || n === 15 ? 'M' : 'm') + 'ainBeamAssistantDataObject' + n;
    let es = null;
    try {
        ok(await waitFor(/beam: Auto Beam 0\.1\.0 started \(advisor: the actuator is null, it switches nothing\)/, 90000), 'the app built by the kit and started: the advisor, the null actuator');
        ok(/auto_beam 0\.1\.0: dist\/auto_beam@0\.1\.0/.test(out), 'the kit built auto_beam 0.1.0');
        ok(/beam: algorithm (STAND-IN )?shared\/beam_logic\.js contract 1/.test(out), 'the log names the algorithm and its contract version 1');
        ok(await waitFor(/beam: watch SignRecognitionFrontCamera ok/, 8000) && ['RecogFrontCameraLightDetection', 'RecogFrontCameraObjectlist', 'ObjectRecognitionFrontCamera', 'Light', 'Vehicle2'].every((i) => new RegExp('beam: watch ' + i + ' ok').test(out)), 'subscribed at start (read only): the lights, both object lists, the signs, the lamps');
        es = stream();
        await sleep(800);
        const mine = (ls) => (ls || []).filter((l) => l.app === 'auto_beam');
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
        ok(await waitFor(/beam: map layers 3 \(road, lights, text 420x112\) on map \(waits for the slot\), pixel memory 376320/, 8000), 'show on: 3 layers asked for, waiting for the slot');
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
        ok(ls.length === 3 && ls.map((l) => l.kind).join() === 'effect,effect,image', 'the scene: 3 layers on map (' + ls.map((l) => l.kind).join() + ')');
        const road = ls.filter((l) => l.z === 0)[0] || {};
        ok(road.uniforms && road.uniforms.u_beam && road.uniforms.u_beam.v[0] === 1, 'the road layer: the high beam out (u_beam.x 1)');
        // an oncoming car at 240 m (raw distance 60, the module's assumed 4 m a step): dip at once; the lamps still high -> amber
        const onc = { XPosition: 126, YPosition: 127, Width: 3, Height: 2, AngularSpeedLeft: 127, AngularSpeedRight: 127, Class: 1, Id: 4, Distance: 60, Status: 2 };
        await feedLights([onc], 1200);
        ok(/beam: state DIPPED oncoming want low lamps high/.test(out), 'an oncoming car in the zone: DIPPED oncoming, want low (the lamps still high)');
        ok(/beam: actuator \(null\) would switch to low \(oncoming\); nothing sent/.test(out), 'the null actuator: "would switch to low"; nothing sent');
        const sceneUntil = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn(mine(es.scene))) return true; await sleep(100); } return false; };
        await sceneUntil((x) => { const li = (x.filter((l) => l.z === 1)[0] || {}).uniforms; return li && li.u_li && li.u_li.v[3] === 11; }, 2500);
        ls = mine(es.scene);
        const lightsL = ls.filter((l) => l.z === 1)[0] || {}, roadL = ls.filter((l) => l.z === 0)[0] || {};
        ok(lightsL.uniforms && lightsL.uniforms.u_li && lightsL.uniforms.u_li.v[3] === 11, 'the cluster: the oncoming car drawn and ringed (class 1 + 10)');
        ok(roadL.uniforms && roadL.uniforms.u_beam && roadL.uniforms.u_beam.v[0] === 0, 'the high beam folded (u_beam.x 0)');
        const textL = ls.filter((l) => l.z === 2)[0];
        if (textL) {
            const pxs = (await request('GET', '/px?key=' + encodeURIComponent(textL.key) + '&x=0&y=0&w=' + textL.w + '&h=' + textL.h)).body;
            const Q = V.colours('map', true);
            let amber = 0;
            for (let i = 0; i < pxs.length; i += 4) if (pxs[i + 3] > 200 && near(pxs[i], pxs[i + 1], pxs[i + 2], Q.amber, 8)) amber++;
            ok(amber > 40, 'the text sheet read back: the lamps line amber (dip advised, the high beam lit; ' + amber + ' px)');
        } else ok(false, 'the text layer');
        // the driver dips: no disagreement
        await feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusLightStatus', { statusMainBeam_headlightFlasher: 'AUS', statusDippedBeam: 'EIN', statusFrontFogLight: 'AUS', statusRearFogLight: 'AUS', statusLightStatusError: 'LAMPENZUSTANDS_MINUS_SIGNALE_SIND_IN_ORDNUNG' });
        await feedLights([onc], 800);
        ok(/beam: state DIPPED oncoming want low lamps low/.test(out), 'the driver dipped: want low, lamps low');
        // the stalk
        await feed('de.bmw.body.Light', 'IndicatorSteeringColumn', { operationColumnStalks: 0x20 });
        await feed('de.bmw.body.Light', 'IndicatorSteeringColumn', { operationColumnStalks: 0 });
        ok(await waitFor(/beam: stalk bits 0x0 -> 0x20/, 2000), 'the stalk\'s bits logged as they change');
        // the car's own message: our picture yields
        await feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusDisplayedCCMessage', { statusNumberCheckControlMessageDisplay: 15 });
        await feedLights([onc], 600);
        ls = mine(es.scene);
        ok(ls.length === 3 && ls.every((l) => l.visible === 0), 'the car shows a message: every layer of ours hidden');
        await feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusDisplayedCCMessage', { statusNumberCheckControlMessageDisplay: 0 });
        await feedLights([onc], 600);
        ok(mine(es.scene).every((l) => l.visible === 1), 'the message gone: our layers back');
        // the light stream goes silent: the fallback object list takes over
        const TCP = 'de.bmw.sensors.objects.RecogFrontCameraObjectlist';
        const tcp = (x) => ({ eventDataQualifier: 'KEVENTDATAQUALIFIER_EVENTDATAAVAILABLE', numberOfObjects: 1, objectListSmall: [{ summary: { id: 51 }, position: { x: { value: x }, y: { value: 3.5 } }, dynamics: { velocity_absolute: { x: { value: -24 } } }, classification: { class_car: 90 }, lights: { status_head_light: 'KHEADLIGHTSTATUS_ON', status_rear_light: 'KREARLIGHTSTATUS_UNKNOWN' } }] });
        const t1 = Date.now();
        while (Date.now() - t1 < 1500) { await feed(TCP, 'objectlistTCP', tcp(120)); await feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusCarSpeed2', { speedVehicleCentreOfGravity: Math.round(86 / 0.015625) }); await sleep(80); }
        ok(/beam: source light -> object/.test(out), 'the light stream silent: the source switches to the camera\'s object list');
        const after = out.split('beam: source light -> object').pop(), before = out.split('beam: source light -> object')[0];
        ok(/beam: state DIPPED oncoming[^\n]*\n?[^]*$/.test(before.split('beam: state').pop().replace(/^/, 'beam: state')) && !/beam: state HIGH/.test(after.split('beam: town sign')[0]), 'the fallback: the oncoming car (head lamps on) keeps the dip, never high in between');
        const objL = ((mine(es.scene).filter((l) => l.z === 1)[0] || {}).uniforms || {}).u_li;
        ok(objL && objL.v[3] === 11, 'the fallback object drawn as an oncoming light and ringed on the cluster');
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
        ok(!/beam: (tick|apply|page|layer|target|setting|layout|start|light \d+|verdict|lowbeam|lamps|lightstatus|stalk|bright|rain|speed|message|daynight|yaw|limit|signs|objectlist|cam rec|cam pos|profile|lang):\s/.test(out.replace(/beam: layer \d+ shown/g, '').replace(/beam: target map \w+/g, '')), 'no error from the app\'s guards');
        ok(!/\b\w*Error:|uncaught|unhandled/i.test(out.split('\n').filter((l) => /\[auto_beam\]/.test(l)).join('\n')), 'no exception in the app\'s log');
        ok((out.match(/would switch to/g) || []).length <= 8, 'the actuator\'s lines stay few (one per change)');
        await request('POST', '/setting', { key: 'show', value: false });
        ok(await waitFor(/beam: map layers dropped/, 5000), 'off again: the layers dropped');
    } finally {
        if (es) es.close();
        srv.kill('SIGTERM');
        await sleep(300);
        if (fail) console.log('--- bench log (tail) ---\n' + out.split('\n').filter((l) => !/fake persod/.test(l)).slice(-(Number(process.env.BEAM_LOG_LINES) || 50)).join('\n'));
        try { require('child_process').execFileSync('rm', ['-rf', work]); } catch (e) { /* left behind */ }
    }
}

/* ------------------------------------------------------------------------------------------------ part 3: WebGL */
function part3() {
    if (!fs.existsSync(CHROME)) { console.log('part 3: skipped (no Chrome)'); return; }
    const sj = JSON.parse(fs.readFileSync(path.join(APPDIR, 'hud', 'shaders.json'), 'utf8'));
    const v = Object.assign({}, V.DEMO[6][2]);
    const U = { ab_road: MapView.roadUniforms(v, 1, true), ab_lights: MapView.lightUniforms(v, true) };
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'beam-gl-'));
    const html = '<!doctype html><meta charset="utf-8"><body><pre id="o">running</pre><script>\n' +
        'const SH = ' + JSON.stringify(sj) + ';\nconst U = ' + JSON.stringify(U) + ';\n' +
        'const VS = "attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5); gl_Position = vec4(a_pos, 0.0, 1.0); }";\n' +
        'const out = []; const c = document.createElement("canvas"); c.width = 420; c.height = 260; const gl = c.getContext("webgl");\n' +
        'out.push("webgl " + (gl ? gl.getParameter(gl.SHADING_LANGUAGE_VERSION) : "none"));\n' +
        'for (const n of Object.keys(SH)) { const mk = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };\n' +
        ' const v = mk(gl.VERTEX_SHADER, VS), f = mk(gl.FRAGMENT_SHADER, SH[n]); const okc = gl.getShaderParameter(f, gl.COMPILE_STATUS);\n' +
        ' const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p); const okl = gl.getProgramParameter(p, gl.LINK_STATUS);\n' +
        ' let lit = 0; if (okc && okl) { gl.useProgram(p); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);\n' +
        '  const l = gl.getAttribLocation(p, "a_pos"); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);\n' +
        '  for (const k of Object.keys(U[n])) { const a = U[n][k]; const u = gl.getUniformLocation(p, k) || gl.getUniformLocation(p, k + "[0]"); if (u) gl["uniform" + (a.length > 4 ? 4 : a.length) + "fv"](u, new Float32Array(a)); }\n' +
        '  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); const px = new Uint8Array(420 * 260 * 4); gl.readPixels(0, 0, 420, 260, gl.RGBA, gl.UNSIGNED_BYTE, px); for (let i = 3; i < px.length; i += 4) if (px[i] > 128) lit++; }\n' +
        ' out.push(n + " compile " + okc + " link " + okl + " lit " + lit + " log " + JSON.stringify(gl.getShaderInfoLog(f) || "")); }\n' +
        'document.getElementById("o").textContent = out.join("\\n");\n</script>';
    const file = path.join(work, 'gl.html');
    fs.writeFileSync(file, html);
    const r = spawnSync(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--virtual-time-budget=5000', '--dump-dom', 'file://' + file], { encoding: 'utf8', timeout: 60000 });
    const dom = (r.stdout || '').replace(/&quot;/g, '"');
    console.log('webgl: ' + ((dom.match(/<pre id="o">([\s\S]*?)<\/pre>/) || [])[1] || 'no output').replace(/\n/g, ' | '));
    ok(/webgl WebGL GLSL ES 1\.0/.test(dom), 'headless Chrome has WebGL 1 (GLSL ES 1.00)');
    ['ab_road', 'ab_lights'].forEach((n) => {
        const m = new RegExp(n + ' compile (\\w+) link (\\w+) lit (\\d+)').exec(dom);
        ok(m && m[1] === 'true' && m[2] === 'true', n + ': compiles and links as GLSL ES 1.00 in WebGL');
        ok(m && Number(m[3]) > 20, n + ': draws (' + (m ? m[3] : 0) + ' opaque px)');
    });
    try { require('child_process').execFileSync('rm', ['-rf', work]); } catch (e) { /* left behind */ }
}

/* ------------------------------------------------------------------------------------------------ part 4: the emulator */
async function part4() {
    const ER = require(path.join(ROOT, 'tools', 'shots', 'beam', 'emu_run.js'));
    const port = PORT + 6 <= 8939 ? PORT + 6 : 8938;
    const moving = await ER.run({ port, seconds: 45, demoMs: 500, noChrome: true });
    const rates = (moving.match(/beam: gpu page (\d+) frames\/s/g) || []).map((l) => Number(/(\d+) frames/.exec(l)[1]));
    const rss = (moving.match(/rss (\d+) MB/g) || []).map((l) => Number(/(\d+)/.exec(l)[1]));
    console.log('emulator, demo: ' + rates.join(', ') + ' frames/s; rss ' + rss.join(', ') + ' MB');
    ok(/renderd: connected, screen 1920x720, mgu-render\/1/.test(moving), 'the emulator: the app on the GPU renderer (mgu-render/1)');
    ok(rates.length >= 3 && Math.max.apply(null, rates) >= 15 && Math.max.apply(null, rates) <= 31, 'the scenes moving: up to 30 frames a second (' + rates.join(', ') + ')');
    ok(rss.length >= 3 && Math.max.apply(null, rss.slice(1)) - Math.min.apply(null, rss.slice(1)) < 40, 'no growth in memory (' + rss.join(', ') + ' MB)');
    const still = await ER.run({ port, seconds: 25, demoMs: 500, noChrome: true, still: true });
    const sr = (still.match(/display: (\d+) fps sent/g) || []).map((l) => Number(/(\d+)/.exec(l)[1]));
    console.log('emulator, nothing moving: ' + sr.join(', ') + ' fps sent');
    const gr = (still.match(/beam: gpu page (\d+) frames\/s/g) || []).map((l) => Number(/(\d+) frames/.exec(l)[1]));
    console.log('emulator, nothing moving: the page ' + gr.join(', ') + ' frames/s');
    ok(sr.every((x) => x <= 1) && gr.slice(1).every((x) => x <= 1), 'nothing moving: no frames (' + gr.join(', ') + ')');
    ok(!/beam: (tick|apply|page|layout|start):\s/.test(moving + still), 'no error from the app\'s guards in the emulator');
}

if (require.main === module) (async () => {
    part1();
    console.log('part 1 (pure): ' + pass + ' passed, ' + fail + ' failed');
    if (args.indexOf('--no-gl') < 0) { const p0 = pass, f0 = fail; part3(); console.log('part 3 (WebGL): ' + (pass - p0) + ' passed, ' + (fail - f0) + ' failed'); }
    if (args.indexOf('--no-emu') < 0 && args.indexOf('--no-bench') < 0) { const p0 = pass, f0 = fail; await part4(); console.log('part 4 (emulator): ' + (pass - p0) + ' passed, ' + (fail - f0) + ' failed'); }
    if (args.indexOf('--no-bench') < 0) { const p0 = pass, f0 = fail; await part2(); console.log('part 2 (bench, port ' + PORT + '): ' + (pass - p0) + ' passed, ' + (fail - f0) + ' failed'); }
    console.log(pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})();
