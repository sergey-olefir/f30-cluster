'use strict';
/**
 * fake-personalization.js - a stand-in for the MGU's persod on the Mac bench (apps/driver_profiles): the SOME/IP
 * interfaces UserAccountManager (0xFC02), UserAccount (0xFC03, one instance per slot), UserAccountIntra (0xFC05) and
 * SessionManager (0xFC01), as fake providers for the kit's emulator (kit/tools/hu-stub.js hu.fakes). It also feeds
 * what the app checks before a write: DriverSelectionModule.piaProfileId and BdcIdentityMappingTable, CDS engine speed,
 * VehicleInformation gear, Pia.PIATransaction (hu.feed, once a second).
 *
 * Starts as a car with Guest active, a Valet and two local profiles (neutral names), and behaves the way the car does
 * or, where nobody has seen it, the way persod's own strings and enums say (marked "hyp"):
 *   createUserAccount(name)    the first free slot i01..i07, a new persod id, PIA number = lowest free 0..6;
 *                              MAX_NUM_EXCEEDED past maxUsers (default 7, the car's ceiling; the provisioned limit can
 *                              be lower); FAILED while another create runs ("already a 'Create Local Account' job")
 *   UserAccount.name setter    takes the new name and answers with it, notifies (car, 2026-11-14)
 *   UserAccount.avatar         Utf8D, the individual picture as Base64 jpg (persod's schema calls it avatarData);
 *     + avatarType setters     avatarType is the enum DEFAULT / AVATAR1..15 / INDIVIDUAL / UNSPECIFIED. Both notify.
 *                              INDIVIDUAL keeps whatever string was written, so a read gives its size back (hyp: the
 *                              car's own behaviour has not been seen; only the field ids and setters are proven).
 *                              Rejections for the refusal path (POST /fake): avatarMaxChars (how long a Base64 string
 *                              it takes, default 200000), rejectAvatar / rejectAvatarType (a message to throw), and
 *                              avatarEnumByName: false, which makes it take the enum only as a number
 *   copyGuestData(ref)         FAILED unless Guest is the active user ("Current user isn't guest"), IS_PROTECTED_ACCOUNT
 *                              for a protected target, else SUCCESS after ~0.5 s and copyGuestTimestamp = now (car)
 *   removeUserAccount(ref)     FAILED for guest / valet / the active user / a free slot (hyp), IS_PROTECTED_ACCOUNT for a
 *                              protected one (hyp: the enum has it), else SUCCESS and the slot is no longer offered
 * Enums come back by name, as the car's binding hands them over ("USER", { CopyGuestDataResult: "SUCCESS" }).
 * Every method call and setter is recorded (calls) so a test can prove nothing else was sent.
 *
 * Bench only; never shipped. Loaded by bench/run-app.js for an app whose app.json declares UserAccountManager.
 */
const PERS = 'de.bmw.infotainment.personalization.';
const UAM = PERS + 'UserAccountManager';
const SLOTS = ['guest', 'valet', 'i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07'];
const now = () => Math.floor(Date.now() / 1000);
const hex6 = () => ('000000' + Math.floor(Math.random() * 0xffffff).toString(16)).slice(-6);

// the catalogue's enumAvatarType (0xFC03 avatarType, get 28 set 29 notif 32775)
const AVATAR_TYPE = { DEFAULT: 0, INDIVIDUAL: 16, UNSPECIFIED: 17 };
for (let i = 1; i <= 15; i++) AVATAR_TYPE['AVATAR' + i] = i;
const avatarTypeName = (v) => {
    if (typeof v === 'number') return Object.keys(AVATAR_TYPE).find((k) => AVATAR_TYPE[k] === v) || null;
    return typeof v === 'string' && v in AVATAR_TYPE ? v : null;
};
/** A checksum, so the test can prove which bytes arrived without any of them being printed. */
const sum = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2147483647; return h; };
/** The decoded size of a Base64 string (the same arithmetic the app does, so the two can be compared). */
const b64Bytes = (s) => {
    if (!s) return 0;
    let pad = 0;
    if (s.charAt(s.length - 1) === '=') pad++;
    if (s.charAt(s.length - 2) === '=') pad++;
    return Math.max(0, Math.floor(s.length / 4) * 3 - pad);
};

function install(hu, opts) {
    opts = opts || {};
    const log = hu.log || console;
    const acc = {};          // slot -> account
    const avail = {};        // slot -> [fn] availability listeners
    const notif = {};        // slot -> field -> [fn]
    const smListeners = [];
    const calls = [];
    const st = {
        current: 'guest', maxUsers: 7, creating: false, engine: false, gear: 'P', piaTx: 'ENDTRANSACTION', fail: null, slow: 0,
        // the avatar setters' behaviour, all steerable from POST /fake (see the header)
        avatarMaxChars: 200000, rejectAvatar: null, rejectAvatarType: null, avatarEnumByName: true,
    };
    const mk = (slot, type, name, pia, extra) => Object.assign({
        id: slot === 'guest' || slot === 'valet' ? slot : 'i' + hex6(), name, type, gcid: '', protection: [], firstName: '',
        creationDate: now() - 86400 * 30, lastLoginDate: now() - 3600, synchronizationEnabled: false, connectedDriveUsername: '',
        emailAddress: '', avatarType: 'DEFAULT', avatar: '', copyTs: 0, pia,
    }, extra || {});
    acc.guest = mk('guest', 'GUEST', 'Guest', 10);
    acc.valet = mk('valet', 'VALET', 'Valet', 14);
    acc.i01 = mk('i01', 'USER', 'Driver A', 0);
    acc.i02 = mk('i02', 'USER', 'Driver B', 1);

    const fire = (list, v) => (list || []).slice().forEach((fn) => { try { fn(v); } catch (e) { log.warn('fake listener: ' + e); } });
    const notify = (slot, field) => fire((notif[slot] || {})[field], acc[slot] ? acc[slot][field] : undefined);
    const setAvail = (slot, on) => fire(avail[slot], on);
    const later = (ms, fn) => new Promise((res, rej) => setTimeout(() => { try { res(fn()); } catch (e) { rej(e); } }, ms + st.slow));
    const refSlot = (ref) => { const s = String(ref || '').split('.').pop(); return SLOTS.indexOf(s) >= 0 && String(ref).indexOf(UAM + '.') === 0 ? s : null; };
    const users = () => SLOTS.slice(2).filter((s) => acc[s]);

    function proxyBase(inst, isAvail) {
        return {
            __fake: true, inst,
            isAvailable: isAvail,
            subscribeToAvailability: () => {},
            shutdown: () => Promise.resolve(),
            getValue: () => Promise.reject(new Error('no getter')),
            setValue: () => Promise.reject(new Error('no setter')),
            callMethod: () => Promise.reject(new Error('no method')),
            subscribe: () => Promise.resolve(),
        };
    }

    // ---- UserAccount: one instance per slot ----
    hu.fakes[PERS + 'UserAccount'] = (inst) => {
        const slot = refSlot(inst);
        if (!slot) throw new Error('unknown instance ' + inst);
        const p = proxyBase(inst, () => !!acc[slot]);
        p.subscribeToAvailability = (fn) => { (avail[slot] = avail[slot] || []).push(fn); };
        p.getValue = (f) => {
            const a = acc[slot];
            // a slot that is not offered: no answer (the binding times out)
            if (!a) return later(300, () => { throw new Error('timeout: ' + slot + ' not offered'); });
            if (f === 'copyTs' || f === 'pia' || !(f in a)) return Promise.reject(new Error('no field ' + f));
            return later(5, () => (Array.isArray(a[f]) ? a[f].slice() : a[f]));
        };
        p.setValue = (f, v) => {
            // recorded before anything is checked, so a test sees any field the app ever tried to write
            calls.push({ call: 'set UserAccount.' + f, slot, chars: f === 'avatar' ? String(v).length : undefined });
            const a = acc[slot];
            if (f !== 'name' && f !== 'avatar' && f !== 'avatarType') return Promise.reject(new Error('no setter for ' + f));
            if (!a) return later(300, () => { throw new Error('timeout: ' + slot + ' not offered'); });
            if (f === 'name') return later(10, () => { a.name = String(v); notify(slot, 'name'); return a.name; });
            if (f === 'avatar') {
                const s = String(v == null ? '' : v);
                if (st.rejectAvatar) return later(20, () => { throw new Error(st.rejectAvatar); });
                if (s.length > st.avatarMaxChars) return later(20, () => { throw new Error('persod: avatar rejected, ' + s.length + ' characters is more than this unit takes'); });
                // a whole jpg over the binding takes a moment
                return later(40, () => { a.avatar = s; notify(slot, 'avatar'); return a.avatar; });
            }
            // avatarType: the enum, by name as the binding hands them over, or by number
            if (st.rejectAvatarType) return later(20, () => { throw new Error(st.rejectAvatarType); });
            if (typeof v === 'string' && !st.avatarEnumByName) return later(20, () => { throw new Error('persod: avatarType takes the enum as a number on this unit'); });
            const name = avatarTypeName(v);
            if (!name) return later(20, () => { throw new Error('persod: ' + JSON.stringify(v) + ' is not an avatarType'); });
            return later(10, () => { a.avatarType = name; notify(slot, 'avatarType'); return a.avatarType; });
        };
        p.subscribe = (o) => { const n = (notif[slot] = notif[slot] || {}); (n[o.name] = n[o.name] || []).push(o.onReceive); return Promise.resolve(); };
        return p;
    };

    // ---- UserAccountIntra: getCopyGuestTimestamp per slot ----
    hu.fakes[PERS + 'UserAccountIntra'] = (inst) => {
        const slot = String(inst).split('.').pop();
        const p = proxyBase(inst, () => !!acc[slot]);
        p.callMethod = (m) => {
            if (m !== 'getCopyGuestTimestamp') return Promise.reject(new Error('no method ' + m));
            if (!acc[slot]) return later(300, () => { throw new Error('timeout'); });
            return later(5, () => ({ timestamp: acc[slot].copyTs }));
        };
        return p;
    };

    // ---- SessionManager ----
    hu.fakes[PERS + 'SessionManager'] = (inst) => {
        const p = proxyBase(inst, () => true);
        p.getValue = (f) => (f === 'currentUserAccountReference' ? later(5, () => UAM + '.' + st.current) : Promise.reject(new Error('no field ' + f)));
        p.subscribe = (o) => { if (o.name === 'currentUserOnChange') smListeners.push(o.onReceive); return Promise.resolve(); };
        return p;
    };

    // ---- UserAccountManager ----
    hu.fakes[UAM] = (inst) => {
        const p = proxyBase(inst, () => true);
        p.callMethod = (m, args) => {
            const slot = refSlot(args && args.userAccountReference);
            calls.push({ call: m, slot: slot || null });
            if (st.fail === m) return later(50, () => { throw new Error('fake: ' + m + ' made to fail'); });
            if (m === 'createUserAccount') {
                if (st.creating) return later(20, () => ({ CreateUserAccountResult: 'FAILED', userAccountReference: '' }));
                if (users().length >= st.maxUsers) return later(50, () => ({ CreateUserAccountResult: 'MAX_NUM_EXCEEDED', userAccountReference: '' }));
                const free = SLOTS.slice(2).find((s) => !acc[s]);
                if (!free) return later(50, () => ({ CreateUserAccountResult: 'MAX_NUM_EXCEEDED', userAccountReference: '' }));
                st.creating = true;
                return later(400, () => {
                    st.creating = false;
                    const used = users().map((s) => acc[s].pia);
                    let pia = 0; while (used.indexOf(pia) >= 0) pia++;
                    acc[free] = mk(free, 'USER', String(args.name || 'TEST_NAME'), pia, { creationDate: now(), lastLoginDate: 0 });
                    setAvail(free, true);
                    return { CreateUserAccountResult: 'SUCCESS', userAccountReference: UAM + '.' + free };
                });
            }
            if (m === 'removeUserAccount') {
                const a = slot && acc[slot];
                if (!a || a.type !== 'USER' || slot === st.current) return later(50, () => ({ RemoveResult: 'FAILED' }));
                if (a.protection.length) return later(50, () => ({ RemoveResult: 'IS_PROTECTED_ACCOUNT' }));
                return later(300, () => { delete acc[slot]; setAvail(slot, false); return { RemoveResult: 'SUCCESS' }; });
            }
            if (m === 'copyGuestData') {
                const a = slot && acc[slot];
                if (!a || a.type !== 'USER' || st.current !== 'guest') return later(50, () => ({ CopyGuestDataResult: 'FAILED' }));
                if (a.protection.length) return later(50, () => ({ CopyGuestDataResult: 'IS_PROTECTED_ACCOUNT' }));
                return later(500, () => { a.copyTs = now(); return { CopyGuestDataResult: 'SUCCESS' }; });
            }
            return Promise.reject(new Error('fake: ' + m + ' not provided'));
        };
        return p;
    };

    // ---- what the car sends anyway (the checks) ----
    const feed = () => {
        const a = acc[st.current];
        hu.feed('de.bmw.infrastructure.DriverSelectionModule', 'piaProfileId', a ? a.pia : 10);
        hu.feed('de.bmw.infrastructure.DriverSelectionModule', 'BdcIdentityMappingTable', users().filter((s) => acc[s].protection.indexOf('KEYFOB') >= 0).map((s, i) => ({ TokenId: i, PiaProfileId: acc[s].pia })));
        hu.feed('de.bmw.infotainment.vehicle.CDS', 'statusEngineSpeed2', { actualValueRPMEngineCrankshaft: st.engine ? 3200 : 0 });
        hu.feed('de.bmw.infrastructure.VehicleInformation', 'DataPowerTrain2', { statusGearSelectionDrive: st.gear });
        hu.feed('de.bmw.infrastructure.Pia', 'PIATransaction', { pIAStatusTransaction: st.piaTx });
        hu.feed('de.bmw.infotainment.vehicle.Vehicle', 'statusNewCurrentUnitsStatusExt', { language: 'ENGLISCH__UK', unitOfMeasurementTime: '_24_H', unitOfMeasurementTemperature: 'C', unitOfMeasurementSpeedometerDigital: 'KILOMETER', unitOfMeasurementConsumption: 'L_S_100KM', unitOfMeasurementAirPressure: 'BAR' });
    };
    setInterval(feed, 1000);
    setTimeout(feed, 50);

    /**
     * Bench control (POST /fake): { current, protect: { slot: [..] }, maxUsers, engine, gear, piaTx, fail, slow,
     * bmwId, avatarMaxChars, rejectAvatar, rejectAvatarType, avatarEnumByName, setAvatar: { slot, bytes, type } }.
     */
    function control(m) {
        if (m.current && acc[m.current]) {
            st.current = m.current;
            fire(smListeners, UAM + '.' + st.current);
            log.info('fake persod: active profile ' + st.current);
        }
        if (m.protect) Object.keys(m.protect).forEach((s) => { if (acc[s]) { acc[s].protection = m.protect[s].slice(); notify(s, 'protection'); } });
        if (typeof m.maxUsers === 'number') st.maxUsers = m.maxUsers;
        if (typeof m.engine === 'boolean') st.engine = m.engine;
        if (typeof m.gear === 'string') st.gear = m.gear;
        if (typeof m.piaTx === 'string') st.piaTx = m.piaTx;
        if ('fail' in m) st.fail = m.fail || null;
        if (typeof m.slow === 'number') st.slow = m.slow;
        if (m.bmwId && acc[m.bmwId]) { acc[m.bmwId].gcid = 'fake-gcid'; acc[m.bmwId].connectedDriveUsername = 'driver@example.com'; notify(m.bmwId, 'gcid'); }
        if (typeof m.avatarMaxChars === 'number') st.avatarMaxChars = m.avatarMaxChars;
        if ('rejectAvatar' in m) st.rejectAvatar = m.rejectAvatar || null;
        if ('rejectAvatarType' in m) st.rejectAvatarType = m.rejectAvatarType || null;
        if (typeof m.avatarEnumByName === 'boolean') st.avatarEnumByName = m.avatarEnumByName;
        // a profile that already has an own picture, so the read path has something to size up
        if (m.setAvatar && acc[m.setAvatar.slot]) {
            const a = acc[m.setAvatar.slot];
            if (typeof m.setAvatar.bytes === 'number') {
                a.avatar = Buffer.alloc(Math.max(0, m.setAvatar.bytes), 0x5a).toString('base64');
                notify(m.setAvatar.slot, 'avatar');
            }
            const t = avatarTypeName(m.setAvatar.type === undefined ? 'INDIVIDUAL' : m.setAvatar.type);
            if (t) { a.avatarType = t; notify(m.setAvatar.slot, 'avatarType'); }
        }
        feed();
    }
    function state() {
        const out = {};
        // the picture itself never leaves the fake: a test gets its size and a checksum
        Object.keys(acc).forEach((s) => {
            const a = acc[s];
            out[s] = {
                id: a.id, name: a.name, type: a.type, gcid: a.gcid, protection: a.protection.slice(), copyTs: a.copyTs, pia: a.pia,
                avatarType: a.avatarType, avatarChars: a.avatar.length, avatarBytes: b64Bytes(a.avatar),
                avatarSum: a.avatar ? sum(a.avatar) : 0,
            };
        });
        return { accounts: out, current: st.current, calls: calls.slice(), maxUsers: st.maxUsers, avatarMaxChars: st.avatarMaxChars };
    }
    log.info('bench: fake persod (UserAccountManager, UserAccount, SessionManager) with guest, valet, i01, i02; guest active');
    return { control, state };
}

module.exports = { install };
