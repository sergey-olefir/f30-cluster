// Overlay constructor: the G20 parts (design/overlay/g20_parts.json) as real textures.
// Rasters (bench/g20/structure/*.png) are drawn at their placement; procedural and live parts are drawn one at a time
// into an offscreen canvas through the simulation's own entry points (bench/g20/g20sim.js loads c.js and live/live.js:
// G20C.drawUnder / drawOver, G20Live.drawMap and its _debug.drawGlow / drawBar / drawBand / drawFill / drawNeedle,
// G20Sim.drawOver for the black area); the app's scene textures are decoded from their JSON. Everything is optional:
// a missing source marks the part as a fallback with the reason, and the page keeps working.
'use strict';
(function (OC) {
  const W = OC.PANEL_W;
  const H = OC.PANEL_H;
  const P = (OC.P = {
    ok: false, why: '', doc: null, recs: [], byId: {}, index: {},
    sim: { ok: false, why: 'not loaded' },
    img: {},        // part id -> HTMLImageElement / canvas (rasters, app textures), or null when it failed
    imgWhy: {},     // part id -> why it failed
    cache: new Map(),
    // the global controls (mirroring the bench's G20 box, docs/G20SIM-REPORT.md section 2)
    G: { look: 'night', conn: true, lamps: 'startup' },
  });

  // The demo values per lamp preset: tools/g20sim/qc_shots.sh (rpm, speed, oil, fuelL, range, ambient), the 08 clock,
  // the bench's default street; the extras (message, sign, gear) as bench/g20/g20sim.js presets and c.js PRESET_EXTRAS.
  const BASE_VALUES = { speed: 0, rpm: 0, oil: 110, fuelL: 54, range: 467, ambient: 3.5 };
  const PRESET = {
    startup: { rpm: 0, ccMessage: 'ready', limit: 50, gearLetter: 'P' },
    driving: { rpm: 750, ccMessage: null, limit: null, gearLetter: 'D' },
    all: { rpm: 750, ccMessage: null, limit: 50, gearLetter: 'P' },
  };
  OC.P.PRESET = PRESET;
  const COND_TEXT = {
    engine_on: 'engine running (rpm >= 200)', engine_off: 'engine off (rpm < 200)', no_cc_message: 'no check-control message',
    cc_message: 'a check-control message', limit_set: 'a speed-limit sign', cold_engine_running: 'oil < 40 °C with the engine running',
  };

  function presetLamps(name) {
    const C = window.G20C;
    if (!C) return {};
    if (name === 'all') { const o = {}; C.lamps.forEach((l) => { if (l.onPanel !== false) o[l.id] = true; }); return o; }
    return Object.assign({}, (C.PRESETS && C.PRESETS[name]) || {});
  }
  function condMet(c, s) {
    const rpm = s.values.rpm;
    if (c === 'engine_on') return rpm >= 200;
    if (c === 'engine_off') return !(rpm >= 200);
    if (c === 'no_cc_message') return !s.ccMessage;
    if (c === 'cc_message') return !!s.ccMessage;
    if (c === 'limit_set') return s.limit != null && s.limit > 0;
    if (c === 'cold_engine_running') return s.values.oil < 40 && rpm >= 200;
    return true;
  }
  // the simulation's state for the global controls (the whole panel at once)
  function baseState(G) {
    const pr = PRESET[G.lamps] || PRESET.startup;
    const t = new Date(2026, 0, 1, 16, 43, 0);
    return { themeConnected: !!G.conn, day: G.look === 'day', drive: 'comfort', lamps: presetLamps(G.lamps),
      values: Object.assign({}, BASE_VALUES, { rpm: pr.rpm }), limit: pr.limit, ccMessage: pr.ccMessage,
      gearLetter: pr.gearLetter, time: t, street: 'Соборна вулиця', t: 0 };
  }
  // Is the part drawn in the global state? Mirrors g20sim.js wanted() plus C's own conditions. 'all' forces every
  // lamp and every condition on, part by part (more than the car can show at once).
  OC.partActive = function (r, G) {
    G = G || P.G;
    if (r.render === 'font') return { on: false, why: 'the font C draws its texts with: not a picture' };
    if (r.render === 'data') return { on: false, why: 'data, not a picture (pointer and needle geometry)' };
    if (r.source === 'app-scene') return { on: true, why: '' };
    if (r.look !== 'any' && r.look !== G.look) return { on: false, why: r.look + ' look only' };
    if (r.state === 'stock' && G.conn) return { on: false, why: 'stock layout only (theme connected)' };
    if (r.state === 'connected' && !G.conn) return { on: false, why: 'theme connected only' };
    if (G.lamps === 'all') return { on: true, why: r.skip ? 'the simulation skips it (' + r.skip + '); shown with "all"' : '' };
    if (r.skip) return { on: false, why: 'the simulation skips it: ' + r.skip + ' (shown with lamps "all")' };
    const s = baseState(G);
    if (r.lamp && !s.lamps[r.lamp]) return { on: false, why: 'lamp ' + r.lamp + ' not lit in the ' + G.lamps + ' preset' };
    if (r.lamp === 'tt.parking_brake.hold' && s.lamps['tt.parking_brake']) return { on: false, why: 'the red (P) wins when both are lit (c.js drawOver)' };
    if (r.cond && !condMet(r.cond, s)) return { on: false, why: 'drawn only with ' + (COND_TEXT[r.cond] || r.cond) };
    return { on: true, why: '' };
  };
  // the state one part is drawn alone in: only its own lamp, its condition forced on when the preset is 'all'
  function partState(r, G) {
    const s = baseState(G);
    s.lamps = {};
    if (r.lamp && (G.lamps === 'all' || presetLamps(G.lamps)[r.lamp])) s.lamps[r.lamp] = true;
    if (G.lamps === 'all' || P.forceCond) {
      const c = r.cond;
      if (c === 'engine_on') s.values.rpm = 750;
      if (c === 'engine_off') s.values.rpm = 0;
      if (c === 'cold_engine_running') { s.values.rpm = 750; s.values.oil = 30; }
      if (c === 'cc_message') s.ccMessage = 'ready';
      if (c === 'no_cc_message') s.ccMessage = null;
      if (c === 'limit_set' && !(s.limit > 0)) s.limit = 50;
    }
    return s;
  }
  OC.partState = partState;

  // ---------------- loading ----------------
  function loadScript(src) {
    return new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = src;
      sc.onload = res;
      sc.onerror = () => rej(new Error('cannot load ' + src));
      document.head.appendChild(sc);
    });
  }
  function decodeScene(j) {
    const bin = atob(j.rgba);
    const n = j.w * j.h * 4;
    if (bin.length !== n) throw new Error('rgba is ' + bin.length + ' bytes, expected ' + n);
    const a = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
    const c = document.createElement('canvas');
    c.width = j.w;
    c.height = j.h;
    c.getContext('2d').putImageData(new ImageData(a, j.w, j.h), 0, 0);   // ImageData is straight alpha, as the JSON
    return c;
  }
  OC.loadParts = async function () {
    const warns = [];
    const r = await OC.fetchRaw('design/overlay/g20_parts.json');
    if (!r.ok) { P.why = 'design/overlay/g20_parts.json: ' + r.why + ' (run tools/overlay/inventory_parts.py)'; return { warns: [P.why] }; }
    let doc;
    try { doc = JSON.parse(new TextDecoder().decode(r.buf)); } catch (e) { P.why = 'g20_parts.json: not valid JSON (' + e.message + ')'; return { warns: [P.why] }; }
    if (!doc || doc.kind !== 'g20-parts' || !Array.isArray(doc.parts)) { P.why = 'g20_parts.json: not a g20-parts file'; return { warns: [P.why] }; }
    P.doc = doc;
    P.recs = doc.parts.filter((p) => p && typeof p.id === 'string');
    P.recs.forEach((p, i) => { P.byId[p.id] = p; P.index[p.id] = i; });
    // the simulation (procedural and live parts) and the images, in parallel
    const sim = (async () => {
      try {
        await loadScript(OC.ROOT + 'bench/g20/g20sim.js');
        await window.G20Sim.init(OC.ROOT + 'bench/g20/');
        if (!window.G20C) throw new Error('package C (c.js) did not load');
        if (!window.G20Live) throw new Error('package D (live/live.js) did not load');
        P.sim = { ok: true, why: '' };
      } catch (e) {
        P.sim = { ok: false, why: 'bench/g20 simulation not available (' + (e && e.message || e) + ')' };
        warns.push(P.sim.why + ': procedural and live parts fall back to the schematic');
      }
    })();
    const jobs = P.recs.filter((p) => p.file && (p.render === 'raster' || p.render === 'app-texture'));
    let i = 0;
    const worker = async () => {
      while (i < jobs.length) {
        const p = jobs[i++];
        if (p.render === 'raster') {
          const im = await OC.loadImage(OC.ROOT + p.file);
          P.img[p.id] = im;
          if (!im) P.imgWhy[p.id] = p.file + ' could not be loaded';
        } else {
          const rr = await OC.fetchRaw(p.file);
          if (!rr.ok) { P.img[p.id] = null; P.imgWhy[p.id] = p.file + ': ' + rr.why; continue; }
          try { P.img[p.id] = decodeScene(JSON.parse(new TextDecoder().decode(rr.buf))); } catch (e) { P.img[p.id] = null; P.imgWhy[p.id] = p.file + ': ' + e.message; }
        }
      }
    };
    await Promise.all([sim, worker(), worker(), worker(), worker()]);
    const miss = Object.keys(P.imgWhy);
    if (miss.length) warns.push(miss.length + ' part image(s) missing: ' + miss.map((k) => P.imgWhy[k]).join('; '));
    P.ok = true;
    return { warns };
  };

  // ---------------- drawing one part alone ----------------
  let scratch = null;
  function sc() {
    if (!scratch) { scratch = document.createElement('canvas'); scratch.width = W; scratch.height = H; }
    const x = scratch.getContext('2d', { willReadFrequently: true });
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, W, H);
    return x;
  }
  // the extent of what was drawn inside region [x0, y0, x1, y1]; additive parts count by colour, others by alpha
  function crop(x, reg, additive) {
    const r = [Math.max(0, Math.floor(reg[0])), Math.max(0, Math.floor(reg[1])), Math.min(W, Math.ceil(reg[2])), Math.min(H, Math.ceil(reg[3]))];
    const w = r[2] - r[0];
    const h = r[3] - r[1];
    if (w <= 0 || h <= 0) return null;
    const d = x.getImageData(r[0], r[1], w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const o = 4 * (j * w + i);
        const on = additive ? d[o] + d[o + 1] + d[o + 2] > 0 : d[o + 3] > 0;
        if (!on) continue;
        n++;
        if (i < x0) x0 = i;
        if (i > x1) x1 = i;
        if (j < y0) y0 = j;
        if (j > y1) y1 = j;
      }
    }
    if (!n) return { px: 0 };
    const box = [r[0] + x0, r[1] + y0, r[0] + x1 + 1, r[1] + y1 + 1];
    const c = document.createElement('canvas');
    c.width = box[2] - box[0];
    c.height = box[3] - box[1];
    c.getContext('2d').drawImage(scratch, box[0], box[1], c.width, c.height, 0, 0, c.width, c.height);
    return { img: c, box, px: n };
  }
  const V = (x) => (x && typeof x === 'object' && 'v' in x && 'ev' in x ? x.v : x);
  function polyBox(poly) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  function drawLive(r, s) {
    const L = window.G20Live;
    const D = L._debug;
    const x = sc();
    const conn = { connected: !!s.themeConnected };
    const v = s.values;
    const id = r.id;
    if (id === 'live.map' || id === 'live.map.arrow') {
      L.drawMap(x, s);                                   // the tile for this look, plus the arrow
      const m = D.map();
      if (id === 'live.map') { const y = sc(); y.drawImage(m.tile, m.box[0], m.box[1]); return crop(y, [0, 0, W, H]); }
      // the arrow: what drawMap adds over the tile alone, inside the arrow's measured outline (PARAMS.map.arrow)
      const reg = polyBox(V(L.PARAMS.map.arrow)).map((q, i) => q + (i < 2 ? -3 : 3));
      const rx = [Math.floor(reg[0]), Math.floor(reg[1]), Math.ceil(reg[2]), Math.ceil(reg[3])];
      const w = rx[2] - rx[0];
      const h = rx[3] - rx[1];
      const a = x.getImageData(rx[0], rx[1], w, h);
      const y = sc();
      y.drawImage(m.tile, m.box[0], m.box[1]);
      const b = y.getImageData(rx[0], rx[1], w, h).data;
      const ad = a.data;
      for (let i = 0; i < ad.length; i += 4) if (ad[i] === b[i] && ad[i + 1] === b[i + 1] && ad[i + 2] === b[i + 2]) ad[i + 3] = 0;
      y.clearRect(0, 0, W, H);
      y.putImageData(a, rx[0], rx[1]);
      return crop(y, rx);
    }
    if (id === 'live.glow.speedo') { D.drawGlow(x, 'speed', L.pointerAt('speed', v.speed, conn), s.day); return crop(x, [0, 0, W, H], true); }
    if (id === 'live.glow.tacho') { D.drawGlow(x, 'rpm', L.pointerAt('rpm', v.rpm, conn), s.day); return crop(x, [0, 0, W, H], true); }
    if (id === 'live.band.tacho') { D.drawBand(x, 'rpm', L.pointerAt('rpm', v.rpm, conn)); return crop(x, [0, 0, W, H]); }
    if (id === 'live.pointer.speedo') { D.drawBar(x, 'speed', L.pointerAt('speed', v.speed, conn), s.day); return crop(x, [0, 0, W, H]); }
    if (id === 'live.pointer.tacho') { D.drawBar(x, 'rpm', L.pointerAt('rpm', v.rpm, conn), s.day); return crop(x, [0, 0, W, H]); }
    if (id === 'live.mini.fuel' || id === 'live.mini.oil') {
      const which = id === 'live.mini.fuel' ? 'fuel' : 'oil';
      const g = D.miniAt(which, which === 'fuel' ? v.fuelL : v.oil);
      D.drawFill(x, which, g.f);                         // off by default, as in the simulation (g20sim.js, ?g20fill=b)
      D.drawNeedle(x, which, g);
      return crop(x, [0, 0, W, H]);
    }
    return { fallback: 'no single-part entry point for ' + id + ' in live.js' };
  }
  function drawProcedural(r, s) {
    if (r.id === 'sim.black_box') {
      const x = sc();
      window.G20Sim.drawOver(x, Object.assign({}, s, { themeConnected: true, lamps: {} }));
      return crop(x, r.bbox);
    }
    const C = window.G20C;
    const x = sc();
    if (r.layer === 'over') C.drawOver(x, s);
    else C.drawUnder(x, s);
    const pad = r.lamp ? 6 : 3;                          // a lit lamp's soft halo (c.js HALO) reaches a few px out
    const b = r.bbox;
    return crop(x, [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]);
  }
  // -> {img, box, px, composite} | {fallback: reason}
  function render(r, G) {
    if (r.render === 'font' || r.render === 'data') return { fallback: r.render === 'font' ? 'a font, not a picture' : 'data, not a picture' };
    if (r.render === 'raster' || r.render === 'app-texture') {
      const im = P.img[r.id];
      if (!im) return { fallback: P.imgWhy[r.id] || 'image not loaded' };
      const pl = r.placement;
      if (!pl) return { fallback: 'no placement' };
      return { img: im, box: pl, px: r.alpha_px || 0, composite: r.composite || 'source-over', opacity: r.opacity == null ? 1 : r.opacity, smooth: (r.scale || 1) > 1 };
    }
    if (!P.sim.ok) return { fallback: P.sim.why };
    const s = partState(r, G);
    let out;
    try {
      out = r.render === 'live' ? drawLive(r, s) : drawProcedural(r, s);
    } catch (e) {
      return { fallback: 'drawing it alone threw: ' + (e && e.message || e) };
    }
    if (!out) return { fallback: 'nothing to crop' };
    if (out.fallback) return out;
    if (!out.px) return { empty: 'draws nothing at these values (rpm ' + s.values.rpm + ')', px: 0 };
    out.composite = r.id.startsWith('live.glow.') ? V(window.G20Live.PARAMS.glow.composite) || 'lighter' : 'source-over';
    out.opacity = 1;
    out.state = s;
    return out;
  }
  const gkey = (G) => G.look + '|' + (G.conn ? 'c' : 's') + '|' + G.lamps;
  OC.partBitmap = function (r, G) {
    G = G || P.G;
    const k = r.id + '|' + (r.render === 'procedural' || r.render === 'live' ? gkey(G) : '');
    let v = P.cache.get(k);
    if (!v) { v = render(r, G); P.cache.set(k, v); }
    return v;
  };
  OC.clearPartCache = () => {
    for (const k of Array.from(P.cache.keys())) if (!k.endsWith('|')) P.cache.delete(k);
  };

  // The probe (?probe=parts, used by tools/overlay/inventory_parts.py): every procedural / live part drawn alone, in a
  // state where it is active (its look and state; the start-up values with its own lamp and condition forced on;
  // 'any' parts in the stock layout, where the catalogue was measured), and its extent.
  OC.probeParts = function () {
    const out = {};
    P.forceCond = true;
    for (const r of P.recs) {
      if (r.render !== 'procedural' && r.render !== 'live') continue;
      const G = { look: r.look === 'day' ? 'day' : 'night', conn: r.state === 'connected', lamps: 'startup' };
      let lampG = r.lamp ? Object.assign({}, G, { lamps: 'all' }) : G;
      let v = render(r, lampG);
      if (v.empty) { lampG = Object.assign({}, G, { lamps: 'driving' }); v = render(r, lampG); }   // e.g. the rev band at rpm 0
      const st = partState(r, lampG);
      const o = { state: { look: lampG.look, connected: lampG.conn, preset: lampG.lamps, rpm: st.values.rpm, oil: st.values.oil, ccMessage: st.ccMessage, limit: st.limit, lamps: Object.keys(st.lamps) } };
      if (v.fallback || v.empty) o.fallback = v.fallback || v.empty;
      else { o.bbox = v.box; o.px = v.px; }
      out[r.id] = o;
    }
    P.forceCond = false;
    return out;
  };

  // A small thumbnail (data URL) of a part for the inspector.
  OC.partThumb = function (r, maxW, maxH) {
    const v = OC.partBitmap(r);
    if (!v || !v.img) return null;
    const bw = v.box[2] - v.box[0];
    const bh = v.box[3] - v.box[1];
    const k = Math.min(1, maxW / bw, maxH / bh);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bw * k));
    c.height = Math.max(1, Math.round(bh * k));
    const x = c.getContext('2d');
    x.fillStyle = '#000';
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = v.composite === 'lighter' ? 'lighter' : 'source-over';
    x.drawImage(v.img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  };
})(window.OC);
