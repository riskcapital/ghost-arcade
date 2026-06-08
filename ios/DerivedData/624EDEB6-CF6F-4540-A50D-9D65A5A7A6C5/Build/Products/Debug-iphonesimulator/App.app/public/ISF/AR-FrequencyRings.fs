/*{
    "DESCRIPTION": "Concentric rings expand outward from center, each mapped to an FFT frequency band. Ring brightness pulses with audio energy. Color shifts through spectrum.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "ringCount", "TYPE": "float", "MIN": 4.0, "MAX": 24.0, "DEFAULT": 12.0},
        {"NAME": "expansionRate", "TYPE": "float", "MIN": 0.5, "MAX": 4.0, "DEFAULT": 1.5},
        {"NAME": "colorShiftRate", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.1},
        {"NAME": "ringThickness", "TYPE": "float", "MIN": 0.001, "MAX": 0.02, "DEFAULT": 0.004},
        {"NAME": "glowRadius", "TYPE": "float", "MIN": 0.005, "MAX": 0.08, "DEFAULT": 0.02},
        {"NAME": "centerPulse", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "intensity", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5}
    ]
}*/

// HSV to RGB conversion
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    vec2 center = vec2(0.5, 0.5);

    // Aspect ratio correction
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (uv - center) * vec2(aspect, 1.0);

    float dist = length(p);
    float angle = atan(p.y, p.x);

    // Center pulse based on bass
    float pulse = 1.0 + centerPulse * audioBass * 0.15;

    // Time-based expansion
    float timeOffset = TIME * expansionRate * 0.1;

    vec3 totalColor = vec3(0.0);

    // Maximum ring count for loop
    for (int i = 0; i < 24; i++) {
        if (float(i) >= ringCount) break;

        float fi = float(i);
        float ringFrac = fi / ringCount;

        // Ring radius: expands outward over time, wraps around
        float baseRadius = fract(ringFrac + timeOffset) * 1.2;
        baseRadius *= pulse;

        // Sample FFT at this ring's frequency band
        float fftVal = sampleFFT(ringFrac);

        // Fallback animation when no audio
        float fallback = 0.3 + 0.2 * sin(TIME * 0.7 + fi * 0.8);
        float energy = max(fftVal, fallback);

        // Ring distance
        float ringDist = abs(dist - baseRadius);

        // Sharp ring core + glow
        float core = smoothstep(ringThickness, 0.0, ringDist);
        float glow = exp(-ringDist * ringDist / (glowRadius * glowRadius * energy));

        float ringBright = (core * 1.5 + glow * 0.6) * energy * intensity;

        // Color: shift through spectrum per ring + time
        float hue = fract(ringFrac * 0.8 + TIME * colorShiftRate + audioSpectralCentroid * 0.3);
        float sat = 0.7 + 0.3 * energy;
        vec3 ringColor = hsv2rgb(vec3(hue, sat, 1.0));

        // Fade at edges
        float edgeFade = smoothstep(1.2, 0.8, baseRadius);
        float centerFade = smoothstep(0.0, 0.05, baseRadius);

        totalColor += ringColor * ringBright * edgeFade * centerFade;
    }

    // Beat flash at center
    float centerGlow = exp(-dist * dist * 20.0) * audioBeat * 0.5 * centerPulse;
    totalColor += vec3(1.0, 0.95, 0.9) * centerGlow;

    // Subtle angular shimmer
    float shimmer = 0.02 * sin(angle * 8.0 + TIME * 2.0) * audioHigh;
    totalColor += totalColor * shimmer;

    // Vignette
    float vig = 1.0 - dot(uv - center, uv - center) * 1.2;
    totalColor *= vig;

    // Tone mapping
    totalColor = totalColor / (1.0 + totalColor);

    gl_FragColor = vec4(totalColor, 1.0);
}
