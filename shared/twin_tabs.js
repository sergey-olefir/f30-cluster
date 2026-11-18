'use strict';
/**
 * twin_tabs.js - Twin Dial's live tabs and the tab bar (round 3, build package B2; SPEC-R3 section 3; the prototype is
 * package SB's, docs/twin-dial/r3/SB-REPORT.md on twin-r3/sb).
 *
 * The tab bar's five cells are tabs: 1 the on-board computer (the clock, trip and technical pages), 2 the messages,
 * 3 media, 4 phone, 5 navigation. One tab is SELECTED: its cell is filled in the tab's own colour (tdback's highlight,
 * hud.js _twinBackSend) and the centre shows its page (shared/twin_tokens.js page(): pageOf() here).
 *
 * Which tab: the setting "tab" = auto | 1 | 2 | 3 | 4 | 5, applied IN PLACE (no layout rebuild: hud.js calls update()
 * from the settings handler, the 50 ms tick and the message push). Rules of the setting "auto", in priority order
 * (SPEC-R3 3.4):
 *   1  a message shows (hud.twinCc.state window | ours with a severity: a window with none is only the keep-open of a car that
 *      cannot be read yet, not a message): tab 2, at any speed, in every mode, until it ends; then back to
 *      the tab before it. The driver may LEAVE tab 2 while a message shows (key or setting): the panel opens in the
 *      same turn (package B3 owns that; it reads hud.tabs.tab and is told through hud._twinTabMoved); the tab is not
 *      locked, and when the message ends the tab the driver chose stays.
 *   2  a call rings or runs (hud.td.callState, after probe P9): tab 4. Built and OFF: config.tabs.callSelects.
 *   3  guidance becomes active (hud.td.nav): tab 5.
 *   4  otherwise the driver's last choice (the key, or the setting set to a number; start: tab 1).
 *   Rules 2..4 wait while the car is above the lock speed (setting "tabLock" km/h, 0 = no lock, else
 *   config.tabs.lockAboveKmh); rule 1 never waits, nor does the return from a message. The driver's key is never locked.
 *   A rule the driver overrode by a key (or by fixing a tab) stays overridden until that rule's own state changes.
 *
 * The key (config.tabKey, null until the car session names a signal): a pluggable source, one entry or a list of
 *   { iface, field, path: ["member", ...], instance?,           // the value: field value -> member path
 *     press: [1, "TASTER_GEDRUECKT"] | mask: 64 | counter: true | any: true,
 *                                                                // a level in the set / a bit set / a step counter / any change
 *     dir: 1 | -1, rateMs: 300 }                                 // next or previous tab; at most one change per rateMs
 * Every entry's handler is chained IN FRONT of whatever handler the field already has. A level counts on its rising
 * edge only; a counter (8 bit) moves one tab per change in the sign of the wrapped difference. The field must also be
 * declared in app.json "signals" ("rs" or "s"); the key reads, it never writes. One press = the next tab that exists,
 * cyclic (1 -> 2 only if a message is listed -> 3 -> 4 -> 5 -> 1).
 *
 * The tab bar's own pixels (the live icons - 36 px of ink in a 46 px box - and the media cell: an icon and its text centred as ONE group) are painted
 * here too: iconState() / updateIcon(), called through shared/twin_tokens.js. NO icon is ever dimmed (SPEC-R3 3.1): the
 * state is the icon's VARIANT; names a build does not have yet fall back to the plain one (resolve()).
 *
 * Nothing here throws into the engine, nothing logs a text: tab numbers, rule letters and enum numbers only.
 * Plain Node 8 (the car's 8.16.2): no ?. / ?? / object spread.
 */
const ORDER = [1, 2, 3, 4, 5];
const PAGES = { 1: 'computer', 2: 'msg', 3: 'tab3', 4: 'tab4', 5: 'nav' };
const RATE_MS = 300;
const isNum = (x) => typeof x === 'number' && isFinite(x);

/** The warning icon on the bar while tab 2 is not selected (SPEC-R3 5.3 2); white otherwise. */
const SEV_ICON = { red: [218, 16, 48], amber: [240, 170, 10] };
/** Each pictogram a tab can show, first name this build has wins (B6 publishes the final names; the last is the old plain one). */
const ICON = {
    range: ['td_fuel'],
    warn: ['cc_warn'],
    tuner: ['td_radio', 'td_media'],
    player: ['td_media', 'td_radio'],
    projection: ['td_proj', 'td_media'],
    media: ['td_radio', 'td_media'],
    phoneBars: ['td_phone_bars', 'td_phone'],
    phoneOff: ['td_phone_off', 'td_phone'],
    phone: ['td_phone'],
    nav: ['td_nav'],
};
const MEDIA_GAP = 13;            // px between the media icon's ink and its text (K2's approved mockup: icon box + 6 + text; the box's margin is ~7)

const cfg = (hud) => (hud && hud.config && hud.config.tabs && typeof hud.config.tabs === 'object') ? hud.config.tabs : {};
const log = (hud, s) => { try { if (hud && hud.log) hud.log.info('tabs: ' + s); } catch (e) { /* never */ } };
const clock = (hud) => (hud && hud.td && typeof hud.td.clock === 'function' ? hud.td.clock() : Date.now());

/** Every tab a driver can fix with the setting (all five: tab 2 shows its empty page with no message). */
function available() { return ORDER.slice(); }

/** The tabs the driver's KEY steps through: tab 2 only while a message is listed (SPEC-R3 3.4). */
function keyTabs(hud) {
    const ig = hud && hud.config && hud.config.ccList && Array.isArray(hud.config.ccList.ignoreIds) ? hud.config.ccList.ignoreIds : [0];
    const listed = ((hud && hud.ccListAll) || []).some((e) => e && ig.indexOf(e.id) < 0);
    const msg = !!(hud && hud.tabs && hud.tabs.msg);
    return ORDER.filter((t) => t !== 2 || listed || msg);
}

/** The setting "tab": 'auto' or a tab number 1..5. Anything else reads as auto. */
function mode(hud) {
    let v = null;
    try { v = hud.ctx && hud.ctx.settings && hud.ctx.settings.item('tab') ? hud.setting('tab') : null; } catch (e) { v = null; }
    const n = typeof v === 'string' && /^[1-5]$/.test(v) ? Number(v) : v;
    return isNum(n) && ORDER.indexOf(n) >= 0 ? n : 'auto';
}

/** The lock speed in km/h, or null (no lock). The setting "tabLock" (0 = none) wins over config.tabs.lockAboveKmh. */
function lockKmh(hud) {
    let v = null;
    try { v = hud.ctx && hud.ctx.settings && hud.ctx.settings.item('tabLock') ? hud.setting('tabLock') : null; } catch (e) { v = null; }
    if (v === null || v === undefined) v = cfg(hud).lockAboveKmh;
    v = typeof v === 'string' ? Number(v) : v;
    return isNum(v) && v > 0 ? v : null;
}

function fresh() {
    return { tab: 1, choice: 1, msg: false, msgLeft: false, before: null, nav: false, call: false, dis: { nav: false, call: false },
        mode: 'auto', hold: null, reason: 'start', keys: [], lastKeyAt: -Infinity, changes: 0, since: 0 };
}
const st = (hud) => hud.tabs || (hud.tabs = (hud.twinTab = 1, fresh()));

/** Select `t` because of rule `why`; true when the tab changed. Tells hud._twinTabMoved(from, to, why) when it exists (B3). */
function select(hud, t, why) {
    const s = st(hud), from = s.tab;
    if (from === t) { s.reason = why; return false; }
    log(hud, 'tab ' + from + ' -> ' + t + ' (' + why + ')');
    s.tab = t; s.reason = why; s.changes++; s.since = clock(hud);
    hud.twinTab = t;       // the engine's backdrop reads it (package B1: the selected cell, its colour table); the caller resends through hud._twinSync()
    if (typeof hud._twinTabMoved === 'function') { try { hud._twinTabMoved(from, t, why); } catch (e) { log(hud, 'moved hook: ' + String(e && e.message || e).slice(0, 80)); } }
    return true;
}

const callNow = (hud) => cfg(hud).callSelects === true && !!(hud.td && isNum(hud.td.callState) && hud.td.callState !== 0);
// car-fix CF3: rule 3 also for a route guided by CarPlay (hud.td.route, shared/twin_pages.js: provider CAR_PLAY and a destination within 60 s)
const navOn = (hud) => !!(hud.td && (hud.td.nav === true || hud.td.route === true));

/** What the auto rules want now (not the message): 4 (call), 5 (guidance) or the driver's last choice. */
function autoTarget(hud, s, navNow, callOn) {
    if (callOn && !s.dis.call) return 4;
    if (navNow && !s.dis.nav) return 5;
    return s.choice;
}

/**
 * One decision from the engine's state (hud.twinCc, hud.td, the speed, the settings). Returns true when the selected tab
 * changed (the caller then resends the backdrop and lets the texts repaint).
 */
function update(hud) {
    const s = st(hud), m = mode(hud), c = cfg(hud);
    const cc = hud.twinCc || {};
    // a message SHOWS when the machine says window / ours with a severity; a window with none is only the keep-open of a car that cannot be read yet
    const msgNow = (cc.state === 'window' || cc.state === 'ours') && cc.severity !== null && cc.severity !== undefined;
    const navNow = navOn(hud);      // car-fix CF3: BMW's guidance or a CarPlay route
    const callOn = callNow(hud);
    const lock = lockKmh(hud);
    const v = hud._raw ? hud._raw('speed') : null;
    const locked = lock !== null && isNum(v) && v > lock;
    let changed = false;

    // a rule's own state changing ends the driver's override of it
    if (navNow !== s.nav) s.dis.nav = false;
    if (callOn !== s.call) s.dis.call = false;
    const modeChanged = m !== s.mode;
    s.mode = m;
    if (modeChanged) {
        if (m === 'auto') { s.dis.nav = false; s.dis.call = false; }
        else { s.choice = m; s.dis.nav = navNow; s.dis.call = callOn; }       // fixing a tab is the driver's choice
    }

    if (c.messageTab !== false) {
        if (msgNow && !s.msg) { s.before = s.tab; s.msg = true; s.msgLeft = false; changed = select(hud, 2, '1 message') || changed; }
        else if (!msgNow && s.msg) {
            s.msg = false;
            if (!s.msgLeft) {
                // the message's own end never waits: back to the tab before it; the other rules take over only when the car is slow
                const back = m !== 'auto' ? m : (locked && s.before !== null ? s.before : autoTarget(hud, s, navNow, callOn));
                changed = select(hud, back, '1 message ended') || changed;
            }
            s.msgLeft = false; s.before = null;
        }
        if (s.msg) {
            if (modeChanged && m !== 'auto' && m !== 2) s.msgLeft = true;                 // the setting left tab 2 on purpose
            if (!s.msgLeft && s.tab !== 2) changed = select(hud, 2, '1 message') || changed;
            if (s.msgLeft && modeChanged && m !== 'auto') changed = select(hud, m, 'F setting') || changed;
            s.nav = navNow; s.call = callOn;
            return changed;
        }
    }
    // a fixed tab
    if (m !== 'auto') { s.nav = navNow; s.call = callOn; return select(hud, m, 'F setting') || changed; }
    // auto: rules 2, 3, 4 (a change waits while locked)
    const want = autoTarget(hud, s, navNow, callOn);
    const why = want === 4 ? '2 call' : want === 5 && navNow && !s.dis.nav ? '3 guidance' : '4 choice';
    s.nav = navNow; s.call = callOn;
    if (want !== s.tab && !locked) changed = select(hud, want, why) || changed;
    return changed;
}

/** The driver's key: one step to the next (dir 1) or previous (-1) tab that exists. True when the tab changed. */
function press(hud, dir) {
    const s = st(hud), t = clock(hud);
    if (mode(hud) !== 'auto') { log(hud, 'key ignored: the tab is fixed by the setting'); return false; }
    const av = keyTabs(hud), i = av.indexOf(s.tab);
    const n = av[((i < 0 ? 0 : i) + (dir < 0 ? -1 : 1) + av.length) % av.length];
    s.choice = n; s.dis.nav = navOn(hud); s.dis.call = callNow(hud); s.hold = null;      // car-fix CF3: navOn
    s.lastKeyAt = t;
    if (s.msg) s.msgLeft = n !== 2;               // leaving tab 2 while a message shows is allowed (SPEC-R3 3.4); B3 opens the panel
    return select(hud, n, 'K key');
}

/* ------------------------------------------------------------------ the key source ------------------------------ */

function dig(v, path) {
    let cur = v;
    (Array.isArray(path) ? path : (path ? [path] : [])).forEach((k) => { cur = cur !== null && typeof cur === 'object' ? cur[k] : undefined; });
    return cur;
}

/** integration (B7, the car's key): a value in k.invalid (e.g. [255], the field's "unfilled" default, which has every bit set) is no
 *  state at all: never pressed, and the edge after it is not counted (the next real value only sets the level). */
const invalid = (k, x) => Array.isArray(k.invalid) && k.invalid.indexOf(x) >= 0;

/** Is raw value `x` "pressed" for key entry `k`? (a level in k.press, or a bit of k.mask) */
function pressed(k, x) {
    if (invalid(k, x)) return false;
    if (isNum(k.mask)) return isNum(x) && (x & k.mask) !== 0;
    const set = Array.isArray(k.press) ? k.press : [k.press];
    return x !== undefined && x !== null && set.indexOf(x) >= 0;      // an enum arrives as its name or its number: list both
}

/** One key entry's handler: edge or counter -> press(). Returns fn(value). */
function keyHandler(hud, k, onChange) {
    const ks = { prev: undefined, at: -Infinity };
    const rate = isNum(k.rateMs) ? k.rateMs : RATE_MS;
    const dir = k.dir === -1 ? -1 : 1;
    return (v) => {
        const x = dig(v, k.path);
        const t = clock(hud);
        let steps = 0;
        if (k.any === true) {
            // an indirect key: any change of the value (the cluster's own page / widget number moved) is one step
            if (ks.prev !== undefined && JSON.stringify(x) !== JSON.stringify(ks.prev)) steps = 1;
        } else if (k.counter === true) {
            if (isNum(x) && isNum(ks.prev) && x !== ks.prev) {
                const d = ((x - ks.prev) % 256 + 256) % 256;
                steps = d === 0 ? 0 : d < 128 ? 1 : -1;
            }
        } else if (pressed(k, x) && !pressed(k, ks.prev) && ks.prev !== undefined) steps = 1;
        ks.prev = invalid(k, x) ? undefined : x;      // integration (B7): an invalid value forgets the level
        if (!steps || t - ks.at < rate) return;
        ks.at = t;
        log(hud, 'key ' + k.field + ' raw ' + (isNum(x) ? x : (typeof x === 'string' && /^[A-Z0-9_]{1,60}$/.test(x) ? x : '?')));
        if (press(hud, dir * steps) && onChange) onChange();
    };
}

/**
 * Chain config.tabKey's handlers into `extra` ({ iface: { field: fn, $instance } }, the map shared/hud.js hands the
 * kit's Car), each IN FRONT of the field's own handler. onChange(): the engine's resend (hud._twinTabsChanged).
 * Returns the number of key entries wired.
 */
function wire(hud, extra, onChange) {
    const raw = hud && hud.config ? hud.config.tabKey : null;
    if (!raw) return 0;
    const list = Array.isArray(raw) ? raw : [raw];
    let n = 0;
    list.forEach((k) => {
        if (!k || typeof k !== 'object' || typeof k.iface !== 'string' || typeof k.field !== 'string') return;
        const e = extra[k.iface] = extra[k.iface] || {};
        if (k.instance) {
            if (e.$instance && String(e.$instance) !== String(k.instance)) { log(hud, 'key ' + k.field + ': instance clash, not wired'); return; }
            e.$instance = String(k.instance);
        }
        const mine = keyHandler(hud, k, onChange), prev = e[k.field];
        e[k.field] = (v) => {
            try { mine(v); } catch (err) { log(hud, 'key handler: ' + String(err && err.message || err).slice(0, 80)); }
            if (prev) prev(v);
        };
        n++;
    });
    if (n) log(hud, n + ' key source(s) wired');
    return n;
}

/* ------------------------------------------------------------------ what the tab selects elsewhere -------------- */

/** The centre page name for the selected tab (twin_tokens.page()); s.hold (a tab, set by package B3) keeps the previous page up. */
const pageOf = (hud) => { const s = st(hud); return PAGES[s.hold !== null && PAGES[s.hold] ? s.hold : s.tab]; };

/** The selected tab for the bar's fill (1..5), or 0 when live tabs are off. */
// integration (B7): without live tabs, B3's machine says which tab is selected (hud._twinTabNow)
const selected = (hud) => (hud && hud.tabs && isNum(hud.tabs.tab) ? hud.tabs.tab : hud && typeof hud._twinTabNow === 'function' ? hud._twinTabNow() : 1);

/** The G20 black-floor correction srgb((L - F) / (1 - F)), F = (0.12 %, 0.09 %, 0.56 %) (SPEC rev 2 7.1), on one sRGB code triple. */
function floorCorrect(c) {
    const F = [0.0012, 0.0009, 0.0056];
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const enc = (l) => { l = Math.max(0, l); return 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055); };
    return c.map((v, i) => Math.round(enc((lin(v) - F[i]) / (1 - F[i]))));
}

/** How many lines the bottom row shows: 2 on tab 1 (or with live tabs off), 1 on every other tab (SPEC-R3 3.5). */
function rowLines(hud) {
    if (!(hud && typeof hud._twinTabsOn === 'function' && hud._twinTabsOn())) return 2;
    return selected(hud) === 1 ? 2 : 1;
}

/* ------------------------------------------------------------------ the tab bar's icons -------------------------- */

/** The first of `names` this build has (an icon the build lacks falls back to the plain one). */
function resolve(names) {
    let have = null;
    try { have = require('./icons').ICONS; } catch (e) { have = null; }
    for (let i = 0; i < names.length; i++) if (!have || have[names[i]]) return names[i];
    return names[names.length - 1];
}

/** The source icon of tab 3: hud.td.mediaSource 'tuner' | 'player' | 'projection' (after probe P8; null until then). */
function mediaKey(hud) {
    const m = hud.td && hud.td.mediaSource;
    return m === 'tuner' || m === 'player' || m === 'projection' ? m : 'media';
}

/** The state of a tab-bar icon (widget "tdLive": "fixed" | "warn" | "media" | "phone" | "nav"): { icon, color }. color: null = the theme's white. */
function iconState(hud, w) {
    const td = hud.td || {};
    switch (w.tdLive) {
        case 'warn': {
            // the severity only while a message shows and tab 2 is not selected (SPEC-R3 5.3 2); white on the fill and when nothing shows
            const cc = hud.twinCc || {}, shows = cc.state === 'window' || cc.state === 'ours';
            const sev = shows && selected(hud) !== 2 && SEV_ICON[cc.severity] ? cc.severity : null;
            return { icon: resolve(ICON.warn), color: sev, tag: sev || 'white' };
        }
        case 'media': return { icon: resolve(ICON[mediaKey(hud)]), color: null, tag: 'white' };
        case 'phone': {
            // a phone variant, never a dim: connected -> bars, none -> crossed out, unknown (until P9) -> the plain handset
            const k = td.phoneConnected === true ? 'phoneBars' : td.phoneConnected === false ? 'phoneOff' : 'phone';
            return { icon: resolve(ICON[k]), color: null, tag: 'white' };
        }
        case 'nav': return { icon: resolve(ICON.nav), color: null, tag: 'white' };      // the turn arrow stays dark until probe P12
        default: return { icon: w.icon, color: null, tag: 'white' };
    }
}

/** The rgba an icon state paints in: the theme's white, or the severity colour at the night multiplier. */
function colourOf(hud, s) {
    if (s.color && SEV_ICON[s.color]) {
        const c = s.color === 'red' ? floorCorrect(SEV_ICON.red) : SEV_ICON[s.color];       // the spec's red is before the panel's black-floor correction; the amber is the engine's own (TW_SEV)
        if (typeof hud._twinCode === 'function') { const k = hud._twinCode(c, s.color === 'red' ? 'red' : 'amber'); return [Math.round(k[0] * 255), Math.round(k[1] * 255), Math.round(k[2] * 255), 255]; }
        return c.concat([255]);
    }
    const th = hud.theme || {};
    return th.fg || [255, 255, 255, 255];
}

/** The media cell's pixels: the source icon and the station / title text centred as ONE group (by the icon's INK, not its box), the text cut with an ellipsis. */
function paintMedia(hud, w, name, col, text) {
    const paintIcon = require('./icons').paintIcon;
    const TR = require('./hud_text');
    const W = w.w, H = w.h, S = isNum(w.iconBox) ? w.iconBox : Math.min(H, 46);
    const out = Buffer.alloc(W * H * 4, 0);
    const ic = paintIcon(name, S, S, col), iy = Math.round((H - S) / 2);
    let il = S, ir = -1;                                   // the icon's ink, left and right (alpha above a quarter)
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (ic[(y * S + x) * 4 + 3] > 64) { if (x < il) il = x; if (x > ir) ir = x; }
    if (ir < il) { il = 0; ir = S - 1; }
    const inkW = ir - il + 1;
    let t = typeof text === 'string' ? text : '';
    let tw = 0;
    const font = w.font || 'td_tab';
    if (t) {
        const avail = W - inkW - MEDIA_GAP;
        const g = TR.loadFont(font).metrics.glyphs;
        const ell = g['\u2026'] ? '\u2026' : '...';
        const fit = (v) => TR.measure(v, font, 0) <= avail;
        if (!fit(t)) {
            let u = t;
            while (u.length > 1 && !fit(u.replace(/\s+$/, '') + ell)) u = u.slice(0, -1);
            t = u.replace(/\s+$/, '') + ell;
        }
        tw = TR.measure(t, font, 0);
    }
    const group = inkW + (tw ? MEDIA_GAP + tw : 0), left = Math.round((W - group) / 2), x0 = left - il;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const a = ((y * S + x) * 4), px = x + x0;
        if (px < 0 || px >= W || ic[a + 3] === 0) continue;
        const o = ((y + iy) * W + px) * 4;
        out[o] = ic[a]; out[o + 1] = ic[a + 1]; out[o + 2] = ic[a + 2]; out[o + 3] = ic[a + 3];
    }
    if (tw) {
        const fm = TR.loadFont(font).metrics;
        const base = isNum(w.textBase) ? w.textBase : 156 - w.y;               // the text's baseline in the box (panel baseline 156)
        const lay = TR.drawText(W, H, t, { font, offsetY: base - fm.baseline, x: left + inkW + MEDIA_GAP, color: col, align: 'left' });
        for (let i = 0; i < W * H; i++) {
            const a = lay[i * 4 + 3];
            if (!a) continue;
            const o = i * 4;
            if (out[o + 3] === 0) { out[o] = lay[o]; out[o + 1] = lay[o + 1]; out[o + 2] = lay[o + 2]; out[o + 3] = a; }
        }
    }
    return out;
}

/**
 * Repaint a live icon when its name, its colour or (media) its text changed (also after a night change: the engine clears
 * x.last). Called through twin_tokens.updateIcon for a widget with "tdLive".
 */
function updateIcon(hud, x, nowMs, force) {
    const w = x.w, s = iconState(hud, w), col = colourOf(hud, s);
    const text = w.tdLive === 'media' && hud.td && hud.td.media ? String(hud.td.media) : '';
    const key = s.icon + '|' + col.join(',') + (w.tdLive === 'media' ? '|' + text : '');
    if (!force && key === x.last) return;
    x.last = key;
    if (w.tdLive === 'media') { hud._blitDiff(x, paintMedia(hud, w, s.icon, col, text)); return; }
    hud._blitDiff(x, require('./icons').paintIcon(s.icon, w.w, w.h, col));
}

module.exports = { update, press, wire, available, keyTabs, mode, lockKmh, pageOf, selected, floorCorrect, rowLines, iconState, updateIcon, paintMedia, resolve,
    fresh, PAGES, ORDER, SEV_ICON, ICON, MEDIA_GAP };
