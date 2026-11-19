"""Decode f30_cluster's own theme previews (hud/previews/<layout>.json: deflated RGBA rows) at chosen commits.
Our renders only: the previews are what tools/previews.py shot on the bench at each version.
Usage: python -I previews_history.py <repo> <out_dir>"""
import base64
import hashlib
import json
import os
import subprocess
import sys
import zlib

from PIL import Image

REPO, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

COMMITS = [  # version, commit (from git log of apps/f30_cluster/app.json on main)
    ('0.4.1', 'eefecfd'), ('0.5.0', 'bc2fc0d'), ('0.6.0', 'c117c76'), ('0.6.3', '1b3af59'),
    ('0.7.0', 'be51b4e'), ('0.7.6', '45f40fc'), ('0.7.10', '8fa82c4'), ('0.7.13', '70692ae'),
    ('0.7.18', '159f9d6'), ('0.7.20', '95892f5'),
]
seen = {}
rows = []
for ver, c in COMMITS:
    try:
        raw = subprocess.check_output(['git', '-C', REPO, 'show', '%s:apps/f30_cluster/hud/previews/wb_comfort.json' % c],
                                      stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        rows.append((ver, c, None, 'no preview'))
        continue
    p = json.loads(raw)['big']
    px = zlib.decompress(base64.b64decode(p['z']))
    h = hashlib.sha1(px).hexdigest()[:10]
    same = seen.get(h)
    seen.setdefault(h, ver)
    im = Image.frombytes('RGBA', (p['w'], p['h']), px)
    bg = Image.new('RGBA', im.size, (0, 0, 0, 255))
    bg.alpha_composite(im)
    path = os.path.join(OUT, 'comfort_%s.png' % ver)
    bg.convert('RGB').save(path)
    rows.append((ver, c, path, 'same as %s' % same if same else h))
for r in rows:
    print(*r)
