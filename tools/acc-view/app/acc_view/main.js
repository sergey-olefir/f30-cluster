'use strict';
/**
 * ACC View (round 1120, package AA; docs/r1120/AA-SPEC.md): a separate, READ-ONLY app that draws the vehicle ahead, the gap
 * level, closing, and the cruise / limiter on the cluster's `map` target. A SKELETON: off by default, not in the Store
 * (it lives outside apps/, which the Store's mgu-repo.json globs as "apps/*"), no new shared behaviour for the other apps.
 *
 * What it does, and only this:
 *   - "Показувати на щитку (тест)" off (the default): no subscription, no cluster-render connection, no layer. Nothing at all.
 *   - On: it subscribes four read-only fields (app.json: "s" / "rs" with a non-zero getter; no setter, no method, nothing written
 *     to the car), decodes them with shared/front_vehicle.js and shared/limit_src.js, and paints ONE image layer of 420 x 372 on
 *     the map target at (334, 44) - the core that both themes' map windows show. Without `contend` it waits until the map slot
 *     is free; it never pushes BMW's map aside unless config.layer.contend is set (the owner's decision, AA-SPEC 7).
 *   - "Демо" on: the mockup park's 14 states in turn (4 s each), no signals: for the bench and for a look while parked.
 *   - Off again: the layer is dropped, the socket closed; values that still arrive are ignored (a proxy shutdown has never been
 *     tried on the car, so the proxies are kept until the app restarts, as Twin Dial's front-vehicle test does).
 * Log lines: numbers and enum names only (the tracker's own "fv:" lines, one "acc:" line per state change at most every second).
 * Never lets an exception escape: an OAP app that exits twice is uninstalled by the platform.
 */
const mgu = require('./kit/mgu');
const V = require('./view');

const DDS_IF = 'de.bmw.infotainment.displaydataserver.DisplayDataServer';
const SPEED_IF = 'de.bmw.infotainment.vehicle.Vehicle2';
const FASUS_IF = 'de.bmw.infotainment.fasus.FASuS';
const TICK_MS = 150;
const DEMO_MS = 4000;

function req(name) { try { return require('./' + name); } catch (e) { return null; } }

mgu.run({
    start(ctx) {
        const log = ctx.log;
        const cfg = (ctx.spec && ctx.spec.config) || {};
        const FV = req('front_vehicle'), SRC = req('limit_src'), CR = req('cluster_render_client');
        if (!FV || !SRC || !CR) { log.error('acc: a shared module is missing (front_vehicle / limit_src / cluster_render_client): staying idle'); return; }
        const layerCfg = Object.assign({ target: 'map', klass: 'content', z: 0, contend: false, guideHold: 0, night: false }, cfg.layer || {});
        const cruCfg = SRC.hudCruiseCfg(cfg.cruise || {});
        const warnCfg = cfg.warn || {};
        const fvCfg = Object.assign({}, cfg.frontVehicle || {}, { on: true });

        const st = { show: false, demo: false, cr: null, ref: 0, last: null, key: '', demoAt: 0, demoI: 0, kmh: null, cru: null, warn: false,
            subscribed: false, warnLines: 0, lineAt: 0, timer: null, tracker: null };

        const status = (s) => { try { ctx.ui.text('STATUS', s); } catch (e) { /* the HMI may not be up yet */ } };
        const guard = (what, fn) => function () { try { return fn.apply(null, arguments); } catch (e) { log.error('acc: ' + what + ': ' + (e && e.stack || e)); return undefined; } };

        // ---- signals: subscribed once, the first time the picture is switched on outside the demo ----
        function subscribe() {
            if (st.subscribed) return;
            st.subscribed = true;
            st.tracker = FV.create(fvCfg, { log });
            st.tracker.start();
            const w = (iface, inst, handlers) => Promise.resolve().then(() => ctx.signals.watch(iface, inst, handlers, log))
                .then((r) => log.info('acc: watch ' + iface.split('.').pop() + (r && r.error ? ' error: ' + r.error : ' ok')), (e) => log.warn('acc: watch ' + iface.split('.').pop() + ': ' + e));
            const fvC = st.tracker.cfg;
            const h1 = {}; h1[fvC.field] = guard('front', (v) => { if (st.show && !st.demo) st.tracker.feed(v, st.kmh); });
            w(fvC.iface, fvC.instance || '1', h1);
            const h2 = {}; h2[cruCfg.hudField] = guard('cruise', (v) => { st.cru = SRC.hudCruiseOf(cruCfg, v); });
            w(cruCfg.hudIface, cruCfg.hudInstance || '1', h2);
            w(SPEED_IF, '1', { statusCarSpeed2: guard('speed', (v) => {
                const raw = v && typeof v === 'object' ? v.speedVehicleCentreOfGravity : null;
                st.kmh = typeof raw === 'number' && raw !== 65535 ? raw * 0.015625 : null;
            }) });
            // the car's own collision warning: its struct is unseen on this car, so it is LOGGED (enum names / numbers, at most 40
            // lines a run) and only drawn when config.warn names a path and the values that mean "active" (off by default)
            w(FASUS_IF, '1', { requestWarnBrakeCoordinatorDisplay: guard('warn', (v) => {
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

        // ---- the layer ----
        function open() {
            if (st.cr) return;
            const sock = process.env.HUD_CLUSTER_SOCKET || cfg.socketPath || CR.DEFAULT_PATH;     // HUD_CLUSTER_SOCKET: the Mac bench only
            const cr = new CR.ClusterRender('acc_view', sock);
            st.cr = cr;
            st.ref = cr.image({ target: layerCfg.target, klass: layerCfg.klass, z: layerCfg.z, x: V.AT.x, y: V.AT.y, w: V.W, h: V.H, iw: V.W, ih: V.H,
                contend: !!layerCfg.contend, guide_hold: layerCfg.guideHold ? 1 : 0 });
            cr.on('ready', guard('ready', () => { if (st.last) cr.pixels(st.ref, null, st.last); }));
            cr.on('layer', guard('layer', (ref, state, reason) => log.info('acc: layer ' + state + (reason ? ' (' + String(reason).length + ' chars)' : ''))));
            cr.on('target', guard('target', (name, state) => { if (name === layerCfg.target) log.info('acc: target ' + name + ' ' + state); }));
            cr.on('error', guard('socket', (e) => log.warn('acc: cluster-render: ' + (e && e.code || e))));
            cr.connect();
            log.info('acc: layer ' + V.W + 'x' + V.H + ' on ' + layerCfg.target + ' at ' + V.AT.x + ',' + V.AT.y + (layerCfg.contend ? ' (contend)' : ' (waits for the slot)'));
        }
        function close() {
            if (!st.cr) return;
            try { st.cr.close(); } catch (e) { /* closing anyway */ }
            st.cr = null; st.ref = 0; st.last = null; st.key = '';
            log.info('acc: layer dropped');
        }

        const keyOf = (s) => [s.data, s.tgt, s.clo, s.cru ? s.cru.join(':') : '-', s.warn ? 1 : 0, s.adv || 0].join('|');
        const tick = guard('tick', () => {
            if (!st.show && !st.demo) return;
            const now = Date.now();
            let s;
            if (st.demo) {
                if (now - st.demoAt >= DEMO_MS) { st.demoAt = now; st.demoI = (st.demoI + 1) % V.DEMO.length; }
                s = V.DEMO[st.demoI][2];
            } else s = V.stateOf(st.tracker ? st.tracker.view(st.kmh) : null, st.cru, st.warn);
            const k = keyOf(s);
            if (k === st.key) return;
            st.key = k;
            const px = V.paint(s, !!layerCfg.night);
            const r = V.diffRect(st.last, px, V.W, V.H);
            st.last = px;
            if (st.cr && r) st.cr.pixels(st.ref, [r], V.cut(px, V.W, r));
            if (now - st.lineAt >= 1000) { st.lineAt = now; log.info('acc: state ' + k + (r ? ' rect ' + r.w + 'x' + r.h : '')); }
            status((st.demo ? 'Демо ' + V.DEMO[st.demoI][0] + ' ' + V.DEMO[st.demoI][1] : 'Показ') + ': ' + s.data + (s.tgt ? ' рівень ' + s.tgt : ''));
        });

        const apply = guard('apply', () => {
            st.show = ctx.settings.get('show') === true;
            st.demo = ctx.settings.get('demo') === true;
            if (st.show || st.demo) {
                if (st.show && !st.demo) subscribe();
                open();
                if (!st.timer) st.timer = setInterval(tick, TICK_MS);
                st.key = '';
                tick();
            } else {
                close();
                if (st.timer) { clearInterval(st.timer); st.timer = null; }
                status('Вимкнено: нічого не читається і не малюється');
            }
            log.info('acc: show ' + (st.show ? 'on' : 'off') + ', demo ' + (st.demo ? 'on' : 'off'));
        });

        try {
            ctx.settings.onChange((key) => { if (key === 'show' || key === 'demo') apply(); });
            apply();
        } catch (e) { log.error('acc: start: ' + (e && e.stack || e)); }
        process.on('exit', () => { try { close(); } catch (e) { /* exiting anyway */ } });
    },
});
