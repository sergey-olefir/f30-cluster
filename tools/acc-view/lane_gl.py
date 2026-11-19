"""tools/acc-view: ACC View's effect shaders (direction E) run on the Mac's GPU, for the mockups and the size report.

    from lane_gl import GL, shipped, sizes
    gl = GL(); rgba = gl.render('acc_lane', w, h, {'u_geo': (...), ...}, ss=3)     # float32 straight RGBA, h x w x 4

The sources are GLSL ES 1.00 (tools/acc-view/app/acc_view/shaders/*.glsl), shimmed to GLSL 4.10 core exactly as
tools/strip/O/render.py does for the apps' shaders (varying -> in, texture2D -> texture, gl_FragColor -> an out
variable; the maths unchanged), with the bench's vertex shader (v_uv 0,0 at the top left). `ss` samples each layer pixel
ss x ss times (the analytic field, finer than the display) and averages. The Mac computes in fp32; the car's mediump is
fp16, so both sources ask for highp and keep their px distances out of length() of large offsets.

shipped(src): the bytes the app would send (comments and blank lines stripped, runs of spaces collapsed), the measure
the KOMBI's limit is known in (WBDIAL 25.4 k characters accepted, 26.7 k reset; our shaders on the car 2.7-13 k).
"""
import os
import re

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SHADERS = os.path.join(HERE, 'app', 'acc_view', 'shaders')

VS = '''#version 410 core
in vec2 a_pos;
out vec2 v_uv;
void main(){ v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5); gl_Position = vec4(a_pos, 0.0, 1.0); }
'''


def source(name):
    with open(os.path.join(SHADERS, name + '.glsl')) as f:
        return f.read()


def shipped(src):
    s = re.sub(r'/\*[\s\S]*?\*/', '', src)
    s = re.sub(r'//[^\n]*', '', s)
    lines = [re.sub(r'[ \t]+', ' ', ln).strip() for ln in s.split('\n')]
    return '\n'.join(ln for ln in lines if ln) + '\n'


def sizes():
    out = {}
    for f in sorted(os.listdir(SHADERS)):
        if f.endswith('.glsl'):
            src = source(f[:-5])
            out[f[:-5]] = (len(src.encode()), len(shipped(src).encode()))
    return out


def shim(fs):
    s = re.sub(r'\bgl_FragColor\b', 'o_FragColor_', fs)
    s = re.sub(r'\btexture2D\b', 'texture', s)
    s = re.sub(r'(^|\n)(\s*)varying\s', r'\1\2in ', s)
    return '#version 410 core\nout vec4 o_FragColor_;\n' + s


class GL:
    def __init__(self):
        import moderngl
        self.mgl = moderngl
        self.ctx = moderngl.create_standalone_context(require=410)
        self.quad = self.ctx.buffer(np.array([-1, -1, 1, -1, -1, 1, 1, 1], dtype='f4').tobytes())
        self.progs = {}

    def program(self, name):
        if name not in self.progs:
            self.progs[name] = self.ctx.program(vertex_shader=VS, fragment_shader=shim(shipped(source(name))))
        return self.progs[name]

    def render(self, name, w, h, uniforms, ss=3):
        """The layer w x h px (u_size = w, h) -> float32 straight RGBA, h x w x 4 (top row first)."""
        prog = self.program(name)
        W, H = int(round(w * ss)), int(round(h * ss))
        fbo = self.ctx.framebuffer(color_attachments=[self.ctx.texture((W, H), 4, dtype='f4')])
        fbo.use()
        fbo.clear(0.0, 0.0, 0.0, 0.0)
        self.ctx.viewport = (0, 0, W, H)
        u = dict(uniforms)
        u['u_size'] = (float(w), float(h))
        for k, v in u.items():
            if k not in prog:
                continue
            m = prog[k]
            if m.array_length > 1:
                vals = [tuple(float(x) for x in e) for e in v] + [(0.0,) * len(v[0])] * (m.array_length - len(v))
                m.value = vals[:m.array_length]
            else:
                m.value = tuple(float(x) for x in v) if isinstance(v, (tuple, list)) else float(v)
        vao = self.ctx.vertex_array(prog, [(self.quad, '2f', 'a_pos')])
        vao.render(self.mgl.TRIANGLE_STRIP)
        data = np.frombuffer(fbo.read(components=4, dtype='f4'), dtype=np.float32).reshape(H, W, 4)[::-1]
        vao.release()
        fbo.color_attachments[0].release()
        fbo.release()
        data = np.clip(data, 0.0, 1.0)
        if ss > 1:
            # average premultiplied, then back to straight alpha
            pm = data.copy()
            pm[..., :3] *= pm[..., 3:4]
            pm = pm.reshape(h, ss, w, ss, 4).mean(axis=(1, 3))
            a = pm[..., 3:4]
            pm[..., :3] = np.where(a > 1e-6, pm[..., :3] / np.maximum(a, 1e-6), 0.0)
            data = pm
        return data.astype(np.float32)


if __name__ == '__main__':
    for k, (raw, shp) in sizes().items():
        print('%-10s source %6d B   shipped %6d B' % (k, raw, shp))
