/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Rotating laser beams from center",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Lines"],
    "INPUTS": [
        {"NAME": "beamCount", "TYPE": "float", "MIN": 2.0, "MAX": 16.0, "DEFAULT": 6.0, "LABEL": "Beam Count"},
        {"NAME": "rotateSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Rotation Speed"},
        {"NAME": "beamWidth", "TYPE": "float", "MIN": 0.01, "MAX": 0.2, "DEFAULT": 0.05, "LABEL": "Beam Width"},
        {"NAME": "glowAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Glow Amount"},
        {"NAME": "pulse", "TYPE": "bool", "DEFAULT": true, "LABEL": "Pulse"},
        {"NAME": "beamColor", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.0, 1.0], "LABEL": "Beam Color"},
        {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [1.0, 0.5, 0.0, 1.0], "LABEL": "Glow Color"},
        {"NAME": "centerX", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Center X"},
        {"NAME": "centerY", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Center Y"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 center = vec2(centerX, centerY);
    vec2 p = uv - center;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * rotateSpeed;
    float angle = atan(p.y, p.x);
    float dist = length(p);

    vec3 col = vec3(0.0);

    float beamSpacing = 6.283185 / beamCount;

    for (float i = 0.0; i < 16.0; i++) {
        if (i >= beamCount) break;

        float beamAngle = i * beamSpacing + t;

        // Angular distance to beam
        float angleDiff = angle - beamAngle;
        angleDiff = mod(angleDiff + 3.14159, 6.28318) - 3.14159; // Wrap to [-pi, pi]

        float angularDist = abs(angleDiff);

        // Beam intensity
        float beam = smoothstep(beamWidth, 0.0, angularDist);

        // Glow
        float glow = smoothstep(beamWidth * 3.0, 0.0, angularDist) * glowAmount;

        // Pulse effect
        float pulseVal = 1.0;
        if (pulse) {
            pulseVal = 0.7 + 0.3 * sin(t * 5.0 + i * 0.8);
        }

        // Fade with distance from center
        float distFade = smoothstep(0.0, 0.1, dist);

        col += beamColor.rgb * beam * pulseVal * distFade;
        col += glowColor.rgb * glow * pulseVal * distFade * 0.5;
    }

    // Center glow
    col += beamColor.rgb * smoothstep(0.1, 0.0, dist) * 0.5;

    gl_FragColor = vec4(col, 1.0);
}
