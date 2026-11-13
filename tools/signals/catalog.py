#!/usr/bin/env python3
"""Rank the car's SOME/IP catalogue for the fields this app still needs (read only, standard library, nothing talks to the car).

    python3 tools/signals/catalog.py <someip-interfaces.json> [--topic limit,msa,...] [--top N] [--json out.json]
                                     [--localtime <copy of /etc/localtime>] [--app apps/f30_cluster/app.json]

The catalogue is the head unit's /etc/oap/someip/someip-interfaces.json. scripts/car_signals.sh copies it once over SSH
(`cat` only) to reference/someip-interfaces.json (git-ignored: BMW's file) and runs this on the copy.

Topics (docs/CAR3-I-REPORT.md):
  limit   the speed limit in force, with BMW's "no limit known" state (the "---" sign) and the end of a limit
  nopass  no overtaking
  msa     auto start/stop (MSA): active, off, engine stopped by MSA, unavailable
  clock   the local time or the time zone, so our clock is right without the "timeZone" setting
  ccm     a check-control message is showing (6WB Dials + G20 could cover the hooks only while none shows)
  drive   the drive mode (Comfort / Sport / Eco Pro / Comfort Plus ...): today's FES.statusFESVehicleDynamicSwitchHMI
          gave nothing on the owner's car, so every field that may carry it is ranked

For each topic the fields whose interface, field, member, type or enum item names look right are ranked and printed with
their app.json flag (r: has a getter, s: has a notifier), instance, members and enum items, and the best one gets
ready-to-paste app.json "signals" and "config" lines in the shapes shared/hud.js reads.

The catalogue's shape (as the kit's tools and cauliflowermossgrape/idrive7-apps' check_signals.py / sigdoc.py read it):
{ interfaces: { <iface>: { serviceId, fields: { <field>: { dataRef, getter: { id }, notifier } }, methods, events } },
  datatypes: { <ref>: { type: struct | enum | typedef | array | union, members, extends, items, dataRef, baseType,
  elementDataRef } }, instanceIDs: { <iface>: ... } }. It has not been seen by us, so the reader is lenient (lists or maps,
other key spellings) and prints a short summary of the shape, plus a plain name search over the whole file when the
interfaces cannot be read, so the output is useful either way.
"""
import json
import re
import sys

# ---- what to look for: (regex, weight) per topic. Weights: 10 the thing itself, 5-7 close, 2-4 context ----------------
W = lambda p, w, flags=re.I: (re.compile(p, flags), w)
CAMEL = 0      # case-sensitive patterns for acronyms inside camelCase
TOPICS = {
    'limit': [
        W(r'speed_?limit_?info|actual_?speed_?limit|current_?speed_?limit|speed_?limit_?(value|actual|current|display)', 10),
        W(r'(^|[a-z0-9_.])(SLI|Sli)([A-Z0-9_.]|$)|^sli([A-Z0-9_]|$)', 10, CAMEL),
        W(r'traffic_?sign|road_?sign|verkehrs_?zeichen|sign_?recogn|(^|_)tsr(_|$)|(^|_)vz[eo](_|$)|(^|[a-z])VZ[EO]?([A-Z_]|$)', 9),
        W(r'speed_?limit|limit_?speed|max_?speed|speed_?max|allowed_?speed|legal_?speed|limit_?value|posted', 7),
        W(r'derestrict|aufhebung|end_?of_?(limit|restriction)|unlimited|no_?limit|limit_?(unknown|unavailable)', 6),
        W(r'speed_?info|limit_?info|sign_?info|sign_?type|zeichen', 5),
        W(r'kafas|camera_?sign|fas_?info|driver_?assist|fahrerassist', 3),
        W(r'limiter|speed_?control|cruise|acc_?set|set_?speed|speed_?assist', 2),
    ],
    'nopass': [
        W(r'overtak|no_?passing|passing_?(ban|prohib|restrict|info)|ueberhol|uberhol', 10),
        W(r'(^|[a-z0-9_.])(NPI|Npi)([A-Z0-9_.]|$)|^npi([A-Z0-9_]|$)', 10, CAMEL),
        W(r'(^|[_.])or(Info|NPI|Npi)|[a-z0-9]OR(Info|NPI|Npi|_)|^OR(Info|NPI|_)', 8, CAMEL),
        W(r'traffic_?sign|sign_?recogn|traffic_?sign_?info', 5),
    ],
    'msa': [
        W(r'(^|[a-z0-9_.])(MSA|Msa)([A-Z0-9_.]|$)|^msa([A-Z0-9_]|$)', 10, CAMEL),
        W(r'start_?stopp?|stop_?start|auto_?start|engine_?(auto_?)?stop|motor_?stop|idle_?stop|motorstart|stopp?_?automatik', 10),
        W(r'eco_?stop|ready_?to_?start|engine_?ready|auto_?stop', 6),
        W(r'coast|segeln|sailing', 4),
        W(r'engine_?(state|status|run|running|on|off)|motor_?(status|state|lauf)|ignition|klemme|terminal_?(15|50)|(^|_)kl_?(15|50)', 3),
    ],
    'clock': [
        W(r'time_?zone|timezone|tz_?offset|utc_?offset|gmt_?offset|offset_?(to_?)?(utc|gmt)|local_?time|daylight|summer_?time|zeitzone', 10),
        W(r'(^|[a-z0-9_.])(DST|Dst|UTC|Utc|GMT)([A-Z0-9_.]|$)', 8, CAMEL),
        W(r'^(status)?_?(vehicle|system|local|current|actual)?_?(time|clock)(_?(info|status|data|value))?$', 7),
        W(r'system_?time|date_?time|time_?(and_?)?date|clock|current_?time|vehicle_?time|uhr_?zeit', 6),
        W(r'(^|_)(hours?|minutes?|stunde|minute)(_|$)', 2),
    ],
    'ccm': [
        W(r'check_?control|checkcontrol|(^|_)ccm(_|$)|cc_?(message|msg|list|id|display|popup|status|active)', 10),
        W(r'(^|[a-z0-9_.])(CC|Cc|CCM|Ccm)(Message|Msg|List|Id|Display|Popup|Status|Active|Info)', 10, CAMEL),
        W(r'(warning|vehicle|kombi|cluster|driver)_?(message|msg|notification|popup)|message_?(list|display|active|visible|shown)|popup|notification_?(active|visible)', 6),
        W(r'warning|warn_?lamp|telltale|indicator_?lamp|kontroll', 3),
    ],
    # the drive mode switch (Comfort / Sport / Eco Pro / Comfort Plus ...): today's FES.statusFESVehicleDynamicSwitchHMI
    # gave nothing on the owner's car (photos 33, 41), so every other field that carries it is listed too. An enum
    # whose items name two or more modes scores 10 on its own (MODE_WORDS below)
    'drive': [
        W(r'driving_?experience|fahr_?erlebnis|vehicle_?dynamic_?switch|dynamic_?switch|drive_?mode|driving_?mode|mode_?driving|drive_?select|fes_?mode', 10),
        W(r'(^|[a-z0-9_.])(FES|Fes)([A-Z0-9_.]|$)|^fes([A-Z0-9_]|$)', 7, CAMEL),
        W(r'comfort_?plus|sport_?plus|eco_?pro|adaptive_?mode|individual_?mode', 6),
        W(r'driving_?dynamic|dynamic_?mode|chassis_?mode|mode_?switch', 5),
    ],
}
TITLES = {'limit': 'speed limit in force (incl. BMW\'s "---")', 'nopass': 'no overtaking',
          'msa': 'auto start/stop (MSA)', 'clock': 'local time / time zone', 'ccm': 'a check-control message is showing',
          'drive': 'drive mode (Comfort / Sport / Eco Pro ...); today FES.statusFESVehicleDynamicSwitchHMI'}
MODE_WORDS = [r'comfort|komfort', r'sport', r'eco|efficien', r'adaptive', r'individual']


def mode_enum(items):
    """10 when an enum's items name two or more drive modes (COMFORT, SPORT, ECO_PRO ...), else 0."""
    keys = ' '.join(str(k) for k in items)
    return 10 if sum(1 for w in MODE_WORDS if re.search(w, keys, re.I)) >= 2 else 0
MAX_DEPTH = 6


def score(name, topic):
    s, n = 0, str(name or '')
    for rx, w in TOPICS[topic]:
        if rx.search(n):
            s = max(s, w)
    return s


def as_map(x, key='name'):
    """A catalogue section as {name: entry}: a dict as it is, a list of entries by their name."""
    if isinstance(x, dict):
        return x
    if isinstance(x, list):
        out = {}
        for i, e in enumerate(x):
            if isinstance(e, dict):
                out[str(e.get(key) or e.get('id') or i)] = e
        return out
    return {}


class Cat:
    def __init__(self, db):
        self.db = db
        self.types = as_map(db.get('datatypes') or db.get('dataTypes') or db.get('types') or {})

    def resolve(self, ref, seen=None):
        """(kind, detail) of a data ref: ('struct', members) | ('enum', items) | ('array', elem) | ('prim', name)."""
        seen = seen or set()
        d = self.types.get(ref) if isinstance(ref, str) else (ref if isinstance(ref, dict) else None)
        if not isinstance(d, dict) or (isinstance(ref, str) and ref in seen):
            return 'prim', str(ref)
        if isinstance(ref, str):
            seen = seen | {ref}
        t = str(d.get('type') or d.get('kind') or '').lower()
        if t == 'struct' or (not t and 'members' in d):
            mem, dd, guard = [], d, 0
            while isinstance(dd, dict) and guard < 10:
                mem = list(dd.get('members') or []) + mem
                ext = dd.get('extends')
                if not ext:
                    break
                dd = self.types.get(ext)
                guard += 1
            return 'struct', mem
        if t in ('enum', 'enumeration') or (not t and 'items' in d):
            items = d.get('items') or d.get('enumerators') or d.get('values') or {}
            if isinstance(items, list):
                items = {str(i.get('name', i) if isinstance(i, dict) else i): (i.get('value', n) if isinstance(i, dict) else n)
                         for n, i in enumerate(items)}
            return 'enum', items
        if t == 'typedef':
            return self.resolve(d.get('dataRef', d.get('baseType')), seen)
        if t in ('array', 'vector', 'list'):
            return 'array', d.get('elementDataRef', d.get('dataRef'))
        if t in ('union', 'variant'):
            return 'struct', list(d.get('members') or [])
        return 'prim', str(d.get('baseType') or t or ref)

    def walk(self, ref, path=(), depth=0, seen=frozenset()):
        """Yield (path, kind, detail, typename) for the value and every member under it."""
        kind, det = self.resolve(ref)
        yield path, kind, det, ref
        key = ref if isinstance(ref, str) else id(ref)
        if depth >= MAX_DEPTH or key in seen:
            return
        if kind == 'struct':
            for m in det:
                if isinstance(m, dict):
                    yield from self.walk(m.get('dataRef', m.get('type')), path + (str(m.get('name', '?')),), depth + 1, seen | {key})
        elif kind == 'array':
            yield from self.walk(det, path + ('[]',), depth + 1, seen | {key})


def flag(fd):
    g = fd.get('getter')
    g = bool(g.get('id')) if isinstance(g, dict) else bool(g)
    n = fd.get('notifier')
    n = bool(n.get('id', True)) if isinstance(n, dict) else bool(n)
    return ('r' if g else '') + ('s' if n else ''), g, n


def tname(ref):
    return ref if isinstance(ref, str) else (ref.get('name') if isinstance(ref, dict) and ref.get('name') else type(ref).__name__)


def entries(cat):
    """Every field and event of every interface: (iface, kind 'field' | 'event', name, dataRef, entry)."""
    for iface, i in as_map(cat.db.get('interfaces') or cat.db.get('services') or {}).items():
        if not isinstance(i, dict):
            continue
        for fname, fd in as_map(i.get('fields') or {}).items():
            if isinstance(fd, dict):
                yield iface, i, 'field', fname, fd.get('dataRef', fd.get('type')), fd
        for ename, ed in as_map(i.get('events') or i.get('broadcasts') or {}).items():
            if not isinstance(ed, dict):
                continue
            ref = ed.get('dataRef')
            if ref is None:      # an event with arguments: walk them as one struct
                args = ed.get('arguments') or ed.get('parameters') or ed.get('members') or ed.get('outArgs') or []
                ref = {'type': 'struct', 'members': args if isinstance(args, list) else []}
            yield iface, i, 'event', ename, ref, ed


def rank(cat, topic, inst):
    hits = []
    for iface, i, kind, name, ref, fd in entries(cat):
        si, sf = score(iface, topic), score(name, topic)
        paths, enums, sub = [], [], 0
        for p, k, det, tn in cat.walk(ref):
            sm = max(score(p[-1], topic) if p else 0, score(tname(tn), topic))
            se = max([score(str(x), topic) for x in det] + [0]) if k == 'enum' else 0
            if k == 'enum' and topic == 'drive':
                se = max(se, mode_enum(det))
            if k == 'enum':
                enums.append(('.'.join(p) or '(value)', tname(tn), det, max(sm, se)))
            if sm or se:
                paths.append(('.'.join(p) or '(value)', k, tname(tn), sm, se))
            sub = max(sub, sm, se)
        best = max(si, sf, sub)
        if best < 3:
            continue
        # the field itself named right counts most; a whole interface named right (e.g. "...MSA") lifts all its fields
        total = best * 10 + sf * 2 + si + sub + min(len(paths), 5)
        fl, g, n = flag(fd) if kind == 'field' else ('event', False, True)
        if kind == 'field' and not n:
            total -= 15          # no notifier: only a poll can read it
        hits.append(dict(topic=topic, iface=iface, kind=kind, name=name, serviceId=i.get('serviceId'),
                         instance=inst.get(iface), flag=fl, getter=g, notifier=n, score=total, paths=paths,
                         enums=enums, type=tname(ref), tree=[('.'.join(p) or '(value)', k, tname(tn)) for p, k, d_, tn in cat.walk(ref)][:24]))
    hits.sort(key=lambda h: -h['score'])
    return hits


# ---- the app.json lines for a candidate (the shapes shared/hud.js reads; docs/CAR3-I-REPORT.md) -----------------------
MSA_GUESS = [   # enum item name -> our state; the first rule that matches wins (so NOT_ACTIVE is "off", not "active")
    (r'invalid|ungueltig|unknown|init|undef|not_?def|reserved|signal_?error', None),
    (r'(stop|off).*(msa|auto)|(msa|auto).*(stop|off_?engine)|engine_?(is_?)?stopped|motor_?(aus|stop)|auto_?stop|eco_?stop', 'stopped'),
    (r'not_?(available|possible|ready|allowed)|unavail|inhibit|block|prevent|fault|error|defect|fail|condition', 'unavailable'),
    (r'deactiv|disabl|not_?active|inactive|switched_?off|(^|_)off($|_)|aus($|_)|passiv', 'off'),
    (r'activ|enabl|(^|_)on($|_)|ready|armed|standby', 'active'),
]


def msa_map(items):
    out = {}
    for k, v in items.items():
        st = 'unknown?'
        for rx, s in MSA_GUESS:
            if re.search(rx, str(k), re.I):
                st = s
                break
        out[str(v)] = st
    return out


def best_path(h, kinds=('prim', 'enum')):
    for p, k, t, sm, se in h['paths']:
        if k in kinds and p != '(value)':
            return p.split('.')
    for p, k, t in h['tree']:
        if k in kinds and p != '(value)':
            return p.split('.')
    return []


def config_line(h):
    """The config.<key> object for this candidate, as JSON text."""
    base = {'iface': h['iface'], 'field': h['name']}
    t, en = h['topic'], {e[0]: e for e in h['enums']}
    if t == 'limit':
        p = best_path(h, ('prim',)) or best_path(h)
        unit = next((e for e in h['enums'] if re.search(r'unit|einheit|kmh|mph', e[0] + ' ' + e[1], re.I)), None)
        base.update(path=p, factor=1, unit='kmh', invalid=[0], unknown=[], end=[])
        if unit:
            mph = [v for k, v in unit[2].items() if re.search(r'mph|mile', str(k), re.I)]
            base.update(unitPath=unit[0].split('.'), mph=mph)
    elif t == 'nopass':
        p = best_path(h)
        e = en.get('.'.join(p))
        on = [v for k, v in e[2].items() if re.search(r'overtak|passing|npi|ueberhol', str(k), re.I)
              and not re.search(r'allow|end|aufheb|no_?restr|off|invalid', str(k), re.I)] if e else [1]
        base.update(path=p, on=on or [1])
    elif t == 'msa':
        p = best_path(h, ('enum',)) or best_path(h)
        e = en.get('.'.join(p))
        base.update(path=p, map=msa_map(e[2]) if e else {'0': None, '1': 'active', '2': 'off', '3': 'stopped', '4': 'unavailable'})
    elif t == 'clock':
        names = [x[0] for x in h['tree']]
        hp = next((n for n in names if re.search(r'(^|\.)(hours?|stunde)$', n, re.I)), None)
        mp = next((n for n in names if re.search(r'(^|\.)(minutes?)$', n, re.I)), None)
        off = next((n for n in names if re.search(r'offset|zone|utc|gmt', n.split('.')[-1], re.I)), None)
        dst = next((n for n in names if re.search(r'dst|daylight|summer', n.split('.')[-1], re.I)), None)
        if off or not (hp and mp):
            base.update(kind='offset', path=(off or '').split('.') if off else best_path(h, ('prim',)), factor=1)
            if dst:
                base.update(dstPath=dst.split('.'), dstMinutes=60)
        else:
            base.update(kind='local', hourPath=hp.split('.'), minutePath=mp.split('.'))
    elif t == 'drive':
        p = next((e[0].split('.') for e in h['enums'] if e[3] >= 10 and e[0] != '(value)'), None)
        if p is None:
            p = next((x[0].split('.') for x in h['tree'] if re.search(r'mode|experience|switch', x[0].split('.')[-1], re.I)
                      and x[0] != '(value)'), None) or best_path(h)
        e = en.get('.'.join(p))
        base.update(path=p)
        if e:
            base.update(map={str(v): k for k, v in list(e[2].items())[:24]})     # hud.js reads names (SPORT_PLUS ...)
    elif t == 'ccm':
        arr = next((x[0] for x in h['tree'] if x[1] == 'array'), None)
        if arr is not None:
            base.update(kind='list', path=[] if arr == '(value)' else arr.split('.'))
        else:
            base.update(kind='flag', path=best_path(h), on=[], off=[0])
    return json.dumps(base, ensure_ascii=False)


def signal_flag(h):
    if h['kind'] == 'event':
        return None
    return ('r' if h['getter'] else '') + ('s' if h['notifier'] else '') or None


def shape(db):
    """A few lines on the catalogue's shape, so its reader can be fixed if it is not the one expected."""
    out = ['top level: ' + ', '.join('%s (%s %s)' % (k, type(v).__name__, len(v) if hasattr(v, '__len__') else '')
                                     for k, v in list(db.items())[:12])]
    ifs = as_map(db.get('interfaces') or db.get('services') or {})
    if ifs:
        k, v = next(iter(ifs.items()))
        out.append('an interface (%s): keys %s' % (k, sorted(v.keys())[:16] if isinstance(v, dict) else type(v).__name__))
        fs = as_map(v.get('fields') or {}) if isinstance(v, dict) else {}
        if fs:
            fk, fv = next(iter(fs.items()))
            out.append('  a field (%s): %s' % (fk, json.dumps(fv, ensure_ascii=False)[:240]))
        ev = as_map(v.get('events') or v.get('broadcasts') or {}) if isinstance(v, dict) else {}
        if ev:
            ek, evv = next(iter(ev.items()))
            out.append('  an event (%s): %s' % (ek, json.dumps(evv, ensure_ascii=False)[:240]))
    ts = as_map(db.get('datatypes') or db.get('dataTypes') or db.get('types') or {})
    for want in ('struct', 'enum'):
        e = next(((k, v) for k, v in ts.items() if isinstance(v, dict) and str(v.get('type', '')).lower() == want), None)
        if e:
            out.append('a %s datatype (%s): %s' % (want, e[0], json.dumps(e[1], ensure_ascii=False)[:240]))
    inst = db.get('instanceIDs') or db.get('instances')
    if inst:
        k = next(iter(inst)) if isinstance(inst, dict) else None
        out.append('instanceIDs: %s %s, e.g. %s: %s' % (type(inst).__name__, len(inst), k, json.dumps(inst[k])[:120] if k else ''))
    return out


def grep_all(db, topic, limit=25):
    """Fallback when no interface can be read: every JSON key / string in the file that matches the topic."""
    hits = []

    def go(x, path):
        if len(hits) > 4000:
            return
        if isinstance(x, dict):
            for k, v in x.items():
                s = score(k, topic)
                if s >= 5:
                    hits.append((s, '/'.join(path + [str(k)])))
                go(v, path + [str(k)])
        elif isinstance(x, list):
            for n, v in enumerate(x[:5000]):
                go(v, path + [str(n)])
        elif isinstance(x, str) and score(x, topic) >= 5:
            hits.append((score(x, topic), '/'.join(path) + ' = ' + x[:80]))
    go(db, [])
    hits.sort(key=lambda h: -h[0])
    return [h[1] for h in hits[:limit]]


def tzif_footer(path):
    """The POSIX TZ string at the end of a TZif file (a copy of the unit's /etc/localtime), e.g. 'UTC0' or 'EET-2EEST,...'."""
    try:
        b = open(path, 'rb').read()
    except OSError:
        return None
    if not b.startswith(b'TZif'):
        return 'not a TZif file (%d bytes)' % len(b)
    tail = b.rstrip(b'\n').rsplit(b'\n', 1)
    return tail[-1].decode('ascii', 'replace') if len(tail) == 2 else '(no footer)'


def check_app(db, app_path):
    """app.json "signals" against the catalogue: a field it lacks, or a flag the field cannot take (the install refuses
    both; the same rule as the kit's check_signals.py)."""
    try:
        sig = json.load(open(app_path, encoding='utf-8')).get('signals') or {}
    except (OSError, ValueError) as e:
        return ['cannot read %s: %s' % (app_path, e)]
    ifs, out, cat = as_map(db.get('interfaces') or db.get('services') or {}), [], Cat(db)
    inst = db.get('instanceIDs') if isinstance(db.get('instanceIDs'), dict) else {}
    for iface, fields in sig.items():
        if not isinstance(fields, dict):
            continue
        i = ifs.get(iface)
        if not isinstance(i, dict):
            out.append('%s: no such interface in the catalogue' % iface)
            continue
        fmap = as_map(i.get('fields') or {})
        for f, fl in fields.items():
            if f.startswith('_'):
                continue
            fd = fmap.get(f)
            if not isinstance(fd, dict):
                out.append('%s . %s: no such field' % (iface, f))
                continue
            have, g, n = flag(fd)
            bad = [c for c in str(fl) if (c == 'r' and not g) or (c == 's' and not n)]
            out.append('%s . %s: "%s" %s (the field has "%s"; getter %s, notifier %s; instance %s)' % (
                iface, f, fl, 'REFUSED: no ' + ' / '.join({'r': 'getter', 's': 'notifier'}[c] for c in bad) if bad else 'ok',
                have, json.dumps(fd.get('getter')), json.dumps(fd.get('notifier'))[:60], json.dumps(inst.get(iface))[:60]))
            # the members the app reads (hud.js digs into them by name; a name that differs on this car reads as nothing)
            for p, k, d, tn in list(cat.walk(fd.get('dataRef', fd.get('type'))))[:10]:
                ex = ''
                if k == 'enum':
                    ex = ': ' + ', '.join('%s=%s' % (a, b) for a, b in list(d.items())[:16])
                out.append('      %-46s %-6s %s%s' % ('.'.join(p) or '(value)', k, tname(tn), ex))
    return out


def main(argv):
    args = [a for a in argv[1:]]
    if not args or args[0] in ('-h', '--help'):
        print(__doc__)
        return 2
    opt = lambda k, d=None: args[args.index(k) + 1] if k in args else d
    topics = [t for t in (opt('--topic') or 'drive,limit,nopass,msa,clock,ccm').split(',') if t in TOPICS]
    top = int(opt('--top', '8'))
    with open(args[0], encoding='utf-8') as f:
        db = json.load(f)
    cat = Cat(db)
    inst = db.get('instanceIDs') or {}
    inst = inst if isinstance(inst, dict) else {}
    n_if = len(as_map(db.get('interfaces') or db.get('services') or {}))
    n_f = sum(1 for _ in entries(cat))
    print('== car signal catalogue: %d interfaces, %d fields and events, %d datatypes' % (n_if, n_f, len(cat.types)))
    for line in shape(db):
        print('   ' + line)
    if opt('--localtime'):
        print('   the unit\'s /etc/localtime: %s' % tzif_footer(opt('--localtime')))
    print('flag: r = has a getter (read at start), s = has a notifier (changes); app.json needs "s" or "rs". "event": '
          'a broadcast (app.json "_broadcasts"; tell the lead). instance: the app subscribes instance "1" (kit car.js).')
    if opt('--app'):
        print('\n== the app\'s own app.json "signals" against this catalogue')
        for line in check_app(db, opt('--app')):
            print('   ' + line)
    picks, dump = {}, {}
    for t in topics:
        hits = rank(cat, t, inst)
        dump[t] = hits
        print('\n== %s: %s (%d candidates)' % (t, TITLES[t], len(hits)))
        if not hits and n_f == 0:
            for line in grep_all(db, t):
                print('   name match: ' + line)
        for n, h in enumerate(hits[:top]):
            print('%2d. [%d] %s . %s  %s "%s"%s  service %s, instance %s, type %s' % (
                n + 1, h['score'], h['iface'], h['name'], h['kind'], h['flag'] or '-',
                '' if h['notifier'] else '  (NO NOTIFIER: poll only)', h['serviceId'], h['instance'], h['type']))
            rows = h['tree'] if n < 3 else [(p, k, tn) for p, k, tn, sm, se in h['paths']]
            for p, k, tn in rows[:14]:
                print('      %-50s %-6s %s' % (p, k, tn))
            for p, tn, items, s in h['enums'][:6 if n < 3 else 2]:
                it = ', '.join('%s=%s' % (k, v) for k, v in list(items.items())[:48])
                print('      enum %s (%s): %s%s' % (p, tn, it, ' ...' if len(items) > 48 else ''))
        best = next((h for h in hits if h['kind'] == 'field' and h['notifier']), None) or (hits[0] if hits else None)
        if best:
            picks[t] = best
            print('   -> best: config.%s = %s' % ({'ccm': 'ccm'}.get(t, t), config_line(best)))
    if picks:
        sig = {}
        for t, h in picks.items():
            fl = signal_flag(h)
            if fl:
                sig.setdefault(h['iface'], {})[h['name']] = fl if 's' in fl else 'r'
        print('\n== ready to paste (check each against the members above first; docs/CAR3-I-REPORT.md says how)')
        print('"signals": ' + json.dumps(sig, ensure_ascii=False))
        for t, h in picks.items():
            print('"config.%s": %s' % (t, config_line(h)))
    if opt('--json'):
        with open(opt('--json'), 'w', encoding='utf-8') as f:
            json.dump(dump, f, indent=1, default=str, ensure_ascii=False)
        print('\nwritten', opt('--json'))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
