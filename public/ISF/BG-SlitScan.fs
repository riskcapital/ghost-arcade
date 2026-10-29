/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Glitch",
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "Black and white slits of uneven width that slide past each other. The kick jumps the whole field, the hats thin the slits, and the louder the music the wider they open.",
    "INPUTS": [
        {
            "NAME": "density",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Density"
        },
        {
            "NAME": "speed",
            "TYPE": "float",
            "DEFAULT": 0.4,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Speed"
        },
        {
            "NAME": "contrast",
            "TYPE": "float",
            "DEFAULT": 0.8,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Contrast"
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
            "NAME": "drumHat",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Hat"
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
    float t = noteEvolve * 0.6 + TIME * speed * 0.15;
    // Rows of slits, each row its own speed; a kick jumps them sideways.
    float row = floor(uv.y * (6.0 + density * 18.0));
    float shift = hash(vec2(row, floor(t * 2.0))) * drumKick * 0.4;
    float x = uv.x + t * (0.2 + hash(vec2(row, 3.0)) * 0.8) + shift;
    float cols = 20.0 + density * 120.0;
    float cell = floor(x * cols);
    float width = mix(0.15, 0.85, hash(vec2(cell, row)));
    width *= mix(1.0, 0.35, drumHat);
    width = mix(width, width + 0.5, noteLevel * 0.6);
    float slit = step(fract(x * cols), width);
    float v = mix(0.5, slit, contrast);
    gl_FragColor = vec4(vec3(v), 1.0);
}
