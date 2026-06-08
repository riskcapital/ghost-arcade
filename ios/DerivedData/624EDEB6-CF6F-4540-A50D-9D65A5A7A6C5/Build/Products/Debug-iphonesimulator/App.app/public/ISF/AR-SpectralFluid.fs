/*{
    "DESCRIPTION": "FBM fluid simulation driven by audio with curl noise vortices, beat-pulsed density injection and spectral color shifts",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "vortexScale", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "colorCycleRate", "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.05},
        {"NAME": "filamentSharp", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "fluidSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.8},
        {"NAME": "density", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "beatPulse", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0}
    ]
}*/

#define PI 3.14159265359
#define FBM_OCTAVES 6

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

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

float fbm(vec2 p, float audioMod) {
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < FBM_OCTAVES; i++) {
        val += amp * noise(p * freq);
        freq *= 2.0 + audioMod * 0.1;
        amp *= 0.5;
        p += vec2(1.7, 9.2);
    }
    return val;
}

vec2 curlNoise(vec2 p, float audioMod) {
    float eps = 0.01;
    float n1 = fbm(p + vec2(eps, 0.0), audioMod);
    float n2 = fbm(p - vec2(eps, 0.0), audioMod);
    float n3 = fbm(p + vec2(0.0, eps), audioMod);
    float n4 = fbm(p - vec2(0.0, eps), audioMod);
    return vec2((n3 - n4), -(n1 - n2)) / (2.0 * eps);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;

    float bass = max(audioBass, 0.3 + 0.12 * sin(TIME * 0.3));
    float mid = max(audioMid, 0.25 + 0.1 * sin(TIME * 0.5));
    float high = max(audioHigh, 0.2 + 0.1 * sin(TIME * 0.8));
    float beat = audioBeat;
    float level = max(audioLevel, 0.3);
    float centroid = max(audioSpectralCentroid, 0.4);

    float t = TIME * fluidSpeed;

    vec2 p = uv * vortexScale;

    vec2 largeCurl = curlNoise(p * 0.5 + t * 0.1, bass) * bass * 1.5;
    vec2 medCurl = curlNoise(p * 1.5 + t * 0.2 + 3.7, mid) * mid * 0.8;
    vec2 fineCurl = curlNoise(p * 4.0 + t * 0.3 + 7.1, high) * high * 0.3;

    vec2 totalDisplace = largeCurl + medCurl + fineCurl;

    float beatInject = beat * beatPulse;
    totalDisplace += vec2(sin(t * 3.0), cos(t * 2.7)) * beatInject * 0.3;

    vec2 advected = p + totalDisplace;

    float layer1 = fbm(advected * 1.0 + t * 0.15, bass);
    float layer2 = fbm(advected * 2.0 - t * 0.12 + 5.3, mid);
    float layer3 = fbm(advected * 4.0 + t * 0.08 + 11.7, high);

    float fluid = layer1 * 0.5 + layer2 * 0.35 + layer3 * 0.15;

    fluid = pow(fluid, 1.0 / filamentSharp);
    fluid *= density;

    float densityPulse = 1.0 + beatInject * 0.5;
    fluid *= densityPulse;

    float hueBase = centroid * 0.6 + TIME * colorCycleRate;
    float hueVar = layer2 * 0.3 + layer3 * 0.2;

    float hue = fract(hueBase + hueVar);
    float sat = 0.6 + 0.3 * fluid;
    float val = clamp(fluid * 0.8, 0.0, 1.0);

    vec3 color = hsv2rgb(vec3(hue, sat, val));

    vec3 hotColor = hsv2rgb(vec3(fract(hue + 0.1), 0.9, 1.0));
    float hotSpots = pow(max(fluid - 0.7, 0.0) * 3.3, 2.0);
    color += hotColor * hotSpots * 0.5;

    float vortexHighlight = length(totalDisplace) * 0.5;
    color += vec3(0.1, 0.15, 0.3) * vortexHighlight * level;

    color += vec3(0.05, 0.02, 0.08) * beat * beatPulse;

    color = clamp(color, 0.0, 1.0);
    color = pow(color, vec3(0.9));

    gl_FragColor = vec4(color, 1.0);
}
