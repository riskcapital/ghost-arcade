/*{
    "DESCRIPTION": "Radial smoke and nebula tendrils emanating from center. Tendril length and curl driven by FFT bins. FBM noise creates organic texture. Bass controls vortex scale, treble creates fine filaments.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "tendrilCount", "TYPE": "float", "MIN": 4.0, "MAX": 16.0, "DEFAULT": 10.0},
        {"NAME": "curlStrength", "TYPE": "float", "MIN": 0.5, "MAX": 4.0, "DEFAULT": 2.0},
        {"NAME": "smokeDensity", "TYPE": "float", "MIN": 0.5, "MAX": 4.0, "DEFAULT": 2.0},
        {"NAME": "colorRichness", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.2},
        {"NAME": "turbulence", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "breathRate", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3}
    ]
}*/

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

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

float fbm(vec2 p, float detail) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0, 0.0);
    for (int i = 0; i < 6; i++) {
        if (float(i) >= 3.0 + detail * 3.0) break;
        v += a * noise(p);
        p = p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

// HSV to RGB
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 center = vec2(0.5, 0.5);
    vec2 p = (uv - center) * vec2(aspect, 1.0);

    float dist = length(p);
    float angle = atan(p.y, p.x);
    float t = TIME * breathRate;

    // Audio with fallbacks
    float bassE = max(audioBass, 0.3 + 0.15 * sin(TIME * 0.3));
    float midE = max(audioMid, 0.3 + 0.1 * sin(TIME * 0.5));
    float highE = max(audioHigh, 0.2 + 0.1 * sin(TIME * 0.8));
    float energy = max(audioLevel, 0.25 + 0.1 * sin(TIME * 0.4));
    float centroid = max(audioSpectralCentroid, 0.4 + 0.1 * sin(TIME * 0.6));
    float beat = max(audioBeat, 0.0);

    // Vortex rotation driven by bass
    float vortex = bassE * curlStrength * 0.5;
    float rotAngle = angle + vortex * (1.0 - dist) * 2.0 + t * 0.5;

    // Build smoke density field
    float smoke = 0.0;

    for (int i = 0; i < 16; i++) {
        if (float(i) >= tendrilCount) break;
        float fi = float(i);
        float tendrilAngle = fi / tendrilCount * 6.2831;

        // FFT energy for this tendril
        float fftVal = sampleFFT(fi / tendrilCount);
        float fftFallback = 0.3 + 0.2 * sin(TIME * 0.7 + fi * 1.1);
        float fftE = max(fftVal, fftFallback);

        // Tendril direction with curl
        float angleDiff = rotAngle - tendrilAngle;
        angleDiff = mod(angleDiff + 3.14159, 6.28318) - 3.14159;

        // Tendril width narrows with distance, length from FFT
        float tendrilLen = 0.3 + 0.5 * fftE;
        float radialFade = smoothstep(tendrilLen, 0.0, dist);
        float angularWidth = 0.15 + 0.1 * (1.0 - dist) + 0.05 * highE;
        float tendrilShape = exp(-angleDiff * angleDiff / (angularWidth * angularWidth));

        // Add noise-based curl
        vec2 noiseCoord = vec2(dist * 4.0 + t * 0.8, tendrilAngle + fi * 2.3);
        float curlNoise = fbm(noiseCoord * (1.0 + turbulence), turbulence);
        tendrilShape *= (0.5 + curlNoise);

        smoke += tendrilShape * radialFade * fftE;
    }

    // Large-scale FBM turbulence overlay
    vec2 fbmCoord = p * (2.0 + bassE) + vec2(t * 0.3, t * 0.2);
    float largeFBM = fbm(fbmCoord, 0.5 + turbulence * 0.5);
    smoke *= (0.6 + largeFBM * 0.8);

    // Fine filaments from treble
    vec2 fineCoord = p * 8.0 + vec2(t * 0.5, -t * 0.3);
    float fineDetail = fbm(fineCoord, 1.0);
    smoke += fineDetail * highE * 0.3;

    smoke *= smokeDensity;

    // Color based on spectral centroid and position
    float hue = centroid * 0.6 + dist * 0.2 + t * 0.1;
    float sat = 0.5 + 0.3 * colorRichness;
    float val = clamp(smoke, 0.0, 1.0);
    vec3 baseColor = hsv2rgb(vec3(fract(hue), sat, 1.0));

    // Secondary color layer
    float hue2 = hue + 0.3 + angle * 0.05;
    vec3 secondColor = hsv2rgb(vec3(fract(hue2), sat * 0.8, 1.0));

    // Blend colors based on angle and distance
    float colorMix = sin(angle * 3.0 + t * 2.0) * 0.5 + 0.5;
    vec3 smokeColor = mix(baseColor, secondColor, colorMix * colorRichness * 0.5);

    vec3 col = smokeColor * smoke;

    // Center glow
    float centerGlow = exp(-dist * dist * 8.0) * (0.3 + energy * 0.5);
    vec3 glowColor = hsv2rgb(vec3(fract(centroid * 0.8 + t * 0.15), 0.3, 1.0));
    col += glowColor * centerGlow;

    // Beat flash
    col += smokeColor * 0.2 * beat * exp(-dist * 3.0);

    // Vignette
    float vig = 1.0 - 0.5 * dist * dist;
    col *= vig;

    // Tone map
    col = col / (1.0 + col);

    gl_FragColor = vec4(col, 1.0);
}
