# tools/car: from the car's logs to decisions (package CL)

Four tools and their tests. Nothing here ever opens a connection to the car except `collect.sh`, and only the lead runs that one.

| Tool | What it does |
|---|---|
| `collect.sh` | read-only copy of the apps' logs, `settings.json`, cluster-render's log / journal / status / version, into a new dated folder under `reference/car/` |
| `parse_logs.py` | reads such a folder, applies every decision table, writes `design/car/answers.json` |
| `make_patches.py` | from `answers.json`, the exact `app.json` changes each answer implies, as diffs with the evidence beside each. Never applies anything |
| `privacy_check.py` | scans collected files and derived files for text that must not be there; makes redacted copies |
| `test_car_tools.py`, `synth.py`, `fixtures/` | 47 tests on synthetic logs (shapes of the apps' real lines), the real 2026-11-15 material when present |

Python: `UV_CACHE_DIR=<main checkout>/bake/work/.uvcache uv run -q --no-project python -I tools/car/<script>`. No third-party package.

## 1. Collect (the lead, with the owner's word, car online)

```
tools/car/collect.sh <car-address> --dry-run                 # prints every command, runs none
tools/car/collect.sh <car-address> --label 1                 # collect #1 -> reference/car/<date>-collect1/
tools/car/collect.sh <car-address> --label 2 --apps f30_cluster,twin_dial,signal_probe,car_vitals --since "3 hours ago"
```

* Every command is printed before it runs (`+ ssh ... 'tail -c 3000000 /var/opt/public/oap/oap_<uid>/data/signal_probe.log'`).
* Every command passes through `rd`, which refuses anything that is not `cat`, `ls`, `stat`, `tail -c N`, `date -u +FORMAT`, `uname -a` or
  `journalctl -u cluster-render --no-pager -o short-iso-precise --since "..."` on a path under `/var` or `/run`, and any shell
  metacharacter (`; | & > < $( \` \`). It never restarts, writes, kills, installs or sets anything. The tests run it against a fake `ssh` and check
  that no command outside that list was sent.
* It finds each app's uid from the `source/package.json` of every `oap_<uid>` directory (name and version), so Twin Dial's and the probe's
  data folders are found without knowing their uids. By default only `f30_cluster,twin_dial,signal_probe,car_vitals` are copied;
  `--all-apps` copies every app's log (other people's apps: say why).
* It saves, per app, `apps/<app>/<app>.log`, `.log.1`, `settings.json`, `package.json`, `data-ls.txt` (does `kombi-guard.json` exist), and,
  for the renderer, `cluster-render/cluster-render.log(.1)`, `status.txt`, `versions-ls.txt`, `component.json`, `journal.txt`; and
  `session.json` (apps, versions, uids, the car's clock at the copy, file sizes).
* The probe app's log rotates at 256 KB: collect after every block (the runbook says when). The default read is the last 3 000 000 bytes.
* After the copy it runs the privacy scan; flagged lines are listed and redacted copies go to `<folder>/redacted/`. The originals stay: the folder is
  git-ignored. **Nothing from a collected folder is ever committed; only `design/car/answers.json` (numbers) is.**

## 2. Parse

```
tools/car/parse_logs.py reference/car/<date>-collect1 [--readings readings.json] [--markers design/car/session_marks.json]
                        [--register design/car/register.json] [--out design/car/answers.json] [--only L1,P13]
```

* The register is CA's (`design/car/register.json`, 91 items) when found, else the built-in list of the brief. Per item the output is
  `status` (`answered`, `partial`, `not-yet`, `no-material`, `manual`), `label` (`arrives`, `arrives-other-app`, `not-sent`, `unseen`),
  `decided` (the value, numbers and enum names), `evidence` (file, line number, time, a SHAPE of ours with the numbers filled in), `why`, `needs`,
  `dated` (a snapshot answer carries its date) and the register's `blocks`.
* `no-material`: the folder has no log of a build that writes the lines. `not-yet`: it has, and the situation was not in it. `manual`: a photo or an
  observation (X and F items), the lead records the result. `partial`: something arrives but a reading or a step is missing; `needs` says which.
* **Marks.** `design/car/session_marks.json` (CQ) says which session step each "Позначка N" is; `steps.py` maps CQ's step ids to the classes the tables use
  (`bc-short`, `stalk-left`, `door-driver`, `mode-switch`, ...). The probe's own lines carry `since=M<n>+<ms>`, which the stalk table uses. Marks restart at 1
  when the probe app restarts: collect after every block so a mark number is unambiguous.
* **Readings.** `readings.example.json` shows the owner's numbers the tables compare a raw value with (the cluster's odometer, iDrive's trip page, a tyre
  page, a boost peak, a counted title length, a sign's value, the cruise set speeds, sunrise / sunset). Without a reading a table says what is missing and
  still gives what a log alone can give (arrives / silent, ranges, the distance / time cross-check).
* Evidence labels follow the brief: `arrives` (a line on this car's log), `arrives-other-app` (car_vitals' log), `not-sent` (proven silent: the probe's
  `+120 s` summary names the field silent; `observed_minutes` and the steps done meanwhile are in `decided`; under 2 minutes it stays `partial`),
  `unseen` (never subscribed on this car).

### Decision tables in code

| Item | Module.function | Source table |
|---|---|---|
| L1, L2 (the window), L8, P1, P2 | `tables_msg` | research3/MC section 6 (13 rows, cases A0-A17), PROBE-PROTOCOL P1 / P2 |
| L4, L5, P3, P4, P5 | `tables_trip` | research3/MK sections 3, 6, 7 (factors, counter, departure zone, distance / time cross-check) |
| L3, L6, L7, L9, L13, L14, L15 | `tables_l` | the lines the apps already write |
| L10, L11, L12, X5, X10 | `tables_render` | research3/MP, MT; r3/SN section 1 |
| L16-L21, L24-L30, generic P18-P21 | `tables_l2` | CA's register steps |
| P6, P7, P8, P9, P10, P11, P12, P13, P14, P15, P16, P17 | `tables_probe` | PROBE-PROTOCOL, r3/SM, SP, SN, SV, SB section 3.3 |
| car_vitals facts (P5, P6, P16) | `tables_vitals` | another app's log |

**The MC trap.** `active cc: no ccList entry for number N` alone is never a hang. A hang is a number other than 0 while the list is at rest for more than
1 s; the order effect (list and number arriving in either order, within a second) is counted separately (`order_effects`) and tested with both orders.

## 3. Patches

```
tools/car/make_patches.py [--answers design/car/answers.json] [--out bake/work/car/CL/patches]
```
`patches.md` (per patch: the answer, its date, the evidence, the diff), `patches.json`, one `NN-<id>.diff` per patch. `kind: diff` changes a value that
exists in the checkout's `app.json`; `insert` adds a key whose reader is on a branch (`requires` names it); `advice` states the values when no config
shape exists yet (cruise, media, phone, tyres, the map window). The diffs keep every other byte of the file. Apply by hand after `git apply --check`.
`noneValues` is never set to include 65535 (MC F0 is unsafe), and `strict: false` for Twin Dial is marked as the owner's decision.

## 4. Privacy

Evidence is built from regex groups that are numbers or enum names and from templates written in this code; `tables_base.safe_value` refuses any other
string at the moment a table returns it (a text can not reach `answers.json` by accident), and `privacy_check.py --kind derived` re-checks the finished file
(`parse_logs.py` refuses to write a file that fails it). The raw-log rules: letters outside Latin, coordinate pairs, VINs, phone-like numbers, e-mail,
MAC and IP addresses, key-like tokens, and any probe line where a key that names a text (`name`, `title`, `artist`, `number`, ...) or a `*-len` key carries
letters. Tests plant canary words and a phone number in every member a probe line could carry and prove none reaches the derived file.
