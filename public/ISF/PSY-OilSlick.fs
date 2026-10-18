/*{
    "DESCRIPTION": "An oil slick. A film of oil a few hundred millionths of a metre thick on wet black tarmac, and the colours that come from nothing but its thickness: light reflecting off the top of the film and off the bottom interferes, so each thickness cancels some colours and doubles others. The bands are contour lines of the film. It swirls, thins toward its edges, and rings spread through it when something drops in. Seven films, from petrol on a puddle to a soap bubble about to burst. Bass thickens the film, beats drop into it, spectral centroid stirs it.",
    "CREDIT": "Ghost Arcade psychedelic pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Petrol", "Soap Bubble", "Beetle Shell", "Bismuth", "Mother of Pearl", "Heat Tint", "Infrared Film"]},
        {"NAME": "thickness", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.05, "MAX": 1.00},
        {"NAME": "variation", "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.05, "MAX": 1.50},
        {"NAME": "scale",     "TYPE": "float", "DEFAULT": 1.60, "MIN": 0.40, "MAX": 6.00},
        {"NAME": "swirl",     "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "flow",      "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "coverage",  "TYPE": "float", "DEFAULT": 0.75, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "drops",     "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "dropRate",  "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.05, "MAX": 2.00},
        {"NAME": "viewAngle", "TYPE": "float", "DEFAULT": 0.20, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "wetness",   "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "vivid",     "TYPE": "float", "DEFAULT": 0.80, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Thin-film interference.
 *
 * Light meets the top of the film and some reflects. The rest goes in,
 * reflects off the bottom, and comes back out having travelled further by
 * twice the film's thickness times its refractive index (and a cosine for
 * the slant). If that extra distance is a whole number of wavelengths the
 * two reflections add; half a wavelength out and they cancel.
 *
 * So for film thickness d the brightness of a colour of wavelength L is
 *
 *     0.5 + 0.5 cos( 4 pi n d cos(t) / L + phase )
 *
 * and red, green and blue, having different wavelengths, each peak at
 * different thicknesses. Evaluating that for three wavelengths is the entire
 * colour model here. The order of the colours across a band, the way the
 * bands fade to pastel and then to grey as the film thickens, and the black
 * where it is thinnest are not painted; they come out of the sum.
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

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

vec3 saturate3(vec3 c, float amount) {
    float g = dot(c, vec3(0.299, 0.587, 0.114));
    return max(mix(vec3(g), c, amount), 0.0);
}


/* Wavelengths (in units of 100 nm) to evaluate, per film. Columns unused: one vec3. */
vec3 wavelengthsFor(int mode) {
    if (mode == 1) return vec3(6.5, 5.3, 4.4);       /* Soap Bubble: true RGB */
    if (mode == 2) return vec3(5.9, 5.2, 4.9);       /* Beetle Shell: narrow, greens and bronze */
    if (mode == 3) return vec3(7.4, 5.6, 4.2);       /* Bismuth: wide, hard steps */
    if (mode == 4) return vec3(6.1, 5.6, 5.1);       /* Mother of Pearl: close together, soft */
    if (mode == 5) return vec3(6.8, 5.9, 4.9);       /* Heat Tint: straw, purple, blue */
    if (mode == 6) return vec3(4.6, 6.8, 5.6);       /* Infrared Film: channels crossed */
    return vec3(6.5, 5.3, 4.4);                      /* Petrol */
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    int mode = int(colorMode);
    vec2 p = uv * scale;
    float t = TIME * flow;

    /* The film is stirred: its thickness field is carried round by a slower one. */
    vec2 carry = vec2(fbm(p * 0.7 + vec2(t * 0.20, 3.0)), fbm(p * 0.7 + vec2(7.0, -t * 0.17))) - 0.5;
    vec2 q = p + carry * swirl * (1.6 + 1.0 * centroid);
    float field = fbm(q * 1.1 + vec2(-t * 0.08, t * 0.05));
    float fineField = fbm(q * 3.3 + 11.0);

    /* Drops: rings travelling out through the film from where something fell. */
    float ripple = 0.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float clock = TIME * dropRate * 0.35 + fi * 0.37;
        float born = floor(clock);
        float age = fract(clock);
        vec2 where = (vec2(hash21(vec2(born, fi * 3.0 + 1.0)), hash21(vec2(born, fi * 7.0 + 5.0))) - 0.5) * vec2(2.6, 1.3);
        float dist = length(uv - where);
        float front = age * 1.3;
        ripple += sin((dist - front) * 46.0) * exp(-pow((dist - front) * 5.0, 2.0)) * (1.0 - age) * (0.6 + 1.2 * beat);
    }

    /* Thickness in units of 100 nm. */
    float d = thickness * 7.0 * (0.80 + 0.5 * bass)
            + variation * 9.0 * (field - 0.45)
            + variation * 1.3 * (fineField - 0.5)
            + drops * 1.1 * ripple;
    /* The film runs out toward the edges of the patch. */
    float patch = smoothstep(1.0 - coverage, 1.0 - coverage + 0.35, fbm(p * 0.45 + 20.0) + 0.25);
    d *= patch;
    d = max(d, 0.0);

    /* Slant: seen at a glancing angle the path through the film shortens. */
    float cosT = cos(viewAngle * 1.1 * (0.85 + 0.3 * uv.y));
    float path = 2.0 * 1.45 * d * cosT;                        /* optical path difference */
    vec3 lambda = wavelengthsFor(mode);
    /* The half-wave flip at the top surface is the `+ pi`: a film of no
       thickness reflects nothing, which is the black of the thinnest part. */
    vec3 interference = 0.5 + 0.5 * cos(TAU * path / lambda + PI);
    /* Beyond a few wavelengths the fringes of different colours wash into
       each other; the eye sees pastel, then pearl-grey. */
    float coherence = exp(-d * mix(0.055, 0.020, clamp(vivid, 0.0, 1.0)));
    vec3 film = mix(vec3(0.5), interference, coherence);
    film = saturate3(film, 0.6 + vivid);
    if (mode == 5) film = film * vec3(1.0, 0.86, 0.70);         /* steel under the oxide */
    film = hueRotate(film, hueShift);

    /* Tarmac: black, wet, pebbled. */
    float pebble = noise2(gl_FragCoord.xy * 0.35) * 0.6 + noise2(gl_FragCoord.xy * 0.9) * 0.4;
    vec3 ground = vec3(0.020, 0.022, 0.026) * (0.6 + 0.8 * pebble);
    /* The sky in the wet: a soft bright band the film sits in. */
    float sky = (0.35 + 0.65 * smoothstep(-0.6, 0.7, uv.y + carry.y * 0.3)) * wetness;

    vec3 col = ground + film * patch * (0.25 + 0.85 * sky + 0.25 * level) * smoothstep(0.0, 0.6, d);
    /* A glint where the surface tilts toward the light. */
    float tiltGlint = pow(max(1.0 - abs(fineField - 0.5) * 6.0, 0.0), 8.0) * wetness;
    col += vec3(0.9, 0.95, 1.0) * tiltGlint * 0.10 * patch;

    col *= 1.0 + beat * 0.10;
    col *= 1.0 - 0.25 * dot(uv, uv);
    col *= exposure * 1.35;
    col = col / (1.0 + 0.16 * col);
    col *= 1.16;

    gl_FragColor = vec4(col, 1.0);
}
