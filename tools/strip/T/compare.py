"""Package T: BMW's strip typography against ours, and the bake sizes and widget offsets that put ours in BMW's places.

Inputs (all git-ignored, under bake/work/strip/T/): analysis.json (tools/strip/T/analyse.py: BMW's glyphs, dilation
corrected, and the per-field fits), the strings file (--strings, scratch only). Ours: the baked atlases and the layout
apps/f30_cluster/hud/layouts/wb_dials.json (wb_sport_dials places these widgets identically), laid out as
shared/hud_text.js does. Candidates: Roboto as tools/bake_fonts.py would bake it (tools/strip/T/ours.py candidate()).

Absolute positions use only the photos package R registered (model "R-strip"); sizes, stems and advances use all.
Writes design/strip/T/typography.json (numbers only, tracked) and prints the table.

    uv run ... --with numpy --with pillow python -I tools/strip/T/compare.py --strings <json> [--out <json>]
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402
import ours as O  # noqa: E402

FILE = 'Roboto-wdth-wght.subset.ttf'
LAYOUT = os.path.join(C.ROOT, 'apps', 'f30_cluster', 'hud', 'layouts', 'wb_dials.json')


def widgets():
    d = json.load(open(LAYOUT))
    out = {}

    def walk(o):
        if isinstance(o, dict):
            if o.get('type') == 'text' and 'id' in o:
                out[o['id']] = o
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(d)
    return out


def med(v):
    v = [x for x in v if x is not None and x == x]
    return round(float(np.median(v)), 2) if v else None


def spread(v):
    v = [x for x in v if x is not None and x == x]
    return round(float(np.max(v) - np.min(v)) / 2, 2) if len(v) > 1 else None


def rows_of(an, field, registered=False):
    rs = an['fields'].get(field, [])
    return [r for r in rs if (not registered or r['model'] == 'R-strip')]


def ink_of(font, text, w, x_box=0):
    lay = O.layout_ink(font, text, x_box, w['w'], w.get('align', 'center'))
    return lay


def identical_pitch(an, strings):
    """BMW's tabular advance: the pitch of two identical digits side by side (dilation-invariant)."""
    ps = []
    for f in ('range', 'clock', 'temp'):
        for r in an['fields'].get(f, []):
            s = [c for c in strings.get(f, {}).get(r['photo'], '') if c != ' ']
            g = r['glyphs']
            if len(s) != len(g):
                continue
            for i in range(len(s) - 1):
                if s[i].isdigit() and s[i] == s[i + 1]:
                    ps.append(((g[i + 1]['x0'] - g[i]['x0']) + (g[i + 1]['x1'] - g[i]['x1'])) / 2)
    return ps


def colon_pitch(an, strings):
    """Hour's second digit to minutes' first digit when they are the same digit: one digit advance + the colon's."""
    ps = []
    for r in an['fields'].get('clock', []):
        s = strings.get('clock', {}).get(r['photo'], '')
        g = r['glyphs']
        if len(s) == 5 == len(g) and s[1] == s[3]:
            ps.append(((g[3]['x0'] - g[1]['x0']) + (g[3]['x1'] - g[1]['x1'])) / 2)
    return ps


def place(font, text, align, w_box, target, edge):
    """The box x (float) that puts the string's ink `edge` ('l', 'r', 'c', or ('colon', i)) at `target`."""
    lay = O.layout_ink(font, text, 0, w_box, align)
    if edge == 'l':
        v = lay[0][1]
    elif edge == 'r':
        v = lay[-1][2]
    elif edge == 'c':
        v = (lay[0][1] + lay[-1][2]) / 2
    else:
        i = [k for k, (c, _, _) in enumerate(lay) if c == ':'][0]
        v = (lay[i][1] + lay[i][2]) / 2
    return target - v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--strings', required=True)
    ap.add_argument('--out', default=os.path.join(C.ROOT, 'design', 'strip', 'T', 'typography.json'))
    ap.add_argument('--row', default='100,450,43', help='recommended wb_row: wdth,wght,size')
    ap.add_argument('--unit', default='87.5,300,34')
    ap.add_argument('--road', default='90.625,325,42')
    ap.add_argument('--msg', default='87.5,450,35')
    ap.add_argument('--sign', default='87.5,450,38')
    a = ap.parse_args()
    an = json.load(open(os.path.join(C.ROOT, 'bake', 'work', 'strip', 'T', 'analysis.json')))
    S = json.load(open(a.strings))
    fit = an['fit']
    W = widgets()
    cur = {n: O.atlas(n) for n in ('wb_row', 'wb_val', 'wb_cap', 'wb_capb')}

    def cand(spec, chars):
        wd, wg, sz = [float(v) for v in spec.split(',')]
        f = O.candidate(FILE, sz, [wg, wd], chars=chars)
        f['spec'] = {'file': FILE, 'size': sz, 'wght': wg, 'wdth': wd}
        return f

    allstr = lambda fs: ''.join(sorted(set(''.join(s for f in fs for s in S.get(f, {}).values())) - {' '})) + ' '
    T = {'about': ('Package T (strip typography). BMW = the stock G20 strip measured on photos 60-68 (2026-11-16 set; 68 '
                   'is the same shot as 39), dilation-corrected (tools/strip/T/analyse.py; calibration on our own text in '
                   'photo 60, tools/strip/T/calib60.py). Ours = the baked atlases and wb_dials.json as of the base. '
                   'Panel px, continuous coordinates (pixel i covers [i, i+1)). Baseline = the bottom edge of flat-bottomed '
                   'ink. Heights of Roboto bakes are hinted to whole px (Pillow rounds the size to an integer too).'),
         'status': 'provisional', 'fields': {}}

    # ---------------------------------------------------------------- BMW
    pitch = identical_pitch(an, S)
    bmw_adv = med(pitch)
    reg = lambda f: rows_of(an, f, True)
    bmw = {
        'row': {
            'figure_h_round': fit['clock']['fig_h_round'].get('true'), 'figure_h_flat': fit['clock']['fig_h_flat'].get('true'),
            'figure_h_round_range': fit['range']['fig_h_round'].get('true'),
            'stem': med([fit['clock']['stem_digits'].get('true'), fit['range']['stem_digits'].get('true')]),
            'digit_advance': bmw_adv, 'digit_advance_n': len(pitch), 'digit_advance_from': 'two identical digits side by side (photo 63); legacy measured.json 24.2 +- 0.2 over six photos',
            'colon_advance': round(med(colon_pitch(an, S)) - bmw_adv, 2) if colon_pitch(an, S) else None,
            'colon_advance_from': 'the same digit before and after the colon (photo 64): pitch minus one digit advance',
            'baseline': med([r.get('baseline_flat') for f in ('range', 'clock') for r in reg(f)]),
            'baseline_spread': spread([r.get('baseline_flat') for f in ('range', 'clock') for r in reg(f)]),
            'tabular': True,
        },
        'range': {'ink_l': med([r['ink_x'][0] for r in reg('range')]), 'ink_r': med([r['ink_x'][1] for r in reg('range')]),
                  'ink_spread': spread([r['ink_x'][1] for r in reg('range')]),
                  'anchor': 'unsettled: every photo shows a 3-digit range and the digits are tabular, so left, right and '
                            'centre alignment draw the same; the unit does not move'},
        'range_u': {'ink_l': med([r['ink_x'][0] for r in reg('range_u') if r['photo'] != '60']),
                    'ink_r': med([r['ink_x'][1] for r in reg('range_u') if r['photo'] != '60'])},
        'clock': {'ink_l': med([r['ink_x'][0] for r in reg('clock')]), 'ink_r': med([r['ink_x'][1] for r in reg('clock')]),
                  'colon_cx': med([(r['glyphs'][2]['x0'] + r['glyphs'][2]['x1']) / 2 for r in reg('clock') if len(r['glyphs']) == 5]),
                  'colon_spread': spread([(r['glyphs'][2]['x0'] + r['glyphs'][2]['x1']) / 2 for r in reg('clock') if len(r['glyphs']) == 5]),
                  'anchor': 'unsettled: every photo shows a 2-digit hour starting with 1 (tabular, so the layout is fixed); '
                            'the colon centre is the stable reference'},
        'temp': {'ink_l': med([r['ink_x'][0] for r in reg('temp')]), 'ink_r': med([r['ink_x'][1] for r in reg('temp')]),
                 'ink_r_spread': spread([r['ink_x'][1] for r in reg('temp')]),
                 'anchor': 'unsettled: every photo shows "+d.d"; a negative or two-digit value is not photographed'},
        'temp_u': {'ink_l': med([r['ink_x'][0] for r in reg('temp_u') if r['photo'] != '60']),
                   'ink_r': med([r['ink_x'][1] for r in reg('temp_u') if r['photo'] != '60'])},
    }
    # units: grey, so photo 68 (unsaturated, plateau 0.3) measured directly, minus the unsaturated dilation of photo 60
    cal = json.load(open(os.path.join(C.ROOT, 'bake', 'work', 'strip', 'T', 'calib60.json')))
    bu = cal['unsaturated_g1.0']['b_h']
    m68 = {f: json.load(open(os.path.join(C.ROOT, 'bake', 'work', 'strip', 'T', 'meas', '68_%s.json' % f))) for f in ('range_u', 'temp_u')}
    k_, m_ = m68['range_u']['glyphs']
    o_, c_ = m68['temp_u']['glyphs']
    bmw['units'] = {'k_ascender_h': round(k_['y1'] - k_['y0'] - 2 * bu, 2), 'm_x_h': round(m_['y1'] - m_['y0'] - 2 * bu, 2),
                    'C_cap_h': round(c_['y1'] - c_['y0'] - 2 * bu, 2), 'ring_h': round(o_['y1'] - o_['y0'] - 2 * bu, 2),
                    'stem': round(float(np.median([k_['stem_h'], m_['stem_h'], c_['stem_h']])) - 2 * bu, 2),
                    'colour': 'grey: about 0.35 of the values\' white in linear light (photo 68 plateau 0.30-0.36 against 0.95)',
                    'from': 'photo 68 only (the one photo where the grey units are not saturated); -2 x %.2f unsaturated dilation' % bu}
    bmw['road'] = {'cap_h': fit['street']['cap_h'].get('true'), 'x_h': fit['street']['x_h'].get('true'),
                   'stem': fit['street']['cap_stem'].get('true'), 'stem_note': 'weak (k fit 0.5, rms 0.46)',
                   'baseline': med([r.get('baseline') for r in reg('street')]), 'baseline_spread': spread([r.get('baseline') for r in reg('street')]),
                   'ink_cx': med([r['ink_cx'] for r in reg('street')]), 'ink_cx_spread': spread([r['ink_cx'] for r in reg('street')]),
                   'anchor': 'centre (two strings of very different width centre on the same x)'}
    mrows = {f: rows_of(an, f) for f in ('msg1', 'msg2a', 'msg2b')}
    bmw['msg'] = {'cap_h': [fit['msg2a']['cap_h']['true_k1'], fit['msg2a']['cap_h']['true_k075']],
                  'x_h': [min(fit[f]['x_h']['true_k1'] for f in mrows), max(fit[f]['x_h']['true_k075'] for f in mrows)],
                  'stem': [fit['msg2b']['x_stem']['true_k1'], fit['msg2b']['x_stem']['true_k075']],
                  'baseline_1line': med([r['baseline'] for r in mrows['msg1']]),
                  'baselines_2line': [med([r['baseline'] for r in mrows['msg2a']]), med([r['baseline'] for r in mrows['msg2b']])],
                  'ink_cx': med([r['ink_cx'] for f in mrows for r in mrows[f]]),
                  'anchor': 'centre', 'from': 'one photo per line kind (62 two lines, 66 one line): a range for k 1..0.75'}
    bmw['sign'] = {'figure_h': fit['sign']['fig_h_round']['true_k1'], 'stem': fit['sign']['stem_digits']['true_k1'],
                   'ink_cx': med([r['ink_cx'] for r in reg('sign')]), 'mid_y': med([r.get('mid_y') for r in reg('sign')]),
                   'note': 'dark digits on the light face, not dilation-corrected (their raw height does not follow b)'}
    for kk in ('mode_l1', 'mode_l2'):
        if kk in fit:
            bmw.setdefault('mode', {})[kk] = {'cap_h': [fit[kk]['cap_h']['true_k1'], fit[kk]['cap_h']['true_k075']],
                                              'baseline': fit[kk]['baseline']['median'], 'ink_cx': fit[kk]['ink_cx']['median']}
    if 'mode' in bmw:
        bmw['mode']['note'] = 'standby only (photo 65, provisional registration); left-aligned at x ~1224, two lines'

    # ---------------------------------------------------------------- ours, now and recommended
    def font_metrics(f):
        s = O.summary(f) if 'name' in f else {}
        g = f['glyphs']
        out = {'size': f['size'], 'cellHeight': f['cellHeight'], 'baseline': f['baseline']}
        if '0' in g and 'top' in g['0']:
            out.update({'figure_h': round(-g['0']['top'], 2), 'stem_1': round(g['1']['stem_h'], 2), 'digit_advance': g['0']['advance']})
        for ch, key in (('П', 'cap_h'), ('H', 'cap_h_latin'), ('о', 'x_h'), ('x', 'x_h_latin'), ('C', 'C_h'), ('k', 'k_h'), ('m', 'm_h')):
            if ch in g and 'top' in g[ch]:
                out[key] = round(-g[ch]['top'], 2)
        if 'П' in g and g['П'].get('stem_h'):
            out['stem_П'] = round(g['П']['stem_h'], 2)
        if 'H' in g and g['H'].get('stem_h'):
            out['stem_H'] = round(g['H']['stem_h'], 2)
        return out

    rec_row = cand(a.row, '0123456789:+-.')
    rec_unit = cand(a.unit, 'kmC°')
    rec_road = cand(a.road, allstr(['street']) + 'ПНоHx')
    rec_msg = cand(a.msg, allstr(['msg1', 'msg2a', 'msg2b']) + 'ПНоHx')
    rec_sign = cand(a.sign, '0123456789')

    T['bmw'] = bmw
    T['ours_now'] = {n: dict(font_metrics(cur[n]), source='apps/f30_cluster/hud/fonts/%s.json' % n) for n in cur}
    T['recommended_bakes'] = {
        'wb_row': dict(font_metrics(rec_row), **rec_row['spec'], chars='DIGITS + ":+-."',
                       why='figure height stays 31 (BMW 31.1 round / 30.8 flat); the tabular advance becomes 24 '
                           '(BMW %.2f; now 23); stem %.2f (BMW %.2f; now 5.0)' % (bmw_adv, rec_row['glyphs']['1']['stem_h'], bmw['row']['stem'])),
        'wb_rowu (new; units of the row)': dict(font_metrics(rec_unit), **rec_unit['spec'], chars='"kmC°" + LOWER for other units',
                       why='BMW\'s units are smaller and lighter than wb_val (36 px, C 26, stem 5)'),
        'wb_road (new; road label, with Cyrillic)': dict(font_metrics(rec_road), **rec_road['spec'],
                       why='BMW\'s road label: cap %.2f, x %.2f; wb_cap (21 px, cap 15) is half its size and also '
                           'draws the dial captions, so it cannot simply grow' % (bmw['road']['cap_h'], bmw['road']['x_h'])),
        'wb_msg (new; our message line, with Cyrillic)': dict(font_metrics(rec_msg), **rec_msg['spec'],
                       why='BMW\'s message: cap %.1f-%.1f, x %.1f-%.1f, heavier than the road label' % tuple(bmw['msg']['cap_h'] + bmw['msg']['x_h'])),
        'wb_lim (new; the limit digits on our sign, optional)': dict(font_metrics(rec_sign), **rec_sign['spec'],
                       why='BMW\'s sign digits: %.2f tall, stem %.2f; wb_val draws them 26 tall, stem 4.8' % (bmw['sign']['figure_h'], bmw['sign']['stem'])),
    }

    # widget placement: the box x / y that put the recommended (and the current) font's ink on BMW's
    place_rows = []

    def widget_plan(wid, field, font_now, font_rec, edge, target, base_target, key):
        w = W[wid]
        out = {'widget': wid, 'now': {k: w[k] for k in ('x', 'y', 'w', 'h', 'font', 'align')}}
        strs = list(S.get(field, {}).values())
        for tag, f in (('now', font_now), ('rec', font_rec)):
            if any(c not in f['glyphs'] for s in strs for c in s):
                out[tag] = {'cannot_draw': 'the font has no glyph for some characters of the photo strings (no Cyrillic)',
                            'baseline_at_current_y': w['y'] + f['baseline'],
                            'dy_needed': round(base_target - (w['y'] + f['baseline']), 2), 'box_y': base_target - f['baseline'],
                            'box_y_int': int(round(base_target - f['baseline'])), 'cellHeight': f['cellHeight']}
                continue
            xs = [place(f, s, w.get('align', 'center'), w['w'], target, edge) for s in strs]
            x_box = med(xs)
            y_box = base_target - f['baseline']
            lay = [O.layout_ink(f, s, w['x'], w['w'], w.get('align', 'center')) for s in strs]
            if edge == 'r':
                v = [l[-1][2] for l in lay]
            elif edge == 'l':
                v = [l[0][1] for l in lay]
            elif edge == 'c':
                v = [(l[0][1] + l[-1][2]) / 2 for l in lay]
            else:
                v = [[(a1 + b1) / 2 for c1, a1, b1 in l if c1 == ':'][0] for l in lay]
            out[tag] = dict(out.get(tag, {}), ink_edge_at_current_x=med(v), baseline_at_current_y=w['y'] + f['baseline'],
                            dx_needed=round(target - med(v), 2), dy_needed=round(base_target - (w['y'] + f['baseline']), 2),
                            box_x=x_box, box_y=y_box, box_x_int=int(round(x_box)), box_y_int=int(round(y_box)),
                            residual_x=round(x_box - round(x_box), 2), residual_y=round(y_box - round(y_box), 2))
            out[tag]['cellHeight'] = f['cellHeight']
        out['bmw'] = {'edge': edge if isinstance(edge, str) else 'colon', 'at': target, 'baseline': base_target}
        place_rows.append((key, out))
        return out

    bl = bmw['row']['baseline']
    T['placement'] = {
        'own_range': widget_plan('own_range', 'range', cur['wb_row'], rec_row, 'r', bmw['range']['ink_r'], bl, 'range'),
        'own_clock': widget_plan('own_clock', 'clock', cur['wb_row'], rec_row, ('colon',), bmw['clock']['colon_cx'], bl, 'clock'),
        'own_temp': widget_plan('own_temp', 'temp', cur['wb_row'], rec_row, 'r', bmw['temp']['ink_r'], bl, 'temp'),
        'own_range_u': widget_plan('own_range_u', 'range_u', cur['wb_val'], rec_unit, 'l', bmw['range_u']['ink_l'], bl, 'km'),
        'own_temp_u': widget_plan('own_temp_u', 'temp_u', cur['wb_val'], rec_unit, 'l', bmw['temp_u']['ink_l'], bl, 'degC'),
        'nav': widget_plan('nav', 'street', cur['wb_cap'], rec_road, 'c', bmw['road']['ink_cx'], bmw['road']['baseline'], 'road'),
    }
    T['placement']['note'] = ('box_x / box_y: where the widget box goes so the ink edge named in "bmw" lands on BMW\'s (median '
                              'over the photo strings; tabular digits keep it string-independent). The layout takes '
                              'integers (gen_6wb.text() rounds), so residual_* is what stays. dx/dy_needed: the move '
                              'from the current box. For a right-aligned widget the box right edge is box_x + w.')
    def spec(f):
        return [f['spec']['file'], int(round(f['spec']['size'])), [f['spec']['wght'], f['spec']['wdth']]]
    T['for_F'] = {
        'about': ('tools/bake_fonts.py F30_FONTS entries, (name, file, size, chars, 0, [wght, wdth]). Sizes are integers '
                  '(Pillow rounds a float size). Widget y must come from the baked font (gen_6wb base_at(font, baseline)), '
                  'because Cyrillic capitals with marks change cellHeight and baseline. Baselines below are BMW\'s.'),
        'wb_row': {'bake': spec(rec_row), 'change': 'was [Roboto, 43, [500, 87.5]]: same size and height, wider and lighter',
                   'chars': 'DIGITS + ":+-."', 'colon_advance': bmw['row'].get('colon_advance'),
                   'colon_note': 'BMW\'s colon advance; ours bakes %d. Optional: an advance override for ":"' % rec_row['glyphs'][':']['advance'],
                   'baseline': bmw['row']['baseline'], 'draws': 'own_range, own_clock, own_temp'},
        'wb_rowu': {'bake': spec(rec_unit), 'new': True, 'chars': 'kmCF°l/h', 'baseline': bmw['row']['baseline'],
                    'draws': 'own_range_u, own_temp_u (today wb_val, 36 px, wght 650: too big and too bold)',
                    'note': 'BMW\'s "k" is shorter than its "C" (22.6 against 24.25); Roboto\'s is taller, so ours stands ~3 px over BMW\'s k'},
        'wb_road': {'bake': spec(rec_road), 'new': True, 'chars': 'LOWER + UPPER + DIGITS + " .,-/()" + the apostrophes + Ukrainian (package F)',
                    'baseline': bmw['road']['baseline'], 'centre_x': bmw['road']['ink_cx'], 'draws': 'nav (today wb_cap, 21 px: half BMW\'s size)',
                    'alternative': ['Roboto-wdth-wght.subset.ttf', 42, [375, 87.5]]},
        'wb_msg': {'bake': spec(rec_msg), 'new': True, 'chars': 'as wb_road', 'baselines': {'one_line': bmw['msg']['baseline_1line'],
                    'two_lines': bmw['msg']['baselines_2line']}, 'centre_x': bmw['msg']['ink_cx'],
                   'draws': 'our message (package X; today cc_name / cc_desc in wb_cap)'},
        'wb_lim': {'bake': spec(rec_sign), 'new': True, 'optional': True, 'chars': 'DIGITS', 'draws': 'limit (today wb_val)'},
        'wb_cap_wb_capb': 'unchanged: they draw the dial captions and READY; no strip item should use them once the above exist',
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(T, open(a.out, 'w'), indent=1, ensure_ascii=False)
    print(json.dumps({'bmw': bmw}, indent=1, ensure_ascii=False))
    for k, o in place_rows:
        print('%-6s %-12s now dx %+6.2f dy %+6.2f | rec box x %.2f y %.2f' % (k, o['widget'], o['now'].get('dx_needed', float('nan')), o['now']['dy_needed'],
                                                                       o['rec']['box_x'], o['rec']['box_y']))
    for n, v in T['recommended_bakes'].items():
        print(n, {k: v[k] for k in v if k not in ('why', 'chars')})
    print('->', a.out)


if __name__ == '__main__':
    main()
