/*{
    "DESCRIPTION": "Oscilloscope-style Lissajous figures driven by audio waveform and FFT with persistence trails",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "trailLength", "TYPE": "float", "MIN": 0.5, "MAX": 0.99, "DEFAULT": 0.92},
        {"NAME": "lineThickness", "TYPE": "float", "MIN": 0.001, "MAX": 0.008, "DEFAULT": 0.003},
        {"NAME": "glowRadius", "TYPE": "float", "MIN": 0.005, "MAX": 0.04, "DEFAULT": 0.015},
        {"NAME": "zoom", "TYPE": "float", "MIN": 0.3, "MAX": 1.5, "DEFAULT": 0.8},
        {"NAME": "rotationSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.05},
        {"NAME": "intensity", "TYPE": "float", "MIN": 0.5, "MAX": 4.0, "DEFAULT": 2.5}
    ]
}*/

#define PI 3.14159265359
#define NUM_TRACES 5
#define TRAIL_SAMPLES 80

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

mat2 rot2(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
}

void main() {
    vec2 uv = isf_FragNormCoord * 2.0 - 1.0;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    uv /= zoom;

    float rotAngle = TIME * rotationSpeed;
    uv = rot2(rotAngle) * uv;

    float bass = max(audioBass, 0.3 + 0.1 * sin(TIME * 0.5));
    float mid = max(audioMid, 0.25 + 0.1 * sin(TIME * 0.7));
    float high = max(audioHigh, 0.2 + 0.1 * sin(TIME * 1.1));
    float beat = audioBeat;
    float level = max(audioLevel, 0.3);

    vec3 color = vec3(0.0);

    for (int t = 0; t < NUM_TRACES; t++) {
        float ft = float(t);
        float freqRatio = 1.0 + ft * 0.5;
        float phaseOff = ft * PI / float(NUM_TRACES) + TIME * 0.2;
        float fftSample = sampleFFT(ft / float(NUM_TRACES));

        for (int i = 0; i < TRAIL_SAMPLES; i++) {
            float fi = float(i);
            float tParam = fi / float(TRAIL_SAMPLES);
            float timeOff = tParam * 2.0 * PI;
            float trailTime = TIME - tParam * (1.0 - trailLength) * 4.0;

            float wfX = sampleWaveform(mod(tParam + ft * 0.1, 1.0));
            float audioPhase = fftSample * 2.0;

            float lx = sin(freqRatio * trailTime + phaseOff) * (0.6 + 0.3 * bass);
            float ly = cos((freqRatio + 1.0) * trailTime + phaseOff + audioPhase) * (0.6 + 0.3 * mid);

            lx += wfX * 0.15 * high;

            vec2 lissPoint = vec2(lx, ly);
            float dist = length(uv - lissPoint);

            float trailFade = pow(1.0 - tParam, 2.0 + trailLength * 8.0);

            float line = smoothstep(lineThickness + glowRadius, lineThickness, dist) * trailFade;
            float glow = exp(-dist / glowRadius) * trailFade * 0.3;

            float hue = fract(ft * 0.18 + tParam * 0.3 + TIME * 0.05);
            vec3 traceColor = hsv2rgb(vec3(hue, 0.8, 1.0));

            color += traceColor * (line + glow) * intensity * 0.04;
        }
    }

    float beatFlash = beat * 0.15;
    color += vec3(beatFlash);

    color = clamp(color, 0.0, 1.0);
    color = pow(color, vec3(0.9));

    gl_FragColor = vec4(color, 1.0);
}
