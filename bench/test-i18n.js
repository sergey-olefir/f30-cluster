'use strict';
/**
 * test-i18n.js - r1120 LN: every Store app in Ukrainian and English (shared/lang.js, shared/i18n/<lang>.json,
 * kit/tools/app_i18n.py). docs/r1120/LN-REPORT.md says what each part answers.
 *
 *   BENCH_PORT=8955 node bench/test-i18n.js            (one bench at a time on BENCH_PORT; default 8955)
 *   I18N_SKIP_BENCH=1                                  the pure parts only (no bench, no builds of the bench)
 *
 *  A  the tables: the same keys in every language, the same {placeholders}, the plural forms (uk 3, en 2), no empty word
 *  B  every app.json text has its key in every table; shared/lang.js and the build agree on the keys; every key the code
 *     names exists; no key is left that nothing uses
 *  C  no Cyrillic string literal is left in the code paths converted (comments aside), nor in Twin Dial's layout
 *  D  the language rule: the setting, the head unit's (--currentLanguage, HMIContext), Авто -> uk for unknown / other
 *  E  the build: each HMI language's bundle in its words (uk_UA uk, en_GB / en_US en, every other uk), one layout for all
 *  F  the cluster (Twin Dial) in uk and en: every centre page, the car-ahead page, tab 2's fixed words and the layout's
 *     text widgets inside their boxes, every character in its atlas; the kit's cyrillic atlas holds the drawn centre words
 *  G  the safety rule in English: bench/test-twin-cc.js run with the head unit in English passes exactly as in Ukrainian;
 *     our fixed words never count as the cover of a message in either language
 *  H  each app on the bench: Авто with the head unit uk / en / de / unknown, then the setting to English and back, live:
 *     the menus' words, the RHMI bundle written only when needed, the kit's rows; screenshots in bake/work/r1120/i18n/
 *  I  Node 8.16 syntax of every file this round touched
 *
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT) || 8955;
const BASE = 'http://127.0.0.1:' + PORT;
const SHOTS = path.join(ROOT, 'bake', 'work', 'r1120', 'i18n');
const APPS = ['f30_cluster', 'twin_dial', 'signal_probe', 'driver_profiles'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
function section(s) { console.log(s); }

const I = require(path.join(ROOT, 'shared', 'lang.js'));
const T = {};
fs.readdirSync(path.join(ROOT, 'shared', 'i18n')).filter((f) => f.endsWith('.json')).forEach((f) => { T[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'i18n', f), 'utf8')); });
const LANGS = Object.keys(T);
const CYR = /[Ѐ-ӿ]/;

/* ------------------------------------------------------------------ A: the tables ---------------------------------- */
section('A. the tables');
{
    ok(LANGS.indexOf('uk') >= 0 && LANGS.indexOf('en') >= 0, 'tables: ' + LANGS.join(', ') + ' (uk is the default: ' + I.DEFAULT + ')');
    const all = new Set();
    LANGS.forEach((L) => Object.keys(T[L]).forEach((k) => all.add(k)));
    const gaps = [];
    LANGS.forEach((L) => all.forEach((k) => { if (!Object.prototype.hasOwnProperty.call(T[L], k)) gaps.push(L + ':' + k); }));
    ok(!gaps.length, 'every key in every table (' + all.size + ' keys)' + (gaps.length ? ': missing ' + gaps.slice(0, 8).join(', ') : ''));
    const ph = (s) => (String(s).match(/\{[A-Za-z0-9_]+\}/g) || []).sort().filter((x, i, a) => a.indexOf(x) === i).join();
    const badPh = [], empty = [], forms = [];
    all.forEach((k) => {
        const u = T.uk[k], e = T.en[k];
        if (u === undefined || e === undefined) return;
        if (ph(u) !== ph(e)) badPh.push(k + ' (' + ph(u) + ' / ' + ph(e) + ')');
        LANGS.forEach((L) => { if (T[L][k] === '' && k !== 'twin.page.map') empty.push(L + ':' + k); });
        if (k === 'twin.weekdays') return;
        const nu = String(u).split('|').length, ne = String(e).split('|').length;
        if (nu > 1 || ne > 1) { if (!(nu === 3 && ne === 2)) forms.push(k + ' uk ' + nu + ' en ' + ne); }
    });
    ok(!badPh.length, 'the same {placeholders} in every language' + (badPh.length ? ': ' + badPh.slice(0, 6).join('; ') : ''));
    ok(!empty.length, 'no empty word (twin.page.map is the map page\'s empty title on purpose)' + (empty.length ? ': ' + empty.join(', ') : ''));
    ok(!forms.length, 'plural keys: three forms in uk (one / few / many), two in en' + (forms.length ? ': ' + forms.join('; ') : ''));
    ok(T.uk['twin.weekdays'].split('|').length === 7 && T.en['twin.weekdays'].split('|').length === 7 && T.uk['twin.weekdays'].indexOf('пʼятниця') > 0,
        'the weekdays: seven in each, Sunday first, the Ukrainian apostrophe U+02BC as before');
    const latinInUk = Object.keys(T.en).filter((k) => CYR.test(T.en[k]) && !/^kit\.lang/.test(k));
    ok(!latinInUk.length, 'no Cyrillic in the English table (but the language row\'s own "Мова / Language", "Українська")' + (latinInUk.length ? ': ' + latinInUk.join(', ') : ''));
}

/* ------------------------------------------------------------------ B: the keys ------------------------------------ */
section('B. the keys');
const specs = {};
APPS.forEach((a) => { specs[a] = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', a, 'app.json'), 'utf8')); specs[a].id = specs[a].id || a; });
{
    // the build's keys (python) and shared/lang.js's must be the same list
    const py = cp.spawnSync('python3', ['-c', [
        'import json,sys', 'sys.path.insert(0, "kit/tools")', 'import app_i18n', 'out = {}',
        'for a in ' + JSON.stringify(APPS) + ':',
        '    s = json.load(open("apps/%s/app.json" % a, encoding="utf-8")); s.setdefault("id", a); app_i18n.augment(s)',
        '    out[a] = [k for k, p in app_i18n.spec_keys(s)]',
        'print(json.dumps(out))'].join('\n')], { cwd: ROOT, encoding: 'utf8' });
    const pyKeys = py.status === 0 ? JSON.parse(py.stdout) : null;
    ok(!!pyKeys, 'kit/tools/app_i18n.py lists the keys' + (py.status ? ': ' + py.stderr : ''));
    const used = new Set();
    APPS.forEach((a) => {
        const s = JSON.parse(JSON.stringify(specs[a]));
        // the settings screen the build adds by itself (app_i18n.augment)
        if (s.settings && !(s.screens || []).some((sc) => sc.settings === true || sc.kind === 'settings')) s.screens.push({ name: 'SETTINGS', kind: 'settings', title: 'Settings' });
        const js = I.specKeys(s).map((k) => k[0]);
        ok(pyKeys && JSON.stringify(js) === JSON.stringify(pyKeys[a]), a + ': shared/lang.js and the build name the same ' + js.length + ' places');
        const miss = [];
        js.forEach((k) => { used.add(k); LANGS.forEach((L) => { if (!Object.prototype.hasOwnProperty.call(T[L], k)) miss.push(L + ':' + k); }); });
        ok(!miss.length, a + ': every app.json text has its words in every table' + (miss.length ? ': ' + miss.slice(0, 8).join(', ') : ''));
        const lang = (specs[a].settings || []).filter((x) => x.key === 'lang')[0];
        ok(!!lang && lang.type === 'choice' && lang.default === 'auto' && JSON.stringify(lang.options.map((o) => o[0])) === '["auto","uk","en"]' && lang.label === 'Мова / Language',
            a + ': the setting "Мова / Language" (auto | uk | en, default auto)');
        const placed = (specs[a].screens || []).some((sc) => (sc.items || []).some((it) => it[0] === 'setting' && it[1] === 'lang'));
        ok(placed, a + ': the language row is on a menu screen of its own ("setting", "lang")');
        ok(specs[a].i18n === true && (specs[a].shared || []).indexOf('lang.js') >= 0, a + ': app.json "i18n": true, "shared" has lang.js');
        const hc = (specs[a].signals || {})[I.HMICTX];
        if (a === 'signal_probe') ok(!hc || !hc.currentDisplayLanguage, a + ': declares only its probe table\'s fields: Авто from --currentLanguage alone (no HMIContext.currentDisplayLanguage)');
        else ok(hc && hc._instances === 'HMI_CID' && hc.currentDisplayLanguage === 'rs', a + ': reads HMIContext.currentDisplayLanguage (rs, HMI_CID; getter 3, notifier 32771)');
    });
    ['kit.lang', 'kit.lang.auto', 'kit.lang.uk', 'kit.lang.en', 'kit.default'].forEach((k) => used.add(k));
    // every key the code names (a quoted key of a known family), and the families built at run time
    const CODE = codeFiles();
    const named = new Set(), prefixes = new Set();
    const FAM = /^(kit|menu|gallery|probe|dp|twin|fv|f30|wb|ps|signal_probe|driver_profiles|twin_dial|f30_cluster)\.[A-Za-z0-9_.]*$/;     // r1120 PS: + wb (the 6WB's printing), ps (the profile line)
    CODE.forEach((f) => {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        literals(src).forEach((l) => { if (FAM.test(l.v)) { if (/\.$/.test(l.v)) prefixes.add(l.v); else named.add(l.v); } });
    });
    const layout = fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'hud', 'layouts', 'twin.json'), 'utf8');
    (layout.match(/\{\{word:([A-Za-z0-9_.]+)\}\}/g) || []).forEach((m) => named.add(m.slice(7, -2)));
    const unknown = Array.from(named).filter((k) => !Object.prototype.hasOwnProperty.call(T.uk, k) && !Array.from(prefixes).some((p) => k.indexOf(p) === 0 && T.uk[k] !== undefined));
    ok(!unknown.length, 'every key the code and the layout name exists (' + named.size + ' named, ' + prefixes.size + ' families: ' + Array.from(prefixes).join(' ') + ')' + (unknown.length ? ': ' + unknown.join(', ') : ''));
    named.forEach((k) => used.add(k));
    const unused = Object.keys(T.uk).filter((k) => !used.has(k) && !Array.from(prefixes).some((p) => k.indexOf(p) === 0));
    ok(!unused.length, 'no word is left that nothing uses' + (unused.length ? ': ' + unused.join(', ') : ''));
}

/** The JS files this round converted (their every text a person reads goes through shared/lang.js). */
function codeFiles() {
    return ['shared/menu.js', 'shared/gallery.js', 'shared/hud.js', 'shared/diag_settings.js', 'shared/twin_tokens.js', 'shared/twin_pages.js',
        'shared/twin_front.js', 'shared/twin_cc.js', 'shared/twin_limit.js', 'shared/twin_tabs.js', 'shared/front_vehicle.js', 'shared/road_shields.js', 'shared/lang.js',
        'apps/f30_cluster/main.js', 'apps/twin_dial/main.js', 'apps/signal_probe/main.js', 'apps/signal_probe/menu.js', 'apps/signal_probe/fields.js',
        'apps/signal_probe/probe.js', 'apps/signal_probe/recorder.js', 'apps/driver_profiles/main.js', 'apps/driver_profiles/screens.js',
        'apps/driver_profiles/format.js', 'apps/driver_profiles/avatars.js', 'apps/driver_profiles/profiles.js',
        'shared/profile_settings.js', 'shared/units.js'];      // r1120 PS
}

/**
 * The string literals of a JS source ('...', "...", `...` with its ${} parts left out), comments and regular expressions
 * skipped: [{ v, line }]. A small lexer, enough for this code base.
 */
function literals(src) {
    const out = [];
    let i = 0, line = 1, prev = '';
    const n = src.length;
    const regexOk = () => !prev || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /\b(return|typeof|case|in|of|delete|void|throw|new|else)$/.test(prev);
    while (i < n) {
        const c = src[i];
        if (c === '\n') { line++; i++; continue; }
        if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
        if (c === '\'' || c === '"' || c === '`') {
            const q = c, start = line;
            let v = '';
            i++;
            while (i < n && src[i] !== q) {
                if (src[i] === '\\') { v += src[i] + src[i + 1]; i += 2; continue; }
                if (q === '`' && src[i] === '$' && src[i + 1] === '{') { let d = 1; i += 2; while (i < n && d) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; } continue; }
                if (src[i] === '\n') line++;
                v += src[i]; i++;
            }
            i++;
            out.push({ v: v, line: start });
            prev = 'x';
            continue;
        }
        if (c === '/' && regexOk()) {
            i++;
            let cls = false;
            while (i < n && (cls || src[i] !== '/') && src[i] !== '\n') { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i++; }
            i++;
            while (i < n && /[a-z]/.test(src[i])) i++;
            prev = 'x';
            continue;
        }
        if (!/\s/.test(c)) {
            if (/[A-Za-z0-9_$]/.test(c)) { let w = ''; while (i < n && /[A-Za-z0-9_$]/.test(src[i])) w += src[i++]; prev = w; continue; }
            prev = c;
        }
        i++;
    }
    return out;
}

/* ------------------------------------------------------------------ C: no Cyrillic literal ------------------------- */
section('C. no Cyrillic literal left');
{
    // road_shields.js: the car's own road-number letters (М Н Р Т Е) folded to Latin - data the car sends, never a word of ours
    // apps/signal_probe/fields.js: each set's "uk" name feeds design/car/probe_fields.json (the car-session tools), never the screen
    const ALLOW = { 'shared/road_shields.js': /^[МНРТЕ]$/, 'shared/lang.js': /^(UKRAINISCH)$/,
        'apps/signal_probe/fields.js': new RegExp('^(' + require(path.join(ROOT, 'apps', 'signal_probe', 'fields.js')).SETS.map((x) => x.uk).join('|') + ')$') };
    const left = [];
    codeFiles().forEach((f) => {
        literals(fs.readFileSync(path.join(ROOT, f), 'utf8')).forEach((l) => {
            if (CYR.test(l.v) && !(ALLOW[f] && ALLOW[f].test(l.v))) left.push(f + ':' + l.line + ' ' + JSON.stringify(l.v.slice(0, 40)));
        });
    });
    ok(!left.length, 'no Cyrillic string literal in the ' + codeFiles().length + ' converted files (comments aside; road_shields.js\'s fold of the car\'s road letters and fields.js\'s set names for design/car/probe_fields.json are data)' + (left.length ? ': ' + left.slice(0, 10).join('; ') : ''));
    const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'hud', 'layouts', 'twin.json'), 'utf8'));
    const cyrL = [];
    (function walk(o, p) {
        if (typeof o === 'string') { if (CYR.test(o) && !/^_about|_about$/.test(p)) cyrL.push(p + ' ' + o); return; }
        if (o && typeof o === 'object') Object.keys(o).forEach((k) => walk(o[k], p + '.' + k));
    })(layout, '');
    ok(!cyrL.length, 'Twin Dial\'s layout carries no word of its own: every word is a {{word:...}} or a token (design/gen_twin.py)' + (cyrL.length ? ': ' + cyrL.slice(0, 5).join('; ') : ''));
    // the self-test of the lexer: a literal is found, a comment and a regex are not
    const probe = literals("// 'не це'\nconst a = 'так'; /* \"ні\" */ const r = /[а-я]'/; const b = `x${'y'}z`;");
    ok(probe.map((l) => l.v).join('|') === 'так|xz', 'the literal finder sees strings only (its own check: ' + JSON.stringify(probe.map((l) => l.v)) + ')');
}

/* ------------------------------------------------------------------ D: the language rule --------------------------- */
section('D. the language rule');
{
    ok(I.resolve('auto', null) === 'uk' && I.resolve('auto', 'de_DE') === 'uk' && I.resolve('auto', 'fr_FR') === 'uk', 'Авто with the head unit unknown or in a language we have no table for: Ukrainian');
    ok(I.resolve('auto', 'uk_UA') === 'uk' && I.resolve('auto', 'en_GB') === 'en' && I.resolve('auto', 'en_US') === 'en', 'Авто follows the head unit: uk_UA -> uk, en_GB / en_US -> en');
    ok(I.resolve('en', 'uk_UA') === 'en' && I.resolve('uk', 'en_GB') === 'uk', 'Українська / English win over the head unit');
    ok(I.hmiLang(37) === 'uk' && I.hmiLang(2) === 'en' && I.hmiLang(3) === 'en' && I.hmiLang('UKRAINISCH') === 'uk' && I.hmiLang('ENGLISCH__US') === 'en' && I.hmiLang(14) === null && I.hmiLang(1) === null,
        'HMIContext.currentDisplayLanguage by number or by name (CommonTypes.Language: 37 UKRAINISCH, 2 / 3 English, 14 Russian -> none of ours)');
    ok(I.argvLang(['node', 'app.js', '--startReason', 'AUTOSTART', '--currentLanguage', 'uk_UA', '--VIN', 'x']) === 'uk_UA' && I.argvLang(['node']) === null,
        'MainApp\'s start argument --currentLanguage (the car\'s process table, 2026-11-14: "--currentLanguage uk_UA")');
    const P = (n) => I.plural('probe.rec.samples', n, null, 'uk');
    ok([1, 2, 5, 11, 12, 21, 22, 25, 111, 0].map(P).join('; ') === '1 зразок; 2 зразки; 5 зразків; 11 зразків; 12 зразків; 21 зразок; 22 зразки; 25 зразків; 111 зразків; 0 зразків',
        'Ukrainian plurals: one / few / many (' + [1, 2, 5, 11, 21, 22].map(P).join(', ') + ')');
    ok(I.plural('probe.rec.samples', 1, null, 'en') === '1 sample' && I.plural('probe.rec.samples', 2, null, 'en') === '2 samples', 'English plurals: one / other');
    // live: the listeners run once per change, auto follows a new head-unit language, an explicit choice does not
    I._reset('uk_UA');
    const seen = [];
    I.onChange((l, was) => seen.push(was + '>' + l));
    I.setHmi('ENGLISCH__UK'); I.setPref('uk'); I.setHmi(37); I.setPref('auto'); I.setHmi(2); I.setPref('en'); I.setPref('en');
    ok(seen.join(' ') === 'uk>en en>uk uk>en', 'a change of the head unit moves Авто only; the listeners hear each real change once (' + seen.join(' ') + ')');
    I._reset();
    ok(I.t('menu.status.on', { name: '6WB Comfort' }) === 'Увімк.: 6WB Comfort' && I.tl('en', 'menu.status.on', { name: '6WB Comfort' }) === 'On: 6WB Comfort' && I.t('no.such.key') === 'no.such.key',
        'lookup: the language in use, a given language, a missing key answers itself (never a throw)');
}

/* ------------------------------------------------------------------ E: the build ----------------------------------- */
section('E. the build: one bundle per HMI language');
const built = {};
{
    const H = ['uk_UA', 'en_GB', 'en_US', 'de_DE', 'ru_RU', 'zh_CN'];
    APPS.forEach((a) => {
        const r = cp.spawnSync('python3', ['kit/tools/build.py', a], { cwd: ROOT, encoding: 'utf8' });
        ok(r.status === 0 && !/i18n: \d+ app\.json text/.test(r.stdout), a + ': builds, every app.json text in every table' + (r.status ? ': ' + (r.stderr || r.stdout).slice(-300) : ''));
        if (r.status) return;
        const dir = path.join(ROOT, 'dist', a);
        const b = {};
        H.forEach((h) => { b[h] = JSON.parse(fs.readFileSync(path.join(dir, 'rhmiData', 'strings', h + '.json'), 'utf8')); });
        const pk = JSON.parse(fs.readFileSync(path.join(dir, 'source', 'rhmiData', 'variantGroups', 'Common', 'texts', 'uk_UA.json'), 'utf8'));
        const rhmi = JSON.parse(fs.readFileSync(path.join(dir, 'source', 'javascript', 'i18n', 'rhmi.json'), 'utf8'));
        built[a] = { b, rhmi, dir };
        const keys = (o) => Object.keys(o).sort().join();
        ok(H.every((h) => keys(b[h]) === keys(b.uk_UA)) && keys(pk) === keys(b.uk_UA), a + ': the same ' + Object.keys(b.uk_UA).length + ' StringIds in every bundle (installed and package format)');
        ok(Object.keys(b.uk_UA).length <= 1024, a + ': ' + Object.keys(b.uk_UA).length + ' strings, inside the HMI\'s 1024');
        const strip = (o) => { const x = {}; Object.keys(o).filter((k) => !/^SID_CN_DYNAMIC_/.test(k)).forEach((k) => { x[k] = o[k]; }); return JSON.stringify(x); };
        ok(strip(b.uk_UA) === JSON.stringify(rhmi.uk) && strip(b.en_GB) === JSON.stringify(rhmi.en) && strip(b.en_US) === JSON.stringify(rhmi.en) &&
            strip(b.de_DE) === JSON.stringify(rhmi.uk) && strip(b.ru_RU) === JSON.stringify(rhmi.uk), a + ': uk_UA in Ukrainian, en_GB / en_US in English, every other HMI language in Ukrainian (Авто\'s rule)');
        const id = a.toUpperCase();
        const shot = (lang) => { const s = lang === 'uk' ? b.uk_UA : b.en_GB; return Object.keys(s).map((k) => s[k]).join('\n'); };
        const ukW = shot('uk'), enW = shot('en');
        const expect = { f30_cluster: ['Налаштування', 'Settings'], twin_dial: ['Налаштування', 'Settings'], signal_probe: ['Набір для запису', 'Set to record'], driver_profiles: ['Додати локальний профіль', 'Add a local profile'] }[a];
        ok(ukW.indexOf(expect[0]) >= 0 && enW.indexOf(expect[1]) >= 0 && enW.indexOf(expect[0]) < 0, a + ': "' + expect[0] + '" / "' + expect[1] + '" in their bundles');
        const enCyr = Object.keys(b.en_GB).filter((k) => CYR.test(b.en_GB[k]) && !/Мова|Українська/.test(b.en_GB[k]));
        ok(!enCyr.length, a + ': the English bundle has no Cyrillic but the language row' + (enCyr.length ? ': ' + enCyr.slice(0, 5).map((k) => k + '=' + b.en_GB[k]).join('; ') : ''));
        ok(fs.existsSync(path.join(dir, 'source', 'javascript', 'lang.js')) && fs.existsSync(path.join(dir, 'source', 'javascript', 'i18n', 'uk.json')) && fs.existsSync(path.join(dir, 'source', 'javascript', 'i18n', 'en.json')),
            a + ': the package carries lang.js and the tables');
        const ad = JSON.parse(fs.readFileSync(path.join(dir, 'source', 'javascript', 'kit', 'app-spec.json'), 'utf8'));
        ok(ad.screens.some((sc) => sc.name === 'SETTINGS' || (sc.items || []).some((it) => it[1] === 'lang')), a + ': the runtime spec knows the screens to refresh');
        void id;
    });
    // the fixed-language kit builds are untouched: --language ru still takes kit/localization (absent in this repo, as before)
    const ru = cp.spawnSync('python3', ['kit/tools/build.py', '--language', 'zh-CN', 'signal_probe'], { cwd: ROOT, encoding: 'utf8' });
    const zh = fs.existsSync(path.join(ROOT, 'dist', 'signal_probe', 'source', 'javascript', 'i18n'));
    ok(ru.status === 0 && !zh, 'a fixed-language build (--language zh-CN) runs as before: no per-language bundles, no tables');
    cp.spawnSync('python3', ['kit/tools/build.py', 'signal_probe'], { cwd: ROOT, encoding: 'utf8' });
}

/* ------------------------------------------------------------------ F: the cluster in uk and en -------------------- */
section('F. Twin Dial\'s cluster in uk and en: every word inside its box, every character in its atlas');
{
    const S = require('./twin-centre-states');
    const R = S.rig();
    const L = R.i18n;
    const FONTDIR = path.join(ROOT, 'apps', 'twin_dial', 'hud', 'fonts');
    const atlas = {};
    const glyphs = (n) => atlas[n] || (atlas[n] = JSON.parse(fs.readFileSync(path.join(FONTDIR, n + '.json'), 'utf8')).glyphs);
    ['uk', 'en'].forEach((lang) => {
        L.setPref(lang);
        const bad = [], unresolved = [], missing = [], texts = new Set(), ours = new Set();
        // the page items whose text is ours (a word of the tables, or a token that answers with our words and numbers only)
        const OURS = /^\{\{(word:[^}]+|td:(pgTitle|pgNavSub|pgCalc|pgTripFooter|pgTripMeta|pgPhoneLine1|pgCallWho|pgRouteFoot|pgGuideUnit|pgRouteUnit|pgTechU\d|pgWeekday|pgGuideFoot|pgRouteEta|pgGuideDist|pgRouteDist|pgTime|pgDate|pgTripCons|pgTripSpeed|pgTripWay|pgTechV\d|pgTyreP\d|pgTyreT\d))\}\}$/;
        Object.keys(S.STATES).forEach((id) => {
            const h = S.make(R, id), r = S.render(R, h);
            r.ink.forEach((i) => {
                const b = i.box;
                if (b[0] < 729 || b[2] > 1191) bad.push(id + '/' + i.id + ' x ' + Math.round(b[0]) + '..' + Math.round(b[2]));
                if (b[1] < 248 || b[3] > 595) bad.push(id + '/' + i.id + ' y ' + Math.round(b[1]) + '..' + Math.round(b[3]));
            });
            const spec = R.widget.pages[r.page];
            R.pages.resolveItems(h, spec ? spec.items : []).forEach((q) => {
                const it = q.it;
                const strs = [[q.s, it.f]].concat((q.parts || []).map((x, k) => [x.s, it.parts[k].f])).concat(it.k === 'frac' ? [[q.top, 'u15'], [q.bot, 'u15']] : []);
                strs.forEach((p) => {
                    const t = p[0], f = p[1];
                    if (typeof t !== 'string' || !t) return;
                    texts.add(t);
                    const tpl = it.k === 'frac' ? '{{word:x}}' : it.k === 't' ? it.s : null;
                    if (tpl && OURS.test(tpl)) ours.add(t);
                    if (/\{\{/.test(t)) unresolved.push(id + '/' + it.id + ' ' + t);
                    const name = f && R.pages.fontName(f);
                    if (!name) return;
                    Array.from(t).forEach((c) => { if (c !== ' ' && !glyphs(name)[c]) missing.push(id + '/' + it.id + ' ' + JSON.stringify(c) + ' in ' + name); });
                });
            });
            if (lang === 'en') {
                // a picture per state for the eye: bake/work/r1120/i18n/twin_page_<state>_<lang>.png (git-ignored)
                try { writePng(path.join(SHOTS, 'twin_page_' + id + '_' + lang + '.png'), R.widget.w, R.widget.h, r.buf || (r.out && r.out.buf)); } catch (e) { /* the picture is a convenience */ }
            }
            if (lang === 'uk') { try { writePng(path.join(SHOTS, 'twin_page_' + id + '_' + lang + '.png'), R.widget.w, R.widget.h, r.buf || (r.out && r.out.buf)); } catch (e) { /* idem */ } }
        });
        ok(!bad.length, lang + ': every centre page state (' + Object.keys(S.STATES).length + ') draws inside the window between the dials' + (bad.length ? ': ' + bad.slice(0, 6).join('; ') : ''));
        ok(!unresolved.length, lang + ': no {{token}} left on any page' + (unresolved.length ? ': ' + unresolved.slice(0, 4).join('; ') : ''));
        ok(!missing.length, lang + ': every character of every page in its Noto atlas' + (missing.length ? ': ' + Array.from(new Set(missing)).slice(0, 6).join('; ') : ''));
        const wrong = Array.from(ours).filter((t) => lang === 'en' && CYR.test(t));
        ok(!wrong.length, lang + ': no Cyrillic word of ours on an English page (' + ours.size + ' texts of ours; the car\'s own station, track and road names are the car\'s)' + (wrong.length ? ': ' + wrong.slice(0, 5).join(', ') : ''));
        // the layout's text widgets with a word: tab_range_u ({{td:uKm}}) and the bottom row's units, inside their boxes
        const W = R.layout.widgets.filter((w) => w.type === 'text' && /\{\{td:(uKm|rowL1u|rowR1u)\}\}/.test(w.text));
        const tr = require(path.join(R.dir, 'hud_text.js'));
        const over = [];
        W.forEach((w) => {
            const t = lang === 'en' ? L.tl('en', 'twin.u.km') : L.tl('uk', 'twin.u.km');
            const wpx = tr.measure(t, w.font, w.spacing || 0);
            if (wpx > w.w) over.push(w.id + ' "' + t + '" ' + wpx + ' > ' + w.w);
        });
        ok(W.length >= 1 && !over.length, lang + ': the unit "' + L.tl(lang, 'twin.u.km') + '" fits the text widgets that show it (' + W.map((w) => w.id + ' w ' + w.w).join(', ') + ')' + (over.length ? ': ' + over.join('; ') : ''));
        // the car ahead (twin_front.js): the page inside its layer, the gap and the cruise text never touch
        const TF = require(path.join(R.dir, 'twin_front.js'));
        const lay = { x: 729, y: 298, w: 462, h: 297 };
        // (as bench/test-front-vehicle.js: a long limiter text beside the gap word; the calibrated "1.8 s · ..." with the shorter cruise text)
        const views = [{ state: 'seen', present: true, level: 3, closing: 0, word: L.t('fv.mid') }, { state: 'absent', absent: true, present: false }, { state: 'none', present: false }];
        const th = R.THEMES && R.THEMES.twin ? R.THEMES.twin : null;
        const fvBad = [];
        views.concat([Object.assign({ timeGap: 1.84, cruiseS: L.t('fv.cruise') + ' 90 ' + L.t('twin.u.kmh') }, views[0])]).forEach((v) => {
            const out = TF.paintPage(lay, th, v, 3, { s: v.cruiseS || L.t('fv.limiter') + ' 110 ' + L.t('twin.u.kmh'), c: 'ready' });
            out.ink.forEach((i) => { if (i.box[0] < lay.x || i.box[2] > lay.x + lay.w) fvBad.push(v.state + '/' + i.id + ' ' + Math.round(i.box[0]) + '..' + Math.round(i.box[2])); });
            const g = out.ink.filter((i) => i.id === 'gap')[0], c = out.ink.filter((i) => i.id === 'cruise')[0];
            if (g && c && g.box[2] + 8 > c.box[0]) fvBad.push('gap and cruise touch (' + Math.round(c.box[0] - g.box[2]) + ' px)');
        });
        ok(!fvBad.length, lang + ': the car-ahead page ("' + L.t('fv.title') + '", "' + L.t('fv.notSeen') + '", "' + L.t('twin.noData') + '") inside its layer, the gap and a long limiter text apart' + (fvBad.length ? ': ' + fvBad.join('; ') : ''));
        const fvMiss = [];
        TF.STRINGS.forEach((s) => Array.from(s).forEach((ch) => { ['td_title', 'td_body', 'td_val'].forEach((f) => { if (ch !== ' ' && !glyphs(f)[ch]) fvMiss.push(f + ' ' + ch); }); }));
        ok(!fvMiss.length, lang + ': every word of the car-ahead page, in every language (' + TF.STRINGS.length + ' strings), is in its three atlases' + (fvMiss.length ? ': ' + fvMiss.slice(0, 5).join(', ') : ''));
        // tab 2's fixed words (twin_cc.js): the pointer's two lines and the empty sheet in td_msg / td_val, every "why" line in td_tab
        const CC = require(path.join(R.dir, 'twin_cc.js'));
        const meas = (f, t) => tr.measure(t, f, 0);
        const ccBad = [];
        CC.POINTER.lines.forEach((t) => { if (meas('td_val', t) > CC.HEAD.maxW) ccBad.push('pointer "' + t + '"'); Array.from(t).forEach((c) => { if (c !== ' ' && !glyphs('td_val')[c]) ccBad.push('td_val ' + c); }); });
        Object.keys(CC.WHY.texts).forEach((k) => { const t = CC.WHY.texts[k]; if (meas('td_tab', t) > CC.SHEET.w - 20) ccBad.push('why ' + k + ' "' + t + '" ' + meas('td_tab', t)); });
        if (meas('td_val', CC.EMPTY.text) > CC.SHEET.w - 20) ccBad.push('empty "' + CC.EMPTY.text + '"');
        ok(!ccBad.length, lang + ': tab 2\'s own words ("' + CC.POINTER.lines.join(' ') + '", "' + CC.EMPTY.text + '", ' + Object.keys(CC.WHY.texts).length + ' reasons) fit the sheet' + (ccBad.length ? ': ' + ccBad.join('; ') : ''));
        // the weekday and the cruise readout's unit
        ok(R.twin.WEEKDAYS[5] === L.list('twin.weekdays')[5] && R.twin.TITLES.clock === L.t('twin.tab.clock'), lang + ': the weekdays and the titles read the language in use (' + R.twin.WEEKDAYS[5] + ', ' + R.twin.TITLES.clock + ')');
    });
    L.setPref('auto');
    // the centre screen's drawn words (the gallery, the menu's picture, the kit's bar): the kit's cyrillic atlas has them all
    const cyr = JSON.parse(fs.readFileSync(path.join(ROOT, 'kit', 'runtime', 'fonts', 'cyrillic.json'), 'utf8'));
    const drawn = Object.keys(T.uk).filter((k) => /^(gallery\.|menu\.bmwCluster|menu\.tag\.|f30\.tag\.|twin\.tag\.|f30_cluster\.(btn|set\.hudLayout)|f30_cluster\.screen\.GALLERY)/.test(k));
    const cmiss = [];
    drawn.forEach((k) => LANGS.forEach((lg) => Array.from(T[lg][k].toUpperCase() + T[lg][k]).forEach((c) => {
        if (CYR.test(T[lg][k]) && !cyr.sizes.every((s) => s.glyphs[String(c.codePointAt(0))])) cmiss.push(k + ' ' + c);
    })));
    ok(cyr.family === 'cyrillic' && cyr.sizes.length === 2 && !cmiss.length, 'the kit\'s "cyrillic" atlas (Noto 19 + 33) has every letter of the ' + drawn.length + ' words drawn on the centre screen, capitals too' + (cmiss.length ? ': ' + cmiss.slice(0, 6).join(', ') : ''));
    ok(cyr.sizes.every((s) => s.atlasW % 4 === 0), 'its atlases\' widths are a multiple of 4 (' + cyr.sizes.map((s) => s.atlasW + 'x' + s.atlasH).join(', ') + '; centre screen only, never a cluster-render asset)');
    // f30_cluster draws no word of the tables on the cluster (its words are the 6WB's dial printing: see the report)
    const f30Words = fs.readdirSync(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts')).filter((f) => /\{\{word:/.test(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts', f), 'utf8')));
    ok(!f30Words.length, 'f30_cluster\'s layouts take no word from the tables (their "km/h", "READY", "1/min x 1000" are the 6WB\'s printing, Latin-only fonts)');
}

/** An RGBA buffer to a PNG (the kit's own encoder). */
function writePng(file, w, h, buf) {
    if (!buf) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const { Canvas } = require(path.join(ROOT, 'kit', 'runtime', 'canvas.js'));
    const c = new Canvas(w, h).clear('#000000');
    for (let p = 0; p < w * h; p++) {
        const a = buf[p * 4 + 3] / 255;
        c.d[p * 4] = Math.round(buf[p * 4] * a); c.d[p * 4 + 1] = Math.round(buf[p * 4 + 1] * a); c.d[p * 4 + 2] = Math.round(buf[p * 4 + 2] * a); c.d[p * 4 + 3] = 255;
    }
    fs.writeFileSync(file, c.png());
}

/* ------------------------------------------------------------------ G: the safety rule in English ------------------ */
section('G. the safety rule in English');
{
    const run = (lang) => {
        const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'test-twin-cc.js'), '--currentLanguage', lang], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
        const m = (r.stdout || '').match(/(\d+) passed, (\d+) failed\s*$/);
        return { status: r.status, pass: m ? Number(m[1]) : -1, fail: m ? Number(m[2]) : -1, tail: (r.stdout || '').split('\n').filter((l) => /FAIL/.test(l)).slice(0, 4).join(' | ') };
    };
    const uk = run('uk_UA'), en = run('en_GB');
    ok(uk.fail === 0 && uk.pass > 0, 'bench/test-twin-cc.js with the head unit in Ukrainian: ' + uk.pass + ' passed, ' + uk.fail + ' failed' + (uk.tail ? ' (' + uk.tail + ')' : ''));
    ok(en.fail === 0 && en.pass === uk.pass, 'the same machine with the head unit in English: ' + en.pass + ' passed, ' + en.fail + ' failed (the cover still needs the WHOLE text of that exact message, the car\'s own)' + (en.tail ? ' (' + en.tail + ')' : ''));
    // our fixed words are never a cover: the pointer card has no key in any language, and an English message whose name is
    // our own pointer word is still only covered by its own card
    const S = require('./twin-centre-states');
    const R = S.rig();
    const CC = require(path.join(R.dir, 'twin_cc.js'));
    const tr = require(path.join(R.dir, 'hud_text.js'));
    const deps = { measure: (f, t) => tr.measure(t, f, 0), has: (f, ch) => !!tr.loadFont(f).metrics.glyphs[ch] };
    const res = [];
    ['uk', 'en'].forEach((lang) => {
        R.i18n.setPref(lang);
        const msg = { id: 15, name: R.i18n.t('twin.cc.pointer1'), color: 'white', key: '15\u0001' + R.i18n.t('twin.cc.pointer1') };
        const pointer = CC.layoutTab2({ cand: null, shown: true, sev: 3, entries: [msg] }, deps);
        const card = CC.layoutTab2({ cand: msg, shown: true, sev: 1, entries: [msg] }, deps);
        res.push(lang + ': pointer keys ' + JSON.stringify(pointer.card.key) + ', rows ' + pointer.rows.length + ', card covers ' + card.keys.length);
        ok(pointer.kind === 'pointer' && pointer.card.key === null && pointer.keys.indexOf(msg.key) === (pointer.rows.length ? pointer.keys.indexOf(msg.key) : -1) &&
            card.keys.length === 1 && card.keys[0] === CC.keyOf(msg), lang + ': a message named like our pointer ("' + msg.name + '") is covered only by its own card; the pointer itself covers nothing');
    });
    R.i18n.setPref('auto');
    void res;
}

/* ------------------------------------------------------------------ I: Node 8.16 syntax ---------------------------- */
section('I. Node 8.16 syntax of the files this round touched');
{
    const CHECK = path.join(ROOT, 'tools', 'cruise-sim', 'tests', 'stubs', 'sc2-node8-check.js');
    const files = codeFiles().concat(['kit/runtime/mgu.js', 'bench/run-app.js']).filter((f) => !/^bench\//.test(f));
    const probe = cp.spawnSync(process.execPath, ['--expose-internals', CHECK], { input: 'var a = {}; var b = a?.c;', encoding: 'utf8' });
    const avail = probe.status === 0 && !/unavailable/.test(probe.stdout);
    if (!avail) console.log('       (no acorn reachable in this Node: the syntax half is skipped)');
    else {
        ok(JSON.parse(probe.stdout).ok === false, 'the checker refuses ?. (its own control)');
        const bad = [];
        files.forEach((f) => {
            const r = JSON.parse(cp.spawnSync(process.execPath, ['--expose-internals', CHECK, path.join(ROOT, f)], { encoding: 'utf8' }).stdout);
            if (!r.ok) bad.push(f + ': ' + r.error);
            else ['flat', 'flatMap', 'fromEntries', 'matchAll', 'replaceAll', 'allSettled', 'trimStart', 'trimEnd', 'finally', 'hasOwn', 'findLast'].forEach((m) => { if (r.members.indexOf(m) >= 0) bad.push(f + ' .' + m); });
        });
        ok(!bad.length, files.length + ' files parse as ES2017 and use no newer built-in' + (bad.length ? ': ' + bad.join('; ') : ''));
    }
}

/* ------------------------------------------------------------------ H: the apps on the bench ------------------------ */
async function bench() {
    section('H. each app on the bench (port ' + PORT + ')');
    const STATUS = {
        f30_cluster: { comp: 'STATUS', uk: /^(Увімк\.: |Вимк\.|\S+( Dial)?: з’єднання|\S+( Dial)? вимк\.)/, en: /^(On: |Off|\S+( Dial)?: connecting|\S+( Dial)? off)/ },
        twin_dial: { comp: 'STATUS', uk: /^(Увімк\.: |Вимк\.|\S+( Dial)?: з’єднання|\S+( Dial)? вимк\.)/, en: /^(On: |Off|\S+( Dial)?: connecting|\S+( Dial)? off)/ },
        signal_probe: { comp: 'STATUS', uk: /^Набори: /, en: /^Sets: / },
        driver_profiles: { comp: 'STATUS', uk: /^(Активний|Читаю|Служба)/, en: /^(Active|Reading|The profile)/ },
    };
    for (const a of APPS) {
        for (const hmi of ['uk_UA', 'en_GB', 'de_DE', '']) {
            const want = hmi === 'en_GB' ? 'en' : 'uk';
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-' + a + '-'));
            const env = Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: tmp, SCREEN_DIR: tmp, BENCH_IMAGE_DIR: hmi === 'uk_UA' || hmi === 'en_GB' ? tmp : '' });
            if (hmi) env.BENCH_HMI_LANG = hmi; else delete env.BENCH_HMI_LANG;
            const server = cp.spawn(process.execPath, [path.join(__dirname, 'server.js'), a], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
            let out = '';
            server.stdout.on('data', (d) => { out += d; }); server.stderr.on('data', (d) => { out += d; });
            const label = a + ' (head unit ' + (hmi || 'unknown') + ')';
            try {
                let p = await until((q) => q && q.i18n && q.native && q.native[STATUS[a].comp] && q.native[STATUS[a].comp].text, 90000);
                ok(p && p.i18n && p.i18n.lang === want, label + ': Авто gives ' + want + (p && p.i18n ? ' (' + JSON.stringify(p.i18n) + ')' : ''));
                const st = p && p.native[STATUS[a].comp] ? p.native[STATUS[a].comp].text : '';
                ok(STATUS[a][want].test(st), label + ': the status row in ' + want + ': "' + st + '"');
                const written = p ? p.rhmi.writes : -1;
                if (hmi) ok(written === 0, label + ': the HMI\'s own bundle is already in ' + want + ': nothing written to it (' + written + ')');
                else ok(written >= 1 && p.rhmi.strings && built[a] && p.rhmi.strings[Object.keys(built[a].rhmi.uk)[0]] === built[a].rhmi.uk[Object.keys(built[a].rhmi.uk)[0]],
                    label + ': the head unit\'s language unknown: the Ukrainian words written into the bundle at start (' + written + ' write(s))');
                const langRow = p && p.spec ? p.spec.settings.filter((x) => x.key === 'lang')[0] : null;
                ok(langRow && langRow.label === 'Мова / Language' && langRow.options[0][1] === (want === 'en' ? 'Auto' : 'Авто'), label + ': the language row: "' + (langRow && langRow.label) + '" ' + JSON.stringify(langRow && langRow.options.map((o) => o[1])));
                if (hmi !== 'uk_UA') continue;
                // live: English chosen, then Авто again (no restart): the words, the kit's rows, the bundle
                await req('POST', '/click', { id: 'SET_LANG', row: 2 });
                p = await until((q) => q && q.i18n && q.i18n.lang === 'en' && q.rhmi.writes >= 1 && STATUS[a].en.test((q.native[STATUS[a].comp] || {}).text || '') && !cyrRows(q).length, 15000);
                ok(p && p.i18n.lang === 'en' && p.settings.lang === 'en', label + ': English chosen: the language is en at once (' + (p && JSON.stringify(p.i18n)) + ')');
                ok(p && STATUS[a].en.test((p.native[STATUS[a].comp] || {}).text || ''), label + ': the status row in English: "' + (p && (p.native[STATUS[a].comp] || {}).text) + '"');
                const enB = built[a] ? built[a].rhmi.en : {};
                const sid = Object.keys(enB).filter((k) => /SET_LANG|BTN_SETTINGS|_TITLE$/.test(k) && !CYR.test(enB[k]))[0];
                ok(p && p.rhmi.writes >= 1 && sid && p.rhmi.strings[sid] === enB[sid] && p.rhmi.updates >= 1, label + ': the English words written into the RHMI bundle (' + (p && p.rhmi.writes) + ' write(s), ' + (p && p.rhmi.updates) + ' screen updates; ' + sid + ' = "' + (p && p.rhmi.strings[sid]) + '")');
                const enLabels = p ? p.spec.settings.filter((x) => x.key !== 'lang').map((x) => x.label) : [];
                ok(enLabels.length === 0 || enLabels.every((l) => !CYR.test(l)), label + ': the kit\'s rows (the spec the settings rows read) in English' + (enLabels.filter((l) => CYR.test(l)).length ? ': ' + enLabels.filter((l) => CYR.test(l)).join(', ') : ''));
                const nativeCyr = p ? cyrRows(p) : [];
                ok(!nativeCyr.length, label + ': nothing the app writes to its rows is Cyrillic in English' + (nativeCyr.length ? ': ' + nativeCyr.map((n) => n + ' ' + JSON.stringify(p.native[n].text || p.native[n].cells)).slice(0, 4).join('; ') : ''));
                dumpNative(a, 'en', p);
                await req('POST', '/click', { id: 'SET_LANG', row: 0 });
                p = await until((q) => q && q.i18n && q.i18n.lang === 'uk' && STATUS[a].uk.test((q.native[STATUS[a].comp] || {}).text || '') && q.rhmi.writes >= 2, 15000);
                ok(p && p.i18n.lang === 'uk' && p.rhmi.writes >= 2 && sid && p.rhmi.strings[sid] === built[a].rhmi.uk[sid], label + ': Авто again: Ukrainian, and the Ukrainian words written back over the English ones (' + (p && p.rhmi.writes) + ' writes)');
                dumpNative(a, 'uk', p);
                // the head unit's language changing while the app runs (HMIContext.currentDisplayLanguage), Авто follows it
                // (not Signal Probe: it declares only its probe table's fields)
                if (a === 'signal_probe') { ok(!/uncaught|exited with/.test(out), label + ': the app never exited'); continue; }
                await req('POST', '/fake', { feed: { iface: I.HMICTX, field: I.HMICTX_FIELD, value: 'ENGLISCH__UK' } });
                p = await until((q) => q && q.i18n && q.i18n.lang === 'en', 8000);
                ok(p && p.i18n.lang === 'en' && p.i18n.hmi === 'ENGLISCH__UK', label + ': the head unit switched to English (HMIContext): Авто follows (' + (p && JSON.stringify(p.i18n)) + ')');
                await req('POST', '/fake', { feed: { iface: I.HMICTX, field: I.HMICTX_FIELD, value: 37 } });
                p = await until((q) => q && q.i18n && q.i18n.lang === 'uk', 8000);
                ok(p && p.i18n.lang === 'uk', label + ': and back to Ukrainian (37)');
                ok(!/uncaught|exited with/.test(out), label + ': the app never exited');
                // the theme gallery's picture in both languages (f30_cluster only: the drawn centre screen)
                if (a === 'f30_cluster') {
                    for (const lang of [['uk', 1], ['en', 2]]) {
                        await req('POST', '/click', { id: 'SET_LANG', row: lang[1] });
                        await until((q) => q && q.i18n && q.i18n.lang === lang[0], 8000);
                        await req('POST', '/click', { id: 'BTN_GALLERY' });
                        await until((q) => q && q.images && q.images.GALLERY_GFX && q.images.GALLERY_GFX.n > 0, 15000);
                        await sleep(1500);
                        try { fs.mkdirSync(SHOTS, { recursive: true }); fs.copyFileSync(path.join(tmp, 'gallery_gfx.png'), path.join(SHOTS, 'f30_gallery_' + lang[0] + '.png')); ok(true, 'f30_cluster: the theme gallery drawn in ' + lang[0] + ' (bake/work/r1120/i18n/f30_gallery_' + lang[0] + '.png)'); } catch (e) { ok(false, 'f30_cluster: the gallery picture in ' + lang[0] + ': ' + e.message); }
                        await req('POST', '/hmi', { a: 'back' });
                        await sleep(500);
                    }
                    await req('POST', '/click', { id: 'SET_LANG', row: 0 });
                }
            } catch (e) {
                ok(false, label + ': ' + (e && e.stack || e));
            } finally {
                server.kill('SIGTERM');
                await new Promise((r) => { server.on('exit', r); setTimeout(r, 4000); });
                await sleep(500);
            }
        }
    }
}
/** The rows the app wrote with a Cyrillic word in them (the language row's own words aside). */
function cyrRows(p) {
    return Object.keys(p.native || {}).filter((n) => { const v = p.native[n]; return [v.text].concat(v.cells ? Object.keys(v.cells).map((k) => v.cells[k]) : []).some((t) => typeof t === 'string' && CYR.test(t) && !/Мова|Українська|Авто/.test(t)); });
}
function dumpNative(a, lang, p) {
    if (!p) return;
    try {
        fs.mkdirSync(SHOTS, { recursive: true });
        const lines = Object.keys(p.native).sort().map((n) => { const v = p.native[n]; return n + ': ' + (v.text !== undefined ? v.text : '') + (v.cells ? ' ' + JSON.stringify(v.cells) : ''); });
        const rows = p.spec.settings.map((s) => 'SET_' + s.key.toUpperCase() + ': ' + s.label + (s.options ? ' [' + s.options.map((o) => o[1]).join(' | ') + ']' : ''));
        fs.writeFileSync(path.join(SHOTS, a + '_menus_' + lang + '.txt'), lines.concat([''], rows).join('\n') + '\n');
    } catch (e) { /* a convenience */ }
}
async function req(method, url, b) {
    const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    if (r.status === 200) return r.json();
    if (r.status !== 204) throw new Error(method + ' ' + url + ': ' + r.status);
    return null;
}
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await req('GET', '/probe'); if (fn(p)) return p; } catch (e) { /* (re)starting */ }
        await sleep(250);
    }
    return p;
}

(async () => {
    if (!process.env.I18N_SKIP_BENCH) await bench();
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
