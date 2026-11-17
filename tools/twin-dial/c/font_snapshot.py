#!/usr/bin/env python3
"""Package C (round 2): snapshot the cell height, baseline and glyph advances of the Twin Dial atlases that the layout
generator (design/gen_twin.py) and bench/test-twin-layout.js place text with, into design/twin-dial/c/font_metrics.json.

    python3 tools/twin-dial/c/font_snapshot.py [fonts dir]      (default apps/twin_dial/hud/fonts)

The snapshot is only the generator's fallback while the atlases are not in the tree (package A1's bake); when they are,
gen_twin.py reads them and bench/test-twin-layout.js checks that the snapshot and the atlases still agree."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
FONTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'apps', 'twin_dial', 'hud', 'fonts')
OUT = os.path.join(ROOT, 'design', 'twin-dial', 'c', 'font_metrics.json')
NAMES = ['td_big', 'td_gear', 'td_label', 'td_title', 'td_val', 'td_body', 'td_row', 'td_tab', 'td_u19', 'td_u20', 'td_u21', 'td_msg', 'td_cnt',
         'td_scale_l', 'td_scale_s', 'td_tach']
# the characters the layout draws (every string of design/gen_twin.py and shared/twin_tokens.js) and the digits
CHARS = ''.join(chr(c) for c in range(0x20, 0x7f)) + 'ВАЕЗКМПСТабвгдезиіїклмнопрстуфхцчшщьюяєґ' + 'ø°× –ʼ’…№'
out = {'_about': 'snapshot of the Twin Dial atlases (tools/twin-dial/c/font_snapshot.py): cellHeight, baseline, advance per character the layout can draw', 'fonts': {}}
for n in NAMES:
    f = json.load(open(os.path.join(FONTS, n + '.json')))
    g = f['glyphs']
    out['fonts'][n] = {'source': f['source'], 'size': f['size'], 'cellHeight': f['cellHeight'], 'baseline': f['baseline'],
                       'advance': {c: g[c]['advance'] for c in CHARS if c in g}}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=0, sort_keys=True)
print('wrote', OUT, len(out['fonts']), 'fonts')
