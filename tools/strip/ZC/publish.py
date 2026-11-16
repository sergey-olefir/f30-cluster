"""Package ZC: assemble design/strip/ZC/atlas.json and design/strip/ZC/diff_summary.json (numbers only) from the
git-ignored outputs of atlas.py / geometry.py / texts.py / unattributed.py / diff.py, and copy what other packages
need to bake/work/strip/pub/ZC/ (then touch READY). Run last, from the repo root (uv line of atlas.py).
"""
import json
import os
import shutil
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zc_common as Z  # noqa: E402

W = os.path.join(Z.WORK, 'zone-c')
DST = os.path.join(Z.ROOT, 'design', 'strip', 'ZC')
PUB = os.path.join(Z.WORK, 'pub', 'ZC')
G = json.load(open(os.path.join(W, 'geometry.json')))
T = json.load(open(os.path.join(W, 'texts.json')))
U = json.load(open(os.path.join(W, 'unattributed.json')))
D = json.load(open(os.path.join(W, 'diff.json')))


def mean(v):
    return round(float(np.mean(v)), 2)


def spread(v):
    return round(float(np.max(v) - np.min(v)), 2)


arc = {pid: G[pid]['arc'] for pid in ('62', '66')}
atlas = {
    '_about': 'Package ZC stock atlas, zone C (x 690-1250). Continuous panel px [x0, y0, x1, y1]. Edges at 50 % '
              'between local black and the element plateau on 4x rectified crops (package R rects). Colours are '
              'photo colours (sRGB decoded), white text = 1.0. No text content anywhere.',
    'registration': {pid: G[pid]['source'] for pid in G} | {pid: T[pid]['source'] for pid in T},
    'independence_note': '62 = 08, 61 = 09, 60 = 10, 68 = 39 are the same frames (package H); independent '
                         'message captures are 62 and 66 only; 64 and 67 show the same road string.',
    'assist.cc_panel': {
        'arc': {
            'centre_y_flat': {'value': mean([arc[p]['centre_y_at_960'] for p in arc]),
                              'per_photo': {p: arc[p]['centre_y_at_960'] for p in arc}, 'kind': 'verified'},
            'top50_flat': mean([arc[p]['top50_flat'] for p in arc]),
            'bot50_flat': mean([arc[p]['bot50_flat'] for p in arc]),
            'fwhm_px': {'value': mean([arc[p]['fwhm_flat'] for p in arc]),
                        'per_photo': {p: arc[p]['fwhm_flat'] for p in arc}},
            'flat_x': [mean([arc[p]['flat_x'][0] for p in arc]), mean([arc[p]['flat_x'][1] for p in arc])],
            'sag_over_flat_px': {p: arc[p]['sag_over_380px'] for p in arc},
            'shoulder_left_circle_cx_cy_r': [mean([arc[p]['shoulder_circle_left_cx_cy_r_rms'][i] for p in arc])
                                             for i in range(3)],
            'shoulder_right_circle_cx_cy_r': [mean([arc[p]['shoulder_circle_right_cx_cy_r_rms'][i] for p in arc])
                                              for i in range(3)],
            'tips_x_at_50pct_of_plateau': {p: arc[p]['tips_x_50pct'] for p in arc},
            'tips_x_at_10pct_of_plateau': {p: arc[p]['tips_x_10pct'] for p in arc},
            'faint_tail_extent': {'left': [701, 621], 'right': [1220, 621],
                                  'note': 'where the tapered tip falls to 0.5 % of white (photo 62 rows)'},
            'brightness_rel_white_text': {p: arc[p]['plateau_rel_white'] for p in arc},
            'axis_of_symmetry_x': mean([(arc[p]['flat_x'][0] + arc[p]['flat_x'][1]) / 2 for p in arc]),
            'polyline_62': arc['62']['polyline_every_2px'],
            'same_for_one_and_two_lines': 'yes: 62 (two lines) and 66 (one line) agree within 0.9 px (registration)',
        },
        'fill': {
            'what': 'a gradient under the arc, separated from the arc by a ~2 px dark line, brightest just under '
                    'the flat part, fading downward and towards both tips; no hard edge except the arc on top',
            'profile_rel_white_x791_y_from_597': G['62']['fill_columns_rel_white_y596_719']['791'],
            'rows_rel_white_x690_1239': G['62']['fill_rows_rel_white_x690_1239'],
            'iso_0.5pct_of_white': {'y620': [701, 1220], 'y640': [726, 1205], 'y660': [734, 1177],
                                    'y680': [736, 1130], 'y690': 'below 0.3 % except the text halo'},
            'peak_rel_white': 0.05,
            'colour_note': 'warm purple-grey in the photos (linear R > B > G, about 1 : 0.6 : 0.85 just under the '
                           'arc); not display-calibrated',
            'evidence': '62 (cleanest black), 66, and 17 (theme connected) agree in shape; above the arc the same '
                        'distance from the text reads black, so it is not camera bloom',
            'kind': 'verified',
        },
        'relation': {'value': 'under', 'evidence': 'session photo 58: with our opaque paint above and below, BMW\'s '
                                                   'message and symbol show only in the 13 px gap y 652-666; no arc '
                                                   'shows above it', 'kind': 'verified (photo 58, unregistered)'},
        'theme_connected_17_vs_66': {
            'arc_y_differences_px': '<= 1.1 at x 720/730/740/1180/1190/1200 and on the flat',
            'symbol_and_text_x': '17 reads 2-3.5 px further left than 66 for symbol and text, not for the arc: at '
                                 '17\'s 0.64 photo px per panel px this is inside its registration; no change shown',
            'kind': 'hypothesis (no change)'},
    },
    'bottom.cc_info': {
        'boxes': {'62 (info symbol)': T['62']['symbol']['box'], '66 (door symbol)': T['66']['symbol']['box']},
        'centre_y': mean([T['62']['symbol']['centre'][1], T['66']['symbol']['centre'][1]]),
        'right_edge_x': [T['62']['symbol']['box'][2], T['66']['symbol']['box'][2]],
        'slot_proposed': [711, 632, 757, 688],
        'note': 'neither left, centre nor right anchored exactly (right edges 752.75 / 756.0); the slot holds a '
                'symbol up to ~45 px wide ending at x 753-756',
        'relation': 'under (photo 58)', 'kind': 'verified'},
    'cc.text': {
        'two_line': [T['62']['lines'][0], T['62']['lines'][1]],
        'one_line': T['66']['lines'][0],
        'anchor': {'value': 'centre', 'centre_x': mean([l['centre_x'] for l in T['62']['lines'] + T['66']['lines']]),
                   'spread': spread([l['centre_x'] for l in T['62']['lines'] + T['66']['lines']]),
                   'evidence': 'three lines of different width (299, 277, 261 px) on two independent captures'},
        'widest_box': {'value': [757.5, 1177.5], 'from': 'spec 5.3 one-line band, consistent with centre 968.6; '
                                                         'not settled by any photo (BMW wraps long messages)'},
        'kind': 'verified'},
    'bottom.street': {
        'per_photo': {p: T[p]['road'] for p in ('61', '64', '67', '68')},
        'anchor': {'value': 'centre', 'centre_x': mean([T[p]['road']['centre_x'] for p in ('61', '64', '68')]),
                   'spread': spread([T[p]['road']['centre_x'] for p in ('61', '64', '67', '68')]),
                   'evidence': 'three different strings (330, 282, 98 px wide); 64 and 67 are the same string'},
        'baseline': mean([T[p]['road']['baseline'] for p in ('61', '64', '67', '68')]),
        'widest_seen_px': {'value': 509, 'from': 'design/g20-spec/measured.json (photo 34), not re-measured'},
        'widest_box_proposed': [703, 665.25, 1219, 711.5],
        'relation': 'under (catalogue; not re-measured)', 'kind': 'verified'},
    'bottom.odometer': {
        'standby_65': T['65']['odometer'], 'words_65': T['65']['odometer_words'],
        'digits_centre_x': mean([T['65']['odometer_words'][1]['left_x'], T['65']['odometer_words'][3]['right_x']]),
        'anchor': 'hypothesis: the digit group is centred on x ~960.5 (one string only); label hangs left, unit right',
        'ghost_63': {'box': T['63']['ghost']['box'], 'centre_x': T['63']['ghost']['centre_x'],
                     'peak_rel_rail_white': T['63']['ghost_peak_rel_white'],
                     'what': 'BMW\'s standby odometer at about 2-3 % of white, digits in the same place as 65 '
                             'within 2.5 px: a frame of the standby-to-normal cross-fade (hypothesis on the cause)'},
        'kind': 'verified (position); anchor hypothesis'},
    'rail.centre': {
        'what': 'the two hooks between the dials\' bottom lines, present in every no-message state (61, 63, 64, '
                '65, 67, 68, and 60 with the theme connected) and absent while a message shows',
        'hook_l_polyline_63': G['63']['hook_l'][::4], 'hook_r_polyline_63': G['63']['hook_r'][::4],
        'notches_rows_644_650': {p: G[p]['rail_rows'] for p in ('61', '63', '64', '65', '67', '68')},
        'notch_centre_x': {'left': 695.1, 'right': 1224.1, 'slant_px_per_px': 0.73},
        'message_state_rail_ends': {p: G[p]['rail_rows'] for p in ('62', '66')},
        'message_state_summary': 'with a message the speedo rail ends at x 685-687 with a rounded end (no slant) '
                                 'and the tacho rail starts at 1232.2-1232.6: both about 7 px further from the '
                                 'centre than the no-message notches',
        'relation': 'under (58: no BMW hook or rail in our opaque paint)', 'kind': 'verified'},
    'unattributed_light': {p: {'unexplained_px': U[p]['unexplained_px'], 'blobs': U[p]['blobs'][:8]} for p in U},
    'unattributed_ids': {
        'map.region (foot)': 'faint light at y 601-610 under the map in 61 / 68 (map lines reaching the strip)',
        'glass specks': 'point-like at (792, 622), (748, 687), (869, 603), (771, 692), (932, 641), (1113, 624), '
                        '(740, 604), (824, 649) in 64 / 65 / 67, the same places in each: dust on the cover glass, '
                        'not display content (hypothesis; absent in 61 / 63 / 68)',
        'unexplained': [{'box': [1221, 660, 1226, 666], 'photos': ['66', '67'], 'peak_rel_white': 0.02,
                         'note': 'both are the reflection-angle photos; probably a reflection'}]},
}
os.makedirs(DST, exist_ok=True)
json.dump(atlas, open(os.path.join(DST, 'atlas.json'), 'w'), indent=1)

# diff summary: per distinct (mode, maps, photo) the defects only
rows = []
for c in D['cases']:
    defects = {}
    for el, r in c['elements'].items():
        if r.get('CLIP_px', 0) > 0 or r.get('LEAK_px', 0) > 0:
            defects[el] = {k: v for k, v in r.items() if k in ('must', 'CLIP_px', 'CLIP_sum_alpha_px', 'CLIP_light',
                                                              'CLIP_box', 'LEAK_px', 'LEAK_light', 'LEAK_box')}
    rows.append({'layout': c['layout'], 'mode': c['mode'], 'state': c['state'], 'photo': c['photo'],
                 'maps_hash': c['maps_hash'], 'defects': defects, 'DOUBLE': c['DOUBLE'], 'SEAMS_top': c['SEAMS_top'][:5]})
json.dump({'_about': 'Package ZC pixel diff of zone C: stock photos x package O maps. Counts in panel px.',
           'sources': D['sources'], 'identical_maps': D['identical_maps'], 'rows': rows},
          open(os.path.join(DST, 'diff_summary.json'), 'w'), indent=1)

os.makedirs(PUB, exist_ok=True)
for f in ('atlas.json', 'diff_summary.json', 'mask_proposal.json'):
    shutil.copy(os.path.join(DST, f), os.path.join(PUB, f))
for ch in ('ours', 'bmw', 'bmw_msg', 'standby'):
    shutil.copy(os.path.join(W, 'mask_%s_4x.png' % ch), os.path.join(PUB, 'mask_%s_4x.png' % ch))
open(os.path.join(PUB, 'ABOUT.txt'), 'w').write(
    'Package ZC (zone C, x 690-1250: check-control panel, symbol slot, message text, road label, standby odometer, '
    'centre hooks).\n'
    'atlas.json          the stock atlas (numbers only)\n'
    'diff_summary.json   CLIP / LEAK / DOUBLE / SEAM per layout x mode x state x photo against package O maps\n'
    'mask_proposal.json  shapes per channel {id, channel, kind, polygon, feathers, reason, evidence, clearance}\n'
    'mask_<ch>_4x.png    4x preview, uint16, 2240 x 720 = panel x 690-1250, y 540-720; 65535 = our opaque cover\n'
    'Above y 596 the zone-C mask defers to the existing map-window foot (collar).\n')
open(os.path.join(PUB, 'READY'), 'w').write('ok\n')
print('published')
