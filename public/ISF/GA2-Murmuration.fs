/*{
    "DESCRIPTION": "Murmurations. In 2022 a machine-learning experiment on elliptic curves turned up a pattern nobody had predicted: average a certain count over thousands of curves, plot it against the primes, and the points do not scatter. They swing together in waves, one flock for each kind of curve, mirror images of each other, like starlings turning at dusk. This is a drawing of that picture, not a computation of it: two flocks of points riding mirrored waves that die away, with the turbulence of a real flock added. Bass widens the swing, beats scatter the birds, spectral centroid moves the wave.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Dusk", "Plot", "Embers", "Deep Field", "Graphite", "Peacock", "Sodium"]},
        {"NAME": "flocks",    "TYPE": "long",  "DEFAULT": 2,
         "VALUES": [1, 2], "LABELS": ["One", "Two, mirrored"]},
        {"NAME": "density",   "TYPE": "long",  "DEFAULT": 8,
         "VALUES": [3, 5, 8, 12], "LABELS": ["Sparse", "Medium", "Dense", "Swarm"]},
        {"NAME": "columns",   "TYPE": "float", "DEFAULT": 150.0, "MIN": 30.0, "MAX": 260.0},
        {"NAME": "waves",     "TYPE": "float", "DEFAULT": 1.70, "MIN": 0.50, "MAX": 9.00},
        {"NAME": "swing",     "TYPE": "float", "DEFAULT": 0.32, "MIN": 0.00, "MAX": 0.48},
        {"NAME": "decay",     "TYPE": "float", "DEFAULT": 0.75, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "scatter",   "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.02, "MAX": 1.00},
        {"NAME": "flow",      "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "turbulence","TYPE": "float", "DEFAULT": 0.65, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "dotSize",   "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "glow",      "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "flutter",   "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "axis",      "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Thousands of points, without thousands of loop turns.
 *
 * The frame is cut into narrow columns. Every column owns a few birds, each
 * placed by a hash: near the wave for that column, with a bell-curve spread
 * above and below it. A pixel only has to look at its own column and the one
 * either side, so the cost is fixed by `density` and not by how many columns
 * the frame holds.
 *
 * The wave is a cosine in the square root of the distance along the axis,
 * so the swings stretch out as they die away, as the real plots do.
 */

const float TAU = 6.28318530718;
const int MAX_BIRDS = 12;

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

/* Palettes for this shader alone. Columns: [flock A, sky, flock B]. */
mat3 paletteFor(int mode) {
    vec3 a, sky, b;
    if (mode == 1) {            /* Plot - the blue and red of the original figures */
        a   = vec3(0.20, 0.46, 1.00);
        sky = vec3(0.016, 0.018, 0.026);
        b   = vec3(1.00, 0.22, 0.20);
    } else if (mode == 2) {     /* Embers */
        a   = vec3(1.00, 0.56, 0.10);
        sky = vec3(0.030, 0.008, 0.006);
        b   = vec3(1.00, 0.90, 0.60);
    } else if (mode == 3) {     /* Deep Field */
        a   = vec3(0.60, 0.80, 1.00);
        sky = vec3(0.004, 0.006, 0.020);
        b   = vec3(1.00, 0.70, 0.90);
    } else if (mode == 4) {     /* Graphite - dark birds on a pale sky */
        a   = vec3(0.10, 0.11, 0.13);
        sky = vec3(0.86, 0.87, 0.86);
        b   = vec3(0.42, 0.20, 0.16);
    } else if (mode == 5) {     /* Peacock */
        a   = vec3(0.06, 0.86, 0.76);
        sky = vec3(0.006, 0.022, 0.036);
        b   = vec3(0.56, 0.30, 1.00);
    } else if (mode == 6) {     /* Sodium */
        a   = vec3(1.00, 0.66, 0.16);
        sky = vec3(0.022, 0.016, 0.030);
        b   = vec3(0.40, 0.60, 1.00);
    } else {                    /* Dusk - birds against the last light */
        a   = vec3(1.00, 0.72, 0.46);
        sky = vec3(0.030, 0.020, 0.050);
        b   = vec3(0.56, 0.62, 1.00);
    }
    return mat3(a, sky, b);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

/* Height of the wave at position x (0 .. 1 along the axis). */
float wave(float x, float phase, float count, float amp, float damp) {
    float s = sqrt(max(x, 0.0));
    return amp * cos(s * count * TAU + phase) * mix(1.0, 1.0 / (1.0 + 5.0 * x), damp) * smoothstep(0.0, 0.04, x);
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;
    float xn = uv.x / aspect + 0.5;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    mat3 pal = paletteFor(int(colorMode));
    vec3 FLOCK_A = hueRotate(pal[0], hueShift);
    vec3 SKY = pal[1];
    vec3 FLOCK_B = hueRotate(pal[2], hueShift);
    bool daylight = dot(SKY, vec3(0.333)) > 0.5;

    float nCols = floor(columns);
    float colW = aspect / nCols;                   /* width of a column in frame units */
    float c0 = floor(xn * nCols);
    int birds = int(density);
    int nFlocks = int(flocks);
    float phase = TIME * flow * 0.8 + (centroid - 0.5) * 2.0;
    float amp = swing * (0.80 + 0.45 * bass);
    float spread = 0.012 + 0.11 * scatter * (1.0 + 0.8 * beat);
    float rad = colW * (0.10 + 0.34 * dotSize);
    float px = 1.0 / res.y;

    float lightA = 0.0;
    float lightB = 0.0;
    for (int dc = -1; dc <= 1; dc++) {
        float c = c0 + float(dc);
        if (c < 0.0 || c >= nCols) continue;
        float cx = (c + 0.5) / nCols;
        for (int b = 0; b < MAX_BIRDS; b++) {
            if (b >= birds) break;
            float fb = float(b);
            for (int fl = 0; fl < 2; fl++) {
                if (fl >= nFlocks) break;
                float side = fl == 0 ? 1.0 : -1.0;
                float seed = c * 13.7 + fb * 71.3 + float(fl) * 301.0;
                /* Bell-curve offset from the wave: sum of three hashes, centred. */
                float bell = (hash11(seed) + hash11(seed + 1.7) + hash11(seed + 3.1)) / 1.5 - 1.0;
                float jx = (hash11(seed + 5.3) - 0.5) * 0.9;
                float bx = cx + jx / nCols;
                /* The flock as a body: slow air moving it about. */
                float air = (noise2(vec2(bx * 5.0 - TIME * flow * 0.25, TIME * flow * 0.17 + float(fl) * 9.0)) - 0.5) * turbulence * 0.20;
                /* Each bird flutters on its own. */
                float wing = sin(TIME * (2.0 + 5.0 * hash11(seed + 9.0)) + seed) * 0.006 * flutter;
                float by = side * wave(bx, phase, waves, amp, decay) + bell * spread + air + wing;
                vec2 d = vec2((xn - bx) * aspect, uv.y - by);
                float dist = length(d);
                float core = 1.0 - smoothstep(rad - px, rad + px, dist);
                float halo = glow * 0.5 * exp(-dist * dist / (rad * rad * 10.0));
                float tw = 0.75 + 0.25 * sin(TIME * 3.0 * hash11(seed + 2.0) + seed * 3.0);
                if (fl == 0) lightA += (core + halo) * tw; else lightB += (core + halo) * tw;
            }
        }
    }

    vec3 col = SKY;
    /* A band of last light along the horizon the flocks cross. */
    if (!daylight) col += mix(FLOCK_A, FLOCK_B, 0.5) * 0.05 * exp(-uv.y * uv.y * 9.0);
    /* The axis, and the curve each flock is following, drawn faintly. */
    float axisLine = (1.0 - smoothstep(0.0, px * 1.5, abs(uv.y))) * axis * 0.5;
    float guideA = 1.0 - smoothstep(0.0, px * 1.5, abs(uv.y - wave(xn, phase, waves, amp, decay)));
    float guideB = 1.0 - smoothstep(0.0, px * 1.5, abs(uv.y + wave(xn, phase, waves, amp, decay)));
    if (daylight) {
        col = mix(col, FLOCK_A, min(lightA, 1.0));
        col = mix(col, FLOCK_B, min(lightB, 1.0));
        col = mix(col, FLOCK_A, (axisLine + guideA * axis * 0.25) * 0.5);
    } else {
        col += (FLOCK_A + FLOCK_B) * 0.5 * axisLine * 0.5;
        col += FLOCK_A * guideA * axis * 0.22 + FLOCK_B * guideB * axis * 0.22 * float(nFlocks - 1);
        col += FLOCK_A * lightA * (0.85 + 0.5 * level) + FLOCK_B * lightB * (0.85 + 0.5 * level);
    }

    col *= 1.0 + beat * 0.10;
    col *= exposure;
    if (!daylight) {
        col = col / (1.0 + 0.22 * col);
        col *= 1.22;
    }

    gl_FragColor = vec4(col, 1.0);
}
