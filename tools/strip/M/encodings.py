"""Package M (docs/strip/M-REPORT.md 2): which texture encoding for the STRIP mask.

Measures, on synthetic shapes with known geometry (no photo pixels), how well each encoding reproduces the exact
coverage a perfect full-resolution mask would hold, when the GPU samples it the way WBBACK will (GLSL texture2D,
bilinear, at the panel pixel's centre). Encodings:

  full_alpha   1920 x 180, plain coverage, 8 bit (one byte per lane and pixel)
  half_alpha   960 x 90, plain coverage (2 x 2 box average), 8 bit, bilinear up
  half_sdf     960 x 90, a NORMALISED signed distance (distance / the local ramp width, so each edge keeps its own
               feather), 8 bit over n in [-N, N], bilinear up, alpha = clamp(0.5 - n) in the shader

Ground truth: the coverage of each panel pixel, 8 x 8 supersampled, of a ramp across every edge: hard edges (feather
0) are plain area coverage, a feathered edge is a linear ramp of the given width centred on the edge.

Also the fp16 question (brief M.4): the texel a mediump (fp16) texture coordinate lands on across 1920 px.

    UV_CACHE_DIR=... uv run -q --no-project --with numpy --with scipy python -I tools/strip/M/encodings.py [out.json]
"""
import json
import sys

import numpy as np
from scipy import ndimage

W, H, Y0 = 1920, 180, 540            # the STRIP, panel px (half-open)
SS = 8                               # supersampling per panel px for the ground truth
NMAX = 2.5                           # half_sdf: n stored over [-NMAX, NMAX]


# ---------------------------------------------------------------------------------------------------------- shapes
def grid(scale):
    """Sample centres of a W*scale x H*scale grid over the STRIP, panel px."""
    ys = Y0 + (np.arange(H * scale) + 0.5) / scale
    xs = (np.arange(W * scale) + 0.5) / scale
    return np.meshgrid(xs, ys)


def sd_box(x, y, b):
    """Signed distance to the box b (x0, y0, x1, y1), < 0 inside."""
    cx, cy, hx, hy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, (b[2] - b[0]) / 2, (b[3] - b[1]) / 2
    qx, qy = np.abs(x - cx) - hx, np.abs(y - cy) - hy
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0)


def sd_circle(x, y, c, r):
    return np.hypot(x - c[0], y - c[1]) - r


def sd_poly(x, y, pts):
    """Signed distance to a simple polygon (< 0 inside), exact."""
    pts = np.asarray(pts, float)
    d = np.full(x.shape, np.inf)
    s = np.ones(x.shape)
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        e = b - a
        wx, wy = x - a[0], y - a[1]
        t = np.clip((wx * e[0] + wy * e[1]) / (e @ e), 0, 1)
        d = np.minimum(d, np.hypot(wx - e[0] * t, wy - e[1] * t))
        c1 = y >= a[1]
        c2 = y < b[1]
        c3 = e[0] * wy > e[1] * wx
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s = np.where(flip, -s, s)
    return s * d


def arc_pts(cx, cy, r, a0, a1, n=48):
    a = np.radians(np.linspace(a0, a1, n))
    return [(cx + r * np.cos(t), cy + r * np.sin(t)) for t in a]


# a stand-in for BMW's message panel: an arc on top and slanted ends (the true one is package ZC's)
PANEL = ([(702.0, 691.0), (702.0, 630.0), (712.0, 621.0)] + arc_pts(964.5, 2424.0, 1819.5, 262.28, 277.72)
         + [(1217.0, 621.0), (1227.0, 630.0), (1227.0, 691.0)])

CASES = {
    # name: (signed-distance function of (x, y), feather px, what it stands for)
    'rect_fractional_hard': (lambda x, y: sd_box(x, y, (590.3, 594.0, 1250.0, 665.4)), 0.0,
                             "today's CC_TOP with a fractional edge"),
    'sign_hole_hard': (lambda x, y: -sd_circle(x, y, (537.3, 621.3), 41.5), 0.0,
                       "BMW's sign, a round hole r 41.5 (cover outside)"),
    'sign_hole_feather2': (lambda x, y: -sd_circle(x, y, (537.3, 621.3), 41.5), 2.0, 'the same, a 2 px soft edge'),
    'panel_hole_hard': (lambda x, y: -sd_poly(x, y, PANEL), 0.0, 'a panel with an arc and slanted ends'),
    'panel_hole_feather3': (lambda x, y: -sd_poly(x, y, PANEL), 3.0, 'the same, a 3 px shadow'),
    'corridor_3px_hard': (lambda x, y: sd_box(x, y, (560.0, 600.0, 563.0, 700.0)), 0.0,
                          'a 3 px wide cover between two holes (a corridor)'),
    'corridor_2px_hard': (lambda x, y: sd_box(x, y, (560.25, 600.0, 562.25, 700.0)), 0.0, 'a 2 px corridor'),
    'slanted_feather4': (lambda x, y: (x - 800.0) * np.cos(np.radians(20)) + (y - 650.0) * np.sin(np.radians(20)), 4.0,
                         'a slanted straight edge, 4 px shadow'),
}


def ramp(d, f):
    """Coverage of the COVER side (d < 0) across an edge: hard (f 0) or a linear ramp f px wide centred on it."""
    if f <= 0:
        return (d < 0).astype(np.float64)
    return np.clip(0.5 - d / f, 0.0, 1.0)


def truth(sd, f):
    """Each panel pixel's exact coverage (8 x 8 supersampled box filter)."""
    x, y = grid(SS)
    a = ramp(sd(x, y), f)
    return a.reshape(H, SS, W, SS).mean((1, 3))


# ------------------------------------------------------------------------------------------------------ sampling
def bilinear(tex, u, v):
    """GLSL texture2D, LINEAR, CLAMP_TO_EDGE: tex[h, w] at normalised (u, v)."""
    h, w = tex.shape
    x, y = u * w - 0.5, v * h - 0.5
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    xa, xb = np.clip(x0, 0, w - 1), np.clip(x0 + 1, 0, w - 1)
    ya, yb = np.clip(y0, 0, h - 1), np.clip(y0 + 1, 0, h - 1)
    return (tex[ya, xa] * (1 - fx) * (1 - fy) + tex[ya, xb] * fx * (1 - fy)
            + tex[yb, xa] * (1 - fx) * fy + tex[yb, xb] * fx * fy)


def nearest(tex, u, v):
    h, w = tex.shape
    return tex[np.clip(np.floor(v * h).astype(int), 0, h - 1), np.clip(np.floor(u * w).astype(int), 0, w - 1)]


def q8(a):
    return np.round(np.clip(a, 0, 1) * 255.0) / 255.0


def uv_full():
    x, y = grid(1)
    return x / W, (y - Y0) / H


# ----------------------------------------------------------------------------------------------------- encodings
def enc_full_alpha(sd, f):
    t = q8(truth(sd, f))
    u, v = uv_full()
    return bilinear(t, u, v)


def enc_half_alpha(sd, f):
    t = truth(sd, f).reshape(H // 2, 2, W // 2, 2).mean((1, 3))
    u, v = uv_full()
    return bilinear(q8(t), u, v)


def enc_half_sdf(sd, f):
    """n = d / w at the half-res texel centres (w the local ramp width: 1 px for a hard edge, else the feather), stored
    over [-NMAX, NMAX]; the shader takes clamp(0.5 - n, 0, 1) of the bilinear n."""
    w = max(f, 1.0)
    x, y = grid(0.5)
    n = np.clip(sd(x, y) / w, -NMAX, NMAX)
    tex = q8((n + NMAX) / (2 * NMAX))
    u, v = uv_full()
    nr = bilinear(tex, u, v) * 2 * NMAX - NMAX
    return np.clip(0.5 - nr, 0.0, 1.0)


ENC = {'full_alpha': (enc_full_alpha, W * H), 'half_alpha': (enc_half_alpha, W * H // 4),
       'half_sdf': (enc_half_sdf, W * H // 4)}


def edge_shift(rec, tru, sd):
    """The mean signed displacement of the reconstructed edge, px (+: the cover grew), over the pixels within 6 px of
    the edge, and the worst local one (per 1 px band of x or y, whichever the edge runs along)."""
    x, y = grid(1)
    d = sd(x, y)
    band = np.abs(d) < 6
    diff = (rec - tru) * band
    # edge length within the band: area / band width
    length = band.sum() / 12.0
    mean = diff.sum() / max(length, 1e-9)
    return float(mean)


def measure():
    out = {}
    for name, (sd, f, what) in CASES.items():
        tru = truth(sd, f)
        x, y = grid(1)
        d = sd(x, y)
        near = np.abs(d) < max(3.0, 2 * f + 2)
        row = {'what': what, 'feather_px': f}
        for en, (fn, texels) in ENC.items():
            rec = fn(sd, f)
            e = np.abs(rec - tru)
            row[en] = {
                'max_abs_alpha_err': round(float(e.max()), 4),
                'p99_abs_alpha_err_near_edge': round(float(np.percentile(e[near], 99)), 4),
                'mean_edge_shift_px': round(edge_shift(rec, tru, sd), 3),
                'pixels_off_by_more_than_1/255': int((e > 1.0 / 255 + 1e-9).sum()),
            }
        out[name] = row
    return out


def fp16_coords():
    """M.4: the texel each panel column lands on when the coordinate is computed in fp16 (the car's mediump) versus
    highp, with WBBACK's own expression u = (v_uv.x * u_size.x - r.x) / r.z, and with the snap-to-texel-centre fix."""
    f16 = np.float16
    i = np.arange(W)
    vuv = (i + 0.5) / W                             # the varying, exact
    out = {}
    # mediump everywhere: v_uv in fp16, p = v_uv * 1920 in fp16, u = p / 1920 in fp16
    p16 = (f16(vuv) * f16(W)).astype(f16)
    u16 = (p16 / f16(W)).astype(f16)
    texel16 = np.floor(u16.astype(np.float64) * W).astype(int)
    off16 = (u16.astype(np.float64) * W - 0.5) - i       # how far from the texel centre, texels
    out['mediump_wrong_texel_columns'] = int((texel16 != i).sum())
    out['mediump_max_offset_from_centre_texels'] = round(float(np.abs(off16).max()), 3)
    out['mediump_p_spacing_at_x_1500_px'] = float(np.spacing(f16(1500.0)))
    # mediump with a bilinear fetch: the blend weight an error gives the neighbour texel
    out['mediump_bilinear_neighbour_weight_max'] = round(float(np.clip(np.abs(off16), 0, 1).max()), 3)
    # highp (fp32), WBBACK's precision when GL_FRAGMENT_PRECISION_HIGH is defined
    p32 = (np.float32(vuv) * np.float32(W)).astype(np.float32)
    u32 = (p32 / np.float32(W)).astype(np.float32)
    off32 = (u32.astype(np.float64) * W - 0.5) - i
    out['highp_max_offset_from_centre_texels'] = float(np.abs(off32).max())
    # the fix: floor(p) + 0.5 snaps to the texel centre whatever p's rounding (p is never off by >= 0.5 in fp32)
    snap = (np.floor(p32) + np.float32(0.5)) / np.float32(W)
    out['highp_snapped_max_offset_texels'] = float(np.abs(snap.astype(np.float64) * W - 0.5 - i).max())
    return out


def main():
    res = {'strip': [0, Y0, W, Y0 + H], 'ss': SS, 'nmax': NMAX,
           'memory_MiB_per_lane_as_counted': {'full_alpha_r8': W * H * 2 / 1048576.0,
                                              'half_r8': W * H // 4 * 2 / 1048576.0},
           'cases': measure(), 'fp16': fp16_coords()}
    js = json.dumps(res, indent=1)
    if len(sys.argv) > 1:
        open(sys.argv[1], 'w').write(js + '\n')
    print(js)


if __name__ == '__main__':
    main()
