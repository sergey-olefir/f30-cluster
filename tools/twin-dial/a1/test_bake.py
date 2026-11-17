#!/usr/bin/env python3
"""Checks of the font bake (package A1). Run by bench/test-twin-fonts.js, or by hand:

    UV_CACHE_DIR=... uv run -q --no-project --with numpy --with pillow --with fonttools python -I tools/twin-dial/a1/test_bake.py

1. stretch 1.0 is the old path: every committed atlas of f30_cluster is reproduced byte for byte;
2. stretch 1.06 widens digits by 1.06 (advance and ink) and changes no height;
3. the twin_dial atlases on disk are exactly what the bake writes now;
4. a Saira atlas refuses a Cyrillic character, and the Saira file has none to draw anyway.
"""
import base64, io, json, os, sys, tempfile, contextlib
from PIL import Image
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import bake_fonts as bf

fails = 0
def ok(c, what):
    global fails
    print(('  ok   ' if c else '  FAIL ') + what)
    if not c: fails += 1

def quiet(f, *a, **k):
    with contextlib.redirect_stdout(io.StringIO()):
        return f(*a, **k)

print('stretch 1.0 reproduces the committed f30_cluster atlases')
d = tempfile.mkdtemp()
bad = []
for spec in bf.FONTS['f30_cluster']:
    quiet(bf.bake, d, *spec)
    cp = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'fonts', spec[0] + '.json')
    if os.path.exists(cp) and open(cp).read() != open(os.path.join(d, spec[0] + '.json')).read(): bad.append(spec[0])
ok(not bad, 'all %d f30_cluster atlases identical%s' % (len(bf.FONTS['f30_cluster']), ' (differ: %s)' % bad if bad else ''))

print('stretch 1.06 widens, never heightens')
face = bf.TD_SAIRA
args = ('td_x', face[0], 92, '0123456789:', 0, face[1], None, '', None)
a = quiet(bf.bake, None, *args, 1.0)
b = quiet(bf.bake, None, *args, 1.06)
ok(a['cellHeight'] == b['cellHeight'] and a['baseline'] == b['baseline'], 'cell height %d and baseline %d unchanged' % (a['cellHeight'], a['baseline']))
r = b['glyphs']['0']['advance'] / a['glyphs']['0']['advance']
ok(abs(r - 1.06) < 0.01, 'digit advance x%.4f (%d -> %d)' % (r, a['glyphs']['0']['advance'], b['glyphs']['0']['advance']))
def ink_w(m, c):
    g = m['glyphs'][c]
    im = Image.frombytes('L', (m['width'], m['height']), base64.b64decode(m['alpha'])).crop((g['x'], g['y'], g['x'] + g['w'], g['y'] + g['h']))
    cols = [x for x in range(im.width) if max(im.crop((x, 0, x + 1, im.height)).tobytes()) > 127]
    return cols[-1] - cols[0] + 1
r = ink_w(b, '0') / ink_w(a, '0')
ok(abs(r - 1.06) < 0.025, "ink width of '0' x%.3f (%d -> %d px)" % (r, ink_w(a, '0'), ink_w(b, '0')))
ok(b.get('stretch') == 1.06 and 'stretch' not in a, 'the atlas records its stretch')

print('the twin_dial atlases are what the bake writes')
d = tempfile.mkdtemp()
for spec in bf.FONTS['twin_dial']: quiet(bf.bake, d, *spec)
bad = [s[0] for s in bf.FONTS['twin_dial'] if not os.path.exists(os.path.join(ROOT, 'apps', 'twin_dial', 'hud', 'fonts', s[0] + '.json')) or open(os.path.join(ROOT, 'apps', 'twin_dial', 'hud', 'fonts', s[0] + '.json')).read() != open(os.path.join(d, s[0] + '.json')).read()]
ok(not bad, 'all %d atlases identical to the committed files%s' % (len(bf.FONTS['twin_dial']), ' (differ: %s)' % bad if bad else ''))

print('Saira never gets Cyrillic')
try:
    bf._td(bf.TD_SAIRA, 'td_bad', 22, 'ABC' + 'Д'); refused = False
except ValueError:
    refused = True
ok(refused, 'baking a Cyrillic letter into a Saira atlas is refused')
cm = TTFont(os.path.join(bf.SRC, bf.TD_SAIRA[0])).getBestCmap()
ok(not [c for c in cm if 0x370 <= c <= 0x52F], 'the Saira file in tools/fonts-src has no Greek or Cyrillic glyph')
sa = [s for s in bf.FONTS['twin_dial'] if s[1] == bf.TD_SAIRA[0]]
ok(len(sa) == 7 and all(all(ord(c) in cm for c in s[3] if c != ' ') for s in sa), 'every character of the 7 Saira atlases is in the file')
print('\n%s' % ('FAILED %d' % fails if fails else 'python checks passed'))
sys.exit(1 if fails else 0)
