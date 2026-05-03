/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Equilateral triangle that scales pulsing. Optional rotation. Pointing up by default.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "minSize", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.05, "MAX": 0.5},
        {"NAME": "maxSize", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.1, "MAX": 0.7},
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.0, "MAX": 8.0},
        {"NAME": "rotateSpeed", "TYPE": "float", "DEFAULT": 0.0, "MIN": -3.0, "MAX": 3.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [0.2, 1.0, 0.5, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

float sdEquilateralTriangle(vec2 p, float r) {
    const float k = sqrt(3.0);
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy - 0.5;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    float a = TIME * rotateSpeed;
    float c = cos(a), s = sin(a);
    uv = mat2(c, -s, s, c) * uv;
    float t = 0.5 + 0.5 * sin(TIME * speed);
    float size = mix(minSize, maxSize, t);
    float d = sdEquilateralTriangle(uv, size);
    float mask = step(d, 0.0);
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
