/*{
    "DESCRIPTION": "Northern lights aurora curtains with multiple ribbon layers. Horizontal wave displacement from waveform, vertical color bands mapped to FFT frequencies. Green/blue/purple shift based on energy.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "ribbonCount", "TYPE": "float", "MIN": 2.0, "MAX": 8.0, "DEFAULT": 5.0},
        {"NAME": "foldIntensity", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.8},
        {"NAME": "brightness", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.2},
        {"NAME": "verticalStretch", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3},
        {"NAME": "waveDisplace", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.15}
    ]
}*/

// Simple hash for star field
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Smooth noise
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// FBM noise for aurora shape
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0, 0.0);
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

// Aurora color palette: green -> blue -> purple based on height and energy
vec3 auroraColor(float t, float energy) {
    vec3 green  = vec3(0.1, 0.9, 0.3);
    vec3 cyan   = vec3(0.1, 0.7, 0.8);
    vec3 blue   = vec3(0.2, 0.3, 0.9);
    vec3 purple = vec3(0.6, 0.1, 0.8);
    vec3 pink   = vec3(0.8, 0.2, 0.5);

    // Shift palette toward purple/pink with more energy
    float shift = energy * 0.3;
    float tt = clamp(t + shift, 0.0, 1.0);

    vec3 col;
    if (tt < 0.25) {
        col = mix(green, cyan, tt * 4.0);
    } else if (tt < 0.5) {
        col = mix(cyan, blue, (tt - 0.25) * 4.0);
    } else if (tt < 0.75) {
        col = mix(blue, purple, (tt - 0.5) * 4.0);
    } else {
        col = mix(purple, pink, (tt - 0.75) * 4.0);
    }
    return col;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    // Background: dark sky with stars
    vec3 skyColor = mix(vec3(0.0, 0.01, 0.04), vec3(0.0, 0.0, 0.02), uv.y);
    vec3 col = skyColor;

    // Stars
    vec2 starUV = uv * vec2(aspect * 80.0, 80.0);
    vec2 starCell = floor(starUV);
    float starBright = hash(starCell);
    starBright = pow(starBright, 18.0);
    float twinkle = 0.7 + 0.3 * sin(TIME * (2.0 + hash(starCell + vec2(42.0, 0.0)) * 4.0));
    col += vec3(0.8, 0.85, 1.0) * starBright * twinkle * 0.6;

    // Waveform displacement
    float waveVal = sampleWaveform(uv.x);
    float waveFallback = sin(uv.x * 6.2831 * 2.0 + TIME * 1.5) * 0.5;
    float wave = mix(waveFallback, waveVal, step(0.01, audioLevel));

    // Audio energy values with fallbacks
    float energy = max(audioLevel, 0.25 + 0.15 * sin(TIME * 0.5));
    float midE = max(audioMid, 0.3 + 0.1 * sin(TIME * 0.7));
    float bassE = max(audioBass, 0.3 + 0.1 * sin(TIME * 0.4));

    // Aurora ribbons
    float totalAurora = 0.0;
    vec3 auroraCol = vec3(0.0);

    for (int i = 0; i < 8; i++) {
        if (float(i) >= ribbonCount) break;
        float fi = float(i);
        float ribbonFrac = fi / ribbonCount;

        // Base vertical position for this ribbon
        float baseY = 0.5 + (ribbonFrac - 0.5) * verticalStretch * 0.8;

        // Horizontal wave shape using FBM + waveform
        float noiseX = uv.x * (3.0 + fi * 0.5) + t * (0.8 + fi * 0.3);
        float ribbonWave = fbm(vec2(noiseX, fi * 3.7 + t * 0.3));
        ribbonWave += wave * waveDisplace;

        // Fold from mid band
        float fold = sin(uv.x * 12.0 + t * 3.0 + fi * 2.1) * foldIntensity * midE * 0.1;
        float ribbonY = baseY + ribbonWave * 0.15 + fold;

        // Distance from ribbon center
        float dist = abs(uv.y - ribbonY);

        // Ribbon width varies with FFT
        float fftBin = sampleFFT(ribbonFrac);
        float fallbackFFT = 0.3 + 0.2 * sin(TIME * 0.9 + fi * 1.3);
        float fftVal = max(fftBin, fallbackFFT);
        float ribbonWidth = 0.02 + 0.06 * fftVal + 0.02 * energy;

        // Soft gaussian ribbon shape
        float ribbonAlpha = exp(-dist * dist / (ribbonWidth * ribbonWidth));
        ribbonAlpha *= fftVal * 0.8 + 0.2;

        // Color based on vertical position within ribbon + frequency
        float colorT = ribbonFrac + uv.y * 0.3;
        vec3 rCol = auroraColor(colorT, energy);

        // Accumulate
        auroraCol += rCol * ribbonAlpha;
        totalAurora += ribbonAlpha;
    }

    // Composite aurora over sky
    col += auroraCol * brightness;

    // Beat flash brightens the whole aurora
    col += auroraCol * 0.3 * max(audioBeat, 0.0);

    // Vignette
    float vig = 1.0 - 0.4 * dot(uv - vec2(0.5), uv - vec2(0.5));
    col *= vig;

    // Tone map
    col = col / (1.0 + col);

    gl_FragColor = vec4(col, 1.0);
}
