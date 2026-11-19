"""The project's own diagrams for the article (no BMW artwork, no photos). Each in two languages: <name>_uk.png, <name>_en.png.
Numbers are from the repository (sources.md says where).
Usage: python -I diagrams.py <repo> <images_dir> <comfort_render.png> <twin_render.png>"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO, OUT, COMFORT, TWIN = sys.argv[1:5]
FONT = os.path.join(REPO, 'tools', 'fonts-src', 'Arimo[wght].ttf')

BG = (17, 19, 23)
PANEL = (28, 31, 37)
LINE = (88, 96, 110)
TXT = (232, 235, 240)
DIM = (150, 158, 170)
RED = (226, 58, 52)
AMBER = (240, 170, 10)
GREEN = (70, 175, 90)
BLUE = (80, 150, 235)
VIOLET = (165, 120, 235)


def font(size, bold=False):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_name('Bold' if bold else 'Regular')
    except Exception:
        pass
    return f


def text(d, xy, s, size=26, fill=TXT, bold=False, anchor='la'):
    d.text(xy, s, font=font(size, bold), fill=fill, anchor=anchor)


def mtext(d, xy, lines, size=24, fill=TXT, bold_first=False, gap=1.3, anchor='la'):
    x, y = xy
    for i, ln in enumerate(lines):
        text(d, (x, y), ln, size, fill if i == 0 or not bold_first else DIM, bold_first and i == 0, anchor)
        y += int(size * gap)
    return y


def box(d, r, fill=PANEL, outline=LINE, w=2, rad=14):
    d.rounded_rectangle(r, rad, fill=fill, outline=outline, width=w)


def arrow(d, a, b, fill=DIM, w=4, head=14):
    d.line([a, b], fill=fill, width=w)
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    p1 = (b[0] - head * math.cos(ang - 0.45), b[1] - head * math.sin(ang - 0.45))
    p2 = (b[0] - head * math.cos(ang + 0.45), b[1] - head * math.sin(ang + 0.45))
    d.polygon([b, p1, p2], fill=fill)


# ---------------------------------------------------------------- 1. the signal path
L1 = {
    'uk': {
        'title': 'Шлях сигналу: від блоків авто до пікселя на панелі',
        'ecu': ['Блоки авто', 'двигун, коробка, камера,', 'DSC, KOMBI…'],
        'someip': ['SOME/IP', 'каталог авто: 689 інтерфейсів,', '5100 полів'],
        'app': ['OAP-застосунок проєкту (Node 8)', 'тільки підписки й читання,', 'жодного сеттера'],
        'sock': ['Unix-сокет, JSON', 'шари, uniform-и, пікселі'],
        'cr': ['cluster-render', 'складає RAMSES-сцену; 16 MiB', "пам'яті під пікселі, 2000–5500 KB/s", 'на завантаження'],
        'kombi': ['KOMBI (окремий блок)', 'рендерить RAMSES-сцену:', 'свою й застосунку; шейдери', 'застосунку компілює сам'],
        'panel': ['Панель 1920 × 720', 'сцена BMW, поверх неї шари', 'застосунку, поверх них лампи BMW'],
        'mgu': 'Головний пристрій MGU', 'link': ['Ethernet'],
        'note': 'Головний пристрій рутований, це хобі-проєкт. Застосунки лише слухають: у бік авто не йде жоден запис.',
    },
    'en': {
        'title': 'The signal path: from the car\'s ECUs to a pixel on the panel',
        'ecu': ['The car\'s ECUs', 'engine, gearbox, camera,', 'DSC, KOMBI…'],
        'someip': ['SOME/IP', 'the car\'s catalogue: 689 interfaces,', '5100 members'],
        'app': ['The project\'s OAP app (Node 8)', 'subscriptions and reads only,', 'never a setter'],
        'sock': ['Unix socket, JSON', 'layers, uniforms, pixels'],
        'cr': ['cluster-render', 'builds a RAMSES scene;', '16 MiB pixel limit,', '2000–5500 KB/s upload budget'],
        'kombi': ['KOMBI (its own ECU)', 'renders the RAMSES scene:', 'its own and the app\'s; compiles', 'the app\'s shaders itself'],
        'panel': ['The 1920 × 720 panel', 'BMW\'s scene, the app\'s layers', 'over it, BMW\'s lamps over those'],
        'mgu': 'MGU head unit', 'link': ['Ethernet'],
        'note': 'A rooted head unit, a hobby project. The apps only listen: nothing is ever written to the car.',
    },
}


def signal_path(lang):
    t = L1[lang]
    W, H = 1800, 820
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    text(d, (60, 50), t['title'], 40, bold=True)
    # MGU frame around the app and cluster-render
    d.rounded_rectangle((1070, 125, 1745, 705), 22, outline=(70, 78, 92), width=2)
    text(d, (1090, 135), t['mgu'], 22, DIM, True)
    box(d, (60, 175, 470, 365))
    mtext(d, (84, 200), t['ecu'], 24, bold_first=True)
    box(d, (560, 175, 990, 365), outline=BLUE)
    mtext(d, (584, 200), t['someip'], 24, bold_first=True)
    box(d, (1100, 175, 1715, 365), outline=GREEN)
    mtext(d, (1124, 200), t['app'], 24, bold_first=True)
    box(d, (1100, 490, 1715, 680), outline=VIOLET)
    mtext(d, (1124, 515), t['cr'], 24, bold_first=True)
    box(d, (560, 490, 990, 680), outline=RED)
    mtext(d, (584, 515), t['kombi'], 24, bold_first=True)
    box(d, (60, 490, 470, 680), outline=(200, 200, 200))
    mtext(d, (84, 515), t['panel'], 24, bold_first=True)
    arrow(d, (470, 270), (556, 270))
    arrow(d, (990, 270), (1096, 270))
    arrow(d, (1400, 365), (1400, 486))
    mtext(d, (1420, 395), t['sock'], 22, DIM)
    arrow(d, (1100, 585), (994, 585))
    mtext(d, (1000, 600), t['link'], 20, DIM)
    arrow(d, (560, 585), (474, 585))
    text(d, (60, H - 70), t['note'], 24, AMBER)
    im.save(os.path.join(OUT, 'diagram-signal-path_%s.png' % lang))


# ---------------------------------------------------------------- 2. the layer stack
L2 = {
    'uk': {
        'title': 'Шари застосунку лише додаються поверх сцени BMW',
        'bmw_top': ['Зверху малює BMW', 'ремінь, стоянкове гальмо, літера', 'передачі, «чорний прямокутник»'],
        'ours': ['Шари застосунку', 'до 8 на з\'єднання × 3 з\'єднання:', 'фон, циферблати, текстові аркуші'],
        'bmw_base': ['Сцена BMW', 'штатні шкали, карта, панель', 'повідомлень (видно в «вікнах»)'],
        'hole': 'вікно на панель повідомлень BMW',
        'belt': 'ремінь', 'gear': 'передача', 'park': 'стоянкове', 'box': 'чорний прямокутник',
    },
    'en': {
        'title': 'The app\'s layers are only added on top of BMW\'s scene',
        'bmw_top': ['BMW draws on top', 'belt, parking brake, gear letter,', 'the "black box"'],
        'ours': ['The app\'s layers', 'up to 8 per connection × 3 connections:', 'backdrop, dials, text sheets'],
        'bmw_base': ['BMW\'s scene', 'stock scales, map, the message', 'panel (seen through the "windows")'],
        'hole': 'window onto BMW\'s message panel',
        'belt': 'belt', 'gear': 'gear', 'park': 'parking', 'box': 'black box',
    },
}

CC_PANEL = (696, 595.75, 1226, 704)      # BMW's message panel (SPEC-R3 5.4)
BELT_GROUP = (497, 660, 688, 720)       # VG 1.2
GEAR_GAP = (1380, 660, 1460, 720)       # VG 1.2, MB
BLACK_BOX = (1420, 320, 1611, 440)      # shared/visible.js
PARK = (1838, 217, 1900, 260)           # shared/visible.js


def perspective_coeffs(src, dst):
    import numpy as np
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return list(np.linalg.solve(np.array(A, float), np.array(B, float)))


def plane(img, W, H, x0, y0, w, skew):
    """img (1920x720 RGBA) onto a tilted card: top edge narrower and shifted (a simple 3/4 view)."""
    sw, sh = img.size
    h = int(w * 0.30)
    dst = [(x0 + skew, y0), (x0 + w + skew, y0), (x0 + w, y0 + h), (x0, y0 + h)]
    c = perspective_coeffs([(0, 0), (sw, 0), (sw, sh), (0, sh)], dst)
    return img.transform((W, H), Image.PERSPECTIVE, c, Image.BICUBIC), dst


def layer_stack(lang):
    t = L2[lang]
    W, H = 1800, 1260
    im = Image.new('RGBA', (W, H), BG + (255,))
    d = ImageDraw.Draw(im)
    text(d, (60, 50), t['title'], 40, bold=True)
    # bottom: BMW's scene, drawn by us as neutral grey placeholders
    base = Image.new('RGBA', (1920, 720), (34, 36, 42, 255))
    bd = ImageDraw.Draw(base)
    for cx in (480, 1440):
        for r, wdt in ((300, 6), (250, 3)):
            bd.ellipse((cx - r, 380 - r, cx + r, 380 + r), outline=(110, 116, 128), width=wdt)
    bd.rounded_rectangle((760, 160, 1160, 560), 30, fill=(48, 56, 66))
    bd.rounded_rectangle(CC_PANEL, 18, fill=(70, 74, 82), outline=(200, 200, 200), width=4)
    bd.text((960, 650), 'i  ———', font=font(40, True), fill=(230, 230, 230), anchor='mm')
    # middle: our render with a window cut over BMW's message panel
    ours = Image.open(COMFORT).convert('RGBA').resize((1920, 720))
    m = Image.new('L', (1920, 720), 255)
    ImageDraw.Draw(m).rounded_rectangle(CC_PANEL, 18, fill=0)
    ours.putalpha(m)
    ImageDraw.Draw(ours).rounded_rectangle(CC_PANEL, 18, outline=AMBER + (255,), width=8)
    # top: only BMW's own items that draw over us (shown as labelled outlines, not their artwork)
    top = Image.new('RGBA', (1920, 720), (0, 0, 0, 0))
    td = ImageDraw.Draw(top)
    for r, col, lab in ((BELT_GROUP, RED, t['belt']), (GEAR_GAP, AMBER, t['gear']), (PARK, RED, t['park']),
                        (BLACK_BOX, (210, 210, 210), t['box'])):
        td.rectangle(r, outline=col + (255,), width=8, fill=col + (60,))
        lx, ly = (r[0], r[1] - 64)
        if r is PARK:
            lx, ly = r[0] - 330, r[1] - 6
        if r is BLACK_BOX:
            lx, ly = r[0] - 140, r[3] + 14
        td.text((lx, ly), lab, font=font(52, True), fill=col + (255,))
    X0, WW = 90, 1060
    for img, y, sk, lab, col in ((base, 870, 120, t['bmw_base'], LINE), (ours, 510, 120, t['ours'], GREEN),
                                 (top, 150, 120, t['bmw_top'], RED)):
        pl, dst = plane(img, W, H, X0, y, WW, sk)
        # soft shadow
        if img is not top:
            sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            ImageDraw.Draw(sh).polygon([(p[0] + 10, p[1] + 18) for p in dst], fill=(0, 0, 0, 120))
            im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(12)))
        else:
            fl = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            ImageDraw.Draw(fl).polygon(dst, fill=(255, 255, 255, 14))
            im.alpha_composite(fl)
        im.alpha_composite(pl)
        ImageDraw.Draw(im).polygon(dst, outline=col, width=3)
        mtext(ImageDraw.Draw(im), (1310, y + 90), lab, 25, bold_first=True)
    d = ImageDraw.Draw(im)
    # label the window on the middle plane
    _, dst = plane(ours, W, H, X0, 510, WW, 120)
    def to_plane(px, py, dstp):
        (x0, y0), (x1, _), (x2, y2), (x3, _) = dstp
        u, v = px / 1920, py / 720
        top_x = x0 + (x1 - x0) * u
        bot_x = x3 + (x2 - x3) * u
        return (top_x + (bot_x - top_x) * v, y0 + (y2 - y0) * v)
    a = to_plane(960, 704, dst)
    arrow(d, (a[0] + 160, a[1] + 70), (a[0] + 8, a[1] + 6), AMBER, 3, 12)
    text(d, (a[0] + 170, a[1] + 56), t['hole'], 24, AMBER)
    im.convert('RGB').save(os.path.join(OUT, 'diagram-layer-stack_%s.png' % lang))


# ---------------------------------------------------------------- 3. protected zones over the Twin Dial render
L3 = {
    'uk': {
        'title': 'Що на панелі 1920 × 720 належить BMW',
        'hood': 'козирок ховає верхні кути (виміряно по сітці, 108 вузлів)',
        'belt': 'ремені й подушки: ніколи не закриваємо',
        'gear': 'щілина під літеру передачі: жодного шару застосунку',
        'cc': 'панель повідомлень BMW («вікно» в шарах застосунку)',
        'box': '«чорний прямокутник» KOMBI',
        'lamps': 'лампи BMW по боках: кільця обходять їх на 3,7–4,3 px',
        'r': 'R = 300 px, центри (380, 400) і (1540, 400)',
    },
    'en': {
        'title': 'What on the 1920 × 720 panel belongs to BMW',
        'hood': 'the hood hides the top corners (measured on a grid, 108 crossings)',
        'belt': 'belts and airbag: never covered',
        'gear': 'the gear-letter gap: no layer of the app\'s',
        'cc': 'BMW\'s message panel (a "window" in the app\'s layers)',
        'box': 'the KOMBI\'s "black box"',
        'lamps': 'BMW\'s side lamps: the rings clear them by 3.7–4.3 px',
        'r': 'R = 300 px, centres (380, 400) and (1540, 400)',
    },
}
HOOD = [(0, 200), (100, 145), (200, 94), (300, 52), (400, 33), (500, 24), (600, 19), (700, 13), (800, 12), (900, 13),
        (1000, 14), (1100, 13), (1200, 15), (1300, 20), (1400, 28), (1500, 33), (1600, 48), (1700, 88), (1800, 139),
        (1900, 205), (1920, 225)]
LAMPS = [(1777, 179, 1870, 205), (14, 327, 73, 369), PARK]   # tt.auto_h, tt.abs, parking brake (VG 1.2, visible.js)


def zones(lang):
    t = L3[lang]
    S = 0.9
    W, H = int(1920 * S) + 80, int(720 * S) + 330
    im = Image.new('RGBA', (W, H), BG + (255,))
    d = ImageDraw.Draw(im)
    text(d, (40, 36), t['title'], 40, bold=True)
    ox, oy = 40, 110
    r = Image.open(TWIN).convert('RGBA').resize((1920, 720))
    r = Image.blend(Image.new('RGBA', r.size, (0, 0, 0, 255)), r, 0.55)
    ov = Image.new('RGBA', (1920, 720), (0, 0, 0, 0))
    o = ImageDraw.Draw(ov)
    o.polygon([(0, 0)] + HOOD + [(1920, 0)], fill=(90, 120, 200, 150))
    o.line(HOOD, fill=(140, 170, 255, 255), width=4)
    for rr, col in ((BELT_GROUP, RED), (GEAR_GAP, AMBER), (CC_PANEL, GREEN), (BLACK_BOX, (220, 220, 220))):
        o.rectangle(rr, fill=col + (70,), outline=col + (255,), width=5)
    for rr in LAMPS:
        o.rectangle(rr, fill=RED + (70,), outline=RED + (255,), width=4)
    for cx in (380, 1540):
        o.ellipse((cx - 300, 100, cx + 300, 700), outline=(255, 255, 255, 140), width=2)
        o.line((cx - 12, 400, cx + 12, 400), fill=(255, 255, 255, 200), width=2)
        o.line((cx, 388, cx, 412), fill=(255, 255, 255, 200), width=2)
    r.alpha_composite(ov)
    r = r.resize((int(1920 * S), int(720 * S)), Image.LANCZOS)
    im.alpha_composite(r, (ox, oy))
    d = ImageDraw.Draw(im)
    d.rectangle((ox - 1, oy - 1, ox + r.size[0], oy + r.size[1]), outline=LINE, width=2)
    # legend
    ly = oy + r.size[1] + 30
    items = [((140, 170, 255), t['hood']), (RED, t['belt']), (AMBER, t['gear']), (GREEN, t['cc']),
             ((220, 220, 220), t['box']), (RED, t['lamps']), ((255, 255, 255), t['r'])]
    for i, (col, s) in enumerate(items):
        cx = ox + (i % 2) * 860
        cy = ly + (i // 2) * 44
        d.rectangle((cx, cy + 4, cx + 26, cy + 30), fill=col)
        text(d, (cx + 40, cy + 2), s, 24)
    im.convert('RGB').save(os.path.join(OUT, 'diagram-zones_%s.png' % lang))


# ---------------------------------------------------------------- 4. the message safety sequence
L4 = {
    'uk': {
        'title': 'Повідомлення: попередження BMW ніколи не сховане без нашого тексту',
        'a': 'А. Повідомлення з\'являється',
        'b': 'Б. Водій іде з вкладки «Повідомлення», поки воно на екрані',
        'lanes': ['авто: «показано зараз»', 'вікно на панель BMW', 'картка застосунку', 'нижній рядок'],
        'open': 'відкрите', 'shut': 'закрите', 'card': 'текст саме цього повідомлення', 'row': 'застосунку', 'away': 'відступає',
        'ms': '≥ 150 мс', 'n': 'N (є в ccList)', 'turn': 'той самий хід',
        'foot': 'Перевіряється покадрово: тест рахує кожен кадр, де панель BMW закрита без власного тексту застосунку (має бути 0).',
    },
    'en': {
        'title': 'Messages: a BMW warning is never hidden without our own text',
        'a': 'A. A message appears',
        'b': 'B. The driver leaves the Messages tab while it shows',
        'lanes': ['car: "shown now"', 'window onto BMW\'s panel', 'the app\'s card', 'bottom row'],
        'open': 'open', 'shut': 'shut', 'card': 'the text of that exact message', 'row': 'the app\'s', 'away': 'steps aside',
        'ms': '≥ 150 ms', 'n': 'N (in ccList)', 'turn': 'same turn',
        'foot': 'Checked frame by frame: the audit counts every frame with BMW\'s panel shut and no text of the app\'s own (must be 0).',
    },
}


def sequence(lang):
    t = L4[lang]
    W, H = 1800, 1060
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    text(d, (60, 44), t['title'], 38, bold=True)
    LX, X0, X1 = 60, 470, 1740
    lane_h = 64

    def seg(y, a, b, col, label=None, hatch=False):
        d.rounded_rectangle((a, y + 12, b, y + lane_h - 12), 8, fill=col)
        if label:
            text(d, ((a + b) / 2, y + lane_h / 2), label, 21, (15, 15, 15), True, 'mm')

    def panel(y0, title, events):
        text(d, (LX, y0), title, 28, AMBER, True)
        y = y0 + 50
        for i, lab in enumerate(t['lanes']):
            text(d, (LX, y + i * lane_h + 20), lab, 22, DIM)
            d.line((X0, y + i * lane_h + lane_h, X1, y + i * lane_h + lane_h), fill=(40, 44, 52), width=1)
        events(y)
        return y + 4 * lane_h

    def ev_a(y):
        t0, tc, ts = 620, 860, 1180
        for x in (t0, tc, ts):
            d.line((x, y - 6, x, y + 4 * lane_h + 4), fill=(200, 200, 200), width=2)
        seg(y, X0, t0, (60, 64, 72), '0')
        seg(y, t0, X1, AMBER, t['n'])
        seg(y + lane_h, X0, t0, (60, 64, 72), t['shut'])
        seg(y + lane_h, t0, ts, GREEN, t['open'])
        seg(y + lane_h, ts, X1, (60, 64, 72), t['shut'])
        seg(y + 2 * lane_h, tc, X1, (235, 235, 235), t['card'])
        seg(y + 3 * lane_h, X0, t0, (120, 128, 140), t['row'])
        seg(y + 3 * lane_h, ts, X1, (120, 128, 140), t['row'])
        text(d, ((t0 + tc) / 2, y + 3 * lane_h + 32), t['away'], 21, DIM, anchor='mm')
        d.line((tc, y + 4 * lane_h + 22, ts, y + 4 * lane_h + 22), fill=AMBER, width=3)
        text(d, ((tc + ts) / 2, y + 4 * lane_h + 30), t['ms'], 24, AMBER, True, 'ma')

    def ev_b(y):
        tl, tr = 820, 1140
        for x in (tl, tr):
            d.line((x, y - 6, x, y + 4 * lane_h + 4), fill=(200, 200, 200), width=2)
        seg(y, X0, X1, AMBER, t['n'])
        seg(y + lane_h, X0, tl, (60, 64, 72), t['shut'])
        seg(y + lane_h, tl, X1, GREEN, t['open'])
        seg(y + 2 * lane_h, X0, tr, (235, 235, 235), t['card'])
        seg(y + 3 * lane_h, X0, tl, (120, 128, 140), t['row'])
        text(d, ((tr + X1) / 2, y + 3 * lane_h + 32), t['away'], 21, DIM, anchor='mm')
        text(d, (tl - 14, y + 4 * lane_h + 32), t['turn'] + ' →', 21, DIM, anchor='ra')
        d.line((tl, y + 4 * lane_h + 22, tr, y + 4 * lane_h + 22), fill=AMBER, width=3)
        text(d, ((tl + tr) / 2, y + 4 * lane_h + 30), t['ms'], 24, AMBER, True, 'ma')

    yb = panel(140, t['a'], ev_a)
    panel(yb + 120, t['b'], ev_b)
    text(d, (60, H - 60), t['foot'], 23, DIM)
    im.save(os.path.join(OUT, 'diagram-message-safety_%s.png' % lang))


# ---------------------------------------------------------------- 5. the probe's menu (a drawing, not a screenshot)
L5 = {
    'uk': {
        'title': 'Меню signal_probe на центральному екрані (малюнок за app.json, не знімок)',
        'n_status': ['Рядок стану', 'які набори ввімкнено, скільки', 'інтерфейсів піднялося, обсяг логу'],
        'n_mark': ['«Позначка N»', 'натискання перед дією ставить', 'у лог рядок «тут почався крок»'],
        'n_sets': ['12 наборів, кожен зі своєю галочкою', 'при першому запуску всі вимкнені;', 'вимкнений набір ні на що не підписаний'],
        'n_s13': ['S13 «Знаки»', 'доданий у 0.1.1: події камери', 'й розпізнавання знаків'],
        'foot': 'Тексти рядків узято з apps/signal_probe/app.json і menu.js; числа в рядку стану та час позначки — приклад.',
    },
    'en': {
        'title': 'signal_probe\'s menu on the centre screen (drawn from app.json, not a screenshot)',
        'n_status': ['Status line', 'which sets are on, how many', 'interfaces came up, the log\'s size'],
        'n_mark': ['"Позначка N" (Mark N)', 'a press before an action writes', 'a "this step starts here" line'],
        'n_sets': ['12 sets, each with its own checkbox', 'all off at the first start;', 'a set that is off subscribes to nothing'],
        'n_s13': ['S13 "Знаки" (Signs)', 'added in 0.1.1: the camera\'s and', 'the sign-recognition events'],
        'foot': 'Row texts are from apps/signal_probe/app.json and menu.js; the status numbers and the mark\'s time are an example.',
    },
}
PROBE_SETS = ['S1 Повідомлення (P1 P2)', 'S2 Комп’ютер, пробіг, одиниці (P3 P4 P5 P6)', 'S3 Кузов і напруга (P7 P10)',
              'S4 Медіа і радіо (P8)', 'S5 Телефон (P9)', 'S6 Вид і кнопки (P11 P13)', 'S7 Навігація (P12 P14)',
              'S8 Допоміжні системи (P15)', 'S9 Технічне (P16 P17)', 'S10 Чорна коробка (P18)',
              'S11 Непідключені сигнали f30 (P19)', 'S13 Знаки (P22)']


def probe_menu(lang):
    t = L5[lang]
    W, H = 1800, 1180
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    text(d, (60, 44), t['title'], 34, bold=True)
    x0, y0, x1 = 60, 120, 1080
    box(d, (x0, y0, x1, H - 90), fill=(22, 24, 29), outline=(70, 78, 92), rad=18)
    text(d, (x0 + 30, y0 + 22), 'Signal Probe', 30, TXT, True)
    y = y0 + 76
    d.line((x0 + 20, y, x1 - 20, y), fill=(50, 56, 66), width=1)
    text(d, (x0 + 30, y + 14), 'Набори: S6. Інтерфейсів: 8 з 8. Рядків у журналі: 212 (14 КБ)', 22, DIM)
    y_status = y + 26
    y += 58
    d.rounded_rectangle((x0 + 20, y, x1 - 20, y + 84), 10, fill=(36, 40, 48), outline=AMBER, width=2)
    text(d, (x0 + 40, y + 12), 'Позначка 4', 28, TXT, True)
    text(d, (x0 + 40, y + 48), 'остання: 3 о 18:34:07', 21, DIM)
    y_mark = y + 42
    y += 100
    ys = []
    for i, lab in enumerate(PROBE_SETS):
        on = lab.startswith('S6 ')
        d.rounded_rectangle((x0 + 30, y + 12, x0 + 62, y + 44), 6, outline=(150, 158, 170), width=2, fill=GREEN if on else None)
        if on:
            d.line((x0 + 37, y + 28, x0 + 44, y + 36, x0 + 56, y + 19), fill=(15, 15, 15), width=4)
        text(d, (x0 + 82, y + 13), lab, 25, TXT if on else (200, 204, 212))
        d.line((x0 + 20, y + 55, x1 - 20, y + 55), fill=(38, 42, 50), width=1)
        ys.append(y + 28)
        y += 56
    text(d, (x0 + 30, y + 10), 'Не користуйтеся меню під час руху. Журнал: журнал застосунку signal_probe.', 21, AMBER)
    # notes on the right
    nx = 1160
    for key, yy, ty in (('n_status', y_status, y_status - 74), ('n_mark', y_mark, y_mark + 6), ('n_s13', ys[-1], ys[-1] - 18)):
        d.line((x1 + 6, yy, nx - 14, yy), fill=LINE, width=2)
        d.ellipse((x1 - 2, yy - 5, x1 + 8, yy + 5), fill=LINE)
        mtext(d, (nx, ty), t[key], 23, bold_first=True)
    bx, mid = x1 + 34, (ys[0] + ys[-2]) // 2
    d.line((bx, ys[0] - 18, bx, ys[-2] + 18), fill=LINE, width=2)
    d.line((bx - 12, ys[0] - 18, bx, ys[0] - 18), fill=LINE, width=2)
    d.line((bx - 12, ys[-2] + 18, bx, ys[-2] + 18), fill=LINE, width=2)
    d.line((bx, mid, nx - 14, mid), fill=LINE, width=2)
    mtext(d, (nx, mid - 18), t['n_sets'], 23, bold_first=True)
    text(d, (60, H - 62), t['foot'], 21, DIM)
    im.save(os.path.join(OUT, 'diagram-probe-menu_%s.png' % lang))



os.makedirs(OUT, exist_ok=True)
for lg in ('uk', 'en'):
    signal_path(lg)
    layer_stack(lg)
    zones(lg)
    sequence(lg)
    probe_menu(lg)
print('ok')
