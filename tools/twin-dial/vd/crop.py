"""crop.py REF x0 y0 x1 y1 SCALE NAME -> bake/work/twin-dial/vd/NAME.png (working view only, never tracked)."""
import glob, os, sys
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'vd')
ref, x0, y0, x1, y1, s, name = sys.argv[1:8]
src = ref if os.path.exists(ref) else glob.glob(os.path.join(ROOT, 'reference', 'vc', ref + '*.png'))[0]
im = Image.open(src).convert('RGB').crop((int(x0), int(y0), int(x1), int(y1)))
s = float(s)
im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
im.save(os.path.join(OUT, name + '.png'))
print(im.size)
