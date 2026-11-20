// ACC View, direction E (round 1120 AA; docs/r1120/AA-SPEC.md 3.1): the ground, our lane's two lines running to the horizon,
// the measured gap lit on the road with chevrons while closing, and faint outlines of neighbouring vehicles. One look.
// Layer px in u_size; every px distance is formed from small terms (no length() of a large offset), highp where available.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;     // the layer, px
uniform vec4 u_geo;      // horizon (v), half lane width at the foot (px), the far end's scale t (0..1), line width at the foot (px)
uniform vec3 u_line;     // the lane lines' colour
uniform vec3 u_ground;   // the ground's colour at the foot
uniform vec4 u_gap;      // the car ahead's depth z (0..1; 0 = none), closing (0, 1, 2), the lit gap's strength, dim (0..1)
uniform vec3 u_gapc;     // the lit gap's and the chevrons' colour
uniform vec4 u_nb[4];    // neighbours: lane (-1 / +1; 0 = none), depth z, strength, 0

float tOf(float z, float kf) { return 1.0 / (1.0 + z * kf); }

void main() {
    vec2 p = v_uv * u_size;
    float hy = u_geo.x * u_size.y;
    float t = (p.y - hy) / (u_size.y - hy);
    vec4 c = vec4(0.0);
    if (t > 0.0) {
        float kf = 1.0 / u_geo.z - 1.0;
        float z = (1.0 / t - 1.0) / kf;
        float hw = u_geo.y * t;
        float X = (p.x - 0.5 * u_size.x) / hw;
        float fade = 1.0 - smoothstep(0.55, 1.0, z);
        float edge = smoothstep(0.0, 48.0, min(p.x, u_size.x - p.x)) * smoothstep(0.0, 16.0, u_size.y - p.y);
        float ground = (0.30 + 0.70 * clamp(1.0 - z, 0.0, 1.0)) * (1.0 - smoothstep(1.4, 3.4, abs(X))) * edge;
        c = vec4(u_ground, ground * fade);
        if (u_gap.x > 0.0 && z < u_gap.x) {
            float k = u_gap.z * (1.0 - smoothstep(0.72, 0.92, abs(X))) * smoothstep(0.0, 0.04, u_gap.x - z);
            c.rgb = mix(c.rgb, u_gapc, k);
            c.a = max(c.a, k * fade);
            if (u_gap.y > 0.5) {
                for (int i = 0; i < 2; i++) {
                    float tc = tOf(u_gap.x * (0.45 + 0.22 * float(i)), kf);
                    float yc = hy + (u_size.y - hy) * tc;
                    float d = (p.y - yc - abs(X) * u_geo.y * tc * 0.28) / (u_geo.w * tc * 0.9 + 0.8);
                    float on = (1.0 - smoothstep(0.6, 1.0, abs(d))) * (1.0 - smoothstep(0.42, 0.52, abs(X)));
                    if (float(i) < u_gap.y) { c.rgb = mix(c.rgb, u_gapc, on); c.a = max(c.a, on * fade); }
                }
            }
        }
        float lw = max(1.2, u_geo.w * t);
        float dx = (abs(X) - 1.0) * hw;
        float line = (1.0 - smoothstep(lw * 0.5 - 0.7, lw * 0.5 + 0.7, abs(dx))) * fade;
        float glow = (1.0 - smoothstep(0.0, lw * 2.5 + 2.0, abs(dx))) * 0.25 * fade;
        c.rgb = mix(c.rgb, u_line, max(line, glow));
        c.a = max(c.a, max(line, glow));
        for (int i = 0; i < 4; i++) {
            vec4 n = u_nb[i];
            if (abs(n.x) > 0.5) {
                float tn = tOf(n.y, kf);
                float wy = hy + (u_size.y - hy) * tn;
                float bw = u_geo.y * tn * 0.62;
                float bh = bw * 0.62;
                vec2 q = vec2(p.x - (0.5 * u_size.x + n.x * 2.0 * u_geo.y * tn), p.y - (wy - bh));
                if (abs(q.x) < bw + 4.0 && abs(q.y) < bh + 4.0) {
                    vec2 e = abs(q - vec2(0.0, bh * 0.35)) - vec2(bw, bh * 0.62) + vec2(bh * 0.2);
                    float sd = length(max(e, 0.0) / bh) * bh + min(max(e.x, e.y), 0.0) - bh * 0.2;
                    e = abs(q + vec2(0.0, bh * 0.45)) - vec2(bw * 0.68, bh * 0.45) + vec2(bh * 0.2);
                    sd = min(sd, length(max(e, 0.0) / bh) * bh + min(max(e.x, e.y), 0.0) - bh * 0.2);
                    float o = (1.0 - smoothstep(0.6, 1.6, abs(sd))) * n.z;
                    c.rgb = mix(c.rgb, u_line * 0.5 + vec3(0.5), o);
                    c.a = max(c.a, o);
                }
            }
        }
    }
    gl_FragColor = vec4(c.rgb * (1.0 - 0.65 * u_gap.w), c.a);
}
