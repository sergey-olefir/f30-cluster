'use strict';
/**
 * scene-png.js (SU1) - plays ui/scene.js's display list on kit/runtime/canvas.js (pure JS, no native canvas)
 * and writes PNG frames, so the scene can be looked at without a browser.
 *
 *   node tools/cruise-sim/tests/scene-png.js [outDir] [resultFile.json]
 *
 * Without a result file it renders SU1's fake run (ui/fake-result.js). Default outDir:
 * bake/work/cruise-sim/su1-frames/ (git-ignored). Text uses the kit's baked fonts, so it looks a little
 * different from the browser's system font; the geometry is the same list.
 */
const fs = require('fs');
const path = require('path');
const { Canvas } = require('../../../kit/runtime/canvas.js');
const scene = require('../ui/scene.js');
const A = require('../ui/app.js');

function dashed(cv, x1, y1, x2, y2, lw, color, dash) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (!dash || !len) { cv.line(x1, y1, x2, y2, lw, color); return; }
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    let d = 0, on = true, k = 0;
    while (d < len) {
        const seg = Math.min(dash[k % dash.length], len - d);
        if (on) cv.line(x1 + ux * d, y1 + uy * d, x1 + ux * (d + seg), y1 + uy * (d + seg), lw, color);
        d += seg; on = !on; k++;
    }
}

/** ops (CSS px) -> a kit Canvas at `scale` device pixels per CSS px. */
function render(ops, W, H, scale) {
    const S = scale || 2, cv = new Canvas(Math.round(W * S), Math.round(H * S));
    for (const p of ops) {
        switch (p.k) {
        case 'rect':
            if (p.r > 0) cv.roundRect(p.x * S, p.y * S, p.w * S, p.h * S, p.r * S, p.fill);
            else cv.fillRect(p.x * S, p.y * S, p.w * S, p.h * S, p.fill);
            break;
        case 'srect': {
            const x = p.x * S, y = p.y * S, w = p.w * S, h = p.h * S, lw = p.lw * S, d = p.dash && p.dash.map((v) => v * S);
            dashed(cv, x, y, x + w, y, lw, p.color, d); dashed(cv, x + w, y, x + w, y + h, lw, p.color, d);
            dashed(cv, x + w, y + h, x, y + h, lw, p.color, d); dashed(cv, x, y + h, x, y, lw, p.color, d);
            break;
        }
        case 'line': dashed(cv, p.x1 * S, p.y1 * S, p.x2 * S, p.y2 * S, p.lw * S, p.color, p.dash && p.dash.map((v) => v * S)); break;
        case 'poly': cv.convex(p.pts.map((q) => [q[0] * S, q[1] * S]), p.fill); break;
        case 'circle': cv.circle(p.x * S, p.y * S, p.r * S, p.fill); break;
        case 'text': cv.text(p.s.replace(/→/g, '>'), p.x * S, p.y * S, p.size * S, p.color, { literal: true, font: p.bold ? 'bold' : 'label', align: p.align }); break;
        default: break;
        }
    }
    return cv;
}

function frames(result, times, opts) {
    const tl = A.buildTimeline(result);
    const aheadM = scene.fitRange(result), profile = scene.elevationProfile(result), lanes = scene.lanesOf(result);
    return times.map((t) => {
        const fr = A.frameAt(result, tl, t);
        return { t, fr, out: scene.buildScene(fr, Object.assign({ aheadM, profile, lanes }, opts)) };
    });
}

if (require.main === module) {
    const outDir = path.resolve(process.argv[2] || path.join(__dirname, '../../../bake/work/cruise-sim/su1-frames'));
    let result;
    if (process.argv[3]) result = A.normalizeResult(fs.readFileSync(process.argv[3], 'utf8'));
    else result = A.normalizeResult(require('../ui/fake-result.js').makeFakeResult({ seed: 1, duration: 60, out: { dt: 0.05 } }));
    fs.mkdirSync(outDir, { recursive: true });
    const W = 1000, H = 380;
    const list = [[8, 'light'], [16.4, 'light'], [18.6, 'dark'], [34.5, 'light'], [41.5, 'dark'], [50, 'light'], [57.8, 'dark']];
    for (const [t, theme] of list) {
        const f = frames(result, [t], { width: W, height: H, theme })[0];
        const file = path.join(outDir, 'scene-t' + String(t).replace('.', '_') + '-' + theme + '.png');
        fs.writeFileSync(file, render(f.out.ops, W, H, 2).png(6));
        console.log(file);
    }
}

module.exports = { render, frames };
