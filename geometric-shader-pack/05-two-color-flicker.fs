/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Pseudo-random two-color flicker. Each tick picks color1 or color2 by hash. Set speed high for glitchy strobe, low for moody pulse.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 8.0, "MIN": 0.5, "MAX": 30.0},
        {"NAME": "bias", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 0.2, 0.4, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.1, 0.8, 1.0, 1.0]}
    ]
}*/

float hash(float n) {
    return fract(sin(n * 91.3458) * 47453.5453);
}

void main() {
    float tick = floor(TIME * speed);
    float r = hash(tick);
    float pick = step(bias, r);
    vec3 col = mix(color1.rgb, color2.rgb, pick);
    gl_FragColor = vec4(col, 1.0);
}
