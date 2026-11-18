"""research3 MB: read the traces tools/research3/mb/trace.py wrote and print / save what each app says to cluster-render.

    python3 -I tools/research3/mb/analyse.py <run dir> [<run dir> ...] [--json <out.json>]

Per run and per step (the marks in the trace): every op the app sent (count), layers made / dropped, assets made /
dropped, bytes on the wire (frames: pixels with their headers; JSON: its length is not traced, counted as 0), the
live layers and the pixel memory the bench's model accounts (each image and asset counted twice), and the
"rebuild window": from the first drop to the last layer made in that step, with the longest time in which the app
had NO live layer on the panel (cluster-render then starts its 3000 ms linger) and the lowest number of live
layers inside the window. Standard library only.
"""
import json
import os
import sys

GEAR = (1398, 668, 1424, 703)
GAP = (1380, 660, 1460, 720)
BOX = (1406, 342, 1597, 419)


def hit(r, b):
    return r[0] < b[2] and b[0] < r[2] and r[1] < b[3] and b[1] < r[3]


def load(run):
    return [json.loads(l) for l in open(os.path.join(run, 'trace.jsonl')) if l.strip()]


def analyse(run):
    L = load(run)
    live = {}        # (conn, ref) -> {kind, rect, bytes(px mem), target, klass, z}
    out = {'run': os.path.basename(run), 'apps': set(), 'conns': set(), 'steps': []}
    step = None

    def new_step(label, t):
        s = {'step': label, 't0': t, 'ops': {}, 'layers_made': 0, 'layers_dropped': 0, 'assets_made': 0,
             'assets_dropped': 0, 'frame_bytes': 0, 'frames': 0, 'whole_frames': 0, 'first_drop': None,
             'last_make': None, 'min_live': None, 'no_layer_ms': 0, 'peak_px': 0, 'klass': {}, 'made': [],
             'set_ops': 0, 'events': {}, 'prewarm': 0, 'exclusive': 0, 'fs_bytes': 0, 'fs_new': 0, 'fs_new_bytes': 0,
             'targets': {}}
        out['steps'].append(s)
        return s

    def px_mem():
        return sum(v['mem'] for v in live.values())

    def nlayers():
        return sum(1 for v in live.values() if v['kind'] != 'asset' and v['target'] == 'panel')

    empty_since = None
    seen_fs = set()
    step = new_step('pre', L[0]['t'])
    for e in L:
        t = e['t']
        if e['dir'] == 'mark':
            lab = e['label']
            if lab in ('bench-start', 'end') or lab.endswith('-done') and lab != 'start-done':
                if lab.endswith('-done'):
                    step['t1'] = t
                continue
            if lab == 'app-up':
                step = new_step('start', t)
                step['t0'] = out['steps'][0]['t0']
                continue
            if lab == 'start-done':
                step['t1'] = t
                continue
            step = new_step(lab, t)
            continue
        if e['dir'] == 'open':
            out['conns'].add(e['conn'])
            continue
        if e['dir'] == 'out':
            k = e.get('ev', '?') + ('/' + e['state'] if e.get('state') else '')
            step['events'][k] = step['events'].get(k, 0) + 1
            continue
        if e['dir'] != 'in':
            continue
        op = e.get('op')
        out['apps'].add(e.get('app'))
        step['ops'][op] = step['ops'].get(op, 0) + 1
        key = (e['conn'], e.get('ref'))
        before = nlayers()
        if op == 'layer':
            mem = e.get('iw', 0) * e.get('ih', 0) * 8 if e.get('kind') == 'image' else 0
            r = (e.get('x', 0), e.get('y', 0), e.get('x', 0) + e.get('w', 0), e.get('y', 0) + e.get('h', 0))
            live[key] = {'kind': e.get('kind'), 'rect': r, 'mem': mem, 'target': e.get('target'), 'klass': e.get('class', 'content'), 'z': e.get('z', 0)}
            step['layers_made'] += 1
            step['last_make'] = t
            kk = e.get('class', 'content')
            step['klass'][kk] = step['klass'].get(kk, 0) + 1
            step['made'].append({'conn': e['conn'], 'ref': e.get('ref'), 'kind': e.get('kind'), 'class': kk, 'z': e.get('z', 0),
                                 'rect': list(r), 'gear': hit(r, GEAR), 'gap': hit(r, GAP), 'box': hit(r, BOX),
                                 'fsLen': e.get('fsLen'), 'prewarm': e.get('prewarm', 0), 'exclusive': e.get('exclusive', 0)})
            if e.get('fsHash'):
                step['fs_bytes'] += e.get('fsLen', 0)
                if e['fsHash'] not in seen_fs:
                    seen_fs.add(e['fsHash'])
                    step['fs_new'] += 1
                    step['fs_new_bytes'] += e.get('fsLen', 0)
            tg = e.get('target')
            step['targets'][tg] = step['targets'].get(tg, 0) + 1
            if e.get('prewarm'):
                step['prewarm'] += 1
            if e.get('exclusive'):
                step['exclusive'] += 1
        elif op == 'asset':
            bpp = 1 if e.get('format') == 'r8' else 4
            live[key] = {'kind': 'asset', 'rect': None, 'mem': e.get('w', 0) * e.get('h', 0) * bpp * 2, 'target': e.get('target')}
            step['assets_made'] += 1
        elif op == 'drop':
            v = live.pop(key, None)
            if v and v['kind'] == 'asset':
                step['assets_dropped'] += 1
            else:
                step['layers_dropped'] += 1
                if step['first_drop'] is None:
                    step['first_drop'] = t
        elif op == 'frame':
            step['frames'] += 1
            step['frame_bytes'] += e.get('bytes', 0)
            if e.get('whole'):
                step['whole_frames'] += 1
        elif op == 'set':
            step['set_ops'] += 1
        n = nlayers()
        if step['first_drop'] is not None:
            step['min_live'] = n if step['min_live'] is None else min(step['min_live'], n)
        if n == 0 and before > 0:
            empty_since = t
        if n > 0 and empty_since is not None:
            step['no_layer_ms'] = max(step['no_layer_ms'], t - empty_since)
            empty_since = None
        step['peak_px'] = max(step['peak_px'], px_mem())
        step['live_after'] = n
        step['px_after'] = px_mem()
    for s in out['steps']:
        s['rebuild_ms'] = (s['last_make'] - s['first_drop']) if s['first_drop'] and s['last_make'] and s['last_make'] >= s['first_drop'] else None
        s['dur_ms'] = (s.get('t1') or s['t0']) - s['t0']
    out['apps'] = sorted(a for a in out['apps'] if a)
    out['conns'] = len(out['conns'])
    out['final_layers'] = [dict(conn=k[0], ref=k[1], **{x: v[x] for x in ('kind', 'rect', 'klass', 'z', 'mem')})
                           for k, v in live.items() if v['kind'] != 'asset']
    return out


def show(o):
    print('== %s  apps %s  connections %d' % (o['run'], ','.join(o['apps']), o['conns']))
    print('  %-14s %6s %5s %5s %5s %5s %6s %10s %8s %6s %6s %8s %5s %7s %9s %s' % (
        'step', 'ops', 'mk', 'drop', 'a+', 'a-', 'frames', 'bytes', 'rebuild', 'minL', 'noL', 'peakMiB', 'live', 'fsBytes', 'newFs', 'ops by kind'))
    for s in o['steps']:
        print('  %-14s %6d %5d %5d %5d %5d %6d %10d %8s %6s %6d %8.2f %5s %7d %9s %s' % (
            s['step'], sum(s['ops'].values()), s['layers_made'], s['layers_dropped'], s['assets_made'], s['assets_dropped'],
            s['frames'], s['frame_bytes'], s['rebuild_ms'] if s['rebuild_ms'] is not None else '-',
            s['min_live'] if s['min_live'] is not None else '-', s['no_layer_ms'], s['peak_px'] / 1048576.0,
            s.get('live_after', '-'), s['fs_bytes'], '%d/%d' % (s['fs_new'], s['fs_new_bytes']), json.dumps(s['ops'], sort_keys=True)))


def main():
    runs = [a for a in sys.argv[1:] if not a.startswith('--') and not a.endswith('.json')]
    res = [analyse(r) for r in runs]
    for o in res:
        show(o)
    if '--json' in sys.argv:
        p = sys.argv[sys.argv.index('--json') + 1]
        os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
        json.dump(res, open(p, 'w'), indent=1, default=list)
        print('wrote', p)


if __name__ == '__main__':
    main()
