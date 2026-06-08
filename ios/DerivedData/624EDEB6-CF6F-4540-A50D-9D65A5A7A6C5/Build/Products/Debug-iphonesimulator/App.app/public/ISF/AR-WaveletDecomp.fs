/*{
    "DESCRIPTION": "Waveform displayed as multiple layered frequency-scale decompositions. Stacked bands each show waveform at a different frequency scale with spectral coloring and parallax drift.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "scaleCount", "TYPE": "float", "MIN": 4.0, "MAX": 8.0, "DEFAULT": 6.0},
        {"NAME": "waveAmplitude", "TYPE": "float", "MIN": 0.05, "MAX": 0.3, "DEFAULT": 0.15},
        {"NAME": "layerSpread", "TYPE": "float", "MIN": 0.02, "MAX": 0.15, "DEFAULT": 0.08},
        {"NAME": "driftSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3},
        {"NAME": "glowWidth", "TYPE": "float", "MIN": 0.001, "MAX": 0.01, "DEFAULT": 0.003},
        {"NAME": "intensity", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5}
    ]
}*/

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Sample waveform at a frequency scale by averaging nearby samples
float sampleAtScale(float x, float scaleIdx, float numScales) {
    // Higher scale index = coarser (lower frequency)
    float frac = scaleIdx / numScales;
    float windowSize = 0.005 + frac * 0.12;

    // Accumulate samples across the window
    float sum = 0.0;
    float count = 0.0;
    for (int j = 0; j < 16; j++) {
        float fj = float(j);
        float offset = (fj / 15.0 - 0.5) * windowSize;
        float sampleX = fract(x + offset);
        float val = sampleWaveform(sampleX);

        // Fallback: synthetic wave at this scale
        float freq = 2.0 + scaleIdx * 3.0;
        float fallback = sin(sampleX * freq * 6.28318 + TIME * (1.0 + scaleIdx * 0.3)) * 0.5;
        val = max(abs(val), abs(fallback) * 0.5) * sign(val + fallback * 0.01);

        sum += val;
        count += 1.0;
    }

    return sum / count;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME;

    vec3 totalColor = vec3(0.0);

    // Background: very dark with subtle gradient
    vec3 bg = vec3(0.01, 0.008, 0.02);
    bg += vec3(0.005, 0.003, 0.01) * (1.0 - abs(uv.y - 0.5) * 2.0);
    totalColor = bg;

    float numScales = scaleCount;

    for (int i = 0; i < 8; i++) {
        if (float(i) >= numScales) break;

        float fi = float(i);
        float frac = fi / numScales;

        // Vertical center position for this layer
        float yCenter = 0.15 + frac * 0.7;

        // Parallax drift: higher frequencies drift faster
        float drift = t * driftSpeed * (0.3 + (1.0 - frac) * 0.7);

        // X position with drift
        float xPos = fract(uv.x + drift * 0.05);

        // Sample waveform at this frequency scale
        float waveVal = sampleAtScale(xPos, fi, numScales);

        // FFT energy at this frequency band
        float fftEnergy = sampleFFT(frac * 0.8 + 0.1);
        float fallbackEnergy = 0.3 + 0.2 * sin(t * 0.5 + fi * 1.1);
        float energy = max(fftEnergy, fallbackEnergy);

        // Wave position with amplitude scaling
        float waveY = yCenter + waveVal * waveAmplitude * energy;

        // Distance from pixel to wave line
        float dist = abs(uv.y - waveY);

        // Sharp core line
        float core = smoothstep(glowWidth, 0.0, dist);

        // Glow around the line
        float glowSize = glowWidth * (4.0 + energy * 8.0);
        float glow = exp(-dist * dist / (glowSize * glowSize));

        // Layer opacity based on energy
        float opacity = 0.3 + 0.7 * energy;

        // Color: spectral mapping (red for low freq, violet for high)
        float hue = fract(frac * 0.75 + 0.0 + t * 0.02);
        float sat = 0.7 + 0.3 * energy;
        vec3 layerColor = hsv2rgb(vec3(hue, sat, 1.0));

        // Combine core and glow
        float layerBright = (core * 2.0 + glow * 0.8) * opacity * intensity;

        totalColor += layerColor * layerBright;

        // Filled region under the wave (subtle)
        float fill = smoothstep(layerSpread, 0.0, dist) * 0.08 * energy;
        totalColor += layerColor * fill;
    }

    // Beat-reactive horizontal flash
    float beatFlash = audioBeat * 0.15;
    float flashLine = exp(-pow((uv.y - 0.5) * 10.0, 2.0));
    totalColor += vec3(1.0, 0.9, 0.8) * beatFlash * flashLine;

    // Bass-reactive bottom glow
    float bassGlow = audioBass * 0.1;
    totalColor += vec3(0.3, 0.1, 0.4) * bassGlow * (1.0 - uv.y);

    // High freq shimmer at top
    float highShimmer = audioHigh * 0.08;
    float shimmer = sin(uv.x * 80.0 + t * 5.0) * 0.5 + 0.5;
    totalColor += vec3(0.2, 0.3, 0.5) * highShimmer * shimmer * uv.y;

    // Horizontal scan lines (subtle CRT effect)
    float scanline = 0.97 + 0.03 * sin(uv.y * RENDERSIZE.y * 1.5);
    totalColor *= scanline;

    // Edge vignette
    float vig = 1.0 - 0.3 * pow(abs(uv.x - 0.5) * 2.0, 2.0);
    vig *= 1.0 - 0.2 * pow(abs(uv.y - 0.5) * 2.0, 2.0);
    totalColor *= vig;

    // Tone map
    totalColor = totalColor / (1.0 + totalColor);

    gl_FragColor = vec4(totalColor, 1.0);
}
