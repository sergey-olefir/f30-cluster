'use strict';
// A run's timeline as an SVG string (the page and report.js share it): the advice's state and reason as a coloured
// band, the advice (high / low), the reference or recorded driver, the camera's verdict, the truth (someone in the
// beam; high allowed), and the switch marks. Pure string building, no DOM.
(function () {
  const STATE_COL = { UNAVAILABLE: '#7a7f87', STANDBY: '#a9b1bb', HIGH: '#3d7be0', DIPPED: '#c9a227', OVERRIDE: '#9a5cd0' };
  const ROWS = [
    ['state', 'state / reason'], ['want', 'advice: high'], ['ref', 'driver: high'], ['verdict', 'camera verdict: allow'],
    ['glare', 'someone in our high beam'], ['allowed', 'high allowed (truth)'],
  ];
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /** res: a sim result; o: { width, cursor (s), driverLabel } */
  function svg(res, o) {
    const opt = o || {};
    const S = res.series;
    const n = S.t.length;
    const W = opt.width || 900, L = 150, rowH = 16, gap = 4, top = 4;
    const H = top + ROWS.length * (rowH + gap) + 18;
    const t0 = n ? S.t[0] : 0, t1 = n ? S.t[n - 1] : 1;
    const x = (t) => L + (t - t0) / Math.max(1e-9, t1 - t0) * (W - L - 6);
    const states = res.meta.enums.state, reasons = res.meta.enums.reason;
    const parts = ['<svg xmlns="http://www.w3.org/2000/svg" class="timeline" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="timeline">'];
    ROWS.forEach((r, k) => {
      const y = top + k * (rowH + gap);
      const label = r[0] === 'ref' && opt.driverLabel ? opt.driverLabel : r[1];
      parts.push('<text x="' + (L - 6) + '" y="' + (y + rowH - 4) + '" text-anchor="end" class="tl-label">' + esc(label) + '</text>');
      parts.push('<rect x="' + L + '" y="' + y + '" width="' + (W - L - 6) + '" height="' + rowH + '" class="tl-bg"/>');
      // runs of equal value
      let i = 0;
      while (i < n) {
        let v, key;
        if (r[0] === 'state') { v = S.state[i]; key = v + ':' + S.reason[i]; }
        else if (r[0] === 'want') v = S.want[i];
        else if (r[0] === 'ref') v = !isNaN(S.driver[i]) ? S.driver[i] : S.ref[i];
        else if (r[0] === 'verdict') v = S.verdict[i];
        else if (r[0] === 'glare') v = S.glareN[i] > 0 ? 1 : 0;
        else v = S.allowed[i];
        if (key === undefined) key = String(v);
        let j = i + 1;
        while (j < n) {
          let k2;
          if (r[0] === 'state') k2 = S.state[j] + ':' + S.reason[j];
          else if (r[0] === 'want') k2 = String(S.want[j]);
          else if (r[0] === 'ref') k2 = String(!isNaN(S.driver[j]) ? S.driver[j] : S.ref[j]);
          else if (r[0] === 'verdict') k2 = String(S.verdict[j]);
          else if (r[0] === 'glare') k2 = String(S.glareN[j] > 0 ? 1 : 0);
          else k2 = String(S.allowed[j]);
          if (k2 !== key) break;
          j++;
        }
        const xa = x(S.t[i]), xb = j < n ? x(S.t[j]) : x(t1) + 1;
        let fill = null, title = '';
        if (r[0] === 'state') { const st = states[S.state[i]]; fill = STATE_COL[st] || '#888'; title = st + ' / ' + reasons[S.reason[i]]; }
        else if (v === 1) fill = r[0] === 'glare' ? '#d9822b' : r[0] === 'allowed' ? '#5aa469' : '#3d7be0';
        else if (v === 0 && r[0] !== 'glare' && r[0] !== 'allowed') fill = '#c8ccd2';
        if (fill) parts.push('<rect x="' + xa.toFixed(1) + '" y="' + y + '" width="' + Math.max(0.5, xb - xa).toFixed(1) + '" height="' + rowH + '" fill="' + fill + '">' +
          (title ? '<title>' + esc(title + ' from ' + S.t[i].toFixed(1) + ' s') + '</title>' : '') + '</rect>');
        i = j;
      }
    });
    // the time axis
    const yAx = top + ROWS.length * (rowH + gap) + 12;
    const step = t1 - t0 > 120 ? 30 : t1 - t0 > 40 ? 10 : 5;
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) parts.push('<text x="' + x(t).toFixed(1) + '" y="' + yAx + '" text-anchor="middle" class="tl-axis">' + t + ' s</text>');
    if (typeof opt.cursor === 'number') parts.push('<line x1="' + x(opt.cursor).toFixed(1) + '" x2="' + x(opt.cursor).toFixed(1) + '" y1="0" y2="' + (H - 14) + '" class="tl-cursor"/>');
    parts.push('</svg>');
    return parts.join('');
  }
  const X = { svg: svg, STATE_COL: STATE_COL, esc: esc };
  if (typeof module !== 'undefined') module.exports = X; else (self.BS = self.BS || {}).timeline = X;
})();
