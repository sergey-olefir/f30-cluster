#!/usr/bin/env python3
"""beam HS: tests of tools/car/hb_analyse.py on synthetic HB recordings made by tools/car/hb_synth.js (the app's own recorder). The
truth is in the generator's truth.json: invented numbers, not car facts.

    python3 tools/car/test_hb_analyse.py          (Node 18+ for the generator; a few seconds)
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import privacy_check as pc  # noqa: E402

SYNTH = os.path.join(HERE, 'hb_synth.js')
ANALYSE = os.path.join(HERE, 'hb_analyse.py')


def jload(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def rtext(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def run(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, timeout=600, **kw)


class HbAnalyse(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='hb-test-')
        syn = os.path.join(cls.tmp, 'syn')
        r = run(['node', SYNTH, syn, '--seed', '3'])
        assert r.returncode == 0, r.stderr
        cls.truth = jload(os.path.join(syn, 'truth.json'))
        cls.rec = os.path.join(syn, 'rec')
        cls.out = os.path.join(cls.tmp, 'out')
        cls.res = run([sys.executable, '-I', ANALYSE, cls.rec, '-o', cls.out])
        assert cls.res.returncode == 0, cls.res.stderr
        cls.rep = jload(os.path.join(cls.out, 'report.json'))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def r(self, letter):
        sid = self.truth['sessions'][letter]['session']
        return next(x for x in self.rep['recordings'] if x['session'] == sid)

    def near(self, got, want, tol, what):
        self.assertTrue(abs(got - want) <= tol, '%s: %s, wanted %s +- %s' % (what, got, want, tol))

    def test_outputs(self):
        for n in ('report.md', 'report.json', 'summary.md', 'events.csv'):
            self.assertTrue(os.path.getsize(os.path.join(self.out, n)) > 100, n)
        self.assertIn('3 recording(s)', self.res.stdout)
        self.assertIn('lights present/silent/defaults only, verdict present/silent/defaults only', self.res.stdout)

    def test_signal_report(self):
        a, b = self.r('A'), self.r('B')
        self.assertEqual(a['groups']['lights'], 'present')
        self.assertEqual(a['groups']['verdict'], 'present')
        f = {x['tag']: x for x in a['fields']}
        # the folded repeats count as arrivals: every object slot arrives at the invented 15 Hz, most of it folded
        for n in range(1, 16):
            self.near(f['hb-obj%d' % n]['rate_hz'], 15, 0.5, 'hb-obj%d rate' % n)
            self.assertEqual(f['hb-obj%d' % n]['gaps'], 0)
        self.assertGreater(f['hb-obj1']['folded'], 10 * f['hb-obj1']['lines'] // 2)
        self.near(f['hb-control']['rate_hz'], 10, 0.3, 'hb-control rate')
        self.assertEqual(a['objects']['max_at_once'], 4)
        self.assertEqual(sorted(a['objects']['samples_per_class']), ['1', '2', '3'])
        self.assertEqual(sorted(a['objects']['status_values_seen']), ['1', '7'])
        self.assertIn('hb-wiper-stalk', a['silent_fields'])
        # the silent camera: said so, not an error
        self.assertEqual(b['groups']['lights'], 'silent')
        self.assertEqual(b['verdict'], {'present': False, 'status': 'silent'})
        self.assertFalse(b['objects']['present'])
        for t in ['hb-obj%d' % n for n in range(1, 16)] + ['hb-control', 'hb-meid1', 'hb-meid2', 'hb-lamps']:
            self.assertIn(t, b['silent_fields'])
        self.assertTrue(a['complete'] and b['complete'])
        # HR-REPORT 3.1's third outcome: the events arrive, every output at its default ("defaults only", not "present")
        c = self.r('C')
        self.assertEqual((c['groups']['lights'], c['groups']['verdict'], c['groups']['object_ids']), ('defaults only',) * 3)
        self.assertEqual(c['verdict']['status'], 'defaults only')
        fc = {x['tag']: x for x in c['fields']}
        self.assertFalse(fc['hb-obj1']['non_default'] or fc['hb-control']['non_default'])
        self.assertTrue(f['hb-control']['non_default'] and f['hb-obj1']['non_default'])
        self.assertFalse(f['hb-obj12']['non_default'])           # a slot nothing ever filled
        self.assertEqual(a['groups']['fallback_objlist_lamps'], 'present')

    def test_parked_check(self):
        a = self.r('A')
        pcx = a['parked_check']
        self.assertIsNotNone(pcx)
        bits = self.truth['stalk']
        want = ['push', 'pull', 'pull', 'leftFull', 'rightFull', 'leftTip', 'rightTip']
        self.assertEqual([row['bits'] for row in pcx['rows']], ['0x%02x' % bits[k] for k in want])
        self.assertEqual((pcx['push'], pcx['pull'], pcx['flash']), ('0x10', '0x20', '0x20'))
        self.near(pcx['after_mark_s'], 2.0, 0.05, 'after the mark')
        for m in self.truth['highMembers']:
            self.assertIn(m, pcx['highMembers'])
        self.assertEqual(self.r('B')['parked_check'], None)

    def test_driver_timeline(self):
        lag = self.truth['encodings']['lampDelay_s']
        for letter in ('A', 'B', 'C'):
            r, tr = self.r(letter), self.truth['sessions'][letter]
            self.assertEqual(r['high_source'], tr['highMember'])
            road = [e for e in r['timeline'] if not e['parked']]
            for kind, want in (('high_on', tr['highs']), ('high_off', tr['dips']), ('flash', tr['flashes'])):
                got = [e['t_s'] for e in road if e['kind'] == kind]
                self.assertEqual(len(got), len(want), '%s %s: %s vs %s' % (letter, kind, got, want))
                for g, w in zip(got, want):
                    self.near(g, w + lag, 0.12, '%s %s' % (letter, kind))
            self.assertEqual(r['counts'], {'high_on': len(tr['highs']), 'high_off': len(tr['dips']), 'flash': len(tr['flashes'])})

    def test_verdict_against_the_driver(self):
        v = self.r('A')['verdict']
        self.assertEqual(v['status'], 'present')
        self.assertEqual(v['allow_value_guess'], self.truth['encodings']['controlHighBeam']['allow'])
        self.assertTrue(0.8 < v['agreement'] < 0.97, v['agreement'])
        for k in ('high_on', 'high_off'):
            self.near(v['lead_s'][k]['median'], self.truth['expectedLead_s'][k], 0.15, 'lead ' + k)
            self.assertEqual(v['lead_s'][k]['unmatched'], 0)
        self.near(v['best_shift_s'], 1.5, 0.4, 'best shift')
        self.assertEqual(sorted(v['reasons']), ['0x0000', '0x0001', '0x0004'])

    def test_labelled_events(self):
        a, tr = self.r('A'), self.truth['sessions']['A']
        dips = [e for e in a['labelled'] if e['driver'] == 'high_off']
        self.assertEqual(len(dips), len(tr['dips']))
        by_t = {round(e['t_s'] - self.truth['encodings']['lampDelay_s']): e for e in dips}
        d = tr['drive_s']
        onc = by_t[d + 45]
        self.assertEqual(onc['kind'], 'light')
        self.assertTrue(any(o['cls'] == 1 and o['dist_falls'] and o['x'][1] < o['x'][0] for o in onc['objects']), onc['objects'])
        self.assertTrue(any(c['to'] == 0 and -1.5 < c['at_s'] < -1.1 for c in onc['verdict']['changes']), onc['verdict'])
        fol = by_t[d + 82]
        self.assertEqual(fol['kind'], 'preceding')
        self.assertTrue(fol['context']['following'])
        self.assertEqual([o['cls'] for o in fol['objects']], [2])
        town = by_t[d + 200]
        self.assertEqual(town['kind'], 'town')
        self.assertEqual(town['context']['limit_kmh'], 50)
        self.assertTrue(town['context']['urban'])
        self.assertEqual(town['context']['brightness'], 150)
        self.assertTrue(all(e['kind'] == 'clear' for e in a['labelled'] if e['driver'] == 'high_on'))
        b = self.r('B')
        bd = [e for e in b['labelled'] if e['driver'] == 'high_off']
        self.assertEqual(bd[0]['kind'], 'oncoming')                 # the fallback list's oncoming car, with the camera's lights silent
        self.assertEqual(bd[0]['objects'], [])
        self.assertIsNone(bd[0]['verdict'])
        self.assertTrue(any(o.get('src') == 'objlist' and o.get('head') == 'KHEADLIGHTSTATUS_ON' and o.get('vx_abs') < 0 for o in bd[0]['context']['fallback']), bd[0]['context'])
        rows = rtext(os.path.join(self.out, 'events.csv')).strip().split('\n')
        self.assertEqual(len(rows) - 1, sum(len(self.r(x)['labelled']) for x in ('A', 'B', 'C')))

    def test_town_from_the_signs(self):
        # the owner navigates with CarPlay: no map flag; the town comes from the camera's town signs (and the limit as a weaker cue)
        a, tr = self.r('A'), self.truth['sessions']['A']
        self.assertNotIn('ccp-builtup', [f['tag'] for f in a['fields']])
        signs = [x for x in a['town'] if x['src'] == 'cam-signs']
        self.assertEqual([x['kind'] for x in signs], ['town_in', 'town_out'])
        self.near(signs[0]['t_s'], tr['town'][0], 0.6, 'town in')
        self.near(signs[1]['t_s'], tr['town'][1], 0.6, 'town out')
        self.assertEqual([x['kind'] for x in a['town'] if x['src'] == 'tsr'], ['limit_50_or_less', 'limit_over_50'])
        md = rtext(os.path.join(self.out, 'report.md'))
        self.assertIn('town_in (cam-signs)', md)
        full = [json.loads(x) for x in rtext(os.path.join(self.out, 'scenarios', 'R.%s.jsonl' % a['session'])).split('\n') if x]
        mid_town = next(f for f in full if f['t'] >= (tr['town'][0] + 10) * 1000)
        self.assertTrue(mid_town['env']['v']['urban'])
        self.assertFalse(next(f for f in full if f['t'] >= (tr['town'][1] + 10) * 1000)['env']['v']['urban'])

    def test_diagnostic_reads_in_the_parked_check(self):
        dg = self.r('A')['diag']
        self.assertEqual(sorted(dg['reads']), ['diag-bdc-d542', 'diag-bdc-e3b8'])
        rows = {e['step']: e for e in dg['parked']}
        c = self.truth['diagContact']
        for step, bit in (('push', 0x10), ('pull', 0x20), ('left_full', 0x08), ('right_tip', 0x01)):
            self.assertIn('%02X 00' % c[str(bit)], rows[step]['diag-bdc-e3b8'], step)
        self.assertIn('01 00', rows['push']['diag-bdc-d542'])
        self.assertEqual(rows['pull']['diag-bdc-d542'], ['00 00'])
        self.assertEqual(self.r('B')['diag'], {'reads': {}, 'parked': []})

    def test_high_kept_with_objects(self):
        k = self.r('A')['kept_high']
        want = self.truth['sessions']['A']['keepHighWithObjects']
        self.assertEqual(len(k), len(want), k)
        self.near(k[0]['t0_s'], want[0][0], 1.0, 'kept from')
        self.near(k[0]['t1_s'], want[0][1], 1.5, 'kept to')
        self.assertEqual(list(k[0]['classes']), ['3'])
        self.assertEqual(self.r('B')['kept_high'], [])

    def test_decode_helpers(self):
        d = self.r('A')['decode']
        self.assertEqual(d['classes_only_while_following'], [self.truth['encodings']['classes']['tail']])
        on, off = d['stalk_bits_before_lamp_changes']['high_on'], d['stalk_bits_before_lamp_changes']['high_off']
        self.assertEqual(max(on, key=on.get), '0x%02x' % self.truth['stalk']['push'])
        self.assertEqual(max(off, key=off.get), '0x%02x' % self.truth['stalk']['pull'])
        self.assertGreaterEqual(d['distance_falls_before_dips']['falling'], 2)
        self.assertGreaterEqual(d['x_moves_outward_around_dips']['outward'], 2)
        lag = self.truth['encodings']['lampDelay_s'] * 1000
        for m in self.truth['highMembers']:
            self.near(d['stalk_to_lamp_latency'][m]['median_ms'], lag, 60, 'stalk to ' + m)
        self.assertEqual(d['lamp_status_vehicle_ahead'].get('LICHT_AN', 0) > 0, True)
        self.assertEqual(d['fallback_lamp_states']['rear.ahead'], {'KREARLIGHTSTATUS_ON': d['fallback_lamp_states']['rear.ahead']['KREARLIGHTSTATUS_ON']})
        db = self.r('B')['decode']
        self.assertEqual(list(db['fallback_lamp_states']['head.oncoming']), ['KHEADLIGHTSTATUS_ON'])
        self.near(db['fallback_oncoming_first_x']['max'], 100, 1.0, 'the fallback\'s first x')

    def test_scenarios(self):
        sdir = os.path.join(self.out, 'scenarios')
        names = sorted(os.listdir(sdir))
        self.assertEqual(sorted(self.rep['scenarios']), sorted(n for n in names if n.endswith('.json')))
        for letter in ('A', 'B'):
            r = self.r(letter)
            sid = r['session']
            full = jload(os.path.join(sdir, 'R.%s.json' % sid))
            for k, v in (('format', 'beam-scenario'), ('version', 1), ('family', 'R'), ('source', 'recorded'), ('id', 'R.' + sid)):
                self.assertEqual(full[k], v)
            self.assertNotIn('frames', full)
            frames = [json.loads(x) for x in rtext(os.path.join(sdir, full['framesFile'])).split('\n') if x]
            ts = [f['t'] for f in frames]
            self.assertEqual(ts, sorted(ts))
            self.assertEqual(ts[0], 0)
            self.near(ts[-1] / 1000.0, r['span_s'], 0.2, 'frames span')
            for f in frames[::50]:
                for g, x in f.items():
                    if g == 't':
                        continue
                    self.assertEqual(sorted(k for k in x if k != 'qual'), ['age', 'ok', 'v'], g)
            self.assertEqual([d['kind'] for d in full['driver']], [e['kind'] for e in r['timeline']])
            stalk = [e for f in frames for e in f['stalk']['v']]
            self.assertEqual([e['kind'] for e in stalk], [e['kind'] for e in r['timeline']])
            mid = frames[len(frames) // 2]
            self.assertIn('car', mid)
            self.assertIn('lamps', mid)
            self.assertIn(mid['lamps']['v']['high'], (True, False))
            if letter == 'A':
                self.assertIn('lights', mid)
                self.assertIn('verdict', mid)
                lit = [f for f in frames if f.get('lights', {}).get('v')]
                o = lit[0]['lights']['v'][0]
                self.assertEqual(sorted(o), sorted(['id', 'cls', 'status', 'x', 'y', 'w', 'h', 'dist', 'wl', 'wr', 'age']))
                self.assertTrue(all(x['status'] != 7 for f in lit for x in f['lights']['v']))
                self.assertTrue(all(f['lights']['age'] < 1100 for f in frames if 'lights' in f))      # the folded repeats keep the age low
            else:
                self.assertFalse(any('lights' in f or 'verdict' in f for f in frames))
                onc = [o for f in frames for o in f.get('objects', {}).get('v', []) if o.get('src') == 'objlist']
                self.assertTrue(onc and all(o['head'] == 'KHEADLIGHTSTATUS_ON' and o['vx_abs'] < 0 for o in onc))
            for e in r['labelled']:
                n = 'R.%s.e%02d.%s.json' % (sid, e['n'], e['kind'])
                sc = jload(os.path.join(sdir, n))
                self.assertEqual(sc['frames'][0]['t'], 0)
                self.assertEqual(len(sc['labels']), 1)
                self.assertIn(e['driver'], [d['kind'] for d in sc['driver']])
                self.near(sc['meta']['offset_ms'] / 1000.0 + sc['labels'][0]['t0'] / 1000.0 + 5, e['t_s'], 0.15, 'event offset')

    def test_summary(self):
        s = rtext(os.path.join(self.out, 'summary.md'))
        self.assertIn('## Українською', s)
        self.assertIn('## English', s)
        self.assertIn('push = bit 0x10, pull = 0x20', s)

    def test_privacy(self):
        doc = jload(os.path.join(self.out, 'report.json'))
        # the car's own member names (long camelCase names with a digit) read like a token to the rule: those, and only those, are allowed
        names = set()
        for r in doc['recordings']:
            for f in r['fields']:
                names.add(f['tag'])
                names.add(f['source'])
                for c in f['ranges']:
                    names.add(c)
                    names.add(f['tag'] + '.' + c)
        hits = []
        for where, rule in pc.check_derived(doc):
            node = doc
            for part in where.replace('[', '.').replace(']', '').split('.')[1:]:
                if part == '<key>':
                    break
                node = node[int(part)] if part.isdigit() else node[part]
            if not (rule == 'token' and (node in names or '<key>' in where)):
                hits.append((where, rule))
        self.assertEqual(hits, [])
        for root, _, files in os.walk(self.out):
            for n in files:
                text = rtext(os.path.join(root, n))
                for bad in ('/Users/', '/private/', '/var/folders', '/tmp/', self.tmp):
                    self.assertNotIn(bad, text, n)
                self.assertFalse(re.search(r'latitude|longitude|wgs', text, re.I), n)


class SilentOnly(unittest.TestCase):
    def test_silent_camera_alone(self):
        tmp = tempfile.mkdtemp(prefix='hb-test-')
        try:
            syn = os.path.join(tmp, 'syn')
            self.assertEqual(run(['node', SYNTH, syn, '--seed', '5']).returncode, 0)
            truth = jload(os.path.join(syn, 'truth.json'))
            sid = truth['sessions']['B']['session']
            only = [os.path.join(syn, 'rec', n) for n in os.listdir(os.path.join(syn, 'rec')) if sid in n]
            out = os.path.join(tmp, 'out')
            r = run([sys.executable, '-I', ANALYSE] + only + ['-o', out, '--no-scenarios'])
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn('lights silent, verdict silent', r.stdout)
            s = rtext(os.path.join(out, 'summary.md'))
            self.assertIn('Камера надсилає об’єкти світла: **ні**', s)
            self.assertIn('The camera sends its light objects: **no**', s)
            self.assertIn('**Silent**', rtext(os.path.join(out, 'report.md')))
            self.assertFalse(os.path.exists(os.path.join(out, 'scenarios')))
            empty = os.path.join(tmp, 'empty')
            os.makedirs(empty)
            self.assertEqual(run([sys.executable, '-I', ANALYSE, empty, '-o', os.path.join(tmp, 'o2')]).returncode, 1)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
