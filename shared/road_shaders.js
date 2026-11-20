'use strict';
/**
 * road_shaders.js - the Road View effect shaders (round "Road View", package TD; docs/traffic/TD-REPORT.md). GLSL ES 1.00, one
 * look per source (the KOMBI compiles every branch of a source, so a theme's variant is its own small source, never a runtime
 * switch); highp for every pixel-scale length (the car's mediump is fp16); every sampler is bound by shared/road_ui.js.
 *
 *   RV_STRIP_6WB   f30_cluster: the slots beside the 6WB speed-limit sign: a sign from the theme's atlas (printed) or the traffic
 *                  light (a glossy housing, the lit lamp with a soft glow). u_it[3] items, u_ce[3] their atlas cells.
 *   RV_STRIP_TD    Twin Dial: the same in its flat thin-line look (an outlined housing, lamps as rings, the lit one filled).
 *   RV_SCENE_TD    Twin Dial's road scene on the centre page: our lane and its neighbours in perspective (thin lines), the road
 *                  users as flat rear views, our car as an outline at the foot, the light above the lane far ahead.
 *   RV_SCENE_6WB   f30_cluster 6WB Comfort's centre window: the same scene in the 6WB's printed greys over a soft road surface.
 *
 * The light's states (u_lt.x): 0 none, 1 red, 2 red + amber, 3 amber, 4 green, 5 flashing amber (drawn steady, with two short
 * marks beside the lamp: nothing on our cluster blinks), 6 uncertain (three hollow lamps, no colour). u_lt.y the arrow: 0 none,
 * 1 left, 2 straight, 3 right (drawn in the green lamp). Red appears ONLY in the top lamp (and in an atlas sign's own red).
 *
 *   ship(src)        what the app sends: comments, blank lines and runs of spaces removed (the KOMBI's measure)
 *   SOURCES          { name: GLSL } as written; shipped(name) -> the text the app sends
 * Plain Node 8.
 */

const HEAD = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale lengths: the car's mediump is fp16
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
`;

/* ------------------------------------------------------------------ the 6WB strip -------------------------------------- */

const RV_STRIP_6WB = HEAD + `// Road View, f30_cluster: the 6WB sign row's slots (a sign from the atlas, or the traffic light). Our own drawing.
uniform sampler2D u_atlas;
uniform vec2 u_asz;          // the atlas, px
uniform vec4 u_it[3];        // items: centre x, y (layer px), size (px), kind (0 none, 1 sign, 2 light)
uniform vec4 u_ce[3];        // a sign's atlas cell: x, y, w, h (atlas px)
uniform vec4 u_lt;           // the light: state, arrow, 0, 0
uniform vec4 u_k;            // brightness (night), 0, 0, 0

float sdBox(vec2 q, vec2 h, float r) { vec2 e = abs(q) - h + vec2(r); return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r; }
float cov(float d) { return clamp(0.5 - d, 0.0, 1.0); }
vec3 lampCol(float i) { return i < 0.5 ? vec3(0.92, 0.10, 0.08) : i < 1.5 ? vec3(1.0, 0.64, 0.06) : vec3(0.20, 0.82, 0.38); }
float lit(float i, float s) {
    if (i < 0.5) return (s > 0.5 && s < 2.5) ? 1.0 : 0.0;
    if (i < 1.5) return (s > 1.5 && s < 3.5) || (s > 4.5 && s < 5.5) ? 1.0 : 0.0;
    return (s > 3.5 && s < 4.5) ? 1.0 : 0.0;
}
// an arrow pointing left (1), up (2) or right (3), in a box of half size h around q's origin: coverage
float arrow(vec2 q, float a, float h) {
    vec2 r = a < 1.5 ? vec2(q.y, q.x) : a < 2.5 ? q : vec2(-q.y, -q.x);
    r.y = -r.y;
    float stem = sdBox(r - vec2(0.0, -0.18 * h), vec2(0.16 * h, 0.45 * h), 0.04 * h);
    float head = max(abs(r.x) * 0.9 + (r.y - 0.70 * h), -(r.y - 0.08 * h));
    return max(cov(stem), cov(head));
}
vec4 light(vec2 q, float H, float s, float a) {
    float W = H * 0.44, R = H * 0.135;
    if (s < 0.5) return vec4(0.0);
    float body = sdBox(q, vec2(W * 0.5, H * 0.5), W * 0.22);
    vec4 c = vec4(0.0);
    if (s > 5.5) {
        // uncertain: the housing's outline and three hollow lamps, no colour at all
        c = vec4(vec3(0.62), cov(abs(body) - 1.1) * 0.9);
        for (int i = 0; i < 3; i++) {
            float d = length(q - vec2(0.0, (float(i) - 1.0) * H * 0.30)) - R;
            c = mix(c, vec4(vec3(0.62), 1.0), cov(abs(d) - 0.9));
        }
        return c;
    }
    // the housing: printed dark grey, a lighter keyline, a soft light from above
    float shade = 0.11 + 0.06 * clamp(-q.y / H + 0.5, 0.0, 1.0);
    c = vec4(vec3(shade), cov(body));
    c.rgb = mix(c.rgb, vec3(0.42), cov(abs(body + 1.0) - 0.7) * 0.8);
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 lq = q - vec2(0.0, (fi - 1.0) * H * 0.30);
        float d = length(lq) - R;
        float on = lit(fi, s);
        vec3 lc = lampCol(fi);
        vec3 dark = lc * 0.10 + vec3(0.05);
        vec3 bright = mix(lc, vec3(1.0), 0.30 * clamp(1.0 - length(lq - vec2(-0.3, -0.35) * R) / R, 0.0, 1.0));
        if (fi > 1.5 && a > 0.5 && s > 3.5 && s < 4.5) {
            // a green arrow: the lamp stays dark, the arrow is lit
            c.rgb = mix(c.rgb, dark, cov(d));
            c.rgb = mix(c.rgb, lc, arrow(lq, a, R * 0.85) * cov(d));
        } else {
            c.rgb = mix(c.rgb, on > 0.5 ? bright : dark, cov(d));
            // the lit lamp's glow on the housing (inside the pictogram only)
            if (on > 0.5) c.rgb = mix(c.rgb, lc, 0.35 * (1.0 - smoothstep(0.0, R * 0.7, d)) * step(0.0, d) * cov(body));
        }
    }
    // flashing amber: two short marks beside the amber lamp (steady)
    if (s > 4.5) {
        vec2 m = vec2(abs(q.x) - (W * 0.5 + 0.11 * H), q.y);
        c = mix(c, vec4(lampCol(1.0), 1.0), cov(sdBox(m, vec2(0.05 * H, 0.018 * H), 0.018 * H)));
    }
    return c;
}
vec4 signAt(vec2 p, vec4 it, vec4 ce) {
    vec2 u = (p - it.xy) / it.z + 0.5;
    if (u.x < 0.0 || u.y < 0.0 || u.x > 1.0 || u.y > 1.0) return vec4(0.0);
    float d = 0.25 * ce.z / it.z;          // a quarter of a screen pixel, in atlas px: a 4-tap box when shrunk
    vec2 t = ce.xy + u * ce.zw;
    vec4 s = texture2D(u_atlas, (t + vec2(-d, -d)) / u_asz) + texture2D(u_atlas, (t + vec2(d, -d)) / u_asz)
           + texture2D(u_atlas, (t + vec2(-d, d)) / u_asz) + texture2D(u_atlas, (t + vec2(d, d)) / u_asz);
    return s * 0.25;
}

void main() {
    vec2 p = v_uv * u_size;
    vec4 col = vec4(0.0);
    for (int i = 0; i < 3; i++) {
        vec4 it = u_it[i];
        vec4 c = vec4(0.0);
        if (it.w > 1.5) c = light(p - it.xy, it.z, u_lt.x, u_lt.y);
        else if (it.w > 0.5) c = signAt(p, it, u_ce[i]);
        col = vec4(mix(col.rgb, c.rgb, c.a), max(col.a, c.a));
    }
    gl_FragColor = vec4(col.rgb * u_k.x, col.a);
}
`;

/* ------------------------------------------------------------------ the Twin Dial strip --------------------------------- */

const RV_STRIP_TD = HEAD + `// Road View, Twin Dial: a slot beside the speed-limit sign (the light in thin lines) or a sign from the atlas. Our own drawing.
uniform sampler2D u_atlas;
uniform vec2 u_asz;          // the atlas, px
uniform vec4 u_it[2];        // items: centre x, y (layer px), size (px), kind (0 none, 1 sign, 2 light)
uniform vec4 u_ce[2];        // a sign's atlas cell (atlas px)
uniform vec4 u_lt;           // the light: state, arrow, 0, 0
uniform vec3 u_fg;           // the theme's line colour (night colours included)
uniform vec4 u_k;            // the signs' brightness (night), 0, 0, 0

float sdBox(vec2 q, vec2 h, float r) { vec2 e = abs(q) - h + vec2(r); return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r; }
float cov(float d) { return clamp(0.5 - d, 0.0, 1.0); }
vec3 lampCol(float i) { return i < 0.5 ? vec3(0.90, 0.12, 0.10) : i < 1.5 ? vec3(0.98, 0.66, 0.08) : vec3(0.24, 0.78, 0.36); }
float lit(float i, float s) {
    if (i < 0.5) return (s > 0.5 && s < 2.5) ? 1.0 : 0.0;
    if (i < 1.5) return (s > 1.5 && s < 3.5) || (s > 4.5 && s < 5.5) ? 1.0 : 0.0;
    return (s > 3.5 && s < 4.5) ? 1.0 : 0.0;
}
float arrow(vec2 q, float a, float h) {
    vec2 r = a < 1.5 ? vec2(q.y, q.x) : a < 2.5 ? q : vec2(-q.y, -q.x);
    r.y = -r.y;
    float stem = sdBox(r - vec2(0.0, -0.18 * h), vec2(0.16 * h, 0.45 * h), 0.04 * h);
    float head = max(abs(r.x) * 0.9 + (r.y - 0.70 * h), -(r.y - 0.08 * h));
    return max(cov(stem), cov(head));
}
vec4 light(vec2 q, float H, float s, float a) {
    float W = H * 0.42, R = H * 0.125;
    if (s < 0.5) return vec4(0.0);
    float line = s > 5.5 ? 0.75 : 1.0;                  // uncertain: everything fainter, nothing filled
    float body = sdBox(q, vec2(W * 0.5, H * 0.5), W * 0.30);
    vec4 c = vec4(u_fg, cov(abs(body) - 0.8) * 0.85 * line);
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 lq = q - vec2(0.0, (fi - 1.0) * H * 0.30);
        float d = length(lq) - R;
        float on = s > 5.5 ? 0.0 : lit(fi, s);
        vec3 lc = lampCol(fi);
        if (fi > 1.5 && a > 0.5 && s > 3.5 && s < 4.5) {
            c = mix(c, vec4(u_fg, 1.0), cov(abs(d) - 0.6) * 0.7);
            c = mix(c, vec4(lc, 1.0), arrow(lq, a, R * 0.9));
        } else if (on > 0.5) c = mix(c, vec4(lc, 1.0), cov(d));
        else c = mix(c, vec4(u_fg, 1.0), cov(abs(d) - 0.6) * 0.6 * line);
    }
    if (s > 4.5 && s < 5.5) {
        vec2 m = vec2(abs(q.x) - (W * 0.5 + 0.11 * H), q.y);
        c = mix(c, vec4(lampCol(1.0), 1.0), cov(sdBox(m, vec2(0.05 * H, 0.018 * H), 0.018 * H)));
    }
    return c;
}
vec4 signAt(vec2 p, vec4 it, vec4 ce) {
    vec2 u = (p - it.xy) / it.z + 0.5;
    if (u.x < 0.0 || u.y < 0.0 || u.x > 1.0 || u.y > 1.0) return vec4(0.0);
    return texture2D(u_atlas, (ce.xy + u * ce.zw) / u_asz);
}

void main() {
    vec2 p = v_uv * u_size;
    vec4 col = vec4(0.0);
    for (int i = 0; i < 2; i++) {
        vec4 it = u_it[i];
        vec4 c = vec4(0.0);
        if (it.w > 1.5) c = light(p - it.xy, it.z, u_lt.x, u_lt.y);
        else if (it.w > 0.5) { c = signAt(p, it, u_ce[i]); c.rgb *= u_k.x; }
        col = vec4(mix(col.rgb, c.rgb, c.a), max(col.a, c.a));
    }
    gl_FragColor = col;
}
`;

/* ------------------------------------------------------------------ the scenes ------------------------------------------ */

// The perspective both scenes share (as ACC View's acc_lane): the horizon at u_view.x of the height, u_view.y px a metre at the
// foot, u_view.z = 1 / (the far end's scale) - 1, u_view.w the range (m). A world point (x m ahead, y m left) is drawn at
// t = 1 / (1 + x / range * kf): y_px = hy + (H - hy) t, x_px = W / 2 - y * pxm * t.
const SCENE_COMMON = `uniform vec4 u_view;     // horizon share, px a metre at the foot, kf, range (m)
uniform vec4 u_ln[4];    // lines: offset at 0 m (m, left +), heading (rad), curvature (1/m), type (0 none 1 solid 2 dashed 3 double 4 edge)
uniform vec4 u_lp[4];    // lines: valid length (m), strength (0..1), 0, 0
uniform vec4 u_ego;      // our lane: centre offset (m), heading, curvature, half width (m)
uniform vec4 u_ob[8];    // road users: x (m ahead), y (m left), class (1 car 2 truck 3 two-wheeler 4 pedestrian 5 cyclist 6 other; +10 the one ahead of us), alpha
uniform vec4 u_lt;       // the light: state (0 none ..), arrow, x (m ahead; 0 = the far end), 0
uniform vec4 u_fl;       // flags: no lane data (1: a faint guide of our lane), shown (0..1), 0, 0

float sdBox(vec2 q, vec2 h, float r) { vec2 e = abs(q) - h + vec2(r); return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r; }
float cov(float d) { return clamp(0.5 - d, 0.0, 1.0); }
float tOf(float x) { return 1.0 / (1.0 + x / u_view.w * u_view.z); }
vec3 lampCol(float i) { return i < 0.5 ? vec3(0.90, 0.12, 0.10) : i < 1.5 ? vec3(0.98, 0.66, 0.08) : vec3(0.24, 0.78, 0.36); }
float lit(float i, float s) {
    if (i < 0.5) return (s > 0.5 && s < 2.5) ? 1.0 : 0.0;
    if (i < 1.5) return (s > 1.5 && s < 3.5) || (s > 4.5 && s < 5.5) ? 1.0 : 0.0;
    return (s > 3.5 && s < 4.5) ? 1.0 : 0.0;
}
`;

const RV_SCENE_TD = HEAD + `// Road View, Twin Dial: the road scene on the centre page (thin lines, flat road users). Our own drawing.
` + SCENE_COMMON + `uniform vec3 u_fg;       // the theme's line colour (night included)
uniform vec3 u_dim;      // the theme's dim colour

// a road user seen from behind, flat: w, h its box (px), q from its wheel line's centre (y up = negative)
float user(vec2 q, float w, float h, float cls) {
    if (cls > 3.5 && cls < 5.5) {          // a pedestrian / a cyclist: a capsule and a head
        float b = sdBox(q - vec2(0.0, -0.40 * h), vec2(0.18 * w, 0.32 * h), 0.18 * w);
        float hd = length(q - vec2(0.0, -0.86 * h)) - 0.13 * h;
        return cov(min(b, hd));
    }
    float body = sdBox(q - vec2(0.0, -0.36 * h), vec2(0.5 * w, 0.26 * h), 0.12 * w);
    float cab = sdBox(q - vec2(0.0, -0.76 * h), vec2(0.34 * w, 0.18 * h), 0.10 * w);
    float wl = sdBox(vec2(abs(q.x) - 0.34 * w, q.y + 0.05 * h), vec2(0.10 * w, 0.06 * h), 0.03 * w);
    return cov(min(min(body, cls > 1.5 && cls < 2.5 ? 1e3 : cab), wl));
}

void main() {
    vec2 p = v_uv * u_size;
    float W = u_size.x, H = u_size.y, hy = u_view.x * H;
    vec4 c = vec4(0.0);
    float t = (p.y - hy) / (H - hy);
    if (t > 0.0) {
        float xm = (1.0 / t - 1.0) / u_view.z * u_view.w;
        float k = u_view.y * t;
        float ym = (0.5 * W - p.x) / k;
        float fade = 1.0 - smoothstep(0.55 * u_view.w, u_view.w, xm);
        // our lane, faintly filled
        float ce = u_ego.x + xm * (u_ego.y + 0.5 * u_ego.z * xm);
        float inl = 1.0 - smoothstep(u_ego.w - 0.15, u_ego.w + 0.15, abs(ym - ce));
        c = vec4(u_fg, 0.07 * inl * fade * (1.0 - u_fl.x));
        for (int i = 0; i < 4; i++) {
            vec4 l = u_ln[i];
            vec4 q = u_lp[i];
            if (l.w > 0.5 && xm < q.x) {
                float d = abs(ym - (l.x + xm * (l.y + 0.5 * l.z * xm))) * k;
                float lw = max(1.0, 0.12 * k);
                if (l.w > 2.5 && l.w < 3.5) d = abs(d - 1.6 * lw);
                float on = cov(d - lw * 0.5);
                float dash = (l.w > 1.5 && l.w < 2.5) ? step(fract(xm / 12.0), 0.5) : 1.0;
                float a = on * dash * fade * q.y * (l.w > 3.5 ? 0.45 : 0.9) * (1.0 - smoothstep(q.x - 8.0, q.x, xm));
                c = mix(c, vec4(u_fg, 1.0), a);
            }
        }
        // no lane data: a faint dotted guide of our lane (never the measured look)
        if (u_fl.x > 0.5) {
            float d = (abs(abs(ym) - 1.75)) * k;
            c = mix(c, vec4(u_dim, 1.0), cov(d - 0.6) * step(fract(xm / 4.0), 0.3) * 0.5 * fade);
        }
    }
    // the road users, far first (the app sends them near first; each is drawn over what is behind it)
    for (int i = 7; i >= 0; i--) {
        vec4 o = u_ob[i];
        if (o.w > 0.01) {
            float lead = o.z > 9.5 ? 1.0 : 0.0;
            float cls = o.z - 10.0 * lead;
            float tt = tOf(o.x);
            float k2 = u_view.y * tt;
            vec2 base = vec2(0.5 * W - o.y * k2, hy + (H - hy) * tt);
            float wm = cls > 1.5 && cls < 2.5 ? 2.5 : cls > 2.5 ? 0.8 : 1.8;
            float hm = cls > 1.5 && cls < 2.5 ? 3.0 : cls > 2.5 ? 1.7 : 1.45;
            float a = user(p - base, wm * k2, hm * k2, cls) * o.w;
            c = mix(c, vec4(lead > 0.5 ? u_fg : u_dim, 1.0), a);
        }
    }
    // our own car at the foot: an outline, so it never reads as the car ahead
    vec2 eq = p - vec2(0.5 * W, H + 4.0);
    float ew = 1.8 * u_view.y * 0.62, eh = 1.45 * u_view.y * 0.62;
    float eb = min(sdBox(eq - vec2(0.0, -0.36 * eh), vec2(0.5 * ew, 0.26 * eh), 0.12 * ew), sdBox(eq - vec2(0.0, -0.76 * eh), vec2(0.34 * ew, 0.18 * eh), 0.10 * ew));
    c = mix(c, vec4(u_dim, 1.0), cov(abs(eb) - 0.8) * 0.8);
    // the traffic light far ahead, over our lane (the same pictogram as the strip, in lines)
    if (u_lt.x > 0.5) {
        float lx = u_lt.z > 0.5 ? u_lt.z : u_view.w * 0.55;
        float tl = tOf(lx);
        float Hh = max(24.0, 3.4 * u_view.y * tl);
        vec2 lc = vec2(0.5 * W - (u_ego.x + lx * (u_ego.y + 0.5 * u_ego.z * lx)) * u_view.y * tl, hy + (H - hy) * tl - 3.0 * u_view.y * tl - Hh * 0.5);
        lc.y = max(lc.y, Hh * 0.5 + 2.0);
        vec2 q = p - lc;
        float s = u_lt.x;
        float body = sdBox(q, vec2(Hh * 0.21, Hh * 0.5), Hh * 0.12);
        float line = s > 5.5 ? 0.75 : 1.0;
        c = mix(c, vec4(0.0, 0.0, 0.0, 1.0), cov(body) * 0.85);
        c = mix(c, vec4(u_fg, 1.0), cov(abs(body) - 0.8) * 0.85 * line);
        for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float d = length(q - vec2(0.0, (fi - 1.0) * Hh * 0.30)) - Hh * 0.125;
            float on = s > 5.5 ? 0.0 : lit(fi, s);
            if (on > 0.5) c = mix(c, vec4(lampCol(fi), 1.0), cov(d));
            else c = mix(c, vec4(u_fg, 1.0), cov(abs(d) - 0.6) * 0.6 * line);
        }
    }
    gl_FragColor = vec4(c.rgb, c.a * u_fl.y);
}
`;

const RV_SCENE_6WB = HEAD + `// Road View, f30_cluster 6WB Comfort: the road scene in the centre window (printed greys, a soft road surface). Our own drawing.
` + SCENE_COMMON + `uniform vec4 u_k;        // brightness (night), 0, 0, 0

// a road user from behind, shaded grey (no maker's shape): returns colour and coverage
vec4 user(vec2 q, float w, float h, float cls, float lead) {
    vec3 base = lead > 0.5 ? vec3(0.86) : vec3(0.55);
    if (cls > 3.5 && cls < 5.5) {
        float b = sdBox(q - vec2(0.0, -0.40 * h), vec2(0.18 * w, 0.32 * h), 0.18 * w);
        float hd = length(q - vec2(0.0, -0.86 * h)) - 0.13 * h;
        return vec4(base, cov(min(b, hd)));
    }
    float body = sdBox(q - vec2(0.0, -0.36 * h), vec2(0.5 * w, 0.26 * h), 0.12 * w);
    float cab = cls > 1.5 && cls < 2.5 ? 1e3 : sdBox(q - vec2(0.0, -0.76 * h), vec2(0.34 * w, 0.18 * h), 0.10 * w);
    float wl = sdBox(vec2(abs(q.x) - 0.34 * w, q.y + 0.05 * h), vec2(0.10 * w, 0.06 * h), 0.03 * w);
    float win = sdBox(q - vec2(0.0, -0.76 * h), vec2(0.26 * w, 0.11 * h), 0.06 * w);
    float k = cov(min(min(body, cab), wl));
    vec3 col = base * (0.80 + 0.20 * clamp(-q.y / h, 0.0, 1.0));
    col = mix(col, vec3(0.10), cov(wl));
    col = mix(col, vec3(0.16), cov(win) * step(cab, 1e2));
    col = mix(col, vec3(0.20), cov(sdBox(q - vec2(0.0, -0.40 * h), vec2(0.40 * w, 0.03 * h), 0.02 * w)));
    return vec4(col, k);
}

void main() {
    vec2 p = v_uv * u_size;
    float W = u_size.x, H = u_size.y, hy = u_view.x * H;
    vec4 c = vec4(0.0);
    float t = (p.y - hy) / (H - hy);
    if (t > 0.0) {
        float xm = (1.0 / t - 1.0) / u_view.z * u_view.w;
        float k = u_view.y * t;
        float ym = (0.5 * W - p.x) / k;
        float fade = 1.0 - smoothstep(0.50 * u_view.w, u_view.w, xm);
        float side = smoothstep(0.0, 60.0, min(p.x, W - p.x));
        // the road surface: a soft grey band under our lane and its neighbours, as the 6WB's floor
        float ce = u_ego.x + xm * (u_ego.y + 0.5 * u_ego.z * xm);
        float aX = abs(ym - ce) / u_ego.w;
        c = vec4(vec3(0.16), (0.22 + 0.30 * t) * (1.0 - smoothstep(2.4, 5.0, aX)) * fade * side);
        for (int i = 0; i < 4; i++) {
            vec4 l = u_ln[i];
            vec4 q = u_lp[i];
            if (l.w > 0.5 && xm < q.x) {
                float d = abs(ym - (l.x + xm * (l.y + 0.5 * l.z * xm))) * k;
                float lw = max(1.2, 0.13 * k);
                if (l.w > 2.5 && l.w < 3.5) d = abs(d - 1.5 * lw);
                float on = cov(d - lw * 0.5);
                float glow = (1.0 - smoothstep(0.0, lw * 2.0 + 2.0, d)) * 0.20;
                float dash = (l.w > 1.5 && l.w < 2.5) ? step(fract(xm / 12.0), 0.5) : 1.0;
                float a = max(on, glow) * dash * fade * q.y * (1.0 - smoothstep(q.x - 8.0, q.x, xm)) * side;
                c = mix(c, vec4(l.w > 3.5 ? vec3(0.55) : vec3(0.88), 1.0), a);
            }
        }
        if (u_fl.x > 0.5) {
            float d = (abs(abs(ym) - 1.75)) * k;
            c = mix(c, vec4(vec3(0.45), 1.0), cov(d - 0.7) * step(fract(xm / 4.0), 0.3) * 0.5 * fade * side);
        }
    }
    for (int i = 7; i >= 0; i--) {
        vec4 o = u_ob[i];
        if (o.w > 0.01) {
            float lead = o.z > 9.5 ? 1.0 : 0.0;
            float cls = o.z - 10.0 * lead;
            float tt = tOf(o.x);
            float k2 = u_view.y * tt;
            vec2 base = vec2(0.5 * W - o.y * k2, hy + (H - hy) * tt);
            float wm = cls > 1.5 && cls < 2.5 ? 2.5 : cls > 2.5 ? 0.8 : 1.8;
            float hm = cls > 1.5 && cls < 2.5 ? 3.0 : cls > 2.5 ? 1.7 : 1.45;
            vec4 u = user(p - base, wm * k2, hm * k2, cls, lead);
            c = vec4(mix(c.rgb, u.rgb, u.a * o.w), max(c.a, u.a * o.w));
        }
    }
    if (u_lt.x > 0.5) {
        float lx = u_lt.z > 0.5 ? u_lt.z : u_view.w * 0.55;
        float tl = tOf(lx);
        float Hh = max(26.0, 3.6 * u_view.y * tl);
        vec2 lc = vec2(0.5 * W - (u_ego.x + lx * (u_ego.y + 0.5 * u_ego.z * lx)) * u_view.y * tl, hy + (H - hy) * tl - 3.0 * u_view.y * tl - Hh * 0.5);
        lc.y = max(lc.y, Hh * 0.5 + 2.0);
        vec2 q = p - lc;
        float s = u_lt.x;
        float body = sdBox(q, vec2(Hh * 0.22, Hh * 0.5), Hh * 0.10);
        if (s > 5.5) c = mix(c, vec4(vec3(0.62), 1.0), cov(abs(body) - 1.0) * 0.9);
        else {
            c = mix(c, vec4(vec3(0.12 + 0.05 * clamp(-q.y / Hh + 0.5, 0.0, 1.0)), 1.0), cov(body));
            c = mix(c, vec4(vec3(0.42), 1.0), cov(abs(body + 1.0) - 0.7) * 0.8);
        }
        for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float d = length(q - vec2(0.0, (fi - 1.0) * Hh * 0.30)) - Hh * 0.13;
            float on = s > 5.5 ? 0.0 : lit(fi, s);
            vec3 lc2 = lampCol(fi);
            if (s > 5.5) c = mix(c, vec4(vec3(0.62), 1.0), cov(abs(d) - 0.8));
            else c = mix(c, vec4(on > 0.5 ? lc2 : lc2 * 0.10 + vec3(0.05), 1.0), cov(d));
        }
    }
    gl_FragColor = vec4(c.rgb * u_k.x, c.a * u_fl.y);
}
`;

const SOURCES = { rv_strip_6wb: RV_STRIP_6WB, rv_strip_td: RV_STRIP_TD, rv_scene_td: RV_SCENE_TD, rv_scene_6wb: RV_SCENE_6WB };

/** What the app sends: no comments, no blank lines, no runs of spaces (GLSL ES 1.00 has no strings: "//" always starts a comment). */
function ship(src) {
    return String(src).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '').replace(/[ \t]+/g, ' ').trim())
        .filter((l) => l.length).join('\n') + '\n';
}
const cache = {};
function shipped(name) { if (!SOURCES[name]) return null; if (!cache[name]) cache[name] = ship(SOURCES[name]); return cache[name]; }

/** The light's state and arrow as the shaders read them (u_lt.x, u_lt.y). */
const LIGHT_CODE = { none: 0, red: 1, redAmber: 2, amber: 3, green: 4, flashAmber: 5, uncertain: 6 };
const ARROW_CODE = { left: 1, straight: 2, right: 3 };

module.exports = { SOURCES, ship, shipped, LIGHT_CODE, ARROW_CODE };
