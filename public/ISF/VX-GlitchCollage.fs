/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A glitch collage. The voice paints its own picture and cuts the frame into a recursive layout of panels, each running a different glitch on it: displaced content, repeated tiles, duplicated scanlines, a two- or three-level crush, mirrored slabs, smeared fragments, barcode strips, or plain black. Every bar it composes a new collage and holds it; in between only the panels twitch on hits. Hairline seams keep it composed. Seed re-rolls the picture, the layout and which glitch goes where; Mutate recomposes on hits as well.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "complexity", "LABEL": "Complexity", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "operations", "LABEL": "Operations", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3], "LABELS": ["All of them", "Displace and repeat", "Crush and mirror", "Smear and code"] },
        { "NAME": "twitch", "LABEL": "Twitch", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "crush", "LABEL": "Crush", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "space", "LABEL": "Empty panels", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "seams", "LABEL": "Seams", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "mutate", "LABEL": "Mutate", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Picture", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Accent", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last count seen, seconds since the last hit, recent activity.
// genes (1x1): composition epoch, bumped by Mutate on hits.

const float TAU = 6.2831853;
// Splits snap to this modular grid.
const vec2 MODULE = vec2(24.0, 14.0);

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

float splitRatio(float h) {
    float i = floor(h * 5.0);
    if (i < 0.5) return 0.333;
    if (i < 1.5) return 0.382;
    if (i < 2.5) return 0.5;
    if (i < 3.5) return 0.618;
    return 0.667;
}

// The picture every panel works on: a glow, a ring, a block of type and a
// ramped bar. q in frame-height units, origin in the middle; w one stored
// pixel. Returns light, and how much of it is accent.
vec2 picture(vec2 q, float ps, float t, float w) {
    float v = 0.0;
    float a = 0.0;
    // A soft body of light.
    vec2 c = vec2((hash11(ps + 1.0) - 0.5) * 0.6 + sin(t * 0.2) * 0.04, (hash11(ps + 2.0) - 0.5) * 0.3);
    float r = mix(0.28, 0.45, hash11(ps + 3.0));
    float d = length(q - c);
    v = max(v, exp(-d * d / (r * r * 0.6)) * 0.55);
    // A ring around it.
    float rr = r * mix(1.1, 1.5, hash11(ps + 4.0));
    v = max(v, clamp(1.0 - abs(d - rr) / (w * 1.5), 0.0, 1.0) * 0.9);
    // A block of type.
    vec2 to = vec2((hash11(ps + 5.0) - 0.5) * 0.8 - 0.3, (hash11(ps + 6.0) - 0.5) * 0.5);
    float lineH = mix(0.03, 0.05, hash11(ps + 7.0));
    float row = floor((to.y - q.y) / lineH);
    float fy = (to.y - q.y) / lineH - row;
    float tx = q.x - to.x;
    if (row >= 0.0 && row < 6.0 && tx >= 0.0) {
        float cellW = lineH * 0.42;
        float cell = floor(tx / cellW);
        float len = mix(0.3, 0.7, hash11(row * 3.1 + ps));
        float on = (tx < len && hash21(vec2(cell, row + ps)) > 0.2 && fy > 0.2 && fy < 0.62) ? 1.0 : 0.0;
        v = max(v, on * mix(0.5, 1.0, hash21(vec2(floor(cell / 5.0), row + ps))));
    }
    // A field of fine horizontal rules across one side.
    float side = hash11(ps + 13.0) < 0.5 ? -1.0 : 1.0;
    float fx = q.x * side;
    if (fx > 0.1 && fx < 0.85 && abs(q.y + (hash11(ps + 14.0) - 0.5) * 0.3) < 0.3) {
        float pitch = mix(0.012, 0.022, hash11(ps + 15.0));
        float k = floor(q.y / pitch);
        float lineLen = mix(0.35, 0.85, hash11(k * 1.3 + ps));
        float on = step(fx, lineLen) * clamp(1.0 - abs(fract(q.y / pitch) - 0.5) * pitch / w, 0.0, 1.0);
        v = max(v, on * mix(0.25, 0.7, hash11(k + ps * 2.0)));
    }
    // A ramped bar, sometimes in the accent.
    vec2 bc = vec2((hash11(ps + 8.0) - 0.5) * 1.0, (hash11(ps + 9.0) - 0.5) * 0.7);
    vec2 bb = vec2(mix(0.12, 0.3, hash11(ps + 10.0)), mix(0.01, 0.025, hash11(ps + 11.0)));
    float inBar = clamp(0.5 - sdBox(q - bc, bb) / w, 0.0, 1.0);
    float ramp = clamp(0.5 + 0.5 * (q.x - bc.x) / bb.x, 0.0, 1.0);
    if (inBar * ramp > v) {
        v = inBar * ramp;
        a = hash11(ps + 12.0) < 0.4 ? inBar : 0.0;
    }
    return vec2(v, a);
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
        if (FRAMEINDEX >= 2 && abs(n - g.b) > 0.5 && hash11(n * 3.71 + rs * 0.37 + 1.3) < mutate * 0.5) {
            g.r = mod(g.r + 1.0, 256.0);
        }
        gl_FragColor = vec4(g.r, 0.0, n, 1.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    vec4 gen = IMG_NORM_PIXEL(genes, vec2(0.5));
    float bars = floor(vxBars + 0.5);
    float ls = rs * 1.618 + bars * 3.73 + gen.r * 11.9;   // this collage
    float ps = rs * 2.414 + floor(bars / 4.0) * 5.3;       // the picture changes more slowly

    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.5));
    float w = max(fw.x, fw.y) / RENDERSIZE.y;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    // Layout: recursive splits on a modular grid.
    float depthMax = 2.0 + floor(clamp(complexity, 0.0, 1.0) * 4.0 + 0.5);
    vec4 rect = vec4(0.0, 0.0, 1.0, 1.0);
    float id = 1.0;
    for (int i = 0; i < 6; i++) {
        if (float(i) >= depthMax) break;
        float h1 = hash21(vec2(id, ls * 1.37 + 0.5));
        float h2 = hash21(vec2(id * 1.7 + 3.1, ls + 11.0));
        float h3 = hash21(vec2(id * 2.3 + 7.9, ls * 0.71 + 5.0));
        if (i >= 2 && h2 < 0.25) break;
        vec2 size = (rect.zw - rect.xy) * RENDERSIZE;
        bool cutX = size.x > size.y ? h1 < 0.75 : h1 < 0.25;
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

    // Which glitch this panel runs, from the chosen pool.
    float hOp = hash21(vec2(id * 0.913, ls + 21.0));
    float op;
    if (hOp < space * 0.6) op = -1.0;
    else {
        float r = hash21(vec2(id * 1.31, ls + 22.0));
        if (operations == 1) op = floor(r * 3.0);                  // displace, tiles, scanlines
        else if (operations == 2) op = 3.0 + floor(r * 2.0);       // crush, mirror
        else if (operations == 3) op = 5.0 + floor(r * 2.0);       // smear, barcode
        else op = floor(r * 7.0);
        // Now and then a panel shows the picture as it is, to anchor the rest.
        if (hash21(vec2(id * 2.71, ls + 23.0)) < 0.12) op = 7.0;
    }

    // Twitch: hits jolt some panels, which settle back in a moment.
    float jolt = 0.0;
    if (n > 0.5 && hash21(vec2(id * 1.77, n * 0.917 + rs)) < twitch * 0.6) jolt = exp(-clk.g / 0.12);
    float jr = hash21(vec2(id * 3.3, n + 7.0)) - 0.5;

    vec2 rc = 0.5 * (rect.xy + rect.zw);
    vec2 rsz = rect.zw - rect.xy;
    vec2 local = (uv - rect.xy) / rsz;
    vec2 p = uv;
    float hA = hash21(vec2(id, ls + 31.0));
    float hB = hash21(vec2(id, ls + 32.0));
    float levels = 0.0;
    float barcode = 0.0;
    if (op > -0.5 && op < 0.5) {
        // Displaced content: the panel shows the picture from somewhere else.
        p = uv + (vec2(hA, hB) - 0.5) * vec2(0.6, 0.4) + vec2(jr * 0.08 * jolt, 0.0);
    } else if (op < 1.5) {
        // Repeated tiles of one small patch.
        vec2 tile = rsz / (2.0 + floor(hA * 4.0));
        vec2 from = rc + (vec2(hA, hB) - 0.5) * 0.3;
        p = from + mod(uv - rect.xy + vec2(jr * jolt * 0.05, 0.0), tile) - 0.5 * tile;
    } else if (op < 2.5) {
        // Scanline duplication: a few rows stretched down the panel.
        float k = mix(0.008, 0.06, hA) * (1.0 + jolt * 2.0);
        p = vec2(uv.x, rect.y + floor((uv.y - rect.y) / k) * k + hB * 0.05);
    } else if (op < 3.5) {
        // Bit-depth crush to two or three levels.
        levels = 2.0 + floor(hA * 2.0 * (1.0 - crush * 0.6) + 0.3);
        p = uv + vec2(jr * jolt * 0.04, 0.0);
    } else if (op < 4.5) {
        // A mirrored slab.
        if (hA < 0.5) p = vec2(rc.x - abs(uv.x - rc.x) + jr * jolt * 0.04, uv.y);
        else p = vec2(uv.x, rc.y - abs(uv.y - rc.y));
        p += (vec2(hB, hA) - 0.5) * 0.2;
    } else if (op < 5.5) {
        // A smeared fragment: content dragged out from one edge.
        float edge = mix(0.12, 0.35, hA) + jolt * 0.1 * jr;
        if (hB < 0.5) p = vec2(rect.x + min(local.x, edge) * rsz.x, uv.y);
        else p = vec2(uv.x, rect.w - min(1.0 - local.y, edge) * rsz.y);
    } else if (op < 6.5) {
        // Barcode: the picture's light read along one row, as bars.
        barcode = 1.0;
    }

    vec2 q = (p - 0.5) * vec2(aspect, 1.0);
    vec2 pic = picture(q, ps, vxPhase, w);
    float v = pic.x;
    float acc = pic.y;
    if (op < -0.5) {
        v = 0.0;
        acc = 0.0;
    }
    if (levels > 0.5) {
        // Ordered dither between the levels keeps the gradients readable.
        vec2 cellPx = floor(gl_FragCoord.xy / fw);
        float bayer = mod(cellPx.x + 2.0 * cellPx.y, 4.0) / 4.0 + mod(cellPx.y, 2.0) * 0.125;
        v = floor(v * (levels - 1.0) + bayer * crush) / (levels - 1.0);
        acc = hash21(vec2(id, ls + 40.0)) < 0.3 ? step(0.5, v) : 0.0;
    }
    if (barcode > 0.5) {
        float px = floor((uv.x - rect.x) * RENDERSIZE.x / fw.x / 2.0);
        float yRow = rect.y + rsz.y * hA;
        vec2 qq = (vec2(rect.x + px * 2.0 * fw.x / RENDERSIZE.x, yRow) - 0.5) * vec2(aspect, 1.0);
        float lv = picture(qq, ps, vxPhase, w).x;
        float bit = step(0.3 + 0.4 * hash11(px * 0.37 + n * jolt), lv + 0.25 * hash11(px + ls));
        v = bit * mix(0.5, 0.9, hB) * step(0.12, local.y) * step(local.y, 0.88);
        acc = 0.0;
    }

    vec3 col = mix(ink.rgb * v, accent.rgb * v, acc);
    // A twitching panel brightens a touch.
    col *= 1.0 + 0.25 * jolt;

    // Hairline seams between panels.
    vec2 dPx = min(uv - rect.xy, rect.zw - uv) * RENDERSIZE / fw;
    float seam = (min(dPx.x, dPx.y) < 1.0 && op > -0.5) ? 1.0 : 0.0;
    col = max(col, ink.rgb * seam * seams * 0.3);

    float rest = mix(0.55, 1.0, clk.b);
    col *= rest;
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
