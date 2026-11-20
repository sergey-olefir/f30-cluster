'use strict';
/**
 * Auto Beam 0.1.0 (round "Auto Beam", package HD; docs/highbeam/BRIEF-HD-design-app.md): an ADVISOR for the high beam. It reads
 * the front camera's light objects and its own verdict, the lamps, the stalk, the brightness, the speed, the yaw rate and the
 * limit (all read only), runs the switching algorithm (shared/beam_logic.js, through the one adapter contract.js) every tick,
 * and shows the driver "high beam now" or "dip now" with the reason, the lights ahead and the driver's own lamps. It scores
 * itself against what the driver did. IT NEVER SWITCHES A LAMP: its only actuator is the null one (actuator.js), which logs.
 *
 * Two placements:
 *   - The centre screen, the app's own page (MAIN, a canvas): works whenever the app is open. With the kit's GPU renderer the
 *     scene is shape commands at up to 30 frames a second while the beam folds or lights move, none while still (gpu.js); the
 *     band and the table are images uploaded only when they change; the values that change by the second are GPU text.
 *     Without the renderer: one software image (paint.js centre), a state change at once, motion at most twice a second.
 *   - The cluster's `map` target, behind "Показувати на щитку" (default OFF): three layers on our own connection (mapview.js),
 *     no contend, guide_hold 0; hidden while the car shows a message of its own.
 * "Демо": the 18 drawn states in turn, then four moving scenes played through the real algorithm (scenes.js).
 *
 * Read only: s / rs fields with non-zero getters and events as broadcasts (app.json). No setter, no method, no diagnostic
 * request, never acknowledgeObjectData*, never a LightswitchOperation member. The signals are subscribed once at start, so
 * the log's per-source lines ("beam: src lights first ...", 10 s summaries, "silent") answer on the first drive whether the
 * camera sends its light stream. Log lines: numbers and enum names only. Never lets an exception escape.
 */
const mgu = require('./kit/mgu');
const C = require('./contract');
const Inputs = require('./inputs');
const V = require('./view');
const P = require('./paint');
const Wd = require('./words');
const Score = require('./score');
const SrcLog = require('./srclog');
const MapView = require('./mapview');
const GP = require('./gpu');
const SC = require('./scenes');
const ACT = require('./actuator');
const R = require('./raster');

const LIGHT_IF = 'de.bmw.sensors.objects.RecogFrontCameraLightDetection';
const OBJ = (n) => (n === 11 || n === 12 || n === 15 ? 'M' : 'm') + 'ainBeamAssistantDataObject' + n;
const BODY_LIGHT = 'de.bmw.body.Light', ENV_IF = 'de.bmw.body.Environment', WIPER_IF = 'de.bmw.body.Wiper';
const V2_IF = 'de.bmw.infotainment.vehicle.Vehicle2', V1_IF = 'de.bmw.infotainment.vehicle.Vehicle';
const YAW_IF = 'de.bmw.chassis.YawRateProvision';
const TCP_IF = 'de.bmw.sensors.objects.RecogFrontCameraObjectlist', CAM_IF = 'de.bmw.environmentalmodel.ObjectRecognitionFrontCamera';
const SIGN_IF = 'de.bmw.environmentalmodel.SignRecognitionFrontCamera';
const FOLD_MS = 330;                 // the high beam grows out or folds back in about a third of a second
const PAGE_FPS = 4;
const GPU_MIN_MS = 33;
const SOFT_MOTION_MS = 500;
const IMG_BAND = 0x41420002, IMG_TABLE = 0x41420003;     // 'AB' + n: clear of the kit's own ids
const DRIVE_RESET_MS = 5 * 60000;    // the low beam off this long: a new drive (the score starts over)

function req(name) { try { return require('./' + name); } catch (e) { return null; } }

mgu.run({
    start(ctx) {
        const log = ctx.log;
        const cfg = (ctx.spec && ctx.spec.config) || {};
        const I18N = req('lang');
        if (I18N) { try { I18N.attach(ctx); } catch (e) { log.error('lang: ' + (e && e.stack || e)); } }
        const CR = req('cluster_render_client'), SUN = req('sun'), SRC = req('limit_src'), REC = req('kit/record'), PSET = req('profile_settings');
        const guard = (what, fn) => function () { try { return fn.apply(null, arguments); } catch (e) { log.error('beam: ' + what + ': ' + (e && e.stack || e)); return undefined; } };
        const layerCfg = Object.assign({ target: 'map', klass: 'content', contend: false, guideHold: 0 }, cfg.layer || {});
        const loc = cfg.location || { lat: 50.45, lon: 30.52 };
        const tickMs = typeof cfg.tickMs === 'number' && cfg.tickMs >= 50 ? cfg.tickMs : 100;
        const demoMs = typeof cfg.demoMs === 'number' && cfg.demoMs >= 500 ? cfg.demoMs : 4000;
        const tsrCfg = SRC ? SRC.tsrCfg({ tsr: (cfg.sign && cfg.sign.tsr) || {} }) : null;
        const shaders = R.hudJson('shaders.json');
        const lang = () => Wd.langOf(cfg.lang === 'uk' || cfg.lang === 'en' ? cfg.lang : (I18N ? I18N.lang() : 'uk'));
        const setting = (k, d) => { try { const x = ctx.settings.get(k); return x === undefined ? d : x; } catch (e) { return d; } };

        const st = {
            show: false, demo: false, demoAt: 0, demoI: 0, subscribed: false, timer: null, mv: null, mapBytes: 0,
            inputs: new Inputs(cfg.inputs || {}), decider: null, demoDecider: null, player: null,
            score: new Score({}), demoScore: new Score({}), act: new ACT.NullActuator(log), srclog: new SrcLog(log, 10000, ['lights', 'verdict', 'objectlist', 'camObjects', 'lightStatus', 'lamps', 'lowBeam', 'stalk', 'brightness', 'speed', 'yaw', 'rain', 'limit', 'signs', 'message']),
            out: null, v: null, decAt: 0, e: 0, eAt: 0, key: '', lineAt: 0, lastWant: null, lastSrc: undefined, lowOffAt: null, scoreAt: 0, sunAt: 0, status: '',
            page: { force: true, loopAt: 0, at: 0, key: '', paintAt: 0, gpuAt: 0, lastWords: null, bandKey: '', tableKey: '', frames: 0, gpuMs: 0, uploads: 0, statAt: 0, paints: 0, ms: 0 },
        };

        // ---- the algorithm, through the adapter: the sensitivity and the camera-verdict setting over config.algo ----
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

        // ---- signals: subscribed once at start (read only) ----
        function subscribe() {
            if (st.subscribed) return;
            st.subscribed = true;
            const I = st.inputs, L = st.srclog;
            const w = (iface, inst, handlers) => Promise.resolve().then(() => ctx.signals.watch(iface, inst, handlers, log))
                .then((r) => log.info('beam: watch ' + iface.split('.').pop() + (r && r.error ? ' error' : ' ok')), () => log.warn('beam: watch ' + iface.split('.').pop() + ' failed'));
            const h = {};
            for (let n = 1; n <= 15; n++) {
                h[OBJ(n)] = guard('light ' + n, (v) => { const now = Date.now(); I.light(n, v, now); L.first('lights', v); L.add('lights', now); });
            }
            h.controlHighBeamAssistant = guard('verdict', (v) => { const now = Date.now(); I.verdict(v, now); L.first('verdict', v); L.add('verdict', now); });
            w(LIGHT_IF, '1', h);
            w(BODY_LIGHT, '1', {
                LowBeam: guard('lowbeam', (v) => { const now = Date.now(); I.lowBeam(v, now); L.first('lowBeam', v); L.add('lowBeam', now); }),
                LampExterior2: guard('lamps', (v) => { const now = Date.now(); I.lamp2(v, now); L.first('lamps', v && typeof v === 'object' ? { controlFunctionMainBeam: v.controlFunctionMainBeam, controlFunctionFrontFogLight: v.controlFunctionFrontFogLight, controlLightDistributionLowBeamLeftHand: v.controlLightDistributionLowBeamLeftHand, controlFunctionDippedBeamLeftHand: v.controlFunctionDippedBeamLeftHand } : v); L.add('lamps', now); }),
                IndicatorSteeringColumn: guard('stalk', (v) => {
                    const now = Date.now(), before = I.bits;
                    I.stalks(v, now); L.first('stalk', v); L.add('stalk', now);
                    if (I.bits !== before) log.info('beam: stalk bits 0x' + before.toString(16) + ' -> 0x' + I.bits.toString(16));
                }),
            });
            w(ENV_IF, '1', { StatusBrightnessEnvironment: guard('bright', (v) => { const now = Date.now(); I.bright(v, now); L.first('brightness', v); L.add('brightness', now); }) });
            w(WIPER_IF, '1', { rainSensorWiperSpeed: guard('rain', (v) => { const now = Date.now(); I.rain(v, now); L.first('rain', v); L.add('rain', now); }) });
            w(V2_IF, '1', {
                statusCarSpeed2: guard('speed', (v) => { const now = Date.now(); I.speed(v, now); L.add('speed', now); }),
                statusDisplayedCCMessage: guard('message', (v) => { const now = Date.now(); I.msg(v, now); L.first('message', v); L.add('message', now); }),
            });
            w(V2_IF, '1', { statusLightStatus: guard('lightstatus', (v) => { const now = Date.now(); I.lightStatus(v, now); L.first('lightStatus', v); L.add('lightStatus', now); }) });
            // the fallback while the light stream is silent: the camera's object lists (events, read only)
            w(TCP_IF, '1', { objectlistTCP: guard('objectlist', (v) => { const now = Date.now(); I.tcp(v, now); L.first('objectlist', v && typeof v === 'object' ? { numberOfObjects: v.numberOfObjects, eventDataQualifier: v.eventDataQualifier, extendedQualifier: v.extendedQualifier } : v); L.add('objectlist', now); }) });
            w(CAM_IF, '1', {
                ObjectRecognition: guard('cam rec', (v) => { I.camRec(v); }),
                ObjectPosition: guard('cam pos', (v) => { const now = Date.now(); I.camPos(v, now); L.first('camObjects', v && typeof v === 'object' ? { numberOfObjects: v.numberOfObjects, eventDataQualifier: v.eventDataQualifier } : v); L.add('camObjects', now); }),
            });
            // the built-up area: the camera's town-entry / town-exit signs (navigation is CarPlay: no map flag)
            w(SIGN_IF, '1', { TrafficSignRecognitionFrontCamera: guard('signs', (v) => {
                const now = Date.now(), n0 = I.signEvents.length, r = I.signs(v, now);
                L.add('signs', now);
                if (I.signEvents.length > n0) log.info('beam: town sign ' + r);
            }) });
            w(V1_IF, '1', { statusDayNightChangeOver: guard('daynight', (v) => { I.dayNight(v, Date.now()); }) });
            w(YAW_IF, '1', { yawRate: guard('yaw', (v) => { const now = Date.now(); I.yaw(v, now); L.first('yaw', v && typeof v === 'object' ? { yawRate: v.yawRate, qualifierYawRate: v.qualifierYawRate } : v); L.add('yaw', now); }) });
            if (tsrCfg) {
                const hh = {}; hh[tsrCfg.event] = guard('limit', (v) => {
                    const now = Date.now(), r = SRC.tsrOf(tsrCfg, v);
                    I.limit(r.state === 'limit' && r.unit === 'kmh' ? r.kmh : null, now); L.add('limit', now);
                });
                w(tsrCfg.iface, tsrCfg.instance || '1', hh);
            }
        }

        function night() {
            if (cfg.night === 'day' || cfg.night === 'night') return cfg.night === 'night';
            const s = st.inputs.vals.sun;
            if (s && (s.v === 'day' || s.v === 'night')) return s.v === 'night';
            try { return SUN ? !!SUN.isNight(Date.now(), loc.lat, loc.lon) : false; } catch (e) { return false; }
        }

        // ---- the decision loop: a tick, the algorithm's step (guarded by the adapter), the view, the score, the logs ----
        function decide(now) {
            let v;
            if (st.demo) {
                if (!st.demoAt) st.demoAt = now;
                const n = V.DEMO.length + SC.SCENES.length;
                const hold = st.demoI < V.DEMO.length ? demoMs : Math.max(demoMs, SC.SCENE_MS);
                if (now - st.demoAt >= hold) { st.demoAt = now; st.demoI = (st.demoI + 1) % n; }
                if (st.demoI < V.DEMO.length) v = V.DEMO[st.demoI][2];
                else {
                    const name = SC.SCENES[st.demoI - V.DEMO.length];
                    const r = st.player.step(name, now - st.demoAt);
                    st.demoScore.feed(now, r.out.want, r.lamps, r.out.state);
                    v = V.viewOf({ out: r.out, lamps: r.lamps, data: 'ok', speed: r.world.speed, bright: null, limit: r.world.limit, curve: r.world.curve, town: r.out.town, now, score: st.demoScore.summary(), standIn: C.standIn() });
                }
            } else {
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
                v = V.viewOf({ out, lamps, data, verdictRaw: snap.verdict.v, speed: snap.speed.v, bright: snap.bright.v, limit: snap.limit.v, yield: yld, act, now, score: st.score.summary(), town: out.town, standIn: C.standIn() });
                // per drive: the low beam off for 5 minutes starts the score over
                const low = I.vals.low ? I.vals.low.v : null;
                if (low === false) { if (st.lowOffAt === null) st.lowOffAt = now; else if (now - st.lowOffAt > DRIVE_RESET_MS && st.score.summary().totalS > 0) { log.info(st.score.line() + ' (drive end)'); st.score.reset(); } } else st.lowOffAt = null;
                if (now - st.scoreAt >= 60000) { st.scoreAt = now; if (st.score.summary().driver || st.score.summary().totalS) log.info(st.score.line()); }
                st.srclog.tick(now);
            }
            // the picture's main motion: the high beam grows out or folds back over FOLD_MS
            const target = V.extentOf(v), dt = st.eAt ? Math.max(0, now - st.eAt) : FOLD_MS;
            st.e = st.e < target ? Math.min(target, st.e + dt / FOLD_MS) : Math.max(target, st.e - dt / FOLD_MS);
            st.eAt = now;
            st.v = v; st.decAt = now;
            const key = V.keyOf(v);
            if (key !== st.key) {
                st.key = key;
                if (now - st.lineAt >= 1000 || !st.demo) { st.lineAt = now; log.info('beam: state ' + v.state + ' ' + v.reason + (v.rule ? ' (' + v.rule + ')' : '') + ' want ' + v.adv + ' lamps ' + (v.lamps || '-') + ' data ' + v.data + (v.yield ? ' yield' : '') + (st.demo ? ' demo ' + (st.demoI < V.DEMO.length ? V.DEMO[st.demoI][0] : SC.SCENES[st.demoI - V.DEMO.length]) : '')); }
                status(v);
            }
            if (st.mv) st.mapBytes += st.mv.update(v, st.e, night(), lang());
            return v;
        }
        function status(v) {
            const L = lang();
            const s = Wd.word(L, P.adviceKey(v)) + ' · ' + P.reasonText(v, L);
            if (s === st.status) return;
            st.status = s;
            try { ctx.ui.text('STATUS', s); } catch (e) { /* the row may not exist yet */ }
        }
        const tick = guard('tick', () => { decide(Date.now()); });

        // ---- the map target ----
        function mapOpen() {
            if (st.mv) return;
            if (!CR) { log.error('beam: cluster_render_client missing: the map stays off'); return; }
            if (!shaders.ab_road || !shaders.ab_lights) { log.error('beam: hud/shaders.json is missing: the map stays off'); return; }
            const sock = process.env.HUD_CLUSTER_SOCKET || cfg.socketPath || CR.DEFAULT_PATH;     // HUD_CLUSTER_SOCKET: the Mac bench only
            st.mv = new MapView(CR, { layer: layerCfg, socket: sock, shaders, log });
            st.mv.open();
            const cr = st.mv.cr;
            cr.on('layer', guard('layer', (ref, state) => log.info('beam: layer ' + ref + ' ' + state)));
            cr.on('target', guard('target', (name, state) => { if (name === layerCfg.target) log.info('beam: target ' + name + ' ' + state); }));
            cr.on('error', guard('socket', (e) => log.warn('beam: cluster-render ' + (e && e.code || 'error'))));
            log.info('beam: map layers 3 (road, lights, text 420x112) on ' + layerCfg.target + (layerCfg.contend ? ' (contend)' : ' (waits for the slot)') + ', pixel memory ' + MapView.PIXEL_MEMORY);
        }
        function mapClose() {
            if (!st.mv) return;
            st.mv.close();
            st.mv = null;
            log.info('beam: map layers dropped');
        }

        // ---- the centre page ----
        const pageDraw = guard('page', () => {
            const now = Date.now(), pg = st.page;
            if (now - pg.loopAt > 700) pg.force = true;
            pg.loopAt = now;
            // while the page is open the decisions run at its frame rate (the fold and the lights move smoothly), else at tickMs
            const v = !st.v || now - st.decAt >= GPU_MIN_MS ? decide(now) : st.v;
            const nt = night(), ln = lang();
            const opt = { night: nt, lang: ln, e: st.e, follow: setting('follow', 'follow'), demo: st.demo ? (st.demoI < V.DEMO.length ? V.DEMO[st.demoI][0] : SC.SCENES[st.demoI - V.DEMO.length]) : null };
            const gpu = !!(REC && ctx.display && typeof ctx.display.active === 'function' && ctx.display.active('MAIN'));
            if (gpu) return gpuFrame(v, now, opt);
            pg.lastWords = null;
            const sk = V.keyOf(v) + '|' + nt + '|' + ln + '|' + JSON.stringify(P.rows(v, opt, ln)) + '|' + P.dyn(v, opt).map((d) => d.str).join(',');
            const key = sk + '|' + V.sceneKey(v, st.e);
            const motionOnly = key !== pg.key && sk === pg.sk && now - pg.paintAt < SOFT_MOTION_MS;
            if (key !== pg.key && !motionOnly) {
                pg.sk = sk; pg.paintAt = now;
                const t0 = Date.now();
                const r = P.centre(v, opt);
                pg.ms += Date.now() - t0; pg.paints++;
                if (REC) REC.setImage(IMG_BAND - 1, P.PAGE_W, P.PAGE_H, r.px);
                pg.key = key; pg.force = true;
                if (pg.paints % 50 === 1) log.info('beam: page paint ' + Math.round(pg.ms / pg.paints) + ' ms (' + pg.paints + ' paints)');
            }
            if (!pg.force && now - pg.at < 5000) return undefined;
            pg.force = false; pg.at = now;
            const cv = ctx.canvas(1600, 520);
            cv.clear(V.colours('centre', nt).bg);
            cv.image(IMG_BAND - 1, 0, 520 - P.PAGE_H, P.PAGE_W, P.PAGE_H);
            return ctx.ui.image('MAIN_GFX', cv);
        });
        function gpuFrame(v, now, opt) {
            const pg = st.page;
            if (!pg.force && now - pg.gpuAt < GPU_MIN_MS) return undefined;
            const bk = V.keyOf(v) + '|' + opt.night + '|' + opt.lang;
            if (bk !== pg.bandKey) { const b = P.band(v, opt); REC.setImage(IMG_BAND, b.w, b.h, b.px); pg.bandKey = bk; pg.uploads++; }
            const tk = bk + '|' + (opt.demo || '') + '|' + opt.follow + '|' + JSON.stringify(P.rows(v, opt, opt.lang));
            if (tk !== pg.tableKey) { const t = P.table(v, opt); REC.setImage(IMG_TABLE, t.w, t.h, t.px); pg.tableKey = tk; pg.uploads++; }
            const cv = ctx.canvas(1600, 520);
            const t0 = Date.now();
            GP.draw(cv, v, opt, { band: IMG_BAND, table: IMG_TABLE });
            const w = cv.words();
            let same = !pg.force && !!pg.lastWords && pg.lastWords.length === w.length;
            for (let i = 0; same && i < w.length; i++) if (w[i] !== pg.lastWords[i]) same = false;
            if (same) return undefined;                                // nothing moved: no frame
            pg.lastWords = new Uint32Array(w);
            pg.force = false; pg.gpuAt = now; pg.frames++; pg.gpuMs += Date.now() - t0;
            if (now - pg.statAt >= 10000) {
                log.info('beam: gpu page ' + Math.round(pg.frames * 1000 / Math.max(1, now - pg.statAt)) + ' frames/s, ' + (pg.gpuMs / Math.max(1, pg.frames)).toFixed(1) + ' ms to record, ' + w.length + ' words, ' + pg.uploads + ' image uploads, rss ' + Math.round(process.memoryUsage().rss / 1048576) + ' MB');
                pg.statAt = now; pg.frames = 0; pg.gpuMs = 0; pg.uploads = 0;
            }
            return ctx.ui.image('MAIN_GFX', cv);
        }

        const apply = guard('apply', (why) => {
            st.show = setting('show', false) === true;
            const demo = setting('demoCycle', false) === true;
            if (demo !== st.demo) { st.demo = demo; st.demoAt = 0; st.demoI = 0; st.v = null; st.demoScore.reset(); }
            if (st.show) mapOpen(); else mapClose();
            st.page.force = true;
            log.info('beam: show ' + (st.show ? 'on' : 'off') + ', demo ' + (st.demo ? 'on' : 'off') + ', lang ' + lang() + (why ? ' (' + why + ')' : ''));
        });

        try {
            newDecider('start');
            subscribe();
            st.timer = setInterval(tick, tickMs);
            ctx.settings.onChange(guard('setting', (key) => {
                if (key === 'show' || key === 'demoCycle') apply(key);
                if (key === 'sens' || key === 'follow') newDecider(key);
            }));
            // the sensitivity and the language follow the driver profile: a switch arrives as ordinary setting changes (Settings.setMany)
            if (PSET) { try { PSET.attach(ctx, { perProfile: ['sens', 'lang'], global: ['profileSets', 'show', 'demoCycle', 'follow'] }); } catch (e) { log.error('beam: profile settings: ' + (e && e.stack || e)); } }
            if (typeof ctx.onLayout === 'function') ctx.onLayout(guard('layout', () => { st.page.force = true; }));
            if (I18N) I18N.onChange(guard('lang', () => { st.page.force = true; st.page.bandKey = ''; st.page.tableKey = ''; st.page.key = ''; st.key = ''; st.status = ''; }));
            apply('start');
            tick();
            ctx.loop('MAIN', PAGE_FPS, pageDraw);
            log.info('beam: Auto Beam ' + ((ctx.spec && ctx.spec.version) || '') + ' started (advisor: the actuator is ' + st.act.kind + ', it switches nothing)');
        } catch (e) { log.error('beam: start: ' + (e && e.stack || e)); }
        process.on('exit', () => { try { mapClose(); if (st.timer) clearInterval(st.timer); log.info(st.score.line() + ' (exit)'); } catch (e) { /* exiting anyway */ } });
    },
});
