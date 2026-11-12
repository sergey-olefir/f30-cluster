#!/usr/bin/env python3
"""Package F (overlay constructor): relation, evidence and photo basis for every stock G20 element.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project python tools/overlay/relations_g20.py

Reads tools/overlay/relations_g20.json (the judgement per element, see its $comment) and patches
design/overlay/g20_comfort.json in place: relation, evidence, relation_basis (photos 10-14, plus any extra rows),
safety (where reviewed) and a 'F: ...' sentence in notes. Idempotent. tools/overlay/catalogue_g20.py calls apply()
at its end, so re-running the catalogue keeps package F's results.

How a basis row is built for photo p in 10..14 (each field can be overridden per photo in the JSON):
    seen                     the element's state in p: lit true -> true, lit false -> false (spot visible, nothing
                             there), lit null -> false in 11-13 (not visible at its spot), null in 10/14 (covered)
    our_pixels_opaque_there  opaque_default[p] (11-13 opaque full-panel backdrop; 10 transparent grid; 14 text only)
    lit_expected             'static' items: true; lamps: the per-photo value given, else null (state unknown)
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REL = os.path.join(ROOT, 'tools', 'overlay', 'relations_g20.json')
G20 = os.path.join(ROOT, 'design', 'overlay', 'g20_comfort.json')
BASIS_PHOTOS = ['10', '11', '12', '13', '14']
MARK = ' | F: '


def strip_hint(notes):
    if notes.startswith('F: '):
        return ''
    notes = notes.split(MARK)[0]
    i = notes.find('Hint for F:')
    return notes[:i].rstrip() if i >= 0 else notes


def apply(doc, rel=None):
    rel = rel or json.load(open(REL))
    od = rel['opaque_default']
    for pid, (_, why) in od.items():
        ph = doc['photos'].get(pid)
        if ph is not None:
            ph['note'] = ph['note'].split(MARK)[0] + MARK + 'our pixels: ' + why
    missing = []
    for e in doc['elements']:
        r = rel['elements'].get(e['id'])
        if r is None:
            missing.append(e['id'])
            continue
        states = {s['photo']: s for s in e['states']}
        basis = list(r.get('extra_basis', []))
        for pid in BASIS_PHOTOS:
            st = states.get(pid, {'lit': None})
            seen = r.get('seen', {}).get(pid, 'auto')
            if seen == 'auto':
                seen = True if st['lit'] is True else False if st['lit'] is False else (False if pid in ('11', '12', '13') else None)
            opaque = r.get('opaque', {}).get(pid, od[pid][0])
            lit = r.get('lit')
            lit_expected = True if lit == 'static' else (lit or {}).get(pid)
            row = {'photo': pid, 'seen': seen, 'our_pixels_opaque_there': opaque, 'lit_expected': lit_expected}
            note = r.get('note', {}).get(pid) or st.get('note')
            if note:
                row['note'] = note
            basis.append(row)
        basis.sort(key=lambda b: b['photo'])
        e['relation'] = r['relation']
        e['evidence'] = r['evidence']
        e['relation_basis'] = basis
        if r.get('safety'):
            e['safety'] = r['safety']
        extra = ' '.join(x for x in (r.get('notes_add'), r.get('safety_note')) if x)
        base = strip_hint(e.get('notes', '')).strip()
        e['notes'] = ((base + MARK) if base else 'F: ') + '%s (%s): %s' % (r['relation'], r['evidence'], r['reason']) \
            + ((' ' + extra) if extra else '')
    if missing:
        raise SystemExit('relations_g20.json has no entry for: ' + ', '.join(missing))
    extra_ids = set(rel['elements']) - {e['id'] for e in doc['elements']}
    if extra_ids:
        print('warning: relations for unknown ids:', ', '.join(sorted(extra_ids)))
    return doc


def main():
    doc = json.load(open(G20))
    apply(doc)
    with open(G20, 'w') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write('\n')
    from collections import Counter
    print('relations:', dict(Counter(e['relation'] for e in doc['elements'])),
          'evidence:', dict(Counter(e['evidence'] for e in doc['elements'])))
    for e in doc['elements']:
        print('%-26s %-8s %-7s %-9s %s' % (e['id'], e['relation'], e['evidence'], e['safety'], e['notes'].split('F: ')[-1][:110]))


if __name__ == '__main__':
    sys.exit(main())
