/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Two-tone checkerboard. Optional rotation for tilted boards.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "cells", "TYPE": "float", "DEFAULT": 8.0, "MIN": 2.0, "MAX": 64.0},
        {"NAME": "rotateSpeed", "TYPE": "float", "DEFAULT": 0.0, "MIN": -2.0, "MAX": 2.0},
        {"NAME": "scrollSpeed", "TYPE": "float", "DEFAULT": 0.0, "MIN": -2.0, "MAX": 2.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy - 0.5;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    float a = TIME * rotateSpeed;
    float c = cos(a), s = sin(a);
    uv = mat2(c, -s, s, c) * uv;
    uv += vec2(TIME * scrollSpeed);
    vec2 g = floor(uv * cells);
    float pick = mod(g.x + g.y, 2.0);
    vec3 col = mix(color2.rgb, color1.rgb, pick);
    gl_FragColor = vec4(col, 1.0);
}
