/* SU2's stand-ins for the model modules (SC1 / SC2 / SC3), shaped as CONTRACT.md "Every model module"
 * and following the conventions the real modules use (2026-11-19 snapshot of their branches): SCHEMA
 * groups prefixed with the module ('plant.dynamics'), unit suffixes in keys (aMin_ms2, ttcWarn_s),
 * nullable fields, booleans as options [false, true], a plant 'preset' stored in the config, a command
 * path with PRESETS but no 'preset' key, failures with an empty SCHEMA and a KINDS table, thresholds
 * under NAME 'thresholds' with an `op`.
 * Used only by SU2's tests and the SU2 dev page. In the browser the fakes fill ONLY missing modules.
 */
(function () {
  'use strict';
  function S(mod, key, label, unit, def, min, max, step, group, help, extra) {
    return Object.assign({ key: key, label: label, unit: unit, default: def, min: min, max: max, step: step, group: mod + (group ? '.' + group : ''), help: help || '' }, extra || {});
  }
  const plant = {
    NAME: 'plant',
    SCHEMA: [
      S('plant', 'preset', 'Preset', '', 'mild', undefined, undefined, undefined, '', 'Braking authority of the assumed cruise', { options: ['liftoff', 'mild', 'firm'] }),
      S('plant', 'model', 'Model', '', 'P1', undefined, undefined, undefined, '', 'P1 / P2 / P3', { options: ['P1', 'P2', 'P3'] }),
      S('plant', 'file', 'Identified plant file', '', null, undefined, undefined, undefined, '', 'Node path', { type: 'string', nullable: true }),
      S('plant', 'data', 'Identified plant (inline)', '', null, undefined, undefined, undefined, '', '', { type: 'object', nullable: true }),
      S('plant', 'deadTime_s', 'Dead time', 's', 0.5, 0, 3, 0.05, 'dynamics', 'Td'),
      S('plant', 'tau_s', 'Time constant', 's', 2.0, 0.2, 10, 0.1, 'dynamics', 'tau_c'),
      S('plant', 'tauDown_s', 'Time constant, slowing down', 's', null, 0.2, 10, 0.1, 'dynamics', 'P2 only; empty = the time constant'),
      S('plant', 'aMax_ms2', 'Max acceleration', 'm/s²', 1.5, 0.2, 4, 0.1, 'limits'),
      S('plant', 'aMin_ms2', 'Max deceleration', 'm/s²', -1.8, -6, -0.1, 0.1, 'limits', 'negative'),
      S('plant', 'brakeMax_ms2', 'Brake authority', 'm/s²', 2.0, 0, 8, 0.1, 'limits', '0 = lift-off only'),
      S('plant', 'resolution_kmh', 'Setpoint resolution', 'km/h', 1, 0.1, 10, 0.1, 'setpoint'),
      S('plant', 'vMinActive_kmh', 'Min active speed', 'km/h', 30, 0, 80, 1, 'setpoint'),
      S('plant', 'acceptWhenSuspended', 'Accept set speed when suspended', '', false, undefined, undefined, undefined, 'setpoint'),
      S('plant', 'farBelowMode', 'When set is far below', '', 'normal', undefined, undefined, undefined, 'limits', '', { options: ['normal', 'liftoffOnly', 'cancel'] }),
    ],
    PRESETS: {
      liftoff: { brakeMax_ms2: 0, aMin_ms2: -0.7 },
      mild: { brakeMax_ms2: 2.0, aMin_ms2: -1.8 },
      firm: { brakeMax_ms2: 3.5, aMin_ms2: -2.8 },
    },
    create: function () { return {}; },
  };
  const sensor = {
    NAME: 'sensor',
    SCHEMA: [
      { key: 'rateHz', label: 'Native sample rate', unit: 'Hz', default: 10, min: 2, max: 25, step: 1, group: 'timing' },
      { key: 'latency_s', label: 'Latency', unit: 's', default: 0.15, min: 0, max: 1, step: 0.01, group: 'timing' },
      { key: 'range_m', label: 'Range', unit: 'm', default: 120, min: 20, max: 250, step: 5, group: 'range' },
      { key: 'noiseLaw', label: 'Noise law', unit: '', default: 'quadratic', options: ['constant', 'linear', 'quadratic'], group: 'noise' },
      { key: 'dropProb', label: 'Dropout probability', unit: '', default: 0.02, min: 0, max: 0.5, step: 0.01, group: 'faults' },
    ],
    create: function () { return {}; },
  };
  const estimator = {
    NAME: 'estimator',
    SCHEMA: [
      { key: 'mode', label: 'Filter', unit: '', default: 'kalman', options: ['kalman', 'kalmanCA', 'alphaBeta', 'raw'], group: 'filter' },
      { key: 'useVrel', label: 'Use the camera relative speed', unit: '', default: true, options: [true, false], group: 'filter' },
      { key: 'alpha', label: 'Alpha', unit: '', default: 0.5, min: 0.05, max: 1, step: 0.01, group: 'alphaBeta' },
    ],
    create: function () { return {}; },
  };
  const controller = {
    NAME: 'controller',
    SCHEMA: [
      { key: 'rateHz', label: 'Controller rate', unit: 'Hz', default: 10, min: 2, max: 20, step: 1, group: 'loop' },
      { key: 'd0', label: 'Standstill gap d0', unit: 'm', default: 5, min: 3, max: 8, step: 0.5, group: 'law' },
      { key: 'h', label: 'Time gap h', unit: 's', default: 2.0, min: 1.5, max: 3.0, step: 0.1, group: 'law' },
      { key: 'tau', label: 'Gap-closing time tau', unit: 's', default: 4, min: 2, max: 8, step: 0.5, group: 'law' },
      { key: 'rateDown_kmhps', label: 'Rate limit down', unit: 'km/h/s', default: 3, min: 1, max: 5, step: 0.5, group: 'limits' },
      { key: 'rateUp_kmhps', label: 'Rate limit up', unit: 'km/h/s', default: 1, min: 0.5, max: 2, step: 0.1, group: 'limits' },
      { key: 'ffEnable', label: 'Lead-acceleration feed-forward', unit: '', default: false, options: [false, true], group: 'law' },
      { key: 'ffMax_mps', label: 'Feed-forward limit', unit: 'm/s', default: 3, min: 0, max: 10, step: 0.5, group: 'law' },
    ],
    create: function () { return {}; },
  };
  const warning = {
    NAME: 'warning',
    SCHEMA: [
      { key: 'ttcWarn_s', label: 'TTC_warn', unit: 's', default: 3, min: 2, max: 4, step: 0.1, group: 'warning' },
      { key: 'margin', label: 'Distance margin', unit: '', default: 1.0, min: 0.5, max: 2, step: 0.05, group: 'warning' },
    ],
    create: function () { return {}; },
  };
  const command = {
    NAME: 'command',
    SCHEMA: [
      { key: 'delay_s', label: 'Delay', unit: 's', default: 0.2, min: 0, max: 3, step: 0.05 },
      { key: 'jitter_s', label: 'Jitter', unit: 's', default: 0.1, min: 0, max: 2, step: 0.05 },
      { key: 'maxRate_hz', label: 'Max accepted rate', unit: 'Hz', default: 0, min: 0, max: 20, step: 0.5 },
      { key: 'dropProb', label: 'Drop probability', unit: '', default: 0, min: 0, max: 1, step: 0.01 },
    ],
    PRESETS: { ideal: { delay_s: 0, jitter_s: 0 }, nominal: {}, worst: { delay_s: 0.8, jitter_s: 0.5, maxRate_hz: 2, dropProb: 0.1 } },
    create: function () { return {}; },
  };
  const driver = {
    NAME: 'driver',
    SCHEMA: [
      { key: 'reactionCase', label: 'Reaction case', unit: '', default: 'nominal', options: ['nominal', 'late', 'none'] },
      { key: 'reactionMedian_s', label: 'Reaction time, median', unit: 's', default: 1.2, min: 0.3, max: 3, step: 0.05 },
      { key: 'brakeLevel_ms2', label: 'Braking level', unit: 'm/s²', default: 6, min: 2, max: 9, step: 0.5 },
      { key: 'autoResume', label: 'Resumes after braking', unit: '', default: true },
    ],
    create: function () { return {}; },
  };
  const failures = {
    NAME: 'failures',
    SCHEMA: [],
    KINDS: { appStop: { duration: Infinity }, huRestart: { duration: null }, gapFreeze: { duration: 10 }, sensorBlind: { duration: 10 }, commandLost: { duration: Infinity } },
  };
  const metrics = {
    NAME: 'thresholds',
    SCHEMA: [
      { key: 'minGap_m', label: 'Minimum gap', unit: 'm', default: 2, min: 0, max: 20, step: 0.5, group: 'thresholds', op: '>=' },
      { key: 'minTimeGap_s', label: 'Minimum time gap', unit: 's', default: 1.0, min: 0.3, max: 3, step: 0.1, group: 'thresholds', op: '>=' },
      { key: 'minTTC_s', label: 'Minimum TTC', unit: 's', default: 4.0, min: 1, max: 10, step: 0.5, group: 'thresholds', op: '>=' },
      { key: 'peakDecel_mps2', label: 'Peak deceleration', unit: 'm/s²', default: 3.5, min: 1, max: 8, step: 0.1, group: 'thresholds', op: '<=' },
      { key: 'accelRms_mps2', label: 'Acceleration RMS', unit: 'm/s²', default: 0.5, min: 0.1, max: 2, step: 0.05, group: 'thresholds', op: '<=' },
      { key: 'setpointChangesPerMin', label: 'Setpoint changes per minute (peak)', unit: '/min', default: 20, min: 5, max: 60, step: 1, group: 'thresholds', op: '<=' },
      { key: 'passShare', label: 'Share of the catalogue that passes', unit: '', default: 1, min: 0, max: 1, step: 0.05, group: 'thresholds.catalogue', op: '>=' },
      { key: 'nearMissGap_m', label: 'Near-miss gap', unit: 'm', default: 2, min: 0.5, max: 10, step: 0.5, group: 'definitions' },
    ],
    BY_KEY: {
      collision: { key: 'collision', label: 'Collision', op: 'false' },
      minGap_m: { key: 'minGap_m', label: 'Minimum gap', unit: 'm', op: '>=' },
      minTimeGap_s: { key: 'minTimeGap_s', label: 'Minimum time gap', unit: 's', op: '>=' },
      minTTC_s: { key: 'minTTC_s', label: 'Minimum TTC', unit: 's', op: '>=' },
      warnCount: { key: 'warnCount', label: 'Warnings', op: '<=' },
      peakDecel_mps2: { key: 'peakDecel_mps2', label: 'Peak deceleration', unit: 'm/s²', op: '<=' },
      accelRms_mps2: { key: 'accelRms_mps2', label: 'Acceleration RMS', unit: 'm/s²', op: '<=' },
      peakJerk_mps3: { key: 'peakJerk_mps3', label: 'Peak jerk', unit: 'm/s³', op: '<=' },
      setpointChangesPerMin: { key: 'setpointChangesPerMin', label: 'Setpoint changes per minute', unit: '/min', op: '<=' },
    },
  };
  const scenarioList = [
    { id: 'A.free.steady', family: 'A', name: 'No target at steady speed' },
    { id: 'B.approach', family: 'B', name: 'Approach a slower lead' },
    { id: 'C.follow.steady', family: 'C', name: 'Steady following' },
    { id: 'C.follow.sine', family: 'C', name: 'Lead speed oscillates' },
    { id: 'D.brake', family: 'D', name: 'Lead brakes to a lower speed' },
    { id: 'E.cutin', family: 'E', name: 'Cut-in at short gap' },
    { id: 'L.mixed.hour', family: 'L', name: 'Mixed driving, one hour' },
  ];
  // like SC3's core/scenario.js: list(), template(id), expand(id) -> concrete variants with ids
  // 'D.brake#a=-2,v0=90/react', load(id) -> a runnable concrete (a file id: its default variant), toConfig()
  const SWEEPS = { 'D.brake': { a: [-1, -2, -3], v0: [60, 90] }, 'B.approach': { dv: [10, 30, 50, 80] } };
  const REACTIONS = { 'D.brake': ['none', 'react'] };
  function cross(sw) {
    let out = [{}];
    Object.keys(sw || {}).forEach(function (k) { const n = []; out.forEach(function (o) { sw[k].forEach(function (v) { const c = Object.assign({}, o); c[k] = v; n.push(c); }); }); out = n; });
    return out;
  }
  const scenario = {
    list: function () { return scenarioList.slice(); },
    template: function (id) {
      const s = scenarioList.filter(function (x) { return x.id === id; })[0];
      if (!s) throw new Error('unknown scenario ' + id);
      return Object.assign({ duration: id.charAt(0) === 'L' ? 3600 : 60, sweep: SWEEPS[id] || null, reactions: REACTIONS[id] || ['none'] }, s);
    },
    expand: function (id) {
      const t = scenario.template(String(id).split('#')[0]);
      const out = [];
      cross(t.sweep).forEach(function (v) {
        const label = Object.keys(v).map(function (k) { return k + '=' + v[k]; }).join(',');
        t.reactions.forEach(function (r) {
          out.push({ id: t.id + (label ? '#' + label : '') + (t.reactions.length > 1 ? '/' + r : ''), base: t.id, family: t.family, label: label, variant: v, reaction: r,
            duration: t.duration, configPatch: { driver: { reactionCase: r === 'react' ? 'nominal' : 'none' } }, decide: ['minTimeGap_s', 'collision'] });
        });
      });
      return out;
    },
    load: function (id) {
      const all = scenario.expand(id);
      const hit = all.filter(function (c) { return c.id === id; })[0];
      if (hit) return hit;
      if (String(id).indexOf('#') < 0) return all[0];
      throw new Error('unknown scenario ' + id);
    },
    toConfig: function (c, base) { const cfg = JSON.parse(JSON.stringify(base || {})); cfg.scenario = { id: c.id, inline: c }; return cfg; },
  };
  const all = { plant: plant, sensor: sensor, estimator: estimator, controller: controller, warning: warning, command: command, driver: driver, failures: failures, metrics: metrics, scenario: scenario };
  if (typeof module !== 'undefined') module.exports = all;
  else {
    self.CS = self.CS || {};
    Object.keys(all).forEach(function (k) { if (!self.CS[k]) { self.CS[k] = all[k]; self.CS[k].__fake = true; } });
  }
})();
