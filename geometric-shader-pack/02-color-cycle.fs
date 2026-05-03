/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Full-saturation hue cycle. Set steps > 0 to quantize the hue (great for hard 4/8/16-step rotation locked to a beat).",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 4.0},
        {"NAME": "steps", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 24.0},
        {"NAME": "saturation", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    float h = fract(TIME * speed);
    if (steps > 0.5) {
        h = floor(h * steps) / steps;
    }
    vec3 col = hsv2rgb(vec3(h, saturation, 1.0)) * intensity;
    gl_FragColor = vec4(col, 1.0);
}
