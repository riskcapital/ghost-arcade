/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Molten chrome. Streams of liquid metal pour in from above, fall, and gather into a polished pool that keeps sliding, folding and rolling over itself. Every frame the last picture is carried down and sheared sideways in slow bands, so the metal stretches and folds like hot glass; the surface is lit as a mirror, so its curves catch a dark floor, a bright horizon and the two colours above it, with white highlights on the crests. Freshly poured metal glows hot and cools to a mirror. The music sets how fast it pours and folds; the swell thickens the streams; each hit sends rings rippling through the pool and flares the heat, then it settles.",
    "PASSES": [
        { "TARGET": "blurA", "WIDTH": "$WIDTH/4", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "blurB", "WIDTH": "$WIDTH/4", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "feedback", "PERSISTENT": true, "FLOAT": true },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "pour", "LABEL": "Pour", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "fold", "LABEL": "Fold", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "ripple", "LABEL": "Ripples", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "heat", "LABEL": "Heat", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "fall", "LABEL": "Fall", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "echo", "LABEL": "Echo", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "polish", "LABEL": "Polish", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
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

// Feedback layout: r = metal; g, b = metal times the cosine / sine of the moment it was poured
// (kept in 0..1), which lays coils into the metal as the streams wander; a = heat.

const float TAU = 6.2831853;

// Frames' worth of time this frame took (1 at 60 fps): every rate is per second.
float frameStep() { return clamp(TIMEDELTA * 60.0, 0.25, 4.0); }

// Where the hit ripples start: glides to a new spot as hits add up (seamless at the 64 wrap).
vec2 rippleCentre(float aspect) {
    float m = vxMorph * TAU / 64.0;
    return vec2(0.34 * aspect * sin(m * 5.0 + 0.7), -0.33 + 0.06 * sin(m * 3.0 + 2.1));
}

// Travelling rings: outward waves gated by the hit surge.
float rings(vec2 p, float aspect, float t, out vec2 dir) {
    vec2 d = p - rippleCentre(aspect);
    float r = length(d) + 1e-4;
    dir = d / r;
    float env = exp(-r * 1.6) * smoothstep(0.0, 0.05, r);
    return sin(r * 34.0 - t * 9.0) * env;
}

// The look's motion: where this pixel's metal was last frame.
vec2 sourceOf(vec2 p, float aspect, float t, float s) {
    float level = clamp(vxLevel, 0.0, 3.0);
    vec2 q = p;
    // Fall: metal slides down and slows into a pool along the bottom.
    float v = s * (0.0015 + 0.0055 * fall) * max(0.4, 1.0 + 0.5 * vxSwell + 0.5 * (level - 1.0));
    q.y += v * (0.04 + 0.96 * smoothstep(-0.45, -0.24, p.y));
    // The pool sloshes slowly from side to side.
    q.x += s * 0.0012 * (1.0 + vxSwell) * sin(t * 0.33 + p.x * 1.4) * (1.0 - smoothstep(-0.4, -0.2, p.y));
    // Fold: slow bands sliding against each other, so the metal stretches and folds over.
    float f = s * (0.0006 + 0.0034 * fold) * (1.0 + 0.8 * vxSwell + 1.6 * vxPulse);
    q.x += f * sin(p.y * 5.5 + t * 0.62 + 1.4 * sin(p.x * 1.7 - t * 0.29));
    // (the pool along the bottom only folds sideways, so it settles rather than draining away)
    q.y += f * 0.55 * sin(p.x * 3.6 - t * 0.47 + 1.2 * sin(p.y * 2.6 + t * 0.21)) * smoothstep(-0.48, -0.25, p.y);
    // Ripples: each hit pushes rings outward through the pool.
    vec2 dir;
    float w = rings(p, aspect, t, dir);
    q -= dir * w * s * 0.0035 * ripple * vxPulse;
    return q;
}

// The look's new metal: thin streams poured from the top, each ending in a heavy drop that
// wanders, so the metal is laid down in coils. Returns amount, coil cos / sin, heat.
vec4 pourIn(vec2 p, float aspect, float t, float s) {
    float metal = 0.0;
    vec2 coil = vec2(0.0);
    float hot = 0.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 c = vec2(aspect * (0.36 * sin(t * (0.23 + 0.06 * fi) + fi * 2.3 + (vxGlide - 0.5) * 1.5) + 0.1 * sin(t * 0.37 - fi * 1.3)),
                      0.16 + 0.14 * sin(t * (0.31 + 0.05 * fi) + fi * 1.1));
        float wob = 0.025 * sin(p.y * 8.0 + t * 1.3 + fi * 1.9);
        float sw = 0.012 + 0.012 * vxSwell + 0.01 * vxPulse;
        float dx = p.x - c.x - wob * smoothstep(c.y, 0.5, p.y);
        float stream = exp(-dx * dx / (sw * sw)) * smoothstep(c.y - 0.02, c.y + 0.04, p.y);
        vec2 d = p - c;
        float rad = 0.032 + 0.025 * vxSwell + 0.025 * vxPulse;
        float e = dot(d / vec2(rad, rad * 1.4), d / vec2(rad, rad * 1.4));
        float drop = max(exp(-e), stream * 0.7);
        float amt = drop * (0.03 + 0.05 * pour + 0.03 * vxSwell + 0.12 * vxPulse);
        float ph = t * 7.0 + fi * 2.1;
        metal += amt;
        coil += amt * vec2(cos(ph), sin(ph));
        hot += drop * (0.4 + vxPulse);
    }
    // A hit drops a splash into the pool where the ripples start.
    vec2 c = rippleCentre(aspect);
    vec2 d = p - c;
    float splash = exp(-dot(d, d) / (0.003 + 0.006 * vxPulse)) * vxPulse * vxPulse;
    metal += splash * 0.12;
    hot += splash * 1.2;
    coil /= max(metal, 1e-4);
    return vec4(clamp(metal * s, 0.0, 1.0), coil, clamp(hot * s * 0.06, 0.0, 1.0));
}

// The studio the metal reflects, all soft gradients so colour wraps over the curves. Below a
// gently curved horizon, a floor that glows ink near the horizon and falls away into darkness;
// above it the accent, brightest just over the horizon and fading upward, brighter on one side;
// soft white light pools up high and a key light. In order of brightness: dark, ink, accent, white.
vec3 studio(vec3 R, float t) {
    float hz = -0.02 + 0.09 * R.x * R.x + 0.03 * sin(R.x * 2.3 + t * 0.09);
    float y = R.y - hz;
    vec3 dark = vec3(0.006, 0.007, 0.01);
    float side = 0.65 + 0.35 * cos(R.x * 2.2 - 0.6 + 0.4 * sin(t * 0.07));
    vec3 floorCol = dark + ink.rgb * (0.6 * exp(y / 0.14) + 0.16 * exp(y / 0.5)) * (0.75 + 0.25 * side);
    vec3 skyCol = dark + accent.rgb * (1.2 * exp(-y / 0.14) + 0.14 * exp(-y / 0.5)) * side;
    vec3 col = mix(floorCol, skyCol, smoothstep(-0.055, 0.055, y));
    // The horizon itself: a soft white seam, brighter on the lit side.
    col += vec3(1.0) * exp(-y * y / 0.002) * (0.3 + 0.4 * side);
    // Soft pools of white light up high, drifting slowly round the studio.
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 c = vec2(0.5 * sin(t * 0.07 + fi * 2.1), 0.26 + 0.13 * fi);
        vec2 d = (R.xy - vec2(c.x, c.y + hz)) / vec2(0.13 - 0.025 * fi, 0.07 + 0.03 * fi);
        col += vec3(0.95, 0.97, 1.0) * exp(-pow(dot(d, d), 1.6)) * (0.85 + 0.1 * fi);
    }
    vec3 L = normalize(vec3(-0.35, 0.55, 0.75));
    col += vec3(1.0) * pow(max(dot(normalize(R), L), 0.0), 40.0) * (0.5 + 0.7 * polish);
    return col;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    // One pixel of a 540-line picture: every blur and tap is sized in these, so the look is the
    // same at any resolution.
    vec2 rpx = vec2(1.0 / aspect, 1.0) / 540.0;
    float t = vxFlow;
    float s = frameStep();

    if (PASSINDEX == 0) {
        // Quarter-size blur of last frame, taps close enough that nothing fine aliases through.
        vec2 px = rpx * 1.3;
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
        // A wider blur: rounds the metal into tubes and domes.
        vec2 px = rpx * 4.0;
        vec4 acc = vec4(0.0);
        float ws = 0.0;
        for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            float w = exp(-float(i * i + j * j) / 4.0);
            acc += IMG_NORM_PIXEL(blurA, uv + vec2(float(i), float(j)) * px * 2.6) * w;
            ws += w;
        }
        gl_FragColor = acc / ws;
        return;
    }
    if (PASSINDEX == 2) {
        vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
        vec2 q = sourceOf(p, aspect, t, s);
        vec2 src = q / vec2(aspect, 1.0) + 0.5;
        // Slide along the metal's own contours, so folds keep curling.
        vec2 bpx = 4.0 * rpx;
        float gx = IMG_NORM_PIXEL(blurA, src + vec2(bpx.x, 0.0)).r - IMG_NORM_PIXEL(blurA, src - vec2(bpx.x, 0.0)).r;
        float gy = IMG_NORM_PIXEL(blurA, src + vec2(0.0, bpx.y)).r - IMG_NORM_PIXEL(blurA, src - vec2(0.0, bpx.y)).r;
        src += vec2(-gy, gx * smoothstep(0.02, 0.15, uv.y)) * s * 0.003 * fold * (1.0 + vxSwell + 1.5 * vxPulse);
        vec4 prev = clamp(IMG_NORM_PIXEL(feedback, src), 0.0, 1.0);
        // Metal drains away at the frame's edges, so nothing streaks in from beyond it.
        vec2 e2 = min(src, 1.0 - src);
        float inside = mix(0.85, 1.0, smoothstep(0.0, 0.03, min(min(e2.x, 1.0 - src.y), 1.0)) * smoothstep(-0.005, 0.004, src.y));
        prev *= inside;
        // Surface tension: relax a little toward the neighbours (moves metal, adds none).
        vec2 fpx = 2.0 * rpx;
        vec4 soft = 0.25 * (IMG_NORM_PIXEL(feedback, src + vec2(fpx.x, 0.0)) + IMG_NORM_PIXEL(feedback, src - vec2(fpx.x, 0.0))
                          + IMG_NORM_PIXEL(feedback, src + vec2(0.0, fpx.y)) + IMG_NORM_PIXEL(feedback, src - vec2(0.0, fpx.y)));
        prev = mix(prev, clamp(soft, 0.0, 1.0) * inside, clamp(0.35 * s, 0.0, 0.8));
        // Fade: Echo sets how long the metal lingers; heat cools much faster.
        // The pool along the bottom holds its metal much longer than the falling streams.
        float pool = 1.0 - smoothstep(-0.42, -0.22, p.y);
        float keep = pow(mix(mix(0.984, 0.997, echo) + 0.002 * vxSwell, 0.9992, pool), max(s, 1.0));
        float cool = pow(0.955, max(s, 1.0));
        vec4 col;
        col.r = max(prev.r * keep - 0.0008 * max(s, 1.0), 0.0);
        col.gb = min(prev.gb * (col.r / max(prev.r, 1e-4)), vec2(col.r));
        col.a = max(prev.a * cool - 0.002 * max(s, 1.0), 0.0);
        if (FRAMEINDEX < 2) col = vec4(0.0);
        // New metal goes on top: (metal 1, its coil) over what is there.
        vec4 add = pourIn(p, aspect, t, s);
        col.r = add.x + col.r * (1.0 - add.x);
        col.gb = add.x * (0.5 + 0.5 * add.yz) + col.gb * (1.0 - add.x);
        col.a = add.w + col.a * (1.0 - add.w);
        gl_FragColor = clamp(col, 0.0, 1.0);
        return;
    }

    // The picture: the metal as a curved mirror.
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float sm = IMG_NORM_PIXEL(blurA, uv).r;
    // The coils roll slowly along the metal.
    vec2 roll = vec2(cos(t * 0.8), sin(t * 0.8));
    // Surface slope: three rings of taps at different radii, each turned against the last, on the
    // smooth and the rounder surface. Averaged over many texels, the slope has no facets.
    vec2 ga = vec2(0.0);
    vec2 gb = vec2(0.0);
    for (int k = 0; k < 8; k++) {
        float ang = float(k) * 0.785398;
        vec2 d1 = vec2(cos(ang + 0.2), sin(ang + 0.2));
        vec2 d2 = vec2(cos(ang + 0.59), sin(ang + 0.59));
        vec2 d3 = vec2(cos(ang + 0.98), sin(ang + 0.98));
        vec4 ta = IMG_NORM_PIXEL(blurA, uv + d1 * 6.5 * rpx);
        ga += d1 * (0.6 * ta.r + 0.4 * dot(2.0 * ta.gb - ta.r, roll));
        ta = IMG_NORM_PIXEL(blurA, uv + d2 * 10.5 * rpx);
        ga += d2 * (0.6 * ta.r + 0.4 * dot(2.0 * ta.gb - ta.r, roll)) * 0.62;
        vec4 tb = IMG_NORM_PIXEL(blurB, uv + d2 * 15.0 * rpx);
        gb += d2 * (0.6 * tb.r + 0.4 * dot(2.0 * tb.gb - tb.r, roll));
        tb = IMG_NORM_PIXEL(blurB, uv + d3 * 27.0 * rpx);
        gb += d3 * (0.6 * tb.r + 0.4 * dot(2.0 * tb.gb - tb.r, roll)) * 0.56;
    }
    ga *= 0.16;
    gb *= 0.075;
    vec2 slope = ga * (0.35 + 0.8 * polish) + gb * 15.0;
    // The hit rings bend the mirror as they pass.
    vec2 rd = p - rippleCentre(aspect);
    float rr = length(rd) + 1e-4;
    float cw = cos(rr * 34.0 - t * 9.0) * exp(-rr * 1.6) * smoothstep(0.0, 0.05, rr);
    slope += (rd / rr) * cw * ripple * vxPulse * 0.7;
    vec3 n = normalize(vec3(-slope, 1.0));
    // Reflect the view off the surface into the studio.
    vec3 R = reflect(normalize(vec3(0.0, -0.3, -1.0)), n);
    // The pool along the bottom lies nearer the horizon, so it shows a sheen of the floor's glow.
    R.y -= 0.2 * p.y;
    vec3 col = studio(R, t);
    // Fresnel: grazing slopes reflect more.
    col *= 0.7 + 0.5 * pow(1.0 - n.z, 1.5);
    // Fresh metal still glows from inside.
    float h = IMG_NORM_PIXEL(blurA, uv).a;
    col += mix(accent.rgb, vec3(1.0, 0.92, 0.82), 0.2 + 0.5 * h) * h * h * heat * 1.4;
    col = 1.0 - exp(-col * 1.4);
    // Only where there is metal: a soft edge from the smooth surface.
    float cover = smoothstep(0.1, 0.17, sm);
    col *= cover;
    float alpha = 1.0;
    if (vxClear) {
        float lum = max(col.r, max(col.g, col.b));
        alpha = clamp(max(cover * 0.25, lum * 1.4), 0.0, 1.0) * cover;
    } else {
        col += vec3(0.006, 0.007, 0.01) * (1.0 - cover);
    }
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.35 * dot(vg, vg);
    col *= vxPresence;
    alpha *= vxPresence;
    gl_FragColor = vec4(min(col, vec3(alpha)), alpha);
}
