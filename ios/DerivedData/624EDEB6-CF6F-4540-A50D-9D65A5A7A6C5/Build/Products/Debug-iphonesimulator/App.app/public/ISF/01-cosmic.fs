/*{
    "CREDIT": "Grok, created by xAI",
    "DESCRIPTION": "Rotating particle field with lines connecting nearby particles",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Generator" ],
    "INPUTS": [
        {
            "NAME": "particleCount",
            "TYPE": "float",
            "MIN": 10.0,
            "MAX": 100.0,
            "DEFAULT": 50.0
        },
        {
            "NAME": "connectDistance",
            "TYPE": "float",
            "MIN": 0.01,
            "MAX": 0.5,
            "DEFAULT": 0.1
        },
        {
            "NAME": "zoomDensity",
            "TYPE": "float",
            "MIN": 0.5,
            "MAX": 5.0,
            "DEFAULT": 1.0
        }
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform vec2 renderSize;
uniform float TIME;
uniform float particleCount;
uniform float connectDistance;
uniform float zoomDensity;

#define PI 3.141592653589793
#define TWO_PI 6.283185307179586

// Simple 2D hash function
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Generate particle position based on index and time
vec2 getParticlePos(int i, float t) {
    float id = float(i);
    float h = hash(vec2(id, id * 0.123));
    float angle = h * TWO_PI + t * 0.5; // Rotate based on time
    float radius = 0.3 + 0.2 * sin(h * TWO_PI + t); // Vary radius
    return vec2(cos(angle), sin(angle)) * radius * zoomDensity;
}

void main() {
    vec2 uv = gl_FragCoord.xy / renderSize.xy;
    vec2 cent = uv * 2.0 - 1.0;
    cent.x *= renderSize.x / renderSize.y; // Aspect ratio correction
    float t = TIME * 0.2;

    // Background
    vec3 col = vec3(0.1); // Dark background

    int maxParticles = int(floor(particleCount + 0.5));
    maxParticles = clamp(maxParticles, 10, 100); // Safety clamp

    // Draw lines between nearby particles
    for (int i = 0; i < 100; i++) {
        if (i >= maxParticles) break;
        vec2 p1 = getParticlePos(i, t);
        
        // Draw particle as a small dot
        float d = length(cent - p1);
        float particleGlow = smoothstep(0.02, 0.01, d);
        col += vec3(0.8, 0.8, 1.0) * particleGlow * 0.5;

        // Check connections to other particles
        for (int j = i + 1; j < 100; j++) {
            if (j >= maxParticles) break;
            vec2 p2 = getParticlePos(j, t);
            float dist = length(p1 - p2);
            if (dist < connectDistance) {
                // Draw line between p1 and p2
                vec2 pa = cent - p1;
                vec2 ba = p2 - p1;
                float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
                float lineDist = length(pa - ba * h);
                float lineGlow = smoothstep(0.005, 0.0, lineDist) * (1.0 - dist / connectDistance);
                col += vec3(0.5, 0.7, 1.0) * lineGlow * 0.3;
            }
        }
    }

    // Output
    gl_FragColor = vec4(col, 1.0);
}