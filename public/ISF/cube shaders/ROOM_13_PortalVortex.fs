/*{
    "DESCRIPTION": "Window into a room with a spiraling energy vortex pulling from all depths",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "spiralTightness", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 8.0},
        {"NAME": "armCount", "TYPE": "float", "DEFAULT": 4.0, "MIN": 2.0, "MAX": 8.0}
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

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    vec2 fromCenter = (uv - 0.5) * 2.0;
    float edgeDist = max(abs(fromCenter.x), abs(fromCenter.y));

    float beat = audioBeat;
    float high = audioHigh;

    // Beat makes spiral pulse outward
    float beatPulse = 1.0 + beat * 0.4;

    vec3 col = vec3(0.0);

    for (int i = 0; i < 10; i++) {
        float fi = float(i);
        float z = (fi + 1.0) / 10.0 * depth;

        // Parallax
        float parallax = 1.0 - z * 0.45;
        vec2 luv = fromCenter * parallax;
        luv.x *= aspect;

        // Polar coordinates
        float r = length(luv);
        float angle = atan(luv.y, luv.x);

        // Logarithmic spiral: angle offset based on log of radius
        float logR = log(max(r, 0.001));
        float spiralAngle = angle - logR * spiralTightness + t * (1.0 + fi * 0.1);
        // Beat pushes energy outward by shifting the spiral phase
        spiralAngle -= beat * 0.8;

        // Multiple arms
        float arms = armCount;
        float spiralPattern = sin(spiralAngle * arms + fi * 1.5) * 0.5 + 0.5;
        spiralPattern = pow(spiralPattern, 2.0 + z * 2.0);

        // Energy streams: brighter toward center, fading at edges
        float radialFade = exp(-r * (1.5 + z * 1.0)) * (1.0 + beatPulse * 0.3);
        // Also add some energy coming from the edges
        float edgeEnergy = smoothstep(0.3, 0.9, r) * 0.15;

        float energy = (spiralPattern * radialFade + edgeEnergy * spiralPattern) * intensity;

        // Add noise distortion for organic feel
        float n = noise(luv * (3.0 + fi) + t * 0.5);
        energy *= 0.7 + n * 0.6;

        // Depth brightness
        float brightness = (1.0 - z * 0.6);

        // Electric blue/purple/white palette
        float hue = fi * 0.4 + colorShift + r * 0.5;
        vec3 spiralCol = vec3(
            0.3 + 0.3 * sin(hue + 4.0),
            0.2 + 0.3 * sin(hue + 2.0),
            0.7 + 0.3 * sin(hue + 0.5)
        );
        // White-hot core
        float coreGlow = exp(-r * 6.0);
        spiralCol = mix(spiralCol, vec3(1.0, 0.95, 1.0), coreGlow * 0.6);
        spiralCol *= 1.0 + high * 0.4;

        col += spiralCol * energy * brightness * 0.25;
    }

    // Bright center core glow
    float centerR = length(fromCenter * vec2(aspect, 1.0));
    float coreIntensity = exp(-centerR * 4.0) * intensity * 0.4 * beatPulse;
    col += vec3(0.6, 0.5, 1.0) * coreIntensity;

    // Subtle particle streaks radiating from edges toward center
    float streakAngle = atan(fromCenter.y, fromCenter.x * aspect);
    float streaks = sin(streakAngle * 20.0 + t * 2.0) * 0.5 + 0.5;
    streaks *= smoothstep(0.3, 0.9, edgeDist) * 0.05 * intensity;
    col += vec3(0.4, 0.3, 0.8) * streaks;

    // Room wall vignette
    float vignette = 1.0 - edgeDist * 0.3;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
