/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Filled hexagon. Pointy-up by default; flat-top with rotateSpeed = 0 + phaseOffset = 30 deg via static rotation, or just bump rotateSpeed to keep it spinning.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "size", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.05, "MAX": 0.7},
        {"NAME": "rotateSpeed", "TYPE": "float", "DEFAULT": 0.2, "MIN": -3.0, "MAX": 3.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [0.9, 0.5, 1.0, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

float sdHexagon(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy - 0.5;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    float a = TIME * rotateSpeed;
    float c = cos(a), s = sin(a);
    uv = mat2(c, -s, s, c) * uv;
    float d = sdHexagon(uv, size);
    float mask = step(d, 0.0);
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
