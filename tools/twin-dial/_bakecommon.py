"""Twin Dial bake helpers shared by bake_face.py, bake_mask.py and their tests (package R2-A2).

Not a command. Our own geometry only: no reference image is read, no maker font, bitmap or mark is used.
Fonts are the OFL ones (Saira, Noto Sans): tools/fonts-src/ once package A1 has put them there, else the
VT download in bake/work/twin-dial/refs/vt-fonts/ (the same files; the manifest records their sha256).
"""
import base64
import hashlib
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SCENE = os.path.join(ROOT, 'apps', 'twin_dial', 'hud', 'scene')
MANIFEST = os.path.join(ROOT, 'bake', 'manifest', 'twin_dial.json')
WORK = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'r2', 'A2')        # git-ignored pictures
ICONS = os.path.join(ROOT, 'design', 'twin-dial', 'vt', 'pictograms', 'baked')
FONT_DIRS = {
    'saira': ['tools/fonts-src', 'bake/work/twin-dial/refs/vt-fonts/saira'],
    'notosans': ['tools/fonts-src', 'bake/work/twin-dial/refs/vt-fonts/notosans'],
}
FONT_FILES = {'saira': 'Saira[wdth,wght].ttf', 'notosans': 'NotoSans[wdth,wght].ttf'}
GENERATOR = 'tools/twin-dial/bake_all.sh'

_FONTS = {}
_SEEN_FONT_FILES = {}


def font_path(family):
    for d in FONT_DIRS[family]:
        p = os.path.join(ROOT, d, FONT_FILES[family])
        if os.path.isfile(p):
            return p
    raise SystemExit('font %s not found (looked in %s)' % (FONT_FILES[family], ', '.join(FONT_DIRS[family])))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for blk in iter(lambda: f.read(1 << 20), b''):
            h.update(blk)
    return h.hexdigest()


def font(family, size, ss):
    """SPEC §9: Saira width 125 weight 550, Noto Sans width 100 weight 500; drawn at ss x its pixel size."""
    from PIL import ImageFont
    key = (family, size, ss)
    if key not in _FONTS:
        p = font_path(family)
        _SEEN_FONT_FILES[FONT_FILES[family]] = sha256_file(p)
        wght, wdth = (550, 125) if family == 'saira' else (500, 100)
        f = ImageFont.truetype(p, int(round(size * ss)))
        vals = []
        for a in f.get_variation_axes():
            n = a['name'].decode() if isinstance(a['name'], bytes) else a['name']
            n = n.lower()
            vals.append(wdth if 'width' in n or n == 'wdth' else wght if 'weight' in n or n == 'wght' else a['default'])
        f.set_variation_by_axes(vals)
        _FONTS[key] = f
    return _FONTS[key]


def font_inputs():
    """{file name: sha256} of the font files this run opened."""
    return dict(_SEEN_FONT_FILES)


def r8_scene(path, w, h, data, sampling, entry, about):
    """Write a scene texture the way shared/hud.js _scene() loads one: {w, h, format: "r8", r8: base64, sampling,
    mask: <entry the engine hands to the widget as a.mask>}. Returns the sha256 of the raw bytes."""
    if len(data) != w * h:
        raise SystemExit('%s: %d bytes for %d x %d' % (path, len(data), w, h))
    j = {'w': w, 'h': h, 'format': 'r8', 'sampling': sampling, 'mask': entry, '_about': about,
         'r8': base64.b64encode(bytes(data)).decode('ascii')}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(j, f, sort_keys=False, separators=(',', ':'))
        f.write('\n')
    return hashlib.sha256(bytes(data)).hexdigest()


def read_scene(path):
    """-> (json dict, uint8 numpy array h x w) for an R8 scene file."""
    import numpy as np
    j = json.load(open(path))
    a = np.frombuffer(base64.b64decode(j['r8']), np.uint8).reshape(j['h'], j['w'])
    return j, a


def record(name, entry):
    """bake/manifest/twin_dial.json: one reproducible-bake record per baked file (sorted, stable)."""
    try:
        m = json.load(open(MANIFEST))
    except (OSError, ValueError):
        m = {}
    m.setdefault('_about', 'Twin Dial baked files (package R2-A2): one command regenerates every one of them: ' + GENERATOR +
                 '. Our own drawings from SPEC numbers only; no reference image is an input.')
    m['generator'] = GENERATOR
    m.setdefault('files', {})[name] = entry
    m['files'] = dict(sorted(m['files'].items()))
    import numpy
    import PIL
    m['tools'] = {'python': '%d.%d' % sys.version_info[:2], 'numpy': numpy.__version__, 'pillow': PIL.__version__}
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, 'w') as f:
        json.dump(m, f, indent=1)
        f.write('\n')
