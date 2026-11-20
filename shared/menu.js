'use strict';
/**
 * menu.js - the app's centre screen as BMW's own (native RHMI) widgets: the "menu" screen MAIN of app.json, which the
 * kit generates (kit/tools/build.py) and wires (kit/runtime/mgu.js wireSettings: every setting's checkbox / drop-down).
 * Since 2026-11-14 in place of the drawn page (page.js, retired). This file fills the rows the kit doesn't:
 *
 *   NOW_GFX      graphic   the picture of the theme showing (previews.js, pushed as a PNG like a canvas screen's)
 *   NOW          tworow    its name / tag line and which drive mode picked it; a press opens the gallery (or takes
 *                          the screen back while the other app has it)
 *   SET_BYMODE, SET_HUDLAYOUT, SET_G20, SET_INCOMFORT, SET_INSPORT, SET_INECO   the kit's own rows, placed up here
 *                          (app.json items ["setting", key]); the three drive-mode rows hidden while byMode is off
 *                          (config.menu.hideModeRows), and in the Settings list SET_BOTTOMROW hidden while the G20
 *                          toggle is off (config.menu.hideRowUnlessG20)
 *   STATUS, STATUS2  text  on / off and why, the drive mode seen, the own-row line, problems (from hud.js)
 *   BTN_GALLERY  button    opens the drawn gallery (gallery.js, canvas screen GALLERY)
 *   ...the other settings (the kit's)
 *   STATUS_LOG   text      the engine's whole status line (hud.js _status), for checking on the car
 *
 * The shared screen (screen.js): the drawn page asked "HUD Widgets is on, turn it off?" before taking it. RHMI pop-ups
 * are not something the kit can make, so here a theme picked anywhere (a drop-down, the checkbox, the gallery) takes the
 * screen when the cluster then draws one: HUD Widgets steps aside on its next read, and STATUS2 says it was turned off.
 *
 * Every handler runs inside guard(): an exception that escaped would end the app, and the car's crash handler uninstalls
 * an app after its second crash. Plain Node 8 (the car's 8.16.2).
 */
const { Canvas } = require('./kit/canvas');
const previews = require('./previews');
const HudApp = require('./hud');
const I = require('./lang');          // r1120 LN: every word on this screen from shared/i18n/<lang>.json

const LOOK_KEYS = ['hudLayout', 'inComfort', 'inSport', 'inEco', 'g20'];
const MODE_KEY = { comfort: 'inComfort', sport: 'inSport', eco: 'inEco' };
const MODE_NAME = { comfort: 'Comfort', sport: 'Sport', eco: 'Eco Pro' };     // BMW's own mode names (the car's buttons), the same in every language
const MODE_ROWS = ['SET_INCOMFORT', 'SET_INSPORT', 'SET_INECO'];
// the one bottom-row setting's row, hidden while the G20 toggle is off (config.menu.hideRowUnlessG20): with G20 off
// our own background covers BMW's row, so there is nothing to choose
const ROW_ROW = 'SET_' + HudApp.ROW_KEY.toUpperCase();
const NOTE_MS = 5 * 60 * 1000;          // how long STATUS2 says the other app was turned off
const PIC_BG = '#05070a';

/** A layout's short name: "Off (BMW's own cluster)" -> "BMW's own cluster". A see-through layout file is named by its
 *  theme plus " + G20" ("6WB Comfort + G20"), since "+ G20" is a toggle and no longer a theme of its own. */
function layoutName(settings, v) {
    if (v === 'off') return I.t('menu.bmwCluster');
    const theme = HudApp.themeOf(v);
    const s = settings.item('hudLayout'), o = s && (s.options || []).find((x) => x[0] === theme);
    return (o ? o[1] : String(theme)) + (theme !== v ? ' + G20' : '');
}
/** The setting a theme picked in the gallery goes to: the drive mode's own while the theme changes with it. */
function lookKey(hud) {
    return hud.setting('byMode') === true && MODE_KEY[hud.driveMode] ? MODE_KEY[hud.driveMode] : 'hudLayout';
}
/** The layout showing now, else the one meant to (before cluster-render answers). */
function shownName(hud) {
    return hud.activeName || hud._layoutName() || 'off';
}

/** A layout's tag line (app main.js TAGS: { layout: key }; a key with no word is shown as it is). */
function tagOf(cfg, name) {
    const k = (cfg && cfg.tags || {})[name];
    return k ? (I.has(k) ? I.t(k) : String(k)) : '';
}
/** cluster-render's socket is there (connecting) or not (not installed / not running). */
function socketThere(hud) {
    try { return !!(hud.socketPath && require('fs').existsSync(hud.socketPath)); } catch (e) { return false; }
}
/** hud.js _drawnNote in words of ours: waiting for the display, or how many layers are drawn (the reasons stay the renderer's). */
function drawnNote(hud) {
    const d = typeof hud._drawnInfo === 'function' ? hud._drawnInfo() : null;
    if (!d) return '';
    const bits = [];
    if (d.waiting) bits.push(I.t(d.waiting === 'foreign' ? 'menu.drawn.foreign' : 'menu.drawn.bmw'));
    else if (d.total && d.shown !== d.total && (d.why || d.shown)) bits.push(I.plural('menu.drawn.some', d.total, { shown: d.shown }) + (d.why ? ' (' + d.whyN + ' ' + d.why + ')' : ''));
    if (d.refused) bits.push(I.t('menu.drawn.refused', { what: d.refused }));
    return bits.join(', ');
}

class Menu {
    /** cfg: { tags: { layout: 'tag line' } } */
    constructor(ctx, hud, cfg) {
        this.ctx = ctx; this.ui = ctx.ui; this.hud = hud; this.cfg = cfg || {};
        this.log = ctx.log;
        this.sent = Object.create(null);     // component -> the text last written (nothing re-sent unchanged)
        this.picShown = null;                // the layout whose picture NOW_GFX has
        this.note = null;                    // { text, until }: the other app was turned off
        this.timer = null;
        const mc = (ctx.spec.config && ctx.spec.config.menu) || {};
        this.hideModeRows = mc.hideModeRows !== false;
        this.modeRowsOn = null;
        this.hideRowUnlessG20 = mc.hideRowUnlessG20 !== false;
        this.rowRowOn = null;
    }

    guard(what, fn) {
        try { return fn(); } catch (e) { this.log.error('menu ' + what + ': ' + (e && e.stack || e)); return undefined; }
    }
    /** The component is in this build's RHMI (without a warning per call, as ui.comp gives). */
    has(name) {
        const r = this.ui.rhmi;
        return !!(r && typeof r.getByName === 'function' && r.getByName(name));
    }

    start() {
        const ctx = this.ctx, ui = this.ui;
        ui.onClick('BTN_GALLERY', () => this.guard('gallery', () => ui.open('GALLERY')));
        ui.onClick('BTN_DIAG', () => this.guard('diag', () => ui.open('DIAG')));      // b7: the Діагностика sub-screen (app.json screen DIAG; its rows are the kit's)
        // BTN_SETTINGS (the second screen, app.json SETTINGS: every other setting) is the kit's own: mgu.js opens it
        ui.onClick('NOW', () => this.guard('now', () => {
            const scr = this.hud.screen;
            // stepping aside for the other app: a press takes the screen back; else the gallery
            if (scr && scr.yielded) { scr.claim(); this.soon(); return null; }
            return ui.open('GALLERY');
        }));
        // registered after hud.js's own listener (HudApp's constructor), so the engine has already rebuilt
        ctx.settings.onChange((key) => this.guard('setting ' + key, () => {
            if (LOOK_KEYS.indexOf(key) >= 0 || key === 'byMode') this.takeScreen();
            if (key === 'byMode') this.modeRows(false);
            if (key === 'g20') this.rowRow(false);
            this.soon();
        }));
        this.hud.onStatus(() => this.soon());
        // r1120 LN: a new language - every row again (the kit's own rows are written by shared/lang.js)
        I.onChange(() => this.guard('language', () => { this.sent = Object.create(null); this.picShown = null; this.soon(0); }));
        ui.onVisible((name, on) => this.guard('visible', () => {
            // the bottom-row setting's row lives in the Settings list, so it is written again when THAT opens
            if (name === 'SETTINGS' && on) { this.rowRowOn = null; this.rowRow(false); return; }
            if (name !== 'MAIN' || !on) return;
            // the HMI builds the screen afresh: everything again (the kit drops its "same image" memory itself)
            this.sent = Object.create(null); this.picShown = null; this.modeRowsOn = null; this.rowRowOn = null;
            this.soon(0);
        }));
        this.refresh();
    }

    /** A theme was picked: when the cluster now draws one, take the shared screen (the other app steps aside). */
    takeScreen() {
        const hud = this.hud, scr = hud.screen;
        if (!scr || hud._layoutName() === 'off') return;
        const other = scr.otherOn();
        scr.claim();
        if (other) {
            this.note = { key: 'menu.note.otherOff', name: scr.otherName, until: Date.now() + NOTE_MS };
            this.log.info('menu: a theme was picked while ' + scr.otherName + ' was on: it steps aside');
        }
    }

    soon(ms) {
        if (this.timer) return;
        this.timer = setTimeout(() => { this.timer = null; this.refresh(); }, ms === undefined ? 250 : ms);
    }

    refresh() {
        this.guard('refresh', () => {
            this.modeRows(false);
            this.rowRow(false);
            const hud = this.hud, settings = this.ctx.settings, name = shownName(hud);
            const yielded = !!(hud.screen && hud.screen.yielded);
            this.cells('NOW', {
                Text1stRow: layoutName(settings, name),
                Text2ndRow: yielded ? I.t('menu.now.yielded', { app: hud.screen.otherName }) : this.nowLine(name),
            });
            const lines = this.statusLines();
            this.text('STATUS', lines[0]);
            this.text('STATUS2', lines[1]);
            // the engine's own status line, for checking on the car: technical, English as the log (only its label is ours)
            this.text('STATUS_LOG', I.t('menu.engine', { status: hud.lastStatus || 'starting' }));
            this.picture(name);
        });
    }

    /** NOW's second row: the tag line and where the choice came from. */
    nowLine(name) {
        const hud = this.hud, tag = name === 'off' ? I.t('menu.tag.stock') : tagOf(this.cfg, name);
        let why;
        if (!this.ctx.settings.item('byMode')) why = I.t('menu.why.one');        // twin_dial: no drive-mode themes
        else if (hud.setting('byMode') !== true) why = I.t('menu.why.same');
        else if (MODE_KEY[hud.driveMode]) why = I.t('menu.why.mode', { mode: MODE_NAME[hud.driveMode] });
        else why = I.t('menu.why.wait');
        return tag ? I.t('menu.now.tagWhy', { tag: tag, why: why }) : why;
    }

    /** [headline, details] for STATUS and STATUS2, short enough for one row each. */
    statusLines() {
        const hud = this.hud, scr = hud.screen;
        const ready = !!(hud.client && hud.client.ready);
        const demo = !!(hud.car && hud.car.data && hud.car.data().demo);
        let head;
        if (!ready) head = I.t(socketThere(hud) ? 'menu.status.connecting' : 'menu.status.noRenderer', { app: hud.label });
        // 0.7.13: the KOMBI guard turned the theme off (hud.js _kombiWatch)
        else if (hud.kombiTrip) head = I.t('menu.status.kombiTrip', { name: layoutName(this.ctx.settings, hud.kombiTrip.layout) });
        else if (hud.problem) head = I.t('menu.status.problem', { what: hud.problem });        // the problem itself: the engine's own (technical) words
        else if (scr && scr.yielded) head = I.t('menu.status.yielded', { app: scr.otherName });
        else if (!hud.activeName || hud.activeName === 'off') head = I.t('menu.status.off');
        else head = I.t(demo ? 'menu.status.onDemo' : 'menu.status.on', { name: layoutName(this.ctx.settings, hud.activeName) });
        const parts = [];
        if (this.note && Date.now() < this.note.until) parts.push(I.t(this.note.key, { app: this.note.name }));
        else this.note = null;
        if (!this.ctx.settings.item('byMode')) { /* twin_dial: no drive-mode themes, nothing to say */ }
        else if (hud.setting('byMode') !== true) parts.push(I.t('menu.mode.same'));
        else if (hud.driveRaw) parts.push(I.t('menu.mode.unknown', { raw: hud.driveRaw }));
        else if (MODE_KEY[hud.driveMode]) parts.push(I.t('menu.mode.is', { mode: MODE_NAME[hud.driveMode] }));
        else parts.push(I.t('menu.mode.wait'));
        const drawn = ready ? drawnNote(hud) : '';
        if (drawn) parts.push(drawn);
        const dn = hud.diag && typeof hud.diag.active === 'function' ? hud.diag.active().length : 0;
        if (dn) parts.push(I.t('menu.diagOn', { n: dn }));      // b7: a diagnostics setting is on
        if (ready && hud.ownRow && typeof hud._own === 'function') {
            parts.push(I.t('menu.row', { items: ['range', 'clock', 'temp'].map((i) => I.t('menu.row.' + i) + ' ' + I.t(hud._own(i) ? 'menu.row.ours' : 'menu.row.bmw')).join(', ') }));
        }
        return [head, parts.join('. ')];
    }

    /** In Comfort / In Sport / In Eco Pro only while the theme changes with the drive mode (config.menu.hideModeRows). */
    modeRows(force) {
        const on = !this.hideModeRows || this.hud.setting('byMode') === true;
        if (!force && on === this.modeRowsOn) return;
        this.modeRowsOn = on;
        MODE_ROWS.forEach((n) => { if (this.has(n)) this.ui.visible(n, on); });
    }

    /** "Bottom row while G20 shows" only while the G20 toggle is on (config.menu.hideRowUnlessG20): with it off our own
     *  background covers BMW's row, so the row is always ours and there is nothing to pick (hud.js _own). If the HMI
     *  ignores Visible on a list row (unverified on the car, docs/UI-NATIVE-REPORT.md), the row simply stays visible
     *  and is inert - nothing breaks either way. */
    rowRow(force) {
        const on = !this.hideRowUnlessG20 || this.hud.setting('g20') === true;
        if (!force && on === this.rowRowOn) return;
        this.rowRowOn = on;
        if (this.has(ROW_ROW)) this.ui.visible(ROW_ROW, on);
    }

    text(name, s) {
        s = String(s || '');
        if (this.sent[name] === s || !this.has(name)) return;
        this.sent[name] = s;
        this.ui.text(name, s);
    }
    cells(name, obj) {
        const key = JSON.stringify(obj);
        if (this.sent[name] === key || !this.has(name)) return;
        this.sent[name] = key;
        this.ui.cells(name, 0, obj);
    }

    /** NOW_GFX: the theme's picture (previews.js 'big'), or its name on black when there is none (BMW's own). */
    picture(name) {
        if (this.picShown === name || !this.has('NOW_GFX')) return;
        this.picShown = name;
        const p = name !== 'off' ? previews.pixels(name, 'big') : null;
        let cv;
        if (p) cv = new Canvas(p.w, p.h).drawImage(p.px, p.w, p.h, 0, 0, p.w, p.h);
        else {
            cv = new Canvas(888, 333).clear(PIC_BG);
            cv.text(layoutName(this.ctx.settings, name), 444, 178, 30, '#8a96a8', { align: 'center', literal: true });
        }
        // a canvas.js Canvas, not a Recorder: the kit hands it to the HMI as a PNG (mgu.js Ui._image), as on a
        // canvas screen without the renderer; failures are logged there, never thrown
        this.ui.image('NOW_GFX', cv);
    }
}

Menu.LOOK_KEYS = LOOK_KEYS;
Menu.MODE_KEY = MODE_KEY;
Menu.MODE_NAME = MODE_NAME;
Menu.layoutName = layoutName;
Menu.lookKey = lookKey;
Menu.shownName = shownName;
Menu.themeOf = HudApp.themeOf;      // a see-through layout file -> the theme the gallery's cards show
module.exports = Menu;
