// Dev self-test, loaded only with ?selftest=1. Drives the real UI code paths (keyboard and mouse events,
// undo/redo, decisions, holes, stockMap, plan round trip) and times the conflict pass. Results go to
// <pre id="selftest"> and the title becomes 'selftest-done', so headless Chrome --dump-dom can read them.
'use strict';
(async function (OC) {
  const S = OC.S;
  const I = OC.internals;
  const out = [];
  let fails = 0;
  const ok = (cond, msg) => { out.push((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
  const C = () => { I.frame(); return I.conflicts; };
  const find = (rule, g, w) => C().find((c) => c.rule === rule && c.g20 === g && c.wb === w);
  const key = (k, o) => window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true }, o || {})));
  const cv = document.getElementById('cv');
  const mouse = (type, X, Y, o) => {
    const r = cv.getBoundingClientRect();
    const ev = new MouseEvent(type, Object.assign({ clientX: r.left + X, clientY: r.top + Y, button: 0, bubbles: true }, o || {}));
    (type === 'mousedown' ? cv : window).dispatchEvent(ev);
  };
  try {
    // sha256: subtle vs the JS fallback
    const raw = S.data.raw.g20;
    ok('sha256:' + OC.jsSha256(new Uint8Array(raw)) === S.data.sha.g20, 'sha256 JS fallback equals crypto.subtle');
    const n0 = C().length;
    out.push('conflicts at start: ' + n0);
    const sample = /\/sample\//.test(S.data.files.g20) && !!S.g20ById['tt.brake'] && !!S.wbById['C1.speedo.base'];
    if (sample) {
      // arrow nudge on the speedo anchor (Shift = 10 px) moves the dial off the brake lamp
      I.select({ anchor: 'speedo' });
      ok(!!find('critical-covered', 'tt.brake', 'C1.speedo.base'), 'brake under the speedo before the nudge');
      key('ArrowRight', { shiftKey: true });
      ok(S.plan.anchors.speedo && S.plan.anchors.speedo.dx === 10, 'Shift+Arrow nudges the anchor 10 px (dx ' + (S.plan.anchors.speedo || {}).dx + ')');
      ok(!find('critical-covered', 'tt.brake', 'C1.speedo.base'), 'brake/speedo conflict gone after moving the dial 10 px right');
      key('ArrowLeft');
      ok(S.plan.anchors.speedo.dx === 9, 'Arrow nudges 1 px');
      key('z', { ctrlKey: true });
      key('z', { ctrlKey: true });
      ok((S.plan.anchors.speedo || {}).dx === undefined || S.plan.anchors.speedo.dx === 0, 'two undos restore the anchor');
      ok(!!find('critical-covered', 'tt.brake', 'C1.speedo.base'), 'conflict back after undo');
      key('z', { ctrlKey: true, shiftKey: true });
      ok(S.plan.anchors.speedo.dx === 10, 'redo re-applies the nudge');
      key('z', { ctrlKey: true });

      // drag an element with the mouse (pick 6WB): C2.tacho.static from panel (1300, 200)
      I.select({});
      I.frame();
      const [X, Y] = OC.toScreen(1300, 200);
      const drag = (o) => {
        mouse('mousedown', X, Y);
        mouse('mousemove', X + 20, Y + 1, o);
        mouse('mousemove', X + 47, Y + 2, o);
        mouse('mouseup', X + 47, Y + 2, o);
        return Object.assign({}, S.plan.wb['C2.tacho.static'] || {});
      };
      OC.ui.snapEdges = false;
      let pw = drag();
      ok(OC.ui.sel.wb === 'C2.tacho.static', 'mousedown picks C2.tacho.static (got ' + OC.ui.sel.wb + ')');
      out.push('grid-snapped drag of 47, 2 screen px at scale ' + OC.V.s.toFixed(3) + ' -> dx ' + pw.dx + ', dy ' + pw.dy);
      ok(pw.dx > 0 && pw.dx % 10 === 0 && pw.dy === 0, 'mouse drag moves the element in grid steps');
      key('z', { ctrlKey: true });
      ok(!(S.plan.wb['C2.tacho.static'] || {}).dx, 'undo restores the drag in one step');
      pw = drag({ ctrlKey: true });
      out.push('free (Ctrl) drag -> dx ' + pw.dx + ', dy ' + pw.dy);
      ok(pw.dx === Math.round(47 / OC.V.s) && pw.dy === Math.round(2 / OC.V.s), 'Ctrl-drag moves freely');
      key('z', { ctrlKey: true });
      OC.ui.snapEdges = true;
      pw = drag();
      out.push('edge-snapped drag -> dx ' + pw.dx + ', dy ' + pw.dy + (OC.ui.guides ? '' : ''));
      ok(Math.abs(707 + pw.dy - 713.9) < 0.6 && pw.dy !== Math.round(2 / OC.V.s), 'edge snapping: the tacho bottom (707) snaps to the belt lamp bottom (713.9), dy ' + pw.dy);
      key('z', { ctrlKey: true });

      // scale handle on the tacho anchor: drag the bottom-right handle outwards
      I.select({ anchor: 'tacho' });
      I.frame();
      const h = OC.ui.handles[2];
      ok(!!h, 'anchor has scale handles');
      if (h) {
        mouse('mousedown', h[0], h[1]);
        mouse('mousemove', h[0] + 30, h[1] + 30);
        mouse('mouseup', h[0] + 30, h[1] + 30);
        const s = (S.plan.anchors.tacho || {}).scale;
        out.push('handle drag -> tacho scale ' + s);
        ok(s > 1, 'scale handle scales the anchor about its centre');
        const c = OC.anchorCentre('tacho');
        ok(c[0] === 1508 && c[1] === 380, 'anchor centre stays put while scaling');
        key('z', { ctrlKey: true });
      }

      // decision: reveal the map -> one hole, hole-cuts-content warnings, no under-covered for the map
      OC.pushUndo();
      S.plan.g20['map.region'].decision = 'reveal';
      OC.changed(true);
      const cs = C();
      const hole = S.plan.holes['map.region'];
      ok(hole && hole.rect.join(',') === '588,157,1307,616' && hole.radius === 4, 'reveal derives hole = bbox + 4 px, radius 4 (' + (hole && hole.rect) + ')');
      ok(cs.some((c) => c.rule === 'hole-cuts-content' && c.g20 === 'map.region' && c.wb === 'C1.speedo.base'), 'hole-cuts-content: map hole vs speedo');
      ok(!cs.some((c) => c.rule === 'hole-cuts-content' && c.wb === 'w.bg'), 'no hole-cuts-content for backgrounds');
      ok(!cs.some((c) => c.rule === 'under-covered' && c.g20 === 'map.region'), 'no under-covered for a revealed element');
      // a critical unknown element redrawn without a spot -> redraw-not-placed, no critical-covered
      S.plan.g20['tt.abs'].decision = 'redraw';
      OC.changed(true);
      ok(!!C().find((c) => c.rule === 'redraw-not-placed' && c.g20 === 'tt.abs' && c.wb === null), 'redraw without redraw_at -> warning');
      ok(!C().find((c) => c.rule === 'critical-covered' && c.g20 === 'tt.abs'), 'redraw clears critical-covered');
      // plan round trip
      const p1 = OC.buildPlanFile(C(), { noTime: true });
      const snap = OC.snapshot();
      const r = OC.applyPlanFile(JSON.parse(JSON.stringify(p1)));
      ok(!r.errs.length, 'plan import: no errors');
      const p2 = OC.buildPlanFile(C(), { noTime: true, version: p1.version });
      ok(JSON.stringify(p1) === JSON.stringify(p2), 'plan export -> import -> export is identical');
      OC.restore(snap);
      ok(OC.applyPlanFile({ kind: 'g20-elements' }).errs.length === 1, 'importing a non-plan file is refused');
      key('z', { ctrlKey: true });
      // back to defaults: stockMap cuts the w.bg map hole
      for (const g of S.data.g20) S.plan.g20[g.id] = { decision: OC.defaultDecision(g), notes: '', redraw_at: null };
      OC.changed(true);
      const before = find('under-covered', 'map.region', 'w.bg').overlap_px;
      I.setStockMap(true);
      const after = find('under-covered', 'map.region', 'w.bg');
      out.push('map.region vs w.bg: ' + before + ' px, with stockMap ' + (after ? after.overlap_px : 0) + ' px');
      ok(after && after.overlap_px < before, 'stockMap cuts the background\'s own hole');
      ok(find('under-covered', 'map.region', 'C10.panel.background').overlap_px === after.overlap_px, 'the stockMap hole is cut from every background (README §3)');
      I.setStockMap(false);
      ok(C().length === n0, 'back to the default conflict list (' + C().length + ')');

      // conflict click: select both, zoom in
      I.fit();
      I.setTab('conflicts');
      I.frame();
      const s0 = OC.V.s;
      const tr = Array.from(document.querySelectorAll('#tab-conflicts tr.click')).find((r) => r.textContent.includes('tt.brake') && r.textContent.includes('C1.speedo.base'));
      tr.click();
      ok(OC.ui.sel.g20 === 'tt.brake' && OC.ui.sel.wb === 'C1.speedo.base' && OC.V.s > s0 * 2, 'conflict click selects both and zooms (scale ' + s0.toFixed(2) + ' -> ' + OC.V.s.toFixed(2) + ')');
      I.fit();
      // tree: cascading eye, solo, over lifted above 6WB whatever the order
      const rowOf = (label) => Array.from(document.querySelectorAll('#tree .row')).find((r) => r.querySelector('.name').textContent === label);
      rowOf('G20 stock').querySelector('.eye').click();
      ok(OC.leaves(OC.g20Root).every((n) => !n.show && !OC.effVisible(n)), 'group eye cascades to every G20 element');
      rowOf('G20 stock').querySelector('.eye').click();
      ok(OC.leaves(OC.g20Root).every((n) => n.show && OC.effVisible(n)), 'and back');
      rowOf('anchor speedo').querySelector('.solo').click();
      ok(OC.effVisible(OC.nodeOf['wb:C1.speedo.base']) && !OC.effVisible(OC.nodeOf['wb:C2.tacho.static']) && !OC.effVisible(OC.nodeOf['g20:tt.abs']), 'solo shows only the soloed branch');
      rowOf('anchor speedo').querySelector('.solo').click();
      ok(OC.effVisible(OC.nodeOf['wb:C2.tacho.static']), 'un-solo');
      rowOf('6WB').querySelector('.up').click();
      const ord = OC.drawOrder().map((n) => n.type + ':' + n.ref);
      const lastWb = Math.max(...ord.map((k, i) => (k.startsWith('wb:') ? i : -1)));
      const firstUnder = ord.indexOf('g20:tt.brake');
      ok(ord.indexOf('g20:overlay.black_box') > lastWb && ord.indexOf('g20:assist.gear') > lastWb && firstUnder < lastWb, '6WB moved above G20: over elements still drawn above every 6WB layer, others below');
      rowOf('6WB').querySelector('.dn').click();
      // z of a 6WB element via the tree arrows changes the plan z (undoable)
      I.select({ wb: 'w.range_v' });
      I.frame();
      const zr = document.querySelector('#tree .row.sel .up');
      zr.click();
      ok(S.plan.wb['w.range_v'] && S.plan.wb['w.range_v'].z === 106, 'tree z-up on a 6WB element sets plan z 105 -> 106');
      key('z', { ctrlKey: true });
      ok(!S.plan.wb['w.range_v'] || S.plan.wb['w.range_v'].z === undefined, 'undo z');
    }
    // every render mode on both sources, with a reveal hole cut in the backgrounds (no exceptions)
    const g0 = S.data.g20.find((g) => g.relation !== 'over');
    if (g0) { OC.pushUndo(); S.plan.g20[g0.id].decision = 'reveal'; OC.changed(true); }
    for (const m of ['fill', 'outline', 'photo', 'diff']) {
      OC.g20Root.mode = m;
      OC.wbRoot.mode = m;
      OC.ui.labels = m === 'diff';
      I.frame();
    }
    OC.g20Root.mode = null;
    OC.wbRoot.mode = null;
    OC.ui.labels = false;
    OC.nodeOf['panel:grid'].show = true;
    I.frame();
    OC.nodeOf['panel:grid'].show = false;
    if (g0) I.undo();
    ok(true, 'render modes fill/outline/photo/diff, labels, grid and a reveal hole draw without exceptions');
    // timing: cold pass, then a live drag of the speedo anchor
    const aid = Object.keys(S.data.anchors)[0];
    if (aid) {
      OC.pushUndo();
      OC.clearConflictCache();
      let t = performance.now();
      OC.computeConflicts();
      const cold = performance.now() - t;
      const times = [];
      for (let i = 1; i <= 30; i++) {
        (S.plan.anchors[aid] = S.plan.anchors[aid] || {}).dx = i;
        t = performance.now();
        OC.computeConflicts();
        times.push(performance.now() - t);
      }
      out.push('timing (' + S.data.g20.length + ' G20 x ' + S.data.wb.length + ' 6WB, ' + Object.keys(S.masks).length + ' masks): first pass ' + cold.toFixed(1) + ' ms; dragging anchor ' + aid + ': mean ' + (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) + ' ms, max ' + Math.max(...times).toFixed(1) + ' ms per update');
      I.undo();
    }
  } catch (e) {
    fails++;
    out.push('EXCEPTION ' + (e && e.stack ? e.stack : e));
  }
  out.push(fails ? fails + ' FAILED' : 'ALL PASS');
  let pre = document.getElementById('selftest');
  if (!pre) { pre = document.createElement('pre'); pre.id = 'selftest'; pre.hidden = true; document.body.appendChild(pre); }
  pre.textContent = out.join('\n');
  document.title = 'selftest-done';
})(window.OC);
