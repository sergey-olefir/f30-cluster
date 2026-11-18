'use strict';
/**
 * bench_check.js - research round 3, package MC: three of cases.js's cases (A0 the control, A1 the getter's default
 * 65535, A3 the number kept after the end) on the real bench - the BUILT f30_cluster (dist/, as the Store builds it) in
 * the kit's stubbed head unit with the fake cluster-render - so the in-process replay (engine.js) can be checked against
 * the full app: the same window state (WBBACK u_cc in the opaque Comfort) and the same log lines.
 *
 *   BENCH_PORT=8304 node tools/research3/mc/bench_check.js [--json out.json]
 *
 * Port 8304 (research round 3: 8300 + MC's number). Rebuilds dist/ (run it alone in this worktree). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const PORT = Number(process.env.BENCH_PORT) || 8304;
const BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-bench-'));
let logText = '', server = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, url, body) {
    try {
        const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        return await r.json();
    } catch (e) { return null; }
}
const probe = () => req('GET', '/probe');
const fake = (v) => req('POST', '/fake', v);
const S = (p) => (p && p.signs) || {};
async function until(fn, ms) {
    const t0 = Date.now();
    let p = null;
    while (Date.now() - t0 < ms) { p = await probe(); if (p && fn(p)) return p; await sleep(150); }
    return p;
}
const REST = { name: 'All systems OK', color: 'green', id: 0, symbol: 6 };
const DOOR = { name: 'Driver door open', color: 'white', id: 15, symbol: 2 };

async function main() {
    const out = { port: PORT, cases: {} };
    server = spawn(process.execPath, [path.join(ROOT, 'bench', 'server.js'), 'f30_cluster'], {
        cwd: ROOT, env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: path.join(tmp, 'data'), SCREEN_DIR: path.join(tmp, 'screen') }),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (d) => { logText += d; };
    server.stdout.on('data', keep); server.stderr.on('data', keep);
    let p = await until((q) => q && q.ready && q.activeName, 120000);
    if (!p || !p.ready) throw new Error('the bench did not come up');
    // the opaque Comfort (wb_comfort), the G20 toggle off: BMW's panel window is WBBACK u_cc
    const box = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts', 'wb_comfort.json'), 'utf8')).widgets.find((x) => x.id === 'bg').cc;
    const steps = async (name, seq) => {
        const mark = logText.length, rows = [];
        for (const s of seq) {
            await fake(s.feed);
            await sleep(s.wait || 600);
            const q = await probe();
            const ucc = S(q).safety && S(q).safety.ucc;
            const open = Array.isArray(ucc) && ucc.some((v) => v !== 0);
            rows.push({ step: s.label, truth: s.truth, open, shown: S(q).cc && S(q).cc.shown, noMatch: S(q).cc && S(q).cc.noMatch, ucc });
        }
        const lines = logText.slice(mark).split('\n').filter((l) => /active cc:|check-control list:|check-control frames:/.test(l))
            .map((l) => l.replace(/^.*?(active cc:|check-control list:|check-control frames:)/, '$1'));
        out.cases[name] = { rows, lines, endsOpen: rows[rows.length - 1].open };
        console.log(name + ': ' + rows.map((r) => r.truth + '>' + (r.open ? 'open' : 'shut')).join(' ') + (rows[rows.length - 1].open ? '  HANG' : '  ok'));
        lines.forEach((l) => console.log('    ' + l));
    };
    const restart = async () => {
        await req('POST', '/restart'); await sleep(1000);
        await until((q) => q && q.ready && q.activeName, 90000);
    };
    // wb_comfort is the default layout; make sure the G20 toggle is off
    p = await probe();
    out.layout = p.activeName;
    console.log('layout ' + p.activeName + ', the panel box ' + JSON.stringify(box));
    await steps('A0', [
        { label: 'rest', truth: 'none', feed: { ccList: [REST], ccActive: { number: 0 } } },
        { label: 'door', truth: 'msg', feed: { ccList: [DOOR], ccActive: { number: 15, control: 1, frame: 1, of: 1 } } },
        { label: 'shut', truth: 'none', feed: { ccList: [REST], ccActive: { number: 0 } } },
        { label: '+3 s', truth: 'none', feed: {}, wait: 3000 },
    ]);
    await restart();
    await steps('A1', [
        { label: 'default', truth: 'none', feed: { ccActive: { number: 65535, control: 4095, frame: 15, of: 15 }, ccList: [REST] } },
        { label: '+3 s', truth: 'none', feed: {}, wait: 3000 },
    ]);
    await restart();
    await steps('A3', [
        { label: 'rest', truth: 'none', feed: { ccList: [REST], ccActive: { number: 0 } } },
        { label: 'door', truth: 'msg', feed: { ccList: [DOOR], ccActive: { number: 15, control: 1, frame: 1, of: 1 } } },
        { label: 'shut, number kept', truth: 'none', feed: { ccList: [REST] } },
        { label: '+3 s', truth: 'none', feed: {}, wait: 3000 },
    ]);
    const j = process.argv.indexOf('--json');
    if (j >= 0) { fs.mkdirSync(path.dirname(process.argv[j + 1]), { recursive: true }); fs.writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 1)); }
}

main().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exitCode = 1; }).then(() => {
    if (server) server.kill('SIGTERM');
    // the bench server echoes our own POST /fake bodies (invented names) as 'bench: fake ...': not the app's log
    const priv = logText.split('\n').filter((l) => /All systems OK|Driver door open/.test(l) && !/bench: fake/.test(l));
    console.log(priv.length ? 'PRIVACY: ' + priv.length + ' log line(s) carry message text:\n  ' + priv.slice(0, 3).map((l) => l.slice(0, 160)).join('\n  ') : 'privacy: no message text in the log');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left in tmp */ }
});
