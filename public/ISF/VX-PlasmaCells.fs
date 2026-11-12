/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "DESCRIPTION": "Living plasma. Glowing cells of very different sizes drift across the dark, each at its own pace, with a nucleus that breathes light. Every frame the last picture is pushed outward from each nucleus and turned gently inside its cell, so light streams to the cell walls and gathers there as soft, wavering membranes, broken in places; as the cells drift, neighbors squeeze together, swallow one another and split apart. The color comes from the brightness: deep ink in the shadows, the accent in the glow and white-hot where light gathers most. The music sets how fast the cells drift; a swell feeds the nuclei and lets light bleed through the walls so cells merge into larger blobs; each hit makes every cell breathe out at once, flaring the membranes, then they settle. The cells change in number smoothly as the hits add up.",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "PASSES": [
        { "TARGET": "seeds", "PERSISTENT": true, "FLOAT": true, "WIDTH": 18, "HEIGHT": 1 },
        { "TARGET": "blurA", "WIDTH": "$WIDTH/4", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "blurB", "WIDTH": "$WIDTH/16", "HEIGHT": "$HEIGHT/16" },
        { "TARGET": "feedback", "PERSISTENT": true, "FLOAT": true },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "breath", "LABEL": "Breath", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "cellSize", "LABEL": "Cell size", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "swirl", "LABEL": "Swirl", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "echo", "LABEL": "Echo", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "fringe", "LABEL": "Color fringe", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.3, 0.8, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Second light", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.6, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxLevel", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 3 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Feedback layout: r = light; g = light times the tag of the cell it was poured in (0..1).

const float TAU = 6.2831853;
const int SEEDS = 18;

// Frames' worth of time this frame took (1 at 60 fps): every rate is per second.
float frameStep() { return clamp(TIMEDELTA * 60.0, 0.25, 4.0); }

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// Four stable pseudo-random numbers for a cell.
vec4 seedRand(float fi) {
    return fract(sin(vec4(fi * 12.99 + 1.3, fi * 78.23 + 4.1, fi * 37.71 + 2.7, fi * 91.17 + 0.6)) * 4375.85);
}

// How many cells are alive: set by the knob, gliding as hits add up (seamless at the 64 wrap).
float liveCells() {
    float m = vxMorph * TAU / 64.0;
    return mix(17.5, 7.0, cellSize) + 2.2 * sin(m * 3.0 + 0.4);
}

// The membranes waver: a slow, smooth warp of the space the cells live in.
vec2 waver(vec2 p, float t) {
    return p + 0.04 * vec2(sin(p.y * 7.0 + t * 0.9 + sin(p.x * 5.0 - t * 0.4)),
                            sin(p.x * 6.0 - t * 0.8 + sin(p.y * 4.0 + t * 0.5)));
}

// One cell's nucleus. Each roams the whole screen at its own speed and has its own size (a weight
// in a power diagram, so sizes vary a lot); a dying cell shrinks away smoothly. Returns position,
// the power bias (size squared, or a large negative once dead) and size.
vec4 seedOf(float fi, float t) {
    vec4 h = seedRand(fi);
    float sp = (0.25 + 1.2 * h.x * h.x) * (0.3 + 1.2 * drift);
    // x is stored as a fraction of the width (this pass's own size says nothing of the screen's shape).
    vec2 c = vec2(0.5 * sin(t * sp * 0.31 + h.y * TAU) + 0.1 * sin(t * sp * 0.73 + h.z * 9.0),
                  0.5 * sin(t * sp * 0.27 * (0.8 + 0.4 * h.z) + h.w * TAU) + 0.1 * sin(t * sp * 0.61 + h.x * 7.0));
    float size = mix(0.05, 0.26, h.z * h.z) * (1.0 + 0.2 * sin(t * (0.5 + h.w) + h.y * TAU));
    float alive = clamp(liveCells() - fi, 0.0, 1.0);
    return vec4(c, size * size * alive - (1.0 - alive) * 0.6, size);
}

vec4 seedAt(int i, float aspect) {
    vec4 sd = IMG_NORM_PIXEL(seeds, vec2((float(i) + 0.5) / float(SEEDS), 0.5));
    sd.x *= aspect;
    return sd;
}

// The cells around a point: the nearest nucleus by power, and the exact distance to its cell's
// wall (the nearest of all its walls, so no smears or slivers where nuclei crowd together).
// Returns wall distance, the vector to the nucleus, and the cell's index; size is its size.
vec4 cells(vec2 p, float aspect, out float size) {
    float pd1 = 1e5;
    vec2 c1 = vec2(0.0);
    float i1 = 0.0;
    size = 0.1;
    for (int i = 0; i < SEEDS; i++) {
        vec4 sd = seedAt(i, aspect);
        vec2 r = p - sd.xy;
        float pd = dot(r, r) - sd.z;
        if (pd < pd1) { pd1 = pd; c1 = sd.xy; i1 = float(i); size = sd.w; }
    }
    float wall = 1e3;
    for (int i = 0; i < SEEDS; i++) {
        vec4 sd = seedAt(i, aspect);
        vec2 r = p - sd.xy;
        float pd = dot(r, r) - sd.z;
        float sep = length(sd.xy - c1);
        if (abs(float(i) - i1) > 0.5) wall = min(wall, (pd - pd1) / max(2.0 * sep, 1e-3));
    }
    return vec4(wall, c1 - p, i1);
}

// Where the membranes break: slow gaps that drift along them, wider on a swell.
float membraneIntact(vec2 p, float t) {
    float n = sin(p.x * 9.0 + t * 0.7 + 1.3 * sin(p.y * 4.0 - t * 0.3)) * sin(p.y * 8.0 - t * 0.5 + 1.1 * sin(p.x * 3.0 + t * 0.2))
            + 0.5 * sin((p.x + p.y) * 13.0 + t * 1.1);
    return smoothstep(-0.9, 0.4, n - 0.7 * vxSwell);
}

// The palette by brightness: black, deep ink, the accent (tinted per cell), white.
vec3 plasmaTone(float v, float tagMix) {
    vec3 mid = mix(accent.rgb, mix(accent.rgb, ink.rgb, 0.45), tagMix);
    vec3 c = mix(vec3(0.003, 0.003, 0.006), ink.rgb * 0.6, smoothstep(0.02, 0.4, v));
    c = mix(c, mid, smoothstep(0.4, 0.75, v));
    c = mix(c, vec3(1.0, 0.97, 0.94), smoothstep(0.8, 1.0, v));
    return c;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    // One pixel of a 540-line picture: blurs are sized in these, so any resolution looks the same.
    vec2 rpx = vec2(1.0 / aspect, 1.0) / 540.0;
    float t = vxFlow;
    float s = frameStep();

    if (PASSINDEX == 0) {
        // Where every nucleus is this frame (one texel each).
        gl_FragColor = seedOf(floor(uv.x * float(SEEDS)), t);
        return;
    }
    if (PASSINDEX == 1) {
        // Quarter-size blur of last frame: the near glow (taps close enough not to alias).
        vec4 acc = vec4(0.0);
        float ws = 0.0;
        for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            float w = exp(-float(i * i + j * j) / 3.0);
            acc += IMG_NORM_PIXEL(feedback, uv + vec2(float(i), float(j)) * rpx * 4.0) * w;
            ws += w;
        }
        gl_FragColor = acc / ws;
        return;
    }
    if (PASSINDEX == 2) {
        // A much wider blur, for the deep glow.
        vec4 acc = vec4(0.0);
        float ws = 0.0;
        for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            float w = exp(-float(i * i + j * j) / 4.0);
            acc += IMG_NORM_PIXEL(blurA, uv + vec2(float(i), float(j)) * rpx * 24.0) * w;
            ws += w;
        }
        gl_FragColor = acc / ws;
        return;
    }
    if (PASSINDEX == 3) {
        vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
        vec2 pw = waver(p, t);
        float size;
        vec4 c = cells(pw, aspect, size);
        float tag = seedRand(c.w).w;
        float wall = c.x;
        vec2 toSeed = c.yz;
        float d1 = length(toSeed);
        // Breathe: light is carried outward from each nucleus and stalls just short of the walls,
        // leaving a dark seam between cells; each hit surges it.
        float level = clamp(vxLevel, 0.0, 3.0);
        float push = s * (0.0005 + 0.0022 * breath) * max(0.3, 0.7 + 1.5 * vxSwell + 0.3 * (level - 1.0) + 1.8 * vxPulse);
        float stall = smoothstep(0.006, 0.035, wall);
        vec2 q = p + toSeed / max(d1, 1e-4) * min(push * smoothstep(0.0, 0.03, d1) * stall, d1);
        // Swirl: each cell turns its light, half one way and half the other.
        vec2 seedP = p + toSeed;
        float turn = s * (0.002 + 0.012 * swirl) * (tag < 0.5 ? 1.0 : -1.0) * stall * (0.6 + 0.5 * vxSwell + 1.2 * vxPulse);
        q = seedP + rot2(turn) * (q - seedP);
        vec2 src = q / vec2(aspect, 1.0) + 0.5;
        vec4 prev = clamp(IMG_NORM_PIXEL(feedback, src), 0.0, 1.0);
        // On a swell, light bleeds through the walls (relaxes toward its neighbourhood: moves light,
        // adds none), so neighbouring cells run together into larger blobs.
        vec4 near = clamp(IMG_NORM_PIXEL(blurA, src), 0.0, 1.0);
        prev = mix(prev, near, clamp(s * (0.01 + 0.14 * vxSwell), 0.0, 0.5));
        // Fade: Echo sets how long the light lingers; always at least a frame's worth.
        float keep = pow(mix(0.92, 0.97, echo) + 0.018 * vxSwell, max(s, 1.0));
        vec4 col;
        col.r = max(prev.r * keep - 0.0015 * max(s, 1.0), 0.0);
        col.g = min(prev.g * (col.r / max(prev.r, 1e-4)), col.r);
        col.ba = vec2(0.0);
        if (FRAMEINDEX < 2) col = vec4(0.0);
        // New light: each nucleus breathes on its own slow cycle, swells with the sound and
        // flares on hits; two sparks orbit it and are swept into spiral arms.
        float breathe = 0.75 + 0.25 * sin(t * (1.3 + tag) + tag * 17.0);
        float coreR = (0.025 + 0.13 * size) * (1.0 + 0.6 * vxSwell);
        float core = exp(-d1 * d1 / (coreR * coreR * (1.0 + 1.5 * vxPulse)));
        float orbit = t * (0.6 + 0.5 * swirl) * (tag < 0.5 ? 1.0 : -1.0) + tag * TAU;
        vec2 sp = vec2(cos(orbit), sin(orbit)) * coreR * 1.8;
        vec2 rel = -toSeed;
        float sr = coreR * 0.7;
        float sparks = exp(-dot(rel - sp, rel - sp) / (sr * sr)) + exp(-dot(rel + sp, rel + sp) / (sr * sr));
        // A nucleus (or a spark) squeezed against a wall dims rather than smearing into a sliver.
        float clear = smoothstep(0.0, 0.04, wall);
        float add = clear * max(core * breathe * (0.55 + 0.3 * vxSwell + 0.3 * vxPulse),
                                sparks * smoothstep(0.03, 0.09, wall) * (0.36 + 0.3 * vxSwell + 0.08 * vxPulse));
        // The walls gather the light that reaches them from inside the cell: a share of the glow a
        // little way in, never of the wall itself, so a membrane can't keep itself lit. Gaps drift
        // along the walls, and on a swell the walls let go so cells run together.
        vec2 inward = toSeed / max(d1, 1e-4) * min(0.045, d1);
        vec2 insideUV = (p + inward) / vec2(aspect, 1.0) + 0.5;
        float inner = clamp(IMG_NORM_PIXEL(blurA, insideUV).r, 0.0, 1.0);
        float band = exp(-pow(wall / 0.02, 2.0)) * membraneIntact(pw, t) * (1.0 - 0.5 * vxSwell);
        float gather = clamp(s * band * inner * (0.05 + 0.08 * vxPulse), 0.0, 1.0);
        col.r = gather + col.r * (1.0 - gather);
        col.g = gather * tag + col.g * (1.0 - gather);
        // The nucleus holds its own brightness (never piles up past it).
        float lift = max(add - col.r, 0.0) * clamp(0.2 * s, 0.0, 1.0);
        col.r += lift;
        col.g += lift * tag;
        gl_FragColor = clamp(col, 0.0, 1.0);
        return;
    }

    // The picture: brightness through the palette, with soft membranes, a near and a deep glow,
    // and a slight colour fringe.
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    vec2 off = (uv - 0.5) * (0.004 * fringe) + vec2(0.0012 * fringe, 0.0);
    vec4 fb = clamp(IMG_NORM_PIXEL(feedback, uv), 0.0, 1.0);
    float lr = clamp(IMG_NORM_PIXEL(feedback, uv + off).r, 0.0, 1.0);
    float lb = clamp(IMG_NORM_PIXEL(feedback, uv - off).r, 0.0, 1.0);
    vec4 nearG = IMG_NORM_PIXEL(blurA, uv);
    vec4 deepG = IMG_NORM_PIXEL(blurB, uv);
    float tagMix = mix(fb.g / max(fb.r, 1e-3), nearG.g / max(nearG.r, 1e-3), 0.5);
    float bloom = nearG.r * (0.12 + 0.25 * glow) + deepG.r * (0.06 + 0.22 * glow) * (1.0 + 0.5 * vxSwell + 0.6 * vxPulse);
    // Membranes: a soft glowing band along each wall, lit by the light that reaches it, faint at rest,
    // broken in places, and fading on a swell where cells run together.
    vec2 pw = waver(p, t);
    float sz;
    vec4 c = cells(pw, aspect, sz);
    float wall = c.x;
    float rimW = 0.011 + 0.008 * vxPulse;
    float rim = exp(-pow(wall / rimW, 2.0));
    float intact = membraneIntact(pw, t);
    float mem = rim * intact * (1.0 - 0.45 * vxSwell) * (nearG.r * (0.35 + 0.45 * vxPulse) + deepG.r * 1.1 + 0.22 + 0.08 * vxSwell);
    vec3 v = vec3(lr, fb.r, lb) * 0.85 + bloom + mem;
    v = 1.0 - exp(-v * 1.5);
    // Deeper shadows, so the walls and nuclei carry the picture and the seams stay dark.
    v = v * v * (1.6 - 0.6 * v);
    vec3 col;
    col.r = plasmaTone(v.r, tagMix).r;
    col.g = plasmaTone(v.g, tagMix).g;
    col.b = plasmaTone(v.b, tagMix).b;
    float alpha = 1.0;
    if (vxClear) {
        alpha = clamp(max(col.r, max(col.g, col.b)) * 1.3, 0.0, 1.0);
    } else {
        vec2 vg = uv - 0.5;
        col *= 1.0 - 0.3 * dot(vg, vg);
    }
    col *= vxPresence;
    alpha *= vxPresence;
    gl_FragColor = vec4(min(col, vec3(alpha)), alpha);
}
