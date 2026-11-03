/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A storm of dither patterns. The voice lights a smooth glowing form, a shaded globe with a ribbon of light sweeping behind it, and draws it only through dithering: a few levels of colour laid out by ordered Bayer grids, halftone dots, line screens and noise. Drifting weather fronts split the frame into regions, each with its own pattern, colour depth and dot size. Every hit of the sound it follows sends a shock front out across the picture that crushes the colour depth to the bone and coarsens the dots as it passes, and swaps the patterns of some regions. Dot size sets the grid; Depth how many levels the calm picture keeps; Fronts how many regions there are; Storm how much each hit changes; Shock how hard the shock front crushes.",
    "PASSES": [
        {
            "TARGET": "pic",
            "FLOAT": true,
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "genes",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "dotSize", "LABEL": "Dot size", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "depth", "LABEL": "Depth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "fronts", "LABEL": "Fronts", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "storm", "LABEL": "Storm", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "shock", "LABEL": "Shock", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.52, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Shade", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// pic (half size): r the calm picture, g the weather field.
// clock (1x1): r last count seen, g the clock (mod 32 s) at the last hit,
// b a rough count of seconds since it, so a long silence reads as long ago.
// genes (1x1): r pattern epoch, bumped on hits by Storm; b last count seen.

const float TAU = 6.2831853;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Ordered dither thresholds, 0-1.
float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x / 2.0 + a.y * a.y * 0.75);
}
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

// The threshold of dot cell c for matrix kind m.
float threshold(vec2 c, float m, float t) {
    if (m < 0.5) return bayer2(c) + 0.125;
    if (m < 1.5) return bayer4(c) + 0.03125;
    if (m < 2.5) return bayer8(c) + 0.0078;
    if (m < 3.5) {
        // Clustered halftone dots on a 45 degree screen.
        vec2 r = vec2(c.x + c.y, c.x - c.y) / 6.0;
        vec2 f = fract(r) - 0.5;
        return clamp(length(f) * 1.35, 0.0, 1.0);
    }
    if (m < 4.5) {
        // A line screen.
        return fract((c.y + floor(c.x / 5.0) * 0.0) / 4.0) * 0.94 + 0.03;
    }
    // Interleaved noise, crawling.
    return fract(52.9829189 * fract(0.06711056 * c.x + 0.00583715 * c.y + floor(t * 12.0) * 0.137));
}

// The calm picture, 0-1: a lit globe and a ribbon of light behind it.
float picture(vec2 p, float t, float rs) {
    float v = 0.0;
    // The ribbon: a soft band on a slow wave, brighter at its crest.
    float wav = sin(p.x * 2.1 + t * 0.35 + rs) * 0.16 + sin(p.x * 4.3 - t * 0.22) * 0.05;
    float yb = p.y - wav + 0.05;
    float band = exp(-yb * yb / 0.006) * (0.45 + 0.25 * sin(p.x * 3.0 + t * 0.5));
    band += exp(-pow(yb - 0.09, 2.0) / 0.0008) * 0.25;
    band *= smoothstep(1.0, 0.25, abs(p.x) / 1.0);
    v += band;
    // The globe, lit from a light that wanders.
    vec2 c = vec2(sin(t * 0.13 + rs) * 0.08, 0.02);
    float R = 0.3;
    vec2 d = (p - c) / R;
    float r2 = dot(d, d);
    float la = t * 0.31 + rs * 2.0;
    vec3 L = normalize(vec3(cos(la) * 0.9, 0.55 + 0.25 * sin(t * 0.21), 0.6));
    if (r2 < 1.0) {
        vec3 nrm = vec3(d, sqrt(1.0 - r2));
        float dif = max(dot(nrm, L), 0.0);
        float rim = pow(1.0 - nrm.z, 3.0) * 0.35;
        float spec = pow(max(dot(reflect(-L, nrm), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * 0.6;
        // Latitude bands on the globe.
        float lat = asin(clamp(nrm.y, -1.0, 1.0));
        float bands = 0.9 + 0.1 * sin(lat * 14.0 + t * 0.2);
        float g = (0.04 + 0.86 * dif * bands + rim + spec);
        v = mix(v * 0.15, g, smoothstep(1.0, 0.97, r2));
    } else {
        // A soft halo.
        v += 0.22 * exp(-(sqrt(r2) - 1.0) * 5.0);
    }
    return clamp(v, 0.0, 1.0);
}

void main() {
    float n = floor(vxCount + 0.5);
    float rs = floor(clamp(seed, 0.0, 1.0) * 127.0 + 0.5);

    float t = vxPhase;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    if (PASSINDEX == 0) {
        vec2 p0 = vec2((isf_FragNormCoord.x - 0.5) * aspect, isf_FragNormCoord.y - 0.5);
        // Weather fronts: a slow warped noise.
        float nz = fronts * 2.5 + 0.8;
        vec2 wp = p0 * nz + vec2(t * 0.07, -t * 0.04);
        wp += 0.6 * vec2(vnoise(wp * 0.7 + 3.1 + t * 0.03), vnoise(wp * 0.7 + 7.7 - t * 0.02)) - 0.3;
        gl_FragColor = vec4(picture(p0, t, rs), vnoise(wp + rs), 0.0, 1.0);
        return;
    }

    if (PASSINDEX == 1) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 0.0, 30.0, 0.0);
        bool newHit = abs(n - c.r) > 0.5;
        float stamp = newHit ? mod(TIME, 32.0) : c.g;
        float since = newHit ? 0.0 : min(c.b + dt, 30.0);
        gl_FragColor = vec4(n, stamp, since, 1.0);
        return;
    }

    if (PASSINDEX == 2) {
        vec4 g = IMG_NORM_PIXEL(genes, vec2(0.5));
        if (FRAMEINDEX < 2) g = vec4(0.0, 0.0, n, 1.0);
        if (abs(n - g.b) > 0.5 && hash11(n * 3.71 + rs * 0.37 + 1.3) < storm) g.r = mod(g.r + 1.0, 256.0);
        gl_FragColor = vec4(g.r, 0.0, n, 1.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    vec4 gen = IMG_NORM_PIXEL(genes, vec2(0.5));
    float age = mod(mod(TIME, 32.0) - clk.g + 32.0, 32.0);
    if (clk.b > 8.0) age = 30.0;
    float epoch = gen.r;
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

    // Dot grid, before any shock.
    float rows = floor(mix(270.0, 70.0, pow(clamp(dotSize, 0.0, 1.0), 0.7)));
    float cell0 = RENDERSIZE.y / rows;
    vec2 c0 = (floor(gl_FragCoord.xy / cell0) + 0.5) * cell0 / RENDERSIZE;
    // Regions: the weather field at this dot, cut into bands.
    float field = IMG_NORM_PIXEL(pic, c0).g;
    float zones = 3.0 + floor(fronts * 3.0);
    float zone = floor(field * zones * 1.4 - zones * 0.2);
    zone = clamp(zone, 0.0, zones - 1.0);
    float zs = zone * 7.13 + epoch * 3.71 + rs;

    // This region's pattern, depth, dot scale and colour ramp.
    float m = floor(hash11(zs + 0.5) * 6.0);
    float baseLv = mix(2.0, 7.0, depth);
    float lv = clamp(floor(baseLv + (hash11(zs + 1.5) - 0.5) * 3.0 + 0.5), 2.0, 8.0);
    float sc = hash11(zs + 2.5) < 0.3 ? 2.0 : 1.0;
    float ramp = floor(hash11(zs + 3.5) * 3.0);

    // The shock front: a ring from a point near the globe, crushing as it passes.
    float hs = n * 1.618 + rs;
    vec2 o = vec2((hash11(hs + 0.1) - 0.5) * 0.7, (hash11(hs + 0.2) - 0.5) * 0.4);
    float vel = mix(0.7, 1.0, clamp(vxVel, 0.0, 1.0));
    float rad = age * 2.6;
    float dist = length(p - o);
    float wave = n < 0.5 ? 0.0 : exp(-pow((dist - rad) / (0.06 + age * 0.35), 2.0)) * exp(-age * 2.5);
    // Behind the front the crush lingers a moment.
    float wake = n < 0.5 ? 0.0 : step(dist, rad) * exp(-age * 7.0);
    float crush = clamp((wave + wake * 0.7) * shock * vel * 1.4, 0.0, 1.0);
    lv = mix(lv, 2.0, step(0.35, crush));
    sc *= crush > 0.65 ? 3.0 : (crush > 0.35 ? 2.0 : 1.0);
    if (crush > 0.35) m = mod(m + 2.0 + floor(hash11(hs + 0.3) * 3.0), 6.0);

    // Dot grid.
    float cellPx = cell0 * sc;
    vec2 cid = floor(gl_FragCoord.xy / cellPx);
    vec2 cc = (cid + 0.5) * cellPx / RENDERSIZE;
    vec2 cp = vec2((cc.x - 0.5) * aspect, cc.y - 0.5);
    // The shock also shoves the picture outward a touch.
    vec2 away = normalize(cp - o + 1e-4);
    cp -= away * wave * 0.03 * shock;
    float v = IMG_NORM_PIXEL(pic, vec2(cp.x / aspect + 0.5, cp.y + 0.5)).r;

    float th = threshold(cid, m, t);
    float q = floor(v * (lv - 1.0) + th) / (lv - 1.0);
    q = clamp(q, 0.0, 1.0);

    // Colour ramp from black through the shade to the light.
    vec3 col;
    if (ramp < 0.5) col = mix(accent.rgb * q * 1.6, ink.rgb, smoothstep(0.55, 1.0, q));
    else if (ramp < 1.5) col = ink.rgb * q;
    else col = mix(accent.rgb, ink.rgb, 0.25) * q;
    col *= step(0.001, q);

    // Dots: squares with a hairline gap once they are big enough to see.
    vec2 f = fract(gl_FragCoord.xy / cellPx);
    float gap = smoothstep(4.0, 9.0, cellPx) * step(1.0 - 1.0 / cellPx * 1.2, max(f.x, f.y));
    col *= 1.0 - gap * 0.75;

    // The front's edge glows faintly in the shade colour.
    col += accent.rgb * 0.18 * wave * shock * (1.0 - q);

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
