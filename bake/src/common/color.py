"""Colour maths in numpy: sRGB <-> linear <-> XYZ (D65) <-> CIELAB, CIEDE2000, luminance."""
import numpy as np


def srgb_to_linear(c):
    """c: float array in 0..1."""
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


_M = np.array([[0.4124564, 0.3575761, 0.1804375],
               [0.2126729, 0.7151522, 0.0721750],
               [0.0193339, 0.1191920, 0.9503041]])
_WHITE = np.array([0.95047, 1.0, 1.08883])


def rgb8_to_lab(rgb):
    """rgb: (..., 3) uint8 or float 0..255 sRGB -> (..., 3) CIELAB (D65)."""
    lin = srgb_to_linear(np.asarray(rgb, dtype=np.float64) / 255.0)
    xyz = lin @ _M.T / _WHITE
    e = 216.0 / 24389.0
    k = 24389.0 / 27.0
    f = np.where(xyz > e, np.cbrt(xyz), (k * xyz + 16.0) / 116.0)
    L = 116.0 * f[..., 1] - 16.0
    a = 500.0 * (f[..., 0] - f[..., 1])
    b = 200.0 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def luma8(rgb):
    """Rec.709 luma on sRGB code values (0..255 float), for SSIM / edges."""
    rgb = np.asarray(rgb, dtype=np.float64)
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def delta_e2000(lab1, lab2, kL=1.0, kC=1.0, kH=1.0):
    """CIEDE2000 (Sharma, Wu, Dalal 2005), vectorised. lab1, lab2: (..., 3)."""
    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    C1 = np.hypot(a1, b1)
    C2 = np.hypot(a2, b2)
    Cm = 0.5 * (C1 + C2)
    G = 0.5 * (1.0 - np.sqrt(Cm ** 7 / (Cm ** 7 + 25.0 ** 7)))
    a1p, a2p = (1.0 + G) * a1, (1.0 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360.0
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360.0
    h1p = np.where((a1p == 0) & (b1 == 0), 0.0, h1p)
    h2p = np.where((a2p == 0) & (b2 == 0), 0.0, h2p)
    dLp = L2 - L1
    dCp = C2p - C1p
    dh = h2p - h1p
    dh = np.where(dh > 180.0, dh - 360.0, np.where(dh < -180.0, dh + 360.0, dh))
    dh = np.where(C1p * C2p == 0, 0.0, dh)
    dHp = 2.0 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh) / 2.0)
    Lpm = 0.5 * (L1 + L2)
    Cpm = 0.5 * (C1p + C2p)
    hs = h1p + h2p
    hpm = np.where(np.abs(h1p - h2p) <= 180.0, hs / 2.0, np.where(hs < 360.0, (hs + 360.0) / 2.0, (hs - 360.0) / 2.0))
    hpm = np.where(C1p * C2p == 0, hs, hpm)
    T = (1.0 - 0.17 * np.cos(np.radians(hpm - 30.0)) + 0.24 * np.cos(np.radians(2.0 * hpm))
         + 0.32 * np.cos(np.radians(3.0 * hpm + 6.0)) - 0.20 * np.cos(np.radians(4.0 * hpm - 63.0)))
    dtheta = 30.0 * np.exp(-(((hpm - 275.0) / 25.0) ** 2))
    Rc = 2.0 * np.sqrt(Cpm ** 7 / (Cpm ** 7 + 25.0 ** 7))
    Sl = 1.0 + 0.015 * (Lpm - 50.0) ** 2 / np.sqrt(20.0 + (Lpm - 50.0) ** 2)
    Sc = 1.0 + 0.045 * Cpm
    Sh = 1.0 + 0.015 * Cpm * T
    Rt = -np.sin(np.radians(2.0 * dtheta)) * Rc
    return np.sqrt((dLp / (kL * Sl)) ** 2 + (dCp / (kC * Sc)) ** 2 + (dHp / (kH * Sh)) ** 2
                   + Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh)))


def _selftest():
    # Sharma et al. test pairs (first few) -> expected dE00
    pairs = [((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485), 2.0425),
             ((50.0, 3.1571, -77.2803), (50.0, 0.0, -82.7485), 2.8615),
             ((50.0, -1.3802, -84.2814), (50.0, 0.0, -82.7485), 1.0000),
             ((50.0, 2.5, 0.0), (50.0, 0.0, -2.5), 4.3065),
             ((50.0, 2.5, 0.0), (73.0, 25.0, -18.0), 27.1492),
             ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644),
             ((22.7233, 20.0904, -46.6940), (23.0331, 14.9730, -42.5619), 2.0373),
             ((2.0776, 0.0795, -1.1350), (0.9033, -0.0636, -0.5514), 0.9082)]
    a = np.array([p[0] for p in pairs])
    b = np.array([p[1] for p in pairs])
    got = delta_e2000(a, b)
    exp = np.array([p[2] for p in pairs])
    assert np.allclose(got, exp, atol=1e-3), (got, exp)
    return float(np.max(np.abs(got - exp)))


if __name__ == "__main__":
    print("dE2000 self-test max abs error:", _selftest())
