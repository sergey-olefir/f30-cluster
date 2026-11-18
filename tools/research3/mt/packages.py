"""research3 MT: the three option packages of docs/research3/MT-REPORT.md, totalled per state and per switch.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/research3/mt/packages.py \\
        [snaps dir] [experiments.json] [out.json]

Bytes and pixel memory come from the bench's own scene (accounting.py) with each package's textures put in place of
today's (cluster-render's accounting: one upload = the asset's bytes; pixel memory twice for uncompressed, once for
ETC2). The picture cost of each package is the rendered difference experiments.py measured (pkg-* variants).
Times are bytes over the car's upload cap (floor 2000 KB/s, ceiling 5500 KB/s): the same bytes take that long whether
they are a first start, a theme switch or the KOMBI mapping the scene again ('goes whole'); the Mac's milliseconds are
not used anywhere here.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import accounting as AC   # noqa: E402
import texlib as TL       # noqa: E402

PM_LIMIT = 16 * 1024 * 1024
MAIN = ('comfort', 'g20', 'sport', 'eco')


def pad(n):
    return (n + 3) // 4 * 4


def dial_r8c(w, h):
    return {'format': 'r8', 'w': w, 'h': h, 'extra': [{'name': 'chroma', 'format': 'rgba8', 'w': (w + 3) // 4, 'h': (h + 3) // 4}]}


def etc2rgb(w, h):
    return {'format': 'etc2rgb', 'w': pad(w), 'h': pad(h)}


def etc2rgba(w, h):
    return {'format': 'etc2rgba', 'w': pad(w), 'h': pad(h)}


SIZES = {'speedo': (670, 670), 'tacho': (670, 670), 'speedo_d': (670, 670), 'tacho_d': (670, 670), 'fuel': (144, 144),
         'oil': (144, 144), 'window': (320, 286), 'horizon': (424, 10), 'bar': (584, 79), 'range_seg': (346, 68),
         'ed_seg': (346, 70), 'sign_limit': (88, 89), 'sign_nopass': (88, 89), 'collar_r8': (480, 180), 'strip_mask': (1908, 353)}
DIALS = ('speedo', 'tacho', 'speedo_d', 'tacho_d', 'fuel', 'oil')

PACKAGES = {
    'today': {'tex': {}, 'keep': False, 'share_d': False},
    'A-safe': {
        'desc': 'R8 everywhere it is (near) lossless, formats the car already draws: segments R8 alpha, window R8 x tint, '
                'the six dial textures R8 value + colour at 1/4 (prototype A, config.sceneTex "r8")',
        'tex': dict({'range_seg': {'format': 'r8', 'w': 346, 'h': 68}, 'ed_seg': {'format': 'r8', 'w': 346, 'h': 70},
                     'window': {'format': 'r8', 'w': 320, 'h': 286}}, **{n: dial_r8c(*SIZES[n]) for n in DIALS}),
        'keep': False, 'share_d': False, 'variant': 'pkg-r8c'},
    'B-best': {
        'desc': 'ETC2: the dials, minis and window premultiplied etc2rgb (prototype B, config.sceneTex "etc2"), segments R8; '
                'and, because the pixel memory then allows it, every theme\'s textures kept resident across switches',
        'tex': dict({'range_seg': {'format': 'r8', 'w': 346, 'h': 68}, 'ed_seg': {'format': 'r8', 'w': 346, 'h': 70},
                     'window': etc2rgb(320, 286)}, **{n: etc2rgb(*SIZES[n]) for n in DIALS}),
        'keep': True, 'share_d': False, 'variant': 'pkg-etc2'},
    'C-all': {
        'desc': 'B plus horizon and signs etc2rgba, the G20 masks etc2rgba (pixel memory once), Comfort and Comfort + G20 '
                'sharing one dial texture (speedo_d / tacho_d + a bottom-arc patch), resident across switches',
        'tex': dict({'range_seg': {'format': 'r8', 'w': 346, 'h': 68}, 'ed_seg': {'format': 'r8', 'w': 346, 'h': 70},
                     'window': etc2rgb(320, 286), 'horizon': etc2rgba(424, 10), 'sign_limit': etc2rgba(88, 89),
                     'sign_nopass': etc2rgba(88, 89), 'collar_r8': etc2rgba(480, 180), 'strip_mask': etc2rgba(1908, 353)},
                    **{n: etc2rgb(*SIZES[n]) for n in DIALS}),
        'keep': True, 'share_d': True, 'variant': 'pkg-all'},
}
# C: Comfort samples speedo_d / tacho_d (shared with the G20 layout) and a patch with its bottom arc (inventory.json
# pairs: the textures differ only in [154, 558, 516, 639] and [124, 542, 519, 637]), etc2rgb
PATCH = {'speedo': (362, 81), 'tacho': (395, 95)}


def items_of(acc, pkg):
    """The state's uploads under the package: [(name, ci, kind, bytes, pm)]."""
    out = []
    for i in acc['items']:
        name, kind = i['name'], i['kind']
        v = pkg['tex'].get(name) if kind == 'scene' else None
        if kind == 'scene' and pkg.get('share_d') and name in PATCH:
            base = name + '_d'
            vb = pkg['tex'].get(base, {'format': 'rgba8', 'w': 670, 'h': 670})
            out.append((base, i['ci'], kind, TL.raw_bytes(vb['format'], vb['w'], vb['h']), TL.pixel_memory(vb['format'], vb['w'], vb['h'])))
            pw, ph = PATCH[name]
            out.append((name + '.patch', i['ci'], kind, TL.raw_bytes('etc2rgb', pad(pw), pad(ph)), TL.pixel_memory('etc2rgb', pad(pw), pad(ph))))
            continue
        if v:
            out.append((name, i['ci'], kind, TL.raw_bytes(v['format'], v['w'], v['h']), TL.pixel_memory(v['format'], v['w'], v['h'])))
            for e in v.get('extra', []):
                out.append((name + '.' + e['name'], i['ci'], kind, TL.raw_bytes(e['format'], e['w'], e['h']), TL.pixel_memory(e['format'], e['w'], e['h'])))
        else:
            out.append((name, i['ci'], kind, i['bytes'], i['pixel_memory']))
    return out


def secs(b):
    return {str(k): round(b / 1024.0 / k, 2) for k in AC.KBS}


def evaluate(accs, pkg):
    st = {}
    for s, a in accs.items():
        it = items_of(a, pkg)
        b = sum(x[3] for x in it)
        pm = sum(x[4] for x in it)
        st[s] = {'bytes': b, 'scene_bytes': sum(x[3] for x in it if x[2] == 'scene'), 'sheet_bytes': sum(x[3] for x in it if x[2] == 'sheet'),
                 'pixel_memory': pm, 'scene_pixel_memory': sum(x[4] for x in it if x[2] == 'scene'), 'seconds_whole': secs(b)}
    # residency: with "keep", every scene texture of the four themes stays once made (if it fits)
    resident = {}
    for s in MAIN:
        for x in items_of(accs[s], pkg):
            if x[2] == 'scene':
                resident[(x[0], x[1])] = x
    res_pm = sum(x[4] for x in resident.values())
    res_b = sum(x[3] for x in resident.values())
    fits = all(res_pm + sum(x[4] for x in items_of(accs[s], pkg) if x[2] != 'scene') <= PM_LIMIT for s in MAIN)
    keep = pkg.get('keep') and fits
    sw = []
    for a in MAIN:
        for b in MAIN:
            if a == b:
                continue
            ia, ib = items_of(accs[a], pkg), items_of(accs[b], pkg)
            have = set(resident) if keep else {(x[0], x[1]) for x in ia if x[2] != 'sheet'}
            sent = [x for x in ib if x[2] == 'sheet' or (x[0], x[1]) not in have]
            nb = sum(x[3] for x in sent)
            sw.append({'from': a, 'to': b, 'bytes_sent': nb, 'scene_bytes_sent': sum(x[3] for x in sent if x[2] == 'scene'), 'seconds': secs(nb)})
    whole = {s: (st[s]['bytes'] - st[s]['scene_bytes'] + (res_b if keep else st[s]['scene_bytes'])) for s in MAIN}
    return {'states': st, 'switches': sw, 'resident_all_themes': {'pixel_memory': res_pm, 'bytes': res_b, 'fits_16MiB_with_every_layout': fits, 'kept': bool(keep)},
            'whole_scene_on_each_map': {s: {'bytes': whole[s], 'seconds': secs(whole[s])} for s in MAIN}}


def main():
    work = os.path.join(TL.ROOT, 'bake', 'work', 'research3', 'MT')
    snaps = sys.argv[1] if len(sys.argv) > 1 else os.path.join(work, 'snaps', 'base')
    expf = sys.argv[2] if len(sys.argv) > 2 else os.path.join(work, 'experiments.json')
    out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(work, 'packages.json')
    accs = AC.main(snaps)['states']
    exp = json.load(open(expf)) if os.path.exists(expf) else {}
    res = {}
    for k, p in PACKAGES.items():
        r = evaluate(accs, p)
        r['desc'] = p.get('desc', 'today\'s build (0.7.20)')
        if p.get('variant') in exp:
            r['picture'] = {s: x['diff'] for s, x in exp[p['variant']]['states'].items()}
        res[k] = r
        print('==', k)
        for s in MAIN + ('comfort-map', 'comfort-night'):
            if s in r['states']:
                x = r['states'][s]
                print('  %-14s total %8d B (scene %8d)  pm %9d (scene %9d)  %s s' % (s, x['bytes'], x['scene_bytes'], x['pixel_memory'], x['scene_pixel_memory'], x['seconds_whole']))
        print('  resident', r['resident_all_themes'])
        for w in r['switches']:
            print('  %-7s -> %-7s %8d B (scene %8d) %s' % (w['from'], w['to'], w['bytes_sent'], w['scene_bytes_sent'], w['seconds']))
        print('  whole scene on each map', {s: v['seconds'] for s, v in r['whole_scene_on_each_map'].items()})
    json.dump(res, open(out, 'w'), indent=1)
    print('->', out)


if __name__ == '__main__':
    main()
