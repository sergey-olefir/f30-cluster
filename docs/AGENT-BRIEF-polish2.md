# Brief: polish round 2. Our own speed-limit sign everywhere; "6WB Dials + G20" bottom row ours, with settings

Audience: two agents (packages E and F) working in parallel, each in its own git worktree. Read §1, §2 and your own package. A package lead may hand sub-parts to sub-agents of its own.

## 1. What the owner decided (2026-11-13), answering polish round 1

The background is `docs/AGENT-BRIEF-polish.md` and the reports `docs/POLISH-{A,B,C,D}-REPORT.md` and `docs/POLISH-D-PROPOSAL.md` (its row numbers are used below).

1. **The 6WB window's foot line** (package A's `hair` / `chrome` / `none` / `glass`, `docs/polish/a/foot_variants.png`): make it a setting.
2. **The shade at our dials' inner edges in "6WB Dials + G20"** (B's `SHADE_K` 0.8 / `SHADE_L` 20 px, baked into the collar): make it a setting.
3. **The stock bottom line, the hooks and the grey dash** (D rows 24 and 25): take them away, together with every bottom-row item we can draw ourselves. The owner: "this removes a lot of problems".
4. **The right "i"** (D row 8): it is only an icon (no text), seen once, with a check-control message (photo 08). The window stays as it is. Do not change it.
5. **Range, clock and outside temperature** (D rows 11–13), **the mode label** (row 15) and **the gear in our tray** (row 17): make each a setting: BMW's own, or ours. The owner likes these items **in their stock places**, so "ours" means drawn by us at BMW's spot, in our 6WB style, over black that hides BMW's.
6. **The speed-limit sign**: our theme draws it. BMW's sign must not show through. That needs the car's speed-limit signal, which `app.json` `config.limit` / `config.nopass` do not name yet (`null`).

The base colour rule still holds: drawn elements (scales, needles, rims, text, signs) have colour; space with no content is **pure black**.

## 2. Rules for every package

Everything in §2 of `docs/AGENT-BRIEF-polish.md` applies (worktree setup, bench, headless shots, budgets, fp16, unbound samplers, scene-texture peak memory, proof and report), with these changes:

- **Base.** Branch from local `main` at `7de00a0` or later: `git checkout -B polish/<pkg> main`. A fresh worktree may start on `origin/main`, which is older. Symlink `reference` and `bake/work` from the main checkout `$F30_MAIN=/Users/solefir/projects/f30-cluster`.
- **Ports.** **E 8085, F 8086.** Each agent uses its own Chrome profile and kills only its own Chrome. Never run a broad `pkill`. Note: `tools/overlay/headless.py` contains a broad `pkill -f chrome-headless`. Do not run it as is; if you need it, fix it to match your own profile first (F owns that fix).
- **No push.** Commit on your branch only. The lead merges.
- **Shared files.** E and F both touch `apps/f30_cluster/app.json` and `shared/hud.js`. Keep your edits in separate, well-commented blocks, and do not reformat or reorder code you do not own, so the merge stays mechanical.
- **Settings.** Follow how the existing settings in `app.json` `settings` (`stockMap`, `nightDim`, `badge` …) are declared, labelled (all 33 HMI languages, or the fallback the existing ones use) and read in `hud.js`. A setting that changes a uniform at run time is better than one that needs a re-bake or a second texture. If a choice needs more pixel memory, count it against 16 MiB in the worst layout.
- **Proof.** Bench shots for every option of every new setting go in `docs/polish/<pkg>/`. Report in `docs/POLISH-<PKG>-REPORT.md`, ending with a short list of what the owner still has to choose or check on the car.

## 3. Package E: the speed-limit signal, and our sign in every layout

Owns: `app.json` `signals` and `config.limit` / `config.nopass`; the limit plumbing in `shared/hud.js` (`_setupVehicleData` and the `limitKmh` / no-overtaking state); `shared/shaders.js` WBSIGN; any new script under `scripts/` or `tools/signals/`.

1. **Find the field.** No signal catalogue is in this repo (`someip-interfaces.json` lives on the car at `/etc/oap/someip/someip-interfaces.json`; `kit/runtime/signals.js` and `kit/tools/oapgen/gen.js` show how it is read). Search public sources for the SOME/IP interface and field that carry the traffic-sign / speed-limit info (SLI, "Speed Limit Info", traffic sign recognition, no-overtaking) on MGU / iDrive 7 / G-series: community MGU app repositories (bimmer-lab/apps, cauliflowermossgrape/idrive7-apps, robertnisipeanu/idrive-apps and others), their docs and issues, and forums. **Read only.** Never run code from those repositories. Keep the evidence (URL, file, line, quote) for every candidate. Also see how the fields this app already reads (for example `KombiIF.statusRangeTankStatus`, `FES.statusFESVehicleDynamicSwitchHMI`) were found and declared.
2. **Wire it** if the evidence is good:
   - `config.limit` / `config.nopass` in the documented shape, with the factor, unit (`kmh` / `mph`) and invalid values; the interface under `signals` with the right flag (`r` needs a getter, `s` a notifier);
   - the bench's signal model, so demo and manual modes can set it (`/signals`);
   - "no limit known", "limit", "end of limit / unlimited" and "no overtaking" each map to a clear state.
3. **If the evidence is not good enough** to wire it blind, deliver a safe way to confirm it on the car:
   - a **read-only** script, for example `scripts/find_limit_signal.sh root@<car>`, that greps the car's catalogue over SSH for the candidates and prints them;
   - the config left `null`, with the candidates written into `config._limit`.

   Never write to the car, and never kill an app process (see the mgu-app-dev skill's hard rules).
4. **Our sign, BMW's covered**, in every layout that has a sign spot:
   - **"6WB Comfort", "6WB Comfort + BMW map":** our sign under the speedo hub (it exists). Check that it shows, hides and switches between limit and no-overtaking on the bench.
   - **"6WB Dials + G20":** today B's round window over BMW's sign is open while our limit is unknown and closed (`u_cut.z = 3`) while it is known. Once the signal is wired, make "closed" the normal state: BMW's sign never shows through. Decide, with reasons, what "the signal is wired but the car sends nothing yet" should look like (black is the default).
   - **"G20 Comfort":** BMW's sign shows through today. Report, with a mockup, whether ours should cover it in this stock-look layout. Build it only if it costs ≤ 1 layer and one existing texture.
5. **Report** `docs/POLISH-E-REPORT.md`: the candidates with evidence and confidence, what is wired, and exactly what the owner must check on the car (a step list, including how to read the value in the app's log).

## 4. Package F: "6WB Dials + G20" bottom row ours; four settings

Owns: `design/gen_6wb.py` (the `wb_dials` part and the foot), `tools/overlay/plan_dials.py`, the collar (`collar.dials.png`, `collar.json`), WBBACK / WBDIAL cut and shade code in `shared/shaders.js`, the `wb_dials` widgets in `shared/hud.js`, the new settings, `tools/overlay/headless.py`'s pkill fix, and `design/overlay/*` updates for the elements you change.

1. **Settings** (declared in `app.json`, read in `hud.js`, live where possible):
   - `wbFoot`: `hair` (default) / `chrome` / `none` / `glass`, for the 6WB middle window in every layout that draws it.
   - `dialShade`: `off` / `weak` / `normal` (today's 0.8, 20 px) / `strong`, for "6WB Dials + G20". Move the shade out of the baked collar into the shader if that is cheap; otherwise justify the cost.
   - `ownRange`, `ownClock`, `ownTemp`: `bmw` / `ours`. Propose the defaults with reasons. The lead's view: range and temperature ours, clock BMW's unless the `timeZone` setting is set, since the head unit runs on UTC.
   - `modeLabel`: on / off (D row 15). `gearTray`: `gear` ("D4") / `letter` / `empty` (D row 17).
2. **Our items at the stock places.** For each `ours` choice, draw a black patch that hides BMW's item and our item in the same spot (D rows 11–13: range with the pump, clock and temperature, bottom row y ≈ 666–701). Use 6WB style and our fonts (fix the Latin-only atlases if a glyph is missing: "°C", "km"). Watch D's notes:
   - our whites are dimmed at night (`nightDim`), BMW's are not;
   - our temperature rounds to whole degrees. Show 0.5 °C steps if the signal carries them.

   Count layers, assets and pixel memory, and keep within the caps on every connection.
3. **Take away the stock bottom line, the hooks and the grey dash** (D rows 24 and 25):
   - Black over the stock lines x 277–602 and 1318–1638, y 640–654.
   - The hooks (x 696–748 and 1168–1239, y 604–650) and the dash (1224–1239 × 643–650): D kept them because they lie at the corners of BMW's check-control area. The owner wants them gone. Use photo 08 (a message shown; `reference/g20/10_grid_homography_panel-to-photo.json` maps panel to photo; check the photo's framing) and the catalogue polygons of `assist.cc_panel` and `bottom.cc_info` to find the exact pixels BMW's message frame, text and left "i" use.
   - Cover the hooks and the dash only where none of those pixels lie, with a margin of at least 3 px. Prove it with an overlay image. If a hook shares pixels with the message frame, cover the rest of it, and say so.
   - Safety items stay untouched: belts, airbag, the gear letter, the street name, the check-control panel and the right "i" window.
4. **Report** `docs/POLISH-F-REPORT.md`: shots per setting option, at rest and at 80 km/h, day and night; the hook and frame overlay; budgets before and after.

## 5. What the lead does after both report

Merge E and F into `main` and resolve the shared files. Regenerate the layouts and the settings previews. Bump the version to 0.7.7. The owner decides the push.
