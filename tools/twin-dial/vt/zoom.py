"""VT: an upscaled view of a rectangle of a reference, for looking only (output stays under bake/work/).

    python -I tools/twin-dial/vt/zoom.py <image> x0 y0 x1 y1 <factor> <out.png>
"""
import sys

from PIL import Image

src, x0, y0, x1, y1, k, out = sys.argv[1], *map(int, sys.argv[2:7]), sys.argv[7]
im = Image.open(src).convert('RGB').crop((x0, y0, x1, y1))
im = im.resize((im.width * k, im.height * k), Image.LANCZOS)
im.save(out)
