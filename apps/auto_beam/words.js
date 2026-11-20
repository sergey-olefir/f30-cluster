'use strict';
/**
 * words.js - Auto Beam's words come from shared/lang.js and its tables shared/i18n/uk.json / en.json (family "beam.*"; the
 * app.json texts under "auto_beam.*" by their place). No Cyrillic literal anywhere in the app's code: the drawing code asks
 * for a key here, in the language the painter was given (the page and the map repaint on a language change).
 *
 *   word(lang, key, vars)   the text in 'uk' | 'en' ({placeholders} filled); an unknown key answers the key (a test fails on it)
 *   langOf(v)               'uk' | 'en' (anything else: Ukrainian, the owner's language)
 *   KEYS                    every key the app draws (the tests check both tables hold them and the atlases their letters)
 */
function req(name) { try { return require('./' + name); } catch (e) { try { return require('../../shared/' + name); } catch (e2) { return null; } } }
const I = req('lang');

const LANGS = ['uk', 'en'];
function langOf(v) { return LANGS.indexOf(v) >= 0 ? v : 'uk'; }
function word(lang, key, vars) {
    if (!I) return key;
    try { return I.tl(langOf(lang), key, vars); } catch (e) { return key; }
}

const REASONS = ['clear', 'settle', 'oncoming', 'preceding', 'cyclist', 'light', 'streetlights', 'curve', 'camera_verdict', 'flicker', 'town', 'slow',
    'daylight', 'weather', 'lights_off', 'camera', 'nodata', 'error', 'driver', 'unknown'];
const STATES = ['unavailable', 'standby', 'high', 'dipped', 'override'];
const KEYS = [
    'beam.title', 'beam.advisor', 'beam.footer', 'beam.demo', 'beam.auto', 'beam.adv.high', 'beam.adv.dip', 'beam.adv.low', 'beam.adv.wait',
    'beam.lamps', 'beam.lamps.high', 'beam.lamps.low', 'beam.lamps.flash', 'beam.lamps.off', 'beam.lamps.unknown',
    'beam.return', 'beam.yield', 'beam.act', 'beam.act.none', 'beam.act.would', 'beam.standin',
    'beam.row.state', 'beam.row.reason', 'beam.row.cause', 'beam.row.src', 'beam.row.verdict', 'beam.row.lamps', 'beam.row.town', 'beam.row.speed',
    'beam.row.bright', 'beam.row.score', 'beam.row.events', 'beam.row.act',
    'beam.src.light', 'beam.src.object', 'beam.src.none', 'beam.town.sign', 'beam.town.limit', 'beam.town.none',
    'beam.verdict.allow', 'beam.verdict.dip', 'beam.verdict.none', 'beam.verdict.unknown', 'beam.verdict.log',
    'beam.cls.head', 'beam.cls.tail', 'beam.cls.street', 'beam.cls.bike', 'beam.cls.reflector', 'beam.cls.other', 'beam.cause.none',
    'beam.data.ok', 'beam.data.none', 'beam.data.stale', 'beam.kmh', 'beam.sec', 'beam.raw', 'beam.score.none', 'beam.score.events',
    'beam.limit', 'beam.metres',
].concat(REASONS.map((r) => 'beam.reason.' + r)).concat(STATES.map((s) => 'beam.state.' + s));

module.exports = { word, langOf, LANGS, KEYS, I };
