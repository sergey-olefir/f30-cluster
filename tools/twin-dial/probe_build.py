#!/usr/bin/env python3
"""Switch the twin_dial app.json between the NORMAL build and the PROBE build (SPEC section 17.1).

    python3 tools/twin-dial/probe_build.py on     [--app apps/twin_dial/app.json] [--version X.Y.Z] [--out FILE]
    python3 tools/twin-dial/probe_build.py off    [--app apps/twin_dial/app.json] [--out FILE]
    python3 tools/twin-dial/probe_build.py status [--app ...]
    python3 tools/twin-dial/probe_build.py check  [--app ...] [--catalogue <someip-interfaces.json>]

The probe build is the normal app with
  * config.probe on (shared/twin_probe.js subscribes P1..P12 read-only and logs numbers, enums and text lengths), and
  * the extra interfaces and fields of apps/twin_dial/probe/probe.json added to "signals"
    (the normal build declares only SPEC section 11), and
  * "twin_probe.js" in "shared" (unless the normal build lists it already: SPEC 14.1 does, the file is inert while
    config.probe is off).
`on` records exactly what it added in app.json under "_probeBuild" so that `off` takes exactly that out again: the
file is re-written with json.dump (indent 2, key order kept), so a hand-formatted app.json changes layout, not content.
`--out FILE` writes the result there instead of into --app (the app.json itself stays as it is).
`check` runs tools/signals/check_signals.py on the current state (and on the other state, through a scratch copy), so
both blocks are proven in one go; it needs the car's catalogue (reference/car/2026-11-15/someip/someip-interfaces.json).

Read only, always: a flag other than r / s is never added, and a probe file with a setter, a method or a broadcast is
refused.
"""
import argparse
import copy
import json
import os
import subprocess
import sys
import tempfile
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
APP = os.path.join(ROOT, 'apps', 'twin_dial', 'app.json')
PROBE = os.path.join(ROOT, 'apps', 'twin_dial', 'probe', 'probe.json')
CATALOGUE = os.path.join(ROOT, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json')
CHECK = os.path.join(ROOT, 'tools', 'signals', 'check_signals.py')
MARK = '_probeBuild'


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f, object_pairs_hook=OrderedDict)


def dump(spec, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(spec, f, indent=2, ensure_ascii=False)
        f.write('\n')


def vet(probe):
    """The probe file may only read: r / s flags, no methods, no broadcasts, no setter-ish names."""
    for iface, fields in probe.get('signals', {}).items():
        if not isinstance(fields, dict):
            raise SystemExit('probe file: %s is not a field list' % iface)
        for k, v in fields.items():
            if k in ('_methods', '_broadcasts'):
                raise SystemExit('probe file: %s declares %s: the probe build calls nothing' % (iface, k))
            if k.startswith('_'):
                continue
            if not isinstance(v, str) or not v or set(v) - set('rs'):
                raise SystemExit('probe file: %s.%s has flags %r: only r and s are allowed' % (iface, k, v))
            if k.lower().startswith(('standardccmessage', 'extendedccmessage', 'newccmessage', 'operation', 'kombiselection', 'timedate')):
                raise SystemExit('probe file: %s.%s is a write or a message-injection field' % (iface, k))


def turn_on(spec, probe, version):
    if MARK in spec:
        return False
    vet(probe)
    mark = OrderedDict([('added', OrderedDict()), ('config', []), ('version', None), ('shared', False)])
    sigs = spec.setdefault('signals', OrderedDict())
    for iface, fields in probe.get('signals', {}).items():
        have = sigs.get(iface)
        rec = OrderedDict([('whole', have is None), ('fields', []), ('notes', []), ('flagsWas', OrderedDict())])
        if have is None:
            have = sigs[iface] = OrderedDict()
        elif not isinstance(have, dict):
            continue                                    # the app declares the whole interface: nothing to add
        for k, v in fields.items():
            if k == '_instances':
                if '_instances' in have and str(have['_instances']) != str(v):
                    raise SystemExit('%s: the app watches instance %s, the probe needs %s' % (iface, have['_instances'], v))
                if '_instances' not in have:
                    have['_instances'] = v
                    rec['notes'].append('_instances')
            elif k.startswith('_'):
                if k not in have:
                    have[k] = v
                    rec['notes'].append(k)
            elif k not in have:
                have[k] = v
                rec['fields'].append(k)
            elif have[k] != v:
                merged = ''.join(c for c in 'rs' if c in have[k] + v)
                if set(have[k]) - set('rsw') or 'w' in have[k]:
                    raise SystemExit('%s.%s: the app declares %r; the probe build adds nothing to a writable field' % (iface, k, have[k]))
                rec['flagsWas'][k] = have[k]
                have[k] = merged
        if rec['fields'] or rec['notes'] or rec['flagsWas'] or rec['whole']:
            mark['added'][iface] = rec
    cfg = spec.setdefault('config', OrderedDict())
    for k, v in probe.get('config', {}).items():
        if k == 'probe' and cfg.get('probe'):
            continue                                    # a probe setting the app already has stays as it is
        if k == 'probe' or k not in cfg:
            mark['config'].append(OrderedDict([('key', k), ('was', cfg.get(k, None)), ('had', k in cfg)]))
            cfg[k] = v
    # the engine require()s shared/twin_probe.js only when config.probe is on, and the build packs only what "shared" lists
    if isinstance(spec.get('shared'), list) and 'twin_probe.js' not in spec['shared']:
        spec['shared'].append('twin_probe.js')
        mark['shared'] = True
    if version and version != spec.get('version'):
        mark['version'] = spec.get('version')
        spec['version'] = version
    spec[MARK] = mark
    return True


def turn_off(spec):
    mark = spec.get(MARK)
    if mark is None:
        return False
    sigs = spec.get('signals', {})
    for iface, rec in mark['added'].items():
        have = sigs.get(iface)
        if not isinstance(have, dict):
            continue
        for k in rec['fields'] + rec['notes']:
            have.pop(k, None)
        for k, was in rec['flagsWas'].items():
            have[k] = was
        if rec['whole'] and not [k for k in have if not k.startswith('_')]:
            sigs.pop(iface, None)
    cfg = spec.get('config', {})
    for c in mark['config']:
        if c['had']:
            cfg[c['key']] = c['was']
        else:
            cfg.pop(c['key'], None)
    if mark.get('shared') and 'twin_probe.js' in spec.get('shared', []):
        spec['shared'].remove('twin_probe.js')
    if mark['version'] is not None:
        spec['version'] = mark['version']
    del spec[MARK]
    return True


def check(app_path, catalogue):
    r = subprocess.run([sys.executable, CHECK, catalogue, app_path], capture_output=True, text=True)
    out = (r.stdout or '') + (r.stderr or '')
    fails = [l for l in out.splitlines() if 'FAIL' in l]
    last = out.strip().splitlines()[-1] if out.strip() else 'no output'
    return r.returncode == 0, last, fails


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['on', 'off', 'status', 'check'])
    ap.add_argument('--app', default=APP)
    ap.add_argument('--probe', default=PROBE)
    ap.add_argument('--version')
    ap.add_argument('--out')
    ap.add_argument('--catalogue', default=CATALOGUE)
    a = ap.parse_args()
    spec = load(a.app)
    if a.cmd == 'status':
        m = spec.get(MARK)
        print('probe build: ' + ('ON (%d interfaces added)' % len(m['added']) if m else 'off (the normal build)'))
        return 0
    if a.cmd in ('on', 'off'):
        changed = turn_on(spec, load(a.probe), a.version) if a.cmd == 'on' else turn_off(spec)
        dest = a.out or a.app
        if changed:
            dump(spec, dest)
        elif a.out:
            dump(spec, dest)
        print('%s: probe %s%s' % (dest, a.cmd, '' if changed else ' (already so)'))
        return 0
    # check: this state, and the other one through a scratch copy
    if not os.path.exists(a.catalogue):
        print('check: the car catalogue is not here (%s)' % a.catalogue)
        return 2
    other = copy.deepcopy(spec)
    if MARK in spec:
        turn_off(other)
    else:
        turn_on(other, load(a.probe), None)
    status = 0
    with tempfile.TemporaryDirectory() as tmp:
        for name, s in (('normal', spec if MARK not in spec else other), ('probe', other if MARK not in spec else spec)):
            p = os.path.join(tmp, name + '.json')
            dump(s, p)
            okay, last, fails = check(p, a.catalogue)
            print('%-7s %s: %s' % (name, 'ok  ' if okay else 'FAIL', last))
            for l in fails:
                print('   ' + l.strip())
            status |= 0 if okay else 1
    return status


if __name__ == '__main__':
    sys.exit(main())
