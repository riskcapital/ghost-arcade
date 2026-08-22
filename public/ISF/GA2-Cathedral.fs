/*{
    "DESCRIPTION": "Cathedral: a flight through an endless Menger lattice, lit by shafts pouring through its square holes. The structure is generated rather than placed -- an infinite tiling whose fold angle drifts with depth, so the architecture is rebuilt continuously ahead of the camera and never repeats a room. Every volumetric sample is shadow-marched toward the source, which is what turns haze into hard-edged beams. Bass widens the aperture, beats flare the source, spectral centroid walks the light.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D Room", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Vault", "Chapel", "Reactor", "Forge", "Chlorine", "Rose", "Silver"]},
        {"NAME": "depth",     "TYPE": "float", "MIN": 1.0,  "MAX": 5.0,  "DEFAULT": 4.0},
        {"NAME": "aperture",  "TYPE": "float", "MIN": 0.3,  "MAX": 1.6,  "DEFAULT": 1.0},
        {"NAME": "beams",     "TYPE": "float", "MIN": 0.0,  "MAX": 3.0,  "DEFAULT": 1.70},
        {"NAME": "density",   "TYPE": "float", "MIN": 0.1,  "MAX": 2.0,  "DEFAULT": 1.25},
        {"NAME": "fold",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.35},
        {"NAME": "flySpeed",  "TYPE": "float", "MIN": 0.0,  "MAX": 4.0,  "DEFAULT": 1.15},
        {"NAME": "evolve",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.45},
        {"NAME": "lightWalk", "TYPE": "float", "MIN": 0.0,  "MAX": 1.5,  "DEFAULT": 0.30},
        {"NAME": "hazeHue",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.0},
        {"NAME": "hazeTint",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 1.0},
        {"NAME": "sway",      "TYPE": "float", "MIN": 0.0,  "MAX": 2.0,  "DEFAULT": 1.0},
        {"NAME": "exposure",  "TYPE": "float", "MIN": 0.2,  "MAX": 2.2,  "DEFAULT": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Cathedral.
 *
 * A Menger lattice with the light BEHIND it. That one decision is the whole
 * design: backlit, the solid can only ever be silhouette and the bright part of
 * the frame is the light coming through the holes. Contrast is structural
 * rather than something dialled in afterwards -- there is no lighting setup
 * that flattens it, because the subject is the light itself.
 *
 * WHY THE SHADOW MARCH MATTERS. Accumulating haze along the view ray with a
 * distance falloff gives an even glow, not beams. A beam exists because some
 * points in the air can see the source and their neighbours cannot -- the
 * lattice casts the shape into the air. So every volumetric sample marches a
 * second short ray toward the light and only contributes if that ray gets
 * through. The square holes of the Menger then project as hard-edged shafts,
 * and the count of those shadow steps is the single largest cost here. It is
 * also the entire effect: drop it and this is fog.
 *
 * THE LATTICE. Menger by iterated cross subtraction -- take a box, cut a square
 * shaft through each axis, scale by three, repeat. Each level triples the hole
 * count, so `depth` reads directly as how fine the tracery gets. A slow fold
 * between levels keeps it from being a static object.
 *
 * Stratified sampling with a per-pixel offset, because a volumetric march this
 * coarse bands severely otherwise, and banding across a projected beam is far
 * more visible than noise.
 */

const float PI2 = 6.28318530718;
const int MAX_LEVELS = 5;
const int MAX_STEPS = 90;
const int VOL = 56;
const int SHADOW_STEPS = 10;
const float FAR = 26.0;

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash21(vec2 p){ p = fract(p*vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x*p.y); }

/*
 * Hue rotation about the grey axis (Rodrigues). Rotating the LIGHT rather than
 * swapping palettes is what turns seven fixed haze colours into a continuous
 * wheel of them: the stone keeps its own character and only the air and the
 * beams shift, which is the part worth being able to dial on a given wall.
 */
vec3 hueRotate(vec3 c, float h){
    const vec3 k = vec3(0.5773502692);
    float a = h*PI2;
    float ca = cos(a), sa = sin(a);
    return clamp(c*ca + cross(k, c)*sa + k*dot(k, c)*(1.0 - ca), 0.0, 4.0);
}

float boxDist(vec3 p, vec3 b){
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

/*
 * Menger lattice. `ap` widens the cut shafts, which is the aperture control:
 * larger cuts leave thinner struts and let more light through.
 */
/*
 * Infinite Menger.
 *
 * IQ's construction opens with a bounding box, which is what makes it a single
 * finite sponge. Drop that and only the cross subtractions remain -- and those
 * are periodic by their own mod(), so the lattice tiles outward for ever with
 * no seam and nothing to place. That is the whole procedural generation here:
 * no cells, no instancing, no per-room decisions. The structure ahead of the
 * camera exists because the function is evaluated there.
 *
 * The fold angle drifts with DEPTH as well as time. Constant, the tiling is
 * genuinely periodic and a flight through it loops visibly every couple of
 * cells; drifting, every level is rotated by a slightly different amount at
 * each z, so the architecture is rebuilt continuously ahead and no room repeats.
 */
float menger(vec3 p, int levels, float ap, float fld){
    float d = -1e5;                       /* no bounding box: tiles for ever */
    float s = 1.0;
    for(int i = 0; i < MAX_LEVELS; i++){
        if(i >= levels) break;
        vec3 a = mod(p*s, 2.0) - 1.0;
        s *= 3.0;
        vec3 r = abs(1.0 - 3.0*abs(a))*ap;
        float da = max(r.x, r.y);
        float db = max(r.y, r.z);
        float dc = max(r.z, r.x);
        float c = (min(da, min(db, dc)) - 1.0)/s;
        d = max(d, c);
        if(fld > 0.001) p.xz *= rot(fld*0.35);
    }
    return d;
}

float mapScene(vec3 p, int levels, float ap, float fld){
    return menger(p, levels, ap, fld);
}

vec3 sceneNormal(vec3 p, int levels, float ap, float fld){
    vec2 e = vec2(1.0, -1.0)*0.0016;
    return normalize(
        e.xyy*mapScene(p + e.xyy, levels, ap, fld) +
        e.yyx*mapScene(p + e.yyx, levels, ap, fld) +
        e.yxy*mapScene(p + e.yxy, levels, ap, fld) +
        e.xxx*mapScene(p + e.xxx, levels, ap, fld));
}

/*
 * Can this point in the air see the source? Short, cheap, and binary-ish on
 * purpose: a soft answer blurs the shaft edges, and hard edges are the effect.
 */
float lightReach(vec3 p, vec3 L, int levels, float ap, float fld){
    /*
     * Binary, not soft.
     *
     * A penumbra term of the usual min(reach, k*d/t) form measures PROXIMITY to
     * the nearest surface, and in a lattice this fine every point in the air is
     * near a strut -- including points with completely clear passage to the
     * source. The result dims uniformly and the shafts vanish, which is exactly
     * how this first rendered: lit haze, no beams.
     *
     * What matters here is whether the light gets through at all. The Menger's
     * square holes then project as hard-edged shafts, which is the whole effect.
     */
    float t = 0.05;
    for(int i = 0; i < SHADOW_STEPS; i++){
        float d = menger(p + L*t, levels, ap, fld);
        if(d < 0.0025) return 0.0;
        t += max(d, 0.055);
        if(t > 6.0) break;
    }
    return 1.0;
}

/*
 * Palettes for this shader alone. Every one is a pair: what the stone is, and
 * what the light is. The stone stays dark in all of them -- it is silhouette by
 * design, and giving it a bright albedo would fight the only thing on screen
 * worth looking at.
 *
 * Columns: [stone, light, bloom].
 */
mat3 paletteFor(int mode){
    if(mode == 1){          /* Chapel   - cold stone, white daylight */
        return mat3(vec3(0.055, 0.065, 0.090), vec3(0.86, 0.93, 1.00), vec3(0.55, 0.72, 1.00));
    } else if(mode == 2){   /* Reactor  - dark metal, cyan */
        return mat3(vec3(0.030, 0.045, 0.055), vec3(0.30, 1.00, 0.98), vec3(0.10, 0.70, 0.85));
    } else if(mode == 3){   /* Forge    - black iron, orange heat */
        return mat3(vec3(0.045, 0.030, 0.025), vec3(1.00, 0.52, 0.14), vec3(1.00, 0.30, 0.06));
    } else if(mode == 4){   /* Chlorine - acid green through dark */
        return mat3(vec3(0.030, 0.050, 0.032), vec3(0.72, 1.00, 0.25), vec3(0.35, 0.90, 0.30));
    } else if(mode == 5){   /* Rose     - dusk, pink light on warm grey */
        return mat3(vec3(0.075, 0.055, 0.070), vec3(1.00, 0.62, 0.72), vec3(0.90, 0.35, 0.60));
    } else if(mode == 6){   /* Silver   - neutral, maximum contrast */
        return mat3(vec3(0.045, 0.047, 0.052), vec3(1.00, 1.00, 1.00), vec3(0.80, 0.84, 0.92));
    }
    /* Vault - warm stone, gold light */
    return mat3(vec3(0.070, 0.058, 0.045), vec3(1.00, 0.84, 0.52), vec3(1.00, 0.62, 0.24));
}

void main(){
    vec2 R = RENDERSIZE;
    vec2 uv = (gl_FragCoord.xy - 0.5*R)/min(R.x, R.y);

    float bass = max(audioBass, 0.24 + 0.10*sin(TIME*0.23));
    float level = max(audioLevel, 0.20 + 0.08*sin(TIME*0.17));
    float centroid = max(audioSpectralCentroid, 0.45 + 0.15*sin(TIME*0.12));
    float beat = audioBeat;

    mat3 pal = paletteFor(int(colorMode));
    vec3 STONE = pal[0];
    vec3 LIGHT = pal[1];
    vec3 BLOOM = pal[2];

    /* hazeHue was declared and then never referenced anywhere in the body -- a
       dead input, which is why turning it did nothing at all. It now rotates
       the light and bloom, so the haze colour is continuous rather than one
       fixed choice per palette. hazeTint fades that back toward the palette's
       own light for anyone who wants the preset as authored. */
    LIGHT = mix(LIGHT, hueRotate(LIGHT, hazeHue), hazeTint);
    BLOOM = mix(BLOOM, hueRotate(BLOOM, hazeHue), hazeTint);

    int levels = int(clamp(depth, 1.0, 5.0));
    float ap = aperture*(0.92 + 0.16*bass);
    float z = TIME*flySpeed;                  /* depth along the flight */
    float fld = fold + evolve*(0.30*sin(TIME*0.13) + 0.22*sin(z*0.045));

    /*
     * Flight down the central shaft.
     *
     * The lattice's first-level cross cuts a clear corridor along each axis
     * through every cell, so a path near x=y=0 stays in open space for ever --
     * no collision handling, no route to author. The sway is kept well inside
     * the shaft's half width; push it further and the camera clips into a wall,
     * which on an infinite structure means every frame after that is solid.
     */
    /* `sway` scales every non-forward camera motion together -- the lateral
       drift, the look-around, and the roll. At 0 the flight is dead straight and
       perfectly level, which is what a projection-mapped surface wants; the
       rocking is nice on a screen and unwelcome on geometry. */
    vec3 ro = vec3(sin(TIME*0.19)*0.16*sway, cos(TIME*0.14)*0.13*sway, z);
    vec3 fwd = normalize(vec3(sin(TIME*0.11)*0.05*sway, sin(TIME*0.09)*0.04*sway, 1.0));
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up = cross(fwd, right);
    float roll = TIME*0.05*sway;
    vec3 rr = right*cos(roll) + up*sin(roll);
    vec3 uu = up*cos(roll) - right*sin(roll);
    vec3 rd = normalize(rr*uv.x + uu*uv.y + fwd*1.30);

    /*
     * The source sits BEHIND the lattice from the camera's point of view. It
     * walks around slowly, but never in front: put it on the camera's side and
     * the whole piece collapses into an ordinary lit object.
     */
    /* Source sits ahead and off to one side, so shafts rake ACROSS the corridor
       rather than pointing down it -- a light directly ahead casts no visible
       beam, because every shaft would run parallel to the view. */
    float lw = TIME*lightWalk;
    vec3 L = normalize(vec3(sin(lw)*0.85, 0.42 + cos(lw*0.7)*0.35, 0.30));

    /* Backdrop: the source seen directly, as a soft disc with bloom. Beams have
       to come FROM something visible or they read as unmotivated streaks. */
    float toL = max(dot(rd, L), 0.0);
    vec3 col = STONE*0.14;
    col += LIGHT*pow(toL, 220.0)*3.2*(1.0 + beat*0.7);
    col += BLOOM*pow(toL, 26.0)*0.30*(0.7 + 0.6*level);

    float hitT = 1e9;
    {
        float tIn = 0.02;
        float tOut = FAR;

        /* Surface pass: the lattice as silhouette, with just enough grazing
           light on the near faces to read as stone rather than a hole. */
        float t = tIn;
        for(int i = 0; i < MAX_STEPS; i++){
            vec3 p = ro + rd*t;
            float d = mapScene(p, levels, ap, fld);
            if(d < 0.0012*t + 0.0006){ hitT = t; break; }
            t += d*0.88;
            if(t > tOut) break;
        }

        if(hitT < 1e8){
            vec3 p = ro + rd*hitT;
            vec3 n = sceneNormal(p, levels, ap, fld);
            float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
            float lit = clamp(dot(n, L), 0.0, 1.0);
            /* Backlit, so the faces turned toward the camera get almost
               nothing; the edges catch the source and that is what draws the
               tracery. */
            col = STONE*(0.14 + 0.86*lit*0.55);
            col *= exp(-hitT*0.055);   /* corridor falls away into dark */
            col += LIGHT*rim*0.40*(0.6 + 0.7*level);
        }

        /*
         * Volumetric pass. Stratified with a per-pixel offset: at 56 steps a
         * regular grid bands hard, and banding across a beam is far uglier than
         * noise.
         */
        float far = min(hitT, tOut);
        float span = max(far - tIn, 0.0);
        if(span > 0.001){
            float dt = span/float(VOL);
            float jitter = hash21(gl_FragCoord.xy + fract(TIME)*57.0);
            /*
             * Single scattering with extinction, not a running sum.
             *
             * Summing reach*dt returns a PATH LENGTH -- of order the span of
             * the ray, so several units -- and multiplying a colour by that
             * clips the frame to white immediately, which is exactly what the
             * first version did. Carrying transmittance and weighting each
             * sample by how much light still survives to it keeps the integral
             * bounded by 1 no matter how long the ray or how fine the steps.
             */
            /* Thin medium on purpose. At sigma this high the integral saturates
               to ~1 almost everywhere and every sample reads the same, which
               erases the very contrast between lit and shadowed air that makes
               a beam a beam. Optical depth across the whole lattice wants to
               stay well under one. */
            /* Far thinner than the finite version needed. That one confined the
               medium to a 2-unit cube; this corridor runs to FAR, so the same
               coefficient gives an optical depth of ~18 and every ray saturates
               to white. Scale with the distance actually being integrated. */
            float sigma = density*0.075;
            float trans = 1.0;
            float acc = 0.0;
            for(int i = 0; i < VOL; i++){
                float tv = tIn + (float(i) + jitter)*dt;
                if(tv > far || trans < 0.01) break;
                vec3 p = ro + rd*tv;
                /* Inside the lattice the medium needs no bound: most of the air
                   here is already shadowed by surrounding structure, which is
                   exactly the condition beams require. The finite version had to
                   confine it to the sponge's own cube to get the same effect. */

                /* The shadow march is the effect: without it this is fog. */
                float reach = lightReach(p, L, levels, ap, fld);
                float a = 1.0 - exp(-sigma*dt);
                if(reach > 0.001) acc += reach*a*trans;
                trans *= 1.0 - a;
            }
            acc *= (0.8 + 0.5*level);
            /* Gain set so an UNOBSTRUCTED ray lands in the low mid-tones. The
               beam is the difference between lit and shadowed air, so if a
               clear ray already reads bright there is nowhere left for the
               shadow to go and the whole thing turns to fog. */
            col += LIGHT*acc*beams*0.75;
            col += BLOOM*acc*acc*beams*0.30;
        }
    }

    col *= exposure;
    col = col/(1.0 + col);
    col = pow(max(col, 0.0), vec3(0.4545));
    col += (hash21(gl_FragCoord.xy + fract(TIME)*131.0) - 0.5)*0.010;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
