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
// cruise RC; road TS: the recorder is shared/signal_recorder.js (packed beside this file by app.json "shared"; the RV recorder uses it too)
const { Recorder } = (function loadRecorder() {
    try { return require('./signal_recorder'); } catch (e) { /* the repository's layout */ }
    return require('../../shared/signal_recorder');
})();
const { BeamDiag } = require('./beam_diag');     // beam HS: the HB set's read-only diagnostic reads (off by default)
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
        // beam HS: the HB set's read-only diagnostic reads (beam_diag.js): only while the setting "hbdiag" AND set S18 are on, only
        // while the recorded speed says the car stands (config.hbdiag.whileMoving false). The link is made the first time it is needed.
        let diag = null;
        try {
            const dcfg = (ctx.spec.config && ctx.spec.config.hbdiag) || {};
            let speed = null;
            probe.tap('car-speed2', (v) => {
                const raw = v && typeof v === 'object' ? v.speedVehicleCentreOfGravity : null;
                speed = typeof raw === 'number' && isFinite(raw) ? { kmh: raw / 64, at: Date.now() } : null;
            });
            const want = () => ctx.settings.get('hbdiag') === true && ctx.settings.get('set18') === true;
            const sync = () => {
                try {
                    if (want() && !diag) {
                        const RO = require('./kit/readonly-diag');
                        const link = new RO.ReadOnlyDiag(ctx.signals, ctx.log);
                        diag = new BeamDiag({ link, log: ctx.log, recorder: rec, speed: () => speed, whileMoving: dcfg.whileMoving === true });
                        const d = diag;
                        link.init().then(() => { if (diag === d) d.start(); }, (e) => { ctx.log.warn('probe: diag: no link: ' + String(e && e.message || e).slice(0, 80)); });
                    } else if (!want() && diag) { diag.stop(); diag = null; }
                } catch (e) { ctx.log.error('diag: ' + (e && e.stack || e)); }
            };
            ctx.settings.onChange((key) => { if (key === 'hbdiag' || key === 'set18') sync(); });
            sync();
        } catch (e) { ctx.log.error('diag failed to start: ' + (e && e.stack || e)); }
        process.on('exit', () => {
            try { if (diag) diag.stop(); } catch (e) { /* beam HS: exiting anyway */ }
            try { probe.stop(); } catch (e) { /* exiting anyway */ }
            try { if (rec) rec.stop(true); } catch (e) { /* cruise RC: exiting anyway */ }
        });
    },
});
