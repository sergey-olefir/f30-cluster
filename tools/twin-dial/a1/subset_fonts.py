#!/usr/bin/env python3
"""Twin Dial fonts (package A1, 2026-11-17): the two SIL OFL faces of SPEC 9, cut down to what the app draws.

    UV_CACHE_DIR=... uv run -q --no-project --with fonttools --with pillow python -I tools/twin-dial/a1/subset_fonts.py [<dir with saira/ and notosans/>]

In:  bake/work/twin-dial/refs/vt-fonts/{saira,notosans}/ (git-ignored; the Google Fonts ofl/ tree, URLs in
     tools/fonts-src/SOURCES.json). Out: tools/fonts-src/Saira[wdth,wght].ttf and NotoSans-wght.subset.ttf.

Both stay variable (the bake picks weight and width by axis). Only glyphs and axis ranges are removed; no outline is
touched, no name is changed (neither licence declares a Reserved Font Name), so the OFL allows it and the licences ship
beside the files.
  Saira: Basic Latin, Latin-1, Latin Extended-A/B (our labels and digits; it never draws Cyrillic, SPEC 9), wght 400-700, wdth 100-125.
  Noto Sans: that, plus Cyrillic (U+0400-04FF), General Punctuation, the number sign, the minus, and everything in
  tools/bake_fonts.py CAR_TEXT (Ukrainian, Russian, Belarusian, the Latin accents, U+02BC); wdth pinned to 100,
  wght 400-600 (the app bakes 500).
"""
import os, sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import bake_fonts  # CAR_TEXT

LATIN = list(range(0x20, 0x250)) + [0x2009, 0x200A, 0x202F, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2022, 0x2026, 0x2032, 0x2033, 0x2212, 0x00D7, 0x00B0, 0x00B7, 0x2116, 0x2190, 0x2191, 0x2192, 0x2193]
CYR = list(range(0x400, 0x500))
PUNCT = list(range(0x2000, 0x2070))
CAR = [ord(c) for c in bake_fonts.CAR_TEXT]


def cut(src, dst, unicodes, limits):
    f = TTFont(src)
    opts = subset.Options()
    opts.layout_features = ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'tnum', 'lnum']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = False
    opts.drop_tables += ['DSIG']
    s = subset.Subsetter(opts)
    s.populate(unicodes=sorted(set(unicodes)))
    s.subset(f)
    f.save(dst)
    f = instancer.instantiateVariableFont(TTFont(dst), limits)      # axis ranges cut after the glyphs (the other order trips fontTools)
    f.save(dst)
    print('%-44s %7d bytes  %4d codepoints' % (os.path.basename(dst), os.path.getsize(dst), len(TTFont(dst).getBestCmap())))


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'refs', 'vt-fonts')
    out = os.path.join(ROOT, 'tools', 'fonts-src')
    cut(os.path.join(src, 'saira', 'Saira[wdth,wght].ttf'), os.path.join(out, 'Saira[wdth,wght].ttf'), LATIN,
        {'wght': (400, 700), 'wdth': (100, 125)})
    cut(os.path.join(src, 'notosans', 'NotoSans[wdth,wght].ttf'), os.path.join(out, 'NotoSans-wght.subset.ttf'),
        LATIN + CYR + PUNCT + CAR, {'wght': (400, 600), 'wdth': 100})
