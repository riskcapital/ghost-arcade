/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Stylized ocean waves",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "waveSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "waveHeight", "TYPE": "float", "MIN": 0.05, "MAX": 0.3, "DEFAULT": 0.15},
        {"NAME": "waveCount", "TYPE": "float", "MIN": 2.0, "MAX": 10.0, "DEFAULT": 5.0},
        {"NAME": "foamAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "depthFade", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

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

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    uv.x *= iResolution.x / iResolution.y;

    float t = iTime * waveSpeed;

    // Wave layers
    float wave = 0.0;
    for (float i = 0.0; i < 10.0; i++) {
        if (i >= waveCount) break;
        float freq = 3.0 + i * 2.0;
        float amp = waveHeight / (1.0 + i * 0.5);
        float phase = i * 1.3;
        wave += sin(uv.x * freq + t * (1.0 + i * 0.2) + phase) * amp;
        wave += sin(uv.x * freq * 1.3 - t * 0.8 + phase + 2.0) * amp * 0.5;
    }

    // Add noise for choppiness
    wave += (noise(uv * 10.0 + t) - 0.5) * 0.03;

    // Wave surface position
    float surface = 0.5 + wave;

    // Water color with depth
    float depth = max(0.0, surface - uv.y);
    vec3 deepColor = vec3(0.0, 0.1, 0.3);
    vec3 shallowColor = vec3(0.0, 0.4, 0.6);
    vec3 waterColor = mix(shallowColor, deepColor, smoothstep(0.0, 0.3 * depthFade, depth));

    // Sky reflection on surface
    float surfaceDist = abs(uv.y - surface);
    float reflection = exp(-surfaceDist * 50.0);
    vec3 skyColor = vec3(0.5, 0.7, 0.9);

    // Foam on wave peaks
    float foam = 0.0;
    float localSlope = dFdx(wave) * 10.0;
    foam = smoothstep(0.1, 0.3, wave + 0.1) * smoothstep(0.0, 0.02, surfaceDist);
    foam *= foamAmount;
    foam += noise(uv * 50.0 + t * 2.0) * 0.3 * foam;

    vec3 col;
    if (uv.y > surface) {
        // Above water - sky
        col = skyColor * (0.8 + uv.y * 0.3);
    } else {
        // Below surface - water
        col = waterColor;
        col = mix(col, skyColor, reflection * 0.3);
    }

    // Add foam
    col = mix(col, vec3(0.9, 0.95, 1.0), foam);

    // Sun reflection
    float sunReflect = exp(-pow((uv.x - 0.7) * 3.0, 2.0)) * reflection;
    col += vec3(1.0, 0.9, 0.7) * sunReflect * 0.5;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
