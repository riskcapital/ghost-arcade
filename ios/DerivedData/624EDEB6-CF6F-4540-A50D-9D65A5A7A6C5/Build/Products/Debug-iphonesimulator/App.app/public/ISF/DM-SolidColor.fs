/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Simple solid color with optional vignette - essential utility",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Utility", "Color"],
    "INPUTS": [
        {"NAME": "baseColor", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0], "LABEL": "Color"},
        {"NAME": "brightness", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Brightness"},
        {"NAME": "vignetteAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "Vignette"},
        {"NAME": "vignetteSoftness", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Vignette Soft"},
        {"NAME": "pulseEnabled", "TYPE": "bool", "DEFAULT": false, "LABEL": "Pulse"},
        {"NAME": "pulseSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 5.0, "DEFAULT": 1.0, "LABEL": "Pulse Speed"},
        {"NAME": "pulseAmount", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.2, "LABEL": "Pulse Amount"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    vec3 color = baseColor.rgb * brightness;

    // Pulse
    if (pulseEnabled) {
        float pulse = sin(TIME * pulseSpeed * 3.14159) * 0.5 + 0.5;
        color *= 1.0 - pulseAmount + pulse * pulseAmount;
    }

    // Vignette
    if (vignetteAmount > 0.0) {
        vec2 vc = uv - 0.5;
        float vignette = 1.0 - smoothstep(vignetteSoftness * 0.5, vignetteSoftness, length(vc) * vignetteAmount * 2.0);
        color *= vignette;
    }

    gl_FragColor = vec4(color, baseColor.a);
}
