'use strict';
/**
 * Package M: drive a running bench through the row's states and dump, for each, the scene (every layer with its
 * fragment shader, live uniforms and binds: the "scene" message of GET /events) to <dir>/<state>.json, printing
 * WBBACK's lanes (u_mk, u_mh, u_mo), u_cc, the speedo's u_cut and the pixel memory. tools/strip/M/verify_mask.py then
 * compares the drawing with and without the lanes. The bench must show 6WB Comfort + G20 ("g20" on, "byMode" off).
 *
 *   BENCH_PORT=8162 node tools/strip/M/lane_states.js <dir>
 *
 * Node 18+ (fetch). Never shipped. Steers only the bench it is pointed at.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.BENCH_PORT) || 8162, BASE = 'http://127.0.0.1:' + PORT;
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'apps', 'f30_cluster', 'app.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (url, body) => fetch(BASE + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const scene = (s) => post('/fake', { scene: s });
const set = (k, v) => { const it = spec.settings.find((s) => s.key === k); return post('/click', { id: 'SET_' + k.toUpperCase(), row: it.options.map((o) => o[0]).indexOf(v) }); };
const drive = (stage, rpm, speed) => post('/signals', { mode: 'manual', values: { stage, rpm, speed } });

function dump() {
    return new Promise((resolve, reject) => {
        let buf = '';
        const req = http.get({ host: '127.0.0.1', port: PORT, path: '/events' }, (res) => {
            res.setEncoding('utf8');
            res.on('data', (d) => {
                buf += d;
                let i;
                while ((i = buf.indexOf('\n\n')) >= 0) {
                    const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
                    const m = /^data: (.*)$/m.exec(chunk);
                    let msg = null;
                    try { msg = m && JSON.parse(m[1]); } catch (e) { continue; }
                    if (!msg || msg.t !== 'scene' || !Array.isArray(msg.layers)) continue;
                    res.destroy(); req.destroy();
                    return resolve({ pixels: msg.pixels, layers: msg.layers });
                }
            });
        });
        req.on('error', reject);
        setTimeout(() => reject(new Error('no scene message')), 15000);
    });
}

async function snap(dir, name) {
    const d = await dump();
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(d));
    const v = (l, k) => (l && l.uniforms[k] ? JSON.stringify(l.uniforms[k].v || l.uniforms[k]) : '-');
    const bg = d.layers.find((l) => l.fs && l.fs.indexOf('u_mk') >= 0);
    const sp = d.layers.find((l) => l.fs && l.fs.indexOf('u_cutW') >= 0 && l.uniforms.u_cut && (l.uniforms.u_cut.v || l.uniforms.u_cut)[2] > 0);
    console.log(name.padEnd(12), 'mk', v(bg, 'u_mk'), 'mh', v(bg, 'u_mh'), 'mo', v(bg, 'u_mo'), 'cc', v(bg, 'u_cc'),
        'cut', v(sp, 'u_cut'), 'pixels', (d.pixels / 1048576).toFixed(3), 'MiB');
}

(async () => {
    const dir = process.argv[2];
    if (!dir) { console.log('usage: node lane_states.js <dir>'); process.exit(2); }
    fs.mkdirSync(dir, { recursive: true });
    await drive('D', 1500, 50);
    await set('bottomRow', 'all6WB'); await sleep(1500);
    for (const s of ['clock-plus2', 'limit-50', 'road-street', 'cc-red']) await scene(s);
    await sleep(2500); await snap(dir, 'o_msg');
    await scene('cc-clear'); await sleep(800); await snap(dir, 'o_none');
    await set('bottomRow', 'allG20'); await sleep(2500); await snap(dir, 'g_none');
    await scene('cc-red'); await sleep(800); await snap(dir, 'g_msg');
    await drive('P', 0, 0); await sleep(800); await snap(dir, 'g_park_msg');
    await scene('cc-clear'); await sleep(800); await snap(dir, 'g_park');
    await drive('D', 1500, 50); await sleep(800); await snap(dir, 'g_back');
})().catch((e) => { console.error(e.message); process.exit(1); });
