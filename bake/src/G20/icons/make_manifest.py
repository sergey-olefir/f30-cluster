"""Package C: write bench/g20/icons/manifest.part.json. Package C ships no images: every icon and text is drawn by
bench/g20/c.js (vector paths + the free font). The entries record, per G20 element, where it is drawn (its box in
panel px, z, layer, state, look, lamp), its kind and its evidence, so the lead's manifest lists them like the images.

Run: python3 bake/src/G20/icons/make_manifest.py
"""
import json
import os

WT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
EL = {e['id']: e for e in json.load(open(os.path.join(WT, 'design', 'overlay', 'g20_comfort.json')))['elements']}

# id, element, z, layer, state, lamp, kind, evidence, sources, notes
E = [
    ('c.tt.brake', 'tt.brake', 60, 'under', 'any', 'tt.brake', 'icon', 'strong', ['08', '09', '14'], 'lit look from 08 only; unlit = nothing drawn (09, 14)'),
    ('c.tt.tpms', 'tt.tpms', 60, 'under', 'any', 'tt.tpms', 'icon', 'strong', ['08', '09', '14'], 'lit look from 08 only; unlit = nothing drawn'),
    ('c.tt.abs', 'tt.abs', 60, 'under', 'any', 'tt.abs', 'icon', 'strong', ['08', '09', '14'], 'lit look from 08 only; unlit = nothing drawn'),
    ('c.tt.dsc', 'tt.dsc', 60, 'under', 'any', 'tt.dsc', 'icon', 'strong', ['08', '09', '14'], 'lit look from 08 only; unlit = nothing drawn'),
    ('c.tt.auto_h', 'tt.auto_h', 60, 'under', 'any', 'tt.auto_h', 'icon', 'strong', ['08', '09', '14'], 'text in the free font (condensed, 800)'),
    ('c.tt.steering', 'tt.steering', 60, 'under', 'any', 'tt.steering', 'icon', 'strong', ['08', '09', '14'], 'lit look from 08 only'),
    ('c.bottom.belt_rear', 'bottom.belt_rear', 60, 'under', 'any', 'bottom.belt_rear', 'icon', 'strong', ['08', '09', '14'], 'lit look from 08 only'),
    ('c.bottom.airbag', 'bottom.airbag', 60, 'under', 'any', 'bottom.airbag', 'icon', 'medium', ['08', '09', '14'], 'lit look from 08 only; pictogram redrawn approximately (QC SSIM low, see report)'),
    ('c.assist.digital_speed', 'assist.digital_speed', 70, 'under', 'any', None, 'font', 'strong', ['08', '09', '14'], "only '0' photographed; more digits grow to the left of a fixed right edge (weak)"),
    ('c.assist.rpm_label', 'assist.rpm_label', 70, 'under', 'any', None, 'font', 'strong', ['08', '09', '14'], ''),
    ('c.assist.off', 'assist.off', 70, 'under', 'any', None, 'font', 'weak', ['08'], 'OFF when rpm < 200 or null (08 only); else the tacho scale 0 (09, 14) which C draws too'),
    ('c.assist.tacho_zero', 'assist.off', 70, 'under', 'any', None, 'font', 'medium', ['09', '14'], "the tacho scale's '0' (engine on); replaced by OFF; B must not draw it"),
    ('c.assist.cold', 'assist.cold', 70, 'under', 'any', None, 'font', 'weak', ['10', '14'], 'shown when oil < 40 degC and the engine runs: the rule is ours (weak)'),
    ('c.assist.mode_label_centre', 'assist.mode_label_centre', 70, 'under', 'stock', None, 'font', 'strong', ['08', '09'], 'COMFORT PLUS; SPORT / ECO PRO texts and layout: none'),
    ('c.assist.gear_centre', 'assist.gear_centre', 70, 'under', 'stock', None, 'font', 'strong', ['08', '09'], 'P, D seen; R N S widths weak'),
    ('c.assist.speed_limit', 'assist.speed_limit', 72, 'under', 'any', None, 'icon', 'strong', ['08', '09', '14'], '50, 30 seen; three-digit set (100-130) none'),
    ('c.bottom.range', 'bottom.range', 75, 'under', 'any', None, 'font', 'strong', ['08', '09', '14'], 'pump icon + number left-aligned at x 182.7 + km'),
    ('c.bottom.clock', 'bottom.clock', 75, 'under', 'any', None, 'font', 'strong', ['08', '09', '14'], 'centred at x 397 (one-digit hours never seen: weak)'),
    ('c.bottom.street', 'bottom.street', 75, 'under', 'any', None, 'font', 'strong', ['09', '14'], 'centred at x 961; hidden while the check-control panel shows (08); long names are squeezed to 520 px (none)'),
    ('c.bottom.temperature', 'bottom.temperature', 75, 'under', 'any', None, 'font', 'strong', ['08', '09', '14'], 'number right-aligned at x 1624 + degree + C; minus sign never seen (none)'),
    ('c.assist.cc_panel', 'assist.cc_panel', 80, 'under', 'any', None, 'icon', 'strong', ['08'], "geometry from 08; covers the stock bottom line's ends 695..1224 (opaque base); other messages none"),
    ('c.bottom.cc_info', 'bottom.cc_info', 81, 'under', 'any', None, 'icon', 'strong', ['08'], "drawn with the panel"),
    ('c.assist.info_tacho', 'assist.info_tacho', 81, 'under', 'any', 'assist.info_tacho', 'icon', 'none', ['08'], 'trigger unknown: a bench lamp, lit in the startup preset as in 08'),
    ('c.assist.mode_label', 'assist.mode_label', 82, 'under', 'connected', None, 'font', 'strong', ['10', '14'], ''),
    ('c.tt.parking_brake', 'tt.parking_brake', 200, 'over', 'any', 'tt.parking_brake', 'icon', 'strong', ['08', '12', '13'], 'red (P)'),
    ('c.tt.parking_brake.hold', 'tt.parking_brake', 200, 'over', 'any', 'tt.parking_brake.hold', 'icon', 'strong', ['09', '10', '14'], 'green (P) with Auto Hold'),
    ('c.bottom.belt_driver', 'bottom.belt_driver', 200, 'over', 'any', 'bottom.belt_driver', 'icon', 'strong', ['08', '10', '11', '12', '14'], ''),
    ('c.assist.gear', 'assist.gear', 201, 'over', 'connected', None, 'font', 'strong', ['10', '11', '12', '13', '14'], 'P seen; R N D S widths weak'),
]


def main():
    out = []
    for id_, el, z, layer, state, lamp, kind, ev, src, notes in E:
        b = EL[el]['bbox'] if el != 'assist.off' or id_ == 'c.assist.off' else [1513, 572, 1553, 615]
        out.append({'id': id_, 'element': el, 'file': 'c.js', 'procedural': True,
                    'x': int(b[0]), 'y': int(b[1]), 'w': int(b[2] - b[0]), 'h': int(b[3] - b[1]), 'scale': 1.0, 'z': z,
                    'kind': kind, 'layer': layer, 'state': state, 'look': 'any', 'lamp': lamp, 'lit': True if lamp else None,
                    'composite': 'source-over', 'opacity': 1.0, 'evidence': ev, 'sources': src, 'notes': notes})
    out.append({'id': 'c.font', 'element': None, 'file': 'fonts/Roboto-wdth-wght.subset.ttf', 'procedural': False,
                'x': 0, 'y': 0, 'scale': 1.0, 'z': 0, 'kind': 'font', 'layer': 'under', 'state': 'any', 'look': 'any',
                'lamp': None, 'lit': None, 'composite': 'source-over', 'opacity': 1.0, 'evidence': 'strong', 'sources': ['08', '09', '14'],
                'notes': "Roboto (SIL OFL 1.1, fonts/Roboto-OFL.txt), variable wdth 75-100 / wght 100-900, subset Latin+Cyrillic; loaded by G20C.init(base) as 'G20Roboto'"})
    p = os.path.join(WT, 'bench', 'g20', 'icons', 'manifest.part.json')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump({'package': 'C', 'module': 'c.js', 'global': 'G20C',
               'note': 'C ships no images: entries with procedural=true are drawn by G20C.drawUnder/drawOver; x/y/w/h is the element box.',
               'entries': out}, open(p, 'w'), indent=1, ensure_ascii=False)
    print(p, len(out))


if __name__ == '__main__':
    main()
