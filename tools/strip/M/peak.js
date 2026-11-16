'use strict';
/**
 * Package M: the pixel-memory and layer PEAK while the row and the layout switch (cluster-render refuses past 16 MiB
 * or 8 layers a connection, and the peak of a switch is what breaks: old and new together). Listens to the bench's
 * scene stream (GET /events: every scene message carries the service's pixel bytes and every layer) while it drives
 * the switches, and prints the highest pixel memory, layer count, layers per connection and asset count per phase.
 *
 *   BENCH_PORT=8162 node tools/strip/M/peak.js
 *
 * Node 18+ (fetch). Steers only the bench it is pointed at; leaves it in 6WB Comfort + G20, allG20.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.BENCH_PORT) || 8162, BASE = 'http://127.0.0.1:' + PORT;
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'apps', 'f30_cluster', 'app.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (url, body) => fetch(BASE + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const set = (k, v) => { const it = spec.settings.find((s) => s.key === k); return post('/click', { id: 'SET_' + k.toUpperCase(), row: it.options.map((o) => o[0]).indexOf(v) }); };
const click = (id) => post('/click', { id });
const scene = (s) => post('/fake', { scene: s });
// (strip integration: standby is VehicleCondition 5 held 1 s, package X's COND_STANDBY, not "P with the engine off")
const drive = (stage, rpm, condition) => post('/signals', { mode: 'manual', values: Object.assign({ stage, rpm, speed: stage === 'D' ? 50 : 0 }, condition === undefined ? {} : { condition }) });

let phase = 'start';
const peaks = {};
function note(msg) {
    const p = peaks[phase] || (peaks[phase] = { mib: 0, layers: 0, perConn: 0, assets: 0 });
    const conn = {};
    let layers = 0, assets = 0;
    msg.layers.forEach((l) => { if (l.kind === 'asset') assets++; else { layers++; conn[l.conn] = (conn[l.conn] || 0) + 1; } });
    p.mib = Math.max(p.mib, msg.pixels / 1048576);
    p.layers = Math.max(p.layers, layers);
    p.perConn = Math.max(p.perConn, ...Object.values(conn), 0);
    p.assets = Math.max(p.assets, assets);
}
function listen() {
    let buf = '';
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/events' }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (d) => {
            buf += d;
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const ch = buf.slice(0, i); buf = buf.slice(i + 2);
                const m = /^data: (.*)$/m.exec(ch);
                if (!m || m[1].indexOf('"t":"scene"') < 0) continue;
                try { const msg = JSON.parse(m[1]); if (Array.isArray(msg.layers)) note(msg); } catch (e) { /* partial */ }
            }
        });
    });
    return req;
}

(async () => {
    const req = listen();
    await sleep(1500);
    const step = async (name, fn, wait) => { phase = name; await fn(); await sleep(wait || 2500); };
    await step('allG20', async () => { await drive('D', 1500); await set('bottomRow', 'allG20'); });
    await step('allG20 + message', () => scene('cc-red'));
    await step('allG20, P engine off (photo 63)', () => drive('P', 0, 7));
    await step('allG20 standby', () => drive('P', 0, 5), 3000);
    await step('back to D', async () => { await drive('D', 1500); await scene('cc-clear'); });
    await step('all6WB (unread)', () => set('bottomRow', 'all6WB'), 3500);
    await step('all6WB, clock + message read', async () => { await scene('clock-plus2'); await scene('cc-red'); }, 3500);
    await step('all6WB, message gone', () => scene('cc-clear'));
    await step('all6WB standby', () => drive('P', 0, 5), 3500);
    await step('all6WB out of standby', () => drive('D', 1500, 10), 3500);
    await step('g20 off (opaque 6WB Comfort)', () => click('SET_G20'), 4000);
    await step('g20 on again (Comfort + G20)', () => click('SET_G20'), 4000);
    await step('allG20 again', () => set('bottomRow', 'allG20'), 3500);
    req.destroy();
    Object.keys(peaks).forEach((k) => {
        const p = peaks[k];
        console.log(k.padEnd(32), 'peak', p.mib.toFixed(3), 'MiB,', p.layers, 'layers,', p.perConn, 'per connection,', p.assets, 'assets');
    });
    process.exit(0);
})();
