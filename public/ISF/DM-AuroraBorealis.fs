/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Northern lights aurora effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Nature"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Speed"},
        {"NAME": "waveScale", "TYPE": "float", "MIN": 1.0, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Wave Scale"},
        {"NAME": "intensity", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Intensity"},
        {"NAME": "verticalPos", "TYPE": "float", "MIN": 0.3, "MAX": 0.8, "DEFAULT": 0.6, "LABEL": "Position"},
        {"NAME": "spread", "TYPE": "float", "MIN": 0.1, "MAX": 0.5, "DEFAULT": 0.25, "LABEL": "Spread"},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.5, 1.0], "LABEL": "Green"},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.5, 1.0, 1.0], "LABEL": "Blue"},
        {"NAME": "color3", "TYPE": "color", "DEFAULT": [0.5, 0.0, 1.0, 1.0], "LABEL": "Purple"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) { return fract(sin(n) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = i.x + i.y * 57.0;
    return mix(
        mix(hash(n), hash(n + 1.0), f.x),
        mix(hash(n + 57.0), hash(n + 58.0), f.x),
        f.y
    );
}

float fbm(vec2 p, float t) {
    float f = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
        f += amp * noise(p + t);
        p *= 2.0;
        amp *= 0.5;
    }
    return f;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float t = TIME * speed;

    vec3 col = vec3(0.0);

    // Multiple aurora layers
    for (float i = 0.0; i < 5.0; i++) {
        float layerOffset = i * 0.05;

        // Wave displacement
        float wave = fbm(vec2(uv.x * waveScale + i * 0.5, t * 0.3 + i), t * 0.2);
        wave = wave * 2.0 - 1.0;

        // Aurora band position
        float bandY = verticalPos + wave * 0.15 + layerOffset;
        float dist = abs(uv.y - bandY);

        // Falloff
        float aurora = smoothstep(spread, 0.0, dist);
        aurora *= 0.5 + 0.5 * fbm(vec2(uv.x * 3.0 + i, t), t * 0.5);

        // Color based on layer and position
        vec3 auroraColor;
        float colorMix = fract(i * 0.3 + uv.x * 0.5 + t * 0.1);
        if (colorMix < 0.33) {
            auroraColor = mix(color1.rgb, color2.rgb, colorMix * 3.0);
        } else if (colorMix < 0.66) {
            auroraColor = mix(color2.rgb, color3.rgb, (colorMix - 0.33) * 3.0);
        } else {
            auroraColor = mix(color3.rgb, color1.rgb, (colorMix - 0.66) * 3.0);
        }

        col += auroraColor * aurora * intensity / 5.0;
    }

    // Dark sky gradient
    vec3 sky = vec3(0.0, 0.02, 0.05);
    sky = mix(sky * 2.0, sky * 0.5, uv.y);
    col += sky;

    gl_FragColor = vec4(col, 1.0);
}
