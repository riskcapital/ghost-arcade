/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Animated diagonal stripes (chase). Negative speed scrolls the other way. Set angle to 0 for vertical, 90 for horizontal.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "stripes", "TYPE": "float", "DEFAULT": 12.0, "MIN": 2.0, "MAX": 64.0},
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.6, "MIN": -4.0, "MAX": 4.0},
        {"NAME": "angle", "TYPE": "float", "DEFAULT": 45.0, "MIN": 0.0, "MAX": 180.0},
        {"NAME": "duty", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.05, "MAX": 0.95},
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
    float p = fract(v * stripes - TIME * speed);
    float on = step(p, duty);
    vec3 col = mix(color2.rgb, color1.rgb, on);
    gl_FragColor = vec4(col, 1.0);
}
