'use strict';
/**
 * envelope_map.js - where the gates stop: the gated module on four canonical situations of SC3's library, on a finer grid
 * than the library's (package CM). For each point: whether the module stayed armed, its first disarm reason, collision,
 * the smallest true time gap. Mild plant unless --plant; the driver sets the cruise 5 km/h above the speed at the start.
 *   node tools/cruise-cmd/envelope_map.js [--plant mild|liftoff|firm]
 * Node 8 syntax. Prints a table; writes nothing.
 */
const sc = require('../cruise-sim/core/scenario.js');
const G = require('./sim_gated.js');

function one(id, params, opts, plant) {
    const t = sc.template(id);
    const s = JSON.parse(JSON.stringify(t));
    s.params = Object.assign({}, s.params, params);
    delete s.sweep; delete s.variants; delete s.where; delete s.reactions; delete s.worstOver;
    s.id = id + '#' + Object.keys(params).map((k) => k + '=' + params[k]).join(',');
    const c = sc.expand(s)[0];
    const cfg = sc.toConfig(c, { seed: 1, plant: { preset: plant }, driver: { reactionCase: 'none' } });
    const r = G.run(cfg, Object.assign({ driverSetAbove_kmh: 5 }, opts || {}));
    const fd = r.cm.firstDisarm;
    const cell = (r.cm.armedOk ? (fd ? fd.reason.replace('ENVELOPE_', '').slice(0, 7) : 'ARMED') : 'R:' + (r.cm.armReason || '').replace('ENVELOPE_', '').slice(0, 5)) +
        (r.metrics.collision ? '/X' : '/' + (r.metrics.minTimeGap_s === null ? '-' : r.metrics.minTimeGap_s.toFixed(1)));
    return cell;
}
function table(title, rows, cols, fn) {
    console.log('\n' + title);
    console.log('        ' + cols.map((c) => String(c).padStart(14)).join(''));
    rows.forEach((rw) => console.log(String(rw).padStart(8) + cols.map((c) => fn(rw, c).padStart(14)).join('')));
}
function main() {
    const a = process.argv.indexOf('--plant');
    const plant = a > 0 ? process.argv[a + 1] : 'mild';
    console.log('cell = ARMED (stayed armed) | first disarm reason | R:<reason> (arming refused); /X = collision, /n.n = min true time gap (s). Plant ' + plant + ', driver not reacting.');
    table('Approach from far (B.approach, the lead seen at the camera range): rows v (km/h), columns lead slower by (km/h)', [60, 90, 120, 150], [5, 10, 15, 20, 25, 30],
        (v, dv) => (v - dv < 30 ? '' : one('B.approach', { v: v, dv: dv }, null, plant)));
    table('The lead brakes (D.brake) by 20 km/h: rows v, columns deceleration (m/s²)', [60, 90, 120], [-0.25, -0.5, -0.75, -1.0, -1.5],
        (v, ac) => one('D.brake', { v: v, dv: 20, a: ac }, null, plant));
    table('A car at our speed cuts in (E.cutin.equal): rows v, columns gap at the cut-in (m)', [60, 90, 120], [10, 15, 20, 30, 40, 60],
        (v, g) => one('E.cutin.equal', { v: v, g: g }, null, plant));
    table('Following a lead at 2 s with the cruise set above it (C.steady): rows v, columns set above the lead (km/h)', [60, 90, 120], [0, 5, 10, 15, 20],
        (v, d) => one('C.steady', { v: v, h0: 2 }, { driverSetAbove_kmh: d === 0 ? 0.01 : d }, plant));
}
if (require.main === module) main();
module.exports = { one: one };
