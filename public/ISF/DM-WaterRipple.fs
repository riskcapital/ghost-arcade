/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Realistic water ripple effect with multiple waves",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Motion"],
    "INPUTS": [
        {"NAME": "rippleSpeed", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Speed"},
        {"NAME": "rippleCount", "TYPE": "float", "MIN": 1.0, "MAX": 5.0, "DEFAULT": 3.0, "LABEL": "Ripple Count"},
        {"NAME": "frequency", "TYPE": "float", "MIN": 5.0, "MAX": 50.0, "DEFAULT": 20.0, "LABEL": "Frequency"},
        {"NAME": "amplitude", "TYPE": "float", "MIN": 0.0, "MAX": 0.1, "DEFAULT": 0.02, "LABEL": "Amplitude"},
        {"NAME": "decay", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5, "LABEL": "Decay"},
        {"NAME": "waterColor", "TYPE": "color", "DEFAULT": [0.1, 0.3, 0.5, 1.0], "LABEL": "Water Color"},
        {"NAME": "highlightColor", "TYPE": "color", "DEFAULT": [0.6, 0.8, 1.0, 1.0], "LABEL": "Highlight"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * rippleSpeed;

    // Multiple ripple sources
    float totalDisplacement = 0.0;

    for (int i = 0; i < 5; i++) {
        if (float(i) >= rippleCount) break;

        // Ripple center
        float h = hash(vec2(float(i), float(i) * 0.7));
        float h2 = hash(vec2(float(i) * 1.3, float(i)));
        vec2 center = vec2(h * 2.0 - 1.0, h2 * 2.0 - 1.0) * 0.5;

        float d = length(p - center);

        // Ripple wave
        float wave = sin(d * frequency - t * (1.0 + h * 0.5));

        // Decay with distance
        float att = exp(-d * decay) * amplitude;

        totalDisplacement += wave * att;
    }

    // Calculate normals for shading
    float eps = 0.01;
    vec2 uvX = uv + vec2(eps, 0.0);
    vec2 uvY = uv + vec2(0.0, eps);

    // Simplified gradient calculation
    float dx = totalDisplacement * 10.0;
    float dy = totalDisplacement * 10.0;

    // Shading based on displacement
    float shade = 0.5 + totalDisplacement * 20.0;

    // Color
    vec3 color = mix(waterColor.rgb, highlightColor.rgb, shade);

    // Add caustic-like patterns
    float caustic = sin(p.x * 30.0 + totalDisplacement * 50.0 + t) *
                   sin(p.y * 30.0 + totalDisplacement * 50.0 - t * 0.7);
    caustic = caustic * 0.5 + 0.5;
    color += highlightColor.rgb * caustic * 0.1;

    gl_FragColor = vec4(color, 1.0);
}
