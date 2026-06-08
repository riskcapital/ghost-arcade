/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Classic plasma effect with smooth flowing colors",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Color"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Speed"},
        {"NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 3.0, "LABEL": "Scale"},
        {"NAME": "complexity", "TYPE": "float", "MIN": 1.0, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Complexity"},
        {"NAME": "hueRange", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Hue Range"},
        {"NAME": "hueOffset", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "Hue Offset"},
        {"NAME": "saturation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.9, "LABEL": "Saturation"}
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
    uv = uv * 2.0 - 1.0;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    uv *= scale;

    float t = TIME * speed;

    // Create plasma pattern
    float v = 0.0;
    v += sin(uv.x + t);
    v += sin(uv.y + t * 0.7);
    v += sin((uv.x + uv.y) * 0.5 + t * 0.5);

    if (complexity > 1.5) {
        v += sin(length(uv) * 2.0 - t);
    }
    if (complexity > 2.5) {
        v += sin(sqrt(uv.x * uv.x + uv.y * uv.y + 1.0) * 3.0 + t * 1.3);
    }
    if (complexity > 3.5) {
        v += sin(uv.x * uv.y + t * 0.8);
    }

    v = v / complexity;
    v = v * 0.5 + 0.5;

    // Map to color
    float hue = fract(v * hueRange + hueOffset + t * 0.05);
    vec3 color = hsv2rgb(vec3(hue, saturation, 0.8));

    gl_FragColor = vec4(color, 1.0);
}
