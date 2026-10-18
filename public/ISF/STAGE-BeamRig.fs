/*{
    "DESCRIPTION": "A truss of moving-head beams. Up to twelve fixtures hang along the top of the frame and throw hard-edged beams through haze, with a second row on the floor if you want it. Pick how they move (fan, cross, wave, ballyhoo, converge or parked), how wide and long the beams are, how the colours are dealt across the rig, and how the dimmers chase. A prism splits every beam in three. On black, so a projector aimed across a band becomes the lighting rig. Bass lifts the dimmers, beats step the chase, spectral centroid opens the fan.",
    "CREDIT": "Ghost Arcade 2.0 stage pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Arena", "Congo and Amber", "Ice", "Sunset", "Emerald", "Rose Gold", "Open White"]},
        {"NAME": "colorPattern", "TYPE": "long", "DEFAULT": 1,
         "VALUES": [0, 1, 2, 3, 4, 5],
         "LABELS": ["One colour", "Alternate", "Three-way", "Spread across rig", "Colour chase", "Rainbow"]},
        {"NAME": "fixtures",  "TYPE": "long",  "DEFAULT": 8,
         "VALUES": [1, 2, 3, 4, 5, 6, 8, 10, 12], "LABELS": ["1", "2", "3", "4", "5", "6", "8", "10", "12"]},
        {"NAME": "movement",  "TYPE": "long",  "DEFAULT": 2,
         "VALUES": [0, 1, 2, 3, 4, 5],
         "LABELS": ["Fan", "Cross", "Wave", "Ballyhoo", "Converge", "Parked"]},
        {"NAME": "speed",     "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 3.00},
        {"NAME": "swing",     "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "aim",       "TYPE": "float", "DEFAULT": 0.00, "MIN": -1.00, "MAX": 1.00},
        {"NAME": "beamWidth", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.02, "MAX": 1.00},
        {"NAME": "zoom",      "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "edge",      "TYPE": "float", "DEFAULT": 0.65, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "throwLength","TYPE": "float", "DEFAULT": 0.80, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "rigSpan",   "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.10, "MAX": 1.20},
        {"NAME": "rigHeight", "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.30, "MAX": 1.30},
        {"NAME": "floorRow",  "TYPE": "bool",  "DEFAULT": 0},
        {"NAME": "prism",     "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "haze",      "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "hazeTexture","TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hazeDrift", "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "chase",     "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "chaseSpeed","TYPE": "float", "DEFAULT": 1.00, "MIN": 0.00, "MAX": 6.00},
        {"NAME": "strobe",    "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "lensGlow",  "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * A beam in haze, seen side on, is a cone: it starts at the lens, widens at
 * a fixed angle and thins as the light spreads. Each one is drawn in closed
 * form from the pixel's distance along the beam and across it, so a fixture
 * costs a dozen multiplies and there is no marching.
 *
 * Air only shows a beam where there is haze to scatter it. The haze here is
 * one slow noise field shared by every beam, so they all pick out the same
 * drifting wisps, which is what makes a rig of separate lights read as one
 * room.
 */

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const int MAX_FIXTURES = 12;

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

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

float smoke(vec2 p) {
    float v = 0.0;
    float w = 0.5;
    for (int i = 0; i < 4; i++) {
        v += w * noise2(p);
        p = p * 2.02 + vec2(11.3, 4.7);
        w *= 0.5;
    }
    return v;
}

/* Gel sets for this rig. Columns: three gels a designer would load together. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Congo and Amber */
        a = vec3(0.30, 0.06, 1.00);
        b = vec3(1.00, 0.56, 0.08);
        c = vec3(0.80, 0.10, 0.70);
    } else if (mode == 2) {     /* Ice */
        a = vec3(0.40, 0.80, 1.00);
        b = vec3(0.92, 0.97, 1.00);
        c = vec3(0.10, 0.34, 1.00);
    } else if (mode == 3) {     /* Sunset */
        a = vec3(1.00, 0.30, 0.06);
        b = vec3(1.00, 0.72, 0.20);
        c = vec3(0.92, 0.10, 0.36);
    } else if (mode == 4) {     /* Emerald */
        a = vec3(0.06, 1.00, 0.46);
        b = vec3(0.70, 1.00, 0.20);
        c = vec3(0.04, 0.60, 0.80);
    } else if (mode == 5) {     /* Rose Gold */
        a = vec3(1.00, 0.46, 0.56);
        b = vec3(1.00, 0.80, 0.56);
        c = vec3(0.80, 0.30, 0.74);
    } else if (mode == 6) {     /* Open White - cool, neutral, warm */
        a = vec3(0.86, 0.93, 1.00);
        b = vec3(1.00, 0.98, 0.94);
        c = vec3(1.00, 0.86, 0.66);
    } else {                    /* Arena - magenta, cyan, deep blue */
        a = vec3(1.00, 0.06, 0.62);
        b = vec3(0.04, 0.86, 1.00);
        c = vec3(0.12, 0.16, 1.00);
    }
    return mat3(a, b, c);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

/* Step smoothly round the three gels: 0 -> a, 1 -> b, 2 -> c, 3 -> a. */
vec3 cycle3(mat3 pal, float x) {
    float k = mod(x, 3.0);
    float f = smoothstep(0.35, 0.65, fract(k));
    vec3 from = k < 1.0 ? pal[0] : k < 2.0 ? pal[1] : pal[2];
    vec3 to   = k < 1.0 ? pal[1] : k < 2.0 ? pal[2] : pal[0];
    return mix(from, to, f);
}

vec3 gelFor(float i, float n, mat3 pal, int pattern, float t) {
    if (pattern == 1) return mod(i, 2.0) < 0.5 ? pal[0] : pal[1];
    if (pattern == 2) return cycle3(pal, floor(i) + 0.0);
    if (pattern == 3) return cycle3(pal, 2.0 * i / max(n - 1.0, 1.0) * 0.999);
    if (pattern == 4) return cycle3(pal, i + t * 0.6);
    if (pattern == 5) return hueRotate(vec3(1.0, 0.12, 0.10), i / n + t * 0.04);
    return pal[0];
}

/* Light from one beam at point p. `dir` is unit length. */
float beam(vec2 p, vec2 origin, vec2 dir, float w0, float spreadAngle, float hard, float reach) {
    vec2 d = p - origin;
    float along = dot(d, dir);
    if (along <= 0.0) return 0.0;
    float across = abs(d.x * dir.y - d.y * dir.x);
    float w = w0 + along * spreadAngle;
    float x = across / w;
    /* A hot core inside a flat-topped body with a firm edge. */
    float body = 1.0 - smoothstep(mix(0.15, 0.86, hard), 1.0, x);
    float core = exp(-x * x * 5.0);
    float profile = mix(core, body * 0.75 + core * 0.45, hard);
    /* Light thins as the beam widens, and the throw runs out. */
    float thin = w0 / w;
    float runout = 1.0 - smoothstep(reach * 0.55, reach, along);
    return profile * (0.35 + 0.65 * thin) * runout;
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;

    /* Idle fallbacks so the rig still moves with nothing bound. */
    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    int n = int(fixtures);
    float rigCount = float(n);
    int move = int(movement);
    int pattern = int(colorPattern);
    float t = TIME * speed;
    mat3 pal = paletteFor(int(colorMode));

    /* One haze field for the whole room. */
    vec2 hp = uv * vec2(2.2, 3.0) + vec2(TIME * hazeDrift * 0.11, -TIME * hazeDrift * 0.05);
    float wisps = smoke(hp + 0.6 * vec2(smoke(hp * 0.7 + 3.0), smoke(hp * 0.7 - 5.0)));
    float air = haze * mix(1.0, 0.25 + 1.5 * wisps, hazeTexture);

    float w0 = 0.004 + 0.045 * beamWidth;
    float cone = 0.01 + 0.22 * zoom * zoom + 0.05 * beamWidth;
    float reach = throwLength * 2.4;
    float strobeGate = strobe > 0.01 ? step(0.5, fract(TIME * (4.0 + 22.0 * strobe))) : 1.0;

    vec3 col = vec3(0.0);
    int rows = floorRow ? 2 : 1;
    for (int row = 0; row < 2; row++) {
        if (row >= rows) break;
        float side = row == 0 ? 1.0 : -1.0;
        for (int i = 0; i < MAX_FIXTURES; i++) {
            if (i >= n) break;
            float fi = float(i);
            float u = n > 1 ? fi / (rigCount - 1.0) - 0.5 : 0.0;       /* -0.5 .. 0.5 across the rig */
            vec2 origin = vec2(u * aspect * rigSpan, side * 0.5 * rigHeight);

            /* Pan angle from straight down (or straight up for the floor row). */
            float ang;
            float sw = swing * (0.75 + 0.5 * centroid);
            if (move == 0)      ang = u * 2.0 * sw * (0.55 + 0.45 * sin(t * 0.9));
            else if (move == 1) ang = sw * sin(t * 1.3) * (mod(fi, 2.0) < 0.5 ? 1.0 : -1.0);
            else if (move == 2) ang = sw * sin(t * 1.5 + fi * 0.7);
            else if (move == 3) ang = sw * (sin(t * (0.9 + 0.5 * hash11(fi + 2.0)) + fi * 2.3) * 0.7
                                           + sin(t * (1.7 + 0.6 * hash11(fi + 9.0)) + fi) * 0.4);
            else if (move == 4) {
                vec2 target = vec2(0.45 * aspect * sin(t * 0.7) * sw, -side * 0.25 * sin(t * 0.53));
                vec2 to = target - origin;
                ang = atan(to.x, -side * to.y);
            } else              ang = 0.0;
            ang += aim * 0.9 + (row == 1 ? 0.35 * sin(t * 0.8 + fi) * sw : 0.0);
            vec2 dir = vec2(sin(ang), -side * cos(ang));

            /* Dimmer: steady, or a chase running along the rig. */
            float phase = fract(TIME * chaseSpeed * 0.5 - fi / rigCount + beat * 0.12);
            float chaser = pow(1.0 - phase, 3.0);
            float dim = mix(1.0, chaser, chase) * (0.72 + 0.55 * bass) * strobeGate;

            vec3 gel = hueRotate(gelFor(fi + float(row) * 1.0, rigCount, pal, pattern, TIME * chaseSpeed), hueShift);

            float light = beam(uv, origin, dir, w0, cone, edge, reach);
            /* Prism: two more images of the beam either side of it. */
            if (prism > 0.01) {
                float split = 0.06 + 0.22 * prism;
                vec2 d1 = vec2(sin(ang + split), -side * cos(ang + split));
                vec2 d2 = vec2(sin(ang - split), -side * cos(ang - split));
                light = light * 0.6 + 0.6 * (beam(uv, origin, d1, w0, cone, edge, reach)
                                           + beam(uv, origin, d2, w0, cone, edge, reach));
            }
            col += gel * light * air * dim;

            /* The lens: a small hot face and its bloom. */
            float ld = length(uv - origin);
            float lens = (0.00035 / (ld * ld + 0.00012) + 0.010 / (ld + 0.02)) * lensGlow;
            col += mix(gel, vec3(1.0), 0.55) * lens * dim * 0.5;
        }
    }

    /* A whisper of lit haze everywhere the rig is working, so black is air and not a void. */
    col += dot(col, vec3(0.2)) * 0.06 * haze;

    col *= 1.0 + beat * 0.20;
    col *= exposure;
    col = col / (1.0 + 0.22 * col);
    col *= 1.22;

    gl_FragColor = vec4(col, 1.0);
}
