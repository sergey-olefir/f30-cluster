"""Package O: check render.py against the owner's own bench screenshot 69.png (all6WB, 6WB Comfort + G20, green
matte, no check-control message ever read). The bench page drew that picture with the real WebGL; if our replay of
the engine is right, the matte's visible fraction in the screenshot equals 1 - our coverage, pixel for pixel, once the
screenshot is registered (a uniform scale and an offset: the page draws the 1920 x 720 canvas scaled into the stage).

    uv run ... python -I tools/strip/O/check69.py <69.png> <snapshot dir>
Prints the registration, the residual of visible fraction in the STRIP, and the largest disagreements.
"""
import sys
import os
import numpy as np
from PIL import Image
from scipy import optimize, ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render as RD   # noqa: E402


def main():
    shot = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(np.float64) / 255.0
    S = RD.Snapshot(sys.argv[2])
    R = RD.Renderer()
    full = R.compose(S, (0, 0, 1920, 720), 1, per_layer=False)
    A = full['alpha'].astype(np.float64)
    prem = full['prem'].astype(np.float64)
    # the matte colour: the screenshot's most common very green colour
    g = shot[..., 1] - np.maximum(shot[..., 0], shot[..., 2])
    matte = np.median(shot[g > 0.5], axis=0)
    print('matte rgb', np.round(matte * 255, 1))

    def predict(s, ox, oy, region):
        # screenshot pixel (u, v) centre -> panel (x, y) = ((u + 0.5 - ox) / s, (v + 0.5 - oy) / s)
        x0, y0, x1, y1 = region
        us = np.arange(int(ox + x0 * s), int(ox + x1 * s))
        vs = np.arange(int(oy + y0 * s), int(oy + y1 * s))
        U, V = np.meshgrid(us, vs)
        X = (U + 0.5 - ox) / s - 0.5
        Y = (V + 0.5 - oy) / s - 0.5
        a = ndimage.map_coordinates(A, [Y, X], order=1, mode='nearest')
        pc = np.stack([ndimage.map_coordinates(prem[..., c], [Y, X], order=1, mode='nearest') for c in range(3)], -1)
        pred = pc + matte * (1 - a)[..., None]
        return U, V, pred, a

    def cost(p, region=(100, 560, 1820, 715)):
        s, ox, oy = p
        U, V, pred, a = predict(s, ox, oy, region)
        ok = (V < shot.shape[0]) & (U < shot.shape[1])
        d = shot[np.clip(V, 0, shot.shape[0] - 1), np.clip(U, 0, shot.shape[1] - 1)] - pred
        return float(np.mean(d[ok] ** 2))

    best = None
    for s in np.arange(1.120, 1.140, 0.002):
        for ox in np.arange(40, 52, 1.0):
            for oy in np.arange(76, 88, 1.0):
                c = cost((s, ox, oy), (200, 600, 1700, 700))
                if best is None or c < best[0]:
                    best = (c, s, ox, oy)
    res = optimize.minimize(cost, best[1:], method='Nelder-Mead', options={'xatol': 1e-4, 'fatol': 1e-9, 'maxiter': 400})
    s, ox, oy = res.x
    print('registration: scale %.5f screenshot px per panel px, offset (%.2f, %.2f); rms colour residual %.4f' % (s, ox, oy, np.sqrt(res.fun)))
    U, V, pred, a = predict(s, ox, oy, (0, 540, 1920, 720))
    ok = (V < shot.shape[0]) & (U < shot.shape[1])
    obs = shot[np.clip(V, 0, shot.shape[0] - 1), np.clip(U, 0, shot.shape[1] - 1)]
    # visible matte fraction from the green channel, where our colour is near black
    vis_obs = (obs[..., 1] - pred[..., 1] + matte[1] * (1 - a)) / matte[1]
    vis_pred = 1 - a
    d = (vis_obs - vis_pred)
    dd = np.abs(d[ok])
    print('STRIP: visible-fraction |obs - pred|: mean %.4f, p50 %.4f, p99 %.4f, max %.3f; share > 0.1: %.4f; > 0.5: %.5f'
          % (dd.mean(), np.percentile(dd, 50), np.percentile(dd, 99), dd.max(), (dd > 0.1).mean(), (dd > 0.5).mean()))
    big = np.abs(d) > 0.5
    lab, n = ndimage.label(big & ok)
    out = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        X = (U[ys, xs] + 0.5 - ox) / s
        Y = (V[ys, xs] + 0.5 - oy) / s
        out.append((len(xs), X.min(), Y.min(), X.max(), Y.max(), float(d[ys, xs].mean())))
    out.sort(reverse=True)
    for o in out[:12]:
        print('  blob %4d shot px, panel [%.1f, %.1f, %.1f, %.1f], mean obs-pred %+.2f' % o)


if __name__ == '__main__':
    main()
