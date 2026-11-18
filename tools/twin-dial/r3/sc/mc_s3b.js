'use strict';
/**
 * mc_s3b.js - SC: research3/MC's recommended release replayed on the REAL engine (tools/research3/mc/engine.js) in one
 * case MC's set lacks: a door message, then a second one whose "shown now" number arrives before ccList lists it again
 * (MC's S3, after an earlier listing in the same run).
 *
 *   node tools/twin-dial/r3/sc/mc_s3b.js
 *
 * Result (2026-11-18): with `rec` or `leftlist` the three f30 views cover BMW's panel while the door message shows and
 * no text of ours is drawn (UNSAFE x2: the step and the 2 s wait); Twin Dial (no release hook) stays open.
 * Cause: shared/hud.js _ccRelease leftList releases any number whose entry was ever listed and is not listed now, a
 * number notified anew included. SC's refinement (centre_cc.js CarSim): release only a number KEPT from before its
 * entry left (A3, A4), never one that changed to it afterwards.
 */
const path = require('path');
const MC = path.join(__dirname, '..', '..', '..', 'research3', 'mc');
const C = require(path.join(MC, 'cases.js'));
const E = require(path.join(MC, 'engine.js'));
const REST = { id: 0, color: 'green', symbol: 6, len: 14 }, DOOR = { id: 15, color: 'white', symbol: 2, len: 16 };
const L = (...e) => ['list', e], A = (n, c) => ['active', E.active(n, c)], W = (ms) => ['wait', ms];
const cs = { id: 'S3b', what: 'S3 after an earlier door message in the same run',
    steps: [['none', L(REST), A(0)], ['msg', L(REST, DOOR), A(15)], ['none', L(REST), A(0)], ['msg', A(15)], ['msg', W(2000)], ['msg', L(REST, DOOR)], ['none', L(REST), A(0)]] };
let unsafe = 0;
for (const fix of ['none', 'rec', 'leftlist']) {
    for (const v of C.VIEWS) {
        const r = C.runCase(cs, v, fix);
        if (fix !== 'none') unsafe += r.unsafe;
        console.log(fix.padEnd(9), v.key.padEnd(18), 'unsafe', r.unsafe, r.steps.map((s) => s.truth + '>' + (s.open ? 'open' : s.ours ? 'ours' : 'shut')).join(' '));
    }
}
console.log(unsafe ? 'S3b: MC\'s leftList is UNSAFE in ' + unsafe + ' step(s)' : 'S3b: safe');
