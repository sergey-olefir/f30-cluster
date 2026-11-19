"""Product-style shots and comparison sheets from our own bench renders (no photos, no BMW artwork).
Usage: python -I compose.py <repo> <images_dir> <config.json>
config: {"hero": {"f30": png, "twin": png}, "pair": {"before": png, "after": png}, "evolution": [[png, ver, date], ...],
         "states": [[png, label_uk, label_en], ...]}"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO, OUT, CFG = sys.argv[1:4]
cfg = json.load(open(CFG))
OUT = os.path.abspath(OUT)
REPO = os.path.abspath(REPO)
os.chdir(REPO)                 # revision 4: compose.json paths are relative to the repository root
FONT = os.path.join(REPO, 'tools', 'fonts-src', 'Arimo[wght].ttf')
TXT, DIM, AMBER = (232, 235, 240), (150, 158, 170), (240, 170, 10)


def font(size, bold=False):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_name('Bold' if bold else 'Regular')
    except Exception:
        pass
    return f


def backdrop(W, H):
    """a neutral studio gradient, darker at the edges"""
    g = Image.new('RGB', (W, H))
    px = g.load()
    for y in range(H):
        for x in range(0, W, 1):
            dx, dy = (x - W / 2) / (W / 2), (y - H * 0.45) / (H / 2)
            v = max(0.0, 1 - 0.55 * (dx * dx + dy * dy))
            c = int(14 + 22 * v)
            px[x, y] = (c, c + 1, c + 4)
    return g


def product(render, W=2000, sw=1680, top=None, bg=True):
    """the render inside a drawn, neutral cluster surround with a soft shadow"""
    r = Image.open(render).convert('RGB')
    sh_ = int(sw * r.size[1] / r.size[0])
    r = r.resize((sw, sh_), Image.LANCZOS)
    pad, bz = 70, 26
    H = sh_ + 2 * bz + 2 * pad + (top or 0)
    im = backdrop(W, H).convert('RGBA') if bg else Image.new('RGBA', (W, H), (0, 0, 0, 0))
    x0, y0 = (W - sw) // 2 - bz, pad + (top or 0)
    x1, y1 = x0 + sw + 2 * bz, y0 + sh_ + 2 * bz
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x0 + 6, y0 + 26, x1 - 6, y1 + 30), 60, fill=(0, 0, 0, 200))
    im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(28)))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((x0, y0, x1, y1), 56, fill=(9, 9, 11, 255), outline=(58, 61, 68, 255), width=3)
    d.rounded_rectangle((x0 + 5, y0 + 5, x1 - 5, y1 - 5), 52, outline=(26, 27, 31, 255), width=2)
    # screen with rounded corners
    m = Image.new('L', r.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, sw - 1, sh_ - 1), 34, fill=255)
    im.paste(r, (x0 + bz, y0 + bz), m)
    return im


def hero():
    for key, path in cfg['hero'].items():
        product(path).convert('RGB').save(os.path.join(OUT, 'hero-%s.png' % key))
    # both, stacked, for the article's lead picture
    a = product(cfg['hero']['f30'], 1800, 1500, bg=False)
    b = product(cfg['hero']['twin'], 1800, 1500, bg=False)
    H = a.size[1] + b.size[1] - 70
    im = backdrop(1800, H).convert('RGBA')
    im.alpha_composite(a, (0, 0))
    im.alpha_composite(b, (0, a.size[1] - 70))
    im.convert('RGB').save(os.path.join(OUT, 'hero-both.png'))


def labelled(paths_labels, title, out, cols=1, cw=1760, gap=26, size=28):
    ims = [(Image.open(p).convert('RGB'), l) for p, l in paths_labels]
    w = (cw - gap * (cols - 1)) // cols
    rows = (len(ims) + cols - 1) // cols
    h = int(w * 720 / 1920)
    lab = int(size * 1.9)
    top = 90 if title else 20
    W, H = cw + 80, top + rows * (h + lab + gap) + 20
    im = Image.new('RGB', (W, H), (17, 19, 23))
    d = ImageDraw.Draw(im)
    if title:
        d.text((40, 30), title, font=font(38, True), fill=TXT)
    for i, (r, l) in enumerate(ims):
        x = 40 + (i % cols) * (w + gap)
        y = top + (i // cols) * (h + lab + gap)
        d.text((x, y + 4), l, font=font(size, True), fill=AMBER)
        r = r.resize((w, h), Image.LANCZOS)
        im.paste(r, (x, y + lab))
        d.rectangle((x - 1, y + lab - 1, x + w, y + lab + h), outline=(58, 61, 68), width=2)
    im.save(out)


def pairs():
    for lang in ('uk', 'en'):
        p = cfg['pair']
        labelled([(p['before'], p['label_before'][lang]), (p['after'], p['label_after'][lang])],
                 p['title'][lang], os.path.join(OUT, 'twin-mockup-vs-app_%s.png' % lang))


def evolution():
    ev = cfg['evolution']
    for lang in ('uk', 'en'):
        rows = [(p, '%s · %s · %s' % (v, dt, note[lang])) for p, v, dt, note in ev]
        labelled(rows, cfg['evolution_title'][lang], os.path.join(OUT, 'evolution-f30_%s.png' % lang), cols=2, size=24)


def states():
    st = cfg['states']
    for lang in ('uk', 'en'):
        rows = [(p, l[lang]) for p, l in st]
        labelled(rows, cfg['states_title'][lang], os.path.join(OUT, 'states_%s.png' % lang), cols=2, size=24)


os.makedirs(OUT, exist_ok=True)
for part in sys.argv[4:] or ['hero', 'pairs', 'evolution', 'states']:
    globals()[part]()
print('ok')
