#!/usr/bin/env python3
"""Generates the three 6WB-style layouts (our own drawing, traced by eye off photos of BMW's F-series
multifunctional display; no BMW artwork is used):
    python3 design/gen_6wb.py apps/f30_cluster/hud/layouts
Writes wb_comfort.json, wb_sport.json, wb_eco.json. Edit this file, not the JSON.

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
# (see shared/visible.js): bigger dials, the rev dial centred on BMW's black box so the box hides only the hub, and BMW's
# own gear letter (always drawn, bottom right) sits in a gear box we draw under it.
OLD = dict(R=290, SP=(496, 360), RV=(1424, 360), MINI_R=90, FU=(103, 473), OT=(1817, 473))
G20 = dict(R=335, SP=(412, 380), RV=(1508, 380), MINI_R=70, FU=(80, 628), OT=(1840, 628))
globals().update(OLD)
MID = 960
SPD_START, SPD_SWEEP = 230, 260
RPM_START, RPM_PER = 250.5, 32.1          # degrees; per 1000 rpm
RPM_MAX = 7500
RPM_SWEEP = RPM_PER * RPM_MAX / 1000.0
RPM_OFF = 20.5                # degrees before 0 where the needle parks (OFF)
SIGN = (960, 185, 62)         # the speed limit sign: centre x, y and radius, in the middle window
GEARBOX = (1410, 686, 170, 58)  # centre x, y, w, h: under BMW's gear letter (x 1392-1428, y 664-706)

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

def minis():
    """The two side gauges: fuel (0 low on the right, clockwise round the bottom to 1/1 upper left) and its mirror,
    the oil temperature (cold low on the left, anticlockwise to hot upper right)."""
    return [
        dial("fuel", FU, "mini", r=MINI_R, ringW=5, measure="signal", signal="fuel", scale={"max": 1, "ticks": 4}, minor=2,
             start=135, sweep=185, redTo=0.10, needle="fg"),
        dial("oilt", OT, "mini", r=MINI_R, ringW=5, measure="signal", signal="oil", min=50, scale={"max": 150, "ticks": 4},
             minor=2, start=135, sweep=185, flip=True, coldTo=0.10, redFrom=0.90, needle="fg"),
        icon("fuel_icon", "fuel", FU[0] + 0.40 * MINI_R, FU[1] - 0.42 * MINI_R, 1, "fg"),
        text("fuel_full", FU[0] - 0.42 * MINI_R, FU[1] - 0.26 * MINI_R, 30, "1/1", "wb_mini", conn=1),
        text("fuel_zero", FU[0] + 0.42 * MINI_R, FU[1] + 0.40 * MINI_R, 14, "0", "wb_mini", conn=1),
        icon("oil_icon", "oilcan", OT[0] - 0.40 * MINI_R, OT[1] - 0.42 * MINI_R, 2, "fg", w=30),
    ]

def comfort():
    W = [
        {"id": "bg", "type": "wbback", "class": "content", "z": 0, "x": 0, "y": 0, "w": 1920, "h": 720,
         "dl": [SP[0], SP[1], R], "dr": [RV[0], RV[1], R], "style": "comfort", "color": "accent",
         "sign": list(SIGN)},
        dial("speedo", SP, "comfort", ringW=10, measure="speed", kmh=True, scale={"max": 260, "ticks": 13}, minor=10,
             start=SPD_START, sweep=SPD_SWEEP),
        dial("tacho", RV, "comfort", ringW=10, measure="rpm", scale={"max": RPM_MAX, "ticks": RPM_MAX / 1000.0}, minor=10,
             start=RPM_START, sweep=RPM_SWEEP, off=RPM_OFF),
    ] + minis()
    # the scale numbers: the box ends at 0.78 R, inside the ticks' inner ends (0.82 R)
    for i in range(14):
        n = 20 * i
        W.append(ring_label("spd%d" % i, SP, SPD_START + n, 0.78 * R, str(n), "wb_spd", 20.6, 1))
    for i in range(1, 8):
        W.append(ring_label("rpm%d" % i, RV, RPM_START + RPM_PER * i, 0.78 * R, str(i), "wb_rpm", 31.2, 2, w=50))
    W += [
        text("speed_unit", SP[0], SP[1] - 0.40 * R, 100, "km/h", "wb_cap", conn=1),
        text("rpm_cap", RV[0], RV[1] - 0.40 * R, 200, "1/min x 1000", "wb_cap", conn=2),
        text("ready", RV[0] - 0.63 * R, RV[1] + 0.25 * R, 110, "READY", "wb_capb", conn=2),
        text("off", RV[0] - 0.575 * R, RV[1] + 0.465 * R, 70, "OFF", "wb_cap", "dim", conn=2),
        {"id": "gearbox", "type": "wbgear", "class": "content", "z": 3, "x": GEARBOX[0] - GEARBOX[2] // 2, "y": GEARBOX[1] - GEARBOX[3] // 2,
         "w": GEARBOX[2], "h": GEARBOX[3], "conn": 2},
        # the range at the speed dial's foot
        icon("range_icon", "fuel", SP[0] - 70, SP[1] + 0.60 * R, 1, "fg"),
        text("range_in", SP[0] + 12, SP[1] + 0.60 * R, 130, "{{range}} km", "wb_cap", conn=1),
    ]
    # the speed limit: the figure on the backdrop's sign (both hide when the car gives no limit)
    W.append(text("limit", SIGN[0], SIGN[1], 96, "{{limit}}", "wb_gear", "ink", conn=2))   # conn 2: the first connection is at 7 of its 8 layers
    # the row at the middle window's foot
    for i, (head, tok, x) in enumerate([("Time", "{{time}}", 742), ("Range", "{{range}} km", 890), ("Temp", "{{ambient}} °C", 1048)]):
        W += [text("row_h%d" % i, x, 612, 150, head, "wb_cap", "dim", align="left"),
              text("row_v%d" % i, x, 650, 160, tok, "wb_val", align="left")]
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
              text("gear_big", RV[0], RV[1] + 0.02 * R, 200, "{{gearnum}}", "wb_big", conn=2, hotWhen="now"),
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
          text("mode", RV[0], RV[1] + 0.42 * R, 240, "{{mode}}", "wb_capb", "accent" if sport else "fg", conn=2),
          text("gear", RV[0], RV[1] + 0.60 * R, 120, "{{gear}}", "wb_gear", conn=2)]
    for i, (head, tok, x) in enumerate([("Time", "{{time}}", 729), ("Range", "{{range}} km", 868), ("Temp", "{{ambient}} °C", 1054)]):
        W += [text("row_h%d" % i, x, 652, 150, head, "wb_cap", "dim", align="left"),
              text("row_v%d" % i, x, 688, 160, tok, "wb_val", align="left")]
    return W

out = sys.argv[1]
for mode, title in (("comfort", "6WB Comfort"), ("sport", "6WB Sport"), ("eco", "6WB Eco Pro")):
    globals().update(G20 if mode == "comfort" else OLD)
    lay = {"schemaVersion": 2, "name": title, "packWaste": 8, "theme": "wb_" + mode,
           "_about": "6WB-style cluster (%s), generated by design/gen_6wb.py: edit that and regenerate." % title,
           "widgets": comfort() if mode == "comfort" else glowing(mode)}
    json.dump(lay, open(os.path.join(out, "wb_%s.json" % mode), "w"), indent=2, ensure_ascii=False)
