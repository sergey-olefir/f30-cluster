'use strict';
/**
 * test-twin-bake.js - Twin Dial package R2-A2: the baked dial faces and the fallback-window mask as the engine loads them.
 *
 *   node bench/test-twin-bake.js
 *
 * Reads apps/twin_dial/hud/scene/{face_tacho,face_speedo,panel_mask}.json exactly as shared/hud.js _scene() does (R8 payload =
 * w * h bytes, a "mask" entry for the widget), checks the face geometry the tdial widget relies on, the regions JSON beside each
 * face, the mask's polarity and its place under the plate, and the pixel memory against SPEC 13.2. The pixel-level checks
 * (against the mockup, byte-for-byte regeneration, the 4 px numeral rule) are tools/twin-dial/test_bake.py. Never shipped.
 */
const fs = require('fs');
const path = require('path');

const SCENE = path.join(__dirname, '..', 'apps', 'twin_dial', 'hud', 'scene');
let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const load = (n) => JSON.parse(fs.readFileSync(path.join(SCENE, n + '.json'), 'utf8'));
const raw = (j) => Buffer.from(j.r8, 'base64');

const CX = { face_tacho: 380, face_speedo: 1540 };
for (const name of ['face_tacho', 'face_speedo']) {
    const j = load(name), buf = raw(j), reg = load(name + '.regions');
    ok(j.format === 'r8' && j.w === 616 && j.h === 560 && buf.length === j.w * j.h, name + ': R8 616 x 560, payload w * h bytes (what _scene() demands)');
    ok(j.sampling === 'bilinear' && j.mask && j.mask.kind === 'face', name + ': bilinear, mask entry kind "face"');
    const [x0, y0, x1, y1] = j.mask.rect;
    ok(x0 === CX[name] - 308 && x1 === CX[name] + 308 && y0 === 90 && y1 === 650, name + ': rect [' + j.mask.rect + '] = centre +- 308, y 90..650 (above the furniture limit y 657, clear of the gear gap [1380, 660, 1460, 720])');
    ok(j.mask.centre[0] === 308 && j.mask.centre[1] === 310 && j.mask.R === 300 && reg.rect_panel.join() === j.mask.rect.join(), name + ': centre (308, 310), R 300; regions JSON agrees');
    // the dial centre in panel px is (cx, 400): rect origin + centre
    ok(x0 + j.mask.centre[0] === CX[name] && y0 + j.mask.centre[1] === 400, name + ': panel centre = (' + CX[name] + ', 400)');
    // the bezel's top (rho 1.0 at theta 0) is white: face px (308, 10)
    ok(buf[10 * 616 + 308] > 200 || buf[9 * 616 + 308] > 200, name + ': the bezel crosses the dial\'s top (face px 308, 10)');
    ok(buf[0] === 0 && buf[615] === 0 && buf[559 * 616] === 0 && buf[559 * 616 + 615] === 0, name + ': black corners');
    // nothing but the bezel/bar at the very bottom rows (the bezel ends at y 555)
    let bottom = 0; for (let i = 556 * 616; i < 560 * 616; i++) bottom = Math.max(bottom, buf[i]);
    ok(bottom < 10, name + ': nothing in the last 4 rows');
    ok(reg.bar.segments === 5 && reg.bar.segment_rects_face_px.length === 5 && reg.bar.gap_px === 4, name + ': bar of 5 segments, 4 px gaps');
    ok(Array.isArray(reg.numerals) && reg.numerals.every((n) => n.ink_box_px.length === 4), name + ': numerals carry ink boxes');
    ok(reg.clearance.violations.length === 0 && reg.clearance.rule_px === 4, name + ': numeral clearance record: no violation of the 4 px rule');
    ok(reg.regions.band.rho[0] === 0.5795 && reg.regions.band.rho[1] === 0.9375 && reg.regions.band.theta_abs_max_deg === 143 && reg.regions.band.tint_linear.join() === '0.76,1,1.064', name + ': band region 0.5795-0.9375, |theta| <= 143, tint 0.76 : 1 : 1.064 (SPEC-R3 2.1, 2.2)');
    ok(reg.regions.bezel.theta_abs_max_deg === 143.6 && reg.regions.rim.theta_abs_max_deg === 143.55 && !reg.wedge, name + ': bezel to 143.6, rim to 143.55, no wedge');
}
const tv = load('face_tacho.regions').numerals.map((n) => n.value), sv = load('face_speedo.regions').numerals.map((n) => n.value);
ok(tv.join() === '1,2,3,4,5,6,7,8', 'tachometer numerals 1-8');
ok(sv.indexOf(90) < 0 && sv.indexOf(120) < 0 && sv.indexOf(100) >= 0 && sv.length === 19, 'speedometer numerals: 19, no 90, no 120');
ok(load('face_tacho.regions').red_arc.to_deg === 143.6 && load('face_tacho.regions').red_arc.srgb.join() === '210,20,21' && load('face_tacho.regions').scale.rest_deg === -135, 'tachometer: red arc (210, 20, 21) to 143.6 deg, rest -135 (OFF)');
ok(load('face_speedo.regions').scale.rest_deg === -125, 'speedometer: rest -125 (0)');

{
    const j = load('panel_mask'), buf = raw(j);
    const [x0, y0, x1, y1] = j.mask.rect;
    ok(j.format === 'r8' && j.w === 536 && j.h === 112 && buf.length === 536 * 112 && j.w === x1 - x0 && j.h === y1 - y0, 'panel_mask: R8 536 x 112 = its rect [' + j.mask.rect + ']');
    const at = (x, y) => buf[(y - y0) * j.w + (x - x0)];
    ok(at(960, 650) === 255 && at(960, 620) === 255 && at(1100, 690) === 255, 'panel_mask: 255 inside BMW\'s panel outline (the window)');
    ok(at(694, 592) === 0 && at(1229, 703) === 0 && at(700, 598) === 0, 'panel_mask: 0 outside it');
    let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
    for (let y = 0; y < j.h; y++) for (let x = 0; x < j.w; x++) if (buf[y * j.w + x]) { minx = Math.min(minx, x + x0); maxx = Math.max(maxx, x + x0 + 1); miny = Math.min(miny, y + y0); maxy = Math.max(maxy, y + y0 + 1); }
    const plate = j.mask.plate;
    ok(minx >= plate[0] && maxx <= plate[2] && miny >= plate[1] && maxy <= plate[3], 'panel_mask: every window pixel [' + [minx, miny, maxx, maxy] + '] lies under the plate [' + plate + ']');
    ok(maxx <= 1230 && minx >= 696 && !(maxx > 1240 && maxy > 588 && miny < 630), 'panel_mask: clear of the stored-message marker [1240, 588, 1288, 630]');
    ok(minx > 688 || miny >= 720, 'panel_mask: clear of the belt group [497, 660, 688, 720]');
}

const MIB = 1048576, mem = (load('face_tacho').w * 560 + load('face_speedo').w * 560 + 536 * 112) * 2 / MIB;
ok(mem < 1.6, 'the three scene textures cost ' + mem.toFixed(2) + ' MiB of pixel memory (counted twice)');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
