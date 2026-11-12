"""Write bench/g20/manifest.json for the bench's G20 simulation (bench only; docs/G20SIM-REPORT.md).

    python3 tools/g20sim/build_manifest.py

It merges the packages' parts (bench/g20/*/manifest.part.json: B structure, C icons/text, D live model) into one
list sorted by z, and adds `outline`: every element of design/overlay/g20_comfort.json as a polygon with its colour,
relation and evidence (the stub's drawing, and the ?g20dbg=outline overlay). Plain Python 3, no dependencies.
"""
import glob
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
G20 = os.path.join(ROOT, "bench", "g20")

# Lead's decisions where two packages overlap (see docs/G20SIM-REPORT.md "Assembly"):
#   - the tacho "0": C draws it live (it swaps with OFF), so B's baked copy is not drawn;
#   - the speedo's "0 km/h" scale label sits over the stock pointer in 08/09: drawn after D's gauges (z 58).
SKIP = {"structure.tacho_zero.night", "structure.tacho_zero.day"}
Z_OVERRIDE = {"structure.speedo_scale_label": 58}


def main():
    cat = json.load(open(os.path.join(ROOT, "design", "overlay", "g20_comfort.json"), encoding="utf-8"))
    outline = []
    for e in cat["elements"]:
        poly = e.get("poly")
        if not poly:
            x0, y0, x1, y1 = e["bbox"]
            poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
        outline.append({"id": e["id"], "group": e["group"], "name": e["name"], "relation": e["relation"],
                        "evidence": e.get("evidence"), "safety": e.get("safety"),
                        "rgb": (e.get("colour") or {}).get("rgb") or [200, 200, 200],
                        "poly": [[round(float(x), 1), round(float(y), 1)] for x, y in poly]})
    entries, parts = [], []
    for f in sorted(glob.glob(os.path.join(G20, "*", "manifest.part.json"))):
        part = json.load(open(f, encoding="utf-8"))
        parts.append({"package": part.get("package"), "file": os.path.relpath(f, G20), "entries": len(part.get("entries", []))})
        for en in part.get("entries", []):
            en = dict(en)
            en.setdefault("package", part.get("package"))
            if en.get("id") in SKIP or "%s.%s" % (en.get("id"), en.get("look")) in SKIP:
                en["skip"] = "drawn by another package (tools/g20sim/build_manifest.py SKIP)"
            base_id = en.get("id")
            if base_id in Z_OVERRIDE:
                en["z_package"] = en.get("z")
                en["z"] = Z_OVERRIDE[base_id]
            entries.append(en)
    entries.sort(key=lambda e: (e.get("z", 0), e.get("id", "")))
    total = 0
    for dp, _, fs in os.walk(G20):
        total += sum(os.path.getsize(os.path.join(dp, f)) for f in fs)
    out = {
        "$comment": "Bench-only simulation of BMW's stock G20 Comfort cluster: our own drawings fitted to car photos. "
                    "Written by tools/g20sim/build_manifest.py from the packages' manifest.part.json files; do not edit.",
        "kind": "g20sim-manifest", "panel": {"w": 1920, "h": 720}, "parts": parts,
        "bytes_on_disk_before_this_file": total, "entries": entries, "outline": outline,
    }
    with open(os.path.join(G20, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print("manifest: %d entries from %d parts, %d outline elements, bench/g20 %.2f MB" % (len(entries), len(parts), len(outline), total / 1e6))


if __name__ == "__main__":
    main()
