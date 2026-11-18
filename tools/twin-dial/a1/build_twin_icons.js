#!/usr/bin/env node
'use strict';
/**
 * Twin Dial pictograms for the engine (package A1, round 2, 2026-11-17; SPEC 10).
 *
 *   node tools/twin-dial/a1/build_twin_icons.js [--check]
 *
 * How the engine reads an icon: shared/hud.js paints an "icon" widget with shared/icons.js paintIcon(name, w, h, colour),
 * a distance function drawn at the widget's size with one pixel of anti-aliasing, at build time of the sheet, in any
 * colour (day, night, severity). So the thing to "bake" is not a bitmap but the distance functions, in a file the car
 * has: shared/twin_icons.js, written here from design/twin-dial/vt/pictograms.js (the drawings the slot table names; ten of them are
 * package P's) with the step evaluator copied out of design/strip/pictograms/pictograms.js as text (one source of
 * truth: that file exports stepDist, the VT copy is gone). Requiring the file registers the icons in icons.js ICONS.
 *
 * Also written: apps/twin_dial/hud/icons/icons.json, the slot table of SPEC 10 (name, slot, size) with, for each, the
 * ink box and the ink sum paintIcon gives and a hash of its alpha - the record bench/test-twin-fonts.js compares.
 * --check: write nothing, exit 1 when either file differs from what this would write.
 * Our own drawings only; nothing is read from reference/ or from the car.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const STRIP_SRC = path.join(ROOT, 'design', 'strip', 'pictograms', 'pictograms.js');
const TWIN = require(path.join(ROOT, 'design', 'twin-dial', 'vt', 'pictograms.js'));
const OUT_JS = path.join(ROOT, 'shared', 'twin_icons.js');
const OUT_JSON = path.join(ROOT, 'apps', 'twin_dial', 'hud', 'icons', 'icons.json');

// SPEC 10 (rev 2) and SPEC-R3 7: which icon is drawn at which size. Round 3 (package B6): the tab icons are 36 px of ink in a 46 px box (SPEC-R3
// 3.1), the message symbols are drawn twice (54 px in the card's cell, 32 px in a row), and the guidance set has its
// 120 px page size and its 30 px lane-row size.
const MESSAGE = ['cc_door', 'cc_belt', 'cc_brake', 'cc_tyre', 'cc_engine', 'cc_washer', 'cc_bonnet', 'cc_boot', 'cc_oil', 'cc_pedal', 'cc_service', 'cc_battery', 'cc_coolant', 'cc_warn', 'cc_info'];
const TURNS = ['td_straight', 'td_turn_slight_left', 'td_turn_left', 'td_turn_hard_left', 'td_uturn_left', 'td_turn_slight_right', 'td_turn_right', 'td_turn_hard_right', 'td_uturn_right'];
const GUIDANCE = TURNS.concat(['td_fork_left', 'td_fork_right', 'td_fork_straight', 'td_exit_left', 'td_exit_right', 'td_merge_left', 'td_merge_right',
    'td_flag_left', 'td_flag_centre', 'td_flag_right', 'td_lane_change_left', 'td_lane_change_right', 'td_dot'],
    [1, 2, 3, 4, 5, 6].map((n) => 'td_rb' + n + '_r'), [1, 2, 3, 4, 5, 6].map((n) => 'td_rb' + n + '_l'));
const SLOTS = {
    tab: { size: [46, 46], names: ['td_fuel', 'cc_warn', 'td_radio', 'td_media', 'td_proj', 'td_phone', 'td_phone_bars', 'td_phone_off', 'td_nav'], use: 'the tab bar: a 46 px box whose ink is 36 px, on the centre line y 147 (SPEC-R3 3.1 says 36 px of INK; integration decision, see docs/twin-dial/R3B-INTEGRATION.md), and the trip page\'s pump (SPEC-R3 4.1)' },
    gauge: { size: [32, 32], names: ['td_fuel_side', 'cc_coolant'], use: 'under the dials, over the bars' },
    symbol: { size: [54, 54], names: MESSAGE, use: 'the tab-2 card\'s symbol cell, centred (960, 344) (SPEC-R3 5.1)' },
    row: { size: [32, 32], names: MESSAGE, use: 'the tab-2 rows, x 741 (SPEC-R3 5.1)' },
    page: { size: [54, 54], names: ['td_radio', 'td_phone', 'td_phone_bars', 'td_phone_off', 'td_proj'], use: 'the radio and phone pages, centred (960, 344) (SPEC-R3 4.3, 4.4)' },
    big: { size: [66, 66], names: ['td_radio', 'td_media', 'td_proj', 'td_phone', 'td_phone_off', 'td_handset', 'cc_info'], use: 'the media source pictogram at (960, 392), the incoming call\'s handset at (960, 372), the empty page (SPEC-R3 4.3, 4.4, 5.1)' },
    cruise: { size: [36, 36], names: ['td_cruise', 'td_cruise_acc', 'td_limiter'], use: 'the set-speed readout, centred (1572, 528) (SPEC-R3 9)' },
    sign: { size: [51, 51], names: ['td_end_stripes'], use: 'the end-of-restrictions sign: the stripes over the 50.8 px white disc (SPEC-R3 8)' },
    arrow: { size: [120, 120], names: GUIDANCE, use: 'the guidance page, [770, 318, 890, 438] (SPEC-R3 4.5)' },
    lane: { size: [30, 30], names: TURNS.concat(['td_lane_change_left', 'td_lane_change_right']), use: 'the lane row, 34 px pitch, and the navigation tab\'s turn arrow after probe P12 (SPEC-R3 3.3, 4.5)' },
    mark: { size: [32, 32], names: ['td_mute', 'td_mic_off', 'td_play', 'td_pause', 'td_check', 'td_bars', 'td_limit', 'td_dot', 'td_car', 'td_engine', 'td_gauge', 'td_clock', 'td_road', 'td_rain', 'td_compass', 'td_handset', 'td_phone_ring', 'td_flag', 'td_avg', 'td_settings', 'cc_warn_solid', 'cc_dot'], use: 'small marks: the mute mark, the muted microphone, the page and mockup symbols; sized by the page that draws them' },
};

function evaluator() {
    const src = fs.readFileSync(STRIP_SRC, 'utf8');
    const a = src.indexOf('const RAD = Math.PI / 180;');
    const b = src.indexOf('// ---- the drawings');
    if (a < 0 || b < a) throw new Error('design/strip/pictograms/pictograms.js: the step evaluator moved; fix tools/twin-dial/a1/build_twin_icons.js');
    return src.slice(a, b).trimEnd();
}

function names() {
    const all = [];
    for (const g of Object.values(SLOTS)) for (const n of g.names) if (!all.includes(n)) all.push(n);
    return all;
}

function moduleText() {
    const drawings = {};
    for (const n of names()) {
        if (!TWIN.DRAWINGS[n]) throw new Error('no drawing for ' + n);
        drawings[n] = TWIN.DRAWINGS[n];
    }
    const lines = Object.keys(drawings).map((n) => '    ' + JSON.stringify(n) + ': ' + JSON.stringify(drawings[n]));
    return `'use strict';
/**
 * Twin Dial pictograms for the engine - GENERATED by tools/twin-dial/a1/build_twin_icons.js from
 * design/twin-dial/vt/pictograms.js; do not edit (bench/test-twin-fonts.js fails when this is out of date).
 *
 * Our own drawings (MIT, design/twin-dial/vt/PROVENANCE.md), after the shapes ISO 2575 and UN R121 standardise; the
 * ten of package P's are the ones of shared/strip_icons.js. Requiring this file adds every icon below to
 * shared/icons.js ICONS, so a layout's icon widget takes "icon": "td_fuel" etc.; twin_dial's main.js requires it
 * (f30_cluster does not list the file). The step evaluator below is a text copy of the one in
 * design/strip/pictograms/pictograms.js (stepDist).
 */
${evaluator()}

const DRAWINGS = {
${lines.join(',\n')},
};

function sdf(steps) {
    return (x, y) => {
        let d = Infinity;
        for (const s of steps) {
            const p = stepDist(s, x, y);
            d = s.cut ? Math.max(d, -p) : Math.min(d, p);
        }
        return d;
    };
}
const ICONS = {};
for (const n of Object.keys(DRAWINGS)) ICONS[n] = sdf(DRAWINGS[n]);

Object.assign(require('./icons').ICONS, ICONS);

module.exports = { ICONS, DRAWINGS };
`;
}

function manifestText() {
    const { paintIcon } = require(path.join(ROOT, 'shared', 'icons.js'));
    Object.assign(require(path.join(ROOT, 'shared', 'icons.js')).ICONS, TWIN.ICONS);
    const items = [];
    for (const [slot, g] of Object.entries(SLOTS)) {
        for (const n of g.names) {
            const [w, h] = g.size;
            const px = paintIcon(n, w, h, [255, 255, 255, 255]);
            const alpha = Buffer.alloc(w * h);
            let x0 = w, y0 = h, x1 = -1, y1 = -1, sum = 0;
            for (let i = 0; i < w * h; i++) {
                const a = px[i * 4 + 3];
                alpha[i] = a; sum += a;
                if (a > 0) { const x = i % w, y = (i / w) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
            }
            items.push({ name: n, slot, w, h, box: [x0, y0, x1 + 1, y1 + 1], ink: +(sum / 255).toFixed(1), alpha_sha1: crypto.createHash('sha1').update(alpha).digest('hex').slice(0, 16) });
        }
    }
    const j = {
        generator: 'tools/twin-dial/a1/build_twin_icons.js', source: 'design/twin-dial/vt/pictograms.js (' + names().length + ' drawings, MIT, our own)',
        runtime: 'shared/twin_icons.js (the distance functions the engine paints; shared/icons.js paintIcon)',
        _about: 'SPEC 10 / SPEC-R3 7 slot table. The engine draws icons from the distance functions at the widget\'s own size and colour; this file records what that gives at each slot size (ink box in px, ink sum, hash of the alpha plane) so a change in a drawing or in icons.js shows up in bench/test-twin-fonts.js.',
        slots: Object.fromEntries(Object.entries(SLOTS).map(([k, g]) => [k, { w: g.size[0], h: g.size[1], use: g.use }])),
        items,
    };
    return JSON.stringify(j, null, 1) + '\n';
}

if (require.main === module) {
    const check = process.argv.includes('--check');
    const out = [[OUT_JS, moduleText()], [OUT_JSON, manifestText()]];
    let drift = 0;
    for (const [file, text] of out) {
        const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
        if (check) { if (old !== text) { drift++; console.log('differs: ' + path.relative(ROOT, file)); } continue; }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        console.log('wrote ' + path.relative(ROOT, file) + ' (' + text.length + ' bytes)');
    }
    if (check) { console.log(drift ? drift + ' file(s) out of date' : 'up to date'); process.exit(drift ? 1 : 0); }
}
module.exports = { SLOTS, names, moduleText, manifestText };
