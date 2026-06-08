/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated Mandelbrot fractal with pulsing colors",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Fractal"],
    "INPUTS": [
        {"NAME": "zoom", "TYPE": "float", "MIN": 0.5, "MAX": 100.0, "DEFAULT": 2.0, "LABEL": "Zoom"},
        {"NAME": "centerX", "TYPE": "float", "MIN": -2.0, "MAX": 1.0, "DEFAULT": -0.5, "LABEL": "Center X"},
        {"NAME": "centerY", "TYPE": "float", "MIN": -1.5, "MAX": 1.5, "DEFAULT": 0.0, "LABEL": "Center Y"},
        {"NAME": "iterations", "TYPE": "float", "MIN": 20.0, "MAX": 100.0, "DEFAULT": 50.0, "LABEL": "Iterations"},
        {"NAME": "colorSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Color Speed"},
        {"NAME": "pulseAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Pulse Amount"},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [0.0, 0.3, 0.8, 1.0], "LABEL": "Color 1"},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [1.0, 0.5, 0.0, 1.0], "LABEL": "Color 2"},
        {"NAME": "color3", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.5, 1.0], "LABEL": "Color 3"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 c = (uv - 0.5) * 2.0 / zoom + vec2(centerX, centerY);
    c.x *= RENDERSIZE.x / RENDERSIZE.y;

    vec2 z = vec2(0.0);
    float iter = 0.0;

    for (float i = 0.0; i < 100.0; i++) {
        if (i >= iterations) break;
        if (dot(z, z) > 4.0) break;

        z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        iter = i;
    }

    float t = TIME * colorSpeed;
    float pulse = sin(t * 3.0) * pulseAmount;

    // Smooth iteration count for better coloring
    float smoothIter = iter - log2(log2(dot(z, z)));
    float colorVal = smoothIter / iterations + pulse;

    vec3 col;
    if (iter >= iterations - 1.0) {
        col = vec3(0.0);
    } else {
        // Cycle through colors
        float phase = fract(colorVal + t * 0.1);
        if (phase < 0.33) {
            col = mix(color1.rgb, color2.rgb, phase * 3.0);
        } else if (phase < 0.66) {
            col = mix(color2.rgb, color3.rgb, (phase - 0.33) * 3.0);
        } else {
            col = mix(color3.rgb, color1.rgb, (phase - 0.66) * 3.0);
        }

        col *= 0.5 + 0.5 * sin(smoothIter * 0.1 + t);
    }

    gl_FragColor = vec4(col, 1.0);
}
