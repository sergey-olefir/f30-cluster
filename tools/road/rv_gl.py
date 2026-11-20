"""tools/road: the Road View effect shaders (shared/road_shaders.js) run on the Mac's GPU, for the mockups and the size report.

    from rv_gl import GL, shipped, atlas
    gl = GL(); rgba = gl.render('rv_strip_td', w, h, {'u_it': [...], ...}, tex={'u_atlas': atlas('twin_dial')}, ss=3)

The sources are the text the app sends (shared/road_shaders.js shipped(), read through node), shimmed to GLSL 4.10 core exactly as
tools/acc-view/lane_gl.py and tools/strip/O/render.py do (varying -> in, texture2D -> texture, gl_FragColor -> an out variable;
the maths unchanged), with the bench's vertex shader (v_uv 0,0 at the top left). A sampler gets the theme's sign atlas
(apps/<id>/hud/scene/rv_signs.json) as a LINEAR, CLAMP_TO_EDGE texture, as the bench page binds it. `ss` samples each layer pixel
ss x ss times and averages (premultiplied). The Mac computes in fp32; the car's mediump is fp16, so every source asks for highp.
"""
import base64
import json
import os
import re
import subprocess

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

VS = '''#version 410 core
in vec2 a_pos;
out vec2 v_uv;
void main(){ v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5); gl_Position = vec4(a_pos, 0.0, 1.0); }
'''

_SRC = None


def shipped(name=None):
    global _SRC
    if _SRC is None:
        out = subprocess.check_output(['node', '-e', 'const S=require(process.argv[1]);const o={};Object.keys(S.SOURCES).forEach(k=>{o[k]={src:S.SOURCES[k],ship:S.shipped(k)}});'
                                       'process.stdout.write(JSON.stringify(o))', os.path.join(ROOT, 'shared', 'road_shaders.js')])
        _SRC = json.loads(out.decode('utf-8'))
    return _SRC if name is None else _SRC[name]['ship']


def sizes():
    return {k: (len(v['src'].encode()), len(v['ship'].encode())) for k, v in shipped().items()}


def atlas(app):
    """The theme's sign atlas: (h, w, 4) uint8 straight RGBA and its JSON (cells, cell, style)."""
    j = json.load(open(os.path.join(ROOT, 'apps', app, 'hud', 'scene', 'rv_signs.json')))
    a = np.frombuffer(base64.b64decode(j['rgba']), np.uint8).reshape(j['h'], j['w'], 4)
    return a, j


def shim(fs):
    s = re.sub(r'\bgl_FragColor\b', 'o_FragColor_', fs)
    s = re.sub(r'\btexture2D\b', 'texture', s)
    s = re.sub(r'(^|\n)(\s*)varying\s', r'\1\2in ', s)
    for w in ('patch', 'sample', 'filter', 'input', 'output', 'common', 'active', 'smooth', 'flat', 'layout'):
        s = re.sub(r'\b%s\b' % w, w + '_ES_', s)
    return '#version 410 core\nout vec4 o_FragColor_;\n' + s


class GL:
    def __init__(self):
        import moderngl
        self.mgl = moderngl
        self.ctx = moderngl.create_standalone_context(require=410)
        self.quad = self.ctx.buffer(np.array([-1, -1, 1, -1, -1, 1, 1, 1], dtype='f4').tobytes())
        self.progs = {}
        self.texs = {}

    def program(self, name):
        if name not in self.progs:
            self.progs[name] = self.ctx.program(vertex_shader=VS, fragment_shader=shim(shipped(name)))
        return self.progs[name]

    def texture(self, key, rgba):
        if key not in self.texs:
            h, w = rgba.shape[:2]
            # the bench page's canvas round trip: premultiplied 8-bit, then un-premultiplied (a texel with alpha 0 has rgb 0)
            a = rgba[..., 3:4].astype(np.float64)
            pm = np.round(rgba[..., :3].astype(np.float64) * a / 255.0)
            un = np.where(a > 0, np.minimum(255, np.round(pm * 255.0 / np.maximum(a, 1))), 0)
            data = np.concatenate([un, a], axis=2).astype(np.uint8)
            t = self.ctx.texture((w, h), 4, data.tobytes())
            t.filter = (self.mgl.LINEAR, self.mgl.LINEAR)
            t.repeat_x = False
            t.repeat_y = False
            self.texs[key] = t
        return self.texs[key]

    def render(self, name, w, h, uniforms, tex=None, ss=3):
        """The layer w x h px (u_size = w, h) -> float32 straight RGBA, h x w x 4 (top row first)."""
        prog = self.program(name)
        W, H = int(round(w * ss)), int(round(h * ss))
        fbo = self.ctx.framebuffer(color_attachments=[self.ctx.texture((W, H), 4, dtype='f4')])
        fbo.use()
        fbo.clear(0.0, 0.0, 0.0, 0.0)
        self.ctx.viewport = (0, 0, W, H)
        u = dict(uniforms)
        u['u_size'] = (float(w), float(h))
        unit = 0
        for k, (key, rgba) in (tex or {}).items():
            if k in prog:
                self.texture(key, rgba).use(location=unit)
                prog[k].value = unit
                unit += 1
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
            pm = data.copy()
            pm[..., :3] *= pm[..., 3:4]
            pm = pm.reshape(h, ss, w, ss, 4).mean(axis=(1, 3))
            a = pm[..., 3:4]
            pm[..., :3] = np.where(a > 1e-6, pm[..., :3] / np.maximum(a, 1e-6), 0.0)
            data = pm
        return data.astype(np.float32)


if __name__ == '__main__':
    for k, (raw, shp) in sizes().items():
        print('%-14s source %6d B   shipped %6d B' % (k, raw, shp))
