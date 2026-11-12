"""P10 step 2: the G20 display + phone camera transfer, photo = f(panel), from photo 12 (our theme on the car, night).

Matched pixels: the bench render of the same build (cb28ce7, Comfort, the photo's signals) vs photo 12 rectified to the
panel (align12.json). Both low-passed (sigma 3 panel px) so a 1-2 px misregistration does not matter; only smooth
pixels (local std small in both), and these are excluded:
  - live text, the needles and hubs, BMW's overlays (black area, belt lamp, P lamp, gear letter), the hood;
  - the big dials outside 0.76 R and the mini gauges: on the car these were NOT drawn as on the bench (no ticks,
    groove, bezel or minis in photo 12; see BAKE-P10-levels.md 1), so their panel value is unknown.
BMW's black area is the anchor for panel 0.

Model per channel, in linear light (sRGB transfer on both sides; the photo's Display P3 tag is ignored, as for every
reference, so the comparison stays code-value to code-value):
    photo_lin = floor + gain * panel_lin ** gamma            (clipped at 1)
Also a monotone LUT (isotonic over 32 panel bins) as a check.
    ./P10/py.sh -m P10.g20model RENDER.png
"""
import json, os, sys
import cv2
import numpy as np
from scipy.optimize import least_squares

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'bake', 'work', 'P10')
G = {'C1': (412, 380), 'C2': (1508, 380), 'C3': (80, 628), 'C4': (1840, 628)}
R = 335.0


def s2l(c):
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(c):
    c = np.clip(np.asarray(c, np.float64), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def hood_y(x):
    H = [[0, 200], [100, 145], [200, 94], [300, 52], [400, 33], [500, 24], [600, 19], [700, 13], [800, 12], [900, 13],
         [1000, 14], [1100, 13], [1200, 15], [1300, 20], [1400, 28], [1500, 33], [1600, 48], [1700, 88], [1800, 139],
         [1900, 205], [1920, 225]]
    xs, ys = zip(*H)
    return np.interp(x, xs, ys)


def masks(render, photo):
    """Usable-pixel mask (panel frame) and a per-region label image."""
    h, w = 720, 1920
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ok = np.ones((h, w), bool)
    ok &= yy > hood_y(xx) + 25                     # under the hood edge (and its blur)
    ok &= (xx > 20) & (xx < 1900) & (yy < 705)
    for (x0, y0, x1, y1) in ([1405, 305, 1626, 455], [570, 650, 645, 720], [1375, 650, 1445, 720],   # black area, belt, gear P
                             [1820, 200, 1920, 290]):                                             # BMW's (P) lamp
        ok[y0:y1, x0:x1] = False
    lab = np.zeros((h, w), np.uint8)               # 1 bg, 2 dial face, 3 window, 4 bar
    lab[:] = 1
    for c in ('C1', 'C2'):
        d = np.hypot(xx - G[c][0], yy - G[c][1])
        lab[d < 1.12 * R] = 0                       # dial ring 0.76-1.12 R: not drawn as on the bench
        lab[(d < 0.76 * R) & (d > 0.20 * R)] = 2
    for c in ('C3', 'C4'):
        ok &= np.hypot(xx - G[c][0], yy - G[c][1]) > 1.25 * 70
    win = (xx > 700) & (xx < 1220) & (yy > 79) & (yy < 600) & (lab == 1)
    lab[win] = 3
    lab[(xx > 650) & (xx < 1270) & (yy >= 600) & (yy < 650) & (lab == 1)] = 4
    ok &= lab > 0
    # live text and needles: bright or saturated-red in either image, dilated
    gr = cv2.cvtColor(render, cv2.COLOR_BGR2GRAY); gp = cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY)
    red = lambda im: (im[..., 2].astype(int) - im[..., 1].astype(int) > 60)
    t = (gr > 110) | (gp > 170) | red(render) | red(photo)
    t = cv2.dilate(t.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
    ok &= ~t
    return ok, lab


def glare_maps(img_lin, sig=(40.0, 160.0)):
    """Low-frequency light maps of an image (linear, panel frame): normalised Gaussian blurs (veiling glare / flare)."""
    return [cv2.GaussianBlur(img_lin.astype(np.float32), (0, 0), s, borderType=cv2.BORDER_CONSTANT) for s in sig]


def fit_channel_glare(p, q, b1, b2, wts):
    """photo = F + g p^gamma + k1 b1 + k2 b2 (b: blurred photo light at the pixel)."""
    def res(v):
        f, g, ga, k1, k2 = v
        return (np.clip(f + g * np.power(np.maximum(p, 1e-6), ga) + k1 * b1 + k2 * b2, 0, 1) - q) * wts
    s = least_squares(res, [0.005, 3.0, 0.9, 0.1, 0.1], bounds=([0, 0.01, 0.3, 0, 0], [0.5, 200, 2.5, 5, 5]))
    return s.x


def fit_channel(p, q, wts):
    """p: panel linear, q: photo linear -> (floor, gain, gamma), rms in photo code values."""
    def res(v):
        f, g, ga = v
        return (np.clip(f + g * np.power(np.maximum(p, 1e-6), ga), 0, 1) - q) * wts
    s = least_squares(res, [0.01, 3.0, 0.9], bounds=([0, 0.01, 0.3], [0.5, 200, 2.5]))
    return s.x


def main(render_path):
    A = json.load(open(os.path.join(OUT, 'align12.json')))
    render = cv2.imread(render_path)
    photo = cv2.imread(os.path.join(OUT, 'photo12_rect_panel.png'))
    ok, lab = masks(render, photo)
    rb = cv2.GaussianBlur(render.astype(np.float32), (0, 0), 3)[..., ::-1] / 255.0
    pb = cv2.GaussianBlur(photo.astype(np.float32), (0, 0), 3)[..., ::-1] / 255.0
    # smooth only: local std (7 px) small in both
    def lstd(im):
        m = cv2.blur(im, (7, 7)); m2 = cv2.blur(im * im, (7, 7))
        return np.sqrt(np.maximum(m2 - m * m, 0)).max(-1)
    ok &= (lstd(rb) < 0.02) & (lstd(pb) < 0.035)
    # subsample on a 4 px grid to decorrelate
    sub = np.zeros_like(ok); sub[::4, ::4] = True
    ok &= sub
    P = s2l(rb[ok]); Q = s2l(pb[ok]); L = lab[ok]
    pl_full = s2l(photo[..., ::-1].astype(np.float32) / 255.0)
    GL = glare_maps(pl_full)
    B1 = GL[0][ok]; B2 = GL[1][ok]
    # the black anchor: BMW's black area (panel 0), its middle
    blk = s2l(cv2.GaussianBlur(photo.astype(np.float32), (0, 0), 3)[340:420, 1440:1590][..., ::-1] / 255.0).reshape(-1, 3)
    P = np.concatenate([P, np.zeros_like(blk)]); Q = np.concatenate([Q, blk]); L = np.concatenate([L, np.full(len(blk), 9)])
    B1 = np.concatenate([B1, GL[0][340:420, 1440:1590].reshape(-1, 3)]); B2 = np.concatenate([B2, GL[1][340:420, 1440:1590].reshape(-1, 3)])
    # weights: equalise regions (each region type sums to the same weight)
    wts = np.zeros(len(L))
    for k in np.unique(L):
        wts[L == k] = 1.0 / np.sqrt((L == k).sum())
    # the dial faces are NOT fitted: on the car the dials were drawn unlike the bench (no ticks / groove / bezel), so
    # their panel value is not known; they are reported as a check (bias) only
    if os.environ.get('P10_FIT_FACES') != '1':
        wts[L == 2] = 0.0
    out = {'n_pixels': int(len(L)), 'per_region_n': {int(k): int((L == k).sum()) for k in np.unique(L)},
           'regions': {'1': 'panel background', '2': 'dial faces 0.2-0.76 R', '3': 'window', '4': 'bar', '9': "BMW's black area (panel 0)"},
           'model': 'photo_lin = floor + gain * panel_lin ** gamma, per channel, sRGB transfer both sides',
           'align': A, 'channels': {}}
    pred = np.zeros_like(Q)
    for i, ch in enumerate('RGB'):
        f, g, ga = fit_channel(P[:, i], Q[:, i], wts)
        pr = np.clip(f + g * np.power(np.maximum(P[:, i], 1e-6), ga), 0, 1)
        pred[:, i] = pr
        e8 = (l2s(pr) - l2s(Q[:, i])) * 255
        # monotone LUT check: 24 bins of panel code value
        pc = l2s(P[:, i]) * 255
        bins = np.linspace(0, max(pc.max(), 1), 25)
        lut = []
        for a, b in zip(bins[:-1], bins[1:]):
            m = (pc >= a) & (pc < b)
            if m.sum() >= 20:
                lut.append([float((a + b) / 2), float(np.median(l2s(Q[m, i]) * 255)), int(m.sum())])
        out['channels'][ch] = {'floor_lin': float(f), 'floor_code': float(l2s(f) * 255), 'gain': float(g), 'gamma': float(ga),
                               'rms_code': float(np.sqrt(np.mean(e8 ** 2))), 'p95_abs_code': float(np.percentile(np.abs(e8), 95)),
                               'per_region_bias_code': {int(k): float(np.mean(e8[L == k])) for k in np.unique(L)},
                               'lut_panel_code_to_photo_code': lut,
                               'panel_code_range': [float(pc.min()), float(pc.max())]}
    # with veiling glare: photo = F + g p^gamma + k1 blur40(photo) + k2 blur160(photo)
    out['glare_model'] = {'model': 'photo_lin = F + gain * panel_lin**gamma + k1 * blur_s40(photo_lin) + k2 * blur_s160(photo_lin)', 'channels': {}}
    for i, ch in enumerate('RGB'):
        f, g, ga, k1, k2 = fit_channel_glare(P[:, i], Q[:, i], B1[:, i], B2[:, i], wts)
        pr = np.clip(f + g * np.power(np.maximum(P[:, i], 1e-6), ga) + k1 * B1[:, i] + k2 * B2[:, i], 0, 1)
        e8 = (l2s(pr) - l2s(Q[:, i])) * 255
        gl = k1 * B1[:, i] + k2 * B2[:, i]
        out['glare_model']['channels'][ch] = {'floor_lin': float(f), 'floor_code': float(l2s(f) * 255), 'gain': float(g), 'gamma': float(ga),
            'k1_s40': float(k1), 'k2_s160': float(k2), 'rms_code': float(np.sqrt(np.mean(e8 ** 2))), 'p95_abs_code': float(np.percentile(np.abs(e8), 95)),
            'per_region_bias_code': {int(k): float(np.mean(e8[L == k])) for k in np.unique(L)},
            'glare_lin_at_black_area': float(np.median(gl[L == 9])), 'glare_lin_median_bg': float(np.median(gl[L == 1])),
            'panel_lin_at_photo_clip': float(((1 - f) / g) ** (1 / ga))}
        c = out['glare_model']['channels'][ch]
        print('glare', ch, 'F lin %.4f (code %.1f) gain %.2f gamma %.3f k1 %.3f k2 %.3f rms %.2f p95 %.1f glare@black %.4f' % (
            f, l2s(f) * 255, g, ga, k1, k2, c['rms_code'], c['p95_abs_code'], c['glare_lin_at_black_area']),
            {k: round(v, 1) for k, v in c['per_region_bias_code'].items()})
    # where the model reaches photo white (clip): panel linear for photo_lin = 1
    for ch, c in out['channels'].items():
        c['panel_lin_at_photo_clip'] = float(((1 - c['floor_lin']) / c['gain']) ** (1 / c['gamma']))
        c['panel_code_at_photo_clip'] = float(l2s(c['panel_lin_at_photo_clip']) * 255)
    json.dump(out, open(os.path.join(OUT, 'g20model.json'), 'w'), indent=1)
    for ch, c in out['channels'].items():
        print(ch, 'floor lin %.4f (code %.1f)  gain %.2f  gamma %.3f  rms %.2f  p95 %.1f  clip at panel %.0f' % (
            c['floor_lin'], c['floor_code'], c['gain'], c['gamma'], c['rms_code'], c['p95_abs_code'], c['panel_code_at_photo_clip']),
            {k: round(v, 1) for k, v in c['per_region_bias_code'].items()})
    print(out['per_region_n'])
    # diagnostic plot: the used mask over the photo
    vis = photo.copy(); vis[ok] = (0, 255, 0)
    cv2.imwrite(os.path.join(OUT, 'g20model_mask.png'), vis)
    # scatter plot panel code vs photo code per channel
    sc = np.full((512, 512, 3), 255, np.uint8)
    for i, col in enumerate([(0, 0, 255), (0, 160, 0), (255, 0, 0)]):
        x = (l2s(P[:, i]) * 511).astype(int); y = 511 - (l2s(Q[:, i]) * 511).astype(int)
        sc[np.clip(y, 0, 511), np.clip(x, 0, 511)] = col
        c = out['channels']['RGB'[i]]
        xs = np.linspace(0, 1, 512)
        ys = l2s(np.clip(c['floor_lin'] + c['gain'] * s2l(xs) ** c['gamma'], 0, 1))
        for a, b in zip((xs * 511).astype(int), 511 - (ys * 511).astype(int)):
            cv2.circle(sc, (int(a), int(b)), 1, tuple(int(v * 0.5) for v in col), -1)
    cv2.putText(sc, 'x: panel code  y: photo code (photo 12)', (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
    cv2.imwrite(os.path.join(OUT, 'g20model_scatter.png'), sc)


if __name__ == '__main__':
    main(sys.argv[1])
