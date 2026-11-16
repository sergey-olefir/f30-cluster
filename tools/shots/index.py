"""tools/shots: index.html, the contact sheet of a run. One self-contained page (no server, no external resource):
thumbnails grouped by set and context (set A also by axis), a text filter over the captions, a switch between the car
and the matte backdrop, click for full size (arrow keys step, Esc closes). Folded pictures are listed as a line under
their group: "no visible effect" (identical to the context's baseline) or "same as ..."."""
import json
import os

SET_NAME = {'A': 'A. One-factor sweeps', 'B': 'B. Pairwise interactions', 'C': 'C. Scenarios', 'D': 'D. Diagnostics'}
KEYS = ('id', 'set', 'context', 'axis', 'value', 'name', 'caption', 'file', 'matte', 'thumb', 'matte_thumb', 'same_as',
        'no_visible_effect', 'backdrop', 'backdrop_matches', 'stable', 'coverage', 'strip_coverage')

PAGE = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>f30_cluster shots</title>
<style>
:root { --bg: #111316; --fg: #e8e8e8; --dim: #9aa0a6; --card: #1b1e22; --line: #2c3036; --acc: #6cb6ff; --warn: #e3b341; --bad: #f47067; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
header { position: sticky; top: 0; z-index: 5; background: rgba(17,19,22,.96); border-bottom: 1px solid var(--line); padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
header h1 { font-size: 15px; margin: 0; font-weight: 600; }
header input[type=search] { flex: 1 1 260px; min-width: 0; background: var(--card); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 9px; font: inherit; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.seg button { background: var(--card); color: var(--dim); border: 0; padding: 6px 10px; font: inherit; cursor: pointer; }
.seg button.on { background: var(--acc); color: #0b1a2a; }
.stat { color: var(--dim); }
main { padding: 8px 16px 40px; }
h2 { font-size: 15px; margin: 22px 0 6px; }
h3 { font-size: 13px; margin: 14px 0 6px; color: var(--acc); font-weight: 600; }
h4 { font-size: 12px; margin: 10px 0 4px; color: var(--dim); font-weight: 600; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; cursor: zoom-in; }
.card img { display: block; width: 100%; aspect-ratio: 8 / 3; object-fit: cover; background: #000; }
.cap { padding: 5px 7px 7px; font-size: 11.5px; color: var(--dim); word-break: break-word; }
.cap b { color: var(--fg); font-weight: 600; }
.tag { display: inline-block; font-size: 10.5px; padding: 0 5px; border-radius: 3px; margin-right: 4px; border: 1px solid var(--line); }
.tag.bd { color: var(--warn); border-color: #5a4a1c; }
.tag.un { color: var(--bad); border-color: #5a2a26; }
.folded { margin: 6px 0 2px; color: var(--dim); font-size: 11.5px; }
.folded a { color: var(--dim); text-decoration: underline dotted; cursor: pointer; }
.hidden { display: none !important; }
table { border-collapse: collapse; margin: 6px 0 12px; font-size: 12px; }
td, th { border: 1px solid var(--line); padding: 3px 7px; text-align: right; }
td:first-child, th:first-child { text-align: left; }
#lb { position: fixed; inset: 0; background: rgba(0,0,0,.93); z-index: 10; display: none; flex-direction: column; align-items: center; justify-content: center; padding: 12px; }
#lb.on { display: flex; }
#lb img { max-width: 100%; max-height: 72vh; image-rendering: auto; }
#lb .lcap { max-width: 1200px; margin-top: 10px; color: var(--fg); font-size: 12.5px; text-align: center; }
#lb pre { max-width: 1200px; max-height: 18vh; overflow: auto; color: var(--dim); font-size: 11px; white-space: pre-wrap; margin: 8px 0 0; }
#lb .x { position: absolute; top: 8px; right: 14px; color: var(--fg); font-size: 22px; cursor: pointer; background: none; border: 0; }
.fail { color: var(--bad); }
details summary { cursor: pointer; color: var(--dim); }
</style></head><body>
<header>
  <h1>f30_cluster: every state</h1>
  <input type="search" id="q" placeholder="Filter: e.g. cc-red, standby, missing glyph, night">
  <span class="seg"><button id="bcar" class="on">car</button><button id="bmatte">matte</button></span>
  <span class="stat" id="stat"></span>
</header>
<main id="main"></main>
<div id="lb"><button class="x" title="Close">&times;</button><img alt=""><div class="lcap"></div><pre></pre></div>
<script>
const DATA = __DATA__;
const SET_NAME = __SETS__;
let backdrop = 'car';
const main = document.getElementById('main');
const byId = {};
DATA.pics.forEach(p => { byId[p.id] = p; });
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function srcOf(p, full) {
  if (backdrop === 'matte' && p.matte) return full ? p.matte : p.matte_thumb;
  return full ? p.file : p.thumb;
}
const cards = [];
function card(p) {
  const c = el('div', 'card');
  const img = el('img'); img.loading = 'lazy'; img.alt = p.id; img.src = srcOf(p, false);
  c.appendChild(img);
  const cap = el('div', 'cap');
  const t = el('b', null, (p.set === 'A' ? p.axis + ' = ' + p.value : p.name)); cap.appendChild(t); cap.appendChild(document.createElement('br'));
  if (!p.backdrop_matches) { const g = el('span', 'tag bd', 'photo ' + p.backdrop + ' does not match'); g.title = 'BMW\'s side is a fixed photo of the stock cluster; it does not follow the fed signals'; cap.appendChild(g); }
  else cap.appendChild(el('span', 'tag', 'photo ' + p.backdrop));
  if (p.stable === false) cap.appendChild(el('span', 'tag un', 'scene still moving'));
  cap.appendChild(document.createTextNode(p.caption || ''));
  c.appendChild(cap);
  c.onclick = () => open(p);
  c._p = p; c._img = img;
  c.dataset.text = (p.id + ' ' + (p.caption || '')).toLowerCase();
  cards.push(c);
  return c;
}
function folded(list) {
  const d = el('div', 'folded');
  list.forEach((p, i) => {
    const a = el('a', null, (p.set === 'A' ? p.axis + '=' + p.value : p.name));
    a.title = p.caption || '';
    a.onclick = () => open(byId[p.same_as] || p, p);
    d.appendChild(a);
    d.appendChild(document.createTextNode(p.no_visible_effect ? ' (no visible effect)' : ' (same as ' + (byId[p.same_as] ? (byId[p.same_as].set === 'A' ? byId[p.same_as].axis + '=' + byId[p.same_as].value : byId[p.same_as].name) : p.same_as) + ')'));
    if (i < list.length - 1) d.appendChild(document.createTextNode(' · '));
  });
  d.dataset.text = list.map(p => (p.id + ' ' + (p.caption || '')).toLowerCase()).join(' ');
  return d;
}
function build() {
  // counts
  const h = el('h2', null, 'Counts'); main.appendChild(h);
  const tb = el('table'); const hr = el('tr');
  ['set / context', 'planned', 'produced', 'folded (same picture)', 'of which no visible effect', 'failed'].forEach(x => hr.appendChild(el('th', null, x)));
  tb.appendChild(hr);
  Object.keys(DATA.summary.counts).sort().forEach(k => {
    const c = DATA.summary.counts[k], tr = el('tr');
    [k, c.planned, c.produced, c.deduplicated, c.no_visible_effect, c.failed].forEach(x => tr.appendChild(el('td', null, String(x))));
    tb.appendChild(tr);
  });
  main.appendChild(tb);
  const groups = {};
  DATA.pics.forEach(p => {
    const k = p.set + '|' + p.context + '|' + (p.set === 'A' ? p.axis : '');
    (groups[k] = groups[k] || []).push(p);
  });
  let lastSet = null, lastCtx = null;
  Object.keys(groups).forEach(k => {
    const [s, ctx, axis] = k.split('|');
    if (s !== lastSet) { main.appendChild(el('h2', 'sec', SET_NAME[s] || s)); lastSet = s; lastCtx = null; }
    if (ctx !== lastCtx) { main.appendChild(el('h3', 'sec', ctx)); lastCtx = ctx; }
    const box = el('div', 'grp');
    if (axis) box.appendChild(el('h4', null, axis));
    const grid = el('div', 'grid');
    const fold = [];
    groups[k].forEach(p => { if (p.file) grid.appendChild(card(p)); else fold.push(p); });
    box.appendChild(grid);
    if (fold.length) box.appendChild(folded(fold));
    main.appendChild(box);
  });
  if (DATA.failed.length) {
    main.appendChild(el('h2', null, 'Failed (' + DATA.failed.length + ')'));
    DATA.failed.forEach(f => { const d = el('div', 'fail', f.id + ': ' + (f.reason || []).join('; ')); d.dataset.text = f.id.toLowerCase(); main.appendChild(d); });
  }
  document.getElementById('stat').textContent = DATA.summary.pictures_saved + ' pictures, ' + DATA.pics.length + ' combinations, ' + DATA.failed.length + ' failed';
}
const lb = document.getElementById('lb'), lbImg = lb.querySelector('img'), lbCap = lb.querySelector('.lcap'), lbPre = lb.querySelector('pre');
let cur = null;
function open(p, via) {
  cur = p;
  lbImg.src = srcOf(p, true);
  lbCap.textContent = (via ? via.id + ' (same picture as ' + p.id + '): ' + (via.caption || '') : p.id + ': ' + (p.caption || ''))
    + ' | backdrop photo ' + p.backdrop + (p.backdrop_matches ? ' (matches)' : ' (does not match the fed state)')
    + (backdrop === 'matte' && !p.matte ? ' | no matte: we cover the whole panel' : '');
  lbPre.textContent = JSON.stringify(DATA.detail[(via || p).id] || {}, null, 1);
  lb.classList.add('on');
}
function step(d) {
  const vis = cards.filter(c => !c.classList.contains('hidden'));
  const i = vis.findIndex(c => c._p === cur);
  if (i < 0) return;
  const n = vis[(i + d + vis.length) % vis.length];
  open(n._p);
}
lb.querySelector('.x').onclick = () => lb.classList.remove('on');
lb.onclick = (e) => { if (e.target === lb) lb.classList.remove('on'); };
document.addEventListener('keydown', (e) => {
  if (!lb.classList.contains('on')) return;
  if (e.key === 'Escape') lb.classList.remove('on');
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
});
function setBackdrop(b) {
  backdrop = b;
  document.getElementById('bcar').classList.toggle('on', b === 'car');
  document.getElementById('bmatte').classList.toggle('on', b === 'matte');
  cards.forEach(c => { c._img.src = srcOf(c._p, false); });
}
document.getElementById('bcar').onclick = () => setBackdrop('car');
document.getElementById('bmatte').onclick = () => setBackdrop('matte');
document.getElementById('q').oninput = (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.card, .folded, .fail').forEach(c => c.classList.toggle('hidden', !!q && c.dataset.text.indexOf(q) < 0));
  document.querySelectorAll('.grp').forEach(g => g.classList.toggle('hidden', !!q && !g.querySelector('.card:not(.hidden), .folded:not(.hidden)')));
};
build();
</script></body></html>
'''


def write(out, pics, summary, failed):
    slim = [{k: p.get(k) for k in KEYS} for p in pics]
    detail = {p['id']: {'fed': p.get('fed'), 'probe': {k: (p.get('probe') or {}).get(k) for k in
                        ('activeName', 'driveMode', 'rowWhy', 'own', 'fail', 'failWhy', 'standby', 'signWin', 'sign', 'cc',
                         'ccOnScreen', 'ccOpen', 'ccUnread', 'ccStyle', 'road', 'navState', 'tzCar', 'arc', 'widgets')},
                        'hash': p.get('hash'), 'coverage': p.get('coverage'), 'render_notes': p.get('render_notes')} for p in pics}
    data = {'pics': slim, 'failed': [{'id': f['id'], 'reason': [str(x) for x in f['reason']]} for f in failed],
            'summary': {'counts': summary['counts'], 'pictures_saved': summary['pictures_saved']}, 'detail': detail}
    js = json.dumps(data, ensure_ascii=False).replace('</', '<\\/')
    page = PAGE.replace('__DATA__', js).replace('__SETS__', json.dumps(SET_NAME))
    open(os.path.join(out, 'index.html'), 'w', encoding='utf8').write(page)
