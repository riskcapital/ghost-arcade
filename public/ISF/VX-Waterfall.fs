/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A true record of the last few seconds of the music, drawn as a waterfall plot: a stack of fine lines receding over a ruled floor, each one a slice of time lifted by what was sounding then, the nearer lines hiding the ones behind. A cursor line at the front writes the newest slice and the record slides steadily away behind it. Held sound leaves long ridges; each hit leaves its own shape, a sweep, a comb, a burst or a spike, as a crest in the accent color that travels off into the distance. With no sound the sheet flattens to quiet lines.",
    "PASSES": [
        { "TARGET": "record", "PERSISTENT": true, "FLOAT": true, "WIDTH": 256, "HEIGHT": 128 },
        { "TARGET": "clock", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "lines", "LABEL": "Lines", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "height", "LABEL": "Height", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "perspective", "LABEL": "Perspective", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "decay", "LABEL": "Decay", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lines", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Crests of the hits", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The record: one row per slice of time, newest in row 0, 256 values across. Each value keeps
// (level, how much of it a hit put there, the most any value in its row can be).
const float COLS = 256.0;
const float ROWS = 128.0;
// Slices written per second, whatever the frame rate. The clock target keeps the number of the last
// slice written, so the record scrolls by the right amount however late it is read back.
const float RATE = 16.0;
const int MAX_LINES = 120;

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
    return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

// What is sounding now, as a profile across the sheet: (level, the part of it the latest hit makes).
vec2 sounding(float u, float slice) {
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    float flow = vxFlow;
    float bin = floor(u * COLS);

    // Held sound: a low hump and six narrow peaks that drift and breathe, so they draw ridges down the record.
    float held = 0.55 * exp(-u / 0.06);
    for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float c = 0.1 + 0.155 * fi + 0.03 * sin(flow * (0.31 + 0.07 * fi) + fi * 2.1);
        float w = 0.006 + 0.012 * hash11(fi * 3.7 + 1.0);
        float a = (0.3 + 0.7 * noise1(flow * 0.55 + fi * 7.3)) * (1.0 - 0.09 * fi);
        float x = (u - c) / w;
        held += a / (1.0 + x * x);
    }
    held *= sw * 0.62;
    // A little grain on top, new in every slice.
    held += sw * 0.045 * hash21(vec2(bin, slice)) * (0.4 + held);

    // The hit: each one has its own shape and its own place, and dies away with the pulse.
    float shape = 0.0;
    if (n > 0.5 && pu > 0.001) {
        float kind = floor(hash11(n * 5.13 + 0.7) * 4.0);
        float x0 = hash11(n * 2.71 + 3.3);
        if (kind < 0.5) {
            // A broad lobe that sweeps down across the sheet as it fades.
            float c = 0.12 + 0.5 * x0 + 0.28 * pu;
            float x = (u - c) / 0.055;
            shape = exp(-x * x) * 1.15;
        } else if (kind < 1.5) {
            // A comb of evenly spaced peaks, the upper ones dying first.
            float f0 = 0.05 + 0.05 * x0;
            for (int k = 1; k <= 7; k++) {
                float fk = float(k);
                float x = (u - 0.04 - f0 * fk) / 0.0065;
                shape += exp(-x * x) * (1.0 - 0.1 * fk) * pow(pu, 0.35 * fk);
            }
            shape *= 1.25;
        } else if (kind < 2.5) {
            // A burst of noise across a band.
            float c = 0.2 + 0.6 * x0;
            float x = (u - c) / 0.1;
            shape = exp(-x * x * x * x) * (0.2 + 0.75 * hash21(vec2(floor(bin * 0.5) * 1.7, slice + 9.0)));
        } else {
            // One sharp spike on a low skirt.
            float x = (u - 0.1 - 0.8 * x0) / 0.007;
            shape = 1.5 / (1.0 + x * x) + 0.2 * exp(-abs(u - 0.1 - 0.8 * x0) / 0.08);
        }
        shape *= pu;
    }
    return vec2(held + shape, shape);
}

// The most any value written now can be.
float soundingMost() {
    return clamp(vxSwell, 0.0, 1.0) * 0.95 + clamp(vxPulse, 0.0, 1.0) * 1.75 + 0.01;
}

// A line of half-width w at distance d, through a pixel px across.
float lineCov(float d, float w, float px) {
    return min(clamp((w - abs(d)) / px + 0.5, 0.0, 1.0), 2.0 * w / px + 0.04);
}

void main() {
    float slice = mod(floor(TIME * RATE), 1024.0);

    if (PASSINDEX == 0) {
        // Scroll the record by as many slices as have passed since it was last written, and write the new ones.
        vec2 cell = floor(gl_FragCoord.xy);
        vec4 ck = IMG_NORM_PIXEL(clock, vec2(0.5));
        float k = mod(slice - ck.r + 1024.0, 1024.0);
        bool fresh = ck.g < 0.5 || FRAMEINDEX < 1;
        if (fresh) k = ROWS;
        k = min(k, ROWS);
        vec4 v;
        if (cell.y < k) {
            float u = (cell.x + 0.5) / COLS;
            vec2 now = sounding(u, slice);
            v = vec4(now.x, now.y, soundingMost(), 1.0);
            if (fresh) {
                v = vec4(0.0, 0.0, 0.01, 1.0);
            } else if (k > 1.5) {
                // Several slices at once: they run from what was last written to what is sounding now.
                vec4 last = IMG_NORM_PIXEL(record, vec2(u, 0.5 / ROWS));
                v = mix(v, last, (cell.y + 0.5) / k);
            }
        } else {
            v = IMG_NORM_PIXEL(record, vec2((cell.x + 0.5) / COLS, (cell.y - k + 0.5) / ROWS));
        }
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX == 1) {
        gl_FragColor = vec4(slice, 1.0, 0.0, 1.0);
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    // The picture may be stored coarser than its nominal size: a pixel is never taken as finer than a stored one.
    vec2 fw = fwidth(gl_FragCoord.xy);
    float px = max(1.0, max(fw.x, fw.y)) / RENDERSIZE.y;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    // How far the newest slice has slid from the cursor line since it was written.
    float slid = fract(TIME * RATE);

    float count = floor(mix(60.0, float(MAX_LINES), lines) + 0.5);
    // The view: the cursor line near the bottom, the oldest line at yTop; depth runs from 1 to zFar.
    float zFar = mix(2.0, 5.5, perspective);
    float dz = (zFar - 1.0) / count;
    float yBot = -0.43;
    float yTop = mix(0.1, 0.3, perspective);
    float cam = (yTop - yBot) / (1.0 - 1.0 / zFar);
    float yHor = yBot + cam;
    float halfW = 0.5 * asp * 0.9;
    float amp = mix(0.12, 0.52, height);
    float fade = mix(0.0, 2.6, decay);

    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;
    vec3 ground = vec3(0.004, 0.0045, 0.006);
    vec3 col = vec3(0.0);
    float open = 1.0;
    float lw = max(0.6 * px, 0.0011);

    for (int j = 0; j < MAX_LINES; j++) {
        float fj = float(j);
        if (fj >= count) break;
        float s = fj + slid;
        float z = 1.0 + s * dz;
        float yBase = yHor - cam / z;
        float u = 0.5 + 0.5 * p.x * z / halfW;
        // Past the side of the sheet here, and so past it for every line farther back.
        if (abs(u - 0.5) > 0.5) break;
        float age = s / count;
        float gain = amp / z * exp(-age * fade);
        // The pixel is under this line's foot: its face hides everything behind.
        if (p.y < yBase - lw - px) {
            col += open * ground;
            open = 0.0;
            break;
        }
        float row = (fj + 0.5) / ROWS;
        vec4 a = IMG_NORM_PIXEL(record, vec2(u, row));
        // This slice cannot reach up to the pixel: look at the next one back.
        if (p.y > yBase + gain * a.b + lw + px) continue;
        float ridge = yBase + gain * a.r;
        float slope = 0.0;
        if (abs(p.y - ridge) < 0.04) {
            float du = px * z / (2.0 * halfW);
            slope = gain * (IMG_NORM_PIXEL(record, vec2(u + du, row)).r - a.r) / px;
        }
        float d = (p.y - ridge) / sqrt(1.0 + slope * slope);
        float stroke = lineCov(d, lw, px);
        float under = clamp(0.5 - d / px, 0.0, 1.0);

        // Nearer lines are brighter, and high ground brighter than low; the crest a hit left is in the accent color.
        float hitK = clamp(a.g / max(a.r, 0.05), 0.0, 1.0) * smoothstep(0.06, 0.3, a.g) * mix(1.0, 0.45, age);
        float b = (0.4 + 0.6 * sw) * mix(1.0, 0.32, age) * (0.5 + 0.9 * clamp(a.r, 0.0, 1.2));
        // The newest slices, just behind the cursor, are the brightest.
        b *= 1.0 + 0.9 * exp(-s / 2.5);
        vec3 lc = mix(inkC * b, accC * (0.5 + 0.9 * clamp(a.r, 0.0, 1.3)) * mix(1.15, 0.5, age), hitK);
        float below = max(-d, 0.0);
        vec3 face = ground + lc * (0.09 * exp(-below / 0.01) + 0.03 * exp(-below / 0.05));

        col += open * (lc * stroke * 1.3 + face * under * (1.0 - stroke));
        open *= 1.0 - max(under, stroke);
        if (open < 0.004) break;
    }

    // Whatever the sheet does not hide: the ruled floor it lies on, the cursor, and the scales along its edges.
    vec3 back = ground;
    float lvl = 0.45 + 0.55 * sw;
    if (p.y < yHor - 0.002) {
        // The floor, seen in the same perspective: lines running back at every eighth of the sheet,
        // and lines across at every fourth slice, sliding away with the record.
        float z = cam / (yHor - p.y);
        float xw = p.x * z / halfW;
        float s = (z - 1.0) / dz - slid;
        float fz = px * z * z / (cam * dz);
        float fx = px * z / halfW;
        float inPlot = step(abs(xw), 1.0);
        float reach = step(abs(xw), 1.5) * step(-10.0, s) * step(s, count + 6.0);
        float longW = abs(fract(xw * 4.0 + 0.5) - 0.5) / 4.0;
        float longL = lineCov(longW, 0.6 * fx, fx);
        float crossW = abs(fract((s + slid + mod(floor(TIME * RATE), 4.0)) / 4.0 + 0.5) - 0.5) * 4.0;
        float crossL = lineCov(crossW, 0.6 * fz, fz) * min(1.0, 0.35 / fz);
        float dim = exp(-max(z - 1.0, 0.0) * 0.5) * exp(-max(abs(xw) - 1.0, 0.0) * 3.0);
        back += inkC * 0.16 * lvl * reach * max(longL, crossL * 0.8) * dim * (1.0 - 0.45 * inPlot);
        // Scales: ticks standing out from both edges of the sheet, a longer one every fourth slice.
        float tick = lineCov(abs(fract(s + slid + 0.5) - 0.5), 0.5 * fz, fz) * step(0.0, s + slid) * step(s, count);
        float every4 = step(crossW, 0.5);
        float outX = abs(xw) - 1.0;
        back += inkC * 0.4 * lvl * tick * step(0.0, outX) * step(outX, 0.018 + 0.03 * every4) * exp(-max(z - 1.0, 0.0) * 0.35);
        // The front scale: ticks hanging under the cursor line, a longer one at every eighth of the sheet.
        float front = (1.0 - z) / dz;
        float tx = abs(fract(xw * 16.0 + 0.5) - 0.5) / 16.0;
        float long8 = step(abs(fract(xw * 4.0 + 0.5) - 0.5), 0.1);
        back += inkC * 0.45 * lvl * lineCov(tx, 0.6 * fx, fx) * inPlot * step(0.0, front) * step(front * dz, 0.012 + 0.018 * long8);
        // The cursor line, where the record is being written: it flares with each hit.
        float dc = (p.y - yBot) ;
        float cur = lineCov(dc, 1.1 * lw, px) * step(abs(xw), 1.03);
        back = mix(back, mix(inkC, accC, pu * 0.85) * (0.75 + 0.6 * pu) * (0.55 + 0.45 * sw), cur);
    }
    // A low glow on the horizon the far lines stand against.
    back += inkC * (0.012 + 0.03 * sw) * exp(-abs(p.y - yTop - 0.03) / 0.09) * exp(-abs(p.x) / (halfW * 0.6));
    col += open * back;

    // The view falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the lines keep their color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the light is solid: the dark ground lets what is under it show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
