/*{
    "DESCRIPTION": "Window into a garden room of softly glowing fireflies at 6 depth layers",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "glowSoftness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.5},
        {"NAME": "wanderRadius", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 2.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    // Room coordinates
    vec2 fromCenter = (uv - 0.5) * 2.0;
    float edgeDist = max(abs(fromCenter.x), abs(fromCenter.y));

    // Audio
    float beatPulse = 1.0 + audioBeat * 0.4;
    float highFlicker = audioHigh * 0.5;

    vec3 col = vec3(0.0);

    // 6 depth layers, 5-8 fireflies each
    for (int layer = 0; layer < 6; layer++) {
        float fl = float(layer);
        float layerDepth = (fl + 1.0) / 6.0 * depth;

        // Parallax
        float parallax = 1.0 - layerDepth * 0.42;
        vec2 luv = (uv - 0.5) * parallax + 0.5;
        luv.x *= aspect;

        // Firefly count per layer: 5-8 based on layer
        int ffCount = 5 + int(mod(fl * 3.0, 4.0));

        for (int f = 0; f < 8; f++) {
            if (f >= ffCount) break;
            float ff = float(f);
            float seed = fl * 47.3 + ff * 13.1;

            // Home position (spread across room)
            float homeX = 0.15 + hash(seed) * 0.7;
            float homeY = 0.15 + hash(seed + 50.0) * 0.7;

            // Wandering orbital path: multiple sin/cos with different frequencies
            float freqX = 0.15 + hash(seed + 100.0) * 0.25;
            float freqY = 0.12 + hash(seed + 150.0) * 0.2;
            float phaseX = hash(seed + 200.0) * 6.28;
            float phaseY = hash(seed + 250.0) * 6.28;

            float wander = wanderRadius * (0.1 + hash(seed + 300.0) * 0.1);
            vec2 ffPos = vec2(
                homeX + sin(t * freqX + phaseX) * wander + sin(t * freqX * 1.7 + phaseY) * wander * 0.4,
                homeY + cos(t * freqY + phaseY) * wander + cos(t * freqY * 2.3 + phaseX) * wander * 0.3
            );

            float d = length(luv - ffPos);

            // Glow radius: near layers = large, far = small
            float radius = (0.04 + hash(seed + 350.0) * 0.02) * glowSoftness * (1.0 - layerDepth * 0.5);

            // Pulsing glow
            float pulseFreq = 0.5 + hash(seed + 400.0) * 1.5;
            float pulsePhase = hash(seed + 450.0) * 6.28;
            float pulse = sin(t * pulseFreq + pulsePhase) * 0.4 + 0.6;
            pulse += highFlicker * sin(t * 3.0 + ff);

            // Radial falloff
            float glow = exp(-d * d / (radius * radius * 0.5)) * pulse;

            // Brightness: near=bright, far=dim
            float brightness = (1.0 - layerDepth * 0.6) * intensity * beatPulse;

            // Warm gold/green/cyan palette with per-firefly hue variation
            float hue = hash(seed + 500.0) * 2.5 + colorShift;
            vec3 ffCol = vec3(
                0.6 + 0.4 * sin(hue + 0.5),
                0.7 + 0.3 * sin(hue + 1.8),
                0.3 + 0.4 * sin(hue + 3.5)
            );

            // Core brightens to white
            float core = exp(-d * d / (radius * radius * 0.08));
            ffCol = mix(ffCol, vec3(1.0, 1.0, 0.95), core * 0.6);

            col += ffCol * glow * brightness;
        }
    }

    // Subtle ambient: dark garden green at bottom
    float ambientGreen = (1.0 - uv.y) * 0.04 * intensity;
    col += vec3(0.02, 0.06, 0.03) * ambientGreen * 10.0;

    // Room wall vignette
    float vignette = 1.0 - edgeDist * 0.3;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
