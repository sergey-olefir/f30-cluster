"""Package O (docs/AGENT-BRIEF-strip.md): talk to a running bench (bench/server.js) with no browser.

Everything here is read off the engine's own output: GET /events (the scene: every layer, its compiled fragment
shader and the live value of every uniform), GET /px (an image layer's or an asset's current pixels), GET /probe
(the app's own state). Writes go only through the bench's own steering endpoints (/click, /fake, /signals,
/restart), the same ones bench/test-bottom-row.js uses.

Standard library only, so it runs under the uv/numpy convention and under bare python3 alike.
"""
import http.client
import json
import os
import socket
import time

PORT = int(os.environ.get('BENCH_PORT', '8161'))
HOST = '127.0.0.1'


def _req(method, path, body=None, timeout=10.0):
    c = http.client.HTTPConnection(HOST, PORT, timeout=timeout)
    data = json.dumps(body).encode() if body is not None else None
    hdr = {'content-type': 'application/json', 'connection': 'close'} if data is not None else {'connection': 'close'}
    c.request(method, path, body=data, headers=hdr)
    r = c.getresponse()
    raw = r.read()
    c.close()
    return r.status, raw


def get_json(path):
    st, raw = _req('GET', path)
    if st != 200:
        raise RuntimeError('GET %s -> %d' % (path, st))
    return json.loads(raw.decode('utf8'))


def post(path, body):
    for i in range(8):
        try:
            st, raw = _req('POST', path, body)
            if st in (200, 204):
                return
            raise RuntimeError('POST %s -> %d %r' % (path, st, raw[:200]))
        except (ConnectionError, OSError, RuntimeError):
            if i == 7:
                raise
            time.sleep(0.4)


def probe():
    return get_json('/probe')


def probe_safe():
    try:
        return probe()
    except Exception:
        return None


def until(fn, secs=10.0, step=0.15):
    end = time.time() + secs
    p = None
    while time.time() < end:
        p = probe_safe()
        try:
            if p and fn(p):
                return p
        except Exception:
            pass
        time.sleep(step)
    return p


_APP = None


def _app():
    global _APP
    if _APP is None:
        here = os.path.dirname(os.path.abspath(__file__))
        _APP = json.load(open(os.path.join(here, '..', '..', '..', 'apps', 'f30_cluster', 'app.json')))
    return _APP


def opts(key):
    it = [s for s in _app()['settings'] if s['key'] == key][0]
    return [o[0] for o in it.get('options', [])]


def click(cid, row=None):
    post('/click', {'id': cid} if row is None else {'id': cid, 'row': row})


def set_choice(key, value):
    click('SET_' + key.upper(), opts(key).index(value))


def fake(v):
    post('/fake', v)


def scene_name(s):
    fake({'scene': s})


def signals(values, mode='manual'):
    post('/signals', {'mode': mode, 'values': values})


def restart():
    post('/restart', {})


def events(secs=2.5):
    """Raw text of GET /events for `secs` seconds (the server replays hello, log, scene and px notices first)."""
    s = socket.create_connection((HOST, PORT), timeout=secs)
    s.sendall(('GET /events HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n').encode())
    buf = bytearray()
    end = time.time() + secs
    s.settimeout(0.25)
    while time.time() < end:
        try:
            d = s.recv(1 << 20)
            if not d:
                break
            buf += d
        except socket.timeout:
            continue
    s.close()
    return buf.decode('utf8', 'replace')


def last_scene(txt):
    sc = None
    for line in txt.split('\n'):
        if line.startswith('data: '):
            try:
                o = json.loads(line[6:])
            except ValueError:
                continue
            if o.get('t') == 'scene':
                sc = o
    return sc


def scene(secs=2.5):
    return last_scene(events(secs))


def px(key, x, y, w, h):
    st, raw = _req('GET', '/px?key=%s&x=%d&y=%d&w=%d&h=%d' % (key, x, y, w, h), timeout=20.0)
    if st != 200:
        return None
    return raw
