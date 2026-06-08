/*{
    "DESCRIPTION": "Topographic contour map where elevation is driven by waveform and FFT. Contour lines visualize terrain with hill shading. Color gradient from deep blue valleys to bright orange peaks.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "contourCount", "TYPE": "float", "MIN": 5.0, "MAX": 40.0, "DEFAULT": 20.0},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "heightScale", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "noiseDetail", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3},
        {"NAME": "colorIntensity", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.2}
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

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

// Height function combining noise, FFT, and waveform
float getHeight(vec2 p) {
    float t = TIME * speed;

    // Base terrain from FBM noise
    float baseNoise = fbm(p * (2.0 + noiseDetail * 3.0) + vec2(t * 0.3, t * 0.2));

    // FFT-driven radial height component
    float dist = length(p - vec2(0.5, 0.5));
    float angle = atan(p.y - 0.5, p.x - 0.5);
    float fftU = fract(angle / 6.28318 + 0.5);
    float fftVal = sampleFFT(fftU);
    float fftFallback = 0.3 + 0.2 * sin(t * 1.2 + angle * 3.0);
    float fftH = max(fftVal, fftFallback);

    // Waveform along x-axis
    float waveVal = sampleWaveform(p.x);
    float waveFallback = sin(p.x * 6.28318 * 3.0 + t * 2.0) * 0.5;
    float hasAudio = step(0.01, max(audioLevel, 0.0));
    float waveH = mix(waveFallback, waveVal, hasAudio);

    // Audio energy
    float energy = max(audioLevel, 0.25 + 0.1 * sin(TIME * 0.4));

    // Combine
    float h = baseNoise * 0.5;
    h += fftH * 0.3 * (1.0 - dist * 1.5);
    h += waveH * 0.2;
    h += energy * 0.15;

    return h * heightScale;
}

// Terrain color from height
vec3 terrainColor(float h, float maxH) {
    float t = clamp(h / maxH, 0.0, 1.0);

    vec3 deepBlue = vec3(0.05, 0.1, 0.3);
    vec3 blue     = vec3(0.1, 0.2, 0.5);
    vec3 green    = vec3(0.15, 0.4, 0.2);
    vec3 yellow   = vec3(0.6, 0.5, 0.15);
    vec3 orange   = vec3(0.8, 0.4, 0.1);
    vec3 white    = vec3(0.95, 0.9, 0.85);

    vec3 col;
    if (t < 0.2) {
        col = mix(deepBlue, blue, t * 5.0);
    } else if (t < 0.4) {
        col = mix(blue, green, (t - 0.2) * 5.0);
    } else if (t < 0.6) {
        col = mix(green, yellow, (t - 0.4) * 5.0);
    } else if (t < 0.8) {
        col = mix(yellow, orange, (t - 0.6) * 5.0);
    } else {
        col = mix(orange, white, (t - 0.8) * 5.0);
    }

    return col * colorIntensity;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = uv;
    p.x *= aspect;

    float h = getHeight(p);
    float maxH = heightScale * 1.2;

    // Contour lines
    float contourH = h * contourCount;
    float contourFrac = fract(contourH);

    // Line thickness - thinner for minor, thicker for major (every 5th)
    float contourIdx = floor(contourH);
    float isMajor = 1.0 - step(0.5, mod(contourIdx, 5.0));
    float lw = lineWidth * (0.015 + isMajor * 0.015);

    // Anti-aliased contour line using screen-space derivative approximation
    float eps = 1.0 / RENDERSIZE.y;
    float hR = getHeight(p + vec2(eps, 0.0));
    float hU = getHeight(p + vec2(0.0, eps));
    float gradLen = length(vec2(hR - h, hU - h)) * contourCount;
    gradLen = max(gradLen, 0.001);

    float line = 1.0 - smoothstep(0.0, lw * gradLen + 0.5, min(contourFrac, 1.0 - contourFrac) * 2.0);

    // Hill shading: light from top-left
    vec2 lightDir = normalize(vec2(-1.0, 1.0));
    vec2 grad = vec2(hR - h, hU - h) / eps;
    float shade = dot(normalize(vec2(-grad.x, -grad.y)), lightDir) * 0.5 + 0.5;
    shade = 0.4 + 0.6 * shade;

    // Beat-reactive height boost
    float beat = max(audioBeat, 0.0);

    // Base terrain color
    vec3 terrCol = terrainColor(h + beat * 0.15, maxH);

    // Apply shading
    terrCol *= shade;

    // Contour line color (darker version of terrain color)
    vec3 lineCol = terrCol * 0.2;
    // Major contour lines are brighter
    lineCol = mix(lineCol, vec3(0.1, 0.08, 0.05), isMajor * 0.7);

    // Composite
    vec3 col = mix(terrCol, lineCol, line);

    // Subtle beat glow
    col += vec3(0.15, 0.1, 0.05) * beat * 0.5;

    // Vignette
    vec2 vc = uv - vec2(0.5);
    float vig = 1.0 - dot(vc, vc) * 0.8;
    col *= vig;

    // Tone map
    col = col / (1.0 + col);

    gl_FragColor = vec4(col, 1.0);
}
