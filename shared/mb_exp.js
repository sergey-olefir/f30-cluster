'use strict';
/**
 * research3 MB (docs/research3/MB-REPORT.md): the black-box experiments. Every one is OFF unless app.json `config`
 * names it, so a build without these keys behaves exactly as before (nothing here is even wrapped).
 *
 *   config.mbGap     { "rect": [x0, y0, x1, y1], "conn": { "<widget id>": <connection index> },
 *                      "z": { "<widget id>": <z> }, "keep": { "<widget id>": "both" | "left" | "right" | "none" } }
 *                    No layer RECTANGLE of ours over `rect` (BMW's bottom-row gear letter and its margin): every effect
 *                    layer whose rectangle touches it is made as up to four layers round it (top, bottom, left, right
 *                    of it), each with the same shader, whose v_uv is mapped back to the whole widget (u_sub), so the
 *                    picture outside `rect` is the same. `keep` leaves out a widget's left or right piece (the
 *                    8-layers-per-connection cap); `conn` moves a widget to another connection for the same reason,
 *                    and `z` gives a moved widget the z that keeps it where it was in the stack (cluster-render orders
 *                    same-z layers by arrival, which is not kept across connections).
 *                    An IMAGE layer over `rect` is not cut; it is named in the log.
 *   config.mbCover   "clear" | "black" | "grey": one more effect layer over `config.mbCoverRect` (default the gear
 *                    gap [1380, 660, 1460, 720]), on top of ours (z 1000) on connection `config.mbCoverConn` (default
 *                    the last, 4), its pixels transparent, black, or the 6WB Comfort's grey there (24, 24, 25)
 *   config.mbRebuild { "onMode": true }: a full rebuild on every drive-mode change even when the layout stays the
 *                    same; { "everyMs": n }: a full rebuild every n ms (n >= 5000)
 *
 * Nothing here writes to the car, reads anything new, or changes a signal. It changes only which layer rectangles we
 * ask cluster-render for, and when.
 */

const DECL = /varying\s+vec2\s+v_uv\s*;/;
const MAIN = /void\s+main\s*\(\s*(?:void)?\s*\)\s*\{/;
const GAP = [1380, 660, 1460, 720];
const COVER = { clear: [0, 0, 0, 0], black: [0, 0, 0, 1], grey: [24 / 255, 24 / 255, 25 / 255, 1] };
const COVER_FS = 'precision mediump float;\nvarying vec2 v_uv;\nuniform vec4 u_c;\nvoid main() { gl_FragColor = u_c; }\n';
const GEOM = ['x', 'y', 'w', 'h', 'sx', 'sy', 'px', 'py', 'rotate'];

/** The shader with its v_uv read through u_sub (x, y: the piece's corner in the whole layer's uv; z, w: its share). No
 *  macro: every later use of the name is renamed, and main() sets the renamed global first. null: no v_uv / no main. */
function subFs(fs) {
    const d = DECL.exec(fs);
    if (!d) return null;
    const head = fs.slice(0, d.index + d[0].length);
    let tail = fs.slice(d.index + d[0].length).replace(/\bv_uv\b/g, 'v_uvW');
    const m = MAIN.exec(tail);
    if (!m) return null;
    tail = tail.slice(0, m.index + m[0].length) + '\n    v_uvW = u_sub.xy + v_uv * u_sub.zw;' + tail.slice(m.index + m[0].length);
    return head + '\nuniform vec4 u_sub;\nvec2 v_uvW;' + tail;
}

/** The pieces of rectangle r (x0, y0, x1, y1) outside g: top and bottom full width, left and right beside g. */
function split(r, g) {
    const out = [];
    if (g[1] > r[1]) out.push({ side: 'top', r: [r[0], r[1], r[2], Math.min(g[1], r[3])] });
    if (g[3] < r[3]) out.push({ side: 'bottom', r: [r[0], Math.max(g[3], r[1]), r[2], r[3]] });
    const y0 = Math.max(r[1], g[1]), y1 = Math.min(r[3], g[3]);
    if (y1 > y0) {
        if (g[0] > r[0]) out.push({ side: 'left', r: [r[0], y0, Math.min(g[0], r[2]), y1] });
        if (g[2] < r[2]) out.push({ side: 'right', r: [Math.max(g[2], r[0]), y0, r[2], y1] });
    }
    return out.filter((p) => p.r[2] > p.r[0] && p.r[3] > p.r[1]);
}

function touches(o, g) { return o.x < g[2] && g[0] < o.x + o.w && o.y < g[3] && g[1] < o.y + o.h; }

/** A connection whose uniform / bind / set / drop on a cut layer's first ref go to every piece of it. Done once. */
function fanOut(c) {
    if (c._mb) return c._mb;
    const o = { effect: c.effect.bind(c), uniform: c.uniform.bind(c), bind: c.bind.bind(c), set: c.set.bind(c), drop: c.drop.bind(c) };
    const parts = new Map();
    c._mb = { o, parts };
    c.uniform = function (ref) {
        const ps = parts.get(ref), rest = Array.prototype.slice.call(arguments, 1);
        if (!ps) return o.uniform.apply(null, arguments);
        let r;
        ps.forEach((p) => { r = o.uniform.apply(null, [p].concat(rest)); });
        return r;
    };
    c.bind = function (ref) {
        const ps = parts.get(ref), rest = Array.prototype.slice.call(arguments, 1);
        if (!ps) return o.bind.apply(null, arguments);
        let r;
        ps.forEach((p) => { r = o.bind.apply(null, [p].concat(rest)); });
        return r;
    };
    c.set = function (ref, opts) {
        const ps = parts.get(ref);
        if (!ps) return o.set(ref, opts);
        const k = Object.assign({}, opts);
        GEOM.forEach((n) => { delete k[n]; });       // a cut layer is not moved or scaled (calibration offsets): the pieces stay
        let r;
        ps.forEach((p) => { r = o.set(p, k); });
        return r;
    };
    c.drop = function (ref) {
        const ps = parts.get(ref);
        if (!ps) return o.drop(ref);
        parts.delete(ref);
        let r;
        ps.forEach((p) => { r = o.drop(p); });
        return r;
    };
    return c._mb;
}

class MbExp {
    constructor(config, log) {
        const c = config || {};
        this.log = log;
        const g = c.mbGap;
        this.gap = g && Array.isArray(g.rect) && g.rect.length === 4 ? { rect: g.rect.map(Number), conn: g.conn || {}, z: g.z || {}, keep: g.keep || {} } : null;
        this.cover = COVER[c.mbCover] ? { kind: c.mbCover, rect: Array.isArray(c.mbCoverRect) ? c.mbCoverRect.map(Number) : GAP, conn: Number.isInteger(c.mbCoverConn) ? c.mbCoverConn : 3 } : null;
        const rb = c.mbRebuild || {};
        this.rebuildOnMode = rb.onMode === true;
        this.rebuildEveryMs = Number(rb.everyMs) >= 5000 ? Math.floor(Number(rb.everyMs)) : 0;
        this.own = [];          // [{ c, ref }]: the cover layer
        this.cut = 0;
    }

    get on() { return !!(this.gap || this.cover || this.rebuildOnMode || this.rebuildEveryMs); }

    describe() {
        const p = [];
        if (this.gap) p.push('gap ' + JSON.stringify(this.gap.rect) + ' (no layer rectangle of ours over it)');
        if (this.cover) p.push('cover "' + this.cover.kind + '" over ' + JSON.stringify(this.cover.rect) + ' on connection ' + (this.cover.conn + 1));
        if (this.rebuildOnMode) p.push('rebuild on every drive-mode change');
        if (this.rebuildEveryMs) p.push('rebuild every ' + this.rebuildEveryMs + ' ms');
        return p.join('; ');
    }

    /** The connection a widget asks for, after config.mbGap.conn. */
    connOf(w, n) {
        if (!this.gap || !w || !Object.prototype.hasOwnProperty.call(this.gap.conn, w.id)) return n;
        return Math.floor(Number(this.gap.conn[w.id])) || 0;
    }

    /** The z a widget is made with, after config.mbGap.z. */
    zOf(w, z) {
        if (!this.gap || !w || !Object.prototype.hasOwnProperty.call(this.gap.z, w.id)) return z;
        return Math.floor(Number(this.gap.z[w.id])) || 0;
    }

    /** An image layer over the gap cannot be cut: named once per build. */
    image(w, opts) {
        if (this.gap && touches(opts, this.gap.rect)) this.log.warn('mb gap: image layer "' + (w && w.id) + '" covers the gap; not cut');
    }

    /** c.effect(opts), cut round the gap when config.mbGap is on and the rectangle touches it. -> its first ref, or 0. */
    effect(c, w, opts) {
        if (!this.gap || opts.target !== 'panel' || !touches(opts, this.gap.rect)) return c.effect(opts);
        const fs = subFs(opts.fs);
        if (!fs) { this.log.warn('mb gap: widget "' + (w && w.id) + '": shader has no v_uv / main(), not cut'); return c.effect(opts); }
        const keep = (w && this.gap.keep[w.id]) || 'both';
        const pieces = split([opts.x, opts.y, opts.x + opts.w, opts.y + opts.h], this.gap.rect)
            .filter((p) => !((p.side === 'left' && (keep === 'right' || keep === 'none')) || (p.side === 'right' && (keep === 'left' || keep === 'none'))));
        const mb = fanOut(c);
        const refs = [];
        pieces.forEach((p) => {
            const [x0, y0, x1, y1] = p.r;
            const ref = mb.o.effect(Object.assign({}, opts, { x: x0, y: y0, w: x1 - x0, h: y1 - y0, fs }));
            if (!ref) return;
            mb.o.uniform(ref, 'u_sub', [(x0 - opts.x) / opts.w, (y0 - opts.y) / opts.h, (x1 - x0) / opts.w, (y1 - y0) / opts.h]);
            refs.push(ref);
        });
        if (!refs.length) return 0;
        mb.parts.set(refs[0], refs);
        this.cut++;
        this.log.info('mb gap: widget "' + (w && w.id) + '" ' + opts.x + ',' + opts.y + ' ' + opts.w + 'x' + opts.h + ' as ' + refs.length + ' layers (' +
            pieces.map((p) => p.side + ' ' + p.r.join(',')).join('; ') + ')');
        return refs[0];
    }

    /** Before a rebuild drops our layers: the cover goes too. */
    dropOwn() {
        this.own.forEach((x) => { try { x.c.drop(x.ref); } catch (e) { /* the connection is gone; the client forgets it */ } });
        this.own = [];
        this.cut = 0;
    }

    /** After a layout is built: the cover layer, on top. clientAt(i) -> the engine's connection i. */
    afterBuild(clientAt, target) {
        if (!this.cover) return;
        const [x0, y0, x1, y1] = this.cover.rect;
        const c = clientAt(this.cover.conn);
        const ref = c.effect({ target, klass: 'content', z: 1000, x: x0, y: y0, w: x1 - x0, h: y1 - y0, fs: COVER_FS });
        if (!ref) { this.log.warn('mb cover: layer refused'); return; }
        c.uniform(ref, 'u_c', COVER[this.cover.kind]);
        this.own.push({ c, ref });
        this.log.info('mb cover: "' + this.cover.kind + '" over ' + this.cover.rect.join(',') + ' on connection ' + (this.cover.conn + 1));
    }
}

/** null unless app.json config names one of the experiments. */
function create(config, log) {
    const m = new MbExp(config, log);
    return m.on ? m : null;
}

module.exports = { create, subFs, split, COVER_FS };
