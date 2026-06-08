/*{
    "DESCRIPTION": "Star drift — layered twinkling particles flowing across a radial halo",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Particles"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Speed"},
        {"NAME": "density", "TYPE": "float", "MIN": 0.3, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Density"},
        {"NAME": "brightness", "TYPE": "float", "MIN": 0.2, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Brightness"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float snow(vec2 uv, float scale) {
    float _t = TIME * 0.2 * speed;
    uv.x += _t / scale;
    uv *= scale;
    vec2 s = floor(uv), f = fract(uv), p;
    float k = 40.0, d;
    p = 0.5 + 0.35 * sin(8.0 * fract(sin((s + p + scale) * mat2(2, 4, 7, 6)) * 6.0)) - f;
    d = length(p);
    k = min(d, k);
    k = smoothstep(0.0, k, sin(f.x + f.y) * 0.009);
    return k;
}

void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - RENDERSIZE.xy) / min(RENDERSIZE.x, RENDERSIZE.y);
    // Clamp the radial factor away from zero so the halo multiplier stays finite.
    float dd = max(abs(1.0 - length(uv)), 0.05);
    uv.x += sin(TIME * 0.08 * speed);
    uv.y += sin(uv.x * 1.4) * 0.2;
    uv.x *= 0.07;

    float scaleMul = density;
    float c = snow(uv, 30.0 * scaleMul) * 0.3;
    c += snow(uv, 25.0 * scaleMul) * 0.5;
    c += snow(uv, 15.0 * scaleMul) * 0.8;
    c += snow(uv, 10.0 * scaleMul);
    c += snow(uv, 10.0 * scaleMul);
    c += snow(uv, 6.0 * scaleMul);
    c += snow(uv, 5.0 * scaleMul);
    c *= 0.2 / dd;

    vec3 finalColor = vec3(0.7, 0.8, 0.9) * c * 30.0 * brightness;
    gl_FragColor = vec4(finalColor, 1.0);
}
