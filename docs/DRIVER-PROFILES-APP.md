# Driver Profiles 0.2.0: a driver-profile manager for the MGU

Branches `app/profiles` (0.1.0) and `app/profiles-avatar` (0.2.0, the avatar), 2026-11-15. A separate OAP app,
`apps/driver_profiles` (title "Driver Profiles", `loggingId` `OADP`), for this BMW G20 (MGU, iDrive 7, rooted).

**Status:** built and tested on the bench only. Nothing of it has run on the car.

**0.2.0 adds the avatar**: the type a profile has now, the car's own 15 avatars, six pictures that ship with the app
(two pictures at three sizes each, at the owner's own request — present in the branch but not committed, see the note
at the head of section 9), and the owner's own jpg from a folder in the app's data directory. See **section 9**, which also says plainly what is proven and what is not, and
gives the owner a numbered test. The car was offline for all of 0.2.0: no SSH, no UDS, no service call was made.

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
| **PROFILE** | Name; status (active or not); type; account (local, or BMW ID with the user name masked: `d***@example.com`); protection; **PIA profile number**; **when Guest's settings were copied** (`getCopyGuestTimestamp`); created; last login; first name; cloud sync; **avatar** (the type by name, and for `INDIVIDUAL` that a custom picture is set and how large it is); slot and persod's internal id. Then **Rename**, **Avatar**, **Copy Guest's settings here**, **Delete this profile**. When one of these can't run, it says why, and a press only explains. |
| **NAMES** | The preset names (`app.json` `config.names`, up to 10), marked "(in use)" when a profile already has that name, plus "Profile N" with the first free N, and Cancel. Used by both Add and Rename. |
| **AVATAR** (0.2.0) | What is set now, then **Default**, the car's **15 built-in avatars** by number ("Avatar 1" … "Avatar 15"; we cannot draw BMW's own thumbnails, see section 9), then the **six pictures that ship with the app** (two pictures at 128, 256 and 512 px) with their sizes, then the owner's own `.jpg` files from `<dataDir>/avatars/`, each with its size in KB. An empty or missing folder is normal: the screen then says what to do and prints **the folder's full path**. Also **Read the folder again**, a note with the size limit and its standing, and Cancel. |
| **CONFIRM** | What will be sent, what it does, the checks as they are now, **Yes** / **Cancel**. Delete needs Yes **twice**: the first press only arms it for `config.deleteArmSeconds` (10 s), and leaving the screen disarms it. Afterwards: the result code ("Result: SUCCESS (code 0)", "MAX_NUM_EXCEEDED (code 1)", "IS_PROTECTED_ACCOUNT (code 2)", "Not sent: …", "Error: …") and what a fresh read shows. |
| **SETTINGS_VIEW** | Read only: the active profile, the active PIA number, which key maps to which PIA number, the PIA numbers seen per profile, the active profile's units, the car state for changes, and three lines on what can't be shown (section 5). |

### The only writes, and their safety

| Action | Call | Offered only when (checked on screen, then **read and checked again right before sending**) |
|---|---|---|
| Add | `UserAccountManager.createUserAccount(name)` (0xFC02, method 21845) | a free slot exists, and no profile has that name yet |
| Rename | `UserAccount.<slot>.name` setter (0xFC03, setter 5): the call the owner's two names were set with | a personal (USER), local profile; the slot still holds the same profile (id and name) the confirm screen showed |
| Avatar: a preset (0.2.0) | `UserAccount.<slot>.avatarType` setter (0xFC03, **setter 29**) | the slot still holds the same profile; the choice is one of `DEFAULT`, `AVATAR1`…`AVATAR15`. **One field, nothing else** |
| Avatar: a picture (0.2.0) | `UserAccount.<slot>.avatar` setter (0xFC03, **setter 8**) with the Base64 jpg, **then** `avatarType = INDIVIDUAL` (setter 29) | the picture is still there (one of the app's own six, or a file in `<dataDir>/avatars/`), is a jpg and is at most `config.avatarMaxKB` (48 KB). If the picture is refused, `avatarType` is **not** written |
| Copy Guest's settings | `UserAccountManager.copyGuestData(ref)` (method 21851) | Guest is the active profile; the target is a personal profile with protection `[]` (no key, PIN or NFC) |
| Delete | `UserAccountManager.removeUserAccount(ref)` (method 21846) | never guest, valet or the active profile; only a local personal profile; the slot still holds the same profile; two presses |
| all of them | | engine off (CDS `statusEngineSpeed2` raw 0), gear P (VehicleInformation `DataPowerTrain2`), no PIA job open (`Pia.PIATransaction`), no other change running. `config.requireParked: false` turns this check off. |

- **Nothing else is called.** That means no UDS, no `DELETE_ACCOUNTS`, no PIA reset, no `copyPiaProfile`, no login, and
  no `createAssociatedUserAccount` (BMW ID). The manifest grants only these. The ACL that BMW's own generator
  makes from it (section 3) lets through methods 21845, 21846 and 21851 on 0xFC02, and setters 5, 8 and 29 on 0xFC03,
  and no other write.
- **Guarded handlers.** Every handler runs inside `guard()`. A failed or timed-out call shows as "Error: …" and never
  ends the app. `main.js` starts everything in a `try`, and the SOME/IP start runs after `start()` returns.
- **Privacy.** Names and e-mail addresses never go to the log: only slots, result codes and errors. From 0.2.0 the
  avatar picture and the name of the file it came from are not logged either: the log says "own picture #2, 3072
  bytes of jpg" and nothing more. A read turns the picture into a size and drops it. The bench test checks all of
  this. The preset names default to "Driver 1" … "Driver 4".
- **My additions beyond the brief (owner, please confirm):**
  - Rename and Delete are not offered for a **BMW ID** profile. Its name comes from the BMW ID, and deleting it
    makes persod unlink the BMW ID from the car in the backend.
  - The **engine-off / P / no PIA job** gate is on every write. pomd cancels PIA jobs on engine start, and the
    owner-approved copy on 2026-11-14 checked the same things.

## 2. What works on the bench

`node bench/test-driver-profiles.js` (port **8170**): **116 passed, 0 failed** — the 57 checks of 0.1.0 and 59 more
for the avatar (section 9.4; 104 when the bundled-pictures folder is empty, which skips 12 of them). `node bench/test-native-ui.js` (f30_cluster, port 8132) passed **42 / 42** at 0.1.0;
0.2.0 touches nothing it covers (only `apps/driver_profiles/`, the fake persod and this test), so it was not run
again.

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

and, from 0.2.0, everything in section 9.4.

Other checks:
- **Syntax.** Every app file (including the new `avatars.js`) and `kit/runtime/signals.js` parse as ECMAScript 2017
  (acorn), which Node 8.16 supports. No Node 8 binary is on this Mac, so the bench ran the app on Node 22.
- **Build.** `python3 kit/tools/build.py driver_profiles` builds **6** screens (states MAIN 1, PROFILE 19, NAMES 42,
  **AVATAR 59**, CONFIRM 99, SETTINGS_VIEW 110) and packs `avatars/` into `avatars.pack` (110 KB; jpgs do not
  compress). The package is 943 KiB.

To run it yourself:

```sh
BENCH_PORT=8130 node bench/server.js driver_profiles     # then POST /click {id}, POST /fake {...}, GET /probe
node bench/test-driver-profiles.js                       # the scripted test (port 8170)
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
  - **Run again for 0.2.0** (2026-11-15, on this Mac, with the same copied `AppManagement.js` and the same catalogue
    dump; no car involved). The only change anywhere in the ACL is on 0xFC03, which now reads
    `1 4 5 7 8 13 16 19 22 28 29 31 34 40 43 46` plus the notifiers — that is the two new setters, **8** (`avatar`)
    and **29** (`avatarType`), and getter **7** (`avatar`). 0xFC02 is untouched: still only 21845, 21846, 21851.
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
| persod's account fields (UserAccount getters: name, type, gcid, protection, firstName, creationDate, lastLoginDate, synchronizationEnabled, connectedDriveUsername, emailAddress, avatarType, and from 0.2.0 avatar) | yes, for every slot (granted in the manifest) | PROFILE (the picture only as its size) |
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
3. Order: read-only first (steps 2–3 of section 6), then Add → Rename → Copy → Delete on **one test profile**. The
   avatar has its own numbered test in section 9.5, and can be done on any profile.
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
  - `format.js` (enums, texts);
  - `avatars.js` (0.2.0: the avatar types, the two folders the app reads, the size guard and the Base64 encoding);
  - `avatars/` (0.2.0: the six bundled pictures, **at the owner's own request**; the build packs the folder into
    `avatars.pack` next to the code). **Present in this branch's working tree but not committed** — see the note at
    the head of section 9.
- `kit/runtime/signals.js` (`get`), `kit/tools/hu-stub.js` (`hu.fakes`).
- `bench/fake-personalization.js` (0.2.0: the `avatar` and `avatarType` setters, their notifiers and the
  rejections), `bench/test-driver-profiles.js`, `bench/run-app.js` and `bench/server.js` (`POST /fake`, `perso` in
  `/probe`), `bench/README.md`.
- 0.2.0 changed only `apps/driver_profiles/`, `bench/fake-personalization.js`, `bench/test-driver-profiles.js` and
  this document.

## 9. The avatar (0.2.0)

Branch `app/profiles-avatar`. **The car was offline throughout**: no SSH, no UDS, no SOME/IP call. Everything below is
either read off the dumps in `reference/car/2026-11-15/` (git-ignored) or run on the Mac bench.

> **The six bundled pictures are not committed.** They sit in `apps/driver_profiles/avatars/` in this branch's
> working tree, and everything that reads them is committed and tested, but the commit of the image files themselves
> was refused by this session's permission layer — they are photographs of named people going into a public
> repository, which is a decision only the owner can make directly, not something an agent should carry out on a
> relayed approval. **For the owner / coordinator:** if you want them in, commit that one directory yourself
> (`git add apps/driver_profiles/avatars && git commit`). Nothing else waits on it: the app, the bench and the data
> folder mechanism all work with the folder empty, and the test skips the bundled checks then (104 of 116 instead of
> 116). Those six files are the only thing from `reference/` that was copied into the app at all, and nothing from
> `reference/` is in any commit.

### 9.1 Proven: the fields, their ids and their setters

All of this is read straight out of the unit's own catalogue,
`reference/car/2026-11-15/profiles/someip-personalization.txt` (dumped from `/etc/oap/someip/someip-interfaces.json`),
and persod's own store schema, `.../persod-store-redacted.txt`:

| | |
|---|---|
| Service | `de.bmw.infotainment.personalization.UserAccount`, **0xFC03** (64515), v1.12 |
| Instances | `…UserAccountManager.guest` **0xFC03**, `.valet` **0xFC04**, `.i01`…`.i07` **0xFC05…0xFC0B** (64517…64523) |
| `avatar` | `Utf8D`. **get 7, set 8**, notifier 32770 |
| `avatarType` | `enumAvatarType`. **get 28, set 29**, notifier 32775. `DEFAULT=0`, `AVATAR1`…`AVATAR15` = 1…15, **`INDIVIDUAL=16`**, `UNSPECIFIED=17` |
| What the picture is | persod's account schema (`/usr/share/persistency.d/sps/sps_8000/perso_user_2.0.json`) calls the backing value **`avatarData`**: *"The individual avatar picture (Base64-encoded jpg)"*. Its `avatarType` description lists the same 18 values. Both are marked `sync: true` |

So a custom avatar is `avatarType = INDIVIDUAL` plus the jpg, Base64-encoded, in `avatar`. Every id above was checked
against the catalogue, not taken from a brief.

Also proven, on the Mac: **the app is allowed to ask for those two setters.** BMW's own ACL generator
(`kit/tools/oapgen/gen.js` with MainApp's `AppManagement.js`, section 3) was run again on 0.2.0's manifest. The only
difference from 0.1.0's ACL anywhere is on 0xFC03, which gains getter 7 and setters 8 and 29. 0xFC02 still grants only
21845, 21846 and 21851. Whether the **installer on the car** then accepts that ACL is a separate question (step 1 of
the test below).

### 9.2 Designed, but unproven — the three unknowns

1. **What size and pixel dimensions persod accepts.** Nothing in the dumps says. BMW's own path is the My BMW app,
   which uploads a small thumbnail; the HMI draws the avatar as a small round picture, so the real pictures are
   probably a few KB. **Our guess: 48 KB of jpg**, `config.avatarMaxKB` in `app.json`.
   - *Why 48:* 48 KB of file is exactly 64 KiB of Base64, which is the string the setter is handed. 64 KiB is a size
     any sane message transport takes in one piece, and it is far above a thumbnail's needs (a 200×200 jpg is about
     10–15 KB, a 512×512 one about 25–45 KB) while far below a phone photo (2–5 MB), which must be refused rather
     than pushed at persod. The number is a **guess until the car proves otherwise**, and the app says so on screen.
   - The guard runs on `lstat` **before the file is opened**, so an oversize photo never reaches memory, let alone
     the binding. The screen shows the limit, the row of an oversize file says how big it is and that it is over the
     limit, and pressing it refuses with the reason instead of sending.
   - Raising it is one number in `app.json` (clamped to 1…512 KB) plus a reinstall. Lowering it is how to make the
     app offer only the small bundled sizes.
2. **Whether persod validates the data.** Unknown. It may store any string, or it may check that it decodes, that it
   is a jpg, or that it is within some size. The app does the two checks it can do cheaply itself — the Base64 is its
   own, and the first bytes must be a JPEG header (`FF D8 FF`) — and then **shows whatever the car answers,
   verbatim**. A refusal is reported as "Result: the car refused the picture: &lt;what it said&gt;", and `avatarType`
   is then **not** written, so a refusal changes nothing at all.
3. **Whether this car's HMI draws a custom avatar.** Unknown, and the one we would bet against: the car has no
   online services, and BMW normally loads a custom avatar through the My BMW app. persod may well store it while
   the HMI shows the default picture. The app can only prove that the **field** holds it: after a write it re-reads
   `avatar` and reports whether the same size and checksum come back. **Only the owner's eyes on the centre screen
   can answer this one** (step 6 below).

Two smaller designed-but-unproven points:

- **How the enum goes on the wire.** The binding hands enums over *by name* when reading (the car answers `type` as
  `"USER"`), and the only setter anyone has used on this car (`name`) takes a `Utf8D`. So the app sends the name,
  `"INDIVIDUAL"`. If the provider refuses it, the app sets **the same field once more with the catalogue's number**
  (16) and says which form was taken. Nothing else is tried, and no other field is touched.
- **Reading an inactive slot's `avatar`.** Granted and ordinary, but it is a whole jpg over the binding, so the app
  reads it **only when `avatarType` is `INDIVIDUAL`** — not for every slot on every refresh.

### 9.3 What the app does, exactly

- **PROFILE** shows the avatar row as the type by name — "Default (DEFAULT)", "Avatar 7 (AVATAR7)", "Not set
  (UNSPECIFIED)" — and for `INDIVIDUAL`: "Custom picture (INDIVIDUAL) is set, 12 KB of jpg". The picture itself is
  never drawn, printed or logged: the read turns it into a size and a checksum and drops the string.
- **The Avatar screen** (from PROFILE → *Avatar*) offers, in this order:
  - **Default**;
  - **Avatar 1 … Avatar 15**, BMW's own 15, named by their numbers. We cannot show BMW's thumbnails: an RHMI app's
    `image` component draws only pictures the app itself provides, and nothing in the catalogue or in persod hands an
    app the avatar artwork. **Not depended on, but worth a look later:** the HMI's own resources (`mappings.pbm` and
    the compiled `/mnt/dataro/data/hmi`) presumably hold the 15 pictures; if they can be read off the unit and
    bundled, the rows could show them. That was not tried, and the car was offline.
  - **the six pictures that ship with the app** — two pictures at **128, 256 and 512 px**, each row showing its file
    name and its size ("6 KB — came with the app, press to use it"). They go in `apps/driver_profiles/avatars/`
    **at the owner's own request** (see the note at the head of this section: present but not committed); the build
    packs that folder into `avatars.pack` next to the code, and `avatars.js` reads one file out of the pack when it
    is chosen. Three sizes per picture is the point: if the car refuses 512, step down to 256, then 128, without
    touching a file. With the folder empty these rows and their heading simply do not appear.
  - **the owner's own `.jpg`**, listed from `<dataDir>/avatars/` with each file's size in KB. Up to 6 files are
    listed, sorted by name. An oversize or empty file is listed too, with the reason, and cannot be chosen.
  - When that folder is missing or has no jpg — the normal state until the owner puts one there — a row says so and
    the next row prints **the folder's full path**, so it can be read off the screen. **Read the folder again**
    re-lists both sets without leaving the screen.
- **The two sets cannot be confused.** They are separate lists with separate rows, and a row sends only from its own
  set. If a name appears in both, both rows say which is which: the bundled row reads "came with the app (not your
  folder's file of that name)", and the folder row reads "your own file of that name". The confirm screen repeats it
  ("…(6 KB, the copy that came with the app)" / "…(3 KB, from your avatars folder)").
- **The only folder the app reads for the owner's own pictures** is `<dataDir>/avatars/`. Names come from `readdir`
  of that one folder and travel through the screen only as a row number; no path is ever built from anything the HMI
  hands back. Skipped at listing time and again right before the read: anything that is not `*.jpg` / `*.jpeg`,
  dot-files, directories, and **symlinks** (`lstat`, never `stat`, so a link cannot lead out of the folder).
- **On confirm**: `avatar` ← the Base64 jpg, **then** `avatarType` ← `INDIVIDUAL`, in that order, so the type never
  points at a picture that is not there yet. Each write's result is reported. A bundled picture and the owner's own
  go down exactly the same path; only where the bytes come from differs. For a preset only `avatarType` is written,
  and a picture already stored is **left alone** (the confirm screen says so).
- **Nothing else about the account is touched**: no name, no type, no protection, no PIA. The bench test asserts
  exactly that after a write.
- **The same gate as every other write** (`config.requireParked`): engine off, gear P, no PIA job, no other change
  running, re-read and re-checked right before sending; a confirm screen that names the fields and the codes
  (`avatarType = AVATAR7 (code 7)`, `avatarType = INDIVIDUAL (code 16)`) and the live checks; nothing sent without a
  press. Every handler runs inside `guard()`.

### 9.4 What the bench proves

`node bench/test-driver-profiles.js` (port 8170): **116 passed, 0 failed** with the bundled pictures in place, and
**104 passed, 0 failed** with that folder empty (the 12 bundled checks are skipped, not failed, and the run says so).
0.1.0's 57 checks are unchanged. The rest:

- `bench/fake-personalization.js` now behaves like the car as far as anyone knows it: both setters with their
  notifiers, an `INDIVIDUAL` that really holds the data (`POST /fake {setAvatar:{slot,bytes}}` preloads one), and
  three configurable refusals — `avatarMaxChars`, `rejectAvatar` / `rejectAvatarType` (any message), and
  `avatarEnumByName: false`, which makes it take the enum only as a number. The picture never leaves the fake: the
  probe reports its size and a checksum.
- the avatar row and button on PROFILE; the Avatar screen **with no data folder at all** (no file rows, the hint, the
  full path) and **with files** (three jpgs with their sizes, the oversize and empty ones marked, the spare rows
  hidden, and **neither a `.txt`, a dot-file, a sub-directory nor a symlink pointing outside the folder listed**);
- **the six bundled pictures**: all listed by name with their sizes, all inside the 48 KB limit (largest 46 KB), and
  one of them sent end to end — exactly its bytes arriving (size and checksum), out of the **packed** folder, since
  the bench runs the built app;
- **a clash of names**: a data-folder file called exactly like a bundled one, with different bytes. Both rows say
  which they are, and pressing the bundled row sends the bundled bytes;
- **each kind of preset**: `AVATAR7` written as one field, with no picture written, and the row reading back
  "Avatar 7 (AVATAR7)";
- **a custom write**: the confirm text naming both fields in order, then exactly those bytes arriving,
  `avatarType = INDIVIDUAL`, the profile row reading "Custom picture (INDIVIDUAL) is set, 3 KB of jpg", and name,
  type, protection and PIA number all unchanged;
- **the app's own refusals** before anything is sent: an 80 KB file over the 48 KB limit, and an empty file — each
  refused with its reason, with no confirm screen and nothing on the wire;
- **a car-side rejection**: the message the fake throws is shown word for word, `avatarType` is not written
  afterwards, the stored picture is unchanged, and the Avatar screen stays open to try again;
- **the enum fallback**: with the fake refusing the name, the same field is set with the number and the result says
  so;
- **the parked gate** on an avatar write: engine running → the confirm screen says so and Yes sends nothing;
- **only the allowed writes, ever**: the six calls, counted one per confirmed Yes, and no Base64 string over the
  limit ever handed to a setter;
- **nothing leaks into the log**: no profile name, no e-mail, **no avatar file name** (bundled ones included), and no
  run of Base64.

### 9.5 What the owner should do on the car

Do this after the read-only steps of section 6, on **one profile you do not mind changing**, with the ignition on,
the engine off, in P, and a battery charger connected. Nothing here can delete a profile, and step 7 undoes it all.

1. **Install** 0.2.0 from this branch (the Store, as in section 7). If the install complains, its log names the field
   it refused — most likely `avatar` or `avatarType`. Send that line; nothing else needs doing.
2. **Look, before pressing anything.** Open a profile. The **Avatar** row should read "Default (DEFAULT)" (or
   whatever BMW's menu set). If it says "Not known", the getters are refused and nothing else in this section will
   work either.
3. **A preset first** — it is one small field and the safest test of the setter. Profile → **Avatar** → **Avatar 3**
   → Yes. Expect "Result: avatarType is now AVATAR3 (Avatar 3)". Then **look at BMW's own profile screen** (CAR →
   Профілі водія): does the picture there change? That answers whether the HMI follows this field at all.
   - If the result says "avatarType still reads …", persod took the call and kept the old value: tell us, and say
     whether the result mentioned the number.
4. **A picture that came with the app** — nothing to copy anywhere (if those rows are not on the screen, the six
   files were not committed: see the note at the head of this section, and go to step 5 instead). Profile →
   **Avatar** → one of the rows under "Pictures that came with the app" → Yes.
   - **Start with a 128 row** (3–6 KB). If that works, try the matching **256**, then **512** (24–46 KB). The point
     of the three sizes is to find where the car stops accepting, so **tell us the largest one that worked**.
   - Expect "Result: picture sent (NN KB of jpg) and avatarType set to INDIVIDUAL" and, on the next line, "The same
     picture reads back".
5. **Your own picture**, if you want one that is not in the app. On the Mac:
   - make it **square and small**: about 200×200 px, saved as **.jpg**, **at most 48 KB** (`sips -Z 200 me.jpg --out
     me-small.jpg` gets close; check the file size afterwards);
   - the Avatar screen **prints the folder it reads** — open it on the car and read that path off the screen, then
     put the file there:
     ```sh
     ssh root@<car> 'ls -d /var/opt/public/oap/oap_*/data'   # the app's folder: the one with driver_profiles.log
     ssh root@<car> 'mkdir -p /var/opt/public/oap/oap_<uid>/data/avatars'
     scp me-small.jpg root@<car>:/var/opt/public/oap/oap_<uid>/data/avatars/
     ssh root@<car> 'chown -R oap_<uid>:oap_<uid> /var/opt/public/oap/oap_<uid>/data/avatars'   # the app must read it
     ```
   - then on the car: Avatar → **Read the folder again** → your file's row (it shows its name and size) → Yes.
   - A USB stick works just as well, as long as the file ends up in that folder.
6. **The question only you can answer:** does BMW's own profile screen now show the picture? Look at CAR → Профілі
   водія, and at the profile's own settings page. If it shows the default picture instead, the field holds the data
   but this HMI does not draw a custom avatar on this car — which is what we half expect, and is worth knowing.
7. **To undo**: Avatar → **Default** → Yes. That writes one field. The picture stays stored, unused.

Two things to report back, because they are the whole point of the exercise: **the largest picture the car accepted**
(step 4), and **whether the centre screen changed** (step 6). Also send the text of any "Result: the car refused …"
line and, if anything says "Error", the app's log
(`/var/opt/public/oap/oap_<uid>/data/driver_profiles.log`) — it has no names, no file names and no picture data in it.
