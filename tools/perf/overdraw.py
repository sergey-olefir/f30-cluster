#!/usr/bin/env python3
"""Per layout: the layers that cover each panel pixel (tools/perf/probe_preload.js "layers" dumps; bench only).

    python3 -I tools/perf/overdraw.py <dir> [layouts...]  [--gpu <gpu dir>]

For every layout: effect and image layers, their area, the full-screen effects, the mean / max number of layers
over a pixel (the compositor blends every layer's whole rect, transparent pixels included), and with --gpu the
bench GPU timings (tools/perf/gpu_time.mjs) summed per layout."""
import json
import os
import sys

args = sys.argv[1:]
gpu_dir = None
if '--gpu' in args:
    i = args.index('--gpu')
    gpu_dir = args[i + 1]
    args = args[:i] + args[i + 2:]
D = args[0]
LAYOUTS = args[1:] or ['wb_comfort', 'wb_dials', 'g20_comfort', 'wb_sport', 'wb_sport_dials', 'wb_eco', 'f30']
W, H, S = 1920, 720, 4          # a 480 x 180 grid of 4x4 px cells
print('%-15s %4s %4s %4s %10s %10s %6s %8s %6s %6s %s' % ('layout', 'eff', 'img', 'full', 'eff px', 'img px', 'eff/sc', 'mean ovd', 'max', '>=3 %', 'gpu ms (bench: metal / swiftshader)'))
for L in LAYOUTS:
    f = os.path.join(D, L + '.layers.json')
    if not os.path.exists(f):
        continue
    j = json.load(open(f))
    ls = [l for l in j['layers'] if l['kind'] in ('effect', 'image') and l.get('visible', True)]
    grid = [[0] * (W // S) for _ in range(H // S)]
    eff_px = img_px = full = 0
    for l in ls:
        x0, y0 = max(0, l['x']), max(0, l['y'])
        x1, y1 = min(W, l['x'] + l['w']), min(H, l['y'] + l['h'])
        a = max(0, x1 - x0) * max(0, y1 - y0)
        if l['kind'] == 'effect':
            eff_px += a
            if a >= 0.5 * W * H:
                full += 1
        else:
            img_px += a
        for gy in range(y0 // S, (y1 + S - 1) // S):
            row = grid[gy]
            for gx in range(x0 // S, (x1 + S - 1) // S):
                row[gx] += 1
    cells = [c for row in grid for c in row]
    mean = sum(cells) / len(cells)
    ge3 = 100.0 * sum(1 for c in cells if c >= 3) / len(cells)
    g = ''
    for tag in ('metal', 'swift'):
        gf = os.path.join(gpu_dir, L + '.' + tag + '.json') if gpu_dir else None
        if gf and os.path.exists(gf):
            r = json.load(open(gf))
            rows = r.get('rows') or []
            g += ' %s %.3f' % (tag, sum((x['ms'] or 0) for x in rows))
    print('%-15s %4d %4d %4d %10d %10d %6.2f %8.2f %6d %6.1f%s' % (
        L, sum(1 for l in ls if l['kind'] == 'effect'), sum(1 for l in ls if l['kind'] == 'image'), full,
        eff_px, img_px, eff_px / (W * H), mean, max(cells), ge3, g))
    for l in sorted(ls, key=lambda l: -(l['w'] * l['h'])):
        if l['kind'] == 'effect':
            print('    effect %d:%-3d %4dx%-4d at %4d,%-4d %-44s fs %6d B binds %s' % (
                l['ci'], l['ref'], l['w'], l['h'], l['x'], l['y'], ','.join(l['widgets'])[:44], len(l.get('fs') or ''), ','.join(l['binds'])))
