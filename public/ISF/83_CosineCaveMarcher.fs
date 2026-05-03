/*{
    "DESCRIPTION": "3D cosine cave raymarcher with harmonic volume coloring and depth fog",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "marchSteps", "TYPE": "float", "DEFAULT": 60.0, "MIN": 20.0, "MAX": 100.0},
        {"NAME": "caveDensity", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.01, "MAX": 2.0},
        {"NAME": "fogDensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0},
        {"NAME": "colorPalette", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "caveScale", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0}
    ]
}*/

// tanh polyfill for WebGL1 compatibility
vec4 tanhApprox(vec4 x) {
    vec4 e2 = exp(2.0 * clamp(x, -10.0, 10.0));
    return (e2 - vec4(1.0)) / (e2 + vec4(1.0));
}

void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    vec4 col = vec4(0.0);

    // Audio-reactive camera drift
    float audioDrift = audioBass * 0.3;
    float audioEmission = 1.0 + audioLevel * 3.0;

    // Ray setup
    vec3 rd = normalize(vec3(uv, -1.5));
    float z = 0.0;

    for (float i = 0.0; i < 100.0; i++) {
        if (i >= marchSteps) break;

        // March through cave
        vec3 p = z * rd * caveScale;
        p.yz -= t + audioDrift;

        // Cosine volume distance: nested cosine warps create organic cave walls
        vec3 v = cos(p + cos(p * caveDensity));
        float d = length(max(v, v.yzx * 0.1)) / 6.0;
        z += d;

        // Accumulate color from cave walls based on proximity
        // sin(p.y + palette) creates banded coloring through the cave
        float fogAtten = 1.0 / (1.0 + z * z * fogDensity * 0.01);
        col += (sin(p.y + colorPalette + vec4(0.0, 2.0, 5.0, 4.0)) + 1.0) / max(d, 0.001) * fogAtten * audioEmission;
    }

    // Normalize accumulated color and tone-map
    gl_FragColor = tanhApprox(col / 10000.0);
    gl_FragColor.a = 1.0;
}
