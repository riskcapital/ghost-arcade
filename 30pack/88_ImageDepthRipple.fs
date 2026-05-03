/*{
    "DESCRIPTION": "Image Depth Ripple - Animated waves propagate across the image surface, displacing pixels by their luminance depth. Camera tilt reveals wave motion.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Effect"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "cameraAngleX", "TYPE": "float", "DEFAULT": 0.0, "MIN": -30.0, "MAX": 30.0, "LABEL": "Camera Tilt X"},
        {"NAME": "cameraAngleY", "TYPE": "float", "DEFAULT": 0.0, "MIN": -30.0, "MAX": 30.0, "LABEL": "Camera Tilt Y"},
        {"NAME": "rippleSpeed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 5.0, "LABEL": "Ripple Speed"},
        {"NAME": "rippleFrequency", "TYPE": "float", "DEFAULT": 8.0, "MIN": 1.0, "MAX": 30.0, "LABEL": "Ripple Density"},
        {"NAME": "rippleAmplitude", "TYPE": "float", "DEFAULT": 0.03, "MIN": 0.0, "MAX": 0.15, "LABEL": "Ripple Strength"},
        {"NAME": "rippleFalloff", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.0, "MAX": 8.0, "LABEL": "Ripple Decay"},
        {"NAME": "depthScale", "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.0, "MAX": 0.4, "LABEL": "Depth Amount"},
        {"NAME": "centerX", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Ripple Center X"},
        {"NAME": "centerY", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Ripple Center Y"},
        {"NAME": "multiRipple", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Multi-Source Ripples"},
        {"NAME": "waveHighlight", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0, "LABEL": "Wave Edge Glow"}
    ]
}*/

// ============================================================================
// Image Depth Ripple - Animated Surface Waves
// Concentric ripple waves propagate across the image, displacing pixels
// based on their luminance height. Bright areas ripple more than dark.
// Audio beat triggers additional wave bursts.
// At camera (0,0) with amplitude 0: original image.
// ============================================================================

#define PI 3.14159265359

float getLuminance(vec2 uv) {
    vec4 tex = IMG_NORM_PIXEL(inputImage, clamp(uv, 0.001, 0.999));
    return dot(tex.rgb, vec3(0.299, 0.587, 0.114));
}

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    // Camera tilt for depth viewing
    float ax = cameraAngleX + audioBass * 3.0;
    float ay = cameraAngleY + audioMid * 2.0;
    vec2 tiltDir = vec2(sin(ax * PI / 180.0), sin(ay * PI / 180.0));

    // Audio-reactive depth
    float depth = depthScale + audioBeat * 0.04;

    // Image height at this pixel
    float h = getLuminance(uv);

    // --- Ripple displacement ---
    vec2 center = vec2(centerX, centerY);
    float dist = length(uv - center);

    // Primary ripple wave
    float wave = sin(dist * rippleFrequency * PI * 2.0 - TIME * rippleSpeed * PI * 2.0);
    wave *= rippleAmplitude;
    wave *= exp(-dist * rippleFalloff); // Distance decay

    // Audio-triggered ripple burst
    float audioBurst = sin(dist * 15.0 - TIME * 4.0) * audioBeat * 0.02;
    wave += audioBurst;

    // Multi-source ripples (3 additional centers)
    if (multiRipple > 0.01) {
        for (int i = 1; i < 4; i++) {
            float fi = float(i);
            vec2 extraCenter = vec2(
                0.5 + 0.3 * cos(fi * 2.094 + TIME * 0.2),
                0.5 + 0.3 * sin(fi * 2.094 + TIME * 0.15)
            );
            float eDist = length(uv - extraCenter);
            float eWave = sin(eDist * rippleFrequency * PI * 2.0 - TIME * rippleSpeed * PI * 2.0 + fi);
            eWave *= rippleAmplitude * multiRipple * 0.5;
            eWave *= exp(-eDist * rippleFalloff);
            wave += eWave;
        }
    }

    // Height-modulated displacement: bright areas ripple more
    float heightMod = 0.3 + h * 0.7;
    vec2 rippleDir = dist > 0.001 ? normalize(uv - center) : vec2(0.0);
    vec2 rippleDisp = rippleDir * wave * heightMod;

    // Camera depth displacement (parallax from height)
    vec2 depthDisp = tiltDir * h * depth;

    // Combined displacement
    vec2 totalDisp = rippleDisp + depthDisp;
    vec2 sampleUV = uv + totalDisp;

    // Sample displaced color
    vec3 color = IMG_NORM_PIXEL(inputImage, clamp(sampleUV, 0.001, 0.999)).rgb;

    // Wave crest highlight
    if (waveHighlight > 0.01) {
        float waveCrest = pow(abs(wave) / max(rippleAmplitude, 0.001), 2.0);
        waveCrest = clamp(waveCrest, 0.0, 1.0);
        color += vec3(waveCrest * waveHighlight * 0.3);

        // Chromatic fringe at wave edges
        float waveGrad = abs(cos(dist * rippleFrequency * PI * 2.0 - TIME * rippleSpeed * PI * 2.0));
        waveGrad *= exp(-dist * rippleFalloff);
        color.r += waveGrad * waveHighlight * 0.05;
        color.b -= waveGrad * waveHighlight * 0.03;
    }

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
