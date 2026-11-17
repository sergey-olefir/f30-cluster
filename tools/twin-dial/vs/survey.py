#!/usr/bin/env python3
"""Package VS (twin-dial round 1): survey the car's SOME/IP catalogue for the signals the new cluster's content needs.

    python3 -I tools/twin-dial/vs/survey.py <someip-interfaces.json> [--fields FIELDS.json] [--search] [--json out.json]

Read only, standard library, nothing talks to the car. The catalogue is BMW's file (git-ignored, reference/car/...);
this tool prints field names, ids, member names and enum item names only, never writes any of it into a tracked file
except through --json, whose output belongs under bake/work/.

For every (interface, field) in FIELDS.json (default: fields.json next to this script) it prints:
  - the service id, the instance ids, the field's getter / notifier / setter ids and the flags an app.json may use
    (r only with a NON-ZERO getter id, s only with a non-zero notifier id; "w" is never proposed),
  - the field's data type expanded member by member (structs, unions, typedefs, arrays, enums with their items).
With --search it also prints every field in the whole catalogue whose interface, field, member or enum item names
match each topic's pattern (TOPICS below), with its flags, so a better field than the one picked is not missed.
"""
import json
import os
import re
import sys

PRIM = {'UInt8', 'UInt16', 'UInt32', 'UInt64', 'Int8', 'Int16', 'Int32', 'Int64', 'Bool', 'Float', 'Double',
        'String', 'ByteBuffer', 'Utf8D', 'Utf16D', 'Utf8', 'Utf16'}

TOPICS = {
    'odometer': r'mileage|odometer|kilomet|km_?stand|wegstrecke',
    'trip': r'bordcomputer|travel|ride_?duration|way_?passed|trip',
    'average': r'average|durchschnitt|consumption_?average|speed_?average',
    'fuel': r'fluid_?level_?fuel|fuel_?tank|tank_?status|range_?tank|reserve',
    'coolant': r'engine_?temperature|coolant|temperature_?engine|engine_?temperature_?evaluated',
    'date': r'time_?date|date_?time|show_?time|display_?date|current_?time_?zone',
    'doors': r'door|lid|bonnet|hood|tailgate|trunk|boot|klappe|tuer|haube|panel_?status|window|sunroof|shd',
    'media': r'media_?source|active_?source|now_?playing|track|title|artist|album|station|tuner|entertainment_?source|audio_?source',
    'phone': r'call_?state|phone_?state|telephon|caller|active_?call',
    'battery': r'battery|batterie|voltage|spannung|bordnetz|bordnet',
    'cc': r'cc_?message|cc_?list|check_?control|ccm|menu_?cc|active_?cc|displayed_?cc',
    'icview': r'ic_?widget|ic_?graphical|kombi_?selection|instrument_?pack|visual_?context|graphical_?context|ic_?view|cluster_?view',
}


def snake(s):
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])', '_', s).lower()


class Cat:
    def __init__(self, path):
        c = json.load(open(path))
        self.I, self.D, self.inst = c['interfaces'], c['datatypes'], c.get('instanceIDs', {})

    @staticmethod
    def ids(d):
        g = (d.get('getter') or {}).get('id')
        n = (d.get('notifier') or {}).get('id')
        s = (d.get('setter') or {}).get('id')
        flags = ('r' if g else '') + ('s' if n else '')
        return g, n, s, flags

    def expand(self, ref, name='(value)', depth=0, seen=(), out=None):
        """Lines (indent, name, kind, detail) of one datatype, recursively."""
        out = [] if out is None else out
        pad = depth
        if ref in PRIM or ref not in self.D:
            out.append((pad, name, 'prim', ref))
            return out
        t = self.D[ref]
        k = t.get('type')
        if ref in seen or depth > 7:
            out.append((pad, name, k, ref.split('.')[-1] + ' (recursive / deep, not expanded)'))
            return out
        seen = seen + (ref,)
        if k == 'enum':
            items = sorted(t.get('items', {}).items(), key=lambda kv: kv[1])
            out.append((pad, name, 'enum', ref.split('.')[-1] + ': ' + ', '.join('%s=%s' % kv for kv in items)))
        elif k in ('struct', 'union'):
            out.append((pad, name, k, ref.split('.')[-1]))
            for m in t.get('members', []):
                self.expand(m['dataRef'], m['name'], depth + 1, seen, out)
        elif k == 'typedef':
            self.expand(t['dataRef'], name + ' (typedef ' + ref.split('.')[-1] + ')', depth, seen, out)
        elif k == 'array':
            self.expand(t.get('dataRef') or t.get('elementDataRef'), name + '[]', depth, seen, out)
        elif k == 'map':
            out.append((pad, name, 'map', '%s -> %s' % (t.get('keyDataRef'), t.get('valueDataRef'))))
        else:
            out.append((pad, name, str(k), ref))
        return out

    def names(self, ref, seen=()):
        """Every member name and enum item name reachable from a datatype (for --search)."""
        if ref in PRIM or ref not in self.D or ref in seen:
            return []
        t, seen = self.D[ref], seen + (ref,)
        r = [ref.split('.')[-1]]
        if t.get('type') == 'enum':
            r += list(t.get('items', {}))
        for m in t.get('members', []) or []:
            r.append(m['name'])
            r += self.names(m['dataRef'], seen)
        for key in ('dataRef', 'elementDataRef', 'valueDataRef'):
            if t.get(key):
                r += self.names(t[key], seen)
        return r


def field_report(cat, iface, field):
    it = cat.I.get(iface)
    if it is None:
        return {'iface': iface, 'field': field, 'error': 'interface not in the catalogue'}
    d = it.get('fields', {}).get(field)
    if d is None:
        ev = (it.get('events') or {}).get(field)
        if ev is None:
            return {'iface': iface, 'field': field, 'error': 'no such field or event'}
        return {'iface': iface, 'field': field, 'event': ev, 'serviceId': it.get('serviceId')}
    g, n, s, flags = cat.ids(d)
    return {
        'iface': iface, 'field': field, 'serviceId': it.get('serviceId'), 'instances': cat.inst.get(iface),
        'getter': g, 'notifier': n, 'setter': s, 'flags': flags, 'dataRef': d.get('dataRef'),
        'zeroGetter': g == 0, 'reliable': (d.get('getter') or {}).get('reliable'),
        'type': [list(x) for x in cat.expand(d.get('dataRef'))],
    }


def search(cat, topic, pat):
    rx = re.compile(pat, re.I)
    hits = []
    for iname, it in cat.I.items():
        for f, d in (it.get('fields') or {}).items():
            words = [iname.split('.')[-1], f] + cat.names(d.get('dataRef', ''))
            m = [w for w in words if rx.search(snake(w)) or rx.search(w)]
            if m:
                g, n, s, flags = cat.ids(d)
                hits.append({'iface': iname, 'field': f, 'getter': g, 'notifier': n, 'setter': s,
                             'flags': flags or '-', 'match': sorted(set(m))[:6]})
    return hits


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    cat = Cat(argv[0])
    here = os.path.dirname(os.path.abspath(__file__))
    fpath = argv[argv.index('--fields') + 1] if '--fields' in argv else os.path.join(here, 'fields.json')
    wanted = json.load(open(fpath))
    out = {'fields': [], 'search': {}}
    for group in wanted['groups']:
        print('\n######## ' + group['name'] + ' — ' + group.get('why', ''))
        for iface, field in group['fields']:
            r = field_report(cat, iface, field)
            r['group'] = group['name']
            out['fields'].append(r)
            if 'error' in r:
                print('  !! %s.%s: %s' % (iface, field, r['error']))
                continue
            if 'event' in r:
                print('  == %s.%s: EVENT %s' % (iface, field, json.dumps(r['event'])))
                continue
            zero = '  ZERO GETTER: "r" forbidden' if r['zeroGetter'] else ''
            print('  == %s . %s   service %s inst %s   getter %r notifier %r setter %r  -> flags "%s"%s' % (
                iface, field, r['serviceId'], json.dumps(r['instances']), r['getter'], r['notifier'], r['setter'],
                r['flags'], zero))
            for pad, name, kind, det in r['type']:
                print('       ' + '  ' * pad + '%-40s %-7s %s' % (name, kind, det))
    if '--search' in argv:
        for topic, pat in TOPICS.items():
            hits = search(cat, topic, pat)
            out['search'][topic] = hits
            print('\n======== search %s (%s): %d fields' % (topic, pat, len(hits)))
            for h in hits:
                print('  %-4s %s . %s  g%r n%r  %s' % (h['flags'], h['iface'], h['field'], h['getter'], h['notifier'],
                                                       ', '.join(h['match'])))
    if '--json' in argv:
        json.dump(out, open(argv[argv.index('--json') + 1], 'w'), indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
