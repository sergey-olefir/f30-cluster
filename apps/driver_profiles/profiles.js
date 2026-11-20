'use strict';
/**
 * profiles.js - the car's driver profiles over SOME/IP: persod's UserAccountManager (0xFC02), UserAccount (0xFC03, one
 * instance per slot), UserAccountIntra (0xFC05, when Guest's data was copied), SessionManager (0xFC01, the active
 * profile), and for the checks before a write: DriverSelectionModule (active PIA profile), CDS (engine speed),
 * VehicleInformation (gear) and Pia (a PIA job running).
 *
 * The only calls that change anything, each re-checked right before it is sent (check()):
 *   UserAccountManager.createUserAccount(name)          method 21845
 *   UserAccount.<slot>.name = new name                  setter 5 (the call the owner's names were set with, 2026-11-14)
 *   UserAccount.<slot>.avatar = Base64 jpg              setter 8  (0.2.0; catalogue: field avatar, Utf8D, get 7 set 8)
 *   UserAccount.<slot>.avatarType = the enum            setter 29 (0.2.0; catalogue: get 28 set 29, INDIVIDUAL = 16)
 *   UserAccountManager.copyGuestData(ref)               method 21851
 *   UserAccountManager.removeUserAccount(ref)           method 21846
 * Nothing else is ever called: no UDS, no delete-all, no PIA reset, no login. The app.json manifest grants only these
 * (the installer's ACL then lets nothing else through). An avatar change writes those two fields and nothing else:
 * no name, no type, no protection.
 *
 * Names and e-mail addresses never go to the log: slots, result codes and errors only. The avatar picture is never
 * logged, shown or kept: a read turns it into a size and drops it, and a write holds it only until the setter has it.
 * Plain Node 8 (the car's 8.16.2). Every callback is guarded: an exception that escaped would end the app.
 */
const fs = require('fs');
const path = require('path');
const F = require('./format');
const A = require('./avatars');
const I = require('./lang');          // r1120 LN: the words on the screen from shared/i18n/<lang>.json; the log stays English

const PERS = F.PERS;
const IF = {
    uam: PERS + 'UserAccountManager', ua: PERS + 'UserAccount', intra: PERS + 'UserAccountIntra', sm: PERS + 'SessionManager',
    dsm: 'de.bmw.infrastructure.DriverSelectionModule', cds: 'de.bmw.infotainment.vehicle.CDS',
    vi: 'de.bmw.infrastructure.VehicleInformation', pia: 'de.bmw.infrastructure.Pia', vehicle: 'de.bmw.infotainment.vehicle.Vehicle',
};
// the fields read per slot (app.json "signals" grants exactly these getters)
const FIELDS = ['id', 'type', 'name', 'gcid', 'protection', 'firstName', 'creationDate', 'lastLoginDate',
    'synchronizationEnabled', 'connectedDriveUsername', 'emailAddress', 'avatarType'];
const AVAIL_WAIT_MS = 2500;      // how long a slot's instance may take to say it is offered
const GET_MS = 4000;
// the avatar is a whole jpg in Base64, so its getter and setter get longer than a name's
const CALL_MS = { createUserAccount: 30000, removeUserAccount: 60000, copyGuestData: 150000, name: 8000, avatar: 20000, avatarType: 8000 };
const MAX_USERS = 7;             // i01..i07: the hard ceiling (the provisioned limit can be lower: MAX_NUM_EXCEEDED)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(p, ms, what) {
    let t;
    return Promise.race([Promise.resolve(p), new Promise((res, rej) => { t = setTimeout(() => rej(new Error(what + ': no answer in ' + ms + ' ms')), ms); })])
        .then((v) => { clearTimeout(t); return v; }, (e) => { clearTimeout(t); throw e; });
}
const msg = (e) => String(e && e.message ? e.message : e).slice(0, 160);

class Profiles {
    /** ctx: the kit's ctx (signals, log, dataDir, spec.config) */
    constructor(ctx) {
        this.ctx = ctx; this.sig = ctx.signals; this.log = ctx.log;
        const cfg = (ctx.spec && ctx.spec.config) || {};
        this.requireParked = cfg.requireParked !== false;
        this.cfg = cfg;
        this.avatarMaxKB = A.maxKB(cfg);        // our guess at what persod takes, not a figure from the car
        this.dataDir = ctx.dataDir || '.';
        this.slots = {};                 // slot -> state (see readSlot)
        this.ua = {}; this.intra = {}; this.avail = {};
        this.um = null; this.sm = null;
        this.current = null;             // active slot ('guest', 'i01', ...) or null while not known
        this.currentErr = null;
        this.car = { rpmRaw: null, gear: null, piaTx: null, pia: null, keys: null, units: null };
        this.errors = {};                // service -> why it is not reachable
        this.busy = null;                // the write in progress ('create', ...)
        this.listeners = [];
        this.reading = null;
        this.started = false;
        this.calls = [];                 // every write sent: { op, slot, result } (no names)
        this.piaFile = path.join(ctx.dataDir || '.', 'pia-seen.json');
        this.piaSeen = {};
        try { this.piaSeen = JSON.parse(fs.readFileSync(this.piaFile, 'utf8')) || {}; } catch (e) { /* none yet */ }
        F.SLOTS.forEach((s) => { this.slots[s] = { slot: s, exists: false, read: false }; });
    }

    onChange(fn) { this.listeners.push(fn); }
    changed(why) { this.listeners.forEach((fn) => { try { fn(why); } catch (e) { this.log.error('profiles listener: ' + (e && e.stack || e)); } }); }
    guard(what, fn) {
        try { const r = fn(); if (r && r.catch) r.catch((e) => this.log.error('profiles ' + what + ': ' + msg(e))); return r; } catch (e) { this.log.error('profiles ' + what + ': ' + msg(e)); return undefined; }
    }

    /* ---------------- start: proxies and subscriptions ---------------- */

    async proxy(iface, inst) {
        try { return await this.sig.proxy(iface, inst); } catch (e) {
            this.errors[iface] = msg(e);
            this.log.warn('proxy ' + iface.split('.').pop() + ' ' + String(inst).split('.').pop() + ': ' + msg(e));
            return null;
        }
    }

    async start() {
        const sig = this.sig;
        this.um = await this.proxy(IF.uam, IF.uam);
        this.sm = await this.proxy(IF.sm, IF.sm);
        if (this.sm) {
            await sig.on(this.sm, 'currentUserOnChange', (v) => this.guard('user change', () => {
                const ref = v && typeof v === 'object' ? v.currentUserAccountReference : v;
                this.setCurrent(F.slotOf(ref), 'event');
                this.refresh('active profile changed');
            })).catch((e) => this.log.warn('subscribe currentUserOnChange: ' + msg(e)));
        }
        for (const s of F.SLOTS) {
            const p = await this.proxy(IF.ua, F.refOf(s));
            this.ua[s] = p;
            if (!p) continue;
            await sig.onAvailable(p, (a) => this.guard('available ' + s, () => {
                if (this.avail[s] === a) return;
                this.avail[s] = a;
                this.log.info('slot ' + s + (a ? ' offered' : ' not offered'));
                if (!this.reading) this.readOne(s).then(() => this.changed('slot ' + s));
            })).catch((e) => this.log.warn('availability ' + s + ': ' + msg(e)));
            for (const f of ['name', 'protection', 'gcid']) {
                await sig.on(p, f, () => this.guard('notify ' + s + '.' + f, () => this.soon(s))).catch((e) => this.log.warn('subscribe ' + s + '.' + f + ': ' + msg(e)));
            }
            this.intra[s] = await this.proxy(IF.intra, F.intraOf(s));
        }
        // the car's state for the checks and the settings view (watch() never throws: a missing one is logged)
        const w = (iface, handlers) => sig.watch(iface, '1', handlers, this.log).then((r) => { if (r && r.error) this.errors[iface] = r.error; return r; });
        await w(IF.dsm, {
            piaProfileId: (v) => this.guard('pia', () => { this.car.pia = typeof v === 'number' ? v : null; this.notePia(); this.changed('pia'); }),
            BdcIdentityMappingTable: (v) => this.guard('keys', () => { this.car.keys = Array.isArray(v) ? v : null; this.changed('keys'); }),
        });
        await w(IF.cds, { statusEngineSpeed2: (v) => this.guard('rpm', () => { this.car.rpmRaw = v && typeof v === 'object' ? v.actualValueRPMEngineCrankshaft : null; }) });
        await w(IF.vi, { DataPowerTrain2: (v) => this.guard('gear', () => { this.car.gear = v && typeof v === 'object' ? F.en(v.statusGearSelectionDrive, F.ENUM.gear) : null; }) });
        await w(IF.pia, { PIATransaction: (v) => this.guard('pia tx', () => { this.car.piaTx = v && typeof v === 'object' ? F.en(v.pIAStatusTransaction, F.ENUM.piaTx) : null; }) });
        await w(IF.vehicle, { statusNewCurrentUnitsStatusExt: (v) => this.guard('units', () => { this.car.units = v && typeof v === 'object' ? v : null; this.changed('units'); }) });
        this.started = true;
        await this.refresh('start');
    }

    soon(slot) {
        if (this.soonTimer) { this.soonSlots[slot] = true; return; }
        this.soonSlots = {}; this.soonSlots[slot] = true;
        this.soonTimer = setTimeout(() => this.guard('re-read', () => {
            const list = Object.keys(this.soonSlots); this.soonTimer = null;
            return Promise.all(list.map((s) => this.readOne(s))).then(() => this.changed('notified'));
        }), 300);
    }

    setCurrent(slot, how) {
        if (slot !== this.current) this.log.info('active profile: ' + (slot || 'not known') + ' (' + how + ')');
        this.current = slot;
        this.notePia();
    }
    /** Remember which PIA number the active profile uses (keyed by persod's own id, so a reused slot starts over). */
    notePia() {
        const st = this.current && this.slots[this.current];
        if (!st || !st.id || typeof this.car.pia !== 'number') return;
        if (this.piaSeen[st.id] === this.car.pia) return;
        this.piaSeen[st.id] = this.car.pia;
        try { fs.writeFileSync(this.piaFile, JSON.stringify(this.piaSeen)); } catch (e) { this.log.warn('pia-seen: ' + msg(e)); }
    }

    /* ---------------- reading ---------------- */

    async readCurrent() {
        if (!this.sm) { this.currentErr = this.errors[IF.sm] || 'SessionManager not reachable'; return this.current; }
        try {
            const ref = await withTimeout(this.sig.get(this.sm, 'currentUserAccountReference', GET_MS), GET_MS + 500, 'currentUserAccountReference');
            this.currentErr = null;
            this.setCurrent(F.slotOf(ref), 'read');
        } catch (e) { this.currentErr = msg(e); this.setCurrent(null, 'read failed'); }
        return this.current;
    }

    /**
     * Whether a slot's instance is offered. The first time, wait a little for it to say so; after that, what the
     * availability callback last said (a free slot then costs nothing per read). A slot that never answered counts
     * as not offered until its callback says otherwise.
     */
    async offered(slot) {
        const p = this.ua[slot];
        if (!p) return false;
        if (p.isAvailable && p.isAvailable()) return true;
        if (this.avail[slot] !== undefined) return !!this.avail[slot];
        const end = Date.now() + AVAIL_WAIT_MS;
        while (Date.now() < end) {
            if (this.avail[slot] || (p.isAvailable && p.isAvailable())) return true;
            await sleep(100);
        }
        if (this.avail[slot] === undefined) this.avail[slot] = false;
        return !!this.avail[slot];
    }

    /**
     * How large the stored custom picture is, for the avatar row. Only for avatarType INDIVIDUAL: the field holds a
     * whole jpg in Base64, and there is no reason to pull that over the binding for every slot on every read.
     * The string lives in this function and nowhere else: what is kept is its decoded size and a checksum.
     */
    async readAvatarSize(slot, st) {
        st.avatarBytes = null; st.avatarChars = null; st.avatarSum = null; st.avatarErr = null;
        if (A.typeName(st.avatarType) !== 'INDIVIDUAL') { st.avatarBytes = 0; return; }
        try {
            const v = await withTimeout(this.sig.get(this.ua[slot], 'avatar', CALL_MS.avatar), CALL_MS.avatar + 500, 'avatar');
            if (typeof v !== 'string') { st.avatarErr = 'the service did not answer with text'; return; }
            st.avatarChars = v.length;
            st.avatarBytes = A.b64Bytes(v);
            st.avatarSum = A.sum(v);
        } catch (e) { st.avatarErr = msg(e); }
    }

    /** Read every field of one slot. A slot exists when its instance is offered and has an id. */
    async readOne(slot) {
        const p = this.ua[slot];
        const st = { slot, ref: F.refOf(slot), exists: false, read: true, at: Date.now() };
        if (!p) { st.error = this.errors[IF.ua] || 'UserAccount not reachable'; this.slots[slot] = st; return st; }
        if (!(await this.offered(slot))) { this.slots[slot] = st; return st; }
        for (const f of FIELDS) {
            try { st[f] = await withTimeout(this.sig.get(p, f, GET_MS), GET_MS + 500, f); } catch (e) {
                st[f] = null;
                if (f === 'gcid') st.gcidKnown = false;
                if (f === 'id' || f === 'type') st.error = f + ': ' + msg(e);
            }
        }
        st.type = F.en(st.type, F.ENUM.type);
        st.exists = typeof st.id === 'string' ? st.id !== '' : st.type !== null;
        if (st.exists) await this.readAvatarSize(slot, st);
        if (st.exists && st.type !== 'GUEST' && st.type !== 'VALET' && this.intra[slot]) {
            try {
                const r = await withTimeout(this.sig.call(this.intra[slot], 'getCopyGuestTimestamp', {}, GET_MS), GET_MS + 500, 'getCopyGuestTimestamp');
                st.copyTs = typeof F.resultOf(r, 'timestamp') === 'number' ? F.resultOf(r, 'timestamp') : null;
            } catch (e) { st.copyTs = null; st.copyErr = msg(e); }
        } else if (!this.intra[slot]) st.copyErr = this.errors[IF.intra] || 'not reachable';
        this.slots[slot] = st;
        return st;
    }

    /** Read everything again (one run at a time; a call meanwhile waits for the running one). */
    refresh(why) {
        if (!this.started) return Promise.resolve();       // start() reads everything once its proxies are up
        if (this.reading) return this.reading;
        this.reading = (async () => {
            await this.readCurrent();
            // side by side: a free slot's first wait for its instance must not hold up the others (the reads
            // themselves still go to the binding one at a time: signals.js nativeTick)
            await Promise.all(F.SLOTS.map((s) => this.readOne(s)));
            this.notePia();
            this.log.info('profiles read (' + why + '): ' + F.SLOTS.filter((s) => this.slots[s].exists).join(' ') + '; active ' + (this.current || '?'));
        })().catch((e) => this.log.error('refresh: ' + msg(e))).then(() => { this.reading = null; this.changed('refresh'); });
        return this.reading;
    }

    /** The owner's own pictures, from <dataDir>/avatars/ only (see avatars.js). Never throws. */
    avatarFiles() { return A.list(this.dataDir, this.cfg); }

    list() { return F.SLOTS.map((s) => this.slots[s]); }
    users() { return F.USER_SLOTS.filter((s) => this.slots[s].exists); }
    freeSlot() { return F.USER_SLOTS.find((s) => !this.slots[s].exists) || null; }
    names() { return F.SLOTS.map((s) => this.slots[s]).filter((s) => s.exists && s.name).map((s) => s.name); }
    /** The PIA profile number of a slot: Guest's is fixed (10); the others as seen while they were active. */
    piaOf(st) {
        if (!st || !st.exists) return { n: null, how: '' };
        if (st.type === 'GUEST') return { n: 10, how: I.t('dp.type.GUEST') };
        if (st.slot === this.current && typeof this.car.pia === 'number') return { n: this.car.pia, how: I.t('dp.pia.now') };
        if (st.id && typeof this.piaSeen[st.id] === 'number') return { n: this.piaSeen[st.id], how: I.t('dp.pia.seen') };
        return { n: null, how: I.t('dp.pia.unknown') };
    }

    /* ---------------- checks (run again right before every write) ---------------- */

    /** The car parked: engine off, P, no PIA job running. [] when fine, else why not.
     *  parkedKeys: what keeps a write from running now, as table keys (dp.park.*). */
    parkedKeys() {
        if (!this.requireParked) return [];
        const out = [], c = this.car;
        if (c.rpmRaw === null || c.rpmRaw === undefined || c.rpmRaw === 65535) out.push('dp.park.engineUnknown');
        else if (c.rpmRaw !== 0) out.push('dp.park.engineOn');
        if (!c.gear) out.push('dp.park.gearUnknown');
        else if (c.gear !== 'P') out.push('dp.park.notP');
        if (c.piaTx === 'BEGINTRANSACTION') out.push('dp.park.pia');
        return out;
    }
    parkedProblems() { return this.parkedKeys().map((k) => I.t(k)); }

    /**
     * Whether op may run now: { ok, why: [..] }. op: 'create' | 'rename' | 'copy' | 'delete'. For rename / copy /
     * delete, snap is what the confirm screen showed ({ id, name }): the slot must still hold that profile.
     */
    check(op, slot, arg, snap, sending) {
        const why = [], whyEn = [], whyKeys = [];
        // each reason: on the screen in the app's language, in the log in English, and its key (screens.js tests one)
        const add = (key, vars) => { why.push(I.t(key, vars)); whyEn.push(I.tl('en', key, vars)); whyKeys.push(key); };
        if (this.busy && !sending) add('dp.why.busy', { op: this.busy });
        if (!this.um) add(this.errors[IF.uam] ? 'dp.why.noServiceErr' : 'dp.why.noService', { err: this.errors[IF.uam] });
        const st = slot ? this.slots[slot] : null;
        if (op === 'create') {
            const name = String(arg || '').trim();
            if (!name) add('dp.why.noName');
            if (this.names().map((n) => n.toLowerCase()).indexOf(name.toLowerCase()) >= 0) add('dp.why.nameTaken');
            if (!this.freeSlot()) add('dp.why.noSlot', { used: this.users().length, max: MAX_USERS });
        } else {
            if (!st || !st.exists) add('dp.why.gone');
            else {
                if (snap && (st.id !== snap.id || st.name !== snap.name)) add('dp.why.changed');
                if (op === 'rename') {
                    if (st.type !== 'USER') add('dp.why.renamePersonal');
                    else if (!F.isLocal(st)) add('dp.why.renameBmwId');
                    const name = String(arg || '').trim();
                    if (!name) add('dp.why.noName');
                    else if (name === st.name) add('dp.why.sameName');
                    else if (this.names().map((n) => n.toLowerCase()).indexOf(name.toLowerCase()) >= 0) add('dp.why.nameTaken');
                }
                if (op === 'copy') {
                    if (st.type !== 'USER') add('dp.why.copyPersonal');
                    if (this.current !== 'guest') add(this.current ? 'dp.why.guestNotActive' : 'dp.why.activeUnknown');
                    const prot = F.protectionList(st.protection);
                    if (prot === null) add('dp.why.protUnknown');
                    else if (prot.length) add('dp.why.protected', { prot: F.protectionText(st.protection) });
                }
                if (op === 'avatar') {
                    // the avatar is cosmetic and belongs to every kind of profile, so no type or protection rule
                    // here; what matters is that the choice is still a real one
                    const ch = arg || {};
                    if (ch.kind === 'preset') {
                        if (!A.presetOf(ch.type)) add('dp.why.noSuchAvatar');
                    } else if (ch.kind === 'file') {
                        const l = A.list(this.dataDir, this.cfg);
                        const f = l.files[ch.index];
                        if (!f) add('dp.why.pictureGone');
                        else if (f.empty) add('dp.why.fileEmpty');
                        else if (f.tooBig) add('dp.why.fileBig', { kb: f.kb, max: l.max });
                    } else add('dp.why.noAvatar');
                }
                if (op === 'delete') {
                    if (st.type === 'GUEST' || st.type === 'VALET' || slot === 'guest' || slot === 'valet') add('dp.why.keepGuest');
                    else if (st.type !== 'USER') add('dp.why.onlyPersonal');
                    if (!this.current) add('dp.why.activeUnknown');
                    else if (slot === this.current) add('dp.why.isActive');
                    if (!F.isLocal(st)) add('dp.why.deleteBmwId');
                }
            }
        }
        // every write: persod hands each of them on to pomd (PIA), which cancels its jobs on engine start
        this.parkedKeys().forEach((k) => add(k));
        return { ok: why.length === 0, why, whyEn, whyKeys };
    }

    /* ---------------- the writes ---------------- */

    /** Runs one write after a fresh read and check. Returns { ok, text, detail }. */
    async write(op, slot, arg, snap) {
        if (this.busy) return { ok: false, text: I.t('dp.notSent', { why: I.t('dp.why.busy', { op: this.busy }) }) };
        this.busy = op;
        try {
            // read again right before: the checks run on what the car says now
            await this.readCurrent();
            if (slot) await this.readOne(slot);
            if (op === 'create') await Promise.all(F.USER_SLOTS.map((s) => this.readOne(s)));
            const c = this.check(op, slot, arg, snap, true);
            if (!c.ok) { this.log.info(op + ' ' + (slot || '') + ' not sent: ' + c.whyEn.join('; ')); return { ok: false, text: I.t('dp.notSent', { why: c.why.join('; ') }) }; }
            let res;
            if (op === 'create') res = await this.create(String(arg).trim());
            else if (op === 'rename') res = await this.rename(slot, String(arg).trim());
            else if (op === 'avatar') res = await this.avatar(slot, arg || {});
            else if (op === 'copy') res = await this.copy(slot);
            else if (op === 'delete') res = await this.remove(slot);
            else res = { ok: false, text: I.t('dp.unknownOp') };
            this.calls.push({ op, slot: res.slot || slot, result: res.code || res.text });
            return res;
        } catch (e) {
            this.log.error(op + ' ' + (slot || '') + ': ' + msg(e));
            return { ok: false, text: I.t('dp.error', { what: msg(e) }) };
        } finally {
            this.busy = null;
            this.refresh('after ' + op);
        }
    }

    async create(name) {
        const before = {};
        F.USER_SLOTS.forEach((s) => { before[s] = this.slots[s].exists; });
        this.log.info('CALL createUserAccount (name not logged)');
        const r = await withTimeout(this.sig.call(this.um, 'createUserAccount', { name }, CALL_MS.createUserAccount), CALL_MS.createUserAccount + 1000, 'createUserAccount');
        const result = F.en(F.resultOf(r, 'CreateUserAccountResult'), F.ENUM.create);
        const slot = F.slotOf(r && r.userAccountReference);
        this.log.info('createUserAccount -> ' + F.code(result, F.ENUM.create) + (slot ? ', slot ' + slot : ''));
        let detail = '';
        if (result === 'SUCCESS') {
            const s = slot || F.USER_SLOTS.find((x) => !before[x]);
            if (s) {
                if (!this.avail[s]) delete this.avail[s];      // a new instance: give it the first-time wait
                const st = await this.readOne(s);
                detail = st.exists ? I.t(st.name === name ? 'dp.res.createdAs' : 'dp.res.createdOther', { slot: F.slotLabel(s).toLowerCase() }) : I.t('dp.res.slotSilent', { slot: s });
            }
            return { ok: true, code: F.code(result, F.ENUM.create), text: I.t('dp.result', { what: F.codeUi(result, F.ENUM.create) }), detail, slot: s };
        }
        if (result === 'MAX_NUM_EXCEEDED') detail = I.t('dp.res.max');
        return { ok: false, code: F.code(result, F.ENUM.create), text: I.t('dp.result', { what: F.codeUi(result, F.ENUM.create) }), detail };
    }

    async rename(slot, name) {
        this.log.info('SET ' + slot + '.name (name not logged)');
        const r = await withTimeout(this.sig.set(this.ua[slot], 'name', name, CALL_MS.name), CALL_MS.name + 1000, 'name setter');
        await sleep(300);
        const st = await this.readOne(slot);
        const ok = st.name === name;
        this.log.info('name setter ' + slot + ' -> ' + (r === name ? 'took the new name' : 'answered differently') + '; read back ' + (ok ? 'matches' : 'does not match'));
        return { ok, code: ok ? 'accepted' : 'not taken', text: I.t('dp.result', { what: I.t(ok ? 'dp.res.nameSet' : 'dp.res.nameSame') }), detail: ok ? '' : I.t('dp.res.oldName') };
    }

    /**
     * One enum field setter. The binding hands enums over by name on the way in (the car answers `type` as "USER"),
     * and the only setter anyone has used on this car took a Utf8D, so a name is what we send first. If the provider
     * refuses it, the same field is set once more with the catalogue's number. No other field is touched either way.
     */
    async setEnum(slot, field, name, ms) {
        try {
            const reply = await withTimeout(this.sig.set(this.ua[slot], field, name, ms), ms + 1000, field + ' setter');
            return { form: 'name', reply };
        } catch (e) {
            const num = A.ENUM_TYPE[name];
            if (num === undefined) throw e;
            this.log.info(field + ' setter refused the enum by name (' + msg(e) + '); trying the number ' + num);
            const reply = await withTimeout(this.sig.set(this.ua[slot], field, num, ms), ms + 1000, field + ' setter (number)');
            return { form: 'number', reply };
        }
    }

    /**
     * Set a profile's avatar: either one of the car's own types (avatarType only), or one of the owner's own jpg
     * files (avatar = the Base64 jpg, then avatarType = INDIVIDUAL, in that order, so the type never points at a
     * picture that is not there yet). The app ships no pictures of its own. Each write's result is reported; the
     * picture is never logged.
     * choice: { kind: 'preset', type: 'DEFAULT' | 'AVATARn' } or { kind: 'file', index }; anything else is not sent.
     */
    async avatar(slot, choice) {
        if (!this.ua[slot]) return { ok: false, text: I.t('dp.notSent', { why: I.t('dp.why.noService') }) };
        if (choice && choice.kind === 'preset') return this.avatarPreset(slot, choice.type);
        if (choice && choice.kind === 'file') return this.avatarFile(slot, choice.index);
        return { ok: false, text: I.t('dp.notSent', { why: I.t('dp.why.noAvatar') }) };
    }

    async avatarPreset(slot, type) {
        this.log.info('SET ' + slot + '.avatarType <- ' + type);
        const s = await this.setEnum(slot, 'avatarType', type, CALL_MS.avatarType);
        const st = await this.readOne(slot);
        const got = A.typeName(st.avatarType);
        const ok = got === type;
        this.log.info('avatarType ' + slot + ' -> ' + (s.form === 'name' ? 'took the name' : 'took the number') + '; reads back ' + (ok ? type : String(got)));
        const extra = type === 'DEFAULT' || type === 'UNSPECIFIED'
            ? I.t('dp.res.keptPicture') : I.t('dp.res.nothingElse');
        return {
            ok, code: ok ? 'accepted' : 'not taken',
            text: I.t('dp.result', { what: ok ? I.t('dp.res.typeNow', { type: type, label: A.typeLabel(type) }) : I.t('dp.res.typeStill', { label: A.typeLabel(got), type: got }) }),
            detail: ok ? extra : I.t('dp.res.oldValue'),
        };
    }

    async avatarFile(slot, index) {
        // read and encode here, right before sending: the size guard and the folder check run on the file as it is
        const where = 'own picture';
        const enc = A.encode(this.dataDir, index, this.cfg);
        if (!enc.ok) { this.log.info('avatar ' + where + ' #' + index + ' not sent: ' + (enc.whyEn || enc.why)); return { ok: false, text: I.t('dp.notSent', { why: enc.why }) }; }
        const before = this.slots[slot] || {};
        this.log.info('SET ' + slot + '.avatar <- ' + where + ' #' + index + ', ' + enc.bytes + ' bytes of jpg, ' + enc.chars + ' Base64 chars (name and data not logged)');
        let data = enc.data;
        let picture;
        try {
            await withTimeout(this.sig.set(this.ua[slot], 'avatar', data, CALL_MS.avatar), CALL_MS.avatar + 1000, 'avatar setter');
            picture = { ok: true };
        } catch (e) {
            // whatever the car said, said as it said it: the refusal path is the point of the guard
            this.log.info('avatar setter ' + slot + ' refused: ' + msg(e));
            picture = { ok: false, why: msg(e) };
        }
        data = null;
        if (!picture.ok) {
            return {
                ok: false, code: 'avatar refused',
                text: I.t('dp.result', { what: I.t('dp.res.pictureRefused', { why: picture.why }) }),
                detail: I.t('dp.res.typeLeft'),
            };
        }
        // did it keep it? the size and checksum of what it reads back, never its content
        const mid = { avatarType: 'INDIVIDUAL' };
        await this.readAvatarSize(slot, mid);
        // the same words for the screen and, in English, for the log
        const storedKey = mid.avatarSum === enc.sum ? ['dp.res.storedSame', {}]
            : mid.avatarBytes === enc.bytes ? ['dp.res.storedSize', {}]
                : typeof mid.avatarBytes === 'number' ? ['dp.res.storedOther', { kb: A.kb(mid.avatarBytes), sent: enc.kb }]
                    : ['dp.res.storedUnread', { err: mid.avatarErr ? ' (' + mid.avatarErr + ')' : '' }];
        const stored = I.t(storedKey[0], storedKey[1]);
        this.log.info('avatar ' + slot + ' stored: ' + I.tl('en', storedKey[0], storedKey[1]));
        let typeRes;
        try {
            const s = await this.setEnum(slot, 'avatarType', 'INDIVIDUAL', CALL_MS.avatarType);
            typeRes = { ok: true, form: s.form };
        } catch (e) { typeRes = { ok: false, why: msg(e) }; }
        const st = await this.readOne(slot);
        const got = A.typeName(st.avatarType);
        const typeOk = got === 'INDIVIDUAL';
        this.log.info('avatarType ' + slot + ' -> ' + (typeRes.ok ? 'set' : 'refused: ' + typeRes.why) + '; reads back ' + String(got));
        if (!typeRes.ok || !typeOk) {
            return {
                ok: false, code: 'avatarType refused',
                text: I.t('dp.result', { what: I.t('dp.res.storedTypeOld', { kb: enc.kb, label: A.typeLabel(got) }) + (typeRes.ok ? '' : ': ' + typeRes.why) }),
                detail: I.t('dp.res.oldAvatar'),
            };
        }
        const name = before.name;
        return {
            ok: true, code: 'accepted',
            text: I.t('dp.result', { what: I.t('dp.res.pictureSent', { kb: enc.kb }) }),
            detail: I.t('dp.res.twoFields', { stored: stored.charAt(0).toUpperCase() + stored.slice(1) })
                + (st.name === name ? '' : I.t('dp.res.nameOther')),
        };
    }

    async copy(slot) {
        this.log.info('CALL copyGuestData(' + slot + ')');
        const r = await withTimeout(this.sig.call(this.um, 'copyGuestData', { userAccountReference: F.refOf(slot) }, CALL_MS.copyGuestData), CALL_MS.copyGuestData + 1000, 'copyGuestData');
        const result = F.en(F.resultOf(r, 'CopyGuestDataResult'), F.ENUM.copy);
        this.log.info('copyGuestData ' + slot + ' -> ' + F.code(result, F.ENUM.copy));
        const st = await this.readOne(slot);
        const detail = result === 'SUCCESS' ? I.t('dp.res.copiedAt', { at: F.date(st.copyTs, I.t('dp.res.timeUnread')) }) : result === 'IS_PROTECTED_ACCOUNT' ? I.t('dp.res.protected') : '';
        return { ok: result === 'SUCCESS', code: F.code(result, F.ENUM.copy), text: I.t('dp.result', { what: F.codeUi(result, F.ENUM.copy) }), detail };
    }

    async remove(slot) {
        this.log.info('CALL removeUserAccount(' + slot + ')');
        const r = await withTimeout(this.sig.call(this.um, 'removeUserAccount', { userAccountReference: F.refOf(slot) }, CALL_MS.removeUserAccount), CALL_MS.removeUserAccount + 1000, 'removeUserAccount');
        const result = F.en(F.resultOf(r, 'RemoveResult'), F.ENUM.remove);
        this.log.info('removeUserAccount ' + slot + ' -> ' + F.code(result, F.ENUM.remove));
        await sleep(500);
        const st = await this.readOne(slot);
        const detail = result === 'SUCCESS' ? I.t(st.exists ? 'dp.res.stillThere' : 'dp.res.free') : result === 'IS_PROTECTED_ACCOUNT' ? I.t('dp.res.protected') : '';
        return { ok: result === 'SUCCESS', code: F.code(result, F.ENUM.remove), text: I.t('dp.result', { what: F.codeUi(result, F.ENUM.remove) }), detail };
    }
}

Profiles.IF = IF;
Profiles.MAX_USERS = MAX_USERS;
module.exports = Profiles;
