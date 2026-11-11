"""Regenerate every P0 output: rect crops (6WB + G20 + our bench), refs.json.

    cd bake/src && uv run ... python -m p0.run
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from p0 import align, g20, build_refs  # noqa: E402

if __name__ == "__main__":
    import json
    res = align.run()
    with open(os.path.join(align.DBG, "align_6wb.json"), "w") as f:
        json.dump(res, f, indent=1)
    g20.run()
    build_refs.main()
