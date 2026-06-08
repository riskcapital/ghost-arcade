/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Radial color pulse emanating from center - great for focal points",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Color"],
    "INPUTS": [
        {"NAME": "pulseSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 5.0, "DEFAULT": 1.0, "LABEL": "Pulse Speed"},
        {"NAME": "ringCount", "TYPE": "float", "MIN": 1.0, "MAX": 20.0, "DEFAULT": 6.0, "LABEL": "Ring Count"},
        {"NAME": "centerX", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Center X"},
        {"NAME": "centerY", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Center Y"},
        {"NAME": "colorA", "TYPE": "color", "DEFAULT": [1.0, 0.2, 0.5, 1.0], "LABEL": "Color A"},
        {"NAME": "colorB", "TYPE": "color", "DEFAULT": [0.2, 0.5, 1.0, 1.0], "LABEL": "Color B"},
        {"NAME": "softness", "TYPE": "float", "MIN": 0.01, "MAX": 0.5, "DEFAULT": 0.1, "LABEL": "Softness"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 center = vec2(centerX, centerY);

    // Calculate distance from center
    vec2 diff = uv - center;
    diff.x *= RENDERSIZE.x / RENDERSIZE.y;
    float dist = length(diff);

    // Create animated rings
    float t = TIME * pulseSpeed;
    float rings = sin((dist * ringCount * 6.28) - t) * 0.5 + 0.5;

    // Smooth the rings
    rings = smoothstep(0.5 - softness, 0.5 + softness, rings);

    // Mix colors
    vec3 color = mix(colorA.rgb, colorB.rgb, rings);

    // Fade at edges
    float fade = 1.0 - smoothstep(0.3, 0.8, dist);
    color *= fade * 0.8 + 0.2;

    gl_FragColor = vec4(color, 1.0);
}
