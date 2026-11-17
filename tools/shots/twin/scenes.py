"""tools/shots/twin: what to photograph (SPEC section 16) and what to feed for it.

The matrix: {day, night} x {no message, ours, window, blind} x {clock, trip} x {engine off, ready, driving} = 48
pictures, plus: the mockup's four scenes that the matrix does not already hold (M2, M3), the dial-law sweeps (needle
angle measured against SPEC sections 5.1 / 5.2), the demo setting, and the keep-out view. One group = one bench
restart: the D7 latch (SPEC section 8.4) is sticky, so the message states of one (look, centre, engine) cell run in the
only order that works after a restart: blind (nothing ever fed), window (a ccList entry, the cluster never said "shown
now"), ours (a "shown now" number that matches an entry, then a second message: the plate), none.

Every text fed is invented (or the mockup's own, made-up one); nothing here comes off a photo or the car. Standard
library only.
"""

# ---- the numbers of the mockup (tools/twin-dial/mockup/mockup.py render() defaults) ----
TANK_L = 59.0
BASE = {                      # fed through POST /signals "manual" (bench/run-app.js raw scaling)
    'coolant': 92, 'oil': 95, 'ambient': 7.5, 'range': 412, 'fuelL': 38, 'reserve': 0, 'odometer': 48215, 'program': 'D',
    'tyreP': 2.3, 'tyreT': 24,
}
ENGINES = {
    'off': dict(BASE, rpm=0, speed=0, gear=0, engine=0, condition=7),
    'ready': dict(BASE, rpm=800, speed=0, gear=0, engine=2, condition=10),
    'driving': dict(BASE, rpm=2400, speed=87, gear=3, engine=2, condition=10),
}
DRIVE_COMFORT = 4             # POST /drive: the drive-mode wire number (1 Sport, 4 Comfort, 7 Eco Pro)
LOOKS = {'day': 'off', 'night': 'on'}       # the setting nightLook (auto | on | off)
MSGS = ['blind', 'window', 'ours', 'none']  # the order that works after a restart
CENTRES = ['clock', 'trip']
ENGINE_ORDER = ['off', 'ready', 'driving']
EXPECT_CC = {'blind': 'window', 'window': 'window', 'ours': 'ours', 'none': 'none'}

# the invented messages (id, colour, symbol id as the car numbers them; names are the mockup's own)
DOOR = {'id': 15, 'name': 'Водійські двері відчинено', 'color': 'white', 'symbol': 2}
TYRE = {'id': 50, 'name': 'Тиск у шинах: перевірте', 'color': 'yellow', 'symbol': 44}
REST = {'id': 0, 'name': 'Усе гаразд', 'color': 'green', 'symbol': 6}

# what the other fields carry (the mockup's invented values; the trip scale is unseen, probe P4)
TWIN = {
    'units': 'km',
    'media': {'first': 'Радіо FM 101.7', 'second': '', 'source': 'FM', 'firstType': 'TITLE'},
    'phone': None, 'guiding': None,
    'trip': {'speed1': 41, 'cons1': 6.8, 'speed2': 41, 'cons2': 6.8, 'hours': 0, 'minutes': 43, 'km': 12.4,
             'depart': {'hour': 14, 'minute': 0, 'day': 17, 'month': 11, 'year': 2026}},
}
CLOCK_MINUTES = 120           # Kyiv in November: UTC + 2; bench started at BENCH_NOW 12:43 UTC = 14:43 local
BENCH_NOW = '2026-11-17T12:43:00Z'


def state(**kw):
    s = {'look': 'day', 'msg': 'none', 'centre': 'clock', 'engine': 'driving', 'demo': False, 'sig': {}, 'drive': DRIVE_COMFORT, 'tag': None}
    s.update(kw)
    return s


def name_of(s):
    if s.get('tag'):
        return s['tag']
    if s['demo']:
        return 'demo-%s' % s['look']
    return '%s_%s_%s_%s' % (s['look'], s['msg'], s['centre'], s['engine'])


def signals_of(s):
    v = dict(ENGINES[s['engine']])
    v.update(s['sig'])
    return v


def job(set_, st, rel=None, expect=None):
    n = name_of(st)
    return {'id': '%s/%s' % (set_, n), 'set': set_, 'name': n, 'state': st, 'rel': rel or '%s/%s' % (set_, n), 'expect': expect or {}}


def plan():
    """-> list of groups (lists of jobs); a group starts from a bench restart."""
    groups = []
    # A: the matrix, one group per (look, centre, engine)
    for look in LOOKS:
        for centre in CENTRES:
            for eng in ENGINE_ORDER:
                g = []
                for msg in MSGS:
                    g.append(job('A', state(look=look, msg=msg, centre=centre, engine=eng), expect={'cc': EXPECT_CC[msg]}))
                groups.append(g)
    # B: the mockup's own scenes the matrix does not hold. M1 = day/none/clock/driving, M4 = day/ours/trip/driving
    # (the matrix cells; the comparison finds them by name), M2 and M3 are fed here
    m2 = job('B', state(centre='trip', tag='M2_trip', sig={'speed': 112, 'rpm': 3100}), expect={'cc': 'none'})
    m3 = job('B', state(msg='ours', centre='clock', tag='M3_door_info'), expect={'cc': 'ours'})
    m3['state']['message'] = DOOR
    groups.append([m2])
    groups.append([job('B', state(msg='window', tag='M3_door_window'), expect={'cc': 'window'}), m3])
    groups[-1][0]['state']['message'] = DOOR
    # C: the dial laws: day, clock, no message; engine running
    law = []
    for r in (0, 500, 1000, 2000, 3000, 4000, 5000, 6000, 6500, 7000, 8000, 9000):
        law.append(job('C', state(tag='law_tach_%d' % r, sig={'rpm': r, 'speed': 0, 'gear': 0, 'engine': 2, 'condition': 10}), expect={'tach_rpm': r}))
    for v in (0, 20, 40, 60, 80, 100, 140, 180, 220, 260, 300, 330):
        law.append(job('C', state(tag='law_speed_%d' % v, sig={'speed': v, 'rpm': 1500, 'gear': 3 if v else 0}), expect={'speed_kmh': v}))
    groups.append(law)
    # D: the settings the SPEC names: demo (the kit's demo drive: values move, so the picture is volatile), redline
    groups.append([job('D', state(demo=True), expect={'volatile': True}), job('D', state(demo=True, look='night'), expect={'volatile': True})])
    groups.append([job('D', state(tag='redline_5000', sig={'rpm': 5200}), expect={}), ])
    groups[-1][0]['state']['settings'] = {'redline': 5000}
    groups.append([job('D', state(tag='bandgain_16', ), expect={})])
    groups[-1][0]['state']['settings'] = {'bandGain': 1.6}
    return groups


def want_settings(st):
    s = {'centre': st['centre'], 'nightLook': LOOKS[st['look']], 'demo': 'on' if st['demo'] else 'off'}
    s.update(st.get('settings') or {})
    return s
