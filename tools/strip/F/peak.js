'use strict';
// node -r peak.js bench/server.js f30_cluster: appends "<ms> <bytes>" to $PEAK_OUT every time the bench's pixel memory
// (its own pixelBytes() rule: every image and asset counted twice) changes, so a layout switch's peak is seen exactly.
const fs = require('fs');
const OUT = process.env.PEAK_OUT;
const set = Map.prototype.set, del = Map.prototype.delete;
const isLayer = (v) => v && typeof v === 'object' && 'conn' in v && 'ref' in v && 'kind' in v && 'key' in v;
let cur = -1;
function note(m) {
    let n = 0;
    m.forEach((l) => { if (l && l.image && l.iw) n += l.iw * l.ih * (l.bpp || 4) * 2; });
    if (n !== cur) { cur = n; fs.appendFileSync(OUT, Date.now() + ' ' + n + '\n'); }
}
Map.prototype.set = function (k, v) { const r = set.call(this, k, v); if (isLayer(v)) note(this); return r; };
Map.prototype.delete = function (k) { const v = this.get(k); const r = del.call(this, k); if (isLayer(v)) note(this); return r; };
