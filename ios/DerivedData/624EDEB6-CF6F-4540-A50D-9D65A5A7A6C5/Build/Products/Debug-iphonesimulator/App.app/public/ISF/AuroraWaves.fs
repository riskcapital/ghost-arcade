/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Northern lights aurora borealis",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "waveSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "waveCount", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 3.0},
        {"NAME": "intensity", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "verticalPos", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "colorMix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n = i.x + i.y * 57.0;
    return mix(mix(hash(n), hash(n + 1.0), f.x),
               mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    uv.x *= iResolution.x / iResolution.y;

    float t = iTime * waveSpeed;
    vec3 col = vec3(0.0, 0.02, 0.05); // Dark sky background

    int waves = int(waveCount);
    for (int i = 0; i < 8; i++) {
        if (i >= waves) break;

        float fi = float(i);
        float phase = fi * 0.7 + hash(fi) * 2.0;

        // Wave shape
        float wave = sin(uv.x * 3.0 + t + phase) * 0.15;
        wave += sin(uv.x * 7.0 - t * 1.3 + phase) * 0.08;
        wave += noise(vec2(uv.x * 5.0 + t, fi)) * 0.1;

        float y = verticalPos + wave + fi * 0.08 - 0.15;

        // Aurora intensity falloff
        float dist = abs(uv.y - y);
        float glow = exp(-dist * 15.0) * intensity;

        // Shimmer
        float shimmer = noise(vec2(uv.x * 20.0 + t * 2.0, uv.y * 10.0 + fi)) * 0.5 + 0.5;
        glow *= shimmer;

        // Aurora colors
        vec3 green = vec3(0.2, 1.0, 0.4);
        vec3 blue = vec3(0.2, 0.5, 1.0);
        vec3 purple = vec3(0.6, 0.2, 0.8);
        vec3 pink = vec3(1.0, 0.3, 0.5);

        float colorPhase = fract(fi * 0.3 + colorMix + uv.x * 0.2);
        vec3 auroraCol;
        if (colorPhase < 0.33) {
            auroraCol = mix(green, blue, colorPhase * 3.0);
        } else if (colorPhase < 0.66) {
            auroraCol = mix(blue, purple, (colorPhase - 0.33) * 3.0);
        } else {
            auroraCol = mix(purple, green, (colorPhase - 0.66) * 3.0);
        }

        col += auroraCol * glow * (1.0 - fi * 0.1);
    }

    // Add stars
    float stars = step(0.998, hash(floor(uv * 200.0).x + floor(uv * 200.0).y * 1000.0));
    stars *= 0.5 + 0.5 * sin(t * 3.0 + hash(floor(uv * 200.0).x) * 10.0);
    col += vec3(stars) * 0.5;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
