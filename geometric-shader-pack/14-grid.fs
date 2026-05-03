/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Wireframe grid with adjustable cell size + line width. More precise than the built-in grid placeholder shader.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "cells", "TYPE": "float", "DEFAULT": 16.0, "MIN": 2.0, "MAX": 64.0},
        {"NAME": "lineWidth", "TYPE": "float", "DEFAULT": 0.04, "MIN": 0.005, "MAX": 0.4},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    vec2 g = fract(uv * cells);
    float halfLW = lineWidth * 0.5;
    float lineX = step(g.x, halfLW) + step(1.0 - halfLW, g.x);
    float lineY = step(g.y, halfLW) + step(1.0 - halfLW, g.y);
    float mask = clamp(lineX + lineY, 0.0, 1.0);
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
