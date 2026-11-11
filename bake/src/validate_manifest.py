"""Validate bake manifests against bake/manifest/schema.json (a small built-in subset of JSON Schema: type, enum,
required, pattern, minimum, minItems, items, properties, $ref) plus semantic checks:

- ids unique; stack_below / stack_above refer to ids of this manifest (other clusters: warning);
- class baked -> file exists, RGBA 8-bit PNG, file size == (w*scale, h*scale), bytes_by_8wh == file w*h*8, fit present;
- boxes inside the panel (warning if outside); procedural / dynamic need params / no bytes;
- prints the layer count (images that would be loaded) and the memory total by w*h*8.

    python bake/src/validate_manifest.py bake/manifest/C1.json [more.json ...]     (exit 1 on errors)

BAKE_BAKED_DIR=<dir> overrides where 'file' paths resolve (default apps/f30_cluster/hud/baked).
"""
import json
import os
import re
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SCHEMA = os.path.join(ROOT, "bake", "manifest", "schema.json")
BAKED = os.environ.get("BAKE_BAKED_DIR", os.path.join(ROOT, "apps", "f30_cluster", "hud", "baked"))
TYPES = {"object": dict, "array": list, "string": str, "number": (int, float), "integer": int, "boolean": bool, "null": type(None)}


def check(node, sch, root, path, errs):
    if "$ref" in sch:
        ref = sch["$ref"].split("/")[1:]
        s = root
        for k in ref:
            s = s[k]
        return check(node, s, root, path, errs)
    t = sch.get("type")
    if t:
        ts = t if isinstance(t, list) else [t]
        ok = any(isinstance(node, TYPES[x]) and not (x in ("number", "integer") and isinstance(node, bool)) for x in ts)
        if not ok:
            errs.append(f"{path}: type {type(node).__name__}, expected {t}")
            return
    if "enum" in sch and node not in sch["enum"]:
        errs.append(f"{path}: {node!r} not in {sch['enum']}")
    if "pattern" in sch and isinstance(node, str) and not re.search(sch["pattern"], node):
        errs.append(f"{path}: {node!r} does not match {sch['pattern']}")
    if "minimum" in sch and isinstance(node, (int, float)) and node < sch["minimum"]:
        errs.append(f"{path}: {node} < {sch['minimum']}")
    if isinstance(node, dict):
        for k in sch.get("required", []):
            if k not in node:
                errs.append(f"{path}: missing '{k}'")
        for k, s in sch.get("properties", {}).items():
            if k in node:
                check(node[k], s, root, f"{path}.{k}", errs)
    if isinstance(node, list):
        if "minItems" in sch and len(node) < sch["minItems"]:
            errs.append(f"{path}: fewer than {sch['minItems']} items")
        if "items" in sch:
            for i, v in enumerate(node):
                check(v, sch["items"], root, f"{path}[{i}]", errs)


def semantic(m, errs, warns):
    ids = [e["id"] for e in m.get("layers", []) if "id" in e]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        errs.append(f"duplicate ids: {sorted(dup)}")
    known = set(ids)
    images, total = 0, 0
    for e in m.get("layers", []):
        p = f"layers[{e.get('id')}]"
        for k in ("stack_below", "stack_above"):
            for ref in e.get(k, []):
                if ref not in known:
                    warns.append(f"{p}.{k}: '{ref}' is not in this manifest (another cluster?)")
        if e.get("cluster") != m.get("cluster"):
            errs.append(f"{p}: cluster {e.get('cluster')} != manifest cluster {m.get('cluster')}")
        f = e.get("file")
        if e.get("class") == "baked" or f:
            if not f:
                errs.append(f"{p}: baked entry without a file")
                continue
            fp = os.path.join(BAKED, f)
            if not os.path.exists(fp):
                errs.append(f"{p}: file missing: {fp}")
                continue
            im = Image.open(fp)
            if im.mode != "RGBA":
                errs.append(f"{p}: {f} is {im.mode}, expected RGBA (straight alpha)")
            sc = e.get("scale", 1.0)
            for k in ("x", "y", "w", "h"):
                if k not in e:
                    errs.append(f"{p}: missing {k}")
            if "w" in e and "h" in e:
                exp = (round(e["w"] * sc), round(e["h"] * sc))
                if im.size != exp:
                    errs.append(f"{p}: file size {im.size} != (w*scale, h*scale) {exp}")
                b = im.size[0] * im.size[1] * 8
                if e.get("bytes_by_8wh") != b:
                    errs.append(f"{p}: bytes_by_8wh {e.get('bytes_by_8wh')} != {b}")
                total += b
                images += 1
                if e.get("frame") == "panel" and (e["x"] < -2 or e["y"] < -2 or e["x"] + e["w"] > 1922 or e["y"] + e["h"] > 722):
                    warns.append(f"{p}: box ({e['x']},{e['y']},{e['w']},{e['h']}) leaves the 1920x720 panel")
            if e.get("class") == "baked" and not e.get("fit"):
                warns.append(f"{p}: baked layer without 'fit' (run bake/src/qc.py)")
        else:
            if e.get("class") == "procedural" and not e.get("params"):
                warns.append(f"{p}: procedural entry without params")
    return images, total


def main(paths):
    schema = json.load(open(SCHEMA))
    bad = 0
    for path in paths:
        m = json.load(open(path))
        errs, warns = [], []
        check(m, schema, schema, "$", errs)
        n, total = semantic(m, errs, warns) if not errs else (0, 0)
        for w in warns:
            print(f"WARN  {path}: {w}")
        for e in errs:
            print(f"ERROR {path}: {e}")
        comp = m.get("composition", {})
        print(f"{'OK   ' if not errs else 'FAIL '} {path}: {len(m.get('layers', []))} entries, {n} image files, "
              f"{total / 1048576:.2f} MiB by w*h*8"
              + (f"; proposed composition: {comp.get('layer_count')} layers, {comp.get('bytes_by_8wh_total', 0) / 1048576:.2f} MiB" if comp else ""))
        bad += bool(errs)
    return 1 if bad else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1:]))
