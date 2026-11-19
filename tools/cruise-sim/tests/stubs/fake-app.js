/* SU2's stand-in for the shell's `app` (CONTRACT.md "The page"), for SU2's dev page and tests only.
 * The real one is SU1's ui/app.js. This one keeps the same names: config, result, resultB, batch,
 * cursorT, on / off / emit, setConfig(partial, { replace, run }), run(), loadResultFile(json),
 * setCursor(t), setCompare(r), openRun(config), showView(v), isShort(), autoRun.
 * run() uses the core (CS.sim.run) when the page has it, else SU2's fixture simulation.
 */
(function () {
  'use strict';
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function deepMerge(a, b) {
    const out = clone(a) || {};
    Object.keys(b || {}).forEach(function (k) { out[k] = isObj(b[k]) && isObj(out[k]) ? deepMerge(out[k], b[k]) : clone(b[k]); });
    return out;
  }

  function createApp(opts) {
    opts = opts || {};
    const CS = opts.CS || (typeof self !== 'undefined' ? self.CS : {}) || {};
    const listeners = {};
    let raf = 0;
    const app = {
      config: clone(opts.config || { version: 1, seed: 1, scenario: { id: 'D.brake', overrides: {} }, plant: { preset: 'liftoff' } }),
      result: null, resultB: null, batch: null, cursorT: 0, autoRun: true, playing: false, speed: 1, log: [],
      on: function (e, f) { (listeners[e] = listeners[e] || []).push(f); return function () { app.off(e, f); }; },
      off: function (e, f) { const l = listeners[e] || []; const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); },
      emit: function (e, a) { app.log.push(e); (listeners[e] || []).slice().forEach(function (f) { f(a, app); }); },
      setConfig: function (partial, o) {
        o = o || {};
        app.config = o.replace ? clone(partial) : deepMerge(app.config, partial);
        app.emit('config', app.config);
        const r = o.run === undefined ? 'auto' : o.run;
        if (r === true || (r === 'auto' && app.autoRun && app.isShort())) { clearTimeout(app._t); app._t = setTimeout(app.run, 200); }
        return app.config;
      },
      isShort: function () { return !(app.config.duration > 300); },
      run: function () {
        let r;
        if (CS.sim && typeof CS.sim.run === 'function' && !CS.sim.__fake) r = CS.sim.run(clone(app.config));
        else {
          const p = app.config.plant || {};
          r = CS.su2fixture.makeResult({ seed: app.config.seed || 1, preset: p.preset || 'liftoff', aMin: p.aMin_ms2 ? Math.abs(p.aMin_ms2) : undefined, Td: p.deadTime_s, h: app.config.controller && app.config.controller.h, duration: app.config.duration || 60 });
          r.meta.config = clone(app.config);
        }
        app.setResult(r);
        return Promise.resolve(r);
      },
      setResult: function (r) { app.result = r; app.cursorT = Math.min(app.cursorT, r.t[r.t.length - 1]); app.emit('result', r); app.emit('cursor', app.cursorT); },
      loadResultFile: function (json) {
        const j = typeof json === 'string' ? JSON.parse(json) : json;
        if (Array.isArray(j.runs) || Array.isArray(j.results)) { app.batch = j; app.emit('batch', j); return 'batch'; }
        if (j.meta && j.meta.config) { app.config = clone(j.meta.config); app.emit('config', app.config); }
        app.setResult(j);
        return 'result';
      },
      setCompare: function (r) { app.resultB = r || null; app.emit('compare', app.resultB); },
      openRun: function (cfg) { app.setConfig(cfg, { replace: true, run: false }); return app.run(); },
      showView: function (v) { app.emit('view', v); },
      setCursor: function (t) { app.cursorT = t; app.emit('cursor', t); },
      play: function () {
        if (!app.result || app.playing) return;
        app.playing = true;
        let last = 0;
        function frame(ts) {
          if (!app.playing) return;
          if (last) {
            const end = app.result.t[app.result.t.length - 1];
            app.cursorT = Math.min(end, app.cursorT + (ts - last) / 1000 * app.speed);
            app.emit('cursor', app.cursorT);
            if (app.cursorT >= end) app.playing = false;
          }
          last = ts;
          raf = requestAnimationFrame(frame);
        }
        raf = requestAnimationFrame(frame);
      },
      pause: function () { app.playing = false; cancelAnimationFrame(raf); },
    };
    return app;
  }

  const api = { createApp: createApp, deepMerge: deepMerge };
  if (typeof module !== 'undefined') module.exports = api; else (self.CS = self.CS || {})['su2fakeApp'] = api;
})();
