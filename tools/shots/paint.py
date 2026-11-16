"""tools/shots: the render pool. Turns a snapshot (drive.py) into pictures with package O's replay
(tools/strip/O/render.py: the app's real fragment shaders on the Mac's GPU through moderngl, stacked as
bench/page.html stacks them), at scale 1, i.e. the panel's own 1920 x 720 pixels.

Per snapshot it writes, into <pool>/<context>/:
  <hash>-<photo>.png      our layers over the rectified stock photo bake/work/overlay/rect/<photo>.png ("car")
  <hash>.matte.png        our layers over flat green, when we leave any of the panel to BMW ("matte")
  and a 480 x 180 JPEG thumbnail of each (.t.jpg)
<hash> is the image hash of OUR layers alone (premultiplied colour + coverage, 8 bit), with the clock's text box
blanked (the wall clock moves during a run; the clock's presence still counts), so two states that differ only in
the minute fold together and a state identical to its baseline is found as "no visible effect".
"""
import hashlib
import json
import os
import shutil
import sys
import time
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'strip', 'O'))
import render as RD   # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PHOTO_DIR = os.path.join(ROOT, 'bake', 'work', 'overlay', 'rect')
MATTE = np.array([0.0, 1.0, 0.0], np.float32)
# the clock's text boxes (panel px, half-open): wb_comfort / wb_sport / wb_eco row_v0 + row_b0, wb_dials own_clock
CLOCK_BOXES = [(742, 634, 950, 680), (335, 665, 459, 700)]
# a picture gets a matte twin when we leave at least this many panel px less than half covered
MATTE_MIN_PX = 500


class SnapZ(RD.Snapshot):
    def pixels(self, key):
        l = self.by_key[key]
        f = os.path.join(self.dir, 'px', key.replace(':', '_') + '.z')
        if not os.path.exists(f):
            return None
        raw = np.frombuffer(zlib.decompress(open(f, 'rb').read()), dtype=np.uint8)
        return raw.reshape(l['ih'], l['iw'], 4)


class Painter(RD.Renderer):
    def __init__(self):
        super().__init__()
        self.photos = {}

    def texture(self, snap, key):
        # cache by content: the same asset in many snapshots is uploaded once
        sha = snap.meta.get('px_sha1', {}).get(key)
        ck = sha or (snap.dir, key)
        if ck not in self.texcache:
            if len(self.texcache) > 160:
                for t in self.texcache.values():
                    t.release()
                self.texcache.clear()
            px = snap.pixels(key)
            if px is None:
                return None
            px = RD.canvas_roundtrip(px)
            t = self.ctx.texture((px.shape[1], px.shape[0]), 4, np.ascontiguousarray(px).tobytes())
            t.filter = (self.mgl.LINEAR, self.mgl.LINEAR)
            t.repeat_x = False
            t.repeat_y = False
            self.texcache[ck] = t
        return self.texcache[ck]

    def photo(self, pid):
        if pid not in self.photos:
            from PIL import Image
            im = Image.open(os.path.join(PHOTO_DIR, pid + '.png')).convert('RGB')
            self.photos[pid] = np.asarray(im).astype(np.float32) / 255.0
        return self.photos[pid]


def our_hash(A, P):
    a8 = np.round(np.clip(A, 0, 1) * 255).astype(np.uint8)
    p8 = np.round(np.clip(P, 0, 1) * 255).astype(np.uint8)
    ink = []
    for x0, y0, x1, y1 in CLOCK_BOXES:
        ink.append(int(a8[y0:y1, x0:x1].astype(np.int64).sum() > 2000))
        a8[y0:y1, x0:x1] = 0
        p8[y0:y1, x0:x1] = 0
    h = hashlib.sha1()
    h.update(a8.tobytes())
    h.update(p8.tobytes())
    h.update(bytes(ink))
    return h.hexdigest()[:16]


def save(arr, path, thumb):
    from PIL import Image
    im = Image.fromarray(np.round(np.clip(arr, 0, 1) * 255).astype(np.uint8), 'RGB')
    # two workers may draw the same picture at once (two states, one hash): each writes its own temp file
    tmp = '%s.%d.tmp.png' % (path, os.getpid())
    im.save(tmp, compress_level=6)
    os.replace(tmp, path)
    t = im.resize((480, 180), Image.LANCZOS)
    tt = '%s.%d.tmp.jpg' % (thumb, os.getpid())
    t.save(tt, quality=82)
    os.replace(tt, thumb)


def paint_one(P, item, pool, keep):
    t0 = time.time()
    S = SnapZ(item['snap'])
    out = P.compose(S, (0, 0, 1920, 720), 1, per_layer=True)
    A, prem = out['alpha'], out['prem']
    notes = [{'key': l['key'], 'kind': l['kind'], 'note': l['note']} for l in out['layers'] if l.get('note')]
    # page.html also scales and rotates a layer about its pivot (sx, sy, rotate); render.py does not: say so if used
    for l in S.drawn():
        if l.get('sx') not in (None, 1) or l.get('sy') not in (None, 1) or l.get('rotate') not in (None, 0):
            notes.append({'key': l['key'], 'kind': l['kind'], 'note': 'scale/rotate %s,%s,%s not modelled by the replay' % (l.get('sx'), l.get('sy'), l.get('rotate'))})
    hid = our_hash(A, prem)
    d = os.path.join(pool, item['context'])
    os.makedirs(d, exist_ok=True)
    pid = item['backdrop']
    car = os.path.join(d, '%s-%s.png' % (hid, pid))
    if not os.path.exists(car):
        img = prem + P.photo(pid) * (1.0 - A[..., None])
        save(img, car, car[:-4] + '.t.jpg')
    open_px = int((A < 0.5).sum())
    matte = None
    if open_px >= MATTE_MIN_PX:
        matte = os.path.join(d, '%s.matte.png' % hid)
        if not os.path.exists(matte):
            img = prem + MATTE[None, None, :] * (1.0 - A[..., None])
            save(img, matte, matte[:-4] + '.t.jpg')
    # what our layers cover, by band (for the index and the report)
    res = {'id': item['id'], 'hash': hid, 'backdrop': pid, 'car': os.path.relpath(car, pool),
           'matte': os.path.relpath(matte, pool) if matte else None, 'open_px': open_px,
           'coverage': round(float(A.mean()), 4), 'strip_coverage': round(float(A[540:].mean()), 4),
           'layers_drawn': len([l for l in out['layers'] if l.get('alpha') is not None]),
           'render_notes': notes, 'render_secs': round(time.time() - t0, 2)}
    if keep:
        np.savez_compressed(os.path.join(item['snap'], 'ours.npz'), alpha=A.astype(np.float16), prem=prem.astype(np.float16))
    else:
        shutil.rmtree(item['snap'], ignore_errors=True)
    return res


def worker(inq, outq, pool, keep_ids):
    P = Painter()
    while True:
        item = inq.get()
        if item is None:
            break
        try:
            r = paint_one(P, item, pool, item['id'] in keep_ids)
        except Exception as e:     # a snapshot that cannot be drawn is reported, not guessed round
            r = {'id': item['id'], 'error': repr(e)}
        outq.put(r)
    outq.put({'worker_done': True})


if __name__ == '__main__':
    # one snapshot by hand: python -I paint.py <snap dir> <context> <photo> <pool>
    P = Painter()
    meta = json.load(open(os.path.join(sys.argv[1], 'scene.json')))
    print(json.dumps(paint_one(P, {'snap': sys.argv[1], 'id': meta['job'], 'context': sys.argv[2], 'backdrop': sys.argv[3]},
                               sys.argv[4], True), indent=1))
