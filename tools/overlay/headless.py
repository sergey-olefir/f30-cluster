#!/usr/bin/env python3
"""Run the overlay constructor headless: check the sample conflicts, write the default plan, take screenshots.

    python3 tools/overlay/headless.py [--no-shots]

- serves the repo root on a free local port (python3 -m http.server);
- loads ?data=sample&export=default and compares its conflicts with design/overlay/sample/expected_conflicts.json;
- loads ?data=real&export=default and writes design/overlay/plan.default.json;
- screenshots go to bake/work/overlay/shots/ (git-ignored; they may show photo underlays).

Chrome runs with its own profile (bake/work/overlay/chrome-headless) and only that instance is killed.
macOS has no `timeout`: every Chrome run is polled and killed after a deadline.
"""
import html
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PROFILE = os.path.join(ROOT, 'bake/work/overlay/chrome-headless')
SHOTS = os.path.join(ROOT, 'bake/work/overlay/shots')
FLAGS = ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--virtual-time-budget=30000',
         '--user-data-dir=' + PROFILE, '--hide-scrollbars']


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def chrome(args, out_path=None, deadline=90):
    """Run Chrome; stdout to out_path (for --dump-dom). Kill it after `deadline` seconds."""
    out = open(out_path, 'w') if out_path else subprocess.DEVNULL
    p = subprocess.Popen([CHROME] + FLAGS + args, stdout=out, stderr=subprocess.DEVNULL)
    t0 = time.time()
    while p.poll() is None and time.time() - t0 < deadline:
        time.sleep(1)
    if p.poll() is None:
        p.kill()
    subprocess.run(['pkill', '-f', 'chrome-headless'], stderr=subprocess.DEVNULL)
    if out_path:
        out.close()


def dump_plan(base, query):
    tmp = os.path.join(ROOT, 'bake/work/overlay/_dump.html')
    chrome(['--window-size=1920,1080', '--dump-dom', base + '?' + query], tmp)
    s = open(tmp).read()
    m = re.search(r'<pre id="plan-dump"[^>]*>(.*?)</pre>', s, re.S)
    if not m or not m.group(1).strip():
        raise SystemExit('no plan in the page dump for ?' + query)
    plan = json.loads(html.unescape(m.group(1)))
    if 'error' in plan:
        raise SystemExit('page reported: %s' % plan['error'])
    return plan


def key(c):
    return (c['severity'], c['rule'], c['g20'], c['wb'])


def main():
    shots = '--no-shots' not in sys.argv
    port = free_port()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    base = 'http://127.0.0.1:%d/tools/overlay/constructor/' % port
    try:
        sample = dump_plan(base, 'data=sample&export=default')
        exp = json.load(open(os.path.join(ROOT, 'design/overlay/sample/expected_conflicts.json')))
        got, want = set(map(key, sample['conflicts'])), set(map(key, exp))
        print('sample: %d computed, %d expected, missing %s, extra %s' % (len(got), len(want), sorted(want - got), sorted(got - want)))
        ok = got == want

        plan = dump_plan(base, 'data=real&export=default')
        path = os.path.join(ROOT, 'design/overlay/plan.default.json')
        with open(path, 'w') as f:
            json.dump(plan, f, indent=1, ensure_ascii=False)
            f.write('\n')
        n = {}
        for c in plan['conflicts']:
            n[(c['severity'], c['rule'])] = n.get((c['severity'], c['rule']), 0) + 1
        print('real: wrote %s, %d conflicts: %s' % (os.path.relpath(path, ROOT), len(plan['conflicts']),
                                                    ', '.join('%s %s %d' % (k[0], k[1], v) for k, v in sorted(n.items()))))

        safe = dump_plan(base, 'data=real&export=safe')
        path = os.path.join(ROOT, 'design/overlay/plan.safe.json')
        with open(path, 'w') as f:
            json.dump(safe, f, indent=1, ensure_ascii=False)
            f.write('\n')
        print('safe: wrote %s, %d conflicts, %d holes' % (os.path.relpath(path, ROOT), len(safe['conflicts']), len(safe['holes'])))

        if shots:
            os.makedirs(SHOTS, exist_ok=True)
            for name, q, size in [
                ('default', 'data=real&fresh=1&photo=none', '1920,1080'),
                ('conflicts', 'data=real&fresh=1&tab=conflicts&photo=none', '1920,1080'),
                ('decisions', 'data=real&fresh=1&tab=decisions&photo=none', '1920,1080'),
                ('default_photo08', 'data=real&fresh=1', '1920,1080'),
                ('canvas_labels', 'data=real&fresh=1&shot=1&labels=1&photo=none', '1920,720'),
                ('canvas_photo08', 'data=real&fresh=1&shot=1', '1920,720'),
                ('sample', 'data=sample&fresh=1', '1920,1080'),
            ]:
                # shots named *photo* may show third-party photo pixels: they stay in bake/work (git-ignored);
                # the others draw only our data and may be copied to docs/overlay/
                out = os.path.join(SHOTS, name + '.png')
                if os.path.exists(out):
                    os.remove(out)
                chrome(['--window-size=' + size, '--screenshot=' + out, base + '?' + q])
                print('shot', os.path.relpath(out, ROOT), 'ok' if os.path.exists(out) else 'MISSING')
                if 'photo' not in name and name != 'sample' and os.path.exists(out):
                    os.makedirs(os.path.join(ROOT, 'docs/overlay'), exist_ok=True)
                    shutil.copy(out, os.path.join(ROOT, 'docs/overlay', 'constructor_' + name + '.png'))
    finally:
        srv.kill()
        shutil.rmtree(PROFILE, ignore_errors=True)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
