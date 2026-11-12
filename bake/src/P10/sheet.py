"""P10 step 5: the side-by-side review sheet (bake/work/P10/review_levels.png). Work only: it shows reference photos.
Rows: photo 12 vs the model's prediction of it (old, new); 6WB 04 vs old / new white-matched to 04; same for 03.
    ./P10/py.sh -m P10.sheet
"""
import os
import cv2
import numpy as np
from P10.predict import OUT, RECT


def lab(img, text):
    img = img.copy()
    cv2.rectangle(img, (0, 0), (img.shape[1], 26), (0, 0, 0), -1)
    cv2.putText(img, text, (8, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
    return img


def half(p):
    im = cv2.imread(p)
    return cv2.resize(im, (960, 360), interpolation=cv2.INTER_AREA)


def main():
    rows = []
    rows.append([lab(half(os.path.join(OUT, 'photo12_rect_panel.png')), 'photo 12 (G20, our theme cb28ce7, night mode), rectified'),
                 lab(half(os.path.join(OUT, 'pred_old_photo12exp.png')), 'model(old panel), photo-12 exposure: should match the left'),
                 lab(half(os.path.join(OUT, 'pred_new_photo12exp.png')), 'model(new panel, P10 levels + window gain 1.0)')])
    for k, stem in (('04', '04_comfort_whole-cluster_mph'), ('03', '03_three-modes_photo_bimmerstop')):
        ref = os.path.join(RECT, '%s.comfort.PANEL.raw.png' % stem)
        rows.append([lab(half(ref), '6WB %s photo (P0 PANEL crop, raw levels; its dials sit at x 435 / 1485)' % k),
                     lab(half(os.path.join(OUT, 'pred_old_at%swhite.png' % k)), 'car prediction, old panel, white matched to %s' % k),
                     lab(half(os.path.join(OUT, 'pred_new_at%swhite.png' % k)), 'car prediction, new panel, white matched to %s' % k)])
    sheet = np.vstack([np.hstack(r) for r in rows])
    cv2.imwrite(os.path.join(OUT, 'review_levels.png'), sheet)
    # the panels themselves
    a = lab(half(os.path.join(OUT, 'bench_cb28ce7_comfort.png')), 'panel values, old (cb28ce7 bench)')
    b = lab(half(os.path.join(OUT, 'bench_P10_comfort.png')), 'panel values, new (P10 assets, window gain 1.0)')
    st = lambda im: np.clip(im.astype(np.float32) * 4, 0, 255).astype(np.uint8)
    c = lab(st(half(os.path.join(OUT, 'bench_cb28ce7_comfort.png'))), 'old x4 (darks)')
    d = lab(st(half(os.path.join(OUT, 'bench_P10_comfort.png'))), 'new x4 (darks)')
    cv2.imwrite(os.path.join(OUT, 'review_panel.png'), np.vstack([np.hstack([a, b]), np.hstack([c, d])]))
    print(os.path.join(OUT, 'review_levels.png'))


if __name__ == '__main__':
    main()
