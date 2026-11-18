#!/usr/bin/env python3
"""verify_steps.py - did the owner's steps leave the lines the parser needs? (package CQ)

    python3 -I tools/car/verify_steps.py <signal_probe.log> [--block B1 | --until B6] [--silent P13:sw-fav,...] [--shift M:K] [--json out.json]

Reads the probe's log (the kit's file; the probe's lines all contain 'probe: ') and design/car/session_marks.json (generated
from the session plan) and, for every marked step, lists whether each expected line (item + field tag) appeared between that
step's mark and the next mark of the same run. A line of an S6 field carries since=M<n>+<ms>, which names its mark exactly and is
preferred over position. Used by the lead between blocks, and by tools/car/dry_run.js.

A missing pair is a finding only after the step was done correctly: a field the car never sends is 'not sent', an answer.
--shift M:K: the owner pressed K marks too many from M<M> on (counter ahead of the plan); the log's marks from M count one lower.
--silent lists pairs the lead has already accepted as silent (they show as SILENT, not MISSING).
Exit status 1 if a required (non-optional) pair is missing and not accepted. Read-only. Standard library only."""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
MARKS = os.path.join(ROOT, 'design', 'car', 'session_marks.json')

START = re.compile(r'probe: start signal_probe v=(\S+) fmt=(\d+) sets=(\S+)')
SETS = re.compile(r'probe: sets on=(\S+) changed=(\S*)')
MARK = re.compile(r'probe: mark M(\d+) t=([\d.]+) tms=(\d+) sets=(\S+)')
FIELD = re.compile(r'probe: (P\d+) (\S+) #(\d+) t=([\d.]+): (.*)$')
SINCE = re.compile(r'since=M(\d+)\+(\d+)')


def parse(path, shifts=()):
    """shifts: [(m, k)]: the owner pressed k marks too many from M<m> on (the counter is ahead of the plan): M<n> with n >= m counts as n-k.
    -> runs: [{start, marks: {n: {t, sets}}, lines: [(markN or None, item, tag, count, t, body)]}]"""
    runs = []

    def remap(n):
        for m, k in sorted(shifts):
            if n >= m:
                n -= k
        return n
    with open(path, encoding='utf-8', errors='replace') as f:
        for raw in f:
            m = START.search(raw)
            if m:
                runs.append({'version': m.group(1), 'fmt': m.group(2), 'sets': m.group(3), 'marks': {}, 'lines': [], 'setsLines': []})
                continue
            if not runs:
                continue
            run = runs[-1]
            m = MARK.search(raw)
            if m:
                run['marks'][remap(int(m.group(1)))] = {'t': float(m.group(2)), 'tms': int(m.group(3)), 'sets': m.group(4)}
                run['_cur'] = remap(int(m.group(1)))
                continue
            m = SETS.search(raw)
            if m:
                run['setsLines'].append(m.group(1))
                continue
            m = FIELD.search(raw)
            if m:
                body = m.group(5)
                s = SINCE.search(body)
                mk = remap(int(s.group(1))) if s else run.get('_cur')
                run['lines'].append((mk, m.group(1), m.group(2), int(m.group(3)), float(m.group(4)), body))
    return runs


def verify(runs, marks, only_block=None, silent=(), until=None):
    """-> rows [{mark, step, block, expect: [{item, tag, status}], status}], problems"""
    rows, problems = [], []
    if not runs:
        return rows, ['no start line in the log']
    if len(runs) > 1:
        problems.append('the log has %d runs (the app restarted): marks are numbered per run, the last run is checked' % len(runs))
    run = runs[-1]
    seen = sorted(run['marks'])
    if seen and seen != list(range(1, seen[-1] + 1)):
        problems.append('mark numbers are not contiguous: %s' % seen)
    by_mark = {}
    for mk, item, tag, cnt, t, body in run['lines']:
        by_mark.setdefault(mk, set()).add((item, tag))
    for m in marks['marks']:
        if only_block and m['block'] != only_block:
            continue
        if until and int(m['block'][1:]) > int(until[1:]):
            continue
        n = m['mark']
        row = {'mark': n, 'step': m['step'], 'block': m['block'], 'tag': m['tag'], 'expect': [], 'status': 'ok'}
        if n not in run['marks']:
            row['status'] = 'NO MARK'
            rows.append(row)
            continue
        got = by_mark.get(n, set())
        need = [set_ for set_ in m['sets'] if set_]
        have = run['marks'][n]['sets'].split('+')
        if need and not all(s in have for s in need):
            row['setsProblem'] = 'mark %d was pressed with sets %s on, the block needs %s' % (n, '+'.join(have), '+'.join(need))
            problems.append(row['setsProblem'])
        for item, tag in m['expect']:
            key = '%s:%s' % (item, tag)
            st = 'ok' if (item, tag) in got else ('SILENT' if key in silent else 'MISSING')
            row['expect'].append({'item': item, 'tag': tag, 'status': st})
        miss = [e for e in row['expect'] if e['status'] == 'MISSING']
        if miss:
            row['status'] = 'optional-missing' if m['optional'] else 'MISSING'
        elif any(e['status'] == 'SILENT' for e in row['expect']):
            row['status'] = 'silent'
        rows.append(row)
    return rows, problems


def main(argv):
    block = silent = out = until = None
    shift = []
    it = iter(argv)
    for a in it:
        if a == '--block':
            block = next(it)
        elif a == '--silent':
            silent = next(it)
        elif a == '--json':
            out = next(it)
        elif a == '--until':
            until = next(it)
        elif a == '--shift':
            shift.append(tuple(int(x) for x in next(it).split(':', 1)))
    pos = [a for a in argv if not a.startswith('--') and a not in (block, silent, out, until) and not re.match(r'^\d+:-?\d+$', a)]
    if len(pos) != 1:
        print(__doc__)
        return 2
    marks = json.load(open(MARKS, encoding='utf-8'))
    rows, problems = verify(parse(pos[0], shift), marks, block, set((silent or '').split(',')) if silent else set(), until)
    for r in rows:
        ex = ', '.join('%s %s %s' % (e['item'], e['tag'], e['status']) for e in r['expect']) or '(nothing required)'
        print('%-4d %-6s %-16s %s' % (r['mark'], r['step'], r['status'], ex))
    for p in problems:
        print('PROBLEM: ' + p)
    if out:
        with open(out, 'w', encoding='utf-8') as f:
            json.dump({'rows': rows, 'problems': problems}, f, ensure_ascii=False, indent=1)
    bad = [r for r in rows if r['status'] in ('MISSING', 'NO MARK')]
    print('%d steps, %d missing' % (len(rows), len(bad)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
