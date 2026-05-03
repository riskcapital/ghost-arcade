/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Hard-edge full-frame strobe alternating between two colors. Bump speed for kick-rate flashes.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 4.0, "MIN": 0.0, "MAX": 30.0},
        {"NAME": "duty", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.05, "MAX": 0.95},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

void main() {
    float phase = fract(TIME * speed);
    float on = step(phase, duty);
    vec3 col = mix(color2.rgb, color1.rgb, on) * intensity;
    gl_FragColor = vec4(col, 1.0);
}
