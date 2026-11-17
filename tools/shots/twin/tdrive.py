"""tools/shots/twin: drive one bench (bench/server.js twin_dial) into the states of scenes.py and snapshot each.

A snapshot is the scene exactly as the bench streams it (every layer, shader, uniform, binding; GET /events) plus
every image layer's and asset's current pixels (GET /px, zlib-compressed): the format tools/shots/drive.py writes, so
tools/shots/paint.py (SnapZ) reads it. Rules as there: POST /restart at the start of every group (the D7 latch is
sticky), and never snapshot before GET /probe confirms the asked state; a state that is not confirmed in time is a
failed job with the probe's last answer, not a picture.

What GET /probe must show: the settings as asked, the app ready, and, when the engine exposes it (hud.cc: SPEC
section 2 of docs/AGENT-BRIEF-twin-r2.md), the message state (none | window | ours). An engine that does not expose
it gets no message check (the job says so). Standard library only (threads of run.py).
"""
import hashlib
import json
import os
import sys
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
import drive as D0      # noqa: E402  (tools/shots/drive.py: digest)
import scenes as SC     # noqa: E402

CONFIRM = {'id': 19, 'name': 'Багажник відчинено', 'color': 'white', 'symbol': 2}


def coerce(item, val):
    """A setting's value in the form tools/shots/benchc.py presses: a bool setting takes True / False."""
    if item['type'] == 'bool':
        return val in ('on', True, 1)
    return val


class Driver:
    def __init__(self, name, bench, snaps, log, settings_schema):
        self.name = name
        self.b = bench
        self.snaps = snaps
        self.logf = log
        self.schema = {s['key']: s for s in settings_schema}
        self.dirty = False

    def log(self, *a):
        with open(self.logf, 'a') as f:
            f.write(time.strftime('%H:%M:%S') + ' [' + self.name + '] ' + ' '.join(str(x) for x in a) + '\n')

    # ---- the bench ----
    def restart(self):
        self.b.restart()
        ok, p = self.b.until(lambda q: q.get('ready') and q.get('activeName'), 90, 0.2)
        if not ok:
            raise RuntimeError('bench did not come back after a restart')
        self.dirty = False
        return p

    def put_settings(self, want):
        p = self.b.probe() or {}
        cur = p.get('settings') or {}
        for k, v in want.items():
            if k not in self.schema:
                continue          # the app does not have this setting (yet): the check below says so
            v = coerce(self.schema[k], v)
            if cur.get(k) != v:
                if self.b.set(k, v, cur):
                    self.b.until(lambda q: (q.get('settings') or {}).get(k) == v, 20, 0.1)

    def feed_common(self, st):
        b = self.b
        b.post('/drive', {'value': st['drive']})
        b.signals(SC.signals_of(st))
        b.fake({'clock': {'minutes': SC.CLOCK_MINUTES, 'dst': False}})
        b.fake({'clockLocal': {'minutes': SC.CLOCK_MINUTES}})
        b.fake({'dayNight': 'night' if st['look'] == 'night' else 'day'})
        b.fake({'twin': dict(SC.TWIN)})                         # nothing about messages here: a blind start stays blind (displayed is a message witness)

    def feed_message(self, st):
        b = self.b
        msg = st['msg']
        target = st.get('message') or SC.TYRE
        if msg == 'blind':
            return                                              # nothing about messages, ever, since the restart
        if msg == 'none':
            b.fake({'ccList': [SC.REST], 'ccActive': {'number': 0}})
            b.fake({'twin': {'displayed': 0}})
            return
        if msg == 'window':
            b.fake({'ccList': [target]})                        # a message may show; the cluster never said "shown now"
            return
        if msg == 'ours':
            b.fake({'ccList': [CONFIRM], 'ccActive': {'number': CONFIRM['id'], 'control': 1, 'frame': 1, 'of': 1}})
            b.fake({'twin': {'displayed': CONFIRM['id']}})
            time.sleep(0.7)                                     # the D7 latch takes the first "shown now" that matches
            b.fake({'ccList': [target], 'ccActive': {'number': target['id'], 'control': 1, 'frame': 1, 'of': 1}})
            b.fake({'twin': {'displayed': target['id']}})

    def apply(self, job):
        st = job['state']
        if st['demo']:
            self.put_settings(SC.want_settings(st))
            self.b.post('/signals', {'mode': 'demo', 'values': {}})
            return
        self.put_settings(SC.want_settings(st))
        self.feed_common(st)
        self.feed_message(st)

    # ---- what the probe must show ----
    def check(self, job, p):
        st = job['state']
        if not p or not p.get('ready'):
            return ['app not ready']
        bad = []
        cur = p.get('settings') or {}
        for k, v in SC.want_settings(st).items():
            if k in self.schema and cur.get(k) != coerce(self.schema[k], v):
                bad.append('setting %s=%r (want %r)' % (k, cur.get(k), v))
        if st['demo']:
            return bad
        cc = ((p.get('twin') or {}).get('cc') or {})
        want = job['expect'].get('cc')
        if want and cc.get('state') is not None and cc.get('state') != want:
            bad.append('cc.state=%r (want %r)' % (cc.get('state'), want))
        return bad

    @staticmethod
    def summary(p):
        t = (p or {}).get('twin') or {}
        return {'activeName': (p or {}).get('activeName'), 'settings': (p or {}).get('settings'), 'cc': t.get('cc'),
                'missing': t.get('missing'), 'wired': t.get('wired'), 'engine': t.get('engine'), 'status': (p or {}).get('status'),
                'probeError': ((p or {}).get('signs') or {}).get('probeError')}

    def snap(self, job, p, sc):
        d = os.path.join(self.snaps, job['id'].replace('/', '__'))
        os.makedirs(os.path.join(d, 'px'), exist_ok=True)
        sha = {}
        for l in sc['layers']:
            if l['kind'] not in ('image', 'asset') or not l.get('iw'):
                continue
            raw = self.b.px(l['key'], l['iw'], l['ih'])
            if raw is None:
                continue
            open(os.path.join(d, 'px', l['key'].replace(':', '_') + '.z'), 'wb').write(zlib.compress(raw, 1))
            sha[l['key']] = hashlib.sha1(raw).hexdigest()[:12]
        meta = {'job': job['id'], 'port': self.b.port, 'time': time.strftime('%Y-%m-%d %H:%M:%S'), 'pixels': sc.get('pixels'),
                'layers': sc['layers'], 'px_sha1': sha, 'probe': self.summary(p)}
        json.dump(meta, open(os.path.join(d, 'scene.json'), 'w'))
        return d

    def run_job(self, job):
        t0 = time.time()
        st = job['state']
        self.apply(job)
        time.sleep(0.8)
        ok, p = self.b.until(lambda q: not self.check(job, q), 9.0, 0.15)
        cc_wrong = None
        if not ok:
            bad = self.check(job, p) if p else ['no probe answer']
            if p and bad and all(b.startswith('cc.state') for b in bad):
                # the engine says another message state than the scene asks for: that is a finding, not a missing picture
                cc_wrong = bad[0]
            else:
                self.dirty = True
                return {'ok': False, 'reason': bad, 'probe': self.summary(p), 'secs': round(time.time() - t0, 1)}
        volatile = bool(job['expect'].get('volatile'))
        time.sleep(0.9)
        prev, sc, stable = None, None, False
        end = time.time() + 7.0
        while time.time() < end:
            sc = self.b.scene()
            dg = D0.digest(sc) if sc else None
            if dg and dg == prev:
                stable = True
                break
            prev = dg
            if volatile and sc:
                break
            time.sleep(0.35)
        p = self.b.probe()
        bad = self.check(job, p) if p else ['no probe answer']
        if cc_wrong:
            bad = [b for b in bad if not b.startswith('cc.state')]
        if bad:
            self.dirty = True
            return {'ok': False, 'reason': ['left the state while settling'] + bad, 'probe': self.summary(p), 'secs': round(time.time() - t0, 1)}
        d = self.snap(job, p, sc)
        return {'ok': True, 'snap': d, 'stable': stable, 'probe': self.summary(p), 'secs': round(time.time() - t0, 1), 'cc_wrong': cc_wrong}

    def run_group(self, group, on_result):
        try:
            self.restart()
            self.put_settings({'demo': 'off'})
        except Exception as e:
            for j in group:
                on_result(j, {'ok': False, 'reason': ['restart failed: %s' % e], 'probe': None})
            return
        for job in group:
            if self.dirty:
                try:
                    self.restart()
                except Exception as e:
                    on_result(job, {'ok': False, 'reason': ['restart failed: %s' % e], 'probe': None})
                    continue
            try:
                r = self.run_job(job)
            except Exception as e:
                r = {'ok': False, 'reason': ['driver error: %r' % e], 'probe': None}
                self.dirty = True
            self.log(job['id'], 'ok' if r['ok'] else 'FAILED %s' % r['reason'][:3], r.get('secs'))
            on_result(job, r)
