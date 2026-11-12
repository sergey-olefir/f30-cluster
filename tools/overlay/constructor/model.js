// Overlay constructor: the plan model, shapes, conflicts (README section 3) and plan.json import/export.
'use strict';
(function (OC) {
  const W = OC.PANEL_W;
  const H = OC.PANEL_H;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  OC.clamp = clamp;

  // Global state. S.data: loaded files; S.plan: the editable plan.
  const S = (OC.S = {
    data: null,
    masks: {}, // wb id -> mask
    schematics: {}, // g20 id -> Image
    plan: null,
    settings: { stockMap: false, holeMargin: 4, holeRadius: 4 },
    g20ById: {},
    wbById: {},
    g20Index: {},
    wbIndex: {},
  });

  // ---- defaults ----
  OC.defaultDecision = function (g) {
    if (g.relation === 'over') return 'keep-clear';
    if (g.safety === 'critical' && g.relation === 'under') return 'reveal';
    if (g.safety === 'critical' && g.relation === 'gone') return 'redraw';
    return 'cover';
  };

  OC.newPlan = function () {
    const p = { g20: {}, wb: {}, anchors: {}, holes: {}, version: 0 };
    for (const g of S.data.g20) p.g20[g.id] = { decision: OC.defaultDecision(g), notes: '', redraw_at: null };
    S.plan = p;
    OC.syncHoles();
    return p;
  };

  OC.decision = (g) => (S.plan.g20[g.id] ? S.plan.g20[g.id].decision : OC.defaultDecision(g));

  // ---- holes: one per reveal, bbox + margin (rounded outward to whole px), corner radius ----
  OC.deriveHoleRect = function (g, m) {
    const b = g.bbox;
    return [clamp(Math.floor(b[0]) - m, 0, W), clamp(Math.floor(b[1]) - m, 0, H), clamp(Math.ceil(b[2]) + m, 0, W), clamp(Math.ceil(b[3]) + m, 0, H)];
  };
  OC.syncHoles = function () {
    const P = S.plan;
    const keep = {};
    for (const g of S.data.g20) {
      if (OC.decision(g) !== 'reveal') continue;
      let h = P.holes[g.id];
      if (!h) h = { margin: S.settings.holeMargin, radius: S.settings.holeRadius, edited: false, rect: null };
      if (!h.edited || !OC.isBox(h.rect)) h.rect = OC.deriveHoleRect(g, h.margin);
      keep[g.id] = h;
    }
    P.holes = keep;
  };
  OC.holeList = function () {
    return S.data.g20.filter((g) => S.plan.holes[g.id]).map((g) => ({ gid: g.id, ...S.plan.holes[g.id] }));
  };

  // ---- transforms: anchor first (about its centre), then the element (about the anchor centre, or its own centre) ----
  const ONE = { dx: 0, dy: 0, scale: 1, hidden: false };
  function pw(id) { return S.plan.wb[id] || ONE; }
  function pa(id) { return (id && S.plan.anchors[id]) || ONE; }
  OC.pw = pw;
  OC.pa = pa;

  OC.xf = function (e) {
    let s = 1, tx = 0, ty = 0;
    let C = null;
    if (e.anchor) {
      const A = S.data.anchors[e.anchor];
      const a = pa(e.anchor);
      const sa = a.scale || 1;
      tx = A.centre[0] * (1 - sa) + (a.dx || 0);
      ty = A.centre[1] * (1 - sa) + (a.dy || 0);
      s = sa;
      C = [A.centre[0] + (a.dx || 0), A.centre[1] + (a.dy || 0)];
    }
    const m = pw(e.id);
    const sm = m.scale || 1;
    if (!C) {
      const b = e.bbox;
      C = [s * (b[0] + b[2]) / 2 + tx, s * (b[1] + b[3]) / 2 + ty];
    }
    return {
      s: s * sm,
      tx: sm * tx + (1 - sm) * C[0] + (m.dx || 0),
      ty: sm * ty + (1 - sm) * C[1] + (m.dy || 0),
    };
  };
  OC.xbox = function (e, T) {
    T = T || OC.xf(e);
    const b = e.bbox;
    return [T.s * b[0] + T.tx, T.s * b[1] + T.ty, T.s * b[2] + T.tx, T.s * b[3] + T.ty];
  };
  OC.wbZ = (e) => (S.plan.wb[e.id] && typeof S.plan.wb[e.id].z === 'number' ? S.plan.wb[e.id].z : e.z);
  OC.wbHidden = (e) => !!(pw(e.id).hidden || (e.anchor && pa(e.anchor).hidden));
  OC.wbOpacity = (e) => (typeof pw(e.id).opacity === 'number' ? pw(e.id).opacity : 1) * (e.anchor && typeof pa(e.anchor).opacity === 'number' ? pa(e.anchor).opacity : 1);
  OC.anchorCentre = function (aid) {
    const A = S.data.anchors[aid];
    const a = pa(aid);
    return [A.centre[0] + (a.dx || 0), A.centre[1] + (a.dy || 0)];
  };

  // ---- rasterisation at 1 px: a pixel (i, j) counts when its centre (i+.5, j+.5) is inside ----
  function pixBox(b) {
    return [clamp(Math.ceil(b[0] - 0.5), 0, W), clamp(Math.ceil(b[1] - 0.5), 0, H), clamp(Math.ceil(b[2] - 0.5), 0, W), clamp(Math.ceil(b[3] - 0.5), 0, H)];
  }
  OC.pixBox = pixBox;

  function rasterPoly(poly) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const pb = pixBox([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    const w = Math.max(0, pb[2] - pb[0]);
    const h = Math.max(0, pb[3] - pb[1]);
    const m = new Uint8Array(w * h);
    let area = 0;
    const n = poly.length;
    for (let j = 0; j < h; j++) {
      const yc = pb[1] + j + 0.5;
      const cut = [];
      for (let k = 0; k < n; k++) {
        const p = poly[k];
        const q = poly[(k + 1) % n];
        if ((p[1] <= yc && q[1] > yc) || (q[1] <= yc && p[1] > yc)) cut.push(p[0] + ((yc - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
      }
      cut.sort((a, b) => a - b);
      for (let k = 0; k + 1 < cut.length; k += 2) {
        const i0 = clamp(Math.ceil(cut[k] - 0.5), pb[0], pb[2]);
        const i1 = clamp(Math.ceil(cut[k + 1] - 0.5), pb[0], pb[2]);
        for (let i = i0; i < i1; i++) {
          const o = j * w + (i - pb[0]);
          if (!m[o]) { m[o] = 1; area++; }
        }
      }
    }
    return { x0: pb[0], y0: pb[1], w, h, m, area };
  }
  function rasterRect(b) {
    const pb = pixBox(b);
    const w = Math.max(0, pb[2] - pb[0]);
    const h = Math.max(0, pb[3] - pb[1]);
    const m = new Uint8Array(w * h).fill(1);
    return { x0: pb[0], y0: pb[1], w, h, m, area: w * h };
  }
  function inRR(X, Y, r) {
    const R = r.radius || 0;
    if (X < r.rect[0] || X >= r.rect[2] || Y < r.rect[1] || Y >= r.rect[3]) return false;
    if (R <= 0) return true;
    const cx = clamp(X, r.rect[0] + R, r.rect[2] - R);
    const cy = clamp(Y, r.rect[1] + R, r.rect[3] - R);
    return (X - cx) * (X - cx) + (Y - cy) * (Y - cy) <= R * R;
  }
  OC.inRR = inRR;
  function rasterRR(rr) {
    const pb = pixBox(rr.rect);
    const w = Math.max(0, pb[2] - pb[0]);
    const h = Math.max(0, pb[3] - pb[1]);
    const m = new Uint8Array(w * h);
    let area = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (inRR(pb[0] + i + 0.5, pb[1] + j + 0.5, rr)) { m[j * w + i] = 1; area++; }
    return { x0: pb[0], y0: pb[1], w, h, m, area };
  }

  const g20R = new Map();
  OC.g20Raster = function (g) {
    let r = g20R.get(g.id);
    if (!r) {
      r = g.poly ? rasterPoly(g.poly) : rasterRect(g.bbox);
      g20R.set(g.id, r);
    }
    return r;
  };

  // The holes cut into a background: the plan's holes, plus its own hole when its setting is on.
  OC.bgHoles = function (e, T) {
    const out = OC.holeList().map((h) => ({ rect: h.rect, radius: h.radius || 0 }));
    // A background's own hole (WBBACK's map hole) is cut from every background: on the car the stock map shows
    // only if nothing of ours is drawn there (README §3).
    for (const o of S.data.wb) {
      if (o.kind !== 'background' || !o.hole || OC.wbHidden(o)) continue;
      if (o.hole.when && !(o.hole.when === 'stockMap' && S.settings.stockMap)) continue;
      const To = o === e && T ? T : OC.xf(o);
      const r = o.hole.rect;
      out.push({ rect: [To.s * r[0] + To.tx, To.s * r[1] + To.ty, To.s * r[2] + To.tx, To.s * r[3] + To.ty], radius: (o.hole.radius || 0) * To.s });
    }
    return out;
  };

  // Our element's shape after the plan's transforms: {box (pixel box), test(i, j), key} or null (no shape).
  OC.wbShape = function (e) {
    if (e.kind === 'hole' || OC.wbHidden(e) || e.drawn_on_car === false) return null;
    const T = OC.xf(e);
    const b = e.bbox;
    const box = pixBox(OC.xbox(e, T));
    const mk = S.masks[e.id];
    const holes = e.kind === 'background' ? OC.bgHoles(e, T) : [];
    const bw = b[2] - b[0];
    const bh = b[3] - b[1];
    const s = T.s;
    const key = e.id + '|' + s + ',' + T.tx + ',' + T.ty + '|' + (mk ? 'm' : 'b') + '|' + holes.map((h) => h.rect.join(',') + 'r' + h.radius).join(';');
    const test = (i, j) => {
      const X = i + 0.5;
      const Y = j + 0.5;
      const sx = (X - T.tx) / s;
      const sy = (Y - T.ty) / s;
      if (sx < b[0] || sx >= b[2] || sy < b[1] || sy >= b[3]) return false;
      if (mk) {
        const mx = Math.floor(((sx - b[0]) * mk.w) / bw);
        const my = Math.floor(((sy - b[1]) * mk.h) / bh);
        if (!mk.bin[my * mk.w + mx]) return false;
      }
      for (let k = 0; k < holes.length; k++) if (inRR(X, Y, holes[k])) return false;
      return true;
    };
    return { box, test, key, T, b, mk, holes };
  };

  // Overlap of a 1-px raster with a shape; cached by (raster id, shape key).
  const pairCache = new Map();
  OC.cacheStats = { hits: 0, misses: 0 };
  function overlap(rid, r, sh) {
    const key = rid + '#' + sh.key;
    const c = pairCache.get(key);
    if (c) { OC.cacheStats.hits++; return c; }
    OC.cacheStats.misses++;
    const x0 = Math.max(r.x0, sh.box[0]);
    const y0 = Math.max(r.y0, sh.box[1]);
    const x1 = Math.min(r.x0 + r.w, sh.box[2]);
    const y1 = Math.min(r.y0 + r.h, sh.box[3]);
    let n = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
    const nx = x1 - x0;
    if (nx > 0 && y1 > y0) {
      // inverse-map every column and row once, then the inner loop is two array lookups
      const { T, b, mk, holes } = sh;
      const s = T.s;
      const bw = b[2] - b[0];
      const bh = b[3] - b[1];
      const col = new Int32Array(nx);
      for (let k = 0; k < nx; k++) {
        const sx = (x0 + k + 0.5 - T.tx) / s;
        col[k] = sx < b[0] || sx >= b[2] ? -1 : mk ? Math.floor(((sx - b[0]) * mk.w) / bw) : 0;
      }
      const nh = holes.length;
      for (let j = y0; j < y1; j++) {
        const sy = (j + 0.5 - T.ty) / s;
        if (sy < b[1] || sy >= b[3]) continue;
        const mrow = mk ? Math.floor(((sy - b[1]) * mk.h) / bh) * mk.w : 0;
        const grow = (j - r.y0) * r.w - r.x0 + x0;
        const bin = mk ? mk.bin : null;
        for (let k = 0; k < nx; k++) {
          const cc = col[k];
          if (cc < 0 || !r.m[grow + k]) continue;
          if (bin && !bin[mrow + cc]) continue;
          if (nh) {
            let cut = false;
            for (let q = 0; q < nh; q++) if (inRR(x0 + k + 0.5, j + 0.5, holes[q])) { cut = true; break; }
            if (cut) continue;
          }
          n++;
          const i = x0 + k;
          if (i < bx0) bx0 = i;
          if (i > bx1) bx1 = i;
          if (j < by0) by0 = j;
          if (j > by1) by1 = j;
        }
      }
    }
    const res = { n, bb: n ? [bx0, by0, bx1 + 1, by1 + 1] : null };
    if (pairCache.size > 20000) pairCache.clear();
    pairCache.set(key, res);
    return res;
  }
  OC.clearConflictCache = () => { pairCache.clear(); g20R.clear(); holeR.clear(); };
  const boxHit = (r, b) => r.x0 < b[2] && r.x0 + r.w > b[0] && r.y0 < b[3] && r.y0 + r.h > b[1];

  const SEV = { error: 0, warning: 1, info: 2 };
  const RULES = ['content-under-over', 'critical-covered', 'gone-critical-not-redrawn', 'hole-cuts-content', 'redraw-not-placed', 'under-covered'];
  const round2 = (v) => Math.round(v * 100) / 100;

  // README section 3, one conflict per G20/6WB pair and rule.
  OC.computeConflicts = function () {
    const t0 = performance.now();
    const shapes = [];
    for (const e of S.data.wb) {
      const sh = OC.wbShape(e);
      if (sh) shapes.push({ e, sh });
    }
    const out = [];
    const push = (sev, rule, g, w, ov, msg) => {
      const r = OC.g20Raster(g);
      out.push({
        severity: sev, rule, g20: g.id, wb: w ? w.id : null,
        overlap_px: ov ? ov.n : 0,
        overlap_pct: ov ? (r.area ? round2((100 * ov.n) / r.area) : 0) : null,
        message: msg, _bb: ov ? ov.bb : null,
      });
    };
    for (const g of S.data.g20) {
      if (g.group === 'structure') continue; // context ghost only (README §3)
      const d = OC.decision(g);
      const crit = g.safety === 'critical';
      let rule = null;
      if (g.relation === 'over') rule = ['error', 'content-under-over', 'our content under an over element (BMW draws it on top)'];
      else if (crit && (g.relation === 'under' || g.relation === 'unknown') && d !== 'reveal' && d !== 'redraw') rule = ['error', 'critical-covered', 'critical ' + g.relation + ' element covered, decision ' + d];
      else if (!crit && g.relation === 'under' && d !== 'reveal') rule = ['info', 'under-covered', 'under element covered by us (decision ' + d + ')'];
      else if (!crit && g.relation === 'unknown' && d !== 'reveal') rule = ['info', 'unknown-covered', 'unknown element covered by us; it may be under (decision ' + d + ')'];
      if (rule) {
        const r = OC.g20Raster(g);
        for (const { e, sh } of shapes) {
          if (!boxHit(r, sh.box)) continue;
          if (rule[1] === 'content-under-over' && e.kind === 'background') continue; // a plain background under BMW's item hides nothing
          const ov = overlap('g:' + g.id, r, sh);
          if (ov.n > 0) push(rule[0], rule[1], g, e, ov, rule[2]);
        }
      }
      if (crit && g.relation === 'gone' && d !== 'redraw') push('error', 'gone-critical-not-redrawn', g, null, null, 'critical gone element not redrawn (decision ' + d + ')');
      if (d === 'redraw' && !(S.plan.g20[g.id] && OC.isBox(S.plan.g20[g.id].redraw_at))) push('warning', 'redraw-not-placed', g, null, null, 'decision redraw without redraw_at');
    }
    for (const h of OC.holeList()) {
      const g = S.g20ById[h.gid];
      const rr = { rect: h.rect, radius: h.radius || 0 };
      const rid = 'h:' + h.rect.join(',') + 'r' + rr.radius;
      let r = holeR.get(rid);
      if (!r) { r = rasterRR(rr); holeR.set(rid, r); }
      for (const { e, sh } of shapes) {
        if (e.kind === 'background' || !boxHit(r, sh.box)) continue;
        const ov = overlap(rid, r, sh);
        if (ov.n > 0) {
          push('warning', 'hole-cuts-content', g, e, ov, 'the reveal hole would cut our content (' + ov.n + ' px of the hole)');
        }
      }
    }
    out.sort((a, b) =>
      SEV[a.severity] - SEV[b.severity] || RULES.indexOf(a.rule) - RULES.indexOf(b.rule) ||
      S.g20Index[a.g20] - S.g20Index[b.g20] || (a.wb == null ? -1 : S.wbIndex[a.wb]) - (b.wb == null ? -1 : S.wbIndex[b.wb]));
    OC.lastConflictMs = performance.now() - t0;
    return out;
  };
  const holeR = new Map();

  // ---- plan.json export (schema planFile) ----
  OC.buildPlanFile = function (conflicts, opts) {
    opts = opts || {};
    const P = S.plan;
    const D = S.data;
    const g20 = {};
    for (const g of D.g20) {
      const p = P.g20[g.id] || { decision: OC.defaultDecision(g) };
      const o = { decision: g.relation === 'over' ? 'keep-clear' : p.decision };
      if (p.notes) o.notes = p.notes;
      if (o.decision === 'redraw') o.redraw_at = OC.isBox(p.redraw_at) ? p.redraw_at.slice() : null;
      g20[g.id] = o;
    }
    const clean = (m) => {
      const o = {};
      if (m.dx) o.dx = m.dx;
      if (m.dy) o.dy = m.dy;
      if (typeof m.scale === 'number' && m.scale !== 1) o.scale = m.scale;
      if (m.hidden) o.hidden = true;
      if (typeof m.z === 'number') o.z = m.z;
      if (typeof m.opacity === 'number' && m.opacity !== 1) o.opacity = m.opacity;
      return o;
    };
    const wb = {};
    for (const e of D.wb) if (P.wb[e.id]) { const o = clean(P.wb[e.id]); if (Object.keys(o).length) wb[e.id] = o; }
    const anchors = {};
    for (const a of Object.keys(D.anchors)) if (P.anchors[a]) { const o = clean(P.anchors[a]); delete o.z; if (Object.keys(o).length) anchors[a] = o; }
    const holes = OC.holeList().map((h) => ({ id: 'hole.' + h.gid, for: [h.gid], rect: h.rect.slice(), margin: h.margin, radius: h.radius, edited: !!h.edited }));
    const keep_clear = D.g20.filter((g) => g.relation === 'over').map((g) => ({ id: 'kc.' + g.id, for: [g.id], rect: g.bbox.slice(), poly: g.poly ? g.poly.map((p) => p.slice()) : null }));
    const plan = {
      kind: 'plan',
      schema_version: 1,
      version: opts.version || (P.version || 0) + 1,
      mode: (D.g20doc && D.g20doc.mode) || 'comfort',
    };
    if (!opts.noTime) plan.saved_at = new Date().toISOString();
    plan.based_on = { g20: { file: D.files.g20, sha256: D.sha.g20 }, wb: { file: D.files.wb, sha256: D.sha.wb } };
    plan.settings = { stockMap: !!S.settings.stockMap };
    plan.g20 = g20;
    plan.wb = wb;
    plan.anchors = anchors;
    plan.holes = holes;
    plan.keep_clear = keep_clear;
    plan.conflicts = conflicts.map((c) => {
      const o = { severity: c.severity, rule: c.rule, g20: c.g20, wb: c.wb, overlap_px: c.overlap_px, overlap_pct: c.overlap_pct };
      if (c.message) o.message = c.message;
      return o;
    });
    return plan;
  };

  // ---- plan.json import. Returns {errs, warns}; applies only when there are no errors. ----
  OC.applyPlanFile = function (doc) {
    const errs = [];
    const warns = [];
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { errs: ['not a JSON object'], warns };
    if (doc.kind !== 'plan') return { errs: ['"kind" is ' + JSON.stringify(doc.kind) + ', expected "plan"'], warns };
    const miss = ['schema_version', 'version', 'based_on', 'g20', 'wb', 'anchors', 'holes', 'keep_clear', 'conflicts'].filter((k) => !(k in doc));
    if (miss.length) return { errs: ['missing required field(s) ' + miss.join(', ')], warns };
    const D = S.data;
    for (const k of ['g20', 'wb']) {
      const b = doc.based_on && doc.based_on[k];
      if (!b || b.sha256 !== D.sha[k]) warns.push('based_on.' + k + ': the plan was made against ' + (b ? b.file + ' ' + String(b.sha256).slice(0, 19) + '...' : 'unknown data') + '; the loaded ' + D.files[k] + ' differs');
    }
    const P = { g20: {}, wb: {}, anchors: {}, holes: {}, version: Number.isInteger(doc.version) ? doc.version : 0 };
    for (const g of D.g20) {
      const p = doc.g20[g.id];
      if (!p) { warns.push('g20.' + g.id + ': no decision in the plan; default used'); P.g20[g.id] = { decision: OC.defaultDecision(g), notes: '', redraw_at: null }; continue; }
      let d = OC.ENUM.DECISIONS.includes(p.decision) ? p.decision : OC.defaultDecision(g);
      if (g.relation === 'over' && d !== 'keep-clear') { warns.push('g20.' + g.id + ': over, decision forced to keep-clear'); d = 'keep-clear'; }
      P.g20[g.id] = { decision: d, notes: p.notes || '', redraw_at: OC.isBox(p.redraw_at) ? p.redraw_at.slice() : null };
    }
    if (doc.settings && typeof doc.settings.stockMap === 'boolean') S.settings.stockMap = doc.settings.stockMap;
    for (const id of Object.keys(doc.g20)) if (!S.g20ById[id]) warns.push('g20.' + id + ': not in the loaded G20 file; ignored');
    for (const id of Object.keys(doc.wb)) {
      if (!S.wbById[id]) { warns.push('wb.' + id + ': not in the loaded 6WB file; ignored'); continue; }
      P.wb[id] = Object.assign({}, doc.wb[id]);
    }
    for (const id of Object.keys(doc.anchors)) {
      if (!D.anchors[id]) { warns.push('anchors.' + id + ': not defined; ignored'); continue; }
      P.anchors[id] = Object.assign({}, doc.anchors[id]);
    }
    for (const h of Array.isArray(doc.holes) ? doc.holes : []) {
      const gid = h && Array.isArray(h.for) ? h.for[0] : null;
      if (!gid || !S.g20ById[gid] || !OC.isBox(h.rect)) { warns.push('hole ' + (h && h.id) + ': unknown element or bad rect; ignored'); continue; }
      P.holes[gid] = { margin: typeof h.margin === 'number' ? h.margin : S.settings.holeMargin, radius: typeof h.radius === 'number' ? h.radius : S.settings.holeRadius, rect: h.rect.slice(), edited: !!h.edited };
    }
    S.plan = P;
    OC.syncHoles();
    return { errs, warns };
  };

  OC.snapshot = () => JSON.stringify({ g20: S.plan.g20, wb: S.plan.wb, anchors: S.plan.anchors, holes: S.plan.holes });
  OC.restore = (s) => {
    const o = JSON.parse(s);
    S.plan.g20 = o.g20;
    S.plan.wb = o.wb;
    S.plan.anchors = o.anchors;
    S.plan.holes = o.holes;
  };
})(window.OC);
