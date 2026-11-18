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
    groups += plan_r3()
    return groups


# ---- E: round 3 (Twin Dial 0.1.1): live tabs, the centre pages, the speed limit, cruise / limiter ----
# Raw fields go in through POST /fake {feed} in the shapes the car showed (bench/twin-centre-states.js, bench/test-twin-limit.js);
# every text is invented and neutral, only the enums and the numbers' kind are the car's.
IF_MEDIA = 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState'
IF_TUNER = 'de.bmw.infotainment.tuner.fmamdab.tunerfmamdab.TunerFmAmDab'
IF_PLAYER = 'de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer'
IF_AGG = 'de.bmw.infotainment.connectivity.telephony.ConnectivityAggregator'
IF_GUIDING = 'de.bmw.infotainment.navigation.navigationstatus.NavigationStatus'
IF_GUIDANCE = 'de.bmw.infotainment.navigation.guiding.Guidance'
IF_DDS = 'de.bmw.infotainment.displaydataserver.DisplayDataServer'
IF_LIGHT = 'de.bmw.body.Light'


def feed(iface, field, value):
    return {'feed': {'iface': iface, 'field': field, 'value': value}}


def i64(n):
    return {'low': n, 'high': 0}


def media_fakes(sel):
    """The car's media set: the HMI's lines, the menu (sel 7 = CarPlay, 4 = FM), the tuner's station, the CarPlay player."""
    menu = [['MUSIC_COLLECTION', 1], ['BLUETOOTH', 2], ['PRESETS', 3], ['FM', 4], ['AM', 5], ['MIRACAST', 6], ['CARPLAY', 7]]
    return [
        feed(IF_MEDIA, 'playerMetadata', {'sink': 'FRONT', 'uiType': 'TWO_LINES', 'menuEntry': i64(7), 'trackId': i64(1), 'firstLineType': 'ARTIST',
                                          'firstLineText': 'Гурт Приклад', 'secondLineType': 'ALBUM', 'secondLineText': 'Альбом Приклад', 'threeRowText': ''}),
        feed(IF_MEDIA, 'trackProgress', {'sink': 'FRONT', 'menuEntry': i64(7), 'trackId': i64(1), 'elapsed': '?', 'total': '?', 'hasProgress': True, 'isSeekable': False}),
        feed(IF_MEDIA, 'menu', {'sink': 'FRONT', 'selectedEntryId': i64(sel),
                                'menuEntries': [{'id': i64(e[1]), 'name': 'Пункт меню', 'iconKind': e[0], 'enabled': True, 'subentries': []} for e in menu]}),
        feed(IF_TUNER, 'currentStationFmDabAm', {'stationListEntry': {'waveBand': 'WB_FM', 'receptionMode': 'ANALOG', 'frequencyKhz': 101700, 'positionNumber': 0,
                                                                      'tp': 'TPS_NO_TP', 'stationShortName': 'Приклад', 'stationLongName': 'Радіо Приклад'},
                                                 'radioTextName': "Новини о дев'ятій"}),
        feed(IF_PLAYER, 'playerState', 'PLAYER_STATE_PLAY' if sel == 7 else 'PLAYER_STATE_PAUSE'),
        feed(IF_PLAYER, 'currentItemPosition', {'position': 0, 'totalNumber': 0}),
        feed(IF_PLAYER, 'currentItemMetadata', [{'key': 'ARTIST', 'value': {'stringValue': 'Гурт Приклад'}}, {'key': 'ALBUM', 'value': {'stringValue': 'Альбом Приклад'}},
                                                {'key': 'TITLE', 'value': {'stringValue': 'Ранкова хвиля'}}]),
        feed(IF_PLAYER, 'currentItemTime', {'elapsed': 25583, 'total': 184785}),
    ]


def route_fakes():
    """A route led by CarPlay, as the car showed it: the provider, an empty manoeuvre, the destination block, a road."""
    return [
        feed(IF_GUIDING, 'guidingState', 'INACTIVE'),
        feed(IF_GUIDANCE, 'guidingProvider', 'CAR_PLAY'),
        feed(IF_GUIDANCE, 'conclusiveDart', {'maneuver': {'pointOfInterest': {}}, 'bargraphProgress': 0}),
        feed(IF_GUIDANCE, 'currentLaneGuiding', {'rows': [], 'carPositionLaneIndex': 0}),
        feed(IF_GUIDANCE, 'currentRoad', {'elements': [{'text': 'вулиця Тестова'}]}),
        feed(IF_GUIDANCE, 'isOnGuidableRoad', True),
        feed(IF_GUIDANCE, 'nextDestinationInfo', {'travelTime': 660, 'delayTime': 0, 'delayStatus': 'UNDEFINED',
                                                  'formattedDistance': {'distance': '5.7', 'unit': 'KM', 'rawDistance': 5700},
                                                  'distanceFromCurrentToFinalDestination': 0, 'isCheckeredFlag': True, 'stopOverNumber': 0,
                                                  'estimatedArrivalTime': {'time': {'invalid': False, 'hour': 14, 'minute': 54},
                                                                           'includedTimeOffset': {'valid': False, 'timeZoneOffset': 120}}}),
    ]


def hud_fake(sym, colour, kmh, speed, rpm=2400):
    """DisplayDataServer.functionalLibraryData: the cruise / limiter set speed and its symbol (bench/test-twin-limit.js hudEv)."""
    return feed(IF_DDS, 'functionalLibraryData', {
        'speed': {'kmH': speed, 'mlsH': 0}, 'activeCruiseControl': {'symbolACC': 'LDM_CAR_OFF', 'accBarsHUD': 0, 'barsColorACC': 'LDM_OFF'},
        'xSpeedLimitAssist': {'vSLISymbol': 'LDM_VZA_VSLI_NO_SYMBOL', 'vSLISpeedValue': 0}, 'system': {'modeHUD': 0, 'statusHUD': 'HUDSTATUS_OFF'},
        'rpm': rpm, 'currentGear': 0, 'ldmSym': sym, 'ldmSymColor': colour, 'statusLimiter': 'STATUS_INACTIVE', 'cruiseCtrlSpeedHUD': kmh})


def tsr(cls, warn=0):
    return {'tsr': {'cls': cls, 'warn': warn}}


def plan_r3():
    def e(tag, fakes=None, settings=None, volatile=False, **kw):
        st = state(tag=tag, **kw)
        st['fakes'] = fakes or []
        if settings:
            st['settings'] = settings
        return job('E', st, expect={'volatile': True} if volatile else {})

    g = []
    # tab 1: the on-board computer's pages, the technical data shown and hidden
    g.append([e('tab1_clock', settings={'tab': '1'}), e('tab1_trip', settings={'tab': '1'}, centre='trip'),
              e('tab1_tech', settings={'tab': '1', 'centre': 'tech'}), e('tab1_tech_hidden', settings={'tab': '1', 'centre': 'tech', 'techData': 'hide'})])
    # tab 2: one message (the card), two stored messages (the rows)
    one = e('tab2_card', msg='ours')
    # the rows page two ways: the driver steps to tab 2 with the TRIP key (standing: the key is locked above 5 km/h), and the
    # setting "Таба = 2"
    key = e('tab2_rows_key', msg='rows', engine='ready',
            fakes=[feed(IF_LIGHT, 'IndicatorSteeringColumn', {'operationColumnStalks': 0}), {'sleep': 0.3},
                   feed(IF_LIGHT, 'IndicatorSteeringColumn', {'operationColumnStalks': 64}), {'sleep': 0.15},
                   feed(IF_LIGHT, 'IndicatorSteeringColumn', {'operationColumnStalks': 0})])
    rows = e('tab2_rows_setting', msg='rows', settings={'tab': '2'})
    for j in (key, rows):
        j['state']['messages'] = [DOOR, TYRE]
    g.append([one])
    g.append([key])
    g.append([rows])
    # tab 3: CarPlay playing, the radio
    g.append([e('tab3_carplay', fakes=media_fakes(7), settings={'tab': '3'}, volatile=True)])
    g.append([e('tab3_radio', fakes=media_fakes(4), settings={'tab': '3'})])
    # tab 4: no call; a call (the rule selects the tab by itself)
    g.append([e('tab4_phone', settings={'tab': '4'}),
              e('tab4_call_auto', fakes=[feed(IF_AGG, 'aggregatedCallState', 'DIALING'), {'sleep': 0.6}, feed(IF_AGG, 'aggregatedCallState', 'ACTIVE')], volatile=True)])
    # tab 5: nothing to show; a route led by CarPlay (fixed tab, then the rule's own choice)
    g.append([e('tab5_none', settings={'tab': '5'}), e('tab5_route', fakes=route_fakes(), settings={'tab': '5'})])
    g.append([e('tab5_route_auto', fakes=route_fakes())])
    def L(tag, **kw):         # the limit and cruise scenes stand on tab 1 (a bench keeps the last tab over a restart)
        return e(tag, settings={'tab': '1'}, **kw)

    # the speed limit: the sign and the marker; the strip (L2) red between the limit and the needle while over
    g.append([L('limit_50_under', fakes=[tsr(10)], sig={'speed': 47, 'rpm': 1600}), L('limit_50_over', fakes=[tsr(10)], sig={'speed': 63, 'rpm': 2000}),
              L('limit_50_over_warn', fakes=[tsr(10, 1)], sig={'speed': 87}), L('limit_130', fakes=[tsr(26)], sig={'speed': 124, 'rpm': 2600}),
              L('limit_none', fakes=[tsr(255)])])
    # cruise and the limiter in the speedometer's hub (C1): active (green), not active (grey), the limiter; all of it with a limit
    g.append([L('cruise_90', fakes=[hud_fake('LDM_SYM_DCC', 'LDM_ACTIVE', 90, 87)]), L('cruise_90_off', fakes=[hud_fake('LDM_SYM_DCC', 'LDM_OFF', 90, 87)]),
              L('limiter_60', fakes=[hud_fake('LDM_SYM_SLD', 'LDM_ACTIVE', 60, 52)], sig={'speed': 52, 'rpm': 1700}),
              L('limit_50_cruise_60', fakes=[tsr(10), hud_fake('LDM_SYM_DCC', 'LDM_ACTIVE', 60, 58)], sig={'speed': 58, 'rpm': 1900})])
    # night: the same pages in the night look
    g.append([L('night_limit_50_cruise_60', look='night', fakes=[tsr(10), hud_fake('LDM_SYM_DCC', 'LDM_ACTIVE', 60, 58)], sig={'speed': 58, 'rpm': 1900})])
    g.append([e('night_tab3_carplay', look='night', fakes=media_fakes(7), settings={'tab': '3'}, volatile=True)])
    g.append([e('night_tab5_route', look='night', fakes=route_fakes(), settings={'tab': '5'})])
    return g


def want_settings(st):
    # round 3: the tab, the technical data and the navigation view go back to their defaults unless the scene sets them
    s = {'centre': st['centre'], 'nightLook': LOOKS[st['look']], 'demo': 'on' if st['demo'] else 'off',
         'tab': 'auto', 'techData': 'show', 'navView': 'auto', 'redline': 6500, 'bandGain': 1.0}     # D's two settings too: a bench keeps them over a restart
    s.update(st.get('settings') or {})
    return s
