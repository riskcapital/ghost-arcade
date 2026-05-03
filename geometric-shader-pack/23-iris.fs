/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Circular iris that opens and closes between min and max radius. Use as a transition layer or as a sync-locked pulse.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 6.0},
        {"NAME": "minRadius", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 0.5},
        {"NAME": "maxRadius", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.05, "MAX": 1.2},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy - 0.5;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    float d = length(uv);
    float t = 0.5 + 0.5 * sin(TIME * speed);
    float r = mix(minRadius, maxRadius, t);
    float mask = step(d, r); // inside the iris = color1
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
