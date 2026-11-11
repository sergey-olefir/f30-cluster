"""P4 / C5 + C6: the procedural model of the 6WB centre window, in OUR panel frame (G20 COMFORT, R 335).

Everything is drawn from a small parameter set (params.json, fitted to the 17 crop stretched into our frame by
C5.refs) in luma, then coloured through a fitted luma -> RGB palette (a quadratic per channel). No reference
pixels are copied: the photo only drives the least-squares fit of these numbers.

Coordinates: panel px; X = x - 960 (signed, the window is mirror-symmetric), y down.

Parts (each returns straight-alpha RGBA float32 for a panel box at a scale):
  window base   : the panel with the chamfered top, its lit rim, the dark blue-grey gradient behind it, the
                  sky glow above the horizon, the floor (light bars + side walls), clipped outside both dials
  horizon       : the crisp bright lip of the sky + the dark horizon line (1x strip)
  bar body      : the bottom info bar (dark navy) under the floor's front edge (C6)
  bar line      : the floor's front edge = the bar's lit top line (1x strip, C6)
"""
import math
import numpy as np

R = 335.0
DL = (412.0, 380.0)
DR = (1508.0, 380.0)
MIDX = 960.0


# ------------------------------------------------------------------------------------------------- helpers
def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def grid(box, scale, ss=1):
    """Pixel-centre grids (panel px) for box [x, y, w, h] at `scale` file px per panel px, supersampled ss x ss."""
    bx, by, bw, bh = box
    W, H = int(round(bw * scale)) * ss, int(round(bh * scale)) * ss
    xs = bx + (np.arange(W) + 0.5) / (scale * ss)
    ys = by + (np.arange(H) + 0.5) / (scale * ss)
    return np.meshgrid(xs, ys)


def down(img, ss):
    if ss == 1:
        return img
    h, w = img.shape[0] // ss, img.shape[1] // ss
    return img.reshape(h, ss, w, ss, *img.shape[2:]).mean(axis=(1, 3))


def palette(L, pal):
    """luma 0..255 -> RGB 0..1 with per-channel quadratics fitted on the 17 floor / sky (pal: 3 x [c0, c1, c2])."""
    Ln = np.clip(L, 0, 255) / 255.0
    out = np.stack([np.polyval(pal[c][::-1], Ln) for c in range(3)], -1)
    return np.clip(out, 0.0, 1.0)


def dial_clip(x, y, r_clip, soft):
    """1 outside both dials' clip radius (R units), 0 inside, soft over `soft` px."""
    d = np.minimum(np.hypot(x - DL[0], y - DL[1]), np.hypot(x - DR[0], y - DR[1])) - r_clip * R
    return np.clip(0.5 + d / soft, 0.0, 1.0)


def window_sdf(x, y, P):
    """Signed distance (px, + inside) to the window outline: top edge + 45 deg chamfers (rounded joins).
    There are no side edges: below the chamfers the window runs under the dials."""
    X = np.abs(x - MIDX)
    yt, hw, rc = P["top_y"], P["top_half_w"], P["corner_r"]
    d_top = y - yt
    d_ch = (hw - X + (y - yt)) / math.sqrt(2.0)
    # rounded intersection of the two half planes (radius rc)
    a, b = d_top - rc, d_ch - rc
    inside = np.minimum(a, b)
    both = (a < 0) & (b < 0)
    inside = np.where(both, -np.hypot(a, b), inside) + rc
    inside = np.where((a >= 0) | (b >= 0), np.minimum(a, b) + rc, inside)
    return inside


# ------------------------------------------------------------------------------------------------- luma parts
def bg_rgb(y, P):
    """Key-framed vertical gradient of the window background (RGB 0..255), piecewise linear."""
    ky, kc = np.array(P["bg_keys_y"]), np.array(P["bg_keys_rgb"])
    return np.stack([np.interp(y, ky, kc[:, c]) for c in range(3)], -1)


def bg_luma(y, P):
    return bg_rgb(y, P) @ np.array([0.2126, 0.7152, 0.0722])


def sky_luma(y, P):
    y0, yh, p, a = P["sky_y0"], P["horizon_y"], P["sky_pow"], P["sky_amp"]
    t = np.clip((y - y0) / (yh - y0), 0.0, 1.0)
    return a * t ** p * (y < yh)


def floor_luma(x, y, P):
    """Light bars and side walls between the horizon and the front edge (luma, additive on the floor base)."""
    X = np.abs(x - MIDX)
    yh, yf = P["horizon_y"] + P["horizon_w"], P["front_y"]
    t = np.clip((y - yh) / (yf - yh), 0.0, 1.0)
    on = (y >= yh) & (y <= yf + 1.0)
    # base level between the bars (centre), falls off sideways toward the walls
    base = P["fb0"] + P["fb1"] * t + P["fb2"] * t * t - P["fb3"] * smoothstep(0.80, 1.0, t)
    hb = P["fbh0"] + P["fbh1"] * t
    base = base * (1.0 - P["fbq"] * smoothstep(hb * 0.55, hb, X))
    L = base
    # bars: perspective rows y_k = y_v + 1 / (u0 - k du), k = 0..n-1
    yv, u0, du = P["bar_yv"], P["bar_u0"], P["bar_du"]
    for k in range(int(P["bar_n"])):
        yk = yv + 1.0 / (u0 - k * du)
        tk = (yk - yh) / (yf - yh)
        amp = P["bar_a0"] + P["bar_a1"] * tk + P["bar_a2"] * tk * tk
        s = P["bar_s0"] + P["bar_s1"] * tk
        h = P["bar_h0"] + P["bar_h1"] * tk
        L = L + amp * np.exp(-0.5 * ((y - yk) / s) ** 2) * np.exp(-(X / h) ** P["bar_hp"])
    # side walls: a soft ridge whose distance from the centre grows toward the front (concave flare)
    ty = y - P["wall_y0"]
    xw = P["wall_x0"] + P["wall_x1"] * ty + P["wall_x2"] * ty * ty
    aw = P["wall_a"] * smoothstep(P["wall_y0"] - P["wall_in"], P["wall_y0"] + P["wall_in"], y) \
        * (1.0 + P["wall_ag"] * np.clip(ty, 0, None) / 100.0)
    sw = P["wall_s0"] + P["wall_s1"] * np.clip(ty, 0, None) / 100.0
    L = L + aw * np.exp(-0.5 * ((X - xw) / sw) ** 2) * (y <= P["wall_y1"]) \
        + aw * np.exp(-0.5 * ((X - xw) / sw) ** 2) * (y > P["wall_y1"]) * np.exp(-(y - P["wall_y1"]) / P["wall_tail"])
    return L * on, on


# ------------------------------------------------------------------------------------------------- layers
def window_base(box, scale, P, ss=2):
    """C5 base (albedo, opaque inside the window, transparent outside): bg gradient + rim + sky + floor."""
    x, y = grid(box, scale, ss)
    sdf = window_sdf(x, y, P)
    cover = np.clip(0.5 + sdf, 0.0, 1.0) * dial_clip(x, y, P["dial_clip_R"], P["dial_clip_soft"])
    cover = cover * np.clip(P["front_y"] + 1.5 - y, 0.0, 1.0)
    rim = 1.0 + P["rim_a"] * np.exp(-0.5 * ((sdf - P["rim_d"]) / P["rim_s"]) ** 2)
    rgb_bg = bg_rgb(y, P) / 255.0 * rim[..., None]
    Ls = bg_luma(y, P) + sky_luma(y, P)
    sky_w = smoothstep(P["sky_y0"], P["sky_y0"] + 20.0, y)[..., None]
    rgb_sky = rgb_bg * (1 - sky_w) + palette(Ls, P["palette"]) * sky_w
    Lf, onf = floor_luma(x, y, P)
    rgb = np.where(onf[..., None], palette(Lf, P["palette"]), rgb_sky)
    out = np.concatenate([np.clip(rgb, 0, 1), cover[..., None]], -1).astype(np.float32)
    return premul_down(out, ss)


def horizon_strip(box, scale, P, ss=4):
    """C5 crisp horizon (1x): the dark line under the sky's bright lip (yh .. yh + w) plus the lip itself (a thin
    brighter row right above it). Drawn over the base."""
    x, y = grid(box, scale, ss)
    yh, w = P["horizon_y"], P["horizon_w"]
    clip = dial_clip(x, y, P["dial_clip_R"], P["dial_clip_soft"])
    dark = np.clip(np.minimum(y - yh, yh + w - y) + 0.5, 0, 1)
    lip = np.exp(-0.5 * ((y - (yh - P["lip_d"])) / P["lip_s"]) ** 2) * (y < yh)
    rgb_d = palette(np.full_like(y, P["horizon_L"]), P["palette"])
    rgb_l = palette(bg_luma(y, P) + P["sky_amp"] + P["lip_a"], P["palette"])
    alpha = np.maximum(dark, lip) * clip
    rgb = np.where((dark >= lip)[..., None], rgb_d, rgb_l)
    out = np.concatenate([rgb, alpha[..., None]], -1).astype(np.float32)
    return premul_down(out, ss)


def bar_body(box, scale, P, ss=2):
    """C6 bottom info bar body: dark navy below the front edge, fading to black at the bottom, clipped by the dials."""
    x, y = grid(box, scale, ss)
    yf = P["front_y"]
    top = np.clip(y - (yf + 1.0) + 0.5, 0, 1)
    bot = 1.0 - smoothstep(P["bar_fade0"], P["bar_fade1"], y)
    a = top * bot * dial_clip(x, y, P["dial_clip_R"], P["dial_clip_soft"])
    rgb = np.broadcast_to(np.array(P["bar_rgb"]) / 255.0, x.shape + (3,))
    out = np.concatenate([rgb, a[..., None]], -1).astype(np.float32)
    return premul_down(out, ss)


def bar_line(box, scale, P, ss=4):
    """C6 front edge of the floor = the bar's lit top line (1x): a thin bright line with a soft glow above it,
    fading out toward its ends (where the side walls take over)."""
    x, y = grid(box, scale, ss)
    X = np.abs(x - MIDX)
    yf = P["front_y"]
    core = np.clip(0.5 + (P["line_w"] / 2.0 - np.abs(y - yf)), 0, 1)
    glow = P["line_glow"] * np.exp(-0.5 * ((y - yf + P["line_glow_d"]) / P["line_glow_s"]) ** 2)
    ends = P["line_floor"] + (1.0 - P["line_floor"]) * (1.0 - smoothstep(P["line_x0"], P["line_x1"], X))
    a = np.clip(core + glow, 0, 1) * ends * dial_clip(x, y, P["dial_clip_R"], P["dial_clip_soft"])
    rgb = np.broadcast_to(np.array(P["line_rgb"]) / 255.0, x.shape + (3,))
    out = np.concatenate([rgb, a[..., None]], -1).astype(np.float32)
    return premul_down(out, ss)


def premul_down(img, ss):
    if ss == 1:
        return img
    a = img.copy()
    a[..., :3] *= a[..., 3:4]
    d = down(a, ss)
    al = d[..., 3:4]
    d[..., :3] = np.where(al > 1e-6, d[..., :3] / np.maximum(al, 1e-6), 0.0)
    return d
