'use strict';
// The command path (SC1): how a set speed would travel from the app to the cruise. Nothing of it is known on the car
// (parent brief, "The command path"), so every term is a setting and is swept.
//
//   command.create(params, rng, ctx) -> instance
//   instance.send(t, vSet, faults) -> { id, lost: false | 'all' | 'nextDecrease' }   the app hands over a set speed
//   instance.deliver(t) -> [ { id, tSent, tApplied, vSet, status: 'applied'|'dropped'|'rejected', reason?, silent?, dup? } ]
//       every message whose arrival time has come; 'applied' means "reached the cruise" (the plant may still refuse it,
//       sim.js then reports it as rejected); 'rejected' with silent: true is a write the path took and the cruise
//       ignored without a word
//   instance.stalled(t) -> bool      the head unit is paused (a GC stall): the app does not run and nothing is delivered
//   instance.reset(t) -> [ the messages in flight, as dropped ]   the head unit restarted
//
// Per message: delay_s + uniform(0, jitter_s); with reorderProb an extra reorderDelay_s (it can arrive after a later
// one); with lateProb an extra lateDelay_s ("accepted but applied late"); with dropProb it is lost; with rejectProb
// the cruise ignores it silently; with dupProb a second copy arrives dupDelay_s later. Every message draws the same
// six random numbers whatever the settings, so changing one probability never shifts the others' draws.
// maxRate_hz: arrivals closer than 1 / maxRate_hz to the last one let through are rejected (0 = no limit).
// Stalls: Poisson, stallRate_perMin per minute, each uniform in [stallMin_s, stallMax_s].

function S(key, label, unit, def, min, max, step, help, extra) {
  return Object.assign({ key, label, unit, default: def, min, max, step, group: 'command', help }, extra || {});
}

const SCHEMA = [
  S('delay_s', 'Delay', 's', 0.2, 0, 3, 0.05, 'From the app\'s write to the cruise taking it'),
  S('jitter_s', 'Jitter', 's', 0.1, 0, 2, 0.05, 'A uniform extra delay in [0, jitter]'),
  S('maxRate_hz', 'Max accepted rate', 'Hz', 0, 0, 20, 0.5, 'Changes closer than 1 / rate to the last accepted are rejected; 0 = no limit'),
  S('dropProb', 'Drop probability', '', 0, 0, 1, 0.01, 'A write lost on the way'),
  S('rejectProb', 'Silent rejection probability', '', 0, 0, 1, 0.01, 'A write the cruise ignores without telling'),
  S('dupProb', 'Duplicate probability', '', 0, 0, 1, 0.01, 'A write delivered twice'),
  S('dupDelay_s', 'Duplicate after', 's', 0.3, 0, 3, 0.05, ''),
  S('reorderProb', 'Reorder probability', '', 0, 0, 1, 0.01, 'A write held back so a later one may overtake it'),
  S('reorderDelay_s', 'Reorder hold', 's', 0.5, 0, 3, 0.05, ''),
  S('lateProb', 'Applied-late probability', '', 0, 0, 1, 0.01, 'A write accepted but applied late'),
  S('lateDelay_s', 'Applied late by', 's', 1.5, 0, 10, 0.1, ''),
  S('stallRate_perMin', 'Head-unit stalls', '1/min', 0, 0, 30, 0.5, 'Pauses of the head unit\'s process per minute'),
  S('stallMin_s', 'Stall, shortest', 's', 0.2, 0, 5, 0.1, ''),
  S('stallMax_s', 'Stall, longest', 's', 2, 0, 10, 0.1, ''),
];

const PRESETS = {
  ideal: { delay_s: 0, jitter_s: 0 },
  nominal: {},
  worst: { delay_s: 0.8, jitter_s: 0.5, maxRate_hz: 2, dropProb: 0.1, rejectProb: 0.05, dupProb: 0.05, reorderProb: 0.05, lateProb: 0.05, stallRate_perMin: 2 },
};

function create(p, rng, ctx) {
  ctx = ctx || {};
  const r = rng || ((typeof require !== 'undefined' ? require('./rng') : self.CS.rng).create('command'));
  const rs = r.fork('stalls');
  let queue = [];        // { id, tSent, tArr, vSet, status, reason, silent, dup }
  let nextId = 1;
  let lastPassT = -Infinity;
  let lastSent = null;
  // stalls: generated lazily in time order
  const stalls = [];
  let stallHorizon = 0;
  function genStalls(t) {
    if (!(p.stallRate_perMin > 0)) return;
    while (stallHorizon <= t + 10) {
      const gapS = rs.exp(60 / p.stallRate_perMin);
      const d = rs.uniform(p.stallMin_s, Math.max(p.stallMin_s, p.stallMax_s));
      const s0 = stallHorizon + gapS;
      stalls.push([s0, s0 + d]);
      stallHorizon = s0 + d;
    }
  }
  function stalled(t) {
    genStalls(t);
    for (const s of stalls) { if (s[0] > t) break; if (t < s[1]) return true; }
    return false;
  }

  function send(t, vSet, faults) {
    faults = faults || {};
    const u = [r.next(), r.next(), r.next(), r.next(), r.next(), r.next()];   // drop, jitter, reorder, late, reject, dup
    const id = nextId++;
    let lost = false;
    if (faults.commandsLost === 'all') lost = 'all';
    else if (faults.commandsLost === 'nextDecrease' && lastSent !== null && vSet < lastSent - 1e-9) lost = 'nextDecrease';
    lastSent = vSet;
    let tArr = t + p.delay_s + u[1] * p.jitter_s;
    if (u[2] < p.reorderProb) tArr += p.reorderDelay_s;
    if (u[3] < p.lateProb) tArr += p.lateDelay_s;
    const m = { id, tSent: t, tArr, vSet, status: 'applied', reason: undefined, silent: undefined, dup: false };
    if (lost) { m.status = 'dropped'; m.reason = 'fault'; }
    else if (u[0] < p.dropProb) { m.status = 'dropped'; m.reason = 'lost'; }
    else if (u[4] < p.rejectProb) { m.status = 'rejected'; m.reason = 'silent'; m.silent = true; }
    queue.push(m);
    if (m.status === 'applied' && u[5] < p.dupProb) queue.push(Object.assign({}, m, { tArr: tArr + p.dupDelay_s, dup: true }));
    return { id, lost };
  }

  function deliver(t) {
    if (!queue.length || stalled(t)) return [];
    const due = [], keep = [];
    for (const m of queue) (m.tArr <= t + 1e-9 ? due : keep).push(m);
    if (!due.length) return [];
    queue = keep;
    due.sort((a, b) => a.tArr - b.tArr || a.id - b.id || (a.dup ? 1 : 0) - (b.dup ? 1 : 0));
    const out = [];
    for (const m of due) {
      const o = { id: m.id, tSent: m.tSent, tApplied: t, vSet: m.vSet, status: m.status, dup: m.dup };
      if (m.reason) o.reason = m.reason;
      if (m.silent) o.silent = true;
      if (o.status === 'applied' && p.maxRate_hz > 0) {
        if (t - lastPassT < 1 / p.maxRate_hz - 1e-9) { o.status = 'rejected'; o.reason = 'rate'; }
        else lastPassT = t;
      }
      out.push(o);
    }
    return out;
  }

  function reset(t) {
    const lostMsgs = queue.map(m => ({ id: m.id, tSent: m.tSent, tApplied: t, vSet: m.vSet, status: 'dropped', reason: 'restart', dup: m.dup }));
    queue = [];
    lastSent = null;
    return lostMsgs;
  }

  return { params: p, send, deliver, stalled, reset, inFlight: () => queue.length, stallsUntil: t => { genStalls(t); return stalls.filter(s => s[0] <= t); } };
}

const command = { NAME: 'command', SCHEMA, PRESETS, create };
if (typeof module !== 'undefined') module.exports = command; else (self.CS = self.CS || {})['command'] = command;
