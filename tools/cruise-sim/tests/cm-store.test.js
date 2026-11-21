'use strict';
// Package CM (rung 1): nothing of the command path reaches the Store or the car.
//  - no app in apps/ declares a setter ("w") on any driver-assistance interface, or on anything beyond the known list;
//  - no app packs shared/cruise_cmd.js (kit/tools/build.py packs only the files an app's "shared" names);
//  - nothing under apps/ names the module, its folder or the setter's field; only tools/cruise-cmd and these tests require it;
//  - the command path never names a driver-assistance settings setter (CC R4);
//  - Node 8.16 syntax for every CM file; cruise_cmd.js and follow.js are pure (no clock, I/O, timers, randomness).
const { test, assert } = require('./harness');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', '..');
const APPS = path.join(ROOT, 'apps');
const CMD = path.join(ROOT, 'tools', 'cruise-cmd');
const CHECK = path.join(__dirname, 'stubs', 'sc2-node8-check.js');

function walk(dir, out) {
    fs.readdirSync(dir).forEach((f) => {
        const p = path.join(dir, f);
        let st;
        try { st = fs.lstatSync(p); } catch (e) { return; }
        if (st.isSymbolicLink()) return;
        if (st.isDirectory()) { if (f !== 'node_modules' && f[0] !== '.') walk(p, out); }
        else out.push(p);
    });
    return out;
}
function apps() { return fs.readdirSync(APPS).filter((d) => fs.existsSync(path.join(APPS, d, 'app.json'))); }

// The only setters any app in apps/ declares today (2026-11-21): Driver Profiles writes the profile's own name and
// avatar. A new "w" anywhere fails here and must be reviewed on its own.
const KNOWN_W = ['driver_profiles de.bmw.infotainment.personalization.UserAccount.name',
    'driver_profiles de.bmw.infotainment.personalization.UserAccount.avatarType',
    'driver_profiles de.bmw.infotainment.personalization.UserAccount.avatar'];

test('no app in apps/ declares a setter ("w") on a driver-assistance interface, and no "w" beyond the known list', () => {
    const found = [];
    apps().forEach((id) => {
        const j = JSON.parse(fs.readFileSync(path.join(APPS, id, 'app.json'), 'utf8'));
        const sig = j.signals || {};
        Object.keys(sig).forEach((iface) => {
            const fields = sig[iface] || {};
            Object.keys(fields).forEach((f) => {
                if (f[0] === '_') return;
                const flags = fields[f];
                if (typeof flags === 'string' && flags.indexOf('w') >= 0) {
                    found.push(id + ' ' + iface + '.' + f);
                    assert.ok(!/dass|DriverAssistance|Multimodal|FASuS|driverassistance/i.test(iface), id + ' declares a setter on ' + iface + '.' + f);
                }
            });
            const methods = fields._methods || [];
            assert.ok(!/dass|DriverAssistance|Multimodal|FASuS/i.test(iface) || !methods.length, id + ' declares methods on ' + iface);
            methods.forEach((m) => assert.ok(!/resetSettings|SafetyFunctions/i.test(m), id + ' declares ' + m));
        });
    });
    found.sort();
    assert.deepStrictEqual(found, KNOWN_W.slice().sort(), 'setters declared in apps/');
});

test('no app packs or names the command module: "shared" lists, every file under apps/', () => {
    apps().forEach((id) => {
        const j = JSON.parse(fs.readFileSync(path.join(APPS, id, 'app.json'), 'utf8'));
        (j.shared || []).forEach((f) => assert.ok(!/cruise_cmd/i.test(f), id + ' packs ' + f));
    });
    const words = ['cruise_cmd', 'cruise-cmd', 'multimodalControlDriverAssistance', 'CM_SET_SPEED', 'REQUEST_ADAPT_SPEED'];
    walk(APPS, []).filter((p) => /\.(js|json|py|txt|md|html)$/.test(p)).forEach((p) => {
        const s = fs.readFileSync(p, 'utf8');
        words.forEach((w) => assert.ok(s.indexOf(w) < 0, path.relative(ROOT, p) + ' names ' + w));
    });
    // the packer takes only what "shared" names (no wildcard over shared/)
    const build = fs.readFileSync(path.join(ROOT, 'kit', 'tools', 'build.py'), 'utf8');
    assert.ok(/for f in spec\.get\('shared', \[\]\)/.test(build), 'build.py packs the listed shared files only');
});

test('only tools/cruise-cmd and the cm-* tests require shared/cruise_cmd.js; the module is not a Store app', () => {
    const users = [];
    ['shared', 'apps', 'tools', 'kit', 'scripts', 'bench'].forEach((d) => {
        const dir = path.join(ROOT, d);
        if (!fs.existsSync(dir)) return;
        walk(dir, []).filter((p) => /\.js$/.test(p)).forEach((p) => {
            if (/cruise_cmd\.js['"]\)/.test(fs.readFileSync(p, 'utf8'))) users.push(path.relative(ROOT, p));
        });
    });
    users.forEach((u) => assert.ok(/^tools\/cruise-cmd\//.test(u) || /^tools\/cruise-sim\/tests\/cm-[a-z]+\.test\.js$/.test(u), 'requires the module: ' + u));
    assert.ok(users.length >= 4, users.join(', '));
    assert.ok(!fs.existsSync(path.join(CMD, 'app.json')), 'tools/cruise-cmd is not an app');
    assert.ok(!fs.existsSync(path.join(APPS, 'cruise_cmd')) && !fs.existsSync(path.join(APPS, 'cruise-cmd')));
});

test('the command path names no driver-assistance settings setter, and no network address but 127.0.0.1', () => {
    const files = [path.join(ROOT, 'shared', 'cruise_cmd.js')].concat(walk(CMD, []).filter((p) => /\.js$/.test(p)));
    files.forEach((p) => {
        const s = fs.readFileSync(p, 'utf8');
        ['resetSettingsSafetyFunctions', 'SettingsDriverAssistanceFunctions', 'iDriveFAS', 'settingSpeedLimitAssist', 'settingDCC'].forEach((w) => assert.ok(s.indexOf(w) < 0, path.basename(p) + ' names ' + w));
        const ips = s.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) || [];
        ips.forEach((ip) => assert.strictEqual(ip, '127.0.0.1', path.basename(p) + ' names ' + ip));
        assert.ok(!/ssh|scp|\bnc\b|someip_send|vsomeip|\.listen\([^)]*0\.0\.0\.0/.test(s), path.basename(p) + ' has a way out');
    });
});

// ---- Node 8 -------------------------------------------------------------------------------------------------------------
function check(file) {
    const r = cp.spawnSync(process.execPath, ['--expose-internals', CHECK, file], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('checker failed: ' + r.stderr);
    return JSON.parse(r.stdout);
}
const CM_FILES = [path.join(ROOT, 'shared', 'cruise_cmd.js')]
    .concat(walk(CMD, []).filter((p) => /\.js$/.test(p)))
    .concat(fs.readdirSync(__dirname).filter((f) => /^cm-.*\.test\.js$/.test(f)).map((f) => path.join(__dirname, f)));

test('Node 8.16 syntax: every CM file parses as ES2017 and uses no newer built-in API (' + CM_FILES.length + ' files)', () => {
    const probe = check(CM_FILES[0]);
    if (probe.unavailable) { console.log('  no acorn reachable in this Node: syntax check skipped'); return; }
    CM_FILES.forEach((f) => {
        const r = check(f);
        assert.strictEqual(r.ok, true, path.relative(ROOT, f) + ': ' + r.error);
        ['flat', 'flatMap', 'fromEntries', 'matchAll', 'replaceAll', 'at', 'allSettled', 'any', 'trimStart', 'trimEnd', 'finally', 'hasOwn', 'findLast', 'findLastIndex']
            .forEach((m) => assert.ok(r.members.indexOf(m) < 0, path.relative(ROOT, f) + ' uses .' + m));
        ['globalThis', 'BigInt', 'queueMicrotask', 'structuredClone', 'AggregateError', 'WeakRef'].forEach((g) => assert.ok(r.identifiers.indexOf(g) < 0, path.relative(ROOT, f) + ' uses ' + g));
    });
});

test('pure: cruise_cmd.js and follow.js name no clock, I/O, timer, randomness, and run in a bare context', () => {
    [path.join(ROOT, 'shared', 'cruise_cmd.js'), path.join(CMD, 'follow.js')].forEach((f) => {
        const r = check(f);
        if (!r.unavailable) {
            ['Date', 'performance', 'console', 'process', 'require', 'setTimeout', 'setInterval', 'setImmediate', 'fetch', 'Buffer', 'global', 'globalThis']
                .forEach((g) => assert.ok(r.identifiers.indexOf(g) < 0, path.basename(f) + ' refers to ' + g));
            assert.ok(r.members.indexOf('random') < 0 && r.members.indexOf('now') < 0, path.basename(f));
        }
        const ctx = vm.createContext({});
        vm.runInContext('delete globalThis.Date; Math.random = function () { throw new Error("Math.random"); };', ctx);
        ctx.module = { exports: {} };
        vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: path.basename(f) });
        const X = ctx.module.exports;
        assert.strictEqual(typeof X.create, 'function');
        if (X.buildRequest) {
            const m = X.create({});
            m.armStep(0);
            const inp = { feed: { kind: 'cruise', status: 'active', kmh: 100 }, egoKmh: 100, egoT: 600, lead: { valid: true, gap_m: 90, vrel_mps: 0, t: 600 }, decision: { seq: 1, t: 600, wantKmh: 95 }, offer: false };
            assert.strictEqual(m.armConfirm(600, inp).armed, true);
            inp.decision = { seq: 2, t: 700, wantKmh: 95 }; inp.egoT = 700; inp.lead.t = 700;
            assert.strictEqual(m.step(700, inp).request.kmh, 95);
        } else {
            assert.strictEqual(X.create({}).step({ t: 0, egoKmh: 100, setKmh: 100, lead: { valid: true, gap_m: 50, vrel_mps: -2 } }).why, 'LOWER');
        }
    });
});
