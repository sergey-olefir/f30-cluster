"""research3 MT: bench/etc2.js decodes exactly what texture2ddecoder (the reference) decodes, on every scene texture of
f30_cluster encoded both ways (etcpak: etc2rgba straight, etc2rgb premultiplied), and on random blocks that reach every
ETC2 mode (individual, differential, T, H, planar) and every EAC table.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with etcpak --with texture2ddecoder \\
        python -I tools/research3/mt/test_etc2.py
Exit 0 when every texel of every case matches.
"""
import os
import subprocess
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texlib as TL   # noqa: E402

NODE = '''const e = require(process.argv[1]); const fs = require('fs');
const [fmt, f, w, h, out] = process.argv.slice(2);
fs.writeFileSync(out, e.decode(fmt, fs.readFileSync(f), +w, +h));'''


def ref(fmt, data, w, h):
    import texture2ddecoder as T
    dec = T.decode_etc2a8(data, w, h) if fmt == 'etc2rgba' else T.decode_etc2(data, w, h)
    a = np.frombuffer(dec, np.uint8).reshape(h, w, 4)[..., [2, 1, 0, 3]].copy()
    if fmt == 'etc2rgb':
        a[..., 3] = 255
    return a


def mine(fmt, data, w, h, tmp):
    f, o = os.path.join(tmp, 'in.etc2'), os.path.join(tmp, 'out.rgba')
    open(f, 'wb').write(data)
    subprocess.check_call(['node', '-e', NODE, os.path.join(TL.ROOT, 'bench', 'etc2.js'), fmt, f, str(w), str(h), o])
    return np.frombuffer(open(o, 'rb').read(), np.uint8).reshape(h, w, 4)


def main():
    import etcpak
    fails = 0
    cases = 0
    with tempfile.TemporaryDirectory() as tmp:
        names = sorted(f[:-5] for f in os.listdir(TL.SCENE) if f.endswith('.json') and '@' not in f)
        for n in names:
            rgba, j = TL.load(n)
            h, w = rgba.shape[:2]
            H, W = (h + 3) // 4 * 4, (w + 3) // 4 * 4
            p = np.zeros((H, W, 4), np.uint8)
            p[:h, :w] = rgba
            for fmt in ('etc2rgba', 'etc2rgb'):
                data = etcpak.compress_etc2_rgba(p.tobytes(), W, H) if fmt == 'etc2rgba' else etcpak.compress_etc2_rgb(p.tobytes(), W, H)
                a, b = ref(fmt, data, W, H), mine(fmt, data, W, H, tmp)
                bad = int((a != b).any(-1).sum())
                cases += 1
                fails += bad > 0
                print('%-12s %-8s %4dx%-4d texels differing: %d' % (n, fmt, W, H, bad))
        rng = np.random.default_rng(7)
        for fmt in ('etc2rgba', 'etc2rgb'):
            data = rng.integers(0, 256, (64 * 64 // 16) * (16 if fmt == 'etc2rgba' else 8), dtype=np.uint8).tobytes()
            a, b = ref(fmt, data, 64, 64), mine(fmt, data, 64, 64, tmp)
            bad = int((a != b).any(-1).sum())
            cases += 1
            fails += bad > 0
            print('random      %-8s   64x64   texels differing: %d' % (fmt, bad))
    print('%d cases, %d failed' % (cases, fails))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
