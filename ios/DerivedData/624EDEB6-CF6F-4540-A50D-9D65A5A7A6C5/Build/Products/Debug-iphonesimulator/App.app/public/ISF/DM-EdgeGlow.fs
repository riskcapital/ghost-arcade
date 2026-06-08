/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated edge glow effect - great for framing projections",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Utility", "Effect"],
    "INPUTS": [
        {"NAME": "glowWidth", "TYPE": "float", "MIN": 0.01, "MAX": 0.3, "DEFAULT": 0.1, "LABEL": "Glow Width"},
        {"NAME": "glowIntensity", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Intensity"},
        {"NAME": "pulseSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Pulse Speed"},
        {"NAME": "rotateSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Rotate Speed"},
        {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [0.0, 0.8, 1.0, 1.0], "LABEL": "Glow Color"},
        {"NAME": "centerColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 0.0], "LABEL": "Center Color"},
        {"NAME": "edgeOnly", "TYPE": "bool", "DEFAULT": true, "LABEL": "Edges Only"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    // Distance from edges
    float dLeft = uv.x;
    float dRight = 1.0 - uv.x;
    float dTop = 1.0 - uv.y;
    float dBottom = uv.y;

    float dMin = min(min(dLeft, dRight), min(dTop, dBottom));

    // Pulse animation
    float pulse = 1.0;
    if (pulseSpeed > 0.0) {
        pulse = sin(TIME * pulseSpeed * 3.14159) * 0.3 + 0.7;
    }

    // Rotating highlight
    float highlight = 1.0;
    if (rotateSpeed > 0.0) {
        float angle = TIME * rotateSpeed;

        // Calculate which edge we're closest to
        float edgeHighlight = 0.0;

        // Create rotating highlight on edges
        float rotPhase = fract(angle / 6.28318);

        if (dMin == dTop && rotPhase < 0.25) {
            edgeHighlight = 1.0 - abs(rotPhase * 4.0 - 0.5) * 2.0;
        } else if (dMin == dRight && rotPhase >= 0.25 && rotPhase < 0.5) {
            edgeHighlight = 1.0 - abs((rotPhase - 0.25) * 4.0 - 0.5) * 2.0;
        } else if (dMin == dBottom && rotPhase >= 0.5 && rotPhase < 0.75) {
            edgeHighlight = 1.0 - abs((rotPhase - 0.5) * 4.0 - 0.5) * 2.0;
        } else if (dMin == dLeft && rotPhase >= 0.75) {
            edgeHighlight = 1.0 - abs((rotPhase - 0.75) * 4.0 - 0.5) * 2.0;
        }

        highlight = 0.5 + edgeHighlight * 0.5;
    }

    // Glow falloff
    float glow = smoothstep(glowWidth, 0.0, dMin) * glowIntensity * pulse * highlight;

    // Mix colors
    vec3 color;
    if (edgeOnly) {
        color = glowColor.rgb * glow;
    } else {
        color = mix(centerColor.rgb, glowColor.rgb, glow);
    }

    float alpha = edgeOnly ? glow : 1.0;

    gl_FragColor = vec4(color, alpha);
}
