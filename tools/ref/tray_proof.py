"""car4 L proof sheets from bench shots (our renders only; the 6WB reference enters as measured numbers, drawn as a
thin outline, never as photo pixels).
    uv run -q --no-project --with pillow python -I tools/ref/tray_proof.py <shots dir> docs/car4/l
<shots dir> holds before/ and after/ (<layout>_P.png, <layout>_D3.png) and opts/ (comfort_D3_<gear|letter|empty|nolabel>.png),
bench shots at 1920 x 720 (bench 8097, ?only=1&clean=1&car=0&backdrop=1&g20=driving)."""
import sys, os, math, json
from PIL import Image, ImageDraw, ImageFont

S, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
X0, Y0, X1, Y1 = 1380, 496, 1640, 630
K = 3
CX, CY = 1508.0, 380.0
# 05 (rectified to panel px), measured by measure_tray.py, about its own tray centre: the shelf at y 552.5, its ends
# -41 / +46 (mean half-width 43.5 px = 0.130 R), shoulders 42.0 / 40.7 deg, the shoulder/arc junction at -87.1 / +90.4,
# the arc r 228.8 px (0.683 R) lit from -24.5 to +26.8 deg
REF = dict(shelf_y=552.5, shelf_hw=43.5, shoulder_deg=41.35, arc_r=228.8, arc_from=-24.5, arc_to=26.8)
font = ImageFont.load_default(size=26)
small = ImageFont.load_default(size=20)


def crop(f):
    im = Image.open(f).convert('RGB').crop((X0, Y0, X1, Y1))
    return im.resize((im.width * K, im.height * K), Image.LANCZOS)


def P(x, y):
    return ((x - X0) * K, (y - Y0) * K)


def ref_outline(im):
    """The reference's measured tray as a thin dashed outline (numbers only)."""
    d = ImageDraw.Draw(im)
    col = (255, 0, 200)
    t = math.radians(REF['shoulder_deg'])
    # shelf
    sy, hw, r = REF['shelf_y'], REF['shelf_hw'], REF['arc_r']
    pts = []
    for sgn in (-1, 1):
        # shoulder from the shelf end down-out to the arc circle
        x0, y0 = CX + sgn * hw, sy
        s = 0.0
        while True:
            x, y = x0 + sgn * s * math.cos(t), y0 + s * math.sin(t)
            if math.hypot(x - CX, y - CY) >= r:
                break
            s += 0.25
        pts.append(((x0, y0), (x, y)))
    segs = [((CX - hw, sy), (CX + hw, sy))] + pts
    for a in range(int(REF['arc_from'] * 4), int(REF['arc_to'] * 4)):
        a0, a1 = math.radians(a / 4.0), math.radians((a + 1) / 4.0)
        segs.append(((CX + r * math.sin(a0), CY + r * math.cos(a0)), (CX + r * math.sin(a1), CY + r * math.cos(a1))))
    # dashed: draw every other short piece along each segment
    for (p0, p1) in segs:
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        n = max(1, int(L / 2.0))
        for i in range(n):
            if (i // 2) % 2:
                continue
            q0 = (p0[0] + (p1[0] - p0[0]) * i / n, p0[1] + (p1[1] - p0[1]) * i / n)
            q1 = (p0[0] + (p1[0] - p0[0]) * (i + 1) / n, p0[1] + (p1[1] - p0[1]) * (i + 1) / n)
            d.line([P(*q0), P(*q1)], fill=col, width=2)
    return im


def label(im, text, sub=None):
    o = Image.new('RGB', (im.width, im.height + 70), (24, 24, 28))
    o.paste(im, (0, 70))
    d = ImageDraw.Draw(o)
    d.text((10, 6), text, fill=(255, 255, 255), font=font)
    if sub:
        d.text((10, 38), sub, fill=(190, 190, 190), font=small)
    return o


def grid(cells, cols):
    w, h = cells[0].size
    rows = (len(cells) + cols - 1) // cols
    o = Image.new('RGB', (w * cols + 6 * (cols - 1), h * rows + 6 * (rows - 1)), (40, 40, 40))
    for i, c in enumerate(cells):
        o.paste(c, ((i % cols) * (w + 6), (i // cols) * (h + 6)))
    return o


def sh(d, n):
    return os.path.join(S, d, n)


# 1. the tray before / after, with the reference's measured outline
cells = [
    label(crop(sh('before', 'wb_comfort_P.png')), '6WB Comfort, before', 'no gear, no label; dome top'),
    label(crop(sh('after', 'wb_comfort_P.png')), '6WB Comfort, after', 'our P, COMFORT above; shelf + shoulders'),
    label(ref_outline(crop(sh('before', 'wb_comfort_P.png'))), 'before + 6WB measured outline', 'dashed: ref 05 numbers'),
    label(ref_outline(crop(sh('after', 'wb_comfort_P.png'))), 'after + 6WB measured outline', 'dashed: ref 05 numbers'),
    label(crop(sh('before', 'wb_dials_D3.png')), '6WB Dials + G20, before', 'D3 in the old tray'),
    label(crop(sh('after', 'wb_dials_D3.png')), '6WB Dials + G20, after', 'the same tray as Comfort'),
]
grid(cells, 2).save(os.path.join(OUT, 'tray_before_after.png'))

# 2. the tray settings in 6WB Comfort
cells = [label(crop(sh('opts', 'comfort_D3_%s.png' % k)), t) for k, t in
         (('gear', 'gearTray gear (default)'), ('letter', 'gearTray letter'), ('empty', 'gearTray empty'),
          ('nolabel', 'modeLabel off'))]
grid(cells, 2).save(os.path.join(OUT, 'tray_settings.png'))

# 3. the whole panel, every 6WB layout at P and D3 (after)
for lay in ('wb_comfort', 'wb_comfort_map', 'wb_dials', 'wb_sport', 'wb_eco'):
    for g in ('P', 'D3'):
        Image.open(sh('after', '%s_%s.png' % (lay, g))).convert('RGB').save(os.path.join(OUT, '%s_%s.png' % (lay, g)), optimize=True)
print('ok')
