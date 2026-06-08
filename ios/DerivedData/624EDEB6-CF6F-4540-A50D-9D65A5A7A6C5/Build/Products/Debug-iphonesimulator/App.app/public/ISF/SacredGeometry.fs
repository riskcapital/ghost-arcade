/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Sacred geometry flower of life pattern",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "rings", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 3.0},
        {"NAME": "rotation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2},
        {"NAME": "pulseSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "lineThickness", "TYPE": "float", "MIN": 0.005, "MAX": 0.05, "DEFAULT": 0.015},
        {"NAME": "colorCycle", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359
#define TAU 6.28318530718

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float circle(vec2 p, vec2 c, float r) {
    return abs(length(p - c) - r);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * rotation;
    float pulse = sin(iTime * pulseSpeed * TAU) * 0.5 + 0.5;

    float d = 1000.0;
    float r = 0.15;
    int ringCount = int(rings);

    // Center circle
    d = min(d, circle(uv, vec2(0.0), r));

    // First ring of 6 circles
    for (int i = 0; i < 6; i++) {
        float a = float(i) * TAU / 6.0 + t;
        vec2 c = vec2(cos(a), sin(a)) * r;
        d = min(d, circle(uv, c, r));
    }

    // Additional rings
    for (int ring = 2; ring <= 8; ring++) {
        if (ring > ringCount) break;
        float ringR = r * float(ring);
        int count = ring * 6;
        for (int i = 0; i < 48; i++) {
            if (i >= count) break;
            float a = float(i) * TAU / float(count) + t * float(ring) * 0.5;
            vec2 c = vec2(cos(a), sin(a)) * ringR;
            d = min(d, circle(uv, c, r));
        }
    }

    float line = smoothstep(lineThickness, 0.0, d);
    float hue = fract(d * 2.0 + iTime * colorCycle);
    vec3 col = hsv2rgb(vec3(hue, 0.7, 1.0)) * line;
    col += hsv2rgb(vec3(hue + 0.5, 0.5, pulse * 0.2)) * (1.0 - line) * 0.1;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
