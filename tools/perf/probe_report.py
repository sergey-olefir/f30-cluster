#!/usr/bin/env python3
"""Summarise scripts/perf_probe.sh's raw car output (runs on the Mac, never on the car).

    python3 -I tools/perf/probe_report.py <probe-*.raw.txt> <seconds>

Prints: the CPU (model, cores), our app's and cluster-render's CPU (% of one core over the window, from
/proc/<pid>/stat), the whole unit's CPU busy %, the app's cgroup CPU limit and how often it was throttled,
memory, and the app log's perf / page-loop lines and cluster-render's per-minute write lines."""
import re
import sys

raw, secs = sys.argv[1], float(sys.argv[2])
sec = {}
name = None
for line in open(raw, encoding='utf-8', errors='replace'):
    line = line.rstrip('\n')
    m = re.match(r'^### (.*)$', line)
    if m:
        name = m.group(1)
        sec.setdefault(name, [])
        continue
    if name:
        sec[name].append(line)

HZ = 100.0   # USER_HZ on Linux


def stat_cpu(stat_line):
    # pid N <pid> (comm) state ppid ... utime(14) stime(15)
    s = stat_line.split(') ', 1)
    if len(s) < 2:
        return None
    f = s[1].split()
    return int(f[11]) + int(f[12])   # fields 14 and 15, counted from 'state' as field 3


def sample(tag):
    out = {'pids': {}, 'cg': {}}
    for ln in sec.get('sample ' + tag, []):
        if re.match(r'^\d+\.\d+ \d+\.\d+$', ln):
            out['uptime'] = float(ln.split()[0])
        elif ln.startswith('cpu '):
            v = [int(x) for x in ln.split()[1:]]
            out['cpu'] = (sum(v), v[3] + (v[4] if len(v) > 4 else 0))
        elif ln.startswith('pid '):
            p = ln.split()[1]
            t = stat_cpu(ln)
            if t is not None:
                out['pids'][p] = t
        elif ':' in ln:
            k, v = ln.split(':', 1)
            out['cg'][k.strip()] = v.strip()
    return out


A, B = sample('A'), sample('B')
print('== Head unit')
cpus = [l for l in sec.get('cpuinfo', []) if l.startswith('model name') or l.startswith('Hardware') or l.startswith('CPU part')]
nproc = len([l for l in sec.get('cpuinfo', []) if l.startswith('processor')])
print('  CPU: %s  (%d logical cores)' % (cpus[0].split(':', 1)[1].strip() if cpus else '?', nproc))
print('  ' + ' '.join(sec.get('uname', ['?'])[:1])[:150])
print('  load average: ' + ' '.join(sec.get('loadavg', ['?'])))
dt = (B.get('uptime', 0) - A.get('uptime', 0)) or secs
if 'cpu' in A and 'cpu' in B:
    tot = B['cpu'][0] - A['cpu'][0]
    idle = B['cpu'][1] - A['cpu'][1]
    print('  whole unit busy: %.1f %% of all cores over %.1f s' % (100.0 * (tot - idle) / max(1, tot), dt))
pids = dict(l.split(':', 1) for l in sec.get('pids', []) if ':' in l)
print('\n== Processes (% of ONE core over the window)')
for who in ('app', 'cluster-render'):
    for p in pids.get(who, '').split():
        if p in A['pids'] and p in B['pids']:
            pct = 100.0 * (B['pids'][p] - A['pids'][p]) / HZ / dt
            st = {l.split(':', 1)[0]: l.split(':', 1)[1].strip() for l in sec.get('status ' + p, []) if ':' in l}
            print('  %-15s pid %-6s %5.1f %%  rss %s  threads %s  ctx switches vol %s / invol %s' % (
                who, p, pct, st.get('VmRSS', '?'), st.get('Threads', '?'), st.get('voluntary_ctxt_switches', '?'), st.get('nonvoluntary_ctxt_switches', '?')))
if not pids.get('app', '').strip():
    print('  our app\'s process was not found (is the app running? appdir: %s)' % ' '.join(sec.get('appdir', [])))
print('  renderer (mgu-renderd) running: %s' % ('yes, pid' + pids['renderd'] if pids.get('renderd', '').strip() else 'no'))

print('\n== The app\'s CPU cgroup: %s' % (' '.join(sec.get('cgdir', [])) or 'not found'))
ca, cb = A['cg'], B['cg']
for k in ('cpu.cfs_quota_us', 'cpu.cfs_period_us', 'cpu.shares', 'cpu.max', 'cpu.weight'):
    if k in cb:
        print('  %s: %s' % (k, cb[k]))


def kv(s):
    d = {}
    toks = s.split()
    for i in range(0, len(toks) - 1, 2):
        try:
            d[toks[i]] = int(toks[i + 1])
        except ValueError:
            pass
    return d


if 'cpu.stat' in ca and 'cpu.stat' in cb:
    a, b = kv(ca['cpu.stat']), kv(cb['cpu.stat'])
    thr = b.get('nr_throttled', 0) - a.get('nr_throttled', 0)
    per = b.get('nr_periods', 0) - a.get('nr_periods', 0)
    tt = (b.get('throttled_time', 0) - a.get('throttled_time', 0)) / 1e6 or (b.get('throttled_usec', 0) - a.get('throttled_usec', 0)) / 1e3
    print('  throttled in %d of %d periods, %.0f ms in all over %.0f s%s' % (
        thr, per, tt, dt, '  <-- the app hit its CPU limit: it was frozen for those ms' if thr else ''))
if 'cpuacct.usage' in ca and 'cpuacct.usage' in cb:
    print('  cgroup CPU: %.1f %% of one core' % (100.0 * (int(cb['cpuacct.usage']) - int(ca['cpuacct.usage'])) / 1e9 / dt))

print('\n== top (one shot, start of the window)')
for l in sec.get('top', [])[:16]:
    print('  ' + l)
log = sec.get('applog', [])
print('\n== App log: perf lines (opt-in, <data>/perf.json) and the page loop')
for l in [x for x in log if 'perf:' in x][-8:]:
    print('  ' + l)
for l in [x for x in log if 'loop MAIN' in x][-6:]:
    print('  ' + l)
print('\n== App log: layouts and warnings (last 20)')
for l in [x for x in log if 'perf:' not in x and 'loop MAIN' not in x][-20:]:
    print('  ' + l[:220])
print('\n== cluster-render status')
for l in sec.get('crstatus', [])[:40]:
    print('  ' + l)
print('\n== cluster-render log: per-minute writes, slow flushes, budget (last 20)')
for l in sec.get('crlog', [])[-20:]:
    print('  ' + l[:240])
