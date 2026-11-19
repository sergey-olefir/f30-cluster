'use strict';
/**
 * worker.js (SU1) - runs core/sim.js off the page's thread (CONTRACT "The page").
 *
 * Messages in:  { type: 'init', files: ['../core/rng.js', ...] }   (the page's CORE_FILES, in order)
 *               { type: 'run', id, config }
 * Messages out: { type: 'ready', modules: [names] }
 *               { type: 'progress', id, frac }
 *               { type: 'result', id, result }   (typed arrays transferred)
 *               { type: 'error', id, message }
 * A missing core file is skipped (the page then knows the module is absent); a run without core/sim.js
 * answers an error and the page runs in place. Chrome refuses workers under file://: the page falls back.
 */
(function () {      // own scope: importScripts shares the worker's global lexical scope with every core file
self.CS = self.CS || {};
let loaded = false;

function init(files) {
    const got = [];
    for (const f of files || []) {
        try { importScripts(f); got.push(f); } catch (e) { /* not in this build */ }
    }
    loaded = true;
    self.postMessage({ type: 'ready', modules: Object.keys(self.CS), files: got });
}

function transferables(r) {
    const list = [];
    if (r && r.t && r.t.buffer) list.push(r.t.buffer);
    if (r && r.series) for (const k of Object.keys(r.series)) { const a = r.series[k]; if (a && a.buffer && list.indexOf(a.buffer) < 0) list.push(a.buffer); }
    return list;
}

function run(id, config) {
    const sim = self.CS.sim;
    if (!sim || typeof sim.run !== 'function') throw new Error('core/sim.js is not loaded in the worker');
    let result;
    if (typeof sim.createSim === 'function') {
        const s = sim.createSim(config), dur = +config.duration || 60;
        let next = 0;
        while (!s.done) {
            s.advance(1);
            const st = s.state && s.state();
            if (st && st.t >= next) { self.postMessage({ type: 'progress', id, frac: st.t / dur }); next = st.t + dur / 20; }
        }
        result = s.result();
    } else result = sim.run(config);
    self.postMessage({ type: 'result', id, result }, transferables(result));
}

self.onmessage = (ev) => {
    const m = ev.data || {};
    try {
        if (m.type === 'init') init(m.files);
        else if (m.type === 'run') {
            if (!loaded) throw new Error('worker not initialised');
            run(m.id, m.config);
        }
    } catch (e) {
        self.postMessage({ type: 'error', id: m.id, message: e && e.message ? e.message : String(e) });
    }
};
})();
