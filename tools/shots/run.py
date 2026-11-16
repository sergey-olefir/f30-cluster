"""tools/shots: a gallery of every state the f30_cluster theme can be in (docs/AGENT-BRIEF-shots.md).

    UV_CACHE_DIR=$F30/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl \\
        python -I tools/shots/run.py [--only A,B,C,D|<context>|<axis>[,...]] [--out <folder>] [--benches 6] [--render 4]

No browser. Six benches (bench/server.js) on ports 8181-8186, each from its own copy of bench/ (apps/, shared/,
kit/ linked) so their builds into dist/ never race, each with its own BENCH_DATA_DIR, each wrapped by bounded.py so
it ends by itself (an hour at most, or when this run is done). A driver thread per bench takes groups of jobs
(matrix.py), restarts its bench at the start of each, drives the state, waits for GET /probe to confirm it and
saves a snapshot (drive.py); a pool of render processes (paint.py, moderngl) turns snapshots into pictures as they
come. Neither stage waits for the other.

Output, in bake/work/shots/<YYYYMMDD-HHMM>/ (git-ignored: the backdrops are photo pixels, never committed):
  index.html      contact sheet (works from file://), manifest.json, failed.json, summary.json, logs/
  A-sweeps/<context>/<axis>/<value>.png (+ .matte.png), B-pairs/<context>/<limit>__<message>__<road>__<motion>__<clock>.png,
  C-scenarios/<context>/<nn>-<name>.png, D-diagnostics/<name>.png, thumbs/ (480 x 180 JPEG of each picture)
--only: tokens of three kinds, a set letter (A B C D), a context (comfort, comfort-g20-bmw, comfort-g20-ours, sport,
eco, diag) or an A axis (limit, message, night, ...); a job runs when it matches every kind given. With --out
pointing at an earlier run's folder, the redone jobs replace theirs and the rest is kept.
"""
import json
import multiprocessing as mp
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import benchc   # noqa: E402
import drive    # noqa: E402
import matrix as MX   # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PORTS = [8181, 8182, 8183, 8184, 8185, 8186]
# which contexts each bench prefers (the two see-through ones are the largest: two benches each)
AFFINITY = [['comfort-g20-ours'], ['comfort-g20-ours'], ['comfort-g20-bmw'], ['comfort-g20-bmw'], ['comfort', 'diag'], ['sport', 'eco']]
BAD_LOG = re.compile(r'too many|pixel memory is full|over the layer cap|uncaught|app exited|build failed|refus|ERROR', re.I)
BENIGN_LOG = re.compile(r'emulator: no SOME/IP')
MIN_FREE = 700 << 20      # bytes of free disk below which no new group starts (the pictures are ~1 MB each)
KEEP_SNAPS = {'A/comfort-g20-ours/baseline/baseline', 'A/comfort-g20-ours/message/cc-never'}


def arg(name, default=None):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


def port_open(p):
    try:
        s = socket.create_connection(('127.0.0.1', p), timeout=0.5)
        s.close()
        return True
    except OSError:
        return False


def select(groups, only):
    if not only:
        return groups
    toks = [t for t in only.split(',') if t]
    sets = [t for t in toks if t in ('A', 'B', 'C', 'D')]
    ctxs = [t for t in toks if t in MX.CONTEXTS or t == 'diag']
    axes = [t for t in toks if t not in sets and t not in ctxs]

    def ok(j):
        return ((not sets or j['set'] in sets) and (not ctxs or j['context'] in ctxs) and (not axes or j['axis'] in axes))
    out = []
    for g in groups:
        g2 = [j for j in g if ok(j)]
        if g2:
            out.append(g2)
    return out


# ---------------------------------------------------------------- benches
def make_root(work, i):
    """A bench's own tree: a real bench/ (node resolves server.js's __dirname to it, so ROOT and dist/ are its own)
    with apps/, shared/ and kit/ linked from the checkout."""
    r = os.path.join(work, 'b%d' % i, 'root')
    if os.path.exists(r):
        shutil.rmtree(r)
    os.makedirs(r)
    shutil.copytree(os.path.join(ROOT, 'bench'), os.path.join(r, 'bench'), ignore=shutil.ignore_patterns('.data'))
    for d in ('apps', 'shared', 'kit'):
        os.symlink(os.path.join(ROOT, d), os.path.join(r, d))
    sdk = os.path.join(r, 'oap-sdk')
    os.makedirs(sdk)
    open(os.path.join(sdk, 'index.js'), 'w').write("'use strict';\n// BENCH_STUB: stands in for BMW's oap-sdk so kit/tools/build.py runs on the Mac. Never ship this.\nthrow new Error('BENCH_STUB oap-sdk');\n")
    open(os.path.join(sdk, 'package.json'), 'w').write(json.dumps({'name': 'oap-sdk', 'version': '0.0.0-bench-stub', 'main': 'index.js'}) + '\n')
    data = os.path.join(work, 'b%d' % i, 'data')
    if os.path.exists(data):
        shutil.rmtree(data)
    os.makedirs(data)
    return r, data


def start_bench(work, logs, i, port, app):
    r, data = make_root(work, i)
    stop = os.path.join(work, 'b%d' % i, 'STOP')
    if os.path.exists(stop):
        os.remove(stop)
    log = os.path.join(logs, 'bench-%d.log' % port)
    env = dict(os.environ, BENCH_PORT=str(port), BENCH_DATA_DIR=data)
    p = subprocess.Popen([sys.executable, '-I', os.path.join(HERE, 'bounded.py'), '3600', stop, log, '--',
                          'node', os.path.join(r, 'bench', 'server.js'), 'f30_cluster'], cwd=r, env=env,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    b = benchc.Bench(port, app)
    ok, q = b.until(lambda q: q.get('ready') and q.get('activeName'), 120, 0.3)
    if not ok:
        raise RuntimeError('bench on %d did not come up (see %s)' % (port, log))
    return {'proc': p, 'stop': stop, 'log': log, 'bench': b, 'port': port}


def stop_benches(benches):
    for b in benches:
        open(b['stop'], 'w').write('done\n')
    for b in benches:
        try:
            b['proc'].wait(timeout=40)
        except subprocess.TimeoutExpired:
            b['proc'].terminate()     # our own wrapper process; it ends its bench on SIGTERM
            b['proc'].wait(timeout=20)


# ---------------------------------------------------------------- captions
def row_caption(ctx, pr):
    if ctx not in MX.SEE_THROUGH:
        return 'row: ours (opaque theme)'
    why = (pr or {}).get('rowWhy')
    if why is None:
        return 'row: ours'
    if why.startswith('the switch'):
        return "row: BMW's — the switch (allG20)"
    if why.startswith('latched'):
        fw = ' '.join(((pr or {}).get('failWhy') or {}).values())
        if 'glyph' in fw:
            return "row: BMW's — missing glyph"
        if 'threw' in fw:
            return "row: BMW's — drawing threw"
        if 'cannot read' in fw or 'no root' in fw:
            return "row: BMW's — unreadable message"
        return "row: BMW's — latched"
    if why.startswith('standby'):
        return "row: BMW's — standby"
    if 'time zone' in why:
        return "row: BMW's — waiting for a time zone"
    if 'check-control' in why:
        return "row: BMW's — no message read yet"
    return "row: BMW's — " + why


def fed_caption(job):
    st = job['state']
    if job['context'] == 'diag':
        return 'layout ' + st['settings'].get('hudLayout')
    sig = drive.signals_of(st)
    mot = st['motion']
    bits = ['%s %d km/h %d rpm' % ('P' if sig['gear'] == 0 else st['sig'].get('program', 'D'), sig['speed'], sig['rpm']) if mot != 'standby' else 'standby']
    if mot in ('p-engine-off',):
        bits[0] = 'P engine off'
    bits += [st['limit'], st['msg'], st['road'], st['clock']]
    if st['mode'] != 'comfort':
        bits.append('mode ' + st['mode'])
    for k, v in st['sig'].items():
        if k not in ('program',) and MX.MOTIONS[mot].get(k) != v and k not in ('speed', 'rpm', 'gear'):
            bits.append('%s %s' % (k, v))
    for k, v in st['settings'].items():
        bits.append('%s=%s' % (k, v))
    return ' · '.join(str(b) for b in bits)


# ---------------------------------------------------------------- the run
def main():
    t_start = time.time()
    app = json.load(open(os.path.join(ROOT, 'apps', 'f30_cluster', 'app.json')))
    out = os.path.abspath(arg('--out') or os.path.join(ROOT, 'bake', 'work', 'shots', time.strftime('%Y%m%d-%H%M')))
    nb = int(arg('--benches', '6'))
    nr = int(arg('--render', '4'))
    only = arg('--only')
    groups_all = MX.plan()
    order = {j['id']: n for n, j in enumerate(j for g in groups_all for j in g)}
    jobs_all = {j['id']: j for g in groups_all for j in g}
    groups = select(groups_all, only)
    planned = [j for g in groups for j in g]
    os.makedirs(out, exist_ok=True)
    work = os.path.join(out, '.run')
    logs = os.path.join(out, 'logs')
    pool = os.path.join(work, 'pool')
    snaps = os.path.join(work, 'snaps')
    for d in (work, logs, pool, snaps):
        os.makedirs(d, exist_ok=True)
    print('%d jobs in %d groups -> %s' % (len(planned), len(groups), out), flush=True)
    busy = [p for p in PORTS[:nb] if port_open(p)]
    if busy:
        raise SystemExit('ports already listening, not touching them: %s' % busy)

    benches, results, rendered = [], {}, {}
    lock = threading.Lock()
    ctx = mp.get_context('spawn')
    inq, outq = ctx.Queue(), ctx.Queue()
    import paint   # noqa: F401  (the workers import it themselves)
    workers = [ctx.Process(target=_paint_worker, args=(inq, outq, pool, KEEP_SNAPS), daemon=True) for _ in range(nr)]
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

    def take(pref):
        with lock:
            if not queue:
                return None
            for i, g in enumerate(queue):
                if g[0]['context'] in pref:
                    return queue.pop(i)
            # nothing of ours left: the largest group of whatever context is left
            i = max(range(len(queue)), key=lambda k: len(queue[k]))
            return queue.pop(i)

    def on_result(job, r):
        with lock:
            results[job['id']] = r
        if r['ok']:
            pid, _ = MX.backdrop(job['state'], job['context'])
            inq.put({'snap': r['snap'], 'id': job['id'], 'context': job['context'], 'backdrop': pid})

    def run_driver(i, bench):
        dv = drive.Driver('bench %d' % bench['port'], bench['bench'], snaps, os.path.join(logs, 'drive.log'))
        while True:
            free = shutil.disk_usage(out).free
            if free < MIN_FREE:
                print('%s  disk nearly full (%d MiB free): bench %d takes no more groups' % (time.strftime('%H:%M:%S'), free >> 20, bench['port']), flush=True)
                return
            g = take(AFFINITY[i % len(AFFINITY)])
            if g is None:
                return
            dv.run_group(g, on_result)
            with lock:
                n = len(results)
            print('%s  %d / %d jobs' % (time.strftime('%H:%M:%S'), n, len(planned)), flush=True)

    t_drive = time.time()
    try:
        for i, port in enumerate(PORTS[:nb]):
            benches.append(start_bench(work, logs, i + 1, port, app))     # one after another
            print('bench %d up' % port, flush=True)
        threads = [threading.Thread(target=run_driver, args=(i, b)) for i, b in enumerate(benches)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    finally:
        stop_benches(benches)
        for _ in workers:
            inq.put(None)
    t_drive = time.time() - t_drive
    col.join()
    for w in workers:
        w.join(timeout=30)
    still = [p for p in PORTS[:nb] if port_open(p)]
    assemble(out, pool, planned, jobs_all, order, results, rendered, logs, still, time.time() - t_start, t_drive, only)
    # the snapshots tools/shots/check.py replays against the owner's bench screenshot: kept (our layers only)
    for k in KEEP_SNAPS:
        src = os.path.join(snaps, k.replace('/', '__'))
        if os.path.isdir(src):
            dst = os.path.join(out, 'sanity', k.replace('/', '__'))
            shutil.rmtree(dst, ignore_errors=True)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(src, dst)
    for d in (snaps, pool):
        shutil.rmtree(d, ignore_errors=True)
    for i in range(1, nb + 1):
        shutil.rmtree(os.path.join(work, 'b%d' % i), ignore_errors=True)
    if not any(k not in ('snaps', 'pool') for k in os.listdir(work)):
        shutil.rmtree(work, ignore_errors=True)


def _paint_worker(inq, outq, pool, keep):
    import paint
    paint.worker(inq, outq, pool, keep)


# ---------------------------------------------------------------- the folder
def assemble(out, pool, planned, jobs_all, order, results, rendered, logs, still, wall, t_drive, only):
    man_f = os.path.join(out, 'manifest.json')
    old = {}
    if os.path.exists(man_f):
        for e in json.load(open(man_f))['pictures']:
            old[e['id']] = e
    redo = set(j['id'] for j in planned)
    # the files of the redone jobs go
    for i in redo:
        e = old.pop(i, None)
        if e:
            for k in ('file', 'matte', 'thumb', 'matte_thumb'):
                if e.get(k) and os.path.exists(os.path.join(out, e[k])):
                    os.remove(os.path.join(out, e[k]))
    entries = dict(old)
    failed = []
    for j in planned:
        r = results.get(j['id'])
        pid, match = MX.backdrop(j['state'], j['context'])
        e = {'id': j['id'], 'set': j['set'], 'context': j['context'], 'name': j['name'], 'axis': j['axis'], 'value': j['value'],
             'fed': {'settings': drive.want_settings(j), 'signals': drive.signals_of(j['state']) if j['context'] != 'diag' else None,
                     'drive_mode': j['state']['mode'], 'limit': j['state']['limit'], 'message': j['state']['msg'],
                     'road': j['state']['road'], 'clock': j['state']['clock'],
                     'hook': MX.CC_HOOK.get(j['state']['msg']), 'fresh_restart': j['fresh']},
             'backdrop': pid, 'backdrop_matches': match, 'rel': j['rel']}
        if not r or not r.get('ok'):
            failed.append({'id': j['id'], 'reason': (r or {}).get('reason') or ['never run'], 'probe_last': (r or {}).get('probe')})
            continue
        rr = rendered.get(j['id'])
        if not rr or rr.get('error'):
            failed.append({'id': j['id'], 'reason': ['render failed: %s' % ((rr or {}).get('error') or 'no result')], 'probe_last': r.get('probe')})
            continue
        e.update({'probe': r['probe'], 'stable': r.get('stable'), 'drive_secs': r.get('secs'), 'hash': rr['hash'],
                  'coverage': rr['coverage'], 'strip_coverage': rr['strip_coverage'], 'open_px': rr['open_px'],
                  'render_notes': rr['render_notes'], '_pool_car': rr['car'], '_pool_matte': rr['matte']})
        e['caption'] = row_caption(j['context'], r['probe']) + ' | ' + fed_caption(j)
        entries[j['id']] = e
    # dedupe, per context, in plan order: the first entry of each hash keeps the picture, the others fold into it
    by_ctx = {}
    for e in entries.values():
        by_ctx.setdefault(e['context'], []).append(e)
    os.makedirs(os.path.join(out, 'thumbs'), exist_ok=True)
    for ctx, es in by_ctx.items():
        es.sort(key=lambda e: order.get(e['id'], 1 << 30))
        base = next((e for e in es if e['id'] == 'A/%s/baseline/baseline' % ctx), None)
        canon = {}
        for e in es:
            e.pop('same_as', None)
            if base and e is not base and e.get('hash') == base.get('hash'):
                e['no_visible_effect'] = True
            else:
                e.pop('no_visible_effect', None)
            h = e.get('hash')
            c = canon.get(h)
            if c is None and (e.get('_pool_car') or e.get('file')):
                canon[h] = e
                if e.get('_pool_car'):
                    rel = e['rel']
                    e['file'] = rel + '.png'
                    e['thumb'] = 'thumbs/' + rel + '.jpg'
                    _move(os.path.join(pool, e['_pool_car']), os.path.join(out, e['file']))
                    _move(os.path.join(pool, e['_pool_car'])[:-4] + '.t.jpg', os.path.join(out, e['thumb']))
                    if e.get('_pool_matte'):
                        e['matte'] = rel + '.matte.png'
                        e['matte_thumb'] = 'thumbs/' + rel + '.matte.jpg'
                        _copy(os.path.join(pool, e['_pool_matte']), os.path.join(out, e['matte']))
                        _copy(os.path.join(pool, e['_pool_matte'])[:-4] + '.t.jpg', os.path.join(out, e['matte_thumb']))
                    else:
                        e['matte'] = e['matte_thumb'] = None
            elif c is not None:
                e['same_as'] = c['id']
                for k in ('file', 'matte', 'thumb', 'matte_thumb'):
                    if e.get(k) and e.get('_pool_car') is None and os.path.exists(os.path.join(out, e[k])):
                        os.remove(os.path.join(out, e[k]))
                    e[k] = None
            e.pop('_pool_car', None)
            e.pop('_pool_matte', None)
    pics = sorted(entries.values(), key=lambda e: order.get(e['id'], 1 << 30))
    # old failures of jobs not redone stay
    ff = os.path.join(out, 'failed.json')
    if os.path.exists(ff):
        failed = [f for f in json.load(open(ff)) if f['id'] not in redo and f['id'] not in entries] + failed
    json.dump(failed, open(ff, 'w'), indent=1, ensure_ascii=False)
    # counts
    counts = {}
    for j in jobs_all.values():
        k = j['set'] + ' ' + j['context']
        counts.setdefault(k, {'planned': 0, 'produced': 0, 'deduplicated': 0, 'no_visible_effect': 0, 'failed': 0})
        counts[k]['planned'] += 1
    for e in pics:
        k = e['set'] + ' ' + e['context']
        if e.get('file'):
            counts[k]['produced'] += 1
        elif e.get('same_as'):
            counts[k]['deduplicated'] += 1
        if e.get('no_visible_effect'):
            counts[k]['no_visible_effect'] += 1
    for f in failed:
        j = jobs_all.get(f['id'])
        if j:
            counts[j['set'] + ' ' + j['context']]['failed'] += 1
    # the bench logs: any error or refusal line
    bad = []
    for fn in sorted(os.listdir(logs)):
        if fn.startswith('bench-'):
            for ln in open(os.path.join(logs, fn), errors='replace'):
                if BAD_LOG.search(ln) and not BENIGN_LOG.search(ln):
                    bad.append(fn + ': ' + ln.strip()[:300])
    nve = {}
    for e in pics:
        if e.get('no_visible_effect') and e['set'] == 'A':
            nve.setdefault(e['context'], []).append('%s=%s' % (e['axis'], e['value']))
    summary = {'out': out, 'when': time.strftime('%Y-%m-%d %H:%M:%S'), 'only': only, 'wall_secs': round(wall), 'drive_secs': round(t_drive),
               'counts': counts, 'pictures_saved': sum(1 for e in pics if e.get('file')),
               'mattes_saved': sum(1 for e in pics if e.get('matte')), 'failed': len(failed),
               'unstable': [e['id'] for e in pics if e.get('stable') is False],
               'render_notes': sorted(set('%s: %s' % (n['kind'], n['note']) for e in pics for n in (e.get('render_notes') or []))),
               'no_visible_effect': nve, 'bench_log_problems': bad, 'ports_still_listening': still,
               'repeat': 'UV_CACHE_DIR=%s uv run -q --no-project --with numpy --with pillow --with moderngl python -I tools/shots/run.py'
                         % os.path.realpath(os.path.join(ROOT, 'bake', 'work', '.uvcache'))}
    json.dump({'about': 'tools/shots/run.py: one entry per combination; "file" null and "same_as" set = identical to that '
                        'picture (our layers, clock minute aside); "no_visible_effect" = identical to its context\'s baseline',
               'pictures': pics}, open(man_f, 'w'), indent=1, ensure_ascii=False)
    json.dump(summary, open(os.path.join(out, 'summary.json'), 'w'), indent=1, ensure_ascii=False)
    import index
    index.write(out, pics, summary, failed)
    print(json.dumps({k: v for k, v in summary.items() if k in ('wall_secs', 'pictures_saved', 'failed', 'ports_still_listening')}), flush=True)


def _move(a, b):
    """A pool file is used by one canonical entry only (its hash and backdrop), so it is moved, not copied."""
    os.makedirs(os.path.dirname(b), exist_ok=True)
    if os.path.exists(a):
        os.replace(a, b)


_copy = _move


if __name__ == '__main__':
    main()
