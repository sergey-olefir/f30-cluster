"""VT: a contact sheet of the baked pictograms at one size (our own drawings only), for review.

    python -I tools/twin-dial/vt/contact.py <baked dir> <size> <out.png>
"""
import glob
import os
import sys

from PIL import Image, ImageDraw

d, size, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
files = sorted(glob.glob(os.path.join(d, '*_%dx%d.png' % (size, size))))
cols = 6
cell = size + 24
sheet = Image.new('RGB', (cols * cell, ((len(files) + cols - 1) // cols) * (cell + 14)), (20, 20, 20))
dr = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert('LA')
    x, y = (i % cols) * cell + 12, (i // cols) * (cell + 14) + 4
    white = Image.new('RGB', im.size, (255, 255, 255))
    sheet.paste(white, (x, y), im.getchannel('A'))
    dr.text((x, y + size + 2), os.path.basename(f).rsplit('_', 1)[0], fill=(200, 200, 0))
sheet.save(out)
