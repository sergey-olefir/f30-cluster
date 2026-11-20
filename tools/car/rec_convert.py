#!/usr/bin/env python3
"""Signal Probe recordings -> one table per drive, and a report of every field's native rate (cruise RC, Phase 0).

    python3 tools/car/rec_convert.py <rec files or folders ...> -o <out folder> [--resample MS] [--max-age MS] [--parquet]

The input is what shared/signal_recorder.js (Signal Probe's recorder; the RV recorder's too) writes in the app's data/rec/ (format #rec 1): rec-<session>-<n>.csv.gz (or .csv),
gzip members one per flush, so a file cut by a crash is read up to its last whole member. One recording (a "session", one press of
"Запис" to its stop) becomes one drive:

    <out>/<session>/fields/<tag>.csv   every sample of one field: t_ms, seq, ctr, pts, and its own columns (enum names as names)
    <out>/<session>/drive.csv          all fields in one table: one row per sample time, a column per <tag>.<column> (sparse);
                                       with --resample MS a common clock every MS ms instead, each column the last value no older
                                       than --max-age MS (default 3 x MS, then empty)
    <out>/<session>/drive.parquet      the same table, with --parquet when pandas (and a parquet engine) is installed
    <out>/<session>/markers.csv        the owner's marks: t_ms, n
    <out>/<session>/report.md|.json    per field: samples, span, native rate (from the median interval), mean rate, jitter (the
                                       spread of the intervals), gaps (an interval over 3 x the median), the longest gap, the
                                       recorder's own drops (seq gaps), the car's missed messages (counter jumps), the payload clock's
                                       rate and the spread of receive time minus payload time (the reading path's jitter), the share of
                                       repeated values; per recording the #end line (missing: the app or the head unit stopped)

Plain Python 3 (csv, gzip, zlib, statistics); pandas only for --parquet. Mac only, never shipped.
"""
import argparse
import csv
import gzip
import json
import math
import os
import re
import statistics
import sys
import zlib

FILE_RE = re.compile(r'^rec-(\d{8}-\d{6})-(\d{3})\.csv(\.gz)?$')


def read_text(path):
    """The text of a recording file; a gzip file member by member, a cut last member skipped (returns text, cut?)."""
    with open(path, 'rb') as fh:
        raw = fh.read()
    if not path.endswith('.gz'):
        return raw.decode('utf-8', 'replace'), False
    out, cut = [], False
    while raw:
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)
        try:
            part = d.decompress(raw)
            part += d.flush()
        except zlib.error:
            cut = True
            break
        if not d.eof:
            cut = True
            break
        out.append(part)
        raw = d.unused_data
    text = b''.join(out).decode('utf-8', 'replace')
    return text, cut


class Field:
    def __init__(self, fid, tag, name):
        self.id, self.tag, self.name = fid, tag, name
        self.cols = []            # every column seen, in order (a shape change adds the new ones)
        self.rows = []            # (t, seq, ctr, pts, {col: value})


class Session:
    def __init__(self, sid):
        self.id = sid
        self.fields = {}          # tag -> Field
        self.marks = []
        self.files = []
        self.cut_files = []
        self.end = None
        self.header = None
        self.bad_lines = 0


def num(s):
    if s == '':
        return None
    try:
        return int(s)
    except ValueError:
        try:
            return float(s)
        except ValueError:
            return None


def parse_file(path, sess):
    text, cut = read_text(path)
    sess.files.append(os.path.basename(path))
    if cut:
        sess.cut_files.append(os.path.basename(path))
    by_id = {}                    # field id -> (Field, its columns in this file)
    codes = {}                    # enum code -> name, this file's dictionary
    prev = {}                     # field id -> the values of its line before (for "=")
    lines = text.split('\n')
    if text and not text.endswith('\n'):
        lines = lines[:-1]        # a line cut in the middle
    for line in lines:
        if not line:
            continue
        if line[0] == '#':
            p = line.split(',')
            k = p[0]
            if k == '#rec':
                sess.header = sess.header or {'format': p[1], 'version': p[2], 'session': p[3], 'wall': p[5], 'sets': p[7] if len(p) > 7 else ''}
            elif k == '#f':
                fid, tag, name, cols = p[1], p[2], p[3], p[4:]
                f = sess.fields.get(tag)
                if f is None:
                    f = sess.fields[tag] = Field(fid, tag, name)
                for c in cols:
                    if c not in f.cols:
                        f.cols.append(c)
                by_id[fid] = (f, cols)
                prev.pop(fid, None)
            elif k == '#n':
                codes['@' + p[1]] = p[2]
            elif k == '#m':
                sess.marks.append((num(p[1]), num(p[2])))
            elif k == '#end':
                sess.end = {'t': num(p[1])}
                for kv in p[2:]:
                    if '=' in kv:
                        a, b = kv.split('=', 1)
                        sess.end[a] = num(b)
            continue
        p = line.split(',')
        if len(p) < 6 or p[1] not in by_id:
            sess.bad_lines += 1
            continue
        f, cols = by_id[p[1]]
        if p[5] == '=' and len(p) == 6:
            vals = prev.get(p[1])
            if vals is None:
                sess.bad_lines += 1
                continue
        else:
            raw = p[5:]
            if len(raw) != len(cols):
                sess.bad_lines += 1
                continue
            vals = [codes.get(x, x) if x.startswith('@') else num(x) for x in raw]
            prev[p[1]] = vals
        f.rows.append((num(p[0]), num(p[2]), num(p[3]), p[4], dict(zip(cols, vals))))


def load(inputs):
    paths = []
    for a in inputs:
        if os.path.isdir(a):
            paths += [os.path.join(a, n) for n in sorted(os.listdir(a)) if FILE_RE.match(n)]
        elif FILE_RE.match(os.path.basename(a)):
            paths.append(a)
    sessions = {}
    for path in sorted(paths, key=lambda x: os.path.basename(x)):
        m = FILE_RE.match(os.path.basename(path))
        s = sessions.setdefault(m.group(1), Session(m.group(1)))
        parse_file(path, s)
    return sessions


# ---- the report -----------------------------------------------------------------------------------------------------------------
def pts_seconds(s):
    if not s:
        return None
    try:
        a, b = s.split('.') if '.' in s else (s, '0')
        return int(a) + int(b) / 1e9
    except ValueError:
        return None


def counter_misses(ctrs):
    """Messages the car sent that never arrived, from the payload's counter: jumps over +1, with the wrap guessed from the
    largest value seen (alive counters wrap at 15 or 255, the end-to-end counters at 65535). A repeat (+0) is counted apart."""
    c = [x for x in ctrs if isinstance(x, int)]
    if len(c) < 2:
        return None
    top = max(c)
    mod = 16 if top <= 15 else 256 if top <= 255 else 65536
    if top == 14:
        mod = 15                                   # BMW alive counters 0..14 (15 = invalid)
    missed = repeats = 0
    for a, b in zip(c, c[1:]):
        d = (b - a) % mod
        if d == 0:
            repeats += 1
        elif d > 1 and d < mod // 2:
            missed += d - 1
    return {'modulo': mod, 'missed': missed, 'repeats': repeats}


def field_report(f):
    t = [r[0] for r in f.rows if r[0] is not None]
    rep = {'tag': f.tag, 'member': f.name, 'samples': len(f.rows), 'columns': len(f.cols)}
    if len(t) < 2:
        rep.update({'rate_hz': None, 'note': 'fewer than two samples'})
        return rep
    dt = [b - a for a, b in zip(t, t[1:])]
    med = statistics.median(dt)
    span = (t[-1] - t[0]) / 1000.0
    rep['span_s'] = round(span, 3)
    rep['mean_rate_hz'] = round((len(t) - 1) / span, 3) if span > 0 else None
    rep['median_interval_ms'] = med
    rep['rate_hz'] = round(1000.0 / med, 3) if med > 0 else None
    rep['jitter_ms'] = round(statistics.pstdev(dt), 3)
    s = sorted(dt)
    rep['interval_p5_p95_ms'] = [s[int(0.05 * (len(s) - 1))], s[int(0.95 * (len(s) - 1))]]
    lim = 3 * med if med > 0 else 1000
    gaps = [x for x in dt if x > lim]
    rep['gaps'] = len(gaps)
    rep['longest_gap_ms'] = max(dt)
    seqs = [r[1] for r in f.rows if isinstance(r[1], int)]
    rep['recorder_drops'] = sum(b - a - 1 for a, b in zip(seqs, seqs[1:]) if b > a + 1)
    cm = counter_misses([r[2] for r in f.rows])
    if cm:
        rep['counter'] = cm
    pts = [(r[0], pts_seconds(r[3])) for r in f.rows if pts_seconds(r[3]) is not None]
    if len(pts) >= 2:
        pd = [b[1] - a[1] for a, b in zip(pts, pts[1:])]
        pos = [x for x in pd if x > 0]
        # receive time against payload time: a straight line (offset and clock rate) and the spread around it, which is the
        # jitter the reading path (gateway, SOME/IP, the Node event loop) adds on top of the sender's own clock
        xs, ys = [b for a, b in pts], [a for a, b in pts]
        mx, my = statistics.mean(xs), statistics.mean(ys)
        sxx = sum((x - mx) ** 2 for x in xs)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx > 0 else 0.0
        resid = [y - (my + slope * (x - mx)) for x, y in zip(xs, ys)]
        rep['payload_clock'] = {
            'median_interval_ms': round(statistics.median(pos) * 1000, 3) if pos else None,
            'receive_ms_per_payload_s': round(slope, 3),
            'receive_minus_payload_spread_ms': round(statistics.pstdev(resid), 3),
            'backwards': sum(1 for x in pd if x < 0),
        }
    vals = [tuple(sorted(r[4].items(), key=lambda kv: kv[0])) for r in f.rows]
    rep['repeated_share'] = round(sum(1 for a, b in zip(vals, vals[1:]) if a == b) / max(1, len(vals) - 1), 3)
    return rep


def session_report(s):
    fields = [field_report(f) for f in sorted(s.fields.values(), key=lambda f: f.tag)]
    t_all = [r[0] for f in s.fields.values() for r in f.rows if r[0] is not None]
    return {
        'session': s.id, 'header': s.header, 'files': s.files, 'cut_files': s.cut_files, 'bad_lines': s.bad_lines,
        'end': s.end, 'complete': s.end is not None, 'span_s': round((max(t_all) - min(t_all)) / 1000.0, 3) if t_all else 0,
        'samples': sum(len(f.rows) for f in s.fields.values()), 'marks': s.marks, 'fields': fields,
    }


def report_md(r):
    out = ['# Recording ' + r['session'], '']
    h = r['header'] or {}
    out.append('App ' + str(h.get('version')) + ', sets ' + str(h.get('sets')) + ', started ' + str(h.get('wall')) + ' (head unit clock). ' +
               str(len(r['files'])) + ' file(s), ' + str(r['samples']) + ' samples over ' + str(r['span_s']) + ' s. ' +
               ('Ended with a stop: ' + json.dumps(r['end']) if r['complete'] else '**No #end line: the app or the head unit stopped before the recording was stopped.**') +
               (' Cut files: ' + ', '.join(r['cut_files']) + '.' if r['cut_files'] else '') + (' Unreadable lines: ' + str(r['bad_lines']) + '.' if r['bad_lines'] else ''))
    out.append('')
    if r['marks']:
        out.append('Marks: ' + ', '.join('M%s at %.1f s' % (n, t / 1000.0) for t, n in r['marks'] if t is not None))
        out.append('')
    out.append('| Field | Member | Samples | Native rate Hz (median) | Mean Hz | Jitter ms | p5..p95 ms | Gaps | Longest gap ms | Recorder drops | Counter missed / repeats | Payload clock ms | Receive-payload spread ms | Repeated |')
    out.append('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for f in r['fields']:
        c = f.get('counter') or {}
        pc = f.get('payload_clock') or {}
        out.append('| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
            f['tag'], f['member'], f['samples'], f.get('rate_hz'), f.get('mean_rate_hz'), f.get('jitter_ms'),
            '..'.join(str(x) for x in f.get('interval_p5_p95_ms', [])) or '', f.get('gaps', ''), f.get('longest_gap_ms', ''),
            f.get('recorder_drops', ''), ('%s / %s (mod %s)' % (c['missed'], c['repeats'], c['modulo'])) if c else '',
            pc.get('median_interval_ms', ''), pc.get('receive_minus_payload_spread_ms', ''), f.get('repeated_share', '')))
    out.append('')
    return '\n'.join(out)


# ---- the tables ----------------------------------------------------------------------------------------------------------------
def write_csv(path, header, rows):
    with open(path, 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(header)
        for row in rows:
            w.writerow(['' if v is None else v for v in row])


def drive_columns(s):
    cols = []
    for f in sorted(s.fields.values(), key=lambda f: f.tag):
        cols += [(f, c) for c in f.cols]
    return cols


def drive_sparse(s):
    """One row per distinct sample time; each field's values in its own columns, empty where it did not speak."""
    cols = drive_columns(s)
    idx = {(f.tag, c): i for i, (f, c) in enumerate(cols)}
    rows = {}
    for f in s.fields.values():
        for r in f.rows:
            row = rows.setdefault(r[0], [None] * len(cols))
            for c, v in r[4].items():
                row[idx[(f.tag, c)]] = v
    header = ['t_ms'] + [f.tag + '.' + c for f, c in cols]
    return header, [[t] + rows[t] for t in sorted(k for k in rows if k is not None)]


def drive_resampled(s, step, max_age):
    """A common clock every `step` ms: each column holds the last value no older than `max_age` ms (zero-order hold), else empty."""
    cols = drive_columns(s)
    t_all = [r[0] for f in s.fields.values() for r in f.rows if r[0] is not None]
    if not t_all:
        return ['t_ms'], []
    t0 = int(math.floor(min(t_all) / step) * step)
    t1 = max(t_all)
    series = []
    for f, c in cols:
        series.append([(r[0], r[4].get(c)) for r in f.rows if r[0] is not None and c in r[4]])
    pos = [0] * len(cols)
    out = []
    t = t0
    while t <= t1:
        row = [t]
        for i, ser in enumerate(series):
            while pos[i] < len(ser) and ser[pos[i]][0] <= t:
                pos[i] += 1
            if pos[i] == 0:
                row.append(None)
                continue
            ts, v = ser[pos[i] - 1]
            row.append(v if t - ts <= max_age else None)
        out.append(row)
        t += step
    return ['t_ms'] + [f.tag + '.' + c for f, c in cols], out


def convert(inputs, out_dir, resample=None, max_age=None, parquet=False):
    sessions = load(inputs)
    os.makedirs(out_dir, exist_ok=True)
    reports = []
    for sid, s in sorted(sessions.items()):
        d = os.path.join(out_dir, sid)
        os.makedirs(os.path.join(d, 'fields'), exist_ok=True)
        for f in s.fields.values():
            write_csv(os.path.join(d, 'fields', f.tag + '.csv'), ['t_ms', 'seq', 'ctr', 'pts'] + f.cols,
                      [[r[0], r[1], r[2], r[3]] + [r[4].get(c) for c in f.cols] for r in f.rows])
        if resample:
            header, rows = drive_resampled(s, resample, max_age if max_age else 3 * resample)
        else:
            header, rows = drive_sparse(s)
        write_csv(os.path.join(d, 'drive.csv'), header, rows)
        if parquet:
            try:
                import pandas as pd
                pd.DataFrame(rows, columns=header).to_parquet(os.path.join(d, 'drive.parquet'))
            except Exception as e:      # no pandas or no parquet engine: the CSV is there
                print('  parquet skipped: ' + str(e).split('\n')[0])
        write_csv(os.path.join(d, 'markers.csv'), ['t_ms', 'n'], [[t, n] for t, n in s.marks])
        r = session_report(s)
        with open(os.path.join(d, 'report.json'), 'w') as fh:
            json.dump(r, fh, indent=1)
        with open(os.path.join(d, 'report.md'), 'w') as fh:
            fh.write(report_md(r))
        reports.append(r)
        print('%s: %d fields, %d samples, %.1f s%s -> %s' % (sid, len(s.fields), r['samples'], r['span_s'], '' if r['complete'] else ' (no #end)', d))
    return reports


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('-o', '--out', default='rec-out')
    ap.add_argument('--resample', type=int, default=None, help='a common clock every MS ms')
    ap.add_argument('--max-age', type=int, default=None, help='a value older than MS ms is not carried (default 3 x --resample)')
    ap.add_argument('--parquet', action='store_true')
    a = ap.parse_args(argv)
    reps = convert(a.inputs, a.out, a.resample, a.max_age, a.parquet)
    if not reps:
        print('no recording found (rec-<session>-<n>.csv[.gz])')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
