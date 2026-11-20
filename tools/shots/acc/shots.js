'use strict';
/**
 * tools/shots/acc/shots.js - ACC View's pictures for every demo state, day and night (round 1120 AA2), into
 * bake/work/r1120/acc-app/ (git-ignored):
 *
 *   node tools/shots/acc/shots.js [--lang en] [--out <dir>]
 *
 *   centre/<nn>_<state>_<day|night>.png   the centre page as the HMI gets it (the kit's record.js Recorder played into its
 *                                         canvas: the software path, 1600 x 520)
 *   map/<nn>_<state>_<day|night>.json     the map target's five layers as main.js sends them: the lane's and the car's
 *                                         uniforms and boxes, the two sheets' pixels; tools/shots/acc/shots.py renders the two
 *                                         effects with the app's own shaders (tools/acc-view/lane_gl.py) and composites them
 * Then run shots.py for the map pictures and the contact sheet.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const APP = path.join(ROOT, 'apps', 'acc_view');
const M = require(path.join(APP, 'model.js'));
const P = require(path.join(APP, 'paint.js'));
const Rec = require(path.join(ROOT, 'kit', 'runtime', 'record.js'));
const { Canvas } = require(path.join(ROOT, 'kit', 'runtime', 'canvas.js'));

const args = process.argv.slice(2);
const lang = args.indexOf('--lang') >= 0 ? args[args.indexOf('--lang') + 1] : 'uk';
const OUT = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : path.join(ROOT, 'bake', 'work', 'r1120', 'acc-app' + (lang === 'uk' ? '' : '-' + lang));
['centre', 'map'].forEach((d) => fs.mkdirSync(path.join(OUT, d), { recursive: true }));

const IMG = 0x41560001;
M.DEMO.forEach((d) => {
    [false, true].forEach((night) => {
        const name = d[0] + '_' + d[1] + '_' + (night ? 'night' : 'day');
        const s = M.withScene(d[2], 3000);          // a scene at 3 s into its loop
        const pg = P.centre(s, { night, lang, info: { age: s.data === 'ok' ? 0.5 : s.data === 'stale' ? 2 : null }, demo: d[0] });
        Rec.setImage(IMG, P.PAGE_W, P.PAGE_H, pg.px);
        const rc = new Rec.Recorder(1600, 520);
        rc.clear(M.colours('centre', night).bg);
        rc.image(IMG, 0, 520 - P.PAGE_H, P.PAGE_W, P.PAGE_H);
        const cv = new Canvas(1600, 520);
        Rec.play(rc.words(), cv);
        fs.writeFileSync(path.join(OUT, 'centre', name + '.png'), cv.png(6));
        const lead = M.leadOf(s), z = lead ? lead.x / M.RANGE : 0;
        const g = M.GEO.map, box = M.carBox(g, z, lead ? lead.y : 0);
        fs.writeFileSync(path.join(OUT, 'map', name + '.json'), JSON.stringify({
            state: d[0], name: d[1], night,
            lane: { rect: g.lane, u: M.laneUniforms(g, s, z, night) },
            obj: { rect: g.lane, u: M.objUniforms(g, s, night) },
            car: lead ? { rect: box, u: M.carUniforms(s, night, box[2], box[3]) } : null,
            text: { rect: g.text, px: P.textSheet(s, night, lang).toString('base64') },
            pill: { rect: g.pill, px: P.pillSheet(s, night, lang).toString('base64') },
        }));
    });
});
console.log('centre pages and map layers for 14 states x day / night in ' + path.relative(ROOT, OUT) + ' (now: shots.py)');
