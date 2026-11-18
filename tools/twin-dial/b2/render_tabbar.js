'use strict';
/**
 * render_tabbar.js - package B2's evidence: the tab bar's PIXEL layers (the live icons, the range text, the media cell) of the
 * real layout, drawn with the engine's own functions (shared/twin_tabs.js, shared/icons.js, shared/hud_text.js), as raw RGBA
 * files + a manifest, for tools/twin-dial/b2/tabbar_compare.py to compose with the backdrop and measure. The backdrop (the ramp,
 * the selected cell's fill, the separators, the rule) is a shader and is NOT drawn here.
 *
 *   node tools/twin-dial/b2/render_tabbar.js <out dir> [tab] [media text]
 */
const fs = require('fs');
const path = require('path');
const H = require('../../../bench/twin-harness');

const out = process.argv[2], tab = Number(process.argv[3] || 1), media = process.argv[4] || '';
fs.mkdirSync(out, { recursive: true });
const dir = H.tree('twin_dial');
const HudApp = require(path.join(dir, 'hud.js'));
const twin = require(path.join(dir, 'twin_tokens.js'));
const tabs = require(path.join(dir, 'twin_tabs.js'));
require(path.join(dir, 'twin_icons.js'));
const TR = require(path.join(dir, 'hud_text.js'));
const L = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'apps', 'twin_dial', 'hud', 'layouts', 'twin.json'), 'utf8'));

const h = H.fakeHud(HudApp, { settings: { tab: String(tab), tabLock: '5', centre: 'clock' }, config: { twin: {}, tabs: {}, trip: { factors: null } } });
h.td = twin.fresh(); h.td.clock = () => 0; h.twinLayout = true; h.twinCc = { state: 'none', severity: null };
h.rangeKm = 412; h._raw = (n) => (n === 'range' ? 412 : null); h._d = {}; h.theme = { fg: [255, 255, 255, 255] };
h.widgets = new Map(); h._guard = (w, fn) => fn();
if (media) h.td.media = media;
HudApp.prototype._twinSync.call(h);

const man = [];
L.widgets.filter((w) => w.id.indexOf('tab_') === 0).forEach((w) => {
    let buf;
    if (w.type === 'icon') {
        const s = tabs.iconState(h, w), col = h.theme.fg;
        buf = w.tdLive === 'media' ? tabs.paintMedia(h, w, s.icon, col, media) : require(path.join(dir, 'icons.js')).paintIcon(s.icon, w.w, w.h, col);
    } else {
        buf = TR.drawText(w.w, w.h, h._resolve(w.text), { font: w.font, color: [255, 255, 255, 255], align: w.align });
    }
    fs.writeFileSync(path.join(out, w.id + '.rgba'), buf);
    man.push({ id: w.id, x: w.x, y: w.y, w: w.w, h: w.h });
});
const back = L.widgets.find((w) => w.type === 'tdback' && w.part === 'L');
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ tab, widgets: man, bar: back.tab }, null, 1));
console.log('tab bar layers drawn: ' + man.length + ' (tab ' + tab + ')');
