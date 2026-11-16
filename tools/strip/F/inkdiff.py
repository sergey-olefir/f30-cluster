#!/usr/bin/env python3
"""Before / after ink boxes of every text widget (the output of inkbox.py --json, twice): one row per widget that
moved its box or its ink, and a verdict per row. Package F, 2026-11-16.

    python3 tools/strip/F/inkdiff.py before.json after.json [--md]
"""
import json, sys

before, after = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
md = '--md' in sys.argv
moved = same = 0
rows = []
for lay in after:
    for id_, a in after[lay].items():
        b = before.get(lay, {}).get(id_)
        if not b:
            rows.append((lay, id_, a['font'], None, a['box'], None, a['ink'], 'new'))
            continue
        if b['box'] == a['box'] and b['ink'] == a['ink']:
            same += 1
            continue
        d = None if not (a['ink'] and b['ink']) else [a['ink'][i] - b['ink'][i] for i in range(4)]
        verdict = 'box only (ink identical)' if b['ink'] == a['ink'] else 'INK MOVED %s' % d
        if b['ink'] != a['ink']:
            moved += 1
        rows.append((lay, id_, a['font'], b['box'], a['box'], b['ink'], a['ink'], verdict))
if '--json' in sys.argv:       # the record bench/test-fonts.js holds the layouts to: every text's baseline and ink, per layout
    rec = {lay: {id_: {'font': a['font'], 'baseline': a['baseline'], 'box': a['box'], 'ink': a['ink'],
                       'boxBefore': before[lay][id_]['box'], 'inkBefore': before[lay][id_]['ink']}
                 for id_, a in after[lay].items()} for lay in after}
    with open(sys.argv[sys.argv.index('--json') + 1], 'w') as f:     # one widget a line: a diff names the widget
        f.write('{\n' + ',\n'.join(' %s: {\n%s\n }' % (json.dumps(lay), ',\n'.join(
            '  %s: %s' % (json.dumps(i), json.dumps(r, ensure_ascii=False)) for i, r in rows.items()))
            for lay, rows in rec.items()) + '\n}\n')
if md:
    print('| layout | widget | font | box before (x, y, w, h) | box after | ink before [x0, y0, x1, y1) | ink after | verdict |')
    print('|---|---|---|---|---|---|---|---|')
    for r in rows:
        print('| %s | `%s` | %s | %s | %s | %s | %s | %s |' % r)
else:
    for r in rows:
        print('%-15s %-11s %-8s %-22s -> %-22s ink %-24s -> %-24s %s' % tuple(str(v) for v in r))
print('%d widgets identical, %d with the box changed only, %d with the ink moved' % (same, len(rows) - moved, moved))
