'use strict';
// The one seeded generator of the beam simulator (mulberry32). Nothing in the simulator calls Math.random:
// every module takes rng.fork('<label>'), an independent stream that is stable per label, so adding a draw in one
// module never shifts the numbers of another.
(function () {
  function hash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function create(seed) {
    let a = (typeof seed === 'number' ? seed : hash(String(seed))) >>> 0;
    const base = a;
    function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      normal: function (mean, sd) {
        let u = 0, v = 0;
        while (u === 0) u = next();
        while (v === 0) v = next();
        return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      },
      int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      chance: function (p) { return next() < p; },
      fork: function (label) { return create((base ^ hash(String(label))) >>> 0); },
    };
  }
  const X = { create: create, hash: hash };
  if (typeof module !== 'undefined') module.exports = X; else (self.BS = self.BS || {}).rng = X;
})();
