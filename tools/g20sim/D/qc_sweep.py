"""The owner's question (package D): where do the stock pointers (bar, glow) and mini needles pass relative to the
wb_dials cut at y 656 and the collar? Summarises the harness 'sweep' run (headless Chrome, our module's own drawing):
speed 0..260 by 2, rpm 0..7000 by 50 (bar stock / connected, glow), fuel 0..65 L by 1, oil 60..150 degC by 1.

  tools/g20sim/D/py tools/g20sim/D/qc_sweep.py [sweep.html ...]

Per value: n (pixels), maxY, belowCut (y >= 656), outsideOurs (not under our dials, plan_dials U), visible (outside our
dials AND outside the collar), visibleBelowCut. Bar/needle pixels: alpha > 25/255; glow pixels: any channel >= thr/255
(added light at glow gain 1).
"""
import html
import json
import os
import re
import sys

WT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
H = os.path.join(WT, 'bake', 'work', 'g20sim', 'D', 'harness')


def load(p):
    dom = open(p).read()
    return json.loads(html.unescape(re.search(r'<pre id="out"[^>]*>(.*?)</pre>', dom, re.S).group(1)))


def main():
    files = sys.argv[1:] or [os.path.join(H, 'sweep.html')]
    summary = {}
    for f in files:
        res = load(f)
        groups = {}
        for w, v, part, state, st in res['rows']:
            groups.setdefault((w, part, state), []).append((v, st))
        print('== %s (glow threshold %d/255)' % (os.path.basename(f), res['thr']))
        print('%-6s %-7s %-9s %6s %8s %9s %10s %9s %12s  %s' % ('what', 'part', 'state', 'maxY', '@value', 'belowCut', 'outsideOur', 'visible', 'visibleBelow', 'values with visible px'))
        for (w, part, state), rows in groups.items():
            my = max(rows, key=lambda r: r[1]['maxY'])
            bc = max(r[1]['belowCut'] for r in rows)
            oo = max(r[1]['outsideOurs'] for r in rows)
            vi = max(rows, key=lambda r: r[1]['visible'])
            vb = max(r[1]['visibleBelowCut'] for r in rows)
            vis_vals = [r[0] for r in rows if r[1]['visible'] > 0]
            rng = '%g..%g (%d of %d)' % (min(vis_vals), max(vis_vals), len(vis_vals), len(rows)) if vis_vals else 'none'
            print('%-6s %-7s %-9s %6d %8g %9d %10d %5d @%-5g %10d  %s' % (w, part, state, my[1]['maxY'], my[0], bc, oo, vi[1]['visible'], vi[0], vb, rng))
            summary['%s.%s.%s.thr%d' % (w, part, state, res['thr'])] = dict(
                maxY=my[1]['maxY'], maxY_at=my[0], max_belowCut=bc, max_outsideOurs=oo, max_visible=vi[1]['visible'],
                max_visible_at=vi[0], max_visibleBelowCut=vb, visible_values=rng,
                maxY_visible=max(r[1]['maxYvisible'] for r in rows))
    json.dump(summary, open(os.path.join(os.path.dirname(H), 'qc_sweep.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
