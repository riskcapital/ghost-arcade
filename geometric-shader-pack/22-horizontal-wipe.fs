/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Hard color block that wipes left-to-right across the screen, then resets. Increase blockWidth for a solid sweep, decrease for a thin scan line.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": -4.0, "MAX": 4.0},
        {"NAME": "blockWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.02, "MAX": 1.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.6, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float pos = mod(TIME * speed * 0.5 + 1.0, 2.0) - 1.0; // -1 .. +1
    // Block runs from pos to pos + blockWidth
    float left = pos;
    float right = pos + blockWidth;
    float mask = step(left, uv.x) * step(uv.x, right);
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
