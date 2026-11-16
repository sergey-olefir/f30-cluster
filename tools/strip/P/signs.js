#!/usr/bin/env node
'use strict';
/**
 * Package P (2026-11-16): the speed-limit and no-overtaking signs as proportions, three ways side by side, so our sign
 * art can be held against the rules and against BMW's stock ring:
 *   design/strip/pictograms/signs/proportions.json   every ratio, with its source
 *   design/strip/pictograms/signs/<set>_<sign>.svg   a drawing of each set at the stock size (outer radius 41.1 px)
 * Sets:
 *   stock  - BMW's cluster sign as docs/G20-DESIGN-SPEC.md §4 measured it on photos 08/09/17/34/39 (PROVISIONAL until
 *            package ZL re-measures 61-68; pass --stock <json> with { outer, inner, figure, pairWidth } to update)
 *   vzkat  - the German Verkehrszeichenkatalog (Zeichen 274 / 276, 600 mm), measured by package P on the public-domain
 *            Wikimedia Commons SVGs (amtliches Werk, § 5 UrhG); only NUMBERS were taken, no path is copied
 *   ours   - our baked hud/scene sign_limit / sign_nopass (88 x 89), measured from the committed textures
 * The cars and the figure in the SVGs are our own drawing (rounded boxes; the figure is set in a generic sans-serif).
 *
 *   node tools/strip/P/signs.js [--stock <json>]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, 'design', 'strip', 'pictograms', 'signs');

// ---- measure our own baked textures (RGBA base64 in hud/scene/*.json) ----------------------------------------------
function measureTex(file) {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    const px = Buffer.from(d.rgba, 'base64'), w = d.w, h = d.h;
    let sa = 0, sx = 0, sy = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const a = px[(y * w + x) * 4 + 3] / 255; sa += a; sx += a * (x + 0.5); sy += a * (y + 0.5);
    }
    const cx = sx / sa, cy = sy / sa, outer = Math.sqrt(sa / Math.PI);
    // inner edge of the red ring: area of red-dominant, opaque pixels -> annulus -> inner radius
    let red = 0; const cars = { red: [Infinity, Infinity, -1, -1], dark: [Infinity, Infinity, -1, -1] };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, r = px[o] / 255, g = px[o + 1] / 255, b = px[o + 2] / 255, a = px[o + 3] / 255;
        const rr = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const isRed = a > 0.5 && r - Math.max(g, b) > 0.4;
        if (isRed && rr > outer * 0.72) red += a;
        const grow = (bb) => { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x + 1); bb[3] = Math.max(bb[3], y + 1); };
        if (rr < outer * 0.72 && isRed) grow(cars.red);
        if (rr < outer * 0.72 && a > 0.5 && Math.max(r, g, b) < 0.3) grow(cars.dark);
    }
    const inner = Math.sqrt(Math.max(0, outer * outer - red / Math.PI));
    return { w, h, cx: +cx.toFixed(2), cy: +cy.toFixed(2), outer: +outer.toFixed(2), inner: +inner.toFixed(2),
        cars: cars.red[2] > 0 ? cars : null };
}

let stock = { outer: 41.1, inner: 31.8, figure: 26.4, pairWidth: 34.8, advance: 18.9,
    source: 'docs/G20-DESIGN-SPEC.md §4.1/§4.3 (photos 08, 09, 17, 34, 39; ±0.3 px); PROVISIONAL until package ZL re-measures 61-68' };
const si = process.argv.indexOf('--stock');
if (si > 0) stock = Object.assign(stock, JSON.parse(fs.readFileSync(process.argv[si + 1], 'utf8')));

const lim = measureTex(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'scene', 'sign_limit.json'));
const np = measureTex(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'scene', 'sign_nopass.json'));

// VzKat, in mm on the 600 mm sign (measured from the Commons SVGs, matrix 1.25 applied; see PROVENANCE.md)
const VZ = { rim: 300, outer: 290, inner: 209.6, figure: 252.1, pairWidth: 311.0, digitGap: 26.5,
    car: { w: 168.3, h: 128.2, gap: 25.0, cy: 300.5 } };

const r3 = (v) => +v.toFixed(3);
const sets = {
    stock: { source: stock.source, outer: stock.outer, inner: stock.inner,
        ringOverOuter: r3((stock.outer - stock.inner) / stock.outer), innerOverOuter: r3(stock.inner / stock.outer),
        figureOverInnerDiameter: r3(stock.figure / (2 * stock.inner)), pairWidthOverInnerDiameter: r3(stock.pairWidth / (2 * stock.inner)),
        whiteRim: 'none drawn; a 1-2 px dark rim outside the red (spec §4.1, probably anti-aliasing)', nopass: 'never photographed' },
    vzkat: { source: 'Zeichen 274-50 and 276, StVO; Wikimedia Commons SVGs (public domain, amtliches Werk); 600 mm sign: 10 mm light rim, 80 mm red ring, 420 mm white field',
        outer: VZ.outer, inner: VZ.inner, ringOverOuter: r3((VZ.outer - VZ.inner) / VZ.outer), innerOverOuter: r3(VZ.inner / VZ.outer),
        figureOverInnerDiameter: r3(VZ.figure / (2 * VZ.inner)), pairWidthOverInnerDiameter: r3(VZ.pairWidth / (2 * VZ.inner)),
        whiteRim: r3((VZ.rim - VZ.outer) / VZ.outer) + ' of the red outer radius',
        nopass: { carWidthOverInnerRadius: r3(VZ.car.w / VZ.inner), carHeightOverInnerRadius: r3(VZ.car.h / VZ.inner),
            gapOverInnerRadius: r3(VZ.car.gap / VZ.inner), left: 'red', right: 'black' } },
    ours: { source: 'apps/f30_cluster/hud/scene/sign_limit.json + sign_nopass.json (88 x 89), measured by tools/strip/P/signs.js',
        outer: lim.outer, inner: lim.inner, ringOverOuter: r3((lim.outer - lim.inner) / lim.outer), innerOverOuter: r3(lim.inner / lim.outer),
        figure: 'a text widget on top (wb_val); package T owns its size', whiteRim: 'none',
        nopass: np.cars ? { carWidthOverInnerRadius: r3((np.cars.red[2] - np.cars.red[0]) / np.inner),
            carHeightOverInnerRadius: r3((np.cars.red[3] - np.cars.red[1]) / np.inner),
            gapOverInnerRadius: r3((np.cars.dark[0] - np.cars.red[2]) / np.inner), left: 'red', right: 'near-black',
            boxes: np.cars } : null },
    shaderFallback: { source: 'shared/shaders.js WBSIGN (u_tex 0): R 38, white field r < 0.79 R', outer: 38, inner: 30.02,
        ringOverOuter: 0.21, innerOverOuter: 0.79 },
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'proportions.json'), JSON.stringify({ generator: 'tools/strip/P/signs.js', units: 'px for stock / ours (panel px), mm for vzkat; ratios unitless', sets }, null, 1) + '\n');

// ---- drawings at the stock size --------------------------------------------------------------------------------------
const R = stock.outer, C = R + 3, SZ = 2 * C;
const RED = '#C8102E', WHITE = '#F4F4F4', INK = '#1A1A1A';
const n = (v) => +v.toFixed(2);
function car(cx, cy, w, h, fill) {   // our own car silhouette, seen from behind: a cabin, a body, two wheels
    const body = `<rect x="${n(cx - w / 2)}" y="${n(cy - h * 0.12)}" width="${n(w)}" height="${n(h * 0.42)}" rx="${n(h * 0.1)}" fill="${fill}"/>`;
    const cab = `<rect x="${n(cx - w * 0.36)}" y="${n(cy - h * 0.5)}" width="${n(w * 0.72)}" height="${n(h * 0.46)}" rx="${n(h * 0.12)}" fill="${fill}"/>`;
    const win = `<rect x="${n(cx - w * 0.27)}" y="${n(cy - h * 0.4)}" width="${n(w * 0.54)}" height="${n(h * 0.24)}" rx="${n(h * 0.06)}" fill="${WHITE}"/>`;
    const wl = `<rect x="${n(cx - w * 0.42)}" y="${n(cy + h * 0.28)}" width="${n(w * 0.2)}" height="${n(h * 0.22)}" rx="${n(h * 0.05)}" fill="${fill}"/>`;
    const wr = `<rect x="${n(cx + w * 0.22)}" y="${n(cy + h * 0.28)}" width="${n(w * 0.2)}" height="${n(h * 0.22)}" rx="${n(h * 0.05)}" fill="${fill}"/>`;
    return body + cab + win + wl + wr;
}
function sign(set, kind) {
    const s = set === 'stock' ? { inner: stock.inner / stock.outer, fig: stock.figure / stock.outer, rim: 0 }
        : set === 'vzkat' ? { inner: VZ.inner / VZ.outer, fig: VZ.figure / VZ.outer, rim: (VZ.rim - VZ.outer) / VZ.outer }
            : { inner: lim.inner / lim.outer, fig: stock.figure / stock.outer, rim: 0 };
    const ri = R * s.inner;
    let g = '';
    if (s.rim) g += `<circle cx="${n(C)}" cy="${n(C)}" r="${n(R * (1 + s.rim))}" fill="${WHITE}"/>`;
    g += `<circle cx="${n(C)}" cy="${n(C)}" r="${n(R)}" fill="${RED}"/><circle cx="${n(C)}" cy="${n(C)}" r="${n(ri)}" fill="${WHITE}"/>`;
    if (kind === 'limit') {
        // the figure: a generic sans-serif, cap-centred; font-size ~ figure / 0.72 (a typical figure height per em)
        const fh = R * s.fig;
        g += `<text x="${n(C)}" y="${n(C + fh / 2)}" font-family="Roboto, Arial, sans-serif" font-size="${n(fh / 0.72)}" text-anchor="middle" fill="${INK}">50</text>`;
    } else {
        const cw = ri * (set === 'vzkat' ? VZ.car.w / VZ.inner : 0.78), ch = ri * (set === 'vzkat' ? VZ.car.h / VZ.inner : 0.6),
            gap = ri * (set === 'vzkat' ? VZ.car.gap / VZ.inner : 0.14);
        g += car(C - gap / 2 - cw / 2, C, cw, ch, RED) + car(C + gap / 2 + cw / 2, C, cw, ch, INK);
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${set} proportions, ${kind === 'limit' ? 'speed limit' : 'no overtaking'}, drawn at the stock outer radius ${R} px.
     Our own drawing (package P, tools/strip/P/signs.js); ratios from design/strip/pictograms/signs/proportions.json.
     Not BMW's artwork; no path copied from any sign file. Licence: MIT (the repository's LICENSE). -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(SZ)} ${n(SZ)}" width="${n(SZ * 4)}" height="${n(SZ * 4)}">
  <title>${set} ${kind}</title>
  <rect width="${n(SZ)}" height="${n(SZ)}" fill="#000"/>
  ${g}
</svg>
`;
}
for (const set of ['stock', 'vzkat', 'ours']) for (const kind of ['limit', 'nopass']) {
    if (set === 'stock' && kind === 'nopass') continue;     // never photographed: no stock proportions to draw
    fs.writeFileSync(path.join(OUT, `${set}_${kind}.svg`), sign(set, kind));
}
console.log(JSON.stringify(sets, null, 1));
