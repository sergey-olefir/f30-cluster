'use strict';
/**
 * scene.js (SU1) - the animated road (brief §4.1).
 *
 * buildScene(frame, opts) is pure: it turns one frame (app.js frameAt) into a display list of
 * simple ops (rect, srect, line, poly, circle, text) in CSS pixels. paint(ctx, ops) plays the list
 * on a 2D canvas; tests/scene-png.js plays the same list on kit/runtime/canvas.js to write PNGs.
 *
 * The picture, from above, scrolling with our car (driving to the right; lane 0 = ours, at the bottom):
 *   status chips (warning, faults, sensor state, driver actions, dropped commands) · the road with every
 *   vehicle, lane changes, brake lights, the zone of the needed distance (red) and of the desired gap
 *   (green), the sensor's target (brackets; red with "WRONG TARGET" when it is not the true lead) and its
 *   measured gap (a teal tick across the lane) · under the road the true gap and the measured / estimated
 *   gap as dimension lines, a ruler · the elevation profile (the grade, height exaggerated) · the readout.
 */
(function () {
    const KMH = 3.6;
    const LANE_M = 3.5;

    const THEMES = {
        light: {
            bg: '#f4f5f7', panel: '#ffffff', panelLine: '#d5d9e0', text: '#1b2130', muted: '#5d6676', faint: '#8a93a3',
            road: '#474c55', roadEdge: '#e9ebee', mark: '#e9ebee', shoulder: '#e3e6eb',
            ego: '#2f6fde', lead: '#e07b1a', other: '#9aa1ad', brake: '#ff3b30',
            trueGap: '#1b2130', meas: '#0b9c8c', est: '#7a4fd6', des: '#23994f', desZone: '#23994f40',
            need: '#e5484d', needZone: '#e5484d38', warn: '#d93036', fault: '#b87800', faultBg: '#fff3d6',
            warnBg: '#fde4e4', okBg: '#e3f5ea', infoBg: '#e4ecfb', info: '#2f5fbf', chipBg: '#eceef2',
            profile: '#5d6676', profileFill: '#5d667622', grid: '#1b213012', fake: '#d9303622',
        },
        dark: {
            bg: '#14171c', panel: '#1c2027', panelLine: '#2f3540', text: '#e6e9ef', muted: '#a2abba', faint: '#6f7888',
            road: '#2b2f36', roadEdge: '#7d8594', mark: '#aab1bd', shoulder: '#1f232a',
            ego: '#5b93ff', lead: '#ff9a3c', other: '#7c8494', brake: '#ff4d42',
            trueGap: '#e6e9ef', meas: '#2dd4bf', est: '#b18cff', des: '#3fcf74', desZone: '#3fcf7438',
            need: '#ff6369', needZone: '#ff636933', warn: '#ff5a5f', fault: '#f0b429', faultBg: '#3a2f12',
            warnBg: '#3d1a1c', okBg: '#173322', infoBg: '#1b2945', info: '#8fb3ff', chipBg: '#262b33',
            profile: '#a2abba', profileFill: '#a2abba22', grid: '#ffffff10', fake: '#ff5a5f22',
        },
    };

    const finite = (v) => typeof v === 'number' && v === v && isFinite(v);
    const fmt = (v, d) => (finite(v) ? v.toFixed(d == null ? 1 : d) : '—');
    const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
    /** Rough text width for layout (the list must be pure; the browser's measureText is not used). */
    const textW = (s, size, bold) => String(s).length * size * (bold ? 0.6 : 0.56);
    const idTxt = (id) => (typeof id === 'number' ? '#' + id : String(id));

    /* ------------------------------------------------------------------ per-result helpers */

    /** View range (m ahead of our front bumper) that fits the run: the gaps and zones it shows, 40..300 m. */
    function fitRange(r) {
        const s = r.series, pick = ['gap.true', 'gap.meas', 'd.des', 'd.needed'];
        let m = 0;
        for (const n of pick) {
            const a = s[n];
            if (!a) continue;
            for (let i = 0; i < a.length; i++) if (a[i] === a[i] && a[i] < 400 && a[i] > m) m = a[i];
        }
        return clamp(Math.ceil(m * 1.2 / 10) * 10, 40, 300);
    }

    /** Height profile of the road from the run: z(x) from the grade our car drove over (trapezoids along ego.x). */
    function elevationProfile(r) {
        const X = r.series['ego.x'], G = r.series.grade, E = r.series.elevation;
        if (X && E && E.some((v) => v === v && v !== 0)) {          // the engine's own elevation (SC1) when it has one
            const xs = [], zs = [];
            for (let i = 0; i < X.length; i++) if (X[i] === X[i] && E[i] === E[i] && (!xs.length || X[i] > xs[xs.length - 1] + 1e-6)) { xs.push(X[i]); zs.push(E[i]); }
            if (xs.length > 1) return { xs, zs, any: true };
        }
        if (!X || !G) return null;
        const xs = [], zs = [];
        let z = 0, any = false, gPrev = 0;
        for (let i = 0; i < X.length; i++) {
            const x = X[i], g = G[i] === G[i] ? G[i] : 0;
            if (x !== x) continue;
            if (g !== 0) any = true;
            if (xs.length) {
                const dx = x - xs[xs.length - 1];
                if (dx <= 1e-6) continue;
                z += dx * (g + gPrev) / 2;
            }
            xs.push(x); zs.push(z); gPrev = g;
        }
        return xs.length > 1 ? { xs, zs, any } : null;
    }
    function zAt(p, x) {
        const xs = p.xs, zs = p.zs, n = xs.length;
        if (x <= xs[0]) return zs[0];
        if (x >= xs[n - 1]) return zs[n - 1];
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
        return zs[lo] + (zs[hi] - zs[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo]);
    }

    function lanesOf(r) {
        let n = (r && r.meta && r.meta.lanes) || 0;
        if (r) for (const k of Object.keys(r.series)) if (/^veh\..+\.lane$/.test(k)) for (const v of r.series[k]) if (v === v && v + 1 > n) n = v + 1;
        return clamp(Math.ceil(n - 1e-9), 2, 5);
    }

    /* ------------------------------------------------------------------ the display list */

    function buildScene(fr, o) {
        o = o || {};
        const W = o.width || 960, H = o.height || 360;
        const th = THEMES[o.theme] || THEMES.light;
        const ops = [];
        const rect = (x, y, w, h, fill, r) => { if (w > 0 && h > 0) ops.push({ k: 'rect', x, y, w, h, fill, r: r || 0 }); };
        const srect = (x, y, w, h, color, lw, dash) => ops.push({ k: 'srect', x, y, w, h, color, lw: lw || 1, dash: dash || null });
        const line = (x1, y1, x2, y2, color, lw, dash) => ops.push({ k: 'line', x1, y1, x2, y2, color, lw: lw || 1, dash: dash || null });
        const poly = (pts, fill) => ops.push({ k: 'poly', pts, fill });
        const circle = (x, y, r, fill) => ops.push({ k: 'circle', x, y, r, fill });
        const text = (s, x, y, size, color, align, bold) => ops.push({ k: 'text', s: String(s), x, y, size, color, align: align || 'left', bold: !!bold });

        rect(0, 0, W, H, th.bg);
        const panelW = W >= 700 ? Math.min(260, Math.round(W * 0.28)) : 0;
        const x0 = 10, x1 = W - panelW - (panelW ? 14 : 10);
        const lanes = o.lanes || 2;
        const laneH = 30;
        const chipY = 8, chipH = 22;
        const roadTop = chipY + chipH + 18, roadBot = roadTop + lanes * laneH;
        const rowTrue = roadBot + 16, rowMeas = roadBot + 34, rulerY = roadBot + 52;
        const profTop = rulerY + 26, profBot = H - 10;
        const aheadM = o.aheadM || 120, backM = Math.max(14, aheadM * 0.22);
        const ppm = (x1 - x0) / (aheadM + backM);
        const X = (m) => x0 + (backM + m) * ppm;           // m relative to our front bumper -> px
        const laneY = (l) => roadBot - (l + 0.5) * laneH;   // lane (fractional) -> centre px

        // road and shoulders
        rect(x0, roadTop - 6, x1 - x0, lanes * laneH + 12, th.shoulder);
        rect(x0, roadTop, x1 - x0, lanes * laneH, th.road);
        line(x0, roadTop + 1, x1, roadTop + 1, th.roadEdge, 2);
        line(x0, roadBot - 1, x1, roadBot - 1, th.roadEdge, 2);

        if (!fr) {
            text(o.message || 'No run yet — press Run, or open a result file.', (x0 + x1) / 2, (roadTop + roadBot) / 2 + 5, 14, th.mark, 'center', true);
            if (panelW) drawPanelFrame();
            return { ops, layout: { x0, x1, roadTop, roadBot, ppm, aheadM, backM } };
        }

        const s = fr.s, ego = fr.ego;
        const egoX = finite(ego.x) ? ego.x : 0;
        // dashed lane markings, scrolling with the world (3 m dash every 12 m)
        const period = 12, dash = 3;
        const wStart = egoX - backM, wEnd = egoX + aheadM;
        for (let l = 1; l < lanes; l++) {
            const y = roadBot - l * laneH;
            for (let xw = Math.floor(wStart / period) * period; xw < wEnd; xw += period) {
                const a = Math.max(X(xw - egoX), x0), b = Math.min(X(xw + dash - egoX), x1);
                if (b > a) rect(a, y - 1, b - a, 2, th.mark);
            }
        }

        // zones in our lane: needed distance (red), desired gap ±10 % (green)
        const yl0 = roadBot - laneH + 3, ylh = laneH - 6;
        const zone = (m0, m1, fill) => { const a = clamp(X(m0), x0, x1), b = clamp(X(m1), x0, x1); if (b > a) rect(a, yl0, b - a, ylh, fill); };
        if (finite(s['d.needed']) && s['d.needed'] > 0) {
            zone(0, s['d.needed'], th.needZone);
            const xn = X(s['d.needed']);
            if (xn <= x1) { line(xn, yl0 - 4, xn, yl0 + ylh + 4, th.need, 2, [4, 3]); text('needed', xn - 3, roadTop - 9, 10, th.need, 'right', true); }
        }
        if (finite(s['d.des']) && s['d.des'] > 0) {
            zone(s['d.des'] * 0.9, s['d.des'] * 1.1, th.desZone);
            const xd = X(s['d.des']);
            if (xd <= x1) { line(xd, yl0, xd, yl0 + ylh, th.des, 2); text('desired', xd + 3, roadTop - 9, 10, th.des, 'left', true); }
        }

        // vehicles
        const drawCar = (v, color, label) => {
            const rel = v.x - egoX;                         // front bumper relative to ours
            const lenPx = Math.max(7, v.length * ppm);
            const xr = X(rel) - lenPx, xf = X(rel);
            const lanePos = v.lane + (finite(v.lat) ? v.lat : 0) / LANE_M;
            const yc = laneY(lanePos);
            const wPx = clamp(laneH * (v.width || 1.8) / LANE_M, 6, laneH - 4);
            if (xf < x0 || xr > x1) return { off: xf < x0 ? 'behind' : 'ahead', rel };
            const a = Math.max(xr, x0), b = Math.min(xf, x1);
            rect(a, yc - wPx / 2, b - a, wPx, color, Math.min(4, wPx / 3));
            // windscreen hint toward the front
            if (lenPx > 14 && xf - 0.32 * lenPx > a && xf - 0.18 * lenPx < b) rect(xf - 0.32 * lenPx, yc - wPx / 2 + 2, 0.12 * lenPx, wPx - 4, '#00000038');
            if (finite(v.a) && v.a < -1 && xr >= x0) {
                rect(xr - 1, yc - wPx / 2 + 1, 3, 4, th.brake); rect(xr - 1, yc + wPx / 2 - 5, 3, 4, th.brake);
            }
            if (label && textW(label, 10, true) < b - a - 4) text(label, (a + b) / 2, yc + 4, 10, '#ffffff', 'center', true);
            return { x: xr, y: yc - wPx / 2, w: xf - xr, h: wPx, rel };
        };

        const boxes = {};
        let leadOff = null;
        for (const v of fr.vehicles) {
            const isLead = v.role === 'lead';
            const b = drawCar(v, isLead ? th.lead : th.other, idTxt(v.id));
            boxes[String(v.id)] = b;
            if (isLead && b.off === 'ahead') leadOff = b;
        }
        const egoBox = drawCar({ x: egoX, length: ego.length, width: ego.width, lane: ego.lane, lat: ego.lat, a: ego.a }, th.ego, 'EGO');
        if (leadOff) {
            const y = laneY(0);
            poly([[x1 - 2, y], [x1 - 12, y - 7], [x1 - 12, y + 7]], th.lead);
            text('lead ' + fmt(leadOff.rel, 0) + ' m', x1 - 15, y - 9, 10, th.lead, 'right', true);
        }

        // the sensor: measured gap tick across our lane, a ray from our bumper, brackets on its target
        const measOk = fr.sensor.valid && finite(s['gap.meas']);
        if (measOk) {
            const xm = X(s['gap.meas']);
            if (xm <= x1) {
                line(X(0), laneY(0), Math.min(xm, x1), laneY(0), th.meas + '88', 1, [2, 3]);
                line(xm, yl0 - 2, xm, yl0 + ylh + 2, th.meas, 2);
            }
        }
        const tgt = fr.sensor.targetId != null ? boxes[String(fr.sensor.targetId)] : null;
        if (fr.sensor.valid && tgt && !tgt.off) {
            const c = fr.sensor.wrong ? th.warn : th.meas, p = 4, L = 6;
            const bx0 = tgt.x - p, by0 = tgt.y - p, bx1 = tgt.x + tgt.w + p, by1 = tgt.y + tgt.h + p;
            [[bx0, by0, 1, 1], [bx1, by0, -1, 1], [bx0, by1, 1, -1], [bx1, by1, -1, -1]].forEach(([cx, cy, sx, sy]) => {
                line(cx, cy, cx + sx * L, cy, c, 2); line(cx, cy, cx, cy + sy * L, c, 2);
            });
            if (fr.sensor.wrong) {
                const right = bx1 + 6 + textW('WRONG TARGET', 10, true) < x1;
                text('WRONG TARGET', right ? bx1 + 6 : bx0 - 6, (by0 + by1) / 2 + 4, 10, th.warn, right ? 'left' : 'right', true);
            }
        }
        if (fr.sensor.none) text('no target', X(0) + 6, laneY(0) - laneH / 2 + 11, 10, th.mark);

        // dimension lines under the road: true gap, measured gap (+ estimated as a diamond)
        const dimLine = (y, m, color, label, dashed) => {
            const a = X(0), b = clamp(X(m), x0, x1);
            line(a, y, b, y, color, 1.5, dashed ? [4, 3] : null);
            line(a, y - 4, a, y + 4, color, 1.5);
            if (X(m) <= x1) line(b, y - 4, b, y + 4, color, 1.5);
            const lx = Math.max(b + 4, a + 4);
            const tx = lx + textW(label, 10) > x1 ? b - 4 : lx;
            text(label, tx, y + 4, 10, color, tx === lx ? 'left' : 'right', true);
        };
        if (finite(s['gap.true'])) dimLine(rowTrue, s['gap.true'], th.trueGap, 'true ' + fmt(s['gap.true'], 1) + ' m');
        else text('no vehicle ahead in our lane', X(0) + 4, rowTrue + 4, 10, th.muted);
        if (measOk) dimLine(rowMeas, s['gap.meas'], th.meas, 'measured ' + fmt(s['gap.meas'], 1) + ' m' + (finite(s['gap.true']) ? ' (err ' + (s['gap.meas'] - s['gap.true'] >= 0 ? '+' : '') + fmt(s['gap.meas'] - s['gap.true'], 1) + ')' : ''), true);
        else text('sensor: no target', X(0) + 4, rowMeas + 4, 10, th.meas);
        if (finite(s['est.gap']) && X(s['est.gap']) <= x1) {
            const xe = X(s['est.gap']), d = 4;
            poly([[xe, rowMeas - d], [xe + d, rowMeas], [xe, rowMeas + d], [xe - d, rowMeas]], th.est);
        }
        // ruler: ticks every 10 / 50 m from our bumper
        const step = aheadM > 150 ? 50 : aheadM > 60 ? 20 : 10;
        line(x0, rulerY, x1, rulerY, th.faint, 1);
        for (let m = -Math.floor(backM / step) * step; m <= aheadM; m += step) {
            const x = X(m);
            if (x < x0 || x > x1) continue;
            line(x, rulerY - 3, x, rulerY + 3, th.faint, 1);
            if (x < x0 + 12 || x > x1 - 14) continue;                 // no label cut by the edge
            text((m > 0 ? '+' : '') + m + (m === 0 ? ' m' : ''), x, rulerY + 14, 9, th.muted, 'center');
        }

        // elevation profile (the grade), height ×exag around our position
        if (profBot - profTop > 24) {
            rect(x0, profTop, x1 - x0, profBot - profTop, th.panel, 4);
            const prof = o.profile;
            const z0 = prof ? zAt(prof, egoX) : 0;
            const xKnown = prof ? prof.xs[prof.xs.length - 1] : Infinity;
            const zs = [];
            let zLo = 0, zHi = 0;
            for (let i = 0; i <= 80; i++) {
                const m = -backM + (aheadM + backM) * i / 80, z = (prof ? zAt(prof, egoX + m) : 0) - z0;
                zs.push([m, z]); zLo = Math.min(zLo, z); zHi = Math.max(zHi, z);
            }
            // height exaggeration: up to ×10, less when the visible rise would not fit the strip
            const room = profBot - profTop - 34;
            const exag = Math.max(1, Math.min(10, Math.floor(room / Math.max(1e-6, (zHi - zLo) * ppm))));
            const midY = profTop + 24 + room * (zHi - zLo > 0 ? zHi / (zHi - zLo) : 0.5);
            const Zy = (z) => clamp(midY - z * ppm * exag, profTop + 3, profBot - 3);
            const pts = zs.map(([m, z]) => [X(m), Zy(z), egoX + m > xKnown]);
            for (let i = 1; i < pts.length; i++) {
                poly([[pts[i - 1][0], pts[i - 1][1]], [pts[i][0], pts[i][1]], [pts[i][0], profBot - 1], [pts[i - 1][0], profBot - 1]], th.profileFill);
                line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], pts[i][2] ? th.faint : th.profile, 2, pts[i][2] ? [3, 3] : null);
            }
            const zOf = (x) => (prof ? zAt(prof, x) : 0) - z0;
            const lead = fr.vehicles.find((v) => v.role === 'lead');
            if (lead && X(lead.x - egoX) <= x1) circle(X(lead.x - egoX - lead.length / 2), Zy(zOf(lead.x - lead.length / 2)) - 4, 4, th.lead);
            circle(X(-ego.length / 2), Zy(zOf(egoX - ego.length / 2)) - 4, 4.5, th.ego);
            const g = s.grade;
            const gTxt = finite(g) ? (g === 0 ? 'flat road' : 'grade ' + (g > 0 ? '+' : '') + fmt(g * 100, 1) + ' % ' + (g > 0 ? '(uphill)' : '(downhill)')) : 'grade: no data';
            text(gTxt, x0 + 8, profTop + 14, 11, th.text, 'left', true);
            text('side view · height ×' + exag + (prof && prof.any ? ' · dashed: beyond where the run went' : ' · no grade in this run'), x1 - 8, profTop + 14, 9, th.muted, 'right');
            if (fr.fake) text('FAKE DATA — SU1 stand-in, not the simulator', (x0 + x1) / 2, profBot - 12, 13, th.warn, 'center', true);
        }

        // status chips: warning, collision, faults, sensor, driver, commands
        const chips = [];
        if (fr.collision) chips.push({ s: 'COLLISION' + (finite(fr.collision.impact) ? ' · ' + fmt(Math.abs(fr.collision.impact) * KMH, 0) + ' km/h' : ''), fg: '#ffffff', bg: th.warn });
        if (fr.warn) chips.push({ s: 'WARNING' + (fr.warnReason ? ' · ' + fr.warnReason : '') + (finite(s.ttc) ? ' · TTC ' + fmt(s.ttc, 1) + ' s' : ''), fg: '#ffffff', bg: th.warn });
        if (fr.appAlive === false) chips.push({ s: 'APP NOT RUNNING · no commands, no warning', fg: '#ffffff', bg: th.fault });
        for (const f of fr.faults) chips.push({ s: 'FAULT · ' + f.name + ' · ' + fmt(fr.t - f.t0, 1) + ' s', fg: th.fault, bg: th.faultBg });
        if (fr.sensor.wrong) chips.push({ s: 'SENSOR · wrong target ' + idTxt(fr.sensor.targetId), fg: th.warn, bg: th.warnBg });
        else if (fr.sensor.none) chips.push({ s: 'SENSOR · no target', fg: th.muted, bg: th.chipBg });
        if (finite(s['driver.brake']) && s['driver.brake'] > 0) chips.push({ s: 'DRIVER BRAKES · ' + fmt(s['driver.brake'], 1) + ' m/s²', fg: '#ffffff', bg: th.info });
        if (finite(s['driver.accel']) && s['driver.accel'] > 0) chips.push({ s: 'DRIVER ACCELERATOR · ' + fmt(s['driver.accel'] * 100, 0) + ' %', fg: '#ffffff', bg: th.info });
        const seen = {};
        for (let i = fr.recent.length - 1; i >= 0; i--) {
            const e = fr.recent[i];
            if (seen[e.kind]) continue;
            seen[e.kind] = 1;
            const age = fr.t - e.t;
            if (e.kind === 'driver.react' && age < 2.5) chips.push({ s: 'driver reacts' + (finite(e.delay) ? ' after ' + fmt(e.delay, 1) + ' s' : ''), fg: th.info, bg: th.infoBg });
            else if (e.kind === 'driver.resume' && age < 2.5) chips.push({ s: 'driver resumes', fg: th.info, bg: th.infoBg });
            else if (e.kind === 'driver.override' && age < 2.5) chips.push({ s: 'driver overrides', fg: th.info, bg: th.infoBg });
            else if (e.kind === 'driver.vmax' && age < 2.5) chips.push({ s: 'driver max → ' + fmt((e.vMax || e.v || NaN) * KMH, 0) + ' km/h', fg: th.info, bg: th.infoBg });
            else if (e.kind === 'cmd.dropped' && age < 1.5) chips.push({ s: 'command dropped' + (finite(e.vSet) ? ' (' + fmt(e.vSet * KMH, 0) + ')' : ''), fg: th.fault, bg: th.faultBg });
            else if (e.kind === 'cmd.rejected' && age < 1.5) chips.push({ s: 'command rejected', fg: th.fault, bg: th.faultBg });
            else if (e.kind === 'target.changed' && age < 1.5) chips.push({ s: 'target changed → ' + idTxt(e.id), fg: th.meas, bg: th.chipBg });
            else if (e.kind === 'target.acquired' && age < 1.5) chips.push({ s: 'target acquired ' + idTxt(e.id), fg: th.meas, bg: th.chipBg });
            else if (e.kind === 'target.lost' && age < 1.5) chips.push({ s: 'target lost', fg: th.muted, bg: th.chipBg });
        }
        if (finite(fr.curvature) && Math.abs(fr.curvature) > 1 / 3000) chips.push({ s: 'curve R ' + fmt(1 / Math.abs(fr.curvature), 0) + ' m ' + (fr.curvature > 0 ? 'left' : 'right'), fg: th.muted, bg: th.chipBg });
        let cx = x0;
        for (const c of chips) {
            const w = textW(c.s, 11, true) + 14;
            if (cx + w > x1) break;
            rect(cx, chipY, w, chipH, c.bg, 6);
            text(c.s, cx + 7, chipY + 15, 11, c.fg, 'left', true);
            cx += w + 6;
        }
        if (!chips.length) text('no event', x0 + 2, chipY + 15, 11, th.muted);

        if (fr.warn) srect(x0 + 1, roadTop - 5, x1 - x0 - 2, lanes * laneH + 10, th.warn, 3);
        if (fr.collision) text('COLLISION', (x0 + x1) / 2, roadTop + lanes * laneH / 2 + 6, 18, th.warn, 'center', true);
        void egoBox;

        if (panelW) drawPanel();
        return { ops, layout: { x0, x1, roadTop, roadBot, rowTrue, rowMeas, rulerY, profTop, profBot, ppm, aheadM, backM, X } };

        function drawPanelFrame() {
            rect(W - panelW - 4, 4, panelW, H - 8, th.panel, 6);
        }
        function drawPanel() {
            drawPanelFrame();
            const px = W - panelW + 8, vx = W - 16;
            let y = 26;
            text('t ' + fmt(fr.t, 2) + ' s', px, y, 14, th.text, 'left', true);
            const cs = fr.cruiseState || '—';
            const csCol = cs === 'active' ? th.des : cs === 'off' || cs === 'dropout' ? th.warn : th.fault;
            text('cruise ' + cs, vx, y, 11, csCol, 'right', true);
            y += 10;
            line(px, y, vx, y, th.panelLine, 1);
            y += 4;
            const thr = o.thresholds || {};
            const tgMin = finite(thr.minTimeGap) ? thr.minTimeGap : 1.0, ttcMin = finite(thr.minTTC) ? thr.minTTC : 4;
            const leadV = finite(s['lead.v']) ? s['lead.v'] : NaN;
            const rows = [
                ['Speed', fmt(s['ego.v'] * KMH, 1) + ' km/h', th.ego],
                ['Set held / cmd', fmt(s['set.held'] * KMH, 0) + ' / ' + fmt(s['set.cmd'] * KMH, 0) + ' km/h'],
                ['Driver max', fmt(s['v.driverMax'] * KMH, 0) + ' km/h'],
                ['v_ref', fmt(s['v.ref'] * KMH, 1) + ' km/h', th.muted],
                ['Lead true / est', fmt(leadV * KMH, 1) + ' / ' + fmt(s['est.vlead'] * KMH, 1) + ' km/h', th.lead],
                ['Gap true', fmt(s['gap.true'], 1) + ' m', th.trueGap],
                ['Gap meas / est', fmt(s['gap.meas'], 1) + ' / ' + fmt(s['est.gap'], 1) + ' m', th.meas],
                ['Desired / needed', fmt(s['d.des'], 0) + ' / ' + fmt(s['d.needed'], 0) + ' m'],
                ['Time gap', fmt(s.timegap, 2) + ' s', finite(s.timegap) && s.timegap < tgMin ? th.warn : null],
                ['TTC', finite(s.ttc) && s.ttc < 99 ? fmt(s.ttc, 1) + ' s' : '—', finite(s.ttc) && s.ttc < ttcMin ? th.warn : null],
                ['Accel', fmt(s['ego.a'], 2) + ' m/s²', finite(s['ego.a']) && s['ego.a'] < -1 ? th.need : null],
                ['Warning', fr.warn ? 'ON' + (fr.warnReason ? ' · ' + fr.warnReason : '') : 'off', fr.warn ? th.warn : th.muted],
            ];
            const rowH = Math.max(14, Math.min(19, (H - 150) / rows.length));
            for (const r of rows) {
                y += rowH;
                if (y > H - 70) break;
                text(r[0], px, y, 11, th.muted);
                text(r[1], vx, y, 12, r[2] || th.text, 'right', true);
            }
            y += 10;
            line(px, y, vx, y, th.panelLine, 1);
            const plant = fr.plant || {};
            y += 15;
            text((plant.assumed !== false ? 'assumed plant: ' : 'identified plant: ') + (plant.name || '?'), px, y, 10, plant.assumed !== false ? th.fault : th.des, 'left', true);
            // the last few events
            const evs = fr.recent.slice(-3).reverse();
            for (const e of evs) {
                y += 13;
                if (y > H - 10) break;
                text(fmt(e.t, 2) + '  ' + e.kind + (e.fault ? ' ' + e.fault : '') + (e.id != null ? ' #' + e.id : '') + (finite(e.vSet) ? ' ' + fmt(e.vSet * KMH, 0) : ''), px, y, 9.5, th.faint);
            }
        }
    }

    /* ------------------------------------------------------------------ canvas player */

    const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    function paint(ctx, ops) {
        for (const p of ops) {
            switch (p.k) {
            case 'rect':
                ctx.fillStyle = p.fill;
                if (p.r > 0 && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, p.r); ctx.fill(); }
                else ctx.fillRect(p.x, p.y, p.w, p.h);
                break;
            case 'srect':
                ctx.strokeStyle = p.color; ctx.lineWidth = p.lw; ctx.setLineDash(p.dash || []);
                ctx.strokeRect(p.x, p.y, p.w, p.h); ctx.setLineDash([]);
                break;
            case 'line':
                ctx.strokeStyle = p.color; ctx.lineWidth = p.lw; ctx.setLineDash(p.dash || []); ctx.lineCap = 'butt';
                ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke(); ctx.setLineDash([]);
                break;
            case 'poly':
                ctx.fillStyle = p.fill; ctx.beginPath();
                p.pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
                ctx.closePath(); ctx.fill();
                break;
            case 'circle':
                ctx.fillStyle = p.fill; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
                break;
            case 'text':
                ctx.fillStyle = p.color; ctx.textAlign = p.align; ctx.textBaseline = 'alphabetic';
                ctx.font = (p.bold ? '600 ' : '') + p.size + 'px ' + FONT;
                ctx.fillText(p.s, p.x, p.y);
                break;
            default: break;
            }
        }
    }

    function themeNow() {
        const a = document.documentElement.getAttribute('data-theme');
        if (a === 'dark' || a === 'light') return a;
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    /** Browser: binds a <canvas> to the app. draw(frame) paints one frame. */
    function createScene(canvas, app) {
        const ctx = canvas.getContext('2d');
        let cache = { r: null, aheadM: 120, profile: null, lanes: 2 }, zoom = 'fit', cssW = 0, cssH = 0, last = null;
        function resize() {
            const dpr = window.devicePixelRatio || 1;
            cssW = Math.max(320, canvas.clientWidth | 0); cssH = Math.max(240, canvas.clientHeight | 0);
            canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        function prep() {
            const r = app.result;
            if (r === cache.r) return;
            cache = { r, aheadM: r ? fitRange(r) : 120, profile: r ? elevationProfile(r) : null, lanes: lanesOf(r) };
        }
        function draw(frame) {
            if (frame !== undefined) last = frame;
            if (!cssW) resize();
            prep();
            const aheadM = zoom === 'fit' ? cache.aheadM : +zoom;
            const cfg = (app.result && app.result.meta && app.result.meta.config) || app.config || {};
            const out = buildScene(last, { width: cssW, height: cssH, theme: themeNow(), aheadM, profile: cache.profile, lanes: cache.lanes, thresholds: cfg.thresholds });
            ctx.clearRect(0, 0, cssW, cssH);
            paint(ctx, out.ops);
            return out;
        }
        resize();
        return { draw, resize, setZoom(z) { zoom = z === 'fit' ? 'fit' : (+z || 'fit'); }, get zoom() { return zoom; } };
    }

    const API = { THEMES, buildScene, paint, createScene, fitRange, elevationProfile, zAt, lanesOf };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    else (self.CS = self.CS || {}).scene = API;
})();
