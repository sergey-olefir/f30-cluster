"""Package R: the old low-resolution photos that are the SAME frames as new ones (package H, verified by content:
10 = 60, 09 = 61, 08 = 62, 39 = 68). Their model is the new photo's model followed by the resolution change
(q_old = (q_new + 0.5) * k - 0.5 per axis, k = old size / new size): no new fit, so this is NOT independent
validation of either. Check: NCC between the old photo warped by that model and the new rect, plus a free 2-D shift
search (the shift found is the transfer error).
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import publish as P  # noqa: E402

PAIRS = {'10': '60', '09': '61', '08': '62', '39': '68'}
OLD = {'10': 'reference/g20/10_grid_over-stock.jpg'}


class Scaled:
    def __init__(self, m, kx, ky, size, shift=(0.0, 0.0)):
        self.m, self.kx, self.ky, self.size = m, kx, ky, size
        self.shift = np.float64(shift)
        self.base = getattr(m, 'base', m)
        self.k1 = self.base.k1

    def to_photo(self, pts):
        q = self.m.to_photo(np.asarray(pts, np.float64).reshape(-1, 2) + self.shift)
        return np.stack([(q[:, 0] + 0.5) * self.kx - 0.5, (q[:, 1] + 0.5) * self.ky - 0.5], 1)

    def to_panel(self, q):
        q = np.asarray(q, np.float64)
        return self.m.to_panel(np.stack([(q[:, 0] + 0.5) / self.kx - 0.5, (q[:, 1] + 0.5) / self.ky - 0.5], 1)) - self.shift

    def scale(self, x=960, y=380):
        a = self.to_photo([[x, y], [x + 1, y], [x, y + 1]])
        return float((np.linalg.norm(a[1] - a[0]) + np.linalg.norm(a[2] - a[0])) / 2)


def fit_plain(sm, size):
    """The zoom.py-form model nearest to the scaled model (homography + k1 refitted on a dense grid)."""
    xs, ys = np.meshgrid(np.arange(0, C.W + 1, 20), np.arange(0, C.H + 1, 20))
    pts = np.stack([xs.ravel(), ys.ravel()], 1).astype(np.float64)
    m = C.RF.fit_model(pts, sm.to_photo(pts), size, True)
    d = np.linalg.norm(m.to_panel(sm.to_photo(pts)) - pts, axis=1)
    return m, round(float(np.sqrt((d ** 2).mean())), 3), round(float(d.max()), 3)


def run():
    Hj = C.jload(os.path.join(C.OUT, 'H.json'))
    up = {}
    rep = {}
    for old, new in PAIRS.items():
        pn = C.imread(new)
        po = cv2.imread(C.p(OLD.get(old, C.PHOTOS.get(old, ''))), cv2.IMREAD_COLOR)
        mn = C.fmodel_from(Hj[new], C.size_of(pn))
        kx, ky = po.shape[1] / pn.shape[1], po.shape[0] / pn.shape[0]
        sm = Scaled(mn, kx, ky, C.size_of(po))
        rn = cv2.imread(os.path.join(C.OVR, '%s.png' % new), cv2.IMREAD_COLOR)
        chks = []
        for it in range(2):
            # check: old warped vs new rect, strip and panel, at 1 x; the panel shift found is applied, then rechecked
            ro = C.warp_n(po, sm, 0, 0, C.W, C.H, 1)
            go, gn = [cv2.GaussianBlur(cv2.cvtColor(x, cv2.COLOR_BGR2GRAY).astype(np.float32), (0, 0), 1.0)
                      for x in (ro, rn)]
            chk = {}
            for name, (x0, y0, x1, y1) in {'panel': (100, 40, 1820, 700), 'strip': (100, 545, 1820, 715)}.items():
                t = gn[y0 + 6:y1 - 6, x0 + 6:x1 - 6]
                res = cv2.matchTemplate(go[y0:y1, x0:x1], t, cv2.TM_CCOEFF_NORMED)
                _, mx, _, loc = cv2.minMaxLoc(res)
                sx, sy = C.RF.subpix(res, loc[0], loc[1])
                chk[name] = {'ncc': round(mx, 4), 'shift_px': [round(sx - 6, 3), round(sy - 6, 3)]}
            chks.append(chk)
            if it == 0:
                sm = Scaled(mn, kx, ky, C.size_of(po), shift=chk['panel']['shift_px'])
        chk = {'before_shift': chks[0], 'after_shift': chks[1], 'shift_applied_panel_px': sm.shift.tolist(),
               'note': 'the old JPG is not an exact rescale of the new frame (crop / resampling phase): a constant '
                       'panel shift is applied'}
        mp, prms, pmax = fit_plain(sm, C.size_of(po))
        ext = {'method': 'same frame as photo %s (package H): %s\'s model (with its field) then the resolution change '
                         'x %.5f, y %.5f; no fit of its own. The zoom.py form here is the nearest homography + k1 to '
                         'that (rms %.3f, max %.3f panel px off it)' % (new, new, kx, ky, prms, pmax),
               'same_frame_as': new, 'check_vs_new_rect': chk,
               'panel_px_per_photo_px': round(1 / sm.scale(), 3)}
        e = P.entry(mp, OLD.get(old, C.PHOTOS.get(old)), ext)
        e['photo_px_per_panel_px'] = round(sm.scale(), 4)
        up[old] = e
        rep[old] = ext
        print(old, '<-', new, chk, 'scale', round(sm.scale(), 3))
        cv2.imwrite(os.path.join(C.OUT, '%s_panel_2x.png' % old),
                    np.round(C.lin_to_srgb(np.clip(C.warp_n(C.srgb_to_lin(po), sm, 0, 0, C.W, C.H, 2,
                                                            interp=cv2.INTER_LANCZOS4), 0, 1)) * 255).astype(np.uint8))
        s4 = np.clip(C.warp_n(C.srgb_to_lin(po), sm, 0, 540, C.W, 180, 4, interp=cv2.INTER_LANCZOS4), 0, 1)
        cv2.imwrite(os.path.join(C.OUT, '%s_strip_4x.png' % old), np.round(s4 * 65535).astype(np.uint16))
        open(os.path.join(C.OUT, '%s.READY' % old), 'w').write('ok\n')
    P.save_models(up)
    return rep


if __name__ == '__main__':
    run()
