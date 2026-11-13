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
  g20_lut                                    256 x 20 RGBA8, sampled nearest: entries 0-7 (two rows each, x and y)
                                             the pointers' and needles' tip and tail (panel px x 16 in R, G) for the value 0..1 in 256
                                             steps (speedo, tacho, fuel, oil); entry 8 the rev band: per angle bin about
                                             the tacho's centre, the value there (16 bit) and the band's radius;
                                             entry 9 (car3 J) the tick ring's radius per image angle about each
                                             dial's centre, over -pi..pi (speedo in its first row, tacho in its second)

car3 J (2026-11-13, docs/CAR3-J-REPORT.md): the tacho bakes the stock layout's line under the mode label and covers
BMW's own bottom-row mode label (the centre one is ours now); the pointer glow is the simulation's angular wedge.
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


def composite(box, ids, face=None, holes=(), area=None):
    """Layers (bench manifest ids, night) over black in box (x0, y0, x1, y1): opaque over the gauge, see-through outside.
    The gauge's area is what `area`'s layers (default: all) and the face cover, holes filled: not the glow, which spills
    past the frame onto the minis."""
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
        if area is None or id_ in area:
            c[...] = np.maximum(c, s[..., 3])
    # the gauge's area: everything drawn plus the face, with its holes filled (flood from the box's edge)
    m = Image.fromarray(((cover > 0.03) * 255).astype(np.uint8))
    if face:
        ImageDraw.Draw(m).polygon([(px - x0, py - y0) for px, py in face], fill=255)
    m = m.filter(ImageFilterMax(3))                # closes 1 px gaps in the frame line, adds 1 px
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
        if kind == 'patch':                    # car3 J: the reverse, an opaque black box over a BMW item we redraw
            bx0, by0, bx1, by1 = g[0] - x0, g[1] - y0, g[2] - x0, g[3] - y0
            inn = np.clip(np.minimum(np.minimum(xx - bx0, bx1 - xx), np.minimum(yy - by0, by1 - yy)) + 0.5, 0, 1)
            rgb *= (1 - inn)[..., None]
            alpha = np.maximum(alpha, inn)
        elif kind == 'round':
            cx, cy, r = g[0] - x0, g[1] - y0, g[2]
            alpha *= np.clip(np.hypot(xx - cx, yy - cy) - r + 0.5, 0, 1)
        else:
            bx0, by0, bx1, by1 = g[0] - x0, g[1] - y0, g[2] - x0, g[3] - y0
            out = np.maximum(np.maximum(bx0 - xx, xx - bx1), np.maximum(by0 - yy, yy - by1))
            alpha *= np.clip(out + 0.5, 0, 1)
    rgba = np.concatenate([np.clip(rgb, 0, 1), alpha[..., None]], -1)
    return rgba


def placed(box, id_):
    """A layer in box's frame, straight RGBA (zero outside it)."""
    x0, y0, x1, y1 = box
    out = np.zeros((y1 - y0, x1 - x0, 4), np.float32)
    e, a = layer(id_)
    ox, oy = e['x'] - x0, e['y'] - y0
    sx0, sy0, dx0, dy0 = max(0, -ox), max(0, -oy), max(0, ox), max(0, oy)
    cw, ch = min(a.shape[1] - sx0, out.shape[1] - dx0), min(a.shape[0] - sy0, out.shape[0] - dy0)
    out[dy0:dy0 + ch, dx0:dx0 + cw] = a[sy0:sy0 + ch, sx0:sx0 + cw]
    return out


def mini_tex(box, line_id, fill_id, which=None):
    """A mini's two textures: its lines (straight alpha), and its fill as RGB over black with the mini's whole area in
    alpha (the shader shows the fill from 0 up to the needle, black above it). The fill's hard inner edge (the bench
    simulation's open point 3) is softened: the photos fade there."""
    from PIL import ImageFilter
    lines, fill = placed(box, line_id), placed(box, fill_id)
    fa = np.asarray(Image.fromarray((fill[..., 3] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), np.float32) / 255.0
    fa = np.minimum(fa * 1.25, fill[..., 3] > 0.02)
    m = Image.fromarray((((lines[..., 3] > 0.03) | (fill[..., 3] > 0.03)) * 255).astype(np.uint8)).filter(ImageFilterMax(3))
    if which:
        # car3 J: the area also takes in every place BMW's own needle can be (its inner end reached past the fill's
        # edge, so with our needle at another level, as when the tank sizes differ, a red stub of BMW's showed)
        dr = ImageDraw.Draw(m)
        for k in range(201):
            tp, tl = mini(which, k / 200.0)
            dr.line([(tp[0] - box[0], tp[1] - box[1]), (tl[0] - box[0], tl[1] - box[1])], fill=255,
                    width=int(round(V(P['fuel']['needle'])['w0'])) + 6)
    inv = Image.eval(m, lambda v: 255 - v)
    pad = Image.new('L', (m.width + 2, m.height + 2), 255)
    pad.paste(inv, (1, 1))
    ImageDraw.floodfill(pad, (0, 0), 128)
    area = (np.asarray(pad)[1:-1, 1:-1] != 128).astype(np.float32)
    area = np.asarray(Image.fromarray((area * 255).astype(np.uint8)).filter(ImageFilterBlur()), np.float32) / 255.0
    f = np.concatenate([fill[..., :3] * fa[..., None], area[..., None]], -1)
    return lines, f


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
    a = np.zeros((20, N, 4), np.uint8)
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
    # car3 J: entry 9, the tick ring's radius about each dial's centre per image angle (-pi..pi in 256 bins), for the
    # glow's depth window and the numerals' light (the simulation's ringTable; past the scale's ends: the end's)
    for row, key in ((0, 'speedo'), (1, 'tacho')):
        for k, r in enumerate(ring_radius(key, N)):
            a[18 + row, k, :2] = enc(r, 16)
    return a, psi0, psi1


def ring_radius(key, n=256):
    D = P[key]
    sc, C = V(D['scale']), V(D['centre'])
    th = np.unwrap([math.atan2(p[1] - C[1], p[0] - C[0]) for p in sc['pts']])
    rs = np.array([math.hypot(p[0] - C[0], p[1] - C[1]) for p in sc['pts']])
    if th[-1] < th[0]:
        th, rs = th[::-1], rs[::-1]
    out = []
    for k in range(n):
        t = -math.pi + 2 * math.pi * (k + 0.5) / n
        # the bin's angle in the scale's unwrapped range (or the nearer end)
        cands = [t + 2 * math.pi * j for j in (-1, 0, 1)]
        inside = [c for c in cands if th[0] <= c <= th[-1]]
        if inside:
            out.append(float(np.interp(inside[0], th, rs)))
        else:
            d0 = min(abs(c - th[0]) for c in cands)
            d1 = min(abs(c - th[-1]) for c in cands)
            out.append(float(rs[0] if d0 < d1 else rs[-1]))
    return out


def numeral_depths():
    """car3 J: px inside the tick ring of every dial numeral's ink-box corners (bake/src/G20 params/numerals.json)."""
    N = json.load(open(os.path.join(ROOT, 'bake', 'src', 'G20', 'structure', 'params', 'numerals.json')))
    rings = {k: ring_radius(k) for k in ('speedo', 'tacho')}
    out = []
    for it in N['items']:
        if it['text'] == 'km/h':
            continue
        C = V(P[it['dial']]['centre'])
        x0, y0, x1, y1 = it['ink_box']
        for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1), ((x0 + x1) / 2, (y0 + y1) / 2)):
            t = math.atan2(y - C[1], x - C[0])
            k = min(255, max(0, int((t + math.pi) / (2 * math.pi) * 256)))
            out.append(rings[it['dial']][k] - math.hypot(x - C[0], y - C[1]))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    face = V(P['glow']['face'])
    sign = ('round', (539, 622, 46))               # BMW's speed-limit sign (design/overlay, wb_dials' window)
    info = ('box', (1250, 585, 1276, 633))         # its check-control "i" left of the tacho
    # car3 J: BMW's bottom-row mode label (design/overlay assist.mode_label, under; drawn while a theme is connected)
    # covered: ours sits in the tacho's centre as in the stock layout. Clear of the check-control panel's slanted
    # right edge (x 1240 -> 1107, y 650 -> 691) and of the gear letter (x 1398).
    mode_patch = ('patch', (1224, 657, 1364, 714))
    boxes = {
        'speedo': ((76, 30, 760, 656), ['speedo.glow', 'speedo.wing', 'speedo.frame', 'speedo.bottom_end', 'speedo_info_line',
                                        'speedo_numerals', 'speedo_scale_label'], face['speedo'], [sign],
                   ['speedo.frame', 'speedo.bottom_end']),
        # car3 J: + the line under the mode label and gear (the stock layout's; BMW drops it while a theme is on)
        'tacho': ((1158, 33, 1842, 714), ['tacho.glow', 'tacho.wing', 'tacho.frame', 'tacho.bottom_end', 'rev_band',
                                          'tacho_info_line', 'tacho_numerals', 'tacho_zero'], face['tacho'],
                  [info, mode_patch], ['tacho.frame', 'tacho.bottom_end', 'rev_band', 'tacho_info_line']),
    }
    geo = {}
    for name, (box, ids, fc, holes, area) in boxes.items():
        save(name, composite(box, ids, fc, holes, area))
        geo[name] = {'box': list(box)}
    # the minis: the lines (straight alpha) and, apart, the level's fill, lit live from 0 up to the needle
    for name, box in (('fuel', (6, 428, 204, 654)), ('oil', (1718, 432, 1913, 654))):
        lines, fill = mini_tex(box, name + "_mini", name + "_mini.fill", name)
        save(name, lines)
        save(name + '_fill', fill)
        geo[name] = {'box': list(box)}
    a, psi0, psi1 = lut()
    save('lut', a.astype(np.float32) / 255.0, 'nearest')
    B, G = P['bar'], P['glow']
    # car3 J: where the dial numerals lie inside the tick ring (px), for G20DIAL's numeral light
    nq = numeral_depths()
    print('numerals inside the tick ring: %.1f .. %.1f px' % (min(nq), max(nq)))
    geo.update({
        'speedoC': V(P['speedo']['centre']), 'tachoC': V(P['tacho']['centre']),
        'band': {'psi': [psi0, psi1], 'width': V(P['tacho']['band'])['width'], 'rgb': V(P['tacho']['band'])['rgb']},
        'bar': {'width': V(B['width']), 'rgb': V(B['rgb'])['night'], 'rim': V(B['rim']), 'shadow': V(B['shadow'])},
        # car3 J: the simulation's glow (live.js drawGlow): an angular wedge about the dial's centre, sigma in degrees
        # on the higher / lower value side, full from the tick ring in to q0 px, a smoothstep to 0 at q1 (the port
        # before took sigma_hi as px round the bar: a thin smear)
        'glow': {'rgb': [c * V(G['gain']) for c in V(G['rgb'])['night']], 'sigma': V(G['sigma_hi']),
                 'sigmaLo': V(G['sigma_lo']), 'q': [V(G['q0']), V(G['q1'])], 'qIn': V(G['q_in'])},
        # car3 J: the band line by the pointer lit pink-white (39); sigma on the higher / lower value side (deg) and
        # strength. Weak: one pointer position per dial was photographed
        'bandLight': [28.0, 15.0, 0.85],
        # car3 J: the numeral by the pointer is lit to white (39: the speedo's 0 at 238, the tacho's 1 at 217 with
        # the pointer 7 deg from it, its 0 at 177 21 deg away; the others 162-179): gain over the grey, the angular
        # sigma (deg), and the depth band (px inside the tick ring) where numerals lie: from 19 px, clear of the
        # ticks' inner ends (the grey minor ticks would pass for numerals); the top numerals' outer corners (260 and 7,
        # from 7 px) are left out
        'numLight': {'gain': round(1 / 0.68 - 1, 3), 'sigma': 8.0, 'q': [19.0, round(max(nq) + 3, 1)]},
        'needle': V(P['fuel']['needle']), 'oilRange': V(P['oil']['range_c']),
    })
    json.dump(geo, open(GEO, 'w'), indent=1)
    print('geometry ->', os.path.relpath(GEO, ROOT))


if __name__ == '__main__':
    main()
