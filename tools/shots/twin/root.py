"""tools/shots/twin: a bench's own tree, so several benches (and the tests) can build into their own dist/ at once.

    python3 tools/shots/twin/root.py <dir> [--standin | --real]        prints <dir>/root

A real bench/ copy (node resolves server.js's __dirname to it, so ROOT and dist/ are its own), with shared/ and kit/
linked from the checkout and an apps/ folder that links every app of the checkout. apps/twin_dial is the checkout's
own when it exists (--real, the default then) or the bench stand-in tools/shots/twin/standin/twin_dial (--standin,
and the default while the checkout has no twin_dial). A stub oap-sdk marked BENCH_STUB is written (never ship a build
made with it). Standard library only.
"""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
STANDIN = os.environ.get('TWIN_STANDIN_DIR') or os.path.join(HERE, 'standin', 'twin_dial')      # TWIN_STANDIN_DIR: a patched copy (a test)


def scene_dir():
    """Where A2's baked faces and panel mask are: the checkout's apps/twin_dial/hud/scene, else A2's published copy."""
    for d in (os.path.join(ROOT, 'apps', 'twin_dial', 'hud', 'scene'), os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'pub', 'R2', 'A2')):
        if os.path.isfile(os.path.join(d, 'face_tacho.json')):
            return d
    return None


def has_real():
    return os.path.isfile(os.path.join(ROOT, 'apps', 'twin_dial', 'app.json'))


def make_root(work, mode=None):
    """-> (root dir, which app: 'real' | 'standin')."""
    mode = mode or ('real' if has_real() else 'standin')
    if mode == 'real' and not has_real():
        raise SystemExit('no apps/twin_dial in this checkout (use --standin)')
    r = os.path.join(work, 'root')
    if os.path.exists(r):
        shutil.rmtree(r)
    os.makedirs(r)
    shutil.copytree(os.path.join(ROOT, 'bench'), os.path.join(r, 'bench'), ignore=shutil.ignore_patterns('.data'))
    for d in ('shared', 'kit'):
        os.symlink(os.path.join(ROOT, d), os.path.join(r, d))
    apps = os.path.join(r, 'apps')
    os.makedirs(apps)
    for a in os.listdir(os.path.join(ROOT, 'apps')):
        if a != 'twin_dial' and os.path.isdir(os.path.join(ROOT, 'apps', a)):
            os.symlink(os.path.join(ROOT, 'apps', a), os.path.join(apps, a))
    os.symlink(os.path.join(ROOT, 'apps', 'twin_dial') if mode == 'real' else STANDIN, os.path.join(apps, 'twin_dial'))
    sdk = os.path.join(r, 'oap-sdk')
    os.makedirs(sdk)
    open(os.path.join(sdk, 'index.js'), 'w').write("'use strict';\n// BENCH_STUB: stands in for BMW's oap-sdk so kit/tools/build.py runs on the Mac. Never ship this.\nthrow new Error('BENCH_STUB oap-sdk');\n")
    open(os.path.join(sdk, 'package.json'), 'w').write(json.dumps({'name': 'oap-sdk', 'version': '0.0.0-bench-stub', 'main': 'index.js'}) + '\n')
    return r, mode


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    mode = 'standin' if '--standin' in sys.argv else 'real' if '--real' in sys.argv else None
    os.makedirs(args[0], exist_ok=True)
    root, which = make_root(os.path.abspath(args[0]), mode)
    print(root)
    sys.stderr.write('twin_dial: %s\n' % which)
