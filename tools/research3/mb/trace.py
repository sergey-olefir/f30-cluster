"""research3 MB: trace everything an app says to cluster-render on the bench, through one scripted session.

    python3 -I tools/research3/mb/trace.py <app> <variant> [--port 8303] [--out <dir>] [--no-snap]
        [--config <file or JSON>] [--name <run name>] [--cap 8]

<app>      f30_cluster | twin_dial
<variant>  a name for the preset (settings written into the bench's fresh data folder before it starts):
             default   the app.json defaults
             g20       f30_cluster with the "G20" see-through toggle on (wb_dials in Comfort)
             nomode    f30_cluster with "Change with the drive mode" off
           or key=value,key=value (bool / number / string settings)
--config   merged over app.json config (BENCH_CONFIG, bench/run-app.js): an experiment of tools/research3/mb/exp/
--name     the run folder's name (default <app>-<variant>)
--cap      the bench's layer cap per connection (BENCH_LAYER_CAP; the car's is 8): a layer past it is 'waiting'

Starts bench/server.js (wrapped by tools/shots/bounded.py, so it ends by itself) with BENCH_TRACE pointing at
<out>/<app>-<variant>/trace.jsonl, then runs the same session for every app, marking each step in the trace:

  start          app start until the first layout is drawn and settled
  drive-comfort  FES drive mode 4 (Comfort)      drive-sport  1 (Sport)
  drive-eco      7 (Eco Pro)                     drive-back   4 (Comfort again)
  night / day    Vehicle.statusDayNightChangeOver NACHT, then TAG
  msg-on         ccList [ready-to-drive id 40, a stored id 987], statusActiveCCMessage 40
  msg-off        statusActiveCCMessage 0, ccList back to its resting entry
  idle           10 s of nothing (the steady state)

and, unless --no-snap, a scene snapshot (tools/strip/O/snap.py) at the end of each step into <out>/.../snap/<step>/,
for tools/research3/mb/geometry.py. Signals are fixed (manual: 1500 rpm, 50 km/h, D) so only the steps change
anything. Standard library only.
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'strip', 'O'))

DRIVE = {'rpm': 1500, 'speed': 50, 'gear': 3, 'oil': 95, 'coolant': 90, 'ambient': 22, 'range': 368, 'fuelL': 40}
PRESETS = {
    'default': {},
    'g20': {'g20': True},
    'nomode': {'byMode': False},
}
STEPS = [
    ('drive-comfort', {'drive': 4}, 6.0),
    ('drive-sport', {'drive': 1}, 6.0),
    ('drive-eco', {'drive': 7}, 6.0),
    ('drive-back', {'drive': 4}, 6.0),
    ('night', {'fake': {'dayNight': 'night'}}, 5.0),
    ('day', {'fake': {'dayNight': 'day'}}, 5.0),
    ('msg-on', {'fake': {'scene': 'active-40'}}, 6.0),
    ('msg-off', {'fake2': [{'scene': 'active-none'}, {'scene': 'cclist-rest'}]}, 6.0),
    ('idle', {}, 10.0),
]


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        return sys.argv[i + 1]
    return default


def preset(v):
    if v in PRESETS:
        return dict(PRESETS[v])
    out = {}
    for kv in v.split(','):
        k, _, x = kv.partition('=')
        out[k] = True if x == 'true' else False if x == 'false' else (float(x) if x.replace('.', '', 1).isdigit() else x)
    return out


def main():
    app, variant = sys.argv[1], sys.argv[2]
    port = int(arg('--port', '8303'))
    os.environ['BENCH_PORT'] = str(port)
    import benchio as B      # noqa: E402  (reads BENCH_PORT at import)
    import snap as SN        # noqa: E402
    base = os.path.abspath(arg('--out', os.path.join(ROOT, 'bake', 'work', 'research3', 'MB', 'trace')))
    run = os.path.join(base, arg('--name', app + '-' + variant))
    data = os.path.join(run, 'data')
    for d in (run, data):
        os.makedirs(d, exist_ok=True)
    tr = os.path.join(run, 'trace.jsonl')
    if os.path.exists(tr):
        os.remove(tr)
    with open(os.path.join(data, 'settings.json'), 'w') as f:
        json.dump(preset(variant), f)
    stop = os.path.join(run, 'STOP')
    if os.path.exists(stop):
        os.remove(stop)
    env = dict(os.environ, BENCH_TRACE=tr, BENCH_DATA_DIR=data, BENCH_PORT=str(port))
    if arg('--config'):
        cf = arg('--config')
        env['BENCH_CONFIG'] = os.path.abspath(cf) if os.path.exists(cf) else cf
    if arg('--cap'):
        env['BENCH_LAYER_CAP'] = arg('--cap')

    def mark(label, **kw):
        with open(tr, 'a') as f:
            f.write(json.dumps(dict({'t': int(time.time() * 1000), 'dir': 'mark', 'label': label}, **kw)) + '\n')

    mark('bench-start')
    p = subprocess.Popen([sys.executable, os.path.join(ROOT, 'tools', 'shots', 'bounded.py'), '420', stop,
                          os.path.join(run, 'bench.log'), '--', 'node', os.path.join(ROOT, 'bench', 'server.js'), app],
                         env=env, cwd=ROOT)
    try:
        # the app is up once /probe answers with an active layout; then let the first frame settle
        q = B.until(lambda q: q.get('activeName'), 120, 0.3)
        if not q:
            raise SystemExit('bench did not come up (see %s)' % os.path.join(run, 'bench.log'))
        mark('app-up', activeName=q.get('activeName'))
        B.signals(DRIVE)
        time.sleep(6.0)
        q = B.probe()
        mark('start-done', activeName=q.get('activeName'), driveMode=q.get('driveMode'))
        if '--no-snap' not in sys.argv:
            SN.snap(os.path.join(run, 'snap', 'start'), 'start', probe=q)
        for name, act, wait in STEPS:
            mark(name)
            if 'drive' in act:
                B.post('/drive', {'value': act['drive']})
            if 'fake' in act:
                B.fake(act['fake'])
            for v in act.get('fake2', []):
                B.fake(v)
            time.sleep(wait)
            q = B.probe()
            mark(name + '-done', activeName=q.get('activeName'), driveMode=q.get('driveMode'))
            if '--no-snap' not in sys.argv and name != 'idle':
                SN.snap(os.path.join(run, 'snap', name), name, probe=q)
        mark('end')
    finally:
        open(stop, 'w').write('done\n')
        p.wait(timeout=30)
    print('trace:', tr)


if __name__ == '__main__':
    main()
