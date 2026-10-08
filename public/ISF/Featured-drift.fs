/*{
    "DESCRIPTION": "Drift — a continuously evolving iridescent plasma nebula. NATIVELY AUDIO-REACTIVE in the Milkdrop sense: music doesn't lunge anything around — it modulates the SYSTEM'S RATES. Bass adds gentle bloom energy. Mids speed up the flow. Treble accelerates the palette cycle. The visual is always alive on its own (TIME-driven slow domain warp + cosine palette drift); audio just sculpts the pace. Smoothing is built in: each band is averaged across 16 FFT bins (spatial smoothing) and the response is power-curved + biased so even hard transients can't punch.",
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "2D", "Audio Reactive", "Plasma"],
    "INPUTS": [
        { "NAME": "audioGain",      "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Audio Sensitivity" },
        { "NAME": "bassToBloom",    "TYPE": "float", "DEFAULT": 0.4,  "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Bass → Bloom" },
        { "NAME": "midToFlow",      "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Mid → Flow Pace" },
        { "NAME": "trebToPalette",  "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Treble → Palette Pace" },
        { "NAME": "energyToWarp",   "TYPE": "float", "DEFAULT": 0.20, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Energy → Warp" },
        { "NAME": "smoothness",     "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.1,   "MAX": 1.0,  "LABEL": "Response Smoothness" },
        { "NAME": "bassLo",         "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bass Band Lo" },
        { "NAME": "bassHi",         "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bass Band Hi" },
        { "NAME": "midLo",          "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Mid Band Lo" },
        { "NAME": "midHi",          "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Mid Band Hi" },
        { "NAME": "trebLo",         "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Treble Band Lo" },
        { "NAME": "trebHi",         "TYPE": "float", "DEFAULT": 0.80, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Treble Band Hi" },
        { "NAME": "zoom",           "TYPE": "float", "DEFAULT": 3.0,  "MIN": 0.3,   "MAX": 5.0,  "LABEL": "Zoom" },
        { "NAME": "flowSpeed",      "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0,   "MAX": 0.8,  "LABEL": "Base Flow Speed" },
        { "NAME": "warpAmount",     "TYPE": "float", "DEFAULT": 1.05, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Warp Amount" },
        { "NAME": "warpDecay",      "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.30,  "MAX": 0.95, "LABEL": "Warp Decay" },
        { "NAME": "currents",       "TYPE": "float", "DEFAULT": 0.4,  "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Currents" },
        { "NAME": "paletteSpeed",   "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.0,   "MAX": 0.5,  "LABEL": "Base Palette Pace" },
        { "NAME": "paletteSpread",  "TYPE": "float", "DEFAULT": 1.35, "MIN": 0.30,  "MAX": 2.0,  "LABEL": "Palette Spread" },
        { "NAME": "paletteShift",   "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Palette Shift" },
        { "NAME": "bloomAmount",    "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Base Bloom" },
        { "NAME": "bloomThreshold", "TYPE": "float", "DEFAULT": 0.35,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bloom Threshold" },
        { "NAME": "bloomTint",      "TYPE": "float", "DEFAULT": 0.92, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bloom Tint" },
        { "NAME": "softness",       "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Softness" },
        { "NAME": "saturation",     "TYPE": "float", "DEFAULT": 1.30, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Saturation" },
        { "NAME": "contrast",       "TYPE": "float", "DEFAULT": 1.05, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Contrast" },
        { "NAME": "gamma",          "TYPE": "float", "DEFAULT": 0.95, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Gamma" },
        { "NAME": "vignette",       "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Vignette" },
        { "NAME": "grain",          "TYPE": "float", "DEFAULT": 0.018,"MIN": 0.0,   "MAX": 0.30, "LABEL": "Film Grain" }
    ]
}*/

precision highp float;

#define PI  3.14159265359
#define TAU 6.28318530718
#define BAND_BINS 16

vec3 pal(float t) {
    vec3 a = vec3(0.5), b = vec3(0.5);
    vec3 c = vec3(paletteSpread);
    vec3 d = vec3(0.0, 0.33, 0.67) + paletteShift;
    return a + b * cos(TAU * (c * t + d));
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

// ── audio band: spatial-average many FFT bins so it doesn't jag, then
// power-curve + bias so it's a soft modulator, never a punch. `smoothness`
// chooses how aggressively to flatten the response (1 = fully flat ≈ 0.5 +,
// 0.1 = nearly raw FFT). Always returns a value > 0 so the system never
// "stops" between beats.
float audioBand(float lo, float hi) {
    float sum = 0.0;
    for (int i = 0; i < BAND_BINS; i++) {
        float u = mix(lo, hi, (float(i) + 0.5) / float(BAND_BINS));
        sum += sampleFFT(u);
    }
    float raw = (sum / float(BAND_BINS)) * audioGain;
    // power-curve compresses dynamics: sqrt-ish at smoothness=1 = very gentle,
    // linear at smoothness=0 = raw response.
    float compressed = pow(clamp(raw, 0.0, 1.0), mix(1.0, 0.35, smoothness));
    // bias so there's always a baseline of motion -> nothing stops on quiet
    return mix(compressed, 0.4 + 0.6 * compressed, smoothness);
}

// Multi-octave domain warp. Returns a flow-displaced coordinate AND the
// scalar field value at the warped position.
vec2 warp(vec2 p, float t) {
    float amp = warpAmount;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        vec2 q = vec2(
            sin(p.y * 1.30 + t * 0.50 + fi * 1.3),
            sin(p.x * 1.15 - t * 0.40 + fi * 0.9)
        );
        // add a slow swirl current
        q += currents * vec2(sin(p.x * 0.7 + t * 0.3 + fi),
                             cos(p.y * 0.6 - t * 0.25 - fi));
        p += amp * q;
        amp *= warpDecay;
    }
    return p;
}

float field(vec2 p, float t) {
    // Multiple octaves of interfering sine waves — gives rich iridescent
    // crests + valleys that read as plasma structure, not a single gradient.
    float v = 0.0;
    v += 0.50 * sin(p.x * 2.6 + t * 0.7);
    v += 0.45 * sin(p.y * 2.2 - t * 0.6);
    v += 0.40 * sin(length(p) * 3.4 + t * 0.4);
    v += 0.35 * sin(dot(p, vec2(1.4, -0.9)) * 2.0 + t * 0.5);
    v += 0.30 * sin(p.x * 5.1 - p.y * 4.2 + t * 0.8);
    v += 0.25 * sin(length(p + vec2(sin(t*0.3), cos(t*0.4))) * 5.8 + t);
    return v;
}

void main() {
    // Audio: bands are pre-smoothed (spatial + power-curve + bias) so the
    // values flowing into the rest are gentle modulators, never punches.
    float bass   = audioBand(bassLo, bassHi);
    float mid    = audioBand(midLo,  midHi);
    float treb   = audioBand(trebLo, trebHi);
    float energy = audioBand(0.0,    0.7);                // overall RMS-ish

    vec2 R = RENDERSIZE;
    vec2 uv = (gl_FragCoord.xy - 0.5 * R) / min(R.x, R.y);

    // The system is ALWAYS evolving from TIME alone; audio modulates the
    // rate. So if music drops, the field keeps drifting — it just paces
    // differently. No "lunging" anything to a static state.
    float flowT = TIME * flowSpeed * (1.0 + midToFlow * mid);
    float palT  = TIME * paletteSpeed * (1.0 + trebToPalette * treb);

    vec2 p = uv * zoom;
    // slow lissajous drift on top of warp -> ensures continuous motion
    p += 0.6 * vec2(sin(flowT * 0.7), cos(flowT * 0.55));

    // domain-warped position. Energy gently dilates the warp magnitude
    // (more music = the plasma flows further, but the geometry doesn't snap).
    float wAmt = warpAmount * (1.0 + energyToWarp * energy);
    vec2 wp = warp(p * (warpAmount / max(wAmt, 0.001)), flowT);
    // (kept the warp loop using global warpAmount; here we just re-scale p
    // so the *effective* amount tracks energy without changing the loop.)

    float v = field(wp, flowT);

    // Iridescent colour from the field value + slow palette drift.
    vec3 col = pal(v * 0.35 + palT);

    // Bloom: light only the bright crests of the field, with smooth response.
    // Bass gently brightens it. Threshold/feathering keeps it from clipping.
    float bright = smoothstep(bloomThreshold, bloomThreshold + 0.4 + softness,
                              max(col.r, max(col.g, col.b)));
    float bloomGain = bloomAmount * (1.0 + bassToBloom * bass);
    col += bright * bloomGain * pal(palT * 0.7 + bloomTint);

    // A second softer "atmosphere" layer — adds depth, never sharp.
    col += 0.05 * softness * pal(v * 0.1 + palT * 0.4 + 0.5);

    // saturation, contrast, soft rolloff, vignette, grain.
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, saturation);

    col = (col - 0.5) * contrast + 0.5;
    col = max(col, 0.0);
    col = 1.0 - exp(-col * 1.35);
    col = pow(col, vec3(gamma));

    float vig = 1.0 - vignette * dot(uv, uv) * 0.45;
    col *= clamp(vig, 0.0, 1.0);

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 131.0) - 0.5) * grain;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
