#!/usr/bin/env python3
"""r1120 LN: the kit canvas's "cyrillic" atlas family (kit/runtime/fonts/cyrillic.json) from Twin Dial's Noto Sans atlases.

    python3 tools/i18n/kit_cyrillic.py            # writes kit/runtime/fonts/cyrillic.json

The kit's canvas (kit/runtime/fonts.js) draws any text that holds a Cyrillic letter with the family "cyrillic"; the kit as
shipped has none, so a Ukrainian word on a drawn centre screen (f30_cluster's theme gallery, the slim bar, the menu's
picture) came out as "?". Nothing is rasterised here: the glyphs are the bitmaps already baked for the cluster
(apps/twin_dial/hud/fonts/td_u19.json, Noto 19, and td_tab.json, Noto 33: Latin, accented Latin, Ukrainian, Russian and
Belarusian letters), copied into the kit's format (one size per atlas, glyph [x, y, w, h, ox, oy, advance] with oy from the
baseline, alpha zlib + base64). Noto Sans: SIL Open Font License 1.1 (tools/fonts-src/NotoSans-OFL.txt).
Centre-screen only: this atlas is never a cluster-render asset, so it costs no cluster pixel memory.
"""
import base64, json, os, zlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = [('td_u19', 'apps/twin_dial/hud/fonts/td_u19.json'), ('td_tab', 'apps/twin_dial/hud/fonts/td_tab.json')]
OUT = os.path.join(ROOT, 'kit', 'runtime', 'fonts', 'cyrillic.json')


def size_of(path):
    f = json.load(open(os.path.join(ROOT, path), encoding='utf-8'))
    raw = base64.b64decode(f['alpha'])
    assert len(raw) == f['width'] * f['height'], path
    glyphs = {}
    for ch, g in f['glyphs'].items():
        if len(ch) != 1:
            continue
        glyphs[str(ord(ch))] = [g['x'], g['y'], g['w'], g['h'], g['ox'], -f['baseline'], g['advance']]
    if '63' not in glyphs:
        raise SystemExit(path + ': no "?" glyph (the fallback)')
    return {'size': f['size'], 'ascent': f['baseline'], 'descent': f['cellHeight'] - f['baseline'], 'atlasW': f['width'],
            'atlasH': f['height'], 'glyphs': glyphs, 'alpha': base64.b64encode(zlib.compress(raw, 9)).decode('ascii')}


def main():
    sizes = sorted((size_of(p) for _, p in SRC), key=lambda s: s['size'])
    out = {'family': 'cyrillic', 'source': 'NotoSans-wght.subset.ttf (SIL OFL 1.1), from ' + ', '.join(n for n, _ in SRC),
           'cacheKey': 'lncyr1', 'sizes': sizes}
    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(out, fh, separators=(',', ':'))
    print('%s: %d sizes (%s), %d glyphs, %d bytes' % (os.path.relpath(OUT, ROOT), len(sizes), ', '.join(str(s['size']) for s in sizes),
                                                      len(sizes[0]['glyphs']), os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
