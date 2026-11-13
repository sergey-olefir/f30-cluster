#!/usr/bin/env python3
"""Find the speed-limit / no-overtaking field in a copy of the car's SOME/IP catalogue (read only, standard library).

    python3 tools/signals/find_limit.py <someip-interfaces.json> [--all] [--json out.json]

The catalogue is the head unit's /etc/oap/someip/someip-interfaces.json (scripts/find_limit_signal.sh copies it
over SSH, read only). Its shape, as kit/tools/sigdoc.py and check_signals.py of cauliflowermossgrape/idrive7-apps
read it: { interfaces: { <iface>: { serviceId, fields: { <field>: { dataRef, getter: { id }, notifier } },
methods, events } }, datatypes: { <ref>: { type: struct | enum | typedef | array, members, extends, items,
dataRef, baseType, elementDataRef } }, instanceIDs: { <iface>: ... } }.

Every field whose interface, field, member, enum type or enum item name looks like a traffic sign, a speed limit or
no overtaking is listed with its getter / notifier (the app.json flag it needs), its instance, the matching member
paths and its enum items, ranked. The top ones get a ready-to-paste app.json "signals" entry and a config.limit /
config.nopass skeleton. Nothing here talks to the car.
"""
import json
import re
import sys

# name patterns, weight: the sign itself first, then the systems that carry it
TERMS = [
    (r'speed_?limit_?info', 10),
    (r'traffic_?sign|road_?sign|verkehrs_?zeichen|sign_?recogn|(^|_)tsr(_|$)|(^|_)vz[eo](_|$)', 9),
    (r'overtak|no_?passing|passing_?(ban|prohib|restrict)|ueberhol|uberhol', 9),
    (r'speed_?limit|limit_?speed|max_?speed|speed_?max|allowed_?speed|legal_?speed|limit_?value|posted', 7),
    (r'derestrict|aufhebung|end_?of_?(limit|restriction)|unlimited|no_?limit', 6),
    (r'speed_?info|limit_?info|sign_?info|sign_?type|zeichen', 5),
    (r'kafas|camera_?sign|fas_?info|driver_?assist|fahrerassist', 3),
    (r'limiter|speed_?control|cruise|acc_?set|set_?speed|speed_?assist', 2),
]
RX = [(re.compile(p, re.I), w) for p, w in TERMS]
# "SLI" (Speed Limit Info) only as its own word in camelCase / snake_case: never inside "slip" or "slider"
RX += [(re.compile(r'(^|[a-z0-9_.])(SLI|Sli)([A-Z0-9_.]|$)'), 10), (re.compile(r'^sli([A-Z0-9_]|$)'), 10)]
# BMW's own words, from the ID4-6 car data service (BimmerGestalt/IDriveConnectKit CDSProperty.kt): sliActualSpeedLimitInfo,
# sliNextSpeedLimitRecognition, trafficSignInfo1..4, orInfo / orNPITextMessage (No Passing Info), signRecognitionFrontCamera
RX += [(re.compile(r'(^|[a-z0-9_.])(NPI|Npi)([A-Z0-9_.]|$)|^npi([A-Z0-9_]|$)|no_?passing_?info'), 10),
       (re.compile(r'(^|[_.])or(Info|NPI|Npi)|[a-z0-9]OR(Info|NPI|Npi|_)|^OR(Info|NPI|_)'), 8),
       (re.compile(r'sign_?recognition|traffic_?sign_?info', re.I), 9)]
MAX_DEPTH = 6


def score(name):
    s = 0
    for rx, w in RX:
        if rx.search(name or ''):
            s = max(s, w)
    return s


class Cat:
    def __init__(self, db):
        self.db = db
        self.types = db.get('datatypes') or {}

    def resolve(self, ref, seen=None):
        """(kind, detail) of a data ref: ('struct', members) | ('enum', items) | ('array', elem) | ('prim', name)."""
        seen = seen or set()
        d = self.types.get(ref) if isinstance(ref, str) else None
        if not isinstance(d, dict) or ref in seen:
            return 'prim', str(ref)
        seen = seen | {ref}
        t = d.get('type')
        if t == 'struct':
            mem, dd, guard = [], d, 0
            while isinstance(dd, dict) and guard < 10:
                mem = list(dd.get('members') or []) + mem
                ext = dd.get('extends')
                if not ext:
                    break
                dd = self.types.get(ext)
                guard += 1
            return 'struct', mem
        if t == 'enum':
            items = d.get('items') or {}
            return 'enum', items if isinstance(items, dict) else {str(i): i for i in items}
        if t == 'typedef':
            return self.resolve(d.get('dataRef', d.get('baseType')), seen)
        if t == 'array':
            return 'array', d.get('elementDataRef')
        if t in ('union', 'variant'):
            return 'struct', list(d.get('members') or [])
        return 'prim', str(t or ref)

    def walk(self, ref, path=(), depth=0, seen=frozenset()):
        """Yield (path, kind, detail, typename) for the value and every member under it."""
        kind, det = self.resolve(ref)
        yield path, kind, det, ref
        if depth >= MAX_DEPTH or ref in seen:
            return
        if kind == 'struct':
            for m in det:
                if isinstance(m, dict):
                    yield from self.walk(m.get('dataRef'), path + (m.get('name', '?'),), depth + 1, seen | {ref})
        elif kind == 'array':
            yield from self.walk(det, path + ('[]',), depth + 1, seen | {ref})


def flag(fd):
    g = bool((fd.get('getter') or {}).get('id')) if isinstance(fd.get('getter'), dict) else bool(fd.get('getter'))
    n = bool(fd.get('notifier'))
    return ('r' if g else '') + ('s' if n else ''), g, n


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    show_all = '--all' in argv
    out_json = argv[argv.index('--json') + 1] if '--json' in argv else None
    with open(argv[1], encoding='utf-8') as f:
        db = json.load(f)
    cat = Cat(db)
    inst = db.get('instanceIDs') or {}
    hits = []
    for iface, i in (db.get('interfaces') or {}).items():
        if not isinstance(i, dict):
            continue
        si = score(iface)
        for field, fd in (i.get('fields') or {}).items():
            if not isinstance(fd, dict):
                continue
            sf = score(field)
            paths, enums, sub = [], [], 0
            for p, kind, det, tname in cat.walk(fd.get('dataRef')):
                sm = max(score(p[-1]) if p else 0, score(tname if isinstance(tname, str) else ''))
                se = 0
                if kind == 'enum':
                    se = max([score(str(k)) for k in det] + [0])
                if sm or se:
                    paths.append(('.'.join(p) or '(value)', kind, tname, sm, se))
                    if kind == 'enum':
                        enums.append(('.'.join(p) or '(value)', tname, det))
                sub = max(sub, sm, se)
            total = max(si, sf, sub) * 10 + si + sf + sub + min(len(paths), 5)
            if max(si, sf, sub) >= (1 if show_all else 3):
                fl, g, n = flag(fd)
                hits.append(dict(iface=iface, field=field, serviceId=i.get('serviceId'), instance=inst.get(iface),
                                 flag=fl, getter=g, notifier=n, score=total, iface_score=si, field_score=sf,
                                 paths=paths, enums=enums, type=fd.get('dataRef')))
    hits.sort(key=lambda h: -h['score'])
    print('catalogue: %d interfaces; %d candidate fields' % (len(db.get('interfaces') or {}), len(hits)))
    print('flag: r = has a getter (read once at start), s = has a notifier (changes). app.json needs "s" (or "rs").')
    print('instance: the app subscribes instance "1" (kit car.js); another instance needs a code change.\n')
    for n, h in enumerate(hits):
        print('%2d. [%d] %s . %s   flag "%s"%s   service %s, instance %s   type %s' % (
            n + 1, h['score'], h['iface'], h['field'], h['flag'] or '-',
            '' if h['notifier'] else '  (NO NOTIFIER: unusable as "s")', h['serviceId'], h['instance'], h['type']))
        for p, kind, tname, sm, se in h['paths'][:12]:
            print('      %-48s %-6s %s' % (p, kind, tname))
        for p, tname, items in h['enums'][:4]:
            it = ', '.join('%s=%s' % (k, v) for k, v in list(items.items())[:40])
            print('      enum %s (%s): %s%s' % (p, tname, it, ' ...' if len(items) > 40 else ''))
    top = [h for h in hits if h['notifier']][:3]
    if top:
        print('\nTo try the best candidate (check its members above first), app.json:')
        h = top[0]
        num = next((p for p, kind, t, sm, se in h['paths'] if kind == 'prim' and sm), None)
        print('  "signals": { %s: { %s: "%s" } }' % (json.dumps(h['iface']), json.dumps(h['field']), 'rs' if h['getter'] else 's'))
        print('  "config": { "limit": { "iface": %s, "field": %s, "path": %s, "factor": 1, "unit": "kmh", '
              '"invalid": [0], "end": [] } }' % (json.dumps(h['iface']), json.dumps(h['field']),
                                                    json.dumps([] if not num or num == '(value)' else num.split('.'))))
        print('  then read "speed limit raw: ..." in the app log while driving past signs (docs/POLISH-E-REPORT.md).')
    if out_json:
        with open(out_json, 'w', encoding='utf-8') as f:
            json.dump(hits, f, indent=1, default=str)
        print('\nwritten', out_json)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
