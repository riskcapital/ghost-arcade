/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "Every note sends out a ring coloured by its pitch that widens as the note fades, so chords leave ripples. The kick lights the centre and the snare shimmers the rings. Build keeps the rings standing and stacks them up.",
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
            "NAME": "ringWidth",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.1,
            "MAX": 1.0,
            "LABEL": "Ring width"
        },
        {
            "NAME": "spread",
            "TYPE": "float",
            "DEFAULT": 0.6,
            "MIN": 0.2,
            "MAX": 1.0,
            "LABEL": "Spread"
        },
        {
            "NAME": "wobble",
            "TYPE": "float",
            "DEFAULT": 0.4,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Wobble"
        },
        {
            "NAME": "saturation",
            "TYPE": "float",
            "DEFAULT": 0.85,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Colour"
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
            "NAME": "noteHit",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Note hit"
        },
        {
            "NAME": "noteBuild",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Build"
        },
        {
            "NAME": "noteEvolve",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1000.0,
            "LABEL": "Evolve"
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

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Note inputs arrive as note / 127.
float pitchClass(float p) { return mod(floor(p * 127.0 + 0.5), 12.0); }
float octaveOf(float p) { return floor((p * 127.0 + 0.5) / 12.0); }

vec3 ring(vec2 uv, float pitch, float energy) {
    if (energy < 0.002) return vec3(0.0);
    float pc = pitchClass(pitch);
    float r = length(uv);
    float a = atan(uv.y, uv.x);
    // Each pitch has its own ring (octaveOf is 5 for middle C), so a chord
    // reads as separate rings; a fresh note rides outward as it fades.
    float radius = max(0.02, 0.05 + pc * 0.016 + (octaveOf(pitch) - 5.0) * 0.03 + (1.0 - energy) * 0.45 * spread);
    float shape = r + wobble * 0.015 * sin(a * (pc + 3.0) + noteEvolve * 1.5);
    float width = 0.006 + 0.03 * ringWidth * energy;
    float x = (shape - radius) / width;
    float band = exp(-x * x);
    float shimmer = 1.0 + drumSnare * 0.6 * sin(a * 40.0 + TIME * 30.0);
    return hsv2rgb(vec3(pc / 12.0, saturation, 1.0)) * band * energy * shimmer * 1.4;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    vec3 col = vec3(0.0);
    col += ring(uv, notePitch0, noteEnergy0);
    col += ring(uv, notePitch1, noteEnergy1);
    col += ring(uv, notePitch2, noteEnergy2);
    col += ring(uv, notePitch3, noteEnergy3);
    col += ring(uv, notePitch4, noteEnergy4);
    col += ring(uv, notePitch5, noteEnergy5);
    col += ring(uv, notePitch6, noteEnergy6);
    col += ring(uv, notePitch7, noteEnergy7);

    float r = length(uv);
    col += vec3(1.0, 0.85, 0.75) * drumKick * exp(-r * r * 60.0) * 0.9;
    // Built-up playing leaves faint standing echoes.
    float echoes = 0.5 + 0.5 * cos(r * 60.0 - noteEvolve * 2.0);
    col += hsv2rgb(vec3(fract(noteEvolve * 0.015), saturation * 0.5, 1.0)) * echoes * noteBuild * 0.12 * exp(-r * 1.5);
    col += noteHit * 0.03;

    col = 1.0 - exp(-col * 1.3);
    gl_FragColor = vec4(col, 1.0);
}
