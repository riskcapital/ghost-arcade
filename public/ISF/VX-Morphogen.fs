/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Two chemicals feeding on each other across a sheet, shown as a carved relief in matte porcelain under a hard raking light: the pattern they settle into, spots, worms, stripes and mazes, stands up in stepped terraces that throw shadows and catch a fine bright edge. The sound's level shifts the chemistry, so the pattern changes its kind as the music rises and falls; each hit wipes a round patch smooth and stamps a seed in it, a ring, a line or a cluster, that grows back into the pattern, in the accent color while it is young; the sound's motion walks the light slowly round. A few seeds are always being sown, so the sheet never empties.",
    "PASSES": [
        { "TARGET": "simA", "PERSISTENT": true, "FLOAT": true, "WIDTH": 512, "HEIGHT": 288 },
        { "TARGET": "simB", "PERSISTENT": true, "FLOAT": true, "WIDTH": 512, "HEIGHT": 288 },
        { "TARGET": "simA", "PERSISTENT": true, "FLOAT": true, "WIDTH": 512, "HEIGHT": 288 },
        { "TARGET": "simB", "PERSISTENT": true, "FLOAT": true, "WIDTH": 512, "HEIGHT": 288 },
        { "TARGET": "simA", "PERSISTENT": true, "FLOAT": true, "WIDTH": 512, "HEIGHT": 288 },
        { "TARGET": "simB", "PERSISTENT": true, "FLOAT": true, "WIDTH": 512, "HEIGHT": 288 },
        { "TARGET": "simA", "PERSISTENT": true, "FLOAT": true, "WIDTH": 512, "HEIGHT": 288 },
        { "TARGET": "simB", "PERSISTENT": true, "FLOAT": true, "WIDTH": 512, "HEIGHT": 288 },
        { "TARGET": "simClock", "PERSISTENT": true, "FLOAT": true, "WIDTH": 1, "HEIGHT": 1 },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "scale", "LABEL": "Scale", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "regime", "LABEL": "Regime", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "relief", "LABEL": "Relief depth", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "lightAngle", "LABEL": "Light angle", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Porcelain", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Young growth", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The sheet the chemicals live on, in cells. Each cell keeps (how much food is used up, how much of
// the feeder there is, how young the growth there is). The sheet wraps round at its edges.
const vec2 GRID = vec2(512.0, 288.0);
// Eight steps of the chemistry can run in a frame, one per pass, each reading what the last one wrote.
// How many do run is set by the time since the sheet was last stepped, kept in the clock target, so the
// pattern grows at the same speed whatever the frame rate and however late the sheet is read back.
const float STEPS_MAX = 8.0;

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

float noise2(vec2 q) {
    vec2 i = floor(q);
    vec2 f = fract(q);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

// The sheet at a cell, from whichever of its two copies was written last.
vec4 cellAt(vec2 c, bool fromB) {
    vec2 q = fract((c + 0.5) / GRID);
    if (fromB) return IMG_NORM_PIXEL(simB, q);
    return IMG_NORM_PIXEL(simA, q);
}

// The way from one cell to another, the short way round the wrapping sheet.
vec2 wrapTo(vec2 d) {
    return d - GRID * floor(d / GRID + 0.5);
}

// The feed and kill rates at a place: they set which kind of pattern grows there. The level of the
// sound moves them along a path from spots through worms and stripes to mazes, and they differ a
// little from region to region, so several kinds stand side by side.
vec2 chemistry(vec2 c) {
    float sw = clamp(vxSwell, 0.0, 1.0);
    float place = noise2(c / GRID * vec2(3.2, 1.8) + vec2(vxFlow * 0.011, 4.0));
    float s = clamp(regime * 0.75 + sw * 0.4 + (place - 0.5) * 1.1, 0.0, 1.0);
    vec2 p0 = vec2(0.0300, 0.0620);
    vec2 p1 = vec2(0.0370, 0.0600);
    vec2 p2 = vec2(0.0545, 0.0620);
    vec2 p3 = vec2(0.0390, 0.0580);
    if (s < 0.3333) return mix(p0, p1, s * 3.0);
    if (s < 0.6667) return mix(p1, p2, s * 3.0 - 1.0);
    return mix(p2, p3, s * 3.0 - 2.0);
}

// The sheet as it starts: patches of a rough maze with smooth ground between, so there is a picture
// from the first frame and room for it to grow.
vec4 firstSheet(vec2 c) {
    float w = 0.0;
    for (int i = 0; i < 6; i++) {
        float a = float(i) * 0.5236 + 0.3 * hash11(float(i) * 3.1 + 0.7);
        w += cos(dot(c, vec2(cos(a), sin(a))) * 0.6 + 6.2832 * hash11(float(i) * 5.3 + 1.9));
    }
    float patches = smoothstep(0.42, 0.55, noise2(c / GRID * vec2(7.0, 4.0) + 2.0));
    float v = step(1.1, w) * patches;
    return vec4(0.5 * v, 0.3 * v, 0.0, 1.0);
}

// The feeder at a point between cells, smoothed so the relief has no facets.
vec3 smoothAt(vec2 uv) {
    vec2 st = uv * GRID - 0.5;
    vec2 i = floor(st);
    vec2 f = st - i;
    vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
    vec2 w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
    vec2 w3 = f * f * f / 6.0;
    vec2 w2 = 1.0 - w0 - w1 - w3;
    vec2 g0 = w0 + w1;
    vec2 g1 = w2 + w3;
    vec2 h0 = (i - 0.5 + w1 / g0 + 0.5) / GRID;
    vec2 h1 = (i + 1.5 + w3 / g1 + 0.5) / GRID;
    vec3 a = IMG_NORM_PIXEL(simB, fract(vec2(h0.x, h0.y))).gbr * g0.x * g0.y;
    a += IMG_NORM_PIXEL(simB, fract(vec2(h1.x, h0.y))).gbr * g1.x * g0.y;
    a += IMG_NORM_PIXEL(simB, fract(vec2(h0.x, h1.y))).gbr * g0.x * g1.y;
    a += IMG_NORM_PIXEL(simB, fract(vec2(h1.x, h1.y))).gbr * g1.x * g1.y;
    return a;
}

// The height of the relief for an amount of the feeder: three steps, each with a soft crown.
float heightOf(float v) {
    return (smoothstep(0.085, 0.115, v) + smoothstep(0.17, 0.2, v) + smoothstep(0.25, 0.28, v)) * 0.3 + 0.3 * v;
}

void main() {
    float n = floor(vxCount + 0.5);
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);

    if (PASSINDEX < 8) {
        vec2 c = floor(gl_FragCoord.xy);
        bool fromB = mod(float(PASSINDEX), 2.0) < 0.5;
        vec4 ck = IMG_NORM_PIXEL(simClock, vec2(0.5));
        bool fresh = ck.b < 0.5 || FRAMEINDEX < 1;
        if (fresh) {
            // The first frame: the first pass lays the sheet out and the rest hand it on.
            gl_FragColor = PASSINDEX == 0 ? firstSheet(c) : cellAt(c, fromB);
            return;
        }
        // Steps owed since the sheet was last stepped: quick while the sound plays, slow at rest.
        float owed = fract(TIME - ck.r + 1.0) * mix(36.0, 190.0, max(sw, pu));
        float steps = clamp(floor(owed + 0.5), 1.0, STEPS_MAX);
        vec4 s = cellAt(c, fromB);
        if (float(PASSINDEX) >= steps) {
            gl_FragColor = s;
            return;
        }
        // One step: both chemicals spread, the feeder eats the food and breeds, food is fed in, feeder dies off.
        vec4 lap = (cellAt(c + vec2(1.0, 0.0), fromB) + cellAt(c - vec2(1.0, 0.0), fromB)
                  + cellAt(c + vec2(0.0, 1.0), fromB) + cellAt(c - vec2(0.0, 1.0), fromB)) * 0.2
                 + (cellAt(c + vec2(1.0, 1.0), fromB) + cellAt(c + vec2(-1.0, 1.0), fromB)
                  + cellAt(c + vec2(1.0, -1.0), fromB) + cellAt(c - vec2(1.0, 1.0), fromB)) * 0.05 - s;
        vec2 fk = chemistry(c);
        float spread = mix(0.45, 1.0, scale);
        float used = s.r;
        float v = s.g;
        float eat = (1.0 - used) * v * v;
        used = clamp(used + spread * lap.r + eat - fk.x * used, 0.0, 1.0);
        v = clamp(v + 0.5 * spread * lap.g + eat - (fk.x + fk.y) * v, 0.0, 1.0);
        float age = max(s.b - 1.0 / 700.0, 0.0);

        if (PASSINDEX == 0) {
            // A hit: a round patch is wiped smooth and a seed stamped in it.
            if (n > 0.5 && abs(n - ck.g) > 0.5) {
                vec2 at = vec2(hash11(n * 3.71 + 0.3), hash11(n * 7.13 + 1.9)) * GRID;
                float rad = mix(24.0, 40.0, hash11(n * 1.37 + 5.0));
                vec2 dv = wrapTo(c - at);
                float dist = length(dv);
                float wipe = smoothstep(rad, rad - 3.0, dist);
                float kind = floor(hash11(n * 9.31 + 2.2) * 3.0);
                float seed;
                if (kind < 0.5) {
                    seed = step(abs(dist - rad * 0.5), 1.7);
                } else if (kind < 1.5) {
                    float a = hash11(n * 4.4 + 7.0) * 3.1416;
                    vec2 dir = vec2(cos(a), sin(a));
                    seed = step(abs(dot(dv, vec2(-dir.y, dir.x))), 1.6) * step(abs(dot(dv, dir)), rad * 0.72);
                } else {
                    seed = 0.0;
                    for (int i = 0; i < 6; i++) {
                        float fi = float(i);
                        vec2 o = (vec2(hash11(n * 2.3 + fi * 5.1), hash11(n * 6.7 + fi * 3.3)) - 0.5) * rad * 1.3;
                        seed = max(seed, step(length(dv - o), 2.3));
                    }
                }
                used = mix(used, 0.5 * seed, wipe);
                v = mix(v, 0.32 * seed, wipe);
                age = max(age, wipe);
            }
            // Gentle re-seeding: four times a second a few places are picked, the same for every copy of
            // the sheet, and a speck of the feeder is sown wherever one of them is still smooth.
            vec2 blk = floor(c / 8.0);
            float epoch = floor(TIME * 4.0);
            if (hash21(blk + vec2(epoch * 0.37, epoch * 1.71)) < 0.0012 && used < 0.12) {
                float speck = step(length(c - blk * 8.0 - 4.0), 2.3);
                used = max(used, 0.5 * speck);
                v = max(v, 0.32 * speck);
            }
        }
        gl_FragColor = vec4(used, v, age, 1.0);
        return;
    }
    if (PASSINDEX == 8) {
        gl_FragColor = vec4(fract(TIME), n, 1.0, 1.0);
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    // The sheet fills the picture; on a picture of another shape it is cropped, not stretched.
    float fit = asp / (GRID.x / GRID.y);
    vec2 suv = vec2(0.5) + (uv - 0.5) * (fit > 1.0 ? vec2(1.0, 1.0 / fit) : vec2(fit, 1.0));
    vec2 cellPx = GRID / RENDERSIZE.xy * (fit > 1.0 ? vec2(1.0, 1.0 / fit) : vec2(fit, 1.0));

    // The relief and its slope.
    vec3 here = smoothAt(suv);
    float h0 = heightOf(here.x);
    vec2 e = vec2(0.6, 0.0) / GRID;
    float hx = heightOf(smoothAt(suv + e.xy).x) - heightOf(smoothAt(suv - e.xy).x);
    float hy = heightOf(smoothAt(suv + e.yx).x) - heightOf(smoothAt(suv - e.yx).x);
    float depth = mix(1.2, 5.5, relief);
    vec3 nor = normalize(vec3(-vec2(hx, hy) * depth / 1.2, 1.0));

    // The light: low over the sheet, walking slowly round with the sound's motion.
    float az = lightAngle * 6.2832 + vxFlow * 0.07 + TIME * 0.01;
    float el = 0.38;
    vec2 ld = vec2(cos(az), sin(az));
    vec3 L = vec3(ld * cos(el), sin(el));

    // The shadow the relief throws on itself: a walk from the point toward the light.
    float shade = 1.0;
    float rise = tan(el) / depth;
    for (int i = 1; i <= 10; i++) {
        float t = float(i) * 0.9;
        float hq = heightOf(IMG_NORM_PIXEL(simB, fract(suv + ld * t / GRID)).g);
        shade = min(shade, 1.0 - smoothstep(0.0, 0.07, hq - h0 - rise * t));
    }

    float diff = max(dot(nor, L), 0.0);
    float amb = 0.07 + 0.05 * h0;
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(nor, H), 0.0), 70.0) * (0.3 + 0.7 * shade);
    float key = 1.35 * (0.6 + 0.4 * sw);
    // A pool of light: the sheet dims toward its edges.
    vec2 vg = uv - 0.5;
    float pool = 1.0 - 0.55 * dot(vg, vg) * 2.0;

    // The ground between the raised parts is left dark and unglazed.
    vec3 body = ink.rgb * mix(0.17, 0.66, smoothstep(0.05, 0.14, here.x));
    // Young growth takes the accent color on its raised parts.
    float young = clamp(here.y, 0.0, 1.0) * smoothstep(0.06, 0.2, here.x);
    body = mix(body, accent.rgb * 0.7, young * 0.85);
    vec3 col = body * (diff * shade * key + amb) + (vec3(1.0) * 0.55 + ink.rgb * 0.2) * spec * key;
    col *= pool;

    // Tone map on the brightest channel so the colors hold, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // The raised pattern is solid; the smooth ground between lets what is under it show.
        outa = clamp(max(smoothstep(0.03, 0.2, h0), max(max(col.r, col.g), col.b) * 1.2), 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
