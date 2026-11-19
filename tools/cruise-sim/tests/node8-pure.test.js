'use strict';
// SC2: estimator.js, controller.js, warning.js are Node 8.16 syntax and pure (CONTRACT "Language and style",
// brief §6). sensor.js and baselines.js are held to the same syntax rule.
//  1. syntax: parsed by acorn at ecmaVersion 2017 (Node's own bundled acorn, run with --expose-internals);
//     the checker is shown to reject ?. ?? object spread, class fields and the other post-Node-8 forms;
//  2. no newer built-in API (flat, fromEntries, globalThis, ...), found from the parsed names;
//  3. pure: no clock, randomness, I/O, timers or require in the three files (by name), and at run time in a
//     vm context where Date, Math.random, console, process, require and the timers do not exist — and the
//     context's globals are the same before and after (only the module export is written).
var H = require('./stubs/sc2-harness');
var cp = require('child_process'); var path = require('path'); var fs = require('fs'); var vm = require('vm');
var assert = H.assert;
var S = H.suite('node8-pure');

var CORE = path.join(__dirname, '..', 'core');
var CHECK = path.join(__dirname, 'stubs', 'sc2-node8-check.js');
var PURE = ['estimator.js', 'controller.js', 'warning.js'];
var ALSO = ['sensor.js', 'baselines.js'];

function check(file, src) {
  var r = cp.spawnSync(process.execPath, ['--expose-internals', CHECK].concat(file ? [file] : []), { input: src || '', encoding: 'utf8' });
  if (r.status !== 0) throw new Error('checker failed: ' + r.stderr);
  return JSON.parse(r.stdout);
}

var probe = check(null, 'var x = 1;');
if (probe.unavailable) {
  console.log('  node8-pure: no acorn reachable in this Node; the syntax half is skipped');
}

if (!probe.unavailable) {
  S.test('the checker rejects post-Node-8 syntax and accepts Node 8 syntax (negative and positive controls)', function () {
    var bad = {
      'optional chaining': 'var a = {}; var b = a?.c;',
      'nullish coalescing': 'var a = null; var b = a ?? 1;',
      'object spread': 'var a = {}; var b = { ...a };',
      'object rest': 'var { x, ...rest } = { x: 1 };',
      'class field': 'class A { x = 1; }',
      'private field': 'class A { #x = 1; }',
      'optional catch binding': 'try { f(); } catch { }',
      'logical assignment': 'var a; a ||= 1;',
      'numeric separator': 'var a = 1_000;',
      'bigint': 'var a = 10n;',
      'regex lookbehind': 'var r = /(?<=a)b/;',
      'async iteration': 'async function f(xs) { for await (var x of xs) {} }'
    };
    Object.keys(bad).forEach(function (k) { assert.strictEqual(check(null, bad[k]).ok, false, k + ' must be rejected'); });
    var good = 'const f = async (a, ...r) => { const [x, y] = [1, 2]; let s = `${x}`; await null; return 2 ** 3 + [...r].length; };' +
      ' class B { m() { return 1; } } function g(a = 1, { b } = {}) { return a + b; }';
    assert.strictEqual(check(null, good).ok, true, 'Node 8 syntax accepted: ' + check(null, good).error);
  });

  PURE.concat(ALSO).forEach(function (f) {
    S.test(f + ' parses as ES2017 and uses no newer built-in API', function () {
      var r = check(path.join(CORE, f));
      assert.strictEqual(r.ok, true, f + ': ' + r.error);
      var newer = ['flat', 'flatMap', 'fromEntries', 'matchAll', 'replaceAll', 'at', 'allSettled', 'any', 'trimStart', 'trimEnd', 'finally', 'hasOwn', 'findLast', 'findLastIndex'];
      newer.forEach(function (m) { assert.ok(r.members.indexOf(m) < 0, f + ' uses .' + m); });
      ['globalThis', 'BigInt', 'queueMicrotask', 'structuredClone', 'AggregateError', 'WeakRef'].forEach(function (g) { assert.ok(r.identifiers.indexOf(g) < 0, f + ' uses ' + g); });
    });
  });

  PURE.forEach(function (f) {
    S.test(f + ' names no clock, randomness, I/O, timer or require', function () {
      var r = check(path.join(CORE, f));
      ['Date', 'performance', 'console', 'process', 'require', 'setTimeout', 'setInterval', 'setImmediate', 'fetch', 'XMLHttpRequest',
        'window', 'document', 'localStorage', 'Buffer', 'crypto', 'global', 'globalThis'].forEach(function (g) {
        assert.ok(r.identifiers.indexOf(g) < 0, f + ' refers to ' + g);
      });
      assert.ok(r.members.indexOf('random') < 0, f + ' uses Math.random');
      assert.ok(r.members.indexOf('now') < 0, f + ' uses .now');
    });
  });
}

// ---- run time: a bare context ----
function loadBare(file) {
  var ctx = vm.createContext({});
  vm.runInContext('delete globalThis.Date; Math.random = function () { throw new Error("Math.random called"); };' +
    'delete globalThis.WebAssembly; delete globalThis.SharedArrayBuffer; delete globalThis.Atomics;', ctx);
  var before = vm.runInContext('Object.getOwnPropertyNames(globalThis).sort().join(",")', ctx);
  ctx.module = { exports: {} };
  vm.runInContext(fs.readFileSync(path.join(CORE, file), 'utf8'), ctx, { filename: file });
  var X = ctx.module.exports;
  delete ctx.module;
  return { X: X, ctx: ctx, globalsUnchanged: function () { return vm.runInContext('Object.getOwnPropertyNames(globalThis).sort().join(",")', ctx) === before; } };
}

var exercise = {
  'estimator.js': function (X) {
    var out = [];
    ['kalman', 'kalmanCA', 'alphaBeta', 'raw'].forEach(function (mode) {
      var e = X.create({ mode: mode });
      for (var i = 0; i < 200; i++) {
        var t = i * 0.1;
        var m = i % 13 === 7 ? null : { t: t, tMeas: t - 0.1, seq: i, valid: i % 50 < 45, id: i < 100 ? 1 : 2, gap: 50 - i * 0.1 + (i % 3) * 0.2, vrel: -1, qual: 'ok' };
        out.push(e.update(m, t, { egoV: 25, egoA: 0.2 }));
      }
    });
    return out;
  },
  'controller.js': function (X) {
    var c = X.create({}); var out = [];
    for (var i = 0; i < 300; i++) {
      var t = i * 0.1;
      out.push(c.step({ t: t, est: i % 40 < 30 ? { valid: true, stale: false, gap: 40 + 5 * Math.sin(t), vlead: 22, vrel: -3, alead: 0 } : { valid: false, stale: i > 250 },
        egoV: 25, egoA: 0, vDriver: 33, cruise: { state: i > 280 ? 'suspended' : 'active', setHeld: 25 }, curvature: i > 120 && i < 160 ? 0.003 : 0 }));
    }
    return out;
  },
  'warning.js': function (X) {
    var w = X.create({}); var out = [];
    for (var i = 0; i < 200; i++) {
      var t = i * 0.1;
      out.push(w.step({ t: t, est: i < 150 ? { valid: true, stale: false, gap: 80 - i * 0.5, vlead: 20, vrel: -8 } : { valid: false, stale: true, sensorFault: true }, egoV: 28, aMin: -1 }));
    }
    return out;
  }
};

PURE.forEach(function (f) {
  S.test(f + ' runs in a bare context (no Date, Math.random, console, process, require, timers) and writes no global', function () {
    var a = loadBare(f); var b = loadBare(f);
    assert.ok(typeof a.X.create === 'function' && a.X.NAME, f + ' exports a model module');
    var ra = exercise[f](a.X); var rb = exercise[f](b.X);
    assert.ok(a.globalsUnchanged(), f + ' wrote a global');
    assert.strictEqual(JSON.stringify(ra), JSON.stringify(rb), f + ' is deterministic');
    // and the same as the Node-loaded module (the browser loads the same text)
    var rn = exercise[f](require(path.join(CORE, f)));
    assert.strictEqual(JSON.stringify(ra), JSON.stringify(rn));
  });
});

S.test('browser loading: the files register under self.CS without leaking top-level names', function () {
  var ctx = vm.createContext({});
  vm.runInContext('var self = globalThis;', ctx);
  var before = vm.runInContext('Object.getOwnPropertyNames(globalThis).sort().join(",")', ctx);
  ['sensor.js', 'estimator.js', 'controller.js', 'warning.js', 'baselines.js'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(CORE, f), 'utf8'), ctx, { filename: f });
  });
  var after = vm.runInContext('Object.getOwnPropertyNames(globalThis).sort().join(",")', ctx);
  var added = after.split(',').filter(function (n) { return before.split(',').indexOf(n) < 0; });
  assert.deepStrictEqual(added, ['CS'], 'only CS is added');
  assert.strictEqual(vm.runInContext('Object.keys(self.CS).sort().join(",")', ctx), 'baselines,controller,estimator,sensor,warning');
});

S.run();
