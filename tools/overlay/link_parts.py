#!/usr/bin/env python3
"""Link the G20 parts into the catalogue: every element's 'parts' list, plus the elements only the parts have.

    python3 tools/overlay/link_parts.py          # patches design/overlay/g20_comfort.json in place

Reads design/overlay/g20_parts.json (written by tools/overlay/inventory_parts.py) and tools/overlay/parts_elements.json
(the new elements, judged by hand). Idempotent. It never changes an existing element's relation, evidence, bbox or poly:
it only sets 'parts' and appends the new elements (their bbox is the union of their parts' alpha extent).
tools/overlay/catalogue_g20.py and tools/overlay/inventory_parts.py call apply(), so either re-run keeps the links.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
G20 = os.path.join(ROOT, 'design', 'overlay', 'g20_comfort.json')
PARTS = os.path.join(ROOT, 'design', 'overlay', 'g20_parts.json')
NEW = os.path.join(ROOT, 'tools', 'overlay', 'parts_elements.json')
# the order of the keys in a catalogue element (schema g20Element), so new elements read like the others
ORDER = ['id', 'group', 'name', 'safety', 'bbox', 'poly', 'colour', 'states', 'relation', 'evidence', 'relation_basis',
         'schematic', 'measured_by', 'notes', 'parts']


def union(boxes):
    boxes = [b for b in boxes if b]
    if not boxes:
        return None
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def apply(doc, parts=None, new=None):
    """Sets e['parts'] on every element and appends the new elements. Returns the list of ids it added."""
    if parts is None:
        if not os.path.exists(PARTS):
            return []
        parts = json.load(open(PARTS))
    new = new if new is not None else (json.load(open(NEW)) if os.path.exists(NEW) else {'elements': []})
    recs = parts['parts']
    have = {e['id'] for e in doc['elements']}
    added = []
    for spec in new['elements']:
        if spec['id'] in have:
            continue                       # already there (a re-run): it is refreshed below like any element
        mine = [r for r in recs if r['element'] == spec['id'] and r.get('bbox')]
        bb = union([r['bbox'] for r in mine])
        if not bb:
            raise SystemExit('link_parts: new element %s has no part with a bbox' % spec['id'])
        e = dict(spec)
        e['bbox'] = [float(v) for v in bb]
        doc['elements'].append({k: e[k] for k in ORDER if k in e})
        have.add(spec['id'])
        added.append(spec['id'])
    # a new element's bbox follows its parts on every run (it is not measured on the photos)
    new_ids = {s['id'] for s in new['elements']}
    for e in doc['elements']:
        if e['id'] in new_ids:
            bb = union([r['bbox'] for r in recs if r['element'] == e['id'] and r.get('bbox')])
            if bb:
                e['bbox'] = [float(v) for v in bb]
        e['parts'] = [r['id'] for r in recs if r['element'] == e['id']]
    return added


def main():
    doc = json.load(open(G20))
    added = apply(doc)
    with open(G20, 'w') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write('\n')
    n = sum(len(e['parts']) for e in doc['elements'])
    print('link_parts: %d elements, %d part links, added %s' % (len(doc['elements']), n, ', '.join(added) or 'none'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
