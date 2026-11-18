#!/usr/bin/env python3
"""Tests for package CQ's tools: the plan, the generated documents and verify_steps.py (synthetic logs, including the misleading ones).
    python3 -I tools/car/test_session.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'car'))
import verify_steps as V  # noqa: E402
import make_session as M  # noqa: E402

MARKS = json.load(open(os.path.join(ROOT, 'design', 'car', 'session_marks.json'), encoding='utf-8'))
STEP = {m['step']: m for m in MARKS['marks']}


def log(lines):
    f = tempfile.NamedTemporaryFile('w', suffix='.log', delete=False, encoding='utf-8')
    f.write('\n'.join('2026-11-18T10:00:00.000Z INFO ' + l for l in lines) + '\n')
    f.close()
    return f.name


def mark(n, sets='S6'):
    return 'probe: mark M%d t=%d.0 tms=%d000 sets=%s' % (n, n, n, sets)


class Plan(unittest.TestCase):
    def test_documents_current(self):
        self.assertEqual(subprocess.call([sys.executable, '-I', os.path.join(ROOT, 'tools', 'car', 'make_session.py'), '--check']), 0)

    def test_marks_unique_and_ordered(self):
        n = [m['mark'] for m in MARKS['marks']]
        self.assertEqual(n, list(range(1, len(n) + 1)))

    def test_stalk_block_first_after_safety(self):
        plan = json.load(open(M.PLAN, encoding='utf-8'))
        self.assertEqual([b['id'] for b in plan['blocks']][:2], ['B0', 'B1'])
        steps = plan['blocks'][1]['steps']
        self.assertTrue(any(s.get('expect') == [['P13', 'stalk']] for s in steps[:6]))
        self.assertEqual({s.get('tag') for s in steps if s.get('tag')}, {'stock', 'twin', 'f30'})

    def test_never_more_than_two_sets(self):
        plan = json.load(open(M.PLAN, encoding='utf-8'))
        self.assertTrue(all(len(b['sets']) <= 2 for b in plan['blocks']))


class Verify(unittest.TestCase):
    def run_log(self, lines, **kw):
        runs = V.parse(log(lines))
        return V.verify(runs, MARKS, **kw)

    def first(self, step):
        return STEP[step]['mark']

    def test_ok(self):
        a = self.first('B1.3')
        L = ['probe: start signal_probe v=0.1.0 fmt=1 sets=S6 fields=24 of 144']
        for n in range(1, a + 1):
            L.append(mark(n))
        L.append('probe: P13 stalk #1 t=9.0: stalks=64(0x40) prev=0(0x0) up=0x40 down=0x0 tms=9000 since=M%d+2000' % a)
        rows, problems = self.run_log(L, only_block='B1')
        row = [r for r in rows if r['step'] == 'B1.3'][0]
        self.assertEqual(row['status'], 'ok')

    def test_missing_is_reported_and_silent_is_accepted(self):
        a = self.first('B1.3')
        L = ['probe: start signal_probe v=0.1.0 fmt=1 sets=S6 fields=24 of 144'] + [mark(n) for n in range(1, a + 2)]
        rows, _ = self.run_log(L, only_block='B1')
        self.assertEqual([r for r in rows if r['step'] == 'B1.3'][0]['status'], 'MISSING')
        rows, _ = self.run_log(L, only_block='B1', silent={'P13:stalk'})
        self.assertEqual([r for r in rows if r['step'] == 'B1.3'][0]['status'], 'silent')

    def test_since_wins_over_position(self):
        # the line follows mark a+1 in the file but names mark a: it belongs to step B1.3
        a = self.first('B1.3')
        L = ['probe: start signal_probe v=0.1.0 fmt=1 sets=S6 fields=24 of 144'] + [mark(n) for n in range(1, a + 2)]
        L.append('probe: P13 stalk #1 t=9.0: stalks=64(0x40) prev=0(0x0) up=0x40 down=0x0 tms=9000 since=M%d+9000' % a)
        rows, _ = self.run_log(L, only_block='B1')
        self.assertEqual([r for r in rows if r['step'] == 'B1.3'][0]['status'], 'ok')

    def test_restart_and_gap_in_marks(self):
        L = ['probe: start signal_probe v=0.1.0 fmt=1 sets=S6 fields=24 of 144', mark(1), mark(3)]
        _, problems = self.run_log(L)
        self.assertTrue(any('contiguous' in p for p in problems))
        L = ['probe: start signal_probe v=0.1.0 fmt=1 sets=S6 fields=24 of 144', mark(1),
             'probe: start signal_probe v=0.1.0 fmt=1 sets=S6 fields=24 of 144', mark(1)]
        _, problems = self.run_log(L)
        self.assertTrue(any('2 runs' in p for p in problems))

    def test_wrong_sets_on_at_a_mark(self):
        a = self.first('B1.3')
        L = ['probe: start signal_probe v=0.1.0 fmt=1 sets=S6 fields=24 of 144'] + [mark(n, 'S1+S3') for n in range(1, a + 1)]
        _, problems = self.run_log(L, only_block='B1')
        self.assertTrue(any('needs' in p for p in problems))

    def test_no_marks_at_all(self):
        rows, _ = self.run_log(['probe: start signal_probe v=0.1.0 fmt=1 sets=none fields=0 of 144'], only_block='B1')
        self.assertTrue(all(r['status'] == 'NO MARK' for r in rows))


if __name__ == '__main__':
    unittest.main(verbosity=1)
