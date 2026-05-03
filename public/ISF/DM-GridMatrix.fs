/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated grid pattern with glowing intersections",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Geometric"],
    "INPUTS": [
        {"NAME": "gridSize", "TYPE": "float", "MIN": 2.0, "MAX": 30.0, "DEFAULT": 10.0, "LABEL": "Grid Size"},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.01, "MAX": 0.2, "DEFAULT": 0.05, "LABEL": "Line Width"},
        {"NAME": "pulseSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Pulse Speed"},
        {"NAME": "glowIntensity", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Glow"},
        {"NAME": "lineColor", "TYPE": "color", "DEFAULT": [0.0, 0.8, 1.0, 1.0], "LABEL": "Line Color"},
        {"NAME": "bgColor", "TYPE": "color", "DEFAULT": [0.0, 0.05, 0.1, 1.0], "LABEL": "Background"},
        {"NAME": "perspective", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "Perspective"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    // Apply perspective
    if (perspective > 0.0) {
        float pf = 1.0 + p.y * perspective * 0.5;
        p.x *= pf;
    }

    // Create grid
    vec2 grid = fract(p * gridSize) - 0.5;
    vec2 gridId = floor(p * gridSize);

    // Animated pulse at intersections
    float t = TIME * pulseSpeed;
    float pulse = sin(gridId.x * 0.5 + gridId.y * 0.7 + t) * 0.5 + 0.5;

    // Distance to grid lines
    float dX = abs(grid.x);
    float dY = abs(grid.y);
    float dLine = min(dX, dY);

    // Line with glow
    float line = smoothstep(lineWidth, lineWidth * 0.5, dLine);
    float glow = smoothstep(lineWidth * 4.0, lineWidth, dLine) * glowIntensity * 0.3;

    // Intersection highlight
    float intersection = smoothstep(lineWidth * 2.0, lineWidth, length(grid)) * pulse;

    // Combine
    vec3 color = bgColor.rgb;
    color += lineColor.rgb * (line + glow);
    color += lineColor.rgb * intersection * glowIntensity;

    gl_FragColor = vec4(color, 1.0);
}
