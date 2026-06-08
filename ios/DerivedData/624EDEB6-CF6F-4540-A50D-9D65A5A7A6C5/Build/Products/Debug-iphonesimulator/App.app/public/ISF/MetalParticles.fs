/*{
    "CREDIT": "Shrink Wrap",
    "DESCRIPTION": "Metallic particles floating over liquid metal surface",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 1.5, "DEFAULT": 0.4},
        {"NAME": "particleCount", "TYPE": "float", "MIN": 20.0, "MAX": 80.0, "DEFAULT": 40.0},
        {"NAME": "particleSize", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "metalDepth", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7},
        {"NAME": "hue", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.08},
        {"NAME": "reflectionStrength", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.8}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Liquid metal base
    float metalNoise = snoise(uv * 3.0 + t * 0.3) * 0.5 +
                       snoise(uv * 6.0 - t * 0.2) * 0.25 +
                       snoise(uv * 12.0 + t * 0.1) * 0.125;

    // Metal surface normal
    float eps = 0.01;
    float nx = snoise((uv + vec2(eps, 0.0)) * 3.0 + t * 0.3) - snoise((uv - vec2(eps, 0.0)) * 3.0 + t * 0.3);
    float ny = snoise((uv + vec2(0.0, eps)) * 3.0 + t * 0.3) - snoise((uv - vec2(0.0, eps)) * 3.0 + t * 0.3);
    vec3 metalNormal = normalize(vec3(-nx * metalDepth, -ny * metalDepth, 0.3));

    // Metal color
    vec3 metalColor = hsv2rgb(vec3(hue, 0.3, 0.85));

    // Lighting for base
    vec3 light = normalize(vec3(0.5, 0.5, 1.0));
    float diff = max(dot(metalNormal, light), 0.0);
    float spec = pow(max(dot(reflect(-light, metalNormal), vec3(0.0, 0.0, 1.0)), 0.0), 48.0);

    vec3 col = metalColor * (0.2 + diff * 0.4);
    col += vec3(1.0) * spec * 0.6;

    // Particles
    float particleBrightness = 0.0;
    vec3 particleColor = vec3(0.0);

    int count = int(particleCount);
    for (int i = 0; i < 80; i++) {
        if (i >= count) break;

        float fi = float(i);
        float seed = fi * 5.7;

        // Particle movement
        float angle = t * (0.3 + hash(seed) * 0.4) + hash(seed + 1.0) * PI * 2.0;
        float radius = 0.2 + hash(seed + 2.0) * 0.4;

        vec2 center = vec2(
            sin(t * 0.2 + fi * 0.3) * 0.2,
            cos(t * 0.15 + fi * 0.2) * 0.2
        );

        vec2 particlePos = center + vec2(cos(angle), sin(angle)) * radius;

        // Floating height animation
        float height = 0.5 + 0.5 * sin(t * 2.0 + seed);

        float d = length(uv - particlePos);
        float size = 0.01 * particleSize * (0.5 + height * 0.5);

        // Metallic particle with specular
        float particle = smoothstep(size, size * 0.3, d);
        float particleSpec = pow(max(1.0 - d / size, 0.0), 8.0);

        // Shadow on metal surface
        vec2 shadowOffset = vec2(0.02, -0.02) * height;
        float shadow = smoothstep(size * 1.5, size * 0.5, length(uv - particlePos + shadowOffset));
        col *= 1.0 - shadow * 0.3;

        // Reflection on metal
        vec2 reflPos = particlePos + metalNormal.xy * 0.1 * reflectionStrength;
        float refl = smoothstep(size * 2.0, size * 0.5, length(uv - reflPos)) * 0.3 * reflectionStrength;

        particleBrightness += particle + particleSpec * 0.5;
        particleColor += hsv2rgb(vec3(hue + hash(seed) * 0.1, 0.2, 0.95)) * (particle + particleSpec);

        col += metalColor * refl * (1.0 - height * 0.5);
    }

    // Add particles on top
    col = mix(col, particleColor, min(particleBrightness, 1.0));
    col += vec3(1.0) * particleBrightness * 0.2;

    gl_FragColor = vec4(col, 1.0);
}
