/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Audio waveform visualizer style",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "waveFreq", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 3.0},
        {"NAME": "waveSpeed", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0},
        {"NAME": "amplitude", "TYPE": "float", "MIN": 0.1, "MAX": 0.5, "DEFAULT": 0.3},
        {"NAME": "lineGlow", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "stereoSplit", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.1}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

float waveform(float x, float t, float channel) {
    float wave = 0.0;

    // Main wave
    wave += sin(x * waveFreq * PI * 2.0 - t * waveSpeed) * 0.5;

    // Harmonics
    wave += sin(x * waveFreq * PI * 4.0 - t * waveSpeed * 1.5 + channel) * 0.25;
    wave += sin(x * waveFreq * PI * 8.0 + t * waveSpeed * 0.5) * 0.125;

    // Add some noise/variation
    wave += (hash(floor(x * 50.0 + t * 10.0)) - 0.5) * 0.3;

    return wave * amplitude;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    uv.x *= iResolution.x / iResolution.y;

    float t = iTime;
    vec3 col = vec3(0.0, 0.02, 0.05); // Dark background

    // Grid lines
    float gridX = smoothstep(0.02, 0.0, abs(fract(uv.x * 10.0) - 0.5));
    float gridY = smoothstep(0.02, 0.0, abs(fract(uv.y * 10.0) - 0.5));
    col += vec3(0.0, 0.1, 0.1) * (gridX + gridY) * 0.2;

    // Center line
    col += vec3(0.0, 0.2, 0.2) * smoothstep(0.01, 0.0, abs(uv.y - 0.5));

    // Left channel (upper)
    float y1 = 0.5 + stereoSplit + waveform(uv.x, t, 0.0);
    float dist1 = abs(uv.y - y1);
    float line1 = smoothstep(0.008, 0.0, dist1);
    float glow1 = exp(-dist1 * 30.0) * lineGlow;

    col += vec3(0.0, 1.0, 0.5) * line1;
    col += vec3(0.0, 0.5, 0.3) * glow1 * 0.5;

    // Right channel (lower)
    float y2 = 0.5 - stereoSplit + waveform(uv.x, t + 0.5, PI);
    float dist2 = abs(uv.y - y2);
    float line2 = smoothstep(0.008, 0.0, dist2);
    float glow2 = exp(-dist2 * 30.0) * lineGlow;

    col += vec3(0.0, 0.5, 1.0) * line2;
    col += vec3(0.0, 0.3, 0.5) * glow2 * 0.5;

    // Scanline effect
    float scanline = sin(uv.y * iResolution.y * 0.5) * 0.05;
    col *= 1.0 - scanline;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
