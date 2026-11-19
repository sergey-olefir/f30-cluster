#!/usr/bin/env python3
"""r1120 AC: tests of tools/car/acc_analyse.py on synthetic ACC recordings made by tools/car/acc_synth.js (the cruise simulator's
plant, the app's own recorder). The truth is in the generator's truth.json: invented numbers, not car facts.

    python3 tools/car/test_acc_analyse.py          (Node 18+ for the generator; about a minute)
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
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
import privacy_check as pc  # noqa: E402

SYNTH = os.path.join(HERE, 'acc_synth.js')
ANALYSE = os.path.join(HERE, 'acc_analyse.py')


def run(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, timeout=900, **kw)


class AccAnalyse(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='acc-test-')
        syn = os.path.join(cls.tmp, 'syn')
        r = run(['node', SYNTH, syn, '--seed', '3'])
        assert r.returncode == 0, r.stderr
        cls.truth = json.load(open(os.path.join(syn, 'truth.json')))
        cls.out = os.path.join(cls.tmp, 'out')
        cls.res = run([sys.executable, ANALYSE, os.path.join(syn, 'rec'), '-o', cls.out, '--anchors', os.path.join(syn, 'anchors.json')])
        assert cls.res.returncode == 0, cls.res.stderr
        cls.p1 = json.load(open(os.path.join(cls.out, 'phase1.json')))
        cls.p2 = json.load(open(os.path.join(cls.out, 'phase2.json')))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def unit(self, kind, source):
        for x in self.p1['units'][kind]:
            if x.get('source') == source:
                return x
        self.fail('no %s source %s' % (kind, source))

    def field(self, session_letter, tag):
        sid = self.truth['sessions'][session_letter]['session']
        rec = next(r for r in self.p1['recordings'] if r['session'] == sid)
        return next(f for f in rec['fields'] if f['tag'] == tag)

    def test_outputs(self):
        for n in ('phase1.md', 'phase1.json', 'phase2.md', 'phase2.json', 'plant.json', 'summary.md', 'steps.csv', 'steps.svg'):
            self.assertTrue(os.path.getsize(os.path.join(self.out, n)) > 100, n)
        self.assertIn('3 recording(s)', self.res.stdout)
        s = open(os.path.join(self.out, 'summary.md')).read()
        self.assertIn('# Підсумок', s)
        self.assertIn('## In English', s)

    def test_native_rates_and_the_payload_clock(self):
        for tag in ('car-speed2', 'speed', 'front-vehicle', 'cam2-polar', 'hud-data2'):
            want = self.truth['signals'][tag]['hz']
            got = self.field('B' if tag != 'cam2-polar' else 'C', tag)
            self.assertAlmostEqual(got['mean_rate_hz'], want, delta=0.06 * want + (2 if tag == 'hud-data2' else 0), msg=tag)
            self.assertEqual(got['recorder_drops'], 0, tag)
        sp = self.field('B', 'speed')
        self.assertEqual(sp['counter']['missed'], 0)
        self.assertEqual(sp['counter']['modulo'], 15)
        pcl = self.field('C', 'cam2-polar')['payload_clock']
        self.assertAlmostEqual(pcl['receive_s_per_payload_s'], 1.0, delta=0.001)
        self.assertLess(pcl['receive_minus_payload_spread_ms'], 30)
        self.assertIn('steering', [f['tag'] for f in self.p1['recordings'][1]['fields']])
        self.assertIn('keep-dist-1', self.p1['silent'], 'a field of the ACC set the drive never sent is named silent')
        self.assertNotIn('front-vehicle', self.p1['silent'])

    def test_units_against_the_anchors(self):
        u = self.truth['expect']['units']
        checks = [('speed', 'speed.speedVehicleCentreOfGravity', 0.01), ('speed', 'velocity.velocityVehicleCog.velocityVehicleCog', 0.01),
                  ('speed', 'dynamics-long.vehicleSpeedLongitudinal', 0.01), ('speed', 'wheel-rpm.actualValueRPMWheelFLH', 0.01),
                  ('speed', 'display-speed.displayedValueSpeed', 0.015), ('set_speed', 'ldm-guidance.valueRequestSpeed', 0.01),
                  ('set_speed', 'hud-data.cruiseCtrlSpeedHUD', 0.01), ('gap', 'front-vehicle.frontVehicleGapX', 0.03),
                  ('relative_speed', 'front-vehicle.frontVehicleSpeedX', 0.1), ('acceleration', 'cds-accel-long.longitudinalAccelerationCentreOfGravity', 0.03),
                  ('acceleration', 'accel-long.longitudinalAccelerationCentreOfGravity', 0.03),
                  ('acceleration', 'dynamics-long.longitudinalAccelerationDrivingDirection2', 0.03)]
        for kind, src, tol in checks:
            k = self.unit(kind, src)['k']
            self.assertAlmostEqual(k / u[src], 1.0, delta=tol, msg='%s: k %s, truth %s' % (src, k, u[src]))
        self.assertEqual(self.unit('speed', 'velocity.velocityVehicleCog.velocityVehicleCog')['unit'], 'm/s -> km/h')
        self.assertEqual(self.unit('set_speed', 'ldm-guidance.valueRequestSpeed')['unit'], '0.5')
        self.assertAlmostEqual(self.unit('gap', 'cam2-polar.polarCoordinates.0.distance')['k'], 1.0, delta=0.03)
        self.assertAlmostEqual(self.unit('acceleration', 'accel-long-cog.accelerationLongitudinalCog.accelerationLongitudinalCentreOfGravity')['k'], 1.0, delta=0.03)

    def test_latency(self):
        lag = self.truth['expect']['relLag_ms']
        for kind, src, tag, tol in (('speed', 'speed.speedVehicleCentreOfGravity', 'speed', 25), ('speed', 'velocity.velocityVehicleCog.velocityVehicleCog', 'velocity', 25),
                                    ('speed', 'wheel-rpm.actualValueRPMWheelFLH', 'wheel-rpm', 25), ('speed', 'display-speed.displayedValueSpeed', 'display-speed', 40),
                                    ('acceleration', 'accel-long-cog.accelerationLongitudinalCog.accelerationLongitudinalCentreOfGravity', 'accel-long-cog', 40)):
            got = self.unit(kind, src)['lag_ms']
            self.assertAlmostEqual(got, lag[tag], delta=tol, msg='%s: %s ms, truth %s' % (src, got, lag[tag]))

    def test_plant_fit(self):
        e, f = self.truth['expect'], self.p2['fit']
        self.assertAlmostEqual(f['deadTime_s'], e['deadTimeUp_s'], delta=0.1)
        self.assertAlmostEqual(f['deadTimeDown_s'], e['deadTimeDown_s'], delta=0.1)
        self.assertAlmostEqual(f['tau_s'] / e['tauUp_s'], 1, delta=0.15)
        self.assertAlmostEqual(f['tauDown_s'] / e['tauDown_s'], 1, delta=0.15)
        self.assertAlmostEqual(f['aMax_ms2'], e['aMax_ms2'], delta=0.1)
        self.assertAlmostEqual(f['aMin_ms2'], e['aMin_ms2'], delta=0.1)
        self.assertTrue(f['exit_criterion_met'])
        self.assertLess(f['rms_kmh']['all'], 0.5)
        ss = self.p2['steady_state']
        self.assertAlmostEqual(ss['k'], e['steady']['k'], delta=0.01)
        self.assertAlmostEqual(ss['c'], e['steady']['c'], delta=0.4)
        self.assertGreater(f['brakeMax_ms2'], 0.3, 'the plant braked beyond the coast-down: identified as braking')
        self.assertGreater(f['cruise_brakes']['brake_lamp_lit_without_driver'], 0)
        sizes = sorted(set(r['size_kmh'] for r in f['by_step_size']))
        self.assertEqual(sizes, [-20, -10, -5, -1, 1, 5, 10, 20])

    def test_steps_kept_and_left_out(self):
        b = self.truth['sessions']['B']['session']
        kept_b = [s for s in self.p2['steps'] if s['session'] == b and s['used']]
        self.assertEqual(len(kept_b), self.truth['expect']['usableStepsB'])
        self.assertEqual(self.p2['left_out'], {'accelerator pressed': 1})
        self.assertEqual(self.p2['set_changes']['resolution_kmh'], 1)
        self.assertGreaterEqual(self.p2['interventions']['suspensions'], 2)
        five = [s for s in kept_b if s['size'] == 5]
        self.assertTrue(five and all(s['presses'] == 5 for s in five), 'five taps grouped into one step')

    def test_plant_loads_in_the_simulator(self):
        plant = json.load(open(os.path.join(self.out, 'plant.json')))
        self.assertFalse(plant['assumed'])
        js = ("const sim = require(%r); const r = sim.run({ seed: 1, scenario: { id: 'demo.approach' }, plant: { file: process.argv[1] } });"
              "console.log(JSON.stringify(r.meta.plant));") % os.path.join(REPO, 'tools', 'cruise-sim', 'core', 'sim.js')
        r = run(['node', '-e', js, os.path.join(self.out, 'plant.json')])
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = json.loads(r.stdout.strip().split('\n')[-1])
        self.assertFalse(meta['assumed'])
        self.assertFalse(meta['modified'])

    def test_privacy(self):
        # the car's own member names (a long camelCase name with a digit) read like a token to the rule: those, and only those, are allowed
        import acc_analyse as aa
        names = set(t + '.' + c for t, c in aa.WANT)
        for n in ('phase1.json', 'phase2.json', 'plant.json'):
            doc = json.load(open(os.path.join(self.out, n)))
            hits = []
            for where, rule in pc.check_derived(doc):
                node = doc
                for part in where.replace('[', '.').replace(']', '').split('.')[1:]:
                    node = node[int(part)] if part.isdigit() else node[part]
                if not (rule == 'token' and node in names):
                    hits.append((where, rule))
            self.assertEqual(hits, [], n)
        for n in os.listdir(self.out):
            text = open(os.path.join(self.out, n), encoding='utf-8').read()
            for bad in ('/Users/', '/private/', '/var/folders', '/tmp/', self.tmp):
                self.assertNotIn(bad, text, n)


class NoSteps(unittest.TestCase):
    def test_no_step_no_plant(self):
        tmp = tempfile.mkdtemp(prefix='acc-test-')
        try:
            syn = os.path.join(tmp, 'syn')
            r = run(['node', SYNTH, syn, '--no-steps', '--no-anchors'])
            self.assertEqual(r.returncode, 0, r.stderr)
            out = os.path.join(tmp, 'out')
            r = run([sys.executable, ANALYSE, os.path.join(syn, 'rec'), '-o', out])
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn('no plant', r.stdout)
            self.assertFalse(os.path.exists(os.path.join(out, 'plant.json')))
            p2 = json.load(open(os.path.join(out, 'phase2.json')))
            self.assertTrue(any('no usable step' in n for n in p2['notes']), p2['notes'])
            p1 = json.load(open(os.path.join(out, 'phase1.json')))
            self.assertIn('no anchors', p1['units']['gap'][0]['note'])
            self.assertIn('Модель круїзу не побудовано', open(os.path.join(out, 'summary.md')).read())
            empty = os.path.join(tmp, 'empty')
            os.makedirs(empty)
            self.assertEqual(run([sys.executable, ANALYSE, empty, '-o', os.path.join(tmp, 'o2')]).returncode, 1)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
