/*{
    "DESCRIPTION": "A tunnel bored through an infinite triply periodic minimal surface. The lattice morphs between gyroid, Schwarz-P and diamond topology while you fly through it, so struts fuse and channels punch open in real time. Translucency lets the ray carry on through each membrane and stack the lattice behind it. Bass thickens the struts and widens the bore, beats drive the morph, spectral centroid steers the sheen.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D Room", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Steel", "Ice", "Ember", "Chrome", "Toxic", "Orchid", "Spectrum"]},
        {"NAME": "translucency", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "cellScale",    "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.40, "MAX": 2.50},
        {"NAME": "strut",        "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.03, "MAX": 0.85},
        {"NAME": "bore",         "TYPE": "float", "DEFAULT": 1.15, "MIN": 0.45, "MAX": 2.20},
        {"NAME": "morph",        "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "flySpeed",     "TYPE": "float", "DEFAULT": 1.60, "MIN": 0.00, "MAX": 6.00},
        {"NAME": "hueShift",     "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "sheen",        "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",     "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Triply periodic minimal surfaces, bored through.
 *
 * A TPMS is an implicit surface f(p) = 0 that repeats on a lattice in all
 * three axes. Three classical ones share one trigonometric basis:
 *
 *   gyroid    sin x cos y + sin y cos z + sin z cos x
 *   Schwarz-P cos x + cos y + cos z
 *   diamond   sx sy sz + sx cy cz + cx sy cz + cx cy sz
 *
 * Every term is a component of sin(p) or cos(p). Take those ONCE per sample
 * and all three surfaces fall out for six transcendentals total, however they
 * are weighted. Blending the FIELDS rather than two rendered images means the
 * surface actually changes topology mid-morph -- struts fuse, channels punch
 * through -- which a crossfade cannot do.
 *
 * Why a bore. The void inside a TPMS is a labyrinth, so a straight camera
 * path spends most of its time embedded in material: at the origin the gyroid
 * field is exactly 0, which is to say the camera starts inside a strut.
 * Subtracting a tube around the flight line makes the distance positive
 * everywhere inside it, so the camera has open space by construction and the
 * lattice is revealed as a cut face.
 *
 * Translucency. The march does not stop at the first surface. On a hit it
 * shades, composites, then skips forward by just over one shell thickness and
 * carries on, up to MAX_LAYERS. Because these are thin membranes, what stacks
 * up behind the first one is the whole interior of the lattice, which is the
 * part an opaque render throws away. Front-to-back compositing keeps the
 * accumulation order correct without a depth sort, and transmittance is tinted
 * per layer so deep stacks take on the palette rather than washing out to grey.
 *
 * The field is not a true distance function, so the march divides |f| by an
 * approximate gradient bound and steps conservatively. Overstepping a minimal
 * surface punches shell-shaped holes that read instantly as a bug on a wall.
 */

const float PI2 = 6.28318530718;
const float MAX_DIST = 26.0;
const int MAX_STEPS = 160;
const int MAX_LAYERS = 5;

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

/* Centre line of the bore at a given depth. Also used as the camera path, so
   the two can never disagree about where the open space is. */
vec3 pathAt(float z) {
    return vec3(1.25 * sin(z * 0.145), 0.90 * cos(z * 0.118), z);
}

/* All three surfaces from one sin/cos pair. w is normalised by the caller so
   field magnitude, and therefore the distance estimate, stays stable. */
float tpmsField(vec3 q, vec3 w) {
    vec3 s = sin(q);
    vec3 c = cos(q);
    float gyroid = dot(s, c.yzx);
    float schwarz = c.x + c.y + c.z;
    float diamond = s.x * s.y * s.z
                  + s.x * c.y * c.z
                  + c.x * s.y * c.z
                  + c.x * c.y * s.z;
    return w.x * gyroid + w.y * schwarz + w.z * diamond;
}

float mapLattice(vec3 p, vec3 w, float freq, float thick) {
    float f = tpmsField(p * freq, w);
    return (abs(f) - thick) / (freq * 3.0);
}

/* Lattice minus the bore. */
float mapScene(vec3 p, vec3 w, float freq, float thick, float radius) {
    float lat = mapLattice(p, w, freq, thick);
    vec3 axis = pathAt(p.z);
    float rad = length(p.xy - axis.xy);
    return max(lat, radius - rad);
}

/* Tetrahedral gradient: 4 taps where a central difference costs 6. */
vec3 sceneNormal(vec3 p, vec3 w, float freq, float thick, float radius) {
    vec2 e = vec2(1.0, -1.0) * 0.0018;
    return normalize(
        e.xyy * mapScene(p + e.xyy, w, freq, thick, radius) +
        e.yyx * mapScene(p + e.yyx, w, freq, thick, radius) +
        e.yxy * mapScene(p + e.yxy, w, freq, thick, radius) +
        e.xxx * mapScene(p + e.xxx, w, freq, thick, radius));
}

/*
 * Palettes, returned as a mat3 whose columns are [body, deep, accent].
 *
 * `body` is the lit membrane, `deep` is shadow and the colour distance fades
 * toward, `accent` rides the fresnel edge. Most modes keep the body near white
 * and put the colour on the edges, which is what reads as a material rather
 * than as a tinted image. Spectrum is the exception, there for when a full
 * wheel is actually wanted.
 *
 * Branching on a uniform int is uniform control flow, so every lane takes the
 * same path and this costs essentially nothing.
 */
mat3 paletteFor(int mode, float t) {
    vec3 body, deep, accent;
    if (mode == 1) {            /* Ice - cold, high key, cyan edges */
        body   = vec3(0.82, 0.94, 1.00);
        deep   = vec3(0.020, 0.080, 0.190);
        accent = mix(vec3(0.28, 0.80, 1.00), vec3(0.76, 0.96, 1.00), t);
    } else if (mode == 2) {     /* Ember - hot metal over deep red shadow */
        body   = vec3(1.00, 0.74, 0.44);
        deep   = vec3(0.130, 0.025, 0.015);
        accent = mix(vec3(1.00, 0.32, 0.08), vec3(1.00, 0.82, 0.34), t);
    } else if (mode == 3) {     /* Chrome - neutral, the specular does the work */
        body   = vec3(0.88, 0.89, 0.93);
        deep   = vec3(0.035, 0.037, 0.045);
        accent = mix(vec3(0.55, 0.58, 0.64), vec3(1.00, 1.00, 1.00), t);
    } else if (mode == 4) {     /* Toxic - acid green, high contrast */
        body   = vec3(0.80, 1.00, 0.48);
        deep   = vec3(0.020, 0.090, 0.030);
        accent = mix(vec3(0.42, 1.00, 0.22), vec3(0.94, 1.00, 0.32), t);
    } else if (mode == 5) {     /* Orchid - violet body, magenta edges */
        body   = vec3(0.86, 0.78, 1.00);
        deep   = vec3(0.080, 0.020, 0.160);
        accent = mix(vec3(0.72, 0.24, 1.00), vec3(1.00, 0.44, 0.86), t);
    } else if (mode == 6) {     /* Spectrum - full wheel, deliberately */
        body   = 0.5 + 0.5 * cos(PI2 * (t + vec3(0.00, 0.33, 0.67)));
        deep   = vec3(0.030, 0.030, 0.080);
        accent = 0.5 + 0.5 * cos(PI2 * (t + 0.35 + vec3(0.00, 0.33, 0.67)));
    } else {                    /* Steel - the default */
        body   = vec3(0.74, 0.81, 0.95);
        deep   = vec3(0.030, 0.060, 0.160);
        accent = mix(vec3(0.25, 0.45, 1.00), vec3(0.45, 0.95, 1.00), t);
    }
    return mat3(body, deep, accent);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    /* Idle fallbacks: with nothing bound the lattice still has to breathe, or
       the library thumbnail and a silent room both look broken. */
    float bass = max(audioBass, 0.22 + 0.10 * sin(TIME * 0.27));
    float level = max(audioLevel, 0.18 + 0.08 * sin(TIME * 0.19));
    float centroid = max(audioSpectralCentroid, 0.42 + 0.18 * sin(TIME * 0.13));
    float beat = audioBeat;

    /* Three lobes on a phase wheel: one turn walks gyroid -> Schwarz-P ->
       diamond -> gyroid, with every intermediate a real blended surface. */
    float phase = morph + TIME * 0.035 + bass * 0.20 + beat * 0.10;
    vec3 w;
    w.x = 0.5 + 0.5 * cos(PI2 * phase);
    w.y = 0.5 + 0.5 * cos(PI2 * (phase - 0.3333));
    w.z = 0.5 + 0.5 * cos(PI2 * (phase - 0.6667));
    w /= max(w.x + w.y + w.z, 0.001);

    /* Thin membranes, many cells: a TPMS reads as precision structure when the
       walls are thin and numerous, and as melted wax when they are thick. */
    float freq = cellScale * 3.40;
    float thick = strut * (0.80 + 0.45 * bass);
    float radius = bore * (0.90 + 0.22 * bass);

    float accentT = 0.5 + 0.5 * sin(PI2 * (hueShift + centroid * 0.18 + 0.05 * sin(TIME * 0.07)));
    mat3 pal = paletteFor(int(colorMode), accentT);
    vec3 BODY = pal[0];
    vec3 DEEP = pal[1];
    vec3 ACCENT = pal[2];
    vec3 SPEC = vec3(1.00, 0.96, 0.90);

    /* Camera rides the bore axis and looks along it. */
    float z = TIME * flySpeed;
    vec3 ro = pathAt(z);
    vec3 fwd = normalize(pathAt(z + 1.2) - ro);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up = cross(fwd, right);

    /* Slow roll so the cell lattice never locks to the screen axes. */
    float roll = TIME * 0.09 + 0.30 * sin(TIME * 0.041);
    float cr = cos(roll), sr = sin(roll);
    vec3 rr = right * cr + up * sr;
    vec3 uu = up * cr - right * sr;
    vec3 rd = normalize(rr * uv.x + uu * uv.y + fwd * 1.35);
    vec3 key = normalize(fwd * 0.35 + uu * 0.75 + rr * 0.30);

    /* A shell spans 2*thick in field units; convert to world and add margin so
       a post-hit skip always clears the membrane it just shaded. Undershooting
       re-hits the same surface and the layer walk stalls in place. */
    float shellSkip = 2.9 * thick / (freq * 3.0) + 0.006;

    /* Per-pixel jitter on both the ray start and the post-hit skip. A fixed
       skip lands on the same depths across neighbouring pixels, so wherever a
       ray runs nearly parallel to a membrane the layer boundaries line up into
       concentric arcs. Dithering the offsets trades that structured banding for
       fine noise, which the eye forgives and a projector never resolves.
       Advancing the hash with TIME keeps the noise from freezing into a
       fixed-pattern screen door. */
    float jitter = hash21(gl_FragCoord.xy + fract(TIME) * 57.0);

    vec3 acc = vec3(0.0);
    float trans = 1.0;          /* remaining transmittance, front to back */
    float dist = 0.35 + jitter * 0.012;
    float steps = 0.0;
    int layers = 0;

    for (int i = 0; i < MAX_STEPS; i++) {
        if (trans < 0.02 || dist > MAX_DIST || layers >= MAX_LAYERS) break;

        vec3 pos = ro + rd * dist;
        float d = mapScene(pos, w, freq, thick, radius);

        /* Distance-proportional epsilon: far cells do not need near-field
           precision, and this is what keeps the step count survivable at 4K. */
        if (d < 0.0020 * dist + 0.0010) {
            vec3 nrm = sceneNormal(pos, w, freq, thick, radius);

            /* Rays that needed many small steps were grinding down a tight
               channel, which is where the cavities are. The counter is already
               there, so the occlusion term is free. */
            float ao = clamp(1.0 - steps / float(MAX_STEPS), 0.0, 1.0);
            ao = mix(0.20, 1.0, ao * ao);

            float diff = clamp(dot(nrm, key), 0.0, 1.0);
            float ndv = clamp(dot(nrm, -rd), 0.0, 1.0);

            /* Chromatic separation, not a rainbow. Each channel gets its own
               fresnel falloff, so colour appears where the surface turns away
               from the viewer -- an edge split, the way a real lens
               misconverges. */
            vec3 fres = vec3(
                pow(1.0 - ndv, 3.0),
                pow(1.0 - ndv, 3.6),
                pow(1.0 - ndv, 4.4));

            /* The raw field value bands the surface along its own iso-contours,
               so the shading describes the maths that built it. */
            float band = tpmsField(pos * freq, w);
            float sheenBands = 0.5 + 0.5 * sin(band * 6.0 + TIME * 0.7 + centroid * 4.0);

            /* Bias the diffuse ramp dark. A linear ramp puts most of the
               surface in the mid-tones and the lattice reads as one flat mass. */
            float shaped = pow(diff, 1.45);

            vec3 layerCol = mix(DEEP, BODY, shaped) * ao;
            layerCol += ACCENT * fres * (0.65 + 0.95 * sheen) * (0.55 + 0.85 * level);
            layerCol += BODY * sheenBands * sheen * 0.09 * ao;
            layerCol += SPEC * pow(diff, 44.0) * 0.80 * ao;
            layerCol *= 1.0 + beat * 0.30;

            /* Fade to near-black rather than to a mid-tone: haze that lands on
               a grey floor is what flattens a deep view into a backdrop. */
            float fog = 1.0 - exp(-dist * 0.115);
            layerCol = mix(layerCol, DEEP * 0.10, fog * 0.90);

            /* Glass, not fog: face-on the membrane is most transparent, at
               grazing angles it turns mirror. translucency = 0 forces alpha to
               1, the loop stops on the first layer, and the result is exactly
               the opaque render.

               The front membrane keeps most of the weight even at full
               translucency. Letting alpha fall to zero makes every layer
               contribute equally, and since each carries its own ambient the
               shadows fill in and the whole lattice flattens to one mid-tone. */
            float baseAlpha = 1.0 - translucency * 0.65;
            float alpha = clamp(mix(baseAlpha, 1.0, fres.r), 0.0, 1.0);

            acc += trans * layerCol * alpha;

            /* Beer-Lambert through the membrane, on top of the (1-alpha)
               coverage term. Coverage alone is not absorption: it says how much
               of the pixel this layer covers, not how much light the material
               eats on the way through. Without this the stack sums to roughly
               the average of five surfaces, which is exactly the flat result.
               Tinted and luma-weighted so deep stacks saturate toward the
               palette without a dark palette killing the stack outright. */
            float bodyLuma = dot(BODY, vec3(0.2126, 0.7152, 0.0722));
            float absorb = exp(-0.55 * translucency);
            trans *= (1.0 - alpha) * absorb * mix(1.0, bodyLuma, 0.35 * translucency);

            layers += 1;
            dist += shellSkip * (0.88 + 0.24 * jitter);
            continue;
        }

        dist += d * 0.72;
        steps += 1.0;
        if (dist > MAX_DIST) break;
    }

    /* Whatever transmittance is left escapes down the bore. Never pure black:
       it clips badly on a projector. */
    float glow = exp(-length(uv) * 2.2);
    vec3 voidCol = vec3(0.008, 0.010, 0.020) + ACCENT * glow * 0.14;
    vec3 col = acc + trans * voidCol;

    col *= exposure;
    col = col / (1.0 + col);                 /* Reinhard, keeps beats off the clip */
    col = pow(max(col, 0.0), vec3(0.4545));  /* linear -> display */

    gl_FragColor = vec4(col, 1.0);
}
