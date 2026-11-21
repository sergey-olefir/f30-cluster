'use strict';
/**
 * test-cam-check-car.js - fix-1121 CS: Camera Check 0.1.0, 0.1.1 and 0.1.2, and a theme-like subscriber (kit/car.js with an
 * `extra` map on the speed-limit event, as shared/hud.js + shared/limit_src.js wire it), each run with the REAL kit
 * signals.js / car.js against bench/fake-someip.js, a stand-in for the car's native SOME/IP binding (the bench's hu-stub
 * skips signals.js and calls the handlers itself, so it can not show how an app subscribes).
 *
 * Six car states (fake-someip.js): parked, asleep, deaf (this app's access refused, a theme still served), driving, late
 * (providers up 6 s after the start) and flap (the limit's provider goes and comes back). What it proves:
 *   - the subscription itself: every version, and the theme, receives the speed-limit event when the car sends it (driving,
 *     late, flap): Camera Check's way of subscribing is not what kept it silent;
 *   - the photo («сервіс є, мовчить» on every row, the limit row too) is what 0.1.1 shows when the car sends nothing and
 *     answers no getter (asleep), or when the app is refused (deaf, while the theme receives) - and 0.1.0 / 0.1.1 show the
 *     SAME screen in those states, so their photo can not tell them apart; parked differs only on one row (the lamps' getter);
 *   - 0.1.2 tells every state apart on the screen and in the log: the clock, the speed, events («подія») vs fields
 *     («поле»), the getters' answers, the providers' ups and downs, the control row and the verdict.
 *
 *   node bench/test-cam-check-car.js            (no port; about 15 s, the runs go in parallel)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUN_MS = Number(process.env.CK_RUN_MS || 13000);

// ---------------------------------------------------------------- the child: one app, one car state ----------------------
if (process.argv[2] === '--child') {
    const dir = process.argv[3], scenario = process.argv[4], app = process.argv[5];
    const fake = require('./fake-someip').createCar(scenario, { app });
    global.__fakeSomeip = fake.binding;
    const texts = {}, lines = [], T0 = Date.now();
    const rec = (lvl) => function () { lines.push(((Date.now() - T0) / 1000).toFixed(1) + ' ' + lvl + ' ' + Array.prototype.map.call(arguments, (x) => (x && x.stack) || String(x)).join(' ')); };
    const log = { info: rec('INFO'), warn: rec('WARN'), error: rec('ERROR'), debug: () => {} };
    process.on('uncaughtException', (e) => { lines.push('UNCAUGHT ' + (e && e.stack || e)); });
    process.on('unhandledRejection', (e) => { lines.push('UNHANDLED ' + (e && e.stack || e)); });
    const js = path.join(dir, 'source', 'javascript');
    const spec = JSON.parse(fs.readFileSync(path.join(js, 'app-spec.json'), 'utf8'));
    const signals = require(path.join(js, 'kit', 'signals.js'));
    global.__ckRun = (impl) => {
        const ctx = { log, spec, dataDir: dir, signals, settings: { get: () => undefined },
            ui: { text: (n, s) => { texts[n] = s; return Promise.resolve(); }, onVisible: () => {} } };
        impl.start(ctx);
    };
    fake.start();
    require(path.join(js, 'app.js'));
    setTimeout(() => {
        process.stdout.write(JSON.stringify({ texts, log: lines, stats: fake.stats, native: signals.hasNative() }));
        process.exit(0);
    }, RUN_MS);
    return;
}

// ---------------------------------------------------------------- the parent ----------------------------------------------
let pass = 0, fail = 0;
const ok = (c, what) => { if (c) pass++; else fail++; console.log((c ? '  ok   ' : '  FAIL ') + what); };

/** A theme's path to the speed-limit event: kit/car.js with `extra` (shared/hud.js _setupVehicleData + limit_src.wire). */
const THEME_MAIN = [
    "'use strict';",
    "const mgu = require('./kit/mgu');",
    "const Car = require('./kit/car');",
    'mgu.run({ start(ctx) {',
    '    let n = 0;',
    "    const extra = { 'de.bmw.dass.TrafficSignRecognition': { TrafficSignRecognition: (v) => { n++; if (n === 1) ctx.log.info('limit: tsr class ' + v.presentClassLimitSpeed); } } };",
    "    new Car(ctx, ['speed', 'rpm', 'condition'], extra);",
    "    setInterval(() => ctx.ui.text('TSR', String(n)), 250);",
    '} });'
].join('\n');

function git(rev, file) { return execFileSync('git', ['-C', ROOT, 'show', rev + ':' + file], { encoding: 'utf8' }); }

function stage(base, name, mainJs, specJson) {
    const dir = path.join(base, name), js = path.join(dir, 'source', 'javascript'), kit = path.join(js, 'kit');
    [path.join(dir, 'someipInterfaces'), kit, path.join(js, 'node_modules', 'someip')].forEach((d) => fs.mkdirSync(d, { recursive: true }));
    const cfgs = require('./fake-someip').createCar('parked').configs();
    Object.keys(cfgs).forEach((i) => fs.writeFileSync(path.join(dir, 'someipInterfaces', i.replace(/\./g, '_') + '.json'), JSON.stringify(cfgs[i])));
    ['signals.js', 'car.js', 'sim.js'].forEach((f) => fs.copyFileSync(path.join(ROOT, 'kit', 'runtime', f), path.join(kit, f)));
    fs.writeFileSync(path.join(kit, 'mgu.js'), 'module.exports = { run: (impl) => global.__ckRun(impl) };\n');
    fs.writeFileSync(path.join(js, 'node_modules', 'someip', 'index.js'), 'module.exports = global.__fakeSomeip;\n');
    fs.writeFileSync(path.join(js, 'app.js'), mainJs);
    fs.writeFileSync(path.join(js, 'app-spec.json'), specJson);
    return dir;
}

function runChild(dir, scenario, app) {
    return new Promise((res) => {
        const p = spawn(process.execPath, [__filename, '--child', dir, scenario, app], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        p.stdout.on('data', (c) => { out += c; }); p.stderr.on('data', (c) => { err += c; });
        p.on('close', () => { try { res(JSON.parse(out)); } catch (e) { res({ texts: {}, log: ['CHILD FAILED ' + err.slice(0, 600)], stats: {} }); } });
    });
}

(async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-car-'));
    const appJson = fs.readFileSync(path.join(ROOT, 'apps', 'cam_check', 'app.json'), 'utf8');
    const versions = {
        '0.1.0': stage(base, 'v010', git('b349676', 'apps/cam_check/main.js'), git('b349676', 'apps/cam_check/app.json')),
        '0.1.1': stage(base, 'v011', git('dea455a', 'apps/cam_check/main.js'), git('dea455a', 'apps/cam_check/app.json')),
        '0.1.2': stage(base, 'v012', fs.readFileSync(path.join(ROOT, 'apps', 'cam_check', 'main.js'), 'utf8'), appJson),
        theme: stage(base, 'theme', THEME_MAIN, JSON.stringify({ id: 'theme', version: '0', config: {} }))
    };
    ok(JSON.parse(appJson).version === '0.1.2', 'apps/cam_check is 0.1.2');
    const scenarios = ['parked', 'asleep', 'deaf', 'driving', 'late', 'flap'];
    const jobs = [];
    scenarios.forEach((s) => Object.keys(versions).forEach((v) => jobs.push(runChild(versions[v], s, v === 'theme' ? 'theme' : 'cam_check').then((r) => ({ s, v, r })))));
    const R = {};
    (await Promise.all(jobs)).forEach((x) => { (R[x.s] = R[x.s] || {})[x.v] = x.r; });
    const T = (s, v, row) => (R[s][v].texts[row] || '');
    const L = (s, v) => R[s][v].log.join('\n');
    const CAM_ROWS = ['S_LIGHT', 'S_BEAMOBJ', 'S_BEAMCTL', 'S_OBJLIST', 'S_OBJREC', 'S_SIGNS', 'S_LIMIT', 'S_LANES', 'S_LAMPS', 'S_FAS'];
    const allRows = (s, v, re) => CAM_ROWS.every((r) => re.test(T(s, v, r)));
    const theme = (s) => Number(T(s, 'theme', 'TSR') || 0);

    // ---- every run: the real signals.js ran on the fake binding, no exception, nothing written to the car ----
    scenarios.forEach((s) => Object.keys(versions).forEach((v) => {
        const r = R[s][v], bad = /UNCAUGHT|UNHANDLED|CHILD FAILED/.test(L(s, v));
        if (!r.native || bad || r.stats.refused) ok(false, s + ' / ' + v + ': ' + (!r.native ? 'the fake binding was not used' : bad ? L(s, v).split('\n').filter((x) => /UNCAUGHT|UNHANDLED|CHILD/.test(x))[0] : 'a setter or method was called'));
    }));
    ok(true, 'all 24 runs used the real kit signals.js on the fake binding, threw nothing and called no setter or method');

    console.log('-- driving / late / flap: the subscription works in every version (the car sends, every app hears)');
    ['driving', 'late', 'flap'].forEach((s) => {
        ok(theme(s) > 5, s + ': the theme-like subscriber (kit/car.js + extra) receives the limit event: ' + theme(s) + ' messages');
        ok(/^Обмеження швидкості.*: (одне й те саме значення|ЗМІНЮЄТЬСЯ)/.test(T(s, '0.1.0', 'S_LIMIT')), s + ' / 0.1.0 hears the limit: ' + T(s, '0.1.0', 'S_LIMIT'));
        ok(/^Обмеження швидкості.*: (одне й те саме значення|ЗМІНЮЄТЬСЯ)/.test(T(s, '0.1.1', 'S_LIMIT')), s + ' / 0.1.1 hears the limit: ' + T(s, '0.1.1', 'S_LIMIT'));
        ok(/подія: ЗМІНЮЄТЬСЯ: 2 різних/.test(T(s, '0.1.2', 'S_LIMIT')), s + ' / 0.1.2 hears the limit: ' + T(s, '0.1.2', 'S_LIMIT'));
    });
    ok(/подія: тиша, хоча авто їде · сервіс є$/.test(T('driving', '0.1.2', 'S_LIGHT')), 'driving / 0.1.2: a camera event the car does not send is silence while moving, with its service there: ' + T('driving', '0.1.2', 'S_LIGHT'));
    ok(/ · \d+ км\/год \(макс \d+\) · FAHREN$/.test(T('driving', '0.1.2', 'HEAD')) && !/ 0 км\/год/.test(T('driving', '0.1.2', 'HEAD')), 'driving / 0.1.2: the top line shows the speed and the condition: ' + T('driving', '0.1.2', 'HEAD'));
    ok(/швидкість [1-9]\d*× \(г\. відповів\), оберти [1-9]\d*× \(г\. відповів\), стан авто 1×/.test(T('driving', '0.1.2', 'S_CTRL')), 'driving / 0.1.2: the control row counts speed, rpm and condition: ' + T('driving', '0.1.2', 'S_CTRL'));
    ok(/ck: first limit \(event\) at \+[\d.]+ s, \d+ km\/h: \{"presentClassLimitSpeed":10/.test(L('driving', '0.1.2')), 'driving / 0.1.2: the first limit message is in the log with the speed');
    ok(/ck: provider TrafficSignRecognition UP #1 at \+[6-7]\.\d s/.test(L('late', '0.1.2')) && /ck: getter Vehicle2\.statusCarSpeed2 #1 \(provider up\) answered/.test(L('late', '0.1.2')),
        'late / 0.1.2: the log says when the provider came up, and the getter is asked then');
    ok(/ck: provider TrafficSignRecognition DOWN #1 at \+5\.\d s/.test(L('flap', '0.1.2')) && /ck: provider TrafficSignRecognition UP #2 at \+7\.\d s/.test(L('flap', '0.1.2')),
        'flap / 0.1.2: the provider going away and coming back is logged with its count');
    ok(/сервіс є \(з'являвся 2×, зникав 1×\)$/.test(T('flap', '0.1.2', 'S_LIMIT')), 'flap / 0.1.2: the row shows how often the provider came and went: ' + T('flap', '0.1.2', 'S_LIMIT'));

    console.log('-- the photo: «сервіс є, мовчить» on every row');
    ok(allRows('asleep', '0.1.1', /: сервіс є, мовчить$/), 'asleep (the bus sends nothing, no getter answers) / 0.1.1: every row «сервіс є, мовчить» - the photo');
    ok(allRows('deaf', '0.1.1', /: сервіс є, мовчить$/) && theme('deaf') > 5, 'deaf (this app refused, the theme served: ' + theme('deaf') + ' limit messages) / 0.1.1: every row «сервіс є, мовчить» - the same photo');
    ok(allRows('asleep', '0.1.0', /: мовчить$/) && allRows('deaf', '0.1.0', /: мовчить$/), 'asleep and deaf / 0.1.0: every row «мовчить» - its photo');
    ok(CAM_ROWS.every((r) => T('asleep', '0.1.1', r) === T('deaf', '0.1.1', r)), '0.1.1 shows exactly the same screen for "the car sent nothing" and "the app hears nothing"');
    ok(/одне й те саме значення/.test(T('parked', '0.1.1', 'S_LAMPS')) && allRows('parked', '0.1.1', /: (сервіс є, мовчить|одне й те саме значення \(\d+×\), \d+ с тому)$/),
        'parked (getters answer) / 0.1.1: the lamps row has the getter\'s value, all others silent: ' + T('parked', '0.1.1', 'S_LAMPS'));

    console.log('-- 0.1.2 tells the states apart');
    ['asleep', 'deaf'].forEach((s) => {
        ok(/^НІЧОГО не чути, навіть контроль і геттери/.test(T(s, '0.1.2', 'FOOT')), s + ' / 0.1.2 verdict: ' + T(s, '0.1.2', 'FOOT'));
        ok(/швидкість 0× \(г\. НЕ ВІДПОВІВ — ЗБІЙ\), оберти 0× \(г\. НЕ ВІДПОВІВ — ЗБІЙ\)/.test(T(s, '0.1.2', 'S_CTRL')), s + ' / 0.1.2 control row: ' + T(s, '0.1.2', 'S_CTRL'));
        ok(/ \? км\/год /.test(T(s, '0.1.2', 'HEAD')), s + ' / 0.1.2 top line: no speed known: ' + T(s, '0.1.2', 'HEAD'));
        ok(/· подія: тиша \(не судити: контроль теж мовчить\) · сервіс є$/.test(T(s, '0.1.2', 'S_LIMIT')), s + ' / 0.1.2: an event\'s silence is not called normal while nothing is heard: ' + T(s, '0.1.2', 'S_LIMIT'));
        ok(/ck: getter Vehicle2\.statusCarSpeed2 #1 \(provider up\) NO ANSWER after \d+ ms: method call get:statusCarSpeed2\(\)/.test(L(s, '0.1.2')), s + ' / 0.1.2: the getter\'s error is in the log');
    });
    ok(/^Застосунок ЧУЄ авто\. Подій з даними: 0\./.test(T('parked', '0.1.2', 'FOOT')), 'parked / 0.1.2 verdict: the app hears the car, no event yet: ' + T('parked', '0.1.2', 'FOOT'));
    ok(/ · 0 км\/год \(макс 0\)$/.test(T('parked', '0.1.2', 'HEAD')), 'parked / 0.1.2 top line: standing, the speed from its getter: ' + T('parked', '0.1.2', 'HEAD'));
    ok(/швидкість \d+× \(г\. відповів\), оберти \d+× \(г\. відповів\), стан авто 0×/.test(T('parked', '0.1.2', 'S_CTRL')), 'parked / 0.1.2 control row: the getters answered: ' + T('parked', '0.1.2', 'S_CTRL'));
    ok(/^Обмеження швидкості .*· подія: тиша \(норма, поки нічого не сталось\) · сервіс є$/.test(T('parked', '0.1.2', 'S_LIMIT')), 'parked / 0.1.2: the limit event is silence, which is normal: ' + T('parked', '0.1.2', 'S_LIMIT'));
    ok(/· поле: одне значення \(\d+×\), \d+ с тому · геттер відповів$/.test(T('parked', '0.1.2', 'S_LAMPS')), 'parked / 0.1.2: the lamps field answered its getter: ' + T('parked', '0.1.2', 'S_LAMPS'));
    ok(/· поле: сповіщень 0 · геттер НЕ ВІДПОВІВ — ЗБІЙ$/.test(T('parked', '0.1.2', 'S_FAS')), 'parked / 0.1.2: a field whose getter never answers is a fault: ' + T('parked', '0.1.2', 'S_FAS'));
    ok(/^Лише читання · \d\d:\d\d:\d\d · працює 0:1\d · /.test(T('parked', '0.1.2', 'HEAD')), 'parked / 0.1.2: the app\'s own clock and running time tick: ' + T('parked', '0.1.2', 'HEAD'));
    ok(/ck: summary \+2\d\.\d s|ck: summary \+1\d\.\d s/.test(L('parked', '0.1.2')) || RUN_MS < 21000, 'the first summary comes at +20 s (after this run: not checked)');
    const verdicts = ['parked', 'asleep', 'driving'].map((s) => T(s, '0.1.2', 'FOOT'));
    ok(new Set(verdicts).size === 3, '0.1.2 has a different verdict for parked, asleep and driving');
    ok(/ck: watching 13 interfaces through kit\/car\.js \(the themes' path\), all at the start/.test(L('parked', '0.1.2')) && /signal TrafficSignRecognition subscribed/.test(L('parked', '0.1.2')),
        '0.1.2 subscribes through kit/car.js, as the themes do');
    ok(/ck: watch TrafficSignRecognition at \+0\.\d s: provider up; TrafficSignRecognition \(event\) subscribed/.test(L('parked', '0.1.2')), '0.1.2 logs each watch with the provider and each subscription\'s result');

    try { fs.rmSync ? fs.rmSync(base, { recursive: true, force: true }) : execFileSync('rm', ['-rf', base]); } catch (e) { /* temp */ }
    console.log(pass + ' passed, ' + fail + ' failed');
    if (process.env.CK_DUMP) Object.keys(R).forEach((s) => Object.keys(R[s]).forEach((v) => console.log('\n== ' + s + ' / ' + v + '\n' + JSON.stringify(R[s][v].texts, null, 1))));
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL ' + (e && e.stack || e)); console.log(pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
