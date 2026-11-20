'use strict';
// The beam simulator's page: pick a scenario, play it through the same algorithm the app runs (shared/beam_logic.js),
// watch the top and side views, the timeline and the decision; change any setting; run the whole library (Batch).
// Opens from the disk (file://): everything is loaded by <script> tags, the scenarios from scenarios.bundle.js.
(function () {
  const BS = self.BS, B = self.BeamLogic;
  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  const KIND_VAR = { head: '--head', tail: '--tail', street: '--street', reflector: '--refl', bike: '--bike', other: '--other' };
  const r3 = (x) => (x === null || x === undefined ? '–' : typeof x === 'number' ? String(Math.round(x * 1000) / 1000) : String(x));

  const app = {
    scn: null, run: null, full: null, last: null, playing: false, tPrev: 0, acc: 0,
    logic: {}, sensor: {}, opts: { mode: '', verdict: '', weather: '', preset: 'normal' },
  };
  try { const saved = JSON.parse(localStorage.getItem('beam-sim') || 'null'); if (saved) { app.logic = saved.logic || {}; app.sensor = saved.sensor || {}; } } catch (e) { /* none */ }
  const save = () => { try { localStorage.setItem('beam-sim', JSON.stringify({ logic: app.logic, sensor: app.sensor, scn: $('scn').value })); } catch (e) { /* none */ } };

  /** The scenario as the settings change it, and the run options. */
  function scenarioNow() {
    const s = JSON.parse(JSON.stringify(BS.scenario.load($('scn').value)));
    if (app.opts.weather && s.world) s.world.weather = [[0, app.opts.weather]];
    s.sim = s.sim || {};
    s.sim.sensor = Object.assign({}, s.sim.sensor || {}, app.sensor);
    if (app.opts.verdict) s.sim.sensor.verdict = app.opts.verdict;
    return s;
  }
  function runOpts() {
    let cfg = B.mergePartial({}, app.logic);
    if (app.opts.preset !== 'normal') cfg = B.mergePartial(cfg, B.PRESETS[app.opts.preset]);
    const o = { seed: Number($('seed').value) || 1, config: cfg };
    if (app.opts.mode) o.mode = app.opts.mode;
    return o;
  }

  function restart() {
    app.scn = scenarioNow();
    $('purpose').textContent = (app.scn.purpose || '') + (app.scn.limit ? '  (documents a known limit of a light camera)' : '');
    app.full = BS.sim.run(app.scn, runOpts());
    app.run = BS.sim.createRun(app.scn, runOpts());
    app.last = app.run.step();
    drawAll();
    metricsView();
  }
  function seek(tSec) {
    app.run = BS.sim.createRun(app.scn, runOpts());
    app.last = app.run.step();
    while (!app.run.done && app.run.now / 1000 < tSec) app.last = app.run.step() || app.last;
    drawAll();
  }

  // ---- the views ----
  function drawTop() {
    const cv = $('top'), g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.fillStyle = css('--night'); g.fillRect(0, 0, W, H);
    if (!app.last || !app.last.truth) { g.fillStyle = '#ccc'; g.fillText('replay: no world to draw', 20, 30); return; }
    const w = app.run.world, ego = app.last.truth.ego;
    const range = Number($('zoom').value);
    const k = (H - 40) / range;
    const h = ego.pose.h, ch = Math.cos(h), sh = Math.sin(h);
    const P = (p) => { const dx = p.x - ego.pose.x, dy = p.y - ego.pose.y; const fwd = dx * ch + dy * sh, lat = -dx * sh + dy * ch; return [W / 2 - lat * k, H - 30 - fwd * k]; };
    // the road
    const road = w.road;
    const edge = (d) => { g.beginPath(); for (let s = ego.s - 40; s <= ego.s + range * 1.1; s += 5) { const q = P(road.pose(s, d)); if (s === ego.s - 40) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]); } g.stroke(); };
    g.lineWidth = Math.max(2, road.halfWidth * 2 * k); g.strokeStyle = css('--road'); edge(0);
    g.lineWidth = 1; g.strokeStyle = css('--lane'); g.setLineDash([6, 8]);
    for (let d = -road.halfWidth + road.laneWidth; d < road.halfWidth - 0.1; d += road.laneWidth) if (Math.abs(d) > road.median / 2 + 0.1 || road.median === 0) edge(d);
    g.setLineDash([]);
    // our beams: the low one always, the high one when advised (both to scale)
    const sp = app.run.sensor.params;
    const cone = (reach, half, col) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(W / 2, H - 30);
      for (let a = -half; a <= half; a += 1) g.lineTo(W / 2 + Math.sin(a * Math.PI / 180) * reach * k, H - 30 - Math.cos(a * Math.PI / 180) * reach * k);
      g.closePath(); g.fill();
    };
    cone(sp.lowReach_m, 20, css('--low'));
    if (app.last.out.want === 'high') cone(sp.highReach_m, sp.highHalf_deg, css('--high'));
    // street lights and statics (truth), faint
    w.sources(app.last.t / 1000).forEach((src) => {
      if (src.uid || src.s < ego.s - 40 || src.s > ego.s + range * 1.1) return;
      const q = P(road.pose(src.s, src.d)); g.fillStyle = '#4a5260'; g.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3);
    });
    // the other road users
    w.users(app.last.t / 1000).forEach((u) => {
      const q = P(road.pose(u.s, u.d));
      const len = (u.kind === 'truck' ? 12 : u.kind === 'bike' || u.kind === 'ped' ? 2 : 4.5) * k, wid = Math.max(2, u.width * k);
      g.fillStyle = u.kind === 'ped' ? '#c9b48a' : '#8f9aa8';
      g.fillRect(q[0] - wid / 2, q[1] - Math.max(3, len) / 2, wid, Math.max(3, len));
    });
    // the camera's detections, coloured by class; the cause ringed
    const cause = app.last.out.cause;
    (app.last.out.details.lights || []).forEach((L) => {
      if (L.az_deg === null) return;
      const d = L.dist_m === null ? range * 0.9 : L.dist_m;
      const x = W / 2 + Math.sin(L.az_deg * Math.PI / 180) * d * k, y = H - 30 - Math.cos(L.az_deg * Math.PI / 180) * d * k;
      g.fillStyle = css(KIND_VAR[L.kind] || '--other'); g.beginPath(); g.arc(x, y, L.strong ? 4 : 3, 0, 7); g.fill();
      if (cause && cause.src === L.src && cause.id === L.id) { g.strokeStyle = css('--accent'); g.lineWidth = 2; g.beginPath(); g.arc(x, y, 8, 0, 7); g.stroke(); }
    });
    // our car
    g.fillStyle = '#e6e9ee'; g.fillRect(W / 2 - 0.9 * k - 2, H - 30, 1.8 * k + 4, 8);
    g.fillStyle = '#9aa3ae'; g.font = '11px system-ui'; g.fillText(range + ' m', 8, 16);
  }
  function drawSide() {
    const cv = $('side'), g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.fillStyle = css('--night'); g.fillRect(0, 0, W, H);
    if (!app.last || !app.last.truth) return;
    const w = app.run.world, ego = app.last.truth.ego, range = Number($('zoom').value);
    const kx = (W - 20) / range;
    let zmin = 1e9, zmax = -1e9;
    for (let s = ego.s; s <= ego.s + range; s += 10) { const z = w.road.z(s); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    const ky = (H - 30) / Math.max(10, zmax - zmin + 6);
    const X = (s) => 10 + (s - ego.s) * kx, Y = (z) => H - 10 - (z - zmin) * ky;
    g.strokeStyle = css('--lane'); g.lineWidth = 2; g.beginPath();
    for (let s = ego.s; s <= ego.s + range; s += 5) { const x = X(s), y = Y(w.road.z(s)); if (s === ego.s) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
    w.users(app.last.t / 1000).forEach((u) => { if (u.s < ego.s || u.s > ego.s + range) return; g.fillStyle = '#8f9aa8'; g.fillRect(X(u.s) - 2, Y(w.road.z(u.s) + u.height), 4, u.height * ky); });
    g.fillStyle = '#e6e9ee'; g.fillRect(X(ego.s) - 2, Y(w.road.z(ego.s) + 1.5), 6, 1.5 * ky);
    g.fillStyle = '#9aa3ae'; g.font = '11px system-ui'; g.fillText('side view (heights ×' + (ky / kx).toFixed(0) + ')', 8, 14);
  }
  function statusView() {
    const o = app.last ? app.last.out : null;
    if (!o) return;
    const hold = o.holdUntil !== null ? ((o.holdUntil - o.t) / 1000).toFixed(1) + ' s' : '–';
    const d = o.details;
    const u = d.urban || {};
    $('status').innerHTML = '<div class="big ' + o.state + '">' + (o.want === 'high' ? 'High beam' : 'Dip') + '</div>' +
      '<table><tr><td>t</td><td>' + (o.t / 1000).toFixed(1) + ' s</td></tr><tr><td>state</td><td>' + o.state + '</td></tr><tr><td>reason</td><td>' + o.reason + '</td></tr>' +
      '<tr><td>cause</td><td>' + (o.cause ? o.cause.kind + ' #' + o.cause.id + (o.cause.dist_m !== null ? ' at ' + Math.round(o.cause.dist_m) + ' m' : '') : '–') + '</td></tr>' +
      '<tr><td>return in</td><td>' + hold + '</td></tr><tr><td>confidence</td><td>' + o.confidence + '</td></tr>' +
      '<tr><td>dark / speed ok</td><td>' + d.dark + ' / ' + d.speedOk + '</td></tr><tr><td>town</td><td>' + (u.on ? 'yes (' + u.src + ')' : 'no') + '</td></tr>' +
      '<tr><td>weather / curve</td><td>' + d.weather + ' / ' + d.curve + '</td></tr><tr><td>lights seen</td><td>' + d.lights.length + ' (street ' + d.street + ')</td></tr>' +
      '<tr><td>stale</td><td>' + (d.stale.join(', ') || '–') + '</td></tr><tr><td>camera verdict</td><td>' + (d.verdict ? String(d.verdict.allow) + ' (' + d.verdict.use + ')' : 'silent') + '</td></tr>' +
      '<tr><td>speed</td><td>' + (app.last.truth ? Math.round(app.last.truth.ego.v_kmh) + ' km/h' : '–') + '</td></tr></table>';
  }
  function metricsView() {
    const m = app.full.metrics;
    const keys = ['glareW', 'glare_s', 'maxReaction_ms', 'missed_s', 'highFrac', 'switches', 'switchesPerKm', 'minDwell_ms', 'agreeRef', 'refGlareW', 'agreeDriver', 'agreeVerdict', 'overrideGlareW'];
    $('metrics').innerHTML = '<table>' + keys.map((k) => '<tr><td>' + k + '</td><td>' + r3(m[k]) + '</td></tr>').join('') +
      '<tr><td>verdict</td><td class="' + (app.full.verdict.pass ? 'pass">pass' : 'fail">' + app.full.verdict.failed.join(', ')) + '</td></tr></table>';
  }
  function drawAll() {
    drawTop(); drawSide(); statusView();
    $('timeline').innerHTML = BS.timeline.svg(app.full, { width: 1100, cursor: app.last ? (app.last.t - (app.full.meta.replay && app.scn.frames.length ? app.scn.frames[0].t : 0)) / 1000 : 0,
      driverLabel: app.full.meta.replay ? 'recorded driver: high' : 'reference driver: high' });
  }

  // ---- playback ----
  function frameLoop(ts) {
    if (!app.playing) return;
    const dt = app.tPrev ? Math.min(0.25, (ts - app.tPrev) / 1000) : 0;
    app.tPrev = ts;
    app.acc += dt * Number($('speed').value) * 1000;
    while (app.acc >= app.run.tick && !app.run.done) { app.last = app.run.step() || app.last; app.acc -= app.run.tick; }
    drawAll();
    if (app.run.done) { app.playing = false; $('play').textContent = 'Play'; return; }
    requestAnimationFrame(frameLoop);
  }

  // ---- settings ----
  function field(row, get, set) {
    const lab = document.createElement('label');
    if (row.assumed) lab.className = 'assumed';
    lab.title = (row.help || '') + (row.source ? '  [' + row.source + ']' : '') + (row.assumed ? '  (assumed: the car has not confirmed it)' : '');
    lab.innerHTML = '<span>' + row.key + (row.unit ? ' (' + row.unit + ')' : '') + '</span>';
    let inp;
    const cur = get();
    if (row.options || row.type === 'enum') {
      inp = document.createElement('select');
      (row.options || []).forEach((o) => { const op = document.createElement('option'); op.textContent = o; inp.appendChild(op); });
      inp.value = cur;
      inp.onchange = () => set(inp.value);
    } else if (row.type === 'bool' || typeof row.def === 'boolean') {
      inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!cur;
      inp.onchange = () => set(inp.checked);
    } else {
      inp = document.createElement('input'); inp.type = 'number'; inp.value = cur;
      if (row.min !== null && row.min !== undefined) inp.min = row.min; if (row.max !== null && row.max !== undefined) inp.max = row.max; if (row.step) inp.step = row.step;
      inp.onchange = () => { const v = Number(inp.value); if (isFinite(v)) set(v); };
    }
    lab.appendChild(inp);
    return lab;
  }
  function buildSettings() {
    const ls = $('logicset'); ls.innerHTML = '';
    let group = '';
    B.SCHEMA.forEach((row) => {
      if (['num', 'enum', 'bool'].indexOf(row.type) < 0) return;
      const gname = row.key.split('.')[0];
      if (gname !== group) { group = gname; const h = document.createElement('h4'); h.textContent = 'algorithm: ' + gname; ls.appendChild(h); }
      ls.appendChild(field(row, () => { const v = B.getPath(app.logic, row.key); return v === undefined ? row.def : v; },
        (v) => { const ks = row.key.split('.'); let c = app.logic; for (let i = 0; i < ks.length - 1; i++) { c[ks[i]] = c[ks[i]] || {}; c = c[ks[i]]; } c[ks[ks.length - 1]] = v; save(); restart(); }));
    });
    const ss = $('sensorset'); ss.innerHTML = '<h4>sensor (what the car may turn out to be)</h4>';
    BS.sensor.PARAMS.forEach((p) => {
      const row = { key: p[0], def: p[1], unit: p[2], min: p[3], max: p[4], help: p[5], type: typeof p[1] === 'number' ? 'num' : typeof p[1] === 'boolean' ? 'bool' : 'enum',
        options: p[0] === 'verdict' ? ['silent', 'present'] : null };
      ss.appendChild(field(row, () => (app.sensor[p[0]] === undefined ? p[1] : app.sensor[p[0]]), (v) => { app.sensor[p[0]] = v; save(); restart(); }));
    });
  }

  // ---- batch ----
  function runBatch() {
    const seeds = $('bseeds').value.split(',').map(Number).filter((x) => x > 0);
    const list = BS.scenario.list();
    const rows = [];
    let i = 0;
    $('btable').innerHTML = ''; $('btotals').innerHTML = '';
    function next() {
      if (i >= list.length) return done();
      const s = BS.scenario.load(list[i].id);
      $('bprog').textContent = (i + 1) + ' / ' + list.length + '  ' + s.id;
      const r = BS.batch.runAll({ scenarios: [s], seeds: seeds, config: runOpts().config, sensor: app.sensor });
      r.rows.forEach((x) => rows.push(x));
      i++;
      setTimeout(next, 0);
    }
    function done() {
      const T = BS.batch.totalsOf(rows), C = BS.batch.totalsOf(rows.filter((x) => !x.limit));
      $('bprog').textContent = rows.length + ' runs';
      $('btotals').innerHTML = '<table><tr><th></th><th>core</th><th>all</th></tr>' + Object.keys(T).map((k) => '<tr><td>' + k + '</td><td>' + r3(C[k]) + '</td><td>' + r3(T[k]) + '</td></tr>').join('') + '</table>';
      const cols = ['glareW', 'maxReaction_ms', 'missed_s', 'highFrac', 'switches', 'agreeRef'];
      $('btable').innerHTML = '<table><tr><th>scenario</th><th>seed</th>' + cols.map((c) => '<th>' + c + '</th>').join('') + '<th>verdict</th></tr>' +
        rows.map((x) => '<tr><td>' + x.id + (x.limit ? ' *' : '') + '</td><td>' + x.seed + '</td>' + cols.map((c) => '<td>' + r3(x.metrics[c]) + '</td>').join('') +
          '<td class="' + (x.verdict.pass ? 'pass">pass' : 'fail">' + x.verdict.failed.join(', ')) + '</td></tr>').join('') + '</table>';
    }
    next();
  }

  // ---- wiring ----
  function init() {
    const sel = $('scn');
    let fam = null, og = null;
    BS.scenario.list().forEach((s) => {
      if (s.family !== fam) { fam = s.family; og = document.createElement('optgroup'); og.label = s.family + ' — ' + (BS.scenario.FAMILIES[s.family] || ''); sel.appendChild(og); }
      const o = document.createElement('option'); o.value = s.id; o.textContent = s.id + ' — ' + s.name; og.appendChild(o);
    });
    try { const saved = JSON.parse(localStorage.getItem('beam-sim') || 'null'); if (saved && saved.scn) sel.value = saved.scn; } catch (e) { /* none */ }
    if (!sel.value && sel.options.length) sel.value = sel.options[0].value;
    sel.onchange = () => { save(); restart(); };
    $('seed').onchange = restart;
    $('zoom').onchange = drawAll;
    $('play').onclick = () => { app.playing = !app.playing; $('play').textContent = app.playing ? 'Pause' : 'Play'; app.tPrev = 0; if (app.playing) { if (app.run.done) restart(); requestAnimationFrame(frameLoop); } };
    $('step').onclick = () => { if (!app.run.done) { app.last = app.run.step() || app.last; drawAll(); } };
    $('restart').onclick = restart;
    ['mode', 'verdict', 'weather', 'preset'].forEach((k) => { $(k).onchange = () => { app.opts[k] = $(k).value; restart(); }; });
    $('resetcfg').onclick = () => { app.logic = {}; app.sensor = {}; save(); buildSettings(); restart(); };
    $('timeline').onclick = (ev) => {
      const svg = $('timeline').querySelector('svg'); if (!svg) return;
      const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal;
      const x = (ev.clientX - r.left) / r.width * vb.width;
      const S = app.full.series; const t0 = S.t[0], t1 = S.t[S.t.length - 1];
      seek(t0 + Math.max(0, x - 150) / (vb.width - 156) * (t1 - t0));
    };
    document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === b));
      document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + b.dataset.tab));
    }; });
    $('brun').onclick = runBatch;
    buildSettings();
    // a link can name the scenario and the time: index.html#scn=B01.oncoming.single&t=34&seed=2
    const hash = {};
    String(location.hash || '').replace(/^#/, '').split('&').forEach((kv) => { const p = kv.split('='); if (p[0]) hash[p[0]] = decodeURIComponent(p[1] || ''); });
    if (hash.scn && BS.scenario.list().some((x) => x.id === hash.scn)) sel.value = hash.scn;
    if (hash.seed) $('seed').value = hash.seed;
    if (hash.zoom) $('zoom').value = hash.zoom;
    restart();
    if (hash.t) seek(Number(hash.t));
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
})();
