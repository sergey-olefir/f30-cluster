/*
 * SC2's stand-in for SC1's core/rng.js, shaped as CONTRACT "Random numbers":
 * create(seed) -> { next(), normal(mean, sd), int(lo, hi), pick(arr), fork(label) }.
 * Used only until SC1's rng exists; the tests prefer the real one when it is there.
 */
'use strict';
function hash(str, seed) {
  var h = (seed ^ 0x9e3779b9) >>> 0;
  for (var i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 0x85ebca6b); h ^= h >>> 13; }
  return h >>> 0;
}
function create(seed) {
  var a = (seed >>> 0) || 1;
  var spare = null;
  var r = {
    next: function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    },
    normal: function (mean, sd) {
      var z;
      if (spare !== null) { z = spare; spare = null; } else {
        var u1 = Math.max(1e-12, r.next()); var u2 = r.next(); var m = Math.sqrt(-2 * Math.log(u1));
        spare = m * Math.sin(2 * Math.PI * u2); z = m * Math.cos(2 * Math.PI * u2);
      }
      return (mean || 0) + (sd === undefined ? 1 : sd) * z;
    },
    int: function (lo, hi) { return lo + Math.floor(r.next() * (hi - lo + 1)); },
    pick: function (arr) { return arr[Math.floor(r.next() * arr.length)]; },
    fork: function (label) { return create(hash(String(label), seed >>> 0)); }
  };
  return r;
}
module.exports = { create: create };
