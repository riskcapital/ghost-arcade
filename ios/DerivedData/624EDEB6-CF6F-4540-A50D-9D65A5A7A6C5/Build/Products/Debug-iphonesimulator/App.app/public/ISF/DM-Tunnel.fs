/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Infinite tunnel effect with customizable rings",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Geometric"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 5.0, "DEFAULT": 1.0, "LABEL": "Speed"},
        {"NAME": "ringCount", "TYPE": "float", "MIN": 2.0, "MAX": 20.0, "DEFAULT": 8.0, "LABEL": "Ring Count"},
        {"NAME": "twist", "TYPE": "float", "MIN": 0.0, "MAX": 5.0, "DEFAULT": 1.0, "LABEL": "Twist"},
        {"NAME": "centerX", "TYPE": "float", "MIN": -0.5, "MAX": 0.5, "DEFAULT": 0.0, "LABEL": "Center X"},
        {"NAME": "centerY", "TYPE": "float", "MIN": -0.5, "MAX": 0.5, "DEFAULT": 0.0, "LABEL": "Center Y"},
        {"NAME": "colorA", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0], "LABEL": "Color A"},
        {"NAME": "colorB", "TYPE": "color", "DEFAULT": [0.0, 0.8, 1.0, 1.0], "LABEL": "Color B"},
        {"NAME": "glow", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Glow"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = uv - 0.5 - vec2(centerX, centerY);
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    // Polar coordinates
    float r = length(p);
    float a = atan(p.y, p.x);

    // Tunnel effect
    float tunnel = 1.0 / (r + 0.1);
    float t = TIME * speed;

    // Twist
    a += tunnel * twist + t * 0.2;

    // Ring pattern
    float rings = sin(tunnel * ringCount - t * 3.0) * 0.5 + 0.5;

    // Angular segments
    float segments = sin(a * 8.0 + tunnel * 2.0) * 0.5 + 0.5;

    // Combine patterns
    float pattern = rings * segments;

    // Add glow based on distance
    float edgeGlow = smoothstep(0.5, 0.0, r) * glow;

    // Color
    vec3 color = mix(colorA.rgb, colorB.rgb, pattern);
    color += colorB.rgb * edgeGlow * 0.5;

    // Depth fade
    color *= smoothstep(0.0, 0.15, r);

    gl_FragColor = vec4(color, 1.0);
}
