/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Fluid morphing shapes with smooth transitions",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "complexity", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 4.0},
        {"NAME": "smoothness", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "hue", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "saturation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

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

// Smooth value noise
float smoothNoise(vec2 p) {
    float total = 0.0;
    float amplitude = 1.0;
    float frequency = 1.0;
    float maxValue = 0.0;

    for (int i = 0; i < 4; i++) {
        total += noise(p * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }

    return total / maxValue;
}

// Domain warping
vec2 warp(vec2 p, float t) {
    float nx = smoothNoise(p + vec2(t * 0.3, 0.0));
    float ny = smoothNoise(p + vec2(0.0, t * 0.3) + 10.0);
    return vec2(nx, ny) * 2.0 - 1.0;
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Multi-level domain warping for fluid effect
    vec2 p = uv * complexity;

    vec2 w1 = warp(p, t);
    vec2 w2 = warp(p + w1 * smoothness, t * 1.3);
    vec2 w3 = warp(p + w2 * smoothness * 0.5, t * 0.7);

    // Final warped position
    vec2 finalP = p + (w1 + w2 * 0.5 + w3 * 0.25) * smoothness;

    // Sample noise at warped position
    float n = smoothNoise(finalP);
    float n2 = smoothNoise(finalP * 2.0 + t * 0.5);

    // Create flowing patterns
    float pattern = n * 0.7 + n2 * 0.3;

    // Gradient coloring
    float h = hue + pattern * 0.15 + t * 0.02;
    float s = saturation + (1.0 - pattern) * 0.3;
    float v = 0.3 + pattern * 0.7;

    vec3 col = hsv2rgb(vec3(h, s, v));

    // Add depth with shadows and highlights
    float depth = smoothNoise(finalP * 0.5 + t * 0.2);
    col *= 0.7 + depth * 0.6;

    // Specular highlights
    float spec = pow(max(0.0, pattern - 0.7) * 3.33, 3.0);
    col += vec3(1.0) * spec * 0.5;

    // Subtle edge glow
    float edge = abs(fract(pattern * 5.0) - 0.5) * 2.0;
    edge = pow(1.0 - edge, 8.0);
    col += hsv2rgb(vec3(h + 0.1, 0.8, 1.0)) * edge * 0.15;

    gl_FragColor = vec4(col, 1.0);
}
