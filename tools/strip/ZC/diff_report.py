"""Package ZC: print the defect table from bake/work/strip/zone-c/diff.json (one row per distinct map x photo)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zc_common as Z  # noqa: E402

d = json.load(open(os.path.join(Z.WORK, 'zone-c', 'diff.json')))
print('sources', d['sources'])
print('identical map groups:')
for k, v in d['identical_maps'].items():
    print('  ', k, sorted(set(v)))
done = set()
for c in d['cases']:
    key = (c['mode'], c['maps_hash'], c['photo'], c['state'] in ('msg-latched', 'road-latched-msg', 'standby'))
    if key in done:
        continue
    done.add(key)
    print('==', c['layout'], c['mode'], c['state'], 'photo', c['photo'])
    for el, r in c['elements'].items():
        s = {k: v for k, v in r.items() if k != 'must'}
        flag = 'CLIP' if r.get('CLIP_px', 0) > 0 else ('LEAK' if r.get('LEAK_px', 0) > 0 else '')
        print('   %-28s %-5s %-4s %s' % (el, r['must'], flag, s))
    if c['DOUBLE']:
        print('   DOUBLE', c['DOUBLE'])
    for s in c['SEAMS_top'][:int(sys.argv[1]) if len(sys.argv) > 1 else 4]:
        print('   seam', s)
