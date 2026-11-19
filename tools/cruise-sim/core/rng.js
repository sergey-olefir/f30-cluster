'use strict';
// The one seeded random generator of the simulator (SC1). Nothing in core/ calls Math.random.
//
//   rng.create(seed) -> { next() [0,1), normal(mean, sd), int(lo, hi) inclusive, pick(arr), fork(label),
//                         uniform(lo, hi), chance(p), lognormal(median, sigma), exp(mean), seed, key }
//
// A stream is sfc32 seeded from a 32-bit hash of its key. The key of create(seed) is String(seed); the key of
// fork(label) is "<parent key>/<label>", so a fork depends only on the root seed and the label path, never on how many
// numbers the parent has drawn: adding a draw in one module never shifts another module's stream.
// Integer arithmetic only (Math.imul, >>> 0), so next() gives the same bits on every JS engine. normal() uses
// Math.log and Math.sqrt (the polar method); V8 (Node and Chrome) give identical results, which is what the
// determinism test checks.

function hashString(s) {
  // FNV-1a over UTF-16 code units, then a murmur3 finaliser
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function splitmix32(a) {
  return function () {
    a = (a + 0x9e3779b9) | 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

function create(seed) {
  const key = String(seed === undefined || seed === null ? 1 : seed);
  const sm = splitmix32(hashString(key));
  let a = sm(), b = sm(), c = sm(), d = sm();
  function u32() {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  }
  for (let i = 0; i < 12; i++) u32();   // warm-up

  let spare = null;
  const r = {
    seed: seed,
    key: key,
    next() { return u32() / 4294967296; },
    uniform(lo, hi) { return lo + (hi - lo) * (u32() / 4294967296); },
    chance(p) { return p > 0 && u32() / 4294967296 < p; },
    int(lo, hi) {
      lo = Math.ceil(lo); hi = Math.floor(hi);
      if (hi < lo) throw new Error('rng.int: empty range ' + lo + '..' + hi);
      return lo + Math.floor((u32() / 4294967296) * (hi - lo + 1));
    },
    pick(arr) {
      if (!arr || !arr.length) throw new Error('rng.pick: empty array');
      return arr[Math.floor((u32() / 4294967296) * arr.length)];
    },
    normal(mean, sd) {
      if (mean === undefined) mean = 0;
      if (sd === undefined) sd = 1;
      let z;
      if (spare !== null) { z = spare; spare = null; }
      else {
        let x, y, s;
        do {
          x = 2 * (u32() / 4294967296) - 1;
          y = 2 * (u32() / 4294967296) - 1;
          s = x * x + y * y;
        } while (s >= 1 || s === 0);
        const m = Math.sqrt(-2 * Math.log(s) / s);
        z = x * m; spare = y * m;
      }
      return mean + sd * z;
    },
    lognormal(median, sigma) { return median * Math.exp(sigma * r.normal(0, 1)); },
    exp(mean) { return -mean * Math.log(1 - u32() / 4294967296); },
    fork(label) { return create(key + '/' + label); },
  };
  return r;
}

const rng = { create: create, hashString: hashString };
if (typeof module !== 'undefined') module.exports = rng; else (self.CS = self.CS || {})['rng'] = rng;
