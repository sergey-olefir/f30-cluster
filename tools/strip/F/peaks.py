"""Per step of tools/strip/F/measure.js: the bench's pixel memory at its start and end and the highest it reached in
between (the layout-switch peak), and how far that peak overshoots both ends. Package F, 2026-11-16.
    python3 tools/strip/F/peaks.py <measure out.json> <peak.txt>"""
import json, sys
m = json.load(open(sys.argv[1]))
pk = [tuple(map(int, l.split())) for l in open(sys.argv[2]) if l.strip()]
M = 1048576.0
print('%-38s %8s %8s %8s %9s' % ('step', 'start', 'end', 'peak', 'overshoot'))
for s in m['steps']:
    start = 0
    for t, b in pk:
        if t <= s['t0']: start = b
    end, peak = start, start
    for t, b in pk:
        if s['t0'] < t <= s['t1']:
            end = b; peak = max(peak, b)
    print('%-38s %8.3f %8.3f %8.3f %9.3f' % (s['name'], start / M, end / M, peak / M, (peak - max(start, end)) / M))
print('max peak over the walk %.3f MiB' % (max(b for t, b in pk) / M))
