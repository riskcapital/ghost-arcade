/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "DESCRIPTION": "Coloured ink dropped into a tank of still, milky water. Each hit lets a drop fall in: it sinks as a heavy plume, its head rolling outward into curling mushroom caps while its tail feathers into threads, and slow currents carry the clouds sideways until they thin and the water clears. The two colours mix where plumes cross. Every frame the water's last picture is carried along its own currents, so the motion is the fluid itself. The music sets how fast the currents run; the swell lets a thin stream of ink trickle in; each hit drops new ink and stirs the whole tank.",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "PASSES": [
        { "TARGET": "blurA", "WIDTH": "$WIDTH/4", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "blurB", "WIDTH": "$WIDTH/16", "HEIGHT": "$HEIGHT/16" },
        { "TARGET": "feedback", "PERSISTENT": true, "FLOAT": true },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "drop", "LABEL": "Ink", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "current", "LABEL": "Current", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "billow", "LABEL": "Billow", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "linger", "LABEL": "Linger", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "soften", "LABEL": "Soften", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "water", "LABEL": "Water", "TYPE": "float", "DEFAULT": 0.85, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Ink", "TYPE": "color", "DEFAULT": [0.3, 0.8, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Second ink", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.6, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxLevel", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 3 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;

// Frames' worth of time this frame took (1 at 60 fps): every rate is per second.
float frameStep() { return clamp(TIMEDELTA * 60.0, 0.25, 4.0); }

float hash11(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }

// How strongly a pigment absorbs each channel: its complement, plus a little of
// everything so even a pale colour reads as ink. Normalised so the strongest is 1.
vec3 absorbOf(vec3 pig) {
    vec3 a = (1.0 - clamp(pig, 0.0, 1.0)) * 0.8 + 0.22;
    return a / max(a.r, max(a.g, a.b));
}

// Slow currents: a divergence-free flow from a stream function made of a few
// crossing waves, so the water swirls without bunching up or thinning out.
vec2 currents(vec2 p, float t) {
    vec2 v = vec2(0.0);
    vec2 k1 = vec2(2.1, 1.3), k2 = vec2(-1.4, 2.6), k3 = vec2(3.7, -2.2), k4 = vec2(-5.3, -4.1);
    float a1 = cos(dot(k1, p) + t * 0.23) * 1.0;
    float a2 = cos(dot(k2, p) - t * 0.17 + 1.9) * 0.8;
    float a3 = cos(dot(k3, p) + t * 0.31 + 4.2) * 0.45;
    float a4 = cos(dot(k4, p) - t * 0.41 + 0.7) * 0.25;
    v += a1 * vec2(k1.y, -k1.x) / length(k1);
    v += a2 * vec2(k2.y, -k2.x) / length(k2);
    v += a3 * vec2(k3.y, -k3.x) / length(k3);
    v += a4 * vec2(k4.y, -k4.x) / length(k4);
    return v;
}

// Where a drop lands for hit number k (0..63): across the upper water.
vec2 dropSite(float k, float aspect) {
    float hx = hash11(k * 1.37 + 0.5);
    float hy = hash11(k * 2.71 + 9.1);
    return vec2((hx - 0.5) * aspect * 0.8, 0.02 + 0.33 * hy);
}

// The ink poured in this frame: rgb = absorbance added, a = density added.
vec4 pourIn(vec2 p, float t, float s, float aspect) {
    vec4 add = vec4(0.0);
    // A drop per hit. The hit count glides on a spring: the drop falls while it
    // travels from one whole number to the next and stops pouring as it settles,
    // so each hit is one drop that swells in and eases off.
    float m = vxMorph;
    float k = ceil(m - 0.02);
    float d = k - m;                       // 1 just after a hit, -> 0 as it settles
    float fall = 1.0 - d;
    float gate = smoothstep(0.06, 0.4, d) * smoothstep(0.02, 0.3, vxPulse);
    float kk = mod(k, 64.0);
    vec2 c = dropSite(kk, aspect);
    c.y -= 0.07 * fall;                    // the drop sinks in as it pours
    float rad = (0.022 + 0.04 * drop) * (0.6 + 0.6 * fall) * (1.0 + 0.35 * vxPulse);
    vec2 dv = p - c;
    float ang = atan(dv.y, dv.x);
    float feather = 1.0 + 0.28 * sin(ang * 3.0 + kk * 2.3) + 0.16 * sin(ang * 5.0 - kk * 1.1);
    float e = dot(dv, dv) / (rad * rad * feather * feather);
    float body = exp(-e);
    float h = hash11(kk * 5.13 + 2.0);
    vec3 pig = mix(ink.rgb, accent.rgb, smoothstep(0.35, 0.65, h));
    float amt = body * gate * s * (0.07 + 0.12 * drop) * clamp(0.6 + 0.4 * vxLevel, 0.4, 1.4);
    add += vec4(absorbOf(pig) * amt, amt);
    // The swell lets a thin stream trickle in from a wandering point.
    vec2 tc = vec2(sin(t * 0.13) * aspect * 0.3 + 0.08 * sin(t * 0.37), 0.3 + 0.05 * sin(t * 0.21));
    vec2 tv = p - tc;
    float tr = exp(-dot(tv, tv) / (0.0006 + 0.0009 * drop));
    float tamt = tr * vxSwell * vxSwell * s * (0.015 + 0.03 * drop);
    vec3 tpig = mix(accent.rgb, ink.rgb, 0.5 + 0.5 * sin(t * 0.09));
    add += vec4(absorbOf(tpig) * tamt, tamt);
    return add;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = vxFlow;
    float s = frameStep();

    if (PASSINDEX == 0) {
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
        float level = clamp(vxLevel, 0.0, 3.0);
        // Currents: slow swirls that run faster with the music and surge on each hit.
        float cv = (0.00035 + 0.0016 * current) * max(0.4, 1.0 + 0.5 * (level - 1.0)) * (1.0 + 0.6 * vxSwell + 2.2 * vxPulse);
        vec2 vel = currents(p * 1.6, t * (0.5 + current)) * cv;
        vel.x += 0.00025 * current * sin(t * 0.05 + 1.3);
        // Billow: heavy ink sinks, its dense heart faster than its edges, and the
        // edges roll outward and back up - a falling plume with curling caps.
        vec2 bpx = 8.0 / RENDERSIZE;
        float dMid = IMG_NORM_PIXEL(blurA, uv).a;
        float dWide = IMG_NORM_PIXEL(blurB, uv).a;
        float gx = IMG_NORM_PIXEL(blurA, uv + vec2(bpx.x, 0.0)).a - IMG_NORM_PIXEL(blurA, uv - vec2(bpx.x, 0.0)).a;
        float gy = IMG_NORM_PIXEL(blurA, uv + vec2(0.0, bpx.y)).a - IMG_NORM_PIXEL(blurA, uv - vec2(0.0, bpx.y)).a;
        vec2 g = vec2(gx, gy);
        float bw = billow * (1.0 + 0.8 * vxPulse);
        vel.y -= 0.0005 + bw * (0.003 * dWide + 0.009 * dMid);
        // Sides of a falling cloud lag behind and spread: the cap rolls over.
        vel += bw * vec2(-g.x * 0.008, abs(g.x) * 0.01);
        // The ink stirs itself: finer eddies inside the clouds tear them into threads.
        vel += bw * currents(p * 9.0 + 3.1, t * 1.1) * 0.0022 * smoothstep(0.0, 0.2, dMid);
        vec2 src = uv - vel * s / vec2(aspect, 1.0);
        vec2 eb = smoothstep(vec2(0.0), vec2(0.004), src) * smoothstep(vec2(0.0), vec2(0.004), 1.0 - src);
        float inside = eb.x * eb.y;
        vec4 prev = clamp(IMG_NORM_PIXEL(feedback, src), 0.0, 1.0) * inside;
        // Soften: the ink diffuses into the water.
        vec4 soft = clamp(IMG_NORM_PIXEL(blurA, src), 0.0, 1.0) * inside;
        prev = mix(prev, soft, clamp(s * (0.004 + 0.04 * soften * soften), 0.0, 1.0));
        // Keep the threads crisp: an unsharp mask that only moves ink, never adds it.
        // Scaled as a whole so the ink's colour never fringes.
        float sharpA = clamp(prev.a + (prev.a - soft.a) * 0.02 * s * (1.0 - soften), 0.0, 1.0);
        prev *= sharpA / max(prev.a, 0.0005);
        prev = clamp(prev, 0.0, 1.0);
        // Fade: the water slowly clears. Always loses at least a little.
        float keep = pow(mix(0.982, 0.9965, linger), max(s, 1.0));
        vec4 col = max(prev * keep - vec4(0.0007 * max(s, 1.0)), vec4(0.0));
        if (FRAMEINDEX < 2) col = vec4(0.0);
        vec4 add = pourIn(p, t, s, aspect);
        col = col + add * (1.0 - col);
        gl_FragColor = clamp(col, 0.0, 1.0);
        return;
    }

    // The picture: ink seen through lit water. Light passing through the ink is
    // absorbed per channel, so thin veils tint and dense hearts go deep; edges of
    // the clouds gather a little extra pigment, as wet ink does.
    vec4 fb = clamp(IMG_NORM_PIXEL(feedback, uv), 0.0, 1.0);
    vec4 bA = IMG_NORM_PIXEL(blurA, uv);
    float rim = clamp(fb.a - bA.a, 0.0, 1.0);
    vec3 absorb = fb.rgb * (1.0 + 2.2 * rim);
    vec3 trans = exp(-absorb * 4.0);
    float dens = 1.0 - exp(-fb.a * 3.4);
    vec3 col;
    float alpha = 1.0;
    if (vxClear) {
        // On its own: the pigment's colour, deepening as it thickens.
        vec3 hue = exp(-fb.rgb / max(fb.a, 0.002) * 2.2);
        col = hue * mix(0.95, 0.35, dens);
        alpha = clamp(dens * 1.15, 0.0, 1.0);
        col *= alpha;
    } else {
        // Milky water lit from above, a faint shadow of the ink on the back of the tank.
        vec3 tint = mix(ink.rgb, accent.rgb, 0.5);
        tint = mix(vec3(dot(tint, vec3(0.333))), tint, 0.25);
        vec3 paper = mix(vec3(0.98, 0.965, 0.93), tint, 0.08) * mix(0.42, 1.0, water);
        vec2 q = uv - 0.5;
        paper *= (0.9 + 0.12 * uv.y) * (1.0 - 0.3 * dot(q, q));
        float shade = IMG_NORM_PIXEL(blurB, uv + vec2(-0.012, 0.02)).a;
        paper *= 1.0 - 0.3 * clamp(shade, 0.0, 1.0);
        col = paper * trans;
    }
    col *= vxPresence;
    alpha *= vxPresence;
    gl_FragColor = vec4(min(col, vec3(alpha)), alpha);
}
