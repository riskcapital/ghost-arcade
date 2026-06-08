/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Rising fire embers and sparks",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "emberCount", "TYPE": "float", "MIN": 20.0, "MAX": 200.0, "DEFAULT": 80.0},
        {"NAME": "riseSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "emberSize", "TYPE": "float", "MIN": 0.002, "MAX": 0.02, "DEFAULT": 0.008},
        {"NAME": "flickerSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 5.0, "DEFAULT": 2.0},
        {"NAME": "spreadX", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    uv.x = (uv.x - 0.5) * (iResolution.x / iResolution.y) + 0.5;

    float t = iTime * riseSpeed;
    vec3 col = vec3(0.0);

    int count = int(emberCount);
    for (int i = 0; i < 200; i++) {
        if (i >= count) break;

        float fi = float(i);
        float h1 = hash(fi);
        float h2 = hash(fi + 100.0);
        float h3 = hash(fi + 200.0);

        // Ember position
        float life = fract(h1 + t * (0.3 + h2 * 0.7));
        float x = 0.5 + (h2 - 0.5) * spreadX + sin(life * 10.0 + h3 * 6.28) * 0.05;
        float y = life;

        // Size decreases as it rises
        float size = emberSize * (1.0 - life * 0.5) * (0.5 + h3 * 0.5);

        // Distance to ember
        float d = length(uv - vec2(x, y));

        // Flicker
        float flicker = sin(iTime * flickerSpeed * (1.0 + h3) + fi) * 0.3 + 0.7;

        // Brightness falloff
        float brightness = smoothstep(size, 0.0, d) * flicker * (1.0 - life * 0.8);

        // Color: hot white -> orange -> red
        vec3 emberCol = mix(vec3(1.0, 0.9, 0.6), vec3(1.0, 0.3, 0.0), life);
        emberCol = mix(emberCol, vec3(0.5, 0.1, 0.0), life * life);

        col += emberCol * brightness;
    }

    // Add glow at bottom
    float bottomGlow = exp(-uv.y * 3.0) * 0.3;
    col += vec3(1.0, 0.4, 0.1) * bottomGlow;

    // Add subtle smoke
    float smoke = hash2(uv * 10.0 + t) * 0.02 * (1.0 - uv.y);
    col += vec3(0.3, 0.2, 0.15) * smoke;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
