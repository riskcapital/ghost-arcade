/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "A wall of tiles played by the drums: kick, snare, hats and percussion each light their own band, tinted by the last note. Build fills the wall tile by tile the longer the beat runs.",
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
            "NAME": "columns",
            "TYPE": "float",
            "DEFAULT": 16.0,
            "MIN": 4.0,
            "MAX": 32.0,
            "LABEL": "Columns"
        },
        {
            "NAME": "gap",
            "TYPE": "float",
            "DEFAULT": 0.18,
            "MIN": 0.0,
            "MAX": 0.45,
            "LABEL": "Gap"
        },
        {
            "NAME": "roundness",
            "TYPE": "float",
            "DEFAULT": 0.3,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Roundness"
        },
        {
            "NAME": "saturation",
            "TYPE": "float",
            "DEFAULT": 0.7,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Colour"
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
            "NAME": "noteLast",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Last note"
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

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float cols = floor(columns);
    float rows = max(4.0, floor(cols * RENDERSIZE.y / RENDERSIZE.x));
    vec2 grid = vec2(cols, rows);
    vec2 cell = floor(uv * grid);
    vec2 local = fract(uv * grid) - 0.5;

    // Four bands from the bottom: kick, snare, hats, percussion.
    float band = floor(cell.y / rows * 4.0);
    float drum = drumPerc;
    if (band < 0.5) drum = drumKick;
    else if (band < 1.5) drum = drumSnare;
    else if (band < 2.5) drum = drumHat;

    // Which tiles a hit lights changes as the music evolves.
    float pick = hash(cell + floor(noteEvolve * 2.0));
    float lit = drum * step(pick, 0.35 + drum * 0.65);
    // Build fills the wall in a fixed order, so it grows rather than flickers.
    float filled = step(hash(cell * 1.7 + 3.1), noteBuild);
    float level = max(lit, filled * 0.55);

    float halfSize = 0.5 - gap * 0.5;
    vec2 q = abs(local) - (halfSize - roundness * halfSize);
    float d = length(max(q, 0.0)) - roundness * halfSize;
    float tile = 1.0 - smoothstep(-0.02, 0.02, d);

    float hue = fract(noteLast * 2.0 + band * 0.08);
    vec3 col = hsv2rgb(vec3(hue, saturation, 1.0)) * tile * level;
    col += vec3(0.03) * tile;
    col += noteHit * 0.05 * tile;

    gl_FragColor = vec4(col, 1.0);
}
