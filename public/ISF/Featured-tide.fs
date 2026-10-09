/*{
    "DESCRIPTION": "Tide — a 3D volumetric iridescent nebula you drift through. Milkdrop philosophy carried into 3D: the cosmic field is ALWAYS evolving on its own (multi-octave 3D domain warp + slow palette cycle + a quiet forward camera drift); audio NEVER snaps the geometry — it only modulates the system's rates. Bass swells the emission energy. Mids speed the flow. Treble cycles the palette. Energy gently dilates the warp. Smoothness is layered: 16 FFT bins per band + dynamics compression + always-on baseline = no jerk, no lunge. Pure volumetric emission march; no surfaces, no fresnel.",
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Audio Reactive", "Volumetric"],
    "INPUTS": [
        { "NAME": "audioGain",      "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Audio Sensitivity" },
        { "NAME": "bassToBloom",    "TYPE": "float", "DEFAULT": 0.4,  "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Bass → Emission" },
        { "NAME": "midToFlow",      "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Mid → Flow Pace" },
        { "NAME": "trebToPalette",  "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Treble → Palette Pace" },
        { "NAME": "energyToWarp",   "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Energy → Warp" },
        { "NAME": "smoothness",     "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.1,   "MAX": 1.0,  "LABEL": "Response Smoothness" },
        { "NAME": "bassLo",         "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bass Band Lo" },
        { "NAME": "bassHi",         "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bass Band Hi" },
        { "NAME": "midLo",          "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Mid Band Lo" },
        { "NAME": "midHi",          "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Mid Band Hi" },
        { "NAME": "trebLo",         "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Treble Band Lo" },
        { "NAME": "trebHi",         "TYPE": "float", "DEFAULT": 0.80, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Treble Band Hi" },
        { "NAME": "worldDrift",     "TYPE": "float", "DEFAULT": 0.30, "MIN": -2.0,  "MAX": 2.0,  "LABEL": "Forward Drift" },
        { "NAME": "flowSpeed",      "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.0,   "MAX": 0.8,  "LABEL": "Base Flow Speed" },
        { "NAME": "warpAmount",     "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Warp Amount" },
        { "NAME": "warpDecay",      "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.30,  "MAX": 0.95, "LABEL": "Warp Decay" },
        { "NAME": "currents",       "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Currents" },
        { "NAME": "fieldScale",     "TYPE": "float", "DEFAULT": 1.1,  "MIN": 0.3,   "MAX": 3.0,  "LABEL": "Field Scale" },
        { "NAME": "densityCutoff",  "TYPE": "float", "DEFAULT": 0.20, "MIN": -0.50, "MAX": 1.5,  "LABEL": "Density Cutoff" },
        { "NAME": "softness",       "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.2,   "MAX": 3.0,  "LABEL": "Cloud Softness" },
        { "NAME": "emissionAmount", "TYPE": "float", "DEFAULT": 1.2,  "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Emission" },
        { "NAME": "absorption",     "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Self Absorption" },
        { "NAME": "paletteSpeed",   "TYPE": "float", "DEFAULT": 0.04, "MIN": 0.0,   "MAX": 0.5,  "LABEL": "Base Palette Pace" },
        { "NAME": "paletteSpread",  "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.30,  "MAX": 2.0,  "LABEL": "Palette Spread" },
        { "NAME": "paletteShift",   "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Palette Shift" },
        { "NAME": "voidTint",       "TYPE": "float", "DEFAULT": 0.65, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Void Tint" },
        { "NAME": "voidLevel",      "TYPE": "float", "DEFAULT": 0.04, "MIN": 0.0,   "MAX": 0.4,  "LABEL": "Void Glow" },
        { "NAME": "fov",            "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Field of View" },
        { "NAME": "orbitSpeed",     "TYPE": "float", "DEFAULT": 0.04, "MIN": -1.0,  "MAX": 1.0,  "LABEL": "Camera Yaw" },
        { "NAME": "camTilt",        "TYPE": "float", "DEFAULT": 0.10, "MIN": -1.5,  "MAX": 1.5,  "LABEL": "Camera Tilt" },
        { "NAME": "saturation",     "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Saturation" },
        { "NAME": "contrast",       "TYPE": "float", "DEFAULT": 1.05, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Contrast" },
        { "NAME": "gamma",          "TYPE": "float", "DEFAULT": 0.95, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Gamma" },
        { "NAME": "vignette",       "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Vignette" },
        { "NAME": "grain",          "TYPE": "float", "DEFAULT": 0.020,"MIN": 0.0,   "MAX": 0.30, "LABEL": "Film Grain" }
    ]
}*/

precision highp float;

#define PI  3.14159265359
#define TAU 6.28318530718
#define STEPS 76
#define BAND_BINS 16
#define FAR 18.0

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 pal(float t) {
    vec3 a = vec3(0.5), b = vec3(0.5);
    vec3 c = vec3(paletteSpread);
    vec3 d = vec3(0.0, 0.33, 0.67) + paletteShift;
    return a + b * cos(TAU * (c * t + d));
}

vec3 voidColour(vec3 rd, float palT) {
    vec3 c = pal(palT * 0.6 + voidTint);
    // a soft directional tint so the void isn't flat
    float h = 0.5 + 0.5 * rd.y;
    return mix(c * 0.4, c, h) * voidLevel;
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

// ── Milkdrop-style smoothed band: wide spatial average + dynamics
// compression + biased baseline. Same logic as Drift, lifted in.
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

// 3D domain-warped iridescent field. Returns emission colour at point p.
// No "hits", no surfaces — every step of the volumetric march samples this.
vec3 nebula(vec3 p, float t, float warpDilate) {
    vec3 q = p;
    float amp = warpAmount * warpDilate;
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        q += amp * vec3(
            sin(q.y * 1.30 + t * 0.50 + fi * 1.30),
            sin(q.z * 1.15 - t * 0.40 + fi * 0.90),
            sin(q.x * 1.00 + t * 0.45 + fi * 1.10)
        );
        q += amp * currents * vec3(
            sin(q.x * 0.65 + t * 0.30),
            cos(q.y * 0.60 - t * 0.25),
            sin(q.z * 0.70 + t * 0.35)
        );
        amp *= warpDecay;
    }

    // Interfering sine waves — natural crests + valleys read as 3D clouds.
    float v = 0.50 * sin(q.x * 2.10 + t * 0.70)
            + 0.45 * sin(q.y * 1.80 - t * 0.60)
            + 0.40 * sin(q.z * 1.60 + t * 0.40)
            + 0.35 * sin(length(q) * 2.40 + t * 0.50)
            + 0.30 * sin(dot(q, vec3(1.2, -0.8, 0.9)) * 1.40 + t * 0.55);

    // Density: smoothstep so only the crests glow -> the medium has gaps you
    // can see through, instead of being a uniform haze.
    float dens = smoothstep(densityCutoff, densityCutoff + softness, v);
    if (dens < 0.001) return vec3(0.0);

    vec3 c = pal(v * 0.25 + t * 0.05);
    return c * dens;
}

void main() {
    // Audio bands (Milkdrop-smoothed).
    float bass   = audioBand(bassLo, bassHi);
    float mid    = audioBand(midLo,  midHi);
    float treb   = audioBand(trebLo, trebHi);
    float energy = audioBand(0.0,    0.7);

    vec2 R = RENDERSIZE;
    vec2 uv = (gl_FragCoord.xy - 0.5 * R) / min(R.x, R.y);

    // Continuous evolution from TIME alone; audio modulates RATES.
    float flowT = TIME * flowSpeed * (1.0 + midToFlow * mid);
    float palT  = TIME * paletteSpeed * (1.0 + trebToPalette * treb);
    float warpDilate = 1.0 + energyToWarp * energy;

    // Camera — gentle yaw, slight tilt, quiet forward drift in z.
    vec3 ro = vec3(0.0, 0.0, 0.0);
    vec3 rd = normalize(vec3(uv * fov, 1.0));
    rd.xz *= rot(TIME * orbitSpeed);
    rd.yz *= rot(camTilt);

    // Volumetric emission march.
    vec3 acc = vec3(0.0);
    vec3 trans = vec3(1.0);
    float t = 0.2;
    float stepSize = 0.22;

    for (int i = 0; i < STEPS; i++) {
        vec3 p = (ro + rd * t) * fieldScale;
        // smooth forward drift -> "you're drifting through the cosmic field"
        p += vec3(0.0, 0.0, TIME * worldDrift);
        vec3 e = nebula(p, flowT, warpDilate);
        e *= emissionAmount * (1.0 + bassToBloom * bass) * stepSize;
        acc += trans * e;
        // mild self-absorption so crests in front gently shadow the ones behind
        float dens = (e.r + e.g + e.b) * absorption;
        trans *= exp(-vec3(dens) * stepSize);

        t += stepSize;
        if (t > FAR) break;
        if (trans.r + trans.g + trans.b < 0.06) break;
    }

    // Background void glow through remaining transmittance.
    acc += trans * voidColour(rd, palT);

    vec3 col = acc;

    // post — same finishing chain as the others.
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
