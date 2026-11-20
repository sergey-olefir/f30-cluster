'use strict';
/**
 * Signal Probe: a READ-ONLY, LOG-ONLY app. It draws nothing on the cluster or the HUD (no cluster-render connection, no layer): it
 * subscribes the car's signals set by set and logs what arrives, so one session at the car answers what three rounds of work
 * deferred (docs/car/CP-REPORT.md, docs/AGENT-BRIEF-car-signals.md). It can be installed beside f30_cluster and Twin Dial and run
 * with either or with BMW's own cluster.
 *
 * The centre screen (native menu MAIN, shared nothing with the cluster apps): a status line, "Позначка N" (a marker line in the
 * log), and one checkbox per set S1..S9, all off at the first start (the choice is kept in settings.json, and the log says which
 * sets are on at every start and change). Nothing is subscribed while a set is off.
 *
 * Never lets an exception escape: a failed start logs and stays up (an OAP app that exits twice is uninstalled by the platform).
 */
const mgu = require('./kit/mgu');
const I18N = require('./lang');
const { Probe, VERSION } = require('./probe');
const FIELDS = require('./fields');
const Menu = require('./menu');
const { Recorder } = require('./recorder');      // cruise RC
const path = require('path');

mgu.run({
    start(ctx) {
        // r1120 LN: the language (setting "Мова / Language", the head unit's): first, so every word below is in it
        try { I18N.attach(ctx, { hmi: false }); } catch (e) { ctx.log.error('lang: ' + (e && e.stack || e)); }
        let probe;
        try {
            const cfg = (ctx.spec.config && ctx.spec.config.probe) || {};
            probe = new Probe({ log: ctx.log, signals: ctx.signals, cfg, version: (ctx.spec && ctx.spec.version) || VERSION });
            const want = FIELDS.SETS.filter((s) => ctx.settings.get(s.key) === true).map((s) => s.id);
            probe.setSets(want, true);
            probe.startLine();
            probe.start();
        } catch (e) {
            // nothing subscribed, but stay up: an exit here would count as a crash on the car
            ctx.log.error('Signal Probe failed to start: ' + (e && e.stack || e));
            return;
        }
        // cruise RC: the recording mode (recorder.js): files in data/rec, started and stopped from the menu; a failure here leaves it out
        let rec = null, recCfg = {};
        try {
            recCfg = (ctx.spec.config && ctx.spec.config.recorder) || {};
            rec = new Recorder({ dir: path.join(ctx.dataDir || '.', 'rec'), log: ctx.log, cfg: recCfg, version: (ctx.spec && ctx.spec.version) || VERSION });
            probe.setRecorder(rec, recCfg.quietLog !== false);
        } catch (e) { rec = null; ctx.log.error('recorder failed to start: ' + (e && e.stack || e)); }
        try { new Menu(ctx, probe, rec, recCfg).start(); } catch (e) { ctx.log.error('menu failed to start: ' + (e && e.stack || e)); }
        process.on('exit', () => {
            try { probe.stop(); } catch (e) { /* exiting anyway */ }
            try { if (rec) rec.stop(true); } catch (e) { /* cruise RC: exiting anyway */ }
        });
    },
});
