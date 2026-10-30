/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A picture with its keyframes dropped. The voice paints its own shapes, gradients or stripes; every hit of the sound it follows freezes a set of macroblocks, which then drag their stale pixels along their own motion vectors, so the picture melts and streaks in blocks while the sound plays and holds still between hits. On each bar line part of the frame gets a fresh keyframe. Seed re-rolls the whole recipe; Mutate re-rolls the motion vectors on hits.",
    "PASSES": [
        {
            "TARGET": "pic",
            "PERSISTENT": true,
            "FLOAT": true
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "blockSize", "LABEL": "Block size", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "smear", "LABEL": "Smear", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Blocks per hit", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "reset", "LABEL": "Reset each bar", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "source", "LABEL": "Source", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4], "LABELS": ["Set by seed", "Shapes", "Gradients", "Stripes", "Type"] },
        { "NAME": "vectors", "LABEL": "Show vectors", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.31, "MIN": 0, "MAX": 1 },
        { "NAME": "mutate", "LABEL": "Mutate", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Picture", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Accent", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// pic: rgb is the picture, a is 1 where its macroblock is moshing.
// clock (1x1): last count seen, smear step remainder, last bar seen.
// genes (1x1): vector epoch and layout epoch, bumped by Mutate on hits.
// The picture pass runs first and reads last frame's clock and genes, so it
// sees each new hit and bar exactly once; the next two passes store the result.

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

// 128 recipes across the Seed knob.
float recipe() {
    return floor(clamp(seed, 0.0, 1.0) * 127.0 + 0.5);
}

float countNow() {
    return floor(vxCount + 0.5);
}

// Smear steps per second: the sound's level drives the melt, so it surges on
// each hit and stops between hits.
float stepRate() {
    float e = clamp(vxEnv, 0.0, 1.0);
    return smear * 420.0 * e * (0.4 + 0.6 * e);
}

// The genes this frame: last frame's plus any bump from a new hit.
vec2 genesNow(vec4 g, vec4 clk) {
    float n = countNow();
    bool newHit = FRAMEINDEX >= 2 && abs(n - clk.r) > 0.5;
    float ev = g.r;
    float el = g.g;
    if (newHit) {
        if (hash11(n * 3.71 + recipe() * 0.37 + 1.3) < mutate) ev = mod(ev + 1.0, 256.0);
        if (hash11(n * 5.13 + recipe() * 0.71 + 7.9) < mutate * 0.3) el = mod(el + 1.0, 256.0);
    }
    if (FRAMEINDEX < 2) {
        ev = 0.0;
        el = 0.0;
    }
    return vec2(ev, el);
}

// ---- Macroblocks ----

// Block layout seed: the recipe, plus the layout epoch.
float layoutSeed(float el) {
    return recipe() * 1.618 + el * 7.31;
}

// The macroblock under px (virtual pixels): xy origin, zw size.
vec4 blockAt(vec2 px, float ls) {
    float scale = mix(0.03, 0.16, blockSize) * (0.7 + 0.6 * hash11(ls + 2.1));
    float base = max(RENDERSIZE.y * scale, 4.0);
    float shape = floor(hash11(ls * 1.3 + 4.7) * 5.0);
    vec2 cellSize = vec2(base);
    if (shape > 3.5) cellSize = vec2(base * 2.0, base);
    if (shape > 2.5 && shape < 3.5) cellSize = vec2(base, base * 2.0);
    // Some recipes split blocks into quarters, like a codec's partitions.
    float splitChance = hash11(ls * 2.9 + 1.1);
    splitChance = splitChance < 0.35 ? 0.0 : splitChance * 0.7;
    vec2 org = floor(px / cellSize) * cellSize;
    vec2 size = cellSize;
    for (int i = 0; i < 2; i++) {
        float h = hash21(org / size + vec2(ls * 0.37 + float(i) * 17.1, 3.3));
        if (h < splitChance) {
            size *= 0.5;
            org += floor((px - org) / size) * size;
        }
    }
    return vec4(org, size);
}

// A block's motion vector, in whole stored pixels per smear step.
vec2 blockVector(vec4 blk, float ev, float el) {
    float rs = recipe();
    float vs = rs * 2.17 + ev * 13.7;
    vec2 c = (blk.xy + 0.5 * blk.zw) / RENDERSIZE.y;
    vec2 mid = 0.5 * RENDERSIZE / RENDERSIZE.y;
    vec2 id = blk.xy / max(blk.zw, vec2(1.0));
    float family = floor(hash11(rs * 0.913 + el * 3.3 + 0.7) * 6.0);
    float jitter = hash21(id + vs);
    vec2 focus = mid + (vec2(hash11(vs + 1.0), hash11(vs + 2.0)) - 0.5) * vec2(1.2, 0.7);
    vec2 v;
    if (family < 0.5) {
        // One pan across the frame.
        float a = floor(hash11(vs + 3.0) * 8.0) * TAU / 8.0;
        v = vec2(cos(a), sin(a)) * (1.0 + 0.5 * jitter);
    } else if (family < 1.5) {
        // Bursting out of a point (or falling into it).
        vec2 d = c - focus;
        v = d / max(length(d), 0.01) * (hash11(vs + 4.0) < 0.7 ? 1.0 : -1.0) * (0.8 + 0.8 * jitter);
    } else if (family < 2.5) {
        // Turning around a point.
        vec2 d = c - focus;
        v = vec2(-d.y, d.x) / max(length(d), 0.01) * (hash11(vs + 5.0) < 0.5 ? 1.0 : -1.0) * (1.0 + jitter);
    } else if (family < 3.5) {
        // Rows of blocks sliding against each other.
        float row = floor(blk.y / max(blk.w, 1.0));
        float dir = hash11(row * 1.37 + vs) < 0.5 ? -1.0 : 1.0;
        v = hash11(vs + 6.0) < 0.6 ? vec2(dir * (1.0 + 2.0 * hash11(row + vs)), 0.0)
                                    : vec2(0.0, dir * (1.0 + 2.0 * hash11(row + vs)));
    } else if (family < 4.5) {
        // Every block its own way, in one of four directions.
        float a = floor(jitter * 4.0) * TAU / 4.0 + floor(hash11(vs + 7.0) * 2.0) * TAU / 8.0;
        v = vec2(cos(a), sin(a)) * (1.0 + floor(hash21(id + vs + 3.0) * 2.5));
    } else {
        // A slow current: the angle wanders across the frame.
        float a = TAU * (hash11(vs + 8.0) + 0.35 * sin(c.x * 3.1 + vs) + 0.35 * cos(c.y * 2.7 - vs));
        v = vec2(cos(a), sin(a)) * (1.2 + jitter);
    }
    return floor(v + 0.5);
}

// Does hit m set this block moshing?
bool moshPick(vec4 blk, float m, float el, float carry) {
    float rs = recipe();
    float mode = floor(hash11(rs * 1.77 + el * 5.1 + 3.9) * 4.0);
    // Blocks carrying picture are likelier to go, as moving parts would.
    float p = spread * mix(0.6, 1.0, clamp(vxVel, 0.0, 1.0)) * (0.15 + 0.9 * carry);
    vec2 c = (blk.xy + 0.5 * blk.zw) / RENDERSIZE.y;
    vec2 mid = 0.5 * RENDERSIZE / RENDERSIZE.y;
    float hm = m * 1.913 + rs * 0.31;
    if (mode < 0.5) {
        // Scattered blocks.
        return hash21(blk.xy / max(blk.zw, vec2(1.0)) + vec2(hm, 5.0)) < p * 0.7;
    }
    if (mode < 1.5) {
        // Clumps.
        vec2 cell = floor(c * 4.0);
        return hash21(cell + vec2(hm * 1.3, 2.0)) < p * 0.8;
    }
    if (mode < 2.5) {
        // A broken slice: a run of blocks in raster order, as a lost packet would.
        float rowsN = floor(RENDERSIZE.y / max(blk.w, 1.0));
        float colsN = floor(RENDERSIZE.x / max(blk.z, 1.0));
        float idx = floor((RENDERSIZE.y - blk.y - blk.w) / max(blk.w, 1.0)) * colsN + floor(blk.x / max(blk.z, 1.0));
        float total = rowsN * colsN;
        float start = floor(hash11(hm + 9.0) * total);
        float len = total * p * 0.6;
        float k = mod(idx - start + total, total);
        return k < len;
    }
    // A patch around a point.
    vec2 at = mid + (vec2(hash11(hm + 11.0), hash11(hm + 12.0)) - 0.5) * vec2(1.4, 0.8);
    return length(c - at) < 0.12 + 0.45 * p;
}

// ---- The voice's own picture ----

float aaFill(float d, float w) {
    return clamp(0.5 - d / w, 0.0, 1.0);
}

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// The picture, at q (frame-height units, origin in the middle). Returns
// rgb light; w is one stored pixel in the same units.
vec3 picture(vec2 q, float kind, float sc, float drift, float w) {
    vec3 col = vec3(0.0);
    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    // One small element in some recipes carries the accent.
    float hot = hash11(sc * 4.1 + 0.3) < 0.6 ? 1.0 + floor(hash11(sc * 5.3) * 3.0) : -1.0;
    if (kind < 0.5) {
        // Shapes: one large form near the middle and smaller ones along a line
        // through it, each shaded inside so its smears carry tone.
        float horiz = step(0.35, hash11(sc * 2.7 + 9.0));
        vec2 axis = horiz > 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        float side = hash11(sc * 6.1) < 0.5 ? -1.0 : 1.0;
        for (int i = 0; i < 4; i++) {
            float fi = float(i);
            float h2 = hash11(sc * 0.73 + fi * 5.9 + 2.0);
            float h3 = hash11(sc * 3.91 + fi * 1.3 + 3.0);
            float r = fi < 0.5 ? mix(0.18, 0.36, h2) : mix(0.05, 0.12, h2);
            float along = fi < 0.5 ? (hash11(sc + 0.5) - 0.5) * 0.2
                                   : side * (0.3 + 0.12 * fi) * (horiz > 0.5 ? 1.0 : 0.45) * (mod(fi, 2.0) < 0.5 ? -1.0 : 1.0);
            vec2 c = axis * along + (1.0 - axis) * (hash11(sc * 1.7 + fi) - 0.5) * 0.12;
            c += axis * sin(drift * 0.3 + fi * 2.0) * 0.02;
            vec2 p = q - c;
            float kindI = floor(h3 * 4.0);
            float a = 0.0;
            float shade = 1.0;
            if (kindI < 0.5) {
                // A disc lit from one side.
                float d = length(p) - r;
                a = aaFill(d, w);
                shade = 0.2 + 0.8 * clamp(0.5 + dot(p / r, vec2(0.6, 0.8)) * 0.5, 0.0, 1.0);
            } else if (kindI < 1.5) {
                // A thick ring.
                float d = abs(length(p) - r) - r * 0.1;
                a = aaFill(d, w);
                shade = 0.6 + 0.4 * sin(atan(p.y, p.x) + drift * 0.2);
            } else if (kindI < 2.5) {
                // A bar with a ramp down it.
                vec2 b = horiz > 0.5 ? vec2(r * 0.3, r * 1.4) : vec2(r * 1.4, r * 0.3);
                a = aaFill(sdBox(p, b), w);
                shade = clamp(0.5 + 0.5 * (p.x + p.y) / max(b.x, b.y), 0.08, 1.0);
            } else {
                // A square frame.
                float d = abs(sdBox(p, vec2(r * 0.85))) - r * 0.08;
                a = aaFill(d, w);
                shade = 0.85;
            }
            vec3 tone = (fi == hot) ? accC : inkC * mix(0.5, 0.95, hash11(sc + fi * 9.1));
            col = max(col, tone * shade * a);
        }
    } else if (kind < 1.5) {
        // Gradients: soft bodies of light with contour hairlines through them.
        vec2 c1 = (vec2(hash11(sc + 1.0), hash11(sc + 2.0)) - 0.5) * vec2(0.5, 0.2);
        vec2 c2 = c1 + (vec2(hash11(sc + 3.0), hash11(sc + 4.0)) - 0.5) * vec2(0.9, 0.5);
        c1.y += sin(drift * 0.25) * 0.03;
        c2.x += cos(drift * 0.2) * 0.05;
        float s1 = mix(0.16, 0.3, hash11(sc + 5.0));
        float s2 = mix(0.08, 0.18, hash11(sc + 6.0));
        float f = exp(-dot(q - c1, q - c1) / (s1 * s1)) + 0.7 * exp(-dot(q - c2, q - c2) / (s2 * s2));
        f = 1.0 - exp(-f * 1.3);
        float levels = 6.0 + floor(hash11(sc + 9.0) * 6.0);
        float lv = f * levels;
        float iso = abs(fract(lv + 0.5) - 0.5) / max(fwidth(lv), 1e-4);
        float line = clamp(1.0 - iso / 0.9, 0.0, 1.0) * step(0.06, f);
        // Some recipes band the light into flat steps.
        float terr = hash11(sc + 8.0) < 0.5 ? floor(lv) / levels : f;
        col = inkC * (pow(terr, 1.6) * 0.95);
        col = max(col, inkC * line * 0.85);
        float top = clamp(1.0 - abs(lv - floor(levels * 0.75)) / 0.5, 0.0, 1.0);
        if (hot > 0.0) col = max(col, accC * top * line);
    } else if (kind < 2.5) {
        // Stripes: a wide window of bars across the middle, and a smaller one over it.
        for (int i = 0; i < 2; i++) {
            float fi = float(i);
            float hs = sc * 1.7 + fi * 31.0;
            vec2 c = fi < 0.5 ? vec2((hash11(hs + 1.0) - 0.5) * 0.2, (hash11(hs + 2.0) - 0.5) * 0.1)
                              : (vec2(hash11(hs + 1.0), hash11(hs + 2.0)) - 0.5) * vec2(aspect * 0.5, 0.4);
            vec2 b = fi < 0.5 ? vec2(mix(0.4, 0.62, hash11(hs + 3.0)), mix(0.14, 0.3, hash11(hs + 4.0)))
                              : vec2(mix(0.06, 0.15, hash11(hs + 3.0)), mix(0.05, 0.12, hash11(hs + 4.0)));
            vec2 p = q - c;
            float inside = aaFill(sdBox(p, b), w);
            float vert = step(0.5, hash11(hs + 5.0));
            float along = mix(p.y, p.x, vert) + drift * 0.02 * (fi - 0.5);
            float period = mix(0.012, 0.045, hash11(hs + 6.0));
            float k = floor(along / period);
            float duty = mix(0.2, 0.75, hash11(k * 1.7 + hs));
            float sx = fract(along / period);
            float bar = clamp((duty - sx) * period / w + 0.5, 0.0, 1.0) * clamp(sx * period / w + 0.5, 0.0, 1.0);
            float across = mix(p.x, p.y, vert) / mix(b.x, b.y, vert);
            float ramp = 0.25 + 0.75 * clamp(0.5 + 0.5 * across, 0.0, 1.0);
            vec3 tone = (fi > 0.5 && hot > 0.0) ? accC : inkC;
            col = max(col, tone * bar * ramp * inside * mix(0.6, 0.95, hash11(k + hs + 3.0)));
        }
    } else {
        // Type: a block of ragged lines of words, with a heavier heading line.
        float lineH = mix(0.03, 0.06, hash11(sc + 21.0));
        float lines = 6.0 + floor(hash11(sc + 22.0) * 7.0);
        float width = mix(0.8, 1.4, hash11(sc + 23.0));
        vec2 org = vec2(-0.42 * width + (hash11(sc + 24.0) - 0.5) * 0.16, 0.5 * lines * lineH);
        float row = floor((org.y - q.y) / lineH);
        float fy = (org.y - q.y) / lineH - row;
        if (row >= 0.0 && row < lines) {
            float heading = row < 0.5 ? 1.0 : 0.0;
            float cellW = lineH * mix(0.32, 0.5, hash11(sc + 25.0)) * (1.0 + heading);
            float x = q.x - org.x + drift * 0.004 * (mod(row, 2.0) - 0.5);
            float cell = floor(x / cellW);
            float lineLen = width * (heading > 0.5 ? 0.55 : mix(0.55, 1.0, hash11(row * 3.1 + sc)));
            float gap = hash21(vec2(cell, row + sc * 0.37)) < 0.2 ? 1.0 : 0.0;
            float glyphH = heading > 0.5 ? 0.78 : 0.5;
            float on = (x >= 0.0 && x < lineLen && gap < 0.5) ? 1.0 : 0.0;
            float ink2 = on * clamp((glyphH - fy) * lineH / w + 0.5, 0.0, 1.0) * clamp((fy - 0.12) * lineH / w + 0.5, 0.0, 1.0);
            float word = floor(cell / 5.0);
            float lit = mix(0.35, 0.95, hash21(vec2(word, row + sc)));
            vec3 tone = (hot > 0.0 && row == hot + 1.0 && hash21(vec2(word, sc)) < 0.3) ? accC : inkC * lit;
            col = tone * ink2 * (heading > 0.5 ? 1.0 : 0.85);
        }
    }
    return col;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    vec4 gen = IMG_NORM_PIXEL(genes, vec2(0.5));
    if (FRAMEINDEX < 2) {
        clk = vec4(-1.0, 0.0, -1.0, 0.0);
        gen = vec4(0.0);
    }
    vec2 gNow = genesNow(gen, clk);
    float n = countNow();
    float bars = floor(vxBars + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float acc = clk.g + stepRate() * dt;

    if (PASSINDEX == 0) {
        bool newHit = FRAMEINDEX >= 2 && abs(n - clk.r) > 0.5;
        bool newBar = FRAMEINDEX >= 2 && abs(bars - clk.b) > 0.5;
        float steps = min(floor(acc), 14.0);
        float ls = layoutSeed(gNow.y);
        vec4 blk = blockAt(gl_FragCoord.xy, ls);
        vec4 prev = IMG_NORM_PIXEL(pic, uv);
        float moshing = prev.a;
        float rs = recipe();

        // A fresh keyframe for part of the frame on each bar line.
        if (newBar) {
            float bh = hash21(blk.xy / max(blk.zw, vec2(1.0)) + vec2(bars * 3.7 + rs, 1.0));
            if (bh < reset) moshing = 0.0;
        }
        vec3 atC = IMG_NORM_PIXEL(pic, (blk.xy + 0.5 * blk.zw) / RENDERSIZE).rgb;
        float carry = smoothstep(0.02, 0.25, dot(atC, vec3(0.2126, 0.7152, 0.0722)));
        if (newHit && moshPick(blk, n, gNow.y, carry)) moshing = 1.0;

        // The fresh picture (derivatives taken here, outside any branch).
        vec2 texel = fwidth(gl_FragCoord.xy) / RENDERSIZE;
        float kind = source == 0 ? floor(hash11(rs * 0.57 + 6.1) * 4.0) : float(source - 1);
        float per = pow(2.0, floor(hash11(rs * 1.9 + 0.2) * 3.0));
        float sc = rs * 3.17 + floor(bars / per) * 11.3;
        vec2 q = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
        float w = max(fwidth(q.x), fwidth(q.y));
        float rest = mix(0.6, 1.0, clk.a);
        vec3 col = picture(q, kind, sc, vxPhase, w) * rest;
        if (moshing > 0.5) {
            // Stale pixels dragged along the block's vector, whole stored pixels at a time.
            vec2 v = blockVector(blk, gNow.x, gNow.y);
            vec2 from = uv - v * steps * texel;
            bool inside = from.x >= 0.0 && from.x <= 1.0 && from.y >= 0.0 && from.y <= 1.0;
            col = inside ? IMG_NORM_PIXEL(pic, from).rgb : vec3(0.0);
        }
        if (FRAMEINDEX < 2) {
            col = vec3(0.0);
            moshing = 0.0;
        }
        gl_FragColor = vec4(col, moshing);
        return;
    }

    if (PASSINDEX == 1) {
        // Recent activity, which lifts the picture from its resting level.
        float act = max(clk.a * pow(0.5, dt / 1.5), clamp(max(vxEnv, vxHit), 0.0, 1.0));
        gl_FragColor = vec4(n, fract(acc), bars, act);
        return;
    }

    if (PASSINDEX == 2) {
        gl_FragColor = vec4(gNow, 0.0, 1.0);
        return;
    }

    vec4 c = IMG_NORM_PIXEL(pic, uv);
    vec3 col = c.rgb;

    // The codec's own view: moshing blocks show a hairline vector from their middle.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.5));
    if (vectors > 0.001) {
        vec4 blk = blockAt(gl_FragCoord.xy, layoutSeed(gen.g));
        vec2 centre = blk.xy + 0.5 * blk.zw;
        vec4 at = IMG_NORM_PIXEL(pic, centre / RENDERSIZE);
        // Only blocks that carry picture show their vector, so black stays black.
        float carry = smoothstep(0.04, 0.2, dot(at.rgb, vec3(0.2126, 0.7152, 0.0722)));
        if (at.a > 0.5 && carry > 0.0) {
            vec2 v = blockVector(blk, gen.r, gen.g);
            vec2 dir = v / max(length(v), 1e-3);
            float len = 0.42 * min(blk.z, blk.w);
            vec2 p = (gl_FragCoord.xy - centre);
            float t = clamp(dot(p, dir), 0.0, len);
            vec2 d = (p - dir * t) / fw;
            float line = clamp(1.2 - length(d), 0.0, 1.0) * (0.25 + 0.75 * t / len);
            float lift = clamp(vectors * 1.6, 0.0, 1.0) * carry * (0.45 + 0.55 * clamp(vxEnv, 0.0, 1.0));
            col = mix(col, accent.rgb, line * lift);
        }
    }

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
