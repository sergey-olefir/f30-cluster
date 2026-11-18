'use strict';
/**
 * test-cc-release.js - research round 3, package MC (docs/research3/MC-REPORT.md): config.ccActive.release and the
 * f30 second witness (config.ccDisplayed), both OFF in app.json.
 *
 *   node bench/test-cc-release.js
 *
 * No bench, no car: the real engine's message code (shared/hud.js, its handlers built by _setupVehicleData) driven in this
 * process by tools/research3/mc/engine.js with injected signals and an injected clock; the cases are
 * tools/research3/mc/cases.js's. For each candidate fix: the case it is for HANGS without it (BMW shows nothing, the window
 * stays open) and closes with it; and under it no safety case covers BMW's panel while BMW shows a message with no text
 * of ours over it. Never shipped.
 */
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'tools', 'research3', 'mc', 'cases.js'));

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const ROOT = path.join(__dirname, '..');
const F30 = C.VIEWS.filter((v) => v.app === 'f30_cluster');
const TWIN = C.VIEWS.find((v) => v.app === 'twin_dial');
const run = (id, view, fix) => C.runCase(C.CASES.find((c) => c.id === id), view, fix);
const hangs = (id, fix) => F30.every((v) => run(id, v, fix).endsOpen);
const closes = (id, fix) => F30.every((v) => { const r = run(id, v, fix); return !r.endsOpen && !r.unsafe; });
const SAFETY = ['A0', 'A0b', 'S1', 'S2', 'S3', 'S4', 'S5', 'A6', 'A7'];
const unsafeIn = (fix) => {
    const bad = [];
    SAFETY.forEach((id) => C.VIEWS.forEach((v) => { const r = run(id, v, fix); if (r.unsafe) bad.push(id + ' ' + v.key + ' x' + r.unsafe); }));
    return bad;
};

console.log('off by default: app.json carries no release and no f30 witness');
{
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'app.json'), 'utf8'));
    ok(!spec.config.ccActive.release, 'f30_cluster config.ccActive.release is absent (0.7.20 behaviour)');
    ok(!spec.config.ccDisplayed, 'f30_cluster config.ccDisplayed is null (nothing subscribed)');
    const r = run('A0', F30[0], 'none');
    ok(!r.log.some((l) => /released to the list|displayed cc/.test(l)), 'the shipped config logs no release and no witness line');
    ok(unsafeIn('none').length === 0, '0.7.20 itself: no safety case violated (' + unsafeIn('none').join(', ') + ')');
}

console.log('the hangs of 0.7.20, as the replay shows them');
['A1', 'A2', 'A3', 'A4', 'A15', 'A16', 'A11'].forEach((id) => ok(hangs(id, 'none'), id + ' hangs in every f30 view without a fix: ' + C.CASES.find((c) => c.id === id).what));
ok(!hangs('A0', 'none') && !hangs('A6', 'none') && !hangs('A7', 'none') && !hangs('A12', 'none'), 'A0, A6, A7 and A12 (the latch) close by themselves');

console.log('release.deferValues [65535] (then "listed")');
['A1', 'A2', 'A15', 'S1', 'S2'].forEach((id) => ok(hangs(id, 'none') && closes(id, 'defer'), id + ': hangs without, closes with'));
ok(unsafeIn('defer').length === 0, 'no safety case violated (' + unsafeIn('defer').join(', ') + ')');
{
    const r = run('A1', F30[0], 'defer');
    ok(r.log.some((l) => /active cc: released to the list \(listed\): number 65535 is in release\.deferValues/.test(l)), 'logged once: "active cc: released to the list (listed): number 65535 is in release.deferValues"');
}
ok(hangs('A17', 'defer'), 'A17 (65535 with a stored entry listed) stays open under "listed": the safe side');

console.log('noneValues [0, 65535] (config only): closes A1 but is NOT safe');
ok(closes('A1', 'none65535'), 'A1 closes');
ok(unsafeIn('none65535').some((x) => /^S1/.test(x)), 'S1 (a listed message while the field is stuck on 65535) is covered: ' + unsafeIn('none65535').slice(0, 2).join(', '));

console.log('release.leftList');
['A3', 'A4', 'A16'].forEach((id) => ok(hangs(id, 'none') && closes(id, 'leftlist'), id + ': hangs without, closes with'));
ok(unsafeIn('leftlist').length === 0, 'no safety case violated, S5 included (a number the list never carried stays open) (' + unsafeIn('leftlist').join(', ') + ')');

console.log('release.noEntryMs 3000: closes the kept numbers, but can hide a message the list never carries');
['A1', 'A3', 'A4'].forEach((id) => ok(closes(id, 'noentry'), id + ' closes'));
ok(unsafeIn('noentry').some((x) => /^S5/.test(x)), 'S5 is covered after 3 s - why it is not in the recommended set (' + unsafeIn('noentry').join(', ') + ')');

console.log('release.witness with config.ccDisplayed.use');
['A15', 'A16'].forEach((id) => ok(hangs(id, 'none') && closes(id, 'witness'), id + ': hangs without, closes with'));
ok(unsafeIn('witness').length === 0, 'no safety case violated');
{
    const r = run('A15', F30[0], 'witness');
    ok(r.log.some((l) => /displayed cc: number 0/.test(l)) && r.log.some((l) => /released to the list \(listed\): displayed cc says 0/.test(l)), 'logged: "displayed cc: number 0", "released to the list (listed): displayed cc says 0"');
    const lo = run('A15', F30[0], 'rec');
    ok(lo.log.some((l) => /witness has spoken \(logged only\)/.test(l)), 'use false: the witness is logged only ("(logged only)")');
}
ok(hangs('A5w', 'witness') && closes('A5w', 'witness-h'), 'A5w (a stored entry the field is stuck on) closes only with then "heuristic"');
ok(run('S1', F30[0], 'defer-h').unsafe > 0, 'then "heuristic" carries the 0.7.20 fallback\'s 20 s rule: S1 under defer-h is covered after 20 s - why "listed" is the default');

console.log('release.deferControls: a number in noneValues is never deferred');
ok(closes('A4', 'control'), 'A4 (control 0 with the number kept) closes');
ok(!run('S4', F30[0], 'control').unsafe, 'S4 stays safe');
ok(!run('A0', F30[0], 'control').endsOpen, 'A0 (number 0, control 0) still closes: 0 is never deferred');

console.log('config.ccm.clearIds [65535] (an existing key)');
ok(hangs('A11', 'none') && closes('A11', 'ccmclear'), 'A11 (newCCMessage\'s getter answers id 65535 with no name): hangs without, closes with');

console.log('the recommended set: deferValues [65535] + leftList + ccm.clearIds [65535], witness logged');
['A1', 'A2', 'A3', 'A4', 'A11', 'A15', 'A16', 'S1', 'S2'].forEach((id) => ok(closes(id, 'rec'), id + ' closes'));
ok(unsafeIn('rec').length === 0, 'no safety case violated in any view (' + unsafeIn('rec').join(', ') + ')');
ok(unsafeIn('rec-w').length === 0, 'rec with the witness used: no safety case violated');

console.log('Twin Dial: off by default, and with the release set it takes only the NARROWED leftList (B3: SC, SPEC-R3 5.4.7)');
['A1', 'A3', 'A15', 'A16'].forEach((id) => {
    const a = run(id, TWIN, 'none'), b = run(id, TWIN, 'rec-w');
    ok(a.endsOpen && !b.endsOpen && !b.unsafe && !a.unsafe, id + ': twin hangs without the release (as shipped) and closes with it, never unsafe (' + (a.endsOpen ? 'hangs' : 'closes') + ' -> ' + (b.endsOpen ? 'hangs' : 'closes') + ')');
});

console.log('privacy: numbers only');
{
    const all = [];
    ['A12', 'A0', 'A1', 'A15'].forEach((id) => C.VIEWS.forEach((v) => ['none', 'rec-w'].forEach((f) => run(id, v, f).log.forEach((l) => all.push(l)))));
    ok(!all.some((l) => /Πόρτα|xxxx/.test(l)), 'no message text in any log line (' + all.length + ' lines)');
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
