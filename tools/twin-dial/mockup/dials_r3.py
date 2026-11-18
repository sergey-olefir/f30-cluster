#!/usr/bin/env python3
"""Twin Dial round 3, package K1: the dial variants as full panel pictures, close-ups beside the references, and one
contact sheet for the owner.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/mockup/dials_r3.py

Writes (git-ignored) bake/work/twin-dial/mockup/r3/: <nn>_<look>.png (1920 x 720), close/<nn>_<look>.png (our tachometer
beside the reference crops, all at the same R), dials_sheet.png, protected_zones_*.png, checks.json.
The looks are design/twin-dial/r3/k1/looks.json (drawn by mockup.py). The reference crops come from the rectified frames
(package VR: 02, 04, 05; package SD: 06, 08) and exist only in the git-ignored pictures: no reference pixel is an input
to the drawing or enters a tracked file.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mockup as M                                     # noqa: E402
from PIL import Image, ImageDraw, ImageFont            # noqa: E402

WORK = os.path.join(M.ROOT, 'bake', 'work', 'twin-dial')
OUT = os.path.join(WORK, 'mockup', 'r3')
BOX = (-1.08, -1.06, 1.08, 0.98)                       # the close-up in R about the dial centre (x0, y0, x1, y1)

# (file stem, look, row, label, reference crops for the close-up, render keywords)
VARIANTS = [
    ('00_today', 'today', 'Today and the fixes', 'Today (0.1.0 as specified)', ['06', '08'], {}),
    ('01_fixed', 'r3_fixed', 'Today and the fixes', 'Fixed: red to the band cut (143), rings end together, thin rim', ['06', '08'], {}),
    ('10_band_A', 'r3_fixed', 'Band look', 'A: today\'s band (on the fixes)', ['02R', '06'], {}),
    ('11_band_B', 'band_B', 'Band look', 'B: 06 (flatter, lighter, cool)', ['06'], {}),
    ('12_band_C', 'band_C', 'Band look', 'C: between A and B', ['06', '02R'], {}),
    ('20_red_wedge', 'r3_fixed', 'Red zone', 'Wedge to the band end', ['08', '04'], {}),
    ('21_red_arc', 'red_arc', 'Red zone', 'Red bezel arc (06), no wedge', ['06'], {}),
    ('22_red_both', 'red_both', 'Red zone', 'Wedge and red bezel', ['06', '08'], {}),
    ('23_red_wedge_rim', 'red_wedge_rim', 'Red zone', 'Wedge, rim red over it (08)', ['08'], {}),
    ('24_red_08_end', 'red_08_end', 'Red zone', 'Wedge ends just past the "8" (ours), grey after', ['08', '06'], {}),
    ('30_rim_fixed', 'r3_fixed', 'Inner rim', 'Rim thin (0.008 R), ends with band and bezel (143.5)', ['06'], {}),
    ('31_rim_today', 'rim_today', 'Inner rim', 'Rim as today (0.016 R, +-150)', ['06'], {}),
    ('40_num_flat', 'r3_fixed', 'Numerals', 'Flat (today)', ['06'], {}),
    ('41_num_shadow', 'num_shadow', 'Numerals', 'Soft shadow (06)', ['06'], {}),
    ('50_gear_low', 'r3_fixed', 'Gear', 'Gear low in the hub (today, 02)', ['02'], {}),
    ('51_gear_centre', 'gear_centre', 'Gear', 'Gear in the centre, program under (06)', ['06'], {}),
    ('60_strip_plain', 'r3_fixed', 'Tick strip', 'Strip plain (today)', ['06'], {}),
    ('61_strip_line', 'strip_line', 'Tick strip', 'Strip with its bright outer line (06)', ['06'], {}),
    ('70_needle_plain', 'r3_fixed', 'Needle', 'White, no shadow', ['06'], {}),
    ('71_needle_shadow', 'needle_shadow', 'Needle', 'White with the engine\'s shadow', ['06'], {}),
    ('80_look_06', 'look_06', 'Combinations', 'All of 06 (B, arc, shadows, gear centre, line)', ['06'], {}),
    ('81_look_C_both', 'look_C_both', 'Combinations', 'K1 middle: C, wedge + arc, shadows, line', ['06', '08'], {}),
]
GEAR_SAMPLE = {'gear_centre': 'D', 'look_06': 'D'}     # 06 shows a single letter in the centre; our 'D3' fits too


def label_font(px):
    return ImageFont.truetype(os.path.join(M.FONTS, 'notosans', 'NotoSans[wdth,wght].ttf'), px)


def ref_frame(rid):
    """(image, canvas) of a rectified reference, or None. 06-11 from SD (pub/SD), 01-05 from VR (pub/VR)."""
    for img, meta in ((os.path.join(WORK, 'r3', 'pub', 'SD', rid + '_rect.png'), [
            os.path.join(WORK, 'r3', 'pub', 'SD', rid + '_model.json'), os.path.join(WORK, 'r3', 'SD', 'vr', rid, 'rect.json')]),
            (os.path.join(WORK, 'pub', 'VR', rid + '_rect.png'), [os.path.join(WORK, 'pub', 'VR', 'index.json')])):
        if not os.path.exists(img):
            continue
        for mp in meta:
            if not os.path.exists(mp):
                continue
            d = json.load(open(mp))
            canvas = d.get('canvas') or d.get('refs', {}).get(rid, {}).get('canvas')
            if canvas:
                return Image.open(img).convert('RGB'), canvas
    return None


def crop_R(img, centre, R, size):
    x0, y0, x1, y1 = BOX
    box = (int(round(centre[0] + x0 * R)), int(round(centre[1] + y0 * R)), int(round(centre[0] + x1 * R)), int(round(centre[1] + y1 * R)))
    return img.crop(box).resize(size, Image.LANCZOS)


def ours_crop(img, kind='tach', size=None):
    c = M.CT if kind == 'tach' else M.CS
    x0, y0, x1, y1 = BOX
    w, h = int(round((x1 - x0) * M.R)), int(round((y1 - y0) * M.R))
    return crop_R(img, c, M.R, size or (w, h))


REF_SIDE = {'02R': ('02', 'right')}                   # 02's left dial is the hybrid power meter: its band is the right dial's


def ref_crop(rid, size, side='left'):
    rid, side = REF_SIDE.get(rid, (rid, side))
    f = ref_frame(rid)
    if not f:
        return None
    img, cv = f
    return crop_R(img, cv['left_centre' if side == 'left' else 'right_centre'], cv.get('R_px', 400.0), size)


def wrap(text, f, width):
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if f.getlength(t) <= width or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    return lines + [cur]


def caption(img, text, sub=None):
    f = label_font(19)
    lines = wrap(text, f, img.width - 14)[:2]
    h = 8 + 24 * len(lines) + (22 if sub else 0)
    out = Image.new('RGB', (img.width, img.height + h), (24, 24, 26))
    out.paste(img, (0, 0))
    d = ImageDraw.Draw(out)
    for i, ln in enumerate(lines):
        d.text((8, img.height + 4 + 24 * i), ln, font=f, fill=(255, 255, 255))
    if sub:
        d.text((8, img.height + 6 + 24 * len(lines)), sub, font=label_font(15), fill=(170, 170, 175))
    return out


def hcat(imgs, gap=8, bg=(24, 24, 26)):
    w = sum(i.width for i in imgs) + gap * (len(imgs) - 1)
    h = max(i.height for i in imgs)
    out = Image.new('RGB', (w, h), bg)
    x = 0
    for i in imgs:
        out.paste(i, (x, 0))
        x += i.width + gap
    return out


def vcat(imgs, gap=8, bg=(24, 24, 26)):
    w = max(i.width for i in imgs)
    h = sum(i.height for i in imgs) + gap * (len(imgs) - 1)
    out = Image.new('RGB', (w, h), bg)
    y = 0
    for i in imgs:
        out.paste(i, (0, y))
        y += i.height + gap
    return out


def checks(look, name):
    """The '8' inside the zone; the band, rim and bezel ends; nothing of the dial in the keep-outs."""
    cv = M.Canvas()
    a0, a1, r0, r1 = M.eight_extent(cv, M.CT)
    end = M.tach_angle(8.0) if look.red_to is None else a1 + 2.0 if look.red_to == 'past8' else look.red_to
    zone = (M.tach_angle(look.red_from), end)
    inside = zone[0] <= a0 and a1 <= zone[1]
    return {'look': name, 'red_zone_deg': [round(zone[0], 2), round(zone[1], 2)], 'eight_ink_deg': [round(a0, 2), round(a1, 2)],
            'eight_ink_rho': [round(r0, 3), round(r1, 3)], 'eight_wholly_inside': inside, 'band_end_deg': look.band_ang,
            'bezel_end_deg': look.bezel_ang, 'rim_end_deg': look.rim_ang, 'red_style': look.red_style}


def keepout_audit(img):
    """Non-black pixels of the picture inside the keep-outs that the dials could reach (SPEC §3.3): BMW's belt group and
    the gear-letter gap. (The tab bar, centre and bottom row are not the dials' and are left to K2.)"""
    px = img.load()
    res = {}
    for nm, (x0, y0, x1, y1) in (('belt_group', (497, 660, 688, 720)), ('gear_gap', (1380, 660, 1460, 720))):
        n = sum(1 for y in range(y0, y1) for x in range(x0, x1) if max(px[x, y]) > 8)
        res[nm] = n
    return res


def main():
    os.makedirs(os.path.join(OUT, 'close'), exist_ok=True)
    rendered, report = {}, {'variants': [], 'checks': {}}
    for stem, lname, row, label, refs, kw in VARIANTS:
        look = M.look_named(lname)
        key = (lname, tuple(sorted(kw.items())))
        if key not in rendered:
            gear = GEAR_SAMPLE.get(lname, 'D3')
            rendered[key] = M.render(look=None if lname == 'today' else look, gear=gear, **kw)
        img = rendered[key]
        img.save(os.path.join(OUT, stem + '.png'))
        oc = ours_crop(img)
        tiles = [caption(oc, 'ours: ' + label, lname)]
        for rid in refs:
            rc = ref_crop(rid, oc.size)
            if rc is not None:
                tiles.append(caption(rc, 'reference %s (rectified, same R)' % rid.replace('02R', '02, right dial'), 'not ours: for comparison only'))
        hcat(tiles).save(os.path.join(OUT, 'close', stem + '.png'))
        report['checks'][lname] = checks(look, lname)
        report['variants'].append({'file': stem + '.png', 'look': lname, 'row': row, 'label': label, 'refs': refs,
                                   'keepout_nonblack_px': keepout_audit(img)})
        print('wrote', stem)
    # the contact sheet: one row per choice, our tachometer close-ups, then the reference crops
    tw = 300
    th = int(round(tw * (BOX[3] - BOX[1]) / (BOX[2] - BOX[0])))
    rows, order = [], []
    for v in VARIANTS:
        if v[2] not in order:
            order.append(v[2])
    for row in order:
        items = [v for v in VARIANTS if v[2] == row]
        tiles, seen_refs = [], []
        for stem, lname, _, label, refs, kw in items:
            img = Image.open(os.path.join(OUT, stem + '.png'))
            tiles.append(caption(ours_crop(img, size=(tw, th)), label, stem))
            seen_refs += [r for r in refs if r not in seen_refs]
        for rid in seen_refs[:2]:
            rc = ref_crop(rid, (tw, th))
            if rc is not None:
                tiles.append(caption(rc, 'reference ' + rid.replace('02R', '02 (right dial)'), 'not ours'))
        strip = hcat(tiles)
        head = Image.new('RGB', (strip.width, 34), (24, 24, 26))
        ImageDraw.Draw(head).text((6, 4), row, font=label_font(22), fill=(240, 200, 90))
        rows.append(vcat([head, strip], gap=0))
    title = Image.new('RGB', (10, 44), (24, 24, 26))
    sheet = vcat([title] + rows, gap=10)
    ImageDraw.Draw(sheet).text((6, 6), 'Twin Dial round 3 — the dials (K1). Tachometer close-ups; full pictures in r3/<nn>_*.png. '
                               'Reference crops are photos of the references, never ours.', font=label_font(20), fill=(255, 255, 255))
    sheet.save(os.path.join(OUT, 'dials_sheet.png'))
    print('wrote dials_sheet.png', sheet.size)
    for lname in ('r3_fixed', 'look_06', 'look_C_both'):
        img = Image.open(os.path.join(OUT, next(v[0] for v in VARIANTS if v[1] == lname) + '.png'))
        M.annotate(img, black_box=True).save(os.path.join(OUT, 'protected_zones_%s.png' % lname))
    json.dump(report, open(os.path.join(OUT, 'checks.json'), 'w'), indent=1, ensure_ascii=False)
    for k, c in report['checks'].items():
        print(k, c['red_zone_deg'], '8 ink', c['eight_ink_deg'], 'inside' if c['eight_wholly_inside'] else 'NOT inside')


if __name__ == '__main__':
    main()
