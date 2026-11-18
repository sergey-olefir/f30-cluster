"""Twin Dial round 3 (package K2; round 3b additions by KB at the end): the new pictograms the mockups of the tabs and pages need, as DATA in the step format
of design/twin-dial/vt/pictograms.js / shared/twin_icons.js (unit box, y down, angles in degrees clockwise from 12
o'clock; 'cut' subtracts). Our own drawings (MIT, as the rest of VT's set). The build round moves them into
design/twin-dial/vt/pictograms.js; tools/twin-dial/mockup/pages.py renders them as distance fields.
"""
import math


def s(k, *a, cut=False, r=None):
    d = {'k': k, 'a': list(a)}
    if cut:
        d['cut'] = True
    if r is not None:
        d['r'] = r
    return d


def mirror(steps):
    """The same drawing mirrored left-right (x -> 1 - x; an arc's angles -> their negatives, swapped)."""
    out = []
    for st in steps:
        k, a = st['k'], list(st['a'])
        if k == 'seg':
            a = [1 - a[0], a[1], 1 - a[2], a[3], a[4]]
        elif k in ('ring', 'disc', 'box', 'boxo'):
            a[0] = 1 - a[0]
        elif k == 'arc':
            a = [1 - a[0], a[1], a[2], -a[4], -a[3], a[5]]
        elif k == 'poly':
            a = [[1 - x, y] for x, y in a]
        n = dict(st)
        n['a'] = a
        out.append(n)
    return out


_turn_right = [s('seg', 0.34, 0.95, 0.34, 0.52, 0.15), s('arc', 0.6, 0.52, 0.26, 270, 360, 0.15),
               s('seg', 0.6, 0.26, 0.66, 0.26, 0.15), s('poly', [0.62, 0.04], [0.95, 0.26], [0.62, 0.48], r=0.01)]

PICTOS = {
    # tab and page symbols
    'td_car': [s('boxo', 0.5, 0.5, 0.21, 0.43, 0.13, 0.065), s('seg', 0.33, 0.33, 0.67, 0.33, 0.06),
               s('seg', 0.36, 0.74, 0.64, 0.74, 0.06), s('seg', 0.29, 0.38, 0.2, 0.41, 0.05), s('seg', 0.71, 0.38, 0.8, 0.41, 0.05)],
    'td_engine': [s('boxo', 0.5, 0.58, 0.27, 0.2, 0.03, 0.065), s('seg', 0.36, 0.3, 0.64, 0.3, 0.065), s('seg', 0.5, 0.3, 0.5, 0.38, 0.065),
                  s('seg', 0.13, 0.48, 0.13, 0.68, 0.065), s('seg', 0.13, 0.58, 0.23, 0.58, 0.065),
                  s('seg', 0.77, 0.52, 0.89, 0.45, 0.065), s('seg', 0.89, 0.45, 0.89, 0.72, 0.065), s('seg', 0.89, 0.72, 0.77, 0.65, 0.065)],
    'td_gauge': [s('arc', 0.5, 0.58, 0.36, -125, 125, 0.07), s('seg', 0.5, 0.58, 0.7, 0.36, 0.07), s('disc', 0.5, 0.58, 0.07)],
    'td_cruise': [s('arc', 0.5, 0.56, 0.36, -125, 125, 0.07), s('seg', 0.5, 0.56, 0.66, 0.34, 0.07), s('disc', 0.5, 0.56, 0.07),
                  s('seg', 0.3, 0.92, 0.7, 0.92, 0.07)],
    'td_clock': [s('ring', 0.5, 0.5, 0.38, 0.07), s('seg', 0.5, 0.5, 0.5, 0.26, 0.07), s('seg', 0.5, 0.5, 0.68, 0.6, 0.07)],
    'td_road': [s('seg', 0.28, 0.92, 0.42, 0.1, 0.07), s('seg', 0.72, 0.92, 0.58, 0.1, 0.07), s('seg', 0.5, 0.82, 0.5, 0.66, 0.05),
                s('seg', 0.5, 0.5, 0.5, 0.38, 0.05), s('seg', 0.5, 0.24, 0.5, 0.17, 0.045)],
    'td_rain': [s('disc', 0.25, 0.66, 0.1), s('poly', [0.155, 0.63], [0.25, 0.38], [0.345, 0.63]),
                s('disc', 0.5, 0.5, 0.1), s('poly', [0.405, 0.47], [0.5, 0.22], [0.595, 0.47]),
                s('disc', 0.75, 0.66, 0.1), s('poly', [0.655, 0.63], [0.75, 0.38], [0.845, 0.63])],
    # media
    'td_play': [s('poly', [0.3, 0.18], [0.82, 0.5], [0.3, 0.82], r=0.02)],
    'td_pause': [s('box', 0.35, 0.5, 0.08, 0.32, 0.01), s('box', 0.65, 0.5, 0.08, 0.32, 0.01)],
    'td_mute': [s('poly', [0.12, 0.38], [0.3, 0.38], [0.52, 0.16], [0.52, 0.84], [0.3, 0.62], [0.12, 0.62], r=0.02),
                s('seg', 0.66, 0.36, 0.9, 0.64, 0.07), s('seg', 0.66, 0.64, 0.9, 0.36, 0.07)],
    # phone
    'td_handset': [s('arc', 0.5, 0.86, 0.42, -62, 62, 0.11), s('box', 0.16, 0.66, 0.11, 0.08, 0.04), s('box', 0.84, 0.66, 0.11, 0.08, 0.04)],
    'td_phone_ring': [s('boxo', 0.5, 0.55, 0.17, 0.32, 0.05, 0.065), s('seg', 0.45, 0.3, 0.55, 0.3, 0.04),
                      s('arc', 0.5, 0.55, 0.31, 35, 75, 0.05), s('arc', 0.5, 0.55, 0.42, 30, 80, 0.05),
                      s('arc', 0.5, 0.55, 0.31, 285, 325, 0.05), s('arc', 0.5, 0.55, 0.42, 280, 330, 0.05)],
    'td_mic_off': [s('boxo', 0.5, 0.36, 0.12, 0.22, 0.12, 0.065), s('arc', 0.5, 0.42, 0.25, 95, 265, 0.065),
                   s('seg', 0.5, 0.67, 0.5, 0.86, 0.065), s('seg', 0.36, 0.87, 0.64, 0.87, 0.065),
                   s('seg', 0.16, 0.1, 0.84, 0.9, 0.17, cut=True), s('seg', 0.16, 0.1, 0.84, 0.9, 0.07)],
    'td_bars': [s('box', 0.17, 0.78, 0.07, 0.1, 0.01), s('box', 0.39, 0.66, 0.07, 0.22, 0.01),
                s('box', 0.61, 0.54, 0.07, 0.34, 0.01), s('box', 0.83, 0.42, 0.07, 0.46, 0.01)],
    'td_phone_bars': [s('boxo', 0.32, 0.5, 0.18, 0.38, 0.05, 0.065), s('seg', 0.27, 0.21, 0.37, 0.21, 0.045),
                      s('box', 0.66, 0.79, 0.04, 0.07, 0.01), s('box', 0.77, 0.7, 0.04, 0.16, 0.01), s('box', 0.88, 0.6, 0.04, 0.26, 0.01)],
    'td_phone_none': [s('boxo', 0.5, 0.5, 0.22, 0.4, 0.06, 0.07), s('seg', 0.44, 0.2, 0.56, 0.2, 0.045),
                      s('seg', 0.18, 0.92, 0.82, 0.08, 0.18, cut=True), s('seg', 0.18, 0.92, 0.82, 0.08, 0.065)],
    # navigation
    'td_turn_right': _turn_right,
    'td_turn_left': mirror(_turn_right),
    'td_straight': [s('seg', 0.5, 0.95, 0.5, 0.4, 0.15), s('poly', [0.5, 0.05], [0.78, 0.42], [0.22, 0.42], r=0.01)],
    'td_flag': [s('seg', 0.25, 0.1, 0.25, 0.92, 0.07), s('poly', [0.27, 0.1], [0.82, 0.25], [0.27, 0.42], r=0.01)],
    'td_compass': [s('ring', 0.5, 0.5, 0.4, 0.06), s('poly', [0.5, 0.18], [0.62, 0.52], [0.38, 0.52])],
    # small marks
    'td_limit': [s('ring', 0.5, 0.5, 0.38, 0.12)],
    'td_check': [s('seg', 0.18, 0.52, 0.42, 0.76, 0.09), s('seg', 0.42, 0.76, 0.84, 0.26, 0.09)],
    'td_dot': [s('disc', 0.5, 0.5, 0.3)],
}


# ---- round 3b (package KB): navigation and media additions, our own drawings ---------------------------------------------------
def _arrow(x, y, ang_deg, length=0.2, half=0.17, stem=0.1):
    """A stem from (x, y) outward at ang (deg clockwise from 12 o'clock) with a head: steps in the unit box."""
    t = math.radians(ang_deg)
    ux, uy, nx, ny = math.sin(t), -math.cos(t), math.cos(t), math.sin(t)
    ex, ey = x + ux * length, y + uy * length
    hx, hy = ex + ux * 0.16, ey + uy * 0.16
    return [{'k': 'seg', 'a': [x, y, ex, ey, stem]},
            {'k': 'poly', 'a': [[hx, hy], [ex + nx * half, ey + ny * half], [ex - nx * half, ey - ny * half]], 'r': 0.01}]


def roundabout_steps(exit_no):
    ang = [90, 45, 0, -45, -90, -135][exit_no - 1]     # counter-clockwise (right-hand traffic): a fixed angle per exit number
    t = math.radians(ang)
    cx, cy, rr = 0.5, 0.58, 0.2
    ox, oy = cx + rr * math.sin(t), cy - rr * math.cos(t)
    steps = [{'k': 'ring', 'a': [cx, cy, rr, 0.09]}, {'k': 'seg', 'a': [0.5, 0.97, 0.5, cy + rr, 0.11]}]
    steps += _arrow(ox, oy, ang, length=0.13, stem=0.11)
    return steps


PICTOS_R3B = {
    'td_projection': [{'k': 'boxo', 'a': [0.5, 0.44, 0.4, 0.28, 0.06, 0.07]}, {'k': 'poly', 'a': [[0.42, 0.3], [0.64, 0.44], [0.42, 0.58]], 'r': 0.01},
                      {'k': 'seg', 'a': [0.32, 0.9, 0.68, 0.9, 0.07]}, {'k': 'seg', 'a': [0.5, 0.72, 0.5, 0.9, 0.07]}],
    'td_fork_right': [{'k': 'seg', 'a': [0.5, 0.95, 0.5, 0.58, 0.14]}, {'k': 'seg', 'a': [0.5, 0.58, 0.5, 0.12, 0.055]},
                      {'k': 'seg', 'a': [0.5, 0.6, 0.72, 0.36, 0.14]}] + _arrow(0.72, 0.36, 40, length=0.1, stem=0.14),
    'td_fork_left': [{'k': 'seg', 'a': [0.5, 0.95, 0.5, 0.58, 0.14]}, {'k': 'seg', 'a': [0.5, 0.58, 0.5, 0.12, 0.055]},
                     {'k': 'seg', 'a': [0.5, 0.6, 0.28, 0.36, 0.14]}] + _arrow(0.28, 0.36, -40, length=0.1, stem=0.14),
    'td_flag_left': [{'k': 'seg', 'a': [0.72, 0.95, 0.72, 0.4, 0.12]}, {'k': 'poly', 'a': [[0.72, 0.04], [0.98, 0.4], [0.46, 0.4]], 'r': 0.01},
                     {'k': 'seg', 'a': [0.18, 0.1, 0.18, 0.9, 0.07]}, {'k': 'poly', 'a': [[0.2, 0.1], [0.5, 0.24], [0.2, 0.38]], 'r': 0.01}],
}


