/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Hypnotic concentric rings with pulse",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "ringFreq", "TYPE": "float", "MIN": 5.0, "MAX": 50.0, "DEFAULT": 20.0},
        {"NAME": "expandSpeed", "TYPE": "float", "MIN": -2.0, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "thickness", "TYPE": "float", "MIN": 0.1, "MAX": 0.9, "DEFAULT": 0.5},
        {"NAME": "wobble", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2},
        {"NAME": "colorSpread", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359
#define TAU 6.28318530718

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float r = length(uv);
    float a = atan(uv.y, uv.x);

    float t = iTime * expandSpeed;

    // Wobble the radius based on angle
    float wobbleR = r + sin(a * 6.0 + t * 2.0) * wobble * 0.05;

    // Create rings
    float rings = sin((wobbleR * ringFreq - t) * TAU);
    float ring = smoothstep(thickness, 1.0, abs(rings));

    // Color based on distance and angle
    float hue = fract(wobbleR * colorSpread + a / TAU * 0.5 + t * 0.1);
    vec3 col = hsv2rgb(vec3(hue, 0.8, 1.0 - ring));

    // Add glow at ring edges
    float glow = 1.0 - ring;
    col += hsv2rgb(vec3(hue + 0.1, 0.6, glow * 0.3));

    // Vignette
    col *= 1.0 - r * 0.5;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
