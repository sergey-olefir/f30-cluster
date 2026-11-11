# F30 Cluster

A cluster theme for BMW iDrive 7 head units (MGU) that redraws the instrument cluster in the look of the F-series
6WB multifunctional display: Comfort, Sport and Eco Pro, following the drive mode. Built on the community
[MGU App Kit](https://github.com/cauliflowermossgrape/idrive7-apps) and drawn through
[cluster-render](https://github.com/robertnisipeanu/idrive-apps), by way of the engine from
[bimmer-lab/apps](https://github.com/bimmer-lab/apps).

Status: **work in progress, not yet tried on a car.** Everything was checked only on the bench and the emulator.
The visible-area numbers in `shared/visible.js` were measured on an X3 M40i and must be re-measured on the target car.
The graphics are our own drawing (GLSL shaders and Arimo type), traced by eye off photos; no BMW artwork or fonts.

## Layout

```
apps/f30_cluster/   the app: app.json, main.js, hud/ (layouts, fonts, previews)
design/             gen_6wb.py writes the three layouts (edit it, not the JSON); gen_f30.py the basic one
shared/             the drawing engine (shaders.js has the 6WB dial and backdrop)
kit/                the MGU App Kit runtime and build tools
bench/              cluster bench: node bench/server.js f30_cluster
tools/              bake_fonts.py, previews.py
```

## Try it without a car

```sh
node bench/server.js f30_cluster       # the cluster, http://localhost:8078
node kit/tools/emu.js f30_cluster      # the app on the centre screen, http://localhost:8077
```

Run one at a time: both rebuild `dist/`. Needs Python 3 and Node. Fonts and previews are re-made with Pillow
(`uv run --no-project --with pillow python tools/bake_fonts.py f30_cluster`, `tools/previews.py f30_cluster 8078`).

## Install

Install **cluster-render** first (Store source `robertnisipeanu/idrive-apps`), then add this repo as a Store source.
The Store builds the app on the head unit. Before driving with a redrawn cluster, check that BMW's warning lights
still show (start with a seat belt off and look). Never commit `oap-sdk/` or a `.mgu` file: they hold BMW's SDK.

## Licence

MIT. Third-party parts are listed in `apps/f30_cluster/NOTICE`.
