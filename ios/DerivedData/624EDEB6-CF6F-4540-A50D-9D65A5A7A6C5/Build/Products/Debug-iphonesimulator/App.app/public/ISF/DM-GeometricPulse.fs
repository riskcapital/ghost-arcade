/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Pulsing geometric patterns expanding from center",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Geometric"],
    "INPUTS": [
        {"NAME": "pulseSpeed", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Pulse Speed"},
        {"NAME": "shapeType", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 0.0, "LABEL": "Shape"},
        {"NAME": "ringCount", "TYPE": "float", "MIN": 2.0, "MAX": 10.0, "DEFAULT": 5.0, "LABEL": "Ring Count"},
        {"NAME": "thickness", "TYPE": "float", "MIN": 0.01, "MAX": 0.1, "DEFAULT": 0.03, "LABEL": "Thickness"},
        {"NAME": "rotateSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Rotation"},
        {"NAME": "colorCycle", "TYPE": "bool", "DEFAULT": true, "LABEL": "Color Cycle"},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.5, 1.0], "LABEL": "Color 1"},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 1.0, 1.0, 1.0], "LABEL": "Color 2"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float sdCircle(vec2 p, float r) { return length(p) - r; }

float sdBox(vec2 p, float s) {
    vec2 d = abs(p) - s;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
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

float sdStar(vec2 p, float r) {
    float an = 3.14159 / 5.0;
    float en = 3.14159 / 2.5;
    vec2 acs = vec2(cos(an), sin(an));
    vec2 ecs = vec2(cos(en), sin(en));
    float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
    p = length(p) * vec2(cos(bn), abs(sin(bn)));
    p -= r * acs;
    p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
    return length(p) * sign(p.x);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * pulseSpeed;

    // Rotation
    float angle = TIME * rotateSpeed;
    float c = cos(angle), s = sin(angle);
    p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

    vec3 col = vec3(0.0);

    for (float i = 0.0; i < 10.0; i++) {
        if (i >= ringCount) break;

        // Ring expands outward
        float ringPhase = fract(t * 0.5 - i / ringCount);
        float ringSize = ringPhase * 1.5;

        // Choose shape
        float d;
        if (shapeType < 1.0) {
            d = abs(sdCircle(p, ringSize)) - thickness;
        } else if (shapeType < 2.0) {
            d = abs(sdBox(p, ringSize)) - thickness;
        } else if (shapeType < 3.0) {
            d = abs(sdHex(p, ringSize)) - thickness;
        } else if (shapeType < 4.0) {
            d = abs(sdTriangle(p, ringSize)) - thickness;
        } else {
            d = abs(sdStar(p, ringSize)) - thickness;
        }

        float ring = smoothstep(0.02, 0.0, d);

        // Fade as ring expands
        float fade = 1.0 - ringPhase;

        // Color
        vec3 ringColor;
        if (colorCycle) {
            ringColor = mix(color1.rgb, color2.rgb, fract(i / ringCount + t * 0.2));
        } else {
            ringColor = mix(color1.rgb, color2.rgb, i / ringCount);
        }

        col += ring * ringColor * fade;
    }

    gl_FragColor = vec4(col, 1.0);
}
