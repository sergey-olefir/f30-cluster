"""C5 + C6: the procedural model of the 6WB centre window, in OUR panel frame (G20 COMFORT, R 335), in FINAL
panel values (the new colour rule: black is 0; nothing here goes through P10's curve afterwards).

The model is a sum of light components in LINEAR light, each a luminance field (relative to panel white = 1)
times its own hue (a linear-RGB vector with luma 1). The sum is re-encoded as sRGB code. Where nothing is lit the
value is exactly 0 (tails below half a code value are cut). The numbers come from params.json, fitted by C5.fit to
the 04 and 03 middles converted to panel values above their own local LCD floor (C5.target). No reference pixels
are copied.

Coordinates: panel px; X = |x - 960| (the window is mirror-symmetric), y down.

Components:
  glow    the sky glow above the horizon: flat across, rising from black at glow_y0 to its peak at the horizon
          (power law), with a crisp bottom edge and a faint lip right above it
  rows    the floor's light rows ("stairs"): n rows at perspective positions y_k = yv + 1 / (u0 - k du); each has a
          bright top edge (its own peak row_amp<k>) and a body that decays toward the next row, ending in a dark gap; lit
          from the centre
          (half-width growing toward the front)
  walls   the two side walls: soft diagonal streaks whose distance from the centre grows toward the front
  line    the floor's front edge (C6): a thin bright line, fading toward its ends
  body    the bar below the front edge (C6): black

Layers (straight-alpha RGBA float32 for a panel box at a scale):
  window_base   glow + rows + walls, opaque inside the window outline (black elsewhere in it), clipped outside both
                dials and below the front edge
  horizon_strip the glow's last rows at 1x (the crisp edge) and the black line under it
  bar_body      black, opaque, from the front edge down (fades out at the bottom), clipped by the dials
  bar_line      the front line (alpha = its code value over black / its peak; colour = its peak colour)
"""
import math
import numpy as np

R = 335.0
DL = (412.0, 380.0)
DR = (1508.0, 380.0)
MIDX = 960.0
LUMA = np.array([0.2126, 0.7152, 0.0722])


# ------------------------------------------------------------------------------------------------- helpers
def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def s2l(c):
    """sRGB 0..1 -> linear."""
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(c):
    """linear -> sRGB 0..1."""
    c = np.clip(np.asarray(c, np.float64), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


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


def premul_down(img, ss):
    if ss == 1:
        return img
    a = img.copy()
    a[..., :3] *= a[..., 3:4]
    d = down(a, ss)
    al = d[..., 3:4]
    d[..., :3] = np.where(al > 1e-6, d[..., :3] / np.maximum(al, 1e-6), 0.0)
    return d


def dial_clip(x, y, r_clip, soft):
    """1 outside both dials' clip radius (R units), 0 inside, soft over `soft` px."""
    d = np.minimum(np.hypot(x - DL[0], y - DL[1]), np.hypot(x - DR[0], y - DR[1])) - r_clip * R
    return np.clip(0.5 + d / soft, 0.0, 1.0)


def window_sdf(x, y, P):
    """Signed distance (px, + inside) to the window outline: top edge + 45 deg chamfers (rounded joins).
    There are no side edges: below the chamfers the window runs under the dials."""
    X = np.abs(x - MIDX)
    yt, hw, rc = P["top_y"], P["top_half_w"], P["corner_r"]
    a = (y - yt) - rc
    b = (hw - X + (y - yt)) / math.sqrt(2.0) - rc
    inside = np.where((a < 0) & (b < 0), -np.hypot(a, b), np.minimum(a, b)) + rc
    return inside


def hue(P, name):
    """The component's linear-RGB colour per unit luminance (normalised to luma 1)."""
    h = np.asarray(P["hue_" + name], np.float64)
    return h / float(h @ LUMA)


# ------------------------------------------------------------------------------------------------- components
def glow_Y(y, P):
    """Sky glow luminance (linear, panel white = 1): 0 above glow_y0, rising (power glow_p) to glow_a at the
    horizon, plus a thin lip right above the edge. Cut at the horizon (the strip draws the crisp edge)."""
    yh, y0 = P["horizon_y"], P["glow_y0"]
    t = np.clip((y - y0) / (yh - y0), 0.0, 1.0)
    lip = 1.0 + P["lip_a"] * np.exp(-0.5 * ((y - (yh - P["lip_d"])) / P["lip_s"]) ** 2)
    return P["glow_a"] * t ** P["glow_p"] * lip * (y < yh)


def row_ys(P):
    return [P["row_yv"] + 1.0 / (P["row_u0"] - k * P["row_du"]) for k in range(int(P["row_n"]))]


def rows_Y(x, y, P):
    """The floor's light rows: each a bright top edge + a decaying body, ending in a dark gap before the next row
    (the last one runs to the front edge). Lit from the centre: exp(-(X / h_k) ** p)."""
    X = np.abs(x - MIDX)
    ys = row_ys(P)
    yh, yf = P["horizon_y"], P["front_y"]
    out = np.zeros(np.broadcast(x, y).shape)
    n = len(ys)
    for k, yk in enumerate(ys):
        tk = (yk - yh) / (yf - yh)
        A = P["row_amp%d" % k]                                            # edge peak (linear), one per row
        yn = ys[k + 1] if k + 1 < n else yf
        d = y - yk
        rise = np.exp(-0.5 * (np.minimum(d, 0.0) / P["row_rise"]) ** 2)
        edge = np.exp(-np.maximum(d, 0.0) / P["row_edge_d"])
        body = P["row_body"] * np.exp(-np.maximum(d, 0.0) / (P["row_body_d"] * (yn - yk)))
        prof = np.where(d < 0, rise, (1.0 - P["row_body"]) * edge + body)
        if k + 1 < n:                                                     # the dark gap before the next row
            prof = prof * (1.0 - smoothstep(yn - P["row_gap"] - P["row_gap_s"], yn - P["row_gap"], y)) * (y < yn)
        else:
            prof = prof * (y <= yf + 1.0)
        prof = prof * (y > yk - 4.0 * P["row_rise"])
        h = P["row_h0"] + P["row_h1"] * tk
        out = out + A * prof * np.exp(-(X / h) ** P["row_hp"])
    return out * (y >= yh)


def walls_Y(x, y, P):
    """Side walls: a soft streak at X = xw(y), rising in from wall_y0, brightest toward the front, fading out
    just above the front edge."""
    X = np.abs(x - MIDX)
    ty = y - P["wall_y0"]
    xw = P["wall_x0"] + P["wall_x1"] * ty
    a = P["wall_a"] * smoothstep(P["wall_y0"] - P["wall_in"], P["wall_y0"] + P["wall_in"], y) \
        * (1.0 + P["wall_ag"] * np.clip(ty, 0, None) / 100.0)
    a = a * (1.0 - smoothstep(P["front_y"] - P["wall_out"], P["front_y"] + 1.0, y))
    s = P["wall_s0"] + P["wall_s1"] * np.clip(ty, 0, None) / 100.0
    return a * np.exp(-0.5 * ((X - xw) / s) ** 2) * (y >= P["horizon_y"]) * (y <= P["front_y"] + 1.0)


def line_Y(x, y, P):
    """The front edge line: Gaussian across (line_s), fading toward its ends to line_floor."""
    X = np.abs(x - MIDX)
    ends = P["line_floor"] + (1.0 - P["line_floor"]) * np.exp(-(X / P["line_h"]) ** P["line_hp"])
    core = np.exp(-0.5 * ((y - P["front_y"]) / P["line_s"]) ** 2)
    return P["line_a"] * core * ends


def encode(*parts):
    """sum of (Y, hue) in linear light -> sRGB 0..1; anything under half a code value is black."""
    lin = sum(Y[..., None] * h for Y, h in parts)
    c = l2s(lin)
    return np.where(c < 0.5 / 255.0, 0.0, c)


def floor_rgb(x, y, P):
    return encode((rows_Y(x, y, P), hue(P, "rows")), (walls_Y(x, y, P), hue(P, "walls")))


def middle_rgb(x, y, P):
    """The whole middle as one image (glow + floor + line), for the fit and the QC: sRGB 0..1."""
    Yg = glow_Y(y, P) * dial_clip(x, y, P["dial_clip_R"], P["dial_clip_soft"])
    return encode((Yg, hue(P, "glow")), (rows_Y(x, y, P), hue(P, "rows")),
                  (walls_Y(x, y, P), hue(P, "walls")), (line_Y(x, y, P), hue(P, "line")))


# ------------------------------------------------------------------------------------------------- layers
def window_base(box, scale, P, ss=2):
    """C5 base (albedo; opaque inside the window, transparent outside): black panel + sky glow + floor."""
    x, y = grid(box, scale, ss)
    sdf = window_sdf(x, y, P)
    cover = np.clip(0.5 + sdf, 0.0, 1.0) * dial_clip(x, y, P["dial_clip_R"], P["dial_clip_soft"])
    cover = cover * np.clip(P["front_y"] + 1.5 - y, 0.0, 1.0)
    rgb = encode((glow_Y(y, P), hue(P, "glow")), (rows_Y(x, y, P), hue(P, "rows")),
                 (walls_Y(x, y, P), hue(P, "walls")))
    out = np.concatenate([rgb, cover[..., None]], -1).astype(np.float32)
    return premul_down(out, ss)


def horizon_strip(box, scale, P, ss=4):
    """C5 crisp horizon (1x): the glow's last rows (crisp, opaque) and the black line under them (horizon_w)."""
    x, y = grid(box, scale, ss)
    yh, w = P["horizon_y"], P["horizon_w"]
    clip = dial_clip(x, y, P["dial_clip_R"], P["dial_clip_soft"])
    rgb = encode((glow_Y(y, P), hue(P, "glow")))
    alpha = np.clip(yh + w - y + 0.5, 0.0, 1.0) * clip
    out = np.concatenate([rgb, alpha[..., None]], -1).astype(np.float32)
    return premul_down(out, ss)


def bar_body(box, scale, P, ss=2):
    """C6 bar body: black (the references' blue / grey strip was their LCD black and glare), opaque below the
    front edge, fading out at the bottom, clipped by the dials."""
    x, y = grid(box, scale, ss)
    top = np.clip(y - (P["front_y"] + 1.0) + 0.5, 0, 1)
    bot = 1.0 - smoothstep(P["bar_fade0"], P["bar_fade1"], y)
    a = top * bot * dial_clip(x, y, P["dial_clip_R"], P["dial_clip_soft"])
    rgb = np.zeros(x.shape + (3,))
    out = np.concatenate([rgb, a[..., None]], -1).astype(np.float32)
    return premul_down(out, ss)


def line_peak_rgb(P):
    return l2s(P["line_a"] * hue(P, "line"))


def bar_line(box, scale, P, ss=4):
    """C6 front line (1x): colour = the line's peak colour, alpha = its sRGB code over black / the peak's code
    (the shader mixes in code values, so over the black bar this reproduces the line's profile)."""
    x, y = grid(box, scale, ss)
    Y = line_Y(x, y, P)
    c = l2s(Y)
    cp = float(l2s(P["line_a"]))
    a = np.where(c < 0.5 / 255.0, 0.0, c / cp) * dial_clip(x, y, P["dial_clip_R"], P["dial_clip_soft"])
    rgb = np.broadcast_to(line_peak_rgb(P), x.shape + (3,))
    out = np.concatenate([rgb, np.clip(a, 0, 1)[..., None]], -1).astype(np.float32)
    return premul_down(out, ss)
