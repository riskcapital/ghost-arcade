/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Single filled circle that breathes between min and max size. Wire audioLevel to a kick band for a heartbeat.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "minSize", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 0.5},
        {"NAME": "maxSize", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.05, "MAX": 0.5},
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 8.0},
        {"NAME": "audioLevel", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 0.4, 0.5, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy - 0.5;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    float t = 0.5 + 0.5 * sin(TIME * speed);
    float size = mix(minSize, maxSize, max(t, audioLevel));
    float d = length(uv);
    float mask = step(d, size);
    vec3 col = mix(color2.rgb, color1.rgb, mask);
    gl_FragColor = vec4(col, 1.0);
}
