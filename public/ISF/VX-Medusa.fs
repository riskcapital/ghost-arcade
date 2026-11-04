/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A glowing jellyfish hangs in deep water, its glassy bell laced with moving ripples of light and four bright rings at its heart, trailing frilled arms and long fine tentacles. The music pumps the bell: each surge clenches it and lifts it, it springs back with a soft rebound, and the motion rolls down the tentacles behind it like a wave. A held sound makes the light inside burn brighter and the whole creature swim faster; with no sound it breathes slowly on its own.",
    "PASSES": [
        {
            "TARGET": "pump",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 2,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "pulse", "LABEL": "Pulse", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Inner light", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "tentacles", "LABEL": "Tentacle length", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "bellSize", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "snow", "LABEL": "Sea snow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Body", "TYPE": "color", "DEFAULT": [0.55, 0.85, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Heart", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.8, 1.0] },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const int STRANDS = 22;
const int ARMS = 4;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Caustic net: gap between the nearest and second-nearest moving points.
float net(vec2 p, float t) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 h = hash22(i + g);
            vec2 o = 0.5 + 0.4 * sin(t * (0.7 + 0.6 * h.yx) + 6.2832 * h);
            vec2 r = g + o - f;
            float d = dot(r, r);
            if (d < d1) {
                d2 = d1;
                d1 = d;
            } else if (d < d2) {
                d2 = d;
            }
        }
    }
    return sqrt(d2) - sqrt(d1);
}

// The pump's value partway down a tentacle: the further down, the later.
float lagChain(float u, vec4 c) {
    float k = clamp(u, 0.0, 1.0) * 3.0;
    if (k < 1.0) return mix(c.x, c.y, k);
    if (k < 2.0) return mix(c.y, c.z, k - 1.0);
    return mix(c.z, c.w, k - 2.0);
}

void main() {
    if (PASSINDEX == 0) {
        // A spring that follows the music's surges, plus three lagging copies
        // of it, so motion can trail behind the beat with real follow-through.
        vec4 s0 = IMG_NORM_PIXEL(pump, vec2(0.25, 0.5));
        vec4 s1 = IMG_NORM_PIXEL(pump, vec2(0.75, 0.5));
        if (s0.a < 0.5) {
            s0 = vec4(0.0, 0.0, 0.0, 1.0);
            s1 = vec4(0.0, 0.0, 0.0, 1.0);
        }
        float dt = clamp(TIMEDELTA, 0.0, 0.05);
        float tgt = (1.0 - exp(-2.0 * vxPulse * pulse)) * 1.0 + vxSwell * 0.12 + 0.3 * pow(0.5 + 0.5 * sin(vxFlow * 3.0), 3.0);
        float accel = -60.0 * (s0.x - tgt) - 6.5 * s0.y;
        s0.y += accel * dt;
        s0.x += s0.y * dt;
        s0.z += (s0.x - s0.z) * (1.0 - exp(-dt / 0.12));
        s1.x += (s0.z - s1.x) * (1.0 - exp(-dt / 0.18));
        s1.y += (s1.x - s1.y) * (1.0 - exp(-dt / 0.25));
        // The held level, eased again so big swells build over a few frames.
        s1.z += (vxSwell - s1.z) * (1.0 - exp(-dt / 0.2));
        s0.a = 1.0;
        s1.a = 1.0;
        gl_FragColor = gl_FragCoord.x < 1.0 ? s0 : s1;
        return;
    }
    vec4 pS0 = IMG_NORM_PIXEL(pump, vec2(0.25, 0.5));
    vec4 pS1 = IMG_NORM_PIXEL(pump, vec2(0.75, 0.5));
    if (pS0.a < 0.5) {
        pS0 = vec4(0.0);
        pS1 = vec4(0.0);
    }
    float sprX = pS0.x;
    float sprLagA = pS0.z;
    float sprLagB = pS1.x;
    float sprLagC = pS1.y;
    float swellE = pS1.z;
    vec4 chain = vec4(sprX, sprLagA, sprLagB, sprLagC);

    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    p *= max(1.0, 1.2 / aspect);
    float px = 1.5 / RENDERSIZE.y;
    bool clearMode = vxClear;

    float t = vxFlow * 0.55;
    // The bell's clench: the spring, overshooting a little as it relaxes.
    float sq = clamp(sprX, -0.25, 1.2);
    float energy = clamp(0.4 + 0.45 * swellE + 0.2 * max(sprLagA, 0.0), 0.0, 1.0);

    float S = mix(0.75, 1.25, bellSize);
    vec2 C = vec2(0.32 * sin(t * 0.23) * drift + (vxGlide - 0.5) * 0.25 * drift,
                  0.13 + 0.04 * sin(t * 0.41) * drift + 0.05 * sprLagA);
    C *= vec2(1.0, 1.0);
    float tilt = 0.18 * sin(t * 0.37) * drift;
    vec2 q = p - C;
    float cs = cos(tilt);
    float sn = sin(tilt);
    q = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y) / S;

    float W = 0.3 * (1.0 - 0.22 * sq);
    float Hh = 0.22 * (1.0 + 0.2 * sq);

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // ---- Tentacles and arms behind the bell.
    float rimY = -0.2 * Hh;
    float lenT = mix(0.35, 0.95, tentacles);
    float tl = 0.0;
    vec3 tcol = vec3(0.0);
    for (int i = 0; i < STRANDS; i++) {
        float fi = float(i);
        float u = (fi + 0.5) / float(STRANDS) * 2.0 - 1.0;
        float x0 = u * W * 0.94;
        float uu = clamp(u * 0.94, -1.0, 1.0);
        float s = Hh * (-0.2 + 0.42 * (1.0 - uu * uu)) - 0.006 - q.y;
        float len = lenT * (0.65 + 0.35 * hash11(fi * 3.1));
        if (s > -0.01 && s < len) {
            float lag = lagChain(s / len, chain);
            float sway = sin(s * (7.0 + 3.0 * hash11(fi)) - t * 2.2 + fi * 1.7) * 0.05 * s / max(len, 0.1) * 2.0;
            float xt = x0 * (1.0 - 0.32 * lag + 0.15 * s) + sway + 0.12 * sin(t * 0.5 + s * 2.0) * s * drift;
            float d = abs(q.x - xt);
            float wdt = 0.0035 * (1.0 - 0.6 * s / len) + px * 0.6;
            float fade = smoothstep(len, len * 0.55, s) * smoothstep(-0.01, 0.02, s);
            float line = exp(-d * d / (wdt * wdt)) + 0.25 * exp(-d / (wdt * 6.0));
            // Sparks of light run down each strand.
            float bead = 0.6 + 0.8 * pow(0.5 + 0.5 * sin(s * 40.0 - t * 6.0 - fi * 2.0), 6.0) * energy;
            float v = line * fade * bead;
            tl = max(tl, v);
            tcol += mix(ink.rgb, accent.rgb, s / len * 0.7) * v;
        }
    }
    // Four frilled mouth arms down the middle.
    float armA = 0.0;
    vec3 armC = vec3(0.0);
    for (int k = 0; k < ARMS; k++) {
        float fk = float(k);
        float s = Hh * 0.2 - q.y;
        float len = lenT * 0.62 + Hh * 0.4;
        if (s > 0.0 && s < len) {
            float lag = lagChain(s / len, chain);
            float xc = (fk - 1.5) * 0.035 * (1.0 + 0.8 * s) + sin(s * 6.0 - t * 1.4 + fk * 1.3) * 0.035 * s * 2.0 * (1.0 - 0.5 * lag);
            float wdt = (0.022 + 0.014 * sin(s * 45.0 - t * 3.0 + fk)) * (1.0 - 0.7 * s / len);
            float d = abs(q.x - xc) - wdt;
            float body = smoothstep(px * 2.0, -px * 2.0, d);
            float edge = exp(-abs(d) / 0.004);
            float fade = smoothstep(len, len * 0.5, s);
            float a = (body * 0.5 + edge * 0.8) * fade;
            armA = max(armA, a);
            armC += mix(accent.rgb, ink.rgb, 0.35) * (body * 0.35 + edge * 1.1) * fade;
        }
    }
    col += tcol * (0.75 + 0.4 * energy) + armC * (0.6 + 0.4 * energy);
    alpha = max(1.0 - exp(-2.2 * tl), armA);

    // ---- The bell.
    vec2 e2 = vec2(q.x / W, q.y / Hh);
    float er = length(e2);
    float xr = clamp(q.x / W, -1.2, 1.2);
    // Scalloped lip, higher in the middle where the bell is hollow.
    float lip = Hh * (-0.2 + 0.42 * (1.0 - xr * xr)) - 0.012 * abs(sin(xr * 15.0 + t * 0.5)) * (0.4 + 0.6 * xr * xr);
    float dOut = (er - 1.0) * min(W, Hh);
    float dLip = lip - q.y;
    float dBell = max(dOut, dLip);
    float bellCov = smoothstep(px * 1.5, -px * 1.5, dBell);
    if (bellCov > 0.0 || dBell < 0.05) {
        float nz = sqrt(max(1.0 - er * er, 0.0));
        float rim = pow(1.0 - nz, 2.5);
        // Light rippling through the jelly, wrapped over the dome.
        vec2 wq = q / (0.35 + nz) * 9.0 + vec2(0.0, t * 0.4);
        float nn = net(wq, t * 1.6);
        float strands = exp(-nn * nn / 0.006) * (0.4 + 0.9 * noise2(wq * 0.4 + t * 0.2));
        // Radial canals from the crown.
        float ang = atan(q.x, q.y + Hh * 0.2);
        float canal = exp(-pow(sin(ang * 8.0) * 6.0, 2.0)) * smoothstep(0.15, 0.6, er) * 0.5;
        // Four glowing rings near the crown, seen in perspective.
        vec2 g = vec2(q.x, (q.y - Hh * 0.38) * 1.9);
        float rings = 0.0;
        for (int k = 0; k < 4; k++) {
            float a = 0.785 + float(k) * 1.5708 + t * 0.1;
            vec2 cc = vec2(cos(a), sin(a)) * W * 0.27;
            float d = abs(length(g - cc) - W * 0.13 * (1.0 + 0.15 * sq));
            rings += exp(-d * d / (0.00012 + 0.0001 * sq));
        }
        float inner = glow * energy * (1.0 + 1.4 * sq);
        vec3 bc = ink.rgb * (0.10 + 0.55 * rim) + ink.rgb * strands * 0.75 * inner;
        bc += mix(ink.rgb, vec3(1.0), 0.5) * canal * inner * 0.6;
        bc += accent.rgb * rings * (0.45 + 0.9 * inner);
        // Bright frilled lip.
        float lipLine = exp(-abs(dLip) / 0.006) * smoothstep(0.02, -0.02, dOut);
        bc += mix(ink.rgb, accent.rgb, 0.3) * lipLine * (0.6 + 0.8 * sq);
        // The hollow underside glows where the light gathers at the mouth.
        float under = exp(-max(dLip, 0.0) / 0.05) * (1.0 - 0.6 * abs(xr));
        bc += mix(ink.rgb, accent.rgb, 0.5) * under * (0.25 + 0.5 * inner);
        // Soft halo just outside the bell.
        float halo = exp(-max(dBell, 0.0) / 0.03) * (1.0 - bellCov) * 0.35 * (0.6 + 0.8 * sq);
        float bellA = clamp(0.38 + 0.6 * rim + under * 0.3 + strands * 0.25 * inner + rings * 0.6 + lipLine, 0.0, 1.0);
        // The bell sits in front: tentacles show dimly through it.
        col = mix(col, col * 0.6 + bc, bellCov) + ink.rgb * halo;
        alpha = mix(alpha, max(bellA, alpha * 0.6), bellCov);
        alpha = max(alpha, halo * 0.8);
    }

    vec3 outc = col;
    if (!clearMode) {
        // Deep water: dark falling to black, faint light from above, sea snow.
        vec3 deep = mix(vec3(0.004, 0.008, 0.02), ink.rgb * 0.09 + accent.rgb * 0.02, smoothstep(-0.6, 0.6, p.y));
        float shafts = pow(noise2(vec2(p.x * 3.0 + p.y * 0.8, t * 0.15)), 3.0) * smoothstep(-0.4, 0.6, p.y) * 0.12;
        deep += ink.rgb * shafts;
        float sn2 = 0.0;
        for (int L = 0; L < 2; L++) {
            float z = 1.0 + float(L);
            vec2 sp = p * 14.0 * z + vec2(t * 0.1, t * 0.25 / z);
            vec2 cell = floor(sp);
            vec2 h = hash22(cell + float(L) * 17.0);
            float d = length(fract(sp) - h);
            sn2 += smoothstep(0.08 / z + 0.02, 0.0, d) * step(0.7, h.x) / z;
        }
        deep += vec3(0.7, 0.8, 0.9) * sn2 * 0.25 * snow;
        outc = deep * (1.0 - alpha) + col;
        outc = outc / (1.0 + 0.15 * max(outc.r, max(outc.g, outc.b)));
        outc += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
        gl_FragColor = vec4(clamp(outc, 0.0, 1.0) * vxPresence, 1.0);
    } else {
        alpha = clamp(alpha, 0.0, 1.0);
        outc = outc / (1.0 + 0.15 * max(outc.r, max(outc.g, outc.b)));
        outc = min(max(outc, 0.0), vec3(alpha));
        gl_FragColor = vec4(outc, alpha) * vxPresence;
    }
}
