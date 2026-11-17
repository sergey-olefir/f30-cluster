'use strict';
/**
 * twin-harness.js - what bench/test-twin-*.js (package C) share: the app's JavaScript tree as the kit's build lays it out
 * (a copy of shared/*.js beside kit/runtime as "kit/", and the app's hud/ folder, both symlinked), in a temp folder, so the real
 * engine (shared/hud.js) can be required on the Mac without a bench, a build or a socket. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** A temp folder holding a copy of every shared/*.js, kit -> kit/runtime and hud -> apps/<app>/hud. */
function tree(app) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-js-'));
    fs.readdirSync(path.join(ROOT, 'shared')).filter((f) => /\.js$/.test(f)).forEach((f) => fs.copyFileSync(path.join(ROOT, 'shared', f), path.join(dir, f)));
    fs.symlinkSync(path.join(ROOT, 'kit', 'runtime'), path.join(dir, 'kit'));
    // hud/: the app's own folder, entry by entry; a missing fonts/ (package A1's bake, not merged yet) or scene/ (A2's) can be
    // lent by TWIN_FONTS / TWIN_SCENE (a folder of td_*.json / of the scene textures), so the tests run before the merge
    const hud = path.join(dir, 'hud'), own = path.join(ROOT, 'apps', app || 'twin_dial', 'hud');
    fs.mkdirSync(hud);
    fs.readdirSync(own).forEach((f) => fs.symlinkSync(path.join(own, f), path.join(hud, f)));
    [['fonts', process.env.TWIN_FONTS], ['scene', process.env.TWIN_SCENE]].forEach((e) => {
        if (!fs.existsSync(path.join(hud, e[0])) && e[1] && fs.existsSync(e[1])) fs.symlinkSync(path.resolve(e[1]), path.join(hud, e[0]));
    });
    return dir;
}

const nolog = { info() {}, warn() {}, error() {}, debug() {} };

/** A HudApp prototype call target: just what the token functions read (no cluster-render, no kit signals). */
function fakeHud(HudApp, over) {
    const settings = Object.assign({ centre: 'cycle' }, (over && over.settings) || {});
    const h = Object.create(HudApp.prototype);
    Object.assign(h, {
        ctx: { settings: { item: (k) => (k in settings ? { key: k } : null), get: (k) => settings[k] } },
        log: (over && over.log) || nolog, config: Object.assign({ twin: { cyclePageMs: 10000, holdAboveKmh: 5 }, trip: { factors: null } }, (over && over.config) || {}),
        driveMode: null, driveVariant: null, rangeKm: null, fuelL: null, ambient: null, tzCar: null, tzLocal: null,
        car: { live: {}, data: () => (h._d || {}) }, _d: {}, theme: null,
    });
    h.setting = (k) => settings[k];
    h._settings = settings;
    return h;
}

module.exports = { ROOT, tree, nolog, fakeHud };
