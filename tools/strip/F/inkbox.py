#!/usr/bin/env python3
"""Ink boxes of every text widget of the 6WB layouts, computed the way the engine draws them (shared/hud_text.js
mask(): the glyph cell's top at the box top, the pen from the box's alignment, each glyph at round(pen + ox), rows
past the box clipped; a "gpu" text the same with h = min(box h, cell height), shared/hud.js _gpuGrid).

    python3 tools/strip/F/inkbox.py <layouts dir> <fonts dir> [--json out.json]

Plain Python 3, no numpy (the atlases are small). For a widget whose text is a token the string drawn is a sample
(SAMPLE below), so its horizontal ink depends on that sample; the vertical ink (what a font re-bake moves) does not
depend on it beyond which glyphs it uses. Every box is panel px, half-open [x0, y0, x1, y1]; "clip" counts the
ink rows the box cuts off. The car's own words (road label, message) are measured a second time with a Cyrillic
sample (CAR), made-up words that exercise the tallest and lowest glyphs, never a real place.
Package F, 2026-11-16 (docs/strip/F-REPORT.md)."""
import base64, json, math, os, re, sys

LAYOUTS = ('wb_comfort', 'wb_dials', 'wb_sport', 'wb_sport_dials', 'wb_eco')
SAMPLE = {'range': '467', 'time': '23:59', 'ambient1': '+22.5', 'u:temp': '°C', 'u:distLc': 'km', 'limit': '50',
          'mode': 'COMFORT', 'gear': 'D4', 'stage': 'D', 'road': 'Hauptstrasse', 'ccName': 'Tyre pressure',
          'ccDesc': 'Check the tyre pressure.', 'ccHead': 'Tyre pressure', 'speed': '188', 'cons': '7.5'}
# Й Ї Ґ: the tallest capitals; Щ Ц Д: the capitals that reach below the baseline; « » № – ’ ʼ: the punctuation asked for
CAR = {'road': 'ЙЇҐ Щуцдй', 'ccName': 'ЇҐЙ щільність', 'ccDesc': '«№ 3» – ЩЦД’ʼ', 'ccHead': 'ЇҐЙ «№ 3» – ЩЦД’ʼ'}

_fonts = {}


def font(fonts, name):
    key = (fonts, name)
    if key not in _fonts:
        m = json.load(open(os.path.join(fonts, name + '.json')))
        m['_a'] = base64.b64decode(m['alpha'])
        _fonts[key] = m
    return _fonts[key]


def glyph(f, ch):
    g = f['glyphs'].get(ch)
    return g if g else f['glyphs'].get(' ', {'x': 0, 'y': 0, 'w': 0, 'h': 0, 'ox': 0, 'advance': 0})


def js_round(v):
    return math.floor(v + 0.5)


def ink(fonts, w, s):
    """Ink box of string s in widget w, panel px, and the number of ink rows the box clips."""
    f = font(fonts, w['font'])
    W, H = w['w'], w['h']
    if w.get('gpu'):
        H = min(H, f['cellHeight'])
    sp = w.get('spacing', 0) or 0
    width = sum(glyph(f, c)['advance'] + (sp if i < len(s) - 1 else 0) for i, c in enumerate(s))
    al = w.get('align', 'left')
    pen = W - width if al == 'right' else js_round((W - width) / 2) if al == 'center' else 0
    x0 = y0 = 10 ** 9
    x1 = y1 = -10 ** 9
    clipped = set()
    for c in s:
        g = glyph(f, c)
        gx = js_round(pen + g['ox'])
        for y in range(g['h']):
            row = (g['y'] + y) * f['width'] + g['x']
            for x in range(g['w']):
                if not f['_a'][row + x]:
                    continue
                if y >= H or not (0 <= gx + x < W):
                    clipped.add(y)
                    continue
                x0, x1 = min(x0, gx + x), max(x1, gx + x + 1)
                y0, y1 = min(y0, y), max(y1, y + 1)
        pen += g['advance'] + sp
    if x1 < 0:
        return None, len(clipped)
    ty = (w.get('textY') or 0) if w.get('ccLine') else 0      # strip integration: the message line's cell sits at textY
    return [w['x'] + x0, w['y'] + ty + y0, w['x'] + x1, w['y'] + ty + y1], len(clipped)


def resolve(t, tab):
    return re.sub(r'\{\{([a-zA-Z0-9:]+)\}\}', lambda m: tab.get(m.group(1), m.group(1)), t)


def table(layouts, fonts):
    out = {}
    for name in LAYOUTS:
        L = json.load(open(os.path.join(layouts, name + '.json')))
        rows = {}
        for w in L['widgets']:
            if w.get('type') != 'text':
                continue
            s = resolve(w['text'], SAMPLE)
            box, clip = ink(fonts, w, s)
            f = font(fonts, w['font'])
            ty = (w.get('textY') or 0) if w.get('ccLine') else 0
            r = {'font': w['font'], 'box': [w['x'], w['y'], w['w'], w['h']], 'baseline': w['y'] + ty + f['baseline'],
                 'text': w['text'], 'ink': box, 'clip': clip}
            toks = re.findall(r'\{\{([a-zA-Z0-9:]+)\}\}', w['text'])
            if any(t in CAR for t in toks):
                car = resolve(w['text'], dict(SAMPLE, **CAR))
                r['inkCar'], r['clipCar'] = ink(fonts, w, car)
                r['missingCar'] = len(set(c for c in car if c != ' ' and c not in f['glyphs']))
            rows[w['id']] = r
        out[name] = rows
    return out


if __name__ == '__main__':
    t = table(sys.argv[1], sys.argv[2])
    if '--json' in sys.argv:
        json.dump(t, open(sys.argv[sys.argv.index('--json') + 1], 'w'), indent=1, ensure_ascii=False)
    for name, rows in t.items():
        for id_, r in rows.items():
            car = ('  car %s clip %d missing %d' % (r['inkCar'], r['clipCar'], r['missingCar'])) if 'inkCar' in r else ''
            print('%-15s %-11s %-8s box %-22s base %4d ink %-24s clip %d%s' % (
                name, id_, r['font'], r['box'], r['baseline'], r['ink'], r['clip'], car))
