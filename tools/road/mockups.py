"""tools/road: the Road View mockup park (round "Road View", package TD; docs/traffic/TD-REPORT.md).

    UV_CACHE_DIR=$F30/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl \\
        python -I tools/road/mockups.py [--out bake/work/road/park]

Reads the REAL apps' bench pictures that tools/road/shots.py made (bake/work/road/shots/<app>/: every state of the built test modes,
day / night, uk / en, km/h / mph, BMW's areas outlined) and adds what is not built: for each theme and each function three
directions that differ in idea, the non-built ones painted onto the real bench frame with the SAME shaders (shared/road_shaders.js
on the Mac's GPU through rv_gl.py) or, for a plan view, with plain shapes. Then state sheets, a collision sheet, one contact sheet
per theme and index.html listing every picture with its path.

Rules every picture keeps: our own drawings only (no maker's artwork, font or name; the reference photos are not read); red only
in the light's lamp or a real sign's own red; no "go", no countdown, no speed advice: the advice line's place is shown only as a
dashed box marked "needs a data source we do not have". Output: bake/work/road/park/ (git-ignored).
"""
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import rv_gl as G   # noqa: E402
import paint as PT  # noqa: E402

SHOTS = os.path.join(ROOT, 'bake', 'work', 'road', 'shots')
SIGN_ORDER = ['noOvertaking', 'noOvertakingEnd', 'town', 'townEnd', 'motorway', 'motorwayEnd', 'expressway', 'expresswayEnd', 'envZone', 'envZoneEnd', 'stop', 'giveWay', 'priority', 'priorityEnd', 'noEntry', 'crossing', 'children', 'roadWorks', 'lightAhead', 'levelCrossing', 'slippery', 'animals']
FONT = os.path.join(ROOT, 'tools', 'fonts-src', 'NotoSans-wght.subset.ttf')
AA = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(ROOT))), 'bake', 'work', 'r1120', 'pub', 'AA', 'context')   # the main checkout's AA park


def arg(n, d=None):
    return sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d


OUT = arg('--out') or os.path.join(ROOT, 'bake', 'work', 'road', 'park')
_F = {}


def font(sz, bold=False):
    k = (sz, bold)
    if k not in _F:
        f = ImageFont.truetype(FONT, sz)
        try:
            f.set_variation_by_axes([650 if bold else 420])
        except Exception:
            pass
        _F[k] = f
    return _F[k]


BASE6 = os.path.join(ROOT, 'bake', 'work', 'road', 'base_f30_comfort.png')     # an earlier 6WB Comfort bench frame (limit 50, stopped at a light)


def f30_painted(name):
    """The built f30 states, painted with their own shaders at the engine's own layer boxes over BASE6 (shots.py's names)."""
    b = Image.open(BASE6).convert('RGB')
    if name in ('000_off', '200_limit_alone'):
        return b
    if name == '203_limit_light':
        return PT.strip6(b, ['light'], 'red')
    if name == '202_limit_rule_warning':
        return PT.strip6(b, ['giveWay', 'children'])
    if name.startswith('5') and '_scene_' in name:
        return PT.scene(b, '6wb', name.split('_scene_')[1])
    return None


def td_page(im, title='Дорога'):
    """Twin Dial's tab-1 page cleared and titled as road_ui.paintPage does (for the painted scene)."""
    d = ImageDraw.Draw(im)
    d.rectangle([729, 236, 1191, 293], fill=(0, 0, 0))
    d.rectangle([739, 300, 1181, 595], fill=(0, 0, 0))
    d.text((960, 281), title, font=font(41), fill=(255, 255, 255), anchor='ms')
    return im


def td_painted(name):
    if name.startswith('5') and '_scene_' in name:
        b = shot('twin_dial', '000_off')
        return PT.scene(td_page(b), 'td', name.split('_scene_')[1])
    return None


PAINTED = set()


def shot(app, name, clean=True):
    if app == 'f30_cluster' and not os.path.exists(os.path.join(SHOTS, app, name + '.clean.png')):
        PAINTED.add(app + ':' + name)
        return f30_painted(name)
    if app == 'twin_dial' and not os.path.exists(os.path.join(SHOTS, app, name + '.clean.png')) and name != '000_off':
        PAINTED.add(app + ':' + name)
        return td_painted(name)
    d = os.path.join(SHOTS, app)
    p = os.path.join(d, name + ('.clean.png' if clean else '.png'))
    if not os.path.exists(p):
        p = os.path.join(d, name + '.png')
    return Image.open(p).convert('RGB')


def over(base, rgba, x, y):
    """Straight float RGBA (h, w, 4) over the RGB image at x, y."""
    a = np.asarray(base).astype(np.float32) / 255.0
    h, w = rgba.shape[:2]
    reg = a[y:y + h, x:x + w]
    al = rgba[..., 3:4]
    a[y:y + h, x:x + w] = rgba[..., :3] * al + reg * (1 - al)
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype('uint8'))


def caption(im, title, lines, tag=None):
    """The picture with a caption strip under it: the direction's name, its idea, its status."""
    W = im.width
    H = 30 + 26 * len(lines) + 12
    c = Image.new('RGB', (W, im.height + H), (18, 20, 24))
    c.paste(im, (0, 0))
    d = ImageDraw.Draw(c)
    d.text((16, im.height + 8), title, font=font(24, True), fill=(240, 240, 240))
    if tag:
        tw = d.textlength(tag, font=font(22, True))
        col = (90, 200, 120) if tag.startswith('RECOMMENDED') else (120, 170, 230) if tag.startswith('BUILT') else (180, 180, 180)
        d.text((W - 16 - tw, im.height + 8), tag, font=font(22, True), fill=col)
    for i, l in enumerate(lines):
        d.text((16, im.height + 40 + 26 * i), l, font=font(19), fill=(190, 194, 200))
    return c


def dashed(d, box, col=(150, 150, 150), dash=6):
    x0, y0, x1, y1 = box
    for x in range(int(x0), int(x1), dash * 2):
        d.line([(x, y0), (min(x + dash, x1), y0)], fill=col)
        d.line([(x, y1), (min(x + dash, x1), y1)], fill=col)
    for y in range(int(y0), int(y1), dash * 2):
        d.line([(x0, y), (x0, min(y + dash, y1))], fill=col)
        d.line([(x1, y), (x1, min(y + dash, y1))], fill=col)


def advice(im, box, label_at):
    d = ImageDraw.Draw(im)
    dashed(d, box, (140, 140, 150))
    d.text(label_at, 'advice line: reserved, NOT drawn (needs a data source we do not have)', font=font(15), fill=(150, 150, 160))
    return im


# ---------------------------------------------------------------------------------------------- the shaders' own pictures
_GL = None


def gl():
    global _GL
    if _GL is None:
        _GL = G.GL()
    return _GL


ATL = {}


def atlas(app):
    if app not in ATL:
        ATL[app] = G.atlas(app)
    return ATL[app]


def strip6(items, w, h, light=(0, 0)):
    """rv_strip_6wb: items [(cx, cy, size, kind, sign id or None)] in a w x h layer."""
    a, j = atlas('f30_cluster')
    it = [(i[0], i[1], i[2], i[3]) for i in items] + [(0, 0, 0, 0)] * (3 - len(items))
    ce = [tuple(j['cells'][i[4]]) if i[4] else (0, 0, 0, 0) for i in items] + [(0, 0, 0, 0)] * (3 - len(items))
    return gl().render('rv_strip_6wb', w, h, {'u_it': it, 'u_ce': ce, 'u_lt': (light[0], light[1], 0, 0), 'u_asz': (j['w'], j['h']), 'u_k': (1, 0, 0, 0)}, tex={'u_atlas': ('f30', a)})


def stripTd(items, w, h, light=(0, 0), fg=(0.92, 0.92, 0.92)):
    a, j = atlas('twin_dial')
    it = [(i[0], i[1], i[2], i[3]) for i in items] + [(0, 0, 0, 0)] * (2 - len(items))
    ce = [tuple(j['cells'][i[4]]) if i[4] else (0, 0, 0, 0) for i in items] + [(0, 0, 0, 0)] * (2 - len(items))
    return gl().render('rv_strip_td', w, h, {'u_it': it, 'u_ce': ce, 'u_lt': (light[0], light[1], 0, 0), 'u_asz': (j['w'], j['h']), 'u_fg': fg, 'u_k': (1, 0, 0, 0)}, tex={'u_atlas': ('td', a)})


# ---------------------------------------------------------------------------------------------- a plan view (painted)
def plan_view(im, box, look):
    """Direction R2: the road from above: lane lines as vertical strokes, our car at the foot, the others as rounded boxes."""
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = box
    cx = (x0 + x1) / 2
    k = (x1 - x0) / 16.0            # px a metre across, 16 m wide
    m = (y1 - y0) / 70.0            # px a metre along, 70 m ahead
    line = (230, 230, 230) if look == 'td' else (205, 205, 205)
    dim = (140, 144, 150) if look == 'td' else (120, 120, 120)
    if look == '6wb':
        d.rectangle([cx - 5.25 * k, y0, cx + 5.25 * k, y1], fill=(28, 28, 30))
    for yy, kind in ((5.25, 'edge'), (1.75, 'dash'), (-1.75, 'dash'), (-5.25, 'edge')):
        x = cx - yy * k
        if kind == 'edge':
            d.line([(x, y0), (x, y1)], fill=dim, width=2)
        else:
            for s in range(0, int(y1 - y0), 22):
                d.line([(x, y0 + s), (x, min(y1, y0 + s + 11))], fill=line, width=2)

    def car(xm, ym, col, outline=False, L=4.6, Wd=1.85):
        px, py = cx - ym * k, y1 - xm * m
        b = [px - Wd / 2 * k, py - L * m, px + Wd / 2 * k, py]
        if outline:
            d.rounded_rectangle(b, radius=6, outline=col, width=2)
        else:
            d.rounded_rectangle(b, radius=6, fill=col)
            d.rectangle([b[0] + 3, b[1] + L * m * 0.28, b[2] - 3, b[1] + L * m * 0.42], fill=(20, 20, 22))
    car(6, 0, dim, outline=True)
    car(30, 0, line)
    car(22, 3.5, dim, L=8, Wd=2.4)
    car(44, -3.5, dim)
    car(9, -3.5, dim)
    return im


# ---------------------------------------------------------------------------------------------- the directions
def directions():
    out = []
    # ======================== Twin Dial ========================
    base = shot('twin_dial', '200_limit_alone')
    # light
    p = shot('twin_dial', '203_limit_light')
    p = advice(p, (1252, 704, 1380, 719), (1000, 690))
    out.append(('td_light_A', caption(p, 'Twin Dial · traffic light · A: the light beside the limit sign', [
        'The camera\'s light in thin lines right of our limit sign (1352..1376, 643..701): left of the gear gap, clear of the ring and of BMW\'s panel.',
        'Lamps are rings; only the lit one is filled. Uncertain = three hollow lamps, fainter. One layer on connection 2, 0 pixels. The advice line\'s place is shown only.'], 'RECOMMENDED · BUILT (Тест: світлофор)')))
    im = base.copy()
    im = over(im, stripTd([(32, 34, 62, 2, None)], 64, 68, light=(1, 0)), 1504, 250)
    out.append(('td_light_B', caption(im, 'Twin Dial · traffic light · B: the light in the speedometer\'s hub crown', [
        'Above the digital speed, where the vehicle-ahead pictogram lives (64 x 68 at 1504, 250): in the eye line, on every tab.',
        'Against: it takes the vehicle-ahead pictogram\'s place, and it sits far from the limit sign it belongs with.'], 'DIRECTION · painted with the shader')))
    p = shot('twin_dial', '503_scene_lightRed')
    out.append(('td_light_C', caption(p, 'Twin Dial · traffic light · C: the light in the road scene, over our lane', [
        'The light far ahead above our lane, in the scene\'s own space (built into the scene shader). Shown only on tab 1 while the scene test runs.',
        'The camera\'s PositionX/Y could place it once their scale is known; a stop line has no source (mockup idea only).'], 'BUILT inside the scene')))
    # signs
    p = shot('twin_dial', '202_limit_rule_warning')
    out.append(('td_signs_A', caption(p, 'Twin Dial · signs · A: the bottom line right of the gear gap', [
        'Rule then warning, 48 px each at (1496, 690) and (1560, 690), flat with a thin keyline. With a light: light + one sign. At most three with the limit.',
        'Clear of BMW\'s panel, the gear gap, the side lamps; nothing near BMW\'s message machine.'], 'RECOMMENDED · BUILT (Тест: знаки)')))
    im = base.copy()
    im = over(im, stripTd([(28, 28, 50, 1, 'stop'), (90, 28, 50, 1, 'children')], 120, 56), 1478, 258)
    out.append(('td_signs_B', caption(im, 'Twin Dial · signs · B: a pair in the speedometer\'s hub crown', [
        'Two small signs above the digital speed: seen with the speed, apart from the limit sign at the bottom.',
        'Against: splits the sign family over two places; collides with the vehicle-ahead pictogram and the cruise readout C1.'], 'DIRECTION · painted with the shader')))
    im = shot('twin_dial', '000_off')
    d = ImageDraw.Draw(im)
    d.rectangle([729, 300, 1191, 595], fill=(0, 0, 0))
    im = over(im, stripTd([(72, 60, 100, 1, 'noOvertaking'), (190, 60, 100, 1, 'children')], 260, 120), 830, 360)
    d = ImageDraw.Draw(im)
    d.text((960, 520), 'знаки в силі', font=font(30), fill=(200, 200, 200), anchor='mm')
    out.append(('td_signs_C', caption(im, 'Twin Dial · signs · C: a page card on tab 1 ("знаки в силі")', [
        'Big signs on the centre page: the most legible, room for a caption through shared/lang.js.',
        'Against: it takes tab 1 away from the trip pages and is seen only on that tab.'], 'DIRECTION · painted')))
    # scene
    p = shot('twin_dial', '502_scene_traffic')
    out.append(('td_scene_A', caption(p, 'Twin Dial · road scene · A (route b): the theme draws it on tab 1, one effect layer', [
        'Lanes in perspective, the road users as flat rear views (the one ahead brighter), the rear radars\' neighbours at our foot, our car as an outline.',
        '1 layer (connection 1: 4 -> 5), 0 pixel memory, about 0.6 KB of uniforms a change at most 10 a second. Hidden on other tabs and behind any message card.'], 'RECOMMENDED · BUILT (Тест: сцена дороги)')))
    im = shot('twin_dial', '000_off')
    d = ImageDraw.Draw(im)
    d.rectangle([739, 300, 1181, 592], fill=(0, 0, 0))
    im = plan_view(im, (800, 310, 1120, 590), 'td')
    out.append(('td_scene_B', caption(im, 'Twin Dial · road scene · B: a plan from above', [
        'Lanes as straight strokes, every road user as a box at its distance: easy to read gaps beside us.',
        'Against: less like the road the driver sees; a curve reads poorly; no place for a light over the lane.'], 'DIRECTION · painted')))
    aa = os.path.join(AA, 'E_04_twin_day.png')
    if os.path.exists(aa):
        im = Image.open(aa).convert('RGB')
        out.append(('td_scene_C', caption(im, 'Twin Dial · road scene · C (route a): the map window W2 opens, ACC View draws on "map"', [
            'ACC View\'s own picture (round 1120 AA, its park: bake/work/r1120/pub/AA/context/E_04_twin_day.png), seen through Twin Dial\'s window.',
            'Costs Twin Dial nothing, but needs a second app running, the map slot (a take-over race BMW wins ~30 % of the time) and it pushes BMW\'s map aside.'], 'DIRECTION · ACC View\'s picture')))
    # ======================== f30_cluster ========================
    base6 = shot('f30_cluster', '200_limit_alone')
    p = shot('f30_cluster', '203_limit_light')
    p = advice(p, (420, 556, 520, 572), (300, 690))
    out.append(('f30_light_A', caption(p, 'f30 6WB · traffic light · A: the second place of the 6WB sign row', [
        'A printed, slightly glossy housing in the no-overtaking sign\'s place (x 429..517): beside the limit, where the 6WB shows its signs.',
        'While it shows, the theme\'s own no-overtaking sign moves to the narrow third place. One layer on f30\'s 4th connection, 0 pixels.'], 'RECOMMENDED · BUILT (Тест: світлофор)')))
    im = base6.copy()
    im = over(im, strip6([(53, 49.5, 88, 1, 'stop'), (122, 49.5, 46, 2, None)], 152, 100, light=(1, 0)), 420, 456)
    out.append(('f30_light_B', caption(im, 'f30 6WB · traffic light · B: always the narrow third place', [
        'The light never moves a sign: rules keep the second place, the light is a narrow 46 px housing right of them.',
        'Against: the most momentary item is the smallest and the farthest from the limit; the "260" figure is 5 px away.'], 'DIRECTION · painted with the shader')))
    im = shot('f30_cluster', '000_off')
    im = over(im, strip6([(60, 80, 150, 2, None)], 120, 160, light=(1, 0)), 900, 240)
    out.append(('f30_light_C', caption(im, 'f30 6WB · traffic light · C: a large lamp column in the centre window', [
        'The 6WB\'s centre "info display" holds one big light above the horizon: unmistakable at a glance.',
        'Against: only in Comfort, only while BMW\'s map is not shown there; a large red disc in the middle of the cluster draws the eye too much.'], 'DIRECTION · painted with the shader')))
    p = shot('f30_cluster', '202_limit_rule_warning')
    out.append(('f30_signs_A', caption(p, 'f30 6WB · signs · A: the second and the narrow third place of the sign row', [
        'A rule at the 6WB\'s own size (88 px, printed), a warning at 40 px right of it; no overtaking from the limit\'s own event first.',
        'In every 6WB layout (Comfort, Sport, Eco Pro, Dials + G20); clear of BMW\'s own sign place in Dials + G20.'], 'RECOMMENDED · BUILT (Тест: знаки)')))
    im = shot('f30_cluster', '000_off')
    im = over(im, strip6([(60, 50, 88, 1, 'noOvertaking'), (160, 50, 88, 1, 'stop'), (260, 50, 88, 1, 'children')], 320, 100), 800, 340)
    out.append(('f30_signs_B', caption(im, 'f30 6WB · signs · B: a shelf of signs in the centre window', [
        'Three signs side by side above the horizon, like a sign gantry.',
        'Against: apart from the limit; only in Comfort without BMW\'s map; the centre is then busy with signs most of the time.'], 'DIRECTION · painted with the shader')))
    im = base6.copy()
    im = over(im, strip6([(53, 49.5, 88, 1, 'stop')], 152, 100), 420, 456)
    out.append(('f30_signs_C', caption(im, 'f30 6WB · signs · C: one place only, the most important sign', [
        'Exactly the 6WB\'s two signs: the limit and one more (light > point rule > stretch rule > warning).',
        'Calmest; a warning never shows while a rule is in force. A config value of the built strip (max 2) if the owner prefers it.'], 'DIRECTION · painted with the shader')))
    p = shot('f30_cluster', '502_scene_traffic')
    out.append(('f30_scene_A', caption(p, 'f30 6WB · road scene · A: the centre window above the horizon (6WB Comfort)', [
        'The 6WB\'s printed greys over a soft road surface between the dials (760..1160, 168..448). Only in 6WB Comfort, and only while BMW\'s map is not shown there.',
        'Dials + G20: none (its centre is BMW\'s own). 1 layer on the 4th connection, 0 pixel memory.'], 'RECOMMENDED · BUILT (Тест: сцена дороги)')))
    im = shot('f30_cluster', '000_off')
    im = plan_view(im, (820, 180, 1100, 440), '6wb')
    out.append(('f30_scene_B', caption(im, 'f30 6WB · road scene · B: a plan from above in the centre window', [
        'The F30\'s own lane-departure pictures were plans; reads the gaps beside us well.',
        'Against: a different language from the perspective dials; no light over the lane.'], 'DIRECTION · painted')))
    im = shot('f30_cluster', '000_off')
    d = ImageDraw.Draw(im)
    for i, (y, a) in enumerate(((410, 0.9), (395, 0.6), (383, 0.45))):
        d.line([(940 - 20 + i * 6, y), (980 + 20 - i * 6, y)], fill=tuple(int(c * a) for c in (220, 220, 220)), width=3)
    d.rounded_rectangle([944, 340, 976, 362], radius=6, fill=(215, 215, 215))
    d.rounded_rectangle([944, 420, 976, 442], radius=6, outline=(150, 150, 150), width=2)
    out.append(('f30_scene_C', caption(im, 'f30 6WB · road scene · C: no scene, a small "car ahead" pictogram only', [
        'Keeps the 6WB look whole: the vehicle-ahead pictogram (as Twin Dial\'s) above the horizon, nothing else.',
        'Shows no lanes, no neighbours, no light: the least information.'], 'DIRECTION · painted')))
    return out


# ---------------------------------------------------------------------------------------------- the sheets
def sheet(title, tiles, cols, tw):
    """tiles: [(label, PIL image)] -> one sheet."""
    tiles = [(l, im.resize((tw, int(im.height * tw / im.width)), Image.LANCZOS)) for l, im in tiles]
    th = max(im.height for _, im in tiles) + 28
    rows = (len(tiles) + cols - 1) // cols
    W, Hh = cols * (tw + 12) + 12, rows * (th + 12) + 60
    s = Image.new('RGB', (W, Hh), (14, 15, 18))
    d = ImageDraw.Draw(s)
    d.text((12, 14), title, font=font(26, True), fill=(235, 235, 235))
    for i, (l, im) in enumerate(tiles):
        x, y = 12 + (i % cols) * (tw + 12), 60 + (i // cols) * (th + 12)
        s.paste(im, (x, y))
        d.text((x, y + im.height + 4), l, font=font(16), fill=(185, 188, 194))
    return s


def rows(app):
    return json.load(open(os.path.join(SHOTS, app, 'shots.json')))


def crop(app, r, k):
    p = os.path.join(ROOT, r['crops'][k]) if r.get('crops', {}).get(k) else None
    return Image.open(p).convert('RGB') if p and os.path.exists(p) else None


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []

    def save(name, im, what):
        p = os.path.join(OUT, name + '.png')
        im.save(p, optimize=True)
        index.append((os.path.relpath(p, ROOT), what))
        print(os.path.relpath(p, ROOT))
    for name, im in directions():
        save('dir_' + name, im, im and name)
    CROP = {'twin_dial': {'strip': (1230, 600, 1640, 720), 'scene': (729, 248, 1191, 600)}, 'f30_cluster': {'strip': (280, 440, 640, 580), 'scene': (700, 140, 1220, 480)}}

    def cr(app, im, k):
        b = CROP[app][k]
        c = im.crop(b)
        return c.resize((c.width * 2, c.height * 2), Image.LANCZOS)
    LSTATES = [('red', None), ('redAmber', None), ('amber', None), ('green', None), ('green', 'left'), ('green', 'straight'), ('green', 'right'), ('flashAmber', None), ('uncertain', None)]
    for app, tag in (('twin_dial', 'Twin Dial'), ('f30_cluster', 'f30 6WB Comfort')):
        R = rows(app) if os.path.exists(os.path.join(SHOTS, app, 'shots.json')) else []
        bench = ' (bench, the real app; raw camera codes fed)' if R else ' (painted with the shaders at the engine\'s layer boxes over a 6WB Comfort bench frame)'
        lt = [(r['name'][4:], crop(app, r, 'strip')) for r in R if r['name'].startswith('1') and '_light_' in r['name']]
        sg = [(r['name'][4:], crop(app, r, 'strip')) for r in R if r['name'].startswith('3')]
        cb = [(r['name'][4:], crop(app, r, 'strip')) for r in R if r['name'].startswith('2') or r['name'].startswith('4')]
        if app == 'f30_cluster' and (len(lt) < 9 or len(sg) < 10 or len(cb) < 8):
            bench = ' (painted with the shaders at the engine\'s layer boxes over a 6WB Comfort bench frame)'
            b6 = Image.open(BASE6).convert('RGB')
            lt = [(st + (':' + ar if ar else ''), cr(app, PT.strip6(b6, ['light'], st, ar), 'strip')) for st, ar in LSTATES]
            sg = [(sid, cr(app, PT.strip6(b6, [sid]), 'strip')) for sid in SIGN_ORDER]
            cb = [('limit alone', cr(app, b6, 'strip')), ('limit + rule', cr(app, PT.strip6(b6, ['stop']), 'strip')),
                  ('limit + rule + warning', cr(app, PT.strip6(b6, ['giveWay', 'children']), 'strip')), ('limit + light', cr(app, PT.strip6(b6, ['light'], 'red'), 'strip')),
                  ('no overtaking (limit event) + light: it moves to the third place', cr(app, PT.strip6(b6, ['light', 'noOvertaking'], 'amber'), 'strip')),
                  ('night: light + rule', cr(app, PT.strip6(b6, ['light', 'noOvertaking'], 'red', night=0.82), 'strip'))]
            nm = Image.open(os.path.join(ROOT, 'bake', 'work', 'road', 'base_f30_nopass.png')).convert('RGB')
            cb.append(('the 6WB\'s own no-overtaking sign (BMW style) stays in B while no light shows', cr(app, nm, 'strip')))
        save('state_%s_light' % app, sheet(tag + ' · the traffic light: every state' + bench, [x for x in lt if x[1] is not None], 3, 560), 'light states')
        save('state_%s_signs' % app, sheet(tag + ' · signs of the set beside the limit' + bench, [x for x in sg if x[1] is not None], 4, 420), 'signs')
        save('state_%s_strip' % app, sheet(tag + ' · the sign strip\'s combinations' + bench, [x for x in cb if x[1] is not None], 3, 560), 'strip combinations')
        sc = [(r['name'][4:], crop(app, r, 'scene')) for r in R if r['name'].startswith('5')]
        if len(sc) < 6:
            look = '6wb' if app == 'f30_cluster' else 'td'
            base = Image.open(BASE6).convert('RGB') if look == '6wb' else td_page(shot('twin_dial', '000_off'))
            sc = [(k, cr(app, PT.scene(base.copy(), look, k), 'scene')) for k in PT.SITUATIONS]
            sc.append(('traffic, night', cr(app, PT.scene(base.copy(), look, 'traffic', night=0.82, fg=(0.74, 0.74, 0.74), dim=(0.45, 0.46, 0.5)), 'scene')))
            stag = ' (painted with the scene shader at its layer box)'
        else:
            stag = bench
        save('state_%s_scene' % app, sheet(tag + ' · the road scene: empty, a vehicle ahead, traffic both sides (+ rear radars), light red, light green, no lane data, night' + stag, sc, 4, 440), 'scene situations')
        cl = [(r['name'][4:], Image.open(os.path.join(ROOT, r['png'])).convert('RGB')) for r in R if r['name'].startswith('6')]
        if cl:
            save('collisions_%s' % app, sheet(tag + ' · collisions with what lives nearby (cyan: BMW\'s areas; magenta: our layers)', cl, 2, 940), 'collision sheet')
        if R:
            allp = [(r['name'], Image.open(os.path.join(ROOT, r['png'])).convert('RGB')) for r in R]
            save('contact_%s' % app, sheet(tag + ' · every in-context bench picture (1920 x 720; cyan BMW, magenta ours)', allp, 4, 470), 'contact sheet')
            for r in R:
                index.append((r['png'], app + ' · ' + r['name'] + ' · items ' + ','.join(i.get('id', '') for i in (r['road'].get('items') or []))))
    if PAINTED:
        index.append(('-', 'painted (no bench picture yet): ' + ', '.join(sorted(PAINTED))))
    for app in ('f30_cluster', 'twin_dial'):
        p = os.path.join(ROOT, 'bake', 'work', 'road', 'atlas_%s.png' % app)
        if os.path.exists(p):
            shutil.copy(p, os.path.join(OUT, 'atlas_%s.png' % app))
            index.append((os.path.relpath(os.path.join(OUT, 'atlas_%s.png' % app), ROOT), app + ' · the sign atlas as baked (shown on dark, enlarged)'))
    html = ['<!doctype html><meta charset="utf-8"><title>Road View park</title><style>body{background:#111;color:#ddd;font:14px sans-serif}a{color:#9cf}td{padding:2px 8px}</style>',
            '<h1>Road View mockup park (TD)</h1><p>Directions first, then state sheets, collision and contact sheets, then every bench picture. Paths are relative to the repository root.</p><table>']
    for p, w in index:
        html.append('<tr><td><a href="../../../../%s">%s</a></td><td>%s</td></tr>' % (p, p, w))
    html.append('</table>')
    open(os.path.join(OUT, 'index.html'), 'w').write('\n'.join(html))
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
    print('%d pictures; index %s' % (len(index), os.path.relpath(os.path.join(OUT, 'index.html'), ROOT)))


if __name__ == '__main__':
    main()
