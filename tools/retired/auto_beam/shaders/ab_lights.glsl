// Auto Beam, direction A (round "Auto Beam", package HD): the lights the camera sees ahead, up to 15, each a point or a pair
// of lamps at its place, coloured by class: oncoming headlamps white, tail lamps ahead a warm tone (never a warning red),
// street lights small and pale, unknown grey; the one that caused a dip ringed. One look. The same drawing as
// apps/auto_beam/paint.js scene(). Distances are taken in units of each lamp's own radius before any length (no large
// px offset meets a mediump float).
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;     // the layer, px
uniform vec4 u_li[15];   // the lamp(s)' centre x, y (px), the lamp radius (px), class 1 oncoming 2 ahead 3 street 4 other (+10 ringed; 0 none)
uniform vec4 u_lp[15];   // the pair's half spacing (px; 0 = one lamp), 0, 0, 0
uniform vec2 u_night;    // 1 at night, 0

void main() {
    vec2 p = v_uv * u_size;
    float nm = u_night.x > 0.5 ? 1.0 : 0.0;
    vec4 c = vec4(0.0);
    for (int i = 0; i < 15; i++) {
        vec4 L = u_li[i];
        if (L.w < 0.5) continue;
        float ring = L.w > 9.5 ? 1.0 : 0.0;
        float kind = L.w - 10.0 * ring;
        vec3 col = kind < 1.5 ? vec3(0.965, 0.973, 1.0) * mix(1.0, 0.85, nm)
            : kind < 2.5 ? vec3(0.910, 0.533, 0.361) * mix(1.0, 0.75, nm)
            : kind < 3.5 ? vec3(0.769, 0.784, 0.690) * mix(1.0, 0.75, nm)
            : vec3(0.549, 0.573, 0.608);
        float r = max(L.z, 1.0);
        float hs = u_lp[i].x;
        vec2 d0 = (p - L.xy) / r;
        vec2 h = vec2(hs / r, 0.0);
        float d = hs > 0.8 ? min(length(d0 - h), length(d0 + h)) : length(d0);
        float core = 1.0 - smoothstep(1.0 - 0.7 / r, 1.0 + 0.7 / r, d);
        float glow = (1.0 - smoothstep(1.0, 3.0, d)) * 0.16;
        float a = max(core, glow);
        float rr = max(max(hs / r + 3.0, 5.0), 9.0 / r);
        float dr = abs(length(d0) - rr) * r;
        float kr = ring * (1.0 - smoothstep(0.3, 1.3, dr)) * 0.85;
        vec3 ink = vec3(0.925, 0.937, 0.953) * mix(1.0, 0.8, nm);
        vec3 cc = kr > a ? ink : col;
        float aa = max(a, kr);
        c = vec4(mix(c.rgb, cc, aa), max(c.a, aa));
    }
    gl_FragColor = c;
}
