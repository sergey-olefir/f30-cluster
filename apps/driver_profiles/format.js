'use strict';
/**
 * format.js - pure helpers of Driver Profiles: the slots, the services' enums, and the text each row shows.
 * No SOME/IP and no UI here, so the bench test can load it as it is. Plain Node 8 (the car's 8.16.2).
 */
const I = require('./lang');          // r1120 LN: the words from shared/i18n/<lang>.json (the enums and the log stay as they are)
const PERS = 'de.bmw.infotainment.personalization.';
const UAM = PERS + 'UserAccountManager';
// the unit's catalogue: UserAccount instances guest 0xFC03, valet 0xFC04, i01..i07 0xFC05..0xFC0B
const SLOTS = ['guest', 'valet', 'i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07'];
const USER_SLOTS = SLOTS.slice(2);
const ROW = { guest: 'P_GUEST', valet: 'P_VALET', i01: 'P_I01', i02: 'P_I02', i03: 'P_I03', i04: 'P_I04', i05: 'P_I05', i06: 'P_I06', i07: 'P_I07' };

// the enums as the catalogue has them (the binding hands enums over by name; numbers are mapped too)
const ENUM = {
    type: { USER: 0, GUEST: 1, VALET: 2, FLEET: 3 },
    protection: { PIN: 0, KEYFOB: 1, NFC: 2, NFC_REVOKED: 3, DIGITAL_KEY: 4 },
    create: { SUCCESS: 0, MAX_NUM_EXCEEDED: 1, FAILED: 2 },
    remove: { SUCCESS: 0, FAILED: 1, IS_PROTECTED_ACCOUNT: 2 },
    copy: { FAILED: 0, SUCCESS: 1, IS_PROTECTED_ACCOUNT: 2 },
    gear: { INITIALISIERUNG: 0, N: 1, R: 2, P: 3, NP: 4, SIGNAL_UNGUELTIG: 15 },
    piaTx: { BEGINTRANSACTION: 1, ENDTRANSACTION: 2 },
};

const refOf = (slot) => UAM + '.' + slot;
const intraOf = (slot) => PERS + 'UserAccountIntra.' + slot;
/** "de.bmw...UserAccountManager.i01" -> "i01" (null when it is not one of the slots). */
function slotOf(ref) {
    const s = String(ref || '').split('.').pop();
    return SLOTS.indexOf(s) >= 0 ? s : null;
}
/** An enum value (name or number) -> its name; unknown numbers stay numbers, null stays null. */
function en(v, map) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') { const k = Object.keys(map).find((x) => map[x] === v); return k || v; }
    return String(v);
}
/** An enum name -> "NAME (code n)", the way result codes are logged (codeUi: the same on the screen, in the app's language). */
function code(v, map) {
    const name = en(v, map);
    const n = typeof v === 'number' ? v : map[name];
    return name === null ? 'no answer' : name + (n !== undefined ? ' (code ' + n + ')' : '');
}
/** The first member of a one-member result struct ({ CreateUserAccountResult: 'SUCCESS', ... }) or a bare value. */
function codeUi(v, map) {
    const name = en(v, map);
    const n = typeof v === 'number' ? v : map[name];
    return name === null ? I.t('dp.noAnswer') : name + (n !== undefined ? ' (' + I.t('dp.code', { n: n }) + ')' : '');
}
function resultOf(r, key) {
    if (r && typeof r === 'object') return key in r ? r[key] : r[Object.keys(r)[0]];
    return r;
}

/** A profile type in words (dp.type.<TYPE>), or null for a type with none. */
function typeText(t) { return I.has('dp.type.' + t) ? I.t('dp.type.' + t) : null; }
const TYPE_TEXT = { USER: 1, GUEST: 1, VALET: 1, FLEET: 1 };       // the types that have words (typeText)
const PROT_KEYS = { PIN: 1, KEYFOB: 1, NFC: 1, NFC_REVOKED: 1, DIGITAL_KEY: 1 };

function protectionList(p) {
    if (!Array.isArray(p)) return null;
    return p.map((x) => en(x, ENUM.protection));
}
function protectionText(p) {
    const l = protectionList(p);
    if (l === null) return I.t('dp.notKnown');
    return l.length ? l.map((x) => (PROT_KEYS[x] ? I.t('dp.prot.' + x) : String(x))).join(', ') : I.t('dp.none');
}
function isLocal(st) { return !!st && (st.gcid === '' || st.gcid === null || st.gcid === undefined); }
/** accountText's code ('local', 'BMW ID', 'not known') in words. */
function accountWord(code) { return code === 'BMW ID' ? 'BMW ID' : code === 'local' ? I.t('dp.acct.local') : code ? I.t('dp.notKnown') : ''; }
function accountText(st) {
    if (!st) return '';
    if (st.gcid === null || st.gcid === undefined) return st.gcidKnown === false ? 'not known' : 'local';
    return st.gcid === '' ? 'local' : 'BMW ID';
}
/** "a***@example.com": enough to recognise it, not the whole address on the screen. */
function mask(s) {
    s = String(s || '');
    if (!s) return '';
    const at = s.indexOf('@');
    if (at > 0) return s[0] + '***' + s.slice(at);
    return s.length > 2 ? s.slice(0, 2) + '***' : '***';
}
function two(n) { return (n < 10 ? '0' : '') + n; }
/** Unix seconds (UInt32) -> "2026-11-14 20:47 UTC"; 0 or nothing -> fallback. */
function date(sec, none) {
    if (typeof sec !== 'number' || !isFinite(sec) || sec <= 0) return none === undefined ? I.t('dp.never') : none;
    const d = new Date(sec * 1000);
    return d.getUTCFullYear() + '-' + two(d.getUTCMonth() + 1) + '-' + two(d.getUTCDate()) + ' ' + two(d.getUTCHours()) + ':' + two(d.getUTCMinutes()) + ' UTC';
}
function slotLabel(slot) {
    if (slot === 'guest') return I.t('dp.slot.guest');
    if (slot === 'valet') return I.t('dp.slot.valet');
    return I.t('dp.slot', { n: Number(slot.slice(1)) });
}
/** A profile's name for the screen (the service's, else what it is). */
function nameOf(st) {
    if (!st) return '';
    if (st.name) return st.name;
    if (st.type === 'GUEST') return I.t('dp.type.GUEST');
    if (st.type === 'VALET') return I.t('dp.type.VALET');
    return I.t('dp.noName');
}
/** Second line of a list row: "Personal, local, protection: none". */
function rowLine(st) {
    if (!st || !st.exists) return I.t('dp.row.free');
    return I.t('dp.row', { type: typeText(st.type) || String(st.type || I.t('dp.typeNotKnown')), account: accountWord(accountText(st)), protection: protectionText(st.protection) });
}
/** "Profile N" with the first N no profile is called yet. */
function autoName(base, taken) {
    const used = {};
    (taken || []).forEach((n) => { used[String(n).toLowerCase()] = true; });
    for (let i = 1; i < 100; i++) if (!used[(base + ' ' + i).toLowerCase()]) return base + ' ' + i;
    return base + ' ' + Date.now() % 1000;
}
/** A preset name list from app.json config: strings only, trimmed, at most 10, no doubles. */
function presetNames(cfg) {
    const out = [];
    ((cfg && cfg.names) || []).forEach((n) => {
        const s = typeof n === 'string' ? n.trim().slice(0, 32) : '';
        if (s && out.length < 10 && out.map((x) => x.toLowerCase()).indexOf(s.toLowerCase()) < 0) out.push(s);
    });
    return out;
}

module.exports = {
    PERS, UAM, SLOTS, USER_SLOTS, ROW, ENUM, TYPE_TEXT,
    refOf, intraOf, slotOf, en, code, codeUi, resultOf, protectionList, protectionText, isLocal, accountText, accountWord, typeText, mask, date, slotLabel, nameOf,
    rowLine, autoName, presetNames,
};
