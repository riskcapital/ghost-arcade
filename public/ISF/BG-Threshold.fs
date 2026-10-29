/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Glitch",
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "Contour lines of a drifting field, like a hard threshold sweeping through it. The music widens the bands; the hats jitter them.",
    "INPUTS": [
        {
            "NAME": "bands",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Bands"
        },
        {
            "NAME": "drift",
            "TYPE": "float",
            "DEFAULT": 0.4,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Drift"
        },
        {
            "NAME": "sharp",
            "TYPE": "float",
            "DEFAULT": 0.7,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Sharp"
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
    vec2 p = uv * vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0) * 3.0;
    float t = noteEvolve * 0.2 + TIME * drift * 0.05;
    float field = noise(p + t) * 0.6 + noise(p * 2.0 - t * 1.3) * 0.3 + noise(p * 5.0 + t) * 0.1;
    float count = 4.0 + bands * 20.0 + noteBuild * 8.0;
    float jitter = (hash(floor(gl_FragCoord.yy / 3.0) + floor(TIME * 30.0)) - 0.5) * drumHat * 0.04;
    float c = fract((field + jitter) * count);
    float width = 0.08 + noteLevel * 0.35;
    float v = 1.0 - smoothstep(width, width + (1.0 - sharp) * 0.2 + 0.005, c);
    gl_FragColor = vec4(vec3(v), 1.0);
}
