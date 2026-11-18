"""research3 MT: design/research3/mt/textures.json, the inventory with every measurement, from the scratch results.

    python3 -I tools/research3/mt/collect.py
Reads bake/work/research3/MT/{inventory, accounting-base, experiments, packages, prototypes}.json (made by inventory.py,
accounting.py, experiments.py, packages.py, prototypes.py) and writes one file: per texture its inventory, the states
that upload it, and every option measured on it (bytes, pixel memory, the rendered difference); the per-state
accounting; the switches; the three packages; the prototypes on the bench. Numbers only, no pixels.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
WORK = os.path.join(ROOT, 'bake', 'work', 'research3', 'MT')
OUT = os.path.join(ROOT, 'design', 'research3', 'mt', 'textures.json')


def load(n):
    p = os.path.join(WORK, n + '.json')
    return json.load(open(p)) if os.path.exists(p) else None


def main():
    inv, acc, exp, pkg, proto = load('inventory'), load('accounting-base'), load('experiments'), load('packages'), load('prototypes')
    tex = inv['textures']
    for n, t in tex.items():
        t['uploaded_in_states'] = sorted(s for s, a in acc['states'].items() if any(i['name'] == n for i in a['items']))
        t['options'] = {}
    for vid, v in (exp or {}).items():
        for st, x in v['states'].items():
            for a in x['assets']:
                base = a['name'].split('.')[0]
                if base in tex and v['group'] != 'package':
                    o = tex[base]['options'].setdefault(vid, {'group': v['group'], 'desc': v['desc'], 'states': {}})
                    o['states'][st] = {'bytes': x['bytes_after'], 'pixel_memory': x['pixel_memory_after'],
                                       'bytes_before': x['bytes_before'], 'pixel_memory_before': x['pixel_memory_before'],
                                       'frame_diff': x['diff']}
            if not x['assets'] and v['group'] == 'procedural':
                for n in ('speedo', 'tacho', 'window', 'horizon'):
                    if n in vid or (vid == 'proc-dials' and n in ('speedo', 'tacho')) or (vid == 'proc-window' and n in ('window', 'horizon')):
                        o = tex[n]['options'].setdefault(vid, {'group': v['group'], 'desc': v['desc'], 'states': {}})
                        o['states'][st] = {'bytes': 0, 'pixel_memory': 0, 'frame_diff': x['diff']}
    for a in acc['states'].values():
        for i in a['items']:
            i.pop('key', None)
    out = {
        '_about': 'research3 MT (docs/research3/MT-REPORT.md): f30_cluster scene textures, every measurement. bytes = one whole '
                  'upload (what cluster-render charges to the KOMBI link\'s budget); pixel_memory = cluster-render\'s accounting '
                  '(uncompressed twice, ETC2 once; 16 MiB for every app); frame_diff = the rendered 1920x720 frame of that state '
                  'against today\'s, premultiplied colour and coverage in 0..255 (max, pixels over 2 / 8 / 16, PSNR and mean '
                  'inside the sampling layers\' box). Bench (Mac GPU, fp32) renders: what transfers to the car is bytes, pixel '
                  'memory and the decoded texels; not milliseconds.',
        'textures': tex, 'pairs': inv['pairs'], 'states': acc['states'], 'switches_today': acc['switches'],
        'packages': pkg, 'prototypes': proto,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w'), indent=1, sort_keys=False)
    print('->', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
