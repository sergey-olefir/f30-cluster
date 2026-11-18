# Research round 3, package MT: every way to make f30_cluster's textures lighter

Branch `research3/mt` (worktree `.claude/worktrees/r3-mt`), not pushed, no version bump. Car offline: everything here was measured on the Mac. Bytes, pixel memory, texel values and shader sizes carry over to the car. Milliseconds do not, and no Mac millisecond is used to make a claim. The data is in `design/research3/mt/textures.json`. The tools are in `tools/research3/mt/`. Scratch files are in `bake/work/research3/MT/`, including the frames and the difference images, which stay out of git.

## 0. The answer in brief

- **The weight is two textures.** In 6WB Comfort, `speedo` and `tacho` are 670 x 670 RGBA8, 1 795 600 bytes each. Together they are 3.59 MB of the 5.98 MB that a Comfort build uploads, and 7.18 MB of its 11.96 MB of pixel memory. Comfort + G20 has the same pair under other names (`speedo_d`, `tacho_d`). Sport and Eco Pro use no dial texture at all. So every return to Comfort sends the 3.59 MB again. At the car's upload cap that is 1.75 s at the 2000 KB/s floor and 0.64 s at the 5500 KB/s ceiling, before any text sheet. **verified** (bench accounting, equal to the bench's own pixel count to the byte; MP's inventory agrees).
- **The car's cluster-render already accepts compressed textures.** Its own client 0.5.12, saved from the car on 2026-11-15, has `etc2rgba` and `etc2rgb` assets. Upstream added them on 2026-11-12 (commit 82b8ab7). An ETC2 texture costs 1 byte a pixel (`etc2rgba`) or ½ byte (`etc2rgb`). The service charges it to pixel memory **once**, not twice. Our vendored client predates this, and our engine has never used it. **verified** (the client file and the protocol text). Whether **our KOMBI** draws an `etc2rgb` texture is **a hypothesis**: upstream drew `etc2rgba` on an iDrive 7 cluster up to 2048², and says `etc2rgb` "has not been tried on a car".
- **The dial textures need no alpha.** Every 6WB shader mixes them over a black face. So each one is exactly its premultiplied colour, opaque, and the alpha channel is dead weight. A premultiplied copy renders identically (max 0.5 / 255, rounding). That makes the 8:1 `etc2rgb` usable for the dials, the minis and the window. **verified** (replay of the real shaders).
- **Three packages (§5).** "Safe" means R8 only, formats the car already draws. It halves a Comfort build (5.98 MB to 2.98 MB, pixel memory 11.96 MB to 5.97 MB) and is visually near-lossless except at the rev counter's red-zone edges. "Best trade" is ETC2 plus keeping every theme's textures resident. It cuts Comfort to 2.23 MB and 3.95 MB of pixel memory, and **no switch sends a scene texture again**: Sport to Comfort drops from 5.75 MB to 1.59 MB of text sheets only. "Everything" adds a little to that. Past that point the text sheets (1.59 MB in Comfort, 2.79 MB in Comfort + G20) are the weight, and they are not textures (MP's report).
- **Prototypes on the branch, off by default.** `app.json config.sceneTex` is `"r8"` (A) or `"etc2"` (B). Both pass on the bench, and their measured pixel memory is exactly the predicted one (§6).

## 1. Method

| step | tool (on the branch) | what it does |
|---|---|---|
| inventory | `tools/research3/mt/inventory.py` | every file in `hud/scene`: size, format, bytes, package bytes, zlib / PNG, entropy, alpha (empty / opaque / soft), colour (constant, chroma, best single tint), mirror and radial symmetry, texture-space error of every encoding |
| states | `tools/research3/mt/snapshots.py` | one bench on port 8302 (bounded to 20 min). The real app is driven into 9 states (Comfort day / night / map up / glass foot / no-overtaking sign, Comfort + G20 with our row and with BMW's, Sport, Eco Pro) with the shots gallery's drivers, and each state is frozen: every layer, shader, uniform, bind and asset pixel |
| accounting | `tools/research3/mt/accounting.py` | per state: every asset and image sheet, named by content. Bytes per upload, pixel memory (uncompressed ×2, ETC2 ×1), seconds at 2000 and 5500 KB/s. Every switch between two themes: what the engine drops and sends again |
| options | `tools/research3/mt/experiments.py` | each state replayed twice with package O's renderer (`tools/strip/O/render.py`: the app's real fragment shaders through moderngl, stacked as the bench page stacks them). The second run has the textures replaced by a variant, with the shader edited where the variant needs it. The frame difference is taken over the whole 1920 × 720 panel, on premultiplied colour and coverage in 0..255. Each result gives the max, the pixels over 2 / 8 / 16, and the PSNR inside the layers' box |
| packages | `tools/research3/mt/packages.py` | the three packages totalled per state and per switch, with residency and the "goes whole" re-send |
| prototypes | `tools/research3/mt/bake_variants.py`, `prototypes.py`, `bench/test-scene-tex.js` | the variant files, the engine's own frames with `config.sceneTex` on against today's frames, and the test |
| ETC2 | `bench/etc2.js`, `tools/research3/mt/test_etc2.py` | a bench decoder for ETC2. It matches texture2ddecoder texel for texel on all 34 textures × 2 formats and on random blocks covering every mode (36 cases, 0 differences) |

Encoder: etcpak (BSD, via uv). The upstream encoder (`tools/etc2_test/etc2_encode.py`, GPL) was downloaded to `bake/work/research3/MT/upstream/` for reading only. Running it was not permitted in this session, so it was not compared. A better encoder can only lower the ETC2 errors below.

Spread: the bench byte and pixel counts are deterministic. Three runs of the bench (baseline snapshots, test-scene-tex off, MP's three runs) gave identical numbers. The replay is deterministic (package O / shots `check.py`). The only moving content between two snapshots is the clock minute, which `prototypes.py` masks.

## 2. The inventory

`bytes` is one whole upload, which is what cluster-render charges to the KOMBI link's budget. `pm` is cluster-render's pixel memory. `pkg` is the package file (JSON with base64). The `empty / opaque` column gives the % of texels with alpha 0 / 255. `colour` is the constant colour, or the 99th percentile of chroma (max − min channel). The last two columns give the % of visible texels within 4 / 255 of their mirror image and of a 1-D radial profile.

| texture | size | fmt | bytes | pm | pkg | zlib | where it is sampled (when) | empty / opaque | colour | mirror | radial |
|---|---|---|---|---|---|---|---|---|---|---|---|
| speedo | 670×670 | rgba8 | 1 795 600 | 3 591 200 | 2 394 168 | 348 055 | Comfort WBDIAL `u_base`, kind 3: the whole static dial | 19.7 / 77.5 | p99 13 | 90.6 | 44.0 |
| tacho | 670×670 | rgba8 | 1 795 600 | 3 591 200 | 2 394 168 | 357 623 | Comfort WBDIAL `u_base` | 19.1 / 73.0 | p99 27 (red zone) | 46.1 | 35.8 |
| speedo_d / tacho_d | 670×670 | rgba8 | 1 795 600 each | 3 591 200 each | 2 394 168 each | 342–351 k | Comfort + G20 WBDIAL `u_base` | as above | as above | | |
| window | 320×286 | rgba8 | 366 080 | 732 160 | 488 140 | 30 844 | Comfort WBBACK `u_t0`, only while BMW's map is not in the window | 24.3 / 71.2 | p99 22 | 100 | – |
| range_seg / ed_seg | 346×68 / 346×70 | rgba8 | 94 112 / 96 880 | 188 224 / 193 760 | 125–129 k | 5–6 k | Comfort WBDIAL `u_deco` (fuel / consumption arc) | 82–84 / 6–7 | constant white: alpha only | | |
| fuel / oil | 144×144 | rgba8 | 82 944 each | 165 888 each | 110 624 each | 16 k | WBDIAL `u_base` (mini) in all four themes | 21.7 / 63.0 | p99 21 / 164 | 66.7 | 38.6 / 43.3 |
| sign_limit / sign_nopass | 88×89 | rgba8 | 31 328 each | 62 656 each | 41 802 each | 3.4 / 4.5 k | WBSIGN `u_s0` / `u_s1` (Comfort, G20, Sport) | 27.8 / 68.4 | p99 207 (red ring) | 90.8 / 77.1 | |
| horizon | 424×10 | rgba8 | 16 960 | 33 920 | 22 647 | 1 618 | Comfort WBBACK `u_t1` (map not shown) | 10.8 / 77.8 | p99 11 | 100 | |
| collar_r8 | 480×180 | r8 | 86 400 | 172 800 | 115 323 | 4 851 | Comfort + G20 WBBACK `u_t0` | 86.0 / 7.8 | – | | |
| strip_mask | 1908×353 | r8 nearest | 673 524 | 1 347 048 | 898 359 | 4 621 | Comfort + G20 WBBACK `u_t2` (strip lanes) | 39.1 / 59.6 | – | | |
| bar | 584×79 | rgba8 | 184 544 | 369 088 | 246 091 | 9 542 | WBBACK `u_t2`, **only with the "glass" foot**: the layouts ship "hair", so it is never uploaded | 86.0 / 0 | p99 12 | | |
| collar | 480×180 | rgba8 | 345 600 | – | 460 832 | 8 095 | **nothing** since package M (collar_r8) | | constant black | | |
| cover | 736×64 | rgba8 | 188 416 | – | 251 255 | 417 | **nothing** since package M (strip mask) | | constant black | | |

Facts that decide the options. All are **verified** on the files and the shaders:

- Every 6WB dial shader computes `col = mix(u_face, bs.rgb, bs.a)` with `u_face` = black in all three themes, and the minis use `mix(vec3(0), …)`. WBBACK draws the window over black too, and the layer's coverage comes from the shader (`edge`), not from the texture. **So for speedo, tacho, speedo_d, tacho_d, fuel, oil and window, the texture's alpha carries nothing that premultiplying does not.** The premultiplied opaque copy differs from today's frame by at most 0.5 / 255 (`premul-*` in `experiments.json`).
- range_seg and ed_seg are pure white with a soft alpha, so an R8 coverage holds them exactly. collar and cover are pure black: also alpha only, and both are unused.
- speedo and speedo_d are 98.9 % identical. They differ only in the bottom-arc box [154, 558, 516, 639], 6.5 % of the area. tacho / tacho_d: 98.8 %, box [124, 542, 519, 637].
- fuel ≈ oil mirrored: 96.3 % of texels within 4 / 255, apart from the pictograms.
- The dials are not radial: only 36–44 % of texels sit within 4 / 255 of a radial profile, because of the light from the upper left, the ticks and the red zone. speedo is 90.6 % mirror-symmetric and tacho 46 %.
- Package files: 12.6 MB of base64 JSON on disk, 1.52 MB as zlib. Reading and decoding them costs 13.8 ms on the Mac's Node 22, against 1.8 ms for raw bytes and 12.3 ms for zlib (`load_cost.js`, 7 runs, spread 12.8–14.4 ms). This touches only the app's start and the Store download, never the KOMBI link.

## 3. Where the bytes go today (bench, 0.7.20)

| state | layers | scene textures | text sheets | total upload | at 2000 / 5500 KB/s | pixel memory |
|---|---|---|---|---|---|---|
| 6WB Comfort | 21 | 4 393 776 (10) | 1 588 200 (14) | 5 981 980 | 2.92 / 1.06 s | 11 963 960 |
| Comfort, BMW's map in the window | 21 | 4 010 736 | 1 588 200 | 5 598 940 | 2.73 / 0.99 s | 11 197 880 |
| Comfort + G20 (our row) | 19 | 4 579 668 | 2 787 988 | 7 367 660 | 3.60 / 1.31 s | 14 735 320 |
| 6WB Sport | 18 | 228 544 | 796 488 + glyph atlas 76 544 | 1 101 580 | 0.54 / 0.20 s | 2 203 160 |
| 6WB Eco Pro | 15 | 165 888 | 1 063 888 | 1 229 780 | 0.60 / 0.22 s | 2 459 560 |

Switches without a restart. Every layer is re-made. A scene texture survives only when the new layout samples it on the same connection (`hud.js _rebuild`).

| switch | bytes sent | of which scene textures | at 2000 / 5500 KB/s |
|---|---|---|---|
| Sport or Eco → Comfort | 5 753 432 / 5 816 088 | 4 165 232 / 4 227 888 | 2.81 / 1.02 s |
| any → Comfort + G20 | 7 139 112 | 4 351 124 | 3.49 / 1.27 s |
| Comfort → Sport / Eco | 873 032 / 1 063 888 | 0 | 0.43 / 0.52 s |
| G20 toggle on → off (Comfort) | 5 753 432 | 4 165 232 | 2.81 / 1.02 s |

There is also a re-send that is not a switch. The car's cluster-render log (2026-11-14) shows `target panel: its scene goes whole to the renderer again: 5561 KB charged to the upload budget` each time the KOMBI maps our content (23 + 39 times in the two saved logs). On today's Comfort that is the 5.98 MB above, every time (**verified** in the log; the number of maps per drive is the car's to tell). The panel shares the budget with BMW's map video. The same log shows the map target writing about 5.3 MB/s, with "budget holds" on both targets.

## 4. The options, measured

All frame numbers are from `experiments.json`, for the state named, against today's frame of the same state. "max" is the largest difference of a panel pixel in 0..255. ">16" is the number of panel pixels that differ by more than 16 / 255, the threshold where a difference starts to be visible on an edge. PSNR is inside the sampling layers' box.

### 4.1 Format

| option | texture(s) | bytes → | pm → | max | >8 px | >16 px | PSNR | verdict |
|---|---|---|---|---|---|---|---|---|
| R8 coverage (`a8`) | range_seg + ed_seg | 190 992 → 47 748 | 381 984 → 95 496 | 0 | 0 | 0 | ∞ | lossless |
| R8 × one tint | window | 366 080 → 91 520 | 732 160 → 183 040 | 2.7 | 0 | 0 | 66.7 | near-lossless |
| R8 × one tint | speedo | 1 795 600 → 448 900 | 3 591 200 → 897 800 | 18.9 | 533 | 152 | 44.3 | loses the cool blue of the inner rings |
| R8 × one tint | tacho | same | same | 144.6 | 7 207 | 1 721 | 36.8 | **refuted**: the red zone turns grey |
| R8 × two tints (red where the shader knows the zone is) | tacho | same | same | 109.8 | 7 736 | 2 320 | 37.3 | **refuted**: white ticks over the red get tinted |
| R8 value + colour at ¼ (chroma subsampling, `v8`) | speedo | 1 795 600 → 561 796 | → 1 123 592 | 17.1 | 291 | **2** | 55.1 | near-lossless |
| same | tacho | → 561 796 | → 1 123 592 | 104.2 | 3 269 | 912 | 47.6 | faint pink at the red-zone corners of the ticks |
| same, colour at ½ | tacho | → 897 800 | → 1 795 600 | 74.7 | 1 367 | 247 | 51.8 | better, half the saving |
| same, colour at ⅛ | speedo / tacho | → 477 124 | → 954 248 | 24.2 / 108.5 | 1 192 / 6 454 | 189 / 3 038 | 51.5 / 43.3 | too soft for the tacho |
| same, ¼ | fuel / oil | 82 944 → 25 920 | → 51 840 | 38.7 / 63.9 | 244 / 274 | 64 / 90 | 46.5 / 45.0 | pictogram edges |
| premultiplied, opaque (RGBA8) | dials, minis, window | unchanged | unchanged | 0.5 | 0 | 0 | 74–89 | the identity behind `etc2rgb` |

In "R8 value + colour", the value is the largest channel of the premultiplied colour, at full size. The colour is the colour divided by the value, averaged and weighted by value, at ¼ the size, in RGBA8. The shader computes `value × colour`. This is the luma-plus-tint technique Twin Dial uses, generalised so that the tint varies across the face. It needs one more sampler per dial (`u_baseC`) and 129 bytes more shader (WBDIAL Comfort 13 267 → 13 396). RG8 does not exist in the protocol (`rgba8`, `r8`, `etc2rgba`, `etc2rgb` only), and neither do fewer bits per channel.

### 4.2 Channel packing and merging

These are not measured as frames: they are lossless by construction, and the bytes are arithmetic.

- Several R8 maps in one RGBA8 asset cost **the same bytes** as separate R8 assets of the same size, and more when the maps differ in size, because they pad to the largest. For example, range_seg, ed_seg, horizon (as R8 × tint) and collar packed as the four channels of one 480 × 180 RGBA8 cost 345 600 bytes, against 138 388 as four R8 assets of their own sizes. Packing saves only **asset count and samplers**. A client may hold 16 assets and all clients together 32. Prototype A uses 13 on connection 1 in Comfort (today: 9), so packing becomes worth it only if a later layout runs out of assets.
- Sampler rule: every sampler must be bound. Packing fewer textures into one sampler can only lower the count of samplers to bind. `_bindBlanks` already gives every unused sampler a 1 × 1 blank, and prototype A binds `u_baseC` explicitly (the test checks that every sampler is bound in every layout).
- The two sign textures in one 176 × 89 atlas: 62 656 bytes either way. One asset fewer, no bytes saved.

### 4.3 Resolution (each texture at ½ and ¼, sampled bilinear in the same box)

| texture | ½: bytes, max / >16 px / PSNR | ¼: bytes, max / >16 px / PSNR | verdict |
|---|---|---|---|
| speedo | 448 900; 96 / 11 699 / 33.8 | 112 896; 150 / 27 929 / 28.0 | **refuted**: every tick and the bezel blur (crop in `bake/work/research3/MT/z_scale0.5-speedo.png`) |
| tacho | 448 900; 122 / 15 345 / 32.7 | 112 896; 174 / 28 542 / 27.1 | **refuted** |
| window (already ½ of the panel) | 91 520; 11.5 / 0 / 57.2 | 23 040; 26 / 1 864 / 49.0 | ½ again is acceptable: soft content |
| horizon | 4 240; 14 / 0 / 60.3 | 848; 24 / 723 / 54.0 | ½ acceptable, but it is 17 KB |
| range_seg | 23 528; 81 / 2 599 / 40.5 | 5 848; 121 / 3 964 / 34.6 | **refuted**: the segment gaps close |
| fuel / oil | 20 736; 129 / 1 606 / 27.5 | | **refuted** |
| signs | 7 744; 95–132 / 1 287–1 940 | | **refuted** |
| collar_r8 | 21 600; 87 / 3 317 / 48.8 | | edges of BMW's dials show |

ed_seg shows 0 in every variant only because the consumption arc is unlit in the baseline state (`u_fill` 0..0). It has the same shape as range_seg, so read range_seg's row.

### 4.4 Symmetry and reuse

- **Comfort and Comfort + G20 share one dial texture.** speedo = speedo_d with a 362 × 81 box replaced (tacho: 395 × 95). Comfort would sample the shared `_d` texture plus a patch, which costs one more sampler. The G20 toggle would then stop re-sending 3.59 MB (today 4.17–4.35 MB of scene textures per toggle) and send only the two patches, about 117 + 150 KB as RGBA8 or 15 + 19 KB as `etc2rgb`. Lossless. **verified** on the files. Not built: it needs a third sampler in WBDIAL.
- **Mirrored halves:** speedo is 90.6 % mirror-symmetric, tacho 46 %. Half a speedo plus a patch for the other 9.4 % is more code than ETC2 and saves less. **refuted** as worth doing.
- **Radial profile:** only 36–44 % of texels are radial. **refuted.**
- **fuel / oil:** one mirrored texture plus the two pictograms would save about 83 KB in total. Small.
- **Between themes:** Sport and Eco Pro sample no dial texture, so there is nothing to share. The real lever is **keeping** Comfort's textures resident while Sport or Eco shows. Today that is impossible: all four themes' scene textures need 17.5 MB of pixel memory, more than the 16 MiB for every app together. After A (6.6 MB) or B (2.7 MB) it fits beside any layout (`packages.json` `resident_all_themes`). A switch back to Comfort then sends only text sheets.

### 4.5 Procedural replacement

- `proc-dials`: the dials without their baked base, drawn by WBDIAL's own Comfort code (kind 0). The frame differs by up to 252, with 130 136 px over 16 and PSNR 21.6. That is a different look, which is why the dials were baked. **refuted** as a replacement. `proc-window`: 66 154 px over 16, PSNR 29.1. **refuted.**
- The inverse matters for the KOMBI. The baked Comfort WBDIAL still compiles its whole procedural branch, 4 386 of its 13 267 bytes (the `u_hasBase < 2.5` side, dead code in every 6WB Comfort build). WBBACK carries a dead 1 493-byte procedural branch. Compiling the baked look without them would save a third of WBDIAL's source. Whether that matters to the KOMBI's shader limit is a **hypothesis** (memory note `kombi-shader-size`; MP measures the shaders).
- Exactly drawable: the segment arcs (range_seg / ed_seg are 346 × 68 arcs of minor segments), the horizon, and the sign's red ring. Together they are 47 748 bytes once R8, and replacing them with shader code is not worth the shader bytes.

### 4.6 Compression

- **What the protocol accepts:** `rgba8`, `r8`, `etc2rgba` (EAC alpha + ETC2 colour, 16 bytes per 4 × 4 block), `etc2rgb` (8 bytes per block, opaque). ETC2 constraints: w and h multiples of 4, no rects, sent whole and only once (a changed ETC2 texture is a new asset), charged to pixel memory once. There is no zlib, PNG, palette or other compressed transfer. Sources: upstream `PROTOCOL.md` (read, saved to `bake/work/research3/MT/upstream/`), and the car's own `cluster_render_client-0.5.12.js` in `reference/car/2026-11-15/cluster-render/`. The car runs `cluster-render-idrive7`.
- **What the wire costs today:** app → service is a local Unix socket with binary frames (u32 length, 'F', u32 ref, u64 id, u16 rect count, raw pixels). There is no JSON and no base64 on the socket. The base64 JSON exists only in our package, so a denser encoding on our side (zlib: 12.6 MB → 1.52 MB) shrinks the download and the app's start, not the KOMBI link. The link (service → KOMBI) is charged in the texture's own bytes, so **only the format lowers it.**
- **ETC2 on our textures** (etcpak):

| texture | format | bytes → | pm → | max | >8 px | >16 px | PSNR |
|---|---|---|---|---|---|---|---|
| speedo | etc2rgb, premultiplied | 1 795 600 → 225 792 | 3 591 200 → 225 792 | 69 | 10 444 | 2 609 | 41.8 |
| speedo | etc2rgba, straight | → 451 584 | → 451 584 | 69 | 10 312 | 2 565 | 41.9 |
| tacho | etc2rgb, premultiplied | → 225 792 | → 225 792 | 130 | 11 620 | 2 979 | 41.4 |
| window | etc2rgb, premultiplied | 366 080 → 46 080 | 732 160 → 46 080 | 15 | 702 | 0 | 51.5 |
| fuel / oil | etc2rgb | 82 944 → 10 368 | → 10 368 | 93 / 108 | 802 / 962 | 243 / 385 | 38.5 / 37.3 |
| horizon | etc2rgba | 16 960 → 5 088 | → 5 088 | 7 | 0 | 0 | 68.8 |
| range_seg | etc2rgba | 94 112 → 23 664 | → 23 664 | 20.6 | 248 | 12 | 58.3 (R8 is lossless and smaller per pixel of pm: use R8) |
| signs | etc2rgba | 31 328 → 8 096 | → 8 096 | 92 | 778–1 187 | 579–803 | 34.9–36.4 (red ring edges) |
| collar_r8 | etc2rgba | 86 400 → 86 400 | 172 800 → 86 400 | 15.5 | 251 | 0 | 66.0 |
| strip_mask | etc2rgba | 673 524 → 679 248 | 1 347 048 → 679 248 | 2 | 0 | 0 | 80.9 (bytes unchanged; pixel memory halved) |

What ETC2 does to a dial: block-shaped colour error along the ticks' edges, visible at 3× zoom and mostly invisible at 1× (crops in `bake/work/research3/MT/z_etc2rgb-*.png`). On the tacho it is strongest at the red zone's corners. Premultiplying costs nothing in quality: `etc2rgb` premultiplied and `etc2rgba` straight are equal to within 1 % in every count, at half the bytes.

### 4.7 Upload strategy

- **What the driver needs first.** A layer that samples an asset stalls until the asset has pixels (PROTOCOL.md), and our client sends assets and images in the order they were made. Comfort makes the backdrop's window first, then the dials. At 2000 KB/s the dials appear only after about 2 s. Making the dials first would show the needles earlier, but the frame stays incomplete for the same total time. That does not lower the weight, so it was not prototyped.
- **Lazy upload of what is not visible:** this is already done. The window and horizon are not uploaded while BMW's map fills the window (383 040 bytes; state `comfort-map`), and the glass line `bar` is never uploaded with the shipped "hair" foot (184 544 bytes).
- **Preloading the next theme while idle:** Sport and Eco have no texture of their own beyond fuel, oil and the signs, which they already share with Comfort, so there is nothing to preload. Their text sheets are layers and cannot be made unseen. The one preload that pays is Comfort's dials while Sport or Eco shows, which is the residency of §4.4.
- **Dirty-rect instead of whole re-sends:** the scene textures never change once made, so there is nothing to gain. ETC2 textures cannot take rects anyway.
- **Caching across layout switches within 16 MiB**, by peak. Today the engine drops the old layout's unused scene textures before making the new ones, which keeps the peak at the larger layout's (G20 14.7 MB). Keeping all four themes' textures needs 17.5 MB: impossible today, 6.6 MB with A, 2.7 MB with B, 1.4 MB with C.
- **Cost of residency (hypothesis):** cluster-render writes every asset of a target into each new scene ("goes whole"). Kept textures would therefore travel on every KOMBI map too. With B that is 1.86 MB of resident textures, so Comfort's whole-scene re-send is 3.45 MB (1.68 s at the floor) instead of 2.23 MB (1.09 s). It is still far below today's 5.98 MB (2.92 s). The car's log will tell whether the service writes unsampled assets.

## 5. The three packages

Bytes and pixel memory come from the bench's own scene with each package's textures in place (`packages.py`). The picture column is the rendered difference of the whole package in Comfort (`pkg-*`). Times are at the upload floor / ceiling.

| | today | **A: safe and cheap** | **B: the best trade** | **C: everything** |
|---|---|---|---|---|
| what | RGBA8 everywhere | R8 coverage (segments), R8 × tint (window), R8 value + ¼ colour (the six dial textures). Formats the car already draws | the dials, minis and window premultiplied `etc2rgb`; segments R8; every theme's textures kept resident | B + horizon and signs `etc2rgba`; the G20 masks `etc2rgba` (pixel memory once); Comfort and Comfort + G20 share one dial texture + patch |
| Comfort upload | 5 981 980 (2.92 / 1.06 s) | 2 982 520 (1.46 / 0.53 s) | 2 233 968 (1.09 / 0.40 s) | 2 209 928 (1.08 / 0.39 s) |
| Comfort + G20 upload | 7 367 660 (3.60 / 1.31 s) | 4 786 004 (2.34 / 0.85 s) | 4 082 892 (1.99 / 0.72 s) | 4 042 152 (1.97 / 0.72 s) |
| Comfort pixel memory | 11 963 960 | 5 965 040 (bench: same) | 3 949 536 (bench: same) | 3 845 880 |
| Comfort + G20 pixel memory | 14 735 320 | 9 572 008 | 7 693 464 | 6 830 144 |
| Sport / Eco → Comfort | 5 753 432 (2.81 / 1.02 s) | 2 868 020 (1.40 / 0.51 s) | **1 588 204 (0.78 / 0.28 s)**: text sheets only | 1 588 204 |
| → Comfort + G20 | 7 139 112 (3.49 / 1.27 s) | 4 671 504 (2.28 / 0.83 s) | 2 787 992 (1.36 / 0.50 s) | 2 787 992 |
| Comfort → Sport / Eco | 873 032 / 1 063 888 | same (no textures there) | same | same |
| whole scene on each KOMBI map, Comfort | 5.98 MB (2.92 s) | 2.98 MB (1.46 s) | 3.44 MB (1.68 s) with residency, 2.23 MB without | 2.97 MB (1.45 s) |
| picture, Comfort (frame vs today) | – | max 104, 1 068 px > 16, PSNR 51.1 (the engine's own frame, §6: max 101, 1 329 px). Speedo near-lossless (2 px); the faults are at the tacho's red-zone corners | max 130, 6 794 px > 16, PSNR 42.2 (engine: 6 207 px): ETC2 block error along the ticks | same as B; signs + 1 400 px |
| risk | – | low: R8 and RGBA8 are drawn on the car today (Twin Dial, strip mask). WBDIAL +129 B, WBBACK +53 B of shader. 13 of 16 assets on connection 1 | **etc2rgb never drawn on a car** (upstream drew etc2rgba on an iDrive 7 cluster). Fallback `etc2rgba`: twice B's bytes, same picture. Residency adds to each KOMBI map's re-send | B's, plus a third sampler in WBDIAL and a patch bake |
| work | done on the branch (prototype A) | done on the branch (prototype B; residency not built: about 20 lines in `_rebuild`'s drop loops, guarded by the 16 MiB sum) | about a day more: patch bake, sampler, G20 masks as `etc2rgba` |

**Gains combine:** A's colour map and B's ETC2 are alternatives for the dials, not additive. Moving the tacho alone to colour at ½ (`r8c2`) brings A's tacho to 247 px over 16 for +336 KB.

**Not textures, but what remains:** after B, the text sheets are 71 % of a Comfort build (1.59 of 2.23 MB) and 68 % of Comfort + G20 (2.79 of 4.08 MB). They are layers, so they are re-made on every switch. Twin Dial draws its text from glyph atlases (MP-REPORT).

## 6. The prototypes (branch `research3/mt`, off by default)

`app.json config.sceneTex` is absent in the shipped config, which means off: the files, shaders and uploads are exactly today's (the test checks the shaders byte for byte and the pixel memory to the byte). It takes two values:

- `"r8"` (A): `hud/scene/<name>@r8.json`, plus `<name>@r8c.json` for each dial's colour. `range_seg@r8` and `ed_seg@r8` are R8 coverage (`enc a8`). `window@r8` is R8 with a `tint`. speedo, tacho, speedo_d, tacho_d, fuel and oil are R8 value plus colour at 168 × 168 or 36 × 36 (`enc v8`).
- `"etc2"` (B): `hud/scene/<name>@etc2.json`, `etc2rgb` premultiplied, padded to whole blocks (`src` gives the size before padding). The segments use their `@r8` file.

Engine: `shared/hud.js` `_sceneSrc` / `_sceneFs` and the `_scene` formats. The box uniforms grow by the padding. `_sceneNeeds` keeps a value's colour texture across rebuilds. `shared/shaders.js` `sceneTex()` makes exact edits of the sampling lines, and each anchor must be present exactly once or it throws. `shared/cluster_render_client.js` accepts `etc2rgba` / `etc2rgb` assets as the car's client 0.5.12 does. The bench (`bench/server.js` + `bench/etc2.js`) accepts ETC2 assets, decodes them for the page, charges them once, and refuses rects or a second frame. Bake: `tools/research3/mt/bake_variants.py` (re-encodes today's pixels; nothing is re-rendered). Package size: +4.55 MB of files (to be pruned to the chosen mode before any release).

Bench, measured with the real app (`bench/test-scene-tex.js`, 54 checks):

| | Comfort pm | Sport pm | Comfort + G20 pm | Comfort again |
|---|---|---|---|---|
| off | 11 963 960 | 2 203 160 | 11 701 432 (BMW's row) | 11 963 960 |
| `"r8"` | 5 965 040 | 1 975 064 | 6 538 120 | 5 965 040 |
| `"etc2"` | 3 949 536 | 1 892 120 | 4 659 576 | 3 949 536 |

The engine's own frames against today's, replayed from bench snapshots of the same states (`tools/research3/mt/prototypes.py`; the clock box is masked; needle and fill angles are aligned to the base snapshot, and were already equal). Bytes are the state's asset uploads; text sheets are unchanged by both.

| state | `"r8"`: assets bytes, pm | max / >8 / >16 px / PSNR | `"etc2"`: assets bytes, pm | max / >8 / >16 px / PSNR |
|---|---|---|---|---|
| Comfort | 4 393 780 → 1 394 320; 11 963 960 → 5 965 040 | 100.7 / 4 172 / 1 329 / 50.5 | → 645 768; → 3 949 536 | 130 / 24 479 / 6 207 / 42.5 |
| Comfort, map in the window | 4 010 740 → 1 285 840; → 5 748 080 | 100.7 / 4 172 / 1 329 / 50.6 | → 582 728; → 3 869 536 | 130 / 23 777 / 6 207 / 43.1 |
| Comfort, night colours | as Comfort | 100.7 / 4 172 / 1 329 / 50.5 | as Comfort | 130 / 24 479 / 6 207 / 42.5 |
| Comfort + G20 (our row) | 4 579 672 → 1 998 016; 14 735 320 → 9 572 008 | 100.7 / 3 789 / 1 239 / 50.9 | → 1 294 904; → 7 693 464 | 130 / 20 033 / 5 287 / 43.7 |
| Comfort + G20 (BMW's row) | 4 517 016 → 1 935 360; 11 701 432 → 6 538 120 | 100.7 / 3 789 / 1 239 / 50.9 | → 1 232 248; → 4 659 576 | 130 / 20 031 / 5 287 / 43.7 |
| Sport | 305 092 → 191 044; 2 203 160 → 1 975 064 | 63.9 / 518 / 154 / 61.1 | → 159 940; → 1 892 120 | 108 / 1 764 / 628 / 53.3 |
| Eco Pro | 165 892 → 51 844; 2 459 560 → 2 231 464 | 63.9 / 518 / 154 / 61.1 | → 20 740; → 2 148 520 | 108 / 1 764 / 628 / 53.3 |

Where the difference is: `"r8"` along the rev counter's red-zone corners and faintly on the tick edges (the speedometer alone: 2 px over 16 in the replay of §4.1); `"etc2"` as block error along every tick edge, strongest on the tacho's red zone and the minis' pictograms. Frames: `bake/work/research3/MT/proto/{today,r8,etc2}__<state>.png` and `*.diff.png` (×8); side by side: `bake/work/research3/MT/cmp_comfort.png`.

Suites with both prototypes on the branch (each runs with `sceneTex` off, the shipped state): test-scene-tex 54, bottom-row 254, native-ui 47, strip-mask 40, fonts 34, probes 25, daynight 24, night 48; twin-bake 35, twin-budget 75, twin-cc 149, twin-fonts 219, twin-layout 61, twin-pages 100, twin-probe 110, twin-sim 39 — all passed, the same counts as on `main` before the change (`tools/research3/mt/run_suites.sh`, logs in `bake/work/research3/MT/suites-{main,proto}/`).

## 7. Verified, hypothesis, refuted

**Verified (Mac, bench, files):**
- speedo + tacho are 60 % of a Comfort build's upload and pixel memory. Every return to Comfort or to Comfort + G20 re-sends 4.17–4.35 MB of scene textures (§3).
- The car's cluster-render client (0.5.12) has ETC2 assets. Our vendored client does not, and our engine never used them.
- The dial, mini and window textures need no alpha: the premultiplied copy renders within 0.5 / 255.
- R8 coverage for the segments is lossless. R8 × tint for the window is within 2.7 / 255. R8 value + ¼ colour is near-lossless for the speedometer (2 px > 16).
- Half or quarter resolution of the dials blurs every tick (§4.3).
- The bench's pixel memory with prototype A and B equals the package arithmetic to the byte.
- `bench/etc2.js` decodes exactly what the reference decoder decodes (36 / 36 cases).
- collar.json and cover.json (712 KB of package) are sampled by nothing. bar.json is uploaded only with the "glass" foot.

**Hypothesis (needs the car):**
- The KOMBI draws `etc2rgb` (prototype B) on the panel target. If it does not, `etc2rgba` (upstream-tested on an iDrive 7 cluster) is the fallback at twice the bytes.
- The 129 / 53 bytes of extra shader in prototype A stay below the KOMBI's reset threshold.
- Kept (resident) assets ride along on each "goes whole" re-send.
- Shorter uploads shorten the incomplete-screen time on a switch by the computed seconds. The car's budget (2000–5500 KB/s, shared with BMW's map video) decides the real figure.

**Refuted:**
- R8 with one tint (or two by region) for the rev counter: the red zone.
- Half or quarter resolution for the dials, signs, minis and segments.
- Radial or mirror reconstruction of the dials.
- Procedural replacement of the baked dials or window: a different look.
- Channel packing as a byte saving.
- A denser wire encoding on our side lowering the KOMBI link's bytes: only the asset format does.

## 8. What the car must answer (for the lead's session plan)

1. **Version:** `ls /var/opt/cluster-render/versions/` and the log header show whether the running cluster-render is ≥ 0.5.12 (ETC2). Read-only.
2. **Prototype B, one install, `config.sceneTex: "etc2"`:** does Comfort draw its dials? The cluster-render log must show `asset … etc2rgb 672x672` and no `error` state for the dial layers. If they stay black or the layer reports a texture refused, try `etc2rgba`: change `format` in the bake, one line. Photograph the speedometer at 50 km/h beside a photo from 0.7.20, for the block error at the ticks.
3. **Prototype A, `"r8"`:** the same look check. Is the red zone of the rev counter clean? Does the KOMBI map the scene without a reset (the KOMBI guard's log lines)?
4. **Time:** read `goes whole … KB charged` and the time from the drive-mode change to the last asset's frame in the cluster-render log, for 0.7.20 and for the chosen prototype, three switches Sport → Comfort each.
5. **Residency:** only after 2–4. The log's "goes whole" KB with and without resident textures tells whether unsampled assets travel on each map.
