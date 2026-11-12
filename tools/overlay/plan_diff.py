#!/usr/bin/env python3
"""Compare plans against an earlier version: are the decisions and the conflict lists unchanged apart from new elements?

    python3 tools/overlay/plan_diff.py [--rev main] [design/overlay/plan.default.json ...]

For each plan (default: plan.default, plan.safe, plan.dials) it reads the version at git revision --rev (default main)
and the file on disk, and prints: based_on changes, decisions added / removed / changed, moves, holes, keep-clear boxes,
settings, and conflicts added / removed / changed (key: severity, rule, g20, wb). Exit 1 when anything but the
based_on hashes and the decisions of elements absent from the old catalogue changed.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
PLANS = ['design/overlay/plan.default.json', 'design/overlay/plan.safe.json', 'design/overlay/plan.dials.json']


def old(rev, path):
    r = subprocess.run(['git', 'show', '%s:%s' % (rev, path)], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit('git show %s:%s failed: %s' % (rev, path, r.stderr.strip()))
    return json.loads(r.stdout)


def ckey(c):
    return (c['severity'], c['rule'], c['g20'], c['wb'])


def diff(a, b, rev):
    """a: old, b: new. Returns (lines, unexpected)."""
    out, bad = [], False
    old_cat = old(rev, a['based_on']['g20']['file'])
    old_ids = {e['id'] for e in old_cat['elements']}
    for k in ('g20', 'wb'):
        if a['based_on'][k] != b['based_on'][k]:
            out.append('based_on.%s: %s -> %s' % (k, a['based_on'][k]['sha256'][:19], b['based_on'][k]['sha256'][:19]))
    ga, gb = a['g20'], b['g20']
    for i in sorted(set(gb) - set(ga)):
        new = i not in old_ids
        out.append('g20.%s: added %s%s' % (i, json.dumps(gb[i], ensure_ascii=False), ' (new element)' if new else ''))
        bad |= not new
    for i in sorted(set(ga) - set(gb)):
        out.append('g20.%s: REMOVED' % i)
        bad = True
    for i in sorted(set(ga) & set(gb)):
        if ga[i] != gb[i]:
            out.append('g20.%s: CHANGED %s -> %s' % (i, json.dumps(ga[i], ensure_ascii=False), json.dumps(gb[i], ensure_ascii=False)))
            bad = True
    for k in ('wb', 'anchors', 'holes', 'keep_clear', 'settings', 'mode'):
        if a.get(k) != b.get(k):
            out.append('%s: CHANGED' % k)
            bad = True
    ca = {ckey(c): c for c in a['conflicts']}
    cb = {ckey(c): c for c in b['conflicts']}
    for k in sorted(set(cb) - set(ca), key=str):
        new = k[2] not in old_ids
        out.append('conflict added %s %s %s / %s%s' % (k[0], k[1], k[2], k[3], ' (new element)' if new else ''))
        bad |= not new
    for k in sorted(set(ca) - set(cb), key=str):
        out.append('conflict REMOVED %s %s %s / %s' % k)
        bad = True
    for k in sorted(set(ca) & set(cb), key=str):
        if ca[k] != cb[k]:
            out.append('conflict CHANGED %s %s %s / %s: %s -> %s px' % (k + (ca[k]['overlap_px'], cb[k]['overlap_px'])))
            bad = True
    out.append('conflicts: %d -> %d' % (len(ca), len(cb)))
    return out, bad


def main(argv):
    rev = 'main'
    if '--rev' in argv:
        i = argv.index('--rev')
        rev = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    paths = argv or PLANS
    bad = False
    for p in paths:
        a = old(rev, p)
        b = json.load(open(os.path.join(ROOT, p)))
        lines, u = diff(a, b, rev)
        print('== %s (vs %s)%s' % (p, rev, ': UNEXPECTED CHANGES' if u else ': only the hashes and the new elements'))
        for ln in lines:
            print('  ' + ln)
        bad |= u
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
