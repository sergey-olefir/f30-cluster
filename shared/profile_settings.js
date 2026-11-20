'use strict';
/**
 * profile_settings.js - the look and layout settings follow the car's active driver profile (r1120 PS,
 * docs/r1120/PS-REPORT.md). One set per profile slot in <dataDir>/profiles/<slot>.json; the diagnostic switches and
 * anything about the car's hardware stay one global set (TABLE below). The kit's data/settings.json always holds the set
 * in use (and, in its mark "_psSlot", whose set that is), so the app starts with the last known profile's look.
 *
 * The active profile, READ ONLY (nothing here writes to the car or calls a method):
 *   SessionManager (0xFC01, instance ...SessionManager): the field currentUserAccountReference (getter 1) and the event
 *     currentUserOnChange (32769, "selective": it may never reach an app - docs/DRIVER-PROFILES-APP.md 6.8). So the field is
 *     also read at start, on every wake-up the app already sees (kick(): the engine starting or stopping, the vehicle
 *     condition changing, the menu opened) and on a slow poll (config.profileSettings.pollMs, default 15 s: one getter).
 *   UserAccount.<slot>.id (getter 1, the platform's grant): persod's own id of the profile in that slot, read once per
 *     switch and kept only as a hash, so a slot that a NEW profile reuses starts over (as Driver Profiles keys
 *     pia-seen.json). No other UserAccount field is read: no name, first name, gcid, e-mail, BMW ID, key data.
 * Both grants are the kit's platform ones (kit/tools/build.py PLATFORM_PROXIES): every kit app has them.
 *
 * A switch: debounced (quiet config.profileSettings.quietMs, default 1.5 s, and at least gapMs, default 2 s, after the last
 * one), then the slot's set goes in through Settings.setMany: one save, each key's listeners, one rebuild (shared/hud.js
 * onBatch), so the load guard, the KOMBI guard and the scene-texture rule (drop the unused textures first) all hold. A slot
 * seen for the first time (or reused by a new profile) starts as a copy of the set in use. While the profile is not known
 * the set in use stays. The setting "profileSets" (Налаштування для кожного профілю, default on) off: one shared set, as before.
 *
 * Logs and the status carry the slot only (i01, guest). Every file written under a temporary name and renamed into place.
 * Plain Node 8 (the car's 8.16.2); every callback guarded: an exception that escaped would end the app.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PERS = 'de.bmw.infotainment.personalization.';
const SM = PERS + 'SessionManager';
const UA = PERS + 'UserAccount';
const UAM = PERS + 'UserAccountManager';
const SLOTS = ['guest', 'valet', 'i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07'];
const ENABLE_KEY = 'profileSets';
const SLOT_MARK = '_psSlot';
const FILE_V = 1;
const GET_MS = 4000;
const DEFAULTS = { pollMs: 15000, quietMs: 1500, gapMs: 2000, kickMs: 2000 };

/**
 * Which settings follow the profile and which stay global, per app. A key in neither list stays global (as before this
 * round) and is logged once; bench/test-profile-settings.js checks that the two lists cover every setting of each app.
 *   per profile: the look and the layout (theme, layout, the pages and tabs, the night look, units, language)
 *   global:      the switch itself, Діагностика (the experiments and probes), the demo data, the car's hardware
 *                (redline, the cold-engine rev guard)
 */
const TABLE = {
    f30_cluster: {
        perProfile: ['hudLayout', 'g20', 'byMode', 'needleSmooth', 'stockMap', 'wbFoot', 'dialShade', 'bottomRow', 'ccStyle',
            'limitArc', 'modeLabel', 'gearTray', 'inComfort', 'inSport', 'inEco', 'nightDim', 'nightLook', 'units', 'lang'],
        global: [ENABLE_KEY, 'coldGuard', 'demo', 'diagRelease', 'diagShownNow', 'diagSceneTex', 'diagMbGap', 'diagMbCover', 'diagMbRebuild'],
    },
    twin_dial: {
        perProfile: ['hudLayout', 'centre', 'tab', 'tabLock', 'techData', 'navView', 'nightLook', 'bandGain', 'callerName', 'units', 'lang'],
        global: [ENABLE_KEY, 'redline', 'demo', 'diagRelease', 'diagMapWindow', 'diagMapForce', 'diagMapSlots', 'diagSilent', 'diagGpuText',
            'diagR8Mark', 'diagCarplayTurns', 'diagFrontVehicle'],
    },
};

/** "de.bmw...UserAccountManager.i01" -> "i01" (null when it is not one of the slots). */
function slotOf(ref) {
    if (ref && typeof ref === 'object') ref = ref.currentUserAccountReference;
    if (typeof ref !== 'string') return null;
    const s = ref.split('.').pop();
    return SLOTS.indexOf(s) >= 0 ? s : null;
}
const refOf = (slot) => UAM + '.' + slot;
/** persod's id as we keep it: a short hash, never the id itself. */
const idHash = (id) => (typeof id === 'string' && id ? crypto.createHash('sha1').update(id).digest('hex').slice(0, 12) : null);
const msg = (e) => String(e && e.message ? e.message : e).slice(0, 120);
function withTimeout(p, ms, what) {
    let t;
    return Promise.race([Promise.resolve(p), new Promise((res, rej) => { t = setTimeout(() => rej(new Error(what + ': no answer in ' + ms + ' ms')), ms); })])
        .then((v) => { clearTimeout(t); return v; }, (e) => { clearTimeout(t); throw e; });
}

/** Write a file whole or not at all: a temporary name, then a rename. Throws on failure (the callers log it). */
function writeAtomic(file, text) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
}

class ProfileSettings {
    /** ctx: the kit's (settings, signals, log, dataDir, spec); opts: { app, perProfile, global, pollMs, quietMs, gapMs } */
    constructor(ctx, opts) {
        const o = opts || {};
        this.ctx = ctx;
        this.log = ctx.log || { info() {}, warn() {}, error() {} };
        this.settings = ctx.settings;
        this.sig = ctx.signals;
        const cfg = (ctx.spec && ctx.spec.config && ctx.spec.config.profileSettings) || {};
        const num = (k) => (typeof o[k] === 'number' ? o[k] : typeof cfg[k] === 'number' ? cfg[k] : DEFAULTS[k]);
        this.pollMs = num('pollMs'); this.quietMs = num('quietMs'); this.gapMs = num('gapMs'); this.kickMs = num('kickMs');
        this.app = o.app || (ctx.spec && ctx.spec.id) || '';
        const t = TABLE[this.app] || {};
        const schema = (this.settings && this.settings.schema || []).map((s) => s.key);
        this.per = (o.perProfile || t.perProfile || []).filter((k) => schema.indexOf(k) >= 0);
        this.global = (o.global || t.global || []).slice();
        this.unlisted = schema.filter((k) => this.per.indexOf(k) < 0 && this.global.indexOf(k) < 0);
        this.dir = path.join(ctx.dataDir || '.', 'profiles');
        this.held = SLOTS.indexOf(this.settings.get(SLOT_MARK)) >= 0 ? this.settings.get(SLOT_MARK) : null;   // whose set settings.json holds
        this.active = null;          // the slot the car says is active now (null: not known)
        this.source = null;          // 'read' | 'event' | 'poll' | 'kick ...'
        this.known = false;
        this.ids = {};               // slot -> idHash read at its last switch (null: not readable)
        this.sm = null; this.ua = {};
        this.timer = null; this.pollT = null; this.reading = null; this.lastApply = 0; this.lastKick = 0;
        this.applies = 0;            // how many sets were put in (tests: flapping)
        this.listeners = [];
        this.stopped = false;
    }

    enabled() { return this.settings.get(ENABLE_KEY) !== false; }
    isPer(key) { return this.per.indexOf(key) >= 0; }
    onChange(fn) { if (typeof fn === 'function') this.listeners.push(fn); }
    changed(why) { this.listeners.forEach((fn) => { try { fn(why); } catch (e) { this.log.error('profile listener: ' + msg(e)); } }); }
    guard(what, fn) {
        try { const r = fn(); if (r && typeof r.catch === 'function') r.catch((e) => this.log.error('profile ' + what + ': ' + msg(e))); return r; } catch (e) { this.log.error('profile ' + what + ': ' + msg(e)); return undefined; }
    }
    /** What the menu shows: { enabled, slot, known, held }. */
    info() { return { enabled: this.enabled(), slot: this.active, known: this.known, held: this.held, source: this.source, per: this.per.slice(), global: this.global.slice() }; }

    /* ---------------- the files ---------------- */

    fileOf(slot) { return path.join(this.dir, slot + '.json'); }
    /** A slot's saved set: { slot, id, values } or null (none, or not readable: a half-written temp file is never read). */
    readSet(slot) {
        try {
            const j = JSON.parse(fs.readFileSync(this.fileOf(slot), 'utf8'));
            if (!j || typeof j !== 'object' || !j.values || typeof j.values !== 'object') return null;
            return { slot, id: typeof j.id === 'string' ? j.id : null, values: j.values };
        } catch (e) { return null; }
    }
    writeSet(slot, id, values) {
        try {
            try { fs.mkdirSync(this.dir); } catch (e) { /* there */ }
            writeAtomic(this.fileOf(slot), JSON.stringify({ v: FILE_V, slot, id: id || null, values }, null, 1));
            return true;
        } catch (e) { this.log.warn('profile: cannot save the set of ' + slot + ' (' + msg(e) + ')'); return false; }
    }
    /** The per-profile values in use now. */
    current() {
        const out = {};
        this.per.forEach((k) => { if (this.settings.get(k) !== undefined) out[k] = this.settings.get(k); });
        return out;
    }

    /* ---------------- start ---------------- */

    start() {
        if (this.unlisted.length) this.log.info('profile: settings in neither list stay global: ' + this.unlisted.join(', '));
        this.log.info('profile: per-profile settings ' + (this.enabled() ? 'on' : 'off') + ', ' + this.per.length + ' per profile, ' +
            (this.settings.schema.length - this.per.length) + ' global; the set in use is ' + (this.held || 'not yet any profile\'s'));
        this.settings.onChange((key, value) => this.guard('setting ' + key, () => this.onSetting(key, value)));
        this.guard('subscribe', () => this.connect());
        this.pollT = setInterval(() => this.guard('poll', () => this.read('poll')), this.pollMs);
        if (this.pollT.unref) this.pollT.unref();
        return this;
    }
    stop() { this.stopped = true; clearInterval(this.pollT); clearTimeout(this.timer); }

    async connect() {
        if (!this.sig || typeof this.sig.proxy !== 'function') { this.log.warn('profile: no SOME/IP here, the set in use stays'); return; }
        try { this.sm = await this.sig.proxy(SM, SM); } catch (e) { this.sm = null; this.log.warn('profile: SessionManager not reachable (' + msg(e) + '); the set in use stays'); }
        if (this.sm && typeof this.sig.on === 'function') {
            await Promise.resolve(this.sig.on(this.sm, 'currentUserOnChange', (v) => this.guard('event', () => this.note(slotOf(v), 'event')), this.log))
                .catch((e) => this.log.warn('profile: subscribe currentUserOnChange: ' + msg(e) + ' (the poll stands in)'));
        }
        await this.read('start');
    }

    /** A wake-up the app already sees (the engine, the vehicle condition, the menu opened): read the field again. */
    kick(why) {
        const now = Date.now();
        if (now - this.lastKick < this.kickMs) return;
        this.lastKick = now;
        this.guard('kick', () => this.read('kick ' + (why || '')));
    }

    /** Read currentUserAccountReference (one getter). Never throws. */
    read(how) {
        if (this.stopped) return Promise.resolve(null);
        if (this.reading) return this.reading;
        this.reading = (async () => {
            if (!this.sm && this.sig && typeof this.sig.proxy === 'function') {
                try { this.sm = await this.sig.proxy(SM, SM); } catch (e) { this.sm = null; }
            }
            if (!this.sm) { this.note(null, how, 'SessionManager not reachable'); return null; }
            try {
                const ref = await withTimeout(this.sig.get(this.sm, 'currentUserAccountReference', GET_MS), GET_MS + 500, 'currentUserAccountReference');
                const s = slotOf(ref);
                this.note(s, how, s ? null : 'not a profile reference');
                return s;
            } catch (e) { this.note(null, how, msg(e)); return null; }
        })().catch((e) => { this.log.error('profile read: ' + msg(e)); return null; }).then((v) => { this.reading = null; return v; });
        return this.reading;
    }

    /** What the car said: a slot, or null (not known: the set in use stays). */
    note(slot, how, why) {
        if (!slot) {
            if (this.known || this.source === null) this.log.info('profile: not known (' + how + (why ? ': ' + why : '') + '); the set in use stays' + (this.held ? ' (' + this.held + '\'s)' : ''));
            this.known = false; this.source = how;
            this.changed('unknown');
            return;
        }
        const was = this.active, wasKnown = this.known;
        this.active = slot; this.known = true; this.source = how;
        if (slot !== was || !wasKnown) {
            this.log.info('profile: ' + slot + ' (' + how + ')');
            this.changed('slot');
        }
        if (slot !== this.held || !wasKnown || slot !== was) this.schedule();
    }

    /* ---------------- switching ---------------- */

    schedule() {
        if (!this.enabled()) return;
        clearTimeout(this.timer);
        const wait = Math.max(this.quietMs, this.gapMs - (Date.now() - this.lastApply));
        this.timer = setTimeout(() => { this.timer = null; this.guard('apply', () => this.apply()); }, wait);
    }

    async readId(slot) {
        try {
            if (!this.ua[slot]) this.ua[slot] = await this.sig.proxy(UA, refOf(slot));
            const id = await withTimeout(this.sig.get(this.ua[slot], 'id', GET_MS), GET_MS + 500, slot + '.id');
            return idHash(typeof id === 'string' ? id : null);
        } catch (e) { return null; }
    }

    /** Put the active slot's set in (or adopt the set in use for it). */
    async apply() {
        if (this.stopped || !this.enabled() || !this.known || !this.active) return;
        const slot = this.active;
        const id = await this.readId(slot);
        if (this.stopped || !this.enabled() || slot !== this.active || !this.known) return;      // it changed again meanwhile: that one's own turn
        this.ids[slot] = id;
        const cur = this.current();
        const saved = this.readSet(slot);
        const reused = !!(saved && saved.id && id && saved.id !== id);
        if (slot === this.held) {
            if (reused) { this.log.info('profile: ' + slot + ' holds a new profile now: its set starts over from the one in use'); this.writeSet(slot, id, cur); }
            else if (!saved || (id && !saved.id)) this.writeSet(slot, id || (saved && saved.id) || null, cur);
            this.lastApply = Date.now();
            return;
        }
        if (this.held) this.writeSet(this.held, this.ids[this.held] || (this.readSet(this.held) || {}).id || null, cur);
        let values, what;
        if (saved && !reused) { values = saved.values; what = 'its own set'; if (id && !saved.id) this.writeSet(slot, id, saved.values); }
        else {
            values = cur;
            what = reused ? 'a new profile in this slot: a copy of ' + (this.held || 'the set in use') : 'seen for the first time: a copy of ' + (this.held || 'the set in use');
            this.writeSet(slot, id, values);
        }
        const next = {};
        this.per.forEach((k) => { if (Object.prototype.hasOwnProperty.call(values, k) && this.valid(k, values[k])) next[k] = values[k]; });
        const from = this.held;
        this.held = slot;
        this.settings.values[SLOT_MARK] = slot;
        this.lastApply = Date.now();
        this.applies++;
        const keys = this.settings.setMany(next, 'profile ' + slot);
        this.log.info('profile: ' + (from || '?') + ' -> ' + slot + ', ' + what + ', ' + keys.length + ' setting' + (keys.length === 1 ? '' : 's') + ' changed' + (keys.length ? ' (' + keys.join(', ') + ')' : ''));
        this.changed('applied');
    }

    /** A saved value the schema still takes (a removed option falls back to what is in use). */
    valid(key, v) {
        const s = this.settings.item(key);
        if (!s) return false;
        if (s.type === 'bool') return typeof v === 'boolean';
        if (s.type === 'choice') return (s.options || []).some((o) => o[0] === v);
        if (s.type === 'number') return typeof v === 'number' && isFinite(v) && (!s.steps || s.steps.indexOf(v) >= 0);
        return true;
    }

    /** A setting changed by the driver: a per-profile one goes to the held slot's file. */
    onSetting(key) {
        if (this.settings.batch) return;            // our own switch
        if (key === ENABLE_KEY) {
            if (this.enabled()) {
                // on again: the set in use becomes the active profile's (nothing on the screen changes now)
                if (this.known && this.active) {
                    this.held = this.active;
                    this.settings.values[SLOT_MARK] = this.active;
                    this.settings.save();
                    this.writeSet(this.active, this.ids[this.active] || (this.readSet(this.active) || {}).id || null, this.current());
                }
                this.log.info('profile: per-profile settings on' + (this.held ? ' (the set in use is ' + this.held + '\'s)' : ''));
            } else this.log.info('profile: per-profile settings off: one set for every profile');
            this.changed('enabled');
            return;
        }
        if (!this.enabled() || !this.isPer(key)) return;
        const slot = this.held || (this.known ? this.active : null);
        if (!slot) return;                           // no profile seen yet: settings.json only, adopted when one is
        if (!this.held) { this.held = slot; this.settings.values[SLOT_MARK] = slot; this.settings.save(); }
        this.writeSet(slot, this.ids[slot] || (this.readSet(slot) || {}).id || null, this.current());
    }
}

let current = null;
/** Wire an app (the kit's ctx) once, after its engine exists. Returns the instance (or null). Never throws. */
function attach(ctx, opts) {
    if (current) return current;
    try {
        current = new ProfileSettings(ctx, opts).start();
        const prev = ctx.wake;
        ctx.wake = (why) => { try { if (typeof prev === 'function') prev(why); } catch (e) { /* its own */ } current.kick(why); };
        module.exports.current = current;
    } catch (e) { (ctx && ctx.log || console).error('profile settings: ' + msg(e)); current = null; }
    return current;
}
/** Tests: forget the instance. */
function _reset() { if (current) current.stop(); current = null; module.exports.current = null; }

module.exports = { attach, ProfileSettings, TABLE, SLOTS, ENABLE_KEY, SLOT_MARK, slotOf, refOf, idHash, writeAtomic, current: null, _reset, DEFAULTS };
