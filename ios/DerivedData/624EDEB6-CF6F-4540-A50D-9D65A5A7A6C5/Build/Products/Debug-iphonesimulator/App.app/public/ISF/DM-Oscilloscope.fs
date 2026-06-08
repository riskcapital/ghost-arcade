/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Audio visualizer style oscilloscope waves",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Motion"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Speed"},
        {"NAME": "waveCount", "TYPE": "float", "MIN": 1.0, "MAX": 5.0, "DEFAULT": 3.0, "LABEL": "Wave Count"},
        {"NAME": "amplitude", "TYPE": "float", "MIN": 0.1, "MAX": 0.5, "DEFAULT": 0.3, "LABEL": "Amplitude"},
        {"NAME": "frequency", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 4.0, "LABEL": "Frequency"},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.005, "MAX": 0.05, "DEFAULT": 0.015, "LABEL": "Line Width"},
        {"NAME": "glowAmount", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Glow"},
        {"NAME": "waveColor", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.5, 1.0], "LABEL": "Wave Color"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = uv * 2.0 - 1.0;

    float t = TIME * speed;
    vec3 color = vec3(0.0);

    for (int i = 0; i < 5; i++) {
        if (float(i) >= waveCount) break;

        float offset = float(i) * 0.15;
        float phase = float(i) * 0.5;

        // Create wave
        float wave = sin(p.x * frequency * 3.14159 + t + phase) * amplitude;
        wave += sin(p.x * frequency * 2.0 * 3.14159 - t * 1.3 + phase) * amplitude * 0.5;
        wave += sin(p.x * frequency * 0.5 * 3.14159 + t * 0.7 + phase) * amplitude * 0.3;

        // Vertical offset for multiple waves
        float y = p.y - offset + 0.2;

        // Distance to wave
        float d = abs(y - wave);

        // Line
        float line = smoothstep(lineWidth, lineWidth * 0.3, d);

        // Glow
        float glow = smoothstep(lineWidth * 8.0, lineWidth, d) * glowAmount * 0.3;

        // Color with slight variation per wave
        vec3 waveCol = waveColor.rgb;
        waveCol.r += float(i) * 0.1;
        waveCol.b -= float(i) * 0.1;

        color += waveCol * (line + glow) / waveCount;
    }

    // Add subtle grid
    float grid = smoothstep(0.02, 0.01, abs(fract(uv.x * 10.0) - 0.5));
    grid += smoothstep(0.02, 0.01, abs(fract(uv.y * 10.0) - 0.5));
    color += vec3(0.0, 0.1, 0.05) * grid * 0.3;

    gl_FragColor = vec4(color, 1.0);
}
