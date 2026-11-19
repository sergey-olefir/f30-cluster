"""The early photos of the real cluster (the owner's own, reference/g20, git-ignored), cropped to the cluster and with
anything that says where the car is (BMW's map, the street name in BMW's row) blurred out.
Usage: python -I photos.py <repo> <images_dir> <today_render.png>"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

REPO, OUT, TODAY = sys.argv[1:4]
FONT = os.path.join(REPO, 'tools', 'fonts-src', 'Arimo[wght].ttf')
G = os.path.join(REPO, 'reference', 'g20')

# file, crop box in the photo (after EXIF rotation), regions to blur in crop px [(box, radius)], labels
PHOTOS = [
    ('11_our-theme_on-car.jpg', (100, 420, 2000, 1180), [],
     {'uk': '11.11 · перша тема на авто; у тахометрі чорний прямокутник KOMBI',
      'en': '11 Nov · the first theme on the car; the KOMBI\'s black box in the tacho'}),
    ('12_our-theme_night_2026-11-11.jpg', (300, 520, 1850, 1180), [],
     {'uk': '11.11, ніч · запечена сцена: далі 0,8 R порожньо, чорне синіє',
      'en': '11 Nov, night · the baked scene: nothing past 0.8 R, black looks blue'}),
    ('14_stock-under-unbound-theme_2026-11-12.jpg', (150, 290, 930, 580),
     [((285, 45, 585, 216), 13), ((325, 242, 462, 272), 9)],
     {'uk': '12.11 · семплер без текстури: лише текст застосунку поверх штатного щитка',
      'en': '12 Nov · the unbound sampler: only the app\'s text, over the stock cluster'}),
    ('15_wb-comfort_0.7.4_fp16-cut_2026-11-12.jpg', (170, 520, 1900, 1150), [],
     {'uk': '12.11 · 0.7.4: цифри є, поділок і обідків немає (fp16)',
      'en': '12 Nov · 0.7.4: numerals, but no ticks, bezels or needle tips (fp16)'}),
    ('16_wb-dials_0.7.4_over-stock_2026-11-12.jpg', (310, 560, 1900, 1150),
     [((555, 85, 1070, 490), 26), ((670, 495, 960, 568), 18)],
     {'uk': '12.11 · 0.7.4, прозорий варіант: крізь тему видно штатні шкали',
      'en': '12 Nov · 0.7.4, see-through layout: stock scales show through the theme'}),
]
TODAY_LABEL = {'uk': 'сьогодні · той самий Comfort (рендер із бенча, не фото)',
               'en': 'today · the same Comfort (a bench render, not a photo)'}
TITLE = {'uk': 'Як це виглядало на початку: фото справжньої панелі', 'en': 'How it looked at the start: photos of the real panel'}


def font(size, bold=False):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_name('Bold' if bold else 'Regular')
    except Exception:
        pass
    return f


def load(name, box, blurs):
    im = ImageOps.exif_transpose(Image.open(os.path.join(G, name))).convert('RGB').crop(box)
    for (b, r) in blurs:
        # blur twice from a wider patch, through a feathered mask: no road or letter survives
        soft = im.filter(ImageFilter.GaussianBlur(r)).filter(ImageFilter.GaussianBlur(r))
        m = Image.new('L', im.size, 0)
        ImageDraw.Draw(m).rounded_rectangle(b, r, fill=255)
        im.paste(soft, (0, 0), m.filter(ImageFilter.GaussianBlur(r / 3)))
    im.info.clear()            # no EXIF leaves this folder
    return im


def sheet(lang):
    cw, gap, lab = 860, 30, 44
    cells = [(load(n, b, bl), l[lang]) for n, b, bl, l in PHOTOS]
    cells.append((Image.open(TODAY).convert('RGB'), TODAY_LABEL[lang]))
    hs = []
    for i in range(0, len(cells), 2):
        hs.append(max(int(cw * c[0].size[1] / c[0].size[0]) for c in cells[i:i + 2]))
    W, H = cw * 2 + gap + 80, 96 + sum(h + lab + gap for h in hs)
    im = Image.new('RGB', (W, H), (17, 19, 23))
    d = ImageDraw.Draw(im)
    d.text((40, 30), TITLE[lang], font=font(38, True), fill=(232, 235, 240))
    y = 96
    for row in range(len(hs)):
        for col in range(2):
            i = row * 2 + col
            if i >= len(cells):
                break
            p, l = cells[i]
            x = 40 + col * (cw + gap)
            d.text((x, y + 6), l, font=font(21, True), fill=(240, 170, 10) if i < len(PHOTOS) else (70, 175, 90))
            h = int(cw * p.size[1] / p.size[0])
            im.paste(p.resize((cw, h), Image.LANCZOS), (x, y + lab))
            d.rectangle((x - 1, y + lab - 1, x + cw, y + lab + h), outline=(58, 61, 68), width=2)
        y += hs[row] + lab + gap
    im.save(os.path.join(OUT, 'photos-early_%s.png' % lang))


for lg in ('uk', 'en'):
    sheet(lg)
print('ok')
