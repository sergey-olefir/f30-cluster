"""Package VR step 4: collect rect.json + photometry.json into bake/work/twin-dial/pub/VR/index.json, write the
README there, the per-reference model files, and touch READY. Also writes the tracked numbers-only summary
design/twin-dial/vr/references.json (no pixels).

Verdicts (usable for geometry / colour) are judgements from the numbers below and are labelled as such:
    geometry: ring rms <= 1 dial px and >= 150 source px per R -> "yes"; >= 100 src px/R -> "yes, low-res";
              else "check only".
    colour:   bezel clipped share < 5 % and glare p95 < 1 % of white -> "yes"; otherwise "partial" with the reason.
"""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

NOTES = {
    '02': 'the only in-car photo of the facelift design; phone tone mapping crushes black (code ~1); bezel white clipped in places',
    '04': 'unit on a bench, dark room: clean black, no glare; low resolution (about 107 source px per R); '
          'its layout (centre distance 3.80 R) differs from 02 (3.87 R): possibly a different unit/software, hypothesis',
    '05': 'seller image, dials drawn as exact circles (render or screen capture composited into a product shot); '
          'centre distance 3.62 R differs from 02 and 04: a different layout, hypothesis; red arc instead of a wedge',
    '01': 'classic generation; press photo; chrome bezel profile makes the ridge less defined (rms 1.8 px)',
    '03': 'classic generation; night photo; right bezel fitted 1.4 % larger than left',
}


def verdicts(r, ph):
    rms = r['residual']['rms_px_all']
    spr = min(r['src_px_per_R'].values())
    g = 'yes' if rms <= 1 and spr >= 150 else ('yes, low-res' if rms <= 1 and spr >= 100 else 'check only')
    p = ph.get('photometry', {})
    reasons = []
    if p.get('bezel_clipped_share', 1) >= 0.05:
        reasons.append('bezel white clipped %.0f %%' % (100 * p['bezel_clipped_share']))
    if p.get('glare_excess_rel_white_in_screen_box', {}).get('p95', 1) >= 0.01:
        reasons.append('glare p95 %.1f %% of white' % (100 * p['glare_excess_rel_white_in_screen_box']['p95']))
    if r['gen'] != 'facelift':
        reasons.append('classic generation')
    c = 'yes' if not reasons else 'partial: ' + '; '.join(reasons)
    return g, c


def main():
    refs = C.cfg()['refs']
    idx = {'version': 1, 'R_px': C.R_PX, 'conventions': (
        'Rectified "dial frame": x right, y down, the centre line horizontal, left bezel radius R = 400 px; '
        'pixel coordinates OpenCV (index = pixel centre); left centre at canvas.left_centre. '
        'H_src_to_dial maps OpenCV source px (after the k1 radial term when k1 != 0) to dial px.'), 'refs': {}}
    tracked = {'_doc': 'Package VR numbers (no pixels). Dial units: R = left bezel ring centre-line radius. '
               'Method: tools/twin-dial/vr/*.py; report docs/twin-dial/VR-REPORT.md.', 'refs': {}}
    for rid in refs:
        rp = os.path.join(C.VRW, rid, 'rect.json')
        pp = os.path.join(C.VRW, rid, 'photometry.json')
        if not os.path.exists(rp):
            continue
        r = json.load(open(rp))
        ph = json.load(open(pp)) if os.path.exists(pp) else {}
        g, c = verdicts(r, ph)
        e = {'file': '%s_rect.png' % rid, 'valid': '%s_valid.png' % rid, 'gen': r['gen'], 'kind': r['kind'], 'state': r['state'],
             'source_size': r['source_size'], 'canvas': r['canvas'], 'radii_R': r['radii_R'], 'model': r['model'],
             'residual_rms_dial_px': r['residual']['rms_px_all'], 'residual_per_ring': r['residual']['per_ring'],
             'src_px_per_R': r['src_px_per_R'], 'line_checks': r['edges_check'],
             'sharpness': ph.get('sharpness'), 'photometry': ph.get('photometry'),
             'usable_geometry': g, 'usable_colour': c, 'note': NOTES.get(rid, '')}
        idx['refs'][rid] = e
        t = {k: v for k, v in e.items() if k not in ('file', 'valid', 'model')}
        t['source'] = 'reference ' + rid
        tracked['refs'][rid] = t
        C.dump(os.path.join(C.PUB, '%s_model.json' % rid), r['model'] | {'canvas': r['canvas']})
    extra = os.path.join(C.VRW, 'web_index.json')
    if os.path.exists(extra):
        w = json.load(open(extra))
        idx['web'] = w
        tracked['web'] = [{k: v for k, v in x.items() if k not in ('local',)} for x in w]
    C.dump(os.path.join(C.PUB, 'index.json'), idx)
    C.dump(os.path.join(C.REPO, 'design', 'twin-dial', 'vr', 'references.json'), tracked)
    shutil.copy(os.path.join(C.HERE, 'PUB-README.md'), os.path.join(C.PUB, 'README.md'))
    open(os.path.join(C.PUB, 'READY'), 'w').write('VR index version %d: %s\n' % (idx['version'], ', '.join(idx['refs'])))
    for rid, e in idx['refs'].items():
        print(rid, e['usable_geometry'], '|', e['usable_colour'])


if __name__ == '__main__':
    main()
