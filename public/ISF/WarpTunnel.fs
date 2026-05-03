/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Warping tunnel with infinite depth effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "tunnelSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "twistAmount", "TYPE": "float", "MIN": 0.0, "MAX": 5.0, "DEFAULT": 2.0},
        {"NAME": "ringCount", "TYPE": "float", "MIN": 2.0, "MAX": 20.0, "DEFAULT": 8.0},
        {"NAME": "colorIntensity", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "warpStrength", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3}
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

    // Tunnel depth
    float z = 0.5 / (r + 0.1);
    float t = iTime * tunnelSpeed;

    // Twist based on depth
    a += z * twistAmount + t * 0.5;

    // Add warp distortion
    float warp = sin(z * 3.0 - t * 2.0) * warpStrength;
    a += warp;

    // Create rings
    float rings = sin(z * ringCount - t * 5.0);
    float segments = sin(a * 8.0);

    float pattern = smoothstep(0.0, 0.3, rings) * smoothstep(0.0, 0.5, segments);

    float hue = fract(z * 0.1 + t * 0.1);
    vec3 col = hsv2rgb(vec3(hue, 0.8, pattern * colorIntensity));

    // Add depth fog
    float fog = exp(-r * 2.0);
    col *= fog;

    // Center glow
    col += vec3(0.5, 0.3, 1.0) * exp(-r * 8.0) * 0.5;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
