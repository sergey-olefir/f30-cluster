'use strict';
/**
 * ACC View 0.1.0 (round 1120 AA2; docs/AGENT-BRIEF-acc-app.md, design docs/r1120/AA-SPEC.md 3.1): a separate, READ-ONLY app
 * that shows direction E, the lane view, as a view of what the car's sensors see (the owner's FOCUS, 2026-11-20): the lane
 * boundaries the camera measures (or our fixed symbol), the road users by class at their measured places (world.js), the car
 * ahead highlighted at its level, and, secondary, the cruise / limiter set speed in a ring, the limit, an event pill. It
 * reads and draws; it writes nothing to the car. Each source of objects and lanes is logged (counts, classes, rates, ranges
 * in relative metres) so the first drive shows which ones this car sends.
 *
 * Two placements:
 *   - The centre screen, the app's own page (screen MAIN, a canvas): the main view, drawn whenever the page is open. E on the
 *     left (the lane by our painter, the car as the acc_car shader's own sprite baked at build time), a data table on the
 *     right. One pixel image handed to the kit (record.js setImage), repainted only when the picture changes (the car jumps
 *     to its level here; it glides on the cluster), at most 4 a second. Nothing on the page can be pressed: no tap target, no button but the kit's Settings.
 *   - The cluster's `map` target, behind "Показувати на щитку" (default OFF, a test): E's four layers (mapview.js) on our own
 *     connection, without contend and with guide_hold 0, a 150 ms tick that sends only what changed.
 * "Демо: стани по колу" runs the mockups' 14 states in turn on both placements, with no signals.
 *
 * Read only: the fields of app.json, "s" (a notifier) or "rs" (a non-zero getter), and one event. No setter, no method, no
 * driver-assistance setting. The signals are subscribed once, the first time the page is drawn or the map is switched on;
 * their proxies are kept until the app restarts (a proxy shutdown has never been tried on the car).
 * Night: the car's own day/night (Vehicle.statusDayNightChangeOver, config.dayNight: Twin Dial's source), else the sun.
 * The car's own collision warning (FASuS.requestWarnBrakeCoordinatorDisplay): logged; drawn only when config.warn names its
 * member and active values (null: never).
 * Words: words.js only (Ukrainian and English); config.lang until the languages module comes.
 * Log lines: numbers and enum names only. Never lets an exception escape: an OAP app that exits twice is uninstalled.
 */
const mgu = require('./kit/mgu');
const M = require('./model');
const P = require('./paint');
const R = require('./raster');
const Wd = require('./words');
const MapView = require('./mapview');
const Wo = require('./world');

const SPEED_IF = 'de.bmw.infotainment.vehicle.Vehicle2';
const FASUS_IF = 'de.bmw.infotainment.fasus.FASuS';
// what the car's sensors see (the owner's FOCUS, 2026-11-20; world.js has the members): every one an EVENT, read only
const CAM_IF = 'de.bmw.environmentalmodel.ObjectRecognitionFrontCamera';
const TCP_IF = 'de.bmw.sensors.objects.RecogFrontCameraObjectlist';
const LANE_IF = 'de.bmw.environmentalmodel.LaneBoundaries';
const LANES_IF = 'de.bmw.environmentalmodel.Lanes';
const KDO_IF = 'de.bmw.dass.driverassistanceapplications.KeepDistanceObjectsLegacy';
const WORLD_MS = 100;
const WORLD_PAINT_MS = 500;        // the centre page follows moving traffic at most twice a second               // the sources are decoded at most this often (they may come at 20-30 a second)
const TICK_MS = 150;
const PAGE_FPS = 4;
const GLIDE_MS = 260;               // the glide's time constant: about a second from one level to the next
const IMG_ID = 0x41560001;          // our pixel image's id in the kit's renderer ('AV' + 1): clear of the kit's own

function req(name) { try { return require('./' + name); } catch (e) { return null; } }

mgu.run({
    start(ctx) {
        const log = ctx.log;
        const cfg = (ctx.spec && ctx.spec.config) || {};
        const FV = req('front_vehicle'), SRC = req('limit_src'), CR = req('cluster_render_client'), SUN = req('sun');
        const REC = req('kit/record');
        if (!FV || !SRC || !CR) { log.error('acc: a shared module is missing (front_vehicle / limit_src / cluster_render_client): staying idle'); return; }
        const layerCfg = Object.assign({ target: 'map', klass: 'content', contend: false, guideHold: 0 }, cfg.layer || {});
        const cruCfg = SRC.hudCruiseCfg(cfg.cruise || {});
        const tsrCfg = SRC.tsrCfg({ tsr: (cfg.sign && cfg.sign.tsr) || {} });
        const warnCfg = cfg.warn || {};
        const dnCfg = cfg.dayNight || null;
        const fvCfg = Object.assign({}, cfg.frontVehicle || {}, { on: true });
        const loc = cfg.location || { lat: 50.45, lon: 30.52 };
        const demoMs = typeof cfg.demoMs === 'number' && cfg.demoMs >= 500 ? cfg.demoMs : 4000;
        const shaders = R.hudJson('shaders.json');
        const wcfg = Wo.cfgOf(cfg.world);
        const srcOn = Object.assign({ cam: true, tcp: true, lanes: true, lanesDetection: true, keepDistance: true, frontExtended: true }, (cfg.world && cfg.world.sources) || {});

        const st = {
            show: false, demo: false, subscribed: false, tracker: null, kmh: null, cru: null, warn: false, warnRaw: null, warnLines: 0,
            lim: null, limAt: 0, fvAt: 0, dn: null, dnCode: undefined, demoAt: 0, demoI: 0, z: 0, zAt: 0, s: null, key: '', lineAt: 0,
            timer: null, mv: null, mapBytes: 0,
            page: { key: '', sk: '', paintAt: 0, at: 0, loopAt: 0, force: true, paints: 0, ms: 0 },
            // the world: the newest raw values (decoded in step(), at most every WORLD_MS), the tracker, the lane model, the logs
            raw: { rec: null, pos: null, posAt: 0, tcp: null, tcpAt: 0, lanes: null, lanesAt: 0 }, worldAt: 0, laneModel: null, laneAt: 0,
            tracker2: new Wo.Tracker(wcfg, ['cam', 'tcp']), logs: {}, leadCls: null,
        };
        const slog = (name) => st.logs[name] || (st.logs[name] = new Wo.SourceLog(name, 10000));
        const guard = (what, fn) => function () { try { return fn.apply(null, arguments); } catch (e) { log.error('acc: ' + what + ': ' + (e && e.stack || e)); return undefined; } };
        const lang = () => Wd.langOf(cfg.lang);

        // ---- day / night: the car's own verdict first (config.dayNight, as Twin Dial), else the sun ----
        function night() {
            if (cfg.night === 'day' || cfg.night === 'night') return cfg.night === 'night';         // a fixed look (bench)
            if (st.dn === 'day' || st.dn === 'night') return st.dn === 'night';
            try { return SUN ? !!SUN.isNight(Date.now(), loc.lat, loc.lon) : false; } catch (e) { return false; }
        }

        // ---- signals: subscribed once (read only) ----
        function subscribe() {
            if (st.subscribed) return;
            st.subscribed = true;
            st.tracker = FV.create(fvCfg, { log });
            st.tracker.start();
            const w = (iface, inst, handlers) => Promise.resolve().then(() => ctx.signals.watch(iface, inst, handlers, log))
                .then((r) => log.info('acc: watch ' + iface.split('.').pop() + (r && r.error ? ' error' : ' ok')), () => log.warn('acc: watch ' + iface.split('.').pop() + ' failed'));
            const fvC = st.tracker.cfg;
            const h1 = {}; h1[fvC.field] = guard('front', (v) => { st.fvAt = Date.now(); st.tracker.feed(v, st.kmh); });
            w(fvC.iface, fvC.instance || '1', h1);
            const h2 = {}; h2[cruCfg.hudField] = guard('cruise', (v) => { st.cru = SRC.hudCruiseOf(cruCfg, v); });
            w(cruCfg.hudIface, cruCfg.hudInstance || '1', h2);
            w(SPEED_IF, '1', { statusCarSpeed2: guard('speed', (v) => {
                const raw = v && typeof v === 'object' ? v.speedVehicleCentreOfGravity : null;
                st.kmh = typeof raw === 'number' && raw !== 65535 ? raw * 0.015625 : null;
            }) });
            if (tsrCfg) {
                const h3 = {}; h3[tsrCfg.event] = guard('limit', (v) => {
                    const r = SRC.tsrOf(tsrCfg, v);
                    st.lim = r.state === 'limit' && r.unit === 'kmh' ? r.kmh : null; st.limAt = Date.now();
                });
                w(tsrCfg.iface, tsrCfg.instance || '1', h3);
            }
            if (dnCfg && dnCfg.iface && dnCfg.field) {
                const h4 = {}; h4[dnCfg.field] = guard('daynight', (v) => {
                    let raw = v;
                    (dnCfg.path || []).forEach((k) => { raw = raw && typeof raw === 'object' ? raw[k] : undefined; });
                    const m = dnCfg.map && raw !== undefined && raw !== null && Object.prototype.hasOwnProperty.call(dnCfg.map, String(raw)) ? dnCfg.map[String(raw)] : null;
                    if (m === 'day' || m === 'night') st.dn = m;
                    else if (m !== 'keep') st.dn = null;
                    const code = typeof raw === 'number' ? raw : dnCfg.codes && Object.prototype.hasOwnProperty.call(dnCfg.codes, String(raw)) ? dnCfg.codes[raw] : '?';
                    if (code !== st.dnCode) { st.dnCode = code; log.info('acc: day/night ' + code + ' -> ' + (st.dn || 'sun')); }
                });
                w(dnCfg.iface, dnCfg.instance || '1', h4);
            }
            // the car's own collision warning: its struct is unseen on this car, so it is LOGGED (enum names / numbers, at most 40
            // lines a run) and only drawn when config.warn names a path and the values that mean "active" (null: never)
            w(FASUS_IF, '1', { requestWarnBrakeCoordinatorDisplay: guard('warn', (v) => {
                const words = v && typeof v === 'object' ? Object.keys(v).map((k) => SRC.rawWord(v[k])).join(' ') : SRC.rawWord(v);
                st.warnRaw = words;
                if (st.warnLines < 40) {
                    st.warnLines++;
                    log.info('acc: warn raw ' + (v && typeof v === 'object' ? Object.keys(v).map((k) => k + '=' + SRC.rawWord(v[k])).join(' ') : SRC.rawWord(v)));
                }
                if (Array.isArray(warnCfg.path) && Array.isArray(warnCfg.active)) {
                    let x = v;
                    warnCfg.path.forEach((k) => { x = x && typeof x === 'object' ? x[k] : undefined; });
                    st.warn = warnCfg.active.indexOf(x) >= 0;
                    if (st.warnLines < 40) { st.warnLines++; log.info('acc: warn ' + SRC.rawWord(x) + ' -> ' + (st.warn ? 'active' : 'none')); }
                }
            }) });
            // what the sensors see: each handler only keeps the newest value (and counts it); step() decodes. A source this car
            // never sends costs one idle subscription.
            const q = (v) => (v && typeof v === 'object' ? SRC.rawWord(v.eventDataQualifier) : '-');
            if (srcOn.cam) w(CAM_IF, '1', {
                ObjectRecognition: guard('cam rec', (v) => { st.raw.rec = v; }),
                ObjectPosition: guard('cam pos', (v) => { st.raw.pos = v; st.raw.posAt = Date.now(); st.raw.posQ = q(v); }),
            });
            if (srcOn.tcp) w(TCP_IF, '1', { objectlistTCP: guard('tcp', (v) => { st.raw.tcp = v; st.raw.tcpAt = Date.now(); }) });
            if (srcOn.lanes) w(LANE_IF, '1', { LaneBoundaries: guard('lanes', (v) => { st.raw.lanes = v; st.raw.lanesAt = Date.now(); st.raw.lanesQ = q(v); }) });
            if (srcOn.lanesDetection) w(LANES_IF, '1', { LanesDetection: guard('lanes det', (v) => {
                const kinds = ['laneLeft', 'laneEgo', 'laneRight', 'laneLeftNext', 'laneRightNext'].map((k) => ({ cls: v && v[k] ? SRC.rawWord(v[k].laneType) : '-' }));
                slog('lanesDetection').add(kinds, q(v));
            }) });
            if (srcOn.keepDistance) w(KDO_IF, '1', { keepDistanceObjects1: guard('kdo', (v) => {
                const o = v && v.keepDistObjects1 ? v.keepDistObjects1 : v || {};
                const objs = [0, 1, 2].map((i) => ({ cls: 'type' + SRC.rawWord(o['KeepDistObjType' + i]), x: typeof o['KeepDistObjDistanceLongitudinal' + i] === 'number' ? o['KeepDistObjDistanceLongitudinal' + i] : null, y: typeof o['KeepDistObjDistanceLateral' + i] === 'number' ? o['KeepDistObjDistanceLateral' + i] : null }));
                slog('keepDistance raw').add(objs, null);
            }) });
            if (srcOn.frontExtended) w(fvC.iface, fvC.instance || '1', { DataFrontVehicleExtended: guard('front ext', (v) => {
                const t = v && typeof v === 'object' ? v.frontVehicleExtendedObjectType : null;
                st.leadCls = Object.prototype.hasOwnProperty.call(Wo.OBJECT_TYPE, String(t)) ? Wo.OBJECT_TYPE[String(t)] : null;
                slog('frontExtended').add([{ cls: SRC.rawWord(t) }], SRC.rawWord(v && v.frontVehicleExtendedStatusMove));
            }) });
        }

        /** Decode the newest raw values into the tracker and the lane model (at most every WORLD_MS); log a summary per source. */
        function world(now) {
            if (now - st.worldAt >= WORLD_MS) {
                st.worldAt = now;
                const r = st.raw;
                if (r.pos) {
                    const list = Wo.camObjects(wcfg, r.rec, r.pos);
                    st.tracker2.update('cam', list, r.posAt);
                    slog('cam').add(list, r.posQ);
                    r.pos = null;
                }
                if (r.tcp) {
                    const list = Wo.tcpObjects(wcfg, r.tcp);
                    st.tracker2.update('tcp', list, r.tcpAt);
                    slog('tcp').add(list, null);
                    r.tcp = null;
                }
                if (r.lanes) {
                    const m = Wo.laneModel(wcfg, r.lanes);
                    if (m) { st.laneModel = m; st.laneAt = r.lanesAt; }
                    slog('lanes').add(m ? m.lines.map((l) => ({ cls: l.type, x: l.len, y: l.y0 })) : [], r.lanesQ);
                    r.lanes = null;
                }
                Object.keys(st.logs).forEach((k) => { const ln = st.logs[k].line(now); if (ln) log.info(ln); });
            }
            const lanes = st.laneModel && now - st.laneAt < wcfg.lanes.staleMs ? st.laneModel : null;
            const objs = st.tracker2.frame(now);
            const src = st.tracker2.sourceNow(now);
            if (!lanes && !src) return null;
            const lead = Wo.leadOf(objs, lanes);
            return { lanes, objects: objs.filter((o) => o !== lead), lead: lead ? { x: lead.x, y: lead.y, cls: lead.cls } : null, src: src || 'lanes' };
        }

        // ---- the state now, and the car's glide (shared by both placements) ----
        function step(now) {
            let s;
            if (st.demo) {
                if (!st.demoAt) st.demoAt = now;
                const hold = M.DEMO[st.demoI][2].scene ? Math.max(demoMs, Wo.SCENE_MS) : demoMs;
                if (now - st.demoAt >= hold) { st.demoAt = now; st.demoI = (st.demoI + 1) % M.DEMO.length; }
                s = M.withScene(M.DEMO[st.demoI][2], now - st.demoAt);
            } else {
                const lim = st.lim !== null && now - st.limAt < ((tsrCfg && tsrCfg.staleMs) || 3000) ? st.lim : null;
                s = M.stateOf(st.tracker ? st.tracker.view(st.kmh) : null, st.cru, st.warn, lim);
                const wd = world(now);
                if (wd) {
                    if (wd.lead && st.leadCls) wd.lead.cls = st.leadCls;
                    if (!s.tgt && wd.lead) {                     // highlighted only while the gap says there is a car ahead
                        wd.objects = wd.objects.concat([{ id: 'lead', cls: wd.lead.cls, x: wd.lead.x, y: wd.lead.y, alpha: 1 }]).sort((a, b) => b.x - a.x);
                        wd.lead = null;
                    }
                    s.world = wd;
                }
            }
            const lead = M.leadOf(s);
            const zt = lead ? lead.x / M.RANGE : 0;
            if (!lead || !st.s || !M.leadOf(st.s) || !st.zAt) st.z = zt;                       // a car appears where it is
            else {
                const k = 1 - Math.exp(-Math.max(0, now - st.zAt) / GLIDE_MS);
                st.z += (zt - st.z) * k;
                if (Math.abs(zt - st.z) < 0.003) st.z = zt;
            }
            st.zAt = now; st.s = s;
            const key = M.keyOf(s);
            if (key !== st.key) {
                st.key = key;
                if (now - st.lineAt >= 1000) { st.lineAt = now; log.info('acc: state ' + key + (st.demo ? ' demo ' + M.DEMO[st.demoI][0] : '')); }
            }
            return s;
        }

        // ---- the map target ----
        const tick = guard('tick', () => {
            if (!st.show) return;
            const s = step(Date.now());
            if (st.mv) st.mapBytes += st.mv.update(s, st.z, night(), lang());
        });
        function mapOpen() {
            if (st.mv) return;
            if (!shaders.acc_lane || !shaders.acc_car) { log.error('acc: hud/shaders.json is missing: the map stays off'); return; }
            const sock = process.env.HUD_CLUSTER_SOCKET || cfg.socketPath || CR.DEFAULT_PATH;     // HUD_CLUSTER_SOCKET: the Mac bench only
            st.mv = new MapView(CR, { layer: layerCfg, socket: sock, shaders, log });
            st.mv.open();
            const cr = st.mv.cr;
            cr.on('layer', guard('layer', (ref, state) => log.info('acc: layer ' + ref + ' ' + state)));
            cr.on('target', guard('target', (name, state) => { if (name === layerCfg.target) log.info('acc: target ' + name + ' ' + state); }));
            cr.on('error', guard('socket', (e) => log.warn('acc: cluster-render ' + (e && e.code || 'error'))));
            log.info('acc: map layers 5 (lane, users, car, text 380x96, pill 340x44) on ' + layerCfg.target + (layerCfg.contend ? ' (contend)' : ' (waits for the slot)') +
                ', pixel memory ' + MapView.PIXEL_MEMORY);
        }
        function mapClose() {
            if (!st.mv) return;
            st.mv.close();
            st.mv = null;
            log.info('acc: map layers dropped');
        }

        // ---- the centre page ----
        const pageDraw = guard('page', () => {
            const now = Date.now(), pg = st.page;
            if (now - pg.loopAt > 700) pg.force = true;              // the page was shown again: draw at once
            pg.loopAt = now;
            if (!st.subscribed) subscribe();
            const s = st.show ? st.s || step(now) : step(now);
            const nt = night(), ln = lang();
            const age = st.demo ? (s.data === 'ok' ? 0.3 : s.data === 'stale' ? 2.6 : null) : (st.fvAt ? (now - st.fvAt) / 1000 : null);
            const ageWord = typeof age === 'number' ? (age < 1 ? 0 : Math.min(99, Math.floor(age))) : -1;
            const info = { age: typeof age === 'number' ? (age < 1 ? 0.5 : ageWord) : null, warn: st.demo ? null : st.warnRaw };
            const demo = st.demo ? M.DEMO[st.demoI][0] : null;
            const sk = M.keyOf(s) + '|' + nt + '|' + ln + '|' + ageWord + '|' + (info.warn || '') + '|' + (demo || '');
            const key = sk + '|' + M.worldKey(s);
            // a change of the state repaints at once; the world alone moving (traffic, lanes) at most every WORLD_PAINT_MS: a
            // repaint with moving lanes costs ~30 ms on the Mac, so perhaps 0.3-0.6 s on the head unit (unmeasured)
            const worldOnly = key !== pg.key && sk === pg.sk && now - pg.paintAt < WORLD_PAINT_MS;
            if (key !== pg.key && !worldOnly) {
                pg.sk = sk; pg.paintAt = now;
                const t0 = Date.now();
                const r = P.centre(s, { night: nt, lang: ln, info, demo });     // the car at its place: the page repaints per change only (<= 4 a second)
                pg.ms += Date.now() - t0; pg.paints++;
                if (REC) REC.setImage(IMG_ID, P.PAGE_W, P.PAGE_H, r.px);
                pg.key = key; pg.force = true;
                if (pg.paints % 50 === 1) log.info('acc: page paint ' + Math.round(pg.ms / pg.paints) + ' ms (' + pg.paints + ' paints)');
            }
            if (!pg.force && now - pg.at < 5000) return undefined;
            pg.force = false; pg.at = now;
            const cv = ctx.canvas(1600, 520);
            // no tab strip of the kit's (G.frame): its selected-tab colour is the kit theme's, red in the default one, and the page
            // has no tabs. The top 38 px stay our background (the full-screen layout crops them anyway).
            cv.clear(M.colours('centre', nt).bg);
            cv.image(IMG_ID, 0, 520 - P.PAGE_H, P.PAGE_W, P.PAGE_H);
            return ctx.ui.image('MAIN_GFX', cv);
        });

        const apply = guard('apply', () => {
            st.show = ctx.settings.get('show') === true;
            const demo = ctx.settings.get('demoCycle') === true;
            if (demo !== st.demo) { st.demo = demo; st.demoAt = 0; st.demoI = 0; st.s = null; }
            if (st.show) {
                if (!st.subscribed) subscribe();
                mapOpen();
                if (!st.timer) st.timer = setInterval(tick, TICK_MS);
                tick();
            } else {
                mapClose();
                if (st.timer) { clearInterval(st.timer); st.timer = null; }
            }
            st.page.force = true;
            log.info('acc: show ' + (st.show ? 'on' : 'off') + ', demo ' + (st.demo ? 'on' : 'off') + ', lang ' + lang());
        });

        try {
            ctx.settings.onChange(guard('setting', (key) => { if (key === 'show' || key === 'demoCycle') apply(); }));
            if (typeof ctx.onLayout === 'function') ctx.onLayout(guard('layout', () => { st.page.force = true; }));
            apply();
            ctx.loop('MAIN', PAGE_FPS, pageDraw);
            log.info('acc: ACC View ' + ((ctx.spec && ctx.spec.version) || '') + ' started');
        } catch (e) { log.error('acc: start: ' + (e && e.stack || e)); }
        process.on('exit', () => { try { mapClose(); } catch (e) { /* exiting anyway */ } });
    },
});
