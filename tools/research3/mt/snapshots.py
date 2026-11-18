"""research3 MT: freeze the f30_cluster scene in the states the texture experiments are measured against.

    python3 -I tools/research3/mt/snapshots.py [--out <dir>] [--port 8302] [--env KEY=VALUE ...] [--only <job ids>]

One bench (bench/server.js f30_cluster, port 8302 by default: package MT's), started from its own copy of bench/
(tools/shots/run.py make_root) and wrapped by tools/shots/bounded.py so it always ends by itself (20 min at most).
Each job is a tools/shots matrix state (the same contexts and drivers as the shots gallery); its snapshot (scene.json
+ px/*.z, the tools/shots/drive.py format) goes to <out>/<job>/. --env passes settings of the experiment (e.g.
F30_TEX=...) to the bench's app process, so the same states can be frozen for a variant.
The bench log (asset lines, pixel memory) is kept in <out>/bench.log. Standard library only.
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'shots'))
import benchc   # noqa: E402
import drive    # noqa: E402
import matrix as MX   # noqa: E402
import run as RUN   # noqa: E402

# (job id, context, state overrides): the baseline of each theme the car can show, and the states that change which
# textures are sampled (the window off under BMW's map, the glass foot line, the night colours, the no-overtaking sign)
JOBS = [
    ('comfort', 'comfort', {}),
    ('comfort-night', 'comfort', {'settings': {'nightDim': 'always', 'nightLook': 'plain'}}),
    ('comfort-map', 'comfort', {'settings': {'stockMap': True}}),
    ('comfort-glass', 'comfort', {'settings': {'wbFoot': 'glass'}}),
    ('comfort-nopass', 'comfort', {'limit': 'limit-130-nopass'}),
    ('g20', 'comfort-g20-ours', {}),
    ('g20-bmw', 'comfort-g20-bmw', {}),
    ('sport', 'sport', {}),
    ('eco', 'eco', {}),
]


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main():
    out = os.path.abspath(arg('--out') or os.path.join(ROOT, 'bake', 'work', 'research3', 'MT', 'snaps', 'base'))
    port = int(arg('--port', '8302'))
    only = set((arg('--only') or '').split(',')) - {''}
    env = [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == '--env']
    os.makedirs(out, exist_ok=True)
    if RUN.port_open(port):
        raise SystemExit('port %d already listening, not touching it' % port)
    for kv in env:
        k, v = kv.split('=', 1)
        os.environ[k] = v
    app = json.load(open(os.path.join(ROOT, 'apps', 'f30_cluster', 'app.json')))
    work = os.path.join(out, '.bench')
    os.makedirs(work, exist_ok=True)
    # 20 minutes at most (bounded.py), not the gallery's hour
    orig = RUN.subprocess.Popen

    def popen(cmd, *a, **k):
        if cmd and 'bounded.py' in ' '.join(cmd[:3]):
            cmd = list(cmd)
            cmd[3] = '1200'
        return orig(cmd, *a, **k)
    RUN.subprocess.Popen = popen
    b = RUN.start_bench(work, out, 0, port, app)
    RUN.subprocess.Popen = orig
    results = {}
    try:
        d = drive.Driver('mt', b['bench'], out, os.path.join(out, 'drive.log'))
        for jid, ctx, ov in JOBS:
            if only and jid not in only:
                continue
            st = MX.state(**ov)
            job = MX.job('MT', ctx, jid, st)
            job['id'] = jid
            d.restart(ctx)
            r = d.run_job(job)
            results[jid] = {k: v for k, v in r.items() if k != 'probe'}
            results[jid]['activeName'] = (r.get('probe') or {}).get('activeName')
            print(jid, 'ok' if r['ok'] else 'FAILED %s' % r.get('reason'), r.get('secs'), flush=True)
    finally:
        RUN.stop_benches([b])
    json.dump(results, open(os.path.join(out, 'results.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
