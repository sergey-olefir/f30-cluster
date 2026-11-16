"""Package ZC: the compact defect table from bake/work/strip/zone-c/diff.json: one row per (layout, mode, group of
states with identical maps), each element's worst CLIP / LEAK over the photos of that state, DOUBLE, top seams."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zc_common as Z  # noqa: E402

d = json.load(open(os.path.join(Z.WORK, 'zone-c', 'diff.json')))
groups = {}
for c in d['cases']:
    k = (c['layout'], c['mode'], c['maps_hash'], c['state'] in ('msg-latched', 'road-latched-msg'), c['state'] == 'unread')
    groups.setdefault(k, []).append(c)
for k, cs in groups.items():
    states = sorted(set(c['state'] for c in cs))
    print('== %s %s [%s] photos %s' % (k[0], k[1], ', '.join(states), ','.join(sorted(set(c['photo'] for c in cs)))))
    worst = {}
    for c in cs:
        for el, r in c['elements'].items():
            for f in ('CLIP_px', 'LEAK_px'):
                if r.get(f, 0) > 0.5:
                    w = worst.setdefault((el, f), {'v': 0})
                    if r[f] > w['v']:
                        w.update(v=r[f], photo=c['photo'], light=r.get('CLIP_light', r.get('LEAK_light')),
                                 box=r.get('CLIP_box', r.get('LEAK_box')))
    for (el, f), w in sorted(worst.items()):
        print('   %-24s %-5s %7.1f px  light %7.2f  box %s  (photo %s)' % (el, f[:4], w['v'], w['light'] or 0, w['box'], w['photo']))
    dbl = {}
    for c in cs:
        for x in c['DOUBLE']:
            dbl[x['ours']] = max(dbl.get(x['ours'], 0), x['bmw_visible_ink_px_within_3px'])
    if dbl:
        print('   DOUBLE', dbl)
    seen = []
    for c in cs:
        for s in c['SEAMS_top'][:4]:
            if s['dY_max_cell_p95'] >= 0.05 and s['box'] not in [t['box'] for t in seen]:
                seen.append(s | {'photo': c['photo']})
    for s in sorted(seen, key=lambda s: -s['dY_max_cell_p95'])[:5]:
        print('   SEAM box %s step %.2f (p95 %.2f) dE00 %.0f cells %d (photo %s)' % (
            s['box'], s['dY_max_cell_p95'], s['dY_p95'], s['dE00_p95'], s['cells_4px'], s['photo']))
