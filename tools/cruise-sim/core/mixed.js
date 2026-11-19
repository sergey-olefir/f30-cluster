(function () {
'use strict';
// (wrapped in a function: the page loads core/*.js as classic scripts, which share one global scope)
/*
 * Family L: hours of mixed driving strung from the other families with realistic frequencies (SC3).
 *
 *   generate(scenarioL)  -> [concrete episodes]   each a concrete scenario of its source family, with
 *                           .mixed = { L, road, kind: 'event'|'follow'|'free', weight, source }   (weight = how many times it
 *                           stands for; one run per distinct variant, so a 10-hour plan is a few hundred short runs)
 *   aggregate(records)   -> per-hour numbers     records = [{ concrete, metrics }] of ONE L scenario at one parameter point
 *   RATES, DENSITY       the frequency tables (events per hour of driving on that road type at 'mid' density)
 *
 * The rates are assumptions for a European commuter car (orders of magnitude, not measurements); the per-hour verdict is
 * only as good as they are, and the report says so. Episodes are independent runs: an event never overlaps the previous
 * one (a real drive can stack them; families D.double, E.cutin.double and J cover stacking on purpose).
 *
 * Time base: the per-hour numbers divide by the configured hours. Event episodes carry their own lead-in (steady following
 * before the event), so their summed durations exceed the event time; the filler fills only what the events leave.
 *
 * Driver reactions: an episode uses its 'react' case when its scenario has one, else 'none'. A warning on a 'none' run is
 * counted as one intervention (a warned driver would act).
 */

var scenarioMod = null;
function sc() { return scenarioMod || (scenarioMod = typeof require !== 'undefined' ? require('./scenario') : self.CS.scenario); }

var DENSITY = { low: 0.5, mid: 1, high: 1.8 };
var FOLLOW_SHARE = { low: 0.3, mid: 0.6, high: 0.85 };   // share of the non-event time spent following a lead

// filter: { param: [lo, hi] } on the concrete's params; v is checked against the road's band unless the entry says band: false
var RATES = {
  motorway: { band: [100, 150], follow: 'C.human', free: 'A.free.steady', events: [
    { id: 'B.approach', perHour: 10 },
    { id: 'B.approach.large', perHour: 0.5 },
    { id: 'B.approach.truck', perHour: 3 },
    { id: 'B.queue', perHour: 0.2 },
    { id: 'B.queue.crawl', perHour: 0.2 },
    { id: 'C.osc', perHour: 2, filter: { amp: [2, 10] } },
    { id: 'C.square', perHour: 1 },
    { id: 'C.platoon', perHour: 1, band: [90, 120] },
    { id: 'C.accel.away', perHour: 4 },
    { id: 'D.brake', perHour: 12 },
    { id: 'D.slowdown', perHour: 6 },
    { id: 'D.tap', perHour: 4 },
    { id: 'D.brake.hard', perHour: 1, filter: { a: [-3, -2] } },
    { id: 'D.brake.hard', perHour: 0.05, filter: { a: [-6, -4] } },
    { id: 'D.double', perHour: 0.5 },
    { id: 'E.cutin.slower', perHour: 6, filter: { g: [15, 60] } },
    { id: 'E.cutin.slower', perHour: 0.5, filter: { g: [5, 10] } },
    { id: 'E.cutin.equal', perHour: 4, filter: { g: [10, 60] } },
    { id: 'E.cutin.faster', perHour: 4 },
    { id: 'E.cutin.withlead', perHour: 3 },
    { id: 'E.cutin.truck', perHour: 1 },
    { id: 'E.cutin.moto', perHour: 0.3 },
    { id: 'E.cutin.aborted', perHour: 1 },
    { id: 'F.reveal.slower', perHour: 2 },
    { id: 'F.reveal.slower.large', perHour: 0.2 },
    { id: 'F.reveal.standing', perHour: 0.02 },
    { id: 'F.reveal.faster', perHour: 3 },
    { id: 'F.reveal.none', perHour: 3, band: [60, 120] },
    { id: 'F.exit', perHour: 2 },
    { id: 'G.ghost', perHour: 0.5 },
    { id: 'G.wrongTarget', perHour: 0.5 },
    { id: 'G.dropout.burst', perHour: 1 },
    { id: 'G.curve.loss', perHour: 0.5, band: [90, 120] },
    { id: 'H.onramp', perHour: 2 },
    { id: 'H.limit.change', perHour: 1 },
    { id: 'H.ego.lanechange', perHour: 3 },
    { id: 'I.override', perHour: 1, band: [90, 120] },
    { id: 'I.brake.resume', perHour: 0.5, band: [90, 120] }
  ] },
  rural: { band: [60, 100], follow: 'C.human', free: 'A.free.steady', events: [
    { id: 'B.approach', perHour: 8 },
    { id: 'B.approach.truck', perHour: 2, band: [80, 100] },
    { id: 'B.approach.belowmin', perHour: 0.5 },
    { id: 'B.approach.curve', perHour: 2, band: [60, 100] },
    { id: 'C.drift', perHour: 2 },
    { id: 'C.truck.hill', perHour: 0.5, band: false },
    { id: 'D.brake', perHour: 8 },
    { id: 'D.tap', perHour: 3 },
    { id: 'D.brake.hard', perHour: 0.5, filter: { a: [-3, -2] } },
    { id: 'D.brake.stop', perHour: 0.3 },
    { id: 'E.cutin.slower', perHour: 1, filter: { g: [15, 60] } },
    { id: 'E.cutin.faster', perHour: 2 },
    { id: 'F.exit', perHour: 3, band: false },
    { id: 'F.reveal.none', perHour: 2 },
    { id: 'G.curve.loss', perHour: 4 },
    { id: 'G.curve.physical', perHour: 3, band: false },
    { id: 'H.junction', perHour: 2, band: false },
    { id: 'H.cruise.dropout', perHour: 0.5, band: false },
    { id: 'A.grade.down', perHour: 2 },
    { id: 'A.curves.free', perHour: 3, band: false }
  ] },
  town: { band: [40, 60], follow: 'C.human', free: 'A.free.steady', events: [
    { id: 'H.junction', perHour: 10, band: [50, 70] },
    { id: 'H.zone30', perHour: 4, band: false },
    { id: 'H.stopgo', perHour: 1, band: false },
    { id: 'H.cruise.dropout', perHour: 2, band: false },
    { id: 'D.brake', perHour: 10, band: [60, 60] },
    { id: 'D.brake.stop', perHour: 3, band: [60, 60] },
    { id: 'B.approach.belowmin', perHour: 3, band: [60, 60] },
    { id: 'E.cutin.slower', perHour: 3, band: [60, 60], filter: { g: [10, 30] } }
  ] }
};

function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(rand, lambda) {
  if (lambda <= 0) return 0;
  if (lambda > 30) {   // normal approximation
    var u = Math.max(1e-12, rand()), v = rand();
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)));
  }
  var L = Math.exp(-lambda), k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}

function inRange(x, r) { return typeof x !== 'number' || (x >= r[0] && x <= r[1]); }
function pickReaction(list) {
  // one reaction case per variant: 'react' if the scenario has it, else 'none' (else whatever there is)
  var byKey = {}, order = [];
  list.forEach(function (c) { if (!byKey[c.key]) { byKey[c.key] = []; order.push(c.key); } byKey[c.key].push(c); });
  return order.map(function (k) {
    var cs = byKey[k];
    return cs.filter(function (c) { return c.reaction === 'react'; })[0] || cs.filter(function (c) { return c.reaction === 'none'; })[0] || cs[0];
  });
}
function candidates(entry, band) {
  var all = pickReaction(sc().expand(entry.id));
  var b = entry.band === false ? null : (entry.band || band);
  return all.filter(function (c) {
    if (b && !inRange(c.params.v, b)) return false;
    var f = entry.filter || {};
    for (var k in f) if (!inRange(c.params[k], f[k])) return false;
    var sens = c.variant['cond.sensing'];
    return sens === undefined || sens === 'clear';
  });
}

function generate(sIn) {
  var s = sIn.generator ? sIn : sc().load(sIn);
  var g = s.generator, rand = mulberry32((g.seed || 1) * 7919 + 17);
  var dens = DENSITY[g.density || 'mid'], fShare = FOLLOW_SHARE[g.density || 'mid'];
  var hours = g.hours || 10, shares = g.shares || { motorway: 1 };
  var segLen = g.fillerSegment_s || 300, nFill = g.fillerSamples || 6;
  var out = {}, order = [];
  function add(c, road, kind, weight, source) {
    var id = s.id + ':' + c.id;
    if (!out[id]) {
      var cc = JSON.parse(JSON.stringify(c));
      cc.id = id; cc.groupKey = id; cc.key = id; cc.family = 'L'; cc.decide = [];
      cc.mixed = { L: s.id, road: road, kind: kind, weight: 0, source: source, sourceFamily: c.family, hoursTotal: hours };
      out[id] = cc; order.push(id);
    }
    out[id].mixed.weight += weight;
  }
  Object.keys(shares).forEach(function (road) {
    var share = shares[road];
    if (!(share > 0)) return;
    var R = RATES[road];
    if (!R) throw new Error('mixed: unknown road type ' + road);
    var roadSec = hours * 3600 * share, eventSec = 0;
    R.events.forEach(function (e) {
      var cands = candidates(e, R.band);
      if (!cands.length) return;
      var k = poisson(rand, e.perHour * dens * hours * share);
      for (var i = 0; i < k; i++) {
        var c = cands[Math.floor(rand() * cands.length)];
        add(c, road, 'event', 1, e.id);
        eventSec += c.duration;
      }
    });
    var rest = Math.max(0, roadSec - eventSec);
    [['follow', R.follow, rest * fShare], ['free', R.free, rest * (1 - fShare)]].forEach(function (f) {
      if (!(f[2] > 0)) return;
      var cands = candidates({ id: f[1] }, R.band);
      if (!cands.length) cands = candidates({ id: f[1], band: false }, null);
      var chosen = [];
      for (var i = 0; i < nFill; i++) chosen.push(cands[i % cands.length]);
      // same weight for every sample: together they stand for f[2] seconds
      var w = f[2] / (segLen * chosen.length);
      chosen.forEach(function (c) {
        var cc = JSON.parse(JSON.stringify(c));
        cc.duration = segLen;
        add(cc, road, f[0], w, f[1]);
      });
    });
  });
  return order.map(function (id) { return out[id]; });
}

function aggregate(records) {
  var hours = 0, warn = 0, inter = 0, nuis = 0, missed = 0, coll = 0, cmds = 0, byRoad = {}, contrib = [];
  records.forEach(function (r) {
    var mx = r.concrete.mixed, m = r.metrics || {}, w = mx.weight, dur = r.concrete.duration || m.duration_s || 0;
    var none = r.concrete.reaction === 'none';
    var wc = m.warnCount || 0, iv = (m.driverInterventions || 0) + (none ? wc : 0);
    hours += w * dur / 3600;
    warn += w * wc; inter += w * iv;
    nuis += w * (none ? (m.nuisanceWarnings || 0) : 0);
    missed += w * (m.missedWarning ? 1 : 0); coll += w * (m.collision ? 1 : 0);
    cmds += w * (m.setpointChangesAvgPerMin || 0) * dur / 60;
    var b = byRoad[mx.road] || (byRoad[mx.road] = { hours: 0, warnings: 0, interventions: 0 });
    b.hours += w * dur / 3600; b.warnings += w * wc; b.interventions += w * iv;
    if (wc || iv || m.collision) contrib.push({ id: r.concrete.id, source: mx.source, weight: w, warnings: w * wc, collision: !!m.collision });
  });
  // the configured hours: an event episode's lead-in is following time the drive has anyway, so episode time over-counts
  var h = (records[0] && records[0].concrete.mixed.hoursTotal) || hours || 1;
  Object.keys(byRoad).forEach(function (k) {
    var b = byRoad[k];
    b.warningsPerHour = b.hours ? b.warnings / b.hours : null;
    b.interventionsPerHour = b.hours ? b.interventions / b.hours : null;
  });
  contrib.sort(function (a, b) { return b.warnings - a.warnings; });
  return {
    hours: h, episodeHours: hours, warningsPerHour: warn / h, interventionsPerHour: inter / h, nuisancePerHour: nuis / h,
    missedWarningsPerHour: missed / h, collisionsPerHour: coll / h, setpointChangesPerMin: cmds / (h * 60),
    byRoad: byRoad, topContributors: contrib.slice(0, 8)
  };
}

var X = { RATES: RATES, DENSITY: DENSITY, FOLLOW_SHARE: FOLLOW_SHARE, generate: generate, aggregate: aggregate, _poisson: poisson, _rng: mulberry32 };
if (typeof module !== 'undefined') module.exports = X; else (self.CS = self.CS || {}).mixed = X;
})();
