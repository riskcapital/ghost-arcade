/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Smooth color cycling gradient",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "cycleSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "gradientType", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 0.0},
        {"NAME": "saturation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.8},
        {"NAME": "brightness", "TYPE": "float", "MIN": 0.5, "MAX": 1.5, "DEFAULT": 1.0},
        {"NAME": "waveAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 centered = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float t = iTime * cycleSpeed;

    float hue;
    int gType = int(gradientType);

    if (gType == 0) {
        // Horizontal gradient
        hue = uv.x + t;
    } else if (gType == 1) {
        // Radial gradient
        hue = length(centered) + t;
    } else if (gType == 2) {
        // Angular gradient
        hue = atan(centered.y, centered.x) / (PI * 2.0) + 0.5 + t;
    } else {
        // Diamond gradient
        hue = (abs(centered.x) + abs(centered.y)) * 2.0 + t;
    }

    // Add wave distortion
    if (waveAmount > 0.0) {
        hue += sin(uv.x * 10.0 + t * 2.0) * waveAmount * 0.1;
        hue += sin(uv.y * 10.0 + t * 1.5) * waveAmount * 0.1;
        hue += sin(length(centered) * 15.0 - t * 3.0) * waveAmount * 0.05;
    }

    hue = fract(hue);

    vec3 col = hsv2rgb(vec3(hue, saturation, brightness));

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
