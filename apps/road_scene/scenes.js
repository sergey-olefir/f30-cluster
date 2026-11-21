'use strict';
/**
 * scenes.js - the demo's moving scenes, played through the REAL chain: the world in metres -> the raw values the camera would
 * send (the light objects in the raw units of the algorithm's own config, or the fallback object list) -> the contract's frame
 * (contract.js) -> the algorithm (shared/beam_logic.js) -> the view. A simulated driver follows the advice after a reaction
 * time, so the score moves too. Round "Auto Beam", package HD. Pure; Node 8.
 *
 *   SCENES                  pass (an oncoming car passes), follow (catching up with a car that turns off), town (street
 *                           lights, then a town-entry sign), curve (a car passes in a curve; the yaw holds the low beam),
 *                           fallback (the light stream silent: an oncoming car from the camera's object list)
 *   SCENE_MS                each scene's length (it starts over)
 *   world(name, ms)         -> { lights: [{ id, kind, x, y }] (m), objects: [...] (fallback), speed, yaw, limit, urban, curve }
 *   rawOf(cfg, o)           a light in metres -> the raw object the camera event would carry (cfg: the algorithm's config)
 *   new Player(decider)     .step(name, ms) -> { out, lamps, world, snap, frame } (the scene's own clock; see step())
 */
const C = require('./contract');

const SCENES = ['pass', 'follow', 'town', 'curve', 'fallback'];
const SCENE_MS = 12000;

function world(name, ms) {
    const s = ms / 1000;
    const w = { lights: [], objects: null, speed: 86, yaw: 0, limit: 90, urban: null, curve: 0 };
    if (name === 'pass') {
        const x = 700 - 50 * s;                       // closing at 2 x 90 km/h
        if (x > 4) w.lights.push({ id: 1, kind: 'head', x, y: 3.5 });
    } else if (name === 'follow') {
        const x = 290 - 15 * s;                        // catching up at ~54 km/h
        if (s < 8) w.lights.push({ id: 2, kind: 'tail', x, y: 0 });       // then it turns off the road
    } else if (name === 'town') {
        w.speed = s < 7 ? 72 : 52;
        for (let i = 0; i < 8; i++) {
            const x = 60 + i * 38 - (s * 20) % 38 - (s < 2 ? 200 * (1 - s / 2) : 0);
            if (x > 6 && x < 420 && s > 1) w.lights.push({ id: 3 + i, kind: 'street', x, y: i % 2 ? -6.5 : 7.5 });
        }
        if (s >= 6 && s < 6.5) w.sign = 'town_in';     // the camera reads the town-entry sign
        w.limit = s < 6 ? 70 : 50;
    } else if (name === 'curve') {
        const k = s > 3 && s < 8 ? 1 : s >= 8 && s < 9 ? 9 - s : s > 2 && s <= 3 ? s - 2 : 0;
        w.yaw = 9 * k; w.curve = k / 450; w.speed = 72;
        const x = 250 - 50 * (s - 1);                  // an oncoming car passes in the curve; the yaw then holds the low beam
        if (s > 1 && x > 4) w.lights.push({ id: 12, kind: 'head', x, y: 3.5 + 0.5 * w.curve * x * x });
    } else if (name === 'fallback') {
        w.lights = null;                               // the light stream is silent (HR: likely on a car without the licence)
        w.objects = [];
        const x = 160 - 50 * s;                        // the object list sees the oncoming car only from ~150 m
        if (x > 4) w.objects.push({ id: 41, cls: 1, x, y: 3.5, vx: -50, lane: null, move: null, head: 'on', rear: null, vabs: -26, src: 'tcp' });
        if (s > 3) w.objects.push({ id: 42, cls: 1, x: 70 - 2 * (s - 3), y: 0, vx: -2, lane: null, move: null, head: 'on', rear: 'on', vabs: 22, src: 'tcp' });
    }
    return w;
}

/** metres -> the raw light object under the algorithm's own scales (the inverse of its readLight). */
function rawOf(cfg, o) {
    const sc = cfg.scale, cls = Object.keys(cfg.classes).filter((k) => cfg.classes[k] === o.kind)[0];
    const az = -Math.atan2(o.y, o.x) * 180 / Math.PI;
    const strong = cfg.status && cfg.status.strong && cfg.status.strong.length ? cfg.status.strong[0] : 2;
    return { slot: 0, id: o.id, cls: cls === undefined ? 0 : Number(cls), status: strong, x: Math.round(sc.x.center + az / sc.x.gain), y: o.kind === 'street' ? Math.round(sc.y.center + 4 / sc.y.gain) : sc.y.center, w: 4, h: 2,
        dist: Math.max(0, Math.min(126, Math.round((o.x - sc.dist.offset) / sc.dist.gain))), wl: sc.ang ? sc.ang.center : 127, wr: sc.ang ? sc.ang.center : 127, age: 0 };
}

function Player(decider) {
    this.d = decider; this.name = null;
    this.drv = { high: false, want: null, at: 0 };
}
/** The world at ms -> the snapshot the inputs would give at the scene's own clock tt. */
Player.prototype._snap = function (w, tt) {
    const cfg = this.d.algo && this.d.algo.config ? this.d.algo.config : null;
    const v = (x) => ({ v: x, at: tt });
    return {
        t: tt, lights: w.lights && cfg ? { v: w.lights.map((o) => rawOf(cfg, o)), at: tt } : { v: null, at: null }, verdict: { v: null, at: null },
        objects: w.objects ? { v: w.objects, at: tt, qual: 0 } : { v: null, at: null }, low: v(true), high: v(this.drv.high), flash: v(false), fog: v(false),
        speed: v(w.speed), yaw: v(w.yaw), bright: { v: null, at: null }, sun: v('night'), dayNight: v('night'), wiper: v(0), limit: v(w.limit), urban: { v: null, at: null }, msg: v(0), stalk: [],
        signs: { v: w.sign && this.lastSign !== w.sign ? [{ t: tt, kind: w.sign }] : [], at: tt },
    };
};
/**
 * One tick of scene `name`, ms into it. The scene runs on its own clock: at its start the algorithm is reset and driven
 * through 15 s of dark, empty road (every module's dark and settle holds are over), so each scene starts from "high".
 */
Player.prototype.step = function (name, ms) {
    if (name !== this.name) {
        this.name = name; this.d.reset(); this.drv = { high: true, want: 'high', at: 0 }; this.lastSign = null;
        const empty = { lights: [], objects: name === 'fallback' ? [] : null, speed: 86, yaw: 0, limit: 90, curve: 0 };
        if (name === 'fallback') empty.lights = null;
        for (let k = 0; k <= 150; k++) this.d.step(C.frameOf(this._snap(empty, k * 100)));
    }
    const tt = 15100 + ms;
    const w = world(name, ms);
    const snap = this._snap(w, tt);
    const frame = C.frameOf(snap);
    this.lastSign = w.sign || null;
    const out = this.d.step(frame);
    // the simulated driver: follows the advice after 0.9 s (a dip) or 1.4 s (back to high)
    if (out.want !== this.drv.want) { this.drv.want = out.want; this.drv.at = tt; }
    if (tt - this.drv.at >= (out.want === 'low' ? 900 : 1400)) this.drv.high = out.want === 'high';
    return { out, lamps: this.drv.high ? 'high' : 'low', world: w, snap, frame };
};

module.exports = { SCENES, SCENE_MS, world, rawOf, Player };
