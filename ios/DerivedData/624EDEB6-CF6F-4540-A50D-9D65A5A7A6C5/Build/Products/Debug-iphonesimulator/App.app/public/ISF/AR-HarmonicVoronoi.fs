/*{
    "DESCRIPTION": "Animated Voronoi cells with harmonic orbiting seeds, FFT-mapped colors and beat-pulsing borders",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "cellScale", "TYPE": "float", "MIN": 2.0, "MAX": 8.0, "DEFAULT": 4.0},
        {"NAME": "orbitRadius", "TYPE": "float", "MIN": 0.1, "MAX": 0.5, "DEFAULT": 0.25},
        {"NAME": "borderWidth", "TYPE": "float", "MIN": 0.02, "MAX": 0.12, "DEFAULT": 0.05},
        {"NAME": "borderGlow", "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 3.0},
        {"NAME": "colorDepth", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3}
    ]
}*/

#define PI 3.14159265359

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;

    float bass = max(audioBass, 0.25 + 0.15 * sin(TIME * 0.4));
    float mid = max(audioMid, 0.2 + 0.1 * sin(TIME * 0.6));
    float high = max(audioHigh, 0.15 + 0.1 * sin(TIME * 0.9));
    float beat = audioBeat;
    float level = max(audioLevel, 0.3);
    float centroid = max(audioSpectralCentroid, 0.4);

    float beatPulse = 1.0 + beat * 0.3;
    vec2 suv = uv * cellScale;

    float minDist = 10.0;
    float secondDist = 10.0;
    vec2 closestId = vec2(0.0);
    float closestFreq = 0.0;

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 cell = floor(suv) + neighbor;
            vec2 rnd = hash2(cell);

            float harmonic = 1.0 + floor(rnd.x * 6.0);
            float phase = rnd.y * PI * 2.0;
            float t = TIME * speed;

            vec2 orbit = vec2(
                sin(harmonic * t + phase),
                cos(harmonic * t * 0.7 + phase * 1.3)
            ) * orbitRadius * beatPulse;

            vec2 seedPos = cell + 0.5 + orbit;
            float dist = length(suv - seedPos);

            float freq = rnd.x;

            if (dist < minDist) {
                secondDist = minDist;
                minDist = dist;
                closestId = rnd;
                closestFreq = freq;
            } else if (dist < secondDist) {
                secondDist = dist;
            }
        }
    }

    float edge = secondDist - minDist;
    float bw = borderWidth * (1.0 + beat * 0.5);

    float border = 1.0 - smoothstep(0.0, bw, edge);
    float glowAmt = exp(-edge * borderGlow * 8.0) * level;

    float fftEnergy = sampleFFT(closestFreq);
    float hue = fract(closestFreq * 0.8 + centroid * 0.3 + TIME * 0.03);
    float sat = 0.6 + 0.4 * colorDepth * fftEnergy;
    float val = 0.15 + fftEnergy * 0.6 * colorDepth;

    vec3 cellColor = hsv2rgb(vec3(hue, sat, val));

    float pulse = 1.0 + beat * 0.4 * smoothstep(0.5, 0.0, minDist);
    cellColor *= pulse;

    vec3 borderColor = hsv2rgb(vec3(fract(hue + 0.5), 0.9, 1.0));
    vec3 color = mix(cellColor, borderColor, border);

    color += borderColor * glowAmt * borderGlow * 0.3;

    float innerGlow = exp(-minDist * 3.0) * fftEnergy * 0.3;
    color += hsv2rgb(vec3(fract(hue + 0.15), 0.7, 1.0)) * innerGlow;

    color = clamp(color, 0.0, 1.0);

    gl_FragColor = vec4(color, 1.0);
}
