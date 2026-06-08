/*{
    "DESCRIPTION": "Lorenz strange attractor with audio-modulated parameters, volumetric glow and orbiting camera",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "pointBrightness", "TYPE": "float", "MIN": 0.5, "MAX": 4.0, "DEFAULT": 2.0},
        {"NAME": "glowSize", "TYPE": "float", "MIN": 0.002, "MAX": 0.02, "DEFAULT": 0.006},
        {"NAME": "audioModDepth", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "cameraSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.1},
        {"NAME": "trailDecay", "TYPE": "float", "MIN": 0.9, "MAX": 0.99, "DEFAULT": 0.95},
        {"NAME": "intensity", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5}
    ]
}*/

#define PI 3.14159265359
#define ITER_STEPS 120
#define TRAIL_LAYERS 4

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

mat3 rotY(float a) {
    float s = sin(a), c = cos(a);
    return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

mat3 rotX(float a) {
    float s = sin(a), c = cos(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

void main() {
    vec2 uv = isf_FragNormCoord * 2.0 - 1.0;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;

    float bass = max(audioBass, 0.3 + 0.1 * sin(TIME * 0.3));
    float mid = max(audioMid, 0.25 + 0.1 * sin(TIME * 0.5));
    float high = max(audioHigh, 0.2 + 0.1 * sin(TIME * 0.8));
    float beat = audioBeat;
    float level = max(audioLevel, 0.3);

    float sigma = 10.0 + bass * 5.0 * audioModDepth;
    float rho = 28.0 + mid * 10.0 * audioModDepth;
    float beta = 8.0 / 3.0 + high * 2.0 * audioModDepth;

    float camAngle = TIME * cameraSpeed;
    mat3 camRot = rotY(camAngle) * rotX(0.3 + sin(TIME * cameraSpeed * 0.7) * 0.2);

    vec3 color = vec3(0.0);

    for (int layer = 0; layer < TRAIL_LAYERS; layer++) {
        float fl = float(layer);
        float timeOff = fl * 0.15;
        float layerFade = 1.0 - fl * 0.2;

        vec3 pos = vec3(1.0 + fl * 0.1, 1.0, 1.0);
        float dt = 0.005;
        float simStart = (TIME - timeOff * (1.0 - trailDecay) * 3.0) * 0.5;

        for (int pre = 0; pre < 60; pre++) {
            float dx = sigma * (pos.y - pos.x);
            float dy = pos.x * (rho - pos.z) - pos.y;
            float dz = pos.x * pos.y - beta * pos.z;
            pos += vec3(dx, dy, dz) * dt;
        }

        for (int i = 0; i < ITER_STEPS; i++) {
            float fi = float(i);
            float dx = sigma * (pos.y - pos.x);
            float dy = pos.x * (rho - pos.z) - pos.y;
            float dz = pos.x * pos.y - beta * pos.z;
            pos += vec3(dx, dy, dz) * dt;

            float velocity = length(vec3(dx, dy, dz)) * dt;

            vec3 centered = pos - vec3(0.0, 0.0, rho - 1.0);
            centered *= 0.02;
            vec3 rotated = camRot * centered;

            float depth = rotated.z + 2.0;
            vec2 proj = rotated.xy / depth;

            float dist = length(uv - proj);
            float fade = pow(1.0 - fi / float(ITER_STEPS), 1.5) * layerFade;

            float gs = glowSize * (1.0 + beat * 0.5);
            float glow = exp(-dist / gs) * fade;
            float sharp = smoothstep(gs * 0.5, 0.0, dist) * fade;

            float hue = fract(velocity * 2.0 + fi * 0.003 + fl * 0.1 + TIME * 0.02);
            vec3 ptColor = hsv2rgb(vec3(hue, 0.8, 1.0));

            float depthFade = clamp(1.0 / (depth * depth), 0.0, 1.0);
            color += ptColor * (glow * 0.15 + sharp * 0.4) * pointBrightness * depthFade * intensity * 0.3;
        }
    }

    color += vec3(0.05, 0.02, 0.08) * beat * intensity;

    color = clamp(color, 0.0, 1.0);
    color = pow(color, vec3(0.9));

    gl_FragColor = vec4(color, 1.0);
}
