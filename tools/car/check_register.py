#!/usr/bin/env python3
"""Check design/car/register.json and resolve its fields against the car's catalogue (read only, offline).

    python3 tools/car/check_register.py [--catalogue <someip-interfaces.json>] [--write]

Schema: unique ids, kind in L/P/X/F, status and evidence from the fixed vocabularies, every field a string
"<Interface>.<field>" (short interface name, or the full name when two share a short name) with an optional "@<instance>". With a catalogue (default: reference/car/2026-11-15/someip/
someip-interfaces.json, git-ignored) every field must resolve to ONE interface by its short name and exist there; the
flags a declaration may use (r needs a NON-ZERO getter id, s needs a notifier) and the ids are reported, and an instance
must be one the catalogue lists. --write puts the resolved table (names, ids and flags only) in
design/car/register_fields.json.  Exit 0 when everything passes, 1 otherwise.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
KINDS = 'LPXF'
STATUS = {'open', 'answered', 'partly-answered', 'needs-lead-decision', 'needs-owner-approval', 'out-of-session'}
EVID = {'arrives', 'arrives-other-app', 'not sent', 'unseen', 'n/a'}


def find_catalogue(arg):
    if arg:
        return arg
    for base in (ROOT, os.environ.get('F30_MAIN', '')):
        if not base:
            continue
        p = os.path.join(base, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json')
        if os.path.exists(p):
            return p
    return None


def main(argv):
    cat_path = None
    write = False
    i = 1
    while i < len(argv):
        if argv[i] == '--catalogue':
            cat_path = argv[i + 1]
            i += 1
        elif argv[i] == '--write':
            write = True
        i += 1
    reg = json.load(open(os.path.join(ROOT, 'design', 'car', 'register.json')))
    bad = 0

    def fail(msg):
        nonlocal bad
        bad += 1
        print('  FAIL ' + msg)

    seen = set()
    for it in reg['items']:
        if it['id'] in seen:
            fail(it['id'] + ': duplicate id')
        seen.add(it['id'])
        if it['kind'] not in KINDS or not it['id'].startswith(it['kind']):
            fail(it['id'] + ': kind ' + it['kind'])
        if it['status'] not in STATUS:
            fail(it['id'] + ': status ' + it['status'])
        if it['evidence'] not in EVID:
            fail(it['id'] + ': evidence ' + it['evidence'])
        for k in ('question', 'title', 'decides', 'source', 'blocks', 'fields', 'steps'):
            if k not in it:
                fail(it['id'] + ': missing ' + k)
        if it['status'] in ('answered', 'partly-answered') and not it.get('answer'):
            fail(it['id'] + ': answered without an answer citation')
        if not it['source']:
            fail(it['id'] + ': no source')
        for f in it['fields']:
            if '.' not in f:
                fail(it['id'] + ': field ' + f)
    print('items: %d, kinds: %s' % (len(reg['items']), {k: sum(1 for x in reg['items'] if x['kind'] == k) for k in KINDS}))

    cat_path = find_catalogue(cat_path)
    table = {}
    if not cat_path:
        print('  (no catalogue found: fields not resolved)')
    else:
        cat = json.load(open(cat_path))
        ifs = cat['interfaces']
        inst_ids = cat.get('instanceIDs', {})
        by_short = {}
        for full in ifs:
            by_short.setdefault(full.split('.')[-1], []).append(full)
        for it in reg['items']:
            for f in it['fields']:
                name, _, inst = f.partition('@')
                short, _, fld = name.rpartition('.')[0], '', name.rpartition('.')[2]
                cands = [short] if short in ifs else by_short.get(short, [])
                if len(cands) != 1:
                    fail(it['id'] + ': ' + f + ': ' + ('%d interfaces named %s' % (len(cands), short)))
                    continue
                full = cands[0]
                d = ifs[full].get('fields', {}).get(fld)
                if d is None:
                    fail(it['id'] + ': ' + f + ': no such field in ' + full)
                    continue
                g = (d.get('getter') or {}).get('id') or 0
                n = (d.get('notifier') or {}).get('id') or 0
                flag = ('r' if g else '') + ('s' if n else '')
                if not flag:
                    fail(it['id'] + ': ' + f + ': neither a getter nor a notifier id (cannot be read)')
                known = inst_ids.get(full, {})
                if inst and inst not in known and inst not in [str(v) for v in known.values()]:
                    fail(it['id'] + ': ' + f + ': instance ' + inst + ' not in ' + json.dumps(known))
                key = full.split('.')[-1] + '.' + fld
                e = table.setdefault(key, {'interface': full, 'field': fld, 'flags': flag, 'getter': g, 'notifier': n,
                                           'instances': known, 'items': []})
                if inst and inst not in e.setdefault('used_instances', []):
                    e['used_instances'].append(inst)
                if it['id'] not in e['items']:
                    e['items'].append(it['id'])
        print('fields resolved: %d distinct' % len(table))
        if write:
            out = os.path.join(ROOT, 'design', 'car', 'register_fields.json')
            json.dump({'_about': 'Catalogue-resolved fields of design/car/register.json: names, ids and the flags a '
                                 'declaration may use (r = non-zero getter id, s = notifier). Made by tools/car/check_register.py.',
                       'fields': table}, open(out, 'w'), indent=1, sort_keys=True)
            print('wrote ' + os.path.relpath(out, ROOT))
    print('register OK' if not bad else '%d problems' % bad)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
