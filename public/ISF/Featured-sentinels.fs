/*{
    "DESCRIPTION": "Sentinels — fly forever forward through an endless dark space populated by vertical pillars of iridescent plasma, dissolving into atmospheric fog at the horizon. STRONG 3D depth: many columns at clearly varying distances, classic parallax + perspective + fog recession. NATIVELY AUDIO-REACTIVE in the Milkdrop sense: bass swells the overall glow, mids modulate the speed of luminous WAVES traveling up the pillars, treble paces the palette cycle, energy gently dilates the column halos. Nothing in space lunges; the sentinels just radiate harder or pulse faster. Smoothness layered the same way as Tide/Drift.",
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Audio Reactive", "Volumetric"],
    "INPUTS": [
        { "NAME": "audioGain",       "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Audio Sensitivity" },
        { "NAME": "bassToBloom",     "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Bass → Bloom" },
        { "NAME": "midToWaves",      "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Mid → Wave Pace" },
        { "NAME": "trebToPalette",   "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Treble → Palette Pace" },
        { "NAME": "energyToHalo",    "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Energy → Halo Dilation" },
        { "NAME": "smoothness",      "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.1,   "MAX": 1.0,  "LABEL": "Response Smoothness" },
        { "NAME": "bassLo",          "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bass Band Lo" },
        { "NAME": "bassHi",          "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bass Band Hi" },
        { "NAME": "midLo",           "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Mid Band Lo" },
        { "NAME": "midHi",           "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Mid Band Hi" },
        { "NAME": "trebLo",          "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Treble Band Lo" },
        { "NAME": "trebHi",          "TYPE": "float", "DEFAULT": 0.80, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Treble Band Hi" },
        { "NAME": "cellSize",        "TYPE": "float", "DEFAULT": 3.0,  "MIN": 1.5,   "MAX": 8.0,  "LABEL": "Field Spacing" },
        { "NAME": "density",         "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 0.9,  "LABEL": "Sparsity" },
        { "NAME": "jitter",          "TYPE": "float", "DEFAULT": 0.65, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Scatter" },
        { "NAME": "pillarRadius",    "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.10,  "MAX": 1.5,  "LABEL": "Pillar Radius" },
        { "NAME": "pillarFalloff",   "TYPE": "float", "DEFAULT": 1.6,  "MIN": 0.5,   "MAX": 4.0,  "LABEL": "Pillar Sharpness" },
        { "NAME": "pillarHeight",    "TYPE": "float", "DEFAULT": 3.0,  "MIN": 0.5,   "MAX": 10.0, "LABEL": "Pillar Height" },
        { "NAME": "centreY",         "TYPE": "float", "DEFAULT": 0.0,  "MIN": -3.0,  "MAX": 3.0,  "LABEL": "Pillar Centre Y" },
        { "NAME": "camHeight",       "TYPE": "float", "DEFAULT": 0.2,  "MIN": -2.0,  "MAX": 2.0,  "LABEL": "Camera Height" },
        { "NAME": "camPitch",        "TYPE": "float", "DEFAULT": 0.05, "MIN": -0.5,  "MAX": 0.5,  "LABEL": "Camera Pitch" },
        { "NAME": "sway",            "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Camera Sway" },
        { "NAME": "fov",             "TYPE": "float", "DEFAULT": 1.1,  "MIN": 0.50,  "MAX": 2.5,  "LABEL": "Field of View" },
        { "NAME": "speed",           "TYPE": "float", "DEFAULT": 1.4,  "MIN": -6.0,  "MAX": 6.0,  "LABEL": "Fly Speed" },
        { "NAME": "waveFreq",        "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.05,  "MAX": 3.0,  "LABEL": "Wave Frequency" },
        { "NAME": "waveSpeed",       "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 4.0,  "LABEL": "Base Wave Speed" },
        { "NAME": "waveDepth",       "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Wave Depth" },
        { "NAME": "intensity",       "TYPE": "float", "DEFAULT": 1.4,  "MIN": 0.1,   "MAX": 3.0,  "LABEL": "Emission" },
        { "NAME": "absorption",      "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Self Absorption" },
        { "NAME": "fog",             "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.0,   "MAX": 0.20, "LABEL": "Fog Density" },
        { "NAME": "voidTint",        "TYPE": "float", "DEFAULT": 0.65, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Void Tint" },
        { "NAME": "voidLevel",       "TYPE": "float", "DEFAULT": 0.03, "MIN": 0.0,   "MAX": 0.3,  "LABEL": "Void Glow" },
        { "NAME": "paletteSpeed",    "TYPE": "float", "DEFAULT": 0.04, "MIN": 0.0,   "MAX": 0.5,  "LABEL": "Base Palette Pace" },
        { "NAME": "paletteSpread",   "TYPE": "float", "DEFAULT": 1.10, "MIN": 0.30,  "MAX": 2.0,  "LABEL": "Palette Spread" },
        { "NAME": "paletteShift",    "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Palette Shift" },
        { "NAME": "saturation",      "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Saturation" },
        { "NAME": "contrast",        "TYPE": "float", "DEFAULT": 1.05, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Contrast" },
        { "NAME": "gamma",           "TYPE": "float", "DEFAULT": 0.92, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Gamma" },
        { "NAME": "vignette",        "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Vignette" },
        { "NAME": "grain",           "TYPE": "float", "DEFAULT": 0.020,"MIN": 0.0,   "MAX": 0.30, "LABEL": "Film Grain" }
    ]
}*/

precision highp float;

#define PI  3.14159265359
#define TAU 6.28318530718
#define BAND_BINS 16
#define STEPS 88
#define FAR 50.0

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

// ── Pillar field: domain-repeat in xz. Each cell carries one pillar at a
// jittered position with its own hue, height bias, and wave phase. We loop
// 3×3 neighbors so adjacent-cell pillars don't pop in/out at the borders.
vec3 pillarEmission(vec3 p, float t, float waveT, float haloAmt) {
    vec3 e = vec3(0.0);
    vec2 cell = vec2(cellSize);
    vec2 id0 = floor(p.xz / cell);

    float radius = pillarRadius * (1.0 + 0.25 * haloAmt);

    for (int dx = -1; dx <= 1; dx++) {
        for (int dy = -1; dy <= 1; dy++) {
            vec2 id = id0 + vec2(float(dx), float(dy));
            float h = hash21(id);
            if (h < density) continue;                // empty cell

            // jittered xz position of the pillar centre line
            vec2 cc = (id + 0.5) * cell
                    + (vec2(hash21(id + 0.31), hash21(id + 0.79)) - 0.5) * cell * jitter;

            vec2 dxz = p.xz - cc;
            float d2 = dot(dxz, dxz);
            if (d2 > radius * radius * 9.0) continue; // far enough to skip

            // gaussian-ish horizontal falloff
            float core = exp(-d2 / (radius * radius) * pillarFalloff);

            // vertical profile around centreY (peaked, fading top + bottom)
            float yh = (p.y - centreY) / max(pillarHeight, 0.01);
            float vert = exp(-yh * yh);

            // per-pillar phase + wave traveling up/down at `waveT` rate
            float phase = h * TAU;
            float wave = sin(p.y * waveFreq - waveT + phase);
            float waveAmt = 1.0 - waveDepth + waveDepth * (0.5 + 0.5 * wave);

            // per-pillar colour from palette + cell hash
            vec3 c = pal(h * 0.42 + t * paletteSpeed);

            e += c * core * vert * waveAmt;
        }
    }
    return e * intensity;
}

vec3 voidColour(vec3 rd, float palT) {
    vec3 c = pal(palT * 0.6 + voidTint);
    float h = 0.5 + 0.5 * rd.y;
    return mix(c * 0.5, c, h) * voidLevel;
}

void main() {
    // ── Audio (Milkdrop-smoothed). Only RATES move; nothing snaps geometry.
    float bass   = audioBand(bassLo, bassHi);
    float mid    = audioBand(midLo,  midHi);
    float treb   = audioBand(trebLo, trebHi);
    float energy = audioBand(0.0,    0.7);

    vec2 R = RENDERSIZE;
    vec2 uv = (gl_FragCoord.xy - 0.5 * R) / min(R.x, R.y);

    float palT  = TIME * paletteSpeed * (1.0 + trebToPalette * treb);
    float waveT = TIME * waveSpeed   * (1.0 + midToWaves   * mid);
    float haloAmt = energyToHalo * energy;

    // Forward-flying camera with gentle drift; field is in world-space so it
    // streams past with the camera's z motion.
    float swayX = sin(TIME * 0.3) * sway;
    vec3 ro = vec3(swayX, camHeight, TIME * speed);
    vec3 fwd = normalize(vec3(sin(TIME * 0.11) * 0.05, -camPitch, 1.0));
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 upv = cross(fwd, rgt);
    vec3 rd  = normalize(fwd + (uv.x * rgt + uv.y * upv) * fov);

    // ── Volumetric emission march through the pillar field.
    vec3 acc = vec3(0.0);
    vec3 trans = vec3(1.0);
    float t = 0.1;
    float stepSize = 0.42;

    for (int i = 0; i < STEPS; i++) {
        vec3 p = ro + rd * t;
        vec3 e = pillarEmission(p, TIME, waveT, haloAmt);
        e *= (1.0 + bassToBloom * bass) * stepSize;
        acc += trans * e;
        float dens = (e.r + e.g + e.b) * absorption;
        trans *= exp(-vec3(dens) * stepSize);

        t += stepSize;
        if (t > FAR) break;
        if (trans.r + trans.g + trans.b < 0.06) break;
    }

    // distance fog -> void colour at the horizon
    float fogMix = 1.0 - exp(-t * fog);
    acc = mix(acc, voidColour(rd, palT), fogMix * 0.85);
    acc += trans * voidColour(rd, palT);

    vec3 col = acc;

    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, saturation);
    col = (col - 0.5) * contrast + 0.5;
    col = max(col, 0.0);
    col = 1.0 - exp(-col * 1.4);
    col = pow(col, vec3(gamma));

    float vig = 1.0 - vignette * dot(uv, uv) * 0.45;
    col *= clamp(vig, 0.0, 1.0);

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 131.0) - 0.5) * grain;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
