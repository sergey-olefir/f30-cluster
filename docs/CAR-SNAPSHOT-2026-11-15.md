# Car snapshot, 2026-11-15 (package S)

A read-only snapshot of the owner's head unit, taken over SSH on 2026-11-14 19:14–19:30 UTC. The unit's clock is UTC, and local time is UTC+2.

- **Nothing was written on the car.** No process was signalled, and no service was started, stopped or restarted. No SOME/IP or UDS call was made.
- **Raw data:** `reference/car/2026-11-15/` (git-ignored, 19 MB, 74 files). The VIN and a Wi-Fi network name were redacted in the raw copies too.
- **This document** holds no VIN, no keys and no personal data.

Times below are UTC unless marked "local".

## 0. Top priority: the cluster went dark at 19:07–19:12 (0.7.11)

### 0.1 What happened (verified from the logs)

**The KOMBI itself goes away about 2.3 s after it gets our 6WB scene.** This is a KOMBI reset, not a cluster-render or head-unit fault.

- **The IPsec tunnel to the KOMBI drops at the same moment each time.**
  - 160.48.199.96 is the KOMBI: `/etc/nftables/ipsec-kombi.nft`, and vsomeip's unicast for the KOMBI.
  - There were 13 "Dcsm2 not available" lines (19:07:05 – 19:12:49). For 11 of them, the kernel logs `SPD-delete` / `SAD-delete` for 160.48.199.99 ↔ 160.48.199.96 1–10 ms earlier. The other two (19:07:50, 19:08:26) fall in the kernel's audit rate limit ("callbacks suppressed"). The source is the waze-on-cluster journal copy, `logs/woc-journal/journal.log*`.
  - The tunnel is renegotiated (`SAD-add` / `SPD-add`) about 4 s later, when "Dcsm2 available" comes back.
  - A peer whose tunnel is torn down and renegotiated each time, with the display service gone in between, is a KOMBI restart. The 0.5.9 config itself says the mapping guard's strike is "a cluster restart within 10 s of a mapping".
- **The timing tracks our scene.** All 13 resets came 2.0–2.7 s after the 6WB layers reached the KOMBI. That was either a fresh mapping, or the switch to the 6WB Dials layout inside an already-mapped scene (19:07:33.4 → reset 19:07:35.8; 19:12:47.2 → reset 19:12:49.9).
- **Other layouts lasted longer.**
  - G20 Comfort was mapped at 19:07:28.8 and stayed 4.6 s with no reset, until the switch to Dials.
  - F30 was mapped for only 2.2 s (19:13:18.6 → off at 19:13:20.8), which is too short to judge.
- **What restarted cluster-render at 19:07:16 was the Store update to 0.5.12.**
  - `versions/0.5.12/` and the `current` link are dated 19:07, and the component's `restart` is `cluster-render.service`.
  - f30_cluster 0.7.11 was installed at 19:06:30 (commit 0aeda9a, from `mgu-updater/state/origins.json` and `diagOapDownloadStatus.json`).
- **The guard.**
  - Under 0.5.9 the first two resets were strikes 1 and 2 (19:07:05 and 19:07:13). Strike 2 disabled 0x10004f8 and put the panel on **0x1000400** (package K's speech-dialog id) at 19:07:13.99.
  - About 2 s later 0.5.12 started and logged `guard.txt removed: its strikes are not used`. The 0.5.12 config has no `guard_path` at all.
  - **So 0.5.12 has no mapping guard.** Nothing stopped the loop of map → KOMBI reset → re-map. That gave 11 more resets until the owner set the theme off at 19:13:20.
- **Now:**
  - settings.json has `hudLayout: "off"` and `byMode: false`. The app logs `off: nothing drawn, BMW's own cluster shows` every minute.
  - Dcsm2 has been up since 19:12:53, with no resets after 19:12:49.
  - Panel: 0x10004f8, idle (slot 0x203 status 1, map 0).
- **Ignition cycles look different.** The 4 other "Dcsm2 not available" lines on 2026-11-14 (14:22, 14:39, 15:23, 16:33) are 20–150-minute gaps. Those are ignition cycles, not this pattern.

### 0.2 Earlier occurrences

- **2026-11-13 11:46:53 / 11:47:01 / 11:47:10, same signature.** Strikes 9–11 on 0x1000400, each 2.4–2.5 s after mapping, under 0.5.8 (scene 5952 KB). So the KOMBI has reset on our scene before.
- **The boot record dated 2023-08-18 (before the clock was set) under 0.5.8:** `panel 0x10004f8 stays disabled after 2 strikes … using 0x1000400`.
- From 0.5.9's start (2026-11-13 11:50, "starting over for 0.5.9") until 19:07:13 today, every panel request used **0x10004f8**. The 0x1000400 fallback was active only before 11:50 on Nov 13, and for about 2 s at 19:07:14 today.

### 0.3 What differs between 0.7.10 (14:15–16:33) and 0.7.11 (19:06+)

| | 0.7.10 | 0.7.11 |
|---|---|---|
| 6WB Dials + G20 build line | 36 widgets, 17 layers (7 effects, 10 image sheets), 6 + 6 + 5, pixel memory 10.8 MiB, whole-sheet writes 1 305 380 B | **identical** |
| cluster-render's layer and asset list (log) | conn 1: 6 layers, assets 480×180, 736×64, 1×1, 670×670 ×2, 144×144 ×2; conn 2: 2 × 88×89 + 1 effect + 5 image; conn 3: 5 image | **identical** (same sizes, kinds and z) |
| "msa" layer | present (WBMSA, car3 I; it is the z-5 effect on conn 1) | present: not new, it only shows up in 0.7.11's "waiting" warnings |
| Scene charged when mapped | 5526 KB (e.g. 19:03:40, with 0.7.10 still running) | 5526 KB |
| Night colours | none | `night colours on (plain)` (it was dark: 21:07 local) |
| **Shader source** | – | **`nightLook()` + `u_nk0..2` (3 vec4) added to WBDIAL, WBBACK and WBSIGN**; Eco Pro `sk` scaling; window-ring change |
| Native menu, gallery, renderd | page.js | native RHMI menu + the drawn gallery (renderd) |
| cluster-render | 0.5.9 | 0.5.9 for the first 2 resets, then 0.5.12 |
| KOMBI resets | **none.** 0.7.10's Dials scene was mapped at night 19:03:40 → 19:06:25, 2 m 45 s, no reset | **13** |

**Uniform counts** (declared in the fragment source, `shared/shaders.js` 0.7.10 → 0.7.11, vec4 slots, samplers not counted):

| Shader | 0.7.10 | 0.7.11 |
|---|---|---|
| WBDIAL | 18 | 21 (23 declarations) |
| WBBACK | 24 | 27 (30 declarations with 3 samplers) |
| WBSIGN | 5 | 8 |

G20DIAL, used by G20 Comfort, which lasted 4.6 s, is unchanged at 16.

**Conclusion (hypothesis, strong):** the layer structure, sizes and pixel memory are the same as 0.7.10's. The only change in what the KOMBI receives is the shader code and uniforms of the three 6WB shaders. So the KOMBI's renderer resets on 0.7.11's WBDIAL / WBBACK / WBSIGN. Two candidate mechanisms:
- a fragment uniform or complexity limit on the KOMBI's GPU or driver. WBBACK is near cluster-render's 32-per-quad cap, and BAKE-P10 already saw the car draw WBDIAL only partly;
- a shader compile or link failure that the KOMBI's RAMSES renderer does not survive.

This could not be proven read-only: the RAMSES log contexts are set OFF over DLT (`Dlt changed log level from INFO`), and the KOMBI's own logs are not on the head unit.

Two further cases, not proven:
- **0.7.11 by day:** not tested. The uniforms are declared always, so it should reset too, if the hypothesis holds.
- **All 6WB layouts:** they all use wbback, dial and wbsign, so all are suspect. G20 Comfort (g20dial only) and F30 are the ones to keep.

### 0.4 What to do (proposals, not done)

- **Keep the 6WB layouts off on the car** until a build without the night-look shader change has been tried. G20 Comfort and F30 are the candidates to keep.
- **Bench / code (no car write):**
  - build 0.7.11 with `${NIGHT_GLSL}` and the `nightLook()` calls removed, which brings the shaders back to 0.7.10 plus the ring change;
  - or apply the night look as a separate tiny effect layer;
  - or pack u_nk0..2 into existing uniforms.
  - Try in this order, by day and night: 0.7.10 → 0.7.11 minus nightLook → 0.7.11.
- **Our own guard:** cluster-render 0.5.12 no longer has one. hud.js should stop asking for the panel after two "display service not available" events within ~3 s of its own mapping, and say so on the status line.
- **guard-reset is not needed:** 0.5.12 deleted guard.txt and does not read strikes. With 0.5.9 the command would have been `ssh root@<car> "/var/opt/cluster-render/current/cluster-render guard-reset"`. Upstream should hear that 0.5.12 removed the protection that caught this.

### 0.5 INVALID_MODELID (native menu)

- **When:** 20 times, always 10–250 ms after `renderd: on screen` / `renderd: not on screen` on the GALLERY state.
- **Cause (verified by code and data):**
  - `kit/runtime/display.js` `_hmiBar()` sets **`Visible`** on the screen's bar buttons `BTN_NEXT_THEME` (component 45) and `BTN_GALLERY_DONE` (46) each time the drawn screen takes or gives back the display.
  - In the installed uiDescription (identical to `dist/f30_cluster/rhmiData`), those two buttons, in layoutGroup "Bar", widget `LT_Button_1Row_Laptimer`, declare only `Focusable` (property 3). They have **no `Visible` property (id 2)**, so the HMI rejects the update as an unknown model.
  - Every other component with a Visible update has property 2.
- **Fix:** give the gallery's bar buttons `Visible` in the build (kit `build.py`), or skip `_hmiBar` for buttons without it. The error is harmless otherwise.

## 1. System

| Item | Value |
|---|---|
| Firmware | BMW MGU `P18_23w44.2-1-3` (mgu-high, image-high-appl), /etc/version 20231031083504 |
| Kernel | 4.14.198-apl, SMP PREEMPT, built 2023-08-18; `bootmode=APP1 hwvariant=HIGH config_version=MGU_A21255A_S9` |
| CPU | Intel Atom A3960 @ 1.9 GHz, 4 cores; governor powersave (1.3 GHz cur, cpu0 max 2.4 GHz) |
| Memory | 5.5 GiB; MemAvailable 2.25 GiB; swap 3 GiB unused; Committed_AS 21 GiB |
| GPU | i915; gt cur 750 MHz / act 600 MHz |
| Uptime at 19:15 | 4 h 52 m (boot 14:22 UTC); suspended to S3 between 16:33 and 19:03 |
| Load | 3.0–6.5 at the start; 1.9 / 3.3 / 5.0 in the 60 s probe |
| Disk | **`/` 95 % used (84.9 MB free)**; /var/opt 5 % (9.7 GB free); HDD data 18 % |
| systemd | **degraded**: `var-opt-ro.service` failed |
| Time zone | **No /etc/localtime, no /etc/timezone, no TZ: the system clock is UTC.** `date` = `date -u`. No RTC node. The app's `timeZone` setting is -9999 (auto). |
| Journal | volatile, `RuntimeMaxUse=12M`; DLT floods it (5004 "DLT ~1 messages discarded" lines in 2.5 min), so it keeps **only ~3–4 minutes**. The waze-on-cluster journal keeper (`/var/opt/waze-on-cluster/journal/journal.log*`) is the only history. |
| Cgroups (v1) | f30_cluster: `oap.slice/oap-foreground.slice`, shares 600, **no quota, 0 throttled**. cluster-render: `system.slice/cluster-render.service`, shares 1024, no quota, 0 throttled; memory 28 MB (peak 47 MB), no limit. |

## 2. OAP

| App | Version | Notes |
|---|---|---|
| f30_cluster (oap_12211) | **0.7.11** | installed 19:06:30 from commit 0aeda9a |
| penky_g20 | 0.1.1 | another G20 cluster theme; last log 2026-11-11 |
| robertn_waze_cluster | 0.6.8 | |
| robertn_store | 0.9.40 | |
| car_vitals | 2.27.3 | |
| ambient_config | 2.5.0 | |
| live_adjustments | 0.9.6 | |
| dtc_scanner | 2.9.7 | |
| draggy | 2.5.20 | |
| iteriodev_ambient | 1.4.1 | |
| BMW: oap-cdc-2018 | 3.31.43 | |
| BMW: trigger_service | 2.17.2 | |
| BMW: ts_battery_guard | 4.22.1 | |
| BMW: ts_diagnostic_service | 4.20.2 | |
| BMW: x_call | 4.25.3 | |

Tools under /var/opt:
- cluster-render 0.5.12 (0.5.9 kept);
- waze-on-cluster 0.9.14;
- idrive7-renderd 2.1.18;
- mgu-render;
- mgu-updater 0.8.45;
- iteriodev-comfort 0.6.0;
- mgu-deploy, mgu-inputgate, mgu-python, mgu-uplink, app-privacy.

**Crash handler.**
- CorruptAppsHandler keeps its counters in memory (`recoveryAttemptsSinceCorruption`); there is no file.
- `diagOapStartStopStatus.json` lists the last five crashes: all are x_call `MEMORY_LIMIT_REACHED`, in Aug 2026.
- **No crash record for f30_cluster.** Every exit in its logs is `exit code 0` after "shutdown requested by MainApp".

**Our app's data folder.**
- Files: `f30_cluster.log` (41 KB) + `.log.1` (262 KB), `settings.json`, `oap-sdk-analytics.json`.
- **No `perf.json`, no `car3k.json`.**
- Storage quota 10.8 MB.

**Settings.**
- `hudLayout off` and `byMode false`.
- In Comfort / Sport / Eco: `wb_comfort` / `wb_sport` / `wb_eco`.
- `ownRange`, `ownClock` and `ownTemp` are `bmw`; `modeLabel` is false; `gearTray` is gear.
- `nightDim auto`, `nightLook plain`, `baked` true, `stockMap` false, `wbFoot` hair, `dialShade` normal.
- `timeZone` is -9999.

**App log errors and warnings (both files), by kind.**
- Layer `waiting: display service not available` and `stalled` lines (≈ 400; they come from the resets).
- 31 + 31 analytics timeouts ("works as designed").
- 20 + 20 INVALID_MODELID (§0.5).
- 11 `Invalid distanceUnit`.
- 5 `CurrentVehicleUnits … subscribe of undefined` unhandled rejections inside the SDK, one per start (harmless so far).
- 1 `ERROR the SDK created no RHMI application` at 19:06:34, in the first 0.7.11 start right after the install. The second start, at 19:06:59, was normal.

**Other apps' logs** (copied; errors / warnings):
- ambient_config: 77 / 56;
- car_vitals: 93 / 79;
- draggy: 139 / 175;
- dtc_scanner: 71 / 40;
- live_adjustments: 67 / 64;
- penky_g20: 11 / 12.

There is no separate HUD app.

## 3. cluster-render

| Item | Value |
|---|---|
| Version | **0.5.12** since 19:07:16 (pid 31270), from the log header. Before: 0.5.9 from 2026-11-13 11:50, and 0.5.8 before that. The binary was not run. |
| Config | `current/cluster-render.conf` (0.5.12), with 0.5.9's copied for the diff. **No local conf** (`cluster-render.local.conf` absent). |
| Scene ids | panel 0x203 → **0x10004f8**, fallback 0x01000400 (configured). HUD 0x323 → 0x01000400. Map 0x100 → 0x10004f0. guide 0x103 → 0x10004f1. |
| HUD slot | never asked for by cluster-render. 0x1000400 was mapped in 0x323 at 15:03:01 by BMW's own HMI (a speech dialog), with no client of ours. |
| Panel frames (Nov 14, 79 one-minute windows) | 492 image-sheet frames in all, at most 0.33 frames/s in a window, 12 MB written, 0 failed, 2682 budget holds. Effect layers move by uniforms, which are not counted as frames. |
| Upload cap | 5500 KB/s (ceiling) |
| Errors and warnings (both files) | 21 + 21 map-target "accepted, not mapped for N ms" / "no answer" (waze map, 14:xx); 11 "display service went away"; 3 + 1 guard strikes, 3 guard E lines; 4 panel "accepted, not mapped"; 1 "no heartbeat reply". 6 E_FETCH_STATUS_FAILED on the first request after a reset. **No "too many layers" and no pixel-memory refusal.** "slot locked" shows only in our app's log, for 1–7 s at each wake-up (14:59, 16:07, 19:03), as before. |
| Renderer subscription | "not observable: no RAMSES subscription line read since start": RAMSES' DLT contexts are OFF |
| Debug or screenshot facility | **None.** No screenshot or dump key in the conf or the client. `<target>_scene_files` *loads* a scene and is not a dump. `cluster-render status` prints status.txt. **The panel is rendered by the KOMBI** from the RAMSES scene, so the head unit never holds the composed cluster frame. |
| status.txt | 5 samples between 19:16 and 19:30. All show the panel idle with 0x10004f8, Dcsm2 available, and only two 1×1 assets left (connections 1 and 2). |

**Frames:** none captured. The cluster image cannot be fetched read-only on the head unit (see the row above). `/run/logntrace/screenshots/{winston,transfer}` are empty.

## 4. SOME/IP

- Copied `/etc/oap/someip/someip-interfaces.json` (4.85 MB, 2023-08-18): 689 interfaces, 2984 fields and events, 7411 datatypes.
- Also copied our app's generated `someipInterfaces/acl.json`. There are no other definition files next to the catalogue.
- Ranked with `tools/signals/catalog.py --app apps/f30_cluster/app.json`. The output is `someip/car-signals.txt` / `.json`.

**app.json against the catalogue: every declared signal is "ok", all with instance 1.**
- `rs` (getter and notifier): CDS, CDS2, Vehicle2, FES ×4, KombiIF, Vehicle and TPMS.
- `s` (notifier only, no getter): VehicleInformation ×2, MDrive and EnvironmentalInformation.
- TASU: method plus broadcast.

**Drive mode.**
- **It does arrive.** `FES.statusFESVehicleDynamicSwitchHMI` delivered `COMFORT_PLUS` at 14:18:11, 14:32:23 and 19:07:04 (at subscribe). At ignition changes it sends `INITIALISIERUNG` / `SIGNAL_UNBEFUELLT`, which the app ignores as "not recognised" (6 times).
- No drive-mode change was made today, so whether changes arrive is still open.
- Other candidates:
  - `FesModeAvailability.fesModeAvailabilities` (rs; which modes are available, not which is on);
  - `Efficiencytainment.backchannelDrivingmodeDxp` (s);
  - `FES.statusFESDriveStrategy` / `statusFESDisplay` (rs).

**Speed limit, including "---".**
1. `de.bmw.dass…TrafficSignDisplayControl.displaySpeedLimitAndNoPassingRestriction` (s, instance 1). Members:
   - `displaySpeedLimit` UInt8;
   - `invalidFlag`;
   - `displaySymbolStyle` (ECE / …_UNSURE);
   - `displaySpeedLimitUnit` (KM_H, MPH, **NICHT_VERFUEGBAR**);
   - `displayNoPassingRestriction`;
   - `displaySpeedLimitWarning`.

   The "---" state is most likely `invalidFlag` or unit NICHT_VERFUEGBAR. This needs a raw-value log.
2. `FASuS.statusSLITextMessage` (rs).

**No overtaking:** the same struct's `displayNoPassingRestriction` (with a remaining distance); also `FASuS.statusNPITextMessage` and `statusOvertakeRecognition` (rs).

**MSA:**
- `CDS2.statusPushButtonMSA2` (rs): MSA_AKTIVIERT / DEAKTIVIERT;
- `Vehicle.statusMotorStartAuto` (s): `statusConditionMSA`, with engine stopped / passive / active states;
- `FES.statusFESDriveStrategy` (rs): `statusECOFunctionMSADrivingExperience`.

**Local time and time zone:**
- `KombiIF.timeDateUTC` (rs) and `KombiIF.statusTimeDate` (rs);
- `HMIContext.currentTimeZone` (rs, instance HMI_CID = 1);
- `HMIContext2.currentTimeZone` (rs, instance 1);
- TimeManager `timeZoneId` / `timezoneID` (rs). These have **instance Inst1 = 128**, and the kit subscribes instance 1, so the kit would need a change.

**Check-control message shown:** `KombiIF.statusActiveCCMessage` (rs), `Vehicle2.statusDisplayedCCMessage` (rs), and `KombiInterface_2.ccList` (rs).

**All signals.** The full flat table of every interface member (field, method or event; flags; instance; type; service id), grouped by topic, is `someip/all-signals.md` and `.tsv`, with counts in `someip/all-signals-summary.txt`. It stays git-ignored because it is BMW's catalogue.
- **Totals:** 5100 members (2319 fields, 2116 methods, 665 events).
- **Field flags:** rs 1244, rsw 360, rw 280, s 378, r 57.

The grouping is by keyword, so it is approximate:

| Topic | Interfaces | Members |
|---|---|---|
| cluster / kombi | 19 | 145 |
| driver assistance | 154 | 745 |
| navigation | 137 | 784 |
| vehicle dynamics | 49 | 261 |
| powertrain | 36 | 206 |
| climate | 10 | 179 |
| lights | 11 | 52 |
| body | 62 | 223 |
| HMI | 99 | 502 |
| diagnostics | 67 | 360 |
| other | 248 | 1643 |

**A read-only SOME/IP getter CLI on the unit:** none found. There is no someip-cli and no vsomeip_ctrl. `busctl` and `dbus-send` exist for D-Bus only. Nothing was called.

## 5. Errors, by count and kind

- **Journal, live window only** (19:23–19:25; it keeps about 4 min): 5004 `DLT ~1 messages discarded`, 14 systemd (HBNavigationOnOff notify from a non-main PID), 4 libschedconfig prctl intercepts.
- **Kept journal** (waze-on-cluster copy): the IPsec KOMBI tunnel deletes and re-adds listed in §0; the S3 suspend at 16:33 and resume at 19:03.
- **dmesg, err level** (1458 lines): almost all Broadcom Wi-Fi driver noise (1160 `wl_run_escan`, then AP/station and p2p setup errors). Nothing GPU- or display-related.
- **systemd:** `var-opt-ro.service` failed, so the system is degraded.
- **Our app and cluster-render:** see §2 and §3.

## 6. Performance (60 s probe at 19:25 with the theme off, plus a 30 s per-process sample)

- **Whole unit:** 38.8 % of all 4 cores (about 1.55 cores busy) with **our cluster off**.
- **Our app** (pid 30919): 3.0 % of one core, RSS 143 MB, 16 threads. Its cgroup (all foreground OAP apps) used 13.4 % of a core, with no throttling.
- **cluster-render:** about 0.65 % of one core averaged since 19:07 (7.8 s of CPU). It is idle now.
- **No loop MAIN or perf lines:** there is no `perf.json`, and the probe's page-loop grep found none in 0.7.11's log.
- **CPU hogs** (% of one core over 31.6 s):

| Process | % of one core |
|---|---|
| AlsaRoutingAdapters | 16.0 |
| avb_streamhandler | 14.1 |
| vsomeipd | 9.9 |
| HmiMain3D | 9.2 |
| SignalGateway | 6.6 |
| NavigationPosition | 5.8 |
| HmiDisplayClusterScenes | 5.7 |
| ipcServer | 5.5 |
| systemd-journald | 5.2 |
| oap-cdc-2018 node | 4.8 |
| gnssd | 4.7 |
| carplay | 4.5 |
| usbpowerd | 3.7 |
| waze-on-cluster | 3.5 |

- **Probe bug:** `scripts/perf_probe.sh` never finds cluster-render 0.5.x. Its `comm` is `cluster-render-` (cluster-render-idrive7, cut to 15 characters), and the script compares it to `cluster-render`. It should match `cluster-render*`.

## 7. Our app's state (2026-11-14 19:13 onward)

- **Version:** 0.7.11, as expected.
- **Layout:** none. `hudLayout off` gives `off: nothing drawn, BMW's own cluster shows`.
  - Before that: 6WB Dials + G20 (theme 6WB Comfort, night colours plain), G20 Comfort, then F30 at 19:13:18 for 2 s.
- **Status:** no status-line text is logged. The last screen was GALLERY, then back (19:13:24).
- **Own row:** `range BMW's, clock BMW's, temp BMW's; mode label off`.
- **Drive mode:** arrived (COMFORT_PLUS) at 19:07:04; see §4.

## 8. Writes that would give more (owner's OK needed; none were run)

| Purpose | Command |
|---|---|
| Opt-in perf log (loop MAIN, perf lines) | `ssh root@<car> 'echo "{ \"log\": true }" > /var/opt/public/oap/oap_12211/data/perf.json'`. Off: `ssh root@<car> 'rm /var/opt/public/oap/oap_12211/data/perf.json'` |
| Package K slot test | `ssh root@<car> 'echo "{\"slot\":\"keep\"}" > /var/opt/public/oap/oap_12211/data/car3k.json'` (or `reseat`). Off: `rm` the same file. Not useful until the KOMBI reset is fixed. |
| KOMBI / RAMSES renderer messages | Live DLT, read as a client (it connects to dlt-daemon; it should send no control request, but this is unverified, so it is listed here): `ssh root@<car> 'timeout 30 dlt-receive -a localhost' > dlt.txt` while a 6WB layout is mapped. Raising the RAMSES contexts' level (`dlt-control`) is a real write and can upset dlt-daemon (waze-on-cluster's notes); only with care. |
| Centre-screen picture | `ssh root@<car> 'ivi-screenshot-control --screens'`, then `--screenshot <model> -f /tmp/cid.png`, then `cat` it back and `rm`. This writes /tmp. **It cannot show the cluster** (the KOMBI renders it). |
| Restart cluster-render (clears a fallback) | `ssh root@<car> 'systemctl restart cluster-render'`. Not needed now: 0.5.12 is on 0x10004f8. |
| guard-reset | Not applicable to 0.5.12 (no guard). For 0.5.9: `ssh root@<car> '/var/opt/cluster-render/current/cluster-render guard-reset'`. |

## 9. Files (`reference/car/2026-11-15/`, git-ignored)

| Folder | Size | What |
|---|---|---|
| `system/` | 224 KB | os-release / versions, uptime, cpuinfo, meminfo, mounts, df, timezone, systemd units / failed / timers, net, modules, interrupts, vmstat, thermal, gpu, cgroups |
| `processes/` | 104 KB | proc table with cmdline, uid, RSS, threads, CPU ticks and cgroups; busybox `ps`; 6 `top` snapshots over 30 s |
| `oap/` | 424 KB | app survey, f30_cluster logs (both), settings, dirs, installed uiDescription, MainApp state (install / crash / provisioning), updater origins |
| `cluster-render/` | 840 KB | log + log.1, conf 0.5.12 and 0.5.9, component.json, client 0.5.12, status.txt samples |
| `someip/` | 13 MB | catalogue, app ACL, catalog.py report (txt / json), all-signals md / tsv / summary |
| `logs/` | 4.5 MB | dmesg (+ errors), live journal tail and warnings, waze-on-cluster journal copies (5), waze-on-cluster log, other apps' logs |
| `perf/` | 72 KB | perf_probe summary + raw, per-process CPU 30 s + cgroups |
| `frames/` | 0 | none obtainable read-only (§3) |
