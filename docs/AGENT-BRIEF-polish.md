# Brief: polish the 6WB themes' middle, the "6WB Dials + G20" seams, and the G20 parts

Audience: four agents (packages A–D) working in parallel, each in its own git worktree. Read §1 and §2 and then your own package. A package lead may hand sub-parts of its package to sub-agents of its own.
Project root (the main checkout): `/Users/solefir/projects/f30-cluster`, `F30_MAIN` below. It is an MGU cluster theme app (BMW G20 cluster, panel 1920×720) that reproduces the F30 6WB look.

## 1. What the owner asked for (2026-11-12)

The owner's bench screenshots are at `/private/tmp/claude-501/-Users-solefir-projects-f30-cluster/58a6a6d5-bf7a-4f8e-9917-720dc0cc1e96/images/28.png`, `29.png`, `30.png` and `31.png`.

- **The middle window.** "The space for the map looks creepy. The stock one has shadows and fades; ours is just a square." Our window (and the see-through hole for BMW's map) is a hard rounded rectangle with a flat fill. The glassy grey line at its foot "looks alien". Rework the middle in **6WB Comfort**, **6WB Comfort + BMW map**, and the middle of **6WB Dials + G20**.
- **"6WB Dials + G20" seams.** "I see overlays on the G20 panel. It may be a photo artifact, or it may be a real overlap." Find each one, say what it is and fix it.
- **Draw our own instead of reusing BMW's where it is better.** The speed-limit signs become ours, placed under the speed hub as in 6WB Comfort, with BMW's sign covered. Which other G20 items to redraw is package D's question.
- **Colour rule, from the owner's own words:**
  - **Drawn elements** (scales, needles, rims, pictograms, text and so on) are in **colour**.
  - **Space without content is pure black** (0,0,0). This also holds for the G20 simulation's empty background and for our collar and window base.
  - Shading such as shadows, fades or vignettes may darken toward black, but must never lift the empty space off black. The car's panel visibly brightens dark tints; bimmer-lab found the same, which is why their backdrops are pure black.
- **Reference photos carry glare, shadows and sun reflections.** Do not copy a photo's tint as a colour. Judge by agreement across several photos. Where one photo disagrees, treat it as lighting.

## 2. Rules for every package

1. **Worktree setup.** Do this first.
   - Make your branch from the **local** `main`: `git checkout -B polish/<pkg> main`.
   - Check that `git log --oneline -3` shows `ec78929 Needles: ...` or later. A fresh worktree may start on `origin/main`, which is older.
   - The git-ignored folders exist only in the main checkout, so link them: `ln -s $F30_MAIN/reference reference` and `ln -s $F30_MAIN/bake/work bake/work`.
   - Write scratch files only under `bake/work/polish-<pkg>/`.
2. **Git.**
   - Commit on your branch only.
   - No push, no merge, no version bump, and no preview regeneration. The lead does those.
   - First commit: this brief, copied from `$F30_MAIN/docs/AGENT-BRIEF-polish.md` (skip it if `main` already has it).
3. **Ownership.**
   - Edit only the files your package owns (§3–§6).
   - `shared/shaders.js` and `shared/hud.js` are shared. Change only your own sections in them, and keep the diff local so the merges stay clean.
   - Generators: edit `design/gen_6wb.py` and `design/gen_g20.py`, never the layout JSON. Regenerate with `python3 design/gen_6wb.py apps/f30_cluster/hud/layouts` (the same for `gen_g20.py`).
4. **The bench.**
   - The owner's bench is on **8078**: never stop it and never post to it.
   - Run your own after `rm -rf dist bench/.data` in your worktree: `BENCH_PORT=<yours> node bench/server.js f30_cluster`.
   - Ports: **A 8081, B 8082, C 8083, D 8084**.
   - API:
     - `POST /drive {"value":4}` selects Comfort.
     - `POST /setting {"key":"inComfort","value":"wb_comfort|wb_comfort_map|wb_dials|g20_comfort"}` picks the theme; post it again if the app was not ready yet. `{"key":"stockMap","value":true}` turns the map hole on.
     - `POST /signals {"mode":"manual","values":{...}}` sets the signals.
   - URL flags: `?only=1&clean=1&car=0&backdrop=1&g20=startup|driving` (`docs/G20SIM-REPORT.md` §2 lists more).
5. **Headless Chrome.**
   - Copy the pattern of `tools/g20sim/shot.sh`, but give it **your own profile dir** under `bake/work/polish-<pkg>/chrome`.
   - Kill only your own Chrome (match your profile path). **Never** run a broad `pkill -f Chrome` or `pkill -f headless`: the other agents run Chrome too.
   - Use manual signals. Demo mode makes headless Chrome hang.
6. **Tooling.**
   - Python: `UV_CACHE_DIR=$F30_MAIN/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I ...`.
   - Scene bake: `cd bake/src && ./P9/py.sh ../../tools/bake_scene.py`.
   - G20 bake: `uv run ... python tools/bake_g20.py`.
   - macOS has no `timeout` command.
7. **Platform limits** (each one has broken the car before):
   - Effect layers are GLSL ES 1.00 with at most 32 uniforms. Use at most 8 layers per connection.
   - At most 16 assets per client and 32 in total.
   - Pixel memory is 16 MiB service-wide (w·h·8 per image). `hud.js _sceneNeeds` drops unused scene textures before it makes new ones; keep it right when you add a texture.
   - **Every `sampler2D` must have an asset bound**, or the car does not draw the layer. `_bindBlanks` covers unused samplers; do not defeat it.
   - **The car's mediump is fp16.** Every shader opens with the `GL_FRAGMENT_PRECISION_HIGH` block, and lengths are computed on scaled vectors (`length(p / R) * R`), never `length()` of offsets over ~256 px.
   - **Never pack data in alpha:** loaders premultiply it. Data textures are RGB with A = 255.
   - BMW draws these over any theme:
     - the black area `[1420, 320, 1611, 440]`, empty inside;
     - the (P) lamp `[1838, 217, 1900, 260]`;
     - the driver's belt lamp;
     - the gear letter.

     The hood hides the panel above the HOOD polyline. All of this is in `shared/visible.js`.
8. **Safety.** Critical telltales stay BMW's own, never redrawn by us: brake, ABS, DSC, airbag, belts, TPMS, engine, oil, coolant, turn signals, high beam, parking brake. Nothing may newly cover one. `design/overlay/` and the constructor show where they are.
9. **Proof and report.**
   - Put before/after bench screenshots in `docs/polish/<pkg>/`. Your own drawings may be committed; photo crops may not.
   - Write a short `docs/POLISH-<PKG>-REPORT.md`.
   - Your final message gives:
     - the branch, the commits and the files;
     - the pixel-memory, asset and uniform budgets before and after;
     - the choices the owner must make, as a short list;
     - anything left open.

**Context to read:**
- `docs/OVERLAY-PLAN-DIALS.md`, `docs/OVERLAY-REPORT.md` §7 (the G20 parts), `docs/G20SIM-REPORT.md`, `docs/BAKE-REPORT.md` (the 6WB clusters C1–C10);
- `design/overlay/README.md`;
- the photos `reference/g20/08`–`17`. **16 is the real car running "6WB Dials + G20" 0.7.4** over the stock G20; it is not rectified, so use `tools/overlay/rectify.py`;
- the 6WB references in `reference/6wb/`.

## 3. Package A: the middle window (6WB Comfort, 6WB Comfort + BMW map)

**Owns:**
- the window and the map-hole parts of the WBBACK shader in `shared/shaders.js`, and their uniforms in `hud.js`;
- the window, bar and horizon parts of `design/gen_6wb.py` (`base()` and the window widgets);
- the window, bar and horizon sections of `tools/bake_scene.py` and their textures in `apps/f30_cluster/hud/scene/`;
- `bake/src/C5` and `bake/src/C6`, if you choose to re-draw the window or bar sources there.

**Do:**
1. **Make the window read as part of the 6WB dash, not a pasted box,** with or without BMW's map:
   - a black base;
   - an inner shadow or vignette at the edges;
   - the map (when the hole is on) fading into black toward the window edges, as the stock G20's map veil does (`bench/g20/structure/map_veil.*`, `docs/G20SIM-D-live.md` §map);
   - soft rather than hard edges, with a subtle frame only if it helps.

   Mind the visible area (HOOD) and the black area at the right.
2. **The line at the window's foot.** Implement 2–3 variants, selectable by a layout parameter, so that the owner can switch them on the bench, and make the best one the default. Possible directions:
   - a thin line fading at both ends, in 6WB style;
   - chrome to match our dial bezels;
   - no line, with a fade to black instead.
3. **Keep the bottom row readable:** the clock, temperature and range texts sit at the window's foot.
4. **Budgets:** stay within them. Prefer shader work to large new textures.

**Prove it:**
- bench shots of `wb_comfort` with `stockMap` off and on, and of `wb_comfort_map`, with the G20 backdrop on;
- a crop beside the owner's 28 and 29.

## 4. Package B: "6WB Dials + G20": the seams, our signs, the middle edges

**Owns:**
- `dials()` in `design/gen_6wb.py`;
- the collar section of `tools/bake_scene.py` and `apps/f30_cluster/hud/scene/collar.json`;
- `tools/overlay/plan_dials.py`, `design/overlay/plan.dials.json` and `collar.dials.png`;
- the `u_cut` part of WBDIAL and the collar path of WBBACK in `shared/shaders.js`.

**Do:**
1. **Every seam.** List everything that looks pasted on in `wb_dials` over the simulation and on the real car (photo 16). For each one, say whether it is:
   - **(a) our composition** (collar, cuts, fade): fix it;
   - **(b) an artifact of the simulation's drawing**: report it to package C in your report, without editing `bench/g20`;
   - **(c) real on the car**: decide what to do about it.

   The owner pointed at screenshot 30. Candidates: a dark square behind the right "i", a break in the stock bottom line at the round sign window, a small grey dash right of the message panel.
2. **The collar becomes pure black** (the colour rule), with soft edges. It is currently tinted with the G20 background.
3. **Our signs.** Close the round window at (539, 622). Add our `wbsign` (limit and no-overtaking, the baked `sign_limit` / `sign_nopass`) under the speed hub, the same as in `wb_comfort` (`SIGN_DY`). BMW's own sign is then covered.
   - Check the pixel budget: the sign textures are already used by `wb_comfort`.
   - Re-run `plan_dials.py` so the plan says `assist.speed_limit` is redrawn.
4. **The middle edges.** Where the G20's middle (map, message panel) meets our dials, make the join look intended: a soft shade at our dials' inner edges, black, consistent with package A's window.
5. **Leave the "i" box window** unless D's proposal or the seams analysis says otherwise. Note: the collar currently hides about 21 % of the check-control "i" (`docs/OVERLAY-PARTS-REPORT.md`). Fix that.

**Prove it:**
- bench shots of `wb_dials` over the simulation, at rest (`g20=startup`) and at 80 km/h;
- before and after crops of every seam.

## 5. Package C: the G20 parts: black empty space, no photo artifacts

**Owns:**
- `bench/g20/**` (only this part of `bench/`);
- `bake/src/G20/**` (the parts' generators);
- `tools/g20sim/**`, `tools/bake_g20.py`;
- `apps/f30_cluster/hud/scene/g20_*.json`, `design/g20_geo.json`, `design/gen_g20.py` and its layout;
- a re-run of `tools/overlay/inventory_parts.py` and `link_parts.py` if the parts change.

**Do:**
1. **The empty background becomes pure black.** That is `bg.*.png` and every part's empty regions. Drawn elements keep their colour: the dial faces' gradients, frames, scales, numerals, pointers, glows and the rev band. Decide part by part what counts as content; the faces inside the stock dials are content.
2. **Audit every structure part** (and the procedural ones, `c.js`) for things that came from the photos rather than from the cluster: glare, shadows of the hood or the wheel, reflections, smudges, seams, dark boxes, moiré. Compare across 08, 09 and 14, and with 16 (the newest, at night and in daylight). Fix them in the generators, never by hand-painting.
3. **Take package B's list of category (b) items** into account. Coordinate through your reports; do not edit B's files.
4. **Re-run** the manifest (`tools/g20sim/build_manifest.py`), the QC (`tools/g20sim/qc.py`), `tools/bake_g20.py` and `gen_g20.py`. Check that "G20 Comfort" still looks right and stays within budget.

**Prove it:** a before and after sheet of every changed part, and a bench shot of the simulation alone (layout `off`) and under `wb_dials`.

## 6. Package D: the decision: what in "6WB Dials + G20" stays BMW's and what we draw ourselves

D does no app edits. Prototypes are allowed in your branch for screenshots, but mark them so; the lead will not merge them.

**Do:**
1. **List every G20 element visible in `wb_dials`.** Use `design/overlay/*.json` (with `g20_parts.json`), the constructor (`tools/overlay/constructor/`), photo 16 and the bench. Candidates:
   - the range, clock, temperature and street name;
   - the check-control panel and its "i" markers;
   - "COMFORT PLUS";
   - READY / OFF and the "1/min x1000" labels;
   - the digital speed;
   - the map, its arrow and the message panel;
   - any other telltale.
2. **For each, recommend one of three:**
   - **keep BMW's;**
   - **redraw ours in 6WB style:** say where, with which font (`apps/f30_cluster/hud/fonts`, `tools/bake_fonts.py`), and which signal (check `apps/f30_cluster/app.json` signals and what `main.js` already reads);
   - **hide it** under our black.

   Give the reasons:
   - style clash (font, colour, shape, size against our dials);
   - alignment;
   - whether we have the data;
   - layer, asset and pixel cost;
   - safety: critical telltales and `over` items are always "keep BMW's". We cannot hide `over` items.
3. **Mockups.** Make one or two of the whole panel for the recommended set, as bench screenshots from prototype branches or composites of our own renders.

**Deliver:** `docs/POLISH-D-PROPOSAL.md`, a one-table answer the owner can approve line by line, plus the mockups in `docs/polish/d/`.

Also flag anything in packages A–C that conflicts with the proposal.
