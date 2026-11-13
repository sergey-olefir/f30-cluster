# Brief: round 3. Fixes from the first car photos of 0.7.7

Audience: five agents (packages G–K) working in parallel, each in its own git worktree. Read §1, §2 and your own package. A package lead may hand sub-parts to sub-agents of its own.

## 1. What the owner saw on the car (2026-11-13, version 0.7.7)

The photos are in `reference/ours/32_…` to `43_…` (our themes on the car) and `reference/g20/39_…`, `40_…` (the G20 look at high resolution). The folder is not in git. Panel coordinates from a photo: see `reference/g20/10_grid_homography_panel-to-photo.json` and how earlier reports registered photos. Each photo is framed differently, so register each one on its own.

| Photo | Layout | What it shows |
|---|---|---|
| 32, 33 | 6WB Comfort | Entered the car with the theme already on: **no black box** over the tacho hub. BMW's car picture shows in the middle. BMW's bottom row: range, clock, "Total 114625 km", temperature. |
| 34 | 6WB Dials + G20 | BMW's 50 sign through our window, rear belts, the street name, BMW's "P" in the row. |
| 35 | (zoom) | Tacho bottom right: our tray "P", the temperature "+5.5 °C", the oil mini. |
| 36 | (zoom) 6WB Dials + G20 | Tacho bottom left: a white **arc piece sticking out** below OFF, outside our bezel. BMW's "P" and the temperature. |
| 37 | (zoom) 6WB Dials + G20 | BMW's sign in our round window, with **stubs of BMW's bottom line** at its foot on both sides. |
| 38 | 6WB Comfort + BMW map | The map's rectangle still shows at its edges (**the cover is not complete**). Our clock **08:52 while the real time is 10:52** (UTC). Our temperature "+5 °C", whole degrees. |
| 39, 40 | the G20 look | High resolution: fuel gauge, speedo, the empty sign "---", the bottom line passing behind the sign, "COMFORT PLUS", "A START STOP" crossed out, the digital speed. Tell from the details whether this is stock or our "G20 Comfort", and say which you think it is. |
| 41 | 6WB Dials + G20 | Map, our tray "D2". **BMW's range (pump with an arrow), clock and "+4.5 °C" show, not ours,** although our defaults are "ours". No mode label. The left hook's stub "/" is visible. The map's left and right edges are hard. BMW's empty sign "---". |
| 42, 43 | 6WB Dials + G20 | BMW's message panel ("heated steering wheel off", "door open") draws well. In 43, a "⚠" sits at the tacho's bottom left. |

The owner's points:
1. **The black box** (`overlay.black_box`, ~[1420, 320, 1611, 440]) does not show if the theme is already on when you get in. It shows after a switch (layout or drive mode). The owner suspects the same holds for other BMW elements. **Design as if they are not there.**
2. **Our speed-limit signs are not on the car yet.** That is expected: the field is not wired (see `docs/POLISH-E-REPORT.md`).
3. In **6WB Dials + G20**, some stock elements stick out, for example near the fuel gauge and the temperature.
4. The message panel draws well. With **only the map** showing, the cover is still not complete.
5. **BMW's empty sign "---"** (no limit known) has no counterpart of ours.
6. **Over the speed limit, our red wedge never shows**, because it needs the limit.
7. **Auto start/stop status** is missing from our themes. The G20 shows "A START STOP" by the tacho.

Wider request: use the high-resolution G20 photos to make our G20 textures and shaders more exact.

Colour rule, as always: drawn elements have colour; space with no content is **pure black**.

## 2. Rules for every package

Everything in §2 of `docs/AGENT-BRIEF-polish.md` and `docs/AGENT-BRIEF-polish2.md` applies, with these changes:

- **Base.** `git checkout -B car3/<pkg> main`, from local `main` at the commit that adds this brief or later. Symlink `reference` and `bake/work` from `$F30_MAIN=/Users/solefir/projects/f30-cluster`.
- **Ports.** G 8092, H 8093, I 8094, J 8095, K 8096. Use your own Chrome profile, and kill only your own processes. `tools/g20sim/shot.sh` hangs on most layouts. Use the DevTools protocol instead; a working helper is at `/private/tmp/claude-501/-Users-solefir-projects-f30-cluster/58a6a6d5-bf7a-4f8e-9917-720dc0cc1e96/scratchpad/pe/cdp.mjs`. Copy it, do not edit it.
- **No push.** Commit on your branch only.
- **Shared files.** `design/gen_6wb.py`, `shared/hud.js`, `shared/shaders.js` and `apps/f30_cluster/app.json` are touched by several packages. Edit only inside your own clearly marked blocks (`// car3 <pkg>: …`). Do not reformat code you do not own.
- **Proof.** Bench shots go in `docs/car3/<pkg>/`. Put photo-versus-bench comparisons there only as masks or our own renders, never as photo crops. Report in `docs/CAR3-<PKG>-REPORT.md`, ending with what the owner must check on the car.

## 3. Package G: "6WB Dials + G20" on the car

Owns: the `dials()` / `own_row()` part of `design/gen_6wb.py`; the WBBACK dial path (collar, cover, patches, shade); `tools/overlay/plan_dials.py`; the collar and cover textures; the "own:" / patch code in `shared/hud.js`.

1. **Our range, clock, temperature and mode label do not show on the car** (photo 41: BMW's show, with no black patches). Find out why, prove it on the bench, and fix it. Suspects:
   - settings stored by 0.7.6 lacking the new keys, so the defaults are not applied;
   - the `u_pat` uniform array (4 × vec4) not supported by the car's RAMSES / cluster-render client. Check `kit` and the client: do other layers use uniform arrays? If unsure, use plain vec4s;
   - `{{mode}}` empty on the car;
   - the toggle / rebuild path.

   Reproduce with a bench data dir that holds 0.7.6-era settings.
2. **Stock elements that stick out** (photos 36, 41, 34): the arc piece below OFF, anything near the fuel mini and the temperature, the left hook stub "/", and the line stubs at the foot of BMW's sign window (photo 37). Register the photos, list every stock pixel outside our drawing, and cover each with black: in the collar, in the cover, or by tightening the sign window to the sign's own disc. Keep every safety item uncovered (belts, airbag, gear letter, message panel, its "i"/"⚠"; photo 43 shows the "⚠").
3. **The map's hard left and right edges** in this layout (photo 41): give the map window soft fades like package A's in 6WB Comfort (`docs/POLISH-A-REPORT.md`), within the space between our dials.
4. **The black box:** in this layout, design as if it is not there. Check that nothing of ours is placed or cut to suit it.

## 4. Package H: "6WB Comfort" and "6WB Comfort + BMW map" on the car

Owns: the comfort / comfort_map parts of `design/gen_6wb.py`; the WBBACK comfort window path (`u_wbox`, `u_fade`, foot); the clock and temperature widgets in these layouts.

1. **The map window cover is not complete** (photo 38): BMW's map rectangle still shows at its edges. Register photo 38 and measure where BMW's map actually draws on the car compared with the bench simulation. Then make the fade or black cover reach it fully on every side, and keep it soft.
2. **Clock:** ours shows UTC (08:52 against 10:52). Until package I finds the car's time zone, use the same rule as 6WB Dials' `ownClock` "auto": show ours only when a time zone is set, otherwise BMW's (open a soft window over BMW's clock if the layout covers it) or none. Propose which, with shots.
3. **Temperature:** "+5 °C" shows whole degrees. Use the 0.5 °C token `{{ambient1}}` (package F) as BMW does.
4. Check photos 32, 33, 35 and 38 against the bench for anything else that differs (stock items peeking out, alignment, brightness), and fix what is ours to fix.

## 5. Package I: signals, the catalogue, and the sign and status widgets

Owns: `scripts/find_limit_signal.sh` and `tools/signals/` (rename them to a general catalogue tool if you like); `app.json` `signals` / `config`; the limit / no-passing / start-stop / time-zone plumbing in `shared/hud.js`; WBSIGN in `shared/shaders.js`; the new widgets' helper in `design/gen_6wb.py` (one marked function; add one call line in each layout).

The owner will run your script on the car. Until then nothing can be wired blind.

1. **One catalogue fetch.** Make the read-only script fetch the car's catalogue once (`reference/someip-interfaces.json`, git-ignored), then rank candidates for all of these:
   - the speed limit in force, including BMW's "unknown" state (the "---" sign);
   - no overtaking;
   - **auto start/stop (MSA) status**: active, off, engine stopped by MSA, unavailable;
   - **the local time or time zone**, so our clock is right without the `timeZone` setting;
   - **a check-control message is showing**, which would let package G cover the hooks only when no message shows.

   Print ready-to-paste `app.json` lines. Keep it read-only over SSH: `cat` and `grep` only.
2. **The "---" sign** (photos 40, 41): a fourth sign state, "unknown", drawn ours in 6WB style, the way BMW shows it. Decide, from the photos, when BMW shows "---" versus nothing.
3. **The red overspeed wedge** (`shaders.js`, "over the limit"): check that it works for every sign state on the bench (limit, end, unknown, none), in every 6WB layout.
4. **Auto start/stop:** our own indicator in 6WB style in every 6WB layout. The F30 6WB shows the MSA symbol (A in a circle with an arrow) in its tacho or info area. Look in `reference/6wb` and `docs/BAKE-*.md` for where and how. Add bench signals for it. It stays hidden until the field is wired.
5. **Report** `docs/CAR3-I-REPORT.md`: the exact one-line command the owner runs, what it prints, and how you will wire each field from its output.

## 6. Package J: "G20 Comfort" fidelity from the high-resolution photos

Owns: `design/gen_g20.py`, `tools/bake_g20.py`, `design/g20_geo.json`, `bench/g20/**`, `bake/src/G20/**`, the `g20_*` scene textures, G20DIAL in `shared/shaders.js`.

1. Register photos 39 and 40, plus the older G20 photos. Compare them with the simulation and our baked G20 Comfort, element by element:
   - the fuel gauge's shape and fill;
   - the speedo's band and glow;
   - the numerals' size and weight;
   - the ticks;
   - the needle;
   - the digital speed's underline;
   - the sign with the line behind it;
   - COMFORT PLUS;
   - the start/stop icon.

   Fix our drawing where it differs. Re-bake, and keep the budgets: pixel memory, layers, uniforms ≤ 32.
2. **Report** `docs/CAR3-J-REPORT.md` with side-by-side bench renders against masks or measurements (no photo crops committed) and a table of what changed.

## 7. Package K: the black box and other BMW elements that appear after a switch

Owns: research, plus, if it works, one small marked block in `shared/hud.js` (layer creation and ordering) and anything in `kit/` only if unavoidable (say why).

1. Find out why BMW's black box (and possibly other `over` elements) is absent when our theme is already on at start-up, yet appears after a layout or drive-mode switch. Read how cluster-render orders layers and connections (the client in `kit/` and the bench's model; the upstream project `robertnisipeanu/idrive-apps` and its docs and issues, read only). Also look at how our app tears down and rebuilds layers on a switch.
2. Propose, and build if cheap, a way to keep our layers above BMW's after a switch. Examples: rebuild the same way as at start-up; a delayed re-raise; recreating the connection in the start-up order. If it cannot be tested on the bench, make it a setting or a guarded path that is off by default, with a clear car test.
3. **Report** `docs/CAR3-K-REPORT.md`: the cause (with evidence or marked as a hypothesis), the change, and the step-by-step car test.

## 8. What the lead does after the reports

Merge G–K into `main` and resolve the shared files. Regenerate the layouts. Re-shoot the previews. Bump to 0.7.8. The owner decides the push.
