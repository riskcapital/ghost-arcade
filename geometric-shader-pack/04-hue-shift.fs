/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Smooth full-frame hue rotation. Saturation and value act as a single solid swatch — looks like a slow chroma sweep through the rainbow.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "saturation", "TYPE": "float", "DEFAULT": 0.95, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "value", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "phaseOffset", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    float h = fract(TIME * speed + phaseOffset);
    gl_FragColor = vec4(hsv2rgb(vec3(h, saturation, value)), 1.0);
}
