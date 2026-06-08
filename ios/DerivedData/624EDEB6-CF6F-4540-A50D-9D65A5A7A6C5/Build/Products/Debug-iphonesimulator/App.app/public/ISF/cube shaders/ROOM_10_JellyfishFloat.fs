/*{
    "DESCRIPTION": "Window into a room of bioluminescent jellyfish floating at layered depths",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "pulseRate", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "tentacleLength", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Single jellyfish SDF: bell + tentacles
float jellyfish(vec2 p, float t, float id) {
    // Pulsing bell expansion
    float pulse = sin(t * pulseRate * 2.5 + id * 5.0) * 0.15 + 1.0;

    // Bell shape: flattened circle top
    vec2 bellP = p;
    bellP.x /= (0.8 * pulse);
    bellP.y /= 0.55;
    bellP.y -= 0.1;
    float bell = length(bellP);
    // Flatten bottom of bell
    float bellShape = bell - 1.0 + smoothstep(-0.1, 0.3, bellP.y) * 0.3;
    float bellDist = smoothstep(0.15, 0.0, bellShape);

    // Underside rim glow
    float rimY = p.y + 0.05;
    float rimDist = abs(rimY) + abs(length(vec2(p.x, 0.0)) - 0.8 * pulse) * 0.8;
    float rim = exp(-rimDist * rimDist * 80.0) * step(p.y, 0.1);

    // Tentacles: sine-modulated vertical lines below bell
    float tentacles = 0.0;
    for (int ti = 0; ti < 5; ti++) {
        float ft = float(ti);
        float tx = (ft - 2.0) * 0.2 * pulse;
        float sway = sin(p.y * 8.0 - t * 1.5 + ft * 1.7 + id * 3.0) * 0.06
                   + sin(p.y * 3.0 - t * 0.7 + ft * 2.3) * 0.04;
        float tdist = abs(p.x - tx - sway);
        float tlen = tentacleLength * (0.5 + hash(id + ft * 7.0) * 0.5);
        float tMask = smoothstep(0.0, -tlen, p.y) * step(p.y, 0.0);
        float tFade = 1.0 - smoothstep(0.0, -tlen, p.y);
        tentacles += exp(-tdist * tdist * 2000.0) * tMask * tFade * 0.6;
    }

    return bellDist + rim * 0.5 + tentacles;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    vec2 fromCenter = (uv - 0.5) * 2.0;
    float edgeDist = max(abs(fromCenter.x), abs(fromCenter.y));

    float beat = audioBeat;
    float high = audioHigh;

    vec3 col = vec3(0.0);

    // 5 depth layers
    for (int layer = 0; layer < 5; layer++) {
        float fl = float(layer);
        float z = (fl + 1.0) / 5.0 * depth;

        // Parallax
        float parallax = 1.0 - z * 0.45;
        vec2 luv = (uv - 0.5) * parallax;
        luv.x *= aspect;

        // Size scaling: near=large, far=small
        float scale = 3.0 + z * 4.0;

        // 3-4 jellyfish per layer
        int count = 3 + int(mod(fl, 2.0));
        for (int j = 0; j < 4; j++) {
            if (j >= count) break;
            float fj = float(j);
            float id = fl * 10.0 + fj;

            // Position: spread across room, slowly rising
            float px = (hash(id * 3.7) - 0.5) * 1.6;
            float riseSpeed = 0.1 + hash(id * 11.3) * 0.15;
            float py = mod(hash(id * 5.1) + t * riseSpeed, 2.0) - 1.0;

            // Gentle horizontal drift
            px += sin(t * 0.3 + id * 2.0) * 0.1;

            vec2 jp = (luv - vec2(px, py)) * scale;

            float jf = jellyfish(jp, t, id);

            // Depth brightness
            float brightness = (1.0 - z * 0.65) * intensity;
            brightness *= 1.0 + beat * 0.5 * (1.0 - z);

            // Bioluminescent color: blue/pink/cyan per individual
            float hue = id * 1.3 + colorShift + sin(t * 0.5 + id) * 0.5;
            vec3 bioCol = vec3(
                0.2 + 0.5 * sin(hue + 3.5),
                0.3 + 0.4 * sin(hue + 1.5),
                0.7 + 0.3 * sin(hue + 0.0)
            );
            bioCol *= 1.0 + high * 0.3;

            // Pulse glow brightening
            float pulseGlow = 0.8 + 0.4 * sin(t * pulseRate * 2.5 + id * 5.0);
            bioCol *= pulseGlow;

            col += bioCol * jf * brightness * 0.4;
        }
    }

    // Deep ocean ambient
    float oceanGlow = (1.0 - edgeDist * 0.3) * 0.06 * intensity;
    col += vec3(0.02, 0.05, 0.12) * oceanGlow * 5.0;

    // Subtle caustic ripple at bottom
    float caustic = sin(uv.x * 20.0 + t) * sin(uv.x * 13.0 - t * 0.7) * 0.5 + 0.5;
    caustic *= smoothstep(0.3, 0.0, uv.y) * 0.04 * intensity;
    col += vec3(0.1, 0.2, 0.4) * caustic;

    // Room wall vignette
    float vignette = 1.0 - edgeDist * 0.3;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
