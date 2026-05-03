/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Strobe/flash effect with adjustable timing",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Utility", "Effect"],
    "INPUTS": [
        {"NAME": "strobeRate", "TYPE": "float", "MIN": 0.5, "MAX": 20.0, "DEFAULT": 4.0, "LABEL": "Rate (Hz)"},
        {"NAME": "dutyCycle", "TYPE": "float", "MIN": 0.1, "MAX": 0.9, "DEFAULT": 0.5, "LABEL": "Duty Cycle"},
        {"NAME": "onColor", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0], "LABEL": "On Color"},
        {"NAME": "offColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0], "LABEL": "Off Color"},
        {"NAME": "smoothness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "Smoothness"},
        {"NAME": "randomize", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "Randomize"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

void main() {
    float t = TIME * strobeRate;

    // Add randomization to timing
    if (randomize > 0.0) {
        float rnd = hash(floor(t));
        t += rnd * randomize;
    }

    float phase = fract(t);

    // Strobe with optional smoothness
    float strobe;
    if (smoothness > 0.0) {
        float edge = smoothness * 0.5;
        strobe = smoothstep(0.0, edge, phase) * smoothstep(dutyCycle + edge, dutyCycle, phase);
    } else {
        strobe = step(phase, dutyCycle);
    }

    vec3 color = mix(offColor.rgb, onColor.rgb, strobe);

    gl_FragColor = vec4(color, 1.0);
}
