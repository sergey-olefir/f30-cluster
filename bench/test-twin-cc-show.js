'use strict';
/**
 * test-twin-cc-show.js - r1120 T1: Twin Dial's shown card in the centre never changes BMW's message panel.
 *
 *   node bench/test-twin-cc-show.js
 *
 * The owner (2026-11-19): "why point at the bottom if we can show it in the centre?" Since r1120 tab 2 shows our card for the
 * message the car names whenever its name can be read, also while BMW's panel stays open (shared/twin_cc.js TwinCentre._shown,
 * kind "show"); the rule that opens and covers BMW's panel is untouched. This suite proves the second half on the REAL engine:
 * it runs bench/test-twin-cc.js twice - with the shown card off (TWIN_CC_SHOW=0, config.ccActive.centreShow false: 0.1.5's
 * pages) and on (as shipped) - and compares the per-frame audit's traces column by column:
 *   C / -  something of ours over BMW's panel;   R / -  the bottom row's ink in it;   O / S  BMW's panel open / shut;
 *   the machine's state (n / w / o) and the selected tab.
 * Only the sheet's own column (what text tab 2 carries) may differ. Both runs must also pass every check of their own, the
 * per-frame audit (V1..V5) included. The engine runs in real time, so a pair that differs under load is run once more
 * (as bench/test-front-vehicle.js does). Mac only, Node 18 or newer; no port, no browser.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const ok = (c, what) => { if (c) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };

/** one run of test-twin-cc.js: its totals and the audit's trace (one token per change: C R sheet O state tab) */
function run(show) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'test-twin-cc.js')], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 900000,
        env: Object.assign({}, process.env, { TWIN_CC_TRACE: '1', TWIN_CC_SHOW: show ? '1' : '0', TWIN_CC_FV: '0' }) });
    const out = (r.stdout || '') + (r.stderr || '');
    const lines = out.split('\n');
    const tot = /(\d+) passed, (\d+) failed/.exec(lines.filter((l) => /^\d+ passed, \d+ failed/.test(l.trim())).pop() || '');
    const trace = (lines.filter((l) => /^[-CRPWbxOS?a-z0-9]{6}( [-CRPWbxOS?a-z0-9]{6})*$/.test(l.trim())).pop() || '').trim();
    const fails = lines.filter((l) => /^\s*FAIL /.test(l)).slice(0, 3);
    return { pass: tot ? Number(tot[1]) : 0, fail: tot ? Number(tot[2]) : -1, trace, fails, out };
}

/** the trace without the sheet's column, consecutive equal states folded */
function panelTrace(trace) {
    const out = [];
    trace.split(' ').filter(Boolean).forEach((tok) => {
        const t = tok[0] + tok[1] + tok[3] + tok[4] + tok[5];
        if (out[out.length - 1] !== t) out.push(t);
    });
    return out;
}

console.log('r1120 T1: the engine with the shown card off and on - BMW\'s panel, the row and the window frame by frame');
let pairs = 0, off, on, a, b;
do {
    pairs++;
    off = run(false); on = run(true);
    a = panelTrace(off.trace); b = panelTrace(on.trace);
} while (pairs < 2 && a.join(' ') !== b.join(' '));
ok(off.fail === 0 && off.pass > 250, 'the shown card OFF (0.1.5\'s pages): test-twin-cc.js ' + off.pass + ' passed, ' + off.fail + ' failed, the per-frame audit included' + (off.fails.length ? ' [' + off.fails.join(' | ') + ']' : ''));
ok(on.fail === 0 && on.pass > 250, 'the shown card ON (as shipped): test-twin-cc.js ' + on.pass + ' passed, ' + on.fail + ' failed, the per-frame audit included' + (on.fails.length ? ' [' + on.fails.join(' | ') + ']' : ''));
let at = 0;
while (at < a.length && a[at] === b[at]) at++;
ok(a.length > 40 && a.join(' ') === b.join(' '), 'BMW\'s panel covered / open, the row\'s ink, the machine\'s state and the tab: the same ' + a.length + ' states in the same order with the shown card on' +
    (a.join(' ') === b.join(' ') ? (pairs > 1 ? ' (the second pair; the first differed under load)' : '') : ' (differs at ' + at + ': off ' + a.slice(Math.max(0, at - 2), at + 3).join(' ') + ' / on ' + b.slice(Math.max(0, at - 2), at + 3).join(' ') + ')'));
// (the audit's sheet column names only the text of the message BMW shows, so the held and the shown cards of the cases do not
// change it; the on run's own pixel checks say the shown card was really drawn, the off run's that it was not)
const shownOn = ['6c. r1120 T1', '12d. r1120 T1: 285 over', '13a. r1120 T1'].filter((w) => on.out.indexOf('  ok   ' + w) >= 0).length;
const pointerOff = ['6c. tab 2 shows the pointer page', '12d. 285 over a listed message that already pulled tab 2: the window opens, tab 2 stays (no new pull), the pointer page', '13a. (shown card off) the pointer page']
    .filter((w) => off.out.indexOf('  ok   ' + w) >= 0).length;
ok(shownOn === 3 && pointerOff === 3, 'and the centre did differ: the on run drew the shown card where the off run drew the pointer (' + shownOn + ' / 3 and ' + pointerOff + ' / 3 pixel checks)');
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
