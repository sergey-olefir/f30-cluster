"""Package O, brief item 2: the box each of OUR row texts can ever fill, from the baked fonts' own metrics
(apps/f30_cluster/hud/fonts/<font>.json) and the layout's widget boxes, laid out exactly as shared/hud_text.js mask()
lays them out (pen from the alignment, Math.round((boxW - width) / 2) when centred, each glyph at round(pen + ox),
its cell w wide; ink = the glyph cells, the conservative bound). Prints the ink box of the widest string per field.

    python3 tools/strip/O/widest.py [layout]
"""
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')
FONTS = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'fonts')
# the candidates per field: every string the field can show that could be the widest (digits are tabular in wb_row)
CANDIDATES = {
    'own_range': ['9999', '999', '---'],
    'own_range_u': ['km', 'mi'],
    'own_clock': ['23:59', '00:00', '11:59', '--:--'],
    'own_temp': ['-40.0', '-9.5', '+40.0', '+24.0', '---'],
    'own_temp_u': ['°C', '°F'],
}


def glyphs(font):
    return json.load(open(os.path.join(FONTS, font + '.json')))


def layout_ink(text, w, f):
    g = f['glyphs']
    sp = w.get('spacing') or 0
    missing = [c for c in text if c not in g]
    gl = [g.get(c) or g.get(' ') or {'w': 0, 'ox': 0, 'advance': 0, 'h': 0} for c in text]
    width = sum(x['advance'] for x in gl) + sp * (len(gl) - 1)
    al = w.get('align')
    pen = (w['w'] - width) if al == 'right' else (int((w['w'] - width) / 2.0 + 0.5) if al == 'center' else 0)
    x0, x1 = None, None
    for x in gl:
        a = int(round(pen + x['ox']))
        if x['w']:
            x0 = a if x0 is None else min(x0, a)
            x1 = a + x['w'] if x1 is None else max(x1, a + x['w'])
        pen += x['advance'] + sp
    return width, x0, x1, missing


def main():
    lay = sys.argv[1] if len(sys.argv) > 1 else 'wb_dials'
    L = json.load(open(os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts', lay + '.json')))
    out = {}
    for w in L['widgets']:
        if w.get('type') != 'text' or w['y'] + w['h'] <= 540:
            continue
        f = glyphs(w['font'])
        rows = []
        for s in CANDIDATES.get(w['id'], []):
            width, a, b, miss = layout_ink(s, w, f)
            rows.append({'text': s, 'advance_px': width, 'ink': None if a is None else [w['x'] + max(a, 0), w['y'], w['x'] + min(b, w['w']), w['y'] + w['h']],
                         'overflows_box': width > w['w'], 'missing_glyphs': miss})
        if not rows:
            # free text (road label, message): hud.js _fitText cuts it to the box with "...", so the widest is the box
            rows.append({'text': '(free text, cut to fit with "...")', 'advance_px': w['w'], 'ink': [w['x'], w['y'], w['x'] + w['w'], w['y'] + w['h']]})
        widest = max(rows, key=lambda r: (r['ink'][2] - r['ink'][0]) if r['ink'] else -1)
        out[w['id']] = {'font': w['font'], 'size': f['size'], 'cellHeight': f['cellHeight'], 'baseline_panel_y': w['y'] + f['baseline'] + (w.get('offsetY') or 0),
                        'box': [w['x'], w['y'], w['x'] + w['w'], w['y'] + w['h']], 'align': w.get('align'), 'anchor': {'right': 'right edge', 'center': 'centre', 'left': 'left edge'}.get(w.get('align'), 'left edge'),
                        'widest': widest, 'candidates': rows}
        print('%-12s %-7s box %-22s align %-6s baseline y %-4s widest %-8r ink %s' % (w['id'], w['font'], out[w['id']]['box'], w.get('align'), out[w['id']]['baseline_panel_y'], widest['text'][:8], widest['ink']))
    json.dump(out, open(os.path.join(ROOT, 'design', 'strip', 'O', 'widest_%s.json' % lay), 'w'), indent=1)


if __name__ == '__main__':
    main()
