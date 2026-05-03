/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated neon lines with glow effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Lines"],
    "INPUTS": [
        {"NAME": "lineCount", "TYPE": "float", "MIN": 3.0, "MAX": 20.0, "DEFAULT": 8.0, "LABEL": "Line Count"},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Speed"},
        {"NAME": "waveAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Wave Amount"},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.005, "MAX": 0.05, "DEFAULT": 0.02, "LABEL": "Line Width"},
        {"NAME": "glowSize", "TYPE": "float", "MIN": 0.01, "MAX": 0.2, "DEFAULT": 0.08, "LABEL": "Glow Size"},
        {"NAME": "horizontal", "TYPE": "bool", "DEFAULT": true, "LABEL": "Horizontal"},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.5, 1.0], "LABEL": "Color 1"},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 1.0, 1.0, 1.0], "LABEL": "Color 2"},
        {"NAME": "bgBrightness", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.05, "LABEL": "Background"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float t = TIME * speed;

    vec3 col = vec3(bgBrightness);

    float coord = horizontal ? uv.y : uv.x;
    float perpCoord = horizontal ? uv.x : uv.y;

    for (float i = 0.0; i < 20.0; i++) {
        if (i >= lineCount) break;

        float linePos = (i + 0.5) / lineCount;

        // Wave distortion
        float wave = sin(perpCoord * 10.0 + t * 2.0 + i * 1.5) * waveAmount * 0.1;
        wave += sin(perpCoord * 5.0 - t + i * 0.7) * waveAmount * 0.05;

        float dist = abs(coord - linePos - wave);

        // Sharp line
        float line = smoothstep(lineWidth, lineWidth * 0.3, dist);

        // Glow
        float glow = smoothstep(glowSize, 0.0, dist) * 0.5;

        // Color gradient along line
        vec3 lineColor = mix(color1.rgb, color2.rgb, perpCoord + sin(t + i) * 0.2);

        col += (line + glow) * lineColor;
    }

    gl_FragColor = vec4(col, 1.0);
}
