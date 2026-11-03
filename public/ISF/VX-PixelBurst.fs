/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A figure made of big square pixels that blows apart on the beat. The voice draws a crisp pixel figure, a symmetric creature, a shaded globe or a stepped diamond, and every hit of the sound it follows explodes it: its pixels fly out in depth, the near ones growing as they rush past, each one spinning on its own, and then the whole figure snaps back together. A new figure grows every few bars. Pixels sets how many pixels make the figure; Force how far they fly; Spin how much they tumble; Settle how long they take to come home; Figure picks the figure.",
    "PASSES": [
        {
            "TARGET": "fig",
            "FLOAT": true,
            "WIDTH": 64,
            "HEIGHT": 64
        },
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "pixels", "LABEL": "Pixels", "TYPE": "float", "DEFAULT": 20, "MIN": 10, "MAX": 40 },
        { "NAME": "force", "LABEL": "Force", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "settle", "LABEL": "Settle", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "figure", "LABEL": "Figure", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3], "LABELS": ["Changes every few bars", "Creature", "Globe", "Diamond"] },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.41, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Fill", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Edges", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): r last count seen, g the clock (mod 32 s) at the last hit,
// b a rough count of seconds since it, so a long silence reads as long ago.
// fig (64x64): the figure, one texel per pixel, r tone (-1 empty), g edge.

const float TAU = 6.2831853;
const int LAYERS = 6;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// The figure at cell c of a G by G grid centred on 0: -1 empty, else a
// tone 0-1.
float cellTone(vec2 c, float G, float kind, float fs) {
    float h = G * 0.5;
    vec2 u = (c + 0.5) / h;          // -1..1 over the figure
    if (abs(u.x) > 1.0 || abs(u.y) > 1.0) return -1.0;
    if (kind < 0.5) {
        // A symmetric creature: a mirrored 10 by 10 sprite, each sprite
        // cell made of several of the figure's pixels.
        vec2 m = vec2(abs(u.x), u.y);
        float sx = min(floor(m.x * 5.0), 4.0);
        float sy = min(floor((u.y + 1.0) * 5.0), 9.0);
        float dens = 0.78 - 0.1 * sx + ((sy > 2.5 && sy < 7.5) ? 0.12 : -0.15) - ((sy < 0.5 || sy > 8.5) ? 0.25 : 0.0);
        bool on = hash21(vec2(sx, sy) + fs * 11.0) < dens;
        if (sx < 0.5 && sy > 1.5 && sy < 8.5) on = true;
        // Eyes.
        float ex = 1.0 + floor(hash11(fs + 2.0) * 2.0);
        float ey = 5.0 + floor(hash11(fs + 3.0) * 2.0);
        if (sx == ex && sy == ey) on = false;
        if (sx == ex && sy == ey - 1.0) on = true;
        if (!on) return -1.0;
        float nz = vnoise(m * 3.0 + fs * 7.0);
        float lit = 0.6 + u.y * 0.35 - u.x * 0.15 + (nz - 0.5) * 0.3;
        return clamp(lit + mod(c.x + c.y, 2.0) * 0.08, 0.15, 1.0);
    } else if (kind < 1.5) {
        // A shaded globe, stepped and dithered.
        float r2 = dot(u, u);
        if (r2 > 0.92) return -1.0;
        vec3 nrm = vec3(u, sqrt(max(0.92 - r2, 0.0)));
        nrm = normalize(nrm);
        float dif = max(dot(nrm, normalize(vec3(-0.5, 0.6, 0.65))), 0.0);
        float d2 = mod(c.x + c.y, 2.0) * 0.12;
        return clamp(dif + d2 - 0.06, 0.12, 1.0);
    }
    // A stepped diamond of rings.
    float dd = (abs(c.x + 0.5) + abs(c.y + 0.5)) / h;
    if (dd > 1.0) return -1.0;
    float ring = floor(dd * h / 2.0);
    if (mod(ring, 3.0) > 1.5) return -1.0;
    return clamp(1.0 - dd * 0.8, 0.0, 1.0);
}

vec2 rot(vec2 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

void main() {
    float n = floor(vxCount + 0.5);
    float rs = floor(clamp(seed, 0.0, 1.0) * 127.0 + 0.5);

    // Which figure: a new one every four bars unless one is picked.
    float era = floor(vxBars / 4.0);
    float kind = figure == 0 ? mod(floor(hash11(era * 1.37 + rs) * 3.0), 3.0) : float(figure - 1);
    float fs = rs * 0.731 + (figure == 0 ? era * 3.17 : 0.0);
    float G = floor(clamp(pixels, 10.0, 40.0) + 0.5);
    G = 2.0 * floor(G * 0.5);

    if (PASSINDEX == 0) {
        vec2 fc = floor(gl_FragCoord.xy) - 32.0;
        float tn = cellTone(fc, G, kind, fs);
        float edge = 0.0;
        if (tn > -0.5 && (cellTone(fc + vec2(1.0, 0.0), G, kind, fs) < -0.5 || cellTone(fc - vec2(1.0, 0.0), G, kind, fs) < -0.5
            || cellTone(fc + vec2(0.0, 1.0), G, kind, fs) < -0.5 || cellTone(fc - vec2(0.0, 1.0), G, kind, fs) < -0.5)) edge = 1.0;
        gl_FragColor = vec4(tn, edge, 0.0, 1.0);
        return;
    }

    if (PASSINDEX == 1) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 0.0, 30.0, 0.0);
        bool newHit = abs(n - c.r) > 0.5;
        float stamp = newHit ? mod(TIME, 32.0) : c.g;
        float since = newHit ? 0.0 : min(c.b + dt, 30.0);
        gl_FragColor = vec4(n, stamp, since, 1.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = mod(mod(TIME, 32.0) - clk.g + 32.0, 32.0);
    if (clk.b > 8.0) age = 30.0;
    float t = vxPhase;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;

    float size = 0.74;
    float cs = size / G;

    // The figure bobs gently.
    vec2 home = vec2(sin(t * 0.37) * 0.02, sin(t * 0.53) * 0.012);

    // The burst: out fast, a drift, then home with a snap.
    float T = mix(0.12, 0.6, settle);
    float vel = mix(0.7, 1.0, clamp(vxVel, 0.0, 1.0));
    float out0 = 1.0 - exp(-(age + 0.03) * 16.0);
    float back = smoothstep(T * 0.5, T, age);
    back = back * back * (3.0 - 2.0 * back);
    float b = n < 0.5 ? 0.0 : out0 * (1.0 - back) * force * vel;
    b *= 1.0 + 0.6 * age * (1.0 - back);
    float hs = n * 1.618 + rs * 0.37;
    vec2 blast = vec2((hash11(hs + 0.2) - 0.5) * 0.4, (hash11(hs + 0.4) - 0.5) * 0.3);

    vec3 col = vec3(0.0);
    float found = 0.0;
    // Front to back: layer 0 is the one rushing at the eye.
    for (int li = 0; li < LAYERS; li++) {
        if (found > 0.5) break;
        float l = float(li);
        // Together, every layer sits in the same place: look in all at once.
        bool together = b < 0.0005;
        if (together && li > 0) break;
        float z = mix(2.6, -0.55, l / float(LAYERS - 1));     // depth push
        float s = max(1.0 + b * z, 0.15);
        float ang = b * (hash11(l * 3.1 + hs) - 0.5) * 1.6 * spin;
        vec2 o = home + (blast * (1.0 - s)) + b * vec2(hash11(l * 5.7 + hs) - 0.5, hash11(l * 6.3 + hs) - 0.6) * 0.3;
        vec2 q = rot(p - o, -ang) / s;
        vec2 cid = floor(q / cs);
        for (int j = 0; j < 9; j++) {
            vec2 c = cid + vec2(mod(float(j), 3.0) - 1.0, floor(float(j) / 3.0) - 1.0);
            // Each pixel lives on one layer.
            float lay = floor(hash21(c + fs * 13.0 + 0.5) * float(LAYERS));
            if (!together && abs(lay - l) > 0.5) continue;
            if (abs(c.x + 0.5) > G * 0.5 || abs(c.y + 0.5) > G * 0.5) continue;
            vec2 fv = IMG_NORM_PIXEL(fig, (c + 32.5) / 64.0).rg;
            float tone = fv.x;
            if (tone < -0.5) continue;
            vec2 rnd = vec2(hash21(c + hs), hash21(c + hs + 17.0)) - 0.5;
            vec2 ctr = (c + 0.5) * cs + rnd * cs * 0.9 * min(b * 2.0, 1.0);
            float spinA = b * (hash21(c * 1.3 + hs + 5.0) - 0.5) * 6.0 * spin;
            vec2 d = rot(q - ctr, -spinA);
            float half0 = cs * mix(0.5, 0.42, min(b * 3.0, 1.0));
            float aa = px / s * 1.2;
            float m = 1.0 - smoothstep(half0 - aa, half0, max(abs(d.x), abs(d.y)));
            if (m <= 0.0) continue;
            // Edge pixels of the figure take the edge colour.
            float edge = fv.y;
            vec3 tc = tone > 0.62 ? ink.rgb : (tone > 0.3 ? mix(accent.rgb, ink.rgb, 0.15) : accent.rgb * 0.5);
            tc = mix(tc, mix(accent.rgb, ink.rgb, 0.2) * 1.1, edge * 0.8);
            // A shimmer that travels over the figure between hits.
            float sh = 0.5 + 0.5 * sin((c.x * 0.6 - c.y) * 0.5 - t * 2.2);
            tc *= 0.82 + 0.18 * sh * sh;
            // A bevel: lit top-left, shaded bottom-right, so pixels read as tiles.
            float bev = clamp((d.y - d.x) / half0, -1.0, 1.0);
            tc *= 1.0 + 0.12 * bev * smoothstep(0.6, 1.0, max(abs(d.x), abs(d.y)) / half0);
            // Near pixels are brighter, far ones sink into the dark.
            tc *= clamp(1.0 + (s - 1.0) * 0.35, 0.35, 1.4);
            col = tc * m;
            found = 1.0;
            break;
        }
    }

    // The tiny glow of the burst centre while it is out.
    col += accent.rgb * 0.06 * b * exp(-length(p - home - blast) * 4.0);

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
