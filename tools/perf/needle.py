#!/usr/bin/env python3
"""How smooth the needles look on a 60 Hz display, from tools/perf/probe_preload.js dumps (bench only).

    python3 -I tools/perf/needle.py <dump.json> [<dump.json> ...]

For each needle uniform (the value is its first number, 0..1 of the sweep) it replays the sends on a 60 Hz frame
grid (each frame shows the newest value sent before it; the service and the cluster's own latency are left out)
and, over the frames where the needle is moving (it moves > 0.2 % of the sweep within +-100 ms):
  moving    how many such frames
  changed   the share of them in which the needle moved at all (1.0 = every frame, 0.33 = 20 updates a second)
  hold p99 / max   the longest the needle stood still while moving, ms (a 'freeze')
  judder    the frame-to-frame speed's mean deviation from its own 5-frame mean, over its mean (0 = even motion)"""
import json
import sys

FRAME = 1000.0 / 60


def analyse(t, v):
    if len(t) < 10:
        return None
    t0, t1 = t[0], t[-1]
    frames, i, cur = [], 0, v[0]
    ft = t0
    while ft <= t1:
        while i < len(t) and t[i] <= ft:
            cur = v[i]
            i += 1
        frames.append((ft, cur))
        ft += FRAME
    n = len(frames)
    k = int(round(100 / FRAME))
    moving = [abs(frames[min(n - 1, j + k)][1] - frames[max(0, j - k)][1]) > 0.002 for j in range(n)]
    changed = holds = 0
    run, runs = 0, []
    sp = []
    for j in range(1, n):
        if not moving[j]:
            if run:
                runs.append(run)
            run = 0
            continue
        d = frames[j][1] - frames[j - 1][1]
        sp.append(abs(d))
        if d != 0:
            changed += 1
            if run:
                runs.append(run)
            run = 0
        else:
            run += 1
    mv = sum(moving[1:])
    jud = 0.0
    if len(sp) > 10:
        dev = []
        for j in range(2, len(sp) - 2):
            m = sum(sp[j - 2:j + 3]) / 5
            dev.append(abs(sp[j] - m))
        mean = sum(sp) / len(sp)
        jud = (sum(dev) / len(dev)) / mean if mean else 0
    runs.sort()
    hold = lambda q: (runs[min(len(runs) - 1, int(q * len(runs)))] + 1) * FRAME if runs else FRAME
    return {'moving': mv, 'changed': changed / mv if mv else 0, 'holdP99': hold(0.99), 'holdMax': ((runs[-1] + 1) * FRAME if runs else FRAME), 'judder': jud}


for f in sys.argv[1:]:
    d = json.load(open(f))
    print('%s (%s, %.0f s)' % (f.split('/')[-1], d.get('layout'), d.get('seconds', 0)))
    for key, a in sorted(d.get('needleRaw', {}).items()):
        r = analyse(a['t'], a['v'])
        if not r:
            continue
        print('   %-18s sends %5d  moving frames %5d  changed %.2f  hold p99 %5.0f ms  max %5.0f ms  judder %.2f' % (
            key, len(a['t']), r['moving'], r['changed'], r['holdP99'], r['holdMax'], r['judder']))
