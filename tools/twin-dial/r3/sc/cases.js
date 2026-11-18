'use strict';
/**
 * cases.js - SC: the message cases for the centre (tab 2), each with its ground truth per step: what BMW shows after the
 * step's signals (null = nothing, or the message's id). Three families:
 *   V   round 2's VG 5.4 cases 1-9, re-written for the centre;
 *   A, S  research3/MC's hang and safety cases (tools/research3/mc/cases.js), same events, the truth made explicit;
 *   C   the centre's own: the tab, the driver leaving, auto rules, rows, rebuild, night, counter, latches.
 * Events (each is its own turn of the engine, as a car notification is):
 *   L(...entries) ccList | A(n) shown-now | AD() shown-now = the catalogue default 65535 | D(n) second witness |
 *   F(n, of, ids) the frame field | DRV(t) the driver picks tab t | AUTO(t) SB's automatic tab (guidance -> 5) |
 *   REB() rebuild | NIGHT(b) | REFUSE() the tab-2 sheet refused | THROW() the next paint throws | BAD() an unfit list
 * W(ms) holds the step that long (default 1000 ms). Sample names are invented (card.json samples_for_mockups).
 */
const REST = { id: 0, color: 'green', name: 'Усе гаразд' };
const DOOR = { id: 15, color: 'white', name: 'Двері відчинено' };
const BOOT = { id: 19, color: 'white', name: 'Багажник відчинено' };
const TYRE = { id: 50, color: 'yellow', name: 'Тиск у шинах: перевірте' };
const BRAKE = { id: 42, color: 'red', name: 'Гальма: зупиніться в безпечному місці' };
const WASH = { id: 164, color: 'white', name: 'Мало рідини омивача' };
const LONGW = { id: 41, color: 'white', name: 'Потрібне сервісне обслуговування найближчим часом' };   // a row cuts it
const STORED = { id: 987, color: 'white', name: 'Готовність до руху: пристебніться' };
const STORED_RED = { id: 52, color: 'red', name: 'Гальмо стоянки: несправність' };
const GREEK = { id: 17, color: 'white', name: 'Πόρτα ανοιχτή' };
const NONAME = { id: 16, color: 'red', name: '' };

const L = function () { return ['list', Array.prototype.slice.call(arguments)]; };
const A = (n) => ['active', n];
const AD = () => ['active', 65535];
const D = (n) => ['displayed', n];
const F = (n, of, ids) => ['frame', { n, of, ids: ids || [] }];
const W = (ms) => ['wait', ms];
const DRV = (t) => ['driver', t];
const AUTO = (t) => ['auto', t];
const REB = () => ['rebuild'];
const NIGHT = (b) => ['night', b];
const REFUSE = () => ['refuse'];
const THROW = () => ['throw'];
const BAD = () => ['listRaw', null];
const N = null;

// the D7 latch falls on the first matched message (it stays BMW's to its end): most C* cases start with it
const CONFIRM = [[N, L(REST), A(0)], [15, L(REST, DOOR), A(15)], [N, L(REST), A(0)]];

const CASES = [
    // ---- round 2's VG 5.4 cases, in the centre --------------------------------------------------------------------------
    { id: 'V1', what: 'blind start: nothing read; window open, rows aside, no card', steps: [[N, W(2000)]] },
    { id: 'V2', what: 'ccList fits, the shown-now field never speaks: D7 keeps every message BMW\'s (window), list rows only', steps: [[N, L(REST)], [15, L(REST, DOOR), W(5000)], [N, L(REST)]] },
    { id: 'V3', what: 'the first matched message stays BMW\'s; the next one: tab 2, card, window shut 150 ms after the card', steps: CONFIRM.concat([[15, L(REST, DOOR), A(15), W(3000)], [N, L(REST), A(0)]]) },
    { id: 'V4', what: 'no entry, empty name, a Greek name, a throw: window, latched while the message stays', steps: CONFIRM.concat([[99, A(99)], [N, A(0)], [16, L(REST, NONAME), A(16)], [N, L(REST), A(0)], [17, L(REST, GREEK), A(17), W(2000)], [N, L(REST), A(0)], [15, THROW(), L(REST, DOOR), A(15), W(2000)], [N, L(REST), A(0)], [15, L(REST, DOOR), A(15)], [N, L(REST), A(0)]]) },
    { id: 'V5', what: 'N -> M without 0 between: window at once, the card says M, shut after M settles', steps: CONFIRM.concat([[15, L(REST, DOOR), A(15)], [50, L(REST, DOOR, TYRE), A(50), W(2000)], [N, L(REST), A(0)]]) },
    { id: 'V6', what: 'the end: card gone, window shut, rows back, the tab returns', steps: CONFIRM.concat([[15, L(REST, DOOR), A(15)], [N, L(REST), A(0), W(2000)]]) },
    { id: 'V7', what: 'the second witness disagrees -> window; the tab-2 sheet refused -> window for every message until a rebuild', steps: CONFIRM.concat([[15, L(REST, DOOR), A(15), D(15)], [15, D(19)], [15, D(15)], [15, REFUSE(), W(2000)], [N, L(REST), A(0), D(0)], [15, L(REST, DOOR), A(15), D(15), W(2000)], [15, REB(), W(2000)], [N, L(REST), A(0), D(0)]]) },
    { id: 'V8', what: 'a rebuild and day / night while a message is ours', steps: CONFIRM.concat([[15, L(REST, DOOR), A(15), W(1000)], [15, REB(), W(1000)], [15, NIGHT(true), W(1000)], [15, NIGHT(false)], [N, L(REST), A(0)]]) },
    // ---- research3/MC's cases (same events; truth explicit) ------------------------------------------------------------------
    { id: 'A0', what: 'door opens and shuts (list first)', steps: [[N, L(REST), A(0)], [15, L(REST, DOOR), A(15)], [N, L(REST), A(0)], [N, W(30000)]] },
    { id: 'A0b', what: 'door, the number first', steps: [[N, L(REST), A(0)], [15, A(15), L(REST, DOOR)], [N, A(0), L(REST)], [N, W(30000)]] },
    { id: 'A1', what: 'the getter answers 65535 and nothing ever shows', steps: [[N, AD(), L(REST)], [N, W(30000)]] },
    { id: 'A2', what: 'a message, then 65535 instead of 0', steps: CONFIRM.concat([[15, L(REST, DOOR), A(15)], [N, L(REST), AD()], [N, W(30000)]]) },
    { id: 'A3', what: 'a message, then the number is never notified again (kept 15); the list returns to rest', steps: CONFIRM.concat([[15, L(REST, DOOR), A(15)], [N, L(REST)], [N, W(30000)]]) },
    { id: 'A5', what: 'a temporary message hidden by BMW after ~20 s, still listed, the number stays (987): the CARD hangs', steps: CONFIRM.concat([[987, L(REST, STORED), A(987)], [987, W(15000)], [N, W(10000)], [N, W(30000)]]) },
    { id: 'A5d', what: 'A5, and the driver leaves tab 2 after BMW hid it (choice A: the tab is free, the window opens)', steps: CONFIRM.concat([[987, L(REST, STORED), A(987)], [987, W(15000)], [N, W(10000)], [N, DRV(1), W(5000)]]) },
    { id: 'A8', what: 'the shown-now field silent; a stored red entry stays listed', steps: [[N, L(REST)], [52, L(REST, STORED_RED)], [52, W(15000)], [N, W(10000)], [N, W(30000)]] },
    { id: 'A9', what: 'silent field; red, then a list that does not fit', steps: [[N, L(REST)], [52, L(REST, STORED_RED)], [N, BAD()], [N, W(30000)]] },
    { id: 'A16', what: 'A3 with the witness going back to 0', steps: [[N, L(REST), A(0), D(0)], [15, L(REST, DOOR), A(15), D(15)], [N, L(REST), D(0)], [N, W(30000)]] },
    { id: 'S1', what: 'a listed message while the shown-now field is stuck on 65535', steps: [[N, AD(), L(REST)], [15, L(REST, DOOR)], [15, W(30000)], [N, L(REST)], [N, W(30000)]] },
    { id: 'S2', what: 'a RED listed message, the field stuck on 65535 for a minute', steps: [[N, AD(), L(REST)], [52, L(REST, STORED_RED)], [52, W(60000)], [N, L(REST)], [N, W(10000)]] },
    { id: 'S3', what: 'the number arrives 2 s before the list carries it', steps: CONFIRM.concat([[15, A(15)], [15, W(2000)], [15, L(REST, DOOR)], [N, L(REST), A(0)]]) },
    { id: 'S5', what: 'a message under a number the list never carries', steps: CONFIRM.concat([[1234, A(1234)], [1234, W(60000)], [N, A(0)], [N, W(10000)]]) },
    // ---- the centre's own ---------------------------------------------------------------------------------------------------
    { id: 'C1', what: 'the driver leaves tab 2 while the message shows: window at once; comes back: card, settle, shut', steps: CONFIRM.concat([[15, L(REST, DOOR), A(15), W(1000)], [15, DRV(1), W(2000)], [15, DRV(2), W(2000)], [N, L(REST), A(0)]]) },
    { id: 'C2', what: 'guidance starts during a message: tab 2 holds; tab 5 after the message', steps: CONFIRM.concat([[15, L(REST, DOOR), A(15), W(1000)], [15, AUTO(5), W(2000)], [N, L(REST), A(0), W(1000)]]) },
    { id: 'C3', what: 'a new message after the driver left pulls tab 2 again', steps: CONFIRM.concat([[15, L(REST, DOOR), A(15)], [15, DRV(1), W(2000)], [50, L(REST, DOOR, TYRE), A(50), W(2000)], [N, L(REST), A(0)]]) },
    { id: 'C4', what: 'BMW cycles N / M / N after the driver left: no message is new, the driver\'s tab holds, the window stays open', steps: CONFIRM.concat([[15, L(REST, DOOR, TYRE), A(15)], [50, A(50)], [15, DRV(1), A(15)], [50, A(50)], [15, A(15)], [N, L(REST), A(0)]]) },
    { id: 'C5', what: 'N -> M where M is already on the page as a whole row: no window (our text for M was on screen)', steps: CONFIRM.concat([[15, L(REST, DOOR, WASH), A(15), W(1000)], [164, A(164), W(1000)], [N, L(REST), A(0)]]) },
    { id: 'C6', what: 'N -> M where M\'s row is cut: window until M\'s card settles', steps: CONFIRM.concat([[15, L(REST, DOOR, LONGW), A(15), W(1000)], [41, A(41), W(1000)], [N, L(REST), A(0)]]) },
    { id: 'C7', what: 'the counter changes and the list grows while ours: no window', steps: CONFIRM.concat([[15, L(REST, DOOR), A(15), F(1, 2, [15, 50]), W(1000)], [15, F(1, 3, [15, 50, 19]), L(REST, DOOR, TYRE, BOOT), W(1000)], [N, L(REST), A(0)]]) },
    { id: 'C8', what: 'the same id with other words: window until the new words settle', steps: CONFIRM.concat([[15, L(REST, DOOR), A(15), W(1000)], [15, L(REST, { id: 15, color: 'white', name: 'Двері водія відчинено' }), W(1000)], [N, L(REST), A(0)]]) },
    { id: 'C9', what: 'a red message while the driver is on tab 5 with guidance: pulled to 2 at once (any speed)', steps: CONFIRM.concat([[N, AUTO(5), DRV(5), W(1000)], [42, L(REST, BRAKE), A(42), W(2000)], [N, L(REST), A(0), W(1000)]]) },
    { id: 'C10', what: 'stored entries only, the driver opens tab 2: the list page, nothing hidden, no window', steps: CONFIRM.concat([[N, L(REST, WASH, STORED), DRV(2), W(2000)], [N, DRV(1)]]) },
    { id: 'C11', what: 'D7 not yet fallen, the driver on tab 2: the pointer page, window open', steps: [[N, L(REST), DRV(2)], [15, L(REST, DOOR), A(15), W(2000)], [N, L(REST), A(0)]] },
    { id: 'C12', what: 'a stored entry already on the page as a whole row is named by shown-now (D7 fallen): ours at once', steps: CONFIRM.concat([[N, L(REST, WASH), DRV(2), W(1000)], [164, A(164), W(1000)], [N, A(0)]]) },
    { id: 'C13', what: 'the same with a stored entry whose row is cut: the window opens until its card settles', steps: CONFIRM.concat([[N, L(REST, STORED), DRV(2), W(1000)], [987, A(987), W(1000)], [N, A(0)]]) },
];

module.exports = { CASES, CONFIRM, SAMPLES: { REST, DOOR, BOOT, TYRE, BRAKE, WASH, LONGW, STORED, STORED_RED, GREEK, NONAME } };
