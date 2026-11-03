/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A pixel picture that melts. The voice draws a big chunky-pixel picture, a striped sun or a row of hanging bars, above a dark floor. Every hit of the sound it follows lets columns of it melt: the pixels sag, and from every lower edge a drip runs down under gravity, a thin trail with a bright head, until it lands and spreads into a glowing puddle on the floor. Then the drips draw back up and the picture re-forms before the next hit. Pixels sets the size of the grid; Melt how many columns drip on a hit; Flow how far and fast they run; Re-form how soon they draw back; Picture picks what is drawn.",
    "PASSES": [
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "cells",
            "FLOAT": true,
            "WIDTH": 256,
            "HEIGHT": 128
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "pixels", "LABEL": "Pixels", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "melt", "LABEL": "Melt", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "flow", "LABEL": "Flow", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "reform", "LABEL": "Re-form", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "picture", "LABEL": "Picture", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Changes every few bars", "Striped sun", "Hanging bars"] },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.29, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Drips", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): r last count seen, g the clock (mod 32 s) at the last hit,
// b a rough count of seconds since it, a the clock at the hit before.
// cells (256x128): the picture, one texel per grid cell, -1 where empty.

const int MAXL = 44;
const int SPREAD = 4;

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

// Shared state, set once in main.
float gRows;
float gCols;
float gKind;
float gSeed;
float gT;
float gFloor;

// The picture at cell (c, r), rows counted up from the bottom: below 0 is
// empty, otherwise a tone 0-1 (1 at the top of a shape).
// c counts columns from the middle of the frame.
float picAt(float c, float r) {
    if (r <= gFloor + 0.5) return -1.0;
    vec2 p = vec2((c + 0.5) / gRows, (r + 0.5) / gRows - 0.5);
    if (gKind < 0.5) {
        // A striped sun: a disc whose lower half is cut by slits that widen
        // downward and slide slowly down.
        vec2 ctr = vec2(0.0, 0.1);
        float R = 0.31;
        float d = length(p - ctr);
        if (d > R) return -1.0;
        float y = (p.y - ctr.y) / R;           // -1 .. 1
        if (y < 0.15) {
            float k = (0.15 - y) / 1.15;       // 0 at the first slit, 1 at the bottom
            float period = 0.27;
            float u = fract((0.15 - y) / period - gT * 0.1);
            if (u < 0.1 + 0.45 * k) return -1.0;
        }
        return clamp(0.25 + 0.75 * (y * 0.5 + 0.5), 0.0, 1.0);
    }
    // Hanging bars: columns in groups, hanging from the top, their ends
    // rising and falling slowly.
    float gw = 3.0 + floor(hash11(gSeed + 1.0) * 2.0);
    float g = floor((c + 512.0) / gw);
    float within = c + 512.0 - g * gw;
    if (within > gw - 1.5) return -1.0;        // a gap column between bars
    float x = ((g + 0.5) * gw - 512.0) / gRows / 1.6;
    if (abs(x) > 0.42) return -1.0;
    float len = 0.25 + 0.4 * hash11(g * 1.37 + gSeed) * (1.0 - abs(x) * 0.9);
    len += 0.08 * sin(gT * 0.6 + g * 0.9 + gSeed);
    float top = 0.5 - 0.06;
    if (p.y > top || p.y < top - len) return -1.0;
    return clamp((p.y - (top - len)) / len * 0.75 + 0.25, 0.0, 1.0);
}

// The cells pass at (c, r): tone, distance up to the picture, its tone.
vec4 cellAt(float c, float r) {
    if (c < 0.0 || c >= gCols || r < 0.0 || r > 127.0) return vec4(-1.0, 999.0, 0.0, 0.0);
    float tc = c - floor(gCols * 0.5) + 128.0;
    return IMG_NORM_PIXEL(cells, (vec2(tc, r) + 0.5) / vec2(256.0, 128.0));
}

// How long (in cells) the drip of column c is, for a hit numbered e that
// happened a seconds ago.
float dripLen(float c, float e, float a) {
    if (e < 0.5 || a > 8.0) return 0.0;
    if (hash21(vec2(c * 0.731, e * 1.37 + gSeed)) > melt * 0.9 + 0.02) return 0.0;
    float speed = mix(0.5, 1.6, hash21(vec2(c, e + 3.7))) * mix(0.4, 1.4, flow);
    float delay = hash21(vec2(c + 7.1, e)) * 0.08;
    float aa = max(a - delay, 0.0);
    float L = gRows * speed * (0.35 * aa + 2.2 * aa * aa);
    // Re-form: the drip draws back up.
    float hold = mix(0.12, 0.8, reform);
    float back = smoothstep(hold, hold + 0.14, a);
    L *= 1.0 - back;
    return L;
}

void main() {
    float n = floor(vxCount + 0.5);
    float rs = floor(clamp(seed, 0.0, 1.0) * 127.0 + 0.5);

    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    gRows = floor(mix(110.0, 34.0, pow(clamp(pixels, 0.0, 1.0), 0.8)));
    gCols = min(floor(gRows * aspect), 256.0);
    float era = floor(vxBars / 4.0);
    gKind = picture == 0 ? mod(floor(hash11(era * 1.37 + rs) * 2.0) + era, 2.0) : float(picture - 1);
    gSeed = rs * 0.731 + (picture == 0 ? era * 3.17 : 0.0);
    gT = vxPhase;
    gFloor = floor(gRows * 0.1);


    if (PASSINDEX == 1) {
        float cx = floor(gl_FragCoord.x) - 128.0;
        float cy = floor(gl_FragCoord.y);
        float up = 999.0;
        float upTone = 0.0;
        for (int j = 1; j <= MAXL; j++) {
            float tj = picAt(cx, cy + float(j));
            if (tj >= 0.0) {
                up = float(j);
                upTone = tj;
                break;
            }
        }
        gl_FragColor = vec4(picAt(cx, cy), up, upTone, 1.0);
        return;
    }

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 0.0, 30.0, 0.0);
        bool newHit = abs(n - c.r) > 0.5;
        float stamp = newHit ? mod(TIME, 32.0) : c.g;
        float prev = newHit ? c.g : c.a;
        float since = newHit ? 0.0 : min(c.b + dt, 30.0);
        gl_FragColor = vec4(n, stamp, since, prev);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float now = mod(TIME, 32.0);
    float age0 = mod(now - clk.g + 32.0, 32.0);
    float age1 = mod(now - clk.a + 32.0, 32.0);
    if (clk.b > 8.0) { age0 = 30.0; age1 = 30.0; }
    if (age1 < age0) age1 = 30.0;
    float n1 = n - 1.0;

    float csz = RENDERSIZE.y / gRows;                    // cell size, pixels
    vec2 cellXY = gl_FragCoord.xy / csz;
    // Centre the grid sideways.
    cellXY.x -= (RENDERSIZE.x / csz - gCols) * 0.5;
    float c = floor(cellXY.x);
    float r = floor(cellXY.y);
    vec2 f = fract(cellXY);

    vec3 col = vec3(0.0);
    if (c < 0.0 || c >= gCols) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    // This column's drip, the larger of the last two hits'.
    float L = max(dripLen(c, n, age0), dripLen(c, n1, age1));
    // The column sags as it melts.
    float sag = floor(min(L, gRows * 0.3) * 0.12);

    float edgeTone = -1.0;
    float dist = 0.0;
    vec4 here = cellAt(c, r + sag);
    float tone = here.r;
    if (tone >= 0.0) {
        // The picture itself: tiles with a faint seam.
        float seam = step(0.92, max(f.x, f.y)) * 0.35;
        vec3 pc = mix(accent.rgb, ink.rgb, smoothstep(0.25, 0.85, tone));
        pc *= 0.55 + 0.45 * tone;
        col = pc * (1.0 - seam);
    } else if (L > 0.5 && r > gFloor + 0.5) {
        // Walk up to the nearest lower edge of the picture above.
        if (here.g <= L + 1.0) {
            edgeTone = here.b;
            dist = here.g;
        }
        if (edgeTone >= 0.0) {
            // The run below the edge stops at the floor.
            float maxRun = r + dist - gFloor - 1.0;
            float run = min(L, maxRun);
            float landed = step(maxRun, L);
            float k = dist / max(run, 1.0);
            float headRow = run;
            vec3 dc = mix(accent.rgb, ink.rgb, smoothstep(0.25, 0.85, edgeTone) * 0.7);
            if (dist <= headRow) {
                // Trail: thins with distance, in quarter-cell steps.
                float w = floor(mix(4.0, 2.0, smoothstep(0.0, 0.6, k)) + 0.5) / 4.0;
                float head = (1.0 - smoothstep(0.0, 1.5, headRow - dist)) * (1.0 - landed);
                w = max(w, head);
                float inside = step(abs(f.x - 0.5) * 2.0, w);
                vec3 tc = dc * mix(0.85, 0.5, k);
                tc = mix(tc, mix(dc, ink.rgb, 0.6) * 1.15, head);
                col = tc * inside;
            }
        }
    }

    // The floor: a dim line, with puddles where drips have landed.
    if (r <= gFloor + 0.5 && r >= gFloor - 1.5) {
        float pud = 0.0;
        vec3 pcol = vec3(0.0);
        for (int i = -SPREAD; i <= SPREAD; i++) {
            float cc = c + float(i);
            float Lc = max(dripLen(cc, n, age0), dripLen(cc, n1, age1));
            if (Lc < 1.0) continue;
            float sg = floor(min(Lc, gRows * 0.3) * 0.12);
            // The lowest edge of the picture in that column.
            vec4 lo = cellAt(cc, gFloor + sg);
            if (lo.g > 900.0) continue;
            float edge = gFloor + lo.g;
            float tE = lo.b;
            float over = Lc - (edge - gFloor);       // how far past the floor it has run
            if (over <= 0.0) continue;
            float wide = min(over * 0.35, float(SPREAD) + 0.5);
            float dx = abs(float(i)) + abs(f.x - 0.5) * 0.0;
            if (dx <= wide) {
                float a = 1.0 - dx / (wide + 1.0);
                if (a > pud) {
                    pud = a;
                    pcol = mix(accent.rgb, ink.rgb, smoothstep(0.25, 0.85, tE) * 0.5);
                }
            }
        }
        float rowK = r >= gFloor - 0.5 ? 1.0 : 0.45;
        if (pud > 0.0 && r > gFloor - 1.5) col = max(col, pcol * (0.35 + 0.65 * pud) * rowK);
        if (r == gFloor) col = max(col, accent.rgb * 0.12);
    }

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
