'use strict';
/**
 * Road Scene 0.1.0 (round fixes-1121 RS, docs/fixes-1121/BRIEF-RS-merge-road-scene.md): ACC View and Auto Beam merged into ONE
 * app with ONE scene (the owner, 2026-11-21: "додаток acc і автодального треба змерджити"). A READ-ONLY app: it reads and
 * draws, and the beam part only ADVISES. Nothing is written to the car.
 *
 * The scene (ACC View's direction E is the base): the lane boundaries the camera measures (or our own predicted path, anchored
 * at our rear axle), the road users by class at their measured places, the car ahead highlighted at its level, our own car at
 * the foot, the cruise ring and the limit. Auto Beam's content joins it: at night our beams on the road (the low beam's pool,
 * the high beam's cone folding in and out with the lamps' real state), the light sources by class (a light that is a road user
 * lights that road user's lamps: drawn once), the one that caused the advice ringed, and the advice as a sign at a fixed place
 * in the band (blue only when it advises high) with its reason and the lamps' real state beside it (amber when they disagree).
 * By day the scene is ACC View's. The table gains the advice, its reason, the source in use, the lamps and the score.
 *
 * ONE LOOP: every TICK_MS one tick builds the world (world.js, lanes.js) and the beam frame (contract.js), runs the switching
 * algorithm (shared/beam_logic.js, through the one adapter) and keeps the state; the map is updated from that tick, and the
 * centre page draws it (ticking once more first when the last tick is older than a GPU frame). One GPU page, one map connection.
 * The beam part's only actuator is the null one (actuator.js): it logs what it would switch and switches nothing.
 *
 * Two placements:
 *   - The centre screen, the app's own page (MAIN, a canvas): with the kit's GPU renderer shapes at up to 30 frames a second
 *     while something moves, none while still (gpu.js); the band and the table are images uploaded only when they change.
 *     Without the renderer: one software image (paint.js centre), a state change at once, motion at most twice a second.
 *   - The cluster's `map` target, behind "Показувати на щитку" (default OFF, a test): six layers (mapview.js) on our own
 *     connection, without contend and with guide_hold 0; hidden while the car shows a message of its own.
 * "Демо: стани по колу": ACC View's 28 entries, Auto Beam's 19 states on a road and its 5 scenes through the real algorithm.
 *
 * Read only: s / rs fields with non-zero getters and events as broadcasts (app.json). No setter, no method, no diagnostic
 * request, never acknowledgeObjectData*, never a LightswitchOperation member. The signals are subscribed once at start, so
 * the first drive's log answers which sources this car sends. Log lines: numbers and enum names only ("acc:" the scene's world,
 * "beam:" the advisor, "scene:" the app). Never lets an exception escape: an OAP app that exits twice is uninstalled.
 */
const mgu = require('./kit/mgu');
const M = require('./model');
const P = require('./paint');
const R = require('./raster');
const Wd = require('./words');
const MapView = require('./mapview');
const GP = require('./gpu');
const Wo = require('./world');
const Ln = require('./lanes');
const C = require('./contract');
const Inputs = require('./inputs');
const BV = require('./beam_view');
const Score = require('./score');
const SrcLog = require('./srclog');
const SC = require('./scenes');
const ACT = require('./actuator');

const SPEED_IF = 'de.bmw.infotainment.vehicle.Vehicle2';
const FASUS_IF = 'de.bmw.infotainment.fasus.FASuS';
// what the car's sensors see (the owner's FOCUS, 2026-11-20; world.js has the members): every one an EVENT, read only
const CAM_IF = 'de.bmw.environmentalmodel.ObjectRecognitionFrontCamera';
const TCP_IF = 'de.bmw.sensors.objects.RecogFrontCameraObjectlist';
const LANE_IF = 'de.bmw.environmentalmodel.LaneBoundaries';
const LANES_IF = 'de.bmw.environmentalmodel.Lanes';
const KDO_IF = 'de.bmw.dass.driverassistanceapplications.KeepDistanceObjectsLegacy';
// the beam advisor's own (Auto Beam, round "Auto Beam" package HD): read only
const LIGHT_IF = 'de.bmw.sensors.objects.RecogFrontCameraLightDetection';
const OBJ = (n) => (n === 11 || n === 12 || n === 15 ? 'M' : 'm') + 'ainBeamAssistantDataObject' + n;
const BODY_LIGHT = 'de.bmw.body.Light', ENV_IF = 'de.bmw.body.Environment', WIPER_IF = 'de.bmw.body.Wiper';
const YAW_IF = 'de.bmw.chassis.YawRateProvision';
const SIGN_IF = 'de.bmw.environmentalmodel.SignRecognitionFrontCamera';
const WORLD_MS = 100;
const WORLD_PAINT_MS = 500;         // the software page follows moving traffic at most twice a second
const CAM_MS = 400;                 // the view's sideways glide
const TICK_MS = 100;                // THE loop (Auto Beam's tick; ACC View's map ticked at 150 ms)
const PAGE_FPS = 4;
const GLIDE_MS = 260;               // the car ahead's glide: about a second from one level to the next
const FOLD_MS = 330;                // our high beam grows out or folds back in about a third of a second
const IMG_ID = 0x52530001;          // our pixel images' ids in the kit's renderer ('RS' + n): clear of the kit's own
const IMG_BAND = 0x52530002, IMG_TABLE = 0x52530003, IMG_SPRITE = 0x52530010;
const GPU_MIN_MS = 33;              // the GPU path: at most ~30 frames a second, and only while something moves
const DRIVE_RESET_MS = 5 * 60000;   // the low beam off this long: a new drive (the score starts over)

function req(name) { try { return require('./' + name); } catch (e) { return null; } }

mgu.run({
    start(ctx) {
        const log = ctx.log;
        const cfg = (ctx.spec && ctx.spec.config) || {};
        const FV = req('front_vehicle'), SRC = req('limit_src'), CR = req('cluster_render_client'), SUN = req('sun'), PSET = req('profile_settings');
        const REC = req('kit/record');
        if (!FV || !SRC || !CR) { log.error('scene: a shared module is missing (front_vehicle / limit_src / cluster_render_client): staying idle'); return; }
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
        const setting = (k, d) => { try { const x = ctx.settings.get(k); return x === undefined ? d : x; } catch (e) { return d; } };

        const st = {
            show: false, demo: false, subscribed: false, tracker: null, kmh: null, cru: null, warn: false, warnRaw: null, warnLines: 0,
            lim: null, limAt: 0, fvAt: 0, dn: null, dnCode: undefined, demoAt: 0, demoI: 0, z: 0, zAt: 0, s: null, key: '', lineAt: 0,
            timer: null, mv: null, mapBytes: 0, tickAt: 0, e: 0, eAt: 0,
            page: { key: '', sk: '', paintAt: 0, at: 0, loopAt: 0, force: true, paints: 0, ms: 0, gpuAt: 0, lastWords: null, bandKey: '', tableKey: '', frames: 0, gpuMs: 0, uploads: 0, statAt: 0 },
            // the world: the newest raw values (decoded in world(), at most every WORLD_MS), the tracker, the lane model, the logs
            raw: { rec: null, pos: null, posAt: 0, tcp: null, tcpAt: 0, lanes: null, lanesAt: 0 }, worldAt: 0, kmhAt: 0,
            tracker2: new Wo.Tracker(wcfg, ['cam', 'tcp']), logs: {}, leadCls: null,
            lanes: new Ln.Lanes(wcfg), motion: {},          // the lane model and our own motion's newest raw values (fixes-1121 AL)
            // the beam advisor (Auto Beam): its inputs, the algorithm through the adapter, the score, the null actuator, the logs
            inputs: new Inputs(cfg.inputs || {}), decider: null, demoDecider: null, player: null,
            score: new Score({}), demoScore: new Score({}), act: new ACT.NullActuator(log),
            srclog: new SrcLog(log, 10000, ['lights', 'verdict', 'objectlist', 'camObjects', 'lightStatus', 'lamps', 'lowBeam', 'stalk', 'brightness', 'speed', 'yaw', 'rain', 'limit', 'signs', 'message']),
            lastWant: null, lastSrc: undefined, lowOffAt: null, scoreAt: 0, sunAt: 0, status: '', bkey: '',
        };
        const slog = (name) => st.logs[name] || (st.logs[name] = new Wo.SourceLog(name, 10000));
        const guard = (what, fn) => function () { try { return fn.apply(null, arguments); } catch (e) { log.error('scene: ' + what + ': ' + (e && e.stack || e)); return undefined; } };
        // the language from shared/lang.js (the setting "Мова / Language": Авто / Українська / English); config.lang still wins on
        // the bench when it names uk or en. A change repaints the page and the map's words.
        const I18N = req('lang');
        if (I18N) { try { I18N.attach(ctx); } catch (e) { log.error('lang: ' + (e && e.stack || e)); } }
        const lang = () => Wd.langOf(cfg.lang === 'uk' || cfg.lang === 'en' ? cfg.lang : (I18N ? I18N.lang() : 'uk'));

        // ---- day / night: the car's own verdict first (config.dayNight, as Twin Dial), else the sun ----
        function night() {
            if (cfg.night === 'day' || cfg.night === 'night') return cfg.night === 'night';         // a fixed look (bench)
            if (st.dn === 'day' || st.dn === 'night') return st.dn === 'night';
            try { return SUN ? !!SUN.isNight(Date.now(), loc.lat, loc.lon) : false; } catch (e) { return false; }
        }

        // ---- the beam algorithm, through the adapter: the sensitivity and the camera-verdict setting over config.algo ----
        function algoCfg() {
            const a = JSON.parse(JSON.stringify(cfg.algo || {}));
            Object.keys(a).forEach((k) => { if (k[0] === '_') delete a[k]; });
            // "Стежити за рішенням камери": follow (its "no" dips) or compare only (CONTRACT 4: verdict.use 'log'); always shown
            a.verdict = Object.assign({}, a.verdict || {}, { use: setting('follow', 'follow') === 'ignore' ? 'log' : 'follow' });
            return a;
        }
        const staleView = () => ({ lights: (cfg.inputs && cfg.inputs.lights && cfg.inputs.lights.staleMs) || 600, objects: (cfg.inputs && cfg.inputs.objects && cfg.inputs.objects.staleMs) || 600 });
        function newDecider(why) {
            const sens = setting('sens', 'normal');
            st.decider = new C.Decider(algoCfg(), log, sens, staleView());
            st.demoDecider = new C.Decider(algoCfg(), log, sens, staleView());
            st.player = new SC.Player(st.demoDecider);
            const B = C.algorithm();
            log.info('beam: algorithm ' + (C.standIn() ? 'STAND-IN shared/beam_logic.js' : 'shared/beam_logic.js') + ' contract ' + (B && B.VERSION) + ' (' + why + '), sens ' + sens + ', camera verdict ' + setting('follow', 'follow') +
                (st.decider.configErrors.length ? ', config replaced: ' + st.decider.configErrors.join('; ') : ''));
        }

        // ---- signals: subscribed once at start, each interface watched once (read only) ----
        function subscribe() {
            if (st.subscribed) return;
            st.subscribed = true;
            st.tracker = FV.create(fvCfg, { log });
            st.tracker.start();
            const I = st.inputs, L = st.srclog;
            const hub = {};          // iface -> { instance, handlers: { member: [fn] } }: one watch per interface, its handlers fed in turn
            const on = (iface, inst, member, fn) => {
                const h = hub[iface] || (hub[iface] = { inst: inst || '1', fns: {} });
                (h.fns[member] = h.fns[member] || []).push(fn);
            };
            const q = (v) => (v && typeof v === 'object' ? SRC.rawWord(v.eventDataQualifier) : '-');
            // the car ahead (front_vehicle.js) and its class
            const fvC = st.tracker.cfg;
            on(fvC.iface, fvC.instance || '1', fvC.field, guard('front', (v) => { st.fvAt = Date.now(); st.tracker.feed(v, st.kmh); }));
            if (srcOn.frontExtended) on(fvC.iface, fvC.instance || '1', 'DataFrontVehicleExtended', guard('front ext', (v) => {
                const t = v && typeof v === 'object' ? v.frontVehicleExtendedObjectType : null;
                st.leadCls = Object.prototype.hasOwnProperty.call(Wo.OBJECT_TYPE, String(t)) ? Wo.OBJECT_TYPE[String(t)] : null;
                slog('frontExtended').add([{ cls: SRC.rawWord(t) }], SRC.rawWord(v && v.frontVehicleExtendedStatusMove));
            }));
            on(cruCfg.hudIface, cruCfg.hudInstance || '1', cruCfg.hudField, guard('cruise', (v) => { st.cru = SRC.hudCruiseOf(cruCfg, v); }));
            // our speed (both), the car's message (the beam's yield), the lamps' status (the beam's high-beam candidate)
            on(SPEED_IF, '1', 'statusCarSpeed2', guard('speed', (v) => {
                const now = Date.now(), raw = v && typeof v === 'object' ? v.speedVehicleCentreOfGravity : null;
                st.kmh = typeof raw === 'number' && raw !== 65535 ? raw * 0.015625 : null;
                st.kmhAt = now;
                I.speed(v, now); L.add('speed', now);
            }));
            on(SPEED_IF, '1', 'statusDisplayedCCMessage', guard('message', (v) => { const now = Date.now(); I.msg(v, now); L.first('message', v); L.add('message', now); }));
            on(SPEED_IF, '1', 'statusLightStatus', guard('lightstatus', (v) => { const now = Date.now(); I.lightStatus(v, now); L.first('lightStatus', v); L.add('lightStatus', now); }));
            if (tsrCfg) on(tsrCfg.iface, tsrCfg.instance || '1', tsrCfg.event, guard('limit', (v) => {
                const now = Date.now(), r = SRC.tsrOf(tsrCfg, v);
                st.lim = r.state === 'limit' && r.unit === 'kmh' ? r.kmh : null; st.limAt = now;
                I.limit(st.lim, now); L.add('limit', now);
            }));
            if (dnCfg && dnCfg.iface && dnCfg.field) on(dnCfg.iface, dnCfg.instance || '1', dnCfg.field, guard('daynight', (v) => {
                let raw = v;
                (dnCfg.path || []).forEach((k) => { raw = raw && typeof raw === 'object' ? raw[k] : undefined; });
                const m = dnCfg.map && raw !== undefined && raw !== null && Object.prototype.hasOwnProperty.call(dnCfg.map, String(raw)) ? dnCfg.map[String(raw)] : null;
                if (m === 'day' || m === 'night') st.dn = m;
                else if (m !== 'keep') st.dn = null;
                const code = typeof raw === 'number' ? raw : dnCfg.codes && Object.prototype.hasOwnProperty.call(dnCfg.codes, String(raw)) ? dnCfg.codes[raw] : '?';
                if (code !== st.dnCode) { st.dnCode = code; log.info('acc: day/night ' + code + ' -> ' + (st.dn || 'sun')); }
                I.dayNight(v, Date.now());
            }));
            // the car's own collision warning: its struct is unseen on this car, so it is LOGGED (enum names / numbers, at most 40
            // lines a run) and only drawn when config.warn names a path and the values that mean "active" (null: never)
            on(FASUS_IF, '1', 'requestWarnBrakeCoordinatorDisplay', guard('warn', (v) => {
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
            }));
            // what the sensors see: each handler only keeps the newest value (and counts it); world() decodes. The camera's object
            // lists feed the scene's road users AND the beam advisor's fallback (its lamp flags). A source this car never sends
            // costs one idle subscription.
            if (srcOn.cam) {
                on(CAM_IF, '1', 'ObjectRecognition', guard('cam rec', (v) => { st.raw.rec = v; I.camRec(v); }));
                on(CAM_IF, '1', 'ObjectPosition', guard('cam pos', (v) => {
                    const now = Date.now();
                    st.raw.pos = v; st.raw.posAt = now; st.raw.posQ = q(v);
                    I.camPos(v, now); L.first('camObjects', v && typeof v === 'object' ? { numberOfObjects: v.numberOfObjects, eventDataQualifier: v.eventDataQualifier } : v); L.add('camObjects', now);
                }));
            }
            if (srcOn.tcp) on(TCP_IF, '1', 'objectlistTCP', guard('tcp', (v) => {
                const now = Date.now();
                st.raw.tcp = v; st.raw.tcpAt = now;
                I.tcp(v, now); L.first('objectlist', v && typeof v === 'object' ? { numberOfObjects: v.numberOfObjects, eventDataQualifier: v.eventDataQualifier, extendedQualifier: v.extendedQualifier } : v); L.add('objectlist', now);
            }));
            if (srcOn.lanes) on(LANE_IF, '1', 'LaneBoundaries', guard('lanes', (v) => { st.raw.lanes = v; st.raw.lanesAt = Date.now(); st.raw.lanesQ = q(v); }));
            if (srcOn.lanesDetection) on(LANES_IF, '1', 'LanesDetection', guard('lanes det', (v) => {
                const kinds = ['laneLeft', 'laneEgo', 'laneRight', 'laneLeftNext', 'laneRightNext'].map((k) => ({ cls: v && v[k] ? SRC.rawWord(v[k].laneType) : '-' }));
                slog('lanesDetection').add(kinds, q(v));
            }));
            if (srcOn.keepDistance) on(KDO_IF, '1', 'keepDistanceObjects1', guard('kdo', (v) => {
                const o = v && v.keepDistObjects1 ? v.keepDistObjects1 : v || {};
                const objs = [0, 1, 2].map((i) => ({ cls: 'type' + SRC.rawWord(o['KeepDistObjType' + i]), x: typeof o['KeepDistObjDistanceLongitudinal' + i] === 'number' ? o['KeepDistObjDistanceLongitudinal' + i] : null, y: typeof o['KeepDistObjDistanceLateral' + i] === 'number' ? o['KeepDistObjDistanceLateral' + i] : null }));
                slog('keepDistance raw').add(objs, null);
            }));
            // our own motion for the predicted path (lanes.js Path): each source a read-only event or "rs" field of app.json,
            // switched in config.world.path.sources; a handler only keeps the newest value. The yaw rate feeds the beam too.
            const names = [];
            if (wcfg.path.on !== false) Object.keys(wcfg.path.sources).forEach((name) => {
                const sp = wcfg.path.sources[name];
                if (!sp || !sp.on || typeof sp.iface !== 'string' || typeof sp.member !== 'string') return;
                on(sp.iface, '1', sp.member, guard('motion ' + name, (v) => { st.motion[name] = { v, at: Date.now() }; }));
                names.push(name);
            });
            on(YAW_IF, '1', 'yawRate', guard('yaw', (v) => { const now = Date.now(); I.yaw(v, now); L.first('yaw', v && typeof v === 'object' ? { yawRate: v.yawRate, qualifierYawRate: v.qualifierYawRate } : v); L.add('yaw', now); }));
            log.info('acc: path sources ' + (names.join(' ') || 'none') + ' (units and signs assumed: config.world.path)');
            // the beam advisor's own: the camera's light objects and verdict, the lamps, the stalk, the brightness, the rain, the town signs
            for (let n = 1; n <= 15; n++) {
                const k = n;
                on(LIGHT_IF, '1', OBJ(k), guard('light ' + k, (v) => { const now = Date.now(); I.light(k, v, now); L.first('lights', v); L.add('lights', now); }));
            }
            on(LIGHT_IF, '1', 'controlHighBeamAssistant', guard('verdict', (v) => { const now = Date.now(); I.verdict(v, now); L.first('verdict', v); L.add('verdict', now); }));
            on(BODY_LIGHT, '1', 'LowBeam', guard('lowbeam', (v) => { const now = Date.now(); I.lowBeam(v, now); L.first('lowBeam', v); L.add('lowBeam', now); }));
            on(BODY_LIGHT, '1', 'LampExterior2', guard('lamps', (v) => { const now = Date.now(); I.lamp2(v, now); L.first('lamps', v && typeof v === 'object' ? { controlFunctionMainBeam: v.controlFunctionMainBeam, controlFunctionFrontFogLight: v.controlFunctionFrontFogLight, controlLightDistributionLowBeamLeftHand: v.controlLightDistributionLowBeamLeftHand, controlFunctionDippedBeamLeftHand: v.controlFunctionDippedBeamLeftHand } : v); L.add('lamps', now); }));
            on(BODY_LIGHT, '1', 'IndicatorSteeringColumn', guard('stalk', (v) => {
                const now = Date.now(), before = I.bits;
                I.stalks(v, now); L.first('stalk', v); L.add('stalk', now);
                if (I.bits !== before) log.info('beam: stalk bits 0x' + before.toString(16) + ' -> 0x' + I.bits.toString(16));
            }));
            on(ENV_IF, '1', 'StatusBrightnessEnvironment', guard('bright', (v) => { const now = Date.now(); I.bright(v, now); L.first('brightness', v); L.add('brightness', now); }));
            on(WIPER_IF, '1', 'rainSensorWiperSpeed', guard('rain', (v) => { const now = Date.now(); I.rain(v, now); L.first('rain', v); L.add('rain', now); }));
            // the built-up area: the camera's town-entry / town-exit signs (navigation is CarPlay: no map flag)
            on(SIGN_IF, '1', 'TrafficSignRecognitionFrontCamera', guard('signs', (v) => {
                const now = Date.now(), n0 = I.signEvents.length, r = I.signs(v, now);
                L.add('signs', now);
                if (I.signEvents.length > n0) log.info('beam: town sign ' + r);
            }));
            Object.keys(hub).forEach((iface) => {
                const h = hub[iface], handlers = {};
                Object.keys(h.fns).forEach((m) => { const fns = h.fns[m]; handlers[m] = fns.length === 1 ? fns[0] : (v) => { fns.forEach((fn) => fn(v)); }; });
                Promise.resolve().then(() => ctx.signals.watch(iface, h.inst, handlers, log))
                    .then((r) => log.info('scene: watch ' + iface.split('.').pop() + (r && r.error ? ' error' : ' ok')), () => log.warn('scene: watch ' + iface.split('.').pop() + ' failed'));
            });
            log.info('scene: ' + Object.keys(hub).length + ' interfaces watched once each');
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
                    const m = Wo.laneModel(wcfg, r.lanes);          // what arrived, as 0.1.0 read it: the source's own log line
                    slog('lanes').add(m ? m.lines.map((l) => ({ cls: l.type, x: l.len, y: l.y0 })) : [], r.lanesQ);
                    st.lanes.frame(r.lanes, r.lanesAt, st.kmh !== null ? st.kmh / 3.6 : null);      // what is drawn: lanes.js
                    r.lanes = null;
                }
                Object.keys(st.logs).forEach((k) => { const ln = st.logs[k].line(now); if (ln) log.info(ln); });
                st.lanes.logLines(now).forEach((ln) => log.info(ln));
            }
            st.lanes.motion(motionNow());
            const lanes = st.lanes.output(now);                     // never null: measured, partial, our path, or straight
            const objs = st.tracker2.frame(now);
            const src = st.tracker2.sourceNow(now);
            const lead = Wo.leadOf(objs, lanes);
            return { lanes, objects: objs.filter((o) => o !== lead), lead: lead ? { x: lead.x, y: lead.y, cls: lead.cls } : null, src: src || 'lanes' };
        }

        /** Our own motion now, decoded by config (lanes.js readSource): per role the first source with a value. */
        function motionNow() {
            const Pp = wcfg.path, out = { v: st.kmh !== null && st.kmhAt ? { val: st.kmh / 3.6, at: st.kmhAt, stale: Pp.speedStaleMs } : null };
            Object.keys(Pp.sources).forEach((name) => {
                const sp = Pp.sources[name], m = st.motion[name];
                if (!sp || !sp.on || !m) return;
                if (!m.dec || m.dec.at !== m.at) { const r = Ln.readSource(sp, m.v); m.dec = { val: r.val, at: m.at, raw: r.raw, bad: r.bad, road: !!sp.road, stale: sp.staleMs }; }
                if (!out[sp.role] || out[sp.role].val === null) out[sp.role] = m.dec;
            });
            return out;
        }

        /** The beam advisor's tick (live): the frame, the algorithm, the score, the null actuator, the logs -> its view. */
        function advise(now) {
            const I = st.inputs;
            if (now - st.sunAt > 60000) { st.sunAt = now; try { I.sun(SUN ? SUN.isNight(now, loc.lat, loc.lon) : null, now); } catch (e) { I.sun(null, now); } }
            const snap = I.snap(now);
            const out = st.decider.step(C.frameOf(snap, { limitStaleMs: 0 }));
            const lamps = I.lampsNow();
            const seen = snap.lights.at !== null || snap.objects.at !== null;
            const data = out.src ? 'ok' : seen ? 'stale' : 'none';
            const msg = snap.msg.v;
            const yld = typeof msg === 'number' && msg !== 0 && (msg !== 65535 || cfg.yieldUnknown === true);
            st.score.feed(now, out.want, lamps, out.state);
            if (out.want !== st.lastWant) { st.lastWant = out.want; st.act.request(out.want, out.reason); }
            if (out.src) {
                const cls = {};
                out.lights.forEach((o) => { cls[o.kind] = (cls[o.kind] || 0) + 1; });
                const d = out.lights.filter((o) => o.dist_m !== null).map((o) => Math.round(o.dist_m));
                st.srclog.add(out.src === 'light' ? 'lightsSeen' : 'objectsSeen', now, { n: out.lights.length, cls, min: d.length ? Math.min.apply(null, d) : undefined, max: d.length ? Math.max.apply(null, d) : undefined });
            }
            if (out.src !== st.lastSrc) { log.info('beam: source ' + (st.lastSrc || '-') + ' -> ' + (out.src || '-')); st.lastSrc = out.src; }
            const act = st.act.at && now - st.act.at < 3000 && lamps !== out.want ? st.act.last : null;
            const v = BV.viewOf({ out, lamps, data, verdictRaw: snap.verdict.v, speed: snap.speed.v, bright: snap.bright.v, limit: snap.limit.v, yield: yld, act, now, score: st.score.summary(), town: out.town, standIn: C.standIn() });
            // per drive: the low beam off for 5 minutes starts the score over
            const low = I.vals.low ? I.vals.low.v : null;
            if (low === false) { if (st.lowOffAt === null) st.lowOffAt = now; else if (now - st.lowOffAt > DRIVE_RESET_MS && st.score.summary().totalS > 0) { log.info(st.score.line() + ' (drive end)'); st.score.reset(); } } else st.lowOffAt = null;
            if (now - st.scoreAt >= 60000) { st.scoreAt = now; if (st.score.summary().driver || st.score.summary().totalS) log.info(st.score.line()); }
            st.srclog.tick(now);
            return v;
        }

        const demoName = () => M.DEMO[st.demoI][0] + ' ' + M.DEMO[st.demoI][1];

        // ---- THE tick: the world, the beam frame and its decision, the glides; the state both placements draw ----
        function step(now) {
            let s;
            if (st.demo) {
                if (!st.demoAt) st.demoAt = now;
                const d = M.DEMO[st.demoI][2];
                const hold = d.scene ? Math.max(demoMs, Wo.SCENE_MS) : d.beamScene ? Math.max(demoMs, SC.SCENE_MS) : demoMs;
                if (now - st.demoAt >= hold) { st.demoAt = now; st.demoI = (st.demoI + 1) % M.DEMO.length; if (M.DEMO[st.demoI][2].beamScene) st.demoScore.reset(); }
                const e = M.DEMO[st.demoI][2];
                if (e.beamScene) {
                    const r = st.player.step(e.beamScene, now - st.demoAt);
                    st.demoScore.feed(now, r.out.want, r.lamps, r.out.state);
                    const v = BV.viewOf({ out: r.out, lamps: r.lamps, data: 'ok', speed: r.world.speed, bright: null, limit: r.world.limit, curve: r.world.curve, town: r.out.town, now, score: st.demoScore.summary(), standIn: C.standIn() });
                    s = M.withBeamScene(e, v, r.world);
                } else {
                    s = M.withScene(e, now - st.demoAt);
                    if (!s.beam) s = Object.assign({}, s, { beam: BV.NONE });
                }
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
                s.beam = advise(now);
            }
            // the view's sideways place glides too (a lane change moves our car across, it never jumps)
            const ct = M.camOf(s), kc = st.zAt ? 1 - Math.exp(-Math.max(0, now - st.zAt) / CAM_MS) : 1;
            st.camY = typeof st.camY === 'number' ? st.camY + (ct - st.camY) * kc : ct;
            if (Math.abs(ct - st.camY) < 0.01) st.camY = ct;
            // our high beam's extent follows the lamps' real state: it grows out or folds back over FOLD_MS (night only drawn)
            const lamps = s.beam ? s.beam.lamps : null, et = lamps === 'high' || lamps === 'flash' ? 1 : 0, dt = st.eAt ? Math.max(0, now - st.eAt) : FOLD_MS;
            st.e = st.e < et ? Math.min(et, st.e + dt / FOLD_MS) : Math.max(et, st.e - dt / FOLD_MS);
            st.eAt = now;
            s = Object.assign({}, s, { camY: st.camY, e: st.e });
            const lead = M.leadOf(s);
            const zt = lead ? M.zOf(lead.x) : 0;
            if (!lead || !st.s || !M.leadOf(st.s) || !st.zAt) st.z = zt;                       // a car appears where it is
            else {
                const k = 1 - Math.exp(-Math.max(0, now - st.zAt) / GLIDE_MS);
                st.z += (zt - st.z) * k;
                if (Math.abs(zt - st.z) < 0.003) st.z = zt;
            }
            st.zAt = now; st.s = s; st.tickAt = now;
            const key = M.keyOf(s);
            if (key !== st.key) {
                st.key = key;
                if (now - st.lineAt >= 1000 || !st.demo) { st.lineAt = now; log.info('acc: state ' + key.split('|').slice(0, 7).join('|') + (st.demo ? ' demo ' + demoName() : '')); }
            }
            const v = s.beam;
            const bkey = v ? BV.keyOf(v) : '-';
            if (bkey !== st.bkey) {
                st.bkey = bkey;
                if (v && !st.demo) log.info('beam: state ' + v.state + ' ' + v.reason + ' want ' + v.adv + ' lamps ' + (v.lamps || '-') + ' data ' + v.data + (v.yield ? ' yield' : ''));
                status(v);
            }
            return s;
        }
        function status(v) {
            const L = lang();
            const t = v ? Wd.word(L, P.adviceKey(v)) + ' · ' + P.reasonText(v, L) : '';
            if (t === st.status) return;
            st.status = t;
            try { ctx.ui.text('STATUS', t); } catch (e) { /* the row may not exist yet */ }
        }

        // ---- the one loop: a tick, then the map from it ----
        const tick = guard('tick', () => {
            const s = step(Date.now());
            if (st.show && st.mv) st.mapBytes += st.mv.update(s, st.z, night(), lang());
        });
        function mapOpen() {
            if (st.mv) return;
            if (!shaders.acc_lane || !shaders.acc_obj || !shaders.acc_car) { log.error('scene: hud/shaders.json is missing: the map stays off'); return; }
            const sock = process.env.HUD_CLUSTER_SOCKET || cfg.socketPath || CR.DEFAULT_PATH;     // HUD_CLUSTER_SOCKET: the Mac bench only
            st.mv = new MapView(CR, { layer: layerCfg, socket: sock, shaders, log });
            st.mv.open();
            const cr = st.mv.cr;
            cr.on('layer', guard('layer', (ref, state) => log.info('scene: layer ' + ref + ' ' + state)));
            cr.on('target', guard('target', (name, state) => { if (name === layerCfg.target) log.info('scene: target ' + name + ' ' + state); }));
            cr.on('error', guard('socket', (e) => log.warn('scene: cluster-render ' + (e && e.code || 'error'))));
            log.info('scene: map layers 6 (lane + beams, users + lights, car, ego, text 420x96, pill 340x44) on ' + layerCfg.target + (layerCfg.contend ? ' (contend)' : ' (waits for the slot)') +
                ', pixel memory ' + MapView.PIXEL_MEMORY);
        }
        function mapClose() {
            if (!st.mv) return;
            st.mv.close();
            st.mv = null;
            log.info('scene: map layers dropped');
        }

        // ---- the centre page: it draws the last tick's state (ticking first when that is older than a GPU frame) ----
        const pageDraw = guard('page', () => {
            const now = Date.now(), pg = st.page;
            if (now - pg.loopAt > 700) pg.force = true;              // the page was shown again: draw at once
            pg.loopAt = now;
            const gpu = !!(REC && ctx.display && typeof ctx.display.active === 'function' && ctx.display.active('MAIN'));
            const s = !st.s || now - st.tickAt >= GPU_MIN_MS ? step(now) : st.s;
            const nt = night(), ln = lang();
            const age = st.demo ? (s.data === 'ok' ? 0.3 : s.data === 'stale' ? 2.6 : null) : (st.fvAt ? (now - st.fvAt) / 1000 : null);
            const ageWord = typeof age === 'number' ? (age < 1 ? 0 : age < 2 ? 1 : age < 5 ? 2 : 5) : -1;       // the steps paint.js shows
            const info = { age: typeof age === 'number' ? (age < 1 ? 0.5 : ageWord) : null, warn: st.demo ? null : st.warnRaw };
            const demo = st.demo ? M.DEMO[st.demoI][0] : null;
            if (gpu) return gpuFrame(s, now, nt, ln, info, demo, ageWord);
            pg.lastWords = null;
            const sk = M.keyOf(s) + '|' + nt + '|' + ln + '|' + ageWord + '|' + (info.warn || '') + '|' + (demo || '') + '|' + JSON.stringify(P.rows(s, { info, night: nt }, ln));
            const key = sk + '|' + M.worldKey(s);
            // a change of the state repaints at once; the world alone moving (traffic, lanes, the lights, the beam's fold) at most
            // every WORLD_PAINT_MS: a repaint with moving lanes costs ~30 ms on the Mac, so perhaps 0.3-0.6 s on the head unit
            const worldOnly = key !== pg.key && sk === pg.sk && now - pg.paintAt < WORLD_PAINT_MS;
            if (key !== pg.key && !worldOnly) {
                pg.sk = sk; pg.paintAt = now;
                const t0 = Date.now();
                const r = P.centre(s, { night: nt, lang: ln, info, demo });     // the car at its place: the page repaints per change only (<= 4 a second)
                pg.ms += Date.now() - t0; pg.paints++;
                if (REC) REC.setImage(IMG_ID, P.PAGE_W, P.PAGE_H, r.px);
                pg.key = key; pg.force = true;
                if (pg.paints % 50 === 1) log.info('scene: page paint ' + Math.round(pg.ms / pg.paints) + ' ms (' + pg.paints + ' paints)');
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

        // ---- the centre page on the GPU renderer (gpu.js): shapes each frame, images only for what changed ----
        const sprites = {};
        function spriteIds() {
            if (sprites.done) return sprites.ids;
            const ids = {};
            GP.SPRITES.forEach((name, i) => {
                const sp = R.sprite(name);
                if (!sp) return;
                const nightPx = Buffer.from(sp.px), mul = name === 'carFast' ? 0.78 : 0.75;
                for (let k = 0; k < nightPx.length; k += 4) { nightPx[k] = Math.round(nightPx[k] * mul); nightPx[k + 1] = Math.round(nightPx[k + 1] * mul); nightPx[k + 2] = Math.round(nightPx[k + 2] * mul); }
                REC.setImage(IMG_SPRITE + i * 2, sp.w, sp.h, sp.px);
                REC.setImage(IMG_SPRITE + i * 2 + 1, sp.w, sp.h, nightPx);
                ids[name] = [IMG_SPRITE + i * 2, IMG_SPRITE + i * 2 + 1];
            });
            sprites.done = true; sprites.ids = ids;
            return ids;
        }
        function gpuFrame(s, now, nt, ln, info, demo, ageWord) {
            const pg = st.page;
            if (!pg.force && now - pg.gpuAt < GPU_MIN_MS) return undefined;
            const opt = { night: nt, lang: ln, info, demo, z: st.z };
            const bk = M.keyOf(s) + '|' + nt + '|' + ln;
            if (bk !== pg.bandKey) { const b = P.band(s, opt); REC.setImage(IMG_BAND, b.w, b.h, b.px); pg.bandKey = bk; pg.uploads++; }
            const tk = bk + '|' + (demo || '') + '|' + ageWord + '|' + JSON.stringify(P.rows(s, opt, ln));
            if (tk !== pg.tableKey) { const t = P.table(s, opt); REC.setImage(IMG_TABLE, t.w, t.h, t.px); pg.tableKey = tk; pg.uploads++; }
            const cv = ctx.canvas(1600, 520);
            const t0 = Date.now();
            GP.draw(cv, s, opt, { band: IMG_BAND, table: IMG_TABLE, sprites: spriteIds() });
            const w = cv.words();
            let same = !pg.force && !!pg.lastWords && pg.lastWords.length === w.length;
            for (let i = 0; same && i < w.length; i++) if (w[i] !== pg.lastWords[i]) same = false;
            if (same) return undefined;                                // nothing moved: no frame
            pg.lastWords = new Uint32Array(w);
            pg.force = false; pg.gpuAt = now; pg.frames++; pg.gpuMs += Date.now() - t0;
            if (now - pg.statAt >= 10000) {
                log.info('scene: gpu page ' + Math.round(pg.frames * 1000 / Math.max(1, now - pg.statAt)) + ' frames/s, ' + (pg.gpuMs / Math.max(1, pg.frames)).toFixed(1) + ' ms to record, ' + w.length + ' words, ' + pg.uploads + ' image uploads, rss ' + Math.round(process.memoryUsage().rss / 1048576) + ' MB');
                pg.statAt = now; pg.frames = 0; pg.gpuMs = 0; pg.uploads = 0;
            }
            return ctx.ui.image('MAIN_GFX', cv);
        }

        const apply = guard('apply', (why) => {
            st.show = setting('show', false) === true;
            const demo = setting('demoCycle', false) === true;
            if (demo !== st.demo) { st.demo = demo; st.demoAt = 0; st.demoI = 0; st.s = null; st.demoScore.reset(); }
            if (st.show) mapOpen(); else mapClose();
            st.page.force = true;
            tick();
            log.info('scene: show ' + (st.show ? 'on' : 'off') + ', demo ' + (st.demo ? 'on' : 'off') + ', lang ' + lang() + (why ? ' (' + why + ')' : ''));
        });

        try {
            newDecider('start');
            subscribe();
            st.timer = setInterval(tick, TICK_MS);
            ctx.settings.onChange(guard('setting', (key) => {
                if (key === 'show' || key === 'demoCycle') apply(key);
                if (key === 'sens' || key === 'follow') newDecider(key);
            }));
            // the settings follow the driver profile as shared/profile_settings.js's table says (road_scene: the sensitivity and the
            // language per profile); a switch arrives as ordinary setting changes (Settings.setMany)
            if (PSET) { try { PSET.attach(ctx); } catch (e) { log.error('scene: profile settings: ' + (e && e.stack || e)); } }
            if (typeof ctx.onLayout === 'function') ctx.onLayout(guard('layout', () => { st.page.force = true; }));
            if (I18N) I18N.onChange(guard('lang', () => { st.page.force = true; st.page.bandKey = ''; st.page.tableKey = ''; st.page.key = ''; st.key = ''; st.status = ''; st.bkey = ''; }));
            apply('start');
            ctx.loop('MAIN', PAGE_FPS, pageDraw);
            log.info('scene: Road Scene ' + ((ctx.spec && ctx.spec.version) || '') + ' started (one loop of ' + TICK_MS + ' ms; the beam part advises: its actuator is ' + st.act.kind + ', it switches nothing)');
        } catch (e) { log.error('scene: start: ' + (e && e.stack || e)); }
        process.on('exit', () => { try { mapClose(); if (st.timer) clearInterval(st.timer); log.info(st.score.line() + ' (exit)'); } catch (e) { /* exiting anyway */ } });
    },
});
