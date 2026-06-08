/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Infinite fractal zoom - mesmerizing recursive patterns",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Fractal"],
    "INPUTS": [
        {"NAME": "zoomSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Zoom Speed"},
        {"NAME": "iterations", "TYPE": "float", "MIN": 3.0, "MAX": 12.0, "DEFAULT": 7.0, "LABEL": "Iterations"},
        {"NAME": "complexity", "TYPE": "float", "MIN": 1.0, "MAX": 5.0, "DEFAULT": 2.5, "LABEL": "Complexity"},
        {"NAME": "colorSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Color Speed"},
        {"NAME": "baseColor", "TYPE": "color", "DEFAULT": [0.5, 0.0, 1.0, 1.0], "LABEL": "Base Color"},
        {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [1.0, 0.5, 0.0, 1.0], "LABEL": "Glow Color"},
        {"NAME": "rotateSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2, "LABEL": "Rotation"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec2 rotate(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * zoomSpeed;
    float zoom = pow(2.0, fract(t) * 2.0);

    p *= zoom;
    p = rotate(p, TIME * rotateSpeed);

    float d = 1e10;
    float glow = 0.0;

    for (float i = 0.0; i < 12.0; i++) {
        if (i >= iterations) break;

        // Fold space
        p = abs(p);
        p -= 0.5;
        p = rotate(p, 0.785398 + t * 0.1);

        // Scale
        float scale = 1.5 + sin(t * 0.3 + i) * 0.2;
        p *= scale;

        // Track minimum distance to create patterns
        float shape = length(p) - complexity;
        d = min(d, abs(shape));

        // Accumulate glow
        glow += 0.1 / (0.1 + abs(shape));
    }

    // Create color from distance field
    float edge = smoothstep(0.1, 0.0, d);
    float colorPhase = t * colorSpeed + length(uv - 0.5) * 3.0;

    vec3 col1 = baseColor.rgb;
    vec3 col2 = glowColor.rgb;
    vec3 col = mix(col1, col2, sin(colorPhase) * 0.5 + 0.5);

    col = col * edge + col * glow * 0.15;
    col = pow(col, vec3(0.8)); // Gamma

    gl_FragColor = vec4(col, 1.0);
}
