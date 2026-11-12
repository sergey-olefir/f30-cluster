"""Render the soft layers (background, map veil, band glow, wing faces) from the fitted tables."""
import numpy as np

import lib
import model
from fit_soft import eval_bg


WING_BLUR = 8.0      # px: the wing face's smoothing (polish C)


def _load(look):
    z = np.load(lib.os.path.join(lib.PARAMS, "soft_%s.npz" % look))
    return {k: z[k] for k in z.files}


def load_soft(look):
    """The fitted tables of a look. The day look's faces (wing, bevel) are the night faces times one gain: the day
    photos (09, 14) show the faces through the sky's reflection on the glass (a teal-white patch mid-face, not in
    08), so only their overall brightness is taken from 09 (polish C: no photo tints)."""
    P = _load(look)
    if look == "day":
        N = _load("night")
        P["day_face_gain"] = g = face_gain(N, P)
        for k in [k for k in P if k.startswith("wing")]:
            P[k] = np.clip(N[k] * g, 0, 1)
    return P


def face_gain(N, D):
    """Median ratio of the faces' luminance above each photo's black level (the median of its fitted background),
    day over night, over the upper half of the wing tables (rows under the pointers' glow excluded)."""
    def above(P, k):
        L = P[k][: P[k].shape[0] // 2].mean(-1)                # s from the top of the scale: the upper part
        return L - np.median(P["bg_coefs"].mean(0))
    r = [above(D, k) / np.maximum(above(N, k), 1e-3) for k in ("wing_speedo", "wingE_speedo")]
    return float(np.clip(np.median(np.concatenate([x.ravel() for x in r])), 0.5, 2.0))


def bg_layer(P, scale=2):
    """Opaque background, half resolution (scale 2): pure black. The panel draws nothing there; the photos' dark
    blue-grey (P["bg_coefs"], still fitted: the soft tables are measured against it) is the LCD's lit-up black plus
    the cabin's light and the camera's haze, which the owner's colour rule drops (docs/AGENT-BRIEF-polish.md 1)."""
    h, w = lib.H // scale, lib.W // scale
    return np.concatenate([np.zeros((h, w, 3)), np.ones((h, w, 1))], -1).astype(np.float32)


def veil_alpha(p, X):
    Al, xl, wl, Ar, xr, wr = p
    return Al / (1 + np.exp(-(xl - X) / wl)) + Ar / (1 + np.exp(-(X - xr) / wr))


def veil_layer(P, scale=2):
    """Black veil over map.region, alpha from the road-contrast fit (a fade to black: the background is black).
    Returns (rgba, x, y) at `scale`."""
    x0, y0, x1, y1 = [int(v) for v in lib.overlay_elements()["map.region"]["bbox"]]
    h, w = (y1 - y0) // scale, (x1 - x0) // scale
    Y, X = np.mgrid[0:h, 0:w]
    X = x0 + (X + 0.5) * scale
    a = np.clip(veil_alpha(P["veil"], X), 0, 1)
    return np.concatenate([np.zeros((h, w, 3)), a[..., None]], -1).astype(np.float32), x0, y0


def end_fade(curve, s, X, Y, width=4.0):
    """1 along the curve, falling to 0 within `width` px past either end (along the end's tangent), for the pixels
    whose nearest curve point is that end (s clamped there): the tables clamp s at the ends, so without it a
    table's last column spreads round the end point (the box of glow that sat right of the speedo's band end, by
    the sign window)."""
    f = np.ones(np.shape(X), np.float32)
    L = lib.arclen(curve)[-1]
    for a, b, at in ((curve[0], curve[min(4, len(curve) - 1)], s <= 0.5),
                     (curve[-1], curve[max(-5, -len(curve))], s >= L - 0.5)):
        t = lib.unit(a - b)                                   # outward tangent at this end
        past = (X - a[0]) * t[0] + (Y - a[1]) * t[1]
        f = np.where(at, f * np.clip(1 - past / width, 0, 1), f).astype(np.float32)
    return f


def dial_layers(P, geo, dial, D=None):
    """-> dict name -> (rgba, x, y) full resolution: 'glow' (additive) and 'wing' (opaque face)."""
    D = D or model.Dial(geo, dial)
    sE_B, sE_E = model.s_edges(D.band), model.s_edges(D.E)
    x0, y0 = D.box[0], D.box[1]
    # glow: inside the frame, outside the wing
    g = lib.table_eval(P["glow_%s" % dial], sE_B, model.GLOW_D, D.sB, D.dB)
    fade = np.clip((72 - D.dB) / 6.0, 0, 1) * np.clip((D.dB + 3) / 1.0, 0, 1)
    fade = fade * end_fade(D.band, D.sB, D.Xs, D.Y)
    g = np.clip(g, 0, 1) * (D.inside * fade)[..., None]
    a = g.max(-1)
    rgb = np.where(a[..., None] > 1e-4, g / np.maximum(a[..., None], 1e-4), 0)
    glow = np.concatenate([rgb, a[..., None]], -1).astype(np.float32)
    # wing: band table blended with the E (bevel) table near E
    wb = lib.table_eval(P["wing_%s" % dial], sE_B, model.WING_D, D.sB, np.maximum(-D.dB, 0))
    # the face is a smooth surface: blur it inside the wing (normalised), which removes the creases the curve
    # coordinates draw where the nearest band point jumps (the diagonal lines from the band's corners)
    import cv2
    m = (D.wing > 0.5).astype(np.float32)
    k = cv2.GaussianBlur(m, (0, 0), WING_BLUR)
    wb = np.stack([cv2.GaussianBlur((wb[..., c] * m).astype(np.float32), (0, 0), WING_BLUR) for c in range(3)], -1) \
        / np.maximum(k, 1e-4)[..., None]
    we =lib.table_eval(P["wingE_%s" % dial], sE_E, model.WINGE_D, D.sE, D.dE)
    t0, t1 = model.E_BLEND
    wE = np.clip((t1 - D.distE) / (t1 - t0), 0, 1)[..., None]
    col = np.clip(wE * we + (1 - wE) * wb, 0, 1)
    wing = np.concatenate([col, D.wing[..., None]], -1).astype(np.float32)
    return {"glow": (glow, x0, y0), "wing": (wing, x0, y0)}, D
