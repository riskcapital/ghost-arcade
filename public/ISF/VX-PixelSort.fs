/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Pixel sorting. The voice paints its own picture, and wherever a line of pixels runs brighter than the threshold it is sorted into one long gradient, so the picture pours out into thin streaks with hard ends. Every hit of the sound it follows moves the threshold or turns the sort, so new streak structures snap in, shoot out and settle back. Seed re-rolls the picture, the directions and the interval sizes; Mutate re-rolls part of that on hits.",
    "PASSES": [
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "threshold", "LABEL": "Threshold", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "runLength", "LABEL": "Run length", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "hold", "LABEL": "Hold between hits", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "direction", "LABEL": "Direction", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5], "LABELS": ["Set by seed", "Down", "Up", "Sideways", "Diagonal", "Mixed"] },
        { "NAME": "source", "LABEL": "Source", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3], "LABELS": ["Set by seed", "Shapes", "Horizon", "Bars"] },
        { "NAME": "glint", "LABEL": "Glints", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "mutate", "LABEL": "Mutate", "TYPE": "float", "DEFAULT": 0.12, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Streaks", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Accent", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last count seen, seconds since the last hit, recent activity.
// genes (1x1): picture epoch and direction epoch, bumped by Mutate on hits.
// The sort is drawn, not computed: each shape's span along a line of pixels is
// found exactly, cut where its shading crosses the threshold, and that interval
// is laid out as one sorted gradient that carries on past the shape.

const float TAU = 6.2831853;
const int MAX_SHAPES = 9;

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

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), u);
}

float recipe() {
    return floor(clamp(seed, 0.0, 1.0) * 127.0 + 0.5);
}

// ---- The picture: up to nine lit shapes ----
// geom: centre xy, half-size zw (discs and rings use z as radius).
// info: kind (0 disc, 1 ring, 2 box), level, light angle, accent flag.

// The kind of picture is fixed by the seed; Mutate only moves things within it.
float pictureKind(float ps) {
    return source == 0 ? floor(hash11(recipe() * 0.71 + 3.3) * 3.0) : float(source - 1);
}

float shapeCount(float ps) {
    float kind = pictureKind(ps);
    if (kind < 0.5) return 4.0 + floor(hash11(ps + 0.4) * 2.0);
    if (kind < 1.5) return 4.0;
    return 6.0 + floor(hash11(ps + 0.9) * 4.0);
}

vec4 shapeGeom(float i, float ps, float drift) {
    float kind = pictureKind(ps);
    float h0 = hash11(ps * 1.31 + i * 7.7);
    float h1 = hash11(ps * 2.17 + i * 3.1 + 1.0);
    float h2 = hash11(ps * 0.73 + i * 5.9 + 2.0);
    float sway = sin(drift * 0.35 + i * 1.7) * 0.015;
    if (kind < 0.5) {
        // One large form near the middle, smaller ones around it.
        if (i < 0.5) return vec4((h0 - 0.5) * 0.3 + sway, (h1 - 0.5) * 0.15 + 0.06, mix(0.17, 0.27, h2), 0.0);
        float a = TAU * (h0 + i * 0.27);
        float rr = mix(0.28, 0.5, h1);
        vec2 c = vec2(cos(a) * rr * 1.5, sin(a) * rr * 0.6 + 0.05);
        return vec4(c.x + sway, c.y, mix(0.04, 0.11, h2), mix(0.02, 0.1, h1));
    }
    if (kind < 1.5) {
        // Bands of light across the frame, and one round body sitting on them.
        if (i < 2.5) {
            float y = 0.16 - i * mix(0.1, 0.17, hash11(ps + 4.0)) + (h0 - 0.5) * 0.04;
            float hw = i < 0.5 ? 0.95 : mix(0.4, 0.8, h1);
            return vec4((h2 - 0.5) * 0.3 * i + sway, y, hw, mix(0.01, 0.04, h2 * h2) * (i < 0.5 ? 1.4 : 1.0));
        }
        return vec4((h0 - 0.5) * 0.7 + sway, 0.02 + h1 * 0.12, mix(0.1, 0.2, h2), 0.0);
    }
    // A run of parallel bars of different lengths.
    float count = shapeCount(ps);
    float vertBars = step(0.5, hash11(ps + 5.0));
    float pitch = mix(0.05, 0.085, hash11(ps + 6.0));
    float off = (i - 0.5 * (count - 1.0)) * pitch;
    float len = mix(0.08, 0.32, hash11(ps * 3.3 + i * 1.9));
    float thick = pitch * mix(0.18, 0.45, hash11(ps + 7.0));
    float lift = (hash11(ps + 8.0) - 0.5) * 0.2;
    if (vertBars > 0.5) return vec4(off + sway, lift + len * 0.5 - 0.15, thick * 0.5, len * 0.5);
    return vec4(lift + len * 0.5 - 0.2 + sway, off, len * 0.9, thick * 0.5);
}

vec4 shapeInfo(float i, float ps) {
    float kind = pictureKind(ps);
    float h3 = hash11(ps * 3.91 + i * 1.3 + 3.0);
    // One small shape may carry the accent (never the large forms or the bands).
    float hot = (kind > 0.5 && kind < 1.5) ? -1.0 : (hash11(ps * 4.1 + 0.3) < 0.55 ? floor(hash11(ps * 5.3) * shapeCount(ps)) : -1.0);
    float k;
    if (kind < 0.5) k = i < 0.5 ? (h3 < 0.55 ? 0.0 : 1.0) : (h3 < 0.5 ? 0.0 : 2.0);
    else if (kind < 1.5) k = i < 2.5 ? 2.0 : (h3 < 0.5 ? 0.0 : 1.0);
    else k = 2.0;
    float level = mix(0.6, 1.0, hash11(ps + i * 9.1));
    if (kind > 0.5 && kind < 1.5 && i < 2.5) level *= 0.85;
    float light = TAU * (0.6 + 0.25 * hash11(ps * 0.37 + i));
    // Bands ramp along their length, so the threshold cuts them part way.
    if (kind > 0.5 && kind < 1.5 && i < 2.5) light = hash11(ps + i * 2.3) < 0.5 ? 0.0 : TAU * 0.5;
    return vec4(k, level, light, (i == hot && i > 0.5) ? 1.0 : 0.0);
}

// Span of a shape along the line o + u*d, as (u0, u1); empty if u0 > u1.
// A ring's second span comes back in zw.
vec4 shapeSpan(vec4 g, float k, vec2 o, vec2 d) {
    vec2 m = o - g.xy;
    if (k < 1.5) {
        float b = dot(m, d);
        float cc = dot(m, m) - g.z * g.z;
        float disc = b * b - cc;
        if (disc <= 0.0) return vec4(1.0, -1.0, 1.0, -1.0);
        float s = sqrt(disc);
        if (k < 0.5) return vec4(-b - s, -b + s, 1.0, -1.0);
        float ri = g.z * 0.8;
        float ci = dot(m, m) - ri * ri;
        float di = b * b - ci;
        if (di <= 0.0) return vec4(-b - s, -b + s, 1.0, -1.0);
        float si = sqrt(di);
        return vec4(-b - s, -b - si, -b + si, -b + s);
    }
    vec2 lo = g.xy - g.zw;
    vec2 hi = g.xy + g.zw;
    float t0 = -1e5;
    float t1 = 1e5;
    if (abs(d.x) < 1e-4) {
        if (o.x < lo.x || o.x > hi.x) return vec4(1.0, -1.0, 1.0, -1.0);
    } else {
        float a = (lo.x - o.x) / d.x;
        float b = (hi.x - o.x) / d.x;
        t0 = max(t0, min(a, b));
        t1 = min(t1, max(a, b));
    }
    if (abs(d.y) < 1e-4) {
        if (o.y < lo.y || o.y > hi.y) return vec4(1.0, -1.0, 1.0, -1.0);
    } else {
        float a = (lo.y - o.y) / d.y;
        float b = (hi.y - o.y) / d.y;
        t0 = max(t0, min(a, b));
        t1 = min(t1, max(a, b));
    }
    return vec4(t0, t1, 1.0, -1.0);
}

// Shading at u along the line: lit from one side, linear inside the shape.
float shadeAt(vec4 g, vec4 inf, vec2 o, vec2 d, float u) {
    vec2 L = vec2(cos(inf.z), sin(inf.z));
    float r = max(max(g.z, g.w), 1e-3);
    float t = dot(o + d * u - g.xy, L) / r;
    return inf.y * clamp(0.55 + 0.45 * t, 0.12, 1.0);
}

// ---- Directions ----

vec2 dirOf(float k) {
    if (k < 0.5) return vec2(0.0, -1.0);
    if (k < 1.5) return vec2(0.0, 1.0);
    if (k < 2.5) return vec2(1.0, 0.0);
    if (k < 3.5) return vec2(-1.0, 0.0);
    if (k < 4.5) return normalize(vec2(1.0, -1.0));
    return normalize(vec2(-1.0, -1.0));
}

// Which direction a zone sorts, for this recipe and hit.
float zoneDir(float z, float ds, float n) {
    float mode = direction == 0 ? floor(hash11(ds * 0.53 + 1.7) * 5.0) : float(direction - 1);
    // Some hits turn the sort instead of moving the threshold.
    float turns = floor(hash11(ds + 2.0) * 3.0);
    float hn = hash11(n * 7.31 + ds) < 0.4 ? n : 0.0;
    float r = hash11(z * 3.7 + ds * 1.3 + hn * 0.917);
    if (mode < 0.5) return hn > 0.0 && r < 0.3 ? 1.0 : 0.0;
    if (mode < 1.5) return hn > 0.0 && r < 0.3 ? 0.0 : 1.0;
    if (mode < 2.5) return r < 0.5 ? 2.0 : 3.0;
    if (mode < 3.5) return r < 0.5 ? 4.0 : 5.0;
    return floor(r * (3.0 + turns));
}

void main() {
    float n = floor(vxCount + 0.5);
    float rs = recipe();

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.0, 1.0);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g + dt, 30.0);
        float act = max(c.b * pow(0.5, dt / 2.0), clamp(max(vxEnv, vxHit), 0.0, 1.0));
        gl_FragColor = vec4(n, age, act, 1.0);
        return;
    }

    if (PASSINDEX == 1) {
        vec4 g = IMG_NORM_PIXEL(genes, vec2(0.5));
        if (FRAMEINDEX < 2) g = vec4(0.0, 0.0, n, 1.0);
        // A new hit (the clock was just reset) may re-roll part of the recipe.
        if (FRAMEINDEX >= 2 && abs(n - g.b) > 0.5) {
            if (hash11(n * 3.71 + rs * 0.37 + 1.3) < mutate) {
                if (hash11(n * 5.13 + rs + 7.9) < 0.5) g.r = mod(g.r + 1.0, 256.0);
                else g.g = mod(g.g + 1.0, 256.0);
            }
        }
        gl_FragColor = vec4(g.r, g.g, n, 1.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    vec4 gen = IMG_NORM_PIXEL(genes, vec2(0.5));
    float ps = rs * 1.618 + gen.r * 7.31;   // picture seed
    float ds = rs * 2.414 + gen.g * 5.17;   // direction seed

    vec2 q = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float px = max(max(fwidth(q.x), fwidth(q.y)), 1e-5);
    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    // Zones: the frame in one, two or three parts, each sorting its own way.
    float zl = floor(hash11(ds * 0.77 + 9.0) * 4.0);
    float split = mix(0.38, 0.62, hash11(ds + 10.0));
    float zone = 0.0;
    if (zl > 1.5 && zl < 2.5) zone = q.x / aspect + 0.5 < split ? 0.0 : 1.0;
    if (zl > 2.5) zone = q.y + 0.5 < split ? 0.0 : 1.0;
    float dk = zoneDir(zone, ds, n);
    vec2 d = dirOf(dk);
    vec2 nrm = vec2(-d.y, d.x);

    // Fibres: lines of pixels, one to three stored pixels wide.
    float fibrePx = 1.0 + floor(hash11(rs * 0.31 + 2.0) * 2.0);
    float across = dot(q, nrm);
    float fibre = floor(across / (fibrePx * px));
    float wc = (fibre + 0.5) * fibrePx * px;
    float u = dot(q, d);
    vec2 o = nrm * wc;

    // The threshold moves with each hit; the runs shoot out and settle back.
    float hn = hash11(n * 2.31 + rs);
    float thr = clamp(threshold + (hn - 0.5) * 0.5 * step(0.5, n), 0.04, 0.95);
    float shoot = exp(-clk.g / 0.3);
    float reach = runLength * runLength * 1.2 * mix(hold, 1.0, shoot);
    // Each fibre runs its own length: coherent across neighbours, ragged at the end.
    float fh = hash11(fibre * 0.731 + rs + dk * 13.0);
    float coh = noise1(fibre * fibrePx * px * 14.0 + rs * 3.1 + dk);
    float len = reach * pow(clamp(mix(coh, fh, 0.45), 0.0, 1.0), 1.4);
    float thrF = thr + (hash11(fibre * 1.37 + n * 0.3 + rs) - 0.5) * 0.12;
    float ascending = step(0.5, hash11(rs + 12.0));
    float gam = mix(0.6, 1.8, hash11(rs + 13.0));
    float rest = mix(0.5, 1.0, clk.b);

    float runV = 0.0;
    float runCover = 0.0;
    float srcV = 0.0;
    float hotRun = 0.0;
    float hotSrc = 0.0;
    float tip = 0.0;
    float count = shapeCount(ps);
    for (int i = 0; i < MAX_SHAPES; i++) {
        float fi = float(i);
        if (fi >= count) break;
        vec4 g = shapeGeom(fi, ps, vxPhase);
        vec4 inf = shapeInfo(fi, ps);
        vec4 sp = shapeSpan(g, inf.x, o, d);
        // The picture as it is, where nothing is sorted (exact, not per fibre).
        float sd;
        if (inf.x < 0.5) sd = length(q - g.xy) - g.z;
        else if (inf.x < 1.5) sd = abs(length(q - g.xy) - g.z * 0.9) - g.z * 0.1;
        else {
            vec2 bq = abs(q - g.xy) - g.zw;
            sd = length(max(bq, 0.0)) + min(max(bq.x, bq.y), 0.0);
        }
        float sv = shadeAt(g, inf, q - d * u, d, u) * clamp(0.5 - sd / px, 0.0, 1.0);
        if (sv > srcV) {
            srcV = sv;
            hotSrc = inf.w;
        }
        for (int j = 0; j < 2; j++) {
            vec2 s2 = j == 0 ? sp.xy : sp.zw;
            if (s2.x < s2.y) {
                float va = shadeAt(g, inf, o, d, s2.x);
                float vb = shadeAt(g, inf, o, d, s2.y);
                // The interval brighter than the threshold.
                float a = s2.x;
                float b = s2.y;
                if (va < thrF && vb < thrF) {
                    a = 1.0;
                    b = -1.0;
                } else if (va < thrF) {
                    a = mix(s2.x, s2.y, (thrF - va) / max(vb - va, 1e-5));
                } else if (vb < thrF) {
                    b = mix(s2.x, s2.y, (va - thrF) / max(va - vb, 1e-5));
                }
                if (a < b) {
                    float e = b + len;
                    if (u >= a - px && u <= e + px) {
                        float t = clamp((u - a) / max(e - a, 1e-5), 0.0, 1.0);
                        float peak = max(va, vb);
                        float low = peak * mix(0.1, 0.4, fh);
                        float v = ascending > 0.5 ? mix(low, peak, pow(t, gam)) : mix(peak, low, pow(t, gam));
                        float cover = clamp((u - a) / px + 0.5, 0.0, 1.0) * clamp((e - u) / px + 0.5, 0.0, 1.0);
                        if (v * cover > runV) {
                            runV = v * cover;
                            hotRun = inf.w;
                            // A glint on the hard end of some runs.
                            tip = (e - u < 2.5 * px && fh < glint * 0.4) ? cover : 0.0;
                        }
                        runCover = max(runCover, cover);
                    }
                }
            }
        }
    }

    vec3 srcC = mix(ink.rgb, accent.rgb, hotSrc) * srcV * 0.55;
    vec3 runC = mix(ink.rgb, accent.rgb, hotRun) * runV;
    vec3 col = max(runC, srcC * (1.0 - runCover));
    col = mix(col, accent.rgb, tip);
    col *= rest;

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
