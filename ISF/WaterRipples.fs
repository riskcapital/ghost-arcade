/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Realistic water ripple effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "rippleSpeed", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "rippleCount", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 3.0},
        {"NAME": "amplitude", "TYPE": "float", "MIN": 0.01, "MAX": 0.2, "DEFAULT": 0.05},
        {"NAME": "decay", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 3.0},
        {"NAME": "baseColor", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359
#define TAU 6.28318530718

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

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float t = iTime * rippleSpeed;
    vec2 distort = vec2(0.0);

    int count = int(rippleCount);
    for (int i = 0; i < 10; i++) {
        if (i >= count) break;

        float fi = float(i);
        vec2 center = vec2(hash(fi * 12.34) - 0.5, hash(fi * 56.78 + 10.0) - 0.5) * 1.5;
        float phase = hash(fi * 90.12) * TAU;
        float freq = 15.0 + hash(fi * 34.56) * 10.0;

        float r = length(uv - center);
        float wave = sin(r * freq - t * 5.0 + phase);
        float falloff = exp(-r * decay) * amplitude;

        vec2 dir = normalize(uv - center + 0.001);
        distort += dir * wave * falloff;
    }

    // Apply distortion for refraction effect
    vec2 distortedUv = uv + distort;

    // Water color with depth variation
    float depth = length(distort) * 10.0;
    float hue = baseColor + depth * 0.1;
    float sat = 0.6 + depth * 0.2;
    float val = 0.4 + depth * 0.4;

    vec3 col = hsv2rgb(vec3(hue, sat, val));

    // Add highlights
    float highlight = smoothstep(0.02, 0.03, length(distort));
    col += vec3(1.0, 1.0, 0.9) * (1.0 - highlight) * 0.3;

    // Caustics-like pattern
    float caustic = sin(distortedUv.x * 30.0 + t) * sin(distortedUv.y * 30.0 + t * 0.7);
    col += vec3(0.2, 0.3, 0.4) * caustic * 0.1;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
