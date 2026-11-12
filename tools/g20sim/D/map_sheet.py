"""Review sheet of package D's synthetic map vs the photos' map region (night 08, day 09) + a drift frame.
  tools/g20sim/D/py tools/g20sim/D/map_sheet.py  -> bake/work/g20sim/D/map_sheet.png (scratch: holds photo crops)"""
import os
import cv2
import numpy as np
WT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
S = os.path.join(WT, 'bake', 'work', 'g20sim', 'D')
R = os.path.join(os.environ.get('F30_MAIN', WT), 'bake', 'work', 'overlay', 'rect') + '/'
x0, y0, x1, y1 = 540, 140, 1410, 625
tiles = [('rect 08 (night)', R + '08.png'), ('ours, night', S + '/harness/map_night.png'),
         ('rect 09 (day)', R + '09.png'), ('ours, day', S + '/harness/map_day.png'),
         ('rect 14', R + '14.png'), ('ours night after 3 s at 50 km/h', S + '/harness/map_night_3s50.png')]
rows = []
for i in range(0, len(tiles), 2):
    row = []
    for name, p in tiles[i:i + 2]:
        im = cv2.imread(p)[y0:y1, x0:x1].copy()
        cv2.putText(im, name, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        row.append(im)
    rows.append(np.concatenate(row, 1))
sheet = np.concatenate(rows, 0)
cv2.imwrite(os.path.join(S, 'map_sheet.png'), cv2.resize(sheet, None, fx=0.75, fy=0.75, interpolation=cv2.INTER_AREA))
