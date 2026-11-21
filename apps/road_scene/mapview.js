'use strict';
/**
 * mapview.js - Road Scene on the cluster's `map` target (round fixes-1121 RS: ACC View's six layers, round 1120 AA2, with Auto
 * Beam's content inside them: no second set of layers). Six layers on the app's own cluster-render connection (8 allowed), all
 * inside the core x 334..754, y 44..416 that both themes' map windows show.
 *
 *   z 0  acc_lane  effect 420 x 218 at (334, 198): the ground, up to 4 lane boundaries (measured, or our guessed corridor), the
 *                  lit gap, the chevrons, and OUR BEAMS on the road at night (u_beam: the high beam's extent follows the lamps)
 *   z 1  acc_obj   effect, the same box: up to 16 items: the road users (their lamps lit and the ring when a light source the
 *                  beam advisor sees is that road user), the light points by class, the ring round the car ahead
 *   z 2  acc_car   effect, the car ahead's box (its lamps lit when it is the light source); moved and resized, never re-uploaded
 *   z 3  acc_car   effect, OUR car at the foot (the same shader source, a light body): moved sideways with our lane
 *   z 4  text      image 420 x 96 at (334, 54): the beam advice (at night, while the advisor is available), the ring, the -/+
 *                  marks, the limit plate, the suggestion
 *   z 5  pill      image 340 x 44 at (374, 150): the status pill (transparent while there is no event)
 *
 * The three effects have no sampler (nothing can be left unbound, no R8 texture); the shaders are the shipped text of
 * hud/shaders.json (comments stripped, one look each). contend false and guide_hold 0 always: we wait while BMW's map holds
 * the slot and never hold back BMW's CarPlay box. While the car shows a message of its own (Vehicle2.statusDisplayedCCMessage)
 * every layer is hidden: our picture yields (Auto Beam's rule). Pixel memory: the two images only,
 * (420 x 96 + 340 x 44) x 8 = 442 240 B. Upload: an image sheet's changed rectangle when its picture changes (the set speed, the
 * limit, an event, the advice); the lanes, the beams' fold, the road users, the lights and the car's glide are uniform and `set`
 * messages (a few hundred bytes to ~2 KB), no pixels.
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
    this.last = { u: {}, carBox: null, carVis: false, text: null, pill: null, vis: true };
    this.stats = { pixelBytes: 0, uniforms: 0, sets: 0, sheets: 0 };
}

MapView.prototype.open = function () {
    if (this.cr) return;
    const L = this.o.layer || {}, sh = this.o.shaders || {};
    const base = { target: L.target || 'map', klass: L.klass || 'content', contend: !!L.contend, guide_hold: L.guideHold ? 1 : 0 };
    const cr = new this.CR.ClusterRender('road_scene', this.o.socket);
    this.cr = cr;
    const box0 = M.carBox(G, M.depthOf(3)), eb = M.egoBox(G, {});
    this.refs = {
        lane: cr.effect(Object.assign({}, base, { z: 0, x: G.lane[0], y: G.lane[1], w: G.lane[2], h: G.lane[3], fs: sh.acc_lane })),
        obj: cr.effect(Object.assign({}, base, { z: 1, x: G.lane[0], y: G.lane[1], w: G.lane[2], h: G.lane[3], fs: sh.acc_obj })),
        car: cr.effect(Object.assign({}, base, { z: 2, x: box0[0], y: box0[1], w: box0[2], h: box0[3], fs: sh.acc_car, visible: false })),
        ego: cr.effect(Object.assign({}, base, { z: 3, x: eb[0], y: eb[1], w: eb[2], h: eb[3], fs: sh.acc_car })),
        text: cr.image(Object.assign({}, base, { z: 4, x: G.text[0], y: G.text[1], w: G.text[2], h: G.text[3], iw: G.text[2], ih: G.text[3] })),
        pill: cr.image(Object.assign({}, base, { z: 5, x: G.pill[0], y: G.pill[1], w: G.pill[2], h: G.pill[3], iw: G.pill[2], ih: G.pill[3] })),
    };
    this.last = { u: {}, carBox: box0, carVis: false, egoBox: eb, text: null, pill: null, vis: true };
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
        if (v.length > 4) this.cr.uniform(ref, name, v, { type: 'vec4' });
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
    // the car's own message (Auto Beam's yield): every layer hidden until it is gone, nothing else sent meanwhile
    const vis = !(s.beam && s.beam.yield);
    if (vis !== this.last.vis) {
        ['lane', 'obj', 'ego', 'text', 'pill'].forEach((k) => { this.cr.set(f[k], { visible: vis }); this.stats.sets++; });
        if (!vis && this.last.carVis) { this.cr.set(f.car, { visible: false }); this.stats.sets++; this.last.carVis = false; }
        this.last.vis = vis;
    }
    if (!vis) return 0;
    this._uniforms(f.lane, 'lane', M.laneUniforms(G, s, z, night));
    this._uniforms(f.obj, 'obj', M.objUniforms(G, s, night));
    // our own car: moved sideways with the ego lane (a `set`, never a re-upload)
    const eb = M.egoBox(G, s), le = this.last.egoBox;
    if (!le || eb[0] !== le[0] || eb[1] !== le[1] || eb[2] !== le[2] || eb[3] !== le[3]) {
        this.cr.set(f.ego, { x: eb[0], y: eb[1], w: eb[2], h: eb[3] });
        this.stats.sets++;
        this.last.egoBox = eb;
    }
    this._uniforms(f.ego, 'ego', M.egoUniforms(s, night, eb[2], eb[3]));
    const lead = M.leadPlace(s);
    if (lead) {
        const b = M.carBox(G, z, lead.y), lb = this.last.carBox;
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
    ['effect', G.lane[0], G.lane[1], G.lane[2], G.lane[3]],
    ['effect', 'car'],
    ['effect', 'ego'],
    ['image', G.text[0], G.text[1], G.text[2], G.text[3]],
    ['image', G.pill[0], G.pill[1], G.pill[2], G.pill[3]],
];
MapView.PIXEL_MEMORY = (G.text[2] * G.text[3] + G.pill[2] * G.pill[3]) * 8;

module.exports = MapView;
