"""Package T: the metrics of OUR baked fonts, read from the atlases the car blits (apps/f30_cluster/hud/fonts/*.json),
measured the same way tools/strip/T/glyphs.py measures the photos (ink = coverage >= 0.5), and our row widgets'
ink boxes on the panel from the layout (apps/f30_cluster/hud/layouts/*.json) laid out exactly as shared/hud_text.js
does (box x, align by the summed advances, glyph cell at round(pen + ox), cell top at the box top).

Also renders a candidate (font file, size, [wght, wdth]) the way tools/bake_fonts.py bakes it, so a proposed bake
can be measured before anything is baked:  candidate(file, size, axes) -> same structure as atlas(name).

    python3 tools/strip/T/ours.py [--font wb_row ...]       (needs numpy; Pillow only for candidates)
"""
import argparse
import base64
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
FONTS = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'fonts')
SRC = os.path.join(ROOT, 'tools', 'fonts-src')
DIGITS = '0123456789'


def runs_1d(row):
    idx = np.flatnonzero(row)
    if not len(idx):
        return []
    br = np.flatnonzero(np.diff(idx) > 1)
    return list(np.r_[idx[br], idx[-1]] + 1 - np.r_[idx[0], idx[br + 1]])


def glyph_metrics(a, thr=0.5):
    """a: coverage 0..1 of one glyph cell (rows from the cell top). Ink box in cell px, half-open."""
    m = a >= thr
    if not m.any():
        return None
    ys, xs = np.where(m.any(1))[0], np.where(m.any(0))[0]
    y0, y1, x0, x1 = ys[0], ys[-1] + 1, xs[0], xs[-1] + 1
    g = m[y0:y1, x0:x1]
    h, w = g.shape
    rows = g[int(h * 0.25):max(int(h * 0.75), int(h * 0.25) + 1)]
    hr = [r for row in rows for r in runs_1d(row)]
    cols = g[:, int(w * 0.25):max(int(w * 0.75), int(w * 0.25) + 1)].T
    vr = [r for col in cols for r in runs_1d(col)]
    # sub-pixel extents from coverage (coverage = the inked fraction of a pixel): the first row (column) whose peak
    # coverage is >= 0.5 starts the box, moved out by the peak coverage of the row before it, and in by the shortfall
    # of its own
    def edge(prof, first):
        idx = np.flatnonzero(prof >= 0.5)
        if not len(idx):
            return None
        if first:
            i = idx[0]
            return i + 0.5 - (prof[i] - 0.5) - (prof[i - 1] if i > 0 else 0.0)
        i = idx[-1]
        return i + 0.5 + (prof[i] - 0.5) + (prof[i + 1] if i + 1 < len(prof) else 0.0)
    rmax, cmax = a.max(1), a.max(0)
    # coverage width of a vertical stroke: the summed coverage of each run (threshold 0.02) in the middle rows
    cw = []
    for row in a[y0 + int(h * 0.25):y0 + max(int(h * 0.75), int(h * 0.25) + 1)]:
        on = row > 0.02
        idx = np.flatnonzero(on)
        if not len(idx):
            continue
        br = np.flatnonzero(np.diff(idx) > 1)
        for s, e in zip(np.r_[idx[0], idx[br + 1]], np.r_[idx[br], idx[-1]] + 1):
            cw.append(float(row[s:e].sum()))
    return {'x0': int(x0), 'x1': int(x1), 'y0': int(y0), 'y1': int(y1),
            'sx0': edge(cmax, True), 'sx1': edge(cmax, False), 'sy0': edge(rmax, True), 'sy1': edge(rmax, False),
            'stem_h': float(np.median(hr)) if hr else None, 'stem_v': float(np.median(vr)) if vr else None,
            'stem_cov': float(np.median(cw)) if cw else None, 'area': float(a.sum())}


def atlas(name, gamma=1.0):
    f = json.load(open(os.path.join(FONTS, name + '.json')))
    W = f['width']
    al = np.frombuffer(base64.b64decode(f['alpha']), np.uint8).reshape(-1, W).astype(np.float32) / 255.0
    al = al ** gamma        # gamma 2.2: the light the display emits for a coverage blended in gamma space (hypothesis)
    out = {'name': name, 'source': f['source'], 'size': f['size'], 'cellHeight': f['cellHeight'],
           'baseline': f['baseline'], 'glyphs': {}}
    for c, g in f['glyphs'].items():
        rec = {'advance': g['advance'], 'ox': g['ox'], 'w': g['w']}
        if g['w']:
            cell = al[g['y']:g['y'] + g['h'], g['x']:g['x'] + g['w']]
            k = glyph_metrics(cell)
            if k:
                # relative to the pen (x) and the baseline (y, up negative): ink left = ox + x0
                rec.update({'ink_l': g['ox'] + k['sx0'], 'ink_r': g['ox'] + k['sx1'],
                            'top': k['sy0'] - f['baseline'], 'bottom': k['sy1'] - f['baseline'],
                            'stem_h': k['stem_cov'], 'stem_px': k['stem_h'], 'stem_v': k['stem_v']})
            rec['_cell'] = cell
        out['glyphs'][c] = rec
    return out


def candidate(file, size, axes=None, chars=DIGITS + ':+-.°CkmHxonП', gamma=1.0):
    """Render like tools/bake_fonts.py (Pillow, anchor 'ls', tabular digits at the widest digit's advance)."""
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype(os.path.join(SRC, file), size)
    if axes:
        font.set_variation_by_axes(list(axes))
    PAD = 2
    boxes = {c: font.getbbox(c, anchor='ls') for c in chars if c != ' '}
    top = min(b[1] for b in boxes.values())
    bottom = max(b[3] for b in boxes.values())
    height = bottom - top + 2 * PAD
    tab = max(font.getlength(d) for d in DIGITS if d in chars) if any(d in chars for d in DIGITS) else 0
    out = {'name': '%s@%s%s' % (file, size, axes), 'source': file, 'size': size, 'cellHeight': height,
           'baseline': PAD - top, 'glyphs': {}}
    for c in chars:
        adv = font.getlength(c)
        if c == ' ':
            out['glyphs'][c] = {'advance': round(adv), 'advance_exact': adv, 'ox': 0, 'w': 0}
            continue
        l, _, r, _ = boxes[c]
        w = r - l + 2 * PAD
        img = Image.new('L', (w, height), 0)
        ImageDraw.Draw(img).text((PAD - l, PAD - top), c, font=font, fill=255, anchor='ls')
        cell = (np.asarray(img, np.float32) / 255.0) ** gamma
        shift = (tab - adv) / 2 if c in DIGITS else 0
        ox = round(l - PAD + shift)
        rec = {'advance': round(tab if c in DIGITS else adv), 'advance_exact': (tab if c in DIGITS else adv),
               'ox': ox, 'w': w, '_cell': cell}
        k = glyph_metrics(cell)
        if k:
            rec.update({'ink_l': ox + k['sx0'], 'ink_r': ox + k['sx1'], 'top': k['sy0'] - out['baseline'],
                        'bottom': k['sy1'] - out['baseline'], 'stem_h': k['stem_cov'], 'stem_px': k['stem_h'],
                        'stem_v': k['stem_v']})
        out['glyphs'][c] = rec
    return out


def layout_ink(font, text, box_x, box_w, align, spacing=0.0):
    """Panel x of each glyph's ink [l, r) for a string in a text widget, as shared/hud_text.js lays it out."""
    gl = font['glyphs']
    chars = list(text)
    width = sum(gl[c]['advance'] for c in chars) + spacing * (len(chars) - 1)
    pen = (box_w - width) if align == 'right' else round((box_w - width) / 2) if align == 'center' else 0
    out = []
    for c in chars:
        g = gl[c]
        x0 = round(pen + g['ox'])
        if 'ink_l' in g:
            out.append((c, box_x + x0 - g['ox'] + g['ink_l'], box_x + x0 - g['ox'] + g['ink_r']))
        pen += g['advance'] + spacing
    return out


def summary(f):
    g = f['glyphs']
    digs = [g[d] for d in DIGITS if d in g and 'top' in g[d]]
    s = {'font': f['name'], 'size': f['size'], 'cellHeight': f['cellHeight'], 'baseline': f['baseline']}
    if digs:
        s['figure_h_flat'] = float(np.median([-g[d]['top'] for d in '1247' if d in g and 'top' in g[d]]))
        s['figure_h_round'] = float(np.median([-g[d]['top'] for d in '0368' if d in g and 'top' in g[d]]))
        s['digit_advance'] = g['0']['advance']
        s['digit_ink_w'] = {d: g[d]['ink_r'] - g[d]['ink_l'] for d in DIGITS if d in g and 'ink_l' in g[d]}
        s['stem_1'] = g['1'].get('stem_h') if '1' in g else None
        s['stem_digits_median'] = float(np.median([x['stem_h'] for x in digs if x.get('stem_h')]))
    for c, key in (('H', 'cap_h'), ('x', 'x_h'), ('o', 'o_h'), ('k', 'asc_h'), ('C', 'C_h')):
        if c in g and 'top' in g[c]:
            s[key] = -g[c]['top']
            s[key.replace('_h', '') + '_stem_h'] = g[c].get('stem_h')
    if 'H' in g and 'stem_h' in g['H']:
        s['stem_H'] = g['H']['stem_h']
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--font', action='append', default=[])
    a = ap.parse_args()
    for n in a.font or ['wb_row', 'wb_val', 'wb_cap', 'wb_capb']:
        print(json.dumps(summary(atlas(n))))


if __name__ == '__main__':
    main()
