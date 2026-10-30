/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "Dark water struck by the music: the kick drops in the middle, the snare and percussion anywhere, each note where its pitch sits, and every drop rings out again like an echo. The ripples cross and interfere; the hats shiver the surface.",
    "PERSISTENT_BUFFERS": [
        "memoryBuffer"
    ],
    "PASSES": [
        {
            "TARGET": "memoryBuffer",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH/8",
            "HEIGHT": "$HEIGHT/8"
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
            "NAME": "waveSpeed",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Speed"
        },
        {
            "NAME": "echoes",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Echoes"
        },
        {
            "NAME": "shine",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Shine"
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
            "NAME": "noteEnergy0",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 1 energy"
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
            "NAME": "noteEnergy2",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 3 energy"
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
            "NAME": "noteEnergy4",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 5 energy"
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
            "NAME": "noteEnergy6",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note 7 energy"
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
            "NAME": "noteLast",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Last note"
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

#define CELLS 10.0

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Brightness to colour: the tint through the mids, white in the peaks.
vec3 toneTint(float v) {
    float a = 1.0 - exp(-max(v, 0.0));
    return a * mix(tint.rgb, vec3(1.0), a * a * a);
}

float noteSum() {
    return min(4.0, noteEnergy0 + noteEnergy1 + noteEnergy2 + noteEnergy3
                  + noteEnergy4 + noteEnergy5 + noteEnergy6 + noteEnergy7);
}

// memoryBuffer is split into CELLS columns. Cells 0-7 hold the last eight
// drops as (age, x, y, kind + strength), x and y before the aspect is
// applied; cells 8 and 9 hold the levels last frame and which drop to
// replace next.
vec4 memoryAt(float cell) {
    return IMG_NORM_PIXEL(memoryBuffer, vec2((cell + 0.5) / CELLS, 0.5));
}

float rose(float before, float level, float jump) {
    return step(before + jump, level) * step(0.1, level);
}

// A note lands across the width by pitch class and up by octave.
// Note inputs arrive as note / 127.
vec2 notePlace(float pitch) {
    float midi = floor(pitch * 127.0 + 0.5);
    float pc = mod(midi, 12.0);
    return vec2((pc / 11.0 - 0.5) * 0.78, clamp((floor(midi / 12.0) - 4.5) * 0.16, -0.36, 0.36));
}

vec4 newDrop(float kind, float strength) {
    vec2 at = (vec2(hash(vec2(TIME * 1.37, kind)), hash(vec2(kind, TIME * 2.11))) - 0.5) * vec2(0.8, 0.76);
    if (kind < 0.5) at *= 0.12;
    else if (kind > 1.5 && kind < 2.5) at = notePlace(noteLast);
    return vec4(0.0, at, kind + clamp(strength, 0.05, 0.99));
}

// One drop and its echoes: a packet of rings that spreads and fades.
// Returns (height, slope x, slope y).
vec3 ripple(vec2 p, vec4 drop, float speed, float echoGain) {
    float strength = fract(drop.w);
    float kind = floor(drop.w);
    if (strength < 0.01) return vec3(0.0);
    vec2 d = p - drop.yz;
    float r = length(d) + 0.0001;
    float k = kind < 0.5 ? 36.0 : (kind < 1.5 ? 70.0 : (kind < 2.5 ? 52.0 : 86.0));
    vec3 acc = vec3(0.0);
    float g = strength;
    for (int j = 0; j < 3; j++) {
        float age = drop.x - float(j) * 0.55;
        if (age > 0.0) {
            float w = 0.03 + age * 0.035;
            float x = r - age * speed;
            float env = exp(-x * x / (w * w) - age * 0.6) * g / (1.0 + r * 3.0);
            float c = cos(k * x);
            float s = sin(k * x);
            acc.x += env * c;
            acc.yz += env * (-k * s - 2.0 * x / (w * w) * c) * d / r;
        }
        g *= echoGain;
    }
    return acc;
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        float cell = floor(gl_FragCoord.x / RENDERSIZE.x * CELLS);
        vec4 state = memoryAt(8.0);
        float notesNow = noteSum();
        float kick = rose(state.x, drumKick, 0.04);
        float snare = rose(state.y, drumSnare, 0.04);
        float note = rose(state.z, notesNow, 0.15);
        float perc = rose(memoryAt(9.0).x, drumPerc, 0.04);
        float next = state.w;
        if (cell > 8.5) {
            gl_FragColor = vec4(drumPerc, 0.0, 0.0, 0.0);
        } else if (cell > 7.5) {
            gl_FragColor = vec4(drumKick, drumSnare, notesNow, mod(next + kick + snare + note + perc, 8.0));
        } else {
            float slot = mod(cell - next + 8.0, 8.0);
            vec4 drop = memoryAt(cell);
            if (kick > 0.5 && slot < 0.5) drop = newDrop(0.0, drumKick);
            else if (snare > 0.5 && abs(slot - kick) < 0.5) drop = newDrop(1.0, drumSnare * 0.8);
            else if (note > 0.5 && abs(slot - kick - snare) < 0.5) drop = newDrop(2.0, min(notesNow, 1.0) * 0.8);
            else if (perc > 0.5 && abs(slot - kick - snare - note) < 0.5) drop = newDrop(3.0, drumPerc * 0.7);
            else drop.x = min(drop.x + dt, 8.0);
            gl_FragColor = drop;
        }
        return;
    }

    float speed = mix(0.12, 0.42, waveSpeed);
    float echoGain = mix(0.0, 0.75, echoes);
    vec3 h = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        vec4 drop = memoryAt(float(i));
        drop.y *= aspect;
        h += ripple(p, drop, speed, echoGain);
    }
    // Quiet drops keep the water moving between hits.
    float idle = mix(0.45, 0.12, smoothstep(0.0, 0.4, noteLevel));
    for (int i = 0; i < 3; i++) {
        float drip = floor(TIME / 2.2) - float(i);
        vec2 at = (vec2(hash(vec2(drip, 1.3)), hash(vec2(2.7, drip))) - 0.5) * vec2(aspect * 0.8, 0.7);
        h += ripple(p, vec4(TIME - drip * 2.2, at, 2.0 + idle), speed, echoGain);
    }
    // A slow swell, and the hats shiver the surface.
    h.yz += vec2(sin(p.y * 3.0 + TIME * 0.3), cos(p.x * 2.5 - TIME * 0.27)) * 0.4;
    h.yz += drumHat * vec2(sin(p.x * 97.0 + sin(p.y * 31.0) * 2.0 + TIME * 11.0), sin(p.y * 89.0 + sin(p.x * 27.0) * 2.0 - TIME * 9.0));

    vec3 n = normalize(vec3(-h.yz * 0.025, 1.0));
    // A soft light overhead, seen in the water, bent by the ripples.
    vec2 seen = p * 0.9 + n.xy * 1.4 - vec2(-0.12, 0.14);
    float pool = exp(-dot(seen, seen) * 6.0);
    vec3 halfway = normalize(vec3(-0.35, 0.45, 1.0) + vec3(0.0, 0.0, 1.0));
    float glint = pow(max(dot(n, halfway), 0.0), mix(40.0, 160.0, shine));
    float still = pow(dot(vec3(0.0, 0.0, 1.0), halfway), mix(40.0, 160.0, shine));
    float v = pool * 0.14 + max(glint - still, 0.0) * mix(1.0, 3.0, shine) + length(h.yz) * 0.002;

    vec3 col = toneTint(v * 1.5);
    col += tint.rgb * 0.012;
    col += (hash(gl_FragCoord.xy + fract(TIME * 3.7) * 53.0) - 0.5) * 0.01;
    col *= 1.0 - 0.35 * smoothstep(0.5, 1.1, length(p));
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
