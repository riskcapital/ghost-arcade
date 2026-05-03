/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Ethereal smoke wisps floating upward",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Motion"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Speed"},
        {"NAME": "density", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5, "LABEL": "Density"},
        {"NAME": "turbulence", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Turbulence"},
        {"NAME": "wispSize", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Wisp Size"},
        {"NAME": "smokeColor", "TYPE": "color", "DEFAULT": [0.9, 0.9, 1.0, 1.0], "LABEL": "Smoke Color"},
        {"NAME": "bgColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.05, 1.0], "LABEL": "Background"},
        {"NAME": "opacity", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Opacity"}
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
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) {
        v += a * noise(p);
        p = rot * p * 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;
    p *= density;

    float t = TIME * speed;

    // Rising motion with turbulence
    vec2 flow = vec2(0.0, -t);
    flow.x += sin(p.y * 2.0 + t) * turbulence * 0.5;

    // Create smoke layers
    float smoke = 0.0;

    for (int i = 0; i < 3; i++) {
        float scale = 1.0 + float(i) * 0.5;
        float timeOffset = float(i) * 0.3;

        vec2 sp = p * scale / wispSize + flow * (1.0 - float(i) * 0.2);

        // Add turbulent displacement
        float turb = fbm(sp * 0.5 + t * 0.2);
        sp += vec2(turb, turb) * turbulence * 0.5;

        float n = fbm(sp);

        // Shape into wisps
        n = smoothstep(0.3, 0.7, n);

        smoke += n * (1.0 - float(i) * 0.25);
    }

    smoke /= 3.0;

    // Fade at edges
    float edgeFade = smoothstep(0.0, 0.3, uv.y) * smoothstep(1.0, 0.7, uv.y);
    smoke *= edgeFade;

    // Color
    vec3 color = mix(bgColor.rgb, smokeColor.rgb, smoke * opacity);

    // Add subtle glow
    color += smokeColor.rgb * smoke * smoke * 0.3;

    gl_FragColor = vec4(color, 1.0);
}
