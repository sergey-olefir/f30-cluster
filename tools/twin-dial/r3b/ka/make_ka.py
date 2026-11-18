#!/usr/bin/env python3
"""Twin Dial round 3b, package KA: the dials, the speed limit (a + b + the red strip, variants L1-L3), cruise and the
limiter (places C1-C3). Draws every picture of docs/twin-dial/MOCKUP-SPEC-R3B.md section 3.

    UV_CACHE_DIR=<main checkout>/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I \\
        tools/twin-dial/r3b/ka/make_ka.py [group ...]          groups: A L C sheets (default: all)

Writes bake/work/twin-dial/mockup/r3b/ka/ (git-ignored): <id>_<name>.png (1920 x 720), closeup/<id>_<name>.png,
annotated/<id>_<name>.png, sheets, index.json, checks.json, measurements.json. Every number comes from SPEC-R3 / the JSON of
the twin-r3/* branches (docs/twin-dial/r3b/KA-REPORT.md names them); the reference crops (06) appear only in git-ignored pictures.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MOCK = os.path.join(HERE, '..', '..', 'mockup')
sys.path.insert(0, MOCK)
import mockup as M                                       # noqa: E402
import frame_r3b as F                                    # noqa: E402
import dials_r3 as D                                     # noqa: E402  (K1's crops, captions, reference frames)
import pictos_r3b as P                                   # noqa: E402
from PIL import Image, ImageDraw, ImageFont              # noqa: E402

OUT = os.path.join(M.ROOT, 'bake', 'work', 'twin-dial', 'mockup', 'r3b', 'ka')
for sub in ('closeup', 'annotated', 'sheets'):
    os.makedirs(os.path.join(OUT, sub), exist_ok=True)
BASE = 'r3b_base'
CS, CT, R = M.CS, M.CT, M.R
INDEX, MEAS, CHECKS = [], {}, {}
LAYOUT = json.load(open(os.path.join(M.ROOT, 'design', 'twin-dial', 'vg', 'layout.json')))
HOLES = LAYOUT['keep_outs']['telltales_holes']['rects_plus_3px']
SPEC_SECTIONS = {'A': 'SPEC-R3 2 (the dials), MOCKUP-SPEC-R3B KA-1', 'L': 'SPEC-R3 8, MOCKUP-SPEC-R3B KA-2',
                 'C': 'SPEC-R3 9, MOCKUP-SPEC-R3B KA-3'}
# data status of the things on a picture (docs: arrives = seen in the car's log; unseen = declared, never seen here; after probe)
ST = {'dials': 'arrives (speed, rpm, gear, drive program: in the car\'s log)',
      'clock': 'arrives (timeDateUTC)', 'range': 'arrives (range)', 'odo': 'unseen (odometer member, P3; trip distance, P4)',
      'temp': 'arrives (ambient temperature)',
      'limit': 'unseen: TrafficSignDisplayControl.displaySpeedLimitAndNoPassingRestriction is declared; no log line of it in the repository (SPEC-R3 8); the build logs it, the car session confirms',
      'cruise': 'after probe: TrafficSignDisplayControl.displayDriverAssistanceLongitudinal unseen (SPEC-R3 9); the build carries the drawing switched off (config.cruise null)'}


def lf(px, bold=False):
    return M.font(('notosans', 'NotoSans[wdth,wght].ttf'), px / M.SS, 700 if bold else 500, 100)


def label_font(px):
    return ImageFont.truetype(os.path.join(M.FONTS, 'notosans', 'NotoSans[wdth,wght].ttf'), px)


# ---- the frame ---------------------------------------------------------------------------------------------------------
def build(tab=1, limit=None, cruise=None, strip='L1', place='C1', speed=87.0, rpm=2.4, gear='D3', program='COMFORT', ready=True,
          look=BASE, window=False, sign=True, night=False, sign_state=None):
    """A Canvas with the dials (the base look), the minimal frame and the sign. sign=False: the frame without the sign
    (for measuring its clearances); sign_state: the Limit the sign shows when it differs from the dial's."""
    lk = M.look_named('r3b_night' if night else look) if isinstance(look, str) else look
    cv = M.Canvas()
    M.draw_dials(cv, lk, speed, rpm, gear, program, ready, limit, cruise, strip, place)
    F.frame(cv, tab, (sign_state or limit) if sign else None, window)
    return cv


def keepout_audit(img, window_poly=None):
    """Non-black pixels (any channel > 0) of the picture inside the keep-outs: BMW's belt group, the gear gap, the seven
    side-lamp holes. (BMW's own panel is drawn grey inside the window on the picture of an open window: it is BMW's, not ours.)"""
    a = np.asarray(img.convert('RGB'))
    res = {}
    for nm, (x0, y0, x1, y1) in list(F.KEEP.items()) + [('hole%d' % i, tuple(h)) for i, h in enumerate(HOLES)]:
        sub = a[int(y0):int(y1), int(x0):int(x1)].max(-1)
        res[nm] = int((sub > 0).sum())
        if (sub > 8).any():
            res[nm + '_over8'] = int((sub > 8).sum())
            res[nm + '_max'] = int(sub.max())
    return res


def poly_mask(poly, size=(M.W, M.H)):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in poly], fill=255)
    return np.asarray(m) > 0


def add(pid, name, img, what, variant, data, decides='', close=None, extra=None, audit=True):
    path = os.path.join(OUT, '%s_%s.png' % (pid, name))
    img.save(path)
    rec = {'id': pid, 'file': os.path.relpath(path, OUT), 'what': what, 'variant': variant, 'data_status': data,
           'spec': SPEC_SECTIONS[pid[0]], 'decides': decides}
    if close:
        rec['closeup'] = close
    if audit:
        rec['keepout_nonblack_px'] = keepout_audit(img)
    if extra:
        rec.update(extra)
    INDEX.append(rec)
    return rec


def crop_close(cv, rect, scale, pid, name, tag=None):
    """A close-up of the canvas: rect (x0, y0, x1, y1) in panel px at `scale` x (the 3x canvas is reduced, not enlarged)."""
    big = M.finish(cv, scale)
    x0, y0, x1, y1 = rect
    out = big.crop((int(x0 * scale), int(y0 * scale), int(x1 * scale), int(y1 * scale)))
    rel = os.path.join('closeup', '%s_%s.png' % (pid, name))
    out.save(os.path.join(OUT, rel))
    return rel


SPEEDO_RECT = (int(CS[0] - 1.08 * R), int(CS[1] - 1.06 * R), int(CS[0] + 1.08 * R), int(CS[1] + 0.98 * R))      # the speedometer, 2x
TACH_RECT = (int(CT[0] - 1.08 * R), int(CT[1] - 1.06 * R), int(CT[0] + 1.08 * R), int(CT[1] + 0.98 * R))
SIGN_RECT = (1100, 590, 1400, 720)
HUB_LOW_RECT = (1380, 440, 1700, 720)


def status_for(limit=None, cruise=None, row_lines=2):
    d = {'dials, gear, program': ST['dials'], 'clock, temperature': ST['clock'] + '; ' + ST['temp']}
    if row_lines == 2:
        d['odometer, trip distance (tab 1 row)'] = ST['odo']
    d['coolant, fuel bars'] = 'arrives'
    if limit is not None:
        d['speed limit (sign, marker, strip)'] = ST['limit']
    if cruise is not None:
        d['cruise / limiter (readout, marker)'] = ST['cruise']
    return d


# ---- measuring ---------------------------------------------------------------------------------------------------------
def ink_mask(img, thr=24):
    return np.asarray(img.convert('RGB')).max(-1) > thr


def min_dist(mask_a, mask_b, box=None):
    """The least distance in px between two bool masks (same size) and the two nearest points ((xa, ya), (xb, yb))."""
    ya, xa = np.nonzero(mask_a)
    yb, xb = np.nonzero(mask_b)
    if not len(xa) or not len(xb):
        return None
    best = (1e9, None, None)
    for i in range(0, len(xa), 400):
        dx = xa[i:i + 400, None] - xb[None, :]
        dy = ya[i:i + 400, None] - yb[None, :]
        d2 = dx * dx + dy * dy
        k = np.unravel_index(np.argmin(d2), d2.shape)
        if d2[k] < best[0]:
            best = (float(d2[k]), (int(xa[i + k[0]]), int(ya[i + k[0]])), (int(xb[k[1]]), int(yb[k[1]])))
    return math.sqrt(best[0]), best[1], best[2]


def seg_dist_rect(cx, cy, r, rect):
    """Distance from a disc (cx, cy, r) to an axis-aligned rect, edge to edge (px)."""
    x0, y0, x1, y1 = rect
    dx, dy = max(x0 - cx, 0, cx - x1), max(y0 - cy, 0, cy - y1)
    return math.hypot(dx, dy) - r


def disc_poly_dist(cx, cy, r, poly):
    best = 1e9
    n = len(poly)
    for i in range(n):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % n]
        px, py = cx - ax, cy - ay
        vx, vy = bx - ax, by - ay
        t = max(0.0, min(1.0, (px * vx + py * vy) / ((vx * vx + vy * vy) or 1)))
        best = min(best, math.hypot(px - t * vx, py - t * vy))
    return best - r


def sign_clearances(**kw):
    """The sign's clearances measured on our own render (SPEC-R3 8 / SV): to BMW's stored-message marker, to our ink, to the
    fallback window (its bounding box and its polygon), to the gear gap, to the panel's bottom."""
    lim = kw.get('limit') or M.Limit('limit', 50)
    with_sign = F_render(sign_state=lim, **kw)
    without = F_render(sign=False, **kw)
    a, b = np.asarray(with_sign.convert('RGB')).astype(int), np.asarray(without.convert('RGB')).astype(int)
    diff = np.abs(a - b).max(-1) > 24
    ours = ink_mask(without)
    ys, xs = np.nonzero(diff)
    sx0, sy0, sx1, sy1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    near = ours.copy()
    near[:, :1150] = False                                 # our ink near the sign: the row's end, the speedometer, its bar
    near[:540, :] = False
    d_ink = min_dist(diff, near)
    cx, cy, r = M.SIGN
    poly = F.fallback_polygon()
    res = {'sign_ink_box': [sx0, sy0, sx1, sy1], 'stored_marker': round(seg_dist_rect(cx, cy, r, F.STORED_MARKER), 1),
           'our_ink': round(d_ink[0], 1), 'our_ink_points': [d_ink[1], d_ink[2]],
           'fallback_window_bbox': round(seg_dist_rect(cx, cy, r, (696.0, 595.75, 1226.0, 704.0)), 1),
           'fallback_window_polygon': round(disc_poly_dist(cx, cy, r, poly), 1),
           'gear_gap': round(seg_dist_rect(cx, cy, r, F.KEEP['gear_gap']), 1), 'panel_bottom': round(M.H - (cy + r), 1)}
    # nearest ink split by what it is: the bottom row's text (left of the sign) and the speedometer's parts (right / above)
    left = near.copy(); left[:, 1262:] = False
    d_left = min_dist(diff, left)
    right = near.copy(); right[:, :1340] = False
    d_right = min_dist(diff, right)
    res['to_bottom_row_text'] = [round(d_left[0], 1), d_left[1], d_left[2]] if d_left else None
    res['to_speedometer_ink'] = [round(d_right[0], 1), d_right[1], d_right[2]] if d_right else None
    return res


_RENDER_CACHE = {}


def F_render(**kw):
    return M.finish(build(**kw))


# ---- group A -----------------------------------------------------------------------------------------------------------
def tile(img, cap, sub=None):
    return D.caption(img, cap, sub)


def ours_crop_scaled(cv, kind, scale):
    big = M.finish(cv, scale)
    x0, y0, x1, y1 = SPEEDO_RECT if kind == 'speed' else TACH_RECT
    return big.crop((x0 * scale, y0 * scale, x1 * scale, y1 * scale))


def ref_tile(rid, kind, size):
    rc = D.ref_crop(rid, size, 'right' if kind == 'speed' else 'left')
    return D.caption(rc, 'reference %s (rectified, same R = %d px)' % (rid, size[0] / 2.16), 'not ours: for comparison only') if rc else None


def numerals_stats():
    """Darkening of the band by each numeral-shadow model, measured on the tachometer's render: the mean and the
    share of the band pixels beside the numerals' ink that are darkened below 0.9 / 0.5 of the unshadowed level."""
    out = {}
    base = None
    for key, lname in (('none', 'r3b_noshadow'), ('K1', 'r3b_k1shadow'), ('SD', 'r3b_base')):
        cv = M.Canvas()
        M.draw_dials(cv, M.look_named(lname), 87.0, 2.4, 'D3')
        a = np.asarray(M.finish(cv, 1).convert('RGB')).astype(float)
        sub = a[int(CT[1] - R):int(CT[1] + R), int(CT[0] - R):int(CT[0] + R)]
        if key == 'none':
            base = sub
            ys, xs = np.mgrid[0:sub.shape[0], 0:sub.shape[1]]
            rr = np.hypot(xs - R + .5, ys - R + .5) / R
            band = (rr > 0.60) & (rr < 0.88) & (base.max(-1) < 140)
            out['_band_px'] = int(band.sum())
            continue
        ratio = (sub.sum(-1) + 1) / (base.sum(-1) + 1)
        r = ratio[band]
        out[key] = {'mean_darkening_in_band': round(float(1 - r.mean()), 4), 'share_below_0.9': round(float((r < 0.9).mean()), 4),
                    'share_below_0.5': round(float((r < 0.5).mean()), 4), 'min_ratio': round(float(r.min()), 3)}
    return out


def group_A():
    look = M.look_named(BASE)
    lim = None
    # A01 the full picture
    cv = build()
    img = M.finish(cv)
    add('A01', 'full_base_look', img, 'the whole panel in the base look (look_06 with SPEC-R3 2): tab 1, date and time, driving state 87 km/h, 2400 rpm, D3, COMFORT, READY, fuel 3.2 / 5, coolant 2.6 / 5, 14:43, +7.5 C, 48 215 km, 412.6 km',
        'base', status_for(), 'confirmation of the final dial look (nothing to choose)')
    ann = annotate(img)
    ann.save(os.path.join(OUT, 'annotated', 'A01_full_base_look.png'))
    # A02 / A03 close-ups beside 06
    for pid, kind, nm in (('A02', 'tach', 'tachometer'), ('A03', 'speed', 'speedometer')):
        c2 = ours_crop_scaled(cv, kind, 2)
        tiles = [tile(c2, 'ours, R = 600 px (base look)', 'r3b_base')]
        rt = ref_tile('06', kind, c2.size)
        if rt:
            tiles.append(rt)
        big = D.hcat(tiles)
        add(pid, 'close_%s_vs_06' % nm, big, 'the %s at R = 600 px beside the rectified 06 crop at the same R' % nm, 'base', status_for(),
            'confirmation: ring ends, band, shadows, hub, red zone', audit=False)
    # A04 the numeral shadow
    stats = numerals_stats()
    MEAS['A04_numeral_shadow_stats'] = stats
    zoom_rect = (CT[0] - 1.02 * R, CT[1] - 0.98 * R, CT[0] + 1.02 * R, CT[1] + 0.02 * R)      # the tachometer's upper half
    rows1, rows2 = [], []
    for lname, cap in (('r3b_noshadow', 'no shadow'), ('r3b_k1shadow', "K1's by-eye shadow (what the owner saw): (0.008, 0.020) R, sigma 0.009, 0.70"),
                       ('r3b_base', "SD's measured model: outline 0.008 R (0.75) + drop shadow (0.010, 0.012) R, sigma 0.008, 0.35")):
        c = build(look=lname)
        big = M.finish(c, 1)
        x0, y0, x1, y1 = [int(v) for v in zoom_rect]
        rows1.append(tile(big.crop((x0, y0, x1, y1)), cap, lname))
        # numeral "2" and "7" at 3x
        for nr, key in ((2, 'n2'), (7, 'n7')):
            a = M.tach_angle(nr)
            ctr = c.polar(CT, a, 0.745 * R)
            b3 = M.finish(c, 3)
            rows2.append((lname, nr, b3.crop((int((ctr[0] - 46) * 3), int((ctr[1] - 46) * 3), int((ctr[0] + 46) * 3), int((ctr[1] + 46) * 3)))))
    refimg = D.ref_frame('06')
    tl = list(rows1)
    if refimg:
        im, cvs = refimg
        cc, Rr = cvs['left_centre'], cvs.get('R_px', 400.0)
        x0, y0, x1, y1 = zoom_rect
        s = Rr / R
        rc = im.crop((int(cc[0] + (x0 - CT[0]) * s), int(cc[1] + (y0 - CT[1]) * s), int(cc[0] + (x1 - CT[0]) * s), int(cc[1] + (y1 - CT[1]) * s)))
        tl.append(tile(rc.resize((int(x1 - x0), int(y1 - y0)), Image.LANCZOS), 'reference 06 (rectified, same R)', 'not ours: for comparison only'))
    top = D.hcat(tl)
    # second row: numerals 2 and 7 at 3x, for each model, then 06
    zr = []
    for nr in (2, 7):
        cells_ = [t for (ln, n, t) in rows2 if n == nr]
        row = [tile(t.resize((600, 600), Image.LANCZOS), nm_, 'numeral %d' % nr) for t, nm_ in zip(cells_, ('none', "K1's", "SD's"))]
        if refimg:
            im, cvs = refimg
            cc, Rr = cvs['left_centre'], cvs.get('R_px', 400.0)
            ctr = M.Canvas().polar(CT, M.tach_angle(nr), 0.745 * R)
            s = Rr / R
            px, py = cc[0] + (ctr[0] - CT[0]) * s, cc[1] + (ctr[1] - CT[1]) * s
            row.append(tile(im.crop((int(px - 46 * s), int(py - 46 * s), int(px + 46 * s), int(py + 46 * s))).resize((600, 600), Image.LANCZOS), 'reference 06', 'not ours'))
        zr.append(D.hcat(row))
    sheet = D.vcat([top, D.vcat(zr)])
    add('A04', 'numeral_shadow', sheet, "the tachometer's numerals: no shadow, K1's by-eye shadow, SD's measured model, and the 06 crop (upper half at R = 300; numerals 2 and 7 at 6.5x)",
        'none / K1 / SD', status_for(), "confirmation: which shadow the bake takes (SPEC-R3 2.4 says SD's); the owner saw K1's in picture 80",
        extra={'shadow_stats': stats}, audit=False)
    # A05 the lower ends
    a05 = group_A05()
    # A06 gear states
    group_A06()
    # A07 engine off
    c7 = build(speed=0.0, rpm=-0.32, gear='P', program=None, ready=False)
    img7 = M.finish(c7)
    add('A07', 'engine_off', img7, 'engine off: the needle on OFF (-135 deg), no READY, gear P, no program, speed 0',
        'off', {'dials': ST['dials']}, 'confirmation of the rest state', close=crop_close(c7, TACH_RECT, 2, 'A07', 'engine_off'))
    # A08 redline settings
    ims = []
    for rl in (5000, 6500, 7500):
        lk = M.replace(M.look_named(BASE), red_from=rl / 1000.0) if hasattr(M, 'replace') else None
        cv = M.Canvas()
        M.draw_dials(cv, lk, 87.0, 2.4, 'D3')
        F.frame(cv, 1, None)
        im = M.finish(cv)
        ims.append((rl, cv, im))
        red_num = math.ceil(rl / 1000.0 - 1e-9)
        add('A08', 'redline_%d' % rl, im, 'redline %d rpm: the red arc starts at %.2f deg; the numerals %s turn red (a numeral is red from the redline rounded up to 1000)' % (
            rl, M.tach_angle(rl / 1000.0), ', '.join(str(k) for k in range(red_num, 9))),
            '%d rpm' % rl, status_for(), 'confirmation: the arc starts at the redline; the red numerals follow the rounded-up value',
            close=crop_close(cv, TACH_RECT, 2, 'A08', 'redline_%d' % rl), extra={'red_arc_start_deg': round(M.tach_angle(rl / 1000.0), 2), 'red_numerals': list(range(red_num, 9))})
    tl = [tile(ours_crop_scaled(cv, 'tach', 1), 'redline %d rpm' % rl) for rl, cv, _ in ims]
    D.hcat(tl).save(os.path.join(OUT, 'sheets', 'A08_redlines_sheet.png'))


def annotate(img):
    """M.annotate (hood, belt group, gear gap, BMW's gear letter, fallback window, BMW's lamps) plus the stored-message marker
    and the G20's black box [1420, 320, 1611, 440] (SPEC-R3 12), the side-lamp holes."""
    out = M.annotate(img, black_box=False).convert('RGBA')
    ov = Image.new('RGBA', out.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rectangle(list(F.STORED_MARKER), outline=(255, 90, 200, 255), width=2)
    d.rectangle(list(F.BLACK_BOX), fill=(255, 255, 255, 40), outline=(255, 255, 255, 255), width=2)
    for h in HOLES:
        d.rectangle(list(h), outline=(255, 0, 255, 200), width=1)
    out = Image.alpha_composite(out, ov).convert('RGB')
    dd = ImageDraw.Draw(out)
    f = label_font(18)
    for i, (col, txt) in enumerate([((255, 90, 200), "BMW's stored-message marker"), ((255, 255, 255), "the G20's KOMBI black box [1420, 320, 1611, 440], when it appears")]):
        dd.rectangle([20, 20 + (6 + i) * 26, 38, 38 + (6 + i) * 26], fill=col)
        dd.text((46, 20 + (6 + i) * 26), txt, font=f, fill=(255, 255, 255))
    return out


# ---- A05: the strip view of the lower ends ----------------------------------------------------------------------------------
def bilinear(arr, xs, ys):
    h, w = arr.shape[:2]
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 2)
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 2)
    fx, fy = (xs - x0)[..., None], (ys - y0)[..., None]
    return (arr[y0, x0] * (1 - fx) * (1 - fy) + arr[y0, x0 + 1] * fx * (1 - fy) + arr[y0 + 1, x0] * (1 - fx) * fy + arr[y0 + 1, x0 + 1] * fx * fy)


def polar_strip(arr, centre, Rpx, th0=110.0, th1=160.0, r0=0.50, r1=1.04, ppd=20, ppR=2000):
    """The picture unrolled about a dial centre: x = theta (deg clockwise from 12), y = rho (rho 1.04 at the top)."""
    th = np.linspace(th0, th1, int((th1 - th0) * ppd))
    rho = np.linspace(r1, r0, int((r1 - r0) * ppR))
    T, Rh = np.meshgrid(th, rho)
    xs = centre[0] + Rh * Rpx * np.sin(np.radians(T))
    ys = centre[1] - Rh * Rpx * np.cos(np.radians(T))
    return bilinear(arr.astype(np.float32), xs, ys), th, rho


def ring_ends(strip, th, rho):
    """Where each ring ends (deg): the last theta whose strip at the ring's rho is brighter than half its own plateau."""
    res = {}
    for nm_, rr in (('band', 0.64), ('bezel', 1.0), ('rim', 0.544)):
        row = strip[np.argmin(np.abs(rho - rr)), :, :].max(-1)
        plateau = row[:int(len(row) * 0.1)].mean()
        low = row < 0.5 * plateau
        run = np.convolve(low.astype(float), np.ones(30), 'valid') >= 30           # 1.5 deg of dark in a row (a major line is 0.6 deg)
        below = np.nonzero(run)[0]
        res[nm_] = round(float(th[below.min()]) if len(below) else float('nan'), 2)      # the first theta where it has ended
    return res


def group_A05():
    rows, ends = [], {}
    cvn = build(rpm=2.4)
    cvo = M.Canvas()
    M.draw_dials(cvo, None, 87.0, 2.4, 'D3')
    for kind, ci, name in (('tach', CT, 'tachometer'), ('speed', CS, 'speedometer')):
        cols = []
        for key, cvx in (('ours-new (r3b_base)', cvn), ('ours-0.1.0 (today)', cvo)):
            arr = np.asarray(cvx.img).astype(np.float32)
            s, th, rho = polar_strip(arr, (ci[0] * M.SS, ci[1] * M.SS), R * M.SS)
            ends[(name, key)] = ring_ends(s, th, rho)
            cols.append((key, s))
        ref = D.ref_frame('06')
        if ref:
            im, cvs = ref
            c06 = cvs['left_centre' if kind == 'tach' else 'right_centre']
            s, th, rho = polar_strip(np.asarray(im), c06, cvs.get('R_px', 400.0))
            ends[(name, 'reference 06')] = ring_ends(s, th, rho)
            cols.append(('reference 06 (not ours)', s))
        rows.append((name, cols))
    # the picture: for each dial a row of three strips side by side
    tiles = []
    for name, cols in rows:
        row = []
        for key, s in cols:
            img = Image.fromarray(np.clip(s * (1.0 if 'ref' in key else 1.0), 0, 255).astype(np.uint8))
            img = img.resize((img.width // 1, img.height // 2), Image.LANCZOS)
            dr = ImageDraw.Draw(img)
            for deg in (120, 130, 140, 150):                 # a 10 deg ruler along the top
                x = (deg - 110) * 20
                dr.line([(x, 0), (x, 16)], fill=(255, 220, 0), width=1)
                dr.text((x + 3, 2), str(deg), font=label_font(14), fill=(255, 220, 0))
            xe = (143.0 - 110) * 20
            dr.line([(xe, 0), (xe, img.height)], fill=(0, 200, 255), width=1)
            row.append(D.caption(img, '%s: %s' % (name, key), 'theta 110-160 deg, rho 1.04 (top) - 0.50; cyan line = 143.0 deg'))
        tiles.append(D.hcat(row))
    big = D.vcat(tiles)
    MEAS['A05_ring_ends_deg'] = {'%s | %s' % k: v for k, v in ends.items()}
    add('A05', 'lower_ends_strip_view', big, "the lower ends of both dials unrolled (theta 110-160 deg, rho 0.50-1.04): ours-new, ours-0.1.0, 06 - the three rings ending together",
        'new / 0.1.0 / 06', status_for(), 'confirmation: rings end on one radial line (143.0 / 143.6 / 143.55)',
        extra={'ring_ends_deg': MEAS['A05_ring_ends_deg']}, audit=False)


# ---- A06: the gear states ------------------------------------------------------------------------------------------------
GEARS = ['P', 'R', 'N', 'D', 'D3', 'M4', 'S2', '–']
PROGRAMS = ['COMFORT', 'SPORT', 'SPORT+', 'ECO PRO', 'ADAPTIVE', None]


def group_A06():
    hub = 0.62
    rect = (CT[0] - hub * R, CT[1] - hub * R, CT[0] + hub * R, CT[1] + hub * R)
    rows = []
    gfont, pfont, rfont = M.saira(92), M.saira(24), M.saira(22)
    m = {}
    inner_r = (0.544 - 0.004) * R

    def hub_img(gear, program, ready):
        cv = M.Canvas()
        M.draw_dials(cv, M.look_named(BASE), 87.0, 2.4, gear, program or '', ready)
        big = M.finish(cv, 1)
        return big.crop(tuple(int(round(v)) for v in rect))

    gear_prog = ['COMFORT', 'SPORT', 'SPORT+', 'ECO PRO', 'ADAPTIVE', None, 'COMFORT', 'SPORT']
    for ready in (True, False):
        tl = []
        for g, pr in zip(GEARS, gear_prog):
            tl.append(D.caption(hub_img(g, pr, ready), '%s  %s' % (g, pr or 'no program'), 'READY %s' % ('on' if ready else 'off')))
        rows.append(D.hcat(tl))
    tl = [D.caption(hub_img('D3', pr, True), 'D3  %s' % (pr or 'no program'), 'programs') for pr in PROGRAMS]
    rows.append(D.hcat(tl))
    sheet = D.vcat(rows)
    # the clearances, from the fonts (numbers): the ink box of the gear against the inner ring, READY and the program
    cap = lambda f: -f.getbbox('H', anchor='ls')[1] / M.SS
    capg, capp, capr = cap(gfont), cap(pfont), cap(rfont)
    for g in GEARS:
        l, t, r_, b = gfont.getbbox(g, anchor='ls')
        w = (r_ - l) / M.SS
        top, bot = -(-t / M.SS), b / M.SS
        ink_top = -capg / 2 if g != '–' else None
        corner = math.hypot(w / 2, capg / 2)
        m[g] = {'ink_width_px': round(w, 1), 'corner_to_centre_px': round(corner, 1), 'gap_to_inner_ring_px': round(inner_r - corner, 1)}
    prog_top = 0.209 * R - capp / 2
    gear_bot = capg / 2
    ready_bot = -0.29 * R + capr / 2
    gear_top = -capg / 2
    widest = {}
    for pr in ['COMFORT', 'SPORT', 'SPORT+', 'ECO PRO', 'ADAPTIVE']:
        l, t, r_, b = pfont.getbbox(pr, anchor='ls')
        w = (r_ - l) / M.SS
        corner = math.hypot(w / 2, 0.209 * R + capp / 2)
        widest[pr] = {'ink_width_px': round(w, 1), 'corner_to_centre_px': round(corner, 1), 'gap_to_inner_ring_px': round(inner_r - corner, 1)}
    MEAS['A06_hub'] = {'cap_gear_px': round(capg, 1), 'spec_cap_gear_px': 66.6, 'cap_program_px': round(capp, 1), 'spec_cap_program_px': 17.4,
                       'inner_ring_inner_edge_r_px': round(inner_r, 1), 'gear_bottom_to_program_top_px': round(prog_top - gear_bot, 1),
                       'ready_bottom_to_gear_top_px': round(gear_top - ready_bot, 1), 'gears': m, 'programs': widest,
                       'unit_label_top_to_program_bottom_px': round((0.40 * R - 7.1) - (0.209 * R + capp / 2), 1)}
    add('A06', 'gear_states_hub', sheet, 'the tachometer hub for the gear values P R N D D3 M4 S2 "-" with a program under each (COMFORT, SPORT, SPORT+, ECO PRO, ADAPTIVE, none), READY on (row 1) and off (row 2); row 3: D3 with each program',
        'hub', {'gear, program, READY': ST['dials']}, 'confirmation: the widest value (M4 / D3) clears the inner ring and the program line',
        extra={'measurements': MEAS['A06_hub']}, audit=False)


# ---- group L -------------------------------------------------------------------------------------------------------------
def Lc(variant, limit, speed, **kw):
    return build(limit=limit, speed=speed, strip=variant, **kw)


def group_L():
    pics = {}
    lim50 = M.Limit('limit', 50)
    st = lambda lim: status_for(lim)
    defs = [('L01', 'L1', 50, 42, 'below the limit'), ('L02', 'L2', 50, 42, 'below the limit'), ('L03', 'L3', 50, 42, 'below the limit'),
            ('L04', 'L1', 50, 63, 'over the limit'), ('L05', 'L2', 50, 63, 'over the limit'), ('L06', 'L3', 50, 63, 'over the limit')]
    readings = {'L1': 'L1 (the spec): red from the limit to +125 deg, dim below / full over, ticks white',
                'L2': 'L2: red only between the limit and the needle, only while over',
                'L3': 'L3: as L1 but always full red'}
    for pid, var, lv, sp, nm in defs:
        cv = Lc(var, M.Limit('limit', lv), sp)
        add(pid, '%s_limit%d_speed%d' % (var, lv, sp), M.finish(cv), 'limit %d, speed %d (%s): %s' % (lv, sp, nm, readings[var]), var, st(M.Limit('limit', lv)),
            'which reading of "the strip red from the limit"', close=crop_close(cv, SPEEDO_RECT, 2, pid, '%s_limit%d_speed%d' % (var, lv, sp)))
    # L07-L10, each in L1 with a row for L2 and L3
    for pid, lv, sp in (('L07', 90, 87), ('L08', 130, 112), ('L09', 30, 28), ('L10', 110, 135)):
        for var in ('L1', 'L2', 'L3'):
            cv = Lc(var, M.Limit('limit', lv), sp)
            nm = '%s_limit%d_speed%d' % (var, lv, sp)
            add(pid, nm, M.finish(cv), 'limit %d at %d km/h, %s' % (lv, sp, readings[var].split(':')[0]), var, st(M.Limit('limit', lv)),
                "the strip's length at a low / high limit and where the marker meets the numerals", close=crop_close(cv, SPEEDO_RECT, 2, pid, nm))
    # sheet rows for L07-L10 and L21 (the marker on a major tick and next to small numerals)
    sheet_L07_10()
    sheet_L21()
    # L11 unknown, L12 end, L13 none, L14 conditional, L15 mph
    singles = [('L11', 'unknown_limit', M.Limit('unknown', 0), 'the limit is unknown (254 / 255): the empty sign with three dashes, no marker, no red strip'),
               ('L12', 'end_of_restrictions', M.Limit('end', 0), 'end of all restrictions: the derestriction sign (white disc, five diagonal stripes), no marker'),
               ('L13', 'nothing_received', M.Limit('none', 0), 'nothing received (or invalidFlag): no sign at all'),
               ('L14', 'conditional_limit', M.Limit('conditional', 50), 'a conditional limit (rain, time, ...): the sign with a dot under it, the marker hollow'),
               ('L15', 'mph_30', M.Limit('limit', 30, 'mph'), 'mph: the sign shows 30 (mph), the marker stands at 48 km/h')]
    for pid, nm, lim, what in singles:
        cv = build(limit=lim, speed=42.0, strip='L1')
        add(pid, nm, M.finish(cv), what, 'L1', status_for(lim if lim.state != 'none' else None),
            'confirmation of the sign states', close=crop_close(cv, SIGN_RECT, 3, pid, nm), extra={'close_speedo': crop_close(cv, SPEEDO_RECT, 2, pid, nm + '_speedo')})
    # L16 / L17: the sign beside the bottom row
    for pid, tab, nm, what in (('L16', 1, 'bottom_row_two_lines_tab1', 'the sign with the bottom row in two lines (tab 1)'),
                               ('L17', 3, 'bottom_row_one_line_tab3', 'the sign with the bottom row in one line (tab 3)')):
        cv = build(tab=tab, limit=lim50, speed=42.0)
        cl = sign_clearances(tab=tab, limit=lim50, speed=42.0)
        MEAS[pid] = cl
        add(pid, nm, M.finish(cv), what + '; spacing to the temperature: %.1f px, to the right dial: %.1f px' % (cl['to_bottom_row_text'][0], cl['to_speedometer_ink'][0]),
            'L1', status_for(lim50, row_lines=2 if tab == 1 else 1), 'the sign\'s spacing to the temperature and to the right dial',
            close=crop_close(cv, SIGN_RECT, 3, pid, nm), extra={'clearances_px': cl})
    # L18: the fallback window open
    cvw = build(limit=lim50, speed=42.0, window=True)
    imgw = M.finish(cvw)
    cl = sign_clearances(limit=lim50, speed=42.0, window=True)
    MEAS['L18'] = cl
    # ours only: the frame with the window open but BMW's panel not drawn, to count our ink inside the polygon
    cvo = M.Canvas()
    M.draw_dials(cvo, M.look_named(BASE), 42.0, 2.4, 'D3', 'COMFORT', True, lim50, None, 'L1')
    F.tab_bar(cvo, 1); F.page_clock(cvo); M.draw_sign(cvo, lim50)
    own = np.asarray(M.finish(cvo).convert('RGB')).max(-1) > 0
    inside = int((own & poly_mask(F.fallback_polygon())).sum())
    MEAS['L18']['our_ink_px_inside_open_window'] = inside
    ann = imgw.copy()
    dd = ImageDraw.Draw(ann)
    poly = F.fallback_polygon()
    dd.line(poly + [poly[0]], fill=(0, 255, 120), width=2)
    cx, cy, r = M.SIGN
    dd.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 220, 0), width=1)
    # the nearest point of the window to the sign: draw the segment
    best = None
    for i in range(len(poly)):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % len(poly)]
        vx, vy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((cx - ax) * vx + (cy - ay) * vy) / ((vx * vx + vy * vy) or 1)))
        px, py = ax + t * vx, ay + t * vy
        dist = math.hypot(cx - px, cy - py)
        if best is None or dist < best[0]:
            best = (dist, px, py)
    ux, uy = (cx - best[1]) / best[0], (cy - best[2]) / best[0]
    dd.line([(best[1], best[2]), (cx - ux * r, cy - uy * r)], fill=(255, 220, 0), width=2)
    dd.text((1236, 598), '%.1f px to the window (polygon); %.1f px to its bbox' % (cl['fallback_window_polygon'], cl['fallback_window_bbox']), font=label_font(18), fill=(255, 220, 0))
    dd.text((1236, 620), 'our ink inside the open window: %d px' % inside, font=label_font(18), fill=(255, 220, 0))
    ann.save(os.path.join(OUT, 'annotated', 'L18_fallback_window_open.png'))
    add('L18', 'fallback_window_open', imgw, "the fallback window open (a message, D7 not confirmed): BMW's panel (drawn grey as the bench does), our bottom row stepped aside, the sign stays; %.1f px from the sign to the window (polygon), %.1f px to its box; our ink inside the window: %d px" % (
        cl['fallback_window_polygon'], cl['fallback_window_bbox'], inside), 'L1', status_for(lim50), 'confirmation: the sign stays when the window opens',
        close=crop_close(cvw, SIGN_RECT, 3, 'L18', 'fallback_window_open'), extra={'clearances_px': cl}, audit=False)
    # L19: digits in the disc
    tiles = []
    meas19 = {}
    for v in (30, 50, 100, 130):
        cv = build(limit=M.Limit('limit', v), speed=20.0)
        big = M.finish(cv, 3)
        cx, cy, r = M.SIGN
        crop = big.crop((int((cx - 42) * 3), int((cy - 42) * 3), int((cx + 42) * 3), int((cy + 42) * 3))).resize((378, 378), Image.LANCZOS)
        f, size = M.sign_figure(str(v))
        l, t, r_, b = f.getbbox(str(v), anchor='ls')
        w, h = (r_ - l) / M.SS, (b - t) / M.SS
        meas19[v] = {'font_px': size, 'ink_w': round(w, 1), 'ink_h': round(h, 1), 'corner_r': round(math.hypot(w / 2, h / 2), 1),
                     'white_disc_r': round(r - M.SIGN_RING, 1), 'gap_corner_to_ring': round(r - M.SIGN_RING - math.hypot(w / 2, h / 2), 1)}
        tiles.append(D.caption(crop, '%d: Saira bold %.1f px, ink %.1f x %.1f, corner %.1f of %.1f' % (v, size, w, h, math.hypot(w / 2, h / 2), r - M.SIGN_RING), 'shrink rule: corners >= 2 px inside the white disc'))
    MEAS['L19_digits'] = meas19
    add('L19', 'digits_in_the_disc', D.hcat(tiles), 'two- and three-digit numbers in the disc (30, 50, 100, 130) at 4.5x: the shrink rule (largest size, at most 0.95 r, whose ink corners stay 2 px inside the white disc)',
        'shrink rule', {'speed limit': ST['limit']}, 'confirmation of the figure sizes', extra={'figures': meas19}, audit=False)
    # L20: every clearance of SPEC-R3 8
    cl = sign_clearances(limit=lim50, speed=42.0)
    MEAS['L20'] = cl
    SV = {'stored_marker': 10.7, 'our_ink': 26.0, 'fallback_window_bbox': 41.0, 'gear_gap': 47.0, 'panel_bottom': 15.0}
    MEAS['L20_vs_SV'] = {k: {'ours': cl[k], 'SV': v, 'diff': round(cl[k] - v, 1)} for k, v in SV.items()}
    cv = build(limit=lim50, speed=42.0)
    img = M.finish(cv)
    ann = annotate(img)
    dd = ImageDraw.Draw(ann)
    cx, cy, r = M.SIGN
    f = label_font(17)
    # the clearance lines
    sx0, sy0, sx1, sy1 = cl['sign_ink_box']
    dd.rectangle([sx0 - 1, sy0 - 1, sx1, sy1], outline=(255, 220, 0), width=1)
    (px, py), (qx, qy) = cl['our_ink_points']
    dd.line([(px, py), (qx, qy)], fill=(255, 220, 0), width=2)
    notes = [('our ink', cl['our_ink'], SV['our_ink'], (1010, 560)), ('stored marker', cl['stored_marker'], SV['stored_marker'], (1240, 560)),
             ('window (bbox)', cl['fallback_window_bbox'], SV['fallback_window_bbox'], (1010, 585)),
             ('gear gap', cl['gear_gap'], SV['gear_gap'], (1380, 640)), ('panel bottom', cl['panel_bottom'], SV['panel_bottom'], (1340, 703))]
    dd.line([(1288, 630), (1288 - 12 * 0.27, 630 + 42 * 0.97)], fill=(255, 90, 200), width=2)
    dd.line([(cx + r, cy), (1380, cy)], fill=(255, 150, 0), width=2)
    dd.line([(cx, cy + r), (cx, 720)], fill=(255, 255, 255), width=2)
    dd.line([(cx - r, cy), (1226, cy)], fill=(0, 255, 120), width=2)
    y0 = 20
    for i, (nm_, ours, sv, _) in enumerate(notes):
        dd.text((720, 36 + i * 24), '%s: %.1f px (SV %.1f)' % (nm_, ours, sv), font=label_font(19), fill=(255, 255, 255))
    ann.save(os.path.join(OUT, 'annotated', 'L20_clearances.png'))
    # a zoom
    zoom = ann.crop((1100, 560, 1500, 720)).resize((1600, 640), Image.LANCZOS)
    add('L20', 'clearances_annotated', ann, 'every clearance of SPEC-R3 8 measured on this render and compared with SV: ' + '; '.join(
        '%s %.1f (SV %.1f)' % (k, v['ours'], v['SV']) for k, v in MEAS['L20_vs_SV'].items()), 'L1', status_for(lim50), 'confirmation of the sign placement', extra={'clearances_px': cl, 'vs_SV': MEAS['L20_vs_SV']}, audit=False)
    zoom.save(os.path.join(OUT, 'closeup', 'L20_clearances_zoom.png'))


def strip_close(cv, ang_a, ang_b, scale=3, rho0=0.80, rho1=1.02, centre=CS):
    """A crop of the speedometer's strip between two angles (deg) at `scale` x."""
    pts = [(centre[0] + r * R * math.sin(math.radians(a)), centre[1] - r * R * math.cos(math.radians(a))) for a in (ang_a, ang_b) for r in (rho0, rho1)]
    x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
    y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
    big = M.finish(cv, scale)
    return big.crop((int((x0 - 6) * scale), int((y0 - 6) * scale), int((x1 + 6) * scale), int((y1 + 6) * scale)))


def sheet_L07_10():
    rows = []
    for var in ('L1', 'L2', 'L3'):
        tl = []
        for lv, sp in ((90, 87), (130, 112), (30, 28), (110, 135)):
            cv = Lc(var, M.Limit('limit', lv), sp)
            c = ours_crop_scaled(cv, 'speed', 1)
            tl.append(D.caption(c, '%s: limit %d at %d' % (var, lv, sp)))
        rows.append(D.hcat(tl))
    D.vcat(rows).save(os.path.join(OUT, 'sheets', 'L07-L10_strip_length_L1_L2_L3.png'))


def sheet_L21():
    """The marker on a major tick (100 = 0 deg) and beside the small numerals (30, 50, 70) at 4x."""
    tl = []
    meas = {}
    for lv in (30, 50, 70, 100, 130):
        cv = build(limit=M.Limit('limit', lv), speed=lv - 8, strip='L1')
        a = M.spd_angle(lv)
        im = strip_close(cv, a - 7, a + 7, 4, 0.74, 1.01)
        tl.append(D.caption(im, 'limit %d: marker at %.2f deg' % (lv, a), 'major tick' if lv in (100, 130 - 130 + 100) else ('minor tick' if lv % 10 == 0 else '')))
        meas[lv] = round(a, 2)
    MEAS['L21_marker_angles'] = meas
    sh = D.hcat(tl)
    pid = 'L21'
    path = os.path.join(OUT, '%s_marker_on_ticks_and_numerals.png' % pid)
    sh.save(path)
    INDEX.append({'id': pid, 'file': os.path.basename(path), 'what': "added by KA (the spec asks to 'show' the marker on a major tick): the marker at 30, 50, 70, 100 (= 0 deg, a major tick) and 130 at 4x, with the small numerals beside it",
                  'variant': 'L1', 'data_status': status_for(M.Limit('limit', 50)), 'spec': SPEC_SECTIONS['L'], 'decides': 'confirmation: the marker over the ticks'})


# ---- group C -------------------------------------------------------------------------------------------------------------
CRUISE_NAMES = {'cruise': 'cruise control', 'acc': 'adaptive cruise control', 'limiter': 'speed limiter'}


def group_C():
    # C00: the symbols large
    tiles = []
    for nm_, cap in (('cr_cruise', 'cruise'), ('cr_acc', 'adaptive cruise'), ('cr_lim', 'limiter')):
        a = P.icon_alpha(nm_, 216)
        im = Image.fromarray((a * 255).astype(np.uint8)).convert('RGB')
        small = P.icon_alpha(nm_, 38)
        s = Image.fromarray((small * 255).astype(np.uint8)).convert('RGB')
        cv = Image.new('RGB', (216 + 20 + 76, 216), (0, 0, 0))
        cv.paste(im, (0, 0))
        cv.paste(s.resize((38, 38)), (236, 20))
        cv.paste(s.resize((76, 76), Image.NEAREST), (236, 80))
        tiles.append(D.caption(cv, '%s (6x; the same at 1x and 2x beside it)' % cap, 'our own, in the icon format; box 38 px for 36 px of ink'))
    add('C00', 'symbols_6x', D.hcat(tiles), 'the three symbols drawn large once for review: cruise (a dial arc with a pointer and an arrow), adaptive cruise (the same with a car outline ahead), limiter ("LIM" in a rounded frame)',
        'symbols', {'symbols': 'our own drawings, no data'}, 'review of the three symbols', audit=False)
    cases = [('C01', 'cruise_active_set110_speed108', M.Cruise('cruise', 'active', 110), None, 108.0, 'cruise active, set 110, speed 108'),
             ('C02', 'acc_active_set110_speed87', M.Cruise('acc', 'active', 110), None, 87.0, 'adaptive cruise active, set 110, speed 87 (a car ahead)'),
             ('C03', 'standby_set110_speed87', M.Cruise('cruise', 'standby', 110), None, 87.0, 'standby: grey number and symbol, no marker'),
             ('C04', 'limiter_active_set90_speed87', M.Cruise('limiter', 'active', 90), None, 87.0, 'limiter active, set 90, speed 87'),
             ('C06', 'three_digits_set130_speed128_limit130', M.Cruise('cruise', 'active', 130), M.Limit('limit', 130), 128.0, 'three-digit speeds everywhere: set 130, speed 128, limit 130 - digits, readout and sign together'),
             ('C07', 'everything_limit90_set110_speed103', M.Cruise('cruise', 'active', 110), M.Limit('limit', 90), 103.0, 'everything at once: limit 90 (sign, red marker, red strip L1), cruise set 110 (green marker), speed 103'),
             ('C08', 'set_equals_limit_110', M.Cruise('cruise', 'active', 110), M.Limit('limit', 110), 108.0, 'set speed equal to the limit (110 / 110): both markers at the same angle')]
    for place in ('C1', 'C2'):
        for pid, nm, cr, lim, sp, what in cases:
            cv = build(cruise=cr, limit=lim, speed=sp, place=place, strip='L1')
            close = crop_close(cv, HUB_LOW_RECT, 3, pid, '%s_%s' % (place, nm))
            ex = {'close_speedo': crop_close(cv, SPEEDO_RECT, 2, pid, '%s_%s_speedo' % (place, nm))}
            add(pid, '%s_%s' % (place, nm), M.finish(cv), '%s [place %s]' % (what, place), place, status_for(lim, cr),
                'the place of the readout (C1 hub / C2 coolant-bar place)', close=close, extra=ex)
    # C05 off
    cv = build(speed=87.0)
    add('C05', 'off_nothing', M.finish(cv), 'cruise off: nothing (the coolant bar stays; identical in C1 and C2)', 'C1 = C2', status_for(), 'confirmation', close=crop_close(cv, HUB_LOW_RECT, 3, 'C05', 'off_nothing'))
    # C08 close-up of the two markers
    cv = build(cruise=M.Cruise('cruise', 'active', 110), limit=M.Limit('limit', 110), speed=108.0)
    a = M.spd_angle(110)
    strip_close(cv, a - 6, a + 6, 5, 0.86, 1.01).save(os.path.join(OUT, 'closeup', 'C08_markers_same_angle_5x.png'))
    # C09: the black box over C1 and C2
    c09()
    # C10: night
    for pid, nm, cr, lim, sp in (('C01', 'cruise_active_set110_speed108', M.Cruise('cruise', 'active', 110), None, 108.0),
                                 ('C07', 'everything_limit90_set110_speed103', M.Cruise('cruise', 'active', 110), M.Limit('limit', 90), 103.0)):
        tl = []
        for place in ('C1', 'C2'):
            day = M.finish(build(cruise=cr, limit=lim, speed=sp, place=place))
            night = M.finish(build(cruise=cr, limit=lim, speed=sp, place=place, night=True))
            add('C10', 'night_%s_%s_%s' % (pid, place, nm), night, 'night (SPEC-R3 6 multipliers, hypotheses) of %s, place %s' % (pid, place), place, status_for(lim, cr),
                'night legibility of the readout and the markers', close=crop_close(build(cruise=cr, limit=lim, speed=sp, place=place, night=True), SPEEDO_RECT, 2, 'C10', 'night_%s_%s' % (pid, place)))
            tl.append(D.vcat([D.caption(day, 'day, %s %s' % (pid, place)), D.caption(night, 'night, %s %s' % (pid, place))]))
        D.hcat(tl).save(os.path.join(OUT, 'sheets', 'C10_night_%s.png' % pid))
    c3_fit()


def c09():
    """The G20's black box [1420, 320, 1611, 440] over C1 and C2: what of the digits, the unit and the readout it would cover."""
    bb = F.BLACK_BOX
    res = {}
    tiles = []
    for place in ('C1', 'C2'):
        cv = build(cruise=M.Cruise('cruise', 'active', 110), limit=M.Limit('limit', 90), speed=103.0, place=place)
        img = M.finish(cv)
        ann = img.convert('RGBA')
        ov = Image.new('RGBA', ann.size, (0, 0, 0, 0))
        ImageDraw.Draw(ov).rectangle(list(bb), fill=(255, 255, 255, 50), outline=(255, 255, 255, 255), width=2)
        ann = Image.alpha_composite(ann, ov).convert('RGB')
        # the items' ink boxes (panel px) from the fonts
        items = {}
        c = CS
        d_font = M.saira(92)
        l, t, r_, b = d_font.getbbox('103', anchor='ls')
        w = (r_ - l) / M.SS
        items['speed digits "103"'] = (c[0] - w / 2, c[1] + 0.03 * R - 32.5, c[0] + w / 2, c[1] + 0.03 * R + 32.5)
        u = M.noto(21)
        l, t, r_, b = u.getbbox('км/год', anchor='ls')
        w = (r_ - l) / M.SS
        items['unit "км/год" (speed)'] = (c[0] - w / 2, c[1] + 0.24 * R - 7.5, c[0] + w / 2, c[1] + 0.24 * R + 7.5)
        if place == 'C1':
            xr, nb, ub, sx, sy = c[0] - 4, c[1] + 140, c[1] + 160, c[0] + 32, c[1] + 128
        else:
            xr, nb, ub, sx, sy = c[0] + 77, c[1] + 218, c[1] + 241, c[0] - 33, c[1] + 217
        wn = M.saira(40).getlength('110') / M.SS
        items['set speed "110"'] = (xr - wn, nb - 28, xr, nb)
        wu = M.noto(19).getlength('км/год') / M.SS
        items['unit "км/год" (set)'] = (xr - wu, ub - 13.3, xr, ub + 3)
        items['symbol (36 px)'] = (sx - 18, sy - 18, sx + 18, sy + 18)
        res[place] = {}
        for k, (x0, y0, x1, y1) in items.items():
            ox0, oy0, ox1, oy1 = max(x0, bb[0]), max(y0, bb[1]), min(x1, bb[2]), min(y1, bb[3])
            ov_ = max(0, ox1 - ox0) * max(0, oy1 - oy0)
            res[place][k] = {'ink_box': [round(v, 1) for v in (x0, y0, x1, y1)], 'overlap_px2': round(ov_, 1), 'share_covered': round(ov_ / ((x1 - x0) * (y1 - y0)), 3),
                             'gap_below_box_px': round(y0 - bb[3], 1)}
        ImageDraw.Draw(ann).text((1230, 300), "G20 black box [1420, 320, 1611, 440]", font=label_font(18), fill=(255, 255, 255))
        ann.save(os.path.join(OUT, 'annotated', 'C09_black_box_%s.png' % place))
        tiles.append(D.caption(ann.crop((1216, 280, 1864, 700)), 'black box over %s' % place))
        add('C09', 'black_box_over_%s' % place, ann, "the G20's black box [1420, 320, 1611, 440] over %s: %s" % (place, '; '.join(
            '%s %s' % (k, 'covered %.0f%%' % (100 * v['share_covered']) if v['overlap_px2'] else 'clear by %.1f px' % v['gap_below_box_px']) for k, v in res[place].items())),
            place, status_for(M.Limit('limit', 90), M.Cruise()), 'which parts the black box would cover if it appeared', extra={'overlaps': res[place]}, audit=False)
    D.hcat(tiles).save(os.path.join(OUT, 'sheets', 'C09_black_box_C1_C2.png'))
    MEAS['C09_black_box'] = res


def c3_fit():
    """C3: the readout beside a shortened coolant bar (bar x 1414-1540, readout x 1556-1666): does it fit with >= 6 px between
    every pair of items? Computed from the fonts and the symbol size; no picture is drawn if it does not."""
    x0, x1 = 1556.0, 1666.0
    sym, gap = 36.0, 6.0
    res = {'readout_box_x': [x0, x1], 'width_px': x1 - x0, 'bar_x': [1414, 1540], 'needed': {}}
    for s in ('88', '90', '110', '130', '199'):
        wn = M.saira(40).getlength(s) / M.SS
        res['needed'][s] = {'number_px': round(wn, 1), 'symbol_gap_number_px': round(sym + gap + wn, 1), 'fits_110px': sym + gap + wn <= x1 - x0, 'over_by_px': round(sym + gap + wn - (x1 - x0), 1)}
    wu = M.noto(19).getlength('км/год') / M.SS
    res['unit_px'] = round(wu, 1)
    res['gap_bar_end_to_readout_px'] = x0 - 1540
    res['verdict'] = 'does not fit for any three-digit set speed (symbol 36 + gap 6 + number %.1f px > 110 px); fits only for two digits (%s)' % (
        res['needed']['110']['number_px'], ', '.join(k for k, v in res['needed'].items() if v['fits_110px']))
    MEAS['C3_fit'] = res


# ---- sheets and index -------------------------------------------------------------------------------------------------------
def contact_sheets():
    """One contact sheet per group: the pictures' speedometer / tab-1 views as thumbnails, labelled by id."""
    def sheet(ids_pred, name, cols=3, tw=620):
        items = [r for r in INDEX if ids_pred(r) and r['file'].endswith('.png') and 'annotated' not in r['file']]
        tiles = []
        for r in items:
            im = Image.open(os.path.join(OUT, r['file'])).convert('RGB')
            if im.size != (M.W, M.H):
                im = im.resize((tw, int(im.height * tw / im.width)), Image.LANCZOS)
            else:
                im = im.resize((tw, int(tw * M.H / M.W)), Image.LANCZOS)
            tiles.append(D.caption(im, '%s  %s' % (r['id'], r['variant']), os.path.basename(r['file'])[:60]))
        rows = [D.hcat(tiles[i:i + cols]) for i in range(0, len(tiles), cols)]
        if rows:
            D.vcat(rows).save(os.path.join(OUT, 'sheets', name))
    sheet(lambda r: r['id'] in ('A01', 'A07') or r['id'] == 'A08', 'A_dials_sheet.png', 3)
    sheet(lambda r: r['id'] in ('L01', 'L02', 'L03', 'L04', 'L05', 'L06'), 'L_red_strip_L1_L2_L3_sheet.png', 3)
    sheet(lambda r: r['id'] in ('L11', 'L12', 'L13', 'L14', 'L15', 'L16', 'L17', 'L18'), 'L_sign_states_sheet.png', 3)
    sheet(lambda r: r['id'] in ('C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08') and r['variant'] == 'C1', 'C_cruise_C1_sheet.png', 3)
    sheet(lambda r: r['id'] in ('C01', 'C02', 'C03', 'C04', 'C06', 'C07', 'C08') and r['variant'] == 'C2', 'C_cruise_C2_sheet.png', 3)


def write_outputs():
    json.dump(INDEX, open(os.path.join(OUT, 'index.json'), 'w'), indent=1, ensure_ascii=False)
    json.dump(MEAS, open(os.path.join(OUT, 'measurements.json'), 'w'), indent=1, ensure_ascii=False, default=str)
    bad = {r['file']: {k: v for k, v in r['keepout_nonblack_px'].items() if v} for r in INDEX if r.get('keepout_nonblack_px') and any(r['keepout_nonblack_px'].values())}
    json.dump({'_about': 'keepout_nonblack_px counts pixels with any channel > 0; *_over8 / *_max: pixels > 8 and the largest value (filter tails are 1-5)', 'keepout_failures': bad, 'pictures_audited': sum(1 for r in INDEX if r.get('keepout_nonblack_px') is not None)}, open(os.path.join(OUT, 'checks.json'), 'w'), indent=1)
    print('pictures', len(INDEX), 'keep-out failures', len(bad))
    for k, v in bad.items():
        print('  KEEPOUT', k, v)


def main():
    groups = sys.argv[1:] or ['A', 'L', 'C', 'sheets']
    if 'A' in groups:
        group_A()
    if 'L' in groups:
        group_L()
    if 'C' in groups:
        group_C()
    if 'sheets' in groups:
        contact_sheets()
    write_outputs()


if __name__ == '__main__':
    main()
