"""P10 step 4: apply the level correction (P10.levels) to every baked layer, after the package builds.

    ./P10/regen_packages.sh          # the packages' own builds, unchanged (they reproduce the committed assets)
    ./P10/py.sh -m P10.apply         # this: the shared level step
    (then tools/bake_scene.py packs the corrected layers into hud/scene; not run here, see BAKE-P10-levels.md 7)

Files: apps/f30_cluster/hud/baked/<cluster>/*.png and the packages' 1x procedural renders the scene stack uses
(bake/work/C1/proc, bake/work/C2/proc). albedo / glow / highlight / merged: the colour goes through the cluster's
curve (alpha kept); shadow and mask files are left as they are. C5 / C6 have the identity curve (they are built in final
panel values by C5.fit / C5.build / C6.build): their files are left exactly as the build wrote them. The C7 SVG sources are not touched (they are vector
sources of the icons, whose levels are near white; see the doc).

Idempotent: the first run keeps each package output in bake/work/P10/pristine/ and always starts from it; a file that
no longer matches the hash this step wrote is taken as a fresh package output and becomes the new pristine copy.
"""
import hashlib, json, os, shutil, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from common import imageio                      # noqa: E402
from P10 import levels as LV                    # noqa: E402

ROOT = LV.ROOT
BAKED = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'baked')
WORK = os.path.join(ROOT, 'bake', 'work')
P10 = os.path.join(WORK, 'P10')
PRISTINE = os.path.join(P10, 'pristine')
RECORD = os.path.join(P10, 'applied.json')
SKIP_KINDS = ('.shadow', '.mask')


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def targets():
    out = []
    for cl in sorted(os.listdir(BAKED)):
        d = os.path.join(BAKED, cl)
        if not os.path.isdir(d) or cl not in LV.SOURCES:
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith('.png'):
                out.append((cl, os.path.join(d, f)))
    for cl in ('C1', 'C2'):
        d = os.path.join(WORK, cl, 'proc')
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            if f.endswith('.png'):
                out.append((cl, os.path.join(d, f)))
    return out


def main():
    rec = json.load(open(RECORD)) if os.path.exists(RECORD) else {}
    new = {}
    stats = []
    for cl, path in targets():
        rel = os.path.relpath(path, ROOT)
        pr = os.path.join(PRISTINE, rel)
        cur = sha(path)
        if not os.path.exists(pr) or rec.get(rel, {}).get('out') != cur:
            os.makedirs(os.path.dirname(pr), exist_ok=True)       # a fresh package output: it is the new pristine copy
            shutil.copy2(path, pr)
        name = os.path.basename(path)
        kind_skip = any(k in name for k in SKIP_KINDS)
        src = imageio.read_png(pr)                                  # float RGBA 0..1 straight alpha
        if kind_skip:
            shutil.copy2(pr, path)
            new[rel] = {'cluster': cl, 'level': 'unchanged (shadow / mask)', 'out': sha(path), 'pristine': sha(pr)}
            continue
        if LV.SOURCES.get(cl) == 'identity':                       # C5 / C6: already final panel values
            shutil.copy2(pr, path)
            new[rel] = {'cluster': cl, 'level': 'identity (final panel values from the package build)', 'out': sha(path),
                        'pristine': sha(pr)}
            continue
        rgb = src[..., :3] * 255.0
        cor = LV.curve(cl, rgb.reshape(-1, 3)).reshape(rgb.shape) / 255.0
        out = np.concatenate([cor, src[..., 3:4]], -1)
        mode = Image.open(pr).mode
        if mode == 'RGB':
            out = out[..., :3]
        imageio.write_png(path, out.astype(np.float32), dither=True, seed=1)
        a = src[..., 3] > 0.5
        before = (rgb[a].mean(0) if a.any() else np.zeros(3))
        after = (cor[a].mean(0) * 255 if a.any() else np.zeros(3))
        new[rel] = {'cluster': cl, 'level': 'P10 curve ' + cl, 'out': sha(path), 'pristine': sha(pr),
                    'mean_rgb_opaque_before': before.round(2).tolist(), 'mean_rgb_opaque_after': after.round(2).tolist()}
        stats.append((rel, before.round(1).tolist(), after.round(1).tolist()))
    json.dump(new, open(RECORD, 'w'), indent=1)
    for r, b, a in stats:
        print('%-72s %s -> %s' % (r, b, a))


if __name__ == '__main__':
    main()
