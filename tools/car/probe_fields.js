#!/usr/bin/env node
'use strict';
/**
 * probe_fields.js - the signal probe's declarations from its field table (apps/signal_probe/fields.js is the one source).
 *
 *   node tools/car/probe_fields.js sync     rewrite the "signals" block of apps/signal_probe/app.json from the table (the rest stays)
 *   node tools/car/probe_fields.js check    exit 1 when app.json "signals" differs from what the table needs
 *   node tools/car/probe_fields.js export   write design/car/probe_fields.json (the field table with getter / notifier ids from the
 *                                           car's catalogue when reference/car/2026-11-15/someip/someip-interfaces.json is here)
 *
 * Read only everywhere: only r and s flags, no _methods, no _broadcasts, no setter. The catalogue (git-ignored) is only read.
 * Node 8 compatible syntax is not needed here (Mac only), but the output files are plain JSON.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'apps', 'signal_probe', 'app.json');
const OUT = path.join(ROOT, 'design', 'car', 'probe_fields.json');
const CATALOGUE = path.join(ROOT, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json');
const FIELDS = require(path.join(ROOT, 'apps', 'signal_probe', 'fields.js'));
const P = require(path.join(ROOT, 'apps', 'signal_probe', 'probe.js'));

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const dump = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');

function sync() {
    const app = readJson(APP);
    app.signals = FIELDS.manifestSignals();
    dump(APP, app);
    console.log('apps/signal_probe/app.json: signals = ' + Object.keys(app.signals).length + ' interfaces');
}

function check() {
    const app = readJson(APP);
    const want = JSON.stringify(FIELDS.manifestSignals()), have = JSON.stringify(app.signals);
    if (want !== have) { console.log('apps/signal_probe/app.json "signals" differs from fields.js: run `node tools/car/probe_fields.js sync`'); return 1; }
    console.log('apps/signal_probe/app.json "signals" matches fields.js');
    return 0;
}

/** The kind of a datatype reference in the catalogue: struct, union, array<...>, enum, text, bool, num. */
function kindOf(DT, ref) {
    const base = (r) => { let n = 0; while (DT[r] && DT[r].type === 'typedef' && n++ < 8) r = DT[r].dataRef; return r; };
    const r = base(ref), t = DT[r];
    if (t) return t.type === 'array' ? 'array<' + kindOf(DT, t.dataRef || t.elementDataRef) + '>' : t.type;
    if (/^Utf|^ByteBuffer/.test(r)) return 'text';
    if (r === 'Bool') return 'bool';
    return /^(U?Int\d+|Float|Double)$/.test(r) ? 'num' : 'unknown:' + r;
}

function exportTable() {
    const cat = fs.existsSync(CATALOGUE) ? readJson(CATALOGUE) : null;
    const insts = (iface) => {
        const m = cat && cat.instanceIDs && cat.instanceIDs[iface];
        return m ? Object.keys(m) : null;
    };
    const sets = FIELDS.SETS.map((s) => ({ id: s.id, settingsKey: s.key, name: s.name, uk: s.uk, items: s.items,
        fields: FIELDS.TABLE.filter((f) => f.set === s.id).length,
        fieldsActive: FIELDS.TABLE.filter((f) => f.set === s.id || (f.also || []).indexOf(s.id) >= 0).length }));
    const fields = FIELDS.TABLE.map((f) => {
        const d = FIELDS.SET_DEFAULTS[f.set];
        const c = cat && cat.interfaces[f.iface] && cat.interfaces[f.iface].fields[f.field];
        const how = f.bits ? 'bits' : f.cols ? 'cols' : f.list ? 'list' : f.union ? 'union' : f.fmt;
        const o = {
            set: f.set, item: f.p, tag: f.tag, interface: f.iface, field: f.field, instance: FIELDS.instOf(f), flags: f.flags,
            getterId: c && c.getter ? c.getter.id : null, notifierId: c && c.notifier ? c.notifier.id : null,
            rootType: c ? kindOf(cat.datatypes, c.dataRef) : null,
            formatter: how, gapMs: f.gapMs !== undefined ? f.gapMs : d.gapMs, cap: f.cap || d.cap,
        };
        if (f.pollMs) o.pollMs = f.pollMs;
        if (f.also) o.also = f.also;
        if (f.mark) o.markTimed = true;
        if (f.bits) o.bits = f.bits.path;
        const columns = (f.cols || (f.list && f.list.cols) || (f.union && f.union.cols) || []).map((x) => x[0] + ':' + (Array.isArray(x[1]) ? x[1].join('.') || '(value)' : x[1]) + ':' + x[2]);
        if (columns.length) o.columns = columns;
        return o;
    });
    const ifaces = FIELDS.interfaces().map((e) => ({
        interface: e.iface, instancesRead: e.instances, manifestInstances: e.instances.length > 1 ? '*' : e.instances[0],
        instancesInCatalogue: insts(e.iface), fields: Object.keys(e.fields).length,
        sets: FIELDS.TABLE.filter((f) => f.iface === e.iface).map((f) => f.set).filter((x, i, a) => a.indexOf(x) === i),
    }));
    const out = {
        _about: 'The signal probe\'s field table (apps/signal_probe/fields.js is the source; `node tools/car/probe_fields.js export` rewrites this file). READ ONLY: flags r (non-zero getter id) and s (notifier). Ids come from the car\'s catalogue of 2026-11-15 (git-ignored) and are null when the catalogue was not there. formatter: cols / list / union (named columns), bits (a raw byte with its bit changes), or a named formatter of apps/signal_probe/format.js. Text members are logged as lengths only.',
        logFormat: P.LOG_FORMAT, version: P.VERSION,
        counts: { sets: sets.length, fields: fields.length, interfaces: ifaces.length, interfacesWithSeveralInstances: ifaces.filter((i) => i.instancesRead.length > 1).length },
        sets, interfaces: ifaces, fields,
    };
    dump(OUT, out);
    console.log('design/car/probe_fields.json: ' + fields.length + ' fields, ' + ifaces.length + ' interfaces, ' + sets.length + ' sets' + (cat ? '' : ' (no catalogue: ids null)'));
}

const cmd = process.argv[2];
if (cmd === 'sync') sync();
else if (cmd === 'check') process.exit(check());
else if (cmd === 'export') exportTable();
else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 13).join('\n')); process.exit(2); }
