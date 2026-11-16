"""Package O: copy the rendered maps to bake/work/strip/pub/O/ for ZL, ZC and ZR, with an index, and touch READY.

    python3 tools/strip/O/publish.py <maps root> <snap root> [--ready]
"""
import json
import os
import shutil
import sys
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')
PUB = os.path.join(ROOT, 'bake', 'work', 'strip', 'pub', 'O')

ABOUT = """Package O: OUR coverage and colour over the STRIP (panel x 0-1920, y 540-720), per layout / mode / state.

Computed from the engine's own output on bench port 8161 (branch strip/O, base integrate/bottom-row 3c8ef46):
every layer's real fragment shader run on the GPU with its live uniforms and bound assets, image layers from GET /px,
stacked as bench/page.html stacks them. Checked against the owner's bench screenshot 69.png (all6WB, unread):
median |visible fraction obs - pred| 0.000, mean 0.009, the residue is dynamic text and needles.

maps/<layout>/<mode>/<state>/
  alpha_1x.png  uint16 grey 1920 x 180, our total coverage (65535 = opaque). Row 0 = panel y 540.
  alpha_4x.png  uint16 grey 7680 x 720, 4 x 4 samples per panel px (effects re-evaluated, images replicated)
  rgba_1x.png / rgba_4x.png  uint16 RGBA: straight colour (sRGB-coded, as sent to the display) + coverage
  maps_1x.npz   float32 alpha, prem (premultiplied sRGB rgb), lin (premultiplied linear rgb), a_<layer> per layer
  breakdown.json  each layer's role, rect, coverage, bbox, semi-transparent count, key uniforms; each text widget's ink box
Coordinates: continuous panel px, pixel (i, j) covers [i, i+1) x [j, j+1); boxes [x0, y0, x1, y1] half-open.
What shows of BMW = (1 - alpha) x BMW's light; what we add = prem (black where we cover with black).

layouts: wb_dials (6WB Comfort + G20), wb_sport_dials (6WB Sport + G20); modes: allG20, all6WB.
states (index.json has the engine's own report for each: own, fail, widgets, patches):
  unread            D, limit 50, road label, NO check-control message ever read (right after a restart) = 69.png
  drive             D, limit 50, road label, a message read and cleared
  drive-clock       as drive, the car's time zone known: our clock (all6WB)
  park              P, engine running
  msg / msg-long    D, a message showing (all6WB: ours drawn; allG20: BMW's)
  limit-unknown / limit-end / limit-none / nopass   sign states
  p-engine-off      P + rpm 0 as the app treats it today. NOT BMW's standby: photo 63 (P, engine off) still has
                    BMW's NORMAL row incl. its sign; only photo 65 is the standby row (VehicleCondition, hypothesis)
  msg-latched       all6WB: a message our fonts cannot draw -> info latched back to BMW (allG20: = msg)
  road-latched-msg  all6WB: a road label latched nav first, then a message (allG20: = msg)
"""


def main():
    maps, snaps = sys.argv[1], sys.argv[2]
    os.makedirs(PUB, exist_ok=True)
    dst = os.path.join(PUB, 'maps')
    for lay in sorted(os.listdir(maps)):
        src = os.path.join(maps, lay)
        if os.path.isdir(src):
            if os.path.exists(os.path.join(dst, lay)):
                shutil.rmtree(os.path.join(dst, lay))
            shutil.copytree(src, os.path.join(dst, lay))
    idx = json.load(open(os.path.join(snaps, 'index.json'))) if os.path.exists(os.path.join(snaps, 'index.json')) else []
    old = os.path.join(PUB, 'index.json')
    if os.path.exists(old):
        prev = json.load(open(old))
        keys = set((r['layout'], r['mode'], r['state']) for r in idx)
        idx = [r for r in prev if (r['layout'], r['mode'], r['state']) not in keys] + idx
    idx = [r for r in idx if os.path.isdir(os.path.join(dst, r['layout'], r['mode'], r['state']))]
    for r in idx:
        r.pop('status', None)
    json.dump(idx, open(old, 'w'), indent=1)
    open(os.path.join(PUB, 'ABOUT.txt'), 'w').write(ABOUT + '\nupdated ' + time.strftime('%Y-%m-%d %H:%M:%S') + '\n')
    if '--ready' in sys.argv:
        open(os.path.join(PUB, 'READY'), 'w').write(time.strftime('%Y-%m-%d %H:%M:%S') + ' layouts: ' + ', '.join(sorted(os.listdir(dst))) + '\n')
    print('published', sorted(os.listdir(dst)), len(idx), 'states')


if __name__ == '__main__':
    main()
