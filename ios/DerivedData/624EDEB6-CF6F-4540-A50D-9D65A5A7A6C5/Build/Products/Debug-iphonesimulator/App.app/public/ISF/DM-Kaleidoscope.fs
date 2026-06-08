/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Mesmerizing kaleidoscope pattern generator",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Geometric"],
    "INPUTS": [
        {"NAME": "segments", "TYPE": "float", "MIN": 3.0, "MAX": 16.0, "DEFAULT": 6.0, "LABEL": "Segments"},
        {"NAME": "rotationSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.3, "LABEL": "Rotation Speed"},
        {"NAME": "zoom", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Zoom"},
        {"NAME": "complexity", "TYPE": "float", "MIN": 1.0, "MAX": 5.0, "DEFAULT": 3.0, "LABEL": "Complexity"},
        {"NAME": "colorSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Color Speed"},
        {"NAME": "saturation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.8, "LABEL": "Saturation"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    // Convert to polar
    float r = length(p);
    float a = atan(p.y, p.x);

    // Rotation
    a += TIME * rotationSpeed;

    // Kaleidoscope folding
    float seg = PI * 2.0 / segments;
    a = mod(a, seg);
    a = abs(a - seg * 0.5);

    // Convert back to cartesian
    p = vec2(cos(a), sin(a)) * r * zoom;

    // Create pattern
    float pattern = 0.0;
    float t = TIME * 0.5;

    pattern += sin(p.x * 5.0 + t) * 0.5;
    pattern += sin(p.y * 5.0 - t * 0.7) * 0.5;

    if (complexity > 1.5) {
        pattern += sin((p.x + p.y) * 3.0 + t * 1.3) * 0.3;
    }
    if (complexity > 2.5) {
        pattern += sin(length(p) * 8.0 - t * 2.0) * 0.3;
    }
    if (complexity > 3.5) {
        pattern += sin(p.x * p.y * 10.0 + t) * 0.2;
    }

    pattern = pattern * 0.5 + 0.5;

    // Color
    float hue = fract(pattern * 0.5 + r * 0.2 + TIME * colorSpeed * 0.1);
    vec3 color = hsv2rgb(vec3(hue, saturation, 0.9));

    // Fade center slightly
    color *= 0.5 + smoothstep(0.0, 0.3, r) * 0.5;

    gl_FragColor = vec4(color, 1.0);
}
