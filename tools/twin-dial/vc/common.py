"""Package VC (colour, material, night): shared helpers.

Linear light = the sRGB EOTF of the photo's 8-bit codes. Y = Rec.709 luminance. Nothing here writes photo pixels
outside bake/work/twin-dial/.
"""
import json
import os

import cv2
import numpy as np

MAIN = '/Users/solefir/projects/f30-cluster'
REF = os.path.join(MAIN, 'reference', 'vc')
WORK = os.path.join(MAIN, 'bake', 'work', 'twin-dial', 'VC')
PUB = os.path.join(MAIN, 'bake', 'work', 'twin-dial', 'pub', 'VC')
VRPUB = os.path.join(MAIN, 'bake', 'work', 'twin-dial', 'pub', 'VR')
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DESIGN = os.path.join(REPO, 'design', 'twin-dial', 'vc')

REFS = {
    '01': '01_classic_map_tacho-left_mph.png',
    '02': '02_facelift_hybrid_powermeter_trip.png',
    '03': '03_classic_compact_date-panel_led-bars.png',
    '04': '04_facelift_bench_red-wedge_car.png',
    '05': '05_facelift_render_settings.png',
}

W709 = np.array([0.2126, 0.7152, 0.0722])


def imread(rid):
    im = cv2.imread(os.path.join(REF, REFS[rid]), cv2.IMREAD_COLOR)
    if im is None:
        raise FileNotFoundError(rid)
    return im[:, :, ::-1].copy()  # RGB uint8


def s2l(v):
    v = np.asarray(v, dtype=np.float64)
    if v.max(initial=0) > 1.0 + 1e-9:
        v = v / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def l2s(l):
    l = np.clip(np.asarray(l, dtype=np.float64), 0, 1)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055) * 255.0


def lum(lin):
    return lin @ W709


def hexs(srgb):
    s = np.clip(np.round(srgb), 0, 255).astype(int)
    return '#%02X%02X%02X' % tuple(s)


def jdump(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)

    def conv(o):
        if isinstance(o, (np.floating, float)):
            return round(float(o), 5)
        if isinstance(o, (np.integer, int)):
            return int(o)
        if isinstance(o, np.ndarray):
            return np.round(o.astype(np.float64), 5).tolist()
        raise TypeError(type(o))
    with open(path, 'w') as f:
        json.dump(obj, f, indent=1, default=conv)
        f.write('\n')


def jload(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def vr_ready():
    return os.path.exists(os.path.join(VRPUB, 'READY')) and os.environ.get('VC_ORIGINALS') != '1'


def frame(rid):
    """The image the dial samples are taken on, its validity mask and the dials as ellipses (cx, cy, a, b, phi).

    With VR's rectified frames published (pub/VR/READY): <id>_rect.png (frontal, left R = 400 px, R = the centre line
    of the bezel), invalid = magenta or VR's valid mask 0; the dials are circles at canvas.left/right_centre with
    radius 400 x radii_R.*_bezel (so rho = 1 on each dial's own bezel centre line). Without them: the original photo,
    everything valid, and this package's provisional ellipses (rho = 1 on the bezel's OUTER edge, about 1 % larger).
    """
    if vr_ready():
        idx = jload(os.path.join(VRPUB, 'index.json'))['refs'][rid]
        im = cv2.imread(os.path.join(VRPUB, idx['file']), cv2.IMREAD_COLOR)[:, :, ::-1].copy()
        valid = cv2.imread(os.path.join(VRPUB, idx['valid']), cv2.IMREAD_GRAYSCALE) > 0
        magenta = (im[..., 0] == 255) & (im[..., 1] == 0) & (im[..., 2] == 255)
        cv = idx['canvas']
        R = cv['R_px']
        rr = idx['radii_R']
        dials = {'tacho': (cv['left_centre'][0] + 0.5, cv['left_centre'][1] + 0.5, R * rr['left_bezel'],
                           R * rr['left_bezel'], 0.0),
                 'speedo': (cv['right_centre'][0] + 0.5, cv['right_centre'][1] + 0.5, R * rr['right_bezel'],
                            R * rr['right_bezel'], 0.0)}
        return s2l(im), valid & ~magenta, dials, 'VR'
    ell = jload(os.path.join(WORK, 'ellipses.json'))[rid]
    im = imread(rid)
    dials = {k: (e['cx'], e['cy'], e['a'], e['b'], e['phi']) for k, e in ell.items()}
    return s2l(im), np.ones(im.shape[:2], bool), dials, 'originals'


def dial_coords(shape, el):
    """Per pixel: (rho, theta) in dial units for an ellipse el = (cx, cy, a, b, phi_deg) whose 'a' axis is at phi.
    rho = 1 on the bezel ellipse; theta in degrees clockwise from 12 o'clock (image up)."""
    h, w = shape[:2]
    cx, cy, a, b, phi = el
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    dx, dy = xx + 0.5 - cx, yy + 0.5 - cy
    c, s = np.cos(np.radians(phi)), np.sin(np.radians(phi))
    u = (dx * c + dy * s) / a
    v = (-dx * s + dy * c) / b
    rho = np.hypot(u, v)
    # back to a frontal circle: angle measured in the de-rotated, de-squashed frame, then re-rotated
    x0 = u * c - v * s
    y0 = u * s + v * c
    theta = (np.degrees(np.arctan2(x0, -y0)) + 360.0) % 360.0
    return rho, theta
