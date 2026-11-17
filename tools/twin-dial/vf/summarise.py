"""Package VF: condense measure_frame.py's output into design/twin-dial/vf/frame_measured.json (numbers only).

For every reference and element: the characteristic points in dial units (u, v in R from the midpoint of the two
dial centres, VR's rectified frame), plus rule thickness, and for word groups their boxes. With a second (original,
provisional) run given, the shift between the provisional and the rectified number is kept as 'prov_delta_R' for the
same point, so the report can say how much the rectification moved each number.

    .../python -I tools/twin-dial/vf/summarise.py bake/work/twin-dial/vf/frame_vr.json \
        bake/work/twin-dial/vf/frame_orig.json design/twin-dial/vf/frame_measured.json
"""
import json
import sys

vr = json.load(open(sys.argv[1]))
orig = json.load(open(sys.argv[2])) if len(sys.argv) > 3 else {}
out_p = sys.argv[3] if len(sys.argv) > 3 else sys.argv[2]
idx = json.load(open('bake/work/twin-dial/pub/VR/index.json'))['refs']

out = {'_about': 'Package VF: frame elements of the references in dial units, measured on package VR rectified '
                 'images (R = the left bezel ring centre line; u right, v down, origin = midpoint of the two dial '
                 'centres). Rule thickness "fwhm_R" is the 50 % width. prov_delta_R: rectified minus the '
                 'provisional number from the original image (similarity frame). Numbers only, no pixels. '
                 'Made by tools/twin-dial/vf/{measure_frame,summarise}.py with tools/twin-dial/vf/frame_boxes.json.',
       'refs': {}}
for ref, els in vr.items():
    rid = ref[:2]
    i = idx[rid]
    s = i['src_px_per_R']
    e = {'gen': i['gen'], 'centre_distance_R': i['canvas']['centre_distance_R'],
         'src_px_per_R': round((s['left'] + s['right']) / 2, 1),
         'one_src_px_R': round(2 / (s['left'] + s['right']), 4), 'elements': {}}
    for k, r in els.items():
        if r is None:
            continue
        q = {'method': r['method']}
        if r['method'] == 'words':
            q['words'] = [[r['dial']['w%d.tl' % n]['u_R'], r['dial']['w%d.tl' % n]['v_R'],
                           r['dial']['w%d.br' % n]['u_R'], r['dial']['w%d.br' % n]['v_R']]
                          for n in range(len(r['words']))]
        else:
            q['points'] = {n: [p['u_R'], p['v_R']] for n, p in r['dial'].items()}
            if r['method'] in ('hrule', 'vrule'):
                q['fwhm_R'] = round(r['fwhm'] / 400, 4)
            o = orig.get(ref, {}).get(k)
            if o and o.get('dial'):
                q['prov_delta_R'] = {n: [round(p['u_R'] - o['dial'][n]['u_R'], 3),
                                         round(p['v_R'] - o['dial'][n]['v_R'], 3)]
                                     for n, p in r['dial'].items() if n in o['dial']}
        e['elements'][k] = q
    out['refs'][rid] = e
json.dump(out, open(out_p, 'w'), indent=1)
print('wrote', out_p)
