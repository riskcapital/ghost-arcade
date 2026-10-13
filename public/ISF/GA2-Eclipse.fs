/*{
    "DESCRIPTION": "A total solar eclipse. The moon's disc hides the sun and leaves the corona: long streamers along the equator, short plumes at the poles, drawn out by a flow that never repeats. Slide the moon off-centre for the diamond ring, raise the beads for the last sunlight through lunar valleys, and add prominences on the limb. Bass breathes the corona outward, beats flash the diamond, spectral centroid stirs the streamers.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Totality", "Hydrogen", "Extreme UV", "Soft X-ray", "Blood Moon", "Aurora", "Engraving"]},
        {"NAME": "moonSize",   "TYPE": "float", "DEFAULT": 0.22, "MIN": 0.05, "MAX": 0.45},
        {"NAME": "reach",      "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.50},
        {"NAME": "streamers",  "TYPE": "float", "DEFAULT": 9.00, "MIN": 2.00, "MAX": 24.0},
        {"NAME": "fineness",   "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "equator",    "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "tilt",       "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "flow",       "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "diamond",    "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "diamondAngle","TYPE": "float", "DEFAULT": 0.12, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "beads",      "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "prominences","TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "stars",      "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "streak",     "TYPE": "float", "DEFAULT": 0.20, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",   "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",   "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * The corona is drawn in polar coordinates about the sun, with no marching.
 *
 * Its brightness falls with distance as a power law, as the real K-corona
 * does, and is then cut into streamers by a noise field sampled on a cylinder:
 * (cos a, sin a) for the angle, so the pattern closes on itself with no seam,
 * and log r for the radius, so a streamer keeps the same width in angle the
 * whole way out. Sliding the radial coordinate over time makes the structure
 * flow outward. A second, slower sample displaces the first, which is what
 * turns straight spokes into the combed, slightly braided look of a real
 * corona photograph.
 *
 * The solar minimum shape - long streamers at the equator, short brushes at
 * the poles - is a single cosine of the angle applied to the reach.
 */

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

float hash31(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x),
                  mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y);
    float b = mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x),
                  mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y);
    return mix(a, b, f.z);
}

float fbm(vec3 p) {
    float v = 0.0;
    float w = 0.5;
    for (int i = 0; i < 4; i++) {
        v += w * noise3(p);
        p = p * 2.03 + vec3(7.1, 3.7, 1.9);
        w *= 0.5;
    }
    return v;
}

/*
 * Palettes for this shader alone: each is a way of photographing the sun.
 * Columns: [inner corona, sky, outer corona]. The limb itself always burns
 * to white; these colour what the light becomes as it thins out.
 */
mat3 paletteFor(int mode) {
    vec3 inner, sky, outer;
    if (mode == 1) {            /* Hydrogen - H-alpha red */
        inner = vec3(1.00, 0.42, 0.20);
        sky   = vec3(0.020, 0.004, 0.006);
        outer = vec3(0.86, 0.08, 0.10);
    } else if (mode == 2) {     /* Extreme UV - the gold of a 171 angstrom image */
        inner = vec3(1.00, 0.84, 0.36);
        sky   = vec3(0.016, 0.010, 0.002);
        outer = vec3(0.86, 0.48, 0.06);
    } else if (mode == 3) {     /* Soft X-ray - teal */
        inner = vec3(0.56, 1.00, 0.92);
        sky   = vec3(0.002, 0.014, 0.018);
        outer = vec3(0.06, 0.52, 0.66);
    } else if (mode == 4) {     /* Blood Moon - copper and rust */
        inner = vec3(1.00, 0.62, 0.36);
        sky   = vec3(0.018, 0.006, 0.010);
        outer = vec3(0.62, 0.14, 0.10);
    } else if (mode == 5) {     /* Aurora - green into violet */
        inner = vec3(0.48, 1.00, 0.62);
        sky   = vec3(0.004, 0.008, 0.022);
        outer = vec3(0.52, 0.24, 0.96);
    } else if (mode == 6) {     /* Engraving - ink on paper */
        inner = vec3(0.10, 0.09, 0.08);
        sky   = vec3(0.93, 0.90, 0.83);
        outer = vec3(0.26, 0.22, 0.20);
    } else {                    /* Totality - pearl white into cold blue */
        inner = vec3(1.00, 0.96, 0.90);
        sky   = vec3(0.006, 0.008, 0.020);
        outer = vec3(0.52, 0.66, 1.00);
    }
    return mat3(inner, sky, outer);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    /* Idle fallbacks so the corona still breathes with nothing bound. */
    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.13));
    float beat = audioBeat;

    float R = moonSize;
    float px = 1.0 / RENDERSIZE.y;

    /* The moon slides off the sun along diamondAngle; the sun stays put. */
    float da = diamondAngle * TAU;
    vec2 dirD = vec2(cos(da), sin(da));
    vec2 moon = -dirD * diamond * R * 0.11;
    float sunR = R * 0.985;

    float r = length(uv);
    float ang = atan(uv.y, uv.x);
    float rn = r / sunR;                       /* radius in solar radii */

    /* --- Corona -------------------------------------------------------- */
    float axis = ang - tilt * PI;
    /* 1 on the equator, 0 at the poles. */
    float lat = abs(cos(axis));
    float shape = mix(1.0, 0.30 + 0.95 * pow(lat, 1.6), equator);
    float len = reach * shape * (0.80 + 0.55 * bass);

    float lr = log(max(rn, 1e-3));
    float t = TIME * flow;
    vec2 ring = vec2(cos(ang), sin(ang));
    /* Slow displacement field, then the streamers themselves. */
    float warp = fbm(vec3(ring * 1.3, lr * 0.9 - t * 0.10)) - 0.5;
    float k = streamers * 0.36;
    vec3 sp = vec3(ring * k + warp * (0.9 + 1.4 * centroid), lr * 0.55 - t * 0.22);
    float coarse = fbm(sp);
    float fine = fbm(vec3(ring * k * 4.3 + warp * 2.0, lr * 1.3 - t * 0.5));
    float strand = mix(coarse, coarse * 0.55 + fine * 0.75, fineness);
    /* Sharpen into rays: most angles are dim, a few carry the light. */
    float rays = smoothstep(0.30, 0.78, strand);
    rays = 0.16 + 1.15 * rays * rays;

    /* Power-law falloff; `len` stretches how far each direction reaches. */
    float fall = pow(max(rn, 1.0), -2.6 / max(len, 0.05));
    float inner = pow(max(rn, 1.0), -9.0);                 /* the bright inner corona */
    float corona = (fall * rays * 0.55 + inner * 1.6) * step(1.0, rn);
    /* Outside the limb only; fade the first hair so the edge is not a step. */
    corona *= smoothstep(1.0, 1.0 + 6.0 * px / sunR, rn);

    /* --- Prominences: arcs of red on the limb ---------------------------- */
    float pn = noise3(vec3(ring * 3.1, t * 0.12 + 4.0));
    float pmask = smoothstep(0.62, 0.86, pn);
    float parc = fbm(vec3(ring * 9.0, lr * 9.0 + t * 0.35));
    float ph = (rn - 1.0) / (0.05 + 0.10 * pn);
    float prom = pmask * smoothstep(1.0, 0.0, ph) * smoothstep(0.20, 0.62, parc + 0.30 * (1.0 - ph)) * prominences * 1.6;
    prom *= step(1.0, rn);

    /* --- Chromosphere: a hairline of pink right at the limb -------------- */
    float chromo = exp(-abs(rn - 1.012) * 240.0) * step(0.999, rn);

    /* --- Diamond ring and Baily's beads ---------------------------------- */
    vec2 limb = dirD * sunR;
    float dd = length(uv - limb);
    float sparkle = diamond * (0.9 + 1.6 * beat);
    float gem = sparkle * (0.00042 / (dd * dd + 0.000016) + 0.030 / (dd + 0.014));
    /* Beads: sunlight through valleys either side of the last contact point. */
    float along = (ang - da);
    along = atan(sin(along), cos(along));
    float valley = noise3(vec3(ring * 46.0, 2.0));
    float beadMask = smoothstep(0.55, 0.9, valley) * exp(-along * along * mix(60.0, 6.0, beads));
    float beadGlow = beads * beadMask * exp(-abs(rn - 1.0) * 150.0) * (2.0 + 3.0 * diamond);

    /* --- Stars ----------------------------------------------------------- */
    vec2 sg = uv * 42.0;
    vec2 cell = floor(sg);
    vec2 sp2 = fract(sg) - 0.5;
    float sh = hash21(cell);
    vec2 so = vec2(hash21(cell + 7.3), hash21(cell + 19.1)) - 0.5;
    float sd = length(sp2 - so * 0.7);
    float twinkle = 0.7 + 0.3 * sin(TIME * (1.0 + sh * 3.0) + sh * 40.0);
    float star = step(0.90, sh) * smoothstep(0.09, 0.0, sd) * twinkle * stars;

    /* --- Anamorphic streak through the sun -------------------------------- */
    float streakLine = exp(-abs(uv.y) * 130.0) * exp(-abs(uv.x) * 1.6) * streak * (0.35 + 1.8 * diamond + 0.5 * level);

    /* --- Colour ----------------------------------------------------------- */
    mat3 pal = paletteFor(int(colorMode));
    float turn = hueShift;
    vec3 INNER = hueRotate(pal[0], turn);
    vec3 SKY = pal[1];
    vec3 OUTER = hueRotate(pal[2], turn);
    bool ink = int(colorMode) == 6;

    /* Colour thins from the inner tone to the outer one with distance. */
    float thin = clamp((rn - 1.0) / (1.6 * max(len, 0.2)), 0.0, 1.0);
    vec3 tone = mix(INNER, OUTER, smoothstep(0.0, 1.0, thin));
    vec3 hot = ink ? INNER : vec3(1.0);

    vec3 light = tone * corona * 1.25;
    light += hot * inner * 0.9 * step(1.0, rn);
    light += (ink ? OUTER : vec3(1.00, 0.20, 0.34)) * (prom * 1.9 + chromo * 0.9 * (0.4 + prominences));
    light += hot * (gem + beadGlow);
    light += mix(tone, hot, 0.5) * streakLine;

    vec3 col;
    if (ink) {
        /* Engraving: light becomes ink density on paper. */
        float density = clamp(dot(light, vec3(0.34)) * 1.25, 0.0, 1.0);
        col = mix(SKY, INNER, density);
        col = mix(col, SKY * 0.96, star * 0.0);
    } else {
        /* Stars drown in the corona's glare, as they do on the day. */
        float glare = clamp(dot(light, vec3(0.33)) * 4.0, 0.0, 1.0);
        col = SKY + light + vec3(0.86, 0.90, 1.0) * star * (1.0 - glare);
    }

    /* --- The moon ---------------------------------------------------------- */
    float md = length(uv - moon) - R;
    float moonMask = 1.0 - smoothstep(-px, px, md);
    /* Earthshine: the faintest maria, so the disc is a body and not a hole. */
    vec2 mp = (uv - moon) / R;
    float maria = fbm(vec3(mp * 2.2, 3.0)) * 0.7 + fbm(vec3(mp * 6.0, 9.0)) * 0.3;
    float curve = sqrt(max(1.0 - dot(mp, mp), 0.0));
    vec3 moonCol = ink ? INNER * (0.92 + 0.08 * maria)
                       : SKY * 0.5 + mix(OUTER, vec3(0.5, 0.6, 0.8), 0.6) * (0.010 + 0.022 * maria) * curve;
    col = mix(col, moonCol, moonMask);
    /* The diamond blooms over the moon's edge. */
    if (!ink) col += hot * gem * 0.35 * moonMask;

    col *= 1.0 + beat * 0.15;
    col *= exposure;
    if (!ink) {
        col = col / (1.0 + 0.30 * col);
        col *= 1.30;
    }

    gl_FragColor = vec4(col, 1.0);
}
