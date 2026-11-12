"""Shared helpers for package D's fits (stock G20 pointers, minis, map): photo loading, tick detection, bar ridge fits.

Everything here measures the rectified photos (bake/work/overlay/rect/*.png, panel px, git-ignored evidence) and returns
numbers; nothing here writes photo pixels anywhere but the scratch dir.
"""
import json
import math
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))          # the worktree root
MAIN = '/Users/solefir/projects/f30-cluster'
RECT = os.path.join(MAIN, 'bake', 'work', 'overlay', 'rect')
SCRATCH = os.path.join(WT, 'bake', 'work', 'g20sim', 'D')
G20 = os.path.join(WT, 'design', 'overlay', 'g20_comfort.json')


def rect(ph):
    """RGB float32 0..255 of rect photo `ph` ('08' ...)."""
    return cv2.imread(os.path.join(RECT, ph + '.png'))[..., ::-1].astype(np.float32)


def elements():
    return {e['id']: e for e in json.load(open(G20))['elements']}


# ------------------------------------------------------------------------------------------------------------ ticks
def tick_components(rgb):
    """White short dashes: top-hat of the mean, low chroma. -> list of dict(c, len, dir (unit, principal axis), area)."""
    L = rgb.mean(2)
    ch = rgb.max(2) - rgb.min(2)
    th = cv2.morphologyEx(L, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    m = ((th > 45) & (ch < 90) & (L > 110)).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a < 6 or a > 150 or max(w, h) > 30:
            continue
        ys, xs = np.nonzero(lab[y:y + h, x:x + w] == i)
        # weight by the top-hat value: a sub-pixel centroid and axis
        wts = th[ys + y, xs + x]
        pts = np.stack([xs + x, ys + y], 1).astype(np.float64)
        c = (pts * wts[:, None]).sum(0) / wts.sum()
        d = pts - c
        cov = (d * wts[:, None]).T @ d / wts.sum()
        ev, evec = np.linalg.eigh(cov)
        if math.sqrt(ev[1] / max(ev[0], 1e-3)) < 1.8:
            continue
        t = d @ evec[:, 1]
        out.append(dict(c=c, len=float(t.max() - t.min() + 1), dir=evec[:, 1].copy(), area=int(a)))
    return out


# ---------------------------------------------------------------------------------------------------- bar ridge fit
def bar_fit(rgb, p_out, p_in, half=9, step=1.0, chan=None):
    """Fit the pointer bar near the guess segment p_out -> p_in.

    For each sample along the guess, take the perpendicular profile of the bar's 'core' signal (G channel minus the
    local profile median: the bar core is orange-white, G ~ 125-150, over a face with G 30-80), find the peak nearest
    the guess line and its half-max centre. Fit a line robustly; the ends are where the core contrast falls below half
    of its median along the bar. Returns dict(line point, dir (unit, outer->inner), outer, inner, length, fwhm, ...)."""
    sig = rgb[..., 1] if chan is None else chan
    p_out, p_in = np.asarray(p_out, float), np.asarray(p_in, float)
    d = (p_in - p_out) / np.linalg.norm(p_in - p_out)
    n = np.array([-d[1], d[0]])
    L = np.linalg.norm(p_in - p_out)
    ts = np.arange(-25, L + 25, step)
    offs = np.arange(-half, half + 0.01, 0.25)
    cen, amp, wid = [], [], []
    for t in ts:
        P = p_out + d * t
        xy = P[None, :] + offs[:, None] * n[None, :]
        prof = cv2.remap(sig, xy[:, 0].astype(np.float32).reshape(1, -1), xy[:, 1].astype(np.float32).reshape(1, -1),
                         cv2.INTER_LINEAR).ravel()
        base = np.percentile(prof, 20)
        p = prof - base
        k = int(np.argmax(p))
        a = p[k]
        hm = a / 2
        lo = k
        while lo > 0 and p[lo] > hm:
            lo -= 1
        hi = k
        while hi < len(p) - 1 and p[hi] > hm:
            hi += 1
        cen.append(offs[k] if a <= 0 else (offs[lo] + offs[hi]) / 2)
        amp.append(a)
        wid.append((hi - lo) * 0.25)
    cen, amp, wid = map(np.array, (cen, amp, wid))
    ref = np.median(amp[(ts > 10) & (ts < L - 10)])
    on = amp > 0.5 * ref
    # the longest run of 'on' samples
    best, cur, bs = (0, 0), 0, 0
    for i, o in enumerate(on):
        if o:
            if cur == 0:
                bs = i
            cur += 1
            if cur > best[1] - best[0]:
                best = (bs, i + 1)
        else:
            cur = 0
    i0, i1 = best
    sel = np.arange(i0, i1)
    core = sel[(sel > i0 + 4) & (sel < i1 - 4)]
    # robust line: offset c(t) = a + b t
    A = np.stack([np.ones(len(core)), ts[core]], 1)
    y = cen[core]
    w = np.ones(len(core))
    for _ in range(5):
        coef = np.linalg.lstsq(A * w[:, None], y * w, rcond=None)[0]
        r = y - A @ coef
        s = 1.4826 * np.median(np.abs(r)) + 1e-3
        w = 1 / np.maximum(1, np.abs(r) / (2 * s))
    a0, b0 = coef
    # refit frame
    P0 = p_out + n * a0
    dd = d + n * b0
    dd /= np.linalg.norm(dd)

    def at(t):
        return P0 + dd * t * (1 / math.sqrt(1 + b0 * b0)) * math.sqrt(1 + b0 * b0)

    # ends: interpolate the half-reference crossing
    def cross(i, j):
        a1, a2 = amp[i], amp[j]
        f = (0.5 * ref - a1) / (a2 - a1) if a2 != a1 else 0
        return ts[i] + (ts[j] - ts[i]) * f
    t_out = cross(i0 - 1, i0) if i0 > 0 else ts[i0]
    t_in = cross(i1, i1 - 1) if i1 < len(ts) else ts[i1 - 1]
    outer = P0 + dd * t_out
    inner = P0 + dd * t_in
    return dict(dir=dd.tolist(), outer=outer.tolist(), inner=inner.tolist(), length=float(np.linalg.norm(inner - outer)),
                fwhm=float(np.median(wid[core])), resid_px=float(np.sqrt(np.mean(r ** 2))), amp=float(ref),
                angle_from_vertical=float(math.degrees(math.atan2(dd[0], -dd[1]))))


def line_intersect(p, d, q, e):
    A = np.array([d, -np.asarray(e)]).T
    t = np.linalg.solve(A, np.asarray(q) - np.asarray(p))
    return np.asarray(p) + np.asarray(d) * t[0]


def lsq_point(lines):
    """Point minimising the squared perpendicular distances to lines [(p, d)]; returns point and rms distance."""
    A = np.zeros((2, 2))
    b = np.zeros(2)
    for p, d in lines:
        d = np.asarray(d) / np.linalg.norm(d)
        M = np.eye(2) - np.outer(d, d)
        A += M
        b += M @ np.asarray(p)
    X = np.linalg.solve(A, b)
    res = [float(np.linalg.norm((np.eye(2) - np.outer(np.asarray(d) / np.linalg.norm(d), np.asarray(d) / np.linalg.norm(d))) @ (X - np.asarray(p)))) for p, d in lines]
    return X, res
