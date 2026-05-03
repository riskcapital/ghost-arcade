/*{
    "DESCRIPTION": "Glowing neon edge outlines on geometric shapes with audio-reactive pulsing",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "shapeCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 10.0},
        {"NAME": "glowIntensity", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.3, "MAX": 4.0},
        {"NAME": "lineWidth", "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.005, "MAX": 0.06},
        {"NAME": "hueOffset", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdTriangle(vec2 p, float r) {
    float k = sqrt(3.0);
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}

float sdHexagon(vec2 p, float r) {
    vec2 q = abs(p);
    return max(q.x - r, max(q.x * 0.5 + q.y * 0.866, q.y) - r);
}

vec2 rotate2D(vec2 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Audio reactivity
    float bassPulse = 1.0 + audioBass * 1.0;
    float midGlow = 1.0 + audioMid * 1.5;
    float beatFlash = audioBeat;
    float highFlicker = 1.0 + audioHigh * 0.3 * sin(t * 20.0);

    vec3 col = vec3(0.0);

    // Draw multiple nested shapes
    for (float i = 0.0; i < 10.0; i++) {
        if (i >= shapeCount) break;

        float phase = i / shapeCount;
        float size = 0.2 + i * 0.12;
        size *= bassPulse * (0.8 + 0.2 * sin(t + i));

        vec2 p = rotate2D(uv, t * 0.3 * (1.0 + i * 0.2) + i * 0.5);

        // Alternate shapes
        float d;
        float shapeType = mod(i, 3.0);
        if (shapeType < 1.0) {
            d = sdBox(p, vec2(size));
        } else if (shapeType < 2.0) {
            d = sdTriangle(p, size);
        } else {
            d = sdHexagon(p, size);
        }

        // Neon glow from edge
        float edge = abs(d) - lineWidth;
        float glow = glowIntensity * lineWidth / max(abs(d), 0.001);
        glow = clamp(glow, 0.0, 3.0);

        // Neon color per shape
        float hue = fract(hueOffset + phase + t * 0.05);
        vec3 neonCol = vec3(
            0.5 + 0.5 * cos(hue * 6.28),
            0.5 + 0.5 * cos(hue * 6.28 + 2.09),
            0.5 + 0.5 * cos(hue * 6.28 + 4.18)
        );

        // Flickering effect
        float flicker = highFlicker * (0.9 + 0.1 * sin(t * 30.0 + i * 7.0));

        col += neonCol * glow * midGlow * flicker;
    }

    // Beat flash overlay
    col += vec3(beatFlash * 0.1);

    // Tone map to avoid blowout
    col = col / (col + vec3(1.0));

    gl_FragColor = vec4(col, 1.0);
}
