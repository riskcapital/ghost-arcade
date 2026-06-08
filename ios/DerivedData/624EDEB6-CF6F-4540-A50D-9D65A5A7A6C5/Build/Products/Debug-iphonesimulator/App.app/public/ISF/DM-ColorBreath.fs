/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Gentle breathing color transitions - ambient and calming",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Color"],
    "INPUTS": [
        {"NAME": "breathSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.3, "LABEL": "Breath Speed"},
        {"NAME": "colorA", "TYPE": "color", "DEFAULT": [0.1, 0.2, 0.5, 1.0], "LABEL": "Color A"},
        {"NAME": "colorB", "TYPE": "color", "DEFAULT": [0.5, 0.1, 0.3, 1.0], "LABEL": "Color B"},
        {"NAME": "colorC", "TYPE": "color", "DEFAULT": [0.2, 0.4, 0.3, 1.0], "LABEL": "Color C"},
        {"NAME": "vignetteAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Vignette"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    float t = TIME * breathSpeed;

    // Smooth breathing cycle through 3 colors
    float phase = fract(t / 3.0) * 3.0;

    vec3 color;
    if (phase < 1.0) {
        color = mix(colorA.rgb, colorB.rgb, smoothstep(0.0, 1.0, phase));
    } else if (phase < 2.0) {
        color = mix(colorB.rgb, colorC.rgb, smoothstep(0.0, 1.0, phase - 1.0));
    } else {
        color = mix(colorC.rgb, colorA.rgb, smoothstep(0.0, 1.0, phase - 2.0));
    }

    // Add subtle variation across screen
    float variation = sin(uv.x * 3.14159 + t) * sin(uv.y * 3.14159 - t * 0.5) * 0.1;
    color += variation;

    // Vignette
    vec2 vc = uv - 0.5;
    float vignette = 1.0 - dot(vc, vc) * vignetteAmount * 2.0;
    color *= vignette;

    gl_FragColor = vec4(color, 1.0);
}
