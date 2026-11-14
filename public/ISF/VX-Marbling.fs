/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Paper marbling, alive. Drops of dark ink and the palette's two colors fall on still water, each one pushing the rings before it outward, then two pairs of slow eddies turning against each other fold the rings into veins, feathers and swirls while a gentle rake combs them along their own contours. It is printed like ink on pale paper, or glowing on a dark ground. The music sets how fast it stirs; every hit drops a new ring of ink and surges the eddies, then the water calms and the pattern keeps folding.",
    "PASSES": [
        { "TARGET": "blurA", "WIDTH": "$WIDTH/4", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "blurB", "WIDTH": "$WIDTH/16", "HEIGHT": "$HEIGHT/16" },
        { "TARGET": "feedback", "PERSISTENT": true, "FLOAT": true },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "swirl", "LABEL": "Swirl", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "comb", "LABEL": "Comb", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "drops", "LABEL": "Drops", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "hold", "LABEL": "Hold", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "veins", "LABEL": "Dark ink", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ground", "LABEL": "Paper to night", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Color", "TYPE": "color", "DEFAULT": [0.12, 0.35, 0.62, 1.0] },
        { "NAME": "accent", "LABEL": "Second color", "TYPE": "color", "DEFAULT": [0.78, 0.32, 0.22, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxLevel", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 3 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The feedback holds pigment, not light: r = dark ink, g = first colour,
// b = second colour, each 0..1. The last pass prints it.

const float TAU = 6.2831853;
const float PI = 3.14159265;

// Frames' worth of time this frame took (1 at 60 fps): every rate is per second.
float frameStep() { return clamp(TIMEDELTA * 60.0, 0.25, 4.0); }

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

// One eddy: a smoothed point vortex.
vec2 eddy(vec2 p, vec2 c, float g) {
    vec2 d = p - c;
    return g * vec2(-d.y, d.x) / (dot(d, d) + 0.012);
}

// The water's motion this frame: two pairs of eddies, each pair turning
// against itself, wandering slowly, plus a rake that shears the water in soft waves.
vec2 flowAt(vec2 p, float t) {
    float lv = max(0.3, 1.0 + 0.5 * (clamp(vxLevel, 0.0, 3.0) - 1.0));
    float g = (0.00008 + 0.0004 * swirl) * lv * (1.0 + 0.5 * vxSwell + 1.1 * vxPulse);
    vec2 m1 = vec2(-0.36, 0.05) + vec2(0.16 * sin(t * 0.071), 0.12 * sin(t * 0.093 + 1.0));
    vec2 o1 = 0.16 * vec2(cos(t * 0.05), sin(t * 0.05));
    vec2 m2 = vec2(0.36, -0.05) + vec2(0.16 * sin(t * 0.067 + 2.0), 0.12 * sin(t * 0.089 + 3.0));
    vec2 o2 = 0.16 * vec2(cos(1.4 - t * 0.043), sin(1.4 - t * 0.043));
    vec2 v = eddy(p, m1 + o1, g) + eddy(p, m1 - o1, -g) + eddy(p, m2 + o2, -g) + eddy(p, m2 - o2, g);
    float ra = t * 0.03;
    vec2 along = vec2(cos(ra), sin(ra));
    vec2 across = vec2(-along.y, along.x);
    v += along * sin(dot(p, across) * 13.0 + t * 0.2) * 0.0007 * comb * (1.0 + vxSwell + vxPulse);
    return v;
}

// Where each drop falls: two wells that wander, nudged along by every hit.
vec2 wellAt(float i, float t) {
    float m = vxMorph * TAU / 64.0;
    return vec2(0.32 * sin(t * 0.05 + i * 2.6 + 5.0 * m), 0.2 * sin(t * 0.063 + i * 1.3 + 3.0 * m + 0.7)) + vec2(i * 0.2 - 0.1, 0.0);
}

// How much new area a drop spreads over this frame.
float dropArea(float i, float s) {
    float which = 0.5 + 0.5 * cos(vxMorph * PI + i * PI);
    float trickle = (0.00008 + 0.0004 * drops) * (0.5 + vxSwell);
    float burst = (0.0003 + 0.0016 * drops) * vxPulse * (0.25 + 0.75 * which);
    return s * (trickle + burst);
}

// The pigment a drop carries: rings alternate ink and clear water as the hits
// go by, and the ink cycles through dark, the colour and the second colour.
vec3 dropPigment(float i, float t) {
    float on = smoothstep(-0.25, 0.35, cos(vxMorph * PI + t * 3.0 + i * 1.9));
    float th = vxMorph * TAU * 11.0 / 64.0 + t * 0.07 + i * 2.1;
    vec3 w = max(vec3(cos(th), cos(th - TAU / 3.0), cos(th + TAU / 3.0)), 0.0);
    w *= w;
    w.r *= 0.3 + 2.0 * veins;
    w /= max(w.r + w.g + w.b, 1e-4);
    return w * on * (0.8 + 0.2 * vxSwell);
}

// Fades anything that would be read from beyond the frame (clean water there).
float inFrame(vec2 st) {
    vec2 e = min(st, 1.0 - st);
    return smoothstep(-0.002, 0.01, min(e.x, e.y));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = vxFlow;
    float s = frameStep();

    if (PASSINDEX == 0) {
        // Quarter-size blur of last frame.
        vec2 px = 1.0 / RENDERSIZE;
        vec4 acc = vec4(0.0);
        float ws = 0.0;
        for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            float w = exp(-float(i * i + j * j) / 3.0);
            acc += IMG_NORM_PIXEL(feedback, uv + vec2(float(i), float(j)) * px * 4.0) * w;
            ws += w;
        }
        gl_FragColor = acc / ws;
        return;
    }
    if (PASSINDEX == 1) {
        // A wide blur, for the glow on the night ground.
        vec2 px = 1.0 / RENDERSIZE;
        vec4 acc = vec4(0.0);
        float ws = 0.0;
        for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            float w = exp(-float(i * i + j * j) / 4.0);
            acc += IMG_NORM_PIXEL(blurA, uv + vec2(float(i), float(j)) * px * 16.0) * w;
            ws += w;
        }
        gl_FragColor = acc / ws;
        return;
    }
    if (PASSINDEX == 2) {
        vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
        // Undo this frame's drops, newest first: each pushes everything around it
        // outward by exactly the area it adds, as a drop on water does.
        vec2 c1 = wellAt(1.0, t);
        float a1 = dropArea(1.0, s);
        vec2 d = p - c1;
        float r2 = dot(d, d);
        float fill1 = 1.0 - smoothstep(a1 * 0.55, a1 * 1.05, r2);
        p = c1 + d * sqrt(max(1.0 - a1 / max(r2, 1e-7), 0.0));
        vec2 c0 = wellAt(0.0, t);
        float a0 = dropArea(0.0, s);
        d = p - c0;
        r2 = dot(d, d);
        float fill0 = 1.0 - smoothstep(a0 * 0.55, a0 * 1.05, r2);
        p = c0 + d * sqrt(max(1.0 - a0 / max(r2, 1e-7), 0.0));
        // Then the eddies: trace back along the water's motion (midpoint step).
        vec2 v = flowAt(p, t);
        v = flowAt(p - 0.5 * v * s, t);
        p -= v * s;
        vec2 src = p / vec2(aspect, 1.0) + 0.5;
        // Comb along the pattern's own contours (perpendicular to its gradient):
        // this is what folds rings into feathers.
        // Read from the widest blur, so the combing follows the big shapes
        // smoothly and never frays their edges.
        vec2 bpx = 16.0 / RENDERSIZE;
        vec3 one = vec3(1.0);
        float gx = dot(IMG_NORM_PIXEL(blurB, src + vec2(bpx.x, 0.0)).rgb - IMG_NORM_PIXEL(blurB, src - vec2(bpx.x, 0.0)).rgb, one);
        float gy = dot(IMG_NORM_PIXEL(blurB, src + vec2(0.0, bpx.y)).rgb - IMG_NORM_PIXEL(blurB, src - vec2(0.0, bpx.y)).rgb, one);
        vec2 slide = vec2(-gy, gx);
        slide /= max(1.0, length(slide) * 2.0);
        src += slide * s * 0.006 * comb * (1.0 + vxSwell + vxPulse);
        vec4 prev = clamp(IMG_NORM_PIXEL(feedback, src), 0.0, 1.0) * inFrame(src);
        // Fade: Hold sets how long the pattern lasts. Always loses a little.
        float keep = pow(mix(0.993, 0.9995, hold), max(s, 1.0));
        vec4 col = max(prev * keep - vec4(0.00025 * max(s, 1.0)), vec4(0.0));
        if (FRAMEINDEX < 2) col = vec4(0.0);
        // The new drops: older first, newest on top.
        col.rgb = mix(col.rgb, dropPigment(0.0, t), fill0 * (1.0 - fill1));
        col.rgb = mix(col.rgb, dropPigment(1.0, t), fill1);
        col.a = max(col.r, max(col.g, col.b));
        gl_FragColor = clamp(col, 0.0, 1.0);
        return;
    }

    // The print: pigment laid on pale paper (pooling a little darker at its
    // edges), or the same pigment glowing on a dark ground.
    vec3 dens = IMG_NORM_PIXEL(feedback, uv).rgb;
    vec3 soft = IMG_NORM_PIXEL(blurA, uv).rgb;
    dens = clamp(dens + 0.5 * max(dens - soft, 0.0), 0.0, 1.0);
    // Marbling colours sit flat with crisp edges: firm up the density.
    dens = mix(dens, smoothstep(0.04, 0.7, dens), 0.65);
    vec3 mid = mix(ink.rgb, accent.rgb, 0.5);
    // Pigments: keep every colour dark enough to read on paper.
    vec3 tInk = ink.rgb * min(1.0, 0.5 / max(dot(ink.rgb, vec3(0.299, 0.587, 0.114)), 0.01));
    vec3 tAcc = accent.rgb * min(1.0, 0.55 / max(dot(accent.rgb, vec3(0.299, 0.587, 0.114)), 0.01));
    vec3 tDark = mix(vec3(0.06, 0.06, 0.075), mid * 0.15, 0.3);
    vec2 sp = (uv - 0.5) * vec2(aspect, 1.0);
    float fibre = (vnoise(sp * 420.0) - 0.5) * 0.035 + (vnoise(sp * 7.0) - 0.5) * 0.05;
    vec3 paper = mix(vec3(0.945, 0.93, 0.895), mid, 0.05) * (1.0 + fibre);
    paper *= 1.0 - 0.12 * dot(sp, sp);
    vec3 lnT = log(max(tDark, vec3(0.02))) * dens.r + log(max(tInk, vec3(0.02))) * dens.g + log(max(tAcc, vec3(0.02))) * dens.b;
    vec3 printed = paper * exp(lnT * 1.5);
    // Night: the same pigments as light, the dark ink turned to pale silver.
    vec3 glow = IMG_NORM_PIXEL(blurB, uv).rgb;
    vec3 lightOf = vec3(0.82, 0.84, 0.9) * dens.r * 0.75 + ink.rgb * dens.g + accent.rgb * dens.b;
    vec3 glowOf = vec3(0.82, 0.84, 0.9) * glow.r * 0.75 + ink.rgb * glow.g + accent.rgb * glow.b;
    vec3 lit = 1.0 - exp(-(lightOf * 1.3 + glowOf * (0.25 + 0.2 * vxSwell + 0.35 * vxPulse)) * 1.4);
    float alpha = 1.0;
    vec3 col;
    if (vxClear) {
        col = lit;
        alpha = clamp(max(col.r, max(col.g, col.b)) * 1.25, 0.0, 1.0);
    } else {
        vec3 night = mix(vec3(0.008, 0.009, 0.014), mid * 0.03, 0.5) * (1.0 + fibre);
        col = mix(printed, night + lit * (1.0 - night), ground);
    }
    col *= vxPresence;
    alpha *= vxPresence;
    gl_FragColor = vec4(min(col, vec3(alpha)), alpha);
}
