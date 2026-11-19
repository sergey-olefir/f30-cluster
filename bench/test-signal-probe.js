'use strict';
/**
 * test-signal-probe.js - the signal probe app (apps/signal_probe, docs/car/CP-REPORT.md): READ ONLY, LOG ONLY.
 *
 *   node bench/test-signal-probe.js            (BENCH_PORT, default 8502)
 *
 *   1. the source: no write of any kind (no setter, no requestDefaultSymbols, no message injection, no cluster-render), Node 8
 *      syntax only (the car runs 8.16), no home path; ONE method call, the owner's approved read GuidanceEventList.queryContent,
 *      and only in shared/carplay_turns.js (packed with the app), never in the app's own files.
 *   2. the declarations: app.json "signals" is exactly what fields.js needs; only r / s flags; every r has a NON-ZERO getter
 *      id and every s a notifier in the car's catalogue (skipped, and said so, without it); tools/signals/check_signals.py
 *      passes; design/car/probe_fields.json is current; the interfaces / instances / items / sets are what the brief says.
 *   3. the table against the catalogue: a value is made from the catalogue's own types for every field (every text member a
 *      canary, every enum its first name, every list two entries, unions and inherited members included) and run through the
 *      formatter: no canary reaches the log, no "?" (a kind that disagrees with the catalogue) and no "-" (a path that does not exist).
 *   4. every field's line from an injected value, exact (bench/signal-probe-vectors.json: one per field), canaries in every text member.
 *   5. the engine: once per change, gaps and folding, caps, the flood guard, sets switched on / off (lazy subscription, shared
 *      interfaces, nothing logged while off), marks, the stalk's bits and its time after the mark, summaries, the one getter ask,
 *      handlers that throw, hostile values, the volume line; S16's next-turn poll (car issues CT): only while the phone guides,
 *      one call in flight, every 2 s, the outcome of the first call, errors and timeouts, a line only when the reply changed.
 *   6. on the bench (the real app built by kit/tools/build.py, run in the stubbed head unit): starts with nothing injected, a set
 *      switched in the centre-screen menu is subscribed, an injected field is logged, the mark row works, the choice survives a
 *      restart, the app never exits.
 * Mac only, Node 18 or newer. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'apps', 'signal_probe');
const CATALOGUE = path.join(ROOT, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json');
const CHECK = path.join(ROOT, 'tools', 'signals', 'check_signals.py');
const TOOL = path.join(ROOT, 'tools', 'car', 'probe_fields.js');
const FIELDS = require(path.join(APP_DIR, 'fields.js'));
const FMT = require(path.join(APP_DIR, 'format.js'));
const { Probe, VERSION, LOG_FORMAT } = require(path.join(APP_DIR, 'probe.js'));
const TURNS = require(path.join(ROOT, 'shared', 'carplay_turns.js'));
const FX = require('./carplay-turns-fixture');
const NTABLE = 251;               // fields.js entries (S16 next-turn, car issues CT: + 1)
const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, 'signal-probe-vectors.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-probe-'));
const PORT = Number(process.env.BENCH_PORT) || 8502;

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const short = (i) => i.split('.').pop();
const bodyOf = (line) => String(line).replace(/^probe: P\d+ \S+ #\d+ t=[0-9.]+: /, '').replace(/ tms=\d+ since=\S+$/, '');
const CANARIES = /CANARY|Canary|ARTIST_|TITLE_|SRC_|STREET|URL_|RADIO_|DEVICE_|CALLER_|SERVICE_/;

// ---- a probe on a fake clock and a fake signals object ---------------------------------------------------------------------------
/**
 * fake signals: watch() keeps the handlers (what hu-stub does) and a proxy per interface instance; on() adds a handler to a proxy
 * (what a field added to a running interface needs); get() answers from `answers[field]` (or rejects). feed() calls the handler
 * the way the car's notification would reach it: the watch's own handlers for the fields watch() was given, on()'s for the rest.
 */
function fakeSignals(opts) {
    const o = opts || {};
    const calls = [], subs = {};
    const sig = {
        calls, subs, answers: o.answers || {}, available: o.available !== false,
        watch: (iface, inst, handlers, log, wopts) => {
            const key = iface + '|' + inst;
            calls.push({ op: 'watch', iface, inst, fields: Object.keys(handlers), poll: wopts && wopts.pollMs });
            if (o.failWatch && o.failWatch.indexOf(short(iface)) >= 0) return Promise.resolve({ iface, available: false, proxy: null, error: 'Error: no such service', shutdown: () => Promise.resolve() });
            const res = { iface, available: sig.available, proxy: { key }, error: null, shutdown: () => Promise.resolve() };
            subs[key] = { handlers, initial: Object.keys(handlers), extra: {}, res };
            return Promise.resolve(res);
        },
        on: (p, field, fn) => { calls.push({ op: 'on', key: p.key, field }); subs[p.key].extra[field] = fn; return Promise.resolve(); },
        // car issues CT: the one method; `replies` answers it (a function (params, n) -> a reply / a promise; a throw rejects), else it rejects
        call: (p, method, params, ms) => {
            calls.push({ op: 'call', key: p && p.key, method, params, ms });
            if (typeof o.replies !== 'function') return Promise.reject(new Error('no answer'));
            return Promise.resolve().then(() => o.replies(params, calls.filter((c) => c.op === 'call').length));
        },
        proxy: (iface, inst) => { calls.push({ op: 'proxy', iface, inst }); return o.noProxy ? Promise.reject(new Error('no proxy')) : Promise.resolve({ key: iface + '|' + inst + '|own' }); },
        get: (p, field) => {
            calls.push({ op: 'get', key: p.key, field });
            return sig.answers[field] !== undefined ? Promise.resolve(sig.answers[field]) : Promise.reject(new Error('no answer'));
        },
        feed: (iface, inst, field, v) => {
            const s = subs[iface + '|' + inst];
            if (!s) throw new Error('not subscribed: ' + iface + '[' + inst + ']');
            const fn = s.initial.indexOf(field) >= 0 ? s.handlers[field] : s.extra[field];
            if (!fn) throw new Error('no handler on ' + iface + '.' + field);
            fn(v);
        },
        count: (op) => calls.filter((c) => c.op === op).length,
    };
    return sig;
}
function mk(cfg, sigOpts, table) {
    const lines = [], clock = { t: 1000000 };
    const signals = fakeSignals(sigOpts);
    const pr = new Probe({ log: { info: (s) => lines.push(s), warn: (s) => lines.push('WARN ' + s) }, signals, now: () => clock.t,
        cfg: Object.assign({ hubPauseMs: 0 }, cfg || {}), table });
    const fieldLines = () => lines.filter((l) => /^probe: P\d+ /.test(l));
    return { lines, clock, signals, pr, fieldLines };
}
/** Feed through the field's own handler (a stand-in for the car's notification, no matter which set holds it). */
const feedTag = (h, tag, v) => { const st = h.pr.fields.find((x) => x.f.tag === tag); st.handler(v); return st; };
const settleOf = async (h) => { await h.pr.idle(); await sleep(5); await h.pr.idle(); };
async function settle() { await sleep(1); }

async function main() {
    // ---------------------------------------------------------------------------------------------------------------
    console.log('1. the source: no write, no cluster-render, Node 8 syntax');
    const files = fs.readdirSync(APP_DIR).filter((f) => /\.js$/.test(f));
    ok(files.indexOf('main.js') >= 0 && files.indexOf('fields.js') >= 0 && files.indexOf('probe.js') >= 0, 'apps/signal_probe has ' + files.join(', '));
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    files.forEach((f) => {
        const code = strip(fs.readFileSync(path.join(APP_DIR, f), 'utf8'));
        ok(!/setValue|callMethod|signals\.set\b|signals\.call\b|signals\.proxy\b|\.proxy\(|requestDefaultSymbols|standardCCMessage|extendedCCMessage|newCCMessage|A19B|operationBordcomputer|kombiSelection\b|\.send\(/.test(code),
            f + ': no setter, no method call, no proxy(), no requestDefaultSymbols, no message injection');
        ok(!/cluster_render|cluster-render|ctx\.display|ctx\.canvas|ctx\.loop|ui\.image|\.layer\(|hud\.js/.test(code), f + ': draws nothing (no cluster-render, no canvas, no layer)');
        ok(!/\?\.|\?\?|catch\s*\{|\.\.\.\w|\bBigInt\(|\d+n\b|\.flat\(|\.flatMap\(|Object\.fromEntries|Object\.entries|Object\.values|\.padEnd|\.padStart|\bfor await\b|=>\s*\{\s*\}\s*\?/.test(code),
            f + ': only what Node 8.16 has (no ?. ?? bigint literal, spread, optional catch binding, flat, entries, values, padStart)');
        ok(!/\/Users\/|\/home\/|C:\\\\/.test(fs.readFileSync(path.join(APP_DIR, f), 'utf8')), f + ': no home-directory path');
    });
    const app = readJson(path.join(APP_DIR, 'app.json'));
    ok(JSON.stringify(app.shared) === '["carplay_turns.js"]' && !(app.config && app.config.target) && !app.startWidget, 'app.json: one shared file (carplay_turns.js, the decoder Twin Dial uses too), no config.target, no widget: nothing for the cluster');
    {
        // car issues CT: the one method call lives in shared/carplay_turns.js, and it is queryContent on GuidanceEventList, nothing else
        const tc = strip(fs.readFileSync(path.join(ROOT, 'shared', 'carplay_turns.js'), 'utf8'));
        const callSites = tc.match(/\bS\.call\(|\.call\(p,|callMethod|setValue|\.set\(|signals\.set\b/g) || [];
        ok(callSites.length === 1 && /S\.call\(p, METHOD, request\(\), TIMEOUT_MS\)/.test(tc) && /const METHOD = 'queryContent';/.test(tc) && /const IFACE = 'de\.bmw\.infotainment\.navigation\.guiding\.GuidanceEventList';/.test(tc) &&
            !/setViewConfig|setViewportConfig|registeredViews|getViewContent|getViewConfig|getViewportConfig/.test(tc),
            'shared/carplay_turns.js: ONE call site, signals.call(proxy, "queryContent", ...) on GuidanceEventList; no setter, no other method of it');
        ok(!/\?\.|\?\?|catch\s*\{|\.\.\.\w|\bBigInt\(|\d+n\b|\.flat\(|\.flatMap\(|Object\.fromEntries|Object\.entries|Object\.values|\.padEnd|\.padStart|\bfor await\b/.test(tc), 'shared/carplay_turns.js: only what Node 8.16 has');
        ok(TURNS.METHOD === 'queryContent' && TURNS.POLL_MS === 2000 && TURNS.TIMEOUT_MS === 3000 && TURNS.FRESH_MS === 6000, 'the poll: every 2 s, a timeout of 3 s; a turn is fresh for 6 s (the owner)');
    }
    ok(app.id === 'signal_probe' && app.title === 'Signal Probe' && app.loggingId === 'OASP' && /^\d+\.\d+\.\d+$/.test(app.version), 'app.json: id signal_probe, title, own loggingId OASP, version ' + app.version);
    ok(app.version === VERSION, 'app.json version = probe.js VERSION (' + VERSION + ')');
    ok(app.settings.length === 15 && app.settings.every((s) => s.type === 'bool' && s.default === false), 'fifteen settings, one per set (S1..S11, S13..S16), all bool and off by default');
    ok(FIELDS.SETS.every((s, i) => app.settings[i].key === s.key && new RegExp('^' + s.id + ' ').test(app.settings[i].label)), 'each setting is named for its set');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('2. the declarations');
    const sigs = app.signals;
    const decl = [];
    Object.keys(sigs).forEach((i) => Object.keys(sigs[i]).filter((k) => k[0] !== '_').forEach((f) => decl.push(i + '.' + f + ':' + sigs[i][f])));
    ok(decl.every((d) => /^(rs|s|r)$/.test(d.split(':')[1])), 'only r and s flags (' + decl.length + ' fields), no "w"');
    const EVSETS = ['S13', 'S14', 'S15', 'S16'];
    const S13I = FIELDS.TABLE.filter((f) => f.flags === 'b').map((f) => f.iface);
    const evDecl = [];
    Object.keys(sigs).forEach((i) => (sigs[i]._broadcasts || []).forEach((e) => evDecl.push(i + '.' + e)));
    ok(Object.keys(sigs).filter((i) => sigs[i]._broadcasts).every((i) => S13I.indexOf(i) >= 0) && FIELDS.TABLE.filter((f) => f.flags === 'b').every((f) => EVSETS.indexOf(f.set) >= 0),
        'events (_broadcasts) only on the S13 / S14 / S15 / S16 interfaces (the lead\'s decision of 2026-11-18, the owner\'s requests of 2026-11-19) (' + evDecl.length + ' events)');
    const withMethods = Object.keys(sigs).filter((i) => Object.keys(sigs[i]).some((k) => k === '_methods'));
    ok(withMethods.length === 1 && withMethods[0] === TURNS.IFACE && JSON.stringify(sigs[TURNS.IFACE]._methods) === '["queryContent"]' && sigs[TURNS.IFACE]._instances === 'Main_Instance',
        '_methods: only GuidanceEventList (Main_Instance) declares one, queryContent (car issues CT: the owner\'s approved read)');
    const tableKeys = FIELDS.TABLE.filter((f) => f.flags !== 'b' && f.flags !== 'm').map((f) => f.iface + '.' + f.field).filter((k, i, a) => a.indexOf(k) === i).sort(), declKeys = decl.map((d) => d.split(':')[0]).sort();
    ok(JSON.stringify(tableKeys) === JSON.stringify(declKeys) && JSON.stringify(FIELDS.TABLE.filter((f) => f.flags === 'b').map((f) => f.iface + '.' + f.field).sort()) === JSON.stringify(evDecl.sort()), 'every field and event the table reads is declared, and nothing else is (' + tableKeys.length + ' distinct fields, ' + evDecl.length + ' events, ' + Object.keys(sigs).length + ' interfaces)');
    let r = spawnSync(process.execPath, [TOOL, 'check'], { encoding: 'utf8' });
    ok(r.status === 0, 'tools/car/probe_fields.js check: ' + (r.stdout || r.stderr).trim());
    const tags = FIELDS.TABLE.map((f) => f.tag);
    ok(tags.length === NTABLE && new Set(tags).size === tags.length, 'the table: ' + tags.length + ' fields, every tag unique');
    const keys3 = FIELDS.TABLE.map((f) => f.iface + '.' + f.field + '@' + FIELDS.instOf(f));
    ok(new Set(keys3).size === keys3.length, 'no field is read twice on the same instance');
    ok(FIELDS.TABLE.every((f) => /^S([1-9]|1[013456])$/.test(f.set) && FIELDS.SETS.find((s) => s.id === f.set).items.indexOf(f.p) >= 0), 'every field is on an item (P1..P19) that belongs to its set');
    ok(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P22', 'P23', 'P24', 'P25'].every((p) => FIELDS.TABLE.some((f) => f.p === p)), 'every item P1..P19 and P22..P25 has a field');
    ok(FIELDS.SETS.every((s) => FIELDS.TABLE.some((f) => f.set === s.id)) && JSON.stringify(FIELDS.SETS.map((s) => s.id)) === '["S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S13","S14","S15","S16"]', 'the fifteen sets S1..S11 and S13..S16, each with fields');
    ok(FIELDS.TABLE.every((f) => /^(r|rs|s)$/.test(f.flags) || (f.flags === 'b' && EVSETS.indexOf(f.set) >= 0) || (f.flags === 'm' && f.set === 'S16' && f.tag === 'next-turn')), 'every field has flags r / rs / s; b (an event) only in S13..S16; m (a polled method) only S16\'s next-turn');
    const mt = FIELDS.TABLE.filter((f) => f.flags === 'm');
    ok(mt.length === 1 && mt[0].iface === TURNS.IFACE && mt[0].field === 'queryContent' && FIELDS.instOf(mt[0]) === 'Main_Instance' && mt[0].fmt === 'turns', 'the one polled method: S16 next-turn = GuidanceEventList.queryContent on Main_Instance');
    ok(FIELDS.TABLE.filter((f) => f.set === 'S6').every((f) => f.mark === true) && FIELDS.TABLE.filter((f) => f.p === 'P13').every((f) => f.gapMs <= 100 && f.cap >= 300),
        'S6: every field carries the time after the mark; the buttons and the stalk are not folded (gap <= 100 ms, cap >= 300)');
    const stalks = FIELDS.TABLE.filter((f) => f.field.indexOf('IndicatorSteeringColumn') === 0);
    ok(stalks.length === 2 && stalks.every((f) => f.iface === 'de.bmw.body.Light' && f.gapMs === 0 && f.bits && f.bits.path === 'operationColumnStalks'),
        'the stalk: Light.IndicatorSteeringColumn and ...Complete, gap 0, raw operationColumnStalks with its bit changes');
    const s6 = FIELDS.TABLE.filter((f) => f.set === 'S6');
    ok(FIELDS.interfaces().filter((e) => s6.some((f) => f.iface === e.iface)).length === 8 && s6.length === 24, 'S6 alone: ' + s6.length + ' fields on 8 interfaces');
    const multi = FIELDS.interfaces().filter((e) => e.instances.length > 1);
    ok(multi.length === 1 && short(multi[0].iface) === 'Telephone' && sigs[multi[0].iface]._instances === '*', 'only Telephone is read on two instances (1 and 2), declared "*"; every other interface names its one instance');
    const bad = FIELDS.interfaces().filter((e) => e.instances.length === 1 && String(sigs[e.iface]._instances) !== e.instances[0]);
    ok(bad.length === 0, 'the declared instance of every other interface is the one the table reads' + (bad.length ? ' - ' + bad.map((b) => short(b.iface)).join(', ') : ''));
    ok(sigs['de.bmw.infotainment.vehicle.CDS']._instances === '1', 'CDS (several sets) is declared once, instance 1');
    let cat = null;
    if (fs.existsSync(CATALOGUE)) {
        cat = readJson(CATALOGUE);
        const wrong = [];
        FIELDS.TABLE.forEach((f) => {
            if (f.flags === 'm') {
                const me = cat.interfaces[f.iface] && (cat.interfaces[f.iface].methods || {})[f.field];
                if (!me || me.methodId !== 4) wrong.push(f.tag + ': not method 4');
                if (!(FIELDS.instOf(f) in (cat.instanceIDs[f.iface] || {}))) wrong.push(f.tag + ': instance');
                return;
            }
            if (f.flags === 'b') {
                const ev = cat.interfaces[f.iface] && (cat.interfaces[f.iface].events || {})[f.field];
                if (!ev || !ev.eventId) wrong.push(f.tag + ': no such event');
                if (!(FIELDS.instOf(f) in (cat.instanceIDs[f.iface] || {}))) wrong.push(f.tag + ': instance');
                return;
            }
            const c = cat.interfaces[f.iface] && cat.interfaces[f.iface].fields[f.field];
            if (!c) { wrong.push(f.tag + ': not in the catalogue'); return; }
            const wantFlags = (c.getter && c.getter.id ? 'r' : '') + (c.notifier && c.notifier.id ? 's' : '');
            if (f.flags !== wantFlags) wrong.push(f.tag + ': flags ' + f.flags + ', the catalogue allows ' + wantFlags);
            if (c.setter && sigs[f.iface][f.field].indexOf('w') >= 0) wrong.push(f.tag + ': w');
            const known = cat.instanceIDs[f.iface] || {};
            if (!(FIELDS.instOf(f) in known)) wrong.push(f.tag + ': instance ' + FIELDS.instOf(f) + ' not in ' + JSON.stringify(Object.keys(known)));
        });
        ok(wrong.length === 0, 'every field: r iff a non-zero getter id, s iff a notifier, only those; its instance is in the catalogue' + (wrong.length ? ' - ' + wrong.slice(0, 5).join('; ') : ''));
        const o = spawnSync('python3', [CHECK, CATALOGUE, path.join(APP_DIR, 'app.json')], { encoding: 'utf8' });
        const out = (o.stdout || '') + (o.stderr || '');
        ok(o.status === 0 && /all declarations pass/.test(out), 'check_signals.py on apps/signal_probe/app.json: ' + out.trim().split('\n').pop());
        const exported = spawnSync(process.execPath, [TOOL, 'export'], { encoding: 'utf8', cwd: ROOT });
        const pf = readJson(path.join(ROOT, 'design', 'car', 'probe_fields.json'));
        ok(exported.status === 0 && pf.counts.fields === FIELDS.TABLE.length && pf.fields.every((f) => f.getterId !== null || f.notifierId !== null || f.eventId !== null || f.methodId === 4), 'design/car/probe_fields.json is current (' + pf.counts.fields + ' fields, ids from the catalogue)');
        const git = spawnSync('git', ['status', '--porcelain', 'design/car/probe_fields.json'], { encoding: 'utf8', cwd: ROOT });
        ok(!/^ M/.test(git.stdout || ''), 'design/car/probe_fields.json: re-exporting changed nothing that is committed');
    } else console.log('  skip: ' + path.relative(ROOT, CATALOGUE) + ' is not here (flags, instances, check_signals.py and the export need it)');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('3. every field against the catalogue\'s own types (a value made from them)');
    if (cat) {
        const DT = cat.datatypes;
        const base = (rf) => { let x = rf, n = 0; while (DT[x] && DT[x].type === 'typedef' && n++ < 8) x = DT[x].dataRef; return x; };
        const allMembers = (t) => (t.extends && DT[t.extends] ? allMembers(DT[t.extends]) : []).concat(t.members || []);
        const synth = (rf, opt, depth) => {
            const x = base(rf), t = DT[x];
            if (!t) {
                if (/^Utf/.test(x)) return opt.text;
                if (x === 'ByteBuffer') return Buffer.from(opt.text);
                if (x === 'Bool') return true;
                return 7;
            }
            if (t.type === 'enum') return Object.keys(t.items)[opt.pick % Object.keys(t.items).length];
            if (t.type === 'array') return depth > 7 ? [] : [synth(t.dataRef || t.elementDataRef, opt, depth + 1), synth(t.dataRef || t.elementDataRef, opt, depth + 1)];
            // a map (S16's view lists): two entries keyed by canary text (a view's name), as a plain object
            if (t.type === 'map') { const o = {}; if (depth <= 7) { o[opt.text + ' key 1'] = synth(t.valueDataRef, opt, depth + 1); o[opt.text + ' key 2'] = synth(t.valueDataRef, opt, depth + 1); } return o; }
            if (t.type === 'struct' || t.type === 'union') {
                const o = {};
                if (depth > 7) return o;
                allMembers(t).forEach((m) => { const one = () => synth(m.dataRef, opt, depth + 1); o[m.name] = m.dimension ? (depth + 1 > 7 ? [] : [one(), one()]) : one(); });
                return o;
            }
            return 7;
        };
        /** A field's type, or for an event a struct made of its outputs (the binding hands an event over as { output: value }). */
        const refOf = (f) => {
            if (f.flags === 'm') {
                // a polled method: its reply, a struct of its outputs (the binding resolves call() with { output: value })
                const mk = '__method:' + f.iface + '.' + f.field;
                if (!DT[mk]) DT[mk] = { type: 'struct', members: cat.interfaces[f.iface].methods[f.field].outputs.map((o) => ({ name: o.name, dataRef: o.dataRef, dimension: o.dimension })) };
                return mk;
            }
            if (f.flags !== 'b') return cat.interfaces[f.iface].fields[f.field].dataRef;
            const key = '__event:' + f.iface + '.' + f.field;
            if (!DT[key]) DT[key] = { type: 'struct', members: cat.interfaces[f.iface].events[f.field].outputs.map((o) => ({ name: o.name, dataRef: o.dataRef, dimension: o.dimension })) };
            return key;
        };
        const problems = [];
        let ran = 0;
        [{ text: 'Canary text 123', pick: 0 }, { text: 'CANARY_UPPER_TEXT', pick: 1 }, { text: 'Canary text 123', pick: 3 }].forEach((opt) => {
            FIELDS.TABLE.forEach((f) => {
                const v = synth(refOf(f), opt, 0);
                if (f.flags === 'm') {
                    // the error enum's own item is INVALID_VIEW_PARAMS: the events are what is checked; and a union arrives as ONE member
                    // (synth fills them all), so each event keeps one, a turn kind or another in turn
                    v.GuidanceEventListError = 'NO_ERROR';
                    const ks = ['intersection', 'roundabout', 'branch', 'destinationManeuver', 'alongMainRoad', 'laneChange', 'tunnel', 'pointOfInterest'];
                    v.viewContent.forEach((vc) => { vc.eventsInView = vc.eventsInView.map((e, i) => { const k = ks[(i + opt.pick * 2) % ks.length], o = {}; o[k] = e[k]; return o; }); });
                }
                const L = [];
                const pr = new Probe({ log: { info: (s) => L.push(s), warn: (s) => L.push('WARN ' + s) }, now: () => 1e6, table: [f] });
                pr.setSets([f.set], true);
                pr.fields[0].handler(v);
                ran++;
                const line = L[0] || '(no line)', body = line.replace(/ tms=\d+ since=\S+$/, '').replace(/ prev=-$/, '').replace(/ prev=- /, ' ');
                if (!L.length || /^WARN/.test(line)) problems.push(f.tag + ': ' + line.slice(0, 120));
                else {
                    if (CANARIES.test(line)) problems.push(f.tag + ': a canary reached the log: ' + line.slice(0, 200));
                    if (/\?/.test(body.replace(/\?\?/, ''))) problems.push(f.tag + ': a "?" (a kind the catalogue does not have): ' + body.slice(0, 200));
                    if (/=-( |$|\])/.test(body)) problems.push(f.tag + ': a "-" (a member that is not there): ' + body.slice(0, 200));
                }
            });
        });
        ok(problems.length === 0, ran + ' lines (' + FIELDS.TABLE.length + ' fields x 3 value sets): no canary, no "?", no "-"' + (problems.length ? '\n    ' + problems.slice(0, 12).join('\n    ') : ''));
        // the kinds of every column against the catalogue's types (text only ever a length, a number a number, ...)
        const want = { n: 'num', x: 'num', e: 'enum', b: 'bool', t: 'text', k: 'num', z: 'num', p: 'num' };
        const kindOf = (rf) => { const x = base(rf), t = DT[x]; if (t) return t.type; if (/^Utf|^ByteBuffer/.test(x)) return 'text'; if (x === 'Bool') return 'bool'; return /^(U?Int\d+|Float|Double)$/.test(x) ? 'num' : 'unknown:' + x; };
        let arrayOk = false;     // a 't' column may be a list's length (an event's quality list)
        const walk = (rf, p) => {
            let cur = rf, dim = false;
            for (let i = 0; i < p.length; i++) {
                let t = DT[base(cur)];
                while (t && t.type === 'array') t = DT[base(t.dataRef || t.elementDataRef)];
                if (!t || !t.members && !t.extends) return 'no members at ' + p[i];
                const mem = allMembers(t).find((x) => x.name === p[i]);
                if (!mem) return 'no member ' + p[i];
                cur = mem.dataRef; dim = !!mem.dimension;
            }
            let t = DT[base(cur)];
            if (t && t.type === 'array') dim = true;
            while (t && t.type === 'array') { cur = t.dataRef || t.elementDataRef; t = DT[base(cur)]; }
            return dim && arrayOk ? 'text' : kindOf(cur);
        };
        const bad = [];
        let nCols = 0;
        FIELDS.TABLE.forEach((f) => {
            const rf = refOf(f);
            if (f.one) { nCols++; const got = walk(rf, [f.one[0]]); if (got !== want[f.one[1]]) bad.push(f.tag + '.' + f.one[0] + ': the catalogue says ' + got); }
            const groups = [[f.cols, []], [f.list && f.list.cols, f.list && f.list.member ? [f.list.member] : []], [f.union && f.union.cols, f.union ? [f.union.member] : []],
                [f.sub && f.sub.cols, f.sub ? [f.sub.path] : []]];
            groups.forEach((g) => (g[0] || []).forEach((c) => {
                nCols++;
                arrayOk = c[2] === 't';
                const got = walk(rf, g[1].concat(Array.isArray(c[1]) ? c[1] : [c[1]]));
                arrayOk = false;
                const kind = got === 'num' && c[2] === 'x' ? 'num' : got;
                if (kind !== want[c[2]]) bad.push(f.tag + '.' + c[0] + ' (' + c[2] + '): the catalogue says ' + got);
            }));
            if (f.bits && walk(rf, [f.bits.path]) !== 'num') bad.push(f.tag + ' bits: ' + walk(rf, [f.bits.path]));
            const wantRoot = { enum: 'enum', bool: 'bool', hex: 'num', activeSource: 'text', sources: 'struct', temps: 'struct', intersection: 'struct', description: 'struct', dart: 'struct',
                lanes: 'struct', mediaMenu: 'struct', station: 'struct', metadata: 'array', roles: 'array', devices: 'array', calllist: 'array', cbs: 'union',
                views: 'struct', rendered: 'struct', stream: 'struct', turns: 'struct' }[f.fmt];
            if (f.fmt && wantRoot && kindOf(rf) !== wantRoot && !(wantRoot === 'array' && kindOf(rf) === 'array') && !(wantRoot === 'union' && /array|union/.test(kindOf(rf)))) bad.push(f.tag + ' (' + f.fmt + '): the catalogue says ' + kindOf(rf));
        });
        // a whole value (fmt tree) prints every upper-case string as an enum name: its type must have no text member at all
        const texts = [];
        const hasText = (rf, depth, seen, skip) => {
            const x = base(rf), t = DT[x];
            if (!t) return /^Utf|^ByteBuffer/.test(x);
            if (depth > 12 || seen.indexOf(x) >= 0) return false;
            if (t.type === 'array') return hasText(t.dataRef || t.elementDataRef, depth + 1, seen.concat([x]), skip);
            if (t.type === 'struct' || t.type === 'union') return allMembers(t).some((m) => skip.indexOf(m.name) < 0 && hasText(m.dataRef, depth + 1, seen.concat([x]), skip));
            return false;
        };
        const trees = FIELDS.TABLE.filter((f) => f.fmt === 'tree');
        trees.forEach((f) => { if (hasText(refOf(f), 0, [], (f.tree && f.tree.skip) || [])) texts.push(f.tag); });
        // a tree's own enum-name pattern (S16 ric-guidance's mixed-case enums): it must match every enum name its type can carry, and no free text
        const enumsOf = (rf, seen, acc) => {
            const x = base(rf), t = DT[x];
            if (!t || seen.indexOf(x) >= 0) return acc;
            if (t.type === 'enum') { Object.keys(t.items).forEach((k) => acc.push(k)); return acc; }
            if (t.type === 'array') return enumsOf(t.dataRef || t.elementDataRef, seen.concat([x]), acc);
            if (t.type === 'struct' || t.type === 'union') allMembers(t).forEach((m) => enumsOf(m.dataRef, seen.concat([x]), acc));
            return acc;
        };
        const named = trees.filter((f) => f.tree && f.tree.enumNames);
        const enumBad = [];
        named.forEach((f) => {
            const re = new RegExp(f.tree.enumNames);
            enumsOf(refOf(f), [], []).forEach((k) => { if (!/^[A-Z_][A-Z0-9_]{0,95}$/.test(k) && !re.test(k)) enumBad.push(f.tag + ': ' + k); });
            ['canary_lower', 'Canary', 'Main', 'Event street', 'Modelstreet', 'Event_'].forEach((k) => { if (re.test(k)) enumBad.push(f.tag + ' lets "' + k + '" through'); });
        });
        ok(named.length === 1 && enumBad.length === 0, 'a tree\'s own enum-name pattern (' + named.map((f) => f.tag).join(', ') + ') matches every enum name of its type in the catalogue and no free text' + (enumBad.length ? ': ' + enumBad.slice(0, 5).join('; ') : ''));
        ok(trees.length === 43 && texts.length === 0, 'the ' + trees.length + ' whole values (tree) have no text member in the catalogue (a member they skip aside: the fused list\'s frame name), so an upper-case string is an enum name' + (texts.length ? ': ' + texts.join(', ') : ''));
        ok(bad.length === 0, 'the table against the catalogue\'s types (' + nCols + ' columns): no text member is read as a number, enum or bool, and every path exists' + (bad.length ? '\n    ' + bad.slice(0, 12).join('\n    ') : ''));
    } else console.log('  skip: the catalogue is not here');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('4. every field\'s line from an injected value (fake clock, canary text in every text member)');
    ok(VECTORS.length === FIELDS.TABLE.length && VECTORS.length === NTABLE && FIELDS.TABLE.every((f) => VECTORS.some((v) => v.tag === f.tag && v.iface === f.iface && v.field === f.field && v.instance === FIELDS.instOf(f))),
        'a vector for every one of the ' + FIELDS.TABLE.length + ' fields');
    const a = mk({});
    a.pr.setSets(FIELDS.SETS.map((s) => s.id), false);
    await settleOf(a);
    ok(a.lines.some((l) => /^probe: sets on=S1\+S2\+S3\+S4\+S5\+S6\+S7\+S8\+S9\+S10\+S11\+S13\+S14\+S15\+S16 changed=\+S1,\+S2,\+S3,\+S4,\+S5,\+S6,\+S7,\+S8,\+S9,\+S10,\+S11,\+S13,\+S14,\+S15,\+S16 fields=251 \(first set on\)$/.test(l)), 'all fifteen sets on: the log says so');
    ok(a.signals.count('watch') === FIELDS.interfaces().reduce((n, e) => n + e.instances.length, 0) && a.signals.count('watch') === 95, 'one proxy per interface instance (' + a.signals.count('watch') + ' watch calls)');
    let nOk = 0;
    VECTORS.forEach((v) => {
        a.clock.t += 15000;
        const st = a.pr.fields.find((x) => x.f.tag === v.tag);
        st.handler(v.value);
        const got = a.fieldLines().filter((l) => new RegExp('^probe: ' + v.p + ' ' + v.tag + ' #1 t=').test(l));
        // a long body comes in parts ("(part 1/N)" on the first line, then "#1 part k/N: ..."): joined, it is the whole body
        const more = a.fieldLines().filter((l) => new RegExp('^probe: ' + v.p + ' ' + v.tag + ' #1 part ').test(l)).map((l) => l.replace(/^probe: P\d+ \S+ #1 part \d+\/\d+: /, ''));
        const body = got.length === 1 ? [bodyOf(got[0]).replace(/ \(part 1\/\d+\)$/, '')].concat(more).join(' ') : '(' + got.length + ' lines)';
        const okk = got.length === 1 && (typeof v.body === 'string' ? body === v.body : new RegExp(v.body.re).test(body));
        if (okk) nOk++; else ok(false, v.p + ' ' + v.tag + ': ' + body + (typeof v.body === 'string' ? '\n         wanted ' + v.body : ''));
    });
    ok(nOk === VECTORS.length, nOk + ' of ' + VECTORS.length + ' fields: the exact line');
    ok(!CANARIES.test(a.lines.join('\n')), 'no text of a message, source, song, call, road, device or service in the log (canary words in every text member)');
    ok(!/12000|STREET|A 9/.test(a.fieldLines().filter((l) => /next-intersection/.test(l)).join('').replace(/raw=12000\.5/, '')), 'the road text and the shield text of P12 are lengths only');
    const st0 = a.pr.stats();
    ok(st0.length === NTABLE && st0.every((s) => s.events === 1 && s.lines === 1 && s.active), 'stats(): ' + NTABLE + ' fields, one event and one line each');
    ok(a.fieldLines().every((l) => /^probe: P\d+ [A-Za-z0-9-]+ #\d+ (t=\d+(\.\d)?|part \d+\/\d+): /.test(l)), 'every field line has the documented shape "probe: P<n> <tag> #<k> t=<s>: ..." (a whole value\'s later parts: "#<k> part i/N: ...")');
    ok(a.fieldLines().filter((l) => /P(11|13) /.test(l)).every((l) => / tms=\d+ since=-$/.test(l)), 'S6 lines end with tms=<ms> since=- (no mark yet)');
    ok(/heading=set/.test(a.fieldLines().filter((l) => / heading #1/.test(l))[0]) && !/27[0-9]\.25|135/.test(a.fieldLines().filter((l) => / (heading|gps-ext) #1/.test(l)).join('')), 'a bearing is never printed: only heading=set');
    ok(!/4711|\+000|\b9\b.*contact/.test(a.fieldLines().filter((l) => /phone-call1-(contact|number)/.test(l)).join('')), 'a contact id and a number are never printed (known / unknown, a length)');
    ok(a.fieldLines().filter((l) => /P8 station/.test(l)).every((l) => /freq=fm-range/.test(l) && !/101700/.test(l)), 'a frequency is printed only as its band');
    ok(a.fieldLines().filter((l) => /P8 cp-device/.test(l)).every((l) => /device=known/.test(l)), 'a media device id is printed only as known');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('5. the engine');
    // once per change; gap folding; cap
    const S1 = mk({}, {}, null);
    S1.pr.setSets(['S1'], true); await settleOf(S1);
    const act = VECTORS.find((v) => v.tag === 'active-cc');
    const hs = (v) => feedTag(S1, 'active-cc', v);
    hs(act.value); hs(JSON.parse(JSON.stringify(act.value))); hs(act.value);
    ok(S1.fieldLines().length === 1, 'the same value three times: one line');
    S1.clock.t += 600;
    hs(Object.assign({}, act.value, { numberDisplayControlCheckControlMessage: 0 }));
    S1.clock.t += 600;
    hs(act.value);
    ok(S1.fieldLines().length === 3 && /#3 /.test(S1.fieldLines()[2]) && /number=15/.test(S1.fieldLines()[2]), 'a change and back: two more lines, numbered #2 and #3');
    // gap folding (S1 gap 500 ms): three changes inside one gap -> one line with the last value and "+2 folded"
    const G = mk({}); G.pr.setSets(['S1'], true); await settleOf(G);
    const dsp = (n) => ({ statusNumberCheckControlMessageDisplay: n });
    G.clock.t += 5000; feedTag(G, 'displayed-cc', dsp(1));
    G.clock.t += 100; feedTag(G, 'displayed-cc', dsp(2));
    G.clock.t += 100; feedTag(G, 'displayed-cc', dsp(3));
    G.clock.t += 100; feedTag(G, 'displayed-cc', dsp(4));
    ok(G.fieldLines().length === 1, 'changes faster than the gap are held back (one line so far)');
    G.clock.t += 600; G.pr.tick();
    ok(G.fieldLines().length === 2 && /number=4 \(\+2 folded\)$/.test(G.fieldLines()[1]), 'the held line goes out at the next tick with the last value and "(+2 folded)" (two held values replaced): ' + G.fieldLines()[1]);
    // a held value that goes back to the logged one is not a line at all
    G.clock.t += 50; feedTag(G, 'displayed-cc', dsp(9)); G.clock.t += 50; feedTag(G, 'displayed-cc', dsp(4));
    G.clock.t += 600; G.pr.tick();
    ok(G.fieldLines().length === 2, 'a value that went away and came back inside the gap makes no line');
    // cap
    const C = mk({}); C.pr.setSets(['S1'], true); await settleOf(C);
    for (let i = 0; i < 130; i++) { C.clock.t += 1000; feedTag(C, 'displayed-cc', dsp(i)); }
    const cl = C.fieldLines().filter((l) => / displayed-cc /.test(l));
    ok(cl.length === 100 && /\(the last line for this field\)$/.test(cl[99]), 'a field makes at most its cap of lines (100 in S1), the last one says so');
    // flood guard: many fields change in one second
    const FL = mk({}); FL.pr.setSets(['S2'], true); await settleOf(FL);
    const s2 = FL.pr.fields.filter((x) => x.f.set === 'S2' && x.f.cols);
    FL.clock.t += 5000;
    for (let rep = 0; rep < 4; rep++) s2.forEach((x, i) => x.handler(Object.assign({}, VECTORS.find((v) => v.tag === x.f.tag).value, { fuel: rep * 3 + i })));
    // (the values differ only through members that exist in some of them: what counts is that no more than 40 lines go out per second)
    const burst = FL.fieldLines().length;
    ok(burst <= 40, 'the flood guard: ' + burst + ' lines in one second (at most 40)');
    // sets: lazy subscription, shared interfaces, nothing logged while off
    const Z = mk({});
    ok(Z.signals.calls.length === 0 && Z.pr.setsOn().length === 0, 'a new probe subscribes nothing');
    Z.pr.setSets(['S3'], true); await settleOf(Z);
    ok(Z.signals.count('watch') === 6 && Z.signals.calls.filter((c) => c.op === 'watch').every((c) => /DoorsWindows|A4A|Vehicle2|BasicDataSet|LevelMonitor|CDS/.test(c.iface)), 'switching S3 on subscribes exactly its interfaces: ' + Z.signals.calls.filter((c) => c.op === 'watch').map((c) => short(c.iface) + '[' + c.inst + ']').join(', '));
    ok(Z.signals.calls.filter((c) => c.op === 'watch').every((c) => c.fields.every((f) => FIELDS.TABLE.some((t) => t.set === 'S3' && t.field === f && t.iface === c.iface))), 'only S3\'s fields were handed to watch');
    ok(Z.signals.calls.filter((c) => c.op === 'watch').map((c) => c.poll).every((p) => p === undefined), 'no polling for S3');
    // an off set logs nothing even if the car sends (handlers stay, muted)
    Z.signals.feed('de.bmw.infotainment.vehicle.Vehicle2', '1', 'statusZVStatus', { statusCentralLockingSystem: 5 });
    ok(Z.fieldLines().length === 1, 'an arrival on a field of a set that is on: a line');
    Z.pr.setSets([], false);
    Z.clock.t += 5000;
    Z.signals.feed('de.bmw.infotainment.vehicle.Vehicle2', '1', 'statusZVStatus', { statusCentralLockingSystem: 9 });
    ok(Z.fieldLines().length === 1 && /sets on=none changed=-S3/.test(Z.lines.join('\n')), 'S3 off: the same field now logs nothing, and the log says the set went off');
    Z.pr.setSets(['S3'], false); await settleOf(Z);
    ok(Z.signals.count('watch') === 6, 'S3 on again: no new proxies (they were kept)');
    ok(Z.signals.count('get') === FIELDS.TABLE.filter((f) => f.set === 'S3' && f.flags.indexOf('r') >= 0).length && Z.signals.calls.filter((c) => c.op === 'get').every((c) => c.field !== undefined),
        'S3 on again: one read-only getter ask for each of its r fields (no value arrives on its own)');
    // shared interfaces: S1 then S6 both need KombiIF / Vehicle2: one proxy, the second set's fields via on() + one get
    const SH = mk({}, { answers: { statusKombiSelection: { statusActivationInstrumentPackBC: 3 } } });
    SH.pr.setSets(['S1'], true); await settleOf(SH);
    const kw = () => SH.signals.calls.filter((c) => c.op === 'watch' && /KombiIF$/.test(c.iface));
    ok(kw().length === 1 && kw()[0].fields.length === 2, 'S1: KombiIF watched once with S1\'s two fields (' + kw()[0].fields.join(', ') + ')');
    SH.pr.setSets(['S1', 'S6'], true); await settleOf(SH);
    ok(kw().length === 1, 'S6 on beside S1: KombiIF is NOT watched a second time');
    const ons = SH.signals.calls.filter((c) => c.op === 'on' && /KombiIF\|1$/.test(c.key)).map((c) => c.field).sort();
    ok(JSON.stringify(ons) === '["statusConfigurationKombi5","statusKombiSelection","statusKombiSelectionAvailability"]', 'S6\'s three KombiIF fields were added to the running proxy with on(): ' + ons.join(', '));
    ok(SH.signals.calls.some((c) => c.op === 'get' && c.field === 'statusKombiSelection'), 'and their getters were read once');
    SH.clock.t += 1000;
    SH.signals.feed('de.bmw.infotainment.KombiIF', '1', 'statusKombiSelection', { statusActivationInstrumentPackBC: 7 });
    SH.signals.feed('de.bmw.infotainment.KombiIF', '1', 'statusActiveCCMessage', act.value);
    ok(SH.fieldLines().filter((l) => /kombi-selection|active-cc/.test(l)).length === 3, 'both sets\' fields on the shared interface log (three lines: the getter\'s answer, the arrival, the other set\'s arrival)');
    // S10 shares eight fields with S6 / S7 (also: ['S10']): one subscription, one state, two holders
    const X = mk({});
    X.pr.setSets(['S10'], true); await settleOf(X);
    const act10 = () => X.pr.stats().filter((q) => q.active).length;
    ok(act10() === 15 && FIELDS.TABLE.filter((f) => f.set === 'S10').length === 7, 'S10 alone: its 7 fields and the 8 of S6 / S7 it needs are on (' + act10() + ')');
    X.pr.setSets(['S10', 'S6'], true); await settleOf(X);
    ok(act10() === 33, 'S10 + S6: the shared fields are not counted twice (33 fields)');
    X.clock.t += 5000;
    feedTag(X, 'kombi-selection', { statusActivationInstrumentPackBC: 5 });
    X.pr.setSets(['S6'], true);
    ok(act10() === 24 && X.pr.stats().find((q) => q.tag === 'kombi-selection').active, 'S10 off while S6 stays: the shared field stays on (24 fields), the other S10 fields go off');
    X.clock.t += 5000;
    feedTag(X, 'kombi-selection', { statusActivationInstrumentPackBC: 6 });
    ok(X.fieldLines().filter((l) => / kombi-selection #/.test(l)).length === 2, 'and it keeps logging, numbered on (#1, #2)');
    X.pr.setSets([], true);
    ok(act10() === 0, 'every set off: nothing is on');
    // the black box's own signals: a gearbox counter is never logged
    const GB = mk({}); GB.pr.setSets(['S10'], true);
    feedTag(GB, 'gearbox-secure', { cRC_DataDisplayGearbox: 123, aLIV_DataDisplayGearbox: 14, dummy4: 'D' });
    ok(!/123|14\b/.test(bodyOf(GB.fieldLines()[0])), 'the alive and CRC counters of the gearbox display are not logged: ' + bodyOf(GB.fieldLines()[0]));
    // S13: events, a single-output event handed over bare or as { output: v }; no sign position, location or time stamp
    const EV = mk({}); EV.pr.setSets(['S13'], true); await settleOf(EV);
    const evw = EV.signals.calls.filter((c) => c.op === 'watch');
    ok(evw.length === 5 && evw.some((c) => /CCP$/.test(c.iface) && c.fields.length === 4), 'S13 subscribes its 5 interfaces; the CCP events go to watch like fields (' + evw.map((c) => short(c.iface)).join(', ') + ')');
    EV.signals.feed('de.bmw.infotainment.navigation.externalize.adasng.CCP', '1', 'effectiveSpeedLimit', 30);
    EV.clock.t += 1000;
    EV.signals.feed('de.bmw.infotainment.navigation.externalize.adasng.CCP', '1', 'effectiveSpeedLimit', { speedLimit: 50 });
    const cl13 = EV.fieldLines().filter((l) => /ccp-limit/.test(l)).map(bodyOf);
    ok(cl13.join('|') === 'speedLimit=30|speedLimit=50', 'a one-output event: bare or wrapped, the same line (' + cl13.join(' | ') + ')');
    EV.clock.t += 1000;
    EV.signals.feed('de.bmw.environmentalmodel.SignRecognitionFrontCamera', '1', 'TrafficSignRecognitionFrontCamera', VECTORS.find((v) => v.tag === 'cam-signs').value);
    const camL = EV.fieldLines().filter((l) => /cam-signs/.test(l))[0] || '';
    ok(/value=30/.test(camL) && !/12\.5|3\.25|1\.75|123456|98765|left|right|overhead/.test(camL), 'a camera sign: its value, type and qualifiers; never its position, location or time stamp');
    EV.clock.t += 121000; EV.pr.tick(); await sleep(30);
    ok(EV.lines.some((l) => /ask P22 tsr \(silent at \+120s\): an event \(no getter\)/.test(l)) && EV.signals.calls.filter((c) => c.op === 'get').every((c) => /statusSLITextMessage|statusRoadSignConfigStatus/.test(c.field)),
        'a silent event is not asked (no getter); only the two FASuS fields are');
    // S14 / S15 (the owner, 2026-11-19): every metric of the distance control, the camera's objects, the car's own motion
    const S14 = mk({}); S14.pr.setSets(['S14'], true); await settleOf(S14);
    const on14 = S14.pr.fields.filter((st) => st.active).map((st) => st.f.tag);
    ok(['front-vehicle', 'ldm-guidance', 'longitudinal', 'hud-data', 'hud-data2', 'assist-avail', 'foresight', 'keep-dist-1', 'gap-ahead', 'speed', 'accel-long-cog'].every((t) => on14.indexOf(t) >= 0) &&
        on14.length === FIELDS.TABLE.filter((f) => f.set === 'S14').length + 7, 'S14 alone also reads the seven assistance fields of S8 (front vehicle, ldm guidance, hud, ...): ' + on14.length + ' fields');
    ok(FIELDS.TABLE.filter((f) => f.set === 'S14' || f.set === 'S15').every((f) => f.flags !== 'b' || f.fmt === 'tree' || f.cols), 'every S14 / S15 event is read whole (tree) or by columns');
    const T = FMT.fmtTree;
    const e2e = { length: 40, counter: 7, dataID: 123456, cRC: 98765, timestamp: { nanoseconds: 5, seconds: 1700000000, sync_state: 'SYNC' }, eventDataQualifier: 'EVENT_DATA_AVAILABLE',
        numberOfObjects: 3, objects: [{ id: 1, positionX: 25.5, length: 4.5, invalidFlag: false }, { id: 2, positionX: 40, length: 12, invalidFlag: true }, { id: 3, positionX: 60, length: 4.2, invalidFlag: false }],
        latitudeWgs: 50.45, longitude: 30.52, aliveCounter: 9, cRcSomething: 3, counterSyncX: 4, dummy: 0, speed: { speed: 21.5, invalidFlag: false } };
    const tl = T(e2e);
    ok(tl === 'eventDataQualifier=EVENT_DATA_AVAILABLE numberOfObjects=3 objects=3 [id=1 positionX=25.5 length=4.5] [id=2 positionX=40 length=12 objects.invalidFlag=true] [id=3 positionX=60 length=4.2] speed=21.5',
        'tree: numbers and enum names; no end-to-end header (crc, data id, counters), time stamp, alive counter, dummy or coordinate on the globe; an object\'s own length stays; an invalid flag only when set: ' + tl);
    ok(T(e2e, { entries: 2 }).indexOf('[id=3') < 0 && / \+1 more /.test(T(e2e, { entries: 2 })), 'tree: at most `entries` elements of a list, then "+N more"');
    ok(/ \+cut$/.test(T(e2e, { max: 60 })) && T(e2e, { max: 60 }).length <= 66, 'tree: the line stops at `max` characters with "+cut"');
    ok(T({ posX: 1, vx: 2 }, { skip: ['posX'] }) === 'vx=2' && T({ KeepDistObjSpeed0: 3 }, { strip: ['KeepDistObj'] }) === 'Speed0=3', 'tree: a field\'s own skip list and name prefixes');
    ok(T({ raw: Buffer.from('Canary text') }) === 'raw.len=11' && T({ text: 'Canary text' }) === 'text.len=11' && T({ e: 'SOME_ENUM' }) === 'e=SOME_ENUM', 'tree: a buffer or a non-enum text only as its length');
    const P = require(path.join(APP_DIR, 'probe.js'));
    const longBody = Array.from({ length: 300 }, (x, i) => 'k' + i + '=' + (i * 1.25)).join(' ');
    const parts = P.splitBody(longBody);
    ok(parts.length > 1 && parts.every((x) => x.length <= P.PART_CHARS && x[0] !== ' ') && parts.join(' ') === longBody, 'a long whole value in ' + parts.length + ' parts of at most ' + P.PART_CHARS + ' characters, cut between tokens, nothing lost');
    const S15 = mk({}); S15.pr.setSets(['S15'], true); await settleOf(S15);
    feedTag(S15, 'ego-motion', { extendedQualifierProperMotionVehicle: 1, eventDataQualifierProperMotionVehicle: 2, xPositionProperMotionVehicle: 31337, yPositionProperMotionVehicle: 31338, yawAngleProperMotionVehicle: 31339, xPositionDeltaProperMotionVehicle: 12, counterSyncProperMotionVehicle: 31340 });
    const egoL = S15.fieldLines().filter((l) => /ego-motion/.test(l)).join(' ');
    ok(/xPositionDeltaProperMotionVehicle=12/.test(egoL) && !/3133[789]|31340/.test(egoL), 'the car\'s own dead-reckoned position, heading and sync counter are never logged; its motion deltas are: ' + bodyOf(egoL));
    const objs = []; for (let i = 0; i < 8; i++) objs.push({ objectID: i, positionX: 10 + i * 7.5, positionY: -1.75 + i, existenceProbability: 90 + i, classificationType: 'CAR_WITH_OR_WITHOUT_TRAILER', statusMovement: 'MOVING' });
    S15.clock.t += 5000;
    feedTag(S15, 'object-info1', { eventDataQualifier: 'EVENT_DATA_AVAILABLE', objectRecognition: { numberOfObjects: 8, objectRecognitionInfo: objs } });
    const oi = S15.fieldLines().filter((l) => / object-info1 #1 /.test(l));
    const joined = [bodyOf(oi[0]).replace(/ \(part 1\/\d+\)$/, '')].concat(oi.slice(1).map((l) => l.replace(/^probe: P\d+ \S+ #1 part \d+\/\d+: /, ''))).join(' ');
    ok(oi.length >= 2 && /\(part 1\/\d+\)$/.test(oi[0]) && /#1 part 2\/\d+: /.test(oi[1]) && joined === S15.pr._body(S15.pr.fields.find((st) => st.f.tag === 'object-info1'), { eventDataQualifier: 'EVENT_DATA_AVAILABLE', objectRecognition: { numberOfObjects: 8, objectRecognitionInfo: objs } }),
        'eight camera objects: one value in ' + oi.length + ' lines ("part i/N"), joined it is the whole line');
    // S16 (car issues NV, 2026-11-19): the next turn while CarPlay guides - every candidate, all of S7, the cluster's view fields
    const S16 = mk({}); S16.pr.setSets(['S16'], true); await settleOf(S16);
    const on16 = S16.pr.fields.filter((st) => st.active).map((st) => st.f.tag);
    const s7tags = FIELDS.TABLE.filter((f) => f.set === 'S7').map((f) => f.tag);
    ok(s7tags.every((t) => on16.indexOf(t) >= 0) && on16.indexOf('kombi-config') >= 0 && on16.indexOf('display-kombi') >= 0 &&
        on16.length === FIELDS.TABLE.filter((f) => f.set === 'S16').length + s7tags.length + 2, 'S16 alone also reads all ' + s7tags.length + ' fields of S7 and the cluster\'s two view fields: ' + on16.length + ' fields');
    const w16 = S16.signals.calls.filter((c) => c.op === 'watch').map((c) => short(c.iface) + '[' + c.inst + ']');
    ok(['ProjectedModeGuiding[Main_Instance]', 'GuidanceEventList[Main_Instance]', 'GuidanceRenderedContent[Main_Instance]', 'CarPlay[CarPlayAMInst1]', 'RICServiceGuidance[1]', 'DisplaySink[1]',
        'NavigationCAN[1]', 'FeedbackLaneGuiding[1]', 'Guidance[Main_Instance]', 'CarPlayManager[CarPlayManagerInst1]', 'LaneGuiding[1]', 'KombiIF[1]', 'Vehicle2[1]'].every((x) => w16.indexOf(x) >= 0) && w16.length === 15,
        'S16 subscribes 15 interface instances, one proxy each: ' + w16.join(', '));
    const g16 = (tag) => S16.pr.fields.find((st) => st.f.tag === tag);
    ok(g16('event-list').gap === 5000 && g16('event-list').cap === 300 && g16('rendered').gap === 2000 && g16('pm-waypoints').gap === 5000 && g16('lane-feedback').gap === 5000 && g16('nav-can').gap === 10000 &&
        FIELDS.TABLE.filter((f) => f.set === 'S16').every((f) => g16(f.tag).gap >= 250 && g16(f.tag).cap <= 400),
        'S16\'s volume (the kit log turns over at 256 KB): the moving distances at most every 2 to 10 s, the rare events every 250 ms, at most 400 lines a field');
    const gw = S16.signals.calls.filter((c) => c.op === 'watch' && /guiding\.Guidance$/.test(c.iface))[0];
    ok(gw && gw.fields.indexOf('streamStatusChanged') >= 0 && gw.fields.indexOf('activeRouteChanged') >= 0 && gw.fields.indexOf('conclusiveDart') >= 0, 'Guidance: the two events go to the same watch as its fields (one proxy)');
    const B16 = (tag) => bodyOf(S16.fieldLines().filter((l) => new RegExp(' ' + tag + ' #').test(l)).pop() || '');
    const viewsVec = VECTORS.find((v) => v.tag === 'event-list').value;
    const evs = viewsVec.content.viewsContent.CANARY_VIEW_KOMBI.eventsInView;
    const asMap = new Map(); asMap.set('CANARY_VIEW_KOMBI', viewsVec.content.viewsContent.CANARY_VIEW_KOMBI);
    const shapes = [
        ['object', viewsVec],
        ['pairs', { content: { viewsContent: [{ key: 'CANARY_VIEW_KOMBI', value: viewsVec.content.viewsContent.CANARY_VIEW_KOMBI }], currentDistances: viewsVec.content.currentDistances } }],
        ['pairs', { content: { viewsContent: [['CANARY_VIEW_KOMBI', viewsVec.content.viewsContent.CANARY_VIEW_KOMBI]], currentDistances: viewsVec.content.currentDistances } }],
        ['map', { viewsContent: asMap, currentDistances: viewsVec.content.currentDistances }],
    ];
    const shapeBodies = shapes.map((x) => { S16.clock.t += 5000; S16.pr.fields.find((st) => st.f.tag === 'event-list').last = undefined; feedTag(S16, 'event-list', x[1]); return B16('event-list'); });
    const oneView = (b) => b.replace(/^views=1 shape=\w+ /, '');
    ok(shapes.every((x, i) => new RegExp('^views=1 shape=' + x[0] + ' \\[id-len=17 ').test(shapeBodies[i])) && shapeBodies.every((b) => oneView(b) === oneView(shapeBodies[0])),
        'a view list as an object, as {key, value} pairs, as [key, value] pairs, as a Map, wrapped in { content } or bare: the same line (the view\'s name only as its length)');
    ok(/\{intersection direction=LEFT geometry=TWO_WAY_FORK_TAKE_LEFT dist-len=3 unit=METER raw=350 step=GS2 /.test(shapeBodies[0]) && /\{roundabout exit=2 angle=270 side=RIGHT /.test(shapeBodies[0]) && / \+1 more\] toFinal=5700 /.test(shapeBodies[0]) && evs.length === 4,
        'an event list: the first three events with kind, direction / exit, distance and step, then "+1 more", then the car\'s distances');
    ok(!/CANARY|STREET|50\.43|30\.98|4711/.test(S16.lines.join('\n')), 'no view name, road text, road-link coordinate or source id in the log');
    const big16 = { content: { viewsContent: {}, currentDistances: {} } };
    for (let i = 0; i < 6; i++) big16.content.viewsContent['CANARY_V' + i] = { configSequenceId: i, indexedPosition: { valid: true, ccpOffset: 0, totalElementCount: 9 }, eventsInView: evs.concat(evs) };
    S16.clock.t += 5000; feedTag(S16, 'event-list', big16);
    const bl = S16.fieldLines().filter((l) => / event-list #/.test(l) || / event-list #\d+ part /.test(l));
    const lastN = (bl[bl.length - 1].match(/ event-list #(\d+)/) || [])[1];
    const bigLines = S16.fieldLines().filter((l) => new RegExp(' event-list #' + lastN + '( |: )').test(l) || new RegExp(' event-list #' + lastN + ' part ').test(l));
    const bigBody = [bodyOf(bigLines[0]).replace(/ \(part 1\/\d+\)$/, '')].concat(bigLines.slice(1).map((l) => l.replace(/^probe: P\d+ \S+ #\d+ part \d+\/\d+: /, ''))).join(' ');
    ok(bigLines.length > 1 && bigLines.every((l) => l.length < 1200) && /^views=6 shape=object /.test(bigBody) && (bigBody.match(/ \+5 more\]/g) || []).length === 4 && / \+2 more toFinal=-/.test(bigBody),
        'six views of eight events: four views of three events each, "+5 more" per view and "+2 more" views, in parts of at most 1000 characters (' + bigLines.length + ' lines)');
    S16.clock.t += 5000;
    feedTag(S16, 'rendered', { viewId: 'CANARY_VIEW', viewContent: { ramsesSceneId: 16778000, type: { contentType: 'JUNCTION_VIEW', options: [] }, associatedEvent: { roundabout: { exitNumber: 3, exitAngle: 180, driveDirection: 'LEFT', formattedDistance: { distance: '200', unit: 'METER', rawDistance: 200 } } } } });
    ok(/^view-len=11 scene=16778000\(0x1000310\) occurrence=- seq=- type=JUNCTION_VIEW options=none bar=- labels=- tags=- event=\{roundabout exit=3 angle=180 side=LEFT dist-len=3 unit=METER raw=200 /.test(B16('rendered')),
        'a rendered guidance content: the RAMSES scene id in decimal and hex (to compare with cluster-render\'s DCSM content ids), its type and the event it shows: ' + B16('rendered').slice(0, 120));
    S16.clock.t += 5000;
    feedTag(S16, 'pm-stream', { stopStream: { dummy: true } });
    ok(B16('pm-stream') === 'command=stopStream', 'a stream command handed over bare: "command=stopStream"');
    S16.clock.t += 5000;
    feedTag(S16, 'pm-stream', { streamCommand: { resizeStream: { config: { renderSize: { horizontalSize: 700, verticalSize: 213 }, categoryRect: { left: 0, top: 0, width: 700, height: 213 }, safeArea: { polygon: { pointList: [{ posX: 1, posY: 2 }, { posX: 3, posY: 4 }, { posX: 5, posY: 6 }] } } } } } });
    ok(B16('pm-stream') === 'command=resizeStream size=700x213 rect=0,0+700x213 safe=polygon points=3', 'a resize with a polygon safe area: the point count, not the points: ' + B16('pm-stream'));
    S16.clock.t += 5000;
    feedTag(S16, 'pm-waypoints', VECTORS.find((v) => v.tag === 'pm-waypoints').value);
    ok(!/33\.3|50\.43|30\.98/.test(S16.fieldLines().filter((l) => /pm-waypoints/.test(l)).join('')), 'the projected destination: its distance, times and flags; never its position or its bearing');
    S16.clock.t += 121000; S16.pr.tick(); await sleep(30);
    ok(S16.lines.some((l) => /ask P25 ric-guidance \(silent at \+120s\): an event \(no getter\)/.test(l)) && S16.lines.some((l) => /ask P25 pm-road \(silent at \+120s\): /.test(l)),
        'at +120 s a silent S16 event is not asked, a silent S16 field is (read-only getter)');
    ok(S16.lines.some((l) => /ask P25 next-turn \(silent at \+120s\): a polled method \(no getter\): never called \(the phone has not guided\)/.test(l)) && S16.signals.count('call') === 0,
        '... and the polled method is not asked either: no provider was read, so no call was ever made');

    // car issues CT: S16 next-turn - GuidanceEventList.queryContent, asked only while the phone guides, one call in flight, every 2 s
    {
        const GU = 'de.bmw.infotainment.navigation.guiding.Guidance', GI = 'Main_Instance';
        const rig = (replies, cfg) => { const r = mk({}, Object.assign({ replies }, cfg || {})); r.pr.setSets(['S16'], true); return r; };
        const callsOf = (r) => r.signals.calls.filter((c) => c.op === 'call');
        const ntOf = (r) => r.fieldLines().filter((l) => / next-turn #/.test(l));
        const pollOf = (r) => r.lines.filter((l) => /^probe: poll P25 next-turn: /.test(l));
        const step = async (r, ms, n) => { for (let i = 0; i < (n || 1); i++) { r.clock.t += ms; r.pr.tick(); await sleep(1); await sleep(1); } };
        const prov = (r, v) => r.signals.feed(GU, GI, 'guidingProvider', v);

        let k = 0;
        const R = rig(() => FX.ROUTE[Math.min(k++, FX.ROUTE.length - 1)].reply);
        await settleOf(R);
        await step(R, 1000, 5);
        ok(callsOf(R).length === 0 && pollOf(R).length === 0, 'S16 on, no provider read yet: no call');
        prov(R, 'NONE'); await step(R, 1000, 5);
        ok(callsOf(R).length === 0, 'BMW\'s own navigation (provider NONE): no call');
        prov(R, 'CAR_PLAY'); await step(R, 1000);
        const c0 = callsOf(R)[0] || {};
        ok(callsOf(R).length === 1 && c0.method === 'queryContent' && c0.key === TURNS.IFACE + '|' + GI && c0.ms === 3000 && R.signals.count('proxy') === 0,
            'provider CAR_PLAY: one call at the next tick, queryContent on the watch\'s own GuidanceEventList proxy (no second proxy), the binding\'s timeout 3000 ms');
        const vp = c0.params && c0.params.viewConfigs && c0.params.viewConfigs[0];
        ok(vp && c0.params.viewConfigs.length === 1 && JSON.stringify(vp.viewport.startPoint) === '{"anchorPoint":{"standardReferencePoint":"CCP"},"offsets":[]}' && vp.viewport.maxElementCount === 4 &&
            JSON.stringify(vp.viewport.endPoints) === '[]' && vp.viewport.includedTypes.join() === 'INCLUDE_ACTIVE_MANEUVERS,INCLUDE_DESTINATIONS,INCLUDE_TUNNELS,INCLUDE_ALONG_MAIN_ROAD' &&
            JSON.stringify(vp.options) === '[]' && vp.minimumUpdateIntervalMs === 0 && vp.segmentItemRasterLength === 0 && Object.keys(c0.params).join() === 'viewConfigs',
            'the request: one view from CCP, no offsets, 4 events, no end points, active manoeuvres + destinations + tunnels + along the main road; no options, interval 0, raster 0');
        ok(pollOf(R).some((l) => /: on \(every 2 s, timeout 3 s\)$/.test(l)) && pollOf(R).some((l) => /: first call: answered, 2 events \(calls 1, answered 1, errors 0, timeouts 0\)$/.test(l)),
            'the log: the poll is on, and the first call\'s outcome (answered, 2 events)');
        ok(ntOf(R).length === 1 && /^answered events=2 total=2 \[intersection direction=LEFT geometry=UNDEFINED dist=400 unit=METER raw=1 uid=set toDest=2400 step=GS2 desc=1\/14\] \[destinationManeuver position=RIGHT flag=true stopover=0 dist-len=1 unit=NONE raw=500 uid=set toDest=2400 step=GS1 desc=1\/10\] next=0 toFinal=0 toNext=-1$/.test(bodyOf(ntOf(R)[0])),
            'the reply\'s line: kind, direction, the phone\'s distance and unit, raw, uid, step, the description as counts; next=0: ' + bodyOf(ntOf(R)[0] || ''));
        await step(R, 1000);
        ok(callsOf(R).length === 1, '1 s later: no call (every 2 s)');
        await step(R, 1000);
        ok(callsOf(R).length === 2, '2 s later: the second call');
        await step(R, 1000, 16);
        ok(callsOf(R).length === 10 && ntOf(R).length === 10 && /dist=1\.2 unit=KM/.test(ntOf(R)[3]) && /\[roundabout exit=2 angle=180 side=RIGHT dist=200 unit=METER/.test(ntOf(R)[6]) && /^answered events=0 total=0 next=none toFinal=0 toNext=-1$/.test(bodyOf(ntOf(R)[9])),
            'the route (three turns and a roundabout, then none): one call every 2 s, each changed reply a line ("1,2" KM prints as 1.2; the roundabout\'s exit; no event: next=none)');
        await step(R, 1000, 8);
        ok(callsOf(R).length === 14 && ntOf(R).length === 10, 'the same reply four times more: no line');
        k = 3; await step(R, 1000, 2);
        ok(ntOf(R).length === 11 && / \(\+4 unchanged\)$/.test(ntOf(R)[10]), 'the next changed reply\'s line counts the unchanged ones: "(+4 unchanged)"');
        ok(!/вулиця|проспект|площа|Приклад/.test(R.lines.join('\n')), 'no road name in any line (lengths only)');
        prov(R, 'NONE'); await step(R, 1000, 4);
        const nCalls = callsOf(R).length;
        ok(pollOf(R).some((l) => /: off \(off\) \(calls \d+, answered \d+, errors 0, timeouts 0\)$/.test(l)), 'the provider goes back (NONE): the poll is off, logged with its counts');
        await step(R, 1000, 6);
        ok(callsOf(R).length === nCalls, '... and no call is made any more');
        prov(R, 2); await step(R, 1000, 2);
        ok(callsOf(R).length === nCalls + 1, 'Android Auto (provider 2, by number): polled too');
        R.pr.setSets([], true); await step(R, 1000, 6);
        ok(callsOf(R).length === nCalls + 1 && pollOf(R).filter((l) => /: off /.test(l)).length === 2, 'S16 off: the poll stops');

        // one call in flight: a call that never answers holds the next one back; logged once after 15 s
        const H1 = rig(() => new Promise(() => {}));
        await settleOf(H1); prov(H1, 'CAR_PLAY'); await step(H1, 1000, 20);
        ok(callsOf(H1).length === 1 && pollOf(H1).some((l) => /a call has had no answer for 15 s \(the next waits for it\)/.test(l)), 'a call with no answer: no second call while it is in flight (20 s), one line after 15 s');

        // errors: the car's ACL may refuse; the text is logged (ASCII, cut), the poll goes on, slower after five failures in a row
        const E1 = rig(() => { throw new Error('Access denied: not allowed for this client é'); });
        await settleOf(E1); prov(E1, 'CAR_PLAY'); await step(E1, 1000, 10);
        ok(ntOf(E1).length === 1 && /^error: Access denied: not allowed for this client \?$/.test(bodyOf(ntOf(E1)[0])) && pollOf(E1).some((l) => /: first call: error: Access denied/.test(l)),
            'a refused call: one line "error: <the binding\'s text>" (once: the same error makes no new line), and the poll\'s first-call line');
        const at5 = callsOf(E1).length;
        await step(E1, 1000, 20);
        ok(at5 === 5 && callsOf(E1).length === 7 && pollOf(E1).some((l) => /every 10 s now/.test(l)), 'five failures in a row: one call every 10 s from then on (never faster than the poll)');
        const TO = rig(() => { throw new Error('Request timed out'); });
        await settleOf(TO); prov(TO, 'CAR_PLAY'); await step(TO, 1000, 2);
        ok(ntOf(TO).length === 1 && bodyOf(ntOf(TO)[0]) === 'timeout: Request timed out' && TO.pr.fields.find((st) => st.f.tag === 'next-turn').poller.stats().timeouts === 1, 'the binding\'s timeout: "timeout: <text>", counted as a timeout');
        const ER = rig(() => FX.reply([], { error: 'INVALID_VIEW_PARAMS' }));
        await settleOf(ER); prov(ER, 'CAR_PLAY'); await step(ER, 1000, 2);
        ok(bodyOf(ntOf(ER)[0] || '') === 'answered error=INVALID_VIEW_PARAMS views=1' && pollOf(ER).some((l) => /first call: answered \(INVALID_VIEW_PARAMS\)/.test(l)), 'an error reply: its enum name, and the views count');
        // the bench's case: the watch gives no proxy - one of its own, once
        const NP = mk({}, { replies: () => FX.ROUTE[0].reply }); NP.pr.setSets(['S16'], true); await settleOf(NP);
        Object.keys(NP.signals.subs).forEach((key) => { if (/GuidanceEventList/.test(key)) NP.signals.subs[key].res.proxy = null; });
        prov(NP, 'CAR_PLAY'); await step(NP, 1000, 6);
        ok(NP.signals.count('proxy') === 1 && callsOf(NP).length === 3 && /\|own$/.test(callsOf(NP)[0].key), 'a watch with no proxy (the bench): one proxy of its own (signals.proxy), once; the first call at the next tick, then every 2 s (' + callsOf(NP).length + ' calls in 6 s)');
        // the real guard: a call the binding never times out is noted as a timeout after 3.5 s (wall clock), and still holds the next one
        const G1 = rig(() => new Promise(() => {}));
        await settleOf(G1); prov(G1, 'CAR_PLAY'); await step(G1, 1000);
        await sleep(TURNS.TIMEOUT_MS + TURNS.GUARD_MS + 200);
        await step(G1, 1000, 3);
        ok(bodyOf(ntOf(G1)[0] || '') === 'timeout' && callsOf(G1).length === 1, 'no answer and no timeout from the binding: our guard says "timeout" after ' + (TURNS.TIMEOUT_MS + TURNS.GUARD_MS) + ' ms; still one call in flight');
    }
    // a provider that does not come up
    const BADW = mk({}, { failWatch: ['Light'] });
    BADW.pr.setSets(['S6'], true); await settleOf(BADW);
    ok(BADW.lines.some((l) => /^probe: watch Light\[1\] set=S6 fields=2 error: Error: no such service$/.test(l)), 'a watch that fails is logged and the others go on');
    BADW.clock.t += 31000; BADW.pr.tick();
    ok(BADW.lines.some((l) => /summary S6 \+30s: providers: up=7 down=1 error=1 down-list: Light\[1\]/.test(l)), 'the summary names the provider that is down');
    // the start line and the sets line
    const ST = mk({}); ST.pr.setSets(['S4', 'S6'], true); ST.pr.startLine();
    ok(ST.lines.some((l) => /^probe: start signal_probe v=0\.3\.0 fmt=1 sets=S4\+S6 fields=37 of 251$/.test(l)) && !ST.lines.some((l) => /^probe: sets /.test(l)), 'the start line: version, log format and the sets on (quiet start: no "sets" line)');
    ok(LOG_FORMAT === 1 && VERSION === app.version, 'log format 1');
    ST.pr.setSets(['S4', 'S6', 'S7'], false);
    ok(ST.lines.some((l) => /^probe: sets on=S4\+S6\+S7 changed=\+S7 fields=52$/.test(l)), 'the sets line at a change: ' + ST.lines[ST.lines.length - 1]);
    // marks and the stalk
    const M = mk({}); M.pr.setSets(['S6'], true); await settleOf(M);
    const LIGHT = 'de.bmw.body.Light';
    M.clock.t += 5000;
    ok(M.pr.mark() === 1 && M.lines.some((l) => /^probe: mark M1 t=5 tms=5000 sets=S6$/.test(l)), 'a mark: one line with its number, the seconds, the ms and the sets');
    M.clock.t += 2210; M.signals.feed(LIGHT, '1', 'IndicatorSteeringColumn', { operationColumnStalks: 0 });
    M.clock.t += 140; M.signals.feed(LIGHT, '1', 'IndicatorSteeringColumn', { operationColumnStalks: 64 });
    M.clock.t += 90; M.signals.feed(LIGHT, '1', 'IndicatorSteeringColumn', { operationColumnStalks: 0 });
    M.clock.t += 10; M.signals.feed(LIGHT, '1', 'IndicatorSteeringColumnComplete', { operationColumnStalks: 66, statusPushButtonMainBeamAssistant: 'KEINE_BETAETIGUNG' });
    M.clock.t += 10; M.signals.feed(LIGHT, '1', 'IndicatorSteeringColumnComplete', { operationColumnStalks: 2, statusPushButtonMainBeamAssistant: 'KEINE_BETAETIGUNG' });
    const sl = M.fieldLines().filter((l) => /stalk/.test(l));
    ok(sl.length === 5, 'the stalk: every change is a line, none folded, even 90 ms apart (' + sl.length + ' lines)');
    ok(/stalks=0 prev=- tms=7210 since=M1\+2210$/.test(sl[0]) && /stalks=64\(0x40\) prev=0 up=0x40 down=0x0 tms=7350 since=M1\+2350$/.test(sl[1]) && /stalks=0 prev=64\(0x40\) up=0x0 down=0x40 tms=7440 since=M1\+2440$/.test(sl[2]),
        'a press shows which bit moved and the time after the mark: ' + sl.slice(0, 3).map((l) => l.replace(/^probe: /, '')).join(' | '));
    ok(/stalks=66\(0x42\) prev=- mainBeamAssist=KEINE_BETAETIGUNG tms=\d+ since=M1\+2450$/.test(sl[3]) && /stalks=2\(0x2\) prev=66\(0x42\) up=0x0 down=0x40 mainBeamAssist=/.test(sl[4]), 'the complete variant has its own previous value and the main-beam member');
    M.clock.t += 20; M.pr.mark();
    M.clock.t += 7; M.signals.feed(LIGHT, '1', 'IndicatorSteeringColumn', { operationColumnStalks: 128 });
    ok(/since=M2\+7$/.test(M.fieldLines().filter((l) => /stalk #/.test(l)).pop()), 'a second mark starts the clock again (M2+7)');
    ok(/no hold: .*/.test('no hold: ' + M.pr.fields.find((x) => x.f.tag === 'stalk').gap) && M.pr.fields.find((x) => x.f.tag === 'stalk').gap === 0 && M.pr.fields.find((x) => x.f.tag === 'stalk-complete').gap === 0, 'the two stalk fields have gap 0');
    // a flood does not hold the stalk back
    const FS = mk({}); FS.pr.setSets(['S6'], true); await settleOf(FS);
    FS.clock.t += 5000;
    for (let i = 0; i < 60; i++) { FS.clock.t += 1; FS.signals.feed(LIGHT, '1', 'IndicatorSteeringColumn', { operationColumnStalks: i }); }
    ok(FS.fieldLines().filter((l) => /stalk #/.test(l)).length === 60, '60 stalk changes in 60 ms: 60 lines (urgent fields bypass the flood guard)');
    // summaries: +30 s, +120 s (with the getter ask for silent r fields), +600 s; per set
    const SU = mk({}, { answers: { statusMenuCCMessage: { numberCheckControlMessage1: 1 } } });
    SU.pr.setSets(['S1'], true); await settleOf(SU);
    SU.clock.t += 5000; feedTag(SU, 'active-cc', act.value); SU.signals.feed('de.bmw.infotainment.vehicle.Vehicle2', '1', 'statusDisplayedCCMessage', { statusNumberCheckControlMessageDisplay: 1 });
    SU.clock.t += 26000; SU.pr.tick(); SU.pr.tick();
    const sum = SU.lines.filter((l) => /summary S1 \+30s/.test(l));
    ok(sum.length === 3 && /2 of 6 fields have spoken: P1 active-cc\(1 events, 1 lines\), P1 displayed-cc/.test(sum[0]) && /silent: P1 menu-cc, P1 ccList, P2 ccListRiskClass, P2 basicList/.test(sum[1]) && /providers: up=4 down=0 error=0/.test(sum[2]),
        'the summary at +30 s: who spoke, who is silent, the providers (and only once)');
    ok(!SU.lines.some((l) => /^probe: ask /.test(l)), 'no getter ask at +30 s');
    SU.clock.t += 90000; SU.pr.tick(); await sleep(30);
    ok(SU.lines.filter((l) => /summary S1 \+120s/.test(l)).length === 3, 'the next summary comes at +120 s');
    const asks = SU.lines.filter((l) => /^probe: ask /.test(l));
    ok(asks.length === 4 && asks.some((l) => /ask P1 menu-cc \(silent at \+120s\): answered \(object\)/.test(l)) && asks.some((l) => /ask P1 ccList \(silent at \+120s\): error or no answer: no answer \(the car does not send it\)/.test(l)),
        'one getter ask per silent field at +120 s: answered / error or no answer (' + asks.length + ' lines)');
    ok(SU.fieldLines().some((l) => / menu-cc #1 /.test(l)), 'the answer of an ask is logged as an ordinary field line');
    SU.clock.t += 100000; SU.pr.tick(); await sleep(30);
    ok(SU.signals.calls.filter((c) => c.op === 'get' && c.field === 'statusMenuCCMessage').length === 1, 'the same field is asked only once');
    SU.clock.t += 500000; SU.pr.tick();
    ok(SU.lines.filter((l) => /summary S1 \+600s/.test(l)).length === 3, 'and the summary at +600 s');
    // a notifier-only field is not asked
    const NO = mk({}); NO.pr.setSets(['S8'], true); await settleOf(NO);
    NO.clock.t += 121000; NO.pr.tick(); await sleep(30);
    ok(NO.lines.some((l) => /ask P15 sign \(silent at \+120s\): no getter \(notifier only\)/.test(l)) && NO.signals.count('get') === FIELDS.TABLE.filter((f) => f.set === 'S8' && f.flags.indexOf('r') >= 0).length,
        'a notifier-only field (the sign) is not asked: "no getter (notifier only)"; the r fields are');
    // TPMS polling
    const TP = mk({}); TP.pr.setSets(['S9'], true); await settleOf(TP);
    const tw = TP.signals.calls.filter((c) => c.op === 'watch' && /TPMS$/.test(c.iface));
    ok(tw.length === 1 && tw[0].poll === 15000 && TP.signals.calls.filter((c) => c.op === 'watch' && c.poll).length === 1, 'TPMS (S9) is polled by getter every 15 s; nothing else is polled');
    // two instances of Telephone
    const TL = mk({}); TL.pr.setSets(['S5'], true); await settleOf(TL);
    ok(TL.signals.calls.filter((c) => c.op === 'watch' && /Telephone$/.test(c.iface)).map((c) => c.inst).sort().join() === '1,2', 'Telephone is watched on instance 1 and on instance 2');
    TL.signals.feed('de.bmw.infotainment.Telephone', '2', 'registerState', { registerStateStructure: { circuitSwitchedNetworkRegisterState: 'REGISTERED', packetSwitchedNetworkRegisterState: 'NOT_REGISTERED' } });
    ok(TL.fieldLines().some((l) => /P9 nad2-register #1 .*shape=member cs=REGISTERED ps=NOT_REGISTERED/.test(l)) && !TL.fieldLines().some((l) => /nad-register/.test(l)), 'instance 2 logs as nad2-*, instance 1 stays silent');
    // the app's handlers: throwing values, hostile values
    const H = mk({}); H.pr.setSets(FIELDS.SETS.map((s) => s.id), true); await settleOf(H);
    const nasty = { get numberDisplayControlCheckControlMessage() { throw new Error('getter boom'); } };
    let threw = false;
    try { feedTag(H, 'active-cc', nasty); } catch (e) { threw = true; }
    ok(!threw && H.lines.some((l) => /^WARN probe: P1 active-cc: getter boom/.test(l)), 'a value that throws while it is read: one warning, no throw');
    feedTag(H, 'active-cc', nasty);
    ok(H.lines.filter((l) => /getter boom/.test(l)).length === 1, '... and the warning comes once per field');
    const hostile = [null, undefined, 'Canary string', 42, [], [1, 2], { x: 'Canary obj', y: { z: 'Canary deep' } }, true, 'canary_lower', new Array(5000).fill('Canary'), Buffer.from('Canary'), { length: 3 }, 1e308, -1, NaN];
    let hostileThrew = false;
    const E = mk({}); E.pr.setSets(FIELDS.SETS.map((s) => s.id), true); await settleOf(E);
    FIELDS.TABLE.forEach((f) => hostile.forEach((h) => { try { feedTag(E, f.tag, h); } catch (x) { hostileThrew = true; } E.clock.t += 20000; }));
    ok(!hostileThrew, 'null, undefined, strings, numbers, arrays, buffers and objects where structs belong: no handler throws');
    ok(!/canary/i.test(E.lines.join('\n')), 'and none of their text is logged');
    const enumTrap = mk({}); enumTrap.pr.setSets(['S2'], true);
    feedTag(enumTrap, 'range-tank', { fluidLevelFuelTank: 'ALL_CAPS_TEXT', mileageKilometre: 'MORE_TEXT', range: 412, statusFluidLevelFuelTankSpare: 'free text' });
    ok(/fuel=\? fuelL=- fuelR=- spare=\? range=412 mileage=\?$/.test(bodyOf(enumTrap.fieldLines()[0])), 'a text where a number or an enum belongs prints "?": ' + bodyOf(enumTrap.fieldLines()[0]));
    const big = mk({}); big.pr.setSets(['S1'], true);
    const many = []; for (let i = 0; i < 40; i++) many.push({ cCListElement: { cCIdentifer: i, cCColor: 'RED', cCShortName: 'x' } });
    feedTag(big, 'ccList', many);
    ok(/entries=40 .* \+16 more$/.test(bodyOf(big.fieldLines()[0])) && (bodyOf(big.fieldLines()[0]).match(/\[id=/g) || []).length === 24, 'a list of 40: 24 entries and "+16 more"');
    // volume line
    const VL = mk({}); VL.pr.setSets(['S1'], true);
    for (let i = 0; i < 3000 && !VL.lines.some((l) => /^probe: volume: /.test(l)); i++) { VL.clock.t += 600; feedTag(VL, 'ccList', [{ cCListElement: { cCIdentifer: 1000 + i } }].concat(many)); VL.pr.fields.find((x) => x.f.tag === 'ccList').n = 0; }
    ok(VL.lines.some((l) => /^probe: volume: 15\d KB in \d+ lines since start: collect the logs/.test(l)), 'a volume line says when 150 KB have been logged: collect the logs');
    // never throws without signals
    const NS = new Probe({ log: { info() {}, warn() {} }, now: () => 1, cfg: { hubPauseMs: 0 } });
    let ns = false; try { NS.setSets(['S1']); NS.tick(); NS.mark(); NS.stats(); NS.hubStats(); } catch (e) { ns = true; }
    ok(!ns, 'without a signals object nothing throws (the sets just have no proxies)');
    // a log that throws
    const LG = new Probe({ log: { info() { throw new Error('log boom'); }, warn() { throw new Error('log boom'); } }, signals: fakeSignals(), now: () => 1, cfg: { hubPauseMs: 0 } });
    let lg = false; try { LG.setSets(['S1']); LG.mark(); LG.startLine(); LG.tick(); } catch (e) { lg = true; }
    ok(!lg, 'a log that throws does not take the probe down');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('6. on the bench: the real app, built by the kit, in the stubbed head unit (port ' + PORT + ')');
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir);
    const base = 'http://127.0.0.1:' + PORT;
    const req = async (method, url, body) => {
        const rr = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        if (rr.status === 200) return rr.json();
        if (rr.status !== 204) throw new Error(method + ' ' + url + ': ' + rr.status);
        return null;
    };
    let out = '', exited = false, server = null;
    const startServer = () => {
        server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'signal_probe'], {
            cwd: ROOT, env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir }), stdio: ['ignore', 'pipe', 'pipe'],
        });
        const keep = (d) => { out += d; if (/app exited/.test(String(d))) exited = true; };
        server.stdout.on('data', keep); server.stderr.on('data', keep);
    };
    const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); while (Date.now() < end) { if (fn()) return true; await sleep(100); } return fn(); };
    const probeLines = () => out.split('\n').filter((l) => /\[signal_probe\] probe: /.test(l)).map((l) => l.replace(/^.*\[signal_probe\] /, ''));
    const probeNative = async () => { try { return await req('GET', '/probe'); } catch (e) { return null; } };
    try {
        startServer();
        ok(await until(() => /build: signal_probe/.test(out) && probeLines().some((l) => /^probe: start /.test(l)), 60000), 'the app builds with the kit and starts');
        ok(probeLines().some((l) => /^probe: start signal_probe v=0\.3\.0 fmt=1 sets=none fields=0 of 251$/.test(l)), 'the start line: all sets off at the first start: ' + (probeLines()[0] || ''));
        ok(!/Error|uncaught/i.test(out.split('\n').filter((l) => /\[signal_probe\]/.test(l)).join('\n')), 'nothing in the app\'s log says Error or uncaught');
        let p = await probeNative();
        ok(p && JSON.stringify(p.stack) === '["MAIN"]', 'the entry screen is the native menu MAIN');
        ok(p && p.native.MARK && /^Позначка 1$/.test((p.native.MARK.cells || {}).Text1stRow || ''), 'the mark row says "Позначка 1": ' + JSON.stringify(p && p.native.MARK && p.native.MARK.cells));
        ok(p && /жодного/.test((p.native.STATUS || {}).text || ''), 'the status line says no set is on: ' + ((p && p.native.STATUS) || {}).text);
        ok(p && FIELDS.SETS.every((s) => p.native['SET_' + s.key.toUpperCase()] && p.native['SET_' + s.key.toUpperCase()].checked === false), 'a checkbox per set (S1..S11, S13..S16), all unchecked');
        // S6 on
        await req('POST', '/click', { id: 'SET_SET6' });
        ok(await until(() => probeLines().some((l) => /^probe: sets on=S6 changed=\+S6 fields=24 \(first set on\)$/.test(l))), 'a press on the S6 checkbox: the log says S6 is on (24 fields)');
        ok(await until(() => probeLines().filter((l) => /^probe: watch /.test(l)).length === 8, 10000), 'its 8 interfaces are subscribed (one at a time): ' + probeLines().filter((l) => /^probe: watch /.test(l)).map((l) => l.replace(/^probe: watch /, '').replace(/ set=.*$/, '')).join(', '));
        await req('POST', '/click', { id: 'MARK' });
        ok(await until(() => probeLines().some((l) => /^probe: mark M1 /.test(l))), 'a press on the mark row: one "mark M1" line');
        await sleep(300);
        await req('POST', '/fake', { feed: { iface: 'de.bmw.body.Light', field: 'IndicatorSteeringColumn', value: { operationColumnStalks: 8 } } });
        ok(await until(() => probeLines().some((l) => /^probe: P13 stalk #1 t=[0-9.]+: stalks=8\(0x8\) prev=- tms=\d+ since=M1\+\d+$/.test(l))), 'an injected stalk byte is logged with its time after the mark: ' + (probeLines().filter((l) => /stalk #1/.test(l))[0] || ''));
        await req('POST', '/fake', { feed: { iface: 'de.bmw.infotainment.vehicle.Vehicle2', field: 'statusDisplayKombi', value: { statusDisplayInstrumentPackM: 'STANDARD_VIEW' } } });
        ok(await until(() => probeLines().some((l) => /P11 display-kombi #1 .*view=STANDARD_VIEW/.test(l))), 'a cluster-view field is logged too');
        await req('POST', '/fake', { feed: { iface: 'de.bmw.infotainment.vehicle.Vehicle2', field: 'statusZVStatus', value: { statusCentralLockingSystem: 5 } } });
        await sleep(400);
        ok(!probeLines().some((l) => /zv-status/.test(l)), 'a field of a set that is off (S3) logs nothing');
        p = await probeNative();
        ok(p && /^Позначка 2$/.test((p.native.MARK.cells || {}).Text1stRow || '') && /остання: 1/.test((p.native.MARK.cells || {}).Text2ndRow || '') && /S6/.test((p.native.STATUS || {}).text || ''), 'the menu shows the next mark number, the last one, and S6 on: ' + JSON.stringify(p && p.native.MARK.cells));
        const settingsFile = path.join(dataDir, 'signal_probe', 'settings.json');
        const alt = path.join(dataDir, 'settings.json');
        const sf = [settingsFile, alt].find((f) => fs.existsSync(f));
        ok(sf && readJson(sf).set6 === true && readJson(sf).set1 === false, 'the choice is saved in settings.json (set6 true)');
        // restart: the sets come back
        const before = probeLines().length;
        await req('POST', '/restart');
        ok(await until(() => probeLines().slice(before).some((l) => /^probe: start signal_probe v=0\.3\.0 fmt=1 sets=S6 fields=24 of 251$/.test(l)), 15000), 'after a restart the start line says sets=S6 (the owner\'s choice is kept)');
        ok(await until(() => probeLines().slice(before).filter((l) => /^probe: watch /.test(l)).length === 8, 10000), '... and S6\'s interfaces are subscribed again');
        await req('POST', '/click', { id: 'SET_SET6' });
        ok(await until(() => probeLines().some((l) => /^probe: sets on=none changed=-S6 /.test(l))), 'S6 off again: logged');
        // S16 (car issues NV): its checkbox in the real build, its proxies, an injected CarPlay stream status
        const w0 = probeLines().filter((l) => /^probe: watch /.test(l)).length;
        await req('POST', '/click', { id: 'SET_SET16' });
        ok(await until(() => probeLines().some((l) => /^probe: sets on=S16 changed=\+S16 fields=40( \(first set on\))?$/.test(l))), 'a press on the S16 checkbox ("Наступний поворот"): the log says S16 is on (40 fields)');
        ok(await until(() => probeLines().filter((l) => /^probe: watch /.test(l)).length - w0 >= 12, 15000), 'its new interfaces are subscribed (the six it shares with S6 were kept): ' +
            probeLines().filter((l) => /^probe: watch /.test(l)).slice(w0).map((l) => l.replace(/^probe: watch /, '').replace(/ set=.*$/, '')).join(', '));
        // car issues CT: the phone guides -> the real build's next-turn entry calls queryContent through the kit (hu-stub's signals.call)
        await req('POST', '/fake', { feed: { iface: 'de.bmw.infotainment.navigation.guiding.Guidance', field: 'guidingProvider', value: 'CAR_PLAY' } });
        ok(await until(() => probeLines().some((l) => /^probe: P25 next-turn #1 t=[0-9.]+: answered events=2 total=2 \[intersection direction=LEFT /.test(l)), 15000),
            'provider CAR_PLAY: the built app asks queryContent (shared/carplay_turns.js packed beside it) and logs the reply: ' + (probeLines().filter((l) => /next-turn #1/.test(l))[0] || ''));
        p = await probeNative();
        ok(p && p.carplayTurns && p.carplayTurns.calls >= 1 && JSON.stringify(p.carplayTurns.methods) === '["queryContent"]', 'the stand-in saw only queryContent (' + JSON.stringify(p && p.carplayTurns) + ')');
        await req('POST', '/fake', { feed: { iface: 'de.bmw.infotainment.navigation.guiding.Guidance', field: 'guidingProvider', value: 'NONE' } });
        ok(await until(() => probeLines().some((l) => /^probe: poll P25 next-turn: off /.test(l)), 8000), 'provider NONE: the poll is off');
        await req('POST', '/click', { id: 'SET_SET16' });
        ok(await until(() => probeLines().some((l) => /^probe: sets on=none changed=-S16 /.test(l))), 'S16 off again: logged');
        ok(!exited, 'the app never exited');
    } catch (e) {
        ok(false, 'bench run: ' + (e && e.stack || e));
    } finally {
        if (server) { server.kill('SIGTERM'); await sleep(300); }
    }
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
