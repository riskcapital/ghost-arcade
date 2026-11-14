/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A fractal jewel: a Julia set cut like a gem, its curled lobes filled with nested facets that echo its own outline, ringed by a fine filigree halo. The note's pitch slowly reshapes the whole jewel, rolling its lobes into new spirals. Each hit glides the shape a step further round and swells the jewel with a bloom of light through its facets; a held sound winds the curls tighter and makes the halo burn brighter.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "morph", "LABEL": "Morph", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "facets", "LABEL": "Facets", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "halo", "LABEL": "Halo", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Jewel", "TYPE": "color", "DEFAULT": [0.35, 0.2, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Facets and halo", "TYPE": "color", "DEFAULT": [1.0, 0.75, 0.2, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const int ITER = 56;

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

vec3 hueShift(vec3 c, float a) {
    vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}


void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float px = 1.0 / RENDERSIZE.y;
    float env = clamp(vxSwell, 0.0, 1.0);
    float kick = clamp(vxPulse, 0.0, 1.0);
    // All motion runs on the flow clock, so the music speeds it and slows it.
    float t = vxFlow * 0.9;
    // Each hit glides the shape one step on; period 64 so the wrap is seamless.
    float mph = vxMorph * TAU / 64.0;

    // Frame: a slow turn; the jewel breathes with the sound and swells on hits.
    float sc = mix(0.3, 0.52, size) * (1.0 + 0.07 * kick + 0.06 * env);
    float ang = t * mix(0.0, 0.3, spin) + 0.15 * sin(t * 0.21);
    float ca = cos(ang), sa = sin(ang);
    vec2 q = mat2(ca, sa, -sa, ca) * p;
    float zpp = 1.2 / sc;              // set units per screen unit
    vec2 z = q * zpp;

    // c rides just inside the main cardioid of the Mandelbrot set, so the
    // Julia set stays one connected, solid jewel. Pitch picks where, each
    // hit glides it a step further round, and the swell and pulses push c
    // towards the edge, winding the curls tighter, then let them relax.
    float th = TAU * (0.08 + 0.6 * morph * vxGlide) + 0.35 * sin(t * 0.13) + 0.2 * sin(t * 0.05 + 1.3)
             + morph * (0.45 * sin(mph) + 0.2 * sin(mph * 2.0 + 1.0));
    float rr = 0.94 + 0.01 * env + 0.012 * kick + 0.006 * sin(t * 0.4);
    vec2 w = rr * vec2(cos(th), sin(th));
    vec2 c = 0.5 * w - 0.25 * cmul(w, w);

    vec2 dz = vec2(1.0, 0.0);
    float esc = -1.0;
    float trap = 1e3;
    for (int i = 0; i < ITER; i++) {
        dz = 2.0 * cmul(z, dz);
        z = cmul(z, z) + c;
        trap = min(trap, abs(length(z - c) - 0.25));
        if (dot(z, z) > 4096.0) { esc = float(i); break; }
    }

    // Fixed point and its multiplier, for the interior facets.
    // On this curve they are exactly w/2 and w.
    vec2 zs = 0.5 * w;
    vec2 lam = w;

    float distPx;         // distance to the jewel in pixels (0 inside)
    float mu = 0.0;
    if (esc >= 0.0) {
        float lz = length(z);
        float de = 0.5 * lz * log(lz) / max(length(dz), 1e-9);
        distPx = de / zpp / px;
        mu = esc + 1.0 - log2(log2(lz));
    } else {
        distPx = 0.0;
    }

    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;
    vec3 third = hueShift(mix(inkC, accC, 0.5), 2.1);

    // ---- Interior: Koenigs coordinates give nested copies of the outline.
    vec3 body = vec3(0.0);
    if (esc < 0.0) {
        vec2 v = z - zs;
        float lv = log(max(length(v), 1e-20)) - float(ITER) * log(max(length(lam), 1e-6));
        float av = atan(v.y, v.x) - float(ITER) * atan(lam.y, lam.x);
        float nb = mix(1.2, 4.0, facets);
        float ring = -lv * nb * 0.5 + vxMorph * 0.375 - t * 0.15;
        float nSect = floor(mix(3.0, 9.0, facets) + 0.5);
        float sect = av / TAU * nSect;
        float fr = fract(ring);
        float fs = fract(sect);
        // mod keeps the cell's colour when the angle wraps round.
        float cellId = floor(ring) * 7.0 + mod(floor(sect), nSect);
        float h = hash21(vec2(cellId, 3.1));
        // Facet lines: bright seams between cells.
        float seamR = min(fr, 1.0 - fr);
        float seamS = min(fs, 1.0 - fs);
        float seam = 1.0 - smoothstep(0.0, 0.07, min(seamR * 1.4, seamS));
        // Each facet tilts: light changes across it.
        float tilt = 0.35 + 0.65 * (0.5 + 0.5 * cos(TAU * (fs * 0.6 + h + fr * 0.4)));
        float depthT = clamp(-lv * 0.25, 0.0, 1.0);
        vec3 fc = mix(inkC, third, 0.35 * h);
        fc = mix(fc, accC, 0.3 * step(0.72, h));
        body = fc * (0.12 + 0.95 * tilt * tilt) * mix(1.0, 0.5, depthT);
        // The seams glow with the sound and bloom on each hit.
        body += accC * seam * (0.3 + 0.6 * env + 0.9 * kick);
        body *= 1.0 + 0.4 * kick + 0.15 * env;
        // Specular glint sweeps across the gem.
        float glint = pow(max(0.0, cos(atan(q.y, q.x) * 1.0 - t * 0.6)), 24.0) * 0.6;
        body += mix(accC, vec3(1.0), 0.5) * glint * tilt * 0.4;
        body += accC * 0.2 * exp(-trap * 24.0);
    }

    // ---- Coverage: crisp edge, then a filigree halo of escape bands.
    float core = 1.0 - smoothstep(0.0, 1.2, distPx);
    float rim = exp(-distPx / 2.0) * step(0.001, distPx);
    float reach = mix(10.0, 70.0, halo) * (1.0 + 0.7 * env + 0.8 * kick);
    float glow = exp(-distPx / reach);
    // Thin contour lines of the escape count: echoes of the outline.
    float fm = fract(sqrt(distPx) * 0.35 - t * 0.25);
    float lineW = 0.06 + 0.04 * env;
    float band = 1.0 - smoothstep(0.0, lineW, min(fm, 1.0 - fm));
    float haloA = glow * (0.1 + 0.85 * band) * mix(0.35, 1.0, halo) * (0.75 + 0.5 * env + 0.4 * kick);
    vec3 haloC = mix(accC, inkC, 0.4 * smoothstep(0.0, 1.0, distPx / reach)) * 1.15;

    vec4 S = vec4(0.0);
    // Halo first (behind), then the jewel on top.
    S.rgb = haloC * haloA;
    S.a = haloA;
    vec3 rimC = mix(accC, vec3(1.0), 0.45) * (1.0 + 0.9 * kick + 0.3 * env);
    vec3 jewel = esc < 0.0 ? body : rimC;
    float ja = max(core, 0.0);
    S = vec4(jewel * ja, ja) + S * (1.0 - ja);
    S.rgb += rimC * rim * 0.9;
    S.a = max(S.a, rim * 0.9);

    S.a = clamp(max(S.a, max(S.r, max(S.g, S.b))), 0.0, 1.0);
    S.rgb = min(S.rgb, vec3(S.a));

    // Background for the opaque picture: deep, tinted by the jewel.
    float vig = 1.0 - smoothstep(0.2, 1.1, length(p));
    vec3 bg = mix(inkC * 0.03, inkC * 0.12 + accC * 0.03, vig);
    bg += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;

    vec4 outc = vxClear ? S : vec4(S.rgb + max(bg, 0.0) * (1.0 - S.a), 1.0);
    gl_FragColor = outc * vxPresence;
}
