/*{
    "DESCRIPTION": "Fractal fold-space explorer with vivid HSV spectrum coloring and spiral distortion",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "foldDepth", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 8.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "zoom", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "saturation", "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "spiralTwist", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "brightness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0}
    ]
}*/

#define PI 3.14159265359

mat2 rot2D(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

vec3 hsv2rgb(float h, float s, float v) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return v * mix(vec3(1.0), rgb, s);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y * zoom;
    float t = TIME * speed;
    vec3 col = vec3(0.0);
    float g = 0.0;

    // Audio-reactive twist and pulse
    float audioTwist = audioBass * 0.4;
    float audioPulse = 1.0 + audioBeat * 0.3;

    for (float i = 0.0; i < 80.0; i++) {
        float v = 0.1;
        vec3 p = vec3(uv * audioPulse, 1.0 - g);
        p.zx *= rot2D(spiralTwist + audioTwist);

        // Spiral distortion - our original twist
        p.xy *= rot2D(g * 0.05 + t * 0.1);

        float k = t * 0.5;
        for (int j = 0; j < 8; j++) {
            if (float(j) >= foldDepth) break;
            float l = length(p.xy);
            v *= l;
            p = vec3(
                l * 5.0 - k,
                atan(p.y, p.x) / PI,
                p.z / l + l * (3.0 + audioMid)
            );
            p.xy = fract(p.yx + p.x) - 0.5;
        }

        float e = length(p) * v;
        g += e;

        float bright = 0.02 / exp(max(0.0, e * 2000.0));
        col += hsv2rgb(g * p.y + colorShift, saturation, bright * brightness);
    }

    gl_FragColor = vec4(col, 1.0);
}
