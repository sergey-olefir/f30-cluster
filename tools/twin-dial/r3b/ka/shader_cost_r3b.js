// Twin Dial round 3b, package KA: what the speed limit's red strip and markers and the cruise marker add to the tdial effect
// shader, in bytes of the source the app sends (shaders.js `tdial` = compact(TDIAL)), counted on sketch patches applied to the
// compacted source (nothing in shared/ is changed). Same method as tools/twin-dial/r3/k1/shader_cost.js.
// Run: node tools/twin-dial/r3b/ka/shader_cost_r3b.js
'use strict';
const path = require('path');
const S = require(path.join(__dirname, '..', '..', '..', '..', 'shared', 'shaders.js'));
const base = S.tdial;
const NEEDLE = /col = mix\(col, vec3\(u_n0\.x\), clamp\(hw \+ 0\.5 - abs\(ac\), 0\.0, 1\.0\) \* alo\);/;
const UNI = /uniform vec4 u_n2;/;
const LIMRED = 'const vec3 LIMRED = vec3(0.4621, 0.0103, 0.0056);';      // (181, 26, 17) in linear light
// u_lim: limit deg (999 none), red level (0 none, 0.45 dim, 1 full), end deg of the red strip, marker state (1 solid, 2 hollow)
const STRIP = 'col = mix(col, LIMRED * u_lim.y * u_n1.w, step(u_lim.x, th) * step(th, u_lim.z) * strip * (1.0 - ink));';
const MARK = 'float mk = step(abs(th - u_lim.x), 1.0) * step(0.893, rho) * step(rho, 0.94) * step(0.5, u_lim.w);\ncol = mix(col, LIMRED * u_n1.w, mk);';
const HOLLOW = 'float mk = step(abs(th - u_lim.x), 1.0) * step(0.893, rho) * step(rho, 0.94) * step(0.5, u_lim.w);\n' +
    'float hole = step(1.5, u_lim.w) * step(abs(th - u_lim.x), 1.0 - 1.6 / (0.9167 * R * 0.0174533)) * step(0.893 + 1.6 / R, rho) * step(rho, 0.94 - 1.6 / R);\n' +
    'col = mix(col, LIMRED * u_n1.w, mk * (1.0 - hole));';
// u_cr: the set speed's deg (999 none); a triangle in the dark gap, base 2 deg at rho 0.985, apex at 0.943 (G = the READY green)
const CRUISE = 'float tri = step(0.943, rho) * step(rho, 0.985) * step(abs(th - u_cr.x), (rho - 0.943) * 23.8);\ncol = mix(col, vec3(0.0452, 0.3278, 0.0159) * u_n1.w, tri);';

// C2 only: the coolant bar's track and its end labels are baked in the face (u_face holds "labels, empty bar segments"), so hiding
// the bar for the readout needs a region rule (or a re-baked face variant): black over y 0.62-0.95 R, |x| < 0.45 R when u_cr.w = 1
const HIDE = 'col *= 1.0 - u_cr.w * step(0.62 * R, p.y) * step(p.y, 0.95 * R) * step(abs(p.x), 0.45 * R);';

function apply(parts, withUniforms) {
    let s = base;
    const uni = withUniforms.map((u) => 'uniform vec4 ' + u + ';').join('\n');
    if (uni) s = s.replace(UNI, (m) => m + '\n' + uni + (parts.some((p) => p.includes('LIMRED')) ? '\n' + LIMRED : ''));
    if (!NEEDLE.test(s)) throw new Error('anchor not found');
    return s.replace(NEEDLE, (m) => parts.join('\n') + '\n' + m);
}

const CASES = {
    'strip red from the limit: L1, L2 and L3 alike (one code; the variant is the host: end angle 125 / the needle, level 0.45 / 1)': [[STRIP], ['u_lim']],
    'limit marker, solid': [[MARK], ['u_lim']],
    'limit marker, solid or hollow (conditional limit)': [[HOLLOW], ['u_lim']],
    'cruise marker (green triangle in the dark gap)': [[CRUISE], ['u_cr']],
    'limit: strip + solid marker (what (b) and the red strip need)': [[STRIP, MARK], ['u_lim']],
    'C2: hide the coolant bar (region rule, u_cr.w)': [[HIDE], ['u_cr']],
    'everything: strip + solid / hollow marker + cruise marker': [[STRIP, HOLLOW, CRUISE], ['u_lim', 'u_cr']],
    'everything + C2 hide rule': [[STRIP, HOLLOW, CRUISE, HIDE], ['u_lim', 'u_cr']],
};
console.log('tdial today: %d bytes (budget 8192 after compact; 06 look +81, K1)', base.length);
const out = {};
for (const [name, [parts, uni]] of Object.entries(CASES)) {
    const s = apply(parts, uni);
    out[name] = s.length - base.length;
    console.log('%s  %s', String(s.length - base.length).padStart(5), name);
}
module.exports = { base: base.length, delta: out };
