/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Hollow ring / donut. Tweak radius + thickness for a thin outline or a thick band.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "radius", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.05, "MAX": 0.5},
        {"NAME": "thickness", "TYPE": "float", "DEFAULT": 0.06, "MIN": 0.005, "MAX": 0.4},
        {"NAME": "audioLevel", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [0.2, 0.8, 1.0, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy - 0.5;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    float d = length(uv);
    float r = radius + audioLevel * 0.1;
    float halfT = thickness * 0.5;
    float mask = step(r - halfT, d) * step(d, r + halfT);
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
