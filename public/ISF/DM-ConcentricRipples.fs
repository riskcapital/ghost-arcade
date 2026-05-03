/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Multiple concentric ripple sources",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Wave"],
    "INPUTS": [
        {"NAME": "sourceCount", "TYPE": "float", "MIN": 1.0, "MAX": 5.0, "DEFAULT": 3.0, "LABEL": "Sources"},
        {"NAME": "rippleSpeed", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Speed"},
        {"NAME": "rippleFreq", "TYPE": "float", "MIN": 5.0, "MAX": 30.0, "DEFAULT": 15.0, "LABEL": "Frequency"},
        {"NAME": "decay", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5, "LABEL": "Decay"},
        {"NAME": "interference", "TYPE": "bool", "DEFAULT": true, "LABEL": "Interference"},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [0.0, 0.3, 0.6, 1.0], "LABEL": "Trough Color"},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.8, 1.0, 1.0], "LABEL": "Peak Color"},
        {"NAME": "moveSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Source Movement"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * rippleSpeed;

    float wave = 0.0;

    for (float i = 0.0; i < 5.0; i++) {
        if (i >= sourceCount) break;

        // Source position (moving)
        vec2 sourcePos = vec2(
            0.5 + cos(TIME * moveSpeed * (0.5 + hash(i * 1.23)) + i * 2.0) * 0.3,
            0.5 + sin(TIME * moveSpeed * (0.7 + hash(i * 2.34)) + i * 1.5) * 0.3
        );
        sourcePos.x *= RENDERSIZE.x / RENDERSIZE.y;

        float dist = length(uv - sourcePos);

        // Ripple wave
        float ripple = sin(dist * rippleFreq - t * 5.0 + i * 1.5);

        // Decay with distance
        ripple *= exp(-dist * decay);

        if (interference) {
            wave += ripple;
        } else {
            wave = max(wave, ripple);
        }
    }

    // Normalize if using interference
    if (interference) {
        wave /= sourceCount;
    }

    // Map to 0-1 range
    wave = wave * 0.5 + 0.5;

    // Color
    vec3 col = mix(color1.rgb, color2.rgb, wave);

    // Add highlights at peaks
    col += vec3(1.0) * smoothstep(0.8, 1.0, wave) * 0.3;

    gl_FragColor = vec4(col, 1.0);
}
