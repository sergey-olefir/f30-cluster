#!/usr/bin/env python3
"""KC (round 3b): runs a mockup generator (K2's pages.py, KA's / KB's scripts) unchanged in a scratch copy of the tree
and records, for every 1920 x 720 PNG it saves, the ink boxes of our text and icons (panel px). The recording is done by
hooks on Pillow (ImageDraw.text, Image.paste, Image.copy / resize / convert / crop, Image.save), so the generators need no
change and their published pictures are never touched: the scratch tree symlinks everything except bake/work/twin-dial/mockup.

    python -I tools/twin-dial/mockup/inkrec_r3b.py <worktree> <script relative to the worktree> <out.json> [-- script args]

<out.json>: {"<picture path relative to bake/work/twin-dial/mockup/>": [{"kind": "text"|"icon", "box": [x0, y0, x1, y1],
"text": ..., "size": ..., "fill": ..., "tag": ...}, ...]}. A picture's list is what was drawn on the image it came from:
the dials cached in a base image are carried through every copy / resize.
"""
import atexit
import json
import os
import runpy
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT_MAIN = os.path.abspath(os.path.join(HERE, '..', '..', '..'))


def scratch_root(worktree, scratch):
    """A tree that looks like the worktree to a script that derives ROOT from its own path: every top-level entry is a
    symlink to the worktree's, except bake/work/twin-dial/mockup, which is a real (empty) folder."""
    os.makedirs(scratch, exist_ok=True)
    for name in os.listdir(worktree):
        if name in ('bake', '.git', '.claude'):
            continue
        dst = os.path.join(scratch, name)
        if not os.path.lexists(dst):
            os.symlink(os.path.join(worktree, name), dst)
    work = os.path.join(worktree, 'bake', 'work')
    real_work = os.path.realpath(work)
    sb = os.path.join(scratch, 'bake')
    os.makedirs(sb, exist_ok=True)
    for name in os.listdir(os.path.join(worktree, 'bake')):
        if name != 'work':
            dst = os.path.join(sb, name)
            if not os.path.lexists(dst):
                os.symlink(os.path.join(worktree, 'bake', name), dst)
    sw = os.path.join(sb, 'work')
    os.makedirs(sw, exist_ok=True)
    for name in os.listdir(real_work):
        if name == 'twin-dial':
            continue
        dst = os.path.join(sw, name)
        if not os.path.lexists(dst):
            os.symlink(os.path.join(real_work, name), dst)
    std = os.path.join(sw, 'twin-dial')
    os.makedirs(std, exist_ok=True)
    for name in os.listdir(os.path.join(real_work, 'twin-dial')):
        dst = os.path.join(std, name)
        if name == 'mockup':
            os.makedirs(dst, exist_ok=True)
        elif not os.path.lexists(dst):
            os.symlink(os.path.join(real_work, 'twin-dial', name), dst)
    return scratch


def install(out_json, mockup_dir):
    from PIL import Image, ImageDraw
    rec = {}

    def lst(img):
        l = getattr(img, '_kc_ink', None)
        if l is None:
            l = []
            try:
                img._kc_ink = l
            except Exception:
                pass
        return l

    def carry(src, dst):
        if dst is not src and isinstance(dst, Image.Image):
            dst._kc_ink = list(getattr(src, '_kc_ink', []))
        return dst

    o_init = ImageDraw.ImageDraw.__init__

    def init(self, im, mode=None):
        o_init(self, im, mode)
        self._kc_img = im
    ImageDraw.ImageDraw.__init__ = init

    o_text = ImageDraw.ImageDraw.text

    def text(self, xy, text, fill=None, font=None, anchor=None, *a, **kw):
        r = o_text(self, xy, text, fill, font, anchor, *a, **kw)
        try:
            img = self._kc_img
            s = img.size[0] / 1920.0
            b = self.textbbox(xy, text, font=font, anchor=anchor)
            lst(img).append(dict(kind='text', text=text, box=[round(v / s, 2) for v in b],
                                 size=round(getattr(font, 'size', 0) / s, 1), fill=list(fill) if isinstance(fill, tuple) else fill))
        except Exception as e:
            print('inkrec: text not recorded', repr(text), e)
        return r
    ImageDraw.ImageDraw.text = text

    o_paste = Image.Image.paste

    def paste(self, im, box=None, mask=None):
        r = o_paste(self, im, box, mask)
        try:
            if isinstance(im, Image.Image) and im.mode == 'RGBA' and self.size == (1920, 720) and isinstance(box, tuple) and len(box) == 2:
                bb = im.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
                if bb:
                    lst(self).append(dict(kind='icon', box=[box[0] + bb[0], box[1] + bb[1], box[0] + bb[2], box[1] + bb[3]]))
        except Exception as e:
            print('inkrec: paste not recorded', e)
        return r
    Image.Image.paste = paste

    for name in ('copy', 'resize', 'convert', 'crop'):
        def wrap(orig, name=name):
            def f(self, *a, **kw):
                out = orig(self, *a, **kw)
                if name == 'crop':                 # not a whole picture: ink is not carried
                    return out
                return carry(self, out)
            return f
        setattr(Image.Image, name, wrap(getattr(Image.Image, name)))

    o_save = Image.Image.save

    def save(self, fp, *a, **kw):
        r = o_save(self, fp, *a, **kw)
        try:
            if isinstance(fp, str) and fp.endswith('.png') and self.size == (1920, 720):
                p = os.path.abspath(fp)
                if p.startswith(mockup_dir):
                    rec[os.path.relpath(p, mockup_dir)] = list(getattr(self, '_kc_ink', []))
        except Exception as e:
            print('inkrec: save not recorded', e)
        return r
    Image.Image.save = save

    def dump():
        with open(out_json, 'w') as f:
            json.dump(rec, f)
        print('inkrec: %d pictures recorded -> %s' % (len(rec), out_json))
    atexit.register(dump)


def main():
    args = sys.argv[1:]
    if '--' in args:
        i = args.index('--')
        extra = args[i + 1:]
        args = args[:i]
    else:
        extra = []
    worktree, script, out_json = args[0], args[1], args[2]
    scratch = os.environ.get('KC_SCRATCH') or os.path.join(os.path.dirname(os.path.abspath(out_json)), 'scratch_' + os.path.basename(worktree))
    scratch_root(worktree, scratch)
    mockup_dir = os.path.join(scratch, 'bake', 'work', 'twin-dial', 'mockup') + os.sep
    install(os.path.abspath(out_json), mockup_dir[:-1] + os.sep)
    target = os.path.join(scratch, script)
    sys.argv = [target] + extra
    sys.path.insert(0, os.path.dirname(target))
    runpy.run_path(target, run_name='__main__')


if __name__ == '__main__':
    main()
