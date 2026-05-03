/*{
    "DESCRIPTION": "Resonant wave interference web with layered sinusoidal displacement fields",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "waveScale", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "layerCount", "TYPE": "float", "DEFAULT": 9.0, "MIN": 3.0, "MAX": 12.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.01, "MAX": 0.5},
        {"NAME": "colorSpread", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0},
        {"NAME": "warpAmount", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0}
    ]
}*/

// tanh polyfill for WebGL1 compatibility
vec4 tanhApprox(vec4 x) {
    vec4 e2 = exp(2.0 * clamp(x, -10.0, 10.0));
    return (e2 - vec4(1.0)) / (e2 + vec4(1.0));
}

void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - RENDERSIZE) / RENDERSIZE.y / waveScale;
    float t = TIME * speed;
    vec4 col = vec4(0.0);

    // Audio-reactive displacement
    float audioWarp = 1.0 + audioMid * 0.5;
    float audioGlow = 1.0 + audioLevel * 2.0;

    for (float i = 0.0; i < 12.0; i++) {
        if (i >= layerCount) break;

        // Inner displacement loop - wave field accumulation
        vec2 v = uv;
        for (float f = 1.0; f < 10.0; f++) {
            v += sin(ceil(v.yx * f + i * 0.3) + RENDERSIZE * 0.001 - t * 0.5) / f * warpAmount * audioWarp;
        }

        // Radial distance metric with wave memory
        float l = dot(uv, uv) - 5.0 - 2.0 / max(abs(v.y), 0.001);

        // Layered chromatic contribution
        col += intensity / abs(l) * (cos(i / (3.0 * colorSpread) + 0.1 / max(abs(l), 0.01) + vec4(1.0, 2.0, 3.0, 4.0)) + 1.0) * audioGlow;
    }

    // Soft tone mapping
    gl_FragColor = max(tanhApprox(col), vec4(0.0));
    gl_FragColor.a = 1.0;
}
