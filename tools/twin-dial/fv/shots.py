"""tools/twin-dial/fv: the front-vehicle test mode's states as bench pictures (front-vehicle FV, docs/twin-dial/FV-SPEC.md).

    UV_CACHE_DIR=$F30/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl \\
        python -I tools/twin-dial/fv/shots.py [--out <folder>] [--benches 2] [--port 8962]

The state gallery's own machinery (tools/shots/twin/run.py: a bounded bench per port, the driver tdrive.py, the moderngl
render pool tpaint.py) with this file's scenes instead of scenes.plan(): the REAL apps/twin_dial with the Діагностика setting
"Авто попереду (тест)" on, GapVehicleAhead.DataFrontVehicle fed through POST /fake {front} (bench/fake-signs.js), day and night,
every state of the brief's 1.3 (absent, no target, five gap levels, near, closing, closing fast, with cruise and the limiter,
the pictogram on another tab), plus the baseline with the test off. Ports 8962 and up (this agent's 8960-8969).

The bench pictures hold the state still: BENCH_CONFIG sets frontVehicle.staleMs to 10 minutes (a fed value would otherwise go
stale 2 s later, before the snapshot) and absentMs to 3 s; the stale state itself is the no-target picture (the tests prove it).
Output (git-ignored): bake/work/front-vehicle/shots/<YYYYMMDD-HHMM>/ as run.py writes it (F/<name>.png, .ours.png, index.html).
Every value fed is made up; the gaps are inside the raw range the car showed (57..1736), 4093 its parked "no target".
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
TW = os.path.join(ROOT, 'tools', 'shots', 'twin')
for p in (os.path.join(ROOT, 'tools', 'shots'), TW):      # tools/shots/twin first: tools/shots has its own run.py and scenes.py
    if p in sys.path:
        sys.path.remove(p)
    sys.path.insert(0, p)
import run as RUN          # noqa: E402  (tools/shots/twin/run.py)
import scenes as SC        # noqa: E402

SPEED = 87                 # the matrix's driving speed: at 24.2 m/s and the assumed 0.1 m a unit, the levels are
GAPS = {5: 900, 4: 600, 3: 400, 2: 280, 1: 150}      # 90 / 60 / 40 / 28 / 15 m = 3.7 / 2.5 / 1.65 / 1.16 / 0.62 s (levels.timeGap 0.9 1.4 2.0 3.0, hyst 12 %)
CONFIG = {'trip': {'factors': {'bc': 1, 'speed': 0.1, 'cons': 0.1, 'way': 0.1}}, 'twin': {'media': True},
          'frontVehicle': {'staleMs': 600000, 'absentMs': 3000}}


def front(gap, obj=7, speed=1500, qual=0):
    return {'front': {'gap': gap, 'speed': speed, 'obj': obj, 'qual': qual}}


def seq(gaps, dt=0.15, obj=7):
    """A run of values dt apart (the gap's slope is what "closing" reads)."""
    out = []
    for g in gaps:
        out.append(front(g, obj))
        out.append({'sleep': dt})
    return out


def steady(level, n=4):
    return seq([GAPS[level]] * n, 0.12)


def plan():
    def e(tag, fakes=None, look='day', fv=True, tab='1', extra=None, **kw):
        st = SC.state(tag=tag, look=look, sig={'speed': SPEED, 'rpm': 2300, 'gear': 3}, **kw)
        st['fakes'] = fakes or []
        st['settings'] = dict({'tab': tab, 'diagFrontVehicle': 'on' if fv else 'off'}, **(extra or {}))
        return SC.job('F', st, expect={})

    cru = SC.hud_fake('LDM_SYM_DCC', 'LDM_ACTIVE', 90, SPEED)
    cru_off = SC.hud_fake('LDM_SYM_DCC', 'LDM_OFF', 90, SPEED)
    lim = SC.hud_fake('LDM_SYM_SLD', 'LDM_ACTIVE', 110, SPEED)
    groups = []
    for look in ('day', 'night'):
        n = '%s_' % look
        groups.append([e(n + '00_off', [cru], look, fv=False)])
        # absent: the test on, nothing ever fed (absentMs 3 s on the bench), then nothing ahead (the parked 4093)
        groups.append([e(n + '01_absent', [cru, {'sleep': 3.5}], look),
                       e(n + '02_none', [cru, front(4093, 255, 4093, 2), {'sleep': 0.3}], look)])
        groups.append([e(n + '03_level5', [cru] + steady(5), look), e(n + '04_level4', [cru] + steady(4), look),
                       e(n + '05_level3', [cru] + steady(3), look), e(n + '06_level2', [cru] + steady(2), look),
                       e(n + '07_level1_near', [cru] + steady(1), look)])
        # closing: the gap shrinks about 1.5 m/s at level 2; fast: about 11 m/s, from level 3 down to 2
        groups.append([e(n + '08_closing', [cru] + seq([300, 298, 295, 293, 290, 288, 285, 283, 280]), look)])
        groups.append([e(n + '09_fast', [cru] + seq([420, 400, 380, 360, 340, 320, 300, 280, 268]), look)])
        groups.append([e(n + '10_cruise_standby', [cru_off] + steady(3), look), e(n + '11_limiter', [lim] + steady(3), look),
                       e(n + '12_no_cruise', [SC.hud_fake('LDM_SYM_NONE', 'LDM_OFF', 65535, SPEED)] + steady(3), look)])
        # the pictogram on another tab (media), and with a message on tab 2 (the machine's page; the pictogram stays in the hub)
        groups.append([e(n + '13_tab3', [cru] + SC.media_fakes(4) + steady(2), look, tab='3')])
    return groups


def main():
    if '--port' in sys.argv:
        RUN.PORT0 = int(sys.argv[sys.argv.index('--port') + 1])
    else:
        RUN.PORT0 = 8962
    if not 8960 <= RUN.PORT0 <= 8969 - int(RUN.arg('--benches', '2')) + 1:
        raise SystemExit('ports 8960-8969 only')
    SC.plan = plan
    argv = [sys.argv[0], '--real', '--config', json.dumps(CONFIG), '--benches', RUN.arg('--benches', '2'), '--render', '2', '--keep']
    out = RUN.arg('--out') or os.path.join(ROOT, 'bake', 'work', 'front-vehicle', 'shots', time.strftime('%Y%m%d-%H%M'))
    argv += ['--out', out]
    sys.argv = argv
    RUN.main()


if __name__ == '__main__':
    main()
