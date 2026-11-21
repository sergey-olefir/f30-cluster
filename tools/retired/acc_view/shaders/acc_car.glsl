// ACC View, direction E (round 1120 AA; docs/r1120/AA-SPEC.md 3.1): the car ahead, our own generic rear view, shaded. One look.
// The layer is the car's box (with its shadow); the app moves and scales the layer to the gap level (the renderer's own
// translate / scale keyframes: a glide costs no pixels). Units: the box's height = 1; x from the centre.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;     // the layer, px
uniform vec3 u_body;     // the body's colour (amber while closing fast)
uniform vec2 u_dim;      // dim (0..1: the car's own warning), 0

float box(vec2 q, vec2 c, vec2 b, float r) {
    vec2 e = abs(q - c) - b + vec2(r);
    return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r;
}

void main() {
    float a = u_size.x / u_size.y;
    vec2 q = vec2((v_uv.x - 0.5) * a, v_uv.y);
    float aa = 1.2 / u_size.y;
    float ax = abs(q.x);
    // the shadow on the road
    vec2 s = (q - vec2(0.0, 0.94)) / vec2(0.82, 0.075);
    float shadow = (1.0 - smoothstep(0.4, 1.0, dot(s, s))) * 0.55;
    vec4 c = vec4(0.0, 0.0, 0.0, shadow);
    // the tyres
    float ty = box(vec2(ax, q.y), vec2(0.53, 0.86), vec2(0.105, 0.095), 0.03);
    float kt = 1.0 - smoothstep(-aa, aa, ty);
    c = mix(c, vec4(vec3(0.07), 1.0), kt);
    // the glasshouse (a trapezoid) and the body
    float f = clamp((q.y - 0.17) / 0.30, 0.0, 1.0);
    float cab = box(vec2(ax * 0.62 / mix(0.43, 0.62, f), q.y), vec2(0.0, 0.32), vec2(0.62, 0.15), 0.07);
    float body = box(q, vec2(0.0, 0.63), vec2(0.70, 0.20), 0.11);
    float mir = box(vec2(ax, q.y), vec2(0.70, 0.40), vec2(0.07, 0.035), 0.03);
    float sil = min(min(cab, body), mir);
    float k = 1.0 - smoothstep(-aa, aa, sil);
    // shading: light from above, the sides turning away, a shoulder highlight, darker towards the edges
    float lit = 0.62 + 0.38 * (1.0 - q.y);
    lit *= 1.0 - 0.38 * smoothstep(0.40, 0.72, ax);
    lit += 0.30 * (1.0 - smoothstep(0.0, 0.025, abs(q.y - 0.455))) * (1.0 - smoothstep(0.50, 0.66, ax));
    lit *= 0.70 + 0.30 * smoothstep(-0.06, -0.005, -sil);
    vec3 col = u_body * lit;
    // the rear window: dark glass with a soft reflection
    float win = box(vec2(ax * 0.55 / mix(0.37, 0.55, f), q.y), vec2(0.0, 0.335), vec2(0.55, 0.105), 0.045);
    float kw = 1.0 - smoothstep(-aa, aa, win);
    vec3 glass = vec3(0.05, 0.06, 0.08) + vec3(0.16, 0.18, 0.21) * (1.0 - smoothstep(0.0, 0.08, abs(q.x * 0.6 + q.y - 0.42))) + 0.08 * (1.0 - f);
    col = mix(col, glass, kw);
    // the lamp band across the tail (smoked, never red) and the plate's recess
    float lamp = box(q, vec2(0.0, 0.53), vec2(0.66, 0.035), 0.02);
    float kl = 1.0 - smoothstep(-aa, aa, lamp);
    col = mix(col, vec3(0.10, 0.10, 0.11) + 0.18 * u_body * (1.0 - smoothstep(0.0, 0.66, ax)), kl);
    float plate = box(q, vec2(0.0, 0.69), vec2(0.15, 0.045), 0.01);
    col = mix(col, u_body * 0.35, 1.0 - smoothstep(-aa, aa, plate));
    float diff = box(q, vec2(0.0, 0.80), vec2(0.52, 0.025), 0.02);
    col = mix(col, vec3(0.06), 1.0 - smoothstep(-aa, aa, diff));
    c = mix(c, vec4(col, 1.0), k);
    gl_FragColor = vec4(c.rgb * (1.0 - 0.65 * u_dim.x), c.a);
}
