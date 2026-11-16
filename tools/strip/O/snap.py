"""Package O: freeze what the bench's engine is drawing right now into a folder, for tools/strip/O/render.py.

    python3 tools/strip/O/snap.py <out dir> [label]      (BENCH_PORT, default 8161)

Writes <out>/scene.json (the last 'scene' message of GET /events: every layer, shader, uniform, binding, plus GET
/probe's settings, signs, status and patches) and <out>/px/<conn>_<ref>.raw (each image layer's and asset's current
RGBA, GET /px). Assets are fetched once per content (an asset never changes once pushed in this theme) and
re-fetched when its size changes.
"""
import hashlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import benchio as B   # noqa: E402


def snap(out, label='', probe=None, settle=0.0):
    if settle:
        time.sleep(settle)
    os.makedirs(os.path.join(out, 'px'), exist_ok=True)
    p = probe or B.probe()
    sc = B.scene(2.5)
    meta = {'label': label, 'time': time.strftime('%Y-%m-%d %H:%M:%S'), 'port': B.PORT,
            'probe': {k: p.get(k) for k in ('settings', 'signs', 'status', 'activeName', 'layoutName', 'driveMode')},
            'pixels': sc.get('pixels'), 'layers': sc['layers']}
    hashes = {}
    for l in sc['layers']:
        if l['kind'] not in ('image', 'asset') or not l.get('iw'):
            continue
        raw = B.px(l['key'], 0, 0, l['iw'], l['ih'])
        if raw is None:
            continue
        open(os.path.join(out, 'px', l['key'].replace(':', '_') + '.raw'), 'wb').write(raw)
        hashes[l['key']] = hashlib.sha1(raw).hexdigest()[:12]
    meta['px_sha1'] = hashes
    json.dump(meta, open(os.path.join(out, 'scene.json'), 'w'))
    return meta


if __name__ == '__main__':
    m = snap(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else '')
    print(len(m['layers']), 'layers;', len(m['px_sha1']), 'pixel dumps')
