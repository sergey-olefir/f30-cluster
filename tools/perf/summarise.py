#!/usr/bin/env python3
"""Summarise tools/perf/probe_preload.js dumps (bench only): python3 -I tools/perf/summarise.py <dir> [layouts...]

Prints, per layout: app CPU %, event-loop lag, the hud tick's real period, the top JS functions, the socket
traffic per connection and kind, the widgets with the most traffic, the needle's send rate and gaps, and the
cpuprofile's top self-time functions (when <layout>.cpuprofile is there)."""
import json
import os
import sys
from collections import defaultdict

D = sys.argv[1]
LAYOUTS = sys.argv[2:] or ['wb_comfort', 'wb_dials', 'g20_comfort', 'wb_sport', 'wb_sport_dials', 'wb_eco', 'f30']


def prof_top(path, n=12):
    p = json.load(open(path))
    nodes = {x['id']: x for x in p['nodes']}
    self_us = defaultdict(float)
    dt = p.get('timeDeltas', [])
    for sid, d in zip(p.get('samples', []), dt):
        nd = nodes[sid]
        cf = nd['callFrame']
        key = '%s %s:%d' % (cf['functionName'] or '(anon)', os.path.basename(cf['url']), cf['lineNumber'] + 1)
        self_us[key] += d
    total = sum(dt) or 1
    idle = sum(v for k, v in self_us.items() if k.startswith('(idle)'))
    busy = total - idle
    rows = sorted(((v, k) for k, v in self_us.items() if not k.startswith('(idle)')), reverse=True)[:n]
    return total / 1e3, busy / 1e3, [(k, v / 1e3, 100 * v / busy if busy else 0) for v, k in rows]


for L in LAYOUTS:
    f = os.path.join(D, L + '.dump.json')
    if not os.path.exists(f):
        continue
    d = json.load(open(f))
    print('=' * 100)
    print('%s  %.1f s  app CPU %.2f %% of one core (%s)  rss %.0f MB  pixel %.1f MiB' % (
        L, d['seconds'], d['cpuPct'], d['node'], d['rss'] / 1e6, (d.get('pixelBytes') or 0) / 1048576))
    print('  loop lag ms', d['lag'])
    print('  hud tick ms', d['tick'])
    print('  car samples', d['samples'])
    print('  JS functions (wall ms in %.0f s, n, max ms):' % d['seconds'])
    for k, v in sorted(d['fn'].items(), key=lambda kv: -kv[1]['ms'])[:14]:
        if k.endswith(' px'):
            print('    %-44s n=%6d  px total=%9d max=%6d' % (k, v['n'], v['ms'], v['max']))
        else:
            print('    %-44s n=%6d  %8.1f ms  max %6.2f  (%.3f %% of a core)' % (k, v['n'], v['ms'], v['max'], 100 * v['ms'] / (d['seconds'] * 1000)))
    print('  long tasks (>8 ms):', len(d['long']), d['long'][:6])
    tb = sum(c['bytes'] for c in d['conn'].values())
    tm = sum(c['msgs'] for c in d['conn'].values())
    print('  socket: %.0f B/s, %.1f msg/s in all' % (tb / d['seconds'], tm / d['seconds']))
    for c, v in sorted(d['conn'].items()):
        print('    %-16s %7.1f msg/s %8.0f B/s' % (c, v['msgs'] / d['seconds'], v['bytes'] / d['seconds']))
        for k, kv in sorted(v['kinds'].items(), key=lambda kv: -kv[1]['bytes'])[:6]:
            print('       %-26s %7.2f /s %8.0f B/s' % (k, kv['n'] / d['seconds'], kv['bytes'] / d['seconds']))
    print('  widgets by traffic:')
    for k, v in sorted(d['widgets'].items(), key=lambda kv: -kv[1]['bytes'])[:8]:
        print('    %-34s %7.2f /s %8.0f B/s' % (k, v['n'] / d['seconds'], v['bytes'] / d['seconds']))
    print('  needles:')
    for k, v in d['needle'].items():
        print('    %-22s %5.1f sends/s interval p50 %s p90 %s p99 %s max %s; gaps>80ms %d >120ms %d; step p50 %s max %s' % (
            k, v['perSec'], v['interval'].get('p50'), v['interval'].get('p90'), v['interval'].get('p99'), v['interval'].get('max'),
            v['gapsOver80ms'], v['gapsOver120ms'], v['step'].get('p50'), v['step'].get('max')))
    pf = os.path.join(D, L + '.cpuprofile')
    if os.path.exists(pf):
        total, busy, rows = prof_top(pf)
        print('  cpuprofile: %.0f ms sampled, %.0f ms busy (%.1f %%); top self time:' % (total, busy, 100 * busy / total))
        for k, ms, pct in rows:
            print('    %-60s %7.1f ms %5.1f %%' % (k[:60], ms, pct))
    tc = os.path.join(D, L + '.textcost.json')
    if os.path.exists(tc):
        t = json.load(open(tc))
        tot = sum(v['ms'] for v in t.values())
        top = sorted(t.items(), key=lambda kv: -kv[1]['ms'])[:5]
        print('  text repaint (forced, all %d text widgets once): %.2f ms; most: %s' % (
            len(t), tot, ', '.join('%s %.2f ms %dx%d' % (k, v['ms'], v['w'], v['h']) for k, v in top)))
