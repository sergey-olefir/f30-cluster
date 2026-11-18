#!/usr/bin/env node
'use strict';
/**
 * Research round 3, package MP: the inventory of every layout an app showed in a tools/research3/mp/measure.js run
 * (its first run): layers per connection, every asset (name, format, size, bytes on the wire, pixel memory counted
 * twice, who samples it), every image sheet (size, members, whole bytes), every shader (bytes after compact(), samplers,
 * texture reads, branches, uniforms, transcendental calls). Bench numbers that transfer to the car as they are.
 *
 *   node tools/research3/mp/inventory.js design/research3/mp/f30_cluster.json [design/research3/mp/twin_dial.json ...]
 *        [--out design/research3/mp/inventory.json] [--md <file.md>]
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const kb = (b) => (b / 1024).toFixed(0);
const mib = (b) => (b / 1048576).toFixed(2);

function inventory(run, app) {
    const out = [];
    const seen = new Set();
    run.phases.forEach((p) => {
        if (!p.builds || !p.builds.length || !p.widgets || !p.widgets.active) return;
        const name = p.widgets.active + (/night/.test(p.label) ? ' (night)' : '');
        if (seen.has(name)) return;
        seen.add(name);
        const names = {};
        Object.keys(p.widgets.atlases || {}).forEach((k) => { const a = p.widgets.atlases[k]; names[a.ci + ':' + a.ref] = k.replace(/^\d+:/, ''); });
        const refOf = (l) => l.ci + ':' + l.key.split(':')[1];
        const byKey = {};
        p.layers.forEach((l) => { byKey[l.key] = l; });
        const layers = [], assets = [];
        p.layers.forEach((l) => {
            const ref = refOf(l);
            if (l.kind === 'asset') {
                const bpp = l.format === 'r8' ? 1 : 4, bytes = l.iw * l.ih * bpp;
                assets.push({ name: names[ref] || '?', conn: l.ci + 1, format: l.format, w: l.iw, h: l.ih, wire: bytes + 19, pixelMem: bytes * 2, sampledBy: [] , key: l.key });
                return;
            }
            const w = (p.widgets.layers || {})[ref] || { ids: [], types: {} };
            const e = { conn: l.ci + 1, ref, kind: l.kind, rect: [l.x, l.y, l.w, l.h], z: l.z, widgets: w.ids, types: w.types, sheet: !!w.sheet };
            if (l.kind === 'image') { e.iw = l.iw; e.ih = l.ih; e.wire = l.iw * l.ih * 4 + 19; e.pixelMem = l.iw * l.ih * 8; }
            if (l.kind === 'effect') {
                const st = run.shaders[l.fs] || {};
                e.shader = l.fs; e.fsBytes = st.bytes; e.samplers = l.samplers;
                e.binds = {}; Object.keys(l.binds || {}).forEach((s) => { const a = byKey[l.binds[s]]; e.binds[s] = a ? (names[refOf(a)] || '?') : 'UNBOUND'; });
            }
            layers.push(e);
        });
        layers.forEach((e) => { if (e.binds) Object.keys(e.binds).forEach((s) => { const a = assets.find((x) => x.name === e.binds[s] && x.conn === e.conn); if (a) a.sampledBy.push(e.widgets[0] + '.' + s); }); });
        const perConn = {};
        layers.forEach((e) => { perConn[e.conn] = (perConn[e.conn] || 0) + 1; });
        const assetsPerConn = {};
        assets.forEach((a) => { assetsPerConn[a.conn] = (assetsPerConn[a.conn] || 0) + 1; });
        const shaders = {};
        layers.filter((e) => e.shader).forEach((e) => { const s = shaders[e.shader] || (shaders[e.shader] = Object.assign({ used: [] }, run.shaders[e.shader])); s.used.push(e.widgets.join('+') + ' ' + e.rect[2] + 'x' + e.rect[3]); });
        const sheets = layers.filter((e) => e.kind === 'image');
        // overdraw: how many layers (whole rects, transparent pixels included: the compositor blends every rect) cover each
        // panel pixel, on a 4 px grid
        const G = 4, gw = 1920 / G, gh = 720 / G, grid = new Uint8Array(gw * gh);
        layers.filter((e) => e.kind !== 'asset' && (p.layers.find((l) => l.ci + 1 === e.conn && l.key.split(':')[1] === e.ref.split(':')[1]) || {}).visible !== 0).forEach((e) => {
            const [x, y, w, h] = e.rect;
            for (let gy = Math.max(0, Math.floor(y / G)); gy < Math.min(gh, Math.ceil((y + h) / G)); gy++) for (let gx = Math.max(0, Math.floor(x / G)); gx < Math.min(gw, Math.ceil((x + w) / G)); gx++) grid[gy * gw + gx]++;
        });
        let sum = 0, mx = 0, ge3 = 0;
        grid.forEach((c) => { sum += c; if (c > mx) mx = c; if (c >= 3) ge3++; });
        const overdraw = { mean: +(sum / grid.length).toFixed(2), max: mx, ge3pct: +(100 * ge3 / grid.length).toFixed(1) };
        out.push({
            app, layout: name, phase: p.label,
            layersPerConn: perConn, assetsPerConn,
            layers: layers.length, effects: layers.filter((e) => e.kind === 'effect').length, images: sheets.length,
            effectPx: layers.filter((e) => e.kind === 'effect').reduce((a, e) => a + e.rect[2] * e.rect[3], 0),
            imagePx: sheets.reduce((a, e) => a + e.rect[2] * e.rect[3], 0),
            sheetWire: sheets.reduce((a, e) => a + e.wire, 0), sheetPixelMem: sheets.reduce((a, e) => a + e.pixelMem, 0),
            assetWire: assets.reduce((a, x) => a + x.wire, 0), assetPixelMem: assets.reduce((a, x) => a + x.pixelMem, 0),
            pixelMem: p.pixAfter, overdraw,
            shaderBytes: Object.keys(shaders).reduce((a, h) => a + (shaders[h].bytes || 0) * shaders[h].used.length, 0),
            layerList: layers, assets, shaders,
        });
    });
    return out;
}

const all = [];
files.forEach((f) => {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    all.push(...inventory(j.runs[0], j.app));
});

const md = [];
all.forEach((L) => {
    md.push('### ' + L.app + ' / ' + L.layout + '\n');
    md.push('Layers ' + L.layers + ' (' + L.effects + ' effect, ' + L.images + ' image) per connection ' + JSON.stringify(L.layersPerConn) + '; assets per connection ' + JSON.stringify(L.assetsPerConn) +
        '; overdraw mean ' + L.overdraw.mean + ' max ' + L.overdraw.max + ' (' + L.overdraw.ge3pct + ' % of px under 3+ layers); effect px ' + L.effectPx + ' (' + (L.effectPx / 1382400).toFixed(2) + ' screens), image px ' + L.imagePx + '; pixel memory ' + mib(L.pixelMem) + ' MiB (assets ' + mib(L.assetPixelMem) + ', sheets ' + mib(L.sheetPixelMem) + '); wire: assets ' + kb(L.assetWire) + ' KB, sheets ' + kb(L.sheetWire) + ' KB, shader source ' + kb(L.shaderBytes) + ' KB\n');
    md.push('| asset | conn | format | size | wire KB | pixel mem KiB (x2) | sampled by |');
    md.push('|---|---|---|---|---|---|---|');
    L.assets.sort((a, b) => b.wire - a.wire).forEach((a) => md.push('| ' + a.name + ' | ' + a.conn + ' | ' + a.format + ' | ' + a.w + 'x' + a.h + ' | ' + kb(a.wire) + ' | ' + kb(a.pixelMem) + ' | ' + a.sampledBy.join(', ') + ' |'));
    md.push('');
    md.push('| layer | conn | kind | rect | widgets | shader B / samplers -> asset | sheet wire KB |');
    md.push('|---|---|---|---|---|---|---|');
    L.layerList.forEach((e) => md.push('| ' + e.ref + ' | ' + e.conn + ' | ' + e.kind + ' | ' + e.rect.join(',') + ' | ' + (e.widgets.length > 4 ? e.widgets.slice(0, 4).join(' ') + ' +' + (e.widgets.length - 4) : e.widgets.join(' ')) + ' | ' +
        (e.kind === 'effect' ? e.fsBytes + ' / ' + (Object.keys(e.binds).map((s) => s + '->' + e.binds[s]).join(' ') || '-') : '') + ' | ' + (e.wire ? kb(e.wire) : '') + ' |'));
    md.push('');
    md.push('| shader | bytes | lines | samplers | tex reads | if | for | exp/pow/trig/smoothstep | uniforms (floats) | highp | used by |');
    md.push('|---|---|---|---|---|---|---|---|---|---|---|');
    Object.keys(L.shaders).forEach((h) => { const s = L.shaders[h]; md.push('| ' + (s.head || h).slice(0, 40) + (s.style !== null ? ' STYLE ' + s.style : '') + (s.night !== null ? ' NIGHT ' + s.night : '') + ' | ' + s.bytes + ' | ' + s.lines + ' | ' + s.samplers.length + ' | ' + s.texReads + ' | ' + s.ifs + ' | ' + s.loops + ' | ' + s.exp + '/' + s.pow + '/' + s.trig + '/' + s.smoothstep + ' | ' + s.uniforms + ' (' + s.uniformFloats + ') | ' + (s.highp ? 'y' : 'n') + ' | ' + s.used.join('; ') + ' |'); });
    md.push('');
});
const text = md.join('\n');
if (opt('--md')) fs.writeFileSync(opt('--md'), text + '\n'); else console.log(text);
if (opt('--out')) { fs.writeFileSync(opt('--out'), JSON.stringify(all, null, 1)); console.log('written ' + opt('--out')); }
