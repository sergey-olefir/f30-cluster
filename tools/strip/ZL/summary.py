"""Package ZL: collect the per-photo measurements (bake/work/strip/zone-L/*.json) into the tracked numbers file
design/strip/ZL/atlas.json and copy what other packages need to bake/work/strip/pub/ZL/. Numbers only: no photo
pixel, no text read off a photo.
    python3 tools/strip/ZL/summary.py
"""
import json
import os
import shutil
import statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
MAIN = os.environ.get('F30_MAIN', '~/projects/f30-cluster')
ZD = os.path.join(MAIN, 'bake', 'work', 'strip', 'zone-L')
PUB = os.path.join(MAIN, 'bake', 'work', 'strip', 'pub', 'ZL')
SIGN_P = ['60', '61', '62', '63', '64', '66', '67', '68']
ALL_P = ['60', '61', '62', '63', '64', '65', '66', '67', '68']


def j(name):
    f = os.path.join(ZD, name)
    return json.load(open(f)) if os.path.exists(f) else None


def main():
    out = {'kind': 'zone L stock atlas (package ZL)', 'coords': 'continuous panel px',
           'models': 'ZL local models (tools/strip/ZL/local60.py, tie.py): provisional; R cross-check in the report',
           'independent_captures': 'per package H: 60=10, 61=09, 62=08, 68=39 are the same frames; 63-67 new',
           'sign': {}, 'sign_context': {}, 'elements': {}, 'gaps': {}, 'unattributed': {}, 'registration': {}}
    hl = j('HL.json') or {}
    h = j('H.json') or {}
    if '60L' in h:
        out['registration']['60L'] = {k: h['60L'][k] for k in ('rms_panel_px', 'inliers', 'points', 'per_line_mean_sd_n')}
    for p, e in hl.items():
        out['registration'][p] = {k: e[k] for k in ('rms_panel_px', 'inliers', 'matches', 'photo_px_per_panel_px')}
    for p in SIGN_P:
        s = j('sign_%s.json' % p)
        if s:
            out['sign'][p] = {k: s[k] for k in ('centre_outer', 'r_outer', 'centre_inner', 'r_inner', 'ring_width',
                                                 'outer_resid_rms', 'outer_resid_max', 'outer_harmonics',
                                                 'inner_harmonics', 'ellipse_outer', 'outer_by_octant', 'rays_used',
                                                 'colour_ring', 'colour_face_rim', 'colour_outside', 'radial_profile')}
        c = j('signctx_%s.json' % p)
        if c:
            out['sign_context'][p] = {k: c.get(k) for k in ('rail', 'sign_cy_minus_rail_y', 'rail_vs_ring', 'readout_bbox',
                                                            'readout_right_to_sign_centre_dx', 'readout_clear_gap_to_ring_px',
                                                            'face_green', 'face_ink_box', 'face_ink_components',
                                                            'face_ink_centre_minus_face_centre', 'face_ink_stem_px_median')}
    for name in ('sign_rects.json', 'sign60_local.json', 'our_window_profile.json'):
        v = j(name)
        if v is not None:
            if name == 'our_window_profile.json':
                v = {k: {'circle_0.5': x['circle_0.5']} for k, x in v.items()}
            out[name.replace('.json', '')] = v
    for p in ALL_P:
        a = j('atlas_%s.json' % p)
        if not a:
            continue
        out['elements'][p] = {k: (None if v is None else {x: v[x] for x in ('bbox', 'components', 'polygons', 'colour_linear',
                                                                             'colour_srgb8', 'halo_rel_by_halfpx', 'ink_px_panel')})
                              for k, v in a['elements'].items()}
        out['elements'][p]['_black_lum_linear_p20_p50_p80'] = a['black_lum_linear_p20_p50_p80']
        out['elements'][p]['_white_text_lum_linear'] = a['white_text_lum_linear']
        out['gaps'][p] = a['gaps_px']
        out['unattributed'][p] = [{k: u[k] for k in ('id', 'box', 'area_px', 'peak_lum_above_black')} for u in a['unattributed'][:30]]
    # robust summaries
    rs = [out['sign'][p]['r_outer'] for p in ('61', '62', '63', '64', '66', '67')]
    ri = [out['sign_context'][p]['face_green']['r'] for p in ('61', '62', '63', '64', '66', '67', '68')]
    off = [out['sign_context'][p]['face_green']['offset_from_outer_centre'][0] for p in ('61', '62', '63', '64', '66', '67', '68')]
    rail = [out['sign_context'][p]['sign_cy_minus_rail_y'] for p in SIGN_P]
    ends = [e['rail_end_radius_from_centre'] for p in SIGN_P for e in out['sign_context'][p]['rail_vs_ring']]
    out['sign_summary'] = {
        'centre_outer': {'value': [538.45, 621.2], 'uncertainty': 0.3,
                         'basis': 'photo 60 on our grid (538.44, 621.29; a local affine on the four nearest grid lines '
                                  'gives 538.2-538.55 / 621.4-621.9); 61, 63, 64, 67, 68 tied to 60: 538.16-538.69 / '
                                  '620.83-621.33; the rail cut is centred on it (midpoint - centre +0.06 +-0.25)'},
        'r_outer_red_halfmax': {'median': round(st.median(rs), 2), 'min': min(rs), 'max': max(rs)},
        'r_face_green_halfmax': {'median': round(st.median(ri), 2), 'min': min(ri), 'max': max(ri)},
        'ring_width': round(st.median(rs) - st.median(ri), 2),
        'face_offset_x_from_ring_centre': {'mean': round(st.mean(off), 3), 'sd': round(st.pstdev(off), 3)},
        'roundness': 'outer edge rms 0.13-0.32 px, ellipticity (2nd harmonic) 0.03-0.38 px with no common axis: round',
        'sign_cy_minus_rail_y': {'mean': round(st.mean(rail), 2), 'sd': round(st.pstdev(rail), 2)},
        'rail_cut_radius': {'median': round(st.median(ends), 2), 'min': min(ends), 'max': max(ends)},
    }
    os.makedirs(os.path.join(REPO, 'design', 'strip', 'ZL'), exist_ok=True)
    json.dump(out, open(os.path.join(REPO, 'design', 'strip', 'ZL', 'atlas.json'), 'w'), indent=1)
    os.makedirs(PUB, exist_ok=True)
    json.dump(out, open(os.path.join(PUB, 'atlas.json'), 'w'), indent=1)
    for f in ('HL.json',):
        if os.path.exists(os.path.join(ZD, f)):
            shutil.copy(os.path.join(ZD, f), os.path.join(PUB, 'models_' + f))
    print(json.dumps(out['sign_summary'], indent=1))


if __name__ == '__main__':
    main()
