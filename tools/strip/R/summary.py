"""Package R: the per-photo table (bake/work/strip/pub/R/registration.json) from H.json, the control points,
photometry.json and crosscheck.json. Where the model is weakest: the field's leave-one-out residual per zone of the
STRIP (L x 0..700, C 690..1250, R 1240..1920) and the number of control points there (no point = interpolated).
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

ZONES = {'L': (0, 700), 'C': (690, 1250), 'R': (1240, 1920)}
ORDER = ['60', '61', '62', '63', '64', '68', '66', '67', '65', '10', '09', '08', '39', '14', '17', '40']


def zone_loo(pid, smoothing):
    from scipy.interpolate import RBFInterpolator
    cp = C.jload(os.path.join(C.OUT, '%s_control_points.json' % pid), {}).get(pid)
    if not cp:
        return None
    s = np.array([p['panel_cont'] for p in cp if p['inlier']]) - 0.5
    r = np.array([p['resid_global'] for p in cp if p['inlier']])
    n = len(s)
    e = np.zeros_like(r)
    for i in range(n):
        k = np.ones(n, bool)
        k[i] = False
        f = RBFInterpolator(s[k], r[k], kernel='thin_plate_spline', smoothing=smoothing, degree=1)
        e[i] = r[i] - f(s[i:i + 1])[0]
    d = np.linalg.norm(e, axis=1)
    out = {}
    for z, (a, b) in ZONES.items():
        k = (s[:, 1] >= 519) & (s[:, 0] >= a - 0.5) & (s[:, 0] < b - 0.5)
        out[z] = {'n': int(k.sum()), 'loo_rms': round(float(np.sqrt((d[k] ** 2).mean())), 3) if k.any() else None,
                  'loo_max': round(float(d[k].max()), 3) if k.any() else None,
                  'x_span_of_points': [round(float(s[k, 0].min() + .5), 1), round(float(s[k, 0].max() + .5), 1)]
                  if k.any() else None}
    return out


def main():
    H = C.jload(os.path.join(C.OUT, 'H.json'))
    ph = C.jload(os.path.join(C.PUB, 'photometry.json'), {})
    cc = C.jload(os.path.join(C.PUB, 'crosscheck.json'), {})
    ring62 = ph.get('62', {}).get('sign_ring_red_lin_minus_black')
    table = {}
    for pid in ORDER:
        e = H.get(pid)
        if not e:
            continue
        p = ph.get(pid, {})
        row = {'scale_photo_px_per_panel_px': e.get('photo_px_per_panel_px'),
               'reference': e.get('reference', e.get('same_frame_as', 'grid')),
               'panel_rms_base': (e.get('panel') or {}).get('rms'), 'panel_max_base': (e.get('panel') or {}).get('max'),
               'panel_loo_field': (e.get('panel_field_loo') or {}).get('rms'),
               'strip_rms_base': (e.get('strip_by_global_model') or {}).get('rms'),
               'strip_loo_field': (e.get('strip_field_loo') or {}).get('rms'),
               'strip_loo_field_max': (e.get('strip_field_loo') or {}).get('max'),
               'black_lin_Y': p.get('black_level_lin_Y'), 'black_srgb8': p.get('black_level_srgb8'),
               'glare_excess_max_rel_white': (p.get('glare_excess_rel_white') or {}).get('max'),
               'valid_fraction_strip': p.get('valid_fraction'),
               'white_text_clipped': (p.get('white_text_p999') or 0) > 0.9,
               'exposure_vs_62_by_sign_ring': round(p['sign_ring_red_lin_minus_black'] / ring62, 3)
               if p.get('sign_ring_red_lin_minus_black') and ring62 else None,
               'edge_10_90_panel_px': p.get('edge_10_90_median'), 'rail_fwhm_panel_px': p.get('rail_fwhm_median'),
               'crosscheck_rms': (cc.get(pid) or {}).get('_rms_ncc_gt_0.8')}
        if e.get('field') and pid not in ('10', '09', '08', '39'):
            row['strip_zones'] = zone_loo(pid, e['field']['smoothing'])
        if pid in ('10', '09', '08', '39'):
            row['check_vs_new_rect'] = e.get('check_vs_new_rect')
        table[pid] = row
        print(pid, {k: v for k, v in row.items() if k not in ('strip_zones', 'check_vs_new_rect')})
        if row.get('strip_zones'):
            print('   ', row['strip_zones'])
    C.jdump({'table': table, '_about': __doc__}, os.path.join(C.PUB, 'registration.json'))


if __name__ == '__main__':
    main()
