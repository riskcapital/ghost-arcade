/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Glitch",
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "Strobe for the kick: a white flash cut into hard-edged blocks, dark between hits. The perc and snare flip blocks inverted.",
    "INPUTS": [
        {
            "NAME": "blocks",
            "TYPE": "float",
            "DEFAULT": 0.4,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Blocks"
        },
        {
            "NAME": "decay",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Hold"
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
            "NAME": "drumPerc",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Perc"
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
    float n = 2.0 + floor(blocks * 10.0);
    vec2 cell = floor(uv * vec2(n * RENDERSIZE.x / RENDERSIZE.y, n));
    float pick = hash(cell + floor(noteEvolve * 4.0));
    float flash = pow(drumKick, mix(3.0, 0.6, decay));
    float v = flash * step(pick, 0.35 + flash * 0.65);
    v = mix(v, 1.0 - v, step(0.7, hash(cell * 1.7)) * max(drumSnare, drumPerc));
    gl_FragColor = vec4(vec3(v), 1.0);
}
