/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Calibration test bars with optional grayscale strip",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Utility", "Calibration"],
    "INPUTS": [
        {"NAME":"brightness","TYPE":"float","MIN":0.0,"MAX":2.0,"DEFAULT":1.0,"LABEL":"Brightness"},
        {"NAME":"showGray","TYPE":"bool","DEFAULT":true,"LABEL":"Show Gray Strip"},
        {"NAME":"showBorder","TYPE":"bool","DEFAULT":true,"LABEL":"Show Border"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 bars(float x) {
    if (x < 1.0/8.0) return vec3(1.0, 1.0, 1.0);
    if (x < 2.0/8.0) return vec3(1.0, 1.0, 0.0);
    if (x < 3.0/8.0) return vec3(0.0, 1.0, 1.0);
    if (x < 4.0/8.0) return vec3(0.0, 1.0, 0.0);
    if (x < 5.0/8.0) return vec3(1.0, 0.0, 1.0);
    if (x < 6.0/8.0) return vec3(1.0, 0.0, 0.0);
    if (x < 7.0/8.0) return vec3(0.0, 0.0, 1.0);
    return vec3(0.0, 0.0, 0.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    vec3 color = bars(uv.x);

    if (showGray && uv.y < 0.16) {
        float g = floor(uv.x * 8.0) / 7.0;
        color = vec3(g);
    }

    if (showBorder) {
        float w = 2.0 / min(RENDERSIZE.x, RENDERSIZE.y);
        float edge = step(uv.x, w) + step(uv.y, w) + step(1.0 - uv.x, w) + step(1.0 - uv.y, w);
        if (edge > 0.0) color = vec3(1.0);
    }

    gl_FragColor = vec4(color * brightness, 1.0);
}

