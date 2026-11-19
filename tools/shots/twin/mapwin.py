"""tools/shots/twin: car-issues MW, the map window's mockups for the owner - W2 beside W3, day and night, with and without the
road bar - from the bench renderer (the app's real layers, replayed by tpaint's pool on the Mac's GPU). No browser.

    UV_CACHE_DIR=$F30/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl \\
        python -I tools/shots/twin/mapwin.py [--port 8914] [--out <folder>]

One bench (bench/server.js twin_dial, the checkout's app) on --port, the same tree and wall clock as run.py. Per state: tab 5,
"Вікно карти" = W2 or W3, the forced window on ("Примусове вікно карти": the presence rule says yes), "Навігація" = карта,
standing in D; with a road the fixture's own name "вулиця Тестова" (never a real one). What lies UNDER our layers is ours too:
  slot  a stand-in map (grey land, white roads, a 100 px grid) over the whole map slot 0x100 (1088 x 480, x 416-1504,
        y 140-620): photo A (CarPlay's map, 2026-11-19) shows the map at full level right up to W2's edges, so it is at
        least that wide; how far past them it goes on the car is what W3 will show
  box   the same map inside BMW's own box as photo 41 measured it (BMW's map, cluster-render 0.5.8: 50 % edge x 724-1192,
        y 162-575, 30-50 px fall-off; CAR3-H): what W3 shows if the car draws that smaller box
and backdrop.py's stand-ins for BMW's lamps. Nothing here is BMW's artwork or a photo.

Out (default bake/work/car-issues/pub/MW/): mw_<look>_<road|noroad>_<slot|box>.png = W2 (top) over W3 (bottom), 1920 x 1480,
and mw_centre_<...>.png, the middle [420, 100, 1500, 640] at 1:1 side by side.
"""
import json
import os
import shutil
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, '..')
for p in (os.path.join(SHOTS, '..', 'strip', 'O'), SHOTS, HERE):     # HERE first: its run.py, not tools/shots/run.py
    if p not in sys.path:
        sys.path.insert(0, p)
import run as RN         # noqa: E402  (start_bench, stop_benches)
import scenes as SC      # noqa: E402
import tdrive as TD      # noqa: E402
import paint             # noqa: E402
import backdrop as BD    # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
ROAD = 'вулиця Тестова'      # bench/twin-centre-states.js's fixture name


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def standin_map(night, kind):
    """RGB float (720, 1920, 3): our own stand-in of a map in the cluster's map slot (no BMW artwork)."""
    from PIL import Image, ImageDraw
    land, road, grid = ((38, 44, 52), (150, 156, 166), (52, 60, 70)) if night else ((92, 98, 104), (236, 238, 240), (112, 118, 124))
    im = Image.new('RGB', (1920, 720), (0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = 416, 140, 1504, 620
    d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=land)
    for x in range(x0, x1, 100):
        d.line([x, y0, x, y1], fill=grid, width=1)
    for y in range(y0, y1, 100):
        d.line([x0, y, x1, y], fill=grid, width=1)
    # roads: a long curve through the middle, cross streets reaching every corner of the slot
    pts = [(960 + 260 * np.sin((y - 140) / 480 * 2.4 - 1.2), y) for y in range(140, 621, 8)]
    d.line(pts, fill=road, width=9)
    for a, b in (((416, 230), (1504, 300)), ((416, 520), (1504, 450)), ((560, 140), (700, 620)), ((1360, 140), (1230, 620)),
                 ((416, 380), (1504, 395)), ((470, 140), (620, 620)), ((1450, 140), (1300, 620))):
        d.line([a, b], fill=road, width=4)
    # the position arrow at the foot of the map (a plain triangle)
    d.polygon([(960, 506), (946, 534), (974, 534)], fill=(255, 120, 40))
    arr = np.asarray(im).astype(np.float32) / 255.0
    if kind == 'box':
        # photo 41's profile (CAR3-H): 10 % at x 695 / 1216, y 137 / 592; 50 % at 724 / 1192, 162 / 575; 90 % 794 / 1150, 208 / 558
        xs, ys = np.arange(1920) + 0.5, np.arange(720) + 0.5

        def ramp(v, lo10, lo50, hi50, hi10):
            a = np.clip(0.1 + 0.4 * (v - lo10) / (lo50 - lo10), 0, 1) if lo50 > lo10 else 1
            b = np.clip(0.1 + 0.4 * (hi10 - v) / (hi10 - hi50), 0, 1)
            return np.clip(np.minimum(a, b), 0, 1) * np.clip((np.minimum(v - lo10, hi10 - v) + 10) / 10, 0, 1)
        k = ramp(ys, 137, 162, 575, 592)[:, None] * ramp(xs, 695, 724, 1192, 1216)[None, :]
        arr = arr * np.clip(k * 1.25, 0, 1)[..., None]
    return arr


def label(arr, text, h=40):
    from PIL import Image, ImageDraw
    im = Image.fromarray(np.round(np.clip(arr, 0, 1) * 255).astype(np.uint8), 'RGB')
    out = Image.new('RGB', (im.width, im.height + h), (24, 24, 24))
    out.paste(im, (0, h))
    ImageDraw.Draw(out).text((16, 8), text, fill=(235, 235, 235), font=BD._font(24))
    return np.asarray(out).astype(np.float32) / 255.0


def save(arr, path):
    from PIL import Image
    Image.fromarray(np.round(np.clip(arr, 0, 1) * 255).astype(np.uint8), 'RGB').save(path, optimize=True)


def main():
    port = int(arg('--port', '8914'))
    if not 8910 <= port <= 8919:
        raise SystemExit('car-issues MW: use a port in 8910..8919')
    out = os.path.abspath(arg('--out') or os.path.join(ROOT, 'bake', 'work', 'car-issues', 'pub', 'MW'))
    work = os.path.join(ROOT, 'bake', 'work', 'car-issues', 'MW', 'run-%d' % port)
    snaps = os.path.join(work, 'snaps')
    os.makedirs(out, exist_ok=True)
    shutil.rmtree(snaps, ignore_errors=True)
    os.makedirs(snaps)
    logs = os.path.join(work, 'logs')
    os.makedirs(logs, exist_ok=True)
    config = json.dumps({'trip': {'factors': {'bc': 1, 'speed': 0.1, 'cons': 0.1, 'way': 0.1}}, 'twin': {'media': True}})
    b = RN.start_bench(work, logs, 0, port, 'real', config)
    drv = TD.Driver('mw', b['bench'], snaps, os.path.join(logs, 'drive.log'), b['app']['settings'])
    res = {}
    try:
        drv.restart()
        drv.put_settings({'demo': 'off'})
        for look in ('day', 'night'):
            for road in (True, False):
                for v in ('W2', 'W3'):
                    tag = '%s_%s_%s' % (v, look, 'road' if road else 'noroad')
                    st = SC.state(look=look, engine='ready', tag=tag)
                    st['settings'] = {'tab': '5', 'diagMapWindow': v, 'diagMapForce': 'on', 'navView': 'map'}
                    rv = {'elements': [{'text': ROAD}]} if road else {'elements': []}
                    st['fakes'] = [SC.feed(SC.IF_GUIDANCE, 'currentRoad', rv), {'sleep': 9.0}]     # the window stays shut 8 s after a build (config.mapShutMs)
                    job = SC.job('MW', st)
                    r = drv.run_job(job)
                    print(tag, 'ok' if r['ok'] else r.get('reason'), flush=True)
                    res[tag] = r
    finally:
        RN.stop_benches([b])
    P = paint.Painter()
    for look in ('day', 'night'):
        for road in ('road', 'noroad'):
            for kind in ('slot', 'box'):
                if kind == 'box' and (look == 'night'):
                    continue
                under = standin_map(look == 'night', kind)
                rows, mids = [], []
                for v in ('W2', 'W3'):
                    r = res.get('%s_%s_%s' % (v, look, road))
                    if not r or not r['ok']:
                        continue
                    S = paint.SnapZ(r['snap'])
                    comp = P.compose(S, (0, 0, 1920, 720), 1, per_layer=True)
                    A, prem = comp['alpha'], comp['prem']
                    lamps = BD.under(False)
                    base = np.where(lamps.sum(-1, keepdims=True) > 0, lamps, under)
                    car = prem + base * (1.0 - A[..., None])
                    car = BD.over(car, 'P')
                    what = {'W2': 'W2: the open box [700, 173, 1220, 600] (as on the car, photo A)',
                            'W3': 'W3: the free space between the dials - sides along the bezels (arcs r 324: 20 px black ring), top at the tab rule, foot y 588'}[v]
                    under_s = {'slot': 'stand-in map over the whole map slot', 'box': 'stand-in map inside BMW\'s own box of photo 41'}[kind]
                    rows.append(label(car, '%s   |   %s, %s, %s' % (what, look, 'road bar' if road == 'road' else 'no road', under_s)))
                    mids.append(label(car[100:640, 420:1500], v + ' (' + look + ')'))
                if len(rows) == 2:
                    save(np.concatenate(rows, 0), os.path.join(out, 'mw_%s_%s_%s.png' % (look, road, kind)))
                    save(np.concatenate([mids[0], np.full((mids[0].shape[0], 12, 3), 0.1, np.float32), mids[1]], 1),
                         os.path.join(out, 'mw_centre_%s_%s_%s.png' % (look, road, kind)))
    json.dump({k: {'ok': v['ok'], 'reason': v.get('reason')} for k, v in res.items()}, open(os.path.join(out, 'mw_states.json'), 'w'), indent=1)
    print('wrote', out)


if __name__ == '__main__':
    main()
