'use strict';
/**
 * STAND-IN for twin_dial's engine, for the bench tools only (tools/shots/twin, bench/test-twin-sim.js) until the real
 * pieces (B engine, C layout, D messages) are merged. Never shipped; it carries no look worth comparing: flat blocks
 * stand where the real app draws dials, text and symbols. What it DOES model, so the harness can be tested end to end:
 *
 *   - SPEC section 13.2's layers and rectangles (three background layers split round the gear gap, two dial effect
 *     layers with an R8 face asset, tab bar, centre sheet, hub labels, bottom row, plate), on two connections;
 *   - every keep-out of SPEC section 3.3 (BMW's belt group and side lamps are holes; nothing touches the gear gap);
 *   - the needles' law (SPEC sections 5.1, 5.2), the OFF rest position, READY, day / night, the two centre pages;
 *   - the message rule of SPEC section 8.4 in its simplest form (the D7 latch, the window, the plate) with hud.cc =
 *     { state: none | window | ours, severity } as the engine contract names it;
 *   - STANDIN_LEAK=belt|gear|window|half (env): draws something it must not, so the audits can be shown to fail.
 */
const fs = require('fs');
const path = require('path');
const { ClusterRender } = require('./cluster_render_client.js');

/** A2's baked R8 scene texture (apps/twin_dial/hud/scene/<name>.json), from TWIN_SCENE_DIR; null when not there. */
function scene(name) {
    const dirs = [process.env.TWIN_SCENE_DIR].filter(Boolean);
    for (let i = 0; i < dirs.length; i++) {
        try {
            const d = JSON.parse(fs.readFileSync(path.join(dirs[i], name + '.json'), 'utf8'));
            const b = Buffer.from(d.r8, 'base64');
            if (b.length === d.w * d.h) return { w: d.w, h: d.h, buf: b };
        } catch (e) { /* next */ }
    }
    return null;
}

const BELT = [497, 660, 688, 720];
const LAMPS = [[22, 211, 88, 258], [21, 264, 80, 317], [11, 324, 76, 372], [16, 378, 66, 432], [1774, 176, 1873, 208], [1835, 214, 1903, 263], [1844, 262, 1908, 318]];
const MASK_RECT = [694, 592, 1230, 704];      // A2's panel_mask.json rect (panel px)
const PLATE = [694, 592, 536, 128];
const HOLES_FS = [
    'precision highp float;', 'varying vec2 v_uv;', 'uniform vec2 u_size;', 'uniform vec4 u_hole[8];',
    'uniform sampler2D u_mask; uniform vec4 u_mrect; uniform float u_open;',      // the baked window (A2's panel_mask): 255 = BMW's panel shows through
    'void main(){ vec2 p = v_uv * u_size; float a = 1.0;',
    '  for (int i = 0; i < 8; i++) { vec4 h = u_hole[i]; if (p.x >= h.x && p.x < h.z && p.y >= h.y && p.y < h.w) a = 0.0; }',
    '  if (p.x >= u_mrect.x && p.x < u_mrect.z && p.y >= u_mrect.y && p.y < u_mrect.w) a *= 1.0 - u_open * texture2D(u_mask, (p - u_mrect.xy) / (u_mrect.zw - u_mrect.xy)).r;',
    '  gl_FragColor = vec4(0.0, 0.0, 0.0, a); }',
].join('\n');
const DIAL_FS = [
    'precision highp float;', 'varying vec2 v_uv;', 'uniform sampler2D u_face;', 'uniform vec2 u_size;',
    'uniform float u_ang; uniform float u_gain;',
    'void main(){ vec2 p = v_uv * u_size - vec2(308.0, 310.0);',
    '  float L = texture2D(u_face, v_uv).r;',
    '  vec2 d = vec2(sin(u_ang), -cos(u_ang));',
    '  float t = clamp(dot(p, d), 139.5, 297.0);',
    '  float needle = 1.0 - smoothstep(1.5, 2.5, length(p - d * t));',
    '  float v = max(L, needle) * u_gain;',
    '  gl_FragColor = vec4(v, v, v, step(0.02, v)); }',
].join('\n');

const SEV = { red: [176, 10, 37], amber: [240, 170, 10], green: [60, 155, 34], grey: [111, 111, 111] };
const COLOR = { RED: 'red', 1: 'red', YELLOW: 'amber', 2: 'amber', ORANGE: 'amber', 4: 'amber', GREEN: 'green', 3: 'green', WHITE: 'grey', 5: 'grey', DEFAULT: 'grey', 0: 'grey' };

function rect(buf, w, x, y, rw, rh, c, gain) {
    const g = gain === undefined ? 1 : gain;
    for (let j = Math.max(0, Math.floor(y)); j < Math.min(buf.length / 4 / w, Math.ceil(y + rh)); j++) {
        for (let i = Math.max(0, Math.floor(x)); i < Math.min(w, Math.ceil(x + rw)); i++) {
            const o = (j * w + i) * 4;
            buf[o] = Math.round(c[0] * g); buf[o + 1] = Math.round(c[1] * g); buf[o + 2] = Math.round(c[2] * g); buf[o + 3] = 255;
        }
    }
}
const speedAngle = (v) => (v <= 100 ? -125 + 25 * (v / 20) : Math.min(125, 25 * (v - 100) / 40));
const rpmAngle = (r) => Math.min(125, -125 + 2 * 125 * (r / 8000));

class HudApp {
    constructor(ctx) {
        this.ctx = ctx; this.log = ctx.log; this.config = (ctx.spec && ctx.spec.config) || {};
        this.activeName = 'twin'; this.client = { ready: false }; this.cc = { state: 'none', severity: null, reason: 'start' };
        this.driveMode = null; this.m = { speed: null, rpm: null, cond: null, engine: null, night: null, list: null, active: null, shown: null };
        this.confirmed = false; this.statusCb = null; this.sizes = {};
        this.leak = process.env.STANDIN_LEAK || '';
        this.conns = [new ClusterRender('twin_dial', process.env.HUD_CLUSTER_SOCKET), new ClusterRender('twin_dial_2', process.env.HUD_CLUSTER_SOCKET)];
        this.L = {};            // layers: name -> { c, ref, w, h, buf, dirty }
        this.build();
        this.wire();
        this.evaluate();        // blind start: nothing read yet, so the window is open from the first frame (SPEC 8.4 keep-open 1)
    }
    onStatus(cb) { this.statusCb = cb; if (cb) cb('stand-in'); }
    setting(k) { return this.ctx.settings.get(k); }
    night() { const s = this.setting('nightLook'); return s === 'on' ? true : s === 'off' ? false : this.m.night === true; }

    img(c, name, x, y, w, h, z) {
        const ref = c.image({ target: 'panel', klass: 'content', z: z || 1, x, y, w, h });
        this.L[name] = { c, ref, w, h, buf: Buffer.alloc(w * h * 4), x, y };
    }
    holes(c, name, x, y, w, h) {
        const ref = c.effect({ target: 'panel', klass: 'content', z: 0, x, y, w, h, fs: HOLES_FS });
        this.L[name] = { c, ref, fx: true, x, y, w, h };
        c.uniform(ref, 'u_size', [w, h], { type: 'vec2' });
        return ref;
    }
    build() {
        const A = this.conns[0], B = this.conns[1];
        // the window mask: A2's baked one when found, else a rectangle of 255 over the design polygon's box
        const mk = scene('panel_mask') || { w: 536, h: 112, buf: Buffer.alloc(536 * 112, 255) };
        const mask = A.asset({ target: 'panel', format: 'r8', w: mk.w, h: mk.h, sampling: 'bilinear' });
        A.pixels(mask, null, mk.buf);
        this.realMask = !!scene('panel_mask');
        this.holes(A, 'bgL', 0, 0, 1380, 720);
        A.bind(this.L.bgL.ref, 'u_mask', mask);
        A.uniform(this.L.bgL.ref, 'u_mrect', MASK_RECT, { type: 'vec4' });
        // bgRT and bgRB carry the shader too: their mask sampler needs an asset, and their window box is empty
        this.holes(A, 'bgRT', 1380, 0, 540, 660);
        this.holes(A, 'bgRB', 1460, 660, 460, 60);
        ['bgRT', 'bgRB'].forEach((n) => { A.bind(this.L[n].ref, 'u_mask', mask); A.uniform(this.L[n].ref, 'u_mrect', [0, 0, 0, 0], { type: 'vec4' }); A.uniform(this.L[n].ref, 'u_open', [0]); });
        // the faces: A2's baked 616 x 560 R8 faces when found (centre (308, 310), texel = panel px), else a drawn ring
        const faces = {};
        [['tach', 72], ['speed', 1232]].forEach((s2) => {
            const n = s2[0], x = s2[1], real = scene(n === 'tach' ? 'face_tacho' : 'face_speedo');
            let fw = 124, fh = 114, fb;
            if (real) { fw = real.w; fh = real.h; fb = real.buf; } else {
                fb = Buffer.alloc(124 * 114);
                for (let j = 0; j < 114; j++) for (let i = 0; i < 124; i++) {
                    const px = (i + 0.5) * 616 / 124 - 308, py = (j + 0.5) * 560 / 114 - 310, r = Math.sqrt(px * px + py * py) / 300, a = Math.abs(Math.atan2(px, -py) * 180 / Math.PI);
                    let v = 0;
                    if (r >= 0.58 && r <= 0.94 && a <= 144) v = 70;
                    if ((r >= 0.537 && r <= 0.553) || (r >= 0.96 && r <= 0.985 && a <= 144)) v = 255;
                    fb[j * 124 + i] = v;
                }
            }
            this.realFaces = !!real;
            const face = A.asset({ target: 'panel', format: 'r8', w: fw, h: fh, sampling: 'bilinear' });
            A.pixels(face, null, fb);
            const ref = A.effect({ target: 'panel', klass: 'content', z: 2, x, y: 90, w: 616, h: 560, fs: DIAL_FS });
            this.L[n] = { c: A, ref, fx: true, x, y: 90, w: 616, h: 560 };
            A.uniform(ref, 'u_size', [616, 560], { type: 'vec2' });
            A.bind(ref, 'u_face', face);
        });
        this.img(B, 'tabs', 618, 127, 684, 52, 2);
        this.img(B, 'centre', 690, 200, 540, 400, 2);
        this.img(B, 'hub', 230, 320, 300, 60, 3);
        this.img(B, 'row', 698, 630, 524, 88, 3);
        this.img(B, 'plate', PLATE[0], PLATE[1], PLATE[2], PLATE[3], 4);
        this.L.plate.c.set(this.L.plate.ref, { visible: false });
        this.L.row.c.set(this.L.row.ref, { visible: true });
    }
    wire() {
        this.conns.forEach((c, i) => c.on('ready', () => { if (i === 0) this.client.ready = true; this.repaint(true); }));
        const S = this.ctx.signals, log = this.log;
        const w = (iface, inst, h) => S.watch(iface, inst, h, log);
        const speedRaw = (v) => { this.m.speed = v && isFinite(v.speedVehicleCentreOfGravity) ? v.speedVehicleCentreOfGravity * 0.015625 : null; };
        w('de.bmw.infotainment.vehicle.Vehicle2', '1', { statusCarSpeed2: speedRaw, statusDisplayedCCMessage: (v) => { this.m.shownNow2 = v && v.statusNumberCheckControlMessageDisplay; } });
        w('de.bmw.infotainment.vehicle.CDS', '1', {
            statusEngineSpeed2: (v) => { this.m.rpm = v && isFinite(v.actualValueRPMEngineCrankshaft) ? v.actualValueRPMEngineCrankshaft * 0.25 : null; },
            statusEngineStatus: (v) => { this.m.engine = v && v.statusEngineRunDrive; },
            statusEngineTemperature: () => {},
        });
        w('de.bmw.infrastructure.VehicleCondition', '1', { VehicleCondition: (v) => { this.m.cond = v && v.statusConditionVehicle; } });
        w('de.bmw.infotainment.vehicle.Vehicle', '1', { statusDayNightChangeOver: (v) => { const d = v && v.dayNightChangeOver; this.m.night = d === 2 || d === 'NACHT' ? true : d === 1 || d === 'TAG' ? false : this.m.night; } });
        w('de.bmw.infotainment.KombiInterface_2', '1', {
            ccList: (v) => { this.m.list = (Array.isArray(v) ? v : []).map((e) => { const x = (e && e.cCListElement) || {}; return { id: Number(x.cCIdentifer), name: String(x.cCShortName || ''), color: COLOR[x.cCColor] || 'grey' }; }); this.evaluate(); },
        });
        w('de.bmw.infotainment.KombiIF', '1', {
            statusActiveCCMessage: (v) => { this.m.active = v ? Number(v.numberDisplayControlCheckControlMessage) : null; this.evaluate(); },
            statusRangeTankStatus: () => {}, timeDateUTC: () => {}, statusShowTimeDate: () => {}, statusMenuCCMessage: () => {},
            statusBordcomputerAverage: () => {}, statusBordcomputerTravelData: () => {}, statusBordcomputerTravelStart: () => {},
        });
        w('de.bmw.infotainment.misc.MDrive', '1', { dataDisplayGearbox: () => {} });
        w('de.bmw.infrastructure.VehicleInformation', '1', { statusGearboxDrive: () => {} });
        w('de.bmw.infotainment.drivingexcitement.FES', '1', { statusFESVehicleDynamicSwitchHMI: () => {} });
        w('de.bmw.infrastructure.EnvironmentalInformation', '1', { ExteriorTemperature: () => {}, UnitBN2020: () => {} });
        w('de.bmw.infotainment.hmi.hmimediastate.HmiMediaState', 'HMI_CID', { playerMetadata: () => {} });
        w('de.bmw.infotainment.entertainment.mediasource.MediaSource', '1', { activeSourceId: () => {} });
        w('de.bmw.infotainment.connectivity.telephony.ConnectivityAggregator', '1', { aggregatedCallState: () => {} });
        w('de.bmw.infotainment.navigation.navigationstatus.NavigationStatus', '1', { guidingState: () => {} });
    }

    // the message rule, in its simplest form (SPEC section 8.4): the D7 latch, the window, the plate
    evaluate() {
        const m = this.m, list = m.list;
        let state, sev = null, reason, entry = null;
        if (list === null && m.active === null) { state = 'window'; reason = 'message signals not readable yet'; }
        else if (m.active === null) {
            const may = list && list.some((e) => e.id !== 0);
            state = may ? 'window' : 'none'; reason = may ? 'D7: shown-now never seen' : 'no message';
        } else if (m.active === 0) { state = 'none'; reason = 'no message shown'; }
        else {
            entry = list && list.find((e) => e.id === m.active);
            if (entry) this.confirmed = true;
            if (!entry || !entry.name) { state = 'window'; reason = entry ? 'empty name' : 'active number has no ccList entry'; }
            else if (!this.confirmed) { state = 'window'; reason = 'D7: shown-now never seen'; }
            else { state = 'ours'; reason = 'our plate'; }
            if (entry && state !== 'none') sev = entry.color;
        }
        if (state === 'window' && !sev && list) { const e = list.find((x) => x.id !== 0); sev = e ? e.color : 'grey'; }
        if (state === 'none') sev = null;
        const was = this.cc.state;
        this.cc = { state, severity: sev, reason, name: entry ? entry.name : '' };
        if (state === 'ours' && was !== 'ours') { this.oursSince = Date.now(); }
        if (state !== was) this.log.info('cc: ' + was + ' -> ' + state + ' (' + reason + ')');
        this.repaint(false);
    }

    start() {
        this.conns.forEach((c) => c.connect());
        this.timer = setInterval(() => this.repaint(false), 100);
    }
    stop() { clearInterval(this.timer); this.conns.forEach((c) => c.close()); }

    // ---- drawing ----
    repaint(force) {
        if (!this.client.ready) return;
        const m = this.m, night = this.night(), gain = night ? 0.7 : 1;
        const off = !(m.cond === 8 || m.cond === 10) && !(m.rpm > 0);
        const tachA = off ? -135 : rpmAngle(m.rpm || 0), speedA = speedAngle(m.speed || 0);
        const open = this.cc.state === 'window' || (this.cc.state === 'ours' && Date.now() - this.oursSince < 200);
        const key = [tachA, speedA, night, this.cc.state, this.cc.severity, this.cc.name, this.setting('centre'), m.cond, this.leak, open].join('|');
        if (!force && key === this.lastKey) return;
        this.lastKey = key;
        const A = this.conns[0];
        const hole = (arr) => { const o = arr.slice(0, 8).reduce((a, h) => a.concat(h), []); while (o.length < 32) o.push(0); return o; };
        const winOpen = open && this.leak !== 'window' ? 1 : 0;
        const belt = this.leak === 'belt' ? [] : [BELT];
        A.uniform(this.L.bgL.ref, 'u_hole', hole(belt.concat(LAMPS.slice(0, 4))), { type: 'vec4' });
        A.uniform(this.L.bgRT.ref, 'u_hole', hole(LAMPS.slice(4).map((h) => [h[0] - 1380, h[1], h[2] - 1380, h[3]])), { type: 'vec4' });
        A.uniform(this.L.bgRB.ref, 'u_hole', hole([]), { type: 'vec4' });
        A.uniform(this.L.bgL.ref, 'u_open', [winOpen]);
        A.uniform(this.L.tach.ref, 'u_ang', [tachA * Math.PI / 180]);
        A.uniform(this.L.speed.ref, 'u_ang', [speedA * Math.PI / 180]);
        A.uniform(this.L.tach.ref, 'u_gain', [gain]);
        A.uniform(this.L.speed.ref, 'u_gain', [gain]);
        const sev = this.cc.severity ? SEV[this.cc.severity] : null;
        // tab bar: a grey ramp, the warning cell (744..812) lit by the severity while a message shows
        const T = this.L.tabs;
        for (let j = 0; j < 45; j++) rect(T.buf, T.w, 0, j, T.w, 1, [j * 2.5, j * 2.5, j * 2.5], gain);
        if (sev && this.cc.state !== 'none') rect(T.buf, T.w, 744 - 618, 0, 68, 45, sev, gain);
        rect(T.buf, T.w, 636 - 618, 128 - 127 + 6, 90, 22, [255, 255, 255], gain);
        // the centre sheet: a title, a rule and four blocks (the page shows in the shape of its blocks)
        const C = this.L.centre;
        C.buf.fill(0);
        rect(C.buf, C.w, 190, 51, 160, 30, [255, 255, 255], gain);
        rect(C.buf, C.w, 51, 96, 439, 2, [204, 204, 204], gain);
        const clock = this.setting('centre') !== 'trip';
        if (clock) { rect(C.buf, C.w, 130, 135, 280, 80, [255, 255, 255], gain); rect(C.buf, C.w, 190, 235, 160, 30, [255, 255, 255], gain); rect(C.buf, C.w, 170, 285, 200, 30, [255, 255, 255], gain); }
        else { [[95, 150], [295, 150], [95, 220], [295, 220]].forEach((p) => rect(C.buf, C.w, p[0] + 40, p[1] - 30, 150, 36, [255, 255, 255], gain)); }
        // hub labels: READY (green) while the car is ready to drive
        const H = this.L.hub;
        H.buf.fill(0);
        if (m.cond === 8 || m.cond === 10) rect(H.buf, H.w, 110, 8, 80, 20, [60, 155, 34], gain);
        // bottom row: four number blocks; a message in the plate's place hides it (and the window opens before it goes)
        const R = this.L.row, P = this.L.plate;
        R.buf.fill(0);
        [[40, 8], [40, 56], [330, 8], [330, 56]].forEach((p) => rect(R.buf, R.w, p[0], p[1], 150, 28, [255, 255, 255], gain));
        P.buf.fill(0);
        if (this.cc.state === 'ours' && sev) {
            rect(P.buf, P.w, 8, 31, 66, 84, sev, gain);
            rect(P.buf, P.w, 89, 34, 300, 30, [255, 255, 255], gain);
            rect(P.buf, P.w, 89, 80, 300, 30, [255, 255, 255], gain);
        }
        if (this.leak === 'half' && this.cc.state === 'window') rect(P.buf, P.w, 300, 40, 200, 60, [255, 255, 255], gain);      // ink inside BMW's window
        const rowShown = !(this.cc.state === 'ours' || this.cc.state === 'window');
        const leakRow = this.leak === 'gear';
        [T, C, H, R, P].forEach((l) => l.c.pixels(l.ref, null, l.buf));
        this.L.row.c.set(this.L.row.ref, { visible: rowShown });
        this.L.plate.c.set(this.L.plate.ref, { visible: this.cc.state === 'ours' || (this.leak === 'half' && this.cc.state === 'window') });
        if (leakRow && !this.L.leak) {          // a layer over the gear gap: the layout rule must catch it
            const ref = this.conns[1].image({ target: 'panel', klass: 'content', z: 5, x: 1390, y: 664, w: 40, h: 40 });
            this.L.leak = { c: this.conns[1], ref };
            this.conns[1].pixels(ref, null, Buffer.alloc(40 * 40 * 4, 255));
        }
        if (this.statusCb) this.statusCb('stand-in: ' + this.cc.state);
    }
}

module.exports = HudApp;
