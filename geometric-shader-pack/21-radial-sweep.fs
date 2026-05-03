/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Radar-style line rotating around screen center. Wedge width controls how much of the disc is lit at any moment.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.6, "MIN": -4.0, "MAX": 4.0},
        {"NAME": "wedgeWidth", "TYPE": "float", "DEFAULT": 0.04, "MIN": 0.005, "MAX": 0.5},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [0.2, 1.0, 0.5, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.05, 0.05, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy - 0.5;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    float ang = atan(uv.y, uv.x);
    float t = TIME * speed;
    float a = mod(ang - t + 3.14159, 6.28318) / 6.28318; // 0..1
    float mask = step(a, wedgeWidth);
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
