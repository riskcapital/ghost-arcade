/*{
    "DESCRIPTION": "Cosine-driven flow field with mosaic structure and chromatic interference layers",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "fieldScale", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "layerCount", "TYPE": "float", "DEFAULT": 9.0, "MIN": 3.0, "MAX": 12.0},
        {"NAME": "glowIntensity", "TYPE": "float", "DEFAULT": 0.01, "MIN": 0.001, "MAX": 0.1},
        {"NAME": "colorCycle", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 8.0},
        {"NAME": "turbulence", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0}
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

    // Audio-reactive turbulence
    float audioTurb = 1.0 + audioBass * 0.8;
    float beatPulse = 1.0 + audioBeat * 0.5;

    for (float i = 0.0; i < 12.0; i++) {
        if (i >= layerCount) break;

        // Cosine displacement field - distinct from shader 80's sine approach
        vec2 v = uv;
        for (float f = 1.0; f < 10.0; f++) {
            v += cos(ceil(v.yx * f + i * 0.1) + t * 0.5) / f * turbulence * audioTurb;
        }

        // Cross-product distance metric - creates mosaic tiling effect
        float l = length(v * v.yx) + 0.001;

        // Chromatic accumulation with shifted color channels
        col += glowIntensity / l * (cos(i / colorCycle + v.y * beatPulse + vec4(0.0, 1.0, 2.0, 4.0)) + 1.0);
    }

    // Saturated tone mapping
    gl_FragColor = max(tanhApprox(col * col), vec4(0.0));
    gl_FragColor.a = 1.0;
}
