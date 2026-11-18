# Twin Dial trip computer and odometer: the five-minute check

For the owner, with the Twin Dial build from branch `research3/mk` installed (the lead installs it). That build shows
the most likely units ("factors") **by default**: the trip page shows numbers as soon as the car sends any. This check
finds out whether those numbers are right. You never reset anything: we only read.

Reading the log afterwards is the lead's job. You only take photos and write down a few numbers.

## What you need

- A phone camera.
- The car parked safely at the end of a drive of **at least 3 minutes and 2 km**. The app writes its summary 2 minutes
  after it starts and again after 10 minutes, so drive at least 3 minutes.

## The five minutes

| Minute | Do | Photograph or write down |
|---|---|---|
| 0 | Before you set off, with the engine on: look at the bottom row of Twin Dial (under the two dials). | **Photo 1**: the cluster, showing Twin Dial's odometer (bottom left, for example "48 215") and the right-hand number (R1). Also the odometer BMW shows on iDrive (Vehicle status or service page), if you can find it quickly. |
| 0 to 3 | Drive normally for at least 3 minutes. Do not touch the trip computer. | Nothing. |
| 3 | Park. Leave the engine running. On iDrive, open the car's own **trip computer / travel data** page. If it has two pages or tabs (for example "since start" and "since refuelling", or "Trip" and "Since reset"), you will need both. | **Photo 2** (and **Photo 3** if there is a second page): average consumption, average speed, distance, driving time, start time. |
| 4 | Set Twin Dial's centre to the trip page (Twin Dial menu on iDrive, setting **centre = trip**), or wait up to 10 s while standing until it cycles to "Поїздка". | **Photo 4**: Twin Dial's trip page with all five values, and the bottom row. |
| 5 | Note the time on the clock. Tell the lead "done at HH:MM". | The time, so the lead finds the right log lines. |

That is all. If a value on Twin Dial is a dash "–", that is information too: photograph it.

## What the lead does with it (not your part)

The lead copies the app's log from the car (read only) and keeps only the lines that start with `trip ` or
`odometer ` (numbers, field names and the enum names only: no text, no place). Then compares Photo 2 / 3 with Photo 4
and the log, value by value:

| Twin Dial shows (Photo 4) against the car's page (Photo 2/3) | What it means | The one-line fix in `apps/twin_dial/app.json` |
|---|---|---|
| The same number | the factor is right | nothing; when all match set `config.trip.verified` = true |
| 10 times too big (for example 68.0 instead of 6.8) | the unit is 0.01 | that key's factor = 0.01 (`cons`, `speed` or `way`) |
| 10 times too small (4.1 instead of 41) | the unit is 1 | that key's factor = 1 |
| Matches the car's **other** counter (the second page) | BC1 / BC2 swapped | `config.trip.factors.bc` = 2 |
| Start time off by exactly the time-zone hours | the car sends UTC | `config.trip.departureUtc` = ["kombi"] (or ["rl3"], the log says which source) |
| Driving time 0:43 but the car says 1:23 (more than 59 minutes in the minute place) | already handled: minutes above 59 carry | nothing |
| A dash, and the log's `trip summary` says that source is **SILENT** with `getter ... error or no answer` | **the car does not send it** | none in config: the next step is the probe build (wide net), see below |
| A dash, and the log says the source spoke but **[invalid]** | the car sends its "no value" marker (for example 4095 or 65535) | none: the car has nothing to show yet (drive longer, read again) |
| A number from **[rl3]** in the `trip shows` line | KombiIF was silent, the head unit's own trip computer stepped in | compare it like any other; its factors are `config.trip.factors.rl3` |
| Odometer (Photo 1, Photo 4) the same as BMW's | the odometer is right | `config.odometer.verified` = true |
| Odometer 10 times off | the unit | `config.odometer.factors.<the source the log names>` = 0.1 or 10 |
| Odometer a dash | no carrier sent a valid value | the summary names each carrier and its getter's answer |

The log lines to look for (examples from the bench, with made-up numbers):

```
odometer raw (P3): 48215 -> 48215 km (factor 1 km) [rangeTank, first at 0.3 s, UNVERIFIED: compare with the cluster's odometer]
trip average (statusBordcomputerAverage) first at 26.8 s: raw speed1=410 cons1=68 speed2=520 cons2=55 speedUnit=0 consUnit=0 -> speed 41.0 km/h, cons 6.8 l/100 km (BC1) [UNVERIFIED: compare with the car's trip page]
trip summary #1 at 120.0 s: heard rangeTank (#40, first 0.3 s), average (#9, first 2.1 s), ...; SILENT supreme, range, secure, rl3
trip shows: cons 6.8 l/100 km [kombi], speed 41 km/h [kombi], distance 12.4 km [kombi], time 0:43 [kombi], departure 14:00 [kombi]; odometer 48215 km [rangeTank]; ...
trip check [kombi]: distance / time = 17.3 km/h, average speed 41.0 km/h, ratio 2.37 -> consistent (above 1: standing time not counted)
trip getter rl3 (ResetLogic3.bcDataAll, silent): provider not available (the interface itself never came up)
```

The `raw` numbers next to the car's own page give the factor directly: raw 68 for "6.8 l/100 km" means 0.1.

## If the car sends nothing (every trip source SILENT)

Then the empty page was never a matter of units. The next car session installs the **probe build**
(`python3 tools/twin-dial/probe_build.py on`), which also listens to ResetLogic, ResetLogic2, BcPersonal.driveSegment and
LSCDataSink.dataCombinedInstrumentCluster (lines `probe P4 bc-all1`, `bc-avgcons1`, `bc-all2`, `bc-segment`,
`lsc-cluster`), and repeats Photo 2 against those lines (docs/twin-dial/PROBE-PROTOCOL.md, P4).
