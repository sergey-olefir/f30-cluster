"""Package O (docs/AGENT-BRIEF-strip.md): what OUR layers put on every pixel of a panel region, from the engine's own
output, with no browser.

A snapshot (tools/strip/O/snap.py) holds the scene exactly as the bench streams it (every layer, its compiled
fragment shader, every live uniform, every sampler binding) and the raw pixels of every image layer and asset
(GET /px). This module replays it the way bench/page.html draws it:

  * effect layers run the app's REAL fragment shader (GLSL ES 1.00, minimally shimmed to GLSL 4.10 core:
    `varying` -> `in`, `texture2D` -> `texture`, `gl_FragColor` -> an out variable) on the Mac's GPU through moderngl,
    with page.html's own vertex shader (v_uv top-left), its uniform rules (arrays by base name, whole elements only,
    u_time only when the layer asks for it), LINEAR / CLAMP_TO_EDGE textures, and its rule that an effect with an
    unbound sampler is not drawn (RAMSES does the same on the car);
  * the textures go through the same canvas round trip the page puts them through (premultiplied 8-bit, then
    un-premultiplied for texImage2D), so a texel with alpha 0 has rgb 0 as on the bench;
  * image layers are their raw RGBA, placed at x, y (scaled when w, h differ from iw, ih; never in this theme);
  * layers stack as page.html stacks them: target panel, visible, not waiting, not an asset; class order
    ambient < content < overlay < alert, then z, then arrival order (Array.sort is stable); the last exclusive layer
    hides everything under it; opacity multiplies alpha; source-over in premultiplied light.

At scale s > 1 effect layers are evaluated at s x s sample centres per panel pixel (the analytic field the shader
defines, sampled finer than the display); image layers are replicated (a panel pixel IS their pixel). At s = 1 the
result is the display's pixels, in float (the bench additionally quantises each effect to 8 bits: +-0.5/255).

Precision: the Mac's GPU computes in fp32, as the bench's WebGL does. The car's mediump is fp16 (see the
brief's platform limits); WBBACK and WBDIAL ask for highp where available. Not modelled here.
"""
import json
import os
import re
import numpy as np

CLASS_ORDER = {'ambient': 0, 'content': 1, 'overlay': 2, 'alert': 3}
VS = '''#version 410 core
in vec2 a_pos;
out vec2 v_uv;
uniform vec2 o_uvA_;   // the drawn sub-rect's top-left and bottom-right in the layer's v_uv (page.html: 0,0 and 1,1)
uniform vec2 o_uvB_;
void main(){ v_uv = mix(o_uvA_, o_uvB_, vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5)); gl_Position = vec4(a_pos, 0.0, 1.0); }
'''


def shim(fs):
    """GLSL ES 1.00 fragment shader -> GLSL 4.10 core, changing nothing of its maths."""
    s = fs
    s = re.sub(r'\bgl_FragColor\b', 'o_FragColor_', s)
    s = re.sub(r'\btexture2D\b', 'texture', s)
    s = re.sub(r'(^|\n)(\s*)varying\s', r'\1\2in ', s)
    # words that are keywords in GLSL 4.10 but free identifiers in GLSL ES 1.00 (WBBACK has a function "patch")
    for w in ('patch', 'sample', 'subroutine', 'noperspective', 'smooth', 'flat', 'layout', 'centroid', 'common',
              'partition', 'active', 'resource', 'buffer', 'shared', 'coherent', 'volatile', 'restrict', 'readonly',
              'writeonly', 'precise', 'filter', 'input', 'output'):
        s = re.sub(r'\b%s\b' % w, w + '_ES_', s)
    return '#version 410 core\nout vec4 o_FragColor_;\n' + s


def canvas_roundtrip(rgba):
    """The page draws pixels into a 2D canvas (premultiplied 8-bit) and uploads them with texImage2D (un-premultiplied)."""
    a = rgba[..., 3:4].astype(np.float64)
    c = rgba[..., :3].astype(np.float64)
    p = np.round(c * a / 255.0)
    with np.errstate(divide='ignore', invalid='ignore'):
        back = np.where(a > 0, np.round(p * 255.0 / np.maximum(a, 1)), 0)
    out = rgba.copy()
    out[..., :3] = np.clip(back, 0, 255).astype(np.uint8)
    return out


class Snapshot:
    def __init__(self, d):
        self.dir = d          # also the texture cache's key: a modified copy gets its own
        self.pxdir = d
        self.meta = json.load(open(os.path.join(d, 'scene.json')))
        self.layers = self.meta['layers']
        self.by_key = {l['key']: l for l in self.layers}

    def pixels(self, key):
        l = self.by_key[key]
        f = os.path.join(self.pxdir, 'px', key.replace(':', '_') + '.raw')
        if not os.path.exists(f):
            return None
        raw = np.frombuffer(open(f, 'rb').read(), dtype=np.uint8)
        return raw.reshape(l['ih'], l['iw'], 4)

    def drawn(self, target='panel'):
        hud = [l for l in self.layers if l['target'] == target and l.get('visible') and l.get('state') != 'waiting'
               and l['kind'] != 'asset']
        order = sorted(range(len(hud)), key=lambda i: (CLASS_ORDER.get(hud[i]['class'], 1), hud[i]['z'], i))
        hud = [hud[i] for i in order]
        start = 0
        for i, l in enumerate(hud):
            if l.get('exclusive'):
                start = i
        return hud[start:]


class Renderer:
    def __init__(self):
        import moderngl
        self.mgl = moderngl
        self.ctx = moderngl.create_standalone_context(require=410)
        self.progs = {}
        self.texcache = {}
        self.quad = self.ctx.buffer(np.array([-1, -1, 1, -1, -1, 1, 1, 1], dtype='f4').tobytes())

    def program(self, fs):
        if fs not in self.progs:
            try:
                self.progs[fs] = (self.ctx.program(vertex_shader=VS, fragment_shader=shim(fs)), None)
            except Exception as e:     # a shader that does not compile is reported, not guessed round
                self.progs[fs] = (None, str(e))
        return self.progs[fs]

    def texture(self, snap, key):
        ck = (snap.dir, key)
        if ck not in self.texcache:
            px = snap.pixels(key)
            if px is None:
                return None
            px = canvas_roundtrip(px)
            t = self.ctx.texture((px.shape[1], px.shape[0]), 4, np.ascontiguousarray(px).tobytes())
            t.filter = (self.mgl.LINEAR, self.mgl.LINEAR)
            t.repeat_x = False
            t.repeat_y = False
            self.texcache[ck] = t
        return self.texcache[ck]

    def effect(self, snap, l, region, s, t_ms=0.0):
        """Straight RGBA (float32) of an effect layer over `region` (x0, y0, x1, y1 panel px) at scale s, or a reason."""
        prog, err = self.program(l['fs'])
        if prog is None:
            return None, 'shader does not compile: ' + err.splitlines()[0][:200]
        x0, y0, x1, y1 = region
        W, H = int((x1 - x0) * s), int((y1 - y0) * s)
        fbo = self.ctx.framebuffer(color_attachments=[self.ctx.texture((W, H), 4, dtype='f4')])
        fbo.use()
        fbo.clear(0.0, 0.0, 0.0, 0.0)
        unit = 0
        notes = []
        for name in prog:
            m = prog[name]
            if not isinstance(m, self.mgl.Uniform):
                continue
            if m.gl_type == 0x8B5E:     # sampler2D
                key = (l.get('binds') or {}).get(name)
                tex = self.texture(snap, key) if key else None
                if tex is None:
                    fbo.release()
                    return None, 'sampler %s has no asset bound: not drawn (as on the car)' % name
                tex.use(unit)
                m.value = unit
                unit += 1
                continue
            base = re.sub(r'\[0\]$', '', name)
            ent = (l.get('uniforms') or {}).get(base) or (l.get('uniforms') or {}).get(name)
            v = ent['v'] if ent else None
            if base == 'u_time' and l.get('time'):
                v = [t_ms / 1000.0]
            if not v:
                continue
            width = {0x1406: 1, 0x8B50: 2, 0x8B51: 3, 0x8B52: 4, 0x8B5C: 16}.get(m.gl_type)
            if not width:
                continue
            count = min(m.array_length, len(v) // width)
            if count < 1:
                notes.append('%s: %d numbers do not fill one element' % (name, len(v)))
                continue
            vals = [float(a) for a in v[:count * width]]
            if m.array_length > 1:
                # the page uploads `count` elements; GL leaves the rest at their default, 0
                vals = vals + [0.0] * ((m.array_length - count) * width)
                m.value = [tuple(vals[i * width:(i + 1) * width]) if width > 1 else vals[i] for i in range(m.array_length)]
            else:
                m.value = tuple(vals) if width > 1 else vals[0]
        vao = self.ctx.vertex_array(prog, [(self.quad, '2f', 'a_pos')])
        # Only the part of the layer inside the region is drawn: a viewport over that sub-rect, with v_uv spanning the
        # sub-rect's own share of the layer, so each sample sees exactly the v_uv the page's full-layer quad gives it
        # (v_uv is linear in the fragment centre). A whole-layer viewport at 16x would pass GL_MAX_VIEWPORT_DIMS.
        lx, ly, lw, lh = l['x'], l['y'], l['w'], l['h']
        sx0, sy0, sx1, sy1 = max(lx, x0), max(ly, y0), min(lx + lw, x1), min(ly + lh, y1)
        if sx1 <= sx0 or sy1 <= sy0:
            fbo.release()
            return np.zeros((H, W, 4), np.float32), None
        prog['o_uvA_'].value = ((sx0 - lx) / lw, (sy0 - ly) / lh)
        prog['o_uvB_'].value = ((sx1 - lx) / lw, (sy1 - ly) / lh)
        self.ctx.viewport = (int(round((sx0 - x0) * s)), int(round((y1 - sy1) * s)),
                             int(round((sx1 - sx0) * s)), int(round((sy1 - sy0) * s)))
        vao.render(self.mgl.TRIANGLE_STRIP)
        data = np.frombuffer(fbo.read(components=4, dtype='f4'), dtype=np.float32).reshape(H, W, 4)[::-1].copy()
        vao.release()
        fbo.color_attachments[0].release()
        fbo.release()
        return np.clip(data, 0.0, 1.0), ('; '.join(notes) or None)

    def image(self, snap, l, region, s):
        x0, y0, x1, y1 = region
        W, H = int((x1 - x0) * s), int((y1 - y0) * s)
        out = np.zeros((H, W, 4), np.float32)
        px = snap.pixels(l['key'])
        if px is None:
            return None, 'no pixels'
        note = None
        if l['w'] != l['iw'] or l['h'] != l['ih']:
            # canvas drawImage scales with smoothing; not used by this theme, approximated by nearest here
            note = 'scaled %dx%d -> %dx%d (nearest)' % (l['iw'], l['ih'], l['w'], l['h'])
            yi = (np.arange(l['h']) * l['ih'] // l['h'])
            xi = (np.arange(l['w']) * l['iw'] // l['w'])
            px = px[yi][:, xi]
        f = px.astype(np.float32) / 255.0
        if s > 1:
            f = np.repeat(np.repeat(f, s, axis=0), s, axis=1)
        lx, ly = int(round((l['x'] - x0) * s)), int(round((l['y'] - y0) * s))
        sx0, sy0 = max(0, -lx), max(0, -ly)
        dx0, dy0 = max(0, lx), max(0, ly)
        w = min(W - dx0, f.shape[1] - sx0)
        h = min(H - dy0, f.shape[0] - sy0)
        if w > 0 and h > 0:
            out[dy0:dy0 + h, dx0:dx0 + w] = f[sy0:sy0 + h, sx0:sx0 + w]
        return out, note

    def compose(self, snap, region=(0, 540, 1920, 720), s=1, per_layer=True):
        """-> dict(alpha, prem (premultiplied rgb), layers=[{key, kind, alpha, rgb?, note}], order)."""
        x0, y0, x1, y1 = region
        W, H = int((x1 - x0) * s), int((y1 - y0) * s)
        A = np.zeros((H, W), np.float32)
        P = np.zeros((H, W, 3), np.float32)
        out = []
        for l in snap.drawn():
            if l['x'] >= x1 or l['y'] >= y1 or l['x'] + l['w'] <= x0 or l['y'] + l['h'] <= y0:
                continue
            if l['kind'] == 'effect':
                rgba, note = self.effect(snap, l, region, s)
            elif l['kind'] == 'image':
                rgba, note = self.image(snap, l, region, s)
            else:
                rgba, note = None, 'kind %s not drawn by the bench' % l['kind']
            if rgba is None:
                out.append({'key': l['key'], 'kind': l['kind'], 'alpha': None, 'note': note})
                continue
            a = rgba[..., 3] * float(l.get('opacity', 1) if l.get('opacity') is not None else 1)
            P = rgba[..., :3] * a[..., None] + P * (1.0 - a[..., None])
            A = a + A * (1.0 - a)
            ent = {'key': l['key'], 'kind': l['kind'], 'x': l['x'], 'y': l['y'], 'w': l['w'], 'h': l['h'],
                   'z': l['z'], 'class': l['class'], 'note': note}
            if per_layer:
                ent['alpha'] = a
                ent['rgb'] = rgba[..., :3]
            out.append(ent)
        return {'alpha': A, 'prem': P, 'layers': out, 'region': region, 's': s}
