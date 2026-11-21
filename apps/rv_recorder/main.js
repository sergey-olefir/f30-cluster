'use strict';
/**
 * RV Recorder (round "Road View", package TS; fixes-1121 CR: in the Store, 0.2.0): a READ-ONLY, record-only app. It draws nothing on
 * the cluster or the HUD. One recording records one choice (rv_fields.js), into data/rec/ (shared/signal_recorder.js, the format
 * Signal Probe writes; tools/car/rv_analyse.py and rec_convert.py read it):
 *   RV (S19)      a city drive in daylight: the traffic light, the signs, the display feeds, FASuS's warnings, the road scene and
 *                 the environment model (first message whole, then a summary a second), the camera's state, the context;
 *   CAM (S20)     the camera: objects, lanes, signs, the traffic light, the high-beam light objects, blockage and weather, the
 *                 environment model, the assisted-driving-view inputs, the rear radars' lane-change ids, Road Scene's path sources;
 *   CRUISE (S21)  the cruise and limiter state and the driver's use of it (does a unit answer the multimodal service);
 *   NAV (S22)     the route's metrics, nothing personal (an allow-list per source: never a position, a name or an address).
 * Every choice also records the speed, gear, brake light, indicator and stalk; CAM, CRUISE and NAV also the vehicle condition, the
 * engine status, the lamps, day / night and the outside temperature.
 *
 * Nothing is subscribed until the first press of "Почати запис". Never lets an exception escape: a failed start logs and stays up
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
    return require('../../shared/' + name);
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
