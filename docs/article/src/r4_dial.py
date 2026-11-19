"""Revision 4: the speed dial taken apart, and its shade terms on / off.
Runs the bake package's own drawing code (bake/src/C1/draw.py, params.py: the P1 speed dial, before P10's level
correction) and the shipped scene texture (apps/f30_cluster/hud/scene/speedo.json). No photo pixel is involved.

Usage: python -I r4_dial.py <repo> <images_dir> <f30 bench render 1920x720>
Writes dial-elements_{uk,en}.png and shading_{uk,en}.png."""
import copy
import math
import os
import sys

sys.dont_write_bytecode = True          # do not touch bake/src/**/__pycache__
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO, OUT, BENCH = sys.argv[1:4]
sys.path.insert(0, os.path.join(REPO, 'bake', 'src'))

import numpy as np                                     # noqa: E402
from PIL import Image, ImageDraw, ImageFilter          # noqa: E402

import r4common as rc                                  # noqa: E402
from C1 import draw, params as P                       # noqa: E402

BX, BY, BW, BH = P.BOX                                  # panel box of every C1 layer
BOOST = 4.0


def render(ss=4):
    out = draw.render_all(ss)
    return out


def compose(layers, ids, boost=BOOST):
    c = np.zeros((BH, BW, 4), np.float32)
    for k in ids:
        rc.over(c, layers[k].astype(np.float32))
    return rc.over_black(c, boost)


def tile_img(arr, size):
    im = Image.fromarray(arr).resize((size, size), Image.LANCZOS)
    return im


def layer_view(img, kind):
    """albedo / highlight / glow: over black, x4; shadow: black over a light grey, so the shade itself shows."""
    if kind == 'shadow':
        a = img[..., 3:4]
        g = np.full(img.shape[:2] + (3,), 0.62, np.float32)
        rgb = g * (1 - a)
        return (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)
    return rc.over_black(img, BOOST)


ORDER = sorted(list(draw.SOFT.items()) + list(draw.CRISP.items()), key=lambda kv: kv[1][1])

L = {
    'uk': {
        'title': 'Спідометр 6WB, розібраний на шари (код пакета запікання C1)',
        'sub': 'Кожна плитка — один шар у системі координат циферблата. Яскравість ×4 (обличчя дуже темне); тіні показано чорним на сірому.',
        'baked': 'м\'яке: запікається @0,5x', 'proc': 'чітке: процедурне, 1x', 'bk': 'запечено @0,5x', 'pc': 'процедурне, 1x',
        'names': {'speedo.face': 'обличчя (альбедо)', 'speedo.face-shadow': 'тінь від обідка (AO)',
                  'speedo.floor-shade': 'тінь під «горизонтом»', 'speedo.tick-groove': 'жолоб під поділками',
                  'speedo.tick-groove-rim': 'світлий край жолоба', 'speedo.ticks': 'поділки-клини',
                  'speedo.inner-disc': 'край диска', 'speedo.inner-ring': 'внутрішнє кільце',
                  'speedo.floor': 'кромка «підлоги»', 'speedo.soft-glow': 'сяйво поділок, кілець',
                  'speedo.hub-well': 'тінь навколо осі', 'speedo.bezel': 'обідок із відблиском'},
        'stack': 'усі 12 шарів разом (×4)',
        'ship': 'у застосунку: одна текстура 670×670 RGBA (×4)',
        'live': 'на бенчі: + живе в шейдері',
        'live2': 'стрілка, вісь, смуга перевищення, тексти',
        'foot': 'Шари намальовано кодом bake/src/C1 (до корекції рівнів P10). Праворуч: запечена текстура speedo з 0.7.21 і кадр бенча.',
    },
    'en': {
        'title': 'The 6WB speedometer taken apart into layers (the C1 bake package\'s code)',
        'sub': 'Each tile is one layer in the dial frame. Brightness ×4 (the face is very dark); shadows shown as black on grey.',
        'baked': 'soft: baked @0.5x', 'proc': 'crisp: procedural, 1x', 'bk': 'baked @0.5x', 'pc': 'procedural, 1x',
        'names': {'speedo.face': 'face (albedo)', 'speedo.face-shadow': 'shade by the bezel (AO)',
                  'speedo.floor-shade': 'shade below the "horizon"', 'speedo.tick-groove': 'groove under the ticks',
                  'speedo.tick-groove-rim': 'groove\'s lit rim', 'speedo.ticks': 'wedge ticks',
                  'speedo.inner-disc': 'inner disc edge', 'speedo.inner-ring': 'inner ring',
                  'speedo.floor': 'the "floor" lip', 'speedo.soft-glow': 'glow of ticks and rings',
                  'speedo.hub-well': 'shade round the hub', 'speedo.bezel': 'bezel with its gloss'},
        'stack': 'all 12 layers together (×4)',
        'ship': 'in the app: one 670×670 RGBA texture (×4)',
        'live': 'on the bench: + live in the shader',
        'live2': 'needle, hub, over-speed band, texts',
        'foot': 'Layers drawn by bake/src/C1 (before the P10 level correction). Right: the baked speedo texture of 0.7.21 and a bench frame.',
    },
}


def dial_elements(lang, layers, ship, bench_crop):
    t = L[lang]
    W, H = 1960, 1250
    im = Image.new('RGB', (W, H), rc.BG)
    pen = rc.Pen(REPO, im)
    pen.text((40, 30), t['title'], 36, bold=True)
    pen.text((40, 80), t['sub'], 21, rc.DIM)
    ts, gap, x0, y0 = 250, 22, 40, 130
    for i, (k, (fn, z, kind)) in enumerate(ORDER):
        r, c = divmod(i, 4)
        x, y = x0 + c * (ts + gap), y0 + r * (ts + 92)
        im.paste(tile_img(layer_view(layers[k], kind), ts), (x, y))
        soft = k in draw.SOFT
        col = rc.AMBER if soft else rc.BLUE
        pen.d.rectangle((x - 1, y - 1, x + ts, y + ts), outline=col, width=3)
        pen.text((x, y + ts + 8), 'z %s · %s' % (('%g' % z), t['names'][k]), 16, rc.TXT, True)
        pen.text((x, y + ts + 32), '%s · %s' % (kind, t['bk'] if soft else t['pc']), 16, col)
    # right column
    rx, big = x0 + 4 * (ts + gap) + 20, 470
    stack = compose(layers, [k for k, _ in ORDER])
    pen.text((rx, y0 - 2), t['stack'], 20, rc.TXT, True)
    im.paste(Image.fromarray(stack).resize((big // 2 + 60, big // 2 + 60), Image.LANCZOS), (rx, y0 + 28))
    sx = rx + big // 2 + 80
    pen.text((sx, y0 - 2), t['ship'], 20, rc.TXT, True)
    im.paste(Image.fromarray(rc.over_black(ship, BOOST)).resize((big // 2 + 60, big // 2 + 60), Image.LANCZOS), (sx, y0 + 28))
    yb = y0 + 28 + big // 2 + 90
    pen.text((rx, yb), t['live'], 20, rc.TXT, True)
    pen.text((rx, yb + 28), t['live2'], 18, rc.DIM)
    bc = bench_crop.resize((big + 120, big + 120), Image.LANCZOS)
    im.paste(bc, (rx, yb + 60))
    pen.d.rectangle((rx - 1, yb + 59, rx + big + 120, yb + 60 + big + 120), outline=rc.GREEN, width=3)
    # legend
    ly = H - 70
    pen.d.rectangle((40, ly, 64, ly + 24), outline=rc.AMBER, width=3)
    pen.text((76, ly), t['baked'], 19)
    pen.d.rectangle((360, ly, 384, ly + 24), outline=rc.BLUE, width=3)
    pen.text((396, ly), t['proc'], 19)
    pen.d.rectangle((680, ly, 704, ly + 24), outline=rc.GREEN, width=3)
    pen.text((716, ly), t['live'], 19)
    pen.text((40, H - 32), t['foot'], 17, rc.DIM)
    im.save(os.path.join(OUT, 'dial-elements_%s.png' % lang))


# ------------------------------------------------------------------------------------------ shading on / off
S = {
    'uk': {
        'title': 'Світло й тінь на циферблаті: що саме пораховано',
        'off': 'без тіней і без моделі світла', 'on': 'з тінями, сяйвом і моделлю світла',
        'note': 'той самий код C1; праворуч увімкнено face-shadow, floor-shade, hub-well, soft-glow, lit() і пелюстки відблиску',
        'p1': 'Тіні: альфа чорного шару залежно від r (шкала 0…0,7)',
        'ao': 'AO біля обідка: 0,65·e^(−(0,962−r)/0,018)',
        'fl': 'під лінією «підлоги» (v > 0,245 R): 0,45 до r 0,6', 'hw': 'навколо осі: 0,30·(1−smoothstep(0,135; 0,26; r))',
        'disc': 'за краєм диска: 0,22·e^(−(r−0,487)/0,025)·(1−0,5·lit), середнє по колу',
        'p2': 'Відблиск обідка за кутом: основа + дві гаусові пелюстки',
        'g1': 'C1: основа 0,26 + 0,42·N(8°, σ22°) + 0,72·N(232°, σ32°) + 0,10·N(300°, σ40°)',
        'g2': 'біла — спідометр; сіра — тахометр, дзеркально (θ → 360°−θ); кореляція профілів на фото 0,93–0,99',
        'p3': 'Тінь стрілки (живий шейдер WBDIAL), схема',
        'n1': 'силует стрілки, зсунутий на (+0,012 R; +0,020 R) = (4,0; 6,7) px',
        'n2': 'затемнення 0,7·smoothstep(hw+0,018 R, hw−0,002 R, |x|): край ~6,7 px',
        'r': 'r, частки R', 'deg': 'кут від 12 год, °',
    },
    'en': {
        'title': 'Light and shade on the dial: what exactly is computed',
        'off': 'no shadows, no light model', 'on': 'with shadows, glow and the light model',
        'note': 'the same C1 code; right: face-shadow, floor-shade, hub-well, soft-glow, lit() and the gloss lobes switched on',
        'p1': 'Shadows: alpha of the black layer by r (scale 0…0.7)',
        'ao': 'AO by the bezel: 0.65·e^(−(0.962−r)/0.018)',
        'fl': 'below the "floor" line (v > 0.245 R): 0.45 to r 0.6', 'hw': 'round the hub: 0.30·(1−smoothstep(0.135, 0.26, r))',
        'disc': 'past the disc edge: 0.22·e^(−(r−0.487)/0.025)·(1−0.5·lit), mean round the dial',
        'p2': 'Bezel gloss by angle: a base plus two Gaussian lobes',
        'g1': 'C1: base 0.26 + 0.42·N(8°, σ22°) + 0.72·N(232°, σ32°) + 0.10·N(300°, σ40°)',
        'g2': 'white: speedometer; grey: rev dial, mirrored (θ → 360°−θ); profile correlation on the photos 0.93–0.99',
        'p3': 'The needle\'s shadow (live WBDIAL shader), a sketch',
        'n1': 'the needle\'s silhouette moved by (+0.012 R, +0.020 R) = (4.0, 6.7) px',
        'n2': 'darkened by 0.7·smoothstep(hw+0.018 R, hw−0.002 R, |x|): a ~6.7 px edge',
        'r': 'r, fraction of R', 'deg': 'angle from 12 o\'clock, °',
    },
}


def plot_axes(pen, box, xr, yr, xlab, grid=4):
    x0, y0, x1, y1 = box
    d = pen.d
    d.rectangle(box, outline=rc.LINE, width=1)
    for i in range(1, grid):
        gx = x0 + (x1 - x0) * i / grid
        d.line((gx, y0, gx, y1), fill=(40, 44, 52))
        pen.text((gx, y1 + 6), '%g' % round(xr[0] + (xr[1] - xr[0]) * i / grid, 3), 15, rc.DIM, anchor='ma')
    pen.text(((x0 + x1) / 2, y1 + 28), xlab, 16, rc.DIM, anchor='ma')

    def to(xv, yv):
        return (x0 + (xv - xr[0]) / (xr[1] - xr[0]) * (x1 - x0), y1 - (yv - yr[0]) / (yr[1] - yr[0]) * (y1 - y0))
    return to


def shading(lang, on, off):
    t = S[lang]
    W, H = 1960, 1100
    im = Image.new('RGB', (W, H), rc.BG)
    pen = rc.Pen(REPO, im)
    pen.text((40, 30), t['title'], 36, bold=True)
    sz = 560
    for i, (arr, lab, col) in enumerate(((off, t['off'], rc.DIM), (on, t['on'], rc.GREEN))):
        x = 40 + i * (sz + 30)
        pen.text((x, 92), lab, 21, col, True)
        im.paste(Image.fromarray(arr).resize((sz, sz), Image.LANCZOS), (x, 126))
        pen.d.rectangle((x - 1, 125, x + sz, 126 + sz), outline=col, width=2)
    pen.text((40, 126 + sz + 12), t['note'], 17, rc.DIM)
    # plot 1: shadow alphas by radius (along the top half, v < 0, so the floor shade is 0 there: drawn for v > dy)
    px0 = 1240
    pen.text((px0, 92), t['p1'], 20, rc.TXT, True)
    to = plot_axes(pen, (px0, 130, W - 40, 400), (0.0, 1.0), (0.0, 0.7), t['r'], 5)
    rr = np.linspace(0.0, 0.999, 400)
    FS, D, HW, FL = P.FACE_SHADOW, P.DISC, P.HUB_WELL, P.FLOOR_SHADE

    def sm(e0, e1, x):
        q = np.clip((x - e0) / (e1 - e0), 0, 1)
        return q * q * (3 - 2 * q)
    curves = [
        (FS['a'] * np.exp(-np.maximum(FS['r_wall'] - rr, 0) / FS['scale']), rc.RED, t['ao']),
        (np.where(rr > D['r'], FS['disc_a'] * np.exp(-np.maximum(rr - D['r'], 0) / FS['disc_scale']) * 0.75, 0), rc.VIOLET, t['disc']),
        (FL['a'] * (1 - sm(FL['r_out'] - FL['r_feather'], FL['r_out'] + FL['r_feather'], rr)), rc.BLUE, t['fl']),
        (HW['a'] * (1 - sm(HW['r_core'], HW['r_out'], rr)), rc.AMBER, t['hw']),
    ]
    for ys, col, lab in curves:
        pts = [to(x, y) for x, y in zip(rr, ys)]
        pen.d.line(pts, fill=col, width=3)
    ly = 450
    for ys, col, lab in curves:
        pen.d.line((px0, ly + 10, px0 + 30, ly + 10), fill=col, width=4)
        pen.text((px0 + 40, ly), lab, 16)
        ly += 26
    # plot 2: bezel gloss gain by angle
    py = 600
    pen.text((px0, py), t['p2'], 20, rc.TXT, True)
    to = plot_axes(pen, (px0, py + 38, W - 40, py + 250), (0.0, 360.0), (0.0, 1.2), t['deg'], 4)
    aa = np.linspace(0, 360, 721)
    g = draw.bezel_gain(aa)
    pen.d.line([to(x, y) for x, y in zip(aa, g)], fill=rc.TXT, width=3)
    gm = draw.bezel_gain((360 - aa) % 360)
    pen.d.line([to(x, y) for x, y in zip(aa, gm)], fill=rc.DIM, width=2)
    pen.text((px0, py + 300), t['g1'], 15)
    pen.text((px0, py + 324), t['g2'], 15, rc.DIM)
    # plot 3: the needle shadow sketch (geometry of shaders.js WBDIAL Comfort, R 335)
    ny = 960
    pen.text((40, ny - 120), t['p3'], 20, rc.TXT, True)
    R = 335.0
    Ls, T, W0, W1, WT = 0.925 * R, -0.22 * R, 0.024 * R, 0.0065 * R, 0.021 * R
    sc = 3.0
    cx, cy = 40 + int(0.22 * R * sc) + 24, ny - 30

    def blade(ox, oy):
        pts = []
        for s in np.linspace(T, Ls, 60):
            hw = (W0 + (WT - W0) * (s / T)) if s < 0 else (W0 + (W1 - W0) * (s / Ls))
            pts.append((cx + (s + ox) * sc, cy - hw * sc + oy * sc))
        for s in np.linspace(Ls, T, 60):
            hw = (W0 + (WT - W0) * (s / T)) if s < 0 else (W0 + (W1 - W0) * (s / Ls))
            pts.append((cx + (s + ox) * sc, cy + hw * sc + oy * sc))
        return pts
    sh = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh).polygon(blade(0.012 * R, 0.020 * R), fill=int(255 * 0.7))
    sh = sh.filter(ImageFilter.GaussianBlur(0.006 * R * sc))
    base = Image.new('RGB', (W, H), (70, 74, 84))
    comp = Image.composite(Image.new('RGB', (W, H), (0, 0, 0)), base, sh)
    nd = ImageDraw.Draw(comp)
    nd.polygon(blade(0, 0), fill=(214, 40, 30), outline=(250, 235, 230))
    box = (40, ny - 95, 1180, ny + 35)
    im.paste(comp.crop(box), box[:2])
    pen.d.rectangle((box[0] - 1, box[1] - 1, box[2], box[3]), outline=rc.LINE, width=1)
    pen.text((40, ny + 50), t['n1'], 17)
    pen.text((40, ny + 76), t['n2'], 17, rc.DIM)
    im.save(os.path.join(OUT, 'shading_%s.png' % lang))


def main():
    os.makedirs(OUT, exist_ok=True)
    layers = render(4)
    ship = rc.scene_rgba(REPO, 'f30_cluster', 'speedo')
    # the bench frame's speedo: the dial layer's box (77, 45, 670, 670)
    bench = Image.open(BENCH).convert('RGB').resize((1920, 720))
    bench_crop = bench.crop((77, 45, 747, 715))
    for lg in ('uk', 'en'):
        dial_elements(lg, layers, ship, bench_crop)
    on = compose(layers, [k for k, _ in ORDER])
    # "off": no shadow / glow layers, and no light model (lit() flat, no rim modulation, a flat bezel)
    saved = copy.deepcopy((P.LIGHT, P.BEZEL, P.BEZEL_INNER_RIM))
    P.LIGHT['rim_mod'] = 0.0
    P.BEZEL['lobes'] = []
    P.BEZEL['base'] = 0.5
    P.BEZEL_INNER_RIM['a'] = 0.0
    flat = draw.render_all(4)
    P.LIGHT.update(saved[0]); P.BEZEL.update(saved[1]); P.BEZEL_INNER_RIM.update(saved[2])
    off = compose(flat, [k for k, (fn, z, kind) in ORDER if kind not in ('shadow', 'glow')])
    for lg in ('uk', 'en'):
        shading(lg, on, off)
    print('ok')


if __name__ == '__main__':
    main()
