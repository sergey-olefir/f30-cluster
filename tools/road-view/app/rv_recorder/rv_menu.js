'use strict';
/**
 * rv_menu.js - the RV recorder's centre screen (kit "menu" screen MAIN of app.json): a status line, "Позначка N" (a mark in the
 * recording and the log), "Почати запис RV" (start / stop), the setting "TRIP = позначка", the language row, a hint. Nothing here
 * draws on the cluster. The words come from shared/i18n/<lang>.json through shared/lang.js: Signal Probe's recording rows
 * (probe.*) and three of its own (rv.*). Every handler is guarded: an escaped exception would end the app.
 */
const I = require('./lang');

const hhmmss = (d) => ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
const mb = (b) => I.t('probe.mb', { v: (Math.round(b / 104857.6) / 10).toFixed(1).replace('.', I.t('kit.decimal')) });
const grp = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

class Menu {
    /** rv: the RoadView engine; rec: its Recorder, or none (then the recording row says so and does nothing). */
    constructor(ctx, rv, rec) {
        this.ctx = ctx; this.ui = ctx.ui; this.rv = rv; this.rec = rec || null; this.log = ctx.log;
        this.sent = Object.create(null);
        this.timer = null; this.tick = null;
    }
    guard(what, fn) {
        try { return fn(); } catch (e) { this.log.error('menu ' + what + ': ' + (e && e.stack || e)); return undefined; }
    }
    has(name) {
        const r = this.ui.rhmi;
        return !!(r && typeof r.getByName === 'function' && r.getByName(name));
    }
    start() {
        const ui = this.ui;
        ui.onClick('MARK', () => this.guard('mark', () => { this.rv.mark('menu'); this.soon(0); return null; }));
        ui.onClick('REC', () => this.guard('rec', () => { this.toggle(); this.soon(0); return null; }));
        I.onChange(() => this.guard('language', () => { this.sent = Object.create(null); this.soon(0); }));
        this.ctx.settings.onChange((key) => this.guard('setting ' + key, () => {
            if (key === 'tripMark') this.rv.tripMark = this.ctx.settings.get('tripMark') !== false;
            this.soon();
        }));
        ui.onVisible((name, on) => this.guard('visible', () => {
            if (name !== 'MAIN' || !on) return;
            this.sent = Object.create(null);
            this.soon(0);
        }));
        this.tick = setInterval(() => this.guard('tick', () => this.refresh()), 3000);
        if (this.tick && this.tick.unref) this.tick.unref();
        this.refresh();
    }
    toggle() {
        if (!this.rec) return;
        if (this.rv.on) { this.rv.end(); return; }
        if (this.rv.begin()) this.log.info('rv: rec: ' + this.rv.sources.length + ' sources routed to the recorder');
    }
    recText() {
        const rec = this.rec;
        if (!rec) return { a: I.t('probe.rec.none'), b: '' };
        const s = rec.status();
        const free = I.t('probe.rec.free', { mb: mb(s.room) });
        if (s.on) return { a: I.t('probe.rec.on', { sets: 'RV', time: Math.floor(s.seconds / 60) + ':' + ('0' + (s.seconds % 60)).slice(-2) }),
            b: I.plural('probe.rec.samples', s.samples, { n: grp(s.samples) }) + ', ' + mb(s.bytes) + ', ' + free + (s.dropped ? ', ' + I.t('probe.rec.lost', { n: grp(s.dropped) }) : '') };
        return { a: I.t('probe.rec.start', { sets: 'RV' }),
            b: (s.error ? I.t('probe.rec.stopped', { why: s.error }) + ' ' : s.session ? I.t('probe.rec.last', { samples: I.plural('probe.rec.samples', s.samples, { n: grp(s.samples) }) }) + ' ' : '') + I.t('probe.rec.of', { free: free, quota: mb(s.quota) }) };
    }
    soon(ms) {
        if (this.timer) return;
        this.timer = setTimeout(() => { this.timer = null; this.refresh(); }, ms === undefined ? 250 : ms);
    }
    text(name, s) {
        s = String(s || '');
        if (this.sent[name] === s || !this.has(name)) return;
        this.sent[name] = s;
        this.ui.text(name, s);
    }
    cells(name, obj) {
        const key = JSON.stringify(obj);
        if (this.sent[name] === key || !this.has(name)) return;
        this.sent[name] = key;
        this.ui.cells(name, 0, obj);
    }
    refresh() {
        this.guard('refresh', () => {
            const st = this.rv.status();
            this.text('STATUS', st.listening ? I.t('rv.status', { heard: st.heard, sources: st.sources, up: st.hubs.up, built: st.hubs.built,
                errors: st.hubs.error ? I.t('probe.status.errors', { n: st.hubs.error }) : '' }) : I.t('rv.status.idle'));
            this.cells('MARK', {
                Text1stRow: I.t('probe.mark', { n: st.marks + 1 }),
                Text2ndRow: st.lastMark ? I.t('probe.mark.last', { n: st.lastMark.n, at: hhmmss(new Date(st.lastMark.at)) }) : I.t('probe.mark.none'),
            });
            const r = this.recText();
            this.cells('REC', { Text1stRow: r.a, Text2ndRow: r.b });
            this.text('STATUS2', I.t('rv.status2'));
        });
    }
}

module.exports = Menu;
