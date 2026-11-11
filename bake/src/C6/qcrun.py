"""P4: QC every C5 / C6 layer alone and in the composed stack, then write bake/manifest/C5.json and C6.json.
Called by `$PY -m C6.build --all`."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import qc  # noqa: E402
from C6 import build as c6  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
WORK = os.path.join(ROOT, "bake", "work")
BAKED = os.path.join(ROOT, "apps", "f30_cluster", "hud", "baked")
REF17 = os.path.join(WORK, "C5", "ref", "17_physical-cluster_full.ours.C5")
REF04 = os.path.join(WORK, "C5", "ref", "04_comfort_whole-cluster_mph.ours.C5")
REF07 = os.path.join(WORK, "C5", "ref", "07_physical-cluster_all-lamps-lit.ours.C5")
RECT = os.path.join(WORK, "rect")


def L(entry):
    return (os.path.join(BAKED, entry["file"]), entry["x"], entry["y"], entry["scale"])


def fitof(res):
    f = dict(res["fit"]); f["ref"] = res["ref"]; f["roi"] = res["roi"]; f["sheet"] = res.get("sheet")
    f["luma_bias"] = res["metrics"].get("luma_bias")
    return f


def face_underlay(ref_base, box, lit):
    """The arcs sit on the dial face (P1 / P2's layers). For QC only, put a flat face colour under them: the median
    reference colour in the arc box where our segments are absent (not shipped)."""
    import numpy as np
    ref = qc.load_ref(ref_base, 15)
    bx, by, bw, bh = ref["box"]
    x0, y0 = box[0] - bx, box[1] - by
    h, w = lit.shape[:2]
    sub = ref["rgb"][y0:y0 + h, x0:x0 + w]
    sel = (lit[..., 3] < 0.02) & ref["valid"][y0:y0 + h, x0:x0 + w]
    col = np.median(sub[sel], 0)
    img = np.zeros((h, w, 4), np.float32); img[..., :3] = col; img[..., 3] = 1.0
    return (img, box[0], box[1], 1.0)


def main():
    c5 = json.load(open(os.path.join(WORK, "C5", "layers.json")))
    c6l = json.load(open(os.path.join(WORK, "C6", "layers.json")))
    base, hor = c5["window.base"], c5["window.horizon"]
    body, line = c6l["infobar.body"], c6l["infobar.line"]
    Q = {}
    run = lambda ref, lays, cl, name, rois, edges=True, bits=31: qc.run(ref, lays, cl, name, rois, None, bits, edges)
    Q["window.base"] = run(REF17, [L(base)], "C5", "window.base", ["box:780:90:360:450"], False)
    Q["window.bg"] = run(REF17, [L(base)], "C5", "window.bg", ["box:780:100:360:290"], False)
    Q["window.top"] = run(REF17, [L(base)], "C5", "window.top", ["box:800:66:320:40"], True)
    Q["window.sky"] = run(REF17, [L(base), L(hor)], "C5", "window.sky", ["box:780:400:360:56"], False)
    Q["window.floor"] = run(REF17, [L(base), L(hor)], "C5", "window.floor", ["box:740:462:440:144"], False)
    Q["window.horizon"] = run(REF17, [L(base), L(hor)], "C5", "window.horizon", ["box:780:446:360:22"], True)
    stack = [L(base), L(hor), L(body), L(line)]
    Q["infobar.line"] = run(REF17, stack, "C5", "infobar.line", ["box:760:598:400:16"], True)
    Q["infobar.body"] = run(REF17, stack, "C5", "infobar.body", ["box:700:612:520:76"], False)
    Q["stack17"] = run(REF17, stack, "C5", "stack", ["box:680:66:560:626"], True)
    Q["stack04"] = run(REF04, stack, "C5", "stack", ["box:680:66:560:626"], True)
    Q["stack07"] = run(REF07, stack, "C5", "stack", ["box:680:66:560:626"], True)
    # arcs: the track alone (unlit, vs nothing lit = no ref) and a full-fill preview (track + lit minors) vs 17 / 07
    for name, A in c6.ARCS.items():
        cl = A["dial"]
        tr, mk = c6l[f"{name}.track"], c6l[f"{name}.segments"]
        lit, _, box = c6.arc_layers(name, A, state="lit")
        lit_l = (lit, box[0], box[1], 1.0)
        a0 = A["a0"] - 2; span = A["a1"] - A["a0"] + 4
        for ref in ("17_physical-cluster_full", "07_physical-cluster_all-lamps-lit"):
            if cl == "C2" and ref.startswith("07"):
                continue                     # 07 C2 alignment is poor (P0)
            rb = os.path.join(RECT, f"{ref}.comfort.{cl}")
            under = face_underlay(rb, box, lit)
            res = qc.run(rb, [under, lit_l], cl, f"{name}.full", ["ring:0.82:0.915"],
                         f"{a0}:{span}", 15, True, out_dir=os.path.join(WORK, "C6"))
            Q[f"{name}.full.{ref[:2]}"] = res
    out = {k: fitof(v) for k, v in Q.items()}
    json.dump(out, open(os.path.join(WORK, "C6", "qc_all.json"), "w"), indent=1)
    for k, v in out.items():
        print(f"{k:28s} ssim {v['ssim']}  dE {v['dE2000_mean']}  edge {v['edge_px_err']}  bias {v['luma_bias']}")
    from C6 import manifests
    manifests.write(c5, c6l, out)


if __name__ == "__main__":
    main()
