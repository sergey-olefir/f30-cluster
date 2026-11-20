'use strict';
/**
 * test-cam-check.js - Camera Check (apps/cam_check): the manifest is read only, every source is watched, a source shows
 * silent / one value / changing, and the first message of each source and its first different values reach the log.
 *
 *   BENCH_PORT=8962 node bench/test-cam-check.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT || 8962);
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
    ok(!bad.length && flags.length === 4, 'four fields, flags s / rs only, no method, no setter' + (bad.length ? ' (' + bad.join(', ') + ')' : ''));
    ok(!Object.keys(app.signals).some((i) => Object.keys(app.signals[i]).some((k) => k[0] !== '_' && /acknowledgeObjectData/.test(k)) || (app.signals[i]._broadcasts || []).some((b) => /acknowledgeObjectData/.test(b))), 'the camera\'s acknowledge fields (setter, no getter) are not declared');
    const src = fs.readFileSync(path.join(ROOT, 'apps', 'cam_check', 'main.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // code only, not comments
    ok(!/\.(set|call|invoke|request)\s*\(/.test(src.replace(/ui\.text|t\.seen\.add/g, '')) && !/require\([^)]*diag/i.test(src) && !/tasu/i.test(src), 'main.js calls no setter, no method, no diagnostic request');
    ok(!/\?\.|\?\?/.test(src), 'Node 8 syntax: no ?. or ??');
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
        await sleep(1500);
        const watched = (out.match(/ck: watch \S+ ok/g) || []).length;
        ok(watched === 14, 'all 14 sources watched (' + watched + ')');
        const feed = (iface, field, value) => request('POST', '/fake', { feed: { iface, field, value } });
        await feed('de.bmw.dass.TrafficSignRecognition', 'TrafficSignRecognition', { presentClassLimitSpeed: 10 });
        await feed('de.bmw.dass.TrafficSignRecognition', 'TrafficSignRecognition', { presentClassLimitSpeed: 10 });
        await feed('de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy', 'RecognitionTrafficLightCamera', { trafficLightID: 3, trafficLightColor: 1 });
        await feed('de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy', 'RecognitionTrafficLightCamera', { trafficLightID: 3, trafficLightColor: 4 });
        await sleep(2600);
        const pr = JSON.parse((await request('GET', '/probe')).body || '{}');
        const t = (n) => (pr.native && pr.native[n] && pr.native[n].text) || '';
        ok(/^Світлофор: ЗМІНЮЄТЬСЯ: 2 різних з 2/.test(t('S_LIGHT')), 'a changing source: ' + t('S_LIGHT'));
        ok(/одне й те саме значення \(2×\)/.test(t('S_LIMIT')), 'a source with one value: ' + t('S_LIMIT'));
        ok(/: мовчить$/.test(t('S_LAMPS')), 'a silent source: ' + t('S_LAMPS'));
        ok(/ck: first light .*"trafficLightColor":1/.test(out) && /ck: value #2 light .*"trafficLightColor":4/.test(out), 'the first message and the next different value are in the log');
        ok(!/ck: [^\n]*(error|uncaught)/i.test(out), 'no error in the app\'s log');
    } finally { stop(); }
    console.log(pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL ' + (e && e.stack || e)); console.log(pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
