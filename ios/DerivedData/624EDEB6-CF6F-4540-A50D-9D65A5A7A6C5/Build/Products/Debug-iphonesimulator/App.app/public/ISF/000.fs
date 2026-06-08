/*{
    "CREDIT": "Grok, created by xAI",
    "DESCRIPTION": "Optimized spiral galaxy with turbulence and position control",
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
            "NAME": "zoomDensity",
            "TYPE": "float",
            "MIN": 0.5,
            "MAX": 5.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "chaosAmount",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.3
        },
        {
            "NAME": "spiralTightness",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 2.0,
            "DEFAULT": 0.5
        },
        {
            "NAME": "turbulenceAmount",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.2
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

// Fractional Brownian Motion (fBm) for turbulence
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) { // 3 octaves for efficiency
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

// Generate particle position for a spiral galaxy
vec2 getParticlePos(int i, float t) {
    float id = float(i);
    float h = hash(vec2(id, id * 0.123));
    
    // Spiral galaxy structure
    float radius = h * 0.5 * zoomDensity;
    float angle = h * TWO_PI + radius * spiralTightness * 10.0 + t * 0.5;
    
    // Add turbulence using fBm
    vec2 turb = vec2(fbm(vec2(id * 0.1 + t * 0.3, 0.0)), fbm(vec2(id * 0.1 + t * 0.3, 100.0)));
    turb = turb * 2.0 - 1.0; // Map to [-1, 1]
    angle += turb.x * turbulenceAmount * 2.0; // Turbulence affects angle
    radius += turb.y * turbulenceAmount * 0.1; // Turbulence affects radius
    
    // Add noise for chaos
    vec2 noiseOffset = vec2(noise(vec2(id * 0.1, t * 0.1)), noise(vec2(id * 0.1 + 100.0, t * 0.1)));
    noiseOffset = noiseOffset * 2.0 - 1.0;
    vec2 pos = vec2(cos(angle), sin(angle)) * radius;
    pos += noiseOffset * chaosAmount * 0.1;
    
    return pos;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 cent = uv * 2.0 - 1.0;
    cent.x *= iResolution.x / iResolution.y;
    cent.x -= posX; // Apply X offset
    cent.y -= posY; // Apply Y offset
    float t = iGlobalTime * 0.2;

    // Background
    vec3 col = vec3(0.05);

    // Central core glow
    float coreDist = length(cent);
    float coreGlow = smoothstep(0.2, 0.0, coreDist);
    col += vec3(0.8, 0.8, 1.0) * coreGlow * 0.5;

    int maxParticles = int(floor(particleCount + 0.5));
    maxParticles = clamp(maxParticles, 50, 300);

    // Optimize: Only connect to a subset of particles
    for (int i = 0; i < 300; i++) {
        if (i >= maxParticles) break;
        vec2 p1 = getParticlePos(i, t);
        
        // Draw particle
        float d = length(cent - p1);
        float particleGlow = smoothstep(0.015, 0.005, d);
        col += vec3(0.8, 0.8, 1.0) * particleGlow * 0.3;

        // Connect to nearby particles, but limit the search range
        int startJ = max(i + 1, i - 10); // Look at a smaller range
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
                col += vec3(0.5, 0.7, 1.0) * lineGlow * 0.2;
            }
        }
    }

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}