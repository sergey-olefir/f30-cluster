# Polish round 2, package E: the speed-limit signal and our sign

Branch `polish/e` (from `main` at `1779154`). Brief: `docs/AGENT-BRIEF-polish2.md` §1–§3.

## 1. Result

- **The field was not found in public sources.** No public MGU app reads the car's speed-limit or no-overtaking sign. The evidence (§2) was not good enough to wire a field blind, so `config.limit` and `config.nopass` stay `null`. The candidates are written in `config._limit`.
- **A read-only way to find the field on the car:** `scripts/find_limit_signal.sh root@<car>`. Over SSH it runs only `cat` on the catalogue and `grep` on the app's log. `tools/signals/find_limit.py` then ranks the catalogue's fields locally and prints the `app.json` lines for the best one.
- **The plumbing is ready for any field shape.** Factor, unit (fixed or carried in the field), invalid values, end-of-limit values, or an enum `map`. There are four clear states: no limit known, limit, end of limit, and no overtaking. Every new raw value is logged once together with what it became, so the owner can calibrate on the car.
- **Our sign is the normal state.**
  - Once `config.limit` or `config.nopass` names a field, the window over BMW's sign in "6WB Dials + G20" stays closed. BMW's sign never shows. While the car has sent nothing, the spot is black.
  - Until a field is named, the window behaves as before (open while we know no limit), so the car keeps BMW's sign.
- **New end-of-limit sign.** It is drawn in the WBSIGN shader. It needs no texture, uniform or layer.
- **The bench can set the signs.** The manual signals `limit` and `nopass` are fed as the raw value of the configured field. While none is configured, the bench stands in its own field, `bench.SpeedLimit`; `BENCH_LIMIT=off` makes the bench run as the car does.
- **"G20 Comfort": keep BMW's sign (recommended).** There is a mockup of ours. Not built, because ours would cost 2 layers (§5).
- **Budgets: no change.** No layer, asset, texture or uniform was added (§6).

## 2. Candidates and evidence

The search covered:
- the five MGU community repositories: bimmer-lab/apps, cauliflowermossgrape/idrive7-apps, robertnisipeanu/idrive-apps, robertnisipeanu/mgu-store and jaimeen77-cmyk/apps. They were downloaded as tarballs and only grepped; none of their code was run.
- their issues;
- GitHub code search;
- the web, including forums.

| # | Candidate | Evidence | Confidence |
|---|---|---|---|
| 1 | A field named with BMW's own words for the feature. In the ID4–6 car data service these are `driving.sliActualSpeedLimitInfo` (601), `driving.sliNextSpeedLimitRecognition` (600), `driving.sliTextMessage` (599), `driving.trafficSignInfo1..4` (591–594), `driving.trafficSignInfoVisibility` (595), `driving.orInfo` (598), `driving.orNPITextMessage` (597; NPI = No Passing Info, BMW's name for the no-overtaking display) and `driving.signRecognitionFrontCamera` (605). | [BimmerGestalt/IDriveConnectKit `CDSProperty.kt` lines 176–190](https://github.com/BimmerGestalt/IDriveConnectKit/blob/main/core/src/commonMain/kotlin/io/bimmergestalt/idriveconnectkit/CDSProperty.kt). Quote: `val DRIVING_SLIACTUALSPEEDLIMITINFO = CDSProperty(601, "driving.sliActualSpeedLimitInfo")`. | **Low as a field name, high as a search term.** These are the older head units' CDS (ETCH) properties, not MGU SOME/IP names, and nothing public shows what their values look like. `find_limit.py` greps the car's catalogue for exactly these words: SLI, NPI, trafficSign, speedLimit, overtaking, orInfo, signRecognition. |
| 2 | Navigation map data, only while a route runs. These are members of `de.bmw.infotainment.navigation.guiding.GuidanceEventList`'s event union: `speedLimit`, `speedLimitAssist` and `speedLimitAssistInfo` on each event. | [cauliflowermossgrape/idrive7-apps `apps/redline/nav.js` line 134](https://github.com/cauliflowermossgrape/idrive7-apps/blob/main/apps/redline/nav.js) (`speedLimitAssist: 1, speedLimit: 1, speedCamera: 1` in the list of skipped union members) and `kit/tools/fixtures/redline-nav-carplay-2026-11-09.txt` (`"speedLimitAssistInfo":{"nil":"NO_VALUE"}` on every event of a CarPlay route on a G21). `kit/tools/test_redline_nav.js` line 127 lists the union's 22 members from the car's catalogue. | **Confirmed to exist on an MGU, but the wrong thing.** It gives upcoming limits on a guided route, not the sign in force. It is read through a method call (`queryContent`), not a field notification, so it cannot be `config.limit` as it is. |
| 3 | A field of the cluster's or the HUD's own data, next to `KombiIF` and `KombiInterface_2`, which already carry the range and the check-control list. | None. This is reasoning: the cluster and the HUD show the sign. If the head unit draws BMW's HUD content (cluster-render's HUD target suggests it can), the catalogue must carry the sign. | **Hypothesis.** |

Searched with no result:
- The five repositories for `speedLimit`, `SpeedLimitInfo`, `trafficSign`, `overtak`, `noPassing`, `SLI`, `KAFAS` and `VZE`. The only hits were candidate 2, KAFAS diagnostic texts and an ECU name.
- Every `app.json` `signals` block in those repositories. 36 interfaces are declared; none carries a sign.
- Their issues for "speed limit", "traffic sign", "SLI" and "overtaking". robertnisipeanu/idrive-apps#158 asks for the speed limit on the cluster; its owner answered that it is not planned.
- GitHub-wide code search for `statusSpeedLimit`, `statusTrafficSign`, `SpeedLimitInfo someip` and `sliActualSpeedLimitInfo`. Only candidate 1's file came up.

How the app's present fields were found (for comparison):
- `KombiIF.statusRangeTankStatus`, the TPMS fields, `ExteriorTemperature` and `MDrive.dataDisplayGearbox` came with their scaling from cauliflowermossgrape's car_vitals (MIT), which read them on a car.
- `FES.statusFESVehicleDynamicSwitchHMI` came from the kit's known-good list.

Each of those was proven on a car before it was declared. No public app has done that for the sign.

## 3. What is wired

**`app.json`** (the `config` block only; `signals` is unchanged):
- `limit: null`;
- `nopass: null`;
- `_limit`: the accepted shapes, how to find the field and the three candidates above.

**`shared/hud.js`** (blocks marked `package E`):
- `limitOf()` turns one raw value into `{ state: 'none' | 'limit' | 'end', kmh }`. It accepts:

  | Key | Meaning |
  |---|---|
  | `path` | where the value sits in the field |
  | `factor` | the scaling |
  | `unit` | `kmh` or `mph` |
  | `unitPath` + `mph` | for a field that carries its own unit |
  | `invalid` | values that mean no limit is known |
  | `end` | values that mean the end of a limit, or unlimited |
  | `map` | for an enum field: `{ "<raw>": km/h, "end" or null }` |
  | `min` / `max` | the plausible range, default 5–250 |

  It never throws.
- The four states:

  | State | Raw value | What we draw |
  |---|---|---|
  | No limit known | `invalid`, out of range, missing | no sign |
  | Limit | a number in range | our limit sign with the figure (`{{limit}}`) |
  | End of limit / unlimited | `end` (or `map` → `"end"`) | the end-of-limit sign |
  | No overtaking | `config.nopass.on` (default `[1, true]`) | our no-overtaking sign, beside the limit sign; any other value hides it |

- **Log** (for calibration on the car): `speed limit raw: <raw> -> <80 km/h | none | end>` and `no-passing raw: <raw> -> on|off`, written once per new raw value.
- **The "6WB Dials + G20" window over BMW's sign** (`cut.cover: "limit"`):
  - closed whenever `_signWired()` is true;
  - not wired: closed while our sign shows (the demo drive), open otherwise.
- `_raw('limitEnd')` is new. `_raw('limit')` no longer falls back to the demo's 90 while the car reports the end of a limit.

**`shared/shaders.js` WBSIGN:**
- `u_show.x = 2` draws the end-of-limit sign: a white disc, a thin grey ring and five diagonal stripes from upper right to lower left.
- It works on the baked path (at the limit sign's rectangle) and on the drawn path.
- Uniforms: still 7, all highp. Lengths are scaled (`length(q / R) * R`), so they are safe in fp16.

**The bench** (`bench/run-app.js`, `bench/page.html`, `bench/README.md`):
- Manual `limit` (km/h; `0` or none means none; `"end"` or a value below 0 means end) and `nopass` (`1` means on). They are fed every 50 ms as the configured field's raw value, with factor, unit, path, `invalid`, `end`, `map` and `on` undone.
- With the config `null`, the bench stands in `bench.SpeedLimit` and says so in its log. `BENCH_LIMIT=off` runs exactly as the car does today.
- The page has `limit` (−10…130) and `nopass` sliders.

## 4. Our sign in the 6WB layouts (bench proof)

Bench on port 8085, manual signals at 80 km/h, the G20 simulation showing BMW's sign at 50 (`g20limit=50`). The "wired" shots use the bench's stand-in field.

- `docs/polish/e/signs_wb_dials.png` ("6WB Dials + G20"), six states:
  1. **Not wired (today on the car):** the window is open and BMW's 50 shows.
  2. **Wired, limit 80:** our 80 shows and BMW's 50 is covered.
  3. **Limit 80 plus no overtaking.**
  4. **End of limit.**
  5. **Wired but nothing known:** black.
  6. **Limit 60 plus no overtaking at 100 km/h:** the speedo's over-limit band runs from 60 to 100.

  The full frames are `wb_dials_wired_limit80.png` and `wb_dials_unwired_bmw_sign.png`.
- `docs/polish/e/signs_wb_comfort.png` and `signs_wb_comfort_map.png` ("6WB Comfort", "6WB Comfort + BMW map"): the limit, limit plus no overtaking, end, none (no sign) and over-limit states. The sign shows, hides and switches correctly in both.

**What "wired, but the car sends nothing yet" looks like: black.** The reasons:
1. The owner's rule is that space with no content is pure black, and that BMW's sign must not show through.
2. Once the field is wired, BMW's sign and ours come from the same data. If the car sends nothing, BMW has nothing either. Opening the window would at best show an empty BMW spot.
3. Switching between BMW's sign and ours as the data comes and goes would flicker between two styles.
4. The only case where open would be better is a wired field that never sends anything. Then the owner should un-wire it (set it back to `null`), and the window returns to today's behaviour.

## 5. "G20 Comfort": should ours cover BMW's sign?

Mockup: `docs/polish/e/g20_comfort_sign_mockup.png`, with three panels: today (BMW's 50), ours in its place, and wired with nothing sent (black). The full frame is `g20_comfort_mock_ours_full.png`.

**Recommendation: keep BMW's sign in "G20 Comfort".** The reasons:
- This layout is meant to look stock, and BMW's sign is the stock look. Ours is heavier: a thicker orange-red ring, 44 px against BMW's 41, and our figure font.
- A black disc for "wired, nothing sent" cuts BMW's stock bottom line (the third panel). Covering only while our sign shows avoids that, but adds a state that BMW's own sign already handles.
- **Cost against the brief's cap of ≤ 1 layer and one existing texture:**
  - The WBSIGN effect is 1 layer. It needs `sign_limit`, plus `sign_nopass` or a drawn no-overtaking sign, because every sampler needs an asset.
  - The figure is a text widget. It lands in a sheet of its own (the layout's other texts are at x 1424), which is a second layer.
  - Total: 2 layers, over the cap, so it was not built.
  - Pixel memory would be +0.06 MiB per sign texture; the layout uses 8.0 of 16 MiB.
  - A 1-layer build would need the figure drawn inside the sign shader: a glyph atlas sampler or stroke digits. That is new shader work in a layout no package owns.
- **One use for this layout during calibration:** it keeps BMW's sign visible, so it is the best place to compare the logged raw value with what BMW shows (§7).

## 6. Budgets

No change in any layout. No widget, layer, asset, texture or uniform was added. The end sign is a shader branch.

| Layout | Layers (per connection) | Pixel memory |
|---|---|---|
| 6WB Comfort | 19 (6 + 6 + 7) | 11.3 of 16 MiB |
| 6WB Comfort + BMW map | 19 (6 + 6 + 7) | 10.6 of 16 MiB |
| 6WB Dials + G20 | 16 (5 + 6 + 5) | 10.1 of 16 MiB |
| G20 Comfort | 6 (2 + 2 + 2) | 8.0 of 16 MiB |

WBSIGN still has 7 uniforms and 2 samplers, both bound.

## 7. What the owner has to do on the car

All steps are read-only until step 3. Never kill the app's process; use `systemctl restart oapcontroller` if needed.

1. **Copy and rank the catalogue:** `./scripts/find_limit_signal.sh root@<car>`.
   - It saves `reference/someip-interfaces.json`. That is BMW's file: it is git-ignored and must never be committed.
   - It prints the candidate fields with their flag (`s` or `rs`), instance, members and enum items, plus ready-to-paste `signals` and `config.limit` lines for the best one.
   - A candidate with no notifier cannot be subscribed. One whose instance is not `1` needs a code change (the kit's `car.js` subscribes instance `1`), so tell the lead.
2. **Choose the field.**
   - Prefer the sign the camera and map agree on (an "actual" or "current" limit), not "next" or route data.
   - For no overtaking, look for NPI / overtaking / `orInfo` names, or a member of the same structure as the limit.
3. **Wire it in `app.json`.**
   - Add the interface under `signals` with the printed flag.
   - Set `config.limit` and, if found, `config.nopass`. Use the shapes in `config._limit`.
   - Start with `invalid: [0]` and an empty `end`; step 6 fills them in.
   - Install through the Store. A change in `signals` changes the manifest, so `scripts/deploy.sh` (layouts only) is not enough. The install refuses a flag the field lacks.
4. **Read the values while driving.** Switch the cluster to "G20 Comfort", where BMW's sign stays visible, and drive past a few signs. Then, from the laptop:
   ```sh
   ssh root@<car> "grep -h -e 'speed limit raw' -e 'no-passing raw' /var/opt/public/oap/oap_*/data/f30_cluster.log | tail -n 40"
   ```
   or `./scripts/find_limit_signal.sh root@<car> --log`.

   Each new raw value appears once, for example `speed limit raw: 80 -> 80 km/h` or `speed limit raw: 255 -> none`.
5. **Compare with BMW's sign.**
   - For each sign BMW showed, note the raw value: 30, 50, 80, 100, 130, the end of a limit, no sign, and no overtaking on and off.
   - If the figures are off by a constant factor, set `factor`.
   - If the unit follows the car's setting, set `unitPath` and `mph`.
   - If the field is an enum, set `map`.
6. **Set the special values:**
   - `invalid`: the raw values seen with no sign;
   - `end`: the raw values seen at an end-of-limit sign;
   - `nopass.on`: the values with the no-overtaking sign.

   Reinstall.
7. **Check "6WB Dials + G20".**
   - BMW's sign never peeks through the round window: with a limit, with no limit, at the end of a limit, and at start-up.
   - Our sign shows and switches with BMW's, as seen in "G20 Comfort".
   - The spot is black before the first sign.
8. **Check "6WB Comfort" and "6WB Comfort + BMW map"** the same way. Look at the over-limit band on the speedo.

**Choices for the owner:**
- "G20 Comfort": keep BMW's sign (recommended) or build ours (2 layers; §5).
- "Wired but nothing sent" in "6WB Dials + G20": black (default) or BMW's window open. One line in `hud.js` changes it.
- The end-of-limit sign's look (`signs_wb_dials.png`, fourth panel): the stripes' weight and the grey ring.

**Left open:**
- The field itself, which only the car's catalogue can give.
- If its instance is not `1`, the kit's `car.js` needs an instance option (lead).
