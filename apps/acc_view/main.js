'use strict';
/**
 * ACC View 0.1.0 (round 1120 AA2; docs/AGENT-BRIEF-acc-app.md, design docs/r1120/AA-SPEC.md 3.1): a separate, READ-ONLY app
 * that shows direction E, the lane view: our lane to the horizon, the car ahead at its measured level, the cruise / limiter
 * set speed in a ring, the limit read from the road, an event pill. It reads and draws; it writes nothing to the car.
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

const SPEED_IF = 'de.bmw.infotainment.vehicle.Vehicle2';
const FASUS_IF = 'de.bmw.infotainment.fasus.FASuS';
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

        const st = {
            show: false, demo: false, subscribed: false, tracker: null, kmh: null, cru: null, warn: false, warnRaw: null, warnLines: 0,
            lim: null, limAt: 0, fvAt: 0, dn: null, dnCode: undefined, demoAt: 0, demoI: 0, z: 0, zAt: 0, s: null, key: '', lineAt: 0,
            timer: null, mv: null, mapBytes: 0,
            page: { key: '', at: 0, loopAt: 0, force: true, paints: 0, ms: 0 },
        };
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
        }

        // ---- the state now, and the car's glide (shared by both placements) ----
        function step(now) {
            let s;
            if (st.demo) {
                if (!st.demoAt) st.demoAt = now;
                if (now - st.demoAt >= demoMs) { st.demoAt = now; st.demoI = (st.demoI + 1) % M.DEMO.length; }
                s = M.DEMO[st.demoI][2];
            } else {
                const lim = st.lim !== null && now - st.limAt < ((tsrCfg && tsrCfg.staleMs) || 3000) ? st.lim : null;
                s = M.stateOf(st.tracker ? st.tracker.view(st.kmh) : null, st.cru, st.warn, lim);
            }
            const zt = s.tgt ? M.depthOf(s.tgt) : 0;
            if (!s.tgt || !st.s || !st.s.tgt || !st.zAt) st.z = zt;                          // a car appears where it is
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
            log.info('acc: map layers 4 (lane, car, text 380x96, pill 340x44) on ' + layerCfg.target + (layerCfg.contend ? ' (contend)' : ' (waits for the slot)') +
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
            const key = M.keyOf(s) + '|' + nt + '|' + ln + '|' + ageWord + '|' + (info.warn || '') + '|' + (demo || '');
            if (key !== pg.key) {
                const t0 = Date.now();
                const r = P.centre(s, { night: nt, lang: ln, info, demo });     // the car at its level: the page repaints per change only, no glide
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
