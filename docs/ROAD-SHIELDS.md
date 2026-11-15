# Road-number shields for the cluster bottom row

Research and drawing spec only. **Nothing in the app is wired up by this branch**; `shared/shaders.js`,
`apps/f30_cluster/hud/layouts/` and every app behaviour are untouched. No downloaded image is committed:
every shield below is described as geometry and redrawn from scratch.

Preview: **`design/shields/preview.html`** — open it in a browser (self-contained, no network, no images).

Each claim is marked **[source]** with a link, or **[design]** where it is my own decision.

---

## 0. The short version

| | Owner's scheme | What the standard actually does | Verdict |
|---|---|---|---|
| **М** міжнародні | red | **red** `#E30013` | matches |
| **Н** національні | red | **red** (not found in a DSTU diagram; see §1.3) | matches, less well evidenced |
| **Р** регіональні | blue | **blue** `#005999` | matches |
| **Т** територіальні | *not listed* | **blue** `#005999`, same as Р | gap: Т needs a decision, blue proposed |
| **E** European | green | **green** `#04AE67` | matches |

The owner's scheme is right. The only real gap is **Т (територіальні)**, which they did not name; the
standard gives it the same blue plate as Р, and that is what is specified below.

The one thing worth knowing: **several Commons icons contradict the standard.** The Commons icon sets for Р
and Т contain **yellow plates with black text**
([File:R04 Ukraine.png](https://commons.wikimedia.org/wiki/File:R04_Ukraine.png),
[File:T01-01-UA.png](https://commons.wikimedia.org/wiki/File:T01-01-UA.png), both CC BY-SA, drawn by editors)
alongside blue ones. The official DSTU diagrams and a photograph of a real sign both show blue. We follow the
standard.

**Two hues deviate from DSTU on purpose**, both for legibility on a black LCD at 40 px, both approved or
proposed in §2.3: the **E green is darkened** to `#037D4A` (the standard's green gives only 2.7 : 1 under the
number) and the **Р/Т blue is lifted** to `#0B63A8` (the standard's would read as a dark hole). The standard
values are kept in every table.

---

## 1. The real shields

### 1.1 The authoritative source: DSTU 4100:2021

The best evidence is Wikimedia Commons' **public-domain diagrams of the Ukrainian road signs that correspond
to DSTU 4100:2021** (the standard in force since 1 November 2021). They are SVG, so the geometry can be read
exactly rather than guessed from a photo.

**[source]** [File:UA road sign 5.63.svg](https://commons.wikimedia.org/wiki/File:UA_road_sign_5.63.svg)
("Detour scheme. Corresponds to the standard DSTU 4100:2021", public domain). Its stylesheet and rectangles,
read from the file:

```
.cls-1 { fill:#fff }                      white, the frame and the glyphs
.cls-4 { fill:#e30013 }  stroke #fff 4px  М plate
.cls-5 { fill:#04ae67 }  stroke #fff 4px  E plate
.cls-6 { fill:#005999 }  stroke #fff 4px  Р and Т plates

<rect class="cls-4" x="48.5"  y="58.5" width="163" height="75" rx="10"/>   М-03
<rect class="cls-5" x="223"   y="58.5" width="150" height="75" rx="10"/>   E 40
<rect class="cls-6" x="204"   y="286"  width="126" height="60" rx="10"/>   Р-42
<rect class="cls-6" x="233"   y="601"  width="180" height="60" rx="10"/>   Т-17-19
<rect class="cls-6" x="514"   y="511"  width="180" height="60" rx="10"/>   Т-17-19
```

So, from one file: **М red, E green, Р blue, Т blue**, every plate a rounded rectangle with a white frame and
white glyphs, and the numbers written **М-03**, **Р-42**, **Т-17-19** with hyphens and **E 40** with a space.

**[source]** [File:UA road sign 5.61.1.svg](https://commons.wikimedia.org/wiki/File:UA_road_sign_5.61.1.svg)
and [5.61.2](https://commons.wikimedia.org/wiki/File:UA_road_sign_5.61.2.svg) (distance indicators, same
standard, public domain) use the same two classes — `#e30013` for М-19 / М-07 / М-01 and `#04ae67` for
E 85 / E 372 / E 373 — on a `#005999` blue sign panel, each plate `210 × 110` px with corner radius `11.341`
and a white stroke `4.23353` px.

**[source]** [File:Road sign route T-10-01 UA.jpg](https://commons.wikimedia.org/wiki/File:Road_sign_route_T-10-01_UA.jpg)
(public domain): a photograph of a real territorial-road plate. Blue field, white frame, white number, written
**Т-10-01**. Confirms the blue of the DSTU diagram in the field.

### 1.2 The Wikipedia shield set (what the M 04 article actually shows)

The owner pointed at [de.wikipedia.org/wiki/M_04](https://de.wikipedia.org/wiki/M_04). That article's infobox
uses **[source]** [File:M04-UA.svg](https://commons.wikimedia.org/wiki/File:M04-UA.svg) (CC0). Its geometry,
read from the file:

```
canvas 355.92276 × 176.125
<rect width="355.92276" height="176.125" rx="32.526913" fill="#ffffff"/>   the white plate
<rect width="338.9375"  height="158"     rx="23.026913" fill="#e40428"     the red field,
      x +8.5  y +9.5 />                                                     inset 8.5 / 9.5
text: font-family "Road UA", bold, font-size 133.72, fill #ffffff, "M04"
```

Derived proportions: frame ≈ **5 %** of the plate height; outer corner radius **0.185 × H**, inner
**0.146 × H**; cap height of the glyphs **93.6** units = **0.531 × H**; side padding from the inner edge to the
ink ≈ **0.18 × H**. The number is written **M04**, with no hyphen and no space.

The same family, same proportions, different widths and fills:

| File | Outer | Inner | Fill | Written |
|---|---|---|---|---|
| [M04-UA.svg](https://commons.wikimedia.org/wiki/File:M04-UA.svg) | 355.92 × 176.125, rx 32.53 | 338.94 × 158, rx 23.03 | `#e40428` red | `M04` |
| [H08-UA.svg](https://commons.wikimedia.org/wiki/File:H08-UA.svg) | 316.92 × 176.125, rx 32.53 | 300.94 × 158, rx 23.03 | `#e40428` red | `H08` |
| [E50-UA.svg](https://commons.wikimedia.org/wiki/File:E50-UA.svg) / [E40-UA.svg](https://commons.wikimedia.org/wiki/File:E40-UA.svg) | 339.05 × 176.125, rx 32.53 | 322.06 × 158, rx 23.03 | `#3aaa35` green | `E50` |

**[source]** All four are public domain or CC0 on Commons. **None is committed here.**

### 1.3 Н (національні) — the weak spot

**[source]** The Commons set has H01-UA.svg … H33-UA.svg
([Category:Diagrams of national highway signs of Ukraine](https://commons.wikimedia.org/wiki/Category:Diagrams_of_national_highway_signs_of_Ukraine),
public domain), all red `#e40428`, written `H08` with no hyphen.

**I could not find an Н plate in any DSTU 4100:2021 diagram on Commons, nor a photograph of one.** The DSTU
diagrams I read show only М, Е, Р and Т. So "Н is red" rests on the Wikipedia shield set and on consistency
with М, not on the standard. **[design]** We draw Н red, same as М — which is also what the owner asked for.
If that ever matters, a photo of a real Н sign would settle it.

### 1.4 Р and Т — the contradictory sources

| Source | Р | Т | Licence |
|---|---|---|---|
| [UA road sign 5.63.svg](https://commons.wikimedia.org/wiki/File:UA_road_sign_5.63.svg) (DSTU 4100:2021) | blue `#005999`, white frame, white text | blue `#005999` | public domain |
| [Road sign route T-10-01 UA.jpg](https://commons.wikimedia.org/wiki/File:Road_sign_route_T-10-01_UA.jpg) (photo) | — | blue, white frame, white text | public domain |
| [R04 Ukraine.png](https://commons.wikimedia.org/wiki/File:R04_Ukraine.png) (nav icon) | **yellow, black text** | — | CC BY-SA 4.0 |
| [T01-01-UA.png](https://commons.wikimedia.org/wiki/File:T01-01-UA.png) (nav icon) | — | **yellow, black text** | CC BY-SA 4.0 |
| [P65-UKR.svg](https://commons.wikimedia.org/wiki/File:P65-UKR.svg) (nav icon) | field `#0000cc` (a much brighter blue), white plate with a **black** outline | — | public domain |

**[design]** We follow the standard: Р and Т are blue with a white frame and white text. The yellow icons are
editor-made illustrations, not the sign.

### 1.5 The typeface

**[source]** The Wikipedia shields declare `font-family: Road UA` (M04/H08/E50-UA.svg) or
`font-family: 'Russian Road Sign'` (P65-UKR.svg); the DSTU diagrams carry outlined paths with no font name.
**[source]** [en.wikipedia.org/wiki/Road_signs_in_Ukraine](https://en.wikipedia.org/wiki/Road_signs_in_Ukraine)
says Ukraine has adopted a typeface called **Road UA**, while the older Soviet GOST 10807-78 lettering is still
in use on existing signs.

Character, measured off the M04 outlines: a bold, wide, low-contrast grotesque; flat terminals; large cap
height (0.53 of the plate); generous counters; the `M` is splayed with a vee that stops short of the baseline.
Measured from the glyph outlines, the ink of `M04` is **2.94 × the cap height**. Arimo Bold, which is what the
6WB theme uses, comes to **2.86** for the same three characters at the same cap height — close enough that the
plate keeps the real sign's proportions without a road-sign face. (Barlow Condensed, the other family in the
repo, is 2.05 — far too narrow; the plate would come out stubby.)

### 1.6 How the number is written

| | Official sign (DSTU diagrams, photo) | Wikipedia icons | uk.wikipedia prose | de.wikipedia |
|---|---|---|---|---|
| М | `М-03` | `M04` | `М-04` | `M 04` / `M04` |
| Н | (not seen) | `H08` | `Н-08` | `N 08` |
| Р | `Р-42` | `P65` | `Р-42` | — |
| Т | `Т-17-19`, `Т-10-01` | `T-01-01` | `Т 2502`, `Т-10-01` | — |
| E | `E 40` | `E50` | `E-40` | `E 40` |

**[design]** We write what the official signs write: **`М-04`**, **`Н-08`**, **`Р-42`**, **`Т-17-19`**,
**`E 50`** (hyphens for the Ukrainian categories, a space for E). The number is normalised to this form
whatever the car sends (§4).

---

## 2. The drawable set

### 2.1 Why these proportions

**[source]** The bottom row: BMW's own street-name field sits at x 795–1126, **y 669–709** on the 1920×720
panel (`docs/POLISH-D-PROPOSAL.md`, from the car photos). That is **40 px tall**, which is where the shield
height comes from.

**[design]** Everything else is the real sign's proportions (§1.2) carried over at 40 px, tightened only where
40 px forces it:

| Real sign (M04-UA.svg) | Ours at H = 40 |
|---|---|
| frame 5 % of H | 2 px (5 %) |
| outer radius 0.185 × H, inner 0.146 × H | 6 px (0.15) / 4 px (0.10) |
| cap height 0.531 × H | 20.6 px (0.515) |
| side padding 0.18 × H | 7 px (0.175) |
| plate aspect 2.02 for `M04` | 2.20 for `M-04` — the DSTU sign's `М-03` plate is 2.17 |

**[design] The number is set in Arimo Bold 30 px — the 6WB family, not a road-sign face.** The brief asks for
a shield that reads as part of the F30 theme rather than a pasted sticker, and every 6WB widget in
`apps/f30_cluster/hud/fonts/` is Arimo (`tools/bake_fonts.py` lines 99–107). Arimo Bold's cap height is
0.688 em, so 30 px gives 20.6 px — the real sign's 0.53 × H almost exactly. Using Road UA would be more
faithful to the sign and less faithful to the cluster; the cluster wins.

### 2.2 Geometry and parameters

Common to every shield:

| Parameter | Value | Note |
|---|---|---|
| Height `H` | **40 px** | = BMW's street row, y 669–709 |
| Frame (border) `b` | **2 px** | drawn inside the plate outline, in the theme's `line` role |
| Corner radius | **6 px** outer, **4 px** inner (= `6 − b`) | one SDF; the inner corner is concentric |
| Side padding `pad` | **7 px** | inner edge of the frame → the ink |
| Number font | **Arimo Bold 30 px**, cap 20.6 px | proposed atlas `wb_shield` (§3.1) |
| Text cell | `cellH` 34, `baseline` 25, **`offsetY` 5** | centres the cap box in the 40 px plate |
| Tracking | **0** | Arimo Bold is already wide enough at this size |
| Width `W` | **`W = 2b + 2·pad + Σ advance(c)` = `18 + ink`** | min 44 px, rounded **up to an even number** so centring is symmetric |
| Gap shield → shield | **8 px** | |
| Gap shields → road name | **14 px** | |

Arimo Bold advances at 30 px (they are Arial's, Arimo being metric-compatible — read back from the baked
atlases `wb_big` / `wb_gear` / `wb_capb`):

```
M 25   H 22   P 20   T 18   E 20   digits 17   hyphen 10   space 8
```

Per shield:

| Shield | Fill (day) | Example | ink | **W × H** |
|---|---|---|---|---|
| **М** міжнародні | `#E30013` | `M-04` | 69 | **88 × 40** |
| **Н** національні | `#E30013` | `H-08` | 66 | **84 × 40** |
| **Р** регіональні | `#0B63A8` | `P-42` | 64 | **82 × 40** |
| **Т** територіальні | `#0B63A8` | `T-17-19` | 106 | **124 × 40** |
| **E** European | `#037D4A` | `E 50` | 62 | **80 × 40** |
| **E** 3-digit | `#037D4A` | `E 373` | 79 | **98 × 40** |
| **neutral** fallback | `#5A616B` | `A7` | 39 | **58 × 40** |

How it grows (same formula, any text):

| Characters | Example | ink | W |
|---|---|---|---|
| 2 | `P7` | 37 | **56** |
| 3 | `P42` | 54 | **72** |
| 4 | `M-04` | 69 | **88** |
| 5 | `E 373` | 79 | **98** |
| 7 | `T-17-19` | 106 | **124** |

**[design]** Т at 124 px is the widest thing in the set. If the row is tight, drop to the compact form
`T1719` (ink 86 → W 104). Never abbreviate М/Н/Р/E: they are already 4–5 characters.

### 2.3 Colours

The **frame** and the **number** are not fixed colours: they are the theme's **`line`** and **`fg`** roles.
In 6WB Comfort that is `#ECF0F6` and `#F4F6FA` (`shared/hud_themes.js`), and in 6WB Sport / Eco Pro the
theme's own. So **the number is `#F4F6FA`, not pure white**, and that is what every contrast figure below is
measured against; the figure against pure white is given too, because it is the number usually quoted.

All contrast is WCAG 2.x relative luminance, computed — the preview recomputes it live from the same hex
values, so the tables and the drawing cannot drift apart.

#### The shipped set

| Shield | DSTU | **Day fill (ours)** | Number on it<br>(`#F4F6FA` / white) | Plate on black | **Night fill**<br>(day × 0.42) | Number on it<br>(night) |
|---|---|---|---|---|---|---|
| М, Н | `#E30013` | `#E30013` *(same)* | **4.54** / 4.91 | 4.28 | `#5F0008` | **4.63** |
| Р, Т | `#005999` | `#0B63A8` *(lifted)* | **5.77** / 6.24 | 3.36 | `#052A47` | **4.83** |
| E | `#04AE67` | `#037D4A` *(darkened)* | **4.81** / 5.20 | 4.04 | `#01341F` | **4.56** |
| neutral | — | `#5A616B` | **5.78** / 6.26 | 3.36 | `#26292D` | **4.80** |
| frame / number | — | `#ECF0F6` / `#F4F6FA` | — | 18.36 | × 0.6 → `#8E9094` / `#929496` | — |

Every plate clears 4.5 : 1 under the number, by day and by night.

#### The E green **[design, approved by the owner]**

The standard `#04AE67` is the brightest of the three hues (perceived luminance 115/255, against 70 for the red
and the DSTU blue), so the white number on it is weak — **2.68 : 1** against our `fg`, 2.89 : 1 against pure
white. The real European-route plate has exactly the same problem; it is not a mistake in our drawing. The
owner asked for it to be tuned rather than inherited.

**Chosen: `#037D4A` — the DSTU green at 72 % of its value.** Scaling every channel keeps the hue at **155°**
and the saturation at **98 %** and only lowers the value (68 % → 49 %), so it is the same green, not a drift
towards teal and not a BMW accent colour.

| Scale | Hex | Number on it (`#F4F6FA`) | (pure white) | Plate on black |
|---|---|---|---|---|
| × 1.00 (DSTU) | `#04AE67` | 2.68 | 2.89 | 7.26 |
| × 0.80 | `#038B52` | 4.03 | 4.36 | 4.82 |
| × 0.76 | `#03844E` | 4.40 | 4.76 | 4.41 |
| × 0.75 | `#03824D` | 4.51 | 4.88 | 4.30 |
| **× 0.72** | **`#037D4A`** | **4.81** | **5.20** | **4.04** |
| × 0.70 | `#037A48` | 5.00 | 5.41 | 3.88 |

Why 0.72 and not the 0.75 I suggested last time: `#03824D` clears 4.5 against *pure white* (4.88) but lands on
**4.51** against the number we actually draw, `#F4F6FA` — no margin at all. And the margin matters here:
`shared/hud_themes.js` and `docs/CAR-SNAPSHOT-2026-11-15.md` both record that **the car brightens dark tints**
(a navy backdrop came out light steel blue on 2026-11-05). A lifted plate means *less* contrast under the
number, so the value has to be chosen with headroom. `#037D4A` gives **4.81**, about 7 % of margin, and is the
lightest scale that does — so it stays as green-looking as the budget allows.

In the other direction, the plate still has to separate from the black panel: `#037D4A` is **4.04 : 1** against
black on its own, and the white frame around it is 18 : 1, so the shape is never in doubt. Going darker than
× 0.70 starts to trade that away for contrast the number does not need.

**Sun and night.** In bright sun the LCD's surface reflection adds a constant luminance, which compresses every
ratio — that argues for the *darkest* plate the shape can carry, so the tuned green is strictly better than the
standard one in sun. At night see §5; the tuned green needs no special treatment at all, which the standard one
did.

**One honest loss.** On the real signs the green plate is visibly brighter than the blue one, and that
luminance difference is part of how you tell them apart at speed. Darkening the green to 83/255 next to our
lifted blue at 81/255 removes it: the two plates now differ by hue (155° vs 206°, both near-fully saturated)
and by the letter, not by brightness. At 40 px, with `E` and `P`/`T` right there in the plate, that is a fair
trade — but it is a trade, and it would be undone by putting the blue back to `#005999` (see below).

#### The other four **[design, proposed — not changed]**

The owner approved adjusting E only, so these keep their current values until they say otherwise.

- **М / Н red `#E30013`** — **4.54 : 1**, i.e. it clears 4.5 by about 1 %. That is thinner than I would like,
  though red is less exposed to the car's dark-tint lift than the others (its red channel is 227, nowhere near
  the dark end of the curve). **Option, if the owner wants the same margin the green now has: `#D10011`**, the
  DSTU red at 92 % of its value — 5.22 : 1 under the number, 3.72 : 1 on black, still unmistakably the sign
  red. **Shipped default stays `#E30013`.**
- **Р / Т blue `#0B63A8`** — 5.77 : 1, comfortable. This is already a deviation: the DSTU `#005999` was lifted
  because at 2.89 : 1 against black it reads as a dark hole at 40 px. Worth noting the trade: **going back to
  `#005999` would raise the number contrast to 6.72 : 1 and restore the green-brighter-than-blue cue**, at the
  cost of the plate's own separation from black. Either is defensible; I kept the lift.
- **neutral `#5A616B`** — 5.78 : 1, comfortable, nothing to do.

`design/shields/preview.html` §2 shows the standard green beside ours, day and night, at the row's real scale,
with every one of these numbers recomputed in the page.

### 2.4 Where the row goes

**[owner's decision]** The road label **may run wider than BMW's 331 px street field rather than shrinking the
name.** So the group — shields, gaps, road name — is centred on x 960 and sized to its content; the name is not
condensed and does not ellipsis until it runs out of the budget below.

**[source]** The hard limit is the two big dials. `wb_comfort.json` puts them at centre (412, 380) and
(1508, 380) with radius 335 (`dl` / `dr` on the `wbback` widget). At the row's **top** edge, y 669, where the
circles are widest across the row, they reach x 581 and x 1339 — a **clear span of 757 px**. (Lower down it
only gets wider: 837 px at y 689, 970 px at y 709.)

**[design]** The working budget is **x 660 – 1260, 600 px**, centred on 960, which keeps a comfortable gap from
the dial rims. What that leaves for the name:

| Shields shown | Shields + gaps | Name room | ≈ characters at 30 px |
|---|---|---|---|
| `М-04` | 102 px | 498 px | ~32 |
| `М-04` + `E 50` | 190 px | 410 px | ~26 |
| `Т-17-19` + `E 50` (worst case) | 226 px | 374 px | ~24 |

Even the worst case leaves room for a name like `ВЕЛИКА БАГАЧКА`. If a name ever exceeds the budget it should
ellipsis at the end — the shields and the start of the name are the part that matters — but nothing here needs
the name to shrink.

---

## 3. The two renderings

Both draw **exactly the same pixels** — the preview measures it: *largest channel difference 0/255 over
black, 0 px over 8 of 155 220.* So the choice is about cost, not about looks.

### 3.1 A — text widget + drawn box (no new shader)

The plate is painted into an RGBA buffer in JS and goes up as an ordinary **image widget**; the number is an
ordinary **text widget** on top, the same way `WBSIGN` leaves the speed-limit figure to a text widget.

```
{ "id": "shield0", "type": "image", "z": 5, "x": 760, "y": 669, "w": 88, "h": 40, "conn": 1 }
{ "id": "shield0_n", "type": "text", "z": 6, "x": 760, "y": 674, "w": 88, "h": 34,
  "text": "{{shield0}}", "font": "wb_shield", "color": "fg", "align": "center", "conn": 1 }
```

The plate's coverage is the same rounded-box distance field the shader uses, so the two agree pixel for pixel:

```js
// px from the plate's top-left; rad = 6, b = 2
function sdBox(px, py, x, y, w, h, rad) {
    var hx = w * 0.5, hy = h * 0.5;
    var qx = Math.abs(px - (x + hx)) - (hx - rad);
    var qy = Math.abs(py - (y + hy)) - (hy - rad);
    var mx = Math.max(qx, 0), my = Math.max(qy, 0);
    return Math.sqrt(mx * mx + my * my) + Math.min(Math.max(qx, qy), 0) - rad;   // < 0 inside
}
var d = sdBox(x + 0.5, y + 0.5, ...);
var a = clamp01(0.5 - d);                       // coverage
var e = clamp01(d + b + 0.5);                   // 1 within the frame
rgb = mix(fill, line, e);  alpha = a;           // straight alpha, as cluster-render takes it
```

**Cost.** No new shader, **no new effect layer**: the plate is an image and can ride in an existing packed
sheet with the rest of the bottom row. Pixel memory is `w·h·8` bytes (`shared/hud.js`), so 88 × 40 = **28 KB**
and two shields ≈ 56 KB of the 16 MiB budget — nothing. A changed number repaints only the rectangle that
changed (`changes()` in `hud.js`), and a changed *category* repaints one 88 × 40 plate.

**Variant A2, if pixels are ever the problem:** the existing **`boxes`** effect widget already draws up to 12
rounded framed boxes with `border` and `radius` from the layout. It has one `fill` role for all of them
(`shared/shaders.js` BOXES, `shared/hud.js` widget list), so two shields of different colours need two `boxes`
layers — two of the eight layers per connection. A1 is cheaper; A2 is there if needed.

**Recommendation: A1.** Cheapest on every axis, and it is the only one that needs nothing new in
`shared/shaders.js` — which matters, see §3.2.

### 3.2 B — a small GLSL effect

One effect layer draws up to three plates; the numbers stay text widgets on top. Written for
`shared/shaders.js` house style but **not added to it** — the file is untouched on this branch.

```glsl
const SHIELD = `// Road-number shields for a cluster-render "effect" layer (GLSL ES 1.00), beside the road name in the
// bottom row: up to three rounded plates, each a u_edge frame u_style.x px wide round a field u_fill[i],
// corner radius u_style.y px. The numbers are text widgets on top, as the speed-limit figure sits over
// WBSIGN. Our own drawing, after the Ukrainian road-number signs of DSTU 4100:2021 (shape only).
//   u_rect[i]  x, y, w, h of plate i in layer px     u_fill[i]  its rgba, straight alpha
//   u_style    frame px, corner radius px, plates in use, unused.  Plates must not overlap.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec4 u_rect[3];
uniform vec4 u_fill[3];
uniform vec4 u_edge;
uniform vec4 u_style;

void main() {
    vec2 p = v_uv * u_size;
    vec4 c = vec4(0.0);
    for (int i = 0; i < 3; i++) {
        if (float(i) >= u_style.z) break;
        vec4 r = u_rect[i];
        vec2 hs = r.zw * 0.5;
        vec2 q = abs(p - (r.xy + hs)) - (hs - vec2(u_style.y));
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_style.y;   // < 0 inside
        float a = clamp(0.5 - d, 0.0, 1.0);
        if (a <= 0.0) continue;
        float edge = clamp(d + u_style.x + 0.5, 0.0, 1.0);                     // 1 within the frame
        vec4 col = mix(u_fill[i], u_edge, edge);
        c = vec4(col.rgb, col.a * a);
    }
    gl_FragColor = c;
}
`;
```

**Uniform budget** — counted the way `docs/CAR-SNAPSHOT-2026-11-15.md` counts them (vec4 slots declared in the
fragment source, samplers not counted):

| Uniform | Slots |
|---|---|
| `u_size` (vec2) | 1 |
| `u_rect[3]` | 3 |
| `u_fill[3]` | 3 |
| `u_edge` | 1 |
| `u_style` | 1 |
| **total** | **9** |

Against cluster-render's **32 per quad**, and against WBSIGN's 5 (0.7.10) → 8 (0.7.11) and WBBACK's 27.
**35 lines, 5 uniform declarations, one loop, no sampler.** It never leaves a `sampler2D` unbound, so the
RAMSES "unbound sampler → layer not drawn" trap does not apply.

**Caveat worth stating plainly.** `docs/CAR-SNAPSHOT-2026-11-15.md` records that on 2026-11-14 the KOMBI's
display service reset ~2.3 s after every 6WB scene was mapped, 13 times, and the only thing that had changed
was the shader code and uniform counts of WBDIAL / WBBACK / WBSIGN. 0.7.12 took those changes back out. Until
that is understood, **adding a new effect shader to a 6WB layout is the risky option and A1 is the safe one.**
B is specified here so it is ready, not because it should go first.

### 3.3 Side by side

`design/shields/preview.html` draws both at cluster scale on black, with a day/night switch and 1× / 2× / 4×
zoom. Column A is the JS pixel painter, column B runs the shader above for real in WebGL with the numbers as a
text layer over it, and a third strip shows the per-pixel difference between the two plate drawings
(currently 0).

---

## 4. Parsing the road label

### 4.1 What the repo actually shows

**Nothing.** I searched `shared/`, `apps/`, `kit/`, `bench/` and `docs/` for a current-road or street-name
signal and found only `de.bmw.infotainment.navigation.guiding.GuidanceEventList`, which `docs/POLISH-E-REPORT.md`
and `apps/f30_cluster/app.json` describe as upcoming **speed limits** on a guided route, read through a
`queryContent` method call, not a field. There is no record in the repo of the composed road label, its
separators, or its icon elements.

So **the structure described in the brief — text pieces, separators including a slash, and icons that carry
their own number text plus an unfetchable resource handle — is taken from the brief, not from the repo, and is
unverified here.** The rule below is written to be defensive about that.

### 4.2 The rule **[design]**

1. **Take the pieces as the car gives them.** For an icon element, use **its own number text** and ignore the
   resource handle. For a text element, split on the separators `/ · , ;` and on runs of whitespace around a
   `/`.
2. **Fold Cyrillic to Latin homoglyphs**, then uppercase. Every Ukrainian category letter has a Latin twin that
   is drawn identically, so nothing is lost:

   ```
   М→M  Н→H  Р→P  Т→T  Е→E  І→I   (and А→A В→B С→C К→K О→O Х→X for the fallback)
   ```

   This is what makes the Latin-only baked atlases enough. **[source]** Every font in
   `apps/f30_cluster/hud/fonts/` is Latin-only — I checked all 25: zero glyphs above U+0400. (Arimo itself
   *does* carry Cyrillic — `tools/fonts-src/Arimo[wght].ttf` has `М Н Р Т Е І` at gids 580/581/584/586/573/559
   — so baking them is possible later; the fold means it is not needed.)
3. **Classify each piece**, first match wins:

   | Pattern (after folding) | Shield | Drawn as |
   |---|---|---|
   | `^E[\s-]*(\d{1,3})$` | E | `E ` + digits |
   | `^M[\s-]*(\d{1,2})$` | М | `M-` + 2 digits, zero-padded |
   | `^H[\s-]*(\d{1,2})$` | Н | `H-` + 2 digits |
   | `^P[\s-]*(\d{1,2})$` | Р | `P-` + 2 digits |
   | `^T[\s-]*(\d{2})[\s-]*(\d{2})$` | Т | `T-nn-nn` |
   | `^[A-Z]{1,2}[\s-]?\d{1,4}$` | **neutral** | the piece verbatim, cut to 6 characters |
   | anything else | — | it is road-name text, not a shield |

   E before M matters: `E 50` must not fall through to anything else. The two-digit cap on М/Н/Р is from
   **[source]** uk.wikipedia (М-01…М-30, Н-01…Н-33, Р-01…Р-87); the three-digit cap on E covers E 373 / E 584
   and rejects nonsense like `E 1051`, which drops to the neutral shield.
4. **At most two shields are drawn**, in the order the car gave them (a road is typically "М-04 / E 50").
   Any further match folds back into the name text.
5. **If nothing matches, draw no shield** and show the whole label as the road name. A road with no number is
   the normal case in town.

Worked examples, run against the real implementation in the preview:

```
"М-04"         → М   "M-04"     (88 px)
"М 04"         → М   "M-04"
"M04"          → М   "M-04"
"Р50"          → Р   "P-50"     (82 px)
"Т-17-19"      → Т   "T-17-19"  (124 px)
"E50"          → E   "E 50"     (80 px)
"E105"         → E   "E 105"    (98 px)
"A7"           → neutral "A7"   (58 px)
"Хрещатик"     → name, no shield
"E 1051"       → neutral "E 1051"
```

### 4.3 The neutral fallback

**[design]** Anything that looks like a road number but is not one of the five categories gets the neutral
plate: `#5A616B` field, the same white frame and white number, same geometry. It exists so that a Polish `A4`,
a Moldovan `M14` or a map-data oddity still reads as a road number instead of being silently dropped or, worse,
coloured wrongly.

---

## 5. Night

**[source]** `shared/hud.js`: after sunset (or on "always"), `dimTheme(theme, NIGHT_DIM)` with
`NIGHT_DIM = 0.6` rebuilds the theme with **its whites and greys at 60 %** — it only touches a colour whose
`max(r,g,b) − min(r,g,b) < 40`. Saturated colours are left alone, and the change is applied **in place**
(`_nightLive`) when every layer can take new colours, without remaking a layer.

That has a sharp consequence for shields: **the frame and the number dim automatically, the coloured plate does
not.** Left alone, a night shield would be a full-strength red plate under a 60 %-dimmed number — the glare
goes up and the legibility goes down. So the plate needs night values of its own.

**[design] The rule: at night the plate fill is the day fill × 0.42, for every shield.** The frame and the
number just follow the theme (× 0.6), so nothing new is needed for them.

| | Day | Night | Number on the plate | Plate on black |
|---|---|---|---|---|
| М, Н | `#E30013` | `#5F0008` | 4.63 : 1 | 1.49 : 1 |
| Р, Т | `#0B63A8` | `#052A47` | 4.83 : 1 | 1.43 : 1 |
| E | `#037D4A` | `#01341F` | 4.56 : 1 | 1.51 : 1 |
| neutral | `#5A616B` | `#26292D` | 4.80 : 1 | 1.44 : 1 |
| frame | `line` `#ECF0F6` | `#8E9094` | — | 6.57 : 1 |
| number | `fg` `#F4F6FA` | `#929496` | — | 6.90 : 1 |

The hex values in the table are the authoritative ones; × 0.42 is how they were derived, not a formula to
re-run (125 × 0.42 = 52.5, and the green rounds down).

**One factor now covers all four.** In the first draft the E green needed its own × 0.30 while the rest took
× 0.42, because the standard green was too bright to begin with. Fixing the green by day (§2.3) removed the
exception: `#037D4A` × 0.42 lands on `#01341F`, which is *the same plate* the old `#04AE67` × 0.30 produced.
So the night look does not change at all — only the day one does — and the rule got simpler.

**How it reads.** At night the plate itself is only about 1.5 : 1 against the black panel; the **white frame at
6.6 : 1 is what carries the shape**, exactly as the coordinator supposed. That is deliberate, not a shortfall:
the plate is a colour cue, not an outline, and a dark plate with a bright frame is what stops a saturated
rectangle glaring in a dark cabin. The three hues stay distinguishable at that level (the night view in the
preview shows it), and on the car they will sit a little lighter still, since the panel brightens dark tints.

Three things this rule gets right:

- **Nothing glares.** The plate at 42 % is dimmer than the panel's dimmed greys, so the shield stops being the
  brightest object in a dark cabin.
- **The colour cue survives.** Red, blue and green stay distinguishable at 42 % — the preview's night view
  shows it.
- **No new uniforms, no shader change, no rebuild.** In rendering A the colour is picked in JS at paint time;
  in rendering B it already arrives as `u_fill[i]`, so night is a uniform message like any other and
  `_nightLive` applies it in place. This matters: **[source]** 0.7.11 added `nightLook()` and `u_nk0..2` to
  WBDIAL / WBBACK / WBSIGN and the KOMBI reset on every 6WB scene; 0.7.12 took them out
  (`docs/CAR-SNAPSHOT-2026-11-15.md`, `shared/shaders.js` line 1053). The shields must not repeat that.

**[design]** One thing deliberately *not* done: no glow, no halo, no gradient. The 6WB cluster themes all run
`glow: 0` (`shared/hud_themes.js`), and a glowing shield at night is exactly the "pasted sticker" look the
brief warns against.

---

## 6. Licensing

**[source]** The files read for this report are CC0 (`M04-UA.svg`) or public domain (`H08-UA.svg`,
`E50-UA.svg`, `E40-UA.svg`, the DSTU diagrams `UA road sign 5.61.1/5.61.2/5.63.svg`, the T-10-01 photograph);
`R04 Ukraine.png` and `T01-01-UA.png` are CC BY-SA 4.0 and were used only to note that they disagree with the
standard.

**No downloaded image is committed on this branch.** Everything above is geometry — rectangles, radii, hex
values and advances — and the preview redraws it from those numbers with a distance field and a system font.
The shields are our own drawing of a public road-sign design, as `WBSIGN` is our own drawing of a speed-limit
sign.

---

## 7. What is not settled

- **Н red** is from the Wikipedia shield set, not from DSTU or a photo (§1.3).
- **The composed road label** is described in the brief and is nowhere in the repo (§4.1). The parsing rule is
  written defensively but it has not been seen against real car data.
- **The two hues** — the darkened green `#037D4A` and the lifted blue `#0B63A8` — are judgements about a black
  LCD that the car has not confirmed. `docs/CAR-SNAPSHOT-2026-11-15.md` and the themes file both note the car
  brightens dark tints, which is why the green was given margin (§2.3); one photo of the panel would settle
  both, and both are one hex value each.
- **The red's 1 % margin** (§2.3) is open: proposed `#D10011`, shipped `#E30013`, awaiting the owner.
