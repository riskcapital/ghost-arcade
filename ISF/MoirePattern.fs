/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Hypnotic moire interference pattern",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "lineFreq", "TYPE": "float", "MIN": 10.0, "MAX": 100.0, "DEFAULT": 40.0},
        {"NAME": "rotateSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2},
        {"NAME": "offset", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.1},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.1, "MAX": 0.9, "DEFAULT": 0.5},
        {"NAME": "layers", "TYPE": "float", "MIN": 2.0, "MAX": 6.0, "DEFAULT": 3.0}
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

float stripes(vec2 uv, float angle, float freq) {
    float c = cos(angle);
    float s = sin(angle);
    vec2 rotUv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
    return sin(rotUv.x * freq * PI * 2.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float t = iTime * rotateSpeed;

    float pattern = 0.0;
    int layerCount = int(layers);

    for (int i = 0; i < 6; i++) {
        if (i >= layerCount) break;

        float fi = float(i);
        float angle = t + fi * PI / float(layerCount);

        // Offset the center for each layer
        vec2 layerUv = uv + vec2(cos(angle), sin(angle)) * offset;

        float stripe = stripes(layerUv, angle, lineFreq);
        stripe = smoothstep(-lineWidth, lineWidth, stripe);

        pattern += stripe / float(layerCount);
    }

    // Create interference colors
    float hue = fract(pattern * 0.5 + t * 0.1);
    float sat = 0.7 + pattern * 0.3;
    float val = 0.3 + pattern * 0.7;

    vec3 col = hsv2rgb(vec3(hue, sat, val));

    // Add subtle radial darkening
    col *= 1.0 - length(uv) * 0.3;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
