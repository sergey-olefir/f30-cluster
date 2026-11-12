// Overlay constructor: the layer tree model and canvas rendering.
'use strict';
(function (OC) {
  const S = OC.S;
  const W = OC.PANEL_W;
  const H = OC.PANEL_H;

  // View: screen = V.x + V.s * panel (CSS px). Rulers take RUL px at the top and left.
  const V = (OC.V = { s: 0.5, x: 0, y: 0, dpr: 1, cw: 0, ch: 0 });
  const RUL = (OC.RUL = 18);

  // ---------------- layer tree ----------------
  let nid = 0;
  function node(label, type, ref, parent, o) {
    const isGroup = ['root', 'group', 'g20group', 'anchor', 'cluster'].includes(type);
    const n = Object.assign({ key: 'n' + nid++, label, type, ref, parent, children: isGroup ? [] : null, show: true, solo: false, lock: false, opacity: 1, mode: null, open: false, avail: true }, o || {});
    if (parent) (parent.children = parent.children || []).push(n);
    return n;
  }
  OC.tree = null;
  OC.nodeOf = {}; // 'g20:<id>' / 'wb:<id>' / 'anchor:<id>' / 'photo:<id>' / 'panel:<k>' / 'ov:<k>' -> node

  OC.buildTree = function (photoIds) {
    nid = 0;
    const T = node('root', 'root', null, null, { open: true });
    const idx = OC.nodeOf = {};
    const ov = node('Plan overlays', 'group', 'ov', T, { open: false });
    for (const [k, l] of [['conflict', 'Selected conflict'], ['holes', 'Holes (reveal)'], ['keepclear', 'Keep-clear boxes (over)'], ['redraw', 'Redraw spots']]) idx['ov:' + k] = node(l, 'ov', k, ov);
    const panel = node('Panel', 'group', 'panel', T, { open: false });
    for (const [k, l, show] of [['hood', 'Hood mask', true], ['visible', 'Visible area', true], ['BLACK_BOX', 'BLACK_BOX', true], ['BELT', 'BELT', true], ['GEAR', 'GEAR', true], ['grid', 'Calibration grid', false]]) idx['panel:' + k] = node(l, 'panel', k, panel, { show });
    const g20 = (OC.g20Root = node('G20 stock', 'group', 'g20', T, { open: true }));
    const groups = {};
    for (const g of S.data.g20) {
      const gk = g.group || '(no group)';
      // the stock dials are context only: a faint outline ghost by default
      if (!groups[gk]) groups[gk] = node(gk, 'g20group', gk, g20, gk === 'structure' ? { opacity: 0.45, mode: 'outline' } : null);
      idx['g20:' + g.id] = node(g.id, 'g20', g.id, groups[gk], { title: g.name || '' });
    }
    const wb = (OC.wbRoot = node('6WB', 'group', 'wb', T, { open: true, opacity: 0.6 }));
    const anchorIds = Object.keys(S.data.anchors);
    const byAnchor = {};
    const zmax = {};
    for (const e of S.data.wb) {
      const a = e.anchor || '';
      (byAnchor[a] = byAnchor[a] || []).push(e);
      zmax[a] = Math.max(zmax[a] == null ? -1e9 : zmax[a], e.z);
    }
    const aorder = anchorIds.filter((a) => byAnchor[a]).concat(byAnchor[''] ? [''] : []).concat(anchorIds.filter((a) => !byAnchor[a]));
    for (const a of aorder) {
      const an = node(a ? 'anchor ' + a : '(no anchor)', 'anchor', a || null, wb);
      if (a) idx['anchor:' + a] = an;
      const els = (byAnchor[a] || []).slice();
      const byCl = {};
      for (const e of els) (byCl[e.cluster || 'live'] = byCl[e.cluster || 'live'] || []).push(e);
      const cls = Object.keys(byCl).sort((p, q) => Math.max(...byCl[q].map((e) => e.z)) - Math.max(...byCl[p].map((e) => e.z)));
      for (const c of cls) {
        const cn = node(c, 'cluster', c, an);
        for (const e of byCl[c].sort((p, q) => q.z - p.z)) {
          // big bbox-only shapes (live dial widgets) default to outline so they do not hide the dial art
          const big = !e.mask && e.kind !== 'background' && (e.bbox[2] - e.bbox[0]) * (e.bbox[3] - e.bbox[1]) > 40000;
          idx['wb:' + e.id] = node(e.id, 'wb', e.id, cn, { opacity: e.kind === 'background' ? 0.5 : 1, mode: big ? 'outline' : null, title: e.kind + (e.mask ? '' : ', no mask: bbox') + (e.notes ? ': ' + e.notes : '') });
        }
      }
    }
    const ph = node('Photos', 'group', 'photos', T, { open: true });
    let first = true;
    for (const id of photoIds) {
      const p = OC.photos[id];
      idx['photo:' + id] = node('rect ' + id, 'photo', id, ph, { show: !!(p && p.img && first), avail: !!(p && p.img), opacity: 0.75, title: p ? p.title : 'not available' });
      if (p && p.img) first = false;
    }
    OC.tree = T;
    return T;
  };

  OC.leaves = function (n, out) {
    out = out || [];
    if (!n.children) out.push(n);
    else for (const c of n.children) OC.leaves(c, out);
    return out;
  };
  let anySolo = false;
  OC.refreshSolo = () => { anySolo = OC.leaves(OC.tree).some((l) => soloed(l)) || false; };
  function soloed(n) { for (let a = n; a; a = a.parent) if (a.solo) return true; return false; }
  OC.effVisible = function (n) {
    for (let a = n; a; a = a.parent) if (!a.show) return false;
    if (!n.avail) return false;
    if (anySolo && (n.type === 'g20' || n.type === 'wb' || n.type === 'photo') && !soloed(n)) return false;
    return true;
  };
  OC.effOpacity = function (n) { let o = 1; for (let a = n; a; a = a.parent) o *= a.opacity; return o; };
  OC.effLock = function (n) { for (let a = n; a; a = a.parent) if (a.lock) return true; return false; };
  OC.effMode = function (n) { for (let a = n; a; a = a.parent) if (a.mode) return a.mode; return 'fill'; };

  // Draw order, bottom first. The tree is top-first. 6WB leaves follow their (plan) z.
  // 'over' G20 elements always end above every 6WB leaf (BMW draws them on top of any custom theme).
  OC.drawOrder = function () {
    const out = [];
    const walk = (n) => {
      if (!n.children) return out.push(n);
      if (n === OC.wbRoot) {
        const ls = OC.leaves(n).sort((a, b) => OC.wbZ(S.wbById[a.ref]) - OC.wbZ(S.wbById[b.ref]) || S.wbIndex[a.ref] - S.wbIndex[b.ref]);
        for (const l of ls) out.push(l);
        return;
      }
      for (let i = n.children.length - 1; i >= 0; i--) walk(n.children[i]);
    };
    walk(OC.tree);
    let last = -1;
    out.forEach((l, i) => { if (l.type === 'wb') last = i; });
    if (last < 0) return out;
    const lifted = [];
    const keep = [];
    out.forEach((l, i) => {
      if (i < last && l.type === 'g20' && S.g20ById[l.ref].relation === 'over') lifted.push(l);
      else keep.push(l);
    });
    const at = keep.indexOf(out[last]) + 1;
    keep.splice(at, 0, ...lifted);
    return keep;
  };

  // ---------------- colours ----------------
  const NAMED = { red: [229, 57, 53], amber: [255, 179, 0], green: [67, 160, 71], blue: [30, 136, 229], white: [238, 238, 238], grey: [158, 158, 158], cyan: [0, 188, 212], black: [0, 0, 0], multi: [142, 124, 195], unknown: [189, 189, 189] };
  OC.g20Rgb = (g) => (g.colour && Array.isArray(g.colour.rgb) ? g.colour.rgb : NAMED[(g.colour && g.colour.name) || 'unknown'] || NAMED.unknown);
  const KIND_RGB = { background: [38, 58, 82], dial: [70, 110, 160], text: [225, 225, 225], icon: [152, 193, 217], needle: [238, 108, 77], sign: [244, 211, 94], arc: [106, 153, 78], hole: [255, 255, 255] };
  OC.wbRgb = (e) => KIND_RGB[e.kind] || [180, 180, 180];
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  OC.rgba = rgba;

  // ---------------- sprites for our elements (cached) ----------------
  const sprites = new Map();
  function holesLocal(e, T) {
    const b = e.bbox;
    return OC.bgHoles(e, T).map((h) => ({
      rect: [(h.rect[0] - T.tx) / T.s - b[0], (h.rect[1] - T.ty) / T.s - b[1], (h.rect[2] - T.tx) / T.s - b[0], (h.rect[3] - T.ty) / T.s - b[1]],
      radius: h.radius / T.s,
    }));
  }
  function rrPath(c, r) {
    const [x0, y0, x1, y1] = r.rect;
    const R = Math.min(r.radius || 0, (x1 - x0) / 2, (y1 - y0) / 2);
    c.beginPath();
    if (c.roundRect) c.roundRect(x0, y0, x1 - x0, y1 - y0, R);
    else c.rect(x0, y0, x1 - x0, y1 - y0);
  }
  OC.rrPath = rrPath;
  // kind: 'fill' or 'edge'. Returns a canvas covering e.bbox in source px (mask size when there is a mask), or null for plain rects.
  function wbSprite(e, kind, T) {
    const mk = S.masks[e.id];
    const bg = e.kind === 'background';
    const hl = bg ? holesLocal(e, T) : [];
    if (!mk && !hl.length) return null;
    const key = e.id + '|' + kind + '|' + (mk ? 'm' : 'b') + '|' + hl.map((h) => h.rect.map((v) => v.toFixed(1)).join(',') + 'r' + h.radius.toFixed(1)).join(';');
    let c = sprites.get(key);
    if (c) return c;
    const b = e.bbox;
    const bw = Math.round(b[2] - b[0]);
    const bh = Math.round(b[3] - b[1]);
    c = document.createElement('canvas');
    const w = mk ? mk.w : bw;
    const h = mk ? mk.h : bh;
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    const col = OC.wbRgb(e);
    if (mk) {
      const id = x.createImageData(w, h);
      const d = id.data;
      for (let i = 0; i < w * h; i++) {
        let a = mk.alpha[i];
        if (kind === 'edge') {
          if (!mk.bin[i]) continue;
          const px = i % w;
          const py = (i / w) | 0;
          const edge = px === 0 || py === 0 || px === w - 1 || py === h - 1 || !mk.bin[i - 1] || !mk.bin[i + 1] || !mk.bin[i - w] || !mk.bin[i + w];
          if (!edge) continue;
          a = 255;
        }
        d[4 * i] = col[0]; d[4 * i + 1] = col[1]; d[4 * i + 2] = col[2]; d[4 * i + 3] = a;
      }
      x.putImageData(id, 0, 0);
    } else if (kind === 'fill') {
      x.fillStyle = rgba(col, 1);
      x.fillRect(0, 0, w, h);
    } else {
      x.strokeStyle = rgba(col, 1);
      x.lineWidth = 2;
      x.strokeRect(1, 1, w - 2, h - 2);
    }
    if (hl.length) {
      const sx = w / bw;
      const sy = h / bh;
      x.save();
      x.scale(sx, sy);
      x.globalCompositeOperation = 'destination-out';
      for (const r of hl) { rrPath(x, r); x.fill(); }
      if (kind === 'edge') {
        x.globalCompositeOperation = 'source-over';
        x.strokeStyle = rgba(col, 1);
        x.lineWidth = 2;
        for (const r of hl) { rrPath(x, r); x.stroke(); }
      }
      x.restore();
    }
    if (sprites.size > 600) sprites.clear();
    sprites.set(key, c);
    return c;
  }
  OC.clearSprites = () => sprites.clear();

  // ---------------- drawing helpers ----------------
  function panelXf(ctx) { ctx.setTransform(V.dpr * V.s, 0, 0, V.dpr * V.s, V.dpr * V.x, V.dpr * V.y); }
  OC.panelXf = panelXf;
  function screenXf(ctx) { ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0); }
  OC.screenXf = screenXf;
  const sx = (x) => V.x + V.s * x;
  const sy = (y) => V.y + V.s * y;
  OC.toScreen = (x, y) => [sx(x), sy(y)];
  OC.toPanel = (X, Y) => [(X - V.x) / V.s, (Y - V.y) / V.s];

  function g20Path(ctx, g) {
    ctx.beginPath();
    if (g.poly) {
      g.poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
    } else ctx.rect(g.bbox[0], g.bbox[1], g.bbox[2] - g.bbox[0], g.bbox[3] - g.bbox[1]);
  }
  const DASH = { over: [], under: [6, 4], gone: [2, 3], unknown: [8, 3, 2, 3] };

  function lockIcon(ctx, X, Y) {
    screenXf(ctx);
    ctx.fillStyle = '#ffd54f';
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(X + 5, Y + 4, 3, Math.PI, 0);
    ctx.stroke();
    ctx.fillRect(X + 1, Y + 4, 8, 7);
    ctx.fillStyle = '#000';
    ctx.fillRect(X + 4.5, Y + 6, 1.5, 3);
  }
  OC.lockIconSvg = '<svg class="lock" viewBox="0 0 10 12" width="10" height="12"><path d="M2 5V3.5a3 3 0 0 1 6 0V5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="1" y="5" width="8" height="7" rx="1" fill="currentColor"/></svg>';

  function label(ctx, text, x, y, col) {
    screenXf(ctx);
    ctx.font = '11px ui-monospace, Menlo, monospace';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x, y - 12, w + 6, 14);
    ctx.fillStyle = col || '#ddd';
    ctx.fillText(text, x + 3, y - 1);
  }
  OC.label = label;

  function cropPhoto() {
    const p = OC.photos[OC.ui.cropPhoto];
    return p && p.img ? p.img : null;
  }

  function drawG20(ctx, g, mode, op) {
    const col = OC.g20Rgb(g);
    const dark = col[0] + col[1] + col[2] < 60;
    const stroke = dark ? [200, 200, 200] : col;
    panelXf(ctx);
    g20Path(ctx, g);
    const sch = S.schematics[g.id];
    if (mode === 'photo' && cropPhoto()) {
      ctx.save();
      ctx.clip();
      ctx.globalAlpha = op;
      ctx.drawImage(cropPhoto(), 0, 0, W, H);
      ctx.restore();
      ctx.globalAlpha = 1;
      g20Path(ctx, g);
    } else if (mode === 'diff') {
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = rgba(dark ? [255, 255, 255] : col, op);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else if (mode === 'fill') {
      if (sch) {
        ctx.globalAlpha = op;
        const b = g.bbox;
        ctx.drawImage(sch, b[0], b[1], b[2] - b[0], b[3] - b[1]);
        ctx.globalAlpha = 1;
        g20Path(ctx, g);
      } else {
        ctx.fillStyle = rgba(col, (dark ? 0.75 : 0.42) * op);
        ctx.fill();
      }
    }
    ctx.setLineDash((DASH[g.relation] || []).map((v) => v / V.s));
    ctx.lineWidth = 1.5 / V.s;
    ctx.strokeStyle = rgba(stroke, Math.min(1, op + 0.15));
    ctx.stroke();
    ctx.setLineDash([]);
    const b = g.bbox;
    if (g.relation === 'over' && (b[2] - b[0]) * V.s > 6) lockIcon(ctx, sx(b[2]) - 11, sy(b[1]) + 2);
    if (OC.ui.labels) label(ctx, g.id, sx(b[0]), sy(b[1]) - 1, rgba(stroke, 1));
  }

  function drawWb(ctx, e, mode, op) {
    const T = OC.xf(e);
    const b = e.bbox;
    op *= OC.wbOpacity(e);
    const set = () => ctx.setTransform(V.dpr * V.s * T.s, 0, 0, V.dpr * V.s * T.s, V.dpr * (V.x + V.s * T.tx), V.dpr * (V.y + V.s * T.ty));
    set();
    const col = OC.wbRgb(e);
    const bw = b[2] - b[0];
    const bh = b[3] - b[1];
    if (mode === 'outline' || (mode === 'photo' && !cropPhoto())) {
      const sp = wbSprite(e, 'edge', T);
      ctx.globalAlpha = Math.min(1, op + 0.2);
      if (sp) ctx.drawImage(sp, b[0], b[1], bw, bh);
      else { ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = 1.5 / (V.s * T.s); ctx.strokeRect(b[0], b[1], bw, bh); }
      ctx.globalAlpha = 1;
    } else if (mode === 'photo') {
      // the photo pixels under the element's current (moved) shape
      const sp = wbSprite(e, 'fill', T);
      const tmp = OC._tmp || (OC._tmp = document.createElement('canvas'));
      const w = sp ? sp.width : Math.max(1, Math.round(bw));
      const h = sp ? sp.height : Math.max(1, Math.round(bh));
      tmp.width = w;
      tmp.height = h;
      const t = tmp.getContext('2d');
      const xb = OC.xbox(e, T);
      t.drawImage(cropPhoto(), xb[0], xb[1], xb[2] - xb[0], xb[3] - xb[1], 0, 0, w, h);
      if (sp) { t.globalCompositeOperation = 'destination-in'; t.drawImage(sp, 0, 0); }
      ctx.globalAlpha = op;
      ctx.drawImage(tmp, b[0], b[1], bw, bh);
      ctx.globalAlpha = 1;
    } else {
      const sp = wbSprite(e, 'fill', T);
      if (mode === 'diff') ctx.globalCompositeOperation = 'difference';
      ctx.globalAlpha = mode === 'diff' ? 1 : op;
      if (sp) ctx.drawImage(sp, b[0], b[1], bw, bh);
      else { ctx.fillStyle = rgba(col, 1); ctx.fillRect(b[0], b[1], bw, bh); }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (OC.ui.labels && e.kind !== 'background') {
      const xb = OC.xbox(e, T);
      label(ctx, e.id, sx(xb[0]), sy(xb[3]) + 13, rgba(col, 1));
    }
  }

  function drawPanelItem(ctx, k, op) {
    const C = S.data.constraints;
    panelXf(ctx);
    ctx.lineWidth = 1.5 / V.s;
    if (k === 'hood') {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (const p of C.hood) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(W, 0);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,' + 0.7 * op + ')';
      ctx.fill();
      ctx.beginPath();
      C.hood.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.strokeStyle = 'rgba(255,120,80,' + op + ')';
      ctx.stroke();
    } else if (k === 'visible') {
      const poly = C.visible || C.hood.concat([[W, H], [0, H]]);
      ctx.beginPath();
      poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.setLineDash([10 / V.s, 6 / V.s]);
      ctx.strokeStyle = 'rgba(120,220,120,' + op + ')';
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (k === 'grid') {
      const G = C.geometry;
      ctx.strokeStyle = 'rgba(80,200,120,' + 0.25 * op + ')';
      ctx.lineWidth = 1 / V.s;
      const step = V.s > 3 ? 10 : 50;
      ctx.beginPath();
      for (let x = 0; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = 0; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(80,200,120,' + 0.6 * op + ')';
      ctx.beginPath();
      for (let x = 0; x <= W; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = 0; y <= H; y += 100) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120,255,160,' + 0.8 * op + ')';
      for (const c of [G.speedo_centre, G.tacho_centre]) {
        for (const f of [0.5, 1]) { ctx.beginPath(); ctx.arc(c[0], c[1], G.R * f, 0, 2 * Math.PI); ctx.stroke(); }
        ctx.beginPath();
        ctx.moveTo(c[0] - 12, c[1]); ctx.lineTo(c[0] + 12, c[1]);
        ctx.moveTo(c[0], c[1] - 12); ctx.lineTo(c[0], c[1] + 12);
        ctx.stroke();
      }
    } else {
      const r = C.rects[k];
      const col = { BLACK_BOX: [220, 220, 220], BELT: [255, 80, 80], GEAR: [255, 230, 120] }[k];
      ctx.setLineDash([5 / V.s, 3 / V.s]);
      ctx.strokeStyle = rgba(col, op);
      ctx.strokeRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
      ctx.setLineDash([]);
      if (OC.ui.labels || V.s > 0.9) label(ctx, k, sx(r[0]), sy(r[3]) + 13, rgba(col, op));
    }
  }

  function drawOv(ctx, k, op) {
    panelXf(ctx);
    ctx.lineWidth = 1.5 / V.s;
    if (k === 'holes') {
      for (const h of OC.holeList()) {
        ctx.setLineDash([6 / V.s, 3 / V.s]);
        ctx.strokeStyle = 'rgba(0,229,255,' + op + ')';
        rrPath(ctx, h);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (k === 'keepclear') {
      for (const g of S.data.g20) {
        if (g.relation !== 'over') continue;
        const b = g.bbox;
        ctx.strokeStyle = 'rgba(255,60,60,' + op + ')';
        ctx.strokeRect(b[0] - 1, b[1] - 1, b[2] - b[0] + 2, b[3] - b[1] + 2);
      }
    } else if (k === 'redraw') {
      for (const g of S.data.g20) {
        const p = S.plan.g20[g.id];
        if (!p || p.decision !== 'redraw' || !OC.isBox(p.redraw_at)) continue;
        const b = p.redraw_at;
        ctx.setLineDash([3 / V.s, 3 / V.s]);
        ctx.strokeStyle = 'rgba(120,255,120,' + op + ')';
        ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
        ctx.setLineDash([]);
        label(ctx, 'redraw ' + g.id, sx(b[0]), sy(b[1]) - 1, '#8f8');
        panelXf(ctx);
      }
    } else if (k === 'conflict') {
      const c = OC.ui.selConflict;
      if (c && c._bb) {
        const b = c._bb;
        ctx.fillStyle = 'rgba(255,0,255,' + 0.25 * op + ')';
        ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
        ctx.strokeStyle = 'rgba(255,0,255,' + op + ')';
        ctx.lineWidth = 2 / V.s;
        ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
      }
    }
  }

  // ---------------- rulers ----------------
  function rulers(ctx, mouse) {
    screenXf(ctx);
    ctx.fillStyle = '#1b1d21';
    ctx.fillRect(0, 0, V.cw, RUL);
    ctx.fillRect(0, 0, RUL, V.ch);
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    const minor = steps.find((st) => st * V.s >= 7) || 1000;
    const major = steps.find((st) => st >= minor * 5 && st * V.s >= 60) || 1000;
    ctx.strokeStyle = '#666';
    ctx.fillStyle = '#aaa';
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [px0] = OC.toPanel(RUL, 0);
    const [px1] = OC.toPanel(V.cw, 0);
    for (let x = Math.ceil(Math.max(0, px0) / minor) * minor; x <= Math.min(W, px1); x += minor) {
      const X = Math.round(sx(x)) + 0.5;
      const big = x % major === 0;
      ctx.moveTo(X, RUL);
      ctx.lineTo(X, big ? 4 : 12);
      if (big) ctx.fillText(String(x), X + 2, 10);
    }
    const [, py0] = OC.toPanel(0, RUL);
    const [, py1] = OC.toPanel(0, V.ch);
    for (let y = Math.ceil(Math.max(0, py0) / minor) * minor; y <= Math.min(H, py1); y += minor) {
      const Y = Math.round(sy(y)) + 0.5;
      const big = y % major === 0;
      ctx.moveTo(RUL, Y);
      ctx.lineTo(big ? 4 : 12, Y);
      if (big) {
        ctx.save();
        ctx.translate(10, Y + 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(y), 0, 0);
        ctx.restore();
      }
    }
    ctx.stroke();
    if (mouse) {
      ctx.strokeStyle = '#ffd54f';
      ctx.beginPath();
      ctx.moveTo(mouse[0] + 0.5, 0); ctx.lineTo(mouse[0] + 0.5, RUL);
      ctx.moveTo(0, mouse[1] + 0.5); ctx.lineTo(RUL, mouse[1] + 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = '#26292e';
    ctx.fillRect(0, 0, RUL, RUL);
  }

  OC.render = function (ctx) {
    screenXf(ctx);
    ctx.clearRect(0, 0, V.cw, V.ch);
    ctx.fillStyle = '#0d0e10';
    ctx.fillRect(0, 0, V.cw, V.ch);
    panelXf(ctx);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = V.s < 2;
    if (S.data && OC.tree && S.plan) {
      for (const n of OC.drawOrder()) {
        if (!OC.effVisible(n)) continue;
        const op = OC.effOpacity(n);
        if (op <= 0) continue;
        if (n.type === 'photo') {
          panelXf(ctx);
          ctx.globalAlpha = op;
          ctx.drawImage(OC.photos[n.ref].img, 0, 0, W, H);
          ctx.globalAlpha = 1;
        } else if (n.type === 'panel') drawPanelItem(ctx, n.ref, op);
        else if (n.type === 'ov') drawOv(ctx, n.ref, op);
        else if (n.type === 'g20') drawG20(ctx, S.g20ById[n.ref], OC.effMode(n), op);
        else if (n.type === 'wb') drawWb(ctx, S.wbById[n.ref], OC.effMode(n), op);
      }
    }
    panelXf(ctx);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1 / V.s;
    ctx.strokeRect(0, 0, W, H);
    if (OC.drawSelection) OC.drawSelection(ctx);
    if (!OC.ui.shot) rulers(ctx, OC.ui.mouse);
    screenXf(ctx);
  };
})(window.OC);
