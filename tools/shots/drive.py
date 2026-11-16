"""tools/shots: drive one bench through groups of jobs (matrix.py) and save a snapshot of each confirmed state.

A snapshot is the scene exactly as the bench streams it (every layer, shader, uniform, binding; GET /events) plus
every image layer's and asset's current pixels (GET /px, zlib-compressed), the format of tools/strip/O/snap.py with
the pixels compressed. It is handed to the render pool (paint.py) and deleted there once drawn.

Rules (docs/AGENT-BRIEF-shots.md section 3): POST /restart at the start of every group and after every state that
latched the row (_rowFail is sticky), and before every "fresh" state; never snapshot before GET /probe confirms the
asked state: on a timeout the job is recorded as failed with the probe's last answer.
Standard library only (runs as threads of run.py).
"""
import hashlib
import json
import os
import time
import zlib

import matrix as MX

ORDER = ['hudLayout', 'g20', 'bottomRow', 'byMode']


def want_settings(job):
    s = MX.context_settings(job['context'])
    s.update(job['state']['settings'])
    return s


def signals_of(st):
    v = dict(MX.MOTIONS[st['motion']])
    v.update(st['sig'])
    return v


def probe_summary(p):
    s = p.get('signs') or {}
    row = s.get('row') or {}
    saf = s.get('safety') or {}
    cc = s.get('cc') or {}
    return {
        'activeName': p.get('activeName'), 'driveMode': p.get('driveMode'), 'status': p.get('status'),
        'own': s.get('own'), 'fail': s.get('fail'), 'failWhy': row.get('failWhy'), 'rowWhy': row.get('why'),
        'standby': row.get('standby'), 'signWin': row.get('signWin'), 'sign': s.get('sign'),
        'cc': {'shown': cc.get('shown'), 'parsed': cc.get('parsed'), 'list': cc.get('list'), 'frame': cc.get('frame')},
        'ccOnScreen': saf.get('onScreen'), 'ccOpen': saf.get('open'), 'ccUnread': saf.get('unread'), 'ccStyle': saf.get('style'),
        'ccFit': saf.get('fit'), 'audit': saf.get('audit'), 'mask': saf.get('mask'),
        'road': s.get('road'), 'navState': s.get('navState'), 'tzCar': s.get('tzCar'), 'arc': s.get('arc'),
        'widgets': s.get('widgets'), 'patches': s.get('patches'),
    }


def check(job, p):
    """-> list of what the probe does not (yet) show of the asked state; [] = confirmed."""
    st = job['state']
    ctx = job['context']
    bad = []
    if not p or not p.get('ready'):
        return ['app not ready']
    cur = p.get('settings') or {}
    for k, v in want_settings(job).items():
        if cur.get(k) != v:
            bad.append('setting %s=%r (want %r)' % (k, cur.get(k), v))
    if cur.get('demo') != 'off':
        bad.append('demo=%r' % cur.get('demo'))
    if p.get('activeName') != MX.active_for(ctx, st):
        bad.append('activeName=%r' % p.get('activeName'))
    if ctx == 'diag':
        return bad
    if p.get('driveMode') != st['mode']:
        bad.append('driveMode=%r' % p.get('driveMode'))
    s = p.get('signs') or {}
    sign = s.get('sign') or {}
    for k, v in MX.SIGN_WANT[st['limit']].items():
        if sign.get(k) != v:
            bad.append('sign.%s=%r (want %r)' % (k, sign.get(k), v))
    cc = s.get('cc') or {}
    msg = st['msg']
    shown = cc.get('shown')
    if msg == 'cc-never':
        if shown is not None:
            bad.append('cc.shown=%r (want never read)' % shown)
    elif msg == 'cc-clear':
        if shown is not False:
            bad.append('cc.shown=%r (want false)' % shown)
    else:
        if shown is not True:
            bad.append('cc.shown=%r (want true)' % shown)
        col = MX.CC_COLOR.get(msg)
        if col and (cc.get('parsed') or {}).get('color') != col and msg not in ('cc-three', 'cc-frame-2'):
            bad.append('cc.color=%r (want %r)' % ((cc.get('parsed') or {}).get('color'), col))
        if msg in ('cc-three', 'cc-frame-2') and cc.get('list') != 3:
            bad.append('cc.list=%r (want 3)' % cc.get('list'))
        if msg == 'cc-frame-2' and (cc.get('frame') or {}).get('n') != 2:
            bad.append('cc.frame=%r (want 2)' % (cc.get('frame') or {}).get('n'))
        if msg == 'cc-held' and (s.get('safety') or {}).get('onScreen'):
            bad.append('ours on screen (want held back)')
        # the latching states latch where the row is ours and drawn (a zone known, not standby)
        if (msg in MX.LATCHING and ctx in MX.ROW_OURS and st['clock'] == 'clock-plus2' and st['motion'] != 'standby'
                and not (s.get('fail') or {}).get('info')):
            bad.append('not latched yet (fail=%r)' % s.get('fail'))
    text, nav = MX.ROAD_WANT[st['road']]
    if s.get('navState') != nav:
        bad.append('navState=%r (want %r)' % (s.get('navState'), nav))
    # hud.js _roadText: '' while a message shows or while the road label is not ours (BMW draws its own)
    nav_ours = (s.get('own') or {}).get('nav')
    if s.get('road') != text and not ((shown is True or nav_ours is False) and s.get('road') == ''):
        bad.append('road=%r' % s.get('road'))
    tz = s.get('tzCar')
    if st['clock'] == 'clock-plus2' and tz != 120:
        bad.append('tzCar=%r (want 120)' % tz)
    if st['clock'] == 'clock-none' and tz is not None:
        bad.append('tzCar=%r (want none)' % tz)
    if ctx in MX.SEE_THROUGH:
        sb = (s.get('row') or {}).get('standby')
        if bool(sb) != (st['motion'] == 'standby'):
            bad.append('row.standby=%r' % sb)
    return bad


def digest(sc):
    out = []
    for l in sc.get('layers') or []:
        u = {k: v for k, v in (l.get('uniforms') or {}).items() if k != 'u_time'}
        out.append([l['key'], l.get('visible'), l.get('state'), l.get('x'), l.get('y'), l.get('w'), l.get('h'), l.get('z'),
                    l.get('opacity'), l.get('iw'), l.get('ih'), u, l.get('binds'), len(l.get('fs') or '')])
    return hashlib.sha1(json.dumps([sc.get('pixels'), out], sort_keys=True).encode()).hexdigest()


class Driver:
    def __init__(self, name, bench, snaps, log):
        self.name = name
        self.b = bench
        self.snaps = snaps
        self.logf = log
        self.since_restart = 0
        self.dirty = False
        self.ctx = None

    def log(self, *a):
        line = time.strftime('%H:%M:%S') + ' [' + self.name + '] ' + ' '.join(str(x) for x in a)
        with open(self.logf, 'a') as f:
            f.write(line + '\n')

    # ---- the bench ----
    def restart(self, ctx):
        self.b.restart()
        ok, p = self.b.until(lambda q: q.get('ready') and q.get('activeName'), 90, 0.15)
        if not ok:
            raise RuntimeError('bench did not come back after a restart')
        self.since_restart = 0
        self.dirty = False
        self.ctx = ctx
        # the context's settings, the layout ones first
        want = MX.context_settings(ctx)
        for k in ORDER + [k for k in want if k not in ORDER]:
            p = self.b.probe() or p
            if self.b.set(k, want[k], p['settings']):
                self.b.until(lambda q: q['settings'].get(k) == want[k], 20, 0.1)
        return p

    def apply(self, job):
        st = job['state']
        p = self.b.probe()
        want = want_settings(job)
        for k in ORDER + [k for k in want if k not in ORDER]:
            p = self.b.probe() or p
            if self.b.set(k, want[k], p['settings']):
                self.b.until(lambda q: q['settings'].get(k) == want[k], 20, 0.1)
        if job['context'] == 'diag':
            self.b.signals(MX.MOTIONS['d50'])
            return
        self.b.drive(MX.MODES[st['mode']])
        self.b.signals(signals_of(st))
        self.b.fake({'scene': st['clock']})
        if st['limit'] in MX.SIGN_PARTS:
            self.b.fake(MX.SIGN_PARTS[st['limit']])
        else:
            self.b.fake({'scene': st['limit']})
        self.b.fake({'scene': 'road-none'})      # a road scene sets only its own fields (onRoad, nav)
        if st['road'] != 'road-none':
            self.b.fake({'scene': st['road']})
        msg = st['msg']
        if msg != 'cc-never':
            self.b.fake({'scene': 'cc-clear'})   # clears the list and the frame a previous cc-three left
            if msg != 'cc-clear':
                if msg in MX.CC_HOOK:
                    time.sleep(0.3)
                    self.b.fake({'hook': MX.CC_HOOK[msg]})
                time.sleep(0.25)
                self.b.fake({'scene': MX.CC_SCENE.get(msg, msg)})

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
        meta = {'job': job['id'], 'port': self.b.port, 'time': time.strftime('%Y-%m-%d %H:%M:%S'),
                'pixels': sc.get('pixels'), 'layers': sc['layers'], 'px_sha1': sha, 'probe': probe_summary(p)}
        json.dump(meta, open(os.path.join(d, 'scene.json'), 'w'))
        return d

    def run_job(self, job):
        t0 = time.time()
        st = job['state']
        if job['fresh'] and self.since_restart > 0:
            self.restart(job['context'])
        self.since_restart += 1
        self.apply(job)
        hold = MX.HOLD.get(st['motion'], 0.0)
        time.sleep(max(0.6, hold))
        ok, p = self.b.until(lambda q: not check(job, q), 15.0, 0.15)
        if not ok:
            why = check(job, p) if p else ['no probe answer']
            self.dirty = True       # whatever it is in, do not build on it
            return {'ok': False, 'reason': why, 'probe': probe_summary(p) if p else None, 'secs': round(time.time() - t0, 1)}
        # settle: the needles and texts follow the values over a few frames; two equal scenes in a row
        time.sleep(0.8)
        prev, sc, stable = None, None, False
        end = time.time() + 6.0
        while time.time() < end:
            sc = self.b.scene()
            dg = digest(sc) if sc else None
            if dg and dg == prev:
                stable = True
                break
            prev = dg
            time.sleep(0.35)
        p = self.b.probe()
        bad = check(job, p) if p else ['no probe answer']
        if bad:
            self.dirty = True
            return {'ok': False, 'reason': ['left the state while settling'] + bad, 'probe': probe_summary(p) if p else None,
                    'secs': round(time.time() - t0, 1)}
        d = self.snap(job, p, sc)
        if st['msg'] == 'cc-held':
            self.b.fake({'hook': 'ccRelease'})
        if (p.get('signs') or {}).get('fail') or job['latching']:
            self.dirty = True
        return {'ok': True, 'snap': d, 'stable': stable, 'probe': probe_summary(p), 'secs': round(time.time() - t0, 1)}

    def run_group(self, group, on_result):
        ctx = group[0]['context']
        try:
            self.restart(ctx)
        except Exception as e:
            for j in group:
                on_result(j, {'ok': False, 'reason': ['restart failed: %s' % e], 'probe': None})
            return
        for job in group:
            if self.dirty:
                try:
                    self.restart(ctx)
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
