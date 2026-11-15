"""Package design/f30-font: shoot every 6WB layout on the bench, to pixel-compare a font change.

Unlike tools/previews.py this writes nothing into the app -- it only takes pictures -- so it can be
run before a re-bake and again after it, and the two sets compared.

    # the app's bench must be running:  BENCH_PORT=8160 node bench/server.js f30_cluster
    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with pillow python -I \
        tools/f30font/shots.py --port 8160 --out bake/work/f30font/before
    ... --out bake/work/f30font/after
    ... --compare bake/work/f30font/before bake/work/f30font/after --out bake/work/f30font/diff
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

from PIL import Image, ImageChops

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
# one fixed state for every shot, so the only thing that moves between before and after is the face
SIGNALS = {'rpm': 4200, 'speed': 98, 'gear': 3, 'oil': 95, 'coolant': 90, 'boost': 1.1, 'torque': 290,
           'fuelL': 38, 'range': 310, 'ambient': 18, 'tyreP': 2.4, 'tyreT': 30, 'limit': 60}
LAYOUTS = ['wb_comfort', 'wb_dials', 'wb_sport', 'wb_sport_dials', 'wb_eco']


def post(port, path, body):
    req = urllib.request.Request('http://127.0.0.1:%d%s' % (port, path), data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    urllib.request.urlopen(req, timeout=8).read()


def shot(port, out):
    for attempt in range(3):
        if os.path.exists(out):
            os.remove(out)
        try:
            subprocess.run([CHROME, '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                            '--virtual-time-budget=20000', '--hide-scrollbars', '--window-size=1920,720',
                            '--screenshot=' + out, 'http://localhost:%d/?only=1&backdrop=0&clean=1&car=0' % port],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
            lit = sum(Image.open(out).convert('L').point(lambda v: 255 if v > 40 else 0).histogram()[255:])
            if lit >= 400:
                return
            print('  (blank, try %d of 3)' % (attempt + 1), flush=True)
        except subprocess.TimeoutExpired:
            subprocess.run(['pkill', '-f', '--screenshot=' + out], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print('  (Chrome hung, try %d of 3)' % (attempt + 1), flush=True)
    raise SystemExit('no good picture in three tries: ' + out)


def compare(a_dir, b_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    print('%-18s %10s %9s %9s %9s' % ('layout', 'changed px', '% of panel', 'max dR/G/B', 'bbox'))
    for name in LAYOUTS:
        pa, pb = os.path.join(a_dir, name + '.png'), os.path.join(b_dir, name + '.png')
        if not (os.path.exists(pa) and os.path.exists(pb)):
            continue
        ia, ib = Image.open(pa).convert('RGB'), Image.open(pb).convert('RGB')
        diff = ImageChops.difference(ia, ib)
        gray = diff.convert('L')
        hist = gray.histogram()
        changed = sum(hist[6:])                   # 6: above the renderer's own dither/AA noise
        bbox = gray.point(lambda v: 255 if v > 6 else 0).getbbox()
        mx = max(diff.getextrema(), key=lambda t: t[1])[1]
        total = ia.width * ia.height
        print('%-18s %10d %9.3f%% %9d %9s' % (name, changed, 100.0 * changed / total, mx, bbox))
        amp = gray.point(lambda v: min(255, v * 6))
        Image.merge('RGB', (amp, amp.point(lambda v: v // 3), amp.point(lambda v: v // 3))) \
            .save(os.path.join(out_dir, name + '_diff.png'))
    print('\ndiff pictures (red = changed, 6x amplified) -> ' + out_dir)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8160)
    ap.add_argument('--out', required=True)
    ap.add_argument('--compare', nargs=2, default=None)
    ap.add_argument('--settle', type=float, default=5.0)
    a = ap.parse_args()

    if a.compare:
        compare(a.compare[0], a.compare[1], a.out)
        return

    os.makedirs(a.out, exist_ok=True)
    post(a.port, '/setting', {'key': 'byMode', 'value': False})
    post(a.port, '/signals', {'mode': 'manual', 'values': SIGNALS})
    time.sleep(1)
    for name in LAYOUTS:
        post(a.port, '/setting', {'key': 'hudLayout', 'value': name})
        time.sleep(a.settle)
        post(a.port, '/signals', {'mode': 'manual', 'values': SIGNALS})
        time.sleep(1)
        p = os.path.join(a.out, name + '.png')
        shot(a.port, p)
        print('  %s -> %s (%d KiB)' % (name, p, os.path.getsize(p) // 1024), flush=True)
    print('%d shots -> %s' % (len(LAYOUTS), a.out))


if __name__ == '__main__':
    main()
