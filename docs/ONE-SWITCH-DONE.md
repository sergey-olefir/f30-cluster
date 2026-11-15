# ONE SWITCH: done — one control for the bottom row, "+ G20" as a toggle

Branch `feat/one-switch`, off `integrate/0.7.15` (`b31e312`). **Bench only, port 8220. The car was not contacted.**
No version bump, no merge, no push. The analysis this implements is `docs/ONE-SWITCH-PLAN.md` on branch
`design/one-switch`; every number below was measured again on this base, because the plan's were taken one commit
earlier (`d539d6b`).

What the owner asked for (2026-11-15): *"тоді в режимі г20 треба зробити тільки один перемикач. all6WB vs allG20.
можемо? в спорті режим +Г20 забираємо."* — one binary switch for the row, and "6WB Sport + G20" gone.

---

## 1. The two settings, and nothing else

| | |
|---|---|
| key | **`g20`** |
| type | `bool` (it must be: `_toggleOn`'s plain-key branch reads anything that is not `false` as on) |
| default | `false` |
| label | **"BMW's G20 round our dials (Comfort)"** |
| where | the MAIN menu, directly under **Theme**; skipped in the Settings list so it is not repeated |

| | |
|---|---|
| key | **`bottomRow`** |
| type | `choice`, **no `"reset"`** (a reset would force the default over the migrated value, `mgu.js:105-108`) |
| default | **`allG20`** |
| label | **"Bottom row while G20 shows"** |
| options | `allG20` → "All BMW's" · `all6WB` → "All ours (6WB style)" |
| where | the Settings list, and **hidden while `g20` is off** (`config.menu.hideRowUnlessG20`, the same RHMI `Visible` property as `hideModeRows`) |

Gone: `ownRange`, `ownClock`, `ownTemp`, `ownNav`, `ownSign`, `ownInfo`, `ownAll`, the settings group
"Who draws this", and the `ownAll` handler in `shared/hud.js` (with it, the ~248-RPC burst one press of it caused).

**Why `allG20` is the default.** It is what the owner's car draws today, it is the lower of the two budgets
(10.7 MiB against 13.2 MiB) and it is the safe side for BMW's own telltales: `all6WB` turns on `nav_bg`, the black
bar from x 690 that masks BMW's street line, and closes the round window over BMW's speed-limit sign.

**What "it only means anything while G20 shows" means in code.** `_own()` asks the switch only while the layout
being built is **see-through** — a layout with a `wbback` that has a `collar` (`wb_dials`, `wb_sport_dials`), looked
up from the layout file itself and cached per name (`_seeThrough`). In the opaque themes our own background covers
BMW's row, so the row is ours there whatever the switch says, which is why the row is hidden then. Reading the four
layout files confirms this costs nothing: `own:range`, `own:temp`, `own:nav`, `own:sign`, `own:info`, `{{road}}`,
`ccName`, `ccSym` appear **only** in the two see-through files. The one `own:*` toggle the opaque themes do use is
`own:clock`, and the clock keeps its old rule.

**The clock.** `ownClock`'s "auto" is now the permanent rule for every theme: our clock is drawn only once a time
zone is known (`timeZone`, the car's own zone while `config.clock.confirm` is true, or `config.utcOffsetMinutes`).
Without one the head unit runs on UTC and only BMW's clock is right (the two-hours-behind bug,
`docs/AGENT-BRIEF-car3.md:64`). The one option that is gone is a forced "ours" with no time zone, which drew a wrong
clock.

**`_rowFail` still wins.** The latch is still the first line of `_own()`: an element whose signal is missing or
unmapped, or whose drawing throws, is BMW's again until the app restarts, whatever the switch says, and the switch
cannot clear the latch. `_rowCheck()` no longer reads `ownSign`/`ownInfo`/`ownNav`; it asks `this._own(...)` and
returns at once unless the layout showing is see-through, so it cannot latch an element the switch never asked for.
Verified on the bench: with `all6WB` and a street name our font cannot draw, `nav` gave itself back to BMW, our label
was dropped, and `range` / `temp` stayed ours.

**One behaviour change to know about.** In the **opaque** 6WB themes the row is now always ours, so a car that had
`ownClock: "bmw"` **and** a known time zone will now see our clock next to the outside temperature in 6WB Comfort
(widgets `row_b0`/`row_b1` instead of the centred `row_b2`). Measured cost: one widget, same 21 layers, same
11.5 MiB. The owner's car has no time zone (`timeZone -9999`, `config.clock.confirm false`,
`utcOffsetMinutes null`), so for that car nothing changes.

## 2. "+ G20" is a toggle, not a theme

`hudLayout`, `inComfort`, `inSport` and `inEco` lost the rows `wb_dials` ("6WB Dials + G20") and `wb_sport_dials`
("6WB Sport + G20"). `_layoutName()` maps the theme to its see-through **file** while `g20` is on:

```js
const G20_OF = { wb_comfort: 'wb_dials' };          // one entry: Comfort is the only theme with a variant
const G20_THEME = { wb_dials: 'wb_comfort', wb_sport_dials: 'wb_sport' };   // the way back, for the names
```

So the file that is built, the textures it binds and the shaders it compiles are exactly the ones built today; only
the name that selects them changes. The names on screen go back through `G20_THEME` and gain `" + G20"`, in
`hud.js _layoutLabel()` (the status line) and `menu.js layoutName()` (the NOW row, STATUS). `NOW_GFX` still looks the
preview up by the **file** name, so `hud/previews/wb_dials.json` keeps supplying the right picture; the gallery's
cards are themes, so `gallery.js` maps the shown file back to its theme to mark the right card. `g20` joined
`LOOK_KEYS`, so turning it on clears the KOMBI guard and takes the shared screen back, as picking a theme does.

**Eco Pro and Sport stay opaque with the toggle on.** `wb_eco` has no see-through variant and Sport's was retired,
so `G20_OF` has no entry for them — measured: `wb_sport` and `wb_eco` build byte-identically with `g20` on or off.
That is said in the setting's label ("… (Comfort)") and in its `_about` text in `app.json`.

### What happened to `wb_sport_dials`

**Stopped being offered; the file and `sport_dials()` in `design/gen_6wb.py` are kept and still generated.** Reasons,
in order of weight:

1. It is the safety net for the one catastrophic failure mode in this change. If a saved `inSport` still named
   `wb_sport_dials` and the file were gone, `layouts.load` throws, `hud.js:2437-2442` sets `this.problem` and
   **nothing at all is drawn** — the only sign being a "Problem:" line on the centre screen. With the file there, a
   settings.json that escapes the migration still draws, and is still labelled "6WB Sport + G20".
2. It costs nothing while it is not offered: nothing loads it, so no layer, no sampler, no pixel memory, only a few
   KB in `hud.pack`.
3. Re-offering it later is one entry in `G20_OF`; deleting the generator function would throw away work that is
   measured and known good (15 layers, 3.0 MiB).

The layout titles inside the JSON files were left alone on purpose: changing them would rewrite the generated files
for a log line. (Note for whoever regenerates them: `design/gen_6wb.py` output already differed from the committed
JSONs on this base — font cell heights — before this branch touched anything, and this branch changed only its
comments.)

## 3. Migration — measured, not reasoned

One shot, marked `_oneSwitchV`, in `apps/f30_cluster/main.js` **before** `new HudApp(ctx)`, wrapped in try/catch so a
failure leaves the old values in place (which still draw). It can read the retired values because `Settings.values`
keeps keys that `app.json` no longer declares (`mgu.js:90-91`). Rules:

* a saved `hudLayout`/`inComfort`/`inSport`/`inEco` naming a "+ G20" file is rewritten to its theme; the `g20` toggle
  is turned on **only** when that theme still has a variant (so a `wb_sport_dials`-only car keeps the toggle off:
  turning it on would not bring Sport's variant back and would make Comfort see-through, which that driver never
  asked for);
* the seven `own*` keys become one: **any** item that was `"ours"` makes the whole row ours (`all6WB`), otherwise
  `allG20`. A mixed row cannot be kept — that is the point of the request — and it rounds **up**;
* the seven keys are then deleted from `values`; the dead `_reset_ownRange` / `_reset_ownClock` / `_reset_ownTemp`
  marks stay, which is harmless;
* the mark is written last, so a half-written migration runs again.

Every row below was run on the bench: seed `settings.json`, start the app, read back `settings.json` **and** what was
drawn, then start a second time on the same folder to prove it does not move anything twice.

| saved before | after | drawn |
|---|---|---|
| **the owner's car** — `hudLayout off`, `byMode false`, `ownRange/ownClock/ownTemp "bmw"`, nav/sign/info `"bmw"`, `ownAll "keep"`, `timeZone -9999` | `bottomRow "allG20"`, `g20 false`, `hudLayout off` | `off` — "Cluster off: BMW's own cluster shows". **Unchanged.** |
| the shipped defaults with theme `wb_dials` (`ownRange/ownTemp "ours"`, `ownClock "auto"`) | `hudLayout "wb_comfort"`, `g20 true`, `bottomRow "all6WB"` | `wb_dials`, "6WB Comfort + G20", 20 layers, 13.2 MiB |
| the dead `ownAll "bmw"` with all six `"ours"` | `bottomRow "all6WB"`, `g20 false` | `wb_comfort`, 21 layers, 11.5 MiB (migrates to what was *drawn*, not to what the dead row *said*) |
| `inComfort wb_dials` + `inSport wb_sport_dials`, row all `"bmw"` | `inComfort "wb_comfort"`, `inSport "wb_sport"`, `g20 true`, `bottomRow "allG20"` | `wb_dials` |
| `inSport wb_sport_dials` only, Comfort opaque, range/temp `"ours"` | `inSport "wb_sport"`, **`g20 false`**, `bottomRow "all6WB"` | `wb_comfort` (Comfort is not made see-through behind the driver's back; Sport loses its see-through look, which is decision 4) |
| a fresh install (no `settings.json`) | `bottomRow "allG20"`, `g20 false` | `wb_comfort`, 21 layers, 11.5 MiB |

A second start logged "(no migration line)" and left every value untouched in all six cases.

**Why the migration is not optional:** with the option row gone, `hud.setting('hudLayout')` refuses a saved
`wb_dials` (it is no longer one of the options) and silently returns the **default** theme, and the drop-down shows
row 0. If the file were ever deleted as well, the app would draw nothing at all.

## 4. Budgets, measured per theme, fresh app start each time

Bench port 8220, one app start per row (so no glyph atlas or scene texture is carried over — `this.atlases` survives
a rebuild). Limits as the bench models cluster-render: **8 layers per connection, 32 service-wide, 16 MiB of pixel
memory, every image counted twice.**

### Before (`b31e312`, the seven settings at their defaults)

| layout | widgets | layers (effects + sheets) | per connection | pixel memory |
|---|---|---|---|---|
| `wb_comfort` | 44 | 21 (7 + 14) | 7 + 7 + 7 | 11.5 MiB |
| `wb_dials` | 40 | 17 (6 + 11) | 7 + 5 + 5 | 11.0 MiB |
| `wb_sport` | 27 | 18 (8 + 10) | 7 + 6 + 5 | 2.1 MiB |
| `wb_sport_dials` | 27 | 15 (7 + 8) | 7 + 4 + 4 | 3.0 MiB |
| `wb_eco` | 30 | 14 (6 + 8) | 7 + 6 + 1 | 3.0 MiB |
| `g20_comfort` | 9 | 8 (4 + 4) | 2 + 2 + 4 | 8.7 MiB |
| `f30` | 8 | 7 (4 + 3) | one connection | 1.0 MiB |

Before, at the old row's extremes (with the `_reset_*` marks set, or the kit forces the defaults back):

| layout | row | widgets | layers | per connection | pixel memory |
|---|---|---|---|---|---|
| `wb_dials` | all six `bmw` | 35 | 15 (6 + 9) | 6 + 5 + 4 | 10.7 MiB |
| `wb_dials` | all six `ours` + a time zone | 47 | 20 (8 + 12) | 7 + 7 + 6 | **13.2 MiB** |
| `wb_sport_dials` | all six `bmw` | 22 | 14 (7 + 7) | 6 + 4 + 4 | 2.5 MiB |
| `wb_sport_dials` | all six `ours` + a time zone | 34 | 18 (9 + 9) | 7 + 6 + 5 | 4.9 MiB |

### After (this branch)

| setting | layout built | widgets | layers | per connection | pixel memory |
|---|---|---|---|---|---|
| `wb_comfort`, `g20 false` | `wb_comfort` | 44 | 21 (7 + 14) | 7 + 7 + 7 | 11.5 MiB |
| `wb_comfort`, `g20 true`, `allG20` | `wb_dials` | 35 | 15 (6 + 9) | 6 + 5 + 4 | 10.7 MiB |
| `wb_comfort`, `g20 true`, `all6WB` | `wb_dials` | 46 | 20 (8 + 12) | 7 + 7 + 6 | **13.2 MiB** |
| `wb_comfort`, `g20 true`, `all6WB` + time zone | `wb_dials` | 47 | 20 (8 + 12) | 7 + 7 + 6 | **13.2 MiB** |
| `wb_comfort`, `g20 false`, `all6WB` + time zone | `wb_comfort` | 45 | 21 (7 + 14) | 7 + 7 + 7 | 11.5 MiB |
| `wb_sport`, `g20 true` | `wb_sport` | 27 | 18 (8 + 10) | 7 + 6 + 5 | 2.1 MiB |
| `wb_eco`, `g20 true` | `wb_eco` | 30 | 14 (6 + 8) | 7 + 6 + 1 | 3.0 MiB |
| `g20_comfort` / `f30` | unchanged | 9 / 8 | 8 / 7 | 2+2+4 / one | 8.7 / 1.0 MiB |

**Identical to before, as it must be: the same files are built.** Nothing was added to any layout. 6WB Comfort still
sits at **7 of 8 layers on all three connections**, and `all6WB` on `wb_dials` is still the tightest state the app
can be put in (13.2 MiB of 16, 7 of 8 layers on two connections) — one tap away now instead of six, which is the
only real cost of merging the seven rows.

**Eight toggles with no restart**, in that tightest state (`all6WB`, a time zone set, so even the clock is ours):
`wb_dials` 20 layers / 13.2 MiB alternating with `wb_comfort` 21 / 11.5 MiB, **no refusal, no layer or
pixel-memory warning, no KOMBI guard strike, no ERROR line**. The toggle costs exactly one `_rebuild()`, the same as
changing the theme, and the rebuild drops the scene textures the new layout does not use **before** making the new
ones.

## 5. Shader sources — unchanged, as expected

Route A touches no GLSL. Measured with `shaders.wbbackFor(n)` / `wbdialFor(n)`, before and after, byte for byte the
same (comments are stripped from the compiled source, so even the one comment this branch edited in `shaders.js`
does not show up):

| source | chars | lines |
|---|---|---|
| WBBACK STYLE 0 (Comfort — compiled by **both** `wb_comfort` and `wb_dials`) | 8785 | 191 |
| WBBACK STYLE 1 / 2 / 3 / 4 | 8131 | 176 |
| WBDIAL STYLE 0 Comfort | 12403 | 252 |
| WBDIAL STYLE 1 / 2 / 3 / 4 | 6544 / 6360 / 6969 / 6236 | 163 / 161 / 172 / 158 |

`wb_comfort` and `wb_dials` are both `"style": "comfort"`, so the opaque/see-through difference is carried entirely
by uniforms and sampler bindings — which is why the toggle costs nothing in shader size and cannot repeat 0.7.13's
KOMBI reset.

## 6. Tests

| suite | before | after | why |
|---|---|---|---|
| `bench/test-native-ui.js` | 42 passed | **46 passed, 0 failed** | −2 checks (two fewer theme rows in the `hudLayout` sweep, which the test derives from `app.json`), +6 new ones for the toggle |
| `bench/test-bottom-row.js` | 69 passed | **75 passed, 0 failed** | see below |

Both suites were run on `b31e312` first (42/42, 69/69) so the "before" is this base and not the plan's.

`bench/test-native-ui.js` — one new section, nothing weakened:
* `SET_G20` is wired as a checkbox and off; `SET_BOTTOMROW` is hidden while G20 is off;
* a press on `SET_G20` builds `wb_dials`, the NOW row reads **"6WB Comfort + G20"**, and `SET_BOTTOMROW` becomes
  visible; a second press builds the opaque `wb_comfort` again and hides the row.
  (The NOW row is part of the `until(...)` condition, not asserted immediately: `menu.js` refreshes 250 ms later,
  and asserting before that made the check flaky — the first run passed, the second failed.)

`bench/test-bottom-row.js` — the plan measured 8 of its 69 checks failing without an update, because
`bench/run-app.js:100-112` presses a drop-down **by option row** and a value that is no longer an option is refused.
Each change is a rename of the mechanism, not a weakening of the assertion:
* `set('hudLayout','wb_dials')` → `set('hudLayout','wb_comfort')` + `click('SET_G20')`, and the test still asserts
  that `wb_dials` is what gets built (plus `settings.g20 === true`);
* the defaults block now asserts `bottomRow === 'allG20'` and that the engine reports **all six** items as BMW's
  (it used to check only nav/sign/info), and still that no widget of ours is built;
* the three `set('ownNav'|'ownSign'|'ownInfo','ours')` presses became one `set('bottomRow','all6WB')`; the same five
  assertions follow (label + bar, sign + figure, message text, the text is the car's own, the road steps aside);
* the `ownAll` block became one `set('bottomRow','allG20')`, still four assertions: our sign is dropped, the switch
  holds its value, nothing of ours is built for the whole row, every item reports BMW's. The two assertions that
  only made sense for `ownAll` (all six keys went to `bmw`, the row sprang back to `keep`) are gone with the setting;
* **added**: after the font-failure latch, that the latch is that one element's (`range`/`temp` stay ours) — the
  `_rowFail`-still-wins requirement, which nothing covered before;
* **added**: a G20 section — six presses of `SET_G20` with no restart, each asserting the right layout builds with no
  refusal in the status line, that the status line says "6WB Comfort + G20", and that the log holds no KOMBI guard
  strike;
* the "every layout still builds" sweep is unchanged code and now sweeps 8 rows instead of 10.

## 7. What was verified on the bench, and what is a guess

The owner's standing rule: agent findings are hypotheses until the car confirms them. **Nothing below was run on the
car; the car was never contacted.**

### Verified on the bench, reproducible

* Both suites: 42/42 and 69/69 on `b31e312`, then 46/46 and 75/75 on this branch.
* Every budget figure in §4, each from a fresh app start, and the before/after equality.
* Eight G20 toggles with no restart in the heaviest row state: no refusal, no layer or pixel-memory warning, no
  KOMBI strike, no ERROR.
* All six migration rows in §3, including the owner's car's state → `allG20` with nothing drawn, and that a second
  start moves nothing.
* `_rowFail` still wins and is per element: a street name our font cannot draw hands `nav` back while `range` and
  `temp` stay ours; the log names the font and the count, never the street.
* The shader lengths in §5, before and after.
* "6WB Comfort + G20" on the status line, in the NOW row, and the gallery marking Comfort's card while `wb_dials`
  is what is drawn.
* `SET_BOTTOMROW` hidden while `g20` is off and shown while it is on — *as the bench's RHMI stub records the call*
  (see the guesses).

### Verified by reading the code only

* `own:range`/`temp`/`nav`/`sign`/`info`, `{{road}}`, `ccName` and `ccSym` appear only in the two see-through layout
  files, so forcing the row "ours" in the opaque themes changes nothing but the clock.
* `Settings.values` keeps keys `app.json` no longer declares, which is what lets the migration read them.
* `wireSettings` is registered before `impl.start`, so the migration's one `set` makes the HMI show the migrated
  values.
* The legacy clause at the old `hud.js:3851` (`!settings.item('ownSign') && (signWired || …)`) had to go: with the
  setting removed it would have become live and closed the window over BMW's own speed-limit sign even at `allG20`.

### Guesses and unverified assumptions

* **Whether the HMI honours `Visible` on a list row.** It is the same property and the same code path as
  `config.menu.hideModeRows`, which is itself still listed as unverified on the car
  (`docs/UI-NATIVE-REPORT.md:74`); the bench's `ui.visible` is a stub that only records the call. If the car ignores
  it, the row simply stays visible and is **inert** (with G20 off the switch changes nothing), so nothing breaks —
  set `config.menu.hideRowUnlessG20: false` to stop trying.
* **The drawn settings sheet** (`listSheet`, only on the Store's renderer) lists the schema itself and does not know
  about hiding, so the row will show there with G20 off. Cosmetic, unverified on the car.
* The owner's current values come from `docs/CAR-SNAPSHOT-2026-11-15.md:158`, not from that car's own
  `settings.json`, so the claim "migrates to `allG20`, behaviour unchanged" is as good as that snapshot.
* The bench's 16 MiB / 8-layer limits are the bench's model of cluster-render. This change builds the same files as
  before, so nothing here depends on the model being right; `all6WB`'s 13.2 MiB is the one figure where it matters,
  and it was already reachable on `integrate/0.7.15`.
* **How the merged row looks on the car** — this branch draws nothing new, so I expect no visual change at all
  outside the two deliberate ones (the row label now says "+ G20"; our clock appears in opaque Comfort once a time
  zone is known). Only the car can say.
* Anything about which path the owner's car took into the dead `ownAll` row: the mechanism is proven on the bench
  (`docs/ONE-SWITCH-PLAN.md` §1), the history is not. The row is gone either way.

### Known loose end, deliberately not touched

Research harnesses under `tools/` drive the bench with `inComfort = wb_dials` (`tools/g20sim/qc_shots.sh`,
`tools/g20sim/pointer_sweep.sh`) or sweep `wb_dials` / `wb_sport_dials` by name (`tools/perf/*.sh`,
`tools/perf/*.py`, `tools/f30font/shots.py`, `tools/ref/tray_proof.py`). Those values are no longer options, so such
a run would now draw the default theme instead. Nothing ships from `tools/`, and fixing them is not part of what was
asked: each needs `hudLayout`/`inComfort` plus `g20: true` instead of the file name.
