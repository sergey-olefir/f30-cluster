'use strict';
/**
 * mapview.js - direction E on the cluster's `map` target (round 1120 AA2; AA-SPEC 3.1's cost table): four layers on the app's
 * own cluster-render connection, all inside the core x 334..754, y 44..416 that both themes' map windows show.
 *
 *   z 0  acc_lane  effect 420 x 258 at (334, 158): the ground, our lane's two lines, the lit gap, the chevrons
 *   z 1  acc_car   effect, the car's box: 35 x 21 (level 5) .. 177 x 104 (level 1); moved and resized, never re-uploaded
 *   z 2  text      image 380 x 96 at (368, 54): the ring, the -/+ marks, the limit plate, the suggestion
 *   z 3  pill      image 340 x 44 at (374, 362): the status pill (transparent while there is no event)
 *
 * The two effects have no sampler (nothing can be left unbound, no R8 texture); the shaders are the shipped text of
 * hud/shaders.json (comments stripped, one look each). contend false and guide_hold 0 always: we wait while BMW's map holds
 * the slot and never hold back BMW's CarPlay box. Pixel memory: the two images only, (380 x 96 + 340 x 44) x 8 = 411 520 B.
 * Upload: an image sheet's changed rectangle when its picture changes (the set speed, the limit, an event); the car's glide
 * and the gap are `set` and uniform messages, a few hundred bytes, no pixels.
 *
 *   const mv = new MapView(ClusterRender, { layer, socket, shaders, log });   mv.open();   mv.update(s, z, night, lang);
 *   mv.close();   mv.stats -> { pixelBytes, uniforms, sets, sheets }
 */
const M = require('./model');
const P = require('./paint');
const R = require('./raster');

const G = M.GEO.map;

function MapView(CR, o) {
    this.CR = CR;
    this.o = o || {};
    this.cr = null;
    this.refs = null;
    this.last = { u: {}, carBox: null, carVis: false, text: null, pill: null };
    this.stats = { pixelBytes: 0, uniforms: 0, sets: 0, sheets: 0 };
}

MapView.prototype.open = function () {
    if (this.cr) return;
    const L = this.o.layer || {}, sh = this.o.shaders || {};
    const base = { target: L.target || 'map', klass: L.klass || 'content', contend: !!L.contend, guide_hold: L.guideHold ? 1 : 0 };
    const cr = new this.CR.ClusterRender('acc_view', this.o.socket);
    this.cr = cr;
    const box0 = M.carBox(G, M.depthOf(3));
    this.refs = {
        lane: cr.effect(Object.assign({}, base, { z: 0, x: G.lane[0], y: G.lane[1], w: G.lane[2], h: G.lane[3], fs: sh.acc_lane })),
        car: cr.effect(Object.assign({}, base, { z: 1, x: box0[0], y: box0[1], w: box0[2], h: box0[3], fs: sh.acc_car, visible: false })),
        text: cr.image(Object.assign({}, base, { z: 2, x: G.text[0], y: G.text[1], w: G.text[2], h: G.text[3], iw: G.text[2], ih: G.text[3] })),
        pill: cr.image(Object.assign({}, base, { z: 3, x: G.pill[0], y: G.pill[1], w: G.pill[2], h: G.pill[3], iw: G.pill[2], ih: G.pill[3] })),
    };
    this.last = { u: {}, carBox: box0, carVis: false, text: null, pill: null };
    cr.connect();
};

MapView.prototype.close = function () {
    if (!this.cr) return;
    try { this.cr.close(); } catch (e) { /* closing anyway */ }
    this.cr = null; this.refs = null;
};

MapView.prototype._uniforms = function (ref, tag, u) {
    Object.keys(u).forEach((name) => {
        const v = u[name], k = tag + ':' + name, sv = v.join(' ');
        if (this.last.u[k] === sv) return;
        this.last.u[k] = sv;
        this.stats.uniforms++;
        if (name === 'u_nb') this.cr.uniform(ref, name, v, { type: 'vec4' });
        else this.cr.uniform(ref, name, v);
    });
};

MapView.prototype._sheet = function (ref, which, px, w, h) {
    const r = R.diffRect(this.last[which], px, w, h);
    this.last[which] = px;
    if (!r) return 0;
    this.cr.pixels(ref, [r], R.cut(px, w, r));
    this.stats.pixelBytes += r.w * r.h * 4;
    this.stats.sheets++;
    return r.w * r.h * 4;
};

/** Draw state s with the car at depth z (the glide's). Returns the pixel bytes this update sent. */
MapView.prototype.update = function (s, z, night, lang) {
    if (!this.cr || !this.refs) return 0;
    const f = this.refs;
    this._uniforms(f.lane, 'lane', M.laneUniforms(G, s, z, night));
    if (s.tgt) {
        const b = M.carBox(G, z), lb = this.last.carBox;
        if (!this.last.carVis || !lb || b[0] !== lb[0] || b[1] !== lb[1] || b[2] !== lb[2] || b[3] !== lb[3]) {
            this.cr.set(f.car, { x: b[0], y: b[1], w: b[2], h: b[3], visible: true });
            this.stats.sets++;
            this.last.carBox = b; this.last.carVis = true;
        }
        this._uniforms(f.car, 'car', M.carUniforms(s, night, b[2], b[3]));
    } else if (this.last.carVis) {
        this.cr.set(f.car, { visible: false });
        this.stats.sets++;
        this.last.carVis = false;
    }
    let bytes = this._sheet(f.text, 'text', P.textSheet(s, night, lang), P.TEXT_W, P.TEXT_H);
    bytes += this._sheet(f.pill, 'pill', P.pillSheet(s, night, lang), P.PILL_W, P.PILL_H);
    return bytes;
};

/** The layers this view registers: [kind, x, y, w, h] in z order (the tests and the report). */
MapView.LAYERS = [
    ['effect', G.lane[0], G.lane[1], G.lane[2], G.lane[3]],
    ['effect', 'car'],
    ['image', G.text[0], G.text[1], G.text[2], G.text[3]],
    ['image', G.pill[0], G.pill[1], G.pill[2], G.pill[3]],
];
MapView.PIXEL_MEMORY = (G.text[2] * G.text[3] + G.pill[2] * G.pill[3]) * 8;

module.exports = MapView;
