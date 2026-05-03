/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Grid of dots whose size pulses uniformly with audio + time. Wire audioLevel to a kick band for an LED-screen look.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "cells", "TYPE": "float", "DEFAULT": 14.0, "MIN": 2.0, "MAX": 48.0},
        {"NAME": "minDot", "TYPE": "float", "DEFAULT": 0.18, "MIN": 0.0, "MAX": 0.5},
        {"NAME": "maxDot", "TYPE": "float", "DEFAULT": 0.42, "MIN": 0.05, "MAX": 0.5},
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.0, "MAX": 8.0},
        {"NAME": "audioLevel", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 0.4, 0.2, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    vec2 g = fract(uv * cells) - 0.5;
    float t = 0.5 + 0.5 * sin(TIME * speed);
    float dotR = mix(minDot, maxDot, max(t, audioLevel));
    float mask = step(length(g), dotR);
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
