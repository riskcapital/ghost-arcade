/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Hard plus / cross sign. Adjust thickness for fat church-cross or thin medical-plus.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "thickness", "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.02, "MAX": 0.4},
        {"NAME": "size", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.1, "MAX": 0.7},
        {"NAME": "rotateSpeed", "TYPE": "float", "DEFAULT": 0.0, "MIN": -3.0, "MAX": 3.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 0.2, 0.2, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy - 0.5;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    float a = TIME * rotateSpeed;
    float c = cos(a), s = sin(a);
    uv = mat2(c, -s, s, c) * uv;
    vec2 d = abs(uv);
    float vBar = step(d.x, thickness * 0.5) * step(d.y, size);
    float hBar = step(d.y, thickness * 0.5) * step(d.x, size);
    float mask = max(vBar, hBar);
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
