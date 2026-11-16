"""Package T: run tools/strip/T/glyphs.py over a field list and write the glyph tables (numbers only) to
bake/work/strip/T/meas/<photo>_<field>.json.

The field list (bake/work/strip/T/fields.json, git-ignored because it holds the strings read off the photos) is
{field: {"ink": "light"|"dark", "box": [x0, y0, x1, y1], "photos": {photo: "transcription" | null}}}; a photo may
override the box with {"box": [...], "text": "..."}.

    uv run ... python -I tools/strip/T/batch.py [--fields <json>] [--only clock,range] [--photos 61,62] [--thr 0.5]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import glyphs as G  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fields', default=os.path.join(C.ROOT, 'bake', 'work', 'strip', 'T', 'fields.json'))
    ap.add_argument('--only', default=None)
    ap.add_argument('--photos', default=None)
    ap.add_argument('--thr', type=float, default=0.5)
    ap.add_argument('--n', type=float, default=8)
    ap.add_argument('--prefer', default=None)
    ap.add_argument('--tag', default='')
    a = ap.parse_args()
    fields = json.load(open(a.fields))
    out = os.path.join(C.ROOT, 'bake', 'work', 'strip', 'T', 'meas')
    os.makedirs(out, exist_ok=True)
    for name, f in fields.items():
        if name.startswith('_') or (a.only and name not in a.only.split(',')):
            continue
        for ph, spec in f['photos'].items():
            if a.photos and ph not in a.photos.split(','):
                continue
            box, text = f['box'], spec
            if isinstance(spec, dict):
                box, text = spec.get('box', box), spec.get('text')
            try:
                r = G.field(ph, box, a.n, f.get('ink', 'light'), a.prefer, a.thr)
            except SystemExit as e:
                print(name, ph, 'skipped:', e)
                continue
            r['field'], r['text'] = name, text
            fn = os.path.join(out, '%s_%s%s.json' % (ph, name, a.tag))
            json.dump(r, open(fn, 'w'), indent=1)
            print('%-10s %s %-14s %2d glyphs  black %.4f plateau %.3f  -> %s'
                  % (name, ph, r['model'], len(r['glyphs']), r['black'], r['plateau'], os.path.basename(fn)))


if __name__ == '__main__':
    main()
