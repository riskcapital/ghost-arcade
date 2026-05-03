/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Moving spotlight effect with customizable beam",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Utility", "Effect"],
    "INPUTS": [
        {"NAME": "spotX", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Position X"},
        {"NAME": "spotY", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Position Y"},
        {"NAME": "spotSize", "TYPE": "float", "MIN": 0.05, "MAX": 0.5, "DEFAULT": 0.2, "LABEL": "Spot Size"},
        {"NAME": "softness", "TYPE": "float", "MIN": 0.01, "MAX": 0.5, "DEFAULT": 0.1, "LABEL": "Softness"},
        {"NAME": "spotColor", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0], "LABEL": "Spot Color"},
        {"NAME": "bgColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0], "LABEL": "Background"},
        {"NAME": "autoMove", "TYPE": "bool", "DEFAULT": false, "LABEL": "Auto Move"},
        {"NAME": "moveSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Move Speed"},
        {"NAME": "movePattern", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.0, "LABEL": "Move Pattern"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    vec2 spotPos = vec2(spotX, spotY);

    // Auto movement
    if (autoMove) {
        float t = TIME * moveSpeed;

        if (movePattern < 1.0) {
            // Circular
            spotPos.x = 0.5 + cos(t) * 0.3;
            spotPos.y = 0.5 + sin(t) * 0.3;
        } else if (movePattern < 2.0) {
            // Figure 8
            spotPos.x = 0.5 + cos(t) * 0.3;
            spotPos.y = 0.5 + sin(t * 2.0) * 0.2;
        } else {
            // Random-ish
            spotPos.x = 0.5 + cos(t * 0.7) * cos(t * 1.3) * 0.3;
            spotPos.y = 0.5 + sin(t * 0.9) * sin(t * 1.1) * 0.3;
        }
    }

    // Distance from spotlight center
    vec2 p = uv - spotPos;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;
    float d = length(p);

    // Spotlight with soft edge
    float spot = smoothstep(spotSize + softness, spotSize - softness * 0.5, d);

    // Mix colors
    vec3 color = mix(bgColor.rgb, spotColor.rgb, spot);

    gl_FragColor = vec4(color, 1.0);
}
