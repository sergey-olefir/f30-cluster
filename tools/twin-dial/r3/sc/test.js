'use strict';
/**
 * test.js - SC: the centre message model against its cases, in every application mode, with mutants.
 *
 *   node tools/twin-dial/r3/sc/test.js [--json out.json] [--case ID] [--trace]
 *
 * Checks (each line "ok" or "FAIL"; exit 1 on any FAIL):
 *   1. geometry: tab 2's sheet and everything in it inside the centre window, clear of every keep-out; the samples' wrap;
 *   2. safety: no V1 / V2 frame in any case, for the machine with and without research3/MC's release, applied atomically,
 *      op by op (serial), and in every interleaving of the connections in the PROPOSED assignment (rows on the window's
 *      connection); today's assignment (rows on conn 2, window on conn 0) is measured and reported, not required;
 *   3. behaviour: the tab, the settle, leaving, returning, auto rules, rows, the pointer, the empty page;
 *   4. mutants: each deliberate break must produce violations (the audit is not vacuous);
 *   5. hangs: the end state of every case (window open / card / tab 2 pinned while BMW shows nothing), with and without
 *      the release - reported, the safe side;
 *   6. the log carries numbers only.
 * Pure Node, no engine, no port, under a second or two.
 */
const fs = require('fs');
const path = require('path');
const M = require('./centre_cc');
const { CASES, SAMPLES } = require('./cases');

const args = process.argv.slice(2);
const ONLY = args.indexOf('--case') >= 0 ? args[args.indexOf('--case') + 1] : null;
const TRACE = args.indexOf('--trace') >= 0;
const JSON_OUT = args.indexOf('--json') >= 0 ? args[args.indexOf('--json') + 1] : null;

let passed = 0, failed = 0;
const ok = (c, what) => { if (c) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };

const CONNS_TODAY = { window: 0, rows: 2, page: 2, tab: 1, warn: 1 };
const CONNS_PROPOSED = { window: 0, rows: 0, page: 2, tab: 1, warn: 1 };
const REC = { deferValues: [65535], leftList: true };

function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** one case through the model and the screen. cfg: { mode, conns, latMax, release, mutant, strict, confirmNow } */
function run(cs, cfg) {
    const rnd = lcg(7);
    const latMax = cfg.latMax || 120;
    const lines = [];
    const car = new M.CarSim({ release: cfg.release || null });
    const m = M.makeMachine({ strict: cfg.strict !== false, confirmNow: !!cfg.confirmNow, mutant: cfg.mutant || null, log: (l) => lines.push(l) });
    const scr = new M.Screen({ mode: cfg.mode || 'atomic', conns: cfg.conns || CONNS_PROPOSED, latency: () => 10 + Math.floor(rnd() * (latMax - 10) / 10) * 10 });
    let now = 0, truth = null;
    const trace = [];
    const truthKey = (v) => {
        if (v === null) return null;
        const e = (car.list || []).find((x) => x.id === v);
        return e && e.name ? M.keyOf(e) : '?' + v;
    };
    let next = null;          // the step's new truth (an id), while its batch of signals is being delivered
    const turn = (ev) => {
        const r = m.update(car.inputs(now), now);
        scr.turn(r.ops, now, next === null ? truth : [truth, next === undefined ? null : truthKey(next)]);
        if (r.ops.length || ev !== 'tick') trace.push({ t: now, ev, state: r.state, tab: r.tab, kind: r.page.kind, ops: r.ops.map((o) => o.op + (o.open !== undefined ? (o.open ? '+' : '-') : o.on !== undefined ? (o.on ? '+' : '-') : o.op === 'tab' ? o.tab : o.op === 'page' ? ':' + o.kind : '')).join(' '), reason: m.reason });
    };
    turn('start');
    cs.steps.forEach((st, si) => {
        let dwell = 1000;
        next = st[0] === null ? undefined : st[0];
        st.slice(1).forEach((ev) => {
            const k = ev[0], v = ev[1];
            if (k === 'wait') { dwell = v; return; }
            if (k === 'list') car.setList(v, now);
            else if (k === 'listRaw') car.setList(v, now);
            else if (k === 'active') car.setAct(v, now);
            else if (k === 'displayed') car.disp = v;
            else if (k === 'frame') car.frame = v;
            else if (k === 'driver') m.driver(v);
            else if (k === 'auto') m.auto(v);
            else if (k === 'night') m.night = v;
            else if (k === 'throw') { m.throwNext = true; return; }
            else if (k === 'refuse') m.sheetRefused();
            else if (k === 'rebuild') { const born = m.rebuild(); scr.reset(born, now, truth); }
            turn(k + ' ' + (v === undefined || v === null ? '' : typeof v === 'object' ? (Array.isArray(v) ? v.map((e) => e.id).join(',') : JSON.stringify(v)) : v));
        });
        truth = truthKey(st[0]); next = null;
        scr._audit(scr.s, truth, now, 'step ' + si + ' truth');
        for (let t = 10; t <= dwell; t += 10) {
            now += 10;
            scr.deliver(now, truth);
            if (now % 50 === 0) turn('tick');
        }
    });
    const end = { window: scr.s.window && truth === null, card: truth === null && scr.s.tab === 2 && scr.s.kind === 'card', tab2: truth === null && m.tab === 2 && m.pulled };
    return { v: scr.v, end, trace, lines, m };
}

function geometry() {
    const res_geo = {};
    console.log('geometry');
    const C = M.CARD, G = C.grammar, S = C.sheet.rect;
    const inside = (r, o) => r[0] >= o[0] && r[1] >= o[1] && r[2] <= o[2] && r[3] <= o[3];
    const meets = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    ok(inside(S, G.window), 'the tab-2 sheet ' + JSON.stringify(S) + ' lies inside the centre window ' + JSON.stringify(G.window));
    ok(S[1] >= G.rule.y1, 'the sheet starts under the title rule (y ' + S[1] + ' >= ' + G.rule.y1 + ')');
    ok(Object.keys(C.keep_outs).filter((k) => k[0] !== '_').every((k) => !meets(S, C.keep_outs[k])), 'the sheet meets no keep-out (belt group, gear gap, BMW\'s panel, the black box, the telltale strip)');
    const H = C.card.headline;
    ok(inside(C.card.cell, S) && H.left >= S[0] && H.right <= S[2] && H.baselines['3'][2] + 12 <= S[3], 'card: the cell, the headline\'s three lines (descent 12) inside the sheet');
    ok(H.baselines['1'][0] - 30 - C.card.cell[3] >= 8, 'card: the first line\'s cap top keeps ' + (H.baselines['1'][0] - 30 - C.card.cell[3]) + ' px under the cell');
    ok(C.card.counter.right <= S[2] && C.card.counter.baseline - 21 >= S[1] && C.card.cell[2] + 20 < C.card.counter.right - 60, 'card: the counter sits top right, clear of the cell');
    const sm = {}, out = {};
    Object.keys(C.samples_for_mockups).forEach((k) => { const v = C.samples_for_mockups[k]; sm[k] = Array.isArray(v) ? v.map((e) => ({ id: e.id, name: e.name, color: e.colour })) : v && v.name ? { id: v.id, name: v.name, color: v.colour } : v; });
    ['card_one_line', 'card_two_lines', 'card_two_lines_b', 'card_three_lines', 'card_cut'].forEach((k) => {
        const e = sm[k];
        const p = M.layoutTab2({ cand: { key: M.keyOf(e), id: e.id, name: e.name, color: e.color, counter: '' }, shown: true, entries: [] });
        out[k] = { chars: e.name.length, lines: p.card.lines.length, cut: p.card.cut, widths: p.card.lines.map((l) => M.measure('td_msg', l)) };
    });
    ok(out.card_one_line.lines === 1 && out.card_two_lines.lines === 2 && out.card_two_lines_b.lines === 2 && out.card_three_lines.lines === 3 && !out.card_three_lines.cut && out.card_cut.cut,
        'the samples wrap to 1 / 2 / 2 / 3 lines and the long one is cut: ' + JSON.stringify(Object.keys(out).map((k) => out[k].chars + ':' + out[k].lines + (out[k].cut ? '…' : ''))));
    const ents = sm.rows.concat([{ id: 1, name: 'Ще одне повідомлення', color: 'white' }]);
    const lay = (e) => M.layoutTab2({ cand: { key: M.keyOf(e), id: e.id, name: e.name, color: e.color, counter: '2/3' }, shown: true, entries: ents });
    const p1 = lay(sm.card_one_line), p2 = lay(sm.card_two_lines), p3 = lay(sm.card_three_lines);
    const lst = M.layoutTab2({ cand: null, shown: false, entries: ents.concat([{ id: 2, name: 'І ще одне', color: 'white' }, { id: 3, name: 'Шосте', color: 'white' }]) });
    const inBody = (p) => p.rows.every((r) => r.top >= S[1] && r.top + M.CARD.rows.pitch <= G.body_bottom);
    ok(p1.rows.length === 2 && p2.rows.length === 1 && p3.rows.length === 0 && lst.rows.length === 6 && [p1, p2, p3, lst].every(inBody),
        'rows under a 1 / 2 / 3-line card: ' + [p1, p2, p3].map((p) => p.rows.length).join(' / ') + '; the list page: ' + lst.rows.length + ' rows, all above y ' + G.body_bottom);
    const lst7 = M.layoutTab2({ cand: null, shown: false, entries: ents.concat([{ id: 2, name: 'І ще одне', color: 'white' }, { id: 3, name: 'Шосте', color: 'white' }, { id: 4, name: 'Сьоме', color: 'white' }]) });
    ok(p1.rows[0].sev === 3 && p1.more === ents.length - 2 && lst7.rows.length === 6 && lst7.more === 1, 'rows: severity first (amber leads); what does not fit is counted for the scroll indicator (' + p1.more + ', ' + lst7.more + ')');
    res_geo.layouts = { p1: p1.rows.length, p2: p2.rows.length, p3: p3.rows.length, list: lst.rows.length };
    const avg = (f) => { const g = M.measure(f, 'абвгдежзиклмнопрстуфхцчшщьюяіїє') / 31; return Math.round(g * 10) / 10; };
    const cap = { td_msg: avg('td_msg'), td_val: avg('td_val'), td_body: avg('td_body'),
        card_line_chars: Math.floor(C.card.headline.max_w / avg('td_msg')), row_chars: Math.floor(C.rows.name.max_w / avg('td_tab')), td_tab: avg('td_tab'),
        left_variant_line_chars: Math.floor(C.card.variant_card_left.max_w / avg('td_msg')) };
    console.log('  capacity (px per lower-case Cyrillic letter; letters per line): ' + JSON.stringify(cap));
    return { samples: out, capacity: cap, layouts: res_geo.layouts };
}

function cost() {
    // round 2's sheets (R2-C, SPEC 13.2; "each image counted twice")
    const img = (w, h) => w * h * 4 * 2;
    const MiB = (b) => Math.round(b / 1048576 * 1000) / 1000;
    const plate = img(536, 128), card = img(462, 270), clock = img(440, 285), trip = img(446, 218), page = img(462, 331);
    const steady = 4.7;
    return {
        plate_MiB: MiB(plate), card_sheet_MiB: MiB(card),
        option_a: { what: 'the plate goes; tab 2 gets its own sheet on conn 2 (the plate\'s slot); the rows stay', delta_MiB: MiB(card - plate), steady_MiB: Math.round((steady + MiB(card - plate)) * 100) / 100, layers: { conn0: 6, conn1: 6, conn2: 2 } },
        option_a_rows0: { what: 'option a with the bottom-row sheet moved onto the window\'s connection 0 (V2 cannot happen between sockets)', delta_MiB: MiB(card - plate), layers: { conn0: 7, conn1: 6, conn2: 1 } },
        option_b: { what: 'one page sheet for every centre page (title included, 462 x 331), one paint per page, replacing the clock and trip sheets and the plate', delta_MiB: MiB(page - plate - clock - trip), steady_MiB: Math.round((steady + MiB(page - plate - clock - trip)) * 100) / 100, layers: { conn0: 6, conn1: 5, conn2: 1 } },
        freed_by_plate: { layer: 1, MiB: MiB(plate), atlas: 'td_cnt stays (the counter moves into the card); td_msg stays' },
    };
}

function main() {
    passed = 0; failed = 0;
    const res = { geometry: geometry(), cost: cost(), runs: {}, hangs: {}, mutants: {}, behaviour: {} };
    const cases = CASES.filter((c) => !ONLY || c.id === ONLY);
    console.log('safety: every case, every mode');
    const configs = [
        ['atomic', { mode: 'atomic' }], ['serial', { mode: 'serial' }], ['interleave-proposed', { mode: 'interleave', conns: CONNS_PROPOSED }],
        ['atomic+release', { mode: 'atomic', release: REC }], ['serial+release', { mode: 'serial', release: REC }], ['interleave-proposed+release', { mode: 'interleave', conns: CONNS_PROPOSED, release: REC }],
    ];
    configs.forEach(([name, cfg]) => {
        let v1 = 0, v2 = 0, frames = 0; const bad = [];
        cases.forEach((cs) => { const r = run(cs, cfg); v1 += r.v.V1; v2 += r.v.V2; frames += r.v.frames; if (r.v.V1 + r.v.V2) bad.push(cs.id + ' ' + JSON.stringify(r.v.first)); });
        res.runs[name] = { frames, V1: v1, V2: v2, bad };
        ok(v1 === 0 && v2 === 0, name + ': ' + frames + ' frames, V1 ' + v1 + ', V2 ' + v2 + (bad.length ? ' [' + bad.slice(0, 3).join('; ') + ']' : ''));
    });
    {   // research3/MC's leftList as hud.js has it (any number whose entry was ever listed and is not now): measured
        let v1 = 0; const bad = [];
        cases.forEach((cs) => { const r = run(cs, { mode: 'atomic', release: { deferValues: [65535], leftList: 'any' } }); v1 += r.v.V1; if (r.v.V1) bad.push(cs.id); });
        res.runs['atomic+release-MC-leftList'] = { V1: v1, cases: bad };
        console.log('  info MC\'s leftList as written (an entry ever listed and not listed now): V1 ' + v1 + ' in ' + bad.join(' '));
        ok(bad.indexOf('S3') >= 0, 'MC\'s leftList as written covers S3-after-an-earlier-listing (the number arrives before the list re-lists it); SC\'s refinement does not');
    }
    {   // today's connection assignment: measured
        let v1 = 0, v2 = 0; const bad = [];
        cases.forEach((cs) => { const r = run(cs, { mode: 'interleave', conns: CONNS_TODAY }); v1 += r.v.V1; v2 += r.v.V2; if (r.v.V1 + r.v.V2) bad.push(cs.id); });
        res.runs['interleave-today'] = { V1: v1, V2: v2, cases: bad };
        console.log('  info today\'s connections (window 0, rows 2) when sockets are not applied together: V1 ' + v1 + ', V2 ' + v2 + ' in ' + bad.length + ' cases (' + bad.slice(0, 8).join(' ') + (bad.length > 8 ? ' ...' : '') + ')');
        ok(v1 === 0, 'today\'s connections: never V1 (BMW\'s message covered with our text absent); the V2 frames are the rows\' ink over an opening / closing panel');
    }

    console.log('behaviour');
    const tr = (id, cfg) => run(CASES.find((c) => c.id === id), cfg || { mode: 'atomic' });
    {
        const r = tr('V3');
        const pull = r.trace.find((x) => x.tab === 2 && /page:card/.test(x.ops));
        const shut = r.trace.find((x) => pull && x.t > pull.t && /window-/.test(x.ops));
        ok(pull && /window\+/.test(pull.ops) || (pull && r.trace.some((x) => x.t === pull.t && /window\+/.test(x.ops))), 'V3: the message pulls tab 2; the card is sent in the turn the window opens (' + (pull ? pull.ops : '-') + ')');
        ok(shut && shut.t - pull.t >= 150 && shut.t - pull.t <= 200, 'V3: the window shuts ' + (shut ? shut.t - pull.t : '-') + ' ms after the card (settle 150, the 50 ms tick)');
        ok(r.trace.filter((x) => x.t < (pull ? pull.t : 0)).every((x) => x.kind !== 'card'), 'V3: the confirming message (D7) never had a card');
        const endT = r.trace[r.trace.length - 1];
        ok(endT.tab === 1 && endT.state === 'none', 'V3: after the end the tab is back on 1, state none');
        res.behaviour.V3 = { pullAt: pull && pull.t, shutAfterMs: shut && pull ? shut.t - pull.t : null };
    }
    {
        const r = tr('C1');
        const leave = r.trace.find((x) => /^driver 1/.test(x.ev));
        ok(leave && /rows- window\+/.test(leave.ops) && leave.ops.indexOf('window+') < leave.ops.indexOf('tab1'), 'C1: leaving tab 2 opens BMW\'s panel in the same turn, before the centre changes (' + (leave ? leave.ops : '-') + ')');
        const back = r.trace.find((x) => /^driver 2/.test(x.ev));
        const shut = r.trace.find((x) => back && x.t > back.t && /window-/.test(x.ops));
        ok(back && /page:card/.test(back.ops) && !/window-/.test(back.ops) && shut && shut.t - back.t >= 150, 'C1: coming back paints the card; the window shuts ' + (shut && back ? shut.t - back.t : '-') + ' ms later');
    }
    {
        const r = tr('C2');
        const during = r.trace.filter((x) => /^auto 5/.test(x.ev))[0];
        ok(during && during.tab === 2, 'C2: guidance during a message does not leave tab 2');
        ok(r.trace[r.trace.length - 1].tab === 5, 'C2: tab 5 once the message ends');
    }
    {
        const r = tr('C3');
        const m = r.trace.find((x) => /^active 50/.test(x.ev));
        ok(m && m.tab === 2, 'C3: a new message pulls tab 2 again after the driver left');
    }
    {
        const r = tr('C4');
        const after = r.trace.filter((x) => r.trace.findIndex((y) => /^driver 1/.test(y.ev)) <= r.trace.indexOf(x) && x.state !== 'none');
        ok(after.length && after.every((x) => x.tab === 1 && x.state === 'window'), 'C4: BMW cycling between known messages keeps the driver\'s tab; BMW\'s panel stays open');
    }
    {
        const r = tr('C5');
        const sw = r.trace.find((x) => /^active 164/.test(x.ev));
        ok(sw && sw.state === 'ours' && !/window\+/.test(sw.ops), 'C5: M already on the page as a whole row: ours at once, no window (' + (sw ? sw.ops : '-') + ')');
        const r6 = tr('C6');
        const sw6 = r6.trace.find((x) => /^active 41/.test(x.ev));
        ok(sw6 && /window\+/.test(sw6.ops), 'C6: M\'s row was cut: the window opens until M\'s card settles');
    }
    {
        const r = tr('C7');
        ok(!r.trace.some((x) => x.t > 3200 && x.t < 5000 && /window\+/.test(x.ops)), 'C7: the counter and a growing list repaint the page without opening the window');
        const r8 = tr('C8');
        ok(r8.trace.some((x) => /^list/.test(x.ev) && /window\+/.test(x.ops) && x.state === 'window'), 'C8: the same id with other words opens the window until they settle');
    }
    {
        const r = tr('C9');
        const red = r.trace.find((x) => /^active 42/.test(x.ev));
        ok(red && red.tab === 2 && r.trace[r.trace.length - 1].tab === 5, 'C9: a red message pulls tab 2 from the map; back to 5 after');
    }
    {
        const r = tr('C10');
        ok(r.trace.filter((x) => x.t >= 3000).every((x) => !/window\+/.test(x.ops)) && r.trace.some((x) => x.kind === 'list'), 'C10: stored entries only: the list page, the window never opens');
        const r11 = tr('C11');
        ok(r11.trace.some((x) => x.kind === 'pointer' && x.state === 'window'), 'C11: D7 not fallen, tab 2 selected: the pointer page with the window open');
        const r12 = tr('C12');
        const sw = r12.trace.find((x) => /^active 164/.test(x.ev));
        ok(sw && sw.state === 'ours' && !/window\+/.test(sw.ops), 'C12: a stored entry already shown whole as a row becomes ours at once');
        const r13 = tr('C13');
        const sw13 = r13.trace.find((x) => /^active 987/.test(x.ev));
        ok(sw13 && sw13.state === 'window' && /window\+/.test(sw13.ops), 'C13: a stored entry whose row is cut: the window opens until its card settles');
    }
    {
        const r = tr('V4');
        ok(r.trace.filter((x) => /^active (99|16|17)/.test(x.ev)).every((x) => x.state === 'window' && x.kind !== 'card'), 'V4: no entry / empty name / Greek: window, no card');
        ok(r.trace.some((x) => /drawing the card threw/.test(x.reason)), 'V4: an injected throw latches the window');
        const r7 = tr('V7');
        ok(r7.trace.some((x) => /disagree/.test(x.reason)) && r7.trace.some((x) => /sheet was refused/.test(x.reason)), 'V7: witnesses disagreeing and a refused sheet both keep the window');
        const r8 = tr('V8');
        const n = r8.trace.find((x) => /^night true/.test(x.ev));
        ok(n && n.state === 'ours' && !/window\+/.test(n.ops) && /page/.test(n.ops), 'V8: night repaints the card without opening the window');
        const rb = r8.trace.find((x) => /^rebuild/.test(x.ev));
        ok(rb && rb.state === 'window', 'V8: after a rebuild the window is open until the new card settles');
    }

    console.log('mutants (each must break the audit)');
    const mut = (name, cfg, ids) => {
        let v = 0; const hit = [];
        CASES.filter((c) => ids.indexOf(c.id) >= 0).forEach((cs) => { const r = run(cs, cfg); const n = r.v.V1 + r.v.V2; v += n; if (n) hit.push(cs.id); });
        res.mutants[name] = { violations: v, cases: hit };
        ok(v > 0, 'mutant ' + name + ': ' + v + ' violation frames (' + hit.join(' ') + ')');
    };
    mut('noSettle (window shuts in the turn the card is sent)', { mode: 'atomic', mutant: 'noSettle' }, ['V3', 'V5', 'C1']);
    mut('ignoreTab (leaving tab 2 does not reopen)', { mode: 'atomic', mutant: 'ignoreTab' }, ['C1', 'C3']);
    mut('rowsFirst (rows back before the window shuts)', { mode: 'serial', mutant: 'rowsFirst' }, ['V3', 'V6']);
    mut('windowLast (the centre changes before the window opens)', { mode: 'serial', mutant: 'windowLast' }, ['C1']);
    mut('wrongCard (the card shows the previous message)', { mode: 'atomic', mutant: 'wrongCard' }, ['V5', 'C3']);
    mut('keepStamps (stamps survive leaving tab 2)', { mode: 'atomic', mutant: 'keepStamps' }, ['C1']);
    mut('cutRows (a cut row counts as our text)', { mode: 'atomic', mutant: 'cutRows' }, ['C6']);
    mut('latency 300 ms > settle (the settle\'s assumption)', { mode: 'atomic', latMax: 300 }, ['V3', 'V5', 'C1', 'C6', 'C8']);

    console.log('hangs (end state while BMW shows nothing; safe side, reported)');
    CASES.forEach((cs) => {
        const a = run(cs, { mode: 'atomic' }).end, b = run(cs, { mode: 'atomic', release: REC }).end;
        const f = (e) => (e.window ? 'window' : '') + (e.card ? (e.window ? '+' : '') + 'card' : '') + (e.tab2 ? '+tab2' : '') || 'ok';
        res.hangs[cs.id] = { strict: f(a), release: f(b) };
    });
    console.log('  ' + Object.keys(res.hangs).map((k) => k + ' ' + res.hangs[k].strict + (res.hangs[k].release !== res.hangs[k].strict ? '->' + res.hangs[k].release : '')).join(' | '));
    ok(['A1', 'A2', 'A3', 'A16'].every((k) => res.hangs[k].release === 'ok'), 'MC\'s release frees A1 A2 A3 A16 in the centre too');
    ok(res.hangs.A5.strict.indexOf('card') >= 0 && res.hangs.A5d.strict.indexOf('card') < 0 && res.hangs.A5d.strict.indexOf('tab2') < 0, 'A5: a stuck number hangs the CARD and pins tab 2; the driver can leave it (A5d) - the argument for choice A');

    console.log('the log');
    {
        const names = Object.keys(SAMPLES).map((k) => SAMPLES[k].name).filter(Boolean);
        let all = [];
        CASES.forEach((cs) => { all = all.concat(run(cs, { mode: 'atomic' }).lines); });
        ok(all.length > 0 && all.every((l) => names.every((n) => l.indexOf(n) < 0 && l.indexOf(n.split(' ')[0]) < 0)), 'no log line carries a message\'s words (' + all.length + ' lines)');
    }

    if (TRACE) CASES.filter((c) => !ONLY || c.id === ONLY).forEach((cs) => { console.log(cs.id); run(cs, { mode: 'atomic' }).trace.forEach((x) => console.log('  ' + x.t + ' ' + x.ev + ' -> ' + x.state + ' tab ' + x.tab + ' ' + x.kind + ' [' + x.ops + '] ' + x.reason)); });
    if (JSON_OUT) { fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true }); fs.writeFileSync(JSON_OUT, JSON.stringify(res, null, 1)); console.log('wrote ' + JSON_OUT); }
    console.log(passed + ' passed, ' + failed + ' failed');
    return { passed, failed };
}

if (require.main === module) process.exit(main().failed ? 1 : 0);
module.exports = { main };
