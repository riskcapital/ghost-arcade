/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "A speaker cone seen head on. The kick pumps it and sends echo rings out across the cabinet; bass notes shake the cone. Fine grain over everything.",
    "PERSISTENT_BUFFERS": [
        "memoryBuffer",
        "ringBuffer"
    ],
    "PASSES": [
        {
            "TARGET": "memoryBuffer",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH/8",
            "HEIGHT": "$HEIGHT/8"
        },
        {
            "TARGET": "ringBuffer",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ],
    "INPUTS": [
        {
            "NAME": "noteMode",
            "TYPE": "long",
            "DEFAULT": 0,
            "VALUES": [
                0,
                1,
                2
            ],
            "LABELS": [
                "Follow instrument",
                "Fade",
                "Build"
            ],
            "LABEL": "Notes"
        },
        {
            "NAME": "size",
            "TYPE": "float",
            "DEFAULT": 0.6,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Size"
        },
        {
            "NAME": "pump",
            "TYPE": "float",
            "DEFAULT": 0.6,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Pump"
        },
        {
            "NAME": "rings",
            "TYPE": "float",
            "DEFAULT": 0.6,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Rings"
        },
        {
            "NAME": "grain",
            "TYPE": "float",
            "DEFAULT": 0.4,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Grain"
        },
        {
            "NAME": "tint",
            "TYPE": "color",
            "DEFAULT": [
                0.62,
                0.74,
                1.0,
                1.0
            ],
            "LABEL": "Tint"
        },
        {
            "NAME": "notePitch0",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 1 pitch"
        },
        {
            "NAME": "noteEnergy0",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 1 energy"
        },
        {
            "NAME": "notePitch1",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 2 pitch"
        },
        {
            "NAME": "noteEnergy1",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 2 energy"
        },
        {
            "NAME": "notePitch2",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 3 pitch"
        },
        {
            "NAME": "noteEnergy2",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 3 energy"
        },
        {
            "NAME": "notePitch3",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 4 pitch"
        },
        {
            "NAME": "noteEnergy3",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 4 energy"
        },
        {
            "NAME": "notePitch4",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 5 pitch"
        },
        {
            "NAME": "noteEnergy4",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 5 energy"
        },
        {
            "NAME": "notePitch5",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 6 pitch"
        },
        {
            "NAME": "noteEnergy5",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 6 energy"
        },
        {
            "NAME": "notePitch6",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 7 pitch"
        },
        {
            "NAME": "noteEnergy6",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 7 energy"
        },
        {
            "NAME": "notePitch7",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 8 pitch"
        },
        {
            "NAME": "noteEnergy7",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 8 energy"
        },
        {
            "NAME": "noteLevel",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note level"
        },
        {
            "NAME": "drumKick",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Kick"
        },
        {
            "NAME": "drumSnare",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Snare"
        }
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define CELLS 4.0

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Brightness to colour: the tint through the mids, white in the peaks.
vec3 toneTint(float v) {
    float a = 1.0 - exp(-max(v, 0.0));
    return a * mix(tint.rgb, vec3(1.0), a * a * a);
}

// A soft-edged line across x = 0, with a faint halo.
float band(float x, float w) {
    float d = x / w;
    return exp(-d * d) + 0.15 * exp(-d * d * 0.04);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// memoryBuffer is split into CELLS columns, one per part, each holding
// (level last frame, seconds since the hit, how hard it was, the age a frame ago).
vec4 memoryAt(float cell) {
    return IMG_NORM_PIXEL(memoryBuffer, vec2((cell + 0.5) / CELLS, 0.5));
}

float memoryCell() {
    return floor(gl_FragCoord.x / RENDERSIZE.x * CELLS);
}

bool rose(float before, float level, float jump) {
    return level > before + jump && level > 0.1;
}

vec4 remember(vec4 m, float level, float jump) {
    if (rose(m.x, level, jump)) return vec4(level, 0.0, level, -1.0);
    return vec4(level, min(m.y + clamp(TIMEDELTA, 0.0, 0.1), 8.0), m.z, m.y);
}

// How hard this frame stamps a part: the hit itself, then each repeat as
// its delay comes round, softer every time, like a tape echo.
float echoTaps(vec4 m, float delay, float gain) {
    float stamp = 0.0;
    float g = 1.0;
    for (int k = 0; k <= 5; k++) {
        float at = float(k) * delay;
        stamp += g * step(m.w, at - 0.0001) * step(at, m.y);
        g *= gain;
    }
    return stamp * m.z;
}

// Low notes count as bass. Note inputs arrive as note / 127.
float bassOf(float pitch, float energy) {
    return energy * (1.0 - smoothstep(44.0, 58.0, pitch * 127.0));
}

float bassLevel() {
    return min(1.0, bassOf(notePitch0, noteEnergy0) + bassOf(notePitch1, noteEnergy1)
                  + bassOf(notePitch2, noteEnergy2) + bassOf(notePitch3, noteEnergy3)
                  + bassOf(notePitch4, noteEnergy4) + bassOf(notePitch5, noteEnergy5)
                  + bassOf(notePitch6, noteEnergy6) + bassOf(notePitch7, noteEnergy7));
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float r = length(p);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float edge = mix(0.3, 0.46, size);
    float idle = 1.0 - smoothstep(0.0, 0.25, noteLevel);

    if (PASSINDEX == 0) {
        float cell = memoryCell();
        gl_FragColor = remember(memoryAt(cell), cell < 0.5 ? drumKick : (cell < 1.5 ? drumSnare : 0.0), 0.04);
        return;
    }
    if (PASSINDEX == 1) {
        // The rings travel outward at a steady speed and fade.
        float back = max(r - 0.16 * dt, 0.0) / max(r, 0.0001);
        vec2 from = vec2(p.x * back * RENDERSIZE.y / RENDERSIZE.x, p.y * back) + 0.5;
        float v = IMG_NORM_PIXEL(ringBuffer, from).r * exp2(-dt / mix(0.5, 2.2, rings));
        float gain = mix(0.3, 0.72, rings);
        float pulse = step(floor((TIME - dt) / 3.2) + 0.5, floor(TIME / 3.2)) * 0.3 * idle;
        float hit = echoTaps(memoryAt(0.0), 0.3, gain) + pulse;
        float snap = echoTaps(memoryAt(1.0), 0.3, gain * 0.8);
        // Pressure is never even all the way round.
        float uneven = 0.7 + 0.3 * noise(p / max(r, 0.0001) * 2.5 + vec2(TIME * 0.4, 0.0));
        v += (band(r - edge - 0.012, 0.005) * hit + band(r - edge - 0.012, 0.0025) * snap * 0.6) * uneven;
        gl_FragColor = vec4(vec3(min(v, 8.0)), 1.0);
        return;
    }

    float bass = bassLevel();
    float shake = bass * 0.35 * sin(TIME * 47.0);
    float push = clamp(drumKick * 1.1 + shake + idle * 0.08 * sin(TIME * 1.7), -0.3, 1.2) * pump;
    float rc = edge * 0.2 * (1.0 + 0.2 * push);
    float r1 = edge * 0.76 * (1.0 + 0.08 * push);
    float r2 = edge * 0.88;
    vec2 dir = p / max(r, 0.0001);

    float lum = 0.0;
    if (r < edge) {
        float slope = 0.0;
        float albedo = 0.1;
        float gloss = 0.2;
        float sharp = 12.0;
        float ao = 1.0;
        if (r < rc) {
            // Dust cap: a shallow dome.
            float t = r / rc;
            slope = -t / sqrt(max(1.0 - t * t, 0.04)) * (0.45 + 0.25 * push);
            albedo = 0.2;
            gloss = 0.55 + 0.4 * max(push, 0.0);
            sharp = 26.0;
        } else if (r < r1) {
            // Paper cone, with faint ridges, deeper as it pumps.
            float t = (r - rc) / (r1 - rc);
            slope = 0.45 + 0.3 * push + 0.08 * sin(t * 70.0) * (1.0 - t);
            slope += bass * 0.12 * sin(t * 26.0 - TIME * 30.0);
            albedo = 0.13 + 0.025 * noise(p * 420.0) + 0.025 * noise(dir * 60.0 + r * 12.0);
            gloss = 0.06;
            sharp = 6.0;
            ao = 0.75 + 0.25 * smoothstep(0.0, 0.2, t);
        } else if (r < r2) {
            // Rubber surround: a half roll.
            float t = (r - r1) / (r2 - r1);
            slope = cos(t * 3.14159) * 1.3 * (1.0 - 0.25 * push);
            albedo = 0.05;
            gloss = 0.5;
            sharp = 18.0;
        } else {
            // Steel frame, with bolts.
            float t = (r - r2) / (edge - r2);
            slope = 0.7 * (1.0 - smoothstep(0.0, 0.15, t)) - 0.7 * smoothstep(0.85, 1.0, t);
            albedo = 0.1 + 0.015 * sin(r * 900.0);
            gloss = 0.3;
            sharp = 14.0;
            float sector = 6.2831853 / 8.0;
            float a = mod(atan(p.y, p.x) + sector * 0.5, sector) - sector * 0.5;
            vec2 bolt = vec2(r * cos(a) - (r2 + edge) * 0.5, r * sin(a));
            albedo *= mix(0.12, 1.0, smoothstep(0.8, 1.05, length(bolt) / (edge * 0.026)));
        }
        // The seams between the parts sit in shadow.
        ao *= 1.0 - 0.6 * exp(-pow((r - rc) / (edge * 0.012), 2.0));
        ao *= 1.0 - 0.7 * exp(-pow((r - r1) / (edge * 0.01), 2.0));
        ao *= 1.0 - 0.6 * exp(-pow((r - r2) / (edge * 0.01), 2.0));

        vec3 n = normalize(vec3(-slope * dir, 1.0));
        vec3 light = normalize(vec3(-0.45, 0.55, 0.7));
        float diffuse = max(dot(n, light), 0.0);
        float spec = pow(max(dot(reflect(-light, n), vec3(0.0, 0.0, 1.0)), 0.0), sharp) * gloss;
        float rim = pow(max(dot(n, normalize(vec3(0.6, -0.5, 0.35))), 0.0), 3.0) * 0.06;
        lum = (albedo * (0.12 + diffuse * 1.3) + rim) * ao + spec;
        lum *= 1.0 + 0.5 * drumKick * drumKick * pump;
    } else {
        // The cabinet: the rings on it, and the speaker's shadow.
        float v = IMG_NORM_PIXEL(ringBuffer, gl_FragCoord.xy / RENDERSIZE).r;
        v += band(r - edge - 0.012 - (1.0 - drumKick) * 0.06, 0.005) * drumKick * drumKick * 0.6;
        float shadow = 1.0 - 0.8 * exp(-(r - edge) * 18.0);
        lum = v * 0.9 + 0.014 * shadow * (0.6 + noise(p * vec2(4.0, 220.0)) * 0.4);
        lum += 0.05 * drumKick * pump * exp(-(r - edge) * 10.0);
    }

    vec3 col = toneTint(lum * 1.6);
    col += (hash(gl_FragCoord.xy + fract(TIME * 9.17) * 63.0) - 0.5) * mix(0.0, 0.07, grain);
    col *= 1.0 - 0.3 * smoothstep(0.55, 1.1, r);
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
