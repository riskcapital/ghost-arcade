/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A breathing ring. One fine circle of light opens as the sound it follows swells and closes as it fades, with thin halo rings echoing it outward a moment later, each fainter than the last. Its outline wavers very slightly. When the music stops it settles into a calm resting breath, about six to the minute, and warms to gold at the top of each breath.",
    "PASSES": [
        {
            "TARGET": "breathState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "echoState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.58, "MIN": 0, "MAX": 1 },
        { "NAME": "haloRings", "LABEL": "Halo rings", "TYPE": "float", "DEFAULT": 3, "MIN": 0, "MAX": 4 },
        { "NAME": "haloSpacing", "LABEL": "Halo spacing", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "softness", "LABEL": "Softness", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "wobble", "LABEL": "Wobble", "TYPE": "float", "DEFAULT": 0.28, "MIN": 0, "MAX": 1 },
        { "NAME": "restTempo", "LABEL": "Rest tempo", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Inner glow", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "brightness", "LABEL": "Brightness", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Ring", "TYPE": "color", "DEFAULT": [0.72, 0.82, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Top of the breath", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.45, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// breathState: r = the breath now (0 out, 1 in), b = how much the music is
// leading (0..1), a = the sound's level, eased. The resting breath runs on
// the clock, so it keeps an even pace. echoState: the breath a little later, four times
// over, for the halo rings.

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
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

// Ring radius, in screen heights, for a breath value.
float radiusFor(float b) {
    float base = mix(0.1, 0.24, size);
    return base * (0.62 + 0.5 * b);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        vec4 st = IMG_NORM_PIXEL(breathState, vec2(0.5));
        if (FRAMEINDEX < 2) st = vec4(0.0);
        float level = clamp(vxEnv, 0.0, 1.0);
        float lv = st.a + (level - st.a) * (1.0 - exp(-dt / (level > st.a ? 0.25 : 0.6)));
        // The music takes the lead within a second; it hands back over a few.
        float lead = st.b + ((level > 0.03 ? 1.0 : 0.0) - st.b) * (1.0 - exp(-dt / (level > 0.03 ? 0.6 : 3.5)));
        // At rest: about six breaths a minute, on real time.
        float bpm = mix(4.0, 9.0, restTempo);
        float ph = fract(TIME * bpm / 60.0);
        float rest = 0.5 - 0.5 * cos(6.2832 * ph);
        rest = rest * rest * (3.0 - 2.0 * rest);
        float b = mix(rest, lv, lead);
        gl_FragColor = vec4(b, ph, lead, lv);
        return;
    }

    if (PASSINDEX == 1) {
        // Each echo follows the one inside it, a beat behind.
        vec4 e = IMG_NORM_PIXEL(echoState, vec2(0.5));
        float b0 = IMG_NORM_PIXEL(breathState, vec2(0.5)).r;
        if (FRAMEINDEX < 2) e = vec4(b0);
        float k = 1.0 - exp(-dt / 0.32);
        vec4 nxt;
        nxt.x = e.x + (b0 - e.x) * k;
        nxt.y = e.y + (e.x - e.y) * k;
        nxt.z = e.z + (e.y - e.z) * k;
        nxt.w = e.w + (e.z - e.w) * k;
        gl_FragColor = nxt;
        return;
    }

    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(1.0));
    float px = max(fw.x, fw.y) / RENDERSIZE.y;
    float len = length(p);
    vec2 dir = p / max(len, 1e-5);

    vec4 st = IMG_NORM_PIXEL(breathState, vec2(0.5));
    vec4 echo = IMG_NORM_PIXEL(echoState, vec2(0.5));
    float b = st.r;

    // A slow, slight waver in the outline, the same all the way round (no seam).
    float t = vxPhase * 0.25;
    float wv = noise2(dir * 1.6 + vec2(t, -t * 0.7)) - 0.5;
    wv += 0.5 * (noise2(dir * 3.3 + vec2(-t * 1.3, t * 0.9) + 7.0) - 0.5);
    float waver = 1.0 + wobble * 0.045 * wv;

    float coreW = mix(0.75, 1.6, softness);
    float haloW = mix(4.0, 18.0, softness);
    float gain = 0.45 + 1.4 * brightness;

    // The ring itself.
    float R = radiusFor(b) * waver;
    float d = (len - R) / px;
    float ring = exp(-d * d / (coreW * coreW)) + 0.1 * exp(-abs(d) / haloW);
    ring *= 0.8 + 0.35 * b;

    // Halo rings: the same breath a moment later, further out, each fainter.
    float halos = 0.0;
    float gap = mix(0.08, 0.3, haloSpacing);
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        if (fi < floor(haloRings + 0.5)) {
            float bi = i == 0 ? echo.x : i == 1 ? echo.y : i == 2 ? echo.z : echo.w;
            float wi = 1.0 + wobble * 0.045 * (1.0 + 0.35 * fi) * wv;
            float Ri = radiusFor(bi) * (1.0 + gap * (fi + 1.0)) * wi;
            float di = (len - Ri) / px;
            float wl = coreW * (0.9 + 0.15 * fi);
            halos += (exp(-di * di / (wl * wl)) + 0.06 * exp(-abs(di) / haloW)) * 0.42 * pow(0.58, fi);
        }
    }

    // A very faint glow inside, gathering toward the ring.
    float inside = clamp(1.0 - len / max(R, 1e-4), 0.0, 1.0);
    float fill = glow * 0.07 * (1.0 - inside) * (1.0 - inside) * step(len, R) * (0.6 + 0.6 * b);
    fill += glow * 0.025 * exp(-len * len / (R * R * 0.12));

    float L = (ring + halos + fill) * gain;
    vec3 col = ink.rgb * (1.0 - exp(-L * 1.5));
    // Gold only on the ring, only at the top of the breath.
    float top = smoothstep(0.72, 1.0, b);
    col = mix(col, accent.rgb * (1.0 - exp(-ring * gain * 1.5)), top * 0.55 * clamp(ring * 1.5, 0.0, 1.0));

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
