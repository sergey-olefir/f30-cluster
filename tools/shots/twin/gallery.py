"""tools/shots/twin: the folder a run leaves: results.json, summary.json, failed.json, compare.md and index.html.

index.html is one self-contained page (no server, no external resource; works from file://): the pictures grouped by
set, each card with its audit verdict, a text filter, a click for full size with the picture's choice of views (car /
ours alone on black / the comparison with the mockup) and every check's number. Standard library only.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compare as CP   # noqa: E402

SET_NAME = {'A': 'A. The matrix: {day, night} x {no message, ours, window, blind} x {clock, trip} x {engine off, ready, driving}',
            'B': "B. The mockup's own scenes (M2 trip at speed, M3 door message); M1 and M4 are matrix cells",
            'C': 'C. The dial laws: needle angle against SPEC 5.1 and 5.2', 'D': 'D. Settings: demo, redline, band level'}
BAD_LOG = re.compile(r'too many|pixel memory is full|over the layer cap|uncaught|app exited|build failed|refus|ERROR|protocol', re.I)
BENIGN_LOG = re.compile(r'emulator: no SOME/IP')

PAGE = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>twin_dial states</title>
<style>
:root { --bg:#111316; --fg:#e8e8e8; --dim:#9aa0a6; --card:#1b1e22; --line:#2c3036; --acc:#6cb6ff; --ok:#5fc27e; --bad:#f47067; --warn:#e3b341; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
header { position:sticky; top:0; z-index:5; background:rgba(17,19,22,.96); border-bottom:1px solid var(--line); padding:10px 16px; display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; }
header h1 { font-size:15px; margin:0; font-weight:600; }
header input { flex:1 1 260px; min-width:0; background:var(--card); color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:6px 9px; font:inherit; }
.stat { color:var(--dim); }
main { padding:8px 16px 40px; }
h2 { font-size:14px; margin:22px 0 6px; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:10px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:6px; overflow:hidden; cursor:zoom-in; }
.card img { display:block; width:100%; aspect-ratio:8/3; object-fit:cover; background:#000; }
.cap { padding:5px 7px 7px; font-size:11.5px; color:var(--dim); word-break:break-word; }
.cap b { color:var(--fg); font-weight:600; }
.pill { display:inline-block; font-size:10.5px; padding:0 5px; border-radius:3px; margin-right:4px; border:1px solid var(--line); }
.pill.ok { color:var(--ok); border-color:#25503a; } .pill.bad { color:var(--bad); border-color:#5a2a26; } .pill.warn { color:var(--warn); border-color:#5a4a1c; }
.hidden { display:none !important; }
#lb { position:fixed; inset:0; background:rgba(0,0,0,.94); z-index:10; display:none; overflow:auto; padding:12px; }
#lb.on { display:block; }
#lb img { max-width:100%; display:block; margin:0 auto; background:#000; }
#lb .bar { text-align:center; margin:6px 0; } #lb button { background:var(--card); color:var(--dim); border:1px solid var(--line); padding:5px 10px; border-radius:5px; cursor:pointer; margin:0 3px; font:inherit; }
#lb button.on { background:var(--acc); color:#0b1a2a; }
#lb table { border-collapse:collapse; margin:10px auto; font-size:12px; } #lb td, #lb th { border:1px solid var(--line); padding:3px 7px; text-align:left; }
#lb .x { position:fixed; top:8px; right:14px; font-size:22px; background:none; border:0; color:var(--fg); }
tr.f td { color:var(--bad); } tr.w td { color:var(--warn); }
</style></head><body>
<header><h1>twin_dial: every state <span class="stat" id="app"></span></h1><input type="search" id="q" placeholder="Filter: day, night, ours, window, blind, trip, law_speed, FAIL">
<span class="stat" id="stat"></span></header>
<main id="main"></main>
<div id="lb"><button class="x">&times;</button><div class="bar" id="bar"></div><img alt=""><div id="info"></div></div>
<script>
const D = __DATA__;
const main = document.getElementById('main'), lb = document.getElementById('lb'), img = lb.querySelector('img'), bar = document.getElementById('bar'), info = document.getElementById('info');
document.getElementById('app').textContent = '(app: ' + D.which + ', ' + D.when + ')';
let cur = null, view = 'car';
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function failed(e) { return e.checks.filter(c => !c.ok && !c.warn); }
function warned(e) { return e.checks.filter(c => !c.ok && c.warn); }
function card(e) {
  const f = failed(e), c = document.createElement('div');
  c.className = 'card'; c.dataset.q = (e.id + ' ' + (e.cc_state || '') + ' ' + (f.length ? 'FAIL' : 'PASS')).toLowerCase();
  c.innerHTML = '<img loading="lazy" src="' + e.files.thumb + '"><div class="cap"><b>' + esc(e.name) + '</b><br>' +
    '<span class="pill ' + (f.length ? 'bad' : 'ok') + '">' + (f.length ? f.length + ' check(s) fail' : e.checks.length + ' checks pass') + '</span>' +
    (warned(e).length ? '<span class="pill warn">' + warned(e).length + ' warning</span>' : '') + '<span class="pill warn">cc ' + esc(e.cc_state || 'n/a') + '</span>' + (e.mockup ? '<span class="pill">vs mockup</span>' : '') + '</div>';
  c.onclick = () => open(e);
  return c;
}
function show() {
  if (!cur) return;
  const f = cur.files;
  img.src = view === 'cmp' && f.cmp ? f.cmp : view === 'ours' ? f.ours : f.car;
  bar.innerHTML = [['car', 'car (ours over BMW\'s parts)'], ['ours', 'ours alone on black'], ['cmp', 'ours | mockup | difference']].filter(v => v[0] !== 'cmp' || f.cmp)
    .map(v => '<button data-v="' + v[0] + '" class="' + (v[0] === view ? 'on' : '') + '">' + v[1] + '</button>').join('') + ' <b>' + esc(cur.id) + '</b>';
  bar.querySelectorAll('button').forEach(b => b.onclick = () => { view = b.dataset.v; show(); });
  let h = '<table><tr><th>check</th><th>value</th><th>limit</th><th>note</th></tr>' + cur.checks.map(c =>
    '<tr class="' + (c.ok ? '' : c.warn ? 'w' : 'f') + '"><td>' + (c.ok ? 'ok ' : c.warn ? 'WARN ' : 'FAIL ') + esc(c.name) + '</td><td>' + esc(JSON.stringify(c.value)) + '</td><td>' + esc(c.limit) + '</td><td>' + esc(c.note) + '</td></tr>').join('') + '</table>';
  if (cur.mockup) {
    const cols = ['mae', 'diff', 'ink_ratio', 'd_centroid', 'rec2', 'prec2', 'colour_dE'];
    h += '<table><tr><th>region vs ' + esc(cur.mockup.file) + '</th>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr>' +
      Object.keys(cur.mockup.regions).map(k => '<tr><td>' + esc(k) + '</td>' + cols.map(c => '<td>' + esc(cur.mockup.regions[k][c] === null || cur.mockup.regions[k][c] === undefined ? '-' : JSON.stringify(cur.mockup.regions[k][c])) + '</td>').join('') + '</tr>').join('') + '</table>';
  }
  h += '<div class="stat" style="text-align:center">probe: ' + esc(JSON.stringify(cur.probe || {})) + '</div>';
  info.innerHTML = h;
}
function open(e) { cur = e; view = 'car'; lb.classList.add('on'); show(); }
lb.querySelector('.x').onclick = () => lb.classList.remove('on');
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') lb.classList.remove('on'); });
Object.keys(D.sets).forEach(s => {
  const es = D.pictures.filter(e => e.set === s);
  if (!es.length) return;
  const h = document.createElement('h2'); h.textContent = D.sets[s] + ' (' + es.length + ')'; main.appendChild(h);
  const g = document.createElement('div'); g.className = 'grid'; es.forEach(e => g.appendChild(card(e))); main.appendChild(g);
});
if (D.failed.length) { const h = document.createElement('h2'); h.textContent = 'Not produced (' + D.failed.length + ')'; main.appendChild(h);
  const p = document.createElement('pre'); p.className = 'stat'; p.textContent = D.failed.map(f => f.id + ': ' + JSON.stringify(f.reason)).join('\n'); main.appendChild(p); }
const q = document.getElementById('q'), stat = document.getElementById('stat');
function filt() { const t = q.value.toLowerCase().trim(); let n = 0; document.querySelectorAll('.card').forEach(c => { const ok = !t || c.dataset.q.indexOf(t) >= 0; c.classList.toggle('hidden', !ok); if (ok) n++; }); stat.textContent = n + ' pictures, ' + D.pictures.filter(e => failed(e).length).length + ' with a failing check'; }
q.oninput = filt; filt();
</script></body></html>
'''


def assemble(out, planned, results, rendered, logs, still, wall, which, config):
    res_f = os.path.join(out, 'results.json')
    old = {}
    if os.path.exists(res_f):
        for e in json.load(open(res_f))['pictures']:
            old[e['id']] = e
    redo = set(j['id'] for j in planned)
    for i in redo:
        old.pop(i, None)
    entries, failed = dict(old), []
    for j in planned:
        r, rr = results.get(j['id']), rendered.get(j['id'])
        if not r or not r.get('ok'):
            failed.append({'id': j['id'], 'reason': (r or {}).get('reason') or ['never run'], 'probe': (r or {}).get('probe')})
            continue
        if not rr or rr.get('error'):
            failed.append({'id': j['id'], 'reason': ['render failed: %s' % ((rr or {}).get('error') or 'no result'), (rr or {}).get('trace')], 'probe': r.get('probe')})
            continue
        rr = dict(rr)
        rr.update({'probe': r['probe'], 'stable': r.get('stable'), 'drive_secs': r.get('secs'), 'state': {k: v for k, v in j['state'].items() if k != 'sig'}})
        entries[j['id']] = rr
    order = {}
    pics = sorted(entries.values(), key=lambda e: (e['set'], e['id']))
    ff = os.path.join(out, 'failed.json')
    if os.path.exists(ff):
        failed = [f for f in json.load(open(ff)) if f['id'] not in redo and f['id'] not in entries] + failed
    json.dump(failed, open(ff, 'w'), indent=1, ensure_ascii=False)
    # the checks, by name
    by = {}
    for e in pics:
        for c in e['checks']:
            k = by.setdefault(c['name'], {'pass': 0, 'fail': 0, 'warn': bool(c.get('warn')), 'failing': []})
            k['pass' if c['ok'] else 'fail'] += 1
            if not c['ok'] and len(k['failing']) < 12:
                k['failing'].append(e['id'])
    bad = []
    for fn in sorted(os.listdir(logs)):
        if fn.startswith('bench-'):
            for ln in open(os.path.join(logs, fn), errors='replace'):
                if BAD_LOG.search(ln) and not BENIGN_LOG.search(ln):
                    bad.append(fn + ': ' + ln.strip()[:300])
    summary = {'out': out, 'when': __import__('time').strftime('%Y-%m-%d %H:%M:%S'), 'app': which, 'config_patch': config, 'wall_secs': round(wall),
               'planned_now': len(planned), 'pictures': len(pics), 'failed_jobs': len(failed),
               'pictures_with_failing_check': [e['id'] for e in pics if not e['ok']], 'pictures_with_warning': [e['id'] for e in pics if any((not c['ok']) and c.get('warn') for c in e['checks'])], 'checks': by,
               'unstable': [e['id'] for e in pics if e.get('stable') is False and not (e.get('state') or {}).get('demo')],
               'bench_log_problems': bad[:40], 'ports_still_listening': still,
               'engine_cc_state_exposed': sum(1 for e in pics if e.get('cc_state')) > 0,
               'engine_missing_signals': sorted(set(sum([((e.get('probe') or {}).get('missing') or []) for e in pics], []))),
               'repeat': 'UV_CACHE_DIR=%s uv run -q --no-project --with numpy --with pillow --with moderngl python -I tools/shots/twin/run.py'
                         % os.path.realpath(os.path.join(HERE, '..', '..', '..', 'bake', 'work', '.uvcache'))}
    json.dump({'about': 'tools/shots/twin/run.py: one entry per picture; "checks" are numbers against limits (tools/strip/O/twin_audit.py, tpaint.py)',
               'which': which, 'pictures': pics}, open(res_f, 'w'), indent=1, ensure_ascii=False)
    json.dump(summary, open(os.path.join(out, 'summary.json'), 'w'), indent=1, ensure_ascii=False)
    # the mockup comparison
    md = ['# Rendered state against the mockup', '', 'App: **%s**. Numbers per region (see tools/shots/twin/compare.py for what each means).' % which, '']
    for e in pics:
        if e.get('mockup'):
            md += ['## %s vs %s' % (e['id'], e['mockup']['file']), '', CP.table(e['mockup']['regions']), '']
    open(os.path.join(out, 'compare.md'), 'w').write('\n'.join(md))
    data = {'which': which, 'when': summary['when'], 'sets': SET_NAME, 'pictures': pics, 'failed': failed}
    open(os.path.join(out, 'index.html'), 'w').write(PAGE.replace('__DATA__', json.dumps(data, ensure_ascii=False).replace('</', '<\\/')))
    print(json.dumps({k: summary[k] for k in ('app', 'wall_secs', 'pictures', 'failed_jobs', 'ports_still_listening')}), flush=True)
    print('pictures with a failing check: %d' % len(summary['pictures_with_failing_check']), flush=True)
