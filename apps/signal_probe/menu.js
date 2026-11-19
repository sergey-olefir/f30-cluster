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

// cruise RC: the recording rows (recorder.js): the sets a press on "REC" records, one choice per press of "RECSET"
const REC_CHOICES = [['S17'], ['S14'], ['S14', 'S15'], ['S13']];     // r1120 AC: ACC (S17) first
/** r1120 AC: a recording's sets as the rows say them: a set's label where it has one (S17 = "ACC"), else its id. */
const recName = (ids) => ids.map((id) => { const s = FIELDS.SETS.find((x) => x.id === id); return (s && s.label) || id; }).join('+');
const mb = (b) => (Math.round(b / 104857.6) / 10).toFixed(1).replace('.', ',') + ' МБ';
const grp = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

class Menu {
    /** rec: the Recorder (cruise RC), or none: then the two recording rows say so and do nothing. */
    constructor(ctx, probe, rec, recCfg) {
        this.ctx = ctx; this.ui = ctx.ui; this.probe = probe; this.log = ctx.log;
        this.rec = rec || null;
        const choices = recCfg && Array.isArray(recCfg.choices) ? recCfg.choices.filter((c) => Array.isArray(c) && c.length && c.every((id) => FIELDS.SETS.some((x) => x.id === id))) : [];
        this.recChoices = choices.length ? choices : REC_CHOICES;
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
        ui.onClick('REC', () => this.guard('rec', () => { this.toggleRec(); this.soon(0); return null; }));          // cruise RC
        ui.onClick('RECSET', () => this.guard('recset', () => { this.nextRecSet(); this.soon(0); return null; }));   // cruise RC
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
    // ---- cruise RC: recording -------------------------------------------------------------------------------------------------
    /** The sets the next recording takes (settings key recSet, "S17" or "S14+S15"; the first choice when unset or unknown). */
    recSets() {
        const v = this.ctx.settings.get('recSet');
        const c = this.recChoices.find((x) => x.join('+') === v);
        return (c || this.recChoices[0]).slice();
    }
    nextRecSet() {
        if (!this.rec || this.rec.on) return;          // the choice is fixed while a recording runs
        const cur = this.recSets().join('+');
        const i = this.recChoices.findIndex((x) => x.join('+') === cur);
        this.ctx.settings.set('recSet', this.recChoices[(i + 1) % this.recChoices.length].join('+'));
    }
    /** Start: the sets are switched on (their checkboxes too), their fields routed to the recorder. Stop: the sets stay on. */
    toggleRec() {
        const rec = this.rec;
        if (!rec) return;
        if (rec.on) { rec.stop(); this.probe.recordSets([]); return; }
        const sets = this.recSets();
        FIELDS.SETS.filter((x) => sets.indexOf(x.id) >= 0 && this.ctx.settings.get(x.key) !== true).forEach((x) => this.ctx.settings.set(x.key, true));
        this.probe.setSets(this.wanted());
        const n = this.probe.recordSets(sets);
        if (rec.start(sets)) this.log.info('probe: rec: ' + n + ' fields routed to the recorder');
        else this.probe.recordSets([]);
    }
    recText() {
        const rec = this.rec;
        if (!rec) return { a: 'Запис недоступний', b: '' };
        const s = rec.status();
        const free = 'вільно ' + mb(s.room);
        if (s.on) return { a: 'Запис ' + recName(s.sets) + ' іде, ' + Math.floor(s.seconds / 60) + ':' + ('0' + (s.seconds % 60)).slice(-2) + '. Натисніть: стоп',
            b: grp(s.samples) + ' зразків, ' + mb(s.bytes) + ', ' + free + (s.dropped ? ', втрачено ' + grp(s.dropped) : '') };
        return { a: 'Почати запис ' + recName(this.recSets()),
            b: (s.error ? 'ЗУПИНЕНО: ' + s.error + '. ' : s.session ? 'останній: ' + grp(s.samples) + ' зразків. ' : '') + free + ' з ' + mb(s.quota) };
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
            // cruise RC: the recording rows
            const r = this.recText();
            this.cells('REC', { Text1stRow: r.a, Text2ndRow: r.b });
            this.cells('RECSET', { Text1stRow: 'Набір для запису: ' + recName(this.recSets()), Text2ndRow: this.rec && this.rec.on ? 'зміниться після стопу' : 'натисніть, щоб змінити' });
            this.text('STATUS2', 'Не користуйтеся меню під час руху. Журнал: журнал застосунку signal_probe; запис: data/rec.');
        });
    }
}

module.exports = Menu;
