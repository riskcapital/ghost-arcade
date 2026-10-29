/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Glitch",
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "Datamosh: the last frame smears block by block, and every kick drops in fresh noise blocks to tear apart. Black and white.",
    "PERSISTENT_BUFFERS": [
        "moshBuffer"
    ],
    "PASSES": [
        {
            "TARGET": "moshBuffer",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ],
    "INPUTS": [
        {
            "NAME": "blockSize",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Blocks"
        },
        {
            "NAME": "smear",
            "TYPE": "float",
            "DEFAULT": 0.6,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Smear"
        },
        {
            "NAME": "fadeAway",
            "TYPE": "float",
            "DEFAULT": 0.3,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Fade"
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
    if (PASSINDEX == 0) {
        float n = 8.0 + floor(blockSize * 40.0);
        vec2 cell = floor(uv * n);
        float seed = floor(noteEvolve * 3.0);
        // Each block slides its own way, the way broken motion vectors do.
        vec2 motion = (vec2(hash(cell + seed), hash(cell - seed)) - 0.5) * smear * 0.02 * (0.3 + noteLevel);
        float v = IMG_NORM_PIXEL(moshBuffer, uv - motion).r;
        v *= 1.0 - fadeAway * 0.03;
        float fresh = step(1.0 - drumKick * 0.5, hash(cell * 3.1 + floor(TIME * 8.0)));
        v = mix(v, hash(cell + TIME), fresh);
        v = mix(v, 1.0 - v, drumSnare * 0.15 * step(0.8, hash(cell + seed * 2.0)));
        gl_FragColor = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
    } else {
        float v = IMG_NORM_PIXEL(moshBuffer, uv).r;
        gl_FragColor = vec4(vec3(step(0.5, v) * 0.85 + v * 0.15), 1.0);
    }
}
