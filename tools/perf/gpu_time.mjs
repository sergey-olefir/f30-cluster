// Bench-only GPU timing for docs/PERF-AUDIT.md: times each effect layer's real fragment shader, with the
// uniforms and textures the app sent, in the bench page's WebGL, in a Chrome that is already running with
// --remote-debugging-port=<cdpPort> (its own --user-data-dir). The bench page is served unchanged by the bench;
// this script rewrites it in flight (DevTools Fetch) to expose its closure as window.__perf, nothing on disk.
//
//   node tools/perf/gpu_time.mjs <cdpPort> <benchPort> <out.json> [label] [draws]
//
// Per effect layer: ms per full draw of its rect (draws back to back into the page's GL canvas, then a 1-pixel
// readPixels to wait for the GPU), and the same for a one-line shader over the same rect (the fill floor).
// Also the whole frame: every visible layer drawn in stack order. What this is NOT: the car's GPU. The numbers
// rank the layers and layouts against each other; docs/PERF-AUDIT.md says how far that carries.
import fs from 'node:fs';
const [cdpPort, benchPort, out, label = 'run', drawsArg = '40'] = process.argv.slice(2);
const DRAWS = +drawsArg;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BENCH = `http://localhost:${benchPort}/`;

let tabs = [];
for (let i = 0; i < 40; i++) {
  try { tabs = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json(); if (tabs.find((t) => t.type === 'page')) break; } catch (e) { /* not up yet */ }
  await sleep(500);
}
const tab = tabs.find((t) => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map(); const handlers = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) handlers.forEach((h) => h(m));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

const page = await (await fetch(BENCH)).text();
const END = '\n})();\n</script>';
if (page.lastIndexOf(END) < 0) { console.error('bench page layout changed: no IIFE end'); process.exit(1); }
const at = page.lastIndexOf(END);
const patched = page.slice(0, at) + '\n  window.__perf = { get scene() { return scene; }, drawEffect, gl, images, glCanvas, compile };' + page.slice(at);
handlers.push(async (m) => {
  if (m.method !== 'Fetch.requestPaused') return;
  await send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: Buffer.from(patched).toString('base64') });
});
await send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Response' }] });   // the page only (in CDP patterns '?' is a wildcard)
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1100, deviceScaleFactor: 1, mobile: false });
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: BENCH + '?only=1&clean=1&car=0' });
await sleep(9000);   // the event stream replays every layer, its uniforms and asset pixels

const fn = `(async () => {
  const P = window.__perf; if (!P) return { error: 'no __perf' };
  const gl = P.gl, N = ${DRAWS};
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const FLOOR = 'precision mediump float; varying vec2 v_uv; void main(){ gl_FragColor = vec4(v_uv, 0.0, 1.0); }';
  const layers = P.scene.filter((l) => l.kind === 'effect' && l.visible !== false && l.state !== 'waiting');
  const time = (l, fs) => {
    const L = Object.assign({}, l, fs ? { fs } : {});
    if (!P.drawEffect(L, 1000)) return null;       // sets program, uniforms, textures; returns null if not drawn
    // blended, as the compositor draws a layer (and so a tile-based GPU cannot drop the hidden repeats)
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    sync();
    const t0 = performance.now();
    for (let i = 0; i < N; i++) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    sync();
    gl.disable(gl.BLEND);
    return (performance.now() - t0) / N;
  };
  const rows = [];
  for (const l of layers) {
    time(l); // warm
    const ms = [time(l), time(l), time(l)].filter((x) => x !== null).sort((a, b) => a - b)[1];
    const floor = [time(l, FLOOR), time(l, FLOOR), time(l, FLOOR)].sort((a, b) => a - b)[1];
    rows.push({ conn: l.conn, ref: l.ref, x: l.x, y: l.y, w: l.w, h: l.h, px: l.w * l.h, fsLen: l.fs.length, ms, floor,
      head: (l.fs.match(/^\\s*\\/\\/[^\\n]*/) || [''])[0].slice(0, 90) });
  }
  return { renderer, draws: N, rows };
})()`;
const r = await send('Runtime.evaluate', { expression: fn, awaitPromise: true, returnByValue: true });
const res = r.result && r.result.result ? r.result.result.value : r;
res.label = label;
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(label, res.renderer, (res.rows || []).map((x) => `${x.conn}:${x.ref} ${x.w}x${x.h} ${x.ms && x.ms.toFixed(3)}ms (floor ${x.floor && x.floor.toFixed(3)})`).join('\n  '));
ws.close();
process.exit(0);
