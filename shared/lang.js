'use strict';
/**
 * lang.js - the apps' languages (r1120 LN, docs/r1120/LN-REPORT.md): one string table per language in shared/i18n/<lang>.json
 * (shared/i18n/uk.json, shared/i18n/en.json), stable keys, the language chosen by the setting "Мова / Language"
 * (key "lang": auto | uk | en). A third language is one more table: shared/i18n/<lang>.json with every key; nothing here
 * names a language except the default (DEFAULT) and the plural rules.
 *
 *   const I = require('./lang');
 *   I.t('menu.status.on', { name: '6WB Comfort' })      -> "Увімкнено: 6WB Comfort" / "On: 6WB Comfort"
 *   I.plural('probe.samples', 21)                        -> "21 зразок" / "21 samples"
 *   I.lang()                                             -> 'uk' | 'en'
 *   I.onChange((lang) => ...)                            -> after every change of the language in use
 *
 * "auto" follows the head unit's language: the --currentLanguage argument MainApp starts every OAP app with ("uk_UA" on the
 * owner's car, seen in its process table 2026-11-14), and HMIContext.currentDisplayLanguage while the app runs (attach()).
 * A head-unit language with no table of ours, or none known, means DEFAULT: Ukrainian, the owner's language.
 *
 * The RHMI side (attach): the build writes the menus' words per HMI language (kit/tools/app_i18n.py: uk_UA gets uk, en_GB /
 * en_US get en, every other bundle uk) and ships both sets in i18n/rhmi.json; when the language in use is not the one the
 * HMI's bundle carries, the app writes the other set into its string bundle (StringBundle.setStrings, the mechanism the
 * kit's dynamic text already uses) and asks every menu screen to update its resources. No rebuild, no reinstall.
 *
 * Log lines stay English and never go through here. Never throws: a missing key answers the default table's text, else the
 * key itself. Plain Node 8 (the car's 8.16.2): no Intl.PluralRules, no ?. / ??.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT = 'uk';
const PREF_KEY = 'lang';
const PREFS = ['auto'];             // + every table's language

// ---- the tables: shared/i18n/<lang>.json in the repo, javascript/i18n/<lang>.json in a package (kit/tools/app_i18n.py) ----
const TABLES = Object.create(null);
(function load() {
    const dirs = [path.join(__dirname, 'i18n')];
    dirs.forEach((d) => {
        let files = [];
        try { files = fs.readdirSync(d); } catch (e) { return; }
        files.filter((f) => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(f)).forEach((f) => {
            try { TABLES[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) { /* a broken table is left out */ }
        });
    });
    if (!TABLES[DEFAULT]) TABLES[DEFAULT] = {};
})();
const LANGS = Object.keys(TABLES).sort((a, b) => (a === DEFAULT ? -1 : b === DEFAULT ? 1 : a < b ? -1 : 1));

// ---- plural forms: the table's text is the forms joined by "|", in the order the rule numbers them --------------------------
const PLURAL_RULES = {
    uk: (n) => {        // one | few | many (1, 21 | 2-4, 22-24 | 0, 5-20, 11-14, 25 ...); a fraction takes "few"
        if (Math.floor(n) !== n) return 1;
        const m100 = Math.abs(n) % 100, m10 = m100 % 10;
        if (m10 === 1 && m100 !== 11) return 0;
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 1;
        return 2;
    },
    en: (n) => (n === 1 ? 0 : 1),
};

// ---- the head unit's language -----------------------------------------------------------------------------------------------
// CommonTypes.Language (the catalogue of 2026-11-15): HMIContext.currentDisplayLanguage may arrive as its number or its name
const HMI_ENUM = { 2: 'en', 3: 'en', 37: 'uk', ENGLISCH__UK: 'en', ENGLISCH__US: 'en', UKRAINISCH: 'uk' };
/** A head-unit language as it may arrive ("uk_UA", "en-GB", 37, "UKRAINISCH") -> a table's language, or null (none of ours). */
function hmiLang(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return HMI_ENUM[v] || null;
    const s = String(v).trim();
    if (Object.prototype.hasOwnProperty.call(HMI_ENUM, s)) return HMI_ENUM[s];
    const m = /^([a-z]{2})(?:[_-]([A-Za-z]{2}))?$/i.exec(s);
    if (!m) return null;
    const full = m[1].toLowerCase() + (m[2] ? '-' + m[2].toUpperCase() : '');
    if (TABLES[full]) return full;
    return TABLES[m[1].toLowerCase()] ? m[1].toLowerCase() : null;
}
/** The value after --currentLanguage in argv (MainApp's start arguments), or null. */
function argvLang(argv) {
    const a = argv || [];
    for (let i = 0; i < a.length; i++) {
        const s = String(a[i]);
        if (s === '--currentLanguage' && i + 1 < a.length) return String(a[i + 1]);
        if (s.indexOf('--currentLanguage=') === 0) return s.slice(18);
    }
    return null;
}
/** The language in use for a setting value and a head-unit language: an explicit table, else the head unit's, else DEFAULT. */
function resolve(pref, hmi) {
    if (pref && pref !== 'auto' && TABLES[pref]) return pref;
    return hmiLang(hmi) || DEFAULT;
}

// ---- state ----------------------------------------------------------------------------------------------------------------
const state = { pref: 'auto', hmi: null, lang: DEFAULT, listeners: [] };
state.hmi = argvLang(process.argv);
state.lang = resolve(state.pref, state.hmi);

function lang() { return state.lang; }
function changed(was) {
    if (state.lang === was) return;
    state.listeners.slice().forEach((fn) => { try { fn(state.lang, was); } catch (e) { /* a listener's own problem */ } });
}
/** The setting's value (auto | uk | en ...). */
function setPref(p) {
    const was = state.lang;
    state.pref = typeof p === 'string' ? p : 'auto';
    state.lang = resolve(state.pref, state.hmi);
    changed(was);
    return state.lang;
}
/** The head unit's language (any form hmiLang takes; null = unknown). */
function setHmi(v) {
    const was = state.lang;
    state.hmi = v === undefined ? null : v;
    state.lang = resolve(state.pref, state.hmi);
    changed(was);
    return state.lang;
}
function onChange(fn) { if (typeof fn === 'function') state.listeners.push(fn); }
function info() { return { pref: state.pref, hmi: state.hmi === null ? null : String(state.hmi), hmiLang: hmiLang(state.hmi), lang: state.lang }; }

// ---- lookup -------------------------------------------------------------------------------------------------------------------
function has(key, lng) { const T = TABLES[lng || state.lang]; return !!T && Object.prototype.hasOwnProperty.call(T, key); }
function raw(key, lng) {
    const T = TABLES[lng || state.lang];
    if (T && Object.prototype.hasOwnProperty.call(T, key)) return T[key];
    const D = TABLES[DEFAULT];
    if (D && Object.prototype.hasOwnProperty.call(D, key)) return D[key];
    return key;
}
function fill(s, vars) {
    if (!vars) return s;
    return s.replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}
/** The text of `key` in the language in use, {name} filled from vars. */
function t(key, vars) { return fill(String(raw(key)), vars); }
/** The same in a given language (tests, the build's check). */
function tl(lng, key, vars) { return fill(String(raw(key, lng)), vars); }
/** The form of `key` for the number n ({n} is n), by the language's plural rule. */
function plural(key, n, vars, lng) {
    const L = lng || state.lang;
    const forms = String(raw(key, L)).split('|');
    const rule = PLURAL_RULES[L] || PLURAL_RULES[L.split('-')[0]] || PLURAL_RULES.en;
    const v = Object.assign({ n: n }, vars || {});
    return fill(forms[Math.max(0, Math.min(forms.length - 1, rule(Number(n))))], v);
}
/** A table's "a|b|c" list as an array (the weekdays). */
function list(key, lng) { return String(raw(key, lng)).split('|'); }
/** An object whose members read the language in use each time: words('twin.title.', ['clock', 'trip']).clock -> I.t('twin.title.clock').
 *  For the modules' old constant tables (TITLES, units), so code that indexes them keeps working. */
function words(prefix, names) {
    const o = {};
    names.forEach((n) => Object.defineProperty(o, n, { enumerable: true, get: () => t(prefix + n) }));
    return o;
}

// ---- app.json: the structural keys (kept the same as kit/tools/app_i18n.py, bench/test-i18n.js checks the two agree) -----------
/** Every text of an app.json that a person reads, as [key, getter path] - the key names the place, never the text. */
function specKeys(spec) {
    const id = spec.id, out = [];
    out.push([id + '.title', ['title']]);
    (spec.screens || []).forEach((sc, i) => {
        if (typeof sc.title === 'string') out.push([id + '.screen.' + sc.name, ['screens', i, 'title']]);
        (sc.buttons || []).forEach((b, j) => { if (b[1]) out.push([id + '.btn.' + b[0], ['screens', i, 'buttons', j, 1]]); });
        (sc.items || []).forEach((it, j) => {
            if (it[0] !== 'setting' && it[0] !== 'settings' && typeof it[2] === 'string' && it[2]) out.push([id + '.item.' + it[1], ['screens', i, 'items', j, 2]]);
        });
    });
    // a group's heading is keyed by the first setting of its run; every setting of the run carries the same text (the build
    // starts a new heading wherever the text changes)
    let group = null, groupKey = null;
    (spec.settings || []).forEach((s, i) => {
        if (s.group && s.group !== group) groupKey = id + '.group.' + s.key;
        group = s.group || null;
        if (s.group) out.push([groupKey, ['settings', i, 'group']]);
        if (s.key === PREF_KEY) return;           // the language row: kit.lang.* (the same words in every app)
        out.push([id + '.set.' + s.key, ['settings', i, 'label']]);
        (s.options || []).forEach((o, j) => out.push([id + '.set.' + s.key + '.' + o[0], ['settings', i, 'options', j, 1]]));
        Object.keys(s.labels || {}).forEach((k) => out.push([id + '.set.' + s.key + '.' + k, ['settings', i, 'labels', k]]));
        if (s.unit) out.push([id + '.set.' + s.key + '.unit', ['settings', i, 'unit']]);
    });
    return out;
}
function setPath(o, p, v) { let x = o; for (let i = 0; i < p.length - 1; i++) x = x[p[i]]; x[p[p.length - 1]] = v; }
function getPath(o, p) { let x = o; for (let i = 0; i < p.length; i++) { if (x === null || x === undefined) return undefined; x = x[p[i]]; } return x; }
/** The language row's own texts (kit.lang.*): the same in every app. */
function langSetting(s, lng) {
    s.label = tl(lng, 'kit.lang');
    (s.options || []).forEach((o) => { o[1] = tl(lng, 'kit.lang.' + o[0]); });
}
/**
 * Write the texts of `lng` into the app spec IN PLACE (the kit's SPEC object: its settings rows, the drawn settings sheet and
 * Settings.display read it). The source texts are remembered on the first call, so a key missing in every table keeps the
 * app.json text.
 */
function localizeSpec(spec, lng) {
    if (!spec) return spec;
    const L = lng || state.lang;
    if (!spec.__i18nSource) {
        const src = {};
        specKeys(spec).forEach((k) => { if (!Object.prototype.hasOwnProperty.call(src, k[0])) src[k[0]] = getPath(spec, k[1]); });
        Object.defineProperty(spec, '__i18nSource', { value: src, enumerable: false });
    }
    specKeys(spec).forEach((k) => {
        const T = TABLES[L], D = TABLES[DEFAULT];
        const v = T && Object.prototype.hasOwnProperty.call(T, k[0]) ? T[k[0]] : D && Object.prototype.hasOwnProperty.call(D, k[0]) ? D[k[0]] : spec.__i18nSource[k[0]];
        if (typeof v === 'string') setPath(spec, k[1], v);
    });
    (spec.settings || []).forEach((s) => { if (s.key === PREF_KEY) langSetting(s, L); });
    return spec;
}

// ---- the app: the setting, the head unit's language, the RHMI string bundle --------------------------------------------------
const HMICTX = 'de.bmw.infotainment.hmi.hmicontext.HMIContext';
const HMICTX_FIELD = 'currentDisplayLanguage';
const HMICTX_INSTANCE = 'HMI_CID';

/** The words the build made for the RHMI per language ({ lang: { StringId: text } }), from the package; {} on the bench's preview. */
function rhmiStrings() {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', 'rhmi.json'), 'utf8')) || {}; } catch (e) { return {}; }
}

/**
 * Wire an app (kit/runtime/mgu.js ctx) once, at the top of its start(): the setting, the head unit's language, the RHMI.
 *   opts.refresh: fn() - re-send what the kit's settings rows show (ctx.refreshSettings where the kit has it)
 * Returns the module. Never throws.
 */
function attach(ctx, opts) {
    const o = opts || {};
    if (!ctx || state.attached) return module.exports;
    state.attached = true;
    const log = ctx.log || { info() {}, warn() {} };
    const settings = ctx.settings;
    const spec = ctx.spec;
    const bundle = rhmiStrings();
    // the language whose words the HMI took from our bundles: the head unit's (the build's rule), unknown when the head unit's is
    state.bundle = hmiLang(state.hmi) || (state.hmi ? DEFAULT : null);
    state.applied = null;
    const apply = (why) => {
        try { localizeSpec(spec, state.lang); } catch (e) { log.warn('lang: spec: ' + (e && e.message || e)); }
        const want = state.lang, shown = state.applied || state.bundle;
        if (want !== shown && bundle[want]) rhmiApply(ctx, bundle[want], want, why, log);
        try { if (typeof o.refresh === 'function') o.refresh(); else if (typeof ctx.refreshSettings === 'function') ctx.refreshSettings(); } catch (e) { log.warn('lang: refresh: ' + (e && e.message || e)); }
    };
    const rhmiApply = (c, strings, lng, why, lg) => {
        const ui = c.ui, rhmi = ui && ui.rhmi;
        const states = ((spec && spec.screens) || []).filter((s) => s.kind !== 'canvas').map((s) => s.name)
            .concat(spec && spec.settings && spec.settings.length && !(spec.screens || []).some((s) => s.name === 'SETTINGS') ? ['SETTINGS'] : []);
        let comp = null;
        for (let i = 0; i < states.length && !comp; i++) { try { comp = rhmi && rhmi.getByName && rhmi.getByName(states[i]); } catch (e) { comp = null; } }
        const sb = comp && typeof comp.getStringBundle === 'function' ? comp.getStringBundle() : null;
        if (!sb || typeof sb.setStrings !== 'function') { lg.info('lang: no string bundle to write (' + why + '), the menus keep the HMI\'s words'); return; }
        state.applied = lng;
        Promise.resolve().then(() => sb.setStrings(strings)).then(() => Promise.all(states.map((n) => {
            const st = rhmi.getByName(n);
            return st && typeof st.updateResources === 'function' ? Promise.resolve(st.updateResources()).catch(() => {}) : null;
        }))).then(() => lg.info('lang: menus written in ' + lng + ' (' + Object.keys(strings).length + ' strings, ' + why + ')'))
            .catch((e) => { lg.warn('lang: menus in ' + lng + ': ' + (e && e.message || e)); });
    };
    onChange((lng, was) => { log.info('lang: language ' + was + ' -> ' + lng + ' (setting ' + state.pref + ', head unit ' + (state.hmi === null ? 'unknown' : state.hmi) + ')'); apply('changed'); });
    try {
        if (settings && typeof settings.get === 'function') {
            const v = settings.get(PREF_KEY);
            if (typeof v === 'string') { state.pref = v; state.lang = resolve(state.pref, state.hmi); }
            if (typeof settings.onChange === 'function') settings.onChange((key, value) => { if (key === PREF_KEY) setPref(value); });
        }
    } catch (e) { log.warn('lang: setting: ' + (e && e.message || e)); }
    log.info('lang: language ' + state.lang + ' (setting ' + state.pref + ', head unit ' + (state.hmi === null ? 'unknown' : state.hmi) + ', tables ' + LANGS.join('/') + ')');
    apply('start');
    // the head unit's language while the app runs (read only: the getter and the notifier). A change of it moves "auto".
    try {
        const sig = ctx.signals;
        if (o.hmi !== false && sig && typeof sig.watch === 'function') {
            const h = {};
            h[HMICTX_FIELD] = (v) => {
                const was = state.hmi;
                const now = v === null || v === undefined || v === 0 || v === 255 || v === 'KEINE_SPRACHE' || v === 'SIGNAL_UNGUELTIG' ? was : v;
                if (String(now) === String(was)) return;
                log.info('lang: head unit language ' + (typeof now === 'number' || /^[A-Z_]+$/.test(String(now)) ? String(now) : 'value of ' + String(now).length + ' chars'));
                // the HMI changes its own bundle with it
                const b = hmiLang(now) || DEFAULT;
                state.bundle = b;
                if (state.applied === b) state.applied = null;
                setHmi(now);
                if (state.lang !== (state.applied || state.bundle)) apply('head unit');
            };
            Promise.resolve().then(() => sig.watch(HMICTX, HMICTX_INSTANCE, h, log)).catch((e) => log.warn('lang: HMIContext: ' + (e && e.message || e)));
        }
    } catch (e) { log.warn('lang: HMIContext: ' + (e && e.message || e)); }
    return module.exports;
}

/** Tests: back to a fresh state (no listeners, auto, the head unit unknown unless given). */
function _reset(hmi) {
    state.pref = 'auto'; state.hmi = hmi === undefined ? null : hmi; state.lang = resolve('auto', state.hmi);
    state.listeners = []; state.attached = false; state.applied = null; state.bundle = null;
}

module.exports = {
    t, tl, plural, list, words, has, lang, setPref, setHmi, onChange, info, resolve, hmiLang, argvLang, attach, rhmiStrings,
    specKeys, localizeSpec, TABLES, LANGS, DEFAULT, PREF_KEY, PREFS: PREFS.concat(LANGS), PLURAL_RULES,
    HMICTX, HMICTX_FIELD, HMICTX_INSTANCE, _reset,
};
