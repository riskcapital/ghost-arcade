/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Flying particle field effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "particleCount", "TYPE": "float", "MIN": 20.0, "MAX": 200.0, "DEFAULT": 80.0},
        {"NAME": "flySpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "particleSize", "TYPE": "float", "MIN": 0.002, "MAX": 0.02, "DEFAULT": 0.008},
        {"NAME": "trailLength", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.2},
        {"NAME": "colorVariation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
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

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float t = iTime * flySpeed;
    vec3 col = vec3(0.0, 0.0, 0.02); // Dark background

    int count = int(particleCount);
    for (int i = 0; i < 200; i++) {
        if (i >= count) break;

        float fi = float(i);
        float h1 = hash(fi);
        float h2 = hash(fi + 100.0);
        float h3 = hash(fi + 200.0);
        float h4 = hash(fi + 300.0);

        // 3D position
        float z = fract(h1 + t * (0.3 + h2 * 0.7));
        float depth = 1.0 / (z * 3.0 + 0.1);

        // XY position with some movement
        float x = (h2 - 0.5) * 2.0;
        float y = (h3 - 0.5) * 2.0;

        // Add slight drift
        x += sin(t * h4 * 2.0 + fi) * 0.1;
        y += cos(t * h4 * 2.0 + fi) * 0.1;

        vec2 pos = vec2(x, y) * depth * 0.3;

        // Distance to particle
        float d = length(uv - pos);

        // Size scales with depth
        float size = particleSize * depth;

        // Particle brightness
        float brightness = smoothstep(size, 0.0, d);

        // Trail effect
        if (trailLength > 0.0) {
            vec2 trailDir = normalize(vec2(0.0, 1.0)) * trailLength * depth;
            for (float tr = 0.0; tr < 1.0; tr += 0.1) {
                vec2 trailPos = pos - trailDir * tr;
                float trailD = length(uv - trailPos);
                brightness += smoothstep(size * 0.5, 0.0, trailD) * (1.0 - tr) * 0.3;
            }
        }

        // Color
        float hue = mix(0.5, h4, colorVariation);
        vec3 particleCol = hsv2rgb(vec3(hue, 0.6, 1.0));

        col += particleCol * brightness * depth;
    }

    // Add subtle depth fog
    col += vec3(0.0, 0.02, 0.05) * (1.0 - length(uv) * 0.5);

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
