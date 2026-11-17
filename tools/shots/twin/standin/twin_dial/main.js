'use strict';
/** STAND-IN main.js (tools/shots/twin/standin): the kit's run loop around the stand-in engine. Bench only. */
const mgu = require('./kit/mgu');
const HudApp = require('./hud');

mgu.run({
    start(ctx) {
        let hud;
        try { hud = new HudApp(ctx); } catch (e) { ctx.log.error('stand-in failed to start: ' + (e && e.stack || e)); return; }
        hud.start();
        process.on('exit', () => { try { hud.stop(); } catch (e) { /* exiting */ } });
    },
});
