'use strict';
// SU2's copy of the test protocol of tools/cruise-sim/test.js (SC1): register tests, then print
// "ok - name" / "not ok - name", "# pass N", "# fail M", and set the exit code. Kept separate from
// SC1's tests/harness.js so the two branches never touch the same file.
const assert = require('assert');
const tests = [];
let scheduled = false;

function test(name, fn) {
  tests.push([name, fn]);
  if (!scheduled) { scheduled = true; setImmediate(runAll); }
}

function near(actual, expected, tol, msg) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new assert.AssertionError({ message: (msg ? msg + ': ' : '') + actual + ' is not within ' + tol + ' of ' + expected, actual: actual, expected: expected, operator: 'near' });
  }
}

async function runAll() {
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('ok - ' + name); }
    catch (e) { fail++; console.log('not ok - ' + name); console.log('  ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n  ')); }
  }
  console.log('# pass ' + pass);
  console.log('# fail ' + fail);
  process.exitCode = fail ? 1 : 0;
}

module.exports = { test: test, assert: assert, near: near };
