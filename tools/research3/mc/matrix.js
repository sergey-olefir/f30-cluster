'use strict';
/**
 * matrix.js - research round 3, package MC: every case of cases.js under every candidate fix, in every view, as one
 * table (design/research3/mc/matrix.json), and 0.7.20's log lines per case (design/research3/mc/logs-0.7.20.json; the
 * f30 opaque view and Twin Dial, the legacy "probe:" lines left out). Numbers only: the engine never logs text.
 *
 *   node tools/research3/mc/matrix.js
 */
const fs = require('fs');
const path = require('path');
const C = require('./cases');

const OUT = path.join(__dirname, '..', '..', '..', 'design', 'research3', 'mc');
fs.mkdirSync(OUT, { recursive: true });
const matrix = { views: C.VIEWS.map((v) => v.key), fixes: Object.keys(C.FIXES), cases: {} };
const logs = {};
C.CASES.forEach((cs) => {
    matrix.cases[cs.id] = { what: cs.what, by: {} };
    Object.keys(C.FIXES).forEach((fx) => {
        matrix.cases[cs.id].by[fx] = C.VIEWS.map((v) => {
            const r = C.runCase(cs, v, fx);
            if (fx === 'none' && (v.key === 'f30 opaque' || v.key === 'twin')) {
                (logs[cs.id] = logs[cs.id] || { what: cs.what })[v.key] = {
                    steps: r.steps.map((s) => ({ t: s.t, truth: s.truth, window: s.open ? 'open' : s.ours ? 'ours' : 'shut' })),
                    log: r.log.filter((l) => !/ probe: /.test(l)),
                };
            }
            return (r.endsOpen ? 'HANG ' + r.endWhat : 'ok') + (r.unsafe ? ' UNSAFE x' + r.unsafe : '');
        });
    });
});
fs.writeFileSync(path.join(OUT, 'matrix.json'), JSON.stringify(matrix, null, 1));
fs.writeFileSync(path.join(OUT, 'logs-0.7.20.json'), JSON.stringify(logs, null, 1));
// the summary: per fix, how many case x view cells hang or are unsafe
Object.keys(C.FIXES).forEach((fx) => {
    let hang = 0, unsafe = 0;
    Object.keys(matrix.cases).forEach((id) => matrix.cases[id].by[fx].forEach((cell, i) => {
        if (matrix.views[i] === 'twin') return;
        if (/HANG/.test(cell)) hang++;
        if (/UNSAFE/.test(cell)) unsafe++;
    }));
    console.log(fx.padEnd(10) + ' f30 cells hanging ' + String(hang).padStart(3) + ', unsafe ' + unsafe);
});
console.log('wrote ' + path.join(OUT, 'matrix.json') + ' and logs-0.7.20.json');
