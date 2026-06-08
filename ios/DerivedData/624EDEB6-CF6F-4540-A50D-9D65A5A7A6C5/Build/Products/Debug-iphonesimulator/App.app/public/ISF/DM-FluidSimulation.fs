/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Flowing fluid-like animation",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Organic"],
    "INPUTS": [
        {"NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 3.0, "LABEL": "Scale"},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Speed"},
        {"NAME": "complexity", "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 4.0, "LABEL": "Complexity"},
        {"NAME": "contrast", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5, "LABEL": "Contrast"},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [0.0, 0.2, 0.5, 1.0], "LABEL": "Color 1"},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.8, 1.0, 1.0], "LABEL": "Color 2"},
        {"NAME": "color3", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0], "LABEL": "Highlight"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(
        mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
            dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
        mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
            dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
        u.y
    );
}

float fbm(vec2 p, float t) {
    float f = 0.0;
    float amp = 0.5;
    float freq = 1.0;

    for (int i = 0; i < 6; i++) {
        if (float(i) >= complexity) break;
        f += amp * noise(p * freq + t);
        freq *= 2.0;
        amp *= 0.5;
    }

    return f;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * speed;

    vec2 p = uv * scale;

    // Domain warping for fluid effect
    float n1 = fbm(p, t);
    float n2 = fbm(p + vec2(n1 * 0.5), t * 0.7);
    float n3 = fbm(p + vec2(n2 * 0.5, n1 * 0.3), t * 0.5);

    float f = (n3 + 0.5) * contrast;

    // Color mapping
    vec3 col;
    if (f < 0.5) {
        col = mix(color1.rgb, color2.rgb, f * 2.0);
    } else {
        col = mix(color2.rgb, color3.rgb, (f - 0.5) * 2.0);
    }

    gl_FragColor = vec4(col, 1.0);
}
