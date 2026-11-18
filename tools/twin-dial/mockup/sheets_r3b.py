#!/usr/bin/env python3
"""KC (round 3b): the choice sheets the owner decides from, the night sheet, and index.html.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/mockup/sheets_r3b.py

One page per decision (S1 .. S6), the variants side by side, labelled in Ukrainian, with the cost of each from KA's and KB's
reports (docs/twin-dial/r3b/{KA,KB}-REPORT.md: the numbers are copied into COSTS below, with their source). Everything is cut
from our own pictures: no reference pixel on any sheet (the comparison sheets of compare_r3b.py are separate, git-ignored,
labelled "reference, not ours").
"""
import html
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
WORK = os.path.join(ROOT, 'bake', 'work', 'twin-dial')
MOCK = os.path.join(WORK, 'mockup')
KC = os.path.join(MOCK, 'r3b', 'kc')
FONTS = os.path.join(WORK, 'refs', 'vt-fonts', 'notosans', 'NotoSans[wdth,wght].ttf')
BG, FG, DIM, ACC = (18, 19, 21), (236, 236, 236), (150, 152, 158), (240, 170, 10)
_F = {}


def font(size, bold=False):
    k = (size, bold)
    if k not in _F:
        f = ImageFont.truetype(FONTS, size)
        try:
            f.set_variation_by_axes([100, 700 if bold else 450])
        except Exception:
            pass
        _F[k] = f
    return _F[k]


def wrap(d, text, f, maxw):
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=f) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def load(path):
    return Image.open(path).convert('RGB')


def tile(path, crop=None, width=None):
    im = load(path)
    if crop:
        im = im.crop(crop)
    if width and im.width != width:
        im = im.resize((width, int(round(im.height * width / im.width))), Image.LANCZOS)
    return im


def sheet(title, question, columns, path, tile_w=760, cols=None, foot=None, margin=36):
    """columns: list of dicts {img: PIL image (already cropped), id, label, status, cost, note}. Laid out in rows of `cols`."""
    cols = cols or min(len(columns), 3)
    d0 = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    gap = 28
    W = margin * 2 + cols * tile_w + (cols - 1) * gap
    cells = []
    for c in columns:
        im = c['img']
        im = im.resize((tile_w, int(round(im.height * tile_w / im.width))), Image.LANCZOS)
        lines = [(c.get('id', '') + '  ' + c['label']).strip()]
        sub = []
        if c.get('status'):
            sub += wrap(d0, 'Дані: ' + c['status'], font(19), tile_w)
        if c.get('cost'):
            sub += wrap(d0, 'Ціна: ' + c['cost'], font(19), tile_w)
        if c.get('note'):
            sub += wrap(d0, c['note'], font(19), tile_w)
        cells.append((im, lines[0], sub))
    rows = [cells[i:i + cols] for i in range(0, len(cells), cols)]
    head_lines = wrap(d0, question, font(26), W - 2 * margin)
    head_h = 28 + 52 + 34 * len(head_lines) + 22
    foot_lines = wrap(d0, foot, font(21), W - 2 * margin) if foot else []
    row_hs = []
    for r in rows:
        row_hs.append(max(im.height + 8 + 30 + 24 * len(sub) for im, _, sub in r) + 26)
    H = head_h + sum(row_hs) + (30 + 28 * len(foot_lines) if foot_lines else 10)
    out = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(out)
    d.text((margin, 24), title, font=font(40, True), fill=FG)
    y = 24 + 56
    for ln in head_lines:
        d.text((margin, y), ln, font=font(26), fill=ACC)
        y += 34
    y = head_h
    for r, rh in zip(rows, row_hs):
        for k, (im, cap, sub) in enumerate(r):
            x = margin + k * (tile_w + gap)
            out.paste(im, (x, y))
            d.rectangle([x - 1, y - 1, x + im.width, y + im.height], outline=(70, 72, 78))
            yy = y + im.height + 8
            d.text((x, yy), cap, font=font(23, True), fill=FG)
            yy += 30
            for s in sub:
                d.text((x, yy), s, font=font(19), fill=DIM)
                yy += 24
        y += rh
    for ln in foot_lines:
        d.text((margin, y + 8), ln, font=font(21), fill=FG)
        y += 28
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path)
    return out


def index_html(path, entries, sheets, checks_path):
    """Every picture, sheet and check result, linked (paths relative to the file)."""
    rel = lambda p: os.path.relpath(p, os.path.dirname(path))
    chk = {}
    try:
        chk = json.load(open(checks_path))
    except Exception:
        pass
    fails = {}
    for s, r in chk.get('sets', {}).items():
        for f, v in r.items():
            fails[os.path.join(s, f)] = v['failed']
    h = ['<!doctype html><meta charset="utf-8"><title>Twin Dial r3b - KC</title>',
         '<style>body{background:#121315;color:#ececec;font:15px/1.4 system-ui,sans-serif;margin:24px}a{color:#7fb7ff}'
         'h2{margin-top:32px}table{border-collapse:collapse}td,th{padding:3px 10px;border-bottom:1px solid #333;text-align:left;vertical-align:top}'
         '.f{color:#ff7a7a}.o{color:#7fdc8a}.n{color:#c8c8c8}img{max-width:320px;display:block}</style>',
         '<h1>Twin Dial round 3b: pictures, sheets, checks</h1>', '<h2>Choice sheets</h2><ul>']
    for s in sheets:
        h.append('<li><a href="%s">%s</a></li>' % (rel(s), html.escape(os.path.basename(s))))
    h.append('</ul><p><a href="checks.json">checks.json</a> | <a href="compare.json">compare.json</a> | <a href="../../../../../../docs/twin-dial/r3b/KC-REPORT.md">KC-REPORT.md</a></p>')
    h.append('<h2>Every picture</h2><table><tr><th>set</th><th>picture</th><th>what</th><th>checks</th></tr>')
    for e in entries:
        f = fails.get(os.path.join(e['set'], e['rel']))
        status = '<span class="n">not checked</span>' if f is None else ('<span class="f">FAIL: %s</span>' % ', '.join(f) if f else '<span class="o">pass</span>')
        h.append('<tr><td>%s</td><td><a href="%s">%s</a></td><td>%s</td><td>%s</td></tr>' % (
            e['set'], rel(e['path']), html.escape(e['id']), html.escape(e.get('caption', '')), status))
    h.append('</table>')
    open(path, 'w').write('\n'.join(h))
