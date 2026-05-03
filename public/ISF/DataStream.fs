/*{
    "CREDIT": "Shrink Wrap",
    "DESCRIPTION": "Flowing data streams with binary aesthetics",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.8},
        {"NAME": "streamCount", "TYPE": "float", "MIN": 5.0, "MAX": 30.0, "DEFAULT": 15.0},
        {"NAME": "dataIntensity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7},
        {"NAME": "hue", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "waveAmplitude", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3},
        {"NAME": "glowIntensity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float bitPattern(vec2 p, float t) {
    vec2 cell = floor(p);
    float bit = hash2(cell + floor(t * 5.0));
    return step(0.5, bit);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 centered = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    vec3 col = vec3(0.0);
    float glow = 0.0;

    int streams = int(streamCount);
    for (int i = 0; i < 30; i++) {
        if (i >= streams) break;

        float fi = float(i);
        float streamX = (fi / streamCount) * 2.0 - 1.0;

        // Wave motion
        float wave = sin(centered.y * 5.0 + t * 2.0 + fi) * waveAmplitude * 0.1;
        streamX += wave;

        // Stream width
        float width = 0.02 + hash(fi * 3.7) * 0.02;

        // Distance to stream
        float d = abs(centered.x - streamX);

        // Stream brightness
        float stream = smoothstep(width, width * 0.3, d);

        // Data bits flowing down
        float bitY = centered.y * 20.0 - t * (3.0 + hash(fi * 2.3) * 2.0);
        float bit = bitPattern(vec2(fi, bitY), t);

        // Combine stream and data
        float brightness = stream * (0.3 + bit * dataIntensity * 0.7);

        // Speed variation creates depth
        float depth = hash(fi * 5.1);
        float streamHue = hue + depth * 0.1;

        col += hsv2rgb(vec3(streamHue, 0.8, 1.0)) * brightness * (0.5 + depth * 0.5);
        glow += stream * 0.1;
    }

    // Add horizontal data pulses
    float pulse = sin(centered.x * 30.0 + t * 8.0) * 0.5 + 0.5;
    pulse *= exp(-abs(centered.y) * 3.0);
    col += hsv2rgb(vec3(hue + 0.3, 0.6, 0.5)) * pulse * dataIntensity * 0.2;

    // Glow effect
    col += hsv2rgb(vec3(hue, 0.4, 0.3)) * glow * glowIntensity;

    // Background grid
    vec2 gridUV = fract(centered * 20.0);
    float grid = smoothstep(0.95, 0.98, max(gridUV.x, gridUV.y));
    col += vec3(0.02) * grid;

    gl_FragColor = vec4(col, 1.0);
}
