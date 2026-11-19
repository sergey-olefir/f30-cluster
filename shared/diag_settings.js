'use strict';
/**
 * diag_settings.js - the integration layer of Twin Dial 0.1.1 (package B7): the Діагностика settings group, and the start-up hold.
 *
 * 1. THE DIAGNOSTICS SETTINGS (Diag). Experiments and switches that used to be an app.json `config` key edited by hand and
 *    installed again are settings now (a sub-screen "DIAG" of the centre screen, apps/<id>/app.json), every one OFF by default.
 *    app.json `config.diag.settings` says what each setting does to `config`:
 *
 *      "diag": { "settings": {
 *          "diagRelease":   { "on": { "ccActive.release": { "deferValues": [65535], "leftList": true } } },       a bool setting
 *          "diagMapWindow": { "options": { "W1": { "mapWindow": "W1" }, "W2": { "mapWindow": "W2" } } },          a choice: the
 *                                                                                     option's key -> { config path: value }
 *          "diagSilent":    { "act": "silent" }                                                                   an action, no key
 *      } }
 *
 *    A path is dotted ("ccActive.release.witness"); its value is cloned from app.json each time. OFF (a bool false, a choice's
 *    "off", anything that is not an option) = **the key as app.json has it**: the baseline is read once, before the first
 *    write, and put back when the setting goes off (a key app.json does not carry is removed again, with the objects the overlay
 *    made on the way). So a build whose app.json already names one of these keys behaves as that build says until the driver
 *    switches the setting ON, and with every setting off the engine is exactly what it was without this file.
 *
 *    The overlay is applied once in HudApp's constructor, BEFORE anything reads `config` (mbExp, the signal watchers), and again
 *    on every change of one of its settings (changed()), when what the engine has already built from the key is brought up to
 *    date: IN PLACE for the keys the engine reads at the moment of use (ccActive.release, mapWindow ...), by a drop of the scene
 *    textures and a rebuild for `sceneTex` (the textures come from another file), by a new MbExp and a rebuild for the MB
 *    experiments (the layers are made from it), and not at all for a key that is subscribed to only at start (ccDisplayed: the
 *    log says so, and the setting's label says "(after restart)"). Twin Dial's own settings change nothing that needs a rebuild,
 *    but for car-issues GL's diagGpuText (`gpuText`: the glyph atlases are made again, a rebuild).
 *
 * 2. THE START-UP HOLD (hold, config.startupHold). The layout used to be built three times at start: the first time the car's
 *    time zone and the first message list each make the bottom row's clock / info field "ours", and those widgets exist only at a
 *    build (HudApp._own, _rowWhy), so each arrival is a full rebuild (about 1.7 MB of pixels each on Twin Dial). With
 *    config.startupHold the FIRST build waits until both first values are in, or `ms` (default 1000) have passed since cluster-
 *    render was ready, whichever is first: one build instead of three. Nothing after the first build changes. See
 *    docs/twin-dial/R3B-INTEGRATION.md for the bytes and the builds before and after.
 *
 * Log lines say settings names and on / off only: nothing personal. Plain Node 8 (the car's 8.16): no `?.`, no `??`, no spread
 * of objects.
 */

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isNum = (v) => typeof v === 'number' && isFinite(v);

function getPath(obj, parts) {
    let o = obj;
    for (let i = 0; i < parts.length; i++) {
        if (!o || typeof o !== 'object' || !Object.prototype.hasOwnProperty.call(o, parts[i])) return { has: false, value: undefined };
        o = o[parts[i]];
    }
    return { has: true, value: o };
}

function setPath(obj, parts, value) {
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
        o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = value;
}

/** Remove the leaf, then every parent the overlay made that is empty now (`madeUpTo`: how many leading parts were absent at the baseline). */
function delPath(obj, parts, absentFrom) {
    const chain = [obj];
    for (let i = 0; i < parts.length - 1; i++) {
        const next = chain[i] && chain[i][parts[i]];
        if (!next || typeof next !== 'object') return;
        chain.push(next);
    }
    delete chain[chain.length - 1][parts[parts.length - 1]];
    for (let i = parts.length - 2; i >= absentFrom && i >= 0; i--) {
        if (Object.keys(chain[i + 1]).length) break;
        delete chain[i][parts[i]];
    }
}

const ROOTS_MB = ['mbGap', 'mbCover', 'mbCoverRect', 'mbCoverConn', 'mbRebuild'];

class Diag {
    /** config: the app's `config` object (written to); settings: the kit's Settings; log: { info, warn }. */
    constructor(config, settings, log) {
        this.config = config;
        this.settings = settings;
        this.log = log || { info() {}, warn() {} };
        const t = (config && config.diag && config.diag.settings) || {};
        this.table = t;
        this.keys = Object.keys(t).filter((k) => settings.item(k));
        this.base = {};          // path -> { has, value, absentFrom }: the key as app.json has it
        this.cur = {};           // path -> JSON of the value the overlay left there, for the change report
        this.on = {};            // setting key -> the option it has now ('off' or the option's key)
        this.timers = {};        // action -> a timer
        // the baseline of every path any setting can touch, before the first write
        this.keys.forEach((k) => this.paths(k).forEach((p) => {
            if (this.base[p]) return;
            const parts = p.split('.');
            const g = getPath(config, parts);
            // the first part (counted from the root) that app.json does not have: what the overlay may remove again
            let absentFrom = parts.length - 1;
            for (let i = 0; i < parts.length - 1; i++) { if (!getPath(config, parts.slice(0, i + 1)).has) { absentFrom = i; break; } }
            this.base[p] = { has: g.has, value: clone(g.value), absentFrom };
            this.cur[p] = JSON.stringify(g.has ? g.value : null);
        }));
    }

    /** Whether `key` is one of the diagnostics settings of this app. */
    has(key) { return this.keys.indexOf(key) >= 0; }

    /** Every config path setting `key` can write (any option). */
    paths(key) {
        const e = this.table[key] || {}, out = [];
        const add = (m) => Object.keys(m || {}).forEach((p) => { if (out.indexOf(p) < 0) out.push(p); });
        add(e.on);
        Object.keys(e.options || {}).forEach((o) => add(e.options[o]));
        return out;
    }

    /** The option setting `key` is at: "off", "on" (a bool) or the option's key (a choice). */
    option(key) {
        const s = this.settings.item(key), v = this.settings.get(key);
        if (!s) return 'off';
        if (s.type === 'bool') return v === true ? 'on' : 'off';
        if (s.type === 'choice') return (s.options || []).some((o) => o[0] === v) && v !== 'off' ? v : 'off';
        return 'off';
    }

    /** { config path: value } the setting asks for now ({} when it is off). */
    wants(key) {
        const e = this.table[key] || {}, o = this.option(key);
        if (o === 'off') return {};
        return (o === 'on' ? e.on : (e.options || {})[o]) || {};
    }

    /** Settings that are on now (the centre screen's status line). */
    active() { return this.keys.filter((k) => this.option(k) !== 'off'); }

    /**
     * Write config from the settings. -> { keys: the settings whose option changed, paths: the config paths whose value changed }.
     * Settings are applied in the table's order, so a later one can write inside an object an earlier one made.
     */
    apply() {
        const want = {};
        const keys = [];
        this.keys.forEach((k) => {
            const o = this.option(k);
            if (o !== this.on[k]) { if (this.on[k] !== undefined || o !== 'off') keys.push(k); this.on[k] = o; }
            const w = this.wants(k);
            Object.keys(w).forEach((p) => { want[p] = w[p]; });
        });
        // parents before children: a restored parent must not undo a child that is still wanted
        const paths = Object.keys(this.base).sort((a, b) => a.split('.').length - b.split('.').length);
        const changed = [];
        paths.forEach((p) => {
            const parts = p.split('.'), b = this.base[p];
            if (Object.prototype.hasOwnProperty.call(want, p)) setPath(this.config, parts, clone(want[p]));
            else if (b.has) setPath(this.config, parts, clone(b.value));
            else delPath(this.config, parts, b.absentFrom);
            const g = getPath(this.config, parts), now = JSON.stringify(g.has ? g.value : null);
            if (now !== this.cur[p]) { this.cur[p] = now; changed.push(p); }
        });
        keys.forEach((k) => this.log.info('diag: ' + k + ' ' + this.on[k]));
        return { keys, paths: changed };
    }

    /**
     * A diagnostics setting changed: write config, then bring what the engine built from it up to date (see the header).
     * hud: the HudApp. Called from its settings listener, inside its guard.
     */
    changed(hud, key) {
        const r = this.apply();
        const roots = [];
        r.paths.forEach((p) => { const root = p.split('.')[0]; if (roots.indexOf(root) < 0) roots.push(root); });
        let rebuild = false;
        if (roots.indexOf('sceneTex') >= 0) {
            // the textures are keyed by name, not by file: forget them all so the new set is the one made (and the old and the new never sit together)
            // car-issues TX: forget, do not drop here: the old layers still bind them, so the service refuses the drop ("asset in use"), the
            // client keeps them and nothing ever dropped them again (bench: 10 assets leaked per switch, the 16-asset cap, layers left
            // unbound). HudApp._rebuildInner drops every asset it no longer tracks once the old layers are gone, before the new set is made.
            hud.atlases.forEach((a, k) => { if (k.indexOf(':scene:') >= 0) hud.atlases.delete(k); });
            hud.sceneSrcs = null;
            rebuild = true;
        }
        if (roots.some((x) => ROOTS_MB.indexOf(x) >= 0)) {
            // the MB experiments make layers (cut pieces, a cover): a new MbExp, and the old one's cover goes first
            if (hud.mbExp) { try { hud.mbExp.dropOwn(); } catch (e) { /* nothing to drop */ } }
            hud.mbExp = null;
            if (hud.config.mbGap || hud.config.mbCover || hud.config.mbRebuild) {
                hud.mbExp = require('./mb_exp').create(hud.config, hud.log);
                if (hud.mbExp) hud.log.info('mb: experiment on: ' + hud.mbExp.describe());
            }
            rebuild = true;
        }
        // car-issues GL: config.gpuText (diagGpuText) changes how the "gpu" texts are made: a rebuild, which drops the old atlas
        // after the layers that sample it (never before: a sampled asset is refused "asset in use")
        if (roots.indexOf('gpuText') >= 0) rebuild = true;
        if (roots.indexOf('ccDisplayed') >= 0) hud.log.info('diag: config.ccDisplayed is subscribed to at start only: it takes effect after the app restarts');
        // the check-control state is decided from the keys under ccActive each time the lists or the number change: decide it now
        if (roots.indexOf('ccActive') >= 0 && !rebuild) {
            if (typeof hud._ccListEval === 'function') hud._ccListEval(Date.now(), false);
            if (typeof hud._ccPush === 'function') hud._ccPush();
        }
        // an action the setting stands for (no config key)
        const e = this.table[key] || {};
        if (e.act) this.act(hud, e.act, this.option(key) !== 'off');
        // any other engine part that wants to know (Twin Dial's map window reads its keys at the moment of use; this lets it look now)
        if (typeof hud.diagChanged === 'function') hud.diagChanged(r.paths);
        if (rebuild) hud._rebuild(); else hud._status();
        return r;
    }

    /** The actions a setting can stand for. */
    act(hud, name, on) {
        if (name === 'silent') {
            // the silent-fields summary of research3/MK (shared/twin_tokens.js summary()) on demand: once now, then every 5 minutes while on
            clearInterval(this.timers.silent); this.timers.silent = null;
            if (!on) return;
            let tokens = null;
            try { tokens = require('./twin_tokens'); } catch (e) { /* an app without it */ }
            if (!tokens || typeof tokens.summary !== 'function') { hud.log.info('diag: no silent-fields summary in this app'); return; }
            const run = () => { try { tokens.summary(hud); } catch (e) { hud.log.warn('diag: silent-fields summary: ' + (e && e.message || e)); } };
            run();
            this.timers.silent = setInterval(run, 5 * 60 * 1000);
            if (this.timers.silent.unref) this.timers.silent.unref();
        }
    }

    /** The app is stopping. */
    stop() {
        Object.keys(this.timers).forEach((k) => { clearInterval(this.timers[k]); this.timers[k] = null; });
    }

    /** The centre screen's status text: "" while nothing is on. */
    summary() {
        const n = this.active().length;
        return n ? 'Diagnostics on: ' + n : '';
    }
}

/** null unless app.json config.diag names settings this app has; the overlay is applied at once. */
Diag.create = function create(config, settings, log) {
    if (!config || !config.diag || !config.diag.settings || !settings || typeof settings.item !== 'function') return null;
    const d = new Diag(config, settings, log);
    if (!d.keys.length) return null;
    d.apply();
    return d;
};

/**
 * config.startupHold ({ "ms": 1000 } or true; absent / false: off): whether the build now asked for must wait. Called at the top
 * of HudApp._rebuildInner once cluster-render is ready. true = leave without building; a timer asks again when the time is up.
 * The first build only: after it every rebuild is as before.
 */
function hold(hud) {
    const h = hud.config && hud.config.startupHold;
    if (!h || hud.startupDone) return false;
    const ms = isNum(h.ms) ? h.ms : 1000;
    const st = hud._hold || (hud._hold = { t0: Date.now(), timer: null });
    const waits = waiting(hud);
    const left = st.t0 + ms - Date.now();
    if (!waits.length || left <= 0) {
        hud.startupDone = true;
        if (st.timer) { clearTimeout(st.timer); st.timer = null; }
        hud.log.info('start-up: first build after ' + (Date.now() - st.t0) + ' ms' + (waits.length ? ', still waiting for ' + waits.join(' and ') + ' (config.startupHold.ms ' + ms + ')' : ', every first value in'));
        return false;
    }
    // nothing of ours is on the screen yet, but the state the engine reports is the blind one the machine starts in (SPEC 8.4 keep-open 1:
    // "window" until the car's messages can be read), not the construction default "none": no moment of "ready and none"
    if (hud.twinMsg && hud.twinCc && hud.twinCc.state === 'none') hud.twinCc = { state: 'window', severity: null };
    if (!st.timer) {
        st.timer = setTimeout(() => { st.timer = null; hud._rebuild(); }, left);
        if (st.timer.unref) st.timer.unref();
    }
    return true;
}

/** The first values the engine still waits for: each one is a rebuild of its own when it arrives (HudApp._own / _rowWhy). */
function waiting(hud) {
    const c = hud.config || {}, w = [];
    const ok = (x) => !!(x && x.iface && x.field);
    const tzOk = (v) => isNum(v) && v % 15 === 0 && Math.abs(v) <= 14 * 60;      // as hud.js tzOk
    const zone = tzOk(hud.tzCar) || tzOk(hud.tzLocal);
    // config.clock without "confirm" is only logged (the clock keeps the setting): it never arrives as a zone
    if (!zone && ((ok(c.clock) && c.clock.confirm === true) || ok(c.clockLocal))) w.push('the time zone');
    const wired = typeof hud._ccWired === 'function' ? hud._ccWired() : true;
    if (!wired && (ok(c.ccm) || ok(c.ccList) || ok(c.ccActive))) w.push('the message list');
    return w;
}

/** The app is stopping: no timer left. */
function release(hud) {
    if (hud._hold && hud._hold.timer) { clearTimeout(hud._hold.timer); hud._hold.timer = null; }
    if (hud.diag) hud.diag.stop();
}

module.exports = { Diag, hold, release, waiting };
