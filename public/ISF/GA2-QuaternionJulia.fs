/*{
    "DESCRIPTION": "A quaternion Julia set: z' = z*z + c evaluated in 4D, raymarched by distance estimate. The 3D slice plane is rotated inside 4D before it cuts, so the solid reorganises in ways no rotation of a 3D object can produce, and c walks a closed 4D path so the form continuously reforms without ever repeating. Orbit trapping colours the interior. Bass drives the constant, beats spin the slice, spectral centroid steers the edge.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 3,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Nacre", "Abyss", "Verdigris", "Magma", "Porcelain", "Ultraviolet", "Solaris"]},
        {"NAME": "constant",  "TYPE": "float", "DEFAULT": 0.68, "MIN": 0.35, "MAX": 0.92},
        {"NAME": "slice4D",   "TYPE": "float", "DEFAULT": 0.00, "MIN": -1.00, "MAX": 1.00},
        {"NAME": "foldRate",  "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "orbitSpin", "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "interior",  "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "sheen",     "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Quaternion Julia sets.
 *
 * The Julia iteration z' = z*z + c is normally run on complex numbers, giving a
 * 2D picture. Run it on quaternions instead and the filled set is a solid in
 * 4D. What gets drawn here is a 3D slice of that solid.
 *
 * Two things separate this from a rotating fractal ornament:
 *
 *   1. The slice is rotated INSIDE 4D before it cuts. A 4D rotation is a pair
 *      of independent rotations in orthogonal planes -- here (x,w) and (y,z) --
 *      and turning the plane the slice is taken on makes the solid reorganise
 *      rather than merely turn. Handles fuse, cavities open, whole lobes appear
 *      from nowhere. No rotation of a 3D object can do that, which is the whole
 *      reason for going to 4D and not just raymarching another 3D fractal.
 *
 *   2. c walks a closed path on a 4D torus with incommensurate rates, so the
 *      form reforms continuously and the sequence never repeats.
 *
 * Distance estimate. The set has no analytic distance function, but the
 * Douady-Hubbard potential gives a good bound:
 *
 *     d ~ 0.25 * |z| * log|z| / |dz|
 *
 * so the march tracks the running derivative alongside z. Squaring doubles the
 * derivative, hence |dz|^2 *= 4|z|^2 each step. Working in squared magnitudes
 * throughout avoids a sqrt inside the innermost loop, which is the hottest code
 * in the shader by a wide margin.
 *
 * Orbit trapping. The closest approach of the orbit to the 4D origin is a
 * by-product of the iteration and costs one min(). It varies smoothly over the
 * surface and encodes how the point escaped, so it makes far better colour than
 * position or normal ever do -- it is the only shading term here that actually
 * knows something about the fractal.
 */

const float PI2 = 6.28318530718;
const int JULIA_ITERS = 11;
const int MAX_STEPS = 120;
const float MAX_DIST = 8.0;
/* Escape radius for the iteration is 2, so the filled set reaches |z| = 2 and
   the bounding sphere has to clear it. Anything under 2 silently shaves the
   outermost lobes off, which reads as a cropped sculpture rather than as a bug. */
const float BOUND = 2.25;

vec2 rot2(vec2 v, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

/* Hamilton product, real part in .x. */
vec4 qmul(vec4 a, vec4 b) {
    return vec4(
        a.x * b.x - dot(a.yzw, b.yzw),
        a.x * b.yzw + b.x * a.yzw + cross(a.yzw, b.yzw));
}

/*
 * A 4D rotation as two independent plane rotations. Rotating (x,w) and (y,z)
 * together is an isoclinic-style turn that has no 3D analogue: it moves the
 * slice plane through the solid instead of moving the solid past the camera.
 */
vec4 rot4(vec4 q, float a, float b) {
    vec2 xw = rot2(vec2(q.x, q.w), a);
    vec2 yz = rot2(vec2(q.y, q.z), b);
    return vec4(xw.x, yz.x, yz.y, xw.y);
}

/* Distance estimate, and the orbit trap as a side effect. */
float juliaDE(vec3 p, vec4 c, float wSlice, float ra, float rb, out float trap) {
    vec4 z = rot4(vec4(p, wSlice), ra, rb);
    float dz2 = 1.0;             /* |dz|^2, the running derivative */
    float mz2 = dot(z, z);
    trap = mz2;

    for (int i = 0; i < JULIA_ITERS; i++) {
        dz2 *= 4.0 * mz2;        /* d(z^2) = 2z dz  =>  |dz|^2 *= 4|z|^2 */
        z = qmul(z, z) + c;
        mz2 = dot(z, z);
        trap = min(trap, mz2);
        if (mz2 > 16.0) break;   /* escaped; the bound is already tight here */
    }

    /* Guard the log: an orbit that lands exactly on the origin would otherwise
       produce -inf and punch a hole through the surface. */
    return 0.25 * sqrt(mz2 / max(dz2, 1e-12)) * log(max(mz2, 1.0001));
}

/* Gradient of the estimate. Four taps, and the trap output is discarded. */
vec3 juliaNormal(vec3 p, vec4 c, float wSlice, float ra, float rb) {
    vec2 e = vec2(1.0, -1.0) * 0.0022;
    float t;
    return normalize(
        e.xyy * juliaDE(p + e.xyy, c, wSlice, ra, rb, t) +
        e.yyx * juliaDE(p + e.yyx, c, wSlice, ra, rb, t) +
        e.yxy * juliaDE(p + e.yxy, c, wSlice, ra, rb, t) +
        e.xxx * juliaDE(p + e.xxx, c, wSlice, ra, rb, t));
}

/*
 * Palettes for this shader alone. The pack deliberately does NOT share one
 * colour set: twenty shaders with the same seven presets read as one effect
 * with knobs on rather than twenty pieces.
 *
 * These are picked for a smooth sculptural solid rather than a thin-membraned
 * lattice. A surface this continuous shows a body colour honestly, so several
 * modes carry real colour in the body instead of hiding behind a white shell.
 * Magma inverts the usual arrangement -- near-black body, all the energy in the
 * accent -- which works here because the orbit trap bands the interior and
 * gives those glowing edges somewhere to live.
 *
 * Columns: [body, deep, accent].
 */
mat3 paletteFor(int mode, float t) {
    vec3 body, deep, accent;
    if (mode == 1) {            /* Abyss - deep water, bioluminescent rim */
        body   = vec3(0.30, 0.62, 0.63);
        deep   = vec3(0.010, 0.040, 0.070);
        accent = mix(vec3(0.10, 1.00, 0.72), vec3(0.35, 0.90, 1.00), t);
    } else if (mode == 2) {     /* Verdigris - aged bronze gone green */
        body   = vec3(0.72, 0.60, 0.36);
        deep   = vec3(0.045, 0.070, 0.055);
        accent = mix(vec3(0.30, 0.86, 0.66), vec3(0.90, 0.78, 0.40), t);
    } else if (mode == 3) {     /* Magma - basalt body, fissure light */
        body   = vec3(0.16, 0.13, 0.13);
        deep   = vec3(0.020, 0.010, 0.010);
        accent = mix(vec3(1.00, 0.28, 0.04), vec3(1.00, 0.85, 0.25), t);
    } else if (mode == 4) {     /* Porcelain - cream body, cool shadow */
        body   = vec3(0.97, 0.94, 0.88);
        deep   = vec3(0.090, 0.100, 0.135);
        accent = mix(vec3(0.85, 0.72, 0.45), vec3(0.70, 0.80, 0.95), t);
    } else if (mode == 5) {     /* Ultraviolet - saturated violet, white edge */
        body   = vec3(0.40, 0.20, 0.72);
        deep   = vec3(0.035, 0.010, 0.070);
        accent = mix(vec3(0.65, 0.30, 1.00), vec3(0.95, 0.90, 1.00), t);
    } else if (mode == 6) {     /* Solaris - white hot core, deep red fall-off */
        body   = vec3(1.00, 0.93, 0.72);
        deep   = vec3(0.120, 0.020, 0.010);
        accent = mix(vec3(1.00, 0.62, 0.14), vec3(1.00, 1.00, 0.92), t);
    } else {                    /* Nacre - pearlescent, iridescent rim */
        body   = vec3(0.93, 0.90, 0.92);
        deep   = vec3(0.060, 0.070, 0.110);
        accent = mix(vec3(0.45, 0.90, 0.95), vec3(1.00, 0.62, 0.82), t);
    }
    return mat3(body, deep, accent);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    /* Idle fallbacks so the form still reforms with no audio bound. */
    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.23));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.11));
    float beat = audioBeat;

    /*
     * c on a closed 4D path. The four rates are deliberately incommensurate, so
     * the path never closes on itself and the solid never returns to a pose it
     * has already held. Magnitude near 0.7 is where the set is richest: much
     * lower and it rounds off toward a ball, much higher and it shatters into
     * disconnected dust that reads as noise.
     */
    float ct = TIME * foldRate;

    /* Anchor on a constant known to sit in rich territory and wobble AROUND it,
       rather than sweeping the whole 4D sphere at fixed magnitude. Magnitude
       alone does not buy detail: direction decides whether the set is a
       filigree or a grooved ball, and most directions are the ball. Sweeping
       freely spends most of its time in the dull ones. */
    vec4 cBase = normalize(vec4(-0.450, -0.447, 0.181, 0.306));
    vec4 cWobble = vec4(
        cos(ct * 0.71),
        sin(ct * 0.53),
        cos(ct * 0.37),
        sin(ct * 0.29)) * 0.13;
    vec4 c = cBase * (constant * (0.92 + 0.14 * bass)) + cWobble;

    /* The two 4D plane angles. Beats nudge the (y,z) plane so a hit visibly
       reorganises the solid rather than just brightening it. */
    float ra = TIME * 0.13 + slice4D * 3.0;
    float rb = TIME * 0.09 + beat * 0.55 + centroid * 0.6;

    float accentT = 0.5 + 0.5 * sin(PI2 * (hueShift + centroid * 0.18 + 0.04 * sin(TIME * 0.06)));
    mat3 pal = paletteFor(int(colorMode), accentT);
    vec3 BODY = pal[0];
    vec3 DEEP = pal[1];
    vec3 ACCENT = pal[2];
    vec3 SPEC = vec3(1.00, 0.96, 0.90);

    /* Camera orbits the solid. It is bounded, so there is a real outside to
       view it from -- the opposite framing to the lattice piece. */
    float ang = TIME * orbitSpin * 0.5;
    float elev = 0.28 * sin(TIME * 0.17);
    vec3 ro = vec3(sin(ang) * 3.2, elev * 3.2, cos(ang) * 3.2);
    vec3 fwd = normalize(-ro);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up = cross(fwd, right);
    vec3 rd = normalize(right * uv.x + up * uv.y + fwd * 1.5);

    /*
     * Advance to the bounding sphere before marching. Every ray that misses the
     * solid entirely would otherwise spend its whole step budget crossing empty
     * space at DE-limited speed, and most rays in a wide shot miss.
     */
    float b = dot(ro, rd);
    float h = b * b - dot(ro, ro) + BOUND * BOUND;
    vec3 col;

    if (h < 0.0) {
        /* Missed the bounding sphere: nothing to march. */
        float g = exp(-length(uv) * 2.0);
        col = vec3(0.008, 0.010, 0.020) + ACCENT * g * 0.10;
    } else {
        float hs = sqrt(h);
        float dist = max(-b - hs, 0.0);
        float exitAt = -b + hs;

        float trap = 1e9;
        float steps = 0.0;
        bool hit = false;

        for (int i = 0; i < MAX_STEPS; i++) {
            vec3 pos = ro + rd * dist;
            float t;
            float d = juliaDE(pos, c, slice4D, ra, rb, t);
            if (d < 0.0009 * dist + 0.00035) {
                trap = t;
                hit = true;
                break;
            }
            dist += d * 0.85;
            steps += 1.0;
            if (dist > exitAt || dist > MAX_DIST) break;
        }

        if (hit) {
            vec3 pos = ro + rd * dist;
            vec3 nrm = juliaNormal(pos, c, slice4D, ra, rb);

            float diff = clamp(dot(nrm, normalize(up * 0.7 + right * 0.4 - fwd * 0.3)), 0.0, 1.0);
            float ndv = clamp(dot(nrm, -rd), 0.0, 1.0);

            /* Per-channel fresnel: colour on the silhouette, near-white body. */
            vec3 fres = vec3(
                pow(1.0 - ndv, 3.0),
                pow(1.0 - ndv, 3.6),
                pow(1.0 - ndv, 4.4));

            /* Cavity darkening from the step count, free from the loop. */
            float ao = clamp(1.0 - steps / float(MAX_STEPS), 0.0, 1.0);
            ao = mix(0.25, 1.0, ao * ao);

            /* The trap is a MINIMUM of squared magnitudes, so it is already
               small and tightly clustered on the surface. Log-compressing it as
               well crushed the whole range into the top of the ramp and the
               term did nothing visible. Take the root to get an actual distance
               and spread that instead. */
            float tp = clamp(sqrt(max(trap, 1e-9)) * 1.55, 0.0, 1.0);

            /* Sharpen the trap into bands. Smoothly ramping it just tints the
               whole solid one colour, which is indistinguishable from having no
               trap at all -- the earlier version blended blue into blue and the
               term may as well not have been there. Banding makes the escape
               structure legible as surface detail. */
            float bands = 0.5 + 0.5 * cos(PI2 * (tp * 4.5 + hueShift));
            float shaped = pow(diff, 1.55);

            /* Trap drives a three-way ramp so it can reach well away from the
               body colour: shadow -> accent -> near-white. */
            vec3 interiorCol = mix(DEEP * 1.6, ACCENT, smoothstep(0.15, 0.75, tp));
            interiorCol = mix(interiorCol, BODY, smoothstep(0.7, 1.0, tp) * 0.30);
            /* Bands GATE the interior rather than merely modulating it. With a
               0.5 floor the accent covers the whole surface and any dark-bodied
               palette gets flooded -- Magma rendered as pale gold instead of
               basalt with lit fissures. Dropping the floor lets the shadow
               survive between bands, which is what makes the glow read as
               coming from inside the solid. */
            interiorCol *= 0.10 + 1.00 * bands;

            col = mix(DEEP, BODY * 0.80, shaped) * ao;
            col = mix(col, interiorCol, interior);
            col += ACCENT * fres * (0.50 + 0.70 * sheen) * (0.55 + 0.85 * level);
            col += SPEC * pow(diff, 40.0) * 0.45 * ao;
            col *= 1.0 + beat * 0.28;

            float fog = 1.0 - exp(-max(dist - 1.9, 0.0) * 0.34);
            col = mix(col, DEEP * 0.12, fog * 0.80);
        } else {
            /* Missed the solid but crossed its neighbourhood: a faint glow that
               traces the silhouette, so the shape reads even where it is thin
               enough that no ray quite lands on it. */
            float miss = clamp(steps / float(MAX_STEPS), 0.0, 1.0);
            float g = exp(-length(uv) * 2.0);
            col = vec3(0.008, 0.010, 0.020)
                + ACCENT * g * 0.10
                + ACCENT * pow(miss, 2.0) * 0.30 * (0.5 + 0.8 * level);
        }
    }

    col *= exposure;
    col = col / (1.0 + col);
    col = pow(max(col, 0.0), vec3(0.4545));

    gl_FragColor = vec4(col, 1.0);
}
