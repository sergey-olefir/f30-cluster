"""tools/road: the Road View test modes in the REAL apps on a bench, as pictures (round "Road View", package TD).

    UV_CACHE_DIR=$F30/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl \\
        python -I tools/road/shots.py [--app twin_dial|f30_cluster|both] [--port 8983] [--only <substring>] [--out <dir>]

For each state: the app's settings (layout, language, units, tab, the Діагностика tests in 'car' mode), the car's RAW messages fed
through POST /fake {feed} (the same decoder as on the car: shared/road_view.js), a snapshot of the scene (tools/strip/O/snap.py)
and the frame drawn by the apps' own shaders on the Mac's GPU (tools/strip/O/render.py), 1920 x 720, with BMW's own areas outlined
(cyan: telltales and black box, BMW's message panel, the gear gap, BMW's own sign place) and ours (magenta: the Road View layers).
Every value fed is made up; every road name is invented. Ports 8981-8989 only (this package's).

BENCH_CONFIG holds the states still (the stale times of road_view.js are 1 s for the light: a snapshot takes longer); the stale
rules themselves are proven by bench/test-road-view.js. Output (git-ignored): bake/work/road/shots/<app>/<name>.png, plus crops
(<name>.strip.png, <name>.scene.png) and shots.json (every picture with its state and the probe's answer).
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'strip', 'O'))


def arg(name, dflt=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else dflt


PORT = int(arg('--port', '8983'))
if not 8981 <= PORT <= 8989:
    raise SystemExit('ports 8981-8989 only')
os.environ['BENCH_PORT'] = str(PORT)
import benchio as B   # noqa: E402
import snap as SNAP   # noqa: E402

LONG = 7200000
CONFIG = {'roadView': {'lightCfg': {'staleMs': LONG, 'confirm': 1},
                       'signsCfg': {'stretchMs': LONG, 'announceMs': LONG, 'pointMs': LONG, 'warnMs': LONG, 'endMs': LONG},
                       'sceneCfg': {'lanes': {'staleMs': LONG}, 'objects': {'lostMs': LONG, 'fadeMs': 1000}, 'lca': {'holdMs': LONG}, 'absentMs': LONG}},
          'frontVehicle': {'staleMs': LONG, 'absentMs': 3000},
          'trip': {'factors': {'bc': 1, 'speed': 0.1, 'cons': 0.1, 'way': 0.1}}}

IF = {
    'light': 'de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy',
    'signCam': 'de.bmw.environmentalmodel.SignRecognitionFrontCamera',
    'tsr': 'de.bmw.dass.TrafficSignRecognition',
    'lanes': 'de.bmw.environmentalmodel.LaneBoundaries',
    'objects': 'de.bmw.environmentalmodel.ObjectRecognitionFrontCamera',
    'lca': 'de.bmw.dass.driverassistanceapplications.AssistedDrivingViewLateralCollisionAvoidance',
    'dds': 'de.bmw.infotainment.displaydataserver.DisplayDataServer',
}
# the light's raw codes as road_view.js DEFAULT assumes them (TR-REPORT A.3.1)
LIGHT = {'red': (1, 1, 0), 'redAmber': (4, 1, 0), 'amber': (2, 1, 0), 'green': (3, 1, 0), 'greenLeft': (3, 1, 1), 'greenStraight': (3, 1, 2),
         'greenRight': (3, 1, 3), 'flashAmber': (2, 2, 0), 'uncertain': (1, 1, 0)}
SIGN_TYPE = {'noOvertaking': 'NO_PASSING_SIGN', 'noOvertakingEnd': 'WITHDRAWAL_NO_PASSING_SIGN', 'town': 'CITY_LIMIT_START_OF', 'townEnd': 'CITY_LIMIT_END_OF',
             'motorway': 'MOTORWAY_START_OF', 'motorwayEnd': 'MOTORWAY_END_OF', 'expressway': 'EXPRESSWAY_START_OF', 'expresswayEnd': 'EXPRESSWAY_END_OF',
             'envZone': 'ENVIRONMENTAL_ZONE_START_OF', 'envZoneEnd': 'ENVIRONMENTAL_ZONE_END_OF', 'stop': 'STOP_SIGN', 'giveWay': 'GIVE_WAY',
             'priority': 'PRIORITY_ROAD_START_OF', 'priorityEnd': 'PRIORITY_ROAD_END_OF', 'noEntry': 'NO_ENTRY', 'crossing': 'DS_PEDESTRIAN_CROSSING',
             'children': 'DS_CHILDREN', 'roadWorks': 'DS_ROAD_WORKS', 'lightAhead': 'DS_TRAFFIC_LIGHT', 'levelCrossing': 'DS_TRAIN_CROSS_WITH_BARRIER',
             'slippery': 'DS_SPLIPPERY_ROAD', 'animals': 'DS_ANIMAL_CROSSING'}


def feed(iface, field, value):
    return {'feed': {'iface': iface, 'field': field, 'value': value}}


def f_light(state):
    col, st, arr = LIGHT[state]
    q = 6 if state == 'uncertain' else 11
    v = {'trafficLightID': 3, 'trafficLightPositionX': 40, 'trafficLightPositionY': 128, 'trafficLightPositionZ': 50, 'trafficLightStatus': st,
         'trafficLightArrow': arr if arr else 15, 'trafficLightIndicateDirection': 1, 'trafficLightColor': col, 'qualityRecognitionTrafficLight': q}
    return [feed(IF['light'], 'RecognitionTrafficLightCamera', v)] * 2


def f_tsr(kmh, nopass=0):
    """The limit's own event, raw: presentClassLimitSpeed x 5 = km/h (255: none), recognitionNoPassing (0 none, 1 on: assumed)."""
    v = {'presentWithdrawalLimitSpeed': 1, 'recognitionNoPassing': nopass, 'nextWithdrawalLimitSpeed': 3, 'presentClassLimitSpeed': 255 if kmh is None else int(kmh / 5),
         'nextClassLimitSpeed': 254, 'countryCodingTrafficSign': 0, 'displayTextMessage': 0, 'unitOfMeasurementSpeedLimit': 0, 'displayTextMessageNpi': 0,
         'statusDataMatchingCameraADAS': 0, 'statusStreetTyp': 0, 'evaluationStreetTyp': 0, 'displaySupplementalSign': 0, 'triggerPresentClassLimitSpeed': 0,
         'displaySpeedNPIDistance': 255, 'controlSLIWarning': 0}
    return [feed(IF['tsr'], 'TrafficSignRecognition', v)]


def f_signs(ids):
    lst = [{'timestamp': 1, 'value': 0, 'type': SIGN_TYPE[i]} for i in ids]
    return [feed(IF['signCam'], 'TrafficSignRecognitionFrontCamera', {'eventDataQualifier': 'EVENT_DATA_AVAILABLE', 'extendedQualifier': 'NORMAL_OPERATION_MODE',
            'trafficSignRecognition': {'version': 1, 'visibilityCondition': 'REGULAR_ENVIRONMENT_CONDITIONS', 'numberSigns': len(lst), 'speedLimitUnit': 'KM_H'}, 'trafficSign': lst})]


def f_lanes(n=1, curve=0.0, none=False):
    if none:
        return []
    ys = [(k + 0.5) * 3.5 for k in range(-n - 1, n + 1)]
    ys.sort(reverse=True)
    ys = ys[:4]
    b = [{'modelQualifier': 0, 'existenceProbability': 0.95, 'pointSegment1': {'y': y}, 'baseSegment1': {'angle': 0, 'curvature': curve},
          'parametersSegment1': {'validLength': 90, 'curvatureChange': 0}} for y in ys]
    t = [{'typeInfo': {'type': 'ROAD_EDGE' if i in (0, len(ys) - 1) else 'DASHED'}} for i in range(len(ys))]
    return [feed(IF['lanes'], 'LaneBoundaries', {'laneBoundaryFront': b, 'laneBoundaryPropertiesFront': t})]


CLS = {'car': 'CAR_WITH_OR_WITHOUT_TRAILER', 'truck': 'TRUCK_BUS_VAN', 'two': 'BIKE_MOTORBIKE_MOPED', 'ped': 'PEDESTRIAN', 'cyc': 'CYCLIST'}


def f_objects(objs):
    rec = {'objectRecognitionInfo': [{'classificationType': CLS[o[0]], 'objectID': i + 1} for i, o in enumerate(objs)]}
    pos = {'numberOfObjects': len(objs), 'objectPositionInfo': [{'positionX': o[1], 'positionY': o[2]} for o in objs]}
    return [feed(IF['objects'], 'ObjectRecognition', rec), feed(IF['objects'], 'ObjectPosition', pos)]


def f_lca(left=False, right=False):
    return [feed(IF['lca'], 'assistedDrivingViewLcaInput', {'statusLaneChangeWarning': {'qualifierLaneChangeWarning': 'FUNCTION_ACTIVE',
            'statusLaneChangeWarningLeft': 'WARNING_LEFT' if left else 'NO_WARNING_LEFT', 'statusLaneChangeWarningRight': 'WARNING_RIGHT' if right else 'NO_WARNING_RIGHT',
            'objectId1LaneChangeWarningLeft': 0, 'objectId2LaneChangeWarningLeft': 0, 'objectId3LaneChangeWarningLeft': 0,
            'objectId1LaneChangeWarningRight': 0, 'objectId2LaneChangeWarningRight': 0, 'objectId3LaneChangeWarningRight': 0}})]


def f_cruise(kmh=90, speed=60):
    return [feed(IF['dds'], 'functionalLibraryData', {'speed': {'kmH': speed, 'mlsH': 0}, 'activeCruiseControl': {'symbolACC': 'LDM_CAR_OFF', 'accBarsHUD': 0, 'barsColorACC': 'LDM_OFF'},
            'xSpeedLimitAssist': {'vSLISymbol': 'LDM_VZA_VSLI_NO_SYMBOL', 'vSLISpeedValue': 0}, 'system': {'modeHUD': 0, 'statusHUD': 'HUDSTATUS_OFF'},
            'rpm': 1800, 'currentGear': 0, 'ldmSym': 'LDM_SYM_DCC', 'ldmSymColor': 'LDM_ACTIVE', 'statusLimiter': 'STATUS_INACTIVE', 'cruiseCtrlSpeedHUD': kmh})]


SCENES = {
    'empty': lambda: f_lanes(1),
    'ahead': lambda: f_lanes(1) + f_objects([('car', 26, 0.1)]),
    'traffic': lambda: f_lanes(1, 1 / 700.0) + f_objects([('car', 30, 0.1), ('truck', 24, 3.5), ('car', 45, -3.5), ('two', 60, 3.4), ('car', 70, -3.6)]) + f_lca(left=True, right=True),
    'lightRed': lambda: f_lanes(1) + f_objects([('car', 14, 0.0), ('car', 16, 3.5), ('ped', 32, -6.0)]) + f_light('red'),
    'lightGreen': lambda: f_lanes(1) + f_objects([('car', 28, 0.0), ('car', 34, -3.5)]) + f_light('green'),
    'nolanes': lambda: f_objects([('car', 26, 0.2), ('ped', 14, -4.5)]),
}

# ---------------------------------------------------------------------------------------------- the states


def S(name, *, light=None, signs=(), limit=50, nopass=0, scene=None, tests=('light', 'signs'), look='day', lang='uk', units='km', extra=(), settings=None, fakes=None, speed=40):
    return dict(name=name, light=light, signs=list(signs), limit=limit, nopass=nopass, scene=scene, tests=list(tests), look=look, lang=lang, units=units,
                extra=list(extra), settings=settings or {}, fakes=fakes, speed=speed)


def plan(app):
    out = []
    lay = {'twin_dial': {}, 'f30_cluster': {'hudLayout': 'wb_comfort', 'byMode': False}}[app]
    base = dict(settings=dict(lay))
    # baseline: every test off
    out.append(S('000_off', tests=()))
    # the light, every state
    for k in ['red', 'redAmber', 'amber', 'green', 'greenLeft', 'greenStraight', 'greenRight', 'flashAmber', 'uncertain']:
        out.append(S('1%02d_light_%s' % (len(out), k), light=k, tests=('light',)))
    # the strip's combinations
    out.append(S('200_limit_alone', tests=('light', 'signs')))
    out.append(S('201_limit_rule', signs=['stop']))
    out.append(S('202_limit_rule_warning', signs=['giveWay', 'children']))
    out.append(S('203_limit_light', light='red'))
    out.append(S('204_light_alone', light='green', limit=None))
    out.append(S('205_nopass_tsr', nopass=1))
    out.append(S('206_nopass_tsr_light_warning', nopass=1, light='amber', signs=['crossing']))
    out.append(S('207_town_roadworks', signs=['town', 'roadWorks']))
    # every sign of the set, as the rule or the warning
    # a sample of the set in context (the atlas sheet shows every drawing)
    for i, sid in enumerate(SIGN_TYPE):
        if sid in ('noOvertakingEnd', 'town', 'townEnd', 'motorway', 'envZone', 'priority', 'noEntry', 'levelCrossing', 'animals', 'slippery'):
            out.append(S('3%02d_sign_%s' % (i, sid), signs=[sid]))
    # night, English, mph
    out.append(S('400_night_light_rule', light='red', signs=['noOvertaking'], look='night'))
    out.append(S('401_en_mph_light_warning', light='green', signs=['crossing'], lang='en', units='mi', limit=None, extra=f_tsr(80, 0)))
    out.append(S('402_night_en_uncertain', light='uncertain', signs=['stop'], look='night', lang='en'))
    # the road scene, six situations (+ night, + English)
    for k in SCENES:
        out.append(S('5%02d_scene_%s' % (list(SCENES).index(k), k), scene=k, tests=('scene',)))
    out.append(S('510_scene_traffic_night', scene='traffic', tests=('scene',), look='night'))
    out.append(S('511_scene_light_all_en', scene='lightRed', tests=('scene', 'light', 'signs'), signs=['lightAhead'], lang='en'))
    # collisions with what lives nearby
    if app == 'twin_dial':
        out.append(S('600_coll_cruise', light='red', signs=['stop', 'children'], extra=f_cruise(90)))
        out.append(S('601_coll_frontvehicle', light='green', signs=['priority'], settings={'diagFrontVehicle': True}, fakes=[{'front': {'gap': 280, 'speed': 1500, 'obj': 7}}] * 3, speed=87))
        out.append(S('602_coll_message', light='red', signs=['stop'], scene='traffic', tests=('light', 'signs', 'scene'), fakes=[{'scene': 'cc-yellow'}]))
        out.append(S('603_coll_tab3_media', light='amber', signs=['roadWorks'], settings={'tab': '3'}))
        out.append(S('604_coll_tab5_nav', light='red', signs=['giveWay'], settings={'tab': '5'}, fakes=[{'scene': 'road-street'}]))
        out.append(S('605_all_on_night_en_mph', light='red', signs=['noOvertaking', 'crossing'], scene='lightRed', tests=('light', 'signs', 'scene'), look='night', lang='en', units='mi'))
    else:
        for lay2, nm in (('wb_sport', 'sport'), ('wb_eco', 'eco')):
            out.append(S('6%02d_%s_light_rule' % (len(out) % 100, nm), light='red', signs=['stop', 'children'], settings={'hudLayout': lay2, 'byMode': False}))
        out.append(S('620_g20_all6wb_road', light='red', signs=['giveWay', 'crossing'], scene='ahead', tests=('light', 'signs', 'scene'),
                     settings={'hudLayout': 'wb_comfort', 'byMode': False, 'g20': True, 'bottomRow': 'all6WB'}, fakes=[{'road': {'text': 'Р-42 Садова'}}]))
        out.append(S('621_g20_bmw_row_stock_sign', light='amber', signs=['roadWorks'], settings={'hudLayout': 'wb_comfort', 'byMode': False, 'g20': True, 'bottomRow': 'allG20'}))
        out.append(S('622_coll_message', light='red', signs=['stop'], scene='traffic', tests=('light', 'signs', 'scene'), fakes=[{'scene': 'cc-yellow'}]))
        out.append(S('623_stockmap_scene_yields', scene='traffic', tests=('scene', 'light'), light='red', settings={'hudLayout': 'wb_comfort', 'byMode': False, 'stockMap': True}))
        out.append(S('624_all_on_night_en_mph', light='red', signs=['noOvertaking', 'crossing'], scene='lightRed', tests=('light', 'signs', 'scene'), look='night', lang='en', units='mi'))
    return out

# ---------------------------------------------------------------------------------------------- the bench


def start_bench(app, work):
    os.makedirs(os.path.join(work, 'data'), exist_ok=True)
    stop = os.path.join(work, 'STOP')
    if os.path.exists(stop):
        os.remove(stop)
    env = dict(os.environ, BENCH_PORT=str(PORT), BENCH_DATA_DIR=os.path.join(work, 'data'), BENCH_CONFIG=json.dumps(CONFIG))
    p = subprocess.Popen([sys.executable, '-I', os.path.join(ROOT, 'tools', 'shots', 'bounded.py'), '21600', stop, os.path.join(work, 'bench.log'), '--',
                          'node', os.path.join(ROOT, 'bench', 'server.js'), app], cwd=ROOT, env=env)
    want = {'twin_dial': 'twin', 'f30_cluster': None}[app]
    p0 = B.until(lambda q: q.get('ready') and (want is None or q.get('activeName') == want), 3600, 1.0)
    if not p0 or not p0.get('ready'):
        raise SystemExit('bench did not come up: ' + open(os.path.join(work, 'bench.log')).read()[-2000:])
    return p, stop


def setting(key, value):
    B.post('/setting', {'key': key, 'value': value})


def apply(app, st):
    want = {'diagRoadLight': 'car' if 'light' in st['tests'] else 'off', 'diagRoadSigns': 'car' if 'signs' in st['tests'] else 'off',
            'diagRoadScene': 'car' if 'scene' in st['tests'] else 'off'}
    defaults = {'diagFrontVehicle': False, 'lang': st['lang'], 'units': st['units']}
    if app == 'twin_dial':
        defaults.update({'tab': '1'})
    else:
        defaults.update({'hudLayout': 'wb_comfort', 'byMode': False, 'g20': False, 'stockMap': False, 'bottomRow': 'allG20'})
    s = dict(defaults)
    s.update(st['settings'])
    # the tests off first: a new tracker per state (nothing of the state before stays)
    for k in ('diagRoadLight', 'diagRoadSigns', 'diagRoadScene'):
        setting(k, 'off')
    B.fake({'scene': 'cc-clear'})
    for k, v in s.items():
        setting(k, v)
    B.fake({'dayNight': st['look']})
    B.signals({'speed': st['speed'], 'rpm': 1600, 'gear': 3, 'engine': 2, 'condition': 10})
    time.sleep(0.6)
    for k, v in want.items():
        setting(k, v)
    on = [k for k in ('light', 'signs', 'scene') if k in st['tests']]
    B.until(lambda q: (q.get('road') or {}).get('modes') and all(((q['road']['modes'] or {}).get(k) == 'car') == (k in on) for k in ('light', 'signs', 'scene')), 15)
    time.sleep(1.0)
    msgs = []
    msgs += f_tsr(st['limit'], st['nopass'])
    if st['light']:
        msgs += f_light(st['light'])
    if st['signs']:
        msgs += f_signs(st['signs'])
    if st['scene']:
        msgs += SCENES[st['scene']]()
    msgs += st['extra']
    for m in msgs:
        B.fake(m)
        time.sleep(0.05)
    for m in st['fakes'] or []:
        B.fake(m)
        time.sleep(0.15)
    time.sleep(1.6)


def areas(app, probe):
    """BMW's own areas (cyan) and ours (magenta), panel px boxes; the stock sign as a circle."""
    out = [('BMW black box', (1420, 320, 1611, 440)), ('BMW belt', (587, 665, 626, 720)), ('BMW park lamp', (1838, 217, 1900, 260)), ('gear gap', (1380, 660, 1460, 720))]
    if app == 'twin_dial':
        out.append(('BMW message panel', (696, 596, 1226, 704)))
    else:
        out.append(('BMW message panel', (699, 600, 1223, 701)))
        out.append(('BMW stock sign', ('circle', 538.45, 621.2, 42)))
    ours = [(w['id'], (w['box'][0], w['box'][1], w['box'][0] + w['box'][2], w['box'][1] + w['box'][3])) for w in ((probe or {}).get('road') or {}).get('widgets', [])]
    return out, ours


def draw(app, snapdir, out_png, probe, crops):
    import numpy as np
    from PIL import Image, ImageDraw
    import render as RD
    snap = RD.Snapshot(snapdir)
    R = draw.R if hasattr(draw, 'R') else None
    if R is None:
        R = draw.R = RD.Renderer()
    c = R.compose(snap, region=(0, 0, 1920, 720), s=1, per_layer=False)
    rgb = np.clip(c['prem'], 0, 1)
    im = Image.fromarray((rgb * 255 + 0.5).astype('uint8'))
    clean = im.copy()
    clean.save(out_png[:-4] + '.clean.png')
    d = ImageDraw.Draw(im)
    bmw, ours = areas(app, probe)
    for nm, b in bmw:
        if b[0] == 'circle':
            d.ellipse([b[1] - b[3], b[2] - b[3], b[1] + b[3], b[2] + b[3]], outline=(0, 200, 230))
        else:
            d.rectangle(b, outline=(0, 200, 230))
    for nm, b in ours:
        d.rectangle(b, outline=(230, 0, 200))
    im.save(out_png)
    res = {}
    for k, box in crops.items():
        cp = clean.crop(box)
        cp = cp.resize((cp.width * 2, cp.height * 2), Image.LANCZOS)
        p = out_png[:-4] + '.' + k + '.png'
        cp.save(p)
        res[k] = p
    notes = [l for l in c['layers'] if l.get('note')]
    return res, [(l['key'], l['note']) for l in notes]


CROPS = {'twin_dial': {'strip': (1230, 600, 1640, 720), 'scene': (729, 248, 1191, 600)},
         'f30_cluster': {'strip': (280, 440, 640, 580), 'scene': (700, 140, 1220, 480)}}


def run(app, out):
    work = os.path.join(ROOT, 'bake', 'work', 'road', 'bench-' + app)
    os.makedirs(out, exist_ok=True)
    p, stop = start_bench(app, work)
    rows = []
    only = arg('--only')
    jp0 = os.path.join(out, 'shots.json')
    done = json.load(open(jp0)) if os.path.exists(jp0) else []
    try:
        for st in plan(app):
            if only and only not in st['name']:
                continue
            # a resumed run: a state already drawn is kept (--redo draws it again)
            if '--redo' not in sys.argv and os.path.exists(os.path.join(out, st['name'] + '.clean.png')) and any(r['name'] == st['name'] for r in done):
                continue
            t0 = time.time()
            apply(app, st)
            probe = B.probe_safe()
            sd = os.path.join(work, 'snap')
            if os.path.isdir(sd):
                for f in os.listdir(os.path.join(sd, 'px')) if os.path.isdir(os.path.join(sd, 'px')) else []:
                    os.remove(os.path.join(sd, 'px', f))
            SNAP.snap(sd, st['name'], probe=probe)
            png = os.path.join(out, st['name'] + '.png')
            crops, notes = draw(app, sd, png, probe, CROPS[app])
            road = (probe or {}).get('road') or {}
            rows.append({'name': st['name'], 'png': os.path.relpath(png, ROOT), 'crops': {k: os.path.relpath(v, ROOT) for k, v in crops.items()}, 'state': {k: v for k, v in st.items() if k not in ('extra', 'fakes')},
                         'road': {'modes': road.get('modes'), 'items': road.get('items'), 'widgets': road.get('widgets'), 'view': road.get('view')},
                         'layout': probe.get('activeName') if probe else None, 'notes': notes})
            print('%-38s %.1f s  items %s  %s' % (st['name'], time.time() - t0, [i.get('id') for i in road.get('items') or []], '; '.join(n for _, n in notes)[:120]))
            keep = [r for r in done if r['name'] not in set(x['name'] for x in rows)]
            json.dump(sorted(keep + rows, key=lambda r: r['name']), open(jp0, 'w'), indent=1, ensure_ascii=False)
    finally:
        open(stop, 'w').write('done\n')
        p.wait(timeout=30)
    # a partial run (--only) replaces its own rows and keeps the others
    jp = os.path.join(out, 'shots.json')
    old = json.load(open(jp)) if os.path.exists(jp) else []
    names = set(r['name'] for r in rows)
    merged = sorted([r for r in old if r['name'] not in names] + rows, key=lambda r: r['name'])
    json.dump(merged, open(jp, 'w'), indent=1, ensure_ascii=False)
    return rows


def main():
    which = arg('--app', 'both')
    apps = ['twin_dial', 'f30_cluster'] if which == 'both' else [which]
    for app in apps:
        out = arg('--out') or os.path.join(ROOT, 'bake', 'work', 'road', 'shots', app)
        run(app, out)


if __name__ == '__main__':
    main()
