/*{
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": [
        "Note Reactive",
        "Generator"
    ],
    "DESCRIPTION": "Heavy smoke rolling up through a dark room, lit from below. The bass swells it and lifts the light, the kick punches it outward, and Build slowly thickens the air.",
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
            "NAME": "density",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Density"
        },
        {
            "NAME": "billow",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0,
            "LABEL": "Billow"
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
            "NAME": "tint",
            "TYPE": "color",
            "DEFAULT": [
                0.62,
                0.74,
                1.0,
                1.0
            ],
            "LABEL": "Tint"
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

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Brightness to colour: the tint through the mids, white in the peaks.
vec3 toneTint(float v) {
    float a = 1.0 - exp(-max(v, 0.0));
    return a * mix(tint.rgb, vec3(1.0), a * a * a);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
        a *= 0.5;
    }
    return v;
}

// Low notes count as bass. Note inputs arrive as note / 127.
float bassOf(float pitch, float energy) {
    return energy * (1.0 - smoothstep(44.0, 58.0, pitch * 127.0));
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float bass = bassOf(notePitch0, noteEnergy0) + bassOf(notePitch1, noteEnergy1)
               + bassOf(notePitch2, noteEnergy2) + bassOf(notePitch3, noteEnergy3)
               + bassOf(notePitch4, noteEnergy4) + bassOf(notePitch5, noteEnergy5)
               + bassOf(notePitch6, noteEnergy6) + bassOf(notePitch7, noteEnergy7);
    float swell = clamp(bass * 0.8 + noteLevel * 0.2, 0.0, 1.0);

    // The kick punches the smoke out from the middle.
    p *= 1.0 - drumKick * 0.06 * exp(-dot(p, p) * 3.0);
    float t = TIME * mix(0.012, 0.06, speed) + noteEvolve * 0.02;
    vec2 sp = p * (2.1 - swell * 0.3);
    sp.y -= t * 1.4;

    float warp = mix(0.8, 2.6, billow) * (1.0 + swell * 0.3);
    vec2 q = vec2(fbm(sp + vec2(0.0, t)), fbm(sp + vec2(5.2, 1.3) - t));
    vec2 r = vec2(fbm(sp + warp * q + vec2(1.7, 9.2) + 0.6 * t), fbm(sp + warp * q + vec2(8.3, 2.8) - 0.4 * t));
    float f = fbm(sp + warp * r);
    float wisp = fbm(sp * 3.1 + r * 2.0 - vec2(0.0, t * 2.0));

    // Smoke gathers low in the room and thins as it rises.
    float low = smoothstep(0.75, -0.55, p.y);
    float cut = mix(0.56, 0.32, density) - swell * 0.05 - noteBuild * 0.06 - low * 0.08;
    float dens = smoothstep(cut, cut + 0.4, f) * (0.6 + 0.4 * wisp);

    // One light low in the room: the bass turns it up, the kick flashes it.
    vec2 lp = vec2(0.0, -0.8);
    float light = exp(-dot(p - lp, p - lp) * 1.3);
    float lit = 0.22 + light * (0.7 + swell * 0.7 + drumKick * 0.6);
    // Folds facing away from the light sit in shadow.
    float shade = 0.35 + 0.75 * clamp(0.5 + (r.y - q.x) * 2.2, 0.0, 1.0);
    float v = pow(dens, 1.3) * lit * shade * 1.5;

    vec3 col = toneTint(v * 1.5);
    col += tint.rgb * 0.015 * light * (1.0 + swell);
    col += (hash(gl_FragCoord.xy + fract(TIME * 5.31) * 77.0) - 0.5) * 0.01;
    col *= 1.0 - 0.4 * smoothstep(0.5, 1.1, length(p));
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
