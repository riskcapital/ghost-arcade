/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Architectural light panels: the frame is split into a grid of uneven rectangles, laid out afresh on bar lines. Every hit of the sound it follows lights a different few panels, which snap on and fall away; the panel edges always glow faintly. No hit lights more than about 40% of the frame.",
    "PASSES": [
        { "TARGET": "hitAges", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        { "TARGET": "lastHit", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "splits", "LABEL": "Splits", "TYPE": "float", "DEFAULT": 5, "MIN": 2, "MAX": 6 },
        { "NAME": "gap", "LABEL": "Gap", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "panels", "LABEL": "Panels per hit", "TYPE": "float", "DEFAULT": 2, "MIN": 1, "MAX": 6 },
        { "NAME": "decay", "LABEL": "Decay", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "fill", "LABEL": "Fill", "TYPE": "float", "DEFAULT": 0.95, "MIN": 0, "MAX": 1 },
        { "NAME": "outline", "LABEL": "Outline", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "pattern", "LABEL": "Pattern: random, sweep, mirror", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 2 },
        { "NAME": "relayout", "LABEL": "Relayout on bar", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Panels", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Every fourth hit", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// hitAges holds seconds since the last four hits (newest in r); lastHit holds
// the count, the layout seed and seconds since the layout changed. Both are 1x1
// targets, so they stay exact however the core scales its buffers.

// The most of the frame one hit may fill.
const float AREA_CAP = 0.4;
// Split lines snap to this modular grid.
const vec2 MODULE = vec2(24.0, 14.0);

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float splitRatio(float h) {
    float i = floor(h * 5.0);
    if (i < 0.5) return 0.333;
    if (i < 1.5) return 0.382;
    if (i < 2.5) return 0.5;
    if (i < 3.5) return 0.618;
    return 0.667;
}

// One point that hit m aims at. kind: 0 random, 1 sweep, 2 mirror.
vec2 aimPoint(float m, float j, float k, float kind) {
    vec2 r = vec2(hash21(vec2(m * 7.13 + j, 3.7)), hash21(vec2(m * 3.91 + j * 5.3, 8.1)));
    if (kind > 0.5 && kind < 1.5) {
        // A column of points that steps across the frame hit by hit.
        float x = fract(m / 7.0) + 0.5 / 7.0;
        return vec2(x, (j + 0.25 + 0.5 * r.y) / k);
    }
    return r;
}

float inRect(vec2 p, vec4 r) {
    return (p.x >= r.x && p.x < r.z && p.y >= r.y && p.y < r.w) ? 1.0 : 0.0;
}

float layoutSeed() {
    float barsPer = pow(2.0, floor((1.0 - clamp(relayout, 0.0, 1.0)) * 3.99));
    return relayout < 0.05 ? 0.0 : floor((vxBars + 0.5) / barsPer);
}

void main() {
    float n = floor(vxCount + 0.5);
    float seed = layoutSeed();

    if (PASSINDEX == 0) {
        vec4 ages = IMG_NORM_PIXEL(hitAges, vec2(0.5));
        float last = IMG_NORM_PIXEL(lastHit, vec2(0.5)).r;
        if (FRAMEINDEX < 2) ages = vec4(30.0);
        ages = min(ages + clamp(TIMEDELTA, 0.0, 0.1), vec4(30.0));
        if (FRAMEINDEX >= 2 && abs(n - last) > 0.5) ages = vec4(0.0, ages.rgb);
        gl_FragColor = ages;
        return;
    }
    if (PASSINDEX == 1) {
        vec4 prev = IMG_NORM_PIXEL(lastHit, vec2(0.5));
        float since = (FRAMEINDEX < 2 || abs(prev.g - seed) > 0.5) ? 0.0 : min(prev.b + clamp(TIMEDELTA, 0.0, 0.1), 30.0);
        gl_FragColor = vec4(n, seed, since, 1.0);
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float px = RENDERSIZE.y / 1080.0;
    // The core may store this layer coarser than its render size; fw is one stored pixel.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));

    // Layout: recursive splits, seeded per bar (or held).
    float depthMax = clamp(floor(splits + 0.5), 2.0, 6.0);
    vec4 rect = vec4(0.0, 0.0, 1.0, 1.0);
    float id = 1.0;
    for (int i = 0; i < 6; i++) {
        if (float(i) >= depthMax) break;
        float h1 = hash21(vec2(id, seed * 1.37 + 0.5));
        float h2 = hash21(vec2(id * 1.7 + 3.1, seed + 11.0));
        float h3 = hash21(vec2(id * 2.3 + 7.9, seed * 0.71 + 5.0));
        // Some branches stop early, so big and small panels mix.
        if (i >= 2 && h2 < 0.2) break;
        vec2 size = (rect.zw - rect.xy) * RENDERSIZE;
        bool cutX = size.x > size.y ? h1 < 0.78 : h1 < 0.22;
        float t = splitRatio(h3);
        if (cutX) {
            if (rect.z - rect.x < 2.5 / MODULE.x) break;
            float s = clamp(floor(mix(rect.x, rect.z, t) * MODULE.x + 0.5) / MODULE.x, rect.x + 1.0 / MODULE.x, rect.z - 1.0 / MODULE.x);
            float side = uv.x >= s ? 1.0 : 0.0;
            if (side > 0.5) rect.x = s; else rect.z = s;
            id = id * 2.0 + side;
        } else {
            if (rect.w - rect.y < 2.5 / MODULE.y) break;
            float s = clamp(floor(mix(rect.y, rect.w, t) * MODULE.y + 0.5) / MODULE.y, rect.y + 1.0 / MODULE.y, rect.w - 1.0 / MODULE.y);
            float side = uv.y >= s ? 1.0 : 0.0;
            if (side > 0.5) rect.y = s; else rect.w = s;
            id = id * 2.0 + side;
        }
    }
    float area = (rect.z - rect.x) * (rect.w - rect.y);

    // Which of the last four hits lit this panel, and how brightly now.
    vec4 ages = IMG_NORM_PIXEL(hitAges, vec2(0.5));
    // Hits from before the last relayout belong to the old panels: drop them.
    float sinceLayout = IMG_NORM_PIXEL(lastHit, vec2(0.5)).b;
    float kind = clamp(floor(pattern + 0.5), 0.0, 2.0);
    float k = clamp(floor(panels + 0.5), 1.0, 6.0);
    float points = kind > 1.5 ? 2.0 * k : k;
    float cap = AREA_CAP / points;
    float tau = mix(0.08, 0.6, decay);
    float fillLight = 0.0;
    float edgeLight = 0.0;
    float red = 0.0;
    for (int h = 0; h < 4; h++) {
        float age = h == 0 ? ages.r : (h == 1 ? ages.g : (h == 2 ? ages.b : ages.a));
        if (age < 29.0 && age <= sinceLayout + 0.001) {
            float m = mod(n - float(h) + 64.0, 64.0);
            float hit = 0.0;
            float first = 0.0;
            for (int j = 0; j < 6; j++) {
                if (float(j) < k) {
                    vec2 p = aimPoint(m, float(j), k, kind);
                    float inside = inRect(p, rect);
                    if (kind > 1.5) inside = max(inside, inRect(vec2(1.0 - p.x, p.y), rect));
                    hit = max(hit, inside);
                    if (j == 0) first = inside;
                }
            }
            // Snap on and hold for a moment, then fall away; the fill goes first, the edge lingers.
            float env = exp(-max(age - 0.05, 0.0) / tau) * hit;
            // A panel too large for the cap only lights its edge.
            float canFill = area <= cap ? 1.0 : 0.0;
            fillLight = max(fillLight, pow(env, 1.6) * canFill);
            edgeLight = max(edgeLight, env);
            if (h == 0 && mod(m, 4.0) == 0.0) red = max(red, first * env);
        }
    }

    // Draw: inset panel with a gutter, a thin edge, and the fill.
    float gutter = mix(2.0, 26.0, gap) * px;
    vec2 lo = rect.xy * RENDERSIZE + vec2(gutter * 0.5) + (1.0 - step(0.0001, rect.xy)) * gutter * 0.5;
    vec2 hi = rect.zw * RENDERSIZE - vec2(gutter * 0.5) - step(0.9999, rect.zw) * gutter * 0.5;
    vec2 c = 0.5 * (lo + hi);
    vec2 halfSize = max(0.5 * (hi - lo), vec2(1.0));
    vec2 d2 = abs(gl_FragCoord.xy - c) - halfSize;
    float sd = length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0);
    float aa = d2.x > d2.y ? fw.x : fw.y;
    float lw = max(1.2 * px, aa);
    float edge = clamp((0.5 * lw - abs(sd)) / aa + 0.5, 0.0, 1.0);
    float inside = clamp(0.5 - sd / aa, 0.0, 1.0);

    // Edges always glow faintly; a slow wave of light crosses them at rest.
    vec2 centre = 0.5 * (rect.xy + rect.zw);
    float wave = 0.5 + 0.5 * sin(vxPhase * 1.3 - (centre.x * 1.7 + centre.y) * 4.0);
    float restEdge = 0.055 + 0.05 * wave * wave;

    float white = max(edge * max(restEdge, edgeLight * outline), inside * fillLight * fill);
    float redAmt = clamp(red * max(inside * fill * (area <= cap ? 1.0 : 0.0), edge * outline), 0.0, 1.0);
    vec3 col = ink.rgb * white * (1.0 - redAmt) + accent.rgb * redAmt;

    // Dither the fades so they don't band.
    float lit = max(col.r, max(col.g, col.b));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0 * step(0.004, lit);
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
