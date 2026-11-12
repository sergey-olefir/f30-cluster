#!/usr/bin/env python3
"""Export our 6WB Comfort theme as overlay elements: design/overlay/wb_comfort.json + design/overlay/masks/<id>.png.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy --with pillow \
        python tools/overlay/export_wb.py

Re-runnable; every path is from the repo root. It rewrites the JSON and every mask (old mask PNGs are removed).

Inputs:
  bake/work/P9/stack_comfort.json        the 44 baked layers (id, cluster, z, file, x, y, scale, opacity). A file is
                                         relative to apps/f30_cluster/hud/baked/ unless it starts with bake/work/.
                                         `scale` is the file's resolution: a @0.5x file (scale 0.5) is drawn at
                                         1/scale = 2x its pixel size, bilinear (tools/bake_scene.py; speedo.base is
                                         336 px at (76,44) -> 76..748, centre 412,380 = the dial centre).
  apps/f30_cluster/hud/layouts/wb_comfort.json   the 52 live widgets.
  apps/f30_cluster/hud/scene/*.json      the packed scene textures (QC only: their alpha vs our baked masks).
  bake/work/P10/bench_P10_comfort.png    bench screenshots of wb_comfort (QC reference; RGB, backdrop off), and
  bake/work/P10/bench_cb28ce7_comfort.png  the one before the P10 levels.

Outputs:
  design/overlay/wb_comfort.json, design/overlay/masks/<id>.png   8-bit grayscale = alpha at 1x over exactly bbox
  bake/work/overlay/wb_export_qc.json, bake/work/overlay/wb_export_qc.png   the mask union vs the bench, per dial

Masks:
  baked   the layer's alpha at 1x (x opacity), clipped to what the car draws of it: every baked layer reaches the
          car packed into a scene texture that one live widget draws (tools/bake_scene.py), so a dial's layers are
          clipped to that dial's disc (the wbdial shader: R = min(w,h)/2 - 1 about the box centre, 1 px soft edge),
          the window/bar/horizon to WBBACK's tex rects, the signs to their sign rects. Then trimmed to alpha > 0.
  live    dial widgets: the wbdial shader's disc (its exact alpha; the needles and labels draw inside it).
          Everything else: the layout box (mask null), unless --capture renders exist (below).

QC (no live bench needed): the reference screenshot is RGB with WBBACK drawn, so coverage is read as "differs from
the C10 panel background by more than CONTENT_T", holes filled (the dials' bezels close them), and compared with
the union of our shapes (all but the two full-panel backgrounds), holes filled the same way, inside each dial
anchor's box.

--capture (UNTESTED: written while the only bench on the machine belonged to someone else, never run). It would
drive a bench you started yourself (rm -rf dist bench/.data; node bench/server.js f30_cluster &; default
http://localhost:8078) through headless Chrome's DevTools protocol (needs --with websocket-client): freeze the
signals (manual), write a layout override bench/.data/f30_cluster/layouts/wb_comfort.json with one widget at a time
(plus the whole layout and all-but-bg), read the display canvas with its alpha (toDataURL) into
bake/work/overlay/wb_capture/, and remove the override. When those renders exist, the export uses them as the masks
of dials, signs, icons and the background widget.
"""
import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
STACK = 'bake/work/P9/stack_comfort.json'
LAYOUT = 'apps/f30_cluster/hud/layouts/wb_comfort.json'
BAKED = 'apps/f30_cluster/hud/baked'
SCENE = 'apps/f30_cluster/hud/scene'
OUT_JSON = 'design/overlay/wb_comfort.json'
MASKS = 'design/overlay/masks'
WORK = 'bake/work/overlay'
CAP = WORK + '/wb_capture'
OVERRIDE = 'bench/.data/f30_cluster/layouts/wb_comfort.json'
REFS = ['bake/work/P10/bench_P10_comfort.png', 'bake/work/P10/bench_cb28ce7_comfort.png']
W, H = 1920, 720
THR = 64          # README: a mask pixel counts when alpha >= 64/255
WINBAR = (640, 76, 1280, 692)   # QC: WBBACK's window + bar area (tex.window, infobar body to y 691)
CONTENT_T = 2     # QC: a screenshot pixel is ours when it differs from the C10 background by more than this (0..255)

# the frozen bench signals for --capture (manual mode)
SIGNALS = {'rpm': 900, 'speed': 0, 'oil': 95, 'coolant': 90, 'boost': 0, 'gear': 0, 'gLong': 0, 'gLat': 0,
           'fuelL': 40, 'range': 450, 'ambient': 22}

# which scene texture holds each baked layer and which live widget draws it on the car (tools/bake_scene.py)
SCENE_OF = {'C1': ('speedo', 'speedo'), 'C2': ('tacho', 'tacho'), 'C3': ('fuel', 'fuel'), 'C4': ('oil', 'oilt')}
SCENE_ID = {'speedo.range-arc.track': ('speedo', 'speedo'), 'tacho.ed-arc.track': ('tacho', 'tacho'),
            'edyn.battery': ('tacho', 'tacho'), 'mini.fuel-pump': ('fuel', 'fuel'), 'mini.oil-can': ('oil', 'oilt'),
            'window.base': ('window', 'bg'), 'infobar.body': ('window', 'bg'), 'window.horizon': ('horizon', 'bg'),
            'infobar.line': ('bar', 'bg'), 'sign.speed-limit': ('sign_limit', 'signs'),
            'sign.no-overtaking': ('sign_nopass', 'signs')}
NOT_PACKED = {'panel.background', 'bar.range'}


def p(rel):
    return os.path.join(ROOT, rel)


def load_json(rel):
    with open(p(rel)) as f:
        return json.load(f)


def num(v):
    return int(v) if float(v).is_integer() else round(float(v), 2)


def rect_str(r):
    return '[%s,%s %sx%s]' % (r['x'], r['y'], r['w'], r['h'])


# ---------------------------------------------------------------- anchors

def anchors_from(layout):
    wd = {w['id']: w for w in layout['widgets']}
    out = []
    for aid, wid in (('speedo', 'speedo'), ('tacho', 'tacho'), ('mini.fuel', 'fuel'), ('mini.oil', 'oilt')):
        w = wd[wid]
        cx, cy, r = w['x'] + w['w'] / 2.0, w['y'] + w['h'] / 2.0, w['w'] / 2.0
        if wid in ('speedo', 'tacho'):
            dl = wd['bg']['dl' if wid == 'speedo' else 'dr']      # WBBACK's own copy of the dial geometry
            assert (dl[0], dl[1], dl[2]) == (cx, cy, r), (wid, dl, cx, cy, r)
        out.append({'id': aid, 'centre': [num(cx), num(cy)], 'R': num(r),
                    'bbox': [num(cx - r), num(cy - r), num(cx + r), num(cy + r)],
                    'notes': 'from the %s dial widget (x, y, w, h): centre = box centre, R = w/2 (the shader draws '
                             'its disc to R - 1)' % wid})
    t = wd['bg']['tex']['window']
    out.append({'id': 'window', 'centre': [num(t['x'] + t['w'] / 2.0), num(t['y'] + t['h'] / 2.0)], 'R': None,
                'bbox': [t['x'], t['y'], t['x'] + t['w'], t['y'] + t['h']],
                'notes': 'the middle window: bg.tex.window rect (WBBACK draws the window texture there)'})
    return out


NEAR = 40   # px: an element whose centre is this close to an anchor box (but outside) still joins it


def anchor_by_position(bbox, anchors):
    """The smallest anchor whose bbox holds this bbox's centre; else the anchor box nearest to the centre when it
    is within NEAR px; else None."""
    cx, cy = (bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0
    best, near = None, None
    for a in anchors:
        b = a['bbox']
        if b[0] <= cx < b[2] and b[1] <= cy < b[3]:
            area = (b[2] - b[0]) * (b[3] - b[1])
            if best is None or area < best[0]:
                best = (area, a['id'])
        dist = np.hypot(max(b[0] - cx, 0, cx - b[2]), max(b[1] - cy, 0, cy - b[3]))
        if dist <= NEAR and (near is None or dist < near[0]):
            near = (dist, a['id'])
    return best[1] if best else (near[1] if near else None)


# ---------------------------------------------------------------- coverage of what a widget draws

YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)


def disc_cov(w):
    """The wbdial shader's alpha over the panel: R = min(w,h)/2 - 1 about the box centre, edge = clamp(R+0.5-d)."""
    cx, cy = w['x'] + w['w'] / 2.0, w['y'] + w['h'] / 2.0
    R = min(w['w'], w['h']) / 2.0 - 1.0
    d = np.hypot(XX + 0.5 - cx, YY + 0.5 - cy)
    return np.clip(R + 0.5 - d, 0.0, 1.0), 'disc R %g about (%g,%g)' % (R, cx, cy)


def rect_cov(x, y, w, h):
    c = np.zeros((H, W), np.float32)
    c[max(y, 0):min(y + h, H), max(x, 0):min(x + w, W)] = 1.0
    return c, 'rect [%d,%d %dx%d]' % (x, y, w, h)


BG_TEX = {'window': 'window', 'horizon': 'horizon', 'bar': 'line'}       # scene texture -> WBBACK tex key
SIGN_TEX = {'sign_limit': 'limit', 'sign_nopass': 'nopass'}


def drawn_region(tex, wid, wd):
    """(coverage over the panel, description) of where widget `wid` draws scene texture `tex`."""
    w = wd[wid]
    if w['type'] == 'dial':
        return disc_cov(w)
    if w['type'] == 'wbback':
        t = w['tex'][BG_TEX[tex]]
        return rect_cov(t['x'], t['y'], t['w'], t['h'])
    if w['type'] == 'wbsign':
        t = w['tex'][SIGN_TEX[tex]]
        return rect_cov(w['x'] + t['x'], w['y'] + t['y'], t['w'], t['h'])
    raise SystemExit('no drawn region for %s in %s' % (tex, wid))


# ---------------------------------------------------------------- masks

def save_mask(eid, a8):
    """8-bit grayscale PNG, optimised. Returns the repo-relative path."""
    rel = '%s/%s.png' % (MASKS, eid)
    Image.fromarray(np.ascontiguousarray(a8), 'L').save(p(rel), optimize=True)
    return rel


def place(a, x, y):
    """A float alpha placed on the panel (clipped)."""
    out = np.zeros((H, W), np.float32)
    h, w = a.shape
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
    if x1 > x0 and y1 > y0:
        out[y0:y1, x0:x1] = a[y0 - y:y1 - y, x0 - x:x1 - x]
    return out


def trim(full8):
    """Trim a panel-size uint8 alpha to alpha > 0. Returns (bbox, crop) or (None, None)."""
    ys, xs = np.nonzero(full8)
    if not len(xs):
        return None, None
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    return [x0, y0, x1, y1], full8[y0:y1, x0:x1]


def baked_alpha(layer):
    """The layer's alpha at 1x, as tools/bake_scene.py places it (bilinear up by 1/scale), times its opacity."""
    f = layer['file']
    path = p(f) if f.startswith('bake/work/') else p(BAKED + '/' + f)
    a = np.asarray(Image.open(path).convert('RGBA'), dtype=np.float32)[..., 3] / 255.0
    if layer['scale'] < 1:
        s = 1.0 / layer['scale']
        a = np.asarray(Image.fromarray(a, 'F').resize((int(round(a.shape[1] * s)), int(round(a.shape[0] * s))),
                                                      Image.BILINEAR))
    return a * float(layer.get('opacity', 1.0)), path


def to8(a):
    return np.clip(np.round(a * 255.0), 0, 255).astype(np.uint8)


# ---------------------------------------------------------------- baked elements

def kind_of_layer(lid):
    if lid == 'panel.background' or lid.startswith('window.') or lid.startswith('infobar.'):
        return 'background'
    if lid.startswith('sign.'):
        return 'sign'
    if lid.startswith('mini.') or lid in ('edyn.battery', 'bar.range'):
        return 'icon'
    if any(k in lid for k in ('arc', 'red-zone', 'zones')):
        return 'arc'
    return 'dial'     # faces, ticks, grooves, discs, rings, floors, glows, bezels, the P box, the hub ring


OPAQUE = {'panel.background', 'window.base', 'infobar.body', 'speedo.base', 'tacho.static', 'fuel.face', 'oil.face'}
CLUSTER_ANCHOR = {'C1': 'speedo', 'C2': 'tacho', 'C3': 'mini.fuel', 'C4': 'mini.oil', 'C5': 'window', 'C10': None}


def baked_elements(stack, layout, anchors, comp):
    wd = {w['id']: w for w in layout['widgets']}
    els = []
    for l in stack:
        eid = '%s.%s' % (l['cluster'], l['id'])
        a, path = baked_alpha(l)
        x, y = int(l['x']), int(l['y'])
        ext = [x, y, x + a.shape[1], y + a.shape[0]]
        full = place(a, x, y)
        raw_box, _ = trim(to8(full))
        k = kind_of_layer(l['id'])
        tex, wid = SCENE_ID.get(l['id']) or SCENE_OF.get(l['cluster']) or (None, None)
        notes = ['%s layer, z %s; placed extent %s (file %gx%g px at scale %s, drawn at %gx)'
                 % (l.get('src', 'baked'), l['z'], ext, a.shape[1] * l['scale'], a.shape[0] * l['scale'],
                    l['scale'], 1.0 / l['scale'])]
        if wid:
            cov, desc = drawn_region(tex, wid, wd)
            clipped = to8(full * cov)
            bbox, crop = trim(clipped)
            lost = int(((to8(full) >= THR) & (clipped < THR)).sum())
            notes.append('on the car: packed into scene texture "%s" (tools/bake_scene.py), drawn by live widget "%s"'
                         ' (w.%s)' % (tex, wid, wid))
            notes.append('mask clipped to what that widget draws (%s)%s' % (
                desc, '; %d px of the layer (alpha >= %d) fall outside and are not drawn; unclipped bbox %s'
                % (lost, THR, raw_box) if lost else ''))
        else:
            bbox, crop = trim(to8(full))
            notes.append('not packed into any scene texture by tools/bake_scene.py, so the car does not draw this '
                         'image (%s)' % ('WBBACK draws the panel background itself' if k == 'background'
                                         else 'kept for reference'))
        if bbox is None:
            print('warn: %s is empty' % eid)
            continue
        notes.append('bbox trimmed to alpha > 0')
        if l['cluster'] in CLUSTER_ANCHOR:
            anchor = CLUSTER_ANCHOR[l['cluster']]
        else:
            anchor = anchor_by_position(bbox, anchors)
            notes.append('anchor by position (the anchor box holding the bbox centre, or within %d px of it)' % NEAR)
        if l['id'] == 'speedo.soft-glow':
            notes.append('a glow: thin alpha, mostly below the %d/255 mask threshold' % THR)
        rel = save_mask(eid, crop)
        comp[eid] = (bbox, crop)
        els.append({
            'id': eid, 'source': 'baked', 'cluster': l['cluster'], 'z': num(l['z']), 'bbox': bbox, 'mask': rel,
            'opaque': l['id'] in OPAQUE, 'kind': k, 'movable': l['id'] != 'panel.background', 'anchor': anchor,
            'file': os.path.relpath(path, ROOT), 'widget': None, 'conn': None, 'hole': None,
            'notes': '; '.join(notes)})
    return els


# ---------------------------------------------------------------- live elements

KIND_OF_TYPE = {'wbback': 'background', 'dial': 'dial', 'text': 'text', 'icon': 'icon', 'wbsign': 'sign'}
WIDGET_ANCHOR = {'speedo': 'speedo', 'tacho': 'tacho', 'fuel': 'mini.fuel', 'oilt': 'mini.oil'}
HIDDEN_NOTE = 'hidden with the default settings'


def capture_alpha(wid):
    f = p('%s/w.%s.png' % (CAP, wid))
    if not os.path.exists(f):
        return None
    return np.asarray(Image.open(f).convert('RGBA'))[..., 3].copy()


def live_elements(layout, anchors, comp):
    els = []
    for w in layout['widgets']:
        wid, typ = w['id'], w['type']
        eid = 'w.' + wid
        box = [w['x'], w['y'], w['x'] + w['w'], w['y'] + w['h']]
        x0, y0, x1, y1 = box
        k = KIND_OF_TYPE.get(typ)
        if k is None:
            raise SystemExit('unknown widget type %s (%s): add it to KIND_OF_TYPE' % (typ, wid))
        anchor = None if typ == 'wbback' else (WIDGET_ANCHOR.get(wid) or anchor_by_position(box, anchors))
        notes, mask, hole = [], None, None
        tog = w.get('toggle')
        if tog:
            notes.append('toggle "%s": %s (baked on)' % (tog, HIDDEN_NOTE if tog == '!baked'
                                                         else 'shown with the default settings'))
        if 'text' in w:
            notes.append('text "%s", font %s' % (w['text'], w.get('font')))
        if typ == 'wbback':
            hx, hy, hw, hh = w['hole']
            hole = {'rect': [hx, hy, hx + hw, hy + hh], 'radius': w.get('holeRadius', 0), 'when': w.get('holeWhen')}
            notes.append('WBBACK: the panel background, the window (tex.window %s), the horizon and the bar line '
                         '(the C5/C6 window and bar layers); see-through hole %s r %s only when the "%s" setting is '
                         'on (off by default)' % (rect_str(w['tex']['window']), hole['rect'], hole['radius'],
                                                  hole['when']))
        if typ == 'dial' and w.get('base'):
            b = w['base']
            notes.append('draws baked base texture "%s" at %s in its box (the static dial: the C-layers of this '
                         'anchor) plus the live needle and hub' % (b['tex'], rect_str(b)))
        if typ == 'dial' and w.get('fill'):
            f = w['fill']
            notes.append('live bottom-arc fill "%s" at %s in the box (of %s)' % (f['tex'], rect_str(f), f.get('of')))
        if typ == 'wbsign':
            notes.append('baked signs, shown only while the car reports them: ' +
                         ', '.join('%s %s' % (n, rect_str(t)) for n, t in w['tex'].items()))

        cap = capture_alpha(wid)
        if cap is not None and typ in ('dial', 'wbsign', 'icon', 'wbback') and (cap[y0:y1, x0:x1] >= THR).any():
            crop = cap[y0:y1, x0:x1]
            if typ == 'wbback' and (crop >= THR).all():
                notes.append('bench render opaque over the whole box (stockMap off): mask null, the bbox is the shape')
            else:
                mask = save_mask(eid, crop)
                comp[eid] = (box, crop)
                notes.append('mask: bench render of this widget alone (export_wb.py --capture)')
        elif typ == 'dial':
            cov, desc = disc_cov(w)
            crop = to8(cov)[y0:y1, x0:x1]
            mask = save_mask(eid, crop)
            comp[eid] = (box, crop)
            notes.append('mask: the wbdial shader\'s alpha, a %s (shared/shaders.js: gl_FragColor alpha = edge); '
                         'needles, hub and labels draw inside it' % desc)
        else:
            notes.append('bbox: no per-widget bench render')
        if mask is None:
            comp[eid] = (box, None)     # the bbox is the shape
        els.append({
            'id': eid, 'source': 'live', 'cluster': None, 'z': num(w['z'] + 100), 'bbox': box, 'mask': mask,
            'opaque': typ in ('wbback', 'dial'), 'kind': k, 'movable': typ != 'wbback', 'anchor': anchor,
            'file': None, 'widget': wid, 'conn': w.get('conn'), 'hole': hole, 'notes': '; '.join(notes)})
    return els


# ---------------------------------------------------------------- QC

def raster(entries):
    """Union of shapes (mask >= THR, or the bbox) on the panel."""
    u = np.zeros((H, W), bool)
    for bbox, m in entries:
        x0, y0, x1, y1 = [int(v) for v in bbox]
        if m is None:
            u[max(y0, 0):min(y1, H), max(x0, 0):min(x1, W)] = True
        else:
            u[y0:y1, x0:x1] |= m >= THR
    return u


def fill_holes(m):
    """Fill every region of False not connected to the panel border."""
    inv = (~m).astype(np.uint8)
    pad = np.pad(inv, 1, constant_values=1)
    ff = pad.copy()
    cv2.floodFill(ff, None, (0, 0), 2)
    outside = ff[1:-1, 1:-1] == 2
    return ~outside


def c10_background():
    l = next(x for x in load_json(STACK) if x['id'] == 'panel.background')
    im = Image.open(p(BAKED + '/' + l['file'])).convert('RGB')
    return np.asarray(im.resize((W, H), Image.BILINEAR)).astype(np.int16)


def scene_alpha(name):
    d = load_json('%s/%s.json' % (SCENE, name))
    a = np.frombuffer(base64.b64decode(d['rgba']), np.uint8).reshape(d['h'], d['w'], 4)[..., 3]
    return a.astype(np.float32) / 255.0


def scene_check(layout, comp, els):
    """Do the packed scene textures (what the car samples now) have the alpha our baked masks say? IoU per texture,
    clipped to the drawing widget like the masks."""
    wd = {w['id']: w for w in layout['widgets']}
    where = {'speedo': (77, 45, 1), 'tacho': (1173, 45, 1), 'fuel': (8, 556, 1), 'oil': (1768, 556, 1),
             'window': (640, 76, 2), 'horizon': (748, 452, 1), 'bar': (668, 602, 1),
             'sign_limit': (307, 462, 1), 'sign_nopass': (429, 462, 1)}
    owner = {}
    for e in els:
        if e['source'] != 'baked':
            continue
        lid = e['id'].split('.', 1)[1]
        tw = SCENE_ID.get(lid) or SCENE_OF.get(e['cluster'])
        if tw:
            owner.setdefault(tw, []).append(e['id'])
    out = {}
    for (tex, wid), ids in sorted(owner.items()):
        x, y, s = where[tex]
        a = scene_alpha(tex)
        if s != 1:
            a = np.asarray(Image.fromarray(a, 'F').resize((a.shape[1] * s, a.shape[0] * s), Image.BILINEAR))
        cov, _ = drawn_region(tex, wid, wd)
        S = place(a, x, y) * cov >= THR / 255.0
        M = raster([comp[i] for i in ids])
        inter, uni = int((S & M).sum()), int((S | M).sum())
        out[tex] = {'widget': wid, 'layers': ids, 'iou': round(inter / uni, 4) if uni else None,
                    'scene_px': int(S.sum()), 'mask_px': int(M.sum())}
    return out


def qc(layout, els, comp, anchors):
    missing = [r for r in REFS if not os.path.exists(p(r))]
    if missing:
        print('QC skipped: %s missing' % ', '.join(missing))
        return None
    byid = {e['id']: e for e in els}
    bgc = c10_background()
    yy, xx = np.mgrid[0:H, 0:W]
    disc_out = np.ones((H, W), bool)
    for a in anchors:
        if a['R'] is not None:
            disc_out &= (xx + 0.5 - a['centre'][0]) ** 2 + (yy + 0.5 - a['centre'][1]) ** 2 > (a['R'] + 1) ** 2
    win = anchors[-1]['bbox']
    bare = disc_out & ~((xx >= win[0]) & (xx < win[2]) & (yy >= win[1]) & (yy < 690))
    # shapes: every element but the two full-panel backgrounds and the widgets hidden with the defaults
    keep = [i for i, e in byid.items() if i not in ('C10.panel.background', 'w.bg') and HIDDEN_NOTE not in e['notes']]
    # the region each dial is judged in: its anchor box, less the WBBACK window + bar (dark, partly the background's
    # colour on the bench, and drawn under the dials anyway) and less the other dials' discs
    regions, hulls = {}, {}
    for a in anchors:
        if a['R'] is None:
            continue
        cx, cy, R = a['centre'][0], a['centre'][1], a['R']
        reg = np.zeros((H, W), bool)
        x0, y0, x1, y1 = [int(v) for v in a['bbox']]
        reg[max(y0, 0):min(y1, H), max(x0, 0):min(x1, W)] = True
        reg[WINBAR[1]:WINBAR[3], WINBAR[0]:WINBAR[2]] = False
        for o in anchors:
            if o['R'] is not None and o['id'] != a['id']:
                reg &= (xx + 0.5 - o['centre'][0]) ** 2 + (yy + 0.5 - o['centre'][1]) ** 2 > (o['R'] + 2) ** 2
        regions[a['id']] = reg
        hulls[a['id']] = reg & ((xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2 <= (1.1 * R) ** 2)

    def silhouette(m, aid):
        """Holes filled, plus the convex hull of m near the dial (a dial is a disc; the hull closes a bezel the
        bench draws in the background's colour, as on the minis' right side)."""
        s = fill_holes(m) & regions[aid]
        pts = np.argwhere(m & hulls[aid])
        if len(pts) >= 3:
            hull = cv2.convexHull(pts[:, ::-1].astype(np.int32))
            hm = np.zeros((H, W), np.uint8)
            cv2.fillConvexPoly(hm, hull, 1)
            s |= hm.astype(bool) & regions[aid]
        return s

    U = {'all_unfilled': raster([comp[i] for i in keep]),
         'baked_unfilled': raster([comp[i] for i in keep if byid[i]['source'] == 'baked'])}
    MS = {aid: {'all': silhouette(U['all_unfilled'], aid), 'baked_only': silhouette(U['baked_unfilled'], aid)}
          for aid in regions}
    refs = {}
    for r in REFS:
        shot = np.asarray(Image.open(p(r)).convert('RGB')).astype(np.int16)
        diff = np.abs(shot - bgc).max(-1)
        content = diff > CONTENT_T
        dials, BS = {}, {}
        for a in anchors:
            if a['R'] is None:
                continue
            aid = a['id']
            reg = regions[aid]
            b = silhouette(content, aid)
            BS[aid] = b
            d = {'bbox': [int(v) for v in a['bbox']], 'region_px': int(reg.sum())}
            for name in ('all', 'baked_only'):
                m = MS[aid][name]
                inter, uni = int((b & m).sum()), int((b | m).sum())
                d[name] = {'iou': round(inter / uni, 4) if uni else None, 'bench_px': int(b.sum()),
                           'mask_px': int(m.sum()), 'bench_only_px': int((b & ~m).sum()),
                           'mask_only_px': int((m & ~b).sum())}
            c = content & reg
            d['visible_content_px'] = int(c.sum())
            d['visible_content_inside_masks'] = round(float((c & U['all_unfilled']).sum()) / max(int(c.sum()), 1), 4)
            d['pass'] = bool(d['all']['iou'] is not None and d['all']['iou'] >= 0.95)
            dials[aid] = d
        refs[r] = {'dials': dials, 'mean_iou_all': round(float(np.mean([d['all']['iou'] for d in dials.values()])), 4),
                   'background_residual_p99_outside_ours': float(np.percentile(diff[bare], 99)),
                   'background_residual_max_outside_ours': int(diff[bare].max())}
        refs[r]['_arrays'] = (shot, content, BS)
    used = REFS[0]
    res = {
        'reference': used,
        'reference_why': (
            '%s is the newest bench screenshot of wb_comfort (Nov 11 23:02, after the P10 levels that commit cd6ac29 '
            'shipped); its dial geometry is the same as %s (the two differ only in brightness levels, mostly in the '
            'window). Both are scored below; the verdict uses the first.' % (REFS[0], REFS[1])),
        'compared': (
            'Reference: an RGB bench screenshot of the whole wb_comfort layout (default settings: baked on, stockMap '
            'off; backdrop off). Its background is WBBACK\'s panel background, i.e. the C10 layer, so "our pixels" '
            'are those that differ from C10 (upscaled bilinear) by more than %d in any channel; outside our dials '
            'and window that residual is at most background_residual_max_outside_ours. Parts of our dials are as '
            'dark as the background (the lower face halves; the minis\' bezels on their right side), so both sides '
            'are compared as silhouettes: holes not connected to the panel edge are filled, and the convex hull of '
            'the pixels within 1.1 R of the dial centre is added (a dial is a disc). Export side: the union of the '
            'shapes of every element except C10.panel.background and w.bg (mask alpha >= %d, or the bbox when mask '
            'is null; widgets hidden by their toggle with baked on left out), same silhouette rule. IoU inside each '
            'dial anchor\'s bbox, less WBBACK\'s window + bar area %s (dark, partly background-coloured on the '
            'bench, and under the dials) and less the other dials\' discs (region_px). "all" is the acceptance '
            'number (as exported: baked masks + the live dials\' shader discs + live bboxes). "baked_only" leaves '
            'every live widget out: an independent check of the baked layers\' placement and 1/scale against what '
            'the bench drew. visible_content_inside_masks: the share of the screenshot\'s visible pixels in the '
            'region (no filling) that fall inside the unfilled mask union.' % (CONTENT_T, THR, list(WINBAR))),
        'content_threshold': CONTENT_T, 'mask_threshold': THR,
        'dials': refs[used]['dials'],
        'by_reference': {r: {k: v for k, v in d.items() if k != '_arrays'} for r, d in refs.items()},
        'scene_textures_vs_baked_masks': scene_check(layout, comp, els),
    }
    with open(p(WORK + '/wb_export_qc.json'), 'w') as f:
        json.dump(res, f, indent=1)
    shot, content, BS = refs[used]['_arrays']
    sheet(shot, BS, MS, regions, U, res['dials'])
    return res


def diff_img(B, M):
    """white: both; green: bench only; magenta: mask only."""
    o = np.zeros(B.shape + (3,), np.uint8)
    o[B & M] = (200, 200, 200)
    o[B & ~M] = (40, 220, 60)
    o[M & ~B] = (230, 40, 220)
    return o


def label(img, text, y=22, scale=0.6):
    cv2.putText(img, text, (8, y), cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(img, text, (8, y), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 0), 1, cv2.LINE_AA)


def outline_on(shot, M):
    """The screenshot (brightened) with the mask union's outline in magenta."""
    img = np.clip(shot.astype(np.float32) * 1.6 + 10, 0, 255).astype(np.uint8).copy()
    edge = M & ~cv2.erode(M.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    img[edge] = (255, 0, 255)
    return img


def sheet(shot, BS, MS, regions, U, dials):
    half = (W // 2, H // 2)
    t1 = cv2.resize(outline_on(shot, U['all_unfilled']), half, interpolation=cv2.INTER_AREA)
    label(t1, 'reference shot + mask union outline (magenta)')
    big = np.zeros((H, W, 3), np.uint8)
    for aid, reg in regions.items():
        big[reg] = diff_img(BS[aid], MS[aid]['all'])[reg]
    big[~np.any(list(regions.values()), axis=0)] = (25, 25, 60)
    t2 = cv2.resize(big, half, interpolation=cv2.INTER_NEAREST)
    label(t2, 'dial silhouettes: white both, green bench only, magenta mask only; blue: not judged')
    top = np.hstack([t1, t2])
    tiles = []
    for name, d in dials.items():
        x0, y0, x1, y1 = [max(v, 0) for v in d['bbox']]
        x1, y1 = min(x1, W), min(y1, H)
        reg = regions[name][y0:y1, x0:x1]
        a = diff_img(BS[name][y0:y1, x0:x1], MS[name]['all'][y0:y1, x0:x1])
        a[~reg] = (25, 25, 60)
        b = outline_on(shot[y0:y1, x0:x1], U['all_unfilled'][y0:y1, x0:x1])
        pair = []
        for img, txt in ((a, '%s IoU %.4f (baked_only %.4f)' % (name, d['all']['iou'], d['baked_only']['iou'])),
                         (b, '%s: shot + mask outline' % name)):
            interp = cv2.INTER_NEAREST if img.shape[0] < 480 else cv2.INTER_AREA
            img = cv2.resize(img, (480, 480), interpolation=interp)
            label(img, txt, scale=0.5)
            pair.append(img)
        tiles.append(np.hstack(pair))
    grid = np.vstack([np.hstack(tiles[:2]), np.hstack(tiles[2:4])])
    width = max(top.shape[1], grid.shape[1])
    pad = lambda im: np.hstack([im, np.zeros((im.shape[0], width - im.shape[1], 3), np.uint8)]) if im.shape[1] < width else im
    Image.fromarray(np.vstack([pad(top), pad(grid)])).save(p(WORK + '/wb_export_qc.png'), optimize=True)


# ---------------------------------------------------------------- export

def export():
    stack = load_json(STACK)
    layout = load_json(LAYOUT)
    if os.path.isdir(p(MASKS)):
        for f in os.listdir(p(MASKS)):
            if f.endswith('.png'):
                os.remove(os.path.join(p(MASKS), f))
    os.makedirs(p(MASKS), exist_ok=True)
    os.makedirs(p(WORK), exist_ok=True)
    anchors = anchors_from(layout)
    comp = {}
    baked = baked_elements(stack, layout, anchors, comp)
    live = live_elements(layout, anchors, comp)
    els = baked + live
    doc = {
        '$comment': 'Our 6WB Comfort elements on the panel target. Written by tools/overlay/export_wb.py (package C); '
                    'do not edit by hand, re-run the script. Baked: one element per layer of %s (id C<n>.<layer>, '
                    'mask = the layer alpha at 1x clipped to what its drawing widget shows, bbox trimmed to alpha > '
                    '0). Live: one per widget of %s (id w.<widget>, z = layout z + 100, bbox = the layout box; dials '
                    'carry their shader disc as mask, the rest are bbox-only). Default settings: baked on, stockMap '
                    'off. See README.md.' % (STACK, LAYOUT),
        'kind': 'wb-elements', 'schema_version': 1, 'mode': 'comfort', 'target': 'panel',
        'panel': {'w': W, 'h': H},
        'sources': [
            {'file': STACK, 'note': 'the 44 baked layers (P9)'},
            {'file': LAYOUT, 'note': 'the 52 live widgets (generated by design/gen_6wb.py)'},
            {'file': 'tools/bake_scene.py', 'note': 'how the baked layers are placed (1/scale, bilinear) and which '
                                                     'scene texture / widget draws them'},
            {'file': 'shared/shaders.js', 'note': 'wbdial: the dial widgets draw an opaque disc R = w/2 - 1'},
            {'file': REFS[0], 'note': 'QC reference (bench screenshot, git-ignored)'},
        ],
        'anchors': anchors,
        'elements': els,
    }
    with open(p(OUT_JSON), 'w') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write('\n')
    nm = sum(1 for e in els if e['mask'])
    size = sum(os.path.getsize(p(e['mask'])) for e in els if e['mask'])
    print('%s: %d elements (%d baked, %d live), %d anchors, %d masks, %d bytes'
          % (OUT_JSON, len(els), len(baked), len(live), len(anchors), nm, size))
    print('live with masks: %s' % ', '.join(e['id'] for e in live if e['mask']))
    res = qc(layout, els, comp, anchors)
    if res:
        for r, d in res['by_reference'].items():
            print('  ref %s: residual outside ours p99 %.1f max %d' % (r, d['background_residual_p99_outside_ours'],
                                                                   d['background_residual_max_outside_ours']))
            for k, v in d['dials'].items():
                print('    %-10s IoU all %.4f  baked_only %.4f  visible inside masks %.4f  %s'
                      % (k, v['all']['iou'], v['baked_only']['iou'], v['visible_content_inside_masks'],
                         'pass' if v['pass'] else 'FAIL'))
        for t, v in res['scene_textures_vs_baked_masks'].items():
            print('  scene %-12s IoU %s' % (t, v['iou']))


# ---------------------------------------------------------------- bench capture (CDP)

class CDP:
    def __init__(self, ws_url):
        import websocket
        self.ws = websocket.create_connection(ws_url, timeout=60, suppress_origin=True)
        self.n = 0

    def call(self, method, **params):
        self.n += 1
        mid = self.n
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get('id') == mid:
                if 'error' in m:
                    raise RuntimeError('%s: %s' % (method, m['error']))
                return m.get('result', {})

    def js(self, expr):
        r = self.call('Runtime.evaluate', expression=expr, returnByValue=True, awaitPromise=True)
        if 'exceptionDetails' in r:
            raise RuntimeError('js: %s' % r['exceptionDetails'])
        return r['result'].get('value')


CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def grab(cdp):
    url = cdp.js("document.getElementById('hud').toDataURL('image/png')")
    raw = base64.b64decode(url.split(',', 1)[1])
    import io
    return np.asarray(Image.open(io.BytesIO(raw)).convert('RGBA'))


def layers_text(cdp):
    return cdp.js("(document.getElementById('layers')||{}).textContent||''")


def settle(cdp, before_layers, before_img, min_wait=1.5, change_wait=10.0, still_wait=30.0):
    """Wait for the page to pick up the new layout (the layers table or the canvas changes, up to change_wait s),
    then until the canvas stays the same for 3 grabs in a row (up to still_wait s). Returns (image, settled)."""
    time.sleep(min_wait)
    t0 = time.time()
    if before_layers is not None:
        while time.time() - t0 < change_wait:
            if layers_text(cdp) != before_layers:
                break
            img = grab(cdp)
            if before_img is not None and not np.array_equal(img, before_img):
                break
            time.sleep(0.3)
    t0 = time.time()
    last, still = grab(cdp), 0
    while time.time() - t0 < still_wait:
        time.sleep(0.4)
        img = grab(cdp)
        if np.array_equal(img, last):
            still += 1
            if still >= 3:
                return img, True
        else:
            still = 0
        last = img
    return last, False


def write_override(layout, keep):
    d = dict(layout)
    d['widgets'] = [w for w in layout['widgets'] if keep(w)]
    os.makedirs(os.path.dirname(p(OVERRIDE)), exist_ok=True)
    tmp = p(OVERRIDE) + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(d, f)
    os.replace(tmp, p(OVERRIDE))


def capture(base_url, only=None):
    layout = load_json(LAYOUT)
    os.makedirs(p(CAP), exist_ok=True)
    try:
        urllib.request.urlopen(base_url + '/', timeout=5).read(100)
    except Exception as ex:  # noqa: BLE001
        raise SystemExit('no bench at %s (%s): start it first (see the docstring)' % (base_url, ex))
    req = urllib.request.Request(base_url + '/signals', data=json.dumps({'mode': 'manual', 'values': SIGNALS}).encode(),
                                 method='POST')
    urllib.request.urlopen(req, timeout=5).read()
    udd = p(WORK + '/chrome-C')
    port = 9337
    chrome = subprocess.Popen([CHROME, '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                               '--window-size=1920,720', '--remote-debugging-port=%d' % port,
                               '--user-data-dir=' + udd, '--no-first-run', '--no-default-browser-check',
                               'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws = None
        for _ in range(60):
            try:
                tabs = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json' % port, timeout=2))
                ws = next(t['webSocketDebuggerUrl'] for t in tabs if t.get('type') == 'page')
                break
            except Exception:  # noqa: BLE001
                time.sleep(0.5)
        if not ws:
            raise SystemExit('headless Chrome did not come up')
        cdp = CDP(ws)
        cdp.call('Page.enable')
        cdp.call('Page.navigate', url=base_url + '/?only=1&clean=1&car=0')
        time.sleep(3)
        jobs = [('full', lambda w: True), ('nobg', lambda w: w['id'] != 'bg')]
        jobs += [('w.' + w['id'], (lambda wid: (lambda x: x['id'] == wid))(w['id'])) for w in layout['widgets']]
        if only:
            jobs = [j for j in jobs if j[0] in only]
        log = {}
        prev = None
        for name, keep in jobs:
            before = layers_text(cdp)
            write_override(layout, keep)
            img, ok = settle(cdp, before if prev is not None else None, prev)
            prev = img
            Image.fromarray(img, 'RGBA').save(p('%s/%s.png' % (CAP, name)), optimize=False)
            ink = int((img[..., 3] >= THR).sum())
            log[name] = {'settled': ok, 'ink_px': ink}
            print('captured %-14s ink %7d px %s' % (name, ink, '' if ok else '(did not settle)'))
            sys.stdout.flush()
        with open(p(CAP + '/capture_log.json'), 'w') as f:
            json.dump({'url': base_url, 'signals': SIGNALS, 'jobs': log}, f, indent=1)
    finally:
        try:
            os.remove(p(OVERRIDE))
        except OSError:
            pass
        chrome.terminate()
        try:
            chrome.wait(5)
        except subprocess.TimeoutExpired:
            chrome.kill()
        shutil.rmtree(udd, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--capture', action='store_true', help='UNTESTED: render widgets on a bench you started yourself first (see the docstring)')
    ap.add_argument('--bench', default='http://localhost:8078')
    ap.add_argument('--only', nargs='*', help='with --capture: only these capture names (full, nobg, w.<id>)')
    a = ap.parse_args()
    if a.capture:
        capture(a.bench, a.only)
    export()


if __name__ == '__main__':
    main()
