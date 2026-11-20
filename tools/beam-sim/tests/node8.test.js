'use strict';
// shared/beam_logic.js is Node 8.16 syntax (the car's) and pure (ROUND.md §3, BRIEF-HA §2):
//  1. syntax: parsed by acorn at ecmaVersion 2017 (Node's own bundled acorn, --expose-internals); the checker is
//     shown to reject ?. ?? object spread and the other post-Node-8 forms (negative controls);
//  2. no newer built-in API (flat, fromEntries, globalThis, ...);
//  3. pure: names no clock, randomness, I/O, timer or require; runs in a vm context without Date, Math.random,
//     console, process, require or timers, writes no global, and gives the same outputs as the Node-loaded module;
//  4. no lamp: the module names no setter, method call or write of the car (a static scan of its text).
const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { test, assert } = require('./harness');

const FILE = path.join(__dirname, '..', '..', '..', 'shared', 'beam_logic.js');
const CHECK = path.join(__dirname, 'stubs', 'node8-check.js');
function check(file, src) {
  const r = cp.spawnSync(process.execPath, ['--expose-internals', CHECK].concat(file ? [file] : []), { input: src || '', encoding: 'utf8' });
  if (r.status !== 0) throw new Error('checker failed: ' + r.stderr);
  return JSON.parse(r.stdout);
}
const probe = check(null, 'var x = 1;');

if (probe.unavailable) {
  test('node8: no acorn reachable in this Node; the syntax half is skipped', () => {});
} else {
  test('the checker rejects post-Node-8 syntax and accepts Node 8 syntax (controls)', () => {
    const bad = {
      'optional chaining': 'var a = {}; var b = a?.c;', 'nullish coalescing': 'var a = null; var b = a ?? 1;',
      'object spread': 'var a = {}; var b = { ...a };', 'object rest': 'var { x, ...rest } = { x: 1 };',
      'class field': 'class A { x = 1; }', 'optional catch binding': 'try { f(); } catch { }', 'logical assignment': 'var a; a ||= 1;',
      'numeric separator': 'var a = 1_000;', 'bigint': 'var a = 10n;',
    };
    Object.keys(bad).forEach((k) => assert.strictEqual(check(null, bad[k]).ok, false, k + ' must be rejected'));
    assert.strictEqual(check(null, 'const f = (a, ...r) => { const [x] = [1]; return `${x}` + r.length; };').ok, true);
  });

  test('beam_logic.js parses as ES2017 and uses no newer built-in API', () => {
    const r = check(FILE);
    assert.strictEqual(r.ok, true, r.error);
    ['flat', 'flatMap', 'fromEntries', 'matchAll', 'replaceAll', 'at', 'allSettled', 'any', 'trimStart', 'trimEnd', 'finally', 'hasOwn', 'findLast', 'findLastIndex']
      .forEach((m) => assert.ok(r.members.indexOf(m) < 0, 'uses .' + m));
    ['globalThis', 'BigInt', 'queueMicrotask', 'structuredClone', 'WeakRef'].forEach((g) => assert.ok(r.identifiers.indexOf(g) < 0, 'uses ' + g));
  });

  test('beam_logic.js names no clock, randomness, I/O, timer or require', () => {
    const r = check(FILE);
    ['Date', 'performance', 'console', 'process', 'require', 'setTimeout', 'setInterval', 'setImmediate', 'fetch', 'XMLHttpRequest',
      'window', 'document', 'localStorage', 'Buffer', 'crypto', 'global', 'globalThis'].forEach((g) => assert.ok(r.identifiers.indexOf(g) < 0, 'refers to ' + g));
    assert.ok(r.members.indexOf('random') < 0, 'Math.random');
    assert.ok(r.members.indexOf('now') < 0, '.now');
  });
}

function exercise(B) {
  const out = [];
  ['advise', 'auto'].forEach((mode) => {
    const i = B.create({ mode: mode, verdict: { use: 'follow' } });
    for (let k = 0; k < 400; k++) {
      const t = k * 100;
      const lights = k > 150 && k < 200 ? [{ id: 2, cls: 1, status: k % 7 ? 2 : 1, x: 120 + (k % 5), y: 125, w: 9, h: 3, dist: 110 - (k - 150) * 2, wl: 127, wr: 127 }] : [];
      out.push(i.step({ t: t, lights: { v: lights, age: 30, ok: true }, verdict: k > 300 ? { v: { allow: k % 3 }, age: 10, ok: true } : undefined,
        car: { v: { speed_kmh: k > 350 ? 20 : 80, yaw_dps: k > 220 && k < 240 ? 8 : 0 }, age: 5, ok: true },
        lamps: { v: { low: true, high: false, fog: false }, age: 5, ok: true }, env: { v: { brightness: 1, sun: 'night', limit_kmh: k > 260 && k < 280 ? 50 : 90 }, age: 1, ok: true },
        stalk: k === 250 ? { v: [{ t: t, kind: 'high_off' }], age: 0, ok: true } : undefined, app: k === 290 ? { v: { rearm: true } } : undefined }));
    }
  });
  return out;
}

test('runs in a bare context (no Date, Math.random, console, process, require, timers), writes no global, same outputs as under Node', () => {
  const load = () => {
    const ctx = vm.createContext({});
    vm.runInContext('delete globalThis.Date; Math.random = function () { throw new Error("Math.random called"); };' +
      'delete globalThis.console; delete globalThis.WebAssembly;', ctx);
    const before = vm.runInContext('Object.getOwnPropertyNames(globalThis).sort().join(",")', ctx);
    ctx.module = { exports: {} };
    vm.runInContext(fs.readFileSync(FILE, 'utf8'), ctx, { filename: 'beam_logic.js' });
    const X = ctx.module.exports;
    delete ctx.module;
    return { X: X, same: () => vm.runInContext('Object.getOwnPropertyNames(globalThis).sort().join(",")', ctx) === before };
  };
  const a = load(), b = load();
  const ra = JSON.stringify(exercise(a.X)), rb = JSON.stringify(exercise(b.X));
  assert.ok(a.same(), 'a global was written');
  assert.strictEqual(ra, rb);
  assert.strictEqual(ra, JSON.stringify(exercise(require(FILE))));
});

test('the page loads it as self.BeamLogic without leaking other names', () => {
  const ctx = vm.createContext({});
  vm.runInContext('var self = globalThis;', ctx);
  const before = vm.runInContext('Object.getOwnPropertyNames(globalThis).sort().join(",")', ctx);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), ctx);
  const after = vm.runInContext('Object.getOwnPropertyNames(globalThis).sort().join(",")', ctx);
  assert.deepStrictEqual(after.split(',').filter((n) => before.split(',').indexOf(n) < 0), ['BeamLogic']);
});

test('no lamp: the algorithm names no setter, method call, request or write of the car; no Cyrillic', () => {
  const src = fs.readFileSync(FILE, 'utf8');
  ['acknowledgeObjectData', 'LightswitchOperation', 'pushButton', 'setter', '.set(', '.call(', 'invoke', 'request(', 'standardCCMessage', 'A19B', 'writeField', 'sendMethod']
    .forEach((w) => assert.ok(src.indexOf(w) < 0, 'mentions ' + w));
  assert.ok(!/[Ѐ-ӿ]/.test(src), 'Cyrillic in the module');
});

test('the simulator\'s core names no car API either (it models the beam, it switches nothing)', () => {
  const dir = path.join(__dirname, '..', 'core');
  fs.readdirSync(dir).forEach((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    ['acknowledgeObjectData', 'LightswitchOperation', 'pushButton', 'someip', 'SOME/IP', 'uds', 'cluster_render'].forEach((w) => assert.ok(src.toLowerCase().indexOf(w.toLowerCase()) < 0, f + ' mentions ' + w));
    assert.ok(src.indexOf('Math.random') < 0, f + ' uses Math.random (use rng.fork)');
  });
});
