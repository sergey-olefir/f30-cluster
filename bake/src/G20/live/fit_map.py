"""Package D, step 5: the map's look (background, road colours and widths, edge fade) on rect 08 (night), 09 (day), 14.

  tools/g20sim/D/py bake/src/G20/live/fit_map.py    -> bake/work/g20sim/D/fit_map.json

Only colours and widths are measured; the street layout is our own (procedural, seeded) and never BMW's.
Roads: white top-hat (15 px) components; width = 2 * (distance-transform maximum along the skeleton); colour = the
median of the road cores. Background: the median of non-road pixels per distance band from the map.region edge (the
fade) and per 40 px row band (the vertical gradient).
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common_live import SCRATCH, elements, rect  # noqa: E402


def main():
    G = elements()
    poly = np.array(G['map.region']['poly'], np.int32)
    H, W = 720, 1920
    region = np.zeros((H, W), np.uint8)
    cv2.fillPoly(region, [poly], 1)
    # exclude everything that is not map: the other catalogue elements inside the region (digital speed, info lines,
    # mode label, gear, arrow, cc panel...) and the dial faces drawn over the map
    other = np.zeros((H, W), np.uint8)
    for e in G.values():
        if e['id'].startswith('map.') or e['group'] == 'structure':
            continue
        b = [int(round(v)) for v in e['bbox']]
        cv2.rectangle(other, (b[0] - 4, b[1] - 4), (b[2] + 4, b[3] + 4), 1, -1)
    dist = cv2.distanceTransform(region, cv2.DIST_L2, 5)
    out = {}
    for ph in ('08', '09', '14'):
        rgb = rect(ph)
        L = rgb.mean(2)
        th = cv2.morphologyEx(L, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
        road = (th > 35) & (rgb.max(2) - rgb.min(2) < 60)
        road = cv2.morphologyEx(road.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        n, lab, st, _ = cv2.connectedComponentsWithStats(road, 8)
        keep = np.zeros_like(road)
        for i in range(1, n):
            if max(st[i, 2], st[i, 3]) >= 40:
                keep[lab == i] = 1
        keep &= region.astype(np.uint8) & (1 - other)
        dt = cv2.distanceTransform(keep, cv2.DIST_L2, 3)
        # widths: local maxima of the distance transform (the skeleton), 2*dt - 1 ~ the half-max width
        loc = (dt >= cv2.dilate(dt, np.ones((3, 3), np.uint8))) & (dt > 0)
        w = 2 * dt[loc] - 1
        core = keep.astype(bool) & (dt >= np.percentile(dt[keep > 0], 60))
        bg = region.astype(bool) & ~cv2.dilate(keep, np.ones((7, 7), np.uint8)).astype(bool) & ~other.astype(bool)
        bands = []
        for d0, d1 in ((0, 10), (10, 25), (25, 45), (45, 70), (70, 100), (100, 150), (150, 400)):
            mm = bg & (dist >= d0) & (dist < d1)
            if mm.sum() > 50:
                bands.append([d0, d1] + np.median(rgb[mm], 0).round(1).tolist() + [int(mm.sum())])
        rows = []
        for y in range(150, 620, 40):
            mm = bg.copy()
            mm[:y] = False
            mm[y + 40:] = False
            mm &= dist > 40
            if mm.sum() > 50:
                rows.append([y, y + 40] + np.median(rgb[mm], 0).round(1).tolist())
        # outside the region, just past the edge (what the fade goes to)
        ring_out = (cv2.dilate(region, np.ones((25, 25), np.uint8)) - region).astype(bool) & ~other.astype(bool)
        hist = np.histogram(w, bins=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 20])[0].tolist()
        out[ph] = dict(road_rgb=np.median(rgb[core], 0).round(1).tolist(), road_rgb_p90=np.percentile(rgb[core], 90, 0).round(1).tolist(),
                       road_width_hist_bins=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 20], road_width_hist=hist,
                       road_width_median=float(np.median(w)), road_width_p90=float(np.percentile(w, 90)),
                       bg_by_edge_distance=bands, bg_by_row=rows, outside=np.median(rgb[ring_out], 0).round(1).tolist(),
                       road_px=int(keep.sum()))
        print(ph, 'roads', out[ph]['road_rgb'], 'p90', out[ph]['road_rgb_p90'], 'width median %.1f p90 %.1f' % (
            out[ph]['road_width_median'], out[ph]['road_width_p90']), 'hist', hist)
        print('   bg by edge distance', bands)
        print('   bg by row', rows)
        print('   outside', out[ph]['outside'])
        vis = (rgb * 0.5).astype(np.uint8)
        vis[keep > 0] = (0, 255, 0)
        cv2.polylines(vis, [poly], True, (255, 0, 255), 1)
        cv2.imwrite(os.path.join(SCRATCH, 'map_roads_%s.png' % ph), vis[100:650, 500:1450, ::-1])
    json.dump(out, open(os.path.join(SCRATCH, 'fit_map.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
