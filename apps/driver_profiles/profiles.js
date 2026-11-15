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
 *   UserAccountManager.copyGuestData(ref)               method 21851
 *   UserAccountManager.removeUserAccount(ref)           method 21846
 * Nothing else is ever called: no UDS, no delete-all, no PIA reset, no login. The app.json manifest grants only these
 * (the installer's ACL then lets nothing else through).
 *
 * Names and e-mail addresses never go to the log: slots, result codes and errors only.
 * Plain Node 8 (the car's 8.16.2). Every callback is guarded: an exception that escaped would end the app.
 */
const fs = require('fs');
const path = require('path');
const F = require('./format');

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
const CALL_MS = { createUserAccount: 30000, removeUserAccount: 60000, copyGuestData: 150000, name: 8000 };
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

    list() { return F.SLOTS.map((s) => this.slots[s]); }
    users() { return F.USER_SLOTS.filter((s) => this.slots[s].exists); }
    freeSlot() { return F.USER_SLOTS.find((s) => !this.slots[s].exists) || null; }
    names() { return F.SLOTS.map((s) => this.slots[s]).filter((s) => s.exists && s.name).map((s) => s.name); }
    /** The PIA profile number of a slot: Guest's is fixed (10); the others as seen while they were active. */
    piaOf(st) {
        if (!st || !st.exists) return { n: null, how: '' };
        if (st.type === 'GUEST') return { n: 10, how: 'Guest' };
        if (st.slot === this.current && typeof this.car.pia === 'number') return { n: this.car.pia, how: 'active now' };
        if (st.id && typeof this.piaSeen[st.id] === 'number') return { n: this.piaSeen[st.id], how: 'seen while it was active' };
        return { n: null, how: 'not known yet: it shows once this profile has been active' };
    }

    /* ---------------- checks (run again right before every write) ---------------- */

    /** The car parked: engine off, P, no PIA job running. [] when fine, else why not. */
    parkedProblems() {
        if (!this.requireParked) return [];
        const out = [], c = this.car;
        if (c.rpmRaw === null || c.rpmRaw === undefined || c.rpmRaw === 65535) out.push('engine state not known');
        else if (c.rpmRaw !== 0) out.push('the engine is running');
        if (!c.gear) out.push('gear not known');
        else if (c.gear !== 'P') out.push('not in P');
        if (c.piaTx === 'BEGINTRANSACTION') out.push('a PIA job is running');
        return out;
    }

    /**
     * Whether op may run now: { ok, why: [..] }. op: 'create' | 'rename' | 'copy' | 'delete'. For rename / copy /
     * delete, snap is what the confirm screen showed ({ id, name }): the slot must still hold that profile.
     */
    check(op, slot, arg, snap, sending) {
        const why = [];
        if (this.busy && !sending) why.push('another change is running (' + this.busy + ')');
        if (!this.um) why.push('the profile service is not reachable' + (this.errors[IF.uam] ? ': ' + this.errors[IF.uam] : ''));
        const st = slot ? this.slots[slot] : null;
        if (op === 'create') {
            const name = String(arg || '').trim();
            if (!name) why.push('no name');
            if (this.names().map((n) => n.toLowerCase()).indexOf(name.toLowerCase()) >= 0) why.push('a profile is already called that');
            if (!this.freeSlot()) why.push('no free slot (' + this.users().length + ' of ' + MAX_USERS + ' in use)');
        } else {
            if (!st || !st.exists) why.push('the profile is not there any more');
            else {
                if (snap && (st.id !== snap.id || st.name !== snap.name)) why.push('the profile changed meanwhile: look again');
                if (op === 'rename') {
                    if (st.type !== 'USER') why.push('only personal profiles are renamed here');
                    else if (!F.isLocal(st)) why.push('a BMW ID profile: its name comes from the BMW ID');
                    const name = String(arg || '').trim();
                    if (!name) why.push('no name');
                    else if (name === st.name) why.push('it already has that name');
                    else if (this.names().map((n) => n.toLowerCase()).indexOf(name.toLowerCase()) >= 0) why.push('a profile is already called that');
                }
                if (op === 'copy') {
                    if (st.type !== 'USER') why.push('only into a personal profile');
                    if (this.current !== 'guest') why.push(this.current ? 'Guest is not the active profile' : 'the active profile is not known');
                    const prot = F.protectionList(st.protection);
                    if (prot === null) why.push('its protection is not known');
                    else if (prot.length) why.push('it is protected (' + F.protectionText(st.protection) + '): copying needs an unprotected profile');
                }
                if (op === 'delete') {
                    if (st.type === 'GUEST' || st.type === 'VALET' || slot === 'guest' || slot === 'valet') why.push('Guest and Valet are never deleted');
                    else if (st.type !== 'USER') why.push('only personal profiles');
                    if (!this.current) why.push('the active profile is not known');
                    else if (slot === this.current) why.push('it is the active profile');
                    if (!F.isLocal(st)) why.push('a BMW ID profile: remove it in BMW\'s own profile menu');
                }
            }
        }
        // every write: persod hands each of them on to pomd (PIA), which cancels its jobs on engine start
        this.parkedProblems().forEach((p) => why.push(p));
        return { ok: why.length === 0, why };
    }

    /* ---------------- the writes ---------------- */

    /** Runs one write after a fresh read and check. Returns { ok, text, detail }. */
    async write(op, slot, arg, snap) {
        if (this.busy) return { ok: false, text: 'Not sent: another change is running (' + this.busy + ')' };
        this.busy = op;
        try {
            // read again right before: the checks run on what the car says now
            await this.readCurrent();
            if (slot) await this.readOne(slot);
            if (op === 'create') await Promise.all(F.USER_SLOTS.map((s) => this.readOne(s)));
            const c = this.check(op, slot, arg, snap, true);
            if (!c.ok) { this.log.info(op + ' ' + (slot || '') + ' not sent: ' + c.why.join('; ')); return { ok: false, text: 'Not sent: ' + c.why.join('; ') }; }
            let res;
            if (op === 'create') res = await this.create(String(arg).trim());
            else if (op === 'rename') res = await this.rename(slot, String(arg).trim());
            else if (op === 'copy') res = await this.copy(slot);
            else if (op === 'delete') res = await this.remove(slot);
            else res = { ok: false, text: 'unknown operation' };
            this.calls.push({ op, slot: res.slot || slot, result: res.code || res.text });
            return res;
        } catch (e) {
            this.log.error(op + ' ' + (slot || '') + ': ' + msg(e));
            return { ok: false, text: 'Error: ' + msg(e) };
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
                detail = st.exists ? 'Now in ' + F.slotLabel(s).toLowerCase() + (st.name === name ? ', name as chosen' : ', name reads back differently') : 'The new slot ' + s + ' does not answer yet';
            }
            return { ok: true, code: F.code(result, F.ENUM.create), text: 'Result: ' + F.code(result, F.ENUM.create), detail, slot: s };
        }
        if (result === 'MAX_NUM_EXCEEDED') detail = 'The car allows no more profiles (its provisioned limit)';
        return { ok: false, code: F.code(result, F.ENUM.create), text: 'Result: ' + F.code(result, F.ENUM.create), detail };
    }

    async rename(slot, name) {
        this.log.info('SET ' + slot + '.name (name not logged)');
        const r = await withTimeout(this.sig.set(this.ua[slot], 'name', name, CALL_MS.name), CALL_MS.name + 1000, 'name setter');
        await sleep(300);
        const st = await this.readOne(slot);
        const ok = st.name === name;
        this.log.info('name setter ' + slot + ' -> ' + (r === name ? 'took the new name' : 'answered differently') + '; read back ' + (ok ? 'matches' : 'does not match'));
        return { ok, code: ok ? 'accepted' : 'not taken', text: 'Result: ' + (ok ? 'name set (the service took it and reads it back)' : 'the name did not change'), detail: ok ? '' : 'The service answered, but reads back the old name' };
    }

    async copy(slot) {
        this.log.info('CALL copyGuestData(' + slot + ')');
        const r = await withTimeout(this.sig.call(this.um, 'copyGuestData', { userAccountReference: F.refOf(slot) }, CALL_MS.copyGuestData), CALL_MS.copyGuestData + 1000, 'copyGuestData');
        const result = F.en(F.resultOf(r, 'CopyGuestDataResult'), F.ENUM.copy);
        this.log.info('copyGuestData ' + slot + ' -> ' + F.code(result, F.ENUM.copy));
        const st = await this.readOne(slot);
        const detail = result === 'SUCCESS' ? 'Copied at ' + F.date(st.copyTs, 'a time not readable') : result === 'IS_PROTECTED_ACCOUNT' ? 'The profile is protected (key, PIN or NFC)' : '';
        return { ok: result === 'SUCCESS', code: F.code(result, F.ENUM.copy), text: 'Result: ' + F.code(result, F.ENUM.copy), detail };
    }

    async remove(slot) {
        this.log.info('CALL removeUserAccount(' + slot + ')');
        const r = await withTimeout(this.sig.call(this.um, 'removeUserAccount', { userAccountReference: F.refOf(slot) }, CALL_MS.removeUserAccount), CALL_MS.removeUserAccount + 1000, 'removeUserAccount');
        const result = F.en(F.resultOf(r, 'RemoveResult'), F.ENUM.remove);
        this.log.info('removeUserAccount ' + slot + ' -> ' + F.code(result, F.ENUM.remove));
        await sleep(500);
        const st = await this.readOne(slot);
        const detail = result === 'SUCCESS' ? (st.exists ? 'The slot still answers: look again in a moment' : 'The slot is free now') : result === 'IS_PROTECTED_ACCOUNT' ? 'The profile is protected (key, PIN or NFC)' : '';
        return { ok: result === 'SUCCESS', code: F.code(result, F.ENUM.remove), text: 'Result: ' + F.code(result, F.ENUM.remove), detail };
    }
}

Profiles.IF = IF;
Profiles.MAX_USERS = MAX_USERS;
module.exports = Profiles;
