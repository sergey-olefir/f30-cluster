# Driver Profiles 0.1.0: a driver-profile manager for the MGU

Branch `app/profiles`, 2026-11-15. A new, separate OAP app, `apps/driver_profiles` (title "Driver Profiles",
`loggingId` `OADP`), for this BMW G20 (MGU, iDrive 7, rooted).

**Status:** built and tested on the bench only. Nothing of it has run on the car.

The car was used only for read-only research (`ls`, `cat`, `grep`, `strings`), and the owner then disconnected it:
- **Done on the car before that:** the iteriodev_ambient manifest and ACL (section 3), and the speller search (section
  4).
- **Not done, and marked below as "needs car verification, car was offline":** the file permissions of the
  personal space (section 5), and everything in section 6.

Background: `docs/OFFLINE-USER-REPORT.md` (the profile services, how the two local profiles were made, and how they were
named and given Guest's data from a root script). That report is not in git, and neither is its raw data
(`reference/car/2026-11-15/profiles/`).

## 1. What the app does

| Screen | What it shows / does |
|---|---|
| **MAIN** "Driver Profiles" | `STATUS`: the active profile, and how many of the 7 personal slots are used and free. One row per slot that exists (guest, valet, i01..i07). The first line of a row is the name, with "(active)" on the active profile. The second line is the type (Personal / Guest / Valet / Fleet), local or BMW ID, and the protection (none / key / PIN / NFC / Digital Key). Free slots are hidden. Below the rows: **Add a local profile (N free)**, **Active profile: what the car shows**, **Read the profiles again**, and `MSG` (the last result). |
| **PROFILE** | Name; status (active or not); type; account (local, or BMW ID with the user name masked: `d***@example.com`); protection; **PIA profile number**; **when Guest's settings were copied** (`getCopyGuestTimestamp`); created; last login; first name; cloud sync; avatar; slot and persod's internal id. Then **Rename**, **Copy Guest's settings here**, **Delete this profile**. When one of these can't run, it says why, and a press only explains. |
| **NAMES** | The preset names (`app.json` `config.names`, up to 10), marked "(in use)" when a profile already has that name, plus "Profile N" with the first free N, and Cancel. Used by both Add and Rename. |
| **CONFIRM** | What will be sent, what it does, the checks as they are now, **Yes** / **Cancel**. Delete needs Yes **twice**: the first press only arms it for `config.deleteArmSeconds` (10 s), and leaving the screen disarms it. Afterwards: the result code ("Result: SUCCESS (code 0)", "MAX_NUM_EXCEEDED (code 1)", "IS_PROTECTED_ACCOUNT (code 2)", "Not sent: …", "Error: …") and what a fresh read shows. |
| **SETTINGS_VIEW** | Read only: the active profile, the active PIA number, which key maps to which PIA number, the PIA numbers seen per profile, the active profile's units, the car state for changes, and three lines on what can't be shown (section 5). |

### The only writes, and their safety

| Action | Call | Offered only when (checked on screen, then **read and checked again right before sending**) |
|---|---|---|
| Add | `UserAccountManager.createUserAccount(name)` (0xFC02, method 21845) | a free slot exists, and no profile has that name yet |
| Rename | `UserAccount.<slot>.name` setter (0xFC03, setter 5): the call the owner's two names were set with | a personal (USER), local profile; the slot still holds the same profile (id and name) the confirm screen showed |
| Copy Guest's settings | `UserAccountManager.copyGuestData(ref)` (method 21851) | Guest is the active profile; the target is a personal profile with protection `[]` (no key, PIN or NFC) |
| Delete | `UserAccountManager.removeUserAccount(ref)` (method 21846) | never guest, valet or the active profile; only a local personal profile; the slot still holds the same profile; two presses |
| all four | | engine off (CDS `statusEngineSpeed2` raw 0), gear P (VehicleInformation `DataPowerTrain2`), no PIA job open (`Pia.PIATransaction`), no other change running. `config.requireParked: false` turns this check off. |

- **Nothing else is called.** That means no UDS, no `DELETE_ACCOUNTS`, no PIA reset, no `copyPiaProfile`, no login, and
  no `createAssociatedUserAccount` (BMW ID). The manifest grants only these four. The ACL that BMW's own generator
  makes from it (section 3) lets through methods 21845, 21846 and 21851 on 0xFC02, and setter 5 on 0xFC03, and no
  other write.
- **Guarded handlers.** Every handler runs inside `guard()`. A failed or timed-out call shows as "Error: …" and never
  ends the app. `main.js` starts everything in a `try`, and the SOME/IP start runs after `start()` returns.
- **Privacy.** Names and e-mail addresses never go to the log: only slots, result codes and errors. The bench test
  checks this. The preset names default to "Driver 1" … "Driver 4".
- **My additions beyond the brief (owner, please confirm):**
  - Rename and Delete are not offered for a **BMW ID** profile. Its name comes from the BMW ID, and deleting it
    makes persod unlink the BMW ID from the car in the backend.
  - The **engine-off / P / no PIA job** gate is on every write. pomd cancels PIA jobs on engine start, and the
    owner-approved copy on 2026-11-14 checked the same things.

## 2. What works on the bench

`node bench/test-driver-profiles.js` (port 8131): **57 passed, 0 failed**. `node bench/test-native-ui.js` (f30_cluster,
port 8132) still passes **42 / 42** after the kit and bench changes.

The bench has a fake persod (`bench/fake-personalization.js`). It is wired in through the emulator's new `hu.fakes` hook,
and the app talks to it through the same `signals.proxy / get / set / call / on` calls it uses on the car. It starts with
Guest active, a Valet and two local profiles.

The test checks:
- the list: rows, "(active)", free slots hidden, STATUS;
- a profile's details;
- Guest: no Delete, Rename or Copy, and a press sends nothing;
- Add through NAMES and CONFIRM: SUCCESS, the new row, the MSG line;
- a name in use is refused;
- Rename to "Profile 1";
- Copy: SUCCESS (code 1), and the copy time shows;
- Copy refused for a protected target, and while Guest is not active (the active profile follows
  `currentUserOnChange`);
- no Delete for the active profile;
- the PIA number shows while a profile is active, and is remembered after;
- Delete: the first press arms only; leaving the screen disarms; two presses delete;
- the engine running, and a gear other than P, block a write, and nothing is sent;
- `MAX_NUM_EXCEEDED` with its explanation;
- a BMW ID profile: masked account, no Rename or Delete;
- a call that fails shows "Error: …";
- odd input;
- **only the four allowed writes were ever sent, one per confirmed Yes**;
- the app never exited;
- no names in the app log.

Other checks:
- **Syntax.** Every app file and `kit/runtime/signals.js` parse as ECMAScript 2017 (acorn), which Node 8.16
  supports. No Node 8 binary is on this Mac, so the bench ran the app on Node 22.
- **Build.** `python3 kit/tools/build.py driver_profiles` builds 5 screens (states MAIN 1, PROFILE 19, NAMES 41,
  CONFIRM 58, SETTINGS_VIEW 69).

To run it yourself:

```sh
BENCH_PORT=8130 node bench/server.js driver_profiles     # then POST /click {id}, POST /fake {...}, GET /probe
node bench/test-driver-profiles.js                       # the scripted test (port 8131)
```

## 3. How the permissions are declared (and the kit)

- **iteriodev_ambient** (oap_12208, read on the car) declares, in `source/manifest.json`:
  `"de.bmw.infotainment.personalization.UserAccountManager": "*"` (and `SessionManager: "*"`).
  - MainApp's generator turns "*" into every member of the interface.
  - Its `someipInterfaces/acl.json` then has, for 0xFC02 (64514): getters 1 and 2, **methods 21845..21851**, and
    events 32769 and 32783.
  - That grants the BMW ID creation methods too.
- **Our kit could already express this, more narrowly.** No build change was needed.
  - `app.json` `signals` →
    `"…UserAccountManager": { "_instances": "…UserAccountManager", "_methods": ["createUserAccount", "removeUserAccount", "copyGuestData"] }`.
  - `"…UserAccount": { "_instances": "*", "name": "rws", … }`. The `w` flag makes the installer keep the setter.
  - `build.py` `manifest_for()` writes these as the manifest's `instances` / `methods` / `attributes`.
- **Checked with the firmware's own generator on the Mac.** I ran
  `kit/tools/oapgen/gen.js <the car's someip-interfaces.json> dist/driver_profiles/source/manifest.json`, with
  MainApp's `AppManagement.js`, which I copied read-only from the car into the session scratchpad. It is not in git.
  It generated 31 interface configs. The ACL entries:
  ```
  0xFC02 UserAccountManager  inst 64514         methods 21845, 21846, 21851            (nothing else)
  0xFC03 UserAccount         inst 64515..64523  getters 1 4 13 16 19 22 28 31 34 40 43 46, setter 5, notifiers
  0xFC05 UserAccountIntra    inst 64531..64539  method 1 (getCopyGuestTimestamp)
  0xFC01 SessionManager      inst 64513         1, 21845, 32769, 32770   (the platform's "*", as every kit app has)
  0x100B DriverSelectionModule inst 1           getters 8, 9 and their notifiers
  ```
  - The instance names are `…UserAccountManager.guest`, `.valet` and `.i01`..`.i07`, as the root scripts used.
  - One generator warning: `Pia.PIATransaction` got a made-up default (`__UNDEFINED_DEFAULT_VALUE__` = 3). That is
    what makes the generated config load, where the hand-written one in `copyguest.js` failed at first.
- **Kit changes (small and general):**
  - `kit/runtime/signals.js`: `get(proxy, field, ms)`, a field's getter once, serialised like every other native
    call.
  - `kit/tools/hu-stub.js`: `hu.fakes[iface] = (instance) => proxy`, so a bench can stand in for any SOME/IP
    provider.

## 4. The speller (on-screen keyboard): not reachable from an RHMI app

What I looked at, all read-only on the car:

- **The OAP SDK's RHMI component table** (`node_modules/oap-sdk/index.js` in an installed app, `const types={…}`):
  state, overlay, player, icPopUp, icState, hudState, hudPopUp, hudMidPopUp, popUp, preview, previewMap, toolBar,
  button, label, checkBox, radioButton, title, toolBarButton, toolBarCheckBox, image, valueList, slider, progressBar,
  dropDownMenu, timeRoll, dateRoll, **editRoll**, separator, bookmark, startWidget, selectionBar,
  selectionBarButton, selectionBarCheckBox.
  - There is **no input, speller or keyboard type**.
  - An unknown type gets "access to unimplemented RhmiType … Returning null".
  - `editRoll` is a roll picker. Its rows are fixed, and it reports `SelectedItem` on Confirm. It is not text entry.
- **The HMI's RHMI side** (`strings /usr/bin/HmiMain3D`): the RHMI component classes are Simple, Bookmark, Options,
  PreviewMap, ProgressBar, Slider, ToolBar and ValueList, plus state, popup, IC and HUD activities. **None is a
  speller.**
- **The HMI does have spellers.** `mappings.pbm` has `LT_Speller_Regular`, `LT_Button_MatrixSpeller_Key`,
  `LT_Label_Speller_6Row_1TextDyn`, `LT_DrawArea_Speller_Controller` and more. These are templates of BMW's own
  native screens (navigation, phone), not RHMI widgets.
- **BMW's installed OAP apps** use no input widget. Across their `application.xml` files the component types are
  button, label, dropDownMenu, checkBox, state, title, popUp, preview, overlay, separator, progressBar, slider,
  bookmark and logical.
- **The SOME/IP catalogue** has no general text-input service. The only speller fields belong to navigation's
  destination input and media metadata. `hmi.inputrelay.InputRelay` relays controller input, not text.

**What a speller would need:** either the HMI's RHMI parser accepting an input component (it does not, by the
strings above), or a SOME/IP use case that opens BMW's speller and returns the text (none found). Two things could be
tried on the car later, both risky and not done:
- an `editRoll` per character (a slow letter roll, unverified rendering);
- putting the ID4–6 Connected-Drive RHMI `input` component into `application.xml` and watching the HMI's log.

**So 0.1.0 uses the preset list.** The owner edits `config.names` in `apps/driver_profiles/app.json` (up to 10
names; non-ASCII works, through the kit's dynamic string slots) and reinstalls. "Profile N" is always offered.

## 5. Per-profile settings: what an app can and cannot read

| Source | Readable by our app? | Shown |
|---|---|---|
| persod's account fields (UserAccount getters: name, type, gcid, protection, firstName, creationDate, lastLoginDate, synchronizationEnabled, connectedDriveUsername, emailAddress, avatarType) | yes, for every slot (granted in the manifest) | PROFILE |
| when Guest's data was copied (`UserAccountIntra.getCopyGuestTimestamp`, 0xFC05 method 1) | granted; **unverified** that persod answers an app (an "Intra" service) | PROFILE, else "Not readable (…)" |
| the active PIA number (`DriverSelectionModule.piaProfileId`), the key → PIA map (`BdcIdentityMappingTable`) | yes (getters + notifiers) | SETTINGS_VIEW |
| **a profile's PIA number** | persod keeps it in its own store (`piaProfileId` in `kvsdb-default`, owner `sps_8000`); no SOME/IP field has it | Guest is 10 by definition. For the active profile it is `piaProfileId`. The app remembers that number per persod id (`data/pia-seen.json`) and shows it afterwards as "seen while it was active". |
| the active profile's units (`Vehicle.statusNewCurrentUnitsStatusExt`) | yes (a platform grant) | SETTINGS_VIEW |
| the vehicle settings themselves (seats, mirrors, lights, climate, driving mode): PIA functions in each ECU, per PIA number | **no.** They are reached by `PiaClientService.getValue(profileId, piaId)` (0x1501, a method on the ECUs' PIA clients) or by pomd over `Pia`/`PIAInternal`. These are raw per-function bytes whose ids and meanings are ECU-specific. Calling them was out of scope, and an app writing to them would be dangerous. | not shown |
| the iDrive side (main menu, navigation favourites, media, speech, display): `/var/opt/personal/<id>/…` | **no, by all evidence.** It is ecryptfs, with per-service groups (`hmi/hmi_5000`, `nav/nav_navi`, `sps/sps_8000`…, from `OFFLINE-USER-REPORT.md` §2.3 and `personal-space-layout.txt`), and an OAP app runs as its own uid. **The owner and mode of each folder: needs car verification, car was offline** (the `ls -ld` was not done). | not shown |
| pomd's per-user mirror of PIA values (`sps/sps_8002/kvs/kvsdb-default` in the personal space) | **no, by the same evidence** (service group `sps_8002`, personal space). Permissions need car verification. | not shown |
| other "settings" services (driver assistance, map, climate) | They exist, but they describe the **active** user only, many have no getter (`SettingsDriverAssistanceFunctions` getters are id 0), and each needs its own manifest grant. Left out of 0.1.0. | not shown |

**In short:**
- An app can read every profile's account record.
- For settings, it can read only what the active profile shows to every app, such as units.
- It cannot read an inactive profile's settings: the vehicle side lives in the ECUs, and the iDrive side is
  encrypted per service uid.
- SETTINGS_VIEW says this in its three note rows.

## 6. Unverified on the car (the owner's checks; all need car verification, car was offline)

1. **The install.** The Store builds the app from this branch. The manifest asks for 0xFC02 methods, the 0xFC03
   setter, and the optional 0xFC05, 0x100B, CDS, VehicleInformation and Pia. If the install refuses something, its log
   names the field.
2. **Reading.** MAIN should list Guest (active), Valet and the two local profiles with the right names, as "Personal,
   local, protection: none" (or "key" once a key is linked).
   - Free slots should be hidden. Hiding rows (`Visible`) is unverified on this car. If they show, they read
     "Slot N: free".
   - It is unknown whether persod offers the UserAccount instances of free slots. If it does with an empty `id`, they
     are treated as free. If it doesn't, the first read waits 2.5 s for them.
   - If MAIN says "The profile service does not answer", take `oap_*/data/driver_profiles.log`.
3. **PROFILE.** Check:
   - the dates (created, last login: unix seconds assumed);
   - "Guest's settings copied" for both profiles. They were copied on 2026-11-14 at about 20:47 and 20:48 UTC. If
     it reads "Not readable", the Intra service refuses apps.
   - the PIA number of the active profile.
4. **Hypothesis: `createUserAccount` from an app.** This is the first real test, and it creates a profile:
   - Add → pick a name → Yes, with the engine off, in P.
   - Expect "Result: SUCCESS (code 0)" and a new slot i03.
   - `MAX_NUM_EXCEEDED` means the provisioned limit is reached. Then nothing was created.
   - Delete the test profile afterwards with the app (two presses), or in BMW's menu.
5. **Rename** a local profile (the setter that worked from root). Expect "name set".
6. **Copy Guest's settings** is offered only with Guest active and an unprotected target. With a key linked it must
   say "it is protected (key)". Running it again on i01 or i02 would overwrite their settings with Guest's current
   ones, so **only test it on a new test profile**.
7. **Delete:**
   - must not be offered for Guest, Valet or the active profile;
   - the first Yes only arms it;
   - expect "Result: SUCCESS (code 0)".
   - `IS_PROTECTED_ACCOUNT` (code 2) would mean persod refuses key-bound profiles. That is a guess from the enum.
8. **`currentUserOnChange`** (a "selective" event) may not reach the app. Then "(active)" updates only on Read
   again, on reopening MAIN, and after each write.

## 7. Install and test

1. The Store builds it like f30_cluster: `mgu-repo.json` already covers `apps/*`. Install "Driver Profiles" from the
   branch.
2. Before any write: ignition on, engine off, P, battery charger connected. No other diagnostic or profile job may
   run, and no other agent may be working on the car.
3. Order: read-only first (steps 2–3 of section 6), then Add → Rename → Copy → Delete on **one test profile**.
4. If anything misbehaves: **do not kill the app** (the crash handler uninstalls it on the second crash). Leave the
   screen, or restart the platform with `systemctl restart oapcontroller`.
   - Logs: `/var/opt/public/oap/oap_<uid>/data/driver_profiles.log`.
   - Uninstall from the Store.
5. To change the names: edit `config.names` (and `autoName`) in `apps/driver_profiles/app.json`, then reinstall.

## 8. Files

- `apps/driver_profiles/`:
  - `app.json` (screens, signals, config);
  - `main.js`;
  - `profiles.js` (SOME/IP, checks, writes);
  - `screens.js` (native screens);
  - `format.js` (enums, texts).
- `kit/runtime/signals.js` (`get`), `kit/tools/hu-stub.js` (`hu.fakes`).
- `bench/fake-personalization.js` (new), `bench/test-driver-profiles.js` (new), `bench/run-app.js` and
  `bench/server.js` (`POST /fake`, `perso` in `/probe`), `bench/README.md`.
