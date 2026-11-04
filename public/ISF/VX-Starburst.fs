/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A burst of light rushing toward you. Sparks are born near a vanishing point that drifts and swerves across the frame, then fly outward faster and faster as they come closer, and every frame the picture is pushed outward from that point - hardest at the edges - so each spark leaves a speed line behind it. Soft rays fan out from the source, and the light splits like a prism as it flies: red runs ahead, blue trails behind. The music sets the speed of the rush; the swell brightens the rays and the source; each hit punches the burst outward, fills the air with extra sparks, swerves the vanishing point and flares the core, then it settles.",
    "PASSES": [
        { "TARGET": "blurA", "WIDTH": "$WIDTH/4", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "blurB", "WIDTH": "$WIDTH/16", "HEIGHT": "$HEIGHT/16" },
        { "TARGET": "feedback", "PERSISTENT": true, "FLOAT": true },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "sparks", "LABEL": "Sparks", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "trails", "LABEL": "Trails", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "prism", "LABEL": "Prism", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "wander", "LABEL": "Wander", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "rays", "LABEL": "Rays", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "flare", "LABEL": "Flare", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.35, 0.75, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Second light", "TYPE": "color", "DEFAULT": [1.0, 0.55, 0.25, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxLevel", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 3 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Frames' worth of time this frame took (1 at 60 fps): every rate is per second.
float frameStep() { return clamp(TIMEDELTA * 60.0, 0.25, 4.0); }

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// Four steady pseudo-random numbers for a cell.
vec4 cellRand(vec3 p) {
    p = fract(p * vec3(0.4142136, 0.7320508, 0.2360680) + vec3(0.17, 0.53, 0.31));
    p += dot(p, p.zxy * 23.17 + 11.3);
    return fract(vec4(p.x * p.y * 3.1, p.y * p.z * 2.7, p.z * p.x * 4.3, (p.x + p.y) * p.z * 3.7) * 41.9);
}

// The vanishing point (uv): drifts on slow mismatched curves, leans with the pitch,
// and swerves a step on each hit (a sixteenth of a turn, so 64 hits wrap seamlessly).
vec2 vanish(float t) {
    vec2 c = vec2(0.17 * sin(t * 0.11 + 0.4) + 0.06 * sin(t * 0.27 + 2.2),
                  0.12 * sin(t * 0.13 + 2.0) + 0.05 * sin(t * 0.31 + 1.0));
    float hm = vxMorph * TAU / 16.0;
    c += 0.06 * vec2(sin(hm), 0.7 * sin(hm * 2.0 + 1.0));
    c.x += (vxGlide - 0.5) * 0.14;
    return 0.5 + c * 1.5 * wander;
}

// The look's motion: where this pixel's light was last frame. Everything streams outward from
// the vanishing point, faster further out, so light accelerates as it comes closer.
// k shifts the push per colour channel: red is pushed a little harder than blue.
vec2 sourceOf(vec2 uv, vec2 c, float aspect, float t, float s, float k) {
    vec2 p = (uv - c) * vec2(aspect, 1.0);
    float r = length(p);
    float level = clamp(vxLevel, 0.0, 3.0);
    float rate = (0.004 + 0.014 * speed) * max(0.3, 1.0 + 0.6 * (level - 1.0))
               + 0.004 * vxSwell + 0.04 * (0.3 + speed) * vxPulse;
    float zoom = 1.0 + s * rate * (0.25 + 2.0 * r) * (1.0 + k * prism * (0.05 + 0.08 * vxPulse));
    // A faint turn of the whole sky, so the speed lines bend gently as the source drifts.
    float turn = s * 0.0012 * sin(t * 0.17 + 1.3);
    p = rot2(turn) * p / zoom;
    return c + p / vec2(aspect, 1.0);
}

// The look's new light, around the vanishing point: sparks flying out of the distance,
// soft rays fanning from the source, and a core that flares on each hit.
vec3 pourIn(vec2 p, float t, out float cover) {
    float r = length(p);
    float aN = atan(p.y, p.x) / TAU + 0.5;
    float px = 1.0 / RENDERSIZE.y;
    // How far the clock runs in a tenth of a second: the length of a spark's streak.
    float dFlow = (0.25 + 1.4 * vxSwell + 0.9 * vxPulse) * 0.1;
    // How many cells carry a spark: the knob, and each hit fills more of them in (smoothly).
    float dens = mix(0.18, 0.75, sparks);
    float thresh = dens + (1.0 - dens) * 0.7 * vxPulse;
    float energy = 0.55 + 0.45 * vxSwell + 0.6 * vxPulse;
    // Light that stays put (rays, the source) is poured per second, not per frame,
    // so it settles at the same brightness at any frame rate.
    float perSec = 0.5 * frameStep();
    vec3 col = vec3(0.0);
    for (int L = 0; L < 3; L++) {
        float fL = float(L);
        float N = floor(26.0 + 20.0 * fL + 26.0 * sparks);
        float au = fract(aN + fL * 0.137) * N;
        float cell = floor(au);
        for (int o = -1; o <= 1; o++) {
            float ci = mod(cell + float(o), N);
            vec4 h = cellRand(vec3(ci, fL, 7.0));
            float rateL = 0.36 + 0.3 * h.x;
            float ph = t * rateL + h.y;
            float gen = floor(ph);
            float age = fract(ph);
            vec4 g = cellRand(vec3(ci, fL + 3.0, gen));
            float vis = 1.0 - smoothstep(thresh - 0.08, thresh, g.x);
            if (vis <= 0.0) continue;
            // Perspective: the spark comes closer (z falls), so it flies out ever faster.
            float rb = 0.012 + 0.045 * g.y;
            float z = 1.0 - 0.965 * age;
            float rh = rb / z;
            // Its tail spans the last tenth of a second of travel, so fast sparks read as streaks.
            float agePrev = max(age - rateL * dFlow - 0.012, 0.0);
            float rt = rb / (1.0 - 0.965 * agePrev);
            // Across: a soft line whose width grows with distance (perspective), never thinner
            // than a pixel and a bit.
            float da = au - (ci + 0.5 + (g.z - 0.5) * 0.5);
            da -= N * floor(da / N + 0.5);
            float arc = da / N * TAU * r;
            float wArc = max(0.12 * TAU * r / N * (1.0 + 0.4 * vxPulse), 1.3 * px);
            float e = max(wArc * 0.7, px);
            float seg = smoothstep(rt - e, rt + e * 0.5, r) * (1.0 - smoothstep(rh - e * 0.5, rh + e, r));
            float head = mix(0.35, 1.0, clamp((r - rt) / max(rh - rt, 1e-4), 0.0, 1.0));
            float bright = min(1.6, 0.2 / z);
            float env = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.86, 1.0, age));
            float across = exp(-arc * arc / (wArc * wArc));
            float amt = vis * env * bright * across * seg * head * energy;
            vec3 sc = mix(ink.rgb, accent.rgb, smoothstep(0.3, 0.7, g.w));
            sc = mix(sc, vec3(1.0), 0.25 * exp(-arc * arc / (wArc * wArc * 0.16)));
            col += sc * amt;
        }
    }
    // Rays: soft spokes from the source that turn slowly (whole-number frequencies, so they wrap).
    float a = aN * TAU;
    float ray = pow(max(0.0, sin(7.0 * a + 1.3 * sin(3.0 * a + t * 0.21) + t * 0.13)), 6.0)
              + 0.7 * pow(max(0.0, sin(11.0 * a - 0.9 * sin(5.0 * a - t * 0.17) - t * 0.09)), 8.0);
    col += mix(ink.rgb, accent.rgb, 0.5 + 0.5 * sin(a * 2.0 + t * 0.11)) * ray * rays
         * (0.006 + 0.016 * vxSwell + 0.03 * vxPulse) * smoothstep(0.02, 0.2, r) * exp(-r * 1.2) * perSec;
    // The source: a small steady glow that flares on each hit.
    col += mix(vec3(1.0), mix(ink.rgb, accent.rgb, 0.5), 0.4)
         * exp(-r * r / (0.0004 + 0.0025 * vxPulse)) * (0.03 + 0.05 * vxSwell + 0.3 * vxPulse) * (0.5 + flare) * perSec;
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
        // A much wider blur, for the halo.
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
    vec2 c = vanish(t);
    if (PASSINDEX == 2) {
        // Each colour is carried out by its own push: the light splits as it flies.
        vec2 sR = sourceOf(uv, c, aspect, t, s, 1.0);
        vec2 sG = sourceOf(uv, c, aspect, t, s, 0.0);
        vec2 sB = sourceOf(uv, c, aspect, t, s, -1.0);
        vec4 pg = clamp(IMG_NORM_PIXEL(feedback, sG), 0.0, 1.0);
        vec4 prev = vec4(clamp(IMG_NORM_PIXEL(feedback, sR).r, 0.0, 1.0), pg.g,
                         clamp(IMG_NORM_PIXEL(feedback, sB).b, 0.0, 1.0), pg.a);
        // Fade: Trails sets how long the speed lines hang. Always at least a frame's worth.
        float keep = pow(mix(0.86, 0.955, trails) + 0.008 * vxSwell, max(s, 1.0));
        vec4 col = max(prev * keep - vec4(0.002 * max(s, 1.0)), vec4(0.0));
        if (FRAMEINDEX < 2) col = vec4(0.0);
        vec2 p = (uv - c) * vec2(aspect, 1.0);
        float cv;
        vec3 add = pourIn(p, t, cv);
        col.rgb = col.rgb + add * (1.0 - col.rgb);
        col.a = clamp(col.a + cv * (1.0 - col.a), 0.0, 1.0);
        gl_FragColor = clamp(col, 0.0, 1.0);
        return;
    }

    // The picture: a prism split outward from the source, light scattered along the rays,
    // a halo, and the hottest light burning to white.
    vec2 d = uv - c;
    float r = length(d * vec2(aspect, 1.0));
    float k = prism * (0.004 + 0.004 * vxSwell + 0.012 * vxPulse) * (0.3 + r);
    vec3 base = vec3(IMG_NORM_PIXEL(feedback, c + d * (1.0 - k)).r,
                     IMG_NORM_PIXEL(feedback, uv).g,
                     IMG_NORM_PIXEL(feedback, c + d * (1.0 + k)).b);
    vec3 scatter = vec3(0.0);
    float sw = 0.0;
    for (int i = 1; i <= 8; i++) {
        float fi = float(i);
        float w = exp(-fi * 0.3);
        scatter += IMG_NORM_PIXEL(blurA, c + d * (1.0 - 0.045 * fi)).rgb * w;
        sw += w;
    }
    scatter /= sw;
    vec3 glow = IMG_NORM_PIXEL(blurB, uv).rgb;
    vec3 light = base * 1.1 + (scatter * (0.3 + 0.35 * vxPulse) + glow * (0.12 + 0.1 * vxSwell + 0.25 * vxPulse)) * (0.4 + flare);
    vec3 col = 1.0 - exp(-light * 1.6);
    float m = max(col.r, max(col.g, col.b));
    col = mix(col, vec3(m), smoothstep(0.8, 1.0, m) * 0.35);
    // Deep blacks between the streaks, and a gentle vignette.
    col = col * col * (3.0 - 2.0 * col);
    col *= 1.0 - 0.3 * smoothstep(0.55, 1.15, length((uv - 0.5) * vec2(aspect, 1.0)));
    float alpha = 1.0;
    if (vxClear) {
        alpha = clamp(max(col.r, max(col.g, col.b)) * 1.3, 0.0, 1.0);
    } else {
        vec3 tint = mix(ink.rgb, accent.rgb, 0.5);
        vec3 bg = vec3(0.005, 0.006, 0.012) + tint * 0.03 * exp(-r * 2.5) * (1.0 + vxSwell);
        col = bg + col * (1.0 - bg);
    }
    col *= vxPresence;
    alpha *= vxPresence;
    gl_FragColor = vec4(min(col, vec3(alpha)), alpha);
}
