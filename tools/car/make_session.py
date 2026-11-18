#!/usr/bin/env python3
"""make_session.py - render the session documents from design/car/session_plan.json (package CQ).

    python3 -I tools/car/make_session.py            # write marks, SESSION.uk.md blocks, RUNBOOK checklist
    python3 -I tools/car/make_session.py --check    # fail if anything is stale or a register item is not covered

The plan is the single source: the marks are numbered here, in the order of the steps, so a changed or inserted
step renumbers every document at once and the owner never reads a stale number. The register comes from
design/car/register.json (package CA) when it exists, else from tools/car/register_brief.json (the brief's section 3).
Standard library only. Writes only inside the repository (found from __file__)."""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
PLAN = os.path.join(ROOT, 'design', 'car', 'session_plan.json')
MARKS = os.path.join(ROOT, 'design', 'car', 'session_marks.json')
MARKERS = os.path.join(ROOT, 'design', 'car', 'markers.json')   # package CL's parse_logs.py --markers
REGISTER = os.path.join(ROOT, 'design', 'car', 'register.json')
BRIEF = os.path.join(ROOT, 'tools', 'car', 'register_brief.json')
SESSION = os.path.join(ROOT, 'docs', 'car', 'SESSION.uk.md')
RUNBOOK = os.path.join(ROOT, 'docs', 'car', 'RUNBOOK.md')
NOT_REGISTER = {'P0'}
KEY_CLASSES = ('bc-', 'msg-bc-', 'stalk-', 'thumb-', 'wheel-', 'controller', 'cluster-view')  # the probe's own start line: checked by the lead, not a register item

ENGINE_UK = {'off': 'двигун вимкнено', 'ign': 'запалювання ввімкнено, двигун НЕ запущено', 'on': 'двигун працює, авто стоїть', 'drive': 'у дорозі'}


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def register():
    """id -> {kind, question, decides}; CA's file wins, the brief fills the gaps."""
    out = {}
    for k, v in load(BRIEF).items():
        if not k.startswith('_'):
            out[k] = {'kind': v[0], 'question': v[1], 'decides': v[2], 'from': 'brief'}
    if os.path.exists(REGISTER):
        r = load(REGISTER)
        rows = r.get('items', r) if isinstance(r, dict) else r
        if isinstance(rows, dict):
            rows = [dict(v, id=k) for k, v in rows.items()]
        for it in rows:
            if isinstance(it, dict) and it.get('id'):
                out[it['id']] = {'kind': it.get('kind', ''), 'question': it.get('question', ''), 'decides': it.get('decides', ''),
                                 'from': 'CA', 'status': it.get('status', '')}
    return out


def number_marks(plan):
    n = 0
    for b in plan['blocks']:
        for s in b['steps']:
            if s.get('mark'):
                n += 1
                s['markNo'] = n
            else:
                s['markNo'] = None
    return n


def probe_table():
    """CP's field table (design/car/probe_fields.json after the merge, else the early copy CP published), or None."""
    for p in (os.path.join(ROOT, 'design', 'car', 'probe_fields.json'), os.path.join(ROOT, 'bake', 'work', 'car', 'pub', 'CP', 'probe_fields.json')):
        if os.path.exists(p):
            return load(p)
    return None


def coverage(plan, reg):
    cov = dict((k, list(v)) for k, v in plan.get('coverage_extra', {}).items() if not k.startswith('_'))
    for b in plan['blocks']:
        for s in b['steps']:
            if 'sets_on' in s:
                continue   # a set-switching step does not answer anything
            for it in s.get('items', []):
                cov.setdefault(it, []).append(s['id'])
    return cov


def problems(plan, reg, cov):
    bad = []
    ids = set()
    for b in plan['blocks']:
        for s in b['steps']:
            if s['id'] in ids:
                bad.append('duplicate step id ' + s['id'])
            ids.add(s['id'])
            if not s['id'].startswith(b['id'] + '.'):
                bad.append('step %s is not in block %s' % (s['id'], b['id']))
            for it in s.get('items', []):
                if it not in reg and it not in NOT_REGISTER:
                    bad.append('step %s names %s, which is not in the register' % (s['id'], it))
            if s.get('markNo') and not s.get('expect') and s.get('expect') != []:
                bad.append('marked step %s has no expect key (use [] when nothing must be logged)' % s['id'])
    tab = probe_table()
    if tab:
        tags = {}
        for f in tab['fields']:
            tags[(f['item'], f['tag'])] = f['set']
        for b in plan['blocks']:
            for s in b['steps']:
                for it, tag in s.get('expect', []):
                    st = tags.get((it, tag))
                    if st is None:
                        bad.append('step %s expects %s %s, which is not in the probe table' % (s['id'], it, tag))
                    elif st not in b['sets']:
                        bad.append('step %s expects %s %s (set %s) but block %s has sets %s on' % (s['id'], it, tag, st, b['id'], b['sets']))
    for it in reg:
        if it not in cov:
            bad.append('register item %s has no step, collection or reason in the plan' % it)
    return bad


def sets_text(plan, s):
    names = plan['sets_uk']
    lab = lambda ids: ', '.join('%s «%s»' % (i, names[i]) for i in ids)
    parts = []
    if s.get('sets_off'):
        parts.append('ВИМКНІТЬ %s' % lab(s['sets_off']))
    if s.get('sets_on'):
        parts.append('ВВІМКНІТЬ %s' % lab(s['sets_on']))
    if not parts:
        return ''
    return 'У меню Signal Probe (центральний екран) змініть прапорці наборів: %s. Ведучий підтверджує рядок «sets on=…» у логу. ' % '; '.join(parts)


def md_escape(t):
    return t.replace('|', '/').replace('\n', ' ')


def render_blocks(plan, reg):
    out = []
    out.append('| Блок | Що | Хвилин | Двигун | Панель | Набори Signal Probe | Пасажир |')
    out.append('|---|---|---|---|---|---|---|')
    total = 0
    for b in plan['blocks']:
        total += b['minutes']
        out.append('| %s | %s | %d | %s | %s | %s | %s |' % (b['id'][1:], b['title_uk'], b['minutes'], ENGINE_UK[b['engine']], b['cluster'],
                                                       ', '.join(b['sets']) or '-', 'так' if b['passenger'] else 'ні'))
    out.append('| | **Разом (оцінка)** | **%d** | | | | |' % total)
    out.append('')
    for b in plan['blocks']:
        out.append('### Блок %s. %s' % (b['id'][1:], b['title_uk']))
        out.append('')
        out.append('*Приблизно %d хв. %s. Панель: %s. Набори: %s.%s*' % (
            b['minutes'], ENGINE_UK[b['engine']].capitalize(), b['cluster'], ', '.join(b['sets']) or 'жодного',
            ' Потрібен пасажир.' if b['passenger'] else ''))
        out.append('')
        out.append(b['intro_uk'])
        out.append('')
        out.append('| Позначка | Що зробити | Чекати | Фото, відео, записати |')
        out.append('|---|---|---|---|')
        for s in b['steps']:
            mk = '**Позначка %d**' % s['markNo'] if s['markNo'] else '-'
            do = md_escape((sets_text(plan, s) + s['uk']).strip())
            if s.get('optional'):
                do = '(за бажанням) ' + do
            if s.get('parked') is False:
                do = '(у русі, робить пасажир, меню не чіпаємо) ' + do
            if s.get('warn_uk'):
                do += ' **УВАГА: %s**' % md_escape(s['warn_uk'])
            out.append('| %s | %s | %s | %s |' % (mk, do, md_escape(s.get('wait_uk', '')), md_escape(s.get('shoot_uk', ''))))
        out.append('')
    return '\n'.join(out)


def render_checklist(plan, reg, cov):
    where = {}
    marks = {}
    for b in plan['blocks']:
        for s in b['steps']:
            marks[s['id']] = s['markNo']
    out = []
    out.append('| Done | Id | Kind | Question | Answered by | Decides |')
    out.append('|---|---|---|---|---|---|')
    order = {'L': 0, 'P': 1, 'X': 2, 'F': 3}

    def key(i):
        m = re.match(r'([A-Z]+)(\d+)', i)
        return (order.get(m.group(1)[0], 9), int(m.group(2))) if m else (9, 0)
    for i in sorted(reg, key=key):
        parts = []
        for w in cov.get(i, []):
            if w.startswith('lead:'):
                parts.append('collection ' + w.split(':')[1].replace('collect', ''))
            elif w == 'pass2':
                parts.append('pass 2 (a build)')
            elif re.match(r'B\d+\.\d+$', w):
                parts.append('%s%s' % (w, ' (mark %d)' % marks[w] if marks.get(w) else ''))
            else:
                parts.append(w)
        r = reg[i]
        out.append('| [ ] | %s | %s | %s | %s | %s |' % (i, r['kind'], md_escape(r['question']), '; '.join(parts), md_escape(r['decides'])))
    return '\n'.join(out)


def render_verify(plan):
    out = []
    for b in plan['blocks']:
        rows = [s for s in b['steps'] if s['markNo'] and s.get('expect')]
        if not rows:
            continue
        out.append('**Block %s: %s** (sets %s)' % (b['id'][1:], b['title_uk'].split('.')[0], ', '.join(b['sets']) or '-'))
        out.append('')
        out.append('| Mark | Step | Cluster | The probe must log (item: field tag) |')
        out.append('|---|---|---|---|')
        for s in rows:
            out.append('| %d | %s%s | %s | %s |' % (s['markNo'], s['id'], ' (optional)' if s.get('optional') else '', s.get('tag', '') or '-',
                                                 ', '.join('%s: %s' % (a, c) for a, c in s['expect'])))
        out.append('')
    return '\n'.join(out).rstrip('\n')


def splice_text(text, name, body):
    pat = re.compile(r'(<!-- BEGIN:%s -->\n).*?(<!-- END:%s -->)' % (name, name), re.S)
    return pat.sub(lambda m: m.group(1) + body + '\n' + m.group(2), text)


def splice(path, name, body):
    with open(path, encoding='utf-8') as f:
        text = f.read()
    pat = re.compile(r'(<!-- BEGIN:%s -->\n).*?(<!-- END:%s -->)' % (name, name), re.S)
    if not pat.search(text):
        raise SystemExit('%s has no BEGIN/END:%s markers' % (path, name))
    new = pat.sub(lambda m: m.group(1) + body + '\n' + m.group(2), text)
    return text, new


def main():
    check = '--check' in sys.argv
    plan = load(PLAN)
    reg = register()
    n = number_marks(plan)
    cov = coverage(plan, reg)
    bad = problems(plan, reg, cov)
    if bad:
        print('PLAN PROBLEMS:\n  ' + '\n  '.join(bad))
        return 1
    marks = []
    bad = []
    for b in plan['blocks']:
        for s in b['steps']:
            if s['markNo']:
                marks.append({'mark': s['markNo'], 'step': s['id'], 'block': b['id'], 'items': s.get('items', []),
                              'expect': s.get('expect', []), 'tag': s.get('tag', ''), 'parked': s.get('parked', True),
                              'optional': bool(s.get('optional')), 'sets': b['sets'], 'class': s.get('class', '')})
            if s['markNo'] and not s.get('class'):
                bad.append('marked step %s has no class' % s['id'])
    marks_json = json.dumps({'about': 'Generated by tools/car/make_session.py from design/car/session_plan.json: the mark the owner presses before each step. expect = [item, field tag] the probe must log between this mark and the next. tag = the cluster state the step runs under.',
                             'count': n, 'marks': marks}, ensure_ascii=False, indent=1) + '\n'
    if bad:
        print('PLAN PROBLEMS:\n  ' + '\n  '.join(bad))
        return 1
    markers_json = json.dumps({'_about': 'Generated by tools/car/make_session.py from design/car/session_plan.json for tools/car/parse_logs.py --markers (package CL): marker number (the probe\'s mark M<n> of one run) -> the step class its decision tables look for (bc-short, stalk-left, thumb-up, cluster-view, mode-switch, call-phone, src-carplay, ...; a repeat under Twin Dial or f30 gets -twin / -f30 appended, as package CL\'s steps.py does, so the stock analysis of the stalk is never mixed with the repeats; only the key-finding classes get the suffix (bc-, msg-bc-, stalk-, thumb-, wheel-, controller, cluster-view); a call or a mode switch is the same event whichever app draws), the register item, the step and the cluster state.',
                               'markers': dict((str(m['mark']), {'class': m['class'] + ('-' + m['tag'] if m['tag'] in ('twin', 'f30') and m['class'].startswith(KEY_CLASSES) and m['tag'] not in m['class'] else ''), 'item': (m['items'] or [''])[0], 'items': m['items'], 'step': m['step'], 'cluster': m['tag']}) for m in marks)},
                              ensure_ascii=False, indent=1) + '\n'
    blocks_md = render_blocks(plan, reg)
    check_md = render_checklist(plan, reg, cov)
    old1, new1 = splice(SESSION, 'blocks', blocks_md)
    old2, new2 = splice(RUNBOOK, 'checklist', check_md)
    new2 = splice_text(new2, 'verify', render_verify(plan))
    old_marks = open(MARKS, encoding='utf-8').read() if os.path.exists(MARKS) else ''
    old_markers = open(MARKERS, encoding='utf-8').read() if os.path.exists(MARKERS) else ''
    if check:
        stale = [p for p, a, b in ((SESSION, old1, new1), (RUNBOOK, old2, new2), (MARKS, old_marks, marks_json), (MARKERS, old_markers, markers_json)) if a != b]
        if stale:
            print('STALE (run make_session.py): ' + ', '.join(os.path.relpath(p, ROOT) for p in stale))
            return 1
        print('ok: %d marks, %d register items covered, documents current' % (n, len(reg)))
        return 0
    for p, t in ((SESSION, new1), (RUNBOOK, new2), (MARKS, marks_json), (MARKERS, markers_json)):
        with open(p, 'w', encoding='utf-8') as f:
            f.write(t)
    print('wrote %d marks, %d register items' % (n, len(reg)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
