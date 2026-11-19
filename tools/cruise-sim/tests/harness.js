'use strict';
// A tiny test harness for tools/cruise-sim/tests/*.test.js (SC1). Optional: a test file may also be a plain script that
// throws or exits non-zero on failure. With the harness:
//   const { test, assert, near } = require('./harness');
//   test('name', () => { ... });            // sync, or return a promise
// It runs the tests after the file has registered them, prints "ok - name" / "not ok - name", then "# pass N" and
// "# fail M" (test.js reads those two lines), and sets the exit code.

const assert = require('assert');
const tests = [];
let scheduled = false;

function test(name, fn) {
  tests.push([name, fn]);
  if (!scheduled) { scheduled = true; setImmediate(runAll); }
}

function near(actual, expected, tol, msg) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new assert.AssertionError({ message: (msg ? msg + ': ' : '') + actual + ' is not within ' + tol + ' of ' + expected, actual, expected, operator: 'near' });
  }
}

async function runAll() {
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      pass++;
      console.log('ok - ' + name);
    } catch (e) {
      fail++;
      console.log('not ok - ' + name);
      console.log('  ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n  '));
    }
  }
  console.log('# pass ' + pass);
  console.log('# fail ' + fail);
  process.exitCode = fail ? 1 : 0;
}

module.exports = { test, assert, near };
