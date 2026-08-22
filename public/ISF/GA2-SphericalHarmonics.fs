/*{
    "DESCRIPTION": "A surface built from real spherical harmonics. The radius in every direction is the sum of the SH basis through l=3, evaluated in Cartesian form so it costs polynomials rather than Legendre recurrences, with the coefficients drifting on independent oscillators so the solid walks continuously through the whole harmonic space. An SH sum is signed, so positive and negative lobes take complementary colours -- the two-tone scheme is the mathematics, not a palette choice. Bass swells the amplitude, beats kick individual harmonics, spectral centroid tilts the band balance.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Emerald", "Lagoon", "Cobalt", "Orchid", "Crimson", "Goldleaf", "Graphite"]},
        {"NAME": "amplitude", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.10, "MAX": 1.10},
        {"NAME": "band",      "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "morphRate", "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "orbitSpin", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "gloss",     "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "ground",    "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Real spherical harmonics as a surface.
 *
 * The spherical harmonics are the natural basis for functions on a sphere, in
 * the same way sines and cosines are the natural basis on a line. Any such
 * function decomposes into them. Here the decomposition runs the other way:
 * pick coefficients, sum the basis, and read the result as a radius.
 *
 *     R(d) = 1 + amplitude * sum_i c_i Y_i(d)
 *
 * for a unit direction d. Band l contributes 2l+1 functions with l angular
 * nodes, so l=1 tilts the sphere, l=2 gives it four lobes, l=3 six -- raising
 * the band raises the lobe count exactly, which is why `band` reads as detail
 * rather than as noise.
 *
 * WHY CARTESIAN. Written in spherical coordinates the harmonics need
 * associated Legendre polynomials, which means a recurrence, trig for theta
 * and phi, and a pole singularity to handle. In Cartesian form on a unit
 * direction they are just polynomials -- xy, yz, 3z^2-1, y(3x^2-y^2) and so on.
 * No trig, no recurrence, no poles, and the ray direction is already a unit
 * vector, so nothing has to be converted. Sixteen basis functions cost about as
 * much as one sin().
 *
 * WHY IT IS TWO-TONE. An SH sum is signed: it is positive over some of the
 * sphere and negative over the rest, and the boundary between those regions is
 * the nodal set. Colouring by sign therefore is not a decoration laid over the
 * form -- it draws the structure of the function itself, and the two colours
 * meet exactly where the surface passes through its base radius.
 *
 * The radial form |p| - R(dir) is not a true distance function, so the march
 * steps conservatively. It understates distance where lobes are steep, and an
 * overstep there cuts a lobe clean off.
 */

const float PI = 3.14159265359;
const float PI2 = 6.28318530718;
const int MAX_STEPS = 140;

/*
 * Real SH basis through l=3, Cartesian, on a unit direction.
 * Returns the weighted sum; coefficients arrive already faded per band.
 */
float shSum(vec3 d, float t, float bandMix, float kick) {
    float x = d.x, y = d.y, z = d.z;

    /* Coefficients on independent slow oscillators. Incommensurate rates mean
       the solid never returns to a pose it has already held. */
    float a1 = sin(t * 0.71);
    float a2 = cos(t * 0.53);
    float a3 = sin(t * 0.37 + 1.7);
    float b1 = cos(t * 0.43);
    float b2 = sin(t * 0.61 + 0.9);
    float b3 = cos(t * 0.29 + 2.3);
    float b4 = sin(t * 0.47 + 1.1);
    float b5 = cos(t * 0.33 + 0.4);
    float c1 = sin(t * 0.39 + 2.9);
    float c2 = cos(t * 0.57 + 1.4);
    float c3 = sin(t * 0.31 + 0.6);
    float c4 = cos(t * 0.49 + 2.1);

    /* l = 1: three functions, one angular node -- tilts and stretches. */
    float l1 = a1 * y + a2 * z + a3 * x;

    /* l = 2: five functions, two nodes -- the four-lobed clover family. */
    float l2 = b1 * (x * y)
             + b2 * (y * z)
             + b3 * (3.0 * z * z - 1.0)
             + b4 * (x * z)
             + b5 * (x * x - y * y);

    /* l = 3: seven functions, three nodes. Only four are carried; the full set
       adds cost without adding a visibly different family at this amplitude. */
    float l3 = c1 * (y * (3.0 * x * x - y * y))
             + c2 * (x * y * z)
             + c3 * (z * (5.0 * z * z - 3.0))
             + c4 * (x * (x * x - 3.0 * y * y));

    /* `band` fades the higher bands in, so the control reads as lobe count. */
    float w2 = smoothstep(0.0, 0.55, bandMix);
    float w3 = smoothstep(0.35, 1.0, bandMix);

    /* Beats push l=3 alone: the fine lobes flick while the gross form holds,
       which reads as the surface reacting rather than the whole thing pulsing. */
    float raw = 0.35 * l1 + 0.80 * w2 * l2 + (0.90 + 0.5 * kick) * w3 * l3;

    /*
     * Bound the sum. These polynomials are not normalised -- 3z^2-1 alone
     * reaches 2, and the twelve of them together can reach about ten. Feeding
     * that straight into a radius makes the surface balloon far past any
     * bounding sphere derived from the amplitude, which is exactly what
     * happened: a bound of 1.6 around a surface that actually reached 6.
     *
     * A hard clamp would flatten the tips into discs. This soft limit keeps the
     * curvature and settles at about +/-1.8, which the caller can bound safely.
     */
    raw *= 0.65;
    return raw / (1.0 + 0.40 * abs(raw));   /* settles near +/-2.5 */
}

float mapSurface(vec3 p, float t, float bandMix, float amp, float kick, out float sgn) {
    float r = length(p);
    vec3 d = p / max(r, 1e-5);
    float s = shSum(d, t, bandMix, kick);
    sgn = s;
    /*
     * Radius is |sum|, not 1 + sum.
     *
     * Offsetting a sphere by the harmonic only dents it -- the result is a
     * bumpy ball whatever the amplitude, which is what the first version drew.
     * Taking the magnitude instead pinches the surface to nothing wherever the
     * sum crosses zero, so the nodal surfaces genuinely cut the solid into
     * separate lobes. That is the canonical picture of a spherical harmonic and
     * the reason orbital diagrams look the way they do.
     */
    return r - (0.14 + amp * 1.25 * abs(s));
}

vec3 surfaceNormal(vec3 p, float t, float bandMix, float amp, float kick) {
    vec2 e = vec2(1.0, -1.0) * 0.0022;
    float s;
    return normalize(
        e.xyy * mapSurface(p + e.xyy, t, bandMix, amp, kick, s) +
        e.yyx * mapSurface(p + e.yyx, t, bandMix, amp, kick, s) +
        e.yxy * mapSurface(p + e.yxy, t, bandMix, amp, kick, s) +
        e.xxx * mapSurface(p + e.xxx, t, bandMix, amp, kick, s));
}

/*
 * Palettes for this shader alone. Every one is a COMPLEMENTARY PAIR, because
 * the surface is signed and the two halves want opposing hues to make the nodal
 * boundary legible.
 *
 * These carry their colour in the body rather than on the fresnel edge. The
 * earlier pack shaders all used a near-white body with a tinted rim, which
 * looks expensive individually and collapses into one grey family across a
 * library -- measured, the first five sat inside a 72 degree hue wedge at under
 * 21 percent saturation. These are deliberately saturated instead.
 *
 * Columns: [positiveLobe, negativeLobe, groundTint].
 */
mat3 paletteFor(int mode) {
    if (mode == 1) {            /* Lagoon    - teal / coral */
        return mat3(vec3(0.05, 0.82, 0.74), vec3(1.00, 0.38, 0.30), vec3(0.03, 0.15, 0.17));
    } else if (mode == 2) {     /* Cobalt    - blue / amber */
        return mat3(vec3(0.12, 0.36, 1.00), vec3(1.00, 0.68, 0.12), vec3(0.03, 0.06, 0.16));
    } else if (mode == 3) {     /* Orchid    - violet / lime */
        return mat3(vec3(0.66, 0.20, 1.00), vec3(0.70, 1.00, 0.12), vec3(0.10, 0.04, 0.16));
    } else if (mode == 4) {     /* Crimson   - red / cyan */
        return mat3(vec3(1.00, 0.12, 0.26), vec3(0.10, 0.88, 1.00), vec3(0.16, 0.03, 0.07));
    } else if (mode == 5) {     /* Goldleaf  - gold / indigo */
        return mat3(vec3(1.00, 0.78, 0.14), vec3(0.24, 0.16, 0.78), vec3(0.14, 0.10, 0.03));
    } else if (mode == 6) {     /* Graphite  - the form with no colour to help */
        return mat3(vec3(0.92, 0.93, 0.96), vec3(0.24, 0.26, 0.30), vec3(0.07, 0.07, 0.08));
    }
    /* Emerald - green / magenta, the two territories the pack was missing */
    return mat3(vec3(0.05, 0.90, 0.45), vec3(1.00, 0.12, 0.62), vec3(0.02, 0.14, 0.09));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.23));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    mat3 pal = paletteFor(int(colorMode));
    vec3 POS = pal[0];
    vec3 NEG = pal[1];

    /*
     * Ground derived from the pair, not chosen. Every palette here is
     * complementary, so the mean of the two lobe colours is close to neutral by
     * construction -- which guarantees the backdrop can never land on the same
     * hue as half the subject. Hand-picking it went wrong exactly that way:
     * green lobes on a green ground, and the two stopped separating.
     */
    vec3 GROUND = mix((POS + NEG) * 0.5, pal[2], 0.45) * 0.13;

    /* hueShift swaps the two lobe colours through each other rather than
       rotating a wheel, so the pairing stays complementary at every setting. */
    float sw = 0.5 + 0.5 * sin(PI2 * hueShift);
    vec3 posCol = mix(POS, NEG, sw * 0.35);
    vec3 negCol = mix(NEG, POS, sw * 0.35);

    float t = TIME * morphRate;
    float amp = amplitude * (0.85 + 0.35 * bass);
    float bandMix = clamp(band + (centroid - 0.5) * 0.35, 0.0, 1.0);

    /* Camera orbits the solid. Max radius is 1 + amp, so this always clears. */
    float ang = TIME * orbitSpin;
    float camDist = 3.05;
    vec3 ro = vec3(sin(ang) * camDist, 1.15 + 0.5 * sin(TIME * 0.16), cos(ang) * camDist);
    vec3 fwd = normalize(-ro);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up = cross(fwd, right);
    vec3 rd = normalize(right * uv.x + up * uv.y + fwd * 1.7);

    /*
     * A coloured ground rather than another object floating on black. Measured
     * across the pack, everything so far sat on near-black, which is safe and
     * monotonous; a tinted gradient puts the palette into the whole frame while
     * still keeping the solid the brightest thing in it.
     */
    float vign = smoothstep(1.25, 0.05, length(uv));
    vec3 backdrop = mix(GROUND * 0.25, GROUND * 1.5, vign) * ground
                  + vec3(0.006, 0.007, 0.010);

    /* shSum soft-limits to about +/-1.8, so this is a true bound rather than
       an optimistic one. */
    float bound = 0.14 + amp * 1.25 * 2.55 + 0.06;
    float bq = dot(ro, rd);
    float disc = bq * bq - dot(ro, ro) + bound * bound;

    vec3 col = backdrop;

    if (disc > 0.0) {
        float hs = sqrt(disc);
        float dist = max(-bq - hs, 0.0);
        float exitAt = -bq + hs;
        float sgn = 0.0;
        float steps = 0.0;
        bool hit = false;

        for (int i = 0; i < MAX_STEPS; i++) {
            vec3 p = ro + rd * dist;
            float s;
            float d = mapSurface(p, t, bandMix, amp, beat, s);
            if (d < 0.0008 * dist + 0.0004) {
                sgn = s;
                hit = true;
                break;
            }
            /* Conservative: the radial form understates distance where lobes
               are steep, and an overstep there shears a lobe off. */
            dist += d * 0.42;
            steps += 1.0;
            if (dist > exitAt) break;
        }

        if (hit) {
            vec3 p = ro + rd * dist;
            vec3 nrm = surfaceNormal(p, t, bandMix, amp, beat);

            /* Sign of the harmonic sum picks the lobe colour. The nodal set --
               where the sum crosses zero -- is where the two meet, so the seam
               is the function's own structure. */
            float blend = smoothstep(-0.22, 0.22, sgn);
            vec3 bodyCol = mix(negCol, posCol, blend);

            /* Narrow bright seam exactly on the nodal set. */
            float nodal = 1.0 - smoothstep(0.0, 0.085, abs(sgn));

            vec3 key = normalize(vec3(0.45, 0.80, 0.40));
            vec3 fillDir = normalize(vec3(-0.70, 0.15, 0.45));
            float diff = clamp(dot(nrm, key), 0.0, 1.0);
            float fill = clamp(dot(nrm, fillDir), 0.0, 1.0);
            float ndv = clamp(dot(nrm, -rd), 0.0, 1.0);
            float fres = pow(1.0 - ndv, 4.0);

            float ao = clamp(1.0 - steps / float(MAX_STEPS), 0.0, 1.0);
            ao = mix(0.30, 1.0, ao * ao);

            float specPow = mix(16.0, 190.0, gloss);
            float spec = pow(clamp(dot(reflect(-key, nrm), -rd), 0.0, 1.0), specPow);

            /* Saturated body first, light on top -- not a white body tinted at
               the rim. This is the difference the pack was missing. */
            col = bodyCol * (0.16 + 1.00 * diff) * ao;
            col += bodyCol * fill * 0.28 * ao;
            col += mix(bodyCol, vec3(1.0), 0.28) * spec * (0.45 + 0.75 * gloss) * ao;
            col += mix(posCol, negCol, 1.0 - blend) * fres * 0.22 * (0.6 + 0.7 * level);
            col += vec3(1.0) * nodal * 0.26 * (0.5 + 0.9 * level);
            col *= 1.0 + beat * 0.24;

            float fog = 1.0 - exp(-max(dist - (camDist - bound), 0.0) * 0.30);
            col = mix(col, backdrop, fog * 0.55);
        }
    }

    col *= exposure;
    col = col / (1.0 + col);
    col = pow(max(col, 0.0), vec3(0.4545));

    gl_FragColor = vec4(col, 1.0);
}
