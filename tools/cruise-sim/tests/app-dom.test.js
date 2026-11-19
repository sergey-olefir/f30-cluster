'use strict';
/**
 * SU1: boots ui/index.html's scripts (scene.js, app.js and whatever they load) in a vm with a minimal DOM
 * stub - no browser, no library - and drives the shell: the first run, the canvas, the placeholders,
 * playback through requestAnimationFrame, the URL hash, result / batch / config / preset files.
 *   node tools/cruise-sim/tests/app-dom.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const UI = path.join(__dirname, '..', 'ui');
const HTML = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');

function makeDom() {
    const byId = {}, all = [], log = { hash: [], draws: 0, blobs: 0, rafs: 0, scriptErrors: [] };
    let now = 0;
    const listeners = (o) => { o._l = {}; o.addEventListener = (k, fn) => { (o._l[k] = o._l[k] || []).push(fn); }; o.removeEventListener = () => {}; o.dispatch = (k, ev) => (o._l[k] || []).forEach((fn) => fn(Object.assign({ preventDefault() {}, target: o }, ev || {}))); };
    function Elem(tag, attrs) {
        const e = { tagName: String(tag).toUpperCase(), attrs: Object.assign({}, attrs || {}), children: [], style: {}, hidden: false, disabled: false, value: '', _text: '' };
        listeners(e);
        e.hidden = 'hidden' in e.attrs;
        e.id = e.attrs.id || '';
        e.classList = {
            _s: new Set(String(e.attrs.class || '').split(/\s+/).filter(Boolean)),
            add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); },
            toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); },
        };
        Object.defineProperty(e, 'className', { get() { return [...e.classList._s].join(' '); }, set(v) { e.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); } });
        Object.defineProperty(e, 'textContent', {
            get() { return e._text + e.children.map((c) => c.textContent).join(''); },
            set(v) { e._text = String(v); e.children = []; },
        });
        e.setAttribute = (k, v) => { e.attrs[k] = String(v); if (k === 'id') { e.id = v; byId[v] = e; } if (k === 'class') e.className = v; };
        e.getAttribute = (k) => (k in e.attrs ? e.attrs[k] : null);
        e.removeAttribute = (k) => { delete e.attrs[k]; if (k === 'value') e.value = ''; };
        e.appendChild = (c) => { e.children.push(c); c.parentNode = e; if (e === doc.head && c.tagName === 'SCRIPT') loadScript(c); return c; };
        e.remove = () => { if (e.parentNode) e.parentNode.children = e.parentNode.children.filter((x) => x !== e); };
        e.querySelector = (sel) => find(e, sel);
        e.click = () => e.dispatch('click');
        e.focus = () => { doc.activeElement = e; };
        if (e.tagName === 'CANVAS') {
            e.clientWidth = 1000; e.clientHeight = 340;
            const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (k === 'roundRect' ? undefined : () => { if (k === 'fillRect' || k === 'fill') log.draws++; })), set: (o, k, v) => { o[k] = v; return true; } });
            e.getContext = () => ctx;
        }
        all.push(e);
        if (e.id) byId[e.id] = e;
        return e;
    }
    function find(root, sel) {
        if (sel[0] === '#') return byId[sel.slice(1)] || null;
        const m = sel.match(/^\.([\w-]+)(?:\s+(\w+))?$/);
        if (m) { const host = all.find((x) => x.classList.contains(m[1]) && isIn(x, root)); return host && m[2] ? (host.children.find((c) => c.tagName === m[2].toUpperCase()) || null) : host || null; }
        return null;
    }
    function isIn(x, root) { for (let p = x; p; p = p.parentNode) if (p === root) return true; return root === doc; }

    const doc = { readyState: 'complete', activeElement: null };
    listeners(doc);
    doc.head = Elem('head'); doc.body = Elem('body'); doc.documentElement = Elem('html');
    doc.getElementById = (id) => byId[id] || null;
    doc.querySelector = (sel) => find(doc, sel);
    doc.querySelectorAll = (sel) => {
        if (sel === '[data-view]') return all.filter((x) => 'data-view' in x.attrs);
        if (sel === '.tab') return all.filter((x) => x.classList.contains('tab'));
        return [];
    };
    doc.createElement = (tag) => Elem(tag);
    doc.createTextNode = (s) => ({ textContent: String(s), tagName: '#text' });
    // the static elements of index.html (ids, data-view, tabs) with their attributes
    const re = /<(\w+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*>/g;
    let m;
    while ((m = re.exec(HTML))) {
        const attrs = {}, ar = /([\w-]+)(?:="([^"]*)")?/g;
        let a;
        while ((a = ar.exec(m[2]))) attrs[a[1]] = a[2] === undefined ? '' : a[2];
        if (attrs.id || 'data-view' in attrs || /\btab\b/.test(attrs.class || '')) {
            const e = Elem(m[1], attrs);
            if (m[1] === 'input' && attrs.type === 'checkbox') e.checked = 'checked' in attrs;
            if ('value' in attrs) e.value = attrs.value;
        }
    }

    const store = {};
    const win = {
        document: doc, console, setTimeout, clearTimeout, TextEncoder, TextDecoder, btoa, atob, performance,
        devicePixelRatio: 2,
        localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
        matchMedia: () => ({ matches: false, addEventListener() {} }),
        location: { href: 'file:///x/tools/cruise-sim/ui/index.html', get hash() { const i = this.href.indexOf('#'); return i < 0 ? '' : this.href.slice(i); }, replace(h) { this.href = this.href.split('#')[0] + h; } },
        history: { replaceState: (s, t, url) => { win.location.href = url; log.hash.push(url.split('#')[1] || ''); } },
        navigator: {},
        requestAnimationFrame: (fn) => { log.rafs++; setTimeout(() => fn((now += 16)), 0); return 1; },
        Blob: function Blob(parts) { this.parts = parts; log.blobs++; },
        URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
        Worker: function Worker() { throw new Error('SecurityError: no workers under file:// (stub)'); },
        prompt: () => null,
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        ResizeObserver: function ResizeObserver() { this.observe = () => {}; this.disconnect = () => {}; },
    };
    listeners(win);
    win.window = win; win.self = win;
    const ctx = vm.createContext(win);
    function loadScript(s) {
        const file = path.resolve(UI, s.src || s.attrs.src);
        setTimeout(() => {
            if (!fs.existsSync(file)) { (s.onerror || (() => {}))(); return; }
            // as a browser does: an error in a classic script is reported (window.onerror) and the load event still fires
            try { vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file }); }
            catch (e) { log.scriptErrors.push(path.relative(UI, file) + ': ' + e.message); }
            (s.onload || (() => {}))();
        }, 0);
    }
    return { win, doc, byId, log, store, ctx, run: (rel) => vm.runInContext(fs.readFileSync(path.join(UI, rel), 'utf8'), ctx, { filename: rel }) };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
async function until(fn, what, n) {
    for (let i = 0; i < (n || 400); i++) { if (fn()) return; await tick(2); }
    throw new Error('timed out waiting for ' + what);
}

async function boot() {
    const d = makeDom();
    d.run('scene.js');
    d.run('app.js');
    await until(() => d.win.app && d.win.app.result, 'the first run');
    return d;
}

test('boot: the engine (or the fake), the first run, the canvas, the placeholders, the badges', async () => {
    const { win, byId, log } = await boot();
    const app = win.app;
    assert.ok(['core', 'fake'].includes(app.engine));
    assert.ok(app.result.t.length > 100);
    assert.ok(log.draws > 10, 'the scene painted');
    for (const id of ['charts', 'settings', 'batch', 'report']) {
        const txt = byId[id].textContent;
        if (!win.CS[{ charts: 'charts', settings: 'settings', batch: 'batch', report: 'reportView' }[id]]) assert.match(txt, /not loaded/, id);
    }
    assert.match(byId['plant-badge'].textContent, /^assumed plant: /);
    if (app.engine === 'fake') assert.match(byId['engine-badge'].textContent, /FAKE/);
    assert.match(byId['verdict-badge'].textContent, /^with an assumed plant: /, 'never worded as a verdict');
    const tEnd = app.result.t[app.result.t.length - 1];
    assert.equal(byId.time.textContent, '0.00 / ' + tEnd.toFixed(1) + ' s');
    const tl = app.timeline;
    assert.equal(byId['scrub-marks'].children.length, tl.faults.length + tl.warns.length + (tl.collision ? 1 : 0), 'faults and warnings marked on the scrubber');
    assert.equal(byId.speed.children.length, 7);
});

test('boot reports which core files loaded; a core file that throws does not stop the page', async () => {
    const { win, log, byId } = await boot();
    const coreErrors = log.scriptErrors.filter((e) => e.startsWith('../core/'));
    if (win.app.engine === 'core') assert.deepEqual(coreErrors, [], 'every core file loads in one shared global scope');
    else {
        assert.equal(win.app.engine, 'fake');
        assert.match(byId.status.textContent + ' ' + byId['engine-badge'].textContent, /FAKE/);
        if (coreErrors.length) console.log('# core files that fail as browser scripts (SC1 / SC2 / SC3):\n#   ' + coreErrors.join('\n#   '));
    }
});

test('playback: play at ×16 through requestAnimationFrame to the end; step; setCursor; events', async () => {
    const { win, byId } = await boot();
    const app = win.app, seen = { cursor: 0, frame: 0 };
    app.on('cursor', () => seen.cursor++);
    app.on('frame', (fr) => { seen.frame++; assert.ok(fr.ego); });
    app.setSpeed(16);
    assert.equal(byId.speed.value, '16');
    app.play();
    assert.equal(byId.play.textContent, '❚❚');
    await until(() => !app.playback.playing, 'the end of the run', 3000);
    assert.equal(app.cursorT, app.result.t[app.result.t.length - 1]);
    assert.ok(seen.cursor > 100 && seen.frame > 100, JSON.stringify(seen));
    assert.equal(byId.play.textContent, '▶');
    const dt = app.result.t[1] - app.result.t[0];
    app.setCursor(10);
    assert.equal(app.cursorT, 10);
    app.step(1); assert.ok(Math.abs(app.cursorT - (10 + dt)) < 1e-9);
    app.step(-10); assert.ok(Math.abs(app.cursorT - (10 - 9 * dt)) < 1e-9);
    byId.scrub.value = '20'; byId.scrub.dispatch('input', { target: byId.scrub });
    assert.equal(app.cursorT, 20);
    win.document.dispatch('keydown', { key: 'ArrowRight', shiftKey: true, target: win.document.body });
    assert.ok(Math.abs(app.cursorT - (20 + 10 * dt)) < 1e-9);
    win.document.dispatch('keydown', { key: ']', target: win.document.body });
    assert.equal(app.playback.speed, 16);
});

test('config: setConfig merges, emits, writes the hash; a link restores it; replace and openRun', async () => {
    const { win, log } = await boot();
    const app = win.app;
    let got = null;
    app.on('config', (c) => { got = c; });
    app.setConfig({ controller: { rateHz: 5 } }, { run: false });
    app.setConfig({ controller: { h: 1.5 } }, { run: false });
    assert.equal(got.controller.h, 1.5);
    assert.equal(got.controller.rateHz, 5, 'merged, not replaced');
    await tick(350);
    const h = log.hash[log.hash.length - 1];
    assert.match(h, /^c=/);
    const st = app.pure.decodeState(h);
    assert.equal(st.config.controller.h, 1.5);
    // a second page opened with that link starts from the same config
    const d2 = makeDom();
    d2.win.location.href += '#' + h;
    d2.run('scene.js'); d2.run('app.js');
    await until(() => d2.win.app && d2.win.app.result, 'run of the linked page');
    assert.equal(d2.win.app.config.controller.h, 1.5);
    app.setConfig({ seed: 5 }, { replace: true, run: false });
    assert.equal(app.config.controller, undefined, 'replace drops the old partial');
    assert.equal(app.config.seed, 5);
    const r = await app.openRun({ seed: 9, duration: 20 });
    assert.equal(r.t[r.t.length - 1], 20);
    assert.equal(app.result, r);
});

test('files: a result file, a batch file, a config file, presets (save, apply, export)', async () => {
    const { win, log, store } = await boot();
    const app = win.app;
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'su1-fake-result.json'), 'utf8');
    assert.equal(app.loadResultFile(fixture, 'su1-fake-result.json'), 'result');
    assert.equal(app.result.t.length, 301);
    assert.match(app.result.meta.source, /^file/);
    let batch = null;
    app.on('batch', (b) => { batch = b; });
    assert.equal(app.loadResultFile({ kind: 'cs-batch', runs: [{ id: 'a' }] }), 'batch');
    assert.equal(batch.runs.length, 1);
    assert.equal(app.batch, batch);
    assert.throws(() => app.loadResultFile({ hello: 1 }), /not a result file/);
    // presets in localStorage
    app.setConfig({ seed: 42 }, { run: false });
    assert.equal(app.presets.save('my set'), true);
    assert.ok(JSON.parse(store['cruise-sim.presets.v1'])['my set']);
    app.setConfig({ seed: 1 }, { run: false });
    assert.equal(app.presets.apply('my set'), true);
    assert.equal(app.config.seed, 42);
    // A / B: keep the current run as B, then drop it
    let cmp;
    app.on('compare', (x) => { cmp = x; });
    win.document.getElementById('keep-b').click();
    assert.equal(cmp.t.length, app.result.t.length);
    assert.equal(app.resultB, cmp);
    assert.equal(win.document.getElementById('clear-b').hidden, false);
    win.document.getElementById('clear-b').click();
    assert.equal(app.resultB, null);
    assert.equal(win.document.getElementById('clear-b').hidden, true);
    const blobs = log.blobs;
    win.document.getElementById('preset-export').click();
    app.exportConfig();
    app.exportResult();
    assert.equal(log.blobs, blobs + 3);
});

test('with an engine: the worker is refused (as Chrome does under file://) and the run falls back to the page, in createSim slices', async () => {
    const d = await boot(), { win, byId } = d;
    const app = win.app, CS = win.CS;
    if (!CS.fakeResult) d.run('fake-result.js');
    let advanced = 0;
    // a stand-in engine with the contract's step API, built on the fake
    CS.sim = {
        run: (cfg) => CS.fakeResult.makeFakeResult(cfg),
        createSim(cfg) {
            const full = CS.fakeResult.makeFakeResult(cfg), dur = cfg.duration || 60;
            let t = 0;
            return {
                get done() { return t >= dur; },
                advance(s) { t = Math.min(dur, t + s); advanced++; },
                state: () => ({ t }), result: () => full,
            };
        },
    };
    app.runMode = 'worker';
    const r = await app.run();
    assert.ok(r && r.t.length > 0);
    assert.match(r.meta.source, /^core · page$/);
    assert.match(byId.status.textContent, /Run done/);
    assert.ok(advanced >= 120, 'advanced in 0.5 s slices: ' + advanced);
    assert.equal(app.engine, 'core');
    // a run that throws is reported, the old result stays
    CS.sim.createSim = () => { throw new Error('bad config: plant.aMin'); };
    const before = app.result;
    assert.equal(await app.run(), null);
    assert.match(byId.status.textContent, /Run failed: bad config/);
    assert.equal(app.result, before);
});

test('same config twice while running: one run; a new config cancels the older run', async () => {
    const { win } = await boot();
    const app = win.app;
    const p1 = app.run(), p2 = app.run();
    assert.equal(p1, p2);
    app.setConfig({ seed: 2 }, { run: false });
    const p3 = app.run();
    assert.notEqual(p3, p1);
    const [a, c] = await Promise.all([p1, p3]);
    assert.equal(a, null, 'the superseded run is dropped');
    assert.equal(app.result, c);
});
