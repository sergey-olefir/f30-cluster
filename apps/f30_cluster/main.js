'use strict';
/**
 * F30 Cluster: the 6WB-style instrument cluster themes (the 1920x720 "panel" target) drawn through cluster-render.
 *
 * The centre screen is the app's own page (shared/page.js, a canvas screen): the themes with their pictures,
 * which drive mode shows which, and the settings. The shared engine (hud.js) listens to the settings and redraws
 * at once. It keeps running after the page is closed (OAP apps stay up in the background), so the page is only
 * needed for changes.
 */
const mgu = require('./kit/mgu');
const HudApp = require('./hud');
const Page = require('./page');

mgu.run({
    start(ctx) {
        let hud;
        try {
            hud = new HudApp(ctx);
        } catch (e) {
            // nothing drawn, but stay up: an exit here would count as a crash on the car
            ctx.log.error('Cluster failed to start: ' + (e && e.stack || e));
            return;
        }
        hud.start();
        new Page(ctx, hud, {
            title: ctx.spec.title, what: 'cluster',
            look: { name: 'Themes', style: 'hero', tags: { wb_comfort: 'white dials', wb_dials: 'white dials, G20 round them', g20_comfort: 'stock G20 look', wb_sport: 'red glow', wb_sport_dials: 'red glow, G20 round them', wb_eco: 'blue glow', f30: 'basic' } },
            tabs: ['look', 'settings'],
            settings: ['stockMap', 'wbFoot', 'dialShade', 'ownRange', 'ownClock', 'ownTemp', 'modeLabel', 'gearTray', 'baked', 'units', 'clock', 'timeZone', 'tankLitres', 'redline', 'shiftBefore', 'nightDim', 'nightLook', 'badge', 'badgeBMW', 'demo'],
        }).start();
        process.on('exit', () => { try { hud.stop(); } catch (e) { /* exiting anyway */ } });
    },
});
