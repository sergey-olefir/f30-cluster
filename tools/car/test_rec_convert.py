#!/usr/bin/env python3
"""Tests of tools/car/rec_convert.py on synthetic recordings written in the recorder's format (#rec 1), by hand, independently of
shared/signal_recorder.js, Signal Probe's recorder (bench/test-signal-recorder.js runs the converter on the recorder's own files).

    python3 tools/car/test_rec_convert.py
"""
import gzip
import json
import os
import random
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rec_convert as rc  # noqa: E402


def write_rec(folder, session, no, lines, gz=True, members=1, cut_tail=False):
    """A recording file of `lines`; gzip in `members` members (one per flush, as the recorder does); cut_tail: the last member cut."""
    name = 'rec-%s-%03d.csv%s' % (session, no, '.gz' if gz else '')
    path = os.path.join(folder, name)
    head = ['#rec,1,0.3.0,%s,%d,2026-11-20T08:00:00.000Z,0,S14' % (session, no), '#cols,t_ms,field,seq,ctr,pts,values']
    text_lines = head + lines
    if not gz:
        open(path, 'w').write('\n'.join(text_lines) + '\n')
        return path
    k = max(1, len(text_lines) // members)
    chunks = [text_lines[i:i + k] for i in range(0, len(text_lines), k)]
    blob = b''.join(gzip.compress(('\n'.join(c) + '\n').encode()) for c in chunks)
    if cut_tail:
        last = gzip.compress(('\n'.join(['999999,1,99999,,,1']) + '\n').encode())
        blob += last[:len(last) // 2]
    open(path, 'wb').write(blob)
    return path


def periodic(fid, period, n, t0=0, jitter=0.0, ctr_mod=None, start_seq=1, values=lambda i: '1', seed=1, pts=False, drop_every=0, skip_ctr_every=0):
    rnd = random.Random(seed)
    out, seq, ctr = [], start_seq, 0
    for i in range(n):
        t = int(round(t0 + i * period + (rnd.uniform(-jitter, jitter) if jitter else 0)))
        if drop_every and i and i % drop_every == 0:
            seq += 1                       # the recorder dropped this one: its seq is skipped
            ctr = (ctr + 1) % (ctr_mod or 1)
            continue
        if skip_ctr_every and i and i % skip_ctr_every == 0:
            ctr = (ctr + 1) % ctr_mod      # the car's message never came: the counter jumps by two
        p = '%d.%09d' % (100 + (i * period) // 1000, int(((i * period) % 1000) * 1e6)) if pts else ''
        out.append('%d,%s,%d,%s,%s,%s' % (t, fid, seq, '' if ctr_mod is None else ctr, p, values(i)))
        seq += 1
        if ctr_mod:
            ctr = (ctr + 1) % ctr_mod
    return out


class ConvertTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix='rec-conv-')
        self.inp = os.path.join(self.d, 'rec')
        os.makedirs(self.inp)
        self.out = os.path.join(self.d, 'out')

    def tearDown(self):
        shutil.rmtree(self.d)

    def run_conv(self, **kw):
        return rc.convert([self.inp], self.out, **kw)

    def fld(self, rep, tag):
        return [f for f in rep['fields'] if f['tag'] == tag][0]

    def test_rates_jitter_gaps(self):
        lines = ['#f,1,speed,SpeedAcceleration.vehicleSpeed,speedVehicleCentreOfGravity', '#f,2,gap,GapVehicleAhead.DataFrontVehicle,frontVehicleGapX']
        a = periodic('1', 20, 3000, jitter=2, ctr_mod=15, values=lambda i: str(5000 + i // 10))
        b = periodic('2', 100, 600, jitter=10, values=lambda i: str(300 + i % 7), seed=2)
        b = [x for x in b if not (10000 <= int(x.split(',')[0]) < 11500)]      # a 1.5 s gap in the gap signal
        lines += sorted(a + b, key=lambda x: int(x.split(',')[0]))
        lines.append('#end,60000,samples=%d,dropped=0,errors=0,texts=0' % (len(a) + len(b)))
        write_rec(self.inp, '20261120-080000', 1, lines, members=7)
        rep = self.run_conv()[0]
        sp, gp = self.fld(rep, 'speed'), self.fld(rep, 'gap')
        self.assertAlmostEqual(sp['rate_hz'], 50.0, delta=3)
        self.assertLess(sp['jitter_ms'], 3)
        self.assertEqual(sp['gaps'], 0)
        self.assertEqual(sp['counter']['modulo'], 15)
        self.assertEqual(sp['counter']['missed'], 0)
        self.assertAlmostEqual(gp['rate_hz'], 10.0, delta=1)
        self.assertEqual(gp['gaps'], 1)
        self.assertGreaterEqual(gp['longest_gap_ms'], 1500)
        self.assertTrue(rep['complete'])
        self.assertEqual(rep['samples'], len(a) + len(b))

    def test_drops_and_counter_misses(self):
        lines = ['#f,1,accel,AccelerationLongitudinalLateralProvision.accelerationLongitudinalCog,a']
        lines += periodic('1', 20, 1000, ctr_mod=65536, drop_every=100, values=lambda i: '0.25')
        lines += []
        write_rec(self.inp, '20261120-080000', 1, lines)
        f = self.fld(self.run_conv()[0], 'accel')
        self.assertEqual(f['recorder_drops'], 9)
        self.assertEqual(f['counter']['missed'], 9)        # a dropped sample also skips its counter: seen as missing, by design
        lines = ['#f,1,yaw,YawRateProvision.yawRate,y'] + periodic('1', 20, 1000, ctr_mod=256, skip_ctr_every=50, values=lambda i: '1')
        shutil.rmtree(self.inp); os.makedirs(self.inp)
        write_rec(self.inp, '20261120-080001', 1, lines)
        f = self.fld(self.run_conv()[0], 'yaw')
        self.assertEqual(f['recorder_drops'], 0)
        self.assertEqual(f['counter']['missed'], 19)
        self.assertEqual(f['counter']['modulo'], 256)

    def test_ditto_enums_schema_change_and_files(self):
        s = '20261120-090000'
        f1 = ['#f,1,hud,DisplayDataServer2.functionalLibraryData,setSpeed,icon', '#n,1,DCC', '#n,2,OFF',
              '0,1,1,,,61,@1', '100,1,2,,,=', '200,1,3,,,62,@1', '#m,250,1',
              '#f,2,gap,GapVehicleAhead.DataFrontVehicle,gapX', '300,2,1,,,4093', '400,2,2,,,=']
        # the next file: its own dictionary (codes restart), and the hud field with one more column
        f2 = ['#f,1,hud,DisplayDataServer2.functionalLibraryData,setSpeed,icon,iconState', '#n,1,OFF', '#n,2,ACTIVE',
              '500,1,4,,,65535,@1,@2', '600,1,5,,,=', '#m,650,2', '#end,700,samples=7,dropped=0,errors=0,texts=0']
        write_rec(self.inp, s, 1, f1)
        write_rec(self.inp, s, 2, f2, gz=False)
        rep = self.run_conv()[0]
        self.assertEqual(rep['files'], ['rec-%s-001.csv.gz' % s, 'rec-%s-002.csv' % s])
        rows = open(os.path.join(self.out, s, 'fields', 'hud.csv')).read().strip().split('\n')
        self.assertEqual(rows[0], 't_ms,seq,ctr,pts,setSpeed,icon,iconState')
        self.assertEqual(rows[1:], ['0,1,,,61,DCC,', '100,2,,,61,DCC,', '200,3,,,62,DCC,', '500,4,,,65535,OFF,ACTIVE', '600,5,,,65535,OFF,ACTIVE'])
        self.assertEqual(open(os.path.join(self.out, s, 'markers.csv')).read().split(), ['t_ms,n', '250,1', '650,2'])
        g = open(os.path.join(self.out, s, 'fields', 'gap.csv')).read().strip().split('\n')
        self.assertEqual(g[1:], ['300,1,,,4093', '400,2,,,4093'])
        self.assertAlmostEqual(self.fld(rep, 'hud')['repeated_share'], 0.5)     # 2 of 4 steps repeat the line before

    def test_cut_file_and_no_end(self):
        lines = ['#f,1,speed,SpeedAcceleration.vehicleSpeed,v'] + periodic('1', 20, 500, values=lambda i: str(i))
        write_rec(self.inp, '20261120-100000', 1, lines, members=5, cut_tail=True)
        rep = self.run_conv()[0]
        self.assertFalse(rep['complete'])
        self.assertEqual(rep['cut_files'], ['rec-20261120-100000-001.csv.gz'])
        self.assertEqual(self.fld(rep, 'speed')['samples'], 500)
        self.assertIn('No #end line', open(os.path.join(self.out, '20261120-100000', 'report.md')).read())

    def test_sessions_are_drives(self):
        for k in range(2):
            write_rec(self.inp, '20261120-11000%d' % k, 1, ['#f,1,speed,S.v,v'] + periodic('1', 50, 100, values=lambda i: str(i)) + ['#end,5000,samples=100'])
        reps = self.run_conv()
        self.assertEqual([r['session'] for r in reps], ['20261120-110000', '20261120-110001'])
        self.assertTrue(all(os.path.exists(os.path.join(self.out, r['session'], 'drive.csv')) for r in reps))

    def test_resample(self):
        lines = ['#f,1,a,X.a,v', '#f,2,b,X.b,w']
        lines += ['0,1,1,,,1', '30,2,1,,,10', '120,1,2,,,2', '250,1,3,,,3', '1000,1,4,,,4']
        write_rec(self.inp, '20261120-120000', 1, lines)
        self.run_conv(resample=100, max_age=140)
        rows = open(os.path.join(self.out, '20261120-120000', 'drive.csv')).read().strip().split('\n')
        self.assertEqual(rows[0], 't_ms,a.v,b.w')
        self.assertEqual(rows[1:5], ['0,1,', '100,1,10', '200,2,', '300,3,'])
        self.assertEqual(rows[-1], '1000,4,')
        self.assertEqual(rows[5], '400,,')        # older than max_age: empty, never carried forever

    def test_payload_clock(self):
        # the payload's own clock: 20 ms a message; the receive time the same plus a 0..8 ms path jitter
        rnd = random.Random(3)
        lines = ['#f,1,acc,A.a,a']
        for i in range(500):
            p = 1000 * 20 + i * 20
            lines.append('%d,1,%d,%d,%d.%09d,0.5' % (p + 30 + rnd.uniform(0, 8), i + 1, i % 65536, p // 1000, (p % 1000) * 1000000))
        write_rec(self.inp, '20261120-130000', 1, lines)
        pc = self.fld(self.run_conv()[0], 'acc')['payload_clock']
        self.assertAlmostEqual(pc['median_interval_ms'], 20.0, delta=0.01)
        self.assertAlmostEqual(pc['receive_ms_per_payload_s'], 1000, delta=5)
        self.assertLess(pc['receive_minus_payload_spread_ms'], 4)
        self.assertEqual(pc['backwards'], 0)

    def test_bad_lines_counted_not_fatal(self):
        lines = ['#f,1,a,X.a,v,w', '0,1,1,,,1,2', '10,1,2,,,1', '20,9,1,,,1', '30,1,3,,,=', 'garbage']
        write_rec(self.inp, '20261120-140000', 1, lines)
        rep = self.run_conv()[0]
        self.assertEqual(rep['bad_lines'], 3)
        self.assertEqual(self.fld(rep, 'a')['samples'], 2)

    def test_cli(self):
        write_rec(self.inp, '20261120-150000', 1, ['#f,1,a,X.a,v', '0,1,1,,,1', '#end,0,samples=1'])
        self.assertEqual(rc.main([self.inp, '-o', self.out]), 0)
        self.assertTrue(os.path.exists(os.path.join(self.out, '20261120-150000', 'report.json')))
        empty = os.path.join(self.d, 'empty')
        os.makedirs(empty)
        self.assertEqual(rc.main([empty, '-o', self.out]), 1)


if __name__ == '__main__':
    unittest.main(verbosity=1)
