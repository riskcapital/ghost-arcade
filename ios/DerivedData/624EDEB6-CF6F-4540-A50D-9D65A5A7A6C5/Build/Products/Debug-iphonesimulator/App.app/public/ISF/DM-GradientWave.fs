/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Smooth animated gradient waves - perfect for ambient backgrounds",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Color"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 0.5, "LABEL": "Speed"},
        {"NAME": "waveScale", "TYPE": "float", "MIN": 0.5, "MAX": 10.0, "DEFAULT": 3.0, "LABEL": "Wave Scale"},
        {"NAME": "colorShift", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "Color Shift"},
        {"NAME": "saturation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.8, "LABEL": "Saturation"},
        {"NAME": "brightness", "TYPE": "float", "MIN": 0.2, "MAX": 1.5, "DEFAULT": 0.7, "LABEL": "Brightness"},
        {"NAME": "waveDirection", "TYPE": "float", "MIN": 0.0, "MAX": 6.28, "DEFAULT": 0.0, "LABEL": "Direction"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    // Create wave direction
    vec2 dir = vec2(cos(waveDirection), sin(waveDirection));
    float wave = dot(uv - 0.5, dir);

    // Animated gradient
    float t = TIME * speed;
    float gradient = sin(wave * waveScale + t) * 0.5 + 0.5;
    gradient += sin(wave * waveScale * 0.5 - t * 0.7) * 0.3;
    gradient = clamp(gradient, 0.0, 1.0);

    // Create color from gradient
    float hue = fract(gradient * 0.5 + colorShift + t * 0.1);
    vec3 color = hsv2rgb(vec3(hue, saturation, brightness));

    gl_FragColor = vec4(color, 1.0);
}
