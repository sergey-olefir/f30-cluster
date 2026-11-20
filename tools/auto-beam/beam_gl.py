"""tools/auto-beam: Auto Beam's effect shaders run on the Mac's GPU, for the mockups and the size report (round "Auto Beam",
package HD; tools/acc-view/lane_gl.py's way).

    from beam_gl import GL, shipped, sizes
    gl = GL(); rgba = gl.render('ab_road', w, h, {'u_view': (...), ...}, ss=3)     # float32 straight RGBA, h x w x 4
    python3 tools/auto-beam/beam_gl.py [--bake]       the sizes; --bake writes apps/auto_beam/hud/shaders.json

The sources are GLSL ES 1.00 (apps/auto_beam/shaders/*.glsl), shimmed to GLSL 4.10 core exactly as lane_gl.py does (varying ->
in, texture2D -> texture, gl_FragColor -> an out variable; the maths unchanged), with the bench's vertex shader (v_uv 0,0 at
the top left). shipped(src): the bytes the app sends (comments and blank lines stripped, runs of spaces collapsed): the measure
the KOMBI's limit is known in (26.7 k reset).
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'acc-view'))
import lane_gl  # noqa: E402  (the shim, the GL context, shipped())

APP = os.path.join(HERE, '..', '..', 'apps', 'auto_beam')
SHADERS = os.path.join(APP, 'shaders')
shipped = lane_gl.shipped


def source(name):
    with open(os.path.join(SHADERS, name + '.glsl')) as f:
        return f.read()


def sizes():
    out = {}
    for f in sorted(os.listdir(SHADERS)):
        if f.endswith('.glsl'):
            src = source(f[:-5])
            out[f[:-5]] = (len(src.encode()), len(shipped(src).encode()))
    return out


class GL(lane_gl.GL):
    def program(self, name):
        if name not in self.progs:
            self.progs[name] = self.ctx.program(vertex_shader=lane_gl.VS, fragment_shader=lane_gl.shim(shipped(source(name))))
        return self.progs[name]


def bake():
    sh = {f[:-5]: shipped(source(f[:-5])) for f in sorted(os.listdir(SHADERS)) if f.endswith('.glsl')}
    os.makedirs(os.path.join(APP, 'hud'), exist_ok=True)
    with open(os.path.join(APP, 'hud', 'shaders.json'), 'w') as f:
        json.dump(sh, f, indent=1, sort_keys=True)
        f.write('\n')
    print('shaders.json: ' + ', '.join('%s %d B' % (k, len(v.encode())) for k, v in sh.items()))


def jobs(path):
    """Render the layers the mockups ask for: a JSON list of { out, shader, w, h, u } -> straight RGBA PNGs (out)."""
    import numpy as np
    from PIL import Image
    gl = GL()
    todo = json.load(open(path))
    for j in todo:
        u = {}
        for k, v in j['u'].items():
            u[k] = [tuple(v[i:i + 4]) for i in range(0, len(v), 4)] if isinstance(v, list) and len(v) > 4 else v
        a = gl.render(j['shader'], j['w'], j['h'], u, ss=3)
        Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype('uint8'), 'RGBA').save(j['out'])
    print('%d layers rendered by the GPU' % len(todo))


if __name__ == '__main__':
    if '--bake' in sys.argv:
        bake()
    if '--jobs' in sys.argv:
        jobs(sys.argv[sys.argv.index('--jobs') + 1])
        sys.exit(0)
    for k, (raw, shp) in sizes().items():
        print('%-10s source %6d B   shipped %6d B' % (k, raw, shp))
