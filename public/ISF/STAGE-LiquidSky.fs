/*{
    "DESCRIPTION": "Liquid sky. A laser scanned into a flat sheet cuts through haze and shows the smoke as a slice: slow rolling marble with a hard bright edge, the effect that fills the air over a crowd. Open the fan, set where the laser sits, choose a smooth sheet or separate beams, and control the smoke: how thick, how fast it rolls, how turbulent. Scan lines, sparkle and a second sheet in another colour are there when you want more. Bass thickens the smoke, beats flash the sheet, spectral centroid opens the fan.",
    "CREDIT": "Ghost Arcade 2.0 stage pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Argon Green", "Krypton Red", "Sapphire", "RGB White", "Cyan and Magenta", "Gold", "Violet"]},
        {"NAME": "sheets",    "TYPE": "long",  "DEFAULT": 1,
         "VALUES": [1, 2, 3], "LABELS": ["One sheet", "Two sheets", "Three sheets"]},
        {"NAME": "sourceX",   "TYPE": "float", "DEFAULT": 0.50, "MIN": -0.20, "MAX": 1.20},
        {"NAME": "sourceY",   "TYPE": "float", "DEFAULT": 0.00, "MIN": -0.30, "MAX": 1.30},
        {"NAME": "direction", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "fanWidth",  "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.02, "MAX": 1.00},
        {"NAME": "sweep",     "TYPE": "float", "DEFAULT": 0.20, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "sweepSpeed","TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 3.00},
        {"NAME": "beams",     "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0, "MAX": 48.0},
        {"NAME": "beamSharp", "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "edgeLine",  "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "smoke",     "TYPE": "float", "DEFAULT": 0.75, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "smokeScale","TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "smokeSpeed","TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "turbulence","TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "contrast",  "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "scanLines", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "sparkle",   "TYPE": "float", "DEFAULT": 0.20, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "throwLength","TYPE": "float", "DEFAULT": 0.85, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * A laser beam swept fast enough reads as a sheet of light. The sheet has no
 * thickness, so where it passes through haze it lights one slice of the
 * smoke and nothing either side, and you see the smoke's cross-section drawn
 * in pure colour. From the side that slice is a wedge: bright at its two
 * edges, where the scanner dwells as it turns round, and marbled in between.
 *
 * The wedge is described in polar coordinates about the laser. The smoke is
 * noise that has been pushed around by slower noise, which is what gives the
 * rolling, folded look rather than a blur of cloud.
 */

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float w = 0.5;
    for (int i = 0; i < 5; i++) {
        v += w * noise2(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(3.1, 7.7);
        w *= 0.5;
    }
    return v;
}

/* Laser lines. Columns: one colour per sheet. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Krypton Red */
        a = vec3(1.00, 0.04, 0.06);
        b = vec3(1.00, 0.36, 0.04);
        c = vec3(1.00, 0.06, 0.40);
    } else if (mode == 2) {     /* Sapphire */
        a = vec3(0.06, 0.26, 1.00);
        b = vec3(0.10, 0.80, 1.00);
        c = vec3(0.40, 0.20, 1.00);
    } else if (mode == 3) {     /* RGB White */
        a = vec3(0.90, 0.96, 1.00);
        b = vec3(1.00, 0.20, 0.20);
        c = vec3(0.20, 0.40, 1.00);
    } else if (mode == 4) {     /* Cyan and Magenta */
        a = vec3(0.04, 0.92, 1.00);
        b = vec3(1.00, 0.06, 0.80);
        c = vec3(0.50, 0.30, 1.00);
    } else if (mode == 5) {     /* Gold */
        a = vec3(1.00, 0.72, 0.10);
        b = vec3(1.00, 0.40, 0.04);
        c = vec3(1.00, 0.92, 0.50);
    } else if (mode == 6) {     /* Violet */
        a = vec3(0.56, 0.10, 1.00);
        b = vec3(0.92, 0.20, 1.00);
        c = vec3(0.26, 0.36, 1.00);
    } else {                    /* Argon Green */
        a = vec3(0.06, 1.00, 0.30);
        b = vec3(0.04, 0.80, 1.00);
        c = vec3(0.70, 1.00, 0.20);
    }
    return mat3(a, b, c);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float levelIn = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    mat3 pal = paletteFor(int(colorMode));
    int n = int(sheets);
    vec2 source = vec2((sourceX - 0.5) * aspect, sourceY - 0.5);
    float reach = throwLength * 2.6;

    vec3 col = vec3(0.0);
    for (int s = 0; s < 3; s++) {
        if (s >= n) break;
        float fs = float(s);
        /* Each sheet aims a little apart and rolls its own smoke. */
        float aimAngle = direction * TAU + fs * 0.42 + sweep * 0.9 * sin(TIME * sweepSpeed * (1.0 + 0.3 * fs) + fs * 2.0);
        float halfFan = (0.04 + 1.25 * fanWidth) * (0.80 + 0.40 * centroid) * 0.5;

        vec2 d = uv - source;
        float r = length(d);
        float a = atan(d.y, d.x) - aimAngle;
        a = atan(sin(a), cos(a));                      /* wrap to -pi .. pi */
        float edge = abs(a) / halfFan;                 /* 0 centre .. 1 at the sheet's edge */
        /* Angular size of a pixel here, so thin features stay one pixel soft. */
        float apx = 1.5 / (max(r, 0.02) * res.y) / halfFan;
        float inside = 1.0 - smoothstep(1.0 - apx, 1.0 + apx, edge);

        /* Smoke: noise carried along by slower noise, in sheet coordinates so
           it rolls outward from the laser. */
        float k = 1.2 + 4.5 * smokeScale;
        float t = TIME * smokeSpeed;
        vec2 sp = vec2(a * 2.2, r * 1.6) * k + vec2(fs * 9.0, -t * 0.55);
        vec2 warp = vec2(fbm(sp * 0.6 + vec2(0.0, t * 0.21)), fbm(sp * 0.6 + vec2(5.2, -t * 0.17))) - 0.5;
        float cloud = fbm(sp + warp * (1.2 + 3.2 * turbulence));
        float lo = mix(0.50, 0.30, contrast);
        float hi = mix(0.52, 0.74, contrast);
        float marble = smoothstep(lo, hi, cloud);
        float density = smoke * (0.75 + 0.6 * bass) * mix(1.0, marble * 1.5, 0.35 + 0.65 * contrast);

        /* Separate beams instead of a continuous sheet. */
        float count = floor(beams);
        float lines = 1.0;
        if (count >= 2.0) {
            float cell = (a / halfFan * 0.5 + 0.5) * (count - 1.0);
            float dist = abs(fract(cell + 0.5) - 0.5);
            float wpx = apx * (count - 1.0) * 0.5;
            float width = mix(0.30, 0.035, beamSharp);
            lines = 1.0 - smoothstep(width - wpx, width + wpx, dist);
            lines *= 1.6;
        }

        /* The scanner dwells at each end, so the sheet's edges burn brighter. */
        float rim = exp(-pow((1.0 - edge) / max(0.012 + apx * 0.6, 0.004), 2.0)) * inside;

        /* Scan lines sweeping round the fan, and sparkle off dust. */
        float scan = 1.0 + scanLines * 0.8 * sin((a / halfFan) * 60.0 + TIME * 14.0 + fs * 2.0);
        float dust = step(1.0 - sparkle * 0.06, hash21(floor(gl_FragCoord.xy * 0.5) + floor(TIME * 24.0) * 7.0 + fs));

        float runout = 1.0 - smoothstep(reach * 0.55, reach, r);
        float nearGlow = 1.0 / (1.0 + r * 1.6);

        vec3 line = hueRotate(s == 0 ? pal[0] : s == 1 ? pal[1] : pal[2], hueShift);
        float body = inside * density * lines * scan * (0.55 + 0.6 * nearGlow);
        float flare = rim * edgeLine * (0.9 + 0.6 * levelIn);
        col += line * (body + flare + dust * inside * density * 2.5) * runout;

        /* The aperture: a hard point of light. */
        col += mix(line, vec3(1.0), 0.6) * (0.00030 / (r * r + 0.00010)) * 0.6;
    }

    col *= 1.0 + beat * 0.30;
    col *= exposure;
    col = col / (1.0 + 0.20 * col);
    col *= 1.20;

    gl_FragColor = vec4(col, 1.0);
}
