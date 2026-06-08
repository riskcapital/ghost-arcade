/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Strobe light flash effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "strobeRate", "TYPE": "float", "MIN": 1.0, "MAX": 20.0, "DEFAULT": 8.0},
        {"NAME": "dutyCycle", "TYPE": "float", "MIN": 0.05, "MAX": 0.5, "DEFAULT": 0.1},
        {"NAME": "colorMode", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.0},
        {"NAME": "intensity", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "smoothing", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;

    float t = iTime * strobeRate;
    float phase = fract(t);

    // Strobe calculation
    float strobe;
    if (smoothing > 0.01) {
        // Smooth strobe
        strobe = smoothstep(0.0, dutyCycle * smoothing, phase) *
                 smoothstep(dutyCycle, dutyCycle * (1.0 - smoothing), phase);
    } else {
        // Hard strobe
        strobe = step(phase, dutyCycle);
    }

    // Color selection
    vec3 col;
    if (colorMode < 0.5) {
        // White strobe
        col = vec3(1.0);
    } else if (colorMode < 1.5) {
        // Rainbow cycle
        float hue = fract(floor(t) * 0.1);
        col = hsv2rgb(vec3(hue, 0.8, 1.0));
    } else {
        // Random color per flash
        float seed = floor(t);
        float hue = fract(sin(seed * 12.9898) * 43758.5453);
        col = hsv2rgb(vec3(hue, 0.9, 1.0));
    }

    col *= strobe * intensity;

    // Add slight vignette when flashing
    float vignette = 1.0 - length(uv - 0.5) * 0.5;
    col *= mix(1.0, vignette, strobe * 0.3);

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
