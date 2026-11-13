# Package K report: BMW's black box after a switch

Brief: `docs/AGENT-BRIEF-car3.md` §7. Branch `car3/k`.

**Short version.**
- A layout switch does not release or re-map our slot. The photos show one switch with no black box afterwards.
- The box arrived later in the drive and then stayed. That fits best with cluster-render moving the panel onto the speech-dialog scene id, but this is a **hypothesis**.
- One read-only check of cluster-render's status file on the car settles it (§5).
- `shared/hud.js` gets one guarded block with two test modes. Both are **off** unless a flag file exists on the car.

## 1. What the photos say (EXIF times, local, 2026-11-13)

| Photo | Time | Layout | Box over the tacho hub | Notes |
|---|---|---|---|---|
| 32, 33 | 10:42:32, 10:42:41 | 6WB Comfort, theme on at start-up | **no** (our red hub ring shows) | P; BMW's car picture in the middle |
| 34–37 | 10:43:00 – 10:43:35 | 6WB Dials + G20, **after a layout switch** | **no** (our hub ring and full needle show in 34) | P; BMW's "P" in the bottom row, street name |
| 38 | 10:52:19 | 6WB Comfort + BMW map | **yes** (the hub is dark, the needle is cut short) | **D**; BMW's full map in the middle |
| 39, 40 | 10:53:34, 10:53:44 | the G20 look | – | D, COMFORT PLUS (package J decides whether this is stock) |
| 41–43 | 10:54:18 – 10:54:52 | 6WB Dials + G20 | **yes** (hub dark, needle cut at the box) | D2; BMW's map |

What follows:
- **A layout switch alone does not bring the box.** 32 → 34 is a switch with no box after it.
- **The box came at some point between 10:43:35 and 10:52:19.** Several things changed in that window: the gear went P → D, BMW's map came up in the middle, at least one more layout switch happened (→ Comfort + BMW map), and maybe a drive-mode change.
- **Once there, it stayed** through the later switches (38 → 41).

The earlier photos (`reference/g20/11`–`16`, Nov 11–12) show the box in P as well (15: gear P, box present). So the box is not simply "in D".

## 2. What a switch does to the slot (code read, bench measured)

How cluster-render (upstream `native/cluster-render`, read only) handles our layers:
- One scene in slot 0x203 holds every layer of every client on `panel`.
- `src/stack.cpp` `arrange()`: the target is **wanted** while any visible layer is ready (an effect layer once every asset it binds has pixels, an image layer once its first write came) or has `prewarm`.
- `src/slots.cpp` `tick()`: a shown target that no layer wants goes `lingering`. It is released (unmapped and unfetched) only after `panel_linger_ms` = **3000 ms**. A wanted target that is `lingering` goes back to `shown` with no display traffic.

Our rebuild (`hud.js _rebuildInner`) drops every layer on all three connections, then makes the new ones in the same JS turn.

**Bench measurement.** `docs/car3/k/slot_model.js` is a stand-in socket that answers like cluster-render and replays the two rules above. The built app ran against it with eight switches: four layouts (6WB Dials + G20, Comfort + map, G20 Comfort, 6WB Comfort) and four drive-mode changes.
- In each switch, no layer wanted the panel for **3–19 ms** (`slot_model_results.json`, `off`).
- That gave **1 request, 0 releases** for the whole run: the slot was never re-mapped.

The car's CPU and Node 8 are slower, but the margin is more than 100×. So **our app does not re-map the panel on a switch**. That agrees with photo 34.

## 3. The cause: ranked hypotheses

**H1 (most likely): the panel fell back to scene id 0x01000400, and the KOMBI shows its speech-dialog layout for that id in 0x203. That layout includes the box.**
- Up to cluster-render 0.5.0 the panel used 0x01000400, the HUD's id and also HmiMain3D's speech dialog. Since 0.5.1 (2026-11-10, upstream commits 162c28e3 and c3d74c44) it has its own id, 0x010004f8.
- It falls back to 0x01000400 "until cluster-render restarts" in two cases: when the KOMBI refuses its own id as unknown on a request, or when the mapping guard disables that id.
- Upstream issue #142 shows that the KOMBI re-lays out its display ("as if a speech dialog were open") when content with id 0x01000400 is in a slot: the HUD's speed moved and ACC disappeared.
- This explains every photo:
  - Nov 11–12: box in every state, because the older id or a fallback was in force.
  - Nov 13 start-up: no box, because cluster-render restarts with the head unit and the guard is reset by a new version.
  - Later the same drive: the box appears once something made cluster-render ask for the slot again (a lock such as door-open, a scene accepted but not mapped, a renderer recovery). Then it stays.
- A second path to the same effect: the **HUD target** also uses 0x01000400 (slot 0x323). If a HUD client (Waze's HUD map, a HUD app) shows, the same layout switch may happen.

**H2: the KOMBI applies a "content in 0x203" layout when its own state changes** (P → D, map view, drive mode) while our scene is mapped, and a fresh mapping might reset it. Weaker: photo 15 has the box in P.

**Ruled out by evidence: our rebuild re-maps the slot.** See §2 and photo 34.

## 4. The change: one guarded block, off by default

`shared/hud.js`, block `// ---- car3 K ... ----` at the end of the file. It wraps `HudApp.prototype._rebuildInner` and touches no other line.

- **Off unless** `<app data>/car3k.json` exists with `{"slot":"keep"}` or `{"slot":"reseat"}`.
- The file is read at every rebuild, so it can be set and cleared on the car without a reinstall. The app log says `car3 K: slot mode ...`.

| Mode | What it does | Cost | Bench |
|---|---|---|---|
| (none) | nothing; exactly as 0.7.7 | – | `default_wb_dials.png` |
| `keep` | Keeps a 1×1 transparent effect layer (`prewarm`, class ambient, no sampler, no uniforms) on its own 4th connection across rebuilds, so the panel is always wanted and a switch cannot let the slot go. It is dropped when the layout is "off" or unusable, or when the screen is given to the other app. | 1 layer on a connection no layout uses (service total 25 of 32 at worst); 0 pixel memory, 0 assets | `keep_wb_dials.png` matches the default, except the minute of the clock. Model: 0 ms unwanted, 0 releases. |
| `reseat` | A switch to another layout (picked, or by drive mode) is built the way start-up builds it. All layers are dropped. The app waits until the target is `idle` (released): at least 3.8 s, at most 7 s. Only then is the new layout made, so the KOMBI maps our scene afresh. | BMW's own cluster shows for about 4 s at every switch (`reseat_during_switch.png`) | Model: one release and one fresh request per switch. Final picture matches the default (`reseat_wb_dials.png`). |

Neither mode can undo H1: after a fallback, every new request uses 0x01000400 again. The H1 remedy is in cluster-render's configuration (§5 step 4), not in our app.

## 5. The car test (owner)

Use the same session: start the car with the theme on, and do not restart the head unit in between. Paths are read only unless stated.

1. **At start-up (no box).** Run:
   ```
   ssh root@<car> "cat /run/cluster-render/status.txt | grep -i -e 'panel' -e 'slot 0x203' -e 'slot 0x323' -e 'hud' -e 'guard'"
   ```
   Note the content id in the `slot 0x203` row. `0x10004f8` is expected.
2. **Make the box appear.** Do these one at a time, and after each one note whether the box is there:
   1. switch layout (Comfort → Dials, as in 34);
   2. P → D → P with the foot on the brake;
   3. drive mode Comfort → Sport → Comfort;
   4. bring BMW's map up in the cluster;
   5. open and close a door.
3. **The moment the box shows,** run step 1 again, plus:
   ```
   ssh root@<car> "grep -e 'target panel' -e 'target hud' -e 'falling back' -e 'guard' -e 'not rendered' -e 'locked' -e 'not mapped' /var/opt/cluster-render/log/cluster-render.log | tail -n 60"
   ssh root@<car> "grep -h -e 'target panel' -e 'car3 K' -e 'layout \"' -e 'cluster-render status' /var/opt/public/oap/oap_*/data/f30_cluster.log | tail -n 60"
   ```
   Note which step brought the box.
4. **Read the result.**
   - **The `slot 0x203` row now shows `0x1000400`, or the log has `falling back to 0x1000400`** → H1 confirmed. The box is BMW's speech-dialog layout. The log line before the fallback names what the KOMBI refused.
     - `ssh root@<car> "systemctl restart cluster-render"` should clear the box until the next fallback. Our app reconnects by itself.
     - The lasting fix is to stop the fallback, which is the owner's decision: add the line `panel_fallback_scene_id =` (empty) to `/var/opt/cluster-render/cluster-render.local.conf`, then restart cluster-render. The panel then retries its own id instead of taking the dialog's. Upstream should get the log lines.
   - **A HUD target is shown with `0x1000400` in slot 0x323 while the box is there** → the same layout switch, from the HUD. Test with that HUD client off.
   - **The id is still `0x10004f8`** → H2. Go to step 5.
5. **Manual re-seat, no code needed.** With the box showing, set the Comfort layout to **Off** on our page, wait 6 s (BMW's cluster shows), then set it back.
   - Box gone → a fresh mapping clears it.
   - Box still there → the KOMBI keeps it whatever we do. Design as if it is there (the brief's rule already says so).
6. **Only with K merged (0.7.8 or later): the two modes.**
   - Switch a mode on:
     ```
     ssh root@<car> 'for d in /var/opt/public/oap/oap_*/data; do [ -f $d/f30_cluster.log ] && echo "{\"slot\":\"keep\"}" > $d/car3k.json; done'
     ```
     Then pick any layout on our page. The log shows `car3 K: slot mode keep` and `keeper layer made`.
   - Repeat step 2. `keep` should change nothing you can see. If the box still comes, the cause is not on our side (expected from §2).
   - Write `{"slot":"reseat"}` the same way, then repeat step 2.
     - Each switch shows BMW's cluster for about 4 s.
     - If the box is gone after every reseat while step 2 brings it back, step 5's finding is confirmed, and `reseat` (or a delay after the KOMBI's own state change) becomes the proposal.
   - Switch the modes off: `rm` the file (same loop with `rm -f $d/car3k.json`), then pick a layout.
7. **Safety check with either mode on.** At standstill, open the driver's door and unbuckle. The door-open message, the belt lamp and the (P) lamp must still show as they do now.

## 6. Files

- `shared/hud.js`: the car3 K block.
- `docs/car3/k/`:
  - `slot_model.js`: the stand-in service and its slot model. `node slot_model.js <dist/f30_cluster> <data dir> <steps.json> <out.json>`.
  - `slot_model_steps.json`, `slot_model_results.json`: the steps and the results for off, keep and reseat.
  - Bench renders: `default_wb_dials.png`, `keep_wb_dials.png`, `reseat_during_switch.png`, `reseat_wb_dials.png`.
- Nothing in `kit/` was changed.

## 7. Open

- Which step brings the box (§5 step 2); this is not on the photos.
- Whether 39/40 is stock (theme off, which would be a release and a fresh mapping at about 10:53) or our G20 Comfort: package J's call.
- The owner's cluster-render version on 2026-11-11, 11-12 and 11-13. Get it from the Store's installed list, or from the version cluster-render writes with its log file at each start (`/var/opt/cluster-render/log/cluster-render.log*`). Below 0.5.1 the panel always had 0x01000400.
