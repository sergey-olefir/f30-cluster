#!/usr/bin/env python3
"""The "G20 Comfort" theme's scene textures, from the bench simulation's own drawings (bench/g20/, docs/G20SIM-REPORT.md;
our drawing fitted to photos, no photo pixels):
    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python tools/bake_g20.py
writes apps/f30_cluster/hud/scene/g20_<name>.json = {w, h, rgba: base64[, sampling]} and prints the layout constants
design/gen_g20.py needs (also written to design/g20_geo.json).

  g20_speedo, g20_tacho, g20_fuel, g20_oil   each gauge's static night look (glow, face, frame, ticks, numerals) over
                                             black, opaque over the whole gauge so BMW's own pointer under it never
                                             shows; see-through elsewhere, and over BMW's speed-limit sign and its
                                             check-control "i" (they show through)
  g20_lut                                    256 x 18 RGBA8, sampled nearest: entries 0-7 (two rows each, x and y)
                                             the pointers' and needles' tip and tail (panel px x 16 in R, G) for the value 0..1 in 256
                                             steps (speedo, tacho, fuel, oil); entry 8 the rev band: per angle bin about
                                             the tacho's centre, the value there (16 bit) and the band's radius
"""
import base64, json, math, os
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
G20 = os.path.join(ROOT, 'bench', 'g20')
OUT = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'scene')
GEO = os.path.join(ROOT, 'design', 'g20_geo.json')


def V(x):
    return x['v'] if isinstance(x, dict) and 'v' in x and 'ev' in x else x


def params():
    s = open(os.path.join(G20, 'live', 'live.js')).read()
    return json.loads(s[s.index('/*<PARAMS>*/') + 12:s.index('/*</PARAMS>*/')])


P = params()
MAN = {e['id']: e for e in json.load(open(os.path.join(G20, 'structure', 'manifest.part.json')))['entries']}


def layer(id_):
    e = MAN['structure.%s.night' % id_]
    im = Image.open(os.path.join(G20, e['file'])).convert('RGBA')
    if e['scale'] != 1:
        im = im.resize((im.width * e['scale'], im.height * e['scale']), Image.BILINEAR)
    return e, np.asarray(im, dtype=np.float32) / 255.0


def composite(box, ids, face=None, holes=()):
    """Layers (bench manifest ids, night) over black in box (x0, y0, x1, y1): opaque over the gauge, see-through outside."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    rgb = np.zeros((h, w, 3), np.float32)
    cover = np.zeros((h, w), np.float32)
    for id_ in ids:
        e, a = layer(id_)
        ox, oy = e['x'] - x0, e['y'] - y0
        sx0, sy0 = max(0, -ox), max(0, -oy)
        dx0, dy0 = max(0, ox), max(0, oy)
        cw, ch = min(a.shape[1] - sx0, w - dx0), min(a.shape[0] - sy0, h - dy0)
        if cw <= 0 or ch <= 0:
            continue
        s = a[sy0:sy0 + ch, sx0:sx0 + cw]
        d = rgb[dy0:dy0 + ch, dx0:dx0 + cw]
        al = s[..., 3:4] * e.get('opacity', 1.0)
        if e.get('composite') == 'lighter':
            d += s[..., :3] * al
        else:
            d[...] = s[..., :3] * al + d * (1 - al)
        c = cover[dy0:dy0 + ch, dx0:dx0 + cw]
        c[...] = np.maximum(c, s[..., 3])
    # the gauge's area: everything drawn plus the face, with its holes filled (flood from the box's edge)
    m = Image.fromarray(((cover > 0.03) * 255).astype(np.uint8))
    if face:
        ImageDraw.Draw(m).polygon([(px - x0, py - y0) for px, py in face], fill=255)
    m = m.filter(ImageFilterMax(5))
    inv = Image.eval(m, lambda v: 255 - v)
    pad = Image.new('L', (w + 2, h + 2), 255)
    pad.paste(inv, (1, 1))
    ImageDraw.floodfill(pad, (0, 0), 128)
    outside = np.asarray(pad)[1:-1, 1:-1] == 128
    alpha = np.where(outside, 0.0, 1.0).astype(np.float32)
    # a soft 1 px edge
    alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilterBlur()), np.float32) / 255.0
    for kind, g in holes:                      # BMW's own items under us that must show: cut out
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        if kind == 'round':
            cx, cy, r = g[0] - x0, g[1] - y0, g[2]
            alpha *= np.clip(np.hypot(xx - cx, yy - cy) - r + 0.5, 0, 1)
        else:
            bx0, by0, bx1, by1 = g[0] - x0, g[1] - y0, g[2] - x0, g[3] - y0
            out = np.maximum(np.maximum(bx0 - xx, xx - bx1), np.maximum(by0 - yy, yy - by1))
            alpha *= np.clip(out + 0.5, 0, 1)
    rgba = np.concatenate([np.clip(rgb, 0, 1), alpha[..., None]], -1)
    return rgba


def ImageFilterMax(n):
    from PIL import ImageFilter
    return ImageFilter.MaxFilter(n)


def ImageFilterBlur():
    from PIL import ImageFilter
    return ImageFilter.BoxBlur(0.6)


def save(name, a, sampling=None):
    a = np.clip(np.round(a * 255.0), 0, 255).astype(np.uint8)
    h, w = a.shape[:2]
    j = {'w': w, 'h': h, 'rgba': base64.b64encode(a.tobytes()).decode('ascii')}
    if sampling:
        j['sampling'] = sampling
    json.dump(j, open(os.path.join(OUT, 'g20_' + name + '.json'), 'w'))
    print('g20_%-8s %4d x %-4d  %.2f MiB as an asset' % (name, w, h, w * h * 8 / 1048576.0))


# ------------------------------------------------------------------------------------------- pointer geometry
def lerp(a, b, t):
    return a + (b - a) * t


def ring_at(sc, x):
    vs = sc['values']
    x = min(max(x, vs[0]), vs[-1])
    i = 0
    while i < len(vs) - 2 and x > vs[i + 1]:
        i += 1
    t = (x - vs[i]) / ((vs[i + 1] - vs[i]) or 1)
    a, b = sc['pts'][i], sc['pts'][i + 1]
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]


def pointer(key, v):
    D = P[key]
    sc, C = V(D['scale']), V(D['centre'])
    pt = ring_at(sc, v)
    ux, uy = pt[0] - C[0], pt[1] - C[1]
    ul = math.hypot(ux, uy) or 1
    ux, uy = ux / ul, uy / ul
    beyond, L = V(D['beyond']), V(D['len'])['stock']
    tip = [pt[0] + ux * beyond, pt[1] + uy * beyond]
    return tip, [tip[0] - ux * L, tip[1] - uy * L]


def interp(xs, ys, x):
    if x <= xs[0]:
        return ys[0]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            return lerp(ys[i - 1], ys[i], (x - xs[i - 1]) / ((xs[i] - xs[i - 1]) or 1))
    return ys[-1]


def mini(which, f):
    F = P['fuel']
    R = V(F['ring'])
    ring = [interp(R['f'], [p[0] for p in R['pts']], f), interp(R['f'], [p[1] for p in R['pts']], f)]
    dg = math.radians(interp(V(F['dir'])['f'], V(F['dir'])['v'], f))
    ux, uy = math.cos(dg), math.sin(dg)
    ins, L = interp(V(F['inset'])['f'], V(F['inset'])['v'], f), interp(V(F['len'])['f'], V(F['len'])['v'], f)
    o = [ring[0] + ux * ins, ring[1] + uy * ins]
    i = [o[0] + ux * L, o[1] + uy * L]
    m = (lambda p: [1920 - p[0], p[1]]) if which == 'oil' else (lambda p: p)
    return m(o), m(i)                           # tip (the outer end, at the scale), tail (the inner end)


def enc(v, bits16):
    q = int(round(min(max(v, 0), 65535 / bits16) * bits16))
    return q >> 8, q & 255


def lut():
    N = 256
    # one number per texel, in R (high byte) and G (low byte), B 0, A 255: a texture loader may premultiply by alpha,
    # so no data rides in it. Entry e has two rows: 2e (x, or the first number) and 2e + 1 (y, or the second)
    a = np.zeros((18, N, 4), np.uint8)
    a[..., 3] = 255
    def put(e, k, u, v):
        a[2 * e, k, :2] = enc(u, 16)
        a[2 * e + 1, k, :2] = enc(v, 16)
    for k in range(N):
        f = k / (N - 1.0)
        rows = [pointer('speedo', f * 260.0), pointer('tacho', f * 7.0), mini('fuel', f), mini('oil', f)]
        for g, (tip, tail) in enumerate(rows):
            put(2 * g, k, *tip)
            put(2 * g + 1, k, *tail)
    # the rev band: the tick ring smoothed over +-2 ticks, pulled in by the band's depth along the ray from the centre
    D = P['tacho']
    sc, C, bd = V(D['scale']), V(D['centre']), V(D['band'])
    pts = sc['pts']
    sm = [[sum(pts[j][0] for j in range(max(0, i - 2), min(len(pts), i + 3))) / (min(len(pts), i + 3) - max(0, i - 2)),
           sum(pts[j][1] for j in range(max(0, i - 2), min(len(pts), i + 3))) / (min(len(pts), i + 3) - max(0, i - 2))]
          for i in range(len(pts))]
    ang = [math.atan2(p[1] - C[1], p[0] - C[0]) for p in sm]           # image atan2: falls from 0 (75 deg) to 7 (-127 deg)
    for i in range(1, len(ang)):                                          # strictly falling (the tick ends wobble)
        ang[i] = min(ang[i], ang[i - 1] - 1e-4)
    rad = [math.hypot(p[0] - C[0], p[1] - C[1]) - bd['depth'] for p in sm]
    psi0, psi1 = ang[0], ang[-1]
    for k in range(N):
        psi = lerp(psi0, psi1, k / (N - 1.0))
        # the scale's value at this angle (ang is monotonic) and the band's radius there
        j = 0
        while j < len(ang) - 2 and psi < ang[j + 1]:
            j += 1
        t = (psi - ang[j]) / ((ang[j + 1] - ang[j]) or 1)
        v = lerp(sc['values'][j], sc['values'][j + 1], t) / 7.0
        r = lerp(rad[j], rad[j + 1], t)
        put(8, k, v * 4095.0, r)
    return a, psi0, psi1


def main():
    os.makedirs(OUT, exist_ok=True)
    face = V(P['glow']['face'])
    sign = ('round', (539, 622, 46))               # BMW's speed-limit sign (design/overlay, wb_dials' window)
    info = ('box', (1250, 585, 1276, 633))         # its check-control "i" left of the tacho
    boxes = {
        'speedo': ((76, 30, 760, 656), ['speedo.glow', 'speedo.wing', 'speedo.frame', 'speedo.bottom_end', 'speedo_info_line',
                                        'speedo_numerals', 'speedo_scale_label'], face['speedo'], [sign]),
        'tacho': ((1158, 33, 1842, 656), ['tacho.glow', 'tacho.wing', 'tacho.frame', 'tacho.bottom_end', 'rev_band',
                                          'tacho_numerals', 'tacho_zero'], face['tacho'], [info]),
        'fuel': ((6, 428, 204, 654), ['fuel_mini.fill', 'fuel_mini'], None, []),
        'oil': ((1718, 432, 1913, 654), ['oil_mini.fill', 'oil_mini'], None, []),
    }
    geo = {}
    for name, (box, ids, fc, holes) in boxes.items():
        save(name, composite(box, ids, fc, holes))
        geo[name] = {'box': list(box)}
    a, psi0, psi1 = lut()
    save('lut', a.astype(np.float32) / 255.0, 'nearest')
    B, G = P['bar'], P['glow']
    geo.update({
        'speedoC': V(P['speedo']['centre']), 'tachoC': V(P['tacho']['centre']),
        'band': {'psi': [psi0, psi1], 'width': V(P['tacho']['band'])['width'], 'rgb': V(P['tacho']['band'])['rgb']},
        'bar': {'width': V(B['width']), 'rgb': V(B['rgb'])['night'], 'rim': V(B['rim'])},
        'glow': {'rgb': [c * V(G['gain']) for c in V(G['rgb'])['night']], 'sigma': V(G['sigma_hi'])},
        'needle': V(P['fuel']['needle']), 'oilRange': V(P['oil']['range_c']),
    })
    json.dump(geo, open(GEO, 'w'), indent=1)
    print('geometry ->', os.path.relpath(GEO, ROOT))


if __name__ == '__main__':
    main()
