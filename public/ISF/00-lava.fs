/*{
    "CREDIT": "Grok, created by xAI",
    "DESCRIPTION": "Particles floating on an evolving lava flow with connections",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Generator" ],
    "INPUTS": [
        {
            "NAME": "particleCount",
            "TYPE": "float",
            "MIN": 50.0,
            "MAX": 300.0,
            "DEFAULT": 150.0
        },
        {
            "NAME": "connectDistance",
            "TYPE": "float",
            "MIN": 0.01,
            "MAX": 0.5,
            "DEFAULT": 0.05
        },
        {
            "NAME": "flowSpeed",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 2.0,
            "DEFAULT": 0.5
        },
        {
            "NAME": "lavaGlow",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "turbulenceAmount",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.3
        },
        {
            "NAME": "posX",
            "TYPE": "float",
            "MIN": -1.0,
            "MAX": 1.0,
            "DEFAULT": 0.0
        },
        {
            "NAME": "posY",
            "TYPE": "float",
            "MIN": -1.0,
            "MAX": 1.0,
            "DEFAULT": 0.0
        }
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y * (RENDERSIZE.x / RENDERSIZE.y), 1.0);
float iGlobalTime = TIME;

#define PI 3.141592653589793
#define TWO_PI 6.283185307179586

// Simple 2D hash function
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// 2D noise function
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i + vec2(0.0, 0.0));
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractional Brownian Motion (fBm) for smooth noise
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { // 4 octaves for smoothness
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

// Generate particle position influenced by the lava flow
vec2 getParticlePos(int i, float t) {
    float id = float(i);
    float h = hash(vec2(id, id * 0.123));
    
    // Base position in normalized space [-1, 1]
    vec2 pos = vec2(h * 2.0 - 1.0, fract(h * 123.45) * 2.0 - 1.0);
    
    // Use fBm to create a flow field for particles
    vec2 flow = vec2(fbm(pos + vec2(t * flowSpeed, 0.0)), fbm(pos + vec2(0.0, t * flowSpeed + 100.0)));
    flow = flow * 2.0 - 1.0; // Map to [-1, 1]
    
    // Add turbulence to the flow
    vec2 turb = vec2(fbm(pos * 0.5 + vec2(t * 0.2, 0.0)), fbm(pos * 0.5 + vec2(0.0, t * 0.2 + 100.0)));
    turb = turb * 2.0 - 1.0;
    pos += flow * 0.5 + turb * turbulenceAmount * 0.3;
    
    // Keep particles within bounds by wrapping
    pos = fract(pos * 0.5 + 0.5) * 2.0 - 1.0;
    
    return pos;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 cent = uv * 2.0 - 1.0;
    cent.x *= iResolution.x / iResolution.y;
    cent.x -= posX;
    cent.y -= posY;
    float t = iGlobalTime * 0.2;

    // Lava flow background
    vec2 lavaUV = cent * 2.0;
    float lava = fbm(lavaUV + vec2(t * flowSpeed, t * flowSpeed * 0.5));
    lava = fbm(lavaUV + vec2(lava * 0.5, lava * 0.5)); // Add self-displacement for more organic flow
    float glow = smoothstep(0.3, 0.7, lava);
    vec3 lavaCol = mix(vec3(0.8, 0.2, 0.1), vec3(1.0, 0.8, 0.2), glow) * lavaGlow;
    vec3 col = mix(vec3(0.1, 0.05, 0.05), lavaCol, glow);

    int maxParticles = int(floor(particleCount + 0.5));
    maxParticles = clamp(maxParticles, 50, 300);

    // Draw particles and connections
    for (int i = 0; i < 300; i++) {
        if (i >= maxParticles) break;
        vec2 p1 = getParticlePos(i, t);
        
        // Draw particle
        float d = length(cent - p1);
        float particleGlow = smoothstep(0.015, 0.005, d);
        col += vec3(1.0, 0.9, 0.7) * particleGlow * 0.5; // Brighter particles to stand out on lava

        // Connect to nearby particles
        int startJ = max(i + 1, i - 10);
        int endJ = min(i + 10, maxParticles);
        for (int j = startJ; j < endJ; j++) {
            if (j >= maxParticles) break;
            vec2 p2 = getParticlePos(j, t);
            float dist = length(p1 - p2);
            if (dist < connectDistance) {
                vec2 pa = cent - p1;
                vec2 ba = p2 - p1;
                float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
                float lineDist = length(pa - ba * h);
                float lineGlow = smoothstep(0.003, 0.0, lineDist) * (1.0 - dist / connectDistance);
                col += vec3(1.0, 0.8, 0.6) * lineGlow * 0.3;
            }
        }
    }

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}