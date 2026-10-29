/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "Each note blooms as a glowing orb on a wheel of the twelve pitches; higher octaves sit further out. In Fade the orbs bloom and vanish, in Build they stay lit and the wheel turns while you play.",
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
            "NAME": "glow",
            "TYPE": "float",
            "DEFAULT": 1.0,
            "MIN": 0.2,
            "MAX": 3.0,
            "LABEL": "Glow"
        },
        {
            "NAME": "spin",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 2.0,
            "LABEL": "Spin"
        },
        {
            "NAME": "saturation",
            "TYPE": "float",
            "DEFAULT": 0.8,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Colour"
        },
        {
            "NAME": "haze",
            "TYPE": "float",
            "DEFAULT": 0.6,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Haze"
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
            "NAME": "noteVoice0",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 2.0,
            "LABEL": "Note 1 instrument"
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
            "NAME": "noteVoice1",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 2.0,
            "LABEL": "Note 2 instrument"
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
            "NAME": "noteVoice2",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 2.0,
            "LABEL": "Note 3 instrument"
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
            "NAME": "noteVoice3",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 2.0,
            "LABEL": "Note 4 instrument"
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
            "NAME": "noteVoice4",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 2.0,
            "LABEL": "Note 5 instrument"
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
            "NAME": "noteVoice5",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 2.0,
            "LABEL": "Note 6 instrument"
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
            "NAME": "noteVoice6",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 2.0,
            "LABEL": "Note 7 instrument"
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
            "NAME": "noteVoice7",
            "TYPE": "float",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 2.0,
            "LABEL": "Note 8 instrument"
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

vec3 orb(vec2 uv, float pitch, float energy, float instrument) {
    if (energy < 0.002) return vec3(0.0);
    float pc = pitchClass(pitch);
    float oct = clamp((octaveOf(pitch) - 2.0) / 6.0, 0.0, 1.0);
    float angle = pc / 12.0 * 6.2831853 + noteEvolve * spin * 0.35;
    float radius = 0.1 + oct * 0.34;
    vec2 centre = vec2(cos(angle), sin(angle)) * radius;
    float size = (0.018 + 0.07 * energy) * glow;
    float d = length(uv - centre);
    float core = exp(-(d * d) / (size * size));
    float halo = size * 0.05 / (d * d + 0.002);
    float hue = pc / 12.0 + instrument * 0.07;
    return hsv2rgb(vec3(hue, saturation, 1.0)) * (core * 1.6 + halo * 0.6) * energy;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    // The kick breathes the whole wheel.
    uv *= 1.0 - drumKick * 0.06;

    vec3 col = vec3(0.0);
    col += orb(uv, notePitch0, noteEnergy0, noteVoice0);
    col += orb(uv, notePitch1, noteEnergy1, noteVoice1);
    col += orb(uv, notePitch2, noteEnergy2, noteVoice2);
    col += orb(uv, notePitch3, noteEnergy3, noteVoice3);
    col += orb(uv, notePitch4, noteEnergy4, noteVoice4);
    col += orb(uv, notePitch5, noteEnergy5, noteVoice5);
    col += orb(uv, notePitch6, noteEnergy6, noteVoice6);
    col += orb(uv, notePitch7, noteEnergy7, noteVoice7);

    // Playing builds up a slow, turning haze behind the wheel.
    float r = length(uv);
    float a = atan(uv.y, uv.x);
    float swirl = 0.5 + 0.5 * sin(a * 3.0 + r * 9.0 - noteEvolve * 0.8);
    vec3 hazeCol = hsv2rgb(vec3(fract(noteEvolve * 0.02 + r * 0.3), saturation * 0.7, 1.0));
    col += hazeCol * swirl * noteBuild * haze * 0.6 * exp(-r * 2.2);
    col += vec3(1.0) * noteHit * 0.04 * exp(-r * 3.0);

    col = 1.0 - exp(-col * 1.9);
    gl_FragColor = vec4(col, 1.0);
}
