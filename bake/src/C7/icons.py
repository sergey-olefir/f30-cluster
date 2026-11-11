"""C7 (P5): the signs and pictograms as vector shape lists -> SVG text and a supersampled raster.

Our own drawing: generic shapes fitted to the proportions measured from the 6WB photos (12, 17, 04, 02, 07).
No BMW artwork is traced and no font is used; the speed limit's figure stays live text (only its box is given).

An icon is a list of ops painted in order (painter's model):
  ("fill", rgb, shape)   paint the shape opaque in rgb (0..1)
  ("cut", shape)         clear the shape to transparent (everything painted before it)
Shapes, in icon-local px (1x panel px at the reference size, y down):
  ("circle", cx, cy, r)
  ("rrect", x0, y0, x1, y1, r)
  ("poly", [(x, y), ...])
  ("line", [(x, y), ...], width)        a round-capped, round-joined stroke
"""
import math
import numpy as np
from PIL import Image, ImageDraw

# ------------------------------------------------------------------------------------------------- measurements
# All from bake/work/C7/m*.py on the rectified, exposure-normalised crops (see bake/report/C7.md).
SIGN_R_OUT = 41.8      # px at R 335: red ring outer edge (circle fit, sd 0.1 px, both signs)   = 0.1248 R
SIGN_R_IN = 33.9       # white field radius (half-max of G, sd 0.07 px)                        = 0.1012 R
SIGN_RED = (217, 42, 14)       # ring, normalised crop (raw photo 233, 45, 15)
SIGN_WHITE = (238, 238, 238)   # field, 90th pct (raw 255)
CAR_RED = (214, 50, 41)
CAR_DARK = (22, 22, 24)        # measured 31 (blurred); the core is darker
LIGHT = (236, 236, 236)        # white pictograms on the minis / bottom bar
BATTERY_BLUE = (170, 202, 228)  # 17: the EfficientDynamics battery, 95th pct of the outline (blurred thin stroke)
WARN_RED = (226, 64, 70)       # 17 bottom bar triangle (07 shows it amber: WARN_AMBER)
WARN_AMBER = (238, 214, 120)


def rgb(c):
    return tuple(v / 255.0 for v in c)


# ------------------------------------------------------------------------------------------------- the icons
def car(cx, cy, col, field):
    """A generic car seen from behind/front, 25 x 19.5 px (measured bbox of each car in sign 12), centred on cx, cy."""
    T = lambda pts: [(cx + x, cy + y) for x, y in pts]
    return [
        ("fill", col, ("poly", T([(-7.0, -9.75), (7.0, -9.75), (8.6, -9.0), (10.8, -2.0), (-10.8, -2.0), (-8.6, -9.0)]))),
        ("fill", col, ("rrect", cx - 12.5, cy - 3.6, cx + 12.5, cy + 5.6, 2.6)),
        ("fill", col, ("rrect", cx - 11.6, cy + 3.0, cx - 6.4, cy + 9.75, 1.6)),
        ("fill", col, ("rrect", cx + 6.4, cy + 3.0, cx + 11.6, cy + 9.75, 1.6)),
        ("fill", field, ("poly", T([(-5.6, -7.6), (5.6, -7.6), (7.4, -3.6), (-7.4, -3.6)]))),      # windscreen
        ("fill", field, ("rrect", cx - 9.4, cy - 0.9, cx - 4.6, cy + 2.0, 0.7)),                  # lamps
        ("fill", field, ("rrect", cx + 4.6, cy - 0.9, cx + 9.4, cy + 2.0, 0.7)),
    ]


def sign_base(c=(0.0, 0.0)):
    return [("fill", rgb(SIGN_RED), ("circle", c[0], c[1], SIGN_R_OUT)),
            ("fill", rgb(SIGN_WHITE), ("circle", c[0], c[1], SIGN_R_IN))]


CAR_DX = 15.5   # each car's centre from the sign centre (measured -16.1 / +14.9 px)


def sign_noov(c=(0.0, 0.0)):
    return sign_base(c) + car(c[0] - CAR_DX, c[1], rgb(CAR_RED), rgb(SIGN_WHITE)) \
        + car(c[0] + CAR_DX, c[1], rgb(CAR_DARK), rgb(SIGN_WHITE))


# the live figure's box on the limit sign, relative to its centre (px at R 335): half-max bbox of "60" in 12
LIMIT_TEXT_BOX_2 = (-18.5, -16.2, 37.0, 30.0)      # x, y, w, h  (2 digits; cap height 30 px = 0.0896 R)
LIMIT_TEXT_BOX_3 = (-27.0, -16.2, 54.0, 30.0)      # widest box inside the field at that height (3 digits, condensed)


def pump(x0, y0, s, col, hose=True):
    """A generic fuel pump; s = height px. Local design height 15 (measured 04 C3 pump+hose 13 x 15 px)."""
    k = s / 15.0
    P = lambda x, y: (x0 + x * k, y0 + y * k)
    ops = [("fill", col, ("rrect", *P(0.0, 0.0), *P(8.6, 15.0), 1.3 * k)),
           ("fill", col, ("rrect", *P(-0.8, 13.4), *P(9.4, 15.0), 0.4 * k)),
           ("cut", ("rrect", *P(1.7, 1.8), *P(6.2, 5.0), 0.4 * k))]
    if hose:
        ops.append(("fill", col, ("line", [P(8.0, 2.4), P(11.4, 4.6), P(11.4, 11.0), P(10.4, 12.2), P(9.4, 11.0), P(9.4, 8.0)], 1.5 * k)))
    return ops


def icon_fuel():
    """Mini C3: pump + the filler-side triangle (04: triangle 4 x 6 px, 14 px right of the pump's left edge)."""
    col = rgb(LIGHT)
    return pump(0.0, 0.0, 15.0, col) + [("fill", col, ("poly", [(14.2, 4.0), (18.2, 7.0), (14.2, 10.0)]))]


def icon_range():
    """Bottom bar (17): arrow + pump, 54 x 32 px."""
    col = rgb(LIGHT)
    ops = [("fill", col, ("line", [(2.4, 16.2), (12.5, 16.2)], 5.4)),
           ("fill", col, ("poly", [(11.0, 9.0), (21.6, 16.2), (11.0, 23.4)]))]
    return ops + pump(27.0, 0.0, 32.0, col)


def icon_oil():
    """Mini C4 oil temperature (04/17/07: 23 x 14 px): a generic oil-can outline with its lid lever, spout and drop,
    and a thermometer with two ticks dipping into it."""
    col = rgb(LIGHT)
    sw = 1.6
    return [
        ("fill", col, ("line", [(0.9, 4.6), (6.2, 7.2)], 2.0)),                                  # lever
        ("fill", col, ("line", [(5.4, 7.4), (17.4, 7.4), (15.8, 13.2), (7.4, 13.2), (5.4, 7.4)], sw)),   # can outline
        ("fill", col, ("line", [(17.4, 7.4), (21.6, 5.4)], sw)),                                 # spout
        ("fill", col, ("circle", 21.9, 11.6, 1.15)),                                            # drop
        ("fill", col, ("poly", [(21.9, 8.9), (23.0, 11.2), (20.8, 11.2)])),
        ("fill", col, ("rrect", 10.4, 0.0, 12.6, 10.6, 1.0)),                                   # thermometer
        ("fill", col, ("line", [(12.6, 2.2), (15.0, 2.2)], 1.3)),
        ("fill", col, ("line", [(12.6, 5.0), (15.0, 5.0)], 1.3)),
    ]


def icon_coolant():
    """Mini C4 coolant temperature (only seen in 02, weak): thermometer with two ticks over two waves, 27 x 22."""
    col = rgb(LIGHT)
    ops = [("fill", col, ("rrect", 11.9, 0.0, 14.9, 12.5, 1.5)),
           ("fill", col, ("circle", 13.4, 12.6, 2.7))]
    for y in (3.0, 6.6):
        ops.append(("fill", col, ("line", [(15.9, y), (19.4, y)], 1.5)))
    for y in (16.4, 20.4):
        pts = [(1.0 + i * 0.5, y + 1.1 * math.sin((i * 0.5) / 25.0 * 2 * math.pi * 3.0 + math.pi)) for i in range(51)]
        ops.append(("fill", col, ("line", pts, 1.9)))
    return ops


def icon_battery():
    """EfficientDynamics battery under the rev dial (17), upright, 38 x 28 px: outline, two terminals, - and +."""
    col = rgb(BATTERY_BLUE)
    sw = 3.2
    return [
        ("fill", col, ("rrect", 0.0, 3.4, 38.0, 28.0, 2.8)),
        ("cut", ("rrect", sw, 3.4 + sw, 38.0 - sw, 28.0 - sw, 1.0)),
        ("fill", col, ("rrect", 5.0, 0.0, 12.0, 3.8, 0.6)),
        ("fill", col, ("rrect", 26.0, 0.0, 33.0, 3.8, 0.6)),
        ("fill", col, ("line", [(6.4, 12.4), (12.6, 12.4)], 2.0)),
        ("fill", col, ("line", [(25.4, 12.4), (31.6, 12.4)], 2.0)),
        ("fill", col, ("line", [(28.5, 9.3), (28.5, 15.5)], 2.0)),
    ]


def icon_warning(col=WARN_RED):
    """Bottom-bar check-control triangle (17: 27 x 26 px), filled, with a cut exclamation mark."""
    c = rgb(col)
    return [
        ("fill", c, ("line", [(13.5, 2.0), (25.0, 23.8), (2.0, 23.8), (13.5, 2.0)], 4.0)),
        ("fill", c, ("poly", [(13.5, 2.0), (25.0, 23.8), (2.0, 23.8)])),
        ("cut", ("poly", [(12.3, 8.6), (14.7, 8.6), (14.2, 17.4), (12.8, 17.4)])),
        ("cut", ("circle", 13.5, 20.4, 1.4)),
    ]


def icon_belt():
    """Seat belt (ISO-style seated person + belt), 28 x 47 px (17). NOT shipped: on the G20, BMW draws its own belt
    lamp over our panel (x 587-626, y 665-720), so the theme does not need it."""
    c = rgb((228, 70, 74))
    return [
        ("fill", c, ("circle", 14.0, 5.6, 5.4)),
        ("fill", c, ("rrect", 5.0, 12.6, 23.0, 32.0, 4.0)),
        ("fill", c, ("rrect", 5.0, 27.0, 13.0, 47.0, 2.0)),
        ("fill", c, ("rrect", 15.0, 27.0, 23.0, 47.0, 2.0)),
        ("fill", c, ("rrect", 0.0, 14.0, 4.2, 30.0, 2.0)),
        ("fill", c, ("rrect", 23.8, 14.0, 28.0, 30.0, 2.0)),
        ("cut", ("line", [(20.6, 13.4), (7.4, 30.6)], 2.2)),
    ]


# ------------------------------------------------------------------------------------------------- transforms
def transform(ops, dx=0.0, dy=0.0, rot_deg=0.0, pivot=(0.0, 0.0), scale=1.0):
    """Rotate (cw, y down) about pivot, scale, then translate. Circles stay circles; rrects become polys if rotated."""
    t = math.radians(rot_deg)
    ct, st = math.cos(t), math.sin(t)
    px, py = pivot

    def P(x, y):
        x, y = (x - px) * scale, (y - py) * scale
        return (px * scale + x * ct - y * st + dx, py * scale + x * st + y * ct + dx * 0 + dy)

    out = []
    for op in ops:
        sh = op[-1]
        k = sh[0]
        if k == "circle":
            c = P(sh[1], sh[2]); ns = ("circle", c[0], c[1], sh[3] * scale)
        elif k == "rrect":
            if rot_deg == 0.0:
                a, b = P(sh[1], sh[2]), P(sh[3], sh[4]); ns = ("rrect", a[0], a[1], b[0], b[1], sh[5] * scale)
            else:
                ns = ("poly", [P(x, y) for x, y in rrect_pts(*sh[1:])])
        elif k == "poly":
            ns = ("poly", [P(x, y) for x, y in sh[1]])
        elif k == "line":
            ns = ("line", [P(x, y) for x, y in sh[1]], sh[2] * scale)
        out.append(op[:-1] + (ns,))
    return out


def rrect_pts(x0, y0, x1, y1, r, n=12):
    r = max(0.0, min(r, (x1 - x0) / 2, (y1 - y0) / 2))
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for i in range(n + 1):
            a = math.radians(a0 + 90.0 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def bbox(ops):
    xs, ys = [], []
    for op in ops:
        if op[0] != "fill":
            continue
        sh = op[-1]
        if sh[0] == "circle":
            xs += [sh[1] - sh[3], sh[1] + sh[3]]; ys += [sh[2] - sh[3], sh[2] + sh[3]]
        elif sh[0] == "rrect":
            xs += [sh[1], sh[3]]; ys += [sh[2], sh[4]]
        elif sh[0] == "poly":
            xs += [p[0] for p in sh[1]]; ys += [p[1] for p in sh[1]]
        elif sh[0] == "line":
            w = sh[2] / 2
            xs += [p[0] - w for p in sh[1]] + [p[0] + w for p in sh[1]]
            ys += [p[1] - w for p in sh[1]] + [p[1] + w for p in sh[1]]
    return min(xs), min(ys), max(xs), max(ys)


# ------------------------------------------------------------------------------------------------- raster
def raster(ops, w, h, ss=8):
    """-> float32 (h, w, 4) straight alpha. Painter's model at ss x, then a premultiplied box downscale."""
    im = Image.new("RGBA", (w * ss, h * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)          # no blending: fills overwrite, cuts clear
    for op in ops:
        sh = op[-1]
        fill = (0, 0, 0, 0) if op[0] == "cut" else tuple(int(round(v * 255)) for v in op[1]) + (255,)
        S = lambda p: (p[0] * ss, p[1] * ss)
        k = sh[0]
        if k == "circle":
            cx, cy, r = sh[1] * ss, sh[2] * ss, sh[3] * ss
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
        elif k == "rrect":
            d.polygon([S(p) for p in rrect_pts(*sh[1:])], fill=fill)
        elif k == "poly":
            d.polygon([S(p) for p in sh[1]], fill=fill)
        elif k == "line":
            pts = [S(p) for p in sh[1]]
            wpx = sh[2] * ss
            d.line(pts, fill=fill, width=max(1, int(round(wpx))), joint="curve")
            r = wpx / 2
            for p in (pts[0], pts[-1]):
                d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=fill)
    a = np.asarray(im, np.float32) / 255.0
    a[..., :3] *= a[..., 3:4]
    a = a.reshape(h, ss, w, ss, 4).mean(axis=(1, 3))
    al = a[..., 3:4]
    a[..., :3] = np.where(al > 1e-6, a[..., :3] / np.maximum(al, 1e-6), 0.0)
    return a


# ------------------------------------------------------------------------------------------------- svg
def _hex(c):
    return "#%02x%02x%02x" % tuple(int(round(v * 255)) for v in c)


def _f(v):
    return ("%.2f" % v).rstrip("0").rstrip(".")


def _shape_svg(sh, attrs):
    k = sh[0]
    if k == "circle":
        return f'<circle cx="{_f(sh[1])}" cy="{_f(sh[2])}" r="{_f(sh[3])}" {attrs}/>'
    if k == "rrect":
        x0, y0, x1, y1, r = sh[1:]
        return f'<rect x="{_f(x0)}" y="{_f(y0)}" width="{_f(x1 - x0)}" height="{_f(y1 - y0)}" rx="{_f(r)}" {attrs}/>'
    if k == "poly":
        return f'<polygon points="{" ".join(_f(x) + "," + _f(y) for x, y in sh[1])}" {attrs}/>'
    if k == "line":
        return (f'<polyline points="{" ".join(_f(x) + "," + _f(y) for x, y in sh[1])}" fill="none" '
                f'stroke-width="{_f(sh[2])}" stroke-linecap="round" stroke-linejoin="round" {attrs}/>')
    raise ValueError(k)


def svg(ops, w, h, title):
    """Painter's model in SVG: each cut masks everything painted before it (nested <g mask>)."""
    defs, body, n = [], "", 0
    for op in ops:
        sh = op[-1]
        if op[0] == "fill":
            col = _hex(op[1])
            attrs = f'stroke="{col}"' if sh[0] == "line" else f'fill="{col}"'
            body += "  " + _shape_svg(sh, attrs) + "\n"
        else:
            n += 1
            attrs = 'stroke="#000"' if sh[0] == "line" else 'fill="#000"'
            defs.append(f'  <mask id="cut{n}" maskUnits="userSpaceOnUse" x="0" y="0" width="{w}" height="{h}">'
                        f'<rect width="{w}" height="{h}" fill="#fff"/>{_shape_svg(sh, attrs)}</mask>')
            body = f'  <g mask="url(#cut{n})">\n{body}  </g>\n'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n'
            f'  <title>{title}</title>\n  <defs>\n' + "\n".join(defs) + "\n  </defs>\n" + body + "</svg>\n")
