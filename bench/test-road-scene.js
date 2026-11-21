'use strict';
/**
 * bench/test-road-scene.js - Road Scene 0.1.0, ACC View and Auto Beam merged into one app with one scene (round fixes-1121 RS,
 * docs/fixes-1121/BRIEF-RS-merge-road-scene.md). ONE suite: every check of the old suites that still applies is carried over
 * (renamed or merged, none dropped; the parts live in bench/road_scene/), and the merge's own checks are added.
 *
 *   node bench/test-road-scene.js [--no-bench] [--no-gl] [--no-emu] [--only acc|lanes|beam|merged] [--port 8941]
 *   (BENCH_PORT also sets the port; the default 8941. The bench parts use the port and the next one; the emulator port + 7.)
 *
 *   merged  (bench/road_scene/merged.js)   the merge itself: the names and the Store, the one scene in every ACC View and beam
 *           state day and night, a light source that is a road user drawn once, the beams only at night, the advice's colours,
 *           one loop and one map connection, the layers, the pixel memory and the shader bytes, the rear-axle path at a full
 *           lock, the measured lanes unchanged, the settings and the profile table, the interfaces
 *   acc     (bench/road_scene/acc.js)      ACC View's suite (bench/test-acc-view.js, round 1120 AA2 / fixes-1121 AL): pure,
 *           WebGL, emulator, bench
 *   lanes   (bench/road_scene/lanes.js)    AL's lane suite (bench/test-acc-lanes.js): pure
 *   beam    (bench/road_scene/beam.js)     Auto Beam's suite (bench/test-auto-beam.js, round "Auto Beam" package HD): pure, WebGL, bench
 */
const Cm = require('./road_scene/common');

const args = Cm.args;
const only = args.indexOf('--only') >= 0 ? args[args.indexOf('--only') + 1] : null;
const want = (k) => !only || only === k;

(async () => {
    try {
        if (want('merged')) await require('./road_scene/merged')();
        if (want('lanes')) require('./road_scene/lanes')();
        if (want('acc')) await require('./road_scene/acc')();
        if (want('beam')) await require('./road_scene/beam')();
    } catch (e) {
        Cm.ok(false, 'the suite itself threw: ' + (e && e.stack || e));
    }
    console.log(Cm.T.pass + ' passed, ' + Cm.T.fail + ' failed');
    process.exit(Cm.T.fail ? 1 : 0);
})();
