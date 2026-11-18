'use strict';
/**
 * bench_trip.js - research round 3, package MK: run the REAL twin_dial (this checkout, factors on by default) on the bench
 * and read back what its log says about the trip computer and the odometer, in three phases:
 *
 *   A  silent:  nothing of the trip fed (the car of 2026-11-17 as the owner saw it), odometer fed (48215 km)
 *   B  KombiIF: the three trip structs fed through bench/twin-sim.js (it feeds tenths: speed 41.0, cons 6.8, 12.4 km)
 *   C  markers: the same structs with their "unfilled" values (4095 / 65535 / 255)
 *
 *   node tools/research3/mk/bench_trip.js [--port 8305] [--out design/research3/mk/bench-trip.json]
 *
 * The app is a COPY of apps/twin_dial in a bench tree of its own (tools/shots/twin/root.py) with only
 * config.trip.summaryMs shortened, so each phase ends in a summary within seconds. The bench is a child of this script and
 * is stopped by it (SIGTERM) on every path. Port 8305 (8300 + package 5); never 8080 / 8150. Writes the trip / odometer
 * log lines (synthetic numbers only) to --out. Mac only, no car.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', 8305));
const OUT = path.resolve(ROOT, arg('--out', 'design/research3/mk/bench-trip.json'));
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUMMARY_MS = [25000, 45000, 65000];

async function req(method, url, body) {
    const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', connection: 'close' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 200) return r.json();
    if (r.status === 204) return null;
    throw new Error(method + ' ' + url + ': ' + r.status);
}

async function main() {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-bench-'));
    const root = execFileSync('python3', [path.join(ROOT, 'tools', 'shots', 'twin', 'root.py'), work, '--real'], { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
    // the app: a copy, with the summaries early
    const link = path.join(root, 'apps', 'twin_dial');
    fs.unlinkSync(link);
    execFileSync('cp', ['-R', path.join(ROOT, 'apps', 'twin_dial'), link]);
    const appJson = path.join(link, 'app.json');
    const app = JSON.parse(fs.readFileSync(appJson, 'utf8'));
    app.config.trip.summaryMs = SUMMARY_MS;
    fs.writeFileSync(appJson, JSON.stringify(app, null, 2));
    const data = path.join(work, 'data');
    fs.mkdirSync(data);
    let log = '';
    const scene = path.join(ROOT, 'apps', 'twin_dial', 'hud', 'scene');
    const p = spawn('node', [path.join(root, 'bench', 'server.js'), 'twin_dial'], { cwd: root,
        env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: data, BENCH_NOW: '2026-11-18T12:00:00Z', TWIN_SCENE_DIR: scene }),
        stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
    const stop = async () => { try { p.kill('SIGTERM'); } catch (e) { /* gone */ } await new Promise((r) => { p.on('exit', r); setTimeout(r, 3000); }); };
    const result = { port: PORT, summaryMs: SUMMARY_MS, phases: {} };
    try {
        const t0 = Date.now();
        let up = false;
        while (Date.now() - t0 < 90000) {
            try { const q = await req('GET', '/probe'); if (q && q.ready) { up = true; break; } } catch (e) { /* starting */ }
            await sleep(250);
        }
        if (!up) throw new Error('the bench did not come up in 90 s');
        const tUp = Date.now();
        await req('POST', '/signals', { mode: 'manual', values: { rpm: 800, speed: 0, gear: 0, fuelL: 38, range: 412, odometer: 48215, coolant: 90, ambient: 7.5, condition: 10, engine: 2 } });
        const pick = () => log.split('\n').filter((l) => /(trip |odometer |trip:|signal (KombiIF|ResetLogic3|MileageSupreme|SecureMileage|VehicleInformation))/.test(l));
        const waitFor = async (re, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (re.test(log)) return true; await sleep(250); } return false; };
        // A: silent until summary #1
        await waitFor(/trip summary #1/, SUMMARY_MS[0] + 20000);
        await sleep(1500);
        result.phases.A = pick();
        const nA = result.phases.A.length;
        // B: KombiIF's three structs (twin-sim feeds tenths)
        await req('POST', '/fake', { twin: { trip: { speed1: 41, cons1: 6.8, speed2: 52, cons2: 5.5, hours: 0, minutes: 43, km: 12.4, depart: { hour: 14, minute: 0, day: 18, month: 11, year: 2026 } } } });
        await waitFor(/trip summary #2/, SUMMARY_MS[1] + 20000);
        await sleep(500);
        result.phases.B = pick().slice(nA);
        const nB = nA + result.phases.B.length;
        // C: the unfilled markers
        await req('POST', '/fake', { twin: { trip: null } });
        await waitFor(/trip summary #3/, SUMMARY_MS[2] + 20000);
        await sleep(500);
        result.phases.C = pick().slice(nB);
        result.upAfterMs = tUp - t0;
        result.uncaught = /uncaught|app exited/i.test(log);
    } finally {
        await stop();
    }
    // strip the bench's timestamps / prefixes down to the app's own text
    Object.keys(result.phases).forEach((k) => { result.phases[k] = result.phases[k].map((l) => l.replace(/^.*?((trip|odometer|signal) )/, '$1')); });
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
    Object.keys(result.phases).forEach((k) => { console.log('== ' + k); result.phases[k].forEach((l) => console.log('  ' + l)); });
    console.log('uncaught: ' + result.uncaught + '; written ' + path.relative(ROOT, OUT));
}
main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
