'use strict';
/**
 * cases.js - research round 3, package MC: every path in f30_cluster 0.7.20 that can leave BMW's message-panel window
 * open after BMW's message is gone, replayed through the real engine (engine.js) with injected signals, in three f30
 * views (opaque theme; see-through G20 file with our row; see-through with BMW's row) and through Twin Dial's machine.
 *
 *   node tools/research3/mc/cases.js [--fix <name>] [--json out.json] [--logs]
 *
 * --fix applies one of the candidate fixes of this branch to app.json's config (FIXES below; all are config keys that are
 * off in app.json). Each case has a ground truth: what BMW shows at each step (a message, or nothing). After every step
 * the window is sampled once our line has settled; a step where BMW shows a message and the window is shut with no text
 * of ours over it is a SAFETY violation; a step where BMW shows nothing and the window is open (or our text is drawn)
 * is a HANG. The log lines each case produces are printed with --logs (numbers only: the engine never logs text).
 */
const fs = require('fs');
const path = require('path');
const E = require('./engine');

const REST = { id: 0, color: 'green', symbol: 6, len: 14 };
const DOOR = { id: 15, color: 'white', symbol: 2, len: 16 };
const STORED = { id: 987, color: 'white', symbol: 5, len: 27 };
const STORED_RED = { id: 52, color: 'red', symbol: 12, len: 22 };
const READY = { id: 40, color: 'white', symbol: 5, len: 37 };
const L = (...e) => ['list', e];
const A = (n, c) => ['active', E.active(n, c)];
const AD = () => ['active', E.DEFAULT_ACTIVE];
const D = (n) => ['displayed', { statusNumberCheckControlMessageDisplay: n }];
const M = (v) => ['ccm', v];
const BAD = () => ['listRaw', [{ somethingElse: {} }]];
const W = (ms) => ['wait', ms];

/** Each step: [ what BMW shows after it: 'msg' | 'none', ...events ]. */
const CASES = [
    { id: 'A0', what: 'control: door opens and shuts, the active number goes 0 -> 15 -> 0, the list rest -> [15] -> rest',
        steps: [['none', L(REST), A(0)], ['msg', L(DOOR), A(15)], ['none', L(REST), A(0)], ['none', W(30000)]] },
    { id: 'A0b', what: 'control, the other order on shutting: the active number 0 first, the list after it',
        steps: [['none', L(REST), A(0)], ['msg', A(15), L(DOOR)], ['none', A(0), L(REST)], ['none', W(30000)]] },
    { id: 'A1', what: 'the getter answers the catalogue default (number 65535, control 4095, frame 15/15) and nothing ever shows',
        steps: [['none', AD(), L(REST)], ['none', W(30000)]] },
    { id: 'A2', what: 'a message, and on its end the active number goes back to 65535 (unfilled), not 0',
        steps: [['none', AD(), L(REST)], ['msg', L(DOOR), A(15)], ['none', L(REST), AD()], ['none', W(30000)]] },
    { id: 'A3', what: 'a message, and on its end the active number is never notified again (it keeps 15); the list returns to rest',
        steps: [['none', L(REST), A(0)], ['msg', L(DOOR), A(15)], ['none', L(REST)], ['none', W(30000)]] },
    { id: 'A4', what: 'as A3, but the control word changes (number kept 15, control 0)',
        steps: [['none', L(REST), A(0)], ['msg', L(DOOR), A(15)], ['none', L(REST), A(15, 0)], ['none', W(30000)]] },
    { id: 'A5', what: 'a temporary message (ready-to-drive 987) is hidden by BMW after ~20 s and stays listed; the active number stays 987',
        steps: [['none', L(REST), A(0)], ['msg', L(STORED), A(987)], ['msg', W(15000)], ['none', W(10000)], ['none', W(30000)]] },
    { id: 'A5w', what: 'A5 with the second witness: displayed goes back to 0 when BMW hides 987, the active number stays 987',
        steps: [['none', L(REST), A(0), D(0)], ['msg', L(STORED), A(987), D(987)], ['msg', W(15000)], ['none', W(10000), D(0)], ['none', W(30000)]] },
    { id: 'A6', what: 'the active field never notifies (silent, getter fails); door opens and shuts',
        steps: [['none', L(REST)], ['msg', L(DOOR)], ['none', L(REST)], ['none', W(30000)]] },
    { id: 'A7', what: 'the active field silent; a stored WHITE entry stays listed after BMW hid it (~20 s)',
        steps: [['none', L(REST)], ['msg', L(STORED)], ['msg', W(15000)], ['none', W(10000)], ['none', W(30000)]] },
    { id: 'A8', what: 'the active field silent; a stored RED entry stays listed after BMW hid it',
        steps: [['none', L(REST)], ['msg', L(STORED_RED)], ['msg', W(15000)], ['none', W(10000)], ['none', W(30000)]] },
    { id: 'A9', what: 'the active field silent; a red message, then a list our config.ccList does not fit (the old list is kept)',
        steps: [['none', L(REST)], ['msg', L(STORED_RED)], ['none', BAD()], ['none', W(30000)]] },
    { id: 'A10', what: 'blind: neither ccList nor the active field ever arrives',
        steps: [['none', W(1000)], ['none', W(30000)]] },
    { id: 'A11', what: 'newCCMessage answers its getter with an unreadable struct (no name, id 65535) once, never again',
        steps: [['none', L(REST), A(0), M({ cCMessageStruct: { cCIdentifier: 65535, cCName: '', additionalDescription: '', cCSymbolID: 0, cCColor: 'DEFAULT', cCType: 0 } })], ['none', W(30000)]] },
    { id: 'A12', what: 'a message whose name our font cannot draw (Greek; wb_msg has Latin and Cyrillic): the row latches; the message then ends properly',
        steps: [['none', L(REST), A(0)], ['msg', L({ id: 15, color: 'white', symbol: 2, name: 'Πόρτα οδηγού ανοιχτή' }), A(15)], ['none', L(REST), A(0)], ['none', W(30000)]] },
    { id: 'A13', what: 'a listed message with an empty name (unread): latches; the message then ends properly',
        steps: [['none', L(REST), A(0)], ['msg', L({ id: 15, color: 'white', symbol: 2, name: '' }), A(15)], ['none', L(REST), A(0)], ['none', W(30000)]] },
    { id: 'A14', what: 'the resting entry is not id 0 (id 1 GREEN) and the active field is silent',
        steps: [['none', L({ id: 1, color: 'green', symbol: 6, len: 14 })], ['none', W(30000)]] },
    { id: 'A15', what: 'A1 with the second witness: displayed says 0 while the active field is stuck on its default 65535',
        steps: [['none', AD(), D(0), L(REST)], ['msg', L(DOOR), A(15), D(15)], ['none', L(REST), AD(), D(0)], ['none', W(30000)]] },
    { id: 'A16', what: 'A3 with the second witness: displayed goes back to 0, the active number stays 15',
        steps: [['none', L(REST), A(0), D(0)], ['msg', L(DOOR), A(15), D(15)], ['none', L(REST), D(0)], ['none', W(30000)]] },
    { id: 'S1', what: 'safety: a message the list carries, while the active field is stuck on 65535 (it never names it)',
        steps: [['none', AD(), L(REST)], ['msg', L(DOOR)], ['msg', W(30000)], ['none', L(REST)], ['none', W(30000)]] },
    { id: 'S2', what: 'safety: a RED message the list carries, the active field stuck on 65535 for a minute',
        steps: [['none', AD(), L(REST)], ['msg', L(STORED_RED)], ['msg', W(60000)], ['none', L(REST)], ['none', W(10000)]] },
    { id: 'S3', what: 'safety: the active number arrives 2 s before the list carries it',
        steps: [['none', L(REST), A(0)], ['msg', A(15)], ['msg', W(2000)], ['msg', L(DOOR)], ['none', L(REST), A(0)]] },
    { id: 'S5', what: 'safety: a message the cluster shows under a number the list never carries, the list AT REST',
        steps: [['none', L(REST), A(0)], ['msg', A(1234)], ['msg', W(60000)], ['none', A(0)], ['none', W(10000)]] },
    { id: 'A17', what: 'the getter default 65535 while a stored WHITE entry (987) stays listed and BMW shows nothing',
        steps: [['none', AD(), L(STORED)], ['none', W(30000)]] },
    { id: 'S4', what: 'safety: a message the cluster shows under a number the list never carries, the list not at rest (stored 987)',
        steps: [['none', L(STORED), A(0)], ['msg', A(1234)], ['msg', W(60000)], ['none', A(0)], ['none', W(10000)]] },
];

/** Candidate fixes: each a change of app.json config only (the code is on this branch, inert while the keys are absent). */
const WITNESS = { iface: 'de.bmw.infotainment.vehicle.Vehicle2', field: 'statusDisplayedCCMessage', numberPath: ['statusNumberCheckControlMessageDisplay'] };
const FIXES = {
    none: null,
    // F0: config only, no code - the brief's first candidate: 65535 counts as "no message"
    none65535: (c) => { c.ccActive.noneValues = [0, 65535]; },
    // F1: 65535 (the catalogue default) is no verdict: the list decides (then "listed": shown while anything is listed)
    defer: (c) => { c.ccActive.release = { deferValues: [65535] }; },
    // F1h: as F1, the list deciding by the 0.7.20 heuristic (20 s, red while listed)
    'defer-h': (c) => { c.ccActive.release = { deferValues: [65535], then: 'heuristic' }; },
    // F2: a number with no ccList entry for 3 s: the list decides ("listed")
    noentry: (c) => { c.ccActive.release = { noEntryMs: 3000 }; },
    // F3: the second witness, used: when displayed says none, the list decides ("listed")
    witness: (c) => { c.ccDisplayed = Object.assign({ use: true }, WITNESS); c.ccActive.release = { witness: true }; },
    // F3h: as F3 with the heuristic (the only one that can close a stored entry the active field is stuck on, A5)
    'witness-h': (c) => { c.ccDisplayed = Object.assign({ use: true }, WITNESS); c.ccActive.release = { witness: true, then: 'heuristic' }; },
    // F2b: a number whose ccList entry was listed and has left the list: the list decides ("listed")
    leftlist: (c) => { c.ccActive.release = { leftList: true }; },
    // F5: newCCMessage's unfilled id is a clear id (config only, an existing key)
    ccmclear: (c) => { if (c.ccm) c.ccm.clearIds = [65535]; },
    // F4: the control word: these values say "nothing shown" (the real value is unknown until the log shows it; 0 here)
    control: (c) => { c.ccActive.release = { deferControls: [0] }; },
    // the recommended set for the next install: F1 + F2b + F5, "listed", and the witness logged (not used)
    rec: (c) => { c.ccActive.release = { deferValues: [65535], leftList: true }; if (c.ccm) c.ccm.clearIds = [65535]; c.ccDisplayed = Object.assign({ use: false }, WITNESS); },
    // rec with the witness used (after the log shows displayed going back to 0 with the message)
    'rec-w': (c) => { c.ccActive.release = { deferValues: [65535], leftList: true, witness: true }; if (c.ccm) c.ccm.clearIds = [65535]; c.ccDisplayed = Object.assign({ use: true }, WITNESS); },
    // rec-w with the heuristic (closes A5w; carries the 0.7.20 fallback's 20 s risk, S1)
    'rec-wh': (c) => { c.ccActive.release = { deferValues: [65535], leftList: true, witness: true, then: 'heuristic' }; if (c.ccm) c.ccm.clearIds = [65535]; c.ccDisplayed = Object.assign({ use: true }, WITNESS); },
    // car-fix CF1 (with base "shipped"): the active number is not declared dead - it is a witness once it moves
    'cf1-live': (c) => { c.ccActive.dead = false; },
    // car-fix CF1: the shipped config plus the research3/MC release on (Діагностика): it must change nothing while displayed decides
    'cf1-rel': (c) => { c.ccActive.release = { deferValues: [65535], leftList: true }; },
};

const VIEWS = [
    { key: 'f30 opaque', app: 'f30_cluster', kind: 'opaque', row: 'ours' },
    { key: 'f30 G20 row ours', app: 'f30_cluster', kind: 'see', row: 'ours' },
    { key: 'f30 G20 row BMW', app: 'f30_cluster', kind: 'see', row: 'bmw' },
    { key: 'twin', app: 'twin_dial', kind: 'opaque', row: 'ours' },
];

// ---- car-fix CF1 (docs/car-fix/CF1-REPORT.md): the owner's car on 2026-11-18 (signal_probe 0.1.1 and twin_dial.log, numbers
// only). KombiIF statusActiveCCMessage sat on 65535 (control 4095, frame 15/15) the whole run; Vehicle2.statusDisplayedCCMessage
// is the "shown now": after an app start 0 (or 65535, unknown), the door -> ccList id 15 then displayed 15 within ~50 ms, closed ->
// the list at rest, displayed 0 0.2-0.7 s later; 285 / 926 / 927 / 184 displayed for ~6 s with NO ccList entry; at 13:41 the
// sequence below (2255 listed and shown, 285 shown over it, 19 joins and shows, the list empties, displayed 0, then the boot 14).
// Each case runs on the SHIPPED config (base "shipped": ccActive.source "displayed", dead true). ----
const DOOR14 = { id: 14, color: 'white', symbol: 2, len: 16 };
const E2255 = { id: 2255, color: 'white', symbol: 5, len: 36 };
const E19 = { id: 19, color: 'white', symbol: 2, len: 33 };
const CAR = [
    { id: 'K0', what: 'the car: an app start with displayed 65535 (unknown) and active 65535, then displayed 0 with the list at rest',
        steps: [['msg', AD(), D(65535), L(REST)], ['msg', W(3000)], ['none', D(0)], ['none', W(30000)]] },
    { id: 'K1', what: 'the car: the door - ccList 15 and displayed 15 together; closed - the list at rest, displayed 0 0.7 s later',
        steps: [['none', D(0), AD(), L(REST)], ['msg', L(DOOR), D(15)], ['msg', W(1500)], ['msg', L(REST)], ['none', W(700), D(0)], ['none', W(30000)]] },
    { id: 'K2', what: 'the car: displayed 285 for 6 s with no ccList entry (the list at rest): BMW\'s own message, never ours',
        steps: [['none', D(0), AD(), L(REST)], ['msg', D(285)], ['msg', W(6000)], ['none', D(0)], ['none', W(30000)]] },
    { id: 'K3', what: 'the car, 13:41: 2255 listed and shown, 285 shown over it, 19 joins and shows, the list empties, 0; then the boot (14)',
        steps: [['none', D(0), AD(), L(REST)], ['msg', L(E2255), D(2255)], ['msg', W(3600), D(285)], ['msg', W(3000), L(E19, E2255), D(19)],
            ['msg', W(850), L(E19)], ['msg', W(100), L(REST)], ['none', W(150), D(0)], ['msg', W(150), L(DOOR14), D(14)], ['msg', W(7000), L(REST)],
            ['none', W(180), D(0)], ['none', W(30000)]] },
    { id: 'K4', what: 'the stuck window of 0.7.20: active 65535 forever, displayed 0, the list at rest - must close',
        steps: [['none', AD(), D(0), L(REST)], ['none', W(30000)]] },
    { id: 'K5', what: 'a stored entry (987) stays listed, displayed 0: BMW shows nothing, the panel may be covered (MC\'s A5w / A17 closed by displayed)',
        steps: [['none', AD(), D(0), L(REST)], ['msg', L(STORED), D(987)], ['msg', W(15000)], ['none', W(5000), D(0)], ['none', W(30000)]] },
    { id: 'K6', what: 'a stored RED entry stays listed, displayed 0: closed (MC\'s A8 with displayed); shown while displayed names it',
        steps: [['none', AD(), D(0), L(REST)], ['msg', L(STORED_RED), D(52)], ['msg', W(10000)], ['none', D(0)], ['none', W(30000)]] },
    { id: 'K7', what: 'the end of a drive: displayed goes to 65535 (unknown) with the list at rest: BMW\'s panel opens',
        steps: [['none', AD(), D(0), L(REST)], ['msg', D(65535)], ['msg', W(30000)]] },
    { id: 'K8', what: 'displayed names a number the list carries only 2 s later (S3 on displayed): open until the entry is there',
        steps: [['none', AD(), D(0), L(REST)], ['msg', D(15)], ['msg', W(2000)], ['msg', L(DOOR)], ['none', L(REST), D(0)], ['none', W(30000)]] },
    { id: 'K9', what: 'BEFORE displayed speaks (dead active, the list\'s fallback): a door message, then displayed 0 - the panel open while listed',
        steps: [['none', AD(), L(REST)], ['msg', L(DOOR)], ['none', L(REST)], ['none', D(0)], ['none', W(30000)]] },
];
// with config.ccActive.dead false: an active number that MOVES is a witness again beside displayed (a car where it works)
const CAR_LIVE = [
    { id: 'L1', what: 'active never moves (0 the whole run): no witness, displayed alone decides (the door becomes ours)',
        steps: [['none', A(0), D(0), L(REST)], ['msg', L(DOOR), D(15)], ['msg', W(1000)], ['none', L(REST), D(0)], ['none', W(30000)]] },
    { id: 'L2', what: 'active moves to 14 while displayed says 0: the witnesses disagree, BMW\'s panel open until they agree',
        steps: [['none', A(0), D(0), L(REST)], ['msg', L(DOOR14), A(14)], ['msg', W(1000)], ['msg', D(14)], ['none', L(REST), A(0), D(0)], ['none', W(30000)]] },
    { id: 'L3', what: 'active 65535 (dead value) after it moved: no witness at that moment',
        steps: [['none', A(0), D(0), L(REST)], ['msg', L(DOOR), A(15), D(15)], ['none', L(REST), AD(), D(0)], ['none', W(30000)]] },
];

/** base "legacy" (the default: MC's documented matrix): the config as it was before car-fix CF1 - ccActive without
 *  source / dead / unknownValues / confirmNow, f30 without ccDisplayed. base "shipped": app.json as it is now. */
function legacy(c, app) {
    if (c.ccActive) { delete c.ccActive.source; delete c.ccActive.dead; delete c.ccActive.unknownValues; delete c.ccActive.confirmNow; }
    if (app === 'f30_cluster') c.ccDisplayed = null;
}

function runCase(cs, view, fixName, base) {
    E.useFakeClock(true);
    E.setNow(1700000000000);
    const fix = FIXES[fixName];
    const e = E.make(view.app, { kind: view.kind, row: view.row }, (c) => {
        if (base !== 'shipped') legacy(c, view.app);      // car-fix CF1
        // the twin app's config gets the same fix where it applies (its own machine ignores release; listed for completeness)
        if (fix) fix(c);
    });
    const t0 = E.now();
    const out = { steps: [], hang: 0, unsafe: 0, firstHangAt: null };
    let stepNo = 0;
    for (const st of cs.steps) {
        const truth = st[0];
        for (const ev of st.slice(1)) {
            const [k, v] = ev;
            if (k === 'wait') E.advance(e, v);
            else if (k === 'list') E.feed(e, E.KI2, 'ccList', E.ccList(v));
            else if (k === 'listRaw') E.feed(e, E.KI2, 'ccList', v);
            else if (k === 'active') E.feed(e, E.KIF, 'statusActiveCCMessage', v);
            else if (k === 'displayed') E.feed(e, E.V2, 'statusDisplayedCCMessage', v);
            else if (k === 'ccm') E.feed(e, E.KI2, 'newCCMessage', v);
        }
        const v = E.verdict(e);
        const covered = !v.open && !v.ours;
        const hang = truth === 'none' && (v.open || v.ours);
        const unsafe = truth === 'msg' && covered;
        if (hang) { out.hang++; if (out.firstHangAt === null) out.firstHangAt = stepNo; }
        if (unsafe) out.unsafe++;
        out.steps.push({ t: Math.round((E.now() - t0) / 100) / 10, truth, open: v.open, ours: v.ours, shown: v.shown, hang, unsafe,
            state: v.state, reason: v.reason, noMatch: v.noMatch });
        stepNo++;
    }
    const last = out.steps[out.steps.length - 1];
    out.endsOpen = !!(last.open || last.ours) && last.truth === 'none';
    out.endWhat = last.open ? 'window open' : last.ours ? 'our text' : 'covered';
    out.log = e.lines.map((x) => '+' + ((x.t - t0) / 1000).toFixed(1) + 's ' + x.l);
    E.useFakeClock(false);
    return out;
}

function main() {
    const args = process.argv.slice(2);
    const fixName = args.indexOf('--fix') >= 0 ? args[args.indexOf('--fix') + 1] : 'none';
    if (!(fixName in FIXES)) { console.error('no such fix: ' + fixName + ' (' + Object.keys(FIXES).join(', ') + ')'); process.exit(2); }
    const jsonOut = args.indexOf('--json') >= 0 ? args[args.indexOf('--json') + 1] : null;
    const logs = args.indexOf('--logs') >= 0;
    const only = args.indexOf('--case') >= 0 ? args[args.indexOf('--case') + 1] : null;
    const res = { fix: fixName, cases: [] };
    console.log('fix: ' + fixName);
    console.log(['case', ...VIEWS.map((v) => v.key)].map((s, i) => (i ? s.padEnd(24) : s.padEnd(5))).join(' '));
    for (const cs of CASES) {
        if (only && cs.id !== only) continue;
        const row = { id: cs.id, what: cs.what, views: {} };
        const cells = [];
        for (const view of VIEWS) {
            const r = runCase(cs, view, fixName);
            row.views[view.key] = r;
            cells.push(((r.endsOpen ? 'HANG ' + r.endWhat : 'ok') + (r.unsafe ? ' UNSAFE x' + r.unsafe : '') + (r.hang && !r.endsOpen ? ' (open ' + r.hang + ' steps)' : '')).padEnd(24));
        }
        console.log(cs.id.padEnd(5) + ' ' + cells.join(' '));
        if (logs) {
            console.log('      ' + cs.what);
            VIEWS.forEach((v) => {
                if (v.key !== 'f30 opaque' && v.key !== 'twin') return;
                console.log('      [' + v.key + '] steps: ' + row.views[v.key].steps.map((s) => s.truth + '>' + (s.open ? 'open' : s.ours ? 'ours' : 'shut') + (s.noMatch !== null && s.noMatch !== undefined ? '(nm ' + s.noMatch + ')' : '')).join(' '));
                row.views[v.key].log.forEach((l) => console.log('        ' + l));
            });
        }
        res.cases.push(row);
    }
    if (jsonOut) {
        // the log lines are numbers only (the engine's own lines); kept for the decision table
        fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
        fs.writeFileSync(jsonOut, JSON.stringify(res, null, 1));
        console.log('wrote ' + jsonOut);
    }
    return res;
}

if (require.main === module) main();
module.exports = { CASES, FIXES, VIEWS, runCase, CAR, CAR_LIVE };
