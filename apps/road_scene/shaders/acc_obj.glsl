// ACC View, direction E (round 1120 AA2, the owner's FOCUS of 2026-11-20): up to 16 road users the car's sensors report, each
// as our own generic flat shape of its class (car, truck, two-wheeler, pedestrian, cyclist, unknown) standing at its measured
// place, with a soft shadow. One look. The layer is the lane's box; the app sends each object's box (layer px) and class.
// Shape maths in units of the object's own box height (<= 1.2): no length() of a large px offset.
// fixes-1121 RS (Road Scene): Auto Beam's light sources join the same 16 items, at night. A light the camera puts on a road
// user lights that road user's lamps (u_oc.z) and carries its ring (u_oc.w): one thing, never a second mark. The rest are
// points by class (7 oncoming headlamps, white pair; 8 tail lamps, a warm pair, never a warning red; 9 street light, pale;
// 10 other, grey), in units of the lamp's own radius; 11 is the ring alone, round the car ahead (its own layer is above).
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;     // the layer, px
uniform vec4 u_ob[16];   // per item: centre x, foot y, width, height (px; height 0 = none); a light: centre x, y, the pair's half spacing, the lamp's radius
uniform vec4 u_oc[16];   // per item: class (1 car 2 truck 3 two-wheeler 4 pedestrian 5 cyclist 6 unknown, 7..10 a light, 11 a ring), alpha, lamps lit (0, 1 head, 2 tail, 4 other), ringed
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

vec3 lampc(float k) {
    return k < 1.5 ? vec3(0.820, 0.827, 0.850) : k < 2.5 ? vec3(0.683, 0.400, 0.271) : k < 3.5 ? vec3(0.577, 0.588, 0.518) : vec3(0.549, 0.573, 0.608);
}

void main() {
    vec2 p = v_uv * u_size;
    vec4 c = vec4(0.0);
    vec3 ink = vec3(0.740, 0.750, 0.762);
    for (int i = 0; i < 16; i++) {
        vec4 b = u_ob[i];
        vec4 m = u_oc[i];
        vec4 o = vec4(0.0);
        if (m.x > 6.5 && m.x < 10.5) {
            float r = max(b.w, 1.0);
            vec2 d0 = (p - b.xy) / r;
            float hs = b.z / r;
            if (abs(d0.x) < hs + 11.0 && abs(d0.y) < 11.0) {
                float d = hs > 0.8 / r ? min(length(d0 - vec2(hs, 0.0)), length(d0 + vec2(hs, 0.0))) : length(d0);
                float a = max(1.0 - smoothstep(1.0 - 0.7 / r, 1.0 + 0.7 / r, d), (1.0 - smoothstep(1.0, 3.0, d)) * 0.16);
                float kr = m.w * (1.0 - smoothstep(0.3, 1.3, abs(length(d0) - max(max(hs + 3.0, 5.0), 9.0 / r)) * r)) * 0.85;
                o = vec4(kr > a ? ink : lampc(m.x - 6.0), max(a, kr));
            }
        } else if (b.w > 1.0) {
            float a = b.z / b.w;
            float rq = 0.5 * max(a, 1.0) + 0.25;
            float ex = m.w > 0.5 ? rq * b.w + 3.0 : 0.0;
            if (abs(p.x - b.x) < max(0.6 * b.z + 3.0, ex) && p.y > min(b.y - b.w - 2.0, b.y - 0.5 * b.w - ex) && p.y < max(b.y + 0.12 * b.w + 2.0, b.y - 0.5 * b.w + ex)) {
                vec2 q = vec2(p.x - b.x, p.y - (b.y - b.w)) / b.w;
                float aa = 1.0 / b.w;
                if (m.x < 10.5) {
                    vec2 s = (q - vec2(0.0, 1.0)) / vec2(0.5 * a + 0.08, 0.06);
                    float sh = (1.0 - smoothstep(0.3, 1.0, dot(s, s))) * 0.45;
                    float d = shape(q, m.x, a);
                    float k = 1.0 - smoothstep(-aa, aa, d);
                    vec3 col = u_fill * (0.78 + 0.22 * (1.0 - q.y)) * (0.72 + 0.28 * smoothstep(-0.06, -0.015, d));
                    o = mix(vec4(0.0, 0.0, 0.0, sh), vec4(col, 1.0), k);
                    if (m.z > 0.5) {
                        float lx = (m.x > 2.5 && m.x < 3.5) || (m.x > 4.5 && m.x < 5.5) ? 0.0 : 0.36 * a;
                        vec2 lq = vec2(abs(q.x) - lx, q.y - (m.x > 1.5 && m.x < 2.5 ? 0.80 : 0.58));
                        float dl = length(lq);
                        float la = max(1.0 - smoothstep(0.05, 0.05 + aa, dl), (1.0 - smoothstep(0.0, 0.22, dl)) * 0.35);
                        o = vec4(mix(o.rgb, lampc(m.z), la), max(o.a, la));
                    }
                }
                float kr = m.w * (1.0 - smoothstep(0.6 * aa, 1.6 * aa, abs(length(q - vec2(0.0, 0.5)) - rq))) * 0.85;
                o = vec4(mix(o.rgb, ink, kr), max(o.a, kr));
            }
        }
        o.a *= m.y;
        if (o.a > 0.0) {
            float na = o.a + c.a * (1.0 - o.a);
            c = vec4((o.rgb * o.a + c.rgb * c.a * (1.0 - o.a)) / max(na, 0.001), na);
        }
    }
    gl_FragColor = vec4(c.rgb * (1.0 - 0.65 * u_dim.x), c.a);
}
