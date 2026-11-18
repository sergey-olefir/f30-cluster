// Twin Dial round 3, package K1: what each dial variant adds to the tdial effect shader, in bytes of the source the app
// sends (shaders.js `tdial` = compact(TDIAL)). Each variant is a sketch patch on that compacted source, applied here only
// to count bytes: nothing in shared/ is changed. Run: node tools/twin-dial/r3/k1/shader_cost.js
'use strict';
const path = require('path');
const S = require(path.join(__dirname, '..', '..', '..', '..', 'shared', 'shaders.js'));

const base = S.tdial;
const PATCHES = {
    'red zone to the band end (u_red.w = 144 instead of the sweep)': [],     // hud.js _twinDialSend only
    'red bezel arc, wedge kept (red_both)': [
        [/float red = max\(([^;]*)\);/, (m) => m + '\nred = max(red, step(u_red.x, th) * ang * step(0.975, rho));'],
    ],
    'red bezel arc, no wedge (red_arc): the arc plus a wedge switch in u_bar2.z': [
        [/float red = max\(([^;]*)\);/, (m) => m + '\nred = max(red, step(u_red.x, th) * ang * step(0.975, rho));'],
        [/if \(u_red\.x < 900\.0\)/, 'if (u_red.x < 900.0 && u_bar2.z < 0.5)'],
    ],
    'rim red over the zone (08)': [
        [/float red = max\(([^;]*)\);/, (m) => m + '\nred = max(red, step(u_red.x, th) * step(th, u_red.w) * step(0.52, rho) * (1.0 - step(0.575, rho)));'],
    ],
    'band B or C (law constants in the wedge underlay, tint)': [
        [/0\.010 \* exp\(7\.5 \* \(rho - 0\.60\)\) \* exp\(-0\.85 \*/, '0.0188 * exp(4.60 * (rho - 0.60)) * exp(-0.59 *'],
        [/vec3\(0\.96, 1\.0, 1\.08\)/, 'vec3(0.76, 1.0, 1.064)'],
    ],
    'band inner edge 0.575 (shader region constants)': [
        [/smoothstep\(0\.572, 0\.580, rho\)/, 'smoothstep(0.567, 0.575, rho)'],
    ],
    'needle drop shadow offset like 06 (instead of the symmetric one)': [
        [/float sh = clamp\(hw \+ 0\.05 \* R - abs\(ac\) \+ 0\.5, 0\.0, 1\.0\) \* alo;/,
            'float sh = clamp(hw + 0.03 * R - abs(ac - 0.02 * R) + 0.5, 0.0, 1.0) * alo;'],
    ],
};

console.log('tdial today: %d bytes (WBDIAL Comfort 12.4k ran on the car; 25.4k ran, 26.7k reset the KOMBI)', base.length);
const out = {};
for (const [name, ps] of Object.entries(PATCHES)) {
    let s = base;
    for (const [re, rep] of ps) {
        if (!re.test(s)) throw new Error('patch does not apply: ' + name + ' / ' + re);
        s = s.replace(re, rep);
    }
    out[name] = s.length - base.length;
    console.log('%s  %s', String(s.length - base.length).padStart(5), name);
}
module.exports = { base: base.length, delta: out };
