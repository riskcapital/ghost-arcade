/*{
    "DESCRIPTION": "Multiple double pendulums with persistence trails, arm lengths modulated by audio bands",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "pendulumCount", "TYPE": "float", "MIN": 2.0, "MAX": 6.0, "DEFAULT": 4.0},
        {"NAME": "trailDecay", "TYPE": "float", "MIN": 0.9, "MAX": 0.99, "DEFAULT": 0.96},
        {"NAME": "armBrightness", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "simSpeed", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "gravity", "TYPE": "float", "MIN": 5.0, "MAX": 15.0, "DEFAULT": 9.8},
        {"NAME": "colorSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.1}
    ]
}*/

#define PI 3.14159265359
#define MAX_PEND 6
#define TRAIL_PTS 100

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    vec2 ap = p - a;
    float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - (a + t * ab));
}

void main() {
    vec2 uv = isf_FragNormCoord * 2.0 - 1.0;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;

    float bass = max(audioBass, 0.3 + 0.1 * sin(TIME * 0.3));
    float mid = max(audioMid, 0.25 + 0.1 * sin(TIME * 0.5));
    float high = max(audioHigh, 0.2 + 0.1 * cos(TIME * 0.7));
    float beat = audioBeat;
    float level = max(audioLevel, 0.3);

    int numPend = int(pendulumCount);
    vec3 color = vec3(0.0);

    float L1base = 0.3 + bass * 0.2;
    float L2base = 0.25 + mid * 0.15;
    float m1 = 1.0;
    float m2 = 0.5 + high * 1.0;
    float g = gravity;

    for (int p = 0; p < MAX_PEND; p++) {
        if (p >= numPend) break;
        float fp = float(p);
        float initOff = fp * PI * 0.4 + 0.5;

        float L1 = L1base + fp * 0.02;
        float L2 = L2base + fp * 0.02;

        float hue = fract(fp * 0.17 + TIME * colorSpeed);
        vec3 trailColor = hsv2rgb(vec3(hue, 0.85, 1.0));

        vec2 pivot = vec2(0.0, 0.4);

        for (int i = 0; i < TRAIL_PTS; i++) {
            float fi = float(i);
            float tBack = fi / float(TRAIL_PTS);
            float simTime = (TIME - tBack * (1.0 - trailDecay) * 8.0) * simSpeed;

            float th1 = initOff + sin(simTime * 1.1 + fp) * (1.0 + bass * 0.5)
                       + cos(simTime * 0.7) * 0.5;
            float th2 = initOff * 0.7 + sin(simTime * 1.7 + fp * 2.0) * (0.8 + mid * 0.6)
                       + sin(simTime * 1.3) * 0.4;

            float chaos = sin(simTime * g * 0.1 + fp * 3.0) * 0.3;
            th1 += chaos;
            th2 += chaos * 1.5;

            vec2 p1 = pivot + vec2(sin(th1), -cos(th1)) * L1;
            vec2 p2 = p1 + vec2(sin(th2), -cos(th2)) * L2;

            float fade = pow(1.0 - tBack, 2.0 + trailDecay * 20.0);

            float d = length(uv - p2);
            float dot_glow = exp(-d * 150.0) * fade;
            color += trailColor * dot_glow * 0.8;

            if (i == 0) {
                float dArm1 = segDist(uv, pivot, p1);
                float dArm2 = segDist(uv, p1, p2);

                float arm1Line = smoothstep(0.006, 0.002, dArm1);
                float arm2Line = smoothstep(0.005, 0.001, dArm2);

                color += vec3(0.5, 0.6, 0.7) * arm1Line * armBrightness;
                color += vec3(0.6, 0.5, 0.7) * arm2Line * armBrightness;

                float jointGlow = exp(-length(uv - pivot) * 40.0) * 0.5;
                jointGlow += exp(-length(uv - p1) * 50.0) * 0.4;
                jointGlow += exp(-length(uv - p2) * 60.0) * 0.6;
                color += trailColor * jointGlow * armBrightness;
            }
        }
    }

    float beatFlash = beat * 0.08;
    color += vec3(beatFlash * 0.5, beatFlash * 0.3, beatFlash * 0.6);

    color = clamp(color, 0.0, 1.0);
    color = pow(color, vec3(0.85));

    gl_FragColor = vec4(color, 1.0);
}
