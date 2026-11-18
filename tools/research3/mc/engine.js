'use strict';
/**
 * engine.js - research round 3, package MC: the REAL message code of shared/hud.js (its signal handlers, _ccListEval,
 * _ccMerge, _ccOpen, _ccText, _maskLanes, and Twin Dial's TwinCC through _twinInputs), driven in this process with
 * injected signal values and an injected clock. No cluster-render, no bench, no kit signals: the kit's Car is replaced
 * by a stand-in that only keeps the handler table hud.js builds (`extra`), so every value goes through the very
 * handler the car's notification would reach.
 *
 * What is modelled and what is not:
 *   - the theme kind: "opaque" (wb_comfort / wb_sport / wb_eco: BMW's panel window is u_cc = _ccOpen) or "see" (the
 *     G20 see-through files with the strip mask: the window is the mask's "msg" hole lane, _maskLanes), and in "see"
 *     whether the bottom row is ours (bottomRow all6WB, a zone known) or BMW's (the switch, or a latch);
 *   - "our text on screen": the engine paints the message line in its tick and stamps _ccPainted; here every step
 *     paints the headline the engine would paint (_ccText('head'), which is '' whenever _own('info') is false) and
 *     samples the window CC_SETTLE_MS later, i.e. after the handshake - the steady state the driver sees;
 *   - the tick: only its message part (_ccListEval while the fallback has an entry to expire), every 100 ms of fake time.
 * Never shipped. Node 18+ on the Mac.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..', '..', '..');
const H = require(path.join(ROOT, 'bench', 'twin-harness.js'));

let captured = null;
const realLoad = Module._load;
Module._load = function (req) {
    if (/(^|\/)kit\/car$/.test(req)) {
        return class StubCar {
            constructor(ctx, groups, extra) { captured = extra; this.live = {}; }
            setRedline() {} onSample() {} data() { return {}; }
        };
    }
    return realLoad.apply(this, arguments);
};

const trees = {};
function hudClass(app) {
    if (!trees[app]) {
        const dir = H.tree(app);
        trees[app] = { dir, HudApp: require(path.join(dir, 'hud.js')) };
    }
    return trees[app].HudApp;
}

let fakeNow = 1700000000000;
const realNow = Date.now;
function useFakeClock(on) { Date.now = on ? () => fakeNow : realNow; }

/**
 * A HudApp with app `app`'s real config (app.json, optionally changed by `patch(config)`), its handlers built by the
 * real _setupVehicleData. opts: { kind: 'opaque' | 'see', row: 'ours' | 'bmw' }.
 */
function make(app, opts, patch) {
    const HudApp = hudClass(app);
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', app, 'app.json'), 'utf8'));
    const config = JSON.parse(JSON.stringify(spec.config || {}));
    if (patch) patch(config);
    const lines = [];
    const log = { info: (s) => lines.push({ t: fakeNow, l: 'INFO ' + s }), warn: (s) => lines.push({ t: fakeNow, l: 'WARN ' + s }),
        error: (s) => lines.push({ t: fakeNow, l: 'ERROR ' + s }), debug() {} };
    const settings = { bottomRow: opts.row === 'bmw' ? 'allG20' : 'all6WB', timeZone: 'Europe/Kiev' };
    const h = H.fakeHud(HudApp, { config, log, settings });
    h.ctx.spec = Object.assign({}, spec, { config });
    h.client = null; h.widgets = new Map(); h.started = false;
    h._status = () => {}; h._rebuild = () => {};
    const see = opts.kind === 'see';
    h._layoutName = () => (see ? 'wb_dials' : 'wb_comfort');
    h._seeThrough = () => see;
    h._tzMinutes = () => 120;
    captured = null;
    HudApp.prototype._setupVehicleData.call(h);
    const extra = captured;
    // the strip mask's lane table (the see-through layouts' WBBACK), for the "msg" hole lane
    let mask = null;
    if (see) {
        try {
            const lay = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', app, 'hud', 'layouts', 'wb_dials.json'), 'utf8'));
            const bg = lay.widgets.find((w) => w.id === 'bg');
            const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', app, 'hud', 'scene', bg.mask.tex + '.json'), 'utf8')).mask;
            mask = m;
        } catch (e) { mask = null; }
    }
    return { h, extra, lines, config, see, mask, HudApp };
}

/** The ccList value as the car sends it (a list of CCListElementUnion { cCListElement: {...} }), from [{ id, name, color, symbol }]. */
function ccList(entries) {
    return entries.map((e) => ({ cCListElement: { cCIdentifer: e.id, cCShortName: e.name === undefined ? 'x'.repeat(e.len || 16) : e.name,
        cCListSymbolID: e.symbol === undefined ? 2 : e.symbol, cCColor: (e.color || 'white').toUpperCase(), cCIndentation: 0, ricResourceID: 0 } }));
}
/** statusActiveCCMessage's struct. */
function active(n, control, frame, of, util) {
    return { numberDisplayControlCheckControlMessage: n, displayControlCheckControlMessage: control === undefined ? (n ? 1 : 0) : control,
        numberFrameDisplayControlCheckControlMessage: frame === undefined ? (n ? 1 : 0) : frame,
        frameDisplayControlCheckControlMessage: of === undefined ? (n ? 1 : 0) : of, utilityDataDisplayControlCheckControlMessage: util || 0 };
}
const DEFAULT_ACTIVE = active(65535, 4095, 15, 15, 0);   // the catalogue's defaults (ActiveCCMessageWrapper)

const KI2 = 'de.bmw.infotainment.KombiInterface_2', KIF = 'de.bmw.infotainment.KombiIF', V2 = 'de.bmw.infotainment.vehicle.Vehicle2';

/** Feed one value through the handler hud.js put on extra[iface][field]; a field nobody watches is ignored (returns false). */
function feed(e, iface, field, v) {
    const f = e.extra[iface] && e.extra[iface][field];
    if (typeof f !== 'function') return false;
    f(v);
    return true;
}

/** The engine's verdict now, after our line has been painted and has settled. */
function verdict(e) {
    const h = e.h;
    let head = '';
    try { head = h._ccText('head'); } catch (err) { head = ''; }
    // the tick paints the line (a glyph the font lacks latches the row instead: hud.js _updateOne)
    if (head && e.see && !h.twinMsg) {          // only the G20 files draw our line (cc_line, font wb_msg)
        const miss = h._missingGlyphs(head, 'wb_msg');
        if (miss) { h._rowFail('info', 'the font "wb_msg" has no glyph for ' + miss + ' of the car\'s text'); head = h._ccText('head'); }
    }
    h._ccPainted(head);
    fakeNow += 160;                          // past CC_SETTLE_MS (150): our text counts as on the screen
    const shown = h._cc();
    let open;
    if (h.twinMsg) {
        const t = h.twinMsg;
        t.update(h._twinInputs(), fakeNow);
        if (t.candidate) { t.painted(t.candidate.key, fakeNow); fakeNow += 160; t.update(h._twinInputs(), fakeNow); }
        open = t.window;
        return { shown, open, ours: t.state === 'ours', state: t.state, reason: t.reason, head: t.candidate ? t.candidate.name.length : 0 };
    }
    if (e.see && e.mask) {
        const l = h._maskLanes(e.mask);
        open = !!(l && (l.hole === 'msg' || l.hole === 'msgMark'));
        head = h._ccText('head');
        return { shown, open, ours: !open && shown === true && head !== '', cover: l && l.cover, head: head.length, noMatch: h.ccNoMatch };
    }
    open = !!h._ccOpen();
    return { shown, open, ours: false, head: head.length, noMatch: h.ccNoMatch };
}

/** Advance fake time by ms, running the tick's message part every 100 ms. */
function advance(e, ms) {
    const end = fakeNow + ms;
    while (fakeNow < end) {
        fakeNow = Math.min(end, fakeNow + 100);
        if (e.h.ccFallbackLive) e.h._ccListEval(fakeNow, true);
    }
}

module.exports = { make, feed, verdict, advance, ccList, active, DEFAULT_ACTIVE, KI2, KIF, V2, useFakeClock,
    now: () => fakeNow, setNow: (t) => { fakeNow = t; }, ROOT };
