// Overlay constructor: page wiring (tree, panels, canvas interaction, undo, save/load, autosave, headless export).
'use strict';
(function (OC) {
  const S = OC.S;
  const V = OC.V;
  const W = OC.PANEL_W;
  const H = OC.PANEL_H;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(d == null ? 1 : d)) : String(v));
  const fbox = (b) => (b ? '[' + b.map((v) => fmt(v)).join(', ') + ']' : '—');

  const Q = new URLSearchParams(location.search);
  // ?dir=<repo-relative folder with g20_comfort.json + wb_comfort.json> (for tests); else ?data=sample|real
  const DIR = /^(design\/overlay|bake\/work\/overlay)\/[A-Za-z0-9_\/.-]*\/$/.test(Q.get('dir') || '') && !(Q.get('dir') || '').includes('..') ? Q.get('dir') : null;
  const DATASET = DIR ? 'custom' : Q.get('data') === 'sample' ? 'sample' : 'real';
  const EXPORT = Q.get('export');
  const UI = (OC.ui = {
    labels: Q.get('labels') === '1', cropPhoto: null, shot: Q.get('shot') === '1', mouse: null,
    pick: 'wb', snapGrid: true, gridStep: 10, snapEdges: true,
    sel: { g20: null, wb: null, anchor: null, part: null }, selConflict: null, conflicts: [], guides: null, handles: [],
    tab: Q.get('tab') || 'inspector', filt: { relation: '', safety: '', decision: '', group: '', q: '' }, sevShow: { error: true, warning: true, info: true },
  });
  OC.photos = {};

  // ---------------- on-page console log (for headless checks) ----------------
  const logEl = () => $('#console-log');
  let consoleErrors = 0;
  function logLine(kind, msg) {
    const el = logEl();
    if (el) el.textContent += '[' + kind + '] ' + msg + '\n';
    if (kind === 'error') { consoleErrors++; updateStatus(); }
  }
  const oe = console.error.bind(console);
  const ow = console.warn.bind(console);
  console.error = (...a) => { logLine('error', a.map(String).join(' ')); oe(...a); };
  console.warn = (...a) => { logLine('warn', a.map(String).join(' ')); ow(...a); };
  window.addEventListener('error', (e) => logLine('error', (e.message || 'error') + ' @ ' + (e.filename || '') + ':' + (e.lineno || '')));
  window.addEventListener('unhandledrejection', (e) => logLine('error', 'unhandled rejection: ' + (e.reason && e.reason.stack ? e.reason.stack : e.reason)));

  // ---------------- banners ----------------
  function banner(kind, html, list) {
    const b = document.createElement('div');
    b.className = 'banner ' + kind;
    b.innerHTML = '<button class="x" title="Dismiss">×</button><div>' + html + '</div>' + (list && list.length ? '<details' + (kind === 'error' ? ' open' : '') + '><summary>' + list.length + ' item(s)</summary><ul>' + list.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul></details>' : '');
    b.querySelector('.x').onclick = () => b.remove();
    $('#banners').appendChild(b);
    return b;
  }
  OC.banner = banner;

  // ---------------- undo / redo ----------------
  const hist = { undo: [], redo: [] };
  function pushUndo() {
    hist.undo.push(OC.snapshot());
    if (hist.undo.length > 300) hist.undo.shift();
    hist.redo.length = 0;
    updateUndoButtons();
  }
  OC.pushUndo = pushUndo;
  function undo() {
    if (!hist.undo.length) return;
    hist.redo.push(OC.snapshot());
    OC.restore(hist.undo.pop());
    changed(true);
  }
  function redo() {
    if (!hist.redo.length) return;
    hist.undo.push(OC.snapshot());
    OC.restore(hist.redo.pop());
    changed(true);
  }
  function updateUndoButtons() {
    $('#b-undo').disabled = !hist.undo.length;
    $('#b-redo').disabled = !hist.redo.length;
  }

  // ---------------- change pipeline ----------------
  let rafPending = false;
  let panelsDirty = false;
  let conflictsDirty = true;
  const cv = () => $('#cv');
  function requestRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(frame);
  }
  OC.requestRender = requestRender;
  function frame() {
    rafPending = false;
    if (!S.data || !S.plan) { OC.render(cv().getContext('2d')); return; }
    if (conflictsDirty) {
      UI.conflicts = OC.computeConflicts();
      if (UI.selConflict) UI.selConflict = UI.conflicts.find((c) => c.g20 === UI.selConflict.g20 && c.wb === UI.selConflict.wb && c.rule === UI.selConflict.rule) || null;
      conflictsDirty = false;
      panelsDirty = true;
    }
    OC.render(cv().getContext('2d'));
    if (panelsDirty) { panelsDirty = false; refreshPanels(); }
    updateStatus();
  }
  // structural: plan changed (decisions, moves, holes) -> conflicts, panels, autosave
  function changed(full) {
    OC.syncHoles();
    conflictsDirty = true;
    panelsDirty = true;
    if (full) needTree = true;
    updateUndoButtons();
    autosave();
    requestRender();
  }
  OC.changed = changed;
  let needTree = false;

  // ---------------- view ----------------
  function resize() {
    const st = $('#stage');
    const r = st.getBoundingClientRect();
    V.dpr = window.devicePixelRatio || 1;
    V.cw = Math.max(50, r.width);
    V.ch = Math.max(50, r.height);
    const c = cv();
    c.width = Math.round(V.cw * V.dpr);
    c.height = Math.round(V.ch * V.dpr);
    c.style.width = V.cw + 'px';
    c.style.height = V.ch + 'px';
    requestRender();
  }
  function avail() {
    const r = UI.shot ? 0 : OC.RUL;
    return { x: r, y: r, w: V.cw - r, h: V.ch - r };
  }
  function fit() {
    UI.viewBox = null;
    const a = avail();
    V.s = Math.min((a.w - 24) / W, (a.h - 24) / H);
    V.x = a.x + (a.w - W * V.s) / 2;
    V.y = a.y + (a.h - H * V.s) / 2;
    requestRender();
  }
  function zoomAt(f, X, Y) {
    const ns = Math.min(40, Math.max(0.05, V.s * f));
    const [px, py] = OC.toPanel(X, Y);
    V.s = ns;
    V.x = X - px * ns;
    V.y = Y - py * ns;
    requestRender();
  }
  function oneToOne() {
    const a = avail();
    zoomAt(1 / V.s, a.x + a.w / 2, a.y + a.h / 2);
  }
  function zoomTo(b, pad) {
    if (b !== UI.viewBox) UI.viewBox = null;
    pad = pad == null ? 40 : pad;
    const a = avail();
    const w = Math.max(8, b[2] - b[0]);
    const h = Math.max(8, b[3] - b[1]);
    V.s = Math.min(8, Math.min((a.w - 2 * pad) / w, (a.h - 2 * pad) / h));
    V.x = a.x + a.w / 2 - V.s * (b[0] + b[2]) / 2;
    V.y = a.y + a.h / 2 - V.s * (b[1] + b[3]) / 2;
    requestRender();
  }
  OC.zoomTo = zoomTo;
  const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);

  // ---------------- selection & edit target ----------------
  function select(o, keepConflict) {
    // a part selects its element too (the element's inspector, relation and decision stay below the part's)
    const pr = o.part && OC.P.byId[o.part];
    UI.sel = { g20: o.g20 || (pr && pr.source === 'sim' && S.g20ById[pr.element] ? pr.element : null), wb: o.wb || null, anchor: o.anchor || null, part: pr ? o.part : null };
    if (!keepConflict) UI.selConflict = null;
    revealInTree();
    panelsDirty = true;
    needTree = true;
    if (o.g20 || o.wb || o.anchor || o.part) setTab('inspector');
    requestRender();
  }
  OC.select = select;
  // open the tree branches of the selected items so their rows are visible
  function revealInTree() {
    for (const k of [UI.sel.g20 && 'g20:' + UI.sel.g20, UI.sel.wb && 'wb:' + UI.sel.wb, UI.sel.anchor && 'anchor:' + UI.sel.anchor, UI.sel.part && 'part:' + UI.sel.part]) {
      const n = k && OC.nodeOf[k];
      if (n) for (let a = n.parent; a; a = a.parent) a.open = true;
    }
  }
  function target() {
    if (UI.sel.anchor) return { type: 'anchor', id: UI.sel.anchor };
    if (UI.sel.wb && S.wbById[UI.sel.wb]) return { type: 'wb', id: UI.sel.wb };
    return null;
  }
  function tplan(t, create) {
    const bag = t.type === 'anchor' ? S.plan.anchors : S.plan.wb;
    if (!bag[t.id] && create) bag[t.id] = {};
    return bag[t.id] || {};
  }
  function members(aid) { return S.data.wb.filter((e) => e.anchor === aid); }
  function targetBox(t) {
    if (t.type === 'wb') return OC.xbox(S.wbById[t.id]);
    let b = null;
    for (const e of members(t.id)) if (!OC.wbHidden(e) || OC.pa(t.id).hidden) b = union(b, OC.xbox(e));
    return b || S.data.anchors[t.id].bbox || [S.data.anchors[t.id].centre[0] - 5, S.data.anchors[t.id].centre[1] - 5, S.data.anchors[t.id].centre[0] + 5, S.data.anchors[t.id].centre[1] + 5];
  }
  function targetMovable(t) {
    if (t.type === 'anchor') { const n = OC.nodeOf['anchor:' + t.id]; return !(n && OC.effLock(n)); }
    const e = S.wbById[t.id];
    const n = OC.nodeOf['wb:' + t.id];
    return e.movable !== false && !(n && OC.effLock(n));
  }
  // the visual centre a scale handle works about
  function scaleCentre(t) {
    if (t.type === 'anchor') return OC.anchorCentre(t.id);
    const e = S.wbById[t.id];
    const m = OC.pw(e.id);
    if (e.anchor) { const c = OC.anchorCentre(e.anchor); return [c[0] + (m.dx || 0), c[1] + (m.dy || 0)]; }
    const T0 = (() => { const s = m.scale; m.scale = 1; const r = OC.xbox(e); m.scale = s; return r; })();
    return [(T0[0] + T0[2]) / 2, (T0[1] + T0[3]) / 2];
  }

  OC.drawSelection = function (ctx) {
    if (!S.data || !S.plan) return;
    UI.handles = [];
    OC.panelXf(ctx);
    if (UI.sel.g20 && S.g20ById[UI.sel.g20]) {
      const b = S.g20ById[UI.sel.g20].bbox;
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2.5 / V.s;
      ctx.strokeRect(b[0] - 3 / V.s, b[1] - 3 / V.s, b[2] - b[0] + 6 / V.s, b[3] - b[1] + 6 / V.s);
      // the app textures that cover it (dashed pink)
      if (OC.P.ok && !UI.sel.part) for (const r of OC.P.recs) if (r.covers && r.placement && r.covers.some((c) => c.element === UI.sel.g20)) dashBox(ctx, r.placement, '#ff78c8');
    }
    const pr = UI.sel.part && OC.P.byId[UI.sel.part];
    if (pr) {
      const v = OC.partBitmap(pr);
      const b = (v && v.box) || pr.bbox || pr.placement;
      if (b) {
        OC.panelXf(ctx);
        ctx.strokeStyle = '#ff40ff';
        ctx.lineWidth = 2 / V.s;
        ctx.strokeRect(b[0] - 2 / V.s, b[1] - 2 / V.s, b[2] - b[0] + 4 / V.s, b[3] - b[1] + 4 / V.s);
      }
      // an app texture: every G20 element it covers (dashed cyan)
      for (const c of pr.covers || []) { const g = S.g20ById[c.element]; if (g) dashBox(ctx, g.bbox, '#00e5ff'); }
    }
    const t = target();
    if (t) {
      const b = targetBox(t);
      OC.panelXf(ctx);
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 1.5 / V.s;
      ctx.setLineDash(t.type === 'anchor' ? [8 / V.s, 4 / V.s] : []);
      ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
      ctx.setLineDash([]);
      const c = scaleCentre(t);
      ctx.beginPath();
      ctx.moveTo(c[0] - 8 / V.s, c[1]); ctx.lineTo(c[0] + 8 / V.s, c[1]);
      ctx.moveTo(c[0], c[1] - 8 / V.s); ctx.lineTo(c[0], c[1] + 8 / V.s);
      ctx.stroke();
      if (targetMovable(t)) {
        OC.screenXf(ctx);
        ctx.fillStyle = '#ffd54f';
        for (const [px, py] of [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]) {
          const [X, Y] = OC.toScreen(px, py);
          ctx.fillRect(X - 4, Y - 4, 8, 8);
          UI.handles.push([X, Y]);
        }
      }
    }
    if (UI.guides) {
      OC.panelXf(ctx);
      ctx.strokeStyle = '#ff40ff';
      ctx.lineWidth = 1 / V.s;
      ctx.beginPath();
      for (const x of UI.guides.x) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (const y of UI.guides.y) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    }
  };

  function dashBox(ctx, b, col) {
    OC.panelXf(ctx);
    ctx.setLineDash([6 / V.s, 4 / V.s]);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5 / V.s;
    ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    ctx.setLineDash([]);
  }

  // ---------------- hit testing ----------------
  function hitWb(px, py) {
    const order = OC.drawOrder();
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      if (n.type !== 'wb' || !OC.effVisible(n) || OC.effLock(n)) continue;
      const e = S.wbById[n.ref];
      if (e.kind === 'background') continue;
      const sh = OC.wbShape(e);
      if (!sh) continue;
      const i0 = Math.floor(px);
      const j0 = Math.floor(py);
      if (i0 < sh.box[0] || i0 >= sh.box[2] || j0 < sh.box[1] || j0 >= sh.box[3]) continue;
      if (sh.test(i0, j0)) return e;
    }
    return null;
  }
  function inPoly(x, y, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function hitG20(px, py) {
    let best = null;
    let ba = Infinity;
    for (const g of S.data.g20) {
      const n = OC.nodeOf['g20:' + g.id];
      if (!n || !OC.effVisible(n) || OC.effLock(n)) continue;
      const b = g.bbox;
      if (px < b[0] || px >= b[2] || py < b[1] || py >= b[3]) continue;
      if (g.poly && !inPoly(px, py, g.poly)) continue;
      const a = (b[2] - b[0]) * (b[3] - b[1]);
      if (a < ba) { ba = a; best = g; }
    }
    return best;
  }

  // ---------------- snapping ----------------
  function snapMove(t, box0, ddx, ddy, free) {
    UI.guides = null;
    let ox = ddx, oy = ddy;
    if (free) return [Math.round(ox), Math.round(oy)];
    const thr = 6 / V.s;
    let bestX = null, bestY = null;
    if (UI.snapEdges) {
      const skip = new Set(t.type === 'anchor' ? members(t.id).map((e) => e.id) : [t.id]);
      const cx = [0, W / 2, W];
      const cy = [0, H / 2, H];
      const G = S.data.constraints.geometry;
      for (const c of [G.speedo_centre, G.tacho_centre]) { cx.push(c[0]); cy.push(c[1]); }
      const add = (b) => { cx.push(b[0], (b[0] + b[2]) / 2, b[2]); cy.push(b[1], (b[1] + b[3]) / 2, b[3]); };
      for (const e of S.data.wb) {
        if (skip.has(e.id) || e.kind === 'background' || OC.wbHidden(e)) continue;
        const n = OC.nodeOf['wb:' + e.id];
        if (n && !OC.effVisible(n)) continue;
        add(OC.xbox(e));
      }
      for (const g of S.data.g20) {
        const n = OC.nodeOf['g20:' + g.id];
        if (n && !OC.effVisible(n)) continue;
        add(g.bbox);
      }
      const mx = [box0[0] + ox, (box0[0] + box0[2]) / 2 + ox, box0[2] + ox];
      const my = [box0[1] + oy, (box0[1] + box0[3]) / 2 + oy, box0[3] + oy];
      for (const c of cx) for (const m of mx) { const d = c - m; if (Math.abs(d) <= thr && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, c }; }
      for (const c of cy) for (const m of my) { const d = c - m; if (Math.abs(d) <= thr && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, c }; }
    }
    const st = UI.gridStep > 0 ? UI.gridStep : 1;
    if (bestX) ox += bestX.d; else if (UI.snapGrid) ox = Math.round(ox / st) * st;
    if (bestY) oy += bestY.d; else if (UI.snapGrid) oy = Math.round(oy / st) * st;
    if (bestX || bestY) UI.guides = { x: bestX ? [bestX.c] : [], y: bestY ? [bestY.c] : [] };
    return [Math.round(ox), Math.round(oy)];
  }

  // ---------------- canvas interaction ----------------
  let drag = null;
  let spaceDown = false;
  function setupCanvas() {
    const c = cv();
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      UI.viewBox = null;
      const r = c.getBoundingClientRect();
      if (e.shiftKey && !e.ctrlKey) { V.x -= e.deltaY; V.y -= e.deltaX; requestRender(); return; }
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    c.addEventListener('mousedown', (ev) => {
      if (!S.data || !S.plan) return;
      const r = c.getBoundingClientRect();
      const X = ev.clientX - r.left;
      const Y = ev.clientY - r.top;
      const [px, py] = OC.toPanel(X, Y);
      UI.viewBox = null;
      if (ev.button === 1 || ev.button === 2 || spaceDown) { drag = { kind: 'pan', X, Y, vx: V.x, vy: V.y }; return; }
      const t = target();
      if (t && targetMovable(t)) {
        const h = UI.handles.findIndex(([hx, hy]) => Math.abs(hx - X) <= 6 && Math.abs(hy - Y) <= 6);
        if (h >= 0) {
          const p = tplan(t, false);
          drag = { kind: 'scale', t, c: scaleCentre(t), px, py, s0: p.scale || 1, pushed: false };
          return;
        }
      }
      let hit = null;
      const pick = ev.altKey ? 'g20' : UI.pick;
      if (pick === 'g20') {
        const g = hitG20(px, py);
        if (g) { select({ g20: g.id }); drag = { kind: 'none' }; return; }
      } else {
        hit = hitWb(px, py);
        if (hit) {
          const tt = pick === 'anchor' && hit.anchor ? { type: 'anchor', id: hit.anchor } : { type: 'wb', id: hit.id };
          select(tt.type === 'anchor' ? { anchor: tt.id } : { wb: tt.id });
          if (targetMovable(tt)) {
            const p = tplan(tt, false);
            drag = { kind: 'move', t: tt, px, py, dx0: p.dx || 0, dy0: p.dy || 0, box0: targetBox(tt), pushed: false };
          } else drag = { kind: 'none' };
          return;
        }
      }
      drag = { kind: 'pan', X, Y, vx: V.x, vy: V.y, clear: true, moved: false };
    });
    window.addEventListener('mousemove', (ev) => {
      const r = c.getBoundingClientRect();
      const X = ev.clientX - r.left;
      const Y = ev.clientY - r.top;
      const inside = X >= 0 && Y >= 0 && X < V.cw && Y < V.ch;
      UI.mouse = inside ? [X, Y] : null;
      if (inside || drag) readout(X, Y);
      if (!drag) { if (inside) requestRender(); return; }
      const [px, py] = OC.toPanel(X, Y);
      if (drag.kind === 'pan') {
        if (Math.abs(X - drag.X) + Math.abs(Y - drag.Y) > 3) drag.moved = true;
        V.x = drag.vx + X - drag.X;
        V.y = drag.vy + Y - drag.Y;
        requestRender();
      } else if (drag.kind === 'move') {
        const [ox, oy] = snapMove(drag.t, drag.box0, px - drag.px, py - drag.py, ev.ctrlKey || ev.metaKey);
        const p = tplan(drag.t, false);
        const ndx = drag.dx0 + ox;
        const ndy = drag.dy0 + oy;
        if ((p.dx || 0) === ndx && (p.dy || 0) === ndy) { requestRender(); return; }
        if (!drag.pushed) { pushUndo(); drag.pushed = true; }
        const q = tplan(drag.t, true);
        q.dx = ndx;
        q.dy = ndy;
        changed();
      } else if (drag.kind === 'scale') {
        const d0 = Math.hypot(drag.px - drag.c[0], drag.py - drag.c[1]);
        const d1 = Math.hypot(px - drag.c[0], py - drag.c[1]);
        if (d0 < 1) return;
        const ns = Math.min(20, Math.max(0.05, Math.round((drag.s0 * d1 * 1000) / d0) / 1000));
        const p = tplan(drag.t, false);
        if ((p.scale || 1) === ns) return;
        if (!drag.pushed) { pushUndo(); drag.pushed = true; }
        tplan(drag.t, true).scale = ns;
        changed();
      }
    });
    window.addEventListener('mouseup', () => {
      if (drag && drag.kind === 'pan' && drag.clear && !drag.moved) select({});
      if (drag && drag.pushed) { needTree = true; panelsDirty = true; }
      drag = null;
      UI.guides = null;
      requestRender();
    });
    c.addEventListener('mouseleave', () => { UI.mouse = null; requestRender(); });
  }

  function readout(X, Y) {
    const [x, y] = OC.toPanel(X, Y);
    if (!S.data) return;
    const G = S.data.constraints.geometry;
    const ds = Math.hypot(x - G.speedo_centre[0], y - G.speedo_centre[1]);
    const dt = Math.hypot(x - G.tacho_centre[0], y - G.tacho_centre[1]);
    const near = ds <= dt ? ['speedo', G.speedo_centre] : ['tacho', G.tacho_centre];
    const u = (x - near[1][0]) / G.R;
    const v = (y - near[1][1]) / G.R;
    const ang = ((Math.atan2(x - near[1][0], -(y - near[1][1])) * 180) / Math.PI + 360) % 360;
    const sg = (n) => (n >= 0 ? '+' : '') + n.toFixed(3);
    $('#readout').textContent = 'x ' + x.toFixed(1) + '  y ' + y.toFixed(1) + '   |  ' + near[0] + ': u ' + sg(u) + '  v ' + sg(v) + '  r ' + Math.hypot(u, v).toFixed(3) + 'R  ' + ang.toFixed(1) + '° cw12';
  }

  // ---------------- keyboard ----------------
  function setupKeys() {
    window.addEventListener('keydown', (ev) => {
      const tag = (ev.target && ev.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && (ev.key === 'z' || ev.key === 'Z')) { if (typing) return; ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
      if (mod && (ev.key === 'y' || ev.key === 'Y')) { if (typing) return; ev.preventDefault(); redo(); return; }
      if (mod && (ev.key === 's' || ev.key === 'S')) { ev.preventDefault(); savePlan(); return; }
      if (typing) return;
      if (ev.key === ' ') { spaceDown = true; ev.preventDefault(); return; }
      if (ev.key.startsWith('Arrow')) {
        const t = target();
        if (!t || !targetMovable(t)) return;
        ev.preventDefault();
        const st = ev.shiftKey ? 10 : 1;
        pushUndo();
        const p = tplan(t, true);
        if (ev.key === 'ArrowLeft') p.dx = (p.dx || 0) - st;
        if (ev.key === 'ArrowRight') p.dx = (p.dx || 0) + st;
        if (ev.key === 'ArrowUp') p.dy = (p.dy || 0) - st;
        if (ev.key === 'ArrowDown') p.dy = (p.dy || 0) + st;
        changed();
        return;
      }
      const k = ev.key.toLowerCase();
      if (k === 'f') fit();
      else if (k === '1') oneToOne();
      else if (k === '+' || k === '=') zoomAt(1.25, V.cw / 2, V.ch / 2);
      else if (k === '-') zoomAt(0.8, V.cw / 2, V.ch / 2);
      else if (k === 'escape') select({});
      else if (k === 'w') setPick('wb');
      else if (k === 'g') setPick('g20');
      else if (k === 'a') setPick('anchor');
      else if (k === 'l') { UI.labels = !UI.labels; $('#c-labels').checked = UI.labels; requestRender(); }
    });
    window.addEventListener('keyup', (ev) => { if (ev.key === ' ') spaceDown = false; });
  }
  function setPick(p) {
    UI.pick = p;
    document.querySelectorAll('#pick button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
  }

  // ---------------- G20 parts: tags, state, inspector ----------------
  const RENDER_TAG = { raster: 'B', procedural: 'C', live: 'D', 'app-texture': 'app', font: 'font', data: 'data' };
  // small tags for a part row: source/package, look, state, layer; '!' a fallback (with the reason); greyed when the
  // global look / theme / lamps leave it undrawn
  function partTags(n) {
    const r = OC.P.byId[n.ref];
    if (!r) return { html: '', inactive: true, title: 'not in g20_parts.json' };
    const t = [];
    const pk = r.source === 'app-scene' ? 'app' : r.package === 'E' ? 'E' : RENDER_TAG[r.render] || '?';
    if (r.render !== 'font' && r.render !== 'data') t.push('<span class="pt src-' + esc(pk) + '" title="' + esc(r.source + ', ' + r.render + (r.package ? ', package ' + r.package : '')) + '">' + esc(pk) + '</span>');
    if (r.source === 'sim') {
      t.push('<span class="pt" title="look ' + r.look + '">' + (r.look === 'any' ? '·' : r.look === 'day' ? 'D' : 'N') + '</span>');
      t.push('<span class="pt" title="state ' + r.state + '">' + (r.state === 'any' ? '·' : r.state === 'stock' ? 'stk' : 'con') + '</span>');
      t.push('<span class="pt' + (r.layer === 'over' ? ' over' : '') + '" title="layer ' + r.layer + '">' + (r.layer === 'over' ? 'O' : 'U') + '</span>');
      if (r.lamp) t.push('<span class="pt" title="lamp ' + esc(r.lamp) + '">L</span>');
    }
    let inactive = false;
    let title = '';
    if (r.render === 'font' || r.render === 'data') {
      t.push('<span class="pt fb" title="not a picture">' + esc(r.render) + '</span>');
      return { html: t.join(''), inactive: true, title: 'not drawn: ' + (r.render === 'font' ? 'the font C draws its texts with' : 'data, not a picture') };
    }
    const st = n.type === 'apptex' ? { active: true, v: OC.partBitmap(r) } : OC.partNodeState(n);
    if (!st.active) { inactive = true; title = 'not drawn now: ' + st.why; }
    else if (st.v && st.v.empty) { t.push('<span class="pt" title="' + esc(st.v.empty) + '">∅</span>'); title = st.v.empty; }
    else if (st.v && st.v.fallback) { t.push('<span class="pt fb" title="' + esc('fallback to the schematic: ' + st.v.fallback) + '">!</span>'); title = 'fallback: ' + st.v.fallback; }
    return { html: t.join(''), inactive, title };
  }
  function partInspector(r) {
    const P = OC.P;
    const link = (id) => (P.byId[id] ? '<a href="#" data-a="sel-part" data-id="' + esc(id) + '">' + esc(id) + '</a>' : esc(id));
    const glink = (id) => (S.g20ById[id] ? '<a href="#" data-a="sel-g20" data-id="' + esc(id) + '">' + esc(id) + '</a>' : esc(id));
    const n = OC.nodeOf['part:' + r.id];
    const st = r.source === 'app-scene' ? { active: true, v: OC.partBitmap(r) } : n ? OC.partNodeState(n) : { active: false, why: 'no tree node' };
    const v = st.v;
    const th = st.active && v && v.img ? OC.partThumb(r, 420, 160) : null;
    const proc = r.procedural ? esc(r.procedural.module) + ' · ' + esc(r.procedural.draw || r.procedural.id) : '—';
    const m = r.measured;
    const rows = [
      ['element', r.element ? glink(r.element) : '<i>none</i> (see report.unresolved)'],
      ['source', esc(r.source) + (r.package ? ' · package ' + esc(r.package) : '') + ' · ' + esc(r.render) + ' · kind ' + esc(r.kind)],
      ['file', r.file ? '<code>' + esc(r.file) + '</code>' : '—'],
      ['procedural', proc],
      ['size', r.size ? r.size.join(' × ') + (r.scale && r.scale !== 1 ? ' (drawn ×' + r.scale + ')' : '') : '—'],
      ['placement', fbox(r.placement)],
      ['bbox', fbox(r.bbox) + (r.alpha_px ? ', ' + r.alpha_px + ' px' : '')],
    ];
    if (m) rows.push(['measured', m.fallback ? '<span class="crit">' + esc(m.fallback) + '</span>' : fbox(m.bbox) + ', ' + m.px + ' px (' + esc(Object.entries(m.state || {}).filter(([, x]) => x !== null && !(Array.isArray(x) && !x.length)).map(([k, x]) => k + ' ' + x).join(', ')) + ')']);
    rows.push(['layer · state · look', esc(r.layer) + ' · ' + esc(r.state) + ' · ' + esc(r.look) + (r.z != null ? ' · z ' + r.z : '')]);
    if (r.lamp) rows.push(['lamp', esc(r.lamp)]);
    if (r.cond) rows.push(['condition', esc(r.cond) + (r.cond_source ? ' <span class="muted">(' + esc(r.cond_source) + ')</span>' : '')]);
    if (r.skip) rows.push(['skip', esc(r.skip)]);
    if (r.clip) rows.push(['clip', 'live at the needle line (' + esc(r.clip.by) + '); drawn here unclipped']);
    rows.push(['now', st.active ? (v && v.empty ? '<span class="muted">' + esc(v.empty) + '</span>' : v && v.fallback ? '<span class="crit">fallback: ' + esc(v.fallback) + '</span>' : 'drawn' + (v && v.box ? ' at ' + fbox(v.box) + ', ' + v.px + ' px' : '')) : '<span class="muted">not drawn: ' + esc(st.why) + '</span>']);
    rows.push(['evidence', esc(r.evidence) + (r.sources && r.sources.length ? ' · photos ' + esc(r.sources.join(', ')) : '')]);
    rows.push(['used by', r.used_by.length ? esc(r.used_by.join(', ')) : '<i>nothing</i>']);
    if (r.baked_into && r.baked_into.length) rows.push(['baked into', r.baked_into.map(link).join(', ')]);
    if (r.baked_from && r.baked_from.length) rows.push(['baked from', r.baked_from.map(link).join(', ') + (r.baked_from_files ? '<br>' + r.baked_from_files.map((f) => '<code>' + esc(f) + '</code>').join(', ') : '')]);
    if (r.covers && r.covers.length) rows.push(['covers', r.covers.map((c) => glink(c.element) + ' ' + c.pct + ' %').join(', ') + (r.covers_note ? '<br><span class="muted">' + esc(r.covers_note) + '</span>' : '')]);
    if (r.vs_catalogue) rows.push(['vs catalogue', 'edges ' + esc(r.vs_catalogue.d_edges.join(', ')) + ' px, ' + (r.vs_catalogue.inside_pct == null ? '?' : r.vs_catalogue.inside_pct) + ' % inside the element']);
    if (r.notes) rows.push(['notes', esc(r.notes)]);
    return '<section class="insp" data-part="' + esc(r.id) + '"><h3><span class="tag p">part</span> ' + esc(r.id) + '</h3>' +
      (th ? '<div class="thumb"><img alt="" src="' + th + '"></div>' : '') +
      '<dl class="kv">' + rows.map(([k, x]) => '<dt>' + k + '</dt><dd>' + x + '</dd>').join('') + '</dl></section>';
  }

  // ---------------- layer tree DOM ----------------
  function renderTree() {
    needTree = false;
    const root = $('#tree');
    const st = root.scrollTop;
    const rows = [];
    const sel = new Set([UI.sel.g20 && 'g20:' + UI.sel.g20, UI.sel.wb && 'wb:' + UI.sel.wb, UI.sel.anchor && 'anchor:' + UI.sel.anchor, UI.sel.part && 'part:' + UI.sel.part].filter(Boolean));
    const counts = conflictCounts();
    const walk = (n, depth) => {
      for (let i = 0; i < n.children.length; i++) {
        const c = n.children[i];
        const isGroup = !!c.children;
        const id = c.type === 'g20' ? 'g20:' + c.ref : c.type === 'wb' ? 'wb:' + c.ref : c.type === 'anchor' && c.ref ? 'anchor:' + c.ref : c.type === 'part' || c.type === 'apptex' ? 'part:' + c.ref : '';
        const g = c.type === 'g20' ? S.g20ById[c.ref] : null;
        const e = c.type === 'wb' ? S.wbById[c.ref] : null;
        const modeable = c.type === 'g20' || c.type === 'wb' || c.type === 'g20group' || c.type === 'anchor' || c.type === 'cluster' || c === OC.g20Root || c === OC.wbRoot || c.type === 'part' || c.type === 'apptex' || c === OC.oursRoot;
        let badge = '';
        let inactive = false;
        let rowTitle = c.title || '';
        if (c.type === 'part' || c.type === 'apptex') {
          const t = partTags(c);
          badge = t.html;
          inactive = t.inactive;
          if (t.title) rowTitle = t.title + (rowTitle ? ' · ' + rowTitle : '');
        }
        if (g) {
          const k = counts.g20[g.id];
          badge = '<span class="rel rel-' + g.relation + '" title="relation ' + g.relation + '">' + g.relation[0].toUpperCase() + '</span>' + (g.safety === 'critical' ? '<span class="crit" title="critical">!</span>' : '') + (g.relation === 'over' ? '<span class="overlock" title="over: always drawn above 6WB">' + OC.lockIconSvg + '</span>' : '') + (k ? '<span class="cc ' + k.top + '">' + k.n + '</span>' : '');
        }
        if (e) {
          const k = counts.wb[e.id];
          badge = (OC.wbHidden(e) ? '<span class="hid" title="hidden in the plan">h</span>' : '') + (k ? '<span class="cc ' + k.top + '">' + k.n + '</span>' : '');
        }
        const cnt = isGroup ? '<span class="n">' + OC.leaves(c).length + '</span>' : '';
        rows.push('<div class="row' + (sel.has(id) ? ' sel' : '') + (c.avail ? '' : ' na') + ((OC.effVisible(c) || isGroup) && !inactive ? '' : ' off') + '" data-k="' + c.key + '" style="padding-left:' + (4 + depth * 12) + 'px" title="' + esc(rowTitle) + '">' +
          '<span class="caret">' + (isGroup ? (c.open ? '▾' : '▸') : '') + '</span>' +
          '<input type="checkbox" class="eye" ' + (c.show ? 'checked' : '') + (c.avail ? '' : ' disabled') + ' title="show / hide">' +
          '<button class="solo' + (c.solo ? ' on' : '') + '" title="solo">S</button>' +
          '<button class="lk' + (c.lock ? ' on' : '') + '" title="lock (no picking or dragging)">' + OC.lockIconSvg + '</button>' +
          '<span class="name">' + esc(c.label) + (c.avail ? '' : ' <i>(not available)</i>') + '</span>' + badge + cnt +
          '<span class="ctl">' + (modeable ? '<select class="mode" title="render mode">' + ['', 'fill', 'outline', 'photo', 'diff', 'texture'].map((m) => '<option value="' + m + '"' + ((c.mode || '') === m ? ' selected' : '') + '>' + (m || '·') + '</option>').join('') + '</select>' : '') +
          '<input type="range" class="op" min="0" max="1" step="0.05" value="' + c.opacity + '" title="opacity ' + c.opacity + '">' +
          '<button class="up" title="z up">▲</button><button class="dn" title="z down">▼</button></span></div>');
        if (isGroup && c.open) walk(c, depth + 1);
      }
    };
    walk(OC.tree, 0);
    root.innerHTML = rows.join('');
    root.scrollTop = st;
  }
  const nodeByKey = (k) => { let f = null; const w = (n) => { if (n.key === k) f = n; else if (n.children) n.children.forEach(w); }; w(OC.tree); return f; };
  function setupTree() {
    const root = $('#tree');
    root.addEventListener('click', (ev) => {
      const row = ev.target.closest('.row');
      if (!row) return;
      const n = nodeByKey(row.dataset.k);
      const t = ev.target;
      if (t.classList.contains('eye')) {
        const v = t.checked;
        const set = (m) => { if (m.avail) m.show = v; if (m.children) m.children.forEach(set); };
        set(n);
        needTree = true;
      } else if (t.closest('.solo')) { n.solo = !n.solo; OC.refreshSolo(); needTree = true; }
      else if (t.closest('.lk')) { const v = !n.lock; const set = (m) => { m.lock = v; if (m.children) m.children.forEach(set); }; set(n); needTree = true; }
      else if (t.classList.contains('up') || t.classList.contains('dn')) zorder(n, t.classList.contains('up') ? 1 : -1);
      else if (t.classList.contains('caret') && n.children) { n.open = !n.open; needTree = true; }
      else if (t.classList.contains('op') || t.classList.contains('mode')) return;
      else {
        if (n.type === 'g20') select({ g20: n.ref });
        else if (n.type === 'part' || n.type === 'apptex') select({ part: n.ref });
        else if (n.type === 'wb') select({ wb: n.ref });
        else if (n.type === 'anchor' && n.ref) select({ anchor: n.ref });
        else if (n.children) { n.open = !n.open; needTree = true; }
      }
      if (needTree) renderTree();
      requestRender();
    });
    root.addEventListener('dblclick', (ev) => {
      const row = ev.target.closest('.row');
      if (!row || ev.target.closest('.ctl')) return;
      const n = nodeByKey(row.dataset.k);
      if (n.type === 'g20') zoomTo(S.g20ById[n.ref].bbox);
      else if (n.type === 'part' || n.type === 'apptex') { const r = OC.P.byId[n.ref]; const v = OC.partBitmap(r); const b = (v && v.box) || r.bbox || r.placement; if (b) zoomTo(b); }
      else if (n.type === 'wb') zoomTo(OC.xbox(S.wbById[n.ref]));
      else if (n.type === 'anchor' && n.ref) zoomTo(targetBox({ type: 'anchor', id: n.ref }));
    });
    root.addEventListener('input', (ev) => {
      const row = ev.target.closest('.row');
      if (!row) return;
      const n = nodeByKey(row.dataset.k);
      if (ev.target.classList.contains('op')) { n.opacity = parseFloat(ev.target.value); ev.target.title = 'opacity ' + n.opacity; requestRender(); }
    });
    root.addEventListener('change', (ev) => {
      const row = ev.target.closest('.row');
      if (!row) return;
      const n = nodeByKey(row.dataset.k);
      if (ev.target.classList.contains('mode')) { n.mode = ev.target.value || null; requestRender(); }
    });
  }
  // z-order: inside 6WB the plan z of every member moves by one; elsewhere the tree order (draw order) changes.
  function zorder(n, dir) {
    let inWb = false;
    for (let a = n; a; a = a.parent) if (a === OC.wbRoot && a !== n) inWb = true;
    if (inWb) {
      pushUndo();
      for (const l of OC.leaves(n)) {
        const e = S.wbById[l.ref];
        const p = S.plan.wb[e.id] || (S.plan.wb[e.id] = {});
        p.z = OC.wbZ(e) + dir;
      }
      changed(true);
      return;
    }
    const sib = n.parent.children;
    const i = sib.indexOf(n);
    const j = i - dir;
    if (j < 0 || j >= sib.length) return;
    sib.splice(i, 1);
    sib.splice(j, 0, n);
    needTree = true;
  }

  // ---------------- conflict helpers ----------------
  function conflictCounts() {
    const r = { g20: {}, wb: {} };
    const rank = { error: 3, warning: 2, info: 1 };
    for (const c of UI.conflicts) {
      for (const [bag, id] of [[r.g20, c.g20], [r.wb, c.wb]]) {
        if (!id) continue;
        const k = bag[id] || (bag[id] = { n: 0, top: 'info' });
        k.n++;
        if (rank[c.severity] > rank[k.top]) k.top = c.severity;
      }
    }
    return r;
  }
  function conflictRows(list, withClick) {
    if (!list.length) return '<p class="muted">none</p>';
    return '<table class="cf"><tr><th></th><th>rule</th><th>G20</th><th>6WB</th><th>px</th><th>%</th></tr>' + list.map((c) =>
      '<tr class="' + c.severity + (withClick ? ' click' : '') + (UI.selConflict === c ? ' sel' : '') + '" data-i="' + UI.conflicts.indexOf(c) + '" title="' + esc(c.message) + '"><td><span class="sev ' + c.severity + '">' + c.severity[0].toUpperCase() + '</span></td><td>' + esc(c.rule) + '</td><td>' + esc(c.g20) + '</td><td>' + esc(c.wb || '—') + '</td><td class="r">' + c.overlap_px + '</td><td class="r">' + (c.overlap_pct == null ? '' : fmt(c.overlap_pct)) + '</td></tr>').join('') + '</table>';
  }
  function clickConflict(c) {
    UI.selConflict = c;
    UI.sel = { g20: c.g20, wb: c.wb, anchor: null, part: null };
    revealInTree();
    needTree = true;
    let b = S.g20ById[c.g20].bbox;
    if (c.wb) b = union(b, c._bb || OC.xbox(S.wbById[c.wb]));
    if (c._bb) b = union(c._bb, S.g20ById[c.g20].bbox);
    zoomTo(b, 60);
    // make sure both are visible and the highlight is on
    const n = OC.nodeOf['ov:conflict'];
    if (n) n.show = true;
    panelsDirty = true;
    requestRender();
  }

  // ---------------- right panels ----------------
  function setTab(t) {
    UI.tab = t;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    document.querySelectorAll('.tab').forEach((d) => d.classList.toggle('on', d.id === 'tab-' + t));
    panelsDirty = true;
    requestRender();
  }
  function refreshPanels() {
    if (needTree) renderTree();
    else renderTreeBadgesLazy();
    const sum = { error: 0, warning: 0, info: 0 };
    for (const c of UI.conflicts) sum[c.severity]++;
    $('#tabs [data-t=conflicts]').innerHTML = 'Conflicts <span class="sev error">' + sum.error + '</span><span class="sev warning">' + sum.warning + '</span><span class="sev info">' + sum.info + '</span>';
    if (UI.tab === 'inspector') renderInspector();
    else if (UI.tab === 'decisions') renderDecisions();
    else if (UI.tab === 'conflicts') renderConflicts();
    else if (UI.tab === 'holes') renderHoles();
    else if (UI.tab === 'plan') renderPlanTab();
  }
  let badgeTimer = 0;
  function renderTreeBadgesLazy() {
    if (drag) { clearTimeout(badgeTimer); badgeTimer = setTimeout(() => { if (!drag) renderTree(); }, 300); return; }
    renderTree();
  }

  function num(name, v, step, extra) {
    return '<input type="number" data-f="' + name + '" value="' + (v == null ? '' : v) + '" step="' + (step || 1) + '"' + (extra || '') + '>';
  }
  function renderInspector() {
    const el = $('#tab-inspector');
    if (document.activeElement && el.contains(document.activeElement) && drag == null && document.activeElement.tagName === 'TEXTAREA') return;
    let h = '';
    if (UI.sel.part && OC.P.byId[UI.sel.part]) h += partInspector(OC.P.byId[UI.sel.part]);
    if (UI.sel.g20 && S.g20ById[UI.sel.g20]) h += g20Inspector(S.g20ById[UI.sel.g20]);
    if (UI.sel.anchor) h += wbInspector({ type: 'anchor', id: UI.sel.anchor });
    else if (UI.sel.wb && S.wbById[UI.sel.wb]) h += wbInspector({ type: 'wb', id: UI.sel.wb });
    if (!h) h = '<p class="muted">Nothing selected. Click a 6WB element on the canvas (pick mode W), a G20 element (pick mode G or Alt-click), an anchor (pick mode A), a tree row or a conflict.</p>' + keysHelp();
    el.innerHTML = h;
  }
  function keysHelp() {
    return '<h4>Keys</h4><ul class="keys"><li><b>F</b> fit, <b>1</b> 1:1, <b>+/−</b> or wheel zoom, drag empty space / Space+drag / right-drag pan</li><li><b>W / G / A</b> pick 6WB elements / G20 elements / anchors; <b>Alt</b>-click picks G20</li><li><b>Arrows</b> nudge 1 px, <b>Shift</b> 10 px; drag corner handles to scale about the anchor centre</li><li>Snapping to the grid step and to edges/centres of other elements; hold <b>Ctrl/⌘</b> while dragging to move freely</li><li><b>Ctrl/⌘+Z</b> undo, <b>Shift+Ctrl/⌘+Z</b> or <b>Ctrl+Y</b> redo, <b>Ctrl/⌘+S</b> save plan, <b>L</b> labels, <b>Esc</b> deselect</li></ul>';
  }
  function g20Inspector(g) {
    const p = S.plan.g20[g.id] || { decision: OC.defaultDecision(g) };
    const over = g.relation === 'over';
    const ar = OC.g20Raster(g).area;
    const opts = OC.ENUM.DECISIONS.map((d) => '<option' + (p.decision === d ? ' selected' : '') + '>' + d + '</option>').join('');
    const mine = UI.conflicts.filter((c) => c.g20 === g.id);
    const hole = S.plan.holes[g.id];
    const basis = (g.relation_basis || []).map((b) => '<tr><td>' + esc(b.photo) + '</td><td>' + tri(b.seen) + '</td><td>' + tri(b.our_pixels_opaque_there) + '</td><td>' + tri(b.lit_expected) + '</td><td>' + esc(b.note || '') + '</td></tr>').join('');
    const states = (g.states || []).map((s) => '<tr><td>' + esc(s.photo) + '</td><td>' + tri(s.lit) + '</td><td>' + esc(s.colour || '') + '</td><td>' + esc(s.note || '') + '</td></tr>').join('');
    return '<section class="insp" data-g20="' + esc(g.id) + '"><h3><span class="tag g">G20</span> ' + esc(g.id) + '</h3><p class="name">' + esc(g.name) + '</p>' +
      '<dl class="kv"><dt>group</dt><dd>' + esc(g.group) + '</dd><dt>relation</dt><dd><span class="rel rel-' + g.relation + '">' + g.relation + '</span>' + (over ? ' ' + OC.lockIconSvg + ' drawn above any theme' : '') + '</dd><dt>evidence</dt><dd>' + esc(g.evidence) + '</dd><dt>safety</dt><dd' + (g.safety === 'critical' ? ' class="crit"' : '') + '>' + esc(g.safety) + '</dd>' +
      '<dt>bbox</dt><dd>' + fbox(g.bbox) + '</dd><dt>shape</dt><dd>' + (g.poly ? 'poly, ' + g.poly.length + ' points' : 'bbox') + ', ' + ar + ' px</dd><dt>colour</dt><dd><span class="sw" style="background:' + OC.rgba(OC.g20Rgb(g), 1) + '"></span>' + esc(g.colour && g.colour.name) + '</dd>' +
      '<dt>schematic</dt><dd>' + esc(g.schematic || '—') + (g.schematic && !S.schematics[g.id] ? ' <i>(not loaded)</i>' : '') + '</dd><dt>measured by</dt><dd>' + esc(g.measured_by || '—') + '</dd>' + (g.notes ? '<dt>notes</dt><dd>' + esc(g.notes) + '</dd>' : '') + '</dl>' + g20PartsBlock(g) +
      '<h4>Relation basis</h4>' + (basis ? '<table class="mini"><tr><th>photo</th><th>seen</th><th>ours opaque</th><th>lit exp.</th><th>note</th></tr>' + basis + '</table>' : '<p class="muted">none</p>') +
      '<h4>States</h4>' + (states ? '<table class="mini"><tr><th>photo</th><th>lit</th><th>colour</th><th>note</th></tr>' + states + '</table>' : '<p class="muted">none</p>') +
      '<h4>Decision</h4><div class="form"><label>decision <select data-g="decision"' + (over ? ' disabled' : '') + '>' + opts + '</select></label>' + (over ? '<span class="muted"> forced: over</span>' : '') +
      ' <span class="muted">default: ' + OC.defaultDecision(g) + '</span>' +
      '<label class="blk">notes<textarea data-g="notes" rows="2">' + esc(p.notes || '') + '</textarea></label>' +
      (p.decision === 'redraw' ? '<div class="blk">redraw_at ' + [0, 1, 2, 3].map((i) => num('ra' + i, p.redraw_at ? p.redraw_at[i] : '', 1, ' data-g="ra"')).join('') + ' <button data-a="ra-bbox">= bbox</button> <button data-a="ra-clear">clear</button></div>' : '') +
      (hole ? '<div class="blk">hole ' + fbox(hole.rect) + ' margin ' + hole.margin + ' radius ' + hole.radius + (hole.edited ? ' (edited)' : '') + ' <button data-a="goto-holes">edit</button></div>' : '') +
      '</div><h4>Conflicts (' + mine.length + ')</h4>' + conflictRows(mine, true) + '</section>';
  }
  // the element's own parts (have it / must draw it) and the app textures over it
  function g20PartsBlock(g) {
    const P = OC.P;
    if (!P.ok) return '';
    const mine = P.recs.filter((r) => r.element === g.id);
    const cov = P.recs.filter((r) => r.covers && r.covers.some((c) => c.element === g.id) && r.element !== g.id);
    const pe = (P.doc.report && P.doc.report.per_element && P.doc.report.per_element[g.id]) || null;
    const li = (r) => '<li><a href="#" data-a="sel-part" data-id="' + esc(r.id) + '">' + esc(r.id) + '</a> <span class="muted">' + esc(r.render + (r.look !== 'any' ? ', ' + r.look : '') + (r.state !== 'any' ? ', ' + r.state : '')) + '</span></li>';
    return '<h4>G20 parts (' + mine.length + ')</h4>' + (mine.length ? '<ul class="parts">' + mine.map(li).join('') + '</ul>' : '<p class="crit">no part: we would still have to draw it</p>') +
      (pe && pe.missing.length ? '<p class="muted">missing: ' + esc(pe.missing.join('; ')) + '</p>' : '') +
      (cov.length ? '<p>covered in the app by ' + cov.map((r) => '<a href="#" data-a="sel-part" data-id="' + esc(r.id) + '">' + esc(r.id) + '</a> ' + r.covers.find((c) => c.element === g.id).pct + ' %').join(', ') + '</p>' : '');
  }
  const tri = (v) => (v === true ? 'yes' : v === false ? 'no' : v == null ? '?' : esc(v));
  function wbInspector(t) {
    const p = tplan(t, false);
    if (t.type === 'anchor') {
      const A = S.data.anchors[t.id];
      const ms = members(t.id);
      const mine = UI.conflicts.filter((c) => c.wb && S.wbById[c.wb].anchor === t.id);
      return '<section class="insp" data-t="anchor" data-id="' + esc(t.id) + '"><h3><span class="tag a">anchor</span> ' + esc(t.id) + '</h3>' +
        '<dl class="kv"><dt>centre</dt><dd>' + fbox(A.centre) + ' → ' + fbox(OC.anchorCentre(t.id)) + '</dd><dt>R</dt><dd>' + (A.R == null ? '—' : fmt(A.R)) + '</dd><dt>bbox</dt><dd>' + fbox(A.bbox) + '</dd><dt>members</dt><dd>' + ms.length + '</dd>' + (A.notes ? '<dt>notes</dt><dd>' + esc(A.notes) + '</dd>' : '') + '</dl>' +
        moveForm(p, false) + '<h4>Conflicts of members (' + mine.length + ')</h4>' + conflictRows(mine, true) + '</section>';
    }
    const e = S.wbById[t.id];
    const mine = UI.conflicts.filter((c) => c.wb === e.id);
    const mk = S.masks[e.id];
    return '<section class="insp" data-t="wb" data-id="' + esc(e.id) + '"><h3><span class="tag w">6WB</span> ' + esc(e.id) + '</h3>' +
      '<dl class="kv"><dt>source</dt><dd>' + esc(e.source) + (e.cluster ? ' · ' + esc(e.cluster) : '') + '</dd><dt>kind</dt><dd>' + esc(e.kind) + (e.opaque === false ? ' (not opaque)' : '') + '</dd><dt>anchor</dt><dd>' + (e.anchor ? '<a href="#" data-a="sel-anchor">' + esc(e.anchor) + '</a>' : '—') + '</dd><dt>z</dt><dd>' + e.z + (OC.wbZ(e) !== e.z ? ' → ' + OC.wbZ(e) : '') + '</dd>' +
      '<dt>bbox</dt><dd>' + fbox(e.bbox) + '</dd><dt>now</dt><dd>' + fbox(OC.xbox(e)) + '</dd><dt>mask</dt><dd>' + (e.mask ? esc(e.mask) + (mk ? ' (' + mk.w + '×' + mk.h + ', ' + mk.area + ' px)' : ' <i>(not loaded: bbox used)</i>') : 'none: bbox') + '</dd>' +
      (e.file ? '<dt>file</dt><dd>' + esc(e.file) + '</dd>' : '') + (e.widget ? '<dt>widget</dt><dd>' + esc(e.widget) + (e.conn != null ? ' conn ' + e.conn : '') + '</dd>' : '') + (e.hole ? '<dt>own hole</dt><dd>' + fbox(e.hole.rect) + ' r ' + (e.hole.radius || 0) + ' when ' + esc(e.hole.when || 'always') + '</dd>' : '') + (e.notes ? '<dt>notes</dt><dd>' + esc(e.notes) + '</dd>' : '') + '</dl>' +
      (e.movable === false ? '<p class="muted">not movable (still hideable)</p>' : '') + moveForm(p, true, e) + '<h4>Conflicts (' + mine.length + ')</h4>' + conflictRows(mine, true) + '</section>';
  }
  function moveForm(p, isEl, e) {
    return '<h4>Plan</h4><div class="form grid">' +
      '<label>dx ' + num('dx', p.dx || 0, 1) + '</label><label>dy ' + num('dy', p.dy || 0, 1) + '</label><label>scale ' + num('scale', p.scale == null ? 1 : p.scale, 0.01, ' min="0.05"') + '</label>' +
      (isEl ? '<label>z ' + num('z', OC.wbZ(e), 1) + '</label>' : '') + '<label>opacity ' + num('opacity', p.opacity == null ? 1 : p.opacity, 0.05, ' min="0" max="1"') + '</label>' +
      '<label class="chk"><input type="checkbox" data-f="hidden"' + (p.hidden ? ' checked' : '') + '> hidden in the plan</label>' +
      '<button data-a="reset-move">reset</button></div>';
  }
  function setupInspector() {
    const el = $('#tab-inspector');
    el.addEventListener('change', (ev) => {
      const t = ev.target;
      const sec = t.closest('.insp');
      if (!sec) return;
      if (sec.dataset.g20) {
        const g = S.g20ById[sec.dataset.g20];
        const p = S.plan.g20[g.id] || (S.plan.g20[g.id] = { decision: OC.defaultDecision(g), notes: '', redraw_at: null });
        pushUndo();
        if (t.dataset.g === 'decision') p.decision = g.relation === 'over' ? 'keep-clear' : t.value;
        else if (t.dataset.g === 'notes') p.notes = t.value;
        else if (t.dataset.g === 'ra') {
          const vs = [0, 1, 2, 3].map((i) => parseFloat(sec.querySelector('[data-f=ra' + i + ']').value));
          p.redraw_at = vs.every((v) => isFinite(v)) && vs[2] > vs[0] && vs[3] > vs[1] ? vs : null;
        }
        changed(true);
        return;
      }
      const tt = { type: sec.dataset.t, id: sec.dataset.id };
      const f = t.dataset.f;
      if (!f) return;
      pushUndo();
      const p = tplan(tt, true);
      if (f === 'hidden') p.hidden = t.checked;
      else {
        const v = parseFloat(t.value);
        if (!isFinite(v)) return;
        if (f === 'scale') p.scale = Math.max(0.05, v);
        else if (f === 'opacity') p.opacity = Math.min(1, Math.max(0, v));
        else p[f] = v;
      }
      changed(true);
    });
    el.addEventListener('click', (ev) => {
      const t = ev.target;
      const a = t.dataset && t.dataset.a;
      const tr = t.closest('tr.click');
      if (tr) { clickConflict(UI.conflicts[+tr.dataset.i]); return; }
      if (!a) return;
      ev.preventDefault();
      const sec = t.closest('.insp');
      if (a === 'sel-part') { select({ part: t.dataset.id }); return; }
      if (a === 'sel-g20') { select({ g20: t.dataset.id }); return; }
      if (a === 'sel-anchor') { select({ anchor: S.wbById[sec.dataset.id].anchor }); return; }
      if (a === 'goto-holes') { setTab('holes'); return; }
      if (a === 'reset-move') {
        pushUndo();
        if (sec.dataset.t === 'anchor') delete S.plan.anchors[sec.dataset.id];
        else delete S.plan.wb[sec.dataset.id];
        changed(true);
        return;
      }
      if (a === 'ra-bbox' || a === 'ra-clear') {
        const g = S.g20ById[sec.dataset.g20];
        pushUndo();
        S.plan.g20[g.id].redraw_at = a === 'ra-bbox' ? g.bbox.map((v, i) => (i < 2 ? Math.floor(v) : Math.ceil(v))) : null;
        changed(true);
      }
    });
  }

  function renderDecisions() {
    const el = $('#tab-decisions');
    const F = UI.filt;
    const counts = conflictCounts();
    const groups = Array.from(new Set(S.data.g20.map((g) => g.group)));
    const sel = (k, vals) => '<select data-filt="' + k + '"><option value="">' + k + ': all</option>' + vals.map((v) => '<option' + (F[k] === v ? ' selected' : '') + '>' + v + '</option>').join('') + '</select>';
    const rows = S.data.g20.filter((g) => {
      const d = OC.decision(g);
      return (!F.relation || g.relation === F.relation) && (!F.safety || g.safety === F.safety) && (!F.decision || d === F.decision) && (!F.group || g.group === F.group) && (!F.q || (g.id + ' ' + g.name).toLowerCase().includes(F.q.toLowerCase()));
    });
    const keepFocus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.filt === 'q';
    el.innerHTML = '<div class="filters">' + sel('relation', OC.ENUM.REL) + sel('safety', OC.ENUM.SAF) + sel('decision', OC.ENUM.DECISIONS) + sel('group', groups) + '<input data-filt="q" placeholder="search" value="' + esc(F.q) + '"></div>' +
      '<p class="muted">' + rows.length + ' of ' + S.data.g20.length + ' elements. Relation, evidence and basis are read-only; decisions are the plan.</p>' +
      '<table class="dec"><tr><th>id</th><th>rel</th><th>ev</th><th>safety</th><th>decision</th><th>!</th></tr>' + rows.map((g) => {
        const p = S.plan.g20[g.id];
        const k = counts.g20[g.id];
        const over = g.relation === 'over';
        return '<tr data-id="' + esc(g.id) + '" class="' + (UI.sel.g20 === g.id ? 'sel' : '') + '"><td title="' + esc(g.name) + '">' + esc(g.id) + '</td><td><span class="rel rel-' + g.relation + '">' + g.relation + '</span></td><td>' + esc(g.evidence) + '</td><td' + (g.safety === 'critical' ? ' class="crit"' : '') + '>' + esc(g.safety) + '</td><td><select' + (over ? ' disabled' : '') + '>' + OC.ENUM.DECISIONS.map((d) => '<option' + (p.decision === d ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>' + (over ? OC.lockIconSvg : '') + '</td><td>' + (k ? '<span class="cc ' + k.top + '">' + k.n + '</span>' : '') + '</td></tr>';
      }).join('') + '</table>';
    if (keepFocus) { const i = el.querySelector('[data-filt=q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  function setupDecisions() {
    const el = $('#tab-decisions');
    el.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.filt) { UI.filt[t.dataset.filt] = t.value; renderDecisions(); return; }
      const tr = t.closest('tr[data-id]');
      if (tr && t.tagName === 'SELECT') {
        const g = S.g20ById[tr.dataset.id];
        if (g.relation === 'over') return;
        pushUndo();
        S.plan.g20[g.id].decision = t.value;
        changed(true);
      }
    });
    el.addEventListener('input', (ev) => { if (ev.target.dataset.filt === 'q') { UI.filt.q = ev.target.value; renderDecisions(); } });
    el.addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-id]');
      if (!tr || ev.target.tagName === 'SELECT' || ev.target.tagName === 'OPTION') return;
      UI.sel = { g20: tr.dataset.id, wb: null, anchor: null, part: null };
      UI.selConflict = null;
      revealInTree();
      zoomTo(S.g20ById[tr.dataset.id].bbox, 120);
      needTree = true;
      panelsDirty = true;
      requestRender();
    });
  }

  function renderConflicts() {
    const el = $('#tab-conflicts');
    const list = UI.conflicts.filter((c) => UI.sevShow[c.severity]);
    el.innerHTML = '<div class="filters">' + ['error', 'warning', 'info'].map((s) => '<label class="chk"><input type="checkbox" data-sev="' + s + '"' + (UI.sevShow[s] ? ' checked' : '') + '> <span class="sev ' + s + '">' + s + '</span> ' + UI.conflicts.filter((c) => c.severity === s).length + '</label>').join(' ') + '</div>' +
      '<p class="muted">Live, per README §3; shapes rasterised at 1 px (masks at alpha ≥ 64, polygons, else bboxes). % is of the G20 element\'s area. stockMap: ' + (S.settings.stockMap ? 'on' : 'off') + '. Last pass ' + (OC.lastConflictMs || 0).toFixed(1) + ' ms. Click a row to select both and zoom.</p>' + conflictRows(list, true);
  }
  function setupConflicts() {
    const el = $('#tab-conflicts');
    el.addEventListener('change', (ev) => { if (ev.target.dataset.sev) { UI.sevShow[ev.target.dataset.sev] = ev.target.checked; renderConflicts(); } });
    el.addEventListener('click', (ev) => { const tr = ev.target.closest('tr.click'); if (tr) clickConflict(UI.conflicts[+tr.dataset.i]); });
  }

  function renderHoles() {
    const el = $('#tab-holes');
    const hs = OC.holeList();
    el.innerHTML = '<div class="form"><label>default margin ' + num('dm', S.settings.holeMargin, 1, ' data-h="dm"') + '</label> <label>radius ' + num('dr', S.settings.holeRadius, 1, ' data-h="dr"') + '</label> <button data-a="apply-def">apply to non-edited holes</button></div>' +
      '<p class="muted">One hole per <b>reveal</b>: the element bbox plus margin (outward to whole px), with a corner radius. They are cut out of every 6WB background in the preview and in the conflict shapes. Editing the rect marks a hole "edited" so it is no longer re-derived.</p>' +
      (hs.length ? hs.map((h) => '<div class="hole" data-g="' + esc(h.gid) + '"><div><b>hole.' + esc(h.gid) + '</b>' + (h.edited ? ' <span class="muted">(edited)</span>' : '') + ' <button data-a="zoom">zoom</button> <button data-a="reset">re-derive</button></div>' +
        '<div class="form">rect ' + [0, 1, 2, 3].map((i) => num('r' + i, h.rect[i], 1, ' data-h="rect"')).join('') + '</div><div class="form"><label>margin ' + num('m', h.margin, 1, ' data-h="margin"') + '</label> <label>radius ' + num('rad', h.radius, 1, ' data-h="radius" min="0"') + '</label></div></div>').join('') : '<p class="muted">No reveal decisions, so no holes.</p>');
  }
  function setupHoles() {
    const el = $('#tab-holes');
    el.addEventListener('change', (ev) => {
      const t = ev.target;
      const k = t.dataset.h;
      if (!k) return;
      const v = parseFloat(t.value);
      if (!isFinite(v)) return;
      if (k === 'dm') { S.settings.holeMargin = v; autosave(); return; }
      if (k === 'dr') { S.settings.holeRadius = Math.max(0, v); autosave(); return; }
      const box = t.closest('.hole');
      const g = S.g20ById[box.dataset.g];
      const h = S.plan.holes[g.id];
      pushUndo();
      if (k === 'margin') { h.margin = v; if (!h.edited) h.rect = OC.deriveHoleRect(g, v); }
      else if (k === 'radius') h.radius = Math.max(0, v);
      else if (k === 'rect') {
        const vs = [0, 1, 2, 3].map((i) => parseFloat(box.querySelector('[data-f=r' + i + ']').value));
        if (vs.every(isFinite) && vs[2] > vs[0] && vs[3] > vs[1]) { h.rect = vs; h.edited = true; }
      }
      changed(true);
    });
    el.addEventListener('click', (ev) => {
      const a = ev.target.dataset.a;
      if (!a) return;
      if (a === 'apply-def') {
        pushUndo();
        for (const gid of Object.keys(S.plan.holes)) { const h = S.plan.holes[gid]; if (!h.edited) { h.margin = S.settings.holeMargin; h.radius = S.settings.holeRadius; h.rect = OC.deriveHoleRect(S.g20ById[gid], h.margin); } }
        changed(true);
        return;
      }
      const box = ev.target.closest('.hole');
      const g = S.g20ById[box.dataset.g];
      const h = S.plan.holes[g.id];
      if (a === 'zoom') { UI.sel = { g20: g.id, wb: null, anchor: null, part: null }; zoomTo(h.rect, 120); needTree = true; panelsDirty = true; }
      if (a === 'reset') { pushUndo(); h.edited = false; h.rect = OC.deriveHoleRect(g, h.margin); changed(true); }
    });
  }

  function renderPlanTab() {
    const el = $('#tab-plan');
    const D = S.data;
    el.innerHTML = '<h4>Data</h4><dl class="kv"><dt>dataset</dt><dd>' + DATASET + ' <a href="?data=' + (DATASET === 'sample' ? 'real' : 'sample') + '">switch to ' + (DATASET === 'sample' ? 'real' : 'sample') + '</a></dd>' +
      '<dt>G20</dt><dd>' + esc(D.files.g20) + ', ' + D.g20.length + ' elements<br><code>' + esc(D.sha.g20 || '—') + '</code></dd>' +
      '<dt>6WB</dt><dd>' + esc(D.files.wb) + ', ' + D.wb.length + ' elements, ' + Object.keys(D.anchors).length + ' anchors, ' + Object.keys(S.masks).length + ' masks<br><code>' + esc(D.sha.wb || '—') + '</code></dd>' +
      '<dt>photos</dt><dd>' + (Object.keys(OC.photos).filter((k) => OC.photos[k].img).join(', ') || 'none available') + '</dd></dl>' +
      '<h4>Settings</h4><label class="chk"><input type="checkbox" data-p="stockMap"' + (S.settings.stockMap ? ' checked' : '') + '> stockMap: the background\'s own map hole (WBBACK <code>holeWhen</code>)</label><p class="muted">Saved in plan.json <code>settings.stockMap</code>; also <code>?stockMap=1</code>.</p>' +
      '<h4>Plan</h4><dl class="kv"><dt>version</dt><dd>' + (S.plan.version || 0) + ' (the next save writes ' + ((S.plan.version || 0) + 1) + ')</dd><dt>holes</dt><dd>' + OC.holeList().length + '</dd><dt>keep-clear</dt><dd>' + D.g20.filter((g) => g.relation === 'over').length + '</dd><dt>moves</dt><dd>' + Object.keys(S.plan.wb).length + ' elements, ' + Object.keys(S.plan.anchors).length + ' anchors</dd></dl>' +
      '<div class="form"><button data-a="save">Save plan.json</button> <button data-a="load">Load plan.json…</button> <button data-a="defaults">Reset to default decisions</button></div>' +
      '<p class="muted">The downloaded file is the source of truth. The browser also autosaves the working state (localStorage, this dataset only) as a convenience. ' + (UI.autosaveNote || '') + '</p>' +
      '<h4>Load messages</h4>' + (UI.loadMsgs.length ? '<ul class="msgs">' + UI.loadMsgs.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul>' : '<p class="muted">none</p>') + keysHelp();
  }
  function setupPlanTab() {
    const el = $('#tab-plan');
    el.addEventListener('change', (ev) => { if (ev.target.dataset.p === 'stockMap') setStockMap(ev.target.checked); });
    el.addEventListener('click', (ev) => {
      const a = ev.target.dataset.a;
      if (a === 'save') savePlan();
      else if (a === 'load') $('#planfile').click();
      else if (a === 'defaults') {
        pushUndo();
        for (const g of S.data.g20) S.plan.g20[g.id] = { decision: OC.defaultDecision(g), notes: (S.plan.g20[g.id] && S.plan.g20[g.id].notes) || '', redraw_at: null };
        changed(true);
      }
    });
  }
  function setStockMap(v) {
    S.settings.stockMap = !!v;
    $('#c-stockmap').checked = S.settings.stockMap;
    OC.clearSprites();
    changed(false);
  }

  // ---------------- save / load ----------------
  function savePlan() {
    if (!S.plan) return;
    const plan = OC.buildPlanFile(UI.conflicts);
    S.plan.version = plan.version;
    const blob = new Blob([JSON.stringify(plan, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'plan.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    banner('info', 'Saved <b>plan.json</b> version ' + plan.version + ' (' + plan.conflicts.length + ' conflicts). Put it in <code>design/overlay/</code> to share it.');
    autosave();
    panelsDirty = true;
    requestRender();
  }
  function setupLoad() {
    $('#planfile').addEventListener('change', async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      let doc;
      try { doc = JSON.parse(await f.text()); } catch (e) { banner('error', 'Could not load <b>' + esc(f.name) + '</b>: not valid JSON (' + esc(e.message) + ')'); return; }
      const snap = OC.snapshot();
      const ver = S.plan.version;
      const r = OC.applyPlanFile(doc);
      if (r.errs.length) { banner('error', 'Could not load <b>' + esc(f.name) + '</b> as a plan:', r.errs); return; }
      hist.undo.push(snap);
      hist.redo.length = 0;
      void ver;
      OC.clearSprites();
      setStockMap(S.settings.stockMap);
      banner(r.warns.length ? 'warn' : 'info', 'Loaded <b>' + esc(f.name) + '</b>, plan version ' + S.plan.version + '.', r.warns);
      changed(true);
    });
  }

  // ---------------- autosave ----------------
  const AKEY = 'overlay-constructor:v1:' + DATASET;
  let asTimer = 0;
  function autosave() {
    if (EXPORT) return;
    clearTimeout(asTimer);
    asTimer = setTimeout(() => {
      try {
        localStorage.setItem(AKEY, JSON.stringify({ sha: S.data.sha, plan: S.plan, settings: S.settings, at: new Date().toISOString() }));
      } catch (e) { /* storage unavailable: fine */ }
    }, 400);
  }
  function restoreAutosave() {
    try {
      const raw = localStorage.getItem(AKEY);
      if (!raw) return false;
      const o = JSON.parse(raw);
      if (!o || !o.plan || !o.sha || o.sha.g20 !== S.data.sha.g20 || o.sha.wb !== S.data.sha.wb) {
        UI.autosaveNote = 'An autosave exists for different data files and was not used.';
        return false;
      }
      const P = o.plan;
      for (const g of S.data.g20) if (!P.g20[g.id]) P.g20[g.id] = { decision: OC.defaultDecision(g), notes: '', redraw_at: null };
      for (const g of S.data.g20) if (g.relation === 'over') P.g20[g.id].decision = 'keep-clear';
      S.plan = { g20: P.g20, wb: P.wb || {}, anchors: P.anchors || {}, holes: P.holes || {}, version: P.version || 0 };
      if (o.settings) Object.assign(S.settings, o.settings);
      UI.autosaveNote = 'Restored the autosave from ' + (o.at || '?') + '.';
      return true;
    } catch (e) {
      return false;
    }
  }

  function updateStatus() {
    const el = $('#counts');
    if (!el) return;
    const sum = { error: 0, warning: 0, info: 0 };
    for (const c of UI.conflicts) sum[c.severity]++;
    el.innerHTML = 'zoom ' + Math.round(V.s * 100) + '%  ·  conflicts <span class="sev error">' + sum.error + '</span> <span class="sev warning">' + sum.warning + '</span> <span class="sev info">' + sum.info + '</span>' + (consoleErrors ? '  ·  <span class="sev error">' + consoleErrors + ' console error(s)</span>' : '');
    $('#zoom').textContent = Math.round(V.s * 100) + '%';
  }

  // ---------------- top bar ----------------
  function setupTop() {
    $('#b-fit').onclick = fit;
    $('#b-11').onclick = oneToOne;
    $('#b-zin').onclick = () => zoomAt(1.25, V.cw / 2, V.ch / 2);
    $('#b-zout').onclick = () => zoomAt(0.8, V.cw / 2, V.ch / 2);
    $('#b-undo').onclick = undo;
    $('#b-redo').onclick = redo;
    $('#b-save').onclick = savePlan;
    $('#b-load').onclick = () => $('#planfile').click();
    document.querySelectorAll('#pick button').forEach((b) => (b.onclick = () => setPick(b.dataset.p)));
    $('#c-snapgrid').onchange = (e) => (UI.snapGrid = e.target.checked);
    $('#n-grid').onchange = (e) => (UI.gridStep = Math.max(1, parseFloat(e.target.value) || 10));
    $('#c-snapedge').onchange = (e) => (UI.snapEdges = e.target.checked);
    $('#c-labels').onchange = (e) => { UI.labels = e.target.checked; requestRender(); };
    $('#c-stockmap').onchange = (e) => setStockMap(e.target.checked);
    $('#s-crop').onchange = (e) => { UI.cropPhoto = e.target.value || null; requestRender(); };
    document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.t)));
    $('#c-labels').checked = UI.labels;
    // G20 parts: render, look, theme, lamps (docs/G20SIM-REPORT.md section 2)
    $('#s-g20mode').onchange = (e) => { setG20Texture(e.target.value === 'texture'); };
    $('#s-look').onchange = (e) => setPartsG({ look: e.target.value });
    $('#s-conn').onchange = (e) => setPartsG({ conn: e.target.value === '1' });
    $('#s-lamps').onchange = (e) => setPartsG({ lamps: e.target.value });
  }
  function setPartsG(o) {
    Object.assign(OC.P.G, o);
    OC.clearPartCache();
    syncPartsControls();
    needTree = true;
    panelsDirty = true;
    requestRender();
  }
  function syncPartsControls() {
    const G = OC.P.G;
    $('#s-look').value = G.look;
    $('#s-conn').value = G.conn ? '1' : '0';
    $('#s-lamps').value = G.lamps;
    $('#s-g20mode').value = OC.g20Root && OC.g20Root.mode === 'texture' ? 'texture' : '';
    for (const id of ['#s-look', '#s-conn', '#s-lamps', '#s-g20mode']) $(id).disabled = !OC.P.ok;
  }
  // texture mode for the whole G20 stock branch: the groups' own defaults (the faint structure ghost) step aside
  function setG20Texture(on) {
    const R = OC.g20Root;
    if (!R) return;
    R.mode = on ? 'texture' : null;
    for (const g of R.children) {
      if (g.type !== 'g20group') continue;
      if (!g._def) g._def = { mode: g.mode, opacity: g.opacity };
      g.mode = on ? null : g._def.mode;
      g.opacity = on ? 1 : g._def.opacity;
    }
    syncPartsControls();
    needTree = true;
    requestRender();
  }
  OC.setG20Texture = setG20Texture;

  // ---------------- loading ----------------
  async function loadAssets(D) {
    const warns = [];
    const jobs = D.wb.filter((e) => e.mask);
    let i = 0;
    const worker = async () => {
      while (i < jobs.length) {
        const e = jobs[i++];
        const m = await OC.loadMask(e.mask);
        if (!m) { warns.push(e.id + ': mask ' + e.mask + ' could not be loaded; its bbox is used'); continue; }
        const bw = Math.round(e.bbox[2] - e.bbox[0]);
        const bh = Math.round(e.bbox[3] - e.bbox[1]);
        if (m.w !== bw || m.h !== bh) warns.push(e.id + ': mask is ' + m.w + '×' + m.h + ' but bbox is ' + bw + '×' + bh + '; stretched to the bbox');
        S.masks[e.id] = m;
      }
    };
    const sch = D.g20.filter((g) => g.schematic).map(async (g) => {
      const im = await OC.loadImage(OC.ROOT + g.schematic);
      if (im) S.schematics[g.id] = im;
      else warns.push(g.id + ': schematic ' + g.schematic + ' could not be loaded');
    });
    const photos = (async () => {
      const idx = EXPORT ? null : await OC.loadPhotoIndex();
      const ids = idx ? Object.keys(idx).filter((k) => /^\d\d$/.test(k)).sort() : [];
      const all = Array.from(new Set(['08', '09', '10', '11', '12', '13', '14'].concat(ids))).sort();
      await Promise.all(all.map(async (id) => {
        if (!ids.includes(id)) { OC.photos[id] = { img: null, title: 'not available (bake/work/overlay/rect/H.json does not list it)' }; return; }
        const im = await OC.loadImage(OC.ROOT + 'bake/work/overlay/rect/' + id + '.png');
        const h = idx[id] || {};
        OC.photos[id] = { img: im, title: (im ? 'bake/work/overlay/rect/' + id + '.png' : 'listed but not loadable') + (h.rms_panel_px != null ? ', rms ' + h.rms_panel_px + ' px' : '') + (h.usable_for_geometry === false ? ', not usable for geometry: ' + (h.reason || '') : '') };
      }));
      return all;
    })();
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker(), Promise.all(sch)]);
    const ids = await photos;
    return { warns, photoIds: ids };
  }

  async function init() {
    if (UI.shot) document.body.classList.add('shot');
    setupTop();
    setupCanvas();
    setupKeys();
    setupTree();
    setupInspector();
    setupDecisions();
    setupConflicts();
    setupHoles();
    setupPlanTab();
    setupLoad();
    window.addEventListener('resize', () => { resize(); if (UI.viewBox) zoomTo(UI.viewBox, 10); else fit(); });
    resize();
    fit();
    $('#dataset').textContent = DATASET === 'sample' ? 'SAMPLE data' : DATASET === 'custom' ? 'custom: ' + DIR : 'real data';
    $('#dataset').className = 'ds ' + DATASET;
    const D = await OC.loadData(DATASET, DIR);
    S.data = D;
    D.g20.forEach((g, i) => { S.g20ById[g.id] = g; S.g20Index[g.id] = i; });
    D.wb.forEach((e, i) => { S.wbById[e.id] = e; S.wbIndex[e.id] = i; });
    UI.loadMsgs = D.errs.concat(D.warns);
    const fatal = !D.g20doc || !D.wbdoc;
    if (D.errs.length) banner('error', fatal ? '<b>Data could not be loaded.</b> The canvas shows the panel only. Fix the file(s) below, or try the <a href="?data=sample">sample data</a>.' : '<b>Some elements were skipped</b> because they are invalid:', D.errs);
    if (D.warns.length) banner('warn', 'Loaded with ' + D.warns.length + ' warning(s).', D.warns);
    if (DATASET !== 'sample' && !fatal && !D.g20.length && !D.wb.length) banner('info big', 'The real files <code>' + esc(D.files.g20) + '</code> and <code>' + esc(D.files.wb) + '</code> have <b>no elements yet</b> (packages C, E and F fill them). <a class="btn" href="?data=sample">Open the sample data</a>');
    else if (DATASET !== 'sample' && !fatal && (!D.g20.length || !D.wb.length)) banner('info', (D.g20.length ? 'The 6WB file' : 'The G20 file') + ' has no elements yet. <a href="?data=sample">Open the sample data</a>');
    if (DATASET === 'sample') banner('info', 'Showing the hand-made <b>sample</b> data (<code>design/overlay/sample/</code>). <a href="?data=real">Real data</a>');
    const A = await loadAssets(D);
    if (A.warns.length) { UI.loadMsgs.push(...A.warns); banner('warn', A.warns.length + ' mask/schematic file(s) missing; bboxes are used instead.', A.warns); }
    // the G20 parts (real data only; not needed to export a plan)
    if (DATASET === 'real' && !EXPORT) {
      const G = OC.P.G;
      if (Q.get('look') === 'day' || Q.get('look') === 'night') G.look = Q.get('look');
      if (Q.get('conn') === '0' || Q.get('conn') === '1') G.conn = Q.get('conn') === '1';
      if (['startup', 'driving', 'all'].includes(Q.get('lamps'))) G.lamps = Q.get('lamps');
      const PR = await OC.loadParts();
      if (PR.warns.length) { UI.loadMsgs.push(...PR.warns); banner(OC.P.ok ? 'warn' : 'info', OC.P.ok ? 'G20 parts loaded with ' + PR.warns.length + ' problem(s); the parts concerned are marked and fall back to the schematic.' : 'G20 parts not shown: ' + esc(OC.P.why), PR.warns); }
    } else if (DATASET !== 'real') OC.P.why = 'the G20 parts belong to the real data';
    const avail = A.photoIds.filter((id) => OC.photos[id].img);
    UI.cropPhoto = avail.includes('08') ? '08' : avail[0] || null;
    $('#s-crop').innerHTML = avail.length ? avail.map((id) => '<option' + (id === UI.cropPhoto ? ' selected' : '') + '>' + id + '</option>').join('') : '<option value="">none</option>';
    $('#s-crop').disabled = !avail.length;
    OC.buildTree(A.photoIds);
    if (Q.get('photo') === 'none') for (const id of A.photoIds) { const n = OC.nodeOf['photo:' + id]; if (n) n.show = false; }
    syncPartsControls();
    if (OC.P.ok) {
      if (Q.get('g20mode') === 'texture') setG20Texture(true);
      if (Q.get('ours') === '1' && OC.oursRoot) { OC.oursRoot.show = true; OC.oursRoot.open = true; }
      // ?hide=layout:wb_dials,g20:map.region: hide those tree nodes
      for (const k of (Q.get('hide') || '').split(',').filter(Boolean)) {
        const n = OC.nodeOf[k] || (k.startsWith('layout:') && OC.oursRoot ? OC.oursRoot.children.find((c) => c.ref === k) : null);
        if (n) { const off = (m) => { m.show = false; if (m.children) m.children.forEach(off); }; off(n); }
      }
      // ?open=g20:structure.speedo,group:telltale,ours: open those tree branches
      for (const k of (Q.get('open') || '').split(',').filter(Boolean)) {
        let n = OC.nodeOf[k];
        if (!n && k.startsWith('group:')) n = (OC.g20Root.children || []).find((c) => c.ref === k.slice(6));
        if (!n && k === 'ours') n = OC.oursRoot;
        if (!n && k.startsWith('layout:') && OC.oursRoot) n = OC.oursRoot.children.find((c) => c.ref === k);
        if (!n) continue;
        for (let a = n; a; a = a.parent) a.open = true;
        if (k.startsWith('group:') || k === 'ours') { const all = (m) => { if (m.children) { m.open = true; m.children.forEach(all); } }; all(n); }
      }
    }
    OC.newPlan();
    // ?plan=design/overlay/<name>.json: start from that plan (instead of the autosave)
    const planPath = /^design\/overlay\/[A-Za-z0-9_.-]+\.json$/.test(Q.get('plan') || '') ? Q.get('plan') : null;
    if (Q.get('plan') && !planPath) banner('error', 'Ignored <code>?plan=</code>: only <code>design/overlay/&lt;name&gt;.json</code> is allowed.');
    if (planPath) {
      const raw = await OC.fetchRaw(planPath);
      let r = { errs: [raw.why || 'unreadable'], warns: [] };
      if (raw.ok) {
        try { r = OC.applyPlanFile(JSON.parse(new TextDecoder().decode(raw.buf))); } catch (e) { r = { errs: ['not valid JSON (' + e.message + ')'], warns: [] }; }
      }
      if (r.errs.length) { banner('error', 'Could not load <b>' + esc(planPath) + '</b> as a plan:', r.errs); UI.planErrs = r.errs; }
      else banner(r.warns.length ? 'warn' : 'info', 'Loaded <b>' + esc(planPath) + '</b>, plan version ' + S.plan.version + '.', r.warns);
    } else if (!EXPORT && Q.get('fresh') !== '1') restoreAutosave();
    if (Q.get('stockMap') != null) S.settings.stockMap = Q.get('stockMap') === '1';
    $('#c-stockmap').checked = S.settings.stockMap;
    OC.syncHoles();
    $('#loading').remove();
    const wantTab = UI.tab;
    const sel = Q.get('sel');
    if (sel) select(S.g20ById[sel] ? { g20: sel } : S.wbById[sel] ? { wb: sel } : D.anchors[sel] ? { anchor: sel } : OC.P.byId[sel] ? { part: sel } : {});
    const vw = (Q.get('view') || '').split(',').map(Number);
    if (vw.length === 4 && vw.every(isFinite) && vw[2] > vw[0] && vw[3] > vw[1]) { UI.viewBox = vw; zoomTo(vw, 10); }
    else fit();
    setTab(wantTab);
    needTree = true;
    changed(true);
    if (EXPORT) exportDefault(fatal);
    if (Q.get('probe') === 'parts') {
      const pre = document.createElement('pre');
      pre.id = 'probe-dump';
      pre.hidden = true;
      pre.textContent = OC.P.ok ? JSON.stringify(OC.probeParts()) : JSON.stringify({});
      document.body.appendChild(pre);
      document.title = 'probe-done';
    }
    if (Q.get('selftest')) {
      const sc = document.createElement('script');
      sc.src = 'selftest.js';
      document.body.appendChild(sc);
    }
  }
  OC.hist = hist;
  OC.internals = { undo, redo, select, target, tplan, targetBox, fit, setTab, setStockMap, savePlan, setPartsG, setG20Texture, renderTree, partTags, frame: () => frame(), get conflicts() { return UI.conflicts; } };

  function exportDefault(fatal) {
    const out = $('#plan-dump');
    if (fatal) {
      out.textContent = JSON.stringify({ error: S.data.errs }, null, 2);
      document.title = 'plan-error';
      return;
    }
    if (EXPORT !== 'default' && EXPORT !== 'safe' && EXPORT !== 'plan') {
      out.textContent = JSON.stringify({ error: ['unknown export ' + EXPORT + ' (only "default", "safe" or "plan")'] });
      document.title = 'plan-error';
      return;
    }
    if (EXPORT === 'plan') {
      // "plan": the plan given by ?plan=, with its conflicts recomputed
      if (!Q.get('plan') || UI.planErrs) {
        out.textContent = JSON.stringify({ error: UI.planErrs || ['export=plan needs ?plan=design/overlay/<name>.json'] });
        document.title = 'plan-error';
        return;
      }
      OC.syncHoles();
      const conflicts = OC.computeConflicts();
      UI.conflicts = conflicts;
      out.textContent = JSON.stringify(OC.buildPlanFile(conflicts, { version: S.plan.version || 1, noTime: true }), null, 2);
      document.title = 'plan-ready';
      return;
    }
    OC.newPlan();
    // "safe": the default plan, but a critical element whose relation is unknown is revealed (it may be under)
    if (EXPORT === 'safe') for (const g of S.data.g20) if (g.safety === 'critical' && g.relation === 'unknown') S.plan.g20[g.id].decision = 'reveal';
    OC.syncHoles();
    const conflicts = OC.computeConflicts();
    UI.conflicts = conflicts;
    const plan = OC.buildPlanFile(conflicts, { version: 1, noTime: true });
    out.textContent = JSON.stringify(plan, null, 2);
    document.title = 'plan-ready';
  }

  UI.loadMsgs = [];
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.OC);
