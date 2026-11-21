#!/usr/bin/env python3
"""Cruise CR: tests of tools/car/cruise_read.py on a synthetic recording (Signal Probe S17's tags), synthetic app logs (Signal Probe
and the RV recorder's CRUISE choice) and the passenger's notes. Each outcome of rung 2 gets its verdict.

    python3 tools/car/test_cruise_read.py        (a second; no car, no network)
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cruise_read as cr  # noqa: E402

AVAIL_COLS = ['proposalAvailabilityACC', 'proposalAvailabilitySLD', 'proposalAvailabilityDCC', 'valueSetSpeed', 'proposalAssistFunction']


def write_rec(d, rows_avail, rows_speed, marks, extra=None):
    """A recording in the recorder's format (#rec 1): assist-avail, hud-data2's set speed, the SLA setting, marks."""
    names = {}
    lines = ['#rec,1,0.6.1,20261122-100000,1,2026-11-22T10:00:00.000Z,0,S17', '#cols,t_ms,field,seq,ctr,pts,values...',
             '#f,1,assist-avail,MultimodalControlDriverAssistance.functionAvailabilityDriverAssistance,' + ','.join(AVAIL_COLS),
             '#f,2,hud-data2,DisplayDataServer2.functionalLibraryData,ldmSetSpeed.ldmSetSpeedValue',
             '#f,3,sla-setting,SettingsDriverAssistanceFunctions.settingSpeedLimitAssist,value,availability',
             '#f,4,fas-foresight,FASuS.displayForesight,displayOperationTakeOverSuggestionSpeed2']

    def code(x):
        if isinstance(x, str):
            if x not in names:
                names[x] = len(names) + 1
                lines.append('#n,%d,%s' % (names[x], x))
            return '@%d' % names[x]
        return str(x)
    seq = {}
    ev = [(t, 2, [v]) for t, v in rows_speed] + [(t, 1, r) for t, r in rows_avail] + list(extra or [])
    for t, n in marks:
        ev.append((t, 'm', n))
    for t, fid, vals in sorted(ev, key=lambda x: x[0]):
        if fid == 'm':
            lines.append('#m,%d,%d' % (t, vals))
            continue
        seq[fid] = seq.get(fid, 0) + 1
        cs = [code(v) for v in vals]
        lines.append('%d,%d,%d,,,%s' % (t, fid, seq[fid], ','.join(cs)))
    lines.append('#end,%d,samples=%d,dropped=0,errors=0,texts=0,folded=0' % (ev[-1][0] if ev else 0, sum(seq.values())))
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'rec-20261122-100000-001.csv'), 'w') as fh:
        fh.write('\n'.join(lines) + '\n')


class CruiseRead(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='cruise-read-')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_cr(self, *args):
        p = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'cruise_read.py')] + list(args) + ['-o', os.path.join(self.tmp, 'out')],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout, json.load(open(os.path.join(self.tmp, 'out', 'cruise_read.json')))

    def test_a_unit_answers(self):
        rec = os.path.join(self.tmp, 'rec')
        avail = [(1000, ['NOT_EQUIPPED', 'AVAILABLE', 'AVAILABLE', 0, 'NONE']), (20000, ['NOT_EQUIPPED', 'AVAILABLE', 'ACTIVE', 61, 'DCC']),
                 (25000, ['NOT_EQUIPPED', 'AVAILABLE', 'ACTIVE', 66, 'DCC']), (40000, ['NOT_EQUIPPED', 'ACTIVE', 'AVAILABLE', 50, 'SLD'])]
        speed = [(19500, 61), (24800, 66), (39000, 50)]
        extra = [(500, 3, ['ACCEPT_MANUALLY', 'OPERABLE']), (30000, 4, ['UEBERNAHME_MIT_SET'])]
        write_rec(rec, avail, speed, [(19000, 1), (24000, 2), (39500, 3)], extra)
        notes = os.path.join(self.tmp, 'notes.txt')
        open(notes, 'w').write('M1 SET at the bridge\nM2 PLUS\nM3 LIM\nM4 whatever\n')
        out, r = self.run_cr('--rec', rec, '--notes', notes)
        self.assertEqual(r['answers'], 'yes')
        self.assertIn('ACTIVE', r['dcc'])
        self.assertEqual(r['set_speed']['compared'], 3)
        self.assertEqual(r['set_speed']['match'], 3)
        self.assertEqual(r['set_offer'], 1)
        self.assertIn('verdict: a unit answers 13203: yes; DCC ACTIVE seen (with the cruise used); SLD ACTIVE seen (with the limiter used); '
                      'set speed matches the cluster 3 of 3; SLA setting ACCEPT_MANUALLY (OPERABLE)', out)
        self.assertIn("BMW's SET offer seen 1x", out)
        marks = [x for x in r['timeline'] if x[2] == 'mark']
        self.assertEqual([m[3].strip() for m in marks], ['M1 SET', 'M2 PLUS', 'M3 LIM'])
        md = open(os.path.join(self.tmp, 'out', 'cruise_read.md')).read()
        self.assertNotIn('bridge', md)          # a word that is no label is never written
        self.assertNotIn('bridge', json.dumps(r))
        self.assertIn('cluster set speed 61', md)

    def test_nobody_answers(self):
        log = os.path.join(self.tmp, 'signal_probe.log')
        open(log, 'w').write('\n'.join([
            '2026-11-22 10:00:00 I probe: start signal_probe v=0.6.1 fmt=1 sets=S17 fields=150 of 310',
            '2026-11-22 10:00:03 I probe: P26 sla-setting #1 t=3.0: value=SHOW_CURRENT availability=OPERABLE deactivated=OPERABLE',
            '2026-11-22 10:00:03 I probe: P26 dcc-setting #1 t=3.1: value=NOT_CONFIGURABLE availability=NOT_AVAILABLE',
            '2026-11-22 10:02:00 I probe: summary S17 +120s: silent: P15 assist-avail, P26 fas-foresight',
            '2026-11-22 10:02:03 I probe: ask P15 assist-avail (silent at +120s): error or no answer: method call get:functionAvailabilityDriverAssistance() timed out (the car does not send it)',
        ]) + '\n')
        out, r = self.run_cr('--log', log)
        self.assertEqual(r['answers'], 'no')
        self.assertIn('verdict: a unit answers 13203: no; DCC no value; SLD no value; set speed not compared (no recording with both); '
                      'SLA setting SHOW_CURRENT (OPERABLE); DCC setting NOT_CONFIGURABLE (NOT_AVAILABLE); BMW\'s SET offer not seen', out)

    def test_answers_not_equipped_from_the_logs(self):
        log1 = os.path.join(self.tmp, 'signal_probe.log')
        open(log1, 'w').write('I probe: P15 assist-avail #1 t=1.2: acc=NOT_EQUIPPED sla=NOT_EQUIPPED sld=NOT_EQUIPPED dcc=NOT_EQUIPPED setSpeed=0 setInfo=0 proposal=NONE ucc=- response=- forecast=-\n'
                                'I probe: ask P15 assist-avail (set on again): answered (struct)\n')
        log2 = os.path.join(self.tmp, 'rv_recorder.log')
        open(log2, 'w').write('I rv: first assist-avail t=0.4: proposalAvailabilityACC=NOT_EQUIPPED proposalAvailabilityDCC=NOT_EQUIPPED proposalAvailabilitySLD=NOT_EQUIPPED valueSetSpeed=0\n'
                              'I rv: change set-sla t=5.0: value=NOT_CONFIGURABLE availability=NOT_AVAILABLE availabilityDeactivated=NOT_AVAILABLE\n')
        out, r = self.run_cr('--log', log1, log2)
        self.assertEqual(r['answers'], 'yes')
        self.assertEqual(r['dcc'], ['NOT_EQUIPPED'])
        self.assertIn('DCC not equipped; SLD not equipped', r['verdict'])
        self.assertIn('SLA setting NOT_CONFIGURABLE (NOT_AVAILABLE)', r['verdict'])

    def test_nothing_read(self):
        out, r = self.run_cr()
        self.assertTrue(r['answers'].startswith('unknown'))

    def test_kv(self):
        self.assertEqual(cr.kv('dcc=ACTIVE setSpeed=61 response=- x=64(0x40)'), {'proposalAvailabilityDCC': 'ACTIVE', 'valueSetSpeed': 61, 'infoResponseAdaptionSpeed': None, 'x': 64})


if __name__ == '__main__':
    unittest.main(verbosity=1)
