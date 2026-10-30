/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A tunnel of hairline rings receding to a point. Its cross-section eases from square to circle with the pitch, it twists slowly, and the bass sets how fast it travels and how many rings fill in. Every note drops a bright gate at the far end and steps every gate one place toward the camera, so the bassline stands in the tunnel as a row of gates, each in the shape of its own note.",
    "PASSES": [
        {
            "TARGET": "gatePitchA",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "gatePitchB",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "noteClock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "shape", "LABEL": "Shape", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "pitchShape", "LABEL": "Pitch to shape", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "lineCount", "LABEL": "Line count", "TYPE": "float", "DEFAULT": 40, "MIN": 12, "MAX": 80 },
        { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "twist", "LABEL": "Twist", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "lineWidth", "LABEL": "Line width", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "depthFade", "LABEL": "Depth fade", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "gateGlow", "LABEL": "Gate glow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "bend", "LABEL": "Bend", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lines", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Newest gate", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Focal length, and the depth range of the tunnel.
const float F = 0.62;
const float Z_NEAR = 0.45;
const float Z_FAR = 14.0;
const float GATES = 8.0;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Square (0) to circle (1): a superellipse "radius" of q.
float shapeRadius(vec2 q, float roundness) {
    float e = mix(12.0, 2.0, roundness);
    vec2 a = abs(q) + 1e-6;
    float m = max(a.x, a.y);
    vec2 r = a / m;
    return m * pow(pow(r.x, e) + pow(r.y, e), 1.0 / e);
}

// Distance in stored pixels from p to the outline r(q) = target, using the
// gradient of the section (the turn keeps lengths, so q-space slope is screen slope).
float outlineDist(vec2 q, float roundness, float target, float pxs) {
    float r = shapeRadius(q, roundness);
    float e = 1e-3;
    vec2 g = vec2(shapeRadius(q + vec2(e, 0.0), roundness) - r, shapeRadius(q + vec2(0.0, e), roundness) - r) / e;
    return abs(r - target) / max(length(g), 1e-3) / pxs;
}

// How round a note's section is: the shape control, nudged by where the note
// sits in its octave.
float roundFor(float pitch) {
    float midi = pitch * 127.0;
    float inOct = fract((midi - 36.0) / 12.0);
    return clamp(shape + (inOct - 0.4) * 1.3 * pitchShape, 0.0, 1.0);
}

// Coverage of a line w pixels wide at distance d pixels; aa is one stored pixel.
float lineCov(float d, float w, float aa) {
    float ww = max(w, aa);
    return clamp((0.5 * ww - d) / aa + 0.5, 0.0, 1.0) * min(w / aa, 1.0);
}

vec2 rot(vec2 q, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * q.x - s * q.y, s * q.x + c * q.y);
}

// The tunnel's centre line at depth z, on screen: a slow bend.
vec2 centreAt(float z) {
    float k = bend * (z / Z_FAR) * 0.28;
    return vec2(sin(vxPhase * 0.071 + 0.4), sin(vxPhase * 0.053 + 2.1) * 0.6) * k
         + vec2(sin(vxPhase * 0.031), cos(vxPhase * 0.027)) * 0.03 * bend;
}

// The twist: each ring turns a little more the deeper it sits.
float twistAt(float z) {
    return twist * (0.08 * z * sin(vxPhase * 0.045 + 0.7) + 0.6 * sin(vxPhase * 0.017));
}

void main() {
    float n = floor(vxCount + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    // State lives in 1x1 targets. gatePitchA/B: the note of each of eight gate
    // slots. noteClock: the count, seconds since the last note, the strength of
    // the last note.
    if (PASSINDEX < 2) {
        vec4 v = PASSINDEX == 0 ? IMG_NORM_PIXEL(gatePitchA, vec2(0.5)) : IMG_NORM_PIXEL(gatePitchB, vec2(0.5));
        float last = IMG_NORM_PIXEL(noteClock, vec2(0.5)).r;
        if (FRAMEINDEX < 2) v = vec4(0.0);
        if (FRAMEINDEX >= 2 && abs(n - last) > 0.5) {
            float slot = mod(n, 8.0) - (PASSINDEX == 0 ? 0.0 : 4.0);
            vec4 pick = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
            v = mix(v, vec4(max(vxPitch, 0.01)), pick);
        }
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX == 2) {
        vec4 prev = IMG_NORM_PIXEL(noteClock, vec2(0.5));
        if (FRAMEINDEX < 2) prev = vec4(0.0, 30.0, 0.0, 1.0);
        float age = min(prev.g + dt, 30.0);
        float strength = prev.b;
        if (abs(n - prev.r) > 0.5) {
            age = 0.0;
            strength = 0.55 + 0.45 * clamp(vxVel, 0.0, 1.0);
        }
        gl_FragColor = vec4(n, age, strength, 1.0);
        return;
    }

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    float aa = max(fw.x, fw.y);
    float pxs = 1.0 / RENDERSIZE.y;
    float lw = max(mix(0.9, 2.6, lineWidth) * RENDERSIZE.y / 1080.0, 1.0);
    float env = clamp(vxEnv, 0.0, 1.0);

    // Travel: rings come toward the camera; the motion clock runs faster while
    // the bass plays, and the level adds a push of its own.
    float count = floor(lineCount + 0.5);
    float dz = (Z_FAR - Z_NEAR) / count;
    float travel = vxPhase * mix(0.15, 1.6, speed) / dz;
    float roundNow = roundFor(vxGlide);

    // Estimate the depth this pixel sees, then test the nearest few rings.
    vec2 c0 = centreAt(4.0);
    float s0 = max(length(p - c0), 1e-4);
    float zEst = F / s0;
    // One refinement with the real section, turn and bend at that depth.
    zEst = F / max(shapeRadius(rot(p - centreAt(zEst), twistAt(zEst)), roundNow), 1e-4);
    float u0 = (zEst - Z_NEAR) / dz + fract(travel);
    float rings = 0.0;
    for (int j = 0; j < 9; j++) {
        float i = floor(u0) - 4.0 + float(j);
        float z = Z_NEAR + (i - fract(travel)) * dz;
        if (z > Z_NEAR * 0.6 && z < Z_FAR) {
            vec2 q = rot(p - centreAt(z), twistAt(z));
            float d = outlineDist(q, roundNow, F / z, pxs);
            // Every other ring fills in only while the bass plays.
            float idx = mod(i + floor(travel), 2.0);
            float fill = idx < 0.5 ? 1.0 : smoothstep(0.05, 0.6, env);
            // Rings closer together than a few pixels fade, so the far end never moires.
            float gapPx = F * dz / (z * z) * RENDERSIZE.y / aa;
            float clear = smoothstep(1.6, 4.5, gapPx);
            float fade = exp(-z * mix(0.02, 0.32, depthFade));
            float nearFade = smoothstep(Z_NEAR * 0.6, Z_NEAR * 1.6, z);
            float b = (0.2 + 0.2 * env) * fill * clear * fade * nearFade;
            rings = max(rings, lineCov(d, lw, aa) * b);
        }
    }

    // Gates: the k-th newest has stepped k places toward the camera. Each step
    // takes a short ease in real time; the newest appears at the far end.
    vec4 clock = IMG_NORM_PIXEL(noteClock, vec2(0.5));
    float since = clock.g;
    float stepEase = 1.0 - pow(1.0 - smoothstep(0.0, 0.11, since), 2.0);
    vec4 pa = IMG_NORM_PIXEL(gatePitchA, vec2(0.5));
    vec4 pb = IMG_NORM_PIXEL(gatePitchB, vec2(0.5));
    float idle = exp(-max(since - 2.0, 0.0) / 3.0);
    float gateLight = 0.0;
    float newest = 0.0;
    float glow = 0.0;
    for (int k = 0; k < 8; k++) {
        float fk = float(k);
        float slot = mod(n - fk + 64.0, 8.0);
        vec4 pickA = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
        vec4 pickB = 1.0 - step(0.5, abs(vec4(4.0, 5.0, 6.0, 7.0) - slot));
        float pitch = dot(pa, pickA) + dot(pb, pickB);
        if (pitch > 0.001) {
            float placed = max(fk - 1.0 + stepEase, 0.0);
            float zg = Z_FAR * 0.55 * pow(Z_NEAR * 1.1 / (Z_FAR * 0.55), placed / (GATES - 1.0));
            vec2 q = rot(p - centreAt(zg), twistAt(zg));
            float d = outlineDist(q, roundFor(pitch), F / zg, pxs);
            float wg = min(lw * (1.0 + 0.6 * placed / (GATES - 1.0)), lw + 2.0);
            // Snaps on bright, then settles; the last one fades as it passes.
            float b = (k == 0 ? (0.75 + 0.25 * exp(-since / 0.15)) : 0.85) * (1.0 - smoothstep(GATES - 1.6, GATES - 1.0, placed));
            b *= mix(0.6, 1.0, clock.b) * idle;
            float c = lineCov(d, wg, aa) * b;
            float halo = exp(-max(d - 0.5 * wg, 0.0) / (2.0 + 4.0 * gateGlow)) * 0.22 * gateGlow * b;
            if (k == 0) newest = max(newest, c + halo);
            else {
                gateLight = max(gateLight, c);
                glow += halo * 0.6;
            }
        }
    }

    float white = clamp(max(rings, gateLight) + glow, 0.0, 1.0);
    float acc = clamp(newest, 0.0, 1.0);
    vec3 col = ink.rgb * white * (1.0 - acc) + accent.rgb * acc;

    float lit = max(col.r, max(col.g, col.b));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0 * step(0.004, lit);
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
