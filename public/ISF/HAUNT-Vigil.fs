/*{
    "DESCRIPTION": "A vigil. Rows of candles standing in the dark, receding, each flame its own: a blue root, a bright body, a soft halo, and the constant small tremble of a real flame. Now and then something passes. A draught crosses the room, the flames lean one after another, some go out and leave a thread of smoke, and after a while they are alight again. Nobody is seen. Seven flames, from tallow to the blue corpse-candle of the marshes. Bass lifts the flames, beats send the draught, spectral centroid sets how restless they are.",
    "CREDIT": "Ghost Arcade Halloween pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Tallow", "Corpse Candle", "Witchfire", "Blood Wax", "Church White", "Violet Hour", "Dying Embers"]},
        {"NAME": "candles",   "TYPE": "float", "DEFAULT": 6.00, "MIN": 2.00, "MAX": 24.0},
        {"NAME": "rows",      "TYPE": "long",  "DEFAULT": 5, "VALUES": [1, 2, 3, 4, 5, 6], "LABELS": ["1", "2", "3", "4", "5", "6"]},
        {"NAME": "flameSize", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.20, "MAX": 1.00},
        {"NAME": "tremble",   "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "draught",   "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "draughtRate","TYPE": "float", "DEFAULT": 0.30, "MIN": 0.05, "MAX": 2.00},
        {"NAME": "snuffing",  "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "halo",      "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "depthHaze", "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "scatter",   "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "wax",       "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "horizon",   "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.10, "MAX": 0.80},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * A candle flame is a teardrop: round at the bottom where the wick is,
 * drawn to a point above by the rising hot air. It has a dim blue root
 * where the wax vapour burns clean, a bright body, and a glow much wider
 * than the flame itself.
 *
 * Every candle lives in its own slot along its row, so a pixel only looks at
 * the candle in its slot and the ones either side, and a row costs the same
 * however many candles it holds.
 *
 * The draught is a front that travels across the room. A flame's distance
 * behind the front decides whether it is leaning, out, smoking or relit, so
 * the whole event needs no memory.
 */

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float w = 0.5;
    for (int i = 0; i < 3; i++) {
        v += w * noise2(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(3.1, 7.7);
        w *= 0.5;
    }
    return v;
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

vec3 saturate3(vec3 c, float amount) {
    float g = dot(c, vec3(0.299, 0.587, 0.114));
    return max(mix(vec3(g), c, amount), 0.0);
}


/* Columns: [flame body, root, halo]. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Corpse Candle */
        a = vec3(0.70, 0.90, 1.00); b = vec3(0.10, 0.30, 1.00); c = vec3(0.20, 0.46, 0.90);
    } else if (mode == 2) {     /* Witchfire */
        a = vec3(0.70, 1.00, 0.60); b = vec3(0.04, 0.60, 0.40); c = vec3(0.16, 0.76, 0.26);
    } else if (mode == 3) {     /* Blood Wax */
        a = vec3(1.00, 0.56, 0.36); b = vec3(0.50, 0.04, 0.10); c = vec3(0.90, 0.12, 0.08);
    } else if (mode == 4) {     /* Church White */
        a = vec3(1.00, 0.96, 0.88); b = vec3(0.30, 0.44, 1.00); c = vec3(1.00, 0.84, 0.62);
    } else if (mode == 5) {     /* Violet Hour */
        a = vec3(0.94, 0.80, 1.00); b = vec3(0.30, 0.10, 0.90); c = vec3(0.60, 0.26, 0.96);
    } else if (mode == 6) {     /* Dying Embers */
        a = vec3(1.00, 0.50, 0.16); b = vec3(0.50, 0.06, 0.02); c = vec3(0.80, 0.16, 0.03);
    } else {                    /* Tallow */
        a = vec3(1.00, 0.84, 0.50); b = vec3(0.16, 0.30, 1.00); c = vec3(1.00, 0.52, 0.14);
    }
    return mat3(a, b, c);
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    mat3 pal = paletteFor(int(colorMode));
    vec3 BODY = hueRotate(pal[0], hueShift);
    vec3 ROOT = hueRotate(pal[1], hueShift);
    vec3 HALO = hueRotate(pal[2], hueShift);

    int nRows = int(rows);
    vec3 col = vec3(0.004, 0.003, 0.004);
    vec3 glowSum = vec3(0.0);

    /* The draught front: sweeps across, with a pause between passes. */
    float pass = TIME * draughtRate * 0.25 + beat * 0.08;
    float passId = floor(pass);
    float passPhase = fract(pass);
    float fromLeft = hash21(vec2(passId, 3.0)) < 0.5 ? 1.0 : -1.0;
    float frontX = fromLeft * (passPhase * 3.2 - 0.7) * aspect;

    /* Far rows first, so near flames sit over them. */
    for (int rI = 0; rI < 6; rI++) {
        if (rI >= nRows) break;
        float fr = float(rI);
        float depth = nRows > 1 ? 1.0 - fr / float(nRows - 1) : 0.0;     /* 1 far .. 0 near */
        float sc = mix(1.0, 0.24, depth);                                /* size at this distance */
        float baseY = mix(-0.38, horizon - 0.5, pow(depth, 0.8));
        float perRow = candles * mix(1.0, 1.7, depth);
        float slot = aspect * 1.08 / perRow;
        float fog = 1.0 - depthHaze * 0.72 * depth;

        float cell = floor(uv.x / slot);
        for (int dc = -1; dc <= 1; dc++) {
            float c = cell + float(dc);
            vec2 seedV = vec2(c, fr * 17.0 + 4.0);
            float h1 = hash21(seedV);
            float cx = (c + 0.5 + (h1 - 0.5) * 0.8 * scatter) * slot;
            float tallness = 0.6 + 0.8 * hash21(seedV + 5.0) * scatter;
            float wickY = baseY + 0.06 * sc * tallness;

            /* Where this candle is relative to the draught. */
            float behind = (frontX - cx) * fromLeft;                     /* > 0 once the front has passed */
            float gust = exp(-pow((behind - 0.08) / 0.16, 2.0)) * draught;
            float goesOut = step(1.0 - snuffing * 0.7, hash21(seedV + passId * 1.3 + 9.0));
            float dark = goesOut * smoothstep(0.02, 0.10, behind) * (1.0 - smoothstep(0.9, 1.5, behind));
            float alive = 1.0 - dark;

            /* The flame's own restlessness. */
            float tt = TIME * (5.0 + 5.0 * h1) + h1 * 40.0;
            float jitter = (noise2(vec2(tt, c)) - 0.5) * tremble * (0.5 + centroid);
            float stretch = 1.0 + 0.30 * jitter + 0.25 * (bass - 0.25);
            float lean = fromLeft * gust * 0.9 + jitter * 0.35;

            vec2 q = (uv - vec2(cx, wickY)) / (0.055 * sc * (0.6 + 0.8 * flameSize));
            q.x -= lean * max(q.y, 0.0) * 0.55;
            q.y /= stretch * (1.0 - 0.35 * gust);
            /* Teardrop: a circle whose radius shrinks with height. */
            float up = clamp(q.y, -0.5, 2.2);
            float width = 0.30 * pow(max(1.0 - up / 2.2, 0.0), 0.72) * smoothstep(-0.5, 0.2, up + 0.3);
            float d = abs(q.x) - width;
            float inFlame = (1.0 - smoothstep(-0.16, 0.05, d)) * smoothstep(-0.46, -0.30, q.y) * (1.0 - smoothstep(1.5, 2.2, q.y) * 0.75);
            float core = exp(-q.x * q.x * 14.0) * smoothstep(-0.2, 0.5, q.y) * (1.0 - smoothstep(1.0, 2.1, q.y));
            float root = exp(-pow((q.y + 0.15) / 0.28, 2.0)) * (1.0 - smoothstep(0.0, 0.34, abs(q.x)));

            vec3 flame = BODY * (0.40 * inFlame + 1.35 * core * inFlame) + ROOT * root * 1.1 * inFlame;
            flame = mix(flame, vec3(1.0), 0.55 * core * inFlame);
            col = mix(col, flame * fog, clamp(inFlame, 0.0, 1.0) * alive);

            /* Halo: far wider than the flame. Summed, so a row glows together. */
            vec2 hp = (uv - vec2(cx, wickY + 0.035 * sc)) / (sc * 0.20);
            float glow = halo * 0.11 * exp(-dot(hp, hp)) + halo * 0.006 / (dot(hp, hp) + 0.03);
            glowSum += HALO * glow * alive * fog * (0.8 + 0.5 * level) * (1.0 + 0.25 * jitter);

            /* The candle: a stub of wax, lit from its own flame. */
            float waxW = 0.012 * sc;
            float inWax = step(abs(uv.x - cx), waxW) * step(uv.y, wickY - 0.004 * sc) * step(wickY - 0.16 * sc * tallness - 0.04 * sc, uv.y);
            float waxLight = exp(-(wickY - uv.y) / (0.09 * sc));
            col = mix(col, (vec3(0.30, 0.26, 0.20) * HALO * 1.6 * waxLight * alive + vec3(0.012)) * fog, inWax * wax);

            /* Smoke from a wick that has just gone out. */
            float sy = (uv.y - wickY) / (0.25 * sc);
            float thread = exp(-pow((uv.x - cx - 0.012 * sc * sin(sy * 9.0 + TIME * 2.0) * sy) / (0.004 * sc + 0.010 * sc * sy), 2.0));
            col += vec3(0.20, 0.20, 0.22) * thread * dark * smoothstep(0.0, 0.1, sy) * (1.0 - smoothstep(0.5, 1.0, sy)) * 0.45 * fog;
        }
    }

    col += glowSum;
    /* The floor catches a little of it. */
    col += glowSum * 0.25 * smoothstep(-0.2, -0.5, uv.y);

    col *= exposure;
    col = col / (1.0 + 0.20 * col);
    col *= 1.20;

    gl_FragColor = vec4(col, 1.0);
}
