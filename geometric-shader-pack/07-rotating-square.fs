/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Filled square rotating around screen center. Hard edges, brutalist look.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "size", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.05, "MAX": 0.7},
        {"NAME": "rotateSpeed", "TYPE": "float", "DEFAULT": 0.3, "MIN": -3.0, "MAX": 3.0},
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
    vec2 d = abs(uv);
    float mask = step(max(d.x, d.y), size);
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
