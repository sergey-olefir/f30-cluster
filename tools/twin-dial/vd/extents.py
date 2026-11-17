"""Angular extents and the band's texture, in dial units.

Usage: extents.py KEY
1. Bezel: where the whiteness at rho 0.995..1.005 is above 0.5 -> the ring's two open ends near the bottom.
2. Band ends: where the luma at rho 0.62..0.66 (inside the band, under the numerals) drops below 40 % of its median.
3. Feet: below the band ends the grey area continues; its lower edge is sampled along y (dial units) for x = +-0.5..0.9.
4. Texture: the band area (rho 0.60..0.70, theta 280..320) of the rectified frontal image, detrended; the 2-D FFT's
   strongest peak gives the pattern pitch (in R) and its direction; contrast = std / mean of the detrended luma.
"""
import sys, os, numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from radial import sample, luma
from dialfit import whiteness

key = sys.argv[1]
th = np.arange(0, 360, 0.25)


def ends(mask):
    # longest run of False around 180 deg -> the gap; return (gap start, gap end) in deg
    i = int(180 / 0.25)
    a = i
    while a > 0 and not mask[a - 1]: a -= 1
    b = i
    while b < len(mask) - 1 and not mask[b + 1]: b += 1
    return th[a], th[b]


w = whiteness(sample(key, th, np.arange(0.99, 1.01, 0.0025))).max(axis=0)
print('bezel present 0.5: gap %.2f .. %.2f deg' % ends(w > 0.5))
L = luma(sample(key, th, np.arange(0.60, 0.64, 0.005))).mean(axis=0)
med = np.median(L[(th < 120) | (th > 240)])
print('band luma median %.3f; band gap (luma < 40%%) %.2f .. %.2f deg' % ((med,) + ends(L > 0.4 * med)))
# feet: march down from y=0.3 in the frontal frame at fixed x, report where luma drops below 40% of band median
import json
from radial import get_model
from dialfit import DIALS, load
f, c, A = get_model(key)
im = load(DIALS[key][0])
for x in (-0.85, -0.75, -0.65, 0.65, 0.75, 0.85):
    ys = np.arange(0.3, 1.1, 0.0025)
    u = np.full_like(ys, x); v = ys
    X = c[0] + A[0, 0] * u + A[0, 1] * v; Y = c[1] + A[1, 0] * u + A[1, 1] * v
    p = cv2.remap(im, X.astype(np.float32)[None], Y.astype(np.float32)[None], cv2.INTER_LINEAR)[0]
    l = luma(p)
    on = np.where(l > 0.4 * med)[0]
    runs = np.split(on, np.where(np.diff(on) > 3)[0] + 1) if len(on) else []
    print('x %+.2f: grey runs (y) %s' % (x, ['%.3f..%.3f' % (ys[r[0]], ys[r[-1]]) for r in runs if len(r) > 4]))
# texture
N, RP = 800, 400.0
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
u = (xx - N / 2) / RP; v = (yy - N / 2) / RP
X = c[0] + A[0, 0] * u + A[0, 1] * v; Y = c[1] + A[1, 0] * u + A[1, 1] * v
r = cv2.remap(im, X.astype(np.float32), Y.astype(np.float32), cv2.INTER_CUBIC)
l = luma(r)
rho = np.hypot(u, v); t = np.degrees(np.arctan2(u, -v)) % 360
for lo, hi, a0, a1 in ((0.58, 0.68, 285, 318), (0.58, 0.68, 40, 75)):
    m = (rho > lo) & (rho < hi) & (t > a0) & (t < a1)
    ys_, xs_ = np.where(m)
    y0, y1, x0, x1 = ys_.min(), ys_.max(), xs_.min(), xs_.max()
    # biggest axis-aligned square inside the mask region
    s = 64
    cy, cx = int(ys_.mean()), int(xs_.mean())
    patch = l[cy - s // 2:cy + s // 2, cx - s // 2:cx + s // 2]
    det = patch - cv2.GaussianBlur(patch, (0, 0), 6)
    F = np.abs(np.fft.fftshift(np.fft.fft2(det * np.hanning(s)[:, None] * np.hanning(s)[None])))
    F[s // 2 - 2:s // 2 + 3, s // 2 - 2:s // 2 + 3] = 0
    k = np.unravel_index(F.argmax(), F.shape)
    fy, fx = (k[0] - s // 2) / s, (k[1] - s // 2) / s
    f_ = np.hypot(fx, fy)
    print('texture th %d..%d: patch mean %.3f, detrended std %.4f (%.1f %%), FFT peak pitch %.4f R (%.1f frontal px at R=400) dir %.0f deg, peak/median %.1f' % (
        a0, a1, patch.mean(), det.std(), 100 * det.std() / patch.mean(), (1 / f_) / RP if f_ else 0, 1 / f_ if f_ else 0,
        np.degrees(np.arctan2(fy, fx)), F.max() / np.median(F)))
