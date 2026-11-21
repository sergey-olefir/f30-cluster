'use strict';
/**
 * bench.js - the stub service 13203 on a LOCAL port, and a bench test app that drives the gated module against it
 * (package CM, rung 1). Nothing here knows how to reach a car: the server binds 127.0.0.1 only, on a port in 8811-8819
 * only, and the client posts only to 127.0.0.1. The payload is the module's 10 bytes; the server decodes them with the
 * stub receiver (stub_receiver.js), which checks the frozen shape and records any violation.
 *
 *   node tools/cruise-cmd/bench.js serve [--port 8811] [--mode accept] [--scale 1]     the stub service, until Ctrl-C
 *   node tools/cruise-cmd/bench.js app   [--port 8811] [--mode accept]                  the bench test app, one scripted
 *                                                                                      approach, its log on stdout
 *
 *   startServer({ port, mode, clock, ...stub opts }) -> Promise<{ port, close(), state(), stub }>
 *     clock: () => seconds (default: real time); the bench app passes its simulated clock so the stub's delays count in it
 *     POST /13203/1/setter/1   body { bytes: [10 numbers] }  -> after the stub's answer delay: 200 { ok, code } (ok false
 *                                                              is the setter's error); a malformed body: 400
 *     GET  /state                                           -> { setKmh, applied: n, violations: n, history: [...] }
 *     The applied set speed starts at `startKmh` and changes only by the stub's 'apply' events (as a cruise would).
 *   send(port, request) -> Promise<{ ok, code }>   the bench app's transport (a request built by cruise_cmd only)
 *   runApp({ port, ticks, ... }) -> Promise<summary>   the bench test app (below)
 * Node 8 syntax.
 */

const http = require('http');
const CM = require('../../shared/cruise_cmd.js');
const follow = require('./follow.js');
const stubR = require('./stub_receiver.js');

const PORTS = [8811, 8812, 8813, 8814, 8815, 8816, 8817, 8818, 8819];
const HOST = '127.0.0.1';
const PATH = '/' + CM.SERVICE_ID + '/' + CM.INSTANCE_ID + '/setter/' + CM.SETTER_ID;

function checkPort(port) {
    if (PORTS.indexOf(port) < 0) throw new Error('bench: port ' + port + ' is not one of 8811-8819');
    return port;
}

function startServer(o) {
    const opts = Object.assign({ port: 8811, startKmh: 100 }, o || {});
    const port = checkPort(opts.port);
    const t0 = Date.now();
    const clock = typeof opts.clock === 'function' ? opts.clock : null;
    const stubOpts = Object.assign({}, opts);
    delete stubOpts.port; delete stubOpts.startKmh; delete stubOpts.clock;
    const stub = stubR.create(stubOpts);
    const st = { setKmh: opts.startKmh, applied: 0 };
    const waiting = [];          // { seq, res }
    function now() { return clock ? clock() : (Date.now() - t0) / 1000; }
    // the stub's events come due in real time
    const timer = setInterval(() => {
        try {
            stub.due(now()).forEach((e) => {
                if (e.kind === 'apply') { st.setKmh = e.kmh; st.applied++; }
                else {
                    const i = waiting.findIndex((w) => w.seq === e.seq);
                    if (i >= 0) { const w = waiting.splice(i, 1)[0]; reply(w.res, 200, { ok: e.ok, code: e.code }); }
                }
            });
        } catch (err) { /* the bench must keep running */ }
    }, 10);
    function reply(res, code, obj) {
        try { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); } catch (e) { /* closed */ }
    }
    const server = http.createServer((req, res) => {
        try {
            if (req.method === 'GET' && req.url === '/state') {
                reply(res, 200, { setKmh: st.setKmh, applied: st.applied, violations: stub.violations.length, history: stub.history.slice(-20) });
                return;
            }
            if (req.method !== 'POST' || req.url !== PATH) { reply(res, 404, { ok: false, code: 'NO_SUCH_MEMBER' }); return; }
            let body = '';
            req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
            req.on('end', () => {
                let bytes = null;
                try { bytes = JSON.parse(body).bytes; } catch (e) { reply(res, 400, { ok: false, code: 'BAD_BODY' }); return; }
                const rec = stub.receive(now(), bytes);
                waiting.push({ seq: rec.n, res: res });
            });
        } catch (e) { reply(res, 500, { ok: false, code: 'BENCH_ERROR' }); }
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, HOST, () => {
            resolve({
                port: port, stub: stub,
                state: () => ({ setKmh: st.setKmh, applied: st.applied, violations: stub.violations.length }),
                close: () => new Promise((r) => { clearInterval(timer); server.close(() => r()); }),
            });
        });
    });
}

/** The bench app's transport: the request's bytes to the local stub. Refuses anything not built by cruise_cmd. */
function send(port, request) {
    return new Promise((resolve) => {
        try {
            checkPort(port);
            if (!request || request.kind !== 'CM_SET_SPEED' || !Object.isFrozen(request)) throw new Error('not a module request');
            CM.assertFrozenShape(CM.decode(request.bytes), { sender: request.names.mMControlSender });
            const body = JSON.stringify({ bytes: request.bytes.slice() });
            const req = http.request({ host: HOST, port: port, method: 'POST', path: PATH, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 10000 }, (res) => {
                let b = '';
                res.on('data', (c) => { b += c; });
                res.on('end', () => { try { const j = JSON.parse(b); resolve({ ok: j.ok === true, code: j.code || null }); } catch (e) { resolve({ ok: false, code: 'BAD_ANSWER' }); } });
            });
            req.on('timeout', () => { req.destroy(); resolve({ ok: false, code: 'TIMEOUT' }); });
            req.on('error', () => resolve({ ok: false, code: 'NO_SERVICE' }));
            req.end(body);
        } catch (e) { resolve({ ok: false, code: 'NOT_SENT' }); }
    });
}

/**
 * The bench test app: a scripted drive on a simulated clock (100 ms ticks, shared with the stub through clockState when
 * the server runs in the same process) against the stub service. Our car holds its
 * speed at the set speed the stub has applied (a perfect cruise); a lead ahead is `leadKmh` (default 85) and closes from
 * `gap0_m`. The driver arms in two steps at 0 and 0.6 s. Every request the module builds goes over HTTP; every answer
 * comes back to onResult. Returns { log, requests, final view, the stub's state }.
 */
async function runApp(o) {
    const opts = Object.assign({ port: 8811, ticks: 300, startKmh: 100, leadKmh: 85, gap0_m: 90, sleepMs: 12 }, o || {});
    const mod = CM.create({ requireOfferSignal: true });
    const law = follow.create({});
    const log = [];
    const requests = [];
    const answers = [];
    let ego = opts.startKmh, gap = opts.gap0_m;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const clk = opts.clockState || { t: 0 };
    async function stateOf() {
        return new Promise((resolve) => {
            http.get({ host: HOST, port: checkPort(opts.port), path: '/state' }, (res) => {
                let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
            }).on('error', () => resolve(null));
        });
    }
    for (let k = 0; k < opts.ticks; k++) {
        const now = k * 100;
        clk.t = now / 1000;
        await sleep(opts.sleepMs);                       // the stub serves what came due at this time
        while (answers.length) { const a = answers.shift(); const vv = mod.onResult(now, a.seq, a.ok, a.code); log.push('cm t=' + now + ' answer=' + (/^[A-Z][A-Z0-9_]*$/.test(String(a.code)) ? a.code : 'OTHER') + ' seq=' + a.seq + ' ok=' + (a.ok ? 1 : 0) + ' mode=' + vv.mode + ' why=' + vv.reason); }
        const st = await stateOf();
        const setKmh = st ? st.setKmh : null;
        if (setKmh !== null) ego += Math.max(-0.25, Math.min(0.25, setKmh - ego));       // about 0.7 m/s² either way
        gap += (opts.leadKmh - ego) / 3.6 * 0.1;
        const v = mod.view();
        const lead = { valid: gap < 120, gap_m: gap, vrel_mps: (opts.leadKmh - ego) / 3.6, alead_mps2: 0, t: now };
        const dec = law.step({ t: now, lead: lead, egoKmh: ego, setKmh: v.armed ? v.setKmh : setKmh, ceilingKmh: v.armed ? v.ceilingKmh : setKmh });
        const inp = { feed: { kind: 'cruise', status: 'active', kmh: Math.round(setKmh), t: now }, egoKmh: ego, egoT: now, lead: lead,
            decision: { seq: dec.seq, t: dec.t, wantKmh: dec.wantKmh, why: dec.why }, offer: false };
        if (k === 0) mod.armStep(now);
        if (k === 6) mod.armConfirm(now, inp);
        const r = mod.step(now, inp);
        if (r.log) log.push(r.log);
        if (r.request) {
            requests.push({ t: now, kmh: r.request.kmh, bytes: r.request.bytes.slice() });
            const seq = r.request.seq;
            send(opts.port, r.request).then((ans) => { answers.push({ seq: seq, ok: ans.ok, code: ans.code }); });
        }
    }
    await sleep(50);
    return { log: log, requests: requests, view: mod.view(), stub: await stateOf() };
}

function args(argv) {
    const o = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.indexOf('--') === 0) { const v = argv[i + 1]; o[a.slice(2)] = isNaN(Number(v)) ? v : Number(v); i++; }
        else o._.push(a);
    }
    return o;
}

async function main() {
    const a = args(process.argv.slice(2));
    const cmd = a._[0];
    const port = a.port || 8811;
    const stubOpts = {};
    ['mode', 'scaleFactor', 'scaleOffset', 'applyDelay_s', 'lateAnswer_s', 'okCount'].forEach((k) => { if (a[k] !== undefined) stubOpts[k] = a[k]; });
    if (cmd === 'serve') {
        const s = await startServer(Object.assign({ port: port }, stubOpts));
        console.log('stub service 13203 on http://' + HOST + ':' + s.port + PATH + ' mode ' + (stubOpts.mode || 'accept') + ' (Ctrl-C to stop)');
        return;
    }
    if (cmd === 'app') {
        const clk = { t: 0 };
        const s = await startServer(Object.assign({ port: port, startKmh: 100, clock: () => clk.t }, stubOpts));
        const r = await runApp({ port: port, clockState: clk });
        r.log.forEach((l) => console.log(l));
        console.log('requests ' + r.requests.length + ', final ' + r.view.mode + ' ' + r.view.reason + ', stub set ' + (r.stub && r.stub.setKmh) + ', violations ' + (r.stub && r.stub.violations));
        await s.close();
        return;
    }
    console.log('usage: node tools/cruise-cmd/bench.js serve|app [--port 8811..8819] [--mode ' + stubR.MODES.join('|') + ']');
}

module.exports = { startServer: startServer, send: send, runApp: runApp, PORTS: PORTS, HOST: HOST, PATH: PATH };
if (require.main === module) main().catch((e) => { console.error(String(e && e.message || e)); process.exitCode = 1; });
