"""Package B: pictures of the Twin Dial's engine widgets (tdial, tdback), no browser, no car.

    UV_CACHE_DIR=$F30/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl \\
        python -I tools/twin-dial/engine_render.py [--out <folder>] [--port 8212]

What it does: draws STAND-IN R8 faces from the SPEC's numbers (never from a reference; numerals from the OFL Saira in
bake/work/twin-dial/refs/vt-fonts, band as SPEC 7.1, the contract's reading: sRGB codes, 1 = white), builds the throw-away
bench tree of bench/twin-fixture.js with them, runs the bench (bench/server.js, its own port, ended by this script),
drives the signals and the message state, takes the engine's scene (tools/strip/O/snap.py) and replays it on the Mac's
GPU with the app's real fragment shaders (tools/strip/O/render.py). Output (git-ignored): <out>/<state>.png (the whole
panel, our layers over black, the see-through places in green) and <out>/<state>_dials.png next to the mockup's crop.
The text widgets are package C's: there are none here, so the digits, labels and tab contents are missing in the pictures.
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


PORT = int(arg('--port', '8212'))
OUT = os.path.abspath(arg('--out', os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'r2', 'B', 'render')))
os.environ['BENCH_PORT'] = str(PORT)
sys.path.insert(0, os.path.join(ROOT, 'tools', 'strip', 'O'))
import benchio as B   # noqa: E402
import snap as SN     # noqa: E402
import render as RD   # noqa: E402

R = 300.0
FW, FH, FCX, FCY = 616, 560, 308, 310
SS = 3
FONT = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'refs', 'vt-fonts', 'saira', 'Saira[wdth,wght].ttf')
MOCK = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'mockup', '1_clock.png')


def srgb(L):
    L = np.clip(L, 0, 1)
    return np.where(L <= 0.0031308, 12.92 * L, 1.055 * np.power(L, 1 / 2.4) - 0.055)


def tach_ang(k):
    return -125.0 + 250.0 * k / 8.0


def spd_ang(v):
    return -125.0 + 25.0 * v / 20.0 if v <= 100 else 25.0 * (v - 100) / 40.0


def saira(px):
    f = ImageFont.truetype(FONT, int(round(px * SS)))
    try:
        vals = []
        for a in f.get_variation_axes():
            n = (a['name'].decode() if isinstance(a['name'], bytes) else a['name']).lower()
            vals.append(125 if 'width' in n else 550 if 'weight' in n else a['default'])
        f.set_variation_by_axes(vals)
    except Exception:
        pass
    return f


def face(kind):
    """The stand-in face at 3x, reduced by 3: sRGB codes of the grey, 255 = white (ENGINE-CONTRACT 1.1)."""
    H, W = FH * SS, FW * SS
    ys, xs = np.mgrid[0:H, 0:W]
    dx, dy = (xs + 0.5) / SS - FCX, (ys + 0.5) / SS - FCY
    rho = np.hypot(dx, dy) / R
    th = np.degrees(np.arctan2(dx, -dy))
    ath = np.abs(th)
    c = np.zeros((H, W))
    cosT = np.cos(np.radians(th))
    Y = 0.010 * np.exp(7.5 * (rho - 0.60)) * np.exp(-0.85 * (cosT - 1.0))
    band = (rho >= 0.58) & (rho <= 0.893) & (ath <= 144)
    c[band] = srgb(Y[band])
    strip = (rho > 0.893) & (rho <= 0.94) & (ath <= 144)
    c[strip] = srgb(0.25)
    majors = [tach_ang(k) for k in range(9)] if kind == 'tach' else [spd_ang(v) for v in (0, 20, 40, 60, 80, 100, 140, 180, 220, 260, 300)]
    if kind == 'tach':
        minors = [tach_ang(k + 0.5) for k in range(8)]
    else:
        minors = [spd_ang(v + (20 if v < 100 else 40) * i / 4) for v in (0, 20, 40, 60, 80, 100, 140, 180, 220, 260) for i in (1, 2, 3)]

    def near(angs, halfR, r0, r1):
        m = np.zeros((H, W), bool)
        for a in angs:
            d = np.abs((th - a + 180) % 360 - 180)
            m |= (d * np.pi / 180 * rho <= halfR) & (rho >= r0) & (rho <= r1)
        return m
    c[near(majors, 0.003, 0.58, 0.893)] = 6 / 255
    c[near(majors, 0.009, 0.896, 0.934)] = 1.0
    c[near(minors, 0.006, 0.896, 0.934)] = 1.0
    c[(np.abs(rho - 1.0) <= 0.0105) & (ath <= 144)] = 1.0
    c[(np.abs(rho - 0.545) <= 0.008) & (ath <= 150)] = 1.0
    # the empty bar segments, then the labels and numerals from Saira
    barY, barW = 0.73 * R, (0.84 * R - 16) / 5
    for i in range(5):
        x0 = -0.42 * R + i * (barW + 4)
        m = (dx >= x0) & (dx <= x0 + barW) & (np.abs(dy - barY) <= 3.75)
        c[m] = 47 / 255
    img = Image.fromarray(np.round(c * 255).astype(np.uint8))
    d = ImageDraw.Draw(img)

    def text(cx, cy, s, px):
        d.text(((FCX + cx) * SS, (FCY + cy) * SS), s, font=saira(px), fill=255, anchor='mm')

    def polar(a, r):
        t = np.radians(a)
        return r * R * np.sin(t), -r * R * np.cos(t)
    if kind == 'tach':
        for k in range(1, 9):
            text(*polar(tach_ang(k), 0.745), str(k), 57)
        text(-0.56 * R, 0.58 * R, 'OFF', 22)
    else:
        for v in (0, 20, 40, 60, 80, 100, 140, 180, 220, 260, 300):
            text(*polar(spd_ang(v), 0.76), str(v), 28)
        for v in (10, 30, 50, 70, 160, 200, 240, 280):
            text(*polar(spd_ang(v), 0.78), str(v), 18)
    text(-0.35 * R, 0.68 * R, '0' if kind == 'tach' else 'C', 21)
    text(0.35 * R, 0.68 * R, '1/1' if kind == 'tach' else 'H', 21)
    a = np.asarray(img, np.float64).reshape(FH, SS, FW, SS).mean(axis=(1, 3))
    return np.round(a).astype(np.uint8)


def scene_json(w, h, arr):
    return json.dumps({'w': w, 'h': h, 'format': 'r8', 'r8': base64.b64encode(arr.tobytes()).decode(), 'sampling': 'bilinear'})


def mask():
    W, H = 536, 112
    ys, xs = np.mgrid[0:H, 0:W]
    dx = np.maximum(np.maximum(10 - xs, xs - (W - 11)), 0)
    dy = np.maximum(np.maximum(6 - ys, ys - (H - 7)), 0)
    return (np.hypot(dx, dy) <= 8).astype(np.uint8) * 255


def main():
    os.makedirs(OUT, exist_ok=True)
    # the faces: --faces <folder>, else package A2's baked ones (apps/twin_dial/hud/scene, or its published note), else stand-ins
    cand = [arg('--faces'), os.path.join(ROOT, 'apps', 'twin_dial', 'hud', 'scene'), os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'pub', 'R2', 'A2')]
    faces = next((c for c in cand if c and os.path.exists(os.path.join(c, 'face_tacho.json'))), None)
    if faces is None:
        faces = os.path.join(OUT, 'faces')
        os.makedirs(faces, exist_ok=True)
        open(os.path.join(faces, 'face_tacho.json'), 'w').write(scene_json(FW, FH, face('tach')))
        open(os.path.join(faces, 'face_speedo.json'), 'w').write(scene_json(FW, FH, face('speed')))
        open(os.path.join(faces, 'panel_mask.json'), 'w').write(scene_json(536, 112, mask()))
    print('faces:', faces)
    tree = os.path.join(OUT, 'tree')
    subprocess.check_call(['node', '-e', "require(%s).makeRoot(%s, { faces: %s })" % tuple(json.dumps(x) for x in (os.path.join(ROOT, 'bench', 'twin-fixture.js'), tree, faces))])
    env = dict(os.environ, BENCH_PORT=str(PORT), BENCH_DATA_DIR=os.path.join(tree, 'data'), BENCH_LAYER_CAP='8')
    log = open(os.path.join(OUT, 'bench.log'), 'w')
    srv = subprocess.Popen(['node', os.path.join(tree, 'bench', 'server.js'), 'twin_engine_test'], cwd=tree, env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        t0 = time.time()
        while time.time() - t0 < 150:
            p = B.probe_safe()
            if p and p.get('ready') and p.get('activeName'):
                break
            time.sleep(0.4)
        else:
            raise SystemExit('the bench did not come up')
        rd = RD.Renderer()
        states = [
            ('day', dict(rpm=2400, speed=87, coolant=80, fuelL=36, spare=0), {'nightLook': 'off'}, None),
            ('day_redline', dict(rpm=6800, speed=210, coolant=122, fuelL=3, spare=1), {'nightLook': 'off'}, None),
            ('night', dict(rpm=2400, speed=87, coolant=80, fuelL=36, spare=0), {'nightLook': 'on'}, None),
            ('night_ours_amber', dict(rpm=2400, speed=87, coolant=80, fuelL=36, spare=0), {'nightLook': 'on'}, 'twinCc:ours,amber'),
            ('day_window_red', dict(rpm=2400, speed=87, coolant=80, fuelL=36, spare=0), {'nightLook': 'off'}, 'twinCc:window,red'),
            ('day_ours_green', dict(rpm=2400, speed=87, coolant=80, fuelL=36, spare=0), {'nightLook': 'off'}, 'twinCc:ours,green'),
            ('off', dict(rpm=0, speed=0, coolant=60, fuelL=30, spare=0, condition=3, engine=0), {'nightLook': 'off'}, 'twinCc:none,'),
        ]
        for name, sig, st, cc in states:
            for k, v in st.items():
                B.post('/setting', {'key': k, 'value': v})
            B.post('/fake', {'hook': cc or 'twinCc:none,'})
            B.post('/signals', {'mode': 'manual', 'values': dict(dict(stage='D', condition=10), **sig)})
            time.sleep(3.2)
            d = os.path.join(OUT, 'snap_' + name)
            shutil.rmtree(d, ignore_errors=True)
            SN.snap(d, name)
            S = RD.Snapshot(d)
            out = rd.compose(S, (0, 0, 1920, 720), 1, per_layer=False)
            A, P = out['alpha'], out['prem']
            img = P + np.array([0.0, 0.55, 0.2], np.float32) * (1.0 - A[..., None])
            Image.fromarray(np.round(np.clip(img, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, name + '.png'))
            print('wrote', name)
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=8)
        except subprocess.TimeoutExpired:
            srv.kill()


if __name__ == '__main__':
    main()
