"""Package VC: the palette, built from the measurements (materials.json, gradients.json, texture.json).

Every value is linear light relative to the design's white text (= 1.0 = panel code 255). Each entry keeps the
measured values per reference that it was chosen from, the choice rule, a multiplicative uncertainty (the spread
of the references, in linear) and a status: verified (measured and the references agree within the stated
uncertainty) or hypothesis (chosen between disagreeing references, or not measurable).

G20 check (docs/BAKE-P10-levels.md, photo 12; docs/strip/R-REPORT.md): the G20 panel's black is
F = (0.0012, 0.0009, 0.0056) of white in R, G, B (neutral in R/G, blue in B); the phone photos of the panel clip
white text at ~0.92 linear and lift mid-greys. 'g20' gives, per entry, the panel code that lands on the target
after the panel adds its floor: c = srgb((L - F) / (1 - F)), and flags channels below the floor (unreachable: the
car shows F there whatever we draw).

Night: no facelift night reference exists (VR found none; reference 03 is the classic generation at night). The
night palette is a proposal (hypothesis): a per-material linear multiplier on top of the car's own backlight
dimming (Vehicle.statusDayNightChangeOver / destinationLCDLuminance), so it is mild.

Writes design/twin-dial/vc/palette.json (tracked: numbers only) and the same into pub/VC/palette.json.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

F_G20 = np.array([0.0012, 0.0009, 0.0056])


def m(rid, key):
    d = MAT[rid]['samples'].get(key)
    if d is None:
        return None
    return {'ref': rid, 'sample': key, 'L': round(d['L'], 4), 'srgb_photo': [int(round(x)) for x in C.l2s(d['rgb'])],
            'clipped': round(d['clip'], 2)}


def entry(name, lin, unc, status, refs, rule, night=1.0, night_note=None):
    lin = np.asarray(lin, dtype=np.float64)
    s = C.l2s(lin)
    panel = (lin - F_G20) / (1 - F_G20)
    under = [ch for ch, v in zip('RGB', panel) if 0 < lin['RGB'.index(ch)] < F_G20['RGB'.index(ch)]]
    nl = lin * night
    return {'name': name, 'linear': np.round(lin, 5), 'srgb': [int(round(x)) for x in s], 'hex': C.hexs(s),
            'Y_rel_white': round(float(C.lum(lin)), 5), 'uncertainty_x': unc, 'status': status,
            'measured': [r for r in refs if r], 'rule': rule,
            'g20': {'panel_srgb': [int(round(x)) for x in C.l2s(np.clip(panel, 0, 1))],
                    'below_floor': under,
                    'floor_share': np.round(F_G20 / np.maximum(lin, 1e-6), 3)},
            'night': {'mult': night, 'linear': np.round(nl, 5), 'srgb': [int(round(x)) for x in C.l2s(nl)],
                      'hex': C.hexs(C.l2s(nl)), 'note': night_note}}


def grey(L, tint=(1.0, 1.0, 1.0)):
    t = np.asarray(tint, dtype=np.float64)
    return L * t / C.lum(t)


def main():
    global MAT
    MAT = C.jload(os.path.join(C.WORK, 'materials.json'))
    GR = C.jload(os.path.join(C.WORK, 'gradients.json'))
    TX = C.jload(os.path.join(C.WORK, 'texture.json'))
    cool = (0.96, 1.0, 1.08)  # 05's band chroma, half-way to 02's neutral
    P = []
    P.append(entry('white_text', grey(1.0), 1.0, 'verified',
                   [m('02', 'text_heading'), m('05', 'text_heading'), m('04', 'text_trip')],
                   'big numerals and texts: clipped in every reference, so white = panel 255 by definition',
                   0.80, 'whites dimmed 0.8 in linear (~0.91 in sRGB)'))
    P.append(entry('bezel_ring', grey(1.0), 1.15, 'verified',
                   [m('02', 'bezel.speedo'), m('05', 'bezel.speedo'), m('04', 'bezel.speedo')],
                   'clipped on 02 (79 %) and 05 (95 %); 04 reads 0.66 but its ring is 1.6 photo px wide (blur-limited); '
                   'take white', 0.70, 'the brightest long line: 0.7'))
    P.append(entry('inner_ring', grey(1.0), 1.1, 'verified',
                   [m('02', 'inner_ring.speedo'), m('04', 'inner_ring.speedo'), m('05', 'inner_ring.speedo')],
                   '0.92 / 0.997 / 0.96, all partly clipped: white', 0.70))
    P.append(entry('numerals', grey(1.0), 1.0, 'verified', [m('02', 'text_value'), m('05', 'text_value')],
                   'white as the texts; 05 small numerals the same', 0.80))
    P.append(entry('ticks', grey(1.0), 1.4, 'hypothesis',
                   [m('02', 'ticks.speedo'), m('05', 'ticks.speedo'), m('04', 'track_line.speedo')],
                   'peaks 0.60 (02) / 0.30 (05) are 1-2 photo px lines (blur-limited); 04 track line 0.79; '
                   'the references draw them as white strokes', 0.75))
    P.append(entry('track', grey(0.25, cool), 1.6, 'hypothesis',
                   [m('02', 'track.speedo'), m('02', 'track.tacho'), m('05', 'track.speedo'), m('05', 'track.tacho')],
                   'the lighter ring under the ticks (02, 05; 04 has only a white line): 0.34-0.39 on 02 (phone '
                   'tone curve lifts mid-greys), 0.19-0.20 on 05 (no camera); geometric mean 0.26 -> 0.25',
                   0.55, 'mid-greys darker at night than whites, so the dial reads as rings, not a lit disc'))
    P.append(entry('scale_gap', grey(0.0), 1.0, 'verified', [m('02', 'gap.speedo'), m('05', 'gap.speedo'),
                   m('04', 'gap.speedo')], 'black between the track and the bezel: L 0.001-0.002'))
    P.append(entry('band_inner (rho 0.60, top)', grey(0.010, cool), 1.7, 'hypothesis',
                   [m('02', 'band_in.speedo'), m('05', 'band_in.speedo'), m('04', 'band_in.speedo')],
                   'see gradient band: 02 0.030, 05 0.009, 04 0.029 (flat)', 0.6))
    P.append(entry('band_mid (rho 0.72, top)', grey(0.024, cool), 1.7, 'hypothesis',
                   [m('02', 'band_mid.speedo'), m('05', 'band_mid.speedo'), m('04', 'band_mid.speedo')],
                   'model value; 02 0.077, 05 0.014, 04 0.028', 0.6))
    P.append(entry('band_outer (rho 0.88, top)', grey(0.082, cool), 1.7, 'hypothesis',
                   [m('02', 'band_out.speedo'), m('05', 'band_out.speedo'), m('04', 'band_out.speedo')],
                   'model value; 02 0.31, 05 0.084, 04 0.027', 0.55))
    P.append(entry('band_outer (rho 0.88, theta +-110)', grey(0.256, cool), 1.8, 'hypothesis',
                   [], 'model value; fits: 02 0.44-0.52, 05 0.18-0.19', 0.5,
                   'the lit lower ends lose most at night (glare in a dark cabin)'))
    P.append(entry('band_feet (theta beyond the scale)', grey(0.12, cool), 2.0, 'hypothesis', [],
                   '05 feet sRGB 86-131 (L 0.09-0.23), 02 35-85: the band ends\' grey cut-outs', 0.5))
    P.append(entry('hub_disc', grey(0.0), 1.0, 'verified', [m('02', 'hub.speedo'), m('04', 'hub.speedo'),
                   m('05', 'hub.speedo')], 'black (L <= 0.003 on every reference); the G20 shows its floor'))
    P.append(entry('lcd_black / surround', grey(0.0), 1.0, 'verified',
                   [m('02', 'lcd_black'), m('04', 'lcd_black'), m('05', 'outside.speedo')], 'black'))
    red = np.array([0.70, 0.005, 0.030])
    P.append(entry('red (wedge numerals, red marks, warning tab)', red, 1.3, 'verified (hue) / hypothesis (level)',
                   [m('04', 'wedge_numeral.tacho'), m('02', 'tab_red'), m('04', 'tab_red'),
                    m('05', 'red_numeral.tacho'), m('01', 'red_numeral.tacho')],
                   'a carmine red: G/R 0.004-0.01, B/R 0.03-0.06 on the saturated samples (04 numerals 226,10,38; '
                   '02 tab 175,14,44); 05 is desaturated by JPEG chroma subsampling; level between 02\'s tab (0.43 R) '
                   'and 04\'s numerals (0.76 R)', 0.85, 'reds kept near full: a warning colour must not fade'))
    P.append(entry('red_wedge_fill', red * 0.11, 1.6, 'hypothesis', [m('04', 'wedge_fill.tacho')],
                   'only 04 fills the red zone (79,3,14 = 0.11 of the red); 05 and 02 draw no fill (red bezel arc '
                   'and red numerals instead)', 0.8))
    P.append(entry('red_wedge_edge', red, 1.3, 'hypothesis', [m('04', 'wedge_edge.tacho'), m('05', 'bezel_red.tacho')],
                   'the wedge outline / the bezel arc past the red line: full red (photo peaks 0.16-0.13 R are '
                   'blur-mixed thin lines)', 0.85))
    P.append(entry('needle (white, lead)', grey(1.0), 1.0, 'verified', [
        {'ref': '02', 'core_srgb': [int(x) for x in C.l2s(GR['02']['speedo']['needle']['core_rgb'])]},
        {'ref': '04', 'core_srgb': [int(x) for x in C.l2s(GR['04']['speedo']['needle']['core_rgb'])]}],
        'white on 02 (the in-car facelift) and 04, core clipped; 05 (seller render) and 01/03 (classic) use red',
        0.75))
    P.append(entry('needle (red, option)', red, 1.3, 'hypothesis', [
        {'ref': '05', 'core_srgb': [int(x) for x in C.l2s(GR['05']['tacho']['needle']['core_rgb'])]},
        {'ref': '01', 'core_srgb': [int(x) for x in C.l2s(GR['01']['tacho']['needle']['core_rgb'])]}],
        'red needle as on 05 and the classic generation', 0.85))
    P.append(entry('needle_glow', grey(0.02), 2.0, 'hypothesis', [],
                   'no glow measurable on 02 / 04 (excess at 2-6 half-widths within -0.15..+0.06 of the core: 02 shows '
                   'a dark drop shadow beside the needle); 05 0.02-0.03 of the core; propose 0.02 of the needle colour '
                   'over 0.03 R, or none', 0.5))
    P.append(entry('needle_shadow', grey(0.0), 1.0, 'hypothesis', [],
                   '02: the band beside the needle is 10-15 % darker out to ~0.05 R: a soft drop shadow (multiply 0.85)'))
    P.append(entry('tab_body (bottom of its ramp)', grey(0.16), 1.5, 'hypothesis',
                   [m('02', 'tab_body'), m('05', 'tab_body'), m('04', 'tab_body')],
                   'vertical ramp: top 0.002-0.003, bottom 0.16 (02) / 0.24 (05); 04 is lit (0.5): outlier', 0.55))
    P.append(entry('tab_rule (under the tab bar)', grey(0.85), 1.15, 'hypothesis', [m('05', 'tab_rule')],
                   '05 0.85 (row profile 0.83), 04 0.93', 0.7))
    P.append(entry('tab_highlight_green (selected, 05)', np.array([0.11, 0.42, 0.02]), 1.4, 'hypothesis',
                   [m('05', 'tab_green')], '05 only (93,171,39)', 0.75))
    P.append(entry('tab_highlight_red (warning, 02 / 04)', red * 0.62, 1.4, 'verified (hue)',
                   [m('02', 'tab_red'), m('04', 'tab_red')], 'red fill of a tab with an active warning: 02 0.43 R', 0.85))
    P.append(entry('rule_white (heading / bottom-row rules)', grey(0.80), 1.3, 'hypothesis',
                   [m('02', 'rule_heading'), m('02', 'rule_bottom'), m('05', 'rule_heading'), m('05', 'rule_vertical'),
                    m('05', 'rule_under_dial')],
                   '1-2 px lines, blur-limited: 0.73 / 0.98 (02), 0.31 / 0.55 / 0.91 (05): white-ish, 0.8', 0.7))
    P.append(entry('text_grey (small labels)', grey(0.77), 1.3, 'hypothesis',
                   [m('05', 'text_small'), m('05', 'text_trip'), m('04', 'text_trip')],
                   'small labels peak 0.74-0.95 (blur-limited strokes): the references show no grey text level apart '
                   'from white; use white, or 0.77 for secondary labels', 0.75))
    P.append(entry('green_ready', np.array([0.045, 0.33, 0.016]), 1.4, 'hypothesis', [m('02', 'green_ready')],
                   '02 READY (58,156,34)', 0.8))
    out = {'version': 1, 'source_frames': 'VR rectified (pub/VR, index v1)', 'units': 'linear light, white text = 1',
           'g20_floor_rel_white': F_G20,
           'palette': P,
           'band_model': {
               'formula': 'Y(rho, theta) = Y0 * exp(k_r * (rho - 0.60)) * exp(-k_t * (cos(theta) - 1)), rho 0.585..0.89, '
                          'theta cw from 12; chroma = band tint',
               'Y0': 0.010, 'k_r': 7.5, 'k_t': 0.85, 'tint_rgb': cool,
               'fits': {r: {d: {k: GR[r][d]['band_fit'][k] for k in ('a1_per_R', 'a2_cos', 'rms_log', 'Y_at')}
                            for d in ('tacho', 'speedo')} for r in ('02', '04', '05')},
               'status': 'hypothesis: 02 (k_r 7.8-8.4, k_t 0.66-0.90) and 05 (k_r 7.0-7.4, k_t 0.88-0.99) agree on the '
                         'shape, 04 is flat (0.03, an aftermarket unit); levels between 05 and 02 (02 lifted by the '
                         'phone tone curve)'},
           'texture': {
               'finding': 'no texture resolved: relative rms 0.06-0.08 (02), 0.04-0.10 (05) with correlation length = '
                          '1 photo px along both rho and theta (0.005-0.009 R), the same as the noise floor on 05\'s black '
                          'hub (0.03-0.06); 04 0.11-0.28 is LCD moire / JPEG',
               'proposal': 'optional fine isotropic grain, two tones = band x (1 -/+ 0.04), cell <= 0.005 R; or none',
               'measured': {r: {d: {w: {k: TX[r][d][w][k] for k in ('rms', 'p10', 'p90', 'radial_corr_len_R',
                                                                          'theta_corr_len_R')}
                                    for w in TX[r][d]} for d in TX[r]} for r in ('02', '04', '05')}},
           'tab_ramp': {'rows_Y': {r: MAT[r]['samples']['tab_body']['rows_Y'] for r in ('02', '04', '05')},
                        'proposal': 'linear Y from 0.003 (top) to 0.16 (bottom), exponential in between; white-ish rule '
                                    '0.85 under it'},
           'centre_background': {
               'finding': '02 and 04 black (02\'s lower haze is the steering wheel\'s reflection, glare); 05 rises '
                          'smoothly from 0 at the dial centre line to sRGB 64 (L 0.05) at +0.92 R: a floor glow',
               'proposal': 'black; 05\'s floor glow as an option (L 0 -> 0.05 over y 0.2..0.92 R below the centre line)'},
           'night': {'status': 'hypothesis (no facelift night reference)',
                     'from_03': '03 (classic, night): whites stay white (clipped), reds clip to orange in the photo '
                                '(R channel saturated: not a design tint), the band is (34,38,42): the design keeps '
                                'its hues by night; the camera, not the cluster, changes them',
                     'rule': 'no tint; whites x0.8, rings x0.7, mid-greys x0.55, lit band ends x0.5, reds x0.85; the '
                             'car dims the backlight itself (statusDayNightChangeOver / destinationLCDLuminance), so '
                             'this is a contrast shape, not a dimmer'}}
    C.jdump(out, os.path.join(C.DESIGN, 'palette.json'))
    C.jdump(out, os.path.join(C.PUB, 'palette.json'))
    for e in P:
        print('%-44s lin %-28s srgb %-16s %s x%.2f %s night %s' % (
            e['name'], np.round(e['linear'], 4).tolist(), e['srgb'], e['hex'], e['uncertainty_x'], e['status'],
            e['night']['srgb']), 'G20', e['g20']['panel_srgb'], e['g20']['below_floor'])


MAT = None

if __name__ == '__main__':
    main()
