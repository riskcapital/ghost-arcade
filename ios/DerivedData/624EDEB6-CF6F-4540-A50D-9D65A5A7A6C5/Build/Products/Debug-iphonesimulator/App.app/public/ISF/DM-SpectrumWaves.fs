/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Rainbow spectrum waves animation",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio-Visual"],
    "INPUTS": [
        {"NAME": "waveCount", "TYPE": "float", "MIN": 3.0, "MAX": 15.0, "DEFAULT": 7.0, "LABEL": "Wave Count"},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Speed"},
        {"NAME": "amplitude", "TYPE": "float", "MIN": 0.05, "MAX": 0.3, "DEFAULT": 0.15, "LABEL": "Amplitude"},
        {"NAME": "frequency", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 4.0, "LABEL": "Frequency"},
        {"NAME": "thickness", "TYPE": "float", "MIN": 0.01, "MAX": 0.1, "DEFAULT": 0.03, "LABEL": "Thickness"},
        {"NAME": "glow", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Glow"},
        {"NAME": "saturation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "Saturation"},
        {"NAME": "vertical", "TYPE": "bool", "DEFAULT": false, "LABEL": "Vertical"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 hue2rgb(float h) {
    h = fract(h);
    float r = abs(h * 6.0 - 3.0) - 1.0;
    float g = 2.0 - abs(h * 6.0 - 2.0);
    float b = 2.0 - abs(h * 6.0 - 4.0);
    return clamp(vec3(r, g, b), 0.0, 1.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    float t = TIME * speed;

    float coord = vertical ? uv.x : uv.y;
    float perpCoord = vertical ? uv.y : uv.x;

    vec3 col = vec3(0.0);

    for (float i = 0.0; i < 15.0; i++) {
        if (i >= waveCount) break;

        float wavePos = (i + 0.5) / waveCount;

        // Wave displacement
        float phase = perpCoord * frequency + t + i * 0.5;
        float wave = sin(phase) * amplitude;
        wave += sin(phase * 2.3 + t * 1.3) * amplitude * 0.3;

        float dist = abs(coord - wavePos - wave);

        // Wave line
        float line = smoothstep(thickness, thickness * 0.3, dist);

        // Glow
        float glowEffect = smoothstep(thickness * 4.0, 0.0, dist) * glow;

        // Rainbow color based on wave position
        float hue = i / waveCount;
        vec3 waveColor = hue2rgb(hue);
        waveColor = mix(vec3(1.0), waveColor, saturation);

        col += waveColor * (line + glowEffect * 0.3);
    }

    gl_FragColor = vec4(col, 1.0);
}
