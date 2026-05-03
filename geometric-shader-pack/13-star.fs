/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "N-point star. Adjust points (3..12) for different shapes, sharpness for fat or pointy spikes.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "points", "TYPE": "float", "DEFAULT": 5.0, "MIN": 3.0, "MAX": 12.0},
        {"NAME": "size", "TYPE": "float", "DEFAULT": 0.42, "MIN": 0.05, "MAX": 0.7},
        {"NAME": "sharpness", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.05, "MAX": 0.95},
        {"NAME": "rotateSpeed", "TYPE": "float", "DEFAULT": 0.15, "MIN": -3.0, "MAX": 3.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 0.85, 0.0, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy - 0.5;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    float a = TIME * rotateSpeed;
    float c = cos(a), s = sin(a);
    uv = mat2(c, -s, s, c) * uv;
    float r = length(uv);
    float ang = atan(uv.y, uv.x);
    float n = floor(points);
    float petal = cos(ang * n);
    float radius = size * mix(sharpness, 1.0, 0.5 + 0.5 * petal);
    float mask = step(r, radius);
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
