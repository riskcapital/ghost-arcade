/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Solid color whose brightness rides the audioLevel slider. Wire audioLevel to a kick-band envelope for a strobe that breathes with the music.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "audioLevel", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "baseLevel", "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]},
        {"NAME": "gamma", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.5, "MAX": 4.0}
    ]
}*/

void main() {
    float a = pow(clamp(audioLevel, 0.0, 1.0), gamma);
    float lum = baseLevel + a * (1.0 - baseLevel);
    vec3 col = mix(color2.rgb, color1.rgb, lum);
    gl_FragColor = vec4(col, 1.0);
}
