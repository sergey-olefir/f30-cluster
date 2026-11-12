"""Render the soft layers (background, map veil, band glow, wing faces) from the fitted tables."""
import numpy as np

import lib
import model
from fit_soft import eval_bg


def load_soft(look):
    z = np.load(lib.os.path.join(lib.PARAMS, "soft_%s.npz" % look))
    return {k: z[k] for k in z.files}


def bg_layer(P, scale=2):
    """Opaque background, half resolution (scale 2)."""
    h, w = lib.H // scale, lib.W // scale
    Y, X = np.mgrid[0:h, 0:w]
    X = (X + 0.5) * scale
    Y = (Y + 0.5) * scale
    rgb = np.clip(eval_bg(P["bg_coefs"], X, Y, int(P["bg_deg"])), 0, 1)
    return np.concatenate([rgb, np.ones((h, w, 1))], -1).astype(np.float32)


def veil_alpha(p, X):
    Al, xl, wl, Ar, xr, wr = p
    return Al / (1 + np.exp(-(xl - X) / wl)) + Ar / (1 + np.exp(-(X - xr) / wr))


def veil_layer(P, scale=2):
    """Black-ish (background colour) veil over map.region, alpha from the road-contrast fit. Returns
    (rgba, x, y) at `scale`."""
    x0, y0, x1, y1 = [int(v) for v in lib.overlay_elements()["map.region"]["bbox"]]
    h, w = (y1 - y0) // scale, (x1 - x0) // scale
    Y, X = np.mgrid[0:h, 0:w]
    X = x0 + (X + 0.5) * scale
    Y = y0 + (Y + 0.5) * scale
    a = np.clip(veil_alpha(P["veil"], X), 0, 1)
    rgb = np.clip(eval_bg(P["bg_coefs"], X, Y, int(P["bg_deg"])), 0, 1)
    return np.concatenate([rgb, a[..., None]], -1).astype(np.float32), x0, y0


def dial_layers(P, geo, dial, D=None):
    """-> dict name -> (rgba, x, y) full resolution: 'glow' (additive) and 'wing' (opaque face)."""
    D = D or model.Dial(geo, dial)
    sE_B, sE_E = model.s_edges(D.band), model.s_edges(D.E)
    x0, y0 = D.box[0], D.box[1]
    # glow: inside the frame, outside the wing
    g = lib.table_eval(P["glow_%s" % dial], sE_B, model.GLOW_D, D.sB, D.dB)
    fade = np.clip((72 - D.dB) / 6.0, 0, 1) * np.clip((D.dB + 3) / 1.0, 0, 1)
    g = np.clip(g, 0, 1) * (D.inside * fade)[..., None]
    a = g.max(-1)
    rgb = np.where(a[..., None] > 1e-4, g / np.maximum(a[..., None], 1e-4), 0)
    glow = np.concatenate([rgb, a[..., None]], -1).astype(np.float32)
    # wing: band table blended with the E (bevel) table near E
    wb = lib.table_eval(P["wing_%s" % dial], sE_B, model.WING_D, D.sB, np.maximum(-D.dB, 0))
    we = lib.table_eval(P["wingE_%s" % dial], sE_E, model.WINGE_D, D.sE, D.dE)
    t0, t1 = model.E_BLEND
    wE = np.clip((t1 - D.distE) / (t1 - t0), 0, 1)[..., None]
    col = np.clip(wE * we + (1 - wE) * wb, 0, 1)
    wing = np.concatenate([col, D.wing[..., None]], -1).astype(np.float32)
    return {"glow": (glow, x0, y0), "wing": (wing, x0, y0)}, D
