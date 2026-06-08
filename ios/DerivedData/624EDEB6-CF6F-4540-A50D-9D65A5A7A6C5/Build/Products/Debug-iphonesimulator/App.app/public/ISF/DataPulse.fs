/*{
    "CREDIT": "Shrink Wrap",
    "DESCRIPTION": "Pulsing data visualization with waveform aesthetics",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.7},
        {"NAME": "waveCount", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 4.0},
        {"NAME": "amplitude", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.4},
        {"NAME": "complexity", "TYPE": "float", "MIN": 1.0, "MAX": 5.0, "DEFAULT": 3.0},
        {"NAME": "hue", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "pulseSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    vec3 col = vec3(0.0);

    int waves = int(waveCount);
    for (int i = 0; i < 8; i++) {
        if (i >= waves) break;

        float fi = float(i);
        float waveY = (fi / waveCount - 0.5) * 1.5;

        // Complex waveform
        float wave = 0.0;
        for (int j = 0; j < 5; j++) {
            if (float(j) >= complexity) break;
            float fj = float(j) + 1.0;
            float freq = 3.0 + fj * 2.0 + fi;
            float phase = t * (1.0 + fi * 0.2) + fi * 0.5;
            wave += sin(uv.x * freq + phase) / fj;
        }
        wave *= amplitude * 0.3;

        // Pulse effect
        float pulse = sin(t * pulseSpeed * PI + fi * 0.5) * 0.5 + 0.5;
        wave *= 0.5 + pulse * 0.5;

        // Distance to wave
        float d = abs(uv.y - waveY - wave);

        // Glow
        float glow = 0.01 / (d + 0.01);
        glow *= pulse * 0.5 + 0.5;

        // Line
        float line = smoothstep(0.01, 0.002, d);

        // Color per wave
        float waveHue = hue + fi * 0.1;
        vec3 waveColor = hsv2rgb(vec3(waveHue, 0.8, 1.0));

        col += waveColor * glow * 0.2;
        col += waveColor * line;
    }

    // Data points
    float dataX = fract(uv.x * 10.0 + t);
    float dataPoint = smoothstep(0.1, 0.0, abs(dataX - 0.5)) * smoothstep(0.1, 0.0, abs(fract(uv.y * 5.0) - 0.5));
    col += hsv2rgb(vec3(hue + 0.3, 0.6, 0.5)) * dataPoint * 0.3;

    // Scanning line
    float scanX = fract(t * 0.5);
    float scan = smoothstep(0.05, 0.0, abs(uv.x - scanX + 0.5));
    col += hsv2rgb(vec3(hue, 0.3, 0.5)) * scan * 0.3;

    // Grid background
    vec2 grid = abs(fract(uv * 10.0) - 0.5);
    float gridLine = smoothstep(0.48, 0.5, max(grid.x, grid.y));
    col += vec3(0.02) * gridLine;

    gl_FragColor = vec4(col, 1.0);
}
