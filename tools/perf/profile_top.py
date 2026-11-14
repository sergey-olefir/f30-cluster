#!/usr/bin/env python3
"""Top self and inclusive time of a .cpuprofile (bench only): python3 -I tools/perf/profile_top.py <file> [n]"""
import json
import os
import sys
from collections import defaultdict

p = json.load(open(sys.argv[1]))
N = int(sys.argv[2]) if len(sys.argv) > 2 else 20
nodes = {x['id']: x for x in p['nodes']}
parent = {}
for x in p['nodes']:
    for c in x.get('children', []):
        parent[c] = x['id']


def key(n):
    cf = nodes[n]['callFrame']
    return '%s %s:%d' % (cf['functionName'] or '(anon)', os.path.basename(cf['url']), cf['lineNumber'] + 1)


self_us, incl = defaultdict(float), defaultdict(float)
for sid, d in zip(p['samples'], p['timeDeltas']):
    self_us[key(sid)] += d
    seen, n = set(), sid
    while n in nodes:
        k = key(n)
        if k not in seen:
            incl[k] += d
            seen.add(k)
        n = parent.get(n)
tot = sum(p['timeDeltas'])
idle = self_us.get('(idle) :0', 0)
print('sampled %.0f ms, busy %.0f ms (%.1f %%)' % (tot / 1e3, (tot - idle) / 1e3, 100 * (tot - idle) / tot))
print('-- self time')
for k, v in sorted(self_us.items(), key=lambda kv: -kv[1])[:N]:
    print('  %-64s %8.1f ms' % (k[:64], v / 1e3))
print('-- inclusive time')
for k, v in sorted(incl.items(), key=lambda kv: -kv[1])[:N + 10]:
    print('  %-64s %8.1f ms' % (k[:64], v / 1e3))
