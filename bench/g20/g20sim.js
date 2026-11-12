/* G20 bench simulation (stub, package A): draws design/overlay/g20_comfort.json's element polygons in their
 * colours, by state, so the bench shows where BMW's stock G20 cluster puts things. Bench only, never in the app.
 * The full simulation replaces this file behind the same interface (docs/AGENT-BRIEF-g20-sim.md section 5).
 *
 * window.G20Sim = { init(base) -> Promise, drawUnder(ctx, s), drawOver(ctx, s), wantsFrame(s), lamps, presets }
 */
(function () {
  'use strict';
  var M = null;
  var GONE = { 'assist.mode_label_centre': 1, 'assist.gear_centre': 1, 'structure.tacho_info_line': 1 };
  var STOCK_ONLY_HIDDEN = { 'assist.mode_label': 1, 'assist.gear': 1, 'overlay.black_box': 1 };
  var LAMP_GROUPS = { telltale: 1 };
  var LAMP_IDS = { 'bottom.belt_rear': 1, 'bottom.belt_driver': 1, 'bottom.airbag': 1, 'assist.info_tacho': 1 };
  var OVER = { 'tt.parking_brake': 1, 'bottom.belt_driver': 1, 'assist.gear': 1, 'overlay.black_box': 1 };
  var STARTUP = ['tt.brake', 'tt.tpms', 'tt.abs', 'tt.dsc', 'tt.auto_h', 'tt.parking_brake', 'tt.steering',
    'bottom.belt_rear', 'bottom.belt_driver', 'bottom.airbag', 'assist.info_tacho'];

  function isLamp(e) { return !!(LAMP_GROUPS[e.group] || LAMP_IDS[e.id]); }
  function shown(e, s) {
    if (s.themeConnected && GONE[e.id]) return false;
    if (!s.themeConnected && STOCK_ONLY_HIDDEN[e.id]) return false;
    if (isLamp(e) && !(s.lamps && s.lamps[e.id])) return false;
    if (e.id === 'assist.cc_panel' || e.id === 'bottom.cc_info') return s.ccMessage === 'ready';
    if (e.id === 'bottom.street') return s.ccMessage !== 'ready';
    if (e.id === 'assist.speed_limit') return s.limit !== null && s.limit !== undefined;
    return true;
  }
  function poly(ctx, e, fill) {
    var c = e.rgb;
    ctx.beginPath();
    e.poly.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.closePath();
    if (fill) { ctx.fillStyle = 'rgb(' + c.join(',') + ')'; ctx.fill(); return; }
    ctx.fillStyle = 'rgba(' + c.join(',') + ',0.18)'; ctx.fill();
    ctx.strokeStyle = 'rgba(' + c.join(',') + ',0.9)'; ctx.lineWidth = 2; ctx.stroke();
  }
  function draw(ctx, s, over) {
    if (!M) return;
    ctx.save();
    M.outline.forEach(function (e) {
      if (!!OVER[e.id] !== over || !shown(e, s)) return;
      poly(ctx, e, e.id === 'overlay.black_box' || isLamp(e));
    });
    ctx.restore();
  }
  window.G20Sim = {
    lamps: [], presets: {},
    init: function (base) {
      return fetch(base + 'manifest.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('manifest.json: HTTP ' + r.status);
        return r.json();
      }).then(function (m) {
        M = m;
        var lamps = {};
        STARTUP.forEach(function (id) { lamps[id] = true; });
        window.G20Sim.lamps = m.outline.filter(isLamp).map(function (e) { return { id: e.id, name: e.name, group: e.group, onPanel: true }; });
        window.G20Sim.presets = { startup: { lamps: lamps, ccMessage: 'ready', limit: 50, gearLetter: 'P' }, driving: { lamps: {}, ccMessage: null, gearLetter: 'D' } };
      });
    },
    drawUnder: function (ctx, s) { ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, 720); ctx.restore(); draw(ctx, s, false); },
    drawOver: function (ctx, s) { draw(ctx, s, true); },
    wantsFrame: function () { return false; },
  };
})();
