'use strict';
// actuator.js - the ONLY actuator of Auto Beam: a null one. request() logs what the app WOULD switch and returns; it touches
// nothing. No other implementation exists, not even a disabled one. ANY real implementation needs the owner's written
// approval of that one specific write (docs/highbeam/ROUND.md section 2, stage 4), after a parked test ladder.
function NullActuator(log) { this.log = log; this.last = null; this.count = 0; this.at = 0; }
NullActuator.prototype.kind = 'null';
NullActuator.prototype.request = function (want, reason) {
    if (want === this.last) return false;
    this.last = want; this.count++; this.at = Date.now();
    try { this.log.info('beam: actuator (null) would switch to ' + want + ' (' + reason + '); nothing sent'); } catch (e) { /* logging only */ }
    return false;
};
module.exports = { NullActuator };
