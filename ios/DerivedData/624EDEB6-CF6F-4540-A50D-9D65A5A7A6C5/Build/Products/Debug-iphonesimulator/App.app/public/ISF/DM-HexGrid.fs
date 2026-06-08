/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Hexagonal grid pattern with animated fills",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Geometric"],
    "INPUTS": [
        {"NAME": "scale", "TYPE": "float", "MIN": 2.0, "MAX": 20.0, "DEFAULT": 8.0, "LABEL": "Scale"},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Speed"},
        {"NAME": "fillAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7, "LABEL": "Fill Amount"},
        {"NAME": "edgeGlow", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Edge Glow"},
        {"NAME": "colorA", "TYPE": "color", "DEFAULT": [0.0, 0.5, 1.0, 1.0], "LABEL": "Color A"},
        {"NAME": "colorB", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.5, 1.0], "LABEL": "Color B"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

const vec2 s = vec2(1.7320508, 1.0); // sqrt(3), 1

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec4 getHex(vec2 p) {
    vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
    vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
    return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;
    p *= scale;

    vec4 hex = getHex(p);
    vec2 hexCenter = hex.zw;
    float hexDist = length(hex.xy);

    // Hash for random timing per hex
    float h = hash(hexCenter);
    float t = TIME * speed + h * 6.28;

    // Animated fill
    float fill = sin(t) * 0.5 + 0.5;
    fill = smoothstep(1.0 - fillAmount, 1.0, fill);

    // Hex edge
    float edge = smoothstep(0.5, 0.45, hexDist);
    float edgeLine = smoothstep(0.5, 0.48, hexDist) - smoothstep(0.48, 0.46, hexDist);

    // Color based on position
    vec3 color = mix(colorA.rgb, colorB.rgb, fract(hexCenter.x * 0.1 + hexCenter.y * 0.15 + TIME * 0.1));

    // Combine
    vec3 finalColor = color * edge * fill;
    finalColor += color * edgeLine * edgeGlow;

    gl_FragColor = vec4(finalColor, 1.0);
}
