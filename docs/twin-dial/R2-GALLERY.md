# Twin Dial round 2: the state gallery (package E)

What the gallery is, how to run it, what it checks, and what the first run on the merge candidate showed. The gallery
itself is git-ignored (`bake/work/twin-dial/r2/E/gallery/<run>/`, open `index.html` from `file://`); this file is its
manual. Last run: `bake/work/twin-dial/r2/E/gallery/real-full/` (the real `apps/twin_dial` of `twin-dial/r2` at
94a21f2 merged with this branch), 79 pictures, 0 failed jobs, 0 failing checks, 105 s on three benches.

## Run it

```sh
UV_CACHE_DIR=$F30/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl \
    python -I tools/shots/twin/run.py [--real | --standin] [--only A,B,C,D|<text>] [--out <folder>] [--benches 3] [--render 3] [--config '<json>'] [--keep]
```

No browser. Benches on ports **8205** and up (each from its own copy of `bench/`, `tools/shots/twin/root.py`), the
wall clock pinned to 14:43 on 2026-11-17 (`BENCH_NOW`), every bench wrapped by `tools/shots/bounded.py`. The render
pool replays the bench's scene (the app's real fragment shaders on the Mac's GPU, stacked as `bench/page.html` stacks
them, `tools/strip/O/render.py`). `--only A` (matrix), `B` (mockup scenes), `C` (dial laws), `D` (settings), or a
text of a picture's name (`night_ours`, `law_speed`). `--keep` leaves the snapshots and `ours.npz` for analysis.
`--real` is the default when `apps/twin_dial` exists, else `--standin` (a block-drawing stand-in that exercises the tools;
its numbers mean nothing). For `--real` the run sets the config the owner sets after the probes
(`{"trip":{"factors":{"bc":1,"speed":0.1,"cons":0.1,"way":0.1}},"twin":{"media":true}}`; without it the app shows
dashes for the trip and no media text, which is its own "unproven" state). The tools prove themselves with
`python -I tools/shots/twin/selftest.py` (26 checks, including four leaks made on purpose by the stand-in: each must
turn exactly its own check red).

## What is in a folder

`index.html` (cards by set, a filter, a click for full size with three views: **car** = ours over BMW's parts, **ours alone on
black**, **ours | mockup | difference**; every check's number), `results.json`, `summary.json` (checks by name, bench-log
problems, which SPEC 11 fields the app never watches), `compare.md`, `failed.json` (a job whose state could not be driven),
`logs/`, and the pictures: `A/`, `B/`, `C/`, `D/` as `<name>.png` (car view), `.ours.png`, `.cmp.png`, `.t.jpg`.

"BMW's parts" are bold boxes at the SPEC 3.3 numbers (`tools/shots/twin/backdrop.py`): the belt group (cyan), seven side
lamps, the message panel (only while the car shows a message), and BMW's gear letter drawn over us in the gear gap. They are
not BMW's artwork; a pixel of ours that lands on one is a leak and its colour says which. (The browser bench draws the stock
cluster with `bench/g20/g20sim.js` when `?backdrop=1`; the gallery is its headless counterpart for the parts SPEC 3.3 names.)

## The sets

| Set | Pictures | What |
|---|---|---|
| A | 48 | {day, night} x {no message, ours, window, blind} x {clock, trip} x {engine off, ready, driving}. Names `<look>_<msg>_<centre>_<engine>` |
| B | 3 | the mockup's scenes the matrix does not hold: `M2_trip` (112 km/h, 3100 rpm), `M3_door_info` (our plate, grey), `M3_door_window` (D7 not confirmed). The mockup's scene 1 is `A/day_none_clock_driving`, scene 4 is `A/day_ours_trip_driving` |
| C | 24 | dial laws: tachometer 0 ... 9000 rpm, speedometer 0 ... 330 km/h; the needle's angle is measured from the pixels |
| D | 4 | settings: demo on (day, night; volatile), `redline` 5000, `bandGain` 1.6 |

Feeding (all through the bench's own endpoints, `bench/twin-sim.js`): engine off = P, 0 rpm, condition 7; ready = P, 800 rpm,
condition 10; driving = D3, 87 km/h, 2400 rpm (the mockup's numbers: fuel 38 L, coolant 92, outside +7.5, range 412, odometer
48 215, FM media line, trip 12.4 km, 0:43, departed 14:00). Messages, in the one order that works after a restart (the D7 latch
is sticky): **blind** (nothing about messages ever fed), **window** (a ccList entry, no "shown now": D7), **ours** (a first message
whose number matches, which confirms D7, then the tyre message "Тиск у шинах: перевірте", id 50, yellow), **none**.

## What is checked on every picture (numbers against limits; red fails the picture, orange warns)

Pixel audit, `tools/strip/O/twin_audit.py`, on the replayed alpha of our layers at 1920 x 720:

| Check | Limit |
|---|---|
| belt group [497, 660, 688, 720] open | alpha 0 |
| gear gap [1380, 660, 1460, 720] open, and no layer rectangle touches it | alpha 0, none |
| BMW's seven lamp boxes clear (orange: the 3 px margin of the hole clear) | alpha 0, 0 px |
| stored-message marker [1240, 588, 1288, 630] covered; telltale strip above the tab bar black | alpha 1; colour 0 |
| BMW's panel (the baked window polygon): state window = the real panel (polygon eroded 3 px) fully open; ours / none = the whole polygon covered | alpha 0 / >= 0.98 |
| plate [694.5, 592, 1230, 720] covers the window | margin >= 1.5 px |
| layers per connection / in all / (orange: SPEC plans 12) / pixel memory | <= 8 / <= 24 / 12 / <= 6 MiB |
| every layer drawn (no shader that fails, no unbound sampler) | none |

The panel check is judged against the state the scene asks for, not the one the engine claims; the engine's own claim is a
separate check ("engine message state as the scene asks": `hud.twinCc.state`). Content checks (`tpaint.py`): the tachometer's and
speedometer's needle angle against SPEC 5.1 / 5.2 (+-2.5 degrees, measured), READY green iff the car is ready, the warning tab lit
(flat amber) with an amber message and neutral without, night = white at code 231 and day 255 (SPEC 7.2: 0.80 linear).

## Against the mockup

`compare.py`: per region, `mae` (mean absolute difference, 0..1), `ink_ratio` (our bright pixels / the mockup's), `d_centroid`
(px), `rec2` / `prec2` (the share of the mockup's ink within 2 px of ours, and of ours within 2 px of the mockup's: 1.0 is the
same drawing to 2 px) and `colour_dE`. The first run on the merge candidate:

| scene | region | mae | ink ratio | d centroid | rec2 | prec2 | colour dE |
|---|---|---|---|---|---|---|---|
| 1 clock | tachometer | 0.0097 | 1.001 | [0.34, 0.24] | 0.998 | 0.997 | 2.6 |
| 1 clock | speedometer | 0.0128 | 1.002 | [0.04, 0.32] | 0.995 | 0.995 | 1.3 |
| 1 clock | tab bar | 0.0519 | 1.002 | [-0.49, 0.05] | 1.0 | 1.0 | 6.4 |
| 1 clock | centre | 0.0244 | 1.034 | [0.11, 0.37] | 0.956 | 0.939 | 5.3 |
| 1 clock | bottom row | 0.0251 | 0.963 | [-6.43, 0.17] | 0.948 | 0.985 | 10.4 |
| 1 clock | whole | 0.0119 | 1.003 | [0.16, 0.05] | 0.994 | 0.993 | 1.5 |
| 2 trip | speedometer (112) | 0.0247 | 1.002 | [0.63, 0.44] | 0.971 | 0.969 | 1.3 |
| 2 trip | centre | 0.0207 | 1.015 | [0.75, -0.72] | 0.997 | 0.994 | 4.5 |
| 2 trip | whole | 0.0144 | 1.001 | [0.22, 0.03] | 0.985 | 0.985 | 1.5 |
| 3 door (ours) | tab bar | 0.1016 | 1.036 | [-6.4, -0.67] | 1.0 | 0.977 | 18.2 |
| 3 door (ours) | bottom row / plate | 0.0563 | 0.878 | [14.68, 2.28] | 0.88 | 0.977 | 19.8 |
| 3 door (ours) | whole | 0.015 | 0.999 | [1.11, -2.23] | 0.988 | 0.99 | 3.2 |
| 4 tyre (ours) | tab bar | 0.0635 | 0.989 | [1.78, 0.14] | 1.0 | 1.0 | 9.6 |
| 4 tyre (ours) | bottom row / plate | 0.0377 | 0.988 | [0.59, -0.32] | 0.989 | 0.991 | 9.3 |
| 4 tyre (ours) | whole | 0.0124 | 1.0 | [0.61, 0.3] | 0.996 | 0.996 | 1.5 |

Both dials are the mockup's to 2 px (rec2 / prec2 >= 0.995 at 87 km/h). What differs, and why (each is the SPEC, not a bug,
unless the findings in the report say so): the bottom row's right column shows the trip distance 12.4 km (the feed) where the mockup
has 412.6 (a different counter); in scene 3 the real warning cell is lit flat grey (SPEC 6.1: lit for every message) where the mockup
leaves it unlit for a white message, and the door pictogram is a different drawing; the tab's phone and navigation icons are dim
(SPEC 6.1) where the mockup draws them bright.

## Reproducibility

Bench clock pinned (`BENCH_NOW`), settings and signals fed through the bench's own endpoints, no sleep-dependent state in a
picture: a state is photographed only after `GET /probe` confirms it and two scenes in a row are identical. `unstable` in
`summary.json` is empty for the last run. Re-running with `--out` pointing at a folder replaces only the redone pictures.
