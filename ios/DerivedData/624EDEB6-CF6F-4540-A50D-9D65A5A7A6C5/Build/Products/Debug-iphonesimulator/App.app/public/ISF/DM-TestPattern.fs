/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Test pattern for calibration - grid, colors, and alignment",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Utility", "Calibration"],
    "INPUTS": [
        {"NAME": "patternType", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 0.0, "LABEL": "Pattern Type"},
        {"NAME": "gridSize", "TYPE": "float", "MIN": 2.0, "MAX": 20.0, "DEFAULT": 8.0, "LABEL": "Grid Size"},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.01, "MAX": 0.1, "DEFAULT": 0.02, "LABEL": "Line Width"},
        {"NAME": "colorA", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0], "LABEL": "Color A"},
        {"NAME": "colorB", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0], "LABEL": "Color B"},
        {"NAME": "animate", "TYPE": "bool", "DEFAULT": false, "LABEL": "Animate"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    float t = animate ? TIME : 0.0;
    vec3 color = vec3(0.0);

    if (patternType < 1.0) {
        // Checkerboard
        vec2 grid = floor(uv * gridSize + t);
        float checker = mod(grid.x + grid.y, 2.0);
        color = mix(colorA.rgb, colorB.rgb, checker);
    }
    else if (patternType < 2.0) {
        // Grid lines
        vec2 grid = fract(uv * gridSize + t * 0.1);
        float lines = step(grid.x, lineWidth) + step(grid.y, lineWidth);
        lines = min(lines, 1.0);
        color = mix(colorB.rgb, colorA.rgb, lines);

        // Center crosshair
        float centerH = smoothstep(lineWidth * 2.0, lineWidth, abs(uv.y - 0.5));
        float centerV = smoothstep(lineWidth * 2.0, lineWidth, abs(uv.x - 0.5));
        color = mix(color, vec3(1.0, 0.0, 0.0), centerH * 0.8);
        color = mix(color, vec3(0.0, 1.0, 0.0), centerV * 0.8);
    }
    else if (patternType < 3.0) {
        // Color bars
        float x = uv.x * 8.0;
        if (x < 1.0) color = vec3(1.0, 1.0, 1.0);
        else if (x < 2.0) color = vec3(1.0, 1.0, 0.0);
        else if (x < 3.0) color = vec3(0.0, 1.0, 1.0);
        else if (x < 4.0) color = vec3(0.0, 1.0, 0.0);
        else if (x < 5.0) color = vec3(1.0, 0.0, 1.0);
        else if (x < 6.0) color = vec3(1.0, 0.0, 0.0);
        else if (x < 7.0) color = vec3(0.0, 0.0, 1.0);
        else color = vec3(0.0, 0.0, 0.0);
    }
    else if (patternType < 4.0) {
        // Gradient
        color = vec3(uv.x, uv.y, (uv.x + uv.y) * 0.5);
    }
    else {
        // Circles for focus
        vec2 p = uv - 0.5;
        p.x *= RENDERSIZE.x / RENDERSIZE.y;
        float d = length(p);
        float rings = sin(d * 50.0 - t * 2.0) * 0.5 + 0.5;
        color = mix(colorB.rgb, colorA.rgb, rings);
    }

    gl_FragColor = vec4(color, 1.0);
}
