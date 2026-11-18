#!/usr/bin/env python3
"""Write <session>/session.json from what collect.sh saved: the installed apps' names, versions and uids, the cluster-render
version, the car's clock at the copy, the files copied with their sizes.  Local, read only.  Numbers and our own words only."""
import json
import os
import re
import sys


def main(argv):
    root = argv[0]
    label = argv[1] if len(argv) > 1 else ""
    apps = {}
    byuid = os.path.join(root, "by-uid")
    if os.path.isdir(byuid):
        for uid in sorted(os.listdir(byuid)):
            pj = os.path.join(byuid, uid, "package.json")
            try:
                d = json.load(open(pj, encoding="utf-8"))
            except (OSError, ValueError):
                continue
            name, ver = d.get("name"), str(d.get("version", ""))
            if isinstance(name, str) and re.match(r"^[A-Za-z0-9_-]+$", name) and re.match(r"^\d+\.\d+\.\d+", ver):
                apps[name] = {"uid": int(uid), "version": [int(x) for x in ver.split(".")[:3] if x.isdigit()],
                              "has_log": os.path.isfile(os.path.join(root, "apps", name, name + ".log"))}
    cr = None
    try:
        v = json.load(open(os.path.join(root, "cluster-render", "component.json"), encoding="utf-8")).get("version", "")
        cr = [int(x) for x in str(v).split(".")[:3] if x.isdigit()]
    except (OSError, ValueError):
        pass
    clock = None
    try:
        t = open(os.path.join(root, "system", "date.txt"), encoding="utf-8").read().strip()
        if re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$", t):
            clock = t
    except OSError:
        pass
    files = {}
    for r, ds, fs in os.walk(root):
        ds[:] = [d for d in ds if d not in ("redacted", "by-uid")]
        for f in fs:
            p = os.path.join(r, f)
            files[os.path.relpath(p, root)] = os.path.getsize(p)
    out = {"schema": 1, "label": label, "car_clock_at_copy": clock, "apps": apps, "cluster_render_version": cr, "files": files}
    with open(os.path.join(root, "session.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print("session.json: %d app(s), %d file(s)" % (len(apps), len(files)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
