"""The procedural model of the stock dials' soft surfaces, shared by the fit (fit_soft.py) and the renderer.

Per dial (computed in *speedo space*: tacho pixels are mirrored about the measured axis, so one set of curves
serves both dials; the tables are still fitted per dial):
  sB, dB  arclength along the band curve and signed distance (dB > 0 = outside the wing, towards the frame)
  sE, dE  arclength along the inner edge E and signed distance (dE > 0 = wing side)
  wing    coverage of the polygon between the band and E (the opaque grey "wing" face)
  inside  coverage of the frame polygon (the dial interior)
Tables (numbers fitted to a photo, see fit_soft.py):
  glow[dial]   RGB(sB, dB) added (canvas 'lighter') over the background between the band and the frame
  wing[dial]   RGB(sB, -dB) of the wing face, and wingE[dial] RGB(sE, dE) near E (bevel), blended
"""
import numpy as np

import lib

BOX = {"speedo": (60, 25, 712, 664), "tacho": (1207, 25, 1860, 664)}   # x0, y0, x1, y1 (panel px, exclusive)

GLOW_D = np.r_[np.arange(-3, 6, 0.5), np.arange(6, 20, 1.0), np.arange(20, 72.01, 2.0)]
WING_D = np.r_[np.arange(0, 6, 0.5), np.arange(6, 20, 1.0), np.arange(20, 62, 3.0), np.arange(62, 262.01, 8.0)]
WINGE_D = np.arange(-4, 16.01, 0.5)
S_STEP = 8.0
E_BLEND = (11.0, 15.0)        # distE where the E table hands over to the band table


def geometry():
    return lib.read_json(lib.os.path.join(lib.PARAMS, "geometry.json"))


def curves(geo):
    return (np.array(geo["speedo_band"], float), np.array(geo["speedo_E"], float),
            np.array(geo["speedo_frame"], float))


def wing_poly(band, E):
    """Band from the point nearest E's strip-end start, then E reversed back to it: a closed polygon."""
    k = int(np.argmin(np.linalg.norm(band - E[0], axis=1)))
    return np.vstack([band[k:], E[::-1]])


def s_edges(curve):
    L = lib.arclen(curve)[-1]
    return np.arange(0, L + S_STEP, S_STEP)


class Dial:
    """Per-dial pixel grid (panel box at `scale` samples per px) with the speedo-space coordinates."""

    def __init__(self, geo, dial, scale=1):
        self.dial, self.scale = dial, scale
        a = self.axis = geo["mirror_axis_x"]
        x0, y0, x1, y1 = BOX[dial]
        self.box = (x0, y0, x1, y1)
        h, w = (y1 - y0) * scale, (x1 - x0) * scale
        self.shape = (h, w)
        ys, xs = np.mgrid[0:h, 0:w]
        self.X = x0 + (xs + 0.5) / scale
        self.Y = y0 + (ys + 0.5) / scale
        self.Xs = 2 * a - self.X if dial == "tacho" else self.X
        band, E, frame = curves(geo)
        self.band, self.E, self.frame = band, E, frame
        self.sB, self.dB, self.distB = lib.curve_coords(band, self.Xs, self.Y)
        self.sE, self.dE, self.distE = lib.curve_coords(E, self.Xs, self.Y)
        self.sF, self.dF, self.distF = lib.curve_coords(frame, self.Xs, self.Y)
        self.wing = self.cover([wing_poly(band, E)])
        self.inside = self.cover([frame])
        # orientation fixes (signs follow the curves' travel direction; normalise them)
        if np.median(self.dB[(self.wing > 0.99) & (self.distB < 20)]) > 0:
            self.dB = -self.dB      # now dB > 0 outside the wing
        if np.median(self.dE[(self.wing > 0.99) & (self.distE < 20)]) < 0:
            self.dE = -self.dE      # dE > 0 inside the wing

    def cover(self, polys):
        x0, y0, x1, y1 = self.box
        if self.dial == "tacho":
            return lib.poly_cov(self.shape, polys, ox=2 * self.axis - x1, oy=y0, scale=self.scale)[:, ::-1]
        return lib.poly_cov(self.shape, polys, ox=x0, oy=y0, scale=self.scale)
