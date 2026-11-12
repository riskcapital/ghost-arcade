/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A swarm of fireflies swimming round a hidden center above a dark meadow. Each one glides on its own tilted orbit, drifting in and out, rising and diving, and slowly floating toward you and away again: near ones swell into soft out-of-focus glows, far ones shrink to pinpoints. The music sets how fast they swim; as it swells the swarm widens and brightens, and each hit blooms it outward before it gathers back. Alone they glow on and off at their own pace; Sync pulls their glow onto the beat. The grass below catches their light.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 3, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "swarm", "LABEL": "Swarm size", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "depth", "LABEL": "Depth", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "shower", "LABEL": "Bloom", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "sync", "LABEL": "Sync", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "meadow", "LABEL": "Meadow", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Fireflies", "TYPE": "color", "DEFAULT": [0.72, 1.0, 0.4, 1.0] },
        { "NAME": "accent", "LABEL": "Warm light", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.3, 1.0] },
        { "NAME": "vxBeat", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const float PI = 3.14159265;
const int COUNT = 150;

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Rotate v about a unit axis k by angle a.
vec3 rotAxis(vec3 v, vec3 k, float a) {
    float c = cos(a);
    float s = sin(a);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

// A firefly's place, seen from the camera, at flow time `ft`.
vec3 fireflyView(float ft, float rr, float speed, float h1, float h2, float h3, float h4, float h5,
                 float pulse, float R, float cy, float sy, float cp, float sp) {
    // Orbits run on a gentler copy of the flow clock: fireflies drift, they don't race.
    float ang = h3 * TAU + ft * speed * 0.55;
    // In and out along the orbit, and up and down through it, all smooth.
    float breathe = 1.0 + 0.22 * sin(ft * (0.21 + 0.17 * h4) + h5 * TAU);
    float rise = (h4 - 0.5) * 0.5 * R + 0.22 * R * sin(ft * (0.17 + 0.13 * h5) + h1 * TAU);
    // Hits bloom the swarm outward; it gathers back as the pulse eases.
    float push = 1.0 + 0.35 * pulse * shower * (0.6 + 0.8 * h2);
    vec3 q = vec3(cos(ang) * rr * breathe * push, rise, sin(ang) * rr * breathe * push);
    // Tilted plane per firefly, so the swarm is a 3D cloud, not a disc.
    vec3 axis = normalize(vec3(cos(h5 * TAU), 0.0, sin(h5 * TAU)));
    q = rotAxis(q, axis, (h2 - 0.5) * 0.55);
    // Floating toward the viewer and away again.
    q.z += depth * R * 0.9 * sin(ft * (0.09 + 0.08 * h3) + h4 * TAU);
    vec3 v = vec3(q.x * cy - q.z * sy, q.y, q.x * sy + q.z * cy);
    return vec3(v.x, v.y * cp - v.z * sp, v.y * sp + v.z * cp);
}

void main() {
    vec2 res = RENDERSIZE;
    vec2 fragPx = gl_FragCoord.xy;
    float s1080 = res.y / 1080.0;
    // Everything moves on the flow clock: faster as the music drives it.
    float t = vxFlow;
    float swell = clamp(vxSwell, 0.0, 1.0);
    float pulse = clamp(vxPulse, 0.0, 1.0);

    // The swarm's centre drifts a little, above the meadow.
    vec2 centre = vec2(0.5 * res.x / res.y, 0.56) + vec2(0.05 * sin(t * 0.11), 0.03 * sin(t * 0.083 + 1.0));
    vec2 p = fragPx / res.y;
    float R = (0.16 + 0.2 * swarm) * (1.0 + 0.3 * swell + 0.22 * pulse * shower);
    // Camera: looking slightly down on the swarm, slowly circling.
    float camD = R * 3.2;
    float yaw = t * 0.05 + 0.4 * sin(t * 0.031);
    float pitch = 0.55 + 0.1 * sin(t * 0.047);
    float cy = cos(yaw), sy = sin(yaw), cp = cos(pitch), sp = sin(pitch);

    // Sync: a smooth bump on every beat (no edge at the beat line).
    float beatBump = pow(0.5 + 0.5 * cos(TAU * vxBeat), 3.0);
    float syncAmt = sync * clamp(0.35 + swell, 0.0, 1.0);

    // Motion blur over 60% of one frame of travel on the flow clock (which
    // runs at 0.25/s at rest and faster as the swell and pulse rise): a
    // camera shutter, so each light is a dot, slightly drawn out when fast.
    float flowRate = 0.25 + 1.4 * swell + 0.9 * pulse;
    float shutter = 0.6 * flowRate / 60.0;

    vec3 L = vec3(0.0);
    float cover = 0.0;
    float spill = 0.0;
    for (int i = 0; i < COUNT; i++) {
        float fi = float(i);
        float h1 = hash11(fi * 1.37 + 0.11);
        float h2 = hash11(fi * 2.71 + 0.53);
        float h3 = hash11(fi * 4.13 + 0.97);
        float h4 = hash11(fi * 6.29 + 1.41);
        float h5 = hash11(fi * 8.51 + 2.07);
        // Its own orbit: radius, speed (inner ones swim faster), tilt.
        // An open centre, so the swarm reads as circling round it.
        float rr = R * (0.42 + 0.58 * sqrt(h1));
        // A lap takes ~25 s at rest and ~3 s when the music drives it hard.
        float speed = (0.75 + 0.5 * h2) * pow(R / rr, 0.8);
        vec3 view0 = fireflyView(t, rr, speed, h1, h2, h3, h4, h5, pulse, R, cy, sy, cp, sp);
        // Where it was a moment ago, for a short motion blur along its path.
        vec3 view1 = fireflyView(t - shutter, rr, speed, h1, h2, h3, h4, h5, pulse, R, cy, sy, cp, sp);
        float zc = camD - view0.z;
        if (zc < 0.15 * camD) continue;
        float persp = camD / zc;
        vec2 sp2 = centre + view0.xy * persp;
        vec2 sp1 = centre + view1.xy * (camD / max(camD - view1.z, 0.15 * camD));

        // Near ones swell into soft out-of-focus discs; far ones shrink.
        float nearness = clamp((persp - 1.12) / 0.6, 0.0, 1.0);
        float farness = clamp((1.0 - persp) / 0.35, 0.0, 1.0);
        float corePx = max(1.6, (1.9 + 1.6 * h1) * persp * s1080);
        float bokehPx = corePx + nearness * nearness * 26.0 * s1080 * depth;
        // Distance to the short streak from where it was to where it is.
        vec2 seg = sp2 - sp1;
        float hseg = clamp(dot(p - sp1, seg) / max(dot(seg, seg), 1e-9), 0.0, 1.0);
        float d = length(p - sp1 - seg * hseg) * res.y;
        // The streak spreads the same light: dimmer as it gets longer.
        float streakPx = length(seg) * res.y;
        if (d > bokehPx * 3.0 + 30.0 * s1080 * glow) continue;

        // Its own slow glow, pulled onto the beat by Sync.
        float own = 0.5 + 0.5 * sin(t * (0.6 + 0.9 * h4) + h3 * TAU);
        own = smoothstep(0.1, 0.95, own);
        float lit = mix(0.25 + 0.75 * own, 0.3 + 0.7 * beatBump, syncAmt);
        lit *= (0.75 + 0.5 * swell + 0.8 * pulse * shower) * mix(1.0, 0.45, farness);

        vec3 col = mix(ink.rgb, accent.rgb, smoothstep(0.55, 1.0, h3) * 0.8 + nearness * 0.15);
        // Core (in focus) fades into a disc as it comes near: same light, spread.
        float focus = corePx / bokehPx;
        float sharp = exp(-d * d / (2.0 * corePx * corePx));
        float disc = smoothstep(bokehPx, bokehPx - 1.5 * s1080, d) * (0.55 + 0.45 * smoothstep(bokehPx * 0.55, bokehPx, d));
        float shape = mix(disc * focus * focus * 3.0, sharp, focus) * corePx / (corePx + 0.35 * streakPx);
        float halo = exp(-d / ((2.5 + 7.0 * glow) * s1080 * mix(1.0, 2.0, nearness))) * 0.09 * glow;
        L += col * lit * (shape * 1.4 + halo);
        cover = max(cover, clamp(shape * lit * 1.3, 0.0, 1.0));
        spill += lit * exp(-pow(abs(sp2.x - p.x) / (R * 1.5), 2.0)) * 0.012;
    }
    // The swarm's own soft light, gathered round its centre.
    float rc = length((p - centre) / vec2(1.0, 0.8)) / (R * 1.4);
    L += mix(ink.rgb, accent.rgb, 0.3) * exp(-rc * rc * 1.2) * (0.05 + 0.08 * swell + 0.1 * pulse * shower) * glow;

    // Filmic tone curve.
    vec3 Lx = L * (2.2 + 0.5 * swell);
    vec3 lightC = clamp((Lx * (2.51 * Lx + 0.03)) / (Lx * (2.43 * Lx + 0.59) + 0.14), 0.0, 1.0);

    // Night meadow, lit by the swarm.
    vec2 uv = fragPx / res;
    vec3 inkC = ink.rgb;
    vec3 sky = mix(inkC * 0.03 + vec3(0.005, 0.007, 0.02), vec3(0.002, 0.003, 0.01), smoothstep(0.1, 1.0, uv.y));
    float gx = fragPx.x / res.y;
    float bladeH = 0.0;
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float fq = 90.0 + 70.0 * fk;
        float hgt = (0.05 + 0.11 * (1.0 - 0.3 * fk)) * meadow;
        float yrel = clamp((uv.y - 0.02) / max(hgt, 1e-3), 0.0, 1.0);
        float sway = 0.25 * sin(t * 0.08 + gx * 4.0 + fk * 2.0);
        float x = gx * fq + fk * 13.0;
        float hb = hash21(vec2(floor(x), fk));
        x += (hb - 0.5 + sway) * 1.6 * yrel * yrel;
        float hb2 = hash21(vec2(floor(x), fk + 7.0));
        float shapeB = 1.0 - abs(fract(x) - 0.5) * 2.0;
        bladeH = max(bladeH, hgt * (0.35 + 0.65 * hb2) * pow(shapeB, 1.8));
    }
    float hill = 0.035 * meadow + 0.02 * vnoise(vec2(gx * 2.0, 1.0)) * meadow;
    float below = hill + bladeH - uv.y;
    float ground = smoothstep(0.0, 1.2 / res.y, below);
    float sp3 = clamp(spill, 0.0, 1.5);
    float haze = exp(-max(uv.y - hill, 0.0) / 0.1) * (0.03 + 0.14 * sp3) * meadow;
    sky += mix(inkC, accent.rgb, 0.3) * haze;
    float rimG = exp(-max(below, 0.0) * res.y / (2.5 * s1080)) * ground;
    vec3 grassC = inkC * 0.006 + mix(inkC, accent.rgb, 0.3) * rimG * 1.6 * sp3 * meadow;
    vec3 bg = mix(sky, grassC, ground);

    float outA = 1.0;
    vec3 outC = bg + lightC * (1.0 - bg);
    float grain = hash21(fragPx + fract(TIME * 7.13) * 97.0) - 0.5;
    outC += grain * (0.01 + 0.015 * max(outC.g, max(outC.r, outC.b)));
    if (vxClear) {
        // Only the lights: cores solid, glows soft, coverage following the light.
        vec3 Lt = L * 3.2;
        vec3 lt = clamp((Lt * (2.51 * Lt + 0.03)) / (Lt * (2.43 * Lt + 0.59) + 0.14), 0.0, 1.0);
        float l = max(lt.r, max(lt.g, lt.b));
        outA = clamp(max(cover, l * 1.15), 0.0, 1.0);
        outC = lt;
    }
    outC = max(outC, 0.0);
    outC *= vxPresence;
    outA *= vxPresence;
    outC = min(outC, vec3(outA));
    gl_FragColor = vec4(outC, outA);
}
