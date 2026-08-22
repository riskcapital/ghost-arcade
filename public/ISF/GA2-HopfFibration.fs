/*{
    "DESCRIPTION": "The Hopf fibration, rendered volumetrically. Every point of the 3-sphere lies on exactly one circle, and every two of those circles are linked -- no pair can be pulled apart. Projected into 3D the result is space entirely filled with interlocking rings. Each sample is inverse-projected back onto S3 and pushed through the Hopf map to find which fibre it belongs to, so the linkage emerges from the mathematics rather than from drawn geometry. A 4D rotation of the sphere before the map rolls the whole fibration through itself. Bass swells the fibres, beats turn the 4D rotation, spectral centroid walks the base sphere.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Fibre", "Ion", "Neon", "Copper", "Jade", "Sodium", "Mono"]},
        {"NAME": "fibres",    "TYPE": "float", "DEFAULT": 7.0,  "MIN": 3.00, "MAX": 16.0},
        {"NAME": "thickness", "TYPE": "float", "DEFAULT": 0.055, "MIN": 0.02, "MAX": 0.45},
        {"NAME": "density",   "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.10, "MAX": 2.00},
        {"NAME": "roll4D",    "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "orbitSpin", "TYPE": "float", "DEFAULT": 0.22, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "glow",      "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * The Hopf fibration.
 *
 * The Hopf map sends the 3-sphere to the 2-sphere, and the preimage of every
 * point of S2 is a great circle of S3. So S3 is partitioned entirely into
 * circles -- and any two of them are linked exactly once, like consecutive
 * links of a chain that cannot be separated without cutting. Stereographic
 * projection carries those circles into R3, where they remain circles (a
 * straight line for the one through the projection point), and the result is
 * three-dimensional space completely filled with interlocking rings.
 *
 * How this is drawn, which is the whole point.
 *
 * The obvious approach is to build fibre geometry: pick base points, work out
 * each projected circle's centre, radius and normal, then take a distance to
 * every one. That is dozens of operations per fibre per sample, and a
 * volumetric march needs thousands of samples per pixel.
 *
 * Run the map the other way instead. For a sample p in R3, inverse-project it
 * onto S3 and push it through the Hopf map. That yields the point of S2 whose
 * fibre passes through p -- roughly twenty operations, independent of how many
 * fibres are lit. Asking "which fibre am I on" is enormously cheaper than
 * asking "how far is the nearest fibre", and the linkage is not drawn or faked:
 * it falls out of the map, which is why the rings interlock correctly from
 * every angle without any geometry knowing about any other.
 *
 * Lighting a discrete set of fibres is then just a pattern on the base sphere.
 * A lattice in (longitude, colatitude) picks out a family of base points, each
 * of which blooms into one ring in R3.
 *
 * The 4D rotation applies to S3 before the map. That is not a rotation of the
 * projected object: it slides the fibration through itself, so rings migrate
 * across the family, swell and shrink, and turn inside out through the
 * projection point -- motion with no 3D equivalent.
 */

const float PI = 3.14159265359;
const float PI2 = 6.28318530718;
const int MAX_STEPS = 96;
const float BOUND = 2.8;

vec2 rot2(vec2 v, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

/* A 4D rotation as two independent plane turns. Applied on S3 before the Hopf
   map, so it moves the fibration rather than the projected picture. */
vec4 rot4(vec4 q, float a, float b) {
    vec2 xz = rot2(vec2(q.x, q.z), a);
    vec2 yw = rot2(vec2(q.y, q.w), b);
    return vec4(xz.x, yw.x, xz.y, yw.y);
}

/*
 * Which fibre passes through p, and how brightly it is lit.
 *
 * Inverse stereographic projection R3 -> S3, then the Hopf map S3 -> S2. The
 * returned base point identifies the fibre; density is a lattice on S2, so a
 * discrete family of rings lights up out of the continuum.
 */
float fibreAt(vec3 p, float lat, float thick, float ra, float rb, out vec3 base) {
    float r2 = dot(p, p);
    float k = 1.0 / (r2 + 1.0);
    vec4 q = vec4(2.0 * p, r2 - 1.0) * k;   /* unit 4-vector on S3 */
    q = rot4(q, ra, rb);

    /* Hopf map, reading q as the complex pair (x + iy, z + iw). */
    float a = q.x, b = q.y, c = q.z, d = q.w;
    vec3 h = vec3(
        2.0 * (a * c + b * d),
        2.0 * (b * c - a * d),
        a * a + b * b - c * c - d * d);
    base = h;

    /* Lattice of base points in (longitude, colatitude). Cells are wider near
       the equator than the poles, which shows up honestly as fibres crowding
       toward the projection axis -- that is the geometry, not an artefact. */
    float lon = atan(h.y, h.x) / PI2;
    float col = acos(clamp(h.z, -1.0, 1.0)) / PI;
    vec2 g = vec2(lon * lat, col * lat * 0.5);
    vec2 f = abs(fract(g) - 0.5);

    /* Convert the longitude offset to TRUE angular distance. Cell units are not
       distance on a sphere: meridians converge, so a fixed offset in longitude
       is a smaller real separation near the poles than at the equator. Without
       the sin(colatitude) factor the tubes swell at the equator and pinch at
       the poles, and the rings stop reading as rings. */
    float st = sin(col * PI);
    f.x *= st;

    /* Gaussian tube around each lattice point. Smooth falloff matters for a
       volumetric integral: a hard edge would alias badly at these step counts. */
    float t2 = dot(f, f);
    return exp(-t2 / max(thick * thick, 1e-4));
}

/*
 * Palettes for this shader alone -- the pack does not share a colour set.
 *
 * Colour here is not decoration laid over the form: it comes from the base
 * point, so every ring is tinted by the point of S2 it fibres over and
 * neighbouring rings are related colours by construction. These modes are ways
 * of mapping the sphere, not palettes of arbitrary hues.
 *
 * Columns: [coolEnd, warmEnd, glowTint].
 */
mat3 paletteFor(int mode) {
    vec3 a, b, g;
    if (mode == 1) {            /* Ion - electric blue through white */
        a = vec3(0.10, 0.35, 1.00);
        b = vec3(0.85, 0.95, 1.00);
        g = vec3(0.45, 0.70, 1.00);
    } else if (mode == 2) {     /* Neon - magenta and cyan, hard split */
        a = vec3(1.00, 0.10, 0.75);
        b = vec3(0.10, 0.95, 1.00);
        g = vec3(0.80, 0.40, 1.00);
    } else if (mode == 3) {     /* Copper - oxide through polished metal */
        a = vec3(0.55, 0.20, 0.08);
        b = vec3(1.00, 0.78, 0.42);
        g = vec3(1.00, 0.55, 0.25);
    } else if (mode == 4) {     /* Jade - deep green through pale stone */
        a = vec3(0.05, 0.42, 0.30);
        b = vec3(0.78, 1.00, 0.86);
        g = vec3(0.30, 0.90, 0.60);
    } else if (mode == 5) {     /* Sodium - street-lamp amber */
        a = vec3(0.70, 0.22, 0.02);
        b = vec3(1.00, 0.88, 0.45);
        g = vec3(1.00, 0.65, 0.15);
    } else if (mode == 6) {     /* Mono - the structure with no colour to help */
        a = vec3(0.55, 0.58, 0.62);
        b = vec3(1.00, 1.00, 1.00);
        g = vec3(0.85, 0.88, 0.95);
    } else {                    /* Fibre - full sphere, longitude to hue */
        a = vec3(0.00, 0.00, 0.00);   /* sentinel: mode 0 is computed, not lerped */
        b = vec3(0.00, 0.00, 0.00);
        g = vec3(0.70, 0.80, 1.00);
    }
    return mat3(a, b, g);
}

/* Colour of the fibre through a given base point. */
vec3 fibreColour(vec3 base, int mode, mat3 pal, float hue) {
    float lon = atan(base.y, base.x) / PI2 + 0.5;   /* 0..1 around the sphere */
    float col = acos(clamp(base.z, -1.0, 1.0)) / PI;
    if (mode == 0) {
        /* Longitude straight to hue: the classic reading of the fibration,
           where colour IS the base point and the linkage is legible because
           linked rings carry different hues. */
        return 0.55 + 0.45 * cos(PI2 * (lon + hue + vec3(0.00, 0.33, 0.67)));
    }
    return mix(pal[0], pal[1], clamp(col * 1.15 + 0.12 * sin(PI2 * (lon + hue)), 0.0, 1.0));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    /* Idle fallbacks so the fibration keeps rolling with nothing bound. */
    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.23));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.19));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.13));
    float beat = audioBeat;

    float lat = fibres;
    float thick = thickness * (0.85 + 0.40 * bass);

    /* 4D angles. Beats turn the second plane, which migrates rings across the
       family instead of merely brightening what is already there. */
    float ra = TIME * roll4D * 0.6;
    float rb = TIME * roll4D * 0.41 + beat * 0.5 + centroid * 0.7;

    int mode = int(colorMode);
    mat3 pal = paletteFor(mode);

    /* Orbit camera. The projected fibration is unbounded in principle, but the
       interesting structure sits near the unit sphere, so a bounding sphere
       gives a real outside to view it from. */
    float ang = TIME * orbitSpin;
    vec3 ro = vec3(sin(ang) * 5.2, 1.6 + 0.8 * sin(TIME * 0.13), cos(ang) * 5.2);
    vec3 fwd = normalize(-ro);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up = cross(fwd, right);
    vec3 rd = normalize(right * uv.x + up * uv.y + fwd * 1.45);

    /* Analytic entry/exit of the bounding sphere: rays that miss cost nothing,
       and those that hit start marching where the structure actually is
       instead of crawling in from the camera. */
    float bq = dot(ro, rd);
    float disc = bq * bq - dot(ro, ro) + BOUND * BOUND;

    vec3 acc = vec3(0.0);
    float trans = 1.0;

    if (disc > 0.0) {
        float hs = sqrt(disc);
        float tIn = max(-bq - hs, 0.0);
        float tOut = -bq + hs;
        float span = tOut - tIn;
        float dt = span / float(MAX_STEPS);

        /* Dither the entry point. A fixed start puts every ray's samples on the
           same planes and the volume renders as visible shells. */
        float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(127.1, 311.7))) * 43758.5453
                             + fract(TIME) * 7.0);
        float t = tIn + dt * jitter;

        for (int i = 0; i < MAX_STEPS; i++) {
            if (t > tOut || trans < 0.02) break;
            vec3 p = ro + rd * t;

            vec3 base;
            float dens = fibreAt(p, lat, thick, ra, rb, base) * density;

            /* Feather the density toward the bounding sphere. Fibres near the
               projection point run off to arbitrarily large radius, so cutting
               them at a hard boundary leaves their cross-sections smeared
               across the frame as soft slabs. Fading them out instead keeps the
               view to the rings that actually close inside the volume. */
            dens *= smoothstep(BOUND, BOUND * 0.52, length(p));

            if (dens > 0.001) {
                vec3 emit = fibreColour(base, mode, pal, hueShift + centroid * 0.15);
                /* Emission-absorption integral. Rings nearer the camera occlude
                   those behind, which is what makes the linkage readable rather
                   than a flat additive tangle. */
                float a = 1.0 - exp(-dens * dt * 3.5);
                /* Gain on the emission. A thin gaussian tube integrated over
                   ~96 steps deposits very little per step, so without this the
                   rings render technically correct and visually faint. */
                acc += trans * emit * a * 1.8 * (0.6 + 0.9 * level);
                trans *= 1.0 - a * 0.85;
            }
            t += dt;
        }
    }

    /* Bloom around the whole body, so thin rings still register at distance. */
    float halo = exp(-length(uv) * 1.7);
    vec3 col = acc + trans * (vec3(0.008, 0.010, 0.020) + pal[2] * halo * glow * 0.10);
    col *= 1.0 + beat * 0.25;

    col *= exposure;
    col = col / (1.0 + col);
    col = pow(max(col, 0.0), vec3(0.4545));

    gl_FragColor = vec4(col, 1.0);
}
