'use strict';
/**
 * test-profile-settings.js - r1120 PS: the cluster settings follow the active driver profile, and the dial words and units
 * follow the settings (shared/profile_settings.js, shared/units.js, shared/hud.js; docs/r1120/PS-REPORT.md).
 *
 *   BENCH_PORT=8963 node bench/test-profile-settings.js     (two benches, one after the other: BENCH_PORT and BENCH_PORT + 1)
 *   PS_SKIP_BENCH=1                                          the pure parts only
 *
 *  A  the table: per profile / global covers every setting of f30_cluster and twin_dial, the diagnostics global
 *  B  the units rule (Авто / км / милі against the car's own)
 *  C  the module against a fake car (no bench): first seen = a copy, two profiles live, the event missing (the poll), global
 *     switches stay global, the setting off, a reused slot starts over, flapping = one switch, not known = the set stays,
 *     an atomic write survives a kill mid-write (simulated), only the allowed reads, no personal field in the log
 *  D  the 6WB words fit their boxes in uk / en x km / mi, every glyph in its atlas; Twin Dial's unit words too
 *  E  f30_cluster on the bench: two profiles with different themes and languages switch live (event, then the poll alone),
 *     flapping rebuilds once, uk / en x km / mi draw the right words and scale, the car's own units (Авто), pixel memory under
 *     16 MiB across switches, only the allowed reads, no personal field in the log, never exited
 *  F  twin_dial on the bench: the faces per language and unit (one pair held), the mph needle law, a profile switch swaps the
 *     faces with one rebuild, pixel memory the same in every combination
 *
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT0 = Number(process.env.BENCH_PORT) || 8963;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
const section = (s) => console.log(s);
const MIB16 = 16 * 1048576;

const PS = require(path.join(ROOT, 'shared', 'profile_settings.js'));
const U = require(path.join(ROOT, 'shared', 'units.js'));
const T = {
    uk: JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'i18n', 'uk.json'), 'utf8')),
    en: JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'i18n', 'en.json'), 'utf8')),
};
const spec = (a) => JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', a, 'app.json'), 'utf8'));

/* ------------------------------------------------------------------ A: the table ----------------------------------- */
section('A. the per-profile / global table');
['f30_cluster', 'twin_dial'].forEach((a) => {
    const keys = spec(a).settings.map((s) => s.key), t = PS.TABLE[a];
    const both = t.perProfile.filter((k) => t.global.indexOf(k) >= 0);
    const missing = keys.filter((k) => t.perProfile.indexOf(k) < 0 && t.global.indexOf(k) < 0);
    const stale = t.perProfile.concat(t.global).filter((k) => keys.indexOf(k) < 0);
    ok(!both.length && !missing.length && !stale.length, a + ': the two lists cover its ' + keys.length + ' settings exactly (' + t.perProfile.length + ' per profile, ' + t.global.length + ' global)' +
        (both.length ? ' both: ' + both : '') + (missing.length ? ' in neither: ' + missing : '') + (stale.length ? ' not a setting: ' + stale : ''));
    const diag = keys.filter((k) => /^diag/.test(k) || k === 'demo');
    ok(diag.every((k) => t.global.indexOf(k) >= 0), a + ': every Діагностика switch and the demo data are global (' + diag.join(', ') + ')');
    ok(['hudLayout', 'lang', 'units'].every((k) => t.perProfile.indexOf(k) >= 0) && t.global.indexOf(PS.ENABLE_KEY) >= 0, a + ': theme, language and units per profile; the switch itself global');
    const sp = spec(a), main = sp.screens.find((s) => s.name === 'MAIN'), set = sp.settings.find((s) => s.key === 'profileSets'), un = sp.settings.find((s) => s.key === 'units');
    ok(set && set.type === 'bool' && set.default === true && main.items.some((i) => i[0] === 'setting' && i[1] === 'profileSets'), a + ': "' + T.uk[a + '.set.profileSets'] + '" (bool, on by default) on the main menu');
    ok(un && un.default === 'auto' && un.options.map((o) => o[0]).join() === 'auto,km,mi', a + ': "' + T.uk[a + '.set.units'] + '": auto / km / mi, default auto');
    ok((sp.shared || []).indexOf('profile_settings.js') >= 0 && (sp.shared || []).indexOf('units.js') >= 0, a + ': ships profile_settings.js and units.js');
    const veh = sp.signals['de.bmw.infotainment.vehicle.Vehicle'] || {};
    ok(veh.statusNewCurrentUnitsStatusExt === 'rs' && !Object.keys(veh).some((k) => /newCurrentUnitsConfigExt/.test(k)), a + ': Vehicle.statusNewCurrentUnitsStatusExt "rs" (getter 46), never its setter');
    const pers = Object.keys(sp.signals).filter((k) => /personalization/.test(k));
    ok(!pers.length, a + ': declares no personalization interface of its own (only the kit\'s platform grant: SessionManager, UserAccount id)');
});

/* ------------------------------------------------------------------ B: the units rule ------------------------------ */
section('B. the units rule');
{
    const r = (p, s, c) => U.resolve(p, U.carOf({ unitOfMeasurementSpeedometerDigital: s, unitOfMeasurementConsumption: c }));
    ok(!r('auto').mi && r('auto').cons === 'l100' && r('auto').src === 'default', 'Авто, the car silent: km, l/100 km');
    ok(r('auto', 'MEILEN', 'MPG__UK').mi && r('auto', 'MEILEN', 'MPG__UK').cons === 'mpgUK' && r('auto', 2, 3).cons === 'mpgUS', 'Авто follows the car: MEILEN -> miles, its mpg (by name or number)');
    ok(!r('auto', 'KILOMETER', 'KM_S_L').mi && r('auto', 'KILOMETER', 'KM_S_L').cons === 'kml', 'Авто: KILOMETER, km/l');
    ok(!r('auto', 'SIGNAL_UNGUELTIG').mi && !r('auto', 3).mi && !r('auto', 'DEFAULT').mi, 'Авто: an invalid or default unit is km');
    ok(!r('km', 'MEILEN', 'MPG__US').mi && r('km', 'MEILEN', 'MPG__US').cons === 'l100', 'км wins over the car (and its mpg)');
    ok(r('mi', 'KILOMETER', 'L_S_100KM').mi && r('mi', 'KILOMETER', 'L_S_100KM').cons === 'mpgUS' && r('mi', 1, 2).cons === 'mpgUK', 'милі wins; mpg (the car\'s own mpg kind when it has one)');
    // r1120 PS2: the temperature (the owner): км -> °C, милі -> °F; Авто -> the car's own unit, else the way Авто's distance went
    const t = (p, s, c) => U.resolve(p, U.carOf({ unitOfMeasurementSpeedometerDigital: s, unitOfMeasurementTemperature: c })).temp;
    ok(t('km') === 'C' && t('km', 'MEILEN', 'F') === 'C' && t('mi') === 'F' && t('mi', 'KILOMETER', 'C') === 'F', 'temperature: км -> °C and милі -> °F whatever the car says');
    ok(t('auto') === 'C' && t('auto', 'MEILEN') === 'F' && t('auto', 'KILOMETER') === 'C' && t('auto', 'KILOMETER', 'F') === 'F' && t('auto', 'MEILEN', 'C') === 'C' && t('auto', null, 2) === 'F' && t('auto', null, 'SIGNAL_UNGUELTIG') === 'C',
        'temperature under Авто: the car\'s own unit (C / F, 1 / 2) when it says one; else °F with miles, °C with km or nothing known');
    ok(Math.abs(U.temp(100, 'F') - 212) < 1e-9 && U.temp(20, 'C') === 20, '100 °C = 212 °F');
    ok(Math.abs(U.cons(7.84, 'mpgUS') - 30) < 0.01 && U.cons(0.2, 'mpgUS') === 0 && Math.abs(U.cons(5, 'kml') - 20) < 1e-9 && Math.abs(U.dist(160.9344, true) - 100) < 1e-9, 'conversions: 7.84 l/100 km = 30 mpg (US), 5 l/100 km = 20 km/l, 160.9 km = 100 mi');
}

/* ------------------------------------------------------------------ C: the module against a fake car ---------------- */
// the kit's own Settings class, as the bench's head-unit stub loads it (kit/tools/hu-stub.js)
function makeSettings(dir, schema, logf) {
    const src = fs.readFileSync(path.join(ROOT, 'kit', 'runtime', 'mgu.js'), 'utf8').replace(/\r\n/g, '\n');
    const m = src.match(/class Settings[\s\S]*?\n}\n/);
    const S = new Function('fs', 'path', 'DATA_DIR', 'log', m[0] + '\nreturn Settings;')(fs, path, dir, logf);
    return new S(schema);
}
function fakeCar() {
    const UAM = 'de.bmw.infotainment.personalization.UserAccountManager';
    const car = { current: 'guest', fail: false, ids: { guest: 'guest', valet: 'valet', i01: 'persod-aaaa-1111', i02: 'persod-bbbb-2222', i03: 'persod-cccc-3333' }, listeners: [], calls: [] };
    car.signals = {
        proxy: (iface, inst) => { car.calls.push('proxy ' + iface.split('.').pop()); return Promise.resolve({ iface, inst }); },
        get: (p, f) => {
            car.calls.push('get ' + p.iface.split('.').pop() + '.' + f);
            if (p.iface.endsWith('SessionManager') && f === 'currentUserAccountReference') return car.fail ? Promise.reject(new Error('no answer')) : Promise.resolve(UAM + '.' + car.current);
            if (p.iface.endsWith('UserAccount') && f === 'id') return Promise.resolve(car.ids[String(p.inst).split('.').pop()]);
            return Promise.reject(new Error('not granted'));
        },
        on: (p, name, fn) => { car.calls.push('on ' + name); if (name === 'currentUserOnChange') car.listeners.push(fn); return Promise.resolve(); },
        set: () => { car.calls.push('SET'); return Promise.reject(new Error('no')); },
        call: () => { car.calls.push('CALL'); return Promise.reject(new Error('no')); },
    };
    car.to = (slot, silent) => { car.current = slot; if (!silent) car.listeners.forEach((fn) => fn(UAM + '.' + slot)); };
    return car;
}
const SCHEMA = [
    { key: 'hudLayout', type: 'choice', default: 'a', options: [['a', 'A'], ['b', 'B'], ['c', 'C']] },
    { key: 'lang', type: 'choice', default: 'auto', options: [['auto', 'Auto'], ['uk', 'uk'], ['en', 'en']] },
    { key: 'units', type: 'choice', default: 'auto', options: [['auto', 'a'], ['km', 'k'], ['mi', 'm']] },
    { key: 'diagX', type: 'bool', default: false },
    { key: 'profileSets', type: 'bool', default: true },
];
function rig(opts) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-'));
    const lines = [];
    const log = { info: (s) => lines.push('I ' + s), warn: (s) => lines.push('W ' + s), error: (s) => lines.push('E ' + s) };
    const settings = makeSettings(dir, SCHEMA, log);
    const car = fakeCar();
    const batches = [];
    settings.onBatch((keys) => batches.push(keys.slice()));
    const ctx = { settings, signals: car.signals, log, dataDir: dir, spec: { id: 'test', config: {} } };
    const ps = new PS.ProfileSettings(ctx, Object.assign({ app: 'test', perProfile: ['hudLayout', 'lang', 'units'], global: ['diagX', 'profileSets'], pollMs: 250, quietMs: 60, gapMs: 120, kickMs: 0 }, opts)).start();
    return { dir, lines, settings, car, ps, batches, logText: () => lines.join('\n') };
}

async function partC() {
    section('C. the module against a fake car');
    const r = rig();
    await sleep(250);
    ok(r.ps.info().slot === 'guest' && r.ps.held === 'guest' && fs.existsSync(path.join(r.dir, 'profiles', 'guest.json')) && !r.batches.length,
        'start: guest read, its set is the one in use (a copy, nothing changed, no rebuild)');
    r.settings.set('hudLayout', 'b'); r.settings.set('lang', 'en'); r.settings.set('diagX', true);
    const g = JSON.parse(fs.readFileSync(path.join(r.dir, 'profiles', 'guest.json'), 'utf8'));
    ok(g.values.hudLayout === 'b' && g.values.lang === 'en' && !('diagX' in g.values) && g.id && g.id !== 'guest', 'a change goes to guest\'s file (theme, language), never a global switch; the id kept as a hash');
    r.car.to('i01');
    await sleep(300);
    ok(r.ps.held === 'i01' && r.settings.get('hudLayout') === 'b' && r.settings.get('lang') === 'en' && !r.batches.length, 'i01 seen for the first time: a copy of the set in use (no change, no rebuild)');
    r.settings.set('hudLayout', 'c'); r.settings.set('lang', 'uk'); r.settings.set('units', 'mi');
    r.car.to('guest');
    await sleep(300);
    ok(r.settings.get('hudLayout') === 'b' && r.settings.get('lang') === 'en' && r.settings.get('units') === 'auto' && r.batches.length === 1 && r.batches[0].length === 3,
        'back to guest by the event: its theme, language and units, in ONE batch (' + JSON.stringify(r.batches[0]) + ')');
    ok(r.settings.get('diagX') === true, 'the global switch stayed as it was');
    const saved = JSON.parse(fs.readFileSync(path.join(r.dir, 'settings.json'), 'utf8'));
    ok(saved._psSlot === 'guest' && saved.hudLayout === 'b', 'settings.json holds the set in use and whose it is (_psSlot)');
    // the event missing: the poll catches it
    r.car.to('i01', true);
    const t0 = Date.now();
    while (r.settings.get('hudLayout') !== 'c' && Date.now() - t0 < 2000) await sleep(20);
    ok(r.settings.get('hudLayout') === 'c' && r.settings.get('units') === 'mi' && /profile: i01 \(poll\)/.test(r.logText()), 'no event: the poll found i01 in ' + (Date.now() - t0) + ' ms (poll 250 ms) and put its set in');
    // flapping: five changes in 50 ms, ending where it started -> no switch; ending elsewhere -> one
    const b0 = r.batches.length;
    ['guest', 'i01', 'guest', 'i01'].forEach((s) => r.car.to(s));
    await sleep(400);
    ok(r.batches.length === b0, 'flapping guest / i01 that ends on i01 (the set in use): no switch at all');
    const b1 = r.batches.length, a1 = r.ps.applies;
    ['guest', 'i01', 'guest', 'i01', 'guest'].forEach((s) => r.car.to(s));
    await sleep(400);
    ok(r.batches.length === b1 + 1 && r.ps.applies === a1 + 1 && r.settings.get('hudLayout') === 'b', 'flapping that ends on guest: exactly one switch (' + (r.batches.length - b1) + ')');
    // not known: the set in use stays
    r.car.fail = true;
    await r.ps.read('test');
    ok(!r.ps.info().known && r.settings.get('hudLayout') === 'b' && /profile: not known/.test(r.logText()), 'the field does not answer: "profile: not known", the set in use stays');
    r.car.fail = false;
    await r.ps.read('test'); await sleep(200);
    // a reused slot starts over: i01 gets a new persod id
    r.car.ids.i01 = 'persod-new-9999';
    r.car.to('i01');
    await sleep(300);
    ok(r.settings.get('hudLayout') === 'b' && r.settings.get('units') === 'auto' && /i01.*new profile|new profile in this slot/.test(r.logText()), 'a new profile in slot i01: it starts over from the set in use, not the old i01 set');
    // the setting off: one set
    r.settings.set('profileSets', false);
    r.settings.set('hudLayout', 'a');
    const b2 = r.batches.length;
    r.car.to('guest');
    await sleep(300);
    ok(r.batches.length === b2 && r.settings.get('hudLayout') === 'a', 'per-profile off: the profile changes, the one set stays');
    r.settings.set('profileSets', true);
    await sleep(300);
    ok(r.ps.held === 'guest' && JSON.parse(fs.readFileSync(path.join(r.dir, 'profiles', 'guest.json'), 'utf8')).values.hudLayout === 'a', 'on again: the set in use becomes the active profile\'s (nothing on the screen changes)');
    // only reads, never a write or a method; no personal field in the log
    const kinds = r.car.calls.filter((c, i, a) => a.indexOf(c) === i).sort();
    ok(kinds.every((c) => /^(proxy (SessionManager|UserAccount)|get SessionManager\.currentUserAccountReference|get UserAccount\.id|on currentUserOnChange)$/.test(c)),
        'the car was only read: ' + kinds.join(', '));
    const leak = Object.keys(r.car.ids).map((k) => r.car.ids[k]).filter((id) => id.length > 6 && r.logText().indexOf(id) >= 0)
        .concat(fs.readdirSync(path.join(r.dir, 'profiles')).map((f) => JSON.parse(fs.readFileSync(path.join(r.dir, 'profiles', f), 'utf8')).id).filter((h) => h && r.logText().indexOf(h) >= 0));
    ok(!leak.length, 'no persod id and no id hash in the log');
    r.ps.stop();

    // an atomic write survives a kill mid-write
    const k = rig();
    await sleep(250);
    k.settings.set('hudLayout', 'c');
    const f = path.join(k.dir, 'profiles', 'guest.json'), before = fs.readFileSync(f, 'utf8');
    const realRename = fs.renameSync;
    fs.renameSync = () => { throw new Error('killed'); };      // the app dies after the temp file, before the rename
    try { k.settings.set('hudLayout', 'a'); } finally { fs.renameSync = realRename; }
    fs.writeFileSync(f + '.tmp', '{"v":1,"slot":"guest","valu');            // and leaves a half-written temp file behind
    ok(fs.readFileSync(f, 'utf8') === before && k.ps.readSet('guest').values.hudLayout === 'c', 'a kill mid-write: guest\'s file is whole and still the last full set (the half temp file is never read)');
    const sj = path.join(k.dir, 'settings.json');
    const sBefore = fs.readFileSync(sj, 'utf8');
    fs.renameSync = () => { throw new Error('killed'); };
    try { k.settings.set('hudLayout', 'b'); } finally { fs.renameSync = realRename; }
    ok(fs.readFileSync(sj, 'utf8') === sBefore && JSON.parse(sBefore).hudLayout === 'c', 'the kit\'s settings.json the same: a kill mid-save leaves the old file whole (the last whole save, "c")');
    const k2 = makeSettings(k.dir, SCHEMA, { warn() {} });
    ok(k2.get('hudLayout') === 'c', 'a restart after the kill reads the last whole settings');
    k.ps.stop();
}

/* ------------------------------------------------------------------ D: the words fit --------------------------------- */
section('D. the words fit their boxes');
const font = (app, n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', app, 'hud', 'fonts', n + '.json'), 'utf8'));
const width = (f, s) => s.split('').reduce((a, c) => a + (f.glyphs[c] ? f.glyphs[c].advance : (c === ' ' ? (f.glyphs[' '] || { advance: 6 }).advance : 0)), 0);
{
    const lay = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts', n + '.json'), 'utf8'));
    const WORD = { speedU: (L, mi) => T[L][mi ? 'wb.u.mph' : 'wb.u.kmh'], distU: (L, mi) => T[L][mi ? 'wb.u.mi' : 'wb.u.km'], rpmCap: (L) => T[L]['wb.rpmCap'],
        ready: (L) => T[L]['wb.ready'], off: (L) => T[L]['wb.off'], consU: (L, mi) => [T[L]['wb.u.l100'], T[L]['wb.u.kml'], T[L]['wb.u.mpgUS'], T[L]['wb.u.mpgUK']].reduce((a, b) => (a.length > b.length ? a : b)) };
    const bad = [], miss = [];
    let n = 0;
    ['wb_comfort', 'wb_dials', 'wb_sport', 'wb_eco'].forEach((name) => lay(name).widgets.filter((w) => w.type === 'text' && /\{\{wb:/.test(w.text)).forEach((w) => {
        const f = font('f30_cluster', w.font);
        ['uk', 'en'].forEach((L) => [false, true].forEach((mi) => {
            const s = w.text.replace(/\{\{wb:(\w+)\}\}/g, (_, k) => WORD[k](L, mi)).replace('{{range}}', '888');
            n++;
            if (width(f, s) > w.w) bad.push(name + ' ' + w.id + ' "' + s + '" ' + width(f, s) + ' > ' + w.w);
            s.split('').forEach((c) => { if (c !== ' ' && !f.glyphs[c]) miss.push(name + ' ' + w.id + ' ' + c); });
        }));
    }));
    // r1120 PS2: the temperature rows in °F too ("+108 °F" is the widest), and the mph scale numbers in the font that draws them
    ['wb_comfort', 'wb_dials', 'wb_sport', 'wb_eco', 'wb_sport_dials'].forEach((name) => lay(name).widgets.filter((w) => w.type === 'text' && /\{\{u:temp\}\}|^mph\d+$/.test(w.text + (/^mph\d+$/.test(w.id) ? '' : '') ) || (w.type === 'text' && /^mph\d+$/.test(w.id))).forEach((w) => {
        const f = font('f30_cluster', w.font);
        ['+108 \u00b0F', '-40 \u00b0F', '+38.5 \u00b0C', '-25.5 \u00b0C'].map((x) => (/^mph/.test(w.id) ? w.text : w.text.replace('{{ambient1}} {{u:temp}}', x).replace('{{u:temp}}', x.slice(-2)).replace('{{ambient1}}', x.split(' ')[0]))).forEach((s2) => {
            n++;
            if (width(f, s2) > w.w) bad.push(name + ' ' + w.id + ' "' + s2 + '" ' + width(f, s2) + ' > ' + w.w);
            s2.split('').forEach((c) => { if (c !== ' ' && !f.glyphs[c]) miss.push(name + ' ' + w.id + ' ' + c); });
        });
    }));
    ok(n > 60 && !bad.length, '6WB: ' + n + ' word / unit / scale / temperature texts in uk / en x km / mi x °C / °F fit their boxes' + (bad.length ? ': ' + bad.slice(0, 5).join('; ') : ''));
    ok(!miss.length, '6WB: every character of them is in its atlas (wb_cap, wb_capb, wb_spd)' + (miss.length ? ': missing ' + miss.slice(0, 6).join(', ') : ''));
    const cyr = (n2) => Object.keys(font('f30_cluster', n2).glyphs).filter((c) => /[Ѐ-ӿ]/.test(c)).sort().join('');
    const ours = (keys) => { const s = new Set(); ['uk', 'en'].forEach((L) => Object.keys(T[L]).filter(keys).forEach((k) => T[L][k].split('').forEach((c) => { if (/[Ѐ-ӿ]/.test(c)) s.add(c); }))); return [...s].sort().join(''); };
    ok(cyr('wb_cap') === ours((k) => /^wb\./.test(k) && k !== 'wb.ready') && cyr('wb_capb') === ours((k) => k === 'wb.ready'),
        'the Cyrillic in wb_cap (' + cyr('wb_cap') + ') and wb_capb (' + cyr('wb_capb') + ') is exactly the letters of our own words');
    const tw = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'hud', 'layouts', 'twin.json'), 'utf8')).widgets;
    const tbad = [];
    [['tab_range_u', ['twin.u.km', 'twin.u.mi']], ['row_l1u', ['twin.u.km', 'twin.u.mi']], ['row_r1u', ['twin.u.km', 'twin.u.mi']]].forEach((x) => {
        const w = tw.find((y) => y.id === x[0]), f = font('twin_dial', w.font);
        ['uk', 'en'].forEach((L) => x[1].forEach((k) => { const s = T[L][k]; if (width(f, s) > w.w || s.split('').some((c) => !f.glyphs[c])) tbad.push(x[0] + ' ' + s); }));
    });
    const u21 = font('twin_dial', 'td_u21');
    const pageWords = ['fv.mph', 'twin.u.kmh', 'twin.u.mi', 'twin.u.km', 'twin.u.gal', 'twin.u.l', 'twin.u.per100'];
    // r1120 PS2: °F in the bottom row's unit boxes and the temperature value box
    [['row_r1u', '\u00b0F'], ['row_r2u', '\u00b0F'], ['row_r1', '+108'], ['row_r2', '-40']].forEach((x) => {
        const w = tw.find((y) => y.id === x[0]), f = font('twin_dial', w.font);
        if (width(f, x[1]) > w.w || x[1].split('').some((c) => !f.glyphs[c])) tbad.push(x[0] + ' ' + x[1]);
    });
    ['uk', 'en'].forEach((L) => pageWords.forEach((k) => { if (T[L][k].split('').some((c) => !u21.glyphs[c])) tbad.push('td_u21 ' + T[L][k]); }));
    ok(!tbad.length, 'Twin Dial: the range tab\'s and the bottom row\'s unit in km and mi, °C and °F fit, the trip page\'s unit words are in td_u21' + (tbad.length ? ': ' + tbad.join(', ') : ''));
}

{
    // the faces per language and unit: each an R8 616 x 560 scene texture beside the base pair; the mph face's numerals in mph
    const SC = path.join(ROOT, 'apps', 'twin_dial', 'hud', 'scene');
    const names = ['face_speedo', 'face_tacho', 'face_speedo_en', 'face_tacho_en', 'face_speedo_mph', 'face_speedo_en_mph'];
    const bad = names.filter((n) => { try { const j = JSON.parse(fs.readFileSync(path.join(SC, n + '.json'), 'utf8')); return !(j.format === 'r8' && j.w === 616 && j.h === 560 && Buffer.from(j.r8, 'base64').length === 616 * 560); } catch (e) { return true; } });
    ok(!bad.length, 'Twin Dial: the six faces (uk / en x km / mph speedometers, uk / en tachometers) are R8 616 x 560' + (bad.length ? ': bad ' + bad.join(', ') : ''));
    const reg = (n) => JSON.parse(fs.readFileSync(path.join(SC, n + '.regions.json'), 'utf8'));
    const mv = reg('face_speedo_mph').numerals.map((x) => x.value);
    const th = (v) => (reg('face_speedo_mph').numerals.find((x) => x.value === v) || {}).theta_deg;
    ok([0, 10, 20, 30, 40, 50, 60, 80, 100, 120, 140, 160].every((v) => mv.indexOf(v) >= 0) && Math.max.apply(null, mv) === 160 && reg('face_speedo_mph').ticks.every((t) => 'value_mph' in t) &&
        /mph/.test(reg('face_speedo_en_mph').baked_text[0]) && /км\/год/.test(reg('face_speedo').baked_text[0]) && /1\/min/.test(reg('face_tacho_en').baked_text[0]),
        'the mph face (PS2: US style 0..160) carries 0..60 every 10 and 80..160 every 20; the words: "км/год", "mph", "1/min × 1000"');
    ok(th(0) === -125 && th(60) === 0 && th(100) === 50 && th(160) === 125, 'its numerals stand where the law puts them: 0 at -125, 60 at 12 o\'clock, 100 at +50, 160 at +125 deg');
    // 6WB Comfort's mph faces (tools/bake_6wb_mph.py): RGBA 670 x 670 as the km/h ones, and their ETC2 files
    const W6 = path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'scene');
    const bad6 = ['speedo_mph', 'speedo_d_mph'].filter((n) => { try { const j = JSON.parse(fs.readFileSync(path.join(W6, n + '.json'), 'utf8')); const e = JSON.parse(fs.readFileSync(path.join(W6, n + '@etc2.json'), 'utf8'));
        return !(j.w === 670 && j.h === 670 && Buffer.from(j.rgba, 'base64').length === 670 * 670 * 4 && e.format === 'etc2rgb' && e.w === 672 && Buffer.from(e.etc2, 'base64').length === 168 * 168 * 8); } catch (e) { return true; } });
    ok(!bad6.length, '6WB: speedo_mph and speedo_d_mph are RGBA 670 x 670, with their etc2rgb files' + (bad6.length ? ': bad ' + bad6.join(', ') : ''));
    // the 6WB's mph numbers: 0..160 every 20 at 1.625 deg a mph, the km/h ones hidden in mph and the other way round
    const L6 = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts', 'wb_comfort.json'), 'utf8')).widgets, mphW = L6.filter((w) => /^mph\d+$/.test(w.id)), kmW = L6.filter((w) => /^spd\d+$/.test(w.id));
    const sp = L6.find((w) => w.id === 'speedo');
    ok(mphW.map((w) => w.text).join() === '0,20,40,60,80,100,120,140,160' && mphW.every((w) => w.toggle === 'u:mi') && kmW.length === 14 && kmW.every((w) => w.toggle === '!u:mi') &&
        sp.mph && sp.mph.max === 160 && sp.mph.ticks === 8 && sp.scale.max === 260, '6WB Comfort: mph numbers 0..160 every 20 ("u:mi"), the 14 km/h ones "!u:mi", the dial\'s mph scale 0..160 in 8 steps');
}

section('G. Node 8.16 syntax of the files this round touched');
{
    const CHECK = path.join(ROOT, 'tools', 'cruise-sim', 'tests', 'stubs', 'sc2-node8-check.js');
    const cp = require('child_process');
    const files = ['shared/profile_settings.js', 'shared/units.js', 'shared/hud.js', 'shared/menu.js', 'shared/twin_tokens.js', 'shared/twin_pages.js',
        'shared/twin_limit.js', 'kit/runtime/mgu.js', 'apps/f30_cluster/main.js', 'apps/twin_dial/main.js'];
    const probe = cp.spawnSync(process.execPath, ['--expose-internals', CHECK], { input: 'var a = {}; var b = a?.c;', encoding: 'utf8' });
    if (!(probe.status === 0 && !/unavailable/.test(probe.stdout))) console.log('       (no acorn reachable in this Node: skipped)');
    else {
        const bad = [];
        files.forEach((f) => {
            const r = JSON.parse(cp.spawnSync(process.execPath, ['--expose-internals', CHECK, path.join(ROOT, f)], { encoding: 'utf8' }).stdout);
            if (!r.ok) bad.push(f + ': ' + r.error);
            else ['flat', 'flatMap', 'fromEntries', 'matchAll', 'replaceAll', 'allSettled', 'trimStart', 'trimEnd', 'finally', 'hasOwn', 'findLast'].forEach((m) => { if (r.members.indexOf(m) >= 0) bad.push(f + ' .' + m); });
        });
        ok(JSON.parse(probe.stdout).ok === false && !bad.length, files.length + ' files parse as ES2017 and use no newer built-in (the checker refuses ?.)' + (bad.length ? ': ' + bad.join('; ') : ''));
    }
}

/* ------------------------------------------------------------------ the bench ------------------------------------------ */
function bench(app, port, env) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-bench-'));
    const dataDir = path.join(tmp, 'data'), screenDir = path.join(tmp, 'screen');
    fs.mkdirSync(dataDir); fs.mkdirSync(screenDir);
    const e = Object.assign({}, process.env, { BENCH_PORT: String(port), BENCH_DATA_DIR: dataDir, SCREEN_DIR: screenDir, BENCH_HMI_LANG: 'uk_UA',
        BENCH_CONFIG: JSON.stringify({ profileSettings: { pollMs: 2500 } }) }, env || {});
    const b = { port, dataDir, log: '', exited: false };
    b.server = spawn(process.execPath, [path.join(__dirname, 'server.js'), app], { cwd: ROOT, env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (d) => { b.log += d; if (/app exited/.test(String(d))) b.exited = true; };
    b.server.stdout.on('data', keep); b.server.stderr.on('data', keep);
    const req = async (method, url, body) => {
        const r = await fetch('http://127.0.0.1:' + port + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        if (r.status === 200) return r.json();
        if (r.status !== 204) throw new Error(method + ' ' + url + ': ' + r.status);
        return null;
    };
    b.probe = () => req('GET', '/probe');
    b.set = (key, value) => req('POST', '/setting', { key, value });
    b.fake = (v) => req('POST', '/fake', v);
    b.until = async (fn, ms) => {
        const end = Date.now() + (ms || 10000);
        let p = null;
        while (Date.now() < end) { try { p = await b.probe(); if (p && fn(p)) return p; } catch (er) { /* (re)starting */ } await sleep(150); }
        return p;
    };
    b.scene = () => new Promise((resolve) => {
        let buf = '';
        const rq = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
            res.setEncoding('utf8');
            res.on('data', (d) => {
                buf += d;
                let i;
                while ((i = buf.indexOf('\n\n')) >= 0) {
                    const ch = buf.slice(0, i); buf = buf.slice(i + 2);
                    const mm = /^data: (.*)$/m.exec(ch);
                    let msg = null;
                    try { msg = mm && JSON.parse(mm[1]); } catch (er) { continue; }
                    if (msg && msg.t === 'scene') { res.destroy(); rq.destroy(); return resolve(msg); }
                }
            });
        });
        rq.on('error', () => resolve(null));
        setTimeout(() => resolve(null), 8000);
    });
    b.settled = async () => {
        let prev = null;
        for (let i = 0; i < 20; i++) {
            const m = await b.scene();
            const k = m && JSON.stringify([m.pixels, m.layers.filter((l) => l.kind === 'asset').map((l) => [l.format, l.iw, l.ih])]);
            if (k && k === prev) return m;
            prev = k; await sleep(400);
        }
        return null;
    };
    b.rebuilds = () => (b.log.match(/settings: a profile's set/g) || []).length;
    b.stop = () => { try { b.server.kill('SIGTERM'); } catch (er) { /* gone */ } };
    return b;
}
const PRIVATE = ['Driver A', 'Driver B', 'Guest', 'Valet'];       // the fake's profile names: never in the log (Guest / Valet are names there too)
function noPersonal(b, p) {
    const ids = Object.keys((p.perso || {}).accounts || {}).map((s) => p.perso.accounts[s].id).filter((id) => id && id.length > 5);
    const appLog = b.log.split('\n').filter((l) => /app: \[/.test(l) && !/fake persod|bench: /.test(l)).join('\n');
    return PRIVATE.concat(ids).filter((x) => appLog.indexOf(x) >= 0);
}
function onlyReads(p) {
    const gets = Object.keys((p.perso || {}).gets || {});
    return { calls: (p.perso || {}).calls || [], gets, ok: !((p.perso || {}).calls || []).length && gets.every((g) => g === 'SessionManager.currentUserAccountReference' || g === 'UserAccount.id') };
}

async function partE() {
    section('E. f30_cluster on the bench (port ' + PORT0 + ')');
    const b = bench('f30_cluster', PORT0);
    try {
        let p = await b.until((q) => q.ready && q.activeName && q.ps && q.ps.held === 'guest', 120000);
        ok(p && p.ready && p.ps && p.ps.slot === 'guest', 'the app runs; the active profile is guest (read at start), its set the one in use');
        if (!p || !p.ready) return;
        await b.set('byMode', false);
        await b.set('hudLayout', 'wb_sport');
        p = await b.until((q) => q.activeName === 'wb_sport');
        const t0 = b.rebuilds();
        await b.fake({ current: 'i01' });
        p = await b.until((q) => q.ps && q.ps.held === 'i01');
        ok(p.ps.held === 'i01' && p.activeName === 'wb_sport' && b.rebuilds() === t0, 'i01 by the event, seen first: a copy of guest\'s set, nothing rebuilt');
        await b.set('hudLayout', 'wb_eco'); await b.set('lang', 'en');
        p = await b.until((q) => q.activeName === 'wb_eco' && q.texts.speed_unit && q.texts.speed_unit.text === 'km/h' && /Profile: Profile 1/.test((q.native.STATUS2 || {}).text || ''));
        ok(p.activeName === 'wb_eco' && p.texts.speed_unit.text === 'km/h' && /Profile: Profile 1/.test((p.native.STATUS2 || {}).text || ''), 'i01 picks 6WB Eco Pro and English; STATUS2: "' + ((p.native.STATUS2 || {}).text || '').split('.')[0] + '"');
        await b.fake({ current: 'guest' });
        p = await b.until((q) => q.ps && q.ps.held === 'guest' && q.activeName === 'wb_sport' && /Профіль: Гість/.test((q.native.STATUS2 || {}).text || ''));
        ok(p.activeName === 'wb_sport' && p.settings.lang !== 'en' && p.texts.speed_unit.text === 'км/год' && p.texts.rpm_cap.text === '1/хв × 1000' && /Профіль: Гість/.test((p.native.STATUS2 || {}).text || ''),
            'back to guest (event): 6WB Sport in Ukrainian, live ("' + p.texts.speed_unit.text + '", "' + p.texts.rpm_cap.text + '"; STATUS2 "' + ((p.native.STATUS2 || {}).text || '').split('.')[0] + '")');
        ok(b.rebuilds() === t0 + 1, 'that switch rebuilt the theme once (' + (b.rebuilds() - t0) + ')');
        await b.fake({ current: 'i01', silent: true });
        p = await b.until((q) => q.ps && q.ps.held === 'i01' && q.activeName === 'wb_eco', 12000);
        ok(p.activeName === 'wb_eco' && /profile: i01 \(poll\)/.test(b.log), 'no event: the poll (2.5 s here, 15 s on the car) found i01 and put its set in');
        // flapping
        const f0 = b.rebuilds();
        for (const s of ['guest', 'i01', 'guest', 'i01', 'guest']) await b.fake({ current: s });
        await sleep(4500);
        p = await b.probe();
        ok(b.rebuilds() - f0 === 1 && p.activeName === 'wb_sport', 'flapping (five changes ending on guest): one rebuild (' + (b.rebuilds() - f0) + '), 6WB Sport');
        // global stays global
        await b.set('diagMbGap', true);
        await b.fake({ current: 'i01' });
        p = await b.until((q) => q.ps.held === 'i01' && q.activeName === 'wb_eco');
        ok(p.settings.diagMbGap === true, 'a Діагностика switch set under guest is still on under i01 (global)');
        await b.set('diagMbGap', false);
        // r1120 PS2: words, scale and temperature: uk / en x km / mi x °C / °F on Comfort. km + °F and mi + °C come from the car under Авто
        await b.set('hudLayout', 'wb_comfort');
        p = await b.until((q) => q.activeName === 'wb_comfort');
        const UNITS = [['km', 'C', 'km', null], ['mi', 'F', 'mi', null], ['km', 'F', 'auto', { speed: 'KILOMETER', cons: 'L_S_100KM', temp: 'F' }], ['mi', 'C', 'auto', { speed: 'MEILEN', cons: 'MPG__US', temp: 'C' }]];
        let maxPx = 0, refused = 0;
        const pxBy = {};
        const tempText = (q) => Object.keys(q.texts || {}).map((k) => q.texts[k].text).filter((x) => /°[CF]/.test(x));
        for (const L of ['uk', 'en']) {
            for (const u of UNITS) {
                await b.set('lang', L);
                if (u[3]) await b.fake({ carUnits: u[3] });
                await b.set('units', u[2]);
                const mi = u[0] === 'mi', F = u[1] === 'F';
                p = await b.until((q) => q.units && q.units.mi === mi && q.units.temp === u[1] && q.texts.speed_unit && q.texts.speed_unit.text === T[L][mi ? 'wb.u.mph' : 'wb.u.kmh'] &&
                    q.dials.speedo && q.dials.speedo.scale.max === (mi ? 160 : 260) && tempText(q).length && tempText(q).every((x) => /°F$/.test(x) === F), 15000);
                const tx = p.texts, sc = p.dials.speedo || { scale: {} };
                const nums = Object.keys(tx).filter((k) => /^(spd|mph)\d+$/.test(k)).sort((a, c) => Number(a.replace(/\D/g, '')) - Number(c.replace(/\D/g, ''))).map((k) => tx[k].text);
                const wantNums = mi ? ['0', '20', '40', '60', '80', '100', '120', '140', '160'] : ['0', '20', '40', '60', '80', '100', '120', '140', '160', '180', '200', '220', '240', '260'];
                ok(tx.speed_unit.text === T[L][mi ? 'wb.u.mph' : 'wb.u.kmh'] && JSON.stringify(nums) === JSON.stringify(wantNums) && sc.scale.max === (mi ? 160 : 260) && sc.base === (mi ? 'speedo_mph' : 'speedo') &&
                    tx.cons_a1.text === T[L][mi ? 'wb.u.mpgUS' : 'wb.u.l100'] && tx.range_a1.text === T[L][mi ? 'wb.u.mi' : 'wb.u.km'] && tx.ready.text === 'READY' && tx.off.text === 'OFF' &&
                    tempText(p).every((x) => /°F$/.test(x) === F),
                    '6WB Comfort ' + L + ' / ' + u[0] + ' / °' + u[1] + (u[3] ? ' (Авто, the car)' : '') + ': "' + tx.speed_unit.text + '", numbers ' + nums[0] + '..' + nums[nums.length - 1] + ' (' + nums.length + '), face ' + sc.base +
                    ', "' + tx.cons_a1.text + '", "' + tx.range_a1.text + '", ' + JSON.stringify(tempText(p)));
                const m = await b.settled();
                if (m) { maxPx = Math.max(maxPx, m.pixels); pxBy[u[0]] = m.pixels; }
            }
        }
        // the faces are the same size (one held at a time); only the text sheets differ (9 mph numbers instead of 14 km/h ones)
        ok(pxBy.km && pxBy.mi && pxBy.mi <= pxBy.km && pxBy.mi < MIB16, '6WB Comfort: pixel memory with the km/h face ' + pxBy.km + ' B, with the mph face ' + pxBy.mi +
            ' B (' + (pxBy.mi - pxBy.km >= 0 ? '+' : '') + (pxBy.mi - pxBy.km) + ' B: the numbers\' sheet is smaller; one face held, so no cost)');
        // the mph scale at 0, 60, 100 and 160 mph: the needle's fraction is mph / 160
        await b.set('units', 'mi');
        await fetch('http://127.0.0.1:' + PORT0 + '/signals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'manual', values: { speed: 0, rpm: 900 } }) });
        for (const mph of [0, 60, 100, 160]) {
            await fetch('http://127.0.0.1:' + PORT0 + '/signals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'manual', values: { speed: mph * 1.609344, rpm: 2000 } }) });
            p = await b.until((q) => q.dials.speedo && q.dials.speedo.q !== null && Math.abs(q.dials.speedo.q - mph / 160) < 0.004, 8000);
            ok(p.dials.speedo && Math.abs(p.dials.speedo.q - mph / 160) < 0.004, '6WB mph: ' + mph + ' mph puts the needle at ' + (p.dials.speedo ? p.dials.speedo.q : '?') + ' of the scale (' + (mph / 160).toFixed(3) + ': ' + (230 + 1.625 * mph - 360 * (230 + 1.625 * mph >= 360)).toFixed(1) + ' deg, where the number ' + mph + ' is)');
        }
        await fetch('http://127.0.0.1:' + PORT0 + '/signals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'demo' }) });
        await b.set('units', 'auto');
        await b.fake({ carUnits: { speed: 'KILOMETER', cons: 'L_S_100KM', temp: 'C' } });
        p = await b.until((q) => q.units && !q.units.mi && q.units.temp === 'C' && q.dials.speedo && q.dials.speedo.scale.max === 260);
        ok(!p.units.mi && p.units.temp === 'C' && p.texts.spd5.text === '100', 'Авто: the car says KILOMETER / C: km/h and °C again');
        for (const lay of ['wb_sport', 'wb_eco', 'wb_comfort']) {
            await b.set('hudLayout', lay);
            await b.until((q) => q.activeName === lay);
            const m = await b.settled();
            if (m) maxPx = Math.max(maxPx, m.pixels);
        }
        refused = (b.log.match(/pixel memory is full/g) || []).length;
        ok(maxPx > 0 && maxPx < MIB16 && !refused, 'pixel memory across every switch: at most ' + (maxPx / 1048576).toFixed(2) + ' MiB of 16, nothing refused');
        p = await b.probe();
        const r = onlyReads(p);
        ok(r.ok, 'the car was only read: ' + r.gets.join(', ') + (r.calls.length ? '; CALLS: ' + JSON.stringify(r.calls) : ''));
        const leak = noPersonal(b, p);
        ok(!leak.length, 'no profile name and no persod id in the app\'s log' + (leak.length ? ': ' + leak.join(', ') : ''));
        ok(!b.exited, 'the app never exited');
    } finally { b.stop(); await sleep(800); }
}

async function partF() {
    const port = PORT0 + 1;
    section('F. twin_dial on the bench (port ' + port + ')');
    const b = bench('twin_dial', port);
    try {
        let p = await b.until((q) => q.ready && q.activeName === 'twin' && q.ps && q.ps.held === 'guest', 120000);
        ok(p && p.ready && p.activeName === 'twin', 'the app runs, Twin Dial drawn, guest active');
        if (!p || !p.ready) return;
        const faces = (q) => (q.scenes || []).filter((s) => /^face_/.test(s)).sort().join(',');
        const pix = [];
        const UNITS = [['km', 'C', 'km', null], ['mi', 'F', 'mi', null], ['km', 'F', 'auto', { speed: 'KILOMETER', temp: 'F' }], ['mi', 'C', 'auto', { speed: 'MEILEN', temp: 'C' }]];
        const rowU = (q) => [q.texts.row_r1u, q.texts.row_r2u].filter((x) => x && /°/.test(x.text)).map((x) => x.text);
        for (const L of ['uk', 'en']) {
            for (const u of UNITS) {
                await b.set('lang', L);
                if (u[3]) await b.fake({ carUnits: u[3] });
                await b.set('units', u[2]);
                const mi = u[0] === 'mi', sfx = (L === 'en' ? '_en' : '');
                const want = ['face_speedo' + sfx + (mi ? '_mph' : ''), 'face_tacho' + sfx].sort().join(',');
                p = await b.until((q) => faces(q) === want && q.units && q.units.temp === u[1] && rowU(q).length && rowU(q).every((x) => x === '°' + u[1]), 15000);
                const sp = p.dials.dial_speed || {};
                ok(faces(p) === want && sp.mi === mi && p.texts.tab_range_u.text === T[L][mi ? 'twin.u.mi' : 'twin.u.km'] && rowU(p).every((x) => x === '°' + u[1]),
                    'Twin Dial ' + L + ' / ' + u[0] + ' / °' + u[1] + (u[3] ? ' (Авто, the car)' : '') + ': faces ' + faces(p) + ' (one pair held), the range tab in "' + p.texts.tab_range_u.text + '", the row in ' + JSON.stringify(rowU(p)));
                const m = await b.settled();
                if (m) pix.push(m.pixels);
            }
        }
        ok(pix.length === 8 && pix.every((x) => x === pix[0]) && pix[0] < MIB16, 'pixel memory the same in all eight (' + (pix[0] / 1048576).toFixed(2) + ' MiB of 16): one face pair at a time');
        // the mph law (PS2): 0 mph at -125 deg, 60 at 12 o'clock, 100 at +50, 160 at +125
        await b.set('units', 'mi');
        await b.until((q) => q.dials.dial_speed && q.dials.dial_speed.mi);
        for (const c of [[0, -125], [60, 0], [100, 50], [160, 125]]) {
            await fetch('http://127.0.0.1:' + port + '/signals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'manual', values: { speed: c[0] * 1.609344, rpm: 2000 } }) });
            p = await b.until((q) => q.dials.dial_speed && Math.abs(q.dials.dial_speed.deg - c[1]) < 0.6, 8000);
            ok(p.dials.dial_speed && Math.abs(p.dials.dial_speed.deg - c[1]) < 0.6, 'mph face: ' + c[0] + ' mph puts the needle at ' + (p.dials.dial_speed ? p.dials.dial_speed.deg.toFixed(2) : '?') + ' deg (the law: ' + c[1] + ')');
        }
        await fetch('http://127.0.0.1:' + port + '/signals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'manual', values: { speed: 100, rpm: 2000 } }) });
        await b.set('units', 'km');
        p = await b.until((q) => q.dials.dial_speed && !q.dials.dial_speed.mi && Math.abs(q.dials.dial_speed.deg) < 0.6, 8000);
        ok(p.dials.dial_speed && Math.abs(p.dials.dial_speed.deg) < 0.6, 'km face: 100 km/h at 12 o\'clock (' + (p.dials.dial_speed ? p.dials.dial_speed.deg.toFixed(2) : '?') + ' deg)');
        // the limit marker follows the mph law too (twin_limit.angleOf: 100 km/h -> 62.1 mph -> +2.6 deg)
        const TL = require(path.join(require('./twin-harness').tree('twin_dial'), 'twin_limit.js'));
        ok(Math.abs(TL.angleOf(100 * 1.609344, true) - 50) < 0.01 && Math.abs(TL.angleOf(160 * 1.609344, true) - 125) < 0.01 && TL.angleOf(0, true) === -125 && Math.abs(TL.angleOf(60 * 1.609344, true)) < 0.01,
            'the limit and cruise markers: the same mph law (0 / 60 / 100 / 160 mph -> -125 / 0 / 50 / 125 deg)');
        await b.set('units', 'auto');
        await b.fake({ carUnits: { speed: 'KILOMETER', temp: 'C' } });
        // a profile switch swaps the faces with one rebuild
        await b.set('lang', 'uk');
        await b.until((q) => faces(q) === 'face_speedo,face_tacho');
        await b.fake({ current: 'i02' });
        await b.until((q) => q.ps.held === 'i02');
        await b.set('lang', 'en'); await b.set('units', 'mi');
        await b.until((q) => faces(q) === 'face_speedo_en_mph,face_tacho_en');
        const r0 = b.rebuilds();
        await b.fake({ current: 'guest' });
        p = await b.until((q) => q.ps.held === 'guest' && faces(q) === 'face_speedo,face_tacho', 12000);
        ok(faces(p) === 'face_speedo,face_tacho' && b.rebuilds() === r0 + 1, 'i02 (English, miles) -> guest (Ukrainian, km): the faces swap back with one rebuild');
        ok(!/pixel memory is full|scene texture .* (missing|does not match)/.test(b.log), 'no texture refused or missing in any switch');
        const r = onlyReads(p);
        ok(r.ok, 'the car was only read: ' + r.gets.join(', '));
        ok(!noPersonal(b, p).length && !b.exited, 'no personal field in the log; the app never exited');
    } finally { b.stop(); await sleep(800); }
}

(async () => {
    await partC();
    if (!process.env.PS_SKIP_BENCH) { await partE(); await partF(); }
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
