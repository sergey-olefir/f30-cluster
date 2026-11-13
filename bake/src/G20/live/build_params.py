"""Package D, step 6: collect the fits into G20Live.PARAMS and write it into bench/g20/live/live.js.

  tools/g20sim/D/py bake/src/G20/live/build_params.py      (after fit_scales, fit_bar_profile, fit_minis, fit_glow, fit_map)

The block between the markers  /*<PARAMS>*/ ... /*</PARAMS>*/  in live.js is replaced. Every leaf parameter is
{v: value, ev: 'strong'|'medium'|'weak'|'none', src: [photos], note: 'how it was measured / why'} so that the owner's
photo at ~50 km/h and ~2000 rpm can correct any single number (edit it in live.js, or here and re-run).
"""
import json
import math
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common_live import SCRATCH, WT, elements  # noqa: E402

LIVE_JS = os.path.join(WT, 'bench', 'g20', 'live', 'live.js')


def P(v, ev, src, note):
    return {'v': v, 'ev': ev, 'src': src, 'note': note}


def r1(a, n=1):
    return [round(float(x), n) for x in a]


def mirror_pt(p):
    return [round(1920 - p[0], 1), round(p[1], 1)]


def main():
    fs = json.load(open(os.path.join(SCRATCH, 'fit_scales.json')))
    bp = json.load(open(os.path.join(SCRATCH, 'fit_bar_profile.json')))
    fm = json.load(open(os.path.join(SCRATCH, 'fit_minis.json')))
    fg = json.load(open(os.path.join(SCRATCH, 'fit_glow.json')))
    fmap = json.load(open(os.path.join(SCRATCH, 'fit_map.json')))
    G = elements()
    B = fs['bars']

    # ---------------------------------------------------------------- centres
    Ct = np.array(fs['models']['A']['tacho_centre'])
    # speedo: one pose only (0 km/h). Its centre: on the measured 0-bar line (08/09 mean), at the tacho centre's y
    # (the layout is mirror-symmetric about x = 960 to +-4 px).
    sp = [np.array(B[k]['inner']) for k in ('08.speedo', '09.speedo')]
    sd = np.mean([np.array(B[k]['dir']) for k in ('08.speedo', '09.speedo')], 0)
    sd /= np.linalg.norm(sd)
    p0 = np.mean(sp, 0)
    t = (Ct[1] - p0[1]) / sd[1]
    Cs = p0 + sd * t

    # ---------------------------------------------------------------- scales
    def table(dial, C):
        T = fs['ticks'][dial]
        vals = [float(k) for k in T]
        pts = [T[k]['outer'] for k in T]
        dirs = [math.degrees(math.atan2(T[k]['d'][1], T[k]['d'][0])) for k in T]
        src = [T[k]['src'] for k in T]
        return vals, pts, dirs, src

    sv, spts, sdirs, ssrc = table('speedo', Cs)
    tv, tpts, tdirs, tsrc = table('tacho', Ct)

    # where the speedo 0-bar crosses the tick ring (the 0 tick itself is always under the pointer)
    def cross(pts, p, d):
        for i in range(len(pts) - 1):
            a, c = np.array(pts[i]), np.array(pts[i + 1])
            M = np.array([d, a - c]).T
            s, u = np.linalg.solve(M, a - p)
            if 0 <= u <= 1:
                return a + (c - a) * u, i, u
        return None
    sb_p = np.mean([np.array(B[k]['outer']) for k in ('08.speedo', '09.speedo')], 0)
    # the line through the speedo bar; ring = ticks 0..10 (0 extrapolated) -> extend the first segment backwards
    a, c = np.array(spts[0]), np.array(spts[1])
    ext = [list(a + (a - c) * 2)] + spts
    X = cross(ext, sb_p, sd)
    speedo0_bar = X[0]
    speedo0_extrap = np.array(spts[0])
    print('speedo 0: bar crosses the tick ring at (%.1f, %.1f); extrapolated 0 tick (%.1f, %.1f); diff %.2f px' % (
        *speedo0_bar, *speedo0_extrap, np.linalg.norm(speedo0_bar - speedo0_extrap)))
    spts[0] = r1(speedo0_bar, 2)
    ssrc[0] = 'bar at 0 km/h (08, 09) crossing the tick ring'

    # ---------------------------------------------------------------- bar geometry
    def beyond(k, pts, C):
        b = B[k]
        o, d = np.array(b['outer']), np.array(b['dir'])
        X = cross(pts, o, d)
        return float(np.dot(X[0] - o, d)), X[0]    # outer end lies beyond the ring by -(this)
    bt = [beyond(k, tpts, Ct)[0] for k in ('08.tacho', '09.tacho', '14.tacho')]
    print('tacho bar outer end beyond the tick ring: %s px' % np.round(bt, 2))
    len_stock = float(np.mean([B['08.tacho']['length'], B['09.tacho']['length']]))
    len_conn = float(B['14.tacho']['length'])
    width = float(np.median([bp[k]['fwhm'] for k in ('08.tacho', '14.tacho', '08.speedo')]))   # 09/14 speedo profiles are skewed by the glow
    core_n = np.mean([bp[k]['core'] for k in ('08.tacho', '08.speedo')], 0)
    core_d = np.mean([bp[k]['core'] for k in ('09.tacho', '09.speedo')], 0)
    rim_lo = np.mean([bp['08.tacho']['rim_left'], bp['09.tacho']['rim_left'], bp['08.speedo']['rim_right'], bp['09.speedo']['rim_right']], 0)
    # predicted speedo inner end with the tacho's length, for the report
    s_inner_meas = p0
    s_outer_model = speedo0_bar - sd * np.mean(bt)
    s_inner_model = s_outer_model + sd * len_stock
    print('speedo inner end: measured (%.1f, %.1f), model with the tacho length (%.1f, %.1f)' % (*s_inner_meas, *s_inner_model))
    # the speedo's own length: from its modelled outer end to its measured inner end (its outer end is lost in the bezel)
    len_speedo = float(np.linalg.norm(s_inner_meas - s_outer_model))
    print('speedo length (own) %.1f' % len_speedo)
    print('tacho length stock %.1f (08 %.1f, 09 %.1f), connected %.1f (14); width %.2f; core night %s day %s; low rim %s' % (
        len_stock, B['08.tacho']['length'], B['09.tacho']['length'], len_conn, width, r1(core_n, 0), r1(core_d, 0), r1(rim_lo, 0)))

    # ---------------------------------------------------------------- face polygons (glow clip)
    edge = [[1365, 100], [1399, 160], [1414, 180], [1428, 200], [1442, 220], [1525, 339], [1491, 420], [1485, 440],
            [1477, 460], [1452, 520], [1443, 540], [1434, 560], [1429, 580], [1427, 620], [1425, 650]]

    # the tick ring pushed 7 px outward to the bezel line (the glow reaches the bezel)
    ring_t = []
    for p in tpts:
        u = (np.array(p) - Ct) / np.linalg.norm(np.array(p) - Ct)
        ring_t.append(r1(np.array(p) + u * 7, 1))
    # tacho: ring 0 -> 7, the top-left end (7 is at (1215, 49)), the inner edge top -> bottom, the bottom line
    t_face = ring_t + [[1240, 92]] + edge + [[1546, 650]]
    s_face = []
    for p in spts:
        u = (np.array(p) - Cs) / np.linalg.norm(np.array(p) - Cs)
        s_face.append(r1(np.array(p) + u * 7, 1))
    s_face = s_face + [mirror_pt([1240, 92])] + [mirror_pt(e) for e in edge] + [mirror_pt([1546, 650])]

    # ---------------------------------------------------------------- minis
    Co = np.array(fm['oil_centre_direct'])
    Cf = np.array([1920 - Co[0], Co[1]])
    # fuel ring (ticks on the frame's inner side, 4x crops of 08/09, +-1.5 px); f = 1 at the frame's top-left corner
    fuel_ring = {0.0: [117, 646], 0.25: [90, 626], 0.5: [45, 576], 0.75: [18, 505], 1.0: [28, 452]}
    nd = fm['needles']
    ks = sorted(fuel_ring)

    def on_ring(o, d):
        """Extend the needle line (outer o, inward dir d) backwards to the fuel-space ring: -> f, ring point, inset."""
        for a_, b_ in zip(ks, ks[1:]):
            A_, B_ = np.array(fuel_ring[a_], float), np.array(fuel_ring[b_], float)
            M = np.array([d, A_ - B_]).T
            s, u = np.linalg.solve(M, A_ - o)
            if -0.02 <= u <= 1.02:
                return a_ + (b_ - a_) * u, A_ + (B_ - A_) * u, -s
        return None
    # every needle in fuel space (oil mirrored): f, inset, length, direction (deg below +x of the INWARD direction)
    mini_obs = []
    for k in ('08.fuel', '09.fuel', '14.fuel', '08.oil', '09.oil', '14.oil'):
        o, i = np.array(nd[k]['outer']), np.array(nd[k]['inner'])
        if k.endswith('oil'):
            o, i = np.array(mirror_pt(o)), np.array(mirror_pt(i))
        d = (i - o) / np.linalg.norm(i - o)
        f, R, ins = on_ring(o, d)
        mini_obs.append(dict(k=k, f=float(f), inset=float(ins), len=float(np.linalg.norm(i - o)),
                             dir=float(math.degrees(math.atan2(d[1], d[0])))))
        print('mini %-8s f %.3f inset %.1f len %.1f dir %.1f deg' % (k, f, ins, mini_obs[-1]['len'], mini_obs[-1]['dir']))

    def grp(sel):
        rows = [m for m in mini_obs if m['k'] in sel]
        return {q: float(np.mean([m[q] for m in rows])) for q in ('f', 'inset', 'len', 'dir')}
    m0, m5, m8 = grp(('14.oil',)), grp(('08.oil', '09.oil')), grp(('08.fuel', '09.fuel', '14.fuel'))
    mini_tab = {'f': [0.0, round(m5['f'], 3), round(m8['f'], 3), 1.0]}
    for q in ('inset', 'len', 'dir'):
        mini_tab[q] = [round(m0[q], 1), round(m5[q], 1), round(m8[q], 1), round(m8[q], 1)]
    fuel_f = [round(m['f'], 3) for m in mini_obs if m['k'].endswith('fuel')]

    # ---------------------------------------------------------------- map
    M8, M9 = fmap['08'], fmap['09']

    def bgc(m):
        return r1(m['bg_by_edge_distance'][-1][2:5], 0)

    PARAMS = {
        'version': '1.0 (package D, fitted %s)' % '2026-11-12',
        'coords': 'panel px, 1920x720, x right, y down; angles in degrees (image atan2 unless stated)',
        'speedo': {
            'centre': P(r1(Cs, 1), 'weak', ['08', '09'],
                        'virtual centre of the pointer rays. Only one speedo pose exists (0 km/h): on the measured 0-bar line, at '
                        'the tacho centre\'s y (the layout is mirror-symmetric about x 960 within ~4 px)'),
            'orient': P('centre', 'weak', ['08', '09', '14'],
                        "WEAK: the pointer was never photographed moving. 'centre': the bar lies on the ray from `centre` through its scale point (fits the tacho's 3 poses, 0 and idle 0.70, to 0.3 "
                        "deg). 'tick': the bar follows the local tick axis instead (2.7 deg off at idle). The ticks above ~1.5 "
                        "x1000 / 40 km/h turn up to 25 deg away from the centre ray; only a photo in motion can say which the "
                        "bar follows there"),
            'scale': P({'values': sv, 'pts': spts, 'tick_dir': r1(sdirs, 1), 'src': ssrc}, 'strong', ['08', '09'],
                       'outer ends of every tick (centroid + half length outward), mean of 08 and 09 (spread median 0.34 px). '
                       'Values: minors every 2 km/h to 60, every 5 to 140, every 10 to 260; majors 0-60 by 10, 80, 100, 120, '
                       '140, 170, 200, 230, 260. The 0 point is where the 0 km/h bar crosses the ring (its tick is under the '
                       'pointer). Hidden ticks are interpolated (src interp). value -> point is piecewise linear between ticks'),
            'beyond': P(round(float(np.mean(bt)), 2), 'medium', ['08', '09', '14'],
                        'the bar\'s visual outer end lies this far past the tick ring along the bar (tacho: %s px)' % r1(bt, 1)),
            'len': P({'stock': round(len_speedo, 1), 'connected': round(len_speedo, 1)}, 'medium', ['08', '09', '14'],
                     'visual length: from the modelled outer end (ring + beyond) to the measured inner end (08/09; the outer end '
                     'merges with the bezel line). The tacho\'s length would put the inner end %.1f px further in. 14 '
                     '(connected) shows the speedo bar at full length' % float(np.linalg.norm(s_inner_model - s_inner_meas))),
        },
        'tacho': {
            'centre': P(r1(Ct, 1), 'medium', ['08', '09', '14'],
                        'least-squares meeting point of the bars at 0 (08) and idle (09, 14): rms 1.25 px off the 3 lines. The '
                        'two idle poses are 0.70 and 0.72 x1000; 10 (grid over it) agrees within its noise'),
            'orient': P('centre', 'weak', ['08', '09', '14'], 'see speedo.orient'),
            'scale': P({'values': tv, 'pts': tpts, 'tick_dir': r1(tdirs, 1), 'src': tsrc}, 'strong', ['08', '09'],
                       'outer ends of every tick, 0..7 by 0.1 (majors every 0.5), mean of 08 and 09 (spread median 0.17 px); '
                       'the minors in the red band above 6 are hidden and interpolated'),
            'beyond': P(round(float(np.mean(bt)), 2), 'medium', ['08', '09', '14'], 'see speedo.beyond: %s px' % r1(bt, 1)),
            'len': P({'stock': round(len_stock, 1), 'connected': round(len_conn, 1)}, 'medium', ['08', '09', '14', '10'],
                     'visual length: stock 08 %.1f, 09 %.1f; theme connected 14 %.1f (BMW draws a SHORT tacho bar while a '
                     'theme is connected: 10 agrees, 85-140 px between grid labels). Plausibly to clear the black box' % (
                         B['08.tacho']['length'], B['09.tacho']['length'], len_conn)),
            'band': P({'enabled': True, 'depth': 18.5, 'width': 6.5, 'rgb': [250, 58, 92], 'from': 0.0, 'gap': 0},
                      'medium', ['09', '14'],
                      'the pink-red rev band inside the ticks from 0 to the pointer (09, 14 at idle; absent in 08 at 0). Depth '
                      'from the tick ring along the ray, width (px), colour. Beyond 0.7 x1000 it is extrapolated along the ring '
                      '(weak)'),
        },
        'bar': {
            'width': P(round(width, 2), 'strong', ['08', '09', '14'], 'core width: FWHM of the cross profile on the clean bars (08 tacho, 14 tacho, 08 speedo: 6.0 each); the ridge fit with a local baseline gives 6.2-7.5 incl. camera blur'),
            'rgb': P({'night': r1(core_n, 0), 'day': r1(core_d, 0)}, 'strong', ['08', '09'],
                     'core colour (central 3 px, median along the clean middle of the bar)'),
            'cap': P('round', 'strong', ['08', '09', '14'], 'both ends are round: the G profile falls 177 -> 64 within 2 px'),
            'rim': P({'rgb': [40, 0, 0], 'alpha': 0.55, 'width': 2.5, 'offset': 5.5, 'hi_alpha': 0.3}, 'medium', ['08', '09'],
                     'a thin dark-red line along the core: at `offset` px toward the LOW-value side (the photos read %s at '
                     '-5..-7 px), and a fainter one (hi_alpha) on the high side (a dip to ~(160, 45, 22) at +4..+5 px)' % r1(rim_lo, 0)),
            'shadow': P({'alpha': 0.62, 'd0': 8, 'lambda': 14, 'dmax': 56, 'blur': 3}, 'medium', ['08', '09'],
                        'a soft dark band beside the bar on the LOW-value side (black, alpha a(d) = alpha for d <= d0, then '
                        'alpha * exp(-(d - d0) / lambda), d = px from the bar axis, to dmax; ends softened by a blur). From '
                        'the photo / (stand-in + our glow) ratio across the bars (tacho 08, 09; speedo 08): 0.32-0.50 at 8 px, '
                        '0.52-0.62 at 14, 0.72-0.75 at 20, 0.87-0.92 at 30, ~1 at 40'),
        },
        'glow': {
            'gain': P(0.6, 'weak', ['08', '09'], 'overall multiplier, calibrated by the lead (E) on the assembled simulation over package B\'s static faces (tools/g20sim/calib_glow.py, least squares in the pointer zones): 08 speedo 0.47, tacho 0.58; 09 speedo 0.63, tacho 0.73; 0.6 = their mean (D\'s own fit, against a stand-in face, was 1.0)'),
            'composite': P('lighter', 'medium', ['08', '09'], 'additive: the fit is linear in the glow (o09 = a*o08 + b + glow terms)'),
            'rgb': P({'night': r1(fg['colour_night'], 1), 'day': r1(fg['colour_day'], 1)}, 'medium', ['08', '09'],
                     'added colour at full strength. Fitted jointly on 08 (bar at 0) and 09 (idle) with a per-channel exposure '
                     'map a %s, b %s; rms %.1f vs %.1f without glow (%d px)' % (r1(fg['exposure_a'], 3), r1(fg['exposure_b'], 1),
                                                                          fg['rms'], fg['rms_noglow'], fg['n'])),
            'sigma_hi': P(fg['shape']['s_hi'], 'medium', ['08', '09'], 'angular gaussian sigma (deg about the centre) on the higher-value side'),
            'sigma_lo': P(fg['shape']['s_lo'], 'medium', ['08', '09'], 'same on the lower-value side'),
            'q0': P(fg['shape']['q0'], 'medium', ['08', '09'], 'full strength from the tick ring inward to this depth (px along the ray)'),
            'q1': P(fg['shape']['q1'], 'medium', ['08', '09'], 'smoothstep fall to 0 at this depth'),
            'q_in': P(34, 'medium', ['39', '40'], 'car3 J: no glow outside this depth (px inside the tick ring), full 10 px '
                      'further in: on 39/40 the tick zone between the band and the ticks stays dark by the pointer (the '
                      'old fit lit it from the ring)'),
            'res': P(0.5, 'none', [], 'render scale of the glow buffer (0.5 = half resolution, upscaled bilinear)'),
            'face': P({'speedo': s_face, 'tacho': t_face}, 'medium', ['08', '09'],
                      'clip polygon: the tick ring pushed 7 px out to the bezel, then the dial face\'s inner edge (the map side), '
                      'measured row by row on 09 (tacho; y 240-430 hidden under the gear letter, interpolated to a vertex at '
                      '(1525, 339)) and mirrored for the speedo (08 rows agree within 1 px). The glow stops there in 08/09'),
        },
        'fuel': {
            'tank_l': P(65, 'strong', [], 'brief: s.values.fuelL is of a 65 L tank'),
            'centre': P(r1(Cf, 1), 'weak', ['08', '09', '14'], 'virtual centre (only used for the fill\'s depth): the oil mini\'s '
                        'needle lines meet at %s; mirrored' % r1(Co, 1)),
            'ring': P({'f': sorted(fuel_ring), 'pts': [fuel_ring[k] for k in sorted(fuel_ring)]}, 'weak', ['08', '09'],
                      'frame ticks (inner side of the outer frame) at 1/4, 1/2, 3/4 (4x crops, +-1.5 px); 0 = the frame\'s '
                      'bottom end where the red reserve mark starts, 1 = the top-left corner (both weak: no tick seen). Each '
                      'photo needle extended back to this ring: fuel 08/09/14 at f = %s' % fuel_f),
            'inset': P({'f': mini_tab['f'], 'v': mini_tab['inset']}, 'medium', ['08', '09', '14'],
                       'needle outer end inside the ring, along the needle (px), by f: oil 14 (cold end), oil 08/09 (notch), '
                       'fuel 08/09/14; f = 1 copies the last'),
            'len': P({'f': mini_tab['f'], 'v': mini_tab['len']}, 'medium', ['08', '09', '14'],
                     'needle visual length by f (same sources): the needle spans the mini\'s interior, which narrows toward the '
                     'bottom'),
            'dir': P({'f': mini_tab['f'], 'v': mini_tab['dir']}, 'medium', ['08', '09', '14'],
                     'needle direction by f (deg, image atan2 of the inward direction, fuel side; the oil mini mirrors it). The '
                     'needles are not rays from one point within 2-3 deg, so the measured directions are interpolated'),
            # car3 J: refitted on 39 / 40
            'needle': P({'w0': 9.0, 'w1': 5.5, 'rgb': [245, 92, 80], 'tip_rgb': [185, 70, 62]}, 'strong',
                        ['08', '09', '14', '39', '40'],
                        'tapered red bar: width at the frame end / at the tip, core colour, the tip dims. car3 J: refitted '
                        'on the close-up 40 (5 photo px per panel px; half-max 9 px at the frame end, 7.5 px a quarter from '
                        'the tip) and 39 (core 244-248, 90-94, 80-82); was 10 / 4.5, [255, 112, 98]'),
            'fill': P({'enabled': True, 'rgb': [205, 175, 180], 'alpha': 1.0, 'd0': 8, 'sigma': 36, 'depth': 95}, 'medium', ['08', '09', '14'],
                      'the lit fill below the needle (toward f = 0): colour, alpha at the frame, then gaussian fall with depth '
                      'along the ray (08 fuel: 1.0 at 8 px, 0.56 at 35, 0.21 at 55, 0.05 at 75). Gone above the needle and in 14\'s '
                      'cold oil mini: it moves with the value'),
        },
        'oil': {
            'range_c': P([70, 150], 'weak', ['08', '14'], 'the scale has no numbers. 14 (COLD) shows the needle at its bottom end; 08/09 '
                         '(warm engine) at the frame notch, f = 0.5; the red zone starts at f ~ 0.81. 70..150 degC linear puts '
                         'warm oil (~110) on the notch and the red zone at ~135: a guess'),
            'mirror_of': P('fuel', 'medium', ['08', '09', '14'],
                           'the oil mini is the fuel mini mirrored about x 960 (frame ticks, zones, notch and both needles within ~3 px); '
                           'ring, inset, len, needle and fill are the fuel\'s, mirrored'),
            'centre': P(r1(Co, 1), 'medium', ['08', '09', '14'], 'the oil needles at the notch (08, 09) and cold end (14) meet here (2.4 px)'),
        },
        'map': {
            'seed': P(20201, 'none', [], 'our own deterministic street layout (never BMW\'s data)'),
            'region': P(G['map.region']['poly'], 'strong', ['08', '09', '14'], 'g20_comfort.json map.region (hull of the drawn roads)'),
            'arrow': P(G['map.position_arrow']['poly'], 'strong', ['08', '09', '14'], 'g20_comfort.json map.position_arrow'),
            'arrow_rgb': P([240, 73, 66], 'strong', ['08'], 'g20_comfort.json colour; drawn with a slight vertical shade'),
            'bg': P({'night': bgc(M8), 'day': bgc(M9)}, 'medium', ['08', '09'],
                    'median non-road colour > 150 px inside the region edge (08 night, 09 day; 14 is much lighter and is left out)'),
            'fade': P({'width': 120, 'power': 2.0}, 'medium', ['08', '09'],
                      'alpha = 1 - (1 - min(d / width, 1))^power, d = distance inside map.region; measured background over the '
                      'edge band reaches ~0.4 of the centre at 35 px and ~0.9 at 110 px (both looks)'),
            'road_rgb': P({'night': r1(M8['road_rgb_p90'], 0), 'day': r1(M9['road_rgb_p90'], 0)}, 'medium', ['08', '09'],
                          'road core colour (90th percentile of the road cores: the median is pulled down by antialiasing)'),
            'road_w': P({'night': [3.6, 5.0], 'day': [4.6, 8.5]}, 'medium', ['08', '09'],
                        'minor / main road widths (px): 08 median %.1f p90 %.1f; 09 median %.1f p90 %.1f (09 is zoomed in)' % (
                            M8['road_width_median'], M8['road_width_p90'], M9['road_width_median'], M9['road_width_p90'])),
            'px_per_m': P(1.0, 'weak', ['08'], 'map scale for the drift: side streets ~50-90 px apart in 08 ~ city blocks'),
            'drift_gain': P(1.0, 'none', [], 'multiplier on the drift speed (speed in m/s * px_per_m * gain px/s), streets move down'),
        },
        'motion': {
            'tau_ms': P(70, 'none', [], 'exponential approach to each new value (95 % in ~210 ms); values arrive at 4 Hz'),
            'eps': P({'speed': 0.05, 'rpm': 2, 'fuelL': 0.02, 'oil': 0.05}, 'none', [], 'below this the value counts as settled (wantsFrame)'),
        },
        'defaults': P({'speed': 0, 'rpm': 0, 'fuelL': 0.83 * 65, 'oil': 110}, 'weak', ['08'],
                      'used when a value is null: the 08 look (fuel needle at f ~ 0.83, oil at the notch)'),
    }
    js = json.dumps(PARAMS, indent=1, ensure_ascii=False)
    src = open(LIVE_JS).read()
    new = re.sub(r'/\*<PARAMS>\*/.*?/\*</PARAMS>\*/', lambda m: '/*<PARAMS>*/' + js + '/*</PARAMS>*/', src, flags=re.S)
    if new == src and '/*<PARAMS>*/' not in src:
        raise SystemExit('markers not found in live.js')
    open(LIVE_JS, 'w').write(new)
    print('PARAMS written: %d bytes' % len(js))


if __name__ == '__main__':
    main()
