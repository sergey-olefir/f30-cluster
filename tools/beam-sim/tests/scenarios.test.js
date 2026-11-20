'use strict';
// The scenario library: every file is valid and has a one-line purpose; every scenario holds the safety invariants
// and its own expectations on seeds 1, 2 and 3; the families named in the brief are all there.
const { test, assert } = require('./harness');
const SIM = require('../core/sim');
const SC = require('../core/scenario');

const list = SC.list();

test('at least 40 scenarios, unique ids, file name = id, every family A..K present', () => {
  assert.ok(list.length >= 40, list.length + ' scenarios');
  const ids = list.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  SC.files().forEach((f) => assert.strictEqual(f, SC.load(f.replace(/\.json$/, '')).id + '.json'));
  'ABCDEFGHIJK'.split('').forEach((f) => assert.ok(list.some((s) => s.family === f), 'family ' + f));
});

list.forEach((l) => {
  test(l.id + ': valid, one-line purpose, invariants and expectations hold on seeds 1-3', () => {
    const s = SC.load(l.id);
    assert.deepStrictEqual(SC.validate(s), []);
    assert.ok(s.purpose.indexOf('\n') < 0 && s.purpose.length < 200);
    assert.ok(s.expect && Object.keys(s.expect).length, 'has expectations');
    [1, 2, 3].forEach((seed) => {
      const r = SIM.run(s, { seed: seed });
      assert.ok(r.verdict.pass, 'seed ' + seed + ': ' + r.verdict.failed.join(', '));
      assert.strictEqual(r.metrics.exception, 0);
    });
  });
});

test('validate() rejects broken scenarios', () => {
  assert.ok(SC.validate(null).length);
  assert.ok(SC.validate({ format: 'beam-scenario', version: 1, id: 'x' }).length, 'neither world nor frames');
  assert.ok(SC.validate({ format: 'beam-scenario', version: 1, id: 'x', world: {}, duration_s: 10, purpose: 'p', frames: [] }).length, 'both');
  assert.ok(SC.validate({ format: 'beam-scenario', version: 1, id: 'x', frames: [{ t: 2 }, { t: 1 }] }).length, 't goes back');
  assert.ok(SC.validate({ format: 'beam-scenario', version: 1, id: 'x', duration_s: 5, purpose: 'p', world: { users: [{ kind: 'ufo' }] } }).length);
  assert.deepStrictEqual(SC.validate({ format: 'beam-scenario', version: 1, id: 'x', frames: [{ t: 1 }, { t: 2 }] }), []);
});
