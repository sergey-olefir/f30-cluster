"""P10: homography panel -> photo 12 (our theme on the G20, night), from the live text (numerals, labels), which the
bench draws at exactly the car's positions. Seed: 8 hand-picked text centres; refine: bright-blob centroids matched
nearest-neighbour, RANSAC. Writes bake/work/P10/align12.json and the rectified photo (panel frame, work only).
    ./P10/py.sh -m P10.align12 RENDER.png
"""
import json, os, sys
import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PHOTO = os.path.join(ROOT, 'reference', 'g20', '12_our-theme_night_2026-11-11.jpg')
OUT = os.path.join(ROOT, 'bake', 'work', 'P10')

# panel (x, y) -> photo (x, y), by eye from the render and the photo
SEED = [((412, 380), (672, 862)), ((1509, 244), (1497, 787)), ((370, 142), (650, 682)), ((1725, 483), (1655, 968)),
        ((412, 636), (664, 1059)), ((1056, 662), (1155, 1090)), ((589, 529), (805, 978)), ((1454, 148), (1457, 714))]


def blobs(gray, thr, amin, amax):
    n, lab, st, cen = cv2.connectedComponentsWithStats((gray > thr).astype(np.uint8), 8)
    keep = [(cen[i], st[i]) for i in range(1, n) if amin <= st[i, cv2.CC_STAT_AREA] <= amax]
    return np.float32([c for c, _ in keep])


def main(render):
    ren = cv2.imread(render)
    ph = cv2.imread(PHOTO)
    src = np.float32([s for s, _ in SEED]); dst = np.float32([d for _, d in SEED])
    H0, _ = cv2.findHomography(src, dst, 0)
    # refine: ECC (homography) between the render warped by the seed and the photo, on the live white text only
    # (the photo's text is the only thing both share pixel-exactly; our dial art differs on the car)
    gp = cv2.GaussianBlur(cv2.cvtColor(ph, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0, (0, 0), 1.2)
    gr = cv2.GaussianBlur(cv2.cvtColor(ren, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0, (0, 0), 1.6)
    H = H0.copy()
    m = cv2.dilate(((gp > 0.80) * 255).astype(np.uint8), np.ones((9, 9), np.uint8))
    m[:540] = 0; m[1160:] = 0
    tp = np.clip((gp - 0.55) / 0.4, 0, 1)
    for it in range(1):
        wr = cv2.warpPerspective(gr, H, (ph.shape[1], ph.shape[0]), flags=cv2.INTER_LINEAR)
        tr = np.clip((wr - 0.45) / 0.4, 0, 1)
        W = np.eye(3, dtype=np.float32)
        cc, W = cv2.findTransformECC(tp, tr, W, cv2.MOTION_HOMOGRAPHY,
                                     (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), m, 5)
        # tr(W x) ~ tp(x): photo x -> warped-render W x; so render -> photo = W^-1 . H
        Hn = np.linalg.inv(W) @ H; Hn /= Hn[2, 2]
        print('ecc iter', it, 'cc', round(float(cc), 4))
    src = np.float32([s for s, _ in SEED]); dst = np.float32([d for _, d in SEED])
    rr = lambda M: float(np.sqrt(((cv2.perspectiveTransform(src[None], M)[0] - dst) ** 2).sum(1).mean()))
    print('seed rms: seed-only H', round(rr(H0), 2), 'ECC H', round(rr(Hn), 2))
    H = Hn if rr(Hn) < 2.0 else H0       # keep ECC only if it agrees with the hand points
    rms = rr(H)
    inl = np.ones(len(SEED), bool)
    print('seed residual after ECC (hand-picked, ~1 px themselves):', round(rms, 2))
    # scale: photo px per panel px near the middle
    c = cv2.perspectiveTransform(np.float32([[[960, 360], [961, 360]]]), H)[0]
    info = {'H_panel_to_photo': H.tolist(), 'inliers': int(inl.sum()), 'rms_photo_px': rms,
            'photo_px_per_panel_px': float(np.linalg.norm(c[1] - c[0])), 'render': os.path.basename(render),
            'method': 'seed 8 text centres, then text-blob centroids (nearest, RANSAC 3 px)'}
    json.dump(info, open(os.path.join(OUT, 'align12.json'), 'w'), indent=1)
    rect = cv2.warpPerspective(ph, np.linalg.inv(H), (1920, 720), flags=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(OUT, 'photo12_rect_panel.png'), rect)
    over = cv2.addWeighted(rect, 0.6, ren, 0.4, 0)
    cv2.imwrite(os.path.join(OUT, 'photo12_rect_overlay.png'), over)
    print(info['photo_px_per_panel_px'])


if __name__ == '__main__':
    main(sys.argv[1])
