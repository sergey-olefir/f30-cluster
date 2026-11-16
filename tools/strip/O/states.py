"""Package O: drive the bench through every state of docs/AGENT-BRIEF-strip.md section 4.2 ("Ours") and snapshot each.

    python3 tools/strip/O/states.py <out root> [layout ...] [--only state,state]     (BENCH_PORT, default 8161)

Layouts: wb_dials ("6WB Comfort + G20") and wb_sport_dials ("6WB Sport + G20"); modes: the one bottomRow setting,
allG20 and all6WB. Each (layout, mode) group starts from POST /restart, because _rowFail is a sticky latch (brief
section 3): the "unread" state (no check-control message ever read, the owner's 69.png) can only be had right after a
restart, and the two latched states are each followed by another restart.

Every state is a list of steps: signals (manual SOME/IP values: gear 0 = P, rpm 0 = engine off), fake scenes
(bench/fake-signs.js) and raw fake parts. A snapshot (snap.py) is taken once the probe shows what the state needs.
Writes <out>/<layout>/<mode>/<state>/ and an index.json of what was asked and what the engine reported.
No string the car would show is written beyond the bench's own fake scenes (which are invented, not the car's).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import benchio as B   # noqa: E402
import snap as SN     # noqa: E402

DRIVE = {'rpm': 1500, 'speed': 50, 'gear': 3, 'oil': 95, 'coolant': 90, 'ambient': 22, 'range': 368, 'fuelL': 40}
PARK = dict(DRIVE, rpm=800, speed=0, gear=0)
STANDBY = dict(DRIVE, rpm=0, speed=0, gear=0, engine=0)
# strip integration (2026-11-16): Cyrillic and the Latin accents are baked now (wb_road, wb_msg), so the string that
# latches is Greek (invented); "p-engine-off" is photo 63's state (VehicleCondition 7) and "standby" BMW's real one
# (condition 5, package X's COND_STANDBY, held 1 s); every state but "unread" and "no-zone" feeds the car's time zone,
# so all6WB is the whole row ours (package X: no zone, the row waits, BMW's); "msg-gap" holds our first draw back
# (bench/run-app.js hook ccHold) to see BMW's panel open through the mask's msg lane
P63 = dict(STANDBY, condition=7)
STANDBY = dict(STANDBY, condition=5)
CYR = 'Ελέγξτε την πίεση των ελαστικών'

BASE = [('sig', DRIVE), ('scene', 'limit-50'), ('scene', 'road-street'), ('scene', 'clock-plus2')]
NOZONE = [('sig', DRIVE), ('scene', 'limit-50'), ('scene', 'road-street'), ('scene', 'clock-none')]

# name -> (steps, wait-for predicate on the probe's "signs", note)
STATES = [
    ('unread', NOZONE, lambda s: s['sign']['state'] == 'limit', 'D, limit 50, road label, NO message ever read (right after a restart): 69.png'),
    ('no-zone', NOZONE + [('scene', 'cc-clear')], lambda s: s['cc']['shown'] is False, 'as drive, but no time zone: all6WB waits, BMW\'s row'),
    ('drive', BASE + [('scene', 'cc-clear')], lambda s: s['cc']['shown'] is False, 'D, limit 50, road label, a message read and cleared'),
    ('drive-clock', BASE + [('scene', 'cc-clear'), ('scene', 'clock-plus2')], lambda s: s['cc']['shown'] is False and s.get('tzCar') is not None, 'as drive, the car\'s time zone known (+2 h)'),
    ('park', [('sig', PARK), ('scene', 'limit-50'), ('scene', 'road-street'), ('scene', 'clock-none'), ('scene', 'cc-clear')], lambda s: s['cc']['shown'] is False, 'P, engine running'),
    ('msg', BASE + [('scene', 'cc-red')], lambda s: s['cc']['shown'] is True, 'D, a short message (two lines: name + description)'),
    ('msg-long', BASE + [('scene', 'cc-long')], lambda s: s['cc']['shown'] is True and s['cc']['parsed']['desc'] > 120, 'D, the longest fake message'),
    ('limit-unknown', BASE + [('scene', 'cc-clear'), ('scene', 'limit-unknown')], lambda s: s['sign']['state'] == 'unknown', 'BMW\'s empty sign "---"'),
    ('limit-end', BASE + [('scene', 'cc-clear'), ('scene', 'limit-end')], lambda s: s['sign']['state'] == 'end', 'end of limit'),
    ('limit-none', BASE + [('scene', 'cc-clear'), ('scene', 'limit-none')], lambda s: s['sign']['state'] == 'none', 'no sign'),
    ('nopass', BASE + [('scene', 'cc-clear'), ('scene', 'nopass-car')], lambda s: s['sign'].get('np') == 'car', 'limit 80 + no overtaking'),
    # NOT BMW's standby (package P, 2026-11-16): photo 63 is P with the engine off and BMW still draws its NORMAL row;
    # only photo 65 shows the standby row (car signal VehicleCondition, 5 = WOHNEN: hypothesis). This is "P + rpm 0
    # as the app treats it today" (hud.js cut.cover 'limit': P and rpm < 150 close the sign window).
    ('p-engine-off', [('sig', P63), ('scene', 'limit-50'), ('scene', 'road-street'), ('scene', 'clock-plus2'), ('scene', 'cc-clear'), ('wait', 1.5)], lambda s: s['cc']['shown'] is False, 'P, engine off, condition 7 (photo 63: BMW draws its NORMAL row, sign included)'),
    ('standby', [('sig', STANDBY), ('scene', 'limit-none'), ('scene', 'road-street'), ('scene', 'clock-plus2'), ('scene', 'cc-clear'), ('wait', 1.5)], lambda s: s['row']['standby'] is True, 'BMW\'s standby (condition 5, held 1 s): BMW\'s standby row in both modes'),
    ('standby-msg', [('sig', STANDBY), ('scene', 'limit-none'), ('scene', 'clock-plus2'), ('scene', 'cc-red'), ('wait', 1.5)], lambda s: s['row']['standby'] is True and s['cc']['shown'] is True, 'standby with a message: BMW\'s panel open'),
    ('msg-gap', [('wait', 1.5), ('hook', 'ccHold'), ('scene', 'cc-yellow')], lambda s: s['cc']['shown'] is True, 'D, a message arrived and our first draw is held back (the safety gap): BMW\'s panel open'),
    # latched: last in the group, each followed by a restart
    ('msg-latched', BASE + [('scene', 'cc-clear'), ('cc', {'name': CYR, 'desc': CYR, 'color': 'yellow', 'symbol': 44})],
     lambda s: s['cc']['shown'] is True and bool((s.get('fail') or {})), 'a message with no glyph in our fonts: the field latches back to BMW'),
    ('road-latched-msg', [('sig', DRIVE), ('scene', 'limit-50'), ('scene', 'clock-plus2'), ('scene', 'cc-clear'),
                          ('road', {'text': CYR}), ('wait', 2.0), ('scene', 'cc-red')],
     lambda s: s['cc']['shown'] is True and bool((s.get('fail') or {})), 'a road label with no glyph latched nav first, then a message'),
]
LATCHED = ('msg-latched', 'road-latched-msg')
LAYOUT_SET = {'wb_dials': 'wb_comfort', 'wb_sport_dials': 'wb_comfort'}
ACTIVE = {'wb_dials': 'wb_dials', 'wb_sport_dials': 'wb_dials'}


def apply(steps):
    for kind, v in steps:
        if kind == 'sig':
            B.signals(v)
        elif kind == 'scene':
            B.scene_name(v)
        elif kind == 'cc':
            B.fake({'cc': v})
        elif kind == 'road':
            B.fake({'road': v})
        elif kind == 'wait':
            time.sleep(v)
        elif kind == 'hook':
            B.fake({'hook': v})
        time.sleep(0.25)


DATA = os.environ.get('O_BENCH_DATA', '')
HERE_LAYOUTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'apps', 'f30_cluster', 'hud', 'layouts')


def override(layout):
    """6WB Sport + G20 is no longer offered (hud.js G20_OF has only Comfort, and the kit's settings refuse the old value), so
    it is drawn through the bench's data-folder override: wb_sport_dials.json saved as <data>/layouts/wb_dials.json, which the
    app loads in place of the built-in wb_dials (bench/README.md "Live reload"). Every other layout runs with no override."""
    if not DATA:
        if layout != 'wb_dials':
            raise SystemExit('set O_BENCH_DATA to the bench\'s BENCH_DATA_DIR to draw ' + layout)
        return
    d = os.path.join(DATA, 'layouts')
    os.makedirs(d, exist_ok=True)
    f = os.path.join(d, 'wb_dials.json')
    if layout == 'wb_sport_dials':
        open(f, 'w').write(open(os.path.join(HERE_LAYOUTS, 'wb_sport_dials.json')).read())
    elif os.path.exists(f):
        os.remove(f)


def ready_layout(layout, mode, restart=True):
    override(layout)
    if restart:
        B.restart()
        time.sleep(4)
        B.until(lambda q: q.get('ready') and q.get('activeName'), 90)
    p = B.probe()
    want_hud = LAYOUT_SET[layout]
    if p['settings'].get('hudLayout') != want_hud:
        B.set_choice('hudLayout', want_hud)
        p = B.until(lambda q: q['settings'].get('hudLayout') == want_hud, 20)
    if not p['settings'].get('g20'):
        B.click('SET_G20')
        p = B.until(lambda q: q['settings'].get('g20') is True, 20)
    if p['settings'].get('bottomRow') != mode:
        B.set_choice('bottomRow', mode)
        p = B.until(lambda q: q['settings'].get('bottomRow') == mode, 20)
    if not p['settings'].get('byMode'):
        B.click('SET_BYMODE')
        p = B.until(lambda q: q['settings'].get('byMode') is True, 20)
    p = B.until(lambda q: q.get('activeName') == ACTIVE[layout], 30)
    if not p or p.get('activeName') != ACTIVE[layout]:
        raise SystemExit('could not reach %s (at %s)' % (layout, p and p.get('activeName')))
    return p


def run(root, layouts, only=None):
    index = []
    for layout in layouts:
        for mode in ('allG20', 'all6WB'):
            ready_layout(layout, mode)
            for name, steps, pred, note in STATES:
                if only and name not in only:
                    continue
                if name in LATCHED:
                    ready_layout(layout, mode)
                B.signals(DRIVE)
                apply(steps)
                p = B.until(lambda q: pred(q['signs']), 12)
                ok = bool(p and pred(p['signs']))
                time.sleep(1.2)     # let the layout rebuild (own:* flips rebuild it) and the scene settle
                p = B.probe()
                out = os.path.join(root, layout, mode, name)
                m = SN.snap(out, '%s/%s/%s' % (layout, mode, name), probe=p)
                s = p['signs']
                row = {'layout': layout, 'mode': mode, 'state': name, 'note': note, 'reached': ok,
                       'activeName': p.get('activeName'), 'own': s.get('own'), 'fail': s.get('fail'),
                       'cc_shown': s['cc']['shown'], 'sign': s['sign']['state'], 'tzCar': s.get('tzCar'),
                       'widgets': s.get('widgets'), 'patches': s.get('patches'), 'pixels': m.get('pixels'),
                       'status': (p.get('status') or '')}
                index.append(row)
                print('%-15s %-7s %-17s reached=%s own=%s fail=%s widgets=%d' % (layout, mode, name, ok, json.dumps(s.get('own')),
                                                                             json.dumps(s.get('fail')), len(s.get('widgets') or [])), flush=True)
                if name == 'msg-gap':
                    B.fake({'hook': 'ccRelease'})
    # leave the bench un-latched
    B.restart()
    os.makedirs(root, exist_ok=True)
    old = []
    f = os.path.join(root, 'index.json')
    if os.path.exists(f) and only:
        old = [r for r in json.load(open(f)) if not any(r['layout'] == n['layout'] and r['mode'] == n['mode'] and r['state'] == n['state'] for n in index)]
    json.dump(old + index, open(f, 'w'), indent=1)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    only = None
    for a in sys.argv[1:]:
        if a.startswith('--only='):
            only = set(a[7:].split(','))
    run(args[0], args[1:] or ['wb_dials', 'wb_sport_dials'], only)
