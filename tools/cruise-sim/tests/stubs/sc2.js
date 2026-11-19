'use strict';
// Test doubles for SC2 / SC3 modules, so SC1's tests give the same numbers before and after their modules are merged.
const sim = require('../../core/sim');

const S = sim.STUBS;
function mod(name, create) { return { NAME: name, SCHEMA: [], LENIENT: true, create }; }

// the controller never changes the set speed
const holdController = mod('controller', () => ({ step: () => ({ vSet: null, vRef: NaN, dDes: NaN, reason: 'hold' }) }));
// the controller commands fn(t) (m/s or null)
const scriptController = fn => mod('controller', () => ({ step: inp => ({ vSet: fn(inp.t, inp), vRef: NaN, dDes: NaN, reason: 'script' }) }));
// the warning is on when fn(t, inp) is true
const scriptWarning = fn => mod('warning', () => ({ step: inp => { const w = !!fn(inp.t, inp); return { warn: w, reason: w ? 'test' : null, dNeeded: null, ttc: null }; } }));
const noWarning = scriptWarning(() => false);

// the stubs of sim.js, pinned
const pinned = { sensor: S.sensor, estimator: S.estimator, controller: S.controller, warning: S.warning, baselines: S.baselines, metrics: S.metrics };
function deps(over) { return Object.assign({}, pinned, over || {}); }

module.exports = { holdController, scriptController, scriptWarning, noWarning, pinned, deps };
