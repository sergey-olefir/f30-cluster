'use strict';
/** SU1: ui/worker.js in a vm that plays a Web Worker's global (importScripts, postMessage). node tools/cruise-sim/tests/worker.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const A = require('../ui/app.js');

const UI = path.join(__dirname, '..', 'ui');

function makeWorker() {
    const out = [];
    const g = { console, setTimeout, clearTimeout };
    g.self = g;
    g.postMessage = (m, transfer) => out.push({ m, transfer: transfer || [] });
    const ctx = vm.createContext(g);
    g.importScripts = (rel) => {
        const file = path.resolve(UI, rel);
        if (!fs.existsSync(file)) throw new Error('NetworkError: ' + rel);
        vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
    };
    vm.runInContext(fs.readFileSync(path.join(UI, 'worker.js'), 'utf8'), ctx, { filename: 'worker.js' });
    return { g, out, send: (m) => g.onmessage({ data: m }) };
}

test('a run before init is an error; without core/sim.js a run is an error the page falls back on', () => {
    const w = makeWorker();
    w.send({ type: 'run', id: 1, config: {} });
    assert.equal(w.out[0].m.type, 'error');
    assert.match(w.out[0].m.message, /not initialised/);
    w.send({ type: 'init', files: ['../core/no-such-file.js'] });
    assert.equal(w.out[1].m.type, 'ready');
    assert.equal(w.out[1].m.files.length, 0, 'arrays from the vm realm: compare by length');
    w.send({ type: 'run', id: 2, config: {} });
    assert.deepEqual([w.out[2].m.type, w.out[2].m.id], ['error', 2]);
    assert.match(w.out[2].m.message, /core\/sim\.js is not loaded/);
});

const SIM = path.join(__dirname, '..', 'core', 'sim.js');
test('with the engine: init loads the page\'s script list, a run reports progress and returns the result with its buffers transferred',
    { skip: !fs.existsSync(SIM) && 'core/sim.js not in this checkout' }, () => {
        const w = makeWorker();
        w.send({ type: 'init', files: A.scriptList() });
        const ready = w.out.find((x) => x.m.type === 'ready').m;
        assert.ok(ready.files.indexOf('../core/sim.js') >= 0);
        w.send({ type: 'run', id: 7, config: { seed: 1, duration: 20 } });
        const prog = w.out.filter((x) => x.m.type === 'progress' && x.m.id === 7).map((x) => x.m.frac);
        assert.ok(prog.length >= 5 && prog.every((f, i) => f >= 0 && f <= 1 && (i === 0 || f >= prog[i - 1])), JSON.stringify(prog));
        const res = w.out.find((x) => x.m.type === 'result');
        assert.equal(res.m.id, 7);
        const r = A.normalizeResult(res.m.result);
        assert.equal(r.t[r.t.length - 1], 20);
        assert.ok(res.transfer.length > 10 && res.transfer.indexOf(res.m.result.t.buffer) >= 0);
        // the same config in Node gives the same numbers (the worker adds nothing)
        const direct = require(SIM).run({ seed: 1, duration: 20 });
        assert.deepEqual(Array.from(res.m.result.series['ego.v']), Array.from(direct.series['ego.v']));
    });
