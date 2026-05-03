/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Smooth animated noise clouds - organic and flowing",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Noise"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.3, "LABEL": "Speed"},
        {"NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 3.0, "LABEL": "Scale"},
        {"NAME": "octaves", "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 4.0, "LABEL": "Detail"},
        {"NAME": "contrast", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5, "LABEL": "Contrast"},
        {"NAME": "colorA", "TYPE": "color", "DEFAULT": [0.1, 0.1, 0.2, 1.0], "LABEL": "Color A"},
        {"NAME": "colorB", "TYPE": "color", "DEFAULT": [0.8, 0.6, 1.0, 1.0], "LABEL": "Color B"},
        {"NAME": "flowX", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Flow X"},
        {"NAME": "flowY", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Flow Y"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p, int oct) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));

    for (int i = 0; i < 6; i++) {
        if (i >= oct) break;
        v += a * noise(p);
        p = rot * p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = uv * scale;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * speed;

    // Flow animation
    p += vec2(flowX, flowY) * t;

    // Generate noise
    int oct = int(octaves);
    float n1 = fbm(p, oct);
    float n2 = fbm(p + vec2(5.2, 1.3) + t * 0.1, oct);

    // Combine and create ridges
    float n = fbm(p + n1 * 2.0, oct);

    // Apply contrast
    n = pow(n, 1.0 / contrast);

    // Map to colors
    vec3 color = mix(colorA.rgb, colorB.rgb, n);

    // Add subtle variation
    color += (n2 - 0.5) * 0.1;

    gl_FragColor = vec4(color, 1.0);
}
