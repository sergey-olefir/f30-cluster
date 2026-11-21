#!/usr/bin/env python3
"""Round "Road View", package TS: a city drive's RV recordings (set S19) -> what the car sends about traffic lights, signs and the
road scene, a proposed value table for the light's raw members, replay files for the themes' test modes, and a summary.

    python3 -I tools/car/rv_analyse.py <data/rec folder or rec files ...> -o <out folder> [--notes notes.json|notes.txt] [--name TEXT]

The input is what the RV recorder writes (apps/rv_recorder, shared/signal_recorder.js, format #rec 1), as
tools/car/collect.sh copies it (apps/rv_recorder/rec/). The drive: docs/traffic/DRIVE-PROTOCOL.md. The notes are the passenger's
marks: JSON [{"session": "20261121-100000" (optional), "mark": 3, "what": "red-first"}], or text lines "M3 red-first" (a line may
start with the session). Only the label is read (its vocabulary is LABELS below); any other word on a line is ignored and never
written anywhere.

<out>/sources.md|json   per source of the set: present or silent, messages, rate, first seen, value ranges and the enum values seen
<out>/lights.md|json    every traffic-light track (by id; a new track after 3 s of silence): first / last seen, the colour runs, arrow,
                        direction, status, position and quality ranges; each mark matched to the light it was about and that light's
                        values; the PROPOSED value table for colour, arrow and status with the evidence behind every entry (the marks,
                        and the display feed's vsliSign where the car sends it), the entries that stay unknown, the flashing lights
<out>/signs.md|json     every sign type seen per stream with its count and the mark it matched; which stream had it first and by how
                        much; the old stream's numeric types against the new stream's names; whether the display feeds follow the limit
<out>/scene.md|json     the road-scene and environment-model lists: which arrive, messages a second over time, their counts and sizes;
                        whether their object ids agree with the camera's object list
<out>/scenarios/        one small JSON replay per light track and per sign sighting (times from its first message, raw values only)
                        and index.json, for the themes' test modes
<out>/summary.md        for the owner, Ukrainian and English: what the car sends, what it means, what is still unknown

Read only, local; numbers, enum names and our own words only (the recorder writes no text). Plain Python 3, no third-party package.
Mac only, never shipped. Its test: tools/car/test_rv_analyse.py (synthetic drives made by tools/car/rv_synth.js).
"""
import argparse
import json
import os
import re
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rec_convert as rc  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
RV_FIELDS = os.path.join(REPO, 'design', 'car', 'rv_fields.json')

# the passenger's labels (docs/traffic/DRIVE-PROTOCOL.md) and what each says about a light or a sign
LABELS = ['red-first', 'green-pass', 'light-change', 'green-arrow', 'flashing-amber', 'pedestrian-light', 'stop-sign', 'give-way', 'priority-road',
          'no-entry', 'town-entry', 'town-exit', 'zebra', 'children', 'road-works', 'no-overtaking', 'no-overtaking-end', 'variable-limit',
          'limit-plate', 'roundabout', 'multi-lane', 'light-right', 'light-overhead', 'nav-start', 'nav-end', 'low-sun', 'rain']
LIGHT_MARKS = ('red-first', 'green-pass', 'light-change', 'green-arrow', 'flashing-amber', 'pedestrian-light', 'light-right', 'light-overhead')
LIGHT_LABELS = {'red-first': 'red', 'green-pass': 'green', 'green-arrow': 'green'}
SIGN_LABELS = {
    'stop-sign': ['STOP_SIGN'], 'give-way': ['GIVE_WAY', 'DS_GIVE_WAY_ROUNDABOUT'], 'priority-road': ['PRIORITY_ROAD_START_OF'],
    'no-entry': ['NO_ENTRY', 'ALL_VEHICLES_PROHIBITED', 'VEHICLES_PROHIBITED'], 'town-entry': ['CITY_LIMIT_START_OF', 'CITY_LIMIT_START_END_OF'],
    'town-exit': ['CITY_LIMIT_END_OF', 'CITY_LIMIT_START_END_OF'], 'zebra': ['DS_PEDESTRIAN_CROSSING', 'DS_PEDESTRIAN'], 'children': ['DS_CHILDREN'],
    'road-works': ['DS_ROAD_WORKS'], 'no-overtaking': ['NO_PASSING_SIGN'], 'no-overtaking-end': ['WITHDRAWAL_NO_PASSING_SIGN', 'GENERAL_WITHDRAWAL'],
    'variable-limit': ['SPEED_LIMIT'], 'limit-plate': ['SPEED_LIMIT'], 'roundabout': ['ROUNDABOUT_SIGN', 'DS_GIVE_WAY_ROUNDABOUT'],
    'pedestrian-light': ['DS_TRAFFIC_LIGHT'],
}
DISPLAY_LABEL = {'TRAFFIC_LIGHT_RED': 'red', 'TRAFFIC_LIGHT_YELLOW': 'amber', 'TRAFFIC_LIGHT_GREEN': 'green', 'TRAFFIC_LIGHT_RED_YELLOW': 'red-amber',
                 'TRAFFIC_LIGHT_GREEN_ARROW': 'green', 'TRAFFIC_LIGHT_GREEN_SIGN': 'green', 'TRAFFIC_LIGHT_UNSURE': 'unsure',
                 'TRAFFIC_LIGHT_WITHOUT_PREDICTION': 'no-prediction', 'TRAFFIC_LIGHT_GO_REQUEST': 'go-request'}
TL = ['trafficLightID', 'trafficLightPositionX', 'trafficLightPositionY', 'trafficLightPositionZ', 'trafficLightStatus', 'trafficLightArrow',
      'trafficLightIndicateDirection', 'trafficLightColor', 'qualityRecognitionTrafficLight']
SIGN_STREAMS = ['cam-signs', 'cam-legacy2']
DISCRETE = ('trafficLightStatus', 'trafficLightArrow', 'trafficLightIndicateDirection', 'trafficLightColor')
TRACK_GAP_S = 3.0
EPISODE_GAP_S = 1.5


# ---- loading ----------------------------------------------------------------------------------------------------------------------
def load(inputs):
    return rc.load(inputs)


def read_notes(path):
    """{(session or None, mark): label}; unknown words are dropped (never kept, never written)."""
    if not path:
        return {}
    out = {}
    with open(path, encoding='utf-8') as fh:
        raw = fh.read()
    try:
        data = json.loads(raw)
    except ValueError:
        data = None
    if isinstance(data, list):
        for e in data:
            if isinstance(e, dict) and isinstance(e.get('mark'), int):
                lab = str(e.get('what', '')).strip().lower()
                if lab in LABELS:
                    out[(e.get('session') or None, e['mark'])] = lab
        return out
    for line in raw.splitlines():
        m = re.match(r'^\s*(?:(\d{8}-\d{6})\s+)?M(\d+)\b[\s:.-]*([a-z-]+)', line.strip(), re.I)
        if m and m.group(3).lower() in LABELS:
            out[(m.group(1), int(m.group(2)))] = m.group(3).lower()
    return out


def label_of(notes, sid, n):
    return notes.get((sid, n)) or notes.get((None, n))


def expected_sources():
    try:
        with open(RV_FIELDS, encoding='utf-8') as fh:
            d = json.load(fh)
        # fixes-1121 CR: the table holds four choices now; this analysis is S19's (a field without "sets" is the old table's S19)
        return [(f['tag'], f.get('kind', 'full'), f.get('group', '')) for f in d.get('fields', []) if 'S19' in f.get('sets', [f.get('set', 'S19')])]
    except (OSError, ValueError):
        return []


def rows(sess, tag):
    f = sess.fields.get(tag)
    return f.rows if f else []


def sec(t):
    return None if t is None else t / 1000.0


def last_at(series, t, max_age):
    """The value of a sorted [(t, v)] series at t (the last one at or before t, no older than max_age s), else None."""
    lo, hi = 0, len(series)
    while lo < hi:
        mid = (lo + hi) // 2
        if series[mid][0] <= t:
            lo = mid + 1
        else:
            hi = mid
    if lo == 0:
        return None
    tt, v = series[lo - 1]
    return v if t - tt <= max_age else None


def runs(pairs):
    """[(t, v)] -> [[v, t_first, t_last, n]]: consecutive equal values."""
    out = []
    for t, v in pairs:
        if out and out[-1][0] == v:
            out[-1][2] = t
            out[-1][3] += 1
        else:
            out.append([v, t, t, 1])
    return out


def top(counter, n=8):
    return sorted(counter.items(), key=lambda kv: (-kv[1], str(kv[0])))[:n]


def rnd(x, nd=3):
    return None if x is None else round(x, nd)


# ---- sources ----------------------------------------------------------------------------------------------------------------------
def column_ranges(field, max_cols=40):
    out = {}
    for c in field.cols[:max_cols]:
        nums, enums = [], {}
        for r in field.rows:
            v = r[4].get(c)
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                nums.append(v)
            elif isinstance(v, str) and v:
                enums[v] = enums.get(v, 0) + 1
        e = {}
        if nums:
            e['min'], e['max'] = min(nums), max(nums)
            e['distinct'] = len(set(nums))
        if enums:
            e['enums'] = top(enums)
        if e:
            out[c] = e
    return out


# TR-REPORT D.4: "nothing / defaults only / real values". A value counts as a default when it is the catalogue's usual unfilled value
# (all bits of a 2..16-bit signal set, or an enum named so); a source whose every member only ever held such values, or 0, is
# "defaults only" (a heuristic: a real 0 everywhere would read the same).
DEFAULTISH = {3, 7, 15, 31, 63, 127, 255, 1023, 65535, 0}
DEFAULT_NAME = re.compile(r'(SIGNAL_UNFILLED|SIGNAL_UNBEFUELLT|UNBEFUELLT|NOT_AVAILABLE|INVALID|INIT\w*_UNKNOWN|NO_DISPLAY|NO_VSLI|KEIN\w*)$')


def is_default(v):
    if v is None or v == '':
        return True
    if isinstance(v, bool):
        return not v
    if isinstance(v, (int, float)):
        return v in DEFAULTISH
    return bool(DEFAULT_NAME.search(str(v)))


def verdict(sess, tag, summary):
    f = sess.fields.get(tag)
    if summary and (not f or not f.rows):
        return 'real values'          # a list source with only its summaries: it sent messages; their content is in the summaries
    if not f or not f.rows:
        return 'nothing'
    for r in f.rows:
        for c, v in r[4].items():
            if c.endswith('.n'):
                continue
            if not is_default(v):
                return 'real values'
    return 'defaults only'


def source_report(sessions):
    exp = expected_sources()
    tags = [t for t, _, _ in exp] or sorted({k.split('~')[0] for s in sessions.values() for k in s.fields})
    kinds = {t: k for t, k, _ in exp}
    groups = {t: g for t, _, g in exp}
    out = []
    for tag in tags:
        e = {'tag': tag, 'group': groups.get(tag, ''), 'kind': kinds.get(tag, 'full'), 'sessions': {}}
        for sid, s in sorted(sessions.items()):
            whole, summ = rows(s, tag), rows(s, tag + '~1s')
            if not whole and not summ:
                e['sessions'][sid] = {'present': False}
                continue
            span = ((s.end or {}).get('t') or max([r[0] for f in s.fields.values() for r in f.rows] or [1])) / 1000.0
            msgs = sum((r[4].get('msgs') or 0) for r in summ) if summ else len(whole)
            ts = [r[0] for r in whole]
            iv = [b - a for a, b in zip(ts, ts[1:]) if b > a]
            d = {'present': True, 'messages': msgs, 'first_s': sec(min([r[0] for r in whole + summ])), 'mean_rate_hz': rnd(msgs / span if span > 0 else None, 2)}
            if iv and not summ:
                d['native_rate_hz'] = rnd(1000.0 / statistics.median(iv), 2)
            if whole:
                d['columns'] = column_ranges(s.fields[tag])
            d['verdict'] = verdict(s, tag, bool(summ))
            if summ:
                d['summary_seconds'] = len(summ)
            e['sessions'][sid] = d
        e['present'] = any(v.get('present') for v in e['sessions'].values())
        vs = [v.get('verdict') for v in e['sessions'].values() if v.get('present')]
        e['verdict'] = 'nothing' if not vs else 'real values' if 'real values' in vs else 'defaults only'
        out.append(e)
    return out


# ---- lights -----------------------------------------------------------------------------------------------------------------------
def tracks_of(sess):
    by_id = {}
    for r in rows(sess, 'tl'):
        v = r[4]
        i = v.get('trafficLightID')
        if i is None:
            continue
        by_id.setdefault(i, []).append((sec(r[0]), v))
    tracks = []
    for i, msgs in sorted(by_id.items(), key=lambda kv: kv[1][0][0]):
        cur = None
        for t, v in msgs:
            if cur is None or t - cur['msgs'][-1][0] > TRACK_GAP_S:
                cur = {'id': i, 'msgs': []}
                tracks.append(cur)
            cur['msgs'].append((t, v))
    for k, tr in enumerate(tracks):
        m = tr['msgs']
        tr['key'] = '%s#%d' % (tr['id'], k)
        tr['first'], tr['last'], tr['n'] = m[0][0], m[-1][0], len(m)
        col = lambda c: [x[1].get(c) for x in m if isinstance(x[1].get(c), (int, float))]  # noqa: E731
        tr['colour_runs'] = [[v, rnd(a), rnd(b), n] for v, a, b, n in runs([(t, v.get('trafficLightColor')) for t, v in m])]
        for c, k2 in (('trafficLightArrow', 'arrow'), ('trafficLightIndicateDirection', 'direction'), ('trafficLightStatus', 'status')):
            vals = {}
            for x in col(c):
                vals[x] = vals.get(x, 0) + 1
            tr[k2] = top(vals)
        for c, k2 in (('trafficLightPositionX', 'x'), ('trafficLightPositionY', 'y'), ('trafficLightPositionZ', 'z'), ('qualityRecognitionTrafficLight', 'quality')):
            vals = col(c)
            tr[k2] = {'first': vals[0], 'last': vals[-1], 'min': min(vals), 'max': max(vals)} if vals else None
    return tracks


def track_at(tracks, t, before=1.5, after=0.5, flashing=False):
    """The light a mark at t is about: the track with the most messages in [t - before, t + after], ties by the higher quality; for a
    flashing-amber mark the track whose colour changes most often in that window (a steady light beside it is not the one)."""
    best, score = None, None
    for tr in tracks:
        win = [v for tt, v in tr['msgs'] if t - before <= tt <= t + after]
        if not win:
            continue
        q = max([v.get('qualityRecognitionTrafficLight') or 0 for v in win])
        changes = len(runs([(0, v.get('trafficLightColor')) for v in win])) - 1
        s = (changes, len(win), q) if flashing else (len(win), q)
        if score is None or s > score:
            best, score = (tr, win), s
    return best


def mode(vals):
    c = {}
    for v in vals:
        if v is not None:
            c[v] = c.get(v, 0) + 1
    return max(c.items(), key=lambda kv: (kv[1], -hash(str(kv[0])) % 7))[0] if c else None


def display_series(sess):
    out = []
    for r in rows(sess, 'hud-data2'):
        v = r[4].get('xSpeedLimitAssist.vsliSign')
        if isinstance(v, str):
            out.append((sec(r[0]), v))
    return out


def light_report(sessions, notes):
    res = {'tracks': [], 'marks': [], 'flashing': [], 'table': {}, 'by_label': {}, 'histograms': {}}
    votes = {'color': {}, 'arrow': {}, 'status': {}}

    def vote(kind, value, source, label, n=1):
        e = votes[kind].setdefault(value, {'marks': {}, 'display': {}})
        e[source][label] = e[source].get(label, 0) + n

    status_first, status_all = {}, {}
    for sid, s in sorted(sessions.items()):
        tracks = tracks_of(s)
        disp = display_series(s)
        for tr in tracks:
            res['tracks'].append({k: tr[k] for k in ('key', 'id', 'first', 'last', 'n', 'colour_runs', 'arrow', 'direction', 'status', 'x', 'y', 'z', 'quality')})
            res['tracks'][-1]['session'] = sid
            for t, v in tr['msgs']:
                st = v.get('trafficLightStatus')
                status_all[st] = status_all.get(st, 0) + 1
                if t - tr['first'] < 1.0:
                    status_first[st] = status_first.get(st, 0) + 1
            # flashing: a track that alternates between two values at least 6 times, each run under 1.2 s
            cr = tr['colour_runs']
            if len(cr) >= 6:
                vals = sorted({x[0] for x in cr})
                short = [x for x in cr[1:-1] if x[2] - x[1] < 1.2]
                if len(vals) == 2 and len(short) >= len(cr) - 3:
                    per = [b[1] - a[1] for a, b in zip(cr, cr[1:])]
                    res['flashing'].append({'session': sid, 'track': tr['key'], 'values': vals, 'period_s': rnd(statistics.median(per) * 2, 2), 'runs': len(cr)})
            # the display feed: a track whose colour the display's vsliSign names most of the time votes
            if disp:
                pairs = [(v.get('trafficLightColor'), last_at(disp, t, 1.0)) for t, v in tr['msgs']]
                named = [(c, d) for c, d in pairs if d in DISPLAY_LABEL]
                if pairs and len(named) >= 0.7 * len(pairs):
                    for c, d in named:
                        vote('color', c, 'display', DISPLAY_LABEL[d])
                    for t, v in tr['msgs']:
                        d = last_at(disp, t, 1.0)
                        if d in DISPLAY_LABEL:
                            vote('arrow', v.get('trafficLightArrow'), 'display', 'arrow' if d == 'TRAFFIC_LIGHT_GREEN_ARROW' else 'no-arrow')
        for t_ms, n in s.marks:
            lab = label_of(notes, sid, n)
            t = sec(t_ms)
            e = {'session': sid, 'mark': n, 't': rnd(t), 'what': lab}
            if lab not in LIGHT_MARKS:
                continue
            if lab == 'flashing-amber':
                hit = track_at(tracks, t, before=3.0, after=1.0, flashing=True)
            else:
                hit = track_at(tracks, t, before=6.0 if lab == 'light-change' else 1.5, after=0.5 if lab != 'light-change' else 6.0)
            if not hit:
                e['light'] = None
                res['marks'].append(e)
                continue
            tr, win = hit
            e['light'] = tr['key']
            e['values'] = {c: mode([v.get(c) for v in win]) for c in TL[1:]}
            e['colour_seq'] = [x[0] for x in runs([(0, v.get('trafficLightColor')) for v in win])]
            sp = [r[4].get('speedVehicleCentreOfGravity') for r in rows(sessions[sid], 'car-speed2') if abs(sec(r[0]) - t) <= 1.0]
            sp = [x for x in sp if isinstance(x, (int, float))]
            if sp:
                e['speed_kmh'] = rnd(statistics.median(sp) / 64.0, 1)
            res['marks'].append(e)
            res['by_label'].setdefault(lab, []).append(e['values'])
            h = res['histograms'].setdefault(lab, {})
            for c in TL[1:]:
                vals = [v.get(c) for v in win]
                if c in DISCRETE:
                    for x in vals:
                        h.setdefault(c, {})[str(x)] = h.setdefault(c, {}).get(str(x), 0) + 1
                else:
                    nums = [x for x in vals if isinstance(x, (int, float))] + [x for x in (h.get(c) or {}).get('_', [])]
                    if nums:
                        h[c] = {'_': [min(nums), max(nums)]}
            if lab in LIGHT_LABELS:
                vote('color', e['values']['trafficLightColor'], 'marks', LIGHT_LABELS[lab])
            if lab == 'light-change' and len(e['colour_seq']) >= 2:
                seq = e['colour_seq']
                vote('color', seq[0], 'marks', 'green')
                vote('color', seq[-1], 'marks', 'red')
                if len(seq) >= 3:
                    vote('color', seq[-2], 'marks', 'amber')
            if lab in ('green-arrow', 'red-first', 'green-pass'):
                vote('arrow', e['values']['trafficLightArrow'], 'marks', 'arrow' if lab == 'green-arrow' else 'no-arrow')
    # the proposals
    for kind in ('color', 'arrow'):
        tab = {}
        seen = set()
        for tr in res['tracks']:
            if kind == 'color':
                seen.update(x[0] for x in tr['colour_runs'])
            else:
                seen.update(x[0] for x in tr['arrow'])
        for val in sorted(seen, key=lambda x: (x is None, x)):
            ev = votes[kind].get(val, {'marks': {}, 'display': {}})
            m, d = ev['marks'], ev['display']
            mt = max(m.items(), key=lambda kv: kv[1]) if m else None
            dt = max(d.items(), key=lambda kv: kv[1]) if d else None
            if mt and dt:
                prop, basis = mt[0], 'marks and display ' + ('agree' if mt[0] == dt[0] else 'DISAGREE (display: %s)' % dt[0])
            elif mt:
                prop, basis = mt[0], 'marks'
            elif dt:
                prop, basis = dt[0], 'display'
            else:
                prop, basis = 'unknown', 'no evidence'
            flash = [f for f in res['flashing'] if val in f['values']]
            if kind == 'color' and prop == 'unknown' and flash:
                prop, basis = 'off? (alternates in a flashing light)', 'flashing'
            nm, nd = sum(m.values()), sum(d.values())
            conf = None
            if mt:
                conf = mt[1] / float(nm)
            elif dt:
                conf = dt[1] / float(nd)
            tab[str(val)] = {'value': val, 'proposal': prop, 'basis': basis, 'marks': m, 'marks_n': nm, 'display': d, 'display_n': nd, 'share': rnd(conf, 2)}
        res['table'][kind] = tab
    st = {}
    for val, n in status_all.items():
        f = status_first.get(val, 0)
        st[str(val)] = {'value': val, 'messages': n, 'in_first_second': f,
                        'proposal': 'new / initial (hypothesis)' if n and f / float(n) > 0.8 else 'tracked (hypothesis)' if n == max(status_all.values()) else 'unknown',
                        'basis': 'when it occurs in a track (no label source for the status)'}
    res['table']['status'] = st
    return res


# ---- signs ------------------------------------------------------------------------------------------------------------------------
def sightings(sess, tag):
    """Every sign entry of a stream: (t, type, value, variable, supp1, supp2) for the entries below numberSigns."""
    out = []
    for r in rows(sess, tag):
        v = r[4]
        ns = v.get('trafficSignRecognition.numberSigns')
        n = v.get('trafficSign.n')
        if not isinstance(n, int):
            continue
        k = n if not isinstance(ns, int) else min(n, ns)
        for i in range(k):
            ty = v.get('trafficSign.%d.type' % i)
            if ty is None:
                continue
            out.append((sec(r[0]), ty, v.get('trafficSign.%d.value' % i), v.get('trafficSign.%d.variable' % i),
                        v.get('trafficSign.%d.firstSupplementalType' % i), v.get('trafficSign.%d.secondSupplementalType' % i)))
    return out


def episodes(items, key=lambda x: (x[1], x[2])):
    eps, open_ = [], {}
    for it in items:
        k = key(it)
        e = open_.get(k)
        if e is None or it[0] - e['last'] > EPISODE_GAP_S:
            e = {'type': it[1], 'value': it[2], 'first': it[0], 'last': it[0], 'n': 0, 'variable': bool(it[3]) if len(it) > 3 else None,
                 'supp': sorted({x for x in it[4:6] if x and x != 'SIGNAL_UNFILLED'}) if len(it) > 4 else []}
            open_[k] = e
            eps.append(e)
        e['last'] = it[0]
        e['n'] += 1
    for e in eps:
        e['first'], e['last'] = rnd(e['first']), rnd(e['last'])
    return eps


def sign_report(sessions, notes):
    res = {'types': {}, 'marks': [], 'leads': [], 'legacy_codes': {}, 'limits': []}
    for sid, s in sorted(sessions.items()):
        eps = {tag: episodes(sightings(s, tag)) for tag in SIGN_STREAMS}
        leg = [(sec(r[0]), r[4].get('trafficSignType'), r[4].get('trafficSignValue')) for r in rows(s, 'cam-legacy') if r[4].get('trafficSignType') is not None]
        eps['cam-legacy'] = episodes(leg)
        for tag, lst in eps.items():
            for e in lst:
                d = res['types'].setdefault(str(e['type']), {})
                x = d.setdefault(tag, {'episodes': 0, 'messages': 0, 'first_s': None, 'values': {}})
                x['episodes'] += 1
                x['messages'] += e['n']
                x['first_s'] = e['first'] if x['first_s'] is None else min(x['first_s'], e['first'])
                x['values'][str(e['value'])] = x['values'].get(str(e['value']), 0) + 1
        # which stream first: the same type in the new stream and the second stream, starting within 5 s
        for e in eps['cam-signs']:
            for f in eps['cam-legacy2']:
                if f['type'] == e['type'] and f['value'] == e['value'] and abs(f['first'] - e['first']) <= 5:
                    res['leads'].append({'session': sid, 'type': e['type'], 'new_first_s': e['first'], 'legacy2_first_s': f['first'], 'legacy2_minus_new_ms': int(round((f['first'] - e['first']) * 1000))})
                    break
        # the old stream's numbers against the new stream's names at the same time
        for e in eps['cam-legacy']:
            for f in eps['cam-signs']:
                if f['first'] - 2 <= e['first'] <= f['last'] + 2:
                    c = res['legacy_codes'].setdefault(str(e['type']), {})
                    c[f['type']] = c.get(f['type'], 0) + 1
        for t_ms, n in s.marks:
            lab = label_of(notes, sid, n)
            if lab not in SIGN_LABELS:
                continue
            t = sec(t_ms)
            m = {'session': sid, 'mark': n, 't': rnd(t), 'what': lab, 'expected': SIGN_LABELS[lab], 'found': {}}
            for tag in ('cam-signs', 'cam-legacy2'):
                hits = [e for e in eps[tag] if e['type'] in SIGN_LABELS[lab] and e['first'] - 3 <= t <= e['last'] + 10]
                if lab == 'variable-limit':
                    hits = [e for e in hits if e['variable']] or hits
                if lab == 'limit-plate':
                    hits = [e for e in hits if e['supp']] or hits
                if hits:
                    h = min(hits, key=lambda e: abs(e['first'] - t))
                    m['found'][tag] = {'type': h['type'], 'value': h['value'], 'seen_before_mark_s': rnd(t - h['first'], 2), 'supp': h['supp'], 'variable': h['variable']}
            m['matched'] = bool(m['found'])
            res['marks'].append(m)
        # the limit: the function's class x 5 and the display feeds following
        tsr = [(sec(r[0]), r[4].get('presentClassLimitSpeed')) for r in rows(s, 'tsr') if isinstance(r[4].get('presentClassLimitSpeed'), int)]
        d1 = [(sec(r[0]), r[4].get('xSpeedLimitAssist.vSLISpeedValue')) for r in rows(s, 'hud-data')]
        d2 = [(sec(r[0]), r[4].get('xSpeedLimitAssist.vsliValue')) for r in rows(s, 'hud-data2')]
        r1, r2 = runs(d1), runs(d2)
        near = lambda rr, want, a: min([r[1] for r in rr if r[0] == want and a - 5 <= r[1] <= a + 10], key=lambda x: abs(x - a), default=None)  # noqa: E731
        for v, a, _, _ in runs(tsr)[1:]:
            lim = v * 5
            f1 = near(r1, lim, a)
            f2 = near(r2, 'LIMIT_%d' % lim, a)
            res['limits'].append({'session': sid, 'class': v, 'kmh': lim, 'at_s': rnd(a), 'hud_vSLISpeedValue_after_ms': None if f1 is None else int(round((f1 - a) * 1000)),
                                  'hud2_vsliValue_after_ms': None if f2 is None else int(round((f2 - a) * 1000))})
    return res


# ---- the road scene ---------------------------------------------------------------------------------------------------------------
SCENE = ['view-input', 'lca-input', 'lateral-input', 'road-segment', 'ego-position', 'merged-objects', 'object-info1', 'object-info2', 'object-lanes',
         'lane-info', 'road-model', 'fas-view', 'cam-objects', 'cam2-objects']


def ids_of(row):
    v = row[4]
    return {v.get('ids.v%d' % i) for i in range(6)} - {None, ''}


def scene_report(sessions):
    res = {'lists': {}, 'agreement': []}
    for sid, s in sorted(sessions.items()):
        for tag in SCENE:
            summ = rows(s, tag + '~1s')
            whole = rows(s, tag)
            e = res['lists'].setdefault(tag, {})
            if not summ and not whole:
                e[sid] = {'present': False}
                continue
            per_min = {}
            for r in summ:
                k = int(sec(r[0]) // 60)
                per_min[k] = per_min.get(k, 0) + (r[4].get('msgs') or 0)
            counts = [r[4].get('count') for r in summ if isinstance(r[4].get('count'), (int, float))]
            lens = {c[:-3]: [r[4].get(c) for r in summ if isinstance(r[4].get(c), int)] for c in (s.fields[tag + '~1s'].cols if summ else []) if c.endswith('Len')}
            e[sid] = {'present': True, 'seconds': len(summ), 'messages': sum((r[4].get('msgs') or 0) for r in summ),
                      'msgs_per_s': rnd(statistics.mean([r[4].get('msgs') or 0 for r in summ]), 2) if summ else None,
                      'per_minute': [[k, per_min[k]] for k in sorted(per_min)], 'whole_messages': len(whole),
                      'count': {'min': min(counts), 'max': max(counts)} if counts else None,
                      'lengths': {k: {'min': min(v), 'max': max(v)} for k, v in lens.items() if v}}
        cam = {int(sec(r[0])): ids_of(r) for r in rows(s, 'cam-objects~1s')}
        for tag in ('object-info1', 'merged-objects', 'view-input'):
            other = {int(sec(r[0])): ids_of(r) for r in rows(s, tag + '~1s')}
            both = [k for k in other if k in cam and (other[k] or cam[k])]
            if not both:
                continue
            jac = [len(other[k] & cam[k]) / float(len(other[k] | cam[k])) for k in both if other[k] | cam[k]]
            res['agreement'].append({'session': sid, 'list': tag, 'with': 'cam-objects', 'seconds': len(both), 'mean_overlap': rnd(statistics.mean(jac), 3) if jac else None,
                                     'note': 'the first 6 ids of each second (the summary keeps 6)'})
    return res


# ---- scenarios --------------------------------------------------------------------------------------------------------------------
def write_scenarios(out, sessions, notes):
    d = os.path.join(out, 'scenarios')
    os.makedirs(d, exist_ok=True)
    index = []
    for sid, s in sorted(sessions.items()):
        marks = [(sec(t), n, label_of(notes, sid, n)) for t, n in s.marks]
        for tr in tracks_of(s):
            t0 = tr['first']
            frames = [[int(round((t - t0) * 1000))] + [v.get(c) for c in TL[1:]] for t, v in tr['msgs']]
            ms = [{'t_ms': int(round((t - t0) * 1000)), 'mark': n, 'what': lab} for t, n, lab in marks if t0 - 2 <= t <= tr['last'] + 2]
            name = '%s-light-%s.json' % (sid, tr['key'].replace('#', '-'))
            with open(os.path.join(d, name), 'w') as fh:
                json.dump({'kind': 'light', 'session': sid, 'id': tr['id'], 'start_s': rnd(t0), 'columns': ['t_ms'] + TL[1:], 'frames': frames, 'marks': ms,
                           '_about': 'raw values as the car sent them; the meaning of colour / status / arrow: lights.md (a proposal, not a fact)'},
                          fh, separators=(',', ':'))
            index.append({'file': name, 'kind': 'light', 'session': sid, 'frames': len(frames), 'marks': [m['what'] for m in ms if m['what']]})
        for tag in SIGN_STREAMS:
            for k, e in enumerate(episodes(sightings(s, tag))):
                t0 = e['first']
                fr = [[int(round((t - t0) * 1000)), v, var, s1, s2] for t, ty, v, var, s1, s2 in sightings(s, tag) if ty == e['type'] and v == e['value'] and t0 <= t <= e['last']]
                name = '%s-sign-%s-%d-%s.json' % (sid, tag, k, re.sub(r'[^A-Za-z0-9_]', '', str(e['type'])))
                with open(os.path.join(d, name), 'w') as fh:
                    json.dump({'kind': 'sign', 'session': sid, 'stream': tag, 'type': e['type'], 'value': e['value'], 'start_s': t0, 'columns': ['t_ms', 'value', 'variable', 'supp1', 'supp2'], 'frames': fr},
                              fh, separators=(',', ':'))
                index.append({'file': name, 'kind': 'sign', 'session': sid, 'type': e['type'], 'frames': len(fr)})
    with open(os.path.join(d, 'index.json'), 'w') as fh:
        json.dump(index, fh, indent=1)
    return index


# ---- the reports -----------------------------------------------------------------------------------------------------------------
def md_sources(src):
    out = ['# Sources of set S19 "RV"', '', '| Source | Group | Kind | Session | Verdict | Messages | Rate (Hz) | First (s) |', '|---|---|---|---|---|---|---|---|']
    for e in src:
        for sid, d in sorted(e['sessions'].items()):
            if d.get('present'):
                out.append('| %s | %s | %s | %s | %s | %s | %s | %s |' % (e['tag'], e['group'], e['kind'], sid, d['verdict'], d['messages'], d.get('native_rate_hz') or d.get('mean_rate_hz'), d['first_s']))
            else:
                out.append('| %s | %s | %s | %s | **nothing** | 0 | - | - |' % (e['tag'], e['group'], e['kind'], sid))
    out += ['', 'Nothing in every recording: ' + (', '.join(e['tag'] for e in src if e['verdict'] == 'nothing') or 'none'),
            'Defaults only: ' + (', '.join(e['tag'] for e in src if e['verdict'] == 'defaults only') or 'none'), '']
    for e in src:
        for sid, d in sorted(e['sessions'].items()):
            if d.get('columns'):
                out.append('## %s (%s)' % (e['tag'], sid))
                for c, r in d['columns'].items():
                    bits = []
                    if 'min' in r:
                        bits.append('%s..%s (%d values)' % (r['min'], r['max'], r['distinct']))
                    if 'enums' in r:
                        bits.append(', '.join('%s x%d' % (k, n) for k, n in r['enums']))
                    out.append('- `%s`: %s' % (c, '; '.join(bits)))
                out.append('')
    return '\n'.join(out) + '\n'


def md_lights(L):
    out = ['# Traffic lights', '', 'Every value below is raw, as the car sent it. The table is a PROPOSAL from the evidence counted; no entry is a fact until the owner confirms it.', '']
    out += ['## Proposed value table', '']
    for kind in ('color', 'arrow', 'status'):
        out += ['### ' + kind, '', '| Raw | Proposal | Basis | Marks | Display | Share |', '|---|---|---|---|---|---|']
        for k, e in sorted(L['table'].get(kind, {}).items(), key=lambda kv: str(kv[0])):
            out.append('| %s | %s | %s | %s | %s | %s |' % (e['value'], e['proposal'], e['basis'], json.dumps(e.get('marks', {})), json.dumps(e.get('display', {})), e.get('share')))
        out.append('')
    out += ['## Flashing lights', ''] + ['- %s %s: values %s alternate, period about %s s (%d runs)' % (f['session'], f['track'], f['values'], f['period_s'], f['runs']) for f in L['flashing']] + ['']
    out += ['## Marks', '', '| Session | Mark | What | Light | Colour | Seq | Status | Arrow | Dir | X | Y | Z | Q | Speed |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for m in L['marks']:
        v = m.get('values') or {}
        out.append('| %s | M%s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (m['session'], m['mark'], m['what'], m.get('light'), v.get('trafficLightColor'), m.get('colour_seq'),
                   v.get('trafficLightStatus'), v.get('trafficLightArrow'), v.get('trafficLightIndicateDirection'), v.get('trafficLightPositionX'), v.get('trafficLightPositionY'),
                   v.get('trafficLightPositionZ'), v.get('qualityRecognitionTrafficLight'), m.get('speed_kmh')))
    out += ['', '## What the marks of one kind have in common', '']
    for lab, vals in sorted(L['by_label'].items()):
        common = {c: sorted({str(v.get(c)) for v in vals}) for c in TL[1:]}
        out.append('- **%s** (%d marks): %s' % (lab, len(vals), '; '.join('%s %s' % (c.replace('trafficLight', '').replace('RecognitionTrafficLight', ''), '/'.join(x)) for c, x in common.items())))
    out += ['', '## The light\'s members against the marks (every message of the chosen light in each mark\'s window)', '']
    for lab, h in sorted(L['histograms'].items()):
        out.append('- **%s**: %s' % (lab, '; '.join('%s %s' % (c.replace('trafficLight', '').replace('RecognitionTrafficLight', ''),
                   ('%s..%s' % tuple(x['_'])) if '_' in x else '{' + ', '.join('%s: %d' % kv for kv in sorted(x.items())) + '}') for c, x in h.items())))
    out += ['', '## Tracks', '', '| Session | Track | First (s) | Last (s) | Msgs | Colour runs | Arrow | Status | X first..last | Quality |', '|---|---|---|---|---|---|---|---|---|---|']
    for t in L['tracks']:
        cr = ' '.join('%s@%s' % (r[0], r[1]) for r in t['colour_runs'][:12]) + (' ...' if len(t['colour_runs']) > 12 else '')
        out.append('| %s | %s | %s | %s | %d | %s | %s | %s | %s | %s |' % (t['session'], t['key'], rnd(t['first'], 1), rnd(t['last'], 1), t['n'], cr, t['arrow'], t['status'],
                   '%s..%s' % (t['x']['first'], t['x']['last']) if t['x'] else '-', '%s..%s' % (t['quality']['min'], t['quality']['max']) if t['quality'] else '-'))
    return '\n'.join(out) + '\n'


def md_signs(S):
    out = ['# Signs', '', '| Type | Stream | Sightings | Messages | First (s) | Values |', '|---|---|---|---|---|---|']
    for ty, d in sorted(S['types'].items()):
        for tag, x in sorted(d.items()):
            out.append('| %s | %s | %d | %d | %s | %s |' % (ty, tag, x['episodes'], x['messages'], x['first_s'], ', '.join('%s x%d' % kv for kv in sorted(x['values'].items()))))
    out += ['', '## Marks', '', '| Session | Mark | What | Matched | New stream | Second stream |', '|---|---|---|---|---|---|']
    for m in S['marks']:
        f = m['found']
        fmt = lambda h: '-' if not h else '%s %s, %s s before%s' % (h['type'], h['value'], h['seen_before_mark_s'], (' ' + '+'.join(h['supp'])) if h['supp'] else '')  # noqa: E731
        out.append('| %s | M%s | %s | %s | %s | %s |' % (m['session'], m['mark'], m['what'], 'yes' if m['matched'] else '**no**', fmt(f.get('cam-signs')), fmt(f.get('cam-legacy2'))))
    lead = [x['legacy2_minus_new_ms'] for x in S['leads']]
    out += ['', '## Which stream first', '', ('The second stream (recognitionTrafficSignCamera2) started %s ms after the new one (median of %d sightings).' % (int(statistics.median(lead)), len(lead))) if lead else 'No sighting was in both streams.']
    out += ['', '## The old stream\'s numbers', ''] + ['- %s: %s' % (k, ', '.join('%s x%d' % kv for kv in sorted(v.items(), key=lambda kv: -kv[1]))) for k, v in sorted(S['legacy_codes'].items(), key=lambda kv: str(kv[0]))]
    out += ['', '## The limit and the display feeds', '', '| Session | At (s) | Class | km/h | vSLISpeedValue after (ms) | vsliValue after (ms) |', '|---|---|---|---|---|---|']
    for x in S['limits']:
        out.append('| %s | %s | %s | %s | %s | %s |' % (x['session'], x['at_s'], x['class'], x['kmh'], x['hud_vSLISpeedValue_after_ms'], x['hud2_vsliValue_after_ms']))
    return '\n'.join(out) + '\n'


def md_scene(R):
    out = ['# The road scene and the environment model', '', '| List | Session | Present | Msgs/s | Messages | Count | Lengths |', '|---|---|---|---|---|---|---|']
    for tag, d in R['lists'].items():
        for sid, x in sorted(d.items()):
            if x.get('present'):
                out.append('| %s | %s | yes | %s | %s | %s | %s |' % (tag, sid, x['msgs_per_s'], x['messages'], x['count'], x['lengths'] or '-'))
            else:
                out.append('| %s | %s | **silent** | - | - | - | - |' % (tag, sid))
    out += ['', '## Do the lists agree with the camera\'s objects?', ''] + ['- %s %s vs %s: mean id overlap %s over %d s (%s)' % (a['session'], a['list'], a['with'], a['mean_overlap'], a['seconds'], a['note']) for a in R['agreement']]
    return '\n'.join(out) + '\n'


def summary_md(src, L, S, R, name):
    present = [e['tag'] for e in src if e['present']]
    silent = [e['tag'] for e in src if not e['present']]
    dflt = [e['tag'] for e in src if e['verdict'] == 'defaults only']
    tl = 'tl' in present
    col = L['table'].get('color', {})
    known = ['%s = %s' % (e['value'], e['proposal']) for e in col.values() if e['proposal'] != 'unknown']
    unknown = [str(e['value']) for e in col.values() if e['proposal'] == 'unknown']
    matched = sum(1 for m in S['marks'] if m['matched'])
    named = sorted(t for t in S['types'] if not re.match(r'^-?\d+$', t))
    out = ['# RV: ' + (name or 'a city drive'), '']
    out += ['## Українською', '']
    out.append('- Джерел, що надсилали дані: %d з %d. Мовчали: %s. Лише типові (порожні) значення: %s.' % (len(present), len(src), ', '.join(silent) or 'жодне', ', '.join(dflt) or 'жодне'))
    out.append('- Світлофор з камери (RecognitionTrafficLightCamera): ' + ('**надходить**; світлофорів (треків): %d.' % len(L['tracks']) if tl else '**не надходить** на цьому автомобілі.'))
    if tl:
        out.append('- Запропонована таблиця кольору (сирі числа, з підрахунком доказів у lights.md): %s. Невідомі значення: %s.' % ('; '.join(known) or 'немає', ', '.join(unknown) or 'немає'))
        out.append('- Це припущення з позначок і з показу на HUD-каналі, не факт. Камера каже, яке світло горить зараз; коли воно зміниться, вона не знає.')
    out.append('- Знаки: типів (за назвою) побачено %d: %s; позначок про знаки збіглося %d з %d.' % (len(named), ', '.join(named) or '-', matched, len(S['marks'])))
    out.append('- Сцена дороги: списки, що надходять: %s.' % (', '.join(t for t, d in R['lists'].items() if any(x.get('present') for x in d.values())) or 'жодного'))
    out += ['', '## English', '']
    out.append('- Sources that sent data: %d of %d. Silent: %s. Defaults only: %s.' % (len(present), len(src), ', '.join(silent) or 'none', ', '.join(dflt) or 'none'))
    out.append('- The camera\'s traffic light (RecognitionTrafficLightCamera): ' + ('**arrives**; lights (tracks): %d.' % len(L['tracks']) if tl else '**does not arrive** on this car.'))
    if tl:
        out.append('- Proposed colour table (raw numbers, evidence counted in lights.md): %s. Unknown values: %s.' % ('; '.join(known) or 'none', ', '.join(unknown) or 'none'))
        out.append('- A proposal from the marks and the display feed, not a fact. The camera says which lamp is lit now; it cannot say when it will change.')
    out.append('- Signs: %d named types seen: %s; %d of %d sign marks matched.' % (len(named), ', '.join(named) or '-', matched, len(S['marks'])))
    out.append('- Road scene: lists that arrive: %s.' % (', '.join(t for t, d in R['lists'].items() if any(x.get('present') for x in d.values())) or 'none'))
    return '\n'.join(out) + '\n'


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--notes', help='the passenger\'s marks: JSON [{session, mark, what}] or lines "M3 red-first"')
    ap.add_argument('--name', default='')
    a = ap.parse_args(argv)
    sessions = load(a.inputs)
    if not sessions:
        print('rv_analyse: no recording found (rec-<session>-<n>.csv[.gz])')
        return 1
    notes = read_notes(a.notes)
    os.makedirs(a.out, exist_ok=True)
    src = source_report(sessions)
    L = light_report(sessions, notes)
    S = sign_report(sessions, notes)
    R = scene_report(sessions)
    idx = write_scenarios(a.out, sessions, notes)
    for nm, obj, md in (('sources', src, md_sources(src)), ('lights', L, md_lights(L)), ('signs', S, md_signs(S)), ('scene', R, md_scene(R))):
        with open(os.path.join(a.out, nm + '.json'), 'w') as fh:
            json.dump(obj, fh, indent=1, default=str)
        with open(os.path.join(a.out, nm + '.md'), 'w') as fh:
            fh.write(md)
    with open(os.path.join(a.out, 'summary.md'), 'w') as fh:
        fh.write(summary_md(src, L, S, R, a.name))
    print('rv_analyse: %d recording(s), %d of %d sources present, %d light track(s), %d sign type(s), %d replay file(s) -> %s' % (
        len(sessions), sum(1 for e in src if e['present']), len(src), len(L['tracks']), len(S['types']), len(idx), a.out))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
