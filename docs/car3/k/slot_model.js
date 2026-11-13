'use strict';
/**
 * Package K probe: a stand-in cluster-render that answers like the real one (hello, layer shown) and replays the
 * upstream service's rule for when a target is wanted (src/stack.cpp arrange(): a visible layer that is ready, or
 * prewarm; src/compositor.cpp: an effect is ready when every asset it binds has pixels, an image when its first
 * write came; src/asset.cpp: an asset has pixels once its whole write arrived). Logs every op with a timestamp and
 * every interval in which the panel is wanted by no layer: cluster-render lingers panel_linger_ms (3000) and then
 * releases the slot (unmap); a release + new request is a fresh DCSM mapping.
 *
 * usage: node tap.js <stage dir> <data dir> <script.json> <out.json>
 */
const net = require('net');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const [stage, dataDir, scriptFile, outFile] = process.argv.slice(2);
const SOCK = path.join(require('os').tmpdir(), 'k-tap-' + process.pid + '.sock');
try { fs.unlinkSync(SOCK); } catch (e) { /* none */ }
const T0 = Date.now();
const now = () => Date.now() - T0;

const layers = new Map();   // "client:ref" -> { kind, target, visible, prewarm, binds: {sampler: "client:ref"}, have }
const events = [];          // { t, client, op, ref, kind, extra }
const gaps = [];            // { from, to, ms }
let wanted = false, unwantedSince = null, everWanted = false;
const marks = [];           // { t, label } from the script
// the slot, as src/slots.cpp ticks it: idle -> (wanted) acquiring -> shown (300 ms, the KOMBI's map) -> (unwanted)
// lingering -> (3000 ms) idle = released; a request from idle is a fresh DCSM mapping
const slot = { state: 'idle', since: 0, requests: 0, releases: 0, log: [] };
const socks = new Set();
function targetEv(state) {
    slot.log.push({ t: now(), state });
    const b = Buffer.from(JSON.stringify({ ev: 'target', target: 'panel', state, holder: state === 'idle' ? '' : 'us', reason: '' }), 'utf8');
    const m = Buffer.alloc(5 + b.length); m.writeUInt32LE(b.length + 1, 0); m[4] = 0x4a; b.copy(m, 5);
    socks.forEach((s) => { try { s.write(m); } catch (e) { /* gone */ } });
}
setInterval(() => {
    const t = now(), w = panelWanted();
    const set = (st) => { slot.state = st; slot.since = t; targetEv(st); };
    if (slot.state === 'idle' && w) { slot.requests++; set('acquiring'); }
    else if (slot.state === 'acquiring' && t - slot.since >= 300) set(w ? 'shown' : 'lingering');
    else if (slot.state === 'shown' && !w) set('lingering');
    else if (slot.state === 'lingering' && w) set('shown');
    else if (slot.state === 'lingering' && t - slot.since >= 3000) { slot.releases++; set('idle'); }
}, 50);

function panelWanted() {
    for (const [, l] of layers) {
        if (l.kind === 'asset' || l.target !== 'panel' || !l.visible) continue;
        let ready;
        if (l.kind === 'image') ready = l.have;
        else ready = Object.keys(l.binds).every((s) => { const a = layers.get(l.binds[s]); return a && a.have; });
        if (ready || l.prewarm) return true;
    }
    return false;
}
function recheck() {
    const w = panelWanted();
    if (w === wanted) return;
    wanted = w;
    if (w) {
        if (everWanted && unwantedSince !== null) gaps.push({ from: unwantedSince, to: now(), ms: now() - unwantedSince });
        everWanted = true; unwantedSince = null;
    } else unwantedSince = now();
}

let clientSeq = 0;
const server = net.createServer((sock) => {
    const cid = ++clientSeq;
    socks.add(sock); sock.on('close', () => socks.delete(sock));
    let name = '?', buf = Buffer.alloc(0);
    const send = (o) => {
        const b = Buffer.from(JSON.stringify(o), 'utf8'), m = Buffer.alloc(5 + b.length);
        m.writeUInt32LE(b.length + 1, 0); m[4] = 0x4a; b.copy(m, 5); sock.write(m);
    };
    sock.on('data', (d) => {
        buf = buf.length ? Buffer.concat([buf, d]) : d;
        let off = 0;
        while (buf.length - off >= 5) {
            const len = buf.readUInt32LE(off);
            if (buf.length - off < 4 + len) break;
            const type = buf[off + 4], body = buf.slice(off + 5, off + 4 + len);
            off += 4 + len;
            if (type === 0x46) {            // frame: u32 ref
                const ref = body.readUInt32LE(0), l = layers.get(cid + ':' + ref);
                if (l && !l.have) { l.have = true; events.push({ t: now(), c: name, op: 'pixels', ref, kind: l.kind }); }
                recheck();
                continue;
            }
            if (type !== 0x4a) continue;
            let m; try { m = JSON.parse(body.toString('utf8')); } catch (e) { continue; }
            const key = cid + ':' + m.ref;
            if (m.op === 'hello') { name = m.app; send({ ev: 'hello', proto: 1, backend: 'id7', targets: 'map:1088x480,panel:1920x720,hud:800x480' }); }
            else if (m.op === 'layer' || m.op === 'asset') {
                layers.set(key, { kind: m.op === 'asset' ? 'asset' : m.kind, target: m.target, visible: m.visible !== 0, prewarm: m.prewarm === 1, binds: {}, have: false });
                if (m.op === 'layer') send({ ev: 'layer', ref: m.ref, state: 'shown' });
            } else if (m.op === 'bind') { const l = layers.get(key); if (l) l.binds[m.sampler] = cid + ':' + m.asset; }
            else if (m.op === 'set') { const l = layers.get(key); if (l && m.visible !== undefined) l.visible = m.visible !== 0; if (l && m.prewarm !== undefined) l.prewarm = m.prewarm === 1; }
            else if (m.op === 'drop') layers.delete(key);
            else if (m.op === 'status') send({ ev: 'status', text: 'tap' });
            if (m.op !== 'uniform') events.push({ t: now(), c: name, op: m.op, ref: m.ref, kind: m.kind || (m.op === 'asset' ? 'asset' : undefined), prewarm: m.prewarm });
            recheck();
        }
        buf = buf.slice(off);
    });
    sock.on('close', () => { for (const k of [...layers.keys()]) if (k.indexOf(cid + ':') === 0) layers.delete(k); recheck(); });
    sock.on('error', () => {});
});

server.listen(SOCK);
// the app, with its own log
const script = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
const appLog = [];
setTimeout(() => {
    const opts = { cwd: dataDir, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: Object.assign({}, process.env, { HUD_CLUSTER_SOCKET: SOCK }) };
    const app = fork(script.runApp, [stage, dataDir], opts);
    const pipe = (s) => { let rest = ''; s.on('data', (d) => { const ls = (rest + d).split('\n'); rest = ls.pop(); ls.forEach((x) => appLog.push(now() + ' ' + x)); }); };
    pipe(app.stdout); pipe(app.stderr);
    app.send({ t: 'signals', mode: 'manual', values: { rpm: 800, speed: 0, gear: 0 } });
    let at = 0;
    script.steps.forEach((s) => {
        at += s.wait || 0;
        setTimeout(() => { marks.push({ t: now(), label: s.label || JSON.stringify(s.msg) }); if (s.msg) app.send(s.msg); }, at);
    });
    setTimeout(() => {
        if (unwantedSince !== null) gaps.push({ from: unwantedSince, to: null, ms: now() - unwantedSince });
        fs.writeFileSync(outFile, JSON.stringify({ marks, gaps, slot, events, appLog }, null, 1));
        app.kill('SIGTERM'); server.close(); try { fs.unlinkSync(SOCK); } catch (e) { /* gone */ }
        process.exit(0);
    }, at + (script.tail || 4000));
}, 200);
