"""tools/shots: a client for one running bench (bench/server.js), by port, so several benches can be driven at once.

The same endpoints package O's tools/strip/O/benchio.py uses (GET /probe, /events, /px; POST /signals, /fake, /drive,
/click, /restart), with the port held per object instead of in the module, and a faster scene read: GET /events sends
the full scene first, so the read stops at that line instead of listening for a fixed 2.5 s.
Standard library only.
"""
import http.client
import json
import socket
import time

HOST = '127.0.0.1'


class Bench:
    def __init__(self, port, app_json):
        self.port = port
        self.app = app_json

    # ---- HTTP ----
    def _req(self, method, path, body=None, timeout=10.0):
        c = http.client.HTTPConnection(HOST, self.port, timeout=timeout)
        data = json.dumps(body).encode() if body is not None else None
        hdr = {'content-type': 'application/json', 'connection': 'close'} if data is not None else {'connection': 'close'}
        c.request(method, path, body=data, headers=hdr)
        r = c.getresponse()
        raw = r.read()
        c.close()
        return r.status, raw

    def post(self, path, body):
        last = None
        for i in range(10):
            try:
                st, raw = self._req('POST', path, body)
                if st in (200, 204):
                    return
                last = 'POST %s -> %d %r' % (path, st, raw[:200])
            except (ConnectionError, OSError) as e:
                last = 'POST %s: %s' % (path, e)
            time.sleep(0.5)
        raise RuntimeError(last)

    def probe(self):
        try:
            st, raw = self._req('GET', '/probe', timeout=6.0)
            if st != 200:
                return None
            return json.loads(raw.decode('utf8'))
        except Exception:
            return None

    def until(self, fn, secs=10.0, step=0.15):
        """Poll /probe until fn(probe) is true; -> (ok, last probe)."""
        end = time.time() + secs
        p = None
        while True:
            q = self.probe()
            if q is not None:
                p = q
                try:
                    if fn(q):
                        return True, q
                except Exception:
                    pass
            if time.time() > end:
                return False, p
            time.sleep(step)

    # ---- steering ----
    def opts(self, key):
        it = [s for s in self.app['settings'] if s['key'] == key][0]
        return it

    def set(self, key, value, cur):
        """Press a setting on the stub's RHMI as the car's HMI does (a checkbox toggles, a drop-down picks a row)."""
        s = self.opts(key)
        if cur.get(key) == value:
            return False
        if s['type'] == 'bool':
            self.post('/click', {'id': 'SET_' + key.upper()})
        else:
            rows = [o[0] for o in s['options']] if s['type'] == 'choice' else s['steps']
            self.post('/click', {'id': 'SET_' + key.upper(), 'row': rows.index(value)})
        return True

    def signals(self, values):
        self.post('/signals', {'mode': 'manual', 'values': values})

    def drive(self, v):
        self.post('/drive', {'value': v})

    def fake(self, v):
        self.post('/fake', v)

    def restart(self):
        self.post('/restart', {})

    # ---- the scene ----
    def scene(self, secs=8.0):
        """The full scene message GET /events sends first (every layer, shader, uniform, binding), or None."""
        s = socket.create_connection((HOST, self.port), timeout=secs)
        s.sendall(b'GET /events HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
        buf = bytearray()
        end = time.time() + secs
        s.settimeout(0.5)
        found = None
        pos = 0
        try:
            while time.time() < end and found is None:
                try:
                    d = s.recv(1 << 20)
                except socket.timeout:
                    continue
                if not d:
                    break
                buf += d
                while True:
                    i = buf.find(b'\n', pos)
                    if i < 0:
                        break
                    line = bytes(buf[pos:i])
                    pos = i + 1
                    if line.startswith(b'data: {"t":"scene"'):
                        found = json.loads(line[6:].decode('utf8'))
                        break
        finally:
            s.close()
        return found

    def px(self, key, w, h):
        st, raw = self._req('GET', '/px?key=%s&x=0&y=0&w=%d&h=%d' % (key, w, h), timeout=20.0)
        return raw if st == 200 else None
