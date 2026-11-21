'use strict';
/**
 * tools/twin-dial/tt/pictures.js - fixes-1121 TT: pictures of where the message sits on each Twin Dial tab (the band on tabs 1, 3, 4,
 * 5; the card on tab 2), in Ukrainian and English, km and mph. No bench, no port, no car: the centre page layer is painted by the
 * real shared/twin_pages.js (bench/twin-centre-states.js's states) and the tab-2 sheet by the real shared/twin_cc.js (layoutBand /
 * layoutTab2 + paintSheet), laid over black in the panel's own order (the page under the sheet). Only the centre [729, 248, 1191, 595]
 * is drawn: the dials, the tab bar and the bottom row are not part of these pictures.
 *
 *   node tools/twin-dial/tt/pictures.js [out folder]      (default bake/work/fixes-1121/twin-tabs, git-ignored)
 *
 * Every text is invented and neutral. Never shipped.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..', '..');
const S = require(path.join(ROOT, 'bench', 'twin-centre-states'));
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'bake', 'work', 'fixes-1121', 'twin-tabs'));

const R = S.rig();
const CC = require(path.join(R.dir, 'twin_cc.js'));
const TR = require(path.join(R.dir, 'hud_text.js'));
const IC = require(path.join(R.dir, 'icons.js'));
const deps = { measure: (f, s) => TR.measure(s, f, 0), has: (f, ch) => !!TR.loadFont(f).metrics.glyphs[ch], fonts: CC.FONTS };
const pdeps = { textRaster: TR, paintIcon: IC.paintIcon, icons: IC.ICONS };

const PAGE = R.pages.LAYER;                 // [729, 248] 462 x 347
const SHEET = CC.SHEET;                     // [729, 298] 462 x 270

function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, rgb) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
    const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** straight-alpha `src` (sw x sh at sx, sy) over the opaque rgb canvas (cw x ch at cx, cy) */
function over(canvas, cw, cx, cy, src, sw, sh, sx, sy) {
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const s = (y * sw + x) * 4, a = src[s + 3] / 255;
        if (!a) continue;
        const X = sx + x - cx, Y = sy + y - cy;
        if (X < 0 || Y < 0 || X >= cw) continue;
        const d = (Y * cw + X) * 3;
        if (d + 2 >= canvas.length) continue;
        for (let k = 0; k < 3; k++) canvas[d + k] = Math.round(src[s + k] * a + canvas[d + k] * (1 - a));
    }
}

const MSG = {
    uk: { door: { id: 15, name: 'Двері відчинено', color: 'white' }, brake: { id: 42, name: 'Гальма: зупиніться в безпечному місці', color: 'red' },
        tyre: { id: 50, name: 'Тиск у шинах: перевірте', color: 'yellow' }, long: { id: 41, name: 'Потрібне сервісне обслуговування найближчим часом', color: 'white' } },
    en: { door: { id: 15, name: 'Driver door open', color: 'white' }, brake: { id: 42, name: 'Brake fault: stop the car at a safe place', color: 'red' },
        tyre: { id: 50, name: 'Check the tyre pressure', color: 'yellow' }, long: { id: 41, name: 'Service due: visit your service partner soon', color: 'white' } },
};
const cand = (e) => ({ key: CC.keyOf(e), id: e.id, name: e.name, color: e.color, symbol: CC.symbolFor(e.id, e.color), counter: '' });

/** One picture: state `id` of the pages on its tab, with the message `e` (null: none) as the band / the card. */
function shot(file, id, lang, units, e, rows) {
    R.i18n.setPref(lang);
    const h = S.make(R, id);
    h._settings.units = units;
    const tab = S.STATES[id].tab;
    let sheet = null;
    if (e && tab !== 2) sheet = CC.layoutBand({ cand: cand(e) }, deps);
    else if (tab === 2) sheet = CC.layoutTab2({ cand: e ? cand(e) : null, shown: !!e, sev: e ? CC.severityOf(e.color) : 0, entries: (rows || []).concat(e ? [e] : []) }, deps);
    const top = sheet && sheet.kind === 'band' ? sheet.card.y0 : null;
    h._twinBandTop = () => top;
    const pg = S.render(R, h);
    const W = PAGE.w, H = PAGE.h, canvas = Buffer.alloc(W * H * 3, 0);
    over(canvas, W, PAGE.x, PAGE.y, pg.buf, PAGE.w, PAGE.h, PAGE.x, PAGE.y);
    if (sheet) over(canvas, W, PAGE.x, PAGE.y, CC.paintSheet(pdeps, sheet, {}).buf, SHEET.w, SHEET.h, SHEET.x, SHEET.y);
    fs.writeFileSync(path.join(OUT, file), png(W, H, canvas));
    return { file, tab, page: pg.page, sheet: sheet ? sheet.kind : null, top, lines: sheet && sheet.card ? sheet.card.lines.length : 0, whole: sheet ? sheet.keys.length > 0 : null };
}

fs.mkdirSync(OUT, { recursive: true });
const made = [];
['uk', 'en'].forEach((lang) => ['km', 'mi'].forEach((u) => {
    const m = MSG[lang], tag = '_' + lang + '_' + (u === 'mi' ? 'mph' : 'km');
    made.push(shot('t1_trip_door' + tag + '.png', 'trip', lang, u, m.door));
    made.push(shot('t1_clock_door' + tag + '.png', 'clock', lang, u, m.door));
    made.push(shot('t1_tech_brake' + tag + '.png', 'tech', lang, u, m.brake));
    made.push(shot('t2_card_door' + tag + '.png', 'msg', lang, u, m.door, [m.tyre]));
    made.push(shot('t3_track_door' + tag + '.png', 'car_carplay', lang, u, m.door));
    made.push(shot('t3_radio_long' + tag + '.png', 'car_radio', lang, u, m.long));
    made.push(shot('t4_call_tyre' + tag + '.png', 'car_call', lang, u, m.tyre));
    made.push(shot('t5_route_door' + tag + '.png', 'car_route', lang, u, m.door));
    made.push(shot('t5_route_none' + tag + '.png', 'car_route', lang, u, null));
}));
R.i18n.setPref('auto');
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(made, null, 1));
console.log(made.length + ' pictures in ' + OUT);
made.filter((m) => /_uk_km/.test(m.file)).forEach((m) => console.log('  ' + m.file + ': tab ' + m.tab + ', page ' + m.page + ', sheet ' + m.sheet + (m.top !== null ? ', band top ' + m.top + ', ' + m.lines + ' line(s)' : '') + (m.whole === false ? ', NOT whole' : '')));
