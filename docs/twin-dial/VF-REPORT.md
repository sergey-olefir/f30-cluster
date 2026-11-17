# Package VF: the frame and our check-control message

Branch `twin-dial/vf` (from `main`). No car, no push, no app code. Numbers are in `design/twin-dial/vf/`:
`frame_spec.json` (the proposal), `frame_measured.json` (per reference), `message_panel.json` (the message design,
the fallback window and the checks). Tools are in `tools/twin-dial/vf/`. Pixels stay in `bake/work/twin-dial/vf/`.
Published to `bake/work/twin-dial/pub/VF/` (`READY` touched).

**Units.** u, v are in R (the bezel ring's centre line, VR's convention), measured from the midpoint M of the two
dial centres, with u to the right and v down. Use u_D = u / 3.875 for fractions of the centre distance. One source
pixel is 0.0048 R on reference 02 and about 0.0093 R on 04 and 05. That is the basic uncertainty, and VR's
residuals add 0.001 R on top of it.

## 1. Method

1. `fit_dials.py` fits both bezels on the original images. This gave the provisional frame, a similarity transform
   only.
2. `measure_frame.py` takes a rough box for each element (`frame_boxes.json`) and finds the element's edges inside it.
   - Edges sit at 50 %.
   - Rules: a sub-pixel centroid and the FWHM. The rule's run is traced column by column.
   - Separators: the darkest column.
   - Texts: ink split into words.
   - Highlighted tabs: a hue mask.
3. Once VR published, the same boxes were mapped through VR's model (the k1 term, then H) and measured again on VR's
   rectified images. All numbers below come from that second run.
4. `summarise.py` keeps the shift between the provisional and the rectified result (`prov_delta_R`). On 02 the
   shift is 0.03–0.10 R, so the rectification mattered. On 04 and 05 it is at most 0.04 R.

Which references lead:
- **02** leads. It is the only sharp in-car facelift frame.
- **04** and **05** show the same design on a bench and in a product picture. They are less sharp, and their layout
  differs a little (D/R 3.80 and 3.62 against 3.875).
- **01** and **03** are classic. They were used only for contrast.

## 2. The frame

### Tab bar (verified on 02; 04 and 05 agree within 0.05 R)

| item | value | refs / note |
|---|---|---|
| extent | u ±1.139 (±0.005) | 02 symmetric to 0.001; 04 −1.184/+1.171; 05 −1.118/+1.161 |
| gap to the bezels | 0.19 R | the bar floats and touches neither dial |
| rule under the bar | v −0.761, 0.005 R thick (1 source px), white | 02: level to 0.001 R over 4 cells; 04 −0.718, 05 −0.746 |
| cell | top v −0.911, height 0.150 R | 04: 0.126 R, 05: 0.113 R |
| cell fill | vertical gradient, clear at the top, grey at the rule; 50 % point at v −0.822 | colour: VC |
| separators | u −0.721, −0.492, +0.694, +0.922 (±0.004) | each is a dark 1-px gap, then a light 1-px line at the next cell's left edge |
| tabs (02) | range 0.418 · warning 0.229 · media 1.186 · phone 0.228 · nav 0.217 | 04 and 05 add a sixth tab on the right |
| widths | icon tabs 0.22 ± 0.01 R; the first tab fits icon + value; the media tab takes the rest | |
| content | text baseline v −0.814, cap 0.077 R; icons 0.12 R tall, centred at v −0.855 | content centred in its cell (02: 0.100 against 0.101) |
| highlighted tab | flat fill from the cell top to the rule; the rule under it in the same colour; white icon and text | 02 red range tab, 04 red warning tab, 05 green settings tab |

The classic generation draws an outlined trapezoid for the highlighted tab instead of a fill. It is not used.

### Telltale strip
- On 02 it runs v −1.144 to −0.951, just above the bar, with groups centred on M.
- On the G20 this zone is BMW's own telltales. We draw nothing there.

### Centre window
- **No border in the facelift** (02, 04, 05). The window is the black between the tab-bar rule (v −0.761) and the
  bottom rule (v +0.710).
- Its width is the free space between the bezels, ±0.937 R at v 0. Content keeps within ±0.77 R.
- Page grammar (02, confirmed in 05):
  - Title centred on u 0, box v −0.496 to −0.371. Baseline about −0.40, cap about 0.096 R (estimated).
  - Title rule at v −0.347, running u −0.731 to +0.734, 0.005 R thick.
  - Body from v −0.346 to +0.546.
- Reference 05 also has a scroll bar at u 0.820, v −0.261 to +0.154.
- Reference 04's car picture: centre (0, −0.066), 0.96 R tall, caption at v 0.55–0.64.
- The map comes only from classic reference 01. It is full-bleed between the dials and cut by the bezels:
  u −1.12 to +0.91, v −0.96 to +0.72. For the facelift this is a hypothesis.
- The classic reference 03 has a framed window: u −0.847 to +0.80, v −0.785 to +0.389.

### Bottom row (02)
- **Rule:** v 0.710 (±0.003), u −1.104 to +1.106, 0.0075 R thick, white. It is level and ends 0.13 R before the
  bezels. On 04 the rule is red, at v 0.655, ±1.09.
- **Two lines:** baselines at v 0.854 and 1.010, pitch 0.156 R. Digit cap height 0.100 R, units 0.068 R, with a
  0.02 R gap between number and unit.
- **Slots:** L1 odometer, R1 trip, L2 clock, R2 outside temperature. Classic 03 uses the same assignment.
- **Columns:** the numbers are right-aligned and the units hang after them. Units sit on the number's baseline.
  - Right column: ends at u +0.644 on both lines (verified to 0.001 R). The decimal points line up.
  - Left column: ends at u −0.379. "694" and "14:43" end 0.010 R apart, so treating this as the same rule is a
    hypothesis.

### Joining outline
None. The bar, the centre content and the bottom rule float in the black. This holds on 02, 04 and 05.

### Reduced view
Not found: VR published no web references. This stays open.

### Alignment rules
- The frame is symmetric about M's vertical.
- The three rules (tab bar, title, bottom) are level.
- Titles and the middle tab's content are centred.
- Tab content shares one baseline.
- Bottom-row numbers are right-aligned in two columns.

## 3. Our check-control message (decision 6)

Fixed points from VG's layout rev 1 (provisional): R 300, centres (380, 400) and (1540, 400), so M = (960, 400).
- **BMW's panel** (`zc.panel` + 3 px): x 696–1226, y 595.75–704. In dial units that is u −0.880 to +0.887,
  v 0.653 to 1.013.
- **This is exactly where our bottom row is.** The 02 rule sits at v 0.71 and the baselines at 0.854 and 1.010.

### M2 "bottom plate" (recommended)

Our message takes the bottom row's place, which is the spot G20 drivers know and the spot where the fallback opens.

| part | dial units | panel px (rev 1) |
|---|---|---|
| plate (opaque black, ours) | u −0.885 to +0.900, v 0.640 to the panel's foot | [694.5, 592, 1230, 720] |
| rule | v 0.710, ±1.105; 0.0075 R white at rest, 0.012 R in the severity colour while a message shows | y 611–615 |
| symbol cell | u −0.860 to −0.640, v 0.745 to 1.025 (as wide as an icon tab); symbol 0.18 R | [702, 623.5, 768, 707.5] |
| headline | left edge u −0.590, right limit +0.880 (441 px); cap 0.100 R (30 px); two lines at baselines 0.854 and 1.010, one line at 0.932; wrap, then "…" | y 656 / 703; one line 680 |
| counter "n/m" | right-aligned at u 0.880 on line 2, cap 0.068 R, grey; line 2 then ends at u 0.740 | |

**Colour by severity**, in the highlighted-tab language:
- Red and green: the symbol cell is filled flat with that colour and the symbol is white.
- Yellow or orange: amber fill with a black symbol.
- White or info: the plain grey gradient cell with a white symbol.
- The rule and the tab bar's warning tab take the same colour, which is reference 04's state: warning tab and rule
  both red.

**Symbols:**
- VT's drawings, by meaning.
- Any id we have no drawing for gets a generic triangle (red, yellow) or an "i" (white, green).
- BMW's bitmaps are never used.
- No stored-message marker until a signal for it is confirmed.

**Several messages:**
- We draw only the one the cluster says it shows now (`statusActiveCCMessage`, number = ccList id: a hypothesis
  until the car logs it).
- We follow BMW's own cycling. When `statusMenuCCMessage` arrives, its frame n of m drives the counter.
- We never cycle on our own: a cycle that differs from BMW's would break the "that exact message" rule.
- ccList's stored entries are not drawn.

**Entering and leaving:**
- Hard cut, no fade. Our text must be fully on screen before BMW's window may close (`CC_SETTLE_MS`).
- When the message ends, the plate goes in the same tick and the bottom row comes back.
- The centre content is untouched in M2.

**Checks** (`message_panel.py`, all pass):

| check | result |
|---|---|
| plate covers the window | margins 1.5 / 3.75 / 4.0 / 16 px, so the plate clears BMW's outline by at least 4.5 px |
| plate to belt group | 6.5 px clear |
| symbol cell to belt group | 14 px clear |
| rule to belt group | 45 px clear |
| text to belt group | 95 px clear |
| plate to gear-letter gap | 150 px clear |
| rule to gear-letter gap | 88 px clear |

### Fallback window
- **Shape:** `zc.panel` dilated by 3 px. `message_panel.json` holds the polygon (panel px) and its bbox.
- **Opens** from the signal handler whenever a message is shown and we have no drawn text for that exact message:
  - no readable name;
  - no matching ccList entry;
  - a glyph our font lacks;
  - a throw while drawing;
  - the message signals not (yet) readable.
- **What it cuts:** it is a hole through **every** layer of ours inside it. That means the plate, the rule, the
  symbol cell, the text, **and the bottom row's texts**, all of which lie inside it. Otherwise our odometer would
  print over BMW's panel.
- The tab bar's warning tab may still light in the car's colour. It lies outside the window.
- **Closes** only when our text for that exact id was sent at least 150 ms earlier.

### M1 "centre card" (option for the owner)
- The warning page in the centre window, as in reference 04: warning tab highlighted, centre content replaced.
- Symbol cell u ±0.15, v −0.56 to −0.23. Severity rule at v −0.150, ±0.733.
- Headline centred, max ±0.733 (440 px), baselines 0.080 / 0.236 (one line: 0.120). Counter at v 0.45.
- The bottom row stays and keeps BMW's footprint covered.
- Costs: the centre page disappears while a message shows. In a fallback, BMW's panel appears at the bottom while
  our card is absent, so a message appears in two different places depending on whether we can draw it. That is why
  M2 is recommended.

## 4. Verified and hypothesis

**Verified (measured):**
- Every number marked verified in `frame_spec.json`.
- The coverage and clearance checks, on VG's rev 1.

**Hypothesis:**
- The left bottom column's alignment rule.
- The facelift map frame (only classic 01 has one).
- `statusActiveCCMessage`'s number being the ccList id.
- The `statusMenuCCMessage` frame counter.
- The design choices: M2, the severity fills, amber with a black symbol.

**Provisional:** every panel-px value. Rerun `message_panel.py` when VG publishes a new rev.

## 5. Open questions
1. The owner chooses M2 (recommended) or M1.
2. The tab bar's tabs in our app depend on VG's centre proposals. Does the warning tab exist, so that it can carry the
   severity colour?
3. 02's tab bar sits 0.04–0.08 R lower in v than 04 and 05. The spec takes 02's values.
4. No facelift warning-state reference exists. If one is found, the message design should be checked against it.
