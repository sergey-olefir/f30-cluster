/* G20 bench simulation, package C: the stock G20 Comfort cluster's icons and texts (telltales, belts, airbag,
 * bottom row, digital speed, labels, speed-limit sign, check-control panel), drawn as our own vector redraws with a
 * free font (Roboto, SIL OFL, bench/g20/fonts/). Bench only: nothing here goes into the app or the car.
 *
 * Geometry is panel px (1920x720), fitted to the rectified photos 08 (stock, night, start-up check), 09 (stock, day)
 * and 14 (theme connected); see docs/G20SIM-C-icons-text.md for the measurements, evidence and QC.
 * No photo pixels and no BMW artwork or fonts: every shape below is our own drawing.
 *
 * window.G20C = { init(base) -> Promise, drawUnder(ctx, s), drawOver(ctx, s), lamps, PRESETS, STYLE }
 */
(function () {
  'use strict';

  var FAMILY = 'G20Roboto';
  var FONT_FILE = 'fonts/Roboto-wdth-wght.subset.ttf';
  var fontOk = false;

  // ------------------------------------------------------------------------------------------------ colours
  // Measured on the rects (core = median of the brightest half of each element's ink): night = 08, day = 09.
  // The camera's auto exposure makes 08 and 09 alike within noise for every icon and text (the white texts clip in
  // both); the day values are 09's where the element is lit in 09, else the night value (marked in the report).
  var COL = {
    night: {
      white: [255, 249, 252], unit: [240, 218, 225], label: [220, 200, 206], rpm: [240, 215, 220],
      kmh: [222, 202, 209], cold: [235, 224, 228], pump: [240, 216, 223],
      red: [244, 106, 88], amber: [250, 184, 100], green: [126, 216, 80], parkGreen: [126, 238, 64],
      belt: [234, 66, 82], airbag: [238, 55, 74],
      signRed: [233, 37, 62], signWhite: [254, 241, 246], signText: [52, 42, 47],
      ccFrame: [248, 220, 223], ccText: [255, 251, 254], ccBase: [0, 0, 0],
      ccFill: [[606, [88, 72, 82]], [630, [70, 56, 66]], [655, [46, 39, 49]], [680, [9, 8, 12]], [700, [1, 1, 2]], [720, [0, 0, 0]]]
    },
    day: {
      white: [255, 250, 252], unit: [244, 220, 227], label: [228, 202, 206], rpm: [240, 215, 220],
      kmh: [222, 202, 209], cold: [235, 224, 228], pump: [249, 215, 224],
      red: [244, 106, 88], amber: [250, 184, 100], green: [128, 226, 82], parkGreen: [126, 243, 62],
      belt: [234, 66, 82], airbag: [238, 55, 74],
      signRed: [233, 37, 62], signWhite: [254, 244, 248], signText: [52, 42, 47],
      ccFrame: [248, 220, 223], ccText: [255, 251, 254], ccBase: [0, 0, 0],
      ccFill: [[606, [88, 72, 82]], [630, [70, 56, 66]], [655, [46, 39, 49]], [680, [8, 8, 10]], [700, [0, 0, 0]], [720, [0, 0, 0]]]
    }
  };
  // Empty space is pure black (polish C, the owner's colour rule): ccBase was the photos' lit-up black ([9, 12, 22]
  // night, [14, 19, 23] day), and the panel fill's last stops faded into it. The fill's stops are now the measured
  // ones times smoothstep(L(base), L(base) + 0.1, L(stop)) (bake/src/G20/structure/clean_soft.py lift), so its
  // top keeps its colour and its foot reaches black.

  // Soft halo of a lit lamp on the LCD. Measured: 2-3 px outside the ink the lamps are +6..+10 levels brighter than
  // the white texts at the same distance (which only show the camera's blur), so the halo is faint.
  var HALO = { blur: 5, alpha: 0.28 };

  // ------------------------------------------------------------------------------------------- text styles
  // size = font px; wght = Roboto weight; stretch = canvas fontStretch (semi-condensed = wdth 87.5, condensed = 75);
  // sx = extra horizontal scale; x = pen x (align left), centre (align centre) or right end (align right) in panel px;
  // base = baseline y. Fitted by bake/src/G20/icons/calibrate_text.py on the rects (ink height -> size, ink width ->
  // sx, ink box -> pen x and baseline), then checked by the QC harness.
  var T = {
    range:     { size: 47, wght: 700, stretch: 'semi-condensed', sx: 0.975, x: 182.7, base: 699.5, align: 'left' },
    rangeUnit: { size: 33.3, wght: 600, stretch: 'semi-condensed', sx: 1.06, gap: 3.2, base: 699.0 },
    clock:     { size: 47, wght: 700, stretch: 'semi-condensed', sx: 0.973, x: 397.0, base: 699.5, align: 'center' },
    temp:      { size: 47, wght: 700, stretch: 'semi-condensed', sx: 0.975, x: 1624.0, base: 700.0, align: 'right' },
    tempC:     { size: 35, wght: 500, stretch: 'normal', sx: 0.98, x: 1643.0, base: 699.8, align: 'left' },
    degree:    { cx: 1637.6, cy: 679.6, r: 5.0, lw: 2.8 },
    street:    { size: 44, wght: 450, stretch: 'semi-condensed', sx: 0.953, x: 961.0, base: 699.8, align: 'center', maxW: 520 },
    cc1:       { size: 35.5, wght: 750, stretch: 'semi-condensed', sx: 0.985, x: 969.0, base: 644.8, align: 'center' },
    cc2:       { size: 35.5, wght: 750, stretch: 'semi-condensed', sx: 0.985, x: 969.0, base: 690.8, align: 'center' },
    speed:     { size: 105.5, wght: 700, stretch: 'semi-condensed', sx: 1.027, x: 530.2, base: 396.0, align: 'right' },
    speedUnit: { size: 27.2, wght: 600, stretch: 'semi-condensed', sx: 1.13, x: 539.3, base: 393.2, align: 'left' },
    modeC:     { size: 31.5, wght: 700, stretch: 'condensed', sx: 1.055, x: 1222.4, base: 366.8, pitch: 28, align: 'left' },
    modeB:     { size: 32.9, wght: 700, stretch: 'condensed', sx: 0.986, x: 1224.8, base: 682.8, pitch: 28, align: 'left' },
    gearC:     { size: 106, wght: 700, stretch: 'semi-condensed', sx: { P: 0.874, D: 1.028, R: 0.95, N: 0.95, S: 0.95 }, x: 1518.6, base: 395.0, align: 'center' },
    gearB:     { size: 49.3, wght: 750, stretch: 'semi-condensed', sx: { P: 1.03, D: 1.21, R: 1.12, N: 1.12, S: 1.12 }, x: 1410.7, base: 703.0, align: 'center' },
    rpm1:      { size: 34.5, wght: 600, stretch: 'semi-condensed', sx: 0.95, x: 1424.0, base: 596.5, align: 'left' },
    rpm2:      { size: 34.5, wght: 600, stretch: 'semi-condensed', sx: 0.925, x: 1424.0, base: 625.8, align: 'left' },
    off:       { size: 32.9, wght: 750, stretch: 'semi-condensed', sx: 0.99, x: 1514.4, base: 603.8, align: 'left' },
    tacho0:    { size: 54.8, wght: 550, stretch: 'normal', sx: 1.087, x: 1518.0, base: 613.5, align: 'left' },
    cold:      { size: 31.5, wght: 750, stretch: 'condensed', sx: 0.892, x: 1841.9, base: 657.8, align: 'left' },
    limit2:    { size: 35.6, wght: 420, stretch: 'semi-condensed', sx: 0.93, x: 538.9, base: 633.8, align: 'center' },
    limit3:    { size: 33.0, wght: 420, stretch: 'condensed', sx: 0.86, x: 538.9, base: 632.8, align: 'center' },
    autoH:     { size: 34.5, wght: 800, stretch: 'condensed', sx: 0.86, x: 1776.6, base: 203.6, align: 'left' },
    absText:   { size: 17, wght: 800, stretch: 'condensed', sx: 0.95, x: 43.0, base: 352.5, align: 'center' },
    parkP:     { size: 33, wght: 800, stretch: 'semi-condensed', sx: 1.0, x: 1870.0, base: 249.5, align: 'center' }
  };

  // ------------------------------------------------------------------------------------------------ geometry
  // Icon geometry in panel px (ink boxes from the rects, see the report).
  var G = {
    sign: { cx: 539.3, cy: 621.8, rOut: 41.0, rIn: 33.2 },
    cc: {
      // the opaque base hides the stock bottom frame line's ends between x 695 and 1224 (08: they are not drawn
      // while the panel shows), then the vertical fill gradient, faded towards both ends
      base: [[695, 621], [705, 619.5], [712, 615], [720, 611], [735, 605.5], [760, 603.5], [1140, 603.5], [1170, 605],
             [1190, 608.3], [1203, 612], [1214, 618.5], [1224, 621], [1224, 720], [695, 720]],
      frame: [[704, 619.5], [712, 615], [720, 611], [735, 605.5], [760, 603.8], [1140, 603.8], [1170, 605.2],
              [1190, 608.4], [1203, 612.2], [1215, 619]],
      frameW: 3.0, frameFade: [703, 716, 1200, 1216], fillFade: [700, 800, 1140, 1222]
    },
    ccInfo: { x: 736, y: 637, w: 17, h: 45 },          // the 'i' left of the message
    infoTacho: { x: 1256, y: 591, w: 15, h: 36 }       // the 'i' under the map, right
  };

  // ------------------------------------------------------------------------------------------------ lamps
  var LAMPS = [
    { id: 'tt.brake', name: 'Brake warning (red)', group: 'telltale', colour: 'red', onPanel: true },
    { id: 'tt.tpms', name: 'Tyre pressure (amber)', group: 'telltale', colour: 'amber', onPanel: true },
    { id: 'tt.abs', name: 'ABS (amber)', group: 'telltale', colour: 'amber', onPanel: true },
    { id: 'tt.dsc', name: 'DSC (amber)', group: 'telltale', colour: 'amber', onPanel: true },
    { id: 'tt.auto_h', name: 'AUTO H (green)', group: 'telltale', colour: 'green', onPanel: true },
    { id: 'tt.parking_brake', name: 'Parking brake (P) (red)', group: 'telltale', colour: 'red', onPanel: true },
    { id: 'tt.parking_brake.hold', name: 'Parking brake (P) held by Auto Hold (green)', group: 'telltale', colour: 'green', onPanel: true },
    { id: 'tt.steering', name: 'Steering system (red)', group: 'telltale', colour: 'red', onPanel: true },
    { id: 'bottom.belt_rear', name: 'Rear seat belts (red)', group: 'bottom-row', colour: 'red', onPanel: true },
    { id: 'bottom.belt_driver', name: 'Driver seat belt (red)', group: 'bottom-row', colour: 'red', onPanel: true },
    { id: 'bottom.airbag', name: 'Airbag (red)', group: 'bottom-row', colour: 'red', onPanel: true },
    { id: 'assist.info_tacho', name: "'i' marker under the map, right (white)", group: 'assist-message', colour: 'white', onPanel: true },
    // physical LEDs in the housing, outside the 1920x720 panel (g20_comfort.json `excluded`): never drawn
    { id: 'housing.low_beam', name: 'Low beam (green LED in the housing, not on the panel)', group: 'housing', colour: 'green', onPanel: false },
    { id: 'housing.side_light', name: 'Side lights (green LED in the housing, not on the panel)', group: 'housing', colour: 'green', onPanel: false },
    { id: 'housing.check_engine', name: 'Check engine (amber LED in the housing, not on the panel)', group: 'housing', colour: 'amber', onPanel: false },
    { id: 'housing.dsc_off', name: 'DSC OFF (amber LED in the housing, not on the panel)', group: 'housing', colour: 'amber', onPanel: false }
  ];

  // startup = exactly the panel lamps lit in 08 (the start-up check); driving = none.
  var PRESETS = {
    startup: {
      'tt.brake': true, 'tt.tpms': true, 'tt.abs': true, 'tt.dsc': true, 'tt.auto_h': true,
      'tt.parking_brake': true, 'tt.steering': true, 'bottom.belt_rear': true, 'bottom.belt_driver': true,
      'bottom.airbag': true, 'assist.info_tacho': true
    },
    driving: {}
  };
  // The rest of 08's state, for a bench that wants the full picture (not lamps): message, sign, gear, engine off.
  var PRESET_EXTRAS = {
    startup: { ccMessage: 'ready', limit: 50, gearLetter: 'P', values: { rpm: 0, speed: 0 } },
    driving: { ccMessage: null }
  };

  var CC_TEXT = { ready: ['Готовність до руху:', 'натисніть гальмо.'] };
  var MODE_TEXT = { comfort: ['COMFORT', 'PLUS'], sport: ['SPORT'], eco: ['ECO PRO'] };

  // ------------------------------------------------------------------------------------------------ helpers
  function rgb(c, a) { return a == null ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')' : 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function look(s) { return s && s.day ? COL.day : COL.night; }
  function lit(s, id) { return !!(s && s.lamps && s.lamps[id]); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  function setFont(ctx, st) {
    ctx.font = st.wght + ' ' + st.size + 'px ' + (fontOk ? FAMILY : 'Arial, sans-serif');
    if ('fontStretch' in ctx) ctx.fontStretch = st.stretch || 'normal';
    if ('letterSpacing' in ctx) ctx.letterSpacing = (st.ls || 0) + 'px';   // tracking, in font px before sx
  }
  // Draw `str` in style st; returns the drawn advance width in panel px. x/align override the style's.
  function text(ctx, str, st, colour, x, align, sxOverride, baseOverride) {
    setFont(ctx, st);
    var sx = sxOverride || (typeof st.sx === 'number' ? st.sx : 1);
    var w = ctx.measureText(str).width * sx;
    var ax = x == null ? st.x : x;
    var al = align || st.align || 'left';
    var left = al === 'left' ? ax : (al === 'right' ? ax - w : ax - w / 2);
    ctx.save();
    ctx.translate(left, baseOverride == null ? st.base : baseOverride);
    ctx.scale(sx, 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = rgb(colour);
    ctx.fillText(str, 0, 0);
    ctx.restore();
    return w;
  }

  function halo(ctx, c) {
    ctx.shadowColor = rgb(c, HALO.alpha);
    ctx.shadowBlur = HALO.blur;
  }

  function circle(ctx, cx, cy, r) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); }

  // Icons are drawn once per colour into a small offscreen canvas (their cut-outs use destination-out, which must
  // never touch the bench's canvas) and then blitted, with the lamp halo as a canvas shadow.
  var BOX = {   // panel-px boxes [x0, y0, x1, y1] that hold each icon (ink box + margin)
    brake: [16, 205, 94, 263], tpms: [14, 260, 86, 320], abs: [6, 320, 82, 376], dsc: [12, 374, 70, 434],
    autoH: [1768, 170, 1880, 212], parking: [1830, 208, 1908, 268], steering: [1840, 258, 1912, 322],
    beltRear: [494, 672, 584, 720], beltDriver: [584, 658, 632, 720], airbag: [628, 658, 692, 720],
    pump: [130, 660, 180, 704], ccInfo: [730, 632, 760, 688], infoTacho: [1250, 585, 1278, 632]
  };
  var sprites = {};
  function sprite(key, fn, c) {
    var k = key + '|' + c.join(',') + '|' + fontOk;
    var sp = sprites[k];
    if (!sp) {
      var b = BOX[key], cv = document.createElement('canvas');
      cv.width = b[2] - b[0]; cv.height = b[3] - b[1];
      var x = cv.getContext('2d');
      x.translate(-b[0], -b[1]);
      fn(x, c);
      sp = sprites[k] = { cv: cv, x: b[0], y: b[1] };
    }
    return sp;
  }
  function blit(ctx, key, fn, c, glow) {
    var sp = sprite(key, fn, c);
    ctx.save();
    if (glow) halo(ctx, c);
    ctx.drawImage(sp.cv, sp.x, sp.y);
    ctx.restore();
  }

  // Ring with two "brake lining" crescents (brake, ABS, parking brake): ring centre, ring radius (stroke centre),
  // ring width, crescent inner/outer radius, half height of the crescents, gap |dx| that splits them.
  function ringWithBrackets(ctx, c, o) {
    ctx.strokeStyle = rgb(c);
    ctx.lineWidth = o.ringW;
    circle(ctx, o.cx, o.cy, o.r);
    ctx.stroke();
    for (var side = -1; side <= 1; side += 2) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(side < 0 ? o.cx - o.bOut - 2 : o.cx + o.split, o.cy - o.bHalf, o.bOut + 2 - o.split, 2 * o.bHalf);
      ctx.clip();
      ctx.beginPath();
      ctx.arc(o.cx + side * o.bShift, o.cy, o.bOut, 0, Math.PI * 2);
      ctx.arc(o.cx + side * o.bShift, o.cy, o.bIn, 0, Math.PI * 2, true);
      ctx.fillStyle = rgb(c);
      ctx.fill('evenodd');
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------------------------- telltales
  function drawBrake(ctx, c) {
    // ring centre (54.5, 233.5), ink 25..86 x 213..255
    ringWithBrackets(ctx, c, { cx: 55.3, cy: 233.8, r: 18.6, ringW: 4.0, bIn: 22.4, bOut: 30.6, bShift: 0, bHalf: 20.3, split: 13.5 });
    ctx.fillStyle = rgb(c);
    // '!': a bar tapering slightly downwards and a dot
    ctx.beginPath();
    ctx.moveTo(51.0, 219.0); ctx.lineTo(59.0, 219.0); ctx.lineTo(57.8, 237.5); ctx.lineTo(52.2, 237.5); ctx.closePath();
    ctx.fill();
    circle(ctx, 55.0, 243.4, 4.0); ctx.fill();
  }

  function drawTpms(ctx, c) {
    // tyre section: two bulging walls, the tread line with its dashes, and a '!'
    ctx.strokeStyle = rgb(c); ctx.fillStyle = rgb(c);
    ctx.lineWidth = 5.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(31.0, 268.5); ctx.quadraticCurveTo(21.5, 288.0, 33.0, 306.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(67.5, 268.5); ctx.quadraticCurveTo(80.5, 288.0, 67.0, 306.5); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(32.0, 308.5); ctx.lineTo(68.5, 308.5); ctx.lineWidth = 4.2; ctx.stroke();
    for (var i = 0; i < 6; i++) { ctx.fillRect(32.0 + i * 6.6, 311.4, 3.4, 2.6); }
    ctx.beginPath();
    ctx.moveTo(45.0, 270.0); ctx.lineTo(54.0, 270.0); ctx.lineTo(53.0, 291.0); ctx.lineTo(46.0, 291.0); ctx.closePath(); ctx.fill();
    circle(ctx, 49.5, 297.8, 4.8); ctx.fill();
  }

  function drawAbs(ctx, c) {
    ctx.strokeStyle = rgb(c); ctx.lineWidth = 4.0;
    circle(ctx, 43.0, 347.0, 17.8); ctx.stroke();
    // lining crescents with a gap to the ring: thick in the middle, thin at the ends
    ctx.fillStyle = rgb(c);
    for (var sd = -1; sd <= 1; sd += 2) {
      ctx.beginPath();
      ctx.arc(43.0, 347.0, 29.2, sd < 0 ? Math.PI * 0.74 : -Math.PI * 0.26, sd < 0 ? Math.PI * 1.26 : Math.PI * 0.26);
      ctx.arc(43.0 + sd * 3.0, 347.0, 23.6, sd < 0 ? Math.PI * 1.25 : Math.PI * 0.25, sd < 0 ? Math.PI * 0.75 : -Math.PI * 0.25, true);
      ctx.closePath(); ctx.fill();
    }
    text(ctx, 'ABS', T.absText, c);
  }

  function drawDsc(ctx, c) {
    // car seen from behind (roof, body, wheels, bumper) over two skid lines shaped like '2'
    ctx.strokeStyle = rgb(c); ctx.fillStyle = rgb(c); ctx.lineJoin = 'round';
    ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(26.0, 391.0); ctx.lineTo(30.5, 382.0); ctx.lineTo(51.5, 382.0); ctx.lineTo(56.0, 391.0); ctx.stroke();
    ctx.fillRect(24.0, 388.0, 33.0, 3.2);                       // belt line
    ctx.fillRect(21.0, 389.5, 6.0, 17.0);                       // left wheel / side
    ctx.fillRect(54.0, 389.5, 6.0, 17.0);                       // right
    ctx.fillRect(31.0, 399.0, 18.5, 3.2);                       // bumper / plate
    ctx.lineWidth = 3.3; ctx.lineCap = 'round';
    for (var k = 0; k < 2; k++) {
      var ox = k * 19.5;
      ctx.beginPath();
      ctx.moveTo(22.0 + ox, 410.0); ctx.lineTo(36.0 + ox, 410.0);
      ctx.quadraticCurveTo(42.5 + ox, 410.5, 39.5 + ox, 415.0);
      ctx.quadraticCurveTo(30.0 + ox, 419.0, 21.5 + ox, 421.0);
      ctx.quadraticCurveTo(16.5 + ox, 423.0, 21.0 + ox, 426.0);
      ctx.lineTo(37.0 + ox, 426.0);
      ctx.stroke();
    }
  }

  function drawAutoH(ctx, c) { text(ctx, 'AUTO H', T.autoH, c); }

  function drawParking(ctx, c) {
    ringWithBrackets(ctx, c, { cx: 1868.5, cy: 237.6, r: 18.7, ringW: 5.0, bIn: 23.4, bOut: 30.6, bShift: 0, bHalf: 21.0, split: 14.5 });
    text(ctx, 'P', T.parkP, c);
  }

  function drawSteering(ctx, c) {
    ctx.strokeStyle = rgb(c); ctx.fillStyle = rgb(c);
    ctx.lineWidth = 5.0;
    circle(ctx, 1870.0, 292.3, 20.4); ctx.stroke();
    // hub: a bar across and a pad down to the rim, with a dark centre dot
    ctx.beginPath();
    ctx.moveTo(1851.0, 286.5); ctx.quadraticCurveTo(1870.0, 282.0, 1889.0, 286.5);
    ctx.lineTo(1889.0, 293.0); ctx.lineTo(1880.0, 295.0); ctx.lineTo(1876.5, 311.0); ctx.lineTo(1863.5, 311.0);
    ctx.lineTo(1860.0, 295.0); ctx.lineTo(1851.0, 293.0); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.shadowBlur = 0;
    circle(ctx, 1870.0, 291.0, 2.6); ctx.fill(); ctx.restore();
    // '!'
    ctx.beginPath(); ctx.moveTo(1896.5, 265.0); ctx.lineTo(1904.0, 265.0); ctx.lineTo(1903.0, 286.0); ctx.lineTo(1897.5, 286.0); ctx.closePath(); ctx.fill();
    circle(ctx, 1900.3, 292.5, 3.8); ctx.fill();
  }

  // seated figure seen from the front (belt lamps): head centre hx, hy; scale k
  function beltFigure(ctx, c, hx, hy, k) {
    ctx.fillStyle = rgb(c);
    circle(ctx, hx, hy, 4.3 * k); ctx.fill();
    ctx.beginPath();                                                // torso
    ctx.moveTo(hx - 6.5 * k, hy + 7 * k); ctx.lineTo(hx + 6.5 * k, hy + 7 * k);
    ctx.lineTo(hx + 7.5 * k, hy + 20 * k); ctx.lineTo(hx - 7.5 * k, hy + 20 * k); ctx.closePath(); ctx.fill();
    ctx.beginPath();                                                // seat + thighs + arms on the armrests
    ctx.moveTo(hx - 12.5 * k, hy + 20.5 * k); ctx.lineTo(hx + 12.5 * k, hy + 20.5 * k);
    ctx.lineTo(hx + 12.5 * k, hy + 24.5 * k); ctx.lineTo(hx - 12.5 * k, hy + 24.5 * k); ctx.closePath(); ctx.fill();
    ctx.fillRect(hx - 6.5 * k, hy + 24 * k, 4.6 * k, 8.5 * k);       // legs
    ctx.fillRect(hx + 1.9 * k, hy + 24 * k, 4.6 * k, 8.5 * k);
    // the belt: a dark diagonal gap across the torso
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.shadowBlur = 0;
    ctx.lineWidth = 1.6 * k; ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.moveTo(hx - 7.5 * k, hy + 19 * k); ctx.lineTo(hx + 7 * k, hy + 6.5 * k); ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 1.8 * k; ctx.strokeStyle = rgb(c);              // the belt strap past the shoulder
    ctx.beginPath(); ctx.moveTo(hx + 5 * k, hy + 8 * k); ctx.lineTo(hx + 9.5 * k, hy + 4 * k); ctx.stroke();
  }

  function drawBeltRear(ctx, c) {
    beltFigure(ctx, c, 513.2, 682.0, 0.98);
    beltFigure(ctx, c, 538.8, 682.5, 0.98);
    beltFigure(ctx, c, 564.3, 682.5, 0.98);
  }
  function drawBeltDriver(ctx, c) { beltFigure(ctx, c, 608.3, 670.6, 1.33); }

  function drawAirbag(ctx, c) {
    // passenger seen from the side, reclined, facing left towards the inflated airbag (oval)
    ctx.fillStyle = rgb(c); ctx.strokeStyle = rgb(c); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.ellipse(645.5, 677.3, 9.0, 12.2, 0.3, 0, Math.PI * 2); ctx.fill();     // the airbag
    circle(ctx, 671.8, 669.8, 5.5); ctx.fill();                                              // head
    ctx.lineWidth = 4.0;
    ctx.beginPath(); ctx.moveTo(672.5, 682.0); ctx.lineTo(679.5, 674.5); ctx.stroke();       // raised arm
    ctx.lineWidth = 10.5;
    ctx.beginPath(); ctx.moveTo(668.5, 681.0); ctx.lineTo(650.0, 704.0); ctx.stroke();       // torso into the thigh
    ctx.lineWidth = 5.0;
    ctx.beginPath(); ctx.moveTo(649.0, 705.0); ctx.lineTo(642.0, 712.5); ctx.stroke();
    ctx.lineWidth = 5.2;
    ctx.beginPath(); ctx.moveTo(657.0, 691.0); ctx.lineTo(677.5, 710.0); ctx.stroke();       // belt / leg bar
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.shadowBlur = 0;      // dark gaps between
    ctx.lineWidth = 1.6; ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.moveTo(653.5, 691.0); ctx.lineTo(679.0, 714.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(660.0, 688.0); ctx.lineTo(684.0, 708.5); ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------------------- small pieces
  function drawPump(ctx, c) {
    ctx.fillStyle = rgb(c); ctx.strokeStyle = rgb(c);
    // pump body with a window, hose on the right, arrow on the left pointing in (filler side)
    ctx.beginPath();
    roundRect(ctx, 149.5, 666.5, 18, 31, 2.5); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(152.5, 669.5, 11.5, 8.5); ctx.restore();
    ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(167.0, 672.5); ctx.lineTo(171.5, 675.0); ctx.lineTo(172.5, 692.5); ctx.lineTo(170.0, 694.5); ctx.lineTo(167.5, 692.5); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(136.0, 681.5); ctx.lineTo(143.0, 681.5); ctx.lineTo(143.0, 679.0); ctx.lineTo(149.0, 684.5);
    ctx.lineTo(143.0, 690.0); ctx.lineTo(143.0, 687.5); ctx.lineTo(136.0, 687.5); ctx.closePath(); ctx.fill();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  // serif 'i' in a box (x, y, w, h) = its ink box
  function drawInfoI(ctx, c, b) {
    var k = b.h / 45, cx = b.x + b.w / 2;
    ctx.fillStyle = rgb(c);
    circle(ctx, cx + 0.3 * k, b.y + 5.5 * k, 5.6 * k); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(b.x + 0.5 * k, b.y + 16.5 * k); ctx.lineTo(cx + 4.5 * k, b.y + 16.5 * k);       // top-left serif + stem
    ctx.lineTo(cx + 4.5 * k, b.y + 40.0 * k); ctx.lineTo(b.x + b.w, b.y + 41.5 * k);
    ctx.lineTo(b.x + b.w, b.y + b.h); ctx.lineTo(b.x, b.y + b.h); ctx.lineTo(b.x, b.y + 41.5 * k);
    ctx.lineTo(cx - 4.0 * k, b.y + 40.0 * k); ctx.lineTo(cx - 4.0 * k, b.y + 22.5 * k); ctx.lineTo(b.x + 0.5 * k, b.y + 21.5 * k);
    ctx.closePath(); ctx.fill();
  }

  function drawSign(ctx, L, limit) {
    var g = G.sign;
    ctx.fillStyle = rgb(L.signRed); circle(ctx, g.cx, g.cy, g.rOut); ctx.fill();
    ctx.fillStyle = rgb(L.signWhite); circle(ctx, g.cx, g.cy, g.rIn); ctx.fill();
    var str = String(Math.round(limit));
    text(ctx, str, str.length > 2 ? T.limit3 : T.limit2, L.signText);
  }

  function path(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length - 1; i++) {                        // smooth through midpoints
      var mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  }

  function drawCcPanel(ctx, L, msg) {
    var g = G.cc;
    // opaque base (hides the stock frame line's ends)
    ctx.beginPath(); ctx.moveTo(g.base[0][0], g.base[0][1]);
    for (var i = 1; i < g.base.length; i++) ctx.lineTo(g.base[i][0], g.base[i][1]);
    ctx.closePath();
    ctx.fillStyle = rgb(L.ccBase); ctx.fill();
    ctx.save(); ctx.clip();
    var vg = ctx.createLinearGradient(0, 600, 0, 720);
    L.ccFill.forEach(function (st) { vg.addColorStop((st[0] - 600) / 120, rgb(st[1])); });
    ctx.fillStyle = vg; ctx.fillRect(695, 600, 530, 120);
    var f = g.fillFade, hg = ctx.createLinearGradient(f[0], 0, f[3], 0), W = f[3] - f[0];
    hg.addColorStop(0, rgb(L.ccBase, 1)); hg.addColorStop((f[1] - f[0]) / W, rgb(L.ccBase, 0));
    hg.addColorStop((f[2] - f[0]) / W, rgb(L.ccBase, 0)); hg.addColorStop(1, rgb(L.ccBase, 1));
    ctx.fillStyle = hg; ctx.fillRect(695, 600, 530, 120);
    ctx.restore();
    // the curved top frame, fading at both ends
    var ff = g.frameFade, fg = ctx.createLinearGradient(ff[0], 0, ff[3], 0), FW = ff[3] - ff[0];
    fg.addColorStop(0, rgb(L.ccFrame, 0)); fg.addColorStop((ff[1] - ff[0]) / FW, rgb(L.ccFrame, 1));
    fg.addColorStop((ff[2] - ff[0]) / FW, rgb(L.ccFrame, 1)); fg.addColorStop(1, rgb(L.ccFrame, 0));
    path(ctx, g.frame);
    ctx.strokeStyle = fg; ctx.lineWidth = g.frameW; ctx.lineCap = 'round'; ctx.stroke();
    blit(ctx, 'ccInfo', function (x, c) { drawInfoI(x, c, G.ccInfo); }, L.white, false);
    var lines = CC_TEXT[msg] || [String(msg)];
    text(ctx, lines[0], T.cc1, L.ccText);
    if (lines[1]) text(ctx, lines[1], T.cc2, L.ccText);
  }

  function fmtTemp(v) {
    var r = Math.round(v * 10) / 10;
    var sgn = r > 0 ? '+' : (r < 0 ? '−' : '');
    return sgn + Math.abs(r).toFixed(1);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // ---------------------------------------------------------------------------------------------- drawUnder
  function drawUnder(ctx, s) {
    s = s || {};
    var L = look(s), v = s.values || {}, conn = !!s.themeConnected;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';

    // --- telltales (lit look only: unlit lamps draw nothing, as measured in 09 and 14)
    var tt = [['tt.brake', 'brake', drawBrake, L.red], ['tt.tpms', 'tpms', drawTpms, L.amber],
              ['tt.abs', 'abs', drawAbs, L.amber], ['tt.dsc', 'dsc', drawDsc, L.amber],
              ['tt.auto_h', 'autoH', drawAutoH, L.green], ['tt.steering', 'steering', drawSteering, L.red],
              ['bottom.belt_rear', 'beltRear', drawBeltRear, L.belt], ['bottom.airbag', 'airbag', drawAirbag, L.airbag]];
    tt.forEach(function (t) { if (lit(s, t[0])) blit(ctx, t[1], t[2], t[3], true); });

    // --- digital speed + km/h, rpm label, OFF / tacho '0', COLD
    var sp = num(v.speed);
    text(ctx, String(Math.max(0, Math.round(sp == null ? 0 : sp))), T.speed, L.white);
    text(ctx, 'km/h', T.speedUnit, L.kmh);
    text(ctx, '1/min', T.rpm1, L.rpm);
    text(ctx, 'x1000', T.rpm2, L.rpm);
    var rpm = num(v.rpm);
    if (rpm == null || rpm < 200) text(ctx, 'OFF', T.off, L.white);      // engine off (08; weak)
    else text(ctx, '0', T.tacho0, L.white);                               // the scale's '0' (09, 14)
    var oil = num(v.oil);
    if (oil != null && oil < 40 && !(rpm == null || rpm < 200)) text(ctx, 'COLD', T.cold, L.cold);

    // --- stock only: centre mode label and centre gear letter
    var mode = MODE_TEXT[s.drive] || MODE_TEXT.comfort;
    var gear = s.gearLetter || 'P';
    if (!conn) {
      mode.forEach(function (ln, i) { text(ctx, ln, T.modeC, L.label, null, null, null, T.modeC.base + i * T.modeC.pitch); });
      text(ctx, gear, T.gearC, L.white, null, null, T.gearC.sx[gear] || 0.95);
    }

    // --- speed-limit sign
    if (s.limit != null && s.limit > 0) drawSign(ctx, L, s.limit);

    // --- bottom row: pump + range, clock, street / check-control panel, temperature, mode label (connected)
    var range = num(v.range);
    blit(ctx, 'pump', drawPump, L.pump, false);
    var rs = range == null ? '---' : String(Math.max(0, Math.round(range)));
    var w = text(ctx, rs, T.range, L.white);
    text(ctx, 'km', T.rangeUnit, L.unit, T.range.x + w + T.rangeUnit.gap, 'left');

    var d = s.time instanceof Date ? s.time : new Date();
    text(ctx, d.getHours() + ':' + pad2(d.getMinutes()), T.clock, L.white);

    if (s.ccMessage) drawCcPanel(ctx, L, s.ccMessage);
    else if (s.street) {
      var st = T.street;
      setFont(ctx, st);
      var sw = ctx.measureText(s.street).width * st.sx;
      text(ctx, s.street, st, L.white, null, null, sw > st.maxW ? st.sx * st.maxW / sw : null);
    }

    var amb = num(v.ambient);
    text(ctx, amb == null ? '--.-' : fmtTemp(amb), T.temp, L.white);
    ctx.strokeStyle = rgb(L.unit); ctx.lineWidth = T.degree.lw;
    circle(ctx, T.degree.cx, T.degree.cy, T.degree.r); ctx.stroke();
    text(ctx, 'C', T.tempC, L.unit);

    if (conn) {
      mode.forEach(function (ln, i) { text(ctx, ln, T.modeB, L.label, null, null, null, T.modeB.base + i * T.modeB.pitch); });
    }

    if (lit(s, 'assist.info_tacho')) blit(ctx, 'infoTacho', function (x, c) { drawInfoI(x, c, G.infoTacho); }, L.white, false);
    ctx.restore();
  }

  // ----------------------------------------------------------------------------------------------- drawOver
  function drawOver(ctx, s) {
    s = s || {};
    var L = look(s);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    var pc = lit(s, 'tt.parking_brake') ? L.red : (lit(s, 'tt.parking_brake.hold') ? L.parkGreen : null);
    if (pc) blit(ctx, 'parking', drawParking, pc, true);
    if (lit(s, 'bottom.belt_driver')) blit(ctx, 'beltDriver', drawBeltDriver, L.belt, true);
    if (s.themeConnected) {
      var gear = s.gearLetter || 'P';
      text(ctx, gear, T.gearB, L.white, null, null, T.gearB.sx[gear] || 1.12);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------------------------------- init
  function init(base) {
    base = base == null ? '/g20/' : base;
    if (typeof FontFace === 'undefined' || !document.fonts) return Promise.resolve();
    var ff = new FontFace(FAMILY, 'url(' + base + FONT_FILE + ')', { weight: '100 900', stretch: '75% 100%' });
    return ff.load().then(function (f) { document.fonts.add(f); fontOk = true; })
      .catch(function (e) { console.warn('G20C: font failed, falling back to Arial', e); });
  }

  window.G20C = {
    init: init, drawUnder: drawUnder, drawOver: drawOver, lamps: LAMPS, PRESETS: PRESETS,
    PRESET_EXTRAS: PRESET_EXTRAS, STYLE: { COL: COL, T: T, G: G, HALO: HALO }
  };
})();
