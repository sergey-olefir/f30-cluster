'use strict';
/**
 * previews.js - the theme pictures the centre screen shows: the native menu's "showing now" picture (menu.js) and
 * the theme gallery (gallery.js). Made on the bench by tools/previews.py into hud/previews/<layout>.json
 * ({ big, small }: w, h, z = base64 of the deflated RGBA rows), packed with the rest of hud/ by the build.
 *
 *   get(name, size)     for the gallery's drawing (a record.js Recorder): inflated on first use and handed to the
 *                       kit as a pixel image (record.js setImage), which the renderer gets once as a pixmap
 *   pixels(name, size)  the raw RGBA rows, not kept: for a picture pushed to an HMI graphic row as a PNG
 */
const zlib = require('zlib');
const data = require('./hud_data');
const rec = require('./kit/record');

const BASE = 0x48500000;            // our image ids ('HP' + n): clear of the kit's own
const cache = Object.create(null);
let next = 0;

/** { w, h, px } of layout `name`'s picture ('big' or 'small'), or null when there is none or it can't be read. */
function pixels(name, size) {
    try {
        const p = (data.json('previews/' + name + '.json') || {})[size];
        if (!p || !p.z) return null;
        const px = zlib.inflateSync(Buffer.from(p.z, 'base64'));
        return px.length === p.w * p.h * 4 ? { w: p.w, h: p.h, px } : null;
    } catch (e) { return null; }
}

/** { id, w, h } of layout `name`'s picture ('big' or 'small'), or null when there is none. */
function get(name, size) {
    const key = name + ':' + size;
    if (cache[key] !== undefined) return cache[key];
    let out = null;
    try {
        const p = pixels(name, size);
        if (p) {
            const id = BASE + next++;
            rec.setImage(id, p.w, p.h, p.px);
            out = { id, w: p.w, h: p.h };
        }
    } catch (e) { out = null; }
    cache[key] = out;
    return out;
}

module.exports = { get, pixels };
