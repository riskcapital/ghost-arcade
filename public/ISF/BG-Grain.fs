/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Glitch",
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "35mm grain over slow black blobs cut at a hard threshold. The snare raises the cut, the kick flashes the frame negative.",
    "INPUTS": [
        {
            "NAME": "grain",
            "TYPE": "float",
            "DEFAULT": 0.6,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Grain"
        },
        {
            "NAME": "scale",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Scale"
        },
        {
            "NAME": "threshold",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Threshold"
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
    vec2 p = uv * vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0) * (2.0 + scale * 6.0);
    float t = noteEvolve * 0.25 + TIME * 0.05;
    float blob = noise(p + vec2(t, -t * 0.7)) * 0.65 + noise(p * 2.3 - t) * 0.35;
    float cut = threshold + drumSnare * 0.25 - noteLevel * 0.15;
    float v = smoothstep(cut - 0.02, cut + 0.02, blob);
    // Fresh grain every frame, coarser when the music is loud.
    float g = hash(floor(gl_FragCoord.xy / (1.0 + noteLevel * 2.0)) + fract(TIME * 61.0) * 100.0);
    v = clamp(v + (g - 0.5) * grain, 0.0, 1.0);
    v = mix(v, 1.0 - v, step(0.5, drumKick));
    gl_FragColor = vec4(vec3(v), 1.0);
}
