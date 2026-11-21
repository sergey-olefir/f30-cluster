'use strict';
/**
 * stub_receiver.js - a FAKE service 13203 (MultimodalControlDriverAssistance) for the bench and the simulator (package CM,
 * rung 1). It stands where the car's unknown receiver would stand. It is not a model of BMW's unit: it is a set of the
 * behaviours the module has to survive, chosen by `mode`:
 *
 *   accept      applies the value at once, answers ok
 *   refuse      applies nothing, answers an error (the setter's call fails)
 *   silent      applies nothing, answers ok (a write the receiver drops without a word)
 *   lateAnswer  applies the value at once, answers ok only after lateAnswer_s
 *   lateRefuse  applies nothing, answers an error only after lateAnswer_s
 *   scale       applies raw * scaleFactor + scaleOffset (a different scale than the module assumes), answers ok
 *   delayApply  answers ok at once, applies the value only after applyDelay_s
 *   offAfter    accepts the first `okCount` requests, then is silent (a receiver that stops listening)
 *
 * Whatever the mode, every payload is decoded and checked against the module's frozen shape (cruise_cmd.assertFrozenShape
 * with either allowed sender). A payload outside it is a VIOLATION: it is recorded and never applied. The tests require
 * zero violations.
 *
 *   create(opts) -> { receive(t_s, bytes) -> { seq, ok, applyAt, answerAt, kmh }, due(t_s) -> [events], violations,
 *                     history, opts }
 *   due(t) returns, in time order, the events whose time has come: { kind: 'apply', t, kmh, seq } | { kind: 'answer', t,
 *   seq, ok, code }. The caller (the simulator's plant wrapper, or the bench server) carries them out.
 * Time in seconds. Node 8 syntax; no I/O (bench.js puts it behind a local HTTP port).
 */

const CM = require('../../shared/cruise_cmd.js');

const MODES = ['accept', 'refuse', 'silent', 'lateAnswer', 'lateRefuse', 'scale', 'delayApply', 'offAfter'];

const DEFAULTS = {
    mode: 'accept',
    answer_s: 0.05,          // the normal answer delay
    lateAnswer_s: 3,         // lateAnswer / lateRefuse
    scaleFactor: 1,          // scale: the stub's reading of the raw value
    scaleOffset: 0,
    applyDelay_s: 4,         // delayApply
    okCount: 3,              // offAfter
    valueFactor: 1,          // the stub's own idea of the scale in every other mode (the assumed km/h)
    valueOffset: 0,
};

function create(o) {
    const opts = Object.assign({}, DEFAULTS, o || {});
    if (MODES.indexOf(opts.mode) < 0) throw new Error('stub: unknown mode ' + opts.mode);
    let queue = [];
    const violations = [];
    const history = [];
    let n = 0;

    function push(e) { queue.push(e); queue.sort((a, b) => a.t - b.t || a.order - b.order); }

    function receive(t, bytes) {
        n++;
        const rec = { t: t, n: n, bytes: bytes ? Array.prototype.slice.call(bytes) : null, ok: false, kmh: null, applyAt: null, answerAt: null, violation: null };
        let struct = null;
        try {
            struct = CM.decode(bytes);
            const sender = struct.mMControlSender === CM.SENDERS.SPEECH ? 'SPEECH' : 'PROACTIVE_OFFER';
            CM.assertFrozenShape(struct, { sender: sender });
        } catch (e) {
            rec.violation = String(e && e.message || e);
            violations.push(rec);
            history.push(rec);
            push({ kind: 'answer', t: t + opts.answer_s, seq: n, ok: false, code: 'MALFORMED', order: n * 2 });
            rec.answerAt = t + opts.answer_s;
            return rec;
        }
        const raw = struct.mMControlADSetSpeedValue;
        const factor = opts.mode === 'scale' ? opts.scaleFactor : opts.valueFactor;
        const offset = opts.mode === 'scale' ? opts.scaleOffset : opts.valueOffset;
        const kmh = raw * factor + offset;
        let apply = true, ok = true, ansT = t + opts.answer_s, appT = t;
        if (opts.mode === 'refuse') { apply = false; ok = false; }
        else if (opts.mode === 'silent') { apply = false; }
        else if (opts.mode === 'lateAnswer') { ansT = t + opts.lateAnswer_s; }
        else if (opts.mode === 'lateRefuse') { apply = false; ok = false; ansT = t + opts.lateAnswer_s; }
        else if (opts.mode === 'delayApply') { appT = t + opts.applyDelay_s; }
        else if (opts.mode === 'offAfter' && n > opts.okCount) { apply = false; }
        rec.ok = ok; rec.kmh = kmh; rec.answerAt = ansT;
        if (apply) { rec.applyAt = appT; push({ kind: 'apply', t: appT, kmh: kmh, seq: n, order: n * 2 }); }
        push({ kind: 'answer', t: ansT, seq: n, ok: ok, code: ok ? 'OK' : 'REFUSED', order: n * 2 + 1 });
        history.push(rec);
        return rec;
    }

    function due(t) {
        const out = [], keep = [];
        queue.forEach((e) => { (e.t <= t + 1e-9 ? out : keep).push(e); });
        queue = keep;
        return out;
    }

    return { receive: receive, due: due, violations: violations, history: history, opts: opts, pending: () => queue.length };
}

module.exports = { create: create, MODES: MODES, DEFAULTS: DEFAULTS };
