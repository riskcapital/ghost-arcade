/*{
    "DESCRIPTION": "Murmur — a slow flock of glowing motes drifting in 3D space, like a quiet starling murmuration or deep-sea bioluminescence. NATIVELY AUDIO-REACTIVE in the Milkdrop sense: nothing snaps. Mids smoothly tighten the cohesion of the flock (the cloud breathes inward/outward), treble lights a handful of motes into brief golden sparkles, bass adds a gentle bloom over the whole field, energy modulates the drift rate. Each mote follows its own slow procedural orbit so the flock is always reorganising even with no music — audio just sculpts its mood. Smoothness is layered: 16 FFT bins per band + dynamics compression + always-on baseline.",
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Audio Reactive", "Particles"],
    "INPUTS": [
        { "NAME": "audioGain",      "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Audio Sensitivity" },
        { "NAME": "midToCohesion",  "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Mid → Cohesion" },
        { "NAME": "trebToSparkle",  "TYPE": "float", "DEFAULT": 0.9,  "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Treble → Sparkle" },
        { "NAME": "bassToBloom",    "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Bass → Bloom" },
        { "NAME": "energyToFlow",   "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Energy → Drift" },
        { "NAME": "smoothness",     "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.1,   "MAX": 1.0,  "LABEL": "Response Smoothness" },
        { "NAME": "bassLo",         "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bass Band Lo" },
        { "NAME": "bassHi",         "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bass Band Hi" },
        { "NAME": "midLo",          "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Mid Band Lo" },
        { "NAME": "midHi",          "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Mid Band Hi" },
        { "NAME": "trebLo",         "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Treble Band Lo" },
        { "NAME": "trebHi",         "TYPE": "float", "DEFAULT": 0.80, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Treble Band Hi" },
        { "NAME": "moteCount",      "TYPE": "float", "DEFAULT": 70.0, "MIN": 8.0,   "MAX": 120.0,"LABEL": "Mote Count" },
        { "NAME": "scatterR",       "TYPE": "float", "DEFAULT": 1.6,  "MIN": 0.4,   "MAX": 4.0,  "LABEL": "Flock Spread" },
        { "NAME": "scatterY",       "TYPE": "float", "DEFAULT": 1.4,  "MIN": 0.2,   "MAX": 4.0,  "LABEL": "Vertical Spread" },
        { "NAME": "moteSize",       "TYPE": "float", "DEFAULT": 0.022,"MIN": 0.004, "MAX": 0.08, "LABEL": "Mote Size" },
        { "NAME": "moteSoftness",   "TYPE": "float", "DEFAULT": 1.6,  "MIN": 0.6,   "MAX": 4.0,  "LABEL": "Mote Softness" },
        { "NAME": "brightness",     "TYPE": "float", "DEFAULT": 1.1,  "MIN": 0.1,   "MAX": 3.0,  "LABEL": "Brightness" },
        { "NAME": "flowSpeed",      "TYPE": "float", "DEFAULT": 0.18, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Drift Speed" },
        { "NAME": "orbitSpeed",     "TYPE": "float", "DEFAULT": 0.08, "MIN": -1.0,  "MAX": 1.0,  "LABEL": "Orbit Speed" },
        { "NAME": "paletteSpeed",   "TYPE": "float", "DEFAULT": 0.03, "MIN": 0.0,   "MAX": 0.5,  "LABEL": "Palette Pace" },
        { "NAME": "paletteSpread",  "TYPE": "float", "DEFAULT": 1.10, "MIN": 0.30,  "MAX": 2.0,  "LABEL": "Palette Spread" },
        { "NAME": "paletteShift",   "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Palette Shift" },
        { "NAME": "sparkleHue",     "TYPE": "float", "DEFAULT": 0.10, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Sparkle Hue" },
        { "NAME": "haze",           "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Background Haze" },
        { "NAME": "depthFade",      "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Depth Fade" },
        { "NAME": "camDist",        "TYPE": "float", "DEFAULT": 4.0,  "MIN": 2.0,   "MAX": 10.0, "LABEL": "Camera Distance" },
        { "NAME": "fov",            "TYPE": "float", "DEFAULT": 1.2,  "MIN": 0.50,  "MAX": 2.5,  "LABEL": "Field of View" },
        { "NAME": "saturation",     "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Saturation" },
        { "NAME": "contrast",       "TYPE": "float", "DEFAULT": 1.05, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Contrast" },
        { "NAME": "gamma",          "TYPE": "float", "DEFAULT": 0.95, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Gamma" },
        { "NAME": "vignette",       "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Vignette" },
        { "NAME": "grain",          "TYPE": "float", "DEFAULT": 0.015,"MIN": 0.0,   "MAX": 0.30, "LABEL": "Film Grain" }
    ]
}*/

precision highp float;

#define PI  3.14159265359
#define TAU 6.28318530718
#define BAND_BINS 16
#define MAX_MOTES 120

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 pal(float t) {
    vec3 a = vec3(0.5), b = vec3(0.5);
    vec3 c = vec3(paletteSpread);
    vec3 d = vec3(0.0, 0.33, 0.67) + paletteShift;
    return a + b * cos(TAU * (c * t + d));
}

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

vec3 hue2rgb(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

// ── Milkdrop-smoothed band (same chain as Drift / Tide).
float audioBand(float lo, float hi) {
    float sum = 0.0;
    for (int i = 0; i < BAND_BINS; i++) {
        float u = mix(lo, hi, (float(i) + 0.5) / float(BAND_BINS));
        sum += sampleFFT(u);
    }
    float raw = (sum / float(BAND_BINS)) * audioGain;
    float compressed = pow(clamp(raw, 0.0, 1.0), mix(1.0, 0.35, smoothness));
    return mix(compressed, 0.4 + 0.6 * compressed, smoothness);
}

// Each mote follows its own slow procedural orbit. `cohesion` (0..1) softly
// pulls them toward the centre — it's the only place audio can move them,
// and it does so smoothly (mids ride a dampened curve), so the flock
// breathes in/out instead of jumping.
vec3 motePos(int i, float t, float cohesion) {
    float fi = float(i);
    float h1 = hash11(fi * 1.71 + 1.3);
    float h2 = hash11(fi * 2.33 + 7.1);
    float h3 = hash11(fi * 3.07 + 11.7);
    float h4 = hash11(fi * 4.19 + 17.3);

    float r0 = mix(0.5, scatterR, h1);
    float r  = mix(r0, r0 * 0.35, cohesion);
    float ang0 = h2 * TAU;
    float angSpeed = (h3 - 0.5) * 0.6;
    float ang  = ang0 + t * angSpeed;
    float y0 = (h4 - 0.5) * 2.0 * scatterY;
    float yWobble = 0.25 * sin(t * 0.4 + fi * 1.7) * scatterY;

    return vec3(r * cos(ang), y0 + yWobble, r * sin(ang));
}

void main() {
    // Audio bands (Milkdrop-smoothed).
    float bass   = audioBand(bassLo, bassHi);
    float mid    = audioBand(midLo,  midHi);
    float treb   = audioBand(trebLo, trebHi);
    float energy = audioBand(0.0,    0.7);

    vec2 R = RENDERSIZE;
    vec2 uv = (gl_FragCoord.xy - 0.5 * R) / min(R.x, R.y);

    // Always-evolving time; audio modulates the rate gently.
    float t   = TIME * flowSpeed * (1.0 + energyToFlow * energy);
    float palT = TIME * paletteSpeed;
    float cohesion = clamp(midToCohesion * mid, 0.0, 1.0);
    float orbitYaw = TIME * orbitSpeed;

    vec3 col = vec3(0.0);

    // ── Loop over motes. Each contributes a soft glow at its projected
    // position; size scales inversely with depth (close motes are larger),
    // brightness fades with depth, colour is the cosine palette by mote id.
    for (int i = 0; i < MAX_MOTES; i++) {
        float fi = float(i);
        if (fi >= moteCount) break;

        // World-space mote position; then orbit the world around Y for the
        // camera-orbit illusion (cheaper than transforming a real camera).
        vec3 p = motePos(i, t, cohesion);
        p.xz *= rot(orbitYaw);

        // Push the flock in front of the camera (at z = camDist).
        p.z += camDist;

        // Skip motes behind the near plane.
        if (p.z < 0.15) continue;

        // Perspective projection (camera at origin looking +z).
        vec2 screen = (p.xy / p.z) * fov;
        vec2 d2 = uv - screen;
        float dsq = dot(d2, d2);

        // Soft glow — size scales with proximity, falloff softness configurable.
        float sz = moteSize / p.z;
        float glow = exp(-dsq / (sz * sz * moteSoftness));

        // Depth-fade so far motes recede gently.
        float fade = exp(-(p.z - camDist) * depthFade * 0.2);

        // Colour: cosine palette + per-mote phase + slow drift.
        float idHash = hash11(fi + 7.3);
        vec3 mc = pal(fi * 0.07 + palT + idHash);

        // Sparkle: about 12% of motes are "sparkle motes" — they bloom
        // briefly with treble. Identity-stable (a given mote is always the
        // sparkle one), but the glow is a smooth function of treb so it's
        // a swell, not a snap.
        float isSparkle = step(0.88, hash11(fi + 13.0));
        float sparkleBoost = isSparkle * trebToSparkle * treb * 1.6;
        vec3 sparkleCol = mix(mc, hue2rgb(sparkleHue), 0.7);

        col += (mc * glow + sparkleCol * glow * sparkleBoost) * brightness * fade;
    }

    // Bass-driven gentle global bloom on the brightest regions (lifts the
    // whole image with bass, doesn't move anything).
    float bright = max(col.r, max(col.g, col.b));
    col += smoothstep(0.3, 0.9, bright) * bassToBloom * bass * pal(palT + 0.3);

    // Faint background haze — gives the flock a soft "ocean" instead of
    // pure black, breathes with overall energy.
    col += haze * (0.5 + 0.5 * energy) * pal(palT * 0.7 + 0.5) * 0.18;

    // post.
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, saturation);

    col = (col - 0.5) * contrast + 0.5;
    col = max(col, 0.0);
    col = 1.0 - exp(-col * 1.5);
    col = pow(col, vec3(gamma));

    float vig = 1.0 - vignette * dot(uv, uv) * 0.45;
    col *= clamp(vig, 0.0, 1.0);

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 131.0) - 0.5) * grain;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
