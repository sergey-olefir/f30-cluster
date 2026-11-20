#!/usr/bin/env node
'use strict';
/**
 * rv_manifest.js - the RV recorder's declarations from its source table (tools/road-view/app/rv_recorder/rv_fields.js is the one
 * source), as tools/car/probe_fields.js does for Signal Probe.
 *
 *   node tools/road-view/rv_manifest.js sync     rewrite the "signals" block of the RV recorder's app.json from the table
 *   node tools/road-view/rv_manifest.js check    exit 1 when app.json "signals" differs from what the table needs
 *   node tools/road-view/rv_manifest.js export   write design/car/rv_fields.json (the table with getter / notifier / event ids from
 *                                                the car's catalogue when reference/car/2026-11-15/someip/someip-interfaces.json is here)
 *
 * Read only everywhere: r / s flags and events as _broadcasts; no setter, no method. The catalogue (git-ignored) is only read.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const APPDIR = path.join(__dirname, 'app', 'rv_recorder');
const APP = path.join(APPDIR, 'app.json');
const OUT = path.join(ROOT, 'design', 'car', 'rv_fields.json');
const CATALOGUE = path.join(ROOT, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json');
const RV = require(path.join(APPDIR, 'rv_fields.js'));
const PROBE = require(path.join(ROOT, 'apps', 'signal_probe', 'fields.js'));

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const dump = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');

function sync() {
    const app = readJson(APP);
    app.signals = RV.manifestSignals();
    dump(APP, app);
    console.log('tools/road-view/app/rv_recorder/app.json: signals = ' + Object.keys(app.signals).length + ' interfaces');
}
function check() {
    const app = readJson(APP);
    if (JSON.stringify(RV.manifestSignals()) !== JSON.stringify(app.signals)) { console.log('the RV recorder\'s app.json "signals" differs from rv_fields.js: run `node tools/road-view/rv_manifest.js sync`'); return 1; }
    console.log('the RV recorder\'s app.json "signals" matches rv_fields.js');
    return 0;
}
/** The interface count: this app's, Signal Probe's, and what Signal Probe would declare with this set inside it. */
function counts() {
    const mine = RV.interfaces().map((e) => e.iface), probe = PROBE.interfaces().map((e) => e.iface);
    const added = mine.filter((i) => probe.indexOf(i) < 0);
    return { rvRecorder: mine.length, signalProbe: probe.length, newToSignalProbe: added.length, signalProbeIfInside: probe.length + added.length, newInterfaces: added };
}
function exportTable() {
    const cat = fs.existsSync(CATALOGUE) ? readJson(CATALOGUE) : null;
    const fields = RV.TABLE.map((f) => {
        const ci = cat && cat.interfaces[f.iface];
        const c = f.flags !== 'b' && ci && ci.fields[f.field];
        const ev = f.flags === 'b' && ci && (ci.events || {})[f.field];
        const o = { set: RV.SET.id, tag: f.tag, group: f.group, kind: f.kind, interface: f.iface, field: f.field, flags: f.flags,
            getterId: c && c.getter ? c.getter.id : null, notifierId: c && c.notifier ? c.notifier.id : null, eventId: ev ? ev.eventId : null,
            serviceId: ci ? ci.serviceId || null : null };
        if (f.recEntries) o.recEntries = f.recEntries;
        if (f.skip) o.skip = f.skip;
        if (f.sum) o.summary = f.sum;
        if (f.trip) o.tripMark = f.trip;
        return o;
    });
    const out = {
        _about: 'The RV recorder\'s source table, set S19 "RV" (tools/road-view/app/rv_recorder/rv_fields.js is the source; `node tools/road-view/rv_manifest.js export` rewrites this file). READ ONLY: rs (a non-zero getter id), s (a notifier), b (an event). kind full: every message recorded; kind list: the first message whole, then one summary sample a second ("<tag>~1s"), the next message whole after a mark. Ids from the car\'s catalogue of 2026-11-15 (git-ignored), null when it was not there.',
        set: RV.SET, counts: counts(), fields,
    };
    dump(OUT, out);
    console.log('design/car/rv_fields.json: ' + fields.length + ' sources, ' + out.counts.rvRecorder + ' interfaces' + (cat ? '' : ' (no catalogue: ids null)'));
}

module.exports = { counts };

if (require.main === module) {
    const cmd = process.argv[2];
    if (cmd === 'sync') sync();
    else if (cmd === 'check') process.exit(check());
    else if (cmd === 'export') exportTable();
    else if (cmd === 'count') console.log(JSON.stringify(counts(), null, 1));
    else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 13).join('\n')); process.exit(2); }
}
