'use strict';
/**
 * test-cam-check.js - Camera Check (apps/cam_check): the manifest is read only, every source is watched, a source shows
 * silent / one value / changing, and the first message of each source and its first different values reach the log.
 * 0.1.2 (fix-1121 CS): rows say «подія» or «поле», the getters are the fields' "r" flags, the top line has the clock, the
 * control row is there. The car-like proof (the real kit signals.js on a fake SOME/IP binding) is bench/test-cam-check-car.js.
 *
 *   BENCH_PORT=8841 node bench/test-cam-check.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT || 8841);
let pass = 0, fail = 0;
const ok = (c, what) => { if (c) pass++; else fail++; console.log((c ? '  ok   ' : '  FAIL ') + what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function request(method, url, body) {
    return new Promise((res) => {
        const data = body ? JSON.stringify(body) : null;
        const rq = http.request({ host: '127.0.0.1', port: PORT, path: url, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (r) => {
            let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res({ status: r.statusCode, body: b }));
        });
        rq.on('error', () => res({ status: 0, body: '' }));
        if (data) rq.write(data);
        rq.end();
    });
}

(async () => {
    // ---- the manifest: read only ----
    const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'cam_check', 'app.json'), 'utf8'));
    const flags = [], bad = [];
    Object.keys(app.signals).forEach((i) => Object.keys(app.signals[i]).forEach((k) => {
        if (k[0] === '_') { if (k === '_methods') bad.push(i + ' methods'); return; }
        flags.push(app.signals[i][k]);
        if (!/^r?s$/.test(app.signals[i][k])) bad.push(i + '.' + k + '=' + app.signals[i][k]);
    }));
    ok(!bad.length && flags.length === 7, 'seven fields (0.1.3: + the multimodal service\'s availability), flags s / rs only, no method, no setter' + (bad.length ? ' (' + bad.join(', ') + ')' : ''));
    ok(!Object.keys(app.signals).some((i) => Object.keys(app.signals[i]).some((k) => k[0] !== '_' && /acknowledgeObjectData/.test(k)) || (app.signals[i]._broadcasts || []).some((b) => /acknowledgeObjectData/.test(b))), 'the camera\'s acknowledge fields (setter, no getter) are not declared');
    const src = fs.readFileSync(path.join(ROOT, 'apps', 'cam_check', 'main.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // code only, not comments
    ok(!/\.(set|call|invoke|request)\s*\(/.test(src.replace(/ui\.text|t\.seen\.add/g, '')) && !/require\([^)]*diag/i.test(src) && !/tasu/i.test(src), 'main.js calls no setter, no method, no diagnostic request');
    ok(!/\?\.|\?\?/.test(src), 'Node 8 syntax: no ?. or ??');
    const CHECK = path.join(ROOT, 'tools', 'beam-sim', 'tests', 'stubs', 'node8-check.js');
    if (fs.existsSync(CHECK)) {
        const r8 = JSON.parse(spawnSync(process.execPath, ['--expose-internals', CHECK, path.join(ROOT, 'apps', 'cam_check', 'main.js')], { encoding: 'utf8' }).stdout || '{}');
        if (!r8.unavailable) ok(r8.ok === true, 'main.js parses as ES2017 (acorn: Node 8.16)' + (r8.ok ? '' : ': ' + r8.error));
    }
    ok((src.match(/ctx\.signals\.(\w+)/g) || []).every((x) => /\.(watch|get)$/.test(x)), 'the only signals calls are watch (the kit\'s car.js path) and get (a getter)');
    // a source's getter: true <-> its field's app.json flag has "r" (a getter is only asked where the installer generated one)
    const srcLines = src.split('\n').filter((l) => /kind: 'field'/.test(l));
    const gBad = srcLines.filter((l) => {
        const iface = (/iface: (\w+|'[^']+')/.exec(l) || [])[1], key = (/key: '(\w+)'/.exec(l) || [])[1], g = /getter: true/.test(l);
        const name = iface && iface[0] === "'" ? iface.slice(1, -1) : ({ VEH2: 'de.bmw.infotainment.vehicle.Vehicle2', CDS: 'de.bmw.infotainment.vehicle.CDS', COND: 'de.bmw.infrastructure.VehicleCondition', FAS: 'de.bmw.infotainment.fasus.FASuS', MMC: 'de.bmw.dass.driverassistanceapplications.MultimodalControlDriverAssistance' })[iface];
        const flag = name && app.signals[name] && app.signals[name][key];
        return !flag || /r/.test(flag) !== g;
    });
    ok(srcLines.length === 7 && !gBad.length, 'every field source asks a getter exactly when app.json gives it "r"' + (gBad.length ? ': ' + gBad.join(' | ') : ''));
    ok(app.version === '0.1.3' && app.config.rows.S_CRUISE === 'Асистент круїзу' && app.signals['de.bmw.dass.driverassistanceapplications.MultimodalControlDriverAssistance'].functionAvailabilityDriverAssistance === 'rs' &&
        !/multimodalControlDriverAssistance"/.test(JSON.stringify(app.signals)), '0.1.3: the row «Асистент круїзу» reads functionAvailabilityDriverAssistance (rs, getter 2); the setter is not declared');
    const rows = app.screens[0].items.map((x) => x[1]).filter((n) => /^S_/.test(n));
    ok(rows.every((r) => app.config.rows[r]), 'every row on the screen has its name in config.rows');

    // ---- on the bench ----
    const srv = spawn(process.execPath, [path.join(ROOT, 'bench', 'server.js'), 'cam_check'], { env: Object.assign({}, process.env, { BENCH_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    srv.stdout.on('data', (c) => { out += c; }); srv.stderr.on('data', (c) => { out += c; });
    const stop = () => { try { srv.kill('SIGTERM'); } catch (e) { /* gone */ } };
    try {
        for (let i = 0; i < 80 && !/ck: start/.test(out); i++) await sleep(250);
        ok(/ck: start/.test(out), 'the app starts on the bench');
        const ifaces = new Set(Object.keys(app.signals)).size;
        for (let i = 0; i < 40 && (out.match(/ck: watch \S+ at /g) || []).length < ifaces; i++) await sleep(250);
        const perIface = (out.match(/ck: watch (\S+) at /g) || []);
        ok(ifaces === 14 && perIface.length === ifaces && /ck: watching 14 interfaces through kit\/car\.js/.test(out), 'one watch per interface through kit/car.js, all at the start: ' + perIface.length + ' of ' + ifaces);
        ok(new Set(perIface).size === perIface.length, 'no interface watched twice (0.1.0 opened a proxy per source)');
        const feed = (iface, field, value) => request('POST', '/fake', { feed: { iface, field, value } });
        const MMC = 'de.bmw.dass.driverassistanceapplications.MultimodalControlDriverAssistance';
        const tx = async (n) => { const p0 = JSON.parse((await request('GET', '/probe')).body || '{}'); return (p0.native && p0.native[n] && p0.native[n].text) || ''; };
        await sleep(1200);
        const c0 = await tx('S_CRUISE');
        ok(/^Асистент круїзу · поле: сповіщень 0(, сервісу немає)? · геттер /.test(c0), '0.1.3, no value yet: the usual field text with the service and the getter\'s state: ' + c0);
        await feed(MMC, 'functionAvailabilityDriverAssistance', { proposalAvailabilityDCC: 4, proposalAvailabilitySLD: 0, valueSetSpeed: 0 });
        await sleep(1300);
        const c1 = await tx('S_CRUISE');
        ok(/^Асистент круїзу · поле: DCC NOT_EQUIPPED, SLD AVAILABLE, задана 0 · значень 1 · геттер /.test(c1), '0.1.3, wire numbers become the enum names: ' + c1);
        await feed(MMC, 'functionAvailabilityDriverAssistance', { proposalAvailabilityDCC: 'ACTIVE', proposalAvailabilitySLD: 'NOT_EQUIPPED', valueSetSpeed: 61 });
        await feed(MMC, 'functionAvailabilityDriverAssistance', { proposalAvailabilityDCC: 'ACTIVE', proposalAvailabilitySLD: 'NOT_EQUIPPED', valueSetSpeed: 'x' });
        await feed('de.bmw.dass.TrafficSignRecognition', 'TrafficSignRecognition', { presentClassLimitSpeed: 10 });
        await feed('de.bmw.dass.TrafficSignRecognition', 'TrafficSignRecognition', { presentClassLimitSpeed: 10 });
        await feed('de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy', 'RecognitionTrafficLightCamera', { trafficLightID: 3, trafficLightColor: 1 });
        await feed('de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy', 'RecognitionTrafficLightCamera', { trafficLightID: 3, trafficLightColor: 4 });
        await sleep(2600);
        const pr = JSON.parse((await request('GET', '/probe')).body || '{}');
        const t = (n) => (pr.native && pr.native[n] && pr.native[n].text) || '';
        ok(/^Світлофор · подія: ЗМІНЮЄТЬСЯ: 2 різних з 2/.test(t('S_LIGHT')), 'a changing event: ' + t('S_LIGHT'));
        ok(/· подія: одне значення \(2×\)/.test(t('S_LIMIT')), 'an event with one value: ' + t('S_LIMIT'));
        ok(/^Смуги · подія: тиша/.test(t('S_LANES')), 'a silent event is «подія: тиша»: ' + t('S_LANES'));
        ok(/^Стан фар авто · поле: сповіщень 0/.test(t('S_LAMPS')) && /геттер/.test(t('S_LAMPS')), 'a silent field is «поле», with its getter\'s state: ' + t('S_LAMPS'));
        ok(/^Контроль \(теми це чують\) · поле: швидкість \d+×.*оберти \d+×.*стан авто \d+×/.test(t('S_CTRL')), 'the control row: ' + t('S_CTRL'));
        ok(/^Асистент круїзу · поле: DCC ACTIVE, SLD NOT_EQUIPPED, задана \? · значень 3 · геттер /.test(t('S_CRUISE')), '0.1.3, names as they come; a set speed that is not a number is "?": ' + t('S_CRUISE'));
        ok(/ck: cruise assist \(value\) at \+[\d.]+ s: DCC NOT_EQUIPPED, SLD AVAILABLE, задана 0/.test(out) && /ck: cruise assist \(value\) at \+[\d.]+ s: DCC ACTIVE, SLD NOT_EQUIPPED, задана 61/.test(out), '0.1.3: every new cruise-assist value is a log line');
        ok(/^Лише читання · \d\d:\d\d:\d\d · працює \d+:\d\d · /.test(t('HEAD')), 'the top line has the app\'s clock and running time: ' + t('HEAD'));
        ok(/ck: first light \(event\) .*"trafficLightColor":1/.test(out) && /ck: value #2 light \(event\) .*"trafficLightColor":4/.test(out), 'the first message and the next different value are in the log');
        ok(/ck: provider TrafficLightRecognitionFrontCameraLegacy UP #1 at \+[\d.]+ s/.test(out), 'a provider coming up is in the log');
        ok(!/ck: [^\n]*(error|uncaught)/i.test(out), 'no error in the app\'s log');
    } finally { stop(); }
    console.log(pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL ' + (e && e.stack || e)); console.log(pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
