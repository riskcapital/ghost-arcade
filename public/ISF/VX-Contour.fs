/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A topographic map of land that slowly changes shape: hairline contours on a dark ground, every fifth one a little heavier, with very soft hill shading and a quiet grid of survey crosses. The sound's motion morphs the land; its level draws in the contours between the contours, so the lines crowd together; each hit lights one band of elevation in the accent color, which climbs to the next levels as the hit fades. With no sound the map lies still and dim.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "levels", "LABEL": "Levels", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "scale", "LABEL": "Scale", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "weight", "LABEL": "Line weight", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "shading", "LABEL": "Shading", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Contours", "TYPE": "color", "DEFAULT": [0.74, 0.88, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Lit band", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

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

// A direction for each corner of the noise lattice.
vec3 hash33(vec3 q) {
    vec3 p3 = fract(q * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx) * 2.0 - 1.0;
}

// Smooth noise with no creases, about -0.7 to 0.7. The third coordinate is time: moving along it morphs the field.
float smoothNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(hash33(i), f);
    float b = dot(hash33(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
    float c = dot(hash33(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
    float d = dot(hash33(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
    float e = dot(hash33(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
    float g = dot(hash33(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
    float h = dot(hash33(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
    float k = dot(hash33(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}

// The land's height at a point of the map, 0 to 1 or so: broad hills with smaller ground on them.
float land(vec2 q, float t) {
    float h = 0.5;
    h += 0.6 * smoothNoise(vec3(q, t));
    h += 0.2 * smoothNoise(vec3(q * 2.1 + vec2(7.3, 2.9), t * 1.4 + 5.0));
    return h;
}

// How much of a pixel a line covers, from the distance to its middle in pixels and its half width.
// A line thinner than a pixel and a half is drawn that wide and fainter, so it never breaks into beads.
float stroke(float dpx, float halfW) {
    float hw = max(halfW, 0.75);
    return (1.0 - smoothstep(hw - 0.6, hw + 0.6, dpx)) * min(halfW / 0.75, 1.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    // The land changes shape with the sound; a trace of drift keeps it from freezing.
    float t = vxFlow * 0.11 + TIME * 0.004;

    float freq = mix(2.5, 0.9, scale);
    vec2 q = p * freq + vec2(1.7, 4.3);
    float e = px * freq;
    float h = land(q, t);
    float hx = land(q + vec2(e, 0.0), t);
    float hy = land(q + vec2(0.0, e), t);
    // The slope, in height per pixel and in height per screen height.
    vec2 gpx = vec2(hx - h, hy - h);
    vec2 grad = gpx / px;

    // Contour levels: v counts them, one whole number per contour.
    float L = floor(mix(6.0, 20.0, levels) + 0.5);
    float v = h * L;
    float slope = max(length(gpx) * L, 1e-6);

    // Line widths follow the picture's size, and never fall under a pixel.
    float unit = RENDERSIZE.y / 1080.0;
    float w = max(0.6, unit * mix(0.5, 1.5, weight));

    // The contours, every fifth one heavier.
    float k = floor(v + 0.5);
    float d0 = abs(v - k) / slope;
    float index = mod(k, 5.0) < 0.5 ? 1.0 : 0.0;
    float main0 = stroke(d0, w * mix(1.0, 1.7, index)) * mix(0.55, 1.0, index);
    // Louder, the contours between the contours are drawn in; louder still, the ones between those.
    float d1 = abs(fract(v) - 0.5) / slope;
    float half1 = stroke(d1, w * 0.9) * 0.42 * smoothstep(0.08, 0.5, sw);
    float d2 = abs(fract(v * 2.0) - 0.5) * 0.5 / slope;
    float quart = stroke(d2, w * 0.8) * 0.3 * smoothstep(0.55, 0.95, sw);
    float lines = max(main0, max(half1, quart));

    // Hill shading: a low soft light from the upper left.
    vec3 nrm = normalize(vec3(-grad * 0.55, 1.0));
    vec3 sun = normalize(vec3(-0.55, 0.6, 0.6));
    float shade = dot(nrm, sun) - sun.z;

    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;

    // The band of elevation the latest hit lit: it starts at one level and climbs a few as the hit fades.
    float lit = n > 0.5 ? 1.0 : 0.0;
    float k0 = floor(L * (0.25 + 0.3 * hash11(n * 3.71 + 1.3)));
    float climb = floor(clamp(L * 0.25, 1.0, 3.0));
    float bandAt = k0 + climb * (1.0 - pu);
    float inBand = smoothstep(bandAt - 0.06, bandAt + 0.06, v) * (1.0 - smoothstep(bandAt + 0.94, bandAt + 1.06, v));
    float nearBand = smoothstep(bandAt - 0.25, bandAt - 0.05, v) * (1.0 - smoothstep(bandAt + 1.05, bandAt + 1.25, v));

    // The ground: nearly black, a little lighter on high land and on slopes that face the light.
    vec3 col = vec3(0.005, 0.0055, 0.007);
    col += inkC * (0.006 + 0.016 * smoothstep(0.2, 0.9, h));
    col += inkC * shading * (0.16 * max(shade, 0.0) + 0.025 * shade);
    col = max(col, 0.0);
    col += accC * lit * inBand * (0.022 + 0.13 * pu) * (0.8 + 0.6 * shade);

    // The lines, lifted by the sound and a touch brighter where the slope faces the light.
    float level = (0.5 + 0.5 * sw) * (1.0 + 0.45 * shade);
    vec3 lc = mix(inkC * level, accC * (0.85 + 0.9 * pu), lit * nearBand);
    col += lc * lines * 1.15;

    // A quiet grid of survey crosses.
    float G = 0.25;
    vec2 gq = (fract(p / G + 0.5) - 0.5) * G;
    float arm = 0.0075;
    float hw = max(0.5 * px, 0.0005);
    float sx = max(abs(gq.x) - arm, abs(gq.y) - hw);
    float sy = max(abs(gq.y) - arm, abs(gq.x) - hw);
    float tick = smoothstep(px, 0.0, min(sx, sy));
    col += inkC * tick * 0.2 * (1.0 - lines);

    // The map falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.35 * dot(vg, vg) * 2.0;

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
