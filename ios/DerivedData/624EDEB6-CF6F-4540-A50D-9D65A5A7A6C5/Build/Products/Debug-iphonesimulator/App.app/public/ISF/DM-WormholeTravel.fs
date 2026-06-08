/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Traveling through a wormhole tunnel",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Tunnel"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Speed"},
        {"NAME": "twist", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Twist"},
        {"NAME": "segments", "TYPE": "float", "MIN": 4.0, "MAX": 16.0, "DEFAULT": 8.0, "LABEL": "Segments"},
        {"NAME": "colorSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Color Speed"},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [0.0, 0.5, 1.0, 1.0], "LABEL": "Color 1"},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.5, 1.0], "LABEL": "Color 2"},
        {"NAME": "color3", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.5, 1.0], "LABEL": "Color 3"},
        {"NAME": "centerBrightness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Center Glow"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * speed;

    // Convert to polar coordinates
    float r = length(p);
    float a = atan(p.y, p.x);

    // Tunnel depth (inverse radius gives depth illusion)
    float depth = 0.5 / (r + 0.1);

    // Add twist based on depth
    a += depth * twist + t * 0.3;

    // Forward motion
    depth += t;

    // Create tunnel segments
    float segmentAngle = 6.283185 / segments;
    float segment = floor(a / segmentAngle + 0.5);
    float segmentDist = abs(fract(a / segmentAngle + 0.5) - 0.5);

    // Depth rings
    float rings = fract(depth * 2.0);

    // Pattern
    float pattern = smoothstep(0.05, 0.1, segmentDist);
    pattern *= smoothstep(0.0, 0.1, rings) * smoothstep(1.0, 0.9, rings);

    // Edge glow
    float edge = smoothstep(0.15, 0.0, segmentDist);
    edge *= smoothstep(0.5, 0.1, rings);

    // Color cycling
    float colorPhase = fract(segment / segments + TIME * colorSpeed);
    vec3 col;
    if (colorPhase < 0.33) {
        col = mix(color1.rgb, color2.rgb, colorPhase * 3.0);
    } else if (colorPhase < 0.66) {
        col = mix(color2.rgb, color3.rgb, (colorPhase - 0.33) * 3.0);
    } else {
        col = mix(color3.rgb, color1.rgb, (colorPhase - 0.66) * 3.0);
    }

    // Combine
    vec3 finalCol = vec3(0.0);
    finalCol += col * pattern * (1.0 - r * 0.5);
    finalCol += col * edge * 0.5;

    // Center glow
    finalCol += vec3(1.0) * smoothstep(0.3, 0.0, r) * centerBrightness;

    // Fade at edges
    finalCol *= smoothstep(1.0, 0.3, r);

    gl_FragColor = vec4(finalCol, 1.0);
}
