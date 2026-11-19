'use strict';
/**
 * test-r8-guard.js - r1120 T2 (docs/r1120/T2-REPORT.md): Twin Dial's figures drift. The engine's R8 guard, the audit of every R8
 * asset and every in-place write on every path, and the car's diagnosis lines.
 *
 *   node bench/test-r8-guard.js [--static]          (BENCH_PORT for part 4, default 8922; this agent's ports are 8920-8929)
 *
 * On the car an R8 texture whose rows are not whole 4-byte rows was drawn as if they were (GL, TX: Twin Dial 0.1.3's 1066-wide
 * td_big atlas, f30's 670-wide @r8 dials). The guard (shared/hud.js HudApp._r8Wrap, round every connection's asset() and pixels())
 * makes that impossible from now on. Checks
 *   1. the guard on a real client (cluster_render_client.js, not connected): on the bench (HUD_CLUSTER_SOCKET, or config.r8Guard
 *      "assert") an unaligned R8 asset or rect THROWS and nothing is sent; on the car ("pad") the asset gets zero columns up to the
 *      next multiple of 4 and its whole writes are padded row by row, a rect gets whole 4-texel columns with its neighbours' texels,
 *      several rects in one call each read what the one before wrote; every texel is what a tight upload would have left; the
 *      0.1.3 layout of GL's car test (r8Legacy) is the one exemption, logged; RGBA image writes are counted, never changed;
 *   2. the engine round it: a scene texture the guard pads has its box uniform grown to match (sx, as an ETC2 one's); a plain
 *      glyph atlas whose cell is too wide for fewer columns gets a wider cell instead; a "gpu" text with no aligned atlas row is
 *      drawn as an image text; the digest of cluster-render's status (its asset lines against ours, a failed write a warning);
 *   3. the files: every R8 scene texture of every app has whole 4-byte rows, every shipped "gpu" text's atlas too;
 *   4. on the bench: Twin Dial through every path - the start, the gear and the speed, every tab, a message (BMW's panel and our
 *      card), night, the map window W2 / W3 / W1, CarPlay's turns (test mode), the vehicle ahead (test mode), GL's "атлас 0.1.3"
 *      and back - with the trace on: per path, every asset made after the first scene, every R8 write in place and every image
 *      rect; no R8 asset or rect off whole 4-byte rows but in GL's legacy step; no assertion of the guard; and the diagnosis lines
 *      (each R8 asset made, GL's in-place line continued, the gpu text cell lines, the digest, the Діагностика mark).
 * 1-3 Node 8 or newer; 4 Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./twin-harness');

const ROOT = H.ROOT;
let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const throws = (fn) => { try { fn(); return null; } catch (e) { return String(e && e.message || e); } };

// one tree per app (the kit's layout: shared/*.js, kit -> kit/runtime, hud -> the app's hud/), with a scene file of our own beside
// the app's (the guard's pad of a scene texture: no shipped file is unaligned)
const dir = H.tree('twin_dial');
{
    const sc = path.join(dir, 'hud', 'scene'), own = path.join(ROOT, 'apps', 'twin_dial', 'hud', 'scene');
    fs.unlinkSync(sc);
    fs.mkdirSync(sc);
    fs.readdirSync(own).forEach((f) => fs.symlinkSync(path.join(own, f), path.join(sc, f)));
    const odd = Buffer.alloc(6 * 2);
    for (let i = 0; i < odd.length; i++) odd[i] = 10 + i;
    fs.writeFileSync(path.join(sc, 't2_odd.json'), JSON.stringify({ format: 'r8', w: 6, h: 2, r8: odd.toString('base64') }));
}
const HudApp = require(path.join(dir, 'hud.js'));
const { ClusterRender } = require(path.join(dir, 'cluster_render_client.js'));

/** A HudApp with just what the guard reads, its log kept; config.r8Guard as given. */
function hud(guard, extra) {
    const logs = [];
    const h = Object.create(HudApp.prototype);
    Object.assign(h, { config: Object.assign({ r8Guard: guard }, extra || {}), target: 'panel', clients: [], atlases: new Map(), widgets: new Map(), sheets: [],
        log: { info: (m) => logs.push(m), warn: (m) => logs.push('WARN ' + m), error: (m) => logs.push('ERROR ' + m) } });
    h._guard = (what, fn) => { try { fn(); } catch (e) { logs.push('GUARD ' + what + ': ' + (e && e.message)); } };
    h.logs = logs;
    return h;
}
/** A real client, never connected, with the guard round it (as _clientAt does). */
function client(h, name, ci) {
    const c = new ClusterRender(name || 'twin_dial', '/nonexistent/t2.sock');
    h.clients[ci || 0] = c;
    h._r8Wrap(c, ci || 0);
    return c;
}
const ramp = (w, h, k) => { const b = Buffer.alloc(w * h); for (let i = 0; i < b.length; i++) b[i] = (i * (k || 7) + 3) & 255; return b; };
/** What a tight upload leaves: the texture's texels as the app means them (w x h, rects put in order). */
function tight(w, h, whole, rects) {
    const t = Buffer.from(whole);
    rects.forEach((e) => { for (let y = 0; y < e.r.h; y++) e.px.copy(t, (e.r.y + y) * w + e.r.x, y * e.r.w, (y + 1) * e.r.w); });
    return t;
}
/** The client's texels of an asset, cropped to w columns (a padded asset's extra columns are not part of the picture). */
function texels(c, ref, w) {
    const l = c.layers.get(ref), out = Buffer.alloc(w * l.ih);
    for (let y = 0; y < l.ih; y++) l.image.copy(out, y * w, y * l.iw, y * l.iw + w);
    return out;
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
console.log('1. the guard on a real client');
{
    // the bench: an assertion, nothing sent
    const h = hud('assert'), c = client(h);
    const e1 = throws(() => c.asset({ target: 'panel', format: 'r8', w: 1066, h: 70, r8Name: 'gpu text atlas td_big' }));
    ok(!!e1 && /R8 guard: asset \(gpu text atlas td_big\) 1066x70, rows of 1066 bytes: not whole 4-byte rows/.test(e1) && c.layers.size === 0,
        'bench: an R8 asset 1066 wide throws and is never made (' + e1 + ')');
    const ref = c.asset({ target: 'panel', format: 'r8', w: 1148, h: 70 });
    ok(ref > 0 && c.layers.get(ref).iw === 1148, 'bench: 1148 wide (whole 4-byte rows) is made as asked');
    const base = ramp(1148, 70);
    ok(c.pixels(ref, null, base) === true, 'bench: its whole write goes');
    const before = Buffer.from(c.layers.get(ref).image);
    const e2 = throws(() => c.pixels(ref, [{ x: 902, y: 0, w: 41, h: 70 }], ramp(41, 70, 3)));
    ok(!!e2 && /rect 902,0 41x70 into asset \d+/.test(e2) && c.layers.get(ref).image.equals(before) && !c.layers.get(ref).dirty.length,
        'bench: a 41-wide rect at x 902 throws; not a texel changed, nothing queued');
    ok(c.pixels(ref, [{ x: 900, y: 0, w: 44, h: 70 }], ramp(44, 70, 5)) === true, 'bench: a rect of whole 4-texel columns goes');
    const e3 = throws(() => c.asset({ target: 'panel', format: 'rgba8', w: 1066, h: 70 }));
    ok(!e3, 'bench: RGBA assets are not the guard\'s (rows of 4 bytes a texel are always whole)');
    ok(h.logs.some((m) => /^WARN R8 guard: asset .*\(an assertion on the bench\)$/.test(m)), 'bench: the assertion is logged too');
}
{
    // the car: logged and padded
    const h = hud('pad'), c = client(h, 'twin_dial_2', 1);
    const ref = c.asset({ target: 'panel', format: 'r8', w: 1066, h: 70, sampling: 'nearest', r8Name: 'gpu text atlas td_big' });
    const l = c.layers.get(ref);
    ok(ref > 0 && l.iw === 1068 && l.opts.w === 1068 && c._layerMsg(ref, l).w === 1068, 'car: 1066 wide is made 1068 wide (the asset message says 1068)');
    ok(h.logs.some((m) => m === 'WARN R8 guard [connection 2]: asset (gpu text atlas td_big) 1066x70, rows of 1066 bytes: not whole 4-byte rows, padded to whole 4-texel columns (fault 1)'),
        'car: one warning, numbers and our own name');
    ok(h.logs.some((m) => /^r8 asset \d+ on connection 2 \(gpu text atlas td_big\): 1068x70, padded from 1066 \(rows of 1066 bytes\), build 0 \+\d+ ms, target not said yet$/.test(m)),
        'car: the asset\'s own line says padded from 1066');
    const base = ramp(1066, 70);
    ok(c.pixels(ref, null, base) === true && texels(c, ref, 1066).equals(base), 'car: its whole write (1066 a row) lands row by row in the 1068-wide rows');
    let pad0 = true;
    for (let y = 0; y < 70; y++) if (l.image[y * 1068 + 1066] || l.image[y * 1068 + 1067]) pad0 = false;
    ok(pad0, 'car: the two extra columns stay 0');
    l.whole = false; l.dirty = []; l.dirtyBytes = 0;        // as if the whole write had gone
    const r1 = { x: 902, y: 0, w: 41, h: 70 }, p1 = ramp(41, 70, 11);
    ok(c.pixels(ref, [r1], p1) === true, 'car: a 41-wide rect at x 902 is taken');
    ok(l.dirty.length === 1 && l.dirty[0].x === 900 && l.dirty[0].w === 44 && l.dirty[0].h === 70, 'car: it goes as 900,0 44x70 (' + JSON.stringify(l.dirty) + ')');
    ok(texels(c, ref, 1066).equals(tight(1066, 70, base, [{ r: r1, px: p1 }])), 'car: every texel is what a tight upload leaves (its neighbours as they were)');
    // several rects in one call, the second widened over the first
    const r2 = { x: 1, y: 3, w: 2, h: 4 }, p2 = ramp(2, 4, 13), r3 = { x: 3, y: 2, w: 2, h: 4 }, p3 = ramp(2, 4, 17);
    const was = Buffer.from(texels(c, ref, 1066));
    ok(c.pixels(ref, [r2, r3], Buffer.concat([p2, p3])) === true, 'car: two rects 1,3 2x4 and 3,2 2x4 in one call are taken');
    ok(texels(c, ref, 1066).equals(tight(1066, 70, was, [{ r: r2, px: p2 }, { r: r3, px: p3 }])), 'car: both land; the second (widened to 0..8) keeps the first one\'s new texels');
    ok(l.dirty.every((r) => r.x % 4 === 0 && r.w % 4 === 0), 'car: every rect queued is whole 4-texel columns (' + l.dirty.map((r) => r.x + ',' + r.y + ' ' + r.w + 'x' + r.h).join(' / ') + ')');
    ok(c.pixels(ref, [{ x: 1065, y: 0, w: 4, h: 1 }], Buffer.alloc(4)) === false, 'car: a rect outside the picture is still refused');
    ok(h.logs.filter((m) => /^WARN R8 guard/.test(m)).length === 3, 'car: one warning per fault (the asset, the two calls; the refused rect none)');
    ok(c.r8.assets.get(ref).writes === 3 && c.r8.assets.get(ref).rects === 2, 'car: the writes counted (3, 2 of them rects; the refused one not)');
    // "whole rows re-read at a 4-byte pitch" (GL's model of the car): the padded asset's rows are 1068, so it reads what was sent
    ok(l.iw % 4 === 0, 'car: under the car\'s 4-byte row pitch the padded texture reads exactly as sent');
    c.drop(ref);
    ok(!c.r8.assets.has(ref) && !c.r8.pad.has(ref), 'car: a dropped asset is forgotten by the guard too');
}
{
    // GL's car test: the one exemption
    const h = hud('assert'), c = client(h);
    const e = throws(() => c.asset({ target: 'panel', format: 'r8', w: 1066, h: 70, r8Name: 'gpu text atlas td_big', r8Legacy: true }));
    const ref = Array.from(c.layers.keys())[0], l = ref && c.layers.get(ref);
    ok(!e && l && l.iw === 1066 && !('r8Legacy' in l.opts) && !('r8Name' in l.opts), 'legacy: 1066 wide is made as 0.1.3 made it, even on the bench (the options stay ours)');
    ok(h.logs.some((m) => /^r8 asset \d+ \(gpu text atlas td_big\): 1066x70, rows of 1066 bytes, NOT whole 4-byte rows \(config\.gpuText "legacy": the car test\)/.test(m)), 'legacy: its line says so');
    c.pixels(ref, null, ramp(1066, 70)); l.whole = false;
    const e2 = throws(() => c.pixels(ref, [{ x: 902, y: 0, w: 41, h: 70 }], ramp(41, 70)));
    ok(!e2 && l.dirty.length === 1 && l.dirty[0].w === 41, 'legacy: its 41-wide rects go as they are (the car test needs them)');
}
{
    // image layers: counted, never changed
    const h = hud('assert'), c = client(h);
    const ref = c.image({ target: 'panel', x: 0, y: 0, w: 10, h: 5 });
    ok(c.pixels(ref, [{ x: 1, y: 1, w: 3, h: 2 }], Buffer.alloc(3 * 2 * 4, 9)) === true && c.layers.get(ref).dirty[0].w === 3, 'image: an RGBA rect 3 texels wide goes as it is');
    const e = c.r8.images.get(ref);
    ok(e && e.writes === 1 && e.rects === 1 && e.odd === 1, 'image: its writes are counted (1 rect, off 4-texel columns: 1)');
}
{
    // the default: the bench asserts, the car pads
    const was = process.env.HUD_CLUSTER_SOCKET;
    delete process.env.HUD_CLUSTER_SOCKET;
    const car = hud(undefined)._r8Assert();
    process.env.HUD_CLUSTER_SOCKET = '/tmp/x.sock';
    const bench = hud(undefined)._r8Assert(), forced = hud('pad')._r8Assert();
    if (was === undefined) delete process.env.HUD_CLUSTER_SOCKET; else process.env.HUD_CLUSTER_SOCKET = was;
    ok(car === false && bench === true && forced === false, 'the default: pad on the car (no HUD_CLUSTER_SOCKET), assert on the bench; config.r8Guard "pad" / "assert" decide when set');
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
console.log('2. the engine round the guard');
{
    const h = hud('pad');
    const c = client(h);
    h._clientAt = () => c;
    h.sceneUsed = null;
    const a = h._scene('t2_odd', 0), l = c.layers.get(a.ref);
    ok(l.iw === 8 && Math.abs(a.sx - 8 / 6) < 1e-9 && a.sy === 1 && a.bytes === 8 * 2 * 2, 'a 6-wide R8 scene texture (made up) is padded to 8 and its box uniform grows 8/6 (sx ' + a.sx.toFixed(4) + '), as an ETC2 one\'s');
    const want = Buffer.alloc(12);
    for (let i = 0; i < 12; i++) want[i] = 10 + i;
    ok(texels(c, a.ref, 6).equals(want), 'its texels are the file\'s, row by row');
    const hb = hud('assert'), cb = client(hb);
    hb._clientAt = () => cb;
    hb.sceneUsed = null;
    const e = throws(() => hb._scene('t2_odd', 0));
    ok(!!e && /R8 guard: asset \(scene t2_odd\) 6x2/.test(e), 'on the bench the same file is an assertion (' + e + ')');
    const ok4 = hud('assert'), c4 = client(ok4);
    ok4._clientAt = () => c4;
    ok4.sceneUsed = null;
    const f = ok4._scene('face_tacho', 0);
    ok(f.sx === 1 && c4.layers.get(f.ref).iw === 616, 'a shipped one (face_tacho, 616) is made as it is, sx 1');
}
{
    // the plain glyph atlas: a cell too wide for fewer columns gets a wider cell (a made-up font: one glyph, 601 px advance)
    const text = require(path.join(dir, 'hud_text.js'));
    const orig = text.loadFont;
    text.loadFont = (n) => (n === 't2_wide' ? { metrics: { cellHeight: 4, glyphs: { A: { advance: 601 } } } } : orig(n));
    const origMask = text.mask;
    text.mask = (w, hh) => Buffer.alloc(w * hh, 1);
    try {
        const h = hud('assert'), c = client(h);
        h._clientAt = () => c;
        const a = h._atlas('t2_wide', 0), l = c.layers.get(a.ref);
        ok(a.cols * a.cellW % 4 === 0 && l.iw % 4 === 0 && a.cellW === 604 && a.cols === 3, 'a 603-px cell (3 columns, 1809 bytes a row) becomes 604 (1812): no assertion (' + a.cols + ' x ' + a.cellW + ')');
        const hl = hud('assert', { gpuText: 'legacy' }), cl = client(hl);
        hl._clientAt = () => cl;
        const e = throws(() => hl._atlas('t2_wide', 0));
        ok(!!e && /R8 guard/.test(e), '"legacy" leaves the plain atlas as before: 1809 a row, and the guard catches it (' + e + ')');
    } finally { text.loadFont = orig; text.mask = origMask; }
}
{
    // a "gpu" text whose cell has no aligned atlas row: an image text (a made-up grid: 513-px cells, 3 a row, odd)
    const h = hud('assert');
    h._gpuTextWhy = () => null;
    h._gpuGrid = () => ({ pitch: 1026, cw: 513, h: 10, max: 1, figs: ['0'], groups: [{ x0: 0, cells: 1, lengths: [1] }] });
    const out = h._gpuTexts([{ id: 'big', type: 'text', gpu: true, font: 'td_big', x: 0, y: 0, w: 600, h: 10 }]);
    ok(out.length === 1 && out[0].type === 'text' && h.logs.some((m) => /widget "big": "gpu" ignored \(no atlas row of whole 4 bytes for 513 px cells\), drawn as an image/.test(m)),
        'a "gpu" text with 513-px cells (no row of whole 4 bytes fits 2048) is drawn as an image text, logged');
    const hl = hud('assert', { gpuText: 'legacy' });
    hl._gpuTextWhy = h._gpuTextWhy; hl._gpuGrid = h._gpuGrid;
    ok(hl._gpuTexts([{ id: 'big', type: 'text', gpu: true, font: 'td_big', x: 0, y: 0, w: 600, h: 10 }])[0].type === 'atext', '"legacy" keeps it on the GPU, as 0.1.3');
}
{
    // the digest of cluster-render's status (a status text in the car's shape; numbers made up)
    const h = hud('pad');
    const c1 = client(h, 'twin_dial', 0), c2 = client(h, 'twin_dial_2', 1);
    const a1 = c1.asset({ target: 'panel', format: 'r8', w: 616, h: 560, r8Name: 'scene face_speedo' });
    const a2 = c1.asset({ target: 'panel', format: 'r8', w: 616, h: 560, r8Name: 'scene face_tacho' });
    const g1 = c1.asset({ target: 'panel', format: 'r8', w: 1148, h: 70, r8Name: 'gpu text atlas td_big' });
    const g2 = c2.asset({ target: 'panel', format: 'r8', w: 1148, h: 70, r8Name: 'gpu text atlas td_big' });
    [a1, a2, g1].forEach((r) => c1.pixels(r, null, Buffer.alloc(c1.layers.get(r).image.length)));
    c2.pixels(g2, null, Buffer.alloc(1148 * 70));
    for (let i = 0; i < 6; i++) { c2.layers.get(g2).whole = false; c2.pixels(g2, [{ x: 820 + 4 * (i % 3), y: 0, w: 44, h: 70 }], Buffer.alloc(44 * 70)); }
    const status = ['upload: cap 5500 KB/s (ceiling 5500, floor 2000): ceiling',
        'target panel: slot 0x203 scene 0x10004f8 1920x720: shown (us); renderer subscription not observable',
        'asset 9 rgba8 1x1 of f30_cluster on panel: 1 writes, 0 KB, 0 failed',
        'asset 76 r8 616x560 of twin_dial on panel: 1 writes, 336 KB, 0 failed',
        'asset 77 r8 616x560 of twin_dial on panel: 1 writes, 336 KB, 0 failed',
        'asset 80 r8 1148x70 of twin_dial on panel: 1 writes, 78 KB, 0 failed',
        'asset 85 r8 1148x70 of twin_dial_2 on panel: 5 writes, 96 KB, 1 failed',
        'layer 122 effect of twin_dial on panel, content z 0: shown'].join('\n');
    h.logs.length = 0;
    h._r8Digest(status);
    const L = h.logs;
    ok(L[0] === 'r8 check: target shown, 4 R8 assets of ours in cluster-render\'s status', 'the digest\'s head: the target\'s state, 4 R8 assets of ours (f30\'s RGBA line ignored) (' + L[0] + ')');
    ok(L.some((m) => m === 'r8 check: asset 76 r8 616x560 of twin_dial: the service 1 writes, 0 failed; ours asset ' + a1 + ' (scene face_speedo), 1 writes (0 in place)') &&
        L.some((m) => m === 'r8 check: asset 77 r8 616x560 of twin_dial: the service 1 writes, 0 failed; ours asset ' + a2 + ' (scene face_tacho), 1 writes (0 in place)'),
        'two of one size on one connection are matched in the order they were made');
    ok(L.some((m) => m === 'r8 check: asset 85 r8 1148x70 of twin_dial_2: the service 5 writes, 1 failed; ours asset ' + g2 + ' (gpu text atlas td_big), 7 writes (6 in place)'),
        'the gear\'s atlas: the service\'s 5 writes and 1 failed beside our 7 (6 in place)');
    ok(L.some((m) => m === 'WARN r8 check: cluster-render failed 1 write into our R8 assets'), 'a failed write is a warning');
    h.logs.length = 0;
    h._r8Digest('bench: 14 layers and 5 assets on 3 connection(s)');
    ok(h.logs[0] === 'r8 check: target not in the status, 0 R8 assets of ours in cluster-render\'s status (1 lines)', 'the bench\'s one-line status: said so, nothing else');
    // which reply is the digest's: in the order asked, only while connected
    c1.ready = true;
    h._r8Want = 'digest'; c1.status(); h._r8Want = null; c1.status();
    ok(h._r8StatusKind(c1) === 'digest' && h._r8StatusKind(c1) === 'full' && h._r8StatusKind(c1) === 'full', 'replies are taken in the order asked: the digest\'s, then a whole one; an unasked one is whole');
    c1.ready = false;
    h._r8Want = 'digest'; c1.status(); h._r8Want = null;
    ok(c1.r8.statusQ.length === 0, 'not connected: nothing queued (no reply would come)');
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
console.log('3. the files');
{
    const bad = [], seen = [];
    fs.readdirSync(path.join(ROOT, 'apps')).forEach((app) => {
        const sd = path.join(ROOT, 'apps', app, 'hud', 'scene');
        if (!fs.existsSync(sd)) return;
        fs.readdirSync(sd).filter((f) => /\.json$/.test(f)).forEach((f) => {
            let j;
            try { j = JSON.parse(fs.readFileSync(path.join(sd, f), 'utf8')); } catch (e) { return; }
            if (!j || j.format !== 'r8' || !j.r8) return;
            seen.push(app + '/' + f.slice(0, -5) + ' ' + j.w);
            if (j.w % 4) bad.push(app + '/' + f + ' ' + j.w);
        });
    });
    ok(seen.length >= 5 && !bad.length, 'every R8 scene texture of every app has whole 4-byte rows (' + seen.join(', ') + ')' + (bad.length ? ' - not: ' + bad.join(', ') : ''));
    const gpu = [];
    ['twin_dial', 'f30_cluster'].forEach((app) => {
        const tree = app === 'twin_dial' ? dir : H.tree(app), HA = require(path.join(tree, 'hud.js'));
        fs.readdirSync(path.join(ROOT, 'apps', app, 'hud', 'layouts')).filter((f) => /\.json$/.test(f)).forEach((f) => {
            const lay = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', app, 'hud', 'layouts', f), 'utf8'));
            (lay.widgets || []).filter((w) => w.type === 'text' && w.gpu).forEach((w) => {
                const h = Object.create(HA.prototype), logs = [];
                Object.assign(h, { config: { r8Guard: 'assert' }, target: 'panel', clients: [], atlases: new Map(), widgets: new Map(), sceneUsed: null,
                    log: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) } });
                const c = new (require(path.join(tree, 'cluster_render_client.js')).ClusterRender)(app, '/nonexistent');
                h._r8Wrap(c, 0);
                h._clientAt = () => c;
                const e = throws(() => h._gpuTexts([w]).filter((x) => x.type === 'atext').forEach((x) => h._exactAtlas(x, 0)));
                c.layers.forEach((l) => gpu.push({ id: app + '/' + f.replace('.json', '') + '/' + w.id, w: l.iw, e }));
                if (e) gpu.push({ id: app + '/' + w.id, w: -1, e });
            });
        });
    });
    ok(gpu.length >= 3 && gpu.every((g) => !g.e && g.w % 4 === 0), 'every shipped "gpu" text\'s atlas has whole 4-byte rows (' + gpu.map((g) => g.id + ' ' + g.w).join(', ') + ')');
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
const { spawn } = require('child_process');
const PORT = Number(process.env.BENCH_PORT) || 8922;
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null, logText = '';
async function req(method, url, body) {
    for (let i = 0; i < 8; i++) {
        try {
            const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', connection: 'close' }, body: body ? JSON.stringify(body) : undefined });
            if (r.status === 200) return r.json();
            if (r.status === 204) return null;
            throw new Error(method + ' ' + url + ': ' + r.status);
        } catch (e) { if (i === 7) throw e; await sleep(400); }
    }
    return null;
}
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await req('GET', '/probe'); if (fn(p)) return p; } catch (e) { /* (re)starting */ }
        await sleep(150);
    }
    return p;
}
async function stop() {
    if (!server) return;
    const s = server;
    server = null;
    await new Promise((r) => { s.once('exit', r); s.kill('SIGTERM'); setTimeout(r, 5000); });
}
const appLines = () => logText.split('\n').filter((l) => /\[twin_dial\]/.test(l));

/** The trace, read back: per step (by its time window) the assets made, the R8 writes, the image layers and their rects. */
function audit(file, steps) {
    const L = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.dir === 'in');
    const kinds = new Map();             // conn:ref -> { kind, format, w, h }
    const rows = steps.map((s) => ({ name: s.name, t0: s.t0, t1: s.t1, assets: [], r8Whole: 0, r8Rects: [], images: 0, imgRects: 0, imgOdd: 0, layers: 0, drops: 0 }));
    const at = (t) => rows.find((r) => t >= r.t0 && t < r.t1) || null;
    L.forEach((e) => {
        const k = e.conn + ':' + e.ref, r = at(e.t);
        if (e.op === 'asset') { kinds.set(k, { kind: 'asset', format: e.format, w: e.w, h: e.h }); if (r) r.assets.push({ conn: e.conn, format: e.format, w: e.w, h: e.h }); }
        else if (e.op === 'layer') { kinds.set(k, { kind: e.kind, w: e.iw || e.w, h: e.ih || e.h }); if (r) { r.layers++; if (e.kind === 'image') r.images++; } }
        else if (e.op === 'drop') { if (r) r.drops++; }
        else if (e.op === 'frame' && r) {
            const d = kinds.get(k) || {};
            if (e.kind === 'asset' && d.format === 'r8') {
                if (e.whole) r.r8Whole++;
                else e.rects.forEach((x) => r.r8Rects.push({ x: x[0], y: x[1], w: x[2], h: x[3], aw: d.w }));
            } else if (e.kind === 'image' && !e.whole) {
                r.imgRects += e.rects.length;
                r.imgOdd += e.rects.filter((x) => x[0] % 4 || x[2] % 4).length;
            }
        }
    });
    return rows;
}

async function live() {
    console.log('4. on the bench: Twin Dial through every path (port ' + PORT + ')');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r8-guard-')), data = path.join(tmp, 'data');
    fs.mkdirSync(data);
    const trace = path.join(tmp, 'trace.jsonl');
    const env = Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: data, BENCH_TRACE: trace, BENCH_LAYER_CAP: '8', SCREEN_DIR: path.join(tmp, 'screen') });
    delete env.BENCH_CONFIG;
    server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'twin_dial'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', (d) => { logText += d; });
    server.stderr.on('data', (d) => { logText += d; });
    const steps = [];
    let cur = null;
    const step = (name) => { const t = Date.now(); if (cur) cur.t1 = t; cur = { name, t0: t, t1: Infinity }; steps.push(cur); };
    const set = (key, value) => req('POST', '/setting', { key, value });
    const fake = (v) => req('POST', '/fake', v);
    const sig = (values) => req('POST', '/signals', { mode: 'manual', values });
    step('start (the first scene)');
    let p = await until((q) => q && q.ready && q.activeName, 90000);
    ok(p && p.ready, 'the app runs');
    await sleep(3000);
    const drive = { speed: 0, rpm: 800, gear: 0, coolant: 90, ambient: 12, fuelL: 40, range: 450 };
    await sig(drive);
    await fake({ scene: 'car-rest' });
    await sleep(1500);

    step('the gear and the speed');
    const gears = [[0], [1], [2], [3], [0], [1, 'S'], [2, 'S'], [3, 'M'], [4, 'M'], [1], [5], [6], [7], [8], [0]];
    for (const g of gears) { await sig(Object.assign({}, drive, { gear: g[0], program: g[1] || null, speed: g[0] * 17 })); await sleep(350); }
    for (const s of [0, 7, 42, 99, 100, 187, 0]) { await sig(Object.assign({}, drive, { speed: s, gear: s ? 3 : 0 })); await sleep(300); }
    await sleep(800);

    step('every tab');
    for (const t of ['1', '2', '3', '4', '5', 'auto']) { await set('tab', t); await sleep(700); }
    for (const g of [[1], [0]]) { await sig(Object.assign({}, drive, { gear: g[0] })); await sleep(400); }

    step('a message (the door)');
    await fake({ scene: 'car-door' });
    await sleep(2500);
    await sig(Object.assign({}, drive, { gear: 2 }));
    await sleep(500);
    await fake({ scene: 'car-door-closing' });
    await sleep(800);
    await fake({ scene: 'car-rest' });
    await sleep(1500);

    step('night');
    await set('nightLook', 'on');
    await sleep(2000);
    for (const g of [[1], [0]]) { await sig(Object.assign({}, drive, { gear: g[0] })); await sleep(400); }
    await set('nightLook', 'off');
    await sleep(1500);
    await set('nightLook', 'auto');
    await sleep(1000);

    step('the map window W2 / W3 / W1');
    await set('diagMapForce', true);
    for (const w of ['W2', 'W3', 'W1']) {
        await set('diagMapWindow', w);
        await sleep(2000);
        for (const g of [[1], [0]]) { await sig(Object.assign({}, drive, { gear: g[0] })); await sleep(400); }
    }
    await set('diagMapWindow', 'off');
    await sleep(1200);
    await set('diagMapForce', false);
    await sleep(1500);

    step('CarPlay\'s turns (test mode)');
    await set('diagCarplayTurns', true);
    await fake({ twin: { guiding: 'ACTIVE' } });
    await fake({ feed: { iface: 'de.bmw.infotainment.navigation.guiding.Guidance', field: 'guidingProvider', value: 'CAR_PLAY' } });
    await set('tab', '5');
    await sleep(5000);
    await sig(Object.assign({}, drive, { gear: 3, speed: 50 }));
    await sleep(800);
    await fake({ feed: { iface: 'de.bmw.infotainment.navigation.guiding.Guidance', field: 'guidingProvider', value: 'NONE' } });
    await fake({ twin: { guiding: 'INACTIVE' } });
    await set('diagCarplayTurns', false);
    await set('tab', 'auto');
    await sleep(1500);

    step('the vehicle ahead (test mode)');
    await set('diagFrontVehicle', true);
    await sleep(2500);
    for (const s of ['fv-far', 'fv-mid', 'fv-near', 'fv-none']) { await fake({ scene: s }); await sleep(900); }
    await sig(Object.assign({}, drive, { gear: 1, speed: 20 }));
    await sleep(500);
    await set('diagFrontVehicle', false);
    await sleep(2000);

    step('GL\'s "атлас 0.1.3" (legacy) and back');
    await set('diagGpuText', 'legacy');
    await sleep(2500);
    for (const g of [[1], [2], [0]]) { await sig(Object.assign({}, drive, { gear: g[0] })); await sleep(400); }
    await set('diagGpuText', 'off');
    await sleep(2500);

    step('the mark, and the digest after it');
    for (const g of [[1], [3], [0]]) { await sig(Object.assign({}, drive, { gear: g[0] })); await sleep(400); }
    await set('diagR8Mark', true);
    await sleep(R8_DIGEST_WAIT);
    cur.t1 = Date.now() + 1;

    const rows = audit(trace, steps);
    console.log('     ' + ['path', 'assets made (format WxH)', 'R8 whole', 'R8 rects (widths)', 'layers', 'image rects (off 4)'].join(' | '));
    rows.forEach((r) => console.log('     ' + [r.name, r.assets.map((a) => a.format + ' ' + a.w + 'x' + a.h).join(', ') || '-', r.r8Whole, r.r8Rects.length + (r.r8Rects.length ? ' (' + Array.from(new Set(r.r8Rects.map((x) => x.w))).join('/') + ')' : ''),
        r.layers, r.imgRects + ' (' + r.imgOdd + ')'].join(' | ')));
    fs.writeFileSync(path.join(tmp, 'audit.json'), JSON.stringify(rows, null, 1));
    fs.writeFileSync(path.join(tmp, 'bench.log'), logText);
    console.log('     (the table: ' + path.join(tmp, 'audit.json') + ')');
    const legacy = rows.find((r) => /legacy/.test(r.name)), others = rows.filter((r) => r !== legacy);
    const badA = [], badR = [];
    others.forEach((r) => {
        r.assets.filter((a) => a.format === 'r8' && a.w % 4).forEach((a) => badA.push(r.name + ': ' + a.w + 'x' + a.h));
        r.r8Rects.filter((x) => x.x % 4 || x.w % 4).forEach((x) => badR.push(r.name + ': ' + x.x + ',' + x.y + ' ' + x.w + 'x' + x.h));
    });
    ok(!badA.length, 'every path but GL\'s legacy step: every R8 asset made has whole 4-byte rows' + (badA.length ? ' - not: ' + badA.join('; ') : ''));
    ok(!badR.length, 'every path but GL\'s legacy step: every R8 rect written in place starts and ends on 4-texel columns' + (badR.length ? ' - not: ' + badR.slice(0, 5).join('; ') : ''));
    const total = others.reduce((n, r) => n + r.r8Rects.length, 0), late = others.slice(1).reduce((n, r) => n + r.assets.filter((a) => a.format === 'r8').length, 0);
    ok(total > 10, 'R8 rects written in place on the way: ' + total + ' (the gear\'s letters)');
    console.log('     R8 assets made after the first scene (outside the legacy step): ' + late);
    ok(legacy && legacy.assets.some((a) => a.format === 'r8' && a.w === 1066) && legacy.r8Rects.some((x) => x.w === 41), 'the legacy step: 0.1.3\'s 1066-wide atlases and 41-wide rects, exempted');
    const lines = appLines();
    const guard = lines.filter((l) => /R8 guard( \[connection \d\])?: /.test(l));
    ok(!guard.length, 'no assertion of the guard on any path' + (guard.length ? ': ' + guard.slice(0, 2).join(' | ') : ''));
    ok(!(logText.match(/protocol \[[^\]]*\]: [^\n]*/g) || []).length, 'no protocol error');
    ok(lines.some((l) => /r8 asset \d+ \(gpu text atlas td_big\): 1148x70, whole 4-byte rows, build 1 \+\d+ ms, target /.test(l)) &&
        lines.some((l) => /r8 asset \d+ \(scene face_tacho\): 616x560, whole 4-byte rows, build 1/.test(l)), 'diagnosis: one line per R8 asset made (size, rows, build, target)');
    ok(lines.some((l) => /r8 asset \d+ on connection \d \(gpu text atlas td_big\): 1066x70, rows of 1066 bytes, NOT whole 4-byte rows \(config\.gpuText "legacy": the car test\), build \d+/.test(l)),
        'diagnosis: the legacy atlas\'s line says it is the exemption');
    ok(lines.some((l) => /gpu text atlas "td_big" on connection \d: cell \d+ written in place, rect \d+,0 44x70, write \d+, asset \d+ for "gear(#2)?", \d+\.\d s after the atlas was made, build \d+, target \w+/.test(l)),
        'diagnosis: GL\'s in-place line goes on: the asset, the widget, the time, the build, the target, the socket');
    ok(lines.some((l) => /gpu text "gear(#2)?" on connection \d: shows \d+ cells, \d+ written in place: \d+ \(write \d+, \d+\.\d s ago\)/.test(l)) &&
        lines.some((l) => /gpu text "gear(#2)?" on connection \d: shows \d+ cells, none written in place/.test(l)), 'diagnosis: a gpu text\'s cells written in place, when they come and go');
    ok(lines.some((l) => /r8 check: target not in the status, 0 R8 assets of ours in cluster-render's status \(1 lines\)/.test(l)), 'diagnosis: the digest after in-place writes (the bench\'s status has no asset lines)');
    const mark = lines.filter((l) => / r8 mark 1: /.test(l));
    ok(mark.some((l) => /r8 mark 1: build \d+, \d+\.\d s after it; target 1 [\w ]+, 2 [\w ]+, 3 [\w ]+; R8 guard faults 0$/.test(l)) && mark.some((l) => /r8 mark 1: asset \d+ on connection 2 \(gpu text atlas td_big\): 1148x70, made in build \d+/.test(l)) &&
        mark.some((l) => /r8 mark 1: gpu text "speed", layer \d+, atlas asset \d+: cells/.test(l)) && mark.some((l) => /r8 mark 1: image \d+/.test(l)),
        'the mark: the build and targets, each R8 asset, each gpu text\'s cells, each image layer (' + mark.length + ' lines)');
    const after = logText.slice(logText.indexOf('r8 mark 1:'));
    ok(/cluster-render status: bench: /.test(after), 'the mark asks for cluster-render\'s whole status');
    // privacy: the diagnosis lines carry numbers, our own names and widget ids only
    const ids = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'hud', 'layouts', 'twin.json'), 'utf8')).widgets.map((w) => w.id));
    const quoted = [];
    lines.filter((l) => /r8 (asset|mark|check)|gpu text "|R8 guard/.test(l)).forEach((l) => (l.match(/"[^"]*"/g) || []).forEach((q) => quoted.push(q.slice(1, -1))));
    const odd = quoted.filter((q) => !ids.has(q.replace(/#\d+$/, '')) && !/^td_\w+$/.test(q) && q !== 'legacy');
    ok(quoted.length > 0 && !odd.length, 'the lines quote widget ids and font names only (' + Array.from(new Set(quoted)).join(', ') + ')' + (odd.length ? ' - not: ' + odd.join(', ') : ''));
    p = await req('GET', '/probe');
    ok(p && p.ready, 'the app is still up');
    await stop();
}
const R8_DIGEST_WAIT = 4500;

(process.argv.indexOf('--static') >= 0 || typeof fetch !== 'function' ? Promise.resolve(console.log('4. on the bench: skipped (--static or no fetch)')) : live())
    .catch((e) => { failed++; console.log('  FAIL the bench run: ' + (e && e.stack || e)); })
    .then(() => stop())
    .then(() => {
        console.log('\n' + passed + ' passed, ' + failed + ' failed');
        process.exit(failed ? 1 : 0);
    });
