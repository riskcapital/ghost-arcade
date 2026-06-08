/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Flowing liquid metal with reflections",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Motion"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Speed"},
        {"NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 4.0, "LABEL": "Scale"},
        {"NAME": "distortion", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Distortion"},
        {"NAME": "reflectivity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.8, "LABEL": "Reflectivity"},
        {"NAME": "colorBase", "TYPE": "color", "DEFAULT": [0.7, 0.7, 0.8, 1.0], "LABEL": "Base Color"},
        {"NAME": "colorHighlight", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0], "LABEL": "Highlight"},
        {"NAME": "colorShadow", "TYPE": "color", "DEFAULT": [0.2, 0.2, 0.3, 1.0], "LABEL": "Shadow"}
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

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = uv * scale;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * speed;

    // Create flowing distortion
    float n1 = fbm(p + vec2(t, 0.0));
    float n2 = fbm(p + vec2(0.0, t * 0.7));

    // Distort coordinates
    vec2 dp = p + vec2(n1, n2) * distortion;

    // Create metallic surface
    float surface = fbm(dp * 2.0 + t * 0.3);

    // Calculate fake normals for reflection
    float eps = 0.01;
    float dx = fbm(dp * 2.0 + vec2(eps, 0.0) + t * 0.3) - surface;
    float dy = fbm(dp * 2.0 + vec2(0.0, eps) + t * 0.3) - surface;

    // Reflection angle
    float reflection = (dx + dy) * 10.0 * reflectivity;
    reflection = clamp(reflection + 0.5, 0.0, 1.0);

    // Color based on reflection
    vec3 color = colorBase.rgb;
    color = mix(colorShadow.rgb, color, smoothstep(0.0, 0.5, reflection));
    color = mix(color, colorHighlight.rgb, smoothstep(0.6, 1.0, reflection));

    // Add subtle color variation
    float hueShift = fbm(dp * 0.5 + t * 0.1) * 0.1;
    color.r += hueShift;
    color.b -= hueShift;

    gl_FragColor = vec4(color, 1.0);
}
