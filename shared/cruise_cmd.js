'use strict';
/**
 * cruise_cmd.js - the gated cruise command module (package CM, rung 1 of CC-REPORT §7.4: bench and simulator ONLY).
 *
 * NOTHING HERE REACHES THE CAR. No app in apps/ may require this file or declare the setter it builds for; a test in
 * tools/cruise-sim/tests/cm-store.test.js fails if one does. The only callers are tools/cruise-cmd/ (the bench test app,
 * the stub receiver, the simulator adapter) and the tests.
 *
 * What it is: the ONE place where a set-speed request for BMW's own cruise (DCC) may be built, and the gates around it.
 * The route is the write-only field
 *   de.bmw.dass.driverassistanceapplications.MultimodalControlDriverAssistance.multimodalControlDriverAssistance
 *   (service 13203, instance 1, setter id 1, getter id 0, no notifier; CC-REPORT §4.1)
 * whose struct has ten one-byte members. Whether any unit on the owner's car receives it is unknown (rung 2 records that).
 *
 * Pure: no I/O, no clock, no timers, no randomness, no require. Time comes in as `now` (ms, monotonic). Node 8 syntax.
 * Every public function except the builder's checks never throws: an exception inside step() disarms for the drive.
 *
 * The gates (CC-REPORT §7.3; hazards H1-H7 of §7.2):
 *   G1  one frozen request shape: "adapt to this value" (REQUEST_ADAPT_SPEED_SPEEDVALUE) with every other member at its
 *       no-change value; the value at or below the driver's set speed (the ceiling). buildRequest() refuses all else.
 *   G2  armed by the driver for this drive only, in two deliberate steps (armStep, then armConfirm 0.5-5 s later);
 *       disarmed at every start (create() is always disarmed; nothing is stored).
 *   G3  never builds ON, OFF, COMPLETE_OFF, RESUME, CANCEL, a mode change, "take current speed", "take the limit
 *       suggestion", undo, any RequestExtended, any NHA request, a configuration change (assertFrozenShape).
 *   G4  conditions: the cluster feed shows DCC ACTIVE (not the limiter, not ACC, not override); speed above 40 km/h; every
 *       input fresh; the vehicle-ahead data valid and fresh; no BMW offer shown (H7); plus the envelope below.
 *   G5  watchdog: a decision that has not advanced for 2 ticks (or is older than 2 ticks) disarms; nothing more is sent.
 *   G6  the driver wins: brake, accelerator override (pedal, feed or inferred), a cruise key, the cruise leaving ACTIVE,
 *       or a set-speed change the module did not make: disarmed and locked for the rest of the drive.
 *   G7  at most maxStep_kmh (<= 5) per request, at most one request per minInterval_ms (>= 3000); never below the floor
 *       (max(40 km/h, the driver's minimum)).
 *   G8  view(): armed or not, adjusting or holding, and the reason; every decision carries a reason enum, and the log line
 *       is numbers and enum names only.
 *   H1  lower-only to the ceiling: the ceiling is the feed's set speed when the driver arms; any later change of the set
 *       speed that is not ours disarms, so the ceiling never moves while armed. Raises only back toward the ceiling.
 *   H3  after every request the feed must show exactly that value within verifyWindow_ms; another value, or no change,
 *       disarms for the drive. A refusal from the setter disarms for the drive.
 *   Envelope: the cases the gates cannot handle (simulator: docs/fixes-1121/CM-REPORT.md §3) disarm the module, with an
 *       ENVELOPE_* reason, so the driver is told at once: a vehicle ahead closer than tgMin_s; a closing the gated
 *       descent cannot absorb before the time gap falls under tgFloor_s (a forward prediction of the module's own fastest
 *       legal profile on an ASSUMED plant); a lead braking harder than aLeadMax_mps2; a lead slower than the floor.
 *   Requests need a tracked vehicle ahead: with none (or a lost one) the module sends nothing and the set speed stays.
 *
 *   create(cfg)                -> instance (always DISARMED; an invalid cfg leaves it locked with CONFIG_INVALID)
 *   instance.armStep(now)      -> view        the driver's first deliberate step
 *   instance.armConfirm(now, inp) -> view     the second step: checks every condition now; sets the ceiling
 *   instance.disarm(now)       -> view        the driver's off switch (not locked: the driver may arm again)
 *   instance.step(now, inp)    -> { request | null, view, log | null }   once per tick (tick_ms)
 *   instance.onResult(now, seq, ok, code) -> view   the setter's answer for request `seq` (an error disarms, locked)
 *   instance.view()            -> view
 *   buildRequest(kmh, lim, cfg, seq) -> the frozen request (THROWS on anything outside G1/G3/G7)
 *   assertFrozenShape(struct, cfg)   -> true (THROWS unless the struct is the frozen shape)
 *   encode(struct) -> [10 bytes];  decode(bytes) -> struct (throws on a malformed payload)
 *   validateConfig(cfg) -> { ok, cfg, errors }
 *
 * inp (all optional except as G4 requires; times in ms on the same clock as `now`):
 *   feed:     { kind: 'cruise' | 'limiter' | 'acc' | null, status: 'active' | 'standby' | 'off' | 'override', kmh, t }
 *             the cluster's cruise reading (limit_src.hudCruiseOf of DisplayDataServer.functionalLibraryData, or its
 *             DisplayDataServer2 twin); kmh = the set speed the cluster shows. A notifier: it has no age unless
 *             feedMaxAge_ms > 0.
 *   egoKmh, egoT, egoAcc (m/s², optional)
 *   lead:     { valid, gap_m, vrel_mps (+ = the lead is faster), alead_mps2, fault, t }  the estimator's output; always
 *             present (valid false = no vehicle ahead), t = the time of the newest camera message behind it
 *   decision: { seq, t, wantKmh, why }   the controller's wanted set speed (tools/cruise-cmd/follow.js)
 *   offer:    true | false | null        a BMW offer (FASuS.displayForesight take-over suggestion) is shown; null = unknown
 *   pedals:   { brake, accel }           true / false / null (not mapped yet on the car: optional)
 *   keys:     { pressed }                a cruise key seen (no such source is known: optional)
 */

const SERVICE_ID = 13203;
const INSTANCE_ID = 1;
const SETTER_ID = 1;
const IFACE = 'de.bmw.dass.driverassistanceapplications.MultimodalControlDriverAssistance';
const FIELD = 'multimodalControlDriverAssistance';

/** The struct's members in the catalogue's order (MultimodalControlDriverAssistanceWrapper); each is one byte. */
const MEMBERS = ['mMControlADOnOff', 'mMControlADMode', 'mMControlADSetSpeedValue', 'mMControlADExtendedValue',
    'mMControlADSetSpeedType', 'mMControlNHARequest', 'mMControlSender', 'mMControlADConfigurationChange',
    'mMControlADRequestAdaptionSpeed', 'mMControlADRequestExtended'];

/** The catalogue's enums of the members (reference/car/2026-11-15/someip/someip-interfaces.json), for names and tests. */
const ENUMS = {
    mMControlADOnOff: { NO_CHANGE: 0, ON: 1, OFF: 2, COMPLETE_OFF: 3, RESUME: 4, CANCEL: 5, FUNKTIONSSCHNITTSTELLE_IST_NICHT_VERFUEGBAR: 13, FUNKTION_MELDET_FEHLER: 14, SIGNAL_UNBEFUELLT: 15 },
    mMControlADMode: { NO_CHANGE: 0, LAST_MODE: 1, MODE_1: 2, MODE_2: 3, MODE_3: 4, MODE_4: 5, MODE_5: 6, MODE_6: 7, MODE_7: 8, MODE_8: 9, FUNKTIONSSCHNITTSTELLE_IST_NICHT_VERFUEGBAR: 13, FUNKTION_MELDET_FEHLER: 14, SIGNAL_UNBEFUELLT: 15 },
    mMControlNHARequest: { NO_CHANGE: 0, ACTIVATE_PRE_NHA: 1, ACTIVATE_NHA: 2, CANCEL_PRE_NHA: 3, FUNKTIONSSCHNITTSTELLE_IST_NICHT_VERFUEGBAR: 13, FUNKTION_MELDET_FEHLER: 14, SIGNAL_UNBEFUELLT: 15 },
    mMControlSender: { UNKOWN: 0, SPEECH: 1, PROACTIVE_OFFER: 2, FUNKTIONSSCHNITTSTELLE_IST_NICHT_VERFUEGBAR: 13, FUNKTION_MELDET_FEHLER: 14, SIGNAL_UNBEFUELLT: 15 },
    mMControlADConfigurationChange: { NO_CHANGE: 0, CHANGE: 1, SIGNAL_UNBEFUELLT: 3 },
    mMControlADRequestAdaptionSpeed: { NO_CHANGE: 0, REQUEST_ADAPT_SPEED_SPEEDVALUE: 1, REQUEST_ADAPT_SPEED_CURRENTSPEED: 2, REQUEST_ADAPT_CURRENT_SLA_SUGGESTION: 3, REQUEST_UNDO_CURRENT_SLA_CHANGE: 4, FUNKTIONSSCHNITTSTELLE_IST_NICHT_VERFUEGBAR: 13, FUNKTION_MELDET_FEHLER: 14, SIGNAL_UNBEFUELLT: 15 },
    mMControlADRequestExtended: { NO_CHANGE: 0, REQUEST_AUTOMATED_FOLLOW_RESUME: 1, REQUEST_DRIVE_OFF: 2, REQUEST_OVERTAKE_ON_SLOW_LANE: 3, REQUEST_REACTION_ON_TRAFFICLIGHT: 4, REQUEST_CANCEL_REACTION_ON_TRAFFICLIGHT: 5, FUNKTIONSSCHNITTSTELLE_IST_NICHT_VERFUEGBAR: 13, FUNKTION_MELDET_FEHLER: 14, SIGNAL_UNBEFUELLT: 15 },
};

/**
 * The frozen members (G1, G3). The enums with a NO_CHANGE item carry it (0); the two plain UInt8 members that have no
 * "no change" item keep the catalogue's default (ExtendedValue 255, SetSpeedType 15 = "not filled"). The set-speed value
 * and the sender are the only members that vary, and the sender only by configuration.
 */
const FROZEN = Object.freeze({
    mMControlADOnOff: 0,                      // NO_CHANGE (never ON, OFF, COMPLETE_OFF, RESUME, CANCEL)
    mMControlADMode: 0,                       // NO_CHANGE (never a mode change)
    mMControlADExtendedValue: 255,            // the catalogue's default: nothing
    mMControlADSetSpeedType: 15,              // the catalogue's default: nothing (its meaning is unknown: never varied)
    mMControlNHARequest: 0,                   // NO_CHANGE (never an NHA request)
    mMControlADConfigurationChange: 0,        // NO_CHANGE (never a configuration change)
    mMControlADRequestAdaptionSpeed: 1,       // REQUEST_ADAPT_SPEED_SPEEDVALUE: "adapt to this value", the ONLY request
    mMControlADRequestExtended: 0,            // NO_CHANGE (never a RequestExtended)
});

/** The two senders a configuration may choose (CM-REPORT §1.2: PROACTIVE_OFFER by default, and why). */
const SENDERS = Object.freeze({ PROACTIVE_OFFER: 2, SPEECH: 1 });

/** Hard limits a configuration can never pass (G7, G5, G4). */
const HARD = Object.freeze({
    maxStepMax_kmh: 5,          // a request moves the set speed by at most 5 km/h
    minIntervalMin_ms: 3000,    // at most one request per 3 s
    floorMin_kmh: 40,           // never below 40 km/h
    minEgoMin_kmh: 40,          // never armed at or below 40 km/h
    watchdogTicksMax: 2,        // a decision older than 2 ticks stops everything
    ceilingMax_kmh: 250,        // a ceiling above this is refused (the UInt8 holds 0..254, 255 = not filled)
    rawMax: 254,
});

const DEFAULTS = Object.freeze({
    sender: 'PROACTIVE_OFFER',      // or 'SPEECH'; nothing else (CM-REPORT §1.2)
    valueUnit: 'kmh',               // ASSUMED: the scale of mMControlADSetSpeedValue is unknown (UInt8, CC §4.1)
    valueFactor: 1,                 // ASSUMED: raw = (kmh - valueOffset) / valueFactor, which must be a whole number
    valueOffset: 0,                 // ASSUMED
    valueAssumed: true,             // stays true until a moving rung shows the cluster taking the value as km/h
    maxStep_kmh: 5,                 // G7 (<= 5)
    minInterval_ms: 3000,           // G7 (>= 3000)
    floor_kmh: 40,                  // G7 (>= 40)
    driverMin_kmh: null,            // the driver's own minimum, if chosen (the floor is the larger of the two)
    minEgo_kmh: 40,                 // G4 (>= 40)
    tick_ms: 100,                   // the caller's tick (10 Hz)
    watchdogTicks: 2,               // G5 (<= 2)
    verifyWindow_ms: 2500,          // H3: the feed must show the requested value this soon (< minInterval_ms)
    egoMaxAge_ms: 500,              // G4: freshness of our speed
    leadMaxAge_ms: 1000,            // G4: freshness of the camera's vehicle-ahead message
    feedMaxAge_ms: 0,               // the feed is a notifier (no age); > 0 only if a periodic source is used
    armMinGap_ms: 500,              // G2: the second step at least this long after the first (no double tap)
    armWindow_ms: 5000,             // G2: and at most this long
    requireOfferSignal: true,       // H7: arm only when the BMW offer signal is known to be "none" (rung 2 maps it)
    overrideMargin_kmh: 3,          // G6: our speed above the ceiling by this = an accelerator override
    overrideAcc_mps2: 0.6,          // G6: accelerating this hard while above the set speed = an override
    tgMin_s: 1.0,                   // envelope: a vehicle ahead closer than this time gap (a close cut-in)
    tgFloor_s: 1.0,                 // envelope: the predicted time gap under the gated profile must stay above this
    d0_m: 2,                        // envelope: standstill margin in the prediction
    planTau_s: 2.0,                 // envelope, ASSUMED plant: the cruise's time constant
    planDead_s: 0.5,                // envelope, ASSUMED plant: set-speed change to response
    planAccMax_mps2: 1.5,           // envelope, ASSUMED plant: the cruise's strongest acceleration
    planDecMax_mps2: 0.7,           // envelope, ASSUMED plant: the cruise's strongest deceleration (lift-off level)
    planHorizon_s: 40,              // envelope: how far ahead the prediction runs
    planDt_s: 0.1,                  // envelope: its step
    leadBrakeHorizon_s: 3,          // envelope: a braking lead is assumed to keep braking this long, then hold its speed
    aLeadMax_mps2: 1.0,             // envelope: a lead braking harder than this (its smoothed estimate) ...
    aLeadPersist_ms: 500,           // ... for this long without a break (one noisy sample is not a braking lead)
    aLeadTau_ms: 500,               // the smoothing of the lead's acceleration (first order) used by the envelope
    aLeadDead_mps2: 0.3,            // and below this the prediction takes the lead as holding its speed
    aLeadSettle_ms: 2000,           // the lead's acceleration counts only after the lead has been tracked this long
                                    // (a camera (re)acquiring a vehicle at long range gives a transient of 1-2 m/s²)
    floorMargin_kmh: 3,             // envelope: a lead slower than floor + this while we close on it
    closingMin_mps: 0.3,            // envelope: below this closing speed (and no braking lead) the prediction is idle
});

/** Every reason a decision can carry (G8). */
const REASONS = Object.freeze([
    // disarmed or refused
    'START', 'DRIVER_OFF', 'ARM_TIMEOUT', 'ARM_TOO_FAST', 'ARM_NO_STEP1', 'LOCKED_FOR_DRIVE', 'CONFIG_INVALID',
    'INTERNAL_ERROR', 'WATCHDOG', 'STALE_INPUT', 'NO_FEED', 'NOT_DCC', 'LIMITER_ACTIVE', 'CRUISE_NOT_ACTIVE', 'SET_UNKNOWN',
    'CEILING_AT_FLOOR', 'CEILING_TOO_HIGH', 'OFFER_SHOWN', 'OFFER_UNKNOWN', 'BRAKE', 'ACCEL_OVERRIDE', 'OVERRIDE_INFERRED',
    'CRUISE_KEY', 'DRIVER_SET_CHANGE', 'VALUE_MISMATCH', 'NO_EFFECT', 'REFUSED', 'SPEED_LOW', 'SENSOR_FAULT',
    'ENVELOPE_GAP', 'ENVELOPE_CLOSING', 'ENVELOPE_LEAD_BRAKING', 'ENVELOPE_FLOOR',
    // arming and running
    'ARM_STEP1', 'ARMED', 'VERIFIED', 'LOWER_FOR_LEAD', 'RAISE_TOWARD_CEILING', 'HOLD_AT_TARGET', 'HOLD_RATE', 'HOLD_VERIFY',
    'HOLD_FLOOR', 'HOLD_NO_WANT', 'HOLD_NO_LEAD',
]);

/** The reasons that lock the module for the rest of the drive (G6, H3, G5, faults). */
const LOCKING = Object.freeze(['CONFIG_INVALID', 'INTERNAL_ERROR', 'WATCHDOG', 'STALE_INPUT', 'NO_FEED', 'NOT_DCC',
    'LIMITER_ACTIVE', 'CRUISE_NOT_ACTIVE', 'SET_UNKNOWN', 'BRAKE', 'ACCEL_OVERRIDE', 'OVERRIDE_INFERRED', 'CRUISE_KEY',
    'DRIVER_SET_CHANGE', 'VALUE_MISMATCH', 'NO_EFFECT', 'REFUSED']);

const MODES = Object.freeze(['DISARMED', 'ARMING', 'HOLDING', 'ADJUSTING']);

const isNum = (x) => typeof x === 'number' && isFinite(x);
const isInt = (x) => isNum(x) && Math.floor(x) === x;
const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

function forbid(what) {
    const e = new Error('CM_FORBIDDEN ' + what);
    e.code = 'CM_FORBIDDEN';
    throw e;
}

/* ---------------------------------------------------------------- configuration ----------------------------------- */

/** cfg -> { ok, cfg (the defaults merged), errors: [text] }. Never throws. */
function validateConfig(cfgIn) {
    const errors = [];
    const c = {};
    Object.keys(DEFAULTS).forEach((k) => { c[k] = DEFAULTS[k]; });
    if (cfgIn !== undefined && cfgIn !== null) {
        if (typeof cfgIn !== 'object') errors.push('cfg not an object');
        else Object.keys(cfgIn).forEach((k) => {
            if (!own(DEFAULTS, k)) errors.push('unknown key ' + k);
            else c[k] = cfgIn[k];
        });
    }
    const num = (k, lo, hi) => { if (!isNum(c[k]) || c[k] < lo || c[k] > hi) errors.push(k + ' out of [' + lo + ', ' + hi + ']'); };
    if (!own(SENDERS, c.sender)) errors.push('sender must be PROACTIVE_OFFER or SPEECH');
    if (c.valueUnit !== 'kmh') errors.push('valueUnit must be kmh');
    num('valueFactor', 0.1, 10);
    num('valueOffset', -100, 100);
    if (c.valueAssumed !== true && c.valueAssumed !== false) errors.push('valueAssumed must be a boolean');
    num('maxStep_kmh', 1, HARD.maxStepMax_kmh);
    if (!isInt(c.maxStep_kmh)) errors.push('maxStep_kmh must be whole');
    num('minInterval_ms', HARD.minIntervalMin_ms, 600000);
    num('floor_kmh', HARD.floorMin_kmh, HARD.ceilingMax_kmh);
    if (c.driverMin_kmh !== null) num('driverMin_kmh', HARD.floorMin_kmh, HARD.ceilingMax_kmh);
    num('minEgo_kmh', HARD.minEgoMin_kmh, HARD.ceilingMax_kmh);
    num('tick_ms', 20, 1000);
    num('watchdogTicks', 1, HARD.watchdogTicksMax);
    if (!isInt(c.watchdogTicks)) errors.push('watchdogTicks must be whole');
    num('verifyWindow_ms', 200, 60000);
    if (isNum(c.verifyWindow_ms) && isNum(c.minInterval_ms) && c.verifyWindow_ms >= c.minInterval_ms) errors.push('verifyWindow_ms must be below minInterval_ms');
    num('egoMaxAge_ms', 50, 2000);
    num('leadMaxAge_ms', 50, 3000);
    num('feedMaxAge_ms', 0, 600000);
    num('armMinGap_ms', 200, 5000);
    num('armWindow_ms', 1000, 30000);
    if (isNum(c.armMinGap_ms) && isNum(c.armWindow_ms) && c.armMinGap_ms >= c.armWindow_ms) errors.push('armMinGap_ms must be below armWindow_ms');
    if (c.requireOfferSignal !== true && c.requireOfferSignal !== false) errors.push('requireOfferSignal must be a boolean');
    num('overrideMargin_kmh', 0, 20);
    num('overrideAcc_mps2', 0.1, 5);
    num('tgMin_s', 0.5, 5);
    num('tgFloor_s', 0.3, 5);
    num('d0_m', 0, 20);
    num('planTau_s', 0.2, 10);
    num('planDead_s', 0, 5);
    num('planAccMax_mps2', 0.1, 5);
    num('planDecMax_mps2', 0.05, 5);
    num('planHorizon_s', 5, 120);
    num('planDt_s', 0.02, 0.5);
    num('leadBrakeHorizon_s', 0, 30);
    num('aLeadMax_mps2', 0.1, 10);
    num('aLeadPersist_ms', 0, 5000);
    num('aLeadTau_ms', 0, 5000);
    num('aLeadDead_mps2', 0, 3);
    num('aLeadSettle_ms', 0, 10000);
    num('floorMargin_kmh', 0, 30);
    num('closingMin_mps', 0, 5);
    return { ok: errors.length === 0, cfg: c, errors: errors };
}

/* ---------------------------------------------------------------- the payload ------------------------------------- */

/** km/h -> the UInt8 the request carries; throws unless the configured scale maps it to a whole 0..254 exactly. */
function toRaw(kmh, cfg) {
    const raw = (kmh - cfg.valueOffset) / cfg.valueFactor;
    const r = Math.round(raw);
    if (Math.abs(raw - r) > 1e-9) forbid('value ' + kmh + ' km/h is not a whole raw step at factor ' + cfg.valueFactor);
    if (r < 0 || r > HARD.rawMax) forbid('raw value ' + r + ' outside 0..' + HARD.rawMax);
    if (Math.abs(r * cfg.valueFactor + cfg.valueOffset - kmh) > 1e-9) forbid('value does not round-trip');
    return r;
}
/** The UInt8 -> km/h under a configuration (the stub uses its own scale, which may differ). */
function fromRaw(raw, cfg) { return raw * cfg.valueFactor + cfg.valueOffset; }

/** The struct -> its 10 bytes in the catalogue's member order (each member is one byte wide). Throws on a bad struct. */
function encode(struct) {
    if (!struct || typeof struct !== 'object') forbid('struct missing');
    const keys = Object.keys(struct);
    if (keys.length !== MEMBERS.length) forbid('struct has ' + keys.length + ' members');
    return MEMBERS.map((m) => {
        if (!own(struct, m)) forbid('member missing ' + m);
        const v = struct[m];
        if (!isInt(v) || v < 0 || v > 255) forbid('member ' + m + ' not a byte');
        return v;
    });
}
/** 10 bytes -> the struct. Throws on a malformed payload. */
function decode(bytes) {
    if (!bytes || typeof bytes.length !== 'number' || bytes.length !== MEMBERS.length) forbid('payload length');
    const s = {};
    MEMBERS.forEach((m, i) => {
        const v = bytes[i];
        if (!isInt(v) || v < 0 || v > 255) forbid('payload byte ' + i);
        s[m] = v;
    });
    return s;
}

/**
 * Throws unless `struct` is the frozen shape: exactly the ten members, every frozen member at its frozen value, the sender
 * the configured one of the two allowed, the value a whole 0..254. This is G1 + G3 as code.
 */
function assertFrozenShape(struct, cfg) {
    const c = cfg && cfg.sender ? cfg : DEFAULTS;
    if (!struct || typeof struct !== 'object') forbid('struct missing');
    const keys = Object.keys(struct);
    if (keys.length !== MEMBERS.length) forbid('member count ' + keys.length);
    keys.forEach((k) => { if (MEMBERS.indexOf(k) < 0) forbid('unknown member ' + k); });
    Object.keys(FROZEN).forEach((k) => {
        if (struct[k] !== FROZEN[k]) forbid(k + '=' + struct[k] + ' (only ' + FROZEN[k] + ' may leave)');
    });
    if (!own(SENDERS, c.sender)) forbid('sender ' + c.sender);
    if (struct.mMControlSender !== SENDERS[c.sender]) forbid('mMControlSender=' + struct.mMControlSender);
    const v = struct.mMControlADSetSpeedValue;
    if (!isInt(v) || v < 0 || v > HARD.rawMax) forbid('mMControlADSetSpeedValue=' + v);
    return true;
}

/** A member's value as its enum name, or the number. */
function nameOf(member, value) {
    const e = ENUMS[member];
    if (e) { const ks = Object.keys(e); for (let i = 0; i < ks.length; i++) if (e[ks[i]] === value) return ks[i]; }
    return value;
}

/**
 * Builds the one request that may leave (G1, G3, G7, H1). lim = { ceilingKmh, currentKmh, floorKmh }: the driver's set
 * speed at arming, the set speed the feed shows now, the floor. THROWS (CM_FORBIDDEN) on anything else:
 *   - kmh not whole, below the floor (or below 40), above the ceiling, the ceiling above 250;
 *   - a step larger than maxStep_kmh (or 5) from the current set speed, or no step at all;
 *   - a configuration outside its hard limits; a value the scale cannot carry exactly.
 * Returns a frozen object: { kind, service, instance, iface, field, setterId, seq, kmh, value (the struct), bytes, names }.
 */
function buildRequest(kmh, lim, cfgIn, seq) {
    const v = validateConfig(cfgIn);
    if (!v.ok) forbid('config: ' + v.errors.join('; '));
    const cfg = v.cfg;
    if (!lim || typeof lim !== 'object') forbid('limits missing');
    const ceil = lim.ceilingKmh, cur = lim.currentKmh, flo = lim.floorKmh;
    if (!isInt(kmh)) forbid('value ' + kmh + ' not whole km/h');
    if (!isInt(ceil) || ceil > HARD.ceilingMax_kmh) forbid('ceiling ' + ceil);
    if (!isInt(cur)) forbid('current ' + cur);
    if (!isNum(flo) || flo < HARD.floorMin_kmh || flo < cfg.floor_kmh) forbid('floor ' + flo);
    if (kmh > ceil) forbid('value ' + kmh + ' above the ceiling ' + ceil);
    if (kmh < flo || kmh < HARD.floorMin_kmh) forbid('value ' + kmh + ' below the floor ' + flo);
    const step = Math.abs(kmh - cur);
    if (step === 0) forbid('no change');
    if (step > cfg.maxStep_kmh || step > HARD.maxStepMax_kmh) forbid('step ' + step + ' km/h');
    const struct = {
        mMControlADOnOff: FROZEN.mMControlADOnOff,
        mMControlADMode: FROZEN.mMControlADMode,
        mMControlADSetSpeedValue: toRaw(kmh, cfg),
        mMControlADExtendedValue: FROZEN.mMControlADExtendedValue,
        mMControlADSetSpeedType: FROZEN.mMControlADSetSpeedType,
        mMControlNHARequest: FROZEN.mMControlNHARequest,
        mMControlSender: SENDERS[cfg.sender],
        mMControlADConfigurationChange: FROZEN.mMControlADConfigurationChange,
        mMControlADRequestAdaptionSpeed: FROZEN.mMControlADRequestAdaptionSpeed,
        mMControlADRequestExtended: FROZEN.mMControlADRequestExtended,
    };
    assertFrozenShape(struct, cfg);           // the builder checks its own output: a bug here cannot leak another shape
    const bytes = encode(struct);
    const names = {};
    MEMBERS.forEach((m) => { names[m] = nameOf(m, struct[m]); });
    return Object.freeze({
        kind: 'CM_SET_SPEED', service: SERVICE_ID, instance: INSTANCE_ID, iface: IFACE, field: FIELD, setterId: SETTER_ID,
        seq: isInt(seq) ? seq : 0, kmh: kmh, value: Object.freeze(struct), bytes: Object.freeze(bytes), names: Object.freeze(names),
    });
}

/* ---------------------------------------------------------------- the module -------------------------------------- */

const r1 = (x) => (isNum(x) ? Math.round(x * 10) / 10 : '-');
const ri = (x) => (isNum(x) ? Math.round(x) : '-');

function create(cfgIn) {
    let cfg;
    let bad = false;
    try {
        const v = validateConfig(cfgIn);
        cfg = v.cfg;
        bad = !v.ok;
    } catch (e) { cfg = validateConfig(null).cfg; bad = true; }
    const floorKmh = Math.max(cfg.floor_kmh, HARD.floorMin_kmh, isNum(cfg.driverMin_kmh) ? cfg.driverMin_kmh : 0);

    const S = {
        mode: 'DISARMED', reason: bad ? 'CONFIG_INVALID' : 'START', locked: bad,
        armStepAt: null, ceiling: null, current: null, want: null,
        pending: null,                 // { seq, kmh, from, at }
        lastSendAt: null, seq: 0, sent: [],
        decSeq: null, decSame: 0,
        alF: null, alT: null, alBelowSince: null,   // the smoothed lead acceleration, and since when it is below -aLeadMax
        leadSince: null,                            // since when the vehicle ahead has been tracked without a break
        requests: 0, verified: 0, armedAt: null, disarmedAt: null,
        lastLogKey: '', last: null,    // the last inputs' summary for the log
    };

    function view() {
        return {
            armed: S.mode === 'HOLDING' || S.mode === 'ADJUSTING', mode: S.mode, reason: S.reason, locked: S.locked,
            setKmh: S.current, ceilingKmh: S.ceiling, floorKmh: floorKmh, wantKmh: S.want,
            pendingKmh: S.pending ? S.pending.kmh : null, requests: S.requests, verified: S.verified,
            sender: cfg.sender, valueAssumed: cfg.valueAssumed,
        };
    }

    function logLine(now, reqKmh) {
        const L = S.last || {};
        return 'cm t=' + ri(now) + ' mode=' + S.mode + ' why=' + S.reason + ' lock=' + (S.locked ? 1 : 0) +
            ' set=' + ri(S.current) + ' ceil=' + ri(S.ceiling) + ' floor=' + ri(floorKmh) + ' want=' + ri(S.want) +
            ' req=' + ri(reqKmh) + ' pend=' + ri(S.pending ? S.pending.kmh : null) + ' v=' + r1(L.v) + ' gap=' + r1(L.gap) +
            ' vrel=' + r1(L.vrel) + ' tg=' + r1(L.tg) + ' n=' + S.requests;
    }
    function out(now, request) {
        const key = S.mode + '/' + S.reason + '/' + S.locked + '/' + (request ? request.kmh : '');
        const log = key !== S.lastLogKey || request ? logLine(now, request ? request.kmh : null) : null;
        S.lastLogKey = key;
        return { request: request || null, view: view(), log: log };
    }

    function disarm(now, reason) {
        S.mode = 'DISARMED';
        S.reason = reason;
        if (LOCKING.indexOf(reason) >= 0) S.locked = true;
        S.pending = null;                // a request in flight may still land: it is at or below the ceiling (H1)
        S.armStepAt = null;
        S.disarmedAt = isNum(now) ? now : S.disarmedAt;
    }

    /** The conditions every armed tick (and the arming) needs: null, or the reason they fail (G4, G6, H6, H7, envelope). */
    function conditions(now, inp, arming) {
        const feed = inp.feed;
        const p = inp.pedals, k = inp.keys;
        if (p && p.brake === true) return 'BRAKE';
        if (p && p.accel === true) return 'ACCEL_OVERRIDE';
        if (k && k.pressed === true) return 'CRUISE_KEY';
        if (!feed || typeof feed !== 'object') return 'NO_FEED';
        if (cfg.feedMaxAge_ms > 0 && !(isNum(feed.t) && now - feed.t <= cfg.feedMaxAge_ms)) return 'STALE_INPUT';
        if (feed.kind === 'limiter') return 'LIMITER_ACTIVE';
        if (feed.kind !== 'cruise') return 'NOT_DCC';
        if (feed.status === 'override') return 'ACCEL_OVERRIDE';
        if (feed.status !== 'active') return 'CRUISE_NOT_ACTIVE';
        if (!isInt(feed.kmh)) return 'SET_UNKNOWN';
        if (!isNum(inp.egoKmh) || !isNum(inp.egoT) || now - inp.egoT > cfg.egoMaxAge_ms || inp.egoT > now + 1) return 'STALE_INPUT';
        const lead = inp.lead;
        if (!lead || typeof lead !== 'object' || !isNum(lead.t) || now - lead.t > cfg.leadMaxAge_ms || lead.t > now + 1) return 'STALE_INPUT';
        // the accelerator, inferred: above the driver's own set speed, or pulling away above the set speed
        const ceil = arming ? feed.kmh : S.ceiling;
        if (inp.egoKmh > ceil + cfg.overrideMargin_kmh) return 'OVERRIDE_INFERRED';
        if (!arming && isNum(inp.egoAcc) && inp.egoAcc > cfg.overrideAcc_mps2 && inp.egoKmh > S.current + 1) return 'OVERRIDE_INFERRED';
        if (inp.egoKmh <= cfg.minEgo_kmh) return 'SPEED_LOW';
        if (inp.offer === true) return 'OFFER_SHOWN';
        if (inp.offer !== false && cfg.requireOfferSignal) return 'OFFER_UNKNOWN';
        if (lead.fault === true) return 'SENSOR_FAULT';
        const setNow = arming ? feed.kmh : (S.pending ? S.pending.kmh : S.current);
        const nextSlot = arming || S.lastSendAt === null ? 0 : Math.max(0, (S.lastSendAt + cfg.minInterval_ms - now) / 1000);
        return envelope(now, inp, setNow, nextSlot);
    }

    /**
     * The cases the gates cannot handle (CM-REPORT §3): null, or an ENVELOPE_* reason. The closing check runs the gated
     * command profile forward (predict()): if even the module's fastest legal descent cannot keep the time gap above
     * tgFloor_s, the module disarms now and says so, instead of promising what it cannot do.
     */
    function envelope(now, inp, setKmh, nextSlot) {
        const lead = inp.lead;
        if (!lead.valid) return null;
        const v = inp.egoKmh / 3.6;
        const gap = lead.gap_m, vrel = lead.vrel_mps;
        if (!isNum(gap) || !isNum(vrel)) return 'STALE_INPUT';
        const tg = v > 0.5 ? gap / v : Infinity;
        if (tg < cfg.tgMin_s) return 'ENVELOPE_GAP';
        const al = S.alF === null ? 0 : (S.alF < -cfg.aLeadDead_mps2 ? S.alF : 0);
        if (S.alBelowSince !== null && now - S.alBelowSince >= cfg.aLeadPersist_ms) return 'ENVELOPE_LEAD_BRAKING';
        const closing = Math.max(0, -vrel);
        const vleadKmh = (v + vrel) * 3.6;
        if (closing > cfg.closingMin_mps && vleadKmh < floorKmh + cfg.floorMargin_kmh) return 'ENVELOPE_FLOOR';
        const heading = isNum(setKmh) ? setKmh / 3.6 - (v + vrel) : 0;      // the cruise heads for the set speed
        if (closing > cfg.closingMin_mps || heading > cfg.closingMin_mps || al < -0.1) {
            const p = predict(v, gap, v + vrel, al, setKmh, nextSlot);
            if (p < cfg.tgFloor_s) return 'ENVELOPE_CLOSING';
        }
        return null;
    }

    /**
     * The smallest time gap ((gap - d0) / v) over the next planHorizon_s if the module lowers the set speed as fast as the
     * gates allow (maxStep_kmh at every slot, the first slot `nextSlot` s from now) toward the lead's speed (not below the
     * floor), the cruise follows its set speed as an ASSUMED first-order plant, and the lead keeps its deceleration for
     * leadBrakeHorizon_s, then holds its speed. Pure arithmetic; at most planHorizon_s / planDt_s steps.
     */
    function predict(v0, gap0, vl0, al, setKmh, nextSlot) {
        const dt = cfg.planDt_s;
        const n = Math.ceil(cfg.planHorizon_s / dt);
        const step = cfg.maxStep_kmh, every = cfg.minInterval_ms / 1000;
        let v = v0, gap = gap0, vl = vl0;
        let set = isNum(setKmh) ? setKmh : v0 * 3.6;
        let slot = Math.max(0, nextSlot);
        const eff = [];                                  // [time it takes effect, value m/s]
        let setEff = set / 3.6;
        let minTg = Infinity;
        for (let k = 0; k <= n; k++) {
            const t = k * dt;
            if (t >= slot - 1e-9) {
                const target = Math.max(Math.ceil(floorKmh - 1e-9), Math.floor(vl * 3.6));
                if (set > target) { set = Math.max(target, set - step); eff.push([t + cfg.planDead_s, set / 3.6]); }
                slot += every;
            }
            while (eff.length && eff[0][0] <= t + 1e-9) setEff = eff.shift()[1];
            const a = Math.max(-cfg.planDecMax_mps2, Math.min(cfg.planAccMax_mps2, (setEff - v) / cfg.planTau_s));
            const tgNow = v > 0.5 ? (gap - cfg.d0_m) / v : Infinity;
            if (tgNow < minTg) minTg = tgNow;
            if (k > 0 && v <= vl + 0.05 && setEff <= vl + 0.1 && !eff.length && (t >= cfg.leadBrakeHorizon_s || al >= 0)) break;
            v = Math.max(0, v + a * dt);
            if (t < cfg.leadBrakeHorizon_s && al < 0) vl = Math.max(0, vl + al * dt);
            gap += (vl - v) * dt;
            if (gap <= 0) return 0;
        }
        return minTg;
    }

    /**
     * The lead's acceleration, smoothed (first order, aLeadTau_ms), counted only once the lead has been tracked for
     * aLeadSettle_ms, and how long it has been below -aLeadMax.
     */
    function trackLead(now, lead) {
        const ok = lead && lead.valid && isNum(lead.alead_mps2) && isNum(now);
        if (!ok) { S.alF = null; S.alT = null; S.alBelowSince = null; S.leadSince = null; return; }
        if (S.leadSince === null) S.leadSince = now;
        if (now - S.leadSince < cfg.aLeadSettle_ms) { S.alF = null; S.alT = now; S.alBelowSince = null; return; }
        if (S.alF === null || S.alT === null || now <= S.alT) S.alF = lead.alead_mps2;
        else {
            const k = cfg.aLeadTau_ms > 0 ? 1 - Math.exp(-(now - S.alT) / cfg.aLeadTau_ms) : 1;
            S.alF += k * (lead.alead_mps2 - S.alF);
        }
        S.alT = now;
        if (S.alF < -cfg.aLeadMax_mps2) { if (S.alBelowSince === null) S.alBelowSince = now; }
        else S.alBelowSince = null;
    }

    function noteInputs(inp) {
        const lead = inp && inp.lead;
        const v = inp && isNum(inp.egoKmh) ? inp.egoKmh : null;
        const valid = lead && lead.valid && isNum(lead.gap_m);
        S.last = { v: v, gap: valid ? lead.gap_m : null, vrel: valid ? lead.vrel_mps : null,
            tg: valid && v > 2 ? lead.gap_m / (v / 3.6) : null };
    }

    function armStep(now) {
        try {
            if (S.locked) { S.reason = S.reason === 'CONFIG_INVALID' ? 'CONFIG_INVALID' : 'LOCKED_FOR_DRIVE'; return view(); }
            if (S.mode !== 'DISARMED') return view();
            if (!isNum(now)) return view();
            S.mode = 'ARMING'; S.reason = 'ARM_STEP1'; S.armStepAt = now;
        } catch (e) { disarm(now, 'INTERNAL_ERROR'); }
        return view();
    }

    function armConfirm(now, inp) {
        try {
            if (S.locked) { S.reason = S.reason === 'CONFIG_INVALID' ? 'CONFIG_INVALID' : 'LOCKED_FOR_DRIVE'; return view(); }
            if (S.mode !== 'ARMING' || !isNum(S.armStepAt) || !isNum(now)) {
                if (S.mode === 'DISARMED') S.reason = 'ARM_NO_STEP1';
                return view();
            }
            const dt = now - S.armStepAt;
            if (dt < cfg.armMinGap_ms) { disarm(now, 'ARM_TOO_FAST'); return view(); }
            if (dt > cfg.armWindow_ms) { disarm(now, 'ARM_TIMEOUT'); return view(); }
            const i = inp || {};
            noteInputs(i);
            trackLead(now, i.lead);
            const why = conditions(now, i, true);
            if (why) { S.mode = 'DISARMED'; S.reason = why; S.armStepAt = null; return view(); }   // a refused arming does not lock
            const ceil = i.feed.kmh;
            if (ceil > HARD.ceilingMax_kmh) { disarm(now, 'CEILING_TOO_HIGH'); return view(); }
            if (ceil <= floorKmh) { disarm(now, 'CEILING_AT_FLOOR'); return view(); }
            S.ceiling = ceil; S.current = ceil; S.want = ceil; S.pending = null;
            S.decSeq = i.decision && isNum(i.decision.seq) ? i.decision.seq : null; S.decSame = 0;
            S.mode = 'HOLDING'; S.reason = 'ARMED'; S.armedAt = now; S.armStepAt = null;
        } catch (e) { disarm(now, 'INTERNAL_ERROR'); }
        return view();
    }

    function stepInner(now, inp) {
        if (!isNum(now)) { disarm(now, 'INTERNAL_ERROR'); return out(now, null); }
        const i = inp || {};
        noteInputs(i);
        trackLead(now, i.lead);
        if (S.mode === 'DISARMED') return out(now, null);
        if (S.mode === 'ARMING') {
            if (now - S.armStepAt > cfg.armWindow_ms) disarm(now, 'ARM_TIMEOUT');
            return out(now, null);
        }
        // G5: the watchdog
        const d = i.decision;
        if (!d || !isNum(d.seq) || !isNum(d.t)) { disarm(now, 'WATCHDOG'); return out(now, null); }
        if (d.seq === S.decSeq) S.decSame++; else { S.decSame = 0; S.decSeq = d.seq; }
        if (S.decSame >= cfg.watchdogTicks || now - d.t > cfg.watchdogTicks * cfg.tick_ms || d.t > now + 1) { disarm(now, 'WATCHDOG'); return out(now, null); }
        // H3 and G6: is the set speed the feed shows ours?
        const feed = i.feed;
        if (feed && feed.kind === 'cruise' && feed.status === 'active' && isInt(feed.kmh)) {
            if (S.pending) {
                if (feed.kmh === S.pending.kmh) { S.current = feed.kmh; S.pending = null; S.verified++; S.reason = 'VERIFIED'; S.mode = 'HOLDING'; }
                else if (feed.kmh !== S.current) { disarm(now, 'VALUE_MISMATCH'); return out(now, null); }
                else if (now - S.pending.sentAt > cfg.verifyWindow_ms) { disarm(now, 'NO_EFFECT'); return out(now, null); }
            } else if (feed.kmh !== S.current) { disarm(now, 'DRIVER_SET_CHANGE'); return out(now, null); }
        }
        // G4, G6, H6, H7 and the envelope
        const why = conditions(now, i, false);
        if (why) { disarm(now, why); return out(now, null); }
        // G7: what to send
        if (S.pending) { S.mode = 'ADJUSTING'; S.reason = 'HOLD_VERIFY'; return out(now, null); }
        S.mode = 'HOLDING';
        if (!(i.lead && i.lead.valid)) { S.want = S.current; S.reason = 'HOLD_NO_LEAD'; return out(now, null); }
        if (!isNum(d.wantKmh)) { S.want = null; S.reason = 'HOLD_NO_WANT'; return out(now, null); }
        let target = Math.floor(d.wantKmh + 1e-9);
        let clamped = null;
        if (target > S.ceiling) target = S.ceiling;
        if (target < floorKmh) { target = Math.ceil(floorKmh - 1e-9); clamped = 'HOLD_FLOOR'; }
        S.want = target;
        const delta = target - S.current;
        if (delta === 0) { S.reason = clamped || 'HOLD_AT_TARGET'; return out(now, null); }
        if (S.lastSendAt !== null && now - S.lastSendAt < cfg.minInterval_ms) { S.reason = 'HOLD_RATE'; return out(now, null); }
        const step = delta > 0 ? Math.min(delta, cfg.maxStep_kmh) : -Math.min(-delta, cfg.maxStep_kmh);
        const next = S.current + step;
        S.seq++;
        const req = buildRequest(next, { ceilingKmh: S.ceiling, currentKmh: S.current, floorKmh: floorKmh }, cfg, S.seq);
        S.pending = { seq: S.seq, kmh: next, from: S.current, sentAt: now };
        S.sent.push(S.seq);
        if (S.sent.length > 64) S.sent.shift();
        S.lastSendAt = now;
        S.requests++;
        S.mode = 'ADJUSTING';
        S.reason = step < 0 ? 'LOWER_FOR_LEAD' : 'RAISE_TOWARD_CEILING';
        return out(now, req);
    }

    function step(now, inp) {
        try { return stepInner(now, inp); } catch (e) {
            try { disarm(now, 'INTERNAL_ERROR'); return out(now, null); } catch (e2) {
                return { request: null, view: { armed: false, mode: 'DISARMED', reason: 'INTERNAL_ERROR', locked: true }, log: null };
            }
        }
    }

    function onResult(now, seq, ok, code) {
        try {
            if (ok === true) return view();
            if (S.sent.indexOf(seq) < 0) return view();          // not ours (or too old): nothing to do
            if (S.mode !== 'DISARMED' || !S.locked) disarm(now, 'REFUSED');
            else S.locked = true;
        } catch (e) { S.mode = 'DISARMED'; S.reason = 'INTERNAL_ERROR'; S.locked = true; }
        return view();
    }

    function driverOff(now) {
        try { if (S.mode !== 'DISARMED') disarm(now, 'DRIVER_OFF'); } catch (e) { S.mode = 'DISARMED'; S.reason = 'INTERNAL_ERROR'; S.locked = true; }
        return view();
    }

    return { armStep: armStep, armConfirm: armConfirm, disarm: driverOff, step: step, onResult: onResult, view: view, config: () => Object.assign({}, cfg) };
}

module.exports = {
    create, buildRequest, assertFrozenShape, encode, decode, validateConfig, toRaw, fromRaw, nameOf,
    SERVICE_ID, INSTANCE_ID, SETTER_ID, IFACE, FIELD, MEMBERS, ENUMS, FROZEN, SENDERS, HARD, DEFAULTS, REASONS, LOCKING, MODES,
};
