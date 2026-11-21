'use strict';
/**
 * mapview.js - direction A on the cluster's `map` target, the glance view (round "Auto Beam", package HD): three layers on the
 * app's own cluster-render connection (8 allowed), all inside the core x 334..754, y 44..416 that both themes' map windows show.
 *
 *   z 0  ab_road    effect 420 x 260 at (334, 156): the road, the low and the high cone (u_beam.x: the high beam's extent; the
 *                   fold is uniform messages, no pixels), our car at the foot
 *   z 1  ab_lights  effect, the same box: up to 15 lights by class, the cause ringed (u_li / u_lp: 120 numbers a change)
 *   z 2  text       image 420 x 112 at (334, 44): the sign, the advice, the reason, the driver's lamps
 *
 * Both effects have no sampler (nothing can be left unbound, no R8 texture); the shaders are the shipped text of
 * hud/shaders.json (comments stripped, one look each). contend false and guide_hold 0 always: we wait while BMW's map holds
 * the slot and never hold back BMW's CarPlay box. While the car shows a message of its own (Vehicle2.statusDisplayedCCMessage)
 * every layer is hidden: our picture yields. Pixel memory: the one image, 420 x 112 x 8 = 376 320 B. Upload: the text sheet's
 * changed rectangle when the advice, the reason or the lamps change; the beam's fold and the lights' motion are uniforms.
 *
 *   const mv = new MapView(ClusterRender, { layer, socket, shaders, log });   mv.open();   mv.update(v, e, night, lang);
 *   mv.close();   mv.stats -> { pixelBytes, uniforms, sets, sheets }
 */
const V = require('./view');
const P = require('./paint');
const R = require('./raster');

const G = V.GEO.map;
const CODE = { head: 1, tail: 2, street: 3, bike: 1, reflector: 4, other: 4 };      // ab_lights' classes (a bike: one white lamp)

/** ab_road's uniforms for extent e. */
function roadUniforms(v, e, night) {
    const r4 = (a) => a.map((x) => Math.round(x * 10000) / 10000);
    return { u_size: [G.scene[2], G.scene[3]], u_view: r4([V.HZ, G.pxm, V.KF, V.RANGE]), u_beam: r4([Math.max(0, Math.min(1, e)), night ? 1 : 0, v.curve || 0, V.EGO_X]) };
}
/** ab_lights' uniforms: up to 15 lights, nearest kept, in the scene box's px. */
function lightUniforms(v, night) {
    const li = [], lp = [];
    const list = (v.lights || []).filter((l) => l.x >= 0 && l.x <= V.RANGE - V.EGO_X).sort((a, b) => a.x - b.x).slice(0, 15);
    for (let i = 0; i < 15; i++) {
        const l = list[i];
        if (l) {
            const q = P.lightPlace(G, l, v.curve || 0);
            li.push(Math.round(q.px * 10) / 10, Math.round(q.py * 10) / 10, Math.round(q.r * 100) / 100, (CODE[l.kind] || 4) + (l.ringed ? 10 : 0));
            lp.push(Math.round(q.hs * 10) / 10, 0, 0, 0);
        } else { li.push(0, 0, 0, 0); lp.push(0, 0, 0, 0); }
    }
    return { u_size: [G.scene[2], G.scene[3]], u_li: li, u_lp: lp, u_night: [night ? 1 : 0, 0] };
}

function MapView(CR, o) {
    this.CR = CR;
    this.o = o || {};
    this.cr = null;
    this.refs = null;
    this.last = { u: {}, text: null, vis: true };
    this.stats = { pixelBytes: 0, uniforms: 0, sets: 0, sheets: 0 };
}

MapView.prototype.open = function () {
    if (this.cr) return;
    const L = this.o.layer || {}, sh = this.o.shaders || {};
    const base = { target: L.target || 'map', klass: L.klass || 'content', contend: !!L.contend, guide_hold: L.guideHold ? 1 : 0 };
    const cr = new this.CR.ClusterRender('auto_beam', this.o.socket);
    this.cr = cr;
    this.refs = {
        road: cr.effect(Object.assign({}, base, { z: 0, x: G.scene[0], y: G.scene[1], w: G.scene[2], h: G.scene[3], fs: sh.ab_road })),
        lights: cr.effect(Object.assign({}, base, { z: 1, x: G.scene[0], y: G.scene[1], w: G.scene[2], h: G.scene[3], fs: sh.ab_lights })),
        text: cr.image(Object.assign({}, base, { z: 2, x: G.text[0], y: G.text[1], w: G.text[2], h: G.text[3], iw: G.text[2], ih: G.text[3] })),
    };
    this.last = { u: {}, text: null, vis: true };
    cr.connect();
};

MapView.prototype.close = function () {
    if (!this.cr) return;
    try { this.cr.close(); } catch (e) { /* closing anyway */ }
    this.cr = null; this.refs = null;
};

MapView.prototype._uniforms = function (ref, tag, u) {
    Object.keys(u).forEach((name) => {
        const val = u[name], k = tag + ':' + name, sv = val.join(' ');
        if (this.last.u[k] === sv) return;
        this.last.u[k] = sv;
        this.stats.uniforms++;
        if (val.length > 4) this.cr.uniform(ref, name, val, { type: 'vec4' });
        else this.cr.uniform(ref, name, val);
    });
};

/** Draw view v with the high beam at extent e. Returns the pixel bytes this update sent. */
MapView.prototype.update = function (v, e, night, lang) {
    if (!this.cr || !this.refs) return 0;
    const f = this.refs;
    const vis = !v.yield;
    if (vis !== this.last.vis) {
        [f.road, f.lights, f.text].forEach((ref) => { this.cr.set(ref, { visible: vis }); this.stats.sets++; });
        this.last.vis = vis;
    }
    if (!vis) return 0;
    this._uniforms(f.road, 'road', roadUniforms(v, e, night));
    this._uniforms(f.lights, 'lights', lightUniforms(v, night));
    const px = P.textSheet(v, night, lang);
    const r = R.diffRect(this.last.text, px, P.TEXT_W, P.TEXT_H);
    this.last.text = px;
    if (!r) return 0;
    this.cr.pixels(f.text, [r], R.cut(px, P.TEXT_W, r));
    this.stats.pixelBytes += r.w * r.h * 4;
    this.stats.sheets++;
    return r.w * r.h * 4;
};

MapView.LAYERS = [
    ['effect', G.scene[0], G.scene[1], G.scene[2], G.scene[3]],
    ['effect', G.scene[0], G.scene[1], G.scene[2], G.scene[3]],
    ['image', G.text[0], G.text[1], G.text[2], G.text[3]],
];
MapView.PIXEL_MEMORY = G.text[2] * G.text[3] * 8;
MapView.roadUniforms = roadUniforms;
MapView.lightUniforms = lightUniforms;

module.exports = MapView;
