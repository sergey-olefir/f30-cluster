#!/usr/bin/env python3
"""Cruise CR, rung 2 of docs/fixes-1121/CC-REPORT.md §7.4 (read only): does a unit on this car answer the multimodal
driver-assistance service (13203), and what do the speed-limit-assist and cruise settings say? A timeline of those fields against
the driver's marked actions and the cluster's set speed, and one verdict line.

    python3 -I tools/car/cruise_read.py [--log <app log> ...] [--rec <rec files or folders> ...] [--notes notes.txt] [-o <out>]

Inputs (any of them):
  --log    Signal Probe's app log (S17 on, recording or not: the five cruise-read fields keep their lines, recLog) and / or the RV
           recorder's (choice CRUISE: "rv: first / change assist-avail ..."). Lines read:
             probe: P15 assist-avail #2 t=61.2: acc=NOT_EQUIPPED sla=... sld=AVAILABLE dcc=ACTIVE setSpeed=61 ...
             probe: P26 sla-setting #1 t=3.0: value=ACCEPT_MANUALLY availability=OPERABLE deactivated=OPERABLE
             probe: ask P15 assist-avail (silent at +120s): error or no answer: ... (the car does not send it)
             rv: first assist-avail t=0.4: proposalAvailabilityACC=NOT_EQUIPPED ... / rv: change set-sla t=..: ...
  --rec    recordings (Signal Probe S17, or the RV recorder's CRUISE S21): the same fields with every value, the cluster's set speed
           (hud-data2 ldmSetSpeed.ldmSetSpeedValue, hud-data cruiseCtrlSpeedHUD) and the marks (#m)
  --notes  the passenger's notes, one mark a line: "M3 SET" (labels: docs/cruise/DRIVE-PROTOCOL.md: PARK, ON, SET, PLUS, MINUS,
           BRAKE, RESUME, LIM, LIM_OFF, SLA_SET, OFF); other words on the line are ignored and never written

Writes <out>/cruise_read.md and .json when -o is given; prints the verdict line, e.g.:
    verdict: a unit answers 13203: yes; DCC ACTIVE seen (with the cruise used); SLD AVAILABLE; set speed matches the cluster 41 of 43;
             SLA setting ACCEPT_MANUALLY (OPERABLE); BMW's SET offer seen 2x

Plain Python 3; reads only; Mac only, never shipped. Uses tools/car/rec_convert.py's reader.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rec_convert as rc  # noqa: E402

LABELS = ('PARK', 'ON', 'SET', 'PLUS', 'MINUS', 'BRAKE', 'RESUME', 'LIM', 'LIM_OFF', 'SLA_SET', 'OFF')
# the fields, by tag: Signal Probe's and the RV recorder's (CRUISE) names
AVAIL = ('assist-avail',)
SLA = ('sla-setting', 'set-sla')
DCC = ('dcc-setting', 'set-dcc')
COUNTRY = ('sla-country',)
FORESIGHT = ('fas-foresight',)
# the log's short column names (Signal Probe) -> the member names (the recording, the RV recorder's log)
LOG_COLS = {'acc': 'proposalAvailabilityACC', 'sla': 'proposalAvailabilitySLA', 'sld': 'proposalAvailabilitySLD', 'dcc': 'proposalAvailabilityDCC',
            'setSpeed': 'valueSetSpeed', 'setInfo': 'infoSetSpeed', 'proposal': 'proposalAssistFunction', 'ucc': 'proposalAvailabilityUCC',
            'response': 'infoResponseAdaptionSpeed', 'forecast': 'stateForecastLongitudinal',
            'value': 'value', 'availability': 'availability', 'deactivated': 'availabilityDeactivated', 'status': 'status',
            'offer2': 'displayOperationTakeOverSuggestionSpeed2', 'offerSpeed': 'displayTakeOverSuggestionSpeed', 'isa': 'statusISA'}
TAG_OF = {'sla-setting': 'sla', 'set-sla': 'sla', 'dcc-setting': 'dcc', 'set-dcc': 'dcc', 'sla-country': 'country', 'fas-foresight': 'foresight', 'assist-avail': 'avail'}
SET_SPEED = (('hud-data2', 'ldmSetSpeed.ldmSetSpeedValue'), ('hud-data', 'cruiseCtrlSpeedHUD'))
NONE_SPEED = (0, 255, 65535)

PROBE_RE = re.compile(r'probe: P\d+ ([a-z0-9-]+) #\d+ t=([\d.]+): (.*?)(?: \(\+\d+ folded\))?(?: \(the last line for this field\))?$')
PROBE_FIRST_RE = re.compile(r'probe: first P\d+ ([a-z0-9-]+) t=([\d.]+): (.*)$')
RV_RE = re.compile(r'rv: (?:first|change) ([a-z0-9-]+) t=([\d.]+): (.*?)(?: \(the last change line for this source\))?$')
ASK_RE = re.compile(r'probe: ask P\d+ assist-avail \(([^)]*)\): (.*)$')
SILENT_RE = re.compile(r'probe: summary (S\d+) \+(\d+)s: silent: (.*)$')
NOTE_RE = re.compile(r'^\s*M(\d+)\b\s*([A-Za-z_]+)?')


def kv(body):
    """'a=1 b=NAME c=-' -> {member: value} (numbers as numbers; '-' is None)."""
    out = {}
    for tok in body.split(' '):
        if '=' not in tok:
            continue
        k, v = tok.split('=', 1)
        v = re.sub(r'\(0x[0-9a-f]+\)$', '', v)
        out[LOG_COLS.get(k, k)] = None if v in ('-', '') else rc.num(v) if rc.num(v) is not None else v
    return out


def read_logs(paths):
    ev, asks, silent = [], [], []
    for p in paths or []:
        with open(p, encoding='utf-8', errors='replace') as fh:
            for line in fh:
                line = line.rstrip('\n')
                m = PROBE_RE.search(line) or PROBE_FIRST_RE.search(line) or RV_RE.search(line)
                if m and m.group(1) in TAG_OF:
                    ev.append({'src': 'log', 'file': os.path.basename(p), 't': float(m.group(2)), 'what': TAG_OF[m.group(1)], 'v': kv(m.group(3))})
                    continue
                m = ASK_RE.search(line)
                if m:
                    asks.append({'why': m.group(1), 'answered': m.group(2).startswith('answered')})
                    continue
                m = SILENT_RE.search(line)
                if m and 'assist-avail' in m.group(3):
                    silent.append({'set': m.group(1), 's': int(m.group(2))})
    return ev, asks, silent


def read_notes(path):
    notes = {}
    if not path:
        return notes
    with open(path, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            m = NOTE_RE.match(line)
            if m and m.group(2) and m.group(2).upper() in LABELS:
                notes[int(m.group(1))] = m.group(2).upper()      # only a known label is kept; any other word is ignored
    return notes


def read_recs(paths):
    """Per recording: the cruise-read fields' values, the cluster's set speed, the marks; times in s since the recording began."""
    out = []
    if not paths:
        return out
    for sid, s in sorted(rc.load(paths).items()):
        ev, speed = [], []
        for tag, f in s.fields.items():
            if tag in TAG_OF:
                for row in f.rows:
                    ev.append({'src': 'rec', 'session': sid, 't': row[0] / 1000.0, 'what': TAG_OF[tag], 'v': row[4]})
        for tag, col in SET_SPEED:
            f = s.fields.get(tag)
            if f and not speed:
                speed = [(row[0] / 1000.0, row[4].get(col)) for row in f.rows if row[4].get(col) is not None]
        out.append({'session': sid, 'sets': (s.header or {}).get('sets', ''), 'ev': sorted(ev, key=lambda e: e['t']), 'speed': speed,
                    'marks': [(t / 1000.0, n) for t, n in s.marks]})
    return out


def at(series, t, max_age=2.0):
    best = None
    for ts, v in series:
        if ts <= t:
            best = (ts, v)
        else:
            break
    return best[1] if best and t - best[0] <= max_age else None


def analyse(logs, recs, notes, asks, silent):
    ev = list(logs)
    for r in recs:
        ev += r['ev']
    avail = [e for e in ev if e['what'] == 'avail']
    res = {'events': len(ev), 'avail_values': len(avail), 'asks': asks, 'silent_summaries': silent}
    # does a unit answer 13203?
    if avail or any(a['answered'] for a in asks):
        res['answers'] = 'yes'
    elif asks or silent:
        res['answers'] = 'no'
    else:
        res['answers'] = 'unknown (the field was not read: S17 / CRUISE off?)'
    seen = lambda key: [e['v'].get(key) for e in avail if e['v'].get(key) is not None]
    res['dcc'] = sorted(set(map(str, seen('proposalAvailabilityDCC'))))
    res['sld'] = sorted(set(map(str, seen('proposalAvailabilitySLD'))))
    res['proposal'] = sorted(set(map(str, seen('proposalAssistFunction'))))
    # the set speed against the cluster's
    match, compared, pairs = 0, 0, []
    for r in recs:
        for e in r['ev']:
            if e['what'] != 'avail':
                continue
            a, c = e['v'].get('valueSetSpeed'), at(r['speed'], e['t'])
            if a is None or c is None or c in NONE_SPEED:
                continue
            compared += 1
            match += 1 if a == c else 0
            pairs.append((round(e['t'], 1), a, c))
    res['set_speed'] = {'compared': compared, 'match': match, 'pairs': pairs[:20]}
    last = lambda what: ([e['v'] for e in ev if e['what'] == what] or [None])[-1]
    res['sla'] = last('sla')
    res['dcc_setting'] = last('dcc')
    res['country'] = last('country')
    offers = [e for e in ev if e['what'] == 'foresight' and e['v'].get('displayOperationTakeOverSuggestionSpeed2') == 'UEBERNAHME_MIT_SET']
    res['set_offer'] = len(offers)
    # the timeline: the marks (with the notes' labels), the values' changes
    tl = []
    for r in recs:
        for t, n in r['marks']:
            tl.append((r['session'], round(t, 1), 'mark', 'M%d %s' % (n, notes.get(n, ''))))
        prev = {}
        for e in r['ev']:
            k = e['what']
            body = ' '.join('%s=%s' % (m, v) for m, v in sorted(e['v'].items()) if v is not None)
            if prev.get(k) == body:
                continue
            prev[k] = body
            c = at(r['speed'], e['t'])
            tl.append((r['session'], round(e['t'], 1), k, body + ('' if c is None else ' | cluster set speed %s' % c)))
    for e in logs:
        tl.append(('log ' + e['file'], e['t'], e['what'], ' '.join('%s=%s' % (m, v) for m, v in sorted(e['v'].items()) if v is not None)))
    res['timeline'] = sorted(tl, key=lambda x: (x[0], x[1]))
    res['verdict'] = verdict(res)
    return res


def state_word(vals, active_note):
    if not vals:
        return 'no value'
    if 'ACTIVE' in vals:
        return 'ACTIVE seen' + active_note
    if vals == ['NOT_EQUIPPED']:
        return 'not equipped'
    return '/'.join(vals)


def verdict(r):
    parts = ['a unit answers 13203: ' + r['answers']]
    parts.append('DCC ' + state_word(r['dcc'], ' (with the cruise used)'))
    parts.append('SLD ' + state_word(r['sld'], ' (with the limiter used)'))
    ss = r['set_speed']
    parts.append('set speed matches the cluster %d of %d' % (ss['match'], ss['compared']) if ss['compared'] else 'set speed not compared (no recording with both)')
    sla = r['sla']
    parts.append('SLA setting ' + ('%s (%s)' % (sla.get('value'), sla.get('availability')) if sla else 'not heard'))
    d = r['dcc_setting']
    parts.append('DCC setting ' + ('%s (%s)' % (d.get('value'), d.get('availability')) if d else 'not heard'))
    parts.append("BMW's SET offer " + ('seen %dx' % r['set_offer'] if r['set_offer'] else 'not seen'))
    return '; '.join(parts)


def markdown(r):
    out = ['# Cruise read (rung 2)', '', '**Verdict:** ' + r['verdict'], '', '| Where | t (s) | What | Value |', '|---|---|---|---|']
    for w, t, k, b in r['timeline'][:400]:
        out.append('| %s | %s | %s | %s |' % (w, t, k, b.replace('|', '/')))
    if len(r['timeline']) > 400:
        out.append('')
        out.append('(%d more lines in cruise_read.json)' % (len(r['timeline']) - 400))
    out += ['', 'Getter asks: ' + (', '.join('%s: %s' % (a['why'], 'answered' if a['answered'] else 'no answer') for a in r['asks']) or 'none'),
            'Summaries naming assist-avail silent: ' + (', '.join('%s +%ds' % (s['set'], s['s']) for s in r['silent_summaries']) or 'none')]
    return '\n'.join(out) + '\n'


def main(argv):
    ap = argparse.ArgumentParser(description='Cruise CR rung 2: does a unit answer the multimodal driver-assistance service?')
    ap.add_argument('--log', nargs='*', default=[])
    ap.add_argument('--rec', nargs='*', default=[])
    ap.add_argument('--notes')
    ap.add_argument('-o', '--out')
    a = ap.parse_args(argv)
    logs, asks, silent = read_logs(a.log)
    r = analyse(logs, read_recs(a.rec), read_notes(a.notes), asks, silent)
    if a.out:
        os.makedirs(a.out, exist_ok=True)
        with open(os.path.join(a.out, 'cruise_read.md'), 'w', encoding='utf-8') as fh:
            fh.write(markdown(r))
        with open(os.path.join(a.out, 'cruise_read.json'), 'w', encoding='utf-8') as fh:
            json.dump(r, fh, indent=1, ensure_ascii=False)
    for w, t, k, b in r['timeline'][:60]:
        print('%-22s %8s  %-9s %s' % (w, t, k, b))
    print('verdict: ' + r['verdict'])
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
