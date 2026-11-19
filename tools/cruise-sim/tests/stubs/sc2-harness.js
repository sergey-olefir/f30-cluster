/*
 * A tiny synchronous test harness for SC2's tests (tests/stubs/: not run by test.js on its own).
 * Each *.test.js runs its cases when loaded (required by test.js or run with `node`), prints one line per
 * failure and a summary, sets process.exitCode and throws at the end if anything failed.
 */
'use strict';
var assert = require('assert');

function suite(name) {
  var cases = [];
  var api = {
    test: function (title, fn) { cases.push({ title: title, fn: fn }); },
    run: function () {
      var pass = 0; var fail = 0;
      cases.forEach(function (c) {
        try { c.fn(); pass++; } catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + c.title + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e)); }
      });
      console.log((fail ? 'FAIL ' : 'ok   ') + name + ': ' + pass + ' passed, ' + fail + ' failed');
      console.log('# pass ' + pass); console.log('# fail ' + fail);   // the counts test.js (SC1) reads
      api.result = { pass: pass, fail: fail };
      if (fail) { process.exitCode = 1; throw new Error(name + ': ' + fail + ' failed'); }
      return api.result;
    }
  };
  return api;
}

function near(actual, expected, tol, msg) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new assert.AssertionError({ message: (msg ? msg + ': ' : '') + 'expected ' + expected + ' +/- ' + tol + ', got ' + actual, actual: actual, expected: expected, operator: 'near' });
  }
}

module.exports = { suite: suite, near: near, assert: assert };
