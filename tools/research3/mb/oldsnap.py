"""research3 MB: snapshot the layouts of an OLDER f30_cluster (a checkout of an earlier commit) on its own bench, for
tools/research3/mb/geometry.py - what the version on the car in the photos drew under BMW's gear letter.

    python3 -I tools/research3/mb/oldsnap.py <checkout> <out dir> <layout> [<layout> ...] [--port 8303]

Starts <checkout>/bench/server.js f30_cluster (wrapped by tools/shots/bounded.py). An older bench has no BENCH_DATA_DIR
and no GET /probe, so the settings that pick each layout ("Change with the drive mode" off) are written to the checkout's
own bench/.data/f30_cluster/settings.json, and the build is awaited in the bench log (the first 'layout "<name>"' line).
Manual signals in P; <out>/snap/<layout>/ is saved with tools/strip/O/snap.py. Standard library only.
"""
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'strip', 'O'))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    port = sys.argv[sys.argv.index('--port') + 1] if '--port' in sys.argv else '8303'
    if '--port' in sys.argv:
        args.remove(port)
    co, out, layouts = os.path.abspath(args[0]), os.path.abspath(args[1]), args[2:]
    os.environ['BENCH_PORT'] = port
    import benchio as B   # noqa: E402
    import snap as SN     # noqa: E402
    for lay in layouts:
        data = os.path.join(co, 'bench', '.data', 'f30_cluster')
        os.makedirs(data, exist_ok=True)
        os.makedirs(out, exist_ok=True)
        json.dump({'hudLayout': lay, 'byMode': False}, open(os.path.join(data, 'settings.json'), 'w'))
        stop = os.path.join(out, 'STOP-' + lay)
        if os.path.exists(stop):
            os.remove(stop)
        env = dict(os.environ, BENCH_DATA_DIR=data, BENCH_PORT=port)
        p = subprocess.Popen([sys.executable, os.path.join(ROOT, 'tools', 'shots', 'bounded.py'), '240', stop,
                              os.path.join(out, 'bench-' + lay + '.log'), '--', 'node', os.path.join(co, 'bench', 'server.js'), 'f30_cluster'],
                             env=env, cwd=co)
        try:
            logf = os.path.join(out, 'bench-' + lay + '.log')
            pat = re.compile(r'layout "%s"' % re.escape(lay))
            end = time.time() + 120
            while time.time() < end and not (os.path.exists(logf) and pat.search(open(logf, errors='replace').read())):
                time.sleep(0.5)
            if time.time() >= end:
                print('%s: not reached' % lay)
                continue
            B.signals({'rpm': 800, 'speed': 0, 'gear': 0, 'oil': 95, 'coolant': 90, 'ambient': 22, 'range': 368, 'fuelL': 40})
            time.sleep(5)
            SN.snap(os.path.join(out, 'snap', lay), lay, probe={'activeName': lay})
            print('%s: saved' % lay)
        finally:
            open(stop, 'w').write('done\n')
            p.wait(timeout=30)


if __name__ == '__main__':
    main()
