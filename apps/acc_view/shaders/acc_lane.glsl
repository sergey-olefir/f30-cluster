// ACC View, direction E (round 1120 AA2; docs/r1120/AA-SPEC.md 3.1, the owner's FOCUS of 2026-11-20): the ground, the lane
// boundaries the camera measures (clothoids: offset, heading, curvature; solid / dashed / double / road edge, up to four, so
// our lane and the next ones) or AA's fixed symbol, the measured gap lit on our lane, chevrons while closing. One look.
// Layer px in u_size; lateral distances in metres times px-per-metre (small terms), highp where available.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;     // the layer, px
uniform vec4 u_view;     // horizon (share of the height), px per metre at the foot, kf (1 / far scale - 1), range (m)
uniform vec4 u_ln[4];    // boundaries: offset at 0 m (m, left +), heading (rad), curvature (1/m), type (0 none 1 solid 2 dashed 3 double 4 edge)
uniform vec4 u_lp[4];    // boundaries: valid length (m), strength (0..1), marking width (m), 0
uniform vec4 u_ego;      // our lane's centre: offset (m), heading, curvature, half width (m)
uniform vec3 u_line;     // the lines' colour (a fixed, neutral symbol: never with any state)
uniform vec3 u_ground;   // the ground's colour at the foot
uniform vec4 u_gap;      // the car ahead's depth z (0..1; 0 = none), closing (0, 1, 2), the lit gap's strength, dim (0..1)
uniform vec3 u_gapc;     // the lit gap's and the chevrons' colour

void main() {
    vec2 p = v_uv * u_size;
    float hy = u_view.x * u_size.y;
    float t = (p.y - hy) / (u_size.y - hy);
    vec4 c = vec4(0.0);
    if (t > 0.0) {
        float z = (1.0 / t - 1.0) / u_view.z;
        float xm = z * u_view.w;
        float k = u_view.y * t;
        float ym = (0.5 * u_size.x - p.x) / k;
        float fade = 1.0 - smoothstep(0.55, 1.0, z);
        float ce = u_ego.x + xm * (u_ego.y + 0.5 * u_ego.z * xm);
        float aX = abs(ym - ce) / u_ego.w;
        float edge = smoothstep(0.0, 48.0, min(p.x, u_size.x - p.x)) * smoothstep(0.0, 16.0, u_size.y - p.y);
        float ground = (0.30 + 0.70 * clamp(1.0 - z, 0.0, 1.0)) * (1.0 - smoothstep(2.6, 5.5, aX)) * edge;
        c = vec4(u_ground, ground * fade);
        if (u_gap.x > 0.0 && z < u_gap.x) {
            float g = u_gap.z * (1.0 - smoothstep(0.72, 0.92, aX)) * smoothstep(0.0, 0.04, u_gap.x - z);
            c.rgb = mix(c.rgb, u_gapc, g);
            c.a = max(c.a, g * fade);
            for (int i = 0; i < 2; i++) {
                float tc = 1.0 / (1.0 + u_gap.x * (0.45 + 0.22 * float(i)) * u_view.z);
                float yc = hy + (u_size.y - hy) * tc;
                float d = (p.y - yc - aX * u_ego.w * u_view.y * tc * 0.28) / (0.1 * u_view.y * tc * 0.9 + 0.8);
                float on = (1.0 - smoothstep(0.6, 1.0, abs(d))) * (1.0 - smoothstep(0.42, 0.52, aX)) * step(float(i) + 0.5, u_gap.y);
                c.rgb = mix(c.rgb, u_gapc, on);
                c.a = max(c.a, on * fade);
            }
        }
        for (int i = 0; i < 4; i++) {
            vec4 l = u_ln[i];
            vec4 q = u_lp[i];
            if (l.w > 0.5 && xm < q.x) {
                float d = abs(ym - (l.x + xm * (l.y + 0.5 * l.z * xm))) * k;
                float lw = max(1.2, q.z * k);
                if (l.w > 2.5 && l.w < 3.5) d = abs(d - 1.4 * lw);
                float on = 1.0 - smoothstep(lw * 0.5 - 0.7, lw * 0.5 + 0.7, d);
                float glow = (1.0 - smoothstep(0.0, lw * 2.5 + 2.0, d)) * 0.25;
                float dash = (l.w > 1.5 && l.w < 2.5) ? step(fract(xm / 12.0), 0.5) : 1.0;
                float kk = max(on, glow) * dash * fade * q.y * (1.0 - smoothstep(q.x - 8.0, q.x, xm));
                c.rgb = mix(c.rgb, l.w > 3.5 ? u_line * 0.5 + vec3(0.14) : u_line, kk);
                c.a = max(c.a, kk);
            }
        }
    }
    gl_FragColor = vec4(c.rgb * (1.0 - 0.65 * u_gap.w), c.a);
}
