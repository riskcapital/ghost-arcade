/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Single hard line sweeping diagonally across the screen. Uses lineWidth as a fraction of the diagonal extent.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": -4.0, "MAX": 4.0},
        {"NAME": "lineWidth", "TYPE": "float", "DEFAULT": 0.04, "MIN": 0.005, "MAX": 0.5},
        {"NAME": "angle", "TYPE": "float", "DEFAULT": 45.0, "MIN": 0.0, "MAX": 180.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy - 0.5;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    float a = radians(angle);
    float c = cos(a), s = sin(a);
    float v = uv.x * c + uv.y * s;
    float pos = mod(v + TIME * speed * 0.3 + 1.0, 2.0) - 1.0; // sweeps from -1 to +1
    float mask = step(abs(pos), lineWidth * 0.5);
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
