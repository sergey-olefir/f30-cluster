"""Package O, brief item 6: the pixel-memory and layer PEAK while the strip's states switch (the brief: the peak during a
layout switch is what breaks). Streams GET /events while it flips bottomRow, makes the info field ours (a message),
latches it, and goes to P + rpm 0, and records the largest 'pixels' and layer count of any scene message.

    python3 tools/strip/O/peak.py     (BENCH_PORT, default 8161; the bench on wb_dials)
"""
import json
import os
import socket
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import benchio as B   # noqa: E402

rec = []
stop = False


def reader():
    s = socket.create_connection((B.HOST, B.PORT), timeout=1)
    s.sendall(b'GET /events HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n')
    buf = b''
    s.settimeout(0.3)
    while not stop:
        try:
            d = s.recv(1 << 20)
        except socket.timeout:
            continue
        if not d:
            break
        buf += d
        while b'\n\n' in buf:
            ev, buf = buf.split(b'\n\n', 1)
            i = ev.find(b'data: {"t":"scene"')     # the response is chunked: a chunk-size line precedes each event
            if i < 0:
                continue
            try:
                o = json.loads(ev[i + 6:])
            except ValueError:
                continue
            per = {}
            for l in o['layers']:
                if l['kind'] != 'asset':
                    c = l['key'].split(':')[0]
                    per[c] = per.get(c, 0) + 1
            rec.append((time.time(), o.get('pixels') or 0, sum(per.values()), max(per.values()) if per else 0,
                        sum(1 for l in o['layers'] if l['kind'] == 'asset')))
    s.close()


def mark(label):
    rec.append((time.time(), label))


def main():
    global stop
    t = threading.Thread(target=reader, daemon=True)
    t.start()
    time.sleep(2)
    steps = [('allG20', lambda: B.set_choice('bottomRow', 'allG20')),
             ('all6WB', lambda: B.set_choice('bottomRow', 'all6WB')),
             ('msg (info ours)', lambda: B.scene_name('cc-red')),
             ('clock ours', lambda: B.scene_name('clock-plus2')),
             ('cc-clear', lambda: B.scene_name('cc-clear')),
             ('P rpm 0', lambda: B.signals({'rpm': 0, 'speed': 0, 'gear': 0})),
             ('D', lambda: B.signals({'rpm': 1500, 'speed': 50, 'gear': 3})),
             ('allG20 again', lambda: B.set_choice('bottomRow', 'allG20')),
             ('all6WB again', lambda: B.set_choice('bottomRow', 'all6WB')),
             ('g20 off (opaque Comfort)', lambda: B.click('SET_G20')),
             ('g20 on (Comfort + G20)', lambda: B.click('SET_G20'))]
    for name, fn in steps:
        mark(name)
        fn()
        time.sleep(4)
    stop = True
    t.join(3)
    seg, cur = {}, 'start'
    for r in rec:
        if isinstance(r[1], str):
            cur = r[1]
            continue
        s = seg.setdefault(cur, [0, 0, 0, 0])
        s[0] = max(s[0], r[1]); s[1] = max(s[1], r[2]); s[2] = max(s[2], r[3]); s[3] = max(s[3], r[4])
    out = {k: {'pixel_peak_mib': round(v[0] / 1048576.0, 3), 'layers_peak': v[1], 'per_conn_peak': v[2], 'assets_peak': v[3]} for k, v in seg.items()}
    print(json.dumps(out, indent=1))
    B.scene_name('clock-none')


if __name__ == '__main__':
    main()
