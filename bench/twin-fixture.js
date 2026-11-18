'use strict';
/**
 * twin-fixture.js - package B (docs/twin-dial/ENGINE-CONTRACT.md): a throw-away bench tree with a STAND-IN app for the
 * Twin Dial's engine widgets, so tdial and tdback can run on the bench before apps/twin_dial exists (and after: it
 * never touches apps/).
 *
 *   const F = require('./twin-fixture');
 *   const t = F.makeRoot(dir, { faces: 'js' | <folder with face_tacho.json ...> });   -> { root, data, appId }
 *   F.serverEnv(t, port) -> env for `node <root>/bench/server.js <appId>`
 *
 * The tree (under bake/work/twin-dial/, git-ignored) is its own bench/ copy (patched: the bench's manual feed gets the
 * fuel reserve field and a "twinCc" hook), with shared/ and kit/ linked from this checkout, and one app,
 * apps/twin_engine_test: the layout the SPEC and the contract describe, built by hand (the same numbers as design/
 * twin-dial/vg/layout.json), stand-in R8 faces (drawn here from the SPEC's numbers: band, strip, ticks, bezel, rim,
 * hollow boxes where the numerals go) and a panel mask, and "icon" place-holders the size of C's image sheets so the
 * pixel memory is the budget's. Nothing here is shipped.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const R = 300;
const CT = [380, 400], CS = [1540, 400];
const FACE = { w: 616, h: 560, cx: 308, cy: 310 };      // the face's pixels; the dial centre in them (package A2's faces: [cx - 308, 90, cx + 308, 650])
const HOLES = [[22, 211, 88, 258], [21, 264, 80, 317], [11, 324, 76, 372], [16, 378, 66, 432], [1774, 176, 1873, 208],
    [1835, 214, 1903, 263], [1844, 262, 1908, 318]];       // design/twin-dial/vg/layout.json keep_outs.telltales_holes.rects_plus_3px
const BELT = [497, 660, 688, 720];
const SEV = 'twin';
let t_faces = '';

const srgb = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
const tachAng = (k) => -125 + 250 * k / 8;
const speedAng = (v) => (v <= 100 ? -125 + 25 * v / 20 : 25 * (v - 100) / 40);

/** A stand-in R8 face (SPEC 4 / ENGINE-CONTRACT 1.1): sRGB codes, 3 x 3 samples a pixel. */
function drawFace(kind) {
    const W = FACE.w, H = FACE.h, out = Buffer.alloc(W * H);
    const majors = kind === 'tach' ? [0, 1, 2, 3, 4, 5, 6, 7, 8].map(tachAng) : [0, 20, 40, 60, 80, 100, 140, 180, 220, 260, 300].map(speedAng);
    const minors = kind === 'tach' ? [0, 1, 2, 3, 4, 5, 6, 7].map((k) => tachAng(k + 0.5))
        : [].concat(...[0, 20, 40, 60, 80, 100, 140, 180, 220, 260].map((v) => { const s = v < 100 ? 5 : 10, n = v < 100 ? 3 : 3; const a = []; for (let i = 1; i <= n; i++) a.push(speedAng(v + (v < 100 ? 20 : 40) * i / (n + 1))); return a; }));
    // hollow boxes where the numerals go (white outline, 4 px)
    const boxes = [];
    if (kind === 'tach') for (let k = 1; k <= 8; k++) boxes.push([tachAng(k), 0.745, 30, 40]);
    else [0, 20, 40, 60, 80, 100, 140, 180, 220, 260, 300].forEach((v) => boxes.push([speedAng(v), 0.76, 22, 30]));
    const off = kind === 'tach' ? [-0.56 * R, 0.58 * R, 40, 18] : null;
    const barY = 0.73 * R, barW = (0.84 * R - 16) / 5;
    const angDiff = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
    const sample = (dx, dy) => {
        const rho = Math.hypot(dx, dy) / R, th = Math.atan2(dx, -dy) * 180 / Math.PI, ath = Math.abs(th);
        let c = 0;
        if (rho >= 0.58 && rho <= 0.893 && ath <= 144) c = srgb(0.010 * Math.exp(7.5 * (rho - 0.60)) * Math.exp(-0.85 * (Math.cos(th * Math.PI / 180) - 1)));
        else if (rho > 0.893 && rho <= 0.94 && ath <= 144) c = srgb(0.25);
        if (rho >= 0.58 && rho <= 0.893 && majors.some((a) => Math.abs(angDiff(th, a)) * Math.PI / 180 * rho <= 0.003)) c = 6 / 255;
        if (rho >= 0.896 && rho <= 0.934) {
            if (majors.some((a) => Math.abs(angDiff(th, a)) * Math.PI / 180 * rho <= 0.009)) c = 1;
            else if (minors.some((a) => Math.abs(angDiff(th, a)) * Math.PI / 180 * rho <= 0.006)) c = 1;
        }
        if (Math.abs(rho - 1) <= 0.0105 && ath <= 144) c = 1;
        if (Math.abs(rho - 0.545) <= 0.008 && ath <= 150) c = 1;
        for (const b of boxes) {
            const a = b[0] * Math.PI / 180, bx = Math.sin(a) * b[1] * R, by = -Math.cos(a) * b[1] * R;
            const ax = Math.abs(dx - bx), ay = Math.abs(dy - by);
            if (ax <= b[2] / 2 && ay <= b[3] / 2 && !(ax <= b[2] / 2 - 4 && ay <= b[3] / 2 - 4)) c = 1;
        }
        if (off) {
            const ax = Math.abs(dx - off[0]), ay = Math.abs(dy - off[1]);
            if (ax <= off[2] / 2 && ay <= off[3] / 2 && !(ax <= off[2] / 2 - 3 && ay <= off[3] / 2 - 3)) c = 1;
        }
        // the empty bar segments (SPEC 5.1: code 46..50)
        if (Math.abs(dy - barY) <= 3.75) {
            const rx = dx + 0.42 * R;
            if (rx >= 0 && rx <= 0.84 * R) {
                const i = Math.min(4, Math.floor(rx / (barW + 4)));
                if (rx - i * (barW + 4) <= barW) c = 47 / 255;
            }
        }
        return c;
    };
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            let s = 0;
            for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) s += sample(x + (i + 0.5) / 3 - FACE.cx, y + (j + 0.5) / 3 - FACE.cy);
            out[y * W + x] = Math.max(0, Math.min(255, Math.round(s / 9 * 255)));
        }
    }
    return out;
}

/** The stand-in panel mask (ENGINE-CONTRACT 1.2): 255 = BMW's panel shows through. A rounded box of the bbox, 3 px in. */
function drawMask() {
    const W = 536, H = 112, out = Buffer.alloc(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = Math.max(10 - x, x - (W - 11), 0), dy = Math.max(6 - y, y - (H - 7), 0);
        out[y * W + x] = Math.hypot(dx, dy) <= 8 ? 255 : 0;
    }
    return out;
}

const sceneJson = (w, h, buf) => JSON.stringify({ w, h, format: 'r8', r8: buf.toString('base64'), sampling: 'bilinear' });

function holesFor(rect) {
    const [x0, y0, x1, y1] = rect;
    return HOLES.concat([BELT]).filter((h) => h[2] > x0 && h[0] < x1 && h[3] > y0 && h[1] < y1);
}

/** The hand-written layout (the contract's section 1; positions from SPEC 3 and 13.2) with C's sheets as place-holders. */
function layout(name, extra) {
    const dial = (id, kind, c, face, bar) => ({
        id, type: 'tdial', kind, x: c[0] - 310, y: 90, w: 620, h: 570, z: 1, conn: 0, centre: c, R,
        face: { tex: face, x: c[0] - FACE.cx, y: 90, w: FACE.w, h: FACE.h }, sweep: 125,
        ...(kind === 'tach' ? { scaleMax: 8000, redline: 'setting', restDeg: -135 } : {}), shadow: true, bar,
    });
    const back = (id, part, rect) => ({ id, type: 'tdback', part, x: rect[0], y: rect[1], w: rect[2] - rect[0], h: rect[3] - rect[1], z: 0, conn: 0, holes: holesFor(rect) });
    const L = back('bg_l', 'L', [0, 0, 1380, 720]);
    Object.assign(L, {
        tab: { rect: [618, 127, 1302, 172], seps: [780, 848, 1168, 1237], rule: [170, 173], ramp: [0.002, 0.16], highlight: [744, 812] },     // twin_dial B1: SPEC-R3 3.1
        rules: [{ x0: 741, y0: 295.2, x1: 1180, y1: 296.7, role: 'rule' },
            { x0: 629, y0: 612.4, x1: 1292, y1: 614.6, role: 'rule', ours: { y0: 611, y1: 615, x1: 1291, role: 'severity' } }],
        panelMask: { tex: 'panel_mask', x: 694, y: 592, w: 536, h: 112 },
    });
    const sheet = (id, conn, x, y, w, h) => ({ id, type: 'icon', icon: 'gauge', own: true, color: 'dim', x, y, w, h, z: 2, conn });
    const widgets = [L, back('bg_rt', 'RT', [1380, 0, 1920, 660]), back('bg_rb', 'RB', [1460, 660, 1920, 720]),
        dial('dial_tach', 'tach', CT, 'face_tacho', { y: 619, x0: 254, x1: 506, h: 7.5, segs: 5, gap: 4, signal: 'fuel', min: 0, max: 1, reserve: 'reserve' }),
        dial('dial_speed', 'speed', CS, 'face_speedo', { y: 619, x0: 1414, x1: 1666, h: 7.5, segs: 5, gap: 4, signal: 'coolant', min: 50, max: 130, hotAt: 120 }),
        sheet('sheet_tabs', 1, 684, 124, 552, 52), sheet('sheet_centre', 1, 690, 213, 540, 400), sheet('sheet_hub', 1, 230, 330, 300, 60),
        sheet('sheet_row', 2, 698, 626, 524, 88), sheet('sheet_plate', 2, 692, 592, 536, 128)];
    return Object.assign({ schemaVersion: 2, name, theme: SEV, widgets }, extra || {});
}

function makeRoot(dir, opts) {
    opts = opts || {};
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    // the bench's own copy (so ROOT and dist/ are the tree's), patched for the two things the stand-in app needs
    const bench = path.join(dir, 'bench');
    fs.mkdirSync(bench);
    fs.readdirSync(path.join(REPO, 'bench')).forEach((f) => {
        const s = path.join(REPO, 'bench', f);
        if (f === '.data' || /^test-/.test(f) || f === 'twin-fixture.js') return;
        fs.cpSync(s, path.join(bench, f), { recursive: true });
    });
    const ra = path.join(bench, 'run-app.js');
    let src = fs.readFileSync(ra, 'utf8');
    const a = "fluidLevelFuelTank: Math.round(num('fuelL', 40)),";
    const b = "if (h === 'ccHold') ccHeld = true;";
    if (src.indexOf(a) < 0 || src.indexOf(b) < 0) throw new Error('twin-fixture: bench/run-app.js changed; patch points not found');
    src = src.replace(a, a + " statusFluidLevelFuelTankSpare: Math.round(num('spare', 3)),");
    // twin_dial B1: hooks for the selected tab, the speed-limit / cruise markers and the map window (state the engine reads, then its own resend)
    const b1 = "if (h.indexOf('twinTab:') === 0) { hud.twinTab = Number(h.slice(8)); hud._twinSync(); }\n    else if (h.indexOf('twinMap:') === 0) { hud.twinMap = h.slice(8) || null; hud._twinSync(); }\n    else if (h.indexOf('twinMarks:') === 0) { const p = h.slice(10).split(','); hud.config.limit = { strip: p[5] || 'L1' }; hud.twinLim = { deg: Number(p[0]), state: Number(p[1]), warn: Number(p[2]) }; hud.twinCru = { deg: Number(p[3]), state: Number(p[4]) }; hud._twinMarks(); }\n    else ";
    src = src.replace(b, "if (h.indexOf('twinCc:') === 0) { const p = h.slice(7).split(','); hud.twinCc = { state: p[0], severity: p[1] || null }; hud._twinSync(); }\n    else " + b1 + b);
    fs.writeFileSync(ra, src);
    ['shared', 'kit'].forEach((d) => fs.symlinkSync(path.join(REPO, d), path.join(dir, d)));
    const sdk = path.join(dir, 'oap-sdk');
    fs.mkdirSync(sdk);
    fs.writeFileSync(path.join(sdk, 'index.js'), "'use strict';\n// BENCH_STUB: stands in for BMW's oap-sdk so kit/tools/build.py runs on the Mac. Never ship this.\nthrow new Error('BENCH_STUB oap-sdk');\n");
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'oap-sdk', version: '0.0.0-bench-stub', main: 'index.js' }) + '\n');
    // the stand-in app: f30_cluster's shared list and signals, the twin settings, no centre screens
    const f30 = JSON.parse(fs.readFileSync(path.join(REPO, 'apps', 'f30_cluster', 'app.json'), 'utf8'));
    const steps = []; for (let r = 5000; r <= 7500; r += 250) steps.push(r);
    const spec = {
        id: 'twin_engine_test', title: 'Twin engine test', description: 'package B stand-in app, never shipped', version: '0.0.1', vendor: 'custom',
        loggingId: 'OATE', iconGlyph: 'TE', shared: f30.shared, signals: f30.signals,
        settings: [
            { key: 'hudLayout', label: 'Layout', type: 'choice', default: 'twin_test', options: [['twin_test', 'Twin test'], ['twin_alt', 'Twin alt']] },
            { key: 'needleSmooth', label: 'Smooth needles', type: 'bool', default: true },
            { key: 'nightLook', label: 'Night look', type: 'choice', default: 'auto', options: [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']] },
            { key: 'redline', label: 'Redline', type: 'number', default: 6500, steps, unit: 'rpm' },
            { key: 'bandGain', label: 'Band level', type: 'number', default: 1, steps: [0.6, 0.8, 1, 1.2, 1.4, 1.7] },
            { key: 'demo', label: 'Demo data', type: 'choice', default: 'off', options: [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']] },
        ],
        config: Object.assign({}, f30.config, { tankLitres: 59, statusName: 'Cluster' }),
    };
    const app = path.join(dir, 'apps', 'twin_engine_test');
    fs.mkdirSync(path.join(app, 'hud', 'layouts'), { recursive: true });
    fs.mkdirSync(path.join(app, 'hud', 'scene'), { recursive: true });
    fs.writeFileSync(path.join(app, 'app.json'), JSON.stringify(spec, null, 1));
    fs.writeFileSync(path.join(app, 'main.js'), "'use strict';\nconst mgu = require('./kit/mgu');\nconst HudApp = require('./hud');\nmgu.run({ start(ctx) { new HudApp(ctx).start(); } });\n");
    const scene = path.join(app, 'hud', 'scene');
    // the faces: opts.faces (a folder), else $TWIN_FACES, else apps/twin_dial/hud/scene once package A2's are merged, else the stand-ins
    const own = path.join(REPO, 'apps', 'twin_dial', 'hud', 'scene');
    const folder = opts.faces === 'js' ? null : opts.faces || process.env.TWIN_FACES || (fs.existsSync(path.join(own, 'face_tacho.json')) ? own : null);
    t_faces = folder ? 'baked: ' + folder : 'stand-in (drawn in twin-fixture.js)';
    if (folder) ['face_tacho', 'face_speedo', 'panel_mask'].forEach((n) => fs.copyFileSync(path.join(folder, n + '.json'), path.join(scene, n + '.json')));
    else {
        fs.writeFileSync(path.join(scene, 'face_tacho.json'), sceneJson(FACE.w, FACE.h, drawFace('tach')));
        fs.writeFileSync(path.join(scene, 'face_speedo.json'), sceneJson(FACE.w, FACE.h, drawFace('speed')));
        fs.writeFileSync(path.join(scene, 'panel_mask.json'), sceneJson(536, 112, drawMask()));
    }
    fs.writeFileSync(path.join(app, 'hud', 'layouts', 'twin_test.json'), JSON.stringify(layout('twin_test')));
    // a second layout of the same assets: switching to it is a rebuild (the peak of pixel memory)
    const alt = layout('twin_alt');
    alt.widgets = alt.widgets.filter((w) => w.id !== 'sheet_plate');
    fs.writeFileSync(path.join(app, 'hud', 'layouts', 'twin_alt.json'), JSON.stringify(alt));
    const data = path.join(dir, 'data');
    fs.mkdirSync(data);
    return { root: dir, data, appId: 'twin_engine_test', app, faces: t_faces };
}

function serverEnv(t, port) {
    return Object.assign({}, process.env, { BENCH_PORT: String(port), BENCH_DATA_DIR: t.data, BENCH_LAYER_CAP: '8' });
}

module.exports = { makeRoot, serverEnv, layout, drawFace, drawMask, HOLES, BELT, FACE, speedAng, tachAng };
