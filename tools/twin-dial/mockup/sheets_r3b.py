#!/usr/bin/env python3
"""KC (round 3b): the choice sheets the owner decides from, the night sheet, and index.html.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/mockup/sheets_r3b.py

One page per decision (S1 .. S6), the variants side by side, labelled in Ukrainian, with the cost of each from KA's and KB's
reports (docs/twin-dial/r3b/{KA,KB}-REPORT.md: the numbers are copied into COSTS below, with their source). Everything is cut
from our own pictures: no reference pixel on any sheet (the comparison sheets of compare_r3b.py are separate, git-ignored,
labelled "reference, not ours").
"""
import html
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
WORK = os.path.join(ROOT, 'bake', 'work', 'twin-dial')
MOCK = os.path.join(WORK, 'mockup')
KC = os.path.join(MOCK, 'r3b', 'kc')
FONTS = os.path.join(WORK, 'refs', 'vt-fonts', 'notosans', 'NotoSans[wdth,wght].ttf')
BG, FG, DIM, ACC = (18, 19, 21), (236, 236, 236), (150, 152, 158), (240, 170, 10)
_F = {}


def font(size, bold=False):
    k = (size, bold)
    if k not in _F:
        f = ImageFont.truetype(FONTS, size)
        try:
            f.set_variation_by_axes([100, 700 if bold else 450])
        except Exception:
            pass
        _F[k] = f
    return _F[k]


def wrap(d, text, f, maxw):
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=f) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def load(path):
    return Image.open(path).convert('RGB')


def tile(path, crop=None, width=None):
    im = load(path)
    if crop:
        im = im.crop(crop)
    if width and im.width != width:
        im = im.resize((width, int(round(im.height * width / im.width))), Image.LANCZOS)
    return im


def text_tile(lines, w=760, h=420, title=None):
    im = Image.new('RGB', (w, h), (30, 31, 34))
    d = ImageDraw.Draw(im)
    y = 20
    if title:
        d.text((20, y), title, font=font(30, True), fill=ACC)
        y += 50
    for ln in lines:
        for l2 in wrap(d, ln, font(24), w - 40):
            d.text((20, y), l2, font=font(24), fill=FG)
            y += 32
        y += 8
    return im


def sheet(title, question, columns, path, tile_w=760, cols=None, foot=None, margin=36):
    """columns: list of dicts {img: PIL image (already cropped), id, label, status, cost, note, span}. Laid out in rows of `cols`
    (a tile with span n takes n columns)."""
    cols = cols or min(len(columns), 3)
    d0 = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    gap = 28
    W = margin * 2 + cols * tile_w + (cols - 1) * gap
    cells = []
    for c in columns:
        span = min(c.get('span', 1), cols)
        tw = span * tile_w + (span - 1) * gap
        im = c['img']
        im = im.resize((tw, int(round(im.height * tw / im.width))), Image.LANCZOS)
        sub = []
        if c.get('status'):
            sub += wrap(d0, 'Дані: ' + c['status'], font(19), tw)
        if c.get('cost'):
            sub += wrap(d0, 'Ціна: ' + c['cost'], font(19), tw)
        if c.get('note'):
            sub += wrap(d0, c['note'], font(19), tw)
        cells.append((im, wrap(d0, (c.get('id', '') + '  ' + c['label']).strip(), font(23, True), tw), sub, span))
    rows, cur, used = [], [], 0
    for cell in cells:
        if used + cell[3] > cols:
            rows.append(cur)
            cur, used = [], 0
        cur.append(cell)
        used += cell[3]
    if cur:
        rows.append(cur)
    head_lines = wrap(d0, question, font(26), W - 2 * margin)
    head_h = 28 + 52 + 34 * len(head_lines) + 22
    foot_lines = wrap(d0, foot, font(21), W - 2 * margin) if foot else []
    row_hs = [max(im.height + 8 + 30 * len(cap) + 24 * len(sub) for im, cap, sub, _ in r) + 26 for r in rows]
    H = head_h + sum(row_hs) + (30 + 28 * len(foot_lines) if foot_lines else 10)
    out = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(out)
    d.text((margin, 24), title, font=font(40, True), fill=FG)
    y = 24 + 56
    for ln in head_lines:
        d.text((margin, y), ln, font=font(26), fill=ACC)
        y += 34
    y = head_h
    for r, rh in zip(rows, row_hs):
        col = 0
        for im, cap, sub, span in r:
            x = margin + col * (tile_w + gap)
            out.paste(im, (x, y))
            d.rectangle([x - 1, y - 1, x + im.width, y + im.height], outline=(70, 72, 78))
            yy = y + im.height + 8
            for cl in cap:
                d.text((x, yy), cl, font=font(23, True), fill=FG)
                yy += 30
            for s_ in sub:
                d.text((x, yy), s_, font=font(19), fill=DIM)
                yy += 24
            col += span
        y += rh
    for ln in foot_lines:
        d.text((margin, y + 8), ln, font=font(21), fill=FG)
        y += 28
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path)
    return out


def index_html(path, entries, sheets, checks_path):
    """Every picture, sheet and check result, linked (paths relative to the file)."""
    rel = lambda p: os.path.relpath(p, os.path.dirname(path))
    chk = {}
    try:
        chk = json.load(open(checks_path))
    except Exception:
        pass
    fails = {}
    for s, r in chk.get('sets', {}).items():
        for f, v in r.items():
            fails[os.path.join(s, f)] = v['failed']
    h = ['<!doctype html><meta charset="utf-8"><title>Twin Dial r3b - KC</title>',
         '<style>body{background:#121315;color:#ececec;font:15px/1.4 system-ui,sans-serif;margin:24px}a{color:#7fb7ff}'
         'h2{margin-top:32px}table{border-collapse:collapse}td,th{padding:3px 10px;border-bottom:1px solid #333;text-align:left;vertical-align:top}'
         '.f{color:#ff7a7a}.o{color:#7fdc8a}.n{color:#c8c8c8}img{max-width:320px;display:block}</style>',
         '<h1>Twin Dial round 3b: pictures, sheets, checks</h1>', '<h2>Choice sheets</h2><ul>']
    for s in sheets:
        h.append('<li><a href="%s">%s</a></li>' % (rel(s), html.escape(os.path.basename(s))))
    h.append('</ul><p><a href="checks.json">checks.json</a> | <a href="compare.json">compare.json</a> | <a href="../../../../../../docs/twin-dial/r3b/KC-REPORT.md">KC-REPORT.md</a></p>')
    h.append('<h2>Every picture</h2><table><tr><th>set</th><th>picture</th><th>what</th><th>checks</th></tr>')
    for e in entries:
        f = fails.get(os.path.join(e['set'], e['rel']))
        status = '<span class="n">not checked</span>' if f is None else ('<span class="f">FAIL: %s</span>' % ', '.join(f) if f else '<span class="o">pass</span>')
        h.append('<tr><td>%s</td><td><a href="%s">%s</a></td><td>%s</td><td>%s</td></tr>' % (
            e['set'], rel(e['path']), html.escape(e['id']), html.escape(e.get('caption', '')), status))
    h.append('</table>')
    open(path, 'w').write('\n'.join(h))


# ==== the sheets =================================================================================================================
KA_DIR = os.path.join(MOCK, 'r3b', 'ka')
KBF = os.path.join(KC, 'kb_final')          # KB's pages re-rendered by KC with KA's final dials (r3b_base)
ZD = os.path.join(KC, 'z')
SPEEDO = (1215, 92, 1865, 720)              # the speedometer, the sign and the bottom row's right end
CENTRE = (600, 110, 1320, 618)
SEQ = (606, 118, 1314, 720)


def pick(folder, prefix, exact=None):
    for dp, dn, fn in os.walk(folder):
        dn[:] = [d for d in dn if d not in ('closeup', 'annotated', 'sheets')]
        for f in sorted(fn):
            if f.endswith('.png') and (f == exact if exact else f.startswith(prefix)) and not f.endswith(('_close.png', '_annotated.png')):
                return os.path.join(dp, f)
    raise FileNotFoundError(prefix)


def ka_(prefix):
    return pick(KA_DIR, prefix)


def kb_(prefix):
    return pick(KBF, prefix)


def ka_index():
    return {e['id'] + ('_' + e['variant'] if e.get('variant') in ('C1', 'C2', 'L1', 'L2', 'L3') else ''): e for e in json.load(open(os.path.join(KA_DIR, 'index.json')))}


def status_of(e):
    ds = e.get('data_status') or e.get('status')
    return '; '.join('%s: %s' % (k, str(v).split(' (')[0]) for k, v in ds.items()) if isinstance(ds, dict) else str(ds or '')


def s1():
    L = {1: 'L1 (читання специфікації): червона смуга від обмеження до кінця шкали +125°; тьмяна (0,45), поки стрілка нижче, повна - коли вище; ризики білі',
         2: 'L2: смуга червона лише між обмеженням і стрілкою, і лише коли швидкість вище; нижче - тільки маркер',
         3: 'L3: як L1, але завжди повністю червона, як фіксована червона зона'}
    cost = '+174 байти шейдера tdial (u_lim), без нових шарів і без нового розпікання граней; однакова для L1, L2, L3 (KA-REPORT §3)'
    cols = []
    for ids, tag in ((('L01', 'L02', 'L03'), 'нижче обмеження: 42 при 50'), (('L04', 'L05', 'L06'), 'вище обмеження: 63 при 50'),
                     (('L08_L1', 'L08_L2', 'L08_L3'), 'високе обмеження: 112 при 130')):
        for v, pid in enumerate(ids, 1):
            f = ka_(pid + ('_' if len(pid) == 3 else ''))
            cols.append(dict(img=tile(f, SPEEDO), id=pid[:3], label='%s - %s' % ('L%d' % v, tag), note=L[v] if pid in ('L01', 'L02', 'L03') else None,
                             status='знак і смуга: не бачено (сигнал оголошено, у журналі немає рядка)' if pid == 'L01' else None,
                             cost=cost if pid == 'L01' else None))
    return sheet('S1 - червона смуга від обмеження', 'Рішення 1: як саме читати "шкала червона від обмеження"? Три варіанти нижче (спідометр, знак внизу праворуч). Зверніть увагу, як виглядає шкала при ЗВИЧАЙНОМУ русі нижче обмеження (верхній ряд) - саме так вона виглядатиме найчастіше.',
                 cols, os.path.join(KC, 'sheets', 'S1_red_strip.png'), tile_w=620, cols=3,
                 foot='KA радить L1 (показує обмеження заздалегідь, відповідає при перевищенні); L2 - друга за тихістю, та сама ціна; L3 найгучніший: на кожній дорозі 50 більша частина шкали червона. Розблоковує: SPEC-R3 §8 (смуга) і параметр config.limit.strip у збірці 0.1.1.')


def s2():
    cols = []
    rows = (('C01', 'активний круїз 110, швидкість 108'), ('C07', 'усе разом: обмеження 90, круїз 110, швидкість 103'), ('C06', 'три цифри: набір 130, швидкість 128, обмеження 130'))
    for pid, tag in rows:
        c1 = ka_(pid + '_C1_')
        c2 = ka_(pid + '_C2_')
        cols.append(dict(img=tile(c1, SPEEDO), id=pid, label='C1 - у нижній частині втулки, над охолодженням: ' + tag,
                         cost='0 байт шейдера; число - текстовий віджет, символ 36 px у листі підписів втулки; охолодження лишається' if pid == 'C01' else None))
        cols.append(dict(img=tile(c2, SPEEDO), id=pid, label='C2 - у отворі на місці шкали охолодження: ' + tag,
                         cost='+111 байт (правило "сховати охолодження"); охолодження лишається лише на сторінці технічних даних' if pid == 'C01' else None))
        cols.append(dict(img=text_tile(['C3 (скорочена шкала охолодження + показ збоку) НЕ ВМІЩУЄТЬСЯ: ділянка 110 px (x 1556-1666) тримає символ 36 + проміжок 6 + число лише для двоцифрових наборів (90: 106,7 px; 88: 109,3).',
                                        'Три цифри не влазять: 110 - 111,0 px; 130 - 122,7; 199 - 125,0. Малюнка немає (KA-REPORT §2).'], title='C3 - не намальовано'),
                         id='', label='C3: ' + tag))
    return sheet('S2 - де показувати круїз і обмежувач', 'Рішення 2: у нижній частині втулки (C1) чи в отворі на місці шкали охолодження (C2)? Подивіться також на три цифри (нижній ряд). Чорна коробка KOMBI на G20 [1420, 320, 1611, 440] - вище обох місць.',
                 cols, os.path.join(KC, 'sheets', 'S2_cruise_place.png'), tile_w=620, cols=3,
                 foot='KA радить C1: нульова ціна шейдера, охолодження лишається, 72 px під чорною коробкою; C2 стоїть далеко від цифр швидкості (150 px під коробкою), коштує +111 байт і ховає охолодження. Відкрито: колір одиниці в C1 (зелений, як намальовано, чи сірий 227). Розблоковує: SPEC-R3 §9 (місце) - збірка 0.2.0.')


def render_looks():
    """The numeral shadow: the tachometer's upper half, three looks of KA's module (none / K1 / SD), our own drawing only."""
    import importlib.util
    ka = os.environ.get('KC_KA') or os.path.join(ROOT, '..', 'k3-ka')
    sys.path.insert(0, os.path.join(ka, 'tools', 'twin-dial', 'mockup'))
    spec = importlib.util.spec_from_file_location('ka_mockup', os.path.join(ka, 'tools', 'twin-dial', 'mockup', 'mockup.py'))
    M = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(M)
    out = {}
    for name in ('r3b_noshadow', 'r3b_k1shadow', 'r3b_base'):
        cv = M.Canvas()
        M.draw_dials(cv, M.look_named(name), 87.0, 2.4, 'D3')
        im = M.finish(cv, 2)
        out[name] = im.crop((2 * 120, 2 * 110, 2 * 640, 2 * 330))
    return out


def s3():
    looks = render_looks()
    cols = [dict(img=looks['r3b_noshadow'], id='A04a', label='без тіні', note='як 0.1.0: цифри пласкі на смузі'),
            dict(img=looks['r3b_k1shadow'], id='A04b', label='тінь K1 (на око): одна м\'яка тінь (0,008; 0,020) R, σ 0,009, 0,70',
                 note='саме її ви бачили на малюнку 80: цифри ніби "висять"'),
            dict(img=looks['r3b_base'], id='A04c', label='виміряна модель SD: темний контур 0,008 R (смуга до 25 %) + коротка тінь (0,010; 0,012) R, σ 0,008, 0,35',
                 cost='нуль у шейдері: тінь запікається в грань (616 x 560 R8, пам\'ять не змінюється); перебирання граней потрібне в будь-якому разі (SPEC-R3 §2.10)',
                 note='середнє затемнення смуги 1,95 % (K1) проти 2,85 % (SD); частка смуги темніша за половину 0,8 % проти 2,7 % - цифри обведені, а не пливуть (KA-REPORT §2)')]
    return sheet('S3 - тінь під цифрами шкали', 'Рішення 3: яка тінь під цифрами? Тахометр, верхня половина, R = 600 px. SPEC-R3 §2.4 бере виміряну модель SD; ви бачили тінь K1. Порівняння з фотографією-орієнтиром (06) - у git-ігнорованому файлі KA A04, тут його немає.',
                 cols, os.path.join(KC, 'sheets', 'S3_shadow.png'), tile_w=760, cols=3,
                 foot='Розблоковує: SPEC-R3 §2.4 - константи тіні в tools/twin-dial/bake_face.py (одне перепікання обох граней).')


def s4():
    cp = lambda pid: tile(kb_(pid + '_'), CENTRE)
    cols = [dict(img=cp('1D'), id='1D', label='технічні дані: чотири рядки з смугами (олива, охолодження, наддув, зовні)', status='олива, охолодження, зовні - надходять; наддув - надходить в іншому застосунку, шкала гіпотеза',
                 cost='сторінка в листі центру, 4 тексти + 3 смуги; без нового шару (KB-REPORT)'),
            dict(img=cp('1E'), id='1E', label='олива 134 °C: смуга червона від 130'),
            dict(img=cp('1H'), id='1H', label='шини (після зонда): контур, чотири тиски й температури', status='після зонда (бачено лише в журналі іншого застосунку)'),
            dict(img=cp('1I'), id='1I', label='шини: один кут бурштиновий (на 0,3 бар нижче цілі)'),
            dict(img=tile(kb_('1Ka_'), CENTRE), id='1Ka', label='цикл без крапок: сторінка поїздки'),
            dict(img=tile(kb_('1Kb_'), CENTRE), id='1Kb', label='цикл з крапками (2 з 4): r 3,2, крок 15 px, 7 px під лінією', cost='чотири малі диски на листі центру, без нового шару'),
            dict(img=tile(kb_('1J_'), (0, 0, 1920, 720)), id='1J', label='цикл із "Технічні дані = показувати" (годинник - поїздка - технічні - шини) і з "сховати" (годинник - поїздка)', span=3)]
    return sheet('S4 - технічні дані та шини на вкладці 1, цикл, крапки', 'Рішення 4: (а) чи показувати технічні дані й шини сторінками вкладки 1 з налаштуванням "Технічні дані = показувати / сховати" (стрічка 1J показує, що воно робить); (б) крапки під лінією заголовка чи без них (1Ka / 1Kb).',
                 cols, os.path.join(KC, 'sheets', 'S4_tech_page.png'), tile_w=620, cols=3,
                 foot='Знахідка KB: одиниця "бар" на сторінці технічних даних виступає на 1,7 px за край вікна (1191); пропозиція - Noto 19 для "бар" або значення третього рядка на x 1146. Розблоковує: SPEC-R3 §4.1 (сторінки та налаштування), §10 (налаштування) і порядок сторінок циклу.')


def s5():
    ids = ['T01', 'T02', 'T03', 'T04', 'T05', '1B', '1D', '1H', '2A', '2B', '2C', '2J', '2T', '3B', '3D', '4A', '4E', '4H', '5A', '5C']
    names = {'T01': 'вкладка 1: дата й час', 'T02': 'вкладка 2: повідомлення (картка)', 'T03': 'вкладка 3: радіо', 'T04': 'вкладка 4: телефон', 'T05': 'вкладка 5: карта',
             '1B': 'поїздка', '1D': 'технічні дані', '1H': 'шини', '2A': 'картка, біла', '2B': 'картка, бурштинова, 2 рядки', '2C': 'картка, червона, 3 рядки', '2J': 'вказівник: панель BMW відкрита',
             '2T': 'D7 ще не підтверджено', '3B': 'радіо FM', '3D': 'USB: назва, виконавець', '4A': 'телефон: очікування', '4E': 'вхідний дзвінок', '4H': 'розмова з таймером',
             '5A': 'вікно карти W1', '5C': 'ведення: поворот праворуч'}
    cols = [dict(img=tile(kb_(i + '_'), None), id=i, label=names[i]) for i in ids]
    return sheet('S5 - огляд: по кадру на кожну вкладку й стан у фінальному вигляді', 'Замінює r3/pages_sheet.png. Усі кадри - в остаточному вигляді шкал (look_06 за SPEC-R3 §2, KA) зі знаком обмеження 90 внизу праворуч. Тексти вигадані, карта - намальована заглушка.',
                 cols, os.path.join(KC, 'sheets', 'S5_overview.png'), tile_w=560, cols=4,
                 foot='Кожен кадр має стан даних у index.json (надходить / не бачено / після зонда).')


def s6():
    parts = [('2S1_', '1  none', 'спокій на вкладці 1, нижній рядок у два рядки'), ('2S2_', '2  window', 'повідомлення прийшло: панель BMW відкрита, нижнього рядка немає, вкладка 2, картка намальована'),
             ('2S3_', '3  ours', '>= 150 мс потому: вікно закрите, нижній рядок знову в один рядок, лінія бурштинова'),
             ('2S4_', '4  window', 'водій вибрав вкладку 1, поки повідомлення є: вікно знову відкрите, сторінка годинника, значок бурштиновий'),
             ('2S5_', '5  window', 'знову вкладка 2: картка знову є; вікно закриється лише через 150 мс (тоді як кадр 3)'), ('2S6_', '6  none', 'повідомлення закінчилось: знову вкладка 1')]
    cols = [dict(img=tile(kb_(pre), SEQ), id=lab.split()[0], label='стан автомата: ' + lab.split(None, 1)[1], note=note) for pre, lab, note in parts]
    return sheet('S6 - послідовність повідомлення', 'Шість кадрів правила безпеки (SPEC-R3 §5.4): панель BMW ніколи не закрита, доки наш текст саме цього повідомлення не стоїть на екрані щонайменше 150 мс. Кадр 5 схожий на кадр 2: різниця в історії.',
                 cols, os.path.join(KC, 'sheets', 'S6_sequence.png'), tile_w=700, cols=3,
                 foot='Це не вибір вигляду, а перевірка поведінки: чи влаштовує вас, що на 150 мс (кадри 2 і 5) видно панель BMW. Розблоковує: SPEC-R3 §5.4 і CC_SETTLE_MS у збірці 0.1.1.')


def sz():
    ids = json.load(open(os.path.join(ZD, 'index.json')))
    cols = [dict(img=tile(os.path.join(ZD, e['file'])), id=e['id'], label=e['what']) for e in ids]
    return sheet('Z - усе ввімкнено', 'Z01 -> Z02: нове повідомлення (вікно відкрите) і 150 мс потому; Z03: вкладка 5 з картою понад обмеженням; Z04: вхідний дзвінок, круїз у режимі очікування. Швидкість 103, обмеження 90 (знак, маркер, червона смуга L1), круїз 110 (C1).',
                 cols, os.path.join(KC, 'sheets', 'Z_everything_on.png'), tile_w=900, cols=2)


def night_sheet():
    import night_r3b as N
    import numpy as np
    items = [('A01', ka_('A01_')), ('T01', kb_('T01_')), ('T02', kb_('T02_')), ('T03', kb_('T03_')), ('T04', kb_('T04_')), ('T05', kb_('T05_')), ('1D', kb_('1D_')),
             ('2B', kb_('2B_')), ('2C', kb_('2C_')), ('3D', kb_('3D_')), ('4E', kb_('4E_')), ('5A', kb_('5A_')), ('5C', kb_('5C_')),
             ('C07', ka_('C07_C1_')), ('L04', ka_('L04_'))]
    cols = []
    for pid, f in items:
        day = np.asarray(load(f))
        nt = N.night(day)
        both = Image.fromarray(np.vstack([day, nt]))
        cols.append(dict(img=both, id=pid, label='день / ніч'))
    # validation of the transform against KA's own night render of C07 (engine-like multipliers on the drawing itself)
    ka_night = np.asarray(load(pick(KA_DIR, 'C10_night_C07_C1_')))
    mine = N.night(np.asarray(load(ka_('C07_C1_'))))
    diff = np.abs(mine.astype(int) - ka_night.astype(int))
    stats = dict(mean_abs_diff=round(float(diff.mean()), 2), p99=int(np.percentile(diff, 99)), share_over_20=round(float((diff.max(-1) > 20).mean()), 4))
    json.dump(stats, open(os.path.join(KC, 'night_validation.json'), 'w'), indent=1)
    sheet('S7 - ніч', 'День зверху, ніч знизу (SPEC-R3 §6: множники SPEC rev 2 §7.2 плюс заливки вкладок x 0,75 і бурштиновий x 0,8). Нічні значення - гіпотези: нічної фотографії фейсліфту немає. Ніч тут - кольорове перетворення готового кадру за областями (KC, night_r3b.py), для KA C07 звірено з його власним нічним малюнком: середня різниця %.2f рівня, 99-й процентиль %d, частка пікселів з різницею > 20: %.2f %%.'
          % (stats['mean_abs_diff'], stats['p99'], 100 * stats['share_over_20']), cols, os.path.join(KC, 'sheets', 'S7_night.png'), tile_w=560, cols=4)
    return stats


def main():
    os.makedirs(os.path.join(KC, 'sheets'), exist_ok=True)
    made = []
    for fn in (s1, s2, s3, s4, s5, s6, sz, night_sheet):
        r = fn()
        print('done', fn.__name__)
    sheets_ = sorted(os.path.join(KC, 'sheets', f) for f in os.listdir(os.path.join(KC, 'sheets')) if f.endswith('.png'))
    entries = []
    for sname, root, idxp in (('ka', KA_DIR, os.path.join(KA_DIR, 'index.json')), ('kbf', KBF, os.path.join(KBF, 'index.json')), ('z', ZD, os.path.join(ZD, 'index.json'))):
        idx = json.load(open(idxp))
        idx = idx['pictures'] if isinstance(idx, dict) else idx
        for e in idx:
            rel = e['file']
            if os.path.exists(os.path.join(root, rel)):
                entries.append(dict(set=sname, rel=rel, path=os.path.join(root, rel), id=e['id'], caption=e.get('what') or e.get('caption', '')))
    index_html(os.path.join(KC, 'index.html'), entries, sheets_, os.path.join(KC, 'checks.json'))
    print('index.html', len(entries), 'pictures')


if __name__ == '__main__':
    main()
