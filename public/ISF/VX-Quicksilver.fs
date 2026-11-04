/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Beads of liquid mercury roll around each other, merging into one mirror-bright pool and pinching apart again, with crisp reflections of a studio sky sliding over their curves. Every hit bursts the pool into flying droplets that slowly gather back together; a held sound sets the surface trembling, and pitch turns the whole cluster.",
    "PASSES": [
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "burst", "LABEL": "Burst", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "tremble", "LABEL": "Tremble", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "roam", "LABEL": "Roam", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "amount", "LABEL": "Amount", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "tint", "LABEL": "Tint", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Sky", "TYPE": "color", "DEFAULT": [0.75, 0.88, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Edge light", "TYPE": "color", "DEFAULT": [1.0, 0.5, 0.25, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const int BIG = 7;
const int SMALL = 10;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// A photo studio wrapped around the metal: bright sky with long softboxes,
// a crisp dark horizon, a dim floor, coloured light from the sides.
vec3 studio(vec3 r, float t) {
    float up = r.y;
    vec3 sky = mix(ink.rgb * 0.6 + 0.25, vec3(1.0), smoothstep(0.2, 0.9, up));
    vec3 ground = mix(vec3(0.05), accent.rgb * 0.12 + 0.04, smoothstep(-0.2, -0.9, up));
    float hz = smoothstep(-0.02, 0.03, up);
    vec3 c = mix(ground, sky * (0.55 + 0.45 * hz), hz);
    // Dark band just above the horizon makes the classic chrome line.
    c *= 1.0 - 0.75 * exp(-pow((up - 0.06) / 0.035, 2.0));
    // Softboxes overhead, slowly turning.
    float az = atan(r.x, r.z) + t * 0.15;
    float boxes = smoothstep(0.82, 0.86, sin(az * 3.0)) * smoothstep(0.35, 0.45, up);
    c += vec3(1.3) * boxes;
    // Rim light from the side in the accent colour.
    float side = pow(max(dot(r, normalize(vec3(-1.0, 0.25, 0.4))), 0.0), 6.0);
    c += accent.rgb * side * 1.6;
    float side2 = pow(max(dot(r, normalize(vec3(1.0, 0.1, 0.3))), 0.0), 10.0);
    c += mix(ink.rgb, vec3(1.0), 0.3) * side2 * 0.8;
    return c;
}

void main() {
    float n = floor(vxCount + 0.5);
    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        // An all-zero texel means a fresh buffer (the voice was just added):
        // start from "no hit for a long time" rather than a fake hit.
        if (c.a < 0.5) c = vec4(n, 30.0, 0.0, 1.0);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g + dt, 30.0);
        float vel = newHit ? clamp(vxVel, 0.4, 1.0) : c.b;
        gl_FragColor = vec4(n, age, vel, 1.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    bool fresh = clk.a < 0.5;
    float age = fresh ? 30.0 : clk.g;
    float hv = fresh ? 0.0 : clk.b;
    if (vxHit > 0.01) {
        age = min(age, 0.12 + (1.0 - clamp(vxHit, 0.0, 1.0)) * 0.2);
        hv = max(hv, max(vxVel, 0.5));
    }
    // Thrown out fast, gathered back slowly.
    float spray = hv * burst * (1.0 - exp(-age * 14.0)) * exp(-age * 1.3);

    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    p *= max(1.0, 1.4 / aspect);
    bool clearMode = vxClear;
    float t = vxPhase * 0.12 + TIME * 0.06;
    float energy = clamp(vxEnv, 0.0, 1.0);
    float spin = (vxGlide - 0.5) * 2.0 + t * 0.1;

    float sizeK = mix(0.75, 1.25, amount);
    float f = 0.0;
    vec2 g = vec2(0.0);
    float heat = 0.0;
    for (int i = 0; i < BIG + SMALL; i++) {
        float fi = float(i);
        bool isSmall = i >= BIG;
        float h1 = hash11(fi * 1.73 + 0.3);
        float h2 = hash11(fi * 4.11 + 1.7);
        float r;
        vec2 c;
        if (!isSmall) {
            // Big beads circle the middle on their own slow loops.
            float a = fi * 0.8976 + spin + t * (0.2 + 0.25 * h1) * (h2 > 0.5 ? 1.0 : -1.0);
            float rad = (0.1 + 0.32 * h2) * mix(0.5, 1.4, roam);
            c = vec2(cos(a), sin(a) * 0.8) * rad + 0.04 * vec2(sin(t * 1.3 + fi), cos(t * 1.1 + fi * 2.0));
            // Thrown outward on a hit.
            float sa = fi * 2.3999 + n * 1.7;
            c += vec2(cos(sa), sin(sa) * 0.75) * spray * (0.34 + 0.24 * h1);
            r = (0.045 + 0.05 * h1) * sizeK;
        } else {
            // Small droplets only exist while the pool is burst.
            float sa = fi * 2.3999 + n * 2.9 + h2;
            float reach = (0.55 + 0.7 * h1) * spray;
            c = vec2(cos(sa), sin(sa) * 0.85) * reach;
            r = (0.018 + 0.025 * h2) * sizeK * smoothstep(0.02, 0.15, spray);
        }
        vec2 d = p - c;
        float dd = dot(d, d) + 1e-5;
        float k = r * r / dd;
        f += k;
        g += -2.0 * k * d / dd;
    }
    // A held sound sets the surface trembling.
    float shock = hv * exp(-age * 3.0);
    float trem = tremble * (0.15 + 0.85 * energy) + shock * 0.8;
    float wob = sin(p.x * 60.0 + t * 9.0) * sin(p.y * 53.0 - t * 7.0);
    f *= 1.0 + 0.06 * trem * wob;

    // Edge of the metal where the field crosses one, antialiased in pixels.
    float edgeW = fwidth(f);
    float cov = smoothstep(1.0 - edgeW, 1.0 + edgeW, f);

    // A sphere-like height from the field and its slope give the normal.
    float gi = 1.0 / max(f, 1.0);
    float z = sqrt(max(1.0 - gi, 0.0));
    vec2 gz = g * gi * gi / (2.0 * max(z, 0.05));
    float R0 = 0.07 * sizeK;
    vec3 nrm = normalize(vec3(-gz * R0, 1.0));
    // Look straight in; reflect the studio.
    vec3 rd = vec3(0.0, 0.0, -1.0);
    vec3 rf = reflect(rd, nrm);
    rf = normalize(vec3(rf.x, rf.y * 0.9 + 0.1, rf.z));
    vec3 env = studio(vec3(rf.x, rf.y, rf.z), t);
    float fres = pow(1.0 - clamp(nrm.z, 0.0, 1.0), 3.0);
    vec3 metal = mix(vec3(0.85), mix(vec3(1.0), ink.rgb, 0.7), tint);
    vec3 col = env * metal * (0.8 + 0.4 * fres);
    col += accent.rgb * fres * shock * 1.2;
    // Tiny specular glints.
    float glint = pow(max(dot(rf, normalize(vec3(-0.3, 0.8, 0.5))), 0.0), 220.0);
    col += vec3(1.0) * glint * 2.0;
    // Darken the very rim a touch so each bead reads as round.
    col *= 0.75 + 0.25 * smoothstep(0.0, 0.25, z);

    // Soft contact shadow below and behind.
    float shadowF = 0.0;
    {
        vec2 sp = p + vec2(-0.02, 0.05);
        float fs = 0.0;
        for (int i = 0; i < BIG; i++) {
            float fi = float(i);
            float h1 = hash11(fi * 1.73 + 0.3);
            float h2 = hash11(fi * 4.11 + 1.7);
            float a = fi * 0.8976 + spin + t * (0.2 + 0.25 * h1) * (h2 > 0.5 ? 1.0 : -1.0);
            float rad = (0.1 + 0.32 * h2) * mix(0.5, 1.4, roam);
            vec2 c = vec2(cos(a), sin(a) * 0.8) * rad + 0.04 * vec2(sin(t * 1.3 + fi), cos(t * 1.1 + fi * 2.0));
            float sa = fi * 2.3999 + n * 1.7;
            c += vec2(cos(sa), sin(sa) * 0.75) * spray * (0.34 + 0.24 * h1);
            float r = (0.045 + 0.05 * h1) * sizeK * 1.5;
            vec2 d = sp - c;
            fs += r * r / (dot(d, d) + 1e-4);
        }
        shadowF = smoothstep(0.3, 1.4, fs);
    }

    if (clearMode) {
        float sa = shadowF * 0.45 * (1.0 - cov);
        float a = max(cov, sa);
        vec3 c2 = col * cov;
        c2 = c2 / (1.0 + 0.2 * max(c2.r, max(c2.g, c2.b)));
        c2 = min(max(c2, 0.0), vec3(a));
        gl_FragColor = vec4(c2, a) * vxPresence;
    } else {
        vec3 bg = mix(vec3(0.012, 0.012, 0.016), ink.rgb * 0.08, smoothstep(-0.6, 0.6, p.y));
        bg *= 1.0 - 0.4 * smoothstep(0.4, 1.0, length(p));
        bg *= 1.0 - 0.6 * shadowF;
        vec3 o = mix(bg, col, cov);
        o = o / (1.0 + 0.2 * max(o.r, max(o.g, o.b)));
        o += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
        gl_FragColor = vec4(clamp(o, 0.0, 1.0) * vxPresence, 1.0);
    }
}
