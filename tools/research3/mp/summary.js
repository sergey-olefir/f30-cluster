#!/usr/bin/env node
'use strict';
/**
 * Research round 3, package MP: one table per app from tools/research3/mp/measure.js's JSON, every phase across all runs
 * (min..max where the runs differ): bytes on the wire, pixel bytes (what the upload budget paces), builds, layers made /
 * dropped, assets made, the pixel-memory peak, the time to the final complete frame at the budget's floor and ceiling,
 * the bench's own build time and the app's rebuild JS, and in steady phases messages and bytes a second.
 *
 *   node tools/research3/mp/summary.js design/research3/mp/f30_cluster.json [design/research3/mp/twin_dial.json] [--md out.md]
 */
const fs = require('fs');
const args = process.argv.slice(2);
const mdOut = args.indexOf('--md') >= 0 ? args[args.indexOf('--md') + 1] : null;
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--md');
const range = (xs, f) => {
    const v = xs.filter((x) => x !== null && x !== undefined && isFinite(x));
    if (!v.length) return '-';
    const lo = Math.min(...v), hi = Math.max(...v), s = (x) => (f ? f(x) : String(x));
    return s(lo) === s(hi) ? s(lo) : s(lo) + '..' + s(hi);
};
const kb = (b) => (b / 1024).toFixed(0);
const mib = (b) => (b / 1048576).toFixed(2);
const out = [];
files.forEach((f) => {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    out.push('#### ' + j.app + ' (' + j.runs.length + ' runs, Node ' + j.node + ', steady ' + j.steadyMs / 1000 + ' s)\n');
    out.push('| phase | builds | layers made/dropped | assets made (KB) | bytes KB | pixel KB | final complete: px KB, s at 2000 / 5500 KB/s | pixel mem peak -> after MiB | bench build ms | app rebuild JS ms | steady msgs/s, B/s |');
    out.push('|---|---|---|---|---|---|---|---|---|---|---|');
    j.runs[0].phases.forEach((p0, i) => {
        const ps = j.runs.map((r) => r.phases[i]).filter((p) => p && p.label === p0.label);
        const fc = (p) => p.finalComplete || p.firstComplete;
        const st = (p) => {
            if (p.kind !== 'steady') return null;
            const k = Object.keys(p.rates);
            return [k.reduce((a, x) => a + p.rates[x].perS, 0), k.reduce((a, x) => a + p.rates[x].Bps, 0)];
        };
        out.push('| ' + p0.label + ' | ' + range(ps.map((p) => p.builds.length)) + (ps.some((p) => p.builds.some((B) => !B.valid)) ? ' (' + range(ps.map((p) => p.builds.filter((B) => !B.valid).length)) + ' torn down)' : '') +
            ' | ' + range(ps.map((p) => p.layersMade)) + '/' + range(ps.map((p) => p.layersDropped)) +
            ' | ' + range(ps.map((p) => p.assetsMade)) + ' (' + range(ps.map((p) => p.assetBytes), kb) + ')' +
            ' | ' + range(ps.map((p) => p.bytes), kb) + ' | ' + range(ps.map((p) => p.pxWhole + p.pxRects), kb) +
            ' | ' + (fc(p0) ? range(ps.map((p) => fc(p) && fc(p).px), kb) + ', ' + range(ps.map((p) => fc(p) && fc(p).atFloorS)) + ' / ' + range(ps.map((p) => fc(p) && fc(p).atCeilingS)) : '-') +
            ' | ' + range(ps.map((p) => p.pixPeak), mib) + ' -> ' + range(ps.map((p) => p.pixAfter), mib) +
            ' | ' + (p0.builds.length ? range(ps.map((p) => { const B = p.builds[p.builds.length - 1]; return B && B.ms; }), (x) => x.toFixed(0)) : '-') +
            ' | ' + (p0.rebuilds.length ? range(ps.map((p) => p.rebuilds.reduce((a, r) => a + r.ms, 0)), (x) => x.toFixed(0)) : '-') +
            ' | ' + (p0.kind === 'steady' ? range(ps.map((p) => st(p)[0]), (x) => x.toFixed(1)) + ', ' + range(ps.map((p) => st(p)[1]), (x) => x.toFixed(0)) : '') + ' |');
    });
    const rs = j.runs.map((r) => r.resent.reduce((a, x) => a + x.wasted, 0));
    out.push('\nIdentical whole pixels sent again over the whole run: ' + range(rs, kb) + ' KB (' + range(j.runs.map((r) => r.resent.length)) + ' distinct images).\n');
});
const text = out.join('\n');
if (mdOut) fs.writeFileSync(mdOut, text + '\n');
console.log(text);
