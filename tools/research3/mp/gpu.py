"""Research round 3, package MP: the GPU cost of each layer of a settled layout, on the Mac's GPU, with no browser.

    UV_CACHE_DIR=$F30/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl \\
        python -I tools/research3/mp/gpu.py <snapshot dir>... [--draws 60] [--reps 5] [--out <file.json>]

A snapshot is what tools/research3/mp/measure.js --snap writes (tools/strip/O/snap.py's format: scene.json with every
layer, its compiled fragment shader, its live uniforms and bindings, and px/<conn>_<ref>.raw). Each effect layer runs its
REAL fragment shader through tools/strip/O/render.py's GLSL ES -> 4.10 shim and its texture rules, drawn over its whole
rect into an offscreen target of the layer's size, blended as the compositor draws it, `draws` times back to back; the
time is the median of `reps` repetitions (ctx.finish() around each batch). For each layer the same rect is also drawn
with a one-line shader (the fill floor) and, for image layers, with a one-texture-read shader (an image layer's cost in
the compositor). Also per layer: the share of its rect that comes out transparent (alpha < 1/255: fill spent on nothing).

What transfers to the car: the ratios (layer against layer, app against app, each against its fill floor). What does
not: the milliseconds (an Apple M1 Max, not the KOMBI's GPU; fp32, not the car's fp16 mediump).
"""
import json
import os
import statistics
import sys
import time

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'strip', 'O'))
import render as RD  # noqa: E402

FLOOR = 'precision mediump float;\nvarying vec2 v_uv;\nvoid main(){ gl_FragColor = vec4(v_uv, 0.0, 0.5); }\n'
TEXFLOOR = 'precision mediump float;\nvarying vec2 v_uv;\nuniform sampler2D u_img;\nvoid main(){ gl_FragColor = texture2D(u_img, v_uv); }\n'


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def set_uniforms(R, snap, prog, l, extra_tex=None):
    """render.py's Renderer.effect uniform rules (arrays by base name, whole elements, samplers from the bindings)."""
    unit = 0
    for name in prog:
        m = prog[name]
        if not isinstance(m, R.mgl.Uniform):
            continue
        if m.gl_type == 0x8B5E:
            tex = extra_tex if extra_tex is not None else None
            if tex is None:
                key = (l.get('binds') or {}).get(name)
                tex = R.texture(snap, key) if key else None
            if tex is None:
                return 'sampler %s has no asset bound' % name
            tex.use(unit)
            m.value = unit
            unit += 1
            continue
        base = name[:-3] if name.endswith('[0]') else name
        ent = (l.get('uniforms') or {}).get(base) or (l.get('uniforms') or {}).get(name)
        v = ent['v'] if ent else None
        if base == 'u_time' and l.get('time'):
            v = [1.0]
        if not v:
            continue
        width = {0x1406: 1, 0x8B50: 2, 0x8B51: 3, 0x8B52: 4, 0x8B5C: 16}.get(m.gl_type)
        if not width:
            continue
        count = min(m.array_length, len(v) // width)
        if count < 1:
            continue
        vals = [float(a) for a in v[:count * width]]
        if m.array_length > 1:
            vals = vals + [0.0] * ((m.array_length - count) * width)
            m.value = [tuple(vals[i * width:(i + 1) * width]) if width > 1 else vals[i] for i in range(m.array_length)]
        else:
            m.value = tuple(vals) if width > 1 else vals[0]
    return None


def timed(R, snap, l, fs, draws, reps, tex=None, read=False):
    prog, err = R.program(fs)
    if prog is None:
        return None, 'does not compile: ' + err.splitlines()[0][:160], None
    w, h = int(l['w']), int(l['h'])
    t = R.ctx.texture((w, h), 4)
    fbo = R.ctx.framebuffer(color_attachments=[t])
    fbo.use()
    R.ctx.viewport = (0, 0, w, h)
    why = set_uniforms(R, snap, prog, l, tex)
    if why:
        fbo.release(); t.release()
        return None, why, None
    if 'o_uvA_' in prog:
        prog['o_uvA_'].value = (0.0, 0.0)
        prog['o_uvB_'].value = (1.0, 1.0)
    vao = R.ctx.vertex_array(prog, [(R.quad, '2f', 'a_pos')])
    R.ctx.enable(R.mgl.BLEND)
    R.ctx.blend_func = R.mgl.SRC_ALPHA, R.mgl.ONE_MINUS_SRC_ALPHA
    clear_ratio = None
    if read:
        fbo.clear(0.0, 0.0, 0.0, 0.0)
        R.ctx.disable(R.mgl.BLEND)
        vao.render(R.mgl.TRIANGLE_STRIP)
        a = np.frombuffer(fbo.read(components=4), dtype=np.uint8).reshape(h, w, 4)[..., 3]
        clear_ratio = float((a == 0).mean())
        R.ctx.enable(R.mgl.BLEND)
    vao.render(R.mgl.TRIANGLE_STRIP)
    R.ctx.finish()
    out = []
    for _ in range(reps):
        t0 = time.perf_counter()
        for _ in range(draws):
            vao.render(R.mgl.TRIANGLE_STRIP)
        R.ctx.finish()
        out.append((time.perf_counter() - t0) * 1000.0 / draws)
    R.ctx.disable(R.mgl.BLEND)
    vao.release(); fbo.release(); t.release()
    return statistics.median(out), None, clear_ratio


def main():
    dirs = [a for a in sys.argv[1:] if not a.startswith('--') and os.path.exists(os.path.join(a, 'scene.json'))]
    draws, reps = int(arg('--draws', '60')), int(arg('--reps', '5'))
    R = RD.Renderer()
    renderer = R.ctx.info.get('GL_RENDERER')
    res = {'renderer': renderer, 'draws': draws, 'reps': reps, 'snapshots': []}
    for d in dirs:
        snap = RD.Snapshot(d)
        rows = []
        for l in snap.drawn():
            if l['kind'] not in ('effect', 'image') or not l.get('w') or not l.get('h'):
                continue
            row = {'key': l['key'], 'kind': l['kind'], 'x': l['x'], 'y': l['y'], 'w': l['w'], 'h': l['h'], 'px': l['w'] * l['h']}
            if l['kind'] == 'effect':
                ms, why, clear = timed(R, snap, l, l['fs'], draws, reps, read=True)
                row.update({'ms': ms, 'note': why, 'transparent': clear, 'fsBytes': len(l['fs'].encode())})
                row['floor'], _, _ = timed(R, snap, l, FLOOR, draws, reps)
            else:
                tex = R.texture(snap, l['key'])
                row['ms'], row['note'], _ = timed(R, snap, l, TEXFLOOR, draws, reps, tex=tex)
                px = snap.pixels(l['key'])
                row['transparent'] = float((px[..., 3] == 0).mean()) if px is not None else None
                row['floor'], _, _ = timed(R, snap, l, FLOOR, draws, reps)
            rows.append(row)
        tot = sum(r['ms'] or 0 for r in rows)
        res['snapshots'].append({'dir': os.path.relpath(d, ROOT), 'label': snap.meta.get('label'), 'rows': rows, 'totalMs': tot,
                                 'effectPx': sum(r['px'] for r in rows if r['kind'] == 'effect'),
                                 'imagePx': sum(r['px'] for r in rows if r['kind'] == 'image')})
        print('%s: %d layers, %.3f ms a frame (%s), effect px %d, image px %d' % (snap.meta.get('label'), len(rows), tot, renderer,
              res['snapshots'][-1]['effectPx'], res['snapshots'][-1]['imagePx']))
        for r in sorted(rows, key=lambda r: -(r['ms'] or 0)):
            print('   %-6s %-7s %4dx%-4d %8s ms  floor %7.4f  x%5.1f  transparent %5s  %s' % (
                r['kind'], r['key'], r['w'], r['h'], '%.4f' % r['ms'] if r['ms'] is not None else '-', r['floor'] or 0,
                (r['ms'] or 0) / r['floor'] if r['floor'] else 0, '%.0f%%' % (100 * r['transparent']) if r['transparent'] is not None else '-', r.get('note') or ''))
    out = arg('--out')
    if out:
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        json.dump(res, open(out, 'w'), indent=1)
        print('written', out)


if __name__ == '__main__':
    main()
