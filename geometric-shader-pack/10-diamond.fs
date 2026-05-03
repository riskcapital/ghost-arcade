/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Filled rhombus / diamond. Same as a square rotated 45 degrees but with its own size + rotation control.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "size", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.05, "MAX": 0.7},
        {"NAME": "stretch", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.5},
        {"NAME": "rotateSpeed", "TYPE": "float", "DEFAULT": 0.0, "MIN": -3.0, "MAX": 3.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 1.0, 0.2, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy - 0.5;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    float a = TIME * rotateSpeed;
    float c = cos(a), s = sin(a);
    uv = mat2(c, -s, s, c) * uv;
    uv.y /= stretch;
    float d = abs(uv.x) + abs(uv.y);
    float mask = step(d, size);
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
