/*{
    "DESCRIPTION": "Chladni plate vibration patterns with mode amplitudes driven by FFT bands. Sand particles settle on nodal lines creating beautiful morphing patterns.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "modeCount", "TYPE": "float", "MIN": 2.0, "MAX": 8.0, "DEFAULT": 5.0},
        {"NAME": "plateScale", "TYPE": "float", "MIN": 1.0, "MAX": 4.0, "DEFAULT": 2.0},
        {"NAME": "sharpness", "TYPE": "float", "MIN": 2.0, "MAX": 20.0, "DEFAULT": 8.0},
        {"NAME": "colorVibrancy", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.5},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5}
    ]
}*/

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Chladni pattern: cos(n*pi*x)*cos(m*pi*y) +/- cos(m*pi*x)*cos(n*pi*y)
float chladni(vec2 p, float n, float m, float sign) {
    float a = cos(n * 3.14159 * p.x) * cos(m * 3.14159 * p.y);
    float b = cos(m * 3.14159 * p.x) * cos(n * 3.14159 * p.y);
    return a + sign * b;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    vec2 center = vec2(0.5, 0.5);

    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (uv - center) * plateScale * vec2(aspect, 1.0);

    float t = TIME * speed;

    // Mode pairs for Chladni patterns
    // Each mode driven by a different FFT band
    float totalPattern = 0.0;
    vec3 totalColor = vec3(0.0);
    float totalWeight = 0.0;

    for (int i = 0; i < 8; i++) {
        if (float(i) >= modeCount) break;

        float fi = float(i);
        float frac = fi / 8.0;

        // FFT energy for this mode
        float fftVal = sampleFFT(frac * 0.8 + 0.05);
        float fallback = 0.25 + 0.15 * sin(t * 0.3 + fi * 1.2);
        float energy = max(fftVal, fallback);

        // Mode numbers vary over time for morphing
        float n = fi + 1.0 + 0.5 * sin(t * 0.15 + fi);
        float m = fi + 2.0 + 0.5 * cos(t * 0.12 + fi * 0.7);

        // Alternate between symmetric and antisymmetric
        float sign = mod(fi, 2.0) < 1.0 ? 1.0 : -1.0;

        float pattern = chladni(p, n, m, sign);

        // Nodal lines: where pattern is near zero
        float nodalLine = 1.0 - smoothstep(0.0, 0.15 / sharpness, abs(pattern));

        // Weight by FFT energy
        float weight = energy;
        totalPattern += nodalLine * weight;

        // Color per mode
        float hue = fract(frac * 0.7 + t * 0.05 + audioSpectralCentroid * 0.2);
        vec3 modeColor = hsv2rgb(vec3(hue, 0.6 + 0.4 * energy, 1.0));
        totalColor += modeColor * nodalLine * weight;
        totalWeight += weight;
    }

    if (totalWeight > 0.0) {
        totalColor /= totalWeight;
        totalPattern /= totalWeight;
    }

    // Sand particle density on nodal lines
    float sand = totalPattern;

    // Enhance with sharpness
    sand = pow(sand, 1.0 / max(sharpness * 0.1, 0.1));

    // Combine color and sand pattern
    vec3 baseColor = mix(vec3(0.02, 0.02, 0.04), totalColor * colorVibrancy, sand);

    // Add subtle plate texture
    float plateTexture = 0.03 * sin(p.x * 40.0) * sin(p.y * 40.0);
    baseColor += vec3(plateTexture) * (1.0 - sand);

    // Audio-reactive glow on nodal lines
    float beatGlow = audioBeat * 0.4;
    baseColor += totalColor * sand * beatGlow;

    // Bass-reactive radial pulse
    float radDist = length(p) / plateScale;
    float radPulse = 0.1 * audioBass * exp(-radDist * radDist * 2.0);
    baseColor += vec3(0.3, 0.1, 0.5) * radPulse;

    // Edge vignette shaped like plate
    float plateShape = max(abs(p.x / (plateScale * aspect * 0.5)),
                           abs(p.y / (plateScale * 0.5)));
    float plateMask = smoothstep(1.0, 0.85, plateShape);
    float plateEdge = smoothstep(0.85, 0.82, plateShape) - smoothstep(0.88, 0.85, plateShape);
    baseColor *= plateMask;
    baseColor += vec3(0.15, 0.12, 0.1) * plateEdge;

    // Vibration blur effect from overall level
    float vibration = audioLevel * 0.02;
    vec2 vibOffset = vec2(sin(TIME * 30.0), cos(TIME * 37.0)) * vibration;
    // Simple approximation: brighten slightly for vibration
    baseColor *= 1.0 + length(vibOffset) * 5.0;

    // Tone map
    baseColor = baseColor / (1.0 + baseColor);

    gl_FragColor = vec4(baseColor, 1.0);
}
