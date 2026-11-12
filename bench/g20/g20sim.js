/* G20 bench simulation: BMW's stock G20 Comfort cluster drawn under (and partly over) a custom theme on the bench,
 * so that with "backdrop" and "car view" on the bench looks the way the owner sees the car. Bench only: nothing here
 * goes into the app, the layouts or the car (on the car it would cover BMW's real lamps).
 *
 * Our own drawings fitted to the rectified car photos 08-14 (no photo pixels, no BMW artwork or fonts):
 *   structure/  package B: the static dials, minis and background, night and day (manifest images)
 *   live/       package D: the synthetic map, the stock pointers and their glow, the mini needles (G20Live)
 *   c.js        package C: telltales, bottom row, sign, check-control panel, texts (G20C, Roboto)
 * manifest.json is written by tools/g20sim/build_manifest.py. Report: docs/G20SIM-REPORT.md.
 *
 * window.G20Sim = { init(base) -> Promise, drawUnder(ctx, s), drawOver(ctx, s), wantsFrame(s), lamps, presets }
 * s = { themeConnected, values, drive, lamps, limit, ccMessage, gearLetter, time, day, street, t }
 *
 * Debug (URL): ?g20dbg=outline draws the catalogue polygons (design/overlay/g20_comfort.json) on top;
 *              ?g20dbg=gauges draws only the stock pointers, their glow and the mini needles over black;
 *              ?g20fill=b|d|both: the minis' fill from B (grey level clipped at D's needle; the default), from D
 *              (lit fill), or both (they model the same pixels: QC only).
 */
(function () {
  'use strict';
  var M = null, BASE = '/g20/';
  var images = {};                       // file -> HTMLImageElement
  var mods = { c: null, live: null };
  var q = new URLSearchParams(location.search);
  var DBG = q.get('g20dbg') || '';
  var FILL = q.get('g20fill') || 'b';

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = src; sc.onload = resolve; sc.onerror = function () { reject(new Error('cannot load ' + src)); };
      document.head.appendChild(sc);
    });
  }
  function loadImage(file) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () { images[file] = im; resolve(); };
      im.onerror = function () { console.warn('G20Sim: no image ' + file); resolve(); };
      im.src = BASE + file;
    });
  }
  function isImage(e) { return e.file && /\.png$/.test(e.file) && !e.skip; }

  // ------------------------------------------------------------------------------------------- state filters
  function rpmOf(s) { var v = s.values && s.values.rpm; return typeof v === 'number' && isFinite(v) ? v : 0; }
  function wanted(e, s) {
    if (e.layer && e.layer !== 'under') return false;
    if (e.look && e.look !== 'any' && e.look !== (s.day ? 'day' : 'night')) return false;
    if (e.state === 'stock' && s.themeConnected) return false;
    if (e.state === 'connected' && !s.themeConnected) return false;
    if (e.cond === 'engine_on' && !(rpmOf(s) > 0)) return false;
    if (e.cond === 'engine_off' && rpmOf(s) > 0) return false;
    if (e.cond === 'no_cc_message' && s.ccMessage) return false;
    return true;
  }

  // B's minis' fill: the full sweep, clipped to the side of D's needle line that holds the scale's empty end
  function clipToNeedle(ctx, e) {
    var L = mods.live, which = e.clip.by === 'oil_needle' ? 'oil' : 'fuel';
    if (!L) return false;
    var cur = (L._debug && L._debug.cur) || {};
    var v = which === 'fuel' ? cur.fuelL : cur.oil;
    if (typeof v !== 'number' || !isFinite(v)) return false;
    var g = L.pointerAt(which, v), g0 = L.pointerAt(which, which === 'fuel' ? 0 : -1000);
    if (!g || !g.tip || !g.tail || !g0) return false;
    var dx = g.tip[0] - g.tail[0], dy = g.tip[1] - g.tail[1], n = Math.hypot(dx, dy) || 1;
    dx /= n; dy /= n;
    var nx = -dy, ny = dx;                                     // a normal of the needle line
    var e0 = g0.tip;                                           // the scale's empty end
    var side = (e0[0] - g.tail[0]) * nx + (e0[1] - g.tail[1]) * ny < 0 ? -1 : 1;
    var F = 3000, px = g.tail[0], py = g.tail[1];
    ctx.beginPath();
    ctx.moveTo(px - dx * F, py - dy * F); ctx.lineTo(px + dx * F, py + dy * F);
    ctx.lineTo(px + dx * F + nx * side * F, py + dy * F + ny * side * F);
    ctx.lineTo(px - dx * F + nx * side * F, py - dy * F + ny * side * F);
    ctx.closePath(); ctx.clip();
    return true;
  }
  function drawImages(ctx, s, z0, z1) {
    M.entries.forEach(function (e) {
      if (!isImage(e) || e.z < z0 || e.z >= z1 || !wanted(e, s)) return;
      var im = images[e.file];
      if (!im) return;
      ctx.save();
      if (e.clip) {
        if (FILL === 'd') { ctx.restore(); return; }
        if (!clipToNeedle(ctx, e)) { ctx.restore(); return; }
      }
      ctx.globalAlpha = e.opacity === undefined ? 1 : e.opacity;
      ctx.globalCompositeOperation = e.composite || 'source-over';
      var k = e.scale || 1;
      ctx.drawImage(im, e.x, e.y, im.naturalWidth * k, im.naturalHeight * k);
      ctx.restore();
    });
  }

  function blackBox(ctx) {
    var e = M.outline.filter(function (o) { return o.id === 'overlay.black_box'; })[0];
    if (!e) return;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    e.poly.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function outlines(ctx, s) {
    ctx.save();
    ctx.font = '11px ui-monospace, Menlo, monospace';
    M.outline.forEach(function (e) {
      ctx.beginPath();
      e.poly.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.closePath();
      ctx.strokeStyle = 'rgba(0,255,200,.8)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(0,255,200,.9)'; ctx.fillText(e.id, e.poly[0][0], e.poly[0][1] - 2);
    });
    ctx.restore();
  }

  // --------------------------------------------------------------------------------------------------- API
  function drawUnder(ctx, s) {
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, 720);
    ctx.restore();
    if (!M) return;
    if (DBG === 'gauges') { if (mods.live) mods.live.drawGauges(ctx, s); return; }
    drawImages(ctx, s, -1e9, 10);                                // B: background
    if (mods.live) mods.live.drawMap(ctx, s);                    // D: map (z 10)
    drawImages(ctx, s, 10, 50);                                  // B: dials, minis, numerals
    if (mods.live) mods.live.drawGauges(ctx, s);                 // D: glow, pointers, mini needles (z 50-59)
    drawImages(ctx, s, 50, 60);                                  // B: the "0 km/h" scale label over the pointer
    if (mods.c) mods.c.drawUnder(ctx, s);                        // C: lamps, texts, sign, check-control (z 60-89)
  }
  function drawOver(ctx, s) {
    if (!M || DBG === 'gauges') return;
    if (mods.c) mods.c.drawOver(ctx, s);                         // C: (P), driver's belt, bottom-row gear
    if (s.themeConnected) blackBox(ctx);                         // BMW's black area, only with a theme connected
    if (DBG === 'outline') outlines(ctx, s);
  }
  function wantsFrame(s) { return !!(mods.live && mods.live.wantsFrame(s)); }

  function init(base) {
    BASE = base || BASE;
    return fetch(BASE + 'manifest.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('manifest.json: HTTP ' + r.status);
      return r.json();
    }).then(function (m) {
      M = m;
      var files = {};
      m.entries.forEach(function (e) { if (isImage(e)) files[e.file] = 1; });
      var jobs = Object.keys(files).map(loadImage);
      jobs.push(loadScript(BASE + 'c.js').then(function () { return window.G20C.init(BASE); })
        .then(function () { mods.c = window.G20C; }, function (e) { console.warn('G20Sim: package C off: ' + e.message); }));
      jobs.push(loadScript(BASE + 'live/live.js').then(function () { return window.G20Live.init(BASE); })
        .then(function () {
          mods.live = window.G20Live;
          // the minis' fill: B's grey level (clipped at D's needle) or D's lit fill, not both (they model the same pixels)
          var fl = mods.live.PARAMS && mods.live.PARAMS.fuel && mods.live.PARAMS.fuel.fill;
          if (fl && fl.v) fl.v.enabled = FILL === 'd' || FILL === 'both';
          // ?g20glow=<gain>: the pointer glow's gain, for calibration (tools/g20sim/calib_glow.py)
          var gl = mods.live.PARAMS && mods.live.PARAMS.glow;
          if (q.get('g20glow') !== null && gl && gl.gain) gl.gain.v = Number(q.get('g20glow'));
        }, function (e) { console.warn('G20Sim: package D off: ' + e.message); }));
      return Promise.all(jobs);
    }).then(function () {
      var C = mods.c;
      api.lamps = C ? C.lamps : [];
      var ex = (C && C.PRESET_EXTRAS) || {};
      api.presets = {
        startup: { lamps: C ? C.PRESETS.startup : {}, ccMessage: 'ready', limit: (ex.startup && ex.startup.limit) || 50, gearLetter: 'P' },
        driving: { lamps: {}, ccMessage: null, gearLetter: 'D' },
      };
      return api;
    });
  }
  var api = { init: init, drawUnder: drawUnder, drawOver: drawOver, wantsFrame: wantsFrame, lamps: [], presets: {} };
  window.G20Sim = api;
})();
