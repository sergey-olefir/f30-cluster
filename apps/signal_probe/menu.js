'use strict';
/**
 * menu.js - the probe's centre screen: BMW's own native widgets (kit "menu" screen MAIN of app.json). One status line, the
 * "Позначка N" row (a press = one marker line in the log, so the owner's steps can be found in it), then one checkbox per set
 * (the kit wires them: a press toggles the setting, settings.onChange reaches us), then a hint. Nothing here draws on the
 * cluster and nothing talks to cluster-render. Every handler is guarded: an escaped exception would end the app, and a second
 * unexpected exit uninstalls it.
 */
const FIELDS = require('./fields');

const hhmmss = (d) => ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);

class Menu {
    constructor(ctx, probe) {
        this.ctx = ctx; this.ui = ctx.ui; this.probe = probe; this.log = ctx.log;
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
    /** The sets the settings say are on. */
    wanted() {
        return FIELDS.SETS.filter((s) => this.ctx.settings.get(s.key) === true).map((s) => s.id);
    }
    start() {
        const ui = this.ui, settings = this.ctx.settings;
        ui.onClick('MARK', () => this.guard('mark', () => { this.probe.mark(); this.soon(0); return null; }));
        settings.onChange((key) => this.guard('setting ' + key, () => {
            if (!FIELDS.SETS.some((s) => s.key === key)) return;
            this.probe.setSets(this.wanted());
            this.soon();
        }));
        ui.onVisible((name, on) => this.guard('visible', () => {
            if (name !== 'MAIN' || !on) return;
            this.sent = Object.create(null);      // the HMI builds the screen afresh: everything again
            this.soon(0);
        }));
        this.tick = setInterval(() => this.guard('tick', () => this.refresh()), 3000);
        if (this.tick && this.tick.unref) this.tick.unref();
        this.refresh();
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
            const p = this.probe, h = p.hubStats(), on = p.setsOn();
            this.text('STATUS', 'Набори: ' + (on.join(' ') || 'жодного') + '. Інтерфейсів: ' + h.up + ' з ' + h.built + (h.error ? ', помилок ' + h.error : '') +
                '. Рядків у журналі: ' + p.lines + ' (' + Math.round(p.bytes / 1024) + ' КБ)');
            this.cells('MARK', {
                Text1stRow: 'Позначка ' + (p.markN + 1),
                Text2ndRow: p.lastMark ? 'остання: ' + p.lastMark.n + ' о ' + hhmmss(new Date(p.lastMark.at)) : 'ще не було. Натисніть у момент дії',
            });
            this.text('STATUS2', 'Не користуйтеся меню під час руху. Журнал: журнал застосунку signal_probe.');
        });
    }
}

module.exports = Menu;
