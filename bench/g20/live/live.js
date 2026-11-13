/* G20 bench simulation, package D: the live parts of BMW's stock G20 Comfort cluster.
 *
 *   window.G20Live = { init(base) -> Promise, drawMap(ctx, s), drawGauges(ctx, s), wantsFrame(s) -> bool,
 *                      PARAMS, pointerAt(which, value, opts) }
 *
 * drawMap   (z 10):    our own synthetic street map inside map.region (seeded, procedural, never BMW's data), its edge
 *                      fade, the red position arrow; the streets drift down with s.values.speed, the arrow stays.
 * drawGauges (z 50-59): the pointer glows (additive), the tacho rev band, the two stock pointers, then the fuel and
 *                      oil-temperature minis (lit fill, needle).
 *
 * Every number lives in PARAMS (fitted on the rectified photos by bake/src/G20/live/*.py, written in by
 * build_params.py between the PARAMS markers). Each leaf is {v, ev, src, note}: value, evidence, photos, how.
 * The stock pointers were only ever photographed at rest (speed 0; tacho at 0 and idle): their travel is a model
 * (ev weak/medium), see docs/G20SIM-D-live.md. Bench only: nothing here goes into the app or the car.
 * No photo pixels: everything is drawn procedurally. Plain ES2017, no dependencies.
 */
(function () {
  'use strict';

  var PARAMS = /*<PARAMS>*/{
 "version": "1.0 (package D, fitted 2026-11-12)",
 "coords": "panel px, 1920x720, x right, y down; angles in degrees (image atan2 unless stated)",
 "speedo": {
  "centre": {
   "v": [
    441.0,
    384.1
   ],
   "ev": "weak",
   "src": [
    "08",
    "09"
   ],
   "note": "virtual centre of the pointer rays. Only one speedo pose exists (0 km/h): on the measured 0-bar line, at the tacho centre's y (the layout is mirror-symmetric about x 960 within ~4 px)"
  },
  "orient": {
   "v": "centre",
   "ev": "weak",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "WEAK: the pointer was never photographed moving. 'centre': the bar lies on the ray from `centre` through its scale point (fits the tacho's 3 poses, 0 and idle 0.70, to 0.3 deg). 'tick': the bar follows the local tick axis instead (2.7 deg off at idle). The ticks above ~1.5 x1000 / 40 km/h turn up to 25 deg away from the centre ray; only a photo in motion can say which the bar follows there"
  },
  "scale": {
   "v": {
    "values": [
     0.0,
     2.0,
     4.0,
     6.0,
     8.0,
     10.0,
     12.0,
     14.0,
     16.0,
     18.0,
     20.0,
     22.0,
     24.0,
     26.0,
     28.0,
     30.0,
     32.0,
     34.0,
     36.0,
     38.0,
     40.0,
     42.0,
     44.0,
     46.0,
     48.0,
     50.0,
     52.0,
     54.0,
     56.0,
     58.0,
     60.0,
     65.0,
     70.0,
     75.0,
     80.0,
     85.0,
     90.0,
     95.0,
     100.0,
     105.0,
     110.0,
     115.0,
     120.0,
     125.0,
     130.0,
     135.0,
     140.0,
     150.0,
     160.0,
     170.0,
     180.0,
     190.0,
     200.0,
     210.0,
     220.0,
     230.0,
     240.0,
     250.0,
     260.0
    ],
    "pts": [
     [
      373.65,
      636.84
     ],
     [
      358.7324347866688,
      636.9364119094798
     ],
     [
      344.22722716847034,
      637.0345279907733
     ],
     [
      329.0901301574411,
      637.8562571399243
     ],
     [
      314.09012711297476,
      637.5565630960145
     ],
     [
      297.2994301509448,
      639.6580387633894
     ],
     [
      285.08421701789064,
      632.7218767411208
     ],
     [
      271.1269327710602,
      627.2801649526439
     ],
     [
      258.78236378951686,
      619.3478307961612
     ],
     [
      247.41935653360457,
      609.6175158509799
     ],
     [
      234.31720596611785,
      602.0910716750117
     ],
     [
      226.6886673805471,
      588.2517138391981
     ],
     [
      216.98005814801115,
      577.0209404195987
     ],
     [
      207.39140703179436,
      565.4950496661705
     ],
     [
      198.52447833214376,
      553.6171839705848
     ],
     [
      186.64054297997507,
      543.5701406514667
     ],
     [
      181.34794304976782,
      529.3920146539394
     ],
     [
      173.13350504041256,
      516.9163303492501
     ],
     [
      165.23459171259395,
      504.27410966960935
     ],
     [
      157.485838026807,
      491.47840998850734
     ],
     [
      146.48340072924748,
      480.14571170711486
     ],
     [
      142.74747579152262,
      465.5120131882669
     ],
     [
      135.33358721139513,
      452.563873259861
     ],
     [
      128.5764062114485,
      439.1841574446095
     ],
     [
      121.97378525339134,
      425.93147535120363
     ],
     [
      112.61798618586461,
      412.7508870289478
     ],
     [
      110.72907562191486,
      398.04820501692507
     ],
     [
      105.13699018630899,
      384.23422248095346
     ],
     [
      100.76277766619376,
      369.8843776251214
     ],
     [
      97.59584061487905,
      355.42455365392084
     ],
     [
      93.10329513591408,
      340.36522929534965
     ],
     [
      97.83115736097523,
      318.74412861962685
     ],
     [
      104.85204584894088,
      298.19888606421904
     ],
     [
      114.96096259607374,
      278.7770345363096
     ],
     [
      124.68465495258611,
      260.21642115453574
     ],
     [
      141.38618455345366,
      244.1225441260569
     ],
     [
      156.30645145079654,
      228.16784103563884
     ],
     [
      171.84209467440195,
      213.067573183138
     ],
     [
      184.47114157856944,
      196.5253751941578
     ],
     [
      204.45991341993908,
      183.95718382237385
     ],
     [
      221.77895610535643,
      170.2869693366784
     ],
     [
      238.9237336770352,
      157.03566755861507
     ],
     [
      253.84545020407347,
      141.80545243064688
     ],
     [
      275.0812343182779,
      131.77087346444858
     ],
     [
      293.1212117494615,
      119.44650304763101
     ],
     [
      311.88213536579144,
      108.02144625235164
     ],
     [
      329.18696878936623,
      95.61050674646364
     ],
     [
      361.38201744207595,
      88.95015482936525
     ],
     [
      391.78786212557327,
      82.24123937479166
     ],
     [
      420.34691234517027,
      72.59790487093511
     ],
     [
      452.6969941647692,
      71.62704954337134
     ],
     [
      483.7631124546034,
      67.02764353028493
     ],
     [
      513.2554274261544,
      58.73139643146112
     ],
     [
      545.2166111526437,
      60.020821428106494
     ],
     [
      576.5738940825117,
      57.66512838098922
     ],
     [
      607.3453688182724,
      50.483373052001596
     ],
     [
      638.662964227675,
      47.59548321422572
     ],
     [
      669.9805596370778,
      44.70759337644985
     ],
     [
      701.2981550464805,
      41.81970353867398
     ]
    ],
    "tick_dir": [
     113.1,
     114.6,
     116.0,
     118.7,
     123.8,
     122.6,
     126.3,
     129.6,
     129.8,
     133.0,
     134.2,
     138.4,
     140.4,
     144.0,
     146.5,
     147.2,
     149.4,
     152.7,
     154.9,
     157.9,
     158.5,
     164.2,
     166.2,
     169.2,
     168.4,
     170.4,
     176.2,
     175.3,
     178.7,
     -179.5,
     -179.5,
     -176.7,
     -173.7,
     -169.7,
     -167.7,
     -165.0,
     -161.6,
     -161.3,
     -155.3,
     -153.4,
     -149.1,
     -146.1,
     -141.4,
     -137.4,
     -136.3,
     -132.3,
     -128.4,
     -122.6,
     -122.4,
     -116.2,
     -116.4,
     -107.7,
     -104.5,
     -95.5,
     -92.4,
     -91.1,
     -88.0,
     -84.9,
     -81.8
    ],
    "src": [
     "bar at 0 km/h (08, 09) crossing the tick ring",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "interp",
     "interp",
     "measured"
    ]
   },
   "ev": "strong",
   "src": [
    "08",
    "09"
   ],
   "note": "outer ends of every tick (centroid + half length outward), mean of 08 and 09 (spread median 0.34 px). Values: minors every 2 km/h to 60, every 5 to 140, every 10 to 260; majors 0-60 by 10, 80, 100, 120, 140, 170, 200, 230, 260. The 0 point is where the 0 km/h bar crosses the ring (its tick is under the pointer). Hidden ticks are interpolated (src interp). value -> point is piecewise linear between ticks"
  },
  "beyond": {
   "v": 4.61,
   "ev": "medium",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "the bar's visual outer end lies this far past the tick ring along the bar (tacho: [6.2, 3.1, 4.5] px)"
  },
  "len": {
   "v": {
    "stock": 182.8,
    "connected": 182.8
   },
   "ev": "medium",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "visual length: from the modelled outer end (ring + beyond) to the measured inner end (08/09; the outer end merges with the bezel line). The tacho's length would put the inner end 4.7 px further in. 14 (connected) shows the speedo bar at full length"
  }
 },
 "tacho": {
  "centre": {
   "v": [
    1476.8,
    384.1
   ],
   "ev": "medium",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "least-squares meeting point of the bars at 0 (08) and idle (09, 14): rms 1.25 px off the 3 lines. The two idle poses are 0.70 and 0.72 x1000; 10 (grid over it) agrees within its noise"
  },
  "orient": {
   "v": "centre",
   "ev": "weak",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "see speedo.orient"
  },
  "scale": {
   "v": {
    "values": [
     0.0,
     0.1,
     0.2,
     0.3,
     0.4,
     0.5,
     0.6,
     0.7,
     0.8,
     0.9,
     1.0,
     1.1,
     1.2,
     1.3,
     1.4,
     1.5,
     1.6,
     1.7,
     1.8,
     1.9,
     2.0,
     2.1,
     2.2,
     2.3,
     2.4,
     2.5,
     2.6,
     2.7,
     2.8,
     2.9,
     3.0,
     3.1,
     3.2,
     3.3,
     3.4,
     3.5,
     3.6,
     3.7,
     3.8,
     3.9,
     4.0,
     4.1,
     4.2,
     4.3,
     4.4,
     4.5,
     4.6,
     4.7,
     4.8,
     4.9,
     5.0,
     5.1,
     5.2,
     5.3,
     5.4,
     5.5,
     5.6,
     5.7,
     5.8,
     5.9,
     6.0,
     6.1,
     6.2,
     6.3,
     6.4,
     6.5,
     6.6,
     6.7,
     6.8,
     6.9,
     7.0
    ],
    "pts": [
     [
      1546.2883432797655,
      641.6301047719138
     ],
     [
      1559.2414114502417,
      637.0191797135308
     ],
     [
      1574.0698440269016,
      637.4755091260093
     ],
     [
      1588.981431826672,
      637.9079177232372
     ],
     [
      1604.009262795971,
      638.2156296970628
     ],
     [
      1620.983618907515,
      640.1284553513779
     ],
     [
      1633.1636096548132,
      632.7769644218121
     ],
     [
      1647.3727037429394,
      627.8251998020872
     ],
     [
      1659.1383750875343,
      619.0940569866548
     ],
     [
      1670.8607324985403,
      609.8743199842327
     ],
     [
      1684.959897182764,
      602.7336041549163
     ],
     [
      1691.3132422847557,
      588.279801577982
     ],
     [
      1700.9420160244767,
      576.9070601499641
     ],
     [
      1710.253758064395,
      565.4451947437375
     ],
     [
      1719.1084171317466,
      553.5328433737327
     ],
     [
      1731.3234587985526,
      543.7760151980801
     ],
     [
      1735.9214314533237,
      528.9632861272577
     ],
     [
      1744.0193626754901,
      516.5347982773324
     ],
     [
      1751.6834761740133,
      503.921560740021
     ],
     [
      1759.5492510635227,
      491.26906618811984
     ],
     [
      1771.9252434133173,
      480.25201299878137
     ],
     [
      1774.2202542349073,
      465.3842729821167
     ],
     [
      1781.4079980807996,
      452.2766042576595
     ],
     [
      1788.3462252690179,
      439.12360613538857
     ],
     [
      1794.5253810023264,
      425.771305545931
     ],
     [
      1804.6047762288592,
      412.7618824016673
     ],
     [
      1805.3256755327188,
      398.1645464893083
     ],
     [
      1811.0683498962103,
      384.3313965565691
     ],
     [
      1816.0776717817505,
      370.13132981409564
     ],
     [
      1818.9482041704766,
      355.5040613938501
     ],
     [
      1824.769306341329,
      340.27327644333934
     ],
     [
      1818.9619058805201,
      322.91109946307563
     ],
     [
      1813.9837802732873,
      305.92514276756094
     ],
     [
      1807.1090604329147,
      289.74853074570206
     ],
     [
      1798.1715902322562,
      274.2095015133441
     ],
     [
      1792.17499902544,
      258.9059892580715
     ],
     [
      1777.0058421017916,
      246.23952743657014
     ],
     [
      1765.1763064467514,
      233.36407835700567
     ],
     [
      1752.8554658542416,
      220.67710781964473
     ],
     [
      1740.2129806591056,
      208.28329480042987
     ],
     [
      1731.2215313859053,
      194.48065133673214
     ],
     [
      1713.8680600056823,
      184.57075709665793
     ],
     [
      1699.9616437906539,
      173.87185935956464
     ],
     [
      1686.1087753073216,
      162.95156609395178
     ],
     [
      1671.6825091640449,
      152.17512671833373
     ],
     [
      1660.5375690294536,
      138.92391221044875
     ],
     [
      1642.7208662210182,
      131.642314322427
     ],
     [
      1627.8634504011743,
      121.74545905290951
     ],
     [
      1612.419264289515,
      112.59360153504343
     ],
     [
      1597.0207115418661,
      104.31101702097382
     ],
     [
      1583.5320654857483,
      92.94961828689492
     ],
     [
      1563.4363059973232,
      91.15031250308179
     ],
     [
      1545.3065308477035,
      86.35453170855101
     ],
     [
      1527.603797985047,
      81.80031288991873
     ],
     [
      1509.0436957284296,
      78.85167221147799
     ],
     [
      1492.5689792384148,
      71.21119810681887
     ],
     [
      1472.612688706453,
      72.65638888310725
     ],
     [
      1455.0510210372706,
      68.91488794749523
     ],
     [
      1436.7900482610953,
      67.04952699028837
     ],
     [
      1417.9428434257225,
      65.0628419027114
     ],
     [
      1400.3705837873993,
      58.03170223856321
     ],
     [
      1381.8014195839887,
      56.25801891623214
     ],
     [
      1363.2322553805782,
      54.48433559390105
     ],
     [
      1344.6630911771679,
      52.71065227156997
     ],
     [
      1326.0939269737573,
      50.93696894923888
     ],
     [
      1307.5247627703468,
      49.16328562690781
     ],
     [
      1288.766220920716,
      47.615734398349794
     ],
     [
      1270.0076790710852,
      46.06818316979177
     ],
     [
      1251.2491372214547,
      44.52063194123376
     ],
     [
      1232.490595371824,
      42.97308071267574
     ],
     [
      1213.7320535221932,
      41.425529484117725
     ]
    ],
    "tick_dir": [
     74.6,
     72.5,
     67.8,
     65.0,
     63.2,
     60.5,
     55.8,
     52.0,
     51.3,
     48.0,
     46.3,
     43.8,
     39.5,
     40.6,
     36.1,
     34.5,
     30.5,
     29.2,
     27.5,
     24.5,
     22.1,
     19.0,
     15.5,
     13.9,
     13.3,
     10.5,
     8.9,
     5.0,
     3.7,
     0.4,
     -0.2,
     -2.9,
     -4.5,
     -5.6,
     -12.4,
     -13.8,
     -16.9,
     -16.3,
     -20.5,
     -25.4,
     -27.2,
     -31.8,
     -31.8,
     -35.1,
     -41.9,
     -42.8,
     -45.6,
     -48.3,
     -51.3,
     -52.4,
     -55.4,
     -57.8,
     -58.8,
     -63.3,
     -66.2,
     -68.6,
     -69.9,
     -78.5,
     -75.1,
     -73.4,
     -80.9,
     -83.0,
     -85.1,
     -87.2,
     -89.4,
     -91.5,
     -93.7,
     -96.0,
     -98.3,
     -100.5,
     -102.8
    ],
    "src": [
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "measured",
     "interp",
     "interp",
     "interp",
     "interp",
     "measured",
     "interp",
     "interp",
     "interp",
     "interp",
     "measured"
    ]
   },
   "ev": "strong",
   "src": [
    "08",
    "09"
   ],
   "note": "outer ends of every tick, 0..7 by 0.1 (majors every 0.5), mean of 08 and 09 (spread median 0.17 px); the minors in the red band above 6 are hidden and interpolated"
  },
  "beyond": {
   "v": 4.61,
   "ev": "medium",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "see speedo.beyond: [6.2, 3.1, 4.5] px"
  },
  "len": {
   "v": {
    "stock": 187.5,
    "connected": 109.0
   },
   "ev": "medium",
   "src": [
    "08",
    "09",
    "14",
    "10"
   ],
   "note": "visual length: stock 08 189.5, 09 185.4; theme connected 14 109.0 (BMW draws a SHORT tacho bar while a theme is connected: 10 agrees, 85-140 px between grid labels). Plausibly to clear the black box"
  },
  "band": {
   "v": {
    "enabled": true,
    "depth": 18.5,
    "width": 6.5,
    "rgb": [
     250,
     58,
     92
    ],
    "from": 0.0,
    "gap": 0
   },
   "ev": "medium",
   "src": [
    "09",
    "14"
   ],
   "note": "the pink-red rev band inside the ticks from 0 to the pointer (09, 14 at idle; absent in 08 at 0). Depth from the tick ring along the ray, width (px), colour. Beyond 0.7 x1000 it is extrapolated along the ring (weak)"
  }
 },
 "bar": {
  "width": {
   "v": 6.0,
   "ev": "strong",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "core width: FWHM of the cross profile on the clean bars (08 tacho, 14 tacho, 08 speedo: 6.0 each); the ridge fit with a local baseline gives 6.2-7.5 incl. camera blur"
  },
  "rgb": {
   "v": {
    "night": [
     240.0,
     126.0,
     99.0
    ],
    "day": [
     248.0,
     122.0,
     94.0
    ]
   },
   "ev": "strong",
   "src": [
    "08",
    "09"
   ],
   "note": "core colour (central 3 px, median along the clean middle of the bar)"
  },
  "cap": {
   "v": "round",
   "ev": "strong",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "both ends are round: the G profile falls 177 -> 64 within 2 px"
  },
  "rim": {
   "v": {
    "rgb": [
     40,
     0,
     0
    ],
    "alpha": 0.55,
    "width": 2.5,
    "offset": 5.5,
    "hi_alpha": 0.3
   },
   "ev": "medium",
   "src": [
    "08",
    "09"
   ],
   "note": "a thin dark-red line along the core: at `offset` px toward the LOW-value side (the photos read [54.0, 5.0, 2.0] at -5..-7 px), and a fainter one (hi_alpha) on the high side (a dip to ~(160, 45, 22) at +4..+5 px)"
  },
  "shadow": {
   "v": {
    "alpha": 0.62,
    "d0": 8,
    "lambda": 14,
    "dmax": 56,
    "blur": 3
   },
   "ev": "medium",
   "src": [
    "08",
    "09"
   ],
   "note": "a soft dark band beside the bar on the LOW-value side (black, alpha a(d) = alpha for d <= d0, then alpha * exp(-(d - d0) / lambda), d = px from the bar axis, to dmax; ends softened by a blur). From the photo / (stand-in + our glow) ratio across the bars (tacho 08, 09; speedo 08): 0.32-0.50 at 8 px, 0.52-0.62 at 14, 0.72-0.75 at 20, 0.87-0.92 at 30, ~1 at 40"
  }
 },
 "glow": {
  "gain": {
   "v": 0.6,
   "ev": "weak",
   "src": [
    "08",
    "09"
   ],
   "note": "overall multiplier, calibrated by the lead (E) on the assembled simulation over package B's static faces (tools/g20sim/calib_glow.py, least squares in the pointer zones): 08 speedo 0.47, tacho 0.58; 09 speedo 0.63, tacho 0.73; 0.6 = their mean (D's own fit, against a stand-in face, was 1.0)"
  },
  "composite": {
   "v": "lighter",
   "ev": "medium",
   "src": [
    "08",
    "09"
   ],
   "note": "additive: the fit is linear in the glow (o09 = a*o08 + b + glow terms)"
  },
  "rgb": {
   "v": {
    "night": [
     140.1,
     38.8,
     17.3
    ],
    "day": [
     108.6,
     26.9,
     13.4
    ]
   },
   "ev": "medium",
   "src": [
    "08",
    "09"
   ],
   "note": "added colour at full strength. Fitted jointly on 08 (bar at 0) and 09 (idle) with a per-channel exposure map a [0.816, 0.982, 1.108], b [23.0, 12.3, 3.3]; rms 13.8 vs 18.5 without glow (75520 px)"
  },
  "sigma_hi": {
   "v": 20,
   "ev": "medium",
   "src": [
    "08",
    "09"
   ],
   "note": "angular gaussian sigma (deg about the centre) on the higher-value side"
  },
  "sigma_lo": {
   "v": 26,
   "ev": "medium",
   "src": [
    "08",
    "09"
   ],
   "note": "same on the lower-value side"
  },
  "q0": {
   "v": 80,
   "ev": "medium",
   "src": [
    "08",
    "09"
   ],
   "note": "full strength from the tick ring inward to this depth (px along the ray)"
  },
  "q1": {
   "v": 220,
   "ev": "medium",
   "src": [
    "08",
    "09"
   ],
   "note": "smoothstep fall to 0 at this depth"
  },
  "q_in": {
   "v": 34,
   "ev": "medium",
   "src": [
    "39",
    "40"
   ],
   "note": "car3 J: no glow outside this depth (px inside the tick ring), full 10 px further in: on 39/40 the tick zone between the band and the ticks stays dark by the pointer (the old fit lit it from the ring)"
  },
  "res": {
   "v": 0.5,
   "ev": "none",
   "src": [],
   "note": "render scale of the glow buffer (0.5 = half resolution, upscaled bilinear)"
  },
  "face": {
   "v": {
    "speedo": [
     [
      371.8,
      643.6
     ],
     [
      356.6,
      643.6
     ],
     [
      341.7,
      643.6
     ],
     [
      326.3,
      644.3
     ],
     [
      311.0,
      643.8
     ],
     [
      293.9,
      645.8
     ],
     [
      281.4,
      638.7
     ],
     [
      267.1,
      633.0
     ],
     [
      254.5,
      624.9
     ],
     [
      242.9,
      614.9
     ],
     [
      229.5,
      607.2
     ],
     [
      221.6,
      593.1
     ],
     [
      211.7,
      581.6
     ],
     [
      201.9,
      569.8
     ],
     [
      192.8,
      557.6
     ],
     [
      180.7,
      547.3
     ],
     [
      175.2,
      532.8
     ],
     [
      166.9,
      520.0
     ],
     [
      158.8,
      507.1
     ],
     [
      150.9,
      494.0
     ],
     [
      139.8,
      482.3
     ],
     [
      136.0,
      467.4
     ],
     [
      128.5,
      454.1
     ],
     [
      121.7,
      440.4
     ],
     [
      115.0,
      426.8
     ],
     [
      105.6,
      413.4
     ],
     [
      103.7,
      398.3
     ],
     [
      98.1,
      384.2
     ],
     [
      93.8,
      369.6
     ],
     [
      90.6,
      354.8
     ],
     [
      86.2,
      339.5
     ],
     [
      91.0,
      317.4
     ],
     [
      98.1,
      296.5
     ],
     [
      108.3,
      276.6
     ],
     [
      118.2,
      257.7
     ],
     [
      135.0,
      241.2
     ],
     [
      150.2,
      224.8
     ],
     [
      165.9,
      209.3
     ],
     [
      178.8,
      192.4
     ],
     [
      199.1,
      179.4
     ],
     [
      216.8,
      165.4
     ],
     [
      234.3,
      151.8
     ],
     [
      249.6,
      136.3
     ],
     [
      271.2,
      125.9
     ],
     [
      289.7,
      113.3
     ],
     [
      308.9,
      101.7
     ],
     [
      326.7,
      89.1
     ],
     [
      359.6,
      82.2
     ],
     [
      390.7,
      75.3
     ],
     [
      419.9,
      65.6
     ],
     [
      453.0,
      64.6
     ],
     [
      484.7,
      60.1
     ],
     [
      514.8,
      51.9
     ],
     [
      547.4,
      53.4
     ],
     [
      579.3,
      51.2
     ],
     [
      610.5,
      44.2
     ],
     [
      642.2,
      41.6
     ],
     [
      673.9,
      38.9
     ],
     [
      705.5,
      36.2
     ],
     [
      680,
      92
     ],
     [
      555,
      100
     ],
     [
      521,
      160
     ],
     [
      506,
      180
     ],
     [
      492,
      200
     ],
     [
      478,
      220
     ],
     [
      395,
      339
     ],
     [
      429,
      420
     ],
     [
      435,
      440
     ],
     [
      443,
      460
     ],
     [
      468,
      520
     ],
     [
      477,
      540
     ],
     [
      486,
      560
     ],
     [
      491,
      580
     ],
     [
      493,
      620
     ],
     [
      495,
      650
     ],
     [
      374,
      650
     ]
    ],
    "tacho": [
     [
      1548.1,
      648.4
     ],
     [
      1561.4,
      643.7
     ],
     [
      1576.6,
      644.0
     ],
     [
      1591.8,
      644.3
     ],
     [
      1607.1,
      644.5
     ],
     [
      1624.4,
      646.2
     ],
     [
      1636.9,
      638.7
     ],
     [
      1651.4,
      633.6
     ],
     [
      1663.4,
      624.6
     ],
     [
      1675.4,
      615.2
     ],
     [
      1689.8,
      607.8
     ],
     [
      1696.4,
      593.1
     ],
     [
      1706.2,
      581.5
     ],
     [
      1715.8,
      569.7
     ],
     [
      1724.8,
      557.5
     ],
     [
      1737.3,
      547.5
     ],
     [
      1742.0,
      532.4
     ],
     [
      1750.3,
      519.6
     ],
     [
      1758.1,
      506.7
     ],
     [
      1766.1,
      493.8
     ],
     [
      1778.6,
      482.4
     ],
     [
      1781.0,
      467.2
     ],
     [
      1788.2,
      453.8
     ],
     [
      1795.2,
      440.3
     ],
     [
      1801.5,
      426.7
     ],
     [
      1811.6,
      413.4
     ],
     [
      1812.3,
      398.5
     ],
     [
      1818.1,
      384.3
     ],
     [
      1823.1,
      369.8
     ],
     [
      1825.9,
      354.9
     ],
     [
      1831.7,
      339.4
     ],
     [
      1825.9,
      321.7
     ],
     [
      1820.8,
      304.3
     ],
     [
      1813.8,
      287.8
     ],
     [
      1804.8,
      271.9
     ],
     [
      1798.7,
      256.3
     ],
     [
      1783.4,
      243.3
     ],
     [
      1771.4,
      230.1
     ],
     [
      1758.9,
      217.1
     ],
     [
      1746.0,
      204.4
     ],
     [
      1736.8,
      190.3
     ],
     [
      1719.2,
      180.1
     ],
     [
      1705.1,
      169.1
     ],
     [
      1690.9,
      157.9
     ],
     [
      1676.2,
      146.8
     ],
     [
      1664.7,
      133.3
     ],
     [
      1646.6,
      125.8
     ],
     [
      1631.4,
      115.7
     ],
     [
      1615.5,
      106.3
     ],
     [
      1599.8,
      97.9
     ],
     [
      1585.9,
      86.4
     ],
     [
      1565.4,
      84.4
     ],
     [
      1546.9,
      79.5
     ],
     [
      1528.8,
      74.9
     ],
     [
      1509.8,
      71.9
     ],
     [
      1492.9,
      64.2
     ],
     [
      1472.5,
      65.7
     ],
     [
      1454.6,
      61.9
     ],
     [
      1435.9,
      60.1
     ],
     [
      1416.7,
      58.2
     ],
     [
      1398.8,
      51.2
     ],
     [
      1379.9,
      49.5
     ],
     [
      1361.0,
      47.9
     ],
     [
      1342.1,
      46.2
     ],
     [
      1323.2,
      44.6
     ],
     [
      1304.4,
      42.9
     ],
     [
      1285.4,
      41.5
     ],
     [
      1266.4,
      40.1
     ],
     [
      1247.4,
      38.7
     ],
     [
      1228.4,
      37.3
     ],
     [
      1209.5,
      35.9
     ],
     [
      1240,
      92
     ],
     [
      1365,
      100
     ],
     [
      1399,
      160
     ],
     [
      1414,
      180
     ],
     [
      1428,
      200
     ],
     [
      1442,
      220
     ],
     [
      1525,
      339
     ],
     [
      1491,
      420
     ],
     [
      1485,
      440
     ],
     [
      1477,
      460
     ],
     [
      1452,
      520
     ],
     [
      1443,
      540
     ],
     [
      1434,
      560
     ],
     [
      1429,
      580
     ],
     [
      1427,
      620
     ],
     [
      1425,
      650
     ],
     [
      1546,
      650
     ]
    ]
   },
   "ev": "medium",
   "src": [
    "08",
    "09"
   ],
   "note": "clip polygon: the tick ring pushed 7 px out to the bezel, then the dial face's inner edge (the map side), measured row by row on 09 (tacho; y 240-430 hidden under the gear letter, interpolated to a vertex at (1525, 339)) and mirrored for the speedo (08 rows agree within 1 px). The glow stops there in 08/09"
  }
 },
 "fuel": {
  "tank_l": {
   "v": 65,
   "ev": "strong",
   "src": [],
   "note": "brief: s.values.fuelL is of a 65 L tank"
  },
  "centre": {
   "v": [
    531.1,
    450.9
   ],
   "ev": "weak",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "virtual centre (only used for the fill's depth): the oil mini's needle lines meet at [1388.9, 450.9]; mirrored"
  },
  "ring": {
   "v": {
    "f": [
     0.0,
     0.25,
     0.5,
     0.75,
     1.0
    ],
    "pts": [
     [
      117,
      646
     ],
     [
      90,
      626
     ],
     [
      45,
      576
     ],
     [
      18,
      505
     ],
     [
      28,
      452
     ]
    ]
   },
   "ev": "weak",
   "src": [
    "08",
    "09"
   ],
   "note": "frame ticks (inner side of the outer frame) at 1/4, 1/2, 3/4 (4x crops, +-1.5 px); 0 = the frame's bottom end where the red reserve mark starts, 1 = the top-left corner (both weak: no tick seen). Each photo needle extended back to this ring: fuel 08/09/14 at f = [0.84, 0.872, 0.836]"
  },
  "inset": {
   "v": {
    "f": [
     0.0,
     0.507,
     0.849,
     1.0
    ],
    "v": [
     16.8,
     7.8,
     2.4,
     2.4
    ]
   },
   "ev": "medium",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "needle outer end inside the ring, along the needle (px), by f: oil 14 (cold end), oil 08/09 (notch), fuel 08/09/14; f = 1 copies the last"
  },
  "len": {
   "v": {
    "f": [
     0.0,
     0.507,
     0.849,
     1.0
    ],
    "v": [
     57.7,
     84.3,
     77.8,
     77.8
    ]
   },
   "ev": "medium",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "needle visual length by f (same sources): the needle spans the mini's interior, which narrows toward the bottom"
  },
  "dir": {
   "v": {
    "f": [
     0.0,
     0.507,
     0.849,
     1.0
    ],
    "v": [
     -25.0,
     -14.2,
     -6.4,
     -6.4
    ]
   },
   "ev": "medium",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "needle direction by f (deg, image atan2 of the inward direction, fuel side; the oil mini mirrors it). The needles are not rays from one point within 2-3 deg, so the measured directions are interpolated"
  },
  "needle": {
   "v": {
    "w0": 9.0,
    "w1": 5.5,
    "rgb": [
     245,
     92,
     80
    ],
    "tip_rgb": [
     185,
     70,
     62
    ]
   },
   "ev": "strong",
   "src": [
    "08",
    "09",
    "14",
    "39",
    "40"
   ],
   "note": "tapered red bar: width at the frame end / at the tip, core colour, the tip dims. car3 J: refitted on the close-up 40 (5 photo px per panel px; half-max 9 px at the frame end, 7.5 px a quarter from the tip) and 39 (core 244-248, 90-94, 80-82); was 10 / 4.5, [255, 112, 98]"
  },
  "fill": {
   "v": {
    "enabled": true,
    "rgb": [
     205,
     175,
     180
    ],
    "alpha": 1.0,
    "d0": 8,
    "sigma": 36,
    "depth": 95
   },
   "ev": "medium",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "the lit fill below the needle (toward f = 0): colour, alpha at the frame, then gaussian fall with depth along the ray (08 fuel: 1.0 at 8 px, 0.56 at 35, 0.21 at 55, 0.05 at 75). Gone above the needle and in 14's cold oil mini: it moves with the value"
  }
 },
 "oil": {
  "range_c": {
   "v": [
    70,
    150
   ],
   "ev": "weak",
   "src": [
    "08",
    "14"
   ],
   "note": "the scale has no numbers. 14 (COLD) shows the needle at its bottom end; 08/09 (warm engine) at the frame notch, f = 0.5; the red zone starts at f ~ 0.81. 70..150 degC linear puts warm oil (~110) on the notch and the red zone at ~135: a guess"
  },
  "mirror_of": {
   "v": "fuel",
   "ev": "medium",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "the oil mini is the fuel mini mirrored about x 960 (frame ticks, zones, notch and both needles within ~3 px); ring, inset, len, needle and fill are the fuel's, mirrored"
  },
  "centre": {
   "v": [
    1388.9,
    450.9
   ],
   "ev": "medium",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "the oil needles at the notch (08, 09) and cold end (14) meet here (2.4 px)"
  }
 },
 "map": {
  "seed": {
   "v": 20201,
   "ev": "none",
   "src": [],
   "note": "our own deterministic street layout (never BMW's data)"
  },
  "region": {
   "v": [
    [
     1395.0,
     425.0
    ],
    [
     1388.0,
     455.0
    ],
    [
     1281.0,
     589.0
    ],
    [
     1203.0,
     612.0
    ],
    [
     718.0,
     612.0
    ],
    [
     614.0,
     579.0
    ],
    [
     591.0,
     562.0
    ],
    [
     555.0,
     480.0
    ],
    [
     611.0,
     266.0
    ],
    [
     642.0,
     207.0
    ],
    [
     842.0,
     155.0
    ],
    [
     1197.0,
     155.0
    ],
    [
     1306.0,
     219.0
    ],
    [
     1322.0,
     232.0
    ],
    [
     1358.0,
     280.0
    ]
   ],
   "ev": "strong",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "g20_comfort.json map.region (hull of the drawn roads)"
  },
  "arrow": {
   "v": [
    [
     991,
     531
    ],
    [
     990,
     532
    ],
    [
     940,
     532
    ],
    [
     939,
     529
    ],
    [
     963,
     497
    ],
    [
     967,
     496
    ],
    [
     981,
     513
    ],
    [
     990,
     526
    ]
   ],
   "ev": "strong",
   "src": [
    "08",
    "09",
    "14"
   ],
   "note": "g20_comfort.json map.position_arrow"
  },
  "arrow_rgb": {
   "v": [
    240,
    73,
    66
   ],
   "ev": "strong",
   "src": [
    "08"
   ],
   "note": "g20_comfort.json colour; drawn with a slight vertical shade"
  },
  "bg": {
   "v": {
    "night": [
     46.0,
     46.0,
     56.0
    ],
    "day": [
     65.0,
     62.0,
     66.0
    ]
   },
   "ev": "medium",
   "src": [
    "08",
    "09"
   ],
   "note": "median non-road colour > 150 px inside the region edge (08 night, 09 day; 14 is much lighter and is left out)"
  },
  "fade": {
   "v": {
    "width": 120,
    "power": 2.0
   },
   "ev": "medium",
   "src": [
    "08",
    "09"
   ],
   "note": "alpha = 1 - (1 - min(d / width, 1))^power, d = distance inside map.region; measured background over the edge band reaches ~0.4 of the centre at 35 px and ~0.9 at 110 px (both looks)"
  },
  "road_rgb": {
   "v": {
    "night": [
     220.0,
     210.0,
     212.0
    ],
    "day": [
     232.0,
     221.0,
     223.0
    ]
   },
   "ev": "medium",
   "src": [
    "08",
    "09"
   ],
   "note": "road core colour (90th percentile of the road cores: the median is pulled down by antialiasing)"
  },
  "road_w": {
   "v": {
    "night": [
     3.6,
     5.0
    ],
    "day": [
     4.6,
     8.5
    ]
   },
   "ev": "medium",
   "src": [
    "08",
    "09"
   ],
   "note": "minor / main road widths (px): 08 median 3.6 p90 4.7; 09 median 5.6 p90 9.4 (09 is zoomed in)"
  },
  "px_per_m": {
   "v": 1.0,
   "ev": "weak",
   "src": [
    "08"
   ],
   "note": "map scale for the drift: side streets ~50-90 px apart in 08 ~ city blocks"
  },
  "drift_gain": {
   "v": 1.0,
   "ev": "none",
   "src": [],
   "note": "multiplier on the drift speed (speed in m/s * px_per_m * gain px/s), streets move down"
  }
 },
 "motion": {
  "tau_ms": {
   "v": 70,
   "ev": "none",
   "src": [],
   "note": "exponential approach to each new value (95 % in ~210 ms); values arrive at 4 Hz"
  },
  "eps": {
   "v": {
    "speed": 0.05,
    "rpm": 2,
    "fuelL": 0.02,
    "oil": 0.05
   },
   "ev": "none",
   "src": [],
   "note": "below this the value counts as settled (wantsFrame)"
  }
 },
 "defaults": {
  "v": {
   "speed": 0,
   "rpm": 0,
   "fuelL": 53.949999999999996,
   "oil": 110
  },
  "ev": "weak",
  "src": [
   "08"
  ],
  "note": "used when a value is null: the 08 look (fuel needle at f ~ 0.83, oil at the notch)"
 }
}/*</PARAMS>*/;

  function V(x) { return (x && typeof x === 'object' && 'v' in x && 'ev' in x) ? x.v : x; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rgb(c, a) {
    return a === undefined ? 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'
      : 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  }
  function wrap180(d) { d = ((d + 180) % 360 + 360) % 360 - 180; return d; }
  var DEG = Math.PI / 180;

  // ------------------------------------------------------------------------------------------------- dial geometry
  // sgn: +1 when values grow with the image angle (speedo, clockwise on screen), -1 for the tacho.
  var DIALS = { speed: { key: 'speedo', sgn: 1 }, rpm: { key: 'tacho', sgn: -1 } };

  function dialP(which) { return PARAMS[DIALS[which].key]; }

  /* value -> point on the tick ring (piecewise linear between measured ticks), its index and the tick axis. */
  function ringAt(sc, value) {
    var vs = sc.values, n = vs.length;
    var x = clamp(value, vs[0], vs[n - 1]);
    var i = 0;
    while (i < n - 2 && x > vs[i + 1]) i++;
    var t = (x - vs[i]) / (vs[i + 1] - vs[i] || 1);
    var a = sc.pts[i], b = sc.pts[i + 1];
    var da = sc.tick_dir[i] * DEG, db = sc.tick_dir[i + 1] * DEG;
    var dx = lerp(Math.cos(da), Math.cos(db), t), dy = lerp(Math.sin(da), Math.sin(db), t), dl = Math.hypot(dx, dy) || 1;
    return { pt: [lerp(a[0], b[0], t), lerp(a[1], b[1], t)], i: i, t: t, tick: [dx / dl, dy / dl], value: x };
  }

  function barLen(which, connected) {
    var L = V(dialP(which).len);
    return connected ? L.connected : L.stock;
  }

  /* Geometry of a stock pointer or mini needle.
   *  which: 'speed' (km/h) | 'rpm' (1/min; the scale is x1000) | 'fuel' (litres of the tank) | 'oil' (degC)
   *  -> { tip: [x, y] (outer visual end, at the scale), tail: [x, y] (inner visual end), angle (deg, image atan2 of
   *       the outward bar direction), glowBox: [x0, y0, x1, y1] | null, scalePt: [x, y] (where the bar crosses the
   *       tick ring), u: outward unit vector, width }
   *  opts.connected: theme connected (the tacho bar is shorter, photo 14). */
  function pointerAt(which, value, opts) {
    if (which === 'fuel' || which === 'oil') return miniAt(which, value);
    var D = dialP(which), sc = V(D.scale), C = V(D.centre);
    var v = which === 'rpm' ? (value || 0) / 1000 : (value || 0);
    var r = ringAt(sc, v);
    var u;
    if (V(D.orient) === 'tick') u = r.tick;
    else { var ux = r.pt[0] - C[0], uy = r.pt[1] - C[1], ul = Math.hypot(ux, uy) || 1; u = [ux / ul, uy / ul]; }
    var beyond = V(D.beyond), L = barLen(which, opts && opts.connected);
    var tip = [r.pt[0] + u[0] * beyond, r.pt[1] + u[1] * beyond];
    var tail = [tip[0] - u[0] * L, tip[1] - u[1] * L];
    return { tip: tip, tail: tail, angle: Math.atan2(u[1], u[0]) / DEG, glowBox: glowBox(which, r, u), scalePt: r.pt, u: u,
             width: V(PARAMS.bar.width), value: r.value, ringIndex: r.i };
  }

  // ---------------------------------------------------------------------------------------------------- the glow
  // The glow is added ('lighter') in the bar's polar frame about the dial's centre C:
  //   g = rgb * gain * A(phi) * W(q) * face,   phi = psi(px) - psi(bar) (deg, + toward higher values),
  //   A = exp(-phi^2 / 2 sigma^2) (sigma_hi / sigma_lo by side), q = depth inside the tick ring along the ray,
  //   W = 1 to q0 then a smoothstep fall to 0 at q1; face = inside the dial-face polygon (the map side is excluded).
  // Per dial, psi and W(q) * face are precomputed per pixel of a half-resolution buffer; per frame only A changes.
  var glowBuf = {};

  function psiOf(which, x, y) {
    var D = dialP(which), C = V(D.centre), sc = V(D.scale), sgn = DIALS[which].sgn;
    var th0 = Math.atan2(sc.pts[0][1] - C[1], sc.pts[0][0] - C[0]) / DEG;
    var th = Math.atan2(y - C[1], x - C[0]) / DEG;
    var d = sgn * (th - th0);
    return ((d + 130) % 360 + 360) % 360 - 130;            // continuous over the scale, 0 at value 0
  }

  function ringTable(which) {
    var D = dialP(which), C = V(D.centre), sc = V(D.scale), ps = [], rs = [];
    for (var i = 0; i < sc.pts.length; i++) {
      ps.push(psiOf(which, sc.pts[i][0], sc.pts[i][1]));
      rs.push(Math.hypot(sc.pts[i][0] - C[0], sc.pts[i][1] - C[1]));
    }
    return { ps: ps, rs: rs };
  }

  function interp(xs, ys, x) {
    var n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    return lerp(ys[lo], ys[hi], (x - xs[lo]) / (xs[hi] - xs[lo] || 1));
  }

  function polyBox(poly) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    poly.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    return [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
  }

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }

  function buildGlow(which) {
    var G = PARAMS.glow, face = V(G.face)[DIALS[which].key], k = V(G.res);
    var box = polyBox(face), bw = Math.ceil((box[2] - box[0]) * k), bh = Math.ceil((box[3] - box[1]) * k);
    // face mask at the buffer's resolution
    var mc = makeCanvas(bw, bh), mx = mc.getContext('2d');
    mx.scale(k, k); mx.translate(-box[0], -box[1]);
    mx.beginPath(); face.forEach(function (p, i) { if (i) mx.lineTo(p[0], p[1]); else mx.moveTo(p[0], p[1]); });
    mx.closePath(); mx.fillStyle = '#fff'; mx.fill();
    var mask = mx.getImageData(0, 0, bw, bh).data;
    var rt = ringTable(which), C = V(dialP(which).centre);
    var q0 = V(G.q0), q1 = V(G.q1), qi = G.q_in ? V(G.q_in) : -1e4;      // car3 J: q_in, none over the ticks
    var psi = new Float32Array(bw * bh), wq = new Float32Array(bw * bh);
    for (var j = 0; j < bh; j++) {
      for (var i = 0; i < bw; i++) {
        var p = j * bw + i, m = mask[p * 4 + 3] / 255;
        if (m <= 0) { psi[p] = 1e4; continue; }
        var x = box[0] + (i + 0.5) / k, y = box[1] + (j + 0.5) / k;
        var ps = psiOf(which, x, y);
        var q = interp(rt.ps, rt.rs, ps) - Math.hypot(x - C[0], y - C[1]);
        var t = clamp((q - q0) / (q1 - q0), 0, 1);
        psi[p] = ps;
        var u = clamp((q - qi) / 10, 0, 1);
        wq[p] = m * (1 - t * t * (3 - 2 * t)) * u * u * (3 - 2 * u);
      }
    }
    var cv = makeCanvas(bw, bh);
    glowBuf[which] = { box: box, k: k, w: bw, h: bh, psi: psi, wq: wq, canvas: cv, cx: cv.getContext('2d'),
                       img: new ImageData(bw, bh), key: null };
  }

  function glowBox(which, r, u) {
    var G = PARAMS.glow;
    var b = glowBuf[which];
    var face = V(G.face)[DIALS[which].key];
    var fb = b ? b.box : polyBox(face);
    if (!V(G.gain)) return null;
    var D = dialP(which), C = V(D.centre), rt = ringTable(which), sgn = DIALS[which].sgn;
    var psiBar = psiOf(which, C[0] + u[0] * 100, C[1] + u[1] * 100);
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    var lo = -2.6 * V(G.sigma_lo), hi = 2.6 * V(G.sigma_hi), q1 = V(G.q1);
    var th0 = Math.atan2(V(D.scale).pts[0][1] - C[1], V(D.scale).pts[0][0] - C[0]) / DEG;
    for (var a = lo; a <= hi + 1e-6; a += (hi - lo) / 24) {
      var ps = psiBar + a, th = (th0 + sgn * ps) * DEG, rr = interp(rt.ps, rt.rs, ps) + 7;
      [rr, Math.max(0, rr - q1)].forEach(function (R) {
        var x = C[0] + Math.cos(th) * R, y = C[1] + Math.sin(th) * R;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      });
    }
    // the wedge is clipped to the face polygon
    return [Math.max(x0, fb[0]), Math.max(y0, fb[1]), Math.min(x1, fb[2]), Math.min(y1, fb[3])].map(Math.round);
  }

  function drawGlow(ctx, which, geo, day) {
    var G = PARAMS.glow, gain = V(G.gain);
    if (!gain) return;
    if (!glowBuf[which]) buildGlow(which);
    var b = glowBuf[which], C = V(dialP(which).centre);
    var psiBar = psiOf(which, C[0] + geo.u[0] * 100, C[1] + geo.u[1] * 100);
    var col = V(G.rgb)[day ? 'day' : 'night'];
    var key = psiBar.toFixed(3) + '|' + gain + '|' + col.join(',');
    if (b.key !== key) {
      var sh = V(G.sigma_hi), sl = V(G.sigma_lo), lim = 3.2 * Math.max(sh, sl);
      var d = b.img.data, n = b.w * b.h, r = col[0] * gain, g = col[1] * gain, bl = col[2] * gain;
      for (var p = 0; p < n; p++) {
        var o = p * 4, phi = b.psi[p] - psiBar, a = 0;
        if (phi > -lim && phi < lim) {
          var s = phi > 0 ? sh : sl;
          a = Math.exp(-phi * phi / (2 * s * s)) * b.wq[p];
        }
        d[o] = r * a; d[o + 1] = g * a; d[o + 2] = bl * a; d[o + 3] = 255;
      }
      b.cx.putImageData(b.img, 0, 0);
      b.key = key;
    }
    ctx.save();
    ctx.globalCompositeOperation = V(G.composite);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(b.canvas, b.box[0], b.box[1], b.w / b.k, b.h / b.k);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------------------- bars, band, minis
  function drawBar(ctx, which, geo, day) {
    var B = PARAMS.bar, w = V(B.width), rim = V(B.rim), sgn = DIALS[which].sgn;
    var u = geo.u;
    // unit normal toward LOWER values: tacho values fall with growing image angle, the speedo's rise
    var nl = sgn > 0 ? [u[1], -u[0]] : [-u[1], u[0]];
    var a = [geo.tip[0] - u[0] * w / 2, geo.tip[1] - u[1] * w / 2];      // round caps restore the visual ends
    var b = [geo.tail[0] + u[0] * w / 2, geo.tail[1] + u[1] * w / 2];
    ctx.save();
    // soft shadow beside the bar on the low-value side (black, alpha falling with the distance d from the axis)
    var sh = B.shadow ? V(B.shadow) : null;
    if (sh && sh.alpha > 0) {
      var t0 = geo.tip, t1 = geo.tail, dm = sh.dmax;
      var g = ctx.createLinearGradient(t0[0], t0[1], t0[0] + nl[0] * dm, t0[1] + nl[1] * dm);
      [0, sh.d0, sh.d0 + sh.lambda * 0.5, sh.d0 + sh.lambda, sh.d0 + 2 * sh.lambda, sh.d0 + 3 * sh.lambda, dm].forEach(function (d) {
        var al = d <= sh.d0 ? sh.alpha : sh.alpha * Math.exp(-(d - sh.d0) / sh.lambda);
        if (d >= dm) al = 0;
        g.addColorStop(clamp(d / dm, 0, 1), 'rgba(0,0,0,' + al.toFixed(4) + ')');
      });
      if (sh.blur) ctx.filter = 'blur(' + sh.blur + 'px)';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(t0[0], t0[1]); ctx.lineTo(t1[0], t1[1]);
      ctx.lineTo(t1[0] + nl[0] * dm, t1[1] + nl[1] * dm); ctx.lineTo(t0[0] + nl[0] * dm, t0[1] + nl[1] * dm);
      ctx.closePath(); ctx.fill();
      ctx.filter = 'none';
    }
    ctx.lineCap = V(B.cap);
    ctx.lineWidth = rim.width;
    // thin dark lines along the core: at rim.offset toward the low side, fainter on the high side
    [[rim.offset, rim.alpha], [-(w / 2 + rim.width / 2 + 0.5), rim.hi_alpha || 0]].forEach(function (q) {
      if (!q[1]) return;
      var ox = nl[0] * q[0], oy = nl[1] * q[0];
      ctx.strokeStyle = rgb(rim.rgb, q[1]);
      ctx.beginPath(); ctx.moveTo(a[0] + ox, a[1] + oy); ctx.lineTo(b[0] + ox, b[1] + oy); ctx.stroke();
    });
    ctx.strokeStyle = rgb(V(B.rgb)[day ? 'day' : 'night']);
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.restore();
  }

  function drawBand(ctx, which, geo) {
    var D = dialP(which);
    if (!D.band) return;
    var bd = V(D.band);
    if (!bd.enabled) return;
    var sc = V(D.scale), C = V(D.centre), v = geo.value;
    if (v <= bd.from + 1e-3) return;
    // the band follows the tick ring smoothed over +-2 ticks (the raw tick ends wobble by ~1 px)
    if (!sc._smooth) {
      sc._smooth = sc.pts.map(function (p, i) {
        var sx = 0, sy = 0, n = 0;
        for (var j = Math.max(0, i - 2); j <= Math.min(sc.pts.length - 1, i + 2); j++) { sx += sc.pts[j][0]; sy += sc.pts[j][1]; n++; }
        return [sx / n, sy / n];
      });
    }
    var sm = { values: sc.values, pts: sc._smooth, tick_dir: sc.tick_dir };
    var pts = [];
    function push(p) {
      var ux = p[0] - C[0], uy = p[1] - C[1], l = Math.hypot(ux, uy) || 1;
      pts.push([p[0] - ux / l * bd.depth, p[1] - uy / l * bd.depth]);
    }
    push(ringAt(sm, bd.from).pt);
    for (var i = 0; i < sc.values.length; i++) if (sc.values[i] > bd.from && sc.values[i] < v) push(sm.pts[i]);
    push(ringAt(sm, v).pt);
    ctx.save();
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    ctx.strokeStyle = rgb(bd.rgb); ctx.lineWidth = bd.width;
    ctx.beginPath(); pts.forEach(function (p, k) { if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.stroke();
    ctx.restore();
  }

  // minis: computed in the fuel mini's frame; the oil mini is its mirror about x = 960
  function miniF(which, value) {
    if (which === 'fuel') return clamp((value || 0) / V(PARAMS.fuel.tank_l), 0, 1);
    var R = V(PARAMS.oil.range_c);
    return clamp(((value || 0) - R[0]) / (R[1] - R[0]), 0, 1);
  }
  function tab(t, f) { return interp(t.f, t.v, f); }
  function ringF(f) {
    var R = V(PARAMS.fuel.ring), fs = R.f, ps = R.pts;
    var i = 0; while (i < fs.length - 2 && f > fs[i + 1]) i++;
    var t = clamp((f - fs[i]) / (fs[i + 1] - fs[i]), 0, 1);
    return [lerp(ps[i][0], ps[i + 1][0], t), lerp(ps[i][1], ps[i + 1][1], t)];
  }
  function miniAt(which, value) {
    var F = PARAMS.fuel, f = miniF(which, value), C = V(F.centre);
    var R = ringF(f), ux, uy;
    if (F.dir) { var dg = tab(V(F.dir), f) * DEG; ux = Math.cos(dg); uy = Math.sin(dg); }      // inward, measured by f
    else { ux = C[0] - R[0]; uy = C[1] - R[1]; var ul = Math.hypot(ux, uy); ux /= ul; uy /= ul; }
    var ins = tab(V(F.inset), f), L = tab(V(F.len), f);
    var o = [R[0] + ux * ins, R[1] + uy * ins], i = [o[0] + ux * L, o[1] + uy * L];
    var m = which === 'oil' ? function (p) { return [1920 - p[0], p[1]]; } : function (p) { return p; };
    var tip = m(o), tail = m(i);
    var uo = [tip[0] - tail[0], tip[1] - tail[1]], uol = Math.hypot(uo[0], uo[1]);
    return { tip: tip, tail: tail, angle: Math.atan2(uo[1], uo[0]) / DEG, glowBox: null, scalePt: m(R),
             u: [uo[0] / uol, uo[1] / uol], f: f, width: V(F.needle).w0 };
  }

  var fillBuf = {};
  function buildFill(which) {
    // per pixel of the mini's box: position f along the ring (by angle about the mini centre) and depth inside it
    var F = PARAMS.fuel, C = V(F.centre), R = V(F.ring), fl = V(F.fill);
    var fpts = R.pts, fs = R.f;
    var angs = fpts.map(function (p) { return Math.atan2(p[1] - C[1], p[0] - C[0]) / DEG; });
    var rads = fpts.map(function (p) { return Math.hypot(p[0] - C[0], p[1] - C[1]); });
    // angles fall from f = 0 (bottom) to f = 1 (top) for the fuel mini's rays from the right: sort ascending
    var order = angs.map(function (a, i) { return i; }).sort(function (a, b) { return angs[a] - angs[b]; });
    var A = order.map(function (i) { return angs[i]; }), Fv = order.map(function (i) { return fs[i]; }), Rv = order.map(function (i) { return rads[i]; });
    var x0 = 0, y0 = 425, w = 235, h = 235;                         // the fuel mini's box (panel px), with margin
    var fpx = new Float32Array(w * h), dpx = new Float32Array(w * h);
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var x = x0 + i + 0.5, y = y0 + j + 0.5, a = Math.atan2(y - C[1], x - C[0]) / DEG, p = j * w + i;
      if (a < A[0] || a > A[A.length - 1]) { fpx[p] = 9; continue; }
      fpx[p] = interp(A, Fv, a);
      dpx[p] = interp(A, Rv, a) - Math.hypot(x - C[0], y - C[1]);
    }
    var cv = makeCanvas(w, h);
    fillBuf[which] = { x0: which === 'oil' ? 1920 - x0 - w : x0, y0: y0, w: w, h: h, f: fpx, d: dpx, canvas: cv,
                       cx: cv.getContext('2d'), img: new ImageData(w, h), key: null, mirror: which === 'oil' };
  }

  function drawFill(ctx, which, f) {
    var fl = V(PARAMS.fuel.fill);
    if (!fl.enabled) return;
    if (!fillBuf[which]) buildFill(which);
    var b = fillBuf[which], key = f.toFixed(4);
    if (b.key !== key) {
      var d = b.img.data, n = b.w * b.h;
      for (var p = 0; p < n; p++) {
        var o = p * 4, fp = b.f[p], dp = b.d[p], a = 0;
        if (fp <= f && dp >= 0 && dp < fl.depth) {
          a = dp <= fl.d0 ? 1 : Math.exp(-Math.pow((dp - fl.d0) / fl.sigma, 2));
          a *= fl.alpha * clamp((f - fp) * 400 + 0.5, 0, 1) * clamp(fp * 400 + 0.5, 0, 1);  // 1-2 px soft ends
        }
        var q = o;
        if (b.mirror) { var jj = (p / b.w) | 0, ii = p - jj * b.w; q = (jj * b.w + (b.w - 1 - ii)) * 4; }
        d[q] = fl.rgb[0]; d[q + 1] = fl.rgb[1]; d[q + 2] = fl.rgb[2]; d[q + 3] = Math.round(255 * a);
      }
      b.cx.putImageData(b.img, 0, 0);
      b.key = key;
    }
    ctx.drawImage(b.canvas, b.x0, b.y0);
  }

  function drawNeedle(ctx, which, geo) {
    var N = V(PARAMS.fuel.needle), u = geo.u;                     // u: outward (from the tail to the tip)
    var n = [-u[1], u[0]], o = geo.tip, i = geo.tail, r1 = N.w1 / 2;
    // the tail end is round (radius w1/2): pull the polygon's tail in by r1
    var ti = [i[0] + u[0] * r1, i[1] + u[1] * r1];
    ctx.save();
    var g = ctx.createLinearGradient(o[0], o[1], i[0], i[1]);
    g.addColorStop(0, rgb(N.rgb)); g.addColorStop(0.7, rgb(N.rgb)); g.addColorStop(1, rgb(N.tip_rgb));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(o[0] + n[0] * N.w0 / 2, o[1] + n[1] * N.w0 / 2);
    ctx.lineTo(ti[0] + n[0] * r1, ti[1] + n[1] * r1);
    var a0 = Math.atan2(n[1], n[0]);
    ctx.arc(ti[0], ti[1], r1, a0, a0 + Math.PI, false);           // through -u: the round tail end
    ctx.lineTo(o[0] - n[0] * N.w0 / 2, o[1] - n[1] * N.w0 / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------- smoothing
  var cur = {}, tgt = {}, lastT = null;
  var KEYS = ['speed', 'rpm', 'fuelL', 'oil'];
  function step(s) {
    var vals = (s && s.values) || {}, def = V(PARAMS.defaults), t = (s && typeof s.t === 'number') ? s.t : now();
    var dt = lastT === null ? 1e9 : clamp(t - lastT, 0, 1000);
    lastT = t;
    var tau = V(PARAMS.motion.tau_ms), k = 1 - Math.exp(-dt / tau);
    KEYS.forEach(function (n) {
      var v = vals[n];
      tgt[n] = (v === null || v === undefined || !isFinite(v)) ? def[n] : +v;
      if (cur[n] === undefined) cur[n] = tgt[n];
      else cur[n] += (tgt[n] - cur[n]) * k;
    });
    return dt;
  }
  function now() { return (typeof performance !== 'undefined') ? performance.now() : Date.now(); }

  // ------------------------------------------------------------------------------------------------------ map
  var map = null;
  function rng(seed) {                    // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(a, b) { return (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x632BE5AB, 0x85EBCA77)) >>> 0; }

  var BAND = 360;                         // world band height (px); world: X right of the car, Y forward (up)
  function sideX(k, side, seed) {         // a secondary road's x at band boundary k (continuous across bands)
    var r = rng(hash2(k, seed + side * 7919));
    return side * (170 + 170 * r());
  }
  function bandRoads(k, seed) {
    var r = rng(hash2(k, seed)), roads = [], Y0 = k * BAND, Y1 = Y0 + BAND;
    // secondary roads left / right of the main one (polylines, continuous across bands; sometimes absent)
    [-1, 1].forEach(function (side) {
      var on = rng(hash2(k, seed + side * 31))() < 0.8;
      if (!on) return;
      var xa = sideX(k, side, seed), xb = sideX(k + 1, side, seed), xm = (xa + xb) / 2 + (r() - 0.5) * 60;
      roads.push({ c: 0, p: [[xa, Y0], [xm, Y0 + BAND / 2], [xb, Y1]] });
    });
    // cross streets: from the main road out to a side, some with a hooked end, some crossing both ways
    var n = 2 + Math.floor(r() * 3);
    for (var i = 0; i < n; i++) {
      var y = Y0 + (i + 0.2 + 0.6 * r()) * BAND / n, side = r() < 0.5 ? -1 : 1, len = 70 + r() * 300;
      var tilt = (r() - 0.5) * 0.35, x1 = side * len, y1 = y + x1 * tilt;
      var p = [[0, y], [x1, y1]];
      if (r() < 0.35) p.push([x1 + side * 12, y1 + (r() < 0.5 ? -1 : 1) * (25 + r() * 40)]);
      roads.push({ c: 0, p: p });
      if (r() < 0.3) roads.push({ c: 0, p: [[0, y], [-side * (60 + r() * 200), y + (r() - 0.5) * 30]] });
    }
    // a comb of short stubs off a secondary road (like 08's), and a curved lane, now and then
    [-1, 1].forEach(function (side) {
      if (r() < 0.45) {
        var xs = sideX(k, side, seed), m = 3 + Math.floor(r() * 3), dir = r() < 0.5 ? -1 : 1, L = 40 + r() * 70;
        for (var j = 0; j < m; j++) {
          var yy = Y0 + BAND * (0.15 + 0.7 * j / m), xx = xs + (sideX(k + 1, side, seed) - xs) * (yy - Y0) / BAND;
          roads.push({ c: 0, p: [[xx, yy], [xx + dir * L, yy + (r() - 0.5) * 8]] });
        }
      }
      if (r() < 0.3) {
        var ya = Y0 + r() * BAND * 0.5, xa = side * (40 + r() * 120), xb = side * (260 + r() * 260);
        roads.push({ c: 0, q: [[xa, ya], [xb, ya + 40 + r() * 80], [xb + side * 60, ya + 180 + r() * 120]] });
      }
    });
    // a diagonal through-road now and then
    if (r() < 0.35) {
      var yy = Y0 + r() * BAND, s = r() < 0.5 ? -1 : 1, sl = 0.35 + r() * 0.5;
      roads.push({ c: 1, p: [[-700, yy - s * 700 * sl], [700, yy + s * 700 * sl]] });
    }
    // a roundabout on the main road, rarely (09 shows one)
    if (r() < 0.12) roads.push({ c: 1, ring: [0, Y0 + BAND * (0.3 + 0.4 * r()), 24] });
    return roads;
  }

  function initMap() {
    var M = PARAMS.map, poly = V(M.region), box = polyBox(poly);
    var w = box[2] - box[0], h = box[3] - box[1];
    // edge fade mask: chamfer distance inside the polygon -> alpha
    var mc = makeCanvas(w, h), mx = mc.getContext('2d');
    mx.translate(-box[0], -box[1]);
    mx.beginPath(); poly.forEach(function (p, i) { if (i) mx.lineTo(p[0], p[1]); else mx.moveTo(p[0], p[1]); });
    mx.closePath(); mx.fillStyle = '#fff'; mx.fill();
    var id = mx.getImageData(0, 0, w, h), a = id.data, D = new Float32Array(w * h), INF = 1e6, i, j, p;
    for (p = 0; p < w * h; p++) D[p] = a[p * 4 + 3] > 127 ? INF : 0;
    var d1 = 1, d2 = Math.SQRT2;
    for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
      p = j * w + i; if (!D[p]) continue;
      var m = D[p];
      if (i > 0) m = Math.min(m, D[p - 1] + d1); else m = Math.min(m, d1);
      if (j > 0) { m = Math.min(m, D[p - w] + d1); if (i > 0) m = Math.min(m, D[p - w - 1] + d2); if (i < w - 1) m = Math.min(m, D[p - w + 1] + d2); } else m = Math.min(m, d1);
      D[p] = m;
    }
    for (j = h - 1; j >= 0; j--) for (i = w - 1; i >= 0; i--) {
      p = j * w + i; if (!D[p]) continue;
      var m2 = D[p];
      if (i < w - 1) m2 = Math.min(m2, D[p + 1] + d1); else m2 = Math.min(m2, d1);
      if (j < h - 1) { m2 = Math.min(m2, D[p + w] + d1); if (i < w - 1) m2 = Math.min(m2, D[p + w + 1] + d2); if (i > 0) m2 = Math.min(m2, D[p + w - 1] + d2); } else m2 = Math.min(m2, d1);
      D[p] = m2;
    }
    var fd = V(M.fade);
    for (p = 0; p < w * h; p++) {
      var t = D[p] > 0 ? 1 - Math.pow(1 - Math.min((D[p] - 0.5) / fd.width, 1), fd.power) : 0;
      a[p * 4] = a[p * 4 + 1] = a[p * 4 + 2] = 255; a[p * 4 + 3] = Math.round(255 * clamp(t, 0, 1));
    }
    mx.setTransform(1, 0, 0, 1, 0, 0);
    mx.putImageData(id, 0, 0);
    var tile = makeCanvas(w, h);
    var ar = V(M.arrow), ab = polyBox(ar);
    map = { box: box, w: w, h: h, mask: mc, tile: tile, tx: tile.getContext('2d'), odo: 0, key: null,
            car: [(ab[0] + ab[2]) / 2, ab[3] - 8], cache: {} };
  }

  function roadsFor(k) {
    var c = map.cache;
    if (!c[k]) {
      c[k] = bandRoads(k, V(PARAMS.map.seed));
      var keys = Object.keys(c);
      if (keys.length > 40) keys.slice(0, keys.length - 40).forEach(function (q) { delete c[q]; });
    }
    return c[k];
  }

  function drawMapTile(day) {
    var M = PARAMS.map, x = map.tx, look = day ? 'day' : 'night';
    var bg = V(M.bg)[look], rc = V(M.road_rgb)[look], rw = V(M.road_w)[look];
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = rgb(bg); x.fillRect(0, 0, map.w, map.h);
    // world -> tile: X = 0 at the car's x; world Y = odo at the car; Y grows upward
    var cx = map.car[0] - map.box[0], cy = map.car[1] - map.box[1];
    x.setTransform(1, 0, 0, -1, cx, cy + map.odo);              // tile = (X + cx, cy - (Y - odo))
    var yTop = map.odo + cy, yBot = map.odo - (map.h - cy);       // visible world Y range
    var k0 = Math.floor((yBot - 60) / BAND) - 2, k1 = Math.floor((yTop + 60) / BAND) + 2;   // +-2: diagonals reach 600 px
    x.strokeStyle = rgb(rc); x.lineCap = 'round'; x.lineJoin = 'round';
    for (var cls = 0; cls < 2; cls++) {
      x.lineWidth = rw[cls];
      x.beginPath();
      if (cls === 1) { x.moveTo(0, yBot - 50); x.lineTo(0, yTop + 50); }      // the car's road, always there
      for (var k = k0; k <= k1; k++) {
        roadsFor(k).forEach(function (r) {
          if (r.c !== cls) return;
          if (r.ring) { x.moveTo(r.ring[0] + r.ring[2], r.ring[1]); x.arc(r.ring[0], r.ring[1], r.ring[2], 0, 2 * Math.PI); return; }
          if (r.q) { x.moveTo(r.q[0][0], r.q[0][1]); x.quadraticCurveTo(r.q[1][0], r.q[1][1], r.q[2][0], r.q[2][1]); return; }
          r.p.forEach(function (q, i) { if (i) x.lineTo(q[0], q[1]); else x.moveTo(q[0], q[1]); });
        });
      }
      x.stroke();
    }
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(map.mask, 0, 0);
    x.globalCompositeOperation = 'source-over';
  }

  function drawArrow(ctx) {
    var ar = V(PARAMS.map.arrow), b = polyBox(ar), c = V(PARAMS.map.arrow_rgb);
    var tip = [(b[0] + b[2]) / 2, b[1] + 1], l = [b[0] + 0.5, b[3] - 1.5], r = [b[2] - 0.5, b[3] - 1.5];
    var notch = [tip[0], b[3] - 9];
    ctx.save();
    var g = ctx.createLinearGradient(0, b[1], 0, b[3]);
    g.addColorStop(0, rgb([Math.min(255, c[0] + 10), c[1] + 70, c[2] + 45]));
    g.addColorStop(0.55, rgb([c[0], c[1] + 30, c[2] + 15]));
    g.addColorStop(0.75, rgb([c[0] - 5, c[1] - 15, c[2] - 6]));
    g.addColorStop(1, rgb([c[0] - 20, c[1] - 20, c[2] - 8]));
    ctx.beginPath(); ctx.moveTo(tip[0], tip[1]); ctx.lineTo(r[0], r[1]); ctx.lineTo(notch[0], notch[1]); ctx.lineTo(l[0], l[1]); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.lineJoin = 'round'; ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(70,5,8,0.7)'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tip[0] - 0.5, tip[1] + 2); ctx.lineTo(l[0] + 2, l[1] - 1.5);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,200,180,0.6)'; ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------------- API
  var mapDt = 0, lastGaugesT = null;

  function drawMap(ctx, s) {
    if (!map) initMap();
    var t = (s && typeof s.t === 'number') ? s.t : now();
    var spd = (s && s.values && isFinite(s.values.speed) && s.values.speed !== null) ? Math.max(0, +s.values.speed) : 0;
    if (map.lastT !== undefined) {
      var dt = clamp(t - map.lastT, 0, 250);
      var M = PARAMS.map;
      map.odo += (cur.speed !== undefined ? Math.max(0, cur.speed) : spd) / 3.6 * V(M.px_per_m) * V(M.drift_gain) * dt / 1000;
    }
    map.lastT = t;
    var key = (s && s.day ? 'd' : 'n') + (Math.round(map.odo * 4) / 4);
    if (map.key !== key) { drawMapTile(!!(s && s.day)); map.key = key; }
    ctx.save();
    ctx.drawImage(map.tile, map.box[0], map.box[1]);
    drawArrow(ctx);
    ctx.restore();
  }

  function drawGauges(ctx, s) {
    step(s);
    var day = !!(s && s.day), conn = !!(s && s.themeConnected);
    var gs = pointerAt('speed', cur.speed, { connected: conn }), gr = pointerAt('rpm', cur.rpm, { connected: conn });
    ctx.save();
    drawGlow(ctx, 'speed', gs, day);
    drawGlow(ctx, 'rpm', gr, day);
    drawBand(ctx, 'speed', gs);
    drawBand(ctx, 'rpm', gr);
    drawBar(ctx, 'speed', gs, day);
    drawBar(ctx, 'rpm', gr, day);
    var gf = miniAt('fuel', cur.fuelL), go = miniAt('oil', cur.oil);
    drawFill(ctx, 'fuel', gf.f);
    drawFill(ctx, 'oil', go.f);
    drawNeedle(ctx, 'fuel', gf);
    drawNeedle(ctx, 'oil', go);
    ctx.restore();
  }

  function wantsFrame(s) {
    var vals = (s && s.values) || {}, def = V(PARAMS.defaults), eps = V(PARAMS.motion.eps);
    for (var i = 0; i < KEYS.length; i++) {
      var n = KEYS[i], v = vals[n];
      var tv = (v === null || v === undefined || !isFinite(v)) ? def[n] : +v;
      if (cur[n] === undefined || Math.abs(tv - cur[n]) > eps[n]) return true;
    }
    var spd = vals.speed;
    return !!(spd && spd > 0.5);                                   // the map drifts
  }

  function init(base) {
    // no assets to load: everything is procedural. Builds the per-pixel buffers now (they are also built lazily).
    return new Promise(function (resolve) {
      try { buildGlow('speed'); buildGlow('rpm'); buildFill('fuel'); buildFill('oil'); initMap(); } catch (e) { /* lazily later */ }
      resolve(window.G20Live);
    });
  }

  window.G20Live = { init: init, drawMap: drawMap, drawGauges: drawGauges, wantsFrame: wantsFrame, PARAMS: PARAMS,
                     pointerAt: pointerAt,
                     _debug: { cur: cur, ringAt: ringAt, miniAt: miniAt, drawGlow: drawGlow, drawBar: drawBar, drawBand: drawBand,
                               drawFill: drawFill, drawNeedle: drawNeedle, map: function () { return map; } } };
})();
