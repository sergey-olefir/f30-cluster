"""tools/shots: what to photograph (docs/AGENT-BRIEF-shots.md section 2): the contexts, the axes, the baseline, and
the four sets A (one-factor sweeps), B (pairwise), C (scenarios) and D (diagnostics).

A job is one picture: a full description of the state to drive the bench into (settings, drive mode, manual
signals, the fake scenes of bench/fake-signs.js, a fault-injection hook), plus what the probe must show before a
snapshot may be taken. Every text fed is the bench's own invented one (bench/fake-signs.js); nothing here comes off a
photo. Standard library only.
"""
import random

# ---- contexts (section 2.1). "6WB Sport + G20" cannot be loaded through any setting (hud.js G20_OF has only
# Comfort), so it is not here.
COMMON = {
    'byMode': False,            # held off, or the drive mode switches the theme under us
    'nightDim': 'off',          # the baseline is day; the default "auto" follows the clock and the sun
    'nightLook': 'plain', 'needleSmooth': True, 'stockMap': False, 'wbFoot': 'hair',
    'dialShade': 'normal', 'ccStyle': 'A', 'limitArc': 'auto', 'modeLabel': True, 'gearTray': 'gear',
    'coldGuard': True,          # "baked", "badge" and "badgeBMW" were retired in 0.7.18 (fix/settings)
}
CONTEXTS = {
    'comfort': dict(COMMON, hudLayout='wb_comfort', g20=False, bottomRow='allG20'),
    'comfort-g20-bmw': dict(COMMON, hudLayout='wb_comfort', g20=True, bottomRow='allG20'),
    'comfort-g20-ours': dict(COMMON, hudLayout='wb_comfort', g20=True, bottomRow='all6WB'),
    'sport': dict(COMMON, hudLayout='wb_sport', g20=False, bottomRow='allG20'),
    'eco': dict(COMMON, hudLayout='wb_eco', g20=False, bottomRow='allG20'),
}
ACTIVE = {'comfort': 'wb_comfort', 'comfort-g20-bmw': 'wb_dials', 'comfort-g20-ours': 'wb_dials', 'sport': 'wb_sport', 'eco': 'wb_eco'}
SEE_THROUGH = ('comfort-g20-bmw', 'comfort-g20-ours')
ROW_OURS = ('comfort-g20-ours',)
CONTEXT_ORDER = ['comfort-g20-ours', 'comfort-g20-bmw', 'comfort', 'sport', 'eco']

# ---- motion (section 2.2; the values of tools/strip/O/states.py) ----
DRIVE = {'rpm': 1500, 'speed': 50, 'gear': 3, 'oil': 95, 'coolant': 90, 'ambient': 22, 'range': 368, 'fuelL': 40,
         'msa': 0, 'program': 'D'}
MOTIONS = {
    'p-idle': dict(DRIVE, rpm=800, speed=0, gear=0),
    'd30': dict(DRIVE, rpm=1200, speed=30, gear=2),
    'd50': dict(DRIVE),
    'd72-over': dict(DRIVE, rpm=2000, speed=72, gear=3),
    'd130': dict(DRIVE, rpm=3000, speed=130, gear=6),
    'redline': dict(DRIVE, rpm=6600, speed=110, gear=3),
    'p-engine-off': dict(DRIVE, rpm=0, speed=0, gear=0, engine=0, condition=7),
    'standby': dict(DRIVE, rpm=0, speed=0, gear=0, engine=0, condition=5),
}
HOLD = {'p-engine-off': 1.6, 'standby': 1.8}     # the engine debounces the vehicle condition (STANDBY_MS 1 s)
MODES = {'comfort': 4, 'sport': 1, 'eco': 7}

# ---- the fake scenes (bench/fake-signs.js), with what the probe must report for each ----
LIMITS = ['limit-50', 'limit-80-rain', 'limit-130-warn1', 'limit-30-warn2-school', 'limit-55-mph', 'limit-end',
          'limit-unknown', 'limit-none', 'limit-invalid', 'nopass-car', 'nopass-truck']
SIGN_WANT = {
    'limit-50': {'state': 'limit', 'shown': 50, 'np': 'none'},
    'limit-80-rain': {'state': 'limit', 'shown': 80, 'supp': 'rain'},
    'limit-130-warn1': {'state': 'limit', 'shown': 130, 'warn': 1},
    'limit-30-warn2-school': {'state': 'limit', 'shown': 30, 'warn': 2, 'supp': 'school'},
    'limit-55-mph': {'state': 'limit', 'shown': 55, 'unit': 'mph'},
    'limit-end': {'state': 'end'},
    'limit-unknown': {'state': 'unknown'},
    'limit-none': {'state': 'none', 'style': 'ece'},
    'limit-invalid': {'state': 'none', 'style': None},
    'nopass-car': {'state': 'limit', 'shown': 80, 'np': 'car'},
    'nopass-truck': {'state': 'limit', 'shown': 60, 'np': 'truck'},
    # scenario C: a motorway 130 with the no-overtaking sign (the fake's own fields, no scene of that name)
    'limit-130-nopass': {'state': 'limit', 'shown': 130, 'np': 'car'},
}
SIGN_PARTS = {'limit-130-nopass': {'sign': {'state': 'limit', 'value': 130, 'unit': 'kmh', 'np': 'car', 'npM': 800}}}

MESSAGES = ['cc-clear', 'cc-red', 'cc-yellow', 'cc-green', 'cc-orange', 'cc-white', 'cc-long', 'cc-long-name',
            'cc-three', 'cc-frame-2', 'cc-uk', 'cc-cyrillic', 'cc-greek', 'cc-unread', 'cc-unread-root']
# extra message states the brief's list leaves out: nothing ever fed since the restart (the owner's 69.png), our first
# draw held back (bench hook ccHold: the safety gap) and a throw while drawing it (hook ccThrow: latches)
MESSAGES_EXTRA = ['cc-never', 'cc-held', 'cc-throw']
CC_COLOR = {'cc-red': 'red', 'cc-yellow': 'yellow', 'cc-green': 'green', 'cc-orange': 'orange', 'cc-white': 'white',
            'cc-long': 'red', 'cc-long-name': 'orange', 'cc-uk': 'yellow', 'cc-cyrillic': 'yellow', 'cc-greek': 'yellow',
            'cc-three': 'yellow', 'cc-frame-2': 'yellow', 'cc-held': 'yellow', 'cc-throw': 'yellow'}
CC_SCENE = {'cc-held': 'cc-yellow', 'cc-throw': 'cc-yellow'}
CC_HOOK = {'cc-held': 'ccHold', 'cc-throw': 'ccThrow'}
FRESH = ('cc-never', 'cc-unread', 'cc-unread-root')                      # only right after a restart
LATCHING = ('cc-greek', 'cc-throw', 'cc-unread', 'cc-unread-root')       # latch the row: a restart after each
CC_LINES = {'cc-unread-root': 1, 'cc-unread': 1}                         # no description: BMW's one-line panel

ROADS = ['road-none', 'road-street', 'road-shield', 'road-guiding', 'road-cyrillic']
ROAD_WANT = {'road-none': ('', 'off'), 'road-street': ('Hauptstrasse', 'off'), 'road-shield': ('A 9 Nuernberg', 'off'),
             'road-guiding': ('B 2 / Ingolstaedter Strasse', 'on'), 'road-cyrillic': ('Ґрунтова вулиця', 'off')}
CLOCKS = ['clock-plus2', 'clock-none']

BASE_STATE = {'settings': {}, 'motion': 'd50', 'sig': {}, 'mode': 'comfort', 'limit': 'limit-50', 'msg': 'cc-clear',
              'road': 'road-street', 'clock': 'clock-plus2'}


def state(**kw):
    s = dict(BASE_STATE)
    s['settings'] = dict(kw.pop('settings', {}))
    s['sig'] = dict(kw.pop('sig', {}))
    s.update(kw)
    return s


# ---- set A: one axis at a time from the baseline ----
def axes():
    """[(axis, value, state-overrides)]; the baseline is axis "baseline"."""
    out = [('baseline', 'baseline', {})]
    out += [('limit', v, {'limit': v}) for v in LIMITS]
    out += [('message', v, {'msg': v}) for v in MESSAGES + MESSAGES_EXTRA]
    out += [('road', v, {'road': v}) for v in ROADS]
    out += [('clock', v, {'clock': v}) for v in CLOCKS]
    out += [('motion', v, {'motion': v}) for v in MOTIONS]
    out += [('drive-mode', v, {'mode': v}) for v in MODES]
    out += [('program', v, {'sig': {'program': v}}) for v in ('D', 'S', 'M')]
    out += [('msa', str(v), {'sig': {'msa': v}}) for v in range(5)]
    out += [('ambient', v, {'sig': {'ambient': float(v)}}) for v in ('-12.5', '38.0')]
    out += [('coolant', 'cold', {'sig': {'coolant': 20, 'oil': 20}}), ('coolant', 'hot', {'sig': {'coolant': 125, 'oil': 140}})]
    out += [('range', str(v), {'sig': {'range': v}}) for v in (12, 368, 9999)]
    out += [('fuel', 'near-empty', {'sig': {'fuelL': 3, 'range': 40}})]
    # settings
    out += [('ccStyle', v, {'settings': {'ccStyle': v}, 'msg': 'cc-red'}) for v in ('A', 'B')]
    out += [('limitArc', v, {'settings': {'limitArc': v}, 'motion': 'd72-over'}) for v in ('auto', 'on', 'off')]
    out += [('modeLabel', str(v).lower(), {'settings': {'modeLabel': v}}) for v in (True, False)]
    out += [('gearTray', v, {'settings': {'gearTray': v}}) for v in ('gear', 'letter', 'empty')]
    out += [('wbFoot', v, {'settings': {'wbFoot': v}}) for v in ('hair', 'chrome', 'none', 'glass')]
    out += [('dialShade', v, {'settings': {'dialShade': v}}) for v in ('off', 'weak', 'normal', 'strong')]
    out += [('stockMap', str(v).lower(), {'settings': {'stockMap': v}}) for v in (False, True)]
    out += [('night', 'off', {'settings': {'nightDim': 'off'}}), ('night', 'auto', {'settings': {'nightDim': 'auto'}})]
    out += [('night', 'always-' + v, {'settings': {'nightDim': 'always', 'nightLook': v}}) for v in ('plain', 'amber', 'ice', 'red')]
    out += [('coldGuard', str(v).lower(), {'settings': {'coldGuard': v}, 'motion': 'redline', 'sig': {'coolant': 20, 'oil': 20}}) for v in (True, False)]
    out += [('needleSmooth', str(v).lower(), {'settings': {'needleSmooth': v}}) for v in (True, False)]
    return out


# ---- set B: a pairwise covering array over the signal axes ----
def pairwise(domains, seed=7, tries=60):
    """Greedy (AETG-style) covering array: every pair of values of two different axes in at least one row."""
    rnd = random.Random(seed)
    n = len(domains)
    unc = set()
    for i in range(n):
        for j in range(i + 1, n):
            for a in domains[i]:
                for b in domains[j]:
                    unc.add((i, a, j, b))

    def gain(row):
        g = 0
        for i in range(n):
            for j in range(i + 1, n):
                if (i, row[i], j, row[j]) in unc:
                    g += 1
        return g
    rows = []
    while unc:
        best = None
        first = sorted(unc)[rnd.randrange(len(unc))] if len(unc) < 4000 else rnd.choice(sorted(unc))
        for _ in range(tries):
            row = [None] * n
            row[first[0]] = first[1]
            row[first[2]] = first[3]
            order = [k for k in range(n) if row[k] is None]
            rnd.shuffle(order)
            for k in order:
                bv, bg = None, -1
                vals = list(domains[k])
                rnd.shuffle(vals)
                for v in vals:
                    row[k] = v
                    g = sum(1 for m in range(n) if row[m] is not None and m != k and
                            ((m, row[m], k, v) in unc if m < k else (k, v, m, row[m]) in unc))
                    if g > bg:
                        bv, bg = v, g
                row[k] = bv
            g = gain(row)
            if best is None or g > best[0]:
                best = (g, list(row))
        row = best[1]
        rows.append(row)
        for i in range(n):
            for j in range(i + 1, n):
                unc.discard((i, row[i], j, row[j]))
    return rows


B_DOMAINS = {
    'comfort-g20-ours': [LIMITS, MESSAGES, ROADS, list(MOTIONS), CLOCKS],
    # all BMW's row: only motion / message states a photo shows (61/68 D, 63/64 P, 65 standby; 62 two lines, 66 one)
    'comfort-g20-bmw': [LIMITS, ['cc-clear', 'cc-red', 'cc-unread-root'], ROADS, ['d50', 'p-idle', 'p-engine-off', 'standby'], CLOCKS],
}


# ---- set C: scenarios ----
def scenarios():
    S = []
    S.append(('town-50-street', state()))
    S.append(('motorway-130-nopass', state(motion='d130', limit='limit-130-nopass', road='road-shield')))
    S.append(('school-zone-warn2', state(motion='d30', sig={'speed': 38}, limit='limit-30-warn2-school')))
    S.append(('rain-80', state(motion='d50', sig={'speed': 80, 'rpm': 2200, 'gear': 5}, limit='limit-80-rain', road='road-shield')))
    S.append(('mph-55', state(sig={'speed': 88, 'rpm': 2300, 'gear': 5}, limit='limit-55-mph')))
    S.append(('cyrillic-road-long-msg', state(road='road-cyrillic', msg='cc-long')))
    S.append(('three-messages', state(msg='cc-three')))
    S.append(('three-messages-frame-2', state(msg='cc-frame-2')))
    S.append(('msg-over-limit', state(motion='d72-over', msg='cc-red')))
    S.append(('start-up', state(motion='p-idle', limit='limit-none', road='road-none', clock='clock-none', msg='cc-never')))
    S.append(('p-engine-off', state(motion='p-engine-off')))
    S.append(('standby', state(motion='standby', limit='limit-none')))
    S.append(('standby-msg', state(motion='standby', limit='limit-none', msg='cc-red')))
    S.append(('night-amber-msg', state(settings={'nightDim': 'always', 'nightLook': 'amber'}, msg='cc-yellow')))
    S.append(('cold-engine-redline', state(motion='redline', sig={'coolant': 20, 'oil': 20})))
    S.append(('sport-s-program', state(mode='sport', sig={'program': 'S', 'rpm': 4800, 'speed': 100, 'gear': 4}, limit='limit-130-warn1', road='road-shield')))
    S.append(('eco-pro', state(mode='eco', sig={'rpm': 1300, 'speed': 70, 'gear': 6, 'msa': 1}, limit='limit-80-rain')))
    S.append(('guiding', state(road='road-guiding', sig={'speed': 60, 'rpm': 1700, 'gear': 4}, limit='limit-80-rain')))
    S.append(('msa-stopped-at-lights', state(sig={'speed': 0, 'rpm': 0, 'engine': 0, 'msa': 3}, msg='cc-clear')))
    S.append(('end-of-limit-100', state(motion='d130', sig={'speed': 100, 'rpm': 2600}, limit='limit-end', road='road-shield')))
    S.append(('empty-sign-road', state(limit='limit-unknown')))
    S.append(('winter-morning', state(sig={'ambient': -12.5, 'coolant': 30, 'oil': 25, 'range': 12, 'fuelL': 3}, settings={'nightDim': 'always', 'nightLook': 'ice'})))
    return S


DIAG = ['grid', 'mapcal', 'matte_magenta', 'matte_green', 'matte_black']


# ---- jobs ----
def job(set_, ctx, name, st, axis=None, value=None, rel=None):
    msg = st['msg']
    return {'id': '%s/%s/%s' % (set_, ctx, name), 'set': set_, 'context': ctx, 'name': name, 'axis': axis, 'value': value,
            'rel': rel, 'state': st, 'fresh': msg in FRESH, 'latching': msg in LATCHING}


def plan():
    """-> list of groups; each group is a list of jobs on one context, run after a restart."""
    groups = []
    for ctx in CONTEXT_ORDER:
        by_axis = {}
        for axis, value, ov in axes():
            st = state(**{k: v for k, v in ov.items()})
            by_axis.setdefault(axis, []).append(job('A', ctx, '%s/%s' % (axis, value), st, axis, value,
                                                    'A-sweeps/%s/%s/%s' % (ctx, axis, value)))
        for axis, jobs in by_axis.items():
            groups.append(jobs)
    for ctx, doms in B_DOMAINS.items():
        rows = pairwise(doms)
        jobs = []
        for lim, msg, road, mot, clk in rows:
            name = '%s__%s__%s__%s__%s' % (lim, msg, road, mot, clk)
            jobs.append(job('B', ctx, name, state(limit=lim, msg=msg, road=road, motion=mot, clock=clk), rel='B-pairs/%s/%s' % (ctx, name)))
        # chunks of about a dozen; a latching or fresh job costs a restart anyway
        for i in range(0, len(jobs), 12):
            groups.append(jobs[i:i + 12])
    for ctx in CONTEXT_ORDER:
        jobs = [job('C', ctx, '%02d-%s' % (i + 1, n), st, rel='C-scenarios/%s/%02d-%s' % (ctx, i + 1, n)) for i, (n, st) in enumerate(scenarios())]
        for i in range(0, len(jobs), 8):
            groups.append(jobs[i:i + 8])
    groups.append([job('D', 'diag', d, state(settings={'hudLayout': d, 'g20': False}), rel='D-diagnostics/%s' % d) for d in DIAG])
    # within a group: the fresh states first (right after the group's restart), the latching ones last
    out = []
    for g in groups:
        g = sorted(g, key=lambda j: (0 if j['fresh'] else 2 if j['latching'] else 1))
        out.append(g)
    return out


def context_settings(ctx):
    if ctx == 'diag':
        return dict(COMMON, hudLayout='grid', g20=False, bottomRow='allG20')
    return dict(CONTEXTS[ctx])


def active_for(ctx, st):
    if ctx == 'diag':
        return st['settings'].get('hudLayout')
    return ACTIVE[ctx]


# ---- the car backdrop (section 1): which rectified photo of the stock cluster fits the state ----
PHOTOS = {
    '61': {'motion': 'D', 'sign': ('limit', 50, 'kmh'), 'road': True, 'msg': 0},
    '62': {'motion': 'P', 'sign': ('limit', 50, 'kmh'), 'road': None, 'msg': 2},
    '63': {'motion': 'P-off', 'sign': ('limit', 50, 'kmh'), 'road': False, 'msg': 0},
    '64': {'motion': 'P', 'sign': ('limit', 30, 'kmh'), 'road': True, 'msg': 0},
    '65': {'motion': 'standby', 'sign': ('none',), 'road': False, 'msg': 0},
    '66': {'motion': 'P', 'sign': ('limit', 30, 'kmh'), 'road': None, 'msg': 1},
    '67': {'motion': 'P', 'sign': ('limit', 30, 'kmh'), 'road': True, 'msg': 0},
    '68': {'motion': 'D', 'sign': ('unknown',), 'road': True, 'msg': 0},
}


def fed_facts(st):
    """What BMW's own row would show for this state, in the photos' terms."""
    m = st['motion']
    sig = dict(MOTIONS[m], **st['sig'])
    if m == 'standby':
        motion = 'standby'
    elif sig.get('condition') == 7 or (sig.get('gear') == 0 and sig.get('rpm', 0) < 150):
        motion = 'P-off'
    elif sig.get('gear') == 0:
        motion = 'P'
    else:
        motion = 'D'
    w = SIGN_WANT[st['limit']]
    if w['state'] == 'limit':
        sign = ('limit', w['shown'], w.get('unit', 'kmh'))
    else:
        sign = (w['state'],)
    if w.get('np', 'none') not in ('none', None) or w.get('supp') or w.get('warn'):
        sign = sign + ('extra',)
    msg = st['msg']
    shown = msg not in ('cc-clear', 'cc-never')
    lines = 0 if not shown else CC_LINES.get(msg, 2)
    road = ROAD_WANT[st['road']][0] != ''
    return {'motion': motion, 'sign': sign, 'road': road, 'msg': lines}


def backdrop(st, ctx):
    if ctx == 'diag':
        return ('60' if st['settings'].get('hudLayout') == 'grid' else '61'), False
    f = fed_facts(st)

    def ok(pid):
        p = PHOTOS[pid]
        return (p['motion'] == f['motion'] and p['sign'] == f['sign'] and p['msg'] == f['msg']
                and (p['road'] is None or f['msg'] or p['road'] == f['road']))
    exact = [p for p in sorted(PHOTOS) if ok(p)]
    if exact:
        return exact[0], True
    if f['motion'] == 'standby':
        return '65', False
    if f['msg']:
        return ('66' if f['msg'] == 1 else '62'), False
    if f['motion'] == 'P-off':
        return '63', False
    if f['motion'] == 'P':
        return '64', False
    return ('68' if f['sign'] == ('unknown',) else '61'), False
