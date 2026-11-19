'use strict';
const { test, assert, near } = require('./harness');
const command = require('../core/command');
const schema = require('../core/schema');
const rng = require('../core/rng');
const DT = 0.01;

function mk(over, seed) { return command.create(schema.merge(command.SCHEMA, over || {}), rng.create(seed || 1).fork('command')); }

// send at the given times, deliver on the 10 ms grid, return every delivery
function play(c, sends, seconds, faultsAt) {
  const out = [];
  const n = Math.round(seconds / DT);
  let si = 0;
  for (let k = 0; k <= n; k++) {
    const t = k * DT;
    while (si < sends.length && sends[si][0] <= t + 1e-9) { c.send(t, sends[si][1], faultsAt ? faultsAt(t) : {}); si++; }
    for (const d of c.deliver(t)) out.push(d);
  }
  return out;
}

test('command: a fixed delay arrives on the first tick at or after it', () => {
  const c = mk({ delay_s: 0.25, jitter_s: 0 });
  const d = play(c, [[1, 30], [2, 28]], 3);
  assert.strictEqual(d.length, 2);
  near(d[0].tApplied, 1.25, 1e-9); near(d[1].tApplied, 2.25, 1e-9);
  assert.strictEqual(d[0].status, 'applied'); assert.strictEqual(d[0].vSet, 30);
  near(d[0].tSent, 1, 1e-12);
});

test('command: jitter stays within [delay, delay + jitter] and is reproducible', () => {
  const sends = []; for (let i = 0; i < 200; i++) sends.push([i * 0.5, 20 + (i % 7)]);
  const a = play(mk({ delay_s: 0.2, jitter_s: 0.3 }, 5), sends, 110);
  const b = play(mk({ delay_s: 0.2, jitter_s: 0.3 }, 5), sends, 110);
  assert.deepStrictEqual(a, b);
  for (const d of a) { const lat = d.tApplied - d.tSent; assert.ok(lat >= 0.2 - 1e-9 && lat <= 0.5 + DT + 1e-9, 'latency ' + lat); }
  const lats = a.map(d => d.tApplied - d.tSent);
  assert.ok(Math.max(...lats) - Math.min(...lats) > 0.2, 'jitter is used');
});

test('command: drop, silent rejection, duplicate; probabilities do not shift each other\'s draws', () => {
  const sends = []; for (let i = 0; i < 400; i++) sends.push([i * 0.2, 25]);
  const d1 = play(mk({ dropProb: 1 }), sends, 90);
  assert.ok(d1.every(d => d.status === 'dropped' && d.reason === 'lost'));
  const d2 = play(mk({ rejectProb: 1 }), sends, 90);
  assert.ok(d2.every(d => d.status === 'rejected' && d.silent));
  const d3 = play(mk({ dupProb: 1, dupDelay_s: 0.05 }), sends.slice(0, 10), 5);
  assert.strictEqual(d3.length, 20); assert.strictEqual(d3.filter(d => d.dup).length, 10);
  // the same seed: the jitter of every message is the same whatever dropProb is
  const j0 = play(mk({ jitter_s: 0.3 }, 9), sends, 90).map(d => d.tApplied);
  const j1 = play(mk({ jitter_s: 0.3, dropProb: 0.3 }, 9), sends, 90).map(d => d.tApplied);
  assert.deepStrictEqual(j0, j1);
  const share = play(mk({ dropProb: 0.3 }, 3), sends, 90).filter(d => d.status === 'dropped').length / 400;
  near(share, 0.3, 0.07);
});

test('command: reorder lets a later write overtake; late applies late', () => {
  const r = play(mk({ delay_s: 0.1, jitter_s: 0, reorderProb: 1, reorderDelay_s: 0.5 }), [[0, 30]], 1)
    .concat(play(mk({ delay_s: 0.1, jitter_s: 0 }), [[0.1, 31]], 1));
  assert.ok(r[0].tApplied > r[1].tApplied);
  const l = play(mk({ delay_s: 0.1, jitter_s: 0, lateProb: 1, lateDelay_s: 2 }), [[0, 30]], 3);
  near(l[0].tApplied, 2.1, 1e-9);
});

test('command: max accepted rate rejects what comes too soon after the last one let through', () => {
  const sends = []; for (let i = 0; i < 20; i++) sends.push([i * 0.1, 20 + i]);
  const d = play(mk({ delay_s: 0, jitter_s: 0, maxRate_hz: 2 }), sends, 3);
  const ok = d.filter(x => x.status === 'applied');
  assert.strictEqual(ok.length, 4, ok.map(x => x.tApplied).join(','));
  for (let i = 1; i < ok.length; i++) assert.ok(ok[i].tApplied - ok[i - 1].tApplied >= 0.5 - 1e-9);
  assert.ok(d.filter(x => x.reason === 'rate').length === 16);
});

test('command: stalls hold deliveries until the head unit runs again; their rate is as asked', () => {
  const c = mk({ delay_s: 0.1, jitter_s: 0, stallRate_perMin: 6, stallMin_s: 0.5, stallMax_s: 1.5 }, 4);
  let stalledTicks = 0, starts = 0, prev = false;
  for (let k = 0; k < 60000; k++) { const s = c.stalled(k * DT); if (s) stalledTicks++; if (s && !prev) starts++; prev = s; }
  near(starts / 10, 6, 1.5, 'stalls per minute');
  near(stalledTicks * DT / starts, 1.0, 0.2, 'mean stall');
  // a message due during a stall arrives at its end
  const st = c.stallsUntil(600)[0];
  const c2 = mk({ delay_s: 0.1, jitter_s: 0, stallRate_perMin: 6, stallMin_s: 0.5, stallMax_s: 1.5 }, 4);
  const d = play(c2, [[st[0] - 0.05, 30]], st[1] + 1);
  assert.ok(d[0].tApplied >= st[1] - 1e-9 && d[0].tApplied < st[1] + DT + 1e-9, d[0].tApplied + ' vs ' + st[1]);
});

test('command: faults lose the next decrease only, or everything; a restart empties the path', () => {
  const sends = [[0, 30], [1, 31], [2, 29], [3, 28], [4, 32]];
  const d = play(mk({ delay_s: 0.1, jitter_s: 0 }), sends, 5, t => ({ commandsLost: t >= 0.5 ? 'nextDecrease' : null }));
  // the command module drops every decrease while the flag is on; failures.consume turns it off after the first (sim.js)
  assert.strictEqual(d.find(x => x.vSet === 29).status, 'dropped');
  assert.strictEqual(d.find(x => x.vSet === 31).status, 'applied');
  assert.strictEqual(d.find(x => x.vSet === 32).status, 'applied');
  const all = play(mk({}), sends, 5, () => ({ commandsLost: 'all' }));
  assert.ok(all.every(x => x.status === 'dropped' && x.reason === 'fault'));
  const c = mk({ delay_s: 5 });
  c.send(0, 30); c.send(0.1, 29);
  const lost = c.reset(1);
  assert.strictEqual(lost.length, 2); assert.ok(lost.every(x => x.status === 'dropped' && x.reason === 'restart'));
  assert.strictEqual(c.inFlight(), 0);
});
