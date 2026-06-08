/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Electric lightning storm effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "boltFrequency", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0},
        {"NAME": "branchCount", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 4.0},
        {"NAME": "boltThickness", "TYPE": "float", "MIN": 0.001, "MAX": 0.02, "DEFAULT": 0.005},
        {"NAME": "glowIntensity", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "colorTemp", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7}
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

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash2(i);
    float b = hash2(i + vec2(1.0, 0.0));
    float c = hash2(i + vec2(0.0, 1.0));
    float d = hash2(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float lightning(vec2 uv, vec2 start, vec2 end, float seed, float thickness) {
    vec2 dir = end - start;
    float len = length(dir);
    dir /= len;

    vec2 perp = vec2(-dir.y, dir.x);
    vec2 p = uv - start;

    float t = dot(p, dir) / len;
    if (t < 0.0 || t > 1.0) return 0.0;

    float perpDist = dot(p, perp);

    // Add jitter along the bolt
    float jitter = noise(vec2(t * 20.0 + seed, seed)) * 0.1;
    jitter += noise(vec2(t * 50.0 + seed, seed * 2.0)) * 0.03;

    perpDist -= jitter * (1.0 - abs(t * 2.0 - 1.0));

    float d = abs(perpDist);
    return smoothstep(thickness, 0.0, d);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    uv.x *= iResolution.x / iResolution.y;

    vec3 col = vec3(0.02, 0.02, 0.05); // Dark background

    float t = iTime * boltFrequency;

    int bolts = int(branchCount);
    for (int i = 0; i < 8; i++) {
        if (i >= bolts) break;

        float fi = float(i);
        float boltTime = floor(t + fi * 0.3);
        float boltPhase = fract(t + fi * 0.3);

        // Flash timing
        float flash = step(0.9, boltPhase) * (1.0 - smoothstep(0.9, 1.0, boltPhase));
        flash += step(0.92, boltPhase) * step(boltPhase, 0.94) * 0.5;

        if (flash < 0.01) continue;

        // Random bolt position
        float seed = boltTime * 123.456 + fi * 78.9;
        vec2 start = vec2(0.3 + hash(seed) * 0.4, 1.0);
        vec2 end = vec2(0.2 + hash(seed + 1.0) * 0.6, 0.0);

        // Main bolt
        float bolt = lightning(uv, start, end, seed, boltThickness);

        // Branches
        for (int j = 0; j < 3; j++) {
            float fj = float(j);
            float branchT = 0.3 + fj * 0.2;
            vec2 branchStart = mix(start, end, branchT);
            vec2 branchEnd = branchStart + vec2(hash(seed + fj * 10.0) - 0.5, -0.2) * 0.3;
            bolt += lightning(uv, branchStart, branchEnd, seed + fj * 100.0, boltThickness * 0.5) * 0.5;
        }

        // Lightning color
        vec3 boltColor = mix(vec3(0.5, 0.5, 1.0), vec3(1.0, 1.0, 1.0), colorTemp);
        col += boltColor * bolt * flash * glowIntensity;

        // Glow
        float glow = lightning(uv, start, end, seed, boltThickness * 10.0);
        col += vec3(0.3, 0.3, 0.8) * glow * flash * 0.3;
    }

    // Background clouds
    float clouds = noise(uv * 3.0 + iTime * 0.1);
    clouds = smoothstep(0.4, 0.6, clouds);
    col += vec3(0.1, 0.1, 0.15) * clouds * 0.3;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
