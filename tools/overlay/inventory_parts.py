#!/usr/bin/env python3
"""Inventory of the G20 parts we already have as our own drawings: one record per part, linked to the catalogue.

    UV_CACHE_DIR=$F30_MAIN/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with jsonschema \
        python -I tools/overlay/inventory_parts.py [--no-measure] [--markdown]

Reads (read-only):
  bench/g20/manifest.json                    the bench simulation's 80 entries (packages B, C, D), docs/G20SIM-REPORT.md
  bench/g20/structure/*.png                  B's raster layers: size and alpha extent
  bench/g20/c.js                             C's lamps (the four housing LEDs) and the conditions of its texts
  apps/f30_cluster/hud/scene/g20_*.json, collar.json   the app's own textures ({w, h, rgba: base64}, straight alpha)
  apps/f30_cluster/hud/layouts/*.json        where the app places them (which layout uses which texture)
  design/g20_geo.json                        the boxes tools/bake_g20.py wrote (cross-check of the layout boxes)
  tools/bake_g20.py, tools/bake_scene.py     which sim layers each app texture is baked from (parsed, not run)
  design/overlay/g20_comfort.json            the catalogue (elements, bbox, poly, relation)
Writes:
  design/overlay/g20_parts.json              kind 'g20-parts' (schema.json), with the cross-check 'report'
  design/overlay/g20_comfort.json            only each element's 'parts' list and the new elements (tools/overlay/link_parts.py)
With --markdown it also prints the per-element table for docs/OVERLAY-REPORT.md.

Measuring (default; --no-measure keeps the previous file's numbers): the live parts (package D) have no box in the
manifest, so the overlay constructor renders every procedural part alone (?probe=parts, the same code path as its
'texture' mode, through the simulation's own entry points) in headless Chrome, and reports each part's alpha extent.
"""
import ast
import base64
import html
import importlib.util
import json
import os
import re
import subprocess
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
SIM = 'bench/g20'
SCENE = 'apps/f30_cluster/hud/scene'
LAYOUTS = 'apps/f30_cluster/hud/layouts'
CAT = 'design/overlay/g20_comfort.json'
OUT = 'design/overlay/g20_parts.json'
W, H = 1920, 720
SLACK = 2           # px: a disagreement smaller than this is measurement noise (README, G20SIM-REPORT section 5)

# The conditions under which C's texts are drawn, as written in bench/g20/c.js drawUnder / drawOver (the manifest
# gives them only for B's layers). Mirrored by the constructor's texture mode.
C_COND = {
    'c.assist.off': ('engine_off', "c.js: OFF when rpm < 200 or null"),
    'c.assist.tacho_zero': ('engine_on', "c.js: the tacho scale's '0' when rpm >= 200"),
    'c.assist.cold': ('cold_engine_running', 'c.js: COLD when oil < 40 degC and rpm >= 200'),
    'c.assist.speed_limit': ('limit_set', 'c.js: drawSign when s.limit > 0'),
    'c.assist.cc_panel': ('cc_message', 'c.js: drawCcPanel when s.ccMessage'),
    'c.bottom.cc_info': ('cc_message', "c.js: the 'i' is drawn by drawCcPanel"),
    'c.bottom.street': ('no_cc_message', 'c.js: the street when there is no check-control message'),
}


def rp(p):
    return os.path.join(ROOT, p)


def load(p):
    return json.load(open(rp(p)))


def alpha_extent(a, scale=1, ox=0, oy=0, thr=1):
    """a: alpha (h, w) uint8. Returns ([x0, y0, x1, y1] in panel px, exclusive) of alpha >= thr, and the count."""
    ys, xs = np.nonzero(a >= thr)
    if not len(xs):
        return None, 0
    return [int(ox + xs.min() * scale), int(oy + ys.min() * scale), int(ox + (xs.max() + 1) * scale),
            int(oy + (ys.max() + 1) * scale)], int(len(xs) * scale * scale)


def panel_mask(a, scale, ox, oy, thr=1):
    """Alpha (h, w) placed on the panel (bilinear upscale, as a GPU samples it), as bool where alpha >= thr."""
    m = np.zeros((H, W), bool)
    if scale != 1:
        a = np.asarray(Image.fromarray(a).resize((a.shape[1] * scale, a.shape[0] * scale), Image.BILINEAR))
    b = a >= thr
    h, w = b.shape
    x0, y0 = max(ox, 0), max(oy, 0)
    x1, y1 = min(ox + w, W), min(oy + h, H)
    if x1 > x0 and y1 > y0:
        m[y0:y1, x0:x1] = b[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    return m


def box_mask(b):
    m = np.zeros((H, W), bool)
    x0, y0, x1, y1 = [int(round(v)) for v in b]
    m[max(y0, 0):max(min(y1, H), 0), max(x0, 0):max(min(x1, W), 0)] = True
    return m


def element_mask(e):
    """The catalogue element's shape as in README section 3: its poly, else its bbox."""
    if e.get('poly'):
        im = Image.new('L', (W, H))
        ImageDraw.Draw(im).polygon([tuple(p) for p in e['poly']], fill=1)
        return np.array(im, bool)
    return box_mask(e['bbox'])


# ------------------------------------------------------------------------------------------ the bake recipes
def bake_g20_recipe():
    """{app texture name: (box, [manifest ids])} as tools/bake_g20.py main() builds them (parsed with ast, not run)."""
    src = open(rp('tools/bake_g20.py')).read()
    tree = ast.parse(src)
    main = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main'][0]
    out = {}
    for n in ast.walk(main):
        if isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', None) == 'boxes':
            for k, v in zip(n.value.keys, n.value.values):
                name = ast.literal_eval(k)
                box = list(ast.literal_eval(v.elts[0]))
                ids = ['structure.%s.night' % i for i in ast.literal_eval(v.elts[1])]
                out[name] = (box, ids)
        if isinstance(n, ast.For):
            try:
                it = ast.literal_eval(n.iter)
            except ValueError:
                continue
            # for name, box in (('fuel', (...)), ('oil', (...))): mini_tex(box, name + '_mini', name + '_mini.fill')
            if "mini_tex(box, name + '_mini', name + '_mini.fill')" not in src:
                raise SystemExit('tools/bake_g20.py: the minis are no longer baked by mini_tex(box, name_mini, name_mini.fill)')
            for name, box in it:
                out[name] = (list(box), ['structure.%s_mini.night' % name])
                out[name + '_fill'] = (list(box), ['structure.%s_mini.fill.night' % name])
    if "P = params()" not in src or "def lut()" not in src:
        raise SystemExit('tools/bake_g20.py: g20_lut is no longer made by lut() from live.js PARAMS')
    # the LUT: pointer and needle geometry for the value 0..1, and the rev band (lut() reads live.js PARAMS)
    out['lut'] = (None, ['live.pointer.speedo', 'live.pointer.tacho', 'live.mini.fuel', 'live.mini.oil', 'live.band.tacho'])
    return out


def collar_recipe():
    """-> (sim layers it is baked from, its mask file). The collar took its colour from the simulation's night
    background until polish B made it pure black (then it reads collar.dials.png alone)."""
    src = open(rp('tools/bake_scene.py')).read()
    need = ["'design', 'overlay', 'collar.dials.png'", "save('collar', c)"]
    for s in need:
        if s not in src:
            raise SystemExit('tools/bake_scene.py: the collar recipe changed (%s not found)' % s)
    tinted = "'bench', 'g20', 'structure', 'bg.night.png'" in src
    return (['structure.bg.night'] if tinted else []), 'design/overlay/collar.dials.png'


def housing_leds():
    src = open(rp(SIM + '/c.js')).read()
    out = []
    for m in re.finditer(r"\{\s*id:\s*'(housing\.[a-z_]+)',\s*name:\s*'([^']*)',\s*group:\s*'housing',\s*colour:\s*'(\w+)',\s*onPanel:\s*false\s*\}", src):
        out.append({'id': m.group(1), 'name': m.group(2), 'colour': m.group(3), 'on_panel': False,
                    'drawn': False, 'source': SIM + '/c.js LAMPS'})
    return out


def layouts_using():
    """{texture name: [(layout, widget id, box [x0, y0, x1, y1], role)]} from every layout JSON."""
    use = {}
    for f in sorted(os.listdir(rp(LAYOUTS))):
        if not f.endswith('.json'):
            continue
        lay = load(LAYOUTS + '/' + f)
        name = f[:-5]
        for w in lay.get('widgets', []):
            box = [w.get('x', 0), w.get('y', 0), w.get('x', 0) + w.get('w', 0), w.get('y', 0) + w.get('h', 0)]
            for role in ('base', 'fill', 'lut'):
                t = w.get(role)
                if isinstance(t, str):
                    use.setdefault(t, []).append((name, w['id'], box, role))
                elif isinstance(t, dict) and isinstance(t.get('tex'), str):
                    b = [box[0] + t.get('x', 0), box[1] + t.get('y', 0), box[0] + t.get('x', 0) + t['w'], box[1] + t.get('y', 0) + t['h']]
                    use.setdefault(t['tex'], []).append((name, w['id'], b, role))
            c = w.get('collar')
            if isinstance(c, dict) and isinstance(c.get('tex'), str):
                use.setdefault(c['tex'], []).append((name, w['id'], [c['x'], c['y'], c['x'] + c['w'], c['y'] + c['h']], 'collar'))
    return use


# --------------------------------------------------------------------------------------------- the records
def sim_records(man, cat):
    recs = []
    alpha = {}           # record id -> (alpha array, scale, ox, oy) for the overlap checks
    for e in man['entries']:
        r = {'id': e['id'], 'element': e['element'], 'source': 'sim', 'package': e['package']}
        f = e.get('file')
        proc = e.get('procedural')
        if f and f.endswith('.ttf'):
            r.update(file=SIM + '/' + f, procedural=None, render='font')
        elif f and f.endswith('.png'):
            r.update(file=SIM + '/' + f, procedural=None, render='raster')
        elif e['package'] == 'C':
            r.update(file=None, procedural={'module': SIM + '/c.js', 'id': e['id'],
                                            'draw': 'G20C.drawOver' if e['layer'] == 'over' else 'G20C.drawUnder'}, render='procedural')
        elif e['package'] == 'D':
            r.update(file=None, procedural={'module': SIM + '/' + f, 'id': e['id'], 'draw': e.get('draw')}, render='live')
        else:
            raise SystemExit('unknown manifest entry type: %s' % e['id'])
        assert proc in (None, False, True)
        r['kind'] = e['kind']
        sc = e.get('scale') or 1
        if r['render'] == 'raster':
            im = Image.open(rp(r['file']))
            a = np.asarray(im.convert('RGBA'))[..., 3]
            sc = int(sc)
            bb, n = alpha_extent(a, sc, e['x'], e['y'])
            if (im.width, im.height) != (e.get('w', im.width), e.get('h', im.height)):
                raise SystemExit('%s: PNG is %dx%d, manifest says %sx%s' % (e['id'], im.width, im.height, e.get('w'), e.get('h')))
            r.update(bbox=bb, core=alpha_extent(a, sc, e['x'], e['y'], 128)[0],
                     placement=[e['x'], e['y'], e['x'] + im.width * sc, e['y'] + im.height * sc],
                     size=[im.width, im.height], scale=sc, alpha_px=n)
            alpha[e['id']] = (a, sc, e['x'], e['y'])
        elif r['render'] == 'procedural':
            bb = [e['x'], e['y'], e['x'] + e['w'], e['y'] + e['h']]
            r.update(bbox=bb, placement=bb, size=[e['w'], e['h']], scale=1)
        elif r['render'] == 'live':
            r.update(bbox=None, placement=None, size=None, scale=1)          # measured below (constructor probe)
        else:
            r.update(bbox=None, placement=None, size=None, scale=None)
        r.update(layer=e['layer'], state=e['state'], look=e['look'], z=e['z'])
        if e.get('lamp'):
            r['lamp'] = e['lamp']
        cond = e.get('cond') or (C_COND[e['id']][0] if e['id'] in C_COND else None)
        if cond:
            r['cond'] = cond
            r['cond_source'] = 'manifest' if e.get('cond') else C_COND[e['id']][1]
        if e.get('skip'):
            r['skip'] = e['skip']
        if e.get('clip'):
            r['clip'] = {'by': e['clip']['by'], 'keep': e['clip']['keep']}
        if e.get('composite', 'source-over') != 'source-over':
            r['composite'] = e['composite']
        if e.get('opacity', 1.0) != 1.0:
            r['opacity'] = e['opacity']
        r.update(evidence=e['evidence'], sources=list(e['sources']))
        r['used_by'] = [] if e.get('skip') else ['bench-sim']
        r['notes'] = e.get('notes', '')
        recs.append(r)
    # the black area: drawn by g20sim.js itself (drawOver, theme connected) from the catalogue polygon; no manifest entry
    bb_el = [o for o in man['outline'] if o['id'] == 'overlay.black_box']
    if bb_el:
        poly = bb_el[0]['poly']
        xs, ys = [p[0] for p in poly], [p[1] for p in poly]
        ce = {e['id']: e for e in cat['elements']}.get('overlay.black_box', {})
        seen = sorted({b['photo'] for b in ce.get('relation_basis', []) if b.get('seen')})
        bb = [int(np.floor(min(xs))), int(np.floor(min(ys))), int(np.ceil(max(xs))), int(np.ceil(max(ys)))]
        recs.append({'id': 'sim.black_box', 'element': 'overlay.black_box', 'source': 'sim', 'package': 'E',
                     'file': None, 'procedural': {'module': SIM + '/g20sim.js', 'id': 'blackBox', 'draw': 'G20Sim.drawOver'},
                     'render': 'procedural', 'kind': 'albedo', 'bbox': bb, 'placement': bb, 'size': [bb[2] - bb[0], bb[3] - bb[1]],
                     'scale': 1, 'layer': 'over', 'state': 'connected', 'look': 'any', 'z': 202,
                     'evidence': ce.get('evidence', 'none'), 'sources': seen, 'used_by': ['bench-sim'],
                     'notes': "Not a manifest entry: g20sim.js drawOver fills the catalogue polygon (manifest 'outline') black, "
                              "only with a theme connected, after C's over elements (z given here as 202 for that order)."})
    return recs, alpha


def app_records(cat):
    recipe = bake_g20_recipe()
    collar_from, collar_mask = collar_recipe()
    use = layouts_using()
    geo = load('design/g20_geo.json')
    recs, alpha, issues = [], {}, []
    names = sorted(f[:-5] for f in os.listdir(rp(SCENE)) if f.endswith('.json') and (f.startswith('g20_') or f == 'collar.json'))
    for name in names:
        tex = load(SCENE + '/' + name + '.json')
        w, h = tex['w'], tex['h']
        a = np.frombuffer(base64.b64decode(tex['rgba']), np.uint8).reshape(h, w, 4)[..., 3]
        users = use.get(name, [])
        key = name[4:] if name.startswith('g20_') else name
        r = {'id': 'app.' + name, 'element': None, 'source': 'app-scene', 'package': None, 'file': SCENE + '/' + name + '.json',
             'procedural': None, 'render': 'app-texture', 'kind': 'albedo'}
        if name == 'g20_lut':
            r.update(render='data', kind='data', bbox=None, placement=None, size=[w, h], scale=None)
        else:
            if not users:
                issues.append('%s: no layout uses it' % name)
                box = None
            else:
                box = users[0][2]
                if any(u[2] != box for u in users):
                    issues.append('%s: layouts place it differently: %s' % (name, users))
            sc = (box[2] - box[0]) / float(w) if box else 1
            if box and abs((box[3] - box[1]) / float(h) - sc) > 1e-6:
                issues.append('%s: placed %s, not a uniform scale of %dx%d' % (name, box, w, h))
            sc = int(round(sc))
            bb, n = alpha_extent(a, sc, box[0], box[1]) if box else (None, 0)
            r.update(bbox=bb, core=alpha_extent(a, sc, box[0], box[1], 128)[0] if box else None,
                     placement=box, size=[w, h], scale=sc, alpha_px=n)
            if box:
                alpha[r['id']] = (a, sc, box[0], box[1])
            gb = geo.get(key, {}).get('box') if isinstance(geo.get(key), dict) else None
            base = key.replace('_fill', '')
            gb = gb or (geo.get(base, {}) or {}).get('box')
            if name.startswith('g20_') and gb and box and list(gb) != list(box):
                issues.append('%s: layout box %s differs from design/g20_geo.json %s' % (name, box, gb))
        r.update(layer='theme', state='connected', look='any' if name == 'g20_lut' else 'night', z=None,
                 evidence='strong' if name != 'collar' else 'medium')
        r['used_by'] = sorted({'layout:' + u[0] for u in users})
        if name == 'collar':
            r['baked_from'] = collar_from
            r['baked_from_files'] = [collar_mask] + ([SIM + '/structure/bg.night.png'] if collar_from else [])
            r['sources'] = ['08'] if collar_from else []
            r['notes'] = ("6WB Dials + G20: where our background stays opaque over the stock dials that stick out past ours; "
                          "alpha from design/overlay/collar.dials.png (tools/bake_scene.py), colour %s. Spans several "
                          "elements: see 'covers'." % ("from the simulation's night background" if collar_from
                                                       else "pure black"))
        else:
            ids = recipe.get(key, (None, []))[1]
            if not ids:
                issues.append('%s: not found in the tools/bake_g20.py recipe' % name)
            r['baked_from'] = ids
            r['sources'] = []
            el = {'speedo': 'structure.speedo', 'tacho': 'structure.tacho', 'fuel': 'structure.fuel_mini',
                  'fuel_fill': 'structure.fuel_mini', 'oil': 'structure.oil_mini', 'oil_fill': 'structure.oil_mini'}.get(key)
            r['element'] = el
            r['notes'] = {
                'speedo': "The stock speedo's static night look, opaque over the whole gauge so BMW's own pointer never shows; "
                          "holes over BMW's speed-limit sign. The pointer, glow and rev band are drawn live by the g20dial "
                          "widget from g20_lut.",
                'tacho': "The stock tacho's static night look, opaque over the whole gauge; a hole over the check-control 'i'. "
                         "Bakes B's tacho '0' statically (the simulation skips it and swaps '0'/OFF live).",
                'fuel': "The fuel mini's lines (straight alpha); the needle is live (g20_lut rows 4, 5).",
                'fuel_fill': "The fuel mini's fill over black, its area in alpha; lit from 0 up to the needle by the shader.",
                'oil': "The oil mini's lines (straight alpha); the needle is live (g20_lut rows 6, 7).",
                'oil_fill': "The oil mini's fill over black, its area in alpha; lit from 0 up to the needle by the shader.",
                'lut': 'Data, not a picture: 256 x 18 RGBA8, sampled nearest. Pointer and needle tip/tail per value (rows 0-15) '
                       'and the rev band per angle (rows 16, 17), from bench/g20/live/live.js PARAMS.',
            }.get(key, '')
        recs.append(r)
    return recs, alpha, issues


# ------------------------------------------------------------------------------------------- cross-checks
def cross_checks(recs, alpha, cat, man):
    E = {e['id']: e for e in cat['elements']}
    R = {r['id']: r for r in recs}
    emask = {i: element_mask(e) for i, e in E.items()}
    rep = {}
    # baked into / from (symmetric)
    for r in recs:
        for b in r.get('baked_from', []):
            if b in R:
                R[b].setdefault('baked_into', []).append(r['id'])
                for u in r['used_by']:
                    if u not in R[b]['used_by']:
                        R[b]['used_by'].append(u)
    # the part's own shape on the panel, for the overlap checks
    def shape(r):
        if r['id'] in alpha:
            a, sc, ox, oy = alpha[r['id']]
            return panel_mask(a, sc, ox, oy)
        if r.get('bbox'):
            return box_mask(r['bbox'])
        return None
    shapes = {r['id']: shape(r) for r in recs}
    # app textures: which elements they cover (alpha >= 128: what hides BMW's pixels under them; >= 10 px)
    for r in recs:
        if r['source'] != 'app-scene' or r['id'] not in alpha:
            continue
        a, sc, ox, oy = alpha[r['id']]
        m = panel_mask(a, sc, ox, oy, 128)
        cov = []
        for i, e in E.items():
            area = int(emask[i].sum())
            n = int((m & emask[i]).sum())
            if n >= 10 and area:
                cov.append({'element': i, 'px': n, 'pct': round(100.0 * n / area, 1)})
        r['covers'] = sorted(cov, key=lambda c: -c['pct'])
        if sc != 1:
            r['covers_note'] = ('alpha >= 128 of a 1/%d-size texture upscaled bilinear; edges are good to about %d px' % (sc, sc // 2))
    # part vs its element: how much of the part lies inside the element's shape, and the edge deltas
    outside = []
    for r in recs:
        el = r.get('element')
        if not el or el not in E or shapes[r['id']] is None or r['source'] != 'sim':
            continue
        s = shapes[r['id']]
        n = int(s.sum())
        ins = int((s & emask[el]).sum())
        b, eb = r['bbox'], E[el]['bbox']
        d = [round(b[0] - eb[0], 1), round(b[1] - eb[1], 1), round(b[2] - eb[2], 1), round(b[3] - eb[3], 1)]
        r['vs_catalogue'] = {'element_bbox': eb, 'd_edges': d, 'inside_pct': round(100.0 * ins / n, 1) if n else None}
        # live parts are boxes here (no pixel mask in Python): a diagonal pointer would score low for no reason, so
        # they are compared by their extents in bbox_disagreements only
        if n and 100.0 * ins / n < 50 and r['render'] != 'live':
            outside.append({'part': r['id'], 'element': el, 'inside_pct': round(100.0 * ins / n, 1),
                            'part_bbox': b, 'element_bbox': eb})
    rep['part_mostly_outside_its_element'] = outside
    # per element and look: the union of the parts drawn vs the element's bbox
    bbd = []
    for el, e in E.items():
        for look in ('night', 'day'):
            # the glow (kind glow) is a soft spread far past the photographed object: not compared
            ps = [r for r in recs if r['element'] == el and r['source'] == 'sim' and r.get('bbox') and not r.get('skip')
                  and r['look'] in ('any', look) and r['kind'] != 'glow']
            if not ps:
                continue
            u = [min(r['bbox'][0] for r in ps), min(r['bbox'][1] for r in ps), max(r['bbox'][2] for r in ps), max(r['bbox'][3] for r in ps)]
            eb = e['bbox']
            d = [round(u[0] - eb[0], 1), round(u[1] - eb[1], 1), round(u[2] - eb[2], 1), round(u[3] - eb[3], 1)]
            cs = [r['core'] for r in ps if r.get('core')]
            cu = [min(c[0] for c in cs), min(c[1] for c in cs), max(c[2] for c in cs), max(c[3] for c in cs)] if cs else None
            dc = [round(cu[0] - eb[0], 1), round(cu[1] - eb[1], 1), round(cu[2] - eb[2], 1), round(cu[3] - eb[3], 1)] if cu else None
            if max(abs(v) for v in d) > SLACK:
                big = max(range(4), key=lambda i: abs(d[i]))
                who = [r['id'] for r in ps if (r['bbox'][big] == u[big])]
                bbd.append({'element': el, 'look': look, 'parts_union': u, 'element_bbox': eb, 'd_edges': d,
                            'max_px': max(abs(v) for v in d), 'edge': ['x0', 'y0', 'x1', 'y1'][big], 'set_by': who,
                            'core_union': cu, 'd_edges_core': dc})
    rep['bbox_disagreements'] = bbd
    # relation / state: the part's layer and state against the element's relation
    rd = []
    for r in recs:
        el = r.get('element')
        if r['source'] != 'sim' or not el or el not in E or r['render'] == 'font':
            continue
        rel, ev = E[el]['relation'], E[el]['evidence']
        lay, st = r['layer'], r['state']
        why = None
        sev = 'conflict'
        if lay == 'over' and rel != 'over':
            why = 'the simulation draws it over a theme; the catalogue says %s' % rel
        elif rel == 'over' and lay != 'over':
            why = 'the catalogue says over; the simulation draws it under (layer %s)' % lay
        elif st == 'stock' and rel != 'gone':
            why = 'the simulation draws it only in the stock layout; the catalogue says %s (%s)' % (rel, ev)
        elif rel == 'gone' and st != 'stock':
            why = 'the catalogue says gone; the simulation draws it in state %s' % st
        elif rel == 'unknown' and st in ('any', 'connected') and lay == 'under':
            why = 'the simulation draws it under a connected theme (state %s); the catalogue says unknown (evidence %s)' % (st, ev)
            sev = 'assumption'
        if why:
            rd.append({'part': r['id'], 'element': el, 'part_layer': lay, 'part_state': st, 'relation': rel,
                       'evidence': ev, 'kind': sev, 'why': why})
    rep['relation_disagreements'] = rd
    # suspicious links: parts at the same spot linked to different elements
    sus = []
    sims = [r for r in recs if r['source'] == 'sim' and r.get('bbox') and r['element']]
    for i, p in enumerate(sims):
        for q in sims[i + 1:]:
            if p['element'] == q['element'] or p['look'] not in ('any', q['look']) and q['look'] != 'any':
                continue
            if 'panel.background' in (p['element'], q['element']):
                continue                    # the background lies under everything by definition
            if {p['state'], q['state']} == {'stock', 'connected'}:
                continue                    # never drawn together (e.g. the stock centre gear and the black area)
            a, b = p['bbox'], q['bbox']
            ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
            iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
            inter = ix * iy
            sa = (a[2] - a[0]) * (a[3] - a[1])
            sb = (b[2] - b[0]) * (b[3] - b[1])
            small = min(sa, sb)
            if not small or inter / small < 0.6:
                continue
            # the same thing drawn twice: a part over another of about its size (within 2x). A small part inside a
            # big one (a text on a dial face, a pointer over a label, the pointer glow over the faces) is by design.
            if max(sa, sb) > 2 * small:
                continue
            sus.append({'parts': [p['id'], q['id']], 'elements': [p['element'], q['element']],
                        'overlap_of_smaller_pct': round(100.0 * inter / small, 1),
                        'why': 'same spot, different elements'})
    # the brief's case and others found by reading the manifest notes
    rep['suspicious_links'] = sus
    # unresolved: element null or not in the catalogue
    unres = []
    for r in recs:
        el = r.get('element')
        if el is None:
            why = {'font': 'the font (data, used by C)', 'data': 'data, not a picture (pointer geometry)'}.get(r['kind'])
            if r['id'] == 'app.collar':
                why = 'spans several elements (see covers)'
            unres.append({'part': r['id'], 'element': None, 'reason': why or 'no element given'})
        elif el not in E:
            unres.append({'part': r['id'], 'element': el, 'reason': 'not in design/overlay/g20_comfort.json'})
    rep['unresolved'] = unres
    rep['housing_leds'] = housing_leds()
    rep['housing_leds_catalogue'] = [x for x in cat.get('excluded', []) if 'LED' in x['what'] or 'Physical LED' in x['reason']]
    # app vs simulation: where the app shows a part differently from the simulation
    av = []
    for r in recs:
        if r['source'] != 'app-scene':
            continue
        for b in r.get('baked_from', []):
            p = R.get(b)
            if not p:
                continue
            if p.get('skip'):
                av.append({'app': r['id'], 'part': b, 'why': 'the simulation skips this layer (%s); the app bakes it in' % p['skip']})
            if p.get('cond'):
                av.append({'app': r['id'], 'part': b, 'why': 'the simulation draws it only when %s; the app bakes it in statically' % p['cond']})
            if p.get('clip'):
                av.append({'app': r['id'], 'part': b, 'why': "the simulation clips it at the needle line (%s); the app's shader lights the fill from 0 up to the needle" % p['clip']['by']})
    rep['app_vs_sim'] = av
    return rep


def per_element(recs, cat, new_ids):
    E = cat['elements']
    out = {}
    for e in E:
        i = e['id']
        mine = [r for r in recs if r['element'] == i]
        cov = [r['id'] for r in recs if r['source'] == 'app-scene' and any(c['element'] == i for c in r.get('covers', []))]
        sim = [r for r in mine if r['source'] == 'sim']
        live = [r for r in sim if not r.get('skip')]
        day = any(r['look'] in ('any', 'day') for r in live)
        night = any(r['look'] in ('any', 'night') for r in live)
        missing = []
        if not sim:
            missing.append('no part: must draw')
        else:
            if not day:
                missing.append('no day look')
            if not night:
                missing.append('no night look')
            weak = sorted({r['evidence'] for r in sim if r['evidence'] in ('weak', 'none')})
            if weak:
                missing.append('evidence %s: %s' % ('/'.join(weak), ', '.join(r['id'] for r in sim if r['evidence'] in ('weak', 'none'))))
            st = sorted({r['state'] for r in live})
            if st == ['stock']:
                missing.append('stock layout only')
            if st == ['connected']:
                missing.append('theme connected only')
        out[i] = {
            'relation': e['relation'], 'group': e['group'], 'new': i in new_ids,
            'raster': [r['id'] for r in mine if r['render'] == 'raster'],
            'procedural': [r['id'] for r in mine if r['render'] == 'procedural'],
            'live': [r['id'] for r in mine if r['render'] == 'live'],
            'app': [r['id'] for r in mine if r['source'] == 'app-scene'],
            'app_covers': [c for c in cov if c not in [r['id'] for r in mine]],
            'day': day, 'night': night, 'missing': missing,
        }
    return out


# --------------------------------------------------------------------------------------------- measuring
def measure(recs):
    """Render every procedural / live part alone in the constructor (headless Chrome) and read its alpha extent."""
    spec = importlib.util.spec_from_file_location('oc_headless', os.path.join(HERE, 'headless.py'))
    hl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hl)
    if not os.path.exists(hl.CHROME):
        print('measure: no Chrome at %s; keeping the previous numbers' % hl.CHROME)
        return None
    port = hl.free_port()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        os.makedirs(os.path.join(ROOT, 'bake/work/overlay'), exist_ok=True)
        tmp = os.path.join(ROOT, 'bake/work/overlay/_probe.html')
        hl.chrome(['--window-size=1600,900', '--dump-dom',
                   'http://127.0.0.1:%d/tools/overlay/constructor/?data=real&probe=parts&photo=none' % port], tmp)
        s = open(tmp).read()
        m = re.search(r'<pre id="probe-dump"[^>]*>(.*?)</pre>', s, re.S)
        if not m or not m.group(1).strip():
            print('measure: no probe output in the page dump; keeping the previous numbers')
            return None
        return json.loads(html.unescape(m.group(1)))
    finally:
        srv.kill()
        import shutil
        shutil.rmtree(hl.PROFILE, ignore_errors=True)


def build(prev, probe):
    man = load(SIM + '/manifest.json')
    cat = load(CAT)
    recs, alpha = sim_records(man, cat)
    arecs, aalpha, issues = app_records(cat)
    recs += arecs
    alpha.update(aalpha)
    prevR = {r['id']: r for r in (prev or {}).get('parts', [])}
    fallbacks = []
    for r in recs:
        if r['render'] not in ('procedural', 'live'):
            continue
        p = (probe or {}).get(r['id']) if probe else None
        if p is None and prevR.get(r['id'], {}).get('measured'):
            p = prevR[r['id']]['measured']
        if p:
            r['measured'] = {k: p[k] for k in ('bbox', 'core', 'px', 'state') if k in p}
            if p.get('fallback'):
                r['measured']['fallback'] = p['fallback']
            if p.get('core'):
                r['core'] = p['core']
            if r['render'] == 'live':
                r['bbox'] = p.get('bbox')
                r['placement'] = p.get('bbox')
                r['size'] = [p['bbox'][2] - p['bbox'][0], p['bbox'][3] - p['bbox'][1]] if p.get('bbox') else None
                r['alpha_px'] = p.get('px')
        if r['render'] == 'live' and not r.get('bbox'):
            fallbacks.append(r['id'])
    if probe:
        for k, v in probe.items():
            if v.get('fallback'):
                fallbacks.append(k)
    # link into the catalogue first (new elements), then cross-check against the linked catalogue
    sys.path.insert(0, HERE)
    import link_parts
    doc = {'kind': 'g20-parts', 'parts': recs}
    new_ids = link_parts.apply(cat, doc)
    new_all = [s['id'] for s in json.load(open(link_parts.NEW))['elements']]
    rep = cross_checks(recs, alpha, cat, man)
    rep['new_elements'] = new_all
    rep['layout_issues'] = issues
    pe = per_element(recs, cat, set(new_all))
    rep['elements_without_parts'] = [i for i, v in pe.items() if 'no part: must draw' in v['missing']]
    rep['per_element'] = pe
    from collections import Counter
    rep['counts'] = {
        'parts': len(recs),
        'manifest_entries': len(man['entries']),
        'sim_records_from_manifest': sum(1 for r in recs if r['source'] == 'sim' and r['id'] != 'sim.black_box'),
        'sim_extra': [r['id'] for r in recs if r['id'] == 'sim.black_box'],
        'app_scene': sum(1 for r in recs if r['source'] == 'app-scene'),
        'by_render': dict(Counter(r['render'] for r in recs)),
        'measured': sum(1 for r in recs if r.get('measured')),
        'not_drawable_alone': sorted(set(fallbacks)),
    }
    out = {
        '$comment': 'The G20 parts we already have as our own drawings (the bench simulation bench/g20/ and the app\'s '
                    'G20 scene textures), one record per part, linked to design/overlay/g20_comfort.json. Written by '
                    'tools/overlay/inventory_parts.py; do not edit. No pixels here: the files are referenced in place. '
                    'See README.md section 6.',
        'kind': 'g20-parts', 'schema_version': 1, 'panel': {'w': W, 'h': H},
        'sources': {'manifest': SIM + '/manifest.json', 'catalogue': CAT, 'scene': SCENE + '/', 'layouts': LAYOUTS + '/',
                    'bake': ['tools/bake_g20.py', 'tools/bake_scene.py'], 'geo': 'design/g20_geo.json'},
        'parts': recs,
        'report': rep,
    }
    return out, cat, new_ids


def markdown(doc):
    pe = doc['report']['per_element']
    R = {r['id']: r for r in doc['parts']}
    short = lambda xs: ', '.join('`%s`' % x for x in xs) if xs else '–'
    rows = ['| Element | Rel. | Raster (B) | Procedural (C) | Live (D) | App texture | Day / night | Missing: still to draw or settle |',
            '|---|---|---|---|---|---|---|---|']
    for i, v in pe.items():
        ras = sorted({re.sub(r'\.(day|night)$', '', x) + (' (skip)' if R[x].get('skip') else '') for x in v['raster']})
        dn = ('day' if v['day'] else '–') + ' / ' + ('night' if v['night'] else '–')
        # app textures over it: only those that hide at least 5 % of it (the full list is in the file)
        cov = [c for c in v['app_covers'] if any(x['element'] == i and x['pct'] >= 5 for x in R[c].get('covers', []))]
        app = ['`%s`' % a.replace('app.', '') for a in v['app']] + ['under `%s`' % c.replace('app.', '') for c in cov]
        rows.append('| `%s`%s | %s | %s | %s | %s | %s | %s | %s |' % (
            i, ' (new)' if v['new'] else '', v['relation'], short(ras).replace('`structure.', '`'),
            short(v['procedural']).replace('`c.', '`'), short(v['live']).replace('`live.', '`'),
            ', '.join(app) if app else '–', dn, '; '.join(v['missing']) or 'nothing'))
    return '\n'.join(rows)


def main(argv):
    prev = load(OUT) if os.path.exists(rp(OUT)) else None
    doc, cat, added = build(prev, None)
    with open(rp(OUT), 'w') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write('\n')
    with open(rp(CAT), 'w') as f:
        json.dump(cat, f, indent=1, ensure_ascii=False)
        f.write('\n')
    if '--no-measure' not in argv:
        probe = measure(doc['parts'])
        if probe:
            doc, cat, _ = build(prev, probe)
            with open(rp(OUT), 'w') as f:
                json.dump(doc, f, indent=1, ensure_ascii=False)
                f.write('\n')
            with open(rp(CAT), 'w') as f:
                json.dump(cat, f, indent=1, ensure_ascii=False)
                f.write('\n')
    c = doc['report']['counts']
    print('parts: %d (%d of %d manifest entries, extra %s, %d app scene) by render %s; measured %d; not drawable alone: %s'
          % (c['parts'], c['sim_records_from_manifest'], c['manifest_entries'], c['sim_extra'], c['app_scene'],
             c['by_render'], c['measured'], c['not_drawable_alone'] or 'none'))
    rep = doc['report']
    print('catalogue: added %s; elements without parts: %s; unresolved: %s' % (
        added or 'none (already there)', rep['elements_without_parts'] or 'none', [u['part'] for u in rep['unresolved']]))
    print('cross-checks: %d relation/state, %d bbox, %d part outside its element, %d suspicious, %d app-vs-sim; layout issues %s' % (
        len(rep['relation_disagreements']), len(rep['bbox_disagreements']), len(rep['part_mostly_outside_its_element']),
        len(rep['suspicious_links']), len(rep['app_vs_sim']), rep['layout_issues'] or 'none'))
    if '--markdown' in argv:
        print(markdown(doc))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
