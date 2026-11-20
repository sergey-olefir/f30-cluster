// ACC View, direction E (round 1120 AA2, the owner's FOCUS of 2026-11-20): up to 16 road users the car's sensors report, each
// as our own generic flat shape of its class (car, truck, two-wheeler, pedestrian, cyclist, unknown) standing at its measured
// place, with a soft shadow. One look. The layer is the lane's box; the app sends each object's box (layer px) and class.
// Shape maths in units of the object's own box height (<= 1.2): no length() of a large px offset.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;     // the layer, px
uniform vec4 u_ob[16];   // per object: centre x, foot y, width, height (px); height 0 = none
uniform vec4 u_oc[16];   // per object: class (1 car 2 truck 3 two-wheeler 4 pedestrian 5 cyclist 6 unknown), alpha, 0, 0
uniform vec3 u_fill;     // the shapes' neutral colour
uniform vec2 u_dim;      // dim (0..1: the car's own warning), 0

float box(vec2 q, vec2 c, vec2 b, float r) {
    vec2 e = abs(q - c) - b + vec2(r);
    return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r;
}

float shape(vec2 q, float k, float a) {
    if (k < 1.5) return min(box(q, vec2(0.0, 0.64), vec2(0.48 * a, 0.27), 0.10), box(q, vec2(0.0, 0.30), vec2(0.33 * a, 0.17), 0.07));
    if (k < 2.5) return min(box(q, vec2(0.0, 0.52), vec2(0.48 * a, 0.47), 0.04), box(q, vec2(0.0, 0.96), vec2(0.40 * a, 0.04), 0.02));
    if (k < 3.5) return min(min(box(q, vec2(0.0, 0.46), vec2(0.12, 0.27), 0.09), length(q - vec2(0.0, 0.11)) - 0.09), box(q, vec2(0.0, 0.85), vec2(0.05, 0.15), 0.04));
    float head = length(q - vec2(0.0, 0.08)) - 0.075;
    float body = min(head, box(q, vec2(0.0, 0.34), vec2(0.13, 0.19), 0.07));
    if (k < 4.5) return min(body, box(vec2(abs(q.x), q.y), vec2(0.06, 0.76), vec2(0.045, 0.23), 0.04));
    if (k < 5.5) return min(body, abs(length(q - vec2(0.0, 0.79)) - 0.18) - 0.03);
    return abs((abs(q.x) + abs(q.y - 0.5)) * 0.7071 - 0.3) - 0.035;
}

void main() {
    vec2 p = v_uv * u_size;
    vec4 c = vec4(0.0);
    for (int i = 0; i < 16; i++) {
        vec4 b = u_ob[i];
        if (b.w > 1.0 && abs(p.x - b.x) < 0.6 * b.z + 3.0 && p.y > b.y - b.w - 2.0 && p.y < b.y + 0.12 * b.w + 2.0) {
            vec2 q = vec2(p.x - b.x, p.y - (b.y - b.w)) / b.w;
            float a = b.z / b.w;
            vec2 s = (q - vec2(0.0, 1.0)) / vec2(0.5 * a + 0.08, 0.06);
            float sh = (1.0 - smoothstep(0.3, 1.0, dot(s, s))) * 0.45;
            float aa = 1.0 / b.w;
            float d = shape(q, u_oc[i].x, a);
            float k = 1.0 - smoothstep(-aa, aa, d);
            vec3 col = u_fill * (0.78 + 0.22 * (1.0 - q.y)) * (0.72 + 0.28 * smoothstep(-0.06, -0.015, d));
            vec4 o = mix(vec4(0.0, 0.0, 0.0, sh), vec4(col, 1.0), k) * vec4(1.0, 1.0, 1.0, u_oc[i].y);
            float na = o.a + c.a * (1.0 - o.a);
            c = vec4((o.rgb * o.a + c.rgb * c.a * (1.0 - o.a)) / max(na, 0.001), na);
        }
    }
    gl_FragColor = vec4(c.rgb * (1.0 - 0.65 * u_dim.x), c.a);
}
