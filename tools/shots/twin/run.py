"""tools/shots/twin: the twin_dial state gallery (docs/twin-dial/SPEC.md section 16; package E of round 2).

    UV_CACHE_DIR=$F30/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl \\
        python -I tools/shots/twin/run.py [--standin | --real] [--only A,B,C,D|<text>] [--out <folder>] [--benches 3]
        [--render 3] [--config '<json>' | <file>] [--keep]

No browser. N benches (bench/server.js twin_dial) on ports 8205 and up, each from its own copy of bench/ (root.py), its
own BENCH_DATA_DIR and a wall clock pinned to 14:43 on 2026-11-17 (BENCH_NOW, bench/run-app.js), each wrapped by
tools/shots/bounded.py so it ends by itself. A driver thread per bench takes groups of jobs (scenes.py), restarts its
bench at the start of each, drives the state, waits for GET /probe to confirm it and snapshots it (tdrive.py); a pool
of render processes (tpaint.py, moderngl) turns snapshots into pictures and numbers. Which app: the checkout's
apps/twin_dial when it exists (--real, the default then), else the bench stand-in (--standin). The stand-in draws flat
blocks, so its comparison numbers mean nothing: the run says which app it used, in every file.

Output, in bake/work/twin-dial/r2/E/gallery/<YYYYMMDD-HHMM>/ (git-ignored):
  index.html (works from file://), results.json, summary.json, compare.md, failed.json, logs/, A/ B/ C/ D/ (the pictures)
--only: set letters (A matrix, B mockup scenes, C dial laws, D settings) or a text found in a job's name
(e.g. day_ours, night, law_speed). With --out pointing at an earlier run, the redone jobs replace theirs.
"""
import json
import multiprocessing as mp
import os
import shutil
import socket
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, '..')
for p in (HERE, SHOTS):
    if p not in sys.path:
        sys.path.insert(0, p)
import benchc            # noqa: E402  (tools/shots/benchc.py)
import root as RT        # noqa: E402
import scenes as SC      # noqa: E402
import tdrive as TD      # noqa: E402
import gallery as GL     # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PORT0 = 8205
MIN_FREE = 700 << 20


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def port_open(p):
    try:
        socket.create_connection(('127.0.0.1', p), timeout=0.5).close()
        return True
    except OSError:
        return False


def select(groups, only):
    if not only:
        return groups
    toks = [t for t in only.split(',') if t]
    sets = [t for t in toks if t in ('A', 'B', 'C', 'D')]
    texts = [t for t in toks if t not in sets]

    def ok(j):
        return (not sets or j['set'] in sets) and (not texts or any(t in j['name'] for t in texts))
    return [g2 for g2 in ([j for j in g if ok(j)] for g in groups) if g2]


def start_bench(work, logs, i, port, mode, config):
    r, which = RT.make_root(os.path.join(work, 'b%d' % i), mode)
    data = os.path.join(work, 'b%d' % i, 'data')
    shutil.rmtree(data, ignore_errors=True)
    os.makedirs(data)
    stop = os.path.join(work, 'b%d' % i, 'STOP')
    if os.path.exists(stop):
        os.remove(stop)
    log = os.path.join(logs, 'bench-%d.log' % port)
    env = dict(os.environ, BENCH_PORT=str(port), BENCH_DATA_DIR=data, BENCH_NOW=SC.BENCH_NOW)
    if config:
        env['BENCH_CONFIG'] = config
    if RT.scene_dir():
        env['TWIN_SCENE_DIR'] = RT.scene_dir()      # the stand-in reads A2's baked faces and mask from there
    p = subprocess.Popen([sys.executable, '-I', os.path.join(SHOTS, 'bounded.py'), '3000', stop, log, '--', 'node',
                          os.path.join(r, 'bench', 'server.js'), 'twin_dial'], cwd=r, env=env,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    app = json.load(open(os.path.join(r, 'apps', 'twin_dial', 'app.json')))
    b = benchc.Bench(port, app)
    ok, q = b.until(lambda q: q.get('ready') and q.get('activeName'), 120, 0.3)
    if not ok:
        raise RuntimeError('bench on %d did not come up (see %s)' % (port, log))
    return {'proc': p, 'stop': stop, 'log': log, 'bench': b, 'port': port, 'app': app, 'which': which}


def stop_benches(benches):
    for b in benches:
        open(b['stop'], 'w').write('done\n')
    for b in benches:
        try:
            b['proc'].wait(timeout=40)
        except subprocess.TimeoutExpired:
            b['proc'].terminate()
            b['proc'].wait(timeout=20)


def _paint_worker(inq, outq, out):
    import tpaint
    tpaint.worker(inq, outq, out)


def main():
    t_start = time.time()
    mode = 'standin' if '--standin' in sys.argv else 'real' if '--real' in sys.argv else None
    out = os.path.abspath(arg('--out') or os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'r2', 'E', 'gallery', time.strftime('%Y%m%d-%H%M')))
    nb, nr = int(arg('--benches', '3')), int(arg('--render', '3'))
    config = arg('--config')
    which = mode or ('real' if RT.has_real() else 'standin')
    groups = select(SC.plan(), arg('--only'))
    planned = [j for g in groups for j in g]
    os.makedirs(out, exist_ok=True)
    work, logs = os.path.join(out, '.run'), os.path.join(out, 'logs')
    snaps = os.path.join(work, 'snaps')
    for d in (work, logs, snaps):
        os.makedirs(d, exist_ok=True)
    print('%d jobs in %d groups -> %s  (app: %s)' % (len(planned), len(groups), out, which), flush=True)
    busy = [p for p in range(PORT0, PORT0 + nb) if port_open(p)]
    if busy:
        raise SystemExit('ports already listening, not touching them: %s' % busy)

    benches, results, rendered = [], {}, {}
    lock = threading.Lock()
    ctx = mp.get_context('spawn')
    inq, outq = ctx.Queue(), ctx.Queue()
    workers = [ctx.Process(target=_paint_worker, args=(inq, outq, out), daemon=True) for _ in range(nr)]
    for w in workers:
        w.start()

    def collect():
        done = 0
        while done < nr:
            r = outq.get()
            if r.get('worker_done'):
                done += 1
                continue
            with lock:
                rendered[r['id']] = r
    col = threading.Thread(target=collect, daemon=True)
    col.start()
    queue = list(groups)

    def take():
        with lock:
            return queue.pop(0) if queue else None

    def on_result(job, r):
        with lock:
            results[job['id']] = r
        if r['ok']:
            inq.put({'snap': r['snap'], 'id': job['id'], 'name': job['name'], 'set': job['set'], 'rel': job['rel'],
                     'state': job['state'], 'expect': job['expect'], 'keep': '--keep' in sys.argv})

    def run_driver(i, bench):
        dv = TD.Driver('bench %d' % bench['port'], bench['bench'], snaps, os.path.join(logs, 'drive.log'), bench['app']['settings'])
        while True:
            if shutil.disk_usage(out).free < MIN_FREE:
                print('disk nearly full: bench %d takes no more groups' % bench['port'], flush=True)
                return
            g = take()
            if g is None:
                return
            dv.run_group(g, on_result)
            with lock:
                n = len(results)
            print('%s  %d / %d jobs' % (time.strftime('%H:%M:%S'), n, len(planned)), flush=True)

    try:
        for i in range(nb):
            benches.append(start_bench(work, logs, i + 1, PORT0 + i, mode, config))
            print('bench %d up (%s)' % (PORT0 + i, benches[-1]['which']), flush=True)
        threads = [threading.Thread(target=run_driver, args=(i, b)) for i, b in enumerate(benches)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    finally:
        stop_benches(benches)
        for _ in workers:
            inq.put(None)
    col.join()
    for w in workers:
        w.join(timeout=30)
    still = [p for p in range(PORT0, PORT0 + nb) if port_open(p)]
    GL.assemble(out, planned, results, rendered, logs, still, time.time() - t_start, which, config)
    if '--keep' not in sys.argv:        # --keep: the snapshots (and the float images of ours, ours.npz) stay in <out>/.run/snaps
        shutil.rmtree(snaps, ignore_errors=True)
    for i in range(1, nb + 1):
        shutil.rmtree(os.path.join(work, 'b%d' % i), ignore_errors=True)
    if not os.listdir(work):
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()
