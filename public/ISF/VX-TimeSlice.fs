/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Slit-scan. A simple object turns in space: a square frame of light with a bar across it, tumbling slowly. But every row of the picture is taken at a different moment, later toward the bottom, so the turning frame is drawn out into a twisted ribbon that coils and uncoils. The sound's level stretches the time between rows, twisting it further; each hit cuts a few bands of rows loose to another moment, so slabs of the ribbon jump and settle back. With no sound the figure hangs almost untwisted and turns very slowly.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "twist", "LABEL": "Time between rows", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "cuts", "LABEL": "Bands cut loose on a hit", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "weight", "LABEL": "Line weight", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Cut bands", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
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

// Distance from p to the segment a-b.
float seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    return length(pa - ba * h);
}

// A corner of the tumbling frame at moment t, seen in perspective. The frame is a square of half-size 0.3;
// (u, v) is the corner in the frame's own plane.
vec3 corner(float u, float v, float t) {
    vec3 q = vec3(u * 0.3, v * 0.3, 0.0);
    // It turns about the upright axis, and more slowly about the axis toward the viewer.
    float a = t;
    float b = t * 0.37 + 0.6;
    q = vec3(q.x * cos(a) + q.z * sin(a), q.y, -q.x * sin(a) + q.z * cos(a));
    q = vec3(q.x * cos(b) - q.y * sin(b), q.x * sin(b) + q.y * cos(b), q.z);
    float depth = 1.6 + q.z;
    return vec3(q.xy * 1.6 / depth, depth);
}

// How lit the pixel p is by the frame as it stood at moment t: (light, nearness 0-1).
vec2 figure(vec2 p, float t, float thick) {
    vec3 c0 = corner(-1.0, -1.0, t);
    vec3 c1 = corner(1.0, -1.0, t);
    vec3 c2 = corner(1.0, 1.0, t);
    vec3 c3 = corner(-1.0, 1.0, t);
    vec3 m0 = corner(-1.0, 0.0, t);
    vec3 m1 = corner(1.0, 0.0, t);
    float d = seg(p, c0.xy, c1.xy);
    d = min(d, seg(p, c1.xy, c2.xy));
    d = min(d, seg(p, c2.xy, c3.xy));
    d = min(d, seg(p, c3.xy, c0.xy));
    d = min(d, seg(p, m0.xy, m1.xy));
    float px = 1.0 / RENDERSIZE.y;
    float core = smoothstep(thick + px, thick - px, d);
    float halo = exp(-d * d / (0.0003 + 0.0025 * glow)) * (0.08 + 0.25 * glow);
    // Nearness, from the frame's middle depth: its near side is brighter.
    float nearness = clamp(1.9 - (c0.z + c2.z) * 0.5, 0.0, 1.0);
    return vec2(core + halo, nearness);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float n = floor(vxCount + 0.5);
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);

    // Each row is taken at its own moment: later toward the bottom, further apart when the sound is loud.
    float now = vxFlow * 0.5 + TIME * 0.03;
    float spread = (0.4 + 5.0 * twist) * (0.3 + 0.7 * sw);
    float t = now - (1.0 - uv.y) * spread;

    // A hit cuts some bands of rows loose: they jump to another moment and ease back as the hit dies away.
    float bandCount = 18.0;
    float band = floor(uv.y * bandCount);
    float loose = step(hash11(band * 5.31 + n * 17.3), cuts * 0.6) * step(0.5, n);
    float jump = (hash11(band * 2.17 + n * 3.1) - 0.5) * 2.4;
    float ease = pu * pu;
    t += loose * jump * ease;

    float thick = 0.0025 + 0.006 * weight;
    vec2 f = figure(p, t, thick);
    // A faint second exposure a moment later, so the ribbon has a soft trailing edge.
    vec2 f2 = figure(p, t - 0.08, thick);
    float light = f.x + f2.x * 0.3;
    vec3 tone = mix(ink.rgb, accent.rgb, loose * ease);
    vec3 col = tone * light * (0.45 + 0.75 * f.y) * (0.55 + 0.6 * sw);
    col += vec3(1.0) * smoothstep(0.7, 1.2, f.x) * 0.25;

    // The room: nearly black, a little lighter low down, with the hairlines where bands were cut.
    col += ink.rgb * 0.012 * (1.0 - uv.y);
    float cutLine = loose * ease * smoothstep(0.03, 0.0, fract(uv.y * bandCount)) * 0.25;
    col += accent.rgb * cutLine;

    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.7));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        outa = clamp(max(max(col.r, col.g), col.b) * 1.6, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
