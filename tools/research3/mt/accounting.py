"""research3 MT: what each state of f30_cluster uploads and holds, from the bench's own scene (snapshots.py).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy python -I tools/research3/mt/accounting.py \\
        <snaps dir> [out.json]

Per snapshot: every asset and image layer (its bytes for one whole upload, cluster-render's pixel memory: uncompressed
twice, ETC2 once), each asset named after the scene texture whose pixels it holds (matched by content), glyph atlases
and sheets apart; the totals; the time the whole lot takes at the car's upload cap (floor 2000 KB/s, ceiling 5500 KB/s,
reference/car/2026-11-15 cluster-render.conf; cluster-render charges a target's whole scene again each time the KOMBI
maps it: 'its scene goes whole to the renderer again'). Then every switch between two states: what the engine drops
and makes again (shared/hud.js: every layer is re-made; a scene texture survives only when the new layout samples it
on the same connection; glyph atlases of 'atext' widgets stay while the connection lives), and those bytes.
"""
import hashlib
import json
import os
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texlib as TL   # noqa: E402

KBS = (2000, 5500)


def scene_hashes():
    out = {}
    for f in os.listdir(TL.SCENE):
        if f.endswith('.json'):
            rgba, _ = TL.load(f[:-5])
            out[hashlib.sha1(rgba.tobytes()).hexdigest()[:12]] = f[:-5]
    return out


def account(d, H, variant=None):
    meta = json.load(open(os.path.join(d, 'scene.json')))
    conns = {}
    for l in meta['layers']:
        conns.setdefault(l['conn'], l.get('app'))
    ci_of = {c: i for i, c in enumerate(sorted(conns))}      # connection order = the engine's ci (0 = f30_cluster)
    items = []
    for l in meta['layers']:
        if l['kind'] not in ('asset', 'image'):
            continue
        fmt = l.get('format') or 'rgba8'
        w, h = l['iw'], l['ih']
        sha = meta.get('px_sha1', {}).get(l['key'])
        name = H.get(sha)
        kind = 'sheet' if l['kind'] == 'image' else 'scene' if name else 'blank' if w * h == 1 else 'glyph atlas' if fmt == 'r8' else 'asset?'
        it = {'key': l['key'], 'app': l.get('app'), 'ci': ci_of[l['conn']], 'kind': kind, 'name': name or ('%dx%d' % (w, h)),
              'format': fmt, 'w': w, 'h': h, 'bytes': TL.raw_bytes(fmt, w, h), 'pixel_memory': TL.pixel_memory(fmt, w, h)}
        if variant and name in variant:
            v = variant[name]
            it.update({'format': v['format'], 'w': v['w'], 'h': v['h'], 'bytes': TL.raw_bytes(v['format'], v['w'], v['h']),
                       'pixel_memory': TL.pixel_memory(v['format'], v['w'], v['h']), 'variant': True})
        items.append(it)
    tot = {}
    for k in ('scene', 'sheet', 'glyph atlas', 'blank', 'asset?'):
        sel = [i for i in items if i['kind'] == k]
        tot[k] = {'n': len(sel), 'bytes': sum(i['bytes'] for i in sel), 'pixel_memory': sum(i['pixel_memory'] for i in sel)}
    b = sum(i['bytes'] for i in items)
    pm = sum(i['pixel_memory'] for i in items)
    return {'state': os.path.basename(d), 'layout': (meta.get('probe') or {}).get('activeName'), 'bench_pixels': meta.get('pixels'),
            'layers': sum(1 for l in meta['layers'] if l['kind'] != 'asset'), 'items': items, 'by_kind': tot,
            'bytes': b, 'pixel_memory': pm,
            'seconds_whole': {str(k): round(b / 1024.0 / k, 2) for k in KBS}}


def switch(a, b):
    """From state a to state b without a restart: the bytes the engine sends again."""
    keep_a = {(i['ci'], i['name']) for i in a['items'] if i['kind'] in ('scene', 'glyph atlas', 'blank')}
    sent = []
    for i in b['items']:
        if i['kind'] == 'sheet':
            sent.append(i)                                  # every layer is made again: sheets are new images
        elif (i['ci'], i['name']) not in keep_a:
            sent.append(i)
    dropped = [i for i in a['items'] if i['kind'] == 'scene' and (i['ci'], i['name']) not in {(j['ci'], j['name']) for j in b['items']}]
    nb = sum(i['bytes'] for i in sent)
    # the peak: the engine drops the scene textures the new layout does not sample BEFORE making the new ones
    # (hud.js _rebuild), and every layer at the start; what stays is the kept assets
    kept = [i for i in a['items'] if i['kind'] in ('scene', 'glyph atlas', 'blank') and i not in dropped]
    peak = sum(i['pixel_memory'] for i in kept) + sum(i['pixel_memory'] for i in sent)
    return {'from': a['state'], 'to': b['state'], 'bytes_sent': nb, 'scene_bytes_sent': sum(i['bytes'] for i in sent if i['kind'] == 'scene'),
            'scene_sent': sorted({i['name'] for i in sent if i['kind'] == 'scene'}), 'scene_dropped': sorted({i['name'] for i in dropped}),
            'pixel_memory_after': b['pixel_memory'], 'pixel_memory_peak_est': peak,
            'seconds': {str(k): round(nb / 1024.0 / k, 2) for k in KBS}}


def main(snaps, out=None, variant=None):
    H = scene_hashes()
    states = sorted(x for x in os.listdir(snaps) if os.path.exists(os.path.join(snaps, x, 'scene.json')))
    acc = {s: account(os.path.join(snaps, s), H, variant) for s in states}
    main_states = [s for s in ('comfort', 'g20', 'sport', 'eco') if s in acc]
    sw = [switch(acc[a], acc[b]) for a in main_states for b in main_states if a != b]
    res = {'states': acc, 'switches': sw}
    if out:
        json.dump(res, open(out, 'w'), indent=1)
    return res


if __name__ == '__main__':
    r = main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    for s, a in r['states'].items():
        k = a['by_kind']
        print('%-15s %-10s layers %2d  scene %8d B (%d)  sheets %8d B (%d)  glyph %7d B  total %8d B  pm %9d (bench %s)  %s s' % (
            s, a['layout'], a['layers'], k['scene']['bytes'], k['scene']['n'], k['sheet']['bytes'], k['sheet']['n'],
            k['glyph atlas']['bytes'], a['bytes'], a['pixel_memory'], a['bench_pixels'], a['seconds_whole']))
        print('      ', ', '.join('%s:%s' % (i['name'], i['bytes']) for i in a['items'] if i['kind'] == 'scene'))
    for s in r['switches']:
        print('%-8s -> %-8s sent %8d B (scene %8d: %s) dropped %s  %s s  peak %d' % (s['from'], s['to'], s['bytes_sent'], s['scene_bytes_sent'],
              ','.join(s['scene_sent']), ','.join(s['scene_dropped']), s['seconds'], s['pixel_memory_peak_est']))
