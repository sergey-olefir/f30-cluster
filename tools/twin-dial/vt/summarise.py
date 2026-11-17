"""VT: design/twin-dial/vt/typography.json from the fit runs (numbers only): the choice per role, the top of each
ranking with and without the bloom term, and the bake sizes (design/twin-dial/vt/sizes.json).

    python -I tools/twin-dial/vt/summarise.py <fit.json> <fit_no_bloom.json>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
fit, fit0 = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
sizes = json.load(open(os.path.join(ROOT, 'design', 'twin-dial', 'vt', 'sizes.json')))
KEEP = ('file', 'wght', 'wdth', 'box', 'd_fill', 'score', 'bloom', 'missing_car_text')
CHOICE = {
    'scale': {'face': 'Saira', 'file': 'Saira[wdth,wght].ttf', 'wght': 550, 'wdth': 125, 'licence': 'SIL OFL 1.1',
              'why': 'rank 1 of 38 families (75 font files), box 4.23 % of the figure height, squareness d_fill +0.004; next best 7.13 % (and a squarer zero)',
              'weight_range': [500, 600], 'status': 'verified (02, 05: 14 samples)'},
    'scale_small': {'face': 'Saira', 'file': 'Saira[wdth,wght].ttf', 'wght': 550, 'wdth': 125, 'licence': 'SIL OFL 1.1',
                    'why': 'rank 1 (box 2.93 %), one sample', 'weight_range': [400, 700], 'status': 'hypothesis (1 sample)'},
    'readout': {'face': 'Saira', 'file': 'Saira[wdth,wght].ttf', 'wght': 550, 'wdth': 125, 'licence': 'SIL OFL 1.1',
                'why': 'rank 1, box 3.22 %, d_fill -0.015; next 4.46 %', 'weight_range': [450, 600], 'status': 'verified (3 samples, 02 and 05)'},
    'dlabel': {'face': 'Saira', 'file': 'Saira[wdth,wght].ttf', 'wght': 550, 'wdth': 125, 'licence': 'SIL OFL 1.1',
               'why': 'best box fit (2.38 %); Play Bold ranks first on score (3.34 % box) only through the squareness of one 21 px "O". One family for all the dial print.',
               'alt': 'Play Bold (OFL, has Cyrillic)', 'weight_range': [450, 650], 'status': 'hypothesis (2 samples)'},
    'label': {'face': 'Noto Sans', 'file': 'NotoSans[wdth,wght].ttf', 'wght': 500, 'wdth': 100, 'licence': 'SIL OFL 1.1',
              'why': 'rank 1 of the faces with every car character, box 3.14 % (Open Sans 3.30, Roboto 3.56, already in the repo, is the zero-cost fallback); all of CAR_TEXT incl. U+02BC natively',
              'weight_range': [400, 550], 'status': 'verified (13 samples, 02 and 05)'},
}
top = lambda rows, n=6: [{k: r.get(k) for k in KEEP} for r in rows[:n]]
out = {'_about': 'Package VT typography for the Twin Dial. box = rms of every glyph box edge after a fitted size, position and bloom, in % of the sample\'s tallest glyph; d_fill = squareness of 0 / O / D (candidate - reference); score = hypot(box, 100 d_fill); bloom = fitted ink growth per edge, rectified px at R 400 (>= 0). The references are rectified by package VR (R = 400 px). Tools: tools/twin-dial/vt/.',
       'choice': CHOICE,
       'rankings_with_bloom': {k: top(v) for k, v in fit.items()},
       'rankings_no_bloom': {k: top(v, 4) for k, v in fit0.items()},
       'bake': sizes}
json.dump(out, open(os.path.join(ROOT, 'design', 'twin-dial', 'vt', 'typography.json'), 'w'), indent=1, ensure_ascii=False)
print('typography.json written')
