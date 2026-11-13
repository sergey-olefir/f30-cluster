#!/usr/bin/env python3
"""Generates the three 6WB-style layouts (our own drawing, traced by eye off photos of BMW's F-series
multifunctional display; no BMW artwork is used):
    python3 design/gen_6wb.py apps/f30_cluster/hud/layouts
Writes wb_comfort.json, wb_comfort_map.json, wb_dials.json, wb_sport.json, wb_eco.json. Edit this file, not the JSON.

Proportions are measured off the photos, in dial radii (R): the two dial centres are 3.2 R apart, the display is
6.6 R wide and the dials stand at mid height; a small gauge sits 1.355 R outside each dial, 0.39 R below centre,
0.31 R in radius. The speed scale is km/h only: 0..260, 1 degree per km/h from -130 degrees. The rev scale: OFF at
-130 degrees, 0 at -109.5, 32.1 degrees per 1000 rpm up to 7.5, red from the "redline" setting.
Fonts: Arimo (tools/bake_fonts.py F30_FONTS); a text widget's box is its font's cell height."""
import json, math, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'apps', 'f30_cluster', 'hud', 'fonts')
_cell = {}
def cell(font):
    if font not in _cell:
        _cell[font] = json.load(open(os.path.join(FONTS, font + '.json')))['cellHeight']
    return _cell[font]

# Sport and Eco Pro still use the first geometry (measured off the 6WB photos); Comfort has been fitted to the G20
# (see shared/visible.js): bigger dials, the rev dial centred on BMW's black box so the box hides only the hub. We draw no
# gear letter, as in the bimmer-lab themes.
OLD = dict(R=290, SP=(496, 360), RV=(1424, 360), MINI_R=90, FU=(103, 473), OT=(1817, 473))
G20 = dict(R=335, SP=(412, 380), RV=(1508, 380), MINI_R=70, FU=(80, 628), OT=(1840, 628))
globals().update(OLD)
MID = 960
SPD_START, SPD_SWEEP = 230, 260
RPM_START, RPM_PER = 250.5, 32.1          # degrees; per 1000 rpm
RPM_MAX = 7500
RPM_SWEEP = RPM_PER * RPM_MAX / 1000.0
RPM_OFF = 20.5                # degrees before 0 where the needle parks (OFF)
SIGN_DY = 0.36              # the road signs under the speed dial's hub, this many R below its centre
# Comfort's middle window (package A): the box between the dials, symmetric about x 960 (BMW's map: x 592-1303,
# y 161-612; the dials cover its sides), its soft edges in px (top, sides, foot, off the dials' rims), and the line at
# its foot: "hair" (a hairline fading out at both ends, as the 6WB's info bar line), "chrome" (a rod shaded as our
# bezels), "none" (the map / floor just fades to black) or "glass" (the earlier baked line). FOOT is the default only:
# the "wbFoot" setting picks it on the car (shared/hud.js _wbFoot; package F)
WINDOW = [592, 158, 736, 442]
FADE = [150, 40, 56, 60]
FOOT = "hair"
FOOT_LINE = [607, 650, 1270]

def text(id, cx, cy, w, t, font, color="fg", align="center", conn=0, **kw):
    """A text box w wide, centred on (cx, cy) (align left / right: cx is that edge)."""
    h = cell(font)
    x = cx - w / 2.0 if align == "center" else cx if align == "left" else cx - w
    d = {"id": id, "type": "text", "z": 5, "x": int(round(x)), "y": int(round(cy - h / 2.0)), "w": w, "h": h,
         "text": t, "font": font, "color": color, "align": align}
    if conn: d["conn"] = conn
    d.update(kw)
    return d

def at(c, deg, r):
    a = math.radians(deg)
    return c[0] + r * math.sin(a), c[1] - r * math.cos(a)

def label(id, c, deg, r, t, font, conn, w=90, color="fg"):
    x, y = at(c, deg, r)
    return text(id, x, y, w, t, font, color, conn=conn)


def ring_label(id, c, deg, rmax, t, font, adv, conn, w=90, color="fg"):
    """A scale number whose box (len(t) glyphs of advance `adv`, the font's cell high) ends at radius rmax, so it never
    reaches the ticks: its centre sits rmax minus the box's half extent along the radius."""
    a = math.radians(deg)
    ext = abs(math.sin(a)) * adv * len(t) / 2.0 + abs(math.cos(a)) * cell(font) / 2.0
    return label(id, c, deg, rmax - ext - 3, t, font, conn, w=w, color=color)

def icon(id, name, cx, cy, conn, color="dim", w=22, h=26):
    return {"id": id, "type": "icon", "icon": name, "z": 5, "x": int(round(cx - w / 2.0)), "y": int(round(cy - h / 2.0)),
            "w": w, "h": h, "color": color, "conn": conn}

def dial(id, c, style, r=None, **kw):
    r = R if r is None else r      # R is read now: the geometry changes per mode
    d = {"id": id, "type": "dial", "class": "content", "z": 1, "x": c[0] - r, "y": c[1] - r, "w": 2 * r, "h": 2 * r,
         "look": "wb", "style": style, "ring": "chrome", "ring2": "chrome2", "needle": "needle", "face": "face",
         "tick": "fg", "glow": "accent"}
    d.update(kw)
    return d

def minis(baked=False):
    """The two side gauges: fuel (0 low on the right, clockwise round the bottom to 1/1 upper left) and its mirror,
    the oil temperature (cold low on the left, anticlockwise to hot upper right)."""
    return [
        dial("fuel", FU, "mini", r=MINI_R, ringW=5, measure="signal", signal="fuel", scale={"max": 1, "ticks": 4}, minor=2,
             start=135, sweep=185, redTo=0.10, needle="fg",
             **({"base": base("fuel", FU, MINI_R, 8, 556, 144)} if baked else {})),
        dial("oilt", OT, "mini", r=MINI_R, ringW=5, measure="signal", signal="oil", min=50, scale={"max": 150, "ticks": 4},
             minor=2, start=135, sweep=185, flip=True, coldTo=0.10, redFrom=0.90, needle="fg",
             **({"base": base("oil", OT, MINI_R, 1768, 556, 144)} if baked else {})),
        dict(icon("fuel_icon", "fuel", FU[0] + 0.40 * MINI_R, FU[1] - 0.42 * MINI_R, 1, "fg"), **({"toggle": "!baked"} if baked else {})),
        text("fuel_full", FU[0] - 0.42 * MINI_R, FU[1] - 0.26 * MINI_R, 30, "1/1", "wb_mini", conn=1),
        text("fuel_zero", FU[0] + 0.42 * MINI_R, FU[1] + 0.40 * MINI_R, 14, "0", "wb_mini", conn=1),
        dict(icon("oil_icon", "oilcan", OT[0] - 0.40 * MINI_R, OT[1] - 0.42 * MINI_R, 2, "fg", w=30), **({"toggle": "!baked"} if baked else {})),
    ]

def base(tex, c, r, ox, oy, w, kind=1):
    """A baked texture under a dial: its box (ox, oy, w square) is given in the P9 stack's panel px; the layer's box is c +- r."""
    return {"tex": tex, "x": ox - (c[0] - r), "y": oy - (c[1] - r), "w": w, "h": w, "kind": kind}

def arc_fill(tex, c, x, y, w, h, a_from, a_to, of, mx, color):
    """A bottom arc's live fill (BAKE C6): its segment coverage at panel px (x, y, w, h), lit from a_from to a_to
    (degrees cw from 12) as `of` goes 0..mx."""
    return {"tex": tex, "x": x - (c[0] - R), "y": y - (c[1] - R), "w": w, "h": h, "from": a_from, "to": a_to, "of": of, "max": mx,
            "color": color}

def comfort():
    W = [
        {"id": "bg", "type": "wbback", "class": "content", "z": 0, "x": 0, "y": 0, "w": 1920, "h": 720,
         "dl": [SP[0], SP[1], R], "dr": [RV[0], RV[1], R], "style": "comfort", "color": "accent",
         "tex": {"window": {"tex": "window", "x": 640, "y": 76, "w": 640, "h": 572},
                 "horizon": {"tex": "horizon", "x": 748, "y": 452, "w": 424, "h": 10},
                 "line": {"tex": "bar", "x": 668, "y": 602, "w": 584, "h": 79}},
         # P10 (docs/BAKE-P10-levels.md): the window's level is now in the baked texture (re-fitted across 04/03/07/06,
         # above each photo's own LCD floor), so the P9 stop-gap gain 0.24 would dim it a second time
         "gain": [1.0, 604],
         # BMW's own map window (BAKE C9: drawn under a custom theme, roads seen inside x 592-1303, y 161-612), seen
         # through our window while the "stockMap" setting is on
         "hole": WINDOW, "holeWhen": "stockMap", "holeInset": 0, "holeRadius": 22,
         # the soft window (docs/POLISH-A-REPORT.md): no box edge anywhere. The map fades into black toward the top,
         # sides and foot (the stock map veil's curve) and under the dials' rims; the floor fades at the sides and rims
         "window": WINDOW, "fade": FADE, "foot": FOOT, "footLine": FOOT_LINE},
        dial("speedo", SP, "comfort", ringW=10, base=base("speedo", SP, R, SP[0] - R, SP[1] - R, 2 * R, 3),
             fill=arc_fill("range_seg", SP, 239, 614, 346, 68, 216.0, 144.0, "fuel", 1, [210, 209, 205]), measure="speed", kmh=True, scale={"max": 260, "ticks": 13}, minor=10,
             start=SPD_START, sweep=SPD_SWEEP),
        dial("tacho", RV, "comfort", ringW=10, base=base("tacho", RV, R, RV[0] - R, RV[1] - R, 2 * R, 3),
             fill=arc_fill("ed_seg", RV, 1338, 612, 346, 70, 196.5, 143.3, "cons", 20, [114, 66, 70]), measure="rpm", scale={"max": RPM_MAX, "ticks": RPM_MAX / 1000.0}, minor=10,
             start=RPM_START, sweep=RPM_SWEEP, off=RPM_OFF),
    ] + minis(baked=True)
    # the scale numbers: the box ends at 0.78 R, inside the ticks' inner ends (0.82 R)
    for i in range(14):
        n = 20 * i
        W.append(ring_label("spd%d" % i, SP, SPD_START + n, 0.78 * R, str(n), "wb_spd", 16.7, 1))
    for i in range(1, 8):
        W.append(ring_label("rpm%d" % i, RV, RPM_START + RPM_PER * i, 0.78 * R, str(i), "wb_rpm", 24.5, 2, w=40))
    W += [
        text("speed_unit", SP[0], SP[1] - 0.40 * R, 100, "km/h", "wb_cap", conn=1),
        text("rpm_cap", RV[0], RV[1] - 0.40 * R, 200, "1/min x 1000", "wb_cap", conn=2),
        text("ready", RV[0] - 0.63 * R, RV[1] + 0.25 * R, 110, "READY", "wb_capb", conn=2),
        text("off", RV[0] - 0.575 * R, RV[1] + 0.465 * R, 70, "OFF", "wb_cap", "dim", conn=2),
        # the range at the speed dial's foot
        dict(icon("range_icon", "fuel", SP[0] - 70, SP[1] + 0.60 * R, 1, "fg"), toggle="!baked"),
        text("range_in", SP[0] + 12, SP[1] + 0.60 * R, 130, "{{range}} km", "wb_cap", conn=1, toggle="!baked"),
    ]
    # the road signs under the speed dial's hub: the limit (its figure is text on the sign) and no overtaking
    sy = SP[1] + SIGN_DY * R
    W.append({"id": "signs", "type": "wbsign", "class": "content", "z": 3, "x": 305, "y": 460, "w": 214, "h": 93, "conn": 1,
              "tex": {"limit": {"tex": "sign_limit", "x": 2, "y": 2, "w": 88, "h": 89},
                      "nopass": {"tex": "sign_nopass", "x": 124, "y": 2, "w": 88, "h": 89}}})
    # the limit's figure: a 2-digit box 37 x 30 centred 351, 505 (BAKE C7)
    W.append(text("limit", 351, 506, 60, "{{limit}}", "wb_val", "ink", conn=2))
    # the row at the middle window's foot
    # baked: one line, the range after the bar's pump pictogram (x 892-953, y 642-681); else headed columns
    for i, (tok, x) in enumerate([("{{time}}", 800), ("{{ambient}} °C", 1010)]):
        W.append(text("row_b%d" % i, x, 662, 150, tok, "wb_val", align="left", toggle="baked"))
    # the range under the road signs (its pictogram is baked into the speed dial), the instant consumption under the rev dial
    # ref 12: the range arc reads "0" at its left end, "km" at its right end and the range in the middle above it;
    # the EfficientDynamics arc the same way with the instant consumption (0 at 196.5 deg, 20 l/100 km at 143.3 deg)
    for id_, c, a0, a1, lab0, lab1, tok, conn in (("range", SP, 216.0, 144.0, "0", "km", "{{range}}", 1),
                                                  ("cons", RV, 196.5, 143.3, "0", "l/100 km", "{{cons}}", 2)):
        W.append(text(id_ + "_v", c[0], c[1] + 0.765 * R, 110, tok, "wb_spd", conn=conn, toggle="baked"))
        x0, y0 = at(c, a0, 0.775 * R)
        x1, y1 = at(c, a1, 0.775 * R)
        W.append(text(id_ + "_a0", x0, y0, 40, lab0, "wb_cap", "dim", conn=conn, toggle="baked"))
        W.append(text(id_ + "_a1", x1, y1, 100, lab1, "wb_cap", "dim", conn=conn, toggle="baked"))
    for i, (head, tok, x) in enumerate([("Time", "{{time}}", 742), ("Range", "{{range}} km", 890), ("Temp", "{{ambient}} °C", 1048)]):
        W += [text("row_h%d" % i, x, 612, 150, head, "wb_cap", "dim", align="left", toggle="!baked"),
              text("row_v%d" % i, x, 650, 160, tok, "wb_val", align="left", toggle="!baked")]
    return W

CUT_Y, CUT_FADE = 656, 26      # the big dials' open bottom (docs/OVERLAY-PLAN-DIALS.md): BMW's bottom row starts at y 659
MINI_DY = -20                  # the minis move up so BMW's range ("467 km") clears the fuel mini
# BMW's speed-limit sign (centre 539, 622, r 41) and check-control "i" ([1256, 591, 1270, 627]): the soft windows
# that show them through our dials (tools/overlay/plan_dials.py keeps the collar off both)
SIGN_WIN, I_WIN, WIN_SOFT = [539, 622, 44], [1254, 589, 1272, 629], 4
# --- package F (docs/POLISH-F-REPORT.md): 6WB Dials + G20's bottom row ---
# the full-size cover over BMW's bottom lines, hooks and grey dash (tools/overlay/plan_dials.py COVER_BOX, packed by
# tools/bake_scene.py as scene "cover"): x, y, w, h
COVER = [588, 598, 736, 64]
# the shade at our dials' inner edges ("dialShade"; WBBACK u_shade): it fades out over these y, and stays off BMW's
# right "i" (plan_dials SHADE_Y, SHADE_KO)
SHADE = {"y": [575, 605], "ko": [1253, 588, 1273, 630]}
# BMW's bottom-row items we may draw ourselves at their stock places (D rows 11-13; catalogue bboxes grown 4 px): the
# black patch under ours ("patches", WBBACK u_pat), shown while the item is ours ("own:<item>": ownRange / ownClock /
# ownTemp). Our text's baseline sits on BMW's (y 697), BMW's size: values in wb_row (Arimo Bold 44, caps ~32 px as
# BMW's), units in wb_val (Arimo Bold 36). The pump is on connection 0, so the range's box may run under it (a sheet
# holds no overlapping members) and a 4-digit range still fits
# The boxes are sized for BMW's widest text, not the photo's: its temperature is right-aligned (x ~1624), so "-22.5"
# or "+22.0" starts ~30 px left of the photo's "+3.5" and the patch runs to 1498; its range is left-aligned after the
# pump, so a 4-digit range ends ~25 px right of "467 km" (patch to 334, short of the clock's). The clock is centred
# (x ~397), and "23:59" fits the 115 px box.
OWN = {"range": [132, 662, 334, 703], "clock": [340, 662, 455, 704], "temp": [1498, 662, 1667, 705]}
ROW_BASE = 697
# our drive-mode label above the gear tray (D row 15) and the gear in the tray (D row 17), on the tacho
MODE_C, TRAY_C = (1508, 527), (1508, 583)

def base_at(font, baseline):
    """The centre y of a text box of `font` whose glyphs sit on `baseline`."""
    f = json.load(open(os.path.join(FONTS, font + '.json')))
    return baseline - f['baseline'] + f['cellHeight'] / 2.0

def own_row():
    """Our range (with the pump), clock and outside temperature at BMW's places, each shown while it is ours."""
    vy, uy = base_at("wb_row", ROW_BASE), base_at("wb_val", ROW_BASE)
    return [
        dict(icon("own_range_icon", "fuel", 150, 682, 0, "fg", w=30, h=34), toggle="own:range"),
        text("own_range", 249, vy, 110, "{{range}}", "wb_row", align="right", conn=1, toggle="own:range"),
        text("own_range_u", 253, uy, 54, "{{u:distLc}}", "wb_val", align="left", conn=1, toggle="own:range"),
        text("own_clock", 397, vy, 124, "{{time}}", "wb_row", conn=1, toggle="own:clock"),
        text("own_temp", 1615, vy, 110, "{{ambient1}}", "wb_row", align="right", conn=2, toggle="own:temp"),
        text("own_temp_u", 1619, uy, 46, "{{u:temp}}", "wb_val", align="left", conn=2, toggle="own:temp"),
        text("mode", MODE_C[0], MODE_C[1], 240, "{{mode}}", "wb_capb", conn=2, toggle="modeLabel"),
        text("gear", TRAY_C[0], TRAY_C[1], 120, "{{gear}}", "wb_gear", conn=2, toggle="gearTray=gear"),
        text("gear_l", TRAY_C[0], TRAY_C[1], 120, "{{stage}}", "wb_gear", conn=2, toggle="gearTray=letter"),
    ]
# --- end package F ---

def dials():
    """6WB Dials + G20 (docs/OVERLAY-PLAN-DIALS.md): our four dials and road signs; the G20 draws everything else round
    them. Our background is see-through except a black collar (the stock dials' parts that stick out past ours, a band
    under our dials' faded bottoms, a soft shade at their inner edges); both big dials fade out toward y 656 so BMW's
    bottom row shows. Our signs sit under the speed hub as in 6WB Comfort and close the round window over BMW's sign;
    while we have no limit (app.json config.limit unset) the window opens and BMW's shows. A small soft window shows
    BMW's check-control "i". Package F: BMW's stock bottom lines, their hooks and the grey dash are under black (the
    cover); the range, clock and outside temperature are ours or BMW's by setting (ownRange / ownClock / ownTemp), ours
    drawn at BMW's places over black patches; our drive-mode label ("modeLabel") and the gear in our tray ("gearTray")
    are on the tacho (this layout only: the others draw no gear)."""
    global FU, OT
    FU, OT = (FU[0], FU[1] + MINI_DY), (OT[0], OT[1] + MINI_DY)
    W = [
        {"id": "bg", "type": "wbback", "class": "content", "z": 0, "x": 0, "y": 0, "w": 1920, "h": 720,
         "dl": [SP[0], SP[1], R], "dr": [RV[0], RV[1], R], "style": "comfort", "color": "accent",
         "collar": {"tex": "collar", "x": 0, "y": 0, "w": 1920, "h": 720},
         # package F: BMW's bottom lines, hooks and dash under black; the shade's setting; patches under our row items
         "cover": {"tex": "cover", "x": COVER[0], "y": COVER[1], "w": COVER[2], "h": COVER[3]}, "shade": SHADE,
         "patches": [{"rect": OWN[k], "when": "own:" + k} for k in ("range", "clock", "temp")]},
        dial("speedo", SP, "comfort", ringW=10, base=base("speedo_d", SP, R, SP[0] - R, SP[1] - R, 2 * R, 3),
             cut={"y": CUT_Y, "fade": CUT_FADE, "round": SIGN_WIN, "soft": WIN_SOFT, "cover": "limit"},
             measure="speed", kmh=True, scale={"max": 260, "ticks": 13}, minor=10, start=SPD_START, sweep=SPD_SWEEP),
        dial("tacho", RV, "comfort", ringW=10, base=base("tacho_d", RV, R, RV[0] - R, RV[1] - R, 2 * R, 3),
             cut={"y": CUT_Y, "fade": CUT_FADE, "box": I_WIN, "soft": WIN_SOFT},
             measure="rpm", scale={"max": RPM_MAX, "ticks": RPM_MAX / 1000.0}, minor=10,
             start=RPM_START, sweep=RPM_SWEEP, off=RPM_OFF),
        # the road signs under the speed hub, the same widgets as 6WB Comfort's (comfort(); BAKE C7)
        {"id": "signs", "type": "wbsign", "class": "content", "z": 3, "x": 305, "y": 460, "w": 214, "h": 93, "conn": 1,
         "tex": {"limit": {"tex": "sign_limit", "x": 2, "y": 2, "w": 88, "h": 89},
                 "nopass": {"tex": "sign_nopass", "x": 124, "y": 2, "w": 88, "h": 89}}},
        text("limit", 351, 506, 60, "{{limit}}", "wb_val", "ink", conn=2),
    ]
    M = minis(baked=True)
    for w in M:                      # the minis' baked faces sit 20 px higher too (base() is relative to the layer)
        if w["type"] == "dial":
            w["base"]["y"] += MINI_DY
    W += M
    for i in range(14):
        n = 20 * i
        W.append(ring_label("spd%d" % i, SP, SPD_START + n, 0.78 * R, str(n), "wb_spd", 16.7, 1))
    for i in range(1, 8):
        W.append(ring_label("rpm%d" % i, RV, RPM_START + RPM_PER * i, 0.78 * R, str(i), "wb_rpm", 24.5, 2, w=40))
    W += [
        text("speed_unit", SP[0], SP[1] - 0.40 * R, 100, "km/h", "wb_cap", conn=1),
        text("rpm_cap", RV[0], RV[1] - 0.40 * R, 200, "1/min x 1000", "wb_cap", conn=2),
        text("ready", RV[0] - 0.63 * R, RV[1] + 0.25 * R, 110, "READY", "wb_capb", conn=2),
        text("off", RV[0] - 0.575 * R, RV[1] + 0.465 * R, 70, "OFF", "wb_cap", "dim", conn=2),
    ]
    W += own_row()                   # package F: the bottom row's items ours, the mode label, the gear in the tray
    FU, OT = (FU[0], FU[1] - MINI_DY), (OT[0], OT[1] - MINI_DY)
    return W

def glowing(mode):
    """Sport and Eco Pro: the earlier pass, on the same geometry."""
    sport = mode == "sport"
    hub = 0.62
    W = [
        {"id": "bg", "type": "wbback", "class": "content", "z": 0, "x": 0, "y": 0, "w": 1920, "h": 720,
         "dl": [SP[0], SP[1], R], "dr": [RV[0], RV[1], R], "style": mode, "color": "accent"},
        dial("speedo", SP, mode, hub=hub, ringW=6, measure="speed", kmh=True, scale={"max": 260, "ticks": 13}, minor=10,
             start=SPD_START, sweep=SPD_SWEEP),
        dial("tacho", RV, mode if sport else "eff", hub=hub, ringW=6,
             **({"measure": "rpm", "scale": {"max": RPM_MAX, "ticks": RPM_MAX / 1000.0}, "minor": 10,
                 "start": RPM_START, "sweep": RPM_SWEEP} if sport else
                {"measure": "signal", "signal": "torquePct", "scale": {"max": 100, "ticks": 10}, "minor": 1,
                 "start": 225, "sweep": 235})),
    ] + minis()
    if sport:
        W += [label("spd0", SP, SPD_START, 0.81 * R, "0", "wb_spd", 1), label("spd13", SP, SPD_START + SPD_SWEEP, 0.81 * R, "260", "wb_spd", 1)]
        W += [label("rpm%d" % i, RV, RPM_START + RPM_PER * i, 0.81 * R, str(i), "wb_rpm", 2, w=50) for i in range(1, 8)]
        W += [text("speed", SP[0], SP[1] + 0.02 * R, 260, "{{speed}}", "wb_big", conn=1),
              text("rpm_cap", RV[0], RV[1] - 0.34 * R, 200, "1/min x 1000", "wb_cap", conn=2)]
    else:
        for i in range(14):
            n = 20 * i
            W.append(label("spd%d" % i, SP, SPD_START + n, (0.76 if n >= 100 else 0.79) * R, str(n), "wb_spd", 1,
                           color="fg" if i <= 6 else "dim"))
        W += [label("charge", RV, -23, 0.78 * R, "CHARGE", "wb_capb", 2, w=130),
              label("power", RV, 25, 0.78 * R, "POWER", "wb_capb", 2, w=130),
              label("effdyn", RV, 0, 0.47 * R, "EfficientDynamics", "wb_cap", 2, w=240, color="accent"),
              icon("range_icon", "fuel", SP[0] - 70, SP[1] + 0.72 * R, 1, "fg"),
              text("range_in", SP[0] + 12, SP[1] + 0.72 * R, 130, "{{range}} km", "wb_cap", conn=1)]
    W += [text("speed_unit", SP[0], SP[1] - 0.34 * R, 100, "km/h", "wb_cap", conn=1),
          text("mode", RV[0], RV[1] + 0.42 * R, 240, "{{mode}}", "wb_capb", "accent" if sport else "fg", conn=2)]
    for i, (head, tok, x) in enumerate([("Time", "{{time}}", 729), ("Range", "{{range}} km", 868), ("Temp", "{{ambient}} °C", 1054)]):
        W += [text("row_h%d" % i, x, 652, 150, head, "wb_cap", "dim", align="left"),
              text("row_v%d" % i, x, 688, 160, tok, "wb_val", align="left")]
    return W

out = sys.argv[1]
def with_map(W):
    """Comfort with BMW's map window always see-through (the "stockMap" setting does it in wb_comfort)."""
    for w in W:
        if w["id"] == "bg":
            w["holeWhen"] = True
    return W

for name, mode, title in (("comfort", "comfort", "6WB Comfort"), ("comfort_map", "comfort", "6WB Comfort + BMW map"),
                          ("dials", "comfort", "6WB Dials + G20"),
                          ("sport", "sport", "6WB Sport"), ("eco", "eco", "6WB Eco Pro")):
    globals().update(G20 if mode == "comfort" else OLD)
    W = dials() if name == "dials" else comfort() if mode == "comfort" else glowing(mode)
    if name == "comfort_map":
        W = with_map(W)
    lay = {"schemaVersion": 2, "name": title, "packWaste": 8, "theme": "wb_" + mode,
           "_about": "6WB-style cluster (%s), generated by design/gen_6wb.py: edit that and regenerate." % title,
           "widgets": W}
    json.dump(lay, open(os.path.join(out, "wb_%s.json" % name), "w"), indent=2, ensure_ascii=False)
