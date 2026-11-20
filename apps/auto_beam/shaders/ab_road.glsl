// Auto Beam, direction A (round "Auto Beam", package HD): the road seen from behind our car, both beam cones on it, our car at
// the foot. One look. The same field as apps/auto_beam/paint.js field() / carBoxes(): the low beam a short, wide, flat-topped
// pool; the high beam a long, narrow cone whose reach is u_beam.x (0 folded .. 1 out: the picture's main motion, a uniform,
// no pixels). The cones follow the car's heading; the road bends away by u_beam.z (a curve). Distances in metres, divided
// by the px-per-metre scale before any length, so nothing large meets a mediump float.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;     // the layer, px
uniform vec4 u_view;     // horizon share, px per metre at the foot, kf, range (m)
uniform vec4 u_beam;     // the high beam's extent 0..1, night 0 / 1, curve (1/m), the view's foot behind our front (m)

float box(vec2 q, vec2 c, vec2 b, float r) {
    vec2 e = abs(q - c) - b + vec2(r);
    return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r;
}

void main() {
    vec2 p = v_uv * u_size;
    float W = u_size.x, H = u_size.y, hy = u_view.x * H;
    float nm = u_beam.y > 0.5 ? 1.0 : 0.0;
    vec3 road = vec3(0.086, 0.094, 0.110) * mix(1.0, 0.7, nm);
    vec3 edge = vec3(0.376, 0.392, 0.424) * mix(1.0, 0.7, nm);
    vec3 lightc = vec3(1.0, 0.957, 0.855) * mix(1.0, 0.85, nm);
    vec4 c = vec4(0.0);
    float t = (p.y - hy) / (H - hy);
    if (t > 0.0) {
        float z = (1.0 / t - 1.0) / u_view.z;
        float xm = z * u_view.w - u_beam.w;
        float k = u_view.y * t;
        float yb = (0.5 * W - p.x) / k;
        float xp = max(xm, 0.0);
        float yr = yb + 0.5 * u_beam.z * xp * xp;
        float fade = 1.0 - smoothstep(0.55, 1.0, z);
        float aa = 1.0 / k;
        float a = 0.92 * smoothstep(-2.6 - aa, -2.6 + aa, yr) * (1.0 - smoothstep(6.1 - aa, 6.1 + aa, yr)) * fade;
        vec3 col = road;
        float lw = max(0.12, 1.2 / k);
        float dash = fract((xm + 3.0) / 12.0) < 0.5 ? 1.0 : 0.0;
        float l1 = 1.0 - smoothstep(lw * 0.5 - aa * 0.7, lw * 0.5 + aa * 0.7, abs(yr + 2.3));
        float l2 = 1.0 - smoothstep(lw * 0.5 - aa * 0.7, lw * 0.5 + aa * 0.7, abs(yr - 5.8));
        float l3 = (1.0 - smoothstep(lw * 0.5 - aa * 0.7, lw * 0.5 + aa * 0.7, abs(yr - 1.75))) * dash;
        float mk = max(max(l1, l2), l3) * fade;
        col = mix(col, edge, mk);
        a = max(a, mk);
        // the cones: low (a flat-topped pool to 60 m) and high (to 60 + 160 x extent m)
        float e = u_beam.x;
        float on = xm > 0.5 ? 1.0 : 0.0;
        float lowW = 1.0 + 5.2 * (1.0 - exp(-xm / 8.0));
        float low = 0.62 * (1.0 - smoothstep(43.2, 60.0, xm)) * (0.55 + 0.45 * exp(-xm / 25.0));
        float reach = 60.0 + 160.0 * e;
        float highW = 0.8 + 3.4 * (1.0 - exp(-xm / 40.0));
        float high = e > 0.001 ? 0.5 * sqrt(e) * (1.0 - smoothstep(reach * 0.55, reach, xm)) * (0.55 + 0.45 * exp(-xm / 90.0)) : 0.0;
        float lk = on * min(1.0, low * (1.0 - smoothstep(0.6 * lowW, lowW, abs(yb))) + high * (1.0 - smoothstep(0.45 * highW, highW, abs(yb)))) * fade;
        col = mix(col, lightc, lk);
        a = max(a, lk);
        c = vec4(col, a);
        // our car from behind: its rear 4.6 m behind our front, in units of its own px-per-metre
        float tr = 1.0 / (1.0 + (u_beam.w - 4.6) / u_view.w * u_view.z);
        float kr = u_view.y * tr;
        vec2 q = vec2(p.x - 0.5 * W, p.y - (hy + (H - hy) * tr)) / kr;
        float ac = 1.0 / kr;
        vec3 car = vec3(0.275, 0.290, 0.322);
        float sh = (1.0 - smoothstep(0.5, 1.0, length(q / vec2(1.0, 0.12) - vec2(0.0, -0.3)))) * 0.45;
        c = vec4(mix(c.rgb, vec3(0.0), sh), max(c.a, sh));
        float dc = box(q, vec2(0.0, -1.03), vec2(0.66, 0.29), 0.22);
        float db = box(q, vec2(0.0, -0.43), vec2(0.9, 0.35), 0.16);
        float kc = 1.0 - smoothstep(-ac, ac, min(dc, db));
        float glass = 1.0 - smoothstep(-ac, ac, box(q, vec2(0.0, -1.06), vec2(0.56, 0.21), 0.14));
        float strip = 1.0 - smoothstep(-ac, ac, box(q, vec2(0.0, -0.56), vec2(0.82, 0.06), 0.05));
        vec3 cc = mix(car, mix(road, car, 0.5), glass);
        cc = mix(cc, vec3(0.388, 0.408, 0.443), strip * 0.6);
        c = vec4(mix(c.rgb, cc, kc), max(c.a, kc));
    }
    gl_FragColor = c;
}
