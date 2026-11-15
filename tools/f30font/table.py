"""Package design/f30-font: run tools/f30font/measure.py over a list of jobs and print it compactly.

A job file is JSON: {"jobs": [{"id":..., "img":..., "box":[x0,y0,x1,y1], "text":"1/min x 1000",
"ink":"bright", "merge":0, "scale":8}, ...]}. Prints one line per ink blob with the label taken from
"text" where the blob count matches, so a run reads as a glyph table.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/f30font/table.py --jobs bake/work/f30font/jobs.json --root .
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def run(root, job):
    cmd = [sys.executable, '-I', os.path.join(HERE, 'measure.py'),
           '--img', job['img'], '--box'] + [str(v) for v in job['box']] + \
          ['--what', job.get('what', 'all'), '--ink', job.get('ink', 'bright'),
           '--scale', str(job.get('scale', 8)), '--merge', str(job.get('merge', 0)),
           '--min-area', str(job.get('min_area', 1.5))]
    if job.get('thr') is not None:
        cmd += ['--thr', str(job['thr'])]
    out = subprocess.run(cmd, capture_output=True, text=True, cwd=root)
    if out.returncode:
        print(out.stderr)
        raise SystemExit('measure failed for ' + job['id'])
    return json.loads(out.stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--jobs', required=True)
    ap.add_argument('--root', default='.')
    ap.add_argument('--only', action='append', default=[])
    ap.add_argument('--json-out', default=None)
    a = ap.parse_args()

    spec = json.load(open(a.jobs))
    results = {}
    for job in spec['jobs']:
        if a.only and job['id'] not in a.only:
            continue
        r = run(a.root, job)
        results[job['id']] = {'job': job, 'result': r}
        gs = r.get('glyphs', [])
        text = job.get('text', '')
        labels = list(text.replace(' ', '')) if len(text.replace(' ', '')) == len(gs) else [''] * len(gs)
        print('\n== %-14s %-22s %s  box %s' % (job['id'], '"%s"' % text, os.path.basename(job['img']), job['box']))
        ex = r.get('extent') or {}
        if ex.get('x_halfmax'):
            print('   ink extent x %.2f..%.2f (%.2f wide)   y %.2f..%.2f (%.2f tall)'
                  % (ex['x'][0], ex['x'][1], ex['x'][1] - ex['x'][0],
                     ex['y'][0], ex['y'][1], ex['y'][1] - ex['y'][0]))
        st = r.get('stroke') or {}
        if st.get('horizontal_runs_median'):
            print('   stroke: h-run median %.2f (p25/p75 %.2f/%.2f)  v-run median %.2f'
                  % (st['horizontal_runs_median'], st['horizontal_runs_p25_p75'][0],
                     st['horizontal_runs_p25_p75'][1], st['vertical_runs_median']))
        co = r.get('colour') or {}
        if co.get('ink_rgb'):
            print('   ink rgb %s   bg rgb %s' % (co['ink_rgb'], co['bg_rgb']))
        print('   %-3s %8s %8s %7s %7s %8s %8s' % ('ch', 'x0', 'x1', 'w', 'h', 'gap', 'advance'))
        for lab, g in zip(labels, gs):
            print('   %-3s %8.2f %8.2f %7.2f %7.2f %8s %8s'
                  % (lab, g['x0'], g['x1'], g['w'], g['h'],
                     ('%.2f' % g['gap_to_prev']) if 'gap_to_prev' in g else '-',
                     ('%.2f' % g['advance']) if 'advance' in g else '-'))
    if a.json_out:
        os.makedirs(os.path.dirname(os.path.abspath(a.json_out)) or '.', exist_ok=True)
        json.dump(results, open(a.json_out, 'w'), indent=1)
        print('\n-> ' + a.json_out)


if __name__ == '__main__':
    main()
