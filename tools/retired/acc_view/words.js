'use strict';
/**
 * words.js - every word ACC View shows, in one table: a stable key, the Ukrainian and the English text (round 1120 AA2,
 * docs/AGENT-BRIEF-acc-app.md "Two languages"). Nothing else in the app holds a word a person reads: the drawing code asks
 * for a key. The languages agent (LN) adds the setting "Мова / Language" (Авто / Українська / English) to every app; its
 * module is adopted at the merge by handing its choice to langOf(). Until then config.lang picks ('uk' by default; 'auto'
 * and anything unknown mean Ukrainian, the owner's language).
 *
 * Our own wording, never BMW's message texts. The glyph atlases (hud/fonts/av_*.json, tools/bake_fonts.py ACC_FONTS) are
 * baked from Twin Dial's Noto with every character of both columns; bench/test-acc-view.js fails on a character missing.
 * Plain Node 8: no ?. / ?? / object spread.
 */

const LANGS = ['uk', 'en'];

const WORDS = {
    // the centre page's frame
    title: { uk: 'Авто попереду і круїз', en: 'Vehicle ahead and cruise' },
    viewOnly: { uk: 'лише показ', en: 'display only' },
    footer: { uk: 'Застосунок лише читає дані й малює; в автомобіль нічого не пише.', en: 'This app only reads and draws; it writes nothing to the car.' },
    demo: { uk: 'Демо', en: 'Demo' },
    // the gap level's words (no metres on screen until a calibrated drive)
    near: { uk: 'близько', en: 'near' },
    middle: { uk: 'середньо', en: 'middle' },
    far: { uk: 'далеко', en: 'far' },
    level: { uk: 'рівень', en: 'level' },
    // the data's honest states
    noData: { uk: 'Немає даних', en: 'No data' },
    noTarget: { uk: 'Авто не видно', en: 'No vehicle seen' },
    stale: { uk: 'Дані застаріли', en: 'Data stale' },
    // the ring (our word in place of "MAX")
    ringCruise: { uk: 'КРУЇЗ', en: 'CRUISE' },
    ringPause: { uk: 'ПАУЗА', en: 'PAUSED' },
    ringLimiter: { uk: 'ОБМЕЖ.', en: 'LIMIT' },
    ringOff: { uk: 'ВИМК.', en: 'OFF' },
    // the limit plate and the loop's suggestion
    limit: { uk: 'ліміт', en: 'limit' },
    advice: { uk: 'порада', en: 'advice' },
    // the status pill (events only)
    pillNoData: { uk: 'Немає даних камери', en: 'No camera data' },
    pillNoTarget: { uk: 'Авто попереду не видно', en: 'No vehicle ahead seen' },
    pillStale: { uk: 'Дані камери застаріли', en: 'Camera data stale' },
    pillFast: { uk: 'Швидке наближення', en: 'Closing fast' },
    pillPaused: { uk: 'Круїз призупинено', en: 'Cruise paused' },
    pillWarn: { uk: 'Увага: попередження автомобіля', en: 'Caution: the car\'s own warning' },
    // the centre page's data table
    rowTarget: { uk: 'Авто попереду', en: 'Vehicle ahead' },
    rowClosing: { uk: 'Наближення', en: 'Closing' },
    rowCruise: { uk: 'Круїз', en: 'Cruise' },
    rowLimit: { uk: 'Обмеження швидкості', en: 'Speed limit' },
    rowAge: { uk: 'Дані камери', en: 'Camera data' },
    rowWarn: { uk: 'Попередження авто', en: 'Car\'s warning' },
    rowAdvice: { uk: 'Порада циклу', en: 'Loop advice' },
    closingNo: { uk: 'ні', en: 'no' },
    closingYes: { uk: 'так', en: 'yes' },
    closingFast: { uk: 'швидке', en: 'fast' },
    cruiseActive: { uk: 'круїз', en: 'cruise' },
    cruisePaused: { uk: 'пауза', en: 'paused' },
    limiter: { uk: 'обмежувач', en: 'limiter' },
    off: { uk: 'вимкнено', en: 'off' },
    kmh: { uk: 'км/год', en: 'km/h' },
    sec: { uk: 'с', en: 's' },
    ageNone: { uk: 'не надходять', en: 'not arriving' },
    ageWait: { uk: 'чекаю', en: 'waiting' },
    warnNone: { uk: 'не надходило', en: 'none received' },
    warnActive: { uk: 'активне', en: 'active' },
    warnUnread: { uk: 'не розібране', en: 'not decoded' },
    noLimit: { uk: 'невідоме', en: 'unknown' },
    // what the sensors see (the owner's FOCUS, 2026-11-20)
    rowUsers: { uk: 'Учасники руху', en: 'Road users' },
    rowLanes: { uk: 'Смуги', en: 'Lanes' },
    cls_car: { uk: 'авто', en: 'cars' },
    cls_truck: { uk: 'вантажні', en: 'trucks' },
    cls_two: { uk: 'мото', en: 'motorbikes' },
    cls_ped: { uk: 'пішоходи', en: 'pedestrians' },
    cls_cyc: { uk: 'велосипеди', en: 'cyclists' },
    cls_unk: { uk: 'інше', en: 'other' },
    lanesMeasured: { uk: 'виміряні', en: 'measured' },
    lanesFixed: { uk: 'символ: даних немає', en: 'symbol: no data' },
    // fixes-1121 AL: what the lane picture is when the camera's lanes are not good enough (lanes.js verdicts)
    lanesPartial: { uk: 'частково: одна межа', en: 'partly: one edge' },
    lanesPathSteer: { uk: 'траєкторія за кермом', en: 'path from the steering' },
    lanesPathMotion: { uk: 'траєкторія за рухом', en: 'path from our motion' },
    lanesStraight: { uk: 'пряма: даних немає', en: 'straight: no data' },
};

/** The language to draw in: 'uk' or 'en' (anything else, 'auto' included, is Ukrainian until LN's module decides). */
function langOf(v) {
    return LANGS.indexOf(v) >= 0 ? v : 'uk';
}

/** The text of `key` in `lang`; an unknown key is the key itself (a test fails on it, the car never sees a crash). */
function word(lang, key) {
    const w = WORDS[key];
    if (!w) return key;
    return w[langOf(lang)] || w.uk || key;
}

/** Every character the tables use (the atlases must hold them all). */
function chars() {
    const seen = {};
    Object.keys(WORDS).forEach((k) => LANGS.forEach((l) => String(WORDS[k][l]).split('').forEach((c) => { seen[c] = true; })));
    return Object.keys(seen).sort().join('');
}

module.exports = { WORDS, LANGS, langOf, word, chars };
