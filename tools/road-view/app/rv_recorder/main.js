'use strict';
/**
 * RV Recorder (round "Road View", package TS): a READ-ONLY, record-only app for one city drive in daylight. It draws nothing on the
 * cluster or the HUD. It records set S19 "RV": the camera's traffic light, its sign streams, the sign function, the display feeds,
 * FASuS's warnings and traffic-light states, the road scene and the environment model (first message whole, then a summary a
 * second), the camera's state, and the speed, gear, brake light, indicator and stalk, into data/rec/ (shared/signal_recorder.js,
 * the format Signal Probe writes; tools/car/rv_analyse.py reads it).
 *
 * It lives outside apps/ (the Store globs "apps/*"): the lead installs it by hand when the owner says (docs/traffic/TS-REPORT.md).
 * Nothing is subscribed until the first press of "Почати запис RV". Never lets an exception escape: a failed start logs and stays up
 * (an OAP app that exits twice is uninstalled by the platform).
 */
const mgu = require('./kit/mgu');
const I18N = require('./lang');
const { RoadView, VERSION } = require('./rv');
const Menu = require('./rv_menu');
const path = require('path');

/** A module the build packs beside this file from shared/ (app.json "shared"); the repository's shared/ when run from the tree. */
function shared(name) {
    try { return require('./' + name); } catch (e) { /* the repository's layout */ }
    return require('../../../../shared/' + name);
}

mgu.run({
    start(ctx) {
        try { I18N.attach(ctx, { hmi: false }); } catch (e) { ctx.log.error('lang: ' + (e && e.stack || e)); }
        let rv = null, rec = null;
        try {
            const recCfg = (ctx.spec.config && ctx.spec.config.recorder) || {};
            const { Recorder } = shared('signal_recorder');
            rec = new Recorder({ dir: path.join(ctx.dataDir || '.', 'rec'), log: ctx.log, cfg: recCfg, version: (ctx.spec && ctx.spec.version) || VERSION });
        } catch (e) { rec = null; ctx.log.error('recorder failed to start: ' + (e && e.stack || e)); }
        try {
            const cfg = Object.assign({}, (ctx.spec.config && ctx.spec.config.rv) || {});
            cfg.tripMark = ctx.settings.get('tripMark') !== false;
            rv = new RoadView({ log: ctx.log, signals: ctx.signals, rec, fmt: shared('signal_format'), cfg, version: (ctx.spec && ctx.spec.version) || VERSION });
            rv.startLine();
            rv.start();
        } catch (e) {
            ctx.log.error('RV Recorder failed to start: ' + (e && e.stack || e));
            return;
        }
        try { new Menu(ctx, rv, rec).start(); } catch (e) { ctx.log.error('menu failed to start: ' + (e && e.stack || e)); }
        process.on('exit', () => {
            try { rv.stop(); } catch (e) { /* exiting anyway */ }
            try { if (rec && rec.on) rec.stop(true); } catch (e) { /* exiting anyway */ }
        });
    },
});
