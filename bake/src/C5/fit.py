"""C5 redo: fit the window model (C5/model.py) to the 04 and 03 middles in FINAL PANEL VALUES (C5.target: light
above each photo's own local LCD floor, relative to its white numerals, re-encoded with the numerals at the theme's
text white). 04 is weighted 0.6, 03 0.4; 03 alone gives the front line (04 has no bar content). 02 (the clean
render, a different car-scene floor), 06, 07 and 17 are only measured for the report (spread).

Writes bake/src/C5/params.json (the generator's input) and bake/work/C5/redo/fit.json.
    cd bake/src && UV_CACHE_DIR=../work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \\
        --with pillow --with scipy python -m C5.fit
"""
import json, os, sys
import numpy as np
from scipy.optimize import least_squares

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from C5 import model, target  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "bake", "work", "C5", "redo")
LUMA = model.LUMA
REFS = {"04_comfort_whole-cluster_mph": 0.6, "03_three-modes_photo_bimmerstop": 0.4}

P0 = {
    # outline (unchanged: our box x 720..1200 at y 79, 45 deg chamfers, clip r 1.04 R)
    "top_y": 79.0, "top_half_w": 240.0, "corner_r": 10.0, "dial_clip_R": 1.04, "dial_clip_soft": 3.0,
    # horizon / glow
    "horizon_y": 458.0, "horizon_w": 2.5, "glow_y0": 404.0, "glow_p": 2.0, "glow_a": 0.028,
    "lip_a": 0.12, "lip_d": 2.0, "lip_s": 1.2,
    # rows
    "front_y": 608.8, "row_n": 5, "row_yv": 300.0, "row_u0": 0.00585, "row_du": 0.000533,
    "row_amp0": 0.004, "row_amp1": 0.012, "row_amp2": 0.05, "row_amp3": 0.17, "row_amp4": 0.35, "row_rise": 1.0, "row_edge_d": 2.0, "row_body": 0.5, "row_body_d": 1.0,
    "row_gap": 1.5, "row_gap_s": 3.0, "row_h0": 13.5, "row_h1": 130.0, "row_hp": 2.5,
    # walls
    "wall_y0": 505.0, "wall_in": 15.0, "wall_out": 15.0, "wall_x0": 172.0, "wall_x1": 1.1, "wall_a": 0.03,
    "wall_ag": 9.0, "wall_s0": 15.0, "wall_s1": 10.0,
    # front line + bar
    "line_a": 0.48, "line_s": 1.4, "line_h": 190.0, "line_hp": 2.5, "line_floor": 0.08,
    "bar_fade0": 672.0, "bar_fade1": 690.0,
    # hues (linear RGB, luma-normalised by the model): measured below
    "hue_glow": [0.85, 1.0, 1.1], "hue_rows": [0.72, 1.0, 1.06], "hue_walls": [0.72, 1.0, 1.06], "hue_line": [0.9, 1.0, 1.05],
}
GLOW_FREE = ["glow_y0", "glow_p", "glow_a", "lip_a", "lip_d", "lip_s"]
ROWY_FREE = ["row_yv", "row_u0", "row_du", "row_amp0", "row_amp1", "row_amp2", "row_amp3", "row_amp4", "row_rise", "row_edge_d", "row_body", "row_body_d",
             "row_gap", "row_gap_s"]
LAT_FREE = ["row_h0", "row_h1", "row_hp",
            "wall_y0", "wall_in", "wall_out", "wall_x0", "wall_x1", "wall_a", "wall_ag", "wall_s0", "wall_s1"]
FLOOR_FREE = ROWY_FREE + LAT_FREE
LINE_FREE = ["line_a", "line_s", "line_h", "line_hp", "line_floor"]
BOUNDS = {"row_hp": (1.5, 6.0), "row_rise": (0.4, 3.0), "row_edge_d": (0.5, 6.0), "row_body": (0.1, 1.0), "row_amp0": (0.0, 1.0), "row_amp1": (0.0, 1.0),
          "row_body_d": (0.2, 5.0), "row_gap": (0.0, 4.0), "row_h1": (0.0, 400.0), "row_h0": (5.0, 200.0), "row_gap_s": (0.5, 8.0), "wall_s0": (5.0, 40.0),
          "wall_in": (2.0, 60.0), "wall_out": (1.0, 60.0), "lip_s": (0.5, 3.0), "lip_d": (0.0, 5.0), "lip_a": (0.0, 1.0),
          "line_s": (0.6, 3.0), "line_floor": (0.0, 0.6), "line_hp": (1.0, 6.0), "glow_p": (0.5, 5.0)}


def code_luma(rgb_code):
    """sRGB code 0..255 (..., 3) -> the code of its linear luma (0..255)."""
    return 255.0 * model.l2s(model.s2l(rgb_code / 255.0) @ LUMA)


def load(stem):
    r = target.build(stem, write=True)
    valid = (r["bits"] & 0x1F) == 0
    return r["X"], r["Y"], r["panel"], valid


def hue_of(rgb_code, m):
    lin = model.s2l(rgb_code[m] / 255.0)
    w = lin @ LUMA
    v = lin.sum(0) / w.sum()
    return (v / (v @ LUMA)).round(4).tolist()


def solve(res, P, free, loss="soft_l1", f=8.0):
    lo = [BOUNDS.get(k, (-np.inf, np.inf))[0] for k in free]
    hi = [BOUNDS.get(k, (-np.inf, np.inf))[1] for k in free]
    v0 = [min(max(P[k], l + 1e-9), h - 1e-9) for k, l, h in zip(free, lo, hi)]
    r = least_squares(lambda v: res(dict(P, **dict(zip(free, v)))), v0, bounds=(lo, hi), loss=loss, f_scale=f,
                      max_nfev=3000, x_scale="jac")
    P.update({k: round(float(v), 6) for k, v in zip(free, r.x)})
    rr = res(P)
    return float(np.sqrt(np.mean(rr ** 2)))


def main():
    P = dict(P0)
    D = {s: load(s) for s in REFS}
    rep = {}

    # 1. hues (luma-weighted mean linear colour of each part, 04 + 03)
    def hm(sel):
        acc = []
        for s, (X, Y, im, v) in D.items():
            acc.append(np.array(hue_of(im, sel(X, Y, im) & v)) * REFS[s])
        h = np.sum(acc, 0) / sum(REFS.values())
        return (h / (h @ LUMA)).round(4).tolist()
    ax = lambda X: np.abs(X - 960)
    P["hue_glow"] = hm(lambda X, Y, im: (Y > 438) & (Y < 456) & (ax(X) < 160))
    P["hue_rows"] = hm(lambda X, Y, im: (Y > 470) & (Y < 606) & (ax(X) < 90) & (code_luma(im) > 25))
    P["hue_walls"] = hm(lambda X, Y, im: (Y > 520) & (Y < 600) & (ax(X) > 190) & (ax(X) < 280) & (code_luma(im) > 40))
    l03 = D["03_three-modes_photo_bimmerstop"]
    P["hue_line"] = hue_of(l03[2], (np.abs(l03[1] - 609) < 1.6) & (ax(l03[0]) < 120) & l03[3])

    # 2. glow: rows 390..457, |X| < 160
    def glow_res(Q):
        out = []
        for s, (X, Y, im, v) in D.items():
            m = v & (Y > 390) & (Y < 457.5) & (ax(X) < 160)
            ym = model.glow_Y(Y[m], Q)
            out.append((255 * model.l2s(ym) - code_luma(im[m])) * np.sqrt(REFS[s]))
        return np.concatenate(out)
    rep["glow_rms_code"] = solve(glow_res, P, GLOW_FREE)

    # 3. floor (rows + walls): y horizon+3 .. front-3, |X| < 285, every 2nd px
    def floor_sel(X, Y, v):
        m = v & (Y > P["horizon_y"] + 3) & (Y < P["front_y"] - 3) & (ax(X) < 285)
        m[::2] = False; m[:, ::2] = False
        return m
    # 3a. the rows' y structure on the centre profile (|X| < 30: the walls are far), full rows
    CS = {s: v & (Y > P["horizon_y"] + 3) & (Y < P["front_y"] - 3) & (ax(X) < 30) for s, (X, Y, im, v) in D.items()}
    CL = {s: code_luma(D[s][2][CS[s]]) for s in D}

    def centre_res(Q):
        out = []
        for s, (X, Y, im, v) in D.items():
            m = CS[s]
            out.append((255 * model.l2s(model.rows_Y(X[m] * 0 + 960.0, Y[m], Q)) - CL[s]) * np.sqrt(REFS[s]))
        return np.concatenate(out)
    rep["rows_centre_rms_code"] = solve(centre_res, P, ROWY_FREE, f=10.0)

    FS = {s: floor_sel(X, Y, v) for s, (X, Y, im, v) in D.items()}
    TL = {s: code_luma(D[s][2][FS[s]]) for s in D}

    def floor_res(Q):
        out = []
        for s, (X, Y, im, v) in D.items():
            m = FS[s]
            Yl = model.rows_Y(X[m], Y[m], Q) + model.walls_Y(X[m], Y[m], Q)
            out.append((255 * model.l2s(Yl) - TL[s]) * np.sqrt(REFS[s]))
        return np.concatenate(out)
    rep["floor_lateral_rms_code"] = solve(floor_res, P, LAT_FREE, f=10.0)
    rep["floor_rms_code"] = solve(floor_res, P, FLOOR_FREE, f=10.0) if os.environ.get("C5_FIT_ALL") else rep["floor_lateral_rms_code"]

    # 4. front line: 03 only, y 600..621, |X| < 280
    X, Y, im, v = l03
    m = v & (Y > 600) & (Y < 614) & (ax(X) < 280)

    def line_res(Q):
        base = model.rows_Y(X[m], Y[m], Q) + model.walls_Y(X[m], Y[m], Q)
        Ym = base * (Y[m] <= Q["front_y"] + 1.5) + model.line_Y(X[m], Y[m], Q)
        return 255 * model.l2s(Ym) - code_luma(im[m])
    rep["line_rms_code"] = solve(line_res, P, LINE_FREE, loss="linear")
    # the line's centre peak exactly at 03's (the shape fit trades it against the ends): scale line_a
    mc = v & (np.abs(Y - P["front_y"]) < 1.0) & (ax(X) < 40)
    tgt = float(np.median(code_luma(im[mc])))
    xs = np.full(int(mc.sum()), 960.0); yy = Y[mc]
    for _ in range(20):
        Ym = model.rows_Y(xs, yy, P) * (yy <= P["front_y"] + 1.5) + model.line_Y(xs, yy, P)
        got = float(np.median(255 * model.l2s(Ym)))
        P["line_a"] = round(P["line_a"] * (model.s2l(tgt / 255) / model.s2l(got / 255)) ** 0.8, 6)
    rep["line_centre_peak_code"] = {"03": round(tgt, 1), "model": round(got, 1)}

    P["row_n"] = int(P["row_n"])
    json.dump(P, open(os.path.join(HERE, "params.json"), "w"), indent=1)
    rep["row_ys"] = [round(v, 1) for v in model.row_ys(P)]
    os.makedirs(OUT, exist_ok=True)
    json.dump(rep, open(os.path.join(OUT, "fit.json"), "w"), indent=1)
    print(json.dumps(rep, indent=1))
    print({k: P[k] for k in GLOW_FREE + FLOOR_FREE + LINE_FREE})
    print({k: P[k] for k in P if k.startswith("hue_")})


if __name__ == "__main__":
    main()
