/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Animated concentric rings expanding outward (or inward — negate speed). Hard alternating bands, no anti-aliasing.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "ringCount", "TYPE": "float", "DEFAULT": 10.0, "MIN": 2.0, "MAX": 40.0},
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": -3.0, "MAX": 3.0},
        {"NAME": "duty", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.05, "MAX": 0.95},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [0.0, 0.95, 1.0, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.05, 0.05, 0.1, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy - 0.5;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    float r = length(uv);
    float p = fract(r * ringCount - TIME * speed);
    float on = step(p, duty);
    vec3 col = mix(color2.rgb, color1.rgb, on);
    gl_FragColor = vec4(col, 1.0);
}
