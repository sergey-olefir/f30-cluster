'use strict';
/**
 * Driver Profiles: the car's driver profiles on the centre screen (BMW's own list widgets). Lists guest, valet and the
 * personal slots i01..i07 with their details; adds a local (offline) profile, renames one, copies Guest's settings
 * into one, deletes one. Every write asks on a confirm screen and is checked again right before it is sent.
 *
 *   profiles.js   the SOME/IP side (persod's UserAccountManager / UserAccount / SessionManager, and the checks)
 *   screens.js    the native screens (app.json "screens")
 *   format.js     enums and row texts
 *
 * See docs/DRIVER-PROFILES-APP.md. Plain Node 8 (the car's 8.16.2). Nothing here may throw out of a callback: an
 * unexpected exit counts as a crash, and the car's crash handler uninstalls an app after its second one.
 */
const mgu = require('./kit/mgu');
const I18N = require('./lang');
const Profiles = require('./profiles');
const Screens = require('./screens');

mgu.run({
    start(ctx) {
        // r1120 LN: the language (setting "Мова / Language", the head unit's): first, so every word below is in it
        try { I18N.attach(ctx); } catch (e) { ctx.log.error('lang: ' + (e && e.stack || e)); }
        let profiles, screens;
        try {
            profiles = new Profiles(ctx);
            screens = new Screens(ctx, profiles);
            screens.start();
        } catch (e) {
            // nothing shown, but stay up: an exit here would count as a crash on the car
            ctx.log.error('Driver Profiles failed to start: ' + (e && e.stack || e));
            return;
        }
        // the proxies and the first read run after start() returned: MainApp waits for initialized() meanwhile
        Promise.resolve().then(() => profiles.start())
            .catch((e) => ctx.log.error('profiles start: ' + (e && e.stack || e)))
            .then(() => { try { screens.render(); } catch (e) { ctx.log.error('render: ' + (e && e.stack || e)); } });
    },
});
