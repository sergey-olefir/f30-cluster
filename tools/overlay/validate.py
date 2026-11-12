#!/usr/bin/env python3
"""Validate the overlay map files against design/overlay/schema.json, plus the checks a schema cannot express.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with jsonschema python tools/overlay/validate.py [files...]

With no arguments it checks every *.json in design/overlay/ and design/overlay/sample/ (except schema.json).
Exit status 1 if any file has an error. Warnings do not fail.
"""
import hashlib
import json
import os
import sys

import jsonschema

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DIR = os.path.join(ROOT, 'design', 'overlay')
PANEL_W, PANEL_H = 1920, 720
SLACK = 2  # px a bbox may poke past the panel edge (measurement noise)
CRITICAL_OK = {'reveal', 'redraw'}


def rel(p):
    return os.path.relpath(p, ROOT)


def sha256(path):
    with open(path, 'rb') as f:
        return 'sha256:' + hashlib.sha256(f.read()).hexdigest()


def check_bbox(where, b, errs):
    x0, y0, x1, y1 = b
    if not (x1 > x0 and y1 > y0):
        errs.append('%s: bbox %s is empty or inverted' % (where, b))
    if x0 < -SLACK or y0 < -SLACK or x1 > PANEL_W + SLACK or y1 > PANEL_H + SLACK:
        errs.append('%s: bbox %s leaves the 1920x720 panel' % (where, b))


def check_g20(doc, errs, warns):
    seen = set()
    for e in doc['elements']:
        i = e['id']
        if i in seen:
            errs.append('duplicate id %s' % i)
        seen.add(i)
        check_bbox(i, e['bbox'], errs)
        if e.get('poly'):
            xs = [p[0] for p in e['poly']]
            ys = [p[1] for p in e['poly']]
            b = e['bbox']
            if min(xs) < b[0] - 1 or max(xs) > b[2] + 1 or min(ys) < b[1] - 1 or max(ys) > b[3] + 1:
                errs.append('%s: poly is not inside its bbox' % i)
        if e['relation'] != 'unknown' and not e['relation_basis']:
            errs.append('%s: relation %s without relation_basis' % (i, e['relation']))
        if e['relation'] != 'unknown' and e['evidence'] == 'none':
            errs.append('%s: relation %s with evidence none' % (i, e['relation']))
        for b in e['relation_basis']:
            if b['photo'] not in doc['photos'] and not doc.get('sample'):
                warns.append('%s: basis photo %s not listed in photos' % (i, b['photo']))
        for s in e['states']:
            if s['photo'] not in doc['photos'] and not doc.get('sample'):
                warns.append('%s: state photo %s not listed in photos' % (i, s['photo']))
        sch = e.get('schematic')
        if sch and not os.path.exists(os.path.join(ROOT, sch)):
            errs.append('%s: schematic %s missing' % (i, sch))
        if sch and not sch.startswith('design/overlay/'):
            errs.append('%s: schematic must live in design/overlay/' % i)
    # the 'parts' links (tools/overlay/link_parts.py) must match design/overlay/g20_parts.json, both ways
    pp = os.path.join(DIR, 'g20_parts.json')
    if not doc.get('sample') and any('parts' in e for e in doc['elements']):
        if not os.path.exists(pp):
            errs.append("elements have 'parts' but %s is missing" % rel(pp))
        else:
            recs = {r['id']: r for r in json.load(open(pp)).get('parts', [])}
            for e in doc['elements']:
                if 'parts' not in e:
                    errs.append("%s: no 'parts' list (run tools/overlay/link_parts.py)" % e['id'])
                    continue
                for p in e['parts']:
                    if p not in recs:
                        errs.append('%s: part %s not in g20_parts.json' % (e['id'], p))
                    elif recs[p]['element'] != e['id']:
                        errs.append('%s: part %s belongs to %s' % (e['id'], p, recs[p]['element']))
                want = [r for r, v in recs.items() if v['element'] == e['id']]
                if sorted(want) != sorted(e['parts']):
                    errs.append('%s: parts %s, g20_parts.json says %s' % (e['id'], e['parts'], want))
    return seen


def check_parts(doc, errs, warns):
    """kind g20-parts (tools/overlay/inventory_parts.py): ids, files, links, coverage of the manifest and the scene."""
    recs = doc['parts']
    ids = [r['id'] for r in recs]
    R = {r['id']: r for r in recs}
    for i in sorted({i for i in ids if ids.count(i) > 1}):
        errs.append('duplicate part id %s' % i)
    cat = json.load(open(os.path.join(DIR, 'g20_comfort.json')))
    E = {e['id'] for e in cat['elements']}
    unresolved = {u['part'] for u in doc['report'].get('unresolved', [])}
    for r in recs:
        i = r['id']
        el = r['element']
        if (el is None or el not in E) and i not in unresolved:
            errs.append('%s: element %r is not in g20_comfort.json and not listed in report.unresolved' % (i, el))
        if el is not None and el in E and i in unresolved:
            warns.append('%s: listed as unresolved but %s is in the catalogue' % (i, el))
        if r['file'] and not os.path.exists(os.path.join(ROOT, r['file'])):
            errs.append('%s: file %s missing' % (i, r['file']))
        if r['procedural'] and not os.path.exists(os.path.join(ROOT, r['procedural']['module'])):
            errs.append('%s: module %s missing' % (i, r['procedural']['module']))
        if r['render'] in ('font', 'data'):
            if r['bbox'] is not None:
                errs.append('%s: %s has a bbox' % (i, r['render']))
        elif r['bbox'] is None:
            (warns if r['render'] == 'live' else errs).append('%s: no bbox%s' % (i, ' (not measured: run inventory_parts.py with Chrome)' if r['render'] == 'live' else ''))
        else:
            check_bbox(i, r['bbox'], errs)
        if r['render'] == 'raster' and not r['file'].endswith('.png'):
            errs.append('%s: a raster part must be a PNG' % i)
        if r['render'] in ('procedural', 'live') and not r['procedural']:
            errs.append('%s: %s part without "procedural"' % (i, r['render']))
        m = r.get('measured')
        if r['render'] in ('procedural', 'live') and not m:
            warns.append('%s: not measured (run inventory_parts.py with Chrome)' % i)
        if m and m.get('fallback'):
            warns.append('%s: cannot be drawn alone: %s' % (i, m['fallback']))
        for b in r.get('baked_from', []):
            if b not in R:
                errs.append('%s: baked_from %s is not a part' % (i, b))
            elif i not in R[b].get('baked_into', []):
                errs.append('%s: baked_from %s, but %s does not list it in baked_into' % (i, b, b))
        for b in r.get('baked_into', []):
            if b not in R or i not in R[b].get('baked_from', []):
                errs.append('%s: baked_into %s without the matching baked_from' % (i, b))
        for c in r.get('covers', []):
            if c['element'] not in E:
                errs.append('%s: covers %s, not in the catalogue' % (i, c['element']))
        if r['source'] == 'sim' and r['file'] and not r['file'].startswith('bench/g20/'):
            errs.append('%s: a simulation file outside bench/g20/' % i)
    # every manifest entry and every app G20 / collar scene texture has a record
    man = os.path.join(ROOT, 'bench', 'g20', 'manifest.json')
    if os.path.exists(man):
        for e in json.load(open(man))['entries']:
            if e['id'] not in R:
                errs.append('manifest entry %s has no part record' % e['id'])
            elif R[e['id']]['element'] != e['element']:
                errs.append('%s: element %s, the manifest says %s' % (e['id'], R[e['id']]['element'], e['element']))
    else:
        warns.append('bench/g20/manifest.json missing: manifest coverage not checked')
    sd = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'scene')
    if os.path.isdir(sd):
        for f in sorted(os.listdir(sd)):
            if f.endswith('.json') and (f.startswith('g20_') or f == 'collar.json') and 'app.' + f[:-5] not in R:
                errs.append('scene texture %s has no part record' % f)
    else:
        warns.append('the app scene folder is missing: scene coverage not checked')
    for i in doc['report'].get('elements_without_parts', []):
        warns.append('catalogue element %s has no part: we would still have to draw it' % i)


def check_wb(doc, errs, warns):
    seen = set()
    anchors = {a['id'] for a in doc['anchors']}
    for e in doc['elements']:
        i = e['id']
        if i in seen:
            errs.append('duplicate id %s' % i)
        seen.add(i)
        check_bbox(i, e['bbox'], errs)
        if e['anchor'] and e['anchor'] not in anchors:
            errs.append('%s: anchor %s not defined in anchors' % (i, e['anchor']))
        m = e.get('mask')
        if m:
            p = os.path.join(ROOT, m)
            if not os.path.exists(p):
                errs.append('%s: mask %s missing' % (i, m))
            else:
                try:
                    from PIL import Image  # optional
                    w, h = Image.open(p).size
                    bw, bh = round(e['bbox'][2] - e['bbox'][0]), round(e['bbox'][3] - e['bbox'][1])
                    if (w, h) != (bw, bh):
                        errs.append('%s: mask is %dx%d, bbox is %dx%d' % (i, w, h, bw, bh))
                except ImportError:
                    pass
    return seen


def check_plan(doc, path, errs, warns):
    d = os.path.dirname(path)
    for k in ('g20', 'wb'):
        b = doc['based_on'][k]
        f = os.path.join(ROOT, b['file'])
        if not os.path.exists(f):
            warns.append('based_on.%s: %s not found' % (k, b['file']))
            continue
        if sha256(f) != b['sha256']:
            warns.append('based_on.%s: %s changed since the plan was saved' % (k, b['file']))
        ref = json.load(open(f))
        ids = {e['id'] for e in ref['elements']}
        plan_ids = set(doc[k].keys())
        for missing in sorted(plan_ids - ids):
            warns.append('%s.%s: not in %s' % (k, missing, b['file']))
        if k == 'g20':
            for e in ref['elements']:
                p = doc['g20'].get(e['id'])
                if not p:
                    warns.append('g20.%s: no decision' % e['id'])
                    continue
                if e['relation'] == 'over' and p['decision'] != 'keep-clear':
                    errs.append('g20.%s: relation over needs decision keep-clear, not %s' % (e['id'], p['decision']))
                if e['safety'] == 'critical' and e['relation'] in ('under', 'gone') and p['decision'] not in CRITICAL_OK:
                    errs.append('g20.%s: critical and %s, decision %s leaves it hidden' % (e['id'], e['relation'], p['decision']))
                if e['relation'] == 'gone' and p['decision'] in ('reveal', 'cover'):
                    warns.append('g20.%s: gone, so %s does nothing' % (e['id'], p['decision']))
    for h in doc['holes']:
        check_bbox('hole ' + h['id'], h['rect'], errs)
    for c in doc['keep_clear']:
        check_bbox('keep_clear ' + c['id'], c['rect'], errs)


def main(argv):
    schema = json.load(open(os.path.join(DIR, 'schema.json')))
    jsonschema.Draft202012Validator.check_schema(schema)
    v = jsonschema.Draft202012Validator(schema)
    files = argv or sorted(
        [os.path.join(DIR, f) for f in os.listdir(DIR) if f.endswith('.json') and f != 'schema.json'] +
        [os.path.join(DIR, 'sample', f) for f in os.listdir(os.path.join(DIR, 'sample')) if f.endswith('.json')])
    bad = 0
    for path in files:
        path = os.path.abspath(path)
        errs, warns = [], []
        try:
            doc = json.load(open(path))
        except Exception as ex:  # noqa: BLE001
            print('FAIL %s: not JSON (%s)' % (rel(path), ex))
            bad += 1
            continue
        if not isinstance(doc, dict) or 'kind' not in doc:
            # not one of ours (e.g. a helper file such as expected_conflicts.json)
            print('skip %s (no "kind")' % rel(path))
            continue
        kind = doc.get('kind')
        sub = {'g20-elements': 'g20File', 'wb-elements': 'wbFile', 'plan': 'planFile', 'constraints': 'constraintsFile',
               'g20-parts': 'partsFile'}.get(kind)
        if not sub:
            errs.append('unknown kind %r' % kind)
        else:
            sv = jsonschema.Draft202012Validator({'$ref': '#/$defs/' + sub, '$defs': schema['$defs']})
            for e in sorted(sv.iter_errors(doc), key=lambda e: list(e.absolute_path)):
                errs.append('schema: /%s: %s' % ('/'.join(str(p) for p in e.absolute_path), e.message[:300]))
            if not errs:
                if kind == 'g20-elements':
                    check_g20(doc, errs, warns)
                elif kind == 'wb-elements':
                    check_wb(doc, errs, warns)
                elif kind == 'plan':
                    check_plan(doc, path, errs, warns)
                elif kind == 'g20-parts':
                    check_parts(doc, errs, warns)
        assert v  # the top-level oneOf is for editors; per-kind validation above gives clearer messages
        n = len(doc.get('elements', [])) if isinstance(doc.get('elements'), list) else ''
        if kind == 'g20-parts' and isinstance(doc.get('parts'), list):
            n = '%d parts' % len(doc['parts'])
        status = 'FAIL' if errs else 'ok  '
        print('%s %s (%s%s)' % (status, rel(path), kind, (', %s elements' % n if isinstance(n, int) else ', ' + n) if n != '' else ''))
        for e in errs:
            print('   error:', e)
        for w in warns[:40]:
            print('   warn: ', w)
        if len(warns) > 40:
            print('   warn:  ... %d more' % (len(warns) - 40))
        bad += bool(errs)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
