/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A corrupted signal. The voice draws its own thin geometric figure and cuts the frame into horizontal bands; every hit of the sound it follows tears some bands sideways (wrapping round), splits their channels into an ink and accent fringe, stutters their content and now and then inverts one. The bands snap back into register within about a quarter of a beat, so the figure reads clean between hits. Seed re-rolls the figure, the band bandMode, the offset style and the stutter; Mutate re-rolls part of that on hits.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 3, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "bands", "LABEL": "Bands", "TYPE": "float", "DEFAULT": 14, "MIN": 4, "MAX": 40 },
        { "NAME": "offset", "LABEL": "Offset", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "split", "LABEL": "Channel split", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "stutter", "LABEL": "Stutter", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "recovery", "LABEL": "Recovery", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "invertEvery", "LABEL": "Invert every", "TYPE": "float", "DEFAULT": 4, "MIN": 0, "MAX": 16 },
        { "NAME": "source", "LABEL": "Figure", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4], "LABELS": ["Set by seed", "Rings", "Diagonals", "Grid", "Traces"] },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.44, "MIN": 0, "MAX": 1 },
        { "NAME": "mutate", "LABEL": "Mutate", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Figure", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Fringe", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBeat", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last count seen, seconds since the last hit, last beat
// position, smoothed seconds per beat.
// genes (1x1): band epoch and style epoch, bumped by Mutate on hits.

const float TAU = 6.2831853;
const int MAX_BANDS = 40;

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

float lineAA(float d, float w) {
    return clamp(1.0 - abs(d) / w, 0.0, 1.0);
}

// The figure: thin light on black, in a centred window. p in frame-height
// units, origin in the middle; w is the line half-width.
float figure(vec2 p, float kind, float fs, float t, float w) {
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float v = 0.0;
    if (kind < 0.5) {
        // Concentric rings, a cross through them and a few tick marks.
        vec2 c = vec2((hash11(fs + 1.0) - 0.5) * 0.3, 0.0);
        float r = length(p - c);
        float spacing = mix(0.045, 0.085, hash11(fs + 2.0));
        float rings = floor(4.0 + hash11(fs + 3.0) * 4.0);
        float rr = r / spacing - fract(t * 0.15);
        float k = floor(rr + 0.5);
        if (k >= 1.0 && k <= rings) v = max(v, lineAA((rr - k) * spacing, w) * mix(1.0, 0.6, k / rings));
        float reach = (rings + 0.5) * spacing;
        if (abs(p.y - c.y) < reach * 1.15) v = max(v, lineAA(p.x - c.x, w) * 0.6);
        if (abs(p.x - c.x) < reach * 1.6) v = max(v, lineAA(p.y - c.y, w) * 0.6);
    } else if (kind < 1.5) {
        // A window of fine diagonals, their slope set by the seed.
        vec2 b = vec2(mix(0.45, 0.75, hash11(fs + 4.0)), mix(0.22, 0.36, hash11(fs + 5.0)));
        if (abs(p.x) < b.x && abs(p.y) < b.y) {
            float ang = mix(0.5, 1.1, hash11(fs + 6.0)) * (hash11(fs + 7.0) < 0.5 ? 1.0 : -1.0);
            float s = dot(p, vec2(cos(ang), sin(ang)));
            float pitch = mix(0.018, 0.04, hash11(fs + 8.0));
            float u = s / pitch + t * 0.2;
            float k = floor(u + 0.5);
            float lvl = mix(0.35, 1.0, hash11(k * 1.7 + fs));
            v = lineAA((u - k) * pitch, w) * lvl;
        }
        // The window's frame.
        vec2 e = abs(p) - b;
        float frame = abs(max(e.x, e.y));
        if (max(e.x, e.y) < w * 2.0) v = max(v, lineAA(frame, w) * 0.8);
    } else if (kind < 2.5) {
        // A grid of crosses and dots, some cells lit.
        float cell = mix(0.05, 0.09, hash11(fs + 9.0));
        vec2 b = vec2(aspect * 0.4, 0.34);
        if (abs(p.x) < b.x && abs(p.y) < b.y) {
            vec2 g = (p + vec2(t * 0.01, 0.0)) / cell;
            vec2 id = floor(g + 0.5);
            vec2 f = (g - id) * cell;
            float lit = hash21(id + fs);
            float arm = cell * (lit > 0.7 ? 0.32 : 0.0);
            float cross = max(lineAA(f.x, w) * step(abs(f.y), arm), lineAA(f.y, w) * step(abs(f.x), arm));
            v = cross * (lit > 0.7 ? 1.0 : 0.0);
            // Faint dots mark the empty cells.
            if (lit <= 0.7) v = step(length(f), w * 1.2) * 0.4;
            if (lit > 0.93) v = max(v, step(max(abs(f.x), abs(f.y)), cell * 0.36) * 0.75);
        }
    } else {
        // Stacked traces, like a scope with several channels.
        float rows = 4.0 + floor(hash11(fs + 10.0) * 4.0);
        float h = 0.62 / rows;
        float k = floor((p.y + 0.31) / h);
        if (k >= 0.0 && k < rows && abs(p.x) < aspect * 0.42) {
            float yc = -0.31 + (k + 0.5) * h;
            float fq = mix(3.0, 14.0, hash11(k * 2.3 + fs));
            float am = h * mix(0.15, 0.4, hash11(k * 3.1 + fs));
            float sq = hash11(k * 4.7 + fs) < 0.35 ? 1.0 : 0.0;
            float ph = p.x * fq + t * (0.5 + hash11(k + fs)) + k;
            float y = sq > 0.5 ? am * sign(sin(ph)) : am * sin(ph);
            float dy = sq > 0.5 ? 0.0 : am * fq * cos(ph);
            float d = (p.y - yc - y) / sqrt(1.0 + dy * dy);
            v = lineAA(d, w * 1.1);
            // Square traces get their risers.
            if (sq > 0.5) {
                float edge = abs(fract(ph / TAU + 0.5) - 0.5) * TAU / fq;
                float rise = abs(fract(ph / TAU) - 0.5) * TAU / fq;
                float dx = min(edge, rise);
                if (abs(p.y - yc) < am) v = max(v, lineAA(dx, w));
            }
            v *= mix(0.5, 1.0, hash11(k + fs + 9.0));
        }
    }
    return v;
}

void main() {
    float n = floor(vxCount + 0.5);
    float rs = recipe();

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, vxBeat, 0.5);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g + dt, 30.0);
        // Tempo, measured from how fast the beat position moves.
        float db = fract(vxBeat - c.b + 1.0);
        float spb = c.a;
        if (dt > 0.0 && db > 0.0001 && db < 0.5) spb = mix(spb, clamp(dt / db, 0.2, 2.0), 1.0 - pow(0.5, dt / 0.5));
        gl_FragColor = vec4(n, age, vxBeat, spb);
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
    float bs = rs * 1.618 + gen.r * 7.31;    // band bandMode
    float ss = rs * 2.414 + gen.g * 5.17;    // offset and stutter style

    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.5));
    float pxF = max(fw.x, fw.y) / RENDERSIZE.y;     // one stored pixel, frame units
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    // Bands: weights from the seed, edges on whole stored pixels.
    float nb = clamp(floor(bands + 0.5), 4.0, 40.0);
    float bandMode = floor(hash11(bs + 0.7) * 3.0);
    float total = 0.0;
    for (int i = 0; i < MAX_BANDS; i++) {
        float fi = float(i);
        if (fi >= nb) break;
        float wgt = bandMode < 0.5 ? 1.0 : (bandMode < 1.5 ? 0.25 + pow(hash11(fi * 1.7 + bs), 3.0) * 3.0 : pow(1.12, fi) * (0.6 + 0.8 * hash11(fi + bs)));
        total += wgt;
    }
    float yTop = 1.0 - uv.y;
    float band = 0.0;
    float b0 = 0.0;
    float b1 = 1.0;
    float acc = 0.0;
    for (int i = 0; i < MAX_BANDS; i++) {
        float fi = float(i);
        if (fi >= nb) break;
        float wgt = bandMode < 0.5 ? 1.0 : (bandMode < 1.5 ? 0.25 + pow(hash11(fi * 1.7 + bs), 3.0) * 3.0 : pow(1.12, fi) * (0.6 + 0.8 * hash11(fi + bs)));
        float top = acc / total;
        acc += wgt;
        float bot = acc / total;
        if (yTop >= top && yTop < bot) {
            band = fi;
            b0 = top;
            b1 = bot;
        }
    }

    // How far into its recovery the last hit is: snaps back over about a
    // quarter of a beat, smoothly or in hard steps (by seed).
    float spb = clamp(clk.a, 0.2, 2.0);
    float rec = spb * mix(0.1, 0.6, recovery);
    float k = clamp(clk.g / rec, 0.0, 1.0);
    float stepped = step(0.5, hash11(ss + 1.0));
    float hold = stepped > 0.5 ? 1.0 - floor(k * 4.0) / 4.0 : pow(1.0 - k, 2.0);
    if (clk.g >= rec) hold = 0.0;
    if (n < 0.5) hold = 0.0;

    // Which bands this hit tears, and how.
    float style = floor(hash11(ss + 2.0) * 5.0);
    float share = mix(0.18, 0.5, hash11(ss + 3.0)) * mix(0.7, 1.0, clamp(vxVel, 0.0, 1.0));
    float hb = hash21(vec2(band * 1.37 + 0.5, n * 0.917 + ss));
    // Some styles tear a run of neighbouring bands together.
    float runStart = floor(hash11(n * 1.3 + ss) * nb);
    float runLen = max(2.0, floor(nb * share * 1.4));
    bool torn = style > 3.5 ? (mod(band - runStart + nb, nb) < runLen) : (hb < share);
    float off = 0.0;
    if (torn) {
        float r = hash21(vec2(band + 3.1, n + ss));
        if (style < 0.5) off = (r - 0.5) * 2.0;
        else if (style < 1.5) off = (mod(band - runStart + nb, nb) / nb) * 1.6 - 0.3;
        else if (style < 2.5) off = (mod(band, 2.0) < 0.5 ? 1.0 : -1.0) * (0.3 + 0.7 * r);
        else if (style < 3.5) off = (floor(r * 4.0) - 1.5) / 1.5;
        else off = (hash11(n * 2.9 + ss) - 0.5) * 2.0 + (r - 0.5) * 0.2;
    }
    float shift = off * offset * (0.3 + 0.7 * offset) * 0.7 * hold;
    // Whole stored pixels, so the tear lands on the grid.
    shift = floor(shift * RENDERSIZE.x / fw.x + 0.5) * fw.x / RENDERSIZE.x;

    // Position in the figure: wrap the shifted row round the frame.
    float x = fract(uv.x - shift);
    float stut = (torn && hash21(vec2(band + 7.7, n + ss * 1.3)) < stutter && hold > 0.0) ? 1.0 : 0.0;
    if (stut > 0.5) {
        float sMode = floor(hash11(ss + 4.0) * 2.0);
        float sw = mix(0.02, 0.16, hash21(vec2(band, n + 5.0)));
        float x0 = hash21(vec2(band + 2.0, n + ss));
        // Repeat a short slice of the band, or hold it in coarse blocks.
        x = sMode < 0.5 ? fract(x0 + mod(x - x0, sw)) : floor(x / (sw * 0.35)) * sw * 0.35;
    }
    vec2 p = vec2((x - 0.5) * aspect, uv.y - 0.5);
    float kind = source == 0 ? mod(rs + floor(hash11(rs * 0.37 + 1.1) * 2.0), 4.0) : float(source - 1);
    float fs = rs * 3.17;
    float w = pxF * 1.4;
    float t = vxPhase;

    float base = figure(p, kind, fs, t, w);
    float sp = split * 0.045 * hold * (torn ? 1.0 : 0.0) * mix(0.5, 1.0, hash21(vec2(band, n + 9.0)));
    sp = floor(sp * RENDERSIZE.x / fw.x + 0.5) * fw.x / RENDERSIZE.x;
    vec3 col = ink.rgb * base;
    if (sp > 0.0) {
        float ahead = figure(p + vec2(sp * aspect, 0.0), kind, fs, t, w);
        float behind = figure(p - vec2(sp * aspect, 0.0), kind, fs, t, w);
        // The fringe: accent where the shifted copy leads, a dim ink ghost where it trails.
        col = max(col, accent.rgb * max(ahead - base, 0.0));
        col = max(col, ink.rgb * 0.4 * max(behind - base, 0.0));
    }

    // Every few hits one torn band briefly turns negative.
    float every = invertEvery < 0.5 ? 0.0 : max(2.0, floor(invertEvery + 0.5));
    if (every > 0.0 && torn && hold > 0.0 && mod(n, every) == 0.0 && band == floor(hash11(n * 2.71 + ss) * nb)) {
        col = ink.rgb * 0.75 * (1.0 - clamp(base, 0.0, 1.0));
    }


    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
