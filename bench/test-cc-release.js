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

// car-fix CF1: the sections below until "car-fix CF1" are MC's study of 0.7.20's ACTIVE-number path. They run on the config as
// it was before CF1 (cases.js base "legacy": ccActive without source / dead, f30 without ccDisplayed); the shipped config is
// tested at the end, with the car's own sequences of 2026-11-18.
console.log('off by default: app.json carries no release (MC\'s legacy base: no f30 witness)');
{
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'app.json'), 'utf8'));
    ok(!spec.config.ccActive.release, 'f30_cluster config.ccActive.release is absent (0.7.20 behaviour)');
    // car-fix CF1: ccDisplayed is ON now, as the "shown now" source (was null: research3/MC's witness, off)
    ok(spec.config.ccDisplayed && spec.config.ccDisplayed.field === 'statusDisplayedCCMessage' && spec.config.ccActive.source === 'displayed' && spec.config.ccActive.dead === true,
        'f30_cluster config.ccDisplayed names Vehicle2 statusDisplayedCCMessage and config.ccActive.source is "displayed", dead true (car-fix CF1)');
    const r = run('A0', F30[0], 'none');
    ok(!r.log.some((l) => /released to the list|displayed cc/.test(l)), 'the legacy config logs no release and no witness line');
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

// ---- car-fix CF1 (docs/car-fix/CF1-REPORT.md): the SHIPPED config (ccActive.source "displayed", dead true) on the car's own
// sequences of 2026-11-18 (cases.js CAR), in every view: f30 opaque, f30 G20 with our row, f30 G20 with BMW's row, Twin Dial ----
console.log('car-fix CF1: the shipped config, "shown now" from Vehicle2.statusDisplayedCCMessage, the car\'s sequences');
{
    const K = (id) => C.CAR.concat(C.CAR_LIVE).find((c) => c.id === id);
    const runS = (id, view, fix) => C.runCase(K(id), view, fix || 'none', 'shipped');
    const cell = (s) => (s.open ? 'O' : s.ours ? 'U' : 'S');
    const trace = (id, view, fix) => runS(id, view, fix).steps.map(cell).join('');
    const V = { op: C.VIEWS[0], ours: C.VIEWS[1], bmw: C.VIEWS[2], twin: C.VIEWS[3] };
    const bad = [];
    C.CAR.forEach((cs) => C.VIEWS.forEach((v) => { const r = runS(cs.id, v); if (r.unsafe || r.hang) bad.push(cs.id + ' ' + v.key + (r.unsafe ? ' UNSAFE x' + r.unsafe : '') + (r.hang ? ' open x' + r.hang : '')); }));
    ok(bad.length === 0, 'every car case in every view: BMW\'s panel never covered without our text while BMW shows a message, never open when it shows none (' + C.CAR.length + ' cases x 4 views; ' + bad.join(', ') + ')');
    // the stuck window: hangs on the config before CF1 (MC's A1, the car's 65535), closes now
    const legacyHang = F30.every((v) => C.runCase(K('K4'), v, 'none').endsOpen) && C.runCase(K('K4'), V.twin, 'none').endsOpen;
    ok(legacyHang && C.VIEWS.every((v) => !runS('K4', v).endsOpen && trace('K4', v) === 'SS'),
        'K4, active 65535 forever + displayed 0 + the list at rest: the window HANGS on the pre-CF1 config in every view and is SHUT now (' + C.VIEWS.map((v) => trace('K4', v)).join(' ') + ')');
    ok(C.VIEWS.every((v) => trace('K0', v) === 'OOSS'), 'K0, the start: displayed 65535 + active 65535 = unknown: BMW\'s panel open; displayed 0 with the list at rest: shut (' + C.VIEWS.map((v) => trace('K0', v)).join(' ') + ')');
    ok(trace('K1', V.op) === 'SOOOSS' && trace('K1', V.bmw) === 'SOOOSS' && trace('K1', V.ours) === 'SUUOSS' && trace('K1', V.twin) === 'SUUOSS',
        'K1, the door (list 15 + displayed 15 together): our text covers BMW\'s panel where ours draws it (G20 our row, Twin Dial - the FIRST match with confirmNow), open in the opaque themes; the list at rest with displayed still 15: open; displayed 0 0.7 s later: shut (' +
        ['op', 'ours', 'bmw', 'twin'].map((k) => k + ' ' + trace('K1', V[k])).join(', ') + ')');
    ok(C.VIEWS.every((v) => trace('K2', v) === 'SOOSS'), 'K2, displayed 285 with no ccList entry: BMW\'s panel open for the 6 s, never ours (' + C.VIEWS.map((v) => trace('K2', v)).join(' ') + ')');
    ok(trace('K3', V.twin) === 'SUOUUOSUOSS' && trace('K3', V.ours) === 'SUOUUOSUOSS' && trace('K3', V.op) === 'SOOOOOSOOSS',
        'K3, the 13:41 sequence: 285 shown over a listed 2255 opens the panel; 19 and 14 become ours; each end opens until displayed 0 (twin ' + trace('K3', V.twin) + ')');
    ok(C.VIEWS.every((v) => /SS$/.test(trace('K5', v)) && /SS$/.test(trace('K6', v))), 'K5 / K6, a stored entry (white 987, red 52) stays listed with displayed 0: shut (MC\'s A5w / A8 close)');
    ok(C.VIEWS.every((v) => trace('K7', v) === 'SOO'), 'K7, the end of a drive (displayed 65535): BMW\'s panel opens');
    ok(trace('K8', V.twin) === 'SOOUSS' && trace('K8', V.ours) === 'SOOUSS', 'K8, displayed names 15 two seconds before the list carries it: open until the entry is there, then ours (' + trace('K8', V.twin) + ')');
    ok(C.VIEWS.every((v) => !runS('K9', v).unsafe), 'K9, before displayed has spoken (dead active): the list\'s fallback, never unsafe');
    // the log, numbers only
    const lo = runS('K2', V.op).log.concat(runS('K0', V.op).log).concat(runS('K1', V.twin).log);
    ok(lo.filter((l) => /displayed cc: no ccList entry for number 285 - shown, BMW's panel stays open/.test(l)).length === 1, 'logged once: "displayed cc: no ccList entry for number 285 - shown, BMW\'s panel stays open"');
    ok(lo.some((l) => /displayed cc: number 65535 is unknown \(config\.ccActive\.unknownValues\)/.test(l)) && lo.some((l) => /active cc: wired - not the "shown now" source \(config\.ccActive\.source displayed, dead\)/.test(l)),
        'logged: "displayed cc: number 65535 is unknown ..." and "active cc: wired - not the "shown now" source (..., dead)"');
    ok(lo.some((l) => /cc: shown-now confirmed \(number 15 matched a ccList entry\)/.test(l)) && !lo.some((l) => /D7: this is the message that confirmed/.test(l)),
        'Twin Dial: displayed 15 matching entry 15 confirms D7, and with confirmNow that message itself may be ours');
    // a moving active number (ccActive.dead false): a witness again
    ok(trace('L1', V.twin, 'cf1-live') === 'SUUSS' && trace('L1', V.ours, 'cf1-live') === 'SUUSS', 'dead false, the active number never moves (0): no witness, displayed alone decides (' + trace('L1', V.twin, 'cf1-live') + ')');
    ok(C.VIEWS.every((v) => /^SOO/.test(trace('L2', v, 'cf1-live'))) && trace('L2', V.twin, 'cf1-live') === 'SOOUSS',
        'dead false, the active number moves to 14 while displayed says 0: the witnesses disagree, BMW\'s panel open until displayed says 14 too (' + trace('L2', V.twin, 'cf1-live') + ')');
    ok(C.VIEWS.every((v) => /SS$/.test(trace('L3', v, 'cf1-live')) && !runS('L3', v, 'cf1-live').unsafe), 'dead false, active back on 65535 (a dead value): no witness at that moment, the end closes');
    ok(C.CAR_LIVE.every((cs) => C.VIEWS.every((v) => !runS(cs.id, v, 'cf1-live').unsafe)), 'dead false: never unsafe');
    // research3/MC's release (Діагностика) changes nothing while displayed decides: it acts on the active number only (obsolete)
    ok(C.CAR.every((cs) => C.VIEWS.every((v) => trace(cs.id, v) === trace(cs.id, v, 'cf1-rel'))), 'the release on (deferValues 65535, leftList): every car case the same, step for step (obsolete with displayed)');
}

console.log('privacy: numbers only');
{
    const all = [];
    ['A12', 'A0', 'A1', 'A15'].forEach((id) => C.VIEWS.forEach((v) => ['none', 'rec-w'].forEach((f) => run(id, v, f).log.forEach((l) => all.push(l)))));
    C.CAR.forEach((cs) => C.VIEWS.forEach((v) => C.runCase(cs, v, 'none', 'shipped').log.forEach((l) => all.push(l))));      // car-fix CF1
    ok(!all.some((l) => /Πόρτα|xxxx/.test(l)), 'no message text in any log line (' + all.length + ' lines)');
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
