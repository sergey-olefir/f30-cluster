'use strict';
/**
 * profile_settings.js - the look and layout settings follow the car's active driver profile (r1120 PS,
 * docs/r1120/PS-REPORT.md; fixed in round 1121 PF, docs/fixes-1121/PF-REPORT.md). One set per profile slot in
 * <dataDir>/profiles/<slot>.json; the diagnostic switches and anything about the car's hardware stay one global set (TABLE
 * below). The kit's data/settings.json always holds the set in use (and, in its mark "_psSlot", whose set that is), so the
 * app starts with the last known profile's look.
 *
 * The active profile, READ ONLY (nothing here writes to the car or calls a method):
 *   SessionManager (0xFC01, instance ...SessionManager): the field currentUserAccountReference (getter 1) and the event
 *     currentUserOnChange (32769, "selective": it may never reach an app - docs/DRIVER-PROFILES-APP.md 6.8). The event is a
 *     HINT: it is taken, then the field is read again, and the fast poll starts. The field is read at start (before the
 *     theme's first build, which waits up to config.profileSettings.firstMs for it: shared/hud.js _profileHold), on every
 *     wake-up the app already sees (kick(): the engine starting or stopping, the vehicle condition changing, the menu
 *     opened), and on a poll: every fastMs (3 s) for fastWindowMs (60 s) after the start and after each wake-up or event,
 *     then every pollMs (15 s). While it does not answer it is asked again after 1, 2, 4 ... s (never slower than the poll).
 *   UserAccount.<slot>.id (getter 1, the platform's grant): persod's own id of the profile in that slot, read AFTER a switch
 *     (the switch never waits for it) and kept only as a hash. A slot whose id reads differently TWICE in a row holds a new
 *     profile and starts over; an id that cannot be read, or reads differently only once, never counts as a new profile.
 *     No other UserAccount field is read: no name, first name, gcid, e-mail, BMW ID, key data.
 * Both grants are the kit's platform ones (kit/tools/build.py PLATFORM_PROXIES): every kit app has them.
 *
 * A switch: debounced (quiet quietMs, 1.5 s, and at least gapMs, 2 s, after the last one; the FIRST decision after the start
 * is not debounced), then the slot's set goes in through Settings.setMany: one save, each key's listeners, one rebuild
 * (shared/hud.js onBatch), so the load guard, the KOMBI guard and the scene-texture rule (drop the unused textures first) all
 * hold.
 *
 * The stored sets are safe (PF): a profile's file is replaced only by a save of that profile's OWN set - a setting changed
 * while the car says that profile is active, has said so for settleMs (8 s: at a wake-up the car may still report the last
 * driver for a few seconds), and its set is the one in use. A change made before that - the profile not known, not yet
 * settled, or the car already saying another profile with the switch pending - stays on the screen but is saved to nobody's
 * file: it is saved once the car has said the profile whose set is in use for settleMs; a switch drops it. A slot seen for the first time
 * starts as a copy of the seed: the settings from before per-profile settings (settings.pre-profiles.json, kept once and never
 * overwritten) when they exist, else the set in use. A file that is there but cannot be read is never taken as "first
 * seen": its backup is used, else it is kept aside as <slot>.json.bad. Every replaced file keeps its previous version as
 * <slot>.json.bak. Files are written under a temporary name and renamed into place.
 *
 * Logs and the status carry the slot only (i01, guest): never a name, a persod id or its hash. Plain Node 8 (the car's
 * 8.16.2); every callback guarded: an exception that escaped would end the app.
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
const PRE_FILE = 'settings.pre-profiles.json';
const DEFAULTS = {
    pollMs: 15000, fastMs: 3000, fastWindowMs: 60000, quietMs: 1500, gapMs: 2000, kickMs: 2000,
    firstMs: 2500, reuseConfirmMs: 3000, getMs: 4000, proxyMs: 6000, settleMs: 8000,
};

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
        global: [ENABLE_KEY, 'coldGuard', 'demo', 'diagRelease', 'diagShownNow', 'diagSceneTex', 'diagMbGap', 'diagMbCover', 'diagMbRebuild',
            'diagRoadLight', 'diagRoadSigns', 'diagRoadScene'],      // road TD: the traffic light, signs and road scene tests (Діагностика: global)
    },
    twin_dial: {
        perProfile: ['hudLayout', 'centre', 'tab', 'tabLock', 'techData', 'navView', 'nightLook', 'bandGain', 'callerName', 'units', 'lang'],
        global: [ENABLE_KEY, 'redline', 'demo', 'diagRelease', 'diagMapWindow', 'diagMapForce', 'diagMapSlots', 'diagSilent', 'diagGpuText',
            'diagR8Mark', 'diagCarplayTurns', 'diagFrontVehicle',
            'diagRoadLight', 'diagRoadSigns', 'diagRoadScene'],      // road TD
    },
    // round fixes-1121 RS (Road Scene: ACC View + Auto Beam): a driver's own taste per profile (how early the beam advice dips,
    // the language); the switch, the cluster test, the demo and the camera-verdict choice (about the car's camera) global
    road_scene: {
        perProfile: ['sens', 'lang'],
        global: [ENABLE_KEY, 'show', 'demoCycle', 'follow'],
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
const secs = (ms) => (ms / 1000).toFixed(1) + ' s';
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

class ProfileSettings {
    /** ctx: the kit's (settings, signals, log, dataDir, spec); opts: { app, perProfile, global, pollMs, fastMs, ... } */
    constructor(ctx, opts) {
        const o = opts || {};
        this.ctx = ctx;
        this.log = ctx.log || { info() {}, warn() {}, error() {} };
        this.settings = ctx.settings;
        this.sig = ctx.signals;
        const cfg = (ctx.spec && ctx.spec.config && ctx.spec.config.profileSettings) || {};
        const num = (k) => (typeof o[k] === 'number' ? o[k] : typeof cfg[k] === 'number' ? cfg[k] : DEFAULTS[k]);
        Object.keys(DEFAULTS).forEach((k) => { this[k] = num(k); });
        this.app = o.app || (ctx.spec && ctx.spec.id) || '';
        const t = TABLE[this.app] || {};
        const schema = (this.settings && this.settings.schema || []).map((s) => s.key);
        this.per = (o.perProfile || t.perProfile || []).filter((k) => schema.indexOf(k) >= 0);
        this.global = (o.global || t.global || []).slice();
        this.unlisted = schema.filter((k) => this.per.indexOf(k) < 0 && this.global.indexOf(k) < 0);
        this.dataDir = ctx.dataDir || '.';
        this.dir = path.join(this.dataDir, 'profiles');
        this.held = SLOTS.indexOf(this.settings.get(SLOT_MARK)) >= 0 ? this.settings.get(SLOT_MARK) : null;   // whose set settings.json holds
        this.active = null;          // the slot the car says is active now (null: not known)
        this.source = null;          // 'start' | 'event' | 'poll' | 'kick ...'
        this.known = false;
        this.t0 = Date.now();
        this.readAt = 0;             // the last read that answered with a slot
        this.readMs = null;          // how long it took
        this.lastErr = null;         // why the last read gave no slot
        this.fails = 0;              // reads in a row that gave no slot
        this.fastUntil = this.t0 + this.fastWindowMs;
        this.ids = {};               // slot -> the id hash read and confirmed this run
        this.idBusy = {};
        this.idUnread = {};          // slot -> the id read failed (logged once per slot until it reads)
        this.unowned = {};           // per-profile keys changed while the set in use was not certainly the car's active profile's
        this.lastOwnSave = 0;
        this.prev = null;            // { to, values, at }: the set in use before the last switch (a confirmed new profile starts from it)
        this.seenAt = 0;             // when the car first said the active slot (a switch's "how long")
        this.firstDone = false;      // the first decision after the start: the profile known (and its set in), or not answering
        this.firstListeners = [];
        this.sm = null; this.smPending = null; this.subscribed = false; this.ua = {};
        this.timer = null; this.pollT = null; this.reading = null; this.lastApply = 0; this.lastKick = 0;
        this.applies = 0;            // how many sets were put in (tests: flapping)
        this.writes = [];            // tests: [{ slot, why }] every profile file written
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
    /** What the menu shows. Slots only. */
    info() {
        return {
            enabled: this.enabled(), slot: this.active, known: this.known, held: this.held, source: this.source,
            readAt: this.readAt || null, readMs: this.readMs, lastErr: this.lastErr, fails: this.fails, firstDone: this.firstDone,
            unowned: Object.keys(this.unowned), per: this.per.slice(), global: this.global.slice(),
        };
    }
    /** shared/hud.js: the theme's first build waits for this (or firstMs). fn is called once, when it is made. */
    onFirst(fn) {
        if (typeof fn !== 'function') return;
        if (this.firstDone) { setImmediate(() => { try { fn(); } catch (e) { this.log.error('profile first: ' + msg(e)); } }); return; }
        this.firstListeners.push(fn);
    }
    firstDecided(what) {
        if (this.firstDone) return;
        this.firstDone = true;
        this.log.info('profile: start decided after ' + secs(Date.now() - this.t0) + ': ' + what);
        const l = this.firstListeners; this.firstListeners = [];
        l.forEach((fn) => { try { fn(); } catch (e) { this.log.error('profile first: ' + msg(e)); } });
    }

    /* ---------------- the files ---------------- */

    fileOf(slot) { return path.join(this.dir, slot + '.json'); }
    parseSet(slot, text) {
        try {
            const j = JSON.parse(text);
            if (!j || typeof j !== 'object' || !j.values || typeof j.values !== 'object' || Array.isArray(j.values)) return null;
            return { slot, id: typeof j.id === 'string' ? j.id : null, values: j.values };
        } catch (e) { return null; }
    }
    /** A slot's saved set: { status: 'none' } (no file), { status: 'ok', set, fromBak } or { status: 'bad', why } (a file
     *  that is there but cannot be read, and no usable backup). A half-written temp file is never read. */
    loadSet(slot) {
        const f = this.fileOf(slot);
        let text = null, why = null;
        try { text = fs.readFileSync(f, 'utf8'); } catch (e) {
            if (e && e.code === 'ENOENT') return { status: 'none' };
            why = 'cannot be read (' + (e && e.code || msg(e)) + ')';
        }
        if (text !== null) {
            const s = this.parseSet(slot, text);
            if (s) return { status: 'ok', set: s, fromBak: false };
            why = 'not a whole set';
        }
        let bak = null;
        try { bak = this.parseSet(slot, fs.readFileSync(f + '.bak', 'utf8')); } catch (e) { bak = null; }
        if (bak) return { status: 'ok', set: bak, fromBak: true, why };
        return { status: 'bad', why };
    }
    /** The saved set or null (none, or not readable). */
    readSet(slot) { const l = this.loadSet(slot); return l.status === 'ok' ? l.set : null; }
    /** Write a slot's set. The file it replaces is kept as <slot>.json.bak when its values differ (one previous version). */
    writeSet(slot, id, values, why) {
        const f = this.fileOf(slot);
        try {
            try { fs.mkdirSync(this.dir); } catch (e) { /* there */ }
            let kept = false, old = null;
            try { old = fs.readFileSync(f, 'utf8'); } catch (e) { old = null; }
            const was = old === null ? null : this.parseSet(slot, old);
            if (was && !same(was.values, values)) { writeAtomic(f + '.bak', old); kept = true; }
            writeAtomic(f, JSON.stringify({ v: FILE_V, slot, id: id || null, values }, null, 1));
            this.writes.push({ slot, why: why || '' });
            this.log.info('profile: wrote ' + slot + '.json (' + (why || 'its set') + '; ' + Object.keys(values).length + ' values' +
                (kept ? '; the previous one kept as ' + slot + '.json.bak' : '') + ')');
            return true;
        } catch (e) { this.log.warn('profile: cannot save the set of ' + slot + ' (' + msg(e) + ')'); return false; }
    }
    /** The id hash a slot's file is keyed by now (this run's confirmed read, else the file's). */
    idOf(slot) { return this.ids[slot] || (this.readSet(slot) || {}).id || null; }
    /** The per-profile values in use now. */
    current() {
        const out = {};
        this.per.forEach((k) => { if (this.settings.get(k) !== undefined) out[k] = this.settings.get(k); });
        return out;
    }
    /** What a slot seen for the first time starts from: the settings from before per-profile settings when they were kept,
     *  else the set in use. -> { values, name } */
    seed() {
        try {
            const j = JSON.parse(fs.readFileSync(path.join(this.dataDir, PRE_FILE), 'utf8'));
            if (j && typeof j === 'object') {
                const v = {};
                this.per.forEach((k) => { if (Object.prototype.hasOwnProperty.call(j, k) && this.valid(k, j[k])) v[k] = j[k]; });
                const cur = this.current();
                this.per.forEach((k) => { if (!(k in v) && k in cur) v[k] = cur[k]; });
                return { values: v, name: 'the settings from before per-profile settings' };
            }
        } catch (e) { /* none kept */ }
        return { values: this.current(), name: this.held ? this.held + '\'s set (the one in use)' : 'the set in use' };
    }

    /** The first start with per-profile settings: settings.json has no "_psSlot". Its text is kept as
     *  settings.pre-profiles.json, written once and never overwritten. */
    keepPreProfiles() {
        try {
            if (this.settings.get(SLOT_MARK) !== undefined) return;
            const src = this.settings.file || path.join(this.dataDir, 'settings.json');
            const dst = path.join(this.dataDir, PRE_FILE);
            if (fs.existsSync(dst)) return;
            let text;
            try { text = fs.readFileSync(src, 'utf8'); } catch (e) { return; }      // a fresh install: nothing to keep
            JSON.parse(text);
            writeAtomic(dst, text);
            this.log.info('profile: the settings from before per-profile settings kept as ' + PRE_FILE + ' (never overwritten; every profile seen for the first time starts from them)');
        } catch (e) { this.log.warn('profile: cannot keep the settings from before per-profile settings (' + msg(e) + ')'); }
    }

    /* ---------------- start ---------------- */

    start() {
        if (this.unlisted.length) this.log.info('profile: settings in neither list stay global: ' + this.unlisted.join(', '));
        this.keepPreProfiles();
        this.log.info('profile: per-profile settings ' + (this.enabled() ? 'on' : 'off') + ', ' + this.per.length + ' per profile, ' +
            (this.settings.schema.length - this.per.length) + ' global; the set in use is ' + (this.held || 'not yet any profile\'s'));
        this.settings.onChange((key, value) => this.guard('setting ' + key, () => this.onSetting(key, value)));
        this.guard('start', () => this.read('start'));
        this.loop();
        // the first build waits at most firstMs for the first answer (shared/hud.js _profileHold)
        this.firstT = setTimeout(() => this.guard('first', () => this.firstDecided('no answer in ' + secs(this.firstMs) + ', the set in use stays' + (this.held ? ' (' + this.held + '\'s)' : ''))), this.firstMs);
        if (this.firstT.unref) this.firstT.unref();
        return this;
    }
    stop() { this.stopped = true; clearTimeout(this.pollT); clearTimeout(this.timer); clearTimeout(this.firstT); }

    /** The next read: fast in the minute after the start or a wake-up, slow after; sooner while the field does not answer. */
    nextDelay() {
        const base = Date.now() < this.fastUntil ? Math.min(this.fastMs, this.pollMs) : this.pollMs;
        if (!this.fails) return base;
        return Math.min(base, 1000 * Math.pow(2, Math.min(this.fails, 6) - 1));
    }
    loop() {
        if (this.stopped) return;
        clearTimeout(this.pollT);
        this.pollT = setTimeout(() => {
            this.pollT = null;
            Promise.resolve(this.guard('poll', () => this.read('poll'))).catch(() => null).then(() => this.loop());
        }, this.nextDelay());
        if (this.pollT.unref) this.pollT.unref();
    }

    /** A wake-up the app already sees (the engine, the vehicle condition, the menu opened): read the field again, poll fast. */
    kick(why) {
        const now = Date.now();
        this.fastUntil = Math.max(this.fastUntil, now + this.fastWindowMs);
        if (now - this.lastKick < this.kickMs) return;
        this.lastKick = now;
        this.guard('kick', () => this.read('kick ' + (why || '')));
        this.loop();             // the next poll at the fast pace
    }

    /** SessionManager's proxy, made once; a late one is still taken. Never throws (null: not reachable now). */
    async smProxy() {
        if (this.sm) return this.sm;
        if (!this.sig || typeof this.sig.proxy !== 'function') { this.firstDecided('no SOME/IP here, the set in use stays'); return null; }
        if (!this.smPending) {
            this.smPending = Promise.resolve().then(() => this.sig.proxy(SM, SM));
            this.smPending.then((p) => { if (p) this.sm = p; this.subscribe(); }, () => { this.smPending = null; });
        }
        try { this.sm = await withTimeout(this.smPending, this.proxyMs, 'SessionManager proxy'); } catch (e) {
            this.lastErr = msg(e);
            // refused outright (no interface config, no SOME/IP here): nothing will answer soon, the first build need not wait
            if (!/no answer in/.test(this.lastErr)) this.firstDecided('SessionManager not reachable (' + this.lastErr + '), the set in use stays' + (this.held ? ' (' + this.held + '\'s)' : ''));
            return null;
        }
        this.subscribe();
        return this.sm;
    }
    /** currentUserOnChange: a hint (it may never come). It is taken, the field is read again, the fast poll starts. */
    subscribe() {
        if (this.subscribed || !this.sm || !this.sig || typeof this.sig.on !== 'function') return;
        this.subscribed = true;
        Promise.resolve().then(() => this.sig.on(this.sm, 'currentUserOnChange', (v) => this.guard('event', () => {
            const s = slotOf(v);
            if (s) this.note(s, 'event');
            else if (!this.eventOdd) { this.eventOdd = true; this.log.info('profile: currentUserOnChange carried no profile reference (' + typeof v + '): the field is read instead'); }
            this.fastUntil = Math.max(this.fastUntil, Date.now() + this.fastWindowMs);
            const t = setTimeout(() => this.guard('event check', () => this.read('event check')), this.quietMs);
            if (t.unref) t.unref();
            this.loop();
        }), this.log)).catch((e) => this.log.warn('profile: subscribe currentUserOnChange: ' + msg(e) + ' (the poll stands in)'));
    }

    /** Read currentUserAccountReference (one getter). Never throws. */
    read(how) {
        if (this.stopped) return Promise.resolve(null);
        if (this.reading) return this.reading;
        this.reading = (async () => {
            const t = Date.now();
            const sm = await this.smProxy();
            if (!sm) { this.note(null, how, 'SessionManager not reachable' + (this.lastErr ? ' (' + this.lastErr + ')' : '')); return null; }
            try {
                const ref = await withTimeout(this.sig.get(sm, 'currentUserAccountReference', this.getMs), this.getMs + 500, 'currentUserAccountReference');
                const s = slotOf(ref);
                this.readMs = Date.now() - t;
                this.note(s, how, s ? null : 'not a profile reference');
                return s;
            } catch (e) { this.note(null, how, msg(e)); return null; }
        })().catch((e) => { this.log.error('profile read: ' + msg(e)); return null; }).then((v) => { this.reading = null; return v; });
        return this.reading;
    }

    /** What the car said: a slot, or null (not known: the set in use stays). */
    note(slot, how, why) {
        if (!slot) {
            this.fails++;
            this.lastErr = why || 'no answer';
            if (this.known || this.source === null || this.fails === 1) this.log.info('profile: not known (' + how + (why ? ': ' + why : '') + '); the set in use stays' + (this.held ? ' (' + this.held + '\'s)' : '') + '; asked again in ' + secs(this.nextDelay()));
            const was = this.known;
            this.known = false; this.source = how; this.confirmedFor = null;
            if (was) { clearTimeout(this.timer); this.timer = null; }
            this.changed('unknown');
            if (Date.now() - this.t0 >= this.firstMs) this.firstDecided('the profile is not known (' + (why || 'no answer') + '), the set in use stays' + (this.held ? ' (' + this.held + '\'s)' : ''));
            if (this.pollT) this.loop();         // asked again sooner (1, 2, 4 ... s)
            return;
        }
        const was = this.active, wasKnown = this.known;
        this.fails = 0; this.lastErr = null; this.readAt = Date.now();
        this.active = slot; this.known = true; this.source = how;
        if (slot !== was || !wasKnown) {
            if (slot !== was) this.seenAt = Date.now();
            this.log.info('profile: ' + slot + ' (' + how + ')' + (this.readMs !== null && how !== 'event' ? ' answered in ' + this.readMs + ' ms' : '') +
                (was && was !== slot ? ', was ' + was : '') + (this.held && this.held !== slot ? '; the set in use is ' + this.held + '\'s' : ''));
            this.changed('slot');
        }
        if (!this.enabled()) { this.firstDecided('per-profile settings are off: one set'); return; }
        if (slot === this.held) {
            // the car says the profile whose set is in use: nothing to switch (a pending switch from a flap is dropped)
            if (this.timer) { clearTimeout(this.timer); this.timer = null; this.log.info('profile: back to ' + slot + ' before the switch: no switch'); }
            if (this.confirmedFor !== slot || Object.keys(this.unowned).length) this.confirmHeld(how);
            this.firstDecided(slot + ', its own set is in use');
            return;
        }
        if (!this.firstDone) { clearTimeout(this.timer); this.timer = null; this.guard('apply', () => this.apply('first')); return; }
        if (slot !== was || !wasKnown || !this.timer) this.schedule();
    }

    /** The car has said the held slot for settleMs: nothing will switch it now. */
    settled() { return this.known && !!this.active && this.active === this.held && Date.now() - (this.seenAt || 0) >= this.settleMs; }
    /** The car confirms the held slot: changes made before it was known are its own once it has said so for settleMs; its id is
     *  checked once. */
    confirmHeld(how) {
        const slot = this.held;
        const keys = Object.keys(this.unowned);
        if (keys.length && !this.settled()) return;          // asked again at the next read
        this.confirmedFor = slot;
        if (keys.length) {
            this.unowned = {};
            this.writeSet(slot, this.idOf(slot), this.current(), 'confirmed ' + slot + ' (' + how + '): ' + keys.length + ' change' + (keys.length === 1 ? '' : 's') + ' made before it was known (' + keys.join(', ') + ')');
            this.lastOwnSave = Date.now();
        } else if (this.loadSet(slot).status === 'none') {
            this.writeSet(slot, this.idOf(slot), this.current(), slot + '\'s set had no file');
        }
        if (this.ids[slot] === undefined) this.guard('id', () => this.checkId(slot));
    }

    /* ---------------- switching ---------------- */

    schedule() {
        if (!this.enabled()) return;
        clearTimeout(this.timer);
        const wait = Math.max(this.quietMs, this.gapMs - (Date.now() - this.lastApply));
        this.timer = setTimeout(() => { this.timer = null; this.guard('apply', () => this.apply('debounced')); }, wait);
        if (this.timer.unref) this.timer.unref();
    }

    /** Put the active slot's set in. The slot's file is read, never waited on the car for: the id is checked afterwards. */
    apply(why) {
        if (this.stopped || !this.enabled() || !this.known || !this.active) return;
        const slot = this.active;
        if (slot === this.held) { this.confirmHeld(why); this.firstDecided(slot + ', its own set is in use'); return; }
        const from = this.held, cur = this.current();
        const ld = this.loadSet(slot);
        let values, what;
        if (ld.status === 'ok') {
            values = ld.set.values;
            what = 'its own set';
            if (ld.fromBak) {
                what += ' (from ' + slot + '.json.bak: the file ' + ld.why + ')';
                this.keepBad(slot);
                this.writeSet(slot, ld.set.id, values, 'restored from its backup');
            }
        } else {
            const sd = this.seed();
            values = sd.values;
            if (ld.status === 'bad') {
                this.keepBad(slot);
                what = 'its file ' + ld.why + ' and has no backup: kept as ' + slot + '.json.bad; a copy of ' + sd.name;
            } else what = 'seen for the first time: a copy of ' + sd.name;
            this.writeSet(slot, null, values, 'first set of ' + slot + ': a copy of ' + sd.name);
        }
        const dropped = Object.keys(this.unowned);
        if (dropped.length) {
            this.log.info('profile: ' + dropped.length + ' change' + (dropped.length === 1 ? '' : 's') + ' made while the car said ' + slot + ' but ' + (from || 'no profile') + '\'s set was in use (' + dropped.join(', ') + '): saved to nobody\'s set');
            this.unowned = {};
        }
        if (from && this.loadSet(from).status === 'none') this.writeSet(from, this.idOf(from), cur, from + '\'s set had no file');
        const next = {};
        this.per.forEach((k) => { if (Object.prototype.hasOwnProperty.call(values, k) && this.valid(k, values[k])) next[k] = values[k]; });
        this.prev = { to: slot, values: cur, at: Date.now() };
        this.held = slot;
        this.confirmedFor = slot;
        this.settings.values[SLOT_MARK] = slot;
        this.lastApply = Date.now();
        this.applies++;
        const keys = this.settings.setMany(next, 'profile ' + slot);
        this.log.info('profile: switch ' + (from || '?') + ' -> ' + slot + ' (' + this.source + (why === 'first' ? ', the first read' : '') + ', ' + secs(Date.now() - (this.seenAt || Date.now())) + ' after the car said it), ' + what + ', ' +
            keys.length + ' setting' + (keys.length === 1 ? '' : 's') + ' changed' + (keys.length ? ' (' + keys.join(', ') + ')' : ''));
        this.changed('applied');
        this.firstDecided(slot + ', its set put in');
        this.guard('id', () => this.checkId(slot));
    }
    /** A file that could not be read is kept aside (one .bad per slot), never written over. */
    keepBad(slot) {
        const f = this.fileOf(slot);
        try { if (fs.existsSync(f)) { fs.renameSync(f, f + '.bad'); this.log.warn('profile: ' + slot + '.json could not be read: kept as ' + slot + '.json.bad'); } } catch (e) { this.log.warn('profile: cannot keep ' + slot + '.json aside (' + msg(e) + ')'); }
    }

    /** One read of a slot's persod id, as a hash; null when it cannot be read (never a new profile). */
    async readId(slot) {
        try {
            if (!this.ua[slot]) this.ua[slot] = await withTimeout(this.sig.proxy(UA, refOf(slot)), this.proxyMs, slot + ' proxy');
            const id = await withTimeout(this.sig.get(this.ua[slot], 'id', this.getMs), this.getMs + 500, slot + '.id');
            const h = idHash(typeof id === 'string' ? id : null);
            if (!h) throw new Error(typeof id === 'string' ? 'empty' : 'not text (' + typeof id + ')');
            if (this.idUnread[slot]) { this.idUnread[slot] = false; this.log.info('profile: ' + slot + '\'s id reads again'); }
            return h;
        } catch (e) {
            if (!this.idUnread[slot]) { this.idUnread[slot] = true; this.log.info('profile: ' + slot + '\'s id not readable (' + msg(e) + '): not taken as a new profile, its set stays'); }
            return null;
        }
    }
    /** After a switch (or the held slot confirmed): key the slot's file by its id. An id that reads differently from the one
     *  the file has must read so twice in a row (reuseConfirmMs apart) before the slot counts as holding a new profile. */
    async checkId(slot) {
        if (this.idBusy[slot] || this.stopped) return;
        this.idBusy[slot] = true;
        try {
            const h = await this.readId(slot);
            if (!h) return;
            const set = this.readSet(slot);
            if (!set) return;
            if (!set.id) { this.ids[slot] = h; this.writeSet(slot, h, set.values, slot + '\'s id read: the set keyed by it'); return; }
            if (set.id === h) { this.ids[slot] = h; return; }
            this.log.info('profile: ' + slot + '\'s id reads differently from its set\'s: read again in ' + secs(this.reuseConfirmMs) + ' before anything is done');
            await new Promise((r) => { const t = setTimeout(r, this.reuseConfirmMs); if (t.unref) t.unref(); });
            const h2 = await this.readId(slot);
            if (h2 !== h) { this.log.info('profile: ' + slot + '\'s id read ' + (h2 ? 'a third value' : 'nothing') + ' the second time: not taken as a new profile, its set stays'); return; }
            if (h2 === (this.readSet(slot) || {}).id) return;
            this.reused(slot, h);
        } finally { this.idBusy[slot] = false; }
    }
    /** A new profile in the slot (its id read differently twice in a row): it starts over; the old set stays as .bak. */
    reused(slot, h) {
        this.ids[slot] = h;
        const set = this.readSet(slot);
        const ownSince = this.lastOwnSave > this.lastApply;
        if (slot !== this.held || slot !== this.active || !this.known || ownSince || !this.enabled()) {
            // not on the screen now, or the driver has already made it their own: only the key changes
            if (set) this.writeSet(slot, h, set.values, 'a new profile in ' + slot + ' (its id changed, read twice): keyed by it, the set kept');
            return;
        }
        const values = this.prev && this.prev.to === slot ? this.prev.values : this.seed().values;
        this.writeSet(slot, h, values, 'a new profile in ' + slot + ' (its id changed, read twice): it starts over from the set in use before the switch');
        const next = {};
        this.per.forEach((k) => { if (Object.prototype.hasOwnProperty.call(values, k) && this.valid(k, values[k])) next[k] = values[k]; });
        this.applies++;
        const keys = this.settings.setMany(next, 'profile ' + slot + ' (new)');
        this.log.info('profile: ' + slot + ' holds a new profile now: its set starts over, ' + keys.length + ' setting' + (keys.length === 1 ? '' : 's') + ' changed; the old set is ' + slot + '.json.bak');
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

    /** A setting changed by the driver: a per-profile one goes to the file of the profile whose set is in use - only while the
     *  car says that profile is the active one. Otherwise it stays on the screen and waits (confirmHeld / apply). */
    onSetting(key) {
        if (this.settings.batch) return;            // our own switch
        if (key === ENABLE_KEY) {
            if (this.enabled()) {
                // on again: the set in use becomes the active profile's (nothing on the screen changes now)
                if (this.known && this.active) {
                    this.held = this.active;
                    this.unowned = {};
                    this.settings.values[SLOT_MARK] = this.active;
                    this.settings.save();
                    this.writeSet(this.active, this.idOf(this.active), this.current(), 'per-profile settings on again: the set in use becomes ' + this.active + '\'s');
                    this.lastOwnSave = Date.now();
                }
                this.log.info('profile: per-profile settings on' + (this.held ? ' (the set in use is ' + this.held + '\'s)' : ''));
                if (this.known && this.active && this.active !== this.held) this.schedule();
            } else this.log.info('profile: per-profile settings off: one set for every profile');
            this.changed('enabled');
            return;
        }
        if (!this.enabled() || !this.isPer(key)) return;
        if (this.known && this.active && (this.held === this.active || !this.held) && Date.now() - (this.seenAt || 0) >= this.settleMs) {
            if (!this.held) { this.held = this.active; this.settings.values[SLOT_MARK] = this.active; this.settings.save(); }
            this.writeSet(this.held, this.idOf(this.held), this.current(), key + ' changed by ' + this.held);
            this.lastOwnSave = Date.now();
            return;
        }
        if (!this.unowned[key]) {
            const st = !this.known ? 'the profile is not known' : this.active !== this.held ? 'the car says ' + this.active + ' but ' + (this.held || 'no profile') + '\'s set is in use (the switch is pending)'
                : 'the car has said ' + this.active + ' for ' + secs(Date.now() - this.seenAt) + ' only (it may still change)';
            this.log.info('profile: ' + key + ' changed while ' + st +
                ': kept on the screen, saved to ' + (this.held ? this.held + '\'s set only if the car confirms ' + this.held : 'a profile\'s set once one is known'));
        }
        this.unowned[key] = true;
        this.changed('unowned');
    }
}

let current = null;
/** Wire an app (the kit's ctx) once, BEFORE its engine is made (so the first read goes out first and the first build can wait
 *  for it). Returns the instance (or null). Never throws. */
function attach(ctx, opts) {
    if (current) return current;
    try {
        current = new ProfileSettings(ctx, opts);
        module.exports.current = current;
        current.start();
        const prev = ctx.wake;
        ctx.wake = (why) => { try { if (typeof prev === 'function') prev(why); } catch (e) { /* its own */ } current.kick(why); };
    } catch (e) { (ctx && ctx.log || console).error('profile settings: ' + msg(e)); current = null; module.exports.current = null; }
    return current;
}
/** Tests: forget the instance. */
function _reset() { if (current) current.stop(); current = null; module.exports.current = null; }

module.exports = { attach, ProfileSettings, TABLE, SLOTS, ENABLE_KEY, SLOT_MARK, PRE_FILE, slotOf, refOf, idHash, writeAtomic, current: null, _reset, DEFAULTS };
