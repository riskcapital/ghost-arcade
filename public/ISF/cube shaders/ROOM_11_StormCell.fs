/*{
    "DESCRIPTION": "Window into a room of turbulent storm clouds rolling at layered depths with lightning",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "turbulence", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "lightningRate", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Domain-warped flowing noise for cloud density
float cloudNoise(vec2 p, float t) {
    // Domain warp: feed noise back into coordinates
    vec2 q = vec2(
        noise(p + vec2(0.0, t * 0.3)),
        noise(p + vec2(5.2, t * 0.2 + 1.3))
    );
    vec2 r = vec2(
        noise(p + 4.0 * q + vec2(1.7, t * 0.15)),
        noise(p + 4.0 * q + vec2(8.3, t * 0.1 + 2.8))
    );
    float v = 0.0;
    float amp = 0.5;
    vec2 sp = p + 4.0 * r;
    for (int i = 0; i < 4; i++) {
        v += amp * noise(sp);
        sp *= 2.1;
        amp *= 0.5;
    }
    return v;
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

    // Lightning flash: beat-reactive bright pulse
    float flashSeed = floor(t * 4.0);
    float flashChance = hash(vec2(flashSeed, 7.7));
    float flash = 0.0;
    if (flashChance > 1.0 - lightningRate * 0.5) {
        float flashPhase = fract(t * 4.0);
        flash = exp(-flashPhase * 12.0) * (0.5 + beat * 1.5);
    }

    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float z = (fi + 1.0) / 8.0 * depth;

        // Parallax: deeper layers shrink toward center
        float parallax = 1.0 - z * 0.4;
        vec2 luv = fromCenter * parallax;
        luv.x *= aspect;

        // Each layer scrolls in a different direction
        float scrollAngle = fi * 2.39996 + z * 1.5; // golden angle spacing
        vec2 scrollDir = vec2(cos(scrollAngle), sin(scrollAngle));
        vec2 cloudUV = luv * (2.0 + fi * 0.5) + scrollDir * t * (0.3 + fi * 0.08);

        // Cloud density via domain-warped noise
        float density = cloudNoise(cloudUV * turbulence, t + fi * 3.0);
        density = smoothstep(0.25, 0.7, density);

        // Depth brightness: near=bright, far=dim
        float brightness = (1.0 - z * 0.7) * intensity;

        // Storm palette: dark purple/blue/grey with colorShift
        float hue = fi * 0.3 + colorShift;
        vec3 cloudCol = vec3(
            0.15 + 0.1 * sin(hue + 0.5),
            0.12 + 0.08 * sin(hue + 2.5),
            0.25 + 0.15 * sin(hue + 4.0)
        );
        // Brighter underbellies on near layers
        cloudCol += vec3(0.1, 0.07, 0.15) * (1.0 - z) * density;
        cloudCol *= 1.0 + high * 0.3;

        // Lightning illumination on clouds
        vec3 litCol = cloudCol + vec3(0.7, 0.65, 0.9) * flash * density * (1.0 - z * 0.5);

        col += litCol * density * brightness * 0.35;
    }

    // Global lightning flash wash
    col += vec3(0.9, 0.85, 1.0) * flash * 0.3 * intensity;

    // Dark ambient base
    col += vec3(0.03, 0.02, 0.06) * (1.0 - edgeDist * 0.5);

    // Room wall vignette
    float vignette = 1.0 - edgeDist * 0.35;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
