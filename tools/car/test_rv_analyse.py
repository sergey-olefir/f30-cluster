#!/usr/bin/env python3
"""Round "Road View", package TS: tests of tools/car/rv_analyse.py on synthetic RV recordings made by tools/car/rv_synth.js (the RV
recorder's own engine and Signal Probe's recorder). The truth is in the generator's truth.json: invented numbers, not car facts.

    python3 tools/car/test_rv_analyse.py          (Node 18+ for the generator; a few seconds)
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
SYNTH = os.path.join(HERE, 'rv_synth.js')
ANALYSE = os.path.join(HERE, 'rv_analyse.py')


def read(p):
    with open(p, encoding='utf-8') as fh:
        return fh.read()


def jload(p):
    return json.loads(read(p))


def run(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=600)


def analyse(inputs, out, notes=None):
    a = [sys.executable, ANALYSE] + inputs + ['-o', out]
    if notes:
        a += ['--notes', notes]
    r = run(a)
    assert r.returncode == 0, r.stderr + r.stdout
    return {k: jload(os.path.join(out, k + '.json')) for k in ('sources', 'lights', 'signs', 'scene')}


class RvAnalyse(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='rv-test-')
        cls.syn = os.path.join(cls.tmp, 'syn')
        r = run(['node', SYNTH, cls.syn, '--seed', '5'])
        assert r.returncode == 0, r.stderr
        cls.truth = jload(os.path.join(cls.syn, 'truth.json'))
        cls.rec = os.path.join(cls.syn, 'rec')
        cls.out = os.path.join(cls.tmp, 'out')
        cls.r = analyse([cls.rec], cls.out, os.path.join(cls.syn, 'notes.json'))
        cls.sid = {s['plan']: s['session'] for s in cls.truth['sessions']}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # ---- lights ---------------------------------------------------------------------------------------------------------------
    def test_colour_table_recovered_with_counts(self):
        tab = self.r['lights']['table']['color']
        enc = self.truth['encodings']['color']          # raw -> name, invented
        for raw in ('1', '2', '3', '4'):
            self.assertEqual(tab[raw]['proposal'], enc[raw], 'colour %s: %s' % (raw, tab[raw]))
        self.assertGreaterEqual(tab['1']['marks'].get('red', 0), 5, 'five red-first marks vote red')
        self.assertGreaterEqual(tab['3']['marks'].get('green', 0), 7, 'green passes, the arrow and the light changes vote green')
        self.assertEqual(tab['1']['basis'], 'marks and display agree')
        self.assertEqual(tab['4']['basis'], 'display', 'red-amber: no mark says it, the display feed does')
        self.assertTrue(tab['0']['proposal'].startswith('off?'), 'the flashing light\'s second value: ' + tab['0']['proposal'])

    def test_arrow_and_status(self):
        arrow = self.r['lights']['table']['arrow']
        self.assertEqual(arrow['1']['proposal'], 'arrow')
        self.assertEqual(arrow['0']['proposal'], 'no-arrow')
        st = self.r['lights']['table']['status']
        self.assertTrue(st['2']['proposal'].startswith('new'), st['2'])
        self.assertTrue(st['1']['proposal'].startswith('tracked'), st['1'])

    def test_marks_only_session_and_unknown_entries(self):
        out = os.path.join(self.tmp, 'out-b')
        files = [os.path.join(self.rec, n) for n in os.listdir(self.rec) if self.sid['B'] in n]
        r = analyse(files, out, os.path.join(self.syn, 'notes.json'))
        tab = r['lights']['table']['color']
        for raw, name in (('1', 'red'), ('3', 'green'), ('2', 'amber')):
            self.assertEqual(tab[raw]['proposal'], name)
            self.assertEqual(tab[raw]['basis'], 'marks', 'session B has no display feed: the marks alone')
            self.assertEqual(tab[raw]['display_n'], 0)
        self.assertEqual(tab['4']['proposal'], 'unknown', 'red-amber has no evidence in B: it stays unknown')
        self.assertEqual(tab['4']['basis'], 'no evidence')

    def test_tracks_and_sequences(self):
        tracks = self.r['lights']['tracks']
        planted = sum(len(s['lights']) for s in self.truth['sessions'])
        self.assertEqual(len(tracks), planted, 'one track per planted light')
        t7 = [t for t in tracks if t['id'] == 7 and t['session'] == self.sid['A']][0]
        self.assertEqual([r[0] for r in t7['colour_runs']], [3, 2, 1, 4, 3], 'green, amber, red, red-amber, green')
        self.assertGreater(t7['x']['first'], t7['x']['last'], 'X falls on the approach')
        fl = self.r['lights']['flashing']
        self.assertTrue(any(f['values'] == [0, 2] and f['track'].startswith('30#') for f in fl), fl)
        self.assertFalse(any(f['track'].startswith('31#') for f in fl), 'the steady light beside it is not flashing')

    def test_marks_matched_to_the_planted_light(self):
        by = {(m['session'], m['mark']): m for m in self.r['lights']['marks']}
        n = 0
        for s in self.truth['sessions']:
            for m in s['marks']:
                if 'light' not in m:
                    continue
                got = by[(s['session'], m['mark'])]
                self.assertEqual(int(got['light'].split('#')[0]), m['light'], '%s M%d %s' % (s['plan'], m['mark'], m['what']))
                n += 1
        self.assertGreaterEqual(n, 13)
        reds = [m for m in self.r['lights']['marks'] if m['what'] == 'red-first']
        self.assertTrue(all(m['speed_kmh'] == 0 for m in reds), 'standing at every red-first mark')
        h = self.r['lights']['histograms']['red-first']['trafficLightColor']
        self.assertEqual(list(h.keys()), ['1'], 'the red-first marks share one colour value')

    # ---- signs ------------------------------------------------------------------------------------------------------------------
    def test_signs(self):
        S = self.r['signs']
        planted = self.truth['sessions'][0]['signs']
        for p in planted:
            self.assertIn(p['type'], S['types'])
            self.assertIn('cam-signs', S['types'][p['type']])
            self.assertIn('cam-legacy2', S['types'][p['type']])
        self.assertEqual(len(S['marks']), len(planted))
        self.assertTrue(all(m['matched'] for m in S['marks']), [m for m in S['marks'] if not m['matched']])
        plate = [m for m in S['marks'] if m['what'] == 'limit-plate'][0]
        self.assertEqual(plate['found']['cam-signs']['value'], 30)
        self.assertEqual(plate['found']['cam-signs']['supp'], ['SS_TIME'])
        var = [m for m in S['marks'] if m['what'] == 'variable-limit'][0]
        self.assertTrue(var['found']['cam-signs']['variable'])
        leads = sorted(x['legacy2_minus_new_ms'] for x in S['leads'])
        self.assertEqual(leads[len(leads) // 2], self.truth['lags']['legacy2'], 'the second stream is later by the planted lag')
        codes = self.truth['signCodes']
        for name, code in codes.items():
            got = S['legacy_codes'].get(str(code), {})
            self.assertEqual(max(got, key=got.get) if got else None, name, 'old stream %d' % code)

    def test_limit_follows(self):
        L = self.r['signs']['limits']
        self.assertEqual([x['kmh'] for x in L], [50, 30])
        lag = self.truth['lags']
        for x in L:
            self.assertIsNotNone(x['hud2_vsliValue_after_ms'])
            self.assertLess(abs(x['hud2_vsliValue_after_ms'] - (lag['vsliValue'] - lag['tsr'])), 400, x)
            self.assertIsNotNone(x['hud_vSLISpeedValue_after_ms'])

    # ---- sources and the scene --------------------------------------------------------------------------------------------------
    def test_silent_sources_are_reported_silent(self):
        src = {e['tag']: e for e in self.r['sources']}
        always = set(self.truth['sessions'][0]['silent']) & set(self.truth['sessions'][1]['silent'])
        self.assertTrue(always)
        for t in always:
            self.assertFalse(src[t]['present'], t)
            self.assertEqual(src[t]['verdict'], 'nothing', t)
        for t in ('tl', 'cam-signs', 'tsr', 'hud-data2', 'object-info1', 'cam-objects'):
            self.assertEqual(src[t]['verdict'], 'real values', t)
        self.assertEqual(src['warn-brake']['verdict'], 'defaults only', 'KEIN_WARNSYMBOL_ANZEIGEN only')
        self.assertEqual(len(src), 39, 'every source of the set is listed')

    def test_scene(self):
        R = self.r['scene']
        self.assertFalse(R['lists']['road-segment'][self.sid['A']]['present'])
        oi = R['lists']['object-info1'][self.sid['A']]
        self.assertEqual(oi['msgs_per_s'], 10)
        ag = [a for a in R['agreement'] if a['list'] == 'object-info1' and a['session'] == self.sid['A']][0]
        self.assertGreater(ag['mean_overlap'], 0.9, 'the same ids as the camera\'s list')

    # ---- outputs ----------------------------------------------------------------------------------------------------------------
    def test_scenarios(self):
        idx = jload(os.path.join(self.out, 'scenarios', 'index.json'))
        lights = [x for x in idx if x['kind'] == 'light']
        self.assertEqual(len(lights), len(self.r['lights']['tracks']))
        one = jload(os.path.join(self.out, 'scenarios', [x['file'] for x in lights if 'red-first' in x['marks']][0]))
        self.assertEqual(one['frames'][0][0], 0)
        self.assertEqual(len(one['columns']), len(one['frames'][0]))
        self.assertTrue(all(isinstance(v, (int, float)) for fr in one['frames'] for v in fr), 'numbers only')
        self.assertTrue(any(x['kind'] == 'sign' for x in idx))

    def test_text_notes_and_privacy(self):
        notes = os.path.join(self.tmp, 'notes.txt')
        sid = self.sid['B']
        with open(notes, 'w') as fh:
            fh.write('%s M1 red-first near the Bakerystreet corner\n%s M2: red-first\n%s M3 green-pass\nM4 light-change quickly\nM9 something-else Canarytext\n' % (sid, sid, sid))
        import rv_analyse as ra
        got = ra.read_notes(notes)
        self.assertEqual(got[(sid, 1)], 'red-first')
        self.assertEqual(got[(None, 4)], 'light-change')
        self.assertNotIn((None, 9), got, 'a word outside the labels is dropped')
        out = os.path.join(self.tmp, 'out-txt')
        files = [os.path.join(self.rec, n) for n in os.listdir(self.rec) if sid in n]
        r = analyse(files, out, notes)
        self.assertEqual(r['lights']['table']['color']['1']['proposal'], 'red')
        for n in os.listdir(out):
            p = os.path.join(out, n)
            if os.path.isfile(p):
                txt = read(p)
                self.assertNotIn('Bakery', txt, n)
                self.assertNotIn('Canary', txt, n)

    def test_short_run_without_signs(self):
        syn = os.path.join(self.tmp, 'short')
        r = run(['node', SYNTH, syn, '--short'])
        self.assertEqual(r.returncode, 0, r.stderr)
        res = analyse([os.path.join(syn, 'rec')], os.path.join(self.tmp, 'out-short'))
        self.assertEqual(res['signs']['marks'], [], 'no notes: no sign mark is matched or guessed')
        src = {e['tag']: e for e in res['sources']}
        self.assertEqual(src['cam-signs']['verdict'], 'nothing')
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, 'out-short', 'summary.md')))

    def test_summary_both_languages(self):
        s = read(os.path.join(self.out, 'summary.md'))
        self.assertIn('## Українською', s)
        self.assertIn('## English', s)
        self.assertIn('1 = red', s)
        self.assertIn('not a fact', s)

    def test_no_recording(self):
        empty = os.path.join(self.tmp, 'empty')
        os.makedirs(empty)
        r = run([sys.executable, ANALYSE, empty, '-o', os.path.join(self.tmp, 'o')])
        self.assertEqual(r.returncode, 1)
        self.assertIn('no recording', r.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=1)
