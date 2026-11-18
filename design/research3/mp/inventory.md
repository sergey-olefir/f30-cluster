### f30_cluster / wb_comfort

Layers 21 (7 effect, 14 image) per connection {"1":7,"2":7,"3":7}; assets per connection {"1":9,"2":2}; overdraw mean 2 max 5 (29.7 % of px under 3+ layers); effect px 2341238 (1.69 screens), image px 397050; pixel memory 11.41 MiB (assets 8.38, sheets 3.03); wire: assets 4291 KB, sheets 1551 KB, shader source 54 KB

| asset | conn | format | size | wire KB | pixel mem KiB (x2) | sampled by |
|---|---|---|---|---|---|---|
| scene:speedo | 1 | rgba8 | 670x670 | 1754 | 3507 | speedo.u_base |
| scene:tacho | 1 | rgba8 | 670x670 | 1754 | 3507 | tacho.u_base |
| scene:window | 1 | rgba8 | 320x286 | 358 | 715 | bg.u_t0 |
| scene:ed_seg | 1 | rgba8 | 346x70 | 95 | 189 | tacho.u_deco |
| scene:range_seg | 1 | rgba8 | 346x68 | 92 | 184 | speedo.u_deco |
| scene:fuel | 1 | rgba8 | 144x144 | 81 | 162 | fuel.u_base |
| scene:oil | 1 | rgba8 | 144x144 | 81 | 162 | oilt.u_base |
| scene:sign_limit | 2 | rgba8 | 88x89 | 31 | 61 | signs.u_s0 |
| scene:sign_nopass | 2 | rgba8 | 88x89 | 31 | 61 | signs.u_s1 |
| scene:horizon | 1 | rgba8 | 424x10 | 17 | 33 | bg.u_t1 |
| blank | 1 | rgba8 | 1x1 | 0 | 0 | bg.u_t2, fuel.u_deco, oilt.u_deco |

| layer | conn | kind | rect | widgets | shader B / samplers -> asset | sheet wire KB |
|---|---|---|---|---|---|---|
| 0:24 | 1 | effect | 0,0,1920,720 | bg | 9005 / u_t0->scene:window u_t1->scene:horizon u_t2->blank |  |
| 0:25 | 1 | effect | 77,45,670,670 | speedo | 13267 / u_base->scene:speedo u_deco->scene:range_seg |  |
| 0:26 | 1 | effect | 1173,45,670,670 | tacho | 13267 / u_base->scene:tacho u_deco->scene:ed_seg |  |
| 0:27 | 1 | effect | 10,538,140,140 | fuel | 7224 / u_base->scene:fuel u_deco->blank |  |
| 0:28 | 1 | effect | 1770,538,140,140 | oilt | 7224 / u_base->scene:oil u_deco->blank |  |
| 0:29 | 1 | image | 800,646,380,33 | row_b0 row_b1 |  | 49 |
| 0:30 | 1 | effect | 1373,498,44,44 | msa | 1703 / - |  |
| 2:15 | 3 | image | 1251,196,357,149 | rpm1 rpm2 rpm_cap |  | 208 |
| 2:16 | 3 | image | 1434,130,279,118 | rpm3 rpm4 rpm5 |  | 129 |
| 2:17 | 3 | image | 1705,333,65,167 | rpm6 rpm7 |  | 42 |
| 2:18 | 3 | image | 1242,451,386,150 | ready off mode gear |  | 226 |
| 2:19 | 3 | image | 321,491,60,31 | limit |  | 7 |
| 2:20 | 3 | image | 1453,575,260,73 | cons_v cons_a1 |  | 74 |
| 2:21 | 3 | image | 1414,616,40,24 | cons_a0 |  | 4 |
| 1:17 | 2 | image | 36,582,80,61 | fuel_full fuel_zero |  | 19 |
| 1:18 | 2 | image | 125,164,214,437 | spd0 spd1 spd2 spd3 +3 |  | 365 |
| 1:19 | 2 | image | 325,130,349,183 | spd6 spd8 spd9 spd10 +1 |  | 249 |
| 1:20 | 2 | image | 409,130,90,24 | spd7 |  | 8 |
| 1:21 | 2 | image | 515,368,175,233 | spd11 spd12 spd13 range_a1 |  | 159 |
| 1:22 | 2 | effect | 305,460,214,93 | signs | 3531 / u_s0->scene:sign_limit u_s1->scene:sign_nopass |  |
| 1:23 | 2 | image | 357,624,110,24 | range_v |  | 10 |

| shader | bytes | lines | samplers | tex reads | if | for | exp/pow/trig/smoothstep | uniforms (floats) | highp | used by |
|---|---|---|---|---|---|---|---|---|---|---|
| 42d56b73a3fb STYLE 0 | 9005 | 203 | 3 | 5 | 27 | 0 | 5/0/1/14 | 26 (90) | y | bg 1920x720 |
| 9c1e29d83050 STYLE 0 | 13267 | 270 | 2 | 2 | 38 | 0 | 10/3/10/27 | 21 (76) | y | speedo 670x670; tacho 670x670 |
| 8b3580c50ed2 STYLE 3 | 7224 | 181 | 2 | 1 | 22 | 0 | 0/1/7/11 | 21 (76) | y | fuel 140x140; oilt 140x140 |
| a6bf256ecd5d | 1703 | 43 | 0 | 0 | 3 | 0 | 0/0/3/0 | 5 (18) | y | msa 44x44 |
| baefdeedf135 | 3531 | 88 | 2 | 1 | 9 | 1 | 0/0/0/0 | 8 (25) | y | signs 214x93 |

### f30_cluster / wb_sport

Layers 18 (8 effect, 10 image) per connection {"1":7,"2":6,"3":5}; assets per connection {"1":3,"2":3}; overdraw mean 1.86 max 5 (16.8 % of px under 3+ layers); effect px 2358902 (1.71 screens), image px 199122; pixel memory 2.10 MiB (assets 0.58, sheets 1.52); wire: assets 298 KB, sheets 778 KB, shader source 40 KB

| asset | conn | format | size | wire KB | pixel mem KiB (x2) | sampled by |
|---|---|---|---|---|---|---|
| scene:fuel | 1 | rgba8 | 144x144 | 81 | 162 | fuel.u_base |
| scene:oil | 1 | rgba8 | 144x144 | 81 | 162 | oilt.u_base |
| exact:wb_big:64/32x92:0 | 2 | r8 | 832x92 | 75 | 150 | speed.u_font |
| scene:sign_limit | 2 | rgba8 | 88x89 | 31 | 61 | signs.u_s0 |
| scene:sign_nopass | 2 | rgba8 | 88x89 | 31 | 61 | signs.u_s1 |
| blank | 1 | rgba8 | 1x1 | 0 | 0 | bg.u_t0, bg.u_t1, bg.u_t2, speedo.u_base, speedo.u_deco, tacho.u_base, tacho.u_deco, fuel.u_deco, oilt.u_deco |

| layer | conn | kind | rect | widgets | shader B / samplers -> asset | sheet wire KB |
|---|---|---|---|---|---|---|
| 1:24 | 2 | effect | 305,460,214,93 | signs | 3286 / u_s0->scene:sign_limit u_s1->scene:sign_nopass |  |
| 2:22 | 3 | image | 321,491,60,31 | limit |  | 7 |
| 1:25 | 2 | image | 180,517,454,130 | spd0 spd13 range_in |  | 231 |
| 2:23 | 3 | image | 1251,196,357,149 | rpm1 rpm2 rpm_cap |  | 208 |
| 0:31 | 1 | effect | 0,0,1920,720 | bg | 8106 / u_t0->blank u_t1->blank u_t2->blank |  |
| 0:32 | 1 | effect | 77,45,670,670 | speedo | 6565 / u_base->blank u_deco->blank |  |
| 0:33 | 1 | effect | 1173,45,670,670 | tacho | 6565 / u_base->blank u_deco->blank |  |
| 0:34 | 1 | effect | 1373,498,44,44 | msa | 1703 / - |  |
| 0:35 | 1 | effect | 10,538,140,140 | fuel | 6990 / u_base->scene:fuel u_deco->blank |  |
| 0:36 | 1 | effect | 1770,538,140,140 | oilt | 6990 / u_base->scene:oil u_deco->blank |  |
| 0:37 | 1 | image | 800,646,380,33 | row_b0 row_b1 |  | 49 |
| 2:24 | 3 | image | 1434,130,279,118 | rpm3 rpm4 rpm5 |  | 129 |
| 2:25 | 3 | image | 1705,333,65,167 | rpm6 rpm7 |  | 42 |
| 2:26 | 3 | image | 1388,514,240,87 | mode gear |  | 82 |
| 1:26 | 2 | effect | 316,342,192,92 | speed | 1169 / u_font->exact:wb_big:64/32x92:0 |  |
| 1:28 | 2 | image | 362,233,100,24 | speed_unit |  | 9 |
| 1:29 | 2 | image | 36,582,80,61 | fuel_full fuel_zero |  | 19 |
| 1:30 | 2 | image | 356,623,22,26 | range_icon |  | 2 |

| shader | bytes | lines | samplers | tex reads | if | for | exp/pow/trig/smoothstep | uniforms (floats) | highp | used by |
|---|---|---|---|---|---|---|---|---|---|---|
| ff03d567918d | 3286 | 80 | 2 | 1 | 9 | 1 | 0/0/0/0 | 5 (13) | y | signs 214x93 |
| f4e71edc17ea STYLE 1 | 8106 | 180 | 3 | 2 | 23 | 0 | 8/0/0/10 | 23 (78) | y | bg 1920x720 |
| 60beb63784b1 STYLE 1 | 6565 | 164 | 2 | 1 | 16 | 0 | 0/2/7/10 | 18 (64) | y | speedo 670x670; tacho 670x670 |
| a6bf256ecd5d | 1703 | 43 | 0 | 0 | 3 | 0 | 0/0/3/0 | 5 (18) | y | msa 44x44 |
| fd897441aa96 STYLE 3 | 6990 | 173 | 2 | 1 | 22 | 0 | 0/1/7/11 | 18 (64) | y | fuel 140x140; oilt 140x140 |
| Atlas text for a cluster-render "effect" | 1169 | 28 | 1 | 1 | 1 | 1 | 0/0/0/0 | 4 (39) | y | speed 192x92 |

### f30_cluster / wb_eco

Layers 15 (6 effect, 9 image) per connection {"1":7,"2":6,"3":2}; assets per connection {"1":3}; overdraw mean 1.89 max 4 (19.9 % of px under 3+ layers); effect px 2321336 (1.68 screens), image px 265972; pixel memory 2.35 MiB (assets 0.32, sheets 2.03); wire: assets 162 KB, sheets 1039 KB, shader source 36 KB

| asset | conn | format | size | wire KB | pixel mem KiB (x2) | sampled by |
|---|---|---|---|---|---|---|
| scene:fuel | 1 | rgba8 | 144x144 | 81 | 162 | fuel.u_base |
| scene:oil | 1 | rgba8 | 144x144 | 81 | 162 | oilt.u_base |
| blank | 1 | rgba8 | 1x1 | 0 | 0 | bg.u_t0, bg.u_t1, bg.u_t2, speedo.u_base, speedo.u_deco, tacho.u_base, tacho.u_deco, fuel.u_deco, oilt.u_deco |

| layer | conn | kind | rect | widgets | shader B / samplers -> asset | sheet wire KB |
|---|---|---|---|---|---|---|
| 1:31 | 2 | image | 36,582,453,65 | fuel_full fuel_zero range_in |  | 115 |
| 2:27 | 3 | image | 1341,127,342,130 | charge power effdyn |  | 174 |
| 0:38 | 1 | effect | 0,0,1920,720 | bg | 8106 / u_t0->blank u_t1->blank u_t2->blank |  |
| 0:39 | 1 | effect | 77,45,670,670 | speedo | 6381 / u_base->blank u_deco->blank |  |
| 0:40 | 1 | effect | 1173,45,670,670 | tacho | 6257 / u_base->blank u_deco->blank |  |
| 0:41 | 1 | effect | 10,538,140,140 | fuel | 6990 / u_base->scene:fuel u_deco->blank |  |
| 0:42 | 1 | effect | 1770,538,140,140 | oilt | 6990 / u_base->scene:oil u_deco->blank |  |
| 0:43 | 1 | image | 800,646,380,33 | row_b0 row_b1 |  | 49 |
| 0:44 | 1 | effect | 1599,498,44,44 | msa | 1703 / - |  |
| 1:32 | 2 | image | 125,164,214,385 | spd0 spd1 spd2 spd3 +2 |  | 322 |
| 1:33 | 2 | image | 325,130,349,183 | spd6 spd8 spd9 spd10 +1 |  | 249 |
| 1:34 | 2 | image | 409,130,90,24 | spd7 |  | 8 |
| 1:35 | 2 | image | 544,368,146,173 | spd11 spd12 spd13 |  | 99 |
| 1:36 | 2 | image | 331,623,22,26 | range_icon |  | 2 |
| 2:28 | 3 | image | 1388,514,240,22 | mode |  | 21 |

| shader | bytes | lines | samplers | tex reads | if | for | exp/pow/trig/smoothstep | uniforms (floats) | highp | used by |
|---|---|---|---|---|---|---|---|---|---|---|
| fefa192d0db6 STYLE 2 | 8106 | 180 | 3 | 2 | 23 | 0 | 8/0/0/10 | 23 (78) | y | bg 1920x720 |
| 1bb5c72eb299 STYLE 2 | 6381 | 162 | 2 | 1 | 16 | 0 | 1/1/7/8 | 18 (64) | y | speedo 670x670 |
| e5003870f542 STYLE 4 | 6257 | 159 | 2 | 1 | 15 | 0 | 1/1/7/9 | 18 (64) | y | tacho 670x670 |
| fd897441aa96 STYLE 3 | 6990 | 173 | 2 | 1 | 22 | 0 | 0/1/7/11 | 18 (64) | y | fuel 140x140; oilt 140x140 |
| a6bf256ecd5d | 1703 | 43 | 0 | 0 | 3 | 0 | 0/0/3/0 | 5 (18) | y | msa 44x44 |

### f30_cluster / wb_dials

Layers 15 (6 effect, 9 image) per connection {"1":6,"2":5,"3":4}; assets per connection {"1":7}; overdraw mean 1.93 max 4 (25.3 % of px under 3+ layers); effect px 2321336 (1.68 screens), image px 333425; pixel memory 11.16 MiB (assets 8.62, sheets 2.54); wire: assets 4411 KB, sheets 1303 KB, shader source 50 KB

| asset | conn | format | size | wire KB | pixel mem KiB (x2) | sampled by |
|---|---|---|---|---|---|---|
| scene:speedo_d | 1 | rgba8 | 670x670 | 1754 | 3507 | speedo.u_base |
| scene:tacho_d | 1 | rgba8 | 670x670 | 1754 | 3507 | tacho.u_base |
| scene:strip_mask | 1 | r8 | 1908x353 | 658 | 1315 | bg.u_t2 |
| scene:collar_r8 | 1 | r8 | 480x180 | 84 | 169 | bg.u_t0 |
| scene:fuel | 1 | rgba8 | 144x144 | 81 | 162 | fuel.u_base |
| scene:oil | 1 | rgba8 | 144x144 | 81 | 162 | oilt.u_base |
| blank | 1 | rgba8 | 1x1 | 0 | 0 | bg.u_t1, speedo.u_deco, tacho.u_deco, fuel.u_deco, oilt.u_deco |

| layer | conn | kind | rect | widgets | shader B / samplers -> asset | sheet wire KB |
|---|---|---|---|---|---|---|
| 1:46 | 2 | image | 36,582,80,61 | fuel_full fuel_zero |  | 19 |
| 2:36 | 3 | image | 1251,196,357,149 | rpm1 rpm2 rpm_cap |  | 208 |
| 0:58 | 1 | effect | 0,0,1920,720 | bg | 9005 / u_t0->scene:collar_r8 u_t2->scene:strip_mask u_t1->blank |  |
| 1:47 | 2 | image | 125,164,214,385 | spd0 spd1 spd2 spd3 +2 |  | 322 |
| 0:61 | 1 | effect | 77,45,670,670 | speedo | 13267 / u_base->scene:speedo_d u_deco->blank |  |
| 0:63 | 1 | effect | 1173,45,670,670 | tacho | 13267 / u_base->scene:tacho_d u_deco->blank |  |
| 0:65 | 1 | effect | 10,538,140,140 | fuel | 7224 / u_base->scene:fuel u_deco->blank |  |
| 0:66 | 1 | effect | 1770,538,140,140 | oilt | 7224 / u_base->scene:oil u_deco->blank |  |
| 0:67 | 1 | effect | 1373,498,44,44 | msa | 1703 / - |  |
| 2:37 | 3 | image | 1434,130,279,118 | rpm3 rpm4 rpm5 |  | 129 |
| 2:38 | 3 | image | 1705,333,65,167 | rpm6 rpm7 |  | 42 |
| 2:39 | 3 | image | 1242,451,386,150 | ready off mode gear |  | 226 |
| 1:48 | 2 | image | 325,130,349,183 | spd6 spd8 spd9 spd10 +1 |  | 249 |
| 1:49 | 2 | image | 409,130,90,24 | spd7 |  | 8 |
| 1:50 | 2 | image | 544,368,146,173 | spd11 spd12 spd13 |  | 99 |

| shader | bytes | lines | samplers | tex reads | if | for | exp/pow/trig/smoothstep | uniforms (floats) | highp | used by |
|---|---|---|---|---|---|---|---|---|---|---|
| 42d56b73a3fb STYLE 0 | 9005 | 203 | 3 | 5 | 27 | 0 | 5/0/1/14 | 26 (90) | y | bg 1920x720 |
| 9c1e29d83050 STYLE 0 | 13267 | 270 | 2 | 2 | 38 | 0 | 10/3/10/27 | 21 (76) | y | speedo 670x670; tacho 670x670 |
| 8b3580c50ed2 STYLE 3 | 7224 | 181 | 2 | 1 | 22 | 0 | 0/1/7/11 | 21 (76) | y | fuel 140x140; oilt 140x140 |
| a6bf256ecd5d | 1703 | 43 | 0 | 0 | 3 | 0 | 0/0/3/0 | 5 (18) | y | msa 44x44 |

### twin_dial / twin

Layers 14 (8 effect, 6 image) per connection {"1":6,"2":6,"3":2}; assets per connection {"1":4,"2":1}; overdraw mean 1.83 max 5 (14.4 % of px under 3+ layers); effect px 2110170 (1.53 screens), image px 401860; pixel memory 4.73 MiB (assets 1.66, sheets 3.07); wire: assets 850 KB, sheets 1570 KB, shader source 15 KB

| asset | conn | format | size | wire KB | pixel mem KiB (x2) | sampled by |
|---|---|---|---|---|---|---|
| scene:face_tacho | 1 | r8 | 616x560 | 337 | 674 | dial_tach.u_face |
| scene:face_speedo | 1 | r8 | 616x560 | 337 | 674 | dial_speed.u_face |
| exact:td_big:82/41x70:0 | 1 | r8 | 1066x70 | 73 | 146 | speed.u_font |
| scene:panel_mask | 1 | r8 | 536x112 | 59 | 117 | bg_l.u_mask |
| exact:td_gear:57/57x50:0 | 2 | r8 | 912x50 | 45 | 89 | gear.u_font, gear#2.u_font |

| layer | conn | kind | rect | widgets | shader B / samplers -> asset | sheet wire KB |
|---|---|---|---|---|---|---|
| 0:17 | 1 | effect | 0,0,1380,720 | bg_l | 1995 / u_mask->scene:panel_mask |  |
| 0:18 | 1 | effect | 1380,0,540,660 | bg_rt | 537 / - |  |
| 0:19 | 1 | effect | 1460,660,460,60 | bg_rb | 537 / - |  |
| 0:20 | 1 | effect | 70,90,620,570 | dial_tach | 4461 / u_face->scene:face_tacho |  |
| 0:21 | 1 | effect | 1230,90,620,570 | dial_speed | 4461 / u_face->scene:face_speedo |  |
| 0:22 | 1 | effect | 1417,374,246,70 | speed | 1169 / u_font->exact:td_big:82/41x70:0 |  |
| 1:14 | 2 | effect | 346,492,57,50 | gear | 1169 / u_font->exact:td_gear:57/57x50:0 |  |
| 1:15 | 2 | effect | 317,492,114,50 | gear#2 | 1169 / u_font->exact:td_gear:57/57x50:0 |  |
| 1:16 | 2 | image | 617,121,672,45 | tab_range_i tab_range_v tab_range_u tab_warn_i +4 |  | 118 |
| 1:17 | 2 | image | 740,237,440,285 | c_title c_time c_weekday c_date |  | 490 |
| 1:18 | 2 | image | 740,319,446,218 | t1_a t1_au t1_b t1_bu +5 |  | 380 |
| 1:19 | 2 | image | 316,329,140,250 | ready program |  | 137 |
| 2:5 | 3 | image | 700,613,488,93 | row_l1 row_l1u row_l2 row_r1 +3 |  | 177 |
| 2:6 | 3 | image | 694,592,536,128 | plate |  | 268 |

| shader | bytes | lines | samplers | tex reads | if | for | exp/pow/trig/smoothstep | uniforms (floats) | highp | used by |
|---|---|---|---|---|---|---|---|---|---|---|
| 3652290cc570 STYLE 0 | 1995 | 54 | 1 | 1 | 2 | 3 | 0/1/0/0 | 13 (104) | y | bg_l 1380x720 |
| 0fa948d13b31 STYLE 1 | 537 | 19 | 0 | 0 | 0 | 1 | 0/0/0/0 | 2 (36) | y | bg_rt 540x660; bg_rb 460x60 |
| 091655c9f250 | 4461 | 93 | 1 | 1 | 6 | 0 | 2/2/4/9 | 10 (40) | y | dial_tach 620x570; dial_speed 620x570 |
| Atlas text for a cluster-render "effect" | 1169 | 28 | 1 | 1 | 1 | 1 | 0/0/0/0 | 4 (39) | y | speed 246x70; gear 57x50; gear#2 114x50 |

