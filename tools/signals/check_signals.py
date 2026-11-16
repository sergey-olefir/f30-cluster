#!/usr/bin/env python3
"""Check an app's app.json "signals" against the car's SOME/IP catalogue, the way the installer will (read only).

    python3 tools/signals/check_signals.py <someip-interfaces.json> [apps/<id>/app.json ...]

Every interface, field, method and broadcast declared in "signals" becomes an interface config at install time
(MainApp's IFConfigGenerator, kit/tools/oapgen/gen.js). A declaration the generator cannot satisfy aborts the WHOLE
install, and the Store only ever shows UPDATE_FAILED. The rules, verified on the car (2026-11-16):

  r  the field needs a getter whose id is NON-ZERO: {"id": 0} counts as no getter ("Requested read for <field> but no
     getter available": what blocked f30_cluster 0.7.16 four times)
  s  a notifier whose id is non-zero
  w  a setter whose id is non-zero
  _methods     each one a method of that interface, with a non-zero methodId
  _broadcasts  each one an event (or a field with a notifier) of that interface
  _instances   an instance the catalogue's instanceIDs lists for that interface (default "1"; "*" = any)

Exit 0 when everything passes, 1 otherwise. Prints one line per declaration.
"""
import json
import sys


def check(cat, app_path):
    ifs, inst_ids = cat.get('interfaces', {}), cat.get('instanceIDs', {})
    spec = json.load(open(app_path))
    bad = 0

    def say(okay, what):
        nonlocal bad
        if not okay:
            bad += 1
        print(('  ok   ' if okay else '  FAIL ') + what)

    print(app_path)
    for iface, fields in spec.get('signals', {}).items():
        it = ifs.get(iface)
        if it is None:
            say(False, iface + ': not in the catalogue')
            continue
        if not isinstance(fields, dict):
            say(True, iface + ': whole interface (' + repr(fields) + ')')
            continue
        inst = str(fields.get('_instances', '1'))
        known = inst_ids.get(iface, {})
        say(inst == '*' or inst in known or inst in [str(v) for v in known.values()],
            iface + ': instance ' + inst + ' (catalogue: ' + json.dumps(known) + ')')
        cf = it.get('fields', {})
        for f, flags in fields.items():
            if f.startswith('_'):
                continue
            d = cf.get(f)
            if d is None:
                say(False, iface + '.' + f + ': no such field')
                continue
            for flag, key in (('r', 'getter'), ('s', 'notifier'), ('w', 'setter')):
                if flag in flags:
                    i = (d.get(key) or {}).get('id')
                    say(bool(i), iface + '.' + f + ' "' + flag + '": ' + key + ' id ' + repr(i))
            extra = set(flags) - set('rsw')
            if extra:
                say(False, iface + '.' + f + ': unknown flag(s) ' + ''.join(sorted(extra)))
        for m in fields.get('_methods', []) or []:
            d = it.get('methods', {}).get(m)
            say(bool(d and d.get('methodId')), iface + ' method ' + m + ': methodId ' + repr(d and d.get('methodId')))
        for b in fields.get('_broadcasts', []) or []:
            e = it.get('events', {}).get(b) or it.get('broadcasts', {}).get(b)
            fe = cf.get(b)
            i = (e or {}).get('id') or (e or {}).get('eventId') or ((fe or {}).get('notifier') or {}).get('id')
            say(bool(e or i), iface + ' broadcast ' + b + ': ' + ('event' if e else 'field notifier') + ' id ' + repr(i))
    return bad


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    cat = json.load(open(argv[0]))
    apps = argv[1:] or ['apps/f30_cluster/app.json']
    bad = sum(check(cat, a) for a in apps)
    print(('FAILED: ' + str(bad) + ' declaration(s) the installer would refuse') if bad else 'all declarations pass')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
