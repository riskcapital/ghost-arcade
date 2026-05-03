/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated spirograph patterns",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Geometric"],
    "INPUTS": [
        {"NAME": "innerRadius", "TYPE": "float", "MIN": 0.1, "MAX": 0.9, "DEFAULT": 0.4, "LABEL": "Inner Radius"},
        {"NAME": "penOffset", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "Pen Offset"},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Speed"},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.002, "MAX": 0.02, "DEFAULT": 0.005, "LABEL": "Line Width"},
        {"NAME": "glowSize", "TYPE": "float", "MIN": 0.0, "MAX": 0.1, "DEFAULT": 0.03, "LABEL": "Glow"},
        {"NAME": "trailLength", "TYPE": "float", "MIN": 100.0, "MAX": 2000.0, "DEFAULT": 800.0, "LABEL": "Trail Length"},
        {"NAME": "lineColor", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.8, 1.0], "LABEL": "Line Color"},
        {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [0.0, 0.5, 1.0, 1.0], "LABEL": "Glow Color"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec2 spirograph(float t, float R, float r, float p) {
    float diff = R - r;
    return vec2(
        diff * cos(t) + p * cos(diff * t / r),
        diff * sin(t) - p * sin(diff * t / r)
    );
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 center = uv - 0.5;
    center.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * speed;

    float R = 1.0;
    float r = innerRadius;
    float p = penOffset * r;

    vec3 col = vec3(0.0);
    float minDist = 1000.0;

    // Draw spirograph by sampling many points
    for (float i = 0.0; i < 2000.0; i++) {
        if (i >= trailLength) break;

        float angle = t + i * 0.01;
        vec2 sp = spirograph(angle, R, r, p) * 0.4;

        float d = length(center - sp);
        minDist = min(minDist, d);
    }

    // Line
    float line = smoothstep(lineWidth, lineWidth * 0.3, minDist);

    // Glow
    float glow = smoothstep(glowSize, 0.0, minDist);

    col = lineColor.rgb * line + glowColor.rgb * glow * 0.5;

    gl_FragColor = vec4(col, 1.0);
}
