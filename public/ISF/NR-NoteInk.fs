/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "Each note is a brush that paints coloured ink across the canvas, its path set by the pitch. In Fade the ink washes away soon after a note ends; in Build it stays and keeps flowing, so a whole performance paints one picture.",
    "PERSISTENT_BUFFERS": [
        "inkBuffer"
    ],
    "PASSES": [
        {
            "TARGET": "inkBuffer",
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
            "NAME": "brushSize",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.1,
            "MAX": 1.0,
            "LABEL": "Brush"
        },
        {
            "NAME": "flow",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Flow"
        },
        {
            "NAME": "fadeSpeed",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Fade speed"
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
            "NAME": "noteEvolve",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1000.0,
            "LABEL": "Evolve"
        },
        {
            "NAME": "noteBuilding",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Building"
        },
        {
            "NAME": "drumKick",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Kick"
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

vec2 brushAt(float pitch) {
    // Each pitch draws its own Lissajous path; the path advances only while notes sound.
    float pc = pitchClass(pitch);
    float oct = octaveOf(pitch);
    float t = noteEvolve * 1.4 + pc * 0.52;
    return vec2(0.5 + 0.38 * sin(t * (1.0 + pc * 0.07) + oct),
                0.5 + 0.38 * sin(t * (1.3 + oct * 0.05) + pc));
}

vec3 paint(vec2 uv, float aspect, float pitch, float energy) {
    if (energy < 0.002) return vec3(0.0);
    vec2 d = uv - brushAt(pitch);
    d.x *= aspect;
    float size = (0.01 + 0.035 * brushSize) * (0.4 + energy);
    float dab = exp(-dot(d, d) / (size * size));
    return hsv2rgb(vec3(pitchClass(pitch) / 12.0, saturation, 1.0)) * dab * energy * 0.35;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    if (PASSINDEX == 0) {
        // The ink drifts on a slow curl so a built picture keeps moving.
        vec2 p = uv * 3.0;
        float e = noteEvolve * 0.3;
        vec2 drift = vec2(sin(p.y + e) - sin(p.x * 0.7 - e), cos(p.x + e * 0.8) - cos(p.y * 0.6 + e));
        vec2 from = uv - drift * flow * 0.0012;
        vec3 ink = IMG_NORM_PIXEL(inkBuffer, from).rgb;
        // Build keeps the ink; Fade washes it out, faster with Fade speed.
        float washFade = mix(0.975, 0.86, fadeSpeed);
        float keep = mix(washFade, 0.9985, noteBuilding);
        ink *= keep;
        ink += paint(uv, aspect, notePitch0, noteEnergy0);
        ink += paint(uv, aspect, notePitch1, noteEnergy1);
        ink += paint(uv, aspect, notePitch2, noteEnergy2);
        ink += paint(uv, aspect, notePitch3, noteEnergy3);
        ink += paint(uv, aspect, notePitch4, noteEnergy4);
        ink += paint(uv, aspect, notePitch5, noteEnergy5);
        ink += paint(uv, aspect, notePitch6, noteEnergy6);
        ink += paint(uv, aspect, notePitch7, noteEnergy7);
        gl_FragColor = vec4(min(ink, vec3(4.0)), 1.0);
    } else {
        vec3 ink = IMG_NORM_PIXEL(inkBuffer, uv).rgb;
        // The brush tips sit on top of the ink they leave.
        vec3 tips = paint(uv, aspect, notePitch0, noteEnergy0) + paint(uv, aspect, notePitch1, noteEnergy1)
                  + paint(uv, aspect, notePitch2, noteEnergy2) + paint(uv, aspect, notePitch3, noteEnergy3)
                  + paint(uv, aspect, notePitch4, noteEnergy4) + paint(uv, aspect, notePitch5, noteEnergy5)
                  + paint(uv, aspect, notePitch6, noteEnergy6) + paint(uv, aspect, notePitch7, noteEnergy7);
        ink += tips * 2.0;
        vec3 col = 1.0 - exp(-ink * (1.4 + drumKick * 0.6));
        col += noteHit * 0.02;
        gl_FragColor = vec4(col, 1.0);
    }
}
