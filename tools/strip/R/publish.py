"""Package R: write a registered photo's products (all git-ignored, under $F30_MAIN/bake/work/):

    strip/rect/<id>_panel_2x.png   3840 x 1440, 8-bit sRGB, the whole panel (global model)
    strip/rect/<id>_strip_4x.png   7680 x 720, 16-bit LINEAR light (sRGB EOTF of the photo's codes), the STRIP
                                   (y 540..720); both rasters use the full model (base + residual field)
    overlay/rect/<id>.png          1920 x 720, 8-bit sRGB (box average of the 2 x in linear light), for the bench
    strip/rect/H.json              the models, in tools/g20spec/zoom.py's schema (entries <id> and <id>_strip)
    strip/rect/<id>.READY          touched last

Raster alignment: pixel (I, J) of an n x raster covers continuous panel [I/n, (I+1)/n) x [y0 + J/n, y0 + (J+1)/n);
y0 = 0 for the panel, 540 for the strip. Off-photo pixels are 0.
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

RF = C.RF


def entry(model, src, extra):
    fm = model if hasattr(model, 'base') else None
    model = fm.base if fm is not None else model
    e = {'source': src, 'H_panel_to_photo': model.plain_H().tolist(),
         'model': {'H_panel_to_undistorted_photo': model.H.tolist(), 'k1': model.k1,
                   'centre_photo_px': model.c.tolist(), 'norm_radius_photo_px': model.s,
                   'formula': 'u = c + (q - c)(1 + k1 |q - c|^2 / s^2), u = H panel; q photo px; panel in OpenCV '
                              'pixel-centre coordinates (continuous - 0.5)'},
         'photo_px_per_panel_px': round(model.scale(), 4),
         'photo_px_per_panel_px_strip': round(model.scale(960, 630), 4)}
    e.update(extra)
    if fm is not None and fm.json() is not None:
        e['field'] = fm.json()
    return e


def save_models(updates):
    path = os.path.join(C.OUT, 'H.json')
    H = C.jload(path, {})
    H.update(updates)
    H['_about'] = ABOUT
    C.jdump(H, path)


ABOUT = {
    'frame': 'panel 1920 x 720, x right, y down. The model takes OpenCV pixel-centre panel coordinates '
             '(= continuous - 0.5), like tools/overlay/rectify.py and tools/g20spec/zoom.py.',
    'entries': '<id>: the global model (whole panel): `model` (homography + radial k1, what zoom.py reads) plus '
               '`field`, a smooth residual correction the rasters include. <id>_strip: the zoom.py form only, refitted '
               'on the control points in the lower half (y >= 400, k1 held): the best plain model for the STRIP when '
               'the field cannot be used (zoom.py --hjson this file --photo <id>_strip).',
    'zoom_py_offset': 'tools/g20spec/zoom.py samples crop pixel k at OpenCV panel x0 + k/n, i.e. continuous '
                      'x0 + k/n + 0.5: its crop pixel k is NOT centred at continuous x0 + (k + .5)/n; the '
                      'difference is (n - 1)/(2n) panel px (0.44 px at n = 8). The rasters of package R are centred.',
    'residuals': 'rms / max in panel px over the inlier control points (true panel point vs photo point mapped back '
                 'by the model); *_strip = the same over control points with y >= 520; loo = leave-one-out.',
    'chain': '60 is absolute (our grid). Every other photo is tied to 60\'s rect through BMW content that never '
             'moves (dial scales, rails, minis), so all share 60\'s frame.',
}


def lin_photo(photo):
    return C.srgb_to_lin(photo)


def write_products(pid, model, model_strip, photo=None, bench=True):
    photo = C.imread(pid) if photo is None else photo
    lin = lin_photo(photo)
    os.makedirs(C.OUT, exist_ok=True)
    # panel 2x
    p2 = C.warp_n(lin, model, 0, 0, C.W, C.H, 2, interp=cv2.INTER_LANCZOS4)
    p2 = np.clip(p2, 0, 1)
    cv2.imwrite(os.path.join(C.OUT, '%s_panel_2x.png' % pid), np.round(C.lin_to_srgb(p2) * 255).astype(np.uint8))
    # strip 4x, linear 16-bit
    s4 = C.warp_n(lin, model, 0, 540, C.W, 180, 4, interp=cv2.INTER_LANCZOS4)
    s4 = np.clip(s4, 0, 1)
    cv2.imwrite(os.path.join(C.OUT, '%s_strip_4x.png' % pid), np.round(s4 * 65535).astype(np.uint16))
    # 1x for the bench
    if bench:
        p1 = cv2.resize(p2, (C.W, C.H), interpolation=cv2.INTER_AREA)
        os.makedirs(C.OVR, exist_ok=True)
        cv2.imwrite(os.path.join(C.OVR, '%s.png' % pid), np.round(C.lin_to_srgb(p1) * 255).astype(np.uint8))
    open(os.path.join(C.OUT, '%s.READY' % pid), 'w').write('ok\n')
