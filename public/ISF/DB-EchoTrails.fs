/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "Tape echo for the eyes: every kick, snare, hat and note stamps a shape that repeats and drifts outward, softer each time. Feedback sets how long the echoes ring, Drift how far they travel, Echo time the gap between repeats.",
    "PERSISTENT_BUFFERS": [
        "memoryBuffer",
        "echoBuffer"
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
            "TARGET": "echoBuffer",
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
            "NAME": "feedback",
            "TYPE": "float",
            "DEFAULT": 0.65,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Feedback"
        },
        {
            "NAME": "drift",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Drift"
        },
        {
            "NAME": "echoTime",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Echo time"
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
        },
        {
            "NAME": "drumHat",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Hat"
        },
        {
            "NAME": "drumPerc",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Perc"
        }
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define CELLS 8.0

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

float noteSum() {
    return min(4.0, noteEnergy0 + noteEnergy1 + noteEnergy2 + noteEnergy3
                  + noteEnergy4 + noteEnergy5 + noteEnergy6 + noteEnergy7);
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

// Note inputs arrive as note / 127.
float pitchClass(float p) { return mod(floor(p * 127.0 + 0.5), 12.0); }

// One note: a short arc, its angle set by the pitch class, its radius by the octave.
float noteArc(float r, float a, float pitch, float energy) {
    if (energy < 0.01) return 0.0;
    float radius = 0.05 + clamp((pitch * 127.0 - 30.0) / 60.0, 0.0, 1.0) * 0.08;
    float at = pitchClass(pitch) / 12.0 * 6.2831853 + 1.5708;
    float da = abs(mod(a - at + 3.14159265, 6.2831853) - 3.14159265);
    return band(r - radius, 0.003) * exp(-da * da * 14.0) * energy;
}

float notes(float r, float a, float gain) {
    if (gain < 0.001) return 0.0;
    float v = noteArc(r, a, notePitch0, noteEnergy0) + noteArc(r, a, notePitch1, noteEnergy1)
            + noteArc(r, a, notePitch2, noteEnergy2) + noteArc(r, a, notePitch3, noteEnergy3)
            + noteArc(r, a, notePitch4, noteEnergy4) + noteArc(r, a, notePitch5, noteEnergy5)
            + noteArc(r, a, notePitch6, noteEnergy6) + noteArc(r, a, notePitch7, noteEnergy7);
    return v * gain;
}

// What each part stamps: the kick a ring, the snare a pair of bars, hats a
// dotted ring, percussion a wide ring, notes their arcs.
float shapes(vec2 p, float kick, float snare, float hat, float perc, float noteGain) {
    float r = length(p);
    float a = atan(p.y, p.x);
    float v = band(r - 0.17, 0.004) * kick;
    v += band(abs(p.y) - 0.235, 0.003) * smoothstep(0.46, 0.38, abs(p.x)) * snare * 0.8;
    float dots = smoothstep(0.25, 0.05, abs(fract(a / 6.2831853 * 48.0) - 0.5));
    v += band(r - 0.28, 0.003) * dots * hat * 0.4;
    v += band(r - 0.34, 0.009) * perc * 0.6;
    v += notes(r, a, noteGain);
    return v;
}

float levelOf(float cell) {
    if (cell < 0.5) return drumKick;
    if (cell < 1.5) return drumSnare;
    if (cell < 2.5) return drumHat;
    if (cell < 3.5) return drumPerc;
    if (cell < 4.5) return noteSum();
    return 0.0;
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float delay = mix(0.12, 0.6, echoTime);
    float gain = mix(0.35, 0.8, feedback);
    // With nothing playing, a soft pulse keeps the echoes going.
    float idle = 0.35 * (1.0 - smoothstep(0.0, 0.25, noteLevel));

    if (PASSINDEX == 0) {
        float cell = memoryCell();
        gl_FragColor = remember(memoryAt(cell), levelOf(cell), cell > 3.5 ? 0.15 : 0.04);
    } else if (PASSINDEX == 1) {
        // Last frame, pushed out a little, turned a little and darkened.
        float zoom = exp(dt * mix(0.03, 1.2, drift) * (1.0 + 0.25 * sin(TIME * 0.7)));
        float turn = dt * drift * 0.08 * sin(TIME * 0.05 + 1.0);
        vec2 wander = vec2(sin(TIME * 0.11), cos(TIME * 0.083)) * drift * 0.03 * dt;
        vec2 q = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * p / zoom - wander;
        vec2 from = vec2(q.x * RENDERSIZE.y / RENDERSIZE.x, q.y) + 0.5;
        float inside = step(0.0, from.y) * step(from.y, 1.0) * step(0.0, from.x) * step(from.x, 1.0);
        float halfLife = mix(0.15, 2.5, feedback * feedback);
        float v = IMG_NORM_PIXEL(echoBuffer, from).r * inside * exp2(-dt / halfLife);

        // The idle pulse, with its own repeats.
        float pulse = 0.0;
        float g = 1.0;
        for (int k = 0; k <= 5; k++) {
            float t = TIME - float(k) * delay;
            pulse += g * step(0.0, t - dt) * step(floor((t - dt) / 2.6) + 0.5, floor(t / 2.6));
            g *= gain;
        }
        // A note echo redraws the notes still sounding at the strength of the hit.
        float notesNow = noteSum();
        v += shapes(p,
                    echoTaps(memoryAt(0.0), delay, gain) + pulse * idle,
                    echoTaps(memoryAt(1.0), delay, gain),
                    echoTaps(memoryAt(2.0), delay, gain * 0.5),
                    echoTaps(memoryAt(3.0), delay, gain),
                    echoTaps(memoryAt(4.0), delay, gain) / max(notesNow, 0.3));
        gl_FragColor = vec4(vec3(min(v, 8.0)), 1.0);
    } else {
        float v = IMG_NORM_PIXEL(echoBuffer, gl_FragCoord.xy / RENDERSIZE).r;
        // The hits themselves sit on top of their echoes.
        v += shapes(p, drumKick * drumKick, drumSnare * drumSnare, drumHat, drumPerc, 0.6) * 0.9;
        v += band(length(p) - 0.17, 0.004) * idle * 0.25 * (0.6 + 0.4 * sin(TIME * 1.3));
        float r = length(p);
        vec3 col = toneTint(v * 1.3);
        col += tint.rgb * 0.02 * exp(-r * 2.5);
        col += (hash(gl_FragCoord.xy + fract(TIME * 7.13) * 91.0) - 0.5) * 0.012;
        col *= 1.0 - 0.35 * smoothstep(0.45, 1.0, r);
        gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
}
