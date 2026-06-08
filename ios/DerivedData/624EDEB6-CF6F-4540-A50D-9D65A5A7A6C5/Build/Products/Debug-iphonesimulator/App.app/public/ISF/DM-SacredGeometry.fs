/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Sacred geometry patterns - flower of life and more",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Geometric"],
    "INPUTS": [
        {"NAME": "pattern", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 0.0, "LABEL": "Pattern Type"},
        {"NAME": "scale", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Scale"},
        {"NAME": "rotationSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.1, "LABEL": "Rotation"},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.01, "MAX": 0.1, "DEFAULT": 0.03, "LABEL": "Line Width"},
        {"NAME": "glowAmount", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Glow"},
        {"NAME": "lineColor", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.3, 1.0], "LABEL": "Line Color"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

float circle(vec2 p, vec2 c, float r, float w) {
    float d = abs(length(p - c) - r);
    return smoothstep(w, w * 0.5, d);
}

float flowerOfLife(vec2 p, float r, float w) {
    float d = 0.0;
    // Center circle
    d += circle(p, vec2(0.0), r, w);
    // 6 surrounding circles
    for (int i = 0; i < 6; i++) {
        float a = float(i) * PI / 3.0;
        vec2 c = vec2(cos(a), sin(a)) * r;
        d += circle(p, c, r, w);
    }
    return min(d, 1.0);
}

float metatronsCube(vec2 p, float r, float w) {
    float d = 0.0;
    // 13 circles for Metatron's Cube
    d += circle(p, vec2(0.0), r, w);
    for (int i = 0; i < 6; i++) {
        float a = float(i) * PI / 3.0;
        vec2 c = vec2(cos(a), sin(a)) * r;
        d += circle(p, c, r * 0.5, w);
        d += circle(p, c * 2.0, r * 0.5, w);
    }
    return min(d, 1.0);
}

float sriYantra(vec2 p, float s, float w) {
    float d = 0.0;
    // Simplified triangular pattern
    for (int i = 0; i < 5; i++) {
        float scale = 1.0 - float(i) * 0.18;
        float rotation = float(i) * 0.2;
        vec2 rp = vec2(
            p.x * cos(rotation) - p.y * sin(rotation),
            p.x * sin(rotation) + p.y * cos(rotation)
        );
        // Upward triangle
        float t1 = max(abs(rp.x) * 1.73 + rp.y, -rp.y * 2.0) - s * scale;
        d += smoothstep(w, 0.0, abs(t1));
        // Downward triangle
        float t2 = max(abs(rp.x) * 1.73 - rp.y, rp.y * 2.0) - s * scale * 0.9;
        d += smoothstep(w, 0.0, abs(t2));
    }
    return min(d, 1.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    // Rotation
    float t = TIME * rotationSpeed;
    vec2 rp = vec2(
        p.x * cos(t) - p.y * sin(t),
        p.x * sin(t) + p.y * cos(t)
    );
    rp *= scale;

    float d = 0.0;

    if (pattern < 1.0) {
        d = flowerOfLife(rp, 0.3, lineWidth);
    } else if (pattern < 2.0) {
        d = metatronsCube(rp, 0.35, lineWidth);
    } else {
        d = sriYantra(rp, 0.5, lineWidth * 2.0);
    }

    // Glow
    float glow = d * glowAmount;

    vec3 color = lineColor.rgb * d;
    color += lineColor.rgb * glow * 0.3;

    // Subtle background
    color += lineColor.rgb * 0.02;

    gl_FragColor = vec4(color, 1.0);
}
