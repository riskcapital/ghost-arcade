/*{
    "DESCRIPTION": "Clean sine wave vortex interference field with layered chromatic glow",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "fieldScale", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "layerCount", "TYPE": "float", "DEFAULT": 10.0, "MIN": 3.0, "MAX": 15.0},
        {"NAME": "glowPower", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 4.0},
        {"NAME": "colorOffset", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "waveDepth", "TYPE": "float", "DEFAULT": 9.0, "MIN": 3.0, "MAX": 12.0}
    ]
}*/

// tanh polyfill for WebGL1 compatibility
vec4 tanhApprox(vec4 x) {
    vec4 e2 = exp(2.0 * clamp(x, -10.0, 10.0));
    return (e2 - vec4(1.0)) / (e2 + vec4(1.0));
}

void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - RENDERSIZE) / RENDERSIZE.y / fieldScale;
    float t = TIME * speed;
    vec4 col = vec4(0.0);

    // Audio-reactive wave and glow
    float audioWave = 1.0 + audioHigh * 0.4;
    float beatGlow = 1.0 + audioBeat * 1.5;

    for (float i = 0.0; i < 15.0; i++) {
        if (i >= layerCount) break;

        // Sine wave displacement cascade
        vec2 v = uv;
        for (float f = 1.0; f < 12.0; f++) {
            if (f >= waveDepth) break;
            v += sin(v.yx * f + i + t) / f * audioWave;
        }

        // Pure radial glow from displaced position
        float r = length(v);
        float glow = (1.0 / max(r, 0.01)) / 6.0;

        // Chromatic layering with per-channel cosine offset
        col += glow * glowPower * (cos(i + colorOffset + vec4(0.0, 1.0, 2.0, 3.0)) + 1.0) * beatGlow;
    }

    // Squared tone mapping for vivid saturation
    gl_FragColor = tanhApprox(col * col);
    gl_FragColor.a = 1.0;
}
