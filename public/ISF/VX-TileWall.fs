/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A kinetic wall of square tiles, each one a flap that is dark on one side and pale on the other, lit softly from the upper left. Every hit turns a share of the tiles over, each flipping about its middle, and a few land on the accent color; the sound's level brightens the light on the wall. With no sound the wall is still, with a slow sheen moving across it.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "tiles", "LABEL": "Tiles", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "turnover", "LABEL": "Turn over", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "pale", "LABEL": "Pale side showing", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "accents", "LABEL": "Accent tiles", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Pale side", "TYPE": "color", "DEFAULT": [0.9, 0.88, 0.84, 1.0] },
        { "NAME": "accent", "LABEL": "Accent", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// How many hits back a tile looks for the one that last turned it.
const int LOOKBACK = 12;

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

// Hit m turns a tile over by chance; the tiles it turns lie in a few loose patches, not evenly.
bool turned(float m, vec2 tile, vec2 grid) {
    vec2 c = vec2(hash11(m * 2.31 + 0.7), hash11(m * 4.13 + 1.9)) * grid;
    float near = exp(-dot(tile - c, tile - c) / (grid.y * grid.y * 0.08));
    float p = mix(0.04, 0.5, turnover) * (0.35 + 1.6 * near);
    return hash21(tile + m * 17.31) < p;
}

// The hit that last turned a tile, up to hit n (a tile no recent hit turned keeps an old seed).
float tileSeed(vec2 tile, float n, vec2 grid) {
    for (int k = 0; k < LOOKBACK; k++) {
        float m = mod(n - float(k) + 64.0, 64.0);
        if (turned(m, tile, grid)) return m;
    }
    return 100.0;
}

// Which side shows after the hit with this seed: 0 dark, 1 pale, 2 accent.
float sideOf(vec2 tile, float seed) {
    float h = hash21(tile * 1.37 + seed * 9.1 + 3.0);
    if (h < accents * 0.16) return 2.0;
    return hash21(tile * 2.11 + seed * 5.3 + 8.0) < pale ? 1.0 : 0.0;
}

vec3 sideColor(float side) {
    if (side > 1.5) return accent.rgb;
    return side > 0.5 ? ink.rgb : vec3(0.035, 0.037, 0.042);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    float R = floor(mix(6.0, 30.0, tiles));
    vec2 grid = vec2(floor(R * asp + 0.5), R);
    float n = floor(vxCount + 0.5);
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float px = R / RENDERSIZE.y;

    vec2 cell = uv * grid;
    vec2 tile = floor(cell);
    vec2 f = fract(cell) - 0.5;

    // The side showing now, and the one before this hit for a tile it turned.
    float seedNow = tileSeed(tile, n, grid);
    float now = sideOf(tile, seedNow);
    bool flipping = n > 0.5 && turned(n, tile, grid);
    float before = sideOf(tile, tileSeed(tile, mod(n - 1.0 + 64.0, 64.0), grid));
    // A turning tile closes to an edge and opens on its other side; tiles farther from the patch turn later.
    float delay = 0.35 * hash21(tile + n * 3.7);
    float t = flipping ? clamp(((1.0 - pu) - delay) / 0.45, 0.0, 1.0) : 1.0;
    float open = abs(cos(3.14159 * t));
    float side = t < 0.5 ? before : now;

    // The tile's face: a square with a small gap, squeezed in height while it turns.
    float gap = 0.06;
    vec2 half = vec2(0.5 - gap, (0.5 - gap) * max(open, 0.04));
    vec2 d = abs(f) - half;
    float edge = max(d.x, d.y);
    float face = smoothstep(px, -px, edge);

    // Light from the upper left: a soft gradient over the wall and a sheen that drifts with the music's motion.
    float sheen = exp(-pow((uv.x * 0.7 - uv.y * 0.7 + 0.35 - 0.45 * sin(vxFlow * 0.25)) / 0.3, 2.0));
    float light = 0.5 + 0.2 * (1.0 - uv.x) + 0.2 * uv.y + 0.3 * sheen + 0.45 * sw;
    // A turning tile catches the light as it tilts, and each tile sits a hair differently.
    light *= 0.92 + 0.08 * hash21(tile + 0.5);
    light *= 1.0 + 0.5 * (1.0 - open) * (t < 0.5 ? 1.0 : 0.6);
    // A bevel: the top and left edges a little brighter, the bottom and right darker.
    float bevel = clamp((-f.x + f.y * (1.0 / max(open, 0.2))) * 0.35, -0.2, 0.2) * smoothstep(-0.1, 0.0, edge + 0.08);

    vec3 c = sideColor(side) * (light + bevel);
    // A tile that just landed on a lit side flashes, more for the accent.
    float landed = flipping ? smoothstep(0.5, 0.7, t) * pu : 0.0;
    c += sideColor(now) * landed * (now > 1.5 ? 1.2 : now > 0.5 ? 0.5 : 0.0);

    // The backing behind the tiles, in shadow, lighter where a turning tile has opened a slot.
    vec3 back = vec3(0.006, 0.006, 0.008);
    // Each tile drops a soft shadow down and to the right onto the backing.
    float shadow = smoothstep(0.1, 0.0, max(abs(f.x - 0.04) - half.x, abs(f.y + 0.04) - half.y));
    back *= 1.0 - 0.5 * shadow;
    vec3 col = mix(back, c, face);

    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.5));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the pale and accent sides are solid; the dark side and the backing let the layer under show.
        outa = face * (side > 0.5 ? 1.0 : 0.0);
        outc = col * outa;
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
