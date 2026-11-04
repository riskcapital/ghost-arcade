/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A river of light rising through water. Every frame the picture is carried upward on an uneven current that drifts sideways in slow currents of its own, squeezing ribbons together in some places and spreading them apart in others, so they merge and split as they climb. Broad soft veils of light always rise at the back; in front, threads of different widths and brightness run side by side, drift apart and come back together, and now and then twist into a braid that loosens again. The light is seen through the water: it bends where the ribbons are bright, haze drifts up above them, and the brightest strands turn pearl-white. The music sets how fast the river rises; the swell widens and brightens the threads and veils; each hit brightens and widens the whole flow, sending a surge of light up every ribbon, then it settles.",
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
        { "NAME": "rise", "LABEL": "Rise", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "braid", "LABEL": "Braid", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "echo", "LABEL": "Echo", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Width", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ripple", "LABEL": "Ripple", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "pearl", "LABEL": "Pearl", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Colour drift", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.25, 0.85, 0.9, 1.0] },
        { "NAME": "accent", "LABEL": "Second light", "TYPE": "color", "DEFAULT": [0.55, 0.4, 1.0, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxLevel", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 3 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Frames' worth of time this frame took (1 at 60 fps): every rate is per second.
float frameStep() { return clamp(TIMEDELTA * 60.0, 0.25, 4.0); }

// Rotate a colour's hue about the grey axis.
vec3 hueTurn(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

// The current's speed (per 60 fps frame): surging on each hit and pushed by a part
// playing above its usual level.
float riseSpeed() {
    float level = clamp(vxLevel, 0.0, 3.0);
    return (0.004 + 0.0058 * rise) * max(0.3, 1.0 + 0.6 * (level - 1.0))
         + 0.0012 * vxSwell + 0.011 * (0.3 + rise) * vxPulse;
}

// The current at p: up, a little faster through the middle and unevenly across the river,
// with slow sideways drifts that squeeze ribbons together in some places and spread them
// apart in others, so they merge and split as they climb.
vec2 currentAt(vec2 p, float t, float v) {
    // Each hit glides the drifts a sixteenth of a turn (64 hits = four whole turns, so the
    // count wrapping is seamless): the ribbons lean and regroup as the hits add up.
    float hitTurn = vxMorph * (TAU / 16.0);
    float drifts = sin(p.x * 4.1 + p.y * 2.3 - t * 0.29 + hitTurn)
                 + 0.6 * sin(p.x * 8.3 - p.y * 3.7 + t * 0.21 - hitTurn)
                 + 0.5 * sin(p.y * 5.0 - t * 0.4 + p.x * 1.3);
    float vx = 0.0024 * braid * drifts * (1.0 + 0.8 * vxSwell + 1.5 * vxPulse) + 0.12 * v * p.x;
    float vy = v * (0.75 + 0.4 * exp(-p.x * p.x * 4.0) + 0.15 * sin(p.x * 3.3 + t * 0.13));
    return vec2(vx, vy);
}

// The look's motion: where this pixel's light was last frame.
vec2 sourceOf(vec2 uv, float aspect, float t, float s) {
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    vec2 src = p - currentAt(p, t, riseSpeed()) * s;
    // Ripple: light seen through a moving surface - a fine, slow shimmer of the current.
    float rip = sin(p.y * 31.0 - t * 1.9 + 2.0 * sin(p.x * 7.0 + t * 0.6)) + 0.6 * sin(p.y * 53.0 + p.x * 11.0 - t * 2.6);
    src.x += s * 0.00022 * ripple * rip * (1.0 + vxSwell);
    return src / vec2(aspect, 1.0) + 0.5;
}

// Distance from p to the segment a-b.
float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    return length(p - a - ab * h);
}

// Where strand j of group k (of n strands) sits near the riverbed at clock t. A group's
// strands run side by side, drifting apart and back together; now and then they start to
// circle a shared centre and twist into a braid, then loosen again.
// depth: +1 when the strand is at the front of its turn, -1 at the back (0 when untwisted).
vec2 strandAt(float fk, float fj, float n, float t, float span, out float depth) {
    float base = fk < 0.5 ? -0.68 : (fk < 1.5 ? -0.2 : (fk < 2.5 ? 0.24 : 0.7));
    float cx = span * (base + 0.2 * sin(t * (0.07 + 0.023 * fk) + fk * 2.3) + 0.08 * sin(t * 0.17 + fk * 1.1));
    float sep = 0.012 + 0.045 * (0.5 + 0.5 * sin(t * (0.061 + 0.017 * fk) + fk * 1.9));
    float twist = smoothstep(0.35, 0.95, 0.5 + 0.5 * sin(t * (0.043 + 0.013 * fk) + fk * 2.7 + 1.0));
    float amp = (0.008 + 0.03 * braid) * twist * (1.0 + 0.5 * vxSwell + 0.5 * vxPulse);
    float ph = t * (2.2 + 0.7 * fk) + fk * 1.3 + fj * TAU / n;
    float x = cx + (fj - 0.5 * (n - 1.0)) * sep + amp * sin(ph);
    depth = cos(ph) * twist;
    float y = -0.44 + 0.06 * fract(fk * 0.37 + fj * 0.53) + 0.02 * sin(t * 0.19 + fk + fj * 1.7);
    return vec2(x, y);
}

// The look's new light, near the riverbed: broad soft veils that always rise, and in front of
// them groups of finer threads of different widths and brightness.
vec3 pourIn(vec2 p, float aspect, float t, out float cover) {
    cover = 0.0;
    // Everything is poured in near the riverbed; above that the current does the rest.
    if (p.y > 0.0) return vec3(0.0);
    float span = 0.5 * aspect * (0.5 + 0.5 * spread);
    vec3 col = vec3(0.0);
    float s = frameStep();
    float v = riseSpeed();
    // Veils: wide, faint and slow. They stay put while the current lifts them, so they are
    // poured per second, not per frame (the same brightness at any frame rate).
    for (int iv = 0; iv < 3; iv++) {
        float fv = float(iv);
        float xv = span * (0.8 * sin(t * (0.031 + 0.011 * fv) + fv * 2.2) + 0.15 * sin(t * 0.09 + fv));
        float wv = 0.08 + 0.07 * fract(fv * 0.43 + 0.2);
        vec2 dv = (p - vec2(xv, -0.41 + 0.02 * fv)) / vec2(wv, 0.05 + 0.4 * v * s);
        float amt = exp(-dot(dv, dv)) * (0.075 + 0.025 * vxSwell + 0.05 * vxPulse) * 0.5 * s;
        col += mix(ink.rgb, accent.rgb, 0.25 + 0.3 * fv) * amt;
    }
    // Threads. A hit brightens and widens every one at once, so a surge travels up them all.
    float surge = 1.0 + 0.6 * vxSwell + 1.3 * vxPulse;
    float widen = 1.0 + 0.35 * vxSwell + 0.6 * vxPulse;
    float dFlow = (0.25 + 1.4 * vxSwell + 0.9 * vxPulse) * clamp(TIMEDELTA, 0.0, 0.1);
    for (int k = 0; k < 4; k++) {
        float fk = float(k);
        float n = k == 0 ? 2.0 : (k == 1 ? 3.0 : (k == 2 ? 2.0 : 1.0));
        vec3 c = mix(ink.rgb, accent.rgb, 0.5 + 0.5 * sin(fk * 2.1 + t * 0.17));
        for (int j = 0; j < 3; j++) {
            float fj = float(j);
            if (fj >= n) continue;
            float dep, depOld;
            vec2 a = strandAt(fk, fj, n, t, span, dep);
            // Far from this strand (it moves a few hundredths a frame at most): skip the trace.
            if (abs(p.x - a.x) > 0.16 || p.y < a.y - 0.06) continue;
            // Trace the strand's last few frames of path, each point carried up by the current
            // as far as it has risen since: the newest stretch of ribbon is drawn whole every
            // frame, so it stays a smooth curve however the frames fall.
            float d = 1e5;
            vec2 prevPt = a - vec2(0.0, 0.004);
            for (int m = 1; m <= 6; m++) {
                float fm = float(m);
                vec2 pt = strandAt(fk, fj, n, t - fm * dFlow, span, depOld);
                pt += currentAt(pt, t, v) * s * fm;
                d = min(d, segDist(p, prevPt, pt));
                prevPt = pt;
            }
            // Each thread has its own width and brightness; the thin ones burn brighter, and
            // each slowly brightens and fades on its own.
            float wn = fract(fk * 0.618 + fj * 0.382 + 0.1);
            float w = (0.0035 + 0.011 * wn) * widen * (0.85 + 0.25 * dep);
            float b = (0.45 + 0.55 * fract(fk * 0.71 + fj * 0.29 + 0.3)) * mix(1.25, 0.7, wn)
                    * (0.6 + 0.4 * sin(t * (0.11 + 0.03 * fj) + fk * 2.0 + fj));
            d /= w;
            float g = exp(-d * d) + 0.3 * exp(-d * d * 4.0);
            // In a braid, the strand passing in front is brighter and whiter; the one behind dims.
            vec3 sc = mix(c, mix(ink.rgb, accent.rgb, fract(fj * 0.5 + fk * 0.25)), 0.35);
            col += mix(sc, vec3(1.0), 0.12 * max(dep, 0.0)) * g * b * surge * (0.75 + 0.25 * dep) * 0.42;
        }
    }
    // Fade the riverbed edge so nothing pools against the bottom of the frame.
    col *= smoothstep(-0.5, -0.44, p.y);
    cover = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    return col;
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
        // A wide blur stretched upright, for haze that hangs above the light.
        vec2 px = 1.0 / RENDERSIZE;
        vec4 acc = vec4(0.0);
        float ws = 0.0;
        for (int j = -3; j <= 3; j++) for (int i = -1; i <= 1; i++) {
            float w = exp(-float(i * i) / 1.5 - float(j * j) / 6.0);
            acc += IMG_NORM_PIXEL(blurA, uv + vec2(float(i) * 12.0, float(j) * 22.0) * px) * w;
            ws += w;
        }
        gl_FragColor = acc / ws;
        return;
    }
    if (PASSINDEX == 2) {
        vec2 src = sourceOf(uv, aspect, t, s);
        // Let the light run along its own contours a little, so the ribbons stay fluid.
        vec2 bpx = 4.0 / RENDERSIZE;
        float gx = luma(IMG_NORM_PIXEL(blurA, src + vec2(bpx.x, 0.0)).rgb) - luma(IMG_NORM_PIXEL(blurA, src - vec2(bpx.x, 0.0)).rgb);
        float gy = luma(IMG_NORM_PIXEL(blurA, src + vec2(0.0, bpx.y)).rgb) - luma(IMG_NORM_PIXEL(blurA, src - vec2(0.0, bpx.y)).rgb);
        src += vec2(-gy, gx) * s * 0.0014 * braid * (1.0 + vxSwell + 1.5 * vxPulse);
        vec4 prev = clamp(IMG_NORM_PIXEL(feedback, src), 0.0, 1.0);
        // Age through the palette as it climbs.
        prev.rgb = clamp(hueTurn(prev.rgb, s * 0.003 * drift * (1.0 + vxSwell)), 0.0, 1.0);
        // Fade: Echo sets how high the ribbons carry. Always at least a frame's worth.
        float keep = pow(mix(0.962, 0.988, echo) + 0.004 * vxSwell, max(s, 1.0));
        vec4 col = max(prev * keep - vec4(0.0015 * max(s, 1.0)), vec4(0.0));
        if (FRAMEINDEX < 2) col = vec4(0.0);
        vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
        float cv;
        vec3 add = pourIn(p, aspect, t, cv);
        col.rgb = col.rgb + add * (1.0 - col.rgb);
        col.a = clamp(col.a + cv * (1.0 - col.a), 0.0, 1.0);
        gl_FragColor = clamp(col, 0.0, 1.0);
        return;
    }

    // The picture, seen through water: the light bends where it is bright,
    // haze drifts above it, and the strongest strands turn pearl.
    vec2 bpx = 4.0 / RENDERSIZE;
    float hx = luma(IMG_NORM_PIXEL(blurA, uv + vec2(bpx.x, 0.0)).rgb) - luma(IMG_NORM_PIXEL(blurA, uv - vec2(bpx.x, 0.0)).rgb);
    float hy = luma(IMG_NORM_PIXEL(blurA, uv + vec2(0.0, bpx.y)).rgb) - luma(IMG_NORM_PIXEL(blurA, uv - vec2(0.0, bpx.y)).rgb);
    vec2 bend = vec2(hx, hy) * (0.012 + 0.01 * vxSwell);
    vec4 fb = IMG_NORM_PIXEL(feedback, uv - bend);
    // Haze: light from below drifts up through the water.
    vec3 haze = vec3(0.0);
    for (int k = 1; k <= 5; k++) {
        float fk = float(k);
        haze += IMG_NORM_PIXEL(blurA, uv - vec2(0.0, fk * 0.022)).rgb * exp(-fk * 0.45);
    }
    haze *= 0.28;
    vec3 glow = IMG_NORM_PIXEL(blurB, uv).rgb;
    vec3 light = fb.rgb * (1.35 + 0.3 * vxPulse) + haze * (0.35 + 0.3 * vxSwell) + glow * (0.2 + 0.15 * vxSwell + 0.3 * vxPulse);
    // Moving caustics from the surface, brightest higher up, only ever on existing light.
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    vec2 cq = p * 6.0;
    float ca = sin(cq.x * 1.7 + sin(cq.y * 1.3 + t * 0.4) * 1.5 + t * 0.23) * sin(cq.y * 1.1 - sin(cq.x * 1.9 - t * 0.3) + t * 0.31);
    float caustic = pow(abs(ca), 0.6);
    light *= (0.82 + 0.38 * caustic * ripple) * (0.9 + 0.22 * smoothstep(-0.4, 0.5, p.y));
    vec3 col = 1.0 - exp(-light * 1.45);
    // Pearl: map the light by its brightness through ink, then accent, then a warm white,
    // blended with its own colour so the ribbons keep their character.
    float l = luma(col);
    vec3 pal = mix(vec3(0.0), ink.rgb * 0.85, smoothstep(0.0, 0.35, l));
    pal = mix(pal, accent.rgb, smoothstep(0.3, 0.68, l));
    pal = mix(pal, vec3(1.0, 0.97, 0.93), smoothstep(0.62, 0.95, l));
    col = mix(col, pal * (0.4 + 0.75 * l) + col * 0.15, pearl * 0.7);
    // Deep blacks between the ribbons.
    col = col * col * (3.0 - 2.0 * col);
    // Darker toward the riverbed and the far edges.
    col *= mix(0.75, 1.0, smoothstep(-0.5, -0.2, p.y)) * (1.0 - 0.25 * smoothstep(0.55, 0.95, abs(p.x) / max(aspect * 0.5, 0.01)));
    float alpha = 1.0;
    if (vxClear) {
        alpha = clamp(max(col.r, max(col.g, col.b)) * 1.3, 0.0, 1.0);
    } else {
        vec3 deep = mix(vec3(0.004, 0.01, 0.016), ink.rgb * 0.03, 0.5);
        vec3 bg = mix(deep * 0.6, deep * 1.6, smoothstep(-0.5, 0.5, p.y));
        col = bg + col * (1.0 - bg);
    }
    col *= vxPresence;
    alpha *= vxPresence;
    gl_FragColor = vec4(min(col, vec3(alpha)), alpha);
}
