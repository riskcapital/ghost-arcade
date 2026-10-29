/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Glitch",
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "Thin scanlines and torn bars. Every hat tears rows sideways; the snare drops a white bar across the frame.",
    "INPUTS": [
        {
            "NAME": "lines",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Lines"
        },
        {
            "NAME": "tear",
            "TYPE": "float",
            "DEFAULT": 0.6,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Tear"
        },
        {
            "NAME": "glow",
            "TYPE": "float",
            "DEFAULT": 0.4,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Glow"
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
            "NAME": "drumSnare",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Snare"
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
            "NAME": "noteEvolve",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1000.0,
            "LABEL": "Evolve"
        }
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// Hash and value noise, black and white throughout.
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float rows = 60.0 + lines * 300.0;
    float row = floor(uv.y * rows);
    float band = floor(uv.y * 24.0);
    // Hats tear whole bands sideways by a random amount.
    float torn = (hash(vec2(band, floor(noteEvolve * 6.0))) - 0.5) * drumHat * tear;
    float x = uv.x + torn;
    float line = step(0.5, fract(uv.y * rows)) * (0.25 + 0.75 * hash(vec2(row, floor(x * 6.0))));
    float bar = step(abs(uv.y - fract(noteEvolve * 0.37)), 0.02 + drumSnare * 0.08) * drumSnare;
    float v = line * (0.35 + glow * 0.65) + bar + noteHit * 0.08;
    gl_FragColor = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}
