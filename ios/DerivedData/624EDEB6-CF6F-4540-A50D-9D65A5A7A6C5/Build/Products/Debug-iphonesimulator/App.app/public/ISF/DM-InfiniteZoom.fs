/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Hypnotic infinite zoom tunnel effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Tunnel"],
    "INPUTS": [
        {"NAME": "zoomSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Zoom Speed"},
        {"NAME": "rotateSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.3, "LABEL": "Rotation"},
        {"NAME": "layers", "TYPE": "float", "MIN": 3.0, "MAX": 12.0, "DEFAULT": 6.0, "LABEL": "Layers"},
        {"NAME": "shapeType", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 0.0, "LABEL": "Shape"},
        {"NAME": "thickness", "TYPE": "float", "MIN": 0.01, "MAX": 0.2, "DEFAULT": 0.05, "LABEL": "Thickness"},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.5, 1.0], "LABEL": "Color 1"},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 1.0, 1.0, 1.0], "LABEL": "Color 2"},
        {"NAME": "bgColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.1, 1.0], "LABEL": "Background"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdCircle(vec2 p, float r) {
    return length(p) - r;
}

float sdHex(vec2 p, float r) {
    p = abs(p);
    return max(p.x * 0.866025 + p.y * 0.5, p.y) - r;
}

float sdTriangle(vec2 p, float r) {
    float k = sqrt(3.0);
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * zoomSpeed;

    vec3 col = bgColor.rgb;

    for (float i = 0.0; i < 12.0; i++) {
        if (i >= layers) break;

        float scale = exp(mod(t + i / layers * 2.0, 2.0));
        vec2 sp = p * scale;

        // Rotation
        float angle = TIME * rotateSpeed + i * 0.5;
        float c = cos(angle), s = sin(angle);
        sp = vec2(sp.x * c - sp.y * s, sp.x * s + sp.y * c);

        float d;
        if (shapeType < 1.0) {
            d = abs(sdCircle(sp, 0.8)) - thickness;
        } else if (shapeType < 2.0) {
            d = abs(sdBox(sp, vec2(0.6))) - thickness;
        } else if (shapeType < 3.0) {
            d = abs(sdHex(sp, 0.7)) - thickness;
        } else {
            d = abs(sdTriangle(sp, 0.7)) - thickness;
        }

        float shape = smoothstep(0.02, 0.0, d);
        float depth = 1.0 - mod(t + i / layers * 2.0, 2.0) / 2.0;

        vec3 shapeColor = mix(color1.rgb, color2.rgb, i / layers);
        col = mix(col, shapeColor, shape * depth);
    }

    gl_FragColor = vec4(col, 1.0);
}
