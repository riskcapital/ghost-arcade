/*{
    "CREDIT": "Shrink Wrap",
    "DESCRIPTION": "Swarming particles with emergent flocking behavior",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "particleCount", "TYPE": "float", "MIN": 20.0, "MAX": 100.0, "DEFAULT": 50.0},
        {"NAME": "trailLength", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "swarmTightness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "hue", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "glow", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

vec2 hash2(float n) {
    return vec2(hash(n), hash(n + 1.0));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    float brightness = 0.0;
    vec3 colorAccum = vec3(0.0);

    // Calculate swarm center
    vec2 swarmCenter = vec2(
        sin(t * 0.3) * 0.3,
        cos(t * 0.4) * 0.3
    );

    int count = int(particleCount);
    for (int i = 0; i < 100; i++) {
        if (i >= count) break;

        float fi = float(i);

        // Base position from hash
        vec2 basePos = hash2(fi * 7.3) * 2.0 - 1.0;

        // Individual movement
        float angle = t * (0.5 + hash(fi * 3.1) * 0.5) + fi * 0.5;
        float radius = 0.1 + hash(fi * 5.7) * 0.3;
        vec2 orbit = vec2(cos(angle), sin(angle)) * radius;

        // Attract toward swarm center
        vec2 toCenter = swarmCenter - basePos;
        basePos += toCenter * swarmTightness * 0.5;

        // Final particle position
        vec2 particlePos = basePos + orbit * (1.0 - swarmTightness * 0.5);

        // Distance to particle
        float d = length(uv - particlePos);

        // Particle with trail
        float particle = 0.003 / (d + 0.001);

        // Trail effect (direction-based glow)
        vec2 velocity = vec2(cos(angle + PI * 0.5), sin(angle + PI * 0.5));
        vec2 toParticle = normalize(uv - particlePos);
        float trailDot = max(0.0, -dot(toParticle, velocity));
        float trail = trailDot * 0.01 / (d + 0.02) * trailLength;

        // Color varies per particle
        float particleHue = hue + hash(fi * 2.3) * 0.15 - 0.075;
        vec3 particleColor = hsv2rgb(vec3(particleHue, 0.8, 1.0));

        brightness += particle + trail;
        colorAccum += particleColor * (particle + trail * 0.5);
    }

    // Normalize color
    vec3 col = brightness > 0.01 ? colorAccum / brightness : vec3(0.0);
    col *= min(brightness, 2.0);

    // Add glow
    col += hsv2rgb(vec3(hue, 0.3, 1.0)) * brightness * glow * 0.2;

    // Background
    float bg = length(uv - swarmCenter) * 0.1;
    col += hsv2rgb(vec3(hue + 0.5, 0.5, 0.03)) * (1.0 - bg);

    gl_FragColor = vec4(col, 1.0);
}
