#!/usr/bin/env python3
"""Generates the diagnostic matte layouts (package D of docs/AGENT-BRIEF-strip.md):
    python3 design/gen_matte.py apps/f30_cluster/hud/layouts
Writes matte_magenta.json, matte_green.json, matte_black.json. Edit this file, not the JSON.

What it is for. The whole panel is ONE flat, opaque colour, so every BMW pixel on a photo of it is something BMW
draws OVER a theme (catalogue relation "over"); everything BMW draws under a theme is hidden. One photo per car
state settles which stock items are over and which are under (the catalogue's `unknown` ones,
design/overlay/g20_comfort.json) and photographs BMW's over-items with nothing of ours round them.
The shot list is in docs/OVERLAY-PHOTO-PROTOCOL.md section 5.

Why three colours. Each separates a different kind of BMW ink from the matte:
    magenta (255, 0, 255)   green, amber and white telltales, white text, and BMW's black pads (a dark box under an
                            over-item shows as black on magenta);
    green   (0, 255, 0)     the red telltales (brake, (P), belts, airbag), which on magenta differ in blue only;
    black   (0, 0, 0)       the look of a real theme: BMW's glows and halos as they fall on our black, and nothing
                            of ours lit (the camera's exposure is set by BMW's ink alone).
The colours are literal RGBA, so neither the night colours (hud.js _nightTheme dims theme roles only) nor the
theme of the day change them.

What is drawn, and nothing else (no text but the ruler's numbers, no dials, no signals):
    matte       fill   the whole panel 1920 x 720, opaque                         1 effect layer, no texture
    ruler_top   grid   along the top of the STRIP, y 540-552, the whole width     1 effect layer, no texture
    ruler_bot   grid   along the panel's bottom edge, y 708-720, the whole width  1 effect layer, no texture
    ruler_lab   gridlabels  "x/y" every 100 px under ruler_top, y 552-569         1 image sheet 1900 x 17
Four layers on the app's one connection (the cap is 8); pixel memory only the label sheet: 1900 * 17 * 4 bytes,
counted twice = 0.25 MiB of 16. No sampler2D, so nothing for RAMSES to skip. The two shaders (FILL and GRID,
shared/shaders.js) are the ones the calibration grid and the map calibration already ran on the car.

The ruler. GRID draws, in the widget's own px, a 1 px tick wherever x mod step is 0 (a pixel whose centre is
within 1 px past it), a 2 px tick where x mod (step * major) is 0 or 1, and a 2 px frame round the widget.
With step 10 and major 10 that is, in panel px (continuous coordinates, half-open):
    minor tick   [10k, 10k + 1)  for every k              white  (255, 255, 255)
    major tick   [100k, 100k + 2) for every k             yellow (255, 230, 0)
    frame        rows y0, y0 + 1 and y0 + h - 2, y0 + h - 1, columns 0, 1 and 1918, 1919: yellow
so the left edge of every tick is exactly on a multiple of 10. The labels (yellow, font wb_mini, 15 px cell) stand
2 px right of and 2 px below each major tick's foot: the label "300/552" starts at (302, 554). The bands' frame lines
give y 540, 541, 550, 551 and 708, 709, 718, 719; the panel's own edges (bottom and both sides are clear of the hood,
shared/visible.js) frame the rest. The grid's colours come from the layout ("minorColor", "majorColor", hud.js);
without them the calibration grid keeps its own.

Where the ruler is placed, and why there: above the bottom row's items (in the catalogue the highest item of the
STRIP is the rpm label at y 573, the highest over or unknown one assist.off at y 580; the sign's ring top is about
579) and along the panel's bottom edge, where only the belt group (catalogue boxes to y 715) can land on it: the
driver's belt is drawn over a theme, so it must cover the ticks there (a control), and the rear belts and the
airbag, still unknown, will either do the same or not show at all.
"""
import json, os, sys

W, H = 1920, 720                   # the panel
STRIP_Y = 540                      # the STRIP: y 540-720 (brief section 4.1)
BAND = 12                          # each ruler band's height
LAB_FONT, LAB_H = 'wb_mini', 17    # '/0123456789', 15 px cell; gridlabels draws min(h - 2, cell) high, 2 px down
LAB_W = 1900                       # labels at x 0..1800 only: "1900/552" would be cut at the panel's edge
MINOR = [255, 255, 255, 255]       # opaque: the composite stays two exact colours, no blend with the matte
MAJOR = [255, 230, 0, 255]         # the yellow of gridlabels' numbers (hud.js _paintGridLabels)

MATTES = (
    ('magenta', 'Diagnostic matte: magenta', [255, 0, 255, 255]),
    ('green', 'Diagnostic matte: green', [0, 255, 0, 255]),
    ('black', 'Diagnostic matte: black', [0, 0, 0, 255]),
)


def ruler(wid, y):
    return {"id": wid, "type": "grid", "z": 0, "x": 0, "y": y, "w": W, "h": BAND, "step": 10, "major": 10,
            "minorColor": MINOR, "majorColor": MAJOR}


def layout(title, rgba):
    return {
        "schemaVersion": 2,
        "name": title,
        # no colour here comes from a theme (all literal); a theme of its own only so the status line reads
        # "Diagnostic matte: magenta theme" and not "... layout, undefined theme" (the retired hudTheme setting)
        "theme": "classic",
        "_about": "Diagnostic matte, generated by design/gen_matte.py: edit that and regenerate. The whole panel one "
                  "opaque colour, so whatever of BMW's shows is drawn OVER a theme; a pixel ruler along the STRIP "
                  "(ticks every 10 px, yellow and labelled every 100 px) at y 540-552 and 708-720. Shot list: "
                  "docs/OVERLAY-PHOTO-PROTOCOL.md section 5. Turn 'Change with the drive mode' off to show it.",
        "widgets": [
            {"id": "matte", "type": "fill", "z": -10, "x": 0, "y": 0, "w": W, "h": H, "color": rgba},
            ruler("ruler_top", STRIP_Y),
            ruler("ruler_bot", H - BAND),
            {"id": "ruler_lab", "type": "gridlabels", "z": 5, "x": 0, "y": STRIP_Y + BAND, "w": LAB_W, "h": LAB_H,
             "step": 100, "font": LAB_FONT},
        ],
    }


def main(out):
    for key, title, rgba in MATTES:
        with open(os.path.join(out, "matte_%s.json" % key), "w") as f:
            json.dump(layout(title, rgba), f, indent=2, ensure_ascii=False)
            f.write("\n")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python3 design/gen_matte.py apps/f30_cluster/hud/layouts")
    main(sys.argv[1])
