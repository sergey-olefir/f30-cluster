"""Package VF: our check-control message (decision 6) and BMW's fallback window, placed through package VG's layout
and checked against BMW's reserved items.

Inputs: package VG's provisional layout (R, the two centres), BMW's panel outline zc.panel
(design/strip/ZC/mask_proposal.json) and the reserved items of the brief's section 2. Output:
design/twin-dial/vf/message_panel.json - the design in dial units (u, v in R from the midpoint of the two dial
centres) and, for VG's current rev, in panel px, with every coverage / clearance check and its margin.

    .../python -I tools/twin-dial/vf/message_panel.py [vg_layout.json] [out.json]
"""
import json
import sys

import cv2
import numpy as np

VG = sys.argv[1] if len(sys.argv) > 1 else 'bake/work/twin-dial/pub/VG/layout.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'design/twin-dial/vf/message_panel.json'
CLEAR = 3.0                              # px, the strip round's clearance

lay = json.load(open(VG))
R = float(lay['R_px'])
(tx, ty), (sx, sy) = lay['centres']['tacho_left'], lay['centres']['speedo_right']
MX, MY = (tx + sx) / 2, (ty + sy) / 2
panel = next(s for s in json.load(open('design/strip/ZC/mask_proposal.json'))['shapes'] if s['id'] == 'zc.panel')
P = np.array(panel['polygon'], float)
BELTS = [497.0, 660.0, 688.0, 720.0]     # VG's belt / airbag group (brief: about [500.5, 664.25, 684.25, 715.5])
GEAR_GAP = [1380.0, 660.0, 1460.0, 720.0]
PANEL_H = 720.0


def px(u, v):
    return [round(MX + u * R, 2), round(MY + v * R, 2)]


def box_px(b):
    return px(b[0], b[1]) + px(b[2], b[3])


def dial(x, y):
    return [round((x - MX) / R, 4), round((y - MY) / R, 4)]


# ---- the design, dial units (u0, v0, u1, v1); the bottom-row grammar of reference 02 (VF-REPORT section 3) ------
v_bottom = round((PANEL_H - MY) / R, 4)  # the panel's lower edge in R for this layout
D = {
    'variant': 'M2 "bottom plate" (recommended): the message takes the bottom row\'s place, BMW\'s own spot',
    'plate': [-0.885, 0.640, 0.900, v_bottom],
    'rule': {'v': 0.710, 'u': [-1.105, 1.105], 'thick_R': 0.0075, 'thick_msg_R': 0.012},
    'symbol_cell': [-0.860, 0.745, -0.640, 1.025],
    'symbol_h_R': 0.18,
    'text': {'left_u': -0.590, 'right_u': 0.880, 'cap_R': 0.100, 'baselines_two': [0.854, 1.010],
             'baseline_one': 0.932, 'max_lines': 2},
    'counter': {'right_u': 0.880, 'baseline': 1.010, 'cap_R': 0.068, 'text_right_u_when_shown': 0.740},
    'tab': 'the tab bar\'s warning tab is the highlighted tab, filled in the severity colour (reference 04 state)',
}
M1 = {
    'variant': 'M1 "centre card" (option): the warning page in the centre window, as reference 04\'s state',
    'symbol_cell': [-0.150, -0.560, 0.150, -0.230],
    'symbol_h_R': 0.22,
    'rule': {'v': -0.150, 'u': [-0.733, 0.733], 'thick_R': 0.012},
    'text': {'centre_u': 0.0, 'half_width_R': 0.733, 'cap_R': 0.100, 'baselines_two': [0.080, 0.236],
             'baseline_one': 0.120, 'max_lines': 2},
    'counter': {'centre_u': 0.0, 'baseline': 0.450, 'cap_R': 0.068},
}

# ---- the fallback window: zc.panel dilated by CLEAR px (raster at 8x, then the outer contour) --------------------
S = 8
x0, y0 = int(P[:, 0].min()) - 10, int(P[:, 1].min()) - 10
W, H = int(P[:, 0].max()) + 10 - x0, int(P[:, 1].max()) + 10 - y0
m = np.zeros((H * S, W * S), np.uint8)
cv2.fillPoly(m, [np.round((P - [x0, y0]) * S).astype(np.int32)], 255)
k = int(round(2 * CLEAR * S)) + 1
m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
c = max(cs, key=cv2.contourArea)
c = cv2.approxPolyDP(c, 0.25 * S, True)[:, 0, :].astype(float) / S + [x0, y0]
win = [[round(float(a), 2), round(float(b), 2)] for a, b in c]
wb = [min(p[0] for p in win), min(p[1] for p in win), max(p[0] for p in win), max(p[1] for p in win)]


def gap(a, b):
    """signed clearance between boxes a and b (px; negative = overlap depth)"""
    dx = max(b[0] - a[2], a[0] - b[2])
    dy = max(b[1] - a[3], a[1] - b[3])
    return round(max(dx, dy), 2)


plate = box_px(D['plate'])
cell = box_px(D['symbol_cell'])
rule = px(D['rule']['u'][0], D['rule']['v'] - D['rule']['thick_msg_R'] / 2) + \
    px(D['rule']['u'][1], D['rule']['v'] + D['rule']['thick_msg_R'] / 2)
text_box = px(D['text']['left_u'], D['text']['baselines_two'][0] - D['text']['cap_R']) + \
    px(D['text']['right_u'], D['text']['baselines_two'][1] + 0.025)
checks = {
    'plate_covers_window': {
        'ok': bool(plate[0] <= wb[0] and plate[1] <= wb[1] and plate[2] >= wb[2] and plate[3] >= wb[3]),
        'margins_px': [round(wb[0] - plate[0], 2), round(wb[1] - plate[1], 2), round(plate[2] - wb[2], 2),
                       round(plate[3] - wb[3], 2)]},
    'plate_vs_belts_px': gap(plate, BELTS),
    'plate_vs_gear_gap_px': gap(plate, GEAR_GAP),
    'symbol_cell_vs_belts_px': gap(cell, BELTS),
    'rule_vs_belts_px': gap(rule, BELTS),
    'rule_vs_gear_gap_px': gap(rule, GEAR_GAP),
    'text_vs_belts_px': gap(text_box, BELTS),
    'inside_the_window_when_open': [n for n, b in (('plate', plate), ('rule', rule), ('symbol_cell', cell),
                                                  ('text', text_box)) if gap(b, wb) < 0],
}
for n in ('plate_vs_belts_px', 'plate_vs_gear_gap_px', 'symbol_cell_vs_belts_px', 'rule_vs_belts_px',
          'rule_vs_gear_gap_px', 'text_vs_belts_px'):
    checks[n] = {'clear_px': checks[n], 'ok': bool(checks[n] >= CLEAR)}

out = {
    '_about': 'Package VF: our check-control message and BMW\'s fallback window (decision 6). Dial units: u, v in '
              'R from the midpoint of the two dial centres; panel px for package VG\'s layout rev %s (R %g, centres '
              '%s %s), which is PROVISIONAL. Made by tools/twin-dial/vf/message_panel.py.' % (
                  lay.get('rev'), R, lay['centres']['tacho_left'], lay['centres']['speedo_right']),
    'vg_rev': lay.get('rev'),
    'M2': D,
    'M2_px': {'plate': plate, 'symbol_cell': cell, 'rule_message': rule, 'text_block': text_box,
              'baselines_two_y': [px(0, b)[1] for b in D['text']['baselines_two']],
              'baseline_one_y': px(0, D['text']['baseline_one'])[1],
              'cap_px': round(D['text']['cap_R'] * R, 1), 'text_width_px': round((D['text']['right_u'] -
                                                                                  D['text']['left_u']) * R, 1)},
    'M1': M1,
    'M1_px': {'symbol_cell': box_px(M1['symbol_cell']),
              'baselines_two_y': [px(0, b)[1] for b in M1['text']['baselines_two']],
              'text_width_px': round(2 * M1['text']['half_width_R'] * R, 1)},
    'fallback_window': {
        'what': 'zc.panel (BMW\'s message panel: arc rail, fill, symbol slot, one or two lines) dilated by %g px; '
                'a hole through EVERY layer of ours that draws inside it, opened from the signal handler' % CLEAR,
        'polygon_px': win, 'bbox_px': [round(float(a), 2) for a in wb],
        'bbox_R': dial(wb[0], wb[1]) + dial(wb[2], wb[3]),
        'zc_panel_bbox_px': [float(P[:, 0].min()), float(P[:, 1].min()), float(P[:, 0].max()), float(P[:, 1].max())]},
    'checks': checks,
}
json.dump(out, open(OUT, 'w'), indent=1, default=float)
print(json.dumps(out['checks'], indent=1))
print('window bbox px', out['fallback_window']['bbox_px'], 'R', out['fallback_window']['bbox_R'])
print('M2 px', json.dumps(out['M2_px']))
