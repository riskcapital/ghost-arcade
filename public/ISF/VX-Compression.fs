/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Codec artefacts as a picture. The voice paints its own image and shows it through a block transform: every block is rebuilt from a few quantised basis patterns, cosine stripes and checkers or hard Walsh codes. The level of the sound it follows raises the quantisation, so blocks lose detail and fall to flat tones and single stripes, then sharpen again between notes; hits swap blocks with a neighbour's coefficients. Colour sits in coarser blocks, as in a subsampled codec, and block edges ring faintly. Seed re-rolls the image, the block size and the basis set; Mutate re-rolls part of that on hits.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "quality", "LABEL": "Quality", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "crush", "LABEL": "Crush with the sound", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "blockSize", "LABEL": "Block size", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3], "LABELS": ["Set by seed", "8", "16", "32"] },
        { "NAME": "swap", "LABEL": "Swap on hits", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ringing", "LABEL": "Ringing", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "chroma", "LABEL": "Colour bleed", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "source", "LABEL": "Source", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3], "LABELS": ["Set by seed", "Bodies", "Type", "Bars"] },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.14, "MIN": 0, "MAX": 1 },
        { "NAME": "mutate", "LABEL": "Mutate", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Image", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Colour", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last count seen, seconds since the last hit, recent activity.
// genes (1x1): image epoch and codec epoch, bumped by Mutate on hits.
// Each block takes a 4x4 grid of samples of the image, projects them onto
// 16 basis patterns, quantises the weights and rebuilds itself from them.

const float PI = 3.14159265;
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

float recipe() {
    return floor(clamp(seed, 0.0, 1.0) * 127.0 + 0.5);
}

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// The image: x is light (0..1), y how much of it is accent.
vec2 image(vec2 q, float kind, float is, float t) {
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float v = 0.0;
    float a = 0.0;
    if (kind < 0.5) {
        // Bodies: a large lit sphere, a ring and a small accent moon.
        vec2 c = vec2((hash11(is + 1.0) - 0.5) * 0.4 + sin(t * 0.2) * 0.03, (hash11(is + 2.0) - 0.5) * 0.15);
        float r = mix(0.28, 0.4, hash11(is + 3.0));
        vec2 L = normalize(vec2(hash11(is + 4.0) - 0.5, 0.6));
        vec2 p = q - c;
        float lit = clamp(0.3 + 0.7 * dot(p / r, L), 0.0, 1.0);
        v = step(length(p), r) * (0.12 + 0.88 * lit * lit);
        float rr = r * mix(1.15, 1.35, hash11(is + 5.0));
        v = max(v, step(abs(length(p) - rr), 0.012) * 0.7);
        vec2 mc = c + vec2(cos(t * 0.1 + is), sin(t * 0.1 + is)) * rr;
        float moon = step(length(q - mc), mix(0.04, 0.07, hash11(is + 6.0)));
        v = max(v, moon * 0.9);
        a = moon;
    } else if (kind < 1.5) {
        // Type: a block of ragged lines, a heavy heading and one accent word.
        float lineH = mix(0.045, 0.075, hash11(is + 7.0));
        float lines = 5.0 + floor(hash11(is + 8.0) * 4.0);
        float width = mix(0.9, 1.4, hash11(is + 9.0));
        vec2 org = vec2(-0.45 * width, 0.5 * lines * lineH);
        float row = floor((org.y - q.y) / lineH);
        float fy = (org.y - q.y) / lineH - row;
        if (row >= 0.0 && row < lines) {
            float heading = row < 0.5 ? 1.0 : 0.0;
            float cellW = lineH * 0.45 * (1.0 + heading);
            float x = q.x - org.x;
            float cell = floor(x / cellW);
            float lineLen = width * (heading > 0.5 ? 0.6 : mix(0.5, 1.0, hash11(row * 3.1 + is)));
            float gap = hash21(vec2(cell, row + is)) < 0.2 ? 1.0 : 0.0;
            float on = (x >= 0.0 && x < lineLen && gap < 0.5 && fy > 0.15 && fy < (heading > 0.5 ? 0.85 : 0.6)) ? 1.0 : 0.0;
            float word = floor(cell / 5.0);
            v = on * mix(0.45, 1.0, hash21(vec2(word, row + is)));
            a = (row == 2.0 + floor(hash11(is) * (lines - 2.0)) && hash21(vec2(word, is)) < 0.35) ? on : 0.0;
        }
    } else {
        // Bars: a block of horizontal ramps of different lengths, one in accent.
        float rows = 6.0 + floor(hash11(is + 10.0) * 6.0);
        float h = 0.6 / rows;
        float k = floor((q.y + 0.3) / h);
        float fy = (q.y + 0.3) / h - k;
        if (k >= 0.0 && k < rows) {
            float len = mix(0.4, 1.5, hash11(k * 1.7 + is));
            float x = q.x + aspect * 0.4;
            float on = (x >= 0.0 && x < len && fy > 0.18 && fy < 0.82) ? 1.0 : 0.0;
            v = on * mix(0.2, 1.0, x / len);
            a = (k == floor(hash11(is + 11.0) * rows)) ? on : 0.0;
        }
        // A thin circle laid over the bars.
        vec2 c = vec2((hash11(is + 12.0) - 0.5) * 0.6, 0.0);
        v = max(v, step(abs(length(q - c) - 0.22), 0.006) * 0.8);
    }
    return vec2(v, a);
}

// Basis pattern u at position x (0..1 across the block).
float basis(float u, float x, float set) {
    float c = cos(PI * u * x);
    if (set > 0.5 && set < 1.5) return u < 0.5 ? 1.0 : sign(c);
    return c;
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
        if (FRAMEINDEX >= 2 && abs(n - g.b) > 0.5 && hash11(n * 3.71 + rs * 0.37 + 1.3) < mutate) {
            if (hash11(n * 5.13 + rs + 7.9) < 0.5) g.r = mod(g.r + 1.0, 256.0);
            else g.g = mod(g.g + 1.0, 256.0);
        }
        gl_FragColor = vec4(g.r, g.g, n, 1.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    vec4 gen = IMG_NORM_PIXEL(genes, vec2(0.5));
    float is = rs * 1.618 + gen.r * 7.31;    // image seed
    float cs = rs * 2.414 + gen.g * 5.17;    // codec seed

    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.5));
    float stored = max(fw.x, fw.y);
    float sizeK = blockSize == 0 ? floor(pow(hash11(cs + 0.3), 1.6) * 3.0) : float(blockSize - 1);
    float B = 8.0 * pow(2.0, sizeK) * stored;   // block edge, virtual pixels
    float set = floor(hash11(cs + 1.7) * 3.0);
    float kind = source == 0 ? mod(rs + floor(hash11(rs * 0.53 + 2.9) * 2.0), 3.0) : float(source - 1);
    float t = vxPhase;

    // Snap the grid so the frame's middle falls on a block corner.
    vec2 origin = 0.5 * RENDERSIZE - floor(0.5 * RENDERSIZE / B) * B;
    vec2 cell = floor((gl_FragCoord.xy - origin) / B);
    vec2 local = (gl_FragCoord.xy - origin) / B - cell;

    // A hit swaps some blocks with a neighbour's coefficients, which
    // drift back one by one as the hit ages.
    float hn = hash21(cell + vec2(n * 1.37, cs));
    float swapOn = (n > 0.5 && hn < swap * 0.45 * exp(-clk.g / 0.35)) ? 1.0 : 0.0;
    vec2 srcCell = cell;
    float transpose = 0.0;
    if (swapOn > 0.5) {
        float dir = floor(hash21(cell + vec2(n, 3.0)) * 4.0);
        vec2 dv = dir < 0.5 ? vec2(1.0, 0.0) : (dir < 1.5 ? vec2(-1.0, 0.0) : (dir < 2.5 ? vec2(0.0, 1.0) : vec2(0.0, -1.0)));
        float far = hash21(cell + vec2(n, 9.0)) < 0.3 ? 1.0 + floor(hash21(cell + vec2(n, 4.0)) * 6.0) : 1.0;
        srcCell = cell + dv * far;
        transpose = hash21(cell + vec2(n, 5.0)) < 0.3 ? 1.0 : 0.0;
    }

    // Sample the image on a 4x4 grid inside the source block.
    float s[16];
    float chromaSum = 0.0;
    for (int j = 0; j < 4; j++) {
        for (int i = 0; i < 4; i++) {
            vec2 sp = origin + (srcCell + (vec2(float(i), float(j)) + 0.5) / 4.0) * B;
            vec2 q = (sp - 0.5 * RENDERSIZE) / RENDERSIZE.y;
            vec2 im = image(q, kind, is, t);
            s[j * 4 + i] = im.x;
        }
    }
    // Colour from coarser blocks: four samples across a double block.
    vec2 ccell = floor(cell / 2.0);
    for (int k = 0; k < 4; k++) {
        vec2 o = vec2(mod(float(k), 2.0), floor(float(k) / 2.0)) + 0.5;
        vec2 sp = origin + (ccell * 2.0 + o) * B;
        vec2 q = (sp - 0.5 * RENDERSIZE) / RENDERSIZE.y;
        chromaSum += image(q, kind, is, t).y;
    }
    float chromaV = chromaSum * 0.25;

    // Quantiser: quality sets the step, the sound's level coarsens it.
    float env = clamp(vxEnv, 0.0, 1.0);
    float qStep = mix(0.3, 0.012, quality) * (1.0 + crush * 3.5 * env);
    float tilt = mix(0.8, 2.2, hash11(cs + 2.3));

    // Project, quantise and rebuild.
    vec2 lp = transpose > 0.5 ? local.yx : local;
    float rec = 0.0;
    float acEnergy = 0.0;
    for (int v = 0; v < 4; v++) {
        for (int u = 0; u < 4; u++) {
            float fu = float(u);
            float fv = float(v);
            float sum = 0.0;
            float norm = 0.0;
            for (int j = 0; j < 4; j++) {
                for (int i = 0; i < 4; i++) {
                    float b = basis(fu, (float(i) + 0.5) / 4.0, set) * basis(fv, (float(j) + 0.5) / 4.0, set);
                    sum += s[j * 4 + i] * b;
                    norm += b * b;
                }
            }
            float coef = sum / max(norm, 1e-4);
            float qs = qStep * (1.0 + (fu + fv) * tilt * 0.25);
            if (u == 0 && v == 0) qs *= 0.5;
            float cq = floor(coef / qs + 0.5) * qs;
            rec += cq * basis(fu, lp.x, set) * basis(fv, lp.y, set);
            if (u + v > 0) acEnergy += abs(cq);
        }
    }
    // A posterised set: the rebuilt block falls into three tones.
    if (set > 1.5) rec = floor(clamp(rec, 0.0, 1.0) * 3.0 + 0.5) / 3.0;
    float lum = clamp(rec, 0.0, 1.0);

    // Faint ringing just inside block edges that carry detail.
    vec2 edgePx = min(local, 1.0 - local) * B / fw;
    float nearEdge = min(edgePx.x, edgePx.y);
    float ringV = ringing * clamp(acEnergy * 1.5, 0.0, 1.0) * 0.22 * clamp(1.0 - nearEdge / 3.0, 0.0, 1.0)
                * (0.5 + 0.5 * cos(nearEdge * PI));
    lum = max(lum, ringV);

    float rest = mix(0.55, 1.0, clk.b);
    vec3 col = ink.rgb * lum;
    col = mix(col, accent.rgb * min(lum * 1.4, 1.0), clamp(chromaV * chroma * 1.6, 0.0, 1.0));
    col *= rest;

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
