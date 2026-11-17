"""Print the references' sizes and write small working copies under bake/work/twin-dial/vd/ (never tracked)."""
import glob, os, sys
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'vd')
os.makedirs(OUT, exist_ok=True)
for f in sorted(glob.glob(os.path.join(ROOT, 'reference', 'vc', '*.png'))):
    im = Image.open(f)
    print(os.path.basename(f), im.size, im.mode)
    s = 3 if im.width > 1500 else 2
    im.convert('RGB').resize((im.width // s, im.height // s)).save(os.path.join(OUT, 'small_' + os.path.basename(f)[:2] + '.png'))
