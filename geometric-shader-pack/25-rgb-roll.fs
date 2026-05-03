/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Three colored bars — red, green, blue — chase across the screen at fixed offsets. Old broadcast / glitch-VJ aesthetic.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.6, "MIN": -4.0, "MAX": 4.0},
        {"NAME": "barWidth", "TYPE": "float", "DEFAULT": 0.18, "MIN": 0.02, "MAX": 0.5},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float bar(float x, float center, float width) {
    return step(abs(x - center), width * 0.5);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float t = TIME * speed * 0.4;
    float rPos = mod(t,             1.0);
    float gPos = mod(t + 1.0/3.0,   1.0);
    float bPos = mod(t + 2.0/3.0,   1.0);
    float r = bar(uv.x, rPos, barWidth);
    float g = bar(uv.x, gPos, barWidth);
    float b = bar(uv.x, bPos, barWidth);
    vec3 col = vec3(r, g, b) * intensity;
    gl_FragColor = vec4(col, 1.0);
}
