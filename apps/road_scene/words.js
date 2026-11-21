'use strict';
/**
 * words.js - every word Road Scene draws comes from shared/lang.js and its tables shared/i18n/uk.json / en.json (round
 * fixes-1121 RS: ACC View's own table moved there as the family "rs.*"; Auto Beam's words stay "beam.*", the algorithm's
 * reason and state keys; the app.json texts are "road_scene.*" by their place). No Cyrillic literal anywhere in the app's code:
 * the drawing code asks for a key here, in the language the painter was given (the page and the map repaint on a change).
 *
 *   word(lang, key, vars)   the text in 'uk' | 'en' ({placeholders} filled). A bare key ('near') is ACC View's: 'rs.near'; a
 *                           dotted one ('beam.reason.clear') is used as it is. An unknown key answers the key (a test fails on it).
 *   langOf(v)               'uk' | 'en' (anything else: Ukrainian, the owner's language)
 *   KEYS                    every key the app draws (the tests check both tables hold them and the atlases their letters)
 *   chars()                 every character of those words in both languages
 * Plain Node 8: no ?. / ?? / object spread.
 */
function req(name) { try { return require('./' + name); } catch (e) { try { return require('../../shared/' + name); } catch (e2) { return null; } } }
const I = req('lang');

const LANGS = ['uk', 'en'];
const FAMILY = 'rs.';
function langOf(v) { return LANGS.indexOf(v) >= 0 ? v : 'uk'; }
const keyOf = (key) => (String(key).indexOf('.') >= 0 ? String(key) : FAMILY + key);
function word(lang, key, vars) {
    const k = keyOf(key);
    if (!I) return k;
    try { return I.tl(langOf(lang), k, vars); } catch (e) { return k; }
}

// ACC View's words (the scene, the ring, the plate, the pill, the table) and the merged table's own
const RS = ['title', 'viewOnly', 'footer', 'demo', 'near', 'middle', 'far', 'level', 'noData', 'noTarget', 'stale', 'ringCruise', 'ringPause',
    'ringLimiter', 'ringOff', 'limit', 'advice', 'pillNoData', 'pillNoTarget', 'pillStale', 'pillFast', 'pillPaused', 'pillWarn', 'rowTarget',
    'rowClosing', 'rowCruise', 'rowLimit', 'rowAge', 'rowWarn', 'rowAdvice', 'closingNo', 'closingYes', 'closingFast', 'cruiseActive',
    'cruisePaused', 'limiter', 'off', 'kmh', 'sec', 'ageNone', 'ageWait', 'warnNone', 'warnActive', 'noLimit', 'rowUsers', 'rowLanes',
    'cls_car', 'cls_truck', 'cls_two', 'cls_ped', 'cls_cyc', 'cls_unk', 'lanesMeasured', 'lanesFixed', 'lanesPartial', 'lanesPathSteer',
    'lanesPathMotion', 'lanesStraight', 'rowBeamAdvice', 'scoreLine'];
// Auto Beam's words the merged scene draws: the advice sign's lines, the lamps, the table's beam rows
const REASONS = ['clear', 'settle', 'oncoming', 'preceding', 'cyclist', 'light', 'streetlights', 'curve', 'camera_verdict', 'flicker', 'town', 'slow',
    'daylight', 'weather', 'lights_off', 'camera', 'nodata', 'error', 'driver', 'unknown'];
const STATES = ['unavailable', 'standby', 'high', 'dipped', 'override'];
const BEAM = ['beam.adv.high', 'beam.adv.dip', 'beam.adv.low', 'beam.lamps', 'beam.lamps.high', 'beam.lamps.low', 'beam.lamps.flash', 'beam.lamps.off',
    'beam.lamps.unknown', 'beam.return', 'beam.yield', 'beam.row.reason', 'beam.row.src', 'beam.row.lamps', 'beam.row.score', 'beam.src.light',
    'beam.src.object', 'beam.src.none', 'beam.score.none']
    .concat(REASONS.map((r) => 'beam.reason.' + r)).concat(STATES.map((s) => 'beam.state.' + s));
const KEYS = RS.map((k) => FAMILY + k).concat(BEAM);

/** Every character the drawn words use in both languages (the atlases must hold them all). */
function chars() {
    const seen = {};
    KEYS.forEach((k) => LANGS.forEach((l) => String(word(l, k, { pct: 0, early: 0, late: 0, missed: 0, s: 0, v: 0, to: '' })).split('').forEach((c) => { seen[c] = true; })));
    return Object.keys(seen).sort().join('');
}

module.exports = { word, langOf, keyOf, LANGS, KEYS, FAMILY, chars, I };
