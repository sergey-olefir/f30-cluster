#!/usr/bin/env python3
"""Twin Dial: the REAL tdial fragment shader (shared/shaders.js, compact()ed as the app sends it) on the real baked faces, on the
Mac's GPU through moderngl: no browser, no bench, no car (package B1; the engine's own path is bench/test-twin-budget.js and
tools/twin-dial/engine_render.py). Not shipped.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl python -I \\
        tools/twin-dial/render_dials.py [--out DIR] [--faces DIR] [--mockup PNG]

Imports render_dial() for the tests and the gallery. The uniforms are what shared/hud.js _twinDialSend / _twinMarks send (day,
bandGain 1, shadow on); a state dict overrides: needle deg, redline rpm, lim = (deg, state, warn, mode), cru = (deg, state),
night (the TW_NIGHT multipliers). With --mockup (K1's 80_look_06.png) the two dials are compared with the mockup's crops,
excluding the needle, its shadow, the hub's dynamic text and the bars' fills.
"""
import base64
import json
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'strip', 'O'))
import render as RD   # noqa: E402  (shim, VS: the GLSL ES -> 4.10 core shim the bench replay uses)

SCENE = os.path.join(ROOT, 'apps', 'twin_dial', 'hud', 'scene')
DIALS = {'tach': {'x': 70, 'y': 90, 'w': 620, 'h': 570, 'cx': 380, 'face': 'face_tacho', 'fx': 72},
         'speed': {'x': 1230, 'y': 90, 'w': 620, 'h': 570, 'cx': 1540, 'face': 'face_speedo', 'fx': 1232}}
NIGHT = {'white': 0.80, 'bezel': 0.70, 'tick': 0.75, 'strip': 0.55, 'bandIn': 0.60, 'bandOut': 0.55, 'bandEnd': 0.50, 'red': 0.85,
         'wedge': 0.80, 'green': 0.75, 'ramp': 0.55, 'rule': 0.70}
_CTX = {}


def shader_source():
    out = subprocess.check_output(['node', '-e', "process.stdout.write(require(%s).tdial)" % json.dumps(os.path.join(ROOT, 'shared', 'shaders.js'))])
    return out.decode()


def load_face(kind, faces=SCENE):
    j = json.load(open(os.path.join(faces, DIALS[kind]['face'] + '.json')))
    return np.frombuffer(base64.b64decode(j['r8']), np.uint8).reshape(j['h'], j['w'])


def tach_deg(rpm, sweep=125.0):
    return max(-sweep, min(sweep, -sweep + 2 * sweep * rpm / 8000.0))


def spd_deg(v, sweep=125.0):
    d = -sweep + sweep / 5 * v / 20 if v <= 100 else sweep / 5 * (v - 100) / 40
    return max(-sweep, min(sweep, d))


def uniforms(kind, st):
    d = DIALS[kind]
    night = st.get('night')
    m = (lambda k: NIGHT[k]) if night else (lambda k: 1.0)
    u = {'u_geo': [d['w'], d['h'], d['cx'] - d['x'], 400 - d['y']], 'u_dim': [300.0, 125.0, st.get('gain', 1.0), 1.0 if st.get('shadow', True) else 0.0],
         'u_faceR': [d['fx'] - d['x'], 0, 616, 560],
         'u_dyn': [st.get('deg', -125.0), st.get('fill', 0.0), st.get('seg', -1), 0],
         'u_bar': [619 - 90, 0, 0, 0], 'u_bar2': [5, 4, 0, 0],
         'u_n0': [m('white'), m('bezel'), m('tick'), m('strip')], 'u_n1': [m('bandIn'), m('bandOut'), m('bandEnd'), m('red')],
         'u_n2': [m('wedge'), m('green'), m('ramp'), m('rule')]}
    bx0, bx1 = (254, 506) if kind == 'tach' else (1394, 1646)
    u['u_bar'] = [619 - 90, bx0 - d['x'], bx1 - d['x'], 7.5]
    red = [999, 999, 999, 999]
    if kind == 'tach':
        rl = st.get('redline', 6500)
        ang = lambda r: -125.0 + 250.0 * r / 8000.0                                  # noqa: E731
        red = [ang(rl), ang(math.ceil(rl / 1000.0) * 1000) - 15.625, ang(rl) - 0.6, 143.6]
    u['u_red'] = red
    u['u_lim'] = list(st.get('lim', (0, 0, 0, 1))) if kind == 'speed' else [0, 0, 0, 0]
    u['u_cru'] = list(st.get('cru', (0, 0, 0, 0))) + [0] * 4 if kind == 'speed' else [0, 0, 0, 0]
    u['u_cru'] = u['u_cru'][:4]
    return u


def _ctx():
    if 'c' not in _CTX:
        import moderngl
        _CTX['mgl'] = moderngl
        _CTX['c'] = moderngl.create_standalone_context(require=410)
        _CTX['quad'] = _CTX['c'].buffer(np.array([-1, -1, 1, -1, -1, 1, 1, 1], dtype='f4').tobytes())
    return _CTX['c'], _CTX['mgl'], _CTX['quad']


def render_dial(kind, st=None, faces=SCENE, fs=None, scale=1):
    """-> (float32 H x W x 4 straight RGBA of the dial's layer (620 x 570 px at `scale`), the compile / link log or None)."""
    st = st or {}
    ctx, mgl, quad = _ctx()
    fs = fs or shader_source()
    prog = ctx.program(vertex_shader=RD.VS, fragment_shader=RD.shim(fs))
    d = DIALS[kind]
    face = load_face(kind, faces)
    tex = ctx.texture((616, 560), 1, np.ascontiguousarray(face).tobytes())
    tex.filter = (mgl.LINEAR, mgl.LINEAR)
    tex.repeat_x = tex.repeat_y = False
    u = uniforms(kind, st)
    for name in prog:
        m = prog[name]
        if not isinstance(m, mgl.Uniform):
            continue
        if m.gl_type == 0x8B5E:
            tex.use(0)
            m.value = 0
        elif name in u:
            v = u[name]
            m.value = tuple(float(a) for a in v)
    W, H = d['w'] * scale, d['h'] * scale
    fbo = ctx.framebuffer(color_attachments=[ctx.texture((W, H), 4, dtype='f4')])
    fbo.use()
    fbo.clear(0, 0, 0, 0)
    prog['o_uvA_'].value = (0.0, 0.0)
    prog['o_uvB_'].value = (1.0, 1.0)
    ctx.viewport = (0, 0, W, H)
    vao = ctx.vertex_array(prog, [(quad, '2f', 'a_pos')])
    vao.render(mgl.TRIANGLE_STRIP)
    out = np.frombuffer(fbo.read(components=4, dtype='f4'), dtype=np.float32).reshape(H, W, 4)[::-1].copy()
    vao.release()
    fbo.color_attachments[0].release()
    fbo.release()
    tex.release()
    prog.release()
    return np.clip(out, 0, 1)



def render_back(u, part='L', size=(1380, 720), mask=None):
    """The real tdback shader (shared/shaders.js tdbackFor(part), compact()ed) over a layer of `size` px with uniforms u (name -> numbers;
    u_hole / u_rule / u_ruleC as flat lists of vec4s). -> float32 H x W x 4 straight RGBA, or raises if the shader does not compile."""
    ctx, mgl, quad = _ctx()
    src = subprocess.check_output(['node', '-e', "process.stdout.write(require(%s).tdbackFor(%s))" % (json.dumps(os.path.join(ROOT, 'shared', 'shaders.js')), json.dumps(part))]).decode()
    prog = ctx.program(vertex_shader=RD.VS, fragment_shader=RD.shim(src))
    m8 = mask if mask is not None else np.zeros((112, 536), np.uint8)
    tex = ctx.texture((m8.shape[1], m8.shape[0]), 1, np.ascontiguousarray(m8).tobytes())
    tex.filter = (mgl.LINEAR, mgl.LINEAR)
    for name in prog:
        m = prog[name]
        if not isinstance(m, mgl.Uniform):
            continue
        if m.gl_type == 0x8B5E:
            tex.use(0)
            m.value = 0
        elif name in u:
            v = [float(a) for a in u[name]]
            if m.array_length > 1:
                n = m.array_length
                v = (v + [0.0] * (4 * n))[:4 * n]
                m.value = [tuple(v[4 * i:4 * i + 4]) for i in range(n)]
            else:
                m.value = tuple(v)
    W, H = size
    fbo = ctx.framebuffer(color_attachments=[ctx.texture((W, H), 4, dtype='f4')])
    fbo.use()
    fbo.clear(0, 0, 0, 0)
    prog['o_uvA_'].value = (0.0, 0.0)
    prog['o_uvB_'].value = (1.0, 1.0)
    ctx.viewport = (0, 0, W, H)
    vao = ctx.vertex_array(prog, [(quad, '2f', 'a_pos')])
    vao.render(mgl.TRIANGLE_STRIP)
    out = np.frombuffer(fbo.read(components=4, dtype='f4'), dtype=np.float32).reshape(H, W, 4)[::-1].copy()
    vao.release(); fbo.color_attachments[0].release(); fbo.release(); tex.release(); prog.release()   # noqa: E702
    return np.clip(out, 0, 1)


def over_black(rgba):
    """The layer over black: straight colour x alpha, 8 bit."""
    return np.clip(np.round(rgba[..., :3] * rgba[..., 3:4] * 255), 0, 255).astype(np.uint8)


def panel(states, faces=SCENE, fs=None):
    """A 1920 x 720 picture of both dials, black elsewhere. states: {'tach': {...}, 'speed': {...}}."""
    img = np.zeros((720, 1920, 3), np.uint8)
    fs = fs or shader_source()
    for kind, d in DIALS.items():
        img[d['y']:d['y'] + d['h'], d['x']:d['x'] + d['w']] = over_black(render_dial(kind, states.get(kind, {}), faces, fs))
    return img


def tach_state(rpm, **kw):
    return dict(deg=tach_deg(rpm), fill=0.54, redline=6500, **kw)


def spd_state(v, **kw):
    return dict(deg=spd_deg(v), fill=0.52, **kw)


# ------------------------------------------------------------------------------------------------------------ mockup comparison
def needle_mask(kind, deg, grow=0.0):
    """Bool 570 x 620 mask of the needle's polygon (widened by `grow` R each side) in layer px."""
    from PIL import ImageDraw
    prof = [(0.465, 0.030), (0.56, 0.039), (0.68, 0.032), (0.77, 0.022), (0.86, 0.020), (0.89, 0.016), (0.99, 0.004)]
    d = DIALS[kind]
    cx, cy = d['cx'] - d['x'], 400 - d['y']
    t = math.radians(deg)
    ux, uy, nx, ny = math.sin(t), -math.cos(t), math.cos(t), math.sin(t)
    L = [(cx + r * 300 * ux - (w * 150 + grow * 300) * nx, cy + r * 300 * uy - (w * 150 + grow * 300) * ny) for r, w in prof]
    Rr = [(cx + r * 300 * ux + (w * 150 + grow * 300) * nx, cy + r * 300 * uy + (w * 150 + grow * 300) * ny) for r, w in prof]
    im = Image.new('L', (d['w'], d['h']), 0)
    ImageDraw.Draw(im).polygon(L + Rr[::-1], fill=255)
    return np.asarray(im) > 0


def compare(mock_png, faces=SCENE, out_dir=None):
    """The two dials (tachometer 2400 rpm, speedometer 87 km/h, K1's 80_look_06 states) against the mockup's picture: per-zone
    numbers. Excludes the needle with its shadow, the hub's text (digits, gear, program, READY) and the bar region."""
    mock = np.asarray(Image.open(mock_png).convert('RGB')).astype(np.float64)
    res = {}
    fs = shader_source()
    states = {'tach': tach_state(2400), 'speed': spd_state(87)}
    for kind, d in DIALS.items():
        ours = over_black(render_dial(kind, states[kind], faces, fs)).astype(np.float64)
        ref = mock[d['y']:d['y'] + d['h'], d['x']:d['x'] + d['w']]
        valid = ~needle_mask(kind, states[kind]['deg'], 0.07)
        ys, xs = np.mgrid[0:d['h'], 0:d['w']]
        cx, cy = d['cx'] - d['x'], 400 - d['y']
        rho = np.hypot(xs + 0.5 - cx, ys + 0.5 - cy) / 300.0
        th = np.degrees(np.arctan2(xs + 0.5 - cx, -(ys + 0.5 - cy)))
        valid &= ~((rho < 0.50) & (ys + 0.5 > cy - 0.31 * 300) & (ys + 0.5 < cy + 0.27 * 300))        # READY, gear, program, digits, unit
        valid &= ys + 0.5 < cy + 0.60 * 300                                                         # not the bars, ends, icon
        valid &= rho < 1.02                                                                         # not the mockup's tab bar and bottom rule that reach into the layer's corners
        valid &= ~((np.abs(xs + 0.5 - cx) < 0.5 * 300) & (np.abs(ys + 0.5 - (cy + 0.40 * 300)) < 22) & (rho < 0.55))   # the baked unit label (the mockup draws Saira unstretched at a rounded size)
        diff = np.abs(ours - ref)
        dm = diff.max(axis=2)
        zones = {'bezel': rho >= 0.97, 'gap (0.94-0.97)': (rho >= 0.94) & (rho < 0.97), 'strip': (rho >= 0.893) & (rho < 0.94),
                 'band': (rho >= 0.5795) & (rho < 0.893), 'gap and rim (0.50-0.58)': (rho >= 0.50) & (rho < 0.5795)}
        r = {'mean_abs_diff_all_valid': round(float(diff[valid].mean()), 3),
             'p99': round(float(np.percentile(dm[valid], 99)), 1), 'px_over_32': int((dm[valid] > 32).sum()), 'px_over_96': int((dm[valid] > 96).sum())}
        r['by_zone'] = {k: {'px': int((z & valid).sum()), 'mean_abs_diff': round(float(diff[z & valid].mean()), 3) if (z & valid).any() else None,
                            'px_over_32': int((dm[z & valid] > 32).sum())} for k, z in zones.items()}
        # geometry: the bright ink (luma >= 128) of each picture, the distance from one to the other (Chebyshev-free: a disc)
        lu = lambda a: a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722        # noqa: E731
        A, B = (lu(ours) >= 128) & valid, (lu(ref) >= 128) & valid
        g = {}
        for nm, a, b in (('ours_to_mockup', A, B), ('mockup_to_ours', B, A)):
            dist = _dist_to(b, 6)
            g[nm] = {'ink_px': int(a.sum()), 'beyond_1px': int((a & (dist > 1)).sum()), 'beyond_2px': int((a & (dist > 2)).sum())}
        r['geometry'] = g
        # the ring ends: the last angle of bezel, band, rim on both pictures (|theta| of the outermost lit px of the ring)
        def ring_end(img, r0, r1, thr, thmax=181):
            lum = lu(img)
            sel = (rho >= r0) & (rho <= r1) & (lum >= thr) & (th > 90) & (th < thmax) & (ys > cy)
            return round(float(th[sel].max()), 2) if sel.any() else None
        r['ring_end_deg'] = {'bezel': [ring_end(ours, 0.98, 1.02, 128), ring_end(ref, 0.98, 1.02, 128)],
                             'rim': [ring_end(ours, 0.535, 0.553, 128), ring_end(ref, 0.535, 0.553, 128)],
                             'band (luma >= 20)': [ring_end(ours, 0.62, 0.86, 20, 149), ring_end(ref, 0.62, 0.86, 20, 149)]}
        res[kind] = r
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
            side = np.concatenate([ours.astype(np.uint8), ref.astype(np.uint8), np.clip(diff * 4, 0, 255).astype(np.uint8)], axis=1)
            Image.fromarray(side).save(os.path.join(out_dir, 'cmp_%s.png' % kind))
    return res


def _dist_to(b, rmax):
    """For every px: 0 if inside b, else the smallest r in 1..rmax with b within r px (disc), rmax + 1 beyond."""
    out = np.full(b.shape, rmax + 1, np.int16)
    out[b] = 0
    cur = b.copy()
    for r in range(1, rmax + 1):
        grow = cur.copy()
        grow[1:] |= cur[:-1]; grow[:-1] |= cur[1:]; grow[:, 1:] |= cur[:, :-1]; grow[:, :-1] |= cur[:, 1:]
        grow[1:, 1:] |= cur[:-1, :-1]; grow[:-1, :-1] |= cur[1:, 1:]; grow[1:, :-1] |= cur[:-1, 1:]; grow[:-1, 1:] |= cur[1:, :-1]
        new = grow & ~cur
        out[new] = r
        cur = grow
    return out


def main():
    a = sys.argv
    arg = lambda n, d=None: a[a.index(n) + 1] if n in a else d                              # noqa: E731
    out = os.path.abspath(arg('--out', os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'r3b', 'B1')))
    faces = arg('--faces', SCENE)
    os.makedirs(out, exist_ok=True)
    img = panel({'tach': tach_state(2400), 'speed': spd_state(87)}, faces)
    Image.fromarray(img).save(os.path.join(out, 'dials_day.png'))
    mock = arg('--mockup', os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'mockup', 'r3', '80_look_06.png'))
    if os.path.exists(mock):
        r = compare(mock, faces, out)
        json.dump(r, open(os.path.join(out, 'compare_look_06.json'), 'w'), indent=1)
        print(json.dumps(r, indent=1))
    print('wrote', out)


if __name__ == '__main__':
    main()
