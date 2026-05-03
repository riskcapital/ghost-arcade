/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Spiraling vortex with color trails",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "spiralArms", "TYPE": "float", "MIN": 1.0, "MAX": 12.0, "DEFAULT": 4.0},
        {"NAME": "rotationSpeed", "TYPE": "float", "MIN": -2.0, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "tightness", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 3.0},
        {"NAME": "brightness", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "trailLength", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.5}
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

    float t = iTime * rotationSpeed;

    // Spiral calculation
    float spiral = a / TAU + log(r + 0.001) * tightness - t;
    float arms = mod(spiral * spiralArms, 1.0);

    // Create trail effect
    float trail = smoothstep(0.0, trailLength, arms) * smoothstep(1.0, 1.0 - trailLength, arms);

    // Distance falloff
    float falloff = 1.0 / (1.0 + r * 2.0);

    float intensity = trail * falloff * brightness;

    // Color varies along spiral
    float hue = fract(spiral * 0.5 + t * 0.5);
    vec3 col = hsv2rgb(vec3(hue, 0.85, intensity));

    // Center glow
    col += vec3(1.0, 0.8, 0.5) * exp(-r * 10.0) * 0.5;

    // Outer glow
    col += hsv2rgb(vec3(hue + 0.5, 0.5, 0.1)) * (1.0 - falloff);

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
