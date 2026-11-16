#!/usr/bin/env python3
"""The strip lead (2026-11-16): the final shape list for the strip mask, from the three zone proposals and the owner's
decisions. Writes design/strip/mask_final.json in tools/strip/bake_mask.py's input schema; bake it with

    python3 tools/strip/lead_shapes.py                  # -> design/strip/mask_final.json
    python3 tools/strip/bake_mask.py design/strip/mask_final.json
    python3 tools/strip/bake_mask.py design/strip/mask_final.json --marker   # with the marker lanes (config.ccMarker)

Inputs (tracked copies, identical to bake/work/strip/pub/Z*/mask_proposal.json): design/strip/ZL, ZC, ZR
mask_proposal.json. Each zone writes its channels its own way; here they are normalised:
  - the zones' "bmw_msg" for a COVER-lane hole means "the bmw lane while a message shows" - the shader multiplies the
    bmw lane by the msg lane, so such a hole is the bmw lane's own and is not repeated. Only ZC's panel is the msg lane;
  - a rect with a corner radius becomes a polygon (arcs every 10 degrees);
  - ZC's "feather_per_edge_in_out_px" is bake_mask's "per_edge".
What the lead changed, and why (docs: the lead's report):
  1. Cover: every cover lane is opaque over the whole strip from y 596 down (zone L x 0-690, ZC's own cover x 690-1250,
     zone R x 1250-1920). ZL and ZR say "opaque everywhere except the holes" but list only holes; ZC's cover starts at y
     596 under the map window's foot, so L and R start there too (under our dials that is black under black).
  2. Decision 1: the sign hole on the one centre (538.45, 621.2), hard edge r 41.8, 0.3 + 0.3 px (ZL, unchanged).
  3. Decision 2: no hole for BMW's mode label in any lane (ZR's L-shape and its alternative are dropped).
  4. Decision 7: no hole for BMW's marker by default (ZR's info_tacho). With --marker it becomes the "mark" hole lane,
     used only while config.ccMarker confirms the marker (shared/hud.js _markShown).
  5. ZC's pre-open band [757, 653, 1178, 700] in the bmw lane, so BMW's message is never clipped in the frames before
     the msg lane opens: between the hooks and under the rails, it exposes nothing the road-label hole does not.
  6. The belt hole is the whole group [500.5, 664.25, 684.25, 715.5] + 3 px - and + 3 px round ZL's own photo footprint
     of the lamps (their ink above 2 % with its blur and halo: rear x 497-583.75 from y 674.25, driver x 586.5-632.25
     from y 661.0, airbag x 629.25-687.75 from y 660.75; tools/strip/ZL/diff.py's SAFETY zone) - rounded OUT to whole
     px so no pixel that touches either footprint carries any black: x 497-688, y 660-720, with ZL's notch over the
     rear belts (x < 586 from y 674). ZL's polygon ended at x 683.25, 4 px short of the airbag's 684.25 + 3, and the
     first bake (y 661, x 587) left 6.4 px of black on ZL's photo footprint.
  7. Every other zone shape as proposed; where two met: ZC's panel stays left of x 1222 below y 640 (ZR's rail stub,
     checked by bake_mask.py), and nothing over x 587-683 comes below y 661.25 (ZL).
  8. The standby lane is the bmw lane (see main(): the dial's closed disc shuts the sign seat in standby, and the bmw
     lane's holes already open the odometer), which saves one tile.
"""
import json
import math
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
Z = {z: json.load(open(os.path.join(ROOT, 'design', 'strip', z, 'mask_proposal.json')))['shapes'] for z in ('ZL', 'ZC', 'ZR')}
COVER_TOP = 596
SIGN = [538.45, 621.2, 41.8]
BELTS = [[497, 674], [586, 674], [586, 660], [688, 660], [688, 720], [497, 720]]
PRE_OPEN = [757, 653, 1178, 700]


def rounded(r, rad, step=10):
    """A rect [x0, y0, x1, y1] with corners of radius rad, as a polygon (clockwise, y down)."""
    x0, y0, x1, y1 = r
    if not rad:
        return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    pts = []
    for cx, cy, a0 in ((x1 - rad, y0 + rad, -90), (x1 - rad, y1 - rad, 0), (x0 + rad, y1 - rad, 90), (x0 + rad, y0 + rad, 180)):
        for k in range(0, 91, step):
            a = math.radians(a0 + k)
            pts.append([round(cx + rad * math.cos(a), 3), round(cy + rad * math.sin(a), 3)])
    return pts


def shape(id_, channel, kind, geom, fi=0.0, fo=0.0, src='', **kw):
    d = {'id': id_, 'channel': channel, 'kind': kind, 'feather_in_px': fi, 'feather_out_px': fo, 'source': src}
    d.update(geom)
    d.update(kw)
    return d


def by(z, i):
    return next(s for s in Z[z] if s['id'] == i)


def main(out):
    S = []
    # covers: every cover lane opaque over the strip from y 596 (lead item 1; ZC's own cover in the middle)
    zc = by('ZC', 'zc.cover')
    S.append(shape('lead.cover.L', 'all', 'cover', {'rect': [0, COVER_TOP, 690, 720]}, src='lead: zone L, opaque but for its holes (ZL)'))
    S.append(shape('zc.cover', 'all', 'cover', {'polygon': zc['polygon']}, src='ZC'))
    S.append(shape('lead.cover.R', 'all', 'cover', {'rect': [1250, COVER_TOP, 1920, 720]}, src='lead: zone R, opaque but for its holes (ZR)'))
    st = by('ZR', 'rail.right.stub')
    S.append(shape('rail.right.stub', 'all', 'cover', {'polygon': st['polygon']}, src='ZR'))
    # zone L (ZL): the sign (bmw only: shut in standby and ours), range and clock (bmw, standby), the belts (every lane)
    sg = by('ZL', 'assist.speed_limit')
    assert sg['circle'] == SIGN, 'ZL moved the sign: %r' % sg['circle']
    S.append(shape('assist.speed_limit', 'bmw', 'hole', {'circle': SIGN}, sg['feather_in_px'], sg['feather_out_px'], 'ZL; decision 1'))
    for i in ('bottom.range', 'bottom.clock'):
        s = by('ZL', i)
        for ch in ('bmw', 'standby'):
            S.append(shape(i, ch, 'hole', {'polygon': rounded(s['rect'], s.get('corner_r', 0))}, s['feather_in_px'], s['feather_out_px'], 'ZL'))
    for ch in ('ours', 'bmw', 'standby'):
        S.append(shape('belt_group', ch, 'hole', {'polygon': BELTS}, 0, 0, 'ZL, rounded out (lead item 6)'))
    # zone C (ZC): the panel (the msg lane), the road label (bmw), the pre-open band (bmw), the odometer (standby)
    p = by('ZC', 'zc.panel')
    # ZC lists one feather pair more than its polygon has edges; its own raster (tools/strip/ZC/mask.py dist_poly) gives
    # edge i (vertex i to i + 1) pair i and never reads the last, so the pairs ZC checked against the photos are these
    S.append(shape('zc.panel', 'bmw_msg', 'hole', {'polygon': p['polygon'], 'per_edge': p['feather_per_edge_in_out_px'][:len(p['polygon'])]}, src='ZC'))
    s = by('ZC', 'zc.street')
    S.append(shape('zc.street', 'bmw', 'hole', {'polygon': s['polygon']}, s['feather_in_px'], s['feather_out_px'], 'ZC'))
    S.append(shape('zc.text_band', 'bmw', 'hole', {'rect': PRE_OPEN}, 0, 1.0, 'ZC section 4 alternative; the lead\'s decision'))
    s = by('ZC', 'zc.odometer')
    S.append(shape('zc.odometer', 'standby', 'hole', {'polygon': s['polygon']}, s['feather_in_px'], s['feather_out_px'], 'ZC'))
    # zone R (ZR): the temperature (bmw, standby); no mode label (decision 2); the marker only as the optional lane
    t = by('ZR', 'bottom.temperature')
    xs, ys = [q[0] for q in t['polygon']], [q[1] for q in t['polygon']]
    for ch in ('bmw', 'standby'):
        S.append(shape('bottom.temperature', ch, 'hole', {'polygon': rounded([min(xs), min(ys), max(xs), max(ys)], t.get('corner_radius_px', 0))},
                       t['feather_in_px'], t['feather_out_px'], 'ZR'))
    m = by('ZR', 'assist.info_tacho')
    S.append(shape('assist.info_tacho', 'mark', 'hole', {'polygon': m['polygon']}, m['feather_in_px'], m['feather_out_px'],
                   'ZR; decision 7: baked only with --marker, opened only by config.ccMarker'))
    # lead item 8: the standby lane is the bmw lane, shape for shape. What the zones' standby lane did differently is
    # done already: ZL shut the sign hole (the rail runs through the sign's seat in standby) - in standby the speedo
    # closes its own round window (WBDIAL u_cut mode 3, hud.js _standbyNow), opaque to r 51.6 round the sign, above this
    # layer; ZC opened the odometer [793, 661.5, 1095, 701] - its ink (x 807-1079, y >= 667) lies inside the bmw lane's
    # road-label hole and pre-open band; the rest of what bmw opens more (y 653-711 between the hooks) is BMW's black in
    # standby. One tile fewer: 0.45 MiB of pixel memory. (The lane keeps its name, so a later bake can split them again.)
    S = [s for s in S if s['channel'] != 'standby']
    S += [dict(s, channel='standby', source=s['source'] + '; standby = bmw (lead item 8)') for s in S if s['channel'] == 'bmw']
    doc = {'_about': __doc__.split('\n')[0] + ' Made by tools/strip/lead_shapes.py; see its docstring for every change against the zones.',
           'sign': {'centre': SIGN[:2], 'edge_r': SIGN[2], 'feather': [0.3, 0.3]},
           'dropped': {'assist.mode_label': 'decision 2: BMW\'s mode label stays covered in allG20, no hole in any lane',
                       'assist.info_tacho (default bake)': 'decision 7: covered by default; the "mark" lane only with --marker'},
           'shapes': S}
    with open(out, 'w') as f:
        json.dump(doc, f, indent=1)
        f.write('\n')
    print('%s: %d shapes' % (os.path.relpath(out, ROOT), len(S)))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'design', 'strip', 'mask_final.json'))
